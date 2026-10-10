/**
 * The two ways in.
 *
 * cronDoor (Edge Function hiring-sync, verify_jwt off): pg_cron posts
 * {"job": "mirror" | "intake" | "engine" | "doctor"} with the shared
 * x-cron-secret. Nothing else gets in.
 *
 * apiDoor (Edge Function hiring-api, verify_jwt on): the CEO cockpit posts
 * {"operation", "args"} with the signed-in user's token. The door asks
 * Supabase who the token belongs to and whether public.cockpit_is_ceo() is
 * true for them, with that same token, before anything else happens.
 */

import { ActionError, type DryRun, OPERATIONS, type Operation } from "./actions.ts";
import { doctor, type Env, makeCtx, runJob } from "./context.ts";
import { GateError, redact } from "./providers.ts";
import { restStore, type Store } from "./store.ts";

export type DoorDeps = {
  env: Env;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Tests hand in a fake; production builds the PostgREST store. */
  store?: Store;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function storeFor(deps: DoorDeps): Store | null {
  if (deps.store) return deps.store;
  const url = (deps.env("SUPABASE_URL") ?? "").trim();
  const key = (deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  return url && key ? restStore({ url, key, fetch: deps.fetch }) : null;
}

const JOBS = ["mirror", "intake", "engine"] as const;

export async function cronDoor(req: Request, deps: DoorDeps): Promise<Response> {
  const expected = (deps.env("CRON_SECRET") ?? "").trim();
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (req.method !== "POST" || !expected || !given || given !== expected)
    return json({ ok: false, note: "not allowed" }, 401);
  let job = "";
  try {
    job = String((await req.json())?.job ?? "");
  } catch {
    // An unreadable body names no job.
  }
  if (job === "doctor") return json(doctor(deps.env));
  if (!(JOBS as readonly string[]).includes(job))
    return json({ ok: false, note: "Name a job: mirror, intake, engine or doctor." }, 400);
  const store = storeFor(deps);
  if (!store) {
    console.error(`hiring-sync ${job} failed: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing`);
    return json({ ok: false, note: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required." }, 503);
  }
  const ctx = makeCtx({ env: deps.env, store, actor: null, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
  const out = await runJob(ctx, job as (typeof JOBS)[number], "schedule");
  // One clear line either way, so the monitor can tell them apart.
  if (out.ok) console.log(`hiring-sync ${job} ok: ${out.note}`);
  else console.error(`hiring-sync ${job} failed: ${out.note}`);
  return json(out);
}

/** The caller's email when they are the CEO; a 401 or 403 otherwise. */
export async function verifyCeo(authorization: string, deps: DoorDeps): Promise<string> {
  const url = (deps.env("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  const anon = (deps.env("SUPABASE_ANON_KEY") ?? "").trim();
  if (!url || !anon) throw new ActionError("The hiring service is not configured. Contact an administrator.", 503);
  const f = deps.fetch ?? fetch;
  const headers = { apikey: anon, Authorization: authorization };
  const user = await f(`${url}/auth/v1/user`, { headers }).catch(() => null);
  if (!user?.ok) throw new ActionError("Sign in again.", 401);
  const email = String((await user.json().catch(() => null))?.email ?? "").trim().toLowerCase();
  if (!email) throw new ActionError("Sign in again.", 401);
  // The same founder check every CEO table's row security uses.
  const ceo = await f(`${url}/rest/v1/rpc/cockpit_is_ceo`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  if (!ceo?.ok) throw new ActionError("Your cockpit seat could not be checked. Sign in again.", 403);
  if ((await ceo.json().catch(() => null)) !== true)
    throw new ActionError("The hiring tab is the CEO's only.", 403);
  return email;
}

export async function apiDoor(req: Request, deps: DoorDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) throw new ActionError("Sign in first.", 401);
    const actor = await verifyCeo(authorization, deps);
    let input: { operation?: unknown; args?: unknown };
    try {
      input = await req.json();
    } catch {
      throw new ActionError("Send an operation and its arguments.");
    }
    const operation = String(input?.operation ?? "");
    if (!Object.hasOwn(OPERATIONS, operation))
      throw new ActionError(`There is no hiring operation called ${operation || "that"}.`);
    const args = input.args && typeof input.args === "object" && !Array.isArray(input.args)
      ? (input.args as Record<string, unknown>)
      : {};
    const store = storeFor(deps);
    if (!store) throw new ActionError("The hiring service is not configured. Contact an administrator.", 503);
    const ctx = makeCtx({ env: deps.env, store, actor, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
    const result = await (OPERATIONS[operation as Operation] as (c: typeof ctx, a: Record<string, unknown>) => Promise<unknown>)(ctx, args);
    if (result && typeof result === "object" && (result as DryRun).dryRun === true) {
      const d = result as DryRun;
      return json({ ok: true, dryRun: true, message: d.message, plan: d.plan });
    }
    return json({ ok: true, result });
  } catch (e) {
    if (e instanceof ActionError) return json({ error: e.message }, e.status);
    if (e instanceof GateError) return json({ error: e.message }, e.status);
    const message = redact(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);
    console.error(`hiring-api failed: ${message}`);
    return json({ error: message || "The hiring operation was not confirmed." }, 502);
  }
}
