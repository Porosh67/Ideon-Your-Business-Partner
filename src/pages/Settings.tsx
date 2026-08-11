import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { APP_NAME, APP_VERSION } from '@/constants/config';
import LogoMark from '@/components/LogoMark';
import { LegalDocument, PRIVACY_SECTIONS, TERMS_SECTIONS } from '@/lib/legalContent';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Scale,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────────
// Section registry (left-hand vertical nav)
// ────────────────────────────────────────────────────────────────────────────

type SectionKey = 'personal' | 'security' | 'privacy' | 'appinfo';

const SECTIONS: {
  key: SectionKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'personal', label: 'Personal Info', description: 'Your name, username, and email', icon: UserRound },
  { key: 'security', label: 'Security', description: 'Email, password, and sign-in security', icon: ShieldCheck },
  { key: 'privacy', label: 'Privacy', description: 'Privacy policy, terms, and your data', icon: Scale },
  { key: 'appinfo', label: 'App Info', description: 'About Ideon and version details', icon: Info },
];

const VALID_KEYS: SectionKey[] = ['personal', 'security', 'privacy', 'appinfo'];

// ────────────────────────────────────────────────────────────────────────────
// Shared UI primitives
// ────────────────────────────────────────────────────────────────────────────

type NoticeKind = 'success' | 'error' | 'info';

