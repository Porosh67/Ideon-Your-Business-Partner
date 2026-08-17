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

// ─────────────────────────────────────────────────────────────
// Ollama Cloud fallback chain — same shape as assistant-chat. The
// primary is the smartest model on the free tier but has a lower
// TPD quota; the fallback is more generous and is good enough for
// the warm check-in reply. On a 429 we transparently escalate to
// the fallback so the user's check-in keeps getting a reply
// instead of returning a 500. Non-429 errors still surface
// immediately (they are usually auth/wiring — retrying won't help).
// ─────────────────────────────────────────────────────────────
const OLLAMA_MODEL_PRIMARY = 'gemma4:31b-cloud';
const OLLAMA_MODEL_FALLBACK = 'nemotron-3-nano:30b-cloud';
const MODEL_CHAIN = [OLLAMA_MODEL_PRIMARY, OLLAMA_MODEL_FALLBACK] as const;

function nextModelAfterQuota(currentModel: string): string | null {
  const idx = MODEL_CHAIN.indexOf(currentModel as (typeof MODEL_CHAIN)[number]);
  if (idx < 0 || idx === MODEL_CHAIN.length - 1) return null;
  return MODEL_CHAIN[idx + 1] ?? null;
}

function isGroqQuotaError(err: unknown): boolean {
  return err instanceof Error && /Ollama request failed \(429\)/.test(err.message);
}

async function groqCall(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return await fetch('https://ollama.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    // 20s default ceiling — check-in is a short, warm 2-4 sentence reply on
    // a small prompt, so the primary normally finishes in 3-6s and never needs
    // more than the safety net below. Without an explicit timeout a stalled
    // TCP read surfaces `Deno.errors.ReadTimeout`.
    signal: signal ?? AbortSignal.timeout(20_000),
  });
}

/** Send a system + user prompt to Ollama Cloud; escalates to the fallback on 429. */
async function groqChat(apiKey: string, systemPrompt: string, userPrompt: string, maxTokens = 512, temperature = 0.7) {
  let lastErr: unknown = null;
  for (const model of MODEL_CHAIN) {
    try {
      const res = await groqCall(apiKey, {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
        if (res.status === 429 && nextModelAfterQuota(model)) {
          console.warn(
            `[checkin-respond] ollama ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
          );
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Ollama returned an empty response');
      return content.trim();
    } catch (err) {
      lastErr = err;
      if (isGroqQuotaError(err) && nextModelAfterQuota(model)) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Ollama request failed: all models exhausted quota');
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

    const apiKey = Deno.env.get('OLLAMA_API_KEY');
    if (!apiKey) {
      return json({ error: 'OLLAMA_API_KEY is not configured' }, 500);
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
    console.error('checkin-respond error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
