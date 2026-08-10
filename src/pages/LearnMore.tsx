import { useAuthTransition } from '@/hooks/useAuthTransition';
import { useMarkRouteReady } from '@/lib/transitionStore';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Globe,
  LineChart,
  ListChecks,
  MessageSquareText,
  Rocket,
  Search,
  Sparkles,
} from 'lucide-react';

const STEPS = [
  {
    num: '1',
    icon: MessageSquareText,
    title: 'Describe your idea',
    text: 'Type your business idea in plain language — no business plan, no jargon, no spreadsheets. "A meal-prep service for busy professionals" is enough.',
  },
  {
    num: '2',
    icon: Search,
    title: 'We research live',
    text: 'Ideon runs real-time web research on competitors, pricing, and market trends, so the plan is grounded in current data — not generic advice.',
  },
  {
    num: '3',
    icon: Rocket,
    title: 'Get your plan',
    text: 'You receive a structured business plan, a 30-day roadmap with skills to learn, and a skill-gap summary — ready to act on today.',
  },
];

const FEATURES = [
  {
    icon: Globe,
    title: 'Live market research',
    text: 'Real competitor, pricing, and trend data pulled from the live web via Bright Data — not stale guesses.',
  },
  {
    icon: Bot,
    title: 'AI-generated business plans',
    text: 'A structured plan — target customer, cost estimate, competitor summary, first steps — built with Groq.',
  },
  {
    icon: ListChecks,
    title: 'Roadmap & skill-gap',
    text: 'A 30-day task checklist and the skills you need to learn, generated with Google Gemini.',
  },
  {
    icon: MessageSquareText,
    title: 'Intelligent chat assistant',
    text: 'Ask follow-up questions, brainstorm ideas, or get real-time answers — Ideon keeps your plan in context.',
  },
  {
    icon: CalendarDays,
    title: 'Daily check-ins',
    text: 'Log mood and energy each day and get a short AI coach message to keep your momentum.',
  },
];

const FAQS = [
  {
    q: 'Do I need an account to try Ideon?',
    a: 'No. You can explore Ideon as a guest right away — no email or password needed. When you\'re ready to save your plans and conversations, create a free account to keep everything across devices.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Your ideas, plans, and check-ins are stored securely in your own account and protected with row-level security — only you can see them. Guest sessions are isolated and never mixed with other users\' data.',
  },
  {
    q: 'I don\'t have an idea yet. Can Ideon still help?',
    a: 'Absolutely. Ask Ideon for business idea suggestions in any industry or niche you care about, and it will propose concrete opportunities — then you can develop the one you like into a full researched plan.',
  },
  {
    q: 'Is Ideon free?',
    a: 'You can generate plans and chat with Ideon right now at no cost. Live web research and AI generation use real third-party services, so usage-based costs may apply at scale in the future — but exploring your first ideas is free.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-2xl border border-border bg-surface/60 transition-all duration-300 hover:border-primary/30 hover:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 [&::-webkit-details-marker]:hidden">
        <h3 className="font-heading text-base font-bold tracking-tight">{q}</h3>
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-all duration-300 group-open:rotate-45 group-open:border-primary/40 group-open:text-primary"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </summary>
      <div className="px-6 pb-6">
        <p className="text-sm leading-relaxed text-muted">{a}</p>
      </div>
    </details>
  );
}

/** Reusable CTA pair — Sign in (secondary) + Sign up (primary). */
function AuthButtons({
  goToAuth,
}: {
  goToAuth: (mode?: 'signin' | 'signup') => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <button
        type="button"
        onClick={() => goToAuth('signin')}
        className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:scale-[0.97] sm:w-auto"
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={() => goToAuth('signup')}
        className="group inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-6 py-3 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] sm:w-auto"
      >
        Sign up
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </button>
    </div>
  );
}

