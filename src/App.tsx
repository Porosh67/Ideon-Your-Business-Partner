import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import PublicLayout from '@/components/PublicLayout';
import AppLayout from '@/components/AppLayout';
import ProtectedRoute from '@/components/ProtectedRoute';

// Route-level code splitting: each page downloads only when visited,
// keeping the initial bundle small and fast to load.
const loadHome = () => import('@/pages/Home');
const loadLearnMore = () => import('@/pages/LearnMore');
const loadAuth = () => import('@/pages/Auth');
const loadIdeaNew = () => import('@/pages/IdeaNew');
const loadIdeaView = () => import('@/pages/IdeaView');
const loadDashboard = () => import('@/pages/Dashboard');
const loadCheckIn = () => import('@/pages/CheckIn');
const loadSettings = () => import('@/pages/Settings');
const loadReports = () => import('@/pages/Reports');
const loadReportView = () => import('@/pages/ReportView');
const loadPrivacyPolicy = () => import('@/pages/PrivacyPolicy');
const loadTerms = () => import('@/pages/Terms');
const loadGuestAgreement = () => import('@/pages/GuestAgreement');

const Home = lazy(loadHome);
const LearnMore = lazy(loadLearnMore);
const Auth = lazy(loadAuth);
const IdeaNew = lazy(loadIdeaNew);
const IdeaView = lazy(loadIdeaView);
const Dashboard = lazy(loadDashboard);
const CheckIn = lazy(loadCheckIn);
const Settings = lazy(loadSettings);
const Reports = lazy(loadReports);
const ReportView = lazy(loadReportView);
const PrivacyPolicy = lazy(loadPrivacyPolicy);
const Terms = lazy(loadTerms);
const GuestAgreement = lazy(loadGuestAgreement);

/** Preload every lazy route chunk in the background so the FIRST navigation
 *  to any page hits a warm module cache — transitions never wait on a chunk
 *  download. All chunks are tiny (2–7KB gzipped), so the cost is negligible. */
const ROUTE_LOADERS = [
  loadHome, loadLearnMore, loadAuth, loadIdeaNew, loadIdeaView,
  loadDashboard, loadCheckIn, loadSettings, loadReports, loadReportView,
  loadPrivacyPolicy, loadTerms, loadGuestAgreement,
];
function usePreloadRoutes() {
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number;
    };
    const run = () => {
      for (const loader of ROUTE_LOADERS) void loader();
    };
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 500);
  }, []);
}

/** Skeleton shown while a lazy route chunk loads. */
function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-2/3 max-w-md animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-4 w-1/2 max-w-xs animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-muted motion-reduce:animate-none" />
      </div>
      <div className="h-64 animate-pulse rounded-2xl border border-border bg-muted motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  usePreloadRoutes();
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* ── Public routes: fully scrollable layout ── */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/learn-more" element={<LearnMore />} />
              <Route path="/auth" element={<Auth />} />

              {/* Standalone legal pages (opened from Auth, Guest Agreement, etc.) */}
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<Terms />} />

              {/* Guest agreement (shown before entering Dashboard as guest) */}
              <Route path="/guest-agreement" element={<GuestAgreement />} />
            </Route>

            {/* ── App routes: locked h-screen with sidebar (requires session) ── */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/ideas/new" element={<IdeaNew />} />
                <Route path="/ideas/:id" element={<IdeaView />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/checkin" element={<CheckIn />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/reports/:id" element={<ReportView />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
