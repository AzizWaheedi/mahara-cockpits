import { describe, expect, test } from "bun:test";
import { guardedRun, type Ports } from "./guarded-run.ts";
const settings = { enabled: true, staticTokenPresent: false, repositoryId: 789, repositoryFullName: "example/research", timeoutMs: 12, minTokenLifeMs: 60_000 };
const pretendNow = 1_900_000_000_000;
const key = "fictional-token-do-not-log";
const make = () => {
  const calls: string[] = [];
  const p: Ports = {
    now: () => pretendNow,
    mint: async () => { calls.push("mint"); return { value: key, expiresAtMs: pretendNow + 180_000, repositoryId: 789, repositoryFullName: "example/research" }; },
    verify: async () => { calls.push("verify"); return { id: 789, fullName: "example/research", private: true, contentsWrite: true }; },
    hold: async (reason) => { calls.push(`hold:${reason}`); },
    reserveOne: async () => { calls.push("reserve"); return { kind: "reserved", row: { id: "fictional-row", lease: "fictional-lease" } }; },
    begin: async () => { calls.push("begin"); return true; },
    releaseAndHold: async (_row, reason) => { calls.push(`release-and-hold:${reason}`); return true; },
    dispatch: async () => { calls.push("dispatch"); return "sent"; },
    finish: async (_row, result, reason) => { calls.push(`finish:${result}:${reason}`); return true; },
  };
  return { calls, p };
};
const never = () => new Promise<any>(() => {});

describe("synthetic guarded run; no production adapters", () => {
  test("safe default and invalid settings do not reserve", async () => {
    let x = make();
    expect(await guardedRun({ ...settings, enabled: false }, x.p)).toEqual({ status: "disabled" });
    expect(x.calls).toEqual([]);
    x = make();
    expect(await guardedRun({ ...settings, staticTokenPresent: true }, x.p)).toEqual({ status: "held", reason: "credentials_unavailable" });
    expect(x.calls).toEqual(["hold:credentials_unavailable"]);
  });
  test("missing, unusable, expired or wrong-repository token is held before queue claim", async () => {
    for (const mode of ["error", "timeout", "empty", "expired", "wrong"]) {
      const x = make();
      x.p.mint = mode === "error" ? async () => { throw new Error(key); } : mode === "timeout" ? never : async () => ({ value: mode === "empty" ? "" : key, expiresAtMs: pretendNow + (mode === "expired" ? 30_000 : 180_000), repositoryId: mode === "wrong" ? 987 : 789, repositoryFullName: "example/research" });
      const result = await guardedRun(settings, x.p);
      expect(result).toEqual({ status: "held", reason: "credentials_unavailable" });
      expect(x.calls).not.toContain("reserve"); expect(JSON.stringify(result)).not.toContain(key);
    }
  });
  test("invalid or failing clocks cannot pass readiness", async () => {
    for (const clock of [() => NaN, () => Infinity, () => undefined as any, () => 0, () => { throw new Error(key); }]) {
      const x = make(); x.p.now = clock;
      expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "credentials_unavailable" });
      expect(x.calls).not.toContain("mint"); expect(x.calls).not.toContain("reserve");
    }
  });
  test("inaccessible, malformed, private mismatch or read-only repository cannot consume rows", async () => {
    for (const reply of [null, { id: 123, fullName: "example/research", private: true, contentsWrite: true }, { id: 789, fullName: "example/research", private: false, contentsWrite: true }, { id: 789, fullName: "example/research", private: true, contentsWrite: false }]) {
      const x = make(); x.p.verify = async () => reply as any;
      expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "repository_unverified" });
      expect(x.calls).not.toContain("reserve");
    }
  });
  test("hold write failure is reported distinctly and never starts work", async () => {
    const x = make(); x.p.mint = never; x.p.hold = never;
    expect(await guardedRun(settings, x.p)).toEqual({ status: "hold_unrecorded", reason: "credentials_unavailable" });
    expect(x.calls).not.toContain("reserve");
  });
  test("successful readiness reserves one row, fences send, and settles", async () => {
    const x = make();
    expect(await guardedRun(settings, x.p)).toEqual({ status: "sent" });
    expect(x.calls).toEqual(["mint", "verify", "reserve", "begin", "dispatch", "finish:sent:null"]);
  });
  test("a pre-existing hold is checked atomically during reservation", async () => {
    const x = make(); x.p.reserveOne = async () => { x.calls.push("reserve-held"); return { kind: "held" }; };
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held" });
    expect(x.calls).toEqual(["mint", "verify", "reserve-held"]);
  });
  test("token becoming too old after reservation is released and held atomically", async () => {
    const x = make(); let count = 0;
    x.p.now = () => ++count < 4 ? pretendNow : pretendNow + 130_000;
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "readiness_expired" });
    expect(x.calls).toEqual(["mint", "verify", "reserve", "release-and-hold:readiness_expired"]);
  });
  test("a clock that becomes invalid after reservation triggers the same atomic release and hold", async () => {
    const x = make(); let count = 0; x.p.now = () => ++count < 4 ? pretendNow : NaN;
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "readiness_expired" });
    expect(x.calls).toContain("release-and-hold:readiness_expired");
    expect(x.calls).not.toContain("begin");
  });
  test("unknown reservation or start never causes a dispatch or unsafe release", async () => {
    for (const phase of ["reserveOne", "begin"] as const) {
      const x = make(); x.p[phase] = never;
      const result = await guardedRun(settings, x.p);
      expect(result).toEqual({ status: "held", reason: phase === "begin" ? "start_unknown" : "reservation_unknown" });
      expect(x.calls).not.toContain("dispatch");
      expect(x.calls.some(c => c.startsWith("release"))).toBe(false);
    }
  });
  test("unknown dispatch and auth refusal settle and hold in one operation", async () => {
    for (const outcome of ["unknown", "authorization_refused"] as const) {
      const x = make(); x.p.dispatch = async () => { x.calls.push("dispatch"); return outcome; };
      const reason = outcome === "unknown" ? "dispatch_unknown" : "authorization_refused";
      expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason });
      expect(x.calls.at(-1)).toBe(`finish:${outcome}:${reason}`);
      expect(x.calls.filter(c => c === "dispatch")).toHaveLength(1);
    }
  });
  test("dispatch timeout remains unknown and is not retried", async () => {
    const x = make(); x.p.dispatch = never;
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "dispatch_unknown" });
    expect(x.calls.at(-1)).toBe("finish:unknown:dispatch_unknown");
  });
  test("an uncertain completion records a hold and does not retry", async () => {
    const x = make(); x.p.finish = never;
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "completion_unknown" });
    expect(x.calls.filter(c => c === "dispatch")).toHaveLength(1);
  });
  test("a timed-out late mint cannot reserve or dispatch", async () => {
    const x = make(); let release!: (value: any) => void;
    x.p.mint = async () => await new Promise(resolve => { release = resolve; });
    expect(await guardedRun(settings, x.p)).toEqual({ status: "held", reason: "credentials_unavailable" });
    release({ value: key, expiresAtMs: pretendNow + 180_000, repositoryId: 789, repositoryFullName: "example/research" });
    await Promise.resolve(); await Promise.resolve();
    expect(x.calls).not.toContain("reserve"); expect(x.calls).not.toContain("dispatch");
  });
  test("a late reservation or begin after timeout cannot cause a dispatch", async () => {
    for (const phase of ["reserveOne", "begin"] as const) {
      const x = make(); let release!: (value: any) => void;
      x.p[phase] = async () => await new Promise(resolve => { release = resolve; });
      const result = await guardedRun(settings, x.p);
      expect(result.status).toBe("held");
      release(phase === "reserveOne" ? { kind: "reserved", row: { id: "late", lease: "late" } } : true);
      await Promise.resolve(); await Promise.resolve();
      expect(x.calls).not.toContain("dispatch");
    }
  });
});

