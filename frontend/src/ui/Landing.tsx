import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { LIMITS, USERNAME_PATTERN } from "@metaverse/shared";
import { AuthError, signUp, signIn, USE_MOCK } from "../net/auth";
import { CHARS, resolveCharKey } from "../game/chars";
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
    () => resolveCharKey(localStorage.getItem("avatar") ?? "char1") ?? "char1"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username: string | null; password: string | null }>({
    username: null,
    password: null,
  });

  const userInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (busy) return;
    if (fieldErrors.username) userInputRef.current?.focus();
    else if (fieldErrors.password) passwordInputRef.current?.focus();
  }, [busy, fieldErrors]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setFieldErrors({ username: null, password: null });
    const u = username.trim().toLowerCase();
    localStorage.setItem("avatar", avatar);

    if (USE_MOCK) {
      if (!u) return setError("Enter a name to join.");
      localStorage.setItem("token", "dev-token");
      localStorage.setItem("displayName", u);
      onEntered();
      return;
    }

    const nextErrors: { username: string | null; password: string | null } = { username: null, password: null };
    if (!u) nextErrors.username = "Username is required.";
    else if (u.length < LIMITS.usernameMin) nextErrors.username = `Username must be at least ${LIMITS.usernameMin} characters.`;
    else if (u.length > LIMITS.usernameMax) nextErrors.username = `Username must be at most ${LIMITS.usernameMax} characters.`;
    else if (!USERNAME_PATTERN.test(u)) nextErrors.username = "Use only letters, numbers, underscores, and hyphens.";
    if (!password.trim()) nextErrors.password = "Password is required.";
    else if (password.length < LIMITS.passwordMin) nextErrors.password = `Password must be at least ${LIMITS.passwordMin} characters.`;
    else if (password.length > LIMITS.passwordMax) nextErrors.password = `Password must be at most ${LIMITS.passwordMax} characters.`;
    if (nextErrors.username || nextErrors.password) {
      setFieldErrors(nextErrors);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await signUp(u, password);
      const token = await signIn(u, password);
      localStorage.setItem("token", token);
      localStorage.setItem("displayName", u);
      onEntered();
    } catch (err) {
      if (err instanceof AuthError && err.field) {
        setFieldErrors({ username: err.field === "username" ? err.message : null, password: err.field === "password" ? err.message : null });
      }
      else setError(err instanceof Error ? err.message : "Could not connect.");
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

        <form className="console" onSubmit={submit} noValidate>
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
                disabled={busy}
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setFieldErrors({ username: null, password: null });
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                  setFieldErrors({ username: null, password: null });
                }}
              >
                Sign up
              </button>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              ref={userInputRef}
              autoFocus
              disabled={busy}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFieldErrors((current) => ({ ...current, username: null }));
              }}
              placeholder="your name"
              autoComplete="username"
              minLength={LIMITS.usernameMin}
              maxLength={LIMITS.usernameMax}
              pattern="[A-Za-z0-9_-]+"
              aria-invalid={fieldErrors.username ? "true" : undefined}
              aria-describedby={fieldErrors.username ? "username-error" : mode === "signup" ? "username-hint" : undefined}
            />
            {fieldErrors.username && <span id="username-error" className="field-error" role="alert">{fieldErrors.username}</span>}
            {!fieldErrors.username && mode === "signup" && (
              <span id="username-hint" className="field-hint">Letters, numbers, _ and -. Saved in lowercase.</span>
            )}
          </div>
          {!USE_MOCK && (
            <div className="field">
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                ref={passwordInputRef}
                type="password"
                disabled={busy}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((current) => ({ ...current, password: null }));
                }}
                placeholder="your password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={LIMITS.passwordMin}
                maxLength={LIMITS.passwordMax}
                aria-invalid={fieldErrors.password ? "true" : undefined}
                aria-describedby={fieldErrors.password ? "password-error" : undefined}
              />
              {fieldErrors.password && <span id="password-error" className="field-error" role="alert">{fieldErrors.password}</span>}
            </div>
          )}

          <div className="field-label avatar-head">Choose your character</div>
          <div className="console-avatars">
            {CHARS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={busy}
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
        </form>
      </main>
    </div>
  );
}
