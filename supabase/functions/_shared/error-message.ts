// ──────────────────────────────────────────────────────────────────────────────
// Shared error-message helper for Edge Functions.
//
// Upstream reads in Deno Deploy can stall and raise platform errors that have
// little meaning to the end user (e.g. `Deno.errors.ReadTimeout`, raw
// `AbortError` / `TimeoutError` from `AbortSignal.timeout`, or just the class
// name "ReadTimeout" with no message). Surfacing those verbatim produces
// messages like "Error: ReadTimeout:" in the chat UI.
//
// This helper translates the well-known timeout/stalled-read cases into a
// single user-friendly line ("Upstream service timed out. Please try again in
// a moment.") and falls back to `err.message` for everything else so genuine
// HTTP errors (`Groq request failed (429): …`, etc.) still surface with their
// useful detail.
//
// Used by every Edge Function whose catch block previously did:
//     const message = err instanceof Error ? err.message : 'Unexpected error';
//     return json({ error: message }, 500);
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map any thrown value to the message we want to return to the browser.
 *
 * - DOMException whose name is `TimeoutError` or `AbortError` (raised by
 *   `AbortSignal.timeout(...)`) → user-friendly timeout message.
 * - Error whose class name is `ReadTimeout` (Deno Deploy's stalled-read
 *   error) OR whose message is exactly `ReadTimeout` → user-friendly timeout
 *   message.
 * - Anything else → `err.message` if it's an `Error`, else "Unexpected error".
 */
export function friendlyEdgeError(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'Upstream service timed out. Please try again in a moment.';
  }
  // Deno Deploy throws `Deno.errors.ReadTimeout` whose `.name === "ReadTimeout"`
  // and `.message === ""` (so `err.message` would be empty). The exact class
  // isn't safe to import as a value across runtimes, so check the name string.
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e?.name === 'string' && e.name === 'ReadTimeout') {
    return 'Upstream service timed out. Please try again in a moment.';
  }
  if (err instanceof Error && err.message === 'ReadTimeout') {
    return 'Upstream service timed out. Please try again in a moment.';
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}
