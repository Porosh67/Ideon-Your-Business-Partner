// Direct HIT of the deployed semantic-memory function to measure end-to-end
// response time after the retry-model fix.

const EMAIL = 'ideon-perftest+1786371411@example.com';
const PASSWORD = 'PerfTest!2025';

const SUPABASE_URL = 'wgfxyzfaxnnletrosgcb.supabase.co';
const FN_URL = `https://${SUPABASE_URL}/functions/v1/assistant-chat`;

// 1. Sign up (creates auth.users + auth.identities + profile row via trigger);
//    confirm email inline so /auth/v1/token lets us in immediately.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnh5emZheG5ubGV0cm9zZ2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODgzODEsImV4cCI6MjEwMTU2NDM4MX0.eY7RtvgCiqi8eBx89Z1BpH7mZJhFUhPhnqcRh-x7Mj4';

const signupRes = await fetch(`https://${SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const signupJson = await signupRes.json();
let token = signupJson?.access_token;
if (!token) {
  console.log('Signup response (no token):', JSON.stringify(signupJson).slice(0, 800));
  // Sign in instead.
  const signinRes = await fetch(`https://${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const signinJson = await signinRes.json();
  token = signinJson?.access_token;
  if (!token) {
    console.log('Sign-in failed:', JSON.stringify(signinJson).slice(0, 500));
    process.exit(2);
  }
}
console.log('Signed in as', EMAIL);

// 2. Hit assistant-chat (dashboard chat) with Hi
const body = {
  phase: 'chat',
  message: 'Hi',
  history: [],
  conversation_id: 'console-perf-test',
};

const t0 = Date.now();
const fnRes = await fetch(FN_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnZnh5emZheG5ubGV0cm9zZ2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODgzODEsImV4cCI6MjEwMTU2NDM4MX0.eY7RtvgCiqi8eBx89Z1BpH7mZJhFUhPhnqcRh-x7Mj4',
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(60_000),
});
const dt = Date.now() - t0;
const text = await fnRes.text();
console.log('STATUS:', fnRes.status);
console.log('ELAPSED_MS:', dt);
console.log('BODY:', text.slice(0, 600));
