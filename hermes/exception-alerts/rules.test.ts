import { describe, expect, test } from "bun:test";
import {
  addDays,
  type CampaignFact,
  campaignStopped,
  cpbOverLine,
  type DayRow,
  decide,
  floors,
  kuwaitDayStart,
  LIMITS,
  leadSync,
  NO_PRIOR,
  OFFICIAL,
  type Targets,
  zeroLeads,
} from "./rules";

const TODAY = "2026-10-26";
const NOW = kuwaitDayStart(TODAY) + 10 * 3_600_000; // 10:00 Kuwait
const TARGETS: Targets = { cpl: { ...OFFICIAL.cpl, source: "official" }, cpb: { ...OFFICIAL.cpb, source: "official" } };

/** 70 days ending today; `f(i)` gives day i back from today (0 = today). */
function days(f: (back: number) => Partial<DayRow>): DayRow[] {
  const out: DayRow[] = [];
  for (let back = 70; back >= 0; back--) out.push({ day: addDays(TODAY, -back), spend: 10, metaLeads: 1, crmAdLeads: 1, bookings: 0, ...f(back) });
  return out;
}
const fl = (d: DayRow[], t = TARGETS) => floors(d, t, addDays(TODAY, -60), addDays(TODAY, -1));
function campaign(spendByBack: Record<number, number>, over: Partial<CampaignFact> = {}): CampaignFact {
  const spendByDay = Object.fromEntries(Object.entries(spendByBack).map(([b, v]) => [addDays(TODAY, -Number(b)), v]));
  const spent = Object.keys(spendByDay).sort();
  return {
    id: "c1",
    name: "Lead form campaign",
    accountId: "111111",
    firstSpendDay: spent[0] ?? null,
    lastSpendDay: spent.at(-1) ?? null,
    startAt: null,
    switchedOn: true,
    delivering: true,
    whyNot: "",
    spendByDay,
    ...over,
  };
}

describe("floors: the client's own last 60 days", () => {
  test("a client with cheap leads keeps the house line (2 x $15)", () => {
    const f = fl(days(() => ({ spend: 10, metaLeads: 2 }))); // $5 a lead
    expect(f.ownCpl).toBe(5);
    expect(f.zeroLeadLine).toBe(30);
    expect(f.leadFloor).toBe(LIMITS.cpbMinLeads); // 14 leads a week: half is 7, the floor is 10
  });
  test("a client with dear leads gets 2 x its own cost per lead", () => {
    const f = fl(days(() => ({ spend: 40, metaLeads: 1 })));
    expect(f.ownCpl).toBe(40);
    expect(f.zeroLeadLine).toBe(80);
    expect(f.zeroLeadBasis).toContain("its own cost per lead");
  });
  test("a busy client needs more leads before cost per booking is judged", () => {
    const f = fl(days(() => ({ spend: 40, metaLeads: 6 }))); // 42 a week
    expect(f.leadFloor).toBe(21);
  });
  test("fewer than 10 leads in 60 days: no own cost per lead, the house line", () => {
    const f = fl(days(b => ({ spend: 10, metaLeads: b === 5 ? 3 : 0 })));
    expect(f.ownCpl).toBeNull();
    expect(f.zeroLeadLine).toBe(30);
  });
  test("a client line on the board wins over the official one", () => {
    const t: Targets = { ...TARGETS, cpl: { good: 25, watch: 35, source: "client" } };
    expect(fl(days(() => ({ spend: 10, metaLeads: 2 })), t).zeroLeadLine).toBe(50);
  });
});

