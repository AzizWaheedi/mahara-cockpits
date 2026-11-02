import { describe, expect, it } from "bun:test";
import { billingAllStale, buildSteps, classify, executeItem, planItem, type Provider, type QueueItem, type Step } from "./queue";
import { CLIENTS_LIST, DEPARTMENT_LIST, FIELD, refLine, TECH_FIELD } from "./rules";

type Call = { provider: string; method: string; path: string; body?: any };
/** A provider that answers by route and records every call. A throw stands for a provider failure. */
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

const NOW = Date.parse("2026-10-09T09:00:00Z");
const CAMPAIGNS = [
  { campaignName: "Castello Leads", clientName: "Castello Industries", clientTag: "castello industries", taskId: "t1", taskUrl: "https://app.clickup.com/t/t1", spend7d: 100, metaCampaignId: "1200000001" },
  { campaignName: "Castello Retarget", clientName: "Castello Industries", clientTag: "castello industries", spend7d: 300 },
];
const item = (over: Partial<QueueItem>): QueueItem => ({
  id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  kind: "manual_change",
  payload: {},
  attempts: 1,
  created_at: new Date(NOW - 60_000).toISOString(),
  source_exists: true,
  ...over,
});
const STATUS_OPTIONS = { fields: [{ id: FIELD.adStatus, type_config: { options: [{ id: "opt-live", name: "Live", orderindex: 0 }, { id: "opt-paused", name: "Paused", orderindex: 1 }] } }] };
const boardFields = async () => STATUS_OPTIONS.fields;

