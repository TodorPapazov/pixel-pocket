import { authEnabled } from "@/lib/auth/client";
import {
  hasRomBlob,
  listCloudPockets,
  pullCloudPocket,
  putRomBlob,
  pushCloudPocket,
  saveCloudProfile,
  type CloudPocket,
  type CloudPocketMeta,
} from "@/lib/cloud";
import { deviceLabel } from "@/lib/device";
import {
  getRom,
  getSave,
  listSaveMeta,
  putSave,
  rememberRom,
  type SaveMeta,
} from "@/lib/library";
import { dequeuePending, enqueuePending, listPending } from "@/lib/queue";
import type { ConsoleId } from "@/lib/consoles";

const MAX_ROM_BYTES = 4 * 1024 * 1024;
const SYNC_EVENT = "pocket-sync";

export function emitPocketSync(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SYNC_EVENT));
}

export function onPocketSync(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SYNC_EVENT, fn);
  return () => window.removeEventListener(SYNC_EVENT, fn);
}

export async function blobToB64(value: Blob | ArrayBuffer | undefined | null): Promise<string | null> {
  if (!value) return null;
  const buf = value instanceof Blob ? await value.arrayBuffer() : value;
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToBlob(b64: string | null | undefined, type = "application/octet-stream"): Blob | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

export async function sha256Hex(value: Blob | ArrayBuffer): Promise<string | null> {
  try {
    const buf = value instanceof Blob ? await value.arrayBuffer() : value;
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  return e.status === 401 || e.message === "Unauthorized";
}

async function applyCloud(pocket: CloudPocket): Promise<boolean> {
  const state = b64ToBlob(pocket.stateB64);
  if (!state) return false;
  const prev = await getSave(pocket.id).catch(() => null);
  await putSave({
    id: pocket.id,
    version: 1,
    consoleId: pocket.consoleId,
    name: pocket.name,
    state,
    sram: b64ToBlob(pocket.sramB64) ?? undefined,
    savedAt: pocket.savedAt,
    rev: pocket.rev,
    romHash: pocket.romHash ?? undefined,
    device: pocket.device ?? undefined,
    syncedAt: Date.now(),
    sessionMs: pocket.sessionMs,
    playedMs: Math.max(pocket.playedMs ?? 0, prev?.playedMs ?? 0),
  });
  const rom = b64ToBlob(pocket.romB64);
  if (rom && rom.size > 0) {
    await rememberRom({
      id: pocket.id,
      name: pocket.name,
      filename: pocket.filename,
      consoleId: pocket.consoleId,
      blob: rom,
      addedAt: pocket.savedAt,
    });
  }
  return true;
}

async function applyCloudId(id: string): Promise<boolean> {
  const pocket = await pullCloudPocket({ data: { id } });
  if (!pocket) return false;
  return applyCloud(pocket);
}

async function forkLocal(save: NonNullable<Awaited<ReturnType<typeof getSave>>>, label: string) {
  const forkId = `${save.id}~${label.replace(/\s+/g, "")}`.slice(0, 220);
  if (forkId === save.id) return;
  const existing = await getSave(forkId);
  if (existing) return;
  const rom = await getRom(save.id);
  await putSave({
    ...save,
    id: forkId,
    name: `${save.name} (${label})`,
    rev: undefined,
    syncedAt: undefined,
  });
  if (rom) {
    await rememberRom({ ...rom, id: forkId, name: `${rom.name} (${label})` });
  }
}

export async function pushLocalPocket(opts: {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  savedAt: number;
  state: Blob;
  sram?: Blob | null;
  rom?: Blob | null;
  sessionMs?: number;
  playedMs?: number;
}): Promise<boolean> {
  if (!authEnabled) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueuePending(opts.id);
    return false;
  }
  try {
    const prev = await getSave(opts.id);
    const stateB64 = await blobToB64(opts.state);
    if (!stateB64) return false;
    const sramB64 = await blobToB64(opts.sram ?? undefined);
    let romHash: string | null = prev?.romHash ?? null;
    if (opts.rom && opts.rom.size > 0 && opts.rom.size <= MAX_ROM_BYTES) {
      romHash = (await sha256Hex(opts.rom)) ?? romHash;
      if (romHash) {
        const known = await hasRomBlob({ data: { hash: romHash } }).catch(() => false);
        if (!known) {
          const romB64 = await blobToB64(opts.rom);
          if (romB64) {
            await putRomBlob({
              data: {
                hash: romHash,
                filename: opts.filename,
                consoleId: opts.consoleId,
                romB64,
              },
            });
          }
        }
      }
    }
    const playedMs = Math.max(
      opts.playedMs ?? 0,
      prev?.playedMs ?? 0,
    );
    const device = deviceLabel();
    const result = await pushCloudPocket({
      data: {
        id: opts.id,
        name: opts.name,
        filename: opts.filename,
        consoleId: opts.consoleId,
        stateB64,
        sramB64,
        romHash,
        device,
        baseRev: prev?.rev ?? null,
        sessionMs: opts.sessionMs ?? prev?.sessionMs ?? 0,
        playedMs,
      },
    });
    if (result.ok) {
      await putSave({
        id: opts.id,
        version: 1,
        consoleId: opts.consoleId,
        name: opts.name,
        state: opts.state,
        sram: opts.sram ?? undefined,
        savedAt: result.savedAt,
        rev: result.rev,
        romHash: romHash ?? undefined,
        device,
        syncedAt: Date.now(),
        sessionMs: opts.sessionMs ?? prev?.sessionMs,
        playedMs,
      });
      dequeuePending(opts.id);
      emitPocketSync();
      return true;
    }
    if (prev) await forkLocal(prev, device);
    await applyCloudId(result.id);
    emitPocketSync();
    return true;
  } catch (err) {
    if (isUnauthorized(err)) return false;
    enqueuePending(opts.id);
    console.warn("pocket push failed", err);
    return false;
  }
}

export async function flushPendingPockets(): Promise<{ ok: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: 0 };
  if (!authEnabled) return { ok: 0 };
  let ok = 0;
  for (const id of listPending()) {
    const done = await pushSavedId(id);
    if (done) {
      dequeuePending(id);
      ok += 1;
    }
  }
  if (ok) emitPocketSync();
  return { ok };
}

