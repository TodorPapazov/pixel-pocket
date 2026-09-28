import { isIpadOs, isIosFamily, setWindowsRelease, windowsRelease, windowsReleaseFromUA, type WindowsRelease } from "@/lib/device";
import { useSyncExternalStore } from "react";

export type DeskOS = "windows" | "mac" | "linux" | "ios" | "android" | "other";

type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CHANGE = "pixel-desktop";
let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE));
}

export function detectOS(): DeskOS {
  if (typeof navigator === "undefined") return "other";
  if (isIosFamily()) return "ios";
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua) && !isIpadOs()) return "mac";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

export function useDeskOS(): DeskOS {
  return useSyncExternalStore(
    () => () => undefined,
    detectOS,
    () => "other",
  );
}

export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    nav.standalone === true
  );
}

export function canPickFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function useCanPickFolder(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    canPickFolder,
    () => false,
  );
}

export function captureInstallPrompt(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  refineWindowsRelease();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function hasInstallPrompt(): boolean {
  return Boolean(deferred);
}

export async function promptInstall(): Promise<InstallOutcome> {
  if (!deferred) return "unavailable";
  const pending = deferred;
  try {
    await pending.prompt();
    const choice = await pending.userChoice;
    deferred = null;
    emit();
    return choice.outcome;
  } catch {
    deferred = null;
    emit();
    return "unavailable";
  }
}

export function onDesktopChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE, fn);
  window.addEventListener("appinstalled", fn);
  return () => {
    window.removeEventListener(CHANGE, fn);
    window.removeEventListener("appinstalled", fn);
  };
}

export function useStandaloneApp(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => undefined;
      const mq = window.matchMedia("(display-mode: standalone)");
      mq.addEventListener("change", cb);
      window.addEventListener("appinstalled", cb);
      return () => {
        mq.removeEventListener("change", cb);
        window.removeEventListener("appinstalled", cb);
      };
    },
    isStandaloneApp,
    () => false,
  );
}

export function refineWindowsRelease(): void {
  if (typeof navigator === "undefined") return;
  const ua = navigator.userAgent || "";
  const fromUa = windowsReleaseFromUA(ua);
  if (fromUa) setWindowsRelease(fromUa);
  const data = (
    navigator as Navigator & {
      userAgentData?: {
        platform?: string;
        getHighEntropyValues?: (
          hints: string[],
        ) => Promise<{ platform?: string; platformVersion?: string }>;
      };
    }
  ).userAgentData;
  if (!data?.getHighEntropyValues) return;
  if (data.platform && data.platform !== "Windows") return;
  void data
    .getHighEntropyValues(["platformVersion"])
    .then((hints) => {
      if ((hints.platform || data.platform) !== "Windows") return;
      const major = Number.parseInt(String(hints.platformVersion || "0").split(".")[0] || "0", 10);
      if (!Number.isFinite(major) || major <= 0) return;
      const next: WindowsRelease = major >= 13 ? "11" : "10";
      if (next === windowsRelease()) return;
      setWindowsRelease(next);
      emit();
    })
    .catch(() => undefined);
}

export function useWindowsRelease(): WindowsRelease | null {
  return useSyncExternalStore(
    onDesktopChange,
    () => windowsRelease(),
    () => null,
  );
}

export function desktopLabel(os: DeskOS = detectOS()): string {
  if (os === "windows") {
    const release = windowsRelease();
    if (release === "10") return "Windows 10";
    if (release === "11") return "Windows 11";
    return "Windows";
  }
  if (os === "mac") return "Mac";
  if (os === "ios") return "this iPhone";
  if (os === "android") return "Android";
  if (os === "linux") return "this computer";
  return "this device";
}

if (typeof window !== "undefined") {
  refineWindowsRelease();
}
