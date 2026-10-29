// clickup-writeback: the ClickUp writes the paused media Convex deployment
// used to make, run natively on Supabase (Creative Triage bldgtotkfmhoxmlzowdx).
//
// Jobs (POST body {"job": ...}), each started by pg_cron with the shared
// secret from the vault (migration 20261009f_clickup_writeback_native.sql):
//   kpi       hourly at :23, 03-18 UTC  board KPI columns (convex writeback.pushMetrics);
//                                       moved from :05 off the native cycle's minute (20261029q)
//   log       every 2 minutes           decision / change comments, Ad Status moves and
//                                       cockpit billing edits on Clients - Mahara cards (billing.ts, 20261009j)
//   dosdonts  hourly at :35, 03-18 UTC  Do's & Don'ts clean format (convex dosDonts.tidyClient)
//   doctor    on demand                 secrets present (names only) and queue health
//   requests  every minute (20261026r)  tickets from /requests (kind 'request') and focus-view
//                                       presses (kind 'task_action'), requests.ts and taskActions.ts
//   requests_doctor  on demand          reads only: templates, Request Type options, fields,
//                                       named owners and done statuses the request types rely on
//
// Dry run by default. Four secrets open writes to ClickUp, each only when it
// is exactly "true" (run.ts OUTWARD SAFETY):
//   CLICKUP_WRITEBACK_APPLY              the log and Do's & Don'ts
//   CLICKUP_WRITEBACK_APPLY_CSM_TICKETS  client success tickets in the log, on
//                                        their own (live since 2026-10-12)
//   CLICKUP_WRITEBACK_APPLY_KPI          the board KPI columns; the general
//                                        switch does not write them
//   CLICKUP_WRITEBACK_APPLY_REQUESTS     requests and task changes only; no other switch
//                                        opens them and this one opens nothing else.
//                                        CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS (client card
//                                        ids) narrows it to a canary card.
// The kpi job reports ok=false while it is a dry run, on a run limited to
// CLICKUP_WRITEBACK_ONLY_TASKS, when no card had Last Updated written and when
// a write failed, so the health line never says ok over frozen numbers.
// Secrets read by name: CLICKUP_API_TOKEN, META_SYSTEM_TOKEN (Ad Status
// read-back), CRON_SECRET, optional META_GRAPH_VERSION,
// CLICKUP_WRITEBACK_ONLY_TASKS (comma-separated task ids for a one-card live
// check; it narrows APPLY and APPLY_KPI, not client success tickets) and the
// pace: CLICKUP_REQUESTS_CALLS_PER_MINUTE for the two requests jobs (default
// 25) and CLICKUP_CALLS_PER_MINUTE for the others (default 30), never above 60
// (run.ts writebackPerMinute). Each pace is one Edge Function call's; the
// requests job opens one run at a time (an exclusive begin, run.ts BUSY_HELD),
// so its pace is also the whole job's, however many submits and presses start
// a run in the same minute. ClickUp Business allows 100 calls a minute for
// the one token the Supabase functions and the VPS workers share
// (docs/requests/CLICKUP-DOWNGRADE.md). Every provider call goes through
// cockpit-media-api/tools.ts and lands in cockpit_media_provider_health. These
// jobs keep their own retries (queue.ts), so they do not take the helper's 429
// retry. Nothing here logs a key.

import { providerTools } from "../cockpit-media-api/tools.ts";
import { type Deps, noJobNote, pacer, redact, runDoctor, runDosDonts, runKpi, runLog, runRequests, runRequestsDoctor, unknownJobNote, writebackPerMinute } from "./run.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function rest(base: string, key: string, path: string, body: unknown, prefer = "return=minimal"): Promise<any> {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(path.startsWith("rpc/") ? {} : { Prefer: prefer }),
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
    return json({ ok: false, note: noJobNote }, 400);
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
    // ClickUp Business allows 100 calls a minute for the shared token; each job keeps to its own pace, 60 at most.
    // This pacer is this call's; one requests run sends at a time, so for requests it is the job's too.
    pace: pacer(writebackPerMinute(job, env)),
    // One health row by key, merged on conflict (the tap-charges-sync pattern).
    syncState: (key, row) => rest(url, service, "cockpit_sync_state?on_conflict=key", [{ key, ...row }], "resolution=merge-duplicates,return=minimal"),
  };
  try {
    const result =
      job === "kpi" ? await runKpi(deps)
      : job === "log" ? await runLog(deps)
      : job === "dosdonts" ? await runDosDonts(deps)
      : job === "doctor" ? await runDoctor(deps)
      : job === "requests" ? await runRequests(deps)
      : job === "requests_doctor" ? await runRequestsDoctor(deps)
      : null;
    if (!result) return json({ ok: false, note: unknownJobNote(job) }, 400);
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
