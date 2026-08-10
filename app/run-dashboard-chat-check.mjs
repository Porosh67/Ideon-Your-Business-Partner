// Build + Playwright UI smoke for the dashboard "Hi" reply after the
// assistant-chat fix. Authenticates via the Supabase auth API (not the /auth
// UI), seeds localStorage, opens /dashboard, types "Hi", and intercepts the
// /assistant-chat response to confirm timing + reply. Captures a screenshot
// of whatever the DOM shows.

import { spawn, execSync } from 'node:child_process';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnh5emZheG5ubGV0cm9zZ2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODgzODEsImV4cCI6MjEwMTU2NDM4MX0.eY7RtvgCiqi8eBx89Z1BpH7mZJhFUhPhnqcRh-x7Mj4';
const SUPABASE_URL = 'https://wgfxyzfaxnnletrosgcb.supabase.co';
const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';

// ── 1. Authenticate via the API ───────────────────────────────────────────-
const email = `ideon-perftest-${Date.now()}@example.com`;
const password = 'PerfTest!2025';
console.log('Creating user', email);

let session;
const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
  body: JSON.stringify({
    email, password,
    data: { full_name: 'Perf Test', username: `perftest${Date.now()}` },
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
    expires_at: signupData.expires_at ?? Math.floor(Date.now()/1000) + 3600,
    refresh_token: signupData.refresh_token ?? 'fake-refresh',
    user: signupData.user,
  };
} else {
  const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const signinText = await signinRes.text();
  if (!signinRes.ok) {
    console.log('sign-in error:', signinText.slice(0, 500));
    process.exit(2);
  }
  const sj = JSON.parse(signinText);
  session = {
    access_token: sj.access_token,
    token_type: sj.token_type ?? 'bearer',
    expires_in: sj.expires_in ?? 3600,
    expires_at: sj.expires_at ?? Math.floor(Date.now()/1000) + 3600,
    refresh_token: sj.refresh_token ?? 'fake-refresh',
    user: sj.user,
  };
}
console.log('Signed in user', session.user.id);

// ── 2. Build, then start preview server ────────────────────────────────────
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

const server = spawn('npm', ['run', 'preview', '--', '--port', '4174', '--strictPort'], {
  cwd: '/app',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d.toString()));
server.stderr.on('data', (d) => (serverOut += d.toString()));

