// bun test supabase/functions/sales-api/sendrules.test.ts
import { describe, expect, test } from "bun:test";
import {
  budgetCheck,
  duplicatePair,
  duplicateWatchOn,
  firstHours,
  followupSettingsValue,
  gateOpen,
  healthCfg,
  hoursRefusal,
  kuwaitMonthStart,
  leadHour,
  leadOffsetHours,
  matchSent,
  sameText,
  sourceHealth,
  whatsappGuardValue,
} from "./sendrules.ts";

const H = 3_600_000;
/** lib.ts FOLLOWUP_SEGMENTS as the hooks commit leaves it (reactivate added). */
const FOLLOWUP_SEGMENTS = ["reply", "confirm", "no_show", "cancelled", "new", "after_call", "nurture", "reactivate"] as const;
// 2026-10-04 is a Sunday. 05:30 UTC is 08:30 in Kuwait, 09:30 in Dubai.
const SUN_0530 = Date.parse("2026-10-04T05:30:00Z");
const FRI_0800 = Date.parse("2026-10-02T08:00:00Z");

describe("one clock (finding 23)", () => {
  test("every UAE and Oman place is UTC+4, in English or Arabic; the rest of the Gulf UTC+3", () => {
    for (const c of ["AE", "om", "Abu Dhabi", "Sharjah", "Ajman", "Dubai", "U.A.E", "Muscat", "الشارقة", "أبوظبي"]) expect(leadOffsetHours(c)).toBe(4);
    for (const c of ["KW", "SA", "Kuwait", "", null, "Romania"]) expect(leadOffsetHours(c)).toBe(3);
    expect(leadHour("Abu Dhabi", SUN_0530)).toBe(9);
    expect(leadHour("KW", SUN_0530)).toBe(8);
  });
});

describe("hours", () => {
  const fu = { first_hours: [9, 18], quiet: { from: 21, to: 9 } };
  test("a first message goes between 9 and 6 on the lead's clock; the desk reads the sentence as hours", () => {
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now: SUN_0530, followups: fu })).toBe(
      "A first message goes between 9 and 6, their time.",
    );
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "Dubai", now: SUN_0530, followups: fu })).toBeNull();
    // 15:30 UTC is 18:30 in Kuwait: past a first message's hours, inside a later step's.
    const late = Date.parse("2026-10-04T15:30:00Z");
    expect(hoursRefusal({ segment: "no_show", touch: 1, country: "KW", now: late, followups: fu })).not.toBeNull();
    expect(hoursRefusal({ segment: "no_show", touch: 2, country: "KW", now: late, followups: fu })).toBeNull();
    expect(hoursRefusal({ segment: "confirm", touch: 1, country: "KW", now: late, followups: fu })).toBeNull();
  });
  test("a reply goes any time; later steps keep to 9 to 21", () => {
    const night = Date.parse("2026-10-04T20:00:00Z");
    expect(hoursRefusal({ segment: "reply", touch: 1, country: "KW", now: night, followups: fu })).toBeNull();
    expect(hoursRefusal({ segment: "nurture", touch: 3, country: "KW", now: night, followups: fu })).toContain("their time");
  });
  test("Friday is the day off for the desk's own sends only", () => {
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now: FRI_0800, followups: fu, dayOff: true })).toContain("Friday");
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "KW", now: FRI_0800, followups: fu })).toBeNull();
  });
  test("a damaged first_hours falls back to 9 to 18", () => {
    expect(firstHours({ first_hours: [18, 9] })).toEqual([9, 18]);
    expect(firstHours({ first_hours: "9-18" })).toEqual([9, 18]);
    expect(firstHours({ first_hours: [10, 17] })).toEqual([10, 17]);
  });
});

