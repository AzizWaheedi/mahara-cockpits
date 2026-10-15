import { describe, expect, test } from "bun:test";
import { makeWatchDoor, readJob, sameSecret } from "./door.ts";
import type { DoctorResult, RunResult } from "./run.ts";

type Rec = { name: string; args: Record<string, unknown> };
function setup(opts: { busy?: boolean; secret?: string } = {}) {
  const calls: Rec[] = [];
  const runs: { runId: number; leaseToken: string; dryRun: boolean }[] = [];
  const works: Promise<unknown>[] = [];
  let doctors = 0;
  const door = makeWatchDoor({
    cronSecret: () => opts.secret ?? "cron-secret-fixture",
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "cockpit_hours_watch_lease_claim") return opts.busy ? { ok: false, busy: true, since: "2026-10-13T07:00:00Z" } : { ok: true, runId: 41, leaseToken: "lease-fixture" };
      return null;
    },
    insertReceipt: async () => {},
    fetch: (async () => { throw new Error("no network in door tests"); }) as unknown as typeof fetch,
    sleep: async () => {},
    now: () => new Date("2026-10-13T08:00:00Z"),
    slackToken: () => "",
    storage: { url: "https://project.supabase.test", serviceKey: "service-fixture" },
    waitUntil: w => { works.push(w); },
    watch: async (_deps, run) => { runs.push(run); return { ok: true, runId: run.runId, dryRun: run.dryRun, note: "planned" } as RunResult; },
    doctor: async () => { doctors += 1; return { ok: false, job: "doctor", note: "checked" } as DoctorResult; },
  });
  const send = (body: unknown, headers: Record<string, string> = { "x-cron-secret": "cron-secret-fixture" }, method = "POST") =>
    door(new Request("https://x.test/functions/v1/cockpit-hours-watch", { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
  return { calls, runs, works, send, doctors: () => doctors };
}

describe("the door", () => {
  test("POST only", async () => {
    expect((await setup().send(null, {}, "GET")).status).toBe(405);
  });
  test("no secret, a wrong secret, or an unset secret: 401, and nothing runs", async () => {
    for (const headers of [{}, { "x-cron-secret": "wrong" }, { "x-cron-secret": "cron-secret-fixture-and-more" }]) {
      const s = setup();
      const res = await s.send({ job: "watch" }, headers);
      expect(res.status).toBe(401);
      expect(s.calls).toEqual([]);
    }
    const unset = setup({ secret: "" });
    expect((await unset.send({ job: "watch" }, { "x-cron-secret": "" })).status).toBe(401);
  });
  test("the comparison is the constant-time one", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
  test("anything but watch or doctor is 400, never a silent fallback", async () => {
    for (const body of [{}, { job: "recent" }, { mode: "recent" }, { op: "nudge" }, { job: "watch", dryRun: "yes" }, { job: "watch", extra: 1 }, { job: "watch", requestedBy: "not an email" }, "not json", [1]]) {
      const s = setup();
      const res = await s.send(body);
      expect(res.status).toBe(400);
      expect((await res.json()).note).toContain("job");
      expect(s.calls).toEqual([]);
    }
  });
  test("readJob reads the body strictly", () => {
    expect(readJob({ job: "watch" })).toEqual({ job: "watch", dryRun: false, requestedBy: "cron" });
    expect(readJob({ job: "watch", dryRun: true, requestedBy: "CEO@Example.test" })).toEqual({ job: "watch", dryRun: true, requestedBy: "ceo@example.test" });
    expect(readJob({ job: "watch", dryRun: 1 })).toStartWith("dryRun must be true or false.");
  });
});

describe("the jobs", () => {
  test("watch claims the lease as cron, answers 202 and works in the background", async () => {
    const s = setup();
    const res = await s.send({ job: "watch" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, runId: 41 });
    expect(s.calls).toEqual([{ name: "cockpit_hours_watch_lease_claim", args: { p: { requestedBy: "cron", dryRun: false } } }]);
    expect(s.works.length).toBe(1);
    await Promise.all(s.works);
    expect(s.runs).toEqual([{ runId: 41, leaseToken: "lease-fixture", dryRun: false }]);
  });
  test("Check now from cockpit-hours-api is recorded as the CEO's run", async () => {
    const s = setup();
    await s.send({ job: "watch", requestedBy: "ceo@example.test" });
    expect(s.calls[0].args).toEqual({ p: { requestedBy: "ceo@example.test", dryRun: false } });
  });
  test("a dry run answers the plan synchronously", async () => {
    const s = setup();
    const res = await s.send({ job: "watch", dryRun: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true, note: "planned" });
    expect(s.works).toEqual([]);
    expect(s.calls[0].args).toEqual({ p: { requestedBy: "cron", dryRun: true } });
  });
  test("busy: another run holds the lease", async () => {
    const s = setup({ busy: true });
    const res = await s.send({ job: "watch" });
    expect(await res.json()).toEqual({ ok: false, busy: true, since: "2026-10-13T07:00:00Z" });
    expect(s.works).toEqual([]);
  });
  test("doctor takes no lease", async () => {
    const s = setup();
    const res = await s.send({ job: "doctor" });
    expect(await res.json()).toMatchObject({ job: "doctor", note: "checked" });
    expect(s.calls).toEqual([]);
    expect(s.doctors()).toBe(1);
  });
});
