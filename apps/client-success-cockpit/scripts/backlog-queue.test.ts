import { expect, test } from "bun:test";
import { queueGap } from "../src/lib/backlog";

// "Queue gap" goes through cockpit_add_plan_item: signed-in people can only
// read cockpit_plan_items (20260923p), so a direct insert always failed.
type Any = any;

function fake(answer: { error: Any } = { error: null }) {
  const rpcs: { name: string; args: Any }[] = [];
  const tables: string[] = [];
  const client = {
    rpc: async (name: string, args: Any) => {
      rpcs.push({ name, args });
      return { data: 42, ...answer };
    },
    from: (t: string) => {
      tables.push(t);
      throw new Error("no table writes");
    },
  } as Any;
  return { client, rpcs, tables };
}

const gap = {
  taskId: "86c1abc",
  clientName: "Qatar Technology",
  label: "No sheet link",
  fix: "Add the sheet to the card.",
};

test("queue gap asks the server to add the CSM plan item", async () => {
  const { client, rpcs, tables } = fake();
  await queueGap(client, "csm@tests.invalid", gap);
  expect(tables).toEqual([]);
  expect(rpcs).toHaveLength(1);
  expect(rpcs[0].name).toBe("cockpit_add_plan_item");
  expect(rpcs[0].args).toEqual({
    p_role: "csm",
    p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    p_text: "Fix: No sheet link",
    p_reason:
      "Backlog gap: No sheet link - Add the sheet to the card. (task: 86c1abc)",
    p_client_name: "Qatar Technology",
    p_list_name: "csm",
    p_due_date: null,
  });
});

test("a refusal reaches the person as a sentence", async () => {
  const { client } = fake({
    error: { message: "Permission denied for plan item role: csm" },
  });
  await expect(queueGap(client, "x", gap)).rejects.toThrow(
    "Permission denied for plan item role: csm",
  );
});
