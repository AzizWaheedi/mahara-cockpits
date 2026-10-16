/**
 * Made-up Meta answers for the meta-ad-days tests, shaped like the read-only
 * Graph v25.0 reads of 2026-10-16 (ad level, time_increment=1): a video ad on a
 * lead campaign, an image ad, a messaging (engagement) campaign that reports
 * `lead` actions, a website (sales) campaign with landing page views, and a
 * video row where Meta drops the quartiles nobody reached, and a WhatsApp lead
 * ad set on a lead campaign. No real ids, names
 * or numbers. Test-only: index.ts never imports it.
 */
import type { Row } from "./graph.ts";

export const TOKEN = "EAAB-fixture-token-not-real";
export const KUWAIT_ACCOUNT = "1111111111111";
export const LA_ACCOUNT = "5555555555555";
export const SAR_ACCOUNT = "2222222222222";
export const MAHARA_OWN = "746108264865897";

/** 16 Oct 2026 01:30 Kuwait = 15 Oct 15:30 in Los Angeles. */
export const NOW = Date.parse("2026-10-16T01:30:00+03:00");

const v = (value: number | string) => [{ action_type: "video_view", value: String(value) }];

export function videoLeadRow(day: string, over: Row = {}): Row {
  return {
    campaign_id: "120000000000101",
    campaign_name: "Leads | Riyadh",
    objective: "OUTCOME_LEADS",
    adset_id: "120000000000102",
    adset_name: "Leads|CBO|broad",
    ad_id: "120000000000103",
    ad_name: "ad-3",
    date_start: day,
    date_stop: day,
    spend: "6.87",
    impressions: "199",
    reach: "184",
    frequency: "1.081522",
    inline_link_clicks: "4",
    actions: [
      { action_type: "post_engagement", value: "36" },
      { action_type: "video_view", value: "33" },
      { action_type: "link_click", value: "4" },
      { action_type: "lead", value: "2" },
      { action_type: "onsite_conversion.lead_grouped", value: "2" },
    ],
    video_play_actions: v(188),
    video_p25_watched_actions: v(13),
    video_p50_watched_actions: v(5),
    video_p75_watched_actions: v(2),
    video_p100_watched_actions: v(1),
    video_thruplay_watched_actions: v(3),
    ...over,
  };
}

export function imageLeadRow(day: string, over: Row = {}): Row {
  return {
    campaign_id: "120000000000101",
    campaign_name: "Leads | Riyadh",
    objective: "OUTCOME_LEADS",
    adset_id: "120000000000102",
    adset_name: "Leads|CBO|broad",
    ad_id: "120000000000104",
    ad_name: "static-1",
    date_start: day,
    date_stop: day,
    spend: "12.10",
    impressions: "1500",
    reach: "1300",
    frequency: "1.153846",
    inline_link_clicks: "20",
    actions: [
      { action_type: "link_click", value: "20" },
      { action_type: "lead", value: "1" },
    ],
    ...over,
  };
}

/** A messaging campaign: Meta counts messaging leads as `lead` (38 on one account in October), none of them form leads. */
export function engagementRow(day: string, over: Row = {}): Row {
  return {
    campaign_id: "120000000000201",
    campaign_name: "New Engagement Campaign",
    objective: "OUTCOME_ENGAGEMENT",
    adset_id: "120000000000202",
    adset_name: "Replies",
    ad_id: "120000000000203",
    ad_name: "engagement-1",
    date_start: day,
    date_stop: day,
    spend: "14.00",
    impressions: "3000",
    reach: "2500",
    frequency: "1.2",
    inline_link_clicks: "90",
    actions: [
      { action_type: "onsite_conversion.lead", value: "4" },
      { action_type: "lead", value: "4" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "30" },
    ],
    ...over,
  };
}

/**
 * A WhatsApp lead ad set on a lead campaign (OUTCOME_LEADS, destination
 * WHATSAPP, optimised for conversations): the shape of Pidco's rows read on
 * 2026-10-16. Meta's `lead` here is leads marked in WhatsApp chats
 * (onsite_conversion.lead), not form leads.
 */
export function whatsappLeadRow(day: string, over: Row = {}): Row {
  return {
    campaign_id: "120000000000401",
    campaign_name: "CBO - lead - Contracting",
    objective: "OUTCOME_LEADS",
    adset_id: "120000000000402",
    adset_name: "Contracting mix",
    ad_id: "120000000000403",
    ad_name: "whatsapp-1",
    date_start: day,
    date_stop: day,
    spend: "50.58",
    impressions: "4100",
    reach: "3300",
    frequency: "1.242424",
    inline_link_clicks: "95",
    actions: [
      { action_type: "lead", value: "3" },
      { action_type: "onsite_conversion.lead", value: "3" },
      { action_type: "onsite_web_lead", value: "3" },
      { action_type: "onsite_conversion.lead_grouped", value: "3" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "83" },
    ],
    ...over,
  };
}

/** The ad sets above and where each leads: an instant form (ON_AD) or a WhatsApp chat. */
export const DESTINATIONS: Record<string, string> = {
  "120000000000102": "ON_AD",
  "120000000000402": "WHATSAPP",
};

/** A website (sales) campaign: landing page views, no lead form. */
export function websiteRow(day: string, over: Row = {}): Row {
  return {
    campaign_id: "120000000000301",
    campaign_name: "Sales | Website",
    objective: "OUTCOME_SALES",
    adset_id: "120000000000302",
    adset_name: "Website",
    ad_id: "120000000000303",
    ad_name: "web-1",
    date_start: day,
    date_stop: day,
    spend: "40.00",
    impressions: "5000",
    reach: "4100",
    frequency: "1.219512",
    inline_link_clicks: "60",
    actions: [
      { action_type: "link_click", value: "60" },
      { action_type: "landing_page_view", value: "45" },
    ],
    ...over,
  };
}

/** A short video where nobody reached 75% or the end: Meta leaves those fields out. */
export function shortVideoRow(day: string): Row {
  const { video_p75_watched_actions: _a, video_p100_watched_actions: _b, ...rest } = videoLeadRow(day, {
    ad_id: "120000000000105",
    ad_name: "ad-short",
    video_play_actions: v(20),
    video_p25_watched_actions: v(3),
    video_p50_watched_actions: v(1),
    actions: [{ action_type: "link_click", value: "0" }],
  });
  return rest;
}

export function edgeAccount(id: string, name: string, currency: string, tz: string, spend: number | null, status = 1): Row {
  return {
    id: `act_${id}`,
    name,
    currency,
    timezone_name: tz,
    account_status: status,
    ...(spend === null ? {} : { insights: { data: [{ spend: String(spend), date_start: "2026-10-14", date_stop: "2026-10-17" }] } }),
  };
}
