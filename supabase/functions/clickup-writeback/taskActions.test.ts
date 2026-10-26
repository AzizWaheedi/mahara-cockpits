import { describe, expect, it } from "bun:test";
import { ACTION_SAY, actionCommentText, planTaskAction, RT_OFF_NOTE } from "./taskActions";
import { actionPayload, CARD, harness, LISTS, LIVE, NOW, PEOPLE, rejected, REQUEST_ID, requestPayload, TEST_CARD } from "./requestsTestkit";

const TASK = "86work0001";
/** A task assigned to the systems manager on Operations / Tech, with a three-step checklist. */
function seeded(env: Record<string, string> = LIVE, over: Record<string, unknown> = {}) {
  const h = harness(env);
  h.clickup.addTask({
    id: TASK,
    name: "Acme Interiors - General tech request",
    listId: LISTS.tech,
    assignees: [{ id: PEOPLE.systemsManager }],
    status: { status: "in progress", type: "custom" },
    checklists: [
      {
        id: "cl0001",
        name: "SOP steps",
        date_created: String(NOW - 86_400_000),
        items: [
          { id: "it0001", name: "Read the request", resolved: true, orderindex: 0 },
          { id: "it0002", name: "Make the change", resolved: false, orderindex: 1 },
          { id: "it0003", name: "Tell the requester", resolved: false, orderindex: 2 },
        ],
      },
    ],
    ...over,
  });
  return h;
}
const tick = (over: Record<string, unknown> = {}) => actionPayload("tick", { checklistId: "cl0001", itemId: "it0002", itemName: "Make the change", from: false, to: true, ...over });
const item = (h: ReturnType<typeof harness>, id = "it0002") => h.clickup.task(TASK)!.checklists[0].items.find((i: any) => i.id === id);

