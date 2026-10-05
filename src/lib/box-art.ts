import type { ConsoleId } from "@/lib/consoles";
import { prettyArchiveTitle } from "@/lib/archive";

/** Libretro's public box-art packs. Names have to match the carton filename. */
const PACKS: Record<ConsoleId, string[]> = {
  nes: ["Nintendo - Nintendo Entertainment System"],
  snes: ["Nintendo - Super Nintendo Entertainment System"],
  gb: ["Nintendo - Game Boy", "Nintendo - Game Boy Color"],
  gba: ["Nintendo - Game Boy Advance"],
  nds: ["Nintendo - Nintendo DS"],
  n64: ["Nintendo - Nintendo 64"],
  ps1: ["Sony - PlayStation"],
};

export function libretroBoxUrls(consoleId: ConsoleId, title: string): string[] {
  const name = prettyArchiveTitle(title);
  if (!name) return [];
  const packs = PACKS[consoleId] ?? [];
  return packs.map((pack) => {
    const base = `https://thumbnails.libretro.com/${encodeURIComponent(pack)}/Named_Boxarts/`;
    return `${base}${encodeURIComponent(name)}.png`;
  });
}
