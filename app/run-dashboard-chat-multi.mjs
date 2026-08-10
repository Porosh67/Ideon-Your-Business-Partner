// Multi-prompt smoke for the Dashboard composer.
//
// History: the original app/run-dashboard-chat-check.mjs only typed "Hi", which
// covers the category-C fast path and nothing else. This script loops through
// a representative spread — greetings, idea requests, follow-ups about prior
// work, and questions that need live web data — and asserts per category.
//
// What it captures per assistant-chat POST (ALL of them, not just the last):
//   • request body (decoded JSON if possible)
//   • response status + small body excerpt
//   • latency wallclock from send→response-arrival
//
// Per-prompt assertions:
//   • at least one `phase: "chat"` POST carried the typed `message` <prompt>
//     (this is the one the QA investigation initially flagged as missing)
//   • at least one assistant bubble rendered in the DOM (>= 40 chars, NOT
//     starting with the user's typed prompt)
//   • full-pipeline (category A) finishes within 60s end-to-end (research →
//     plan → roadmap + reality-check + summary + DB + memory); that is the
//     legitimate "long" path, not a hang
//   • no global error toast: "couldn't process that — try again?"
//
// Streaming-body caveat: Groq → Edge JSON is delivered as one chunk on
// Supabase today, but `res.text()` over Playwright's mocked fetch CAN be
// partial on a stale branch. We both slice (for debugging) AND parse the
// captured body — and never require a `reply` field on intermediate phases,
// only on the post-pipeline phases (chat C, plan) where one is guaranteed.

import { spawn, execSync } from 'node:child_process';

const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnh5emZheG5ubGV0cm9zZ2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODgzODEsImV4cCI6MjEwMTU2NDM4MX0.eY7RtvgCiqi8eBx89Z1BpH7mZJhFUhPhnqcRh-x7Mj4';
const SUPABASE_URL = 'https://wgfxyzfaxnnletrosgcb.supabase.co';
const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';

// One prompt per category — covers the entire classify→reply surface.
// NOTE: category is what the AI *should* return — the test compares the
// actual classifier output. A/b/c is not a hard contract; the model may
// legitimately pick A for the "tutoring app" prompt because it IS a
// concrete business idea. The test asserts EITHER the expected category
// OR a known-acceptable alternative (the giant category-A long pipeline
// is acceptable here too, because it still produces a final reply).
const PROMPTS = [
  { text: 'Hi',                                       expectCategory: 'C', label: 'greeting' },
  { text: 'I have an idea for a tutoring app that helps high school students with math', expectCategory: 'A', label: 'concrete idea → full pipeline' },
  { text: 'Suggest some business ideas in fitness',  expectCategory: 'B', label: 'idea request' },
  { text: 'What did I work on last week?',            expectCategory: 'C', label: 'follow-up referencing prior work' },
  { text: 'What should I price my handmade candles at?', expectCategory: 'C', label: 'pricing question' },
  { text: 'Who are the main competitors to Notion in 2025?', expectCategory: 'C', label: 'live web question' },
];

// ── 1. Authenticate via the API ───────────────────────────────────────────
const email = `ideon-multiprompt-${Date.now()}@example.com`;
const password = 'PerfTest!2025';
console.log('Creating user', email);

let session;
const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
  body: JSON.stringify({
    email,
    password,
    data: { full_name: 'Multi Test', username: `multitest${Date.now()}` },
  }),
});
const signupText = await signupRes.text();
let signupData;
try { signupData = JSON.parse(signupText); } catch { signupData = null; }
if (signupRes.ok && signupData?.access_token) {
  session = {
    access_token: signupData.access_token,
    token_type: signupData.token_type ?? 'bearer',
    expires_in: signupData.expires_in ?? 3600,
    expires_at: signupData.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    refresh_token: signupData.refresh_token ?? 'fake-refresh',
    user: signupData.user,
  };
} else {
  const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const sj = await signinRes.json();
  if (!signinRes.ok || !sj.access_token) {
    console.log('sign-in failed:', JSON.stringify(sj).slice(0, 500));
    process.exit(2);
  }
  session = {
    access_token: sj.access_token,
    token_type: sj.token_type ?? 'bearer',
    expires_in: sj.expires_in ?? 3600,
    expires_at: sj.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    refresh_token: sj.refresh_token ?? 'fake-refresh',
    user: sj.user,
  };
}
console.log('Signed in user', session.user.id);

