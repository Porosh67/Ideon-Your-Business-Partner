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

/** Call Groq chat completions (OpenAI-compatible) with llama-3.3-70b-versatile. */
async function groqChat(apiKey: string, systemPrompt: string, userPrompt: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 512,
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
    const mood = body?.mood;
    const energy = body?.energy;
    const notes = (body?.notes ?? '').toString().trim();
    const latestIdea = body?.latest_idea; // optional: user's most recent business idea

    if (mood == null || energy == null) {
      return json({ error: 'mood and energy are required' }, 400);
    }

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return json({ error: 'GROQ_API_KEY is not configured' }, 500);
    }

    const moodLabel = ['', 'Rough', 'Meh', 'Okay', 'Good', 'Great'][mood] ?? `level ${mood}`;
    const energyLabel = energy >= 4 ? 'high energy' : energy >= 3 ? 'moderate energy' : 'low energy';

    const system =
      'You are a friendly startup coach checking in with a founder. ' +
      'Give a SHORT, warm, genuinely useful response (2-4 sentences max) based on their daily check-in. ' +
      'Respond in first person as their coach. Use a warm, conversational tone. No JSON. No markdown.';

    let prompt =
      `They're feeling: ${moodLabel}/5\n` +
      `Their energy level: ${energyLabel} (${energy}/5)\n` +
      `Their note: "${notes || 'No note'}"\n`;

    if (latestIdea) {
      prompt += `\nThey're working on: "${latestIdea}"\n` +
        'Relate your response to their business idea if relevant — e.g. if they have low energy, ' +
        'encourage them about their idea progress; if they feel great, connect it to momentum. ' +
        'Keep it lightweight, not preachy.';
    } else {
      prompt += "\nThey don't have a saved business idea yet. Keep the response general " +
        'but encouraging — relate to founder life and building momentum.';
    }

    const reply = await groqChat(apiKey, system, prompt);

    return json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
