/**
 * hyprverse wordmark — a small ringed-planet glyph + lowercase logotype.
 * Used in the landing navbar. Pure SVG so it stays crisp at any size.
 */
export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="brand" aria-label="hyprverse">
      <svg
        className="brand-mark"
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hv-planet" x1="14" y1="14" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9b6bff" />
            <stop offset="55%" stopColor="#6a3bff" />
            <stop offset="100%" stopColor="#2f7dff" />
          </linearGradient>
          <linearGradient id="hv-ring" x1="6" y1="30" x2="42" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#47bfff" />
            <stop offset="100%" stopColor="#c39bff" />
          </linearGradient>
        </defs>
        <ellipse
          cx="24"
          cy="25"
          rx="18"
          ry="5.6"
          transform="rotate(-20 24 25)"
          stroke="url(#hv-ring)"
          strokeWidth="2"
          fill="none"
        />
        <circle cx="24" cy="24" r="9.5" fill="url(#hv-planet)" />
        <ellipse cx="20.5" cy="20.5" rx="3.2" ry="2.2" fill="#fff" opacity="0.35" />
      </svg>
      <span className="brand-word">hyprverse</span>
    </span>
  );
}
