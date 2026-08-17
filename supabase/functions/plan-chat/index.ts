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
// Ollama Cloud fallback chain — same shape as assistant-chat. The
// primary is the smartest model on the free tier but has a lower
// TPD quota; the fallback is more generous and is good enough for
// follow-up chat replies. On a 429 we transparently escalate to the
// fallback so the user's follow-up question keeps getting answered
// instead of returning a 500 "Sorry, I couldn't process that".
// Non-429 errors still surface immediately (they are usually auth
// or genuine outages — retrying won't help).
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
    // 25s default ceiling — same shape as validate-idea. Without an explicit
    // timeout a stalled TCP read surfaces `Deno.errors.ReadTimeout`.
    signal: signal ?? AbortSignal.timeout(25_000),
  });
}

/** Send a pre-built messages array to Ollama Cloud; escalates to the fallback on 429. */
async function groqChatMessages(apiKey: string, messages: { role: string; content: string }[], maxTokens = 1200, temperature = 0.5) {
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
            `[plan-chat] ollama ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
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

// ─────────────────────────────────────────────────────────────
// IDEON persona anchor — prepended so the model never loses its
// founder-coach identity even on the narrowed plan-context branch
// (where the smaller Nemotron fallback can otherwise drift toward a
// generic "you are an assistant" tone). Frozen in one place.
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
  'make every conversation useful.';

const SYSTEM_PROMPT =
  'You are an expert business advisor embedded inside "Ideon", a tool that helps ' +
  'founders turn ideas into actionable plans. A founder is asking questions about a specific ' +
  'business plan. Use the provided PLAN CONTEXT to answer. Be concise, specific, and practical. ' +
  'Use short paragraphs and bullet lists. If the answer is not in the plan context, give your ' +
  'best general advice but clearly label it as general guidance. Do not invent numbers as facts — ' +
  'use rough ranges and call them estimates.';

/**
 * Safe-template fallback when BOTH models in the chain fail. References
 * the user's plan context (so the response isn't useless) without making
 * up specifics — gives a structured steer-back with concrete next steps.
 */
function safeTemplateReply(message: string): string {
  const trimmed = message.trim().slice(0, 160);
  return [
    "My language model is taking a quick break, so here's a practical fallback while I get back online:",
    'If you have your saved plan open, the most useful moves right now are:',
    '1) Review the first 3 steps in your plan and pick the one you can finish in the next 7 days — that\'s the only step that matters today.',
    '2) Map your top 3 unanswered risks (the "first_steps" usually flag one). Write one short clarifying question per risk.',
    '3) Talk to one real potential customer this week before doing anything else.',
    trimmed
      ? `When my language model is back, paste your follow-up ("${trimmed.replace(/"/g, '\\"')}") into the chat and I'll answer it grounded in your saved plan context.`
      : "When my language model is back, send your follow-up question again and I'll answer it grounded in your saved plan context.",
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
    const message = (body?.message ?? '').toString().trim();
    if (!message) {
      return json({ error: 'message is required' }, 400);
    }

    const apiKey = Deno.env.get('OLLAMA_API_KEY');
    if (!apiKey) {
      return json({ error: 'OLLAMA_API_KEY is not configured' }, 500);
    }

    const planContext = JSON.stringify(body?.plan_context ?? {}).slice(0, 8000);
    const history = Array.isArray(body?.history) ? (body.history as unknown[]).slice(-20) : [];

    // Prepend IDEON_PERSONA so the model never loses its founder-coach
    // identity, even when the smaller Nemotron fallback handles the reply.
    const systemContent = `${IDEON_PERSONA}\n\n${SYSTEM_PROMPT}\n\nPLAN CONTEXT:\n${planContext}`;
    const messages = [
      { role: 'system' as const, content: systemContent },
      ...history.map((m) => {
        const item = m as { role?: string; content?: string };
        return {
          role: (item.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: String(item.content ?? '').slice(0, 4000),
        };
      }),
      { role: 'user' as const, content: message },
    ];

    // Wrapped in try/catch so a stalled/dead language provider cannot
    // strand the user with a raw 500 — surface the on-brand safe
    // template instead, consistent with assistant-chat / ai-chat /
    // checkin-respond.
    let reply: string;
    try {
      reply = await groqChatMessages(apiKey, messages);
    } catch (replyErr) {
      const why = replyErr instanceof Error ? replyErr.message : String(replyErr);
      console.warn(`[plan-chat] ollama chain failed (${why}); routing to safe-template reply`);
      reply = safeTemplateReply(message);
    }

    return json({ reply });
  } catch (err) {
    console.error('plan-chat error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
