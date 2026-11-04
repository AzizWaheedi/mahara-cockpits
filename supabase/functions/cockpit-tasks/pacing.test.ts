import { describe, expect, test } from "bun:test";
import { CLICKUP_BUSY } from "../_shared/clickupRetry";
import { ClickUpReader, callsPerMinute } from "./clickup";
import { runDelta } from "./delta";
import { runDoctor } from "./doctor";
import { runSeats } from "./seats";
import { cuTask, kit, NOW } from "./testkit";

// The task mirror's pace on ClickUp Business (docs/requests/CLICKUP-DOWNGRADE.md
// 1.4 and 2.2): the delta and seats readers keep to 30 calls a minute (2 s
// apart) and never retry; a reader a person is waiting on is not paced and
// tries once more after ClickUp's 429.

/** A kit whose sleeps and ClickUp calls are recorded on the fake clock. */
function timed(env: Record<string, string> = {}) {
  const k = kit({ env });
  const slept: number[] = [];
  const at: { path: string; t: number }[] = [];
  const sleep = k.deps.sleep;
  k.deps.sleep = async ms => {
    slept.push(ms);
    await sleep(ms);
  };
  const real = k.deps.clickupFetch;
  k.deps.clickupFetch = async (input, init) => {
    at.push({
      path: new URL(String(input)).pathname.replace(/^\/api\/v2\//, ""),
      t: k.deps.now(),
    });
    return real(input, init);
  };
  const gaps = () => at.slice(1).map((c, i) => c.t - at[i].t);
  return { k, slept, at, gaps };
}
const limited = (headers: Record<string, string> = { "Retry-After": "1" }) =>
  new Response(
    JSON.stringify({ err: "Rate limit reached", ECODE: "APP_002" }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", ...headers },
    },
  );

describe("callsPerMinute", () => {
  test("30 by default, 5 to 60 whatever is set, junk is the default", () => {
    const pace = (v?: string) =>
      callsPerMinute(name =>
        name === "CLICKUP_TASKS_CALLS_PER_MINUTE" ? v : undefined,
      );
    expect(pace()).toBe(30);
    expect(pace("120")).toBe(60);
    expect(pace("1000")).toBe(60);
    expect(pace("x")).toBe(30);
    expect(pace("")).toBe(30);
    expect(pace("0")).toBe(30);
    expect(pace("-20")).toBe(30);
    expect(pace("2")).toBe(5);
    expect(pace("45")).toBe(45);
    expect(pace("25.7")).toBe(25);
  });
});

describe("the interactive reader", () => {
  test("two GETs with no wait between them", async () => {
    const t = timed();
    t.k.clickup.tasks.set("abc123", cuTask("abc123"));
    const cu = new ClickUpReader(t.k.deps, "action-1", { interactive: true });
    expect(cu.perMinute).toBeNull();
    await cu.get("task/abc123");
    await cu.get("task/abc123/comment");
    expect(t.slept).toEqual([]);
    expect(t.gaps()).toEqual([0]);
  });

  test("a 429 is tried once more after ClickUp's wait, each try with its own rows", async () => {
    const t = timed();
    t.k.clickup.tasks.set("abc123", cuTask("abc123"));
    const real = t.k.deps.clickupFetch;
    let n = 0;
    t.k.deps.clickupFetch = async (input, init) =>
      n++ === 0 ? limited() : real(input, init);
    const cu = new ClickUpReader(t.k.deps, "action-1", { interactive: true });
    expect((await cu.get("task/abc123")).id).toBe("abc123");
    expect(n).toBe(2);
    expect(t.slept).toEqual([1_000]);
    expect(t.k.receipts.map(r => [r.phase, r.http_status ?? null])).toEqual([
      ["intent", null],
      ["response", 429],
      ["intent", null],
      ["response", 200],
    ]);
    expect(t.k.receipts.every(r => r.action_id === "action-1")).toBe(true);
  });

  test("a second 429 says ClickUp is at its limit and what to do", async () => {
    const t = timed();
    t.k.deps.clickupFetch = async () => limited();
    const cu = new ClickUpReader(t.k.deps, "action-1", { interactive: true });
    await expect(cu.get("task/abc123")).rejects.toThrow(CLICKUP_BUSY);
    expect(t.slept).toEqual([1_000]);
    expect(t.k.receipts.filter(r => r.phase === "response").length).toBe(2);
  });
});

describe("the delta and seats readers", () => {
  test("a paced reader keeps 2 s between calls and does not retry a 429", async () => {
    const t = timed();
    const cu = new ClickUpReader(t.k.deps, "action-1");
    expect(cu.perMinute).toBe(30);
    await cu.get("user");
    await cu.get("team");
    expect(t.slept).toEqual([2_000]);
    let n = 0;
    t.k.deps.clickupFetch = async () => {
      n++;
      return limited();
    };
    const again = new ClickUpReader(t.k.deps, "action-2");
    await expect(again.get("user")).rejects.toThrow(
      new Error("clickup rejected the request (429): Rate limit reached"),
    );
    expect(n).toBe(1);
  });

  test("a delta run reads 2 s apart, and a refused thread is not read twice", async () => {
    const t = timed();
    t.k.clickup.delta = [cuTask("d1"), cuTask("d2")];
    t.k.db.handlers.cockpit_task_mirror_comment_due = () => [
      { taskId: "c1", sinceMs: NOW - 600_000 },
      { taskId: "c2", sinceMs: NOW - 600_000 },
      { taskId: "c3", sinceMs: NOW - 600_000 },
    ];
    t.k.clickup.fail.set("task/c2/comment", 429);
    await runDelta(t.k.deps);
    expect(t.at.length).toBeGreaterThanOrEqual(4);
    expect(t.gaps().every(g => g === 2_000)).toBe(true);
    expect(t.at.filter(c => c.path === "task/c2/comment").length).toBe(1);
  });

  test("a seats run reads 2 s apart at the default pace", async () => {
    const t = timed();
    t.k.db.handlers.cockpit_task_mirror_inputs = () => ({
      cursorMs: null,
      baselinedAt: null,
      linked: [
        {
          memberId: "m1",
          clickupUserId: 113459516,
          label: "the systems manager",
        },
      ],
      notLinked: 0,
    });
    await runSeats(t.k.deps);
    expect(t.at.length).toBeGreaterThanOrEqual(4);
    expect(t.gaps().every(g => g === 2_000)).toBe(true);
  });

  test("an old pace setting above 60 is held at 60 (1 s apart)", async () => {
    const t = timed({ CLICKUP_TASKS_CALLS_PER_MINUTE: "120" });
    t.k.clickup.delta = [cuTask("d1")];
    await runDelta(t.k.deps);
    expect(t.gaps().every(g => g === 1_000)).toBe(true);
  });
});

describe("the doctor", () => {
  const withLimit = (t: ReturnType<typeof timed>, limit: string) => {
    const real = t.k.deps.clickupFetch;
    t.k.deps.clickupFetch = async (input, init) => {
      const res = await real(input, init);
      const headers = new Headers(res.headers);
      headers.set("X-RateLimit-Limit", limit);
      return new Response(await res.text(), { status: res.status, headers });
    };
  };
  const ready = (t: ReturnType<typeof timed>) => {
    t.k.db.handlers.cockpit_task_mirror_inputs = () => ({
      linked: [{ memberId: "a", clickupUserId: 1, label: "the CSM" }],
      notLinked: 0,
      states: {
        delta: { ok: true, note: "fine" },
        seats: { ok: true, note: "fine" },
      },
    });
  };

  test("on ClickUp Business it names the limit and the task mirror's pace, with no wait", async () => {
    const t = timed();
    ready(t);
    withLimit(t, "100");
    const d = await runDoctor(t.k.deps);
    expect(d.ok).toBe(true);
    expect(d.note).toBe(
      "ClickUp answers (100 calls a minute allowed; the task mirror reads at 30 a minute); 1 seats linked, 0 not linked.",
    );
    expect(d.pace).toBe(30);
    expect(t.slept).toEqual([]);
  });

  test("a pace above 60% of the limit ClickUp reports is a problem that says what to lower", async () => {
    const t = timed({ CLICKUP_TASKS_CALLS_PER_MINUTE: "45" });
    ready(t);
    withLimit(t, "60");
    const d = await runDoctor(t.k.deps);
    expect(d.ok).toBe(false);
    expect(d.problems).toEqual([
      "The task mirror is set to 45 calls a minute, more than 60% of the 60 ClickUp allows this token. Lower CLICKUP_TASKS_CALLS_PER_MINUTE.",
    ]);
  });
});
