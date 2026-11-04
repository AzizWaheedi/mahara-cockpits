import { describe, expect, it } from "bun:test";
import { ACTION_SAY, actionCommentText, planTaskAction, RT_OFF_NOTE, VERIFY_DUE_MS, VERIFY_LATE_MS } from "./taskActions";
import { actionPayload, CARD, harness, LISTS, LIVE, NOW, PEOPLE, rejected, REQUEST_ID, requestPayload, TEST_CARD, toolsHarness } from "./requestsTestkit";

const TASK = "86work0001";
/** A task assigned to the systems manager on Operations / Tech, with a three-step checklist. */
function seeded(env: Record<string, string> = LIVE, over: Record<string, unknown> = {}) {
  const h = harness(env);
  addWorkTask(h, over);
  return h;
}
function addWorkTask(h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) {
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

  it("a seat's task on any list takes a tick, a comment and Mark done; Mark done is not offered on Video Pipeline or WhatsApp Reconnection (review round 2, ask F12)", async () => {
    const done = () => actionPayload("done", { statusSeen: "in progress" });
    // Any other list: every press goes, as cockpit_task_can and cockpit_task_act now allow.
    for (const press of [tick(), actionPayload("comment", { text: "Footage is in the Drive folder." }), done()]) {
      const h = seeded(LIVE, { list: { id: LISTS.other, name: "Sales Follow-ups" } });
      const row = h.db.enqueue("task_action", press);
      await h.run();
      expect(row).toMatchObject({ state: "delivered", error: null });
      expect(h.clickup.writes().length).toBeGreaterThan(0);
    }
    // Video Pipeline and WhatsApp Reconnection: a tick and a comment go; Mark done is skipped with its own sentence.
    for (const [list, name, why] of [
      [LISTS.pipeline, "Video Pipeline", "Mark done is not offered on Video Pipeline, where done means the video is live. Move it in ClickUp."],
      [LISTS.whatsapp, "WhatsApp Reconnection", "Mark done is not offered on WhatsApp Reconnection, where a status change messages the client. Move it in ClickUp."],
    ] as const) {
      const h = seeded(LIVE, { list: { id: list, name } });
      const d = h.db.enqueue("task_action", done());
      await h.run();
      expect(d).toMatchObject({ state: "skipped", error: why });
      expect(h.clickup.writes()).toEqual([]);
      expect(h.clickup.task(TASK)!.status).toMatchObject({ status: "in progress", type: "custom" });
      const t = h.db.enqueue("task_action", tick());
      const c = h.db.enqueue("task_action", actionPayload("comment", { text: "Footage is in the Drive folder." }));
      await h.run();
      expect(t.state).toBe("delivered");
      // The comment waited in the task's lane behind the tick, and goes on the next run.
      expect(c.state).toBe("queued");
      await h.run();
      expect(c.state).toBe("delivered");
    }

    const onCard = seeded(LIVE, { list: { id: LISTS.cards, name: "Clients - Mahara" } });
    const cc = onCard.db.enqueue("task_action", actionPayload("comment", { text: "Hello" }));
    await onCard.run();
    expect(cc).toMatchObject({ state: "skipped", error: "This is a client card. Open it in ClickUp." });
    expect(onCard.clickup.writes()).toEqual([]);

    const onAll = seeded(LIVE, { list: { id: LISTS.allTasks, name: "All Tasks" } });
    const a = onAll.db.enqueue("task_action", tick());
    await onAll.run();
    expect(a.state).toBe("delivered");
    // The old boards sentence is gone.
    expect(Object.keys(ACTION_SAY)).not.toContain("boards");
  });

  it("comment words that hold a Cockpit ref are never posted (the database refuses them; this is the second guard)", async () => {
    for (const text of ["Cockpit ref T-0000000000 please hold", "see cockpit  ref r-1a2b3c4d5e-main"]) {
      const h = seeded();
      const row = h.db.enqueue("task_action", actionPayload("comment", { text }));
      await h.run();
      expect(row).toMatchObject({ state: "failed", error: ACTION_SAY.markerWords });
      expect(h.clickup.calls).toEqual([]);
    }
    const ok = seeded();
    const row = ok.db.enqueue("task_action", actionPayload("comment", { text: "I updated the cockpit reference sheet." }));
    await ok.run();
    expect(row.state).toBe("delivered");
  });

  it("a real subtask of a client card takes a tick, a comment and Mark done; the card itself takes none (ask F2)", async () => {
    const card = { list: { id: LISTS.cards, name: "Clients - Mahara" } };
    // The subtask: ClickUp names its parent card.
    for (const press of [tick(), actionPayload("comment", { text: "Booked the shoot." }), actionPayload("done", { statusSeen: "in progress" })]) {
      const h = seeded(LIVE, { ...card, parent: CARD });
      const row = h.db.enqueue("task_action", press);
      await h.run();
      expect(row).toMatchObject({ state: "delivered", error: null });
      expect(h.clickup.writes().length).toBeGreaterThan(0);
    }
    const done = seeded(LIVE, { ...card, parent: CARD });
    done.db.enqueue("task_action", actionPayload("done", { statusSeen: "in progress" }));
    await done.run();
    expect(done.clickup.task(TASK)!.status).toMatchObject({ status: "complete", type: "done" });
    // The card itself (no parent): every press is skipped with the same sentence, and nothing is written.
    for (const press of [tick(), actionPayload("comment", { text: "Hello" }), actionPayload("done", { statusSeen: "in progress" })]) {
      const h = seeded(LIVE, { ...card, parent: null });
      const row = h.db.enqueue("task_action", press);
      await h.run();
      expect(row).toMatchObject({ state: "skipped", error: ACTION_SAY.clientCard });
      expect(h.clickup.writes()).toEqual([]);
    }
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

  it("a comment that posted but whose receipt could not be saved is read back next run, never failed or posted twice (review R2)", async () => {
    let failed = false;
    const h = toolsHarness(LIVE, {
      receipt: r =>
        !failed && r.phase === "response" && r.method === "POST" && r.resource === `task/${TASK}/comment`
          ? ((failed = true), new Error("Supabase 503: upstream connect error"))
          : undefined,
    });
    addWorkTask(h);
    const row = h.db.enqueue("task_action", actionPayload("comment", { text: "The form is fixed." }));
    await h.run();
    // Before review R2 this settled failed, and pressing Comment again posted it twice.
    expect(row.state).toBe("unknown");
    expect(h.clickup.comments.get(TASK)).toHaveLength(1);
    h.advance(60_000);
    await h.run();
    expect(row).toMatchObject({ state: "delivered", error: null });
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
    expect(dry.state).toBe("queued");
    expect(off.clickup.calls).toEqual([]);
  });

  // Review R2: a check held through a switch-off, a writer outage or the retry ladder can run days late, when a
  // move, a rename or a missing owner is as likely a person's own change as a list rule.
  const late = async (h: ReturnType<typeof harness>, payload = verify(), deliveredAgo = 3 * 86_400_000) => {
    const row = h.db.enqueue("task_action", payload, {
      dedupe_key: `verify:${REQUEST_ID}:main`, source_table: "cockpit_requests", source_id: REQUEST_ID, created_at: NOW - deliveredAgo,
    });
    await h.run();
    return row;
  };

  it("late: a move turns nothing off and an owner a person took off is not put back; the check says what it saw", async () => {
    const moved = seeded(LIVE, { list: { id: LISTS.ads, name: "Marketing / ADs" } });
    const a = await late(moved, verify({ setRequestType: true }));
    expect(a).toMatchObject({ state: "skipped", error: ACTION_SAY.late('ClickUp shows it on Marketing / ADs as "Acme Interiors - General tech request".') });
    expect(moved.db.rtOff).toEqual([]);
    expect(moved.clickup.writes()).toEqual([]);
    expect(moved.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ verifyNote: a.error });
    expect(moved.db.parts.get(`${REQUEST_ID}:main`)?.verifyState).toBeUndefined();

    // A person reassigned the task to the CSM days ago: before review R2 the late check put the systems manager back.
    const reassigned = seeded(LIVE, { assignees: [{ id: PEOPLE.csm }] });
    const b = await late(reassigned);
    expect(b).toMatchObject({ state: "skipped", error: ACTION_SAY.late(ACTION_SAY.ownerOff) });
    expect(reassigned.clickup.writes()).toEqual([]);
    expect(reassigned.clickup.task(TASK)!.assignees).toEqual([{ id: PEOPLE.csm }]);
  });

  it("late with nothing to act on reads as usual: kept, and a move with Request Type off is only noted", async () => {
    const kept = await late(seeded());
    expect(kept).toMatchObject({ state: "delivered" });
    expect(kept.progress?.verify).toBe("kept");
    const noted = await late(seeded(LIVE, { name: "Renamed by the CSM" }));
    expect(noted.progress).toMatchObject({ verify: "kept", verifyNote: 'ClickUp shows it on Operations / Tech as "Renamed by the CSM".' });
  });

  it("the limit is 15 minutes past the check's time", async () => {
    const onTime = await late(seeded(LIVE, { name: "Renamed by a rule" }), verify({ setRequestType: true }), VERIFY_DUE_MS + VERIFY_LATE_MS);
    expect(onTime.progress?.verify).toBe("moved");
    const over = await late(seeded(LIVE, { name: "Renamed by a rule" }), verify({ setRequestType: true }), VERIFY_DUE_MS + VERIFY_LATE_MS + 1);
    expect(over.state).toBe("skipped");
  });

  it("a move seen on time whose rt_off failed still turns Request Type off when the retry runs late", async () => {
    const h = seeded(LIVE, { name: "Renamed by a rule" });
    h.db.fail = name => (name === "cockpit_request_type_rt_off" ? new Error("Supabase 500") : undefined);
    const row = await run(h, verify({ setRequestType: true }));
    expect(row.state).toBe("retry");
    expect(row.progress?.steps?.verify?.movedAt).toBeTruthy();
    h.db.fail = undefined;
    h.advance(45 * 60_000);
    await h.run();
    expect(row.progress?.verify).toBe("moved");
    expect(h.db.rtOff.map(r => r.key)).toEqual(["general_tech"]);
  });

  it("an owner put back on time whose answer was lost is only read back when the retry runs late", async () => {
    const h = seeded(LIVE, { assignees: [] });
    h.clickup.lose = c => c.method === "PUT";
    const row = await run(h);
    expect(row.state).toBe("unknown");
    h.clickup.lose = undefined;
    h.advance(45 * 60_000);
    await h.run();
    expect(row.progress?.verify).toBe("restored");
    expect(h.clickup.writes()).toHaveLength(1);
  });

  it("end to end: a check held through a switch-off, then a person's move days later, turns nothing off", async () => {
    const env: Record<string, string> = { ...LIVE };
    const h = harness(env);
    const req = h.db.enqueue("request", requestPayload({ setRequestType: true }));
    await h.run();
    expect(req.state).toBe("delivered");
    const check = h.db.byKey(`verify:${REQUEST_ID}:main`)!;
    // The switch goes off before the check is due; the check waits in the queue.
    delete env.CLICKUP_WRITEBACK_APPLY_REQUESTS;
    h.advance(121_000);
    await h.run();
    expect(check.state).toBe("queued");
    // Three days later the owner moves the task to another board, then requests open again.
    h.advance(3 * 86_400_000);
    h.clickup.task(req.task_id!)!.list = { id: LISTS.ads, name: "Marketing / ADs" };
    env.CLICKUP_WRITEBACK_APPLY_REQUESTS = "true";
    await h.run();
    expect(check.state).toBe("skipped");
    expect(check.error).toBe(ACTION_SAY.late('ClickUp shows it on Marketing / ADs as "Acme Interiors - General tech request".'));
    expect(h.db.rtOff).toEqual([]);
    expect(h.db.parts.get(`${REQUEST_ID}:main`)).toMatchObject({ state: "delivered", verifyNote: check.error });
  });

  // Review round 3: the sync trigger stamps when the owner (ownerAt) and Request Type (madeAt) were written, and
  // the check's clock starts there, not at delivery, which a later step retried for hours (the card comment, the
  // old ticket) can push back past the writes the check judges.
  const at = (agoMs: number) => new Date(NOW - agoMs).toISOString();

  it("on time is measured from when Request Type and the owner were written, not from delivery (review round 3)", async () => {
    // Delivered a minute ago, but Request Type was written 40 minutes ago: the move turns nothing off.
    const moved = seeded(LIVE, { name: "Renamed later" });
    const a = await late(moved, verify({ setRequestType: true, ownerAt: at(40 * 60_000), madeAt: at(40 * 60_000) }), 60_000);
    expect(a).toMatchObject({ state: "skipped", error: ACTION_SAY.late('ClickUp shows it on Operations / Tech as "Renamed later".') });
    expect(moved.db.rtOff).toEqual([]);
    // The owner written 40 minutes ago is not put back either.
    const off = seeded(LIVE, { assignees: [{ id: PEOPLE.csm }] });
    const b = await late(off, verify({ ownerAt: at(40 * 60_000), madeAt: at(40 * 60_000) }), 60_000);
    expect(b).toMatchObject({ state: "skipped", error: ACTION_SAY.late(ACTION_SAY.ownerOff) });
    expect(off.clickup.writes()).toEqual([]);
    // The owner written long ago, Request Type five minutes ago: a move is judged by Request Type, so it is off.
    const rt = seeded(LIVE, { name: "Renamed by a rule", assignees: [] });
    const c = await late(rt, verify({ setRequestType: true, ownerAt: at(40 * 60_000), madeAt: at(5 * 60_000) }), 60_000);
    expect(c.progress?.verify).toBe("moved");
    expect(rt.db.rtOff.map(r => r.key)).toEqual(["general_tech"]);
    expect(rt.clickup.writes()).toEqual([]);
    // Delivered a day after the writes it judges is late; on the 15-minute line it is still on time.
    const edge = await late(seeded(LIVE, { assignees: [] }), verify({ ownerAt: at(VERIFY_DUE_MS + VERIFY_LATE_MS) }), 60_000);
    expect(edge.progress?.verify).toBe("restored");
    const over = await late(seeded(LIVE, { assignees: [] }), verify({ ownerAt: at(VERIFY_DUE_MS + VERIFY_LATE_MS + 1) }), 60_000);
    expect(over.state).toBe("skipped");
  });

  it("the owner's clock falls back to madeAt, then to the check's own time; a time it cannot read is absent", async () => {
    // No ownerAt: madeAt (40 minutes ago) times the owner, so nobody is put back.
    const fallback = seeded(LIVE, { assignees: [{ id: PEOPLE.csm }] });
    const a = await late(fallback, verify({ madeAt: at(40 * 60_000) }), 60_000);
    expect(a.state).toBe("skipped");
    expect(fallback.clickup.writes()).toEqual([]);
    // Unreadable times are absent: the check's own time (a minute ago) is on time, so the owner is put back.
    for (const bad of ["yesterday", "12345", 1793005200000, "", null, { at: "2026-10-26T08:00:00Z" }]) {
      const h = seeded(LIVE, { assignees: [] });
      const row = await late(h, verify({ ownerAt: bad, madeAt: bad }), 60_000);
      expect(row.progress?.verify).toBe("restored");
      expect(h.clickup.writes()).toHaveLength(1);
    }
  });

  it("end to end: a part whose card comment kept retrying is delivered late, and its check judges the writes, not the delivery", async () => {
    const h = harness(LIVE);
    // The link comment on the card is refused for a while (a 503), so the part is delivered long after its owner.
    h.clickup.fail = c => (c.method === "POST" && c.path === `task/${CARD}/comment` ? rejected(503, "Service unavailable") : undefined);
    const req = h.db.enqueue("request", requestPayload());
    await h.run();
    expect(req.state).not.toBe("delivered");
    const made = Date.parse(String(req.progress?.steps?.create?.at));
    h.clickup.fail = undefined;
    for (let i = 0; i < 6 && req.state !== "delivered"; i++) {
      h.advance(30 * 60_000);
      await h.run();
    }
    expect(req.state).toBe("delivered");
    const check = h.db.byKey(`verify:${REQUEST_ID}:main`)!;
    expect(check.payload).toMatchObject({ setRequestType: false, ownerAt: new Date(made).toISOString(), madeAt: new Date(made).toISOString() });
    // A person took the task over in ClickUp meanwhile: the check, due two minutes after delivery, puts nobody back.
    h.clickup.task(req.task_id!)!.assignees = [{ id: PEOPLE.csm }];
    h.advance(121_000);
    await h.run();
    expect(check).toMatchObject({ state: "skipped", error: ACTION_SAY.late(ACTION_SAY.ownerOff) });
    expect(h.clickup.task(req.task_id!)!.assignees).toEqual([{ id: PEOPLE.csm }]);
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
    expect(row.state).toBe("queued");
    expect(row.attempts).toBe(0);
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