function Notice({ kind, children }: { kind: NoticeKind; children: ReactNode }) {
  const styles: Record<NoticeKind, string> = {
    success: 'border-success/30 bg-success/10 text-success',
    error: 'border-destructive/30 bg-destructive/10 text-destructive',
    info: 'border-primary/30 bg-primary/10 text-foreground',
  };
  const Icon = kind === 'success' ? CheckCircle : kind === 'error' ? AlertTriangle : Info;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`flex animate-fade-in items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles[kind]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

const inputBase =
  'w-full rounded-xl border bg-background py-2.5 pl-4 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:outline-none focus:ring-2';

function inputClass(hasError: boolean, extra = ''): string {
  return `${inputBase} ${
    hasError
      ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
      : 'border-border focus:border-primary focus:ring-primary/20'
  } ${extra}`;
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  ariaDescribedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  error?: string;
  ariaDescribedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        aria-invalid={error ? true : undefined}
        aria-describedby={ariaDescribedBy}
        className={`${inputClass(!!error)} py-2.5 pl-10 pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-0.5 text-muted transition-colors duration-150 hover:text-foreground"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Password strength (Weak / Medium / Strong — per spec)
// ────────────────────────────────────────────────────────────────────────────

const NEW_PW_RULES = [
  { key: 'len', label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { key: 'alnum', label: 'Letters and numbers', test: (p: string) => /[a-zA-Z]/.test(p) && /\d/.test(p) },
  { key: 'sym', label: 'At least one symbol', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
];

type Strength = 'none' | 'weak' | 'medium' | 'strong';

function computeStrength(pw: string): Strength {
  if (!pw) return 'none';
  const passed = NEW_PW_RULES.filter((r) => r.test(pw)).length;
  if (passed <= 1) return 'weak';
  if (passed === 2) return 'medium';
  return 'strong';
}

const STRENGTH_META: Record<Strength, { label: string; text: string; bar: string; width: string }> = {
  none: { label: '', text: '', bar: 'bg-subtle', width: 'w-0' },
  weak: { label: 'Weak', text: 'text-destructive', bar: 'bg-destructive', width: 'w-1/3' },
  medium: { label: 'Medium', text: 'text-warning', bar: 'bg-warning', width: 'w-2/3' },
  strong: { label: 'Strong', text: 'text-success', bar: 'bg-success', width: 'w-full' },
};

function StrengthMeter({ password }: { password: string }) {
  const strength = computeStrength(password);
  const meta = STRENGTH_META[strength];
  if (!password) return null;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${meta.bar}`}
          style={{ width: meta.width }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
        <span className="text-xs text-muted">
          {strength !== 'strong'
            ? `${NEW_PW_RULES.filter((r) => !r.test(password)).length} rule${
                NEW_PW_RULES.filter((r) => !r.test(password)).length !== 1 ? 's' : ''
              } left`
            : 'Looking strong'}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {NEW_PW_RULES.map((rule) => {
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
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Verify the user's current password against auth (used before sensitive changes). */
async function verifyCurrentPassword(email: string | null | undefined, password: string) {
  if (!email) return { ok: false as const, error: 'This account has no password — use a signed-in session.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      return { ok: false as const, error: 'Your current password is incorrect.' };
    }
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const };
}

/**
 * Returns true when the current account has an email+password identity. False
 * for OAuth-only sign-ups (Google, GitHub, Apple, ...) — those users do not
 * have a current password to enter in the Change Email / Change Password /
 * Delete Account flows, so the Security section exposes a dedicated
 * "Create a password" path for them.
 *
 * Three signals, checked in priority order:
 *  1. user.identities[] is present when the user came from a server fetch
 *     (e.g. getUser()); an 'email' identity means they can auth with a
 *     password (sign-up OR set later via updateUser({ password })).
 *  2. user.app_metadata.providers[] lists every linked identity provider on
 *     JWT-only payloads; 'email' in the list ⇒ they have a password.
 *  3. user.app_metadata.provider (single) — the original sign-up provider;
 *     only true for legacy email/password accounts.
 */
function userHasPassword(user: User | null | undefined): boolean {
  if (!user) return false;
  const identities = (user as unknown as { identities?: Array<{ provider?: string }> }).identities;
  if (Array.isArray(identities) && identities.length > 0) {
    return identities.some((id) => id?.provider === 'email');
  }
  const providers = user.app_metadata?.providers as string[] | undefined;
  if (Array.isArray(providers) && providers.length > 0) {
    return providers.includes('email');
  }
  return user.app_metadata?.provider === 'email';
}

/**
 * Two-step modal that lets a passwordless / OAuth-only user create a brand
 * new password on their account without leaving the Settings page. Step 1
 * confirms the recovery email; Step 2 sets + confirms the new password using
 * the same rules as the existing ChangePassword form. On success the modal
 * closes and refreshes the JWT so app_metadata reflects the new identity.
 */
function CreatePasswordModal({
  initialEmail,
  onClose,
  onSuccess,
}: {
  initialEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus the first field on open, lock body scroll while open, ESC to close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => emailRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleEmailContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Confirm your email to continue.');
      return;
    }
    if (!isValidEmail(email.trim())) {
      setError("That email doesn't look right — double-check it.");
      return;
    }
    setStep('password');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!next) {
      setError('Enter a new password.');
      return;
    }
    if (next.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError("Passwords don't match — check both fields.");
      return;
    }

    setSubmitting(true);
    try {
      // FIRST password set on an OAuth / passwordless account.
      //
      // The Supabase project's auth config sets
      // SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD = true, which
      // rejects `auth.updateUser({ password })` from the browser unless the
      // body also includes `current_password` — but a Google-only user has
      // no current password to send, so the server returns "Current password
      // required when setting new password." A plain `updateUser({ password,
      // current_password: undefined })` doesn't help: faking a current_password
      // would weaken security, and the field is required to actually match.
      //
      // We sidestep the check by routing through a tiny, JWT-gated edge
      // function (`set-first-password`): it re-verifies the caller's session
      // (proving they're the logged-in account owner) and writes the
      // password via the admin API, which is exempt from the
      // current_password check because it authenticates the request
      // out-of-band. This pattern is identical to the existing
      // `delete-account` function. After it succeeds, refresh the JWT so
      // app_metadata / identities reflect the new email/password capability
      // everywhere in the app.
      await callEdgeFunction('set-first-password', { password: next });

      // Tell the parent we are done — it closes the modal and surfaces a
      // success message. The refresh below updates user state so the
      // "Create a password" CTA is replaced by the standard Change Password
      // form on next render.
      try {
        await supabase.auth.refreshSession();
      } catch {
        // The admin write itself succeeded; a transient refresh failure is
        // not a hard failure for the user. The default page reload will
        // pick up the new server state.
      }
      // getUser() forces a server fetch so the canonical identities list is
      // available — `userHasPassword` reads from that to decide whether the
      // regular Change Password form should replace the CTA.
      await supabase.auth.getUser();

      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes('Function returned')
            ? "We couldn't create your password just now — please try again."
            : err.message
          : "We couldn't create your password — try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const liveConfirmError =
    confirm && next && confirm !== next ? "Passwords don't match — check both fields." : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pw-title"
    >
      <div
        className="w-full max-w-md animate-scale-in rounded-2xl border border-border bg-surface p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3
              id="create-pw-title"
              className="font-heading text-base font-bold tracking-tight text-foreground"
            >
              {step === 'email' ? 'Create a password' : 'Set your new password'}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {step === 'email'
                ? 'You signed in with a provider (e.g. Google), so there is no password on this account yet.'
                : 'Pick something strong — at least 8 characters with letters, numbers, and a symbol.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-90"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleEmailContinue} className="space-y-4" noValidate>
            <Field
              label="Confirm your email"
              htmlFor="cp-create-email"
              hint="We'll use this as the recovery address for your password."
              error={error ?? undefined}
            >
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  ref={emailRef}
                  id="cp-create-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  autoComplete="email"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'cp-create-email-error' : undefined}
                  className={`${inputClass(!!error)} py-2.5 pl-10`}
                />
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-muted transition-all duration-150 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSave} className="space-y-4" noValidate>
            <Field label="New password" htmlFor="cp-create-next">
              <PasswordInput
                id="cp-create-next"
                value={next}
                onChange={(v) => {
                  setNext(v);
                  setError(null);
                }}
                autoComplete="new-password"
              />
              {next && <StrengthMeter password={next} />}
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="cp-create-confirm"
              error={liveConfirmError}
            >
              <PasswordInput
                id="cp-create-confirm"
                value={confirm}
                onChange={(setConfirm)}
                autoComplete="new-password"
                ariaDescribedBy={liveConfirmError ? 'cp-create-confirm-error' : undefined}
              />
              {confirm && next && !liveConfirmError && next.length >= 8 && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-success">
                  <CheckCircle className="h-3 w-3" />
                  Passwords match
                </p>
              )}
            </Field>
            {error && <Notice kind="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
                className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-muted transition-all duration-150 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? 'Saving…' : 'Save password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 1 · Personal Info
// ────────────────────────────────────────────────────────────────────────────

function PersonalInfoSection() {
  const { user, isGuest } = useAuth();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [errors, setErrors] = useState<{ fullName?: string; username?: string }>({});
  const originalRef = useRef({ fullName: '', username: '' });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, username')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const full = (data?.full_name as string) ?? (meta?.full_name as string) ?? '';
      const uname = (data?.username as string) ?? (meta?.username as string) ?? '';
      setFullName(full);
      setUsername(uname);
      originalRef.current = { fullName: full, username: uname };
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setNotice(null);
    const errs: typeof errors = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required.';
    if (!username.trim()) errs.username = 'Username is required.';
    else if (username.trim().length < 3) errs.username = 'Username must be at least 3 characters.';
    else if (!/^[a-zA-Z0-9_]+$/.test(username.trim()))
      errs.username = 'Username can only contain letters, numbers, and underscores.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    if (
      fullName.trim() === originalRef.current.fullName &&
      username.trim() === originalRef.current.username
    ) {
      setNotice({ kind: 'info', text: 'No changes to save — your profile is already up to date.' });
      return;
    }

    setSaving(true);
    try {
      // Username uniqueness check (exclude self) before writing.
      if (username.trim().toLowerCase() !== originalRef.current.username.toLowerCase()) {
        const { data: taken } = await supabase
          .from('profiles')
          .select('id')
          .ilike('username', username.trim())
          .neq('id', user.id)
          .maybeSingle();
        if (taken) throw new Error('This username is already taken — try another one.');
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          username: username.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (profileErr) {
        if (profileErr.message.toLowerCase().includes('duplicate') || profileErr.message.toLowerCase().includes('username'))
          throw new Error('This username is already taken — try another one.');
        throw profileErr;
      }

      // Keep the sidebar header in sync (it reads user_metadata.full_name).
      if (fullName.trim() !== originalRef.current.fullName) {
        const { error: metaErr } = await supabase.auth.updateUser({
          data: { full_name: fullName.trim() },
        });
        if (metaErr) throw metaErr;
      }

      originalRef.current = { fullName: fullName.trim(), username: username.trim() };
      setNotice({ kind: 'success', text: 'Your profile has been updated.' });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof Error ? err.message : "We couldn't save your changes — try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="space-y-4">
          <div className="h-10 animate-pulse rounded-xl bg-subtle" />
          <div className="h-10 animate-pulse rounded-xl bg-subtle" />
          <div className="h-10 animate-pulse rounded-xl bg-subtle" />
          <span className="sr-only">Loading your profile…</span>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6" noValidate>
      <SectionHeading
        title="Personal Info"
        description="This is how you appear across Ideon. Your email is managed under Security."
      />

      <Card className="space-y-5">
        <Field label="Full name" htmlFor="pf-fullName" error={errors.fullName}>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="pf-fullName"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setErrors((p) => ({ ...p, fullName: undefined }));
              }}
              placeholder="Jane Doe"
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? 'pf-fullName-error' : undefined}
              className={`${inputClass(!!errors.fullName)} py-2.5 pl-10`}
            />
          </div>
        </Field>

        <Field label="Username" htmlFor="pf-username" error={errors.username}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">
              @
            </span>
            <input
              id="pf-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setErrors((p) => ({ ...p, username: undefined }));
              }}
              placeholder="janedoe"
              aria-invalid={errors.username ? true : undefined}
              aria-describedby={errors.username ? 'pf-username-error' : undefined}
              className={`${inputClass(!!errors.username)} py-2.5 pl-8`}
            />
          </div>
        </Field>

        <Field
          label="Email"
          htmlFor="pf-email"
          hint={isGuest ? 'Guest sessions have a temporary email.' : 'To change your email, go to Security → Change Email.'}
        >
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="pf-email"
              type="email"
              value={user?.email ?? 'No email on this account'}
              readOnly
              disabled
              className={`${inputBase} cursor-not-allowed border-border bg-subtle/60 py-2.5 pl-10 text-muted opacity-80`}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <Lock className="h-3.5 w-3.5 text-muted/60" />
            </span>
          </div>
        </Field>
      </Card>

      {notice && (
        <Notice kind={notice.kind}>{notice.text}</Notice>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2 · Security
// ────────────────────────────────────────────────────────────────────────────

function SecuritySection() {
  const { isGuest } = useAuth();
  const navigate = useNavigate();

  if (isGuest) {
    return (
      <div className="space-y-6">
        <SectionHeading
          title="Security"
          description="Keep your account safe and your credentials up to date."
        />
        <Card>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">You're exploring in guest mode</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Guest sessions don't have a password, so email and password settings aren't
                available here. Create an account to secure your workspace and keep your work.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/auth', { state: { mode: 'signup' } })}
              className="shrink-0 cursor-pointer rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg active:scale-[0.97]"
            >
              Create an account
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Security"
        description="Change your email or password. Sensitive changes require your current password."
      />
      <ChangeEmail />
      <ChangePassword />
    </div>
  );
}

function ChangeEmail() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setNewEmail('');
    setPassword('');
    setFieldErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const errs: typeof fieldErrors = {};
    if (!newEmail.trim()) errs.email = 'New email is required.';
    else if (!isValidEmail(newEmail.trim())) errs.email = "That email doesn't look right — double-check it.";
    else if (newEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase())
      errs.email = 'That is already your current email.';
    if (!password) errs.password = 'Enter your current password to confirm this change.';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const check = await verifyCurrentPassword(user?.email, password);
      if (!check.ok) {
        setFieldErrors({ password: check.error });
        return;
      }
      const { error: updErr } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (updErr) throw updErr;
      setSuccess(
        `We sent a confirmation link to ${newEmail.trim()}. Your email will update once you confirm it.`
      );
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update your email — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Mail className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-semibold">Change email</h3>
          <p className="text-xs text-muted">Current email: {user?.email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field
          label="New email"
          htmlFor="ce-newEmail"
          error={fieldErrors.email}
        >
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="ce-newEmail"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setFieldErrors((p) => ({ ...p, email: undefined }));
              }}
              placeholder="you@example.com"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'ce-newEmail-error' : undefined}
              className={`${inputClass(!!fieldErrors.email)} py-2.5 pl-10`}
            />
          </div>
        </Field>

        <Field
          label="Current password"
          htmlFor="ce-password"
          error={fieldErrors.password}
        >
          <PasswordInput
            id="ce-password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setFieldErrors((p) => ({ ...p, password: undefined }));
            }}
            autoComplete="current-password"
            ariaDescribedBy={fieldErrors.password ? 'ce-password-error' : undefined}
          />
        </Field>

        {error && <Notice kind="error">{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? 'Updating…' : 'Update email'}
          </button>
        </div>
      </form>
    </Card>
  );
}

function ChangePassword() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    current?: string;
    next?: string;
    confirm?: string;
  }>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // For passwordless / OAuth-only users (Google, GitHub, Apple, ...), expose
  // a "Create a password" path so they can later use the standard Change
  // Email / Change Password / Delete Account flows with that credential.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // Belt-and-braces: the server (admin.updateUserById) writes encrypted_password,
  // but GoTrue's JWT may not auto-attach an 'email' identity on the same
  // refresh — so userHasPassword(user) can still read `false` for a few
  // seconds. We force `hasPassword=true` from the moment the modal succeeds
  // so the standard form replaces the CTA in this session without waiting
  // for the next JWT refresh. Resets on remount, which is fine: a hard reload
  // picks up the canonical server state.
  const [passwordSetThisSession, setPasswordSetThisSession] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasPassword = userHasPassword(user) || passwordSetThisSession;

  const confirmError =
    confirm && next && confirm !== next ? "Passwords don't match — check both fields." : undefined;

  const resetForm = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setFieldErrors({});
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    // Return focus to the trigger so keyboard users land back on the
    // element that opened the dialog (a11y).
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const errs: typeof fieldErrors = {};
    if (!current) errs.current = 'Enter your current password.';
    if (!next) errs.next = 'Enter a new password.';
    else if (next.length < 8) errs.next = 'New password must be at least 8 characters.';
    if (!confirm) errs.confirm = 'Please confirm your new password.';
    else if (next !== confirm) errs.confirm = "Passwords don't match — check both fields.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const check = await verifyCurrentPassword(user?.email, current);
      if (!check.ok) {
        setFieldErrors({ current: check.error });
        return;
      }
      // The Supabase Auth server enforces
      // GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD (the project
      // default) — when the user already has a password, the request MUST
      // include the current one or the server rejects with
      // "Current password required when setting new password." We verified
      // `current` above via signInWithPassword, but that proof only lives
      // in our local state — we still have to forward it on the actual
      // write. (The dedicated Create Password modal below omits this on
      // purpose: passwordless / OAuth-only users are exempt server-side
      // because user.HasPassword() is false, so a plain
      // updateUser({ password }) succeeds for them.)
      const { error: updErr } = await supabase.auth.updateUser({
        password: next,
        current_password: current,
      });
      if (updErr) throw updErr;
      setSuccess('Your password has been updated. Use it the next time you sign in.');
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update your password — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-semibold">{hasPassword ? 'Change password' : 'Create a password'}</h3>
          <p className="text-xs text-muted">
            {hasPassword
              ? 'Use at least 8 characters with a mix of letters, numbers, and symbols.'
              : "You signed in with a provider (e.g. Google), so this account doesn't have a password yet."}
          </p>
        </div>
      </div>

      {!hasPassword ? (
        // Passwordless / OAuth-only users (Google, GitHub, Apple, ...) get a
        // single, dedicated "Create a password" path rather than the regular
        // three-field form. Showing the form-with-current-password-field here
        // would invite a Google user to fill it in and submit — the Supabase
        // Auth server would reject it with "Current password required when
        // setting new password." because the user has no password yet. (Even
        // for users who already created a password via this same flow once
        // before, the server still demands the current one to authorize any
        // further password change.) Sending the form off-screen for this
        // account type removes the wrong path from the UI.
        <div className="space-y-4">
          <Notice kind="info">
            Create a password to enable email + password sign-in and to
            authorize sensitive actions like Change email and Delete account.
            After it's set you can change it again here at any time.
          </Notice>
          <div className="flex justify-end">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => {
                setCreateModalOpen(true);
                setError(null);
                setSuccess(null);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
            >
              <KeyRound className="h-4 w-4" />
              Create a password
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Current password" htmlFor="cp-current" error={fieldErrors.current}>
            <PasswordInput
              id="cp-current"
              value={current}
              onChange={(v) => {
                setCurrent(v);
                setFieldErrors((p) => ({ ...p, current: undefined }));
              }}
              autoComplete="current-password"
              ariaDescribedBy={fieldErrors.current ? 'cp-current-error' : undefined}
            />
          </Field>

          <Field label="New password" htmlFor="cp-next" error={fieldErrors.next}>
            <PasswordInput
              id="cp-next"
              value={next}
              onChange={(v) => {
                setNext(v);
                setFieldErrors((p) => ({ ...p, next: undefined }));
              }}
              autoComplete="new-password"
              ariaDescribedBy={fieldErrors.next ? 'cp-next-error' : undefined}
            />
            {next && <StrengthMeter password={next} />}
          </Field>

          <Field label="Confirm new password" htmlFor="cp-confirm" error={fieldErrors.confirm ?? confirmError}>
            <PasswordInput
              id="cp-confirm"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                setFieldErrors((p) => ({ ...p, confirm: undefined }));
              }}
              autoComplete="new-password"
              ariaDescribedBy={fieldErrors.confirm || confirmError ? 'cp-confirm-error' : undefined}
            />
            {confirm && next && !confirmError && next.length >= 8 && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-success">
                <CheckCircle className="h-3 w-3" />
                Passwords match
              </p>
            )}
          </Field>

          {error && <Notice kind="error">{error}</Notice>}
          {success && <Notice kind="success">{success}</Notice>}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      )}

      {createModalOpen && (
        <CreatePasswordModal
          initialEmail={user?.email ?? ''}
          onClose={closeCreateModal}
          onSuccess={() => {
            setCreateModalOpen(false);
            // Force hasPassword=true immediately so the standard Change
            // Password form replaces the CTA without waiting for a JWT
            // refresh that may not include a new 'email' identity yet.
            setPasswordSetThisSession(true);
            setSuccess(
              'Your password has been set — you can now change your email or delete your account with it.'
            );
            // The "Create a password" trigger is gone (hasPassword is now
            // true and the form view has replaced the CTA). Move focus to
            // the first form field so keyboard users land somewhere
            // actionable.
            window.setTimeout(() => {
              const cpCurrent = document.getElementById('cp-current');
              if (cpCurrent instanceof HTMLInputElement) cpCurrent.focus();
              else triggerRef.current?.focus();
            }, 0);
          }}
        />
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3 · Privacy — Privacy Policy + Terms & Conditions + Delete Account
// ────────────────────────────────────────────────────────────────────────────




function DeleteAccount() {
  const { user, isGuest } = useAuth();
  const { afterSignout } = useAuthTransition();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    if (word !== 'DELETE') {
      setError('Type DELETE exactly to confirm you understand this is permanent.');
      return;
    }

    setSubmitting(true);
    try {
      // Verify the current password (skip for guest/anonymous sessions, which
      // have no password — the edge function still re-verifies the JWT).
      if (!isGuest) {
        const check = await verifyCurrentPassword(user.email, password);
        if (!check.ok) {
          setError(check.error);
          setSubmitting(false);
          return;
        }
      }

      // Permanently delete the account server-side (service role edge function).
      await callEdgeFunction('delete-account', { userId: user.id });

      // Clear the local session and return to the landing page under the
      // branded transition. The session token is invalid now (user deleted),
      // so swallow any sign-out network error — local state still clears.
      afterSignout(async () => {
        try {
          await supabase.auth.signOut();
        } catch {
          // User no longer exists server-side — the local session clears anyway.
        }
        window.location.replace('/');
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes('Function returned')
            ? "We couldn't delete your account right now — please try again."
            : err.message
          : "We couldn't delete your account right now — please try again."
      );
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <Trash2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-destructive">Delete account</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Permanently removes your profile, ideas, plans, conversations, check-ins, and
            attachments. This action cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              setError(null);
            }}
            aria-expanded={open}
            className="mt-3 cursor-pointer rounded-lg border border-destructive/40 px-3.5 py-2 text-sm font-semibold text-destructive transition-all duration-150 hover:bg-destructive/10 active:scale-[0.97]"
          >
            {open ? 'Cancel' : 'Delete account'}
          </button>
        </div>
      </div>

      {open && (
        <form onSubmit={handleDelete} className="mt-4 space-y-4 border-t border-border/70 pt-4 animate-fade-in" noValidate>
          <Notice kind="error">
            This is permanent. All of your data — including ideas, chats, check-ins, and
            attachments — will be erased and cannot be recovered.
          </Notice>

          <Field
            label='Type DELETE to confirm'
            htmlFor="da-word"
            error={undefined}
          >
            <input
              id="da-word"
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className={inputClass(false)}
            />
          </Field>

          {!isGuest && (
            <Field
              label="Current password"
              htmlFor="da-password"
              error={undefined}
            >
              <PasswordInput
                id="da-password"
                value={password}
                onChange={(v) => setPassword(v)}
                autoComplete="current-password"
              />
            </Field>
          )}
          {isGuest && (
            <p className="text-xs text-muted">
              Guest sessions don't have a password — typing DELETE is enough.
            </p>
          )}

          {error && <Notice kind="error">{error}</Notice>}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-destructive/20 transition-all duration-200 hover:bg-destructive/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {submitting ? 'Deleting…' : 'Permanently delete my account'}
          </button>
        </form>
      )}
    </Card>
  );
}

function PrivacySection({ onOpenTerms }: { onOpenTerms: () => void }) {
  return (
    <div className="space-y-8">
      <SectionHeading
        title="Privacy"
        description="How Ideon handles your data, your rights, and how to delete your account."
      />

      <Card className="space-y-6">
        <LegalDocument
          title="Privacy Policy"
          updatedLabel="Last updated: August 10, 2026"
          sections={PRIVACY_SECTIONS}
        />
      </Card>

      <Card>
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h3 className="font-semibold">Terms & Conditions</h3>
              <p className="text-xs text-muted">The rules that govern your use of Ideon.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenTerms}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground transition-all duration-150 hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-[0.97]"
          >
            Read Terms & Conditions
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </Card>

      <DeleteAccount />
    </div>
  );
}