export async function pushSavedId(id: string): Promise<boolean> {
  const save = await getSave(id);
  if (!save?.state) return false;
  const rom = await getRom(id);
  return pushLocalPocket({
    id: save.id,
    name: save.name,
    filename: rom?.filename ?? `${save.id}.bin`,
    consoleId: save.consoleId,
    savedAt: save.savedAt,
    state: save.state,
    sram: save.sram,
    rom: rom?.blob ?? null,
    sessionMs: save.sessionMs,
    playedMs: save.playedMs,
  });
}

async function fillRom(id: string): Promise<boolean> {
  const pocket = await pullCloudPocket({ data: { id } });
  const rom = b64ToBlob(pocket?.romB64);
  if (!pocket || !rom || rom.size === 0) return false;
  await rememberRom({
    id: pocket.id,
    name: pocket.name,
    filename: pocket.filename,
    consoleId: pocket.consoleId,
    blob: rom,
    addedAt: pocket.savedAt,
  });
  return true;
}

export async function syncPocketsFromCloud(): Promise<{ pulled: number; pushed: number }> {
  if (!authEnabled) return { pulled: 0, pushed: 0 };
  let pulled = 0;
  let pushed = 0;
  try {
    const [cloud, local] = await Promise.all([listCloudPockets(), listSaveMeta()]);
    const localById = new Map(local.map((s) => [s.id, s]));

    for (const row of cloud) {
      const here = localById.get(row.id);
      const localRev = here?.rev ?? -1;
      if (!here) {
        if (await applyCloudId(row.id)) pulled += 1;
        continue;
      }
      if (row.rev > localRev) {
        if (!here.synced) {
          const save = await getSave(row.id);
          if (save) await forkLocal(save, deviceLabel());
        }
        if (await applyCloudId(row.id)) pulled += 1;
        continue;
      }
      if (row.hasRom && !(await getRom(row.id))) {
        if (await fillRom(row.id)) pulled += 1;
      }
    }

    const latestLocal = await listSaveMeta();
    const latestCloud = new Map(cloud.map((s) => [s.id, s]));
    for (const row of latestLocal) {
      const there = latestCloud.get(row.id);
      if (!there || !row.synced) {
        const ok = await pushSavedId(row.id);
        if (ok) pushed += 1;
      }
    }
    emitPocketSync();
  } catch (err) {
    if (!isUnauthorized(err)) console.warn("pocket sync failed", err);
  }
  return { pulled, pushed };
}

export async function ensurePlayerName(name: string | null | undefined): Promise<void> {
  const trimmed = name?.trim();
  if (!trimmed) return;
  try {
    await saveCloudProfile({ data: { name: trimmed } });
  } catch (err) {
    if (!isUnauthorized(err)) console.warn("profile save failed", err);
  }
}

export type MergedPocket = SaveMeta & { filename?: string; cloud: boolean };

function withPlayed(row: MergedPocket, other?: { playedMs?: number }): MergedPocket {
  return {
    ...row,
    playedMs: Math.max(row.playedMs ?? 0, other?.playedMs ?? 0),
  };
}

export async function mergePocketLists(
  local: SaveMeta[],
  cloud: CloudPocketMeta[] | null,
): Promise<MergedPocket[]> {
  const map = new Map<string, MergedPocket>();
  for (const row of cloud ?? []) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      consoleId: row.consoleId,
      savedAt: row.savedAt,
      filename: row.filename,
      cloud: true,
      rev: row.rev,
      device: row.device ?? undefined,
      synced: true,
      sessionMs: row.sessionMs,
      playedMs: row.playedMs,
    });
  }
  for (const row of local) {
    const prev = map.get(row.id);
    if (!prev || (row.rev ?? 0) >= (prev.rev ?? 0) || row.savedAt >= prev.savedAt) {
      map.set(row.id, withPlayed({ ...row, filename: prev?.filename, cloud: Boolean(prev) }, prev));
    } else {
      map.set(row.id, withPlayed(prev, row));
    }
  }
  return [...map.values()].sort((a, b) => b.savedAt - a.savedAt);
}

/** Pull this pocket onto the device so another screen can pick up the same save. */
export async function ensurePocketLocal(id: string): Promise<boolean> {
  if (!authEnabled) return Boolean(await getSave(id));
  const local = await getSave(id);
  const rom = await getRom(id);
  const complete = Boolean(local?.state && local.state.size > 0 && rom);
  if (complete && !local?.syncedAt) return true;
  try {
    const cloud = await pullCloudPocket({ data: { id } });
    if (!cloud) return complete;
    if (!complete || cloud.rev > (local?.rev ?? -1)) return applyCloud(cloud);
    if (cloud.playedMs > (local?.playedMs ?? 0) && local) {
      await putSave({ ...local, playedMs: cloud.playedMs });
    }
    return true;
  } catch {
    return complete;
  }
}
