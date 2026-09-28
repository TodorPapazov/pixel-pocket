import { useEffect, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { captureInstallPrompt } from "@/lib/desktop";
import { hydrateFromDisk, restoreVault } from "@/lib/disk";
import { registerOfflineWorker } from "@/lib/offline";
import { usePocket } from "@/lib/store";
import { emitPocketSync, ensurePlayerName, flushPendingPockets, syncPocketsFromCloud } from "@/lib/sync";

export function OfflineBridge() {
  const { user, isPending } = useCurrentUserState();
  const phase = usePocket((s) => s.phase);
  const inflight = useRef(false);

  useEffect(() => {
    captureInstallPrompt();
    void registerOfflineWorker();
    void (async () => {
      await restoreVault();
      const imported = await hydrateFromDisk();
      if (imported > 0) emitPocketSync();
    })();
  }, []);

  useEffect(() => {
    if (isPending) return;

    async function run(opts: { pull: boolean }) {
      if (inflight.current) return;
      if (!navigator.onLine) return;
      inflight.current = true;
      try {
        await flushPendingPockets();
        if (opts.pull && user) {
          await ensurePlayerName(user.displayName);
          await syncPocketsFromCloud();
        }
      } finally {
        inflight.current = false;
      }
    }

    void run({ pull: Boolean(user) });

    const onOnline = () => {
      void run({ pull: Boolean(user) });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void run({ pull: Boolean(user) && phase !== "playing" });
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("pageshow", onVis);
    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void run({ pull: Boolean(user) && phase !== "playing" });
    }, 40_000);

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("pageshow", onVis);
      window.clearInterval(tick);
    };
  }, [isPending, user, phase]);

  return null;
}