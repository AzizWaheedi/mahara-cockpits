/**
 * The Ads tab's section for the layout harness, made up (2026-10-19): two
 * campaigns, three ad sets, five ads, some on and some off, so every switch
 * on the tab can be tried. `?tab=ads&ads=demo` lays it over the sections the
 * harness already answers, and `cockpit-media-api` answers the switch with a
 * made-up "ok" after a short wait; `&ads=refuse` answers with a made-up
 * refusal instead. Every name, id and number is invented. Never imported by
 * the production app.
 */
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bAdWindow,
  B2bVerdict,
} from "@/types/ceo/payloads";

/** "ok" (the default), "refuse", or null when the URL does not ask for the made-up section. */
export function adsFixtureMode(): "ok" | "refuse" | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("ads");
  if (v === "demo") return "ok";
  if (v === "refuse") return "refuse";
  return null;
}

const KUWAIT_MS = 3 * 3600_000;
const kuwaitDay = (ms: number) =>
  new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
function shiftDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const per = (a: number, b: number | null) => (b ? a / b : null);

/** One window from a few counts; every rate follows from them. */
function win(o: {
  spend: number;
  impressions: number;
  linkClicks: number;
  leads: number;
  intros?: number;
  confirmed?: number;
  closes?: number;
  contracted?: number;
}): B2bAdWindow {
  const intros = o.intros ?? 0;
  const confirmed = o.confirmed ?? 0;
  const closes = o.closes ?? 0;
  const contracted = o.contracted ?? 0;
  return {
    spend: o.spend,
    impressions: o.impressions,
    clicks: Math.round(o.linkClicks * 1.4),
    linkClicks: o.linkClicks,
    metaLeads: o.leads + 1,
    leads: o.leads,
    qualifiedLeads: Math.round(o.leads * 0.6),
    notReadyLeads: 0,
    introsBooked: intros,
    introsDue: intros,
    introsShown: confirmed,
    introsQualified: confirmed,
    introsCancelled: 0,
    introsAdvanced: 0,
    leadsToIntro: intros,
    leadsToConfirmedIntro: confirmed,
    leadsToDemo: 0,
    demosBooked: 0,
    demosDue: 0,
    demosShown: 0,
    demosShownMature: 0,
    demosQualified: 0,
    demosCancelled: 0,
    closes,
    contracted,
    cash: contracted / 2,
    frequency: o.impressions ? 1.42 : null,
    cpm: per(o.spend * 1000, o.impressions),
    ctr: per(o.linkClicks * 1.4, o.impressions),
    ctrLink: per(o.linkClicks, o.impressions),
    cpc: per(o.spend, o.linkClicks),
    cpl: per(o.spend, o.leads),
    qualifiedPct: o.leads ? 0.6 : null,
    costPerQualified: per(o.spend, Math.round(o.leads * 0.6)),
    bookRate: per(intros, o.leads),
    costPerIntroBooked: per(o.spend, intros),
    introShowRate: per(confirmed, intros),
    costPerIntroShown: per(o.spend, confirmed),
    introToDemo: null,
    demoShowRate: null,
    costPerDemoBooked: null,
    costPerDemo: null,
    closeRate: null,
    closeRateQualified: null,
    cac: per(o.spend, closes),
    roas: per(contracted, o.spend),
    cashRoas: per(contracted / 2, o.spend),
    leadToDemo: null,
    costPerIntro: per(o.spend, intros),
    costPerConfirmedIntro: per(o.spend, confirmed),
    confirmedIntroRate: per(confirmed, intros),
  };
}

const ZERO = win({ spend: 0, impressions: 0, linkClicks: 0, leads: 0 });

function sum(ws: B2bAdWindow[]): B2bAdWindow {
  const t = ws.reduce(
    (a, w) => ({
      spend: a.spend + w.spend,
      impressions: a.impressions + w.impressions,
      linkClicks: a.linkClicks + (w.linkClicks ?? 0),
      leads: a.leads + w.leads,
      intros: a.intros + (w.leadsToIntro ?? 0),
      confirmed: a.confirmed + (w.leadsToConfirmedIntro ?? 0),
      closes: a.closes + w.closes,
      contracted: a.contracted + w.contracted,
    }),
    {
      spend: 0,
      impressions: 0,
      linkClicks: 0,
      leads: 0,
      intros: 0,
      confirmed: 0,
      closes: 0,
      contracted: 0,
    },
  );
  return win(t);
}

const noPeople = { setter: null, closer: null };

function ad(
  id: string,
  name: string,
  running: boolean,
  w7: B2bAdWindow,
  w30: B2bAdWindow,
  verdict: B2bVerdict,
): B2bAdNode {
  return {
    id,
    name,
    status: running ? "ACTIVE" : "PAUSED",
    running,
    thumbnail: null,
    w7,
    w30,
    verdict,
    people: noPeople,
  };
}

function adset(id: string, name: string, ads: B2bAdNode[]) {
  return {
    id,
    name,
    running: ads.some(a => a.running),
    w7: sum(ads.map(a => a.w7)),
    w30: sum(ads.map(a => a.w30)),
    people: noPeople,
    ads,
  };
}

