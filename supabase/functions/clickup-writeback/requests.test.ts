import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  cardCommentText,
  createBody,
  doctorChecks,
  errorKind,
  executeRequest,
  fieldMatches,
  holdsMarker,
  kuwaitDay,
  noonKuwait,
  normName,
  payloadProblem,
  planRequest,
  requestsGate,
  requestStepKeys,
  runContext,
  SAY,
  STEP_REFUSED,
} from "./requests";
import { DOUBT_MINUTES, finalWords, gate, HOLD_MS, kpiGate, runRequestsDoctor, STILL_CHECKING, WAITING } from "./run";
import {
  CARD,
  clickupStoredDue,
  FIELD,
  harness,
  LISTS,
  LIVE,
  NOW,
  OPTION,
  PEOPLE,
  pausePayloads,
  REF_HEX,
  rejected,
  REQUEST_ID,
  requestPayload,
  RT_FIELD,
  TEST_CARD,
  toolsHarness,
  unknownError,
  WHATSAPP_STEPS,
  whatsappPayload,
} from "./requestsTestkit";

const MARKER = `Cockpit ref R-${REF_HEX}-main`;
const steps = (row: { progress: any }) => Object.fromEntries(Object.entries(row.progress?.steps ?? {}).map(([k, v]: [string, any]) => [k, v.state]));

describe("the requests switch (contract 4.1)", () => {
  const env = (e: Record<string, string | undefined>) => (k: string) => e[k];
  it("opens only on CLICKUP_WRITEBACK_APPLY_REQUESTS exactly 'true'", () => {
    for (const v of [undefined, "", "TRUE", "True", " true", "true ", "1", "yes"])
      expect(requestsGate(env({ CLICKUP_WRITEBACK_APPLY_REQUESTS: v })).apply).toBe(false);
    expect(requestsGate(env({ CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" })).mode).toBe("apply");
  });
  it("no other switch opens or narrows it, and it opens nothing else", () => {
    const others = { CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_APPLY_CSM_TICKETS: "true", CLICKUP_WRITEBACK_APPLY_KPI: "true", CLICKUP_WRITEBACK_ONLY_TASKS: CARD };
    expect(requestsGate(env(others))).toMatchObject({ apply: false, mode: "dry_run" });
    expect(requestsGate(env({ ...others, CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" })).mode).toBe("apply");
    const alone = env({ CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" });
    expect(gate(alone)).toMatchObject({ apply: false, csmTickets: false, mode: "dry_run" });
    expect(kpiGate(alone)).toMatchObject({ apply: false, mode: "dry_run" });
  });
  it("the canary narrows a live run to the listed client cards", () => {
    const g = requestsGate(env({ CLICKUP_WRITEBACK_APPLY_REQUESTS: "true", CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: ` ${TEST_CARD} , 86other01` }));
    expect(g.mode).toBe("apply_limited");
    expect([g.live(TEST_CARD), g.live("86other01"), g.live(CARD), g.live(null), g.live(undefined)]).toEqual([true, true, false, false, false]);
  });
});

describe("a run under every switch but the requests switch", () => {
  it("holds requests and task changes as dry runs and calls no provider at all", async () => {
    const settings: Record<string, string>[] = [
      {},
      { CLICKUP_WRITEBACK_APPLY: "true" },
      { CLICKUP_WRITEBACK_APPLY_CSM_TICKETS: "true" },
      { CLICKUP_WRITEBACK_APPLY_KPI: "true" },
      { CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_ONLY_TASKS: CARD },
      { CLICKUP_WRITEBACK_APPLY_REQUESTS: "TRUE" },
      { CLICKUP_WRITEBACK_APPLY_REQUESTS: "1", CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: CARD },
    ];
    for (const env of settings) {
      const h = harness({ CLICKUP_API_TOKEN: "x", ...env });
      const a = h.db.enqueue("request", requestPayload());
      const b = h.db.enqueue("request", pausePayloads()[1]);
      const c = h.db.enqueue("task_action", { ...requestPayload(), op: "comment", ref: "T-0123456789", taskId: "86work0001", text: "Done on my side", actor: { clickupUserId: 1 } });
      const out = await h.run();
      expect(h.clickup.calls).toEqual([]);
      // Never settled (RT-1): each row is back in the queue, its try not counted, and goes once the switch is on.
      expect([a, b, c].map(r => r.state)).toEqual(["queued", "queued", "queued"]);
      expect([a, b, c].map(r => r.attempts)).toEqual([0, 0, 0]);
      expect(out).toMatchObject({ ok: true, mode: "dry_run", note: "Dry run: 2 requests and 1 task change planned. Nothing was written to ClickUp. They wait in the queue for the switch." });
      // The canary list is reported as set, even while the switch keeps everything a dry run.
      expect(h.db.lastState()).toMatchObject({ p_ok: true, p_mode: "dry_run", p_only_cards: env.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS ? [CARD] : [], p_note: out.note });
    }
  });

  it("records exactly what a live run would write, from the frozen payload", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const row = h.db.enqueue("request", requestPayload({ fields: [{ fieldId: FIELD.leadList, kind: "url", value: "https://docs.example.com/leads", label: "Lead list", display: "https://docs.example.com/leads" }] }));
    await h.run();
    expect(row.planned).toEqual(planRequest({ ...row, attempts: 1, created_at: "" } as any));
    expect((row.planned as any[]).map(p => p.field)).toEqual(["new task on Operations / Tech", "SOP steps (draft)", "tag", "Lead list", "comment"]);
    expect((row.planned as any[])[0].new).toMatchObject({ name: "Acme Interiors - General tech request", owner: "the systems manager", ownerClickupId: PEOPLE.systemsManager, dueOn: "2026-10-28", priority: "normal" });
    expect(h.db.finished[0]).toMatchObject({ p_ok: true, p_counts: { claimed: 1, dryRun: 1 } });
    expect(h.db.begun[0]).toEqual({ p_job: "requests", p_mode: "dry_run", p_exclusive: false });
  });
});

describe("one run's bookkeeping (contract 4.2)", () => {
  it("without the ClickUp token it says so on the requests state row and claims nothing", async () => {
    const h = harness({ CLICKUP_WRITEBACK_APPLY_REQUESTS: "true", CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD });
    h.db.enqueue("request", requestPayload());
    const out = await h.run();
    expect(out).toMatchObject({ ok: false, mode: "apply_limited", note: SAY.noToken });
    expect(h.db.rpcs.map(r => r.name)).toEqual(["cockpit_clickup_requests_state"]);
    expect(h.db.lastState()).toMatchObject({ p_ok: false, p_mode: "apply_limited", p_only_cards: [TEST_CARD] });
  });

  it("an empty queue reports the mode with Nothing to write", async () => {
    const h = harness(LIVE);
    const out = await h.run();
    expect(out).toEqual({ ok: true, job: "requests", mode: "apply", note: "Nothing to write." });
    expect(h.db.rpcs.map(r => r.name)).toEqual(["cockpit_request_sweep", "cockpit_clickup_writeback_claim_requests", "cockpit_clickup_requests_state"]);
    expect(h.db.rpcs[1].params.p_limit).toBe(6);
    expect(h.db.lastState()).toMatchObject({ p_ok: true, p_note: "Nothing to write.", p_mode: "apply", p_counts: {} });
  });

  it("a request cancelled before the claim is skipped with no provider call", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    h.db.cancelled.add(REQUEST_ID);
    await h.run();
    expect(row).toMatchObject({ state: "skipped", error: "The request was cancelled before it reached ClickUp." });
    expect(h.clickup.calls).toEqual([]);
  });

  it("a payload that points at a list the cockpit does not write to fails before any call", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ listId: LISTS.cards }));
    const out = await h.run();
    expect(row.state).toBe("failed");
    expect(row.error).toBe("This request points at a list the cockpit does not write to. Cancel it and raise it again.");
    expect(h.clickup.calls).toEqual([]);
    expect(out.ok).toBe(false);
    expect(payloadProblem(requestPayload({ templateId: "../x" }))).toBe(SAY.badPayload);
    expect(payloadProblem(requestPayload({ clientTaskId: "a/b" }))).toBe(SAY.badPayload);
    expect(payloadProblem(requestPayload())).toBeNull();
  });

  it("a run that cannot start hands its items back at once", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    h.db.fail = name => (name === "cockpit_clickup_writeback_begin" ? new Error("Supabase 400: Unsupported writeback run") : undefined);
    const out = await h.run();
    expect(out.ok).toBe(false);
    expect(row).toMatchObject({ state: "retry", claim_token: null });
    expect(row.error).toBe("The requests run could not start, so this waits for the next run.");
    expect(h.clickup.calls).toEqual([]);
    expect(h.db.lastState()?.p_ok).toBe(false);
  });

  it("stops taking new items once the run nears its time limit, and holds the rest for the next run", async () => {
    const h = harness(LIVE);
    const first = h.db.enqueue("request", requestPayload());
    const second = h.db.enqueue("request", requestPayload({ requestId: "2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-2b2b3c4d5e-main" }));
    h.clickup.onCreate = () => h.advance(101_000);
    const out = await h.run();
    expect(first.state).toBe("delivered");
    expect(second).toMatchObject({ state: "retry", error: "Held for the next run, so this run ends inside its time limit." });
    expect(out.note).toBe("1 request delivered, 0 to retry, 0 failed. 1 held for the next run.");
  });

  it("a progress save that fails mid-step leaves the item to be read back, never failed", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    let saves = 0;
    h.db.fail = name => (name === "cockpit_clickup_writeback_save" && ++saves === 4 ? new Error("Supabase 503: upstream") : undefined);
    const out = await h.run();
    expect(row.state).toBe("unknown");
    expect(row.error).toContain("The cockpit could not save its progress, so the next run reads ClickUp back before writing again.");
    expect(out.counts).toMatchObject({ unknown: 1, failed: 0 });
    h.db.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path === `list/${LISTS.tech}/task`)).toHaveLength(1);
  });
});

