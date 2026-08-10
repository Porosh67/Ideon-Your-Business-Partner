// Diagnostic: full console dump + fine-grained URL/overlay timeline for sign-out.
import { spawn } from 'node:child_process';
const BASE = 'http://localhost:5173';
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const STORAGE_KEY = 'sb-wgfxyzfaxnnletrosgcb-auth-token';
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const fakeJwt = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ sub: 'qa-fake-user', email: 'qa.fake@example.com', aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now, app_metadata: { provider: 'email' }, user_metadata: { full_name: 'QA Fake' } }),
  'fake-sig',
].join('.');
const fakeSession = {
  access_token: fakeJwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'fake-refresh',
  user: { id: 'qa-fake-user', aud: 'authenticated', role: 'authenticated', email: 'qa.fake@example.com', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'QA Fake' }, created_at: new Date().toISOString() },
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
const ts = () => Date.now() - t0;
page.on('console', (m) => console.log(`[${ts()}ms console.${m.type()}] ${m.text().slice(0, 220)}`));
page.on('pageerror', (e) => console.log(`[${ts()}ms PAGEERROR] ${String(e).slice(0, 220)}`));
page.on('requestfailed', (r) => console.log(`[${ts()}ms reqfail] ${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`[${ts()}ms http${r.status()}] ${r.url().slice(0, 120)}`); });

await page.addInitScript(({ key, session }) => {
  localStorage.setItem(key, JSON.stringify(session));
}, { key: STORAGE_KEY, session: fakeSession });
await page.route('**/auth/v1/token**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) });
});

await page.goto(BASE + '/dashboard', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
console.log(`[${ts()}ms] on ${page.url()} — clicking profile menu`);
await page.getByRole('button', { name: 'Profile menu' }).first().click();
await new Promise((r) => setTimeout(r, 400));
console.log(`[${ts()}ms] clicking Sign out`);

// fast URL watcher
let lastUrl = page.url();
const urlIv = setInterval(() => {
  const u = page.url();
  if (u !== lastUrl) { console.log(`[${ts()}ms URL] ${lastUrl} -> ${u}`); lastUrl = u; }
}, 5);
// fast overlay watcher
let lastOv = false;
const ovIv = setInterval(async () => {
  try {
    const n = await page.locator('[role="status"].transition-overlay').count();
    const vis = n > 0;
    if (vis !== lastOv) console.log(`[${ts()}ms OVERLAY] ${vis ? 'SHOWN' : 'HIDDEN'}`);
    lastOv = vis;
  } catch {}
}, 5);

await page.getByRole('menuitem', { name: 'Sign out' }).first().click().catch(async () => {
  await page.getByText('Sign out', { exact: true }).last().click();
});
await new Promise((r) => setTimeout(r, 4000));
clearInterval(urlIv);
clearInterval(ovIv);
console.log(`[${ts()}ms] final URL: ${page.url()}`);
await browser.close();
process.exit(0);
