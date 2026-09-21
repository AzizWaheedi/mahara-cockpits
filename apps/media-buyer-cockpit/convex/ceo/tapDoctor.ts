import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { TAP_KEY_NAME, tapKeyState } from "./data/tap";

/** Whether this deployment has a Tap key and whether it is live: "live", "test" or "missing". Never the key itself. */
export const keyState = internalAction({
  args: {},
  returns: v.object({ variable: v.string(), state: v.string() }),
  handler: async () => ({ variable: TAP_KEY_NAME, state: tapKeyState() }),
});