describe("a request with no template (General tech request)", () => {
  it("creates the task with owner, due day and priority, adds the SOP steps, the tag and the card link, then settles", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    const out = await h.run();
    expect(out).toMatchObject({ ok: true, mode: "apply", note: "1 request delivered, 0 to retry, 0 failed." });

    const create = h.clickup.writes()[0];
    expect(create).toMatchObject({ actionId: row.id, method: "POST", path: `list/${LISTS.tech}/task` });
    expect(create.body).toEqual({
      name: "Acme Interiors - General tech request",
      markdown_description: `${requestPayload().descriptionMarkdown}\n\n${MARKER}`,
      assignees: [PEOPLE.systemsManager],
      priority: 3,
      due_date: Date.parse("2026-10-28T09:00:00Z"),
      due_date_time: false,
      status: "to do",
      notify_all: false,
    });
    expect(createBody(requestPayload({ ownerClickupId: null }))).not.toHaveProperty("assignees");

    const taskId = row.task_id!;
    const t = h.clickup.task(taskId)!;
    expect(t.list.id).toBe(LISTS.tech);
    expect(t.checklists).toHaveLength(1);
    expect(t.checklists[0].name).toBe("SOP steps (draft)");
    expect(t.checklists[0].items.map((i: any) => i.name)).toEqual(requestPayload().sopSteps);
    expect(t.tags).toEqual([{ name: "acme interiors" }]);
    const link = h.clickup.comments.get(CARD)!;
    expect(link).toHaveLength(1);
    expect(link[0].comment_text).toBe(`Cockpit · The CSM asked Operations / Tech: General tech request\n${t.url}\n\n${MARKER}-card`);
    expect(h.clickup.writes().find(c => c.path.endsWith("/comment"))?.body?.notify_all).toBe(false);

    expect(row).toMatchObject({ state: "delivered", error: null });
    expect(row.steps).toEqual(["create", "checklist", "tag", "card_comment"]);
    expect(steps(row)).toEqual({ create: "done", checklist: "done", tag: "done", card_comment: "done" });
    expect(row.progress?.task).toEqual({ id: taskId, url: t.url });
    // The task id is saved the moment it is known, before any later step.
    const saves = h.db.saves(row.id);
    const firstWithId = saves.findIndex(s => s.task_id === taskId);
    const firstChecklist = saves.findIndex(s => s.progress?.steps?.checklist);
    expect(firstWithId).toBeGreaterThan(-1);
    expect(firstWithId).toBeLessThan(firstChecklist);
    // Every write records started before its call and done after its read-back.
    expect(saves.some(s => s.progress?.steps?.create?.state === "started")).toBe(true);
    // The part follows the row, and its two-minute check is queued for later.
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ state: "delivered", clickupTaskId: taskId, clickupUrl: t.url });
    expect(h.db.byKey(`verify:${REQUEST_ID}:main`)).toMatchObject({ kind: "task_action", task_id: taskId, next_attempt_at: NOW + 120_000 });
  });

  it("never writes Request Type, custom fields in the create body, or the two protected fields", async () => {
    const h = harness(LIVE);
    h.db.enqueue("request", requestPayload({ fields: [{ fieldId: "09abf737-302f-422a-9d17-8fb9619903d1", kind: "select", value: "x", label: "Ads Request Type" }] }));
    await h.run();
    const writes = h.clickup.writes();
    expect(writes.some(c => c.body && "custom_fields" in c.body)).toBe(false);
    expect(writes.some(c => c.path.includes(RT_FIELD) || c.path.includes("09abf737") || c.path.includes("d3ac52c5"))).toBe(false);
  });

  it("a field entry naming Request Type or a protected field is never posted: the part is delivered with the fields note (retest round 2)", async () => {
    const h = harness(LIVE);
    // setRequestType is off: nothing may set Request Type, not even a field entry an old payload carried.
    const row = h.db.enqueue(
      "request",
      requestPayload({
        setRequestType: false,
        fields: [
          { fieldId: RT_FIELD.toUpperCase(), kind: "select", value: OPTION.generalTech, label: "Request Type" },
          { fieldId: "d3ac52c5-b71c-4782-9fea-1f9371cbae47", kind: "select", value: "x", label: "Type of Submission" },
        ],
      }),
    );
    await h.run();
    expect(h.clickup.writes().some(c => /\/field\//.test(c.path))).toBe(false);
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.fields).toMatchObject({ state: "mismatch", mismatched: ["Request Type", "Type of Submission"] });
    expect(row.progress?.note).toContain("Some fields did not save in ClickUp: Request Type, Type of Submission. They are in the description.");
  });

  it("with no client it makes no tag and no card link", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ clientName: null, clientTaskId: null }));
    await h.run();
    expect(row.steps).toEqual(["create", "checklist"]);
    expect(row.state).toBe("delivered");
    expect(h.clickup.task(row.task_id!)!.name).toBe("General tech request - from the CSM");
  });

  it("a client the space has no tag for is delivered with the tag step skipped", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ clientName: "Nobody Tagged", clientTag: "nobody tagged" }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.tag).toMatchObject({ state: "skipped", why: "The ClickUp space has no tag for this client." });
  });

  it("an Arabic client tag is found in lower case and sent encoded", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ clientName: "حول العمران", clientTag: "حول العمران" }));
    await h.run();
    expect(h.clickup.writes().some(c => c.path === `task/${row.task_id}/tag/${encodeURIComponent("حول العمران")}`)).toBe(true);
    expect(steps(row).tag).toBe("done");
  });
});

describe("a request from a template, in two parts (Client pause)", () => {
  it("makes each part from its template, keeps the template's text, then sets owner, due day and priority", async () => {
    const h = harness(LIVE);
    const [techP, mediaP] = pausePayloads();
    const tech = h.db.enqueue("request", techP);
    const media = h.db.enqueue("request", mediaP);
    const out = await h.run();
    expect(out.note).toBe("2 requests delivered, 0 to retry, 0 failed.");
    expect(tech.steps).toEqual(["create", "description", "owner_due_priority", "checklist", "tag", "card_comment"]);

    const fromTemplate = h.clickup.writes().filter(c => c.path.includes("/taskTemplate/"));
    expect(fromTemplate.map(c => [c.path, c.body])).toEqual([
      [`list/${LISTS.tech}/taskTemplate/t-86ex63qk5`, { name: "Acme Interiors - Client pause (Tech)" }],
      [`list/${LISTS.ads}/taskTemplate/t-86ex63qm7`, { name: "Acme Interiors - Client pause (Media)" }],
    ]);
    const t = h.clickup.task(tech.task_id!)!;
    expect(t.markdown_description).toBe(`**Pause the client's tech**\nTurn off what sends leads to the client.\n\n---\n\n${techP.descriptionMarkdown}\n\nCockpit ref R-${REF_HEX}-tech`);
    expect(t.checklists.map((c: any) => c.name)).toEqual(["Tech pause steps"]);
    expect(t.assignees).toEqual([{ id: PEOPLE.systemsManager }]);
    expect(t.priority).toMatchObject({ priority: "normal" });
    // ClickUp keeps 06:00 Kuwait for the 12:00 Kuwait write; the day is what is checked.
    expect(Number(t.due_date)).toBe(clickupStoredDue(techP.dueMs));
    expect(Number(t.due_date)).not.toBe(techP.dueMs);
    expect(steps(tech)).toEqual({ create: "done", description: "done", owner_due_priority: "done", checklist: "unchanged", tag: "done", card_comment: "done" });
    const put = h.clickup.writes().find(c => c.method === "PUT" && c.path === `task/${tech.task_id}` && c.body?.assignees);
    expect(put?.body).toEqual({ assignees: { add: [PEOPLE.systemsManager], rem: [] }, due_date: techP.dueMs, due_date_time: false, priority: 3 });

    // The media part has no owner: nobody is assigned in silence, and nothing is invented.
    const m = h.clickup.task(media.task_id!)!;
    expect(m.list.id).toBe(LISTS.ads);
    expect(m.assignees).toEqual([]);
    expect(media.state).toBe("delivered");
    // Two link comments on the card, one per part, each with its own marker.
    expect(h.clickup.comments.get(CARD)!.map(c => c.comment_text.split("\n").pop())).toEqual([
      `Cockpit ref R-${REF_HEX}-tech-card`,
      `Cockpit ref R-${REF_HEX}-media-card`,
    ]);
  });

  it("takes the task id from the top of the answer too", async () => {
    const h = harness(LIVE);
    h.clickup.templateAnswer = "top";
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.task(row.task_id!)?.name).toBe("Acme Interiors - Client pause (Tech)");
  });

  it("a template task that already has the owner, day and priority is left as it is", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    h.clickup.onCreate = t => {
      t.assignees = [{ id: PEOPLE.systemsManager }];
      t.due_date = String(clickupStoredDue(pausePayloads()[0].dueMs));
      t.priority = { id: "3", priority: "normal" };
    };
    await h.run();
    expect(steps(row).owner_due_priority).toBe("unchanged");
    expect(h.clickup.writes().filter(c => c.method === "PUT" && c.body?.assignees)).toEqual([]);
  });

  it("a due day ClickUp moved to another day is a mismatch with a note, not a failure", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    const real = h.clickup.handle.bind(h.clickup);
    h.clickup.handle = async c => {
      const out = await real(c);
      if (c.method === "PUT" && c.body?.due_date) h.clickup.task(row.task_id!)!.due_date = String(Date.parse("2026-10-29T03:00:00Z"));
      return out;
    };
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.owner_due_priority).toMatchObject({ state: "mismatch", missing: ["due day"] });
    expect(row.error).toBe("ClickUp did not keep the due day as sent.");
  });
});

