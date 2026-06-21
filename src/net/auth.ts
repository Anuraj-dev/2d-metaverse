/** REST auth against Codex's backend. Returns a JWT used for socket join + LiveKit tokens. */
const BASE = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? "1") !== "0";

/** Sign up (ignored if the user already exists), then sign in. Returns the token. */
export async function authenticate(
  username: string,
  password: string
): Promise<string> {
  await fetch(`${BASE}/api/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }).catch(() => {}); // 400 = username taken; fine, we just sign in

  const res = await fetch(`${BASE}/api/v1/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Sign in failed — check username / password");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export const serverBase = BASE;
