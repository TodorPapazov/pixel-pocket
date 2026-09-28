import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, FolderOpen, HardDrive, Monitor, Wifi } from "lucide-react";
import {
  captureInstallPrompt,
  desktopLabel,
  useCanPickFolder,
  useDeskOS,
  useWindowsRelease,
  hasInstallPrompt,
  useStandaloneApp,
  onDesktopChange,
  promptInstall,
} from "@/lib/desktop";
import { isLegacyWindowsEdge } from "@/lib/device";
import { diskKind, diskCopy, onDiskChange, pickVaultFolder, restoreVault } from "@/lib/disk";
import { useOnline } from "@/lib/offline";
import { cn } from "@/lib/utils";

captureInstallPrompt();

export function DesktopInstall() {
  const os = useDeskOS();
  const release = useWindowsRelease();
  const legacyEdge = useSyncExternalStore(
    () => () => undefined,
    () => isLegacyWindowsEdge(),
    () => false,
  );
  const online = useOnline();
  const vault = useSyncExternalStore(onDiskChange, diskKind, () => "none" as const);
  const promptReady = useSyncExternalStore(onDesktopChange, hasInstallPrompt, () => false);
  const standalone = useStandaloneApp();
  const folderOk = useCanPickFolder();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function install() {
    setNote(null);
    setBusy("Opening the installer…");
    const outcome = await promptInstall();
    setBusy(null);
    if (outcome === "accepted") {
      setNote("PIXEL POCKET is on this computer. Pick a folder so pockets land on the hard drive.");
      return;
    }
    if (outcome === "dismissed") {
      setNote("Install skipped. You can still play in this window.");
      return;
    }
    setNote(installHelp(os, release));
  }

  async function chooseFolder() {
    setNote(null);
    setBusy("Waiting for a folder…");
    try {
      await pickVaultFolder();
      await restoreVault();
      setNote("That folder is now the pocket drawer on this computer.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not use that folder.";
      if (/abort/i.test(msg)) setNote("No folder picked.");
      else setNote(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="pad-app-top pad-app-x flex items-center gap-3 pb-2">
        <Link
          to="/"
          className="hit grid size-12 place-items-center rounded-2xl bg-surface text-fg ring-1 ring-border"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <p className="font-display text-[0.65rem] tracking-[0.28em] text-muted">PIXEL POCKET</p>
          <h1 className="font-display text-2xl text-fg">Windows & Mac</h1>
        </div>
      </header>

      <div className="pad-app-x mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          Install PIXEL POCKET on this computer. Play with no Wi-Fi. Every pocket is written to disk.
          When the network comes back, signed-in progress uploads to the website — same player on phone,
          iPad, Windows 10, Windows 11, and Mac.
        </p>

        {legacyEdge && (
          <p className="rounded-2xl bg-raised px-4 py-3 text-sm text-fg ring-1 ring-border">
            This is the old Edge browser on Windows 10. It cannot install or play PIXEL POCKET.
            Open this page in the current Edge or in Chrome.
          </p>
        )}

        {standalone && (
          <p className="flex items-center gap-2 rounded-2xl bg-raised px-4 py-3 text-sm text-fg ring-1 ring-border">
            <Check className="size-4 text-ok" />
            This is the desktop app on {desktopLabel(os)}.
          </p>
        )}

        {!online && (
          <p className="rounded-2xl bg-raised px-4 py-3 text-sm text-muted ring-1 ring-border">
            You are offline. Cartridges already on {diskCopy(vault)} still play. New archive.org
            downloads wait for Wi-Fi.
          </p>
        )}

        <div className="grid gap-4 min-[800px]:grid-cols-2">
          <OsCard
            os="windows10"
            active={os === "windows" && release === "10"}
            image="/images/desktop-win.jpg"
            title="Windows 10"
            blurb="Edge or Chrome on Windows 10. Lands in the Start menu. The old Edge app cannot run it."
            steps={[
              "Open PIXEL POCKET in Edge or Chrome on Windows 10.",
              "Edge: menu → Apps → Install this site as an app. Chrome: the install icon in the address bar.",
              "Pick a folder such as Documents\\PIXEL POCKET.",
            ]}
          />
          <OsCard
            os="windows11"
            active={os === "windows" && release === "11"}
            image="/images/desktop-win.jpg"
            title="Windows 11"
            blurb="Edge or Chrome. Installs as its own window and stays in the Start menu."
            steps={[
              "Open PIXEL POCKET in Edge or Chrome.",
              "Install this site as an app — or tap the button below.",
              "Pick a folder such as Documents\\PIXEL POCKET.",
            ]}
          />
          <OsCard
            os="mac"
            active={os === "mac"}
            image="/images/desktop-mac.jpg"
            title="Mac"
            blurb="Chrome or Safari. Lives in the Dock. Same pockets as your phone once you sign in."
            steps={[
              "Open PIXEL POCKET in Chrome (best) or Safari.",
              "Chrome: Install PIXEL POCKET. Safari: File → Add to Dock.",
              "Pick a folder such as Documents/PIXEL POCKET.",
            ]}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {!standalone && (
            <button
              type="button"
              onClick={() => void install()}
              disabled={Boolean(busy)}
              className="flex h-12 flex-1 items-center justify-center rounded-[1.75rem] bg-fg px-5 font-display text-sm text-bg disabled:opacity-60"
            >
              {busy === "Opening the installer…"
                ? "Opening…"
                : promptReady
                  ? `Install on ${installTarget(os, release)}`
                  : "How to install"}
            </button>
          )}
          {folderOk && (
            <button
              type="button"
              onClick={() => void chooseFolder()}
              disabled={Boolean(busy)}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[1.75rem] bg-surface px-5 text-sm font-medium text-fg ring-1 ring-border disabled:opacity-60"
            >
              <FolderOpen className="size-4" />
              {vault === "folder" ? "Change save folder" : "Save to this hard drive"}
            </button>
          )}
        </div>

        {note && <p className="text-sm text-muted">{note}</p>}

        <ol className="grid gap-3 rounded-[1.75rem] bg-surface p-5 ring-1 ring-border sm:grid-cols-3">
          <Step
            icon={<Monitor className="size-4" />}
            n="01"
            title="Install"
            body="PIXEL POCKET becomes a real window on Windows 10, Windows 11, or Mac. It still works when the site tab is closed."
          />
          <Step
            icon={<HardDrive className="size-4" />}
            n="02"
            title="On disk"
            body="Pockets and cartridges write to the folder you pick — Explorer or Finder can see them."
          />
          <Step
            icon={<Wifi className="size-4" />}
            n="03"
            title="Then sync"
            body="Sign in once. When Wi-Fi returns, this computer uploads. Phone and iPad pick up the same games."
          />
        </ol>
      </div>
    </div>
  );
}

function installTarget(
  os: ReturnType<typeof useDeskOS>,
  release: ReturnType<typeof useWindowsRelease>,
): string {
  if (os === "mac") return "this Mac";
  if (release === "10") return "this Windows 10 PC";
  if (release === "11") return "this Windows 11 PC";
  if (os === "windows") return "this PC";
  return "this computer";
}

function installHelp(
  os: ReturnType<typeof useDeskOS>,
  release: ReturnType<typeof useWindowsRelease>,
): string {
  if (os === "mac") {
    return "In Chrome: menu → Save and share → Install PIXEL POCKET. In Safari: File → Add to Dock.";
  }
  if (release === "10" || isLegacyWindowsEdge()) {
    return "On Windows 10, use Edge or Chrome — not the old Edge. Edge: menu → Apps → Install this site as an app. Chrome: the install icon in the address bar.";
  }
  return "In Edge or Chrome: menu → Apps → Install this site as an app.";
}

function OsCard({
  os,
  active,
  image,
  title,
  blurb,
  steps,
}: {
  os: string;
  active: boolean;
  image: string;
  title: string;
  blurb: string;
  steps: string[];
}) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-[1.75rem] bg-surface ring-1 ring-border",
        active && "ring-fg/40",
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-raised">
        <img src={image} alt="" className="h-full w-full object-cover" />
        {active && (
          <span className="absolute left-3 top-3 rounded-full bg-bg/80 px-2.5 py-1 font-display text-[0.65rem] tracking-wider text-fg">
            This computer
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 px-4 py-4">
        <h2 className="font-display text-xl text-fg">{title}</h2>
        <p className="text-sm leading-relaxed text-muted">{blurb}</p>
        <ol className="mt-2 space-y-1.5 text-sm text-muted">
          {steps.map((step, i) => (
            <li key={os + i} className="flex gap-2">
              <span className="font-display text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function Step({
  icon,
  n,
  title,
  body,
}: {
  icon: ReactNode;
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col gap-2">
      <p className="flex items-center gap-2 font-display text-sm text-fg">
        <span className="grid size-8 place-items-center rounded-xl bg-raised text-muted">{icon}</span>
        <span className="text-faint">{n}</span>
        {title}
      </p>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}
