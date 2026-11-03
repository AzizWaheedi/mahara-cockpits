import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { F as CONVEX_F } from "../../../apps/media-buyer-cockpit/convex/billingCore";
import { METHODS as SHEET_METHODS, PLANS as SHEET_PLANS } from "../../../apps/media-buyer-cockpit/src/lib/billingCore";
import { CFB as SYNC_CFB, F as SYNC_F } from "../billing-sync/billing";
import {
  BILLING_FIELDS,
  billingDoctorChecks,
  billingRequest,
  billingSteps,
  type BillingStep,
  cardValue,
  CHURN_TYPE_OPTIONS,
  churnReasonCard,
  CONVEX_BILLING_KEYS,
  REGISTER_REASONS,
  WILL_NOT_CONTINUE_MISSING,
} from "./billing";
import { buildSteps, executeItem, planItem, type Provider, type QueueItem, type Step } from "./queue";
import { CLIENTS_LIST, refLine } from "./rules";
import { type Deps, runLog } from "./run";

// Cockpit billing edits written back to the Clients - Mahara card (migrations
// 20261009j and 20261101m). The item payload is what cockpit_billing_writeback_writes
// builds; the first seven fields' writes must be the ones billingCore.applyEdit made
// under Convex, and every field of waves 1-2 (contract 3.3) is read back from a
// stubbed card before it is written.

type Call = { provider: string; method: string; path: string; body?: any };
const NOW = Date.parse("2026-10-09T09:00:00Z");
const EDIT_AT = NOW - 5 * 60_000;
const ID = "7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";
const F = Object.fromEntries(Object.entries(BILLING_FIELDS).map(([k, v]) => [k, v.id])) as Record<string, string>;

