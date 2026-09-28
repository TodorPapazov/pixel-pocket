import { isIosFamily, isIpadOs } from "@/lib/device";

/** Extra top inset when Grok (or another in-app browser) paints chrome over the page. */

export function overlayTopPx(): number {
  if (typeof window === "undefined") return 0;
  const ua = navigator.userAgent || "";
  const ios = isIosFamily();
  const ipad = isIpadOs();
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) return 0;
  const framed = window.parent !== window;
  const grok = /Grok/i.test(ua);
  const wk =
    ios && /AppleWebKit/.test(ua) && !/Version\/[\d.]+.*Safari\//.test(ua);
  const fullBleed =
    ios && window.innerHeight >= window.screen.height * 0.93;
  if (ios && (wk || grok || framed || fullBleed)) return ipad ? 72 : 60;
  if (framed) return 12;
  return 0;
}