describe("what each log entry writes", () => {
  it("a typed change becomes the Convex change comment plus a reference line", () => {
    const built = buildSteps(item({ payload: { campaignName: "Castello Leads", what: "Raised budget to $40", by: "nada@maharamedia.com", at: NOW - 3_600_000 } }), CAMPAIGNS, NOW);
    expect("steps" in built && built.steps).toEqual([{
      key: "comment",
      type: "comment",
      taskId: "t1",
      text: `🎯 Cockpit · CHANGE MADE - Raised budget to $40\n\nCastello Leads\n\nMade by nada@maharamedia.com in the Media Buyer Cockpit on 9 Oct 2026. Three days before this is judged.\n\n${refLine("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0")}`,
    }]);
  });
  it("a campaign without its own card logs on the client's card, without moving Ad Status", () => {
    const built = buildSteps(item({ kind: "provider_action", payload: { campaignName: "Castello Retarget", what: "Paused Castello Retarget", syncAdStatus: true, metaId: "1200000002", at: NOW } }), CAMPAIGNS, NOW);
    expect("steps" in built && built.steps.map(s => [s.type, (s as any).taskId])).toEqual([["comment", "t1"]]);
  });
  it("a whole campaign switched on its own card also moves Ad Status", () => {
    const built = buildSteps(item({ kind: "provider_action", payload: { campaignName: "Castello Leads", what: "Paused Castello Leads", syncAdStatus: true, at: NOW } }), CAMPAIGNS, NOW);
    expect("steps" in built && built.steps.map(s => s.type)).toEqual(["comment", "ad_status"]);
    expect("steps" in built && (built.steps[1] as any).metaCampaignId).toBe("1200000001");
  });
  it("questions, missing cards and removed entries stay in the cockpit", () => {
    expect(buildSteps(item({ payload: { campaignName: "Castello Leads", what: "Asked Aziz: can we raise?" } }), CAMPAIGNS, NOW)).toEqual({ skip: expect.stringContaining("not a change") });
    expect(buildSteps(item({ payload: { campaignName: "Nobody", what: "Paused" } }), CAMPAIGNS, NOW)).toEqual({ skip: "No card on the ads management board for Nobody, so this change is in the cockpit only." });
    expect(buildSteps(item({ kind: "decision", source_exists: false, payload: { subject: "Castello Leads" } }), CAMPAIGNS, NOW)).toEqual({ skip: expect.stringContaining("removed") });
  });
  it("a rerouted decision raises the ticket the way the form would, then links it on the card", () => {
    const built = buildSteps(item({ kind: "decision", payload: { subject: "Castello Leads", action: "Add qualification questions to the lead form", kind: "rerouted", evidence: "Junk leads", reason: "Ask budget and timeline", reroutedTo: "tech" } }), CAMPAIGNS, NOW);
    if (!("steps" in built)) throw new Error("expected steps");
    expect(built.steps.map(s => s.key)).toEqual(["comment", "ticket", "ticket_type", "ticket_notes", "ticket_questions", "ticket_link"]);
    const ticket = built.steps[1] as Extract<Step, { type: "create_task" }>;
    expect(ticket.listId).toBe(DEPARTMENT_LIST.tech.id);
    expect(ticket.body.name).toBe("Castello Industries - Add qualification questions to the lead form");
    expect(ticket.body.markdown_description).toBe(`Requested from the Media Buyer Cockpit.\nCampaign: Castello Leads\nWhy: Junk leads\nNote: Ask budget and timeline\nCampaign task: https://app.clickup.com/t/t1\n\n${ticket.marker}`);
    expect(ticket.body.tags).toEqual(["castello industries"]);
    expect((built.steps[3] as any)).toMatchObject({ taskId: "$ticket", fieldId: TECH_FIELD.additionalNotes, value: "Ask budget and timeline" });
    expect((built.steps[0] as any).text.startsWith("🎯 Cockpit · SENT TO TECH - Add qualification questions to the lead form")).toBe(true);
  });
  const csm = (payload: any) => item({ kind: "decision", payload: { role: "csm", kind: "ticket", subject: "City Wood", clientTaskId: "86eyt1d33", ...payload } });
  it("a client success ticket lands on the team's board, then links on the client's own task", () => {
    const built = buildSteps(csm({ action: "New scripts needed", reroutedTo: "creative", note: "Faces on camera", byEmail: "rasem@maharamedia.com" }), CAMPAIGNS, NOW);
    if (!("steps" in built)) throw new Error("expected steps");
    expect(built.steps.map(s => s.key)).toEqual(["ticket", "ticket_link"]);
    const ticket = built.steps[0] as Extract<Step, { type: "create_task" }>;
    expect(ticket.listId).toBe(DEPARTMENT_LIST.creative.id);
    expect(ticket.body.name).toBe("City Wood - New scripts needed");
    expect(ticket.body.markdown_description).toBe(`Requested from the Client Success Cockpit.\nClient: City Wood\nNote: Faces on camera\nClient task: https://app.clickup.com/t/86eyt1d33\nRaised by: rasem@maharamedia.com\n\n${ticket.marker}`);
    expect(built.steps[1]).toMatchObject({ type: "comment", taskId: "86eyt1d33" });
    expect((built.steps[1] as any).text).toContain("$ticketUrl");
  });
  it("a client success tech ticket fills the tech form the way the request form would", () => {
    const built = buildSteps(csm({ action: "Tracking / page is broken", reroutedTo: "tech", note: "Form not firing" }), CAMPAIGNS, NOW);
    if (!("steps" in built)) throw new Error("expected steps");
    expect(built.steps.map(s => s.key)).toEqual(["ticket", "ticket_type", "ticket_notes", "ticket_link"]);
    expect(built.steps[2]).toMatchObject({ taskId: "$ticket", fieldId: TECH_FIELD.additionalNotes, value: "Form not firing" });
  });
  it("other client success entries, unknown teams and clients without a ClickUp task stay in the cockpit", () => {
    expect(buildSteps(csm({ kind: "stage", action: "Moved to Paused" }), CAMPAIGNS, NOW)).toEqual({ skip: expect.stringContaining("stays in the cockpit") });
    expect(buildSteps(csm({ action: "x", reroutedTo: "legal" }), CAMPAIGNS, NOW)).toEqual({ skip: expect.stringContaining("No board") });
    expect(buildSteps(csm({ action: "x", reroutedTo: "creative", clientTaskId: null }), CAMPAIGNS, NOW)).toEqual({ skip: expect.stringContaining("No ClickUp task for City Wood") });
  });
});

