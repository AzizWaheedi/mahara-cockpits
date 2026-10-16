import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { engagementRow, imageLeadRow, shortVideoRow, videoLeadRow, websiteRow, whatsappLeadRow } from "./fixtures.ts";
import {
  actionValue,
  amount,
  count,
  DAY_FIELDS,
  dedupe,
  formLeads,
  isMessagingDestination,
  leadActions,
  leadAdsetIds,
  MESSAGING_DESTINATIONS,
  ParseError,
  parseAdDay,
  parseDestinations,
  parseReach,
  toApplyRow,
  type Window,
  windowSpans,
  withDestinations,
} from "./parse.ts";

const ACC = "1111111111111";
const DAY = "2026-10-15";

describe("an ad-day row", () => {
  test("a video ad on a lead campaign: every contract column, 3-second plays from actions[video_view]", () => {
    const r = parseAdDay(videoLeadRow(DAY), ACC);
    expect(r).toEqual({
      accountId: ACC,
      day: DAY,
      campaignId: "120000000000101",
      campaignName: "Leads | Riyadh",
      objective: "OUTCOME_LEADS",
      adsetId: "120000000000102",
      adsetName: "Leads|CBO|broad",
      adId: "120000000000103",
      adName: "ad-3",
      spend: 6.87,
      impressions: 199,
      reach: 184,
      frequency: 1.081522,
      linkClicks: 4,
      leads: 2,
      leadActions: 2,
      landingPageViews: null,
      videoPlays: 188,
      video3s: 33,
      videoP25: 13,
      videoP50: 5,
      videoP75: 2,
      videoP100: 1,
      thruplays: 3,
      destinationType: null,
    });
    // The hook is 3-second plays, never every start: 33 of 199, not 188.
    expect(r.video3s).not.toBe(r.videoPlays);
  });

  test("an image ad keeps every video field NULL, never 0", () => {
    const r = parseAdDay(imageLeadRow(DAY), ACC);
    expect([r.videoPlays, r.video3s, r.videoP25, r.videoP50, r.videoP75, r.videoP100, r.thruplays]).toEqual([null, null, null, null, null, null, null]);
    expect(r.leads).toBe(1);
  });

  test("a video nobody watched to 75% or to the end: the dropped quartiles are 0, and no 3-second plays is 0", () => {
    const r = parseAdDay(shortVideoRow(DAY), ACC);
    expect([r.videoPlays, r.videoP25, r.videoP50, r.videoP75, r.videoP100, r.video3s]).toEqual([20, 3, 1, 0, 0, 0]);
  });

  test("leads come only from lead campaigns: a messaging campaign's lead actions are not leads", () => {
    const r = parseAdDay(engagementRow(DAY), ACC);
    expect(r.leads).toBeNull();
    expect(r.leadActions).toBe(4);
    const old = parseAdDay(videoLeadRow(DAY, { objective: "LEAD_GENERATION" }), ACC);
    expect(old.leads).toBe(2);
    const missing = parseAdDay(videoLeadRow(DAY, { objective: undefined }), ACC);
    expect(missing.leads).toBeNull();
  });

  test("a lead campaign with no lead action has 0 leads, because the read happened", () => {
    const r = parseAdDay(videoLeadRow(DAY, { actions: [{ action_type: "link_click", value: "3" }] }), ACC);
    expect(r.leads).toBe(0);
    expect(r.leadActions).toBe(0);
    const none = parseAdDay(videoLeadRow(DAY, { actions: undefined }), ACC);
    expect(none.leads).toBe(0);
    expect(none.video3s).toBe(0);
  });

  test("Meta's lead count without `lead`: the lead-form part plus the pixel part (lead-sync-watch's rule)", () => {
    expect(leadActions([{ action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "2" }])).toBe(5);
    expect(leadActions([{ action_type: "lead", value: "4" }, { action_type: "onsite_conversion.lead_grouped", value: "3" }])).toBe(4);
    expect(leadActions(undefined)).toBe(0);
  });

  test("a WhatsApp lead ad set on a lead campaign (Pidco's shape): its lead actions are messaging leads, not form leads", () => {
    // OUTCOME_LEADS; lead 3, onsite_conversion.lead 3, onsite_web_lead 3, lead_grouped 3, conversations started 83.
    const r = parseAdDay(whatsappLeadRow(DAY), ACC);
    expect(r.leadActions).toBe(3);
    // By action type alone: Meta's lead count less the leads marked in a chat.
    expect(r.leads).toBe(0);
    // With the ad set's destination: a chat, so no form leads at all and its spend is not spent on a form.
    const { rows, unknown } = withDestinations([r], new Map([["120000000000402", "WHATSAPP"]]));
    expect(rows[0].leads).toBeNull();
    expect(rows[0].leadActions).toBe(3);
    expect(rows[0].destinationType).toBe("WHATSAPP");
    expect(unknown).toEqual([]);
    expect(toApplyRow(rows[0])).toMatchObject({ leads: null, lead_actions: 3, destination_type: "WHATSAPP" });
  });

  test("form leads by action type: a mixed row keeps its form leads, and never goes below 0", () => {
    expect(formLeads([{ action_type: "lead", value: "5" }, { action_type: "onsite_conversion.lead", value: "2" }])).toBe(3);
    expect(formLeads([{ action_type: "onsite_conversion.lead", value: "2" }])).toBe(0);
    expect(formLeads([{ action_type: "lead", value: "4" }, { action_type: "onsite_conversion.lead_grouped", value: "4" }])).toBe(4);
    expect(formLeads(undefined)).toBe(0);
  });

  test("destinations: an instant form keeps its leads, a deleted ad set is named, other objectives are not looked up", () => {
    const form = parseAdDay(videoLeadRow(DAY), ACC);
    const wa = parseAdDay(whatsappLeadRow(DAY), ACC);
    const gone = parseAdDay(imageLeadRow(DAY, { adset_id: "120000000000999" }), ACC);
    const engagement = parseAdDay(engagementRow(DAY), ACC);
    expect(leadAdsetIds([form, wa, gone, engagement])).toEqual(["120000000000102", "120000000000402", "120000000000999"]);
    const { rows, unknown } = withDestinations(
      [form, wa, gone, engagement],
      new Map([
        ["120000000000102", "ON_AD"],
        ["120000000000402", "WHATSAPP"],
      ]),
    );
    expect(rows.map(x => [x.destinationType, x.leads])).toEqual([
      ["ON_AD", 2],
      ["WHATSAPP", null],
      [null, 1],
      [null, null],
    ]);
    expect(unknown).toEqual(["120000000000999"]);
    // Every chat destination Meta has, and only those.
    for (const d of ["WHATSAPP", "MESSENGER", "INSTAGRAM_DIRECT", "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "MESSAGING_MESSENGER_WHATSAPP", "LEAD_FROM_MESSENGER"]) {
      expect(isMessagingDestination(d)).toBe(true);
    }
    for (const d of ["ON_AD", "WEBSITE", "UNDEFINED", "WEBSITE_AND_PHONE_CALL", "ON_POST", null]) expect(isMessagingDestination(d)).toBe(false);
  });

  test("Meta's ad set list is read strictly", () => {
    const asked = ["120000000000102", "120000000000402"];
    expect(parseDestinations([{ id: "120000000000102", destination_type: "ON_AD" }, { id: "120000000000402" }], asked)).toEqual(
      new Map([
        ["120000000000102", "ON_AD"],
        ["120000000000402", null],
      ]),
    );
    expect(() => parseDestinations([{ id: "120000000000777", destination_type: "ON_AD" }], asked)).toThrow("not asked for");
    expect(() => parseDestinations([{ id: "120000000000102" }, { id: "120000000000102" }], asked)).toThrow("twice");
    expect(() => parseDestinations([{ id: "120000000000102", destination_type: "on ad" }], asked)).toThrow("not one of its names");
  });

  test("the chat destinations are the same list in parse.ts and in the table's CHECK and the apply RPC", () => {
    const sql = readFileSync(new URL("../../migrations/20261016121700_meta_ad_days.sql", import.meta.url), "utf8");
    const lists = [...sql.matchAll(/destination_type IN \(([^)]*)\)/g)].map(m => m[1].split(",").map(x => x.trim().replace(/'/g, "")));
    expect(lists.length).toBe(2);
    for (const l of lists) expect(l).toEqual(MESSAGING_DESTINATIONS);
    expect(sql.split("LIKE 'MESSAGING\\_%'").length - 1).toBe(2);
  });

  test("landing page views only where Meta lists them", () => {
    expect(parseAdDay(websiteRow(DAY), ACC).landingPageViews).toBe(45);
    expect(parseAdDay(websiteRow(DAY), ACC).leads).toBeNull();
    expect(parseAdDay(imageLeadRow(DAY), ACC).landingPageViews).toBeNull();
  });

  test("a field Meta leaves out is NULL", () => {
    const { reach: _r, frequency: _f, inline_link_clicks: _l, ...rest } = imageLeadRow(DAY);
    const r = parseAdDay(rest, ACC);
    expect([r.reach, r.frequency, r.linkClicks]).toEqual([null, null, null]);
  });

  test("anything that is not a number, a whole count or a day stops the read", () => {
    expect(() => parseAdDay(imageLeadRow(DAY, { spend: "-1" }), ACC)).toThrow(ParseError);
    expect(() => parseAdDay(imageLeadRow(DAY, { impressions: "12.5" }), ACC)).toThrow("not a whole number");
    expect(() => parseAdDay(imageLeadRow(DAY, { spend: "abc" }), ACC)).toThrow("not a count or an amount");
    expect(() => parseAdDay(imageLeadRow(DAY, { ad_id: undefined }), ACC)).toThrow("without an ad id");
    expect(() => parseAdDay(imageLeadRow(DAY, { ad_id: "act_12" }), ACC)).toThrow("not an id");
    expect(() => parseAdDay(imageLeadRow(DAY, { date_stop: "2026-10-16" }), ACC)).toThrow("a day at a time");
    expect(() => parseAdDay(imageLeadRow("15 Oct"), ACC)).toThrow("without its day");
    expect(() => parseAdDay(imageLeadRow(DAY, { actions: "lead" }), ACC)).toThrow("not a list");
  });

  test("small readers", () => {
    expect(amount("6.87", "x")).toBe(6.87);
    expect(amount(undefined, "x")).toBeNull();
    expect(count("0", "x")).toBe(0);
    expect(actionValue([{ action_type: "video_view", value: "2" }, { action_type: "video_view", value: "3" }], "video_view", "x")).toBe(5);
    expect(actionValue([], "lead", "x")).toBeNull();
  });

  test("dedupe keeps one copy of the same row and refuses two different rows for one ad and day", () => {
    const a = parseAdDay(videoLeadRow(DAY), ACC);
    expect(dedupe([a, { ...a }]).length).toBe(1);
    expect(() => dedupe([a, { ...a, spend: 1 }])).toThrow("two different rows");
  });

  test("the fields asked for cover every column the row fills", () => {
    for (const f of ["spend", "impressions", "reach", "frequency", "inline_link_clicks", "actions", "video_play_actions", "video_p25_watched_actions",
      "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions", "video_thruplay_watched_actions", "objective",
      "campaign_id", "adset_id", "ad_id", "date_start"]) {
      expect(DAY_FIELDS.split(",")).toContain(f);
    }
  });

  test("the rows sent to the database carry exactly the columns the apply RPC reads", () => {
    const sql = readFileSync(new URL("../../migrations/20261016121700_meta_ad_days.sql", import.meta.url), "utf8");
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_apply"), sql.indexOf("CREATE OR REPLACE FUNCTION public.cockpit_meta_reach_apply"));
    // The record definition of the INSERT's jsonb_to_recordset.
    const insert = body.slice(body.indexOf("INSERT INTO public.cockpit_meta_ad_days"));
    const def = insert.match(/jsonb_to_recordset\(v_rows\) AS r\(([\s\S]*?)\)\n/)?.[1] ?? "";
    const columns = def.split(",").map(c => c.trim().split(/\s+/)[0]).filter(Boolean);
    const sent = Object.keys(toApplyRow(parseAdDay(videoLeadRow(DAY), ACC)));
    expect(columns.length).toBeGreaterThan(20);
    for (const c of columns) expect(sent).toContain(c);
    expect(sent.filter(k => !columns.includes(k))).toEqual(["account_id"]);
  });
});

describe("reach over windows", () => {
  const W: Window[] = [
    { key: "last_7", from: "2026-10-10", to: "2026-10-16" },
    { key: "last_month", from: "2026-09-01", to: "2026-09-30" },
  ];

  test("each row goes to its window by its dates", () => {
    const rows = parseReach(
      [
        { ad_id: "120000000000103", impressions: "2659", reach: "1893", date_start: "2026-10-10", date_stop: "2026-10-16" },
        { ad_id: "120000000000103", impressions: "193", reach: "176", date_start: "2026-09-01", date_stop: "2026-09-30" },
      ],
      "ad",
      W,
      ACC,
    );
    expect(rows).toEqual([
      { key: "120000000000103", windowKey: "last_7", reach: 1893, impressions: 2659 },
      { key: "120000000000103", windowKey: "last_month", reach: 176, impressions: 193 },
    ]);
  });

  test("an account read with no row for a window had no delivery then: 0, not NULL", () => {
    const rows = parseReach([{ account_id: ACC, impressions: "100", reach: "80", date_start: "2026-10-10", date_stop: "2026-10-16" }], "account", W, ACC);
    expect(rows).toEqual([
      { key: ACC, windowKey: "last_7", reach: 80, impressions: 100 },
      { key: ACC, windowKey: "last_month", reach: 0, impressions: 0 },
    ]);
  });

  test("a span not asked for, another account or a repeated row stops the read", () => {
    expect(() => parseReach([{ ad_id: "120000000000103", reach: "1", impressions: "1", date_start: "2026-10-01", date_stop: "2026-10-16" }], "ad", W, ACC)).toThrow(
      "not asked for",
    );
    expect(() => parseReach([{ account_id: "999999999999", reach: "1", impressions: "1", date_start: "2026-10-10", date_stop: "2026-10-16" }], "account", W, ACC)).toThrow(
      "inside",
    );
    const dup = { campaign_id: "120000000000101", reach: "1", impressions: "1", date_start: "2026-10-10", date_stop: "2026-10-16" };
    expect(() => parseReach([dup, dup], "campaign", W, ACC)).toThrow("two reach rows");
  });

  test("two windows on the same days (the 7th of a month) are asked once and both get the row", () => {
    const seventh: Window[] = [
      { key: "last_7", from: "2026-11-01", to: "2026-11-07" },
      { key: "this_month", from: "2026-11-01", to: "2026-11-07" },
      { key: "last_month", from: "2026-10-01", to: "2026-10-31" },
    ];
    expect(windowSpans(seventh)).toEqual([
      { since: "2026-11-01", until: "2026-11-07" },
      { since: "2026-10-01", until: "2026-10-31" },
    ]);
    const account = parseReach([{ account_id: ACC, impressions: "300", reach: "200", date_start: "2026-11-01", date_stop: "2026-11-07" }], "account", seventh, ACC);
    expect(account).toEqual([
      { key: ACC, windowKey: "last_7", reach: 200, impressions: 300 },
      { key: ACC, windowKey: "this_month", reach: 200, impressions: 300 },
      { key: ACC, windowKey: "last_month", reach: 0, impressions: 0 },
    ]);
    const ads = parseReach([{ ad_id: "120000000000103", impressions: "30", reach: "20", date_start: "2026-11-01", date_stop: "2026-11-07" }], "ad", seventh, ACC);
    expect(ads.map(r => r.windowKey)).toEqual(["last_7", "this_month"]);
  });
});
