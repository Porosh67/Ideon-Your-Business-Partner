import LogoMark from '@/components/LogoMark';
import type { TransitionState } from '@/lib/transitionStore';

/**
 * Branded full-screen transition overlay — the Ideon logo animation, centered.
 *
 * Used for ALL auth/navigation transitions so the whole app shares one
 * consistent "premium micro-transition" language (Part A):
 *  - landing → Auth (Get Started / Sign in / Sign up)
 *  - sign-up success → Sign In
 *  - sign-in success → Dashboard
 *  - sign-out → landing page
 *
 * Purely presentational: the overlay STAYS UP until the destination signals
 * readiness, then the transition owner flips `dismissing` — the cover plays a
 * 200ms fade-out while the (already-mounted) destination is revealed beneath
 * it, then Layout unmounts it. That two-phase dismissal is what makes the
 * reveal a gentle cross-fade instead of an abrupt cut, and it guarantees the
 * old race condition (loading → old page flash → new page) stays gone: the
 * cover never leaves before the correct destination is on screen.
 */
export default function TransitionLoader({ state }: { state: TransitionState }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`transition-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background/95 backdrop-blur-sm ${
        state.dismissing ? 'transition-out' : ''
      }`}
    >
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/25 ideon-loader-box">
        <LogoMark className="h-9 w-9 ideon-loader-logo" />
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">{state.label}</p>
        {state.sublabel && <p className="text-xs text-muted">{state.sublabel}</p>}
      </div>
    </div>
  );
}