describe("the read-back matches the words (C29)", () => {
  const since = Date.parse("2026-10-04T07:00:00Z");
  const msg = (body: string, at: number, over = {}) => ({ id: String(at), direction: "outbound", channel: "whatsapp", body, at: new Date(at).toISOString(), ...over });
  test("a WA Connector copy or another rep's message is not this send", () => {
    const list = [msg("Hi Sara, see you at 5", since + 2000), msg("Hi Huda, your call with Sami from Mahara Media is ready now. Tap the button below to join.", since + 3000)];
    expect(matchSent(list, since, "Hi Huda, your call with Sami from Mahara Media is ready now. Tap the button below to join.")?.id).toBe(String(since + 3000));
    expect(matchSent(list, since, "Something else entirely, never sent")).toBeNull();
    // Without words, the old rule: any outbound WhatsApp after the send.
    expect(matchSent(list, since)?.id).toBe(String(since + 2000));
    expect(matchSent([msg("x", since - 60_000)], since)).toBeNull();
    expect(matchSent([msg("Hi", since + 1, { direction: "inbound" })], since)).toBeNull();
  });
  test("sameText ignores case, spacing and invisible marks, and allows a button's tail", () => {
    expect(sameText("Hi  Huda,\nyour call", "hi huda, your call")).toBe(true);
    expect(sameText("Hi Huda‏, your call is ready now please join", "Hi Huda, your call is ready now please join [Join the call]")).toBe(true);
    expect(sameText("Hi", "Ho")).toBe(false);
    expect(sameText("", "")).toBe(false);
  });
});

describe("the duplicate detector (C28)", () => {
  const t = Date.parse("2026-10-04T07:00:00Z");
  const m = (id: string, body: string, s: number) => ({ id, direction: "outbound", channel: "whatsapp", body, at: new Date(t + s * 1000).toISOString() });
  test("two identical outbound messages within 60 s are a pair; 61 s apart, or different words, are not", () => {
    expect(duplicatePair([m("a", "Hi Huda", 0), m("b", "hi  huda", 40)])?.map(x => x.id)).toEqual(["a", "b"]);
    expect(duplicatePair([m("a", "Hi Huda", 0), m("b", "Hi Huda", 61)])).toBeNull();
    expect(duplicatePair([m("a", "Hi Huda", 0), m("b", "Hi Sara", 5)])).toBeNull();
    expect(duplicatePair([m("a", "Hi Huda", 0), m("a", "Hi Huda", 5)])).toBeNull();
    expect(duplicatePair([m("a", "Hi", 0), { ...m("b", "Hi", 3), direction: "inbound" }])).toBeNull();
    // Two of the cockpit's own sends (each its own request id) are no copy; the connector's copy of one still is (stress2 fix round 1).
    const own = new Map([["a", "req-1"], ["b", "req-2"]]);
    const ownPair = (x: { id: string }, y: { id: string }) => own.has(x.id) && own.has(y.id) && own.get(x.id) !== own.get(y.id);
    expect(duplicatePair([m("a", "Hi Huda", 0), m("b", "Hi Huda", 5)], 60, ownPair)).toBeNull();
    expect(duplicatePair([m("a", "Hi Huda", 0), m("b", "Hi Huda", 5), m("copy", "Hi Huda", 6)], 60, ownPair)?.map(x => x.id)).toEqual(["a", "copy"]);
    // It watches only once a manager has said the WA Connector is off (the connector copies every send until then).
    expect(duplicateWatchOn({})).toBe(false);
    expect(duplicateWatchOn({ connector_off: false })).toBe(false);
    expect(duplicateWatchOn({ connector_off: "true" })).toBe(false);
    expect(duplicateWatchOn({ connector_off: true })).toBe(true);
    expect(duplicateWatchOn({ connector_off: true, dup_paused_at: "2026-10-03T10:00:00Z" })).toBe(false);
  });
});

