import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { useTheme } from '@/hooks/useTheme';
import LogoMark from '@/components/LogoMark';
import TransitionLoader from '@/components/TransitionLoader';
import { useTransitionOverlay } from '@/lib/transitionStore';
import { Menu, Moon, Rocket, Sun, X } from 'lucide-react';

/** Static visual logo — not clickable. */
function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/20 transition-all duration-300 hover:shadow-primary/30">
        <LogoMark />
      </span>
      <span className="font-heading text-lg font-semibold tracking-tight">
        Ideon
      </span>
    </span>
  );
}

/**
 * Public layout: scrollable pages for logged-out visitors (/, /auth, /learn-more,
 * /privacy, /terms, /guest-agreement). No sidebar, no h-screen lock — users can
 * scroll freely through landing, features, and auth forms.
 */
export default function PublicLayout() {
  const { loading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { goToAuth } = useAuthTransition();
  const overlay = useTransitionOverlay();
  const [menuOpen, setMenuOpen] = useState(false);

  const themeToggle = (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:text-primary active:scale-[0.95]"
    >
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );

  return (
    <div className="flex min-h-screen w-full flex-col overflow-y-auto bg-background text-foreground">
      {/* ── Top header for logged-out visitors ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />

          {/* Desktop actions */}
          <div className="hidden items-center gap-3 md:flex">
            {themeToggle}
            {loading ? null : (
              <>
                <button
                  type="button"
                  onClick={() => goToAuth('signin')}
                  className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:text-primary active:scale-[0.97]"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => goToAuth('signup')}
                  className="cursor-pointer rounded-lg bg-gradient-to-br from-primary to-secondary px-4 py-2 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
                >
                  Sign up
                </button>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav
            className="border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-xl md:hidden"
            aria-label="Mobile"
          >
            <div className="flex flex-col gap-3">
              {themeToggle}
              {loading ? null : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      goToAuth('signin');
                    }}
                    className="cursor-pointer rounded-lg border border-border px-4 py-2 text-center text-sm font-semibold text-foreground"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      goToAuth('signup');
                    }}
                    className="cursor-pointer rounded-lg bg-gradient-to-br from-primary to-secondary px-4 py-2 text-center text-sm font-semibold text-on-primary shadow-md"
                  >
                    Sign up
                  </button>
                </div>
              )}
            </div>
          </nav>
        )}
      </header>

      {/* ── Page content ── */}
      <main className="w-full flex-1">
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
          <p className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground/80">Ideon</span>
            <span className="hidden sm:inline">— from idea to plan in minutes.</span>
          </p>
          <p>© {new Date().getFullYear()} Ideon</p>
        </div>
      </footer>

      {/* ── Full-screen branded transition overlay ── */}
      {overlay && <TransitionLoader state={overlay} />}
    </div>
  );
}
