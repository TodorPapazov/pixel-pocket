import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Pause, Play, RotateCcw, Save, Volume2, VolumeX } from "lucide-react";
import { CONSOLE_BY_ID } from "@/lib/consoles";
import { putSave, getSave, isNotFoundError } from "@/lib/library";
import { pushLocalPocket } from "@/lib/sync";
import { deviceLabel } from "@/lib/device";
import { launchForConsole, type EmuHandle } from "@/lib/emulator";
import { playVoice, unlockAudio } from "@/lib/sound";
import { usePocket } from "@/lib/store";
import { VirtualPad } from "@/components/virtual-pad";
import { cn } from "@/lib/utils";
import { fitNativeCanvas } from "@/lib/fit-canvas";
import { keyboardHint, usesPcKeyboard } from "@/lib/keyboard";

export function PlayScreen() {
  const game = usePocket((s) => s.game);
  const backToLoad = usePocket((s) => s.backToLoad);
  const voiceOn = usePocket((s) => s.voiceOn);
  const setVoiceOn = usePocket((s) => s.setVoiceOn);
  const def = game ? CONSOLE_BY_ID[game.consoleId] : null;

  const ejsRef = useRef<HTMLDivElement>(null);
  const screenBoxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EmuHandle | null>(null);
  const persistRef = useRef<() => Promise<boolean>>(async () => false);
  const pausedRef = useRef(false);
  const pocketBusy = useRef(false);
  const sessionRef = useRef({ accumulated: 0, running: 0, playedAtLaunch: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Warming up the deck…");
  const [paused, setPaused] = useState(false);
  const [crt, setCrt] = useState(game?.consoleId === "nes" || game?.consoleId === "snes");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [landscape, setLandscape] = useState(true);

  useEffect(() => {
    const sync = () => {
      const box = window.visualViewport;
      const w = box?.width ?? window.innerWidth;
      const h = box?.height ?? window.innerHeight;
      const media = window.matchMedia?.("(orientation: landscape)").matches;
      setLandscape(media || w >= h);
    };
    sync();
    const media = window.matchMedia?.("(orientation: landscape)");
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    media?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      media?.removeEventListener?.("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!game || !def) return;
    let cancelled = false;
    const file = game.file;
    let spawned: HTMLCanvasElement | null = null;

    (async () => {
      await unlockAudio();
      setStatus("loading");
      setMessage(
        def.id === "nds"
          ? "Fetching the Dual Screen core. First boot can take a minute…"
          : def.engine === "emulatorjs"
            ? "Fetching the Sixty-Four core. This can take a minute…"
            : def.id === "ps1"
              ? "Fetching the Station core. First boot can take a moment…"
              : `Loading ${def.short} core…`,
      );
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled) return;
      const box = screenBoxRef.current;
      if (!box) {
        setStatus("error");
        setMessage("Missing playfield.");
        return;
      }
      const width = def.buffer.width;
      const height = def.buffer.height;
      const ejs = def.engine === "emulatorjs";

      let canvas: HTMLCanvasElement | null = null;
      if (!ejs) {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.tabIndex = 0;
        canvas.setAttribute("aria-label", "Game screen");
        canvas.style.background = "#000";
        box.appendChild(canvas);
        spawned = canvas;
        fitNativeCanvas(canvas, box, def.buffer);
      }

      try {
        const pocket =
          game.resume !== false
            ? await getSave(game.id).catch(() => null)
            : null;
        const state =
          pocket?.state && pocket.state.size > 0 ? pocket.state : null;
        const sram =
          pocket?.sram && pocket.sram.size > 0 ? pocket.sram : null;
        const launch = (
          playfield: HTMLCanvasElement | null,
          next: { state?: Blob | null; sram?: Blob | null },
        ) =>
          launchForConsole({
            def,
            file,
            files: game.files,
            canvas: playfield,
            container: ejsRef.current,
            width,
            height,
            state: next.state,
            sram: next.sram,
          });
        let handle;
        let restored: "state" | "sram" | null = state ? "state" : sram ? "sram" : null;
        try {
          handle = await launch(canvas, { state, sram });
        } catch (first) {
          if (!state && !sram) throw first;
          canvas?.remove();
          let retry: HTMLCanvasElement | null = null;
          if (!ejs) {
            retry = document.createElement("canvas");
            retry.width = width;
            retry.height = height;
            retry.tabIndex = 0;
            retry.setAttribute("aria-label", "Game screen");
            retry.style.background = "#000";
            box.appendChild(retry);
            spawned = retry;
            fitNativeCanvas(retry, box, def.buffer);
          }
          canvas = retry;
          handle = await launch(retry, { state: null, sram });
          restored = sram ? "sram" : null;
        }
        if (cancelled) {
          await handle.exit();
          canvas?.remove();
          return;
        }
        handleRef.current = handle;
        persistRef.current = async () => {
          const h = handleRef.current;
          if (!h || pocketBusy.current) return false;
          pocketBusy.current = true;
          try {
            h.resume();
            await new Promise<void>((r) => window.setTimeout(r, 60));
            const snap = await Promise.race([
              h.saveState(),
              new Promise<null>((resolve) =>
                window.setTimeout(() => resolve(null), 4000),
              ),
            ]);
            let ram: Blob | null = null;
            try {
              ram = await Promise.race([
                h.saveSRAM(),
                new Promise<null>((resolve) =>
                  window.setTimeout(() => resolve(null), 1200),
                ),
              ]);
            } catch {
              ram = null;
            }
            const keep = snap ?? (state && state.size > 0 ? state : null);
            if (!keep) return false;
            const savedAt = Date.now();
            const prev = await getSave(game.id).catch(() => null);
            const clock = sessionRef.current;
            const live = clock.running ? savedAt - clock.running : 0;
            const sessionMs = Math.max(0, clock.accumulated + live);
            const playedMs = Math.max(sessionMs, clock.playedAtLaunch + sessionMs);
            const device = deviceLabel();
            await putSave({
              id: game.id,
              version: 1,
              consoleId: game.consoleId,
              name: game.name,
              state: keep,
              sram: ram ?? undefined,
              savedAt,
              rev: prev?.rev,
              romHash: prev?.romHash,
              device,
              syncedAt: prev?.syncedAt,
              sessionMs,
              playedMs,
            });
            const upload = pushLocalPocket({
              id: game.id,
              name: game.name,
              filename: game.filename,
              consoleId: game.consoleId,
              savedAt,
              state: keep,
              sram: ram,
              rom: game.file,
              sessionMs,
              playedMs,
            });
            if (document.visibilityState === "hidden") await upload;
            else void upload;
            return true;
          } catch {
            return false;
          } finally {
            if (pausedRef.current) h.pause();
            pocketBusy.current = false;
          }
        };
        if (canvas) fitNativeCanvas(canvas, box, def.buffer);
        sessionRef.current = {
          accumulated: 0,
          running: Date.now(),
          playedAtLaunch: pocket?.playedMs ?? 0,
        };
        setStatus("ready");
        handle.kickAudio();
        window.setTimeout(() => {
          if (!cancelled) handle.kickAudio();
        }, 200);
        window.setTimeout(() => {
          if (!cancelled) handle.kickAudio();
        }, 800);
        if (restored === "state") {
          setSaveMsg("Loaded your last save.");
        } else if (restored === "sram") {
          setSaveMsg("Loaded the save stored on the cartridge.");
        }
      } catch (e) {
        canvas?.remove();
        if (cancelled) return;
        setStatus("error");
        setMessage(
          isNotFoundError(e)
            ? "Could not restore that save. Leave the game, then open it again."
            : e instanceof Error
              ? e.message
              : "The deck would not start. Try a smaller ROM or a handheld.",
        );
        if (voiceOn) playVoice("/audio/error.mp3");
      }
    })();

    return () => {
      cancelled = true;
      persistRef.current = async () => false;
      spawned?.remove();
      const h = handleRef.current;
      handleRef.current = null;
      void h?.exit();
    };
    // Launch once per game id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  useEffect(() => {
    const fit = () => {
      if (def?.engine === "emulatorjs") return;
      const canvas = screenBoxRef.current?.querySelector("canvas");
      const box = screenBoxRef.current;
      if (!canvas || !box || !def) return;
      fitNativeCanvas(canvas, box, def.buffer);
    };
    const box = screenBoxRef.current;
    const ro = box ? new ResizeObserver(fit) : null;
    if (box) ro?.observe(box);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [def]);

  useEffect(() => {
    if (status !== "ready") return;
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        const clock = sessionRef.current;
        if (clock.running) {
          clock.accumulated += Date.now() - clock.running;
          clock.running = 0;
        }
        void persistRef.current();
      } else if (!pausedRef.current) {
        sessionRef.current.running = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    const beat = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pausedRef.current) {
        void persistRef.current();
      }
    }, 75_000);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.clearInterval(beat);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;
    const arm = () => handleRef.current?.kickAudio();
    const onVis = () => {
      if (document.visibilityState === "visible") arm();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", arm);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", arm);
    };
  }, [status]);

  useEffect(() => {
    if (!saveMsg) return;
    const t = window.setTimeout(() => setSaveMsg(null), 2800);
    return () => window.clearTimeout(t);
  }, [saveMsg]);

  if (!game || !def) return null;

  const screenInner =
    def.id === "nds" ? (
      <div ref={screenBoxRef} className="ds-screens">
        <div className="ds-panel">
          <DsTopMirror sourceRef={ejsRef} />
        </div>
        <div className="ds-panel">
          <div className="ds-fit ds-touch">
            <div ref={ejsRef} className="ejs-host ds-bottom-host" />
            <span className="pointer-events-none absolute bottom-1 right-2 text-[0.6rem] tracking-[0.14em] text-white/70">
              TOUCH
            </span>
          </div>
        </div>
        {status !== "ready" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg/90 px-4 text-center">
            <img src="/images/mascot.jpg" alt="" className="size-16 rounded-2xl object-cover" />
            <p className="font-display text-sm text-fg">{message}</p>
            {status === "error" && (
              <button
                type="button"
                onClick={() => void eject()}
                className="rounded-2xl bg-fg px-4 py-2 text-sm font-medium text-bg"
              >
                Back
              </button>
            )}
          </div>
        )}
      </div>
    ) : (
    <div className="relative h-full min-h-0 w-full">
      <div ref={screenBoxRef} className="pixel-screen absolute inset-0">
        <div
          ref={ejsRef}
          className={cn(
            "ejs-host h-full w-full",
            def.engine !== "emulatorjs" && "hidden",
          )}
        />
        {crt && status === "ready" && (
          <div className="scanlines pointer-events-none absolute inset-0" />
        )}
      </div>
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg/90 px-4 text-center">
          <img
            src="/images/mascot.jpg"
            alt=""
            className="size-16 rounded-2xl object-cover"
          />
          <p className="font-display text-sm text-fg">{message}</p>
          {status === "error" && (
            <button
              type="button"
              onClick={() => void eject()}
              className="rounded-2xl bg-fg px-4 py-2 text-sm font-medium text-bg"
            >
              Back
            </button>
          )}
        </div>
      )}
    </div>
    );

  const handheld = def.hold === "brick" || def.hold === "wide" || def.hold === "clamshell";

  function togglePause() {
    const h = handleRef.current;
    if (!h) return;
    if (paused) {
      h.resume();
      pausedRef.current = false;
      sessionRef.current.running = Date.now();
      setPaused(false);
    } else {
      const clock = sessionRef.current;
      if (clock.running) {
        clock.accumulated += Date.now() - clock.running;
        clock.running = 0;
      }
      void persistRef.current().then(() => {
        const live = handleRef.current;
        if (!live) return;
        live.pause();
        pausedRef.current = true;
        setPaused(true);
      });
      return;
    }
  }

  async function onSave() {
    const h = handleRef.current;
    if (!h || !game) return;
    const ok = await persistRef.current();
    setSaveMsg(ok ? "Saved. It will show in Recent sessions." : "Could not save. Try again.");
  }

  async function onLoad() {
    if (!game) return;
    const pocket = await getSave(game.id);
    if (!pocket?.state) {
      setSaveMsg("Nothing saved yet. Pause the game, then tap Save game.");
      return;
    }
    try {
      await handleRef.current?.loadState(pocket.state);
      setSaveMsg("Loaded your last save.");
      handleRef.current?.resume();
      pausedRef.current = false;
      sessionRef.current.running = Date.now();
      setPaused(false);
    } catch {
      setSaveMsg("Could not load that save.");
    }
  }

  async function eject() {
    if (status === "ready") {
      setSaveMsg("Saving…");
      await Promise.race([
        persistRef.current(),
        new Promise<boolean>((resolve) =>
          window.setTimeout(() => resolve(false), 4500),
        ),
      ]);
    }
    void handleRef.current?.exit();
    handleRef.current = null;
    backToLoad();
  }

  return (
    <div
      className={cn(
        "relative flex h-dvh flex-col overflow-hidden bg-bg no-select",
        `shell-${def.shell}`,
      )}
      style={{ touchAction: "none" }}
      onPointerDown={() => handleRef.current?.kickAudio()}
    >
      {def.id !== "nds" && (
      <header className="pad-app-top pad-app-x flex items-center gap-2 pb-1">
        <button
          type="button"
          onClick={() => void eject()}
          aria-label="Eject"
          className="hit grid size-12 place-items-center rounded-xl bg-surface text-fg ring-1 ring-border"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm text-fg">{game.name}</p>
          <p className="truncate text-[0.65rem] tracking-wider text-muted">
            {usesPcKeyboard(def.id) ? keyboardHint(def.id) : `${def.short} · saves as you play`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setVoiceOn(!voiceOn)}
          aria-label={voiceOn ? "Mute voice" : "Unmute voice"}
          className="hit grid size-12 place-items-center rounded-xl bg-surface text-fg ring-1 ring-border"
        >
          {voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
        <button
          type="button"
          onClick={togglePause}
          aria-label={paused ? "Resume" : "Pause"}
          className="hit grid size-12 place-items-center rounded-xl bg-surface text-fg ring-1 ring-border"
        >
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </button>
      </header>
      )}
      {saveMsg && !paused && (
        <p className="px-3 pb-0.5 text-center text-[0.7rem] text-ok">{saveMsg}</p>
      )}

      <div
        className={cn(
          "flex min-h-0 flex-1",
          handheld && def.id !== "nds" ? "play-stage-handheld" : "flex-col landscape:flex-row",
        )}
      >
        {def.id === "nds" ? (
          <div className="ds-play">
            {!landscape && (
              <p className="ds-turn">
                Turn sideways for a larger picture. You can play like this too.
              </p>
            )}
            <VirtualPad
              def={def}
              handleRef={handleRef}
              screen={screenInner}
              chrome={{
                onBack: () => void eject(),
                onPause: togglePause,
                paused,
              }}
            />
          </div>
        ) : handheld ? (
          <>
            {def.hold === "wide" && (
              <p className="pb-1 text-center text-[0.65rem] tracking-wide text-muted landscape:hidden min-[700px]:hidden">
                {def.id === "ps1"
                  ? "Turn sideways — pads on both sides, screen in the middle."
                  : "Turn sideways — the Advance is a horizontal hold."}
              </p>
            )}
            {def.hold === "clamshell" && (
              <p className="pb-1 text-center text-[0.65rem] tracking-wide text-muted min-[700px]:hidden">
                Two screens. Touch the bottom one like a stylus.
              </p>
            )}
            <VirtualPad def={def} handleRef={handleRef} screen={screenInner} />
          </>
        ) : (
          <>
            <div className="relative mx-3 mt-1 min-h-0 flex-1 overflow-hidden rounded-[1.35rem] bg-black ring-1 ring-border landscape:mx-2 min-[700px]:mx-6">
              {screenInner}
            </div>
            <div className="landscape:w-[min(42vw,28rem)] landscape:shrink-0 min-[700px]:px-4">
              <VirtualPad def={def} handleRef={handleRef} />
            </div>
          </>
        )}
      </div>

      {paused && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-bg/70 p-4 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-sm rounded-[1.75rem] bg-surface p-5 ring-1 ring-border">
            <h2 className="font-display text-lg text-fg">Paused</h2>
            <p className="mt-1 text-sm text-muted">{game.name}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={togglePause}
                className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-fg py-3.5 text-sm font-medium text-bg"
              >
                <Play className="size-4" /> Resume
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-raised py-3 text-sm text-fg ring-1 ring-border"
              >
                <Save className="size-4" /> Save game
              </button>
              <button
                type="button"
                onClick={() => void onLoad()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-raised py-3 text-sm text-fg ring-1 ring-border"
              >
                Load save
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRef.current?.restart();
                  setPaused(false);
                }}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-raised py-3 text-sm text-fg ring-1 ring-border"
              >
                <RotateCcw className="size-4" /> Reset
              </button>
              <button
                type="button"
                onClick={() => setCrt((v) => !v)}
                className="min-h-12 rounded-2xl bg-raised py-3 text-sm text-fg ring-1 ring-border"
              >
                CRT {crt ? "on" : "off"}
              </button>
            </div>
            {saveMsg && <p className="mt-3 text-xs text-muted">{saveMsg}</p>}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Leaving this game keeps the save on this device. Sign in with the
              same email if you want that save on your phone, iPad, and computer.
            </p>
            <button
              type="button"
              onClick={() => void eject()}
              className="mt-3 min-h-12 w-full py-3 text-sm text-accent"
            >
              Eject cartridge
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DsTopMirror({ sourceRef }: { sourceRef: RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const src = sourceRef.current?.querySelector("canvas");
      const dest = canvasRef.current;
      if (!src || !dest || src.width < 8 || src.height < 8) return;
      const w = src.width;
      const h = Math.floor(src.height / 2);
      if (h < 4) return;
      if (dest.width !== w) dest.width = w;
      if (dest.height !== h) dest.height = h;
      const ctx = dest.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [sourceRef]);

  return (
    <div className="ds-fit">
      <canvas ref={canvasRef} className="ds-mirror" aria-label="Top screen" />
    </div>
  );
}
