import { describe, expect, it } from "bun:test";
import {
  anotherRunNote,
  boardAge,
  BUSY_HELD,
  CALLS_MAX,
  cardList,
  type Deps,
  gate,
  kpiGate,
  noJobNote,
  openRunMinutes,
  pacer,
  REQUESTS_RUN_BUDGET_MS,
  runDoctor,
  runDosDonts,
  runKpi,
  runLog,
  runRequests,
  STALE_RUN_MINUTES,
  triesOf,
  unknownJobNote,
  writebackPerMinute,
} from "./run";
import { type Provider, RETRY_MINUTES } from "./queue";
import type { RequestsItem } from "./requests";
import { harness as requestsHarness, LIVE, rejected, requestPayload } from "./requestsTestkit";
import { ADS_LIST, CLIENTS_LIST, DOS_DONTS_FIELD, FIELD, NOTES_MARK } from "./rules";

const NOW = Date.parse("2026-10-09T09:00:00Z");
type Call = { actionId: string; provider: string; method: string; path: string; body?: any };

const options = (prefix: string) => ["Above KPI", "At KPI", "Below KPI", "911"].map((name, i) => ({ id: `${prefix}${i}`, name, orderindex: i }));
const BOARD_FIELDS = [
  { id: FIELD.cplStatus, type_config: { options: options("cpl-") } },
  { id: FIELD.cpbStatus, type_config: { options: options("cpb-") } },
  { id: FIELD.adStatus, type_config: { options: [{ id: "opt-live", name: "Live", orderindex: 0 }, { id: "opt-paused", name: "Paused", orderindex: 1 }] } },
];
const OCT7 = Date.parse("2026-10-07T03:00:00Z");
const card = (id: string, cpl?: number, extra: { id: string; value: unknown }[] = []) => ({
  id,
  name: `Card ${id}`,
  custom_fields: [...(cpl === undefined ? [] : [{ id: FIELD.cpl7d, value: String(cpl) }]), { id: FIELD.lastUpdated, value: String(OCT7) }, ...extra],
});
const campaign = (name: string, taskId: string, spend: number, leads: number) => ({ campaignName: name, clientName: name, taskId, internal: false, spend7d: spend, leads7d: leads, cpl: leads ? spend / leads : null });
// The media sync's 7 days on 9 Oct: 2 to 8 Oct. Today's (9 Oct) spend is outside it.
const INPUTS = {
  campaigns: [campaign("A", "t1", 60, 4), campaign("B", "t2", 40, 2)],
  daily: [
    { campaignName: "A", day: "2026-10-05", spend: 60, leads: 4 },
    { campaignName: "B", day: "2026-10-06", spend: 40, leads: 2 },
    { campaignName: "A", day: "2026-10-09", spend: 9, leads: 1 },
  ],
  bookings: [],
  bookingsByCampaign: [],
  weekFrom: "2026-10-02",
  weekThrough: "2026-10-08",
  weekSource: "media sync",
  dailyReady: true,
  bookingsReady: true,
  latestPublishAt: new Date(NOW - 10 * 60_000).toISOString(),
};

function harness(env: Record<string, string>, opts: { items?: any[]; tasks?: any[]; route?: (c: Call) => any; inputs?: any } = {}) {
  const calls: Call[] = [];
  const rpcs: { name: string; params: any }[] = [];
  let items = opts.items ?? [];
  const deps: Deps = {
    env: k => env[k],
    now: () => NOW,
    uuid: () => "11111111-2222-3333-4444-555555555555",
    rpc: async (name, params = {}) => {
      rpcs.push({ name, params: structuredClone(params) });
      if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
      if (name === "cockpit_clickup_writeback_inputs") return opts.inputs ?? INPUTS;
      if (name === "cockpit_clickup_writeback_sweep") return 0;
      if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
      if (name === "cockpit_clickup_writeback_doctor") return { queue: { queued: 1 } };
      return null;
    },
    providerFor: (actionId: string): Provider => ({
      async call(provider, method, path, body) {
        const c = { actionId, provider, method, path, body };
        calls.push(c);
        const custom = opts.route?.(c);
        if (custom instanceof Error) throw custom;
        if (custom !== undefined) return custom;
        if (method === "GET" && path.startsWith(`list/${ADS_LIST}/task`)) return { tasks: opts.tasks ?? [card("t1", 15), card("t2")] };
        if (method === "GET" && path === `list/${ADS_LIST}/field`) return { fields: BOARD_FIELDS };
        if (method === "POST" && path.endsWith("/comment")) return { id: "c-1" };
        return {};
      },
    }),
  };
  const writes = () => calls.filter(c => c.method !== "GET");
  const finish = () => rpcs.find(r => r.name === "cockpit_clickup_writeback_finish")?.params;
  const saves = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_save").map(r => r.params.p_patch);
  return { deps, calls, rpcs, writes, finish, saves };
}