const option = (prefix: string, names: readonly string[]) => names.map((name, i) => ({ id: `${prefix}-${i}`, name, orderindex: i }));
const STATUS_OPTIONS = option("st", ["Active", "Paused", "Stopped", "Onboarding Booked"]);
const METHOD_OPTIONS = option("pm", ["Card on file", "Bank transfer", "Tap link", "Whop link", "Check"]);
const REASON_NAMES = ["Cancelled", "Refund", "Chargeback", "Non-payment 14+ days", "Paused past 14 days", "Ghosted", "Completed term, did not renew"];
const REASON_OPTIONS = option("cr", REASON_NAMES);
const TYPE_OPTIONS = option("ct", CHURN_TYPE_OPTIONS);
/** The checkbox's full id is only known from the list's own read (W7). */
const CHECKBOX = "9cfdb353-aaaa-4bbb-8ccc-dddddddddddd";
const LIST_FIELDS: any[] = [
  { id: F.status, type: "drop_down", type_config: { options: STATUS_OPTIONS } },
  { id: F.method, type: "drop_down", type_config: { options: METHOD_OPTIONS } },
  { id: F.plan, type: "drop_down", type_config: { options: option("pp", ["Monthly"]) } },
  { id: F.churnReason, type: "drop_down", type_config: { options: REASON_OPTIONS } },
  { id: F.churnType, type: "drop_down", type_config: { options: TYPE_OPTIONS } },
  ...[F.nextDate, F.pausedOn, F.resumeOn, F.churnDate, F.npsSent].map(id => ({ id, type: "date" })),
  ...[F.nextAmount, F.extension].map(id => ({ id, type: "number" })),
  ...[F.mrr, F.ltv].map(id => ({ id, type: "currency" })),
  { id: CHECKBOX, type: "checkbox" },
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
    for (const key of CONVEX_BILLING_KEYS) expect(BILLING_FIELDS[key].id).toBe((CONVEX_F as Record<string, string>)[key]);
    // Every id billing-sync also names under the same key is the same id (its F, or its daily snapshot's CFB).
    const synced = { ...SYNC_CFB, ...SYNC_F } as Record<string, string>;
    const shared = Object.keys(BILLING_FIELDS).filter(k => k in synced);
    expect(shared.sort()).toEqual(["churnDate", "churnReason", "churnType", "extension", "ltv", "method", "mrr", "nextAmount", "nextDate", "pausedOn", "plan", "status"]);
    for (const key of shared) expect([key, BILLING_FIELDS[key].id]).toEqual([key, synced[key]]);
  });

  it("holds the fields of contract 3.3 with their formats, the checkbox by its prefix", () => {
    expect(Object.fromEntries(Object.entries(BILLING_FIELDS).map(([k, f]) => [k, [f.id.slice(0, 8), f.format]]))).toEqual({
      status: ["9368ca9e", "dropdown"], method: ["665e5754", "dropdown"], plan: ["17d17129", "dropdown"], nextAmount: ["f071ee8f", "number"],
      nextDate: ["669ae046", "date"], pausedOn: ["930c49eb", "date"], extension: ["8cb9d308", "number"], resumeOn: ["d3c46259", "date"],
      churnDate: ["42429a6e", "date"], churnReason: ["796f25e7", "dropdown"], churnType: ["a121f39a", "dropdown"], mrr: ["48eb6023", "number"],
      ltv: ["11d70e58", "number"], willNotContinue: ["9cfdb353", "checkbox"], npsSent: ["34b2d7c0", "date"],
    });
    // NPS Survey Sent (waves 3-4, contract 3.8): the full id read from the stored field map (11.2-f).
    expect(BILLING_FIELDS.npsSent).toEqual({ id: "34b2d7c0-6a95-4382-8c5b-5dcb83a9ac53", name: "NPS Survey Sent", format: "date" });
    expect(BILLING_FIELDS.extension.name).toBe("Current extension (weeks)");
    expect(BILLING_FIELDS.willNotContinue).toMatchObject({ id: "9cfdb353", byPrefix: true });
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
    expect(billingRequest(step({ fieldId: CHECKBOX, format: "checkbox", value: "true" }), LIST_FIELDS)).toEqual({ method: "POST", body: { value: true } });
    expect(billingRequest(step({ fieldId: CHECKBOX, format: "checkbox", value: "false" }), LIST_FIELDS)).toEqual({ method: "POST", body: { value: false } });
    expect(billingRequest(step({ fieldId: F.mrr, format: "number", value: 2000 }), LIST_FIELDS)).toEqual({ method: "POST", body: { value: 2000 } });
  });

  it("reads a checkbox as ticked only on true; anything else set is not ticked; nothing set is unknown", () => {
    const on = (value: unknown) => cardValue({ custom_fields: [{ id: CHECKBOX, value }] }, CHECKBOX, "checkbox", LIST_FIELDS);
    expect([on(true), on("true"), on(false), on("false"), on(0), on(undefined), on(null), on("")]).toEqual(["true", "true", "false", "false", "false", null, null, null]);
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
    expect(billingSteps(item({ writes: [{ field: "mrrUsd", value: 10 }] }))).toEqual({ skip: expect.stringContaining("cannot take (mrrUsd)") });
    expect(billingSteps(item({ writes: [{ field: "mrr", value: "lots" }] }))).toEqual({ skip: expect.stringContaining("cannot take (mrr)") });
    expect(billingSteps(item({ writes: [{ field: "willNotContinue", value: "yes" }] }))).toEqual({ skip: expect.stringContaining("cannot take (willNotContinue)") });
    expect(billingSteps(item({ writes: [{ field: "churnDate", value: true }] }))).toEqual({ skip: expect.stringContaining("cannot take (churnDate)") });
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

describe("the log job runs billing items behind their own switch (waves 1-2 W2)", () => {
  const extension = item({ kind: "extension", writes: [{ field: "extension", value: 2 }, { field: "nextDate", value: "2026-11-02", old: "2026-10-19" }] });
  const churn = item(
    { kind: "churn", taskId: "task_a", writes: [{ field: "churnDate", value: "2026-10-30" }, { field: "status", value: "Stopped", old: "Active" }], comment: "CHURN CONFIRMED: left 2026-10-30\nBy: the CSM" },
    { id: "2a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9" },
  );

  function harness(env: Record<string, string>, queued: QueueItem[] = [extension]) {
    const rpcs: { name: string; params: any }[] = [];
    const calls: (Call & { actionId: string })[] = [];
    const states: { key: string; row: any }[] = [];
    let items: QueueItem[] = structuredClone(queued);
    const deps: Deps = {
      env: k => env[k],
      now: () => NOW,
      uuid: () => "11111111-2222-3333-4444-555555555555",
      rpc: async (name, params = {}) => {
        rpcs.push({ name, params: structuredClone(params) });
        if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
        if (name === "cockpit_clickup_writeback_inputs") return { campaigns: [] };
        if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
        if (name === "cockpit_billing_writeback_held") return { held: 4, heldOpenKind: params.p_kinds.includes("extension") ? 2 : 0, byKind: { extension: 2, date: 1, pause: 1 } };
        return null;
      },
      providerFor: actionId => ({
        async call(provider, method, path, body) {
          calls.push({ actionId, provider, method, path, body });
          if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: LIST_FIELDS };
          if (method === "GET" && path === "task/task_a") return card({ [F.nextDate]: String(ms("2026-10-19")), [F.status]: 0 });
          if (method === "POST" && path.endsWith("/comment")) return { id: "c-9" };
          return {};
        },
      }),
      syncState: async (key, row) => { states.push({ key, row: structuredClone(row) }); },
    };
    const saves = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_save").map(r => r.params.p_patch);
    const billingState = () => states.filter(s => s.key === "clickup-writeback:billing").at(-1)?.row;
    return { deps, calls, saves, rpcs, billingState, writes: () => calls.filter(c => c.method !== "GET") };
  }

  it("a dry run holds the item as dry_run with the planned old and new values, and reports the switch", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const out = await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(out.note).toContain("Nothing was written to ClickUp");
    expect(out.note).toContain("Billing: dry_run (no kinds): 0 delivered, 1 held, 0 failed.");
    const [saved] = h.saves();
    expect(saved).toMatchObject({ state: "dry_run", task_id: "task_a" });
    expect(saved.planned.map((p: any) => [p.field, p.old, p.new])).toEqual([["Current extension (weeks)", null, 2], ["Next Payment Date", "2026-10-19", "2026-11-02"]]);
    expect(h.billingState()).toMatchObject({ ok: true, detail: { mode: "dry_run", kinds: [], onlyCards: [], claimed: 1, delivered: 0, held: 1, failed: 0, heldOpenKind: 0, heldTotal: 4 } });
  });

  it("CLICKUP_WRITEBACK_APPLY alone leaves a billing item dry_run, even on its own card", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: "task_a" });
    await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(h.saves()[0].state).toBe("dry_run");
  });

  it("APPLY_BILLING with KINDS=churn delivers a churn item and holds an extension item", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "churn" }, [churn, extension]);
    const out = await runLog(h.deps);
    expect(out.counts).toMatchObject({ delivered: 1, dryRun: 1, billing: { claimed: 2, delivered: 1, held: 1, failed: 0 } });
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params.p_mode).toBe("apply_limited");
    // Churn Date goes before Client Status, then the event's comment with the reference line.
    expect(h.writes().map(c => [c.method, c.path.split("/").pop(), c.body])).toEqual([
      ["POST", F.churnDate, { value: ms("2026-10-30"), value_options: { time: false } }],
      ["POST", F.status, { value: "st-2" }],
      ["POST", "comment", { comment_text: `CHURN CONFIRMED: left 2026-10-30\nBy: the CSM\n\n${refLine(churn.id)}`, notify_all: false }],
    ]);
    const states = h.saves().filter(s => s.state).map(s => s.state);
    expect(states).toEqual(["delivered", "dry_run"]);
    expect(out.note).toContain("Only billing edits of the open kinds are written.");
    expect(out.note).toContain("Billing: apply (churn): 1 delivered, 1 held, 0 failed.");
    expect(h.billingState()?.detail).toMatchObject({ mode: "apply", kinds: ["churn"], delivered: 1, held: 1 });
  });

  it("BILLING_ONLY_CARDS holds a churn item on another card", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "churn", CLICKUP_WRITEBACK_BILLING_ONLY_CARDS: "86eywg1cq" }, [churn]);
    await runLog(h.deps);
    expect(h.writes()).toEqual([]);
    expect(h.saves()[0].state).toBe("dry_run");
    expect(h.billingState()?.detail).toMatchObject({ mode: "apply_limited", kinds: ["churn"], onlyCards: ["86eywg1cq"] });
  });

  it("live: freezes the writes, writes the card and records delivery, every call under the item", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "extension,date", CLICKUP_WRITEBACK_BILLING_ONLY_CARDS: "task_a" });
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
    // Held edits of a kind now open are counted for the review (W20).
    expect(h.rpcs.find(r => r.name === "cockpit_billing_writeback_held")?.params).toEqual({ p_kinds: ["date", "extension"] });
    expect(h.billingState()?.detail).toMatchObject({ heldOpenKind: 2 });
    expect(h.billingState()?.note).toContain("2 held edits of an open kind wait for the review: release or close each one.");
  });

  it("an empty queue still reports the switch, and a missing count is said, never zero", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "churn" }, []);
    h.deps.rpc = (orig => async (name: string, params?: any) => {
      if (name === "cockpit_billing_writeback_held") throw new Error("function does not exist");
      return orig(name, params);
    })(h.deps.rpc);
    const out = await runLog(h.deps);
    expect(out.note).toBe("The ClickUp log queue is empty.");
    expect(h.billingState()).toMatchObject({ ok: true, detail: { mode: "apply", kinds: ["churn"], claimed: 0, heldOpenKind: null } });
    expect(h.billingState()?.note).toContain("The held count could not be read.");
  });
});