function TermsSection({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Privacy
      </button>

      <Card>
        <LegalDocument
          title="Terms & Conditions"
          updatedLabel="Effective date: August 10, 2026"
          sections={TERMS_SECTIONS}
        />
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4 · App Info
// ────────────────────────────────────────────────────────────────────────────

function AppInfoSection() {
  return (
    <div className="space-y-6">
      <SectionHeading title="App Info" description="General information about Ideon." />

      <Card>
        <div className="flex flex-col items-center gap-5 py-4 text-center sm:flex-row sm:text-left">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/20">
            <LogoMark className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <h3 className="font-heading text-xl font-bold tracking-tight">{APP_NAME}</h3>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">
              {APP_NAME} is your AI-powered business partner. Turn raw ideas into researched,
              structured business plans, build a 30-day roadmap, and keep momentum with daily
              check-ins — all in one calm, focused workspace.
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Version {APP_VERSION}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Info className="h-4 w-4 text-primary" />
          Behind the scenes
        </h3>
        <ul className="space-y-2.5">
          {[
            ['Built with', 'React, Vite, and TypeScript for a fast, modern experience.'],
            ['Powered by', 'Groq-powered AI for instant, high-quality responses.'],
            ['Backend & data', 'Supabase handles authentication, storage, and your secure workspace.'],
            ['Made for', 'Founders, builders, and dreamers turning ideas into reality.'],
          ].map(([k, v]) => (
            <li key={k} className="flex items-start gap-3 text-sm">
              <span className="w-28 shrink-0 font-medium text-foreground">{k}</span>
              <span className="text-muted">{v}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-xs text-muted/70">
        © {new Date().getFullYear()} Ideon. All rights reserved.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Settings page shell — left nav + right content
// ────────────────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [legalView, setLegalView] = useState<'none' | 'terms'>('none');

  const rawSection = searchParams.get('section') as SectionKey | null;
  const section: SectionKey =
    rawSection && VALID_KEYS.includes(rawSection) ? rawSection : 'personal';

  const setSection = useCallback(
    (key: SectionKey) => {
      setLegalView('none');
      setSearchParams(key === 'personal' ? {} : { section: key }, { replace: true });
    },
    [setSearchParams]
  );

  // Leaving the Privacy section clears any open legal sub-view.
  useEffect(() => {
    if (section !== 'privacy') setLegalView('none');
  }, [section]);

  const renderContent = () => {
    if (legalView === 'terms') return <TermsSection onBack={() => setLegalView('none')} />;
    switch (section) {
      case 'personal':
        return <PersonalInfoSection />;
      case 'security':
        return <SecuritySection />;
      case 'privacy':
        return <PrivacySection onOpenTerms={() => setLegalView('terms')} />;
      case 'appinfo':
        return <AppInfoSection />;
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Back to Dashboard */}
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="mb-6 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-md shadow-primary/20">
            <SettingsIcon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
            <p className="mt-0.5 text-sm text-muted">Manage your account, security, and privacy.</p>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* Left: vertical section nav (horizontal chips on mobile) */}
        <nav
          aria-label="Settings sections"
          className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 md:sticky md:top-6 md:w-56 md:flex-col md:overflow-visible md:pb-0"
        >
          {SECTIONS.map((s) => {
            const active = section === s.key && legalView === 'none';
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-150 active:scale-[0.98] md:w-full ${
                  active
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                    : 'text-muted hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: section content */}
        <div className="min-w-0 flex-1 pb-4" key={legalView === 'terms' ? 'terms' : section}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}