const waitForServer = async (timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://localhost:4174/');
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const ready = await waitForServer(30000);
console.log('server ready:', ready);
if (!ready) {
  console.log('SERVER LOG:\n' + serverOut);
  server.kill('SIGKILL');
  process.exit(1);
}

// ── 3. Browser test ────────────────────────────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ' — ' + extra : ''));
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // Capture console + network for debugging.
  const consoleLogs = [];
  page.on('pageerror', (e) => consoleLogs.push('PAGE_ERROR: ' + String(e)));
  page.on('console', (msg) => {
    if (msg.type() !== 'log') consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  let responseInfo = null;
  let requestStart = 0;
  page.on('request', (req) => {
    if (req.url().includes('/functions/v1/assistant-chat') && req.method() === 'POST') {
      requestStart = Date.now();
      consoleLogs.push(`REQUEST ${req.url()} ${req.method()}`);
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/functions/v1/assistant-chat') && res.request().method() === 'POST') {
      const dt = Date.now() - requestStart;
      let body = '';
      try { body = (await res.text()).slice(0, 400); } catch {}
      responseInfo = { status: res.status(), elapsed: dt, body };
      consoleLogs.push(`RESPONSE ${res.status()} ${dt}ms: ${body}`);
    }
  });

  // Seed localStorage with the JWT BEFORE any app code runs.
  await page.addInitScript(
    ({ key, sessionData }) => {
      try { localStorage.setItem(key, JSON.stringify(sessionData)); } catch {}
    },
    { key: STORAGE_KEY, sessionData: session }
  );

  await page.goto('http://localhost:4174/dashboard', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  check('on /dashboard', page.url().includes('/dashboard'));

  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 12_000 });
  check('chat composer visible', await composer.isVisible());

  console.log('Typing Hi…');
  await composer.fill('Hi');

  const tSend = Date.now();
  await composer.press('Enter');

  const userBubble = page.locator('text=Hi').first();
  await userBubble.waitFor({ state: 'visible', timeout: 10_000 });
  const dtUser = Date.now() - tSend;
  check('user bubble appeared', await userBubble.isVisible(), `dt=${dtUser}ms`);

  // Wait for the assistant-chat response (network-side).
  const responseDeadline = Date.now() + 30_000;
  while (!responseInfo && Date.now() < responseDeadline) {
    await page.waitForTimeout(300);
  }
  if (responseInfo) {
    check('assistant-chat HTTP responded', responseInfo.status === 200, `${responseInfo.status} in ${responseInfo.elapsed}ms`);
    let parsed = null;
    try { parsed = JSON.parse(responseInfo.body); } catch {}
    const replyOk = parsed && typeof parsed.reply === 'string' && parsed.reply.length > 20;
    check('assistant-chat reply has content', replyOk, parsed ? `reply.${(parsed.reply || '').length} chars, category=${parsed.category}` : 'not parseable');
  } else {
    check('assistant-chat HTTP responded', false, 'no response in 30s');
  }

  // Wait up to 60s for the DOM to show assistant message; save DOM excerpts.
  const domSamples = [];
  const renderDeadline = Date.now() + 60_000;
  while (Date.now() < renderDeadline) {
    const sample = await page.evaluate(() => {
      // ChatMessageRow renders as `<div class="mx-auto my-3 flex w-full max-w-3xl animate-message-in flex-col group/chatrow">`.
      // The inner bubble div is the actual content carrier; collect textContent
      // of every chatrow while filtering out the local user "Hi" bubble.
      const rows = document.querySelectorAll('.group\\/chatrow');
      const rowTexts = [];
      for (const row of rows) {
        const t = (row.textContent || '').trim();
        if (t.length > 0) rowTexts.push(t.slice(0, 400));
      }
      const innerTexts = (document.body.innerText || '').slice(0, 5000);
      const typingMatch = innerTexts.match(/Ideon is thinking/i);
      const errorMatch = innerTexts.match(/couldn[’']t process that—? try again/i)
        || innerTexts.match(/We couldn[’']t process/i);
      const startingFresh = innerTexts.match(/It looks like we[’']re starting fresh/i)
        || innerTexts.match(/How can I assist you today/i);
      return {
        rowCount: rows.length,
        rowTexts,
        typing: typingMatch ? 'typing' : 'idle',
        hasError: !!errorMatch,
        hasReply: !!startingFresh,
        bodyTextSample: innerTexts.slice(0, 600),
      };
    });
    domSamples.push({ dt: Date.now() - tSend, ...sample });
    if (sample.rowCount >= 2 || sample.hasReply || sample.hasError) {
      break;
    }
    await page.waitForTimeout(1200);
  }

  const lastSample = domSamples[domSamples.length - 1] ?? null;
  const everHadSecondRow = domSamples.some((s) => s.rowCount >= 2 || s.hasReply);
  console.log('DOM sample count:', domSamples.length);
  console.log('last sample:', JSON.stringify(lastSample, null, 2));

  check('AI reply bubble rendered in DOM', everHadSecondRow,
    lastSample ? `rows=${lastSample.rowCount} hasReply=${lastSample.hasReply} hasError=${lastSample.hasError}` : 'no sample');
  check('no error UI ("couldn’t process that")', !lastSample?.hasError, `hasError=${lastSample?.hasError}`);
  if (lastSample && lastSample.dt) {
    check('AI reply rendered within 30s', lastSample.dt <= 30_000, `dt=${lastSample.dt}ms, rows=${lastSample.rowCount}`);
  }

  await page.screenshot({ path: '/tmp/dashboard-hi.png', fullPage: true });
  console.log('screenshot: /tmp/dashboard-hi.png');
  console.log('--- console / page errors ---');
  for (const l of consoleLogs) console.log('  ' + l);

  await ctx.close();
} catch (e) {
  console.log('TEST ERROR:', e.message);
  console.log(e.stack);
  results.push({ name: 'no exceptions', ok: false });
} finally {
  await browser.close();
}

server.kill('SIGKILL');
try { execSync('pkill -f "vite preview"'); } catch {}

const failed = results.filter((r) => !r.ok);
console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