describe("zero_leads", () => {
  const base = days(b => (b <= 2 ? { spend: 20, metaLeads: 0, crmAdLeads: 0 } : {}));
  test("over the line after 48 hours: hit", () => {
    const c = campaign({ 30: 10, 2: 20, 1: 20, 0: 20 });
    const f = zeroLeads({ days: base, campaigns: [c], floors: fl(base), today: TODAY, nowMs: NOW });
    expect(f.state).toBe("hit");
    expect(f.evidence.spend).toBe(60);
    expect(f.reason).toContain("$60.00 spent with no lead since 2026-10-24 (3 days)");
  });
  test("a campaign under 48 hours old is too little data, never an alert", () => {
    const c = campaign({ 1: 20, 0: 20 }, { startAt: NOW - 30 * 3_600_000 });
    const d = days(b => (b <= 1 ? { spend: 20, metaLeads: 0, crmAdLeads: 0 } : b <= 10 ? { spend: 0, metaLeads: 0, crmAdLeads: 0 } : {}));
    const f = zeroLeads({ days: d, campaigns: [c], floors: fl(d), today: TODAY, nowMs: NOW });
    expect(f.state).toBe("too_little_data");
  });
  test("under the line: ok, with the amount", () => {
    const d = days(b => (b === 0 ? { spend: 12, metaLeads: 0, crmAdLeads: 0 } : {}));
    const f = zeroLeads({ days: d, campaigns: [campaign({ 30: 10, 0: 12 })], floors: fl(d), today: TODAY, nowMs: NOW });
    expect(f.state).toBe("ok");
    expect(f.reason).toContain("$12.00");
  });
  test("a lead in the CRM counts even when Meta shows none", () => {
    const d = days(b => (b <= 2 ? { spend: 20, metaLeads: 0, crmAdLeads: b === 0 ? 1 : 0 } : {}));
    expect(zeroLeads({ days: d, campaigns: [campaign({ 30: 1, 2: 20, 1: 20, 0: 20 })], floors: fl(d), today: TODAY, nowMs: NOW }).state).toBe("ok");
  });
  test("Meta's numbers not read is unknown, never zero", () => {
    const d = days(b => (b <= 1 ? { spend: null, metaLeads: null } : {}));
    expect(zeroLeads({ days: d, campaigns: [], floors: fl(d), today: TODAY, nowMs: NOW }).state).toBe("unknown");
  });
  test("a chat campaign with no lead count is unknown", () => {
    const d = days(b => (b === 0 ? { spend: 30, metaLeads: null, crmAdLeads: 0 } : {}));
    expect(zeroLeads({ days: d, campaigns: [], floors: fl(d), today: TODAY, nowMs: NOW }).state).toBe("unknown");
  });
  test("no spend in the last 2 days is ok (nothing is burning)", () => {
    const d = days(b => (b <= 5 ? { spend: b >= 2 ? 30 : 0, metaLeads: 0, crmAdLeads: 0 } : {}));
    expect(zeroLeads({ days: d, campaigns: [], floors: fl(d), today: TODAY, nowMs: NOW }).reason).toBe("No spend in the last 2 days.");
  });
});

describe("cpb_over_line", () => {
  // $50 a day, 2 leads a day, 1 booking every other day: 7 days = $350, 14 leads, 3 or 4 bookings.
  const over = days(b => ({ spend: 50, metaLeads: 2, crmAdLeads: 2, bookings: b % 2 === 0 ? 1 : 0 }));
  test("over the line on 3 days in a row: hit", () => {
    const f = cpbOverLine({ days: over, floors: fl(over), targets: TARGETS, serviceMode: "DFY", today: TODAY });
    expect(f.state).toBe("hit");
    expect(f.reason).toContain("over the $80.00 line for 3 days in a row");
  });
  test("fewer than 3 bookings in a window: too little data", () => {
    const d = days(b => ({ spend: 50, metaLeads: 2, bookings: b === 3 ? 2 : 0 }));
    const f = cpbOverLine({ days: d, floors: fl(d), targets: TARGETS, serviceMode: "DFY", today: TODAY });
    expect(f.state).toBe("too_little_data");
    expect(f.reason).toContain("(needs 3)");
  });
  test("too few leads for the client's own floor: too little data", () => {
    const d = days(b => ({ spend: 50, metaLeads: b <= 9 ? 0 : 6, crmAdLeads: b <= 9 ? 0 : 6, bookings: 1 }));
    const f = cpbOverLine({ days: d, floors: fl(d), targets: TARGETS, serviceMode: "DFY", today: TODAY });
    expect(f.state).toBe("too_little_data");
    expect(f.reason).toContain("leads in the 7 days (needs");
  });
  test("one good day in the three: ok", () => {
    const d = days(b => ({ spend: b === 1 ? 0 : 50, metaLeads: 2, bookings: b === 1 ? 4 : b % 2 }));
    expect(cpbOverLine({ days: d, floors: fl(d), targets: TARGETS, serviceMode: "DFY", today: TODAY }).state).toBe("ok");
  });
  test("a missing bookings day is unknown, never zero", () => {
    const d = over.map(x => (x.day === addDays(TODAY, -4) ? { ...x, bookings: null } : x));
    expect(cpbOverLine({ days: d, floors: fl(d), targets: TARGETS, serviceMode: "DFY", today: TODAY }).state).toBe("unknown");
  });
  test("done with you is never judged on bookings", () => {
    expect(cpbOverLine({ days: over, floors: fl(over), targets: TARGETS, serviceMode: "DWY", today: TODAY }).state).toBe("ok");
  });
  test("the client's own line is used", () => {
    const t: Targets = { ...TARGETS, cpb: { good: 100, watch: 140, source: "client" } };
    expect(cpbOverLine({ days: over, floors: fl(over), targets: t, serviceMode: "DFY", today: TODAY }).state).toBe("ok");
  });
});

