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

type Graph = (resource: string, params?: Record<string, string | number>) => Promise<Row>;
const STATUS_EDGE = /^act_746108264865897\/(campaigns|adsets|ads)$/;
// Meta refuses the live on/off lists here, so these tests stay on the snapshot rule (the fallback);
// "on and off is Meta's own" below answers them.
const meta: Graph = async (resource: string): Promise<Row> => {
  if (STATUS_EDGE.test(resource)) throw new Error("Meta Graph API error 17");
  return resource.endsWith("/insights") ? ({ data: [], paging: {} } as unknown as Row) : (ACCOUNT as unknown as Row);
};

// ---------------------------------------------------------------------------
// The real treeSql and coverage SQL, run on PGlite over a B2B-shaped fixture.
// ---------------------------------------------------------------------------

const SCHEMA = `
  create table public.meta_ad_snapshots (
    date date, ad_id text, adset_id text, campaign_id text, ad_name text, adset_name text,
    campaign_name text, campaign_status text, effective_status text, thumbnail_url text,
    spend numeric, impressions numeric, clicks numeric, inline_link_clicks numeric, leads numeric,
    last_synced_at timestamptz);
  create table public.leads (contact_id text primary key, ad_id text, tags text[], lead_created_at timestamptz);
  create table public.calls (contact_id text, ad_id text, call_type text, booked_at timestamptz,
    start_at timestamptz, status text, assigned_user_id text);
  create table public.sales_reps (ghl_user_id text, display_name text);
  create table public.closed_deals (response_id text, contact_id text, ad_id text, submitted_at timestamptz,
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

async function fixture(extra = "", graph: Graph = meta) {
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
      -- The Makers calls carry the old ad and the lead the live one: they are credited to the lead's ad.
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
      -- The Makers deal, like its calls, carries the old ad; its lead the live one.
      ('makers-deal', 'makers', 'old', '2026-10-13 08:25+00', 6000, 500, 'Closer Two'),
      ('voided-deal', 'v1', 'old', '2026-10-13 09:00+00', 8000, 1500, 'Closer Two'),
      ('earlier-deal', 'c3', 'live', '2026-09-25 08:00+00', 6000, 500, 'Closer Two'),
      ('organic-deal', 'o1', null, '2026-10-14 08:00+00', 4000, 1000, 'Closer Two'),
      ('other-account', 'x1', 'not-ours', '2026-10-14 08:00+00', 2000, 0, 'Closer Two');
    insert into public.record_voids values ('closed_deal', 'voided-deal');
    ${extra}
  `);
  const runtime: Runtime = {
    env: () => undefined,
    read: async (_project: string, query: string) => (await db.query(query)).rows as Row[],
    repository: {} as Runtime["repository"],
    tools: { graph } as unknown as Runtime["tools"],
  };
  return withRuntime(runtime, () => adsPayload(FROM7, FROM30, TODAY, NOW));
}

