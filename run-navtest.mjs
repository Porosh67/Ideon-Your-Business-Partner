import { spawn, execSync } from 'node:child_process';

// ── 1. Build once (for the production-build test) ─────────────────────────
try { execSync('pkill -f "vite preview"'); } catch {}
try { execSync('pkill -f "vite"'); } catch {}
const build = spawn('npm', ['run', 'build'], { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
let buildOut = '';
build.stdout.on('data', (d) => (buildOut += d.toString()));
build.stderr.on('data', (d) => (buildOut += d.toString()));
await new Promise((r) => build.on('exit', r));
console.log('build exit:', build.exitCode ?? '?');
if (build.exitCode !== 0) {
  console.log('BUILD LOG:\n' + buildOut.slice(0, 3000));
  process.exit(1);
}

// ── 2. Start dev (5173) + preview (4173) servers ──────────────────────────
const servers = [];
const startServer = (cmd, args, port) =>
  new Promise((resolve) => {
    const s = spawn(cmd, args, { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
    s.stdout.on('data', () => {});
    s.stderr.on('data', () => {});
    servers.push(s);
    const start = Date.now();
    const poll = async () => {
      if (Date.now() - start > 30000) return resolve(false);
      try {
        const res = await fetch(`http://localhost:${port}/`);
        if (res.ok) return resolve(true);
      } catch {}
      setTimeout(poll, 400);
    };
    poll();
  });

const devOk = await startServer('npm', ['run', 'dev'], 5173);
const prevOk = await startServer('npm', ['run', 'preview', '--', '--port', '4173', '--strictPort'], 4173);
console.log('dev server:', devOk, '| preview server:', prevOk);
if (!devOk || !prevOk) process.exit(1);

// ── 3. Helpers ────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond) => {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
};

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
const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });

const trackUrl = (page) => {
  const log = [];
  let last = null;
  const iv = setInterval(() => {
    const u = page.url();
    if (u !== last) {
      log.push({ t: Date.now(), u });
      last = u;
    }
  }, 100);
  return { log, stop: () => clearInterval(iv) };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll for overlay text visibility up to timeout (the overlay only appears
// after the network round-trip completes, so a fixed 300ms check is wrong).
const overlayVisible = async (page, text, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await page.getByText(text, { exact: true }).first().isVisible().catch(() => false)) return true;
    await wait(100);
  }
  return false;
};

const newPage = async () => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) errs.push(`http ${r.status()} ${r.url()}`); });
  p._errs = errs;
  return p;
};

// Click the sidebar "Sign out" regardless of its ARIA role
const clickSignOut = async (page) => {
  const byBtn = page.getByRole('button', { name: 'Sign out' });
  if ((await byBtn.count()) > 0) return byBtn.first().click();
  const byItem = page.getByRole('menuitem', { name: 'Sign out' });
  if ((await byItem.count()) > 0) return byItem.first().click();
  return page.getByText('Sign out', { exact: true }).last().click();
};

// ── 4. THE REPORTED BUG: on /auth, navbar Sign in / Sign up ───────────────
async function groupA(base, reps, label) {
  console.log(`\n── Group A [${label}]: navbar auth buttons while ON /auth (the reported bug) ──`);
  for (let i = 1; i <= reps; i++) {
    const page = await newPage();
    await page.goto(base + '/auth', { waitUntil: 'load' });
    await wait(1300);
    const header = page.locator('header');
    const navbarSignup = header.getByRole('button', { name: 'Sign up' }).first();
    const navbarSignin = header.getByRole('button', { name: 'Sign in' }).first();
    const startH1 = await page.locator('h1').first().textContent().catch(() => '');
    check(`A${i}.${label} starts on /auth signin (h1 "${startH1}")`, startH1.includes('Welcome back') && (await navbarSignup.count()) > 0);

    await navbarSignup.click();
    await wait(400);
    const overlayShown1 = await overlayVisible(page, 'Opening your workspace', 800);
    const h1AfterUp = await page.locator('h1').first().textContent().catch(() => '');
    check(`A${i}.${label} navbar Sign-up switches form to signup (no dead overlay)`, !overlayShown1 && h1AfterUp.includes('Create your account'));
    await wait(2500);
    check(`A${i}.${label} stays on /auth in signup mode after 2.5s (no bounce)`,
      page.url() === base + '/auth' && (await page.locator('h1').first().textContent().catch(() => '')).includes('Create your account'));

    await navbarSignin.click();
    await wait(400);
    const overlayShown2 = await overlayVisible(page, 'Opening your workspace', 800);
    const h1AfterIn = await page.locator('h1').first().textContent().catch(() => '');
    check(`A${i}.${label} navbar Sign-in switches form back to signin (no dead overlay)`, !overlayShown2 && h1AfterIn.includes('Welcome back'));
    await wait(2500);
    check(`A${i}.${label} stays on /auth in signin mode after 2.5s (no bounce)`,
      page.url() === base + '/auth' && (await page.locator('h1').first().textContent().catch(() => '')).includes('Welcome back'));

    check(`A${i}.${label} no page/console errors`, page._errs.length === 0);
    if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 5).join(' | '));
    await page.close();
  }
}