describe("a template whose snapshot has no checklist (WhatsApp connection)", () => {
  it("adds the source SOP steps as a checklist", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", whatsappPayload());
    await h.run();
    expect(row.steps).toEqual(["create", "description", "owner_due_priority", "checklist", "tag", "card_comment"]);
    const t = h.clickup.task(row.task_id!)!;
    expect(t.checklists).toHaveLength(1);
    expect(t.checklists[0].name).toBe("SOP steps");
    expect(t.checklists[0].items.map((i: any) => i.name)).toEqual(WHATSAPP_STEPS);
    expect(t.list.id).toBe(LISTS.cs);
    expect(t.assignees).toEqual([{ id: PEOPLE.csm }]);
    expect(t.priority).toMatchObject({ priority: "high" });
  });

  it("adds nothing when the template brings its own checklist", async () => {
    const h = harness(LIVE);
    h.clickup.templates["t-86ex62m1b"].checklists = [{ name: "Resolution checklist", items: ["Contact the client", "Share the QR link"] }];
    const row = h.db.enqueue("request", whatsappPayload());
    await h.run();
    expect(row.progress?.steps?.checklist).toMatchObject({ state: "skipped", why: "The template brought its own checklist." });
    expect(h.clickup.task(row.task_id!)!.checklists.map((c: any) => c.name)).toEqual(["Resolution checklist"]);
    expect(h.clickup.writes().some(c => c.path.endsWith("/checklist"))).toBe(false);
  });
});

describe("a request that routes an old ticket from All Tasks", () => {
  const oldTicket = (h: ReturnType<typeof harness>, over = {}) =>
    h.clickup.addTask({ id: "86old0001", name: "Form Submission - #1", listId: LISTS.allTasks, ...over });

  it("comments the new task's link on the old ticket and cancels it", async () => {
    const h = harness(LIVE);
    oldTicket(h);
    const row = h.db.enqueue("request", requestPayload({ replacesTaskId: "86old0001" }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.steps?.at(-1)).toBe("replaces");
    const url = h.clickup.task(row.task_id!)!.url;
    expect(h.clickup.comments.get("86old0001")!.map(c => c.comment_text)).toEqual([`Routed in the cockpit as General tech request: ${url}\n\n${MARKER}-old`]);
    expect(h.clickup.task("86old0001")!.status).toEqual({ status: "cancelled", type: "closed" });
    expect(steps(row).replaces).toBe("done");
  });

  it("an old ticket the team already moved, closed or deleted gets no new task: the part is skipped with its sentence (review R2)", async () => {
    for (const over of [{ listId: LISTS.cs }, { status: { status: "complete", type: "done" } }, { status: { status: "cancelled", type: "closed" } }, null]) {
      const h = harness(LIVE);
      if (over) oldTicket(h, over);
      const row = h.db.enqueue("request", requestPayload({ replacesTaskId: "86old0001" }));
      const out = await h.run();
      expect(row).toMatchObject({ state: "skipped", error: SAY.oldHandled, task_id: null });
      // The old ticket is read first, and nothing at all is written: no task, no card link, no comment.
      expect(h.clickup.calls[0]).toMatchObject({ method: "GET", path: "task/86old0001?include_markdown_description=true" });
      expect(h.clickup.writes()).toEqual([]);
      expect(h.clickup.comments.get("86old0001")).toBeUndefined();
      expect(out.note).toBe("0 requests delivered, 0 to retry, 0 failed. 1 skipped.");
    }
  });

  it("an old ticket moved or closed after this part's task was made is left, and the part says so", async () => {
    const h = harness(LIVE);
    oldTicket(h);
    // Someone closes the old ticket in ClickUp while the new task is being made.
    h.clickup.onCreate = () => (h.clickup.task("86old0001")!.status = { status: "complete", type: "done" });
    const row = h.db.enqueue("request", requestPayload({ replacesTaskId: "86old0001" }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.replaces).toMatchObject({ state: "skipped", why: SAY.oldGone });
    expect(row.error).toBe(SAY.oldMovedAfter);
    expect(h.clickup.comments.get("86old0001")).toBeUndefined();
  });

  it("an old ticket that will not close is a note, not a failure of the new one", async () => {
    const h = harness(LIVE);
    oldTicket(h);
    h.clickup.fail = c => (c.method === "PUT" && c.path === "task/86old0001" ? rejected(400, "Status does not exist") : undefined);
    const row = h.db.enqueue("request", requestPayload({ replacesTaskId: "86old0001" }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.error).toBe("The old ticket did not close in ClickUp. Close it there.");
  });

  // Review R2: the CEO, an editor or an admin may route old tickets while requests are held (contract 2.8).
  // The team keeps working the ClickUp form meanwhile, so a ticket may be handled there before requests open.
  const routedPause = () => {
    const [tech, media] = pausePayloads();
    return [{ ...tech, replacesTaskId: "86old0001" }, media];
  };

  it("held while requests were off, then handled in ClickUp: no part makes a task once requests open", async () => {
    const handledBy = [
      (old: any) => (old.list = { id: LISTS.tech, name: "Operations / Tech" }),
      (old: any) => (old.status = { status: "complete", type: "done" }),
    ];
    for (const handle of handledBy) {
      const env: Record<string, string> = { CLICKUP_API_TOKEN: "x" };
      const h = harness(env);
      const old = oldTicket(h);
      const [techP, mediaP] = routedPause();
      const tech = h.db.enqueue("request", techP);
      const media = h.db.enqueue("request", mediaP);
      for (let i = 0; i < 3; i++) {
        await h.run();
        h.advance(HOLD_MS);
      }
      expect([tech.state, media.state]).toEqual(["queued", "queued"]);
      expect(h.clickup.calls).toEqual([]);
      // The systems manager moves (or completes) the old ticket by hand, then the CEO switches requests on.
      handle(old);
      env.CLICKUP_WRITEBACK_APPLY_REQUESTS = "true";
      await h.run();
      expect([tech.state, media.state]).toEqual(["skipped", "skipped"]);
      expect([tech.error, media.error]).toEqual([SAY.oldHandled, SAY.oldHandled]);
      expect(h.clickup.writes()).toEqual([]);
      expect(h.db.parts.get(`${REQUEST_ID}:tech`)).toMatchObject({ state: "skipped", clickupTaskId: null });
    }
  });

  it("every part checks the old ticket: from the claim, or from the first part claimed in the same run", async () => {
    for (const withRoutes of [true, false]) {
      const h = harness(LIVE);
      h.db.withRoutes = withRoutes;
      oldTicket(h, { status: { status: "cancelled", type: "closed" } });
      const [techP, mediaP] = routedPause();
      // The second part is claimed first: the claim orders parts of one request by id, not by part.
      const media = h.db.enqueue("request", mediaP);
      const tech = h.db.enqueue("request", techP);
      await h.run();
      expect([tech.state, media.state]).toEqual(["skipped", "skipped"]);
      expect(h.clickup.writes()).toEqual([]);
    }
  });

  it("a part sent after the first part routed the old ticket still makes its task (the closing comment is this request's)", async () => {
    const h = harness(LIVE);
    oldTicket(h);
    const [techP, mediaP] = routedPause();
    const tech = h.db.enqueue("request", techP);
    const media = h.db.enqueue("request", mediaP);
    // The media part's create is rate limited once: it goes after the tech part cancelled the old ticket.
    let n = 0;
    h.clickup.fail = c => (c.method === "POST" && c.path.includes(`list/${LISTS.ads}/`) && n++ === 0 ? rejected(429, "Rate limit") : undefined);
    await h.run();
    expect(tech.state).toBe("delivered");
    expect(h.clickup.task("86old0001")!.status.type).toBe("closed");
    expect(media.state).toBe("retry");
    h.advance(60_000);
    await h.run();
    expect(media.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path.includes("/taskTemplate/")).map(c => c.path.split("/")[1])).toEqual([LISTS.tech, LISTS.ads, LISTS.ads]);
    expect([...h.clickup.tasks.values()].filter(t => t.name.startsWith("Acme Interiors - Client pause")).map(t => t.list.id).sort()).toEqual([LISTS.tech, LISTS.ads].sort());
  });

  it("a malformed old ticket id from the claim fails the part before any call", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    const claim = h.db.rpc;
    h.deps.rpc = async (name, params) => {
      const out = await claim(name, params);
      return name === "cockpit_clickup_writeback_claim_requests" ? out.map((r: any) => ({ ...r, replaces_task_id: "../x" })) : out;
    };
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: SAY.badPayload });
    expect(h.clickup.calls).toEqual([]);
  });
});

describe("Request Type, set last and only where it is switched on", () => {
  const options = (h: ReturnType<typeof harness>) => h.clickup.fields.find(f => f.id === RT_FIELD)!.type_config.options as any[];

  it("an option ClickUp renamed or removed never stops the request: the task is made and Request Type stays empty with a note (review R2)", async () => {
    const changes = [
      (h: ReturnType<typeof harness>) => (options(h).find(o => o.id === OPTION.generalTech).name = "General Tech Ticket"),
      (h: ReturnType<typeof harness>) => options(h).splice(options(h).findIndex(o => o.id === OPTION.generalTech), 1),
    ];
    for (const change of changes) {
      const h = harness(LIVE);
      change(h);
      const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
      const out = await h.run();
      expect(row).toMatchObject({ state: "delivered", error: SAY.renamed });
      expect(steps(row)).toMatchObject({ create: "done", request_type: "skipped", card_comment: "done" });
      expect(row.progress?.steps?.request_type?.why).toBe(SAY.renamed);
      expect(h.clickup.writes().some(c => c.path.endsWith(`/field/${RT_FIELD}`))).toBe(false);
      expect(h.clickup.task(row.task_id!)?.list.id).toBe(LISTS.tech);
      expect(out).toMatchObject({ ok: true, note: "1 request delivered, 0 to retry, 0 failed." });
    }
  });

  it("the switch turned off in Requests settings reaches a part filed while it was on, whatever the option says", async () => {
    for (const renamed of [false, true]) {
      const h = harness(LIVE);
      if (renamed) options(h).find(o => o.id === OPTION.generalTech).name = "General Tech Ticket";
      // The payload froze Request Type on; an editor has switched it off since (cockpit_request_type_save).
      h.db.doctorInputs = { types: [{ key: "general_tech", setRequestType: false }], templates: [], lists: {} };
      const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
      await h.run();
      expect(row).toMatchObject({ state: "delivered", error: SAY.rtTurnedOff });
      expect(steps(row).request_type).toBe("skipped");
      expect(h.clickup.writes().some(c => c.path.endsWith(`/field/${RT_FIELD}`))).toBe(false);
    }
  });

  it("a Request Type write whose answer was lost is found done, even if the switch went off before the next run", async () => {
    const h = harness(LIVE);
    let lost = false;
    h.clickup.lose = c => (!lost && c.path.endsWith(`/field/${RT_FIELD}`) ? (lost = true) : false);
    const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    await h.run();
    expect(row.state).toBe("unknown");
    h.db.doctorInputs = { types: [{ key: "general_tech", setRequestType: false }], templates: [], lists: {} };
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "delivered", error: null });
    expect(steps(row).request_type).toBe("done");
  });

  it("matches the option by its name with stray spaces collapsed, writes it after the fields and reads it back", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ setRequestType: true, fields: [{ fieldId: FIELD.notes, kind: "text", value: "Use the new form", label: "Notes" }] }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.steps).toEqual(["create", "checklist", "tag", "fields", "request_type", "card_comment"]);
    const order = h.clickup.writes().map(c => c.path.split("/").slice(2).join("/"));
    expect(order.indexOf(`field/${RT_FIELD}`)).toBeGreaterThan(order.indexOf(`field/${FIELD.notes}`));
    expect(h.clickup.writes().find(c => c.path.endsWith(RT_FIELD))?.body).toEqual({ value: OPTION.generalTech });
    // ClickUp answers a dropdown with its orderindex; that reads back as the option.
    expect(h.clickup.value(row.task_id!, RT_FIELD)).toBe(27);
    expect(steps(row).request_type).toBe("done");
    expect(normName("Connect a New Lead Form  🆕 ")).toBe("Connect a New Lead Form 🆕");
  });

  it("a Request Type someone else set stays, with a note", async () => {
    const h = harness(LIVE);
    h.clickup.onCreate = t => (t.custom_fields.find((f: any) => f.id === RT_FIELD).value = 13);
    const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(steps(row).request_type).toBe("mismatch");
    expect(row.error).toBe("Request Type in ClickUp already shows another type, so the cockpit left it.");
  });
});

