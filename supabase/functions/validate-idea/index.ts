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
      // fall through
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

/** Call Groq with text (no JSON mode — we parse the raw text). */
async function groqText(apiKey: string, systemPrompt: string, userPrompt: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 256,
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
  return content.trim();
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

    if (!ideaText || ideaText.length < 10) {
      return json({ error: 'idea_text is required (min 10 characters)' }, 400);
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return json({ error: 'GROQ_API_KEY is not configured' }, 500);
    }

    const system =
      'You classify whether the user\'s text describes a business idea. ' +
      'A business idea is a concept for a product or service that could generate revenue. ' +
      'It typically includes what is offered, to whom, and/or how it creates value. ' +
      'Questions, random statements, or topics unrelated to starting a business are NOT business ideas.\n' +
      'Respond with EXACTLY one word: YES or NO. No punctuation, no explanation.';

    const reply = await groqText(apiKey, system, ideaText);

    const isBusinessIdea = reply.toUpperCase() === 'YES';

    return json({
      is_business_idea: isBusinessIdea,
      message: isBusinessIdea
        ? null
        : 'That doesn\'t seem to be a business idea. Could you describe a product or service you\'d like to start — what it offers, who it helps, and how it creates value?',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
