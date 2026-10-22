/**
 * Made-up campaigns for the Ads page in the layout harness (adsPageHarness.ts).
 * Every client, campaign, id and figure is invented. Each campaign has one
 * daily plan, and everything is worked out from it: the 7-day snapshot the
 * board shows on "7 days", and the per-day rows and bookings
 * cockpit_media_statistics hands the picked range. So every range reads
 * different numbers, and the 7-day snapshot is what a 7-day range read of
 * the same rows would say. Never imported by the production app.
 *
 * The cases, by campaign (the 7-day snapshot against a picked range):
 *   Cedar Stone villa     under $60 a booking on 7 days, over on 14/30 days
 *   Northwind             over $60 a booking on 7 days, under on 14/30 days
 *                         (a riyal account, budgets shown in dollars)
 *   Marble Bay            bookings 4 to 6 days ago only: none today,
 *                         yesterday or over 3 days
 *   Juniper               no bookings in 7 days, bookings before; Meta's
 *                         payment grace period on its account
 *   Falcon Ridge          done with you: no bookings at all (n/a, not 0)
 *   Opal House            spend but no leads for the last 3 days
 *   Lantern               launched yesterday: spend, no leads yet
 *   Cedar Stone kitchens  steady, well under both gates
 *   Driftwood             off on the board and stopped 20 days ago
 */

type Row = Record<string, unknown>;

const H = 3_600_000;
const D = 24 * H;

/**
 * How many days behind the made-up Meta numbers end: `&through=1` makes them
 * end yesterday, as the live media data does (it runs to yesterday), so
 * "Today" reads nothing and the page says where the numbers stop.
 */
const BEHIND =
  typeof window === "undefined"
    ? 0
    : Math.max(
        0,
        Number(new URLSearchParams(window.location.search).get("through")) || 0,
      );

/** The Kuwait day `age` days ago (0 = the fixture's last day), as the cockpit stamps days. */
export function fixtureDay(age = 0): string {
  return new Date(Date.now() + 3 * H - (age + BEHIND) * D)
    .toISOString()
    .slice(0, 10);
}

/** How many days ago a Kuwait day was (0 = today). */
function ageOf(day: string): number {
  return Math.round((Date.parse(fixtureDay()) - Date.parse(day)) / D);
}

/** A steady 0..1 from a string, so a day's numbers never change between reads. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** A full day's numbers for a campaign, `age` days ago. */
type DayPlan = { spend: number; leads: number; bookings: number };

type Plan = {
  n: number;
  campaignName: string;
  clientName: string;
  serviceType: string;
  /** The first day it spent, in days ago. */
  launched: number;
  /** The last day it spent, in days ago (0 = still spending today). */
  stopped?: number;
  day: (age: number) => DayPlan;
  /** Snapshot fields that are not numbers worked out from the rows. */
  card: Row;
};

