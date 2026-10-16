import { describe, expect, test } from "bun:test";
import { adsPayload, treeSql } from "./native/adapters/b2bAds.js";
import { type Row, type Runtime, withRuntime } from "./runtime.ts";

/**
 * The CEO, 2026-10-16: "check the rest of the data and make sure it's
 * correct". The audit of the Ads tab found the ad list held only ads that spent
 * in the last thirty days, so a $6,000 deal on an ad last spent in August was
 * missing from the 7-day lead-gen row, the campaign and the coverage line. It
 * also found verdicts that judged retargeting on the lead gate, a "scale" with
 * no lead, a "no delivery" on ads that delivered, an intro-to-demo stage over
 * 100%, and "lead to intro" counting appointments instead of leads.
 */
const FROM7 = "2026-10-10";
const FROM30 = "2026-09-17";
const TODAY = "2026-10-16";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const ACCOUNT = { account_status: 1, currency: "USD", timezone_name: "America/Los_Angeles" };

type Payload = Awaited<ReturnType<typeof adsPayload>>["payload"];
type Ad = { id: string; name: string; running: boolean; w7: Record<string, number | null>; w30: Record<string, number | null>; verdict: { verdict: string; reason: string } };
type Campaign = { id: string; type: string; w7: Record<string, number | null>; w30: Record<string, number | null>; constraint: { stage: string; owner: string; mine: number; account: number } | null; adsets: { id: string; ads: Ad[] }[] };
const adsOf = (p: Payload): Ad[] => (p.campaigns as Campaign[]).flatMap(c => c.adsets.flatMap(s => s.ads));
const adOf = (p: Payload, id: string): Ad => {
  const ad = adsOf(p).find(a => a.id === id);
  if (!ad) throw new Error(`ad ${id} is not in the payload`);
  return ad;
};
const campaignOf = (p: Payload, id: string): Campaign | undefined => (p.campaigns as Campaign[]).find(c => c.id === id);

const meta = async (resource: string): Promise<Row> =>
  resource.endsWith("/insights") ? ({ data: [], paging: {} } as unknown as Row) : (ACCOUNT as unknown as Row);

// ---------------------------------------------------------------------------
// The real treeSql and coverage SQL, run on PGlite over a B2B-shaped fixture.
// ---------------------------------------------------------------------------

const SCHEMA = `
  create table public.meta_ad_snapshots (
    date date, ad_id text, adset_id text, campaign_id text, ad_name text, adset_name text,
    campaign_name text, campaign_status text, effective_status text, thumbnail_url text,
    spend numeric, impressions numeric, clicks numeric, inline_link_clicks numeric, leads numeric,
    last_synced_at timestamptz);
  create table public.leads (contact_id text, ad_id text, tags text[], lead_created_at timestamptz);
  create table public.calls (contact_id text, ad_id text, call_type text, booked_at timestamptz,
    start_at timestamptz, status text, assigned_user_id text);
  create table public.sales_reps (ghl_user_id text, display_name text);
  create table public.closed_deals (response_id text, ad_id text, submitted_at timestamptz,
    contracted_revenue numeric, cash_collected numeric, closer text);
  create table public.record_voids (entity text, record_id text);
  create function public.b2b_campaign_type(name text) returns text language sql immutable as $$
    select case when name ~* '(hiring|recruit)' then 'excluded'
                when name ~* '(hammer them|retarget|remarket)' then 'retargeting'
                else 'lead_gen' end $$;
`;

const LG = { campaign: "lg", name: "MaharaMedia | Lead Gen | 4-12-25", adset: "lg-set" };
const PAUSED_CAMPAIGN = { campaign: "pc", name: "MaharaMedia | Lead Gen | 4-9-26 | CBO", adset: "pc-set" };

