// ── set-first-password ───────────────────────────────────────────────────
// Lets a logged-in passwordless (OAuth / Google / GitHub / Apple) user set
// their very first password on this Ideon account.
//
// Why this exists:
//
// The Supabase project's auth config has
//
//   SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD = true
//
// (a.k.a. `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`) — a
// server-side guard that rejects any `auth.updateUser({ password })` call
// unless the request body also includes `current_password`, even for users
// who have no password yet. Supabase's own docs describe `updateUser({
// password })` as THE canonical way to add email/password auth to an OAuth
// account, but the project flag is intentionally strict, so the client path
// can no longer be used for first-password-set.
//
// The browser cannot bypass this — it would have to lie about a password
// that does not exist. So we route the request through a tiny, JWT-gated
// edge function:
//
//   1. verify the caller's access_token with admin.auth.getUser(token),
//      guaranteeing the caller is the real logged-in user;
//   2. call admin.auth.admin.updateUserById(<self>, { password }) — admin
//      updates are exempt from the "current password required" check
//      because they authenticate the request out-of-band via the JWT;
//   3. respond ok. The client then refreshes the session so user.app_metadata
//      and the identities list reflect the new email/password capability.
//
// Idempotent: calling it twice with the same password is harmless (GoTrue
// re-hashes). After the first successful invocation, `userHasPassword()`
// flips to true and the standard change-password form reappears; from then
// on, ordinary `updateUser({ password, current_password })` works and
// future password changes should NOT come back through this function.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceRoleKey) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  try {
    // ── Verify the caller's JWT (legacy verify_jwt is disabled; we check here) ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return json({ error: 'Unauthorized — valid session required' }, 401);
    }
    const { data: tokenUser, error: tokenErr } = await admin.auth.getUser(token);
    if (tokenErr || !tokenUser?.user) {
      return json({ error: 'Unauthorized — valid session required' }, 401);
    }
    const userId = tokenUser.user.id;

    // Refuse guests/anonymous users — they have no real account to attach
    // a password to. (Anonymous signups are deleted on sign-out and shouldn't
    // ever leave a persistent password behind.)
    if (tokenUser.user.is_anonymous === true) {
      return json(
        { error: 'Guest sessions cannot set a password — create a real account first.' },
        403
      );
    }

    // ── Validate the new password ──
    const body = await req.json().catch(() => ({}));
    const rawPassword = typeof body?.password === 'string' ? body.password : '';
    const password = rawPassword.trim();
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400);
    }
    if (password.length > 72) {
      // bcrypt's input cap — anything longer is silently truncated server-side.
      return json({ error: 'Password must be 72 characters or fewer.' }, 400);
    }

    // ── Set the password via the admin API (bypasses
    //    SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD) ──
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
    });
    if (updErr) {
      return json({ error: updErr.message || 'Could not set password' }, 500);
    }

    return json({ ok: true, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