describe("fields", () => {
  const fields = [
    { fieldId: FIELD.scriptType, kind: "select", value: "st-reel", label: "What are we writing", display: "Paid Ads Reel" },
    { fieldId: FIELD.scriptQuantity, kind: "number", value: 3, label: "How many scripts", display: "3" },
    { fieldId: FIELD.leadList, kind: "url", value: "https://docs.example.com/leads", label: "Lead list", display: "https://docs.example.com/leads" },
  ];
  it("writes each answered field and reads it back by option, number or text", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ fields }));
    await h.run();
    expect(row.progress?.steps?.fields).toMatchObject({ state: "done", fields: { [FIELD.scriptType]: "done", [FIELD.scriptQuantity]: "done", [FIELD.leadList]: "done" } });
    expect(h.clickup.value(row.task_id!, FIELD.scriptType)).toBe(0);
    expect(h.clickup.value(row.task_id!, FIELD.scriptQuantity)).toBe("3");
  });

  it("a field ClickUp refuses or does not keep is a mismatch named in the note, and the request is delivered", async () => {
    const h = harness(LIVE);
    h.clickup.refuse.add(FIELD.scriptQuantity);
    h.clickup.drop.add(FIELD.leadList);
    const row = h.db.enqueue("request", requestPayload({ fields }));
    const out = await h.run();
    expect(row.state).toBe("delivered");
    expect(out.ok).toBe(true);
    expect(row.progress?.steps?.fields).toMatchObject({ state: "mismatch", mismatched: ["How many scripts", "Lead list"] });
    expect(row.error).toBe("Some fields did not save in ClickUp: How many scripts, Lead list. They are in the description.");
    expect(row.progress?.note).toBe(row.error);
  });

  it("fieldMatches reads a dropdown by option id or orderindex and never matches an empty value", () => {
    const task = { custom_fields: [{ id: "f", type_config: { options: [{ id: "a", orderindex: 4 }] }, value: 4 }, { id: "g", value: null }] };
    expect(fieldMatches(task, "f", "select", "a")).toBe(true);
    expect(fieldMatches(task, "f", "select", "b")).toBe(false);
    expect(fieldMatches(task, "g", "text", "")).toBe(false);
    expect(fieldMatches({ custom_fields: [{ id: "n", value: "3" }] }, "n", "number", 3)).toBe(true);
  });
});

describe("resuming after a lost answer (contract 4.3, On resume)", () => {
  const loseOnce = (h: ReturnType<typeof harness>, match: (c: any) => boolean) => {
    let lost = false;
    h.clickup.lose = c => {
      if (!lost && match(c)) return (lost = true);
      return false;
    };
  };

  it("create: the next run finds the task by its Cockpit ref and never makes a second one", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path === `list/${LISTS.tech}/task` && c.method === "POST");
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    expect(row.error).toBe("Provider response is unknown. Reconcile before retrying.");
    expect(row.next_attempt_at).toBe(NOW + 60_000);
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path === `list/${LISTS.tech}/task`)).toHaveLength(1);
    expect(h.clickup.calls.some(c => c.method === "GET" && c.path.startsWith(`list/${LISTS.tech}/task?order_by=created&include_closed=true&date_created_gt=${NOW - 60_000}`))).toBe(true);
    expect([...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech)).toHaveLength(1);
  });

  it("create from a template: found by its exact name", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.includes("/taskTemplate/"));
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path.includes("/taskTemplate/"))).toHaveLength(1);
  });

  it("create: two matching tasks are never guessed between", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.includes("/taskTemplate/"));
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    h.clickup.addTask({ name: "Acme Interiors - Client pause (Tech)", listId: LISTS.tech, date_created: String(NOW) });
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: "Two tasks match this request in ClickUp. Keep one and cancel the other." });
    expect(h.clickup.writes().filter(c => c.path.includes("/taskTemplate/"))).toHaveLength(1);
  });

  it("create: nothing found waits five minutes, then creates again", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload());
    h.clickup.fail = c => (c.method === "POST" && c.path === `list/${LISTS.tech}/task` ? rejected(502, "Bad gateway") : undefined);
    await h.run();
    expect(row.state).toBe("unknown");
    h.clickup.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: SAY.waiting });
    h.advance(5 * 60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect([...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech)).toHaveLength(1);
  });

  it("create: a 429 never landed, so the next run creates without a search", async () => {
    const h = harness(LIVE);
    let n = 0;
    h.clickup.fail = c => (c.method === "POST" && c.path === `list/${LISTS.tech}/task` && n++ === 0 ? rejected(429, "Rate limit") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("retry");
    expect(row.progress?.steps?.create).toBeUndefined();
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.calls.some(c => c.path.includes("date_created_gt"))).toBe(false);
  });

  it("a new task ClickUp does not show at once is read again next run, never made twice", async () => {
    const h = harness(LIVE);
    let hidden = true;
    h.clickup.fail = c => (hidden && c.method === "GET" && /^task\/86new/.test(c.path) ? rejected(404, "Task not found") : undefined);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: SAY.notYet });
    expect(row.task_id).toMatch(/^86new/);
    hidden = false;
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path.includes("/taskTemplate/"))).toHaveLength(1);
  });

  it("a task this request made that ClickUp no longer has stops the part instead of making another", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.endsWith("/checklist"));
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    h.clickup.tasks.delete(row.task_id!);
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: SAY.gone });
    expect(h.clickup.writes().filter(c => c.path === `list/${LISTS.tech}/task`)).toHaveLength(1);
  });

  it("description: the marker already there means done, with no second write", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.method === "PUT" && c.body?.markdown_content);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.body?.markdown_content)).toHaveLength(1);
  });

  it("owner, due and priority: read first, write only what still differs", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.method === "PUT" && c.body?.assignees);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row.state).toBe("unknown");
    // Someone set a different priority in between: only that is written again.
    h.clickup.task(row.task_id!)!.priority = { id: "4", priority: "low" };
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    const puts = h.clickup.writes().filter(c => c.method === "PUT" && c.path === `task/${row.task_id}` && !c.body?.markdown_content);
    expect(puts.map(c => c.body)).toEqual([
      { assignees: { add: [PEOPLE.systemsManager], rem: [] }, due_date: pausePayloads()[0].dueMs, due_date_time: false, priority: 3 },
      { priority: 3 },
    ]);
  });

  it("checklist: adopts the checklist by its name and adds only the missing steps", async () => {
    const h = harness(LIVE);
    let items = 0;
    h.clickup.lose = c => c.path.endsWith("/checklist_item") && ++items === 3;
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    h.clickup.lose = undefined;
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    const t = h.clickup.task(row.task_id!)!;
    expect(t.checklists).toHaveLength(1);
    expect(t.checklists[0].items.map((i: any) => i.name)).toEqual(requestPayload().sopSteps);
    expect(h.clickup.writes().filter(c => c.path.endsWith("/checklist"))).toHaveLength(1);
    expect(h.clickup.writes().filter(c => c.path.endsWith("/checklist_item"))).toHaveLength(5);
  });

  it("checklist: a lost answer to the checklist itself is found by name", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.endsWith("/checklist"));
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.task(row.task_id!)!.checklists).toHaveLength(1);
  });

  it("card comment: pages back through a busy card and finds the marker, never posting twice", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path === `task/${CARD}/comment` && c.method === "POST");
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    // 30 newer comments land on the card before the next run: the marker is on the second page.
    h.clickup.addComments(CARD, 30, NOW + 90_000);
    h.advance(120_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.path === `task/${CARD}/comment`)).toHaveLength(1);
    expect(h.clickup.calls.some(c => c.path.startsWith(`task/${CARD}/comment?start=`))).toBe(true);
    expect(row.progress?.steps?.card_comment?.commentId).toBe(h.clickup.comments.get(CARD)!.find(c => c.comment_text.endsWith("-card"))!.id);
  });

  it("tag and fields: what already shows is done, with no second write", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.includes(`/field/${FIELD.leadList}`));
    const row = h.db.enqueue("request", requestPayload({ fields: [{ fieldId: FIELD.leadList, kind: "url", value: "https://docs.example.com/l", label: "Lead list" }] }));
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(steps(row)).toMatchObject({ tag: "done", fields: "done" });
    expect(h.clickup.writes().filter(c => c.path.includes("/field/"))).toHaveLength(1);
    expect(h.clickup.writes().filter(c => c.path.includes("/tag/"))).toHaveLength(1);
  });

  it("Request Type: a value that already shows is done, with no second write", async () => {
    const h = harness(LIVE);
    loseOnce(h, c => c.path.endsWith(`/field/${RT_FIELD}`));
    const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(steps(row).request_type).toBe("done");
    expect(h.clickup.writes().filter(c => c.path.endsWith(`/field/${RT_FIELD}`))).toHaveLength(1);
  });

  it("the old ticket: its comment is found by marker and a cancel that landed is not sent again", async () => {
    for (const lost of [(c: any) => c.method === "POST" && c.path === "task/86old0001/comment", (c: any) => c.method === "PUT" && c.path === "task/86old0001"]) {
      const h = harness(LIVE);
      h.clickup.addTask({ id: "86old0001", name: "Form Submission - #1", listId: LISTS.allTasks });
      loseOnce(h, lost);
      const row = h.db.enqueue("request", requestPayload({ replacesTaskId: "86old0001" }));
      await h.run();
      expect(row.state).toBe("unknown");
      h.advance(60_000);
      await h.run();
      expect(row.state).toBe("delivered");
      expect(steps(row).replaces).toBe("done");
      expect(h.clickup.comments.get("86old0001")).toHaveLength(1);
      expect(h.clickup.writes().filter(c => c.method === "PUT" && c.path === "task/86old0001")).toHaveLength(1);
      expect(h.clickup.task("86old0001")!.status.type).toBe("closed");
    }
  });

  it("gives up after the retry ladder when no task was made", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "POST" && c.path.endsWith("/task") ? rejected(429, "Rate limit") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    for (let i = 0; i < 6; i++) {
      await h.run();
      h.advance(240 * 60_000);
    }
    expect(row.state).toBe("failed");
    expect(row.attempts).toBe(6);
    expect(row.task_id).toBeNull();
  });

  it("after the ladder, a part whose task is in ClickUp is delivered with a plain note, never failed (RT-2)", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "GET" && c.path.startsWith("space/") ? rejected(503, "Down") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    for (let i = 0; i < 6; i++) {
      await h.run();
      h.advance(240 * 60_000);
    }
    expect(row.state).toBe("delivered");
    expect(row.error?.startsWith(SAY.unfinished)).toBe(true);
    expect(row.attempts).toBe(6);
    // One task, made once.
    expect(h.clickup.writes().filter(c => c.method === "POST" && c.path === `list/${LISTS.tech}/task`).length).toBe(1);
  });
});

