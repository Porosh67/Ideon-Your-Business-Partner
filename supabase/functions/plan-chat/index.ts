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

const SYSTEM_PROMPT =
  'You are an expert business advisor embedded inside "Ideon", a tool that helps ' +
  'founders turn ideas into actionable plans. A founder is asking questions about a specific ' +
  'business plan. Use the provided PLAN CONTEXT to answer. Be concise, specific, and practical. ' +
  'Use short paragraphs and bullet lists. If the answer is not in the plan context, give your ' +
  'best general advice but clearly label it as general guidance. Do not invent numbers as facts — ' +
  'use rough ranges and call them estimates.';

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
    const message = (body?.message ?? '').toString().trim();
    if (!message) {
      return json({ error: 'message is required' }, 400);
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return json({ error: 'GROQ_API_KEY is not configured' }, 500);
    }

    const planContext = JSON.stringify(body?.plan_context ?? {}).slice(0, 8000);
    const history = Array.isArray(body?.history) ? (body.history as unknown[]).slice(-20) : [];

    const messages = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nPLAN CONTEXT:\n${planContext}` },
      ...history.map((m) => {
        const item = m as { role?: string; content?: string };
        return {
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content ?? '').slice(0, 4000),
        };
      }),
      { role: 'user', content: message },
    ];

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.5,
        max_tokens: 1200,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Groq returned an empty response');

    return json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: msg }, 500);
  }
});