import { recoverHeld } from "./guarded-run.ts";
describe("synthetic operator recovery", () => {
  test("no hold or unreadable hold cannot clear anything", async () => {
    let resume = 0;
    const p = { inspect: async () => null, readiness: async () => true, resumeIfSafe: async () => { resume++; return true; } };
    expect(await recoverHeld(settings, p)).toEqual({ status: "not_held" });
    expect(resume).toBe(0);
    expect(await recoverHeld(settings, { ...p, inspect: never })).toEqual({ status: "needs_review" });
    expect(resume).toBe(0);
  });
  test("missing credentials leave the hold in place", async () => {
    let resume = 0;
    const p = { inspect: async () => ({ revision: "fictional-revision", reason: "credentials_unavailable" as const }), readiness: async () => false, resumeIfSafe: async () => { resume++; return true; } };
    expect(await recoverHeld(settings, p)).toEqual({ status: "not_ready" });
    expect(resume).toBe(0);
  });
  test("resume requires unchanged hold and transactionally resolved unknown work", async () => {
    let revision = "one"; let unknown = true; let held = true;
    const p = { inspect: async () => ({ revision, reason: "dispatch_unknown" as const }), readiness: async () => true, resumeIfSafe: async (expected: string) => { if (unknown || expected !== revision) return false; held = false; return true; } };
    expect(await recoverHeld(settings, p)).toEqual({ status: "needs_review" }); expect(held).toBe(true);
    unknown = false;
    expect(await recoverHeld(settings, { ...p, readiness: async () => { revision = "two"; return true; } })).toEqual({ status: "needs_review" }); expect(held).toBe(true);
    expect(await recoverHeld(settings, p)).toEqual({ status: "resumed" }); expect(held).toBe(false);
  });
  test("an uncertain resume is not repeated", async () => {
    let calls = 0;
    const p = { inspect: async () => ({ revision: "one", reason: "dispatch_unknown" as const }), readiness: async () => true, resumeIfSafe: async () => { calls++; return never(); } };
    expect(await recoverHeld(settings, p)).toEqual({ status: "resume_unknown" }); expect(calls).toBe(1);
  });
});
