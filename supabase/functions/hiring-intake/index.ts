// JWT validation is off only for this signed webhook door. All routes require
// either provider HMAC or the existing cron secret. Missing secrets fail closed.
import { makeHandler } from "./handler.ts";
Deno.serve(
	makeHandler({ env: (key) => Deno.env.get(key) ?? "", fetch, now: Date.now }),
);