describe("a call ClickUp answered that the cockpit could not record (review R2)", () => {
  // Through the real providerTools: its response receipt is saved, and its body read, after ClickUp answered.
  const DB_DOWN = () => new Error("Supabase 503: upstream connect error or disconnect/reset before headers");
  const TIMED_OUT = () => new DOMException("Signal timed out.", "TimeoutError");
  const once = <T,>(match: (x: T) => boolean) => {
    let done = false;
    return (x: T) => !done && match(x) && (done = true);
  };
  const failReceipt = (match: (row: any) => boolean, error: () => Error) => {
    const first = once<any>(row => row.phase === "response" && match(row));
    return (row: any) => (first(row) ? error() : undefined);
  };
  const isCreate = (r: any) => r.method === "POST" && (r.resource ?? r.path) === `list/${LISTS.tech}/task`;
  const techTasks = (h: ReturnType<typeof harness>) => [...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech);

  it("only ClickUp's own answer makes a refusal; any other error leaves the call in doubt", () => {
    expect(errorKind(rejected(400, "Value is not valid"))).toBe("refused");
    expect(errorKind(rejected(404))).toBe("refused");
    expect(errorKind(rejected(429, "Rate limit"))).toBe("retry");
    expect(errorKind(rejected(502, "Bad gateway"))).toBe("unknown");
    expect(errorKind(unknownError())).toBe("unknown");
    expect(errorKind(new Error("CLICKUP_API_TOKEN is not configured"))).toBe("config");
    // A read ClickUp answered without what it should hold is its answer too: no write is in doubt.
    expect(errorKind(new Error("ClickUp did not return the space's tags"))).toBe("refused");
    for (const e of [DB_DOWN(), TIMED_OUT(), new TypeError("terminated"), "socket hang up", new Error("Supabase 503: ClickUp did not return x")])
      expect(errorKind(e)).toBe("unknown");
  });

  it("a create that landed, whose receipt or answer was then lost, is found by its Cockpit ref next run: one task, never failed", async () => {
    const lost = [
      { receipt: failReceipt(isCreate, DB_DOWN) },
      { receipt: failReceipt(isCreate, TIMED_OUT) },
      { dropBody: once<any>(isCreate) },
    ];
    for (const opts of lost) {
      const h = toolsHarness(LIVE, opts);
      const row = h.db.enqueue("request", requestPayload());
      const out = await h.run();
      // Before review R2 this settled failed, task_id null: "Did not reach ClickUp", and "File it again" made a second task.
      expect(row).toMatchObject({ state: "unknown", task_id: null });
      expect(row.progress?.steps?.create?.state).toBe("started");
      expect(out.counts).toMatchObject({ unknown: 1, failed: 0 });
      expect(techTasks(h)).toHaveLength(1);
      h.advance(60_000);
      await h.run();
      expect(row).toMatchObject({ state: "delivered", error: null });
      expect(row.task_id).toBe(techTasks(h)[0].id);
      expect(techTasks(h)).toHaveLength(1);
      expect(h.clickup.writes().filter(isCreate)).toHaveLength(1);
    }
  });

  it("a tag, a field, Request Type or the old ticket's close that landed is read back, never noted as not saved", async () => {
    const cases: [string, (r: any) => boolean][] = [
      ["tag", r => r.method === "POST" && /^task\/[^/]+\/tag\//.test(r.resource)],
      ["fields", r => r.method === "POST" && r.resource.endsWith(`/field/${FIELD.leadList}`)],
      ["request_type", r => r.method === "POST" && r.resource.endsWith(`/field/${RT_FIELD}`)],
      ["replaces", r => r.method === "PUT" && r.resource === "task/86old0001"],
    ];
    for (const [step, match] of cases) {
      const h = toolsHarness(LIVE, { receipt: failReceipt(match, DB_DOWN) });
      h.clickup.addTask({ id: "86old0001", name: "Form Submission - #1", listId: LISTS.allTasks });
      const fields = [{ fieldId: FIELD.leadList, kind: "url", value: "https://docs.example.com/l", label: "Lead list" }];
      const row = h.db.enqueue("request", requestPayload({ setRequestType: true, replacesTaskId: "86old0001", fields }));
      await h.run();
      expect([step, row.state]).toEqual([step, "unknown"]);
      h.advance(60_000);
      await h.run();
      expect([step, row.state, row.error]).toEqual([step, "delivered", null]);
      expect(steps(row)[step]).toBe("done");
      expect(h.clickup.writes().filter(c => match({ ...c, resource: c.path.split("?")[0] }))).toHaveLength(1);
    }
  });

  it("the read that looks for a lost create waits when its own receipt cannot be saved, and never orphans the task", async () => {
    let readsFail = true;
    const h = toolsHarness(LIVE, {
      receipt: r => (readsFail && r.phase === "intent" && r.method === "GET" && r.resource === `list/${LISTS.tech}/task` ? DB_DOWN() : undefined),
    });
    h.clickup.lose = once<any>(isCreate);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("unknown");
    readsFail = false;
    h.advance(5 * 60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(techTasks(h)).toHaveLength(1);
  });
});

describe("review round 3: the create step never says nothing reached ClickUp while ClickUp may hold the task", () => {
  const TECH_TEMPLATE_PART = `${REQUEST_ID}:tech`;
  const loseFirst = (h: ReturnType<typeof harness>, match: (c: any) => boolean) => {
    let lost = false;
    h.clickup.lose = c => (!lost && match(c) ? (lost = true) : false);
  };
  const templateCreates = (h: ReturnType<typeof harness>) => h.clickup.writes().filter(c => c.path.includes("/taskTemplate/"));
  const techCreates = (h: ReturnType<typeof harness>) =>
    h.clickup.writes().filter(c => c.method === "POST" && (c.path === `list/${LISTS.tech}/task` || c.path.startsWith(`list/${LISTS.tech}/taskTemplate/`)));
  const cancelled = { status: "cancelled", type: "closed" };
  /** A template part whose create answer was lost, then a same-named task in the window: "Two tasks match". */
  const twoMatching = async () => {
    const h = harness(LIVE);
    loseFirst(h, c => c.path.includes("/taskTemplate/"));
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    const ours = [...h.clickup.tasks.values()].find(t => t.name === row.payload.taskName)!;
    const stray = h.clickup.addTask({ name: row.payload.taskName, listId: LISTS.tech, date_created: String(NOW) });
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: SAY.twoTasks, task_id: null });
    return { h, row, ours, stray };
  };

  it("two tasks match: once a person cancels one in ClickUp, as the error says, the next run adopts the one left open", async () => {
    for (const cancel of ["stray", "ours"] as const) {
      const { h, row, ours, stray } = await twoMatching();
      (cancel === "stray" ? stray : ours).status = cancelled;
      h.advance(5 * 60_000);
      await h.run();
      // Before review round 3 the cancelled task still matched (include_closed=true): unknown until the ladder ran out, then failed.
      expect(row).toMatchObject({ state: "delivered", task_id: (cancel === "stray" ? ours : stray).id });
      expect(templateCreates(h)).toHaveLength(1);
      expect(h.clickup.task(row.task_id!)!.text_content).toContain(`Cockpit ref R-${REF_HEX}-tech`);
    }
  });

  it("every matching task cancelled: nothing is adopted until a person reopens the one to keep", async () => {
    const { h, row, ours, stray } = await twoMatching();
    ours.status = cancelled;
    stray.status = cancelled;
    h.advance(5 * 60_000);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: SAY.allCancelled, task_id: null });
    ours.status = { status: "to do", type: "open" };
    h.advance(15 * 60_000);
    await h.run();
    expect(row).toMatchObject({ state: "delivered", task_id: ours.id });
    expect(templateCreates(h)).toHaveLength(1);
  });

  it("at the end of the ladder a create still in doubt stays unknown, read every 4 hours, never failed", async () => {
    const { h, row, ours, stray } = await twoMatching();
    for (let i = 0; i < 4; i++) {
      h.advance(240 * 60_000);
      await h.run();
    }
    expect(row.attempts).toBe(6);
    // Before review round 3: failed, "Did not reach ClickUp", and the panel offered File it again, which made a third task.
    expect(row).toMatchObject({ state: "unknown", error: `${SAY.twoTasks} ${STILL_CHECKING}`, task_id: null });
    expect(row.next_attempt_at).toBe(h.clock.t + DOUBT_MINUTES * 60_000);
    expect(h.db.parts.get(TECH_TEMPLATE_PART)).toMatchObject({ state: "unknown" });
    stray.status = cancelled;
    h.advance(DOUBT_MINUTES * 60_000);
    await h.run();
    expect(row).toMatchObject({ state: "delivered", task_id: ours.id, error: null });
    expect(templateCreates(h)).toHaveLength(1);
  });

  it("a create whose every answer was a 5xx stays unknown after the ladder, then is made once ClickUp answers", async () => {
    const h = harness(LIVE);
    let down = true;
    h.clickup.fail = c => (down && c.method === "POST" && c.path === `list/${LISTS.tech}/task` ? rejected(502, "Bad gateway") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    for (let i = 0; i < 6; i++) {
      await h.run();
      h.advance(240 * 60_000);
    }
    expect(row.attempts).toBe(6);
    expect(row).toMatchObject({ state: "unknown", task_id: null });
    expect(row.error).toBe(`clickup rejected the request (502): Bad gateway ${STILL_CHECKING}`);
    down = false;
    await h.run();
    expect(row.state).toBe("delivered");
    expect([...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech)).toHaveLength(1);
  });

  it("ClickUp refusing the search for a create in doubt leaves the part to search again, never failed", async () => {
    const h = harness(LIVE);
    let posted = false;
    let searchRefused = true;
    h.clickup.fail = c => {
      if (!posted && c.method === "POST" && c.path === `list/${LISTS.tech}/task`) return (posted = true), rejected(502, "Bad gateway");
      if (searchRefused && c.method === "GET" && c.path.startsWith(`list/${LISTS.tech}/task?`)) return rejected(403, "Team not authorized");
      return undefined;
    };
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    // Before review round 3: failed with task_id null, "Did not reach ClickUp", although the first create may have landed.
    expect(row.state).toBe("unknown");
    expect(row.error).toBe(`${SAY.searchRefused} ClickUp said: clickup rejected the request (403): Team not authorized`);
    searchRefused = false;
    h.advance(5 * 60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect([...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech)).toHaveLength(1);
  });

  it("a task ClickUp answered the create with but shows late is read again, never called gone a minute later", async () => {
    const h = harness(LIVE);
    const showsAt = NOW + 3 * 60_000;
    h.clickup.fail = c => (h.clock.t < showsAt && c.method === "GET" && /^task\/86new/.test(c.path) ? rejected(404, "Task not found") : undefined);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: SAY.notYet });
    h.advance(60_000);
    await h.run();
    // Before review round 3 this second 404 was "gone": failed with task_id kept, so cancel was refused and filing it again made a second task.
    expect(row).toMatchObject({ state: "unknown", error: SAY.notYet });
    h.advance(5 * 60_000);
    await h.run();
    expect(row).toMatchObject({ state: "delivered", error: null });
    expect(steps(row)).toMatchObject({ create: "done", description: "done", owner_due_priority: "done" });
    expect(templateCreates(h)).toHaveLength(1);
  });

  it("a task ClickUp answered with and still does not show 30 minutes after the create is gone", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "GET" && /^task\/86new/.test(c.path) ? rejected(404, "Task not found") : undefined);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    for (const wait of [0, 1, 5, 15]) {
      h.advance(wait * 60_000);
      await h.run();
      expect([wait, row.state, row.error]).toEqual([wait, "unknown", SAY.notYet]);
    }
    h.advance(60 * 60_000);
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: SAY.gone });
    expect(templateCreates(h)).toHaveLength(1);
  });

  it("a task ClickUp answered with whose read-back keeps failing is delivered with a note at the end of the ladder, never failed (RT-2)", async () => {
    for (const payload of [pausePayloads()[0], requestPayload()]) {
      const h = harness(LIVE);
      h.clickup.fail = c => (c.method === "GET" && /^task\/86new/.test(c.path) ? rejected(503, "Down") : undefined);
      const row = h.db.enqueue("request", payload);
      for (let i = 0; i < 6; i++) {
        await h.run();
        h.advance(240 * 60_000);
      }
      expect(row.attempts).toBe(6);
      // Before review round 3: failed with the task's id and link, "Did not reach ClickUp", and File it again made a second task.
      expect(row).toMatchObject({ state: "delivered", error: `${SAY.unfinished} clickup rejected the request (503): Down` });
      expect(row.task_id).toMatch(/^86new/);
      expect(h.db.parts.get(`${REQUEST_ID}:${payload.part}`)).toMatchObject({ state: "delivered", clickupTaskId: row.task_id });
      expect(techCreates(h)).toHaveLength(1);
    }
  });

  it("a task ClickUp made and then refused to show (a 4xx on its read) is delivered with a note, never failed (RT-2)", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "GET" && /^task\/86new[^/]*\?/.test(c.path) ? rejected(403, "Team not authorized") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.task_id).toMatch(/^86new/);
    expect(row.progress?.steps?.create).toMatchObject({ state: "mismatch", id: row.task_id });
    expect(String(row.progress?.steps?.create?.refused)).toContain("(403)");
    expect(row.error).toContain(STEP_REFUSED.create);
    // The card still links the task: that step reads only the card.
    expect(steps(row).card_comment).toBe("done");
    expect(techCreates(h)).toHaveLength(1);
  });

  it("the note of a part delivered at the end of the ladder promises no next run", async () => {
    expect(finalWords(SAY.descriptionLost)).toBe("The task description did not read back with its Cockpit ref.");
    expect(finalWords(`${SAY.bookkeeping} Supabase 503: upstream`)).toBe("Supabase 503: upstream");
    expect(finalWords("clickup rejected the request (503): Down")).toBe("clickup rejected the request (503): Down");
    expect(finalWords(undefined)).toBe("");
    const h = harness(LIVE);
    // ClickUp answers every description write and never keeps it.
    const handle = h.clickup.handle.bind(h.clickup);
    h.clickup.handle = async c => {
      if (c.method !== "PUT" || c.body?.markdown_content === undefined) return handle(c);
      h.clickup.calls.push(structuredClone(c));
      return {};
    };
    const row = h.db.enqueue("request", pausePayloads()[0]);
    for (let i = 0; i < 6; i++) {
      await h.run();
      h.advance(240 * 60_000);
    }
    expect(row).toMatchObject({ state: "delivered", error: `${SAY.unfinished} The task description did not read back with its Cockpit ref.` });
  });
});

