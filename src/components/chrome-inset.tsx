import { useEffect } from "react";
import { overlayTopPx } from "@/lib/chrome-inset";
import { applyDeviceClass } from "@/lib/device";
import { patchAudioCapture } from "@/lib/sound";

/** Sets --overlay-top so headers sit below Grok/iOS in-app chrome. */
export function ChromeInset() {
  useEffect(() => {
    const root = document.documentElement;
    patchAudioCapture();
    const sync = () => {
      applyDeviceClass();
      root.style.setProperty("--overlay-top", `${overlayTopPx()}px`);
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, []);
  return null;
}
