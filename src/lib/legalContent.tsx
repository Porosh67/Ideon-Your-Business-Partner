import { Link } from 'react-router-dom';

// ────────────────────────────────────────────────────────────────────────────
// Shared Privacy Policy & Terms content (used by Settings, Auth, Guest
// Agreement, and standalone Privacy/Terms pages).
// ────────────────────────────────────────────────────────────────────────────

export const PRIVACY_SECTIONS: { title: string; body: string; bullets?: string[] }[] = [
  {
    title: 'Introduction',
    body: `This Privacy Policy explains how Ideon ("we", "us", "our") collects, uses, stores, and protects your information when you use our AI-powered business idea and planning assistant ("the Service"). By creating an account or using the Service, you agree to the practices described in this policy.`,
  },
  {
    title: 'Information We Collect',
    body: 'We collect only the information needed to run the Service, in three categories:',
    bullets: [
      'Account information — your name, username, email address, and authentication details (or a guest session identifier) provided when you sign up or sign in.',
      'Usage data — pages you visit, features you use, check-in submissions, and timestamps, used to operate the Service and understand how it is used.',
      'Content you voluntarily provide — your business ideas, conversations with the assistant, generated plans and roadmaps, check-in notes, and any files you attach. This content is stored in your private workspace and used solely to provide the Service to you.',
    ],
  },
  {
    title: 'How We Use Your Information',
    body: 'We use your information to:',
    bullets: [
      'Provide and maintain the Service — generate plans, answer your questions, run daily check-ins, and keep your workspace in sync.',
      'Improve our product — through aggregated, de-identified usage analytics. We never sell your personal information.',
      'Maintain security and prevent abuse — detect unauthorized access, enforce our Terms, and keep the Service safe.',
      'Communicate with you — send important service notices, respond to support requests, and (with your consent) share product updates.',
    ],
  },
  {
    title: 'AI Processing',
    body: `The Service uses AI models (currently powered by Groq) to generate business plans, answer questions, and provide suggestions. When you send a message or describe a business idea, the relevant text is processed by these models to produce a response. We do not use your content to train external AI models. Processed content is stored in your private workspace so you can review it later.`,
  },
  {
    title: 'Data Storage & Security',
    body: `Your data is stored in a Supabase (PostgreSQL) database with Row-Level Security (RLS) enabled. This means your data is isolated — only you (or the system acting on your behalf) can access it. All communication between your browser and our servers is encrypted with HTTPS. We implement industry-standard security practices, but no system is completely immune to threats.`,
  },
  {
    title: 'Third-Party Services',
    body: 'We use the following third-party services to operate the Service:',
    bullets: [
      'Supabase — database, authentication, and file storage. Data is hosted on secure cloud infrastructure.',
      'Groq — AI model inference for generating plans and responses. Your messages are sent to Groq\'s API for processing.',
      'Brave Search API — used to perform live web searches when you ask about current events or market data.',
    ],
  },
  {
    title: 'Your Rights',
    body: 'You have the right to:',
    bullets: [
      'Access your data — view all your ideas, plans, conversations, and check-ins from your workspace.',
      'Export your data — download your content at any time.',
      'Delete your data — permanently delete your account and all associated data from Settings → Privacy. This action is irreversible.',
      'Stop using the Service — you are not required to use the Service and may stop at any time.',
    ],
  },
  {
    title: 'Data Retention',
    body: `We retain your data for as long as your account is active. When you delete your account, all associated data (ideas, plans, conversations, check-ins, attachments) is permanently removed from our databases. Some anonymized, aggregated analytics may be retained for product improvement purposes but cannot be linked back to you.`,
  },
  {
    title: 'Children\'s Privacy',
    body: `The Service is not intended for use by individuals under the age of 16. We do not knowingly collect information from children. If you believe a child has provided us with personal information, please contact us and we will take steps to remove that information.`,
  },
  {
    title: 'Changes to This Policy',
    body: `We may update this Privacy Policy from time to time. When we do, the updated version will be posted on this page with a new "Last updated" date. For material changes, we will make reasonable efforts to notify you. Continued use of the Service after changes take effect means you accept the updated Policy.`,
  },
  {
    title: 'Contact',
    body: `Questions about this Privacy Policy can be sent to privacy@ideon.app.`,
  },
];

