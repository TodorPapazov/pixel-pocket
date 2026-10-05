import { createFileRoute } from "@tanstack/react-router";
import { readPlayerAuthBody, type EmailAuthResult } from "@/lib/auth/email-account";

const FAILED = "Could not sign in. Try again.";

function jsonResult(result: EmailAuthResult, cookies: string[] = []): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  for (const line of cookies) {
    if (line) headers.append("set-cookie", line);
  }
  return new Response(JSON.stringify(result), { status: 200, headers });
}

export const Route = createFileRoute("/api/player-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { assertSameSiteRequest, CrossSiteRequestError } =
          await import("@/lib/auth/isolation.server");
        try {
          assertSameSiteRequest();
        } catch (err) {
          if (err instanceof CrossSiteRequestError) {
            return jsonResult({ ok: false, code: "failed", message: FAILED });
          }
          throw err;
        }

        let body: ReturnType<typeof readPlayerAuthBody>;
        try {
          body = readPlayerAuthBody(await request.json());
        } catch (err) {
          const message = err instanceof Error ? err.message : FAILED;
          return jsonResult({ ok: false, code: "failed", message });
        }

        const { registerWithPasscodeOnServer, signInWithPasscodeOnServer } =
          await import("@/lib/auth/email-account.server");
        const outcome =
          body.action === "register"
            ? await registerWithPasscodeOnServer(body)
            : await signInWithPasscodeOnServer(body);
        return jsonResult(outcome.result, outcome.cookies);
      },
    },
  },
});
