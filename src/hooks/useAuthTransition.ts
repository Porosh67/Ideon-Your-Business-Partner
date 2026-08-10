import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  beginOverlayDismiss,
  hideTransition,
  isRouteReady,
  resetRouteReady,
  showTransition,
  suppressNextSignoutTransition,
  waitFor,
  type TransitionLabel,
} from '@/lib/transitionStore';

export type { TransitionLabel };

/** Overlay fade-out duration — keep in sync with `.transition-out` in index.css. */
const FADE_MS = 240;

/** Resolve after the browser has painted the current state (two rAFs). Lets
 *  the destination's first paint settle AND the `.transition-out` class
 *  commit BEFORE the fade starts — the reveal must be a real cross-fade,
 *  never a cut (starting the fade in the same commit as the destination
 *  render starved the old 120ms animation into an abrupt cut). */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Two-phase dismissal shared by every transition: mark the cover dismissing
 * (it stays mounted, playing the exit fade), give the destination a frame or
 * two to paint, let the fade run to completion, then unmount. The fade itself
 * is opacity-only on a compositor layer (`will-change: opacity` in
 * `.transition-out` in index.css), so it is NOT starved by main-thread work
 * landing in the same commit — destination first render, the history store
 * emission (3 parallel fetches) and the sidebar pop-in all overlap the fade
 * without eating its frames.
 */
async function dismissOverlay(): Promise<void> {
  beginOverlayDismiss();
  await nextPaint();
  await new Promise((r) => setTimeout(r, FADE_MS));
  hideTransition();
}

/**
 * Orchestrates the branded transitions across the whole auth/navigation flow
 * (Part A). Every transition shows the SAME Ideon logo animation, centered,
 * for a deliberate premium feel — never a wait.
 *
 *  - `goToAuth`       — landing → Auth (Get Started / Sign in / Sign up)
 *  - `runAuthSubmit`  — auth form submit (sign in / sign up / guest): overlay
 *                       immediately on click, network call runs under the cover
 *  - `afterSignout`   — sign-out → landing page
 *
 * RACE-FREE BY DESIGN. The old flow waited a FIXED 450–600ms, dismissed the
 * overlay, and only then navigated — so the destination was revealed before
 * it was ready (empty sidebar on the dashboard, the previous page flashing
 * under the dismissed overlay on /auth). Now the overlay is global (rendered
 * once by <Layout/>, which never unmounts), navigation happens UNDER the
 * overlay, and the destination signals readiness:
 *
 *  - Sign-in → Dashboard: the history fetch is kicked off (NOT awaited) and
 *    the dashboard renders its shell immediately; the sidebar pops in when
 *    the data arrives. Secondary data NEVER blocks the reveal.
 *  - Route-to-route (landing → Auth, sign-out → landing): the destination
 *    page marks itself rendered via useMarkRouteReady(); the overlay dismisses
 *    only once that route is actually on screen.
 *
 * Timing: NO artificial minimum, NO fixed delay, NO timer that outlives
 * readiness. The overlay stays exactly as long as the destination takes to be
 * ready (bounded by a short 3000ms failsafe), then cross-fades out over 240ms.
 */
