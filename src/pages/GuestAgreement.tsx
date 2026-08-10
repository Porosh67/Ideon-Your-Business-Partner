import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ensureHistory } from '@/lib/historyStore';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { useMarkRouteReady } from '@/lib/transitionStore';
import { AgreementCheckbox } from '@/lib/legalContent';
import { ArrowLeft, Loader2, UserRound, ShieldCheck } from 'lucide-react';
import LogoMark from '@/components/LogoMark';

/**
 * Guest Agreement page.
 *
 * Shown when the user clicks "Continue as guest" on the Auth page.
 * The user must accept the Terms & Privacy before entering the Dashboard.
 * The Back button returns to the Auth page (navigate(-1)).
 */
export default function GuestAgreement() {
  const navigate = useNavigate();
  const { runAuthSubmit } = useAuthTransition();
  useMarkRouteReady();

  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!agreed) return;
    setError(null);
    setLoading(true);

    try {
      await runAuthSubmit(
        { label: 'Welcome', sublabel: 'Setting up your guest workspace…' },
        async () => {
          try {
            const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
            if (anonError) throw anonError;
            if (anonData.user?.id) ensureHistory(anonData.user.id);
            navigate('/dashboard', { replace: true });
          } catch (err) {
            throw new Error(
              err instanceof Error ? err.message : 'Could not start guest session. Try again.'
            );
          }
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start guest session. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col pt-6 sm:pt-16 animate-fade-in">
      {/* Back to auth */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
        aria-label="Back to sign in"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-8 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/80 text-on-primary shadow-lg shadow-accent/20">
          <UserRound className="h-7 w-7" />
        </span>
        <h1 className="font-heading text-3xl font-extrabold tracking-tight">
          Continue as guest
        </h1>
        <p className="mt-2 text-muted">
          Explore Ideon without an account. Your results won't be saved until
          you create one.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
        {/* Info card */}
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/8 to-transparent p-4 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="leading-relaxed text-muted">
            <p className="font-medium text-foreground">What to expect as a guest</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
                Explore all features — chat, ideas, plans, and check-ins
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
                Your session is temporary — create an account to keep your work
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
                No email or password required
              </li>
            </ul>
          </div>
        </div>

        {/* Agreement */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border/60 bg-background/50 p-4">
            <AgreementCheckbox checked={agreed} onChange={setAgreed} disabled={loading} />
          </div>

          {error && (
            <p className="animate-fade-in rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!agreed || loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-3.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogoMark className="h-4 w-4" />
            )}
            {loading ? 'Starting…' : 'I Agree & Continue'}
          </button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-muted">
        By continuing, you acknowledge that you have read and agree to our
        policies. You can create a full account at any time to save your work.
      </p>
    </div>
  );
}
