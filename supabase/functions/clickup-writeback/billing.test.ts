import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { F as CONVEX_F } from "../../../apps/media-buyer-cockpit/convex/billingCore";
import { F as SYNC_F } from "../billing-sync/billing";
import { BILLING_FIELDS, billingRequest, billingSteps, type BillingStep } from "./billing";
import { buildSteps, executeItem, planItem, type Provider, type QueueItem, type Step } from "./queue";
import { CLIENTS_LIST, refLine } from "./rules";
import { type Deps, runLog } from "./run";

// Cockpit billing edits written back to the Clients - Mahara card (migration
// 20261009j). The item payload is what cockpit_billing_writeback_writes builds;
// the writes must be the ones billingCore.applyEdit made under Convex.

type Call = { provider: string; method: string; path: string; body?: any };
const NOW = Date.parse("2026-10-09T09:00:00Z");
const EDIT_AT = NOW - 5 * 60_000;
const ID = "7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const F = Object.fromEntries(Object.entries(BILLING_FIELDS).map(([k, v]) => [k, v.id])) as Record<string, string>;

const option = (prefix: string, names: string[]) => names.map((name, i) => ({ id: `${prefix}-${i}`, name, orderindex: i }));
const STATUS_OPTIONS = option("st", ["Active", "Paused", "Stopped"]);
const METHOD_OPTIONS = option("pm", ["Card on file", "Bank transfer", "Tap link", "Whop link", "Check"]);
const LIST_FIELDS = [
  { id: F.status, type_config: { options: STATUS_OPTIONS } },
  { id: F.method, type_config: { options: METHOD_OPTIONS } },
  { id: F.plan, type_config: { options: option("pp", ["Monthly"]) } },
  ...[F.nextAmount, F.nextDate, F.pausedOn, F.extension].map(id => ({ id })),
];
const clientFields = async () => LIST_FIELDS;
const boardFields = async () => [];
const ms = (day: string) => Date.parse(`${day}T09:00:00Z`);

/** A card as GET task/{id} returns it: dropdowns as order index, dates as ms strings. */
function card(values: Record<string, unknown>, updatedAt = EDIT_AT - 86_400_000, listId = CLIENTS_LIST) {
  return {
    id: "task_a",
    list: { id: listId },
    date_updated: String(updatedAt),
    custom_fields: LIST_FIELDS.map(f => ({ ...f, ...(f.id in values ? { value: values[f.id] } : {}) })),
  };
}

function fakeProvider(route: (c: Call) => any): Provider & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async call(provider, method, path, body) {
      const c = { provider, method, path, body };
      calls.push(c);
      const r = route(c);
      if (r instanceof Error) throw r;
      return r ?? {};
    },
  };
}
const writes = (calls: Call[]) => calls.filter(c => c.method !== "GET");
const onCard = (c: ReturnType<typeof card>) => (x: Call) => (x.method === "GET" && x.path === "task/task_a" ? c : x.method === "GET" ? new Error("unexpected read") : {});

const item = (payload: Record<string, unknown>, over: Partial<QueueItem> = {}): QueueItem => ({
  id: ID,
  kind: "billing",
  payload: { eventId: 41, taskId: "task_a", clientName: "Acme", source: "csm", by: "sara@tests.invalid", at: EDIT_AT, ...payload },
  attempts: 1,
  created_at: new Date(EDIT_AT).toISOString(),
  source_exists: true,
  ...over,
});
const steps = (i: QueueItem): Step[] => {
  const built = buildSteps(i, [], NOW);
  if (!("steps" in built)) throw new Error(`expected steps, got: ${built.skip}`);
  return built.steps;
};

describe("the billing fields are Convex's", () => {
  it("uses billingCore's field ids, the same ids billing-sync reads", () => {
    for (const [key, f] of Object.entries(BILLING_FIELDS)) {
      expect(f.id).toBe((CONVEX_F as Record<string, string>)[key]);
      expect(f.id).toBe((SYNC_F as Record<string, string>)[key]);
    }
  });

  it("sends each value the way billingCore.setValue and setDropdown did", () => {
    const step = (over: Partial<BillingStep>): BillingStep => ({ key: "k", type: "billing_field", taskId: "task_a", fieldId: F.method, field: "x", format: "dropdown", value: "Tap link", at: EDIT_AT, ...over });
    expect(billingRequest(step({}), LIST_FIELDS)).toEqual({ method: "POST", body: { value: "pm-2" } });
    expect(() => billingRequest(step({ value: "Cash" }), LIST_FIELDS)).toThrow('"Cash" is not an option on that ClickUp field.');
    expect(billingRequest(step({ fieldId: F.nextDate, format: "date", value: "2026-11-01" }), LIST_FIELDS)).toEqual({
      method: "POST",
      body: { value: Date.parse("2026-11-01T09:00:00Z"), value_options: { time: false } },
    });
    expect(billingRequest(step({ fieldId: F.nextAmount, format: "number", value: 1750.5 }), LIST_FIELDS)).toEqual({ method: "POST", body: { value: 1750.5 } });
    expect(billingRequest(step({ fieldId: F.pausedOn, format: "date", value: null }), LIST_FIELDS)).toEqual({ method: "DELETE" });
  });
});

