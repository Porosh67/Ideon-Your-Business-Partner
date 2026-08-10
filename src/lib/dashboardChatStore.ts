import type { ConversationRow } from '@/types';

/**
 * Session-scoped, module-singleton store that remembers which Dashboard
 * conversation the user was last actively viewing. Survives route changes
 * because the React component managing `activeConv` unmounts on navigation
 * away from /dashboard — without this store, returning to /dashboard would
 * show the empty welcome screen instead of the conversation they had open.
 *
 * Scope: in-memory only (lost on full page reload / sign-out). The
 * conversation's full state — messages, feedback — is NEVER persisted here;
 * we only carry the conversation's identity (id + short-form row), and the
 * Dashboard always re-fetches fresh messages via `openConversation()` so
 * nobody reads stale content from this store.
 *
 * API mirrors the React 18 `useSyncExternalStore` contract: a synchronous
 * `getSnapshot()` reference and a `subscribe()` that returns its own
 * unsubscribe. No React Context needed — the provider-less design keeps the
 * fix non-invasive (no edits to Sidebar / AppLayout / App.tsx).
 */

export interface DashboardChatSnapshot {
  /** Conversation currently active in the Dashboard. `null` means "no chat". */
  activeConv: ConversationRow | null;
  /** Convenience: `activeConv?.id ?? null` so callers don't repeat the lookup. */
  activeConvId: string | null;
}

let snapshot: DashboardChatSnapshot = { activeConv: null, activeConvId: null };
const listeners = new Set<() => void>();

/** Notify all subscribers that the snapshot changed. */
function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Return the current snapshot. Identity is preserved across no-op updates
 * so `useSyncExternalStore` does not detect a change and tear down; only a
 * real conv-id transition produces a new reference.
 */
export function getSnapshot(): DashboardChatSnapshot {
  return snapshot;
}

/** Subscribe to snapshot changes; returns an unsubscribe function. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Mark `conv` as the Dashboard's active conversation. Pass `null` to clear
 * — equvalent to {@link clearActive} but allows a single API call site.
 *
 * Side-effects intentionally omitted: we do NOT mutate loading flags, don't
 * touch React state, don't touch the URL, don't refetch messages. The
 * Dashboard's `openConversation` does all of that. This store is purely the
 * cross-route persistent identity signal.
 */
export function setActive(conv: ConversationRow | null): void {
  const next: DashboardChatSnapshot = {
    activeConv: conv,
    activeConvId: conv?.id ?? null,
  };
  // Reference-stable on no-op: avoids useSyncExternalStore tearing when the
  // caller passes the same activeConv we already hold.
  if (next.activeConvId === snapshot.activeConvId && next.activeConv === snapshot.activeConv) {
    return;
  }
  snapshot = next;
  emit();
}

/** Clear the persisted active conversation (alias for `setActive(null)`). */
export function clearActive(): void {
  setActive(null);
}