describe("tick and untick", () => {
  it("ticks the step the person saw, then reads it back", async () => {
    const h = seeded();
    const row = h.db.enqueue("task_action", tick());
    const out = await h.run();
    expect(row).toMatchObject({ state: "delivered", task_id: TASK, error: null });
    expect(h.clickup.writes().map(c => [c.method, c.path, c.body])).toEqual([["PUT", "checklist/cl0001/checklist_item/it0002", { resolved: true }]]);
    expect(item(h).resolved).toBe(true);
    expect(row.steps).toEqual(["tick"]);
    expect(row.progress?.steps?.tick?.state).toBe("done");
    // The precondition read comes first, the read-back after.
    expect(h.clickup.calls.map(c => `${c.method} ${c.path.split("?")[0]}`)).toEqual([`GET task/${TASK}`, "PUT checklist/cl0001/checklist_item/it0002", `GET task/${TASK}`]);
    expect(out.note).toBe("1 task change delivered, 0 to retry, 0 failed.");
  });

  it("unticks too", async () => {
    const h = seeded();
    const row = h.db.enqueue("task_action", actionPayload("untick", { checklistId: "cl0001", itemId: "it0001", itemName: "Read the request", from: true, to: false }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(item(h, "it0001").resolved).toBe(false);
  });

  it("a step already in the wanted state is unchanged, with no write", async () => {
    const h = seeded();
    item(h).resolved = true;
    const row = h.db.enqueue("task_action", tick());
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.tick?.state).toBe("unchanged");
    expect(h.clickup.writes()).toEqual([]);
  });

  it("a step ClickUp renamed or removed is skipped with its sentence", async () => {
    for (const change of [(h: any) => (item(h).name = "Make the change and test it"), (h: any) => h.clickup.task(TASK).checklists[0].items.splice(1, 1)]) {
      const h = seeded();
      change(h);
      const row = h.db.enqueue("task_action", tick());
      await h.run();
      expect(row).toMatchObject({ state: "skipped", error: "ClickUp changed this step. Open the task there." });
      expect(h.clickup.writes()).toEqual([]);
    }
  });

  it("a tick ClickUp does not show afterwards is read again next run, never forced", async () => {
    const h = seeded();
    const real = h.clickup.handle.bind(h.clickup);
    h.clickup.handle = async c => {
      const out = await real(c);
      if (c.method === "PUT") item(h).resolved = false;
      return out;
    };
    const row = h.db.enqueue("task_action", tick());
    await h.run();
    expect(row).toMatchObject({ state: "unknown", error: ACTION_SAY.notShown });
  });
});

describe("who may act, and where (the precondition read)", () => {
  it("a person no longer on the task is skipped, unless an admin, the requester or a watcher", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{ assignees: [{ id: PEOPLE.csm }] }, {}, "skipped"],
      [{ assignees: [{ id: PEOPLE.csm }] }, { actor: { clickupUserId: PEOPLE.systemsManager, label: "the CEO", isAdmin: true } }, "delivered"],
      [{ assignees: [{ id: PEOPLE.csm }] }, { requesterOfTask: true }, "delivered"],
      [{ assignees: [{ id: PEOPLE.csm }], watchers: [{ id: PEOPLE.systemsManager }] }, {}, "delivered"],
    ];
    for (const [task, press, state] of cases) {
      const h = seeded(LIVE, task);
      const row = h.db.enqueue("task_action", tick(press));
      await h.run();
      expect(row.state).toBe(state);
      if (state === "skipped") {
        expect(row.error).toBe("This task is no longer yours in ClickUp. Open it there.");
        expect(h.clickup.writes()).toEqual([]);
      }
    }
  });

  it("tick and Mark done work only on the team boards; a comment goes anywhere but a client card", async () => {
    const onPipeline = seeded(LIVE, { list: { id: LISTS.pipeline, name: "Video Pipeline" } });
    const t = onPipeline.db.enqueue("task_action", tick());
    const c = onPipeline.db.enqueue("task_action", actionPayload("comment", { text: "Footage is in the Drive folder." }));
    await onPipeline.run();
    expect(t).toMatchObject({ state: "skipped", error: "Ticking and Mark done work on the team request boards. Open this one in ClickUp." });
    // The comment waited in the task's lane behind the tick, and goes on the next run.
    expect(c.state).toBe("queued");
    await onPipeline.run();
    expect(c.state).toBe("delivered");

    const onCard = seeded(LIVE, { list: { id: LISTS.cards, name: "Clients - Mahara" } });
    const cc = onCard.db.enqueue("task_action", actionPayload("comment", { text: "Hello" }));
    await onCard.run();
    expect(cc).toMatchObject({ state: "skipped", error: "This is a client card. Open it in ClickUp." });
    expect(onCard.clickup.writes()).toEqual([]);

    const onAll = seeded(LIVE, { list: { id: LISTS.allTasks, name: "All Tasks" } });
    const a = onAll.db.enqueue("task_action", tick());
    await onAll.run();
    expect(a.state).toBe("delivered");
  });

  it("a task gone from ClickUp is skipped", async () => {
    const h = harness(LIVE);
    const row = h.db.enqueue("task_action", tick());
    await h.run();
    expect(row).toMatchObject({ state: "skipped", error: "This task is no longer in ClickUp." });
  });

  it("an action with no usable plan fails before any call", async () => {
    const h = seeded();
    const row = h.db.enqueue("task_action", tick({ itemId: "../x" }));
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: ACTION_SAY.badAction });
    expect(h.clickup.calls).toEqual([]);
  });
});

