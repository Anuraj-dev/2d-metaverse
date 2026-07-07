import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { signUp, signIn, USE_MOCK } from "../net/auth";
import { CHARS } from "../game/chars";
import Logo from "./Logo";
import CampusHero from "./CampusHero";
type Mode = "signin" | "signup";

/**
 * Pre-login experience (PRD 19): a pixel-campus diorama hero (CampusHero) with the
 * auth card floating over it in the app typeface. Owns the auth form and signals
 * the parent via onEntered(). The auth flow itself is unchanged — this is a
 * re-theme, not a contract change.
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

    if (!u || !password) return setError("Username and password are required.");
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
    ? "Entering…"
    : USE_MOCK
      ? "Enter the campus"
      : mode === "signup"
        ? "Create account"
        : "Sign in";

  return (
    <div className="landing">
      <CampusHero />

      <nav className="lp-nav">
        <Logo />
        <button
          type="button"
          className="lp-nav-cta"
          onClick={() => userInputRef.current?.focus()}
        >
          Enter campus <ArrowRight size={15} aria-hidden="true" />
        </button>
      </nav>

      <main className="lp-grid">
        <section className="lp-intro">
          <p className="lp-kicker">a cozy 2D pixel campus</p>
          <h1 className="lp-wordmark">hyprverse</h1>
          <p className="lp-tagline">
            Walk a little pixel campus, wander over to whoever&apos;s nearby, and
            talk like you&apos;re all in one room.
          </p>
          <div className="lp-meta">
            <span className="lp-chip">walk · talk · gather</span>
            <span className="lp-chip">proximity voice &amp; video</span>
          </div>
        </section>

        <form className="console" onSubmit={submit}>
          <h2 className="console-title">
            {USE_MOCK
              ? "Pick your character"
              : mode === "signup"
                ? "Join the campus"
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
            <span className="field-label">Username</span>
            <input
              ref={userInputRef}
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your name"
              autoComplete="username"
            />
          </label>
          {!USE_MOCK && (
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="your password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </label>
          )}

          <div className="field-label avatar-head">Choose your character</div>
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
            <div className="console-error" role="alert">{error ?? notice}</div>
          )}

          <button type="submit" className="console-submit" disabled={busy}>
            <span>{cta}</span>
            <ArrowRight className="console-submit-arrow" size={18} aria-hidden="true" />
          </button>

          <p className="console-foot">
            WASD / arrows move · Shift runs · E sits · ? for help
          </p>
        </form>
      </main>
    </div>
  );
}
