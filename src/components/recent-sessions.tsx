import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CONSOLE_BY_ID } from "@/lib/consoles";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  formatPlayed,
  formatSessionDay,
  listSaveMeta,
  type SaveMeta,
} from "@/lib/library";
import { listCloudPockets } from "@/lib/cloud";
import { loadPocketGame } from "@/lib/resume";
import { clickBeep, playVoice, tapHaptic, unlockAudio } from "@/lib/sound";
import { mergePocketLists, onPocketSync } from "@/lib/sync";
import { usePocket } from "@/lib/store";

export function RecentSessions() {
  const startGame = usePocket((s) => s.startGame);
  const { user, isPending } = useCurrentUserState();
  const [rows, setRows] = useState<SaveMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;
    const load = () => {
      void (async () => {
        const local = await listSaveMeta().catch(() => [] as SaveMeta[]);
        let cloud = null;
        if (user) {
          try {
            cloud = await listCloudPockets();
          } catch {
            cloud = null;
          }
        }
        const merged = await mergePocketLists(local, cloud);
        if (!cancelled) setRows(merged.slice(0, 8));
      })();
    };
    load();
    const off = onPocketSync(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [isPending, user?.id]);

  if (rows.length === 0 && !error && !user) return null;

  async function openSession(row: SaveMeta) {
    if (busy) return;
    setError(null);
    setBusy(row.name);
    try {
      await unlockAudio();
      tapHaptic(18);
      clickBeep();
      const game = await loadPocketGame(row.id);
      playVoice("/audio/loaded.mp3");
      startGame(game);
    } catch (err) {
      playVoice("/audio/error.mp3");
      setError(err instanceof Error ? err.message : "Could not open that session.");
      setBusy(null);
    }
  }

  if (rows.length === 0 && user) {
    return (
      <section className="session-strip shrink-0 px-5 pb-3 pt-1 min-[700px]:mx-auto min-[700px]:w-full min-[700px]:max-w-[52rem] min-[1024px]:max-w-[72rem]">
        <h2 className="font-display text-sm text-fg">Recent sessions</h2>
        <p className="mb-1 text-xs text-muted">
          Play on this device and it shows up on your phone, iPad, and computer.
        </p>
      </section>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section className="session-strip shrink-0 px-5 pb-3 pt-1 min-[700px]:mx-auto min-[700px]:w-full min-[700px]:max-w-[52rem] min-[1024px]:max-w-[72rem]">
      <h2 className="font-display text-sm text-fg">Recent sessions</h2>
      <p className="mb-2 text-xs text-muted">
        {user
          ? "Tap a save. Same list on every device you sign in with."
          : "Tap a save. Sign in to keep this list on every device."}
      </p>
      <ul className="session-row flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-[700px]:grid min-[700px]:grid-cols-2 min-[700px]:overflow-visible min-[1024px]:grid-cols-3">
        {rows.map((row) => {
          const def = CONSOLE_BY_ID[row.consoleId];
          const played = formatPlayed(row.playedMs) || formatPlayed(row.sessionMs);
          return (
            <li key={row.id} className="min-w-[16.5rem] flex-1 min-[700px]:min-w-0">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void openSession(row)}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left ring-1 ring-border transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
              >
                <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-raised ring-1 ring-border">
                  <img
                    src={def?.image ?? "/images/mascot.jpg"}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{row.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {formatSessionDay(row.savedAt)} · {def?.short ?? row.consoleId}
                    {played ? ` · ${played}` : ""}
                  </span>
                  {row.device ? (
                    <span className="block truncate text-[0.65rem] text-faint">
                      Last on {row.device}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {busy ? (
        <p className="mt-2 text-xs text-muted">Opening {busy}…</p>
      ) : error ? (
        <p className="mt-2 text-xs text-accent">{error}</p>
      ) : !user ? (
        <Link to="/login" className="mt-2 inline-block text-xs text-muted underline-offset-2 hover:underline">
          Sign in so this list follows you.
        </Link>
      ) : null}
    </section>
  );
}