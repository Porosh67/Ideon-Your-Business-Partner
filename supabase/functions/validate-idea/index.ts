import { createClient } from 'npm:@supabase/supabase-js@2';
import { friendlyEdgeError } from '../_shared/error-message.ts';

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

// ─────────────────────────────────────────────────────────────
// Ollama Cloud fallback chain — same shape as assistant-chat. The
// primary is the smartest model on the free tier but has a lower
// tokens-per-day quota; nemotron-3-super:cloud is more generous and
// is good enough for a YES/NO classifier. On a 429 we transparently
// escalate to the fallback so the user's "Validate Idea" button
// keeps working instead of returning a 500. Non-429 errors still
// surface immediately (they are usually malformed-key or genuine
// outages — retrying the same call won't help).
// ─────────────────────────────────────────────────────────────
const OLLAMA_MODEL_PRIMARY = 'deepseek-v4-flash:cloud';
const OLLAMA_MODEL_FALLBACK = 'nemotron-3-super:cloud';
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
    // 25s default ceiling — well above the YES/NO classifier's normal ~1-3s
    // response but well below the Edge 60s hard kill. Without an explicit
    // timeout a stalled TCP read surfaces `Deno.errors.ReadTimeout`.
    signal: signal ?? AbortSignal.timeout(25_000),
  });
}

/** Call Ollama Cloud with a system + user prompt. Escalates to the fallback on 429. */
async function groqText(apiKey: string, systemPrompt: string, userPrompt: string, maxTokens = 256, temperature = 0.1) {
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
            `[validate-idea] ollama ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
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
    const ideaText = (body?.idea_text ?? '').toString().trim();

    if (!ideaText || ideaText.length < 10) {
      return json({ error: 'idea_text is required (min 10 characters)' }, 400);
    }

    const apiKey = Deno.env.get('OLLAMA_API_KEY');
    if (!apiKey) {
      return json({ error: 'OLLAMA_API_KEY is not configured' }, 500);
    }

    const system =
      'You decide whether the user\'s message is the kind of text we should run a business-planing pipeline on.\n' +
      '\n' +
      'Answer YES when the user is clearly trying to: ' +
      'describe a business, product, service, app, side-hustle, SaaS, agency, store, marketplace, or any other commercial venture; ' +
      'give even a short or rough commercial concept (for example: a coffee shop in Lisbon, an app for tutors, a gym for seniors); ' +
      'ask you to plan, research, brainstorm, evaluate, name, or otherwise generate around a business direction.\n' +
      '\n' +
      'Aim for the user\'s intent, not a checklist. You do NOT need an audience, a value claim, or a monetization story in the input. A terse two- or three-word idea that names an offer is a YES — it expresses the kind of commercial direction we want our researchers to flesh out.\n' +
      '\n' +
      'Answer NO only when the input is empty of business meaning, clearly unrelated to starting a commercial venture (a recipe, a personal diary entry, a weather question, a math problem, an unrelated software ask, a greeting, a creative writing prompt), or pure nonsense (random characters with no commercial read).\n' +
      '\n' +
      'Respond with EXACTLY one word: YES or NO. No punctuation, no explanation.';

    const reply = await groqText(apiKey, system, ideaText);

    // Tolerant parse: exact "YES"/"NO" first, then any message that contains
    // YES as a standalone word. The classifier prompt is explicit but the 8b
    // fallback has been known to emit " YES" or "YES.". We accept it as YES
    // whenever the model clearly intended a YES, and otherwise treat it as
    // NO so the user just sees the friendly "describe a product" prompt.
    const normalized = reply.toUpperCase().trim();
    const isBusinessIdea = normalized === 'YES' || /^YES\b/.test(normalized);

    return json({
      is_business_idea: isBusinessIdea,
      message: isBusinessIdea
        ? null
        : 'That doesn\'t seem to be a business idea. Could you describe a product or service you\'d like to start — what it offers, who it helps, and how it creates value?',
    });
  } catch (err) {
    console.error('validate-idea error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
