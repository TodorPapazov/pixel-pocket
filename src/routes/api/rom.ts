import { createFileRoute } from "@tanstack/react-router";
import { isIP } from "node:net";

const MAX_PROXY_BYTES = 16 * 1024 * 1024;

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254"
  ) {
    return true;
  }
  if (isIP(host) === 4 && isPrivateIPv4(host)) return true;
  if (isIP(host) === 6) {
    const h = host.toLowerCase();
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
      return true;
    }
  }
  return false;
}

export const Route = createFileRoute("/api/rom")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("url");
        if (!url) {
          return new Response("Missing url", { status: 400 });
        }
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return new Response("Bad url", { status: 400 });
        }
        if (parsed.protocol !== "https:") {
          return new Response("Only https links are allowed", { status: 400 });
        }
        if (isBlockedHost(parsed.hostname)) {
          return new Response("That host is not allowed", { status: 400 });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        try {
          const upstream = await fetch(parsed.toString(), {
            signal: controller.signal,
            redirect: "follow",
            headers: { Accept: "application/octet-stream,*/*" },
          });
          if (!upstream.ok) {
            return new Response(`Download failed (${upstream.status})`, {
              status: 502,
            });
          }
          const tooBig = new Response(
            "That file is too large to fetch through the link helper. Upload it, or use a direct https link.",
            { status: 413 },
          );
          const len = Number(upstream.headers.get("content-length") || "0");
          if (len > MAX_PROXY_BYTES) {
            return tooBig;
          }
          const reader = upstream.body?.getReader();
          if (!reader) {
            return new Response("Download failed (empty body)", { status: 502 });
          }
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_PROXY_BYTES) {
              await reader.cancel().catch(() => undefined);
              return tooBig;
            }
            chunks.push(value);
          }
          const buf = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            buf.set(c, offset);
            offset += c.byteLength;
          }
          const name =
            parsed.pathname.split("/").pop() || "game.rom";
          return new Response(buf, {
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
              "cache-control": "no-store",
            },
          });
        } catch {
          return new Response("Could not reach that link.", { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
