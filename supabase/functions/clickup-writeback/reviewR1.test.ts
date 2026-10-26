// Review R1 (docs/requests/REVIEW-R1-raw.txt): one test per writer finding
// that would have caught it. RT-1 the switch never settles a row, RT-2 a step
// refused after the task exists never fails the part, RT-3 a template resume
// never adopts another part's task, RT-5 Request Type turned off reaches parts
// still queued, F14 every template part reads its checklist back.

import { describe, expect, it } from "bun:test";
import { SAY, STEP_REFUSED } from "./requests";
import { HOLD_MS, triesOf, WAITING } from "./run";
import { CARD, harness, LISTS, LIVE, NOW, OPTION, pausePayloads, PEOPLE, rejected, REQUEST_ID, requestPayload, RT_FIELD, whatsappPayload } from "./requestsTestkit";

const steps = (row: { progress: any }) => Object.fromEntries(Object.entries(row.progress?.steps ?? {}).map(([k, v]: [string, any]) => [k, v.state]));
const creates = (h: ReturnType<typeof harness>, listId: string = LISTS.tech) =>
  h.clickup.writes().filter(c => c.method === "POST" && (c.path === `list/${listId}/task` || c.path.startsWith(`list/${listId}/taskTemplate/`)));

describe("RT-1: the switch off, or narrowed to the canary, never settles a row", () => {
  it("a row that already wrote to ClickUp stays retryable while the switch is off, then finishes once on", async () => {
    const env: Record<string, string> = { ...LIVE };
    const h = harness(env);
    // The task is made, then the tag read breaks: the part waits with ClickUp progress.
    h.clickup.fail = c => (c.method === "GET" && c.path.startsWith("space/") ? rejected(503, "Down") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("unknown");
    const taskId = row.task_id!;
    expect(taskId).toBeTruthy();
    h.clickup.fail = undefined;
    // The switch goes off.
    delete env.CLICKUP_WRITEBACK_APPLY_REQUESTS;
    h.advance(60_000);
    const calls = h.clickup.calls.length;
    const dry = await h.run();
    expect(dry.mode).toBe("dry_run");
    expect(h.clickup.calls.length).toBe(calls);
    expect(row.state).not.toBe("dry_run");
    expect(row).toMatchObject({ state: "retry", task_id: taskId, error: WAITING.dry_run, attempts: 1 });
    expect(row.progress?.task?.id).toBe(taskId);
    expect(row.next_attempt_at).toBe(NOW + 60_000 + HOLD_MS);
    // The switch comes back: it resumes from the tag step, the task made once.
    env.CLICKUP_WRITEBACK_APPLY_REQUESTS = "true";
    h.advance(HOLD_MS);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.task_id).toBe(taskId);
    expect(creates(h)).toHaveLength(1);
  });

  it("a row held while the switch is off is sent once it is on, its tries never counted", async () => {
    const env: Record<string, string> = { CLICKUP_API_TOKEN: "x" };
    const h = harness(env);
    const row = h.db.enqueue("request", requestPayload());
    for (let i = 0; i < 8; i++) {
      await h.run();
      h.advance(HOLD_MS);
    }
    expect(row).toMatchObject({ state: "queued", attempts: 0, task_id: null });
    expect(h.clickup.calls).toEqual([]);
    env.CLICKUP_WRITEBACK_APPLY_REQUESTS = "true";
    await h.run();
    expect(row.state).toBe("delivered");
  });

  it("on a database without the release, the row goes to retry with its progress and the held claims are not tries", async () => {
    const env: Record<string, string> = { CLICKUP_API_TOKEN: "x" };
    const h = harness(env);
    h.db.withRelease = false;
    const row = h.db.enqueue("request", requestPayload());
    for (let i = 0; i < 8; i++) {
      await h.run();
      h.advance(HOLD_MS);
    }
    expect(row).toMatchObject({ state: "retry", attempts: 8, error: WAITING.dry_run });
    expect(row.progress?.held).toBe(8);
    expect(row.planned?.length).toBeGreaterThan(0);
    expect(triesOf({ ...row, created_at: "" } as any)).toBe(0);
    // Live, a rate limit is the first try of the ladder (one minute), never "gave up".
    env.CLICKUP_WRITEBACK_APPLY_REQUESTS = "true";
    h.clickup.fail = c => (c.method === "POST" && c.path === `list/${LISTS.tech}/task` ? rejected(429, "Rate limit") : undefined);
    await h.run();
    expect(row.state).toBe("retry");
    expect(row.next_attempt_at).toBe(h.clock.t + 60_000);
    h.clickup.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
  });

  it("narrowed back to the canary, a part off the canary that already has its task is not settled", async () => {
    const env: Record<string, string> = { ...LIVE };
    const h = harness(env);
    h.clickup.fail = c => (c.method === "POST" && c.path === `task/${CARD}/comment` ? rejected(429, "Rate limit") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("retry");
    h.clickup.fail = undefined;
    env.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS = "86eywg1cq";
    h.advance(60_000);
    const out = await h.run();
    expect(out.mode).toBe("apply_limited");
    expect(row).toMatchObject({ state: "retry", error: WAITING.apply_limited });
    expect(steps(row).create).toBe("done");
    delete env.CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS;
    h.advance(HOLD_MS);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(creates(h)).toHaveLength(1);
  });

  it("held rows step aside, so rows behind them in the queue get their turn", async () => {
    const h = harness({ ...LIVE, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: "86eywg1cq" });
    const others = Array.from({ length: 6 }, (_, i) =>
      h.db.enqueue("request", requestPayload({ requestId: `${i}b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`, ref: `R-${i}b2b3c4d5e-main` })));
    const canary = h.db.enqueue("request", requestPayload({ requestId: "7c2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-7c2b3c4d5e-main", clientTaskId: "86eywg1cq", clientName: "Test client", clientTag: "test client" }));
    await h.run();
    expect(others.every(r => r.state === "queued")).toBe(true);
    expect(canary.state).toBe("queued");
    h.advance(60_000);
    await h.run();
    expect(canary.state).toBe("delivered");
  });
});

describe("RT-2: once the task exists, a refused step never fails the part", () => {
  it("a refused checklist is named on a delivered part; the rest of the steps still run", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "POST" && c.path.endsWith("/checklist") ? rejected(400, "Checklist refused") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("delivered");
    expect(steps(row)).toMatchObject({ create: "done", checklist: "mismatch", tag: "done", card_comment: "done" });
    expect(row.error).toContain(STEP_REFUSED.checklist);
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ state: "delivered", clickupTaskId: row.task_id });
    expect(creates(h)).toHaveLength(1);
  });

  it("a refused checklist item is named the same way", async () => {
    const h = harness(LIVE);
    let n = 0;
    h.clickup.fail = c => (c.method === "POST" && c.path.endsWith("/checklist_item") && ++n === 2 ? rejected(400, "Item refused") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(row.state).toBe("delivered");
    expect(steps(row).checklist).toBe("mismatch");
  });

  it("the client card's link comment refused (404 or 403) is not essential: the part is delivered with a note", async () => {
    for (const status of [404, 403]) {
      const h = harness(LIVE);
      h.clickup.fail = c => (c.method === "POST" && c.path === `task/${CARD}/comment` ? rejected(status, "No access") : undefined);
      const row = h.db.enqueue("request", requestPayload());
      const out = await h.run();
      expect(row.state).toBe("delivered");
      expect(row.error).toBe(STEP_REFUSED.card_comment);
      expect(steps(row).card_comment).toBe("mismatch");
      expect(out.ok).toBe(true);
    }
  });

  it("a Request Type option renamed between the task and its last step is a note, not a failure", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    // The first run makes the task and stops on Request Type's write.
    h.clickup.fail = c => (c.method === "POST" && c.path.endsWith(`/field/${RT_FIELD}`) ? rejected(429, "Rate limit") : undefined);
    await h.run();
    expect(row.state).toBe("retry");
    h.clickup.fail = undefined;
    h.clickup.fields.find(f => f.id === RT_FIELD)!.type_config.options.find((o: any) => o.id === OPTION.generalTech).name = "General Tech Ticket";
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.error).toContain(SAY.renamed);
    expect(steps(row)).toMatchObject({ request_type: "mismatch", card_comment: "done" });
  });

  it("the task deleted in ClickUp still fails the part (raising it again is right)", async () => {
    const h = harness(LIVE);
    h.clickup.fail = c => (c.method === "GET" && c.path.startsWith("space/") ? rejected(503, "Down") : undefined);
    const row = h.db.enqueue("request", requestPayload());
    await h.run();
    h.clickup.fail = undefined;
    h.clickup.tasks.delete(row.task_id!);
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: SAY.gone });
  });
});