describe("the write gate", () => {
  it("opens only on CLICKUP_WRITEBACK_APPLY exactly 'true'", () => {
    for (const v of [undefined, "", "TRUE", "True", " true", "true ", "1", "yes"]) expect(gate(k => (k === "CLICKUP_WRITEBACK_APPLY" ? v : undefined)).apply).toBe(false);
    expect(gate(k => (k === "CLICKUP_WRITEBACK_APPLY" ? "true" : undefined))).toMatchObject({ apply: true, mode: "apply" });
    const limited = gate(k => ({ CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t1, t9" })[k]);
    expect(limited.mode).toBe("apply_limited");
    expect([limited.live("t1"), limited.live("t2"), limited.live(null)]).toEqual([true, false, false]);
  });
  it("the client success ticket switch opens only on exactly 'true' and does not open the rest", () => {
    for (const v of [undefined, "", "TRUE", "1"]) expect(gate(k => (k === "CLICKUP_WRITEBACK_APPLY_CSM_TICKETS" ? v : undefined)).csmTickets).toBe(false);
    expect(gate(k => (k === "CLICKUP_WRITEBACK_APPLY_CSM_TICKETS" ? "true" : undefined))).toMatchObject({ csmTickets: true, apply: false, mode: "dry_run" });
  });
});

describe("the KPI switch (R12)", () => {
  const kpiEnv = (env: Record<string, string | undefined>) => (k: string) => env[k];
  it("opens only on CLICKUP_WRITEBACK_APPLY_KPI exactly 'true', never on the general switch", () => {
    for (const v of [undefined, "", "TRUE", "True", " true", "true ", "1", "yes"]) expect(kpiGate(kpiEnv({ CLICKUP_WRITEBACK_APPLY_KPI: v, CLICKUP_WRITEBACK_APPLY: "true" })).apply).toBe(false);
    expect(kpiGate(kpiEnv({ CLICKUP_WRITEBACK_APPLY: "true" }))).toMatchObject({ apply: false, mode: "dry_run" });
    expect(kpiGate(kpiEnv({ CLICKUP_WRITEBACK_APPLY_KPI: "true" }))).toMatchObject({ apply: true, mode: "apply" });
    const limited = kpiGate(kpiEnv({ CLICKUP_WRITEBACK_APPLY_KPI: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t1, t9" }));
    expect(limited.mode).toBe("apply_limited");
    expect([limited.live("t1"), limited.live("t2"), limited.live(null)]).toEqual([true, false, false]);
  });
  it("does not open the log or Do's & Don'ts", () => {
    expect(gate(kpiEnv({ CLICKUP_WRITEBACK_APPLY_KPI: "true" }))).toMatchObject({ apply: false, mode: "dry_run" });
  });
});

describe("kpi job", () => {
  it("dry run reads the board and records every planned write, writing nothing, and reports ok=false", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const out = await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out).toMatchObject({ ok: false, mode: "dry_run" });
    expect(out.note).toBe(
      "Dry run: 5 writes planned on 2 cards, nothing written to ClickUp. The board still shows numbers last updated 7 Oct 2026. 1 card shows no numbers yet. The 7 days run 2 Oct to 8 Oct.",
    );
    // The health line: cockpit_clickup_writeback_finish writes clickup-writeback:kpi with this ok and note.
    expect(h.finish()).toMatchObject({ p_run: "run-1", p_ok: false, p_note: out.note });
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params).toEqual({ p_job: "kpi", p_mode: "dry_run", p_exclusive: true });
    const planned = h.finish().p_planned;
    expect(planned.find((p: any) => p.taskId === "t1" && p.fieldId === FIELD.cpl7d)).toMatchObject({ field: "CPL (7d)", old: 15, new: 15, status: "unchanged" });
    expect(planned.find((p: any) => p.taskId === "t2" && p.fieldId === FIELD.cpl7d)).toMatchObject({ old: null, new: 20, status: "planned" });
    expect(planned.filter((p: any) => p.fieldId === FIELD.lastUpdated).map((p: any) => p.status)).toEqual(["planned", "planned"]);
    expect(h.finish().p_counts).toMatchObject({ cards: 2, cardsWithWrites: 2, writes: 5, skipped: 0, stamped: 2, from: "2026-10-02", through: "2026-10-08", windowSource: "media sync", oldestLastUpdated: "2026-10-07T03:00:00.000Z", noNumbers: 1, undated: 0 });
    // Every provider call is recorded under the run id.
    expect(new Set(h.calls.map(c => c.actionId))).toEqual(new Set(["run-1"]));
  });

  it("writes nothing to ClickUp under every switch setting but CLICKUP_WRITEBACK_APPLY_KPI=true, and always says ok=false", async () => {
    const settings: Record<string, string>[] = [
      {},
      { CLICKUP_WRITEBACK_APPLY: "true" },
      { CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t1,t2" },
      { CLICKUP_WRITEBACK_APPLY_CSM_TICKETS: "true" },
      { CLICKUP_WRITEBACK_APPLY_KPI: "TRUE" },
      { CLICKUP_WRITEBACK_APPLY_KPI: "1" },
      { CLICKUP_WRITEBACK_APPLY_KPI: " true" },
      { CLICKUP_WRITEBACK_APPLY_KPI: "yes", CLICKUP_WRITEBACK_APPLY: "true" },
    ];
    for (const env of settings) {
      const h = harness({ CLICKUP_API_TOKEN: "x", ...env });
      const out = await runKpi(h.deps);
      expect([JSON.stringify(env), h.writes()]).toEqual([JSON.stringify(env), []]);
      expect(h.calls.every(c => c.method === "GET")).toBe(true);
      expect(out.ok).toBe(false);
      expect(h.finish().p_ok).toBe(false);
      expect(h.finish().p_note).toContain("nothing written to ClickUp");
      expect(h.finish().p_planned.some((p: any) => p.status === "written")).toBe(false);
    }
  });

  it("refuses before the media sync publishes its window: nothing planned, nothing written, ok=false", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" }, { inputs: { ...INPUTS, weekFrom: null, weekSource: "media data" } });
    const out = await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out).toMatchObject({ ok: false, note: "The media sync has not published its 7-day window yet, so nothing was planned." });
    expect(h.finish()).toMatchObject({ p_ok: false, p_planned: [] });
  });

  it("holds Last Updated on a card whose bookings could not be checked, and records why", async () => {
    const inputs = { ...INPUTS, campaigns: [{ ...campaign("A", "t1", 60, 4), bookings7d: 2 }, campaign("B", "t2", 40, 2)], bookingsByCampaign: [{ campaignName: "A", day: "2026-10-09", booked: 2 }] };
    const h = harness({ CLICKUP_API_TOKEN: "x" }, { inputs });
    await runKpi(h.deps);
    const held = h.finish().p_planned.find((p: any) => p.taskId === "t1" && p.status === "held");
    expect(held).toMatchObject({ field: "Last Updated", old: "2026-10-07T03:00:00.000Z", new: null });
    expect(held.note).toContain("Bookings (7d), Cost Per Booking could not be refreshed");
    expect(h.finish().p_planned.some((p: any) => p.taskId === "t1" && p.fieldId === FIELD.lastUpdated && p.status === "planned")).toBe(false);
    expect(h.finish().p_counts).toMatchObject({ stamped: 1, held: 1 });
    expect(h.finish().p_note).toContain("Last Updated stays as it is on 1 card whose columns could not all be refreshed: Card t1.");
    expect(h.finish().p_ok).toBe(false);
    expect(h.writes()).toEqual([]);
  });

  it("applies changed fields and Last Updated with the KPI switch, and skips unchanged values", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" });
    const out = await runKpi(h.deps);
    expect(out).toMatchObject({ ok: true, mode: "apply", counts: { updated: 2, failed: 0, stamped: 2, outside: 0, writes: 5 } });
    expect(out.note).toBe("2 cards updated, 0 failed, 0 skipped, Last Updated stamped on 2. The 7 days run 2 Oct to 8 Oct.");
    expect(h.writes().map(c => `${c.path}=${JSON.stringify(c.body.value)}`)).toEqual([
      `task/t1/field/${FIELD.cplStatus}="cpl-1"`,
      `task/t1/field/${FIELD.lastUpdated}=${NOW}`,
      `task/t2/field/${FIELD.cpl7d}=20`,
      `task/t2/field/${FIELD.cplStatus}="cpl-2"`,
      `task/t2/field/${FIELD.lastUpdated}=${NOW}`,
    ]);
  });

  it("a limited live run writes only the allowed card, stamps only that card and reports ok=false", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t2" });
    const out = await runKpi(h.deps);
    expect(new Set(h.writes().map(c => c.path.split("/")[1]))).toEqual(new Set(["t2"]));
    expect(h.finish().p_planned.filter((p: any) => p.taskId === "t1" && p.status === "planned").length).toBeGreaterThan(0);
    // Only t2's Last Updated reached ClickUp: one stamp, never the planned one on t1.
    expect(h.writes().filter(c => c.path.endsWith(FIELD.lastUpdated)).length).toBe(1);
    expect(out.counts).toMatchObject({ updated: 1, stamped: 1, writes: 3, outside: 1, outsideWrites: 2, cardsWithWrites: 1 });
    // Most of the board is not refreshed, so the health line does not go green.
    expect(out.ok).toBe(false);
    expect(h.finish().p_ok).toBe(false);
    expect(out.note).toBe(
      "1 card updated, 0 failed, 0 skipped, Last Updated stamped on 1. 1 card left as a dry run (not in CLICKUP_WRITEBACK_ONLY_TASKS), 2 writes planned on it. The 7 days run 2 Oct to 8 Oct.",
    );
  });

  it("a live run limited to a card that is not in the plan writes nothing, stamps nothing and reports ok=false", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t9" });
    const out = await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 0, stamped: 0, writes: 0, outside: 2 });
    expect(out.note).toContain("Last Updated stamped on 0. 2 cards left as a dry run (not in CLICKUP_WRITEBACK_ONLY_TASKS)");
    expect(out.note).toContain("No card was refreshed. The board still shows numbers last updated 7 Oct 2026.");
  });

  it("a live run where every card is skipped reports ok=false and names the cards", async () => {
    // The rows say $90 for A; the daily ledger says $60: the sources disagree, nothing is written.
    const inputs = { ...INPUTS, campaigns: [campaign("A", "t1", 90, 4)], daily: INPUTS.daily.filter(d => d.campaignName === "A") };
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" }, { inputs });
    const out = await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 0, skipped: 1, stamped: 0 });
    expect(out.note).toBe(
      "0 cards updated, 0 failed, 1 skipped, Last Updated stamped on 0. No card was refreshed. The board still shows numbers last updated 7 Oct 2026. The 7 days run 2 Oct to 8 Oct. 1 card was skipped because the sources disagree or the card is gone: Card t1.",
    );
  });

  it("a held card is never counted as updated, and a live run of only held cards reports ok=false", async () => {
    // A's bookings disagree with the ledger: its CPL band is written, its Last Updated is held.
    const inputs = { ...INPUTS, campaigns: [{ ...campaign("A", "t1", 60, 4), bookings7d: 2 }], daily: INPUTS.daily.filter(d => d.campaignName === "A"), bookingsByCampaign: [] };
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" }, { inputs });
    const out = await runKpi(h.deps);
    expect(h.writes().map(c => c.path)).toEqual([`task/t1/field/${FIELD.cplStatus}`]);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 0, held: 1, stamped: 0, writes: 1 });
    expect(out.note).toContain("0 cards updated");
    expect(out.note).toContain("Last Updated stays as it is on 1 card whose columns could not all be refreshed: Card t1.");
  });

  it("one failed card fails the run even when another card took the numbers", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" }, { route: c => (c.method === "POST" && c.path.startsWith("task/t1/") ? new Error("clickup rejected the request (400): Field is locked") : undefined) });
    const out = await runKpi(h.deps);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 1, failed: 1, stamped: 1 });
    expect(out.note).toContain("1 card updated, 1 failed, 0 skipped, Last Updated stamped on 1.");
    expect(out.note).toContain("Failed: Card t1.");
  });

  it("fails the run when no card took the numbers, as Convex did, and never stamps Last Updated after a failed write", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" }, { route: c => (c.method === "POST" ? new Error("clickup rejected the request (401): Token invalid") : undefined) });
    const out = await runKpi(h.deps);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 0, failed: 2, stamped: 0 });
    expect(h.writes().some(c => c.path.endsWith(FIELD.lastUpdated))).toBe(false);
    expect(out.note).toContain("Last Updated stamped on 0");
  });

  it("an old inputs function (before 20261022z) gives no window: refused with the migration named, nothing written, ok=false", async () => {
    const { weekFrom: _f, weekThrough: _t, weekSource: _s, bookingsByCampaign: _b, ...old } = INPUTS;
    for (const env of [{}, { CLICKUP_WRITEBACK_APPLY_KPI: "true" }]) {
      const h = harness({ CLICKUP_API_TOKEN: "x", ...env }, { inputs: old });
      const out = await runKpi(h.deps);
      expect(h.writes()).toEqual([]);
      expect(out).toMatchObject({ ok: false, note: "cockpit_clickup_writeback_inputs has no 7-day window (migration 20261022z is not applied), so nothing was planned." });
    }
  });

  it("without the ClickUp token it says so and touches nothing", async () => {
    const h = harness({});
    const out = await runKpi(h.deps);
    expect(out.ok).toBe(false);
    expect(out.note).toContain("CLICKUP_API_TOKEN is not set");
    expect(h.calls).toEqual([]);
    expect(h.rpcs.map(r => r.name)).toEqual(["cockpit_clickup_writeback_idle"]);
  });

  it("dates the board by the cards that show numbers, and counts the rest apart", () => {
    expect(boardAge({ oldestLastUpdated: OCT7, noNumbers: 0, undated: 0 })).toBe("The board still shows numbers last updated 7 Oct 2026.");
    // The 22 Oct board: 9 cards with numbers from 7 Oct, 9 cards with none yet.
    expect(boardAge({ oldestLastUpdated: OCT7, noNumbers: 9, undated: 0 })).toBe("The board still shows numbers last updated 7 Oct 2026. 9 cards show no numbers yet.");
    expect(boardAge({ oldestLastUpdated: OCT7, noNumbers: 1, undated: 2 })).toBe(
      "The board still shows numbers last updated 7 Oct 2026. 2 cards show numbers with no Last Updated date. 1 card shows no numbers yet.",
    );
    expect(boardAge({ oldestLastUpdated: null, noNumbers: 1, undated: 0 })).toBe("No card on the board shows numbers with a Last Updated date. 1 card shows no numbers yet.");
  });

  it("names up to five cards, then says how many more", () => {
    expect(cardList(["A "])).toBe("A");
    expect(cardList(["A", "B"])).toBe("A and B");
    expect(cardList(["A", "B", "C", "D", "E", "F", "G"])).toBe("A, B, C, D, E and 2 more");
  });
});

