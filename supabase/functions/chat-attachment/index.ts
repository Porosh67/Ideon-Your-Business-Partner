import { createClient } from 'npm:@supabase/supabase-js@2';
import mammoth from 'npm:mammoth@1.8.0';
import { extractText, getDocumentProxy } from 'npm:unpdf@1.8.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMBEDDING_DIM = 768;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_ATTACHMENTS = 3; // files per message
const MAX_DOC_TEXT_CHARS = 30000; // per-document text cap sent to the chat model

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getSupabaseKey(): string {
  const keysJson = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson);
      return keys['default'] ?? Object.values(keys)[0] ?? '';
    } catch {
      // fall through to legacy key
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

/** Verify the caller is an authenticated Supabase user. Returns user or null. */
async function verifyUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await supabase.auth.getUser(token);
  return data.user ?? null;
}

function getToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
}

/** Binary-safe base64 for Gemini inline data. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function guessMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'md':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

// ─────────────────────────────────────────────────────────────
// Gemini helpers — chat (multimodal) + embeddings
// ─────────────────────────────────────────────────────────────

/**
 * Multimodal generateContent. Tries the configured chat model first, then a
 * fallback chain of known Gemini chat models — a model-not-found (404/400)
 * simply advances to the next candidate. Images arrive as inline_data parts;
 * extracted document text arrives as plain text parts.
 */
async function geminiGenerate(apiKey: string, system: string, parts: Record<string, unknown>[]): Promise<string> {
  const configured = Deno.env.get('GEMINI_CHAT_MODEL');
  const candidates = [
    configured,
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ].filter((m): m is string => Boolean(m));

  let lastError: Error | null = null;
  for (const model of candidates) {
    try {
      // 25s cap on multimodal chat generation — the document+image pipeline
      // can run several Gemini calls in series, so each must leave enough
      // budget for the rest of the function. Without this, a wedged Gemini
      // call can hit the 60s Edge limit on the first attempt.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 1500 },
          }),
          signal: AbortSignal.timeout(25_000),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        // Model not found / unsupported input — try next candidate.
        if (res.status === 404 || res.status === 400) {
          lastError = new Error(`chat model ${model} failed (${res.status}): ${errText.slice(0, 200)}`);
          continue;
        }
        throw new Error(`Gemini generateContent failed (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const reply = (data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined)
        ?.map((p) => p?.text ?? '')
        .join('')
        .trim();
      if (reply) return reply;
      lastError = new Error(`chat model ${model} returned an empty response`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('geminiGenerate failed');
    }
  }
  throw lastError ?? new Error('No Gemini chat model available');
}

/**
 * Embed a single text with Gemini (same pipeline as semantic-memory):
 * configured model first, then a fallback chain, always requesting the
 * reduced 768-dim (matryoshka) output the pgvector column expects.
 */
async function embedText(apiKey: string, text: string): Promise<number[]> {
  const configured = Deno.env.get('GEMINI_EMBEDDING_MODEL');
  const candidates = [
    configured,
    'gemini-embedding-2',
    'gemini-embedding-001',
    'text-embedding-004',
  ].filter((m): m is string => Boolean(m));

  let lastError: Error | null = null;
  for (const model of candidates) {
    try {
      // 20s cap per candidate (matches semantic-memory). Without it, a
      // wedged Gemini embed call can hold the Edge slot for 60s and trigger
      // the runtime kill — which then surfaces as a hard 500 to the user.
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            content: { parts: [{ text: text.slice(0, 8000) }] },
            outputDimensionality: EMBEDDING_DIM,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 404 || res.status === 400) {
          lastError = new Error(`embed model ${model} failed (${res.status}): ${errText.slice(0, 200)}`);
          continue;
        }
        throw new Error(`Gemini embedContent failed (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const values = data?.embedding?.values;
      if (Array.isArray(values) && values.length === EMBEDDING_DIM) {
        return values as number[];
      }
      if (Array.isArray(values)) {
        lastError = new Error(`embed model ${model} returned ${values.length} dims, expected ${EMBEDDING_DIM}`);
        continue;
      }
      lastError = new Error(`embed model ${model} returned no embedding values`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('embedText failed');
    }
  }
  throw lastError ?? new Error('No embedding model available');
}

// ─────────────────────────────────────────────────────────────
// Document text extraction (txt/csv → decode; docx → mammoth;
// pdf → unpdf/pdfjs with an inline worker, serverless-friendly)
// ─────────────────────────────────────────────────────────────

async function extractDocumentText(
  att: { file_name: string; mime_type?: string },
  bytes: Uint8Array,
): Promise<string> {
  const name = att.file_name.toLowerCase();
  const ext = name.split('.').pop() ?? '';
  const mime = (att.mime_type ?? '').toLowerCase();

  if (ext === 'txt' || ext === 'md' || mime === 'text/plain') {
    return new TextDecoder().decode(bytes);
  }
  if (ext === 'csv' || mime === 'text/csv') {
    return new TextDecoder().decode(bytes);
  }
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ arrayBuffer: bytesToArrayBuffer(bytes) });
    return result.value;
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    const pdf = await getDocumentProxy(bytes);
    try {
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    } finally {
      try {
        await pdf.loadingTask?.destroy?.();
      } catch {
        // best-effort cleanup
      }
    }
  }
  throw new Error(`Unsupported file type: ${att.file_name}`);
}

