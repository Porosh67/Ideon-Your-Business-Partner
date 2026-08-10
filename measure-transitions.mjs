// Measure the real, end-to-end timing of every branded auth/navigation transition.
// Reports: click→overlay-show, overlay duration (show→hide), click→destination visible,
// plus the app's own console.debug("[transition] … took Xms") lines.
import { spawn } from 'node:child_process';

const BASE = 'http://localhost:5173';

// ── Boot a fresh browser context per flow ───────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const fakeJwt = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: 'qa-fake-user', email: 'qa.fake@example.com', aud: 'authenticated',
    role: 'authenticated', exp: now + 3600, iat: now,
    app_metadata: { provider: 'email' }, user_metadata: { full_name: 'QA Fake' },
  }),
  'fake-sig',
].join('.');
const fakeSession = {
  access_token: fakeJwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
  refresh_token: 'fake-refresh',
  user: {
    id: 'qa-fake-user', aud: 'authenticated', role: 'authenticated', email: 'qa.fake@example.com',
    app_metadata: { provider: 'email' }, user_metadata: { full_name: 'QA Fake' },
    created_at: new Date().toISOString(),
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  p._transitionLogs = [];
  p.on('console', (m) => {
    if (m.text().includes('[transition]')) p._transitionLogs.push(m.text());
  });
  return p;
}

/** Poll for the branded overlay (`role=status` + .transition-overlay). */
async function watchOverlay(page, { pollMs = 15 } = {}) {
  const seen = [];
  let lastVisible = null;
  const iv = setInterval(async () => {
    try {
      const el = page.locator('[role="status"].transition-overlay');
      const visible = await el.count().then((n) => n > 0).catch(() => false);
      const t = performance.now();
      if (visible && lastVisible === false) seen.push({ event: 'show', t });
      if (!visible && lastVisible === true) seen.push({ event: 'hide', t });
      lastVisible = visible;
    } catch {}
  }, pollMs);
  return {
    seen,
    stop: () => clearInterval(iv),
  };
}

async function measure(name, fn) {
  const t0 = performance.now();
  const r = await fn();
  const elapsed = Math.round(performance.now() - t0);
  return { name, ...r, elapsed };
}

// ── A. Landing → Auth ───────────────────────────────────────────────────────
async function landingToAuth() {
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await wait(1200); // let landing settle
  const watcher = await watchOverlay(page);
  const tClick = performance.now();
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  // wait until the auth h1 shows
  const start = performance.now();
  while (performance.now() - start < 5000) {
    const h1 = await page.locator('h1').first().textContent().catch(() => '');
    if (h1.includes('Welcome back')) break;
    await wait(20);
  }
  const tDest = performance.now();
  await wait(350); // let overlay fully dismiss
  watcher.stop();
  const show = watcher.seen.find((e) => e.event === 'show')?.t;
  const hide = watcher.seen.find((e) => e.event === 'hide')?.t;
  const r = {
    clickToOverlay: show ? Math.round(show - tClick) : null,
    overlayDuration: show && hide ? Math.round(hide - show) : null,
    clickToDest: Math.round(tDest - tClick),
    transitionLog: page._transitionLogs[0] ?? null,
  };
  await page.close();
  return r;
}

// ── B. Sign-in → Dashboard (real credentials) ───────────────────────────────
async function signinToDashboard() {
  const page = await newPage();
  await page.goto(BASE + '/auth', { waitUntil: 'load' });
  await wait(1300);
  await page.locator('#email').fill('ideon.qa.one@gmail.com');
  await page.locator('#password').fill('QaPass!234');
  const watcher = await watchOverlay(page);
  const tClick = performance.now();
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  const start = performance.now();
  while (performance.now() - start < 8000) {
    if (page.url().startsWith(BASE + '/dashboard')) break;
    await wait(20);
  }
  const tDest = performance.now();
  await wait(350);
  watcher.stop();
  const show = watcher.seen.find((e) => e.event === 'show')?.t;
  const hide = watcher.seen.find((e) => e.event === 'hide')?.t;
  const r = {
    clickToOverlay: show ? Math.round(show - tClick) : null,
    overlayDuration: show && hide ? Math.round(hide - show) : null,
    clickToDest: Math.round(tDest - tClick),
    transitionLog: page._transitionLogs[0] ?? null,
  };
  await page.close();
  return r;
}

// ── C. Sign-out → Landing (seeded session) ─────────────────────────────────
async function signoutToLanding() {
  const page = await newPage();
  await page.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: STORAGE_KEY, session: fakeSession });
  await page.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) });
  });
  await page.goto(BASE + '/dashboard', { waitUntil: 'load' });
  await wait(1500);
  await page.getByRole('button', { name: 'Profile menu' }).first().click();
  await wait(400);
  const watcher = await watchOverlay(page);
  const tClick = performance.now();
  const signOutBtn = page.getByRole('menuitem', { name: 'Sign out' });
  if ((await signOutBtn.count()) > 0) await signOutBtn.first().click();
  else await page.getByText('Sign out', { exact: true }).last().click();
  const start = performance.now();
  while (performance.now() - start < 8000) {
    const url = page.url().replace(/\/$/, '');
    if (url === BASE) break;
    await wait(20);
  }
  const tDest = performance.now();
  await wait(350);
  watcher.stop();
  const show = watcher.seen.find((e) => e.event === 'show')?.t;
  const hide = watcher.seen.find((e) => e.event === 'hide')?.t;
  const r = {
    clickToOverlay: show ? Math.round(show - tClick) : null,
    overlayDuration: show && hide ? Math.round(hide - show) : null,
    clickToDest: Math.round(tDest - tClick),
    transitionLog: page._transitionLogs[0] ?? null,
  };
  await page.close();
  return r;
}

