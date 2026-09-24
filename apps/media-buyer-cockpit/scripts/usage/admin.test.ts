import { afterAll, beforeEach, expect, test } from "bun:test";
import { api, internal } from "../../convex/_generated/api";
import { type FakeApp, makeApp, restoreGlobals, setNow, web } from "./fakeCtx";

const NOW = Date.parse("2026-09-16T12:00:00Z"),
  DAY = 86400_000;
let app: FakeApp, admin: string;
async function fresh() {
  app = await makeApp(undefined, { validate: false });
  admin = await app.makeUser({ email: "aziz@maharamedia.com" });
  app.seed("members", [
    { email: "aziz@maharamedia.com", roles: ["admin"], clients: [] },
  ]);
}
beforeEach(async () => {
  setNow(NOW);
  web.clear();
  await fresh();
});
afterAll(restoreGlobals);
function seed(n = 500) {
  app.seed("cockpitHealth", [
    {
      app: "media-buyer",
      at: NOW,
      ok: true,
      checks: [{ name: "dashboard", ok: true }],
    },
  ]);
  app.seed("campaigns", [
    { campaignName: "Live", internal: false, boardAdStatus: "Live" },
    { campaignName: "Internal", internal: true, boardAdStatus: "Live" },
  ]);
  app.seed("clients", [{ name: "Test client" }]);
  app.seed(
    "syncRuns",
    Array.from({ length: 50 }, (_, i) => ({
      at: NOW - (50 - i) * 60000,
      ok: true,
      role: i === 49 ? "csm" : undefined,
    })),
  );
  app.seed(
    "alerts",
    Array.from({ length: 30 }, (_, i) => ({
      at: NOW - (30 - i) * 60000,
      text: `Alert ${i}`,
    })),
  );
  app.seed("cronRuns", [
    {
      job: "hermes relay",
      ok: true,
      streak: 0,
      at: NOW - 600000,
      ms: 5,
      everyMin: 1,
    },
  ]);
  app.seed("sourceHealth", [
    {
      source: "hermes",
      ok: true,
      streak: 0,
      at: NOW - 600000,
      lastOkAt: NOW - 600000,
    },
  ]);
  app.seed("aiJobs", [
    ...Array.from({ length: n }, (_, i) => ({
      kind: "chat",
      refId: `history-${i}`,
      prompt: "p".repeat(6000),
      schema: {},
      status: "done",
      tries: 1,
      createdAt: NOW - (i + 1) * 3600000,
      doneAt: NOW - (i + 1) * 3600000,
    })),
    {
      kind: "chat",
      refId: "failed",
      status: "failed",
      doneAt: NOW - 900000,
      createdAt: NOW - 1200000,
      prompt: "p",
      schema: {},
      tries: 4,
    },
    ...["queued", "claimed"].map(status => ({
      kind: "chat",
      refId: status,
      status,
      createdAt: NOW,
      prompt: "p".repeat(6000),
      schema: {},
      tries: 1,
    })),
  ]);
  app.seed(
    "agentActions",
    Array.from({ length: n * 4 }, (_, i) => ({
      at: NOW - (n * 4 - i) * 60000,
      method: "GET",
      path: `test/${i}`,
      ok: true,
      params: { padding: "x".repeat(1000) },
    })),
  );
}
async function backfill() {
  let cursor: string | null = null;
  do {
    cursor = (
      await app.run(internal.migrations.backfillAiJobs, {
        cursor,
        chain: false,
        pageSize: 500,
      })
    ).cursor;
  } while (cursor);
}
const refs = [
  api.portal.adminHealth,
  api.portal.adminSources,
  api.portal.adminJobs,
  api.portal.adminActivity,
  api.portal.adminActions,
  api.portal.adminCounts,
];
function legacy(now: number) {
  const jobs = app.docs("aiJobs");
  return {
    queued: jobs.filter(j => j.status === "queued").length,
    doneToday: jobs.filter(j => (j.doneAt ?? 0) > now - DAY).length,
    lastDone: Math.max(0, ...jobs.map(j => j.doneAt ?? 0)) || null,
    actions: app
      .docs("agentActions")
      .filter(a => a.at > now - DAY)
      .sort((a, b) => b.at - a.at)
      .slice(0, 8)
      .map(a => ({
        at: a.at,
        note: a.note ?? `${a.method} ${a.path}`,
        ok: a.ok,
      })),
  };
}
test("admin values match legacy before/after migration and rolling-day boundary", async () => {
  seed();
  for (const migrated of [false, true]) {
    if (migrated) await backfill();
    for (const now of [NOW, NOW + 20 * 60000]) {
      setNow(now);
      const expected = legacy(now);
      const overview = await app.run(api.portal.overview, {}, { as: admin });
      expect(overview.hermes).toEqual(expected);
      const h = await app.run(
        api.portal.adminHermes,
        { since: Math.floor(now / 900000) * 900000 - DAY - 900000 },
        { as: admin },
      );
      const actions = await app.run(api.portal.adminActions, {}, { as: admin });
      expect({
        queued: h.queued,
        doneToday: h.recentDone.filter(at => at > now - DAY).length,
        lastDone: h.lastDone,
        actions: actions.filter(a => a.at > now - DAY),
      }).toEqual(expected);
      expect(await app.run(api.portal.adminCounts, {}, { as: admin })).toEqual({
        campaigns: 2,
        liveCampaigns: 1,
        clients: 1,
        members: 1,
        admins: 1,
      });
      expect(
        await app.run(api.portal.adminActivity, {}, { as: admin }),
      ).toEqual({ lastSync: overview.lastSync, alerts: overview.alerts });
      expect(await app.run(api.portal.adminHealth, {}, { as: admin })).toEqual(
        overview.health,
      );
      expect(await app.run(api.portal.adminSources, {}, { as: admin })).toEqual(
        overview.sources,
      );
      expect(await app.run(api.portal.adminJobs, {}, { as: admin })).toEqual(
        overview.scheduled,
      );
    }
  }
});
test("heartbeat writes invalidate only the associated card and repeated success writes nothing", async () => {
  seed();
  await backfill();
  const watches = await Promise.all(
    refs.map(ref => app.watch(ref, {}, { as: admin })),
  );
  const hermes = await app.watch(
    api.portal.adminHermes,
    { since: NOW - DAY - 900000 },
    { as: admin },
  );
  const beat = { job: "hermes relay", ok: true, ms: 5, everyMin: 1 };
  await app.run(internal.health.beat, beat);
  expect(watches.map(w => w.triggers)).toEqual([0, 0, 1, 0, 0, 0]);
  expect(hermes.triggers).toBe(0);
  expect(
    (await app.measure(internal.health.beat, beat)).delta.docsWritten,
  ).toBe(0);
  await app.run(internal.health.recordMany, {
    entries: [{ source: "hermes", ok: true }],
  });
  expect(watches.map(w => w.triggers)).toEqual([0, 1, 1, 0, 0, 0]);
  expect(hermes.triggers).toBe(0);
  expect(
    (
      await app.measure(internal.health.recordMany, {
        entries: [{ source: "hermes", ok: true }],
      })
    ).delta.docsWritten,
  ).toBe(0);
  setNow(NOW + 300000);
  expect(
    (await app.measure(internal.health.beat, beat)).delta.docsWritten,
  ).toBe(1);
});
test("10x history growth keeps admin log reads bounded", async () => {
  for (const count of [500, 5000]) {
    await fresh();
    seed(count);
    await backfill();
    const h = await app.measure(
      api.portal.adminHermes,
      { since: NOW - DAY - 900000 },
      { as: admin },
    );
    const actions = await app.measure(
      api.portal.adminActions,
      {},
      { as: admin },
    );
    const overview = await app.measure(api.portal.overview, {}, { as: admin });
    expect(h.delta.bytesRead).toBeLessThan(20000);
    expect(actions.delta.bytesRead).toBeLessThan(16000);
    expect(actions.result).toHaveLength(8);
    expect(overview.delta.bytesRead).toBeLessThan(40000);
    console.log(
      `admin history=${count}: Hermes ${h.delta.bytesRead} B, actions ${actions.delta.bytesRead} B, overview ${overview.delta.bytesRead} B`,
    );
  }
});
test("all seven cards reject missing authentication and non-admin seats", async () => {
  const other = await app.makeUser({ email: "nada@maharamedia.com" });
  for (const ref of refs) {
    await expect(app.run(ref, {})).rejects.toThrow();
    await expect(app.run(ref, {}, { as: other })).rejects.toThrow();
  }
  await expect(
    app.run(api.portal.adminHermes, { since: NOW - DAY }, { as: other }),
  ).rejects.toThrow();
});
test("failures, third-failure fix jobs and recovery alerts survive coalescing", async () => {
  seed();
  const beat = {
    job: "hermes relay",
    ok: false,
    ms: 5,
    everyMin: 1,
    error: "test failure",
  };
  for (let i = 1; i <= 3; i++) {
    await app.run(internal.health.beat, beat);
    expect(app.docs("cronRuns")[0].streak).toBe(i);
  }
  expect(app.meter.callsTo("fixRequests:file")).toHaveLength(1);
  expect(
    (
      await app.measure(internal.health.beat, {
        ...beat,
        ok: true,
        error: undefined,
      })
    ).delta.docsWritten,
  ).toBe(1);
  for (let i = 1; i <= 3; i++)
    await app.run(internal.health.recordMany, {
      entries: [{ source: "meta", ok: false, error: "test failure" }],
    });
  expect(
    (
      await app.run(internal.health.recordMany, {
        entries: [{ source: "meta", ok: true }],
      })
    )[0],
  ).toContain("working again");
});

test("portal metadata is public but SSO token minting rejects anonymous calls", async () => {
  const result = await app.measure(api.portal.info, {});
  expect(result.result).toEqual({
    cockpits: ["media_buyer", "csm", "creative", "editor", "sales"],
    audience: "mahara-portal",
  });
  expect(result.delta.docsRead).toBe(0);
  await expect(
    app.run(api.portal.mintToken, { cockpit: "csm" }),
  ).rejects.toThrow("Sign in first.");
});
