import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { removeIdea, updateIdea } from '@/lib/historyStore';
import { useAuth } from '@/hooks/useAuth';
import type {
  GeneratedReportRow,
  ChecklistTask,
  Competitor,
  CompetitorSnapshotItem,
  PlanChatMessage,
  Skill,
  BusinessIdeaRow,
} from '@/types';
import MarketRealityCheckPanel from '@/components/MarketRealityCheckPanel';
import CompetitorSnapshotPanel from '@/components/CompetitorSnapshotPanel';
import LogoMark from '@/components/LogoMark';
import TypingIndicator from '@/components/TypingIndicator';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CheckCircle2,
  Circle,
  FileText,
  Lightbulb,
  Loader2,
  Pin,
  PinOff,
  Send,
  Target,
  Trash2,
  User as UserIcon,
  Users,
  Wallet,
} from 'lucide-react';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Reports detail page — loaded from /reports/:id where the URL captures a
 * PLAN id (not an idea id). Persists the same three tables that the
 * dashboard pipeline wrote to (business_plans, generated_roadmaps,
 * business_ideas) and wires up the same actions as IdeaView — pin,
 * delete (with cascade), and follow-up chat via the plan-chat edge
 * function — so a "Generated Reports → click a card → land here" flow
 * functions identically to the dashboard's idea thread.
 *
 * Resolution: report is loaded by plan.id; the linked idea row is
 * fetched next so rename / pin / delete all operate on the idea.
 */
