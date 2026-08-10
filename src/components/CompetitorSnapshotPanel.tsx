import type { CompetitorSnapshotItem } from '@/types';
import { Building2, SearchX } from 'lucide-react';

interface Props {
  items: CompetitorSnapshotItem[];
}

export default function CompetitorSnapshotPanel({ items }: Props) {
  // Honest empty state — no fake data
  if (!items || items.length === 0) {
    return (
      <div className="animate-message-in rounded-2xl border border-border bg-surface/60 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/15 text-muted">
            <SearchX className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-bold tracking-tight">
              Competitor Snapshot
            </h3>
            <p className="text-[11px] text-muted">
              No strong competitors were found in the live research. This could
              mean the market is wide open — or that competitors use different
              naming. Worth a manual check.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-message-in rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/5 via-surface to-surface p-5 shadow-lg">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Building2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-heading text-sm font-bold tracking-tight">
            Competitor Snapshot
          </h3>
          <p className="text-[11px] text-muted">
            {items.length} player{items.length !== 1 ? 's' : ''} found in live
            research
          </p>
        </div>
      </div>

      {/* Competitor cards */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {items.map((c, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/60 bg-background/40 p-3 transition-colors hover:border-accent/30 hover:bg-background/60"
          >
            <p className="text-xs font-bold text-foreground">{c.name}</p>
            <div className="mt-1.5 flex items-start gap-1.5">
              <span className="mt-px shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Pricing
              </span>
              <span className="text-[11px] leading-snug text-muted">
                {c.pricing}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              <span className="font-semibold text-foreground/80">
                vs your idea:{' '}
              </span>
              {c.difference}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