describe("delivery without duplicate comments", () => {
  const comment = (taskId = "t1"): Step => ({ key: "comment", type: "comment", taskId, text: "🎯 Cockpit · CHANGE MADE — x\n\nCockpit ref abc" });

  it("posts once and records the comment id", async () => {
    const p = fakeProvider(c => (c.method === "POST" ? { id: "c-1" } : {}));
    const saved: any[] = [];
    const out = await executeItem(item({}), [comment()], p, async pr => { saved.push(structuredClone(pr)); }, boardFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls)).toEqual([{ provider: "clickup", method: "POST", path: "task/t1/comment", body: { comment_text: "🎯 Cockpit · CHANGE MADE — x\n\nCockpit ref abc", notify_all: false } }]);
    // The start is saved before the write, so a crash in between is read back next time.
    expect(saved[0]).toEqual({ comment: { started: true } });
    expect(out.progress.comment).toEqual({ done: true, id: "c-1" });
  });

  it("an unknown outcome is read back on the retry and not posted again", async () => {
    const first = fakeProvider(c => (c.method === "POST" ? new Error("Provider response is unknown. Reconcile before retrying.") : {}));
    let progress: any = {};
    const out1 = await executeItem(item({}), [comment()], first, async pr => { progress = structuredClone(pr); }, boardFields);
    expect(out1.state).toBe("unknown");
    expect(classify(new Error("Provider response is unknown. Reconcile before retrying."))).toBe("unknown");

    // ClickUp did receive it: the retry finds the reference line and posts nothing.
    const second = fakeProvider(c => (c.method === "GET" && c.path === "task/t1/comment" ? { comments: [{ id: "c-9", comment_text: "🎯 Cockpit · CHANGE MADE — x\n\nCockpit ref abc" }] } : new Error("unexpected")));
    const out2 = await executeItem(item({ attempts: 2, progress }), [comment()], second, async () => {}, boardFields);
    expect(out2.state).toBe("delivered");
    expect(writes(second.calls)).toEqual([]);
    expect(out2.progress.comment).toMatchObject({ done: true, id: "c-9", readBack: true });
  });

  it("an unknown outcome that never landed is posted exactly once on the retry", async () => {
    const p = fakeProvider(c => (c.method === "GET" ? { comments: [{ id: "c-0", comment_text: "someone else" }] } : { id: "c-2" }));
    const out = await executeItem(item({ attempts: 2, progress: { comment: { started: true } } }), [comment()], p, async () => {}, boardFields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls).length).toBe(1);
  });

  it("a server error on the write is treated as unknown, a 429 as a plain retry", async () => {
    expect(classify(new Error("clickup rejected the request (502). Inspect the provider receipt."))).toBe("unknown");
    expect(classify(new Error("clickup rejected the request (429). Inspect the provider receipt."))).toBe("retry");
    expect(classify(new Error("clickup rejected the request (404): Task not found"))).toBe("refused");
    expect(classify(new Error("CLICKUP_API_TOKEN is not configured"))).toBe("config");
    const p = fakeProvider(c => (c.method === "POST" ? new Error("clickup rejected the request (429). Inspect the provider receipt.") : {}));
    const out = await executeItem(item({}), [comment()], p, async () => {}, boardFields);
    expect(out.state).toBe("retry");
    // A 429 never landed, so the next attempt does not need to read back.
    expect(out.progress.comment).toBeUndefined();
  });

  it("does not repeat finished steps and does not create the ticket twice", async () => {
    const steps = buildSteps(item({ kind: "decision", payload: { subject: "Castello Leads", action: "Landing page or tracking is broken", kind: "rerouted", evidence: "Form not firing", reroutedTo: "tech" } }), CAMPAIGNS, NOW);
    if (!("steps" in steps)) throw new Error("expected steps");
    const marker = (steps.steps[1] as any).marker;
    // First attempt: comment posted, ticket creation outcome unknown.
    const first = fakeProvider(c => (c.path === "task/t1/comment" && c.method === "POST" ? { id: "c-1" } : c.path.startsWith("list/") && c.method === "POST" ? new Error("Provider response is unknown. Reconcile before retrying.") : {}));
    let progress: any = {};
    expect((await executeItem(item({ kind: "decision" }), steps.steps, first, async pr => { progress = structuredClone(pr); }, boardFields)).state).toBe("unknown");
    // Retry: the ticket exists on the list with its marker; nothing is created again.
    const second = fakeProvider(c => {
      if (c.method === "GET" && c.path.startsWith(`list/${DEPARTMENT_LIST.tech.id}/task`)) return { tasks: [{ id: "tk-7", url: "https://app.clickup.com/t/tk-7", description: `Requested...\n\n${marker}` }] };
      if (c.method === "POST" && c.path === "task/t1/comment") return { id: "c-2" };
      return {};
    });
    const out = await executeItem(item({ kind: "decision", attempts: 2, progress }), steps.steps, second, async () => {}, boardFields);
    expect(out.state).toBe("delivered");
    const posted = writes(second.calls).map(c => c.path);
    expect(posted).toEqual([`task/tk-7/field/${TECH_FIELD.requestType}`, `task/tk-7/field/${TECH_FIELD.additionalNotes}`, "task/t1/comment"]);
    expect(writes(second.calls).at(-1)?.body.comment_text).toContain("Request raised on the Operations/Tech board: https://app.clickup.com/t/tk-7");
  });

  it("moves Ad Status from Meta's read-back, and leaves it when the board agrees", async () => {
    const step: Step = { key: "ad_status", type: "ad_status", taskId: "t1", metaCampaignId: "1200000001" };
    const route = (board: number) => (c: Call) =>
      c.provider === "meta" ? { status: "PAUSED" } : c.path === "task/t1" ? { custom_fields: [{ id: FIELD.adStatus, value: board, type_config: STATUS_OPTIONS.fields[0].type_config }] } : {};
    const moving = fakeProvider(route(0));
    expect((await executeItem(item({}), [step], moving, async () => {}, boardFields)).progress.ad_status).toEqual({ done: true, from: "Live", to: "Paused" });
    expect(writes(moving.calls)).toEqual([{ provider: "clickup", method: "POST", path: `task/t1/field/${FIELD.adStatus}`, body: { value: "opt-paused" } }]);
    const agreeing = fakeProvider(route(1));
    await executeItem(item({}), [step], agreeing, async () => {}, boardFields);
    expect(writes(agreeing.calls)).toEqual([]);
  });

  it("the dry-run plan reads only and lists task, field, old and new", async () => {
    const p = fakeProvider(c => (c.provider === "meta" ? { status: "ACTIVE" } : c.path === "task/t1" ? { custom_fields: [{ id: FIELD.adStatus, value: "opt-paused", type_config: STATUS_OPTIONS.fields[0].type_config }] } : {}));
    const planned = await planItem(item({}), [comment(), { key: "ad_status", type: "ad_status", taskId: "t1", metaCampaignId: "1200000001" }], p, boardFields);
    expect(writes(p.calls)).toEqual([]);
    expect(planned).toEqual([
      { queueId: item({}).id, kind: "manual_change", taskId: "t1", field: "comment", old: null, new: "🎯 Cockpit · CHANGE MADE — x\n\nCockpit ref abc" },
      { queueId: item({}).id, kind: "manual_change", taskId: "t1", field: "Ad Status", fieldId: FIELD.adStatus, old: "Paused", new: "Live", note: "Meta says ACTIVE." },
    ]);
  });
});

