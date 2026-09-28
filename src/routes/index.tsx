import { createFileRoute } from "@tanstack/react-router";
import { BootScreen } from "@/components/boot-screen";
import { ConsoleSelect } from "@/components/console-select";
import { LoadGame } from "@/components/load-game";
import { PlayScreen } from "@/components/play-screen";
import { usePocket } from "@/lib/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const phase = usePocket((s) => s.phase);

  return (
    <main className="app-shell bg-bg text-fg">
      {phase === "boot" && <BootScreen />}
      {phase === "select" && <ConsoleSelect />}
      {phase === "load" && <LoadGame />}
      {phase === "playing" && <PlayScreen />}
    </main>
  );
}