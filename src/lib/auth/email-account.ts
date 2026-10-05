import type { EmailAuthResult } from "@/lib/auth/registration-storage";

export type { EmailAuthResult };

const FAILED = "Could not sign in. Try again.";

export type PlayerAuthBody =
  | { action: "register"; name: string; email: string; password: string }
  | { action: "sign-in"; email: string; password: string };

/** Shared by the login form and `/api/player-auth`. Throws a short message. */
export function readPlayerAuthBody(raw: unknown): PlayerAuthBody {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const action = obj.action === "register" || obj.action === "sign-in" ? obj.action : null;
  const email = typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  const password = typeof obj.password === "string" ? obj.password : "";
  const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 40) : "";
  if (action !== "register" && action !== "sign-in") throw new Error(FAILED);
  if (!email || !email.includes("@")) throw new Error("Enter a real email.");
  if (password.length < 8) throw new Error("Passcode needs at least 8 characters.");
  if (password.length > 128) throw new Error("Passcode needs at most 128 characters.");
  if (action === "register" && name.length < 1)
    throw new Error("Pick a short name for your player.");
  if (action === "register") return { action, name, email, password };
  return { action, email, password };
}

export async function registerWithPasscode(input: {
  name: string;
  email: string;
  password: string;
}): Promise<EmailAuthResult> {
  return postPlayerAuth({ action: "register", ...input });
}

export async function signInWithPasscode(input: {
  email: string;
  password: string;
}): Promise<EmailAuthResult> {
  return postPlayerAuth({ action: "sign-in", ...input });
}

async function postPlayerAuth(body: PlayerAuthBody): Promise<EmailAuthResult> {
  let response: Response;
  try {
    response = await fetch("/api/player-auth", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "failed", message: FAILED };
  }
  try {
    const data = (await response.json()) as EmailAuthResult;
    if (!data || typeof data.ok !== "boolean") {
      return { ok: false, code: "failed", message: FAILED };
    }
    return data;
  } catch {
    return { ok: false, code: "failed", message: FAILED };
  }
}
