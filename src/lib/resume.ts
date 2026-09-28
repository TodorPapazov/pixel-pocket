import { getRom, getSave, rememberRom } from "@/lib/library";
import { b64ToBlob, ensurePocketLocal } from "@/lib/sync";
import { pullCloudPocket } from "@/lib/cloud";
import type { LoadedGame } from "@/lib/store";

/** Resolve a pocket into a playable cartridge without picking a console first. */
export async function loadPocketGame(id: string): Promise<LoadedGame> {
  await ensurePocketLocal(id).catch(() => false);

  const row = await getRom(id);
  if (row) {
    return {
      id: row.id,
      name: row.name,
      filename: row.filename,
      consoleId: row.consoleId,
      file: new File([row.blob], row.filename, {
        type: "application/octet-stream",
      }),
      resume: true,
    };
  }

  try {
    const cloud = await pullCloudPocket({ data: { id } });
    const rom = b64ToBlob(cloud?.romB64);
    if (cloud && rom && rom.size > 0) {
      await rememberRom({
        id: cloud.id,
        name: cloud.name,
        filename: cloud.filename,
        consoleId: cloud.consoleId,
        blob: rom,
        addedAt: Date.now(),
      }).catch(() => undefined);
      return {
        id: cloud.id,
        name: cloud.name,
        filename: cloud.filename,
        consoleId: cloud.consoleId,
        file: new File([rom], cloud.filename, {
          type: "application/octet-stream",
        }),
        resume: true,
      };
    }
  } catch {
    /* guest, or the cart was never small enough to sync */
  }

  const save = await getSave(id);
  if (save) {
    throw new Error(
      `The ${save.name} cartridge is not on this device. Open that deck and load the file again — the pocket is still waiting.`,
    );
  }
  throw new Error("That session is gone.");
}