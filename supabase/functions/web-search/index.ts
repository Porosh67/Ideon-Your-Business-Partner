import { createClient } from 'npm:@supabase/supabase-js@2';

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

/** Compact snippet for diagnostics — truncates huge base64 fields. */
function compactSnippet(value: unknown, maxLen = 800): string {
  if (value === undefined) return 'undefined';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > maxLen ? `${str.slice(0, maxLen)}…[truncated]` : str;
}

/**
 * Run a single Bright Data SERP search and normalize the organic results.
 * Same zone/format pattern as research-market (serp_api1 + format=raw + brd_json=1).
 */
async function serpSearch(apiKey: string, query: string) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&brd_json=1`;

  // 30s ceiling. The recent 65s edge runtime 500s in production were
  // caused by stuck Bright Data SERP calls; capping the upstream fetch
  // here means we surface a clean 500 from web-search itself in under
  // half the Edge budget, instead of being killed silently by the runtime.
  const res = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      zone: 'serp_api1',
      url,
      format: 'raw',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bright Data request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Bright Data returned a non-JSON response (status ${res.status}, content-type: ${res.headers.get('content-type') ?? 'n/a'}): ${text.slice(0, 500)}`,
    );
  }

  let body: unknown = (data as { body?: unknown }).body ?? data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // keep as string — surfaced in diagnostics below if unusable
    }
  }

  const record = (body && typeof body === 'object' ? body : null) as Record<string, unknown> | null;
  const general = (record?.general && typeof record.general === 'object'
    ? record.general
    : null) as Record<string, unknown> | null;

  const organic = Array.isArray(record?.organic)
    ? (record.organic as Record<string, unknown>[]).map((item) => ({
        rank: item.rank ?? null,
        title: item.title ?? null,
        link: item.link ?? null,
        source: item.source ?? null,
        description: item.description ?? null,
      }))
    : [];

  const result: Record<string, unknown> = {
    query,
    search_engine: general?.search_engine ?? 'google',
    results_cnt: general?.results_cnt ?? null,
    organic,
    people_also_ask: Array.isArray(record?.people_also_ask)
      ? (record.people_also_ask as Record<string, unknown>[])
          .map((item) => item.question)
          .filter(Boolean)
      : [],
  };

  if (organic.length === 0) {
    const error =
      (record?.error as string | undefined) ??
      (record?.message as string | undefined) ??
      (record?.status !== undefined && record?.status !== 'success' ? String(record.status) : undefined) ??
      null;
    result.diagnostic = {
      error,
      status_code: record?.status_code ?? record?.code ?? null,
      raw_response: compactSnippet(record ?? data),
    };
  }

  return result;
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
    const query = (body?.query ?? '').toString().trim();
    if (!query || query.length < 3) {
      return json({ error: 'query is required (min 3 characters)' }, 400);
    }
    if (query.length > 300) {
      return json({ error: 'query is too long (max 300 characters)' }, 400);
    }

    const apiKey = Deno.env.get('BRIGHT_DATA_API_KEY');
    if (!apiKey) {
      return json({ error: 'BRIGHT_DATA_API_KEY is not configured' }, 500);
    }

    const result = await serpSearch(apiKey, query);
    return json({ ...result, generated_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('web-search error:', message);
    return json({ error: message }, 500);
  }
});
