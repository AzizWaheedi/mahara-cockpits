/**
 * The door of cockpit-tasks (contract 5.1). Deployed with the JWT check off.
 *
 * Two ways in, and nothing else:
 *
 *   pg_cron, with x-cron-secret equal to TASKS_CRON_SECRET (compared in
 *   constant time before the body is read):
 *     {"job":"delta"}    202 at once; the 2-minute read runs in the background
 *     {"job":"seats"}    202 at once; the hourly read runs in the background
 *     {"job":"doctor"}   200 Doctor
 *
 *   a cockpit, signed in (Authorization: Bearer <the person's JWT>):
 *     {"op":"detail","taskId":"...","refresh":true|false}   200 TaskDetail
 *   The person is signed in with auth/v1/user (401 "Sign in again"), and
 *   cockpit_task_detail is called with their own JWT, so the database decides
 *   who may open a task; the service key only writes the cache.
 *
 * A body that is not exactly one of these is 400 with the sentence saying
 * what to send. A job body without the secret is 401, never a sign-in.
 */
import type { Deps, Env, Row } from "./clickup.ts";
import { sentence, TASK_ID } from "./clickup.ts";
import { runDelta } from "./delta.ts";
import { type DetailDeps, RpcError, runDetail, type UserRpc } from "./detail.ts";
import { runDoctor } from "./doctor.ts";
import { runSeats } from "./seats.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export const SEND_JOB = 'Send {"job":"delta"}, {"job":"seats"} or {"job":"doctor"}.';
export const SEND_OP = 'Send {"op":"detail","taskId":"<ClickUp task id>","refresh":false}.';
const MAX_BODY = 32 * 1024;

/** Constant-time comparison of two strings. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (b: Row, keys: string[]) => Object.keys(b).every(k => keys.includes(k));

export type Job = { job: "delta" | "seats" | "doctor" };
export type Op = { op: "detail"; taskId: string; refresh: boolean };

/** A cron body, strictly; the sentence saying what to send when it is anything else. */
export function readJob(body: unknown): Job | string {
  if (!isObj(body) || !only(body, ["job"])) return SEND_JOB;
  if (body.job === "delta" || body.job === "seats" || body.job === "doctor") return { job: body.job };
  return SEND_JOB;
}

/** A cockpit's body, strictly. */
export function readOp(body: unknown): Op | string {
  if (!isObj(body) || body.op !== "detail" || !only(body, ["op", "taskId", "refresh"])) return SEND_OP;
  if (typeof body.taskId !== "string" || !TASK_ID.test(body.taskId)) return `taskId must be a ClickUp task id. ${SEND_OP}`;
  if (body.refresh !== undefined && typeof body.refresh !== "boolean") return `refresh must be true or false. ${SEND_OP}`;
  return { op: "detail", taskId: body.taskId, refresh: body.refresh === true };
}

/** A service-key RPC through PostgREST; errors carry the database's sentence and code, never a key. */
export function restRpc(url: string, key: string, request: typeof fetch, bearer?: string): (name: string, args?: Record<string, unknown>) => Promise<any> {
  return async (name, args = {}) => {
    if (!/^cockpit_[a-z_]+$/.test(name)) throw new RpcError("Unknown task function", null);
    const res = await request(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${bearer ?? key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const b = isObj(body) ? body : {};
      const scrub = (s: string) => [key, bearer ?? ""].reduce((t: string, k: string) => (k ? t.replaceAll(k, "[key]") : t), s);
      const message = typeof b.message === "string" ? scrub(b.message).slice(0, 240) : `The database answered ${res.status}`;
      throw new RpcError(message, typeof b.code === "string" ? b.code : null);
    }
    return body;
  };
}

/** A provider receipt into cockpit_media_provider_health; no call is made without one. */
export function restHealth(url: string, serviceKey: string, request: typeof fetch) {
  return async (row: Row) => {
    const res = await request(`${url}/rest/v1/cockpit_media_provider_health`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(15_000),
    });
    await res.text().catch(() => "");
    if (!res.ok) throw new Error("The provider receipt could not be saved, so ClickUp was not called.");
  };
}

