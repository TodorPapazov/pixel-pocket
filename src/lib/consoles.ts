export type ConsoleId = "nes" | "snes" | "gb" | "gba" | "nds" | "n64" | "ps1";

export type PadButton =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "x"
  | "y"
  | "l"
  | "r"
  | "l2"
  | "r2"
  | "l3"
  | "r3"
  | "select"
  | "start";

export type Engine = "nostalgist" | "emulatorjs";

export interface DemoGame {
  id: string;
  title: string;
  file: string;
  filename: string;
  note: string;
}

export interface ArchiveCabinet {
  identifier: string;
  label: string;
  hint: string;
}

export interface ConsoleDef {
  id: ConsoleId;
  name: string;
  short: string;
  year: number;
  bits: string;
  blurb: string;
  image: string;
  core: string;
  engine: Engine;
  ejsCore?: string;
  extensions: string[];
  aspect: string;
  shell: ConsoleId;
  buffer: { width: number; height: number };
  hasSelect: boolean;
  hasShoulders: boolean;
  hasCPad: boolean;
  hasZ: boolean;
  stick: boolean;
  faces: "ab" | "snes" | "n64" | "ps1";
  hasTriggers: boolean;
  /** How the player holds it: TV + pad, portrait brick, wide body, or DS clamshell. */
  hold: "tv" | "brick" | "wide" | "clamshell";
  /** Auto pocket-save / resume on this deck. */
  pocketSave?: boolean;
  demos: DemoGame[];
  /** Archive.org items with loose carts this deck can open as a cabinet. */
  cabinets: ArchiveCabinet[];
}

