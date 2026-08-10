// Build + Playwright UI smoke for the dashboard "Hi" reply after the
// assistant-chat fix. Authenticates via the Supabase auth API (not the /auth
// UI — to avoid the multi-step form dance), seeds the project's
// localStorage auth-token key, opens /dashboard, types "Hi", and asserts
// both the user bubble and the AI reply bubble are visible. Captures a
// screenshot of the conversation.

import { spawn, execSync } from 'node:child_process';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnh5emZheG5ubGV0cm9zZ2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODgzODEsImV4cCI6MjEwMTU2NDM4MX0.eY7RtvgCiqi8eBx89Z1BpH7mZJhFUhPhnqcRh-x7Mj4';
const SUPABASE_URL = 'https://wgfxyzfaxnnletrosgcb.supabase.co';
const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';

// ── 1. Authenticate via the API ───────────────────────────────────────────-
// Sign up a fresh user; signup returns a JWT (auto-confirmed locally) we can
// hydrate the Supabase browser client with. Avoids the multi-step /auth
// form (fullName, username, agreement, etc.) which would slow the test.
const email = `ideon-perftest-${Date.now()}@example.com`;
const password = 'PerfTest!2025';
console.log('Creating user', email);

// Sign-up
let session;
const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
  body: JSON.stringify({
    email,
    password,
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
  // User may already exist; fall back to sign-in.
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
const userId = session.user.id;
console.log('Signed in user', userId);

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
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push('console.error: ' + msg.text());
  });

  // Seed localStorage with the JWT BEFORE any app code runs.
  await page.addInitScript(
    ({ key, sessionData }) => {
      try {
        localStorage.setItem(key, JSON.stringify(sessionData));
      } catch (e) {
        // ignore — landing page isn't on /dashboard anyway
      }
    },
    { key: STORAGE_KEY, sessionData: session }
  );

  await page.goto('http://localhost:4174/dashboard', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  check('on /dashboard', page.url().includes('/dashboard'));

  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 12_000 });
  check('chat composer visible', await composer.isVisible());

  console.log('Typing Hi…');
  await composer.fill('Hi');

  const tSend = Date.now();
  // Send — try Enter first.
  await composer.press('Enter');

  // Wait for the user bubble to appear.
  const userBubble = page.locator('text=Hi').first();
  await userBubble.waitFor({ state: 'visible', timeout: 10_000 });
  check('user message bubble visible', await userBubble.isVisible());
  const dtUser = Date.now() - tSend;

  // Wait for an assistant reply — polling DOM for non-tiny text under an
  // assistant attribute, and the typing indicator to clear.
  let replyText = '';
  const replyDeadline = Date.now() + 60_000;
  while (Date.now() < replyDeadline) {
    const typed = await page.evaluate(() => {
      // Look for content authored by the assistant (any of the
      // common data attributes, or by role="assistant").
      const els = document.querySelectorAll('[data-message-role="assistant"], [data-role="assistant"], article[data-role="assistant"]');
      for (const el of els) {
        const t = (el.textContent || '').trim();
        if (t.length > 30 && !/Ideon is thinking/i.test(t)) return t.slice(0, 400);
      }
      // Fallback: any reasonably long <p> outside the composer area.
      const ps = document.querySelectorAll('p, div.prose, div[class*="markdown"]');
      for (const el of ps) {
        const t = (el.textContent || '').trim();
        if (t.length > 30 && !/Ideon is thinking/i.test(t)) return t.slice(0, 400);
      }
      // Last fallback: any element whose text includes question marks and
      // is longer than 30 chars AND is not the composer textarea.
      return '';
    });
    const typingDots = await page.locator('text=/Ideon is thinking/i').count();
    if (typed && typed !== 'Hi' && typingDots === 0) {
      replyText = typed;
      break;
    }
    if (typed && typed !== 'Hi' && typed.length > 60) {
      // Even before typing indicator clears, snapshot as long as we
      // have substantial reply text (it streams in).
      replyText = typed;
    }
    await page.waitForTimeout(800);
  }

  const dtReply = Date.now() - tSend;
  console.log('reply text sample:', replyText.slice(0, 240));
  check('AI reply bubble rendered', replyText.length > 30, `len=${replyText.length}`);
  check('AI reply arrived within 15s', dtReply <= 15_000, `dtReply=${dtReply}ms`);
  check('user bubble timing reasonable', dtUser <= 5000, `dtUser=${dtUser}ms`);
  check('no uncaught page errors', pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '');

  await page.screenshot({ path: '/tmp/dashboard-hi.png', fullPage: true });
  console.log('screenshot: /tmp/dashboard-hi.png');

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
