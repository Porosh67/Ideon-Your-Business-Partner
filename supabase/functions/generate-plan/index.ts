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

/** Call Groq chat completions (OpenAI-compatible) and parse a JSON object out. */
async function groqJson(apiKey: string, systemPrompt: string, userPrompt: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned an empty response');

  return JSON.parse(content);
}

Deno.serve(async (req: Request) => {
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
    const researchData = body?.research_data ?? {};

    if (!ideaText || ideaText.length < 10) {
      return json({ error: 'idea_text is required (min 10 characters)' }, 400);
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return json({ error: 'GROQ_API_KEY is not configured' }, 500);
    }

    const researchSummary = JSON.stringify(researchData).slice(0, 8000);

    const systemPrompt =
      'You are an expert business strategist and startup consultant. ' +
      'You transform a founder\'s business idea and live market research into a concise, structured business plan. ' +
      'Respond ONLY with valid JSON matching this exact schema:\n' +
      '{\n' +
      '  "target_customer": string (who the product serves, 1-2 sentences),\n' +
      '  "cost_estimate": string (estimated startup costs with rough breakdown, 2-3 sentences),\n' +
      '  "competitor_summary": array of objects { name: string, positioning: string, strengths: string, weaknesses: string } (3-5 competitors),\n' +
      '  "first_steps": array of objects { title: string, description: string } (5-8 actionable first steps)\n' +
      '}';

    const userPrompt =
      `BUSINESS IDEA:\n${ideaText}\n\n` +
      `LIVE MARKET RESEARCH (from web search):\n${researchSummary}\n\n` +
      'Generate the business plan JSON now.';

    const plan = await groqJson(apiKey, systemPrompt, userPrompt);

    // Normalize + validate shape
    const normalized = {
      target_customer: plan.target_customer ?? 'Not provided',
      cost_estimate: plan.cost_estimate ?? 'Not provided',
      competitor_summary: Array.isArray(plan.competitor_summary) ? plan.competitor_summary : [],
      first_steps: Array.isArray(plan.first_steps) ? plan.first_steps : [],
    };

    return json({ ...normalized, idea_text: ideaText, generated_at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
