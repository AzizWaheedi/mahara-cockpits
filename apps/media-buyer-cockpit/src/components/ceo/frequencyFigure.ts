import { count, plural } from "@/components/ceo/format";
import type { FrequencyFigure } from "@/types/ceo/frequency";

/**
 * How many campaigns a reach and frequency figure covers, counting only the
 * ones that delivered (impressions above 0) in the window.
 *
 * The audit of 2026-10-16: the Marketing card said "10 campaigns" for 18 Jul
 * to 15 Oct, every campaign whose name says lead gen, when only 4 delivered
 * and 2 of the 10 were traffic or likes campaigns. The totals were right; the
 * count was not. The Edge Function (`cockpit-ceo-api/frequency.ts`) now sends
 * the delivered count as `campaigns` and every campaign of the kind as
 * `listed`, and reads a saved figure without `listed` again.
 */
export function deliveredCampaigns(f: FrequencyFigure): number {
  const n = f.campaigns;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** "4 of 10 campaigns delivered" under the spend; "4 campaigns delivered" without `listed`. */
export function deliveredLine(f: FrequencyFigure): string {
  const n = deliveredCampaigns(f);
  const listed = f.listed;
  return typeof listed === "number" && Number.isFinite(listed) && listed >= n
    ? `${count(n)} of ${plural(listed, "campaign")} delivered`
    : `${plural(n, "campaign")} delivered`;
}

export const SPEND_HINT =
  "Spend in this timeframe. Delivered counts the campaigns of this kind with at least one impression in it; a campaign that showed nothing is left out of the count.";
