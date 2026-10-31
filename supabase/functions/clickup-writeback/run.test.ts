import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { FORMS_NOT_A_CARD, HAPPINESS_OPTIONS, SAY_FORMS, sha256 } from "./forms";
import {
  anotherRunNote,
  boardAge,
  BUSY_HELD,
  CALLS_MAX,
  CALLS_MIN,
  cardList,
  type Deps,
  FORMS_BUSY_HELD,
  FORMS_CALLS_PER_MINUTE,
  FORMS_RUN_BUDGET_MS,
  formsAnotherRunNote,
  formsPerMinute,
  gate,
  HOLD_MS,
  JOBS,
  kpiGate,
  noJobNote,
  openRunMinutes,
  pacer,
  REQUESTS_RUN_BUDGET_MS,
  runDoctor,
  runDosDonts,
  runForms,
  runFormsDoctor,
  runKpi,
  runLog,
  runRequests,
  STALE_RUN_MINUTES,
  triesOf,
  unknownJobNote,
  writebackPerMinute,
} from "./run";
import { type Provider, RETRY_MINUTES } from "./queue";
import { type RequestsItem, SAY } from "./requests";
import { actionPayload, harness as requestsHarness, LISTS, LIVE, PEOPLE, rejected, requestPayload } from "./requestsTestkit";
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

  it("the unknown-job sentence names all eight jobs", () => {
    expect(unknownJobNote("checkins")).toBe('Unknown job "checkins". Use kpi, log, dosdonts, doctor, requests, requests_doctor, forms or forms_doctor.');
    expect(noJobNote).toBe("Send a JSON body with a job: kpi, log, dosdonts, doctor, requests, requests_doctor, forms or forms_doctor.");
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

// --- forms (docs/forms/STAGE2B-CONTRACT.md build 1) ------------------------------------------------

describe("the forms job beside the others", () => {
  const CARD = "86card0001";
  const TEST_CARD = "86eywg1cq";
  const RESPONSE = "5b1e2c3d-4f50-4a61-8b72-9c83d4e5f601";
  const HAPPY_FIELD = "4e3924e3-4898-4e98-aca1-cc1ac3015b73";
  const POC_FIELD = "e183f2ce-8b7a-491a-b160-2287a247758b";
  const OPTIONS = Object.entries(HAPPINESS_OPTIONS).map(([name, oid], orderindex) => ({ id: oid, name, orderindex }));
  const cardTask = (id: string, poc?: string, happy = 2) => ({
    id,
    list: { id: CLIENTS_LIST },
    custom_fields: [
      { id: HAPPY_FIELD, type: "drop_down", type_config: { options: OPTIONS }, value: happy },
      { id: POC_FIELD, type: "date", value: poc },
    ],
  });
  /** A claimed row as cockpit_clickup_writeback_claim_forms returns it. */
  const row = (key: "happiness" | "last_poc", task = CARD, over: Record<string, any> = {}) => {
    const plan =
      key === "happiness"
        ? { taskId: task, field: HAPPY_FIELD, label: "Happy", value: HAPPINESS_OPTIONS.Happy }
        : { taskId: task, field: POC_FIELD, day: "2026-10-25", value: Date.parse("2026-10-25T09:00:00Z"), value_options: { time: false }, rule: "forward_only" };
    return {
      id: `q-${key}-${task}`,
      kind: "form",
      attempts: 1,
      created_at: new Date(NOW - 60_000).toISOString(),
      task_id: task,
      steps: null,
      progress: {},
      payload: { formKey: "checkin", responseId: RESPONSE, effectId: `e-${key}`, effectKey: key, taskId: task, clientName: "Acme Interiors", ...plan },
      effect: { id: `e-${key}`, state: "queued", plan },
      ...over,
    };
  };
  /** The forms job's own harness: its claim, release, state and save, and a card that keeps what it is sent. */
  function formsHarness(
    env: Record<string, string>,
    items: any[],
    opts: { now?: () => number; fail?: (c: Call) => Error | undefined; begin?: (params: any) => any; inputs?: () => any } = {},
  ) {
    const calls: Call[] = [];
    const rpcs: { name: string; params: any }[] = [];
    const days = new Map<string, string | undefined>();
    const happy = new Map<string, number>();
    let queue = items;
    const deps: Deps = {
      env: k => env[k],
      now: opts.now ?? (() => NOW),
      uuid: () => "11111111-2222-3333-4444-555555555555",
      rpc: async (name, params = {}) => {
        rpcs.push({ name, params: structuredClone(params) });
        if (name === "cockpit_clickup_writeback_claim_forms") {
          const out = queue;
          queue = [];
          return out;
        }
        if (name === "cockpit_clickup_writeback_begin") {
          if (opts.begin) return opts.begin(params);
          return { id: "run-forms" };
        }
        if (name === "cockpit_clickup_writeback_release") return { id: params.p_id, state: "queued" };
        if (name === "cockpit_clickup_forms_doctor_inputs") return opts.inputs ? opts.inputs() : { owners: { happiness: "shadow" }, queue: {} };
        return null;
      },
      providerFor: (actionId: string): Provider => ({
        async call(provider, method, path, body) {
          const c = { actionId, provider, method, path, body };
          calls.push(c);
          const failure = opts.fail?.(c);
          if (failure) throw failure;
          const task = /^task\/([^/]+)$/.exec(path)?.[1];
          if (method === "GET" && task) return cardTask(task, days.get(task), happy.get(task));
          // ClickUp keeps a date-only value at 03:00Z on its day and answers a dropdown with its orderindex.
          if (method === "POST" && path.includes(`/field/${POC_FIELD}`)) days.set(path.split("/")[1], String(Number(body?.value) - 6 * 3_600_000));
          if (method === "POST" && path.includes(`/field/${HAPPY_FIELD}`)) happy.set(path.split("/")[1], OPTIONS.findIndex(o => o.id === body?.value));
          if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: cardTask(CARD).custom_fields.concat([{ id: "032203ad-e327-4d76-a0ce-c07496da6486", type: "date", value: undefined }]) };
          return {};
        },
      }),
      syncState: async (key, r) => {
        rpcs.push({ name: `syncState:${key}`, params: structuredClone(r) });
      },
    };
    const writes = () => calls.filter(c => c.method !== "GET");
    const saves = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_save").map(r => r.params.p_patch);
    const releases = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_release").map(r => r.params);
    const state = () => rpcs.filter(r => r.name === "cockpit_clickup_forms_state").at(-1)?.params;
    return { deps, calls, rpcs, writes, saves, releases, state };
  }
  const LIVE = { CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_FORMS: "true" };

  it("JOBS adds forms and forms_doctor", () => {
    expect(JOBS).toEqual(["kpi", "log", "dosdonts", "doctor", "requests", "requests_doctor", "forms", "forms_doctor"]);
  });

  it("a dry run claims nothing and reports dry_run: Nothing to write.", async () => {
    const h = formsHarness({ CLICKUP_API_TOKEN: "x" }, []);
    expect(await runForms(h.deps)).toEqual({ ok: true, job: "forms", mode: "dry_run", note: "Nothing to write." });
    expect(h.state()).toMatchObject({ p_ok: true, p_note: "Nothing to write.", p_mode: "dry_run", p_only_cards: [] });
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_claim_forms")?.params).toEqual({ p_token: "11111111-2222-3333-4444-555555555555", p_limit: 8 });
    expect(h.rpcs.some(r => r.name === "cockpit_clickup_writeback_begin")).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("nothing claimed while form rows are open never reads as Nothing to write: it says what waits and why", async () => {
    // Review round 3: the claim settles every row the owner gate refuses first, so what is still open waits.
    const dry = formsHarness({ CLICKUP_API_TOKEN: "x" }, [], { inputs: () => ({ queue: { queued: 3, retry: 1, delivered: 9 }, oldestDue: new Date(NOW - 60_000).toISOString() }) });
    expect((await runForms(dry.deps)).note).toBe("Nothing written: 4 writes wait in the queue while the 1-1 notes writer is off.");
    expect(dry.state()).toMatchObject({ p_ok: true, p_mode: "dry_run", p_counts: { waiting: 4 } });
    // A row on the retry ladder: the next try's time, on the Kuwait clock.
    const later = formsHarness(LIVE, [], { inputs: () => ({ queue: { retry: 1 }, oldestDue: "2026-10-26T10:05:00Z" }) });
    expect((await runForms(later.deps)).note).toBe("Nothing to write now: 1 write waits for a later try, the next at 13:05 Kuwait.");
    // Due but not taken: behind an older call on the card (one lane per card), or for the next run.
    const lane = formsHarness(LIVE, [], { inputs: () => ({ queue: { queued: 2, unknown: 1 }, oldestDue: new Date(NOW - 60_000).toISOString() }) });
    expect((await runForms(lane.deps)).note).toBe("Nothing to write now: 3 writes wait behind an older call on their card, or for the next run.");
    const canary = formsHarness({ ...LIVE, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: TEST_CARD }, [], { inputs: () => ({ queue: { queued: 1 }, oldestDue: new Date(NOW).toISOString() }) });
    expect((await runForms(canary.deps)).note).toBe("Nothing to write now: 1 write waits on the other cards, behind an older call on their card, or for the next run.");
    // Missing is never zero: a count that cannot be read is said.
    const unread = formsHarness(LIVE, [], {
      inputs: () => {
        throw new Error("Supabase 503");
      },
    });
    const out = await runForms(unread.deps);
    expect(out.note).toBe("Nothing to write now. The 1-1 notes queue could not be counted, so it is not reported as empty.");
    expect(unread.state()?.p_counts).toEqual({});
    const shapeless = formsHarness(LIVE, [], { inputs: () => null });
    expect((await runForms(shapeless.deps)).note).not.toBe("Nothing to write.");
    // No open row: the contract's sentence, word for word.
    const empty = formsHarness(LIVE, [], { inputs: () => ({ queue: { delivered: 4, skipped: 2 }, oldestDue: null }) });
    expect((await runForms(empty.deps)).note).toBe("Nothing to write.");
    expect(empty.state()?.p_counts).toEqual({ waiting: 0 });
  });

  it("with the switch off, a claimed row is released, never saved dry_run, and nothing reaches ClickUp", async () => {
    // The writer last reported apply, then the switch was turned off: the claim still hands rows over.
    const h = formsHarness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" }, [row("happiness"), row("last_poc")]);
    const out = await runForms(h.deps);
    expect(out).toMatchObject({ ok: true, mode: "dry_run", counts: { claimed: 2, held: 2, delivered: 0 } });
    expect(out.note).toBe("Dry run: 2 writes held. Nothing was written to ClickUp: the 1-1 notes writer is off until the switch-over.");
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([
      ["q-happiness-86card0001", SAY_FORMS.heldOff],
      ["q-last_poc-86card0001", SAY_FORMS.heldOff],
    ]);
    expect(h.saves().some(s => s.state === "dry_run")).toBe(false);
    expect(h.saves()).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params).toEqual({ p_job: "forms", p_mode: "dry_run", p_exclusive: true });
  });

  it("a card list that cannot be read holds every row, writes nothing and reads not ok on the health row", async () => {
    for (const cards of [",", " , ,", " ", "taskA1;taskB1"]) {
      // The writer last reported live, so the database still hands the rows over; a good test card is among them.
      const env = { ...LIVE, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: cards };
      const h = formsHarness(env, [row("happiness", CARD), row("happiness", TEST_CARD)]);
      const out = await runForms(h.deps);
      expect(h.calls).toEqual([]);
      expect(out).toMatchObject({ ok: false, mode: "dry_run", counts: { claimed: 2, held: 2, heldOff: 2, delivered: 0 } });
      expect(out.note.startsWith(`${FORMS_NOT_A_CARD} Dry run: 2 writes held.`)).toBe(true);
      expect(h.state()).toMatchObject({ p_ok: false, p_mode: "dry_run", p_only_cards: [], p_note: out.note });
      expect(h.releases().map(r => r.p_note)).toEqual([FORMS_NOT_A_CARD, FORMS_NOT_A_CARD]);
      expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params.p_mode).toBe("dry_run");
      expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_finish")?.params).toMatchObject({ p_ok: false, p_note: out.note });
      // Nothing claimed: the sentence still reaches the row, and an empty queue is not a clean bill.
      const idle = formsHarness(env, [], { inputs: () => ({ queue: {}, oldestDue: null }) });
      const quiet = await runForms(idle.deps);
      expect(quiet).toMatchObject({ ok: false, mode: "dry_run", note: `${FORMS_NOT_A_CARD} Nothing to write.` });
      expect(idle.state()).toMatchObject({ p_ok: false, p_mode: "dry_run", p_only_cards: [], p_note: quiet.note });
      // The doctor lists it as a problem, reads only the test card, and never puts the value in a path.
      const doc = formsHarness(env, []);
      const checked = await runFormsDoctor(doc.deps);
      expect(checked).toMatchObject({ ok: false, mode: "dry_run", onlyCards: [] });
      expect(checked.problems).toContain(FORMS_NOT_A_CARD);
      expect(checked.note).toContain("1-1 notes writes: off, because CLICKUP_WRITEBACK_FORMS_ONLY_CARDS is not a list of card ids.");
      expect(doc.writes()).toEqual([]);
      expect(doc.calls.filter(c => c.path.startsWith("task/")).map(c => c.path)).toEqual([`task/${TEST_CARD}`]);
      const general = await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY_FORMS: "true", CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: cards }).deps);
      expect(general).toMatchObject({ formsMode: "dry_run", formsOnlyCards: [] });
      expect(general.note).toContain("1-1 notes writes: off, because CLICKUP_WRITEBACK_FORMS_ONLY_CARDS is not a list of card ids.");
    }
  });

  it("apply_limited writes the test card's rows and holds another card's", async () => {
    const h = formsHarness({ ...LIVE, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: TEST_CARD }, [row("happiness", CARD), row("happiness", TEST_CARD)]);
    const out = await runForms(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([["q-happiness-86card0001", SAY_FORMS.heldLimited]]);
    expect(h.writes()).toEqual([expect.objectContaining({ method: "POST", path: `task/${TEST_CARD}/field/${HAPPY_FIELD}` })]);
    expect(out.note).toBe("Testing on the test card: 1 written to ClickUp, 0 to retry, 0 failed. 1 write held for the other cards.");
    expect(h.state()).toMatchObject({ p_mode: "apply_limited", p_only_cards: [TEST_CARD], p_counts: { claimed: 2, delivered: 1, held: 1, heldOff: 1, heldNext: 0 } });
  });

  it("apply_limited names the rows the switch holds apart from the test card's rows a stop holds for the next run", async () => {
    // Review round 2: a test-card row handed back by a 429 or the budget is waiting for the next run, not "for the other cards".
    const h = formsHarness({ ...LIVE, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: TEST_CARD }, [row("happiness", CARD), row("happiness", TEST_CARD), row("last_poc", TEST_CARD)], {
      fail: c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : undefined),
    });
    const out = await runForms(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([
      ["q-happiness-86card0001", SAY_FORMS.heldLimited],
      [`q-last_poc-${TEST_CARD}`, "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."],
    ]);
    expect(out.note).toBe(
      "Testing on the test card: 0 written to ClickUp, 1 to retry, 0 failed. 1 write held for the other cards. 1 write held for the next run. Stopped: ClickUp asked the cockpit to slow down (429), so the rest waits for the next run.",
    );
    expect(h.state()?.p_counts).toMatchObject({ claimed: 3, retry: 1, held: 2, heldOff: 1, heldNext: 1 });
    // Only the test card's rows: nothing held "for the other cards".
    const own = formsHarness({ ...LIVE, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: TEST_CARD }, [row("happiness", TEST_CARD), row("last_poc", TEST_CARD)], {
      fail: c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : undefined),
    });
    const second = await runForms(own.deps);
    expect(second.note).toBe(
      "Testing on the test card: 0 written to ClickUp, 1 to retry, 0 failed. 1 write held for the next run. Stopped: ClickUp asked the cockpit to slow down (429), so the rest waits for the next run.",
    );
    expect(second.note).not.toContain("other cards");
  });

  it("live: freezes the step before the write and settles by the ladder", async () => {
    const h = formsHarness(LIVE, [row("last_poc")]);
    const out = await runForms(h.deps);
    expect(out).toMatchObject({ ok: true, mode: "apply", note: "1 write reached ClickUp, 0 to retry, 0 failed." });
    const [freeze, ...rest] = h.saves();
    expect(freeze).toEqual({ steps: [{ key: "last_poc", type: "date", taskId: CARD, fieldId: POC_FIELD, day: "2026-10-25", value: Date.parse("2026-10-25T09:00:00Z") }] });
    expect(rest.at(-1)).toMatchObject({ state: "delivered", error: null });
    expect(h.writes()).toEqual([
      { actionId: "q-last_poc-86card0001", provider: "clickup", method: "POST", path: `task/${CARD}/field/${POC_FIELD}`, body: { value: Date.parse("2026-10-25T09:00:00Z"), value_options: { time: false } } },
    ]);
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_finish")?.params).toMatchObject({ p_run: "run-forms", p_ok: true });
  });

  it("a plan that does not match its row fails with no call", async () => {
    const bad = row("happiness");
    bad.payload.taskId = "86elsewhere";
    const h = formsHarness(LIVE, [bad]);
    const out = await runForms(h.deps);
    expect(h.saves()).toEqual([{ state: "failed", error: SAY_FORMS.mismatch }]);
    expect(h.calls).toEqual([]);
    expect(out.ok).toBe(false);
  });

  it("past the 100-second budget the rest goes back to the queue uncounted", async () => {
    let t = NOW;
    const h = formsHarness(LIVE, [row("happiness"), row("last_poc")], { now: () => (t += 60_000) });
    const out = await runForms(h.deps);
    expect(FORMS_RUN_BUDGET_MS).toBe(100_000);
    expect(out.counts).toMatchObject({ delivered: 1, held: 1 });
    expect(h.releases().map(r => r.p_id)).toEqual(["q-last_poc-86card0001"]);
    expect(h.releases()[0].p_note).toBe("Held for the next run, so this run ends inside its time limit.");
  });

  it("a 429 retries on the ladder and stops the run, so the shared token gets its breath", async () => {
    const h = formsHarness(LIVE, [row("happiness"), row("last_poc")], {
      fail: c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : undefined),
    });
    const out = await runForms(h.deps);
    const settle = h.saves().find(s => s.state);
    expect(settle).toMatchObject({ state: "retry" });
    expect(Date.parse(settle?.next_attempt_at)).toBe(NOW + 60_000);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([
      ["q-last_poc-86card0001", "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."],
    ]);
    expect(out.ok).toBe(false);
    expect(out.note).toContain("Stopped: ClickUp asked the cockpit to slow down (429)");
  });

  it("a card read ClickUp never answered, before any write, is a plain retry and never says to check the card", async () => {
    // Review round 2: nothing was sent to the card, so the row is not unknown and its effect stays queued.
    const fail = (c: Call) => (c.method === "GET" ? new Error("clickup rejected the request (502). Inspect the provider receipt.") : undefined);
    const first = formsHarness(LIVE, [row("happiness", CARD)], { fail });
    await runForms(first.deps);
    expect(first.writes()).toEqual([]);
    const settle = first.saves().at(-1);
    expect(settle).toMatchObject({ state: "retry", error: "clickup rejected the request (502). Inspect the provider receipt." });
    expect(Date.parse(settle?.next_attempt_at)).toBe(NOW + 60_000);
    expect(first.saves().some(s => s.state === "unknown")).toBe(false);
    const last = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 })], { fail });
    await runForms(last.deps);
    expect(last.saves().at(-1)).toMatchObject({ state: "failed", error: "Gave up after the retry ladder." });
    expect(last.saves().at(-1)?.progress.lastDetail).toBe("clickup rejected the request (502). Inspect the provider receipt.");
    expect(last.saves().at(-1)?.error).not.toContain("check it in ClickUp");
  });

  it("a 429 on the read-back after a write that went through settles unknown, still stops the run, and at the end of the ladder says to check the card", async () => {
    // Review round 3: the write is on the card, so the row is not a plain retry; the run still gives the shared token its breath.
    let posted = false;
    const fail = (c: Call) => {
      if (c.method === "POST") posted = true;
      return c.method === "GET" && posted ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : undefined;
    };
    const first = formsHarness(LIVE, [row("happiness", CARD), row("last_poc", CARD)], { fail });
    const out = await runForms(first.deps);
    expect(first.writes()).toHaveLength(1);
    expect(first.saves().find(s => s.state)).toMatchObject({ state: "unknown", error: SAY_FORMS.notConfirmed, progress: { lastDetail: "clickup rejected the request (429). Inspect the provider receipt." } });
    expect(first.releases().map(r => [r.p_id, r.p_note])).toEqual([
      [`q-last_poc-${CARD}`, "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."],
    ]);
    expect(out.note).toContain("Stopped: ClickUp asked the cockpit to slow down (429)");
    posted = false;
    const last = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 })], { fail });
    await runForms(last.deps);
    expect(last.saves().at(-1)?.error).toBe("Gave up after the retry ladder. An earlier try may have reached the card, so check it in ClickUp.");
  });

  it("a 502 on the read-back after a started write stays unknown, and at the end of the ladder says to check the card", async () => {
    let posted = false;
    const fail = (c: Call) => {
      if (c.method === "POST") posted = true;
      return c.method === "GET" && posted ? new Error("clickup rejected the request (502). Inspect the provider receipt.") : undefined;
    };
    const first = formsHarness(LIVE, [row("happiness", CARD)], { fail });
    await runForms(first.deps);
    expect(first.writes()).toHaveLength(1);
    expect(first.saves().at(-1)).toMatchObject({ state: "unknown" });
    posted = false;
    const last = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 })], { fail });
    await runForms(last.deps);
    expect(last.saves().at(-1)).toMatchObject({ state: "failed" });
    expect(last.saves().at(-1)?.error).toBe("Gave up after the retry ladder. An earlier try may have reached the card, so check it in ClickUp.");
  });

  describe("a token ClickUp refuses (finish review)", () => {
    const TOKEN = "clickup rejected the request (401): Token invalid";
    const bad = () => new Error(TOKEN);

    it("a 401 the check of the token confirms: two calls, no row fails, no try used, the rest handed back", async () => {
      const h = formsHarness(LIVE, [row("happiness", "86card0001"), row("last_poc", "86card0002"), row("happiness", "86card0003")], { fail: bad });
      const out = await runForms(h.deps);
      expect(h.calls.map(c => `${c.method} ${c.path}`)).toEqual(["GET task/86card0001", `GET list/${CLIENTS_LIST}/field`]);
      // The check lands in the ledger under the row's own action, as every call of the row does.
      expect(h.calls[1].actionId).toBe("q-happiness-86card0001");
      expect(h.saves().filter(s => s.state)).toEqual([]);
      // The release takes the claim's try off (20261029t); the refused row waits, so one card never heads the queue.
      expect(h.releases().map(r => [r.p_id, r.p_note, r.p_next_attempt_at])).toEqual([
        ["q-happiness-86card0001", SAY_FORMS.tokenRefused, new Date(NOW + HOLD_MS).toISOString()],
        ["q-last_poc-86card0002", SAY_FORMS.tokenRefused, new Date(NOW).toISOString()],
        ["q-happiness-86card0003", SAY_FORMS.tokenRefused, new Date(NOW).toISOString()],
      ]);
      expect(out.counts).toMatchObject({ claimed: 3, delivered: 0, failed: 0, retry: 0, unknown: 0, held: 3, heldNext: 3 });
      expect(out.ok).toBe(false);
      expect(out.note).toBe(`0 writes reached ClickUp, 0 to retry, 0 failed. 3 writes held for the next run. Stopped: ${SAY_FORMS.tokenRefused} Last detail: ${TOKEN}`);
    });

    it("on the last rung too the row stays open", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 })], { fail: bad });
      const out = await runForms(h.deps);
      expect(out.counts).toMatchObject({ failed: 0, heldNext: 1 });
      expect(h.saves().filter(s => s.state)).toEqual([]);
      expect(h.releases()).toHaveLength(1);
    });

    it("a 401 on the POST saves the step clean, so the next try starts it fresh", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD)], { fail: c => (c.method === "POST" || c.path.startsWith("list/") ? bad() : undefined) });
      await runForms(h.deps);
      expect(h.writes()).toHaveLength(1);
      expect(h.saves().at(-1)).toEqual({ progress: { steps: {} } });
      expect(h.releases()).toHaveLength(1);
    });

    describe("the token answers, so the card is what refuses it", () => {
      const onCards = (c: Call) => (c.path.startsWith("task/86card0001") ? bad() : undefined);

      it("the row climbs the ladder with its try used, and the run goes on to the next card, not stopped", async () => {
        const h = formsHarness(LIVE, [row("happiness", "86card0001"), row("happiness", "86card0002")], { fail: onCards });
        const out = await runForms(h.deps);
        expect(h.releases()).toEqual([]);
        const first = h.saves().find(s => s.state === "retry");
        expect(first).toMatchObject({ state: "retry", error: TOKEN, next_attempt_at: new Date(NOW + 60_000).toISOString() });
        expect(h.saves().some(s => s.state === "delivered")).toBe(true);
        expect(out.counts).toMatchObject({ retry: 1, delivered: 1, failed: 0, held: 0, heldNext: 0 });
        expect(out.ok).toBe(true);
        expect(out.note).not.toContain("Stopped:");
        expect(out.note).not.toContain("CLICKUP_API_TOKEN");
        expect(out.note).toContain("ClickUp refused the cockpit's token on card 86card0001.");
      });

      it("on the last rung the row is failed with the plain sentence, ClickUp's wording kept on progress and in the note", async () => {
        const h = formsHarness(LIVE, [row("happiness", "86card0001", { attempts: 6 })], { fail: onCards });
        const out = await runForms(h.deps);
        expect(h.releases()).toEqual([]);
        expect(h.saves().at(-1)).toMatchObject({ state: "failed", error: "ClickUp refused this card to the cockpit's token, so nothing was written." });
        expect(h.saves().at(-1)?.progress?.lastDetail).toBe(TOKEN);
        expect(out.counts).toMatchObject({ failed: 1 });
        expect(out.ok).toBe(false);
        expect(out.note).toContain(`Last detail: ${TOKEN}`);
      });

      it("checks the token once a run: a second refused card costs no second check", async () => {
        const h = formsHarness(LIVE, [row("happiness", "86card0001"), row("happiness", "86card0001b"), row("last_poc", "86card0001c")], { fail: onCards });
        const out = await runForms(h.deps);
        expect(h.calls.filter(c => c.path === `list/${CLIENTS_LIST}/field`)).toHaveLength(1);
        expect(out.counts).toMatchObject({ retry: 3 });
      });

      it("a 401 on the read-back after a write that went through is unknown: it may be on the card", async () => {
        let posted = false;
        const fail = (c: Call) => {
          if (c.method === "POST") posted = true;
          else if (posted && c.path.startsWith("task/")) return bad();
          return undefined;
        };
        const h = formsHarness(LIVE, [row("happiness", "86card0001")], { fail });
        const out = await runForms(h.deps);
        expect(h.saves().at(-1)).toMatchObject({ state: "unknown", error: SAY_FORMS.readRefused });
        expect(out.counts).toMatchObject({ unknown: 1, retry: 0 });
        const last = formsHarness(LIVE, [row("happiness", "86card0001", { attempts: 6, progress: { steps: { happiness: { state: "started", at: new Date(NOW).toISOString() } } }, steps: undefined })], {
          fail: c => (c.path.startsWith("task/") ? bad() : undefined),
        });
        await runForms(last.deps);
        expect(last.saves().at(-1)).toMatchObject({ state: "failed", error: "Gave up after the retry ladder. An earlier try may have reached the card, so check it in ClickUp." });
      });
    });

    describe("the check of the token tells nothing: no try used, the run stops", () => {
      const cases: [string, Error | null, string][] = [
        ["a 429", new Error("clickup rejected the request (429): Rate limit reached"), "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."],
        ["a 500", new Error("clickup rejected the request (500). Inspect the provider receipt."), SAY_FORMS.tokenUnsure],
        ["no answer", new Error("network connection lost"), SAY_FORMS.tokenUnsure],
        ["a 404", new Error("clickup rejected the request (404). Inspect the provider receipt."), SAY_FORMS.tokenUnsure],
      ];
      for (const [name, answer, sentence] of cases)
        it(`${name} on the check`, async () => {
          const h = formsHarness(LIVE, [row("happiness", "86card0001", { attempts: 6 }), row("happiness", "86card0002")], {
            fail: c => (c.path.startsWith("list/") ? (answer as Error) : bad()),
          });
          const out = await runForms(h.deps);
          expect(h.calls).toHaveLength(2);
          expect(h.saves().filter(s => s.state)).toEqual([]);
          expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([
            ["q-happiness-86card0001", sentence],
            ["q-happiness-86card0002", sentence],
          ]);
          expect(h.releases()[0].p_next_attempt_at).toBe(new Date(NOW + HOLD_MS).toISOString());
          expect(out.ok).toBe(false);
          expect(out.note).toContain(`Stopped: ${sentence}`);
        });
    });
  });

  describe("the pace floor keeps a run inside the Edge wall (break-it)", () => {
    for (const set of ["1", "4", "5"])
      it(`CLICKUP_FORMS_CALLS_PER_MINUTE=${set}: eight rows, the last ClickUp call is before 150 s`, async () => {
        let t = NOW;
        const stamps: number[] = [];
        const env = { ...LIVE, CLICKUP_FORMS_CALLS_PER_MINUTE: set };
        const rows = Array.from({ length: 8 }, (_, i) => row("happiness", `86card000${i}`));
        const h = formsHarness(env, rows, {
          now: () => t,
          // A first row of one call (a card off the list), so a field row's three calls straddle the budget at 100 s.
          fail: c => {
            t += 500;
            stamps.push(t - NOW);
            return c.path === "task/86card0000" ? new Error("clickup rejected the request (404). Inspect the provider receipt.") : undefined;
          },
        });
        h.deps.pace = pacer(formsPerMinute(k => (env as Record<string, string>)[k]), () => t, async ms => {
          t += ms;
        });
        const out = await runForms(h.deps);
        expect(Math.max(...stamps)).toBeLessThan(150_000);
        // The time ran out before the rows did, and the rest go back with no try used.
        expect(out.counts?.heldNext).toBeGreaterThan(0);
      });
  });

  describe("the stop holds on the last rung (finish review)", () => {
    it("a 429 that ends a row's ladder still stops the run: no second call on the shared token, and the next row keeps its try", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 }), row("last_poc", "86card0002")], {
        fail: () => new Error("clickup rejected the request (429): Rate limit reached"),
      });
      const out = await runForms(h.deps);
      expect(h.calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET task/${CARD}`]);
      expect(out.counts).toMatchObject({ failed: 1, retry: 0, heldNext: 1 });
      expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([["q-last_poc-86card0002", "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."]]);
      expect(out.note).toContain("Stopped: ClickUp asked the cockpit to slow down (429)");
    });

    it("a missing secret on the last rung stops it too", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 }), row("last_poc", "86card0002")], {
        fail: () => new Error("CLICKUP_API_TOKEN is not configured"),
      });
      const out = await runForms(h.deps);
      expect(h.calls).toHaveLength(1);
      expect(out.counts).toMatchObject({ failed: 1, heldNext: 1 });
      expect(h.releases().map(r => r.p_id)).toEqual(["q-last_poc-86card0002"]);
    });
  });

  describe("ClickUp's wording stays off the row's error, so off the CSM's trail (finish review)", () => {
    const FIVE = "clickup rejected the request (500). Inspect the provider receipt.";

    it("a 500 on the POST: the row says not confirmed, the wording goes to progress and the run's note", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD)], { fail: c => (c.method === "POST" ? new Error(FIVE) : undefined) });
      const out = await runForms(h.deps);
      const settle = h.saves().find(s => s.state);
      expect(settle).toMatchObject({ state: "unknown", error: SAY_FORMS.notConfirmed, progress: { lastDetail: FIVE } });
      expect(settle?.error).not.toMatch(/rejected the request|provider receipt/);
      expect(out.note).toBe(`0 writes reached ClickUp, 1 to retry, 0 failed. Last detail: ${FIVE}`);
    });

    it("a 429 at the end of the ladder: no raw sentence on the row, and the wording is still in the run's note", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD, { attempts: 6 })], { fail: () => new Error("clickup rejected the request (429): Rate limit reached") });
      const out = await runForms(h.deps);
      const settle = h.saves().at(-1);
      expect(settle).toMatchObject({ state: "failed", error: "Gave up after the retry ladder.", progress: { lastDetail: "clickup rejected the request (429): Rate limit reached" } });
      expect(out.note).toContain("Last detail: clickup rejected the request (429): Rate limit reached");
    });

    it("a resumed row on a card that left the list settles failed with the check-the-card sentence, never nothing was written", async () => {
      const resumed = { progress: { steps: { happiness: { state: "started", at: new Date(NOW - 60_000).toISOString() } } } };
      const gone = formsHarness(LIVE, [row("happiness", CARD, resumed)], { fail: c => (c.method === "GET" && c.path === `task/${CARD}` ? new Error("clickup rejected the request (404): Task not found") : undefined) });
      await runForms(gone.deps);
      expect(gone.saves().find(s => s.state)).toMatchObject({ state: "failed", error: SAY_FORMS.offListStarted });
    });

    it("a POST refused with a 404 reads as the field steps read; a 403 reads as refused", async () => {
      const gone = formsHarness(LIVE, [row("happiness", CARD)], { fail: c => (c.method === "POST" ? new Error("clickup rejected the request (404): Task not found") : undefined) });
      await runForms(gone.deps);
      expect(gone.saves().find(s => s.state)).toMatchObject({ state: "failed", error: SAY_FORMS.offList });
      const no = formsHarness(LIVE, [row("happiness", CARD)], { fail: c => (c.method === "POST" ? new Error("clickup rejected the request (403): Forbidden") : undefined) });
      await runForms(no.deps);
      expect(no.saves().find(s => s.state)).toMatchObject({ state: "failed", error: SAY_FORMS.refused });
    });

    it("a row still on retry keeps the wording for the tech lead: its error reaches no effect", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD)], { fail: c => (c.method === "POST" ? new Error("clickup rejected the request (429): Rate limit reached") : undefined) });
      const out = await runForms(h.deps);
      expect(h.saves().find(s => s.state)).toMatchObject({ state: "retry", error: "clickup rejected the request (429): Rate limit reached" });
      expect(out.note).not.toContain("Last detail");
    });

    it("our own bookkeeping failing says the cockpit's sentence, not the database's", async () => {
      const h = formsHarness(LIVE, [row("happiness", CARD)]);
      const real = h.deps.rpc;
      let n = 0;
      h.deps.rpc = async (name, params) => {
        // The freeze goes through; the next save, the step's "started", fails, and the save of the outcome goes through.
        if (name === "cockpit_clickup_writeback_save" && ++n === 2) throw new Error("Supabase 503: upstream unavailable");
        return real(name, params);
      };
      const out = await runForms(h.deps);
      const settle = h.saves().find(s => s.state);
      expect(settle).toMatchObject({ state: "unknown", error: SAY.bookkeeping });
      expect(out.note).toContain("Supabase 503");
    });
  });

  it("one run at a time: a run that finds another open hands every claimed row back uncounted, calls nothing and is not a failure", async () => {
    const busy = "A forms run that started at 11:59 Kuwait is still running.";
    const h = formsHarness(LIVE, [row("happiness"), row("last_poc")], { begin: p => (p.p_exclusive ? { id: null, note: busy } : { id: "run-forms" }) });
    const out = await runForms(h.deps);
    expect(h.rpcs.filter(r => r.name === "cockpit_clickup_writeback_begin").map(r => r.params)).toEqual([{ p_job: "forms", p_mode: "apply", p_exclusive: true }]);
    expect(h.calls).toEqual([]);
    expect(h.saves()).toEqual([]);
    expect(h.releases().map(r => [r.p_id, r.p_note, r.p_next_attempt_at])).toEqual([
      ["q-happiness-86card0001", FORMS_BUSY_HELD, new Date(NOW).toISOString()],
      ["q-last_poc-86card0001", FORMS_BUSY_HELD, new Date(NOW).toISOString()],
    ]);
    expect(out).toEqual({ ok: true, job: "forms", mode: "apply", note: formsAnotherRunNote(2), counts: { claimed: 2, handedBack: 2 } });
    expect(out.note).toBe("Another 1-1 notes run is still sending, so this one handed back the 2 writes it claimed; the next run takes them.");
    expect(formsAnotherRunNote(1)).toBe("Another 1-1 notes run is still sending, so this one handed back the write it claimed; the next run takes it.");
    expect(h.state()).toMatchObject({ p_ok: true, p_note: formsAnotherRunNote(2), p_mode: "apply" });
    expect(h.rpcs.some(r => r.name === "cockpit_clickup_writeback_finish")).toBe(false);
  });

  it("an open run 4 minutes old stopped without reporting back: the run goes ahead and says so", async () => {
    // NOW is 12:00 Kuwait.
    const stale = formsHarness(LIVE, [row("last_poc")], {
      begin: p => (p.p_exclusive ? { id: null, note: "A forms run that started at 11:56 Kuwait is still running." } : { id: "run-forms" }),
    });
    const out = await runForms(stale.deps);
    expect(stale.rpcs.filter(r => r.name === "cockpit_clickup_writeback_begin").map(r => r.params.p_exclusive)).toEqual([true, false]);
    expect(out).toMatchObject({ ok: true, counts: { delivered: 1 } });
    expect(out.note).toBe("1 write reached ClickUp, 0 to retry, 0 failed. A 1-1 notes run that started at 11:56 Kuwait never reported back, so this one went ahead.");
    // Three minutes old: still writing, so this run hands back.
    const fresh = formsHarness(LIVE, [row("last_poc")], {
      begin: p => (p.p_exclusive ? { id: null, note: "A forms run that started at 11:57 Kuwait is still running." } : { id: "run-forms" }),
    });
    expect((await runForms(fresh.deps)).note).toBe(formsAnotherRunNote(1));
    expect(fresh.calls).toEqual([]);
  });

  it("a begin that fails for another reason hands the rows back and reports the run could not start", async () => {
    const h = formsHarness(LIVE, [row("happiness")], {
      begin: () => {
        throw new Error("Supabase 503: upstream unavailable");
      },
    });
    const out = await runForms(h.deps);
    expect(out).toMatchObject({ ok: false, mode: "apply" });
    expect(out.note).toBe("The 1-1 notes run could not start, so this waits for the next run. Supabase 503: upstream unavailable");
    expect(h.releases().map(r => r.p_note)).toEqual(["The 1-1 notes run could not start, so this waits for the next run."]);
    expect(h.calls).toEqual([]);
  });

  it("openRunMinutes reads the forms job's busy note too, on the Kuwait clock", () => {
    const at = Date.parse("2026-10-26T09:00:00Z"); // 12:00 Kuwait
    expect(openRunMinutes("A forms run that started at 11:58 Kuwait is still running.", at)).toBe(2);
    expect(openRunMinutes("A forms run that started at 12:00 Kuwait is still running.", at)).toBe(0);
    expect(openRunMinutes("A forms run that started at 23:59 Kuwait is still running.", Date.parse("2026-10-26T21:01:00Z"))).toBe(2);
    for (const junk of [undefined, null, "", "Unsupported writeback run", "started at 25:00 Kuwait is still running"]) expect(openRunMinutes(junk, at)).toBeNull();
    expect(STALE_RUN_MINUTES).toBe(4);
  });

  it("the pace is the job's: two runs posted together send one run's calls, within 10 a minute, and the pacer never waits", async () => {
    // Review round 2's scratch case: each run builds its own pacer as index.ts does, three rows on three cards each.
    const open = new Set<string>();
    const calls: Call[] = [];
    const happy = new Map<string, number>();
    let seq = 0;
    const one = (cards: string[]) => {
      let queue = cards.map(t => row("happiness", t));
      const rpcs: { name: string; params: any }[] = [];
      const deps: Deps = {
        env: k => (LIVE as Record<string, string>)[k],
        now: () => NOW,
        uuid: () => `00000000-0000-4000-8000-00000000000${++seq}`,
        rpc: async (name, params = {}) => {
          rpcs.push({ name, params: structuredClone(params) });
          if (name === "cockpit_clickup_writeback_claim_forms") {
            const out = queue;
            queue = [];
            return out;
          }
          if (name === "cockpit_clickup_writeback_begin") {
            // The live begin under its advisory lock: exclusive gives no id while a forms run is open.
            if (params.p_exclusive && open.size) return { id: null, note: "A forms run that started at 12:00 Kuwait is still running." };
            const id = `run-${++seq}`;
            open.add(id);
            return { id };
          }
          if (name === "cockpit_clickup_writeback_finish") open.delete(params.p_run);
          if (name === "cockpit_clickup_writeback_release") return { id: params.p_id, state: "queued" };
          return null;
        },
        providerFor: (actionId: string): Provider => ({
          async call(provider, method, path, body) {
            calls.push({ actionId, provider, method, path, body });
            const task = /^task\/([^/]+)$/.exec(path)?.[1];
            if (method === "GET" && task) return cardTask(task, undefined, happy.get(task));
            if (method === "POST") happy.set(path.split("/")[1], OPTIONS.findIndex(o => o.id === body?.value));
            return {};
          },
        }),
        pace: pacer(formsPerMinute(k => (LIVE as Record<string, string>)[k]), () => NOW, async () => {
          throw new Error("the pacer had to wait");
        }),
      };
      return { deps, rpcs };
    };
    const a = one(["86cardA", "86cardB", "86cardC"]);
    const b = one(["86cardD", "86cardE", "86cardF"]);
    const [ra, rb] = await Promise.all([runForms(a.deps), runForms(b.deps)]);
    expect(formsPerMinute(() => undefined)).toBe(10);
    expect(calls.length).toBeLessThanOrEqual(FORMS_CALLS_PER_MINUTE);
    expect(calls).toHaveLength(9);
    const sent = [ra, rb].find(r => r.counts?.delivered === 3);
    const handed = [ra, rb].find(r => r.note === formsAnotherRunNote(3));
    expect(sent).toMatchObject({ ok: true });
    expect(handed).toMatchObject({ ok: true, counts: { claimed: 3, handedBack: 3 } });
    // Every call belongs to the run that sent; the other one's rows went back with the busy note.
    const loser = handed === ra ? a : b;
    expect(loser.rpcs.filter(r => r.name === "cockpit_clickup_writeback_release").map(r => r.params.p_note)).toEqual([FORMS_BUSY_HELD, FORMS_BUSY_HELD, FORMS_BUSY_HELD]);
    expect(new Set(calls.map(c => c.actionId.split("-").at(-1)))).toEqual(new Set(handed === ra ? ["86cardD", "86cardE", "86cardF"] : ["86cardA", "86cardB", "86cardC"]));
  });

  it("without the ClickUp token it reports and claims nothing", async () => {
    const h = formsHarness({ CLICKUP_WRITEBACK_APPLY_FORMS: "true" }, [row("happiness")]);
    expect(await runForms(h.deps)).toMatchObject({ ok: false, mode: "apply" });
    expect(h.rpcs.some(r => r.name === "cockpit_clickup_writeback_claim_forms")).toBe(false);
    expect(h.state()?.p_ok).toBe(false);
  });

  it("the forms doctor reads only, names secrets as booleans and lands in clickup-writeback:forms-doctor", async () => {
    const h = formsHarness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s" }, []);
    const out = await runFormsDoctor(h.deps);
    expect(out.ok).toBe(true);
    expect(out.note).toBe(
      "Ready. 1-1 notes writes: dry run (they are written only when CLICKUP_WRITEBACK_APPLY_FORMS is true). Client Happiness has its six options and Last POC and Last Check-in Call are date fields on Clients - Mahara. The test card 86eywg1cq is on Clients - Mahara.",
    );
    expect(out.secrets).toEqual({ CLICKUP_API_TOKEN: true, CRON_SECRET: true, CLICKUP_WRITEBACK_APPLY_FORMS: false, CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: false });
    expect(h.writes()).toEqual([]);
    const saved = h.rpcs.find(r => r.name === "syncState:clickup-writeback:forms-doctor")?.params;
    expect(saved).toMatchObject({ ok: true, detail: { mode: "dry_run", onlyCards: [], owners: { happiness: "shadow" } } });
    expect(JSON.stringify(saved)).not.toContain('"x"');
  });

  it("the general doctor names the 1-1 notes switch from the environment only", async () => {
    const off = await runDoctor(harness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s" }).deps);
    expect(off).toMatchObject({ formsMode: "dry_run", formsOnlyCards: [] });
    expect(off.note).toContain("1-1 notes writes: dry run (they are written only when CLICKUP_WRITEBACK_APPLY_FORMS is true).");
    const canary = await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY_FORMS: "true", CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: TEST_CARD }).deps);
    expect(canary).toMatchObject({ formsMode: "apply_limited", formsOnlyCards: [TEST_CARD] });
    expect((await runDoctor(harness({ CLICKUP_WRITEBACK_APPLY_REQUESTS: "true", CLICKUP_WRITEBACK_APPLY: "true" }).deps)).formsMode).toBe("dry_run");
  });

  it("the forms pace: 10 a minute by default, CLICKUP_FORMS_CALLS_PER_MINUTE tunes it, 60 at most", () => {
    expect(FORMS_CALLS_PER_MINUTE).toBe(10);
    expect(formsPerMinute(() => undefined)).toBe(10);
    expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? "6" : undefined))).toBe(6);
    expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? "60" : undefined))).toBe(60);
    for (const v of ["61", "100", "5000"]) expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? v : undefined))).toBe(60);
    for (const v of ["0", "-3", "fast", ""]) expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? v : undefined))).toBe(10);
    // Never below the floor of every other ClickUp pace.
    for (const v of ["0.5", "0.9", "1", "2", "4", "4.9"]) expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? v : undefined))).toBe(CALLS_MIN);
    expect(formsPerMinute(k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? "5" : undefined))).toBe(5);
  });

  // The real index.ts, its Deno.serve caught and fetch answered here, so no call leaves this file: what it proves is
  // the wiring (which pace a job gets, that each call has its own pacer). The begin below is the live one's rule, job
  // by job, which forms-writeback-supabase.test.ts proves against the SQL.
  describe("index.ts: a forms run and a requests run side by side", () => {
    const WORK_TASK = "86work0001";
    const realFetch = globalThis.fetch;
    const realTimeout = globalThis.setTimeout;
    const realDeno = (globalThis as any).Deno;
    const env: Record<string, string> = {};
    let handler: (req: Request) => Promise<Response>;
    beforeAll(async () => {
      (globalThis as any).Deno = {
        env: { get: (k: string) => env[k] },
        serve: (h: (req: Request) => Promise<Response>) => {
          handler = h;
        },
      };
      await import("./index.ts");
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      globalThis.setTimeout = realTimeout;
    });
    afterAll(() => {
      (globalThis as any).Deno = realDeno;
    });
    /** One function deployment: its secrets, the forms queue, the requests fake, and the pacers' waits held, never fired. */
    function world(secrets: Record<string, string>, formRows: any[] = []) {
      for (const k of Object.keys(env)) delete env[k];
      Object.assign(env, { SUPABASE_URL: "https://db.invented.test", SUPABASE_SERVICE_ROLE_KEY: "svc", CRON_SECRET: "s", CLICKUP_API_TOKEN: "x", ...secrets });
      const requests = requestsHarness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" });
      requests.clickup.addTask({
        id: WORK_TASK,
        name: "Acme Interiors - General tech request",
        listId: LISTS.tech,
        assignees: [{ id: PEOPLE.systemsManager }],
        status: { status: "in progress", type: "custom" },
        checklists: [{ id: "cl0001", name: "SOP steps", date_created: "1", items: [{ id: "it0002", name: "Make the change", resolved: false, orderindex: 1 }] }],
      });
      const action = requests.db.enqueue("task_action", actionPayload("tick", { checklistId: "cl0001", itemId: "it0002", itemName: "Make the change", from: false, to: true }));
      let queue = formRows;
      const open = new Set<string>();
      const begins: { job: string; exclusive: boolean; id: string | null }[] = [];
      const happy = new Map<string, number>();
      const formsCalls: string[] = [];
      const requestsCalls: string[] = [];
      const waits: number[] = [];
      const gate: { hold: Promise<void> | null } = { hold: null };
      const answer = (body: unknown, status = 200) => new Response(body === null || body === undefined ? "" : JSON.stringify(body), { status });
      const rpc = async (name: string, params: Record<string, any>): Promise<unknown> => {
        if (name === "cockpit_clickup_writeback_begin") {
          const job = String(params.p_job);
          if (params.p_exclusive && open.has(job)) {
            begins.push({ job, exclusive: true, id: null });
            return { id: null, note: `A ${job} run that started at 12:00 Kuwait is still running.` };
          }
          open.add(job);
          begins.push({ job, exclusive: Boolean(params.p_exclusive), id: `run-${job}` });
          return { id: `run-${job}` };
        }
        if (name === "cockpit_clickup_writeback_finish") {
          open.delete(String(params.p_run).replace("run-", ""));
          return null;
        }
        if (name === "cockpit_clickup_writeback_claim_forms") {
          const out = queue;
          queue = [];
          return out;
        }
        if (name === "cockpit_clickup_forms_doctor_inputs") return { owners: { happiness: "shadow" }, queue: {} };
        if (name === "cockpit_clickup_forms_state") return null;
        if (String(params.p_id ?? "").startsWith("q-")) return { id: params.p_id };
        return requests.deps.rpc(name, params);
      };
      const clickup = async (method: string, path: string, body: any): Promise<Response> => {
        const task = /^task\/(86card[^/]*)/.exec(path)?.[1];
        const isList = path.startsWith(`list/${CLIENTS_LIST}`);
        if (task || isList) {
          formsCalls.push(`${method} ${path}`);
          if (isList) return answer({ fields: [] });
          if (method === "GET") return answer(cardTask(task as string, undefined, happy.get(task as string)));
          happy.set(task as string, OPTIONS.findIndex(o => o.id === body?.value));
          return answer({});
        }
        requestsCalls.push(`${method} ${path}`);
        if (gate.hold) await gate.hold;
        return answer(await requests.clickup.provider("beside").call("clickup", method, path, body));
      };
      globalThis.fetch = (async (input: any, init: any = {}) => {
        const url = String(input);
        const body = init.body ? JSON.parse(init.body) : undefined;
        if (url.startsWith("https://api.clickup.com/api/v2/")) return clickup(String(init.method), url.slice("https://api.clickup.com/api/v2/".length), body);
        const called = /^https:\/\/db\.invented\.test\/rest\/v1\/(.+)$/.exec(url)?.[1];
        if (!called) throw new Error(`A call left the test: ${url}`);
        if (called.startsWith("rpc/")) return answer(await rpc(called.slice(4), body));
        return answer(null, 201); // the provider ledger's row
      }) as typeof fetch;
      globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
        if (Number(ms) >= 1000) {
          waits.push(Number(ms));
          return 0;
        }
        return (realTimeout as any)(fn, ms, ...rest);
      }) as unknown as typeof setTimeout;
      const post = (job: string) => handler(new Request("https://fn.invented.test/", { method: "POST", headers: { "x-cron-secret": "s" }, body: JSON.stringify({ job }) })).then(r => r.json() as Promise<Record<string, any>>);
      const until = async (done: () => boolean) => {
        for (let i = 0; i < 2000 && !done(); i++) await new Promise(r => realTimeout(r, 1));
        expect(done()).toBe(true);
      };
      return { action, begins, open, formsCalls, requestsCalls, waits, gate, post, until };
    }
    const cards = (n: number) => Array.from({ length: n }, (_, i) => row("happiness", `86card${i}`, { id: `q-${i}` }));
    const LIVE_BOTH = { CLICKUP_WRITEBACK_APPLY_FORMS: "true", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" };

    it("a forms run waiting on its own pace does not hold a requests run up, and requests never read the forms pace", async () => {
      const w = world({ ...LIVE_BOTH, CLICKUP_FORMS_CALLS_PER_MINUTE: "5" }, cards(2));
      const forms = w.post("forms");
      let formsDone = false;
      void forms.then(() => {
        formsDone = true;
      });
      // Five calls a minute: the first five went, the sixth waits on the pacer.
      await w.until(() => w.waits.length === 1);
      expect(w.formsCalls).toHaveLength(5);
      expect(w.waits[0]).toBeGreaterThan(58_000);
      expect(w.waits[0]).toBeLessThanOrEqual(60_005);
      const out = await w.post("requests");
      expect(out).toMatchObject({ ok: true, job: "requests", counts: { delivered: 1 } });
      expect(w.action.state).toBe("delivered");
      // Three calls in one go with the forms pace spent: this run had its own pacer, and it never waited.
      expect(w.requestsCalls.length).toBeGreaterThanOrEqual(3);
      expect(w.waits).toHaveLength(1);
      expect(w.begins).toEqual([
        { job: "forms", exclusive: true, id: "run-forms" },
        { job: "requests", exclusive: true, id: "run-requests" },
      ]);
      expect(formsDone).toBe(false);
      expect([...w.open]).toEqual(["forms"]);
      expect(w.formsCalls).toHaveLength(5);
    });

    it("a requests run still sending does not hold a forms run up", async () => {
      const w = world(LIVE_BOTH, cards(1));
      let free: () => void = () => {};
      w.gate.hold = new Promise<void>(r => {
        free = r;
      });
      const requests = w.post("requests");
      await w.until(() => w.requestsCalls.length === 1);
      expect([...w.open]).toEqual(["requests"]);
      const out = await w.post("forms");
      expect(out).toMatchObject({ ok: true, job: "forms", counts: { delivered: 1 } });
      expect(w.formsCalls).toHaveLength(3);
      expect([...w.open]).toEqual(["requests"]);
      free();
      expect(await requests).toMatchObject({ ok: true, job: "requests", counts: { delivered: 1 } });
      expect(w.open.size).toBe(0);
      expect(w.waits).toEqual([]);
    });

    it("the pace a forms run uses is formsPerMinute: 10 unless set, whatever the other jobs' secrets say", async () => {
      // Four rows are 12 calls, so the pacer stops the run where the pace says.
      const other = { CLICKUP_CALLS_PER_MINUTE: "60", CLICKUP_REQUESTS_CALLS_PER_MINUTE: "60" };
      const byDefault = world({ ...LIVE_BOTH, ...other }, cards(4));
      void byDefault.post("forms");
      await byDefault.until(() => byDefault.waits.length === 1);
      expect(byDefault.formsCalls).toHaveLength(formsPerMinute(() => undefined));
      expect(byDefault.formsCalls).toHaveLength(10);
      const tuned = world({ ...LIVE_BOTH, ...other, CLICKUP_FORMS_CALLS_PER_MINUTE: "6" }, cards(4));
      void tuned.post("forms");
      await tuned.until(() => tuned.waits.length === 1);
      expect(tuned.formsCalls).toHaveLength(6);
    });

    it("forms_doctor keeps the forms pace too, and the forms secret does not reach another job's pace", async () => {
      // Set to 1, so the floor of 5 is the pace: the field list and four of the six cards, then the pacer.
      const doctor = world({ CLICKUP_FORMS_CALLS_PER_MINUTE: "1", CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: "86card0,86card1,86card2,86card3,86card4,86card5" });
      void doctor.post("forms_doctor");
      await doctor.until(() => doctor.waits.length === 1);
      expect(doctor.formsCalls).toHaveLength(5);
      expect(writebackPerMinute("requests", k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? "6" : undefined))).toBe(25);
      expect(writebackPerMinute("log", k => (k === "CLICKUP_FORMS_CALLS_PER_MINUTE" ? "6" : undefined))).toBe(30);
    });
  });

  it("the sha256 the payload carries is the hex of the text's UTF-8 bytes", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
