import { createClient } from 'npm:@supabase/supabase-js@2';

// ── delete-account ──────────────────────────────────────────────────────
// Permanently deletes a user's account: all owned rows across every table,
// their uploaded storage objects, and finally the auth.users row itself.
//
// Deleting an auth user REQUIRES the service role (admin.deleteUser) — it can
// never be done from the browser with the anon key. The client therefore:
//   1. verifies the current password locally (signInWithPassword), then
//   2. calls this function with the user's id.
// The function re-verifies the caller's JWT and refuses to delete any user
// other than the authenticated one.

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

// Every table with a user_id column (profiles keys on `id`). Deleting in this
// order respects the inter-table FKs (child rows before parents) so the
// statement never trips a "still referenced" violation even if a cascade is
// missing — the deletes are idempotent when cascades DO exist.
const USER_TABLES = [
  'conversation_messages',
  'conversations',
  'chat_attachments',
  'checklist_progress',
  'plan_chat_messages',
  'generated_roadmaps',
  'business_plans',
  'business_ideas',
  'daily_checkins',
  'memory_embeddings',
];

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
    return json({ error: 'Server is not configured for account deletion' }, 500);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  try {
    // ── Verify the caller's JWT (legacy verify_jwt is disabled; we check here) ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized — valid session required' }, 401);

    const { data: tokenUser, error: tokenErr } = await admin.auth.getUser(token);
    if (tokenErr || !tokenUser?.user) {
      return json({ error: 'Unauthorized — valid session required' }, 401);
    }

    // ── The user may only delete THEMSELVES ──
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (!userId || userId !== tokenUser.user.id) {
      return json({ error: 'Forbidden — you can only delete your own account' }, 403);
    }

    // ── 1. Delete every row the user owns (service role bypasses RLS) ──
    for (const table of USER_TABLES) {
      const { error } = await admin.from(table).delete().eq('user_id', userId);
      if (error) {
        return json({ error: `Could not clear ${table} — please try again.` }, 500);
      }
    }
    const { error: profileErr } = await admin.from('profiles').delete().eq('id', userId);
    if (profileErr) {
      return json({ error: 'Could not clear profile data — please try again.' }, 500);
    }

    // ── 2. Best-effort removal of uploaded files in the private bucket ──
    try {
      const { data: objects } = await admin.storage.from('chat-attachments').list(userId, { limit: 1000 });
      if (objects && objects.length > 0) {
        const paths = objects
          .filter((o) => o.name !== '.emptyFolderPlaceholder')
          .map((o) => `${userId}/${o.name}`);
        if (paths.length > 0) await admin.storage.from('chat-attachments').remove(paths);
      }
    } catch {
      // Orphaned storage objects are harmless; never block deletion on them.
    }

    // ── 3. Delete the auth user (cascades to sessions, identities, and any
    //        remaining references). This is the irreversible step. ──
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return json({ error: 'Account could not be deleted — please try again.' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
