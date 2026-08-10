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

function getToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
}

// ─────────────────────────────────────────────────────────────
// Groq helpers (llama-3.3-70b-versatile — fast, conversational)
// ─────────────────────────────────────────────────────────────
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function groqJson(apiKey: string, systemPrompt: string, userPrompt: string, maxTokens = 200) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
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

async function groqChat(
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens = 1024,
  temperature = 0.7
) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages,
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

// ─────────────────────────────────────────────────────────────
// Call the deployed pipeline functions (server-to-server with the
// caller's token, so every function re-verifies the same JWT)
// ─────────────────────────────────────────────────────────────
async function callPipeline(token: string, name: string, body: Record<string, unknown>) {
  const url = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `${name} failed (${res.status})`);
  }
  return data;
}

/** Best-effort live web search via the web-search edge function. */
async function webSearch(token: string, query: string) {
  try {
    return await callPipeline(token, 'web-search', { query });
  } catch (err) {
    console.error('web-search failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort semantic memory write. Never throws into the caller flow. */
async function storeMemory(token: string, payload: Record<string, unknown>) {
  try {
    await callPipeline(token, 'semantic-memory', { action: 'store', ...payload });
  } catch (err) {
    console.error('semantic-memory store failed:', err instanceof Error ? err.message : err);
  }
}

/** Best-effort semantic memory search. Returns results array or null. */
async function searchMemory(token: string, query: string, limit = 4, sourceType?: string) {
  try {
    const data = await callPipeline(token, 'semantic-memory', { action: 'search', query, limit, source_type: sourceType });
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    console.error('semantic-memory search failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort search of uploaded-document embeddings (source_type 'document'). */
async function searchDocuments(token: string, query: string, limit = 4) {
  return searchMemory(token, query, limit, 'document');
}

// ─────────────────────────────────────────────────────────────
// Fetch an idea's full plan + research so follow-ups have context
// ─────────────────────────────────────────────────────────────
async function fetchIdeaContext(token: string, userId: string, ideaId: string) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: idea } = await supabase
    .from('business_ideas')
    .select('*')
    .eq('id', ideaId)
    .eq('user_id', userId)
    .single();

  if (!idea) return null;

  const { data: plan } = await supabase
    .from('business_plans')
    .select('*')
    .eq('idea_id', ideaId)
    .eq('user_id', userId)
    .single();

  let roadmap = null;
  if (plan) {
    const { data: rd } = await supabase
      .from('generated_roadmaps')
      .select('*')
      .eq('plan_id', (plan as { id: string }).id)
      .eq('user_id', userId)
      .single();
    roadmap = rd;
  }

  return { idea, plan, roadmap };
}

// ─────────────────────────────────────────────────────────────
// Phase handlers
// ─────────────────────────────────────────────────────────────

/**
 * Fast routing call: A = full business idea, B = idea request, C = other.
 * Also emits routing flags for the reply phase:
 *  - needs_web: the latest message needs CURRENT/real-time information.
 *  - needs_memory: the latest message LOOSELY references past saved work.
 *  - search_query: a concise web-search query when needs_web is true.
 */
async function handleClassify(apiKey: string, message: string, history: { role: string; content: string }[]) {
  const recent = history.slice(-10);
  const historyStr = recent
    .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
    .join('\n');

  const system =
    'You are the routing layer of a business-idea assistant. Classify the USER\'S LATEST MESSAGE into exactly ONE category:\n\n' +
    'A — TRIGGER THE FULL REPORT ENGINE (research → business plan → roadmap → competitor analysis). Use A when the message contains ANY of:\n' +
    '  • A concrete business idea the user wants researched and developed (e.g. "a meal-prep service for busy professionals in city centers", "an AI-powered tutoring app for high school students").\n' +
    '  • A request for a BUSINESS PLAN, startup strategy, execution roadmap, or market research — even if the specific idea still needs to be generated (e.g. "give me a startup idea with total market details", "create a business plan for a fintech app", "research the pet-care market and give me a strategy", "I want a complete plan for a D2C skincare brand", "build me a go-to-market strategy for a SaaS tool"). When the user explicitly asks for a plan, strategy, roadmap, or market details, treat the WHOLE request as category A — extract or infer the core idea for idea_text.\n' +
    '  • The user picks or refines one of the assistant\'s previously suggested ideas (e.g. "let\'s go with #2", "I like the meal-prep one", "the healthcare one sounds good") — extract the chosen idea into idea_text.\n' +
    '  • A request that combines idea generation WITH a request for detailed analysis (e.g. "give me a startup idea and total market details", "suggest a business idea and give me the full competitive landscape"). Treat these as A — use the most likely startup concept from the industry mentioned as idea_text.\n\n' +
    'B — AN IDEA REQUEST (suggestions only, NO plan/research): the user wants business idea suggestions but is NOT asking for a full plan, strategy, or market research (e.g. "give me some business ideas about the stock market", "suggest something in healthcare", "what are some good startup ideas for 2025").\n\n' +
    'C — ANYTHING ELSE: general questions, small talk, follow-up questions about an existing plan, or topics unrelated to starting a new venture (e.g. "explain the pricing strategy more", "what\'s the weather today", "tell me about today\'s stock market").\n\n' +
    'IMPORTANT TIE-BREAKER: When in doubt between A and B, choose A. The full report engine gives the user a much richer experience with market research, competitor analysis, and a 30-day roadmap. Only choose B when the user clearly wants ONLY idea suggestions with no plan or research.\n\n' +
    'Also return three routing flags:\n' +
    '- needs_web: TRUE only when the latest message asks for CURRENT, REAL-TIME, or time-sensitive information a static model cannot know (e.g. "today\'s stock market", "latest AI news", "current price of X", "what happened this week", "who is the CEO now", "trending right now"). FALSE for timeless or general questions.\n' +
    '- needs_memory: TRUE only when the latest message LOOSELY references the user\'s PAST ideas, plans, conversations, or check-ins without an explicit idea link (e.g. "that meal-prep idea I mentioned earlier", "what did I ask about dog grooming?", "remind me about the plan we made", "the app idea from before"). FALSE for new, self-contained topics.\n' +
    '- search_query: a short web-search query (max 8 words) that would find the real-time answer — ONLY when needs_web is true; otherwise null.\n\n' +
    'Respond ONLY with JSON: {"category": "A" | "B" | "C", "idea_text": string | null, "needs_web": boolean, "needs_memory": boolean, "search_query": string | null}. ' +
    'Set idea_text to the concrete idea. For A: extract the specific venture/product from the message (if the user says "give me a startup idea in fintech with market details", set idea_text to something like "a fintech startup idea with full market research"). ' +
    'Set idea_text to null for B and C.';

  const userPrompt =
    `CONVERSATION SO FAR:\n${historyStr}\n\n` +
    `LATEST USER MESSAGE:\n${message}\n\n` +
    'Classify the latest message now.';

  const result = await groqJson(apiKey, system, userPrompt, 260);
  const category = (result?.category ?? '').toString().toUpperCase();
  if (!['A', 'B', 'C'].includes(category)) {
    return { category: 'C' as const, idea_text: null, needs_web: false, needs_memory: false, search_query: null };
  }
  const ideaText = category === 'A' ? ((result?.idea_text ?? '').toString().trim() || message) : null;
  const needsWeb = result?.needs_web === true;
  const needsMemory = result?.needs_memory === true;
  const searchQuery = needsWeb
    ? ((result?.search_query ?? '').toString().trim().slice(0, 300) || message.slice(0, 300))
    : null;

  return {
    category: category as 'A' | 'B' | 'C',
    idea_text: ideaText,
    needs_web: needsWeb,
    needs_memory: needsMemory,
    search_query: searchQuery,
  };
}

/** Stage 1 of the full pipeline — live market research. */
async function handleResearch(token: string, ideaText: string) {
  const research = await callPipeline(token, 'research-market', { idea_text: ideaText });
  return { research };
}

/** Stage 2 of the full pipeline — plan + roadmap, then persist everything. */
async function handlePlan(
  token: string,
  user: { id: string },
  apiKey: string,
  ideaText: string,
  research: unknown,
  conversationId?: string
) {
  const plan = await callPipeline(token, 'generate-plan', {
    idea_text: ideaText,
    research_data: research,
  });
  // Run roadmap generation and reality check in parallel for zero added latency
  const [roadmap, realityResult] = await Promise.all([
    callPipeline(token, 'generate-roadmap', { business_plan: plan }),
    handleRealityCheck(apiKey, ideaText, research, plan as Record<string, unknown>),
  ]);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSupabaseKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let ideaId: string | null = null;

  try {
    const { data: ideaRow } = await supabase
      .from('business_ideas')
      .insert({ user_id: user.id, idea_text: ideaText })
      .select('id')
      .single();

    if (ideaRow) {
      ideaId = (ideaRow as { id: string }).id;
      const { data: planRow } = await supabase
        .from('business_plans')
        .insert({
          idea_id: ideaId,
          user_id: user.id,
          target_customer: plan.target_customer ?? null,
          cost_estimate: plan.cost_estimate ?? null,
          competitor_summary: plan.competitor_summary ?? [],
          first_steps: plan.first_steps ?? [],
          raw_research_data: research,
          reality_check: realityResult.reality_check ?? null,
          competitor_snapshot: realityResult.competitor_snapshot ?? null,
        })
        .select('id')
        .single();

      if (planRow) {
        await supabase.from('generated_roadmaps').insert({
          plan_id: (planRow as { id: string }).id,
          user_id: user.id,
          skills_to_learn: roadmap.skills_to_learn ?? [],
          checklist_30_days: roadmap.checklist_30_days ?? [],
          skill_gap_summary: roadmap.skill_gap_summary ?? '',
        });
      }
    }

    if (conversationId) {
      await supabase
        .from('conversations')
        .update({ idea_id: ideaId })
        .eq('id', conversationId)
        .eq('user_id', user.id);
    }
  } catch {
    // Persistence is best-effort — still return the results to the user
  }

  // ── Semantic memory: index the saved idea + conversation (best-effort) ──
  if (ideaId) {
    const ideaContent = [
      `IDEA: ${ideaText}`,
      plan.target_customer ? `TARGET CUSTOMER: ${plan.target_customer}` : null,
      plan.cost_estimate ? `COST ESTIMATE: ${plan.cost_estimate}` : null,
      Array.isArray(plan.competitor_summary) && plan.competitor_summary.length > 0
        ? `COMPETITORS: ${plan.competitor_summary.map((c: { name?: string }) => c?.name ?? '').filter(Boolean).join(', ')}`
        : null,
      Array.isArray(plan.first_steps) && plan.first_steps.length > 0
        ? `FIRST STEPS: ${plan.first_steps.map((s: { title?: string }) => s?.title ?? '').filter(Boolean).join(', ')}`
        : null,
      roadmap.skill_gap_summary ? `SKILL GAP: ${roadmap.skill_gap_summary}` : null,
    ]
      .filter((s): s is string => Boolean(s && s.length > 3))
      .join('\n');
    await storeMemory(token, { source_type: 'idea', source_id: ideaId, content: ideaContent });
  }
  if (conversationId) {
    await storeMemory(token, {
      source_type: 'conversation',
      source_id: conversationId,
      content: `CONVERSATION ABOUT: ${ideaText.slice(0, 300)}`,
    });
  }

  // Friendly summary for the chat
  const summary = await groqChat(
    apiKey,
    [
      {
        role: 'system',
        content:
          'You are a friendly startup coach. Write a SHORT conversational message (2-4 sentences) telling the founder their researched plan is ready. ' +
          'Mention the idea, the target customer, and the rough cost estimate, and note that a 30-day roadmap with skills to learn was also generated. ' +
          'Warm and encouraging, not salesy. No markdown, no bullet lists.',
      },
      {
        role: 'user',
        content:
          `IDEA: ${ideaText}\n` +
          `TARGET CUSTOMER: ${plan.target_customer ?? 'n/a'}\n` +
          `COST ESTIMATE: ${plan.cost_estimate ?? 'n/a'}`,
      },
    ],
    320,
    0.7
  );

  const replyWithPill = summary + '\n\n📊 Full business plan and market breakdown generated and saved to your Reports section.';
  return { phase: 'plan' as const, idea_id: ideaId, plan, roadmap, reply: replyWithPill, reality_check: realityResult.reality_check, competitor_snapshot: realityResult.competitor_snapshot };
}


/**
 * Premium Feature: Generate a Market Reality Check + Competitor Snapshot
 * from the research data and plan. Runs in parallel with roadmap generation
 * so it adds zero latency to the pipeline.
 */
async function handleRealityCheck(
  apiKey: string,
  ideaText: string,
  research: unknown,
  plan: Record<string, unknown>
) {
  const researchSnippet = JSON.stringify(research).slice(0, 6000);
  const planSnippet = JSON.stringify({
    target_customer: plan.target_customer,
    cost_estimate: plan.cost_estimate,
    competitor_summary: plan.competitor_summary,
    first_steps: plan.first_steps,
  }).slice(0, 3000);

  const system =
    'You are a senior startup analyst. Given a business idea, live market research, and a generated plan, ' +
    'produce TWO outputs as JSON:\n\n' +
    '1. "reality_check": a Market Reality Check with scores (1-10) for demand, competition, and execution difficulty. ' +
    'Each score must include a "label" (Low/Medium/High mapped from the score: 1-3=Low, 4-6=Medium, 7-10=High for competition/execution; ' +
    '1-3=Low, 4-6=Medium, 7-10=High for demand) and a one-line "reason" grounded in the research. ' +
    'Also include "worth_pursuing" with a verdict ("Yes"/"Maybe"/"No") and a one-line reason.\n\n' +
    '2. "competitor_snapshot": an array of 2-4 real competitors found in the research. Each must have:\n' +
    '   - "name": the company/product name\n' +
    '   - "pricing": a pricing signal from the research, or "Not publicly clear" if unknown\n' +
    '   - "difference": one line explaining how they differ from the user\'s idea\n\n' +
    'CRITICAL: Only include competitors that are ACTUALLY mentioned in the research data. ' +
    'If the research does not contain clear competitor information, return an empty array for competitor_snapshot. ' +
    'Do NOT invent or hallucinate competitors.\n\n' +
    'Respond ONLY with valid JSON: {"reality_check": {...}, "competitor_snapshot": [...]}';

  const userPrompt =
    `BUSINESS IDEA:\n${ideaText}\n\n` +
    `LIVE MARKET RESEARCH:\n${researchSnippet}\n\n` +
    `GENERATED PLAN:\n${planSnippet}\n\n` +
    'Generate the reality check and competitor snapshot now.';

  try {
    const result = await groqJson(apiKey, system, userPrompt, 800);

    // Normalize reality_check
    const rc = result?.reality_check;
    const normalizeScore = (obj: Record<string, unknown> | undefined, defaultReason: string) => {
      if (!obj || typeof obj !== 'object') {
        return { score: 5, label: 'Medium' as const, reason: defaultReason };
      }
      const score = Math.max(1, Math.min(10, Number(obj.score) || 5));
      let label: 'Low' | 'Medium' | 'High';
      if (score <= 3) label = 'Low';
      else if (score <= 6) label = 'Medium';
      else label = 'High';
      return {
        score,
        label,
        reason: (obj.reason ?? defaultReason).toString().slice(0, 200),
      };
    };

    const realityCheck = {
      demand: normalizeScore(rc?.demand as Record<string, unknown> | undefined, 'Based on available market signals'),
      competition: normalizeScore(rc?.competition as Record<string, unknown> | undefined, 'Based on competitive landscape'),
      execution: normalizeScore(rc?.execution as Record<string, unknown> | undefined, 'Based on technical and operational complexity'),
      worth_pursuing: (() => {
        const wp = rc?.worth_pursuing as Record<string, unknown> | undefined;
        const verdict = (wp?.verdict ?? 'Maybe').toString();
        const validVerdict = ['Yes', 'Maybe', 'No'].includes(verdict) ? verdict as 'Yes' | 'Maybe' | 'No' : 'Maybe';
        return {
          verdict: validVerdict,
          reason: (wp?.reason ?? 'Based on overall market assessment').toString().slice(0, 200),
        };
      })(),
    };

    // Normalize competitor_snapshot
    const rawSnapshot = Array.isArray(result?.competitor_snapshot) ? result.competitor_snapshot : [];
    const competitorSnapshot = rawSnapshot
      .slice(0, 4)
      .filter((c: unknown) => c && typeof c === 'object' && (c as Record<string, unknown>).name)
      .map((c: unknown) => {
        const obj = c as Record<string, unknown>;
        return {
          name: (obj.name ?? '').toString().slice(0, 100),
          pricing: (obj.pricing ?? 'Not publicly clear').toString().slice(0, 150),
          difference: (obj.difference ?? '').toString().slice(0, 200),
        };
      });

    return { reality_check: realityCheck, competitor_snapshot: competitorSnapshot };
  } catch (err) {
    console.error('handleRealityCheck failed:', err instanceof Error ? err.message : err);
    // Return null on failure — the premium features are best-effort
    return { reality_check: null, competitor_snapshot: null };
  }
}

// ─────────────────────────────────────────────────────────────
// Response-length intelligence (Part F).
//
// Rather than hard-coding one length, we judge the QUESTION and tell the
// model which register to use:
//   CONCISE   — simple factual question / quick clarification → 2-4 sentences.
//   BALANCED  — ordinary conversational message → 1-3 short paragraphs.
//   THOROUGH  — "explain / why / strategy / detail" → full, structured answer.
// The model makes the final call; the guidance just sets the register.
// ─────────────────────────────────────────────────────────────
type LengthLevel = 'CONCISE' | 'BALANCED' | 'THOROUGH';

function detectLengthLevel(message: string): LengthLevel {
  const m = message.trim().toLowerCase();
  const shortGreeting =
    /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|sure|yes|no|great|good|who are you|what can you do|how are you|help)\b/.test(m);
  if (shortGreeting || m.length < 25) return 'CONCISE';
  const wantsDepth =
    /(explain|why|how (does|do|would|could|should|can)|strategy|detail|walk me through|tell me more|compare|break down|in depth|in-depth|analyse|analyze|recommend|justify|reasoning|deep dive|what should i|elaborate|dive into|describe|considerations|factors|pros and cons|trade-?offs)/.test(m);
  if (wantsDepth) return 'THOROUGH';
  return 'BALANCED';
}

const LENGTH_GUIDANCE: Record<LengthLevel, string> = {
  CONCISE:
    'LENGTH: This is a simple or quick question — answer CONCISELY. Give the direct answer in 2-4 sentences max. No preamble, no recap of the question, no filler. Only elaborate if the user explicitly asks.',
  BALANCED:
    'LENGTH: Match the depth to the question — brief for simple questions, a bit fuller for substantive ones. Aim for 1-3 short paragraphs; never pad beyond what the question warrants.',
  THOROUGH:
    'LENGTH: This question asks for explanation, reasoning, or detail — give a FULL, thorough answer. 3-5 short paragraphs with structured reasoning, concrete examples, and specifics from any provided context. Do not cut substance short for brevity.',
};

/**
 * Category B (suggest ideas) or C (steer back / answer with context).
 * For C, optionally grounds the answer in LIVE web search results
 * (needs_web) and/or the user's PAST saved work (needs_memory).
 */
async function handleReply(
  apiKey: string,
  category: 'B' | 'C',
  message: string,
  history: { role: string; content: string }[],
  opts: {
    ideaId?: string;
    token?: string;
    userId?: string;
    needsWeb?: boolean;
    needsMemory?: boolean;
    searchQuery?: string | null;
    conversationId?: string;
  } = {}
) {
  const { ideaId, token, userId, needsWeb = false, needsMemory = false, searchQuery = null, conversationId } = opts;
  const recent = history.slice(-20);
  const historyStr = recent
    .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
    .join('\n');

  // Follow-up context: if the conversation is linked to an idea, pull its plan + research
  let contextBlock = '';
  if (ideaId && token && userId) {
    try {
      const ctx = await fetchIdeaContext(token, userId, ideaId);
      if (ctx) contextBlock = JSON.stringify(ctx, null, 2).slice(0, 12000);
    } catch {
      // context is optional
    }
  }

  // ── Real-time web research (category C questions needing current info) ──
  let webBlock = '';
  if (needsWeb && token) {
    const query = (searchQuery ?? message).trim();
    const search = await webSearch(token, query);
    const organic = Array.isArray(search?.organic) ? (search.organic as Record<string, unknown>[]) : [];
    if (organic.length > 0) {
      webBlock =
        'LIVE WEB SEARCH RESULTS (use these for current facts — answer from them, cite the sources):\n' +
        organic
          .slice(0, 6)
          .map((r, i) => {
            const title = (r.title ?? 'Untitled').toString();
            const desc = (r.description ?? '').toString();
            const source = (r.source ?? r.link ?? 'n/a').toString();
            return `${i + 1}. ${title}\n   ${desc}\n   Source: ${source}`;
          })
          .join('\n\n');
    }
  }

  // ── Semantic memory (follow-up loosely referencing past work) ──
  let memoryBlock = '';
  if (needsMemory && token) {
    const results = await searchMemory(token, message, 4);
    if (results && results.length > 0) {
      memoryBlock =
        'RELEVANT PAST WORK FROM THIS USER (semantic search results — use these if they match what the user is referring to):\n' +
        (results as { source_type?: string; content?: string }[])
          .map((r, i) => {
            const label = r?.source_type === 'idea' ? 'saved idea/plan' : 'past conversation';
            return `${i + 1}. [${label}] ${r?.content ?? ''}`;
          })
          .join('\n\n');
    }
  }

  // ── Uploaded-document context (step 5): follow-up questions that reference
  //    a previously uploaded document get the most relevant embedded chunks.
  //    Always run (even without needs_memory) so "what did my document say…"
  //    retrieves the right content via semantic similarity.
  let documentBlock = '';
  if (token) {
    try {
      const docResults = await searchDocuments(token, message, 4);
      if (docResults && docResults.length > 0) {
        documentBlock =
          'RELEVANT EXCERPTS FROM DOCUMENTS THIS USER UPLOADED (semantic search results — ' +
          'use these to answer questions about their uploaded files; if the user is asking ' +
          'about a document, quote/reference the actual content below):\n' +
          (docResults as { content?: string; source_id?: string }[])
            .map((r, i) => `${i + 1}. ${r?.content ?? ''}`)
            .join('\n\n');
      }
    } catch {
      // document retrieval is best-effort
    }
  }

  // ── Store a conversation memory once the thread has started (best-effort) ──
  if (conversationId && token) {
    const firstUserMsg = recent.find((h) => h.role === 'user')?.content ?? message;
    await storeMemory(token, {
      source_type: 'conversation',
      source_id: conversationId,
      content: `CONVERSATION: ${firstUserMsg.slice(0, 300)}`,
    });
  }

  const lengthNote = LENGTH_GUIDANCE[detectLengthLevel(message)];

  // Category B always asks for 2-3 concrete ideas — pin BALANCED so the
  // length guidance never collapses the suggestion list.
  const baseSystem = category === 'B'
    ? 'You are the friendly assistant of Ideon, a business-idea app. Keep responses warm, structured and genuinely useful. No markdown, no bullets unless listing ideas.'
    : documentBlock
      ? 'You are Ideon, an AI business advisor. The founder uploaded documents and is asking about their content. ' +
        'SEMANTIC-SEARCH EXCERPTS FROM THEIR UPLOADED DOCUMENTS are below. Answer their question by referencing the ' +
        'ACTUAL content of those excerpts — quote figures, names, and details as they appear. If the excerpts do not ' +
        'answer the question, say you could not find that in their uploaded documents and offer to help. ' +
        'Conversational tone. No markdown headers.'
      : contextBlock
        ? 'You are an expert business analyst and startup advisor with access to the founder\'s FULL business plan and research (below). ' +
          'Answer their question using that context — be specific and reference details from their plan. Offer practical advice. ' +
          'If the answer is not in the context, say so rather than guessing. Conversational tone. No markdown headers.'
        : webBlock
          ? 'You are Ideon, an AI business advisor. The founder asked a question that needs CURRENT, real-time information. ' +
            'You were given LIVE WEB SEARCH RESULTS below. Answer their question conversationally using ONLY those results — ' +
            'do not invent facts, prices, or figures that are not in the results. Briefly attribute key claims to their sources ' +
            '(e.g. "according to Reuters"). If the results do not answer the question, say so honestly and suggest a better search. ' +
            'Warm and readable. No markdown headers.'
          : memoryBlock
            ? 'You are Ideon, an AI business advisor. The founder is referring to their PAST saved work (ideas, plans, or conversations). ' +
              'Semantic search excerpts from their own data are below. If an excerpt matches what they are referring to, answer using it ' +
              'and reference the details. If none match, say you could not find a past idea matching that description, and offer to help ' +
              'them find it or start fresh. Conversational tone. No markdown headers.'
            : 'You are the friendly assistant of Ideon, a business-idea app. Be warm, helpful and genuinely useful. No markdown, no bullets unless listing ideas. ' +
              'If the message is not a business question, answer briefly, then gently steer back toward business ideas (e.g. "I\'m focused on helping you build business ideas — want to explore a concept instead?"). Never reject harshly — always offer a path forward.';

  const system = `${baseSystem}\n\n${lengthNote}`;

  let userPrompt: string;

  if (category === 'B') {
    const area = message || 'business ideas in general';
    userPrompt =
      'The founder wants business idea suggestions. Generate 2-3 CONCRETE, specific business ideas ' +
      `related to: "${area}".\n` +
      'Each idea must be a specific product/service (not vague). Present them conversationally, numbered ' +
      '(1., 2., 3.), each with one line about who it serves and why it could work. ' +
      'End by asking which one (if any) they would like you to develop into a full researched plan.\n\n' +
      `CONVERSATION SO FAR:\n${historyStr}`;
  } else if (documentBlock) {
    userPrompt =
      `${documentBlock}\n\n` +
      `CONVERSATION SO FAR:\n${historyStr}\n\n` +
      `FOUNDER'S LATEST MESSAGE:\n${message}`;
  } else if (webBlock) {
    userPrompt =
      `${webBlock}\n\n` +
      `CONVERSATION SO FAR:\n${historyStr}\n\n` +
      `FOUNDER'S LATEST MESSAGE:\n${message}\n\n` +
      'Answer the founder\'s question using the live search results above.';
  } else if (memoryBlock) {
    userPrompt =
      `${memoryBlock}\n\n` +
      `CONVERSATION SO FAR:\n${historyStr}\n\n` +
      `FOUNDER'S LATEST MESSAGE:\n${message}`;
  } else if (contextBlock) {
    // Follow-up question inside an idea conversation
    userPrompt =
      `FULL BUSINESS PLAN + RESEARCH CONTEXT:\n${contextBlock}\n\n` +
      `CONVERSATION SO FAR:\n${historyStr}\n\n` +
      `FOUNDER'S LATEST MESSAGE:\n${message}`;
  } else {
    userPrompt =
      'The founder sent a message that is not a business idea. Answer it helpfully, then steer back toward business ideas ' +
      'when it makes sense — but never dismissively.\n\n' +
      `CONVERSATION SO FAR:\n${historyStr}\n\n` +
      `FOUNDER'S LATEST MESSAGE:\n${message}`;
  }

  const reply = await groqChat(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    needsWeb ? 1600 : 1100,
    0.7
  );

  return { phase: 'reply' as const, reply };
}

/**
 * Combined classify + reply fast path (Part C). ONE edge-function call does
 * the routing AND answers the message inline — saving a full network
 * round-trip and a second cold start — whenever no extra data is needed:
 *   - category A (full idea)          → needs research → plan; reply: null
 *   - needs_web                       → needs live web search; reply: null
 *   - needs_memory                    → needs semantic memory lookup; reply: null
 *   - conversation linked to an idea  → needs plan context fetch; reply: null
 * Everything else (category B idea suggestions, plain category C chat) is
 * answered right here in a single call. `timing_ms` reports the server-side
 * latency of this call for performance monitoring.
 */
async function handleCombined(
  apiKey: string,
  message: string,
  history: { role: string; content: string }[],
  opts: { ideaId?: string; token?: string; userId?: string; conversationId?: string }
) {
  const started = performance.now();
  const classified = await handleClassify(apiKey, message, history);

  const canAnswerInline =
    classified.category !== 'A' &&
    !classified.needs_web &&
    !classified.needs_memory &&
    !opts.ideaId;

  if (!canAnswerInline) {
    return {
      phase: 'chat' as const,
      ...classified,
      reply: null,
      timing_ms: Math.round(performance.now() - started),
    };
  }

  const res = await handleReply(apiKey, classified.category, message, history, {
    ...opts,
    needsWeb: classified.needs_web,
    needsMemory: classified.needs_memory,
    searchQuery: classified.search_query,
  });

  return {
    phase: 'chat' as const,
    ...classified,
    reply: res.reply,
    timing_ms: Math.round(performance.now() - started),
  };
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────
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
    const token = getToken(req);

    const body = await req.json();
    const phase = (body?.phase ?? 'classify').toString();
    const message = (body?.message ?? '').toString().trim();
    const history: { role: string; content: string }[] = Array.isArray(body?.history)
      ? body.history.map((h: { role?: string; content?: string }) => ({
          role: h?.role === 'assistant' ? 'assistant' : 'user',
          content: (h?.content ?? '').toString(),
        }))
      : [];
    const conversationId = body?.conversation_id ? (body.conversation_id as string) : undefined;
    const ideaId = body?.idea_id ? (body.idea_id as string) : undefined;

    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      return json({ error: 'GROQ_API_KEY is not configured' }, 500);
    }

    // Only classify, reply and chat require a user message. The research and
    // plan pipeline stages carry idea_text instead (validated inside their cases).
    if ((phase === 'classify' || phase === 'reply' || phase === 'chat') && !message) {
      return json({ error: 'message is required' }, 400);
    }

    switch (phase) {
      case 'classify': {
        const result = await handleClassify(apiKey, message, history);
        return json({ phase: 'classify', ...result });
      }

      // Fast path (Part C): classify + answer in one call when possible.
      case 'chat': {
        const result = await handleCombined(apiKey, message, history, {
          ideaId,
          token,
          userId: user.id,
          conversationId,
        });
        return json(result);
      }

      case 'research': {
        const ideaText = (body?.idea_text ?? '').toString().trim();
        if (ideaText.length < 10) {
          return json({ error: 'idea_text is required (min 10 characters)' }, 400);
        }
        const result = await handleResearch(token, ideaText);
        return json({ phase: 'research', ...result });
      }

      case 'plan': {
        const ideaText = (body?.idea_text ?? '').toString().trim();
        const research = body?.research ?? {};
        if (ideaText.length < 10) {
          return json({ error: 'idea_text is required (min 10 characters)' }, 400);
        }
        const result = await handlePlan(token, user, apiKey, ideaText, research, conversationId);
        return json(result);
      }

      case 'reply': {
        const category = body?.category === 'B' ? 'B' : 'C';
        const needsWeb = body?.needs_web === true;
        const needsMemory = body?.needs_memory === true;
        const searchQuery = body?.search_query ? (body.search_query as string) : null;
        const result = await handleReply(apiKey, category, message, history, {
          ideaId,
          token,
          userId: user.id,
          needsWeb,
          needsMemory,
          searchQuery,
          conversationId,
        });
        return json(result);
      }

      default:
        return json({ error: `Unknown phase: ${phase}` }, 400);
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: errMessage }, 500);
  }
});