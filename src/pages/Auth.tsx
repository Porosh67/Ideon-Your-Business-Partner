import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ensureHistory } from '@/lib/historyStore';
import { useAuth } from '@/hooks/useAuth';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import {
  suppressNextSignoutTransition,
  useMarkRouteReady,
} from '@/lib/transitionStore';
import { SiGoogle } from 'react-icons/si';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Lock,
  Mail,
  UserRound,
  User,
  Eye,
  EyeOff,
  CheckCircle,
} from 'lucide-react';
import LogoMark from '@/components/LogoMark';
import { AgreementCheckbox } from '@/lib/legalContent';

type Mode = 'signin' | 'signup';

type StrengthLevel = 'none' | 'weak' | 'fair' | 'good' | 'strong';

interface PasswordRule {
  key: string;
  label: string;
  test: (pw: string) => boolean;
}

const PASSWORD_RULES: PasswordRule[] = [
  { key: 'min8', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { key: 'uppercase', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { key: 'lowercase', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { key: 'number', label: 'One number', test: (pw) => /[0-9]/.test(pw) },
  { key: 'special', label: 'One special character', test: (pw) => /[^a-zA-Z0-9]/.test(pw) },
];

const STRENGTH_META: Record<StrengthLevel, { label: string; color: string; bar: string; width: string }> = {
  none: { label: '', color: '', bar: 'bg-subtle', width: 'w-0' },
  weak: { label: 'Weak', color: 'text-destructive', bar: 'bg-destructive', width: 'w-1/4' },
  fair: { label: 'Fair', color: 'text-warning', bar: 'bg-warning', width: 'w-2/4' },
  good: { label: 'Good', color: 'text-primary', bar: 'bg-primary', width: 'w-3/4' },
  strong: { label: 'Strong', color: 'text-success', bar: 'bg-success', width: 'w-full' },
};

function computeStrength(password: string): StrengthLevel {
  if (!password) return 'none';
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  if (passed <= 1) return 'weak';
  if (passed === 2) return 'fair';
  if (passed === 3) return 'good';
  return 'strong';
}

function getPasswordErrors(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export default function Auth() {
  const { isGuest, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { runAuthSubmit } = useAuthTransition();
  // Marks this route as rendered so a pending branded transition dismisses
  // exactly when the form is actually visible (see useAuthTransition).
  useMarkRouteReady();
  const from = (location.state as { from?: { pathname?: string } } | null)
    ?.from?.pathname;

  const initialMode = (location.state as { mode?: Mode } | null)?.mode ?? 'signin';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveMessageRef = useRef<HTMLDivElement | null>(null);
  // Holds a notice that must SURVIVE a mode switch. The [mode] effect below
  // clears `notice` on every mode change — but the signup-success flow needs
  // to set mode to 'signin' AND show a follow-up message ("Account created…").
  // Setting this ref before switching mode lets the effect apply it instead
  // of wiping it (the effect runs after the mode-change render, so a plain
  // setNotice() call in the same batch is destroyed before it's ever seen).
  const pendingNoticeRef = useRef<string | null>(null);

  const strength = useMemo(() => computeStrength(password), [password]);
  const strengthMeta = STRENGTH_META[strength];
  const passwordErrors = useMemo(() => getPasswordErrors(password), [password]);

  const confirmError = useMemo<string | null>(() => {
    if (mode !== 'signup' || !confirmPassword) return null;
    if (!password) return null;
    if (password !== confirmPassword) return 'Passwords don\'t match — check both fields.';
    return null;
  }, [password, confirmPassword, mode]);

  useEffect(() => {
    if (strength !== 'none' && liveMessageRef.current) {
      liveMessageRef.current.textContent = `Password strength: ${strengthMeta.label}`;
    }
  }, [strength, strengthMeta.label]);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setOauthLoading(false);
        setGuestLoading(false);
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    setOauthLoading(false);
  }, []);

  useEffect(() => {
    console.log('[QA-DEBUG] [mode] effect fired, mode =', mode, 'pendingNoticeRef.current =', JSON.stringify(pendingNoticeRef.current));
    setError(null);
    setResetSent(false);
    setFieldErrors({});
    setAgreedToTerms(false);
    // A notice staged by the signup-success flow (via pendingNoticeRef) must
    // SURVIVE this mode switch — consume it here instead of wiping it.
    setNotice(pendingNoticeRef.current);
    pendingNoticeRef.current = null;
    if (mode === 'signin') {
      setConfirmPassword('');
      setFullName('');
      setUsername('');
      setUsernameStatus('idle');
    }
  }, [mode]);

  // Navbar "Sign in" / "Sign up" call navigate('/auth', { state: { mode } })
  // even when we're already on /auth. `mode` is only read once on mount, so
  // sync the form when a NEW mode arrives via router state — otherwise the
  // same-path navigation looks like a no-op ("overlay resolves, back to the
  // same page").
  useEffect(() => {
    const stateMode = (location.state as { mode?: Mode } | null)?.mode;
    if (stateMode && stateMode !== mode) {
      setMode(stateMode);
    }
  }, [location.state, mode]);

  const go = () => navigate(from && from !== '/auth' ? from : '/dashboard', { replace: true });

  useEffect(() => {
    if (mode !== 'signup' || username.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    setUsernameStatus('checking');
    usernameTimer.current = setTimeout(async () => {
      const { data, error: checkError } = await supabase
        .from('profiles')
        .select('username')
        .ilike('username', username.trim())
        .maybeSingle();

      if (checkError) {
        setUsernameStatus('idle');
        return;
      }
      setUsernameStatus(data ? 'taken' : 'available');
    }, 500);
    return () => {
      if (usernameTimer.current) clearTimeout(usernameTimer.current);
    };
  }, [username, mode]);

  /** Navigate to the Guest Agreement page (instead of signing in directly). */
  const handleGuestClick = () => {
    setError(null);
    navigate('/guest-agreement');
  };

  const validateSignup = (): boolean => {
    const errors: Record<string, string> = {};

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required.';
    }

    if (!username.trim()) {
      errors.username = 'Username is required.';
    } else if (username.trim().length < 3) {
      errors.username = 'Username must be at least 3 characters.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      errors.username = 'Username can only contain letters, numbers, and underscores.';
    } else if (usernameStatus === 'taken') {
      errors.username = 'This username is already taken. Try another.';
    }

    if (!email.trim()) {
      errors.email = 'Email is required.';
    } else if (!isValidEmail(email.trim())) {
      errors.email = 'That email doesn\'t look right — double-check it.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (passwordErrors.length > 0) {
      errors.password = `Password must have: ${passwordErrors.join(', ')}`;
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords don\'t match — check both fields.';
    }

    if (!agreedToTerms) {
      errors.agreement = 'Please agree to the Terms & Conditions and Privacy Policy.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === 'signin') {
      if (!email.trim()) {
        setFieldErrors((prev) => ({ ...prev, email: 'Email is required.' }));
        return;
      }
      if (!isValidEmail(email.trim())) {
        setFieldErrors((prev) => ({ ...prev, email: 'That email doesn\'t look right — double-check it.' }));
        return;
      }
      if (!password) {
        setFieldErrors((prev) => ({ ...prev, password: 'Password is required.' }));
        return;
      }

      setSubmitting(true);
      // Show the branded overlay IMMEDIATELY on submit, then run the Supabase
      // network call under the cover — the user never stares at a dead button
      // spinner (measured ~850ms of spinner before the overlay appeared).
      try {
        await runAuthSubmit(
          { label: 'Welcome back', sublabel: 'Loading your workspace…' },
          async () => {
            try {
              const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
              });
              if (signInError) throw signInError;
              // Navigate under the cover; the overlay is held until the
              // dashboard shell has actually rendered (history loads in the
              // background — the reveal is never blocked on it). Use the user
              // id from the sign-in response directly — a separate getUser()
              // here is a redundant network round-trip.
              ensureHistory(signInData.user.id);
              go();
            } catch (err) {
              throw new Error(
                err instanceof Error &&
                  err.message.includes('Invalid login credentials')
                  ? 'Wrong email or password — try again.'
                  : err instanceof Error
                    ? err.message
                    : 'Something went wrong. Please try again.'
              );
            }
          }
        );
      } catch (err) {
        // runAuthSubmit has already dismissed the overlay — show the error.
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!validateSignup()) return;

    setSubmitting(true);
    // Branded overlay IMMEDIATELY on submit; the whole upgrade (guest detach +
    // signUp) runs UNDER the cover, then the form switches to sign-in mode.
    try {
      await runAuthSubmit(
        { label: 'Account created', sublabel: 'Redirecting to sign in…' },
        async () => {
          try {
            if (isGuest) {
              // Detaching the anonymous session fires Layout's user→null
              // sign-out effect — suppress it so the "Signing you out" overlay +
              // landing-page navigation don't fire mid-upgrade (Auth stays in
              // the app and drives its own "Account created" overlay instead).
              suppressNextSignoutTransition();
              await signOut();
            }

            const { error: signUpError } = await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: {
                data: {
                  full_name: fullName.trim(),
                  username: username.trim(),
                },
                emailRedirectTo: window.location.origin,
              },
            });
            if (signUpError) throw signUpError;

            // Switch mode under the cover: stage the message BEFORE switching
            // mode (the [mode] effect consumes pendingNoticeRef, so the notice
            // survives and shows on the sign-in form — a plain setNotice here
            // would be wiped by the same render batch).
            console.log('[QA-DEBUG] signup success path: switching mode to signin');
            pendingNoticeRef.current = 'Account created — please sign in below.';
            setMode('signin');
            console.log('[QA-DEBUG] after setMode — React hasn’t re-rendered yet');
            setPassword('');
            setConfirmPassword('');
            setFullName('');
            setUsername('');
            setUsernameStatus('idle');
            console.log('[QA-DEBUG] signup success: all setters queued');
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
            if (msg.includes('User already registered')) {
              pendingNoticeRef.current =
                'An account with this email already exists — sign in below.';
              setMode('signin');
              setPassword('');
              setConfirmPassword('');
              setFullName('');
              setUsername('');
              setUsernameStatus('idle');
            } else {
              throw new Error(
                msg.includes('duplicate key') || msg.includes('username')
                  ? 'This username is already taken — try another one.'
                  : msg
              );
            }
          }
        }
      );
    } catch (err) {
      // runAuthSubmit has already dismissed the overlay — show the error.
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setFieldErrors((prev) => ({ ...prev, email: 'Enter your email address first.' }));
      return;
    }
    if (!isValidEmail(email.trim())) {
      setFieldErrors((prev) => ({ ...prev, email: 'That email doesn\'t look right — double-check it.' }));
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      setResetSent(true);
      setNotice('Password reset link sent — check your inbox.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send reset link. Try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setOauthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start Google sign-in. Try again.'
      );
      setOauthLoading(false);
    }
  };
  return (
    <div className="mx-auto flex max-w-md flex-col pt-6 sm:pt-16 animate-fade-in">
      {/* ← Back to home */}
      <button
        onClick={() => navigate('/')}
        className="mb-6 flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
        aria-label="Back to home"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-8 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/20">
          <LogoMark className="h-7 w-7" />
        </span>
        <h1 className="font-heading text-3xl font-extrabold tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-2 text-muted">
          {mode === 'signin'
            ? 'Sign in to access your plans and progress.'
            : 'Save plans, track check-ins, and build momentum.'}
        </p>
      </div>

      {isGuest && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/8 to-transparent p-4 text-sm shadow-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="leading-relaxed text-muted">
            You're in preview mode. Creating an account starts a fresh session —
            preview results aren't saved, so sign up and generate again to keep
            your work.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={oauthLoading || submitting}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold transition-all duration-200 hover:bg-surface-hover hover:border-primary/30 hover:text-primary active:scale-[0.98] disabled:opacity-60"
        >
          {oauthLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SiGoogle className="h-4 w-4" />
          )}
          Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          or with email
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === 'signup' && (
            <>
              <div>
                <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Doe"
                    className={`w-full rounded-xl border bg-background py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2 ${
                      fieldErrors.fullName
                        ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                        : 'border-border focus:border-primary focus:ring-primary/20'
                    }`}
                  />
                </div>
                {fieldErrors.fullName && (
                  <p className="mt-1 text-xs text-destructive">{fieldErrors.fullName}</p>
                )}
              </div>

              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium">
                  Username <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="janedoe"
                    className={`w-full rounded-xl border bg-background py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2 ${
                      fieldErrors.username
                        ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                        : usernameStatus === 'available'
                          ? 'border-success focus:border-success focus:ring-success/20'
                          : 'border-border focus:border-primary focus:ring-primary/20'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {usernameStatus === 'checking' && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted" />
                    )}
                    {usernameStatus === 'available' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success/20 text-success">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    {usernameStatus === 'taken' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive/20 text-destructive">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </span>
                    )}
                  </span>
                </div>
                {fieldErrors.username ? (
                  <p className="mt-1 text-xs text-destructive">{fieldErrors.username}</p>
                ) : usernameStatus === 'available' ? (
                  <p className="mt-1 text-xs text-success">Username is available!</p>
                ) : usernameStatus === 'taken' ? (
                  <p className="mt-1 text-xs text-destructive">This username is already taken.</p>
                ) : null}
              </div>
            </>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => {
                    if (prev.email) {
                      const { email: _, ...rest } = prev;
                      return rest;
                    }
                    return prev;
                  });
                }}
                placeholder="you@example.com"
                className={`w-full rounded-xl border bg-background py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2 ${
                  fieldErrors.email
                    ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                    : 'border-border focus:border-primary focus:ring-primary/20'
                }`}
              />
            </div>
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => {
                    if (prev.password) {
                      const { password: _, ...rest } = prev;
                      return rest;
                    }
                    return prev;
                  });
                }}
                placeholder="••••••••"
                className={`w-full rounded-xl border bg-background py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2 ${
                  fieldErrors.password
                    ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                    : 'border-border focus:border-primary focus:ring-primary/20'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {mode === 'signup' && password.length > 0 && (
              <div className="mt-3">
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${strengthMeta.bar}`}
                    style={{ width: strengthMeta.width }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className={`text-xs font-semibold ${strengthMeta.color}`}>
                    {strengthMeta.label}
                  </span>
                  {strength !== 'strong' && passwordErrors.length > 0 && (
                    <span className="text-xs text-muted">
                      {passwordErrors.length} rule{passwordErrors.length !== 1 ? 's' : ''} left
                    </span>
                  )}
                </div>

                <ul className="mt-2 space-y-1">
                  {PASSWORD_RULES.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <li
                        key={rule.key}
                        className={`flex items-center gap-1.5 text-xs transition-all duration-200 ${
                          ok ? 'text-success' : 'text-muted/70'
                        }`}
                      >
                        <span className={`shrink-0 transition-colors ${ok ? 'text-success' : 'text-muted/40'}`}>
                          {ok ? '✓' : '○'}
                        </span>
                        {rule.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {fieldErrors.password && (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.password}</p>
            )}
          </div>

          {mode === 'signin' && !resetSent && (
            <div className="-mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={submitting}
                className="text-xs font-medium text-primary transition-all duration-200 hover:text-primary-hover hover:underline active:scale-[0.97]"
              >
                Forgot password?
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium">
                Confirm Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full rounded-xl border bg-background py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2 ${
                    confirmError || fieldErrors.confirmPassword
                      ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                      : confirmPassword && password && confirmPassword === password
                        ? 'border-success focus:border-success focus:ring-success/20'
                        : 'border-border focus:border-primary focus:ring-primary/20'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && password && confirmError && (
                <p className="mt-1 text-xs text-destructive">{confirmError}</p>
              )}
              {confirmPassword && password && !confirmError && password.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-success">
                  <CheckCircle className="h-3 w-3" />
                  Passwords match
                </p>
              )}
              {fieldErrors.confirmPassword && !confirmError && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.confirmPassword}</p>
              )}
            </div>
          )}

          {/* ── Agreement checkbox (Sign Up only) ── */}
          {mode === 'signup' && (
            <div className="pt-1">
              <AgreementCheckbox
                checked={agreedToTerms}
                onChange={setAgreedToTerms}
                disabled={submitting}
              />
              {fieldErrors.agreement && (
                <p className="mt-1.5 text-xs text-destructive">{fieldErrors.agreement}</p>
              )}
            </div>
          )}

          <div
            ref={liveMessageRef}
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          />

          {error && (
            <p className="animate-fade-in rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && mode === 'signin' && (
            <p className="animate-fade-in flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {notice}
            </p>
          )}
          {notice && mode === 'signup' && (
            <p className="animate-fade-in rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || (mode === 'signup' && !agreedToTerms)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-3.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        {/* Guest — navigates to Guest Agreement page */}
        <button
          onClick={handleGuestClick}
          disabled={guestLoading || submitting || oauthLoading}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/5 to-transparent px-4 py-3 text-sm font-semibold text-accent transition-all duration-200 hover:from-accent/10 hover:border-accent/50 active:scale-[0.98] disabled:opacity-60"
        >
          {guestLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserRound className="h-4 w-4" />
          )}
          Continue as guest
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-muted">
          No email or password needed. Your results won't be saved until you
          create an account.
        </p>
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
        <button
          onClick={() => {
            // Real router navigation (same path, new state) — the same
            // mechanism the Navbar's "Sign in"/"Sign up" links use. A plain
            // setMode() here is fought by the location.state sync effect
            // (it reverts the switch whenever the page was entered with a
            // state mode), so the link appeared dead. Pushing the new mode
            // through router state makes the switch instant and reliable,
            // and keeps the URL in sync with the form.
            navigate('/auth', {
              state: {
                ...(location.state as Record<string, unknown> | null),
                mode: mode === 'signin' ? 'signup' : 'signin',
              },
            });
            setError(null);
            setNotice(null);
            setFieldErrors({});
          }}
          className="font-semibold text-primary transition-all duration-200 hover:text-primary-hover hover:underline"
        >
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>

      {/* ── Branded transition overlay now renders globally in <Layout/> (it
             must survive navigation; a page-level overlay unmounts mid-transition) ── */}
    </div>
  );
}