describe("what a billing item writes", () => {
  it("a pause sets the status, then Paused On, in Convex's order", () => {
    const built = steps(item({ kind: "pause", writes: [{ field: "status", value: "Paused", old: "Active" }, { field: "pausedOn", value: "2026-10-09" }] }));
    expect(built).toEqual([
      { key: "status", type: "billing_field", taskId: "task_a", fieldId: F.status, field: "Client Status", format: "dropdown", value: "Paused", old: "Active", at: EDIT_AT },
      { key: "pausedOn", type: "billing_field", taskId: "task_a", fieldId: F.pausedOn, field: "Paused On", format: "date", value: "2026-10-09", at: EDIT_AT },
    ]);
  });

  it("a note is billingCore's comment with the reference line", () => {
    expect(steps(item({ kind: "note", writes: [], note: "Called, all fine" }))).toEqual([
      { key: "comment", type: "comment", taskId: "task_a", text: `Billing note (sara@tests.invalid): Called, all fine\n\n${refLine(ID)}` },
    ]);
  });

  it("a payload ClickUp cannot take, or one that writes nothing, stays in the cockpit", () => {
    expect(billingSteps(item({ writes: [{ field: "nextDate", value: "next week" }] }))).toEqual({ skip: expect.stringContaining("cannot take (nextDate)") });
    expect(billingSteps(item({ writes: [{ field: "mrr", value: 10 }] }))).toEqual({ skip: expect.stringContaining("cannot take (mrr)") });
    expect(billingSteps(item({ writes: [] }))).toEqual({ skip: "This billing change writes nothing on the card." });
    expect(billingSteps(item({ taskId: "../x" }))).toEqual({ skip: expect.stringContaining("no ClickUp card id") });
  });
});

