import { describe, expect, it } from "bun:test";
import { type Deps, gate, pacer, runDoctor, runDosDonts, runKpi, runLog } from "./run";
import type { Provider } from "./queue";
import { ADS_LIST, CLIENTS_LIST, DOS_DONTS_FIELD, FIELD, NOTES_MARK } from "./rules";

const NOW = Date.parse("2026-10-09T09:00:00Z");
type Call = { actionId: string; provider: string; method: string; path: string; body?: any };

const options = (prefix: string) => ["Above KPI", "At KPI", "Below KPI", "911"].map((name, i) => ({ id: `${prefix}${i}`, name, orderindex: i }));
const BOARD_FIELDS = [
  { id: FIELD.cplStatus, type_config: { options: options("cpl-") } },
  { id: FIELD.cpbStatus, type_config: { options: options("cpb-") } },
  { id: FIELD.adStatus, type_config: { options: [{ id: "opt-live", name: "Live", orderindex: 0 }, { id: "opt-paused", name: "Paused", orderindex: 1 }] } },
];
const card = (id: string, cpl?: number) => ({ id, name: `Card ${id}`, custom_fields: cpl === undefined ? [] : [{ id: FIELD.cpl7d, value: String(cpl) }] });
const campaign = (name: string, taskId: string, spend: number, leads: number) => ({ campaignName: name, clientName: name, taskId, internal: false, spend7d: spend, leads7d: leads, cpl: leads ? spend / leads : null });
const INPUTS = {
  campaigns: [campaign("A", "t1", 60, 4), campaign("B", "t2", 40, 2)],
  daily: [{ campaignName: "A", day: "2026-10-05", spend: 60, leads: 4 }, { campaignName: "B", day: "2026-10-06", spend: 40, leads: 2 }],
  bookings: [],
  dailyReady: true,
  bookingsReady: true,
  latestPublishAt: new Date(NOW - 10 * 60_000).toISOString(),
};

function harness(env: Record<string, string>, opts: { items?: any[]; tasks?: any[]; route?: (c: Call) => any } = {}) {
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
      if (name === "cockpit_clickup_writeback_inputs") return INPUTS;
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
});

describe("kpi job", () => {
  it("dry run reads the board and records every planned write, writing nothing", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const out = await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out).toMatchObject({ ok: true, mode: "dry_run" });
    expect(out.note).toContain("Nothing was written to ClickUp");
    const planned = h.finish().p_planned;
    expect(planned.find((p: any) => p.taskId === "t1" && p.fieldId === FIELD.cpl7d)).toMatchObject({ field: "CPL (7d)", old: 15, new: 15, status: "unchanged" });
    expect(planned.find((p: any) => p.taskId === "t2" && p.fieldId === FIELD.cpl7d)).toMatchObject({ old: null, new: 20, status: "planned" });
    expect(planned.filter((p: any) => p.fieldId === FIELD.lastUpdated).map((p: any) => p.status)).toEqual(["planned", "planned"]);
    // Every provider call is recorded under the run id.
    expect(new Set(h.calls.map(c => c.actionId))).toEqual(new Set(["run-1"]));
  });

  it("a mistyped flag is still a dry run", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "TRUE" });
    await runKpi(h.deps);
    expect(h.writes()).toEqual([]);
  });

  it("applies changed fields and Last Updated, and skips unchanged values", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true" });
    const out = await runKpi(h.deps);
    expect(out).toMatchObject({ ok: true, mode: "apply", counts: { updated: 2, failed: 0 } });
    expect(h.writes().map(c => `${c.path}=${JSON.stringify(c.body.value)}`)).toEqual([
      `task/t1/field/${FIELD.cplStatus}="cpl-1"`,
      `task/t1/field/${FIELD.lastUpdated}=${NOW}`,
      `task/t2/field/${FIELD.cpl7d}=20`,
      `task/t2/field/${FIELD.cplStatus}="cpl-2"`,
      `task/t2/field/${FIELD.lastUpdated}=${NOW}`,
    ]);
  });

  it("a limited live run writes only the allowed card", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "t2" });
    await runKpi(h.deps);
    expect(new Set(h.writes().map(c => c.path.split("/")[1]))).toEqual(new Set(["t2"]));
    expect(h.finish().p_planned.filter((p: any) => p.taskId === "t1" && p.status === "planned").length).toBeGreaterThan(0);
  });

  it("fails the run when no card took the numbers, as Convex did", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true" }, { route: c => (c.method === "POST" ? new Error("clickup rejected the request (401): Token invalid") : undefined) });
    const out = await runKpi(h.deps);
    expect(out.ok).toBe(false);
    expect(out.counts).toMatchObject({ updated: 0, failed: 2 });
  });

  it("without the ClickUp token it says so and touches nothing", async () => {
    const h = harness({});
    const out = await runKpi(h.deps);
    expect(out.ok).toBe(false);
    expect(out.note).toContain("CLICKUP_API_TOKEN is not set");
    expect(h.calls).toEqual([]);
    expect(h.rpcs.map(r => r.name)).toEqual(["cockpit_clickup_writeback_idle"]);
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
    expect(saved[0].planned[0].new).toContain("🎯 Cockpit · CHANGE MADE — Raised budget to $40");
    expect(h.finish().p_planned).toHaveLength(1);
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
  });

  it("the limiter keeps calls under the per-minute budget", async () => {
    let t = 0;
    const slept: number[] = [];
    const pace = pacer(2, () => t, async ms => { slept.push(ms); t += ms; });
    await pace(); await pace(); await pace();
    expect(slept).toEqual([60_005]);
  });
});