const PLANS: Plan[] = [
  {
    n: 1,
    campaignName: "Cedar Stone | Villa fit-out | Leads",
    clientName: "Cedar Stone Interiors",
    serviceType: "Fit out and renovation",
    launched: 90,
    day: age =>
      age <= 6
        ? { spend: 56, leads: 4, bookings: 1 }
        : { spend: 62, leads: 4, bookings: age % 4 === 0 ? 1 : 0 },
    card: {
      verdict: "scale",
      budgetDaily: 60,
      budgetLevel: "campaign",
      daysSinceTouch: 1,
    },
  },
  {
    n: 2,
    campaignName: "Cedar Stone | Kitchens | Retarget",
    clientName: "Cedar Stone Interiors",
    serviceType: "Interior design",
    launched: 120,
    day: age => ({ spend: 80, leads: 6, bookings: age % 3 === 2 ? 1 : 2 }),
    card: {
      verdict: "scale",
      budgetDaily: 80,
      budgetLevel: "campaign",
      daysSinceTouch: 5,
    },
  },
  {
    n: 3,
    campaignName: "Northwind | Design and build | Leads",
    clientName: "Northwind Builders",
    serviceType: "Design and build",
    launched: 75,
    day: age =>
      age <= 6
        ? { spend: 72, leads: 5, bookings: [0, 1, 1, 0, 1, 0, 1][age] }
        : { spend: 60, leads: 5, bookings: 2 },
    card: {
      verdict: "hold",
      budgetDaily: 72,
      budgetLevel: "adset",
      currency: "SAR",
      daysSinceTouch: 2,
      findings: [
        {
          constraint: "Booking",
          severity: "constraint",
          evidence:
            "Leads held at five a day, but this week only four of them booked.",
          fixes: [
            "Ask the call centre how fast this week's leads were called",
            "Hold the budget until the booking rate is back",
          ],
        },
      ],
    },
  },
  {
    n: 4,
    campaignName: "Marble Bay | Interior design | Leads",
    clientName: "Marble Bay Design",
    serviceType: "Interior design",
    launched: 60,
    day: age => ({
      spend: 48,
      leads: 3,
      bookings: age >= 4 && age <= 6 ? 2 : age >= 7 && age % 3 === 0 ? 1 : 0,
    }),
    card: {
      verdict: "scale",
      budgetDaily: 50,
      budgetLevel: "campaign",
      daysSinceTouch: 6,
    },
  },
  {
    n: 5,
    campaignName: "Juniper | Fit out and renovation | Leads",
    clientName: "Juniper Kitchens",
    serviceType: "Fit out and renovation",
    launched: 50,
    day: age => ({
      spend: 40,
      leads: 3,
      bookings: age >= 7 && age % 3 === 0 ? 1 : 0,
    }),
    card: {
      verdict: "hold",
      budgetDaily: 40,
      budgetLevel: "campaign",
      daysSinceTouch: 3,
      accountIssue:
        "The ad account is in its payment grace period: add a working card before Meta stops delivery.",
    },
  },
  {
    n: 6,
    campaignName: "Falcon Ridge | Construction only | DWY",
    clientName: "Falcon Ridge Contracting",
    serviceType: "Construction only",
    launched: 100,
    day: () => ({ spend: 65, leads: 6, bookings: 0 }),
    card: {
      verdict: "scale",
      serviceMode: "DWY",
      budgetDaily: 65,
      budgetLevel: "campaign",
      daysSinceTouch: 9,
    },
  },
  {
    n: 7,
    campaignName: "Opal House | Renovation | Leads",
    clientName: "Opal House Renovation",
    serviceType: "Fit out and renovation",
    launched: 45,
    day: age => ({
      spend: 46,
      leads: age <= 2 ? 0 : 2,
      bookings: age === 4 || age === 6 ? 1 : age >= 7 && age % 5 === 0 ? 1 : 0,
    }),
    card: {
      verdict: "kill",
      budgetDaily: 45,
      budgetLevel: "adset",
      daysSinceTouch: 1,
      findings: [
        {
          constraint: "Lead form",
          severity: "constraint",
          evidence:
            "It spent every day for three days and no lead came in: the form may be broken.",
          fixes: [
            "Send a test lead through the form",
            "Pause it until the form works",
          ],
        },
      ],
    },
  },
  {
    n: 8,
    campaignName: "Lantern | Architectural design | Launch",
    clientName: "Lantern Studio Architects",
    serviceType: "Architectural design",
    launched: 1,
    day: () => ({ spend: 30, leads: 0, bookings: 0 }),
    card: {
      verdict: "hold",
      budgetDaily: 30,
      budgetLevel: "campaign",
      daysSinceTouch: 0,
      findings: [
        {
          constraint: "In learning. Give the change time.",
          severity: "optimization",
          evidence: "This campaign started yesterday.",
          fixes: ["Wait three days before judging it."],
        },
      ],
    },
  },
  {
    n: 9,
    campaignName: "Driftwood | Old offer | Leads",
    clientName: "Driftwood Homes",
    serviceType: "Design and build",
    launched: 140,
    stopped: 20,
    day: age => ({ spend: 35, leads: 2, bookings: age % 6 === 0 ? 1 : 0 }),
    card: {
      verdict: "hold",
      boardAdStatus: "Paused",
      budgetDaily: 35,
      budgetLevel: "campaign",
      daysSinceTouch: 20,
    },
  },
];

