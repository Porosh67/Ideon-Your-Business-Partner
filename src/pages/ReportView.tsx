import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type {
  GeneratedReportRow,
  ChecklistTask,
  Competitor,
  CompetitorSnapshotItem,
  Skill,
} from '@/types';
import MarketRealityCheckPanel from '@/components/MarketRealityCheckPanel';
import CompetitorSnapshotPanel from '@/components/CompetitorSnapshotPanel';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CheckCircle2,
  Circle,
  FileText,
  Lightbulb,
  Loader2,
  Target,
  Users,
  Wallet,
} from 'lucide-react';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ReportView() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<GeneratedReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      // Fetch plan, idea, and roadmap in parallel
      const [planRes, roadmapRes] = await Promise.all([
        supabase.from('business_plans').select('*').eq('id', id).eq('user_id', user.id).single(),
        supabase.from('generated_roadmaps').select('*').eq('plan_id', id).eq('user_id', user.id).single(),
      ]);

      if (cancelled) return;

      if (!planRes.data) {
        setError("We couldn't find that report — it may have been deleted.");
        setLoading(false);
        return;
      }

      const plan = planRes.data as any;
      const roadmap = roadmapRes.data as any;

      // Fetch the linked idea
      const { data: idea } = await supabase
        .from('business_ideas')
        .select('*')
        .eq('id', plan.idea_id)
        .eq('user_id', user.id)
        .single();

      if (cancelled) return;

      const ideaData = idea as any;

      setReport({
        id: plan.id,
        idea_id: plan.idea_id,
        user_id: plan.user_id,
        idea_text: ideaData?.idea_text ?? '',
        idea_title: ideaData?.title ?? null,
        target_customer: plan.target_customer,
        cost_estimate: plan.cost_estimate,
        competitor_summary: plan.competitor_summary,
        first_steps: plan.first_steps,
        reality_check: plan.reality_check,
        competitor_snapshot: plan.competitor_snapshot,
        skills_to_learn: roadmap?.skills_to_learn ?? null,
        checklist_30_days: roadmap?.checklist_30_days ?? null,
        skill_gap_summary: roadmap?.skill_gap_summary ?? null,
        created_at: plan.created_at,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, id]);

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
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/reports')}
        className="mb-6 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Reports
      </button>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-md shadow-primary/20">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              {report.idea_title?.trim() || report.idea_text.slice(0, 80)}
            </h1>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(report.created_at)}
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-8">
        {/* ── Premium Features: Market Reality Check + Competitor Snapshot ── */}
        {(report.reality_check || report.competitor_snapshot) && (
          <div className="space-y-4">
            {report.reality_check && <MarketRealityCheckPanel data={report.reality_check} />}
            {report.competitor_snapshot && report.competitor_snapshot.length > 0 && (
              <CompetitorSnapshotPanel items={report.competitor_snapshot as CompetitorSnapshotItem[]} />
            )}
          </div>
        )}

        {/* ── Target Customer ── */}
        {report.target_customer && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
              <Users className="h-5 w-5 text-primary" />
              Target Customer
            </h2>
            <p className="text-sm leading-relaxed text-muted">{report.target_customer}</p>
          </section>
        )}

        {/* ── Cost Estimate ── */}
        {report.cost_estimate && (
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
              <Wallet className="h-5 w-5 text-primary" />
              Cost Estimate
            </h2>
            <p className="text-sm leading-relaxed text-muted">{report.cost_estimate}</p>
          </section>
        )}

        {/* ── Competitor Summary ── */}
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

        {/* ── 30-Day Checklist ── */}
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
                    {task.done ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </span>
                  <span className={task.done ? 'text-muted line-through' : 'text-foreground'}>
                    {task.task}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Skills to Learn ── */}
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

        {/* ── First Steps ── */}
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
      </div>
    </div>
  );
}
