import type { ConsoleId, PadButton } from "@/lib/consoles";

/**
 * Classic VisualBoyAdvance / VBA-M keyboard map — the layout most people
 * learned on PC Game Boy and GBA emulators:
 *   arrows = D-pad, Z = A, X = B, Enter = Start, Backspace = Select
 *   GBA shoulders: A = L, S = R
 * Game Boy also accepts WASD as a second D-pad (no shoulder conflict).
 *
 * Nintendo DS uses DeSmuME's default PC map:
 *   X = A, Z = B, S = X, A = Y, Q = L, W = R
 */
const SHARED: Record<string, PadButton> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyZ: "a",
  KeyX: "b",
  Enter: "start",
  NumpadEnter: "start",
  Backspace: "select",
  ShiftLeft: "select",
};

const GB_WASD: Record<string, PadButton> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

const GBA_SHOULDERS: Record<string, PadButton> = {
  KeyA: "l",
  KeyS: "r",
};

const DS_KEYS: Record<string, PadButton> = {
  ...SHARED,
  KeyX: "a",
  KeyZ: "b",
  KeyS: "x",
  KeyA: "y",
  KeyQ: "l",
  KeyW: "r",
};

export function usesPcKeyboard(id: ConsoleId): boolean {
  return id === "gb" || id === "gba" || id === "nds";
}

export function buttonFromKey(code: string, id: ConsoleId): PadButton | null {
  if (id === "nds") return DS_KEYS[code] ?? null;
  if (id === "gba") return GBA_SHOULDERS[code] ?? SHARED[code] ?? null;
  if (id === "gb") return GB_WASD[code] ?? SHARED[code] ?? null;
  return null;
}

export function keyboardHint(id: ConsoleId): string {
  if (id === "nds") return "X A · Z B · S X · A Y · Q L · W R · arrows · touch the right screen";
  if (id === "gba") return "PC · Z A · X B · A L · S R · arrows · Enter start";
  if (id === "gb") return "GB / Color · Z A · X B · arrows or WASD · Enter start";
  return "";
}
