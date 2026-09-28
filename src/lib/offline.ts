import { useSyncExternalStore } from "react";
import { onPendingChange, pendingCount } from "@/lib/queue";

export function subscribeOnline(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

export function usePendingCount(): number {
  return useSyncExternalStore(onPendingChange, pendingCount, () => 0);
}

export async function registerOfflineWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  } catch {
    /* private mode / preview */
  }
}