describe("log job", () => {
  const change = (over: any = {}) => ({
    id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    kind: "manual_change",
    payload: { campaignName: "A", what: "Raised budget to $40", by: "nada@maharamedia.com", at: NOW - 60_000 },
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    source_exists: true,
    ...over,
  });

  it("dry run holds the entry as dry_run with its planned comment and writes nothing", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" }, { items: [change()] });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.note).toContain("Nothing was written to ClickUp");
    const saved = h.saves();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ state: "dry_run", task_id: "t1" });
    expect(saved[0].planned[0]).toMatchObject({ taskId: "t1", field: "comment", old: null });
    expect(saved[0].planned[0].new).toContain("🎯 Cockpit · CHANGE MADE - Raised budget to $40");
    expect(h.finish().p_planned).toHaveLength(1);
  });

  it("the KPI switch alone keeps the log a dry run", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_KPI: "true" }, { items: [change()] });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.note).toContain("Nothing was written to ClickUp");
  });

  it("live: freezes the text, marks the start, posts once and records delivery", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true" }, { items: [change()] });
    await runLog(h.deps);
    expect(h.writes().map(c => c.path)).toEqual(["task/t1/comment"]);
    const saved = h.saves();
    expect(Object.keys(saved[0])).toEqual(["steps", "task_id"]);
    expect(saved[1]).toEqual({ progress: { comment: { started: true } } });
    expect(saved.at(-1)).toMatchObject({ state: "delivered", error: null });
    // The comment's provider receipts are filed under the queue item.
    expect(h.calls.every(c => c.actionId === change().id)).toBe(true);
  });

  it("a 429 waits on the outbox ladder instead of failing", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true" }, {
      items: [change()],
      route: c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : undefined),
    });
    const out = await runLog(h.deps);
    const last = h.saves().at(-1);
    expect(last.state).toBe("retry");
    expect(Date.parse(last.next_attempt_at)).toBe(NOW + 60_000);
    expect(out.counts).toMatchObject({ retry: 1, delivered: 0 });
  });

  it("an empty queue only updates the freshness row", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const out = await runLog(h.deps);
    expect(out).toMatchObject({ ok: true, note: "The ClickUp log queue is empty." });
    expect(h.rpcs.map(r => r.name)).toEqual(["cockpit_clickup_writeback_sweep", "cockpit_clickup_writeback_claim", "cockpit_clickup_writeback_idle"]);
  });

  const csmTicket = (over: any = {}) =>
    change({
      kind: "decision",
      payload: { role: "csm", subject: "City Wood", action: "New scripts needed", kind: "ticket", reroutedTo: "creative", clientTaskId: "86eyt1d33", note: "Faces on camera" },
      ...over,
    });

  it("a client success ticket stays a dry run while its switch is off", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" }, { items: [csmTicket()] });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.note).toContain("Nothing was written to ClickUp");
    expect(h.saves()[0]).toMatchObject({ state: "dry_run", task_id: "86eyt1d33" });
  });

  it("its own switch sends client success tickets while the rest of the log stays a dry run", async () => {
    const h = harness(
      { CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_CSM_TICKETS: "true" },
      { items: [csmTicket(), change({ id: "aaaaaaaa-0000-0000-0000-000000000000" })], route: c => (c.method === "POST" && c.path.startsWith("list/") ? { id: "tk1", url: "https://app.clickup.com/t/tk1" } : undefined) },
    );
    const out = await runLog(h.deps);
    expect(h.writes().map(c => c.path)).toEqual(["list/901818016338/task", "task/86eyt1d33/comment"]);
    expect(h.writes()[1].body.comment_text).toContain("https://app.clickup.com/t/tk1");
    expect(h.saves().filter(s => s.state).map(s => s.state)).toEqual(["delivered", "dry_run"]);
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params.p_mode).toBe("apply_limited");
    expect(out.note).toContain("Client success tickets are live: 1 delivered");
  });

  it("the weekly backlog task stays a dry run on a limited live run", async () => {
    const backlog = change({ kind: "tracking_backlog", payload: { listId: "901816723196", name: "Tracking backlog · 3 ads", description: "x", priority: 4 } });
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t1" }, { items: [backlog] });
    await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(h.saves()[0]).toMatchObject({ state: "dry_run" });
  });
});

