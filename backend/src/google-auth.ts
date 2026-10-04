import { createHash, randomBytes } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { googleExchangeRequestSchema } from "@metaverse/shared";
import { issueToken, type AuthUser } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { redis } from "./redis.js";
import { getSuspension } from "./repository.js";
import { isSuspended } from "./suspension.js";
import { childLogger } from "./logger.js";
import { requestLog } from "./request-logger.js";
import { verifyGoogleIdentity } from "./google-identity.js";

const log = childLogger({ module: "google-auth" });
const random = (): string => randomBytes(32).toString("base64url");
const digest = (value: string): string => createHash("sha256").update(value).digest("base64url");
const transactionSchema = z.object({ verifier: z.string(), nonce: z.string(), browser: z.string(), clientNonce: z.string() });
const userSchema = z.object({ id: z.string(), username: z.string() });
const cookieName = "google_oauth_browser";
const enabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);

/** Serialize provision by subject; random names never collide with local email/name accounts. */
async function provision(subject: string): Promise<AuthUser> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`google:${subject}`]);
    const existing = await client.query<AuthUser>("SELECT u.id, u.username FROM users u JOIN oauth_identities i ON i.user_id = u.id WHERE i.provider = 'google' AND i.subject = $1", [subject]);
    let user = existing.rows[0];
    if (!user) {
      for (let attempt = 0; attempt < 5 && !user; attempt++) {
        const inserted = await client.query<AuthUser>("INSERT INTO users (username, password_hash) VALUES ($1, NULL) ON CONFLICT (username) DO NOTHING RETURNING id, username", [`student_${randomBytes(10).toString("hex")}`]);
        user = inserted.rows[0];
      }
      if (!user) throw new Error("username provisioning failed");
      await client.query("INSERT INTO oauth_identities (provider, subject, user_id) VALUES ('google', $1, $2)", [subject, user.id]);
    }
    await client.query("COMMIT");
    return user;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export const googleAuth = express.Router();
googleAuth.get("/providers", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ google: enabled });
});
googleAuth.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (!enabled) { response.status(503).json({ error: "oauth-disabled" }); return; }
  next();
});
googleAuth.use(rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_request, response) => { response.status(429).json({ error: "rate-limited" }); }
}));
googleAuth.get("/google/start", async (request, response) => {
  const clientNonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(request.query.client_nonce);
  if (!clientNonce.success) { response.status(400).json({ error: "oauth-failed" }); return; }
  const state = random();
  const verifier = random();
  const nonce = random();
  const browser = random();
  await redis.set(`oauth:state:${digest(state)}`, JSON.stringify({ verifier, nonce, browser: digest(browser), clientNonce: digest(clientNonce.data) }), { EX: 300 });
  response.cookie(cookieName, browser, { httpOnly: true, secure: config.NODE_ENV === "production" || config.GOOGLE_REDIRECT_URI.startsWith("https:"), sameSite: "lax", maxAge: 300_000, path: "/api/v1/auth/google" });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: "code", scope: "openid", state, nonce, code_challenge: digest(verifier), code_challenge_method: "S256" }).toString();
  response.redirect(url.toString());
});
googleAuth.get("/google/callback", async (request, response) => {
  const destination = new URL(config.GOOGLE_FRONTEND_REDIRECT_URI);
  let stage: "callback-input" | "state-store" | "state-validation" | "browser-binding" | "token-exchange" | "identity-verification" | "account-provision" | "suspension-check" | "suspended" | "ticket-store" = "callback-input";
  try {
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(request.query.state);
    const code = z.string().min(1).max(4096).parse(request.query.code);
    stage = "state-store";
    const raw = await redis.getDel(`oauth:state:${digest(state)}`);
    stage = "state-validation";
    if (!raw) throw new Error("expired state");
    const transaction = transactionSchema.parse(JSON.parse(raw));
    stage = "browser-binding";
    const browser = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!browser || transaction.browser !== digest(browser)) throw new Error("browser mismatch");
    stage = "token-exchange";
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.GOOGLE_CLIENT_ID, client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_REDIRECT_URI, grant_type: "authorization_code", code_verifier: transaction.verifier }) });
    if (!tokenResponse.ok) throw new Error("code exchange failed");
    const tokens = z.object({ id_token: z.string() }).parse(await tokenResponse.json());
    stage = "identity-verification";
    const subject = await verifyGoogleIdentity(tokens.id_token, config.GOOGLE_CLIENT_ID, transaction.nonce);
    stage = "account-provision";
    const user = await provision(subject);
    stage = "suspension-check";
    const suspension = await getSuspension(user.id);
    if (isSuspended(suspension, Date.now())) { stage = "suspended"; throw new Error("suspended account"); }
    stage = "ticket-store";
    const ticket = random();
    await redis.set(`oauth:ticket:${digest(ticket)}`, JSON.stringify({ user, clientNonce: transaction.clientNonce }), { EX: 60 });
    destination.hash = new URLSearchParams({ google_code: ticket }).toString();
  } catch {
    requestLog(response, log).warn({ module: "google-auth", event: "oauth-callback-failed", stage }, "Google sign-in callback failed");
    // Provider errors deliberately exclude codes, tokens, subjects and account details.
    destination.hash = "google_error=oauth-failed";
  }
  response.clearCookie(cookieName, { path: "/api/v1/auth/google" });
  response.redirect(destination.toString());
});
googleAuth.post("/google/exchange", async (request, response) => {
  const parsed = googleExchangeRequestSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "oauth-failed" }); return; }
  const raw = await redis.getDel(`oauth:ticket:${digest(parsed.data.code)}`);
  if (!raw) { response.status(401).json({ error: "oauth-failed" }); return; }
  const ticket = z.object({ user: userSchema, clientNonce: z.string() }).parse(JSON.parse(raw));
  if (ticket.clientNonce !== digest(parsed.data.clientNonce)) { response.status(401).json({ error: "oauth-failed" }); return; }
  const user = ticket.user;
  const suspension = await getSuspension(user.id);
  if (isSuspended(suspension, Date.now())) { response.status(403).json({ error: "oauth-failed" }); return; }
  response.json({ token: issueToken(user), username: user.username });
});