const accountId = (p: Plan) => `9900000000000${String(p.n).padStart(2, "0")}`;
const campaignId = (p: Plan) => `9911000000000${String(p.n).padStart(2, "0")}`;
const ADS = [
  { key: "1", name: "Hook 1 | before and after", share: 0.6 },
  { key: "2", name: "Hook 2 | walkthrough", share: 0.4 },
];
const adId = (p: Plan, key: string) => `${campaignId(p)}0${key}`;
const AD_SET = "Broad | 28-55 | KW";

/** One day of a campaign: its two ads' rows and its bookings. */
function dayOf(p: Plan, day: string) {
  const age = ageOf(day);
  if (age < (p.stopped ?? 0) || age > p.launched) return null;
  const plan = p.day(age);
  // Today is a part day: about half the spend and leads so far.
  const spend = cents(
    plan.spend *
      (0.9 + 0.2 * hash(`${p.campaignName}|${day}`)) *
      (age === 0 ? 0.55 : 1),
  );
  const leads = age === 0 ? Math.floor(plan.leads / 2) : plan.leads;
  const firstSpend = cents(spend * ADS[0].share);
  const firstLeads = Math.ceil(leads * ADS[0].share);
  const rows = ADS.map((ad, i) => {
    const adSpend = i === 0 ? firstSpend : cents(spend - firstSpend);
    const impressions = Math.round(adSpend * 48);
    return {
      campaignName: p.campaignName,
      date: day,
      adSetName: AD_SET,
      adName: ad.name,
      metaAdId: adId(p, ad.key),
      spend: adSpend,
      leads: i === 0 ? firstLeads : leads - firstLeads,
      impressions,
      linkClicks: Math.round(impressions * 0.012),
      frequency: cents(1.2 + hash(`${day}|${ad.key}`) * 0.9),
    };
  });
  const bookings = Array.from({ length: plan.bookings }, (_, i) => ({
    campaignName: p.campaignName,
    date: day,
    status:
      hash(`${p.campaignName}|${day}|${i}`) < 0.6 ? "showed" : "confirmed",
    adId: adId(p, ADS[i % ADS.length].key),
    startTime: `${day}T${String(10 + i * 2).padStart(2, "0")}:00:00+03:00`,
    appointmentDate: day,
  }));
  return { rows, bookings };
}