describe("dosdonts job", () => {
  const messy = { id: "c1", name: "Client One", custom_fields: [{ id: DOS_DONTS_FIELD, value: "Do: use testimonials\nnever promise results\nNotes: prefers Arabic" }] };
  const clean = { id: "c2", name: "Client Two", custom_fields: [{ id: DOS_DONTS_FIELD, value: "DO\n- A\n\nDON'T\n- B" }] };
  const route = (c: Call) => {
    if (c.method === "GET" && c.path.startsWith(`list/${CLIENTS_LIST}/task`)) return { tasks: [messy, clean] };
    if (c.method === "GET" && c.path === "task/c1/comment") return { comments: [] };
    if (c.method === "GET" && c.path === "task/c1") return messy;
    return undefined;
  };

  it("dry run lists the old and new text and the notes comment, writing nothing", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" }, { route });
    const out = await runDosDonts(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.counts).toMatchObject({ cards: 1 });
    const planned = h.finish().p_planned;
    expect(planned).toEqual([
      { taskId: "c1", taskName: "Client One", field: "comment", old: null, new: `${NOTES_MARK}:\n- Prefers Arabic`, status: "planned", note: undefined },
      { taskId: "c1", taskName: "Client One", field: "Do's & Don'ts", old: messy.custom_fields[0].value, new: "DO\n- Use testimonials\n\nDON'T\n- Never promise results", status: "planned", note: undefined },
    ]);
  });

  it("live: posts the notes once, then rewrites the field when nobody edited it", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true" }, { route });
    await runDosDonts(h.deps);
    expect(h.writes().map(c => `${c.method} ${c.path}`)).toEqual(["POST task/c1/comment", `POST task/c1/field/${DOS_DONTS_FIELD}`]);
  });
});

