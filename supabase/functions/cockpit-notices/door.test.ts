import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db";
import type { Doctor } from "./doctor";
import { makeNoticesDoor, readJob, SEND, sameSecret } from "./door";
import type { DryRun, DryRunJob, Rehearsal, RehearseJob, RunResult } from "./run";
import { deps as kitDeps } from "./testkit";

const SECRET = "notices-cron-secret-fixture";

function setup(opts: { secret?: string; fail?: Error } = {}) {
  const kit = kitDeps();
  const works: Promise<unknown>[] = [];
  const seen = { run: 0, doctor: 0, dryRun: [] as DryRunJob[], rehearse: [] as RehearseJob[] };
  let bodyRead = false;
  const door = makeNoticesDoor({
    ...kit.deps,
    cronSecret: () => opts.secret ?? SECRET,
    waitUntil: w => { works.push(w); },
    run: async () => { seen.run += 1; return { ok: true } as RunResult; },
    doctor: async () => { seen.doctor += 1; if (opts.fail) throw opts.fail; return { ok: true, note: "fine" } as Doctor; },
    dryRun: async (_d, job) => { seen.dryRun.push(job); if (opts.fail) throw opts.fail; return { ok: true, kind: "kickoff" } as DryRun; },
    rehearse: async (_d, job) => { seen.rehearse.push(job); return { ok: true, id: "x" } as Rehearsal; },
  });
  const send = (body: unknown, headers: Record<string, string> = { "x-cron-secret": SECRET }, method = "POST") => {
    const raw = method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = new Request("https://x.test/functions/v1/cockpit-notices", { method, headers: { "Content-Type": "application/json", ...headers }, body: raw });
    // Watch for the body being read: the secret must be checked first.
    const text = req.text.bind(req);
    req.text = async () => { bodyRead = true; return text(); };
    req.json = async () => { bodyRead = true; return JSON.parse(await text()); };
    return door(req);
  };
  return { send, works, seen, kit, bodyRead: () => bodyRead };
}

