import { describe, expect, test } from "bun:test";
import {
  executeCsm,
  fieldDay,
  fieldMatches,
  prepareCsm,
} from "../../../supabase/functions/cockpit-csm-api/core";
import { logCall } from "../src/lib/csmCalls";
import { performAct } from "../src/lib/useCsmSnapshot";

// Stage and happiness reach the client's ClickUp card through cockpit-csm-api;
// every other kind is saved in the cockpit only (2026-10-12).
function fakeClient() {
  const invoked: any[] = [];
  const rpcs: any[] = [];
  const client: any = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "csm-1" } } },
      }),
    },
    functions: {
      invoke: async (name: string, opts: any) => {
        invoked.push({ name, ...opts.body });
        return {
          data: { ok: true, receiptId: "receipt-1", commentId: "c1" },
          error: null,
        };
      },
    },
    rpc: async (name: string, params: any) => {
      rpcs.push({ name, ...params });
      return { data: 7, error: null };
    },
  };
  return { client, invoked, rpcs };
}

for (const [kind, value] of [
  ["stage", "Active"],
  ["happiness", "At Risk"],
]) {
  test(`${kind} goes to ClickUp through the CSM API, not the cockpit-only log`, async () => {
    const { client, invoked, rpcs } = fakeClient();
    await performAct(client, {
      clientName: "City Wood",
      taskId: "86eyt1d33",
      action: `Set to ${value}`,
      kind,
      value,
    });
    expect(rpcs).toEqual([]);
    expect(invoked).toHaveLength(1);
    expect(invoked[0].name).toBe("cockpit-csm-api");
    expect(invoked[0].operation).toBe("act");
    expect(invoked[0].apply).toBe(true);
    expect(invoked[0].args).toEqual({
      taskId: "86eyt1d33",
      kind,
      action: `Set to ${value}`,
      value,
    });
  });
}

test("other kinds stay in the cockpit, and a ticket still goes through the log", async () => {
  for (const kind of ["touchpoint", "ticket", "left", "service"]) {
    const { client, invoked, rpcs } = fakeClient();
    await performAct(client, {
      clientName: "City Wood",
      taskId: "86eyt1d33",
      action: "Did it",
      kind,
    });
    expect(invoked).toEqual([]);
    expect(rpcs[0].name).toBe("cockpit_log_decision");
    expect(rpcs[0].p_kind).toBe(kind);
  }
});

test("a stage change without a ClickUp card is refused before anything is sent", async () => {
  const { client, invoked, rpcs } = fakeClient();
  await expect(
    performAct(client, {
      clientName: "No Card",
      action: "Moved to Active",
      kind: "stage",
      value: "Active",
    }),
  ).rejects.toThrow("no ClickUp card");
  expect(invoked).toEqual([]);
  expect(rpcs).toEqual([]);
});

const STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb";
const HAPPY = "4e3924e3-4898-4e98-aca1-cc1ac3015b73";
function board(readBack = true) {
  const calls: string[] = [];
  let comment = "";
  const options = {
    [STATUS]: [{ id: "opt-active", name: "Active", orderindex: 5 }],
    [HAPPY]: [{ id: "opt-risk", name: "At Risk", orderindex: 3 }],
  };
  const values: Record<string, unknown> = {};
  const provider: any = {
    async call(method: string, path: string, body?: any) {
      calls.push(`${method} ${path}`);
      if (path === "list/901816559981/field")
        return {
          fields: Object.entries(options).map(([id, opts]) => ({
            id,
            type_config: { options: opts },
          })),
        };
      const set = path.match(/^task\/task-a\/field\/(.+)$/);
      if (set) {
        const opt = (options as any)[set[1]].find(
          (o: any) => o.id === body.value,
        );
        values[set[1]] = readBack ? opt.orderindex : 0;
        return {};
      }
      if (path === "task/task-a")
        return {
          custom_fields: Object.entries(options).map(([id, opts]) => ({
            id,
            value: values[id],
            type_config: { options: opts },
          })),
        };
      if (method === "POST" && path === "task/task-a/comment") {
        comment = body.comment_text;
        return { id: "c1" };
      }
      if (path === "task/task-a/comment")
        return { comments: [{ id: "c1", comment_text: comment }] };
      throw Error("unexpected " + path);
    },
  };
  return { provider, calls, values };
}
const context = {
  day: "2026-10-12",
  taskId: "task-a",
  clientName: "City Wood",
  evidence: "Check-in due",
};

test("the API sets the stage option on the Clients board and reads it back", async () => {
  const { provider, calls, values } = board();
  const plan = await prepareCsm(
    "act",
    { kind: "stage", action: "Moved to Active", value: "Active" },
    context,
    provider,
  );
  expect(plan.updates).toEqual([{ field: STATUS, value: "opt-active" }]);
  const done = await executeCsm(plan, provider);
  expect(done.result.commentId).toBe("c1");
  expect(done.patch).toEqual({ stage: "Active" });
  expect(values[STATUS]).toBe(5);
  expect(calls).toContain(`POST task/task-a/field/${STATUS}`);
});

