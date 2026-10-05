import type { Nostalgist } from "nostalgist";
import type { ConsoleDef, PadButton } from "@/lib/consoles";
import { patchAudioCapture, resumeAllAudio } from "@/lib/sound";

export interface EmuHandle {
  pressDown: (button: PadButton) => void;
  pressUp: (button: PadButton) => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  saveState: () => Promise<Blob | null>;
  saveSRAM: () => Promise<Blob | null>;
  loadState: (blob: Blob) => Promise<void>;
  resize: (width: number, height: number) => void;
  kickAudio: () => void;
  exit: () => Promise<void>;
}

const RETRO_CFG: Record<string, string | boolean | number> = {
  savestate_thumbnail_enable: false,
  video_smooth: false,
  video_scale_integer: false,
  video_shader_enable: false,
  video_font_enable: false,
  notification_show_autoconfig: false,
  input_menu_toggle: "nul",
  rewind_enable: false,
  audio_enable: true,
  audio_mute_enable: false,
  audio_fastforward_mute: false,
  audio_sync: true,
  audio_latency: 64,
};

/**
 * Per-deck libretro core options. Game Boy uses the Gambatte accuracy
 * profile from libretro docs: Auto hardware, DMG olive fallback, Pokéfan531
 * GBC LCD correction. No boot ROM is shipped (HLE start).
 */
function coreConfigFor(def: ConsoleDef): Record<string, string> | undefined {
  if (def.id === "ps1") {
    return {
      pcsx_rearmed_bios: "HLE",
      pcsx_rearmed_region: "auto",
      pcsx_rearmed_drc: "enabled",
      pcsx_rearmed_frameskip: "0",
    };
  }
  if (def.id === "gb") {
    return {
      gambatte_gb_hwmode: "Auto",
      gambatte_gb_bootloader: "disabled",
      gambatte_gb_colorization: "auto",
      gambatte_gb_internal_palette: "GB - DMG",
      gambatte_gbc_color_correction: "GBC only",
      gambatte_gbc_color_correction_mode: "accurate",
      gambatte_gbc_frontlight_position: "central",
      gambatte_mix_frames: "disabled",
      gambatte_up_down_allowed: "disabled",
      gambatte_dark_filter_level: "0",
    };
  }
  return undefined;
}

function kickNostalgistAudio(n: Nostalgist) {
  void resumeAllAudio();
  try {
    const al = (
      n as unknown as {
        getEmscriptenAL?: () => {
          currentCtx?: { audioCtx?: AudioContext };
          currentContext?: { audioCtx?: AudioContext };
          contexts?: { audioCtx?: AudioContext }[];
        };
      }
    ).getEmscriptenAL?.();
    void al?.currentCtx?.audioCtx?.resume?.();
    void al?.currentContext?.audioCtx?.resume?.();
    if (Array.isArray(al?.contexts)) {
      for (const ctx of al.contexts) void ctx?.audioCtx?.resume?.();
    }
  } catch {
    /* ignore */
  }
  try {
    const mod = (
      n as unknown as {
        getEmscriptenModule?: () => {
          SDL2?: { audioContext?: AudioContext };
          audioContext?: AudioContext;
        };
      }
    ).getEmscriptenModule?.();
    void mod?.SDL2?.audioContext?.resume?.();
    void mod?.audioContext?.resume?.();
  } catch {
    /* ignore */
  }
}

function nostalgistHandle(n: Nostalgist): EmuHandle {
  if (typeof window !== "undefined") {
    (window as unknown as { __pocketEmu?: Nostalgist }).__pocketEmu = n;
  }
  return {
    pressDown: (button) => n.pressDown(button),
    pressUp: (button) => n.pressUp(button),
    pause: () => n.pause(),
    resume: () => {
      n.resume();
      kickNostalgistAudio(n);
    },
    restart: () => n.restart(),
    saveState: async () => {
      const { state } = await n.saveState();
      return state ?? null;
    },
    saveSRAM: async () => {
      try {
        return await n.saveSRAM();
      } catch {
        return null;
      }
    },
    loadState: async (blob) => {
      await n.loadState(blob);
    },
    resize: (width, height) => n.resize({ width, height }),
    kickAudio: () => kickNostalgistAudio(n),
    exit: async () => {
      n.exit();
    },
  };
}

