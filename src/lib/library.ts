import type { ConsoleId } from "@/lib/consoles";
import { mirrorRom, mirrorSave } from "@/lib/disk";

const DB_NAME = "pixel-pocket";
const DB_VER = 1;
const SAVE_VERSION = 1;

export interface StoredRom {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  blob: Blob;
  addedAt: number;
}

export interface StoredRomMeta {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  size: number;
  addedAt: number;
}

export interface StoredSave {
  id: string;
  version: number;
  consoleId: ConsoleId;
  name: string;
  state: Blob;
  sram?: Blob;
  thumbnail?: Blob;
  savedAt: number;
  rev?: number;
  romHash?: string;
  device?: string;
  syncedAt?: number;
  sessionMs?: number;
  playedMs?: number;
}

export interface SaveMeta {
  id: string;
  name: string;
  consoleId: ConsoleId;
  savedAt: number;
  rev?: number;
  synced?: boolean;
  device?: string;
  sessionMs?: number;
  playedMs?: number;
}

type StoredRomRow = Omit<StoredRom, "blob"> & {
  blob: Blob | ArrayBuffer;
};

type StoredSaveRow = Omit<StoredSave, "state" | "sram" | "thumbnail"> & {
  state: Blob | ArrayBuffer;
  sram?: Blob | ArrayBuffer;
  thumbnail?: Blob | ArrayBuffer;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("roms")) {
        db.createObjectStore("roms", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("saves")) {
        db.createObjectStore("saves", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** iOS Safari detaches IDB Blobs after the transaction — copy to a live ArrayBuffer. */
async function materializeBlob(value: unknown): Promise<Blob | null> {
  if (!value) return null;
  try {
    if (value instanceof ArrayBuffer) {
      return new Blob([value], { type: "application/octet-stream" });
    }
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return new Blob([copy], { type: "application/octet-stream" });
    }
    if (value instanceof Blob) {
      const buf = await value.arrayBuffer();
      return new Blob([buf], { type: value.type || "application/octet-stream" });
    }
  } catch {
    return null;
  }
  return null;
}

async function toBuffer(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
}

function byteSize(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

export async function rememberRom(entry: StoredRom): Promise<void> {
  const buf = await toBuffer(entry.blob);
  const db = await openDb();
  const tx = db.transaction("roms", "readwrite");
  tx.objectStore("roms").put({
    ...entry,
    blob: buf,
  });
  await txDone(tx);
  await trimRoms(12);
  void mirrorRom(entry).catch(() => undefined);
}

export async function listRoms(): Promise<StoredRomMeta[]> {
  const db = await openDb();
  const tx = db.transaction("roms", "readonly");
  const store = tx.objectStore("roms");
  const rows = await new Promise<StoredRomRow[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as StoredRomRow[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      filename: r.filename,
      consoleId: r.consoleId,
      size: byteSize(r.blob),
      addedAt: r.addedAt,
    }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function getRom(id: string): Promise<StoredRom | null> {
  const db = await openDb();
  const tx = db.transaction("roms", "readonly");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore("roms").get(id);
    req.onsuccess = () => {
      const row = req.result as StoredRomRow | undefined;
      if (!row) {
        resolve(null);
        return;
      }
      void materializeBlob(row.blob).then((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve({ ...row, blob });
      }, reject);
    };
    req.onerror = () => reject(req.error);
  });
}

async function trimRoms(max: number) {
  const all = await listRoms();
  const saved = await listSaveMeta();
  const keep = new Set(saved.map((s) => s.id));
  const droppable = all.filter((r) => !keep.has(r.id));
  if (droppable.length <= max) return;
  const db = await openDb();
  const tx = db.transaction("roms", "readwrite");
  const store = tx.objectStore("roms");
  for (const extra of droppable.slice(max)) store.delete(extra.id);
  await txDone(tx);
}

export async function putSave(entry: StoredSave): Promise<void> {
  const stateBuf = await toBuffer(entry.state);
  const sramBuf = entry.sram ? await toBuffer(entry.sram) : undefined;
  const db = await openDb();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").put({
    id: entry.id,
    version: SAVE_VERSION,
    consoleId: entry.consoleId,
    name: entry.name,
    state: stateBuf,
    sram: sramBuf,
    savedAt: entry.savedAt,
    rev: entry.rev,
    romHash: entry.romHash,
    device: entry.device,
    syncedAt: entry.syncedAt,
    sessionMs: entry.sessionMs,
    playedMs: entry.playedMs,
  });
  await txDone(tx);
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* private mode */
  }
  void mirrorSave(entry).catch(() => undefined);
}