describe("review round 3: a part's Cockpit ref is a whole token, so a sibling part's task is never taken", () => {
  const TECH = "Acme Interiors - General tech request";
  const TECH_TWO = "Acme Interiors - General tech request (second Tech task)";
  /** Two parts of one request on Operations / Tech, as the type editor names a second task on a board: tech and tech_two. */
  const siblings = (tech: Record<string, unknown> = {}) => [requestPayload({ part: "tech", taskName: TECH, ...tech }), requestPayload({ part: "tech_two", taskName: TECH_TWO })];
  const techTasks = (h: ReturnType<typeof harness>) => [...h.clickup.tasks.values()].filter(t => t.list.id === LISTS.tech);

  it("matches the ref as a whole token, never a longer ref, its markdown-escaped form or a comment marker", () => {
    const m = `Cockpit ref R-${REF_HEX}-tech`;
    for (const text of [m, `The details.\n\n${m}`, `${m}\nmore`, `${m}.`, `${m} and more`]) expect([text, holdsMarker(text, m)]).toEqual([text, true]);
    for (const text of [`${m}_two`, `${m}\\_two`, `${m}-card`, `${m}-old`, `${m}x`, `${m}2`, `Cockpit ref R-${REF_HEX}-tec`, ""]) expect([text, holdsMarker(text, m)]).toEqual([text, false]);
    expect(holdsMarker(null, m)).toBe(false);
  });

  it("a create that never landed waits and makes its own task, never adopting the sibling part's", async () => {
    const h = harness(LIVE);
    let refused = false;
    h.clickup.fail = c => (!refused && c.method === "POST" && c.path === `list/${LISTS.tech}/task` && c.body?.name === TECH ? ((refused = true), rejected(502, "Bad gateway")) : undefined);
    const [tech, two] = siblings().map(p => h.db.enqueue("request", p));
    await h.run();
    expect(tech.state).toBe("unknown");
    expect(two.state).toBe("delivered");
    h.advance(60_000);
    await h.run();
    // Before review round 3 "...-tech" matched inside "...-tech_two": tech adopted tech_two's task and ran its steps on it.
    expect(tech).toMatchObject({ state: "unknown", error: SAY.waiting });
    h.advance(5 * 60_000);
    await h.run();
    expect(tech.state).toBe("delivered");
    expect(tech.task_id).not.toBe(two.task_id);
    expect(techTasks(h)).toHaveLength(2);
    expect(h.clickup.task(two.task_id!)!.checklists).toHaveLength(1);
    expect(h.clickup.comments.get(CARD)!.filter(c => c.comment_text.includes(`/t/${two.task_id}`))).toHaveLength(1);
  });

  it("a create that landed and lost its answer adopts its own task, never stopping on Two tasks match", async () => {
    const h = harness(LIVE);
    let lost = false;
    h.clickup.lose = c => (!lost && c.method === "POST" && c.path === `list/${LISTS.tech}/task` && c.body?.name === TECH ? (lost = true) : false);
    const [tech, two] = siblings().map(p => h.db.enqueue("request", p));
    await h.run();
    expect(tech.state).toBe("unknown");
    h.advance(60_000);
    await h.run();
    expect(tech).toMatchObject({ state: "delivered", error: null });
    expect(h.clickup.task(tech.task_id!)!.name).toBe(TECH);
    expect(tech.task_id).not.toBe(two.task_id);
    expect(techTasks(h)).toHaveLength(2);
  });

  it("a template part that lost its answer adopts its own task by name, never the sibling's by its longer ref", async () => {
    const h = harness(LIVE);
    let lost = false;
    h.clickup.lose = c => (!lost && c.path.includes("/taskTemplate/") ? (lost = true) : false);
    const tech = h.db.enqueue("request", siblings({ templateId: "t-86ex63qk5", templateName: "Client Pause ⏸️ (Tech)", sopSteps: null, sopChecklistName: null })[0]);
    const two = h.db.enqueue("request", siblings()[1]);
    await h.run();
    const own = techTasks(h).find(t => t.name === TECH)!;
    expect(two.state).toBe("delivered");
    h.advance(60_000);
    await h.run();
    // Before review round 3 tech adopted tech_two's task by the longer ref and left its own template task with no part.
    expect(tech).toMatchObject({ state: "delivered", task_id: own.id });
    expect(h.clickup.comments.get(CARD)!.filter(c => c.comment_text.includes(`/t/${two.task_id}`))).toHaveLength(1);
    expect(h.clickup.comments.get(CARD)!.filter(c => c.comment_text.includes(`/t/${own.id}`))).toHaveLength(1);
  });

  it("a task holding this part's own ref that another queue row holds is never adopted", async () => {
    const h = harness(LIVE);
    let lost = false;
    h.clickup.lose = c => (!lost && c.method === "POST" && c.path === `list/${LISTS.tech}/task` ? (lost = true) : false);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    const mine = techTasks(h)[0];
    // A copy carrying the same ref (ClickUp's duplicate keeps the description), and another queue row holds it.
    const copy = h.clickup.addTask({ name: mine.name, listId: LISTS.tech, date_created: String(NOW + 1), markdown_description: mine.markdown_description, text_content: mine.text_content, description: mine.description });
    h.db.enqueue("request", { ...requestPayload(), requestId: "2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-2b2b3c4d5e-main" }, { state: "unknown", task_id: copy.id, next_attempt_at: NOW + 3_600_000 });
    h.advance(60_000);
    await h.run();
    // Before review round 3 the owners read covered only template name matches: two ref matches stopped it as Two tasks match.
    expect(row).toMatchObject({ state: "delivered", task_id: mine.id });
  });

  it("the description step never takes a sibling part's longer ref for its own", async () => {
    const h = harness(LIVE);
    const [tech] = pausePayloads();
    const sibling = `Template text\n\nCockpit ref R-${REF_HEX}-tech_two`;
    const t = h.clickup.addTask({ name: tech.taskName, listId: LISTS.tech, markdown_description: sibling, text_content: sibling, description: sibling });
    const at = new Date(NOW).toISOString();
    const row = h.db.enqueue("request", tech, { task_id: t.id, progress: { task: { id: t.id, url: t.url }, steps: { create: { state: "done", id: t.id, at } } } });
    await h.run();
    expect(row.state).toBe("delivered");
    // Before review round 3 the substring test read "...-tech" inside "...-tech_two" and marked the step done with no write.
    expect(h.clickup.writes().filter(c => c.body?.markdown_content)).toHaveLength(1);
    expect(holdsMarker(h.clickup.task(t.id)!.text_content, `Cockpit ref R-${REF_HEX}-tech`)).toBe(true);
  });
});