// ── D. Sign-up → Sign In (same page, unique email) ─────────────────────────
async function signupToSignin() {
  const page = await newPage();
  await page.goto(BASE + '/auth', { waitUntil: 'load' });
  await wait(1300);
  const toggle = page.getByRole('button', { name: 'Create an account' });
  if ((await toggle.count()) > 0) await toggle.click();
  await wait(400);
  const stamp = Date.now().toString(36);
  await page.locator('#fullName').fill(`QA ${stamp}`);
  await page.locator('#username').fill(`qa${stamp}`);
  await page.locator('#email').fill(`ideon.qa.${stamp}@gmail.com`);
  await page.locator('#password').fill('QaPass!234');
  await page.locator('#confirmPassword').fill('QaPass!234');
  const watcher = await watchOverlay(page);
  const tClick = performance.now();
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  const start = performance.now();
  while (performance.now() - start < 8000) {
    const h1 = await page.locator('h1').first().textContent().catch(() => '');
    if (h1.includes('Welcome back')) break;
    await wait(20);
  }
  const tDest = performance.now();
  await wait(350);
  watcher.stop();
  const show = watcher.seen.find((e) => e.event === 'show')?.t;
  const hide = watcher.seen.find((e) => e.event === 'hide')?.t;
  const r = {
    clickToOverlay: show ? Math.round(show - tClick) : null,
    overlayDuration: show && hide ? Math.round(hide - show) : null,
    clickToDest: Math.round(tDest - tClick),
    transitionLog: page._transitionLogs[0] ?? null,
  };
  await page.close();
  return r;
}

// ── E. Guest sign-in → Dashboard ────────────────────────────────────────────
async function guestToDashboard() {
  const page = await newPage();
  await page.goto(BASE + '/auth', { waitUntil: 'load' });
  await wait(1300);
  const watcher = await watchOverlay(page);
  const tClick = performance.now();
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  const start = performance.now();
  while (performance.now() - start < 8000) {
    if (page.url().startsWith(BASE + '/dashboard')) break;
    await wait(20);
  }
  const tDest = performance.now();
  await wait(350);
  watcher.stop();
  const show = watcher.seen.find((e) => e.event === 'show')?.t;
  const hide = watcher.seen.find((e) => e.event === 'hide')?.t;
  const r = {
    clickToOverlay: show ? Math.round(show - tClick) : null,
    overlayDuration: show && hide ? Math.round(hide - show) : null,
    clickToDest: Math.round(tDest - tClick),
    transitionLog: page._transitionLogs[0] ?? null,
  };
  await page.close();
  return r;
}

// ── Runner ──────────────────────────────────────────────────────────────────
const flows = {
  'A landing→auth': landingToAuth,
  'B signin→dashboard': signinToDashboard,
  'C signout→landing': signoutToLanding,
  'D signup→signin': signupToSignin,
  'E guest→dashboard': guestToDashboard,
};

const reps = process.argv[2] ? parseInt(process.argv[2], 10) : 2;
const summary = {};
for (const [label, fn] of Object.entries(flows)) {
  const rows = [];
  for (let i = 0; i < reps; i++) {
    try {
      rows.push(await measure(label, fn));
    } catch (e) {
      rows.push({ name: label, error: e.message });
    }
  }
  summary[label] = rows;
  console.log(`\n── ${label} ──`);
  for (const r of rows) {
    if (r.error) { console.log('  ERROR:', r.error); continue; }
    console.log(
      `  click→overlay: ${String(r.clickToOverlay).padStart(4)}ms | ` +
      `overlay: ${String(r.overlayDuration).padStart(4)}ms | ` +
      `click→dest: ${String(r.clickToDest).padStart(4)}ms | ${r.transitionLog ?? 'no log'}`
    );
  }
  const ok = rows.filter((r) => !r.error && r.overlayDuration != null);
  if (ok.length) {
    const avg = (k) => Math.round(ok.reduce((s, r) => s + (r[k] ?? 0), 0) / ok.length);
    console.log(`  ── AVG: click→overlay ${avg('clickToOverlay')}ms | overlay ${avg('overlayDuration')}ms | click→dest ${avg('clickToDest')}ms`);
  }
}

await browser.close();
process.exit(0);
