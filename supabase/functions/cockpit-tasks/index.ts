// cockpit-tasks: the task mirror and alerts for every seat
// (docs/requests/CONTRACT.md section 5; README.md here). Deployed with the
// JWT check OFF: pg_cron (mahara-task-mirror every 2 minutes,
// mahara-task-mirror-seats hourly at :11) reaches it with x-cron-secret
// (vault cockpit_tasks_cron_secret = function secret TASKS_CRON_SECRET), and
// a signed-in cockpit reaches the focus view's read with its own JWT, which
// the door checks with auth/v1/user and passes to the database. It reads
// ClickUp with CLICKUP_API_TOKEN, GET only, and never writes to ClickUp.
// Every ClickUp call is receipted in cockpit_media_provider_health. Secrets
// are read by name and never written anywhere.
import { makeTasksDoor, realDeps } from "./door.ts";

const env = (name: string) => Deno.env.get(name) || undefined;
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(
  makeTasksDoor(
    realDeps(env, fetch, work => {
      const background = runtime.EdgeRuntime?.waitUntil;
      if (background) background(work);
    }),
  ),
);
