import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSidebarState } from '@/hooks/useSidebar';
import GuestBanner from '@/components/GuestBanner';
import Sidebar from '@/components/Sidebar';
import TransitionLoader from '@/components/TransitionLoader';
import { useTransitionOverlay } from '@/lib/transitionStore';
import { Rocket } from 'lucide-react';

/**
 * App/Dashboard layout: locked full-screen with sidebar, used for authenticated
 * routes (/dashboard, /reports, /settings, /ideas/*, /checkin).
 * No header — navigation is through the sidebar. The h-screen / overflow-hidden
 * lock is essential for the chat-like Dashboard surface.
 */
export default function AppLayout() {
  const { user } = useAuth();
  const overlay = useTransitionOverlay();
  const { collapsed, toggle } = useSidebarState();
  const location = useLocation();

  // The Dashboard is a full-height chat surface (Gemini-style) — strip the
  // vertical page padding and hide the marketing footer there.
  const isChatRoute = location.pathname === '/dashboard';
  // Settings is a standalone full-screen page — hide the sidebar entirely.
  const isSettingsRoute = location.pathname === '/settings';

  // Signed-in users get all navigation from the sidebar; the content
  // area shifts right on desktop to make room for the rail.
  const contentOffsetClass = `transition-[padding] duration-200 ease-out ${
    collapsed ? 'md:pl-16' : 'md:pl-64'
  }`;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Persistent app sidebar: fixed desktop rail + mobile top bar/drawer.
          HIDDEN on the standalone Settings route. */}
      {user && !isSettingsRoute && (
        <Sidebar collapsed={collapsed} onToggleCollapse={toggle} />
      )}

      <GuestBanner />

      <main
        className={`w-full flex-1 min-h-0 min-w-0 px-4 sm:px-6 ${
          isSettingsRoute
            ? 'overflow-y-auto'
            : isChatRoute
              ? `flex flex-col overflow-hidden ${contentOffsetClass}`
              : `mx-auto max-w-6xl overflow-y-auto py-10 lg:py-12 ${contentOffsetClass}`
        }`}
      >
        {/* Keyed by pathname: every route change re-mounts this wrapper, so the
            incoming page does a gentle 350ms rise+fade instead of a hard
            "drop-in". The previous route is still covered by the overlay while
            it happens — no flash, no layout jump.
            Chat routes use flex-1 (no min-h-full) so height is distributed by
            the parent flex container — avoids double-scrollbar and height
            mismatch between iframe preview and native browser window. */}
        <div
          key={location.pathname}
          className={`page-enter flex w-full flex-col ${
            isChatRoute
              ? 'flex-1 min-h-0'
              : isSettingsRoute
                ? 'py-10 lg:py-12'
                : 'min-h-full'
          }`}
        >
          <Outlet />
        </div>
      </main>

      {!isChatRoute && !isSettingsRoute && (
        <footer className="border-t border-border">
          <div
            className={`mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6 ${contentOffsetClass}`}
          >
            <p className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary" />
              <span className="font-medium text-foreground/80">Ideon</span>
              <span className="hidden sm:inline">— from idea to plan in minutes.</span>
            </p>
            <p>© {new Date().getFullYear()} Ideon</p>
          </div>
        </footer>
      )}

      {/* ── Full-screen branded transition overlay ── */}
      {overlay && <TransitionLoader state={overlay} />}
    </div>
  );
}
