import { describe, expect, test } from "bun:test";
import { mirrorTask, NO_TOKEN, pacer } from "./clickup";
import { COMMENT_TASKS, OVERLAP_MS, REPLY_READS, runDelta, TRUNCATED } from "./delta";
import { cuTask, kit, NOW, TOKEN } from "./testkit";

const tasksAt = (n: number, from = NOW - 3_600_000) =>
  Array.from({ length: n }, (_, i) => cuTask(`t${i}`, { date_updated: String(from + i * 1000), assignees: [{ id: 113459516 }] }));

describe("the delta", () => {
  test("first run: the last 24 hours less the overlap, oldest change first, every page saved, the cursor at the newest change", async () => {
    const k = kit();
    k.clickup.delta = tasksAt(150);
    const r = await runDelta(k.deps);
    const reads = k.clickup.calls.filter(c => c.path === "team/90182518398/task");
    expect(reads.length).toBe(2);
    for (const c of reads) {
      expect(c.query.get("include_closed")).toBe("true");
      expect(c.query.get("subtasks")).toBe("true");
      expect(c.query.get("order_by")).toBe("updated");
      expect(c.query.get("reverse")).toBe("true");
      expect(Number(c.query.get("date_updated_gt"))).toBe(NOW - 24 * 3_600_000 - OVERLAP_MS);
    }
    expect(reads.map(c => c.query.get("page"))).toEqual(["0", "1"]);
    expect(k.db.of("cockpit_task_mirror_upsert").map(c => [(c.args.p_tasks as unknown[]).length, c.args.p_source])).toEqual([
      [100, "delta"],
      [50, "delta"],
    ]);
    expect(r).toMatchObject({ ok: true, pages: 2, tasks: 150, truncated: false, cursorMs: NOW - 3_600_000 + 149_000 });
    const state = k.db.last("cockpit_task_mirror_state").args;
    expect(state).toMatchObject({ p_job: "delta", p_ok: true, p_note: "Read 150 changed tasks and 0 comment threads; 0 alerts." });
    expect(state.p_detail).toEqual({ cursorMs: NOW - 3_600_000 + 149_000, pages: 2, tasks: 150, comments: 0, alerts: 0, truncated: false });
    expect(k.db.of("cockpit_task_alerts_tick").length).toBe(1);
  });

  test("a later run starts at the cursor less 10 minutes", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_inputs = () => ({ cursorMs: NOW - 120_000, linked: [] });
    await runDelta(k.deps);
    expect(Number(k.clickup.calls.filter(c => c.path === "team/90182518398/task")[0].query.get("date_updated_gt"))).toBe(NOW - 120_000 - OVERLAP_MS);
  });

  test("more than 1,000 changes: 10 pages, truncated, not ok, the cursor over what was saved", async () => {
    const k = kit();
    k.clickup.delta = tasksAt(1050);
    const r = await runDelta(k.deps);
    expect(k.clickup.calls.filter(c => c.path === "team/90182518398/task").length).toBe(10);
    expect(r.truncated).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.tasks).toBe(1000);
    expect(r.cursorMs).toBe(NOW - 3_600_000 + 999_000);
    expect(r.note.startsWith(TRUNCATED)).toBe(true);
    expect(k.db.last("cockpit_task_mirror_state").args.p_ok).toBe(false);
  });

  test("a read that breaks part way keeps what was saved; out of order it keeps the old cursor", async () => {
    const k = kit();
    k.clickup.delta = tasksAt(150);
    let n = 0;
    const real = k.clickup.fetch;
    k.deps.clickupFetch = async (input, init) => {
      if (String(input).includes("/team/90182518398/task") && n++ === 1) throw new Error("socket hang up");
      return real(input, init);
    };
    const r = await runDelta(k.deps);
    expect(r.ok).toBe(false);
    expect(r.tasks).toBe(100);
    expect(r.cursorMs).toBe(NOW - 3_600_000 + 99_000);
    expect(r.note).toContain("The changed tasks could not all be read from ClickUp");
    // The same, with ClickUp answering newest first.
    const k2 = kit();
    k2.clickup.delta = tasksAt(150).reverse();
    let m = 0;
    const real2 = k2.clickup.fetch;
    k2.deps.clickupFetch = async (input, init) => {
      if (String(input).includes("/team/90182518398/task") && m++ === 1) throw new Error("socket hang up");
      return real2(input, init);
    };
    expect((await runDelta(k2.deps)).cursorMs).toBeNull();
  });

  test("the comments of the tasks the database names, with their reply threads, capped", async () => {
    const k = kit();
    const due = Array.from({ length: COMMENT_TASKS }, (_, i) => ({ taskId: `c${i}`, sinceMs: NOW - 600_000 }));
    k.db.handlers.cockpit_task_mirror_comment_due = () => due;
    k.db.handlers.cockpit_task_mirror_comments = () => ({ alerts: 1 });
    for (let i = 0; i < COMMENT_TASKS; i++)
      k.clickup.comments.set(`c${i}`, [
        { id: `${i}01`, comment_text: "old thread", date: String(NOW - 7 * 86_400_000), reply_count: 2, user: { id: 113459516 }, comment: [] },
        {
          id: `${i}02`,
          comment_text: "@Noura look",
          date: String(NOW - 60_000),
          reply_count: 1,
          user: { id: 113459516 },
          comment: [{ text: "@Noura", type: "tag", user: { id: 113688800 } }],
          assignee: null,
        },
      ]);
    k.clickup.replies.set("002", [{ id: "r1", comment_text: "a reply", date: String(NOW - 30_000), user: { id: 113688800 }, comment: [] }]);
    const r = await runDelta(k.deps);
    expect(k.db.of("cockpit_task_mirror_comment_due")[0].args).toEqual({ p_limit: 40 });
    expect(k.clickup.gets("task/").filter(c => c.path.endsWith("/comment")).length).toBe(COMMENT_TASKS);
    const replyReads = k.clickup.gets("comment/");
    expect(replyReads.length).toBe(REPLY_READS);
    // The thread started after the cut-off is read before the old one.
    expect(replyReads.slice(0, 2).map(c => c.path)).toEqual(["comment/002/reply", "comment/001/reply"]);
    const first = k.db.of("cockpit_task_mirror_comments")[0].args;
    expect(first.p_task_id).toBe("c0");
    expect(first.p_comments).toEqual([
      { id: "001", authorId: 113459516, atMs: NOW - 7 * 86_400_000, text: "old thread", tagIds: [], assigneeId: null, parentId: null },
      { id: "002", authorId: 113459516, atMs: NOW - 60_000, text: "@Noura look", tagIds: [113688800], assigneeId: null, parentId: null },
      { id: "r1", authorId: 113688800, atMs: NOW - 30_000, text: "a reply", tagIds: [], assigneeId: null, parentId: "002" },
    ]);
    expect(r.comments).toBe(COMMENT_TASKS);
    expect(r.alerts).toBe(COMMENT_TASKS);
    expect(r.ok).toBe(true);
  });

  test("a comment read that fails is named and the others still go", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_comment_due = () => [
      { taskId: "x1", sinceMs: 0 },
      { taskId: "x2", sinceMs: 0 },
    ];
    k.clickup.fail.set("task/x1/comment", 500);
    const r = await runDelta(k.deps);
    expect(r.ok).toBe(false);
    expect(r.comments).toBe(1);
    expect(r.note).toContain("The comments on task x1 could not be read");
    expect(k.db.of("cockpit_task_mirror_comments").map(c => c.args.p_task_id)).toEqual(["x2"]);
  });

  test("every ClickUp call is a GET with the token, receipted under the run's action id, paced", async () => {
    const k = kit();
    k.clickup.delta = tasksAt(20);
    k.db.handlers.cockpit_task_mirror_comment_due = () => [{ taskId: "t1", sinceMs: 0 }];
    const started = k.deps.now();
    await runDelta(k.deps);
    expect(k.clickup.calls.length).toBe(2);
    expect(k.clickup.calls.every(c => c.method === "GET" && c.authorization === TOKEN)).toBe(true);
    expect(k.receipts.map(r => [r.phase, r.method])).toEqual([
      ["intent", "GET"],
      ["response", "GET"],
      ["intent", "GET"],
      ["response", "GET"],
    ]);
    expect(new Set(k.receipts.map(r => r.action_id)).size).toBe(1);
    expect(JSON.stringify(k.receipts)).not.toContain(TOKEN);
    // 120 a minute: the second call waited half a second.
    expect(k.deps.now() - started).toBeGreaterThanOrEqual(500);
  });

  test("a receipt that cannot be saved stops the call", async () => {
    const k = kit();
    k.failReceipts(true);
    const r = await runDelta(k.deps);
    expect(k.clickup.calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.note).toContain("could not be saved");
  });

  test("no token: nothing is read and the state row says what to add", async () => {
    const k = kit({ token: null });
    const r = await runDelta(k.deps);
    expect(k.clickup.calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(k.db.last("cockpit_task_mirror_state").args).toMatchObject({ p_job: "delta", p_ok: false });
    expect(String(k.db.last("cockpit_task_mirror_state").args.p_note)).toContain(NO_TOKEN);
    expect(k.db.of("cockpit_task_mirror_upsert").length).toBe(0);
  });

  test("the task shape: ids, Kuwait-free times, checklists counted, closed and archived kept", () => {
    const row = mirrorTask(
      cuTask("abc123", {
        name: "Fix the lead form",
        status: { status: "complete", type: "done" },
        priority: { priority: "high" },
        due_date: "1793178000000",
        assignees: [{ id: 113459516 }, { id: "113688800" }],
        watchers: [{ id: 284616470 }],
        tags: [{ name: "acme interiors" }],
        parent: "parent1",
        archived: true,
        date_closed: "1793170000000",
        checklists: [{ id: "cl", items: [{ id: "a", resolved: true, children: [{ id: "b", resolved: false }] }] }],
      }),
    );
    expect(row).toMatchObject({
      taskId: "abc123",
      listId: "901816723190",
      listName: "Operations / Tech",
      parentId: "parent1",
      status: "complete",
      statusType: "done",
      priority: "high",
      dueAtMs: 1793178000000,
      assigneeIds: [113459516, 113688800],
      watcherIds: [284616470],
      creatorId: 222000111,
      tags: ["acme interiors"],
      archived: true,
      dateClosedMs: 1793170000000,
      checklistDone: 1,
      checklistTotal: 2,
    });
    expect(row?.dueHasTime).toBeUndefined();
    expect(mirrorTask(cuTask("abc124", { due_date_time: true }))?.dueHasTime).toBe(true);
    expect(mirrorTask({ id: "x" })).toBeNull();
    expect(mirrorTask(cuTask("bad id"))).toBeNull();
  });

  test("the pacer spaces calls evenly", async () => {
    let t = 0;
    const waits: number[] = [];
    const pace = pacer(120, () => t, async ms => {
      waits.push(ms);
      t += ms;
    });
    await pace();
    await pace();
    await pace();
    expect(waits).toEqual([500, 500]);
  });
});