export async function launchNostalgist(opts: {
  canvas: HTMLCanvasElement;
  core: string;
  file: File;
  files?: File[];
  width: number;
  height: number;
  coreConfig?: Record<string, string>;
  smooth?: boolean;
  state?: Blob | null;
  sram?: Blob | null;
}): Promise<EmuHandle> {
  const { Nostalgist } = await import("nostalgist");
  patchAudioCapture();
  await resumeAllAudio();
  const rom =
    opts.files && opts.files.length > 1 ? opts.files : opts.file;
  const n = await Nostalgist.launch({
    core: opts.core,
    rom,
    element: opts.canvas,
    respondToGlobalEvents: true,
    size: { width: opts.width, height: opts.height },
    style: {
      width: `${opts.width}px`,
      height: `${opts.height}px`,
      backgroundColor: "#000",
      imageRendering: opts.smooth ? "auto" : "pixelated",
      display: "block",
    },
    retroarchConfig: {
      ...RETRO_CFG,
      video_smooth: Boolean(opts.smooth),
    } as never,
    retroarchCoreConfig: { ...(opts.coreConfig ?? {}) } as never,
    ...(opts.state ? { state: opts.state } : {}),
    ...(opts.sram ? { sram: opts.sram, sramType: "srm" as const } : {}),
  });
  kickNostalgistAudio(n);
  return nostalgistHandle(n);
}

const EJS_INDEX: Record<PadButton, number> = {
  b: 0,
  y: 1,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  x: 9,
  l: 10,
  r: 11,
  l2: 12,
  r2: 13,
  l3: 14,
  r3: 15,
};

interface EjsApi {
  gameManager?: {
    simulateInput?: (player: number, index: number, value: number) => void;
    restart?: () => void;
    getState?: () => Uint8Array | Promise<Uint8Array>;
    loadState?: (data: Uint8Array) => void;
  };
  pause?: () => void;
  play?: () => void;
  destroy?: () => void;
  saveState?: () => void;
  loadState?: (data: unknown) => void;
  on?: (ev: string, fn: () => void) => void;
}

function emulatorJsHandle(getApi: () => EjsApi | undefined, blobUrl: string): EmuHandle {
  const send = (button: PadButton, value: number) => {
    const api = getApi();
    const idx = EJS_INDEX[button];
    if (idx == null) return;
    api?.gameManager?.simulateInput?.(0, idx, value);
  };
  return {
    pressDown: (b) => send(b, 1),
    pressUp: (b) => send(b, 0),
    pause: () => getApi()?.pause?.(),
    resume: () => {
      getApi()?.play?.();
      void resumeAllAudio();
    },
    restart: () => getApi()?.gameManager?.restart?.(),
    saveState: async () => {
      const api = getApi();
      try {
        const data = await api?.gameManager?.getState?.();
        if (!data) return null;
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        return new Blob([copy], { type: "application/octet-stream" });
      } catch {
        return null;
      }
    },
    saveSRAM: async () => null,
    loadState: async (blob) => {
      const api = getApi();
      const buf = new Uint8Array(await blob.arrayBuffer());
      api?.gameManager?.loadState?.(buf);
    },
    resize: () => undefined,
    kickAudio: () => {
      void resumeAllAudio();
    },
    exit: async () => {
      try {
        getApi()?.destroy?.();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(blobUrl);
    },
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the Dual Screen core."));
    document.body.appendChild(s);
  });
}