describe("the due day reads by Kuwait day, never the millisecond", () => {
  it("06:00 Kuwait and 12:00 Kuwait are the same day; midnight in Kuwait starts the next", () => {
    expect(noonKuwait("2026-10-28")).toBe(Date.parse("2026-10-28T09:00:00Z"));
    expect(kuwaitDay(Date.parse("2026-10-28T03:00:00Z"))).toBe("2026-10-28");
    expect(kuwaitDay(String(Date.parse("2026-10-28T20:59:00Z")))).toBe("2026-10-28");
    expect(kuwaitDay(Date.parse("2026-10-28T21:00:00Z"))).toBe("2026-10-29");
    expect(kuwaitDay(null)).toBeNull();
  });
});

describe("the canary card", () => {
  it("writes requests for the listed card only and says so", async () => {
    const h = harness({ ...LIVE, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD });
    const canary = h.db.enqueue("request", requestPayload({ clientTaskId: TEST_CARD, clientName: "Test client", clientTag: "test client" }));
    const other = h.db.enqueue("request", requestPayload({ requestId: "2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-2b2b3c4d5e-main" }));
    const out = await h.run();
    expect([canary.state, other.state]).toEqual(["delivered", "queued"]);
    expect(other.error).toBe(WAITING.apply_limited);
    expect(out).toMatchObject({ ok: true, mode: "apply_limited", note: "Testing on the canary card: 1 delivered, 1 held as a dry run (waiting in the queue)." });
    expect(h.db.lastState()).toMatchObject({ p_mode: "apply_limited", p_only_cards: [TEST_CARD] });
    expect(h.clickup.writes().every(c => !c.path.includes(CARD))).toBe(true);
  });
});

