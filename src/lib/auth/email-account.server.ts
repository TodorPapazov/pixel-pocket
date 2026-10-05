import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import {
  type EmailAuthResult,
  isLiveAuthServer,
  registrationStorageError,
} from "@/lib/auth/registration-storage";

/** Better Auth's Set-Cookie lines, forwarded by the player-auth route. */
export type EmailAuthPayload = {
  result: EmailAuthResult;
  cookies: string[];
};

function payload(result: EmailAuthResult, cookies: string[] = []): EmailAuthPayload {
  return { result, cookies };
}

const MISMATCH =
  "Email or passcode did not match. If this is your first time, tap Create player. Tap Forgot passcode if you need the way back in.";
const TAKEN = "That email is taken, and this passcode did not match. Use Sign in.";
const SAVE_FAILED = "Could not save that player. Try again.";
const SIGN_IN_FAILED = "Could not sign in. Try again.";

type AuthJson = {
  token?: string | null;
  user?: { id?: string };
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
};

type CredentialRow = {
  user_id: string;
  account_id: string | null;
  password: string | null;
};

function storageRefusal(): EmailAuthResult | null {
  const message = registrationStorageError({
    databaseUrl: process.env.DATABASE_URL,
    liveServer: isLiveAuthServer(process.env),
  });
  if (!message) return null;
  return { ok: false, code: "not_saved", message };
}

function incomingHeaders(): Headers {
  try {
    const request = getRequest();
    if (request) return new Headers(request.headers);
  } catch (err) {
    console.error("[email-account] no request headers", err);
  }
  return new Headers();
}

function errorCode(body: AuthJson): string {
  return body.code ?? body.error?.code ?? "";
}

function errorText(body: AuthJson): string {
  return body.message ?? body.error?.message ?? "";
}

function alreadyExists(body: AuthJson): boolean {
  const code = errorCode(body);
  const message = errorText(body).toLowerCase();
  return code.includes("USER_ALREADY_EXISTS") || message.includes("already exists");
}

function isMismatch(body: AuthJson): boolean {
  return errorCode(body).includes("INVALID_EMAIL_OR_PASSWORD");
}

async function readJson(response: Response): Promise<AuthJson> {
  try {
    return (await response.json()) as AuthJson;
  } catch {
    return {};
  }
}

/**
 * Better Auth already put the session on this response. A server function
 * drops those headers on the way out, so the route copies the lines itself.
 */
function sessionCookies(response: Response): string[] {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
}

async function signUpResponse(email: string, password: string, name: string): Promise<Response> {
  return (await auth.api.signUpEmail({
    body: { email, password, name },
    headers: incomingHeaders(),
    asResponse: true,
  })) as Response;
}

async function signInResponse(email: string, password: string): Promise<Response> {
  return (await auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    headers: incomingHeaders(),
    asResponse: true,
  })) as Response;
}

async function finishSignIn(response: Response, body: AuthJson): Promise<EmailAuthPayload> {
  if (!response.ok) {
    if (isMismatch(body)) return payload({ ok: false, code: "mismatch", message: MISMATCH });
    const message = errorText(body).trim();
    return payload({ ok: false, code: "failed", message: message || SIGN_IN_FAILED });
  }
  const cookies = sessionCookies(response);
  const token = typeof body.token === "string" && body.token.length >= 8 ? body.token : null;
  if (!token && cookies.length === 0) {
    return payload({ ok: false, code: "failed", message: SIGN_IN_FAILED });
  }
  return payload({ ok: true, token }, cookies);
}

async function credentialRow(email: string): Promise<CredentialRow | null> {
  const sql = await getSql();
  const rows = await sql<CredentialRow>`
    select u.id as user_id, a.id as account_id, a."password" as password
    from "user" u
    left join "account" a
      on a."userId" = u.id and a."providerId" = 'credential'
    where lower(u.email) = ${email}
    limit 1
  `;
  return rows[0] ?? null;
}

async function storeMissingPasscode(row: CredentialRow, password: string): Promise<void> {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  if (row.account_id) {
    const sql = await getSql();
    await sql`
      update "account"
      set "password" = ${hash}, "updatedAt" = now()
      where id = ${row.account_id}
    `;
    return;
  }
  await ctx.internalAdapter.createAccount({
    userId: row.user_id,
    providerId: "credential",
    accountId: row.user_id,
    password: hash,
  });
}

