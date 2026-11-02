// offer-door: the offer page's door (offer.maharamedia.com). Deployed with
// verify_jwt = false, so every route checks its own way in (handler.ts).
// Secrets are read by name, never printed:
//   OFFER_IP_SALT, optionally OFFER_SITE_URL,
//   plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the platform.
// A missing one closes its routes (a 503 in the page's own shape, or /?error=1
// for a video link); the plain sentence naming it goes to the status row, the
// log and /health, never to a client. The name stays neutral (no "upsell"):
// a client's browser can show this function's address during a redirect.

import { RateLimiter } from "../sales-live/door.ts";
import { redact } from "../sales-live/util.ts";
import { makeHandler } from "./handler.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

/** Work that finishes after the answer has gone back (EdgeRuntime.waitUntil where it exists). Never throws. */
function background(p: Promise<unknown>): void {
  const safe = p.catch(e => console.error("offer-door background work failed", redact((e as Error)?.message ?? e)));
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
    // Per running instance, as sales-live: 30 a minute per salted address
    // and device, and 120 a minute per address (two tabs, a family on one Wi-Fi).
    limiter: new RateLimiter(30, 60_000, 10_000),
    wideLimiter: new RateLimiter(120, 60_000, 10_000),
    log: line => console.error(redact(line)),
  }),
);
