import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sql = await getSql();
          const users = await sql<{ n: number }>`select count(*)::int as n from "user"`;
          const pockets = await sql<{ n: number }>`select count(*)::int as n from pockets`;
          return Response.json({
            players: users[0]?.n ?? 0,
            pockets: pockets[0]?.n ?? 0,
          });
        } catch {
          return Response.json({ players: 0, pockets: 0 });
        }
      },
    },
  },
});