describe("delivery", () => {
  const pause = item({ kind: "pause", writes: [{ field: "status", value: "Paused", old: "Active" }, { field: "pausedOn", value: "2026-10-09" }] });

  it("reads the card once, then writes each field as Convex did", async () => {
    const p = fakeProvider(onCard(card({ [F.status]: 0 })));
    const saved: any[] = [];
    const out = await executeItem(pause, steps(pause), p, async pr => { saved.push(structuredClone(pr)); }, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(p.calls.filter(c => c.method === "GET").map(c => c.path)).toEqual(["task/task_a"]);
    expect(writes(p.calls)).toEqual([
      { provider: "clickup", method: "POST", path: `task/task_a/field/${F.status}`, body: { value: "st-1" } },
      { provider: "clickup", method: "POST", path: `task/task_a/field/${F.pausedOn}`, body: { value: ms("2026-10-09"), value_options: { time: false } } },
    ]);
    // The start is saved before each write, so a crash in between is read back.
    expect(saved[0]).toEqual({ status: { started: true } });
    expect(out.progress.status).toEqual({ done: true, written: true, from: "Active", to: "Paused" });
  });

  it("a resume clears Paused On with a DELETE and sets the next date", async () => {
    const resume = item({ kind: "resume", writes: [{ field: "status", value: "Active", old: "Paused" }, { field: "pausedOn", value: null }, { field: "nextDate", value: "2026-11-08" }] });
    const p = fakeProvider(onCard(card({ [F.status]: 1, [F.pausedOn]: String(ms("2026-10-01")) })));
    expect((await executeItem(resume, steps(resume), p, async () => {}, boardFields, clientFields)).state).toBe("delivered");
    expect(writes(p.calls).map(c => `${c.method} ${c.path.split("/").pop()}`)).toEqual([`POST ${F.status}`, `DELETE ${F.pausedOn}`, `POST ${F.nextDate}`]);
    expect(writes(p.calls)[1].body).toBeUndefined();
  });

  it("a field ClickUp already shows is not written again", async () => {
    const p = fakeProvider(onCard(card({ [F.status]: "st-1", [F.pausedOn]: String(Date.parse("2026-10-09T05:00:00Z")) })));
    const out = await executeItem(pause, steps(pause), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls)).toEqual([]);
    expect(out.progress.pausedOn).toMatchObject({ done: true, unchanged: true, current: "2026-10-09" });
  });

  it("ClickUp stays the record: a value changed there after the edit is left as ClickUp has it", async () => {
    // Someone set the card to Stopped after the cockpit paused it; Paused On was never filled.
    const later = card({ [F.status]: 2 }, EDIT_AT + 60_000);
    const p = fakeProvider(onCard(later));
    const out = await executeItem(pause, steps(pause), p, async () => {}, boardFields, clientFields);
    expect(writes(p.calls)).toEqual([]);
    expect(out.state).toBe("skipped");
    expect(out.error).toContain("ClickUp changed this card after the cockpit edit");
    // The card changed after the edit but still holds what the edit replaced: the edit is written.
    const touched = fakeProvider(onCard(card({ [F.status]: 0 }, EDIT_AT + 60_000)));
    const status = item({ kind: "pause", writes: [{ field: "status", value: "Paused", old: "Active" }] });
    expect((await executeItem(status, steps(status), touched, async () => {}, boardFields, clientFields)).state).toBe("delivered");
    expect(writes(touched.calls).map(c => c.body.value)).toEqual(["st-1"]);
  });

  it("a retry after a partial write does not mistake its own write for a newer ClickUp change", async () => {
    // The first attempt set the status, then the Paused On write timed out.
    const progress = { status: { done: true, written: true, from: "Active", to: "Paused" }, pausedOn: { started: true } };
    const p = fakeProvider(onCard(card({ [F.status]: 1 }, EDIT_AT + 30_000)));
    const out = await executeItem({ ...pause, attempts: 2, progress }, steps(pause), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls).map(c => c.path)).toEqual([`task/task_a/field/${F.pausedOn}`]);
  });

  it("a refused value fails the item; a rate limit waits; a card off the list is never written", async () => {
    const method = item({ kind: "method", writes: [{ field: "method", value: "Bank transfer", old: "Card on file" }] });
    const refused = fakeProvider(c => (c.method === "POST" ? new Error("clickup rejected the request (400): Value is not valid") : onCard(card({ [F.method]: 0 }))(c)));
    expect(await executeItem(method, steps(method), refused, async () => {}, boardFields, clientFields)).toMatchObject({ state: "failed", error: expect.stringContaining("(400)") });
    const limited = fakeProvider(c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : onCard(card({ [F.method]: 0 }))(c)));
    const waited = await executeItem(method, steps(method), limited, async () => {}, boardFields, clientFields);
    expect(waited.state).toBe("retry");
    expect(waited.progress.method).toBeUndefined();
    const elsewhere = fakeProvider(onCard(card({ [F.method]: 0 }, EDIT_AT - 1, "999")));
    expect(await executeItem(method, steps(method), elsewhere, async () => {}, boardFields, clientFields)).toMatchObject({ state: "failed", error: "That card is not on the Clients - Mahara list." });
    expect(writes(elsewhere.calls)).toEqual([]);
    const noOption = item({ kind: "method", writes: [{ field: "method", value: "Whop link" }] });
    const fewer = [{ id: F.method, type_config: { options: METHOD_OPTIONS.slice(0, 2) } }];
    const missing = fakeProvider(onCard(card({ [F.method]: 0 })));
    expect(await executeItem(noOption, steps(noOption), missing, async () => {}, boardFields, async () => fewer)).toMatchObject({ state: "failed", error: '"Whop link" is not an option on that ClickUp field.' });
    expect(writes(missing.calls)).toEqual([]);
  });

  it("the dry-run plan reads only and records ClickUp's value now and the new one", async () => {
    const p = fakeProvider(onCard(card({ [F.status]: 0 })));
    const planned = await planItem(pause, steps(pause), p, boardFields, clientFields);
    expect(writes(p.calls)).toEqual([]);
    expect(planned).toEqual([
      { queueId: ID, kind: "billing", taskId: "task_a", field: "Client Status", fieldId: F.status, old: "Active", new: "Paused" },
      { queueId: ID, kind: "billing", taskId: "task_a", field: "Paused On", fieldId: F.pausedOn, old: null, new: "2026-10-09" },
    ]);
    const stale = await planItem(pause, steps(pause), fakeProvider(onCard(card({ [F.status]: 2 }, EDIT_AT + 1))), boardFields, clientFields);
    expect(stale[0]).toMatchObject({ old: "Stopped", new: "Paused", note: "ClickUp changed this card after the cockpit edit, so ClickUp's value stays." });
  });
});

