import { Trees } from "lucide-react";

/**
 * hyprverse wordmark — a small campus/park glyph + lowercase logotype, in the app
 * typeface (PRD 18/19). The mark is a lucide icon so it stays crisp at any size and
 * matches the app-wide icon language.
 */
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="brand" aria-label="hyprverse">
      <Trees className="brand-mark" size={size} aria-hidden="true" />
      <span className="brand-word">hyprverse</span>
    </span>
  );
}
