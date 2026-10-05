import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { playerCount } from "@/lib/stats";
import { ensurePlayerName, syncPocketsFromCloud } from "@/lib/sync";

export const Route = createFileRoute("/login")({ component: Login });

const BEARER_KEY = "grok-auth.bearer-token";

function keepBearer(data: unknown) {
  if (!data || typeof data !== "object") return;
  const token = (data as { token?: unknown }).token;
  if (typeof token !== "string" || token.length < 8) return;
  try {
    window.sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* storage blocked */
  }
}

function alreadyExists(err: { code?: string; message?: string } | null | undefined): boolean {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code.includes("USER_ALREADY_EXISTS") || msg.includes("already exists");
}

function badCredentials(err: { code?: string; message?: string } | null | undefined): boolean {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  return code.includes("INVALID_EMAIL_OR_PASSWORD") || msg.includes("invalid email");
}

export function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [census, setCensus] = useState<{ players: number; pockets: number } | null>(null);

  useEffect(() => {
    void playerCount()
      .then(setCensus)
      .catch(() => undefined);
  }, []);

  async function finish(data: unknown, playerName?: string) {
    keepBearer(data);
    await authClient.getSession();
    if (playerName) await ensurePlayerName(playerName).catch(() => undefined);
    await syncPocketsFromCloud().catch(() => undefined);
    navigate({ to: "/" });
  }

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!authEnabled) return;
    setError(null);
    const mail = email.trim().toLowerCase();
    const code = passcode;
    const label = name.trim();
    if (!mail || !mail.includes("@")) {
      setError("Enter a real email.");
      return;
    }
    if (code.length < 8) {
      setError("Passcode needs at least 8 characters.");
      return;
    }
    if (mode === "up" && label.length < 1) {
      setError("Pick a short name for your player.");
      return;
    }
    setBusy(mode === "up" ? "Making your player…" : "Signing in…");
    try {
      if (mode === "up") {
        const { data, error: err } = await authClient.signUp.email({
          email: mail,
          password: code,
          name: label,
        });
        if (alreadyExists(err)) {
          setBusy("That email is already a player. Signing in…");
          const again = await authClient.signIn.email({ email: mail, password: code });
          if (again.error) {
            throw new Error("That email is taken, and this passcode did not match. Use Sign in.");
          }
          await finish(again.data);
          return;
        }
        if (err) throw new Error(err.message ?? "Could not create that player.");
        await finish(data, label);
        return;
      }

      const { data, error: err } = await authClient.signIn.email({
        email: mail,
        password: code,
      });
      if (badCredentials(err)) {
        throw new Error(
          "Email or passcode did not match. Tap Forgot passcode if you need the way back in.",
        );
      }
      if (err) throw new Error(err.message ?? "Could not sign in.");
      await finish(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  async function onProvider(id: string) {
    setError(null);
    setBusy("Opening…");
    try {
      await signIn(id, { callbackURL: "/", errorCallbackURL: "/login" });
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not sign in.");
    }
  }

  return (
    <main className="app-shell flex min-h-dvh flex-col bg-bg text-fg">
      <header className="pad-app-top pad-app-x flex items-center justify-between pb-2">
        <Link
          to="/"
          className="hit grid size-12 place-items-center rounded-xl bg-surface text-fg ring-1 ring-border"
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">Back</span>
        </Link>
        <p className="font-display text-[0.65rem] tracking-[0.28em] text-muted">PLAYER</p>
        <span className="size-12" />
      </header>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h1 className="font-display text-2xl text-fg">Your pocket</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign in so a save on this phone is still yours on the iPad and computer.
          Same email. Same passcode. Recent sessions come with you.
        </p>
        {census && census.players > 0 ? (
          <p className="mt-2 text-xs text-faint">
            {census.players} player{census.players === 1 ? "" : "s"} keeping pockets
            {census.pockets > 0 ? ` · ${census.pockets} saves in the cloud` : ""}.
          </p>
        ) : null}

        {!authEnabled ? (
          <p className="mt-6 text-sm text-muted">Sign-in is disabled.</p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 ring-1 ring-border">
              <button
                type="button"
                onClick={() => {
                  setMode("in");
                  setError(null);
                }}
                className={`h-11 rounded-xl text-sm font-medium ${
                  mode === "in" ? "bg-fg text-bg" : "text-muted"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("up");
                  setError(null);
                }}
                className={`h-11 rounded-xl text-sm font-medium ${
                  mode === "up" ? "bg-fg text-bg" : "text-muted"
                }`}
              >
                Create player
              </button>
            </div>

            {mode === "forgot" ? (
              <div className="mt-4 space-y-3">
                <h2 className="font-display text-lg text-fg">Get back in</h2>
                <p className="text-sm leading-relaxed text-muted">
                  There is no email reset yet. We never send a new passcode, and we
                  cannot look up which email you used. That list stays private.
                </p>
                <p className="text-sm leading-relaxed text-muted">
                  If you created a player with an email, sign in with that same
                  email and passcode. If you used Google or X, use that button
                  below. Those are separate players from an email passcode.
                </p>
                <p className="text-sm leading-relaxed text-muted">
                  A game already saved on this phone is still in Recent sessions,
                  even if you play as a guest. Cloud copies only come back with the
                  same sign-in.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode("in");
                    setError(null);
                  }}
                  className="h-12 w-full rounded-2xl bg-fg text-sm font-medium text-bg"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
            <form onSubmit={(e) => void onEmail(e)} className="mt-4 space-y-3">
              {mode === "up" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">Player name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="nickname"
                    placeholder="Todd"
                    maxLength={40}
                    className="h-12 w-full rounded-2xl bg-raised px-3 text-base text-fg ring-1 ring-border outline-none placeholder:text-faint focus:ring-fg/40"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Email</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="h-12 w-full rounded-2xl bg-raised px-3 text-base text-fg ring-1 ring-border outline-none placeholder:text-faint focus:ring-fg/40"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Passcode</span>
                <input
                  type="password"
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="at least 8 characters"
                  className="h-12 w-full rounded-2xl bg-raised px-3 text-base text-fg ring-1 ring-border outline-none placeholder:text-faint focus:ring-fg/40"
                />
              </label>
              {error && (
                <p className="rounded-2xl bg-accent/15 px-3 py-2 text-sm text-accent ring-1 ring-accent/30" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={Boolean(busy)}
                className="h-12 w-full rounded-2xl bg-fg text-sm font-medium text-bg disabled:opacity-60"
              >
                {busy ?? (mode === "up" ? "Create player" : "Sign in and resume")}
              </button>
              {mode === "in" && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                  }}
                  className="min-h-11 w-full py-2 text-center text-sm text-muted"
                >
                  Forgot passcode or email?
                </button>
              )}
            </form>
            )}

            <p className="my-5 text-center text-xs tracking-wider text-faint">OR</p>

            <div className="flex flex-col gap-2">
              {GROK_PROVIDERS.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void onProvider(p.providerId)}
                  className="h-12 w-full rounded-2xl bg-surface text-sm font-medium text-fg ring-1 ring-border disabled:opacity-60"
                >
                  Continue with {p.label}
                </button>
              ))}
            </div>

            <Link to="/" className="mt-6 block min-h-12 py-3 text-center text-sm text-muted">
              Play as guest
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
