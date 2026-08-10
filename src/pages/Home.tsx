import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthTransition } from '@/hooks/useAuthTransition';
import { useMarkRouteReady } from '@/lib/transitionStore';
import {
  ArrowRight,
  BarChart3,
  ListChecks,
  Lightbulb,
  Search,
} from 'lucide-react';

const features = [
  {
    icon: Search,
    title: 'Live market research',
    text: 'Real competitor, pricing and trend data pulled from live web search — not generic advice.',
  },
  {
    icon: Lightbulb,
    title: 'Structured business plan',
    text: 'Target customer, cost estimate, competitor analysis and first steps, generated in seconds.',
  },
  {
    icon: ListChecks,
    title: 'Actionable roadmap',
    text: 'Skills to learn, a 30-day task checklist and a skill-gap summary tailored to your idea.',
  },
];

export default function Home() {
  const { user, loading, isGuest } = useAuth();
  const navigate = useNavigate();
  const { goToAuth } = useAuthTransition();
  // Marks this route as rendered so a pending branded transition dismisses
  // exactly when the page is actually visible (see useAuthTransition).
  useMarkRouteReady();

  // ── Redirect signed-in users straight to dashboard ──
  useEffect(() => {
    if (!loading && user && !isGuest) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, loading, isGuest, navigate]);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center overflow-y-auto">
      {/* ── Hero background layers ── */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        {/* Subtle grid */}
        <div className="absolute inset-0 bg-grid-pattern" />
        {/* Large soft gradient blob */}
        <div className="absolute -top-80 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/8 to-transparent blur-3xl" />
        <div className="absolute top-40 right-[5%] h-[400px] w-[400px] rounded-full bg-gradient-to-b from-accent/6 to-transparent blur-3xl max-lg:hidden" />
        {/* Vignette overlay to fade edges */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-transparent to-background" />
      </div>

      {/* ── Hero ── */}
      <section className="relative flex w-full max-w-3xl flex-col items-center pt-12 text-center sm:pt-20">
        {/* Badge */}
        <span className="mb-6 inline-flex animate-fade-in items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary shadow-sm">
          <BarChart3 className="h-4 w-4" />
          AI-powered business planning
        </span>

        {/* Headline with gradient */}
        <h1 className="animate-slide-up font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          Turn your idea into a{' '}
          <span className="text-gradient-accent">researched business plan</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted animate-fade-in">
          Describe your business idea in plain text. Get live market data, a
          structured plan, and a 30-day roadmap — in minutes, not months.
        </p>

        <div className="mt-10 flex animate-fade-in flex-col items-center gap-4 sm:flex-row">
          <button
            type="button"
            onClick={() => goToAuth('signup')}
            className="group inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-8 py-4 text-base font-semibold text-on-primary shadow-lg shadow-primary/20 transition-all duration-300 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.97]"
          >
            Get Started
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </button>
          <Link
            to="/learn-more"
            className="inline-flex items-center gap-2 rounded-xl border border-border px-8 py-4 text-base font-semibold text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            Learn more
          </Link>
        </div>
      </section>

      {/* ── Feature cards ── */}
      <section className="mt-24 grid w-full gap-6 sm:grid-cols-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className="group animate-slide-up rounded-2xl border border-border bg-surface/80 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:bg-surface hover:shadow-card-hover"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-sm ring-1 ring-primary/10 transition-all duration-300 group-hover:scale-110 group-hover:from-primary/30 group-hover:to-primary/10">
              <f.icon className="h-5 w-5" />
            </span>
            <h3 className="font-heading text-lg font-bold tracking-tight">{f.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-muted">{f.text}</p>
          </div>
        ))}
      </section>

      {/* ── How it works (anchor target for "Learn more") ── */}
      <section id="how-it-works" className="mt-24 mb-8 w-full max-w-3xl scroll-mt-24">
        <h2 className="text-center font-heading text-3xl font-extrabold tracking-tight">
          Three steps,{' '}
          <span className="text-gradient">one clear direction</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          Ideon turns a rough idea into a researched, structured plan — no
          spreadsheets, no guesswork, no hours of Googling.
        </p>
        <div className="relative mt-12">
          {/* Connecting line (desktop) */}
          <div
            aria-hidden="true"
            className="absolute left-[27px] top-0 bottom-0 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent max-sm:hidden"
          />
          <ol className="space-y-6">
            {[
              ['1', 'We research the market', 'Live web search for competitors, pricing and trends.'],
              ['2', 'We draft your plan', 'A structured business plan built from your idea + real data.'],
              ['3', 'We build your roadmap', 'Skills to learn, a 30-day checklist, and a skill-gap summary.'],
            ].map(([num, title, text], i) => (
              <li
                key={num}
                className="group animate-slide-up flex items-start gap-5 rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:bg-surface hover:shadow-card-hover"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-heading text-base font-bold text-on-primary shadow-md shadow-primary/20 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-primary/30">
                  {num}
                </span>
                <div className="pt-1">
                  <h3 className="font-heading text-lg font-bold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* What Ideon can do — informational deep-dive */}
        <div className="mt-16">
          <h2 className="text-center font-heading text-3xl font-extrabold tracking-tight">
            An AI co-pilot for every stage of your idea
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {[
              {
                title: 'Chat with your idea',
                text: 'Ask anything — "who else is doing this?", "what should I price it at?", "help me pick a name". Ideon answers with your plan in context.',
              },
              {
                title: 'Idea brainstorm',
                text: 'Stuck for ideas? Ask Ideon to suggest business opportunities in any industry or niche you care about.',
              },
              {
                title: 'Daily check-ins',
                text: 'Track your mood and momentum, and get a short AI coach message to keep you moving on your roadmap.',
              },
              {
                title: 'Saved, everywhere',
                text: 'Plans, conversations and check-ins are saved to your account and sync across devices.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="group animate-slide-up rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:bg-surface hover:shadow-card-hover"
              >
                <h3 className="font-heading text-base font-bold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Branded transition overlay now renders globally in <Layout/> (it must
          survive navigation; a page-level overlay unmounts mid-transition). */}
    </div>
  );
}