describe("review round 3: during the canary a routing request goes only when its old ticket's card is a canary card", () => {
  const CANARY = { ...LIVE, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD };
  const onTestCard = (requestId: string, hex: string, replacesTaskId: string) =>
    requestPayload({ requestId, ref: `R-${hex}-main`, clientTaskId: TEST_CARD, clientName: "Test client", clientTag: "test client", replacesTaskId });

  it("the run right after a switch flip (claimed by the old mode) holds one whose old ticket has no card or another card; one on the test card goes", async () => {
    const env: Record<string, string | undefined> = { ...CANARY };
    const h = harness(env);
    for (const id of ["86old0001", "86old0002", "86old0003"]) h.clickup.addTask({ id, name: `Form Submission - ${id}`, listId: LISTS.allTasks });
    h.db.imports.set("86old0001", null);
    h.db.imports.set("86old0002", CARD);
    h.db.imports.set("86old0003", TEST_CARD);
    const noCard = h.db.enqueue("request", onTestCard("3c3c3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "3c3c3c4d5e", "86old0001"));
    const realCard = h.db.enqueue("request", onTestCard("4d4d3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "4d4d3c4d5e", "86old0002"));
    const testCard = h.db.enqueue("request", onTestCard("5e5e3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "5e5e3c4d5e", "86old0003"));
    await h.run();
    expect([noCard.state, realCard.state, testCard.state]).toEqual(["queued", "queued", "delivered"]);
    expect([noCard.error, realCard.error]).toEqual([WAITING.apply_limited, WAITING.apply_limited]);
    expect([noCard.attempts, realCard.attempts]).toEqual([0, 0]);
    // Neither held ticket was read or touched; the test card's own ticket was routed and closed.
    for (const id of ["86old0001", "86old0002"]) {
      expect(h.clickup.calls.some(c => c.path.startsWith(`task/${id}`))).toBe(false);
      expect(h.clickup.task(id)!.status).toEqual({ status: "to do", type: "open" });
    }
    expect(h.clickup.task("86old0003")!.status).toEqual({ status: "cancelled", type: "closed" });
    // Requests open to every card: the held two go on the next run.
    env.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS = undefined;
    h.advance(HOLD_MS);
    await h.run();
    expect([noCard.state, realCard.state]).toEqual(["delivered", "delivered"]);
  });

  it("a database that does not name the old ticket's card holds every routing request during the canary, the safe side", async () => {
    const h = harness(CANARY);
    h.clickup.addTask({ id: "86old0003", name: "Form Submission - 86old0003", listId: LISTS.allTasks });
    h.db.imports.set("86old0003", TEST_CARD);
    h.db.withRoutes = false;
    const row = h.db.enqueue("request", onTestCard("6f6f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "6f6f3c4d5e", "86old0003"));
    await h.run();
    expect(row).toMatchObject({ state: "queued", error: WAITING.apply_limited });
    expect(h.clickup.calls).toEqual([]);
  });

  it("the claim by the reported mode never takes such a request at all (the database's half, as the fake mirrors it)", async () => {
    const h = harness(CANARY);
    h.db.claimMode = { mode: "apply_limited", onlyCards: [TEST_CARD] };
    h.db.imports.set("86old0001", null);
    const row = h.db.enqueue("request", onTestCard("7a7a3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "7a7a3c4d5e", "86old0001"));
    const out = await h.run();
    expect(out.note).toBe("Nothing to write.");
    expect(row).toMatchObject({ state: "queued", attempts: 0 });
  });
});

describe("review round 3: a create in doubt handed back while requests are not open stays unknown", () => {
  it("a part whose create went out with no task the cockpit holds goes back unknown, never queued or retry, and nothing is called", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "x" });
    const startedAt = new Date(NOW - 10 * 60_000).toISOString();
    const inDoubt = h.db.enqueue("request", requestPayload(), {
      state: "retry",
      attempts: 2,
      progress: { steps: { create: { state: "started", at: startedAt, startedAt } } },
      error: SAY.waiting,
    });
    const fresh = h.db.enqueue("request", requestPayload({ requestId: "8b8b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-8b8b3c4d5e-main" }));
    await h.run();
    expect(inDoubt).toMatchObject({ state: "unknown", attempts: 2, error: WAITING.dry_run });
    expect(h.db.parts.get(`${REQUEST_ID}:main`)?.state).toBe("unknown");
    expect(fresh).toMatchObject({ state: "queued", attempts: 0 });
    expect(h.clickup.calls).toEqual([]);
  });
});

describe("the requests doctor (contract 4.5)", () => {
  const inputs = (over: any = {}) => ({
    types: [
      {
        key: "client_pause",
        optionId: OPTION.pause,
        optionName: "Client Pause Request ⏸️",
        setRequestType: false,
        targets: [
          { part: "tech", listId: LISTS.tech, templateId: "t-86ex63qk5", ownerClickupId: PEOPLE.systemsManager },
          { part: "media", listId: LISTS.ads, templateId: "t-86ex63qm7", ownerClickupId: null },
        ],
        fieldIds: [],
      },
      { key: "general_tech", optionId: OPTION.generalTech, optionName: "General Tech Request", setRequestType: true, targets: [{ part: "main", listId: LISTS.tech, templateId: null, ownerClickupId: PEOPLE.systemsManager }], fieldIds: [FIELD.notes] },
      ...(over.types ?? []),
    ],
    templates: [],
    lists: {},
  });

  it("says ready when every template, option, field, owner and done status is there", async () => {
    const h = harness({ ...LIVE, CRON_SECRET: "s" });
    h.db.doctorInputs = inputs();
    const out = await runRequestsDoctor(h.deps);
    expect(out).toMatchObject({ ok: true, problems: [], mode: "apply" });
    expect(out.note).toBe("Ready. Requests and task changes: apply. 2 request types and 3 targets checked against ClickUp.");
    expect(h.clickup.writes()).toEqual([]);
    expect(h.db.syncState.get("clickup-writeback:requests-doctor")).toMatchObject({ ok: true, note: out.note, detail: { mode: "apply", problems: [] } });
  });

  it("names a missing template, a renamed option, a missing field, an owner who left and a list with no done status", async () => {
    const h = harness({ ...LIVE, CRON_SECRET: "s" });
    h.db.doctorInputs = inputs({
      types: [
        { key: "gone_bits", optionId: "00000000-0000-4000-8000-000000000000", optionName: "Gone", setRequestType: true, targets: [{ part: "main", listId: LISTS.callCenter, templateId: "t-86gone0001", ownerClickupId: 123 }], fieldIds: ["ffffffff-0000-4000-8000-000000000000"] },
      ],
    });
    // Renamed in ClickUp: general_tech sets Request Type, so it is named; client_pause has it switched off, so it is not (review R2).
    h.clickup.fields.find(f => f.id === RT_FIELD)!.type_config.options.find((o: any) => o.id === OPTION.generalTech).name = "General Tech Ticket";
    h.clickup.fields.find(f => f.id === RT_FIELD)!.type_config.options.find((o: any) => o.id === OPTION.pause).name = "Client Pause ⏸️";
    h.clickup.statuses.set(LISTS.callCenter, [{ status: "to do", type: "open" }, { status: "cancelled", type: "closed" }]);
    const out = await runRequestsDoctor(h.deps);
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual([
      'general_tech: ClickUp renamed its Request Type option to "General Tech Ticket", so its requests leave Request Type empty. Rename it back in ClickUp, or turn Set Request Type off for this type in Requests settings.',
      "gone_bits: its Request Type option is not in ClickUp any more, so its requests leave Request Type empty. Turn Set Request Type off for this type in Requests settings.",
      "gone_bits: the field ffffffff-0000-4000-8000-000000000000 is not on the Operations / Tech list in ClickUp.",
      "gone_bits: the template t-86gone0001 for the main part is not in ClickUp any more. Pick another in Requests settings.",
      "gone_bits: the named owner of the main part (ClickUp user 123) is not in the workspace. Pick someone else in Requests settings.",
      "Call Center has no status of type done in ClickUp, so Mark done cannot work there.",
    ]);
    expect(out.note.startsWith("6 problems. Requests and task changes: apply.")).toBe(true);
    expect(h.db.syncState.get("clickup-writeback:requests-doctor")).toMatchObject({ ok: false });
    expect(h.db.syncState.get("clickup-writeback:requests-doctor")).not.toHaveProperty("last_ok_at");
  });

  it("reads only, and reports secrets by name, never their values", async () => {
    const h = harness({ CLICKUP_API_TOKEN: "pk_secret_value", CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD });
    h.db.doctorInputs = inputs();
    const out = await runRequestsDoctor(h.deps);
    expect(out.secrets).toEqual({ CLICKUP_API_TOKEN: true, CRON_SECRET: false, CLICKUP_WRITEBACK_APPLY_REQUESTS: false, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: true });
    expect(JSON.stringify(out)).not.toContain("pk_secret_value");
    expect(out.mode).toBe("dry_run");
    expect(out.problems).toEqual(["CRON_SECRET is not set on this Edge Function, so the cron cannot start a requests run."]);
    expect(h.clickup.calls.every(c => c.method === "GET")).toBe(true);
  });

  it("without the token it reads nothing from ClickUp", async () => {
    const h = harness({ CRON_SECRET: "s" });
    const out = await runRequestsDoctor(h.deps);
    expect(out.problems).toEqual([SAY.noToken]);
    expect(h.clickup.calls).toEqual([]);
  });

  it("doctorChecks says when no request types came back", async () => {
    const h = harness(LIVE);
    const out = await doctorChecks({ types: [] }, h.clickup.provider("x"));
    expect(out.problems[0]).toBe("No request types came back from the database. Apply migrations 20261026r and 20261026s first.");
  });
});

describe("the unit pieces", () => {
  it("freezes only the steps a payload needs, in the contract's order", () => {
    expect(requestStepKeys(requestPayload())).toEqual(["create", "checklist", "tag", "card_comment"]);
    expect(requestStepKeys(whatsappPayload({ setRequestType: true, replacesTaskId: "86old0001", fields: [{ fieldId: "f" }] }))).toEqual([
      "create", "description", "owner_due_priority", "checklist", "tag", "fields", "request_type", "card_comment", "replaces",
    ]);
  });
  it("the card link names the requester by role", () => {
    expect(cardCommentText(requestPayload({ requesterLabel: "the media buyer", listName: "Call Center", typeLabel: "Low show rate" }), "https://app.clickup.com/t/x1")).toBe(
      `Cockpit · The media buyer asked Call Center: Low show rate\nhttps://app.clickup.com/t/x1\n\n${MARKER}-card`,
    );
  });
  it("executeRequest records progress through its own save and returns the task id", async () => {
    const h = harness(LIVE);
    const saved: any[] = [];
    const out = await executeRequest(
      { id: "q1", kind: "request", payload: requestPayload({ clientTaskId: null, clientName: null, clientTag: null }), attempts: 1, created_at: new Date(NOW).toISOString() },
      h.clickup.provider("q1"),
      async patch => {
        saved.push(structuredClone(patch));
      },
      runContext(h.clickup.provider("run"), () => NOW, h.db.rpc),
    );
    expect(out.state).toBe("delivered");
    expect(out.taskId).toBe(saved.find(s => s.task_id)?.task_id);
    expect(saved.every(s => Object.keys(s).every(k => ["progress", "task_id"].includes(k)))).toBe(true);
  });
  it("a write whose answer is unknown is never retried blind", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "POST" && c.path.endsWith("/checklist") ? unknownError() : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    expect(row.progress?.steps?.checklist?.state).toBe("started");
  });
});

describe("the database the writer calls (migration 20261026r)", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const SQL = read("../../migrations/20261026r_requests.sql");
  const CALLERS = ["./requests.ts", "./taskActions.ts"].map(read).join("\n");

  it("defines every RPC the requests job calls, and grants each to the service role only", () => {
    const called = [...new Set([...CALLERS.matchAll(/rpc\(\s*"(\w+)"/g)].map(m => m[1]))].sort();
    // Asked of migration r by review R1 (RT-1, RT-3); each has a fallback the tests drive with it absent.
    const PENDING = ["cockpit_clickup_writeback_release", "cockpit_clickup_writeback_task_owners"];
    expect(called).toEqual([
      "cockpit_clickup_requests_state",
      "cockpit_clickup_writeback_claim_requests",
      "cockpit_clickup_writeback_release",
      "cockpit_clickup_writeback_task_owners",
      "cockpit_request_doctor_inputs",
      "cockpit_request_sweep",
      "cockpit_request_type_rt_off",
    ]);
    const serviceBlock = /The writer's and the task mirror's RPCs[\s\S]*?LOOP([\s\S]*?)END LOOP;/.exec(SQL)?.[0] ?? "";
    expect(serviceBlock).toContain("GRANT EXECUTE ON FUNCTION public.%s TO service_role");
    for (const name of called) {
      if (PENDING.includes(name) && !SQL.includes(`FUNCTION public.${name}(`)) continue;
      expect(SQL).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(serviceBlock).toContain(`'${name}(`);
    }
    // The run rows: begin and idle take the requests job.
    expect(/p_job NOT IN\('kpi','log','dosdonts','requests'\)/.test(SQL)).toBe(true);
  });

  it("the payload keys the writer reads are the ones the plan freezes and the sync trigger copies", () => {
    const plan = /FUNCTION public\.cockpit_request_plan\([\s\S]*?END \$\$;/.exec(SQL)?.[0] ?? "";
    const trigger = /FUNCTION public\.cockpit_request_queue_sync\(\)[\s\S]*?END \$\$;/.exec(SQL)?.[0] ?? "";
    const writerReads = [...new Set([...CALLERS.matchAll(/\bp\.(\w+)/g)].map(m => m[1]))].filter(k => !["op", "actor", "requesterOfTask", "actionId", "checklistId", "itemId", "itemName", "from", "to", "text", "statusSeen"].includes(k));
    for (const key of writerReads) expect([key, plan.includes(`'${key}'`) || trigger.includes(`'${key}'`)]).toEqual([key, true]);
    for (const key of ["op", "requestId", "part", "taskId", "listId", "taskName", "ownerClickupId", "typeKey", "setRequestType", "clientTaskId"])
      expect(trigger).toContain(`'${key}'`);
    // The progress keys the trigger reads are the ones the writer saves.
    expect(trigger).toContain("NEW.progress->'task'->>'url'");
    expect(trigger).toContain("NEW.progress->>'verify'");
    expect(trigger).toContain("NEW.progress->>'verifyNote'");
  });
});
