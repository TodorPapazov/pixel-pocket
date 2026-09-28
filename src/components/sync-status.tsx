import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { CloudOff, HardDrive, WifiOff } from "lucide-react";
import { diskKind, diskCopy, onDiskChange } from "@/lib/disk";
import { useDeskOS, useStandaloneApp, useWindowsRelease } from "@/lib/desktop";
import { useOnline, usePendingCount } from "@/lib/offline";
import { cn } from "@/lib/utils";

export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const online = useOnline();
  const pending = usePendingCount();
  const vault = useSyncExternalStore(onDiskChange, diskKind, () => "none" as const);
  const standalone = useStandaloneApp();
  const os = useDeskOS();
  const release = useWindowsRelease();
  const desk = os === "windows" || os === "mac";

  if (!online) {
    return (
      <p
        className={cn(
          "flex items-center gap-2 rounded-2xl bg-raised px-3 py-2 text-xs text-muted ring-1 ring-border",
          compact && "max-w-[14rem]",
        )}
      >
        <WifiOff className="size-3.5 shrink-0 text-accent" />
        <span className="min-w-0 truncate">
          Offline · saved on {diskCopy(vault)}
          {pending ? ` · ${pending} waiting` : ""}
        </span>
      </p>
    );
  }

  if (pending > 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-raised px-3 py-2 text-xs text-muted ring-1 ring-border">
        <CloudOff className="size-3.5 shrink-0 text-accent" />
        <span className="min-w-0 truncate">
          {pending} pocket{pending === 1 ? "" : "s"} waiting for Wi-Fi
        </span>
      </p>
    );
  }

  if (standalone || vault === "folder") {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-raised px-3 py-2 text-xs text-muted ring-1 ring-border">
        <HardDrive className="size-3.5 shrink-0 text-ok" />
        <span className="min-w-0 truncate">On {diskCopy(vault)} · syncs when online</span>
      </p>
    );
  }

  if (desk && !compact) {
    return (
      <Link
        to="/desktop"
        className="flex h-12 items-center gap-2 rounded-2xl bg-raised px-3 text-xs text-muted ring-1 ring-border"
      >
        <HardDrive className="size-3.5 shrink-0" />
        Get the {os === "mac" ? "Mac" : release === "10" ? "Windows 10" : release === "11" ? "Windows 11" : "Windows"} app
      </Link>
    );
  }

  return null;
}