async function saveProfile(email: string, name: string): Promise<void> {
  const displayName = name.trim().slice(0, 40);
  if (!displayName) return;
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    select id from "user" where lower(email) = ${email} limit 1
  `;
  const id = rows[0]?.id;
  if (!id) return;
  await sql`
    insert into profiles (user_id, display_name, updated_at)
    values (${id}, ${displayName}, now())
    on conflict (user_id) do update
      set display_name = excluded.display_name,
          updated_at = now()
  `;
}

async function clearRepairedPasscode(row: CredentialRow): Promise<void> {
  const sql = await getSql();
  if (row.account_id) {
    await sql`
      update "account"
      set "password" = null, "updatedAt" = now()
      where id = ${row.account_id}
    `;
    return;
  }
  await sql`
    delete from "account"
    where "userId" = ${row.user_id} and "providerId" = 'credential'
  `;
}

async function deleteCreatedUser(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(userId);
  } catch (err) {
    console.error("[email-account] could not roll back the new player", err);
  }
}

export async function registerWithPasscodeOnServer(input: {
  name: string;
  email: string;
  password: string;
}): Promise<EmailAuthPayload> {
  const refused = storageRefusal();
  if (refused) return payload(refused);

  let created: Response;
  try {
    created = await signUpResponse(input.email, input.password, input.name);
  } catch (err) {
    console.error("[email-account] sign-up failed", err);
    return payload({ ok: false, code: "failed", message: SAVE_FAILED });
  }
  const createdBody = await readJson(created);
  let repaired: CredentialRow | null = null;

  if (!created.ok) {
    if (!alreadyExists(createdBody)) {
      const message = errorText(createdBody).trim();
      return payload({ ok: false, code: "failed", message: message || SAVE_FAILED });
    }
    const row = await credentialRow(input.email);
    if (!row) return payload({ ok: false, code: "failed", message: SAVE_FAILED });
    if (row.password) {
      const again = await signInResponse(input.email, input.password);
      const againBody = await readJson(again);
      if (!again.ok) {
        if (isMismatch(againBody)) return payload({ ok: false, code: "taken", message: TAKEN });
        const message = errorText(againBody).trim();
        return payload({ ok: false, code: "failed", message: message || SAVE_FAILED });
      }
      try {
        await saveProfile(input.email, input.name);
      } catch (err) {
        console.error("[email-account] profile save failed", err);
      }
      return finishSignIn(again, againBody);
    }
    try {
      await storeMissingPasscode(row, input.password);
    } catch (err) {
      console.error("[email-account] could not store the passcode", err);
      return payload({ ok: false, code: "failed", message: SAVE_FAILED });
    }
    repaired = row;
  }

  let signedIn: Response;
  try {
    signedIn = await signInResponse(input.email, input.password);
  } catch (err) {
    console.error("[email-account] sign-in after create failed", err);
    if (created.ok) await deleteCreatedUser(createdBody.user?.id);
    if (repaired) await clearRepairedPasscode(repaired).catch(() => undefined);
    return payload({ ok: false, code: "failed", message: SAVE_FAILED });
  }
  const signedBody = await readJson(signedIn);
  if (!signedIn.ok) {
    if (created.ok) await deleteCreatedUser(createdBody.user?.id);
    if (repaired) await clearRepairedPasscode(repaired).catch(() => undefined);
    return payload({ ok: false, code: "failed", message: SAVE_FAILED });
  }
  try {
    await saveProfile(input.email, input.name);
  } catch (err) {
    console.error("[email-account] profile save failed", err);
  }
  return finishSignIn(signedIn, signedBody);
}

export async function signInWithPasscodeOnServer(input: {
  email: string;
  password: string;
}): Promise<EmailAuthPayload> {
  const refused = storageRefusal();
  if (refused) return payload(refused);
  try {
    const response = await signInResponse(input.email, input.password);
    const body = await readJson(response);
    return finishSignIn(response, body);
  } catch (err) {
    console.error("[email-account] sign-in failed", err);
    return payload({ ok: false, code: "failed", message: SIGN_IN_FAILED });
  }
}
