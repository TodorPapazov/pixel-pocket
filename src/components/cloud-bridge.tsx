import { useEffect, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ensurePlayerName, syncPocketsFromCloud } from "@/lib/sync";

/** Pull / push this player's pockets when the session is live, and again when they come back to the tab. */
export function CloudBridge() {
  const { user, isPending } = useCurrentUserState();
  const last = useRef<string | null>(null);
  const inflight = useRef(false);

  useEffect(() => {
    if (isPending || !user) return;

    async function run(force: boolean) {
      if (!user) return;
      if (inflight.current) return;
      if (!force && last.current === user.id) return;
      last.current = user.id;
      inflight.current = true;
      try {
        await ensurePlayerName(user.displayName);
        await syncPocketsFromCloud();
      } finally {
        inflight.current = false;
      }
    }

    void run(true);
    const onVis = () => {
      if (document.visibilityState === "visible") void run(true);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [isPending, user]);

  return null;
}