describe("comment", () => {
  it("posts the person's words with their role and the Cockpit ref, then reads it back", async () => {
    const h = seeded();
    const row = h.db.enqueue("task_action", actionPayload("comment", { text: "The form is fixed. Please check." }));
    await h.run();
    expect(row.state).toBe("delivered");
    const post = h.clickup.writes()[0];
    expect(post).toMatchObject({ method: "POST", path: `task/${TASK}/comment` });
    expect(post.body).toEqual({ comment_text: "The systems manager wrote in the cockpit: The form is fixed. Please check.\n\nCockpit ref T-9f8e7d6c5b", notify_all: false });
    expect(row.progress?.steps?.comment).toMatchObject({ state: "done", commentId: h.clickup.comments.get(TASK)![0].id });
  });

  it("a lost answer is found by its marker on the next run and never posted twice", async () => {
    const h = seeded();
    let lost = false;
    h.clickup.lose = c => c.method === "POST" && !lost && (lost = true);
    const row = h.db.enqueue("task_action", actionPayload("comment", { text: "Done." }));
    await h.run();
    expect(row.state).toBe("unknown");
    h.clickup.addComments(TASK, 26, NOW + 30_000);
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().filter(c => c.method === "POST")).toHaveLength(1);
  });

  it("words the actor by role", () => {
    expect(actionCommentText(actionPayload("comment", { text: "Hi", actor: { label: "the CSM" } }))).toBe("The CSM wrote in the cockpit: Hi\n\nCockpit ref T-9f8e7d6c5b");
  });
});

describe("Mark done", () => {
  it("moves the task to the list's done status when it still shows what the person saw", async () => {
    const h = seeded();
    const row = h.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await h.run();
    expect(row.state).toBe("delivered");
    expect(h.clickup.writes().map(c => [c.method, c.path, c.body])).toEqual([["PUT", `task/${TASK}`, { status: "complete" }]]);
    expect(h.clickup.task(TASK)!.status).toEqual({ status: "complete", type: "done" });
    // The list's statuses are read once a run, through the run's own ledger id.
    expect(h.clickup.calls.find(c => c.path === `list/${LISTS.tech}`)?.actionId).toBe("run-1");
  });

  it("a task already done is unchanged; one someone moved is skipped", async () => {
    const done = seeded(LIVE, { status: { status: "complete", type: "done" } });
    const a = done.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await done.run();
    expect(a.state).toBe("delivered");
    expect(a.progress?.steps?.done?.state).toBe("unchanged");
    expect(done.clickup.writes()).toEqual([]);

    const moved = seeded(LIVE, { status: { status: "review required", type: "custom" } });
    const b = moved.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await moved.run();
    expect(b).toMatchObject({ state: "skipped", error: "Someone moved this task in ClickUp. Open it there." });
  });

  it("a list with no done status fails with the list named", async () => {
    const h = seeded();
    h.clickup.statuses.set(LISTS.tech, [{ status: "in progress", type: "custom" }, { status: "cancelled", type: "closed" }]);
    const row = h.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await h.run();
    expect(row).toMatchObject({ state: "failed", error: "Operations / Tech has no done status in ClickUp. Mark it done there." });
  });
});

describe("a press whose answer was lost", () => {
  it("is read back before the precondition, so it is delivered even if the person was taken off the task since", async () => {
    const h = seeded();
    let lost = false;
    h.clickup.lose = c => c.method === "PUT" && !lost && (lost = true);
    const row = h.db.enqueue("task_action", tick());
    await h.run();
    expect(row.state).toBe("unknown");
    h.clickup.task(TASK)!.assignees = [{ id: PEOPLE.csm }];
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
    expect(row.progress?.steps?.tick?.state).toBe("done");
    expect(h.clickup.writes()).toHaveLength(1);
  });

  it("a 429 never landed: the press is checked and written again", async () => {
    const h = seeded();
    let n = 0;
    h.clickup.fail = c => (c.method === "PUT" && n++ === 0 ? rejected(429, "Rate limit") : undefined);
    const row = h.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await h.run();
    expect(row.state).toBe("retry");
    expect(row.progress?.steps?.done).toBeUndefined();
    h.advance(60_000);
    await h.run();
    expect(row.state).toBe("delivered");
  });
});

