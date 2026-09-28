import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { ConsoleId } from "@/lib/consoles";

const CONSOLES = ["nes", "snes", "gb", "gba", "nds", "n64", "ps1"] as const;

export type CloudPocketMeta = {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  savedAt: number;
  hasRom: boolean;
  rev: number;
  romHash: string | null;
  device: string | null;
  sessionMs: number;
  playedMs: number;
};

export type CloudPocket = CloudPocketMeta & {
  stateB64: string;
  sramB64: string | null;
  romB64: string | null;
};

export type CloudProfile = {
  displayName: string;
};

export type PushResult =
  | { ok: true; rev: number; savedAt: number }
  | { ok: false; conflict: true; id: string; rev: number };

const MAX_STATE_CHARS = 2_800_000;
const MAX_ROM_CHARS = 5_600_000;

function asConsole(id: string): ConsoleId {
  return (CONSOLES as readonly string[]).includes(id) ? (id as ConsoleId) : "gb";
}

function stamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? t : Date.now();
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const getCloudProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{ display_name: string }>`
      select display_name from profiles where user_id = ${context.userId} limit 1
    `;
    return { displayName: rows[0]?.display_name ?? "" } satisfies CloudProfile;
  });

export const saveCloudProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const name =
      typeof raw === "string"
        ? raw
        : typeof (raw as { name?: unknown })?.name === "string"
          ? (raw as { name: string }).name
          : "";
    const displayName = name.trim().slice(0, 40);
    if (displayName.length < 1) throw new Error("Pick a short name.");
    return { displayName };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into profiles (user_id, display_name, updated_at)
      values (${context.userId}, ${data.displayName}, now())
      on conflict (user_id) do update
        set display_name = excluded.display_name,
            updated_at = now()
    `;
    return { displayName: data.displayName } satisfies CloudProfile;
  });

export const listCloudPockets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      game_id: string;
      name: string;
      filename: string;
      console_id: string;
      saved_at: unknown;
      rom_size: number;
      rev: number;
      rom_hash: string | null;
      device: string | null;
      session_ms: number;
      played_ms: number;
    }>`
      select game_id, name, filename, console_id, saved_at, rom_size, rev, rom_hash, device, session_ms, played_ms
      from pockets
      where user_id = ${context.userId}
      order by saved_at desc
    `;
    return rows.map(
      (r) =>
        ({
          id: r.game_id,
          name: r.name,
          filename: r.filename,
          consoleId: asConsole(r.console_id),
          savedAt: stamp(r.saved_at),
          hasRom: (r.rom_size ?? 0) > 0 || Boolean(r.rom_hash),
          rev: asInt(r.rev, 1),
          romHash: r.rom_hash,
          device: r.device,
          sessionMs: asInt(r.session_ms, 0),
          playedMs: asInt(r.played_ms, 0),
        }) satisfies CloudPocketMeta,
    );
  });

export const hasRomBlob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const hash =
      typeof raw === "string"
        ? raw
        : String((raw as { hash?: unknown })?.hash ?? "");
    return { hash: hash.trim().slice(0, 80) };
  })
  .handler(async ({ context, data }) => {
    if (!data.hash) return false;
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select 1 as n from rom_blobs
      where user_id = ${context.userId} and rom_hash = ${data.hash}
      limit 1
    `;
    return rows.length > 0;
  });

export const putRomBlob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = raw as { hash?: string; filename?: string; consoleId?: string; romB64?: string };
    const hash = String(v.hash ?? "").trim().slice(0, 80);
    const filename = String(v.filename ?? "game.bin").trim().slice(0, 180);
    const consoleId = asConsole(String(v.consoleId ?? "gb"));
    const romB64 = String(v.romB64 ?? "");
    if (!hash || !romB64) throw new Error("Missing cartridge.");
    if (romB64.length > MAX_ROM_CHARS) throw new Error("Cartridge is too large to sync.");
    return { hash, filename, consoleId, romB64 };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const romSize = Math.round((data.romB64.length * 3) / 4);
    await sql`
      insert into rom_blobs (user_id, rom_hash, filename, console_id, rom_b64, rom_size)
      values (${context.userId}, ${data.hash}, ${data.filename}, ${data.consoleId}, ${data.romB64}, ${romSize})
      on conflict (user_id, rom_hash) do nothing
    `;
    return { ok: true as const };
  });

