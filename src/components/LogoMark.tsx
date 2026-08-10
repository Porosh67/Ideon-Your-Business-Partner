/**
 * Ideon mark: a clean geometric AI spark — the "idea in motion" symbol.
 * Drawn in currentColor so it inherits the surrounding tile/text color.
 */
export default function LogoMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Main spark — four curved petals, symmetric, balanced */}
      <path
        d="M12 3C12.7 8.1 15.9 11.3 21 12C15.9 12.7 12.7 15.9 12 21C11.3 15.9 8.1 12.7 3 12C8.1 11.3 11.3 8.1 12 3Z"
        fill="currentColor"
      />
      {/* Small trailing spark for depth */}
      <path
        d="M19.2 16.4c.32 1.02.78 1.48 1.8 1.8-1.02.32-1.48.78-1.8 1.8-.32-1.02-.78-1.48-1.8-1.8 1.02-.32 1.48-.78 1.8-1.8Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}
