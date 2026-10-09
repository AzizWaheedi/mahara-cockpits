// tracking-audit: daily check of every client ad account's live ads for
// missing URL parameters and missing lead forms (convex/tracking.ts audit),
// run natively on Supabase (Creative Triage bldgtotkfmhoxmlzowdx).
//
// pg_cron calls it at 02:30 UTC with {"job":"audit"} and the shared secret from
// the vault (migration 20261009f_clickup_writeback_native.sql). {"job":"doctor"}
// reports the secrets it needs by name, with no provider call.
// Reads Meta only (META_SYSTEM_TOKEN, optional META_GRAPH_VERSION); every call
// goes through cockpit-media-api/tools.ts into cockpit_media_provider_health.
// Results go to cockpit_media_tracking_issues; the cockpit reads them through
// cockpit_media_native_source('trackingIssues'). Nothing here logs a key.

import { providerTools } from "../cockpit-media-api/tools.ts";
import { type Deps, redact, runAudit } from "./audit.ts";

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
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !given || given !== expected) return json({ ok: false, note: "not allowed" }, 401);
  const env = (name: string) => Deno.env.get(name) || undefined;
  const url = env("SUPABASE_URL") ?? "";
  const service = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return json({ ok: false, note: "The Supabase connection variables are missing on this Edge Function." }, 500);
  let job = "";
  try {
    job = String((await req.json())?.job ?? "");
  } catch {
    return json({ ok: false, note: "Send a JSON body with a job: audit or doctor." }, 400);
  }
  const deps: Deps = {
    env,
    rpc: (name, params = {}) => rest(url, service, `rpc/${name}`, params),
    providerFor: (actionId: string) =>
      providerTools(env, async row => {
        await rest(url, service, "cockpit_media_provider_health", { ...row, action_id: actionId });
      }),
    now: () => Date.now(),
  };
  if (job === "doctor") {
    const secrets = Object.fromEntries(["META_SYSTEM_TOKEN", "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map(k => [k, Boolean(env(k))]));
    const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
    return json({ ok: !missing.length, job, secrets, note: missing.length ? `Missing secrets: ${missing.join(", ")}.` : "Ready." });
  }
  if (job !== "audit") return json({ ok: false, note: `Unknown job "${job.slice(0, 40)}". Use audit or doctor.` }, 400);
  try {
    const result = await runAudit(deps);
    console.log(`tracking-audit ${result.ok ? "ok" : "FAILED"}: ${result.note}`);
    return json({ job, ...result });
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e));
    console.error(`tracking-audit FAILED: ${note}`);
    try {
      await deps.rpc("cockpit_media_tracking_idle", { p_ok: false, p_note: note });
    } catch {
      // The failure line above is the record when the database is unreachable too.
    }
    return json({ ok: false, job, note });
  }
});
