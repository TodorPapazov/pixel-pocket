import type { ConsoleId } from "@/lib/consoles";
import { formatBytes, MAX_PS1_BYTES, MAX_FILE_BYTES, MAX_NDS_BYTES, RomError } from "@/lib/rom";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SKIP_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "xml",
  "mp3",
  "mp4",
  "aac",
  "ogg",
  "wav",
  "flac",
  "torrent",
  "sqlite",
  "html",
  "htm",
  "txt",
  "json",
  "css",
  "js",
  "md",
  "nfo",
  "sfv",
  "md5",
  "sha1",
  "log",
  "pdf",
]);

export interface ArchiveFile {
  name: string;
  size: number;
  ext: string;
}

export interface ArchiveGame {
  id: string;
  title: string;
  size: number;
  files: ArchiveFile[];
  /** Image inside the same Archive.org item, when one shares this title. */
  art?: string;
}

export interface ArchiveCatalog {
  identifier: string;
  title: string;
  games: ArchiveGame[];
}

export interface ArchiveLink {
  identifier: string;
  /** A single file inside the item. */
  fileName?: string;
  /** A folder inside the item, with a trailing slash. */
  prefix?: string;
}

function isArchiveHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return host === "archive.org" || host === "www.archive.org" || host.endsWith(".archive.org");
}

export function parseArchiveLink(raw: string): ArchiveLink | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!isArchiveHost(parsed.hostname)) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const kind = parts[0].toLowerCase();
  if (!["download", "details", "metadata", "cors", "stream"].includes(kind)) {
    return null;
  }
  const identifier = decodeURIComponent(parts[1] || "");
  if (!ID_RE.test(identifier)) return null;
  const rest = parts.slice(2).join("/");
  if (!rest) return { identifier };
  const decoded = decodeURIComponent(rest).replace(/\/+$/, "");
  const base = decoded.split("/").pop() || "";
  const dotted = base.includes(".") && !base.startsWith(".");
  if (!dotted) return { identifier, prefix: `${decoded}/` };
  return { identifier, fileName: decoded };
}

export function archiveCorsFileUrl(identifier: string, fileName: string): string {
  const path = fileName
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://archive.org/cors/${encodeURIComponent(identifier)}/${path}`;
}

export function isArchiveCatalogLink(raw: string): boolean {
  const link = parseArchiveLink(raw);
  return Boolean(link && !link.fileName);
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);

function artScore(name: string): number {
  const n = name.toLowerCase();
  if (/(box|cover|front|cart)/.test(n)) return 0;
  if (n.endsWith(".png")) return 1;
  return 2;
}