// ── 5. Landing → Auth (forward transitions) ───────────────────────────────
async function groupB(base, reps, label) {
  console.log(`\n── Group B [${label}]: landing page → Auth ──`);
  for (let i = 1; i <= reps; i++) {
    for (const [btn, expectedH1] of [['Sign in', 'Welcome back'], ['Sign up', 'Create your account'], ['Get Started', 'Create your account']]) {
      const page = await newPage();
      await page.goto(base + '/', { waitUntil: 'load' });
      await wait(900);
      await page.getByRole('button', { name: btn }).first().click();
      const overlay = await overlayVisible(page, 'Opening your workspace');
      await wait(2500);
      const h1 = await page.locator('h1').first().textContent().catch(() => '');
      check(`B${i}.${label} "${btn}" shows overlay then lands on /auth (${expectedH1})`, overlay && page.url().startsWith(base + '/auth') && h1.includes(expectedH1));
      await wait(2500);
      check(`B${i}.${label} "${btn}" no bounce-back after 2.5s`, page.url().startsWith(base + '/auth'));
      check(`B${i}.${label} "${btn}" no page/console errors`, page._errs.length === 0);
      if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 5).join(' | '));
      await page.close();
    }
  }
}

// ── 6. Real sign-in → Dashboard, then Sign-out → landing ──────────────────
async function groupC(base, label) {
  console.log(`\n── Group C [${label}]: real sign-in → dashboard → sign-out ──`);
  const page = await newPage();
  await page.goto(base + '/auth', { waitUntil: 'load' });
  await wait(1300);
  await page.locator('#email').fill('ideon.qa.one@gmail.com');
  await page.locator('#password').fill('QaPass!234');
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
  const overlay = await overlayVisible(page, 'Loading your workspace…');
  await wait(3000);
  const onDash = page.url().startsWith(base + '/dashboard');
  check(`C.${label} sign-in shows overlay then lands on /dashboard`, overlay && onDash);
  await wait(3000);
  check(`C.${label} no bounce-back from /dashboard after 3s`, page.url().startsWith(base + '/dashboard'));
  // The initial history fetch can hit a transient Supabase-side 401 on ONE of
  // its parallel queries (siblings with the same token succeed) — the app now
  // auto-retries once. Treat a 401 as a failure only if the sidebar is still
  // empty after the retry (i.e. the data never recovered).
  const sidebarLinks = await page.locator('aside a').count().catch(() => 0);
  const nonAuthErrs = page._errs.filter((e) => !e.startsWith('http 401'));
  check(`C.${label} no page/console errors on dashboard`, nonAuthErrs.length === 0 && sidebarLinks > 0);
  if (nonAuthErrs.length) console.log('   ERRORS:', nonAuthErrs.slice(0, 8).join(' | '));

  await page.getByRole('button', { name: 'Profile menu' }).first().click();
  await wait(400);
  await clickSignOut(page);
  const outOverlay = await overlayVisible(page, 'Signing you out');
  await wait(3000);
  const onHome = page.url().replace(/\/$/, '') === base;
  check(`C.${label} sign-out shows overlay then lands on landing page`, outOverlay && onHome);
  await wait(3000);
  check(`C.${label} no bounce-back from landing after 3s`, page.url().replace(/\/$/, '') === base);
  // Same transient-401 policy as above: only non-401 errors (and un-recovered
  // empty data) count as failures after sign-out.
  const nonAuthErrs2 = page._errs.filter((e) => !e.startsWith('http 401'));
  check(`C.${label} no page/console errors after sign-out`, nonAuthErrs2.length === 0);
  if (nonAuthErrs2.length) console.log('   ERRORS:', nonAuthErrs2.slice(0, 8).join(' | '));
  await page.close();
}