describe("the two-minute check of a delivered request (op verify)", () => {
  const verify = (over: Record<string, unknown> = {}) => ({
    op: "verify",
    requestId: REQUEST_ID,
    part: "main",
    taskId: TASK,
    listId: LISTS.tech,
    taskName: "Acme Interiors - General tech request",
    ownerClickupId: PEOPLE.systemsManager,
    typeKey: "general_tech",
    setRequestType: false,
    clientTaskId: CARD,
    ...over,
  });
  const run = async (h: ReturnType<typeof harness>, payload = verify()) => {
    const row = h.db.enqueue("task_action", payload, { dedupe_key: `verify:${REQUEST_ID}:main`, source_table: "cockpit_requests", source_id: REQUEST_ID });
    await h.run();
    return row;
  };

  it("kept: the owner is still there", async () => {
    const h = seeded();
    const row = await run(h);
    expect(row.state).toBe("delivered");
    expect(row.progress?.verify).toBe("kept");
    expect(row.progress).not.toHaveProperty("verifyNote");
    expect(h.clickup.writes()).toEqual([]);
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ verifyState: "kept", verifyNote: null });
  });

  it("kept, with a note when a list rule also added someone", async () => {
    const h = seeded(LIVE, { assignees: [{ id: PEOPLE.systemsManager }, { id: PEOPLE.csm }] });
    const row = await run(h);
    expect(row.progress).toMatchObject({ verify: "kept", verifyNote: "ClickUp also added another person." });
    expect(row.error).toBe("ClickUp also added another person.");
  });

  it("restored: a list rule removed the owner once, and the cockpit put them back", async () => {
    const h = seeded(LIVE, { assignees: [] });
    const row = await run(h);
    expect(h.clickup.writes().map(c => [c.method, c.path, c.body])).toEqual([["PUT", `task/${TASK}`, { assignees: { add: [PEOPLE.systemsManager], rem: [] } }]]);
    expect(row).toMatchObject({ state: "delivered" });
    expect(row.progress?.verify).toBe("restored");
    expect(h.db.parts.get(`${REQUEST_ID}:main`)?.verifyState).toBe("restored");
  });

  it("restored, when the answer to the put-back was lost and the next run finds the owner there", async () => {
    const h = seeded(LIVE, { assignees: [] });
    h.clickup.lose = c => c.method === "PUT";
    const row = await run(h);
    expect(row.state).toBe("unknown");
    h.clickup.lose = undefined;
    h.advance(60_000);
    await h.run();
    expect(row.progress?.verify).toBe("restored");
    expect(h.clickup.writes()).toHaveLength(1);
  });

  it("removed: a rule that keeps removing the owner fails the check with the list named, after one put-back", async () => {
    const h = seeded(LIVE, { assignees: [] });
    const real = h.clickup.handle.bind(h.clickup);
    h.clickup.handle = async c => {
      const out = await real(c);
      if (c.method === "PUT") h.clickup.task(TASK)!.assignees = [];
      return out;
    };
    const row = await run(h);
    expect(row).toMatchObject({ state: "failed", error: "A ClickUp rule on Operations / Tech keeps removing the owner." });
    expect(row.progress?.verify).toBe("removed");
    expect(h.clickup.writes()).toHaveLength(1);
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ verifyState: "removed", verifyNote: "A ClickUp rule on Operations / Tech keeps removing the owner." });
  });

  it("moved: with Request Type set, a moved or renamed task turns Request Type off for the type and nothing is put back", async () => {
    for (const over of [{ list: { id: LISTS.ads, name: "Marketing / ADs" } }, { name: "Client Pause ⏸️" }]) {
      const h = seeded(LIVE, { ...over, assignees: [] });
      const row = await run(h, verify({ setRequestType: true }));
      expect(row.state).toBe("delivered");
      expect(row.progress?.verify).toBe("moved");
      expect(h.db.rtOff).toEqual([{ key: "general_tech", note: RT_OFF_NOTE("Acme Interiors - General tech request") }]);
      expect(h.db.rtOff[0].note).toBe("ClickUp moved or renamed Acme Interiors - General tech request after its Request Type was set, so Request Type is off for this type.");
      expect(h.clickup.writes()).toEqual([]);
    }
  });

  it("moved without Request Type set: Request Type stays, the owner is still checked and the move is noted", async () => {
    const h = seeded(LIVE, { list: { id: LISTS.ads, name: "Marketing / ADs" } });
    const row = await run(h);
    expect(h.db.rtOff).toEqual([]);
    expect(row.progress).toMatchObject({ verify: "kept", verifyNote: 'ClickUp shows it on Marketing / ADs as "Acme Interiors - General tech request".' });
  });

  it("with no owner, only the list and the name are checked", async () => {
    const h = seeded(LIVE, { assignees: [{ id: PEOPLE.csm }] });
    const row = await run(h, verify({ ownerClickupId: null }));
    expect(row.progress?.verify).toBe("kept");
    expect(h.clickup.writes()).toEqual([]);
  });

  it("a failed rt_off call is retried, never counted as done", async () => {
    const h = seeded(LIVE, { name: "Renamed" });
    h.db.fail = name => (name === "cockpit_request_type_rt_off" ? new Error("Supabase 500") : undefined);
    const row = await run(h, verify({ setRequestType: true }));
    expect(row).toMatchObject({ state: "retry", error: "Request Type could not be turned off for this type just now. The next run tries again." });
    h.db.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(row.progress?.verify).toBe("moved");
  });

  it("runs on the general switch of the requests writer, even outside the canary card", async () => {
    const h = seeded({ ...LIVE, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD });
    const row = await run(h);
    expect(row.state).toBe("delivered");
    const off = seeded({ CLICKUP_API_TOKEN: "x" });
    const dry = await run(off);
    expect(dry.state).toBe("dry_run");
    expect(off.clickup.calls).toEqual([]);
  });
});

