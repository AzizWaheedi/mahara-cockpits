import { describe, expect, test } from "bun:test";
import type { ReceiptRow } from "./db.ts";
import { makeDoor, readJob, sameSecret } from "./door.ts";
import {
  DESTINATIONS,
  edgeAccount,
  engagementRow,
  imageLeadRow,
  KUWAIT_ACCOUNT,
  LA_ACCOUNT,
  MAHARA_OWN,
  NOW,
  SAR_ACCOUNT,
  TOKEN,
  videoLeadRow,
  whatsappLeadRow,
} from "./fixtures.ts";
import { type Job, type RunDeps, retryable, sentence, startJob } from "./run.ts";
import { MetaError } from "./graph.ts";
import { ParseError } from "./parse.ts";
import { RpcError } from "./db.ts";
import { adsetsRoute, eachDay, fakeFetch, graphPath, insightsRoute, metaError, ok, type Route } from "./testkit.ts";

type Rec = { name: string; p: any };

/** The ads with form leads per account, as the database finds them for a nightly run's lead_ids tasks. */
const LEAD_ADS: Record<string, string[]> = {};

/**
 * The service RPCs, played in memory: begin keeps the tasks, claim leases
 * them in order, apply and reach apply keep what they were sent, fail puts a
 * task back or fails it. The SQL itself is tested against PGlite in
 * apps/media-buyer-cockpit/scripts/meta-ad-days-supabase.test.ts.
 */
