/** The Chordarium mark: a "C" ring with three beat dots. Colours follow the surrounding text. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M65.8 30.2A28 28 0 1 0 65.8 69.8" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
      <circle cx="61" cy="39" r="5.5" className="logo-dot-accent" />
      <circle cx="61" cy="50" r="5.5" fill="currentColor" />
      <circle cx="61" cy="61" r="5.5" fill="currentColor" />
    </svg>
  )
}
