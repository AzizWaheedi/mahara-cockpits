// sales-live: Zoom and Slack callbacks, the short link's door and the cron
// door. Deployed with verify_jwt = false, so every route checks its own key
// (see handler.ts). Secrets are read by name, never printed:
//   ZOOM_WEBHOOK_SECRET, SLACK_SIGNING_SECRET, IP_SALT, CRON_SECRET,
//   plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the platform.
// A missing one makes only its own routes answer 503 with a plain sentence.

import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";
import { redact } from "./util.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

/**
 * Work that finishes after the answer has gone back. Supabase keeps the
 * function alive for it through EdgeRuntime.waitUntil; where that is missing
 * (a local run), the promise simply runs on. Either way it never throws.
 */
function background(p: Promise<unknown>): void {
  const safe = p.catch(e => console.error("sales-live background work failed", redact((e as Error)?.message ?? e)));
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    EdgeRuntime.waitUntil(safe);
  }
}

Deno.serve(
  makeHandler({
    env: name => Deno.env.get(name) ?? "",
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    background,
    // Per running instance: 30 opens a minute per salted address and device,
    // and 120 a minute per address (two tabs, or a family on one Wi-Fi).
    limiter: new RateLimiter(30, 60_000, 10_000),
    wideLimiter: new RateLimiter(120, 60_000, 10_000),
    log: line => console.error(redact(line)),
  }),
);
