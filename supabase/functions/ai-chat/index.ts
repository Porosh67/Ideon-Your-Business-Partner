import { createClient } from 'npm:@supabase/supabase-js@2';
import { friendlyEdgeError } from './_shared/error-message.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

const SYSTEM_PROMPT =
  'You are "Ideon", an expert AI business advisor. You help founders and small ' +
  'business owners with strategy, marketing, pricing, finances, operations, and launching new ' +
  'ideas. Be concise, warm, and actionable. Use short paragraphs and bullet lists. Ask a ' +
  'clarifying question when a request is ambiguous or lacks key details. Do not invent facts or ' +
  'precise figures — use rough ranges and label them as estimates. If asked about something ' +
  'outside business advice, politely steer the conversation back to business topics.';

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
    const rawMessages = Array.isArray(body?.messages) ? (body.messages as unknown[]) : null;
    if (!rawMessages || rawMessages.length === 0 || rawMessages.length > 40) {
      return json({ error: 'messages is required (1-40 items)' }, 400);
    }

    const apiKey = Deno.env.get('OLLAMA_API_KEY');
    if (!apiKey) {
      return json({ error: 'OLLAMA_API_KEY is not configured' }, 500);
    }

    const messages = rawMessages
      .map((m) => {
        const item = m as { role?: string; content?: string };
        const role = item.role === 'assistant' ? 'assistant' : item.role === 'system' ? 'system' : 'user';
        return { role, content: String(item.content ?? '').slice(0, 4000) };
      })
      .filter((m) => m.content.trim().length > 0);

    const res = await fetch('https://ollama.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash:cloud',
        temperature: 0.6,
        max_tokens: 1500,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
      // 25s ceiling — covers the deepseek-v4-flash full 1500-token reply; without
      // an explicit timeout a stalled TCP read surfaces `Deno.errors.ReadTimeout`.
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Ollama returned an empty response');

    return json({ reply });
  } catch (err) {
    console.error('ai-chat error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
