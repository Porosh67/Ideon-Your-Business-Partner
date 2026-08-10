import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  /** True while sign-out is in flight; ProtectedRoute shows the branded loader
   *  and the guard is only released once the user has landed on a public route. */
  signingOut: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isGuest: false,
  signingOut: false,
  signOut: async () => {},
});

/** Route prefixes guarded by ProtectedRoute. */
const PROTECTED_PREFIXES = ['/dashboard', '/checkin', '/ideas'];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Restore the persisted session, then VALIDATE it. A stored session can
      // be dead while localStorage still claims it: anonymous users are
      // deleted server-side on sign-out, and long-absent sessions may have
      // had their refresh token revoked. Refresh once — if that fails, clear
      // the local session so the app falls back to the signed-out state
      // instead of a zombie session that 401s every query (empty sidebar,
      // seemingly logged-in but broken pages).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        try {
          const { data: refreshed, error } = await supabase.auth.refreshSession();
          if (cancelled) return;
          if (!error && refreshed.session) {
            setUser(refreshed.session.user);
          } else if (error && (error.status === 400 || error.status === 401)) {
            // Definitively dead (revoked / deleted anonymous user) — clear it
            // so we don't run with a zombie session that 401s every query.
            // Direct call, NOT the guarded signOut below: no navigation or
            // loader should happen on restore.
            setUser(null);
            await supabase.auth.signOut();
          } else {
            // Network blip or ambiguous — keep the stored session rather than
            // force-signing the user out on a flaky connection.
            setUser(data.session.user);
          }
        } catch {
          if (!cancelled) setUser(data.session.user);
        }
      } else {
        setUser(null);
      }
      if (!cancelled) setLoading(false);
    })();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const isGuest =
    user?.app_metadata?.provider === 'anonymous' || user?.is_anonymous === true;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
    } finally {
      // Intentionally NOT released here. The caller navigates to a public
      // route (e.g. '/' from the sidebar) while the guard is still up, so
      // ProtectedRoute can never see user===null && !signingOut and redirect
      // to /auth mid-sign-out. The effect below releases the guard once the
      // user is on a public route — deterministic, no setTimeout race.
    }
  };

  // Release the sign-out guard only once we're no longer on a protected
  // route. Releasing it there would let ProtectedRoute redirect to /auth
  // (user is already null), racing the caller's navigate('/') and stranding
  // the user on the auth page.
  useEffect(() => {
    if (signingOut && !user && !isProtectedPath(location.pathname)) {
      setSigningOut(false);
    }
  }, [signingOut, user, location.pathname]);

  return (
    <AuthContext.Provider
      value={{ user, loading, isGuest, signingOut, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
