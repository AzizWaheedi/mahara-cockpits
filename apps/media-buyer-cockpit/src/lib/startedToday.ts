import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The campaigns that started spending today, from
 * `cockpit_media_started_today` (migration 20261104b). The cockpit's Ads list
 * shows a campaign once it has a full day of spend, so a campaign switched on
 * today is missing from it until after midnight; this read gives it a row
 * straight away with today's figures from Meta's hourly read, and the ClickUp
 * card when the ads board has one. Rows may have started yesterday (startedOn)
 * when the sync has not listed them yet (migration 20261105a).
 */

export type StartedTodayRow = {
  campaignId: string;
  campaignName: string;
  accountId: string;
  accountName: string | null;
  clientName: string | null;
  currency: string | null;
  startedOn: string | null;
  /** Spend in the ad account's own currency. */
  spend: number;
  /** The same spend in USD, when the read can convert it. */
  spendUsd: number | null;
  leads: number;
  impressions: number;
  linkClicks: number;
  ads: number;
  fetchedAt: string | null;
  card: {
    taskId: string;
    url: string | null;
    adStatus: string | null;
  } | null;
};

export type StartedTodayRead = {
  day: string;
  feedAt: string | null;
  rows: StartedTodayRow[];
};

const SHAPE = "The started-today read returned an unexpected shape.";

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

function num(v: unknown): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : 0;
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function card(v: unknown): StartedTodayRow["card"] {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (typeof c.taskId !== "string") return null;
  return { taskId: c.taskId, url: text(c.url), adStatus: text(c.adStatus) };
}

/** The read checked: a wrong shape throws, a missing figure stays null. */
export function parseStartedToday(data: unknown): StartedTodayRead {
  const d = data as Record<string, unknown> | null;
  if (
    !d ||
    typeof d !== "object" ||
    typeof d.day !== "string" ||
    !Array.isArray(d.rows)
  )
    throw new Error(SHAPE);
  const rows = (d.rows as Record<string, unknown>[]).map(r => {
    if (!r || typeof r !== "object") throw new Error(SHAPE);
    if (typeof r.campaignId !== "string" || typeof r.campaignName !== "string")
      throw new Error(SHAPE);
    return {
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      accountId: typeof r.accountId === "string" ? r.accountId : "",
      accountName: text(r.accountName),
      clientName: text(r.clientName),
      currency: text(r.currency),
      startedOn: text(r.startedOn),
      spend: num(r.spend),
      spendUsd: numOrNull(r.spendUsd),
      leads: num(r.leads),
      impressions: num(r.impressions),
      linkClicks: num(r.linkClicks),
      ads: num(r.ads),
      fetchedAt: text(r.fetchedAt),
      card: card(r.card),
    };
  });
  return { day: d.day, feedAt: text(d.feedAt), rows };
}

/** One read over today. */
export async function readStartedToday(
  client: SupabaseClient,
): Promise<StartedTodayRead> {
  const { data, error } = await client.rpc("cockpit_media_started_today");
  if (error) throw new Error(error.message);
  return parseStartedToday(data);
}
