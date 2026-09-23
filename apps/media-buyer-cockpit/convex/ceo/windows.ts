import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { adsPayload } from "./adapters/b2bAds";
import { type ContentWindow, contentWindow } from "./content";
import { requireCeo } from "./gate";
import type { B2bAdsPayload } from "./payloads";

/**
 * Any run of days, on demand.
 *
 * Aziz, 2026-09-22: "I should be able to see the metrics on a custom
 * timeframe, not just 7 days or 30 days. This goes across the whole CEO
 * cockpit."
 *
 * The growth tabs already do this from their daily series. Two sections
 * cannot: the ads tree is thousands of ad-days and the content split is a
 * classification, so neither can be summed on the screen from a stored
 * series without either shipping the whole history or inventing a second
 * definition of every number. Instead the same query runs again for the days
 * asked for. One definition, one set of rules, exact bounds.
 *
 * The ads read asks for the same run of days twice, so the screen reads one
 * window and every verdict judges it against itself.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Meta keeps ad-level insights for 37 months; the snapshots start well after. */
const EARLIEST = "2025-01-01";

export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => requireCeo({ ...ctx, userId }),
});

function bounds(from: string, to: string): { from: string; to: string } {
  if (!DAY.test(from) || !DAY.test(to))
    throw new Error("Pick both dates first.");
  if (from > to) throw new Error("The first date has to come before the last.");
  if (from < EARLIEST)
    throw new Error(`There is nothing recorded before ${EARLIEST}.`);
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );
  if (days > 730)
    throw new Error("Two years is the longest window this can read at once.");
  return { from, to };
}

export const ads = authenticatedAction({
  args: { from: v.string(), to: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<B2bAdsPayload> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    const b = bounds(a.from, a.to);
    const { payload } = await adsPayload(b.from, b.from, b.to);
    return payload;
  },
});

export const content = authenticatedAction({
  args: { from: v.string(), to: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<ContentWindow> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    const b = bounds(a.from, a.to);
    return contentWindow(b.from, b.to);
  },
});