describe("waves 1-2 fields: written in their format, read back first (contract 3.3)", () => {
  type Case = { field: string; value: unknown; card: unknown; body: unknown; same: unknown };
  const CASES: Case[] = [
    { field: "resumeOn", value: "2026-11-10", card: String(ms("2026-11-01")), body: { value: ms("2026-11-10"), value_options: { time: false } }, same: String(Date.parse("2026-11-10T05:00:00Z")) },
    { field: "churnDate", value: "2026-10-30", card: undefined, body: { value: ms("2026-10-30"), value_options: { time: false } }, same: String(ms("2026-10-30")) },
    { field: "churnReason", value: "Completed term, did not renew", card: 0, body: { value: "cr-6" }, same: "cr-6" },
    { field: "churnType", value: "Mid-programme loss (counts as churn)", card: 1, body: { value: "ct-0" }, same: 0 },
    { field: "mrr", value: 2000, card: "1500", body: { value: 2000 }, same: "2000.00" },
    { field: "ltv", value: 12500.5, card: undefined, body: { value: 12500.5 }, same: 12500.5 },
    { field: "willNotContinue", value: true, card: false, body: { value: true }, same: "true" },
    { field: "willNotContinue", value: false, card: "true", body: { value: false }, same: "false" },
  ];
  const fieldId = (key: string) => (key === "willNotContinue" ? CHECKBOX : F[key]);

  for (const c of CASES)
    it(`${c.field} = ${JSON.stringify(c.value)}: written when the card differs, left when it already shows it`, async () => {
      const one = item({ kind: "churn", writes: [{ field: c.field, value: c.value }] });
      const differs = fakeProvider(onCard(card(c.card === undefined ? {} : { [fieldId(c.field)]: c.card })));
      const out = await executeItem(one, steps(one), differs, async () => {}, boardFields, clientFields);
      expect(out.state).toBe("delivered");
      expect(writes(differs.calls)).toEqual([{ provider: "clickup", method: "POST", path: `task/task_a/field/${fieldId(c.field)}`, body: c.body }]);
      const shows = fakeProvider(onCard(card({ [fieldId(c.field)]: c.same })));
      const again = await executeItem(one, steps(one), shows, async () => {}, boardFields, clientFields);
      expect(writes(shows.calls)).toEqual([]);
      expect(again.progress[c.field]).toMatchObject({ done: true, unchanged: true });
    });

  it("a resume clears Paused On and Resume On with two DELETEs", async () => {
    const resume = item({ kind: "resume", writes: [{ field: "status", value: "Active", old: "Paused" }, { field: "pausedOn", value: null }, { field: "resumeOn", value: null }] });
    const p = fakeProvider(onCard(card({ [F.status]: 1, [F.pausedOn]: String(ms("2026-10-01")), [F.resumeOn]: String(ms("2026-11-01")) })));
    expect((await executeItem(resume, steps(resume), p, async () => {}, boardFields, clientFields)).state).toBe("delivered");
    expect(writes(p.calls).map(c => `${c.method} ${c.path.split("/").pop()}`)).toEqual([`POST ${F.status}`, `DELETE ${F.pausedOn}`, `DELETE ${F.resumeOn}`]);
  });

  it("the checkbox id comes from the list's read; a missing, doubled or wrong-typed field skips only that step", async () => {
    const ext = item({ kind: "extension", writes: [{ field: "extension", value: 2 }, { field: "willNotContinue", value: true }], comment: "CLIENT EXTENSION: 2 weeks" });
    const built = steps(ext);
    expect(built[1]).toMatchObject({ key: "willNotContinue", fieldId: "9cfdb353", byPrefix: true, format: "checkbox", value: "true" });
    for (const fields of [
      LIST_FIELDS.filter(f => f.id !== CHECKBOX),
      [...LIST_FIELDS, { id: "9cfdb353-0000-4000-8000-000000000000", type: "checkbox" }],
      LIST_FIELDS.map(f => (f.id === CHECKBOX ? { ...f, type: "drop_down" } : f)),
    ]) {
      const p = fakeProvider(onCard(card({})));
      const out = await executeItem(ext, built, p, async () => {}, boardFields, async () => fields);
      expect(out.state).toBe("delivered");
      expect(out.progress.willNotContinue).toEqual({ done: true, missing: true, note: WILL_NOT_CONTINUE_MISSING });
      expect(writes(p.calls).map(c => c.path.split("/").pop())).toEqual([F.extension, "comment"]);
    }
    const planned = await planItem(ext, built, fakeProvider(onCard(card({}))), boardFields, async () => LIST_FIELDS.filter(f => f.id !== CHECKBOX));
    expect(planned[1]).toMatchObject({ field: "Will not continue if billed on schedule", note: WILL_NOT_CONTINUE_MISSING });
  });

  it("a churn reason the list lacks skips only that step, with the sentence; the rest is written", async () => {
    const one = item({ kind: "churn", writes: [{ field: "churnDate", value: "2026-10-30" }, { field: "status", value: "Stopped", old: "Active" }, { field: "churnReason", value: "Ghosted" }] });
    const fewer = LIST_FIELDS.map(f => (f.id === F.churnReason ? { ...f, type_config: { options: REASON_OPTIONS.filter(o => o.name !== "Ghosted") } } : f));
    const p = fakeProvider(onCard(card({ [F.status]: 0 })));
    const out = await executeItem(one, steps(one), p, async () => {}, boardFields, async () => fewer);
    expect(out.state).toBe("delivered");
    expect(out.progress.churnReason).toMatchObject({ done: true, missing: true, note: '"Ghosted" is not an option on Churn Reason, so the field is left empty.' });
    expect(writes(p.calls).map(c => c.path.split("/").pop())).toEqual([F.churnDate, F.status]);
    const planned = await planItem(one, steps(one), fakeProvider(onCard(card({ [F.status]: 0 }))), boardFields, async () => fewer);
    expect(planned[2].note).toBe('"Ghosted" is not an option on Churn Reason, so the field is left empty.');
    // Any other field's missing option still fails the item, as before.
    const typed = item({ kind: "churn", writes: [{ field: "churnType", value: "Lost" }] });
    expect(await executeItem(typed, steps(typed), fakeProvider(onCard(card({}))), async () => {}, boardFields, clientFields)).toMatchObject({ state: "failed" });
  });

  it("the event's comment is posted after the fields, and not when ClickUp kept every field", async () => {
    const one = item({ kind: "churn", writes: [{ field: "status", value: "Stopped", old: "Active" }], comment: "CHURN CONFIRMED: left 2026-10-30\nBy: the CSM" });
    expect(steps(one).map(s => s.key)).toEqual(["status", "billing_comment"]);
    expect((steps(one)[1] as any).text).toBe(`CHURN CONFIRMED: left 2026-10-30\nBy: the CSM\n\n${refLine(ID)}`);
    // Someone set the card to Paused after the edit: the status stays, so the comment would be untrue.
    const p = fakeProvider(onCard(card({ [F.status]: 1 }, EDIT_AT + 60_000)));
    const out = await executeItem(one, steps(one), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("skipped");
    expect(writes(p.calls)).toEqual([]);
    expect(out.progress.billing_comment).toMatchObject({ done: true, skipped: true });
  });
});

describe("waves 3-4 kinds: nps_sent writes NPS Survey Sent, survey only comments (contract 3.8)", () => {
  // The payloads 20261102b's trigger queues (client-lifecycle-supabase.test.ts asserts the same writes and comment).
  const npsSent = item({ kind: "nps_sent", source: "system", by: "the cockpit", writes: [{ field: "npsSent", value: "2026-11-03" }], comment: null });
  const SURVEY_COMMENT = [
    "CONTRACT TERMINATION SURVEY (notice received 2026-11-01)",
    "Why: The results, A cheaper provider",
    "Ads 6/10 · The people who reached them 4/10 · Communication 9/10",
    "Would recommend: 5/10",
    "What would have kept them: More calls in the first month.",
    "Comments: none",
    "Filled: by link",
    "Confirm the churn or answer the notice in the cockpit.",
  ].join("\n");
  const survey = item({ kind: "survey", source: "system", by: "the cockpit", writes: [], comment: SURVEY_COMMENT });

  it("nps_sent is one date write on NPS Survey Sent, written when the card differs and read back first", async () => {
    expect(steps(npsSent)).toEqual([
      { key: "npsSent", type: "billing_field", taskId: "task_a", fieldId: F.npsSent, field: "NPS Survey Sent", format: "date", value: "2026-11-03", at: EDIT_AT },
    ]);
    const empty = fakeProvider(onCard(card({})));
    const out = await executeItem(npsSent, steps(npsSent), empty, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(empty.calls.filter(c => c.method === "GET").map(c => c.path)).toEqual(["task/task_a"]);
    expect(writes(empty.calls)).toEqual([
      { provider: "clickup", method: "POST", path: `task/task_a/field/${F.npsSent}`, body: { value: ms("2026-11-03"), value_options: { time: false } } },
    ]);
    // The card already shows the day: nothing is written again.
    const shows = fakeProvider(onCard(card({ [F.npsSent]: String(ms("2026-11-03")) })));
    const again = await executeItem(npsSent, steps(npsSent), shows, async () => {}, boardFields, clientFields);
    expect(writes(shows.calls)).toEqual([]);
    expect(again.progress.npsSent).toMatchObject({ done: true, unchanged: true });
    // A later NPS round moves the day forward.
    const older = fakeProvider(onCard(card({ [F.npsSent]: String(ms("2026-08-05")) })));
    expect((await executeItem(npsSent, steps(npsSent), older, async () => {}, boardFields, clientFields)).state).toBe("delivered");
    expect(writes(older.calls).map(c => c.path.split("/").pop())).toEqual([F.npsSent]);
  });

  it("a survey item writes no field and posts its comment as written, with the reference line", async () => {
    expect(steps(survey)).toEqual([{ key: "billing_comment", type: "comment", taskId: "task_a", text: `${SURVEY_COMMENT}\n\n${refLine(ID)}` }]);
    const p = fakeProvider(onCard(card({})));
    const out = await executeItem(survey, steps(survey), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls)).toEqual([
      { provider: "clickup", method: "POST", path: "task/task_a/comment", body: { comment_text: `${SURVEY_COMMENT}\n\n${refLine(ID)}`, notify_all: false } },
    ]);
    expect(writes(p.calls).some(c => c.path.includes("/field/"))).toBe(false);
    expect(SURVEY_COMMENT).not.toContain("@");
  });

  it("each kind waits behind CLICKUP_WRITEBACK_BILLING_KINDS: held while unlisted, written once listed, on the test card first", async () => {
    const runWith = async (env: Record<string, string>, queued: QueueItem[]) => {
      let items = structuredClone(queued);
      const saves: any[] = [];
      const calls: Call[] = [];
      const deps: Deps = {
        env: k => env[k],
        now: () => NOW,
        uuid: () => "11111111-2222-3333-4444-555555555555",
        rpc: async (name, params = {}) => {
          if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
          if (name === "cockpit_clickup_writeback_inputs") return { campaigns: [] };
          if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
          if (name === "cockpit_billing_writeback_held") return { held: 0, heldOpenKind: 0, byKind: {} };
          if (name === "cockpit_clickup_writeback_save") saves.push(structuredClone(params.p_patch));
          return null;
        },
        providerFor: () => ({
          async call(provider, method, path, body) {
            calls.push({ provider, method, path, body });
            if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: LIST_FIELDS };
            if (method === "GET" && path === "task/task_a") return card({});
            if (method === "POST" && path.endsWith("/comment")) return { id: "c-1" };
            return {};
          },
        }),
        syncState: async () => {},
      };
      await runLog(deps);
      return { states: saves.filter(s => s.state).map(s => s.state), writes: calls.filter(c => c.method !== "GET") };
    };
    const npsItem = { ...npsSent, id: "3a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9" };
    // W12's kinds open (D-B0 deploys this file with the kinds as they are): both new kinds are held.
    const w12 = { CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "churn,extension,date,payment,pause,resume,mrr,late" };
    const held = await runWith(w12, [survey, npsItem]);
    expect(held.states).toEqual(["dry_run", "dry_run"]);
    expect(held.writes).toEqual([]);
    // D-C4B: survey on the test card only; the item on another card waits.
    const canary = await runWith({ ...w12, CLICKUP_WRITEBACK_BILLING_KINDS: `${w12.CLICKUP_WRITEBACK_BILLING_KINDS},survey`, CLICKUP_WRITEBACK_BILLING_ONLY_CARDS: "86eywg1cq" }, [survey]);
    expect(canary.states).toEqual(["dry_run"]);
    // Then open: the survey comment is written, nps_sent still waits for D-C5.
    const open = await runWith({ ...w12, CLICKUP_WRITEBACK_BILLING_KINDS: `${w12.CLICKUP_WRITEBACK_BILLING_KINDS},survey` }, [survey, npsItem]);
    expect(open.states).toEqual(["delivered", "dry_run"]);
    expect(open.writes.map(c => c.path.split("/").pop())).toEqual(["comment"]);
    const both = await runWith({ ...w12, CLICKUP_WRITEBACK_BILLING_KINDS: `${w12.CLICKUP_WRITEBACK_BILLING_KINDS},survey,nps_sent` }, [npsItem]);
    expect(both.states).toEqual(["delivered"]);
    expect(both.writes.map(c => c.path.split("/").pop())).toEqual([F.npsSent]);
  });
});

