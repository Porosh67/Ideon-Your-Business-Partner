import LogoMark from '@/components/LogoMark';
import TypingDots from '@/components/TypingDots';

/**
 * Branded "Ideon is thinking" chat bubble: LogoMark avatar beside a bubble
 * with three animated dots. Shared by Dashboard, IdeaNew (guest chat) and
 * IdeaView (plan chat) so every chat surface shows the same cue — never a
 * generic spinner.
 */
export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-message-in">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <LogoMark className="h-3.5 w-3.5" />
      </span>
      <div className="flex items-center gap-2 px-0.5 py-1.5 text-sm text-muted">
        <TypingDots />
        <span className="text-xs text-muted">Ideon is thinking</span>
      </div>
    </div>
  );
}
