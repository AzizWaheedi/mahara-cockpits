import { expect, test } from "bun:test";
import {
  prepareCsm,
  executeCsm,
} from "../../../supabase/functions/cockpit-csm-api/core";
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
