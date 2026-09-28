/** iPadOS 13+ pretends to be a Mac. Split-view iPad should still use the phone layout. */

export type WindowsRelease = "10" | "11" | "legacy";

let windowsReleaseOverride: WindowsRelease | null = null;

export function setWindowsRelease(release: WindowsRelease | null): void {
  windowsReleaseOverride = release;
}

/** Windows NT 10.0 is Windows 10 until client hints say 13+ (Windows 11). */
export function windowsReleaseFromUA(ua: string): WindowsRelease | null {
  if (!/Windows/i.test(ua)) return null;
  const nt = /Windows NT (\d+\.\d+)/i.exec(ua);
  if (!nt) return "legacy";
  if (nt[1] === "10.0") return "10";
  return "legacy";
}

export function windowsRelease(): WindowsRelease | null {
  if (windowsReleaseOverride) return windowsReleaseOverride;
  if (typeof navigator === "undefined") return null;
  return windowsReleaseFromUA(navigator.userAgent || "");
}

/** EdgeHTML on Windows 10 (Edge 18 and older). Chromium Edge uses "Edg/". */
export function isLegacyWindowsEdge(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "",
): boolean {
  return /Windows NT 10/i.test(ua) && /Edge\/1[0-8]\./.test(ua) && !/Edg\//.test(ua);
}

export function isIpadOs(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad/.test(ua)) return true;
  const plat = navigator.platform || "";
  return plat === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isIosFamily(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|iPad/.test(navigator.userAgent) || isIpadOs();
}

export function isTabletViewport(): boolean {
  if (typeof window === "undefined") return false;
  return Math.min(window.innerWidth, window.innerHeight) >= 600 || window.innerWidth >= 740;
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "this device";
  if (isIpadOs()) return "iPad";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) {
    const release = windowsRelease();
    if (release === "10") return "Windows 10";
    if (release === "11") return "Windows 11";
    return "Windows";
  }
  if (/Mac OS X|Macintosh/.test(ua)) return "Mac";
  return "this computer";
}

export function applyDeviceClass() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const ipad = isIpadOs();
  const tablet = isTabletViewport() || ipad;
  root.classList.toggle("is-ipad", ipad);
  root.classList.toggle("is-tablet", tablet && window.innerWidth >= 700);
  root.classList.toggle("is-ios", isIosFamily());
}