describe("the billing doctor's checks (job billing_doctor)", () => {
  it("passes a list with every field and option the writes need, and lists the Churn Reason options", () => {
    const out = billingDoctorChecks(LIST_FIELDS);
    expect(out.gaps).toEqual([]);
    expect(out.churnReasonOptions).toEqual(REASON_NAMES);
    expect(out.reasonMap).toEqual(Object.fromEntries(REGISTER_REASONS.filter(r => r !== "Other").map(r => [r, r])));
    expect(out.willNotContinue).toBe(CHECKBOX);
  });

  it("names each gap in one sentence and never stops on a missing reason", () => {
    const out = billingDoctorChecks([
      ...LIST_FIELDS.filter(f => ![F.resumeOn, CHECKBOX].includes(f.id)).map(f =>
        f.id === F.status ? { ...f, type_config: { options: option("st", ["Active", "Stopped"]) } }
        : f.id === F.churnReason ? { ...f, type_config: { options: option("cr", ["Cancelled", "Refund"]) } }
        : f.id === F.mrr ? { ...f, type: "short_text" }
        : f),
      { id: "9cfdb353-1", type: "checkbox" },
      { id: "9cfdb353-2", type: "checkbox" },
    ]);
    expect(out.gaps).toEqual([
      "Resume On (d3c46259) is not on Clients - Mahara, so resumeOn edits cannot be written.",
      "MRR (48eb6023) is a short_text field, not a number or currency field.",
      'Client Status has no "Paused" option.',
      'Churn Reason has no option for "Chargeback", "Non-payment 14+ days", "Paused past 14 days", "Ghosted", "Completed term, did not renew", so a churn with those reasons leaves the field empty.',
      "2 fields on Clients - Mahara start with 9cfdb353, so the will-not-continue checkbox is not written until one is left.",
    ]);
    expect(billingDoctorChecks(LIST_FIELDS.filter(f => f.id !== CHECKBOX)).gaps).toEqual([WILL_NOT_CONTINUE_MISSING]);
  });

  it("maps Completed term to the card's option and never writes Other", () => {
    expect(churnReasonCard("Completed term", REASON_NAMES)).toBe("Completed term, did not renew");
    expect(churnReasonCard("Other", [...REASON_NAMES, "Other"])).toBeNull();
    expect(churnReasonCard("ghosted", REASON_NAMES)).toBe("Ghosted");
    expect(churnReasonCard("Ghosted", [])).toBeNull();
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

describe("waves 5-6 kinds: win only comments, reactivate reopens the card (contract 3.5)", () => {
  // The payloads 20261102g's trigger queues (money-rails-w5-supabase.test.ts asserts the same writes and comments).
  const WIN_COMMENT = "WIN: Google review on 2026-11-01\nStage: Logged\nProof: https://g.page/r/review-link\nBy: the CSM";
  const win = item({ kind: "win", writes: [], comment: WIN_COMMENT });
  const REACTIVATE_COMMENT = [
    "REACTIVATED 2026-11-02",
    "Back as: Onboarding Booked",
    "Churned 2026-10-12: Non-payment 14+ days (Mid-programme loss (counts as churn))",
    "Why they came back: They paid the overdue invoice and asked to restart.",
    "By: the CEO",
  ].join("\n");
  const reactivate = item({
    kind: "reactivate",
    source: "ceo",
    writes: [
      { field: "status", value: "Onboarding Booked", old: "Stopped" },
      { field: "churnDate", value: null },
      { field: "churnReason", value: null },
      { field: "churnType", value: null },
      { field: "pausedOn", value: null },
      { field: "resumeOn", value: null },
      { field: "nextDate", value: "2026-11-20" },
    ],
    comment: REACTIVATE_COMMENT,
  });
  const stopped = () =>
    card({
      [F.status]: 2,
      [F.churnDate]: String(ms("2026-10-12")),
      [F.churnReason]: 3,
      [F.churnType]: 0,
      [F.pausedOn]: String(ms("2026-09-20")),
      [F.resumeOn]: String(ms("2026-10-01")),
      [F.nextDate]: String(ms("2026-10-05")),
    });

  it("a win writes no field and posts its comment as written, with the reference line", async () => {
    expect(steps(win)).toEqual([{ key: "billing_comment", type: "comment", taskId: "task_a", text: `${WIN_COMMENT}\n\n${refLine(ID)}` }]);
    const p = fakeProvider(onCard(card({})));
    const out = await executeItem(win, steps(win), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls)).toEqual([
      { provider: "clickup", method: "POST", path: "task/task_a/comment", body: { comment_text: `${WIN_COMMENT}\n\n${refLine(ID)}`, notify_all: false } },
    ]);
    expect(WIN_COMMENT).not.toContain("@");
  });

  it("reactivate writes Client Status by its option id, clears the five fields, then the date, then comments", async () => {
    const built = steps(reactivate);
    expect(built.map(s => s.key)).toEqual(["status", "churnDate", "churnReason", "churnType", "pausedOn", "resumeOn", "nextDate", "billing_comment"]);
    expect(built.slice(1, 6).every(s => (s as BillingStep).value === null)).toBe(true);
    const p = fakeProvider(onCard(stopped()));
    const out = await executeItem(reactivate, built, p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls).map(c => `${c.method} ${c.path.split("/").pop()}`)).toEqual([
      `POST ${F.status}`, `DELETE ${F.churnDate}`, `DELETE ${F.churnReason}`, `DELETE ${F.churnType}`,
      `DELETE ${F.pausedOn}`, `DELETE ${F.resumeOn}`, `POST ${F.nextDate}`, "POST comment",
    ]);
    expect(writes(p.calls)[0].body).toEqual({ value: "st-3" });
    expect(writes(p.calls).filter(c => c.method === "DELETE").every(c => c.body === undefined)).toBe(true);
    expect(writes(p.calls)[6].body).toEqual({ value: ms("2026-11-20"), value_options: { time: false } });
  });

  it("read back first: a field already empty is not cleared again, a status already back is not written", async () => {
    const partly = card({ [F.status]: 3, [F.churnDate]: String(ms("2026-10-12")) });
    const p = fakeProvider(onCard(partly));
    const out = await executeItem(reactivate, steps(reactivate), p, async () => {}, boardFields, clientFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls).map(c => `${c.method} ${c.path.split("/").pop()}`)).toEqual([`DELETE ${F.churnDate}`, `POST ${F.nextDate}`, "POST comment"]);
    for (const k of ["status", "churnReason", "churnType", "pausedOn", "resumeOn"]) expect(out.progress[k]).toMatchObject({ done: true, unchanged: true });
  });

  it("a status option the list lacks fails the item before a comment says the card is back", async () => {
    const fewer = LIST_FIELDS.map(f => (f.id === F.status ? { ...f, type_config: { options: STATUS_OPTIONS.filter(o => o.name !== "Onboarding Booked") } } : f));
    const p = fakeProvider(onCard(stopped()));
    const out = await executeItem(reactivate, steps(reactivate), p, async () => {}, boardFields, async () => fewer);
    expect(out.state).toBe("failed");
    expect(writes(p.calls).some(c => c.path.endsWith("/comment"))).toBe(false);
  });

  it("each kind waits behind CLICKUP_WRITEBACK_BILLING_KINDS: held while unlisted, written once listed", async () => {
    const runWith = async (env: Record<string, string>, queued: QueueItem[]) => {
      let items = structuredClone(queued);
      const saves: any[] = [];
      const calls: Call[] = [];
      const deps: Deps = {
        env: k => env[k],
        now: () => NOW,
        uuid: () => "11111111-2222-3333-4444-555555555555",
        rpc: async (name, params = {}) => {
          if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
          if (name === "cockpit_clickup_writeback_inputs") return { campaigns: [] };
          if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
          if (name === "cockpit_billing_writeback_held") return { held: 0, heldOpenKind: 0, byKind: {} };
          if (name === "cockpit_clickup_writeback_save") saves.push(structuredClone(params.p_patch));
          return null;
        },
        providerFor: () => ({
          async call(provider, method, path, body) {
            calls.push({ provider, method, path, body });
            if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: LIST_FIELDS };
            if (method === "GET" && path === "task/task_a") return stopped();
            if (method === "POST" && path.endsWith("/comment")) return { id: "c-1" };
            return {};
          },
        }),
        syncState: async () => {},
      };
      await runLog(deps);
      return { states: saves.filter(s => s.state).map(s => s.state), writes: calls.filter(c => c.method !== "GET") };
    };
    const back = { ...reactivate, id: "4a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9" };
    const live = { CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_BILLING: "true", CLICKUP_WRITEBACK_BILLING_KINDS: "churn,extension,date,payment,pause,resume,mrr,late,survey" };
    const held = await runWith(live, [win, back]);
    expect(held.states).toEqual(["dry_run", "dry_run"]);
    expect(held.writes).toEqual([]);
    const open = await runWith({ ...live, CLICKUP_WRITEBACK_BILLING_KINDS: `${live.CLICKUP_WRITEBACK_BILLING_KINDS},win,reactivate` }, [win, back]);
    expect(open.states).toEqual(["delivered", "delivered"]);
    expect(open.writes.filter(c => c.method === "DELETE")).toHaveLength(5);
  });
});

