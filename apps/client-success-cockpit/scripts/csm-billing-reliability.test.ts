import { afterAll, beforeEach, expect, test } from "bun:test";
import {
  type FakeApp,
  makeApp,
  restoreGlobals,
  setNow,
  web,
} from "./usage/fakeCtx";

let app: FakeApp;
let user: string;
let posts = 0;
let fail = false;
let privateClient = false;
let failDate = false;
const payment = {
  requestId: "payment-request-0001",
  taskId: "client-one",
  day: "2026-10-03",
  amount: 250,
  currency: "USD",
  rail: "cash",
};
beforeEach(async () => {
  setNow(Date.parse("2026-10-03T08:00:00Z"));
  web.clear();
  posts = 0;
  fail = false;
  privateClient = false;
  failDate = false;
  app = await makeApp(undefined, {
    env: {
      CLICKUP_API_TOKEN: "synthetic",
      SUPABASE_URL: "https://billing.test",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic",
    },
  });
  user = await app.makeUser({ email: "billing@example.test" });
  app.seed("portalMembers", [
    {
      email: "billing@example.test",
      roles: ["csm"],
      clients: ["Example Design"],
      at: Date.now(),
    },
  ]);
  web.on("https://api.clickup.com/", req => {
    if (req.method === "POST" && failDate)
      throw new Error("Date update failed");
    if (new URL(req.url).pathname.endsWith("/field")) return { fields: [] };
    return {
      id: "client-one",
      name: privateClient ? "Private Design" : "Example Design",
      list: { id: "901816559981" },
      custom_fields: [],
    };
  });
  web.on("https://billing.test/", req => {
    if (new URL(req.url).pathname.endsWith("/cockpit_billing_inbox")) {
      posts++;
      if (fail) throw new Error("Lost response");
      return [{ id: 42 }];
    }
    return [];
  });
});
afterAll(restoreGlobals);
const run = (args: Record<string, unknown> = payment) =>
  app.run("billing:logPayment", args, { as: user });
test("duplicate payment requests return one durable inbox receipt", async () => {
  const first = await run();
  expect(first).toContain("inbox 42");
  expect(await run()).toBe(first);
  expect(posts).toBe(1);
});
test("uncertain payment response blocks another insertion", async () => {
  fail = true;
  await expect(run()).rejects.toThrow(/not confirmed/);
  fail = false;
  await expect(run()).rejects.toThrow(/already be recorded/);
  expect(posts).toBe(1);
});
test("payment receipt is retained if the next-date update fails", async () => {
  failDate = true;
  const args = { ...payment, nextDate: "2026-11-03" };
  const first = await run(args);
  expect(first).toContain("date update needs checking");
  expect(await run(args)).toBe(first);
  expect(posts).toBe(1);
});
test("a reused request ID cannot silently change a payment", async () => {
  await run();
  await expect(run({ ...payment, amount: 300 })).rejects.toThrow(
    /request has changed/,
  );
  expect(posts).toBe(1);
});
test("scope and old-client refresh checks run before payment writes", async () => {
  privateClient = true;
  await expect(run()).rejects.toThrow(/not yours/);
  expect(posts).toBe(0);
  const { requestId, ...legacy } = payment;
  await expect(run(legacy)).rejects.toThrow(/Refresh/);
  expect(posts).toBe(0);
});