/** Every day from start to end, inclusive (Kuwait days). */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`);
    t += D
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

function planOf(campaignName: unknown): Plan | undefined {
  return PLANS.find(p => p.campaignName === campaignName);
}

/** The rows and bookings of one campaign between two days. */
function readDays(p: Plan | undefined, start: string, end: string) {
  const rows: Row[] = [];
  const bookings: Row[] = [];
  if (!p) return { rows, bookings };
  for (const day of daysBetween(start, end)) {
    const one = dayOf(p, day);
    if (!one) continue;
    rows.push(...one.rows);
    // Done with you: nobody books for them.
    if (p.card.serviceMode !== "DWY") bookings.push(...one.bookings);
  }
  return { rows, bookings };
}

const sum = (rows: Row[], key: string) =>
  rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * D)
    .toISOString()
    .slice(0, 10);
}

/** cockpit_media_statistics, kind "range": the rows, 30 days before, and the bookings. */
export function adsPageRange(campaign: unknown, start: string, end: string) {
  const p = planOf(campaign);
  const { rows, bookings } = readDays(p, start, end);
  const historical = readDays(
    p,
    shiftDay(start, -30),
    shiftDay(start, -1),
  ).rows;
  return { rows, bookings, historical };
}

/** cockpit_media_statistics, kind "campaignTrend" or "portfolioTrend": one point a day. */
export function adsPageTrend(
  campaign: unknown,
  start: string,
  end: string,
): Row[] {
  const plans =
    campaign === null ? PLANS : PLANS.filter(p => p === planOf(campaign));
  return daysBetween(start, end)
    .map(date => {
      const rows = plans.flatMap(p => dayOf(p, date)?.rows ?? []);
      const spend = cents(sum(rows, "spend"));
      const leads = sum(rows, "leads");
      return {
        date,
        spend,
        leads,
        cpl: leads > 0 ? cents(spend / leads) : null,
        rows: rows.length,
      };
    })
    .filter(r => r.rows > 0)
    .map(({ rows: _rows, ...r }) => r);
}

/** cockpit_media_statistics, kind "coverage". */
export function adsPageCoverage() {
  return {
    first: fixtureDay(Math.max(...PLANS.map(p => p.launched))),
    last: fixtureDay(0),
    rows: null,
  };
}

/**
 * cockpit_media_client_range (20261022x, R8): each made-up client over the
 * range, every campaign it ran (a stopped one included), its bookings from
 * the same rows, through yesterday (the paired day). With `accounts` it answers
 * for those accounts' clients; without, for every client that spent or
 * booked in the range, so Driftwood (stopped 20 days ago) shows under the
 * board on "Last 30 days" and its page opens.
 */
export function adsPageClientRange(
  start: string,
  end: string,
  accounts: unknown,
) {
  // The paired day, as cockpit_media_week() gives it before the media sync
  // publishes its own: the media data's last day, never after yesterday.
  const last = fixtureDay(1);
  const through = end < last ? end : last;
  const wanted =
    Array.isArray(accounts) && accounts.length > 0
      ? new Set(accounts.map(String))
      : null;
  const notIn = through < start;
  const clients = [...new Set(PLANS.map(p => p.clientName))]
    .map((name, i) => {
      const plans = PLANS.filter(p => p.clientName === name);
      const dwy = plans.every(p => p.card.serviceMode === "DWY");
      const campaigns = plans.map(p => {
        const { rows, bookings } = notIn
          ? { rows: [], bookings: [] }
          : readDays(p, start, through);
        return {
          campaignName: p.campaignName,
          spend: notIn ? null : cents(sum(rows, "spend")),
          leads: notIn ? null : sum(rows, "leads"),
          bookings: notIn || dwy ? null : bookings.length,
          live: !p.stopped,
        };
      });
      const spend = notIn
        ? null
        : cents(campaigns.reduce((t, c) => t + Number(c.spend ?? 0), 0));
      const bookings =
        notIn || dwy
          ? null
          : campaigns.reduce((t, c) => t + Number(c.bookings ?? 0), 0);
      return {
        clickupId: `fx-client-${i + 1}`,
        locationId: `fx-location-${i + 1}`,
        name,
        serviceMode: dwy ? "DWY" : "DFY",
        status: "Active",
        accounts: [...new Set(plans.map(accountId))],
        spend,
        leads: notIn
          ? null
          : campaigns.reduce((t, c) => t + Number(c.leads ?? 0), 0),
        offBoardSpend: notIn ? null : 0,
        excludedSpend: notIn ? null : 0,
        campaigns: campaigns.filter(
          c => Number(c.spend ?? 0) > 0 || Number(c.bookings ?? 0) > 0,
        ),
        bookings,
        days: notIn ? 0 : daysBetween(start, through).length,
        storedDays: notIn ? 0 : daysBetween(start, through).length,
        mediaBookings: bookings,
        costPerBooking:
          spend !== null && bookings ? cents(spend / bookings) : null,
        why: notIn
          ? "Meta's numbers for these days are not in yet."
          : dwy
            ? "Done with you: the client books its own meetings."
            : null,
      };
    })
    .filter(c =>
      wanted
        ? c.accounts.some(a => wanted.has(a))
        : Number(c.spend ?? 0) > 0 || Number(c.bookings ?? 0) > 0,
    );
  return {
    from: start,
    to: end,
    through,
    throughSource: "media data",
    clients,
    unmatched: [],
  };
}

/** The 7-day numbers the snapshot carries, from the same rows. */
function sevenDays(p: Plan) {
  const { rows, bookings } = readDays(p, fixtureDay(6), fixtureDay(0));
  const spend = cents(sum(rows, "spend"));
  const leads = sum(rows, "leads");
  const dwy = p.card.serviceMode === "DWY";
  const booked = dwy ? undefined : bookings.length;
  return {
    spend7d: spend,
    leads7d: leads,
    cpl: leads > 0 ? cents(spend / leads) : undefined,
    bookings7d: booked,
    costPerBooking:
      booked !== undefined && booked > 0 && spend > 0
        ? cents(spend / booked)
        : undefined,
    bookingRate:
      booked !== undefined && leads > 0 ? (booked / leads) * 100 : undefined,
    dayRate: cents(spend / 7),
  };
}

/** The campaign as the media worker writes it into raw_data. */
function campaignOf(p: Plan, now: number): Row {
  const seven = sevenDays(p);
  const last = fixtureDay(p.stopped ?? 0);
  const lastDay = readDays(p, last, last).rows;
  const spendLast = cents(sum(lastDay, "spend"));
  const money = (n: number | undefined) =>
    n === undefined ? "n/a" : `$${n.toFixed(2)}`;
  return {
    _id: `fixture-campaign-${p.n}`,
    campaignName: p.campaignName,
    clientName: p.clientName,
    accountName: `${p.clientName} ad account`,
    clientTag: p.clientName,
    internal: false,
    onBoard: true,
    boardAdStatus: "Live",
    adStatus: p.card.boardAdStatus ?? "Live",
    taskId: `fx-task-${p.n}`,
    taskUrl: `https://app.clickup.com/t/fx-task-${p.n}`,
    metaAccountId: accountId(p),
    metaCampaignId: campaignId(p),
    currency: "USD",
    serviceType: p.serviceType,
    advertisingCities: ["KW - Hawalli", "KW - Salmiya"],
    ...seven,
    spendToday: p.stopped ? 0 : spendLast,
    dataThrough: last,
    daysLive: p.launched + 1,
    lastChangeAt: now - Number(p.card.daysSinceTouch ?? 0) * D,
    reason: `7 days: ${money(seven.spend7d)} for ${seven.leads7d} leads${
      seven.cpl === undefined ? "" : ` at ${money(seven.cpl)}`
    }${
      seven.bookings7d === undefined
        ? ""
        : `, ${seven.bookings7d} bookings${
            seven.costPerBooking === undefined
              ? ""
              : ` at ${money(seven.costPerBooking)}`
          }`
    }.`,
    findings: [],
    ...p.card,
  };
}