test("the API sets happiness, and a value ClickUp does not offer is refused before any write", async () => {
  const { provider } = board();
  const plan = await prepareCsm(
    "act",
    { kind: "happiness", action: "Happiness set to At Risk", value: "At Risk" },
    context,
    provider,
  );
  expect((await executeCsm(plan, provider)).patch).toEqual({
    happiness: "At Risk",
  });
  const fresh = board();
  await expect(
    prepareCsm(
      "act",
      { kind: "happiness", action: "x", value: "Ecstatic" },
      context,
      fresh.provider,
    ),
  ).rejects.toThrow('does not offer the value "Ecstatic"');
  expect(fresh.calls.filter(c => c.startsWith("POST"))).toEqual([]);
});

test("a field ClickUp did not keep fails the read-back", async () => {
  const { provider } = board(false);
  const plan = await prepareCsm(
    "act",
    { kind: "stage", action: "Moved to Active", value: "Active" },
    context,
    provider,
  );
  await expect(executeCsm(plan, provider)).rejects.toThrow("read-back");
});

// --- Build 5 (docs/forms/STAGE2B-CONTRACT.md 4.5): the card's dates as date-only noon Kuwait --------

const LAST_POC = "e183f2ce-8b7a-491a-b160-2287a247758b";
const LAST_CALL = "032203ad-e327-4d76-a0ce-c07496da6486";
const NEXT_POC = "c48c1323-ca6a-465f-84cb-8c24f0f62df3";
const REPORT = "f1e2d3c4-0000-4000-8000-00000000report";
const noon = (d: string) => Date.parse(`${d}T09:00:00Z`);

