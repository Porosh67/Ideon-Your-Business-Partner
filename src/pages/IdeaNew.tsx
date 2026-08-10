import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { upsertIdea } from '@/lib/historyStore';
import { useMarkRouteReady } from '@/lib/transitionStore';
import { useAuth } from '@/hooks/useAuth';
import type {
  BusinessPlanResult,
  RoadmapResult,
  Competitor,
  FirstStep,
  Skill,
  ChecklistTask,
} from '@/types';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Search,
  FileText,
  Map,
  Sparkles,
  AlertTriangle,
  Layers,
  Lock,
  Send,
  User as UserIcon,
} from 'lucide-react';
import LogoMark from '@/components/LogoMark';
import TypingIndicator from '@/components/TypingIndicator';

type StepState = 'idle' | 'running' | 'done' | 'error';

interface Step {
  key: string;
  icon: typeof Search;
  label: string;
  state: StepState;
  errorMessage?: string;
}

const initialSteps: Step[] = [
  { key: 'research', icon: Search, label: 'Researching the market…', state: 'idle' },
  { key: 'plan', icon: FileText, label: 'Generating your business plan…', state: 'idle' },
  { key: 'roadmap', icon: Map, label: 'Building your roadmap…', state: 'idle' },
];

export default function IdeaNew() {
  const { user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilled = searchParams.get('idea') ?? '';
  // Marks this route as rendered so a pending branded transition dismisses
  // as soon as the page is on screen.
  useMarkRouteReady();

  const [idea, setIdea] = useState(prefilled);
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const [planData, setPlanData] = useState<BusinessPlanResult | null>(null);
  const [roadmapData, setRoadmapData] = useState<RoadmapResult | null>(null);

  // ── Validation state ──
  const [validating, setValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // ── Guest chat state ──
  const [guestMessages, setGuestMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefilled) setIdea(prefilled);
  }, [prefilled]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [guestMessages]);

  const updateStep = (key: string, patch: Partial<Step>) =>
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s))
    );

  const handleGenerate = async () => {
    const trimmed = idea.trim();
    if (trimmed.length < 10) {
      setError('Please describe your idea with at least 10 characters.');
      return;
    }
    setError(null);
    setValidationMessage(null);

    // ── Validate the idea first ──
    setValidating(true);
    try {
      const validationResult = await callEdgeFunction<{
        is_business_idea: boolean;
        message?: string;
      }>('validate-idea', { idea_text: trimmed });
      if (!validationResult.is_business_idea) {
        setValidationMessage(
          validationResult.message ??
          'That doesn\'t seem to be a business idea. Could you describe a product or service you\'d like to start?'
        );
        setValidating(false);
        return;
      }
    } catch {
      // If validation fails, log it but allow the pipeline to proceed
      console.warn('Idea validation unavailable, proceeding directly.');
    }
    setValidating(false);

    runningRef.current = true;

    if (!user) {
      const { error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError) {
        setError('Could not start a session. Please try again or sign in.');
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    let research: unknown = null;
    let plan: BusinessPlanResult | null = null;
    let roadmap: RoadmapResult | null = null;

    updateStep('research', { state: 'running' });
    try {
      research = await callEdgeFunction('research-market', { idea_text: trimmed });
      updateStep('research', { state: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Research failed';
      updateStep('research', { state: 'error', errorMessage: msg });
      setError(msg);
      runningRef.current = false;
      return;
    }

    updateStep('plan', { state: 'running' });
    try {
      plan = await callEdgeFunction('generate-plan', {
        idea_text: trimmed,
        research_data: research,
      });
      setPlanData(plan);
      updateStep('plan', { state: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Plan generation failed';
      updateStep('plan', { state: 'error', errorMessage: msg });
      setError(msg);
      runningRef.current = false;
      return;
    }

    updateStep('roadmap', { state: 'running' });
    try {
      roadmap = await callEdgeFunction('generate-roadmap', {
        business_plan: plan,
      });
      setRoadmapData(roadmap);
      updateStep('roadmap', { state: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Roadmap generation failed';
      updateStep('roadmap', { state: 'error', errorMessage: msg });
      setError(msg);
      runningRef.current = false;
      return;
    }

    if (user && !isGuest && plan) {
      try {
        const { data: ideaRow } = await supabase
          .from('business_ideas')
          .insert({ user_id: user.id, idea_text: trimmed })
          .select('id')
          .single();

        if (ideaRow) {
          // Push the new idea into the shared store so the sidebar updates instantly.
          upsertIdea({
            id: ideaRow.id,
            user_id: user.id,
            idea_text: trimmed,
            title: null,
            is_pinned: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          const { data: planRow } = await supabase
            .from('business_plans')
            .insert({
              idea_id: ideaRow.id,
              user_id: user.id,
              target_customer: plan.target_customer,
              cost_estimate: plan.cost_estimate,
              competitor_summary: plan.competitor_summary,
              first_steps: plan.first_steps,
              raw_research_data: research,
            })
            .select('id')
            .single();

          if (planRow && roadmap) {
            await supabase.from('generated_roadmaps').insert({
              plan_id: planRow.id,
              user_id: user.id,
              skills_to_learn: roadmap.skills_to_learn,
              checklist_30_days: roadmap.checklist_30_days,
              skill_gap_summary: roadmap.skill_gap_summary,
            });
          }

          runningRef.current = false;
          navigate(`/ideas/${ideaRow.id}`);
          return;
        }
      } catch {
        // If DB save fails, still show results in guest mode
      }
    }

    runningRef.current = false;
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading || !planData) return;
    setChatInput('');
    const userMsg = { role: 'user' as const, content: msg };
    setGuestMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const planContext = {
        idea_text: idea,
        target_customer: planData.target_customer,
        cost_estimate: planData.cost_estimate,
        competitor_summary: planData.competitor_summary,
        first_steps: planData.first_steps,
        roadmap_summary: roadmapData?.skill_gap_summary ?? '',
      };

      const result = await callEdgeFunction<{ reply: string }>('plan-chat', {
        message: msg,
        plan_context: planContext,
        history: [...guestMessages, userMsg],
      });

      setGuestMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply },
      ]);
    } catch (err) {
      setGuestMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I couldn\'t process that. Please try again.',
        },
      ]);
    }
    setChatLoading(false);
  };

  const running = runningRef.current;
  const finished = steps.every((s) => s.state === 'done');
  const canSubmit = !running && !validating && idea.trim().length >= 10;

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      {/* Back to Dashboard */}
      <Link
        to="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-all duration-200 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-heading text-3xl font-extrabold tracking-tight">
          {finished ? 'Your results are ready' : 'Generate your plan'}
        </h1>
        <p className="mt-2 text-muted">
          {finished
            ? 'Explore your researched business plan and roadmap below.'
            : 'Describe your idea and we\'ll research, plan, and map it out.'}
        </p>
      </div>

      {/* Idea textarea — hidden after success */}
      {!finished && (
        <div className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-lg transition-all duration-300 hover:shadow-card-hover">
          <label htmlFor="new-idea" className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Your business idea
          </label>
          <textarea
            id="new-idea"
            rows={4}
            maxLength={2000}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Describe your business idea in detail…"
            className="w-full resize-none rounded-xl bg-background px-4 py-3.5 text-sm text-foreground placeholder:text-muted/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!canSubmit}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-accent to-accent-hover px-6 py-3 text-sm font-semibold text-white shadow-md shadow-accent/20 transition-all duration-200 hover:shadow-lg hover:shadow-accent/30 active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
            >
              {validating ? (
                <>
                  <LogoMark className="h-4 w-4 ideon-loader-logo" />
                  Validating…
                </>
              ) : running ? (
                <>
                  <LogoMark className="h-4 w-4 ideon-loader-logo" />
                  Working…
                </>
              ) : (
                <>
                  Research & Generate
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </div>
          {validationMessage && (
            <p className="mt-4 animate-fade-in rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600 dark:text-amber-400">
              {validationMessage}
            </p>
          )}
          {error && !validationMessage && (
            <p className="mt-4 animate-fade-in rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {/* Progress steps */}
      {running && (
        <div className="mb-8 space-y-3">
          {steps.map((step, i) => (
            <div
              key={step.key}
              className={`animate-slide-up flex items-start gap-4 rounded-xl border p-4 transition-all duration-300 ${
                step.state === 'running'
                  ? 'border-primary/50 bg-gradient-to-r from-primary/8 to-transparent shadow-sm'
                  : step.state === 'done'
                    ? 'border-success/40 bg-gradient-to-r from-success/8 to-transparent'
                    : step.state === 'error'
                      ? 'border-destructive/40 bg-gradient-to-r from-destructive/8 to-transparent'
                      : 'border-border bg-surface/30 opacity-40'
              }`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                  step.state === 'done'
                    ? 'bg-success/20 text-success'
                    : step.state === 'running'
                      ? 'bg-primary/20 text-primary animate-pulse-soft'
                      : step.state === 'error'
                        ? 'bg-destructive/20 text-destructive'
                        : 'bg-subtle text-muted'
                }`}
              >
                {step.state === 'done' ? (
                  <Check className="h-4 w-4" />
                ) : step.state === 'running' ? (
                  <LogoMark className="h-4 w-4 ideon-loader-logo" />
                ) : (
                  i + 1
                )}
              </span>
              <div className="flex-1 pt-0.5">
                <p className="text-sm font-semibold">{step.label}</p>
                {step.state === 'error' && step.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">
                    {step.errorMessage}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Results ── */}
      {finished && planData && (
        <div className="animate-fade-in space-y-8">
          {/* Guest banner */}
          {isGuest && (
            <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/8 to-transparent p-4 shadow-sm">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div>
                <p className="font-semibold text-accent">Exploring as a guest</p>
                <p className="mt-1 text-sm text-muted">
                  Your results are shown here but won't be saved.{' '}
                  <Link
                    to="/auth"
                    className="font-semibold text-accent underline underline-offset-2 decoration-accent/50 hover:decoration-accent transition-all"
                  >
                    Sign up for free
                  </Link>{' '}
                  to save plans, generate unlimited ideas, and track progress.
                </p>
              </div>
            </div>
          )}

          <PlanSection plan={planData} />
          {roadmapData && <RoadmapSection roadmap={roadmapData} />}

          {/* ── Guest chat ── */}
          {isGuest && (
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-lg">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
                <LogoMark className="h-5 w-5 text-primary" />
                Ask about your plan
              </h2>

              <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
                {guestMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 ${
                      m.role === 'assistant' ? '' : 'flex-row-reverse'
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                        m.role === 'assistant'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-accent/15 text-accent'
                      }`}
                    >
                      {m.role === 'assistant' ? (
                        <LogoMark className="h-3.5 w-3.5" />
                      ) : (
                        <UserIcon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div
                      className={`min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                        m.role === 'assistant'
                          ? 'px-0.5 py-0.5 text-foreground'
                          : 'rounded-tr-md bg-gradient-to-br from-accent to-accent-hover text-white shadow-sm shadow-accent/10'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && <TypingIndicator />}
                <div ref={chatEndRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleChatSend();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a follow-up question…"
                  disabled={chatLoading}
                  className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatLoading}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:shadow-none"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}

          {isGuest && (
            <div className="rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/5 to-transparent p-8 text-center shadow-sm">
              <Link
                to="/auth"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-accent to-accent-hover px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-accent/20 transition-all duration-200 hover:shadow-lg hover:shadow-accent/30 active:scale-[0.97]"
              >
                <Sparkles className="h-5 w-5" />
                Sign up for full access
              </Link>
            </div>
          )}

          {!isGuest && (
            <div className="text-center">
              <Link
                to="/dashboard"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-6 py-3 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
              >
                Go to dashboard
                <ChevronRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          )}
        </div>
      )}

      {!running && !finished && !error && !validationMessage && !authLoading && !user && (
        <p className="mt-4 text-center text-sm text-muted">
          We'll start a guest session as soon as you hit generate — no account needed.
        </p>
      )}
    </div>
  );
}

// ── Sub‑components ──

function PlanSection({ plan }: { plan: BusinessPlanResult }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
      <h2 className="mb-6 flex items-center gap-2 font-heading text-xl font-bold tracking-tight">
        <Layers className="h-5 w-5 text-primary" />
        Business Plan
      </h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card label="Target customer" text={plan.target_customer} />
        <Card label="Cost estimate" text={plan.cost_estimate} />
      </div>

      {plan.competitor_summary.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-4 font-heading font-bold text-foreground">Competitor analysis</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {plan.competitor_summary.map((c: Competitor, i) => (
              <div
                key={i}
                className="group rounded-xl border border-border bg-background/40 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-background/70 hover:shadow-sm"
              >
                <p className="font-semibold text-foreground">{c.name}</p>
                <p className="mt-1 text-xs text-muted">{c.positioning}</p>
                {c.strengths && (
                  <p className="mt-2 text-xs text-success/90">
                    <span className="font-semibold">Strengths:</span> {c.strengths}
                  </p>
                )}
                {c.weaknesses && (
                  <p className="mt-0.5 text-xs text-destructive/80">
                    <span className="font-semibold">Weaknesses:</span>{' '}
                    {c.weaknesses}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.first_steps.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-4 font-heading font-bold text-foreground">First steps</h3>
          <ol className="space-y-2">
            {plan.first_steps.map((s: FirstStep, i) => (
              <li
                key={i}
                className="group flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3 transition-all duration-200 hover:border-primary/30 hover:bg-background/70 hover:shadow-sm"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-bold text-primary transition-transform duration-200 group-hover:scale-110">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{s.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function RoadmapSection({ roadmap }: { roadmap: RoadmapResult }) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
        <h2 className="mb-6 flex items-center gap-2 font-heading text-xl font-bold tracking-tight">
          <Search className="h-5 w-5 text-primary" />
          Skills to learn
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {roadmap.skills_to_learn.map((s: Skill, i) => (
            <div
              key={i}
              className="group rounded-xl border border-border bg-background/40 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-background/70 hover:shadow-sm"
            >
              <p className="font-semibold text-foreground">{s.skill}</p>
              <p className="mt-1 text-xs text-muted">{s.reason}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
        <h2 className="mb-6 flex items-center gap-2 font-heading text-xl font-bold tracking-tight">
          <FileText className="h-5 w-5 text-primary" />
          30-Day Checklist
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {roadmap.checklist_30_days.map((item: ChecklistTask, i) => (
            <label
              key={i}
              className="group flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/20 p-3 transition-all duration-200 hover:border-primary/20 hover:bg-background/50 hover:shadow-sm"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/80 text-xs font-bold text-muted transition-all duration-200 group-hover:border-primary/30 group-hover:text-primary">
                {i + 1}
              </span>
              <span className="text-sm text-foreground">{item.task}</span>
            </label>
          ))}
        </div>
      </div>

      {roadmap.skill_gap_summary && (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-xl font-bold tracking-tight">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Skill-Gap Summary
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            {roadmap.skill_gap_summary}
          </p>
        </div>
      )}
    </section>
  );
}

function Card({ label, text }: { label: string; text: string }) {
  return (
    <div className="group rounded-xl border border-border bg-background/40 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-background/70 hover:shadow-sm">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-foreground">{text}</p>
    </div>
  );
}