export const TERMS_SECTIONS: { title: string; body: string; bullets?: string[] }[] = [
  {
    title: '1. Acceptance of Terms',
    body: `By creating an account or using Ideon ("the Service"), you agree to these Terms & Conditions. If you do not agree to these Terms, do not use the Service. These Terms apply to all users, including guests who use the Service without creating a full account.`,
  },
  {
    title: '2. Description of Service',
    body: `Ideon is an AI-powered business idea and planning assistant. It helps you explore business ideas, generate researched business plans and roadmaps, track daily check-ins, and answer business-related questions. The Service is provided as a web application accessible through modern web browsers.`,
  },
  {
    title: '3. User Accounts',
    body: `You may use the Service with a registered account (email + password or Google OAuth) or as a guest (anonymous session). You are responsible for maintaining the security of your account credentials. Guest sessions are temporary — data created during a guest session will not persist unless you create a full account. You must provide accurate information when creating an account and must not impersonate another person or entity.`,
  },
  {
    title: '4. Acceptable Use',
    body: 'You agree not to:',
    bullets: [
      'Use the Service for any unlawful purpose or in violation of any applicable laws or regulations.',
      'Attempt to gain unauthorized access to any part of the Service, other users\' data, or related systems.',
      'Upload content that is malicious, defamatory, obscene, or infringes on another person\'s intellectual property rights.',
      'Use the Service to generate content that promotes hate, violence, discrimination, or misinformation.',
      'Attempt to reverse-engineer, decompile, or disassemble any part of the Service.',
      'Use automated systems (bots, scrapers) to access the Service without our written permission.',
    ],
  },
  {
    title: '5. AI-Generated Content',
    body: `The Service generates business plans, suggestions, and responses using AI models. This content is provided for informational and planning purposes only. AI-generated content may be inaccurate, incomplete, or outdated. It does not constitute financial, legal, tax, or professional advice. You are solely responsible for evaluating and verifying any output before relying on it for business decisions. Ideon makes no warranty that AI-generated content is error-free or suitable for any particular purpose.`,
  },
  {
    title: '6. Your Content',
    body: `You retain all ownership of the content you submit to the Service (business ideas, notes, files). By using the Service, you grant us a limited license to process, store, and display your content solely for the purpose of providing the Service to you. We do not claim ownership of your content and do not use your content for any purpose other than operating the Service.`,
  },
  {
    title: '7. Disclaimer of Warranties',
    body: `The Service is provided "as is" and "as available" without warranties of any kind, either express or implied. Ideon does not guarantee that the Service will be uninterrupted, error-free, or secure. AI-generated business plans, market research, and suggestions may be inaccurate, incomplete, or outdated. It is provided for informational purposes only and does not constitute financial, legal, tax, or professional advice. You are responsible for independently evaluating any output before relying on it. Ideon makes no warranty that AI-generated content is error-free.`,
  },
  {
    title: '8. Limitation of Liability',
    body: `To the maximum extent permitted by law, Ideon and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, or goodwill, arising out of or in connection with your use of the Service. The Service is provided "as is" and "as available", without warranties of any kind, express or implied.`,
  },
  {
    title: '9. Account Termination',
    body: `You may delete your account at any time from Settings → Privacy, which removes your data and terminates your access. We may suspend or terminate your access if we reasonably believe you have violated these Terms or the law, or if continued access would create a risk to the Service or other users.`,
  },
  {
    title: '10. Changes to These Terms',
    body: `We may update these Terms from time to time. When we do, the updated version will be posted on this page with a new effective date. For material changes, we will make reasonable efforts to notify you. Continued use of the Service after changes take effect means you accept the updated Terms.`,
  },
  {
    title: '11. Governing Law',
    body: `These Terms are governed by the laws of the jurisdiction in which you reside, excluding its conflict-of-law principles. If you are located outside any jurisdiction with a clear governing framework, the laws of the United States shall apply. Any disputes shall be resolved in the courts of that jurisdiction.`,
  },
  {
    title: '12. Contact',
    body: `Questions about these Terms can be sent to legal@ideon.app.`,
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Shared legal document renderer
// ────────────────────────────────────────────────────────────────────────────

export function LegalDocument({
  title,
  updatedLabel,
  sections,
}: {
  title: string;
  updatedLabel: string;
  sections: { title: string; body: string; bullets?: string[] }[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted">{updatedLabel}</p>
      </div>
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
          <p className="text-sm leading-relaxed text-muted">{s.body}</p>
          {s.bullets && (
            <ul className="space-y-1.5 pl-4">
              {s.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm leading-relaxed text-muted">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared agreement checkbox (used by Sign Up and Guest Agreement)
//
// Uses a controlled checkbox pattern: the visible box is a <span> that the
// user clicks, and the hidden <input> keeps the form semantics (screen
// readers, form submission). The input is positioned absolutely over the
// visual box so it receives clicks directly.
//
// Links use React Router's <Link> so navigation stays in the same tab —
// the Back button (navigate(-1)) then works correctly.
// ────────────────────────────────────────────────────────────────────────────

export function AgreementCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 select-none ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} group`}>
      {/* Hidden but in-flow input: positioned over the visual box so it
          receives clicks. Not sr-only (off-screen) because that breaks
          label-click forwarding and automated testing. */}
      <span className="relative mt-0.5 h-5 w-5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="absolute inset-0 h-5 w-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-label="Agree to Terms & Conditions and Privacy Policy"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all duration-200 ${
            checked
              ? 'border-primary bg-primary'
              : 'border-border bg-background group-hover:border-primary/50'
          }`}
        >
          {checked && (
            <svg className="h-3 w-3 text-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      </span>
      <span className="text-sm leading-relaxed text-muted">
        I agree to the{' '}
        <Link
          to="/terms"
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Terms &amp; Conditions
        </Link>{' '}
        and{' '}
        <Link
          to="/privacy"
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Privacy Policy
        </Link>
      </span>
    </label>
  );
}
