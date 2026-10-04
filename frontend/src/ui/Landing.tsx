import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { LIMITS, USERNAME_PATTERN } from "@metaverse/shared";
import { AuthError, signUp, signIn, googleAvailable, startGoogleSignIn, completeGoogleSignIn, USE_MOCK } from "../net/auth";
import { CHARS, resolveCharKey } from "../game/chars";
import Logo from "./Logo";
import CampusHero from "./CampusHero";
import "./Landing.css";
type Mode = "signin" | "signup";

/**
 * Pre-login experience (PRD 19): a pixel-campus diorama hero (CampusHero) with the
 * auth card floating over it in the app typeface. Owns the auth form and signals
 * the parent via onEntered(). Password access, explicit session resume, and
 * Google completion all pass through the same backend-validated world entry.
 */
export default function Landing({
  onEntered,
  notice,
}: {
  onEntered: () => void;
  notice?: string | null;
}) {
  const [savedSession, setSavedSession] = useState(() => !USE_MOCK && localStorage.getItem("token") ? localStorage.getItem("displayName") || "your account" : null);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [avatar, setAvatar] = useState(
    () => resolveCharKey(localStorage.getItem("avatar") ?? "char1") ?? "char1"
  );
  const [busy, setBusy] = useState(() => !USE_MOCK && /(?:^#|&)google_(?:code|error)=/.test(window.location.hash));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username: string | null; password: string | null }>({
    username: null,
    password: null,
  });

  const [google, setGoogle] = useState<boolean | null>(USE_MOCK ? false : null);
  const oauthStarted = useRef(false);
  const entered = useEffectEvent(() => onEntered());

  useEffect(() => {
    if (USE_MOCK) return;
    void googleAvailable().then(setGoogle);
    if (oauthStarted.current) return;
    oauthStarted.current = true;
    const completion = completeGoogleSignIn();
    if (!completion) return;
    void completion.then((session) => {
      localStorage.setItem("token", session.token);
      localStorage.setItem("displayName", session.username);
      entered();
    }).catch(() => {
      setError("Google sign-in could not be completed. Please try again.");
    }).finally(() => setBusy(false));
  }, []);

  const userInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (busy) return;
    if (fieldErrors.username) userInputRef.current?.focus();
    else if (fieldErrors.password) passwordInputRef.current?.focus();
  }, [busy, fieldErrors]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
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
    let accountCreated = false;
    try {
      if (mode === "signup") {
        await signUp(u, password);
        accountCreated = true;
        setMode("signin");
      }
      const token = await signIn(u, password);
      localStorage.setItem("token", token);
      localStorage.setItem("displayName", u);
      onEntered();
    } catch (err) {
      if (err instanceof AuthError && err.field) {
        setFieldErrors({ username: err.field === "username" ? err.message : null, password: err.field === "password" ? err.message : null });
      }
      else setError(`${accountCreated ? "Your account was created. Sign in to continue. " : ""}${err instanceof Error ? err.message : "Could not connect."}`);
    } finally {
      setBusy(false);
    }
  };

  const cta = busy
    ? mode === "signup" ? "Creating account…" : "Signing in…"
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

        <form className="console" onSubmit={submit} noValidate aria-busy={busy}>
          <h2 className="console-title">
            {USE_MOCK
              ? "Pick your character"
              : mode === "signup"
                ? "Join the campus"
                : "Welcome back"}
          </h2>

          {savedSession && (
            <div className="saved-session">
              <p className="field-hint">You have a saved session. Continue to the campus with your account.</p>
              <button type="button" className="console-submit" disabled={busy} onClick={() => onEntered()}>Continue as {savedSession}</button>
              <button type="button" className="password-toggle" disabled={busy} onClick={() => {
                localStorage.removeItem("token");
                localStorage.removeItem("displayName");
                setSavedSession(null);
              }}>Use another account</button>
            </div>
          )}

          {!savedSession && <>
          {!USE_MOCK && (
            <div className="console-tabs" role="group" aria-label="Account access">
              <button
                type="button"
                className={mode === "signin" ? "active" : ""}
                aria-pressed={mode === "signin"}
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
                aria-pressed={mode === "signup"}
                disabled={busy}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                  setFieldErrors({ username: null, password: null });
                }}
              >
                Create account
              </button>
            </div>
          )}

          {!USE_MOCK && (
            <>
              <p className="field-hint">{mode === "signin" ? "Use your existing account. New here? Choose Create account." : "Choose a username and password to create your account."}</p>
              <button type="button" className="console-google" disabled={busy || google !== true} aria-describedby="google-status" onClick={() => {
                localStorage.setItem("avatar", avatar);
                setBusy(true);
                try { startGoogleSignIn(); } catch {
                  setBusy(false);
                  setError("Google sign-in could not start. Please try again.");
                }
              }}>Continue with Google</button>
              <p id="google-status" className="field-hint">{google === null ? "Checking Google sign-in…" : google ? "Google signs you in or creates your account." : "Google sign-in is not available yet. Use a username and password."}</p>
            </>
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
                type={showPassword ? "text" : "password"}
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
                aria-describedby={fieldErrors.password ? "password-error" : mode === "signup" ? "password-hint" : undefined}
              />
              <button type="button" className="password-toggle" disabled={busy} aria-controls="auth-password" aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? "Hide password" : "Show password"}</button>
              {fieldErrors.password && <span id="password-error" className="field-error" role="alert">{fieldErrors.password}</span>}
              {!fieldErrors.password && mode === "signup" && <span id="password-hint" className="field-hint">Use {LIMITS.passwordMin}–{LIMITS.passwordMax} characters.</span>}
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

          <button type="submit" className="console-submit" disabled={busy}>
            <span>{cta}</span>
            <ArrowRight className="console-submit-arrow" size={18} aria-hidden="true" />
          </button>
          </>}

          {busy && <p role="status" className="field-hint">{cta}</p>}

          {(error || notice) && (
            <div className="console-error" role="alert">{error ?? notice}</div>
          )}
        </form>
      </main>
    </div>
  );
}