/** The made-up b2bAds section, computed a few minutes before `now`. */
export function adsSectionFixture(now: number = Date.now()) {
  const to = kuwaitDay(now);
  const windows = {
    from7: shiftDays(to, -6),
    from30: shiftDays(to, -29),
    to,
  };
  const scale = {
    verdict: "scale" as const,
    reason: "Cost per lead $11 is under the $15 gate with steady delivery.",
    owner: "ads" as const,
  };
  const hold = {
    verdict: "hold" as const,
    reason: "Cost per lead $17 is a little over the $15 gate; seven more days.",
    owner: "ads" as const,
  };
  const off = (since: string) => ({
    verdict: "off" as const,
    reason: `No Meta delivery since ${since}.`,
    owner: null,
  });

  const a1 = ad(
    "900000000000001",
    "Founder story, Arabic voice-over",
    true,
    win({
      spend: 132,
      impressions: 9100,
      linkClicks: 140,
      leads: 12,
      intros: 5,
      confirmed: 3,
    }),
    win({
      spend: 520,
      impressions: 38200,
      linkClicks: 610,
      leads: 47,
      intros: 19,
      confirmed: 11,
      closes: 1,
      contracted: 3600,
    }),
    scale,
  );
  const a2 = ad(
    "900000000000002",
    "Clinic owner testimonial, 30 seconds",
    true,
    win({
      spend: 86,
      impressions: 6400,
      linkClicks: 71,
      leads: 5,
      intros: 2,
      confirmed: 1,
    }),
    win({
      spend: 340,
      impressions: 25100,
      linkClicks: 290,
      leads: 20,
      intros: 7,
      confirmed: 3,
    }),
    hold,
  );
  const a3 = ad(
    "900000000000003",
    "Before and after carousel",
    false,
    ZERO,
    win({ spend: 64, impressions: 5200, linkClicks: 48, leads: 3, intros: 1 }),
    off(shiftDays(to, -12)),
  );
  const a4 = ad(
    "900000000000004",
    "Webinar invite, static",
    false,
    ZERO,
    win({ spend: 41, impressions: 3900, linkClicks: 30, leads: 2 }),
    off(shiftDays(to, -20)),
  );
  const a5 = ad(
    "900000000000005",
    "Warm audience reminder",
    true,
    win({ spend: 22, impressions: 2100, linkClicks: 19, leads: 0 }),
    win({ spend: 90, impressions: 8800, linkClicks: 77, leads: 1 }),
    {
      verdict: "not_judged",
      reason: "Retargeting is never held to the cost per lead gate.",
      owner: null,
    },
  );

  const s1 = adset("910000000000001", "Gulf founders, 28 to 55", [a1, a2]);
  const s2 = adset("910000000000002", "Clinics, broad", [a3, a4]);
  const s3 = adset("910000000000003", "Site visitors, 30 days", [a5]);
  const campaigns = [
    {
      id: "920000000000001",
      name: "Lead gen, October",
      type: "lead_gen",
      status: "ACTIVE",
      running: s1.running || s2.running,
      w7: sum([s1.w7, s2.w7]),
      w30: sum([s1.w30, s2.w30]),
      people: noPeople,
      constraint: null,
      adsets: [s1, s2],
    },
    {
      id: "920000000000002",
      name: "Retargeting, always on",
      type: "retargeting",
      status: "ACTIVE",
      running: s3.running,
      w7: s3.w7,
      w30: s3.w30,
      people: noPeople,
      constraint: null,
      adsets: [s3],
    },
  ];
  const ads = [a1, a2, a3, a4, a5];
  const leadGen = [s1, s2];
  const payload: B2bAdsPayload = {
    accountId: "1000000000000001",
    windows,
    account: {
      w7: sum(leadGen.map(s => s.w7)),
      w30: sum(leadGen.map(s => s.w30)),
    },
    retargetingSpend: { w7: a5.w7.spend, w30: a5.w30.spend },
    coverage: {
      w7: {
        leads: 19,
        adLeads: 17,
        closes: 0,
        adCloses: 0,
        contracted: 0,
        adContracted: 0,
      },
      w30: {
        leads: 81,
        adLeads: 72,
        closes: 1,
        adCloses: 1,
        contracted: 3600,
        adContracted: 3600,
      },
    },
    running: ads.filter(a => a.running).length,
    total: ads.length,
    verdicts: { scale: 1, hold: 1, not_judged: 1 },
    campaigns,
    lastSnapshotDay: to,
    firstSnapshotDay: shiftDays(to, -120),
    accountStatus: {
      code: 1,
      label: "active",
      disableReason: null,
      balance: null,
      currency: "USD",
    },
    notes: [
      {
        level: "info",
        text: "Made-up numbers for the layout harness. Nothing here is Mahara's account.",
      },
    ],
  };
  const computedAt = now - 6 * 60_000;
  return {
    key: "b2bAds",
    label: "Our ads",
    ok: true,
    error: null,
    computedAt,
    lastOkAt: computedAt,
    // The snapshot sync keeps its own clock: here it last ran four minutes before the publish.
    sources: [
      {
        name: "B2B Meta ad snapshots",
        freshestAt: computedAt - 4 * 60_000,
        ok: true,
      },
      { name: "B2B leads, calls and closed deals (ad attribution)", ok: true },
    ],
    payload,
  };
}