/** cockpit_media_live_campaigns: cockpit_campaigns rows, as the RPC returns them. */
export function adsPageCampaignRows(now = Date.now()): Row[] {
  return PLANS.map((p, i) => {
    const raw = campaignOf(p, now);
    return {
      id: 9000 + p.n,
      source_id: raw._id,
      campaign_name: p.campaignName,
      client_name: p.clientName,
      spend_7d: raw.spend7d,
      leads_7d: raw.leads7d,
      cpl: raw.cpl ?? null,
      rank: i + 1,
      meta_account_id: accountId(p),
      meta_campaign_id: campaignId(p),
      task_id: raw.taskId,
      raw_data: raw,
      source_deleted: false,
    };
  });
}

/** cockpit_ads rows: each running campaign's two ads over 7 days. */
export function adsPageAdRows(): Row[] {
  return PLANS.filter(p => !p.stopped).flatMap(p => {
    const { rows } = readDays(p, fixtureDay(6), fixtureDay(0));
    return ADS.map(ad => {
      const mine = rows.filter(r => r.metaAdId === adId(p, ad.key));
      const spend = cents(sum(mine, "spend"));
      const leads = sum(mine, "leads");
      const raw = {
        campaignName: p.campaignName,
        adName: ad.name,
        adSetName: AD_SET,
        metaAdId: adId(p, ad.key),
        spend,
        leads,
        cpl: leads > 0 ? cents(spend / leads) : undefined,
        frequency: cents(1.4 + Number(ad.key) * 0.3),
        verdict: p.card.verdict,
        status: "ACTIVE",
      };
      return {
        id: 9900 + p.n * 10 + Number(ad.key),
        source_id: `fixture-ad-${p.n}-${ad.key}`,
        campaign_name: p.campaignName,
        ad_name: ad.name,
        meta_ad_id: raw.metaAdId,
        spend,
        leads,
        frequency: raw.frequency,
        still_url: null,
        thumbnail_url: null,
        raw_data: raw,
        source_deleted: false,
      };
    });
  });
}