describe("RT-3: a template resume never adopts a task another part owns", () => {
  const loseTemplate = (h: ReturnType<typeof harness>) => {
    let lost = false;
    h.clickup.lose = c => (!lost && c.path.includes("/taskTemplate/") ? (lost = true) : false);
  };

  it("a same-name task another queue row holds is passed over", async () => {
    const h = harness(LIVE);
    loseTemplate(h);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(row.state).toBe("unknown");
    // Another request for the same client and type made its task inside the window (its description step not reached).
    const other = h.clickup.addTask({ name: row.payload.taskName, listId: LISTS.tech, date_created: String(NOW + 1) });
    h.db.enqueue("request", { ...pausePayloads()[0], requestId: "2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-2b2b3c4d5e-tech" }, { state: "unknown", task_id: other.id, next_attempt_at: NOW + 3_600_000 });
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.task_id).not.toBe(other.id);
    expect(creates(h)).toHaveLength(1);
    expect(h.db.rpcs.some(r => r.name === "cockpit_clickup_writeback_task_owners")).toBe(true);
  });

  it("without the owners read, a same-name task carrying another Cockpit ref is passed over", async () => {
    const h = harness(LIVE);
    h.db.withTaskOwners = false;
    loseTemplate(h);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    h.clickup.addTask({ name: row.payload.taskName, listId: LISTS.tech, date_created: String(NOW + 1), text_content: "Template text\n\nCockpit ref R-2b2b3c4d5e-tech" });
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(creates(h)).toHaveLength(1);
  });

  it("a task already carrying this part's own Cockpit ref is adopted first", async () => {
    const h = harness(LIVE);
    loseTemplate(h);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    const mine = [...h.clickup.tasks.values()].find(t => t.name === row.payload.taskName)!;
    mine.text_content = `Template text\n\nCockpit ref R-1a2b3c4d5e-tech`;
    h.clickup.addTask({ name: row.payload.taskName, listId: LISTS.tech, date_created: String(NOW + 1) });
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.task_id).toBe(mine.id);
  });
});

