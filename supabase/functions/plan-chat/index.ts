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
// Groq fallback chain — same shape as assistant-chat. The 70b
// is the smartest llama on the free tier but has a 100k TPD
// quota; llama-3.1-8b-instant is ~5x more generous and is good
// enough for follow-up chat replies. On a 429 we transparently
// escalate to 8b-instant so the user's follow-up question keeps
// getting answered instead of returning a 500 "Sorry, I couldn't
// process that". Non-429 errors still surface immediately (they
// are usually auth or genuine outages — retrying won't help).
// ─────────────────────────────────────────────────────────────
const GROQ_MODEL_PRIMARY = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FALLBACK = 'llama-3.1-8b-instant';
const MODEL_CHAIN = [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK] as const;

function nextModelAfterQuota(currentModel: string): string | null {
  const idx = MODEL_CHAIN.indexOf(currentModel as (typeof MODEL_CHAIN)[number]);
  if (idx < 0 || idx === MODEL_CHAIN.length - 1) return null;
  return MODEL_CHAIN[idx + 1] ?? null;
}

function isGroqQuotaError(err: unknown): boolean {
  return err instanceof Error && /Groq request failed \(429\)/.test(err.message);
}

async function groqCall(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return await fetch('https://api.groq.com/openai/v1/chat/completions', {
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

/** Send a pre-built messages array to Groq; escalates to 8b-instant on 429. */
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
        const err = new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
        if (res.status === 429 && nextModelAfterQuota(model)) {
          console.warn(
            `[plan-chat] groq ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
          );
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error('Groq returned an empty response');
      return reply.trim();
    } catch (err) {
      lastErr = err;
      if (isGroqQuotaError(err) && nextModelAfterQuota(model)) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Groq request failed: all models exhausted quota');
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
      { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\nPLAN CONTEXT:\n${planContext}` },
      ...history.map((m) => {
        const item = m as { role?: string; content?: string };
        return {
          role: (item.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: String(item.content ?? '').slice(0, 4000),
        };
      }),
      { role: 'user' as const, content: message },
    ];

    const reply = await groqChatMessages(apiKey, messages);

    return json({ reply });
  } catch (err) {
    console.error('plan-chat error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