/** Split long document text into overlapping segments for embedding. */
function chunkText(text: string, maxLen = 1500, overlap = 200): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxLen, normalized.length);
    if (end < normalized.length) {
      // Prefer breaking on a paragraph/line boundary, then a word boundary.
      const line = normalized.lastIndexOf('\n', end);
      if (line > start + maxLen * 0.5) end = line;
      else {
        const space = normalized.lastIndexOf(' ', end);
        if (space > start + maxLen * 0.5) end = space;
      }
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= 20) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const IDEON_SYSTEM =
  'You are "Ideon", an expert AI business advisor. You help founders and small ' +
  'business owners with strategy, marketing, pricing, finances, operations, and launching new ' +
  'ideas. Be concise, warm, and actionable. Use short paragraphs and bullet lists.\n\n' +
  'The founder has attached one or more files. STUDY the attached content carefully and use it ' +
  'in your answer: reference the ACTUAL details, figures, names, and text you see in the ' +
  'attachment (e.g. a handwritten note, a competitor pricing screenshot, or a document). ' +
  'Do not invent content that is not in the attachment. If the attachment is unreadable or ' +
  'irrelevant to the question, say so honestly. If asked about something outside business ' +
  'advice, politely steer the conversation back to business topics.';

// ─────────────────────────────────────────────────────────────
// Action: analyze — process attachments and answer with Gemini
// ─────────────────────────────────────────────────────────────

async function handleAnalyze(token: string, user: { id: string }, body: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
  }

  const message = (body?.message ?? '').toString().trim();
  const rawAttachments = Array.isArray(body?.attachments) ? (body.attachments as Record<string, unknown>[]) : [];

  if (rawAttachments.length === 0) {
    return json({ error: 'attachments is required (1-3 items)' }, 400);
  }
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return json({ error: `You can attach up to ${MAX_ATTACHMENTS} files per message` }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const parts: Record<string, unknown>[] = [];
  const processed: Record<string, unknown>[] = [];

  for (const att of rawAttachments) {
    const file_name = (att?.file_name ?? '').toString().trim();
    const storagePath = (att?.storage_path ?? '').toString().trim();
    const attachmentId = (att?.id ?? '').toString();
    const fileSize = Number(att?.file_size ?? 0);
    const kind = att?.kind === 'image' ? 'image' : 'document';
    const mimeType = (att?.mime_type ?? '').toString().trim() || guessMime(file_name);

    if (!file_name || !storagePath || !attachmentId) {
      return json({ error: 'Each attachment needs id, file_name and storage_path' }, 400);
    }
    if (fileSize > MAX_FILE_SIZE) {
      return json({ error: `${file_name} is over the 10 MB limit` }, 400);
    }

    // Owner-only read: the user-token client enforces storage RLS.
    const { data: blob, error: dlErr } = await supabase.storage
      .from('chat-attachments')
      .download(storagePath);
    if (dlErr || !blob) {
      console.error('chat-attachment download error:', dlErr?.message ?? 'no blob');
      return json({ error: `Could not read ${file_name} — try uploading it again` }, 400);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    if (kind === 'image') {
      parts.push({ inlineData: { mimeType, data: bytesToBase64(bytes) } });
      parts.push({ text: `[Image attached: ${file_name}]` });
      processed.push({ id: attachmentId, kind: 'image', file_name });
    } else {
      let text: string;
      try {
        text = await extractDocumentText({ file_name, mime_type: mimeType }, bytes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        console.error('chat-attachment extraction error:', msg);
        return json({ error: `Couldn't read text from ${file_name} (${msg})` }, 400);
      }
      text = text.replace(/\u0000/g, '').trim();
      if (text.length < 3) {
        return json({ error: `No readable text found in ${file_name}` }, 400);
      }

      // ── Embed + store chunked document content (future follow-ups) ──
      const chunks = chunkText(text);
      if (chunks.length > 0) {
        const embeddings = await Promise.all(chunks.map((c) => embedText(apiKey, c)));
        // Replace any previously stored chunks for this attachment.
        await supabase
          .from('memory_embeddings')
          .delete()
          .eq('user_id', user.id)
          .eq('source_type', 'document')
          .eq('source_id', attachmentId);
        const rows = chunks.map((c, i) => ({
          user_id: user.id,
          source_type: 'document',
          source_id: attachmentId,
          content: c,
          embedding: embeddings[i],
        }));
        const { error: insErr } = await supabase.from('memory_embeddings').insert(rows);
        if (insErr) {
          console.error('chat-attachment memory insert error:', insErr.message);
        }
      }

      parts.push({ text: `[Document: ${file_name}]\n${text.slice(0, MAX_DOC_TEXT_CHARS)}` });
      processed.push({
        id: attachmentId,
        kind: 'document',
        file_name,
        char_count: text.length,
        chunk_count: chunks.length,
      });
    }
  }

  const userParts = [
    ...parts,
    {
      text: message
        ? `\n\nThe founder wrote:\n${message}`
        : '\n\nDescribe what is in the attachment(s) and how they relate to building or running the founder\'s business. Reference the actual content.',
    },
  ];

  const reply = await geminiGenerate(apiKey, IDEON_SYSTEM, userParts);
  return json({ reply, processed });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const user = await verifyUser(req);
    if (!user) {
      return json({ error: 'Unauthorized — valid session required' }, 401);
    }

    const body = await req.json();
    const action = (body?.action ?? 'analyze').toString();

    if (action === 'analyze') {
      return await handleAnalyze(getToken(req), user, body);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('chat-attachment error:', message);
    return json({ error: message }, 500);
  }
});