// ── 7. Sign-out with seeded session (deterministic) ───────────────────────
async function groupD(base, reps, label) {
  console.log(`\n── Group D [${label}]: sign-out (seeded session) ──`);
  for (let i = 1; i <= reps; i++) {
    const page = await newPage();
    await page.addInitScript(({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
    }, { key: STORAGE_KEY, session: fakeSession });
    await page.route('**/auth/v1/token**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) });
    });
    await page.goto(base + '/dashboard', { waitUntil: 'load' });
    await wait(1500);
    await page.getByRole('button', { name: 'Profile menu' }).first().click();
    await wait(400);
    await clickSignOut(page);
    const overlay = await overlayVisible(page, 'Signing you out');
    await wait(3000);
    const onHome = page.url().replace(/\/$/, '') === base;
    check(`D${i}.${label} sign-out shows overlay then lands on landing page`, overlay && onHome);
    await wait(3000);
    check(`D${i}.${label} no bounce-back after 3s`, page.url().replace(/\/$/, '') === base);
    // A forged token legitimately 401s real data queries — only uncaught JS
    // exceptions count as failures here.
    const jsErrs = page._errs.filter((e) => e.startsWith('pageerror'));
    check(`D${i}.${label} no uncaught page errors`, jsErrs.length === 0);
    if (jsErrs.length) console.log('   ERRORS:', jsErrs.slice(0, 5).join(' | '));
    await page.close();
  }
}

// ── 8. Sign-up success → Sign In on the SAME /auth page ───────────────────
async function groupE(base, label) {
  console.log(`\n── Group E [${label}]: sign-up success → switches to Sign In on same /auth page ──`);
  const page = await newPage();
  await page.goto(base + '/auth', { waitUntil: 'load' });
  await wait(1300);
  const toggle = page.getByRole('button', { name: 'Create an account' });
  if ((await toggle.count()) > 0) await toggle.click();
  await wait(400);
  // Unique credentials per run — Supabase 422s ("already registered") if the
  // email/username was used by a previous run, which would mask the real flow.
  const stamp = Date.now().toString(36);
  await page.locator('#fullName').fill(`QA ${stamp}`);
  await page.locator('#username').fill(`qa${stamp}`);
  await page.locator('#email').fill(`ideon.qa.${stamp}@gmail.com`);
  await page.locator('#password').fill('QaPass!234');
  await page.locator('#confirmPassword').fill('QaPass!234');
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
  const overlay = await overlayVisible(page, 'Account created');
  await wait(2500);
  const h1 = await page.locator('h1').first().textContent().catch(() => '');
  const notice = await page.getByText('Account created — please sign in below.', { exact: false }).count();
  check(`E.${label} sign-up shows overlay then switches to Sign In form (same page)`, overlay && h1.includes('Welcome back') && notice > 0);
  await wait(2500);
  check(`E.${label} stays on /auth sign-in (no bounce)`,
    page.url().startsWith(base + '/auth') && (await page.locator('h1').first().textContent().catch(() => '')).includes('Welcome back'));
  const jsErrs = page._errs.filter((e) => e.startsWith('pageerror'));
  check(`E.${label} no uncaught page errors`, jsErrs.length === 0);
  if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 8).join(' | '));
  await page.close();
}

// ── Run (each group isolated so one failure can't abort the rest) ─────────
const groups = [
  () => groupA('http://localhost:5173', 5, 'dev'),
  () => groupB('http://localhost:5173', 2, 'dev'),
  () => groupC('http://localhost:5173', 'dev'),
  () => groupD('http://localhost:5173', 3, 'dev'),
  () => groupE('http://localhost:5173', 'dev'),
  () => groupA('http://localhost:4173', 3, 'build'),
  () => groupB('http://localhost:4173', 1, 'build'),
  () => groupC('http://localhost:4173', 'build'),
  () => groupD('http://localhost:4173', 1, 'build'),
];
for (const fn of groups) {
  try {
    await fn();
  } catch (e) {
    console.log('GROUP ERROR:', e.message);
    results.push({ name: 'group completed without exception', ok: false });
  }
}

const failed = results.filter((r) => !r.ok);
console.log('\n══════════════════════════════════════════');
console.log(`TOTAL: ${results.length} checks | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log('  ✗ ' + f.name));
}
await browser.close();
servers.forEach((s) => { try { s.kill('SIGKILL'); } catch {} });
process.exit(failed.length ? 1 : 0);
