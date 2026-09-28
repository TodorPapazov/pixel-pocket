import { createFileRoute } from "@tanstack/react-router";
import { ARCHIVE_ID_RE } from "@/lib/archive";

export const Route = createFileRoute("/api/archive")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id")?.trim() || "";
        if (!ARCHIVE_ID_RE.test(id)) {
          return new Response("Bad archive id", { status: 400 });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const upstream = await fetch(
            `https://archive.org/metadata/${encodeURIComponent(id)}`,
            {
              signal: controller.signal,
              headers: { Accept: "application/json" },
            },
          );
          if (!upstream.ok) {
            return new Response(`Archive.org lookup failed (${upstream.status})`, {
              status: 502,
            });
          }
          const len = Number(upstream.headers.get("content-length") || "0");
          if (len > 8 * 1024 * 1024) {
            return new Response("That cabinet listing is too large.", { status: 413 });
          }
          const data = await upstream.arrayBuffer();
          if (data.byteLength > 8 * 1024 * 1024) {
            return new Response("That cabinet listing is too large.", { status: 413 });
          }
          return new Response(data, {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          });
        } catch {
          return new Response("Could not reach Archive.org.", { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
