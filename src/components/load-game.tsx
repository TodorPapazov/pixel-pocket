import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ClipboardPaste, History, Link2, Search, Upload } from "lucide-react";
import { ACCEPT_ATTR, CONSOLE_BY_ID, archiveFolderUrl, type ConsoleId } from "@/lib/consoles";
import {
  archiveCorsFileUrl,
  archiveGameLabel,
  fetchArchiveCatalog,
  filterArchiveGames,
  isArchiveCatalogLink,
  parseArchiveLink,
  prettyArchiveTitle,
  type ArchiveCatalog,
  type ArchiveGame,
} from "@/lib/archive";
import { libretroBoxUrls } from "@/lib/box-art";
import {
  formatSavedAt,
  formatPlayed,
  listRoms,
  listSaveMeta,
  rememberRom,
  type SaveMeta,
  type StoredRomMeta,
} from "@/lib/library";
import { fileFromUpload, fileFromUrl, formatBytes, PERSIST_MAX_BYTES, RomError } from "@/lib/rom";
import { clickBeep, playVoice, tapHaptic, unlockAudio } from "@/lib/sound";
import { AccountBar } from "@/components/account-bar";
import { loadPocketGame } from "@/lib/resume";
import { listCloudPockets } from "@/lib/cloud";
import { mergePocketLists, onPocketSync, syncPocketsFromCloud } from "@/lib/sync";
import { usePocket, type LoadedGame } from "@/lib/store";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { isOnline, useOnline } from "@/lib/offline";