function extOf(name: string): string {
  const base = name.split("/").pop() || name;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

function stemOf(name: string): string {
  const base = name.split("/").pop() || name;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function playableSet(prefer: ConsoleId | null | undefined, extensions: string[]): Set<string> {
  const set = new Set(extensions.map((e) => e.toLowerCase()));
  if (prefer === "ps1") {
    for (const e of ["bin", "cue", "iso", "img", "pbp", "chd", "exe", "psx", "mdf"]) set.add(e);
  }
  return set;
}

function orderFiles(parts: ArchiveFile[]): ArchiveFile[] {
  const byExt = new Map(parts.map((p) => [p.ext, p]));
  if (byExt.has("cue") && byExt.has("bin")) return [byExt.get("cue")!, byExt.get("bin")!];
  for (const ext of ["chd", "pbp", "iso", "img", "bin", "exe", "psx", "nes", "sfc", "smc", "gb", "gbc", "gba", "nds", "dsi", "zip", "z64", "n64"]) {
    const hit = byExt.get(ext);
    if (hit) return [hit];
  }
  return parts;
}

export function groupArchiveGames(
  files: { name?: string; size?: string | number; source?: string }[],
  prefer: ConsoleId | null | undefined,
  extensions: string[],
  prefix?: string,
): ArchiveGame[] {
  const playable = playableSet(prefer, extensions);
  const cap = prefer === "ps1" ? MAX_PS1_BYTES : prefer === "nds" ? MAX_NDS_BYTES : MAX_FILE_BYTES;
  const byStem = new Map<string, ArchiveFile[]>();
  const artByStem = new Map<string, { name: string; score: number }>();
  for (const f of files) {
    const name = f.name;
    if (!name || name.endsWith("/")) continue;
    if (prefix && !name.startsWith(prefix)) continue;
    if (String(f.source || "").toLowerCase() === "derivative") continue;
    const ext = extOf(name);
    if (!ext || SKIP_EXT.has(ext)) {
      if (ext && IMAGE_EXT.has(ext)) {
        const stem = stemOf(name);
        const score = artScore(name);
        const prev = artByStem.get(stem);
        if (!prev || score < prev.score) artByStem.set(stem, { name, score });
      }
      continue;
    }
    if (!playable.has(ext)) continue;
    const size = Number(f.size) || 0;
    const stem = stemOf(name);
    const list = byStem.get(stem) ?? [];
    list.push({ name, size, ext });
    byStem.set(stem, list);
  }
  const games: ArchiveGame[] = [];
  for (const [stem, parts] of byStem) {
    const ordered = orderFiles(parts);
    const size = ordered.reduce((sum, p) => sum + p.size, 0);
    if (size <= 0 || size > cap) continue;
    games.push({
      id: stem,
      title: stem,
      size,
      files: ordered,
      art: artByStem.get(stem)?.name,
    });
  }
  games.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return games;
}

function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function filterArchiveGames(games: ArchiveGame[], query: string): ArchiveGame[] {
  const q = normalizeQuery(query);
  if (!q) return games;
  const out: ArchiveGame[] = [];
  for (const g of games) {
    if (normalizeQuery(g.title).includes(q)) out.push(g);
  }
  return out;
}

/** Filename-shaped titles read better as poster captions. */
export function prettyArchiveTitle(title: string): string {
  return title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

interface IaMetadata {
  metadata?: { identifier?: string; title?: string };
  files?: { name?: string; size?: string | number; source?: string }[];
}

async function metadataFrom(url: string): Promise<IaMetadata> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`metadata ${res.status}`);
  return (await res.json()) as IaMetadata;
}

export async function fetchArchiveCatalog(
  identifier: string,
  prefer: ConsoleId | null | undefined,
  extensions: string[],
  prefix?: string,
): Promise<ArchiveCatalog> {
  if (!ID_RE.test(identifier)) {
    throw new RomError("That Archive.org link does not look like an item.");
  }
  let data: IaMetadata | null = null;
  try {
    data = await metadataFrom(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  } catch {
    data = null;
  }
  if (!data) {
    const proxied = await fetch(`/api/archive?id=${encodeURIComponent(identifier)}`);
    if (!proxied.ok) {
      const msg = await proxied.text().catch(() => "");
      throw new RomError(msg || "Could not open that Archive.org cabinet.");
    }
    data = (await proxied.json()) as IaMetadata;
  }
  const id = data.metadata?.identifier || identifier;
  const title = data.metadata?.title || id;
  const games = groupArchiveGames(data.files ?? [], prefer, extensions, prefix);
  if (games.length === 0) {
    throw new RomError(
      "No playable discs in that cabinet for this deck. Try Station for a PS1 folder, or a direct file link.",
    );
  }
  const folder = prefix ? prefix.replace(/\/+$/, "").split("/").pop() : "";
  return { identifier: id, title: folder ? `${title} · ${folder}` : title, games };
}

export function archiveGameLabel(game: ArchiveGame): string {
  const kinds = game.files.map((f) => f.ext).join(" + ");
  return `${formatBytes(game.size)} · ${kinds}`;
}

export { ID_RE as ARCHIVE_ID_RE };
