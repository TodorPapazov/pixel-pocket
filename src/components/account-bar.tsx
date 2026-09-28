import { Link } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { authEnabled, signOut } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useState, useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};
const noGateOnServer = () => false;

export function AccountBar({
  compact = false,
  cta = false,
}: {
  compact?: boolean;
  cta?: boolean;
}) {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateOnServer,
  );

  if (isPending) {
    return (
      <div
        className={
          cta
            ? "h-12 w-full max-w-xs animate-pulse rounded-[1.75rem] bg-surface"
            : "h-12 w-28 animate-pulse rounded-2xl bg-surface"
        }
      />
    );
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className={
          cta
            ? "flex h-12 w-full max-w-xs items-center justify-center rounded-[1.75rem] bg-surface text-sm font-medium text-fg ring-1 ring-border"
            : "hit grid h-12 min-w-12 place-items-center rounded-2xl bg-surface px-3 text-sm text-fg ring-1 ring-border"
        }
      >
        Sign in
      </Link>
    );
  }

  const label = user.displayName ?? user.primaryEmail ?? "Player";
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="flex min-w-0 items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="size-10 shrink-0 rounded-2xl object-cover ring-1 ring-border"
        />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-raised font-display text-sm text-fg ring-1 ring-border">
          {initial}
        </span>
      )}
      {!compact && (
        <span className="hidden min-w-0 truncate text-sm text-fg sm:inline">{label}</span>
      )}
      {authEnabled && !gateSession && (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut().catch(() => setSigningOut(false));
          }}
          className="hit min-h-12 rounded-2xl px-2 text-xs text-muted disabled:opacity-60"
        >
          {signingOut ? "…" : "Sign out"}
        </button>
      )}
    </div>
  );
}
