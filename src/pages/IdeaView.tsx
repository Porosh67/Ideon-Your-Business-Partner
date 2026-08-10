import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { removeIdea, updateIdea } from '@/lib/historyStore';
import { useMarkRouteReady } from '@/lib/transitionStore';
import { useAuth } from '@/hooks/useAuth';
import type {
  IdeaPlanView,
  BusinessPlanRow,
  RoadmapRow,
  Competitor,
  FirstStep,
  Skill,
  ChecklistTask,
  ChecklistProgressRow,
  PlanChatMessage,
} from '@/types';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Search,
  Send,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import LogoMark from '@/components/LogoMark';
import IdeonLoader from '@/components/IdeonLoader';
import TypingIndicator from '@/components/TypingIndicator';
import MarketRealityCheckPanel from '@/components/MarketRealityCheckPanel';
import CompetitorSnapshotPanel from '@/components/CompetitorSnapshotPanel';

export default function IdeaView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  // Marks this route as rendered so a pending branded transition dismisses
  // as soon as the page is on screen (idea data still loads in the background).
  useMarkRouteReady();

  const [data, setData] = useState<IdeaPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<number, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState<PlanChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load data ──
  const loadIdea = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    try {
      const { data: ideaRow, error: ideaErr } = await supabase
        .from('business_ideas')
        .select('*')
        .eq('id', id)
        .single();
      if (ideaErr) throw ideaErr;

      const { data: planRow } = await supabase
        .from('business_plans')
        .select('*')
        .eq('idea_id', id)
        .single();

      const { data: roadmapRow } = planRow
        ? await supabase
            .from('generated_roadmaps')
            .select('*')
            .eq('plan_id', (planRow as BusinessPlanRow).id)
            .single()
        : { data: null };

      setData({
        idea: ideaRow,
        plan: planRow as BusinessPlanRow | null,
        roadmap: roadmapRow as RoadmapRow | null,
      });

      // Load checklist progress
      if (roadmapRow) {
        const { data: progressRows } = await supabase
          .from('checklist_progress')
          .select('*')
          .eq('roadmap_id', (roadmapRow as RoadmapRow).id)
          .eq('user_id', user!.id);

        if (progressRows) {
          const map: Record<number, boolean> = {};
          for (const row of progressRows as ChecklistProgressRow[]) {
            map[row.task_index] = row.is_done;
          }
          setProgressMap(map);
        }
      }

      // Load chat messages
      if (planRow) {
        const { data: chatRows } = await supabase
          .from('plan_chat_messages')
          .select('*')
          .eq('plan_id', (planRow as BusinessPlanRow).id)
          .order('created_at', { ascending: true });

        if (chatRows) {
          setChatMessages(chatRows as PlanChatMessage[]);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load this idea.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    if (user) loadIdea();
  }, [user, loadIdea]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Toggle checklist item ──
  const toggleItem = async (taskIndex: number, isDone: boolean) => {
    if (!data?.roadmap) return;
    const optimistic = !isDone;
    setProgressMap((prev) => ({ ...prev, [taskIndex]: optimistic }));

    const { error: upsertError } = await supabase.from('checklist_progress').upsert(
      {
        roadmap_id: data.roadmap.id,
        user_id: user!.id,
        task_index: taskIndex,
        is_done: optimistic,
      },
      {
        onConflict: 'user_id,roadmap_id,task_index',
        ignoreDuplicates: false,
      }
    );
    if (upsertError) {
      // revert on error
      setProgressMap((prev) => ({ ...prev, [taskIndex]: isDone }));
    }
  };

  // ── Pin / Rename ──
  const togglePin = async () => {
    if (!data) return;
    const next = !data.idea.is_pinned;
    setData((prev) =>
      prev ? { ...prev, idea: { ...prev.idea, is_pinned: next } } : prev
    );
    updateIdea(data.idea.id, { is_pinned: next });
    await supabase.from('business_ideas').update({ is_pinned: next }).eq('id', data.idea.id);
  };

  const startRename = () => {
    if (!data) return;
    setTitleValue(data.idea.title ?? '');
    setRenaming(true);
  };

  const saveRename = async () => {
    if (!data) return;
    const title = titleValue.trim() || null;
    setRenaming(false);
    setData((prev) =>
      prev ? { ...prev, idea: { ...prev.idea, title } } : prev
    );
    updateIdea(data.idea.id, { title });
    await supabase.from('business_ideas').update({ title }).eq('id', data.idea.id);
  };

  // ── Delete (cascade) ──
  // The original `delete` only removed the `business_ideas` row, leaving
  // orphaned `business_plans`, `generated_roadmaps`, `plan_chat_messages`
  // and `checklist_progress` rows behind — and tripped an FK_CONSTRAINT
  // on Postgres when the migration added ON DELETE RESTRICT to the
  // child tables. The cascade walks each table in dependency order
  // (chat → progress → roadmap → plan → idea) so no orphan rows survive
  // and no FK error aborts the delete mid-flight.
  const handleDelete = async () => {
    if (!data) return;
    if (!confirm('Delete this idea and all associated data?')) return;
    setDeleting(true);
    removeIdea(data.idea.id);
    const planId = data.plan?.id;
    const roadmapId = data.roadmap?.id;
    try {
      // Chat is a leaf dependency — clean it first.
      if (planId) {
        await supabase.from('plan_chat_messages').delete().eq('plan_id', planId).eq('user_id', user!.id);
      }
      // Checklist rows reference the roadmap, not the plan directly.
      if (roadmapId) {
        await supabase.from('checklist_progress').delete().eq('roadmap_id', roadmapId).eq('user_id', user!.id);
        await supabase.from('generated_roadmaps').delete().eq('id', roadmapId).eq('user_id', user!.id);
      }
      if (planId) {
        await supabase.from('business_plans').delete().eq('id', planId).eq('user_id', user!.id);
      }
      await supabase.from('business_ideas').delete().eq('id', data.idea.id).eq('user_id', user!.id);
    } catch (err) {
      // Surface the cause in dev, but move the user along regardless so a
      // transient FK race doesn't trap them on the page.
      console.warn('IdeaView delete cascade reported an issue:', err);
    }
    navigate('/reports', { replace: true });
  };

  // ── Chat send ──
  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading || !data?.plan || !user) return;
    setChatInput('');

    // Optimistic user message
    const optimisticId = crypto.randomUUID();
    const userMsg: PlanChatMessage = {
      id: optimisticId,
      plan_id: data.plan.id,
      user_id: user.id,
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    // Persist user message
    await supabase.from('plan_chat_messages').insert({
      id: optimisticId,
      plan_id: data.plan.id,
      user_id: user.id,
      role: 'user',
      content: msg,
    });

    try {
      const planContext = {
        idea_text: data.idea.idea_text,
        target_customer: data.plan.target_customer ?? '',
        cost_estimate: data.plan.cost_estimate ?? '',
        competitor_summary: (data.plan.competitor_summary ?? []) as Competitor[],
        first_steps: (data.plan.first_steps ?? []) as FirstStep[],
        roadmap_summary: data.roadmap?.skill_gap_summary ?? '',
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

      // Persist assistant message
      const assistantId = crypto.randomUUID();
      const assistantMsg: PlanChatMessage = {
        id: assistantId,
        plan_id: data.plan.id,
        user_id: user.id,
        role: 'assistant',
        content: result.reply,
        created_at: new Date().toISOString(),
      };

      await supabase.from('plan_chat_messages').insert({
        id: assistantId,
        plan_id: data.plan.id,
        user_id: user.id,
        role: 'assistant',
        content: result.reply,
      });

      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorId = crypto.randomUUID();
      const errorMsg: PlanChatMessage = {
        id: errorId,
        plan_id: data.plan.id,
        user_id: user.id,
        role: 'assistant',
        content: 'Sorry, I couldn\'t process that. Please try again.',
        created_at: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    }
    setChatLoading(false);
  };

  // ── Loading / Error ──
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <IdeonLoader label="Loading your idea" sublabel="Fetching your plan and progress…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-10 text-center">
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => navigate('/reports')}
          className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-all duration-200 hover:opacity-90 active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-10 text-center text-muted">
        <FileText className="mx-auto mb-3 h-10 w-10" />
        <p>Idea not found.</p>
      </div>
    );
  }

  const { idea, plan, roadmap } = data;
  const checklistItems: ChecklistTask[] = roadmap?.checklist_30_days ?? [];

  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => navigate('/reports')}
            className="mb-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted transition-all duration-200 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Reports
          </button>
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                ref={(el) => el?.focus()}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
                aria-label="Idea name"
                placeholder="Give this idea a name…"
                className="w-full max-w-md rounded-xl border border-primary/40 bg-background px-4 py-2.5 font-heading text-xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <h1 className="font-heading text-2xl font-bold leading-tight">
                {idea.title?.trim()
                  ? idea.title
                  : idea.idea_text.length > 80
                    ? idea.idea_text.slice(0, 80) + '…'
                    : idea.idea_text}
              </h1>
              <button
                type="button"
                onClick={startRename}
                aria-label="Rename idea"
                title="Rename"
                className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-all duration-200 hover:border-primary/40 hover:text-primary active:scale-90"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted">
            Created {new Date(idea.created_at).toLocaleDateString()}
          </p>
        </div>
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
            {idea.is_pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
            {idea.is_pinned ? 'Pinned' : 'Pin'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete
          </button>
        </div>
      </div>

      {/* ── Plan ── */}
      {plan && (
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-lg">
          <h2 className="mb-5 flex items-center gap-2 font-heading text-xl font-bold">
            <Layers className="h-5 w-5 text-primary" />
            Business Plan
          </h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <Card label="Target customer" text={plan.target_customer ?? ''} />
            <Card label="Cost estimate" text={plan.cost_estimate ?? ''} />
          </div>

          {(plan.competitor_summary ?? []).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-3 font-heading font-semibold">Competitor analysis</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(plan.competitor_summary as Competitor[]).map((c, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border bg-background/50 p-4"
                  >
                    <p className="font-semibold">{c.name}</p>
                    <p className="mt-1 text-xs text-muted">{c.positioning}</p>
                    {c.strengths && (
                      <p className="mt-2 text-xs text-success/90">
                        <span className="font-semibold">Strengths:</span>{' '}
                        {c.strengths}
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

          {(plan.first_steps as FirstStep[] ?? []).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-3 font-heading font-semibold">First steps</h3>
              <ol className="space-y-2">
                {(plan.first_steps as FirstStep[]).map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-xl border border-border bg-background/50 p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-muted">{s.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {/* ── Premium Features: Market Reality Check + Competitor Snapshot ── */}
      {plan?.reality_check && (
        <MarketRealityCheckPanel data={plan.reality_check} />
      )}
      {plan?.competitor_snapshot && (
        <CompetitorSnapshotPanel items={plan.competitor_snapshot} />
      )}

      {/* ── Roadmap ── */}
      {roadmap && (
        <section className="space-y-5">
          {/* Skills */}
          {(roadmap.skills_to_learn as Skill[] ?? []).length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg">
              <h2 className="mb-5 flex items-center gap-2 font-heading text-xl font-bold">
                <Search className="h-5 w-5 text-primary" />
                Skills to learn
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(roadmap.skills_to_learn as Skill[]).map((s, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border bg-background/50 p-4"
                  >
                    <p className="font-semibold">{s.skill}</p>
                    <p className="mt-1 text-xs text-muted">{s.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 30-day checklist */}
          {checklistItems.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg">
              <h2 className="mb-5 flex items-center gap-2 font-heading text-xl font-bold">
                <FileText className="h-5 w-5 text-primary" />
                30-Day Checklist
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {checklistItems.map((item, i) => {
                  const done = progressMap[i] ?? item.done ?? false;
                  return (
                    <label
                      key={i}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all duration-200 ${
                        done
                          ? 'border-success/40 bg-success/5'
                          : 'border-border bg-background/30 hover:bg-background/60'
                      }`}
                    >
                      <span
                        onClick={(e) => {
                          e.preventDefault();
                          toggleItem(i, done);
                        }}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs transition-all duration-200 ${
                          done
                            ? 'border-success bg-success text-white'
                            : 'border-border text-transparent'
                        }`}
                      >
                        {done && <Check className="h-3 w-3" />}
                      </span>
                      <span
                        className={`text-sm ${
                          done ? 'text-muted line-through' : ''
                        }`}
                      >
                        Day {i + 1}: {item.task}
                      </span>
                    </label>
                  );
                })}
              </div>
              {checklistItems.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  {Object.values(progressMap).filter(Boolean).length} of{' '}
                  {checklistItems.length} complete
                </p>
              )}
            </div>
          )}

          {/* Skill gap summary */}
          {roadmap.skill_gap_summary && (
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-lg">
              <h2 className="mb-3 flex items-center gap-2 font-heading text-xl font-bold">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Skill-Gap Summary
              </h2>
              <p className="text-sm leading-relaxed text-muted">
                {roadmap.skill_gap_summary}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Plan Chat (persistent) ── */}
      {plan && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-lg">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
            <LogoMark className="h-5 w-5 text-primary" />
            Ask about your plan
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
            // Spec: sticky bottom-4 max-w-3xl mx-auto w-full flex items-center
            // gap-2.5 rounded-2xl border bg-card/90 backdrop-blur px-4 min-h-[52px]
            // shadow-sm z-10
            className="sticky bottom-4 z-10 mx-auto flex w-full max-w-3xl items-center gap-2.5 rounded-2xl border bg-card/90 px-4 backdrop-blur shadow-sm min-h-[52px]"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask a follow-up question…"
              disabled={chatLoading}
              // Spec text field: w-full bg-transparent text-sm focus:outline-none py-2 shrink
              className="w-full shrink bg-transparent py-2 text-sm text-foreground placeholder:text-muted/50 transition-all focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading}
              // Spec action button: flex items-center shrink-0 self-center
              className="flex shrink-0 cursor-pointer items-center self-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-2 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {!roadmap && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-muted">No roadmap was generated for this idea.</p>
        </div>
      )}
    </div>
  );
}

function Card({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}