export async function getSave(id: string): Promise<StoredSave | null> {
  const db = await openDb();
  const tx = db.transaction("saves", "readonly");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore("saves").get(id);
    req.onsuccess = () => {
      const row = req.result as StoredSaveRow | undefined;
      if (!row) {
        resolve(null);
        return;
      }
      void (async () => {
        const state = await materializeBlob(row.state);
        const sram = await materializeBlob(row.sram);
        if (!state && !sram) {
          resolve(null);
          return;
        }
        resolve({
          id: row.id,
          version: row.version,
          consoleId: row.consoleId,
          name: row.name,
          state: state ?? new Blob(),
          sram: sram ?? undefined,
          savedAt: row.savedAt,
          rev: row.rev,
          romHash: row.romHash,
          device: row.device,
          syncedAt: row.syncedAt,
          sessionMs: row.sessionMs,
          playedMs: row.playedMs,
        });
      })().catch(reject);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listSaveMeta(consoleId?: ConsoleId): Promise<SaveMeta[]> {
  const db = await openDb();
  const tx = db.transaction("saves", "readonly");
  const rows = await new Promise<StoredSaveRow[]>((resolve, reject) => {
    const req = storeGetAll(tx);
    req.onsuccess = () => resolve((req.result as StoredSaveRow[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  return rows
    .filter((r) => (r.state || r.sram) && (!consoleId || r.consoleId === consoleId))
    .map((r) => ({
      id: r.id,
      name: r.name || r.id,
      consoleId: r.consoleId,
      savedAt: r.savedAt || 0,
      rev: r.rev,
      device: r.device,
      sessionMs: r.sessionMs,
      playedMs: r.playedMs,
      synced: typeof r.rev === "number" && (r.syncedAt ?? 0) >= (r.savedAt || 0) - 1500,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

function storeGetAll(tx: IDBTransaction): IDBRequest {
  return tx.objectStore("saves").getAll();
}

export async function deleteSave(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("saves", "readwrite");
  tx.objectStore("saves").delete(id);
  await txDone(tx);
}

export async function saveStateBlob(
  gameId: string,
  state: Blob,
): Promise<void> {
  const prev = await getSave(gameId);
  await putSave({
    id: gameId,
    version: SAVE_VERSION,
    consoleId: prev?.consoleId ?? "gb",
    name: prev?.name ?? gameId,
    state,
    sram: prev?.sram,
    thumbnail: prev?.thumbnail,
    savedAt: Date.now(),
  });
}

export async function loadStateBlob(gameId: string): Promise<Blob | null> {
  const row = await getSave(gameId);
  return row?.state && row.state.size > 0 ? row.state : null;
}

export function formatSavedAt(ts: number): string {
  if (!ts) return "saved";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))}h ago`;
  return `${Math.max(1, Math.round(s / 86400))}d ago`;
}

export function formatSessionDay(ts: number): string {
  if (!ts) return "Earlier";
  const day = new Date(ts);
  const now = new Date();
  const start = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((start(now) - start(day)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) {
    return day.toLocaleDateString(undefined, { weekday: "long" });
  }
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatPlayed(ms: number | undefined): string {
  if (!ms || ms < 1000) return "";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} sec`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function isNotFoundError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof DOMException && e.name === "NotFoundError") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /object can not be found/i.test(msg);
}
