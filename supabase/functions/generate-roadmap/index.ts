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

/** Call the Gemini generateContent REST API and parse a JSON object out. */
async function geminiJson(apiKey: string, prompt: string) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
    // 40s ceiling — the 30-day roadmap is a long JSON payload (≈30 tasks +
    // 10 skills + summary). Without an explicit timeout a stalled TCP read
    // surfaces `Deno.errors.ReadTimeout` mid-stream.
    signal: AbortSignal.timeout(40_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('');

  if (!text) throw new Error('Gemini returned an empty response');

  // Strip any markdown fences the model may add
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
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
    const businessPlan = body?.business_plan;
    if (!businessPlan || typeof businessPlan !== 'object') {
      return json({ error: 'business_plan object is required' }, 400);
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return json({ error: 'GEMINI_API_KEY is not configured' }, 500);
    }

    const planSummary = JSON.stringify(businessPlan).slice(0, 8000);

    const prompt =
      'You are a career coach and startup mentor. Based on the business plan below, produce a structured roadmap.\n' +
      'Respond ONLY with valid JSON matching this exact schema:\n' +
      '{\n' +
      '  "skills_to_learn": array of objects { skill: string, reason: string } (5-10 skills),\n' +
      '  "checklist_30_days": array of objects { task: string } (exactly 30 actionable tasks, one per day),\n' +
      '  "skill_gap_summary": string (career-direction analysis of what the founder must learn, 2-4 sentences)\n' +
      '}\n\n' +
      `BUSINESS PLAN:\n${planSummary}`;

    const roadmap = await geminiJson(apiKey, prompt);

    const normalized = {
      skills_to_learn: Array.isArray(roadmap.skills_to_learn)
        ? roadmap.skills_to_learn.map((s: { skill?: string; reason?: string }) => ({
            skill: s.skill ?? 'Untitled skill',
            reason: s.reason ?? '',
          }))
        : [],
      checklist_30_days: Array.isArray(roadmap.checklist_30_days)
        ? roadmap.checklist_30_days.map((c: { task?: string }, i: number) => ({
            task: c.task ?? `Day ${i + 1} task`,
            done: false,
          }))
        : [],
      skill_gap_summary: roadmap.skill_gap_summary ?? 'Not provided',
    };

    return json({ ...normalized, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('generate-roadmap error:', err instanceof Error ? err.message : err);
    return json({ error: friendlyEdgeError(err) }, 500);
  }
});
