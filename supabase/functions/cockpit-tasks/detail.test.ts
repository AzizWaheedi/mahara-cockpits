import { describe, expect, test } from "bun:test";
import { detailCache } from "./clickup";
import { FRESH_MS, NOT_READ, readAt, RpcError, runDetail } from "./detail";
import { cuTask, kit, NOW } from "./testkit";

const JWT = "user-jwt-fixture";
type Row = Record<string, any>;

/** A database that answers cockpit_task_detail for the person's sign-in, as 20261026t would. */
function setup(opts: { cachedAt?: number | null; refuse?: RpcError } = {}) {
  const k = kit();
  const seen: { jwt: string; name: string; args: Row }[] = [];
  let cachedAt: number | null = opts.cachedAt === undefined ? null : opts.cachedAt;
  const userRpc = async (jwt: string, name: string, args: Row) => {
    seen.push({ jwt, name, args });
    if (opts.refuse) throw opts.refuse;
    return {
      asOf: new Date(NOW).toISOString(),
      task: { taskId: args.p_task_id, title: "Fix the lead form" },
      detail: cachedAt === null ? null : { at: new Date(cachedAt).toISOString(), checklists: [] },
      detailNote: null,
      can: { tick: true, comment: true, done: true, why: null },
    };
  };
  k.db.handlers.cockpit_task_detail_cache = () => {
    cachedAt = k.deps.now();
    return null;
  };
  k.clickup.tasks.set(
    "abc123",
    cuTask("abc123", {
      due_date: "1793178000000",
      due_date_time: false,
      markdown_description: "Do the **thing**",
      assignees: [{ id: 113688800 }],
      checklists: [{ id: "cl1", name: "SOP steps", items: [{ id: "i1", name: "One", resolved: true, children: [{ id: "i2", name: "Two", resolved: false }] }] }],
      subtasks: [{ id: "s1", name: "Sub", status: { status: "to do", type: "open" } }],
    }),
  );
  k.clickup.comments.set("abc123", [{ id: "c1", comment_text: "Looks good", date: String(NOW - 1000), user: { id: 113459516 }, comment: [] }]);
  return { k, seen, deps: { ...k.deps, userRpc } };
}

describe("the focus view's read", () => {
  test("the person's own sign-in decides first; a refusal is their sentence and nothing is read from ClickUp", async () => {
    const s = setup({ refuse: new RpcError("This task is not assigned to you. Open it in ClickUp.", "42501") });
    const r = await runDetail(s.deps, JWT, { taskId: "abc123", refresh: true });
    expect(r).toEqual({ status: 403, body: { error: "This task is not assigned to you. Open it in ClickUp." } });
    expect(s.seen.map(c => [c.jwt, c.name, c.args])).toEqual([[JWT, "cockpit_task_detail", { p_task_id: "abc123" }]]);
    expect(s.k.clickup.calls.length).toBe(0);
    expect(s.k.db.calls.length).toBe(0);
    const missing = setup({ refuse: new RpcError("This task has not been read from ClickUp yet. Open it in ClickUp.", "P0002") });
    expect((await runDetail(missing.deps, JWT, { taskId: "abc123", refresh: false })).status).toBe(404);
    const broken = setup({ refuse: new RpcError("connection reset", null) });
    expect(await runDetail(broken.deps, JWT, { taskId: "abc123", refresh: false })).toEqual({
      status: 500,
      body: { error: "This task could not be opened. Open it in ClickUp." },
    });
  });

  test("never read: ClickUp is read once, the row then its cache saved with the service key, and the seat reads it again", async () => {
    const s = setup();
    const r = await runDetail(s.deps, JWT, { taskId: "abc123", refresh: false });
    expect(r.status).toBe(200);
    // The cache was written during this read (the pacer's half second is on the fake clock).
    expect(Date.parse(r.body.detail.at)).toBeGreaterThanOrEqual(NOW);
    expect(s.k.clickup.calls.map(c => [c.method, c.path, c.query.get("include_markdown_description"), c.query.get("include_subtasks")])).toEqual([
      ["GET", "task/abc123", "true", "true"],
      ["GET", "task/abc123/comment", null, null],
    ]);
    expect(s.k.db.calls.map(c => c.name)).toEqual(["cockpit_task_mirror_upsert", "cockpit_task_detail_cache"]);
    const upsert = s.k.db.calls[0].args;
    expect(upsert.p_source).toBe("detail");
    expect((upsert.p_tasks as Row[])[0]).toMatchObject({ taskId: "abc123", dueHasTime: false, checklistDone: 1, checklistTotal: 2 });
    expect(s.k.db.calls[1].args).toEqual({
      p_task_id: "abc123",
      p_detail: {
        dueHasTime: false,
        description: "Do the **thing**",
        checklists: [{ id: "cl1", name: "SOP steps", items: [{ id: "i1", name: "One", resolved: true }, { id: "i2", name: "Two", resolved: false }] }],
        subtasks: [{ id: "s1", name: "Sub", status: "to do", statusType: "open" }],
        comments: [{ id: "c1", authorId: 113459516, atMs: NOW - 1000, text: "Looks good" }],
        status: "to do",
        statusType: "open",
      },
    });
    expect(s.seen.length).toBe(2);
    expect(s.seen.every(c => c.jwt === JWT)).toBe(true);
    expect(new Set(s.k.receipts.map(x => x.action_id)).size).toBe(1);
  });

  test("read in the last minute: the cache answers; refresh reads ClickUp again", async () => {
    const s = setup({ cachedAt: NOW - FRESH_MS + 5000 });
    await runDetail(s.deps, JWT, { taskId: "abc123", refresh: false });
    expect(s.k.clickup.calls.length).toBe(0);
    expect(s.seen.length).toBe(1);
    await runDetail(s.deps, JWT, { taskId: "abc123", refresh: true });
    expect(s.k.clickup.calls.length).toBe(2);
    const old = setup({ cachedAt: NOW - FRESH_MS - 1 });
    await runDetail(old.deps, JWT, { taskId: "abc123", refresh: false });
    expect(old.k.clickup.calls.length).toBe(2);
  });

  test("ClickUp fails: the cache stands and the note says when it was read", async () => {
    const s = setup({ cachedAt: Date.parse("2026-10-26T08:02:00Z") });
    s.k.clickup.fail.set("task/abc123", 500);
    const r = await runDetail(s.deps, JWT, { taskId: "abc123", refresh: true });
    expect(r.status).toBe(200);
    expect(r.body.detailNote).toBe(readAt("11:02"));
    expect(r.body.detailNote).toBe("This task could not be read from ClickUp just now. What you see was read at 11:02.");
    expect(s.k.db.calls.length).toBe(0);
    const never = setup();
    never.k.clickup.fail.set("task/abc123", 404);
    expect((await runDetail(never.deps, JWT, { taskId: "abc123", refresh: false })).body.detailNote).toBe(NOT_READ);
  });

  test("only GETs reach ClickUp, with no token there is no read but the view still answers", async () => {
    const s = setup();
    delete s.k.vars.CLICKUP_API_TOKEN;
    const r = await runDetail(s.deps, JWT, { taskId: "abc123", refresh: true });
    expect(r.status).toBe(200);
    expect(r.body.detailNote).toBe(NOT_READ);
    expect(s.k.clickup.calls.length).toBe(0);
  });

  test("the cache shape keeps 2,000 characters of description and flattens nested steps", () => {
    const c = detailCache(cuTask("x1", { markdown_description: "y".repeat(3000), checklists: [] }), []);
    expect(c.description.length).toBe(2000);
    expect(c.dueHasTime).toBeNull();
  });
});
