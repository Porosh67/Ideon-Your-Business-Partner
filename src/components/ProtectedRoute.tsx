import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import IdeonLoader from '@/components/IdeonLoader';

/**
 * Route guard: requires a user session (including anonymous).
 * Redirects to /auth if no session. While the session is loading or a
 * sign-out is in flight it holds position with the branded Ideon loader —
 * never a generic spinner (loading-state spec).
 */
export default function ProtectedRoute() {
  const { user, loading, signingOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <IdeonLoader label="Loading Ideon" size="md" />
      </div>
    );
  }

  // While sign-out is in flight, hold position with the branded loader instead
  // of redirecting to /auth — the caller navigates to '/' immediately after,
  // and the redirect would otherwise win the race and strand the user on /auth.
  if (signingOut) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <IdeonLoader label="Signing you out" sublabel="One moment…" size="md" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