describe("the door", () => {
  test("POST only", async () => {
    const s = setup();
    const res = await s.send(null, {}, "GET");
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ ok: false, note: "POST only" });
  });
  test("no secret, a wrong one, a longer one, or none configured: 401 before the body is read, and nothing runs", async () => {
    for (const headers of [{}, { "x-cron-secret": "wrong" }, { "x-cron-secret": `${SECRET}-and-more` }, { authorization: `Bearer ${SECRET}` }]) {
      const s = setup();
      const res = await s.send({ job: "run" }, headers as Record<string, string>);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, note: "not allowed" });
      expect(s.bodyRead()).toBe(false);
      expect(s.seen.run + s.seen.doctor).toBe(0);
      expect(s.kit.rpc.calls).toEqual([]);
    }
    const unset = setup({ secret: "" });
    expect((await unset.send({ job: "run" }, { "x-cron-secret": "" })).status).toBe(401);
    expect(unset.bodyRead()).toBe(false);
  });
  test("the comparison is the constant-time one", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
  test("each malformed body is 400 with the sentence, and nothing runs", async () => {
    const bad: unknown[] = [
      {}, [1], "not json", null, 7,
      { job: "watch" }, { job: "run", extra: 1 }, { job: "doctor", dryRun: true }, { mode: "run" },
      { job: "dryRun" }, { job: "dryRun", responseId: "" }, { job: "dryRun", responseId: "has spaces in it" }, { job: "dryRun", responseId: "abc123def", kind: "kickoff" },
      { job: "dryRun", kind: "kickoff" }, { job: "dryRun", kind: "nope", taskId: "86ex70t90", facts: {} }, { job: "dryRun", kind: "blueprint.close", taskId: "bad id!", facts: {} },
      { job: "dryRun", kind: "blueprint.close", taskId: "86ex70t90", facts: [] }, { job: "dryRun", kind: "blueprint.close", taskId: "86ex70t90", facts: {}, variant: "complete" },
      { job: "dryRun", kind: "blueprint.close", taskId: "86ex70t90", facts: { big: "x".repeat(17000) } }, { job: "dryRun", kind: "blueprint.close", taskId: "86ex70t90", facts: {}, extra: true },
      { job: "rehearse", to: "C09RZ0GS0V9" }, { job: "rehearse", to: "someone@example.test" }, { job: "rehearse", kind: "rehearsal" }, { job: "rehearse", channel: "C09RZ0GS0V9" },
    ];
    for (const body of bad) {
      const s = setup();
      const res = await s.send(body);
      expect(res.status).toBe(400);
      expect((await res.json()).note).toContain(SEND);
      expect(s.seen.run + s.seen.doctor + s.seen.dryRun.length + s.seen.rehearse.length).toBe(0);
    }
  });
  test("readJob reads each body strictly", () => {
    expect(readJob({ job: "run" })).toEqual({ job: "run" });
    expect(readJob({ job: "doctor" })).toEqual({ job: "doctor" });
    expect(readJob({ job: "dryRun", responseId: "0dvg18xtj99sjea0dxi2ixarmxqdxw5y" })).toEqual({ job: "dryRun", input: { responseId: "0dvg18xtj99sjea0dxi2ixarmxqdxw5y" } });
    expect(readJob({ job: "dryRun", kind: "blueprint.close", taskId: "86ex70t90", facts: { settled: "done" }, variant: "done" }))
      .toEqual({ job: "dryRun", input: { kind: "blueprint.close", taskId: "86ex70t90", facts: { settled: "done" }, variant: "done" } });
    expect(readJob({ job: "rehearse" })).toEqual({ job: "rehearse", input: { kind: "kickoff", to: null } });
    expect(readJob({ job: "rehearse", kind: "blueprint.media", to: "U09305KE2KS" })).toEqual({ job: "rehearse", input: { kind: "blueprint.media", to: "U09305KE2KS" } });
    expect(readJob({ job: "watch" })).toBe(SEND);
  });
  test("the 1-1 notes kinds: a dry run and a rehearsal take them; any other kind is refused with the plain sentence", () => {
    expect(readJob({ job: "dryRun", kind: "checkin.recap_late", taskId: "86ex70t90", facts: { client: "Acme Interiors" }, variant: "late" }))
      .toEqual({ job: "dryRun", input: { kind: "checkin.recap_late", taskId: "86ex70t90", facts: { client: "Acme Interiors" }, variant: "late" } });
    expect(readJob({ job: "rehearse", kind: "checkin.grade", to: "U09305KE2KS" })).toEqual({ job: "rehearse", input: { kind: "checkin.grade", to: "U09305KE2KS" } });
    expect(readJob({ job: "dryRun", kind: "checkin.grade", taskId: "86ex70t90", facts: {}, variant: "late" }))
      .toBe(`variant must be one of grade for checkin.grade. ${SEND}`);
    expect(readJob({ job: "dryRun", kind: "checkin.other", taskId: "86ex70t90", facts: {} })).toBe(`kind must be one of the notices. ${SEND}`);
    expect(readJob({ job: "rehearse", kind: "checkin.other" })).toBe(`kind must be one of the notices. ${SEND}`);
  });
});

describe("routing", () => {
  test("run answers 202 and works in the background", async () => {
    const s = setup();
    const res = await s.send({ job: "run" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, started: "run" });
    expect(s.works).toHaveLength(1);
    await Promise.all(s.works);
    expect(s.seen.run).toBe(1);
  });
  test("doctor, dryRun and rehearse answer 200 with their result", async () => {
    const s = setup();
    expect(await (await s.send({ job: "doctor" })).json()).toEqual({ ok: true, note: "fine" });
    const dry = await s.send({ job: "dryRun", responseId: "0dvg18xtj99sjea0dxi2ixarmxqdxw5y" });
    expect(dry.status).toBe(200);
    expect(s.seen.dryRun).toEqual([{ responseId: "0dvg18xtj99sjea0dxi2ixarmxqdxw5y" }]);
    expect((await s.send({ job: "rehearse", to: "U09305KE2KS" })).status).toBe(200);
    expect(s.seen.rehearse).toEqual([{ kind: "kickoff", to: "U09305KE2KS" }]);
    expect(s.works).toHaveLength(0);
  });
  test("a database refusal is 400 in its own words; anything else is 500", async () => {
    const refused = setup({ fail: new RpcError("No kickoff with that response ID is in the mirror.", "P0001") });
    const res = await refused.send({ job: "dryRun", responseId: "0dvg18xtj99sjea0dxi2ixarmxqdxw5y" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, note: "No kickoff with that response ID is in the mirror." });
    const broken = setup({ fail: new Error("socket hang up") });
    expect((await broken.send({ job: "doctor" })).status).toBe(500);
  });
});