describe("campaign_stopped", () => {
  const acct = [{ id: "111111", status: 1, billingSignal: "healthy" }];
  const run = (c: CampaignFact[], a = acct, fetched: number | null = NOW - 30 * 60_000) =>
    campaignStopped({ campaigns: c, accounts: a, budgetsFetchedAt: fetched, today: TODAY, nowMs: NOW });
  test("switched on, spent yesterday, not delivering for ad issues: hit", () => {
    const f = run([campaign({ 1: 20 }, { delivering: false, whyNot: "Ads with issues" })]);
    expect(f.state).toBe("hit");
    expect(f.reason).toContain("switched on but not delivering: Ads with issues");
  });
  test("past its end date while spending: hit", () => {
    expect(run([campaign({ 1: 20 }, { switchedOn: false, delivering: false, whyNot: "Ended" })]).state).toBe("hit");
  });
  test("a billing stop belongs to the ad billing guard", () => {
    expect(run([campaign({ 1: 20 }, { delivering: false, whyNot: "Account unsettled: payment needed" })]).state).toBe("ok");
    expect(run([campaign({ 1: 20 }, { delivering: false, whyNot: "Account disabled" })], [{ id: "111111", status: 3, billingSignal: null }]).state).toBe("ok");
  });
  test("paused by a person is not an exception", () => {
    expect(run([campaign({ 1: 20 }, { switchedOn: false, delivering: false, whyNot: "Paused" })]).state).toBe("ok");
  });
  test("stale Meta status is unknown, but only when something spent", () => {
    expect(run([campaign({ 1: 20 }, { delivering: false, whyNot: "Ads with issues" })], acct, NOW - 5 * 3_600_000).state).toBe("unknown");
    expect(run([campaign({ 9: 20 })], acct, null).state).toBe("ok");
  });
});

describe("lead_sync", () => {
  test("an open gap in the lead sync watch is a hit with its episode", () => {
    const f = leadSync({ state: "gap", reason: "3 missing", episode_id: "lsw-e1", meta_24h: 3, crm_24h: 0 }, true);
    expect(f).toMatchObject({ state: "hit", evidence: { episode: "lsw-e1" } });
  });
  test("no row is unknown only when the client spends", () => {
    expect(leadSync(undefined, true).state).toBe("unknown");
    expect(leadSync(undefined, false).state).toBe("ok");
  });
});

describe("decide: two runs in a row, one episode", () => {
  const hit = { state: "hit" as const, reason: "x", evidence: {} };
  const okF = { state: "ok" as const, reason: "fine", evidence: {} };
  test("first sighting waits, the second run 45+ minutes later opens", () => {
    const a = decide("zero_leads", "loc1", NO_PRIOR, hit, NOW);
    expect(a.state).toBe("watch");
    const b = decide("zero_leads", "loc1", a, hit, NOW + 60 * 60_000);
    expect(b).toMatchObject({ state: "open", opened: true, strikes: 2 });
    expect(b.episodeId).toBe(a.episodeId);
  });
  test("a forced second run minutes later does not confirm", () => {
    const a = decide("zero_leads", "loc1", NO_PRIOR, hit, NOW);
    expect(decide("zero_leads", "loc1", a, hit, NOW + 5 * 60_000).state).toBe("watch");
  });
  test("an open episode stays one episode and opens once", () => {
    let p = decide("zero_leads", "loc1", decide("zero_leads", "loc1", NO_PRIOR, hit, NOW), hit, NOW + 3_600_000);
    const id = p.episodeId;
    p = decide("zero_leads", "loc1", p, hit, NOW + 2 * 3_600_000);
    expect(p).toMatchObject({ state: "open", opened: false, episodeId: id });
  });
  test("it closes after two clear runs; one clear run keeps it open", () => {
    let p = decide("cpb_over_line", "loc1", decide("cpb_over_line", "loc1", NO_PRIOR, hit, NOW), hit, NOW + 3_600_000);
    p = decide("cpb_over_line", "loc1", p, okF, NOW + 2 * 3_600_000);
    expect(p.state).toBe("open");
    p = decide("cpb_over_line", "loc1", p, okF, NOW + 3 * 3_600_000);
    expect(p).toMatchObject({ state: "ok", closed: true, episodeId: null });
  });
  test("unknown data keeps an open episode open and never closes it", () => {
    const open = decide("zero_leads", "loc1", decide("zero_leads", "loc1", NO_PRIOR, hit, NOW), hit, NOW + 3_600_000);
    const u = decide("zero_leads", "loc1", open, { state: "unknown", reason: "?", evidence: {} }, NOW + 2 * 3_600_000);
    expect(u).toMatchObject({ state: "open", episodeId: open.episodeId, closed: false });
  });
  test("the lead sync gap opens at once (its watch already confirmed it)", () => {
    expect(decide("lead_sync", "loc1", NO_PRIOR, hit, NOW, "lead_sync:loc1:e1")).toMatchObject({ state: "open", opened: true, episodeId: "lead_sync:loc1:e1" });
  });
});