describe("How they pay: method, plan and amount reach the card once their kinds are open (20261103a)", () => {
  // Payment Method and Payment Plan as a live GET of the Clients - Mahara list returned them (2026-11-02).
  // The run looks each option up by name, so these ids are what ClickUp is sent.
  const CARD_METHODS = [
    { id: "f5f2bd55-5dfa-4664-a7fb-ba3381ee9e3a", name: "Card on file", orderindex: 0 },
    { id: "139c8364-8a6c-4333-951f-b3e6d925b0d2", name: "Bank transfer", orderindex: 1 },
    { id: "f3e4f93b-90d8-4904-92c0-f6cebca7cd69", name: "Tap link", orderindex: 2 },
    { id: "482d3b2e-dbf3-48df-8c1e-f1f96d913feb", name: "Whop link", orderindex: 3 },
    { id: "1d836d92-bb96-4dff-bb00-f799f177a964", name: "Check", orderindex: 4 },
  ];
  const CARD_PLANS = [
    { id: "9fa1643e-af33-4e56-83f2-ec562ad879ef", name: "Paid in full (90 days)", orderindex: 0 },
    { id: "aaca2362-a934-4ba1-a5ac-ca201899a2f6", name: "Split Pay (2x payments)", orderindex: 1 },
    { id: "d140956c-5add-4272-a1a5-6f34f982c258", name: "Monthly", orderindex: 2 },
    { id: "d56813f8-565c-4d70-91ab-b92d2127dace", name: "1.0K Start / $2K Months After", orderindex: 3 },
    { id: "3b35d025-d9b5-416c-b1f6-a02c379efd05", name: "Performance ($3k/$3k)", orderindex: 4 },
  ];
  const HOW_FIELDS: any[] = LIST_FIELDS.map(f =>
    f.id === F.method ? { ...f, type_config: { options: CARD_METHODS } }
    : f.id === F.plan ? { ...f, type_config: { options: CARD_PLANS } }
    // Next Payment Amount is a USD currency field on the card.
    : f.id === F.nextAmount ? { ...f, type: "currency", type_config: { currency_type: "USD", precision: 2 } }
    : f,
  );
  const TEST_CARD = "86eywg1cq";
  /** The CLICKUP_WRITEBACK_BILLING_KINDS read live from cockpit_sync_state on 2026-11-02. */
  const LIVE_KINDS = "churn,date,extension,late,ltv,mrr,nps_sent,pause,payment,reactivate,resume,survey,win";
  const env = (over: Record<string, string> = {}) => ({
    CLICKUP_API_TOKEN: "x",
    CLICKUP_WRITEBACK_APPLY_BILLING: "true",
    CLICKUP_WRITEBACK_BILLING_KINDS: LIVE_KINDS,
    ...over,
  });
  /** The three events a How they pay save (or the canary) queues, as cockpit_billing_writeback_writes builds them. */
  const how = (taskId: string, n: number) => [
    item({ kind: "method", taskId, source: "ceo", writes: [{ field: "method", value: "Card on file", old: null }] }, { id: `${n}1b2c3d-0000-4000-8000-00000000000${n}` }),
    item({ kind: "plan", taskId, source: "ceo", writes: [{ field: "plan", value: "Monthly", old: null }] }, { id: `${n}2b2c3d-0000-4000-8000-00000000000${n}` }),
    item({ kind: "amount", taskId, source: "ceo", writes: [{ field: "nextAmount", value: 1234, old: null }] }, { id: `${n}3b2c3d-0000-4000-8000-00000000000${n}` }),
  ];
  const cardOf = (taskId: string, values: Record<string, unknown> = {}) => ({
    id: taskId,
    list: { id: CLIENTS_LIST },
    date_updated: String(EDIT_AT - 86_400_000),
    custom_fields: HOW_FIELDS.map(f => ({ ...f, ...(f.id in values ? { value: values[f.id] } : {}) })),
  });

  const runWith = async (vars: Record<string, string>, queued: QueueItem[]) => {
    let items = structuredClone(queued);
    const saves: any[] = [];
    const calls: Call[] = [];
    const rows: Record<string, any> = {};
    const deps: Deps = {
      env: k => vars[k],
      now: () => NOW,
      uuid: () => "11111111-2222-3333-4444-555555555555",
      rpc: async (name, params = {}) => {
        if (name === "cockpit_clickup_writeback_begin") return { id: "run-1" };
        if (name === "cockpit_clickup_writeback_inputs") return { campaigns: [] };
        if (name === "cockpit_clickup_writeback_claim") { const out = items; items = []; return out; }
        if (name === "cockpit_billing_writeback_held") return { held: 0, heldOpenKind: 0, byKind: {} };
        if (name === "cockpit_clickup_writeback_save") saves.push(structuredClone(params.p_patch));
        return null;
      },
      providerFor: () => ({
        async call(provider, method, path, body) {
          calls.push({ provider, method, path, body });
          if (method === "GET" && path === `list/${CLIENTS_LIST}/field`) return { fields: HOW_FIELDS };
          const task = path.match(/^task\/([A-Za-z0-9_]+)$/);
          if (method === "GET" && task) return cardOf(task[1]);
          return {};
        },
      }),
      syncState: async (key, row) => {
        rows[key] = row;
      },
    };
    await runLog(deps);
    return { states: saves.filter(s => s.state).map(s => s.state), writes: calls.filter(c => c.method !== "GET"), billing: rows["clickup-writeback:billing"] };
  };

  it("every method and plan the cockpit offers is an option on the card, sent by its option id", () => {
    const step = (fieldId: string, value: string): BillingStep => ({ key: "k", type: "billing_field", taskId: TEST_CARD, fieldId, field: "x", format: "dropdown", value, at: EDIT_AT });
    for (const m of SHEET_METHODS)
      expect([m, billingRequest(step(F.method, m), HOW_FIELDS)]).toEqual([m, { method: "POST", body: { value: CARD_METHODS.find(o => o.name === m)?.id } }]);
    for (const p of SHEET_PLANS)
      expect([p, billingRequest(step(F.plan, p), HOW_FIELDS)]).toEqual([p, { method: "POST", body: { value: CARD_PLANS.find(o => o.name === p)?.id } }]);
    expect(SHEET_METHODS.length).toBe(CARD_METHODS.length);
    expect(SHEET_PLANS.length).toBe(CARD_PLANS.length);
    // The card has no Ecom link, so the cockpit no longer offers one.
    expect(() => billingRequest(step(F.method, "Ecom link"), HOW_FIELDS)).toThrow('"Ecom link" is not an option on that ClickUp field.');
  });

  it("with the live kinds all three wait as dry runs and nothing is written", async () => {
    const out = await runWith(env(), how(TEST_CARD, 1));
    expect(out.states).toEqual(["dry_run", "dry_run", "dry_run"]);
    expect(out.writes).toEqual([]);
    expect(out.billing.detail).toMatchObject({ mode: "apply", held: 3, delivered: 0 });
    expect(out.billing.detail.kinds).not.toContain("method");
  });

  it("listed, on the test card only: Payment Method and Payment Plan by option id, Next Payment Amount as the number", async () => {
    const elsewhere = item({ kind: "method", source: "csm", writes: [{ field: "method", value: "Bank transfer", old: null }] }, { id: "9a1b2c3d-0000-4000-8000-000000000009" });
    const out = await runWith(env({ CLICKUP_WRITEBACK_BILLING_KINDS: `${LIVE_KINDS},method,plan,amount`, CLICKUP_WRITEBACK_BILLING_ONLY_CARDS: TEST_CARD }), [...how(TEST_CARD, 2), elsewhere]);
    expect(out.states).toEqual(["delivered", "delivered", "delivered", "dry_run"]);
    expect(out.writes).toEqual([
      { provider: "clickup", method: "POST", path: `task/${TEST_CARD}/field/665e5754-b9c6-4776-9386-111ad221dead`, body: { value: "f5f2bd55-5dfa-4664-a7fb-ba3381ee9e3a" } },
      { provider: "clickup", method: "POST", path: `task/${TEST_CARD}/field/17d17129-43c4-441b-a55c-6eca83b9f776`, body: { value: "d140956c-5add-4272-a1a5-6f34f982c258" } },
      { provider: "clickup", method: "POST", path: `task/${TEST_CARD}/field/f071ee8f-b7ce-49e8-899b-6bef649d86ba`, body: { value: 1234 } },
    ]);
    // No comment: method, plan and amount post none (20261102g's comment function returns NULL for them).
    expect(out.writes.some(c => c.path.endsWith("/comment"))).toBe(false);
    expect(out.billing.note).toStartWith("Billing: apply_limited (amount, churn, date, extension, late, ltv, method, mrr, nps_sent, pause, payment, plan, reactivate, resume, survey, win) on 86eywg1cq");
    // With the card list cleared, the edit on the real card is written too.
    const open = await runWith(env({ CLICKUP_WRITEBACK_BILLING_KINDS: `${LIVE_KINDS},method,plan,amount` }), [elsewhere]);
    expect(open.states).toEqual(["delivered"]);
    expect(open.writes).toEqual([
      { provider: "clickup", method: "POST", path: `task/task_a/field/${F.method}`, body: { value: "139c8364-8a6c-4333-951f-b3e6d925b0d2" } },
    ]);
  });

  it("a card already showing How they pay is read as unchanged and not written again", async () => {
    const shows = cardOf(TEST_CARD, { [F.method]: 0, [F.plan]: "d140956c-5add-4272-a1a5-6f34f982c258", [F.nextAmount]: "1234" });
    for (const it of how(TEST_CARD, 3)) {
      const p = fakeProvider(x => (x.method === "GET" && x.path === `task/${TEST_CARD}` ? shows : x.method === "GET" ? new Error("unexpected read") : {}));
      const out = await executeItem(it, steps(it), p, async () => {}, boardFields, async () => HOW_FIELDS);
      expect(out.state).toBe("delivered");
      expect(writes(p.calls)).toEqual([]);
      const key = String((it.payload.writes as any[])[0].field);
      expect(out.progress[key]).toMatchObject({ done: true, unchanged: true });
    }
  });
});