describe("WhatsApp health per source (C27) and the gate", () => {
  test("a source pauses at its own fail share over its own window, after the minimum sends", () => {
    const cfg = healthCfg({ health: { room: { window: 20, fail_share: 0.3 } } }, "room");
    expect(cfg).toEqual({ window: 20, fail_share: 0.3, min_sends: 5 });
    const rows = (failed: number, ok: number) => [...Array(failed).fill({ state: "failed", error: "131049" }), ...Array(ok).fill({ state: "sent" })];
    expect(sourceHealth(rows(3, 7), cfg, "room").paused).toBe(true);
    expect(sourceHealth(rows(2, 8), cfg, "room").paused).toBe(false);
    expect(sourceHealth(rows(4, 0), cfg, "room").paused).toBe(false);
    expect(sourceHealth(rows(3, 7), cfg, "followup").why).toContain("are paused");
  });
  test("the gate opens only with the connector off and a real single-copy time", () => {
    expect(gateOpen({ connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(gateOpen({ connector_off: true, single_copy_ok_at: null })).toBe(false);
    expect(gateOpen({ connector_off: "true", single_copy_ok_at: "2026-10-01T00:00:00Z" })).toBe(false);
    expect(gateOpen(null)).toBe(false);
  });
});

describe("the template budget (D18)", () => {
  test("refused once the next template would take the month past the budget, with the words the desk holds on", () => {
    // 1,261 sent ($99.87): the 1,262nd ends the month at $99.95. 1,262 sent: the 1,263rd would be $100.03.
    expect(budgetCheck(1261, { template_budget_usd_month: 100 }).refusal).toBeNull();
    const r = budgetCheck(1262, { template_budget_usd_month: 100 });
    expect(r.spend).toBe(99.95);
    expect(r.refusal).toContain("budget");
    expect(budgetCheck(1263, { template_budget_usd_month: 100 }).spend).toBe(100.03);
    expect(budgetCheck(0, { template_budget_usd_month: 0 }).refusal).not.toBeNull();
    expect(budgetCheck(10, { template_rate_usd: 10 }).spend).toBe(0.79);
  });
  test("the month starts at Kuwait's midnight on the first", () => {
    expect(kuwaitMonthStart(Date.parse("2026-10-31T22:00:00Z"))).toBe("2026-10-31T21:00:00.000Z");
    expect(kuwaitMonthStart(Date.parse("2026-10-15T10:00:00Z"))).toBe("2026-09-30T21:00:00.000Z");
  });
});

describe("settings saves keep every key (finding 17)", () => {
  const live = {
    enabled: true,
    quiet: { from: 21, to: 9 },
    autosend: { no_show: true },
    cadence: { cancelled: [0.5, 48, 120], after_call: [24, 72] },
    per_day: 60,
    per_run: 12,
    nurture_per_day: 20,
    nurture_every_days: 7,
    automation_gap_hours: 20,
    first_hours: [9, 18],
    waves: { per_day: 40, holdout_share: 0.1, batch_gap_s: 45, salt: "waves" },
    stop_pause_days: 30,
    untagged_every_days: 14,
    graduation: { min_decided: 40 },
    reply_alerts: { manager_min: 10 },
  };
  test("a save that names one switch keeps every other key, the new ones included", () => {
    const r = followupSettingsValue(live, { per_day: 50 }, FOLLOWUP_SEGMENTS);
    if (!r.ok) throw new Error(r.error);
    for (const k of ["waves", "first_hours", "stop_pause_days", "untagged_every_days", "graduation", "reply_alerts", "cadence"])
      expect(r.value[k]).toEqual((live as Record<string, unknown>)[k]);
    expect(r.value.per_day).toBe(50);
    expect((r.value.autosend as Record<string, boolean>).no_show).toBe(true);
  });
  test("openers never send by themselves", () => {
    const r = followupSettingsValue(live, { autosend: { reactivate: true } }, FOLLOWUP_SEGMENTS);
    if (!r.ok) throw new Error(r.error);
    expect((r.value.autosend as Record<string, boolean>).reactivate).toBe(false);
  });
  test("the new keys are checked with the desk's bounds", () => {
    expect(followupSettingsValue(live, { waves: { per_day: 201 } }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    expect(followupSettingsValue(live, { waves: { holdout_share: 0.6 } }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    expect(followupSettingsValue(live, { waves: { batch_gap_s: 29 } }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    expect(followupSettingsValue(live, { first_hours: [18, 9] }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    expect(followupSettingsValue(live, { first_hours: [9, 25] }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    expect(followupSettingsValue(live, { stop_pause_days: 91 }, FOLLOWUP_SEGMENTS).ok).toBe(false);
    const ok = followupSettingsValue(live, { waves: { batch_gap_s: 60 } }, FOLLOWUP_SEGMENTS);
    expect(ok.ok && (ok.value.waves as Record<string, unknown>)).toEqual({ per_day: 40, holdout_share: 0.1, batch_gap_s: 60, salt: "waves" });
  });
  test("the guard save keeps the gate and the budget; only a manager's explicit value changes them", () => {
    const before = { templates_per_day: 250, pause_fail_share: 0.3, pause_min_sends: 5, connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00.000Z", template_budget_usd_month: 100, dup_window_s: 60, health: { room: { window: 20 } } };
    const now = Date.parse("2026-10-04T07:00:00Z");
    const r = whatsappGuardValue(before, { templates_per_day: 300 }, now);
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toEqual({ ...before, templates_per_day: 300 });
    const shut = whatsappGuardValue(before, { connector_off: false }, now);
    expect(shut.ok && shut.value.connector_off).toBe(false);
    const tested = whatsappGuardValue({ ...before, single_copy_ok_at: null }, { single_copy_ok_at: true }, now);
    expect(tested.ok && tested.value.single_copy_ok_at).toBe("2026-10-04T07:00:00.000Z");
    expect(whatsappGuardValue(before, { single_copy_ok_at: "2027-01-01T00:00:00Z" }, now).ok).toBe(false);
    expect(whatsappGuardValue(before, { connector_off: "yes" }, now).ok).toBe(false);
    expect(whatsappGuardValue(before, { template_budget_usd_month: -1 }, now).ok).toBe(false);
    const cleared = whatsappGuardValue({ ...before, dup_paused_at: "2026-10-04T06:00:00Z", dup_reason: "x" }, { dup_paused_at: null }, now);
    expect(cleared.ok && [cleared.value.dup_paused_at, cleared.value.dup_reason]).toEqual([null, null]);
    // A save that does not name the pause never clears it.
    const kept = whatsappGuardValue({ ...before, dup_paused_at: "2026-10-04T06:00:00Z" }, { templates_per_day: 250 }, now);
    expect(kept.ok && kept.value.dup_paused_at).toBe("2026-10-04T06:00:00Z");
  });
});

test("hours stay on whole hours (no drift across the day)", () => {
  for (let h = 0; h < 24; h++) expect(leadHour("KW", Date.parse("2026-10-04T00:00:00Z") + h * H)).toBe((h + 3) % 24);
});

describe("the lead's zone (stress round 1: leads outside the Gulf)", () => {
  test("a code the table does not know: a first message waits for a person, a later one keeps to Kuwait's clock", () => {
    const noonKuwait = Date.parse("2026-10-04T09:00:00Z");
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "ZZ", now: noonKuwait, followups: {} })).toContain("time zone");
    expect(hoursRefusal({ segment: "no_show", touch: 2, country: "ZZ", now: noonKuwait, followups: {} })).toBeNull();
    const nightKuwait = Date.parse("2026-10-04T20:00:00Z");
    expect(hoursRefusal({ segment: "no_show", touch: 2, country: "ZZ", now: nightKuwait, followups: {} })).not.toBeNull();
  });

  test("a country across zones gets a first message only in hours that are daytime in all of them", () => {
    // 09:30 in New York is 06:30 in Los Angeles: not yet.
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "US", now: Date.parse("2027-01-14T14:30:00Z"), followups: {} })).not.toBeNull();
    // 13:00 in New York is 10:00 in Los Angeles.
    expect(hoursRefusal({ segment: "reactivate", touch: 1, country: "US", now: Date.parse("2027-01-14T18:00:00Z"), followups: {} })).toBeNull();
  });
});