describe("the log job runs billing items behind the same switch", () => {
  const extension = item({ kind: "extension", writes: [{ field: "extension", value: 2 }, { field: "nextDate", value: "2026-11-02", old: "2026-10-19" }] });

  function harness(env: Record<string, string>) {
    const rpcs: { name: string; params: any }[] = [];
    const calls: (Call & { actionId: string })[] = [];
    let items: QueueItem[] = [structuredClone(extension)];
    const deps: Deps = {
      env: k => env[k],
      now: () => NOW,
      uuid: () => "11111111-2222-3333-4444-555555555555",
      rpc: async (name, params = {}) => {
        rpcs.push({ name, params: structuredClone(params) });
        if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
        if (name === "cockpit_clickup_writeback_inputs") return { campaigns: [] };
        if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
        return null;
      },
      providerFor: actionId => ({
        async call(provider, method, path, body) {
          calls.push({ actionId, provider, method, path, body });
          if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: LIST_FIELDS };
          if (method === "GET" && path === "task/task_a") return card({ [F.nextDate]: String(ms("2026-10-19")) });
          return {};
        },
      }),
    };
    const saves = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_save").map(r => r.params.p_patch);
    return { deps, calls, saves, writes: () => calls.filter(c => c.method !== "GET") };
  }

  it("a dry run holds the item as dry_run with the planned old and new values", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.note).toContain("Nothing was written to ClickUp");
    const [saved] = h.saves();
    expect(saved).toMatchObject({ state: "dry_run", task_id: "task_a" });
    expect(saved.planned.map((p: any) => [p.field, p.old, p.new])).toEqual([["Extension (weeks)", null, 2], ["Next Payment Date", "2026-10-19", "2026-11-02"]]);
  });

  it("a live run limited to other cards leaves it a dry run", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "task_z" });
    await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(h.saves()[0].state).toBe("dry_run");
  });

  it("live: freezes the writes, writes the card and records delivery, every call under the item", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "task_a" });
    const out = await runLog(h.deps);
    expect(out.counts).toMatchObject({ delivered: 1, failed: 0 });
    expect(h.writes().map(c => [c.path.split("/").pop(), c.body])).toEqual([
      [F.extension, { value: 2 }],
      [F.nextDate, { value: ms("2026-11-02"), value_options: { time: false } }],
    ]);
    const saved = h.saves();
    expect(Object.keys(saved[0])).toEqual(["steps", "task_id"]);
    expect(saved.at(-1)).toMatchObject({ state: "delivered", error: null });
    // The list's options are read once for the run; the card and the writes are receipted under the item.
    expect(h.calls.filter(c => c.path === `list/${CLIENTS_LIST}/field`).map(c => c.actionId)).toEqual(["run-1"]);
    expect(h.calls.filter(c => c.path.startsWith("task/")).every(c => c.actionId === ID)).toBe(true);
  });
});

describe("migration 20261009j", () => {
  const SQL = readFileSync(new URL("../../migrations/20261009j_billing_clickup_writeback.sql", import.meta.url), "utf8");

  it("adds the billing kind idempotently and leaves cockpit_billing_write's body alone", () => {
    expect(SQL).toContain("DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check");
    expect(SQL).toContain("CHECK(kind IN('decision','manual_change','provider_action','tracking_backlog','billing'))");
    expect(SQL).toContain("DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;");
    expect(SQL).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.cockpit_billing_write\(/);
    expect(SQL).not.toMatch(/CREATE TABLE/);
  });

  it("queues only cockpit edits, never fails silently, and grants nothing to the browser", () => {
    expect(SQL).toContain("WHEN (NEW.source IN('ceo','csm')");
    expect(SQL).not.toMatch(/EXCEPTION WHEN/);
    expect(/GRANT [^;]* TO (anon|authenticated)/.test(SQL)).toBe(false);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*cockpit_billing_writeback_writes[\s\S]*cockpit_billing_writeback_enqueue\(\)\s*FROM PUBLIC,anon,authenticated,service_role;/);
  });
});
