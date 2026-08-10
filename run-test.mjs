import { spawn, execSync } from 'node:child_process';

// ── 1. Build, then start preview server ────────────────────────────────────
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

const server = spawn('npm', ['run', 'preview', '--', '--port', '4173', '--strictPort'], {
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
      const res = await fetch('http://localhost:4173/');
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

// ── 2. Helpers ─────────────────────────────────────────────────────────────
const results = [];
const check = (name, cond) => {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
};

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

// Forge a plausible JWT so supabase-js decodes a valid-looking session.
const now = Math.floor(Date.now() / 1000);
const fakeJwt = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: 'test-user-id-1234',
    email: 'test@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    exp: now + 3600,
    iat: now,
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Test User' },
  }),
  'fake-signature',
].join('.');

const fakeSession = {
  access_token: fakeJwt,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: now + 3600,
  refresh_token: 'fake-refresh-token',
  user: {
    id: 'test-user-id-1234',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'test@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Test User' },
    created_at: new Date().toISOString(),
  },
};

// localStorage key used by supabase-js v2 for this project ref.
const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';

// ── 3. Browser tests ───────────────────────────────────────────────────────
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });

try {
  // ── A. Guest pages ───────────────────────────────────────────────────────
  const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const guestErrors = [];
  guest.on('pageerror', (e) => guestErrors.push(String(e)));

  await guest.goto('http://localhost:4173/', { waitUntil: 'load' });
  await guest.waitForTimeout(900);
  check('home page loads (guest)', (await guest.title()).length > 0 && guestErrors.length === 0);

  await guest.goto('http://localhost:4173/auth', { waitUntil: 'load' });
  await guest.waitForTimeout(900);
  check('auth page loads (guest)', guestErrors.length === 0);

  // Guest header has its own mobile menu toggle on narrow screens
  const guestMobile = await browser.newPage({ viewport: { width: 375, height: 700 } });
  await guestMobile.goto('http://localhost:4173/auth', { waitUntil: 'load' });
  await guestMobile.waitForTimeout(800);
  const guestMenuBtn = guestMobile.getByRole('button', { name: 'Open menu' }).first();
  check('guest mobile menu button exists', (await guestMenuBtn.count()) > 0);
  if ((await guestMenuBtn.count()) > 0) {
    await guestMenuBtn.click();
    await guestMobile.waitForTimeout(400);
    const mobileNav = guestMobile.getByRole('navigation', { name: 'Mobile' });
    check('guest mobile menu opens', (await mobileNav.count()) > 0 && (await mobileNav.isVisible()));
    // Close it again
    await guestMobile.getByRole('button', { name: 'Close menu' }).first().click();
    await guestMobile.waitForTimeout(300);
    check('guest mobile menu closes', !(await mobileNav.isVisible().catch(() => false)));
  }
  await guestMobile.close();
  await guest.close();

  // ── B. Signed-in app: sidebar rail, collapse, mobile drawer ──────────────
  const app = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  app.on('pageerror', (e) => pageErrors.push(String(e)));

  // Seed a persisted session + intercept the refresh-token call so the
  // auth restore path succeeds without real credentials.
  await app.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: STORAGE_KEY, session: fakeSession });
  await app.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeSession),
    });
  });

  await app.goto('http://localhost:4173/dashboard', { waitUntil: 'load' });
  await app.waitForTimeout(1600);

  const rail = app.locator('aside');
  check('desktop sidebar rail renders (signed in)', (await rail.count()) > 0);
  check('sidebar has Dashboard nav link', (await app.getByRole('link', { name: 'Dashboard' }).count()) > 0);
  check('sidebar has Check-In nav link', (await app.getByRole('link', { name: 'Check-In' }).count()) > 0);
  check('sidebar has New chat button', (await app.getByRole('button', { name: 'New chat' }).count()) > 0);
  check('sidebar has History section', (await app.getByText('History', { exact: true }).count()) > 0);
  check('sidebar has profile menu', (await app.getByRole('button', { name: 'Profile menu' }).count()) > 0);

  // Collapse toggle
  const collapseBtn = app.getByRole('button', { name: 'Collapse sidebar' }).first();
  if ((await collapseBtn.count()) > 0) {
    await collapseBtn.click();
    await app.waitForTimeout(400);
    const expandBtn = app.getByRole('button', { name: 'Expand sidebar' }).first();
    check('collapse toggle switches to expand', (await expandBtn.count()) > 0);
    await expandBtn.click();
    await app.waitForTimeout(400);
    check('sidebar re-expands', (await app.getByRole('button', { name: 'Collapse sidebar' }).count()) > 0);
  } else {
    check('collapse toggle switches to expand', false);
  }

  // Theme toggle inside profile menu
  const profileBtn = app.getByRole('button', { name: 'Profile menu' }).first();
  await profileBtn.click();
  await app.waitForTimeout(300);
  const themeItem = app.getByRole('menuitem', { name: /Switch to (dark|light) mode/ }).first();
  check('profile menu has theme toggle', (await themeItem.count()) > 0);
  await app.getByRole('button', { name: 'Profile menu' }).first().click(); // close
  await app.waitForTimeout(200);

  check('no uncaught page errors on dashboard', pageErrors.length === 0);

  // ── C. Mobile drawer (signed in) ─────────────────────────────────────────
  const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } });
  await mobile.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: STORAGE_KEY, session: fakeSession });
  await mobile.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeSession),
    });
  });
  await mobile.goto('http://localhost:4173/dashboard', { waitUntil: 'load' });
  await mobile.waitForTimeout(1400);

  const openMenu = mobile.getByRole('button', { name: 'Open menu' }).first();
  check('mobile top bar menu button exists (signed in)', (await openMenu.count()) > 0);
  await openMenu.click();
  await mobile.waitForTimeout(500);

  const drawer = mobile.locator('[data-sidebar-drawer]');
  const overlay = mobile.locator('[data-sidebar-overlay]');
  check('mobile drawer opens', (await drawer.count()) > 0 && (await drawer.isVisible()));
  check('mobile drawer overlay renders', (await overlay.count()) > 0);
  check('mobile drawer has close button', (await mobile.getByRole('button', { name: 'Close menu' }).count()) > 0);

  // Escape closes the drawer
  await mobile.keyboard.press('Escape');
  await mobile.waitForTimeout(400);
  check('Escape closes mobile drawer', (await drawer.count()) === 0);

  await mobile.close();

  await app.screenshot({ path: '/tmp/sidebar-app.png' });
  await app.close();
} catch (e) {
  console.log('TEST ERROR:', e.message);
  results.push({ name: 'no exceptions', ok: false });
} finally {
  await browser.close();
}

server.kill('SIGKILL');
try { execSync('pkill -f "vite preview"'); } catch {}

const failed = results.filter((r) => !r.ok);
console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
