import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { GeneratedReportRow } from '@/types';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Target,
} from 'lucide-react';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Pull tags from a report for the preview card. */
function reportTags(report: GeneratedReportRow): string[] {
  const tags: string[] = [];
  if (report.reality_check?.worth_pursuing) {
    tags.push(report.reality_check.worth_pursuing.verdict === 'Yes' ? '✅ Worth Pursuing' : report.reality_check.worth_pursuing.verdict === 'Maybe' ? '⚠️ Maybe' : '❌ Risky');
  }
  if (report.competitor_snapshot && report.competitor_snapshot.length > 0) {
    tags.push(`${report.competitor_snapshot.length} competitors`);
  }
  if (report.checklist_30_days && report.checklist_30_days.length > 0) {
    tags.push(`${report.checklist_30_days.length}-day checklist`);
  }
  return tags.slice(0, 3);
}

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<GeneratedReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pull all plans with their ideas and roadmaps in a single query chain
      const { data: plans } = await supabase
        .from('business_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (!plans || plans.length === 0) {
        setReports([]);
        setLoading(false);
        return;
      }

      // Fetch ideas and roadmaps for these plans
      const ideaIds = [...new Set((plans as { idea_id: string }[]).map((p) => p.idea_id))];
      const planIds = (plans as { id: string }[]).map((p) => p.id);

      const [{ data: ideas }, { data: roadmaps }] = await Promise.all([
        supabase.from('business_ideas').select('*').in('id', ideaIds).eq('user_id', user.id),
        supabase.from('generated_roadmaps').select('*').in('plan_id', planIds).eq('user_id', user.id),
      ]);

      if (cancelled) return;

      const ideaMap = new Map((ideas ?? []).map((i: any) => [i.id, i]));
      const roadmapMap = new Map((roadmaps ?? []).map((r: any) => [r.plan_id, r]));

      const merged: GeneratedReportRow[] = (plans as any[]).map((p) => {
        const idea = ideaMap.get(p.idea_id);
        const roadmap = roadmapMap.get(p.id);
        return {
          id: p.id,
          idea_id: p.idea_id,
          user_id: p.user_id,
          idea_text: idea?.idea_text ?? '',
          idea_title: idea?.title ?? null,
          target_customer: p.target_customer,
          cost_estimate: p.cost_estimate,
          competitor_summary: p.competitor_summary,
          first_steps: p.first_steps,
          reality_check: p.reality_check,
          competitor_snapshot: p.competitor_snapshot,
          skills_to_learn: roadmap?.skills_to_learn ?? null,
          checklist_30_days: roadmap?.checklist_30_days ?? null,
          skill_gap_summary: roadmap?.skill_gap_summary ?? null,
          created_at: p.created_at,
        };
      });

      setReports(merged);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="animate-fade-in">
      {/* Back to Dashboard */}
      <button
        type="button"
        onClick={() => navigate('/dashboard')}
        className="mb-6 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-all duration-200 hover:bg-surface-hover hover:text-foreground active:scale-[0.97]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      <header className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-on-primary shadow-md shadow-primary/20">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Reports</h1>
              <p className="mt-0.5 text-sm text-muted">AI-generated business analysis and execution roadmaps.</p>
            </div>
          </div>
          <Link
            to="/ideas/new"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            New plan
          </Link>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
          <span className="sr-only">Loading reports…</span>
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="h-6 w-6" />
          </span>
          <h2 className="font-heading text-lg font-semibold">No reports yet</h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted">
            When you ask Ideon to research a business idea, the full analysis and roadmap will appear here.
          </p>
          <Link
            to="/dashboard?new=1"
            className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-secondary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97]"
          >
            Start a new idea
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => {
            const tags = reportTags(report);
            return (
              <Link
                key={report.id}
                to={`/reports/${report.id}`}
                className="group flex cursor-pointer flex-col rounded-2xl border border-border bg-surface p-5 shadow-card transition-all duration-200 hover:border-primary/30 hover:shadow-card-hover active:scale-[0.98]"
              >
                <div className="mb-3 flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Target className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-heading text-sm font-semibold tracking-tight">
                      {report.idea_title?.trim() || report.idea_text.slice(0, 60)}
                    </h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <Calendar className="h-3 w-3" />
                      {formatDate(report.created_at)}
                    </p>
                  </div>
                </div>

                {report.target_customer && (
                  <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted">
                    {report.target_customer}
                  </p>
                )}

                {tags.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-xs text-muted/60">View full report</span>
                  <ChevronRight className="h-4 w-4 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
