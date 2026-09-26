import { expect, test } from "bun:test";
import { requireCeo } from "../convex/ceo/gate";
import { get, save } from "../convex/ceo/webinarTargets";
import { WEBINAR_TARGETS } from "../convex/ceo/webinarTargetsModel";

// Invoke the actual registered action, including the authentication wrapper.
const invoke = (action: unknown, ctx: unknown, args: unknown) =>
  (
    action as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
  )._handler(ctx, args);
const args = {
  scope: "defaults",
  expectedRevision: 0,
  values: WEBINAR_TARGETS,
  requestId: "00000000-0000-4000-8000-000000000001",
};
test("unauthenticated requests are rejected before any server call", async () => {
  const ctx = {
    auth: { getUserIdentity: async () => null },
    runQuery: async () => {
      throw new Error("Should never reach gate");
    },
  };
  await expect(invoke(get, ctx, { scope: "defaults" })).rejects.toThrow(
    "Not authenticated",
  );
  await expect(invoke(save, ctx, args)).rejects.toThrow("Not authenticated");
});
test("a non-founder administrator cannot load or save targets", async () => {
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user|session" }) },
    runQuery: async () =>
      requireCeo({
        userId: "user",
        db: { get: async () => ({ email: "admin@example.com", role: "ceo" }) },
      }),
  };
  await expect(invoke(get, ctx, { scope: "defaults" })).rejects.toThrow(
    "Aziz's own",
  );
  await expect(invoke(save, ctx, args)).rejects.toThrow("Aziz's own");
});
test("server validation rejects malformed target saves after the founder gate", async () => {
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user|session" }) },
    runQuery: async () => "aziz@maharamedia.com",
  };
  await expect(
    invoke(save, ctx, { ...args, values: { plannedSpend: -1 } }),
  ).rejects.toThrow("Check the target values");
  await expect(
    invoke(save, ctx, { ...args, expectedRevision: 0.5 }),
  ).rejects.toThrow("Check the target values");
});
