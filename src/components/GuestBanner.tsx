import { useAuth } from '@/hooks/useAuth';
import { UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function GuestBanner() {
  const { isGuest } = useAuth();

  if (!isGuest) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5 bg-gradient-to-r from-accent/10 via-accent/8 to-accent/10 px-4 py-3 pt-4 text-sm text-center leading-relaxed shadow-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        <UserRound className="h-3.5 w-3.5" />
      </span>
      <span className="text-accent">
        You're exploring as a guest —{' '}
        <Link
          to="/auth"
          className="font-semibold underline underline-offset-2 decoration-accent/50 hover:decoration-accent hover:no-underline transition-all duration-200"
        >
          sign up
        </Link>{' '}
        to save your plans and track progress.
      </span>
    </div>
  );
}