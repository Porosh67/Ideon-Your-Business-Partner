// Focused verification for the auth bottom-toggle navigation fix:
// 1. Sign In page → click "Create an account" → Sign Up page
// 2. Sign Up page → click "Sign in" → Sign In page
// Tested BOTH from direct /auth entry AND from navbar-driven entry (state mode),
// the latter being the scenario where the old code snapped back.
import { spawn, execSync } from 'node:child_process';

try { execSync('pkill -f "vite"'); } catch {}

const dev = spawn('npm', ['run', 'dev'], { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
const waitForServer = (port, timeoutMs = 30000) =>
  new Promise((resolve) => {
    const start = Date.now();
    const poll = async () => {
      if (Date.now() - start > timeoutMs) return resolve(false);
      try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return resolve(true); } catch {}
      setTimeout(poll, 400);
    };
    poll();
  });

const ok = await waitForServer(5173);
console.log('dev server up:', ok);
if (!ok) process.exit(1);

const results = [];
const check = (name, cond) => {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });

const newPage = async () => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p._errs = errs;
  return p;
};

const h1 = async (page) => (await page.locator('h1').first().textContent().catch(() => '')).trim();
const toggle = (page) => page.getByRole('button', { name: 'Create an account' }).last(); // bottom link (named "Create an account" on signin; "Sign in" on signup)

// ── Scenario 1: direct /auth entry (no router state) ─────────────────────
{
  const page = await newPage();
  await page.goto('http://localhost:5173/auth', { waitUntil: 'load' });
  await wait(1200);
  check('S1 starts on Sign In (h1 "Welcome back")', (await h1(page)).includes('Welcome back'));

  // Sign In → Sign Up via bottom toggle
  const toSignup = page.getByRole('button', { name: 'Create an account' }).last();
  await toSignup.click();
  await wait(600);
  check('S1 "Create an account" → Sign Up (h1 "Create your account")', (await h1(page)).includes('Create your account'));
  await wait(1200);
  check('S1 stays on Sign Up after 1.8s (no snap-back)', (await h1(page)).includes('Create your account'));

  // Sign Up → Sign In via bottom toggle
  const toSignin = page.getByRole('button', { name: 'Sign in' }).last();
  await toSignin.click();
  await wait(600);
  check('S1 "Sign in" → Sign In (h1 "Welcome back")', (await h1(page)).includes('Welcome back'));
  await wait(1200);
  check('S1 stays on Sign In after 1.8s (no snap-back)', (await h1(page)).includes('Welcome back'));

  check('S1 no page/console errors', page._errs.length === 0);
  if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 5).join(' | '));
  await page.close();
}

// ── Scenario 2: navbar-driven entry (router state mode = the bug trigger) ─
{
  const page = await newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await wait(900);
  // Navbar "Sign up" → lands on /auth in signup mode (state mode: 'signup')
  await page.getByRole('button', { name: 'Sign up' }).first().click();
  await wait(2500);
  check('S2 navbar Sign up lands on /auth signup (state mode)', (await h1(page)).includes('Create your account'));

  // Sign Up → Sign In via bottom toggle (this was the snap-back case)
  const toSignin = page.getByRole('button', { name: 'Sign in' }).last();
  await toSignin.click();
  await wait(600);
  check('S2 "Sign in" → Sign In (h1 "Welcome back")', (await h1(page)).includes('Welcome back'));
  await wait(1500);
  check('S2 stays on Sign In after 2.1s (no snap-back)', (await h1(page)).includes('Welcome back'));

  // Sign In → Sign Up via bottom toggle
  const toSignup = page.getByRole('button', { name: 'Create an account' }).last();
  await toSignup.click();
  await wait(600);
  check('S2 "Create an account" → Sign Up (h1 "Create your account")', (await h1(page)).includes('Create your account'));
  await wait(1500);
  check('S2 stays on Sign Up after 2.1s (no snap-back)', (await h1(page)).includes('Create your account'));

  check('S2 no page/console errors', page._errs.length === 0);
  if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 5).join(' | '));
  await page.close();
}

// ── Scenario 3: toggle works when entered via navbar Sign in ─────────────
{
  const page = await newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await wait(900);
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await wait(2500);
  check('S3 navbar Sign in lands on /auth signin (state mode)', (await h1(page)).includes('Welcome back'));

  await page.getByRole('button', { name: 'Create an account' }).last().click();
  await wait(600);
  check('S3 "Create an account" → Sign Up (no snap-back)', (await h1(page)).includes('Create your account'));
  await wait(1500);
  check('S3 stays on Sign Up after 2.1s (no snap-back)', (await h1(page)).includes('Create your account'));

  check('S3 no page/console errors', page._errs.length === 0);
  if (page._errs.length) console.log('   ERRORS:', page._errs.slice(0, 5).join(' | '));
  await page.close();
}

const failed = results.filter((r) => !r.ok);
console.log('\n══════════════════════════════════════════');
console.log(`TOTAL: ${results.length} checks | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
if (failed.length) failed.forEach((f) => console.log('  ✗ ' + f.name));
await browser.close();
dev.kill('SIGKILL');
process.exit(failed.length ? 1 : 0);