export default function ReportView() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<GeneratedReportRow | null>(null);
  const [idea, setIdea] = useState<BusinessIdeaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState<PlanChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadReport = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    setError(null);
    try {
      const [planRes, roadmapRes] = await Promise.all([
        supabase.from('business_plans').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
        supabase.from('generated_roadmaps').select('*').eq('plan_id', id).eq('user_id', user.id).maybeSingle(),
      ]);
      if (planRes.error) throw planRes.error;
      if (!planRes.data) {
        setError("We couldn't find that report — it may have been deleted.");
        setLoading(false);
        return;
      }
      const plan = planRes.data as GeneratedReportRow & { idea_id: string };
      const roadmap = (roadmapRes.data ?? null) as { skills_to_learn: Skill[] | null; checklist_30_days: ChecklistTask[] | null; skill_gap_summary: string | null; id: string } | null;

      const { data: ideaRow } = await supabase
        .from('business_ideas')
        .select('*')
        .eq('id', plan.idea_id)
        .eq('user_id', user.id)
        .maybeSingle();
      const ideaData = (ideaRow ?? null) as BusinessIdeaRow | null;
      setIdea(ideaData);

      setReport({
        id: plan.id,
        idea_id: plan.idea_id,
        user_id: plan.user_id,
        idea_text: ideaData?.idea_text ?? '',
        idea_title: ideaData?.title ?? null,
        target_customer: plan.target_customer,
        cost_estimate: plan.cost_estimate,
        competitor_summary: plan.competitor_summary as Competitor[] | null,
        first_steps: plan.first_steps as { title: string; description: string }[] | null,
        reality_check: plan.reality_check,
        competitor_snapshot: plan.competitor_snapshot as CompetitorSnapshotItem[] | null,
        skills_to_learn: roadmap?.skills_to_learn ?? null,
        checklist_30_days: roadmap?.checklist_30_days ?? null,
        skill_gap_summary: roadmap?.skill_gap_summary ?? null,
        created_at: plan.created_at,
      });

      // Load chat history for the follow-up box.
      const { data: chatRows } = await supabase
        .from('plan_chat_messages')
        .select('*')
        .eq('plan_id', plan.id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (chatRows) setChatMessages(chatRows as PlanChatMessage[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this report.');
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    if (user) loadReport();
  }, [user, loadReport]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Pin (operates on the linked idea) ──
  const togglePin = async () => {
    if (!report || !idea) return;
    const next = !idea.is_pinned;
    setIdea((prev) => (prev ? { ...prev, is_pinned: next } : prev));
    updateIdea(idea.id, { is_pinned: next });
    await supabase.from('business_ideas').update({ is_pinned: next }).eq('id', idea.id);
  };

  // ── Delete with cascade (same dependency order as IdeaView) ──
  const handleDelete = async () => {
    if (!report || !idea) return;
    if (!confirm('Delete this idea and all associated data?')) return;
    setDeleting(true);
    removeIdea(idea.id);
    try {
      await supabase.from('plan_chat_messages').delete().eq('plan_id', report.id).eq('user_id', user!.id);
      const { data: roadmapRow } = await supabase
        .from('generated_roadmaps')
        .select('id')
        .eq('plan_id', report.id)
        .eq('user_id', user!.id)
        .maybeSingle();
      if (roadmapRow?.id) {
        await supabase.from('checklist_progress').delete().eq('roadmap_id', roadmapRow.id).eq('user_id', user!.id);
        await supabase.from('generated_roadmaps').delete().eq('id', roadmapRow.id).eq('user_id', user!.id);
      }
      await supabase.from('business_plans').delete().eq('id', report.id).eq('user_id', user!.id);
      await supabase.from('business_ideas').delete().eq('id', idea.id).eq('user_id', user!.id);
    } catch (err) {
      console.warn('ReportView delete cascade reported an issue:', err);
    }
    navigate('/reports', { replace: true });
  };

  // ── Rename (operates on the linked idea) ──
  const [renaming, setRenaming] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const startRename = () => {
    if (!idea) return;
    setTitleValue(idea.title ?? '');
    setRenaming(true);
  };
  const saveRename = async () => {
    if (!idea) return;
    const title = titleValue.trim() || null;
    setRenaming(false);
    setIdea((prev) => (prev ? { ...prev, title } : prev));
    updateIdea(idea.id, { title });
    await supabase.from('business_ideas').update({ title }).eq('id', idea.id);
  };

  // ── Follow-up chat (uses the same plan-chat edge function the dashboard
  //    idea-thread uses — same intelligence, persistent messages) ──
  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading || !report || !idea || !user) return;
    setChatInput('');

    const optimisticId = crypto.randomUUID();
    const userMsg: PlanChatMessage = {
      id: optimisticId,
      plan_id: report.id,
      user_id: user.id,
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    await supabase.from('plan_chat_messages').insert({
      id: optimisticId,
      plan_id: report.id,
      user_id: user.id,
      role: 'user',
      content: msg,
    });

    try {
      const planContext = {
        idea_text: idea.idea_text,
        target_customer: report.target_customer ?? '',
        cost_estimate: report.cost_estimate ?? '',
        competitor_summary: (report.competitor_summary ?? []) as Competitor[],
        first_steps: (report.first_steps ?? []) as { title: string; description: string }[],
        roadmap_summary: report.skill_gap_summary ?? '',
      };
      const history = [
        ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: msg },
      ];
      const result = await callEdgeFunction<{ reply: string }>('plan-chat', {
        message: msg,
        plan_context: planContext,
        history,
      });

      const assistantId = crypto.randomUUID();
      const assistantMsg: PlanChatMessage = {
        id: assistantId,
        plan_id: report.id,
        user_id: user.id,
        role: 'assistant',
        content: result.reply,
        created_at: new Date().toISOString(),
      };
      await supabase.from('plan_chat_messages').insert({
        id: assistantId,
        plan_id: report.id,
        user_id: user.id,
        role: 'assistant',
        content: result.reply,
      });
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: PlanChatMessage = {
        id: crypto.randomUUID(),
        plan_id: report.id,
        user_id: user.id,
        role: 'assistant',
        content: 'Ideon hit a snag — please try again in a moment.',
        created_at: new Date().toISOString(),
      };
      await supabase.from('plan_chat_messages').insert({
        plan_id: report.id,
        user_id: user.id,
        role: 'assistant',
        content: errorMsg.content,
      });
      setChatMessages((prev) => [...prev, errorMsg]);
    }
    setChatLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
        <span className="sr-only">Loading report…</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <FileText className="h-6 w-6" />
        </span>
        <h2 className="font-heading text-lg font-semibold">Report not found</h2>
        <p className="mt-1.5 max-w-sm text-sm text-muted">{error ?? "We couldn't load this report."}</p>
        <button
          type="button"
          onClick={() => navigate('/reports')}
          className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>
      </div>
    );
  }

  const competitors = (report.competitor_summary ?? []) as Competitor[];
  const firstSteps = (report.first_steps ?? []) as { title: string; description: string }[];
  const skills = (report.skills_to_learn ?? []) as Skill[];
  const checklist = (report.checklist_30_days ?? []) as ChecklistTask[];

  return (
    <div className="animate-fade-in pb-12">
      <button
        type="button"
        onClick={() => navigate('/reports')}
        className="mb-6 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Reports
      </button>

      {/* Header with pin / rename / delete actions on the linked idea */}
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-md shadow-primary/20">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              {renaming && idea ? (
                <input
                  autoFocus
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  aria-label="Idea name"
                  placeholder="Give this idea a name…"
                  className="w-full max-w-md rounded-xl border border-primary/40 bg-background px-3 py-2 font-heading text-2xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={startRename}
                  className="text-left"
                  aria-label="Rename idea"
                >
                  <h1 className="truncate font-heading text-2xl font-bold tracking-tight sm:text-3xl">
                    {report.idea_title?.trim() || report.idea_text.slice(0, 80)}
                  </h1>
                </button>
              )}
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(report.created_at)}
              </p>
            </div>
          </div>
          {idea && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={togglePin}
                aria-pressed={idea.is_pinned}
                aria-label={idea.is_pinned ? 'Unpin idea' : 'Pin idea'}
                title={idea.is_pinned ? 'Unpin' : 'Pin'}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200 active:scale-95 ${
                  idea.is_pinned
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border text-muted hover:border-primary/40 hover:text-primary'
                }`}
              >
                {idea.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {idea.is_pinned ? 'Pinned' : 'Pin'}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="space-y-8">
        {/* Premium: Reality check + competitor snapshot */}
        {(report.reality_check || report.competitor_snapshot) && (
          <div className="space-y-4">
            {report.reality_check && <MarketRealityCheckPanel data={report.reality_check} />}
            {report.competitor_snapshot && report.competitor_snapshot.length > 0 && (
              <CompetitorSnapshotPanel items={report.competitor_snapshot as CompetitorSnapshotItem[]} />
            )}
          </div>
        )}

        {report.target_customer && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
              <Users className="h-5 w-5 text-primary" />
              Target Customer
            </h2>
            <p className="text-sm leading-relaxed text-muted">{report.target_customer}</p>
          </section>
        )}

        {report.cost_estimate && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
              <Wallet className="h-5 w-5 text-primary" />
              Cost Estimate
            </h2>
            <p className="text-sm leading-relaxed text-muted">{report.cost_estimate}</p>
          </section>
        )}

        {competitors.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Competitor Landscape
            </h2>
            <div className="space-y-4">
              {competitors.map((comp, i) => (
                <div key={i} className="rounded-xl border border-border bg-background/50 p-4">
                  <h3 className="font-semibold text-sm">{comp.name}</h3>
                  <p className="mt-1 text-xs text-muted">{comp.positioning}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-[11px] font-semibold text-success">Strengths</span>
                      <p className="text-xs text-muted">{comp.strengths}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-destructive">Weaknesses</span>
                      <p className="text-xs text-muted">{comp.weaknesses}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {checklist.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              30-Day Execution Checklist
            </h2>
            <ul className="space-y-2.5">
              {checklist.map((task, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 shrink-0 text-muted/60">
                    {task.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4" />}
                  </span>
                  <span className={task.done ? 'text-muted line-through' : 'text-foreground'}>
                    {task.task}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {skills.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
              <Lightbulb className="h-5 w-5 text-primary" />
              Skills to Learn
            </h2>
            {report.skill_gap_summary && (
              <p className="mb-4 text-sm leading-relaxed text-muted">{report.skill_gap_summary}</p>
            )}
            <div className="space-y-3">
              {skills.map((skill, i) => (
                <div key={i} className="rounded-xl border border-border bg-background/50 p-4">
                  <h3 className="text-sm font-semibold">{skill.skill}</h3>
                  <p className="mt-1 text-xs text-muted">{skill.reason}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {firstSteps.length > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
              <Lightbulb className="h-5 w-5 text-primary" />
              First Steps
            </h2>
            <ol className="space-y-3">
              {firstSteps.map((step, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-border bg-background/50 p-4">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ── Follow-up chat — same plan-chat edge function the dashboard
                uses for idea-thread follow-ups, so the user can ask
                anything about their plan and get real replies grounded
                in the saved context. ── */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
            <LogoMark className="h-5 w-5 text-primary" />
            Ask about this plan
          </h2>

          <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
            {chatMessages.map((m) => (
              <div
                key={m.id}
                className={`flex w-full animate-message-in items-center gap-2.5 my-3 ${
                  m.role === 'assistant' ? 'justify-start' : 'justify-end'
                }`}
              >
                {m.role === 'assistant' && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    <LogoMark className="h-3.5 w-3.5" />
                  </span>
                )}
                <div
                  className={`min-w-0 whitespace-pre-wrap break-words rounded-2xl text-sm leading-relaxed ${
                    m.role === 'assistant'
                      ? 'max-w-[85%] px-4 py-2.5 text-foreground'
                      : 'max-w-[75%] bg-[#c43200] px-4 py-2.5 text-white shadow-sm'
                  }`}
                >
                  {m.content}
                </div>
                {m.role !== 'assistant' && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                    <UserIcon className="h-3.5 w-3.5" />
                  </span>
                )}
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
            className="sticky bottom-4 z-10 mx-auto flex w-full max-w-3xl items-center gap-2.5 rounded-2xl border bg-card/90 px-4 backdrop-blur shadow-sm min-h-[52px]"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask a follow-up question…"
              disabled={chatLoading}
              className="w-full shrink bg-transparent py-2 text-sm text-foreground placeholder:text-muted/50 transition-all focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              className="flex shrink-0 cursor-pointer items-center self-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-2 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
