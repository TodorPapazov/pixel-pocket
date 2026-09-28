import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";

export const playerCount = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const sql = await getSql();
    const users = await sql<{ n: number }>`select count(*)::int as n from "user"`;
    const pockets = await sql<{ n: number }>`select count(*)::int as n from pockets`;
    return { players: users[0]?.n ?? 0, pockets: pockets[0]?.n ?? 0 };
  } catch {
    return { players: 0, pockets: 0 };
  }
});
