/**
 * Growth control (usage plan S1): the aiJobsDone / aiJobCounts backfill and
 * the retention job, which stays a dry run until Aziz agrees the windows.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { internal } from "../../convex/_generated/api";
import { type FakeApp, makeApp, restoreGlobals, setNow, web } from "./fakeCtx";

const DAY = 86_400_000;
const START = Date.parse("2026-09-16T08:00:00Z");

type Job = {
  status: string;
  doneAt?: number;
  createdAt: number;
};

function job(j: Job) {
  return {
    kind: "assist_copy",
    refId: "ref",
    prompt: "p".repeat(6000),
    schema: {},
    tries: 1,
    ...j,
  };
}

let app: FakeApp;

beforeEach(async () => {
  setNow(START);
  web.clear();
  app = await makeApp();
});

afterAll(() => {
  restoreGlobals();
});

/** The numbers today's code computes from the job rows. */
function legacy(jobs: Record<string, any>[], now: number) {
  const done = jobs.filter(j => j.status === "done");
  return {
    failed: jobs.filter(j => j.status === "failed").length,
    lastDoneAt: done.reduce<number | undefined>(
      (m, r) => (r.doneAt && (!m || r.doneAt > m) ? r.doneAt : m),
      undefined,
    ),
    doneToday: jobs.filter(j => (j.doneAt ?? 0) > now - DAY).length,
    lastDone: Math.max(0, ...jobs.map(j => j.doneAt ?? 0)) || null,
  };
}

/** The same numbers from the new tables, the way the readers will get them. */
async function fromTables(a: FakeApp, now: number) {
  return await a.inlineRun("query", async ctx => {
    const counts = await ctx.db
      .query("aiJobCounts")
      .withIndex("by_key", (q: any) => q.eq("key", "all"))
      .unique();
    const lastDoneRow = await ctx.db
      .query("aiJobsDone")
      .withIndex("by_status_doneAt", (q: any) => q.eq("status", "done"))
      .order("desc")
      .first();
    const recent = await ctx.db
      .query("aiJobsDone")
      .withIndex("by_doneAt", (q: any) => q.gt("doneAt", now - DAY))
      .collect();
    const newest = await ctx.db
      .query("aiJobsDone")
      .withIndex("by_doneAt")
      .order("desc")
      .first();
    return {
      failed: counts?.failed ?? -1,
      lastDoneAt: lastDoneRow?.doneAt,
      doneToday: recent.length,
      lastDone: newest?.doneAt ?? null,
    };
  });
}

function seedJobs(a: FakeApp) {
  return a.seed("aiJobs", [
    ...Array.from({ length: 30 }, (_, i) =>
      job({
        status: "done",
        createdAt: START - i * 3_600_000,
        doneAt: START - i * 3_600_000 + 60_000,
      }),
    ),
    // Reaped: failed with doneAt.
    ...Array.from({ length: 5 }, (_, i) =>
      job({
        status: "failed",
        createdAt: START - (i + 2) * DAY,
        doneAt: START - (i + 2) * DAY + 3_600_000,
      }),
    ),
    // Failed on complete's error path: no doneAt.
    job({ status: "failed", createdAt: START - DAY }),
    job({ status: "failed", createdAt: START - 2 * DAY }),
    job({ status: "queued", createdAt: START }),
    job({ status: "queued", createdAt: START }),
    job({ status: "queued", createdAt: START }),
    job({ status: "claimed", createdAt: START }),
    job({ status: "claimed", createdAt: START }),
  ]);
}