describe("a request, end to end with its two-minute check", () => {
  it("is delivered, then checked two minutes later, and the part shows both", async () => {
    const h = harness(LIVE);
    h.clickup.onCreate = t => {
      // The Client Success rule on create: add and remove assignees (CT F3).
      if (t.list.id === LISTS.cs) t.assignees = [];
    };
    const req = h.db.enqueue("request", requestPayload({ listId: LISTS.cs, listName: "Client Success", ownerClickupId: PEOPLE.csm, ownerLabel: "the CSM" }));
    await h.run();
    expect(req.state).toBe("delivered");
    const check = h.db.byKey(`verify:${REQUEST_ID}:main`)!;
    expect(check.state).toBe("queued");
    // Not before its time.
    h.advance(60_000);
    await h.run();
    expect(check.state).toBe("queued");
    h.advance(61_000);
    const out = await h.run();
    expect(check.state).toBe("delivered");
    expect(out.note).toBe("1 owner check delivered, 0 to retry, 0 failed.");
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ state: "delivered", verifyState: "restored" });
    expect(h.clickup.task(req.task_id!)!.assignees).toEqual([{ id: PEOPLE.csm }]);
  });
});

describe("dry runs and lanes", () => {
  it("a task change outside the canary card is held as a dry run with its plan", async () => {
    const h = seeded({ ...LIVE, CLICKUP_WRITEBACK_REQUESTS_ONLY_CARDS: TEST_CARD });
    const row = h.db.enqueue("task_action", tick());
    await h.run();
    expect(row.state).toBe("dry_run");
    expect(row.planned).toEqual(planTaskAction({ id: row.id, kind: "task_action", payload: tick(), attempts: 1, created_at: "" }));
    expect(h.clickup.calls).toEqual([]);
  });

  it("two presses on one task run one after the other, never side by side", async () => {
    const h = seeded();
    const first = h.db.enqueue("task_action", tick());
    const second = h.db.enqueue("task_action", actionPayload("done", { actionId: "8e8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", ref: "T-8e8e7d6c5b", statusSeen: "in progress" }));
    h.clickup.fail = c => (c.method === "PUT" && c.path.startsWith("checklist/") ? rejected(429, "Rate limit") : undefined);
    await h.run();
    expect([first.state, second.state]).toEqual(["retry", "queued"]);
    h.clickup.fail = undefined;
    h.advance(60_000);
    await h.run();
    expect(first.state).toBe("delivered");
    await h.run();
    expect(second.state).toBe("delivered");
  });
});