/** Whether a JWT is a signed-in person (auth/v1/user answers with a user). */
export function restSignedIn(url: string, anonKey: string, request: typeof fetch) {
  return async (jwt: string): Promise<boolean> => {
    try {
      const res = await request(`${url}/auth/v1/user`, {
        method: "GET",
        headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => null);
      return res.ok && isObj(body) && typeof body.id === "string" && !!body.id;
    } catch {
      return false;
    }
  };
}

export type DoorDeps = Deps & {
  cronSecret: () => string;
  signedIn: (jwt: string) => Promise<boolean>;
  userRpc: UserRpc;
  waitUntil: (work: Promise<unknown>) => void;
  /** Swappable for tests; the real jobs by default. */
  delta?: (deps: Deps) => Promise<unknown>;
  seats?: (deps: Deps) => Promise<unknown>;
  doctor?: (deps: Deps) => Promise<unknown>;
  detail?: (deps: DetailDeps, jwt: string, op: Op) => Promise<{ status: number; body: unknown }>;
};

/** The real dependencies from the function's secrets. */
export function realDeps(env: Env, request: typeof fetch, waitUntil: (work: Promise<unknown>) => void): DoorDeps {
  const url = env("SUPABASE_URL") ?? "";
  const service = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anon = env("SUPABASE_ANON_KEY") ?? "";
  return {
    env,
    rpc: restRpc(url, service, request),
    health: restHealth(url, service, request),
    clickupFetch: request,
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    uuid: () => crypto.randomUUID(),
    cronSecret: () => env("TASKS_CRON_SECRET") ?? "",
    signedIn: restSignedIn(url, anon, request),
    userRpc: (jwt, name, args) => restRpc(url, anon, request, jwt)(name, args),
    waitUntil,
  };
}

export function makeTasksDoor(deps: DoorDeps) {
  const delta = deps.delta ?? runDelta;
  const seats = deps.seats ?? runSeats;
  const doctor = deps.doctor ?? runDoctor;
  const detail = deps.detail ?? runDetail;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    if (!deps.env("SUPABASE_URL") || !deps.env("SUPABASE_SERVICE_ROLE_KEY")) {
      return json({ ok: false, note: "The Supabase connection variables are missing on cockpit-tasks." }, 500);
    }
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (given) {
      const expected = deps.cronSecret().trim();
      if (!expected || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    }
    let parsed: unknown = null;
    try {
      const raw = await req.text();
      parsed = raw.length > MAX_BODY ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }

    // pg_cron.
    if (given) {
      const job = readJob(parsed);
      if (typeof job === "string") return json({ ok: false, note: job }, 400);
      if (job.job === "doctor") {
        try {
          return json(await doctor(deps));
        } catch (e) {
          return json({ ok: false, note: sentence(e) }, 500);
        }
      }
      const run = job.job === "delta" ? delta : seats;
      deps.waitUntil(
        run(deps).then(
          r => console.log(`cockpit-tasks ${job.job}: ${JSON.stringify(r).slice(0, 400)}`),
          e => console.error(`cockpit-tasks ${job.job} FAILED: ${sentence(e)}`),
        ),
      );
      return json({ ok: true, started: job.job }, 202);
    }
    // A job without the secret is never treated as a sign-in.
    if (isObj(parsed) && "job" in parsed) return json({ ok: false, note: "not allowed" }, 401);

    // A cockpit.
    const auth = req.headers.get("authorization") ?? "";
    const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!jwt || !(await deps.signedIn(jwt))) return json({ error: "Sign in again" }, 401);
    const op = readOp(parsed);
    if (typeof op === "string") return json({ error: op }, 400);
    try {
      const answer = await detail(deps, jwt, op);
      return json(answer.body, answer.status);
    } catch (e) {
      console.error(`cockpit-tasks detail FAILED: ${sentence(e)}`);
      return json({ error: "This task could not be opened. Open it in ClickUp." }, 500);
    }
  };
}