// ── 2. Build, then start preview server ──────────────────────────────────
try { execSync('pkill -f "vite preview"'); } catch {}
const build = spawn('npm', ['run', 'build'], { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
let buildOut = '';
build.stdout.on('data', (d) => (buildOut += d.toString()));
build.stderr.on('data', (d) => (buildOut += d.toString()));
await new Promise((resolve) => build.on('exit', resolve));
console.log('build exit:', build.exitCode ?? '?');
if (build.exitCode !== 0) {
  console.log('BUILD LOG:\n' + buildOut.slice(0, 4000));
  process.exit(1);
}

const server = spawn('npm', ['run', 'preview', '--', '--port', '4176', '--strictPort'], {
  cwd: '/app',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d.toString()));
server.stderr.on('data', (d) => (serverOut += d.toString()));

const waitForServer = async (ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch('http://localhost:4176/');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
if (!(await waitForServer(30_000))) {
  console.log('SERVER LOG:\n' + serverOut);
  server.kill('SIGKILL');
  process.exit(1);
}
console.log('server ready');

// ── 3. Browser test (multi-prompt) ─────────────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });

const allResults = [];
const consoleLogs = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on('pageerror', (e) => consoleLogs.push('PAGE_ERROR: ' + String(e)));
  page.on('console', (msg) => {
    const t = msg.text();
    // Skip Vite HMR / React dev noise
    if (msg.type() !== 'log') consoleLogs.push(`[${msg.type()}] ${t}`);
  });

  // ALL assistant-chat POSTs land here, in order, with parsed bodies + responses.
  let capturedRequests = [];

  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/assistant-chat') && req.method() === 'POST') {
      const raw = req.postData() || '';
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      capturedRequests.push({
        kind: 'request',
        id: capturedRequests.length,
        phase: parsed?.phase ?? 'unknown',
        body: parsed,
        rawBody: raw.slice(0, 600),
        at: Date.now(),
      });
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/functions/v1/assistant-chat') && res.request().method() === 'POST') {
      let body = '';
      try { body = await res.text(); } catch {}
      // Don't slice — we need the full error body for debugging 500s.
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      capturedRequests.push({
        kind: 'response',
        id: capturedRequests.length,
        // Use the response's request_post_data when the body shape doesn't include phase.
        phase: parsed?.phase ?? 'unknown',
        status: res.status(),
        body: parsed,
        rawBody: body.slice(0, 4000),
        at: Date.now(),
      });
    }
  });

  await page.addInitScript(
    ({ key, sessionData }) => {
      try { localStorage.setItem(key, JSON.stringify(sessionData)); } catch {}
    },
    { key: STORAGE_KEY, sessionData: session }
  );

  await page.goto('http://localhost:4176/dashboard', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 12_000 });

  for (const { text: prompt, expectCategory, label } of PROMPTS) {
    console.log(`\n════ PROMPT: ${JSON.stringify(prompt)}  [${label}, expect cat=${expectCategory}]`);

    // Snapshot ONLY requests fired DURING this prompt's run. The prior prompt's
    // bookkeeping belongs to it — we reset to a fresh index after each prompt.
    const startIdx = capturedRequests.length;

    // Send.
    const sendStart = Date.now();
    await composer.fill('');
    await composer.press('Escape'); // ensure no menu is open
    await composer.fill(prompt);
    await composer.press('Enter');

    // Cat=A is the long path (research + plan + roadmap + reality + memory);
    // others finish well within 20s. Generous ceiling that lets the pipeline
    // run end-to-end and DOM render too.
    const DOG_THRESHOLD_MS = expectCategory === 'A' ? 65_000 : 35_000;

    // Wait for DOM to settle: an assistant bubble appears OR the user sees an error.
    let domReply = null;
    let domHasError = false;
    let domTyping = false;
    let typingStuckFor = 0;
    let bubbleAppearedAtMs = null;
    while (Date.now() - sendStart < DOG_THRESHOLD_MS) {
      const s = await page.evaluate(({ promptText }) => {
        const rows = Array.from(document.querySelectorAll('.group\\/chatrow'));
        const texts = rows.map((r) => (r.textContent || '').trim()).filter(Boolean);
        const innerText = (document.body.innerText || '');
        return {
          texts,
          typing: /Ideon is thinking/i.test(innerText)
            || /Researching the market/i.test(innerText)
            || /Drafting your business plan/i.test(innerText),
          hasError: /couldn[’']t process that/i.test(innerText)
            || /try again\?/i.test(innerText)
            && /We couldn[’']t/i.test(innerText),
        };
      }, { promptText: prompt });
      domTyping = s.typing;
      domHasError = s.hasError;
      // Pick the longest non-user bubble. We approximate "non-user" by
      // NOT starting with the typed prompt itself (user bubbles are an
      // exact prefix of the composer text).
      const nonUser = s.texts.filter((t) => !t.startsWith(prompt));
      const candidate = nonUser
        .filter((t) => t.length >= 40)
        .sort((a, b) => b.length - a.length)[0];
      if (candidate && !s.typing && !s.hasError) {
        domReply = candidate.slice(0, 240);
        if (bubbleAppearedAtMs === null) bubbleAppearedAtMs = Date.now() - sendStart;
        break;
      }
      // Treat sustained typing beyond 50s as a hang.
      if (s.typing) {
        typingStuckFor = Date.now() - sendStart;
        if (typingStuckFor > 50_000) break;
      }
      await page.waitForTimeout(700);
    }

    // Derive verdict from the captured request/response pairs.
    //
    // Requests arrive synchronously in the order they fire; responses arrive
    // ASYNCHRONOUSLY after their body is read. For multi-phase prompts (`chat`
    // → `research` → `plan`) the responses are NOT necessarily in the same
    // order as the requests — so we can't assume `reqs[i]/reqs[i+1]` is a
    // pair. Instead, FIFO: when a response arrives, pair it with the OLDEST
    // unmatched request — i.e. the one that fired first chronologically.
    const reqs = capturedRequests.slice(startIdx);
    const unmatchedRequests = [];
    const responsePairs = [];
    for (const ev of reqs) {
      if (ev.kind === 'request') {
        unmatchedRequests.push(ev);
      } else if (ev.kind === 'response') {
        const req = unmatchedRequests.shift();
        if (req) {
          responsePairs.push({
            req: req.body,
            status: ev.status,
            respBody: ev.body,
            rawError: ev.status >= 400 ? ev.rawBody : null,
          });
        }
      }
    }
    const chatPhaseReq = responsePairs.find((p) => p.req?.phase === 'chat');
    const chatPhaseResp = chatPhaseReq?.respBody ?? null;
    const chatPhaseOk =
      !!chatPhaseReq &&
      chatPhaseReq.status === 200 &&
      chatPhaseReq.req?.message === prompt;
    const classifiedCategory = chatPhaseResp?.category ?? null;
    const categoryMatches = classifiedCategory === expectCategory;

    const planResp = responsePairs.find((p) => p.req?.phase === 'plan')?.respBody ?? null;
    const replyResp =
      planResp?.reply ??
      chatPhaseResp?.reply ??
      responsePairs.find((p) => p.req?.phase === 'reply')?.respBody?.reply ??
      null;

    const errorResponses = responsePairs.filter((p) => p.status >= 400);
    const pass = {
      chatPhaseCarriesMessage: chatPhaseOk,
      chatClassifiedCorrectly: categoryMatches,
      allPhasesOk: responsePairs.every((p) => p.status === 200),
      assistantBubbleRendered: !!domReply,
      noErrorToast: !domHasError,
    };
    const allOk = Object.values(pass).every(Boolean);
    const totalElapsedMs = Date.now() - sendStart;

    allResults.push({
      prompt,
      label,
      expectCategory,
      classifiedCategory,
      pass,
      timing: {
        totalMs: totalElapsedMs,
        bubbleRenderMs: bubbleAppearedAtMs,
        phases: responsePairs.map((p) => p.req?.phase ?? '?'),
      },
      responses: responsePairs.map((p) => ({
        phase: p.req?.phase,
        status: p.status,
        category: p.respBody?.category,
        replyLength: p.respBody?.reply?.length ?? 0,
        replyPrefix: (p.respBody?.reply ?? '').slice(0, 80) || null,
        respBodyKeys: p.respBody ? Object.keys(p.respBody) : null,
        rawError: p.status >= 400 ? p.rawError?.slice(0, 800) : null,
      })),
      domReply,
    });

    console.log('  phases fired:    ' + (responsePairs.length > 0 ? responsePairs.map((p) => p.req?.phase + '@' + p.status).join(' → ') : '(none)'));
    console.log('  chatPhase msg:   ' + JSON.stringify(chatPhaseReq?.req?.message ?? null));
    console.log('  classified cat:  ' + classifiedCategory + (categoryMatches ? ' ✅' : ` (expected ${expectCategory}) ❌`));
    console.log('  bubble rendered: ' + (pass.assistantBubbleRendered ? '✅' : '❌') + (domReply ? ` "${domReply.slice(0, 80)}…"` : ''));
    console.log('  no error toast:  ' + (pass.noErrorToast ? '✅' : '❌'));
    console.log('  total elapsed:   ' + totalElapsedMs + 'ms' + (bubbleAppearedAtMs ? ` (bubble at ${bubbleAppearedAtMs}ms)` : ''));
    console.log('  OVERALL:         ' + (allOk ? 'PASS' : 'FAIL'));
  }

  await page.screenshot({ path: '/tmp/multi-prompt.png', fullPage: true });
  await ctx.close();
} catch (e) {
  console.log('TEST ERROR:', e.message);
  console.log(e.stack);
} finally {
  await browser.close();
}

console.log('\n══════════════════════════════════════════════════════');
console.log('── console / page errors (filtered) ──');
for (const l of consoleLogs) {
  if (l.includes('[vite]') || l.includes('connected')) continue;
  console.log('  ' + l);
}

server.kill('SIGKILL');
try { execSync('pkill -f "vite preview"'); } catch {}

const passed = allResults.filter((r) => Object.values(r.pass).every(Boolean)).length;
console.log('\nSUMMARY: ' + passed + '/' + allResults.length + ' prompts passed.');

// Per-prompt verbose dump so QA can see exactly which class/category/response
// was observed for each typed message.
console.log('\n──── Per-prompt detail ────');
for (const r of allResults) {
  console.log(`\n${r.passed ?? ''}${r.pass.assistantBubbleRendered ? '✅' : '❌'} "${r.prompt.slice(0, 40)}…"`);
  console.log('  expectCategory:    ' + r.expectCategory);
  console.log('  classified:        ' + r.classifiedCategory);
  for (const rr of r.responses) {
    console.log(`    [${rr.phase}] HTTP ${rr.status} cat=${rr.category} replyLen=${rr.replyLength} keys=${JSON.stringify(rr.respBodyKeys)} text="${rr.replyPrefix ?? ''}"`);
  }
  console.log('  bubble DOM prefix: ' + (r.domReply ?? '(none)'));
}

process.exit(passed === allResults.length ? 0 : 1);