export default function LearnMore() {
  const { goToAuth } = useAuthTransition();
  // Marks this route as rendered so a pending branded transition dismisses
  // exactly when the page is actually visible (see useAuthTransition).
  useMarkRouteReady();
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center overflow-y-auto">
      {/* ── Background layers ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern" />
        <div className="absolute -top-80 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/8 to-transparent blur-3xl" />
        <div className="absolute top-40 right-[5%] h-[400px] w-[400px] rounded-full bg-gradient-to-b from-accent/6 to-transparent blur-3xl max-lg:hidden" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-transparent to-background" />
      </div>

      {/* ── Hero ── */}
      <section className="relative flex w-full max-w-3xl flex-col items-center pt-12 text-center sm:pt-20">
        <span className="mb-6 inline-flex animate-fade-in items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary shadow-sm">
          <Sparkles className="h-4 w-4" />
          Your AI business co-pilot
        </span>
        <h1 className="animate-slide-up font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          How <span className="text-gradient-accent">Ideon</span> works
        </h1>
        <p className="mt-6 max-w-xl animate-fade-in text-lg leading-relaxed text-muted">
          From a rough idea to a researched, structured plan — in minutes, not
          months. Here's exactly what happens when you describe your idea.
        </p>
        <div className="mt-10 animate-fade-in">
          <AuthButtons goToAuth={goToAuth} />
        </div>
      </section>

      {/* ── Three steps ── */}
      <section className="mt-24 w-full max-w-4xl" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-center font-heading text-3xl font-extrabold tracking-tight">
          Three steps, <span className="text-gradient">one clear direction</span>
        </h2>
        <div className="relative mt-12">
          <div
            aria-hidden="true"
            className="absolute left-[27px] top-0 bottom-0 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent max-sm:hidden"
          />
          <ol className="space-y-6">
            {STEPS.map((s, i) => (
              <li
                key={s.num}
                className="group animate-slide-up flex items-start gap-5 rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:bg-surface hover:shadow-card-hover"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-heading text-base font-bold text-on-primary shadow-md shadow-primary/20 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-primary/30">
                  {s.num}
                </span>
                <div className="pt-1">
                  <h3 className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
                    <s.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Core features ── */}
      <section className="mt-24 w-full max-w-4xl" aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-center font-heading text-3xl font-extrabold tracking-tight">
          Everything you need to <span className="text-gradient-accent">launch</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          Ideon pairs real-time research with AI generation at every stage of your journey.
        </p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group animate-slide-up rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:bg-surface hover:shadow-card-hover"
            >
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-sm ring-1 ring-primary/10 transition-all duration-300 group-hover:scale-110 group-hover:from-primary/30 group-hover:to-primary/10">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-base font-bold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
          {/* Spacer card to balance the 3-col grid at 5 items */}
          <div className="hidden lg:block" aria-hidden="true" />
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="mt-24 w-full max-w-3xl" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-center font-heading text-3xl font-extrabold tracking-tight">
          Frequently asked questions
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          Quick answers to the things people ask us most.
        </p>
        <div className="mt-10 space-y-4">
          {FAQS.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="mt-24 mb-8 w-full max-w-3xl">
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface to-accent/5 p-10 text-center sm:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          />
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/20">
            <LineChart className="h-6 w-6" />
          </span>
          <h2 className="font-heading text-3xl font-extrabold tracking-tight">
            Ready to turn your idea into a plan?
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted">
            Describe your idea in plain language and get a researched business plan,
            roadmap, and skill-gap summary — free to start.
          </p>
          <div className="mt-8 flex justify-center">
            <AuthButtons goToAuth={goToAuth} />
          </div>
        </div>
      </section>

      {/* ── Trust note ── */}
      <div className="mt-8 mb-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          No account required to explore
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          Your data stays private
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          Live research, not generic advice
        </span>
      </div>

      {/* ── Branded transition overlay now renders globally in <Layout/> (it
             must survive navigation; a page-level overlay unmounts mid-transition) ── */}
    </div>
  );
}
