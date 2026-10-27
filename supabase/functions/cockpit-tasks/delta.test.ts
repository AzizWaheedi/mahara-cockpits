import { describe, expect, test } from "bun:test";
import { COMMENT_MAX, commentRow, commentText, cut, detailCache, mirrorTask, NO_TOKEN, pacer, type Row } from "./clickup";
import { COMMENT_TASKS, mostFailed, OVERLAP_MS, REPLY_READS, runDelta, TRUNCATED } from "./delta";
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
    expect(state.p_detail).toEqual({ cursorMs: NOW - 3_600_000 + 149_000, pages: 2, tasks: 150, comments: 0, commentsFailed: 0, alerts: 0, truncated: false });
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
    // 1 ms before the last change read: a task sharing its timestamp on the next page is read again.
    expect(r.cursorMs).toBe(NOW - 3_600_000 + 999_000 - 1);
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
    expect(r.cursorMs).toBe(NOW - 3_600_000 + 99_000 - 1);
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
    // One thread of two is not most of them: the run stays ok and last_ok_at moves (F7).
    expect(r.ok).toBe(true);
    expect(r.comments).toBe(1);
    expect(r.commentsFailed).toBe(1);
    expect(r.note).toContain("The comments on task x1 could not be read");
    expect(k.db.last("cockpit_task_mirror_state").args.p_ok).toBe(true);
    // x2 is read; x1 is marked tried (p_failed), never as read.
    const calls = k.db.of("cockpit_task_mirror_comments").map(c => c.args);
    expect(calls.filter(a => !a.p_failed).map(a => a.p_task_id)).toEqual(["x2"]);
    expect(calls.filter(a => a.p_failed)).toEqual([{ p_task_id: "x1", p_comments: [], p_read_at: expect.any(String), p_failed: true }]);
  });

  test("most comment threads failing makes the run not ok and says so", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_comment_due = () => [{ taskId: "x1", sinceMs: 0 }, { taskId: "x2", sinceMs: 0 }, { taskId: "x3", sinceMs: 0 }];
    k.clickup.fail.set("task/x1/comment", 500);
    k.clickup.fail.set("task/x2/comment", 401);
    const r = await runDelta(k.deps);
    expect(r.ok).toBe(false);
    expect(r.note).toContain("Most comment threads could not be read (2 of 3)");
    expect([mostFailed(1, 1), mostFailed(1, 2), mostFailed(2, 4), mostFailed(2, 3), mostFailed(3, 4)]).toEqual([false, false, false, true, true]);
  });

  test("a database that refuses the tried marker does not stop the run", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_comment_due = () => [{ taskId: "x1", sinceMs: 0 }, { taskId: "x2", sinceMs: 0 }];
    k.db.handlers.cockpit_task_mirror_comments = a => {
      if (a.p_failed) throw new Error("Could not find the function with p_failed");
      return { alerts: 0 };
    };
    k.clickup.fail.set("task/x1/comment", 500);
    const r = await runDelta(k.deps);
    expect(r).toMatchObject({ ok: true, comments: 1, commentsFailed: 1 });
  });

  test("each thread passes the moment its read began as p_read_at (F6)", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_comment_due = () => [{ taskId: "x1", sinceMs: 0 }, { taskId: "x2", sinceMs: 0 }];
    const before = k.deps.now();
    await runDelta(k.deps);
    const [a, b] = k.db.of("cockpit_task_mirror_comments").map(c => c.args);
    expect(Date.parse(String(a.p_read_at))).toBeGreaterThanOrEqual(before);
    // Read before its GET: the second thread's read began after the first one's GET (paced).
    expect(Date.parse(String(b.p_read_at))).toBeGreaterThan(Date.parse(String(a.p_read_at)));
  });

  test("after a truncated run the next one starts at the cursor with no overlap, so 1,000+ changes in 10 minutes never stall or skip (F4)", async () => {
    const k = kit();
    // 2,500 changes inside 5 minutes, two of them sharing each timestamp, so page edges split ties.
    const many = Array.from({ length: 2500 }, (_, i) => cuTask(`m${i}`, { date_updated: String(NOW - 300_000 + Math.floor(i / 2) * 200) }));
    k.clickup.delta = many;
    let cursorMs: number | null = null;
    let truncatedNote = "";
    k.db.handlers.cockpit_task_mirror_inputs = () => ({ cursorMs, linked: [], states: { delta: truncatedNote ? { note: truncatedNote } : null } });
    k.db.handlers.cockpit_task_mirror_state = a => {
      const c = (a.p_detail as any).cursorMs;
      if (typeof c === "number") cursorMs = Math.max(cursorMs ?? c, c);
      truncatedNote = String(a.p_note);
      return null;
    };
    const seen = new Set<string>();
    for (let run = 0; run < 5; run++) {
      const before = k.db.of("cockpit_task_mirror_upsert").length;
      const r = await runDelta(k.deps);
      for (const c of k.db.of("cockpit_task_mirror_upsert").slice(before)) for (const t of c.args.p_tasks as any[]) seen.add(t.taskId);
      if (!r.truncated) break;
    }
    expect(seen.size).toBe(2500);
    // The first read of the second run began exactly at the first run's cursor.
    const reads = k.clickup.calls.filter(c => c.path === "team/90182518398/task" && c.query.get("page") === "0");
    expect(Number(reads[1].query.get("date_updated_gt"))).toBe(Number(many[999].date_updated) - 1);
  });

  test("the database's own truncated flag wins over the note when it sends one", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_inputs = () => ({ cursorMs: NOW - 120_000, deltaTruncated: true, linked: [], states: { delta: { note: "fine" } } });
    await runDelta(k.deps);
    expect(Number(k.clickup.calls.filter(c => c.path === "team/90182518398/task")[0].query.get("date_updated_gt"))).toBe(NOW - 120_000);
    const k2 = kit();
    k2.db.handlers.cockpit_task_mirror_inputs = () => ({ cursorMs: NOW - 120_000, deltaTruncated: false, linked: [], states: { delta: { note: TRUNCATED } } });
    await runDelta(k2.deps);
    expect(Number(k2.clickup.calls.filter(c => c.path === "team/90182518398/task")[0].query.get("date_updated_gt"))).toBe(NOW - 120_000 - OVERLAP_MS);
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

describe("a long comment keeps its Cockpit ref (review R2)", () => {
  // What a focus view posts (taskActions.ts actionCommentText): up to 2,000 characters, then the marker.
  const fromCockpit = (n: number) => `The CSM wrote in the cockpit: ${"w".repeat(n)}\n\nCockpit ref T-0123456789`;
  // The marker as cockpit_task_comment_author reads it, anchored at the end as review R2 asks of migration t.
  const refOf = (text: string) => /Cockpit ref (T-[0-9a-f]{10})\s*$/.exec(text)?.[1] ?? null;
  const row = (text: string) => commentRow({ id: "c1", comment_text: text, date: String(NOW - 1000), user: { id: 284616470 }, comment: [] })!;

  test("a 1,200 character comment is cut to 1,000 with its marker last, so its writer is still known", () => {
    const text = row(fromCockpit(1200)).text;
    expect(text.length).toBeLessThanOrEqual(COMMENT_MAX);
    // Postgres counts characters, never more than the UTF-16 length: its left(…, 1000) keeps all of it.
    expect(Array.from(text).length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(text.startsWith("The CSM wrote in the cockpit: www")).toBe(true);
    expect(text.endsWith("w\n\nCockpit ref T-0123456789")).toBe(true);
    expect(refOf(text)).toBe("T-0123456789");
    // Before review R2: a plain cut lost the marker, and the comment read as the CEO's own, with no alert.
    expect(refOf(fromCockpit(1200).slice(0, COMMENT_MAX))).toBeNull();
    // A request's card link keeps its marker the same way.
    expect(row(`Cockpit · The CSM asked Call Center: Low show rate\n${"x".repeat(1100)}\n\nCockpit ref R-1a2b3c4d5e-call_center-card`).text.endsWith(
      "\n\nCockpit ref R-1a2b3c4d5e-call_center-card",
    )).toBe(true);
  });

  test("short comments are untouched; a long one with no marker is cut as before", () => {
    expect(row(fromCockpit(900)).text).toBe(fromCockpit(900));
    expect(commentText("plain words ".repeat(200))).toBe("plain words ".repeat(200).slice(0, COMMENT_MAX));
    expect(commentText(null)).toBe("");
  });

  test("a cut never leaves half an emoji, which Postgres would refuse in the JSON", () => {
    const text = `${"a".repeat(999)}😀 and more`;
    expect(cut(text, 1000)).toBe("a".repeat(999));
    expect(commentText(text)).toBe("a".repeat(999));
    expect(cut("short", 1000)).toBe("short");
  });

  test("the delta hands the database the marker of a long cockpit comment", async () => {
    const k = kit();
    k.db.handlers.cockpit_task_mirror_comment_due = () => [{ taskId: "t1", sinceMs: NOW - 600_000 }];
    k.clickup.comments.set("t1", [{ id: "c9", comment_text: fromCockpit(1500), date: String(NOW - 1000), user: { id: 284616470 }, comment: [] }]);
    await runDelta(k.deps);
    const sent = (k.db.last("cockpit_task_mirror_comments").args.p_comments as Row[])[0];
    expect(sent.text.length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(refOf(sent.text)).toBe("T-0123456789");
  });

  test("the focus view's cache keeps it too", () => {
    const cache = detailCache(cuTask("x1"), [{ id: "c9", comment_text: fromCockpit(1990), date: String(NOW), user: { id: 284616470 } }]);
    expect(refOf(cache.comments[0].text)).toBe("T-0123456789");
    expect(cache.comments[0].text.length).toBeLessThanOrEqual(COMMENT_MAX);
  });
});