export function useAuthTransition() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  // Guards against the same transition firing twice (React StrictMode
  // double-invokes effects; a re-render must not replay an in-flight one).
  const runRef = useRef(false);

  /**
   * Show the overlay, run `action` immediately (navigation happens under the
   * cover), then dismiss as soon as `ready` resolves — with a short safety
   * cap (3s) so a hung fetch never traps the user. No minimum display time:
   * if the destination is ready in 150ms, the user sees a 150ms transition,
   * not a forced 350ms+8s wait.
   *
   * Dismissal is two-phase for a smooth cross-fade: once ready, the cover
   * plays a 200ms fade-out (beginOverlayDismiss) and is then unmounted
   * (hideTransition) — the destination is already mounted underneath, so the
   * reveal is gentle and the previous page can never flash.
   */
  const run = useCallback(
    async (overlay: TransitionLabel, action: () => void, ready: () => Promise<void>) => {
      if (runRef.current) return; // no double-run (StrictMode)
      runRef.current = true;
      const t0 = performance.now();
      showTransition(overlay);
      resetRouteReady();
      try {
        action();
        await Promise.race([
          ready(),
          // Failsafe only — never a minimum. 3s is plenty for any route
          // (lazy chunk, session restore, route render) and far below the old
          // 8s that made every transition feel slow.
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } finally {
        // Two-phase dismissal: start the fade-out, let the destination paint,
        // let the fade run to completion, then unmount (see dismissOverlay).
        await dismissOverlay();
        runRef.current = false;
        // Real timing evidence for the transition (visible in devtools).
        console.debug(
          `[transition] "${overlay.label}" took ${Math.round(performance.now() - t0)}ms ` +
            `(show→ready→fade-out→unmount)`
        );
      }
    },
    []
  );

  /** Landing → Auth. Sign in vs sign up is chosen by the caller (mode state). */
  const goToAuth = useCallback(
    (mode?: 'signin' | 'signup') => {
      // Already on /auth? A same-path navigate() would replay the overlay over
      // the current page and leave the form untouched (mode is read once on
      // mount) — i.e. "the loading screen resolves and I'm back where I
      // started". Instead, push the new mode through router state and let
      // Auth's mode-sync effect apply it, with no dead overlay.
      if (location.pathname === '/auth') {
        navigate('/auth', { state: mode ? { mode } : undefined });
        return;
      }
      void run(
        { label: 'Opening your workspace', sublabel: 'Just a moment…' },
        () => navigate('/auth', { state: mode ? { mode } : undefined }),
        () => waitFor(() => isRouteReady('/auth'))
      );
    },
    [run, navigate, location.pathname]
  );

  /**
   * Auth form submit (sign in / sign up / guest): show the branded overlay
   * the INSTANT the user clicks submit, then run the Supabase network call
   * UNDER the cover — never as a dead button-spinner wait in front of it
   * (measured ~850ms of spinner before the overlay appeared on sign-in, ~880ms
   * on sign-up). `task` runs under the overlay:
   *
   *  - success → it has already navigated (or switched mode on /auth); the
   *    cover is held until that destination has actually rendered, so the
   *    reveal lands on the real page, never a skeleton.
   *  - failure → it throws; the cover is dismissed with a fade and the error
   *    propagates to the caller, which renders it immediately.
   */
  const runAuthSubmit = useCallback(
    async (overlay: TransitionLabel, task: () => Promise<void>): Promise<void> => {
      if (runRef.current) return; // no double-run (StrictMode / double click)
      runRef.current = true;
      const t0 = performance.now();
      showTransition(overlay);
      resetRouteReady();
      try {
        await task();
        // Wait for the ACTUAL destination to report ready — never an OR across
        // routes. Before this fix the wait was
        // `isRouteReady('/dashboard') || isRouteReady('/auth')`: for sign-in,
        // the '/auth' clause is the OUTGOING page, so a slow dashboard commit
        // could satisfy readiness from the OLD route and reveal it mid-fade
        // (the exact race this flow exists to prevent).
        //
        // The destination is read LIVE from the address bar, never from the
        // hook closure: `location.pathname` at submit time is the OUTGOING
        // page (/auth for sign-in, sign-up AND guest) and the re-render that
        // carries the new pathname hasn't happened when task() resolves.
        // navigate() commits the real URL synchronously (history.pushState),
        // so window.location.pathname IS the destination the moment task()
        // returns — /dashboard for sign-in/guest, /auth for the in-place
        // sign-up mode switch. Wait only for that one.
        const dest = window.location.pathname;
        await waitFor(() => isRouteReady(dest), { interval: 15, timeoutMs: 3000 });
      } finally {
        await dismissOverlay();
        runRef.current = false;
        console.debug(
          `[transition] "${overlay.label}" took ${Math.round(performance.now() - t0)}ms ` +
            `(submit→ready→fade-out→unmount)`
        );
      }
    },
    [location.pathname]
  );

  /**
   * Sign-out → landing page.
   *
   * Shows the branded overlay IMMEDIATELY on click (no dead 400ms before it
   * appears), then performs the actual Supabase sign-out UNDER the cover and
   * navigates. Readiness = the landing page has rendered (`isRouteReady('/')`),
   * read LIVE via the callback — the old code captured `location.pathname` in
   * the hook closure, so it always saw `/dashboard` and every sign-out burned
   * the full 3s failsafe before revealing the landing page.
   */
  const afterSignout = useCallback(
    (action: () => Promise<void>) => {
      void run(
        { label: 'Signing you out', sublabel: 'See you soon' },
        () => {
          void action();
        },
        async () => {
          // The navigation happens inside `action` (under the cover). Wait for
          // the destination to actually render — never for a stale closure.
          await waitFor(() => isRouteReady('/'), { interval: 15, timeoutMs: 3000 });
        }
      );
    },
    [run]
  );

  /**
   * Sidebar "Sign out": one branded transition covering the whole network
   * sign-out + navigation. The overlay appears the moment the user clicks, the
   * session is cleared under the cover, and the landing page is revealed as
   * soon as it has rendered. `suppressNextSignoutTransition()` keeps Layout's
   * user→null effect from stacking a second overlay on top.
   */
  const signOutWithTransition = useCallback(async () => {
    if (runRef.current) return;
    suppressNextSignoutTransition();
    await afterSignout(async () => {
      await signOut();
      navigate('/');
    });
  }, [afterSignout, navigate, signOut]);

  return {
    run,
    runAuthSubmit,
    goToAuth,
    afterSignout,
    signOut, // exposed for convenience
    signOutWithTransition,
  };
}
