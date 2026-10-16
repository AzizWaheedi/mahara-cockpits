import { describe, expect, test } from "bun:test";
import { LeverAccessError, LeverInputError, runLever, taskDescription as describeTask } from "./lever.ts";

const ACTOR = "27f5abf0-2ccd-4cf7-8550-6f8e7e2b5418";
const REQUEST = "28dfdbe1-f962-4c8a-a92c-f0ba6cd03d73";
const CREATIVE_LIST = "901818016338";
const context = {
  actorId: ACTOR,
  email: "creative@maharamedia.com",
  locationId: "locFormula0001",
  taskId: "CU_D",
  clientName: "Formula Co",
  metric: "hook_rate",
  metricLabel: "Hook rate",
  lever: "Test a new first 3 seconds on the kitchen video",
  department: "creative",
  note: "Before and after in the first frame",
  meetingId: null,
  evidence: "Formula Co Hook rate, 06 Sep to 15 Sep: 20% against a good line of 25% (watch).",
  day: "2026-10-16",
  from: "2026-09-06",
  to: "2026-09-15",
};
const args = {
  locationId: "locFormula0001",
  metric: "hook_rate",
  lever: "Test a new first 3 seconds on the kitchen video",
  department: "creative",
  note: "Before and after in the first frame",
  from: "2026-09-06",
  to: "2026-09-15",
};
const input = (extra: Record<string, unknown> = {}) => ({ operation: "lever", args, ...extra });

type Rpc = { name: string; args: Record<string, any> };
function fixture(
  options: {
    gate?: (call: number) => { data: unknown; error: { message: string } | null };
    begin?: () => { data: unknown; error: { message: string } | null };
    respond?: (method: string, path: string, body: any) => unknown;
    token?: string;
    healthError?: boolean;
  } = {},
) {
  const userRpcs: Rpc[] = [];
  const adminRpcs: Rpc[] = [];
  const receipts: Record<string, unknown>[] = [];
  const calls: { method: string; path: string; body: any }[] = [];
  let gates = 0;
  let created: any = null;
  let comment: any = null;
  const client = {
    async rpc(name: string, a: Record<string, unknown>) {
      userRpcs.push({ name, args: a });
      gates++;
      return options.gate?.(gates) ?? { data: { ...context }, error: null };
    },
  };
  const admin = {
    async rpc(name: string, a: Record<string, any>) {
      adminRpcs.push({ name, args: a });
      if (name === "cockpit_board_lever_begin") return options.begin?.() ?? { data: { created: true }, error: null };
      if (name === "cockpit_board_lever_finish")
        return {
          data: a.p_error
            ? { id: a.p_id, status: "reconcile", error: a.p_error }
            : { id: a.p_id, status: "open", clickupTaskId: a.p_result.ticketId, clickupUrl: a.p_result.ticketUrl },
          error: null,
        };
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      expect(table).toBe("cockpit_board_provider_health");
      return {
        async insert(row: Record<string, unknown>) {
          receipts.push(row);
          return { error: options.healthError ? { message: "ledger down" } : null };
        },
      };
    },
  };
  const request = (async (resource: string | URL | Request, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : resource);
    const path = url.pathname.replace("/api/v2/", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const custom = options.respond?.(method, path, body);
    if (custom !== undefined) return custom instanceof Response ? custom : Response.json(custom);
    if (method === "POST" && path === `list/${CREATIVE_LIST}/task`) {
      created = body;
      return Response.json({ id: "86abc" });
    }
    if (method === "GET" && path === "task/86abc")
      return Response.json({
        id: "86abc",
        list: { id: CREATIVE_LIST },
        name: created?.name,
        due_date: String(created?.due_date),
        url: "https://app.clickup.com/t/86abc",
      });
    if (method === "POST" && path === "task/CU_D/comment") {
      comment = body;
      return Response.json({ id: "c1" });
    }
    if (method === "GET" && path === "task/CU_D/comment")
      return Response.json({ comments: [{ id: "c1", comment_text: comment?.comment_text }] });
    return new Response(JSON.stringify({ err: "not found" }), { status: 404 });
  }) as typeof fetch;
  const env = (name: string) => (name === "CLICKUP_API_TOKEN" ? (options.token ?? "test-clickup-token") : undefined);
  return {
    userRpcs,
    adminRpcs,
    receipts,
    calls,
    gates: () => gates,
    run: (raw: unknown) => runLever(client, admin, raw, env, request),
  };
}

