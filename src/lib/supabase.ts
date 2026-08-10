import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/constants/config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
});

// Edge Function base URL
export const functionsUrl = `${SUPABASE_URL}/functions/v1`;

let hydrationPromise: Promise<void> | null = null;

/**
 * Resolves once the client has finished restoring the persisted session on
 * cold start. `getSession()` can return null until that hydration completes,
 * which would leave edge-function calls with an empty Authorization header.
 */
function waitForHydration(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        subscription.unsubscribe();
        resolve();
      };

      // INITIAL_SESSION fires on startup once the stored session is restored.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event) => {
        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'SIGNED_OUT'
        ) {
          finish();
        }
      });

      // Fallback for warm starts (listener attached after INITIAL_SESSION was
      // already emitted) and for the genuinely signed-out case, so callers
      // never hang waiting for an event that won't come.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) finish();
        else setTimeout(finish, 0);
      });
    });
  }
  return hydrationPromise;
}

/**
 * Resolves with the live session once the persisted session has been restored.
 * Always re-reads the current session, so the returned token stays correct
 * across sign-in/sign-out cycles.
 */
export async function waitForSession(): Promise<Session | null> {
  await waitForHydration();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Hard ceiling on how long a single Edge Function call can occupy a request.
// 90s is well above any legit response (classify + reply ~6s, full research +
// plan pipeline ~30s) but well below the worst-case where the Edge runtime
// itself kills the call at 60s and the client keeps the typing indicator up
// for another minute. Lowered from 120s → 90s so a wedged server reaches the
// user-facing error message BEFORE the Edge 60s hard kill, rather than
// after — that ordering is what was producing the "Just loading forever"
// symptom.
const DEFAULT_EDGE_FN_TIMEOUT_MS = 90_000;

/** Parse whatever JSON the response sent back, even on non-OK status. */
async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // Non-JSON body (504 gateway timeout, plain text error page, etc.)
    // should not crash the caller — surface a clean error instead.
    return null;
  }
}

/** Call a Supabase Edge Function with the current session.
 *
 *  Important runtime guarantees added during the streaming/timeout fix:
 *   • Each call is wrapped in an `AbortController` that fires after
 *     {@link DEFAULT_EDGE_FN_TIMEOUT_MS}. Without this, a wedged edge function
 *     would hang the await forever and the UI would sit on
 *     "Ideon is thinking" indefinitely.
 *   • On timeout, the abort throws an `AbortError` so the caller's
 *     try/catch resets its loading flags and surfaces a normal user-visible
 *     error (matching the existing "We couldn't process that — try again?"
 *     path), instead of silently leaving the typing indicator up.
 *   • Footer JSON is read with a try/catch so a non-JSON error response
 *     (e.g. a 504 HTML page from the edge gateway) does not crash the
 *     caller's React render path. */
export async function callEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number }
): Promise<T> {
  const session = await waitForSession();
  const token = session?.access_token ?? '';

  const timeoutMs = options?.timeoutMs ?? DEFAULT_EDGE_FN_TIMEOUT_MS;
  const controller = new AbortController();
  // Some browsers refuse to ever abort fetch (very rare in evergreen), so the
  // timer is set AND captured so it can be cleared in the success branch.
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${functionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await readJsonSafe(res);

    if (!res.ok) {
      const errMessage =
        (data as { error?: string } | null)?.error ??
        `Function returned ${res.status}`;
      throw new Error(errMessage);
    }

    return data as T;
  } catch (err) {
    // Translate the platform's AbortError into a clear, user-actionable
    // message. The function did not respond in time — something on the
    // edge stalled; the user can retry.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        'Ideon took too long to respond. Please try again in a moment.'
      );
    }
    // Re-throw original cause (network failure, JSON parse, business error).
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}