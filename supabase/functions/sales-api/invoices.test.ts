// bun test supabase/functions/sales-api/invoices.test.ts
import { expect, test } from "bun:test";
import { makeInvoices, requestArgs } from "./invoices.ts";

const who = { signed_in: true, seat: true, email: "rep@x.com" };

test("only the form's fields go up, marked as the sales cockpit's", () => {
  const out = requestArgs({ taskId: "t1", kind: "checkout", amount: "1500", createLink: true, provider: "whop", app: "client-success", extra: "x" });
  expect(out).toEqual({ taskId: "t1", kind: "checkout", amount: "1500", createLink: true, provider: "whop", app: "sales" });
  expect(() => requestArgs(null)).toThrow("Fill in the form");
  expect(() => requestArgs([1])).toThrow("Fill in the form");
});

test("requests and changes go to the database as the rep, with the sales app named", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const { actions } = makeInvoices({ rpcAsUser: async (_w, fn, args) => { calls.push([fn, args]); return { id: "i1" }; } });
  expect(await actions["invoice.request"](who, { args: { taskId: "t1", kind: "paid" } })).toEqual({ invoice: { id: "i1" } });
  const id = "8f3f1e1a-7783-43bf-915f-417943674cac";
  await actions["invoice.change"](who, { id, change: "whop" });
  expect(calls).toEqual([
    ["cockpit_invoice_request", { p_args: { taskId: "t1", kind: "paid", app: "sales" } }],
    ["cockpit_invoice_change", { p_id: id, p_action: "whop", p_app: "sales" }],
  ]);
  await expect(actions["invoice.change"](who, { id, change: "delete" })).rejects.toThrow("Unknown invoice action");
  await expect(actions["invoice.change"](who, { id: "nope", change: "cancel" })).rejects.toThrow("Which invoice");
});
