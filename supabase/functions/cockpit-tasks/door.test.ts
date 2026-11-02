import { describe, expect, test } from "bun:test";
import { makeTasksDoor, readJob, readOp, restHealth, restRpc, restSignedIn, SEND_JOB, SEND_OP, sameSecret } from "./door";
import { RpcError } from "./detail";
import { runDoctor } from "./doctor";
import { kit, TOKEN } from "./testkit";

const SECRET = "tasks-cron-secret-fixture";
type Row = Record<string, any>;

function setup(opts: { secret?: string; signedIn?: boolean } = {}) {
  const k = kit();
  const works: Promise<unknown>[] = [];
  const seen = { delta: 0, seats: 0, doctor: 0, detail: [] as { jwt: string; op: Row }[] };
  let bodyRead = false;
  const door = makeTasksDoor({
    ...k.deps,
    cronSecret: () => opts.secret ?? SECRET,
    signedIn: async jwt => (opts.signedIn ?? true) && jwt === "good-jwt",
    userRpc: async () => ({}),
    waitUntil: w => {
      works.push(w);
    },
    delta: async () => {
      seen.delta += 1;
      return { ok: true };
    },
    seats: async () => {
      seen.seats += 1;
      return { ok: true };
    },
    doctor: async () => {
      seen.doctor += 1;
      return { ok: true, note: "fine" };
    },
    detail: async (_d, jwt, op) => {
      seen.detail.push({ jwt, op });
      return { status: 200, body: { task: { taskId: op.taskId } } };
    },
  });
  const send = (body: unknown, headers: Record<string, string> = { "x-cron-secret": SECRET }, method = "POST") => {
    const raw = method === "GET" || method === "OPTIONS" ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = new Request("https://x.test/functions/v1/cockpit-tasks", { method, headers: { "Content-Type": "application/json", ...headers }, body: raw });
    const text = req.text.bind(req);
    req.text = async () => {
      bodyRead = true;
      return text();
    };
    return door(req);
  };
  return { send, works, seen, k, bodyRead: () => bodyRead };
}

