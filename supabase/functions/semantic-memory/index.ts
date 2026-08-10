import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMBEDDING_DIM = 768;

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

/**
 * Embed a single text with Gemini. Tries the configured model first, then a
 * small fallback chain of known embedding models. Always requests a reduced
 * 768-dim output (matryoshka) so the pgvector column stays small and fast.
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
      // 20s ceiling per candidate model — keeps a wedged Gemini embed
      // call from eating the entire Edge runtime budget. Note: the host
      // semantic-memory/chat-attachment functions both share this body.
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
        // Model not found or dimensionality unsupported — try next candidate.
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

/** Store (upsert) an embedding row for the authenticated user. */
async function handleStore(token: string, body: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
  }

  const sourceType = (body?.source_type ?? '').toString();
  const sourceId = (body?.source_id ?? '').toString();
  const content = (body?.content ?? '').toString().trim();

  if (!['conversation', 'idea'].includes(sourceType)) {
    return json({ error: 'source_type must be "conversation" or "idea"' }, 400);
  }
  if (!sourceId) {
    return json({ error: 'source_id is required' }, 400);
  }
  if (!content || content.length < 3) {
    return json({ error: 'content is required (min 3 characters)' }, 400);
  }

  // Verify the user via the token, then reuse the user-scoped client so RLS applies.
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (!user) {
    return json({ error: 'Unauthorized — valid session required' }, 401);
  }

  const embedding = await embedText(apiKey, content);

  const { error } = await supabase.from('memory_embeddings').upsert(
    {
      user_id: user.id,
      source_type: sourceType,
      source_id: sourceId,
      content,
      embedding,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source_type,source_id' },
  );

  if (error) {
    console.error('semantic-memory store error:', error.message);
    return json({ error: 'Could not store memory embedding' }, 500);
  }

  return json({ ok: true });
}

/** Search the user's embeddings for the top-k semantically similar rows. */
async function handleSearch(token: string, body: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
  }

  const query = (body?.query ?? '').toString().trim();
  const limit = Math.min(Math.max(Number(body?.limit ?? 4) || 4, 1), 10);
  const sourceType = body?.source_type ? (body.source_type as string) : null; // optional filter

  if (!query || query.length < 2) {
    return json({ error: 'query is required (min 2 characters)' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (!user) {
    return json({ error: 'Unauthorized — valid session required' }, 401);
  }

  const embedding = await embedText(apiKey, query);

  // RPC returns all source types; filter to the requested one client-side so
  // document chunk follow-ups (source_type: 'document') work alongside the
  // existing conversation/idea memory search.
  const { data, error } = await supabase.rpc('match_memory_embeddings', {
    p_user_id: user.id,
    p_query_embedding: embedding,
    p_match_count: Math.min(limit * 3, 30),
  });

  if (error) {
    console.error('semantic-memory search error:', error.message);
    return json({ error: 'Could not search memory embeddings' }, 500);
  }

  let results = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (sourceType) {
    results = results.filter((r) => (r?.source_type ?? '').toString() === sourceType);
  }
  results = results.slice(0, limit);

  return json({ results });
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
    const body = await req.json();
    const action = (body?.action ?? '').toString();

    if (action === 'store') {
      return await handleStore(getToken(req), body);
    }
    if (action === 'search') {
      return await handleSearch(getToken(req), body);
    }

    return json({ error: 'action must be "store" or "search"' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('semantic-memory error:', message);
    return json({ error: message }, 500);
  }
});