describe("doctor and pacing", () => {
  it("doctor reports secret names as present or missing, never their values, with no provider call", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "pk_secret_value", CRON_SECRET: "s" });
    const out = await runDoctor(h.deps);
    expect(out.secrets).toEqual({ CLICKUP_API_TOKEN: true, META_SYSTEM_TOKEN: false, CRON_SECRET: true, SUPABASE_URL: false, SUPABASE_SERVICE_ROLE_KEY: false });
    expect(JSON.stringify(out)).not.toContain("pk_secret_value");
    expect(h.calls).toEqual([]);
    expect(out.kpiMode).toBe("dry_run");
    expect(out.note).toContain("KPI columns: dry run (they are written only when CLICKUP_WRITEBACK_APPLY_KPI is true)");
    expect((await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY: "true" }).deps)).kpiMode).toBe("dry_run");
    expect((await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY_KPI: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "86eyn6c1f" }).deps)).kpiMode).toBe("apply_limited");
  });

  it("the limiter keeps calls under the per-minute budget", async () => {
    let t = 0;
    const slept: number[] = [];
    const pace = pacer(2, () => t, async ms => { slept.push(ms); t += ms; });
    await pace(); await pace(); await pace();
    expect(slept).toEqual([60_005]);
  });
});

describe("the pace on ClickUp Business (docs/requests/CLICKUP-DOWNGRADE.md 1.4)", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  it("requests and requests_doctor default to 25, every other job to 30", () => {
    expect(writebackPerMinute("requests", env({}))).toBe(25);
    expect(writebackPerMinute("requests_doctor", env({}))).toBe(25);
    for (const job of ["kpi", "log", "dosdonts", "doctor", ""]) expect(writebackPerMinute(job, env({}))).toBe(30);
  });

  it("each job reads only its own setting", () => {
    const both = env({ CLICKUP_REQUESTS_CALLS_PER_MINUTE: "20", CLICKUP_CALLS_PER_MINUTE: "40" });
    expect(writebackPerMinute("requests", both)).toBe(20);
    expect(writebackPerMinute("kpi", both)).toBe(40);
    expect(writebackPerMinute("requests", env({ CLICKUP_CALLS_PER_MINUTE: "40" }))).toBe(25);
    expect(writebackPerMinute("log", env({ CLICKUP_REQUESTS_CALLS_PER_MINUTE: "20" }))).toBe(30);
  });

  it("no value takes a job above 60 or below 5; junk gives the default", () => {
    // An old value left in the secrets (120, 1000) is held at 60, under ClickUp Business's 100 for the shared token.
    expect(writebackPerMinute("requests", env({ CLICKUP_REQUESTS_CALLS_PER_MINUTE: "120" }))).toBe(CALLS_MAX);
    expect(writebackPerMinute("kpi", env({ CLICKUP_CALLS_PER_MINUTE: "1000" }))).toBe(60);
    expect(writebackPerMinute("kpi", env({ CLICKUP_CALLS_PER_MINUTE: "2" }))).toBe(5);
    for (const junk of ["", " ", "x", "0", "-30", "NaN", "Infinity"]) {
      expect(writebackPerMinute("requests", env({ CLICKUP_REQUESTS_CALLS_PER_MINUTE: junk }))).toBe(25);
      expect(writebackPerMinute("log", env({ CLICKUP_CALLS_PER_MINUTE: junk }))).toBe(30);
    }
    expect(writebackPerMinute("log", env({ CLICKUP_CALLS_PER_MINUTE: "29.9" }))).toBe(29);
  });

  it("a requests run at 25 a minute with six 18-call requests stops taking items after 100 s and ends inside the 150 s wall", async () => {
    const h = requestsHarness(LIVE);
    // Ten SOP steps: 18 ClickUp calls a request, the worst request type on record (Social media, no template).
    const steps = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}.`);
    for (let i = 0; i < 6; i++)
      h.db.enqueue("request", requestPayload({ requestId: `${i}a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`, ref: `R-${i}a2b3c4d5e-main`, sopSteps: steps }));
    const sleeps: number[] = [];
    h.deps.pace = pacer(writebackPerMinute("requests", h.deps.env), h.deps.now, async ms => {
      sleeps.push(ms);
      h.advance(ms);
    });
    const at: { actionId: string; t: number }[] = [];
    const real = h.deps.providerFor;
    h.deps.providerFor = actionId => {
      const p = real(actionId);
      return { call: (provider, method, path, body) => { at.push({ actionId, t: h.deps.now() }); return p.call(provider, method, path, body); } };
    };
    const start = h.deps.now();
    const out = await h.run(6);
    const items = [...new Set(at.map(c => c.actionId))].filter(id => id !== "run-1");
    const first = (id: string) => Math.min(...at.filter(c => c.actionId === id).map(c => c.t));
    const perItem = items.map(id => at.filter(c => c.actionId === id).length);
    expect(perItem.every(n => n === 18)).toBe(true);
    // Never more than 25 calls inside any 60 seconds.
    for (const c of at) expect(at.filter(x => x.t >= c.t && x.t < c.t + 60_000).length).toBeLessThanOrEqual(25);
    // Every item it took was started inside the run budget; the rest wait for the next run.
    expect(items.length).toBeGreaterThan(0);
    for (const id of items) expect(first(id) - start).toBeLessThanOrEqual(REQUESTS_RUN_BUDGET_MS);
    expect(out.counts).toMatchObject({ claimed: 6, delivered: items.length, held: 6 - items.length });
    expect(out.counts?.held).toBeGreaterThan(0);
    // The last call is made before the Edge Function's 150 s wall clock.
    expect(Math.max(...at.map(c => c.t)) - start).toBeLessThan(150_000);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  // The fake database's begin opens every run it is asked for. These tests put back what 20261026r's
  // cockpit_clickup_writeback_begin does under the job's advisory lock: runs open longer than 15 minutes are
  // closed, and an exclusive begin returns no id while a run of the job is open, with the open run's start.
  const kuwaitHHMI = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(11, 16);
  function liveBegin(h: ReturnType<typeof requestsHarness>) {
    const open = new Map<string, number>();
    const exclusive: boolean[] = [];
    const base = h.deps.rpc;
    let seq = 0;
    h.deps.rpc = async (name, params = {}) => {
      if (name === "cockpit_clickup_writeback_begin" && params.p_job === "requests") {
        exclusive.push(Boolean(params.p_exclusive));
        const now = h.deps.now();
        for (const [id, at] of open) if (at <= now - 15 * 60_000) open.delete(id);
        if (params.p_exclusive && open.size) {
          const latest = Math.max(...open.values());
          return { id: null, note: `A requests run that started at ${kuwaitHHMI(latest)} Kuwait is still running.` };
        }
        // Checked and opened in one step, as one transaction under the lock does.
        const held = `opening-${++seq}`;
        open.set(held, now);
        const run = await base(name, params);
        open.delete(held);
        open.set(String(run.id), now);
        return run;
      }
      if (name === "cockpit_clickup_writeback_finish") open.delete(String(params.p_run));
      return base(name, params);
    };
    return { open, exclusive };
  }
  const tenSteps = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}.`);
  const queueRequests = (h: ReturnType<typeof requestsHarness>, n: number) =>
    Array.from({ length: n }, (_, i) =>
      h.db.enqueue("request", requestPayload({ requestId: `${i}a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`, ref: `R-${i}a2b3c4d5e-main`, sopSteps: tenSteps })),
    );
  /** Each ClickUp call's time, through the provider, as index.ts wires it. */
  function timeCalls(h: ReturnType<typeof requestsHarness>) {
    const at: { actionId: string; t: number }[] = [];
    const real = h.deps.providerFor;
    h.deps.providerFor = actionId => {
      const p = real(actionId);
      return { call: (provider, method, path, body) => { at.push({ actionId, t: h.deps.now() }); return p.call(provider, method, path, body); } };
    };
    return at;
  }
  const busiestMinute = (at: { t: number }[]) => Math.max(0, ...at.map(c => at.filter(x => x.t >= c.t && x.t < c.t + 60_000).length));

  it("three runs started together (three submits close together) make at most 25 calls a minute between them", async () => {
    const h = requestsHarness(LIVE);
    liveBegin(h);
    const rows = queueRequests(h, 3);
    const at = timeCalls(h);
    // Each run is its own Edge Function call, with its own pacer, as index.ts builds them.
    const one = () => {
      const pace = pacer(writebackPerMinute("requests", h.deps.env), h.deps.now, async ms => h.advance(ms));
      return runRequests({ ...h.deps, pace }, 1);
    };
    const outs = await Promise.all([one(), one(), one()]);
    expect(busiestMinute(at)).toBeLessThanOrEqual(25);
    // One run sent its request; the two that found it open handed theirs back, their tries untouched.
    const sent = outs.filter(o => o.counts?.delivered === 1);
    const back = outs.filter(o => o.counts?.handedBack === 1);
    expect([sent.length, back.length]).toEqual([1, 2]);
    for (const o of back) expect(o).toMatchObject({ ok: true, note: anotherRunNote(1) });
    const waiting = rows.filter(r => r.state !== "delivered");
    expect(waiting.length).toBe(2);
    for (const r of waiting) expect(r).toMatchObject({ state: "queued", attempts: 0, error: BUSY_HELD, claim_token: null });
    // The next runs take them, one run at a time, still inside 25 a minute.
    h.advance(60_000);
    await one();
    h.advance(60_000);
    await one();
    expect(rows.every(r => r.state === "delivered")).toBe(true);
    expect(busiestMinute(at)).toBeLessThanOrEqual(25);
    expect(rows.every(r => r.attempts === 1)).toBe(true);
  });

  it("a run left open by a function that stopped holds the job up for at most 4 minutes", async () => {
    const h = requestsHarness(LIVE);
    const { open, exclusive } = liveBegin(h);
    const [row] = queueRequests(h, 1);
    // A run that started 2 minutes ago is still sending: this run hands its row back.
    open.set("run-alive", h.deps.now() - 2 * 60_000);
    const waited = await h.run(1);
    expect(waited).toMatchObject({ ok: true, counts: { claimed: 1, handedBack: 1 } });
    expect(row).toMatchObject({ state: "queued", attempts: 0 });
    expect(h.clickup.calls).toEqual([]);
    // The same run, 5 minutes after it started, never reported back: the next run goes ahead and says so.
    h.advance(3 * 60_000);
    const went = await h.run(1);
    expect(row.state).toBe("delivered");
    expect(went.note).toContain(`A requests run that started at ${kuwaitHHMI(h.deps.now() - 5 * 60_000)} Kuwait never reported back, so this one went ahead.`);
    // Exclusive asks each time; only the run that found the stale one opened its row without it.
    expect(exclusive).toEqual([true, true, false]);
    expect(h.db.begun.map(b => b.p_exclusive)).toEqual([false]);
  });

  it("reads the open run's start from the database's busy note on the Kuwait clock", () => {
    // NOW in the requests testkit is 09:00 UTC, 12:00 Kuwait.
    const at = Date.parse("2026-10-26T09:00:30Z");
    expect(openRunMinutes("A requests run that started at 11:58 Kuwait is still running.", at)).toBe(2);
    expect(openRunMinutes("A requests run that started at 12:00 Kuwait is still running.", at)).toBe(0);
    expect(openRunMinutes("A requests run that started at 23:59 Kuwait is still running.", Date.parse("2026-10-26T21:01:00Z"))).toBe(2);
    for (const junk of [undefined, null, "", "Supabase 503: upstream", "A requests run that started at 25:61 Kuwait is still running."])
      expect(openRunMinutes(junk, at)).toBeNull();
    expect(STALE_RUN_MINUTES).toBe(4);
  });

  it("a row the run's time budget holds back spends no rung of the retry ladder", async () => {
    const h = requestsHarness(LIVE);
    const rows = queueRequests(h, 6);
    h.deps.pace = pacer(writebackPerMinute("requests", h.deps.env), h.deps.now, async ms => h.advance(ms));
    const out = await h.run(6);
    const held = rows.filter(r => r.state !== "delivered");
    expect(out.counts?.held).toBe(held.length);
    expect(held.length).toBeGreaterThan(0);
    for (const r of held) {
      expect(r).toMatchObject({ state: "queued", attempts: 0, error: "Held for the next run, so this run ends inside its time limit." });
      expect(triesOf(r as unknown as RequestsItem)).toBe(0);
    }
    // Its first real try that ClickUp refuses waits the ladder's first step, one minute, not the second.
    const saves: { t: number; id: string; patch: Record<string, any> }[] = [];
    const base = h.deps.rpc;
    h.deps.rpc = async (name, params = {}) => {
      if (name === "cockpit_clickup_writeback_save") saves.push({ t: h.deps.now(), id: String(params.p_id), patch: params.p_patch as Record<string, any> });
      return base(name, params);
    };
    h.clickup.fail = c => (c.method === "POST" && /^list\/[^/]+\/task$/.test(c.path) ? rejected(429) : undefined);
    h.advance(60_000);
    await h.run(1);
    const first = held[0];
    const retry = saves.find(s => s.id === first.id && s.patch.state === "retry");
    expect(retry).toBeDefined();
    expect(Date.parse(retry!.patch.next_attempt_at) - retry!.t).toBe(RETRY_MINUTES[0] * 60_000);
    expect(first).toMatchObject({ state: "retry", attempts: 1 });
  });

  it("without the database's release a held row keeps its tries uncounted through progress.held", async () => {
    const h = requestsHarness(LIVE);
    h.db.withRelease = false;
    const rows = queueRequests(h, 6);
    h.deps.pace = pacer(writebackPerMinute("requests", h.deps.env), h.deps.now, async ms => h.advance(ms));
    await h.run(6);
    const held = rows.filter(r => r.state !== "delivered");
    expect(held.length).toBeGreaterThan(0);
    for (const r of held) {
      expect(r).toMatchObject({ state: "retry", attempts: 1 });
      expect(triesOf(r as unknown as RequestsItem)).toBe(0);
    }
  });
});

