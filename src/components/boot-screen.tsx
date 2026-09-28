import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { AccountBar } from "@/components/account-bar";
import { RecentSessions } from "@/components/recent-sessions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useStandaloneApp } from "@/lib/desktop";
import { usePocket } from "@/lib/store";
import { bootJingle, playVoice, unlockAudio } from "@/lib/sound";

export function BootScreen() {
  const powerOn = usePocket((s) => s.powerOn);
  const [igniting, setIgniting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const userState = useCurrentUserState();
  const user = userState.isPending ? null : userState.user;
  const standalone = useStandaloneApp();

  useEffect(() => {
    setMounted(true);
    const v = document.getElementById("boot-video") as HTMLVideoElement | null;
    if (v) v.play().catch(() => undefined);
  }, []);

  async function ignite() {
    if (igniting) return;
    setIgniting(true);
    await unlockAudio();
    bootJingle();
    playVoice("/audio/poweron.mp3");
    window.setTimeout(() => playVoice("/audio/welcome.mp3"), 500);
    window.setTimeout(() => powerOn(), 900);
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg">
      <video
        id="boot-video"
        className="absolute inset-0 h-full w-full object-cover opacity-80"
        src="/videos/boot.mp4"
        poster="/images/hero.jpg"
        muted
        loop
        playsInline
        autoPlay
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/55 to-bg" />
      <div className="scanlines absolute inset-0" />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <div className="pad-app-top">
          <RecentSessions />
        </div>
      <div
        className={`pad-app-x relative flex flex-1 flex-col items-center justify-end px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] min-[700px]:justify-center ${igniting ? "crt-on" : ""}`}
      >
        <img
          src="/images/mascot.jpg"
          alt=""
          className="mb-5 size-24 rounded-[1.75rem] object-cover shadow-[0_12px_40px_rgb(0_0_0/0.45)] ring-1 ring-fg/10"
        />
        <p className="font-display text-[0.7rem] tracking-[0.32em] text-muted">
          LIVING ROOM · 1985–2001
        </p>
        <h1 className="mt-2 text-center font-display text-4xl leading-tight text-fg sm:text-5xl">
          PIXEL
          <span className="block text-accent">POCKET</span>
        </h1>
        <p className="mt-3 max-w-sm text-center text-sm leading-relaxed text-muted">
          {mounted && user
            ? `Welcome back, ${user.displayName ?? "player"}. Phone, iPad, Windows 10, Windows 11, and Mac keep the same pockets.`
            : "Pick a deck, load a ROM or ISO link, and play — phone, iPad, or a computer."}
        </p>

        <button
          type="button"
          onClick={() => void ignite()}
          className="mt-8 w-full max-w-xs rounded-[1.75rem] bg-fg px-6 py-4 text-center font-display text-sm tracking-wide text-bg transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]"
        >
          {igniting ? "Powering on…" : "Tap to power on"}
        </button>
        <div className="mt-3 flex w-full max-w-xs gap-2">
          <div className="min-w-0 flex-1 [&_a]:max-w-none">
            {mounted ? (
              <AccountBar cta />
            ) : (
              <div className="h-12 w-full animate-pulse rounded-[1.75rem] bg-surface" />
            )}
          </div>
          {!standalone && (
            <Link
              to="/desktop"
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[1.75rem] bg-surface px-3 text-sm font-medium text-fg ring-1 ring-border"
            >
              <Monitor className="size-4 shrink-0" />
              <span className="truncate">Windows & Mac</span>
            </Link>
          )}
        </div>
        {mounted && user ? (
          <p className="mt-4 text-center text-xs text-faint">
            Pockets follow this player. Offline play stays on this disk until Wi-Fi returns.
          </p>
        ) : (
          <p className="mt-4 text-center text-xs text-faint">
            Sign in to keep pockets across devices. Guest play stays on this computer.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