describe("backfillAiJobs", () => {
  test("pages through every job and matches today's numbers", async () => {
    seedJobs(app);
    const before = await app.run(internal.migrations.backfillStatus, {});
    expect(before.backfilledAt).toBeNull();

    const first = await app.measure(internal.migrations.backfillAiJobs, {
      pageSize: 7,
    });
    expect(first.result.isDone).toBe(false);
    // One page reads its 7 jobs plus a few tiny rows.
    expect(first.call.bytesRead).toBeLessThan(7 * 6200 + 2000);
    const pages = await app.flushScheduled();
    expect(pages.every(p => p.state === "success")).toBe(true);
    expect(pages).toHaveLength(6);

    const status = await app.run(internal.migrations.backfillStatus, {});
    expect(status).toEqual({ backfilledAt: START, failed: 7, done: 30 });
    expect(app.count("aiJobsDone")).toBe(37);
    expect(await fromTables(app, START)).toEqual(
      legacy(app.docs("aiJobs"), START),
    );
  });

  test("a second run writes no records", async () => {
    seedJobs(app);
    await app.run(internal.migrations.backfillAiJobs, {});
    await app.flushScheduled();
    const m = app.meter.mark();
    await app.run(internal.migrations.backfillAiJobs, {});
    await app.flushScheduled();
    const d = app.meter.since(m);
    expect(d.writes.aiJobsDone ?? 0).toBe(0);
    // Only backfilledAt is touched again.
    expect(d.writes.aiJobCounts).toBe(1);
  });

  test("live changes during and after the backfill keep the counts exact", async () => {
    const ids = seedJobs(app);
    const record = (id: string, status: string, doneAt?: number) =>
      app.inlineRun("mutation", async ctx => {
        const { recordJobFinish } = await import("../../convex/migrations");
        await ctx.db.patch(id, { status, doneAt });
        const j = await ctx.db.get(id);
        return await recordJobFinish(ctx, j);
      });

    // First page only, then a live writer runs before the rest.
    await app.run(internal.migrations.backfillAiJobs, {
      pageSize: 10,
      chain: false,
    });
    // Job 0 was on the first page: a done job now marked failed.
    await record(ids[0], "failed", START);
    // A queued job on a later page fails before the backfill sees it.
    expect(await record(ids[37], "failed", START + 1)).toBe(true);
    // A claimed job finishes.
    await record(ids[40], "done", START + 2);
    await app.run(internal.migrations.backfillAiJobs, {});
    await app.flushScheduled();
    // After the backfill: a failed job is put back in the queue, another is
    // completed, and one call repeats with nothing new.
    await record(ids[36], "queued");
    await record(ids[30], "done", START + 3);
    expect(await record(ids[30], "done", START + 3)).toBe(false);

    const status = await app.run(internal.migrations.backfillStatus, {});
    const jobs = app.docs("aiJobs");
    const want = legacy(jobs, START + 10);
    expect(status.failed).toBe(want.failed);
    expect(status.done).toBe(jobs.filter(j => j.status === "done").length);
    expect(await fromTables(app, START + 10)).toEqual(want);
    expect(app.count("aiJobsDone")).toBe(
      jobs.filter(j => j.status === "done" || j.status === "failed").length,
    );
  });
});