/** A Clients board that keeps a date-only value at ClickUp's own hour (03:00Z or 04:00Z) on its day. */
function datedBoard(opts: { hour?: number; shift?: number } = {}) {
  const posts: { path: string; body: any }[] = [];
  const values: Record<string, unknown> = {};
  let comment = "";
  const provider: any = {
    async call(method: string, path: string, body?: any) {
      if (path === "list/901816559981/field")
        return {
          fields: [{ id: REPORT, name: "Last Report Sent ", type: "date" }],
        };
      const set = path.match(/^task\/task-a\/field\/(.+)$/);
      if (method === "POST" && set) {
        posts.push({ path, body });
        const day = new Date(Number(body.value)).toISOString().slice(0, 10);
        const kept = new Date(
          Date.parse(`${day}T00:00:00Z`) + (opts.shift ?? 0) * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        values[set[1]] = String(
          Date.parse(`${kept}T0${opts.hour ?? 3}:00:00Z`),
        );
        return {};
      }
      if (method === "GET" && path === "task/task-a")
        return {
          custom_fields: Object.entries(values).map(([id, value]) => ({
            id,
            value,
          })),
        };
      if (method === "POST" && path === "task/task-a/comment") {
        comment = body.comment_text;
        return { id: "c1" };
      }
      if (path === "task/task-a/comment")
        return { comments: [{ id: "c1", comment_text: comment }] };
      throw Error(`unexpected ${method} ${path}`);
    },
  };
  return { provider, posts, values };
}

describe("build 5: the card's dates", () => {
  test("Log a call writes Last POC and Last Check-in Call as date-only noon Kuwait", async () => {
    const { provider, posts } = datedBoard();
    const plan = await prepareCsm(
      "act",
      { kind: "call", action: "Held a call" },
      context,
      provider,
    );
    expect(plan.updates).toEqual([
      { field: LAST_POC, value: noon("2026-10-12"), day: "2026-10-12" },
      { field: LAST_CALL, value: noon("2026-10-12"), day: "2026-10-12" },
    ]);
    await executeCsm(plan, provider);
    expect(posts).toEqual([
      {
        path: `task/task-a/field/${LAST_POC}`,
        body: { value: noon("2026-10-12"), value_options: { time: false } },
      },
      {
        path: `task/task-a/field/${LAST_CALL}`,
        body: { value: noon("2026-10-12"), value_options: { time: false } },
      },
    ]);
  });

  for (const hour of [3, 4])
    test(`the read-back passes when ClickUp keeps the day at 0${hour}:00Z`, async () => {
      const { provider, values } = datedBoard({ hour });
      const plan = await prepareCsm(
        "act",
        { kind: "call", action: "Held a call" },
        context,
        provider,
      );
      const done = await executeCsm(plan, provider);
      expect(done.result.ok).toBe(true);
      expect(values[LAST_POC]).toBe(
        String(Date.parse(`2026-10-12T0${hour}:00:00Z`)),
      );
    });

  test("the read-back still rejects another day", async () => {
    const { provider } = datedBoard({ shift: -1 });
    const plan = await prepareCsm(
      "act",
      { kind: "touchpoint", action: "Touchpoint" },
      context,
      provider,
    );
    await expect(executeCsm(plan, provider)).rejects.toThrow("read-back");
    expect(
      fieldMatches(
        {
          custom_fields: [
            { id: LAST_POC, value: String(Date.parse("2026-10-11T03:00:00Z")) },
          ],
        },
        LAST_POC,
        noon("2026-10-12"),
        "2026-10-12",
      ),
    ).toBe(false);
    expect(
      fieldMatches(
        {
          custom_fields: [
            { id: LAST_POC, value: String(Date.parse("2026-10-12T04:00:00Z")) },
          ],
        },
        LAST_POC,
        noon("2026-10-12"),
        "2026-10-12",
      ),
    ).toBe(true);
    expect(
      fieldMatches(
        { custom_fields: [{ id: LAST_POC }] },
        LAST_POC,
        noon("2026-10-12"),
        "2026-10-12",
      ),
    ).toBe(false);
  });

  test("a touchpoint writes Last POC only; booked writes Next POC; report writes Last report sent", async () => {
    const touch = datedBoard();
    await executeCsm(
      await prepareCsm(
        "act",
        { kind: "touchpoint", action: "Touchpoint" },
        context,
        touch.provider,
      ),
      touch.provider,
    );
    expect(touch.posts.map(p => p.path)).toEqual([
      `task/task-a/field/${LAST_POC}`,
    ]);
    const booked = datedBoard();
    await executeCsm(
      await prepareCsm(
        "act",
        { kind: "booked", action: "Booked", value: "2026-10-20" },
        context,
        booked.provider,
      ),
      booked.provider,
    );
    expect(booked.posts).toEqual([
      {
        path: `task/task-a/field/${NEXT_POC}`,
        body: { value: noon("2026-10-20"), value_options: { time: false } },
      },
    ]);
    const report = datedBoard();
    const plan = await prepareCsm(
      "act",
      { kind: "report", action: "Report sent" },
      context,
      report.provider,
    );
    expect(plan.updates).toEqual([
      { field: REPORT, value: noon("2026-10-12"), day: "2026-10-12" },
    ]);
    await executeCsm(plan, report.provider);
    expect(report.posts[0].body).toEqual({
      value: noon("2026-10-12"),
      value_options: { time: false },
    });
  });

  test("an option field keeps its plain body; task due dates stay 09:00 Kuwait", async () => {
    const { provider, calls } = board();
    const plan = await prepareCsm(
      "act",
      { kind: "stage", action: "Moved to Active", value: "Active" },
      context,
      provider,
    );
    expect(plan.updates).toEqual([{ field: STATUS, value: "opt-active" }]);
    await executeCsm(plan, provider);
    expect(calls).toContain(`POST task/task-a/field/${STATUS}`);
    const planned = await prepareCsm(
      "plan",
      {
        items: [
          { text: "Follow up", clientName: "City Wood", dueDate: "2026-10-14" },
        ],
      },
      context,
      provider,
    );
    expect(planned.tasks[0].due_date).toBe(
      Date.parse("2026-10-14T09:00:00+03:00"),
    );
    const ticket = await prepareCsm(
      "act",
      { kind: "ticket", action: "Fix the form", department: "tech" },
      context,
      provider,
    );
    expect(ticket.ticket?.due_date).toBe(
      Date.parse("2026-10-14T09:00:00+03:00"),
    );
  });

  test("fieldDay validates the day as before", () => {
    expect(fieldDay("2026-10-12")).toBe(noon("2026-10-12"));
    expect(() => fieldDay("2026-02-30")).toThrow("Choose a valid date");
    expect(() => fieldDay("12 Oct")).toThrow("Choose a valid date");
  });

  test("logCall sends kind call with no notes key", async () => {
    for (const note of ["", "  Talked about the new offer.  "]) {
      const { client, invoked, rpcs } = fakeClient();
      expect(
        await logCall(
          client,
          { taskId: "86eyt1d33", _id: "c-1", name: "City Wood" },
          note,
        ),
      ).toBe("Saved, ClickUp updated");
      expect(invoked).toHaveLength(1);
      expect(invoked[0].args.kind).toBe("call");
      expect("notes" in invoked[0].args).toBe(false);
      expect(invoked[0].args).toEqual({
        clientId: "c-1",
        taskId: "86eyt1d33",
        action: "Held a call",
        kind: "call",
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      expect(rpcs[0].name).toBe("cockpit_csm_log_manual_call");
    }
  });
});