export function LoadGame() {
  const consoleId = usePocket((s) => s.consoleId);
  const backToSelect = usePocket((s) => s.backToSelect);
  const startGame = usePocket((s) => s.startGame);
  const def = consoleId ? CONSOLE_BY_ID[consoleId] : null;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [catalog, setCatalog] = useState<ArchiveCatalog | null>(null);
  const [cabinetQuery, setCabinetQuery] = useState("");
  const [shelfCount, setShelfCount] = useState(36);
  const [pendingGame, setPendingGame] = useState<ArchiveGame | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const fetchingTitle = useRef("");
  const [recents, setRecents] = useState<StoredRomMeta[]>([]);
  const [pockets, setPockets] = useState<SaveMeta[]>([]);
  const user = useCurrentUser();
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const loadGen = useRef(0);
  const [kbInset, setKbInset] = useState(0);
  const [vvTop, setVvTop] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setVvTop(Math.max(0, Math.round(vv.offsetTop)));
      setKbInset(
        Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
      );
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("focusin", sync);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("focusin", sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshPockets = async () => {
      const local = await listSaveMeta(consoleId ?? undefined).catch(() => [] as SaveMeta[]);
      let cloud = null;
      if (user) {
        try {
          const all = await listCloudPockets();
          cloud = consoleId ? all.filter((row) => row.consoleId === consoleId) : all;
        } catch {
          cloud = null;
        }
      }
      const merged = await mergePocketLists(local, cloud);
      if (!cancelled) setPockets(merged);
    };
    void (async () => {
      try {
        const rows = await listRoms();
        if (!cancelled) {
          setRecents(rows.filter((r) => !consoleId || r.consoleId === consoleId));
        }
      } catch {
        /* */
      }
      try {
        if (user) await syncPocketsFromCloud();
        await refreshPockets();
      } catch {
        /* */
      }
    })();
    const off = onPocketSync(() => {
      void refreshPockets();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [consoleId, user?.id]);

  useEffect(() => {
    setShelfCount(36);
  }, [catalog?.identifier, catalog?.title, cabinetQuery]);

  useEffect(() => {
    const el = moreRef.current;
    if (!el || !catalog) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShelfCount((n) => n + 36);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [catalog, cabinetQuery, shelfCount]);

  if (!def || !consoleId) return null;
  const selected = def;
  const pocketById = new Map(pockets.map((p) => [p.id, p]));
  const cabinetHits = catalog
    ? filterArchiveGames(catalog.games, cabinetQuery)
    : [];

  function reportProgress(p: { received: number; total: number }) {
    setProgress(p);
    const title = fetchingTitle.current;
    const bytes =
      p.total > 0
        ? `${formatBytes(p.received)} of ${formatBytes(p.total)}`
        : formatBytes(p.received);
    setBusy(title ? `${title} · ${bytes}` : `Fetching ${bytes}…`);
  }

  function closeCabinet() {
    loadGen.current += 1;
    fetchingTitle.current = "";
    setCatalog(null);
    setCabinetQuery("");
    setPendingGame(null);
    setBusy(null);
    setProgress(null);
    setActiveGameId(null);
  }

  async function play(game: LoadedGame) {
    await unlockAudio();
    tapHaptic(18);
    clickBeep();
    playVoice("/audio/loaded.mp3");
    if ((!game.files || game.files.length <= 1) && game.file.size <= PERSIST_MAX_BYTES) {
      try {
        await rememberRom({
          id: game.id,
          name: game.name,
          filename: game.filename,
          consoleId: game.consoleId,
          blob: game.file,
          addedAt: Date.now(),
        });
      } catch {
        /* quota — still play */
      }
    }
    startGame(game);
  }

  async function onDemo(fileUrl: string, filename: string, title: string, id: string) {
    setError(null);
    setBusy(title);
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error("Could not load that cart.");
      const blob = await res.blob();
      const file = new File([blob], filename, { type: "application/octet-stream" });
      await play({
        id,
        name: title,
        filename,
        consoleId: selected.id,
        file,
        resume: true,
      });
    } catch (e) {
      playVoice("/audio/error.mp3");
      setError(e instanceof Error ? e.message : "Could not load that cart.");
    } finally {
      setBusy(null);
    }
  }

  async function onUpload(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Reading…");
    setError(null);
    try {
      const { file, detected } = await fileFromUpload(list[0], selected.id);
      await play({
        id: `local-${file.name}-${file.size}`,
        name: file.name.replace(/\.[^.]+$/, "") || file.name,
        filename: file.name,
        consoleId: detected,
        file,
        resume: true,
      });
    } catch (e) {
      playVoice("/audio/error.mp3");
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(null);
    }
  }

  async function playDirect(raw: string, fileName?: string) {
    if (!isOnline()) {
      setError("You're offline. Play a cartridge already on this computer, or wait for Wi-Fi.");
      return;
    }
    const gen = ++loadGen.current;
    fetchingTitle.current = fileName || "ROM";
    setBusy("Fetching…");
    setError(null);
    try {
      const { file, detected } = await fileFromUrl(
        raw,
        selected.id,
        reportProgress,
        fileName,
      );
      if (gen !== loadGen.current) return;
      await play({
        id: `url-${file.name}-${file.size}`,
        name: file.name.replace(/\.[^.]+$/, "") || file.name,
        filename: file.name,
        consoleId: detected,
        file,
        resume: true,
      });
    } catch (err) {
      if (gen !== loadGen.current) return;
      playVoice("/audio/error.mp3");
      setError(err instanceof Error ? err.message : "Could not load that disc.");
    } finally {
      if (gen === loadGen.current) {
        fetchingTitle.current = "";
        setBusy(null);
        setProgress(null);
      }
    }
  }

  async function openCabinet(raw: string) {
    if (!isOnline()) {
      setError("You're offline. Cabinets on archive.org need Wi-Fi. Continue a pocket on this computer instead.");
      return;
    }
    const link = parseArchiveLink(raw);
    if (!link) {
      await playDirect(raw.trim());
      return;
    }
    if (link.fileName) {
      await playDirect(raw, link.fileName);
      return;
    }
    setBusy("Opening cabinet…");
    setError(null);
    setCatalog(null);
    setCabinetQuery("");
    try {
      const cat = await fetchArchiveCatalog(
        link.identifier,
        selected.id,
        selected.extensions,
        link.prefix,
      );
      setCatalog(cat);
      window.setTimeout(() => searchRef.current?.focus(), 80);
    } catch (err) {
      playVoice("/audio/error.mp3");
      setError(err instanceof Error ? err.message : "Could not open that cabinet.");
    } finally {
      setBusy(null);
    }
  }

  async function onSubmitLink() {
    const raw = url.trim();
    if (!raw) {
      setError("Paste a ROM, ISO, or Archive.org folder link.");
      return;
    }
    if (isArchiveCatalogLink(raw) || parseArchiveLink(raw)) {
      await openCabinet(raw);
      return;
    }
    await playDirect(raw);
  }

  async function playArchiveGame(game: ArchiveGame) {
    if (!isOnline()) {
      setError("You're offline. That download needs Wi-Fi.");
      return;
    }
    if (!catalog) return;
    const gen = ++loadGen.current;
    fetchingTitle.current = game.title;
    setActiveGameId(game.id);
    setBusy(game.title);
    setError(null);
    setPendingGame(null);
    try {
      const loaded: File[] = [];
      for (const part of game.files) {
        const { file } = await fileFromUrl(
          archiveCorsFileUrl(catalog.identifier, part.name),
          selected.id,
          reportProgress,
          part.name,
        );
        if (gen !== loadGen.current) return;
        loaded.push(file);
      }
      const primary = loaded[0];
      if (!primary) throw new RomError("That disc has no files.");
      await play({
        id: `ia-${catalog.identifier}-${game.id}`,
        name: game.title,
        filename: primary.name,
        consoleId: selected.id,
        file: primary,
        files: loaded,
        resume: true,
      });
    } catch (err) {
      if (gen !== loadGen.current) return;
      playVoice("/audio/error.mp3");
      setError(err instanceof Error ? err.message : "Could not load that disc.");
    } finally {
      if (gen === loadGen.current) {
        fetchingTitle.current = "";
        setActiveGameId(null);
        setBusy(null);
        setProgress(null);
      }
    }
  }

  function onPickGame(game: ArchiveGame) {
    if (game.files.length > 1) {
      setPendingGame(game);
      return;
    }
    void playArchiveGame(game);
  }

  async function onPasteLink() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        setError(null);
        tapHaptic(12);
        if (isArchiveCatalogLink(text)) {
          await openCabinet(text);
        }
        return;
      }
    } catch {
      /* native paste on the field */
    }
    urlRef.current?.focus();
  }

  async function onRecent(id: string) {
    setBusy("Loading…");
    setError(null);
    try {
      const game = await loadPocketGame(id);
      await play(game);
    } catch (e) {
      playVoice("/audio/error.mp3");
      setError(e instanceof Error ? e.message : "Could not open that game.");
    } finally {
      setBusy(null);
    }
  }

  async function onContinue(id: string) {
    setBusy("Opening pocket…");
    setError(null);
    try {
      const game = await loadPocketGame(id);
      await play(game);
    } catch (e) {
      playVoice("/audio/error.mp3");
      setError(
        e instanceof Error
          ? e.message
          : "Could not open that pocket.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-bg"
      style={{
        paddingBottom:
          kbInset > 24
            ? kbInset
            : "max(0.5rem, env(safe-area-inset-bottom))",
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        void onUpload(e.dataTransfer.files);
      }}
    >
      <div
        className="shrink-0 bg-bg"
        style={vvTop ? { transform: `translateY(${vvTop}px)` } : undefined}
      >
        <header className="pad-app-top pad-app-x flex items-center gap-3 pb-2">
          <button
            type="button"
            onClick={
              pendingGame
                ? () => setPendingGame(null)
                : catalog
                  ? closeCabinet
                  : backToSelect
            }
            aria-label="Back"
            className="hit grid size-12 place-items-center rounded-xl bg-surface text-fg ring-1 ring-border"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[0.65rem] tracking-[0.28em] text-muted">
              {selected.short}
            </p>
            <h1 className="truncate font-display text-xl text-fg">
              {pendingGame
                ? prettyArchiveTitle(pendingGame.title)
                : catalog
                  ? catalog.title
                  : "Load a game"}
            </h1>
          </div>
          <AccountBar compact />
        </header>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pad-app-x px-4 pb-4">
        {error && (
          <p className="mb-3 rounded-2xl bg-accent/15 px-3 py-2 text-sm text-accent ring-1 ring-accent/40">
            {error}
          </p>
        )}
        {!online && (
          <p className="mb-3 rounded-2xl bg-raised px-3 py-2 text-sm text-muted ring-1 ring-border">
            Offline — pockets and carts on this computer still play. New downloads wait for Wi-Fi.
          </p>
        )}
        {busy && (
          <p className="mb-3 text-sm text-muted">
            {busy}
            {progress && progress.total > 0 ? (
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-raised">
                <span
                  className="block h-full bg-accent"
                  style={{
                    width: `${Math.min(100, Math.round((progress.received / progress.total) * 100))}%`,
                  }}
                />
              </span>
            ) : null}
          </p>
        )}

        {catalog ? (
          <section className="sheet-copy">
            {pendingGame ? (
              <div className="rounded-2xl bg-surface p-4 ring-1 ring-border">
                <p className="text-sm text-muted">
                  {prettyArchiveTitle(pendingGame.title)} is {archiveGameLabel(pendingGame)}. Load both tracks?
                </p>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void playArchiveGame(pendingGame)}
                  className="mt-3 min-h-12 w-full rounded-2xl bg-fg px-4 font-display text-sm text-bg"
                >
                  Play
                </button>
              </div>
            ) : (
              <>
                <label className="mb-3 flex min-h-12 items-center gap-2 rounded-2xl bg-surface px-3 ring-1 ring-border">
                  <Search className="size-4 text-muted" />
                  <input
                    ref={searchRef}
                    value={cabinetQuery}
                    onChange={(e) => setCabinetQuery(e.target.value)}
                    placeholder="Search this shelf"
                    className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none"
                  />
                </label>
                <p className="mb-3 text-xs text-muted">
                  {cabinetHits.length} of {catalog.games.length} on the shelf. Scroll, or search.
                  Pixel Pocket does not host these files.
                </p>
                <ul className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-4">
                  {cabinetHits.slice(0, shelfCount).map((game) => (
                    <li key={game.id}>
                      <ShelfCard
                        game={game}
                        identifier={catalog.identifier}
                        consoleId={selected.id}
                        short={selected.short}
                        busy={Boolean(busy)}
                        loading={activeGameId === game.id}
                        onPick={() => onPickGame(game)}
                      />
                    </li>
                  ))}
                </ul>
                {shelfCount < cabinetHits.length ? <div ref={moreRef} className="h-8" /> : null}
                {cabinetHits.length === 0 && (
                  <p className="text-sm text-muted">No match on this shelf.</p>
                )}
              </>
            )}
          </section>
        ) : (
          <>
            <section className="sheet-copy mb-6">
              <label className="mb-1 block text-xs text-muted">ROM or folder link</label>
              {selected.extensions.includes("zip") && (
                <p className="mb-2 text-xs leading-relaxed text-muted">
                  Zip files on Dual Screen unpack automatically. The cartridge inside is what plays.
                </p>
              )}
              <textarea
                ref={urlRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                rows={2}
                placeholder="https://archive.org/details/…"
                className="min-h-16 w-full resize-none rounded-2xl bg-surface px-3 py-3 text-sm text-fg outline-none ring-1 ring-border"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void onSubmitLink()}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-fg px-3 font-display text-sm text-bg"
                >
                  <Link2 className="size-4" />
                  Load
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void onPasteLink()}
                  className="hit grid size-12 place-items-center rounded-2xl bg-surface text-fg ring-1 ring-border"
                  aria-label="Paste"
                >
                  <ClipboardPaste className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => fileRef.current?.click()}
                  className="hit grid size-12 place-items-center rounded-2xl bg-surface text-fg ring-1 ring-border"
                  aria-label="Upload"
                >
                  <Upload className="size-4" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => {
                    void onUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </section>

            {selected.cabinets.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-1 font-display text-sm text-muted">
                  Archive.org folders
                </h2>
                <p className="mb-3 text-xs leading-relaxed text-muted">
                  Tap a folder and scroll the shelf. Search only if you already know the name.
                  Pixel Pocket does not host these files.
                  {selected.extensions.includes("zip")
                    ? " Zip carts on this deck unpack and play the cartridge inside."
                    : ""}
                </p>
                <ul className="space-y-2">
                  {selected.cabinets.map((cab) => (
                    <li key={cab.identifier}>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          const link = archiveFolderUrl(cab.identifier, cab.folder);
                          setUrl(link);
                          void openCabinet(link);
                        }}
                        className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-surface px-3 py-3 text-left ring-1 ring-border transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-muted">
                          <Archive className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">
                            {cab.label}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {cab.hint}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {pockets.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-display text-sm text-muted">
                  Pick up where you left off
                </h2>
                <ul className="space-y-2">
                  {pockets.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void onContinue(p.id)}
                        className="flex w-full items-center gap-3 rounded-2xl bg-accent/15 px-3 py-3 text-left ring-1 ring-accent/40 transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-accent">
                          <History className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">{p.name}</span>
                          <span className="block truncate text-xs text-muted">
                            Continue · {formatSavedAt(p.savedAt)}
                            {formatPlayed(p.sessionMs)
                              ? ` · played ${formatPlayed(p.sessionMs)}`
                              : ""}
                            {p.synced ? " · synced" : " · on this device"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recents.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-display text-sm text-muted">On this deck</h2>
                <ul className="space-y-2">
                  {recents.map((r) => {
                    const pocket = pocketById.get(r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void onRecent(r.id)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-surface px-3 py-3 text-left ring-1 ring-border disabled:opacity-60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-fg">{r.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {r.filename}
                              {pocket ? ` · ${formatSavedAt(pocket.savedAt)}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {selected.demos.length > 0 && (
              <section className="mb-4">
                <h2 className="mb-2 font-display text-sm text-muted">Built-in carts</h2>
                <ul className="space-y-2">
                  {selected.demos.map((demo) => (
                    <li key={demo.id}>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void onDemo(demo.file, demo.filename, demo.title, demo.id)
                        }
                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-surface px-3 py-3 text-left ring-1 ring-border disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-fg">{demo.title}</span>
                          <span className="block truncate text-xs text-muted">{demo.note}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function titleHue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 33 + title.charCodeAt(i)) >>> 0;
  return h % 360;
}

function TitlePoster({ title, short }: { title: string; short: string }) {
  const hue = titleHue(title);
  return (
    <div
      className="flex h-full flex-col justify-between p-3"
      style={{
        background: `linear-gradient(165deg, hsl(${hue} 38% 46%), hsl(${(hue + 28) % 360} 32% 16%))`,
      }}
    >
      <span className="font-display text-[0.6rem] tracking-[0.2em] text-white/75">{short}</span>
      <span className="line-clamp-5 font-display text-sm leading-tight text-white">{title}</span>
    </div>
  );
}

function ShelfCard({
  game,
  identifier,
  consoleId,
  short,
  busy,
  loading,
  onPick,
}: {
  game: ArchiveGame;
  identifier: string;
  consoleId: ConsoleId;
  short: string;
  busy: boolean;
  loading: boolean;
  onPick: () => void;
}) {
  const title = prettyArchiveTitle(game.title);
  const sources = [
    game.art ? archiveCorsFileUrl(identifier, game.art) : "",
    ...libretroBoxUrls(consoleId, title),
  ].filter(Boolean);
  const [artIndex, setArtIndex] = useState(0);
  const art = sources[artIndex];

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onPick}
      className="flex w-full flex-col overflow-hidden rounded-2xl bg-surface text-left ring-1 ring-border transition-transform duration-150 active:scale-[0.98] disabled:opacity-60"
    >
      <span className="relative block aspect-[3/4] overflow-hidden bg-raised">
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onError={() => setArtIndex((n) => n + 1)}
          />
        ) : (
          <TitlePoster title={title} short={short} />
        )}
        {loading ? (
          <span className="absolute inset-x-0 bottom-0 bg-bg/80 px-2 py-1 text-center text-[0.65rem] text-accent">
            Loading
          </span>
        ) : null}
      </span>
      <span className="block px-2.5 py-2">
        <span className="line-clamp-2 text-xs leading-snug text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-[0.65rem] text-muted">
          {archiveGameLabel(game)}
        </span>
      </span>
    </button>
  );
}
