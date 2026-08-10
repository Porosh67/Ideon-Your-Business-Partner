import { useSyncExternalStore } from 'react';
import { supabase, waitForSession } from '@/lib/supabase';
import type { BusinessIdeaRow, CheckinRow, ConversationRow } from '@/types';

/**
 * Module-level cache for the three history lists shared by the sidebar and
 * the pages that consume them (Dashboard, Check-In). All consumers read from
 * this one store, so navigating between routes never re-fetches these tables:
 * the sidebar renders from the same data the pages use, which means history
 * items open instantly and no page ever waits on a query to render.
 */

interface HistoryState {
  conversations: ConversationRow[];
  checkins: CheckinRow[];
  ideas: BusinessIdeaRow[];
  /** True once the initial fetch has completed (even on error). */
  loaded: boolean;
}

let currentUser: string | null = null;
let state: HistoryState = { conversations: [], checkins: [], ideas: [], loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setState(next: HistoryState) {
  state = next;
  // Defer the notification to the next microtask. The history load resolves
  // right as a branded transition is dismissing (sign-in → dashboard): the
  // synchronous emission here used to force every consumer (sidebar, dashboard,
  // check-in) to re-render in the SAME commit as the overlay's exit-fade
  // start, starving the fade's first frames into an abrupt cut. Deferring by
  // one microtask lets the fade begin on a clean frame; the sidebar history
  // then pops in a frame later, overlapping the (compositor-driven) fade
  // instead of colliding with it. Consumers read `state` directly, so the
  // deferred notification never shows stale data — it only delays the
  // re-render by a microtask.
  queueMicrotask(() => emit());
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHistoryState(): HistoryState {
  return state;
}

/** React hook — subscribes to the shared history cache. */
export function useHistory(): HistoryState {
  return useSyncExternalStore(subscribeHistory, getHistoryState);
}

async function fetchAll(userId: string, attempt = 1): Promise<HistoryState> {
  // Never race the persisted-session restore: on a cold load the Supabase
  // client may not have hydrated the token yet, and firing REST queries
  // before it does yields a transient 401 (and an empty sidebar) that only
  // recovers on the next manual refresh. Wait for hydration first.
  await waitForSession();
  const run = () =>
    Promise.all([
      supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false }),
      supabase
        .from('daily_checkins')
        .select('*')
        .eq('user_id', userId)
        .order('checkin_date', { ascending: false })
        .limit(30),
      supabase
        .from('business_ideas')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
  let results = await run();
  // A transient 401 occasionally hits ONE of the parallel initial fetches (a
  // Supabase-side JWT-validation blip — sibling requests carrying the same
  // token succeed at the same millisecond). Without a retry the affected list
  // stays empty until the next manual refresh, so give any in-flight token
  // refresh a beat and re-run the batch once before giving up.
  if (attempt < 2 && results.some((r) => r.error)) {
    await new Promise((r) => setTimeout(r, 1200));
    results = await run();
  }
  return {
    conversations: (results[0].data ?? []) as ConversationRow[],
    checkins: (results[1].data ?? []) as CheckinRow[],
    ideas: (results[2].data ?? []) as BusinessIdeaRow[],
    loaded: true,
  };
}

/** Fetch all three lists and cache them (concurrent calls share one request). */
export function loadHistory(userId: string): Promise<void> {
  if (currentUser !== userId) {
    currentUser = userId;
    state = { conversations: [], checkins: [], ideas: [], loaded: false };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      setState(await fetchAll(userId));
    } catch {
      // Never leave consumers stuck: mark loaded with whatever we have.
      setState({ ...state, loaded: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Load once per user; no-op when the cache is already warm or a load is in flight. */
export function ensureHistory(userId: string): void {
  if (currentUser === userId && (state.loaded || inflight)) return;
  void loadHistory(userId);
}

/**
 * Resolves once the history cache is loaded FOR THE GIVEN USER — the signal
 * the sign-in transition holds its branded overlay on. Kicks off the fetch
 * when needed (including a user switch, which resets any stale cache from the
 * previous account) and reuses an in-flight load, so it never double-fetches.
 * Never rejects: a failed fetch still marks the store loaded, so callers are
 * never trapped under the overlay.
 */
export async function ensureHistoryLoaded(userId: string): Promise<void> {
  if (currentUser === userId && state.loaded) return;
  await loadHistory(userId);
}

// ── Optimistic mutation helpers (call after the Supabase write succeeds) ──

export function addConversation(conv: ConversationRow): void {
  setState({
    ...state,
    conversations: [conv, ...state.conversations.filter((c) => c.id !== conv.id)],
  });
}

export function updateConversation(id: string, patch: Partial<ConversationRow>): void {
  setState({
    ...state,
    conversations: state.conversations
      .map((c) => (c.id === id ? { ...c, ...patch } : c))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
  });
}

export function touchConversation(id: string): void {
  updateConversation(id, { updated_at: new Date().toISOString() });
}

export function removeConversation(id: string): void {
  setState({ ...state, conversations: state.conversations.filter((c) => c.id !== id) });
}

export function upsertCheckin(row: CheckinRow): void {
  setState({ ...state, checkins: [row, ...state.checkins.filter((c) => c.id !== row.id)] });
}

export function updateCheckin(id: string, patch: Partial<CheckinRow>): void {
  setState({
    ...state,
    checkins: state.checkins.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  });
}

export function removeCheckin(id: string): void {
  setState({ ...state, checkins: state.checkins.filter((c) => c.id !== id) });
}

export function upsertIdea(idea: BusinessIdeaRow): void {
  setState({ ...state, ideas: [idea, ...state.ideas.filter((i) => i.id !== idea.id)] });
}

export function updateIdea(id: string, patch: Partial<BusinessIdeaRow>): void {
  setState({ ...state, ideas: state.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

export function removeIdea(id: string): void {
  setState({ ...state, ideas: state.ideas.filter((i) => i.id !== id) });
}