function snapshot(day: string, ad: string, name: string, where: typeof LG, status: string, spend: number) {
  return `('${day}', '${ad}', '${where.adset}', '${where.campaign}', '${name}', 'Set ${where.adset}', '${where.name}', 'ACTIVE', '${status}', null, ${spend}, ${spend * 20}, ${spend}, ${spend / 2}, 0, '2026-10-16 09:00+00')`;
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function fixture(extra = "") {
  const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(SCHEMA);
  const snapshots = [
    // "Lea Team sitting video": last spent ten days before the thirty-day window.
    snapshot("2026-08-01", "old", "An older name", LG, "ACTIVE", 4),
    snapshot("2026-09-07", "old", "Lea Team sitting video | 20-2-26", LG, "PAUSED", 3),
    // "Seen First | Hook 1": its whole campaign paused before the window.
    snapshot("2026-09-05", "hook1", "Seen First | Hook 1 | 4-9-26", PAUSED_CAMPAIGN, "CAMPAIGN_PAUSED", 6),
    // A live ad spending $5 a day all month.
    ...days(FROM30, TODAY).map(d => snapshot(d, "live", "Seen First | Hook 3", LG, "ACTIVE", 5)),
    ...days(FROM7, TODAY).map(d => snapshot(d, "ref", "Referrals Are Not A System", LG, "ACTIVE", 2)),
    ...days(FROM30, TODAY).map(d => snapshot(d, "demo", "Burnout From Work", LG, "ACTIVE", 1)),
  ];
  await db.exec(`
    insert into public.meta_ad_snapshots values ${snapshots.join(",\n")};
    insert into public.leads values
      ('makers', 'live', '{roas-qualified}', '2026-10-11 05:00+00'),
      ('c2', 'live', '{roas-unqualified}', '2026-10-12 05:00+00'),
      ('c3', 'live', '{roas-qualified}', '2026-10-13 05:00+00'),
      ('c4', 'ref', '{roas-qualified}', '2026-10-11 05:00+00'),
      ('c5', 'demo', '{roas-qualified}', '2026-09-20 05:00+00'),
      ('nobody', null, '{roas-qualified}', '2026-10-12 05:00+00');
    insert into public.calls values
      -- The Makers calls carry the old ad, the lead carries the live one (decision B: each table's own ad).
      ('makers', 'old', 'intro', '2026-10-11 07:00+00', '2026-10-12 08:00+00', 'showed', 'u1'),
      ('makers', 'old', 'intro', '2026-09-20 07:00+00', '2026-09-22 08:00+00', 'cancelled', 'u1'),
      ('c2', 'live', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'showed', 'u1'),
      -- One lead, a no-show and the rebooked intro: two appointments, one lead that booked.
      ('c4', 'ref', 'intro', '2026-10-11 06:00+00', '2026-10-12 08:00+00', 'no_show', 'u1'),
      ('c4', 'ref', 'intro', '2026-10-12 06:00+00', '2026-10-14 08:00+00', 'showed', 'u1'),
      -- The paused campaign's demo, confirmed for the last day.
      ('x9', 'hook1', 'demo', '2026-10-14 06:00+00', '2026-10-15 11:30+00', 'confirmed', 'u2'),
      -- Demos on one ad: one shown more than a week before the last day, one two days before.
      ('c5', 'demo', 'demo', '2026-09-25 06:00+00', '2026-10-01 08:00+00', 'showed', 'u2'),
      ('c6', 'demo', 'demo', '2026-10-10 06:00+00', '2026-10-14 08:00+00', 'showed', 'u2');
    insert into public.sales_reps values ('u1', 'Setter One'), ('u2', 'Closer Two');
    insert into public.closed_deals values
      ('makers-deal', 'old', '2026-10-13 08:25+00', 6000, 500, 'Closer Two'),
      ('voided-deal', 'old', '2026-10-13 09:00+00', 8000, 1500, 'Closer Two'),
      ('earlier-deal', 'live', '2026-09-25 08:00+00', 6000, 500, 'Closer Two'),
      ('organic-deal', null, '2026-10-14 08:00+00', 4000, 1000, 'Closer Two'),
      ('other-account', 'not-ours', '2026-10-14 08:00+00', 2000, 0, 'Closer Two');
    insert into public.record_voids values ('closed_deal', 'voided-deal');
    ${extra}
  `);
  const runtime: Runtime = {
    env: () => undefined,
    read: async (_project: string, query: string) => (await db.query(query)).rows as Row[],
    repository: {} as Runtime["repository"],
    tools: { graph: meta } as unknown as Runtime["tools"],
  };
  return withRuntime(runtime, () => adsPayload(FROM7, FROM30, TODAY, NOW));
}

describe("Our ads: every ad with activity in the window is on the tree (audit A)", () => {
  test("the tree query starts from the window's activity, not from snapshots inside it", () => {
    const sql = treeSql(FROM7, FROM30, TODAY);
    // ident comes after the funnel CTEs and reads the newest snapshot on or before the last day.
    expect(sql.indexOf("ident as (")).toBeGreaterThan(sql.indexOf("w30_deals as ("));
    expect(sql).toContain("where s.date <= date '2026-10-16'");
    expect(sql).toContain("select ad_id from w30_ads union select ad_id from w30_leads");
    expect(sql).toContain("union select ad_id from w30_calls union select ad_id from w30_deals");
    expect(sql).not.toContain("where date between date '2026-09-17' and date '2026-10-16'\n    order by ad_id");
  });

  test("an ad last spent before the thirty days still carries its calls and its deal", async () => {
    const { payload } = await fixture();
    const old = adOf(payload, "old");
    // Its newest snapshot on or before the last day names it.
    expect(old.name).toBe("Lea Team sitting video | 20-2-26");
    expect(old.running).toBe(false);
    expect(old.verdict.verdict).toBe("off");
    expect(old.w7).toMatchObject({ spend: 0, introsBooked: 1, introsShown: 1, closes: 1, contracted: 6000, cash: 500 });
    expect(old.w30).toMatchObject({ spend: 0, introsBooked: 2, introsCancelled: 1, closes: 1, contracted: 6000 });

    // The lead-gen account row and the campaign count the deal.
    expect(payload.account.w7).toMatchObject({ closes: 1, contracted: 6000, cash: 500 });
    expect(payload.account.w7.roas).toBe(Math.round((6000 / payload.account.w7.spend) * 100) / 100);
    expect(payload.account.w30).toMatchObject({ closes: 2, contracted: 12000 });
    const lg = campaignOf(payload, "lg")!;
    expect(lg.w7.closes).toBe(1);
    expect(lg.w30.closes).toBe(2);

    // A campaign paused before the window is on the tab with its demo.
    const paused = campaignOf(payload, "pc");
    expect(paused).toBeDefined();
    expect(adOf(payload, "hook1").w7).toMatchObject({ spend: 0, demosBooked: 1, demosShown: 1 });
  });

  test("an ad whose last snapshot still says ACTIVE but has not delivered in thirty days is off, not running", async () => {
    // Review of the fix: snapshots stop when an ad stops delivering, so the newest one can be stale.
    // 27 ads on 16 Oct had an ACTIVE snapshot from August; a call on an old click would bring one back.
    const { payload } = await fixture(`
      insert into public.meta_ad_snapshots values ${snapshot("2026-08-20", "stale", "Stale but ACTIVE", LG, "ACTIVE", 3)};
      insert into public.calls values ('c7', 'stale', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'showed', 'u1');
    `);
    const stale = adOf(payload, "stale");
    expect(stale.running).toBe(false);
    expect(stale.verdict).toMatchObject({ verdict: "off", reason: "No Meta delivery since 2026-08-20." });
    expect(stale.w7).toMatchObject({ spend: 0, introsBooked: 1, introsShown: 1 });
    // It is not counted as running, and it marks nothing running above it.
    expect(payload.running).toBe(adsOf(payload).filter(a => a.running).length);
    expect(adsOf(payload).filter(a => a.running).map(a => a.id).sort()).toEqual(["demo", "live", "ref"]);
    // An ad that delivered in the thirty days keeps Meta's status.
    expect(adOf(payload, "live").running).toBe(true);
  });

  test("coverage counts the CRM's records on this account's ads, whether or not the tree placed them", async () => {
    const { payload } = await fixture();
    // The voided deal is out; the organic and other-account deals have no ad of ours.
    expect(payload.coverage.w7).toEqual({ leads: 5, adLeads: 4, closes: 3, adCloses: 1, contracted: 12000, adContracted: 6000 });
    expect(payload.coverage.w30).toEqual({ leads: 6, adLeads: 5, closes: 4, adCloses: 2, contracted: 18000, adContracted: 12000 });
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).not.toContain("could not place");
    expect(text).toContain("Calls and deals are credited to the ad on the call or deal record, which can differ from the ad on the lead.");
  });

  test("a deal on one of our ads that the tree cannot place is counted and named in a warning", async () => {
    // Meta's only snapshot of this ad is after the last day, so no ad row can hold it.
    const { payload } = await fixture(`
      insert into public.meta_ad_snapshots values ${snapshot("2026-10-20", "later", "Later", LG, "ACTIVE", 1)};
      insert into public.closed_deals values ('later-deal', 'later', '2026-10-15 08:00+00', 3000, 300, 'Closer Two');
    `);
    expect(payload.coverage.w7.adCloses).toBe(2);
    expect(payload.coverage.w7.adContracted).toBe(9000);
    expect(adsOf(payload).some(a => a.id === "later")).toBe(false);
    const warn = payload.notes.find((n: { level: string; text: string }) => n.level === "warn" && n.text.includes("could not place"));
    expect(warn?.text).toContain("In the last thirty days the CRM holds 5 leads and 3 signed deals ($15,000) on this account's ads, and the ad rows add up to 5 and 2 ($12,000)");
  });

  test("lead to intro is per lead: a no-show and its rebooking are one lead that booked (audit E)", async () => {
    const { payload } = await fixture();
    const ref = adOf(payload, "ref");
    expect(ref.w7.introsBooked).toBe(2);
    expect(ref.w7.leads).toBe(1);
    expect(ref.w7.leadsToIntro).toBe(1);
    expect(ref.w7.bookRate).toBe(1);
    // The Makers lead booked on the old ad's call: still a lead that booked, on its own lead's ad.
    const live = adOf(payload, "live");
    expect(live.w7).toMatchObject({ leads: 3, leadsToIntro: 2, introsBooked: 1 });
    expect(live.w7.bookRate).toBe(0.6667);
    for (const ad of adsOf(payload)) {
      for (const w of [ad.w7, ad.w30]) {
        if (w.bookRate !== null) expect(w.bookRate).toBeLessThanOrEqual(1);
        if (w.leadToDemo !== null) expect(w.leadToDemo).toBeLessThanOrEqual(1);
      }
    }
    expect(payload.account.w7.bookRate).toBeLessThanOrEqual(1);
  });

  test("only demos shown a week before the last day count as old enough to close (audit C5)", async () => {
    const { payload } = await fixture();
    const demo = adOf(payload, "demo");
    expect(demo.w30.demosShown).toBe(2);
    expect(demo.w30.demosShownMature).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Verdicts and the constraint, on rows shaped like the tree's.
// ---------------------------------------------------------------------------

type Counts = Partial<Record<string, number | null>>;
const WINDOW_KEYS = [
  "spend", "impressions", "clicks", "link_clicks", "meta_leads", "leads", "qualified_leads", "not_ready_leads",
  "leads_to_intro", "leads_to_demo", "intros_booked", "intros_due", "intros_shown", "intros_qualified",
  "intros_cancelled", "intros_advanced", "demos_booked", "demos_due", "demos_shown", "demos_qualified",
  "demos_shown_mature", "demos_cancelled", "closes", "contracted", "cash",
];
function win(prefix: "w7" | "w30", counts: Counts): Row {
  const out: Row = {};
  for (const k of WINDOW_KEYS) out[`${prefix}_${k}`] = (counts[k] ?? 0) as number;
  return out;
}
function row(id: string, campaign: string, type: string, w7: Counts, w30: Counts = w7, status = "ACTIVE"): Row {
  return {
    ad_id: id, adset_id: `${campaign}-set`, campaign_id: campaign, ad_name: `Ad ${id}`, adset_name: `Set ${campaign}`,
    campaign_name: `Campaign ${campaign}`, campaign_status: "ACTIVE", effective_status: status, thumbnail_url: null, last_seen: "2026-10-16",
    campaign_type: type, setter_name: null, setter_shown: 0, setter_due: 0, closer_name: null, closer_closes: 0,
    ...win("w7", w7), ...win("w30", w30),
  };
}

function rowsRun(rows: Row[], frequency: Record<string, string> = {}, totals: Row = {}) {
  const runtime: Runtime = {
    env: () => undefined,
    read: async (_project: string, query: string) => {
      if (query.includes("max(extract(epoch from last_synced_at)")) return [{ ms: NOW, last_day: "2026-10-16", first_day: "2025-01-01" }];
      if (query.trimStart().startsWith("with")) return rows;
      return [totals];
    },
    repository: {} as Runtime["repository"],
    tools: {
      graph: async (resource: string, params: Record<string, string | number> = {}) => {
        if (!resource.endsWith("/insights")) return ACCOUNT as unknown as Row;
        const since = JSON.parse(String(params.time_range)).since;
        const data = params.level === "ad" && since === FROM7
          ? Object.entries(frequency).map(([ad_id, f]) => ({ ad_id, impressions: "1000", reach: "400", frequency: f }))
          : [];
        return { data, paging: {} } as unknown as Row;
      },
    } as unknown as Runtime["tools"],
  };
  return withRuntime(runtime, () => adsPayload(FROM7, FROM30, TODAY, NOW));
}

describe("Our ads: verdicts (audit C)", () => {
  // The audit's cases, by the ad they were found on.
  const ROWS = [
    // C1: Referral Margin Tax, $22.80 and no lead in seven days.
    row("margin-tax", "lg", "lead_gen", { spend: 22.8, impressions: 900 }),
    // C2: Vid 15 - Hidden Tax, retargeting at frequency 2.75 on $1.43.
    row("hidden-tax", "rt", "retargeting", { spend: 1.43, impressions: 300 }),
    // C2 and C3: a retargeting ad that delivered $0.77.
    row("rt-small", "rt", "retargeting", { spend: 0.77, impressions: 41 }),
    // C3: a lead-gen ad that delivered $0.77.
    row("lg-small", "lg", "lead_gen", { spend: 0.77, impressions: 41 }),
    // C3: a lead-gen ad that spent nothing.
    row("lg-none", "lg", "lead_gen", { spend: 0 }),
    // C4: $34.53 a lead in seven days.
    row("dear", "lg", "lead_gen", { spend: 34.53, leads: 1, impressions: 1000 }, { spend: 54.28, leads: 2, impressions: 1600 }),
    // C4: $18 a lead in seven days.
    row("watch", "lg", "lead_gen", { spend: 36, leads: 2, impressions: 1000 }),
    // A real scale: $10 a lead.
    row("good", "lg", "lead_gen", { spend: 20, leads: 2, impressions: 1000 }),
    // C5: four demos shown, two of them a week old, nothing signed.
    row("young-demos", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 6, demos_shown: 4, demos_shown_mature: 2 }),
    row("old-demos", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 6, demos_shown: 4, demos_shown_mature: 3 }),
  ];

  test("each verdict says what the money did in its window and never prints a cost per lead that does not exist", async () => {
    const { payload } = await rowsRun(ROWS, { "hidden-tax": "2.7502" });
    const v = (id: string) => adOf(payload, id).verdict;

    expect(v("margin-tax")).toEqual({ verdict: "hold", reason: "$22.80 in seven days and no lead yet: too early to judge against the $15 gate.", owner: "ads" });
    expect(v("hidden-tax")).toEqual({ verdict: "not_judged", reason: "Retargeting is not judged on cost per lead.", owner: null });
    expect(v("rt-small").verdict).toBe("not_judged");
    expect(v("lg-small")).toEqual({ verdict: "hold", reason: "Delivering, but only $0.77 and 41 impressions in seven days: too little to judge.", owner: "ads" });
    expect(v("lg-none")).toEqual({ verdict: "no delivery", reason: "On, but nothing spent in seven days.", owner: "ads" });
    expect(v("dear")).toEqual({ verdict: "kill", reason: "$34.53 a lead in seven days, more than half again over the $15 gate.", owner: "ads" });
    expect(v("watch").verdict).toBe("hold");
    expect(v("watch").reason).toBe("$18.00 a lead in seven days is over the $15 gate but within half again. Watch it; do not scale it.");
    expect(v("good")).toEqual({ verdict: "scale", reason: "$10.00 a lead in seven days, under the $15 gate, on $20.", owner: "ads" });
    expect(v("young-demos").verdict).toBe("scale");
    expect(v("old-demos").verdict).toBe("demos do not close");
    expect(v("old-demos").reason).toBe("3 demos shown at least a week ago and nothing signed. That is the closing call, not the ad.");

    for (const ad of adsOf(payload)) {
      expect(ad.verdict.reason).not.toContain("$0.00");
      if (ad.w7.spend !== 0) expect(ad.verdict.reason).not.toContain("nothing spent");
    }
    // A scale is only ever a lead-gen ad with a lead at or under the gate.
    const scale = adsOf(payload).filter(a => a.verdict.verdict === "scale");
    expect(scale.every(a => (a.w7.leads ?? 0) >= 1 && (a.w7.cpl ?? Infinity) <= 15)).toBe(true);
    expect(payload.verdicts).toEqual({ hold: 3, not_judged: 2, "no delivery": 1, kill: 1, scale: 2, "demos do not close": 1 });
    expect(payload.verdicts.fatiguing).toBeUndefined();
  });

  test("a lead-gen ad at frequency 2.5 or more is still fatiguing", async () => {
    const { payload } = await rowsRun([row("tired", "lg", "lead_gen", { spend: 20, leads: 2 })], { tired: "2.75" });
    expect(adOf(payload, "tired").verdict.verdict).toBe("fatiguing");
  });
});

describe("Our ads: the campaign constraint (audit C5 and D)", () => {
  // Below every other stage's floor, so only the stage under test can fire.
  const quiet = { impressions: 400, link_clicks: 10, leads: 3, leads_to_intro: 1 };

  test("intro to demo is the ribbon's introsAdvanced over introsShown and never passes 100%", async () => {
    const weak = { ...quiet, intros_due: 10, intros_shown: 10, intros_advanced: 2, demos_booked: 15 };
    const strong = { ...quiet, intros_due: 10, intros_shown: 10, intros_advanced: 8, demos_booked: 8 };
    const { payload } = await rowsRun([row("a", "weak", "lead_gen", weak), row("b", "strong", "lead_gen", strong)]);
    const c = campaignOf(payload, "weak")!;
    expect(c.constraint).toEqual({ stage: "intros shown to demos booked", owner: "setter", mine: 0.2, account: 0.5 });
    expect(c.constraint!.mine).toBe(c.w30.introToDemo);
    expect(payload.account.w30.introToDemo).toBe(0.5);
    for (const campaign of payload.campaigns as Campaign[]) {
      if (!campaign.constraint) continue;
      expect(campaign.constraint.mine).toBeLessThanOrEqual(1);
      expect(campaign.constraint.account).toBeLessThanOrEqual(1);
    }
  });

  test("the closer is not blamed until the account has three closes to compare against", async () => {
    const noClose = { ...quiet, demos_shown: 5 };
    const twoCloses = { ...quiet, demos_shown: 3, closes: 2 };
    const thin = await rowsRun([row("a", "a", "lead_gen", noClose), row("b", "b", "lead_gen", twoCloses)]);
    expect(thin.payload.account.w30.closes).toBe(2);
    expect(campaignOf(thin.payload, "a")!.constraint).toBeNull();

    const threeCloses = { ...quiet, demos_shown: 3, closes: 3 };
    const enough = await rowsRun([row("a", "a", "lead_gen", noClose), row("b", "b", "lead_gen", threeCloses)]);
    expect(campaignOf(enough.payload, "a")!.constraint).toEqual({ stage: "demos shown to closes", owner: "closer", mine: 0, account: 0.375 });
  });
});