describe("the requests switch beside the other jobs (contract 4.1)", () => {
  const manual = {
    id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    kind: "manual_change",
    payload: { campaignName: "A", what: "Raised budget to $40", by: "nada@maharamedia.com", at: NOW - 60_000 },
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    source_exists: true,
  };
  const billing = {
    id: "1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    kind: "billing",
    payload: { eventId: 41, taskId: "task_a", clientName: "Acme", source: "csm", by: "sara@tests.invalid", at: NOW - 60_000, kind: "extension", writes: [{ field: "extension", value: 2 }] },
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    source_exists: true,
  };

  it("alone keeps the log a dry run, billing included", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" }, { items: [billing, manual] });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(h.saves().map(s => s.state)).toEqual(["dry_run", "dry_run"]);
    expect(out.note).toContain("Nothing was written to ClickUp");
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params.p_mode).toBe("dry_run");
  });

  it("alone keeps Do's & Don'ts and the KPI columns dry runs", async () => {
    const d = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" }, { route: c => (c.method === "GET" && c.path.startsWith(`list/${CLIENTS_LIST}/task`) ? { tasks: [] } : undefined) });
    expect(await runDosDonts(d.deps)).toMatchObject({ mode: "dry_run" });
    expect(d.writes()).toEqual([]);
    const k = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" });
    expect(await runKpi(k.deps)).toMatchObject({ ok: false, mode: "dry_run" });
    expect(k.writes()).toEqual([]);
  });

  it("the unknown-job sentence names all six jobs", () => {
    expect(unknownJobNote("forms")).toBe('Unknown job "forms". Use kpi, log, dosdonts, doctor, requests or requests_doctor.');
    expect(noJobNote).toBe("Send a JSON body with a job: kpi, log, dosdonts, doctor, requests or requests_doctor.");
  });

  it("the doctor names the requests mode and the canary cards", async () => {
    const off = await runDoctor(harness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s" }).deps);
    expect(off).toMatchObject({ requestsMode: "dry_run", requestsOnlyCards: [] });
    expect(off.note).toContain("Requests and task changes: dry run (they are written only when CLICKUP_WRITEBACK_APPLY_REQUESTS is true).");
    const canary = await runDoctor(harness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true", CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: "86eywg1cq" }).deps);
    expect(canary).toMatchObject({ requestsMode: "apply_limited", requestsOnlyCards: ["86eywg1cq"] });
    expect(canary.note).toContain("Requests and task changes: apply_limited to the cards 86eywg1cq (CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS).");
    // The general switch does not open requests.
    expect((await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY: "true" }).deps)).requestsMode).toBe("dry_run");
  });
});
