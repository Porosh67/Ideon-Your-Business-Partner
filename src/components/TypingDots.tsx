/**
 * Three animated dots — the "Ideon is thinking" typing cue.
 * Inherits the current text color and respects prefers-reduced-motion
 * via the `animate-typing-dot` token's media query.
 */
export default function TypingDots() {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current animate-typing-dot"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
