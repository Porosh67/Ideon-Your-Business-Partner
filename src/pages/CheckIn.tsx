import { useEffect, useState } from 'react';
import { supabase, callEdgeFunction } from '@/lib/supabase';
import { ensureHistory, loadHistory, updateCheckin, useHistory } from '@/lib/historyStore';
import { useMarkRouteReady } from '@/lib/transitionStore';
import { useAuth } from '@/hooks/useAuth';
import type { CheckinRow, BusinessIdeaRow } from '@/types';
import { Bot, Check, Flame, Loader2, NotebookPen, Pencil, Pin, PinOff, Sparkles } from 'lucide-react';
import IdeonLoader from '@/components/IdeonLoader';

const MOODS = [
  { value: 1, emoji: '😞', label: 'Rough' },
  { value: 2, emoji: '😕', label: 'Meh' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '🤩', label: 'Great' },
];

const ENERGY_LEVELS = [1, 2, 3, 4, 5];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CheckIn() {
  const { user } = useAuth();
  const { checkins } = useHistory();
  // Marks this route as rendered so a pending branded transition dismisses
  // as soon as the page is on screen (history still loads in the background).
  useMarkRouteReady();
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [todayEntry, setTodayEntry] = useState<CheckinRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── AI response state ──
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Ensure the shared history cache is warm; never block rendering on it.
  useEffect(() => {
    if (user) ensureHistory(user.id);
  }, [user]);

  // Derive today's entry + history from the store; prefill the form as soon as
  // today's check-in arrives (the first render happens instantly, empty).
  useEffect(() => {
    const today = checkins.find((r) => r.checkin_date === todayStr()) ?? null;
    setTodayEntry(today);
    if (today) {
      setMood(today.mood);
      setEnergy(today.energy);
      setNotes(today.notes ?? '');
    }
  }, [checkins]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || mood === null || energy === null) {
      setError('Pick a mood and an energy level to save your check-in.');
      return;
    }
    setError(null);
    setSaving(true);
    const { error: upsertError } = await supabase.from('daily_checkins').upsert(
      {
        user_id: user.id,
        checkin_date: todayStr(),
        mood,
        energy,
        notes: notes.trim() || null,
        // Preserve existing title/pin when updating today's entry
        title: todayEntry?.title ?? null,
        is_pinned: todayEntry?.is_pinned ?? false,
      },
      { onConflict: 'user_id,checkin_date' }
    );
    setSaving(false);
    if (upsertError) {
      setError('We couldn\'t save that — try again?');
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    loadHistory(user.id);

    // ── Get AI response ──
    setAiLoading(true);
    setAiResponse(null);
    try {
      // Fetch latest business idea for context
      let latestIdea: string | undefined;
      try {
        const { data: ideas } = await supabase
          .from('business_ideas')
          .select('idea_text')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (ideas && ideas.length > 0) {
          latestIdea = (ideas[0] as BusinessIdeaRow).idea_text;
        }
      } catch {
        // Not critical if we can't fetch idea
      }

      const result = await callEdgeFunction<{ reply: string }>('checkin-respond', {
        mood,
        energy,
        notes: notes.trim() || undefined,
        latest_idea: latestIdea,
      });

      setAiResponse(result.reply);

      // Persist the AI response so the sidebar's check-in detail view can show it.
      try {
        await supabase
          .from('daily_checkins')
          .update({ ai_response: result.reply })
          .eq('user_id', user.id)
          .eq('checkin_date', todayStr());
      } catch {
        // Persisting the response is best-effort.
      }
    } catch {
      // Silently fail — the response is a nice-to-have
    }
    setAiLoading(false);
    window.dispatchEvent(new CustomEvent('ideon:checkins-changed'));
  };

  const streak = (): number => {
    const dates = new Set(checkins.map((h) => h.checkin_date));
    let count = 0;
    const cursor = new Date();
    if (!dates.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  };

  const formatDate = (d: string): string =>
    new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  const togglePin = async (c: CheckinRow) => {
    const next = !c.is_pinned;
    updateCheckin(c.id, { is_pinned: next });
    await supabase.from('daily_checkins').update({ is_pinned: next }).eq('id', c.id);
    window.dispatchEvent(new CustomEvent('ideon:checkins-changed'));
  };

  const startRename = (c: CheckinRow) => {
    setRenamingId(c.id);
    setRenameValue(c.title ?? '');
  };

  const saveRename = async (c: CheckinRow) => {
    const title = renameValue.trim() || null;
    setRenamingId(null);
    updateCheckin(c.id, { title });
    await supabase.from('daily_checkins').update({ title }).eq('id', c.id);
    window.dispatchEvent(new CustomEvent('ideon:checkins-changed'));
  };

  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <div className="mb-10 text-center">
        <h1 className="font-heading text-3xl font-extrabold tracking-tight">Daily check-in</h1>
        <p className="mt-2 text-muted">
          {todayEntry
            ? 'You\'ve checked in today — update it anytime.'
            : 'How are you feeling today, founder?'}
        </p>
        {streak() > 0 && (
          <span className="mt-4 inline-flex animate-scale-in items-center gap-1.5 rounded-full bg-gradient-to-r from-primary/15 to-primary/5 px-4 py-1.5 text-sm font-semibold text-primary shadow-sm ring-1 ring-primary/10">
            <Flame className="h-4 w-4" />
            {streak()}-day streak
          </span>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border bg-surface p-6 shadow-lg sm:p-8 transition-all duration-300 hover:shadow-card-hover"
      >
        {/* Mood */}
        <fieldset className="mb-8">
          <legend className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Mood
          </legend>
          <div className="grid grid-cols-5 gap-3">
            {MOODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMood(m.value)}
                aria-pressed={mood === m.value}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-2xl transition-all duration-200 active:scale-95 ${
                  mood === m.value
                    ? 'border-primary bg-gradient-to-b from-primary/15 to-primary/5 shadow-md shadow-primary/10 scale-105'
                    : 'border-border bg-background/40 hover:bg-background/70 hover:border-primary/20'
                }`}
              >
                <span aria-hidden="true">{m.emoji}</span>
                <span
                  className={`text-xs font-semibold ${
                    mood === m.value ? 'text-primary' : 'text-muted'
                  }`}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* Energy */}
        <fieldset className="mb-8">
          <legend className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
            <Flame className="h-4 w-4 text-accent" />
            Energy{' '}
            {energy !== null && (
              <span className="font-normal text-muted">({energy}/5)</span>
            )}
          </legend>
          <div className="flex gap-2">
            {ENERGY_LEVELS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setEnergy(n)}
                aria-pressed={energy === n}
                aria-label={`Energy level ${n} of 5`}
                className={`h-12 flex-1 rounded-xl border text-sm font-bold transition-all duration-200 active:scale-95 ${
                  energy !== null && n <= energy
                    ? 'border-accent bg-gradient-to-b from-accent to-accent-hover text-white shadow-md shadow-accent/20 scale-105'
                    : 'border-border bg-background/40 text-muted hover:bg-background/70 hover:border-accent/20'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted/70">
            <span>Drained</span>
            <span>Charged</span>
          </div>
        </fieldset>

        {/* Notes */}
        <div className="mb-6">
          <label htmlFor="notes" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground">
            <NotebookPen className="h-4 w-4 text-muted" />
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What's on your mind? Wins, blockers, ideas…"
            className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted/50 transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {error && (
          <p className="mb-5 animate-fade-in rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || mood === null || energy === null}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-accent to-accent-hover px-6 py-3.5 text-sm font-semibold text-white shadow-md shadow-accent/20 transition-all duration-200 hover:shadow-lg hover:shadow-accent/30 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : savedFlash ? (
            <Check className="h-4 w-4" />
          ) : (
            <Flame className="h-4 w-4" />
          )}
          {savedFlash ? 'Saved!' : saving ? 'Saving…' : todayEntry ? 'Update check-in' : 'Save check-in'}
        </button>
      </form>

      {/* ── AI Response ── */}
      {(aiLoading || aiResponse) && (
        <div className="mt-6 animate-fade-in rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold text-primary">Your coach says</span>
          </div>
          {aiLoading ? (
            <div className="flex items-start">
              <IdeonLoader
                label="Ideon is reflecting"
                sublabel="Reflecting on your check-in…"
                size="sm"
              />
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-foreground">{aiResponse}</p>
          )}
        </div>
      )}

      {/* ── History ── */}
      {checkins.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-heading text-xl font-bold tracking-tight">History</h2>
          <ul className="space-y-2">
            {checkins.map((h) => (
              <li
                key={h.id}
                className={`group flex items-center gap-4 rounded-xl border bg-surface/60 p-4 shadow-sm transition-all duration-200 hover:bg-surface hover:shadow-card-hover ${
                  h.is_pinned
                    ? 'border-primary/30'
                    : 'border-border hover:border-primary/20'
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 text-xl" aria-hidden="true">
                  {MOODS.find((m) => m.value === h.mood)?.emoji ?? '😐'}
                </span>
                <div className="min-w-0 flex-1">
                  {renamingId === h.id ? (
                    <input
                      ref={(el) => el?.focus()}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(h)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(h);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      aria-label="Check-in name"
                      placeholder="Name this check-in…"
                      className="w-full rounded-lg border border-primary/40 bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  ) : (
                    <p className="text-sm font-medium text-foreground">
                      {h.title?.trim() ? h.title : formatDate(h.checkin_date)}
                    </p>
                  )}
                  {h.title?.trim() && (
                    <p className="mt-0.5 text-xs text-muted">{formatDate(h.checkin_date)}</p>
                  )}
                  {h.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted">{h.notes}</p>
                  )}
                </div>
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <Flame className="h-3.5 w-3.5 text-accent" />
                  Energy {h.energy}/5
                </span>
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => togglePin(h)}
                    aria-pressed={h.is_pinned}
                    aria-label={h.is_pinned ? 'Unpin check-in' : 'Pin check-in'}
                    title={h.is_pinned ? 'Unpin' : 'Pin'}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-200 active:scale-90 ${
                      h.is_pinned
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border text-muted hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {h.is_pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(h)}
                    aria-label="Rename check-in"
                    title="Rename"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-all duration-200 hover:border-primary/40 hover:text-primary active:scale-90"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}