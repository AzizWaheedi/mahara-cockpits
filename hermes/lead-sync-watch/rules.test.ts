import { describe, expect, test } from "bun:test";
import { alertText, bucketHour, condition, decide, leadsOf, matched, type Prior, zonedDay, zonedHourToUtc } from "./rules";

const none: Prior = { strikes: 0, clears: 0, episodeId: null, gapSince: null, alertTs: null };
const at = "2026-10-14T12:00:00.000Z";
const run = (counts: any, prior: Prior = none, extra: any = {}) =>
  decide({ linked: true, metaReadOk: true, crmFresh: true, counts, prior, nowIso: at, clientKey: "loc1", ...extra });
const C = (meta24: number | null, crm24: number | null, meta6: number | null = 0, crm6: number | null = 0) => ({
  meta24,
  crm24,
  crmMeta24: crm24,
  meta6,
  crm6,
});

describe("condition", () => {
  test("30%+ below and 3+ missing is a gap", () => {
    expect(condition(C(10, 7, 0, 1)).hit).toBe("gap");
  });
  test("3 missing but only 25% below is not a gap", () => {
    expect(condition(C(12, 9, 0, 1)).hit).toBe(null);
  });
  test("40% below but only 2 missing is not a gap", () => {
    expect(condition(C(5, 3, 0, 1)).hit).toBe(null);
  });
  test("0 in CRM with 3+ Meta in 6h is stalled even when 24h looks fine", () => {
    expect(condition(C(20, 18, 3, 0)).hit).toBe("stalled");
  });
  test("more CRM than Meta never alerts (organic, walk-ins)", () => {
    expect(condition(C(4, 12, 2, 5)).hit).toBe(null);
  });
  test("missing data never alerts", () => {
    expect(condition(C(null, 0, null, 0)).hit).toBe(null);
    expect(condition(C(10, null, 4, null)).hit).toBe(null);
  });
});

describe("decide", () => {
  test("first sighting watches, does not alert", () => {
    const v = run(C(10, 2, 0, 1));
    expect(v.state).toBe("watch");
    expect(v.sendAlert).toBe(false);
    expect(v.episodeId).toBe(null);
    expect(v.strikes).toBe(1);
  });
  test("second sighting opens an episode and alerts once", () => {
    const v = run(C(10, 2, 0, 1), { ...none, strikes: 1, gapSince: "2026-10-14T11:30:00.000Z" });
    expect(v.state).toBe("gap");
    expect(v.sendAlert).toBe(true);
    expect(v.episodeId).toBe(`loc1:${at}`);
    expect(v.gapSince).toBe("2026-10-14T11:30:00.000Z");
  });
  test("an open, already-alerted episode does not alert again", () => {
    const v = run(C(10, 2, 0, 1), { strikes: 5, clears: 0, episodeId: "e1", gapSince: at, alertTs: "123.4" });
    expect(v.state).toBe("gap");
    expect(v.sendAlert).toBe(false);
    expect(v.episodeId).toBe("e1");
  });
  test("an open episode whose alert never landed asks to send it", () => {
    const v = run(C(10, 2, 0, 1), { strikes: 5, clears: 0, episodeId: "e1", gapSince: at, alertTs: null });
    expect(v.sendAlert).toBe(true);
  });
  test("closing needs 3 matching checks in a row", () => {
    let prior: Prior = { strikes: 3, clears: 0, episodeId: "e1", gapSince: at, alertTs: "1.1" };
    for (const want of [1, 2]) {
      const v = run(C(10, 10, 2, 2), prior);
      expect(v.state).toBe("watch");
      expect(v.sendResolved).toBe(false);
      expect(v.clears).toBe(want);
      prior = { ...prior, strikes: v.strikes, clears: v.clears };
    }
    const v = run(C(10, 10, 2, 2), prior);
    expect(v.state).toBe("ok");
    expect(v.sendResolved).toBe(true);
    expect(v.episodeId).toBe("e1");
  });
  test("a non-matching check in recovery resets the clear count", () => {
    const v = run(C(10, 8, 1, 1), { strikes: 0, clears: 2, episodeId: "e1", gapSince: at, alertTs: "1.1" });
    expect(v.clears).toBe(0);
    expect(v.sendResolved).toBe(false);
  });
  test("unknown Meta keeps the episode as it was and never resolves it", () => {
    const prior = { strikes: 4, clears: 2, episodeId: "e1", gapSince: at, alertTs: "1.1" };
    const v = run(C(null, 10, null, 2), prior, { metaReadOk: false });
    expect(v.state).toBe("unknown");
    expect(v.episodeId).toBe("e1");
    expect(v.clears).toBe(2);
    expect(v.sendResolved || v.sendAlert).toBe(false);
  });
  test("a stale CRM copy is unknown, not a Facebook fault", () => {
    const v = run(C(10, 0, 4, 0), none, { crmFresh: false });
    expect(v.state).toBe("unknown");
    expect(v.sendAlert).toBe(false);
  });
  test("unlinked accounts are reported, never alerted", () => {
    const v = run(C(10, null), none, { linked: false });
    expect(v.state).toBe("unlinked");
    expect(v.sendAlert).toBe(false);
  });
  test("few leads is quiet", () => {
    expect(run(C(2, 0, 0, 0)).state).toBe("quiet");
  });
});

describe("matched", () => {
  test("within one lead or 90% matches", () => {
    expect(matched(C(10, 9))).toBe(true);
    expect(matched(C(30, 27))).toBe(true);
    expect(matched(C(30, 26))).toBe(false);
  });
});

describe("time", () => {
  test("Kuwait hour to UTC", () => {
    expect(new Date(zonedHourToUtc("2026-10-14", 13, "Asia/Kuwait")).toISOString()).toBe("2026-10-14T10:00:00.000Z");
  });
  test("London across the clocks going back", () => {
    expect(new Date(zonedHourToUtc("2026-10-25", 12, "Europe/London")).toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(new Date(zonedHourToUtc("2026-10-24", 12, "Europe/London")).toISOString()).toBe("2026-10-24T11:00:00.000Z");
  });
  test("zoned day", () => {
    expect(zonedDay(Date.parse("2026-10-14T22:30:00Z"), "Asia/Riyadh")).toBe("2026-10-15");
  });
  test("bucket label", () => {
    expect(bucketHour("09:00:00 - 09:59:59")).toBe(9);
    expect(bucketHour("junk")).toBe(null);
  });
});

describe("leadsOf", () => {
  test("uses Meta's total when present", () => {
    expect(leadsOf([{ action_type: "lead", value: "5" }, { action_type: "onsite_conversion.lead_grouped", value: "5" }])).toBe(5);
  });
  test("falls back to form + pixel leads", () => {
    expect(leadsOf([{ action_type: "onsite_conversion.lead_grouped", value: "2" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "1" }])).toBe(3);
  });
  test("no actions is zero leads, not an error", () => {
    expect(leadsOf(undefined)).toBe(0);
  });
});

test("alert text names both counts and the mention", () => {
  const t = alertText({ client: "Ocean Home", state: "gap", reason: "r", meta24: 10, crm24: 2, crmMeta24: 2, meta6: 3, crm6: 0, mentions: ["U1"], cockpitUrl: "https://x" });
  expect(t).toContain("Ocean Home");
  expect(t).toContain("Meta *10*");
  expect(t).toContain("CRM *2*");
  expect(t).toContain("<@U1>");
  expect(t).not.toContain("<!channel>");
});
