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
// Groq fallback chain — the primary is the smartest free-tier model
// (openai/gpt-oss-120b) but its TPM/RPM caps are tight. The fallback
// (llama-3.3-70b-versatile) is more generous and produces equally
// valid JSON. On a 429 we transparently escalate so the dashboard
// pipeline keeps returning a plan instead of a raw 500. Non-429
// errors still surface immediately — they are usually auth / wiring
// or a genuine outage and retrying won't help.
// ─────────────────────────────────────────────────────────────
const GROQ_MODEL_PRIMARY = 'openai/gpt-oss-120b';
const GROQ_MODEL_FALLBACK = 'llama-3.3-70b-versatile';
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
    // 30s default ceiling — long JSON generation on a slow model can hit Groq's
    // mid-stream stall window; without an explicit timeout a stalled TCP
    // read surfaces `Deno.errors.ReadTimeout` (the "Error: ReadTimeout:"
    // surfaced to the user previously).
    signal: signal ?? AbortSignal.timeout(30_000),
  });
}

/**
 * Groq chat completions with JSON output + 429-escalation. Returns
 * the parsed JSON object the model produced. Throws on non-429 errors
 * so the caller's catch can route to the safe-template plan envelope.
 */
async function groqJson(apiKey: string, systemPrompt: string, userPrompt: string) {
  let lastErr: unknown = null;
  for (const model of MODEL_CHAIN) {
    try {
      const res = await groqCall(apiKey, {
        model,
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Groq request failed (${res.status}): ${text.slice(0, 300)}`);
        if (res.status === 429 && nextModelAfterQuota(model)) {
          console.warn(
            `[generate-plan] groq ${model} hit quota (429); escalating to ${nextModelAfterQuota(model)}`
          );
          continue;
        }
        throw err;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Groq returned an empty response');
      return JSON.parse(content);
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

    // Wrapped in try/catch with a safe-template plan envelope so a stalled /
    // quota-exhausted Groq call cannot strand the dashboard pipeline with a
    // raw 500 — returns a minimal-valid plan the assistant-chat summary can
    // still build a friendly reply around. The plan_id + roadmap stage still
    // completes because all downstream stages tolerate a thin `first_steps`
    // array, normalised here in the same shape the success path produces.
    let plan: Record<string, unknown>;
    try {
      plan = await groqJson(apiKey, systemPrompt, userPrompt);
    } catch (planErr) {
      const why = planErr instanceof Error ? planErr.message : String(planErr);
      console.warn(
        `[generate-plan] groq chain failed (${why}); returning safe-template plan envelope`
      );
      return json({
        target_customer: 'Analysis unavailable — try regenerating the plan in a few minutes.',
        cost_estimate: 'Analysis unavailable — try regenerating the plan in a few minutes.',
        competitor_summary: [],
        first_steps: [
          { title: 'Re-generate the plan', description: 'Tap "Regenerate" on the saved plan — my language model just had a temporary outage and should be back shortly.' },
        ],
        idea_text: ideaText,
        partial: true,
        generated_at: new Date().toISOString(),
      });
    }

    // Normalize + validate shape
    const normalized = {
      target_customer: plan.target_customer ?? 'Not provided',
      cost_estimate: plan.cost_estimate ?? 'Not provided',
      competitor_summary: Array.isArray(plan.competitor_summary) ? plan.competitor_summary : [],
      first_steps: Array.isArray(plan.first_steps) ? plan.first_steps : [],
    };

    return json({ ...normalized, idea_text: ideaText, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('generate-plan error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
