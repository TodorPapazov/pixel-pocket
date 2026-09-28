import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CONSOLES, type ConsoleId } from "@/lib/consoles";
import { clickBeep, tapHaptic, unlockAudio } from "@/lib/sound";
import { AccountBar } from "@/components/account-bar";
import { RecentSessions } from "@/components/recent-sessions";
import { SyncStatus } from "@/components/sync-status";
import { usePocket } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ConsoleSelect() {
  const pickConsole = usePocket((s) => s.pickConsole);
  const scroller = useRef<HTMLDivElement>(null);

  function scrollByDir(dir: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.86, behavior: "smooth" });
  }

  async function choose(id: ConsoleId) {
    tapHaptic(16);
    clickBeep();
    await unlockAudio();
    pickConsole(id);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="pad-app-top pad-app-x flex items-start justify-between pb-2">
        <div>
          <p className="font-display text-[0.65rem] tracking-[0.28em] text-muted">
            PIXEL POCKET
          </p>
          <h1 className="mt-1 font-display text-2xl text-fg">Choose a deck</h1>
        </div>
        <div className="flex flex-col items-end gap-2">
          <AccountBar compact />
          <SyncStatus compact />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <RecentSessions />
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div
            ref={scroller}
            className="cabinets [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
          {CONSOLES.map((c, i) => (
            <article
              key={c.id}
              className="cabinet-card rise flex flex-col overflow-hidden rounded-[2rem] bg-surface ring-1 ring-border"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="cabinet-art relative aspect-[4/3] overflow-hidden bg-raised">
                <img src={c.image} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-3 top-3 rounded-full bg-bg/70 px-2.5 py-1 font-display text-[0.65rem] tracking-wider text-fg backdrop-blur-sm">
                  {c.year}
                </span>
              </div>
              <div className="flex flex-1 flex-col px-4 pb-4 pt-3 min-[700px]:px-3 min-[700px]:pb-3 min-[700px]:pt-2">
                <p className="text-[0.65rem] font-medium tracking-[0.22em] text-muted">
                  {c.bits}
                </p>
                <h2 className="mt-1 font-display text-xl text-fg">
                  {c.name}{" "}
                  <span className="font-sans text-sm font-medium text-muted">
                    {c.short}
                  </span>
                </h2>
                <p className="cabinet-blurb mt-2 flex-1 text-sm leading-relaxed text-muted">{c.blurb}</p>
                <button
                  type="button"
                  onClick={() => void choose(c.id)}
                  className={cn(
                    "cabinet-play mt-4 min-h-12 rounded-2xl bg-fg px-4 py-3.5 font-display text-sm text-bg",
                    "transition-transform duration-150 active:scale-[0.98]",
                  )}
                >
                  Play {c.short}
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-1 sm:flex min-[700px]:hidden">
          <button
            type="button"
            aria-label="Previous console"
            onClick={() => scrollByDir(-1)}
            className="pointer-events-auto hit grid size-12 place-items-center rounded-full bg-bg/70 text-fg ring-1 ring-border backdrop-blur-sm"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next console"
            onClick={() => scrollByDir(1)}
            className="pointer-events-auto hit grid size-12 place-items-center rounded-full bg-bg/70 text-fg ring-1 ring-border backdrop-blur-sm"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        </div>
      </div>

      <p className="pad-app-x px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-xs text-faint">
        Pick a cabinet. Each one gets its own on-screen controller. Windows and Mac can play with no Wi-Fi.
      </p>
    </div>
  );
}