function fakeDb(now: () => number) {
  const calls: Rec[] = [];
  const tasks: any[] = [];
  const applied: any[] = [];
  const reach: any[] = [];
  const leadIds: any[] = [];
  let runs = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const p = (args as any).p;
    calls.push({ name, p });
    if (name === "cockpit_meta_ad_days_inputs") {
      return {
        today: "2026-10-16",
        windows: [],
        ties: { source: "board_clients", clients: 1, linked: 1 },
        notLinked: [{ accountId: LA_ACCOUNT, name: "LA Account" }],
        hidden: [{ accountId: "6666666666666", name: "Mass Design" }],
      };
    }
    if (name === "cockpit_meta_ad_days_begin") {
      runs += 1;
      const runId = `00000000-0000-4000-8000-00000000000${runs}`;
      for (const t of p.tasks) tasks.push({ ...t, id: tasks.length + 1, runId, job: p.job, state: "pending", attempt: 0 });
      if (p.job === "nightly" && p.leadIds) {
        for (const a of p.accounts) {
          if (LEAD_ADS[a.accountId]) {
            tasks.push({ kind: "lead_ids", accountId: a.accountId, adIds: LEAD_ADS[a.accountId], id: tasks.length + 1, runId, job: p.job, state: "pending", attempt: 0 });
          }
        }
      }
      if (p.reach) {
        for (const a of p.accounts) {
          tasks.push({
            kind: p.reach === "all" ? "reach_all" : "reach_account", accountId: a.accountId, id: tasks.length + 1, runId, job: p.job, state: "pending", attempt: 0,
            windows: [{ key: "last_7", from: "2026-10-10", to: "2026-10-16" }, { key: "last_month", from: "2026-09-01", to: "2026-09-30" }],
          });
        }
      }
      return { started: true, runId, tasks: tasks.filter(t => t.runId === runId).length, notLinked: [] };
    }
    if (name === "cockpit_meta_ad_days_claim") {
      const open = tasks.filter(t => t.state === "pending" && (t.retryAt ?? 0) <= now()).slice(0, p.limit);
      for (const t of open) {
        t.state = "running";
        t.attempt += 1;
        t.leaseToken = `lease-${t.id}-${t.attempt}`;
      }
      return open.map(t => ({ id: t.id, runId: t.runId, job: t.job, kind: t.kind, accountId: t.accountId, accountName: null, since: t.since ?? null, until: t.until ?? null, windows: t.windows ?? null, adIds: t.adIds ?? null, leaseToken: t.leaseToken, attempt: t.attempt }));
    }
    if (name === "cockpit_meta_ad_days_apply") {
      const t = tasks.find(x => x.id === p.taskId);
      applied.push({ ...p, accountId: t.accountId });
      if (p.final) t.state = "done";
      return { ok: true, written: p.rows.length };
    }
    if (name === "cockpit_meta_lead_ids_apply") {
      const t = tasks.find(x => x.id === p.taskId);
      leadIds.push({ ...p, accountId: t.accountId });
      if (p.final) t.state = "done";
      return { ok: true, written: p.rows.length };
    }
    if (name === "cockpit_meta_reach_apply") {
      const t = tasks.find(x => x.id === p.taskId);
      reach.push({ ...p, accountId: t.accountId });
      if (p.final) t.state = "done";
      return { ok: true };
    }
    if (name === "cockpit_meta_ad_days_fail") {
      const t = tasks.find(x => x.id === p.taskId);
      t.state = p.retry && t.attempt < 4 ? "pending" : "failed";
      t.retryAt = t.state === "pending" ? now() + 180_000 * t.attempt : null;
      t.error = p.error;
      return { ok: true, state: t.state };
    }
    if (name === "cockpit_meta_ad_days_record") return { ok: true };
    if (name === "cockpit_meta_ad_days_status") {
      return {
        jobs: {},
        cancelledDelivering: [{ accountId: "7777777777777", name: "Old Client Ads", clientName: "Old Client", clientStatus: "Cancelled" }],
        billingStopped: [{ accountId: SAR_ACCOUNT, name: "Riyadh Client", clientName: "Riyadh", status: 3, statusLabel: "unsettled", lastSpendDay: "2026-10-09" }],
      };
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { rpc, calls, tasks, applied, reach, leadIds };
}

function edges(extra: Record<string, unknown>[] = []): Route {
  return c => {
    const path = graphPath(c);
    if (path === "767701513092162/owned_ad_accounts") {
      return ok({ data: [edgeAccount(MAHARA_OWN, "MaharaMedia", "USD", "America/Los_Angeles", 557.13), edgeAccount("3333333333333", "Owned, idle", "USD", "Asia/Kuwait", null)] });
    }
    if (path === "767701513092162/client_ad_accounts") {
      return ok({
        data: [
          edgeAccount(KUWAIT_ACCOUNT, "Kuwait Client", "USD", "Asia/Kuwait", 300),
          edgeAccount(SAR_ACCOUNT, "Riyadh Client", "SAR", "Asia/Riyadh", 1200),
          edgeAccount(LA_ACCOUNT, "LA Account", "USD", "America/Los_Angeles", 55),
          edgeAccount("4444444444444", "No spend", "USD", "Asia/Riyadh", 0),
          ...extra,
        ],
      });
    }
    return null;
  };
}

function deps(routes: Route[], over: Partial<RunDeps> = {}) {
  const f = fakeFetch(routes);
  let clock = NOW;
  const db = fakeDb(() => clock);
  const receipts: ReceiptRow[] = [];
  const d: RunDeps = {
    rpc: db.rpc,
    insertReceipt: async r => void receipts.push(r),
    fetch: f.request,
    token: () => TOKEN,
    now: () => clock,
    sleep: async ms => {
      clock += ms;
    },
    ...over,
  };
  return { d, db, calls: f.calls, receipts, tick: (ms: number) => (clock += ms) };
}

const daysRoute = (account: string, rows: (day: string) => Record<string, unknown>[]) => insightsRoute(account, (since, until) => eachDay(since, until).flatMap(rows));
const reachRoute: Route = c => {
  if (!/^act_\d+\/insights$/.test(graphPath(c)) || c.url.searchParams.get("level") === "ad" && c.url.searchParams.get("time_increment")) return null;
  const level = c.url.searchParams.get("level") ?? "";
  const ranges = JSON.parse(c.url.searchParams.get("time_ranges") ?? "[]");
  const id = graphPath(c).split("/")[0].replace("act_", "");
  const key = level === "account" ? { account_id: id } : { [`${level}_id`]: "120000000000103" };
  return ok({ data: ranges.slice(0, 1).map((r: any) => ({ ...key, impressions: "100", reach: "80", date_start: r.since, date_stop: r.until })), paging: { cursors: {} } });
};

describe("an hourly run", () => {
  test("finds the accounts that spent, leaves out Mahara's own, and reads each account's yesterday and today on its own clock", async () => {
    const t = deps([
      edges(),
      daysRoute(KUWAIT_ACCOUNT, d => [videoLeadRow(d), imageLeadRow(d)]),
      daysRoute(SAR_ACCOUNT, d => [engagementRow(d)]),
      daysRoute(LA_ACCOUNT, () => []),
      adsetsRoute(DESTINATIONS),
      reachRoute,
    ]);
    const r = await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    expect(r).toMatchObject({ ok: true, started: true });
    const begin = t.db.calls.find(c => c.name === "cockpit_meta_ad_days_begin")!.p;
    expect(begin.job).toBe("hourly");
    expect(begin.graphVersion).toBe("v25.0");
    expect(begin.reach).toBe("account");
    expect(begin.internal).toEqual([MAHARA_OWN]);
    expect(begin.accounts.map((a: any) => a.accountId)).toEqual([KUWAIT_ACCOUNT, SAR_ACCOUNT, LA_ACCOUNT]);
    expect(begin.tasks).toEqual([
      { kind: "days", accountId: KUWAIT_ACCOUNT, since: "2026-10-15", until: "2026-10-16" },
      { kind: "days", accountId: SAR_ACCOUNT, since: "2026-10-15", until: "2026-10-16" },
      { kind: "days", accountId: LA_ACCOUNT, since: "2026-10-14", until: "2026-10-15" },
    ]);
    // The discovery asked each edge for spend over the window, folded in.
    const edgeCall = t.calls.find(c => graphPath(c).endsWith("client_ad_accounts"))!;
    expect(edgeCall.url.searchParams.get("fields")).toContain('insights.time_range({"since":"2026-10-14","until":"2026-10-17"}){spend}');
    // Every ad-level read: unified attribution, one day at a time, the contract's fields.
    const reads = t.calls.filter(c => c.url.searchParams.get("time_increment") === "1");
    expect(reads.length).toBe(3);
    for (const c of reads) {
      expect(c.url.searchParams.get("use_unified_attribution_setting")).toBe("true");
      expect(c.url.searchParams.get("level")).toBe("ad");
      expect(c.url.searchParams.get("fields")).toContain("video_thruplay_watched_actions");
    }
    const kuwait = t.db.applied.find(a => a.accountId === KUWAIT_ACCOUNT);
    expect(kuwait.final).toBe(true);
    expect(kuwait.rows.length).toBe(4);
    const image = kuwait.rows.find((x: any) => x.ad_id === "120000000000104");
    expect([image.video_plays, image.video_3s, image.thruplays]).toEqual([null, null, null]);
    expect(kuwait.rows.map((x: any) => [x.destination_type, x.leads])).toEqual([
      ["ON_AD", 2],
      ["ON_AD", 1],
      ["ON_AD", 2],
      ["ON_AD", 1],
    ]);
    const sar = t.db.applied.find(a => a.accountId === SAR_ACCOUNT);
    expect(sar.rows.map((x: any) => [x.leads, x.lead_actions, x.destination_type])).toEqual([
      [null, 4, null],
      [null, 4, null],
    ]);
    expect(t.db.applied.find(a => a.accountId === LA_ACCOUNT).rows).toEqual([]);
    // One ad set read, for the one account with a lead campaign, asking for its one lead ad set.
    const adsetReads = t.calls.filter(c => graphPath(c).endsWith("/adsets"));
    expect(adsetReads.map(c => graphPath(c))).toEqual([`act_${KUWAIT_ACCOUNT}/adsets`]);
    expect(JSON.parse(adsetReads[0].url.searchParams.get("filtering")!)).toEqual([{ field: "id", operator: "IN", value: ["120000000000102"] }]);
    expect(adsetReads[0].url.searchParams.get("fields")).toBe("id,destination_type");
    expect(JSON.parse(adsetReads[0].url.searchParams.get("effective_status")!)).toContain("ARCHIVED");
    expect(JSON.parse(adsetReads[0].url.searchParams.get("effective_status")!)).not.toContain("DELETED");
    // Account-level reach for each account, over the task's windows.
    expect(t.db.reach.map(x => [x.accountId, x.level, x.final])).toEqual([
      [KUWAIT_ACCOUNT, "account", true],
      [SAR_ACCOUNT, "account", true],
      [LA_ACCOUNT, "account", true],
    ]);
    expect(t.db.reach[0].rows).toEqual([
      { key: KUWAIT_ACCOUNT, window_key: "last_7", reach: 80, impressions: 100 },
      { key: KUWAIT_ACCOUNT, window_key: "last_month", reach: 0, impressions: 0 },
    ]);
    expect(t.db.tasks.every(x => x.state === "done")).toBe(true);
    // Every Graph call left a receipt pair, and none carries the token.
    expect(t.receipts.length).toBe(t.calls.length * 2);
    expect(JSON.stringify(t.receipts)).not.toContain(TOKEN);
    expect(t.receipts.filter(x => x.run_id).every(x => x.run_id?.startsWith("00000000-0000-4000-8000"))).toBe(true);
  });

  test("a nightly run reads 28 days in pieces and every level of reach", async () => {
    const t = deps([
      edges(),
      daysRoute(KUWAIT_ACCOUNT, d => [videoLeadRow(d)]),
      daysRoute(SAR_ACCOUNT, () => []),
      daysRoute(LA_ACCOUNT, () => []),
      adsetsRoute(DESTINATIONS),
      reachRoute,
    ]);
    await startJob(t.d, { job: "nightly", dryRun: false, requestedBy: "cron" });
    const begin = t.db.calls.find(c => c.name === "cockpit_meta_ad_days_begin")!.p;
    expect(begin.reach).toBe("all");
    expect(begin.tasks.filter((x: any) => x.accountId === KUWAIT_ACCOUNT).length).toBe(4);
    expect(begin.window).toEqual({ since: "2026-09-01", until: "2026-10-17" });
    const kuwaitRows = t.db.applied.filter(a => a.accountId === KUWAIT_ACCOUNT).flatMap(a => a.rows);
    expect(kuwaitRows.length).toBe(28);
    expect(t.db.reach.filter(x => x.accountId === KUWAIT_ACCOUNT).map(x => x.level)).toEqual(["account", "campaign", "adset", "ad"]);
    const reachCall = t.calls.find(c => c.url.searchParams.get("level") === "adset")!;
    expect(reachCall.url.searchParams.get("fields")).toBe("adset_id,impressions,reach");
    expect(JSON.parse(reachCall.url.searchParams.get("time_ranges")!)).toEqual([
      { since: "2026-10-10", until: "2026-10-16" },
      { since: "2026-09-01", until: "2026-09-30" },
    ]);
  });

  test("a nightly run reads each lead ad's lead ids (ids and times only); an ad whose Page gives no lead access is counted, not fatal", async () => {
    const AD_OPEN = "120000000000103";
    const AD_CLOSED = "120000000000777";
    LEAD_ADS[KUWAIT_ACCOUNT] = [AD_OPEN, AD_CLOSED];
    try {
      const leads: Route = c => {
        if (graphPath(c) === `${AD_OPEN}/leads`) {
          return ok({
            data: [
              { id: "990000000000001", created_time: "2026-10-15T10:21:33+0000" },
              { id: "990000000000002", created_time: "2026-10-16T06:00:00+0000" },
            ],
            paging: { cursors: {} },
          });
        }
        if (graphPath(c) === `${AD_CLOSED}/leads`) return metaError(200, "Requires pages_manage_ads permission to manage the object");
        return null;
      };
      const t = deps([edges(), daysRoute(KUWAIT_ACCOUNT, () => []), daysRoute(SAR_ACCOUNT, () => []), daysRoute(LA_ACCOUNT, () => []), adsetsRoute(DESTINATIONS), reachRoute, leads]);
      await startJob(t.d, { job: "nightly", dryRun: false, requestedBy: "cron" });
      const leadCalls = t.calls.filter(c => graphPath(c).endsWith("/leads"));
      expect(leadCalls.map(c => graphPath(c))).toEqual([`${AD_OPEN}/leads`, `${AD_CLOSED}/leads`]);
      for (const c of leadCalls) {
        // Ids and times only: never field_data, so no name, phone or answer leaves Meta.
        expect(c.url.searchParams.get("fields")).toBe("id,created_time");
        const filter = JSON.parse(c.url.searchParams.get("filtering")!);
        expect(filter[0]).toMatchObject({ field: "time_created", operator: "GREATER_THAN" });
        expect(filter[0].value).toBe(Math.floor(NOW / 1000) - 31 * 86_400);
      }
      expect(t.db.calls.find(c => c.name === "cockpit_meta_ad_days_begin")!.p.leadIds).toBe(true);
      const applied = t.db.leadIds.find(x => x.accountId === KUWAIT_ACCOUNT);
      expect(applied.final).toBe(true);
      expect(applied.rows).toEqual([
        { lead_id: "990000000000001", ad_id: AD_OPEN, created_time: "2026-10-15T10:21:33.000Z" },
        { lead_id: "990000000000002", ad_id: AD_OPEN, created_time: "2026-10-16T06:00:00.000Z" },
      ]);
      expect(applied.note).toBe("Meta gives no lead access for 1 of 2 ads (the Page has not given Mahara lead access).");
      expect(t.db.tasks.find(x => x.kind === "lead_ids").state).toBe("done");
    } finally {
      delete LEAD_ADS[KUWAIT_ACCOUNT];
    }
  });

  test("a span Meta cannot build is read in halves, down to one day", async () => {
    let refusals = 0;
    const heavy = insightsRoute(KUWAIT_ACCOUNT, (since, until) => {
      if (since !== until) {
        refusals += 1;
        return metaError(1, "Please reduce the amount of data you're asking for, then retry your request", 500, 99);
      }
      return [videoLeadRow(since)];
    });
    const t = deps([edges(), heavy, daysRoute(SAR_ACCOUNT, () => []), daysRoute(LA_ACCOUNT, () => []), adsetsRoute(DESTINATIONS), reachRoute]);
    await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    expect(refusals).toBe(1);
    const applied = t.db.applied.find(a => a.accountId === KUWAIT_ACCOUNT);
    expect(applied.rows.map((r: any) => r.day)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(applied.note).toContain("Read in 2 pieces");
  });

  test("a WhatsApp lead ad set's messaging leads are not form leads; a deleted lead ad set is named; a rate-limited ad set read waits", async () => {
    let limited = true;
    const adsets = adsetsRoute(DESTINATIONS);
    const t = deps([
      edges(),
      daysRoute(KUWAIT_ACCOUNT, d => [videoLeadRow(d), whatsappLeadRow(d), imageLeadRow(d, { ad_id: "120000000000998", adset_id: "120000000000999" })]),
      daysRoute(SAR_ACCOUNT, () => []),
      daysRoute(LA_ACCOUNT, () => []),
      c => {
        if (graphPath(c) !== `act_${KUWAIT_ACCOUNT}/adsets` || !limited) return null;
        limited = false;
        return metaError(17, "User request limit reached", 400, 2446079);
      },
      adsets,
      reachRoute,
    ]);
    await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    // The first ad set read hit Meta's limit: nothing was written for the task, and it waits in the queue.
    expect(t.db.applied.find(a => a.accountId === KUWAIT_ACCOUNT)).toBeUndefined();
    const task = t.db.tasks.find(x => x.accountId === KUWAIT_ACCOUNT && x.kind === "days");
    expect(task.state).toBe("pending");
    expect(task.error).toContain("rate limit");
    t.tick(200_000);
    await startJob(t.d, { job: "continue", dryRun: false, requestedBy: "cron" });
    const kuwait = t.db.applied.find(a => a.accountId === KUWAIT_ACCOUNT);
    const byAd = (ad: string) => kuwait.rows.filter((x: any) => x.ad_id === ad).map((x: any) => [x.destination_type, x.leads, x.lead_actions]);
    expect(byAd("120000000000103")).toEqual([
      ["ON_AD", 2, 2],
      ["ON_AD", 2, 2],
    ]);
    expect(byAd("120000000000403")).toEqual([
      ["WHATSAPP", null, 3],
      ["WHATSAPP", null, 3],
    ]);
    expect(byAd("120000000000998")).toEqual([
      [null, 1, 1],
      [null, 1, 1],
    ]);
    expect(kuwait.note).toBe("Meta no longer lists lead ad set 120000000000999 (deleted), so its destination is unknown; messaging leads are left out by action type.");
    // Form leads over the task: the instant form's only.
    const formLeads = kuwait.rows.reduce((n: number, x: any) => n + (x.leads ?? 0), 0);
    expect(formLeads).toBe(2 * 2 + 2 * 1);
  });

  test("an account Meta will not show is failed with the fix; a rate limit goes back to the queue", async () => {
    const t = deps([
      edges(),
      insightsRoute(KUWAIT_ACCOUNT, () => metaError(100, "Object with ID 'act_1111111111111' does not exist, cannot be loaded due to missing permissions", 400, 33)),
      insightsRoute(SAR_ACCOUNT, () => metaError(17, "User request limit reached")),
      daysRoute(LA_ACCOUNT, () => []),
      reachRoute,
    ]);
    await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    const fails = t.db.calls.filter(c => c.name === "cockpit_meta_ad_days_fail").map(c => c.p);
    const kuwait = fails.find(f => t.db.tasks.find(x => x.id === f.taskId).accountId === KUWAIT_ACCOUNT);
    expect(kuwait.retry).toBe(false);
    expect(kuwait.error).toContain("code 100/33");
    expect(kuwait.error).toContain("not shared with Mahara's business");
    const sar = fails.filter(f => t.db.tasks.find(x => x.id === f.taskId).accountId === SAR_ACCOUNT);
    // The rate-limited read is not hammered: one try, then it waits in the queue for a later call.
    expect(sar.map(f => f.retry)).toEqual([true]);
    expect(t.db.tasks.find(x => x.accountId === SAR_ACCOUNT && x.kind === "days").state).toBe("pending");
    t.tick(200_000);
    await startJob(t.d, { job: "continue", dryRun: false, requestedBy: "cron" });
    expect(t.db.calls.filter(c => c.name === "cockpit_meta_ad_days_fail").length).toBe(fails.length + 1);
  });

  test("the drain stops claiming 30 seconds before its budget; what is left waits for the next call", async () => {
    const slow: Route = async c => {
      if (c.url.searchParams.get("time_increment") === "1") t.tick(40_000);
      return null;
    };
    const t = deps([edges(), slow, daysRoute(KUWAIT_ACCOUNT, () => []), daysRoute(SAR_ACCOUNT, () => []), daysRoute(LA_ACCOUNT, () => []), reachRoute], {
      budgetMs: 110_000,
      concurrency: 1,
    });
    const r = await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    expect(r.stoppedBy).toBe("budget");
    expect(t.db.tasks.filter(x => x.state === "pending").length).toBeGreaterThan(0);
    const more = await startJob(t.d, { job: "continue", dryRun: false, requestedBy: "cron" });
    expect(more.claimed).toBeGreaterThan(0);
  });

  test("when the accounts cannot be listed the job says why, where the board reads it", async () => {
    const t = deps([() => metaError(190, "Error validating access token: Session has expired", 400)]);
    const r = await startJob(t.d, { job: "hourly", dryRun: false, requestedBy: "cron" });
    expect(r.ok).toBe(false);
    const rec = t.db.calls.find(c => c.name === "cockpit_meta_ad_days_record")!.p;
    expect(rec).toMatchObject({ job: "hourly", ok: false });
    expect(rec.note).toContain("Make a new system-user token");
    expect(t.db.calls.some(c => c.name === "cockpit_meta_ad_days_begin")).toBe(false);
  });

  test("a dry run plans and writes nothing", async () => {
    const t = deps([edges()]);
    const r = await startJob(t.d, { job: "backfill", days: 14, dryRun: true, requestedBy: "aziz@maharamedia.com" });
    expect(r).toMatchObject({ ok: true, dryRun: true, job: "backfill", tasks: 6, reachTasks: 0 });
    expect(t.db.calls.map(c => c.name)).toEqual(["cockpit_meta_ad_days_inputs"]);
    expect((r.notLinked as any[]).map(a => a.accountId)).toEqual([LA_ACCOUNT]);
  });

  test("a backfill for named accounts reads only those", async () => {
    const t = deps([edges(), daysRoute(SAR_ACCOUNT, () => [])]);
    await startJob(t.d, { job: "backfill", days: 7, accounts: [SAR_ACCOUNT], dryRun: false, requestedBy: "aziz@maharamedia.com" });
    const begin = t.db.calls.find(c => c.name === "cockpit_meta_ad_days_begin")!.p;
    expect(begin.accounts.map((a: any) => a.accountId)).toEqual([SAR_ACCOUNT]);
    expect(begin.reach).toBeNull();
    expect(begin.requestedBy).toBe("aziz@maharamedia.com");
  });
});

describe("the doctor", () => {
  test("reads only, and names a missing secret, the system user and the accounts", async () => {
    const t = deps([c => (graphPath(c) === "me" ? ok({ id: "1", name: "Mahara System User" }) : null), edges()], {
      secrets: () => ({ META_SYSTEM_TOKEN: true, CRON_SECRET: false, SUPABASE_URL: true, SUPABASE_SERVICE_ROLE_KEY: true }),
    });
    const r = await startJob(t.d, { job: "doctor", dryRun: false, requestedBy: "cron" });
    expect(r.ok).toBe(false);
    expect(r.note).toContain("Missing function secrets: CRON_SECRET.");
    expect(r.note).toContain("Graph v25.0 answers as Mahara System User");
    expect(r.note).toContain("Not linked to a client: LA Account (5555555555555).");
    expect(r.note).toContain("Hidden on purpose: Mass Design (6666666666666).");
    expect(r.note).toContain("Spent in the last 2 days for a cancelled or stopped client: Old Client Ads (Old Client, Cancelled).");
    expect(r.note).toContain("Meta stops delivery on: Riyadh Client (Riyadh, unsettled, last spend 2026-10-09).");
    // The accounts go to the database with their names, so it can name the loose ones.
    const sent = t.db.calls.find(c => c.name === "cockpit_meta_ad_days_inputs")!.p;
    expect(sent.accounts.map((a: any) => a.accountId)).toContain(LA_ACCOUNT);
    expect(sent.accounts.find((a: any) => a.accountId === LA_ACCOUNT).name).toBe("LA Account");
    expect(t.calls.every(c => c.method === "GET")).toBe(true);
    expect(t.db.calls.map(c => c.name)).toEqual(["cockpit_meta_ad_days_inputs", "cockpit_meta_ad_days_status", "cockpit_meta_ad_days_record"]);
  });
});

describe("sentences and retries", () => {
  test("each failure says what to do", () => {
    expect(sentence(new MetaError("token", "Meta refused me (code 190)."))).toContain("META_SYSTEM_TOKEN");
    expect(sentence(new MetaError("rate", "x"))).toContain("a later run reads it again");
    expect(sentence(new ParseError("Bad."))).toBe("Bad. Nothing was written for this read.");
    expect(retryable(new MetaError("heavy", "x"))).toBe(true);
    expect(retryable(new MetaError("permission", "x"))).toBe(false);
    expect(retryable(new ParseError("x"))).toBe(false);
    expect(retryable(new RpcError("bad rows", "22023"))).toBe(false);
    expect(retryable(new RpcError("lease", "55000"))).toBe(true);
  });
});

describe("the door", () => {
  const SECRET = "cron-secret-fixture";
  function door(start?: (d: RunDeps, j: Job) => Promise<Record<string, unknown>>) {
    const t = deps([]);
    const background: Promise<unknown>[] = [];
    const started: Job[] = [];
    const handler = makeDoor({
      ...t.d,
      cronSecret: () => SECRET,
      waitUntil: w => void background.push(w),
      start: start ?? (async (_d, j) => {
        started.push(j);
        return { ok: true, note: "fine" };
      }),
    });
    return { handler, background, started, db: t.db };
  }
  const post = (body: unknown, secret: string | null = SECRET, method = "POST") =>
    new Request("https://x.supabase.co/functions/v1/meta-ad-days", {
      method,
      headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-cron-secret": secret }) },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });

  test("only POST, only with the cron secret, before the body is read", async () => {
    const d = door();
    expect((await d.handler(post({ job: "hourly" }, SECRET, "GET"))).status).toBe(405);
    expect((await d.handler(post({ job: "hourly" }, null))).status).toBe(401);
    expect((await d.handler(post({ job: "hourly" }, "wrong"))).status).toBe(401);
    expect((await d.handler(post({ job: "hourly" }, ""))).status).toBe(401);
    expect(d.started.length).toBe(0);
    const empty = makeDoor({ ...deps([]).d, cronSecret: () => "", waitUntil: () => undefined });
    expect((await empty(post({ job: "hourly" }, ""))).status).toBe(401);
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });

  test("a job runs in the background (202); a dry run and the doctor answer at once (200)", async () => {
    const d = door();
    const r = await d.handler(post({ job: "hourly" }));
    expect(r.status).toBe(202);
    expect(d.background.length).toBe(1);
    await Promise.all(d.background);
    expect(d.started[0]).toEqual({ job: "hourly", dryRun: false, requestedBy: "cron" });
    expect((await d.handler(post({ job: "doctor" }))).status).toBe(200);
    expect((await d.handler(post({ job: "nightly", dryRun: true }))).status).toBe(200);
    expect(d.background.length).toBe(1);
  });

  test("a background job that throws is logged and written as a failure", async () => {
    const d = door(async () => {
      throw new Error("claim failed");
    });
    expect((await d.handler(post({ job: "continue" }))).status).toBe(202);
    await Promise.all(d.background);
    const rec = d.db.calls.find(c => c.name === "cockpit_meta_ad_days_record")!.p;
    expect(rec).toMatchObject({ job: "continue", ok: false, note: "The continue job stopped: claim failed" });
  });

  test("the body is read strictly", () => {
    expect(readJob({ job: "backfill", days: 30, accounts: ["act_1111111111111"], requestedBy: "Aziz@MaharaMedia.com" })).toEqual({
      job: "backfill", days: 30, accounts: ["1111111111111"], dryRun: false, requestedBy: "aziz@maharamedia.com",
    });
    expect(readJob({ job: "backfill" })).toMatchObject({ days: 90 });
    for (const bad of [null, [], {}, { job: "weekly" }, { job: "hourly", extra: 1 }, { job: "hourly", days: 3 }, { job: "backfill", days: 91 },
      { job: "backfill", days: 0 }, { job: "backfill", accounts: ["x"] }, { job: "hourly", accounts: ["1111111111111"] }, { job: "doctor", dryRun: true },
      { job: "hourly", dryRun: "yes" }, { job: "hourly", requestedBy: "aziz" }]) {
      expect(typeof readJob(bad)).toBe("string");
    }
  });
});