describe("RT-5: Request Type turned off reaches parts still in the queue", () => {
  const verifyPayload = (taskId: string) => ({
    op: "verify", requestId: REQUEST_ID, part: "main", taskId, listId: LISTS.tech, taskName: "Acme Interiors - General tech request",
    ownerClickupId: PEOPLE.systemsManager, typeKey: "general_tech", setRequestType: true, clientTaskId: CARD,
  });
  const second = () => requestPayload({ requestId: "2b2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", ref: "R-2b2b3c4d5e-main", setRequestType: true });

  it("in the same run: the check turns it off, and a part after it leaves Request Type empty", async () => {
    const h = harness(LIVE);
    const moved = h.clickup.addTask({ name: "Renamed by a rule", listId: LISTS.tech, assignees: [{ id: PEOPLE.systemsManager }] });
    const check = h.db.enqueue("task_action", verifyPayload(moved.id), { dedupe_key: `verify:${REQUEST_ID}:main` });
    const part = h.db.enqueue("request", second());
    await h.run();
    expect(check.progress?.verify).toBe("moved");
    expect(part.state).toBe("delivered");
    expect(steps(part).request_type).toBe("skipped");
    expect(part.error).toContain(SAY.rtTurnedOff);
    expect(h.clickup.writes().some(c => c.path.endsWith(`/field/${RT_FIELD}`))).toBe(false);
  });

  it("in a later run: a part queued before the check reads the type again and leaves Request Type empty", async () => {
    const h = harness(LIVE);
    h.db.doctorInputs = { types: [{ key: "general_tech", setRequestType: false }], templates: [], lists: {} };
    const part = h.db.enqueue("request", second());
    await h.run();
    expect(part.state).toBe("delivered");
    expect(steps(part).request_type).toBe("skipped");
    expect(h.clickup.writes().some(c => c.path.endsWith(`/field/${RT_FIELD}`))).toBe(false);
  });

  it("when the type cannot be read, the part waits instead of writing Request Type", async () => {
    const h = harness(LIVE);
    h.db.fail = name => (name === "cockpit_request_doctor_inputs" ? new Error("Supabase 500") : undefined);
    const part = h.db.enqueue("request", second());
    await h.run();
    expect(part).toMatchObject({ state: "retry", error: SAY.rtCheckLater });
    expect(h.clickup.writes().some(c => c.path.endsWith(`/field/${RT_FIELD}`))).toBe(false);
    h.db.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(part.state).toBe("delivered");
    expect(steps(part).request_type).toBe("done");
  });

  it("a part delivered inside the two minutes gets its own check, which finds its own move", async () => {
    const h = harness(LIVE);
    const a = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    await h.run();
    expect(a.state).toBe("delivered");
    h.clickup.task(a.task_id!)!.name = "Renamed by a rule";
    h.advance(121_000);
    await h.run();
    expect(h.db.byKey(`verify:${REQUEST_ID}:main`)?.progress?.verify).toBe("moved");
    expect(h.db.rtOff.map(r => r.key)).toEqual(["general_tech"]);
  });
});

describe("F14: every template part reads back its checklist", () => {
  it("a template that brought no checklist, on a type with no SOP steps, is delivered with a note", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", whatsappPayload({ sopSteps: null, sopChecklistName: null, sopStepsWhen: null }));
    await h.run();
    expect(row.steps).toContain("checklist");
    expect(row.state).toBe("delivered");
    expect(steps(row).checklist).toBe("mismatch");
    expect(row.error).toContain(SAY.noTemplateChecklist);
  });

  it("a template part with SOP steps adds them when the template is empty, whatever sopStepsWhen says", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", whatsappPayload({ sopStepsWhen: null }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.task(row.task_id!)!.checklists.map((c: any) => c.name)).toEqual(["SOP steps"]);
  });

  it("a template that brought its checklist is left as it is", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("request", pausePayloads()[0]);
    await h.run();
    expect(steps(row).checklist).toBe("unchanged");
    expect(row.error).toBeNull();
  });
});
