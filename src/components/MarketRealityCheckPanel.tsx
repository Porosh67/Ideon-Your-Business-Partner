import type { MarketRealityCheck } from '@/types';
import {
  BarChart3,
  Swords,
  Wrench,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

/** Color mapping for score labels. */
function labelColor(label: 'Low' | 'Medium' | 'High'): string {
  switch (label) {
    case 'Low':
      return 'text-success bg-success/10 border-success/20';
    case 'Medium':
      return 'text-warning bg-warning/10 border-warning/20';
    case 'High':
      return 'text-destructive bg-destructive/10 border-destructive/20';
  }
}

/** Verdict badge color. */
function verdictColor(verdict: 'Yes' | 'Maybe' | 'No'): string {
  switch (verdict) {
    case 'Yes':
      return 'from-success/20 to-success/5 text-success border-success/30';
    case 'Maybe':
      return 'from-warning/20 to-warning/5 text-warning border-warning/30';
    case 'No':
      return 'from-destructive/20 to-destructive/5 text-destructive border-destructive/30';
  }
}

function VerdictIcon({ verdict }: { verdict: 'Yes' | 'Maybe' | 'No' }) {
  if (verdict === 'Yes') return <TrendingUp className="h-4 w-4" />;
  if (verdict === 'No') return <TrendingDown className="h-4 w-4" />;
  return <Minus className="h-4 w-4" />;
}

interface Props {
  data: MarketRealityCheck;
}

export default function MarketRealityCheckPanel({ data }: Props) {
  const scores = [
    {
      key: 'demand',
      label: 'Demand signal',
      icon: BarChart3,
      score: data.demand,
    },
    {
      key: 'competition',
      label: 'Competition intensity',
      icon: Swords,
      score: data.competition,
    },
    {
      key: 'execution',
      label: 'Execution difficulty',
      icon: Wrench,
      score: data.execution,
    },
  ] as const;

  return (
    <div className="animate-message-in rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-surface to-surface p-5 shadow-lg">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <BarChart3 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-heading text-sm font-bold tracking-tight">
            Market Reality Check
          </h3>
          <p className="text-[11px] text-muted">Based on live research</p>
        </div>
      </div>

      {/* Score rows */}
      <div className="space-y-3">
        {scores.map(({ key, label, icon: Icon, score }) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {label}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${labelColor(score.label)}`}
                >
                  {score.score}/10 · {score.label}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {score.reason}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Verdict */}
      <div
        className={`mt-4 flex items-center gap-2.5 rounded-xl border bg-gradient-to-r p-3.5 ${verdictColor(data.worth_pursuing.verdict)}`}
      >
        <VerdictIcon verdict={data.worth_pursuing.verdict} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">
            Worth pursuing?{' '}
            <span className="font-extrabold">{data.worth_pursuing.verdict}</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">
            {data.worth_pursuing.reason}
          </p>
        </div>
      </div>
    </div>
  );
}
