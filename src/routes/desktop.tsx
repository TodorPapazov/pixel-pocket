import { createFileRoute } from "@tanstack/react-router";
import { DesktopInstall } from "@/components/desktop-install";

export const Route = createFileRoute("/desktop")({ component: DesktopInstall });
