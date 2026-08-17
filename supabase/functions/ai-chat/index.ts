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

// ─────────────────────────────────────────────────────────────
// IDEON persona anchor — prepended to every system prompt so the
// model never loses its identity even on narrowed context branches
// (plan context, follow-up Q&A, etc.) where the smaller Nemotron
// fallback can drift toward a generic "you are an assistant" tone.
// Frozen in one place so any future persona tweak happens here only.
// ─────────────────────────────────────────────────────────────
const IDEON_PERSONA =
  'YOU ARE IDEON — a senior, sharp, grounded business-idea co-pilot. ' +
  'You help founders and aspiring entrepreneurs turn rough ideas into ' +
  'structured, market-researched plans. Your specialties: live market ' +
  'research, competitor snapshots, structured business plans, ' +
  '30-day roadmaps with skills-to-learn, daily founder check-ins, and ' +
  'entrepreneur brainstorming. Voice: warm, specific, never salesy, ' +
  'never repetitive. ' +
  'When the founder chats casually or drifts off-topic, gently steer ' +
  'back toward business ideas without being dismissive — your job is to ' +
  'make every conversation useful. ' +
  'Never reuse the same opening sentence you used in a previous turn. ' +
  'Never pad with hedges like "Sure, I can help with that!" ' +
  'unless the question really warrants it.';

const SYSTEM_PROMPT =
  'You are "Ideon", an expert AI business advisor. You help founders and small ' +
  'business owners with strategy, marketing, pricing, finances, operations, and launching new ' +
  'ideas. Be concise, warm, and actionable. Use short paragraphs and bullet lists. Ask a ' +
  'clarifying question when a request is ambiguous or lacks key details. Do not invent facts or ' +
  'precise figures — use rough ranges and label them as estimates. If asked about something ' +
  'outside business advice, politely steer the conversation back to business topics.';

// ─────────────────────────────────────────────────────────────
// Ollama Cloud fallback chain — same shape as the other Ideon
// chat functions. The primary (gemma4:31b-cloud) is the smartest
// model on the free tier but has a tighter TPD quota; the fallback
// (nemotron-3-nano:30b-cloud) is more generous and is good enough
// for ordinary follow-up replies. On a 429 we transparently
// escalate so the user's chat keeps getting an answer instead of
// a 500. Non-429 errors (auth/wiring/outage) still surface immediately.
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
    // 25s default ceiling — same shape as the other Ideon chat functions.
    signal: signal ?? AbortSignal.timeout(25_000),
  });
}

/** Send a pre-built messages array to Ollama Cloud; escalates to the fallback on 429. */
async function groqChatMessages(apiKey: string, messages: { role: string; content: string }[], maxTokens = 1500, temperature = 0.6) {
  let lastErr: unknown = null;
  for (const model of MODEL_CHAIN) {
    try {
      const res = await groqCall(apiKey, {
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
        if (res.status === 429 && nextModelAfterQuota(model)) {
          console.warn(
            `[ai-chat] ollama ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
          );
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error('Ollama returned an empty response');
      return reply.trim();
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

/**
 * Safe-template fallback when BOTH models in the chain fail. Returns
 * an on-brand Ideon message rather than bubbling up a raw 500 to the
 * user. Consist across Ideon chat functions: warm steer-back, mention
 * the speech-act, end with a clear next step. Kept conservative —
 * no persona characters, no facts, no fabricated numbers.
 */
function safeTemplateReply(): string {
  return [
    "My language model is taking a quick break, so here's a practical fallback I can offer right now:",
    "• If you're pricing a product or service: anchor on cost-of-goods × 2.5–3× for non-luxury, then validate with 5 real customer conversations this week.",
    "• If you're sizing a market: top-down (population × % who could buy × realistic price) beats bottom-down every time. Order-of-magnitude is fine — labelled as an estimate.",
    "• If you're stuck on next steps: ship the simplest version that one specific person would pay for, then collect 3 pieces of feedback from real users before adding anything.",
    "When my language model is back, send any of those prompts again and I'll run live market research, build a structured plan, and queue up a 30-day roadmap for you.",
  ].join('\n\n');
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

    // Prepend IDEON_PERSONA so the model never loses its founder-coach
    // identity, even when the smaller Nemotron fallback handles the reply.
    const systemMessage = `${IDEON_PERSONA}\n\n${SYSTEM_PROMPT}`;
    const finalMessages = [{ role: 'system' as const, content: systemMessage }, ...messages];

    // Wrapped in try/catch so a stalled/dead language provider cannot
    // strand the user with a raw 500 — surface the on-brand safe
    // template instead, consistent with assistant-chat / plan-chat /
    // checkin-respond.
    let reply: string;
    try {
      reply = await groqChatMessages(apiKey, finalMessages);
    } catch (replyErr) {
      const why = replyErr instanceof Error ? replyErr.message : String(replyErr);
      console.warn(`[ai-chat] ollama chain failed (${why}); routing to safe-template reply`);
      reply = safeTemplateReply();
    }

    return json({ reply });
  } catch (err) {
    console.error('ai-chat error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
