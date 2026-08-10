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

/** Serialize a value for diagnostics, truncating huge base64 fields. */
function compactSnippet(value: unknown, maxLen = 2500): string {
  if (value === undefined) return 'undefined';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > maxLen ? `${str.slice(0, maxLen)}…[truncated]` : str;
}

/**
 * Fetch a compact summary of the Bright Data account's zones (diagnostics only).
 * GET /zone?zone=<name> authenticates with the same Bearer token used for /request.
 */
async function getZoneDiagnostics(apiKey: string, zoneName = 'serp_api1') {
  try {
    const res = await fetch(`https://api.brightdata.com/zone?zone=${encodeURIComponent(zoneName)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }
    const zones = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).zones)
        ? (parsed as Record<string, unknown>).zones
        : null;
    return {
      http_status: res.status,
      zones: Array.isArray(zones)
        ? zones.map((z) => {
            const zz = z as Record<string, unknown>;
            return {
              name: zz.name ?? zz.zone ?? null,
              status: zz.status ?? zz.type ?? null,
              credits: zz.credits ?? zz.plan_balance ?? zz.balance ?? null,
            };
          })
        : null,
      raw: compactSnippet(parsed ?? text, 1500),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * Run a battery of Bright Data request variants and return what each returns.
 * Used only to surface the exact Bright Data diagnostic when the main path
 * fails (empty body / non-JSON), so the real cause is visible.
 */
async function diagnoseBrightData(apiKey: string, query: string) {
  const variants: { label: string; body: Record<string, unknown> }[] = [
    { label: 'raw+brd_json (current)', body: { zone: 'serp_api1', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&brd_json=1`, format: 'raw' } },
    { label: 'json (parsed)', body: { zone: 'serp_api1', url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, format: 'json' } },
    { label: 'raw minimal', body: { zone: 'serp_api1', url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, format: 'raw' } },
    { label: 'json+brd_json', body: { zone: 'serp_api1', url: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&brd_json=1`, format: 'json' } },
  ];
  const out: Record<string, unknown>[] = [];
  for (const v of variants) {
    try {
      const res = await fetch('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(v.body),
      });
      const text = await res.text();
      out.push({
        label: v.label,
        http_status: res.status,
        content_type: res.headers.get('content-type') ?? 'n/a',
        body_length: text.length,
        body: compactSnippet(text, 600),
      });
    } catch (err) {
      out.push({ label: v.label, error: err instanceof Error ? err.message : 'unknown' });
    }
  }
  return out;
}

/** Call the Bright Data SERP API for a single query. */
async function serpSearch(apiKey: string, query: string) {
  // Documented Bright Data SERP pattern: format=raw + brd_json=1 in the URL.
  // See: https://docs.brightdata.com/api-reference/serp/google-search/text-search
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&brd_json=1`;

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
    // Not JSON at all (e.g. an HTML consent/block page) — surface the raw text
    // together with the HTTP status and content-type so the real cause is visible.
    throw new Error(
      `Bright Data returned a non-JSON response (status ${res.status}, content-type: ${res.headers.get('content-type') ?? 'n/a'}): ${text.slice(0, 500)}`,
    );
  }

  // format=json wraps the content in a `body` field; format=raw returns the SERP directly.
  let body: unknown = (data as { body?: unknown }).body ?? data;

  // Some responses double-encode the SERP as a JSON string.
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
    knowledge: record?.knowledge ?? null,
    people_also_ask: Array.isArray(record?.people_also_ask)
      ? (record.people_also_ask as Record<string, unknown>[])
          .map((item) => item.question)
          .filter(Boolean)
      : [],
  };

  if (organic.length === 0) {
    // Don't fail silently — surface the envelope so the real cause (invalid
    // zone, no credits, blocked page, changed response shape) is visible.
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
    const ideaText = (body?.idea_text ?? '').toString().trim();
    if (!ideaText || ideaText.length < 10) {
      return json({ error: 'idea_text is required (min 10 characters)' }, 400);
    }

    const apiKey = Deno.env.get('BRIGHT_DATA_API_KEY');
    if (!apiKey) {
      return json({ error: 'BRIGHT_DATA_API_KEY is not configured' }, 500);
    }

    // Build targeted research queries from the idea
    const shortIdea = ideaText.length > 120 ? ideaText.slice(0, 120) : ideaText;
    const queries = [
      `${shortIdea} competitors`,
      `${shortIdea} pricing`,
      `${shortIdea} market trend`,
    ];

    const results = await Promise.all(queries.map((q) => serpSearch(apiKey, q)));

    // Log diagnostics server-side (visible in Edge Function logs) when a query
    // produced no organic results.
    for (const r of results) {
      if (Array.isArray(r.organic) && r.organic.length === 0) {
        console.error(`research-market: no organic results for "${r.query}"`, JSON.stringify(r.diagnostic ?? {}).slice(0, 2000));
      }
    }

    return json({
      idea_text: ideaText,
      queries: results,
      research_summary: {
        total_results: results.reduce((sum, r) => sum + (Array.isArray(r.organic) ? r.organic.length : 0), 0),
        top_competitors: results
          .flatMap((r) => (Array.isArray(r.organic) ? r.organic : []))
          .slice(0, 10),
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('research-market error:', message);
    // Attach Bright Data account/zone diagnostics + a request-variant battery so
    // failures are self-explanatory.
    const apiKey = Deno.env.get('BRIGHT_DATA_API_KEY');
    let brightDataDiagnostics: Record<string, unknown> = { error: 'BRIGHT_DATA_API_KEY is not configured' };
    if (apiKey) {
      const zoneDiag = await getZoneDiagnostics(apiKey);
      const battery = await diagnoseBrightData(apiKey, 'on-demand dog grooming competitors');
      brightDataDiagnostics = { zone: zoneDiag, battery };
    }
    return json({ error: message, bright_data_diagnostics: brightDataDiagnostics }, 500);
  }
});
