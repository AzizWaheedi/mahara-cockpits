import { expect, test } from "bun:test";
import { submitReplacementForSeat, submitRequest } from "../src/lib/requestsClient";

test("session-bound replacement uses the identical legacy RPC and payload", async () => {
  const calls: { name: string; args: unknown; bearer?: string }[] = [];
  const session = { user: { id: "fictional-seat" }, access_token: "fictional-session-token" };
  const client: any = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
    },
    rpc: (name: string, args: unknown) => {
      const entry: { name: string; args: unknown; bearer?: string } = { name, args };
      calls.push(entry);
      const result: any = Promise.resolve({ data: { id: "fictional-request", state: "sending" }, error: null });
      result.setHeader = (key: string, value: string) => { if (key === "Authorization") entry.bearer = value; return result; };
      return result;
    },
  };
  const input = { requestId: "fictional-request", typeKey: "card_missing", clientTaskId: "fictional-client", answers: { details: "fictional" }, dueOn: null, priority: "normal" as const, source: "client_page" as const, replacesTaskId: "fictional-ticket" };
  await submitRequest(client, input);
  await submitReplacementForSeat(client, "fictional-seat", input, () => true);
  expect(calls).toHaveLength(2);
  expect(calls[1].name).toBe("cockpit_request_submit");
  expect(calls[1].args).toEqual(calls[0].args);
  expect(calls[1].bearer).toBe("Bearer fictional-session-token");
});
