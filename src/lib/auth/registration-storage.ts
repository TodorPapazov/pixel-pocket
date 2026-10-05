/** Shown when Create player or Sign in would write to a database that does not survive the next visit. */
export const REGISTRATION_NOT_SAVED =
  "Player accounts are not being saved on this server yet.";

export type EmailAuthResult =
  | { ok: true; token: string | null }
  | {
      ok: false;
      code: "not_saved" | "mismatch" | "taken" | "failed";
      message: string;
    };

/**
 * The published server. Local `npm run dev` is not live, so it may use the
 * in-memory database. A production process without `DATABASE_URL` must not
 * pretend a player was saved.
 */
export function isLiveAuthServer(env: {
  VERCEL?: string | undefined;
  NODE_ENV?: string | undefined;
}): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}

/** `null` when this process can keep an email account for a later Sign in. */
export function registrationStorageError(input: {
  databaseUrl: string | undefined;
  liveServer: boolean;
}): string | null {
  if (input.liveServer && !input.databaseUrl?.trim()) return REGISTRATION_NOT_SAVED;
  return null;
}