describe("a lever from the board", () => {
  test("a dry run says what would be filed and calls nothing", async () => {
    const f = fixture();
    const out: any = await f.run(input());
    expect(out.dryRun).toBe(true);
    expect(out.plan).toMatchObject({
      list: CREATIVE_LIST,
      department: "creative",
      name: "Formula Co - Test a new first 3 seconds on the kitchen video",
      clientTask: "https://app.clickup.com/t/CU_D",
    });
    expect(out.plan.description).toBe(describeTask(context as any));
    expect(out.plan.description).toContain("Why: Formula Co Hook rate");
    // Due two days on, 09:00 Kuwait time, as the client success tickets are.
    expect(out.plan.dueDate).toBe(Date.parse("2026-10-18T09:00:00+03:00"));
    expect(f.calls).toEqual([]);
    expect(f.adminRpcs).toEqual([]);
    expect(f.userRpcs).toEqual([{ name: "cockpit_board_lever_context", args: { p_args: args } }]);
  });

  test("applying files the task in the owner's list, reads it back, comments on the client card and records it", async () => {
    const f = fixture();
    const out: any = await f.run(input({ apply: true, requestId: REQUEST }));
    expect(out).toMatchObject({
      ok: true,
      ticketId: "86abc",
      ticketUrl: "https://app.clickup.com/t/86abc",
      commentId: "c1",
      lever: { id: REQUEST, status: "open", clickupTaskId: "86abc" },
    });
    expect(f.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      `POST list/${CREATIVE_LIST}/task`,
      "GET task/86abc",
      "POST task/CU_D/comment",
      "GET task/CU_D/comment",
    ]);
    expect(f.calls[0].body).toMatchObject({
      name: "Formula Co - Test a new first 3 seconds on the kitchen video",
      description: describeTask(context as any),
    });
    expect(f.calls[2].body.comment_text).toBe(
      [
        context.lever,
        "Client: Formula Co",
        `Why: ${context.evidence}`,
        `Note: ${context.note}`,
        "Task created: https://app.clickup.com/t/86abc",
      ].join("\n"),
    );
    // The gate twice (dry check, then right before the write), the row, then the finish.
    expect(f.gates()).toBe(2);
    expect(f.adminRpcs.map(r => r.name)).toEqual(["cockpit_board_lever_begin", "cockpit_board_lever_finish"]);
    expect(f.adminRpcs[0].args).toEqual({ p_id: REQUEST, p_context: context, p_request: args });
    expect(f.adminRpcs[1].args).toMatchObject({ p_id: REQUEST, p_error: null, p_result: { ticketId: "86abc" } });
    // Every call in the health ledger, tied to the lever.
    expect(f.receipts).toHaveLength(8);
    expect(f.receipts.every(r => r.lever_id === REQUEST)).toBe(true);
    expect(f.receipts.map(r => r.phase)).toEqual(["intent", "response", "intent", "response", "intent", "response", "intent", "response"]);
  });

  test("a task that does not read back is never called open: the lever is left to reconcile", async () => {
    const f = fixture({
      respond: (method, path) =>
        method === "GET" && path === "task/86abc"
          ? { id: "86abc", list: { id: CREATIVE_LIST }, name: "Someone else's task", due_date: null }
          : undefined,
    });
    await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/read-back did not match/);
    expect(f.calls.map(c => `${c.method} ${c.path}`)).toEqual([`POST list/${CREATIVE_LIST}/task`, "GET task/86abc"]);
    expect(f.adminRpcs.at(-1)).toMatchObject({
      name: "cockpit_board_lever_finish",
      args: { p_id: REQUEST, p_result: null, p_error: expect.stringMatching(/read-back did not match/) },
    });
  });

  test("a comment that does not read back is left to reconcile", async () => {
    const f = fixture({
      respond: (method, path) => (method === "GET" && path === "task/CU_D/comment" ? { comments: [] } : undefined),
    });
    await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/Comment read-back/);
    expect(f.adminRpcs.at(-1)?.args.p_error).toMatch(/Comment read-back/);
  });

  test("ClickUp refusing the task is said and left to reconcile", async () => {
    const f = fixture({
      respond: (method, path) =>
        method === "POST" && path.endsWith("/task") ? new Response(JSON.stringify({ err: "nope" }), { status: 500 }) : undefined,
    });
    await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/ClickUp rejected the request \(500\)/);
    expect(f.adminRpcs.map(r => r.name)).toEqual(["cockpit_board_lever_begin", "cockpit_board_lever_finish"]);
  });

  test("the gate's refusal stops everything before ClickUp", async () => {
    const f = fixture({ gate: () => ({ data: null, error: { message: "This client is not on your board." } }) });
    const err = await f.run(input({ apply: true, requestId: REQUEST })).catch(e => e);
    expect(err).toBeInstanceOf(LeverAccessError);
    expect(err.message).toBe("This client is not on your board.");
    expect(f.calls).toEqual([]);
    expect(f.adminRpcs).toEqual([]);
  });

  test("access that changes between the two gate reads stops the write", async () => {
    const f = fixture({
      gate: n => ({ data: n === 1 ? { ...context } : { ...context, taskId: "CU_OTHER" }, error: null }),
    });
    const err = await f.run(input({ apply: true, requestId: REQUEST })).catch(e => e);
    expect(err).toBeInstanceOf(LeverAccessError);
    expect(f.calls).toEqual([]);
    expect(f.adminRpcs).toEqual([]);
  });

  test("evidence that moved between the two gate reads does not", async () => {
    const f = fixture({
      gate: n => ({ data: n === 1 ? { ...context } : { ...context, evidence: "Formula Co Hook rate: 21%." }, error: null }),
    });
    const out: any = await f.run(input({ apply: true, requestId: REQUEST }));
    expect(out.ok).toBe(true);
  });

  test("a retry of a confirmed lever replays it and never files twice", async () => {
    const f = fixture({
      begin: () => ({
        data: {
          existing: {
            id: REQUEST,
            status: "open",
            clickupTaskId: "86abc",
            clickupUrl: "https://app.clickup.com/t/86abc",
            request: { ...args, lever: context.lever },
            result: { ok: true, ticketId: "86abc", ticketUrl: "https://app.clickup.com/t/86abc", commentId: "c1" },
            createdById: ACTOR,
          },
        },
        error: null,
      }),
    });
    const out: any = await f.run(input({ apply: true, requestId: REQUEST }));
    expect(out).toMatchObject({ ok: true, replayed: true, ticketId: "86abc", lever: { id: REQUEST, status: "open" } });
    expect(out.lever.request).toBeUndefined();
    expect(f.calls).toEqual([]);
  });

  test("the same request id with other words, or one still sending, is refused", async () => {
    for (const existing of [
      { id: REQUEST, status: "open", request: { ...args, lever: "Something else" }, result: {}, createdById: ACTOR },
      { id: REQUEST, status: "sending", request: args, result: null, createdById: ACTOR },
      { id: REQUEST, status: "open", request: args, result: {}, createdById: "00000000-0000-4000-8000-000000000000" },
    ]) {
      const f = fixture({ begin: () => ({ data: { existing }, error: null }) });
      await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/may have reached ClickUp/);
      expect(f.calls).toEqual([]);
    }
  });

  test("not a lever: refused before the gate", async () => {
    for (const bad of [
      input({ args: { ...args, department: "sales" } }),
      input({ args: { ...args, lever: "x" } }),
      input({ args: { ...args, extra: 1 } }),
      input({ requestId: "not-a-uuid" }),
      { operation: "plan", args },
    ]) {
      const f = fixture();
      const err = await f.run(bad).catch(e => e);
      expect(err).toBeInstanceOf(LeverInputError);
      expect(f.userRpcs).toEqual([]);
    }
  });

  test("applying needs a request id", async () => {
    const f = fixture();
    const err = await f.run(input({ apply: true })).catch(e => e);
    expect(err).toBeInstanceOf(LeverInputError);
    expect(f.adminRpcs).toEqual([]);
  });

  test("without the ClickUp token nothing is sent", async () => {
    const f = fixture({ token: "" });
    await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/CLICKUP_API_TOKEN is not configured/);
    expect(f.calls).toEqual([]);
  });

  test("a ledger that cannot be written stops the call before ClickUp", async () => {
    const f = fixture({ healthError: true });
    await expect(f.run(input({ apply: true, requestId: REQUEST }))).rejects.toThrow(/ClickUp receipt/);
    expect(f.calls).toEqual([]);
    expect(f.adminRpcs.at(-1)?.args.p_error).toMatch(/ClickUp receipt/);
  });
});
