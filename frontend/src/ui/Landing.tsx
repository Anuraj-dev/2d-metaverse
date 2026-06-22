import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { signUp, signIn, USE_MOCK } from "../net/auth";
import Logo from "./Logo";
import SphereScene from "./SphereScene";

const CHARS = ["char1", "char2", "char3", "char4"];
type Mode = "signin" | "signup";

/**
 * Pre-login experience: a deep-space observatory hero built around a wireframe
 * sphere, framed like an instrument viewport, with an inline console-style
 * sign-in. Owns the auth form and signals the parent via onEntered().
 */
export default function Landing({
  onEntered,
  notice,
}: {
  onEntered: () => void;
  notice?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(
    () => localStorage.getItem("avatar") ?? "char1"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reduce = useReducedMotion();
  const userInputRef = useRef<HTMLInputElement>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const u = username.trim();
    localStorage.setItem("avatar", avatar);

    if (USE_MOCK) {
      if (!u) return setError("Enter a name to join.");
      localStorage.setItem("token", "dev-token");
      localStorage.setItem("displayName", u);
      onEntered();
      return;
    }

    if (!u || !password) return setError("Username and passkey are required.");
    setBusy(true);
    try {
      if (mode === "signup") await signUp(u, password);
      const token = await signIn(u, password);
      localStorage.setItem("token", token);
      localStorage.setItem("displayName", u);
      onEntered();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  const cta = busy
    ? "Linking…"
    : USE_MOCK
      ? "Enter the metaverse"
      : mode === "signup"
        ? "Create account"
        : "Sign in";

  const ease = [0.22, 1, 0.36, 1] as const;
  const rise = (delay: number) =>
    reduce
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease },
        };

  return (
    <div className="landing">
      <SphereScene />

      {/* instrument viewport frame */}
      <div className="lp-frame" aria-hidden="true">
        <span className="lp-bracket tl" />
        <span className="lp-bracket tr" />
        <span className="lp-bracket bl" />
        <span className="lp-bracket br" />
      </div>

      <motion.nav
        className="lp-nav"
        initial={reduce ? false : { opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
      >
        <Logo />
        <button
          type="button"
          className="lp-nav-cta"
          onClick={() => userInputRef.current?.focus()}
        >
          Experience Metaverse <span aria-hidden="true">↗</span>
        </button>
      </motion.nav>

      {/* HUD corner readouts */}
      <motion.div
        className="lp-hud lp-hud-tl"
        {...rise(0.2)}
      >
        <span className="lp-tick" /> SECTOR&nbsp;01 · OPEN WORLD
      </motion.div>
      <div className="lp-hud lp-hud-br">RA 14ʰ29ᵐ / DEC −62°&nbsp;·&nbsp;EST 2026</div>

      <main className="lp-grid">
        <section className="lp-intro">
          <motion.p className="lp-kicker" {...rise(0.25)}>
            a living 2D space station
          </motion.p>
          <motion.h1 className="lp-wordmark" {...rise(0.35)}>
            hyprverse
          </motion.h1>
          <motion.p className="lp-tagline" {...rise(0.48)}>
            Step into the metaverse.
          </motion.p>
          <motion.div className="lp-meta" {...rise(0.58)}>
            <span>walk · talk · gather</span>
            <span className="lp-meta-dot">●</span>
            <span>proximity voice &amp; video</span>
          </motion.div>
        </section>

        <motion.form className="console" onSubmit={submit} {...rise(0.5)}>
          <div className="console-top">
            <span className="console-label">
              {USE_MOCK ? "// guest access" : "// crew access"}
            </span>
            <span className="console-status">ONLINE</span>
          </div>

          <h2 className="console-title">
            {USE_MOCK
              ? "Pick a callsign"
              : mode === "signup"
                ? "Register crew"
                : "Welcome back"}
          </h2>

          {!USE_MOCK && (
            <div className="console-tabs">
              <button
                type="button"
                className={mode === "signin" ? "active" : ""}
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "active" : ""}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Sign up
              </button>
            </div>
          )}

          <label className="field">
            <span className="field-label">Identifier</span>
            <input
              ref={userInputRef}
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="callsign"
              autoComplete="username"
            />
          </label>
          {!USE_MOCK && (
            <label className="field">
              <span className="field-label">Passkey</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </label>
          )}

          <div className="field-label avatar-head">Avatar</div>
          <div className="console-avatars">
            {CHARS.map((c) => (
              <button
                key={c}
                type="button"
                className={`avatar-thumb ${avatar === c ? "sel" : ""}`}
                style={{ backgroundImage: `url(/assets/characters/${c}.png)` }}
                aria-label={`Choose ${c}`}
                aria-pressed={avatar === c}
                onClick={() => setAvatar(c)}
              />
            ))}
          </div>

          {(error || notice) && (
            <div className="console-error">{error ?? notice}</div>
          )}

          <button type="submit" className="console-submit" disabled={busy}>
            <span>{cta}</span>
            <span className="console-submit-arrow" aria-hidden="true">→</span>
          </button>

          <p className="console-foot">
            WASD / arrows move · Shift runs · E sits · ? for help
          </p>
        </motion.form>
      </main>
    </div>
  );
}
