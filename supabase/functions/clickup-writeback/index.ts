// clickup-writeback: the ClickUp writes the paused media Convex deployment
// used to make, run natively on Supabase (Creative Triage bldgtotkfmhoxmlzowdx).
//
// Jobs (POST body {"job": ...}), each started by pg_cron with the shared
// secret from the vault (migration 20261009f_clickup_writeback_native.sql):
//   kpi       hourly at :05, 03-18 UTC  board KPI columns (convex writeback.pushMetrics)
//   log       every 2 minutes           decision / change comments, Ad Status moves and
//                                       cockpit billing edits on Clients - Mahara cards (billing.ts, 20261009j)
//   dosdonts  hourly at :35, 03-18 UTC  Do's & Don'ts clean format (convex dosDonts.tidyClient)
//   doctor    on demand                 secrets present (names only) and queue health
//
// Dry run by default: nothing reaches ClickUp unless the secret
// CLICKUP_WRITEBACK_APPLY is exactly "true". Secrets read by name:
// CLICKUP_API_TOKEN, META_SYSTEM_TOKEN (Ad Status read-back), CRON_SECRET,
// optional META_GRAPH_VERSION, CLICKUP_WRITEBACK_ONLY_TASKS (comma-separated
// task ids for a one-card live check) and CLICKUP_CALLS_PER_MINUTE. Every provider
// call goes through cockpit-media-api/tools.ts and lands in
// cockpit_media_provider_health. Nothing here logs a key.

import { providerTools } from "../cockpit-media-api/tools.ts";
import { type Deps, redact, runDoctor, runDosDonts, runKpi, runLog, pacer } from "./run.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function rest(base: string, key: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(path.startsWith("rpc/") ? {} : { Prefer: "return=minimal" }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req: Request) => {
  // Only the pg_cron job, which sends the shared secret from the vault, may run it.
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !given || given !== expected) return json({ ok: false, note: "not allowed" }, 401);
  // Values are used as set: the write gate compares CLICKUP_WRITEBACK_APPLY to "true" exactly.
  const env = (name: string) => Deno.env.get(name) || undefined;
  const url = env("SUPABASE_URL") ?? "";
  const service = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return json({ ok: false, note: "The Supabase connection variables are missing on this Edge Function." }, 500);
  let job = "";
  try {
    job = String((await req.json())?.job ?? "");
  } catch {
    return json({ ok: false, note: "Send a JSON body with a job: kpi, log, dosdonts or doctor." }, 400);
  }
  const deps: Deps = {
    env,
    rpc: (name, params = {}) => rest(url, service, `rpc/${name}`, params),
    providerFor: (actionId: string) =>
      providerTools(env, async row => {
        // A receipt that cannot be saved stops the provider call: no unrecorded external call.
        await rest(url, service, "cockpit_media_provider_health", { ...row, action_id: actionId });
      }),
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    // ClickUp allows 100 calls a minute per token on Business plans; stay under it unless told otherwise.
    pace: pacer(Math.min(1000, Math.max(10, Number(env("CLICKUP_CALLS_PER_MINUTE")) || 90))),
  };
  try {
    const result =
      job === "kpi" ? await runKpi(deps)
      : job === "log" ? await runLog(deps)
      : job === "dosdonts" ? await runDosDonts(deps)
      : job === "doctor" ? await runDoctor(deps)
      : null;
    if (!result) return json({ ok: false, note: `Unknown job "${job.slice(0, 40)}". Use kpi, log, dosdonts or doctor.` }, 400);
    console.log(`clickup-writeback ${job} ${result.ok ? "ok" : "FAILED"}: ${result.note}`);
    return json(result);
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e));
    console.error(`clickup-writeback ${job} FAILED: ${note}`);
    try {
      await deps.rpc("cockpit_clickup_writeback_idle", { p_job: job || "unknown", p_ok: false, p_note: note });
    } catch {
      // The failure line above is the record when the database is unreachable too.
    }
    return json({ ok: false, job, note }, 200);
  }
});
