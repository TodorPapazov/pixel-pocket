import type { ConsoleId } from "@/lib/consoles";
import type { StoredRom, StoredSave } from "@/lib/library";

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

const HANDLE_DB = "pixel-pocket-disk";
const HANDLE_STORE = "kv";
const HANDLE_KEY = "vault";
const CHANGE = "pocket-disk";
const INDEX_FILE = "pockets.json";

type VaultKind = "folder" | "opfs" | "none";

export type DiskIndexRow = {
  id: string;
  name: string;
  filename?: string;
  consoleId: ConsoleId;
  savedAt: number;
  sessionMs?: number;
  playedMs?: number;
  hasState: boolean;
  hasSram: boolean;
  hasRom: boolean;
};

type DiskIndex = {
  version: 1;
  updatedAt: number;
  pockets: DiskIndexRow[];
};

let folderHandle: FileSystemDirectoryHandle | null = null;
let kind: VaultKind = "none";

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE));
}

export function diskKind(): VaultKind {
  return kind;
}

export function onDiskChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE, fn);
  return () => window.removeEventListener(CHANGE, fn);
}

function fileKey(id: string): string {
  return id.replace(/[^a-zA-Z0-9._~-]+/g, "_").slice(0, 180);
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
  });
}

async function loadStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const withPerm = handle as FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  try {
    const query = (await withPerm.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (query === "granted") return true;
    const next = (await withPerm.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    return next === "granted";
  } catch {
    return false;
  }
}

async function writeBlob(dir: FileSystemDirectoryHandle, name: string, data: Blob): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readBlob(dir: FileSystemDirectoryHandle, name: string): Promise<Blob | null> {
  try {
    const file = await dir.getFileHandle(name);
    const blob = await file.getFile();
    const buf = await blob.arrayBuffer();
    return new Blob([buf], { type: "application/octet-stream" });
  } catch {
    return null;
  }
}

async function readIndex(root: FileSystemDirectoryHandle): Promise<DiskIndex> {
  const blob = await readBlob(root, INDEX_FILE);
  if (!blob) return { version: 1, updatedAt: 0, pockets: [] };
  try {
    const parsed = JSON.parse(await blob.text()) as DiskIndex;
    if (!parsed || !Array.isArray(parsed.pockets)) {
      return { version: 1, updatedAt: 0, pockets: [] };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: 0, pockets: [] };
  }
}

async function writeIndex(root: FileSystemDirectoryHandle, index: DiskIndex): Promise<void> {
  const body = JSON.stringify({ ...index, version: 1, updatedAt: Date.now() }, null, 2);
  await writeBlob(root, INDEX_FILE, new Blob([body], { type: "application/json" }));
}

async function upsertIndex(
  root: FileSystemDirectoryHandle,
  row: DiskIndexRow,
): Promise<void> {
  const index = await readIndex(root);
  const rest = index.pockets.filter((item) => item.id !== row.id);
  rest.unshift(row);
  await writeIndex(root, { version: 1, updatedAt: Date.now(), pockets: rest });
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const storage = navigator.storage;
    if (!storage?.getDirectory) return null;
    const base = await storage.getDirectory();
    return await base.getDirectoryHandle("pixel-pocket", { create: true });
  } catch {
    return null;
  }
}

async function roots(): Promise<FileSystemDirectoryHandle[]> {
  const found: FileSystemDirectoryHandle[] = [];
  if (folderHandle) found.push(folderHandle);
  const opfs = await opfsRoot();
  if (opfs) found.push(opfs);
  return found;
}

export async function restoreVault(): Promise<VaultKind> {
  if (typeof window === "undefined") return "none";
  const stored = await loadStoredHandle();
  if (stored && (await ensurePermission(stored))) {
    folderHandle = stored;
    kind = "folder";
    emit();
    return kind;
  }
  const opfs = await opfsRoot();
  if (opfs) {
    kind = "opfs";
    emit();
    return kind;
  }
  kind = "none";
  emit();
  return kind;
}