/** The Meta tree: an active ad set and ads for every campaign still running. */
function metaTree(): Row[] {
  return PLANS.filter(p => !p.stopped).flatMap(p => [
    {
      _id: `fixture-set-${p.n}`,
      kind: "adset",
      campaignName: p.campaignName,
      name: AD_SET,
      metaId: `${campaignId(p)}00`,
      effectiveStatus: "ACTIVE",
      dailyBudget:
        p.card.budgetLevel === "adset" ? p.card.budgetDaily : undefined,
    },
    ...ADS.map(ad => ({
      _id: `fixture-ad-${p.n}-${ad.key}`,
      kind: "ad",
      campaignName: p.campaignName,
      adsetId: `${campaignId(p)}00`,
      name: ad.name,
      metaId: adId(p, ad.key),
      effectiveStatus: "ACTIVE",
    })),
  ]);
}

/** Each client's card on the ClickUp client list; one has no offer sheet. */
function clientLinks(): Row[] {
  const clients = [...new Set(PLANS.map(p => p.clientName))];
  return clients.map((name, i) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      _id: `fixture-client-${i + 1}`,
      name,
      aliases: [name.toLowerCase(), name.split(" ")[0].toLowerCase()],
      url: `https://app.clickup.com/t/fx-client-${i + 1}`,
      driveLink: `https://drive.google.com/drive/folders/fx-${slug}`,
      brandDnaDoc: `https://docs.google.com/document/d/fx-${slug}`,
      offerCheatSheet:
        i % 3 === 2
          ? undefined
          : `https://docs.google.com/document/d/fx-${slug}-offer`,
      dosDonts:
        i % 2 === 0
          ? "Do: show finished rooms in daylight\nDon't: quote prices in the ad"
          : undefined,
    };
  });
}

/**
 * cockpit_ad_billing_panel: every client enrolled and checked five minutes
 * ago; Juniper's account is in its payment grace period, the rest healthy.
 */
export function adsPageBilling(now = Date.now()) {
  const checked = new Date(now - 5 * 60_000).toISOString();
  const live = PLANS.filter(p => !p.stopped);
  return {
    apply: true,
    finishedAt: checked,
    error: null,
    roster: [...new Set(live.map(p => p.clientName))].map((client, i) => ({
      client,
      clientTaskId: `fx-client-${i + 1}`,
      enrolled: true,
    })),
    bindings: live.map(p => {
      const grace = Boolean(p.card.accountIssue);
      return {
        id: `fixture-binding-${p.n}`,
        client: p.clientName,
        clientTaskId: `fx-task-${p.n}`,
        accountId: accountId(p),
        signal: grace ? "payment_grace" : "healthy",
        enabled: true,
        ready: true,
        checkedAt: checked,
        lastGoodAt: grace ? new Date(now - 2 * D).toISOString() : checked,
        error: null,
        deliveries: [],
        review: null,
      };
    }),
  };
}

/**
 * cockpit_media_source_read: the 17 verified source tables the snapshot
 * builder reads (mediaSourceModels.ts), with `source` saying when each was
 * imported. Only the client list, the Meta tree and the last sync have rows.
 */
export function adsPageSource(now = Date.now()) {
  const tables: Record<string, Row[]> = {
    inbox: [],
    clientLinks: clientLinks(),
    clientComments: [],
    boardCards: [],
    offBoardCampaigns: [],
    manualChanges: [],
    adChanges: [],
    metaTree: metaTree(),
    clickupMembers: [],
    clientPrefs: [],
    feedback: [],
    syncRuns: [
      {
        _id: "fixture-sync-1",
        at: now - 25 * 60_000,
        problems: [],
        health: null,
      },
    ],
    onboardings: [],
    launchWatch: [],
    trackingIssues: [],
    marketPlays: [],
    campaignChat: [],
  };
  const at = new Date(now - 25 * 60_000).toISOString();
  return {
    tables,
    source: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [
        name,
        { at, rowCount: rows.length },
      ]),
    ),
  };
}
