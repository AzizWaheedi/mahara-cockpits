/**
 * The ads behind an account's ad-days, for the creative dashboard (Muhammed,
 * 2026-10-18: meta-ad-days is the one Meta ad reader, and the dashboard takes
 * Meta from it through cockpit_meta_feed_run). Stored by
 * cockpit_meta_ads_apply in cockpit_meta_ads.
 *
 * GET act_<id>/ads with the fields and status filter of the dashboard's own
 * read (mahara-creative-dashboard lib/meta-fetch.ts, verified live there): the
 * ad's name and effective status, its campaign and the campaign's status, and
 * the creative's images at 720x405. The creative makes the pages heavy: on a
 * 301-ad account Meta refused 500 and 200 ads a page and took 100, so a read
 * asks for 50, then 25, then 10 when Meta says the answer is too big.
 *
 * The hourly run asks for the statuses the dashboard shows. The nightly run
 * and a backfill ask for every status the edge lists (all but DELETED, which
 * Meta refuses as a filter), so the database marks an ad that read no longer
 * returns as DELETED.
 *
 * The thumbnail is the sharpest image an ad blocker does not drop (the
 * dashboard's lib/thumbnails.ts): uBlock, AdGuard and Brave Shields drop any
 * link with /ads/ in its path, which Meta's larger images often have.
 */
import { type GraphDeps, MetaError, metaPages, type Row } from "./graph.ts";
import { ParseError } from "./parse.ts";

export const AD_FIELDS = [
  "id",
  "name",
  "effective_status",
  "campaign{id,name,effective_status}",
  "creative.thumbnail_width(720).thumbnail_height(405){thumbnail_url,image_url,object_story_spec{link_data{picture},video_data{image_url}}}",
].join(",");

/** The statuses the dashboard shows: its scheduled read's filter. */
export const SHOWN_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES", "IN_PROCESS", "PENDING_REVIEW"];
/** Every status the ads edge lists; DELETED is refused as a filter value. */
export const LISTED_STATUSES = [...SHOWN_STATUSES, "ARCHIVED", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];

const PAGE_SIZES = [50, 25, 10];
/** The most ads one account read keeps (cockpit_meta_ads_apply takes 5000). */
export const MAX_ADS = 5000;

export type AdMetaRow = {
  adId: string;
  adName: string | null;
  effectiveStatus: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignStatus: string | null;
  thumbnailUrl: string | null;
};

const ID = /^[0-9]{5,25}$/;
const STATUS = /^[A-Z_]{1,40}$/;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : null);

/** A link uBlock, AdGuard or Brave Shields drops: /ads/ in its path. */
export function adBlockerDrops(url: string): boolean {
  return /facebook\.com\/ads\//i.test(url) || /\/ads\/image\b/i.test(url);
}

/** The creative's sharpest https image an ad blocker keeps, or NULL. */
export function thumbnailOf(creative: unknown): string | null {
  if (!isRow(creative)) return null;
  const spec = isRow(creative.object_story_spec) ? creative.object_story_spec : null;
  const video = spec && isRow(spec.video_data) ? spec.video_data : null;
  const link = spec && isRow(spec.link_data) ? spec.link_data : null;
  for (const url of [video?.image_url, link?.picture, creative.image_url, creative.thumbnail_url]) {
    if (typeof url === "string" && url.startsWith("https://") && url.length <= 2048 && !adBlockerDrops(url)) return url;
  }
  return null;
}

function status(v: unknown, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !STATUS.test(v)) throw new ParseError(`Meta gave ${what} "${String(v).slice(0, 30)}", which is not one of its statuses.`);
  return v;
}

/** Meta's ads rows. An ad listed twice (a page moved under the read) is kept once, as last listed. */
export function parseAds(raw: Row[]): AdMetaRow[] {
  const out = new Map<string, AdMetaRow>();
  for (const r of raw) {
    const adId = typeof r.id === "string" ? r.id.trim() : "";
    if (!ID.test(adId)) throw new ParseError(`Meta listed an ad with the id "${String(r.id).slice(0, 30)}", which is not an id.`);
    const campaign = isRow(r.campaign) ? r.campaign : null;
    const campaignId = campaign && typeof campaign.id === "string" ? campaign.id.trim() : null;
    if (campaignId !== null && !ID.test(campaignId)) throw new ParseError(`Meta gave ad ${adId} the campaign id "${campaignId.slice(0, 30)}", which is not an id.`);
    out.set(adId, {
      adId,
      adName: text(r.name),
      effectiveStatus: status(r.effective_status, `ad ${adId} the status`),
      campaignId,
      campaignName: campaign ? text(campaign.name) : null,
      campaignStatus: campaign ? status(campaign.effective_status, `ad ${adId}'s campaign the status`) : null,
      thumbnailUrl: thumbnailOf(r.creative),
    });
  }
  return [...out.values()];
}

/**
 * Every ad of the account with the statuses asked for: the shown ones, or
 * every listed one when `complete`. Smaller pages when Meta finds the answer
 * too big; any other refusal is thrown.
 */
export async function readAds(graph: GraphDeps, accountId: string, complete: boolean): Promise<AdMetaRow[]> {
  const effective_status = JSON.stringify(complete ? LISTED_STATUSES : SHOWN_STATUSES);
  let last: unknown = null;
  for (const limit of PAGE_SIZES) {
    try {
      const raw = await metaPages(graph, `act_${accountId}/ads`, { fields: AD_FIELDS, effective_status, limit }, Math.ceil(MAX_ADS / limit));
      return parseAds(raw);
    } catch (e) {
      if (!(e instanceof MetaError && e.kind === "heavy")) throw e;
      last = e;
    }
  }
  throw last;
}

/** The rows cockpit_meta_ads_apply takes (the table's own names). */
export function toAdsApplyRow(r: AdMetaRow): Record<string, unknown> {
  return {
    ad_id: r.adId,
    ad_name: r.adName,
    effective_status: r.effectiveStatus,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    campaign_status: r.campaignStatus,
    thumbnail_url: r.thumbnailUrl,
  };
}