export async function launchEmulatorJS(opts: {
  container: HTMLElement;
  core: string;
  file: File;
  label?: string;
}): Promise<EmuHandle> {
  const blobUrl = URL.createObjectURL(opts.file);
  const w = window as unknown as {
    EJS_player?: string | HTMLElement;
    EJS_core?: string;
    EJS_gameUrl?: string;
    EJS_gameID?: string;
    EJS_pathtodata?: string;
    EJS_startOnLoaded?: boolean;
    EJS_color?: string;
    EJS_backgroundColor?: string;
    EJS_Buttons?: boolean | Record<string, boolean>;
    EJS_hideSettings?: boolean;
    EJS_disableDatabases?: boolean;
    EJS_forceLegacyCores?: boolean;
    EJS_onGameStart?: () => void;
    EJS_onLoadState?: () => void;
    EJS_emulator?: EjsApi;
    EmulatorJS?: new (player: string | HTMLElement, config: Record<string, unknown>) => EjsApi;
  };

  try {
    w.EJS_emulator?.destroy?.();
  } catch {
    /* ignore */
  }
  w.EJS_emulator = undefined;

  opts.container.innerHTML = "";
  const mountId = `ejs-mount-${Math.random().toString(36).slice(2, 8)}`;
  opts.container.id = mountId;

  w.EJS_player = `#${mountId}`;
  w.EJS_core = opts.core;
  w.EJS_gameUrl = blobUrl;
  w.EJS_gameID = `${opts.core}-${opts.file.name}`;
  w.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
  w.EJS_startOnLoaded = true;
  w.EJS_color = "#c94c3d";
  w.EJS_backgroundColor = "#0c0b0a";
  w.EJS_Buttons = {
    playPause: false,
    restart: false,
    mute: false,
    settings: false,
    fullscreen: false,
    saveState: false,
    loadState: false,
    screenRecord: false,
    gamepad: false,
    cheat: false,
    volume: false,
    saveSavFiles: false,
    loadSavFiles: false,
    quickSave: false,
    quickLoad: false,
    screenshot: false,
    cacheManager: false,
    exitEmulation: false,
  };
  w.EJS_hideSettings = true;
  w.EJS_disableDatabases = true;
  w.EJS_forceLegacyCores = true;

  const deck = opts.label ?? "this deck";
  const started = new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${deck} took too long to boot. Try a smaller cart.`)),
      120000,
    );
    w.EJS_onGameStart = () => {
      window.clearTimeout(t);
      const pad = document.querySelector<HTMLElement>(
        ".ejs_virtualGamepad_parent, .ejs_virtualGamepad_open",
      );
      if (pad) pad.style.display = "none";
      resolve();
    };
  });

  if (typeof w.EmulatorJS === "function") {
    const emu = new w.EmulatorJS(`#${mountId}`, {
      gameUrl: blobUrl,
      dataPath: "https://cdn.emulatorjs.org/stable/data/",
      system: opts.core,
      startOnLoad: true,
      buttonOpts: false,
      hideSettings: true,
      disableDatabases: true,
      forceLegacyCores: true,
      color: "#c94c3d",
      backgroundColor: "#0c0b0a",
      gameId: `${opts.core}-${opts.file.name}`,
    });
    w.EJS_emulator = emu;
    emu.on?.("start", () => w.EJS_onGameStart?.());
  } else {
    await loadScript("https://cdn.emulatorjs.org/stable/data/loader.js");
  }
  await started;
  return emulatorJsHandle(() => w.EJS_emulator, blobUrl);
}

export async function launchForConsole(opts: {
  def: ConsoleDef;
  file: File;
  files?: File[];
  canvas: HTMLCanvasElement | null;
  container: HTMLElement | null;
  width: number;
  height: number;
  state?: Blob | null;
  sram?: Blob | null;
}): Promise<EmuHandle> {
  if (opts.def.engine === "emulatorjs") {
    if (!opts.container) throw new Error("Missing playfield.");
    return launchEmulatorJS({
      container: opts.container,
      core: opts.def.ejsCore ?? opts.def.id,
      file: opts.file,
      label: opts.def.short,
    });
  }
  if (!opts.canvas) throw new Error("Missing playfield.");
  return launchNostalgist({
    canvas: opts.canvas,
    core: opts.def.core,
    file: opts.file,
    files: opts.files,
    width: opts.width,
    height: opts.height,
    smooth: opts.def.id === "ps1",
    state: opts.state,
    sram: opts.sram,
    coreConfig: coreConfigFor(opts.def),
  });
}
