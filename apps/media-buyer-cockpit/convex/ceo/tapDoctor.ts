import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { TAP_KEY_NAME, tapKeyState } from "./data/tap";

declare const process: { env: Record<string, string | undefined> };

/**
 * Whether this deployment has a Tap key and whether it is live: "live", "test"
 * or "missing", plus its length and whether it is the literal placeholder from
 * the docs. Never the key itself.
 */
export const keyState = internalAction({
  args: {},
  returns: v.object({
    variable: v.string(),
    state: v.string(),
    length: v.number(),
    isPlaceholder: v.boolean(),
  }),
  handler: async () => {
    const key = (process.env[TAP_KEY_NAME] ?? "").trim();
    return {
      variable: TAP_KEY_NAME,
      state: tapKeyState(),
      length: key.length,
      isPlaceholder: /^sk_(live|test)_\.{2,}$/.test(key) || key === "sk_live_...",
    };
  },
});
