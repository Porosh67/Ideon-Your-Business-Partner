import LogoMark from '@/components/LogoMark';

/**
 * Branded, animated "Ideon is thinking…" indicator.
 *
 * Used for:
 *  - the full research→plan pipeline (two stages: research / plan)
 *  - simple reply typing (general questions)
 *  - full-page transitions (sign-in, sign-out)
 *
 * The logo gently breathes + pulses with a soft glow — a premium alternative
 * to a generic spinner. Respects prefers-reduced-motion via the CSS classes.
 */
export default function IdeonLoader({
  label = 'Ideon is thinking',
  sublabel,
  size = 'md',
  className = '',
}: {
  label?: string;
  sublabel?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box =
    size === 'lg'
      ? 'h-20 w-20 rounded-3xl'
      : size === 'sm'
        ? 'h-10 w-10 rounded-xl'
        : 'h-14 w-14 rounded-2xl';
  const logo = size === 'lg' ? 'h-9 w-9' : size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}
    >
      <span
        className={`ideon-loader-box relative flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-on-primary shadow-lg shadow-primary/25 ${box}`}
      >
        <LogoMark className={`${logo} ideon-loader-logo`} />
      </span>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted">{sublabel}</p>}
      </div>
    </div>
  );
}