// --- billing items of waves 1-2 (20261101m; contract 4.1 step 4) ------------------------------------------

describe("billing items: the checkbox format, a resumed step read back, the item's own comment", () => {
  const CHECKBOX = "9cfdb353-aaaa-4bbb-8ccc-dddddddddddd";
  const RESUME_ON = "d3c46259-3017-4429-a52a-c609a40f348b";
  const fields = async () => [{ id: CHECKBOX, type: "checkbox" }, { id: RESUME_ON, type: "date" }];
  const billing = (payload: Record<string, unknown>, over: Partial<QueueItem> = {}) =>
    item({ kind: "billing", payload: { taskId: "task_a", by: "sara@tests.invalid", at: NOW - 60_000, ...payload }, ...over });
  const cardWith = (values: Record<string, unknown>, updated = NOW - 86_400_000) => ({
    id: "task_a",
    list: { id: CLIENTS_LIST },
    date_updated: String(updated),
    custom_fields: Object.entries(values).map(([id, value]) => ({ id, value })),
  });
  const built = (i: QueueItem) => {
    const b = buildSteps(i, [], NOW);
    if (!("steps" in b)) throw new Error(b.skip);
    return b.steps;
  };

  it("a checkbox step carries true or false as text and resolves its field on the run", async () => {
    const one = billing({ writes: [{ field: "willNotContinue", value: false }] });
    expect(built(one)).toEqual([
      { key: "willNotContinue", type: "billing_field", taskId: "task_a", fieldId: "9cfdb353", field: "Will not continue if billed on schedule", format: "checkbox", value: "false", byPrefix: true, at: NOW - 60_000 },
    ]);
    const p = fakeProvider(c => (c.method === "GET" ? cardWith({ [CHECKBOX]: "true" }) : {}));
    expect((await executeItem(one, built(one), p, async () => {}, boardFields, fields)).progress.willNotContinue).toEqual({ done: true, written: true, from: "true", to: "false" });
    expect(writes(p.calls)).toEqual([{ provider: "clickup", method: "POST", path: `task/task_a/field/${CHECKBOX}`, body: { value: false } }]);
    // The dry-run plan names the field it resolved.
    const plan = await planItem(one, built(one), fakeProvider(() => cardWith({ [CHECKBOX]: "true" })), boardFields, fields);
    expect(plan).toEqual([{ queueId: one.id, kind: "billing", taskId: "task_a", field: "Will not continue if billed on schedule", fieldId: CHECKBOX, old: "true", new: "false" }]);
  });

  it("a step that started and never finished is read back: the card already shows it, so it is not written twice", async () => {
    const one = billing({ writes: [{ field: "resumeOn", value: "2026-11-10" }] });
    const p = fakeProvider(() => cardWith({ [RESUME_ON]: String(Date.parse("2026-11-10T09:00:00Z")) }, NOW - 1000));
    const out = await executeItem({ ...one, attempts: 2, progress: { resumeOn: { started: true } } }, built(one), p, async () => {}, boardFields, fields);
    expect(out.state).toBe("delivered");
    expect(writes(p.calls)).toEqual([]);
    expect(out.progress.resumeOn).toMatchObject({ unchanged: true, current: "2026-11-10" });
  });

  it("a note and an event comment on one item carry different reference lines, so a retry finds each", () => {
    const both = built(billing({ writes: [], note: "Called", comment: "RESUMED 2026-11-10" }));
    expect(both.map(s => [s.key, (s as any).text.split("\n").pop()])).toEqual([
      ["comment", refLine(item({}).id)],
      ["billing_comment", refLine(item({}).id, "c")],
    ]);
  });

  it("all stale means every field kept by ClickUp or missing, at least one kept; a note-only item never is", () => {
    const s = (key: string): Step => ({ key, type: "billing_field", taskId: "t", fieldId: "f", field: "F", format: "date", value: "2026-11-01", at: 0 });
    const c: Step = { key: "billing_comment", type: "comment", taskId: "t", text: "x" };
    expect(billingAllStale([s("a"), s("b"), c], { a: { stale: true }, b: { missing: true } })).toBe(true);
    expect(billingAllStale([s("a"), s("b")], { a: { stale: true }, b: { written: true } })).toBe(false);
    expect(billingAllStale([s("a")], { a: { missing: true } })).toBe(false);
    expect(billingAllStale([c], {})).toBe(false);
  });
});