export const CONSOLES: ConsoleDef[] = [
  {
    id: "nes",
    name: "8-Bit",
    short: "NES",
    year: 1985,
    bits: "8-BIT HOME",
    blurb: "Two buttons, a plus pad, and a living-room full of sprites.",
    image: "/images/console-nes.jpg",
    core: "fceumm",
    engine: "nostalgist",
    extensions: ["nes", "unf", "unif", "fds"],
    aspect: "4 / 3",
    shell: "nes",
    buffer: { width: 256, height: 240 },
    hasSelect: true,
    hasShoulders: false,
    hasCPad: false,
    hasZ: false,
    stick: false,
    faces: "ab",
    hasTriggers: false,
    hold: "tv",
    demos: [
      {
        id: "nes-flappy",
        title: "Flappy Bird",
        file: "/roms/flappybird.nes",
        filename: "flappybird.nes",
        note: "Homebrew · tap A",
      },
      {
        id: "nes-invaders",
        title: "Invaders",
        file: "/roms/invaders.nes",
        filename: "invaders.nes",
        note: "Homebrew · shoot",
      },
      {
        id: "nes-pong",
        title: "Pong 1K",
        file: "/roms/pong1k.nes",
        filename: "pong1k.nes",
        note: "Homebrew · classic",
      },
      {
        id: "nes-croom",
        title: "Croom",
        file: "/roms/croom.nes",
        filename: "croom.nes",
        note: "Homebrew · maze",
      },
    ],
    cabinets: [
      {
        identifier: "nes-neo",
        label: "NES roms",
        hint: "Archive.org folder · type a name",
      },
    ],
  },
  {
    id: "snes",
    name: "Super 16",
    short: "SNES",
    year: 1990,
    bits: "16-BIT HOME",
    blurb: "Four face buttons, shoulder bumpers, Mode 7 skies.",
    image: "/images/console-snes.jpg",
    core: "snes9x",
    engine: "nostalgist",
    extensions: ["sfc", "smc", "swc", "fig"],
    aspect: "4 / 3",
    shell: "snes",
    buffer: { width: 256, height: 224 },
    hasSelect: true,
    hasShoulders: true,
    hasCPad: false,
    hasZ: false,
    stick: false,
    faces: "snes",
    hasTriggers: false,
    hold: "tv",
    demos: [
      {
        id: "snes-hawk",
        title: "Astro Hawk",
        file: "/roms/astrohawk.smc",
        filename: "astrohawk.smc",
        note: "Homebrew · shooter",
      },
      {
        id: "snes-rock",
        title: "Rockfall",
        file: "/roms/rockfall.smc",
        filename: "rockfall.smc",
        note: "Homebrew · puzzle",
      },
    ],
    cabinets: [
      {
        identifier: "MySnesRoms",
        label: "SNES roms",
        hint: "Archive.org folder · .smc / .sfc",
      },
    ],
  },
  {
    id: "gb",
    name: "Pocket",
    short: "Game Boy",
    year: 1989,
    bits: "HANDHELD",
    blurb: "Olive glass, cross pad, two buttons. True DMG greens and Color LCD correction.",
    image: "/images/console-gb.jpg",
    core: "gambatte",
    engine: "nostalgist",
    extensions: ["gb", "gbc", "sgb"],
    aspect: "10 / 9",
    shell: "gb",
    buffer: { width: 160, height: 144 },
    hasSelect: true,
    hasShoulders: false,
    hasCPad: false,
    hasZ: false,
    stick: false,
    faces: "ab",
    hasTriggers: false,
    hold: "brick",
    pocketSave: true,
    demos: [
      {
        id: "gb-blast",
        title: "Blastah",
        file: "/roms/blastah.gb",
        filename: "blastah.gb",
        note: "Homebrew · GB",
      },
      {
        id: "gbc-geo",
        title: "Geometrix",
        file: "/roms/geometrix.gbc",
        filename: "geometrix.gbc",
        note: "Homebrew · Color",
      },
    ],
    cabinets: [
      {
        identifier: "dragon-battle-world-demo-aftermarket-unl",
        label: "Game Boy roms",
        hint: "Archive.org folder · .gb",
      },
      {
        identifier: "gbc-roms",
        label: "Game Boy Color roms",
        hint: "Archive.org folder · .gbc",
      },
    ],
  },
  {
    id: "gba",
    name: "Advance",
    short: "GBA",
    year: 2001,
    bits: "32-BIT HANDHELD",
    blurb: "Wide screen, L and R, the last great pocket cartridge.",
    image: "/images/console-gba.jpg",
    core: "mgba",
    engine: "nostalgist",
    extensions: ["gba", "agb", "mb", "gbc", "gb"],
    aspect: "3 / 2",
    shell: "gba",
    buffer: { width: 240, height: 160 },
    hasSelect: true,
    hasShoulders: true,
    hasCPad: false,
    hasZ: false,
    stick: false,
    faces: "ab",
    hasTriggers: false,
    hold: "wide",
    demos: [
      {
        id: "gba-frog",
        title: "Frogtris",
        file: "/roms/frogtris.gba",
        filename: "frogtris.gba",
        note: "Homebrew · puzzle",
      },
      {
        id: "gba-goodboy",
        title: "Goodboy Advance",
        file: "/roms/goodboyadvance.gba",
        filename: "goodboyadvance.gba",
        note: "Homebrew · platform",
      },
    ],
    cabinets: [
      {
        identifier: "my-gba-roms",
        label: "GBA roms",
        hint: "Archive.org folder · .gba",
      },
      {
        identifier: "gbahomebrew",
        label: "GBA homebrew",
        hint: "Archive.org folder · homebrew",
      },
    ],
  },
  {
    id: "nds",
    name: "Dual Screen",
    short: "DS",
    year: 2004,
    bits: "DUAL SCREEN",
    blurb: "Two screens, a stylus, ABXY. Touch the bottom glass.",
    image: "/images/console-nds.jpg",
    core: "desmume2015",
    engine: "emulatorjs",
    ejsCore: "desmume2015",
    extensions: ["nds", "dsi", "ids", "srl", "zip"],
    aspect: "2 / 3",
    shell: "nds",
    buffer: { width: 256, height: 384 },
    hasSelect: true,
    hasShoulders: true,
    hasCPad: false,
    hasZ: false,
    stick: false,
    faces: "snes",
    hasTriggers: false,
    hold: "clamshell",
    pocketSave: true,
    demos: [],
    cabinets: [
      {
        identifier: "nds-collection",
        label: "Nintendo DS roms",
        hint: "Archive.org folder · .nds / .zip",
      },
    ],
  },
  {
    id: "n64",
    name: "Sixty-Four",
    short: "N64",
    year: 1996,
    bits: "64-BIT HOME",
    blurb: "Analog stick, C buttons, three handles. Demanding on phones.",
    image: "/images/console-n64.jpg",
    core: "mupen64plus_next",
    engine: "emulatorjs",
    ejsCore: "n64",
    extensions: ["n64", "v64", "z64", "pal"],
    aspect: "4 / 3",
    shell: "n64",
    buffer: { width: 320, height: 240 },
    hasSelect: false,
    hasShoulders: true,
    hasCPad: true,
    hasZ: true,
    stick: true,
    faces: "n64",
    hasTriggers: false,
    hold: "tv",
    demos: [],
    cabinets: [
      {
        identifier: "n64-roms_202405",
        label: "N64 roms",
        hint: "Archive.org folder · .z64",
      },
    ],
  },
  {
    id: "ps1",
    name: "Station",
    short: "PS1",
    year: 1994,
    bits: "32-BIT CD",
    blurb: "Gray deck, DualShock pad, four face buttons. Disc in the middle, hands on the sides.",
    image: "/images/console-ps1.jpg",
    core: "pcsx_rearmed",
    engine: "nostalgist",
    extensions: ["pbp", "chd", "cue", "psx", "exe", "bin", "iso"],
    aspect: "4 / 3",
    shell: "ps1",
    buffer: { width: 320, height: 240 },
    hasSelect: true,
    hasShoulders: true,
    hasCPad: false,
    hasZ: false,
    stick: true,
    faces: "ps1",
    hasTriggers: true,
    hold: "wide",
    demos: [
      {
        id: "ps1-pad",
        title: "Power on",
        file: "/roms/station-boot.exe",
        filename: "station-boot.exe",
        note: "HLE BIOS · DualShock",
      },
    ],
    cabinets: [
      {
        identifier: "Centuron-PSX",
        label: "PSX by Centuron",
        hint: "Archive.org folder · pick a disc",
      },
    ],
  },
];

export const CONSOLE_BY_ID = Object.fromEntries(
  CONSOLES.map((c) => [c.id, c]),
) as Record<ConsoleId, ConsoleDef>;

const EXT_MAP: Record<string, ConsoleId> = {};
for (const c of CONSOLES) {
  for (const ext of c.extensions) {
    if (!EXT_MAP[ext]) EXT_MAP[ext] = c.id;
  }
}

export function consoleFromFilename(name: string): ConsoleId | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "iso" || ext === "gcm" || ext === "ciso" || ext === "wbfs") {
    return null;
  }
  if (ext === "zip") return null;
  return EXT_MAP[ext] ?? null;
}

export function archiveFolderUrl(identifier: string): string {
  return `https://archive.org/details/${identifier}`;
}

export const ACCEPT_ATTR = CONSOLES.flatMap((c) =>
  c.extensions.map((e) => `.${e}`),
)
  .concat([".iso", ".zip"])
  .join(",");
