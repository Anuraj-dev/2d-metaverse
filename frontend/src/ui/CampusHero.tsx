/**
 * The landing's pixel-campus diorama (PRD 19). A pre-composed backdrop rendered
 * from the game's real tiles (frontend/scripts/gen_landing_backdrop.py) with a
 * handful of individually animated sprite elements layered over it: a few avatars
 * strolling the plaza (CSS step() walk cycles reusing the in-game character
 * spritesheets), drifting ambient motes, and a slow day/night tint.
 *
 * Deliberately engine-free — no Phaser boots on the landing. Every animation is
 * pure CSS, so `prefers-reduced-motion` collapses this to the static backdrop
 * composition with no JS involved (the strollers/motes hide, the tint freezes).
 */

// Each stroller reuses one of the 12 in-game character spritesheets (96×128, a
// 3-col × 4-row grid of 32×32 frames; row 1 = facing left, row 2 = facing right).
type Stroller = {
  char: string;
  dir: "left" | "right";
  top: string; // vertical band on the plaza
  scale: number;
  dur: string; // seconds to cross
  delay: string; // negative → mid-walk on first paint
};

const STROLLERS: Stroller[] = [
  { char: "char5", dir: "right", top: "58%", scale: 2.2, dur: "34s", delay: "0s" },
  { char: "char9", dir: "left", top: "70%", scale: 2.5, dur: "29s", delay: "-8s" },
  { char: "char2", dir: "right", top: "80%", scale: 2.8, dur: "26s", delay: "-15s" },
];

const MOTES = [
  { left: "22%", top: "40%", dur: "13s", delay: "0s" },
  { left: "48%", top: "62%", dur: "17s", delay: "-6s" },
  { left: "68%", top: "34%", dur: "15s", delay: "-11s" },
  { left: "84%", top: "72%", dur: "19s", delay: "-3s" },
];

export default function CampusHero() {
  return (
    <div className="campus-hero" aria-hidden="true">
      <div className="campus-hero-bg" />
      <div className="campus-hero-tint" />

      {STROLLERS.map((s, i) => (
        <span
          key={i}
          className={`stroller stroller--${s.dir}`}
          style={
            {
              "--sheet": `url(/assets/characters/${s.char}.png)`,
              "--row": s.dir === "left" ? 1 : 2,
              "--scale": s.scale,
              "--top": s.top,
              "--dur": s.dur,
              "--delay": s.delay,
            } as React.CSSProperties
          }
        />
      ))}

      {MOTES.map((m, i) => (
        <span
          key={i}
          className="campus-mote"
          style={
            {
              "--left": m.left,
              "--top": m.top,
              "--dur": m.dur,
              "--delay": m.delay,
            } as React.CSSProperties
          }
        />
      ))}

      <div className="campus-hero-scrim" />
    </div>
  );
}