describe("the door", () => {
  test("POST only; OPTIONS answers the browser's preflight", async () => {
    const s = setup();
    expect((await s.send(null, {}, "GET")).status).toBe(405);
    const pre = await s.send(null, {}, "OPTIONS");
    expect(pre.status).toBe(200);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  test("a wrong or missing cron secret is refused before the body is read; a job with no secret is never a sign-in", async () => {
    const s = setup();
    const wrong = await s.send({ job: "delta" }, { "x-cron-secret": "nope" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ ok: false, note: "not allowed" });
    expect(s.bodyRead()).toBe(false);
    const none = await s.send({ job: "delta" }, { Authorization: "Bearer good-jwt" });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ ok: false, note: "not allowed" });
    const unset = setup({ secret: "" });
    expect((await unset.send({ job: "delta" })).status).toBe(401);
    expect(s.seen.delta + unset.seen.delta).toBe(0);
  });

  test("delta and seats answer 202 at once and run in the background; doctor answers in full", async () => {
    const s = setup();
    const d = await s.send({ job: "delta" });
    expect(d.status).toBe(202);
    expect(await d.json()).toEqual({ ok: true, started: "delta" });
    const t = await s.send({ job: "seats" });
    expect(t.status).toBe(202);
    await Promise.all(s.works);
    expect(s.seen).toMatchObject({ delta: 1, seats: 1 });
    const doc = await s.send({ job: "doctor" });
    expect(doc.status).toBe(200);
    expect(await doc.json()).toEqual({ ok: true, note: "fine" });
  });

  test("a cron body that is not exactly a job says what to send", async () => {
    const s = setup();
    for (const body of [{ job: "everything" }, { job: "delta", extra: 1 }, "not json", { op: "detail", taskId: "abc" }]) {
      const r = await s.send(body);
      expect(r.status).toBe(400);
      expect((await r.json()).note).toBe(SEND_JOB);
    }
    expect(readJob({ job: "seats" })).toEqual({ job: "seats" });
  });

  test("a cockpit must be signed in; then only the detail op, strictly", async () => {
    const s = setup();
    const anon = await s.send({ op: "detail", taskId: "abc123" }, {});
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "Sign in again" });
    expect((await s.send({ op: "detail", taskId: "abc123" }, { Authorization: "Bearer stale-jwt" })).status).toBe(401);
    const ok = await s.send({ op: "detail", taskId: "abc123", refresh: true }, { Authorization: "Bearer good-jwt" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    expect(await ok.json()).toEqual({ task: { taskId: "abc123" } });
    expect(s.seen.detail).toEqual([{ jwt: "good-jwt", op: { op: "detail", taskId: "abc123", refresh: true } }]);
    for (const body of [{ op: "tick", taskId: "abc123" }, { op: "detail", taskId: "../etc" }, { op: "detail", taskId: "abc", refresh: "yes" }, { op: "detail", taskId: "abc", more: 1 }]) {
      const r = await s.send(body, { Authorization: "Bearer good-jwt" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toContain(SEND_OP);
    }
    expect(readOp({ op: "detail", taskId: "abc" })).toEqual({ op: "detail", taskId: "abc", refresh: false });
  });

  test("without the Supabase variables nothing runs", async () => {
    const s = setup();
    delete s.k.vars.SUPABASE_URL;
    const r = await s.send({ job: "delta" });
    expect(r.status).toBe(500);
    expect(s.seen.delta).toBe(0);
  });

  test("secrets compare in full", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
});

describe("the doctor", () => {
  test("secrets by name only, one GET user with its rate limit, the linked seats and the last runs", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_inputs = () => ({
      linked: [{ memberId: "a", clickupUserId: 1, label: "the CSM" }],
      notLinked: 4,
      states: { delta: { at: "2026-10-26T08:58:00Z", ok: true, note: "Read 2 changed tasks" }, seats: { at: "2026-10-26T08:11:00Z", ok: true, note: "fine" } },
    });
    const d = await runDoctor(k.deps);
    expect(d.ok).toBe(true);
    expect(d.secrets).toEqual({ CLICKUP_API_TOKEN: true, TASKS_CRON_SECRET: true, SUPABASE_URL: true, SUPABASE_ANON_KEY: true, SUPABASE_SERVICE_ROLE_KEY: true });
    expect(d.rateLimit).toBe(1000);
    expect(d).toMatchObject({ linked: 1, notLinked: 4 });
    expect(d.note).toBe("ClickUp answers (1000 calls a minute allowed; the task mirror reads at 30 a minute); 1 seats linked, 4 not linked.");
    expect(d.pace).toBe(30);
    expect(k.clickup.calls.map(c => [c.method, c.path])).toEqual([["GET", "user"]]);
    expect(JSON.stringify(d)).not.toContain(TOKEN);
    expect(JSON.stringify(d)).not.toContain("service-key-fixture");
  });

  test("says what is missing in plain words", async () => {
    const k = kit({ token: null });
    const d = await runDoctor(k.deps);
    expect(d.ok).toBe(false);
    expect(d.secrets.CLICKUP_API_TOKEN).toBe(false);
    expect(d.problems).toContain("CLICKUP_API_TOKEN is not set on cockpit-tasks.");
    expect(d.problems).toContain("The 2-minute task read has not run yet.");
    expect(k.clickup.calls.length).toBe(0);
    const bad = kit();
    bad.clickup.fail.set("user", 401);
    expect((await runDoctor(bad.deps)).problems.some(p => p.startsWith("ClickUp did not accept the token"))).toBe(true);
  });
});

describe("the database and sign-in calls", () => {
  const recorder = (status: number, body: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const request: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(body), { status });
    };
    return { calls, request };
  };

  test("a service RPC carries the key; a refusal carries the database's sentence and code, never a key", async () => {
    const ok = recorder(200, { upserted: 1 });
    expect(await restRpc("https://p.test", "svc-key", ok.request)("cockpit_task_mirror_inputs", {})).toEqual({ upserted: 1 });
    expect(ok.calls[0].url).toBe("https://p.test/rest/v1/rpc/cockpit_task_mirror_inputs");
    expect((ok.calls[0].init.headers as Row).Authorization).toBe("Bearer svc-key");
    const no = recorder(403, { code: "42501", message: "permission denied for svc-key" });
    const err = await restRpc("https://p.test", "svc-key", no.request)("cockpit_task_detail", {}).catch(e => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe("42501");
    expect(err.message).toBe("permission denied for [key]");
    await expect(restRpc("https://p.test", "k", ok.request)("drop_everything", {})).rejects.toThrow("Unknown task function");
  });

  test("the person's RPC goes with their JWT and the anon key", async () => {
    const ok = recorder(200, {});
    await restRpc("https://p.test", "anon-key", ok.request, "their-jwt")("cockpit_task_detail", { p_task_id: "a" });
    expect(ok.calls[0].init.headers).toMatchObject({ apikey: "anon-key", Authorization: "Bearer their-jwt" });
  });

  test("a receipt that is refused throws, so the provider call never starts", async () => {
    const no = recorder(500, {});
    await expect(restHealth("https://p.test", "svc", no.request)({ provider: "clickup" })).rejects.toThrow("could not be saved");
    const ok = recorder(201, {});
    await restHealth("https://p.test", "svc", ok.request)({ provider: "clickup", action_id: "x" });
    expect(ok.calls[0].url).toBe("https://p.test/rest/v1/cockpit_media_provider_health");
  });

  test("signed in means auth/v1/user names a user", async () => {
    expect(await restSignedIn("https://p.test", "anon", recorder(200, { id: "u1" }).request)("jwt")).toBe(true);
    expect(await restSignedIn("https://p.test", "anon", recorder(401, { msg: "bad" }).request)("jwt")).toBe(false);
    expect(await restSignedIn("https://p.test", "anon", recorder(200, {}).request)("jwt")).toBe(false);
  });
});