export const pullCloudPocket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const id = typeof raw === "string" ? raw : String((raw as { id?: unknown })?.id ?? "");
    if (!id.trim()) throw new Error("Missing pocket.");
    return { id: id.trim().slice(0, 240) };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      game_id: string;
      name: string;
      filename: string;
      console_id: string;
      state_b64: string;
      sram_b64: string | null;
      rom_b64: string | null;
      rom_size: number;
      saved_at: unknown;
      rev: number;
      rom_hash: string | null;
      device: string | null;
      blob_b64: string | null;
      session_ms: number;
      played_ms: number;
    }>`
      select
        p.game_id, p.name, p.filename, p.console_id, p.state_b64, p.sram_b64,
        p.rom_b64, p.rom_size, p.saved_at, p.rev, p.rom_hash, p.device,
        b.rom_b64 as blob_b64, p.session_ms, p.played_ms
      from pockets p
      left join rom_blobs b
        on b.user_id = p.user_id and b.rom_hash = p.rom_hash
      where p.user_id = ${context.userId} and p.game_id = ${data.id}
      limit 1
    `;
    const r = rows[0];
    if (!r) return null;
    const romB64 = r.blob_b64 || r.rom_b64;
    return {
      id: r.game_id,
      name: r.name,
      filename: r.filename,
      consoleId: asConsole(r.console_id),
      savedAt: stamp(r.saved_at),
      hasRom: Boolean(romB64),
      rev: asInt(r.rev, 1),
      romHash: r.rom_hash,
      device: r.device,
      sessionMs: asInt(r.session_ms, 0),
      playedMs: asInt(r.played_ms, 0),
      stateB64: r.state_b64,
      sramB64: r.sram_b64,
      romB64,
    } satisfies CloudPocket;
  });

type PushInput = {
  id: string;
  name: string;
  filename: string;
  consoleId: ConsoleId;
  stateB64: string;
  sramB64?: string | null;
  romHash?: string | null;
  device?: string | null;
  baseRev?: number | null;
  sessionMs?: number | null;
  playedMs?: number | null;
};

export const pushCloudPocket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown) => {
    const v = raw as Partial<PushInput>;
    const id = String(v.id ?? "").trim().slice(0, 240);
    const name = String(v.name ?? "").trim().slice(0, 120) || "Game";
    const filename = String(v.filename ?? "").trim().slice(0, 180) || "game.bin";
    const consoleId = asConsole(String(v.consoleId ?? "gb"));
    const stateB64 = String(v.stateB64 ?? "");
    const sramB64 = v.sramB64 ? String(v.sramB64) : null;
    const romHash = v.romHash ? String(v.romHash).slice(0, 80) : null;
    const device = v.device ? String(v.device).slice(0, 40) : null;
    const baseRev = v.baseRev == null || v.baseRev === undefined ? null : Number(v.baseRev);
    const sessionMs = Math.max(0, Math.floor(Number(v.sessionMs) || 0));
    const playedMs = Math.max(0, Math.floor(Number(v.playedMs) || 0));
    if (!id) throw new Error("Missing pocket.");
    if (!stateB64) throw new Error("Empty pocket.");
    if (stateB64.length > MAX_STATE_CHARS) throw new Error("Pocket is too large to sync.");
    return { id, name, filename, consoleId, stateB64, sramB64, romHash, device, baseRev, sessionMs, playedMs };
  })
  .handler(async ({ context, data }): Promise<PushResult> => {
    const sql = await getSql();
    const existing = await sql<{ rev: number }>`
      select rev from pockets
      where user_id = ${context.userId} and game_id = ${data.id}
      limit 1
    `;
    const currentRev = existing[0] ? asInt(existing[0].rev, 1) : null;
    if (currentRev != null && (data.baseRev == null || data.baseRev !== currentRev)) {
      return { ok: false, conflict: true, id: data.id, rev: currentRev };
    }
    const nextRev = (currentRev ?? 0) + 1;
    const romSize = 0;
    await sql`
      insert into pockets (
        user_id, game_id, console_id, name, filename,
        state_b64, sram_b64, rom_b64, rom_size, saved_at, rev, rom_hash, device,
        session_ms, played_ms
      )
      values (
        ${context.userId}, ${data.id}, ${data.consoleId}, ${data.name}, ${data.filename},
        ${data.stateB64}, ${data.sramB64}, ${null}, ${romSize}, now(), ${nextRev}, ${data.romHash}, ${data.device},
        ${data.sessionMs}, ${data.playedMs}
      )
      on conflict (user_id, game_id) do update
        set console_id = excluded.console_id,
            name = excluded.name,
            filename = excluded.filename,
            state_b64 = excluded.state_b64,
            sram_b64 = excluded.sram_b64,
            saved_at = now(),
            rev = excluded.rev,
            rom_hash = coalesce(excluded.rom_hash, pockets.rom_hash),
            device = excluded.device,
            session_ms = excluded.session_ms,
            played_ms = greatest(pockets.played_ms, excluded.played_ms)
    `;
    return { ok: true, rev: nextRev, savedAt: Date.now() };
  });
