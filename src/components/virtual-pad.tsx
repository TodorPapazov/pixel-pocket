import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ConsoleDef, PadButton } from "@/lib/consoles";
import type { EmuHandle } from "@/lib/emulator";
import { buttonFromKey, keyboardHint, usesPcKeyboard } from "@/lib/keyboard";
import { tapHaptic, resumeAllAudio } from "@/lib/sound";
import { cn } from "@/lib/utils";

interface Props {
  def: ConsoleDef;
  handleRef: RefObject<EmuHandle | null>;
  screen?: ReactNode;
}

function dirsFromVector(dx: number, dy: number): PadButton[] {
  const mag = Math.hypot(dx, dy);
  if (mag < 0.2) return [];
  const nx = dx / mag;
  const ny = dy / mag;
  const out: PadButton[] = [];
  if (ny < -0.32) out.push("up");
  if (ny > 0.32) out.push("down");
  if (nx < -0.32) out.push("left");
  if (nx > 0.32) out.push("right");
  return out;
}

export function VirtualPad({ def, handleRef, screen }: Props) {
  const counts = useRef<Partial<Record<PadButton, number>>>({});
  const keyHeld = useRef(new Set<string>());
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const stickRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const lastDirs = useRef<PadButton[]>([]);

  const press = useCallback(
    (btn: PadButton, on: boolean) => {
      const n = counts.current[btn] ?? 0;
      if (on) {
        counts.current[btn] = n + 1;
        if (n === 0) {
          handleRef.current?.pressDown(btn);
          handleRef.current?.kickAudio();
          void resumeAllAudio();
          setPressed((p) => ({ ...p, [btn]: true }));
          tapHaptic(10);
        }
      } else if (n > 0) {
        counts.current[btn] = n - 1;
        if (n === 1) {
          handleRef.current?.pressUp(btn);
          setPressed((p) => ({ ...p, [btn]: false }));
        }
      }
    },
    [handleRef],
  );

  const down = useCallback((btn: PadButton) => press(btn, true), [press]);
  const up = useCallback((btn: PadButton) => press(btn, false), [press]);

  useEffect(() => {
    if (!usesPcKeyboard(def.id)) return;

    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable);

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target)) return;
      const btn = buttonFromKey(e.code, def.id);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (keyHeld.current.has(e.code)) return;
      keyHeld.current.add(e.code);
      down(btn);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!keyHeld.current.has(e.code)) return;
      keyHeld.current.delete(e.code);
      const btn = buttonFromKey(e.code, def.id);
      if (!btn) return;
      e.preventDefault();
      const still = [...keyHeld.current].some((c) => buttonFromKey(c, def.id) === btn);
      if (!still) up(btn);
    };
    const flushKeys = () => {
      const codes = [...keyHeld.current];
      keyHeld.current.clear();
      for (const code of codes) {
        const btn = buttonFromKey(code, def.id);
        if (btn) up(btn);
      }
    };
    const onVis = () => {
      if (document.visibilityState !== "visible") flushKeys();
    };

    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", flushKeys);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", flushKeys);
      document.removeEventListener("visibilitychange", onVis);
      flushKeys();
    };
  }, [def.id, down, up]);

  const bindBtn = (btn: PadButton) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      down(btn);
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      up(btn);
    },
    onPointerCancel: () => up(btn),
    onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) up(btn);
    },
    "data-pressed": pressed[btn] ? "true" : "false",
  });

  function applyDirs(next: PadButton[]) {
    const prev = lastDirs.current;
    for (const b of prev) if (!next.includes(b)) up(b);
    for (const b of next) if (!prev.includes(b)) down(b);
    lastDirs.current = next;
  }

  function onStickDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    stickPointer.current = e.pointerId;
    moveStick(e.clientX, e.clientY);
  }

  function onStickMove(e: PointerEvent<HTMLDivElement>) {
    if (stickPointer.current !== e.pointerId) return;
    moveStick(e.clientX, e.clientY);
  }

  function onStickUp(e: PointerEvent<HTMLDivElement>) {
    if (stickPointer.current !== e.pointerId && stickPointer.current !== null) return;
    stickPointer.current = null;
    setNub({ x: 0, y: 0 });
    applyDirs([]);
  }

  function moveStick(clientX: number, clientY: number) {
    const el = stickRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width * 0.32;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const mag = Math.hypot(dx, dy);
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    setNub({ x: dx, y: dy });
    applyDirs(dirsFromVector(dx / max, dy / max));
  }

  const face = (btn: PadButton, label: string, extra: string) => (
    <button
      type="button"
      aria-label={
        btn === "x" && def.faces === "ps1"
          ? "Triangle"
          : btn === "y" && def.faces === "ps1"
            ? "Square"
            : btn === "a" && def.faces === "ps1"
              ? "Circle"
              : btn === "b" && def.faces === "ps1"
                ? "Cross"
                : label
      }
      className={cn(
        "pad-btn no-select grid place-items-center rounded-full font-display text-xs text-[var(--face-label)]",
        extra,
      )}
      {...bindBtn(btn)}
    >
      {label}
    </button>
  );

  const sysBtn = (btn: PadButton, label: string) => (
    <button
      type="button"
      aria-label={label}
      className="pad-btn sys-btn no-select rounded-full bg-[var(--shell-deep)] px-4 font-display text-[0.7rem] tracking-wider text-fg"
      {...bindBtn(btn)}
    >
      {label}
    </button>
  );

  const dpadDir = [
    pressed.up ? "up" : "",
    pressed.down ? "down" : "",
    pressed.left ? "left" : "",
    pressed.right ? "right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const crossPad = (
    <div
      ref={stickRef}
      className="cross-pad no-select"
      style={{ touchAction: "none" }}
      onPointerDown={onStickDown}
      onPointerMove={onStickMove}
      onPointerUp={onStickUp}
      onPointerCancel={onStickUp}
      role="application"
      aria-label="D-pad"
      data-dir={dpadDir}
    >
      <div className="cross-pad-h" />
      <div className="cross-pad-v" />
      <div className="cross-pad-center" />
    </div>
  );

  const analogStick = (
    <div
      ref={stickRef}
      className="relative size-[10rem] shrink-0 rounded-full bg-[var(--shell-deep)] ring-2 ring-black/20"
      style={{ touchAction: "none" }}
      onPointerDown={onStickDown}
      onPointerMove={onStickMove}
      onPointerUp={onStickUp}
      onPointerCancel={onStickUp}
      role="application"
      aria-label={def.stick ? "Analog stick" : "D-pad"}
    >
      <div className="pointer-events-none absolute inset-5 rounded-full bg-[var(--shell)]/30" />
      {!def.stick && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[var(--shell)]/25" />
      )}
      <div
        className="stick-nub pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--shell)]"
        style={{ transform: `translate(calc(-50% + ${nub.x}px), calc(-50% + ${nub.y}px))` }}
      />
    </div>
  );

  const gbFaces = (
    <div className="gb-faces relative shrink-0">
      <div className="absolute bottom-0 left-0">
        {face("b", "B", "bg-[var(--face-b)]")}
      </div>
      <div className="absolute right-0 top-0">
        {face("a", "A", "bg-[var(--face-a)]")}
      </div>
    </div>
  );

  const gbaFaces = (
    <div className="gba-faces relative shrink-0">
      <div className="absolute left-0 top-[18%]">
        {face("b", "B", "bg-[var(--face-b)]")}
      </div>
      <div className="absolute bottom-[8%] right-0">
        {face("a", "A", "bg-[var(--face-a)]")}
      </div>
    </div>
  );

  const psFaces = (
    <div className="ps-faces relative shrink-0">
      <div className="absolute left-1/2 top-0 -translate-x-1/2">
        {face("x", "△", "bg-[var(--face-x)] text-sm")}
      </div>
      <div className="absolute left-0 top-1/2 -translate-y-1/2">
        {face("y", "□", "bg-[var(--face-y)] text-sm")}
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        {face("a", "○", "bg-[var(--face-a)] text-sm")}
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        {face("b", "×", "bg-[var(--face-b)] text-sm")}
      </div>
    </div>
  );

  const sysCluster = (
    <div
      className={cn(
        "flex items-center justify-center gap-2",
        def.hold === "wide" && "flex-col",
      )}
    >
      {def.hasSelect && sysBtn("select", "SELECT")}
      {sysBtn("start", "START")}
    </div>
  );

  const keysHint = usesPcKeyboard(def.id) ? (
    <p className="hidden px-1 text-center text-[0.62rem] leading-tight tracking-wide text-[var(--face-label)]/70 [@media(hover:hover)_and_(pointer:fine)]:block">
      {keyboardHint(def.id)}
    </p>
  ) : null;

  const shoulder = (btn: PadButton, label: string, side: "l" | "r") => (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "pad-btn no-select min-h-12 min-w-[5rem] px-5 font-display text-sm text-[var(--face-label)]",
        "bg-[var(--shell-deep)]",
        side === "l" ? "rounded-t-2xl rounded-b-lg justify-self-start" : "rounded-t-2xl rounded-b-lg justify-self-end",
      )}
      {...bindBtn(btn)}
    >
      {label}
    </button>
  );

  if (def.hold === "brick" || def.hold === "wide" || def.hold === "clamshell") {
    return (
      <div
        className={cn(
          "handheld no-select min-h-0 flex-1",
          `hold-${def.hold}`,
          `shell-${def.shell}`,
        )}
        style={{ touchAction: "none" }}
      >
        {def.hasShoulders && (
          <>
            <div className="area-l flex flex-col items-start gap-1.5">
              {def.hasTriggers && shoulder("l2", "L2", "l")}
              {shoulder("l", def.hasTriggers ? "L1" : "L", "l")}
            </div>
            <div className="area-r flex flex-col items-end gap-1.5">
              {def.hasTriggers && shoulder("r2", "R2", "r")}
              {shoulder("r", def.hasTriggers ? "R1" : "R", "r")}
            </div>
          </>
        )}
        <div className="area-lcd">
          <div className="area-lcd-inner">{screen}</div>
        </div>
        <div className="area-left">
          {crossPad}
          {(def.hold === "wide" || def.hold === "clamshell") && sysCluster}
          {(def.hold === "wide" || def.hold === "clamshell") && keysHint}
        </div>
        <div className="area-face">
          {def.faces === "ps1"
            ? psFaces
            : def.faces === "snes"
              ? (
                  <div className="ds-faces relative shrink-0">
                    <div className="absolute left-1/2 top-0 -translate-x-1/2">
                      {face("x", "X", "bg-[var(--face-x)]")}
                    </div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2">
                      {face("y", "Y", "bg-[var(--face-y)]")}
                    </div>
                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
                      {face("a", "A", "bg-[var(--face-a)]")}
                    </div>
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                      {face("b", "B", "bg-[var(--face-b)]")}
                    </div>
                  </div>
                )
              : def.hold === "wide"
                ? gbaFaces
                : gbFaces}
        </div>
        {(def.hold === "brick") && (
          <div className="area-sys flex-col gap-1">
            {sysCluster}
            {keysHint}
          </div>
        )}
      </div>
    );
  }

  const stripFaces =
    def.faces === "snes" ? (
      <div className="relative size-[10.5rem] shrink-0">
        <div className="absolute left-1/2 top-0 -translate-x-1/2">
          {face("x", "X", "size-16 bg-[var(--face-x)]")}
        </div>
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          {face("y", "Y", "size-16 bg-[var(--face-y)]")}
        </div>
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          {face("a", "A", "size-16 bg-[var(--face-a)]")}
        </div>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
          {face("b", "B", "size-16 bg-[var(--face-b)]")}
        </div>
      </div>
    ) : def.faces === "n64" ? (
      <div className="relative mr-1 flex size-[8.5rem] shrink-0 items-end justify-end">
        <div className="absolute right-10 top-1">
          {face("b", "B", "size-14 bg-[var(--face-b)]")}
        </div>
        <div className="absolute bottom-2 right-1">
          {face("a", "A", "size-[4.5rem] bg-[var(--face-a)] text-base")}
        </div>
      </div>
    ) : (
      <div className="relative size-[7.5rem] shrink-0">
        <div className="absolute bottom-0 left-0">
          {face("b", "B", "size-16 bg-[var(--face-b)]")}
        </div>
        <div className="absolute right-0 top-0">
          {face("a", "A", "size-16 bg-[var(--face-a)]")}
        </div>
      </div>
    );

  const cPad = def.hasCPad ? (
    <div className="relative size-[6.5rem] shrink-0">
      <div className="absolute left-1/2 top-0 -translate-x-1/2">
        {face("x", "C↑", "size-11 bg-[var(--face-x)] text-[0.65rem]")}
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        {face("l2", "C↓", "size-11 bg-[var(--face-x)] text-[0.65rem]")}
      </div>
      <div className="absolute left-0 top-1/2 -translate-y-1/2">
        {face("y", "C←", "size-11 bg-[var(--face-y)] text-[0.65rem]")}
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        {face("r2", "C→", "size-11 bg-[var(--face-y)] text-[0.65rem]")}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "no-select grid w-full shrink-0 gap-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 min-[700px]:px-6 min-[700px]:pb-6",
        `shell-${def.shell}`,
      )}
      style={{ touchAction: "none" }}
    >
      {def.hasShoulders && (
        <div className="flex gap-3">
          <button
            type="button"
            aria-label="L"
            className="pad-btn no-select h-12 flex-1 rounded-2xl bg-[var(--shell)] font-display text-sm text-[var(--face-label)]"
            {...bindBtn("l")}
          >
            L
          </button>
          {def.hasZ && (
            <button
              type="button"
              aria-label="Z"
              className="pad-btn no-select h-12 min-w-[5.5rem] rounded-2xl bg-[var(--face-z,var(--shell-deep))] font-display text-sm text-bg"
              {...bindBtn("l2")}
            >
              Z
            </button>
          )}
          <button
            type="button"
            aria-label="R"
            className="pad-btn no-select h-12 flex-1 rounded-2xl bg-[var(--shell)] font-display text-sm text-[var(--face-label)]"
            {...bindBtn("r")}
          >
            R
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {def.stick ? analogStick : crossPad}
        {cPad}
        {stripFaces}
      </div>
      {sysCluster}
    </div>
  );
}
