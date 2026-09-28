import { create } from "zustand";
import type { ConsoleId } from "@/lib/consoles";

export type Phase = "boot" | "select" | "load" | "playing";

export interface LoadedGame {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  file: File;
  files?: File[];
  /** When false, skip restoring a pocket save (New game). */
  resume?: boolean;
}

interface PocketState {
  phase: Phase;
  consoleId: ConsoleId | null;
  game: LoadedGame | null;
  voiceOn: boolean;
  powerOn: () => void;
  pickConsole: (id: ConsoleId) => void;
  startGame: (game: LoadedGame) => void;
  backToSelect: () => void;
  backToLoad: () => void;
  setVoiceOn: (on: boolean) => void;
}

export const usePocket = create<PocketState>((set) => ({
  phase: "boot",
  consoleId: null,
  game: null,
  voiceOn: true,
  powerOn: () => set({ phase: "select" }),
  pickConsole: (id) => set({ consoleId: id, phase: "load", game: null }),
  startGame: (game) =>
    set({ game, consoleId: game.consoleId, phase: "playing" }),
  backToSelect: () => set({ phase: "select", game: null }),
  backToLoad: () => set({ phase: "load", game: null }),
  setVoiceOn: (on) => set({ voiceOn: on }),
}));