export async function pickVaultFolder(): Promise<VaultKind> {
  if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
    throw new Error("This browser cannot pick a folder. Use Chrome or Edge on a computer.");
  }
  const handle = await window.showDirectoryPicker({
    id: "pixel-pocket",
    mode: "readwrite",
    startIn: "documents",
  });
  const ok = await ensurePermission(handle);
  if (!ok) throw new Error("PIXEL POCKET needs permission to write in that folder.");
  folderHandle = handle;
  await storeHandle(handle);
  kind = "folder";
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* private mode */
  }
  emit();
  return kind;
}

export async function mirrorSave(entry: StoredSave): Promise<void> {
  const list = await roots();
  if (list.length === 0) return;
  const key = fileKey(entry.id);
  for (const root of list) {
    try {
      const saves = await root.getDirectoryHandle("saves", { create: true });
      await writeBlob(saves, `${key}.state`, entry.state);
      if (entry.sram && entry.sram.size > 0) {
        await writeBlob(saves, `${key}.sram`, entry.sram);
      }
      const index = await readIndex(root);
      const prev = index.pockets.find((row) => row.id === entry.id);
      await upsertIndex(root, {
        id: entry.id,
        name: entry.name,
        filename: prev?.filename,
        consoleId: entry.consoleId,
        savedAt: entry.savedAt,
        sessionMs: entry.sessionMs,
        playedMs: entry.playedMs,
        hasState: entry.state.size > 0,
        hasSram: Boolean(entry.sram && entry.sram.size > 0),
        hasRom: Boolean(prev?.hasRom),
      });
    } catch {
      /* folder gone or quota */
    }
  }
}

export async function mirrorRom(entry: StoredRom): Promise<void> {
  const list = await roots();
  if (list.length === 0) return;
  const key = fileKey(entry.id);
  for (const root of list) {
    try {
      const roms = await root.getDirectoryHandle("roms", { create: true });
      await writeBlob(roms, `${key}.rom`, entry.blob);
      const index = await readIndex(root);
      const prev = index.pockets.find((row) => row.id === entry.id);
      await upsertIndex(root, {
        id: entry.id,
        name: entry.name,
        filename: entry.filename,
        consoleId: entry.consoleId,
        savedAt: prev?.savedAt ?? entry.addedAt,
        sessionMs: prev?.sessionMs,
        playedMs: prev?.playedMs,
        hasState: Boolean(prev?.hasState),
        hasSram: Boolean(prev?.hasSram),
        hasRom: true,
      });
    } catch {
      /* ignore */
    }
  }
}

export async function hydrateFromDisk(): Promise<number> {
  const { getSave, putSave, rememberRom } = await import("@/lib/library");
  let imported = 0;
  for (const root of await roots()) {
    const index = await readIndex(root);
    const saves = await root.getDirectoryHandle("saves", { create: true }).catch(() => null);
    const roms = await root.getDirectoryHandle("roms", { create: true }).catch(() => null);
    if (!saves) continue;
    for (const row of index.pockets) {
      try {
        const existing = await getSave(row.id);
        if (existing && existing.savedAt >= row.savedAt) continue;
        const state = await readBlob(saves, `${fileKey(row.id)}.state`);
        if (!state) continue;
        const sram = await readBlob(saves, `${fileKey(row.id)}.sram`);
        await putSave({
          id: row.id,
          version: 1,
          consoleId: row.consoleId,
          name: row.name,
          state,
          sram: sram ?? undefined,
          savedAt: row.savedAt,
          sessionMs: row.sessionMs,
          playedMs: row.playedMs,
        });
        if (roms) {
          const rom = await readBlob(roms, `${fileKey(row.id)}.rom`);
          if (rom && rom.size > 0) {
            await rememberRom({
              id: row.id,
              name: row.name,
              filename: row.filename ?? `${row.id}.bin`,
              consoleId: row.consoleId,
              blob: rom,
              addedAt: row.savedAt,
            });
          }
        }
        imported += 1;
      } catch {
        /* skip one pocket */
      }
    }
  }
  if (imported > 0) emit();
  return imported;
}

export function diskCopy(kindNow: VaultKind = kind): string {
  if (kindNow === "folder") return "this hard drive";
  if (kindNow === "opfs") return "this computer";
  return "this device";
}
