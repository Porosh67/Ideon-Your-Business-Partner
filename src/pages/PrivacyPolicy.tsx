import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LegalDocument, PRIVACY_SECTIONS } from '@/lib/legalContent';

/**
 * Standalone Privacy Policy page.
 *
 * Opened from Sign Up, Guest Agreement, or any other place that links to
 * /privacy. The Back button uses navigate(-1) so it returns to wherever
 * the user came from — no hard-coded destination.
 */
export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl animate-fade-in pt-6 sm:pt-12">
      {/* Back button — returns to the exact page the user came from */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8">
        <LegalDocument
          title="Privacy Policy"
          updatedLabel="Last updated: August 10, 2026"
          sections={PRIVACY_SECTIONS}
        />
      </div>
    </div>
  );
}
