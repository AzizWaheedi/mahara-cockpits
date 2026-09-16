import { afterAll, beforeEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { internal } from "../../convex/_generated/api";
import { replaceGrainForSync } from "../../convex/sync";
import { type FakeApp, makeApp, restoreGlobals, setNow, web } from "./fakeCtx";

const NOW = Date.parse("2026-09-16T12:00:00Z");
let app: FakeApp;
beforeEach(async () => {
  setNow(NOW);
  web.clear();
  app = await makeApp();
});
afterAll(restoreGlobals);
const job = (status = "claimed", tries = 1) => ({
  kind: "test",
  refId: "test",
  prompt: "p",
  schema: {},
  status,
  tries,
  createdAt: NOW - 3600000,
  claimedAt: NOW - 3600000,
});
test("live completion, errors, reaping and retirement keep migrated counts exact", async () => {
  const [success, error, reaped, retired] = app.seed("aiJobs", [
    job(),
    job("claimed", 4),
    job("claimed", 4),
    job("queued"),
  ]);
  await app.run(internal.migrations.backfillAiJobs, {});
  await app.run(internal.askAi.complete, {
    id: success,
    result: { answer: "test" },
  });
  await app.run(internal.askAi.complete, { id: error, error: "test failure" });
  await app.run(internal.askAi.reap, {});
  await app.run(internal.askAi.retire, {
    ids: [retired],
    reason: "thread removed",
  });
  expect(app.count("aiJobsDone")).toBe(4);
  expect(await app.run(internal.askAi.health, {})).toEqual({
    queued: 0,
    failed: 3,
    lastDoneAt: NOW,
  });
  await app.run(internal.askAi.complete, {
    id: success,
    result: { answer: "duplicate" },
  });
  expect(app.docs("aiJobCounts")[0].done).toBe(1);
  await app.run(internal.askAi.complete, {
    id: reaped,
    result: { answer: "late answer" },
  });
  expect(app.docs("aiJobCounts")[0].done).toBe(2);
  expect(app.docs("aiJobCounts")[0].failed).toBe(2);
  expect(
    (await app.run(internal.migrations.backfillAiJobs, { chain: false })).wrote,
  ).toBe(0);
});
test("finished chat history costs zero document reads on all three idle queue queries", async () => {
  for (const dir of [
    "media-buyer-cockpit",
    "client-success-cockpit",
    "creative-director-cockpit",
  ]) {
    const a = await makeApp(
      resolve(import.meta.dir, `../../../${dir}/convex`),
      { validate: false },
    );
    a.seed(
      "hermesChat",
      Array.from({ length: 200 }, (_, i) => ({
        thread: "test@example.com",
        role: "user",
        text: "test",
        context: "x".repeat(6000),
        status: "answered",
        at: NOW - i,
      })),
    );
    const result = await a.measure("hermes:pending", {});
    expect(result.result).toEqual([]);
    expect(result.delta.docsRead).toBe(0);
  }
});
test("relay sweep finds an older open relay even behind 1000 delivered rows", async () => {
  const [id] = app.seed("chatRelay", [
    { app: "csm", messageId: "open", jobId: "job", at: NOW - 100000 },
  ]);
  app.seed(
    "chatRelay",
    Array.from({ length: 1000 }, (_, i) => ({
      app: "csm",
      messageId: `done-${i}`,
      jobId: "job",
      at: NOW - i,
      deliveredAt: NOW,
    })),
  );
  const result = await app.measure(internal.hermesDrain.openRelays, {});
  expect(result.result.map(r => r._id)).toEqual([id]);
  expect(result.delta.docsRead).toBe(1);
});
test("unchanged calendar statuses do not write in any cockpit", async () => {
  for (const dir of [
    "media-buyer-cockpit",
    "client-success-cockpit",
    "creative-director-cockpit",
  ]) {
    const a = await makeApp(resolve(import.meta.dir, `../../../${dir}/convex`));
    a.seed("calendarLinks", [
      {
        owner: "test@example.com",
        calendarId: "test@example.com",
        status: "error",
        note: "Not shared",
        events: 0,
        createdAt: NOW,
      },
    ]);
    const fn =
      dir === "media-buyer-cockpit"
        ? "personalCalendars:setStatus"
        : "comms:calendarLinkStatus";
    const args = {
      statuses: [
        {
          calendarId: "test@example.com",
          status: "error",
          note: "Not shared",
          events: 0,
        },
      ],
    };
    expect((await a.measure(fn, args)).delta.docsWritten).toBe(0);
    expect(
      (
        await a.measure(fn, {
          statuses: [
            { calendarId: "test@example.com", status: "ok", events: 1 },
          ],
        })
      ).delta.docsWritten,
    ).toBe(1);
  }
});
test("idle calendar check does not read the client and campaign tables or contact Google", async () => {
  const a = await makeApp(undefined, { validate: false });
  a.seed("calendarLinks", [
    {
      owner: "test@example.com",
      calendarId: "test@example.com",
      status: "ok",
      createdAt: NOW,
    },
  ]);
  const result = await a.measure(internal.personalCalendars.rowsFor, {
    app: "mb",
    onlyPending: true,
  });
  expect(result.result).toEqual({ rows: [], statuses: [] });
  expect(result.delta.fetches).toBe(0);
  expect(a.meter.callsTo("comms:clientNames")).toHaveLength(0);
});
test("empty campaign snapshot preserves daily and booking history without writes", async () => {
  const a = await makeApp(undefined, { validate: false });
  a.seed("dailyStats", [{ date: "2026-09-15", spend: 50 }]);
  a.seed("bookingEvents", [{ date: "2026-09-15" }]);
  const before = a.meter.mark();
  expect(
    await a.inlineRun("action", ctx =>
      replaceGrainForSync(ctx, {
        campaignCount: 0,
        since: "2026-08-15",
        daily: [],
        bookings: [],
      }),
    ),
  ).toEqual({ preserved: true });
  expect(a.count("dailyStats")).toBe(1);
  expect(a.count("bookingEvents")).toBe(1);
  expect(a.meter.since(before).docsWritten).toBe(0);
});
test("daily winner gate survives a delayed sync and skips heavy reads while fresh", async () => {
  app.seed("jobMarks", [{ key: "archiveWinners", at: NOW }]);
  const skipped = await app.measure(internal.market.archiveWinners, {
    ifDue: true,
  });
  expect(skipped.delta.docsRead).toBe(1);
  expect(skipped.delta.docsWritten).toBe(0);
  setNow(NOW + 21 * 3600000);
  await app.run(internal.market.archiveWinners, { ifDue: true });
  expect(app.docs("jobMarks")[0].at).toBe(NOW + 21 * 3600000);
});
test("Hermes heartbeat coalesces success but immediately records recovery", async () => {
  await app.run(internal.askAi.heartbeat, {});
  expect(
    (await app.measure(internal.askAi.heartbeat, {})).delta.docsWritten,
  ).toBe(0);
  const row = app.docs("sourceHealth")[0];
  app.patchDirect(row._id, { ok: false, streak: 3, alertedAt: NOW });
  expect(
    (await app.measure(internal.askAi.heartbeat, {})).delta.docsWritten,
  ).toBe(1);
  expect(app.docs("sourceHealth")[0].alertedAt).toBeUndefined();
});

test("a late error that requeues a retired job clears its completion time and summary", async () => {
  const [id] = app.seed("aiJobs", [{ ...job("failed", 1), doneAt: NOW }]);
  await app.run(internal.migrations.backfillAiJobs, {});
  await app.run(internal.askAi.complete, { id, error: "late worker error" });
  expect(app.docs("aiJobs")[0].status).toBe("queued");
  expect(app.docs("aiJobs")[0].doneAt).toBeUndefined();
  expect(app.count("aiJobsDone")).toBe(0);
  expect(app.docs("aiJobCounts")[0].failed).toBe(0);
});
