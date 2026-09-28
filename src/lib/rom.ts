import {
  type ConsoleId,
  consoleFromFilename,
} from "@/lib/consoles";
import { extractDsCart, isZip } from "@/lib/zip";

const MAX_PROXY_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Raw 80-min PS1 dumps use 2352-byte sectors and can approach ~850 MB. */
const MAX_PS1_BYTES = 900 * 1024 * 1024;
/** DS carts in that Archive cabinet run 4–128 MB; zip wrappers sit on top. */
const MAX_NDS_BYTES = 256 * 1024 * 1024;
const PERSIST_MAX_BYTES = 48 * 1024 * 1024;
const PS1_EXTS = new Set(["pbp", "chd", "cue", "bin", "iso", "img", "exe", "psx", "mdf"]);
const NDS_EXTS = new Set(["nds", "dsi", "ids", "srl", "zip"]);

export class RomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RomError";
  }
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function asciiAt(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  const end = Math.min(bytes.length, start + len);
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function looksLikePs1(bytes: Uint8Array, filename: string): boolean {
  if (bytes.length >= 8 && asciiAt(bytes, 0, 8) === "PS-X EXE") return true;
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x42 &&
    bytes[3] === 0x50
  ) {
    return true;
  }
  const hay = asciiAt(bytes, 0, Math.min(bytes.length, 40 * 1024)).toUpperCase();
  if (hay.includes("PLAYSTATION") || hay.includes("PS-X EXE")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pbp" || ext === "chd" || ext === "cue" || ext === "psx";
}

function capFor(filename: string, prefer?: ConsoleId | null): number {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (prefer === "ps1" || PS1_EXTS.has(ext)) return MAX_PS1_BYTES;
  if (prefer === "nds" || NDS_EXTS.has(ext)) return MAX_NDS_BYTES;
  return MAX_FILE_BYTES;
}

function tooBigMessage(size: number, cap: number, kind: "ps1" | "nds" | "file"): string {
  const got = formatBytes(size);
  if (kind === "ps1") {
    return `That disc is ${got} — over the ${formatBytes(cap)} Station cap. Try a compressed .pbp or .chd.`;
  }
  if (kind === "nds") {
    return `That DS cart is ${got} — over the ${formatBytes(cap)} Dual Screen cap.`;
  }
  return `That file is ${got} — too big for this deck.`;
}

function capKind(cap: number, prefer?: ConsoleId | null): "ps1" | "nds" | "file" {
  if (prefer === "ps1" || cap === MAX_PS1_BYTES) return "ps1";
  if (prefer === "nds" || cap === MAX_NDS_BYTES) return "nds";
  return "file";
}

export function detectConsole(
  bytes: Uint8Array,
  filename: string,
  prefer?: ConsoleId | null,
): ConsoleId | "disc" | null {
  if (bytes.length >= 4) {
    if (
      bytes[0] === 0x4e &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x53 &&
      bytes[3] === 0x1a
    ) {
      return "nes";
    }
    const be =
      (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    if (
      be === 0x80371240 ||
      be === 0x37804012 ||
      be === 0x40123780
    ) {
      return "n64";
    }
  }
  if (looksLikePs1(bytes, filename)) return "ps1";
  if (prefer === "nds" && (isZip(bytes) || NDS_EXTS.has(filename.split(".").pop()?.toLowerCase() ?? ""))) {
    return "nds";
  }
  if (NDS_EXTS.has(filename.split(".").pop()?.toLowerCase() ?? "") && filename.split(".").pop()?.toLowerCase() !== "zip") {
    return "nds";
  }
  if (bytes.length > 0xb2 && bytes[0] === 0x2e && bytes[1] === 0x00) {
    return "gba";
  }
  const fromName = consoleFromFilename(filename);
  if (fromName) return fromName;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (prefer === "ps1" && PS1_EXTS.has(ext)) return "ps1";
  if (ext === "iso" || ext === "gcm" || ext === "wbfs" || ext === "ciso") {
    return "disc";
  }
  return null;
}

export function assertPlayable(size: number, detected: ConsoleId | "disc" | null) {
  if (detected === "disc") {
    throw new RomError(
      "Disc images (GameCube / Wii) are too large for this pocket player. Try a cartridge dump, or a PlayStation .pbp / .exe / .bin.",
    );
  }
  if (!detected) {
    throw new RomError(
      "Could not tell which console that file belongs to. Use a .nes, .sfc, .gb, .gba, .nds, .z64, .pbp, or PS-X .exe file.",
    );
  }
  const cap =
    detected === "ps1" ? MAX_PS1_BYTES : detected === "nds" ? MAX_NDS_BYTES : MAX_FILE_BYTES;
  if (size > cap) {
    throw new RomError(
      tooBigMessage(size, cap, detected === "ps1" ? "ps1" : detected === "nds" ? "nds" : "file"),
    );
  }
}

async function streamToBlob(
  res: Response,
  cap: number,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Blob> {
  const total = Number(res.headers.get("content-length") || "0");
  if (total > cap) {
    throw new RomError(tooBigMessage(total, cap, capKind(cap)));
  }
  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > cap) {
      throw new RomError(tooBigMessage(blob.size, cap, capKind(cap)));
    }
    onProgress?.({ received: blob.size, total: blob.size });
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let parts = 0;
  let received = 0;
  let lastEmit = 0;
  const yieldUi = () =>
    new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > cap) {
        throw new RomError(tooBigMessage(received, cap, capKind(cap)));
      }
      chunks.push(value);
      parts += 1;
      if (parts >= 48) {
        const compacted = new Blob(chunks);
        chunks.length = 0;
        chunks.push(compacted);
        parts = 1;
      }
      const now = Date.now();
      if (now - lastEmit >= 250) {
        lastEmit = now;
        onProgress?.({ received, total });
        await yieldUi();
      }
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  onProgress?.({ received, total: total || received });
  return new Blob(chunks, { type: "application/octet-stream" });
}

async function fetchDirect(
  href: string,
  cap: number,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Blob> {
  const res = await fetch(href, {
    redirect: "follow",
    mode: "cors",
    headers: { Accept: "application/octet-stream,*/*" },
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return streamToBlob(res, cap, onProgress);
}

export async function fileFromUrl(
  url: string,
  prefer?: ConsoleId | null,
  onProgress?: (p: DownloadProgress) => void,
  fileName?: string,
): Promise<{ file: File; detected: ConsoleId }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RomError("That does not look like a web link.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RomError("Links need to start with https://");
  }

  const nameGuess =
    fileName?.trim() ||
    decodeURIComponent(parsed.pathname.split("/").pop() || "game.rom") ||
    "game.rom";
  const cap = capFor(nameGuess, prefer);

  let blob: Blob | null = null;
  let blocked = false;
  try {
    blob = await fetchDirect(parsed.toString(), cap, onProgress);
  } catch (e) {
    if (e instanceof RomError) throw e;
    blocked = true;
    blob = null;
  }

  if (!blob) {
    const proxied = await fetch(
      `/api/rom?url=${encodeURIComponent(parsed.toString())}`,
    );
    if (proxied.status === 413) {
      throw new RomError(
        blocked
          ? "That disc is too big for a host that blocks the phone. Upload the file, or use a direct https link (Archive.org usually works)."
          : "That file is too large to fetch through the link helper. Upload it, or use a direct https link.",
      );
    }
    if (!proxied.ok) {
      const msg = await proxied.text().catch(() => "");
      throw new RomError(
        blocked
          ? msg ||
            "This host will not let the phone download that file. Upload the disc instead."
          : msg || "Could not download that link.",
      );
    }
    blob = await streamToBlob(proxied, MAX_PROXY_BYTES, onProgress);
  }

  const buf = new Uint8Array(await blob.slice(0, 40 * 1024).arrayBuffer());
  return finalizeRom(blob, nameGuess, prefer, buf);
}

async function finalizeRom(
  blob: Blob,
  nameGuess: string,
  prefer: ConsoleId | null | undefined,
  head: Uint8Array,
): Promise<{ file: File; detected: ConsoleId }> {
  let file = new File([blob], nameGuess, { type: "application/octet-stream" });
  const ext = nameGuess.split(".").pop()?.toLowerCase() ?? "";
  if (prefer === "nds" && (isZip(head) || ext === "zip")) {
    const cart = await extractDsCart(blob);
    if (!cart) {
      throw new RomError("No Nintendo DS cartridge inside that zip.");
    }
    file = cart;
  }
  const sniff = new Uint8Array(await file.slice(0, 40 * 1024).arrayBuffer());
  const detected = detectConsole(sniff, file.name, prefer);
  assertPlayable(file.size, detected);
  return { file, detected: detected as ConsoleId };
}

export async function fileFromUpload(
  input: File,
  prefer?: ConsoleId | null,
): Promise<{ file: File; detected: ConsoleId }> {
  if (input.size > MAX_PS1_BYTES) {
    throw new RomError(tooBigMessage(input.size, MAX_PS1_BYTES, "ps1"));
  }
  const buf = new Uint8Array(await input.slice(0, 40 * 1024).arrayBuffer());
  return finalizeRom(input, input.name, prefer, buf);
}

export {
  MAX_PROXY_BYTES,
  MAX_FILE_BYTES,
  MAX_PS1_BYTES,
  MAX_NDS_BYTES,
  PERSIST_MAX_BYTES,
};
