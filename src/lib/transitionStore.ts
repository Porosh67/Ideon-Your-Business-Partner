import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Global transition state shared by every auth/navigation transition (Part A).
 *
 * Previously each page owned its own overlay via useState, so the overlay was
 * rendered by the CALLING component — which unmounts the moment we navigate.
 * That forced the old "wait a fixed delay, THEN navigate" flow, which revealed
 * the destination before it was ready (empty sidebar on the dashboard, the
 * previous page flashing under the dismissed overlay on /auth, etc.).
 *
 * Now the overlay lives here, module-global, and is rendered ONCE by
 * <Layout/> (which never unmounts). Navigation happens UNDER the overlay; the
 * destination signals readiness (history loaded / route rendered / session
 * cleared) and only then does the transition layer dismiss it.
 */

export interface TransitionLabel {
  label: string;
  sublabel?: string;
}

/** Overlay state as seen by <Layout/>: the label plus whether the exit fade
 *  has begun (the cover stays mounted while it plays, then unmounts). */
export interface TransitionState extends TransitionLabel {
  dismissing: boolean;
}

// ── Overlay ────────────────────────────────────────────────────────────

let overlay: TransitionState | null = null;
const overlayListeners = new Set<() => void>();

function emitOverlay() {
  overlayListeners.forEach((l) => l());
}

export function showTransition(next: TransitionLabel): void {
  overlay = { ...next, dismissing: false };
  emitOverlay();
}

/** Begin the exit fade. The cover stays mounted (animating) until
 *  hideTransition() unmounts it — this is what makes the reveal a gentle
 *  cross-fade instead of an abrupt cut. */
export function beginOverlayDismiss(): void {
  if (overlay && !overlay.dismissing) {
    overlay = { ...overlay, dismissing: true };
    emitOverlay();
  }
}

export function hideTransition(): void {
  if (overlay) {
    overlay = null;
    emitOverlay();
  }
}

export function getTransition(): TransitionState | null {
  return overlay;
}

export function subscribeTransition(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => {
    overlayListeners.delete(listener);
  };
}

/** Live overlay state — <Layout/> is the single place the branded loader renders. */
export function useTransitionOverlay(): TransitionState | null {
  return useSyncExternalStore(subscribeTransition, getTransition);
}

// ── Route readiness ────────────────────────────────────────────────────
// The destination page marks itself ready once it has actually rendered
// (useMarkRouteReady). A transition targeting a route holds its overlay until
// that route reports ready, so the reveal never shows the previous page, a
// skeleton, or a partially-mounted page. A single slot is enough: only one
// route is on screen at a time, and every mark overwrites the previous one,
// so a stale "ready" can never leak across navigations.

let readyRoute: string | null = null;
const routeListeners = new Set<() => void>();

// Bumped on every transition start. useMarkRouteReady subscribes to it so a
// transition that lands on the ALREADY-MOUNTED route (e.g. Sign Up → Sign In
// switches mode on the same /auth path, where the pathname never changes) can
// re-arm readiness without waiting for a fresh mount.
let transitionEpoch = 0;
const epochListeners = new Set<() => void>();

function emitRouteReady() {
  routeListeners.forEach((l) => l());
}

export function markRouteReady(pathname: string): void {
  if (readyRoute !== pathname) {
    readyRoute = pathname;
    emitRouteReady();
  }
}

/**
 * Forget the currently-ready route. Called when a transition STARTS so a
 * stale "ready" from a previous visit can never prematurely dismiss the new
 * transition — the destination must genuinely re-render and re-mark itself.
 * Also bumps the transition epoch so mounted pages re-affirm readiness.
 */
export function resetRouteReady(): void {
  if (readyRoute !== null) {
    readyRoute = null;
    emitRouteReady();
  }
  // Bump the epoch so mounted pages detect they must re-affirm readiness.
  // We deliberately do NOT fire epoch listeners here — doing so would let
  // the still-mounted OLD page call markRouteReady with its own (stale)
  // pathname, which for same-pathname transitions (e.g. Sign Up → Sign In
  // on /auth) marks the destination as ready before React commits the new
  // render. The overlay fades out and reveals the old page underneath for
  // a frame — the exact race this system exists to prevent.
  //
  // Instead, useMarkRouteReady detects the epoch change via a no-deps
  // useEffect that runs AFTER every React commit, so it never fires from
  // a stale component.
  transitionEpoch += 1;
}

export function getTransitionEpoch(): number {
  return transitionEpoch;
}

export function subscribeTransitionEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

export function isRouteReady(pathname: string): boolean {
  return readyRoute === pathname;
}

export function subscribeRouteReady(listener: () => void): () => void {
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
}

/**
 * Call at the top of any page that can be a transition destination (Home,
 * LearnMore, Auth, …). Marks the current route as rendered once it has
 * committed, so a pending branded transition dismisses exactly when the page
 * is actually visible.
 */
export function useMarkRouteReady(): void {
  const location = useLocation();
  const epochRef = useRef(getTransitionEpoch());

  // Runs after EVERY React commit (no deps). Detects epoch bumps from
  // resetRouteReady() and re-marks the current pathname as ready. This is
  // the mechanism that handles same-pathname transitions (e.g. Sign Up →
  // Sign In on /auth) where the pathname useEffect below would NOT re-fire.
  // Because this runs as a React effect, it fires AFTER the new render has
  // committed — never from a stale, still-mounted old component.
  useEffect(() => {
    const currentEpoch = getTransitionEpoch();
    if (currentEpoch !== epochRef.current) {
      epochRef.current = currentEpoch;
      markRouteReady(location.pathname);
    }
  });

  // Runs on mount and on pathname changes — the primary readiness signal
  // for different-route transitions (e.g. landing → /auth).
  useEffect(() => {
    markRouteReady(location.pathname);
  }, [location.pathname]);
}

// ── Polling helper ─────────────────────────────────────────────────────

/** Resolves as soon as `predicate` is true (checked every `interval` ms). */
export function waitFor(
  predicate: () => boolean,
  opts: { interval?: number; timeoutMs?: number } = {}
): Promise<void> {
  const { interval = 25, timeoutMs = 10000 } = opts;
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return resolve();
      setTimeout(tick, interval);
    };
    tick();
  });
}

// ── Sign-out suppression (guest → account upgrade) ────────────────────
// When a guest signs up, Auth calls signOut() first (to detach the anonymous
// session) but STAYS in the app. Without this, Layout's sign-out effect would
// see user→null and fire the "Signing you out" overlay + navigate to the
// landing page mid-upgrade. Auth sets the flag right before that internal
// sign-out; Layout consumes it and skips the transition.

let suppressSignout = false;

/** Arm the suppression for the NEXT user→null transition. */
export function suppressNextSignoutTransition(): void {
  suppressSignout = true;
}

/** Read and clear the suppression flag (Layout calls this on user→null). */
export function consumeSuppressSignout(): boolean {
  const v = suppressSignout;
  suppressSignout = false;
  return v;
}