describe("retention (dry run)", () => {
  test("counts what the windows would delete and deletes nothing", async () => {
    // Backfill 40 days ago, so the finished-job records are old too.
    setNow(START - 40 * DAY);
    app.seed(
      "aiJobs",
      [
        job({
          status: "done",
          createdAt: START - 41 * DAY,
          doneAt: START - 40 * DAY - 1,
        }),
        job({
          status: "done",
          createdAt: START - 41 * DAY,
          doneAt: START - 40 * DAY - 2,
        }),
        job({ status: "failed", createdAt: START - 41 * DAY }),
        job({ status: "failed", createdAt: START - 41 * DAY }),
      ],
      { creationTime: START - 41 * DAY },
    );
    await app.run(internal.migrations.backfillAiJobs, {});
    await app.flushScheduled();
    setNow(START);
    app.seed("aiJobs", [
      job({ status: "done", createdAt: START - DAY, doneAt: START - DAY }),
      job({ status: "queued", createdAt: START }),
    ]);
    await app.run(internal.migrations.backfillAiJobs, {});
    await app.flushScheduled();

    const old = (days: number) => ({ creationTime: START - days * DAY });
    app.seed(
      "agentActions",
      Array.from({ length: 5 }, () => ({
        at: START - 100 * DAY,
        method: "GET",
        path: "/x",
        ok: true,
      })),
      old(100),
    );
    app.seed("agentActions", [
      { at: START, method: "GET", path: "/x", ok: true },
    ]);
    const run = (at: number) => ({
      at,
      ok: true,
      campaigns: 1,
      ads: 1,
      offBoard: 0,
    });
    app.seed(
      "syncRuns",
      Array.from({ length: 15 }, (_, i) => run(START - 40 * DAY + i)),
      old(40),
    );
    app.seed(
      "syncRuns",
      Array.from({ length: 12 }, (_, i) => run(START + i)),
    );
    app.seed(
      "alerts",
      Array.from({ length: 10 }, (_, i) => ({
        signature: `s${i}`,
        text: "t",
        at: START - 100 * DAY + i,
      })),
      old(100),
    );
    const relay = (at: number, deliveredAt?: number) => ({
      app: "csm",
      messageId: "m",
      jobId: "j",
      at,
      deliveredAt,
    });
    app.seed(
      "chatRelay",
      [
        relay(START - 10 * DAY, START - 10 * DAY),
        relay(START - 10 * DAY, START - 10 * DAY),
        relay(START - 10 * DAY),
        relay(START, START),
      ],
      old(10),
    );

    const counts = () =>
      Object.fromEntries(
        [
          "aiJobs",
          "aiJobsDone",
          "agentActions",
          "syncRuns",
          "alerts",
          "chatRelay",
        ].map(t => [t, app.count(t)]),
      );
    const before = counts();
    const { result, delta } = await app.measure(internal.retention.run, {});
    expect(result.dryRun).toBe(true);
    const would = Object.fromEntries(
      result.passes.map(p => [p.pass, p.wouldDelete]),
    );
    expect(would).toEqual({
      // Old finished jobs, found through their records (the dated two).
      aiJobs: 2,
      // The two failed jobs without doneAt, recorded 40 days ago.
      "aiJobs:undated": 2,
      // Records over 30 days old, less the newest of each status (the
      // newest done record is recent; the newest failed one is undated).
      aiJobsDone: 2,
      "aiJobsDone:undated": 1,
      agentActions: 5,
      syncRuns: 15,
      // 10 old alerts, the newest 8 kept.
      alerts: 2,
      chatRelay: 2,
    });
    expect(result.passes.every(p => p.deleted === 0 && !p.capped)).toBe(true);
    expect(delta.docsWritten).toBe(0);
    expect(counts()).toEqual(before);
    // The dry run never reads the 6 KB job rows.
    expect(delta.bytesRead).toBeLessThan(20_000);

    // Asking for real deletes changes nothing while deletes are off.
    const forced = await app.run(internal.retention.pruneBatch, {
      pass: "agentActions",
      dryRun: false,
    });
    expect(forced).toMatchObject({ matched: 5, deleted: 0 });
    expect(counts()).toEqual(before);
  });

  test("a dry run stops counting after five pages", async () => {
    app.seed(
      "chatRelay",
      Array.from({ length: 1200 }, () => ({
        app: "csm",
        messageId: "m",
        jobId: "j",
        at: START - 10 * DAY,
        deliveredAt: START - 10 * DAY,
      })),
      { creationTime: START - 10 * DAY },
    );
    const { result, delta } = await app.measure(internal.retention.run, {});
    const pass = result.passes.find(p => p.pass === "chatRelay")!;
    expect(pass).toMatchObject({
      scanned: 1000,
      wouldDelete: 1000,
      capped: true,
    });
    expect(delta.calls["retention:pruneBatch"]).toBe(PASS_COUNT + 4);
    expect(delta.docsWritten).toBe(0);
  });
});

const PASS_COUNT = 8;