describe("Our ads: every ad with activity in the window is on the tree (audit A)", () => {
  test("the tree query starts from the window's activity, not from snapshots inside it", () => {
    const sql = treeSql(FROM7, FROM30, TODAY);
    // Calls and deals are read through the lead's ad, bounded to the thirty days.
    // The lead's ad counts only from its first delivery (min(s.date)) up to the record's own day.
    expect(sql).toContain("coalesce(case when lead_ad.first_day <= (c.booked_at at time zone 'Asia/Riyadh')::date then lead_ad.ad_id end, c.ad_id) as ad_id");
    expect(sql).toContain("coalesce(case when lead_ad.first_day <= (d.submitted_at at time zone 'Asia/Riyadh')::date then lead_ad.ad_id end, d.ad_id) as ad_id");
    expect(sql).not.toMatch(/from public\.(calls c|closed_deals d)\s+where c?d?\.?ad_id is not null/);
    expect(() => treeSql(FROM7, "2026-9-17", TODAY)).toThrow("bad day");
    // ident comes after the funnel CTEs and reads the newest snapshot on or before the last day.
    expect(sql.indexOf("ident as (")).toBeGreaterThan(sql.indexOf("w30_deals as ("));
    expect(sql).toContain("where s.date <= date '2026-10-16'");
    expect(sql).toContain("select ad_id from w30_ads union select ad_id from w30_leads");
    expect(sql).toContain("union select ad_id from w30_calls union select ad_id from w30_deals");
    expect(sql).not.toContain("where date between date '2026-09-17' and date '2026-10-16'\n    order by ad_id");
  });

  test("calls and deals are credited to the ad that brought in the lead (the CEO: \"put it in seen first\")", async () => {
    const { payload } = await fixture();
    // The Makers lead came in on "Seen First | Hook 3"; its calls and its $6,000
    // deal carry "Lea Team sitting video". They land on the lead's ad.
    const live = adOf(payload, "live");
    expect(live.name).toBe("Seen First | Hook 3");
    expect(live.w7).toMatchObject({ introsBooked: 2, introsShown: 2, closes: 1, contracted: 6000, cash: 500 });
    expect(live.w30).toMatchObject({ introsBooked: 3, introsCancelled: 1, closes: 2, contracted: 12000 });
    // The old ad had nothing else in the window (its other deal is voided), so it leaves the tab.
    expect(adsOf(payload).some(a => a.id === "old")).toBe(false);

    // The account row and the campaign are unchanged: the deal moved inside them.
    expect(payload.account.w7).toMatchObject({ closes: 1, contracted: 6000, cash: 500 });
    expect(payload.account.w7.roas).toBe(Math.round((6000 / payload.account.w7.spend) * 100) / 100);
    expect(payload.account.w30).toMatchObject({ closes: 2, contracted: 12000 });
    const lg = campaignOf(payload, "lg")!;
    expect(lg.w7.closes).toBe(1);
    expect(lg.w30.closes).toBe(2);

    // A campaign paused before the window is on the tab with its demo (no lead row: its own ad).
    const paused = campaignOf(payload, "pc");
    expect(paused).toBeDefined();
    expect(adOf(payload, "hook1").w7).toMatchObject({ spend: 0, demosBooked: 1, demosShown: 1 });
  });

  test("a contact with no lead row keeps the ad on its call or deal, and a paused ad still carries them", async () => {
    const { payload } = await fixture(`
      insert into public.calls values ('walkin', 'old', 'intro', '2026-10-11 07:00+00', '2026-10-12 08:00+00', 'showed', 'u1');
      insert into public.closed_deals values ('walkin-deal', 'walkin', 'old', '2026-10-13 08:25+00', 6000, 500, 'Closer Two');
    `);
    const old = adOf(payload, "old");
    // Its newest snapshot on or before the last day names it.
    expect(old.name).toBe("Lea Team sitting video | 20-2-26");
    expect(old.running).toBe(false);
    expect(old.verdict.verdict).toBe("off");
    expect(old.w7).toMatchObject({ spend: 0, introsBooked: 1, introsShown: 1, closes: 1, contracted: 6000, cash: 500 });
    // $0 spent in the window: no cost per anything, never $0 (the live check found "CAC $0").
    expect([old.w7.cac, old.w7.costPerIntroBooked, old.w7.costPerIntroShown, old.w7.cpl]).toEqual([null, null, null, null]);
    expect(old.w7.roas).toBeNull();
    expect((old as unknown as { people: { closer: unknown } }).people.closer).toEqual({ name: "Closer Two", closes: 1 });
    // The Makers records stay on the lead's ad.
    expect(adOf(payload, "live").w7).toMatchObject({ introsBooked: 2, closes: 1 });
    expect(payload.account.w7).toMatchObject({ closes: 2, contracted: 12000 });
  });

  test("a lead's ad counts only from its first delivery: an older call keeps its own ad, a later deal moves", async () => {
    // Review of the rule: the lead row holds the contact's NEWEST opt-in ad. Makers became a lead in April
    // and Seen First first ran in September, so a June call credited to it would fall off a June range.
    const { payload } = await fixture(`
      insert into public.meta_ad_snapshots values ${snapshot("2026-10-14", "newer", "Opt-in ad first run on 10-14", LG, "ACTIVE", 2)}, ${snapshot("2026-10-15", "newer", "Opt-in ad first run on 10-14", LG, "ACTIVE", 2)};
      insert into public.leads values ('late', 'newer', '{roas-qualified}', '2026-10-14 06:00+00');
      insert into public.calls values ('late', 'ref', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'showed', 'u1');
      insert into public.closed_deals values ('late-deal', 'late', 'ref', '2026-10-15 08:00+00', 2500, 250, 'Closer Two');
    `);
    // Booked 10-12, before "newer" first delivered on 10-14: the call stays on its own ad.
    expect(adOf(payload, "ref").w7).toMatchObject({ introsBooked: 3, closes: 0 });
    // Signed 10-15, after: the deal goes to the lead's ad.
    expect(adOf(payload, "newer").w7).toMatchObject({ introsBooked: 0, closes: 1, contracted: 2500, cash: 250 });
    // Totals are the same either way, and coverage agrees with the rows.
    expect(payload.coverage.w7).toMatchObject({ adCloses: 2, adContracted: 8500 });
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).not.toContain("could not place");
    expect(text).toContain("was already running when the call was booked or the deal signed");
  });

  test("a lead whose ad is not one of this account's leaves the call and the deal on their own ad", async () => {
    const { payload } = await fixture(`
      insert into public.leads values ('elsewhere', 'gone', '{roas-qualified}', '2026-10-11 05:00+00');
      insert into public.calls values ('elsewhere', 'ref', 'intro', '2026-10-13 06:00+00', '2026-10-14 08:00+00', 'showed', 'u1');
      insert into public.closed_deals values ('elsewhere-deal', 'elsewhere', 'ref', '2026-10-15 08:00+00', 3000, 300, 'Closer Two');
    `);
    // "gone" has no Meta snapshot, so it is not on the tab and takes nothing.
    expect(adsOf(payload).some(a => a.id === "gone")).toBe(false);
    expect(adOf(payload, "ref").w7).toMatchObject({ introsBooked: 3, closes: 1, contracted: 3000, cash: 300 });
    expect(payload.coverage.w7).toMatchObject({ adCloses: 2, adContracted: 9000 });
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).not.toContain("could not place");
  });

  test("a deal with no ad of its own on a contact whose lead came from our ad is that ad's, and coverage counts it", async () => {
    const { payload } = await fixture(`
      insert into public.closed_deals values ('typed-in', 'c4', null, '2026-10-15 08:00+00', 5000, 1000, 'Closer Two');
    `);
    expect(adOf(payload, "ref").w7).toMatchObject({ closes: 1, contracted: 5000, cash: 1000 });
    expect(payload.coverage.w7).toMatchObject({ closes: 4, adCloses: 2, adContracted: 11000 });
    expect(payload.account.w7).toMatchObject({ closes: 2, contracted: 11000 });
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).not.toContain("could not place");
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
    expect(text).toContain("Calls and deals are credited to the ad on the contact's lead record when it is one of this account's ads and was already running when the call was booked or the deal signed; otherwise they keep the ad on the call or deal.");
    expect(text).not.toContain("which can differ from the ad on the lead");
  });

  test("a deal on one of our ads that the tree cannot place is counted and named in a warning", async () => {
    // Meta's only snapshot of this ad is after the last day, so no ad row can hold it.
    const { payload } = await fixture(`
      insert into public.meta_ad_snapshots values ${snapshot("2026-10-20", "later", "Later", LG, "ACTIVE", 1)};
      insert into public.closed_deals values ('later-deal', 'l1', 'later', '2026-10-15 08:00+00', 3000, 300, 'Closer Two');
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
    expect(ref.w7.leadsToConfirmedIntro).toBe(1);
    expect(ref.w7.bookRate).toBe(1);
    // The Makers lead booked an intro that carries the old ad: one lead that booked, and its intro, on the lead's ad.
    const live = adOf(payload, "live");
    expect(live.w7).toMatchObject({ leads: 3, leadsToIntro: 2, leadsToConfirmedIntro: 2, introsBooked: 2 });
    expect(live.w7.bookRate).toBe(0.6667);
    for (const ad of adsOf(payload)) {
      for (const w of [ad.w7, ad.w30]) {
        if (w.bookRate !== null) expect(w.bookRate).toBeLessThanOrEqual(1);
        if (w.leadToDemo !== null) expect(w.leadToDemo).toBeLessThanOrEqual(1);
        if (w.confirmedIntroRate !== null) expect(w.confirmedIntroRate).toBeLessThanOrEqual(1);
      }
    }
    expect(payload.account.w7.bookRate).toBeLessThanOrEqual(1);
  });

  test("intros and confirmed intros count each lead once, on the lead's own ad (the CEO, 2026-10-18)", async () => {
    // "For intros, it shouldn't count re-scheduled either. It should just count once."
    const { payload } = await fixture(`
      insert into public.meta_ad_snapshots values ${days(FROM7, TODAY).map(d => snapshot(d, "intros", "Open House | Hook 2", LG, "ACTIVE", 3)).join(",")};
      insert into public.leads values
        ('rebook', 'intros', '{roas-qualified}', '2026-10-10 05:00+00'),
        ('cancel', 'intros', '{roas-qualified}', '2026-10-10 05:00+00'),
        ('invalid', 'intros', '{roas-unqualified}', '2026-10-11 05:00+00'),
        ('upcoming', 'intros', '{roas-qualified}', '2026-10-12 05:00+00'),
        ('held', 'intros', '{roas-qualified}', '2026-10-12 05:00+00'),
        ('straight', 'intros', '{roas-qualified}', '2026-10-13 05:00+00'),
        ('veteran', 'intros', '{roas-qualified}', '2025-09-06 05:00+00'),
        ('untagged', 'intros', '{}', '2026-10-13 05:00+00');
      insert into public.calls values
        -- A no-show, its rebooking that showed, and a second showed intro: one intro, one confirmed.
        ('rebook', 'intros', 'intro', '2026-10-10 06:00+00', '2026-10-11 08:00+00', 'noshow', 'u1'),
        ('rebook', 'intros', 'intro', '2026-10-11 09:00+00', '2026-10-13 08:00+00', 'showed', 'u1'),
        ('rebook', 'intros', 'intro', '2026-10-13 09:00+00', '2026-10-14 08:00+00', 'showed', 'u1'),
        -- Cancelled only: not an intro.
        ('cancel', 'intros', 'intro', '2026-10-10 06:00+00', '2026-10-12 08:00+00', 'cancelled', 'u1'),
        -- Held and marked invalid: an intro (B2B's show rule counts invalid as shown), never a confirmed one.
        ('invalid', 'intros', 'intro', '2026-10-11 06:00+00', '2026-10-12 08:00+00', 'invalid', 'u1'),
        -- Confirmed for a day still ahead: an intro, not yet confirmed.
        ('upcoming', 'intros', 'intro', '2026-10-12 06:00+00', '2030-01-07 08:00+00', 'confirmed', 'u1'),
        -- Cancelled, then rebooked and still confirmed after its time: one intro, confirmed.
        ('held', 'intros', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'cancelled', 'u1'),
        ('held', 'intros', 'intro', '2026-10-13 06:00+00', '2026-10-14 08:00+00', 'confirmed', 'u1'),
        -- Straight to a demo with no intro: not an intro.
        ('straight', 'intros', 'demo', '2026-10-13 06:00+00', '2026-10-15 08:00+00', 'showed', 'u2'),
        -- A lead from last year, and a contact with no ROAS tag, rebooking this week: neither is this window's lead.
        ('veteran', 'intros', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'showed', 'u1'),
        ('untagged', 'intros', 'intro', '2026-10-13 06:00+00', '2026-10-14 08:00+00', 'showed', 'u1');
    `);
    const ad = adOf(payload, "intros");
    for (const w of [ad.w7, ad.w30]) {
      expect(w).toMatchObject({ spend: 21, leads: 6, leadsToIntro: 4, leadsToConfirmedIntro: 2 });
      expect(w).toMatchObject({ bookRate: 0.6667, costPerIntro: 5.25, costPerConfirmedIntro: 10.5, confirmedIntroRate: 0.5 });
      // The appointments the tab used to show: ten, rebookings, cancels and older leads included.
      expect(w.introsBooked).toBe(10);
    }
    // The setter line counts each lead once too: six leads whose intro was due, five of them shown. It reads
    // thirty days and every intro booked (the veteran and untagged leads, invalid shown by the B2B rule), so
    // the screen says its days and rule beside it (adsFacts.tsx People).
    expect((ad as unknown as { people: { setter: unknown } }).people.setter).toEqual({ name: "Setter One", shown: 5, due: 6 });
    // The account row and the campaign add the ads' leads up, never the appointments.
    // This ad, "Seen First | Hook 3" (Makers and c2) and "Referrals Are Not A System" (c4).
    expect(payload.account.w7).toMatchObject({ leadsToIntro: 4 + 2 + 1, leadsToConfirmedIntro: 2 + 2 + 1 });
    const lg = campaignOf(payload, "lg")!.w7;
    expect(lg.costPerConfirmedIntro).toBe(Math.round(((lg.spend ?? 0) / 5) * 100) / 100);
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).toContain("Intros are counted once per lead, however often the intro was rebooked");
    expect(text).toContain("A lead that went straight to a demo is not an intro.");
    expect(text).toContain("that was not cancelled. An intro marked invalid was held, so it counts.");
    expect(text).not.toContain("cancelled or marked invalid");
    expect(text).not.toMatch(/cost per demo/i);
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
  "leads_to_intro", "leads_to_confirmed_intro", "leads_to_demo", "intros_booked", "intros_due", "intros_shown", "intros_qualified",
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
    // Demos shown a week ago with nothing signed: the Sales tab's to judge, never an ad's (the CEO, 2026-10-18).
    row("old-demos", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 6, demos_shown: 4, demos_shown_mature: 3 }),
    // Eight leads in thirty days and none booked, though older leads' appointments sit on the ad.
    row("no-book", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 8, intros_booked: 3 }),
    // Five leads booked an intro and none showed or stayed confirmed.
    row("unconfirmed", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 6, leads_to_intro: 5, intros_booked: 7 }),
    row("one-confirmed", "lg", "lead_gen", { spend: 20, leads: 2 }, { spend: 80, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 1 }),
  ];

  test("each verdict says what the money did in its window and never prints a cost per lead that does not exist", async () => {
    const { payload } = await rowsRun(ROWS, { "hidden-tax": "2.7502" });
    const v = (id: string) => adOf(payload, id).verdict;

    expect(v("margin-tax")).toEqual({ verdict: "hold", reason: "$22.80 in seven days and no lead yet: not enough data. The verdict comes at $30 (2 x the $15 gate).", owner: "ads" });
    expect(v("hidden-tax")).toEqual({ verdict: "not_judged", reason: "Retargeting is not judged on cost per lead.", owner: null });
    expect(v("rt-small").verdict).toBe("not_judged");
    expect(v("lg-small")).toEqual({ verdict: "hold", reason: "Delivering, but only $0.77 and 41 impressions in seven days: too little to judge.", owner: "ads" });
    expect(v("lg-none")).toEqual({ verdict: "no delivery", reason: "On, but nothing spent in seven days.", owner: "ads" });
    expect(v("dear")).toEqual({ verdict: "kill", reason: "$34.53 a lead in seven days, more than half again over the $15 gate.", owner: "ads" });
    expect(v("watch").verdict).toBe("hold");
    expect(v("watch").reason).toBe("$18.00 a lead in seven days is over the $15 gate but within half again. Watch it; do not scale it.");
    expect(v("good")).toEqual({ verdict: "scale", reason: "$10.00 a lead in seven days, under the $15 gate, on $20.", owner: "ads" });
    expect(v("old-demos").verdict).toBe("scale");
    expect(v("no-book")).toEqual({ verdict: "leads do not book", reason: "8 leads in thirty days and no intro booked. The ad is doing its job; the follow-up is not.", owner: "setter" });
    expect(v("unconfirmed")).toEqual({ verdict: "intros do not confirm", reason: "5 leads booked an intro in thirty days and none of them showed or stayed confirmed. That is the setter's confirming, not the ad.", owner: "setter" });
    expect(v("one-confirmed").verdict).toBe("scale");

    for (const ad of adsOf(payload)) {
      expect(ad.verdict.reason).not.toContain("$0.00");
      expect(ad.verdict.reason).not.toContain("demo");
      if (ad.w7.spend !== 0) expect(ad.verdict.reason).not.toContain("nothing spent");
    }
    // A scale is only ever a lead-gen ad with a lead at or under the gate.
    const scale = adsOf(payload).filter(a => a.verdict.verdict === "scale");
    expect(scale.every(a => (a.w7.leads ?? 0) >= 1 && (a.w7.cpl ?? Infinity) <= 15)).toBe(true);
    expect(payload.verdicts).toEqual({ hold: 3, not_judged: 2, "no delivery": 1, kill: 1, scale: 3, "leads do not book": 1, "intros do not confirm": 1 });
    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).toContain('"Leads do not book" and "intros do not confirm" are the setter.');
    expect(text).not.toMatch(/demos do not close|cost per demo/i);
    expect(payload.verdicts.fatiguing).toBeUndefined();
  });

  // The CEO, 23 Oct 2026 (cost per booking decisions, 4): "Depends on how much
  // spend if 2x target cpl then yes bad if below that then not enough data".
  test("no lead: a kill at 2 x the $15 gate, judged on the cent; under it, not enough data", async () => {
    const { payload } = await rowsRun([
      row("under", "lg", "lead_gen", { spend: 29.99, impressions: 900 }),
      row("cent-under", "lg", "lead_gen", { spend: 29.994, impressions: 900 }),
      row("cent-at", "lg", "lead_gen", { spend: 29.995, impressions: 900 }),
      row("at", "lg", "lead_gen", { spend: 30, impressions: 900 }),
    ]);
    const v = (id: string) => adOf(payload, id).verdict;
    expect(v("under")).toEqual({ verdict: "hold", reason: "$29.99 in seven days and no lead yet: not enough data. The verdict comes at $30 (2 x the $15 gate).", owner: "ads" });
    expect(v("cent-under").verdict).toBe("hold");
    expect(v("cent-at").verdict).toBe("kill");
    expect(v("at")).toEqual({ verdict: "kill", reason: "$30 in seven days and not one lead reached the CRM.", owner: "ads" });
  });

  test("a lead-gen ad at frequency 2.5 or more is still fatiguing", async () => {
    const { payload } = await rowsRun([row("tired", "lg", "lead_gen", { spend: 20, leads: 2 })], { tired: "2.75" });
    expect(adOf(payload, "tired").verdict.verdict).toBe("fatiguing");
  });
});

describe("Our ads: the campaign constraint stops at the confirmed intro (the CEO, 2026-10-18)", () => {
  // Below every other stage's floor, so only the stage under test can fire.
  const quiet = { impressions: 400, link_clicks: 10, leads: 3, leads_to_intro: 1 };

  test("intros to confirmed intros is per lead and never passes 100%", async () => {
    const weak = { ...quiet, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 1, intros_booked: 9 };
    const strong = { ...quiet, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 4 };
    const { payload } = await rowsRun([row("a", "weak", "lead_gen", weak), row("b", "strong", "lead_gen", strong)]);
    const c = campaignOf(payload, "weak")!;
    expect(c.constraint).toEqual({ stage: "intros to confirmed intros", owner: "setter", mine: 0.2, account: 0.5 });
    expect(c.constraint!.mine).toBe(c.w30.confirmedIntroRate);
    expect(payload.account.w30.confirmedIntroRate).toBe(0.5);
    expect(campaignOf(payload, "strong")!.constraint).toBeNull();
    for (const campaign of payload.campaigns as Campaign[]) {
      if (!campaign.constraint) continue;
      expect(campaign.constraint.mine).toBeLessThanOrEqual(1);
      expect(campaign.constraint.account).toBeLessThanOrEqual(1);
    }
  });

  test("demos and closes are never a campaign's stage: no intro-to-demo, no closer", async () => {
    // Under the old stages these blamed the setter for intros shown that booked no demo, and the closer for five demos and no close.
    const noDemo = { ...quiet, intros_due: 10, intros_shown: 10, intros_advanced: 2, demos_booked: 15, demos_shown: 5 };
    const closes = { ...quiet, intros_due: 10, intros_shown: 10, intros_advanced: 8, demos_shown: 3, closes: 3 };
    const { payload } = await rowsRun([row("a", "a", "lead_gen", noDemo), row("b", "b", "lead_gen", closes)]);
    expect(payload.account.w30.closes).toBe(3);
    for (const campaign of payload.campaigns as Campaign[]) expect(campaign.constraint).toBeNull();
  });

  test("a campaign with fewer than five intros is too few to judge on confirming", async () => {
    const thin = { ...quiet, leads: 6, leads_to_intro: 4, leads_to_confirmed_intro: 0 };
    const full = { ...quiet, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 5 };
    const { payload } = await rowsRun([row("a", "thin", "lead_gen", thin), row("b", "full", "lead_gen", full)]);
    expect(campaignOf(payload, "thin")!.constraint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// On and off is Meta's own (the CEO, 2026-10-19: "Ads turning on and off in
// the CEO cockpit isn't working"). The switch read the snapshots, which hold a
// row only for a day an ad delivered: an ad switched on read off until it
// spent and the sync caught up, and a stale ACTIVE row outranked a switch-off.
// ---------------------------------------------------------------------------

type Calls = { resource: string; params: Record<string, string | number> }[];
type Lists = Record<"campaigns" | "adsets" | "ads", Record<string, string>[][]>;
/** Meta's live lists, page by page, through the same fake Graph as the account and the insights. */
function liveGraph(lists: Lists, calls: Calls = []): Graph {
  return async (resource, params = {}) => {
    calls.push({ resource, params });
    const edge = STATUS_EDGE.exec(resource)?.[1] as keyof Lists | undefined;
    if (!edge) return resource.endsWith("/insights") ? ({ data: [], paging: {} } as unknown as Row) : (ACCOUNT as unknown as Row);
    const pages = lists[edge];
    const page = params.after ? Number(String(params.after).replace("page", "")) : 0;
    const more = page + 1 < pages.length;
    return {
      data: pages[page],
      paging: more ? { cursors: { after: `page${page + 1}` }, next: "https://graph.facebook.com/v21.0/next" } : { cursors: {} },
    } as unknown as Row;
  };
}
const obj = (id: string, name: string, status: string, effective: string, parents: Record<string, string> = {}) =>
  ({ id, name, status, configured_status: status, effective_status: effective, ...parents });
const inLg = { adset_id: "lg-set", campaign_id: "lg" };
const LIVE: Lists = {
  campaigns: [[
    obj("lg", LG.name, "ACTIVE", "ACTIVE"),
    obj("pc", PAUSED_CAMPAIGN.name, "PAUSED", "PAUSED"),
    obj("new-camp", "MaharaMedia | Lead Gen | 19-10-26", "ACTIVE", "ACTIVE"),
  ]],
  adsets: [[
    obj("lg-set", "Set lg-set", "ACTIVE", "ACTIVE", { campaign_id: "lg" }),
    obj("pc-set", "Set pc-set", "ACTIVE", "CAMPAIGN_PAUSED", { campaign_id: "pc" }),
    obj("new-set", "Kuwait founders", "ACTIVE", "ACTIVE", { campaign_id: "new-camp" }),
  ]],
  ads: [
    [
      // Switched off in Meta this morning; every snapshot this month says ACTIVE.
      obj("live", "Seen First | Hook 3", "PAUSED", "PAUSED", inLg),
      obj("ref", "Referrals Are Not A System", "ACTIVE", "ACTIVE", inLg),
      obj("demo", "Burnout From Work", "ACTIVE", "ACTIVE", inLg),
      // Switched back on; no delivery since August.
      obj("stale", "Stale but ACTIVE", "ACTIVE", "ACTIVE", inLg),
    ],
    [
      obj("hook1", "Seen First | Hook 1 | 4-9-26", "ACTIVE", "CAMPAIGN_PAUSED", { adset_id: "pc-set", campaign_id: "pc" }),
      // Switched on, never delivered, so no snapshot: the tab adds them at $0 to be switched.
      obj("fresh", "Seen First | Hook 4 | 19-10-26", "ACTIVE", "ACTIVE", inLg),
      obj("fresh2", "Founder story | 19-10-26", "ACTIVE", "ACTIVE", { adset_id: "new-set", campaign_id: "new-camp" }),
      // Archived, or never switched on, with no snapshot: never added.
      obj("gone", "Old test", "ARCHIVED", "ARCHIVED", inLg),
      obj("never", "Draft", "PAUSED", "PAUSED", inLg),
    ],
  ],
};
const STALE = `
  insert into public.meta_ad_snapshots values ${snapshot("2026-08-20", "stale", "Stale but ACTIVE", LG, "ACTIVE", 3)};
  insert into public.calls values ('c7', 'stale', 'intro', '2026-10-12 06:00+00', '2026-10-13 08:00+00', 'showed', 'u1');
`;

describe("Our ads: on and off is Meta's own, read live (the CEO, 2026-10-19)", () => {
  test("a switch-off outranks a stale ACTIVE snapshot, a switch-on shows before it delivers, and the numbers stay the snapshots'", async () => {
    const calls: Calls = [];
    const before = Date.now();
    const { payload, sources } = await fixture(STALE, liveGraph(LIVE, calls));
    expect(payload.statusFrom).toBe("meta");
    expect(payload.statusReadAt).toBeGreaterThanOrEqual(before);
    expect(payload.statusReadAt).toBeLessThanOrEqual(Date.now());

    // Off in Meta: off here, whatever its snapshots say; its money is still on the rows.
    const live = adOf(payload, "live") as Ad & Record<string, unknown>;
    expect(live).toMatchObject({ status: "PAUSED", running: false, switchOn: false, delivered: true, lastDelivery: TODAY });
    expect(live.verdict).toEqual({ verdict: "off", reason: "Switched off in Meta.", owner: null });
    expect(live.w7).toMatchObject({ closes: 1, contracted: 6000 });
    expect(payload.account.w7).toMatchObject({ closes: 1, contracted: 6000 });

    // On in Meta with no delivery since August: running, and the verdict says why it has no numbers.
    const stale = adOf(payload, "stale") as Ad & Record<string, unknown>;
    expect(stale).toMatchObject({ status: "ACTIVE", running: true, switchOn: true, delivered: false, lastDelivery: "2026-08-20" });
    expect(stale.verdict).toEqual({ verdict: "no delivery", reason: "On in Meta, but no delivery since 2026-08-20.", owner: "ads" });

    // A paused campaign makes its ad not running: Meta's own word for it.
    // Its own switch stays on (switchOn), the one the cockpit's switch shows and sets, so it can be
    // switched off from here and does not snap back after a switch-on; it is not counted as running.
    const hook1 = adOf(payload, "hook1");
    expect(hook1).toMatchObject({ status: "CAMPAIGN_PAUSED", running: false, switchOn: true });
    expect(hook1.verdict.reason).toBe("Its campaign is switched off in Meta. No Meta delivery since 2026-09-05.");
    const pc = campaignOf(payload, "pc") as Campaign & Record<string, unknown>;
    expect(pc).toMatchObject({ status: "PAUSED", running: false, switchOn: false });
    expect(pc.adsets[0]).toMatchObject({ status: "CAMPAIGN_PAUSED", running: false, switchOn: true });
    expect(campaignOf(payload, "lg")).toMatchObject({ running: true, switchOn: true });

    // Switched on, never delivered: on the tab at $0, under its ad set and campaign, so it can be switched.
    const fresh = adOf(payload, "fresh") as Ad & Record<string, unknown>;
    expect(fresh).toMatchObject({ name: "Seen First | Hook 4 | 19-10-26", status: "ACTIVE", running: true, switchOn: true, delivered: false, lastDelivery: null });
    expect(fresh.w7).toMatchObject({ spend: 0, leads: 0, cpl: null });
    expect(fresh.verdict).toEqual({ verdict: "no delivery", reason: "On in Meta, with no delivery in the thirty days: its numbers start when it spends.", owner: "ads" });
    expect(campaignOf(payload, "lg")!.adsets.find(s => s.id === "lg-set")!.ads.some(a => a.id === "fresh")).toBe(true);
    const newCamp = campaignOf(payload, "new-camp") as Campaign & Record<string, unknown>;
    expect(newCamp).toMatchObject({ name: "MaharaMedia | Lead Gen | 19-10-26", type: "lead_gen", status: "ACTIVE", running: true, switchOn: true, delivered: false });
    expect(newCamp.adsets[0]).toMatchObject({ running: true, switchOn: true });
    expect(newCamp.adsets.map(s => [s.id, (s as unknown as { name: string }).name, s.ads.map(a => a.id)])).toEqual([["new-set", "Kuwait founders", ["fresh2"]]]);
    expect(adsOf(payload).some(a => a.id === "gone" || a.id === "never")).toBe(false);

    expect(adsOf(payload).filter(a => a.running).map(a => a.id).sort()).toEqual(["demo", "fresh", "fresh2", "ref", "stale"]);
    expect(payload.running).toBe(5);
    expect(payload.total).toBe(7);
    expect(payload.verdicts).toEqual({ scale: 1, hold: 1, "no delivery": 3 });

    // Three paged reads, after the account and before any insight; the ads took two pages.
    const reads = calls.filter(c => STATUS_EDGE.test(c.resource));
    expect(reads.map(c => [c.resource.split("/")[1], c.params.limit, c.params.after ?? null])).toEqual([
      ["campaigns", 500, null], ["adsets", 500, null], ["ads", 500, null], ["ads", 500, "page1"],
    ]);
    expect(String(reads[2].params.fields)).toBe("id,name,status,effective_status,configured_status,adset_id,campaign_id");
    expect(calls[0].resource).toBe("act_746108264865897");

    const text = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(text).toContain("On and off is Meta's own setting, read from the ad account when this was built");
    expect(text).toContain("2 ads are on in Meta with no delivery in the thirty days, so they show at $0 until they spend, and can be switched from here.");
    expect(text).not.toContain("could not be read");
    expect(sources.find((s: { name: string }) => s.name === "Meta on and off by campaign, ad set and ad (Graph API)")).toEqual({
      name: "Meta on and off by campaign, ad set and ad (Graph API)", ok: true, freshestAt: payload.statusReadAt,
    });
  });

  test("a failed status read falls back to the snapshot rule with a note, and the section still publishes", async () => {
    const { payload, sources } = await fixture(STALE);
    expect(payload.statusFrom).toBe("snapshots");
    expect(payload.statusReadAt).toBeNull();
    // Today's rule: ACTIVE with delivery in the thirty days.
    expect(adOf(payload, "live")).toMatchObject({ status: "ACTIVE", running: true });
    expect(adOf(payload, "stale")).toMatchObject({ running: false });
    // No own switch is known on the fallback: the cockpit's switch shows running.
    expect(adsOf(payload).some(a => "switchOn" in a)).toBe(false);
    expect((payload.campaigns as Record<string, unknown>[]).some(c => "switchOn" in c)).toBe(false);
    expect(adOf(payload, "stale").verdict).toEqual({ verdict: "off", reason: "No Meta delivery since 2026-08-20.", owner: null });
    expect(adsOf(payload).some(a => a.id === "fresh")).toBe(false);
    const warn = payload.notes.find((n: { level: string; text: string }) => n.level === "warn" && n.text.startsWith("Meta's own on and off"));
    expect(warn?.text).toBe("Meta's own on and off could not be read (Meta Graph API error 17), so the switches show delivery, not Meta's setting: an ad counts as on only when its newest snapshot says active and it delivered in the thirty days. A change made in Meta shows here once the ad delivers and the snapshot sync catches up.");
    // Never a failed source: the worker refuses a section with one.
    expect(sources.every((s: { ok: boolean }) => s.ok === true)).toBe(true);
    expect(sources.some((s: { name: string }) => s.name.startsWith("Meta on and off"))).toBe(false);

    // A page that says there is more but gives no cursor is a failed read too, never a partial list.
    const broken: Lists = { ...LIVE, ads: [LIVE.ads[0]] };
    const partial = await fixture(STALE, async (resource, params) => {
      if (resource.endsWith("/ads")) return { data: broken.ads[0], paging: { next: "https://graph.facebook.com/v21.0/next" } } as unknown as Row;
      return liveGraph(LIVE)(resource, params);
    });
    expect(partial.payload.statusFrom).toBe("snapshots");
    expect(partial.payload.notes.some((n: { text: string }) => n.text.includes("(Meta returned an incomplete ads page.)"))).toBe(true);
  });
});
