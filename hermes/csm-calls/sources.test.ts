import { expect, test } from "bun:test";
import type { Db } from "./lib";
import type { Client } from "./match";
import { keepManual, metaAccounts } from "./sources";

const card = (taskId: string, name: string, aliases: string[] = [], stopped = false): Client => ({ taskId, name, aliases, stopped });
const fakeDb = (tables: Record<string, Record<string, unknown>[]>, asked: string[] = []) =>
  ({ all: async (table: string, query: string) => (asked.push(`${table}?${query}`), tables[table] ?? []) }) as unknown as Db;

test("an enrolled billing account is read even when no name matches its client", async () => {
  // 22 Oct 2026: Safad's Meta account is named "Safad Consulting" and its only campaign row was deleted.
  const clients = [card("86ewvnqgz", "Safad Consultant Engineering", ["safad", "safad consultant engineering"]), card("old1", "Old Client", [], true)];
  const asked: string[] = [];
  const accounts = await metaAccounts(fakeDb({
    clients: [{ name: "Safad Consulting", meta_ad_account_id: "act_774492648699300" }],
    cockpit_ad_billing_bindings: [{ client_task_id: "86ewvnqgz", account_id: "774492648699300" }, { client_task_id: "old1", account_id: "111111111" }],
  }, asked), clients);
  expect([...accounts]).toEqual([["774492648699300", "86ewvnqgz"]]);
  expect(asked).toContain("cockpit_ad_billing_bindings?select=client_task_id,account_id&enabled=eq.true");
});

test("name matches still count, and the billing watch's task id wins over a name match", async () => {
  const clients = [card("ocean", "ocean home"), card("a", "Alpha Interiors"), card("b", "Beta Build")];
  const accounts = await metaAccounts(fakeDb({
    clients: [{ name: "ocean home", meta_ad_account_id: "act_568262692064148" }],
    cockpit_campaigns: [{ client_name: "Alpha Interiors", meta_account_id: "999999999" }],
    cockpit_ad_billing_bindings: [{ client_task_id: "b", account_id: "999999999" }],
  }), clients);
  expect(accounts.get("568262692064148")).toBe("ocean");
  expect(accounts.get("999999999")).toBe("b");
});

test("a manual match cannot reattach its recording to another client's appointment", () => {
  const update = keepManual(
    { task_id: "client-b", linked_call_id: 24, match_method: "appointment_time" },
    { task_id: "client-a", linked_call_id: null, match_method: "manual" },
  );
  expect(update.task_id).toBe("client-a");
  expect(update.linked_call_id).toBeNull();
  expect(update.match_method).toBe("manual");
});
