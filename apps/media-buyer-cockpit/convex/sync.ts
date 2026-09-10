import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { NEW_CAMPAIGN_FORM_URL } from "./constants";
import { authenticatedAction } from "./functions";
import { allAdAccounts, callTool, graph, supabaseQuery, unwrap } from "./tools";

const TRACKER = "1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro";
const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";
const ADS_LIST = "901817774521";

/**
 * The creative director's boards. Exported because the sandbox bridge reads
 * these ids out of this file — this stays the one place they are defined.
 */
export const CREATIVE_LIST = "901818016338"; // Media/Creative — his task board
export const VIDEO_LIST = "901816720767"; // Video Pipeline — editor deadlines
export const CONTENT_LIST = "901818697220"; // Content Calendar — social posts
export const CLIENTS_LIST = "901816559981"; // Clients - Mahara — the client spine
// Mahara's own lead-gen account is not a client campaign.
const INTERNAL_ACCOUNTS = ["maharamedia"];

const NADA = "113428468";
/** Boards the media buyer works out of. */
const HER_LISTS = ["901817774521", "901816723196"];
/** Marketing / ADs: everything open on it is her task list. [aziz, 2026-09-09] */
const MARKETING_LIST = "901816723196";

const CPL_GATE = 15;
const BUDGET_FLOOR = 30;
const CPB_GATE = 80;
/** Days a change needs before its numbers mean anything. */
const LEARNING_DAYS = 3;
/** Below this spend, cost per lead is noise, not a signal. */
const MIN_SPEND_FOR_COST_CALLS = 45;
/**
 * Link CTR below this reads as a hook that is not landing.
 *
 * Derived from Mahara's own 3,017-row tracker, not from a blog: across 83 ads
 * with real impressions the median link CTR is 0.77% and the 25th percentile is
 * 0.11%. A 1% "industry floor" would therefore flag over half of all ads, which
 * is noise. 0.3% flags roughly the bottom quartile. [tracker, 2026-09-06]
 */
const LINK_CTR_FLOOR = 0.3;
/** Below this many impressions, link CTR and CPM are not yet meaningful. */
const MIN_IMPRESSIONS_FOR_RATE_CALLS = 1000;

// data_fb column indexes (row 2 is the header, data starts row 3).
const C = {
  date: 0,
  account: 1,
  campaign: 2,
  cost: 4,
  leads: 5,
  impressions: 7,
  /** "Link clicks" — the only click column in the sheet. */
  linkClicks: 8,
  frequency: 10,
  adSet: 3,
  adId: 16,
  adName: 17,
  status: 18,
  currency: 24,
};

// Rates to USD. The tracker stores raw account currency in a column labelled USD.
const FX: Record<string, number> = {
  USD: 1,
  QAR: 0.2747,
  SAR: 0.2666,
  AED: 0.2723,
  KWD: 3.26,
};

function num(x: unknown): number {
  const n = Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - n * 86400000)
    .toISOString()
    .slice(0, 10);
}

function normalize(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

async function sheet(id: string, range: string): Promise<string[][]> {
  const res = unwrap(
    await callTool("pd_google_sheets_proxy_get", {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    }),
  );
  return (res?.values ?? []) as string[][];
}

/** scale / hold / kill / fatiguing, with the number that drove it. */
/**
 * Constraint diagnosis, straight out of the Media Buyer SOP: offer, creative,
 * targeting, spend, landing page or qualification questions. One constraint, one fix —
 * she should never have to stare at a row wondering what to do with it.
 */
/**
 * What actually needs a decision on this account.
 *
 * Aziz's rule (2026-09-03): if the leads are cheap and they are booking, nothing
 * needs touching — a low CTR on its own is not a problem worth acting on. Only two
 * things force a change: creative fatigue and an expensive cost per booking, plus an
 * obviously high CPL. Everything else is an optional optimization, labelled as such,
 * so she is not handed busywork on accounts that are working.
 */
type Finding = {
  constraint: string;
  evidence: string;
  fixes: string[];
  severity: "fix" | "optimization";
};

/** At or under the gate the account is winning — leave it alone. */
const GOOD_CPL = CPL_GATE;

function diagnose(c: {
  spend: number;
  leads: number;
  cpl?: number;
  linkCtr?: number;
  cpm?: number;
  optInRate?: number;
  frequency?: number;
  dayRate: number;
  daysLive?: number;
  bookings?: number;
  bookingRate?: number;
  costPerBooking?: number;
}): Finding[] {
  const money = (n: number) => `$${n.toFixed(2)}`;
  if (c.spend < 20) return [];
  // Not enough spent to judge cost yet — say so instead of inventing a verdict.
  if (c.spend < MIN_SPEND_FOR_COST_CALLS && (c.leads ?? 0) < 5) {
    return [
      {
        severity: "optimization",
        constraint: "Too early to call",
        evidence: `Only ${money(c.spend)} spent and ${c.leads} lead${c.leads === 1 ? "" : "s"} — cost per lead is noise at this volume.`,
        fixes: [
          `Let it run to $${MIN_SPEND_FOR_COST_CALLS} or 5 leads before judging it on cost.`,
          "Check delivery and the lead form work — that is all that can be judged today.",
        ],
      },
    ];
  }
  const fixes: Finding[] = [];
  const opts: Finding[] = [];
  const cplGood = (c.cpl ?? 99) <= GOOD_CPL;
  const cplBad = (c.cpl ?? 0) > CPL_GATE;
  const cpbBad = (c.costPerBooking ?? 0) > CPB_GATE;

  // 1. Fatigue — the first of the two things that always force a change.
  if ((c.frequency ?? 0) >= 2.5) {
    fixes.push({
      severity: "fix",
      constraint: "Creative fatigue",
      evidence: `Frequency ${(c.frequency ?? 0).toFixed(1)} — the same people keep seeing this ad.`,
      fixes: [
        "Queue a replacement creative now; this one is burning out.",
        "Broaden the audience or open a new interest stack to buy the winner more room.",
      ],
    });
  } else if ((c.daysLive ?? 0) >= 14) {
    (cplGood ? opts : fixes).push({
      severity: cplGood ? "optimization" : "fix",
      constraint: "Creative age",
      evidence: `Live ${c.daysLive} days${cplGood ? ` at ${money(c.cpl ?? 0)} CPL — still working` : ""}, past the 14 day refresh window.`,
      fixes: [
        "Queue a refresh so there is a replacement ready before the numbers drop.",
        "Keep the winner running while the new one is produced.",
      ],
    });
  }

  // 2. Cost per booking — the metric that matters more than CPL.
  if (cpbBad) {
    fixes.push({
      severity: "fix",
      constraint: "Cost per booking",
      evidence: `${money(c.costPerBooking ?? 0)} per booking against the $${CPB_GATE} gate${cplGood ? ` — the leads are cheap (${money(c.cpl ?? 0)}) but they are not booking` : ""}.`,
      fixes: [
        "Judge the ads on bookings, not CPL — cut the ad with the worst cost per booking, not the worst CPL.",
        "Add one qualification question rather than cutting spend.",
        "Check speed to lead with the CSM before changing anything in the account.",
      ],
    });
  }

  // Nothing is broken: cheap leads that book. Stop here — no manufactured problems.
  if (!cplBad && !cpbBad) {
    if (c.dayRate < BUDGET_FLOOR && cplGood) {
      opts.push({
        severity: "optimization",
        constraint: "Room to scale",
        evidence: `${money(c.dayRate)}/day at ${money(c.cpl ?? 0)} CPL — a working account being starved under the $${BUDGET_FLOOR} floor.`,
        fixes: [
          "Raise the budget; this is the cheapest win on the board today.",
          "Duplicate the winning ad set rather than editing the live one.",
        ],
      });
    }
    return [...fixes, ...opts];
  }

  // 3. CPL is genuinely high — now the causes are worth listing.
  if (c.leads === 0 && c.spend >= 50) {
    fixes.push({
      severity: "fix",
      constraint: "Landing page or tracking",
      evidence: `${money(c.spend)} spent and zero leads recorded.`,
      fixes: [
        "Submit a test lead yourself and confirm it lands in GHL.",
        "Check the pixel and the lead form connection — raise a tech ticket if it is broken.",
      ],
    });
  }
  if ((c.linkCtr ?? 99) < LINK_CTR_FLOOR) {
    fixes.push({
      severity: "fix",
      constraint: "Creative",
      evidence: `Link CTR ${(c.linkCtr ?? 0).toFixed(2)}% is under the ${LINK_CTR_FLOOR}% floor, and leads cost ${money(c.cpl ?? 0)} — here the weak hook is actually costing money.`,
      fixes: [
        "Queue a new hook before touching budget or targeting.",
        "Adapt the best performing ad from another account in the same service line.",
      ],
    });
  }
  if (cplBad) {
    fixes.push({
      severity: "fix",
      constraint: "Offer or qualification",
      evidence: `Leads cost ${money(c.cpl ?? 0)} against the $${CPL_GATE} gate.`,
      fixes: [
        "Cut the worst ad rather than lowering the budget on the whole campaign.",
        "Test a new offer angle — the traffic is arriving, the promise is not converting.",
        "If qualification questions are filtering too hard, loosen them.",
      ],
    });
  }
  if ((c.leads ?? 0) >= 5 && (c.bookingRate ?? 1) < 0.6) {
    fixes.push({
      severity: "fix",
      constraint: "Lead to booking",
      evidence: `Only ${Math.round((c.bookingRate ?? 0) * 100)}% of leads book — the SOP line is 60%.`,
      fixes: [
        "This is not an ads problem. Check speed to lead and the nurture sequence with the CSM.",
        "Confirm the client's calendar has real availability this week.",
      ],
    });
  }
  return [...fixes, ...opts];
}

/**
 * Bookings from the client's own GHL sub-account, last 7 days. Runs with the
 * per-client private token: the agency OAuth cannot see sub-account calendars.
 */
type BookingEvent = {
  date: string;
  appointmentDate?: string;
  status: string;
  adId?: string;
};

/**
 * Booked appointments for the last 30 days, each tied to the Meta ad that
 * bought it.
 *
 * Two calls are needed because GHL splits the truth: the calendar knows the
 * appointment, the opportunity knows the attribution (`utmAdId`, filled by
 * Meta itself rather than by UTMs — which is why this works even though almost
 * no ad carries UTM parameters). They join on contactId; measured hit rate is
 * 59 of 62 across three client accounts. [ghl, 2026-09-07]
 */
async function ghlBookingEvents(
  loc: string,
  token: string,
): Promise<BookingEvent[] | undefined> {
  const calHeaders = {
    Authorization: `Bearer ${token}`,
    Version: "2021-04-15",
    Accept: "application/json",
  };
  const oppHeaders = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
  const end = Date.now();
  const start = end - 30 * 86400000;
  try {
    const calRes = await fetch(
      `https://services.leadconnectorhq.com/calendars/?locationId=${loc}`,
      { headers: calHeaders },
    );
    if (!calRes.ok) return undefined;
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const cals: any[] = (await calRes.json())?.calendars ?? [];
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const events: any[] = [];
    for (const c of cals) {
      const evRes = await fetch(
        `https://services.leadconnectorhq.com/calendars/events?locationId=${loc}&calendarId=${c.id}&startTime=${start}&endTime=${end}`,
        { headers: calHeaders },
      );
      if (!evRes.ok) continue;
      events.push(...((await evRes.json())?.events ?? []));
    }
    if (events.length === 0) return [];

    // contactId -> ad id, from the opportunity records.
    const adByContact = new Map<string, string>();
    for (let page = 1; page <= 4; page += 1) {
      const oRes = await fetch(
        `https://services.leadconnectorhq.com/opportunities/search?location_id=${loc}&limit=100&page=${page}`,
        { headers: oppHeaders },
      );
      if (!oRes.ok) break;
      // biome-ignore lint/suspicious/noExplicitAny: GHL payload
      const ops: any[] = (await oRes.json())?.opportunities ?? [];
      for (const o of ops) {
        const attr = (o.attributions ?? []).find(
          (a: { utmAdId?: string }) => a?.utmAdId,
        );
        if (attr?.utmAdId && o.contactId) {
          if (!adByContact.has(o.contactId)) {
            adByContact.set(o.contactId, String(attr.utmAdId));
          }
        }
      }
      if (ops.length < 100) break;
    }

    const out: BookingEvent[] = [];
    for (const e of events) {
      const status = String(e.appointmentStatus ?? "").toLowerCase();
      if (status === "cancelled") continue;
      // The day the booking was MADE, not the day of the appointment. Cost per
      // booking divides spend in a window by the bookings that window bought;
      // dating by the appointment pushes next week's calls outside the window
      // and understates every recent campaign. [2026-09-07]
      const t = Date.parse(String(e.dateAdded ?? e.startTime ?? ""));
      if (!Number.isFinite(t)) continue;
      out.push({
        date: new Date(t + 3 * 3600 * 1000).toISOString().slice(0, 10),
        /** Kept so the calendar view can still be built later. */
        appointmentDate: Number.isFinite(Date.parse(String(e.startTime ?? "")))
          ? new Date(Date.parse(String(e.startTime)) + 3 * 3600 * 1000)
              .toISOString()
              .slice(0, 10)
          : undefined,
        status,
        adId: adByContact.get(e.contactId) ?? undefined,
      });
    }
    return out;
  } catch {
    return undefined;
  }
}

/** The 7-day booked / showed / no-show counts, from the same event list. */
function bookingTotals(
  events: BookingEvent[] | undefined,
  since: string,
): { booked: number; showed: number; noshow: number } | undefined {
  if (!events) return undefined;
  let booked = 0;
  let showed = 0;
  let noshow = 0;
  for (const e of events) {
    if (e.date < since) continue;
    booked += 1;
    if (e.status === "showed") showed += 1;
    if (e.status === "noshow") noshow += 1;
  }
  return { booked, showed, noshow };
}

/**
 * Why leads died, from the client's own GHL sub-account.
 *
 * Mahara does not use GHL's `status: "lost"` — the reason is encoded as the STAGE
 * NAME inside the "Lost Leads" pipeline. And the most common stage by far is
 * "Other (write why in the notes section)", so the stage alone is close to useless:
 * the real reason is in the contact's notes. We pull both, and we attach the Meta
 * ad id from the opportunity's attribution so a reason can be traced to the ad
 * that bought the lead.
 */
async function ghlLostLeads(
  loc: string,
  token: string,
): Promise<
  | {
      total: number;
      reasons: { reason: string; count: number }[];
      notes: { note: string; reason: string; adId?: string; at: string }[];
      byAd: Record<string, number>;
    }
  | undefined
> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
  try {
    const pRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${loc}`,
      { headers },
    );
    if (!pRes.ok) return undefined;
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const pipes: any[] = (await pRes.json())?.pipelines ?? [];
    // the live lost pipeline, never the archived "old" one
    const pipe = pipes.find(
      (p: { name?: string }) =>
        /lost/i.test(p.name ?? "") && !/old/i.test(p.name ?? ""),
    );
    if (!pipe) return undefined;
    const stageName = new Map<string, string>(
      (pipe.stages ?? []).map((st: { id: string; name: string }) => [
        st.id,
        st.name,
      ]),
    );

    const oRes = await fetch(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${loc}&pipeline_id=${pipe.id}&limit=100`,
      { headers },
    );
    if (!oRes.ok) return undefined;
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const ops: any[] = (await oRes.json())?.opportunities ?? [];

    const counts = new Map<string, number>();
    const byAd: Record<string, number> = {};
    for (const o of ops) {
      const reason = stageName.get(o.pipelineStageId) ?? "Unlabelled";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      const attr = (o.attributions ?? []).find(
        (a: { utmAdId?: string }) => a?.utmAdId,
      );
      if (attr?.utmAdId) byAd[attr.utmAdId] = (byAd[attr.utmAdId] ?? 0) + 1;
    }

    // Notes for the 25 most recent, which is where the real reasons live.
    const recent = [...ops]
      .sort((a, b) =>
        String(b.lastStageChangeAt ?? "").localeCompare(
          String(a.lastStageChangeAt ?? ""),
        ),
      )
      .slice(0, 25);
    const notes: {
      note: string;
      reason: string;
      adId?: string;
      at: string;
    }[] = [];
    for (let i = 0; i < recent.length; i += 8) {
      const batch = recent.slice(i, i + 8);
      const got = await Promise.all(
        batch.map(async o => {
          try {
            const r = await fetch(
              `https://services.leadconnectorhq.com/contacts/${o.contactId}/notes`,
              { headers },
            );
            if (!r.ok) return null;
            // biome-ignore lint/suspicious/noExplicitAny: GHL payload
            const ns: any[] = (await r.json())?.notes ?? [];
            const attr = (o.attributions ?? []).find(
              (a: { utmAdId?: string }) => a?.utmAdId,
            );
            for (const n of ns) {
              const text = String(n.bodyText ?? "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              // Skip everything GHL wrote for us. Two kinds, both useless here:
              // the knowledge-base / booking-calendar note, and the "📋 Form
              // Answers" dump, which is just the qualification form echoed back
              // and is already pulled in elsewhere. What is left is what a human
              // actually typed about why the lead died. [aziz, 2026-09-06]
              if (
                !text ||
                /knowledge base link|https?:\/\//i.test(text) ||
                /^\s*(📋\s*)?form answers\b/i.test(text) ||
                text.includes("📋 Form Answers")
              ) {
                continue;
              }
              return {
                note: text.slice(0, 240),
                reason: stageName.get(o.pipelineStageId) ?? "Unlabelled",
                adId: attr?.utmAdId as string | undefined,
                at: String(n.dateAdded ?? ""),
              };
            }
            return null;
          } catch {
            return null;
          }
        }),
      );
      for (const g of got) if (g) notes.push(g);
    }

    return {
      total: ops.length,
      reasons: [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      notes,
      byAd,
    };
  } catch {
    return undefined;
  }
}

function judge(
  spend: number,
  leads: number,
  cpl: number | undefined,
  linkCtr: number | undefined,
  optInRate: number | undefined,
  freq: number | undefined,
): { verdict: string; reason: string; rank: number } {
  if (spend < 1) {
    return {
      verdict: "no delivery",
      reason: "No spend in the last 7 days.",
      rank: 40,
    };
  }
  if (leads === 0) {
    return {
      verdict: "kill",
      reason: `$${spend.toFixed(0)} spent, zero leads in 7 days.`,
      rank: 5,
    };
  }
  if (cpl !== undefined && cpl > CPL_GATE * 1.5) {
    return {
      verdict: "kill",
      reason: `CPL $${cpl.toFixed(2)} is more than 50% over the $${CPL_GATE} gate.`,
      rank: 10,
    };
  }
  if (freq !== undefined && freq >= 2.5) {
    return {
      verdict: "fatiguing",
      reason: `Frequency ${freq.toFixed(2)} — the same people keep seeing it. Refresh before CPL moves.`,
      rank: 20,
    };
  }
  // Good hook, bad destination. Worth separating, because the fix is a landing
  // page fix and swapping the creative would waste a working ad.
  if (
    linkCtr !== undefined &&
    linkCtr >= LINK_CTR_FLOOR &&
    optInRate !== undefined &&
    optInRate < 2
  ) {
    return {
      verdict: "below KPI",
      reason: `People click (${linkCtr.toFixed(2)}% link CTR) but only ${optInRate.toFixed(1)}% opt in — the ad works, the landing page does not.`,
      rank: 12,
    };
  }
  if (linkCtr !== undefined && linkCtr > 0 && linkCtr < LINK_CTR_FLOOR) {
    return {
      verdict: "fatiguing",
      reason: `Link CTR ${linkCtr.toFixed(2)}% is under ${LINK_CTR_FLOOR}% — the hook has stopped working.`,
      rank: 22,
    };
  }
  if (cpl !== undefined && cpl > CPL_GATE) {
    return {
      verdict: "hold",
      reason: `CPL $${cpl.toFixed(2)} is over the $${CPL_GATE} gate but within 50%. Watch, do not scale.`,
      rank: 15,
    };
  }
  return {
    verdict: "scale",
    reason: `CPL $${(cpl ?? 0).toFixed(2)} is under the $${CPL_GATE} gate on $${spend.toFixed(0)} spend.`,
    rank: 30,
  };
}

/** Manual change-log entries from the last 14 days, for the learning-period rule. */
export const recentManualChanges = internalQuery({
  args: {},
  returns: v.array(
    v.object({ campaignName: v.string(), what: v.string(), at: v.number() }),
  ),
  handler: async ctx => {
    const since = Date.now() - 14 * 86400000;
    return (await ctx.db.query("manualChanges").collect())
      .filter(m => m.at >= since)
      .map(m => ({ campaignName: m.campaignName, what: m.what, at: m.at }));
  },
});

export const storeMembers = internalMutation({
  // biome-ignore lint/suspicious/noExplicitAny: member rows
  args: { members: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, { members }) => {
    for (const row of await ctx.db.query("clickupMembers").collect())
      await ctx.db.delete(row._id);
    for (const m of members) await ctx.db.insert("clickupMembers", m);
    return null;
  },
});

export const store = internalMutation({
  args: {
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    campaigns: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    ads: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: Meta ad set / ad rows
    metaTree: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: change-history rows
    adChanges: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: checklist rows
    checks: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: inbox rows
    inbox: v.array(v.any()),
  },
  returns: v.object({
    campaigns: v.number(),
    ads: v.number(),
    offBoard: v.number(),
  }),
  handler: async (ctx, args) => {
    // An upstream hiccup (Meta or the tracker sheet) can return zero campaigns.
    // Never wipe a good snapshot over it — keep yesterday's rather than show an
    // empty cockpit at 08:00.
    if (args.campaigns.length === 0) {
      const kept = await ctx.db.query("campaigns").collect();
      return { campaigns: kept.length, ads: 0, offBoard: -1 };
    }
    for (const row of await ctx.db.query("campaigns").collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("ads").collect())
      await ctx.db.delete(row._id);

    // Scope: only campaigns that exist on the Ads Managment board. Some clients
    // run their own campaigns and some are long gone; pulling every campaign
    // from every ad account made the roster unusable. The count of what was
    // dropped is still recorded on the sync run below, so a campaign running
    // with no task remains visible as a number without flooding the screens.
    // [aziz, 2026-09-06]
    const scoped = args.campaigns.filter(c => c.onBoard);
    const scopedNames = new Set(scoped.map(c => c.campaignName));

    for (const c of scoped) await ctx.db.insert("campaigns", c);
    for (const a of args.ads) {
      if (!scopedNames.has(a.campaignName)) continue;
      await ctx.db.insert("ads", a);
    }
    for (const row of await ctx.db.query("metaTree").collect())
      await ctx.db.delete(row._id);
    for (const m of args.metaTree) await ctx.db.insert("metaTree", m);
    for (const row of await ctx.db.query("adChanges").collect())
      await ctx.db.delete(row._id);
    for (const ch of args.adChanges) await ctx.db.insert("adChanges", ch);
    for (const row of await ctx.db.query("inbox").collect())
      await ctx.db.delete(row._id);
    for (const i of args.inbox) await ctx.db.insert("inbox", i);

    const day = kuwaitToday();
    const existing = await ctx.db
      .query("checks")
      .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
      .collect();
    const byKey = new Map(existing.map(c => [c.key, c]));
    for (const c of args.checks) {
      const prev = byKey.get(c.key);
      if (prev) {
        await ctx.db.patch(prev._id, {
          detail: c.detail,
          label: c.label,
          phase: c.phase,
          order: c.order,
          href: c.href,
        });
      } else {
        await ctx.db.insert("checks", {
          ...c,
          role: "media_buyer",
          day,
          done: false,
        });
      }
    }

    const offBoard = args.campaigns.filter(c => !c.onBoard).length;
    const storedAds = args.ads.filter(a =>
      scopedNames.has(a.campaignName),
    ).length;
    // --- Self-check ---------------------------------------------------------
    // The previews vanished for days because a dependency died quietly and
    // nothing checked. Every sync now asserts what the dashboard needs to be
    // true and records what failed; the cockpit shows it. Nobody should have to
    // notice a missing feature by eye. [aziz, 2026-09-06]
    const treeAds = (args.metaTree ?? []).filter(
      (t: { kind?: string }) => t.kind === "ad",
    );
    const treeWithPreview = treeAds.filter(
      (t: { previewSrc?: string }) => t.previewSrc,
    ).length;
    const scopedAdRows = args.ads.filter(a => scopedNames.has(a.campaignName));
    const adsWithCreative = scopedAdRows.filter(
      a => a.previewSrc || a.thumbnailUrl,
    ).length;
    const health = {
      campaigns: scoped.length,
      campaignsWithMetaId: scoped.filter(c => c.metaCampaignId).length,
      ads: scopedAdRows.length,
      adsWithCreative,
      treeAds: treeAds.length,
      treeWithPreview,
      offBoard,
    };
    const problems: string[] = [];
    if (health.campaigns === 0) {
      problems.push("No campaigns loaded at all — the board sync failed.");
    }
    if (health.campaigns > 0 && health.campaignsWithMetaId === 0) {
      problems.push(
        "No campaign could be matched to Meta, so ad sets, ads and previews are all missing.",
      );
    }
    if (health.treeAds === 0 && health.campaignsWithMetaId > 0) {
      problems.push(
        "Campaigns matched to Meta but no ads came back — the Meta pull failed.",
      );
    }
    if (health.treeAds > 0 && treeWithPreview / health.treeAds < 0.8) {
      problems.push(
        `Only ${treeWithPreview} of ${health.treeAds} ads have a creative preview.`,
      );
    }
    if (health.ads > 0 && adsWithCreative / health.ads < 0.8) {
      problems.push(
        `Only ${adsWithCreative} of ${health.ads} ad rows show their creative.`,
      );
    }
    if (problems.length) {
      console.error(`sync health: ${problems.join(" | ")}`);
    }

    await ctx.db.insert("syncRuns", {
      at: Date.now(),
      ok: problems.length === 0,
      campaigns: scoped.length,
      ads: storedAds,
      offBoard,
      health,
      problems,
    });
    return { campaigns: scoped.length, ads: storedAds, offBoard };
  },
});

type SyncResult = { campaigns: number; ads: number; offBoard: number };

export const runSync = internalAction({
  args: {},
  returns: v.object({
    campaigns: v.number(),
    ads: v.number(),
    offBoard: v.number(),
  }),
  handler: async (ctx): Promise<SyncResult> => {
    const now = Date.now();
    const since7 = daysAgo(7);
    const since30 = daysAgo(30);

    // Prefer input staged by the sandbox (see stageClear/stagePut above). Only
    // fall back to fetching in-app, which needs the tool endpoint that is
    // currently down platform-side.
    const stagedRaw: string | null = await ctx.runQuery(
      internal.sync.stagedInput,
      {},
    );
    // biome-ignore lint/suspicious/noExplicitAny: staged payload
    const staged: any = stagedRaw ? JSON.parse(stagedRaw) : null;

    const rows: string[][] =
      staged?.rows ?? (await sheet(TRACKER, "'data_fb'!A3:Y11005"));
    const clientRows: string[][] =
      staged?.clientRows ?? (await sheet(DATABASE, "'Client Data'!A1:S200"));

    // Client Data → account name to client name.
    const head = clientRows[0] ?? [];
    const col = (name: string) => head.indexOf(name);
    const clientByAccount = new Map<string, string>();
    for (const r of clientRows.slice(1)) {
      const meta = r[col("Ad Account - Meta")];
      const name = r[col("Client Name")];
      if (meta && name) clientByAccount.set(normalize(meta), name);
    }
    // Done For You vs Done With You. DWY clients are lead generation only —
    // Mahara does not book for them, there is no reporting sheet, so cost per
    // booking is not a number that exists and must never drive a verdict. The
    // sheet's "Service Mode" column is the source of truth. [aziz, 2026-09-07]
    const modeByClient = new Map<string, string>();
    for (const r of clientRows.slice(1)) {
      const name = r[col("Client Name")];
      const mode = String(r[col("Service Mode")] ?? "")
        .trim()
        .toUpperCase();
      if (name && (mode === "DWY" || mode === "DFY"))
        modeByClient.set(normalize(name), mode);
    }

    // Per-client GHL credentials, for bookings. Cost per booking matters more than CPL.
    const ghlByClient = new Map<string, { loc: string; token: string }>();
    for (const r of clientRows.slice(1)) {
      const name = r[col("Client Name")];
      const loc = r[col("GHL ID")];
      const token = r[col("GHL API")];
      if (name && loc && String(token ?? "").startsWith("pit-")) {
        ghlByClient.set(normalize(name), {
          loc: String(loc),
          token: String(token),
        });
      }
    }

    // Ads Managment board.
    const board = staged?.board
      ? staged.board
      : unwrap(
          await callTool("pd_clickup_proxy_get", {
            url: `https://api.clickup.com/api/v2/list/${ADS_LIST}/task?include_closed=true&subtasks=true`,
          }),
        );
    // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
    const tasks: any[] = board?.tasks ?? [];
    const taskByName = new Map<string, (typeof tasks)[number]>();
    for (const t of tasks) taskByName.set(normalize(t.name), t);
    // Aziz's rule: one task per CLIENT, not per campaign. Every board task carries a
    // client tag, so the tag is the real join key — when a client relaunches under a new
    // campaign name we update their existing task instead of creating a second one.
    const taskByTag = new Map<string, (typeof tasks)[number]>();
    for (const t of tasks) {
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      for (const tag of (t.tags ?? []) as any[]) {
        const key = normalize(tag.name);
        const held = taskByTag.get(key);
        // Prefer the most recently updated task for that client.
        if (
          !held ||
          Number(t.date_updated ?? 0) > Number(held.date_updated ?? 0)
        ) {
          taskByTag.set(key, t);
        }
      }
    }

    type Agg = {
      account: string;
      currency: string;
      spend: number;
      leads: number;
      impressions: number;
      linkClicks: number;
      freqNum: number;
      freqDen: number;
      first: string;
      spend30: number;
      days30: Set<string>;
      /**
       * The EOD form asks for TODAY, not the 7-day window. Rows arrive unsorted,
       * so bank per-day totals and resolve the latest day after the loop.
       */
      byDate: Map<string, { spend: number; leads: number }>;
      /** date|adSet|adName -> the raw grain, for custom date ranges. */
      daily: Map<
        string,
        {
          date: string;
          adSetName: string;
          adName: string;
          metaAdId?: string;
          spend: number;
          leads: number;
          impressions: number;
          linkClicks: number;
          frequency?: number;
        }
      >;
      ads: Map<
        string,
        {
          spend: number;
          leads: number;
          impressions: number;
          linkClicks: number;
          freq: number;
        }
      >;
    };
    const byCampaign = new Map<string, Agg>();

    for (const r of rows) {
      if (!r[C.date] || !r[C.campaign]) continue;
      const date = r[C.date];
      if (date < since30) continue;
      const key = r[C.campaign];
      let a = byCampaign.get(key);
      if (!a) {
        a = {
          account: r[C.account] ?? "",
          currency: r[C.currency] || "USD",
          spend: 0,
          leads: 0,
          impressions: 0,
          linkClicks: 0,
          freqNum: 0,
          freqDen: 0,
          first: date,
          spend30: 0,
          days30: new Set(),
          byDate: new Map(),
          daily: new Map(),
          ads: new Map(),
        };
        byCampaign.set(key, a);
      }
      const fx = FX[a.currency] ?? 1;
      const cost = num(r[C.cost]) * fx;
      if (date < a.first) a.first = date;
      a.spend30 += cost;
      a.days30.add(date);
      const day = a.byDate.get(date) ?? { spend: 0, leads: 0 };
      day.spend += cost;
      day.leads += num(r[C.leads]);
      a.byDate.set(date, day);

      // Raw grain, kept for the whole 30 days so any range can be asked for.
      {
        const adSetName = r[C.adSet] || "unnamed ad set";
        const adName = r[C.adName] || "unnamed";
        const k = `${date}|${adSetName}|${adName}`;
        const d = a.daily.get(k) ?? {
          date,
          adSetName,
          adName,
          metaAdId: r[C.adId] || undefined,
          spend: 0,
          leads: 0,
          impressions: 0,
          linkClicks: 0,
          frequency: undefined as number | undefined,
        };
        d.spend += cost;
        d.leads += num(r[C.leads]);
        d.impressions += num(r[C.impressions]);
        d.linkClicks += num(r[C.linkClicks]);
        const fr = num(r[C.frequency]);
        if (fr > 0) d.frequency = Math.max(d.frequency ?? 0, fr);
        if (!d.metaAdId && r[C.adId]) d.metaAdId = r[C.adId];
        a.daily.set(k, d);
      }

      if (date < since7) continue;

      const leads = num(r[C.leads]);
      const impressions = num(r[C.impressions]);
      a.spend += cost;
      a.leads += leads;
      a.impressions += impressions;
      a.linkClicks += num(r[C.linkClicks]);
      const f = num(r[C.frequency]);
      if (f > 0 && impressions > 0) {
        a.freqNum += f * impressions;
        a.freqDen += impressions;
      }
      const adName = r[C.adName] || "unnamed";
      const ad = a.ads.get(adName) ?? {
        spend: 0,
        leads: 0,
        impressions: 0,
        linkClicks: 0,
        freq: 0,
      };
      ad.spend += cost;
      ad.leads += leads;
      ad.impressions += impressions;
      ad.linkClicks += num(r[C.linkClicks]);
      ad.freq = Math.max(ad.freq, f);
      a.ads.set(adName, ad);
    }

    // The Creative Triage database already stores account and campaign ids for every
    // client account, so deep links no longer depend on partner sharing.
    const sbCampaign = new Map<string, { act: string; cid: string }>();
    const sbThumb = new Map<string, string>();
    try {
      for (const r of await supabaseQuery(`
        select distinct s.campaign_name, s.campaign_id, c.meta_ad_account_id
        from ads_daily_snapshots s join clients c on c.id = s.client_id
        where s.date >= current_date - 14 and c.meta_ad_account_id is not null
      `)) {
        const act = String(r.meta_ad_account_id ?? "").replace("act_", "");
        if (!act) continue;
        sbCampaign.set(normalize(String(r.campaign_name ?? "")), {
          act,
          cid: String(r.campaign_id ?? ""),
        });
      }
      for (const r of await supabaseQuery(`
        select distinct on (campaign_name, ad_name) campaign_name, ad_name, thumbnail_url
        from ads_daily_snapshots
        where date >= current_date - 14 and thumbnail_url is not null
        order by campaign_name, ad_name, date desc
      `)) {
        sbThumb.set(
          `${normalize(String(r.campaign_name ?? ""))}|${normalize(String(r.ad_name ?? ""))}`,
          String(r.thumbnail_url ?? ""),
        );
      }
    } catch {
      // Falls back to the Meta API map below.
    }

    // Meta ids, so every row can deep-link into Ads Manager on the exact campaign.
    const accountIdByName = new Map<string, string>();
    const campaignIdByName = new Map<string, string>();
    // Campaign name -> { ad account, campaign id }, straight from Meta.
    // This used to come only from Supabase, which reaches the Viktor tool
    // gateway -- and while that gateway is down every campaign lost its id, so
    // the ad tree and every creative preview silently vanished. The system
    // token needs neither. [2026-09-06]
    const campaignMetaByName = new Map<string, { act: string; cid: string }>();
    try {
      // System-user token: all 45 accounts, and it works even when the
      // Viktor tool gateway is down. See tools.ts:graph().
      for (const a of await allAdAccounts()) {
        accountIdByName.set(normalize(a.name ?? ""), a.account_id);
      }
      for (const [, id] of accountIdByName) {
        if (!id) continue;
        const cps = await graph<any>(`act_${id}/campaigns`, {
          fields: "id,name",
          limit: 100,
        });
        // biome-ignore lint/suspicious/noExplicitAny: Meta payload
        for (const c of (cps?.data ?? []) as any[]) {
          campaignIdByName.set(normalize(c.name ?? ""), String(c.id ?? ""));
          campaignMetaByName.set(normalize(c.name ?? ""), {
            act: id,
            cid: String(c.id ?? ""),
          });
        }
      }
    } catch {
      // Deep links are a convenience; never fail the sync over them.
    }

    // Launching clients: resolve their ad account NAME (which is what Client
    // Data holds) against Meta's own account list, every single sync. Before
    // this a launch stayed "no ad account" until someone typed a numeric id
    // that the sheet was never going to contain. [aziz, 2026-09-07]
    const resolvedLaunches = await ctx.runMutation(
      internal.sync.resolveOnboardingAccounts,
      {
        accounts: [...accountIdByName.entries()].map(([name, id]) => ({
          name,
          id,
        })),
      },
    );

    // The launch watch: every client the sheet calls Launching, checked against
    // ClickUp, Meta and actual spend. Runs on every sync, so a stalled launch
    // announces itself instead of waiting to be noticed. [aziz, 2026-09-07]
    {
      const statusCol = col("Status");
      const nameCol = col("Client Name");
      const metaCol = col("Ad Account - Meta");
      const spendByAccount = new Map<string, number>();
      for (const [, agg] of byCampaign) {
        const k = normalize(agg.account);
        spendByAccount.set(k, (spendByAccount.get(k) ?? 0) + agg.spend);
      }
      const watch: {
        client: string;
        sheetStatus: string;
        accountName?: string;
        accountId?: string;
        hasTask: boolean;
        taskUrl?: string;
        spend7d: number;
        issues: string[];
      }[] = [];
      const onboardingClients: { client: string; taskUrl?: string }[] =
        await ctx.runQuery(internal.sync.onboardingClients, {});

      for (const r of clientRows.slice(1)) {
        const status = String(r[statusCol] ?? "").trim();
        const client = String(r[nameCol] ?? "").trim();
        if (!client) continue;
        if (!/launching/i.test(status)) continue;
        const accountName = String(r[metaCol] ?? "").trim() || undefined;
        const key = accountName ? normalize(accountName) : "";
        const accountId = accountName
          ? accountName.match(/^\d+$/)
            ? accountName
            : (accountIdByName.get(key) ??
              [...accountIdByName.entries()].find(
                ([n]) =>
                  n.length >= 5 && (n.startsWith(key) || key.startsWith(n)),
              )?.[1])
          : undefined;
        const task = onboardingClients.find(o => {
          const a = normalize(o.client);
          const b = normalize(client);
          return (
            a === b || (a.length >= 5 && (a.startsWith(b) || b.startsWith(a)))
          );
        });
        const spend7d = key ? (spendByAccount.get(key) ?? 0) : 0;
        const issues: string[] = [];
        if (!accountName) {
          issues.push(
            "No ad account in Client Data — nothing can be built until that cell is filled.",
          );
        } else if (!accountId) {
          issues.push(
            `Client Data says the ad account is "${accountName}", but no Meta account of ours has that name. Either the name is wrong or the account has not been shared with us.`,
          );
        }
        if (!task) {
          issues.push(
            'No open "New Client Campaign Launch" task on the board, so nobody has been given the build.',
          );
        }
        if (spend7d > 0) {
          issues.push(
            `Already spending ($${spend7d.toFixed(0)} in 7 days) while the sheet still says ${status} — set them to Active.`,
          );
        }
        watch.push({
          client,
          sheetStatus: status,
          accountName,
          accountId,
          hasTask: Boolean(task),
          taskUrl: task?.taskUrl,
          spend7d,
          issues,
        });
      }
      // A client can be live in Meta while their card still says a pre-launch
      // stage and no campaign card exists on the ads board. Castello ran three
      // ads for a day before anyone noticed (2026-09-09). The fix is the
      // new-campaign form, which creates the board card; the CSM then marks
      // the client Active.
      const preLaunch: { name: string; stage: string }[] = await ctx.runQuery(
        internal.sync.preLaunchClients,
        {},
      );
      for (const c of preLaunch) {
        const nk = normalize(c.name);
        const first = normalize(c.name.split(/[\s\-_/]+/)[0] ?? "");
        const matches = (x: string) =>
          x.length >= 5 &&
          (x.startsWith(nk) ||
            nk.startsWith(x) ||
            (first.length >= 5 && x.startsWith(first)));
        if (watch.some(w => matches(normalize(w.client)))) continue;
        let spend = 0;
        let accountName: string | undefined;
        const campaignNames = new Set<string>();
        for (const [campaignKey, agg] of byCampaign) {
          const acct = normalize(agg.account);
          const camp = normalize(String(campaignKey));
          if (matches(acct) || matches(camp)) {
            spend += agg.spend;
            accountName = accountName ?? agg.account;
            campaignNames.add(camp);
          }
        }
        if (spend <= 0) continue;
        const n = campaignNames.size;
        watch.push({
          client: c.name,
          sheetStatus: `card says ${c.stage}`,
          accountName,
          accountId: accountName
            ? accountIdByName.get(normalize(accountName))
            : undefined,
          hasTask: false,
          spend7d: spend,
          issues: [
            `Live in Meta ($${spend.toFixed(0)} in the last 7 days, ${n} campaign${n === 1 ? "" : "s"}) while the client card still says "${c.stage}" and there is no card on the ads board. Fill the new-campaign form so the card exists: ${NEW_CAMPAIGN_FORM_URL} — then the CSM marks them Active.`,
          ],
        });
      }
      await ctx.runMutation(internal.sync.storeLaunchWatch, { rows: watch });
      console.log(
        `launches: ${watch.length} launching clients · ${watch.filter(w => w.issues.length).length} with something blocking · onboarding ids resolved ${resolvedLaunches.resolved}, still missing ${resolvedLaunches.stillMissing}`,
      );
    }

    // One GHL call per client, not per campaign.
    const eventsByClient = new Map<string, BookingEvent[] | undefined>();
    // Why leads died, per client. Same one-call-per-client rule.
    const lostByClient = new Map<
      string,
      Awaited<ReturnType<typeof ghlLostLeads>>
    >();

    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    const campaigns: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    const ads: any[] = [];
    // The raw grain: one row per date x ad, 30 days.
    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    const daily: any[] = [];
    // One row per booked appointment, tied to its ad.
    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    const bookingRows: any[] = [];
    const unattributedTaken = new Set<string>();

    for (const [name, a] of byCampaign) {
      if (a.spend < 0.5) continue;
      // Mahara's own lead-gen account is Aziz's, not a client — never show it here.
      if (INTERNAL_ACCOUNTS.includes(normalize(a.account))) continue;
      const client = clientByAccount.get(normalize(a.account));
      const byName = taskByName.get(normalize(name));
      const byTag = client ? taskByTag.get(normalize(client)) : undefined;
      const task = byName ?? byTag;
      // Matched on the client tag but the task still names an older campaign.
      const staleTaskName = !byName && byTag ? byTag.name : undefined;
      const cpl = a.leads > 0 ? a.spend / a.leads : undefined;
      // Link CTR, CPM and opt-in rate. Aziz asked for link CTR specifically —
      // the sheet's "CTR (all)" column counts every click including reactions
      // and profile taps, so it flatters a bad hook. It is deliberately unused.
      const rateable = a.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS;
      const linkCtr = rateable
        ? (a.linkClicks / a.impressions) * 100
        : undefined;
      const cpm = rateable ? (a.spend / a.impressions) * 1000 : undefined;
      // Of the people who clicked through, how many actually left details.
      // Only meaningful with enough clicks to divide by.
      const optInRate =
        a.linkClicks >= 50 ? (a.leads / a.linkClicks) * 100 : undefined;
      const frequency = a.freqDen > 0 ? a.freqNum / a.freqDen : undefined;
      const isInternal = INTERNAL_ACCOUNTS.includes(normalize(a.account));
      // Done With You: leads only. No bookings are made for them, so cost per
      // booking would be a division by a number that does not exist.
      const serviceMode = client
        ? (modeByClient.get(normalize(client)) ?? "DFY")
        : undefined;
      const isDwy = serviceMode === "DWY";
      // Bookings, from the client's own GHL. Cost per booking is the number that matters.
      let bookings:
        | { booked: number; showed: number; noshow: number }
        | undefined;
      let clientEvents: BookingEvent[] | undefined;
      if (client) {
        const key = normalize(client);
        // Bookings only exist for Done For You clients.
        if (!isDwy) {
          if (!eventsByClient.has(key)) {
            const cred = ghlByClient.get(key);
            eventsByClient.set(
              key,
              cred ? await ghlBookingEvents(cred.loc, cred.token) : undefined,
            );
          }
          clientEvents = eventsByClient.get(key);
          bookings = bookingTotals(clientEvents, since7);
        }
        // Why the leads died still matters on DWY — that is lead quality, not booking.
        if (!lostByClient.has(key)) {
          const cred = ghlByClient.get(key);
          lostByClient.set(
            key,
            cred ? await ghlLostLeads(cred.loc, cred.token) : undefined,
          );
        }
      }
      const costPerBooking =
        bookings && bookings.booked > 0 ? a.spend / bookings.booked : undefined;
      const bookingRate =
        bookings && a.leads > 0 ? (bookings.booked / a.leads) * 100 : undefined;
      const showRate =
        bookings && bookings.booked > 0
          ? (bookings.showed / bookings.booked) * 100
          : undefined;

      const cpbJudged =
        costPerBooking !== undefined && costPerBooking > CPB_GATE
          ? {
              verdict: "hold",
              reason: `Cost per booking is $${costPerBooking.toFixed(0)} against an ${CPB_GATE} KPI — ${bookings?.booked ?? 0} bookings off ${a.leads} leads. The leads are not converting to calls.`,
              rank: 2,
            }
          : undefined;
      const { verdict, reason, rank } = judge(
        a.spend,
        a.leads,
        cpl,
        linkCtr,
        optInRate,
        frequency,
      );
      // Latest day this campaign actually reported, and that day's numbers.
      const lastDay = [...a.byDate.keys()].sort().pop() ?? "";
      const today = lastDay ? a.byDate.get(lastDay) : undefined;
      const dayRate = a.spend / 7;
      const medianDayRate =
        a.days30.size > 0 ? a.spend30 / a.days30.size : undefined;
      const daysLive = Math.floor(
        (Date.parse(kuwaitToday()) - Date.parse(a.first)) / 86400000,
      );
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      const field = (n: string): any =>
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        (task?.custom_fields ?? []).find((c: any) => c.name === n)?.value;
      // Dropdown values come back as an option index or id — resolve to the label.
      const dropdown = (n: string): string | undefined => {
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        const f = (task?.custom_fields ?? []).find((c: any) => c.name === n);
        if (!f || f.value === undefined || f.value === null) return undefined;
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        const opts: any[] = f.type_config?.options ?? [];
        const hit =
          opts.find(o => o.id === f.value) ??
          opts[typeof f.value === "number" ? f.value : -1];
        return hit?.name ?? hit?.label ?? undefined;
      };

      campaigns.push({
        campaignName: name,

        accountName: a.account,
        clientName: client,
        staleTaskName,
        clientTag: client ? normalize(client) : undefined,
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        tags: ((task?.tags ?? []) as any[]).map(t => normalize(t.name)),
        taskId: task?.id,
        taskUrl: task?.url,
        adStatus: task?.status?.status,
        onBoard: Boolean(task),
        currency: a.currency,
        spend7d: a.spend,
        leads7d: a.leads,
        spendToday: today?.spend ?? 0,
        leadsToday: today?.leads ?? 0,
        dataThrough: lastDay,
        cpl,
        impressions7d: a.impressions,
        linkClicks7d: a.linkClicks,
        linkCtr,
        cpm,
        optInRate,
        frequency,
        dayRate,
        medianDayRate,
        contractedBudget: field("Daily Ad Spend")
          ? Number(field("Daily Ad Spend"))
          : undefined,
        serviceType: dropdown("Service Type"),
        serviceMode,
        priority: dropdown("Priority"),
        boardAdStatus: dropdown("Ad Status"),
        cplStatus: dropdown("Cost Per Lead"),
        cpbStatus: dropdown("Cost Per Booking"),
        bookings7d: bookings?.booked,
        showed7d: bookings?.showed,
        costPerBooking,
        bookingRate,
        showRate,
        hasGhl: client ? ghlByClient.has(normalize(client)) : false,
        lost: client ? lostByClient.get(normalize(client)) : undefined,
        // The board's own "Meta Ad Account" link is the most reliable source of the
        // account id; the API map only covers accounts shared with our partner id.
        metaCampaignId:
          campaignMetaByName.get(normalize(name))?.cid ??
          sbCampaign.get(normalize(name))?.cid,
        metaAccountId:
          campaignMetaByName.get(normalize(name))?.act ??
          sbCampaign.get(normalize(name))?.act ??
          (typeof field("Meta Ad Account") === "string"
            ? /act=(\d+)/.exec(field("Meta Ad Account") as string)?.[1]
            : undefined) ??
          accountIdByName.get(normalize(a.account)),
        firstSpend: a.first,
        daysLive,
        internal: isInternal,
        findings: diagnose({
          spend: a.spend,
          leads: a.leads,
          cpl,
          linkCtr,
          cpm,
          optInRate,
          frequency,
          dayRate,
          daysLive,
          bookings: bookings?.booked,
          bookingRate,
          costPerBooking,
        }),
        daysSinceTouch:
          task?.date_updated !== undefined
            ? Math.floor((Date.now() - Number(task.date_updated)) / 86400000)
            : undefined,
        verdict:
          task || isInternal ? (cpbJudged?.verdict ?? verdict) : "off board",
        reason:
          task || isInternal
            ? (cpbJudged?.reason ?? reason)
            : `Spending $${a.spend.toFixed(0)} in 7 days with no task on the Ads Managment board.`,
        rank: isInternal
          ? 60
          : task
            ? Math.min(cpbJudged?.rank ?? 99, rank)
            : 1,
        syncedAt: now,
      });

      // Raw daily grain for this campaign, and its bookings tied to ads.
      const adIdsHere = new Set<string>();
      for (const d of a.daily.values()) {
        if (d.metaAdId) adIdsHere.add(d.metaAdId);
        daily.push({ campaignName: name, ...d });
      }
      if (clientEvents) {
        // Unattributed bookings land on the first campaign we see for the
        // client, once only — never spread across their campaigns twice.
        for (const e of clientEvents) {
          // An event belongs to this campaign if the ad that bought it ran
          // here. Unattributed bookings (about 5%) are attached to the
          // client's campaign so the campaign total stays right, but they
          // carry no adId and therefore never distort an ad-level number.
          const mine = e.adId
            ? adIdsHere.has(e.adId)
            : Boolean(client) &&
              !unattributedTaken.has(normalize(client ?? ""));
          if (!mine) continue;
          bookingRows.push({
            campaignName: name,
            client,
            date: e.date,
            appointmentDate: e.appointmentDate,
            status: e.status,
            adId: e.adId,
            syncedAt: now,
          });
        }
      }

      if (client && clientEvents) unattributedTaken.add(normalize(client));

      for (const [adName, ad] of a.ads) {
        const adCpl = ad.leads > 0 ? ad.spend / ad.leads : undefined;
        const j = judge(
          ad.spend,
          ad.leads,
          adCpl,
          ad.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS
            ? (ad.linkClicks / ad.impressions) * 100
            : undefined,
          ad.linkClicks >= 50 ? (ad.leads / ad.linkClicks) * 100 : undefined,
          ad.freq || undefined,
        );
        ads.push({
          campaignName: name,
          adName,
          spend: ad.spend,
          leads: ad.leads,
          cpl: adCpl,
          linkCtr:
            ad.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS
              ? (ad.linkClicks / ad.impressions) * 100
              : undefined,
          cpm:
            ad.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS
              ? (ad.spend / ad.impressions) * 1000
              : undefined,
          optInRate:
            ad.linkClicks >= 50 ? (ad.leads / ad.linkClicks) * 100 : undefined,
          frequency: ad.freq || undefined,
          thumbnailUrl: sbThumb.get(`${normalize(name)}|${normalize(adName)}`),
          verdict: j.verdict,
          reason: j.reason,
          syncedAt: now,
        });
      }
    }

    campaigns.sort((x, y) => x.rank - y.rank || y.spend7d - x.spend7d);

    // Her own ClickUp work: tasks assigned to her, and comments that tag her.
    // Both are things the SOP tells her to clear every morning, so they belong on
    // the same screen as the campaigns instead of in another tab.
    // biome-ignore lint/suspicious/noExplicitAny: inbox rows
    const inbox: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: ClickUp launch tasks
    const launchTasks: any[] = [];
    for (const list of HER_LISTS) {
      // Nothing on these boards is assigned to anyone, so "her tasks" means: assigned
      // to her when that ever happens, plus the launch work that is hers by role.
      const mine = staged?.herLists?.[String(list)]
        ? staged.herLists[String(list)]
        : unwrap(
            await callTool("pd_clickup_proxy_get", {
              url: `https://api.clickup.com/api/v2/list/${list}/task?include_closed=false&subtasks=false`,
            }),
          );
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      for (const t of (mine?.tasks ?? []) as any[]) {
        const st = String(t.status?.status ?? "").toLowerCase();
        if (st === "complete" || st === "closed" || st === "done") continue;
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        const hers = ((t.assignees ?? []) as any[]).some(
          a => String(a.id) === NADA,
        );
        const launch = /Campaign Launch|New Client/i.test(String(t.name ?? ""));
        if (/new client campaign launch/i.test(String(t.name ?? "")))
          launchTasks.push(t);
        const onHerBoard = String(list) === MARKETING_LIST;
        if (!hers && !launch && !onHerBoard) continue;
        inbox.push({
          reason: hers
            ? "assigned to you"
            : launch
              ? "campaign launch — yours by role"
              : "open on the Marketing / ADs board",
          kind: "task",
          taskId: t.id,
          title: t.name,
          url: t.url,
          status: t.status?.status,
          listName: t.list?.name,
          dueDate: t.due_date ? Number(t.due_date) : undefined,
          overdue: t.due_date ? Number(t.due_date) < Date.now() : false,
          at: Number(t.date_updated ?? Date.now()),
        });
      }
    }

    // Comments that @mention her, on tasks touched in the last 14 days only —
    // enough to catch everything live without turning the sync into a crawl.
    const recent = tasks.filter(
      t => Number(t.date_updated ?? 0) > Date.now() - 14 * 86400000,
    );
    for (const t of recent.slice(0, 40)) {
      const cs = staged?.comments?.[String(t.id)]
        ? staged.comments[String(t.id)]
        : staged
          ? { comments: [] }
          : unwrap(
              await callTool("pd_clickup_proxy_get", {
                url: `https://api.clickup.com/api/v2/task/${t.id}/comment`,
              }),
            );
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      for (const c of (cs?.comments ?? []) as any[]) {
        const text: string = c.comment_text ?? "";
        // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
        const tagged =
          (c.assignee?.id ?? "") === Number(NADA) ||
          (c.comment ?? []).some(
            (part: any) => String(part?.user?.id ?? "") === NADA,
          );
        if (!tagged || c.resolved) continue;
        if (String(c.user?.id ?? "") === NADA) continue;
        inbox.push({
          kind: "mention",
          taskId: t.id,
          title: t.name,
          url: t.url,
          body: text.slice(0, 300),
          author: c.user?.username,
          at: Number(c.date ?? Date.now()),
        });
      }
    }

    // New-client launches. The checklist is NOT on the launch task: it lives on
    // four subtasks (Setup, Buildout, Tracking, QA), each with its own items.
    // This used to be staged by the sandbox bridge; now the sync reads it.
    {
      const acctByClient = new Map<string, string>();
      const acctNameByClient = new Map<string, string>();
      for (const r of clientRows.slice(1)) {
        const nm = String(r[col("Client Name")] ?? "").trim();
        const acct = String(r[col("Ad Account - Meta")] ?? "").trim();
        if (!nm || !acct) continue;
        // The column normally holds the account NAME, not an id. Keep both so
        // the name can be resolved against Meta's own account list. [aziz, 2026-09-07]
        if (/^\d+$/.test(acct)) acctByClient.set(normalize(nm), acct);
        else acctNameByClient.set(normalize(nm), acct);
      }
      // Client names differ between ClickUp and the sheet ("City Wood" vs
      // "city wood industry co."): match on either being a prefix of the other.
      const match = (name: string, table: Map<string, string>) => {
        const key = normalize(name);
        if (table.has(key)) return table.get(key);
        for (const [k, v] of table) {
          if (k.length >= 5 && (key.startsWith(k) || k.startsWith(key)))
            return v;
        }
        return undefined;
      };
      const clickupGet = async (path: string) =>
        unwrap(
          await callTool("pd_clickup_proxy_get", {
            url: `https://api.clickup.com/api/v2/${path}`,
          }),
        );
      // biome-ignore lint/suspicious/noExplicitAny: onboarding rows
      const onboardingRows: any[] = [];
      for (const t of launchTasks) {
        const clientName = String(t.name ?? "")
          .split(" - New Client")[0]
          .trim();
        const groups: {
          name: string;
          items: { name: string; done: boolean }[];
        }[] = [];
        try {
          const detail = await clickupGet(`task/${t.id}?include_subtasks=true`);
          // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
          for (const sub of (detail?.subtasks ?? []) as any[]) {
            const sd = await clickupGet(`task/${sub.id}`);
            // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
            const items = ((sd?.checklists ?? []) as any[]).flatMap(cl =>
              // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
              ((cl.items ?? []) as any[]).map(i => ({
                name: String(i.name ?? ""),
                done: Boolean(i.resolved),
              })),
            );
            if (items.length > 0)
              groups.push({ name: String(sub.name ?? ""), items });
          }
        } catch (e) {
          console.warn(
            `onboarding checklist for ${clientName}: ${String(e).slice(0, 120)}`,
          );
        }
        onboardingRows.push({
          taskId: t.id,
          taskUrl: t.url,
          client: clientName,
          status: String(t.status?.status ?? ""),
          accountId: match(clientName, acctByClient),
          accountName: match(clientName, acctNameByClient),
          groups,
        });
      }
      await ctx.runMutation(internal.sync.storeOnboardings, {
        rows: onboardingRows,
      });
      console.log(`open launches: ${onboardingRows.length}`);
    }

    const client = campaigns.filter(c => !c.internal);
    const overGate = client.filter(
      c => c.cpl !== undefined && c.cpl > CPL_GATE,
    ).length;
    const underFloor = client.filter(
      c => c.dayRate < BUDGET_FLOOR && c.spend7d > 0,
    ).length;
    const offBoard = client.filter(c => !c.onBoard).length;
    // Every spending campaign with no card on the ads management board is a
    // job with a form, not a number on a checklist. The card is what the media
    // buyer fills in and what the other cockpits read. [Aziz, 2026-09-10]
    const offBoardRows = client
      .filter(c => !c.onBoard && c.spend7d > 0)
      .map(c => ({
        client: String(c.clientName || c.campaignName || c.accountName),
        sheetStatus: "no card on the ads board",
        accountName: c.accountName,
        accountId: c.accountId,
        hasTask: false,
        spend7d: c.spend7d,
        issues: [
          `"${c.campaignName}" on ${c.accountName} is spending ($${c.spend7d.toFixed(0)} in the last 7 days) with no card on the ads management board. Fill the new-campaign form so the card exists: ${NEW_CAMPAIGN_FORM_URL}`,
        ],
      }));
    console.log(
      `board: ${offBoardRows.length} spending campaign(s) with no card on the ads board`,
    );
    await ctx.runMutation(internal.sync.appendLaunchWatch, {
      rows: offBoardRows,
    });
    const stale = client.filter(c => (c.daysLive ?? 0) >= 14).length;
    const noLeads = client.filter(c => c.leads7d === 0 && c.spend7d > 0).length;

    const launchWatch = client.filter(c => (c.daysLive ?? 99) <= 3).length;
    const onboarding = inbox.filter(i =>
      /new client campaign launch/i.test(i.title),
    ).length;
    const overdue = inbox.filter(i => i.overdue).length;

    // Her morning is a communication sprint, not account work. Clear the decks
    // in this order, then the middle of the day is spent inside the accounts.
    const checks = [
      {
        key: "clickup_mentions",
        phase: "sod",
        order: 1,
        label: "ClickUp comments — reply to everyone who tagged you",
        detail: `${inbox.filter(i => i.kind === "mention").length} waiting`,
        href: "/tasks",
      },
      {
        key: "whatsapp_am",
        phase: "sod",
        order: 2,
        label: "WhatsApp sprint — client groups",
        detail: "Anything a client asked for overnight, answered or handed on",
      },
      {
        key: "slack_am",
        phase: "sod",
        order: 3,
        label: "Slack sprint — mentions and DMs",
        detail: "Clear them, then post your start-of-day check-in",
      },
      {
        key: "tasks_onboarding",
        phase: "sod",
        order: 4,
        label: "Tasks and onboardings — new accounts to set up",
        detail: `${onboarding} launch task${onboarding === 1 ? "" : "s"}${overdue ? ` · ${overdue} overdue` : ""}`,
        href: "/tasks",
      },
      {
        key: "launch_watch",
        phase: "mid",
        order: 5,
        label: "New campaigns in their first 72 hours",
        detail: `${launchWatch} to watch closely`,
      },
      {
        key: "gates",
        phase: "mid",
        order: 6,
        label: "Spend, leads and CPL reviewed against the gates",
        detail: `${client.length} client campaigns with delivery`,
      },
      {
        key: "gate",
        phase: "mid",
        order: 7,
        label: `Campaigns over the ${"$"}${CPL_GATE} CPL gate`,
        detail: `${overGate} found`,
      },
      {
        key: "noleads",
        phase: "mid",
        order: 8,
        label: "Campaigns spending with zero leads",
        detail: `${noLeads} found`,
      },
      {
        key: "floor",
        phase: "mid",
        order: 9,
        label: "Campaigns under the $30/day floor",
        detail: `${underFloor} found`,
      },
      {
        key: "refresh",
        phase: "mid",
        order: 10,
        label: "Creative past the 14 day refresh window",
        detail: `${stale} campaigns`,
      },
      {
        key: "offboard",
        phase: "mid",
        order: 11,
        label: "Campaigns running with no task on the board",
        detail: `${offBoard} found`,
      },
    ];

    // Pull the live structure under every campaign we can actually see in the API,
    // so she can read ad sets and ads — and Meta's own creative preview — in place.
    // biome-ignore lint/suspicious/noExplicitAny: Meta rows
    const metaTree: any[] = [];
    let previewOk = 0;
    let previewMissing = 0;
    // A preview iframe URL is stable for the life of the ad, and one request
    // per ad is what made this the expensive part of the sync. Reuse what the
    // last run stored and only ask Meta for ads we have never seen.
    const cachedPreview = new Map<string, string>(
      (await ctx.runQuery(internal.sync.previewCache, {})).map(
        ([id, src]) => [id, src] as [string, string],
      ),
    );
    for (const c of campaigns) {
      if (!c.metaAccountId || !c.metaCampaignId) continue;
      try {
        // Graph direct, not the tool gateway: previews were silently failing
        // whenever the gateway 500'd, and a missing preview is the one thing
        // Nada actually looks at. See tools.ts:graph().
        const sets = await graph<any>(`${c.metaCampaignId}/adsets`, {
          fields: "id,name,status,effective_status,daily_budget",
          limit: 200,
        });
        // biome-ignore lint/suspicious/noExplicitAny: Meta payload
        for (const s of (sets?.data ?? []) as any[]) {
          metaTree.push({
            campaignName: c.campaignName,
            kind: "adset",
            metaId: String(s.id),
            name: String(s.name ?? ""),
            status: String(s.status ?? ""),
            effectiveStatus: s.effective_status,
            dailyBudget: s.daily_budget
              ? Number(s.daily_budget) / 100
              : undefined,
            syncedAt: now,
          });
        }

        // Every ad, not the first ten. `creative{...}` gives us a still image to
        // fall back on when the preview iframe is unavailable.
        const adsRes = await graph<any>(`${c.metaCampaignId}/ads`, {
          fields:
            "id,name,status,effective_status,adset_id," +
            "creative{id,thumbnail_url,image_url,object_story_spec}",
          limit: 200,
        });
        const ads = (adsRes?.data ?? []) as any[];

        // Previews are one request per ad; run them in small parallel batches so
        // a 60-ad account doesn't serialise into a timeout.
        const previews = new Map<string, string>();
        for (const ad of ads) {
          const hit = cachedPreview.get(String(ad.id));
          if (hit) previews.set(String(ad.id), hit);
        }
        const toFetch = ads.filter(ad => !previews.has(String(ad.id)));
        const BATCH = 8;
        for (let i = 0; i < toFetch.length; i += BATCH) {
          const slice = toFetch.slice(i, i + BATCH);
          await Promise.all(
            slice.map(async ad => {
              try {
                const prev = await graph<any>(`${ad.id}/previews`, {
                  ad_format: "MOBILE_FEED_STANDARD",
                });
                const body = String(prev?.data?.[0]?.body ?? "");
                const src = /src="([^"]+)"/
                  .exec(body)?.[1]
                  ?.replace(/&amp;/g, "&");
                if (src) previews.set(String(ad.id), src);
              } catch {
                // Fall through to the creative thumbnail below.
              }
            }),
          );
        }

        for (const ad of ads) {
          const previewSrc = previews.get(String(ad.id));
          const cr = ad.creative ?? {};
          const thumbUrl: string | undefined =
            cr.image_url ??
            cr.thumbnail_url ??
            cr.object_story_spec?.video_data?.image_url ??
            cr.object_story_spec?.link_data?.picture ??
            undefined;
          if (previewSrc || thumbUrl) previewOk++;
          else previewMissing++;
          metaTree.push({
            campaignName: c.campaignName,
            kind: "ad",
            metaId: String(ad.id),
            name: String(ad.name ?? ""),
            status: String(ad.status ?? ""),
            effectiveStatus: ad.effective_status,
            adsetId: ad.adset_id ? String(ad.adset_id) : undefined,
            previewSrc,
            thumbUrl,
            syncedAt: now,
          });
        }
      } catch {
        // Account genuinely unreachable — the row still deep-links out to Meta.
      }
    }
    console.log(
      `metaTree: ${metaTree.filter(r => r.kind === "ad").length} ads, ` +
        `${previewOk} with a preview or thumbnail, ${previewMissing} without`,
    );

    // Give every performance row the creative that produced it. The spend rows
    // and the Meta tree are two different sources keyed by the same ad name, so
    // join them here rather than making the UI guess. Meta's own thumbnail wins
    // over the Supabase one, which is often stale or missing entirely.
    const previewByAd = new Map<
      string,
      { previewSrc?: string; thumbUrl?: string; metaId: string }
    >();
    for (const r of metaTree) {
      if (r.kind !== "ad") continue;
      previewByAd.set(`${normalize(r.campaignName)}|${normalize(r.name)}`, {
        previewSrc: r.previewSrc,
        thumbUrl: r.thumbUrl,
        metaId: r.metaId,
      });
    }
    let adsWithCreative = 0;
    for (const a of ads) {
      const hit = previewByAd.get(
        `${normalize(a.campaignName)}|${normalize(a.adName)}`,
      );
      if (!hit) continue;
      a.metaAdId = hit.metaId;
      a.previewSrc = hit.previewSrc;
      if (hit.thumbUrl) a.thumbnailUrl = hit.thumbUrl;
      if (a.previewSrc || a.thumbnailUrl) adsWithCreative++;
    }
    console.log(
      `ad performance rows: ${ads.length}, ${adsWithCreative} with a creative`,
    );

    // Who changed what in each account over the last 7 days.
    // biome-ignore lint/suspicious/noExplicitAny: change rows
    const adChanges: any[] = [];
    try {
      const byAct = new Map<string, string[]>();
      for (const c of campaigns) {
        if (!c.metaAccountId) continue;
        const list = byAct.get(c.metaAccountId) ?? [];
        list.push(c.campaignName);
        byAct.set(c.metaAccountId, list);
      }
      for (const r of await supabaseQuery(`
        select meta_ad_account_id, event_time, actor_name, event_type,
               translated_event_type, object_name, object_type
        from ad_account_activities
        where event_time >= now() - interval '7 days'
        order by event_time desc limit 400
      `)) {
        const act = String(r.meta_ad_account_id ?? "").replace("act_", "");
        for (const cn of byAct.get(act) ?? []) {
          adChanges.push({
            campaignName: cn,
            at: Date.parse(String(r.event_time)),
            actor: r.actor_name ? String(r.actor_name) : undefined,
            eventType: String(r.translated_event_type ?? r.event_type ?? ""),
            objectName: r.object_name ? String(r.object_name) : undefined,
            objectType: r.object_type ? String(r.object_type) : undefined,
          });
        }
      }
    } catch {
      // The change feed is a bonus; never fail the sync over it.
    }

    // Media buying needs time to breathe: after a real change, three days of data
    // before anything else is touched. Anything else is just churn.
    const manual = (await ctx.runQuery(
      internal.sync.recentManualChanges,
      {},
    )) as {
      campaignName: string;
      what: string;
      at: number;
    }[];
    // Only real media-buying changes reset the clock. Meta's own housekeeping
    // (billing, delivery, post-review status flips) is not a change she made.
    // Event names verified against ad_account_activities on 2026-09-03.
    const MEANINGFUL =
      /budget|targeting|bid strategy|optimisation goal|optimization goal|created|ad updated|campaign status updated|ad set status updated/i;
    const NOT_A_CHANGE =
      /name updated|finishes ad review|billed|delivered|balance/i;
    for (const c of campaigns) {
      const times = [
        ...adChanges
          .filter(
            ch =>
              ch.campaignName === c.campaignName &&
              ch.actor &&
              ch.actor !== "Meta" &&
              MEANINGFUL.test(ch.eventType) &&
              !NOT_A_CHANGE.test(ch.eventType),
          )
          .map(ch => ch.at as number),
        ...manual.filter(m => m.campaignName === c.campaignName).map(m => m.at),
      ].filter(t => Number.isFinite(t));
      if (!times.length) continue;
      const last = Math.max(...times);
      const days = (Date.now() - last) / 86400000;
      c.lastChangeAt = last;
      if (days >= LEARNING_DAYS) continue;
      const readyOn = new Date(last + LEARNING_DAYS * 86400000);
      const note = {
        severity: "optimization" as const,
        constraint: "In learning — leave it alone",
        evidence: `Changed ${days < 1 ? "today" : `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`}. A change needs ${LEARNING_DAYS} days of data before the numbers mean anything.`,
        fixes: [
          `Do not touch this until ${readyOn.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — judging it today is judging noise.`,
        ],
      };
      // Bleeding badly enough that waiting costs more than acting: keep the findings.
      const bleeding =
        (c.cpl ?? 0) > CPL_GATE * 2 || (c.costPerBooking ?? 0) > CPB_GATE * 1.5;
      c.findings = bleeding
        ? [
            {
              ...note,
              fixes: [
                `Changed ${Math.floor(days)} day(s) ago, so give it until ${readyOn.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — unless the bleeding below is bad enough to stop outright.`,
              ],
            },
            ...(c.findings ?? []),
          ]
        : [note];
    }

    const result = (await ctx.runMutation(internal.sync.store, {
      campaigns,
      ads,
      metaTree,
      adChanges,
      checks,
      inbox,
    })) as SyncResult;

    // The raw grain goes in its own chunked pass: thousands of rows will not
    // fit in one mutation, and it must never be able to fail the main store.
    const onBoardNames = new Set(
      campaigns.filter(c => c.onBoard).map(c => c.campaignName),
    );
    const dailyScoped = daily.filter(d => onBoardNames.has(d.campaignName));
    const bookingScoped = bookingRows.filter(b =>
      onBoardNames.has(b.campaignName),
    );
    await ctx.runMutation(internal.sync.clearGrain, {});
    const CHUNK = 400;
    for (let i = 0; i < dailyScoped.length; i += CHUNK) {
      await ctx.runMutation(internal.sync.storeGrain, {
        daily: dailyScoped.slice(i, i + CHUNK),
        bookings: [],
      });
    }
    for (let i = 0; i < bookingScoped.length; i += CHUNK) {
      await ctx.runMutation(internal.sync.storeGrain, {
        daily: [],
        bookings: bookingScoped.slice(i, i + CHUNK),
      });
    }
    console.log(
      `grain: ${dailyScoped.length} daily rows, ${bookingScoped.length} bookings (${bookingScoped.filter(b => b.adId).length} tied to an ad)`,
    );

    // Keep the permanent winners archive in step: it needs the fresh daily
    // grain for the winning window and the fresh Meta tree for whether the ad
    // is still running. A winner that gets switched off is kept, not lost.
    try {
      // The other two cockpits read from what this sync just stored.
      await ctx.scheduler.runAfter(0, internal.fanout.runFanout, {
        withStats: true,
      });
      const arch = await ctx.runMutation(internal.market.archiveWinners, {});
      console.log(
        `winners archive: ${arch.archived} kept (${arch.added} new, ${arch.retired} newly off)`,
      );
    } catch (e) {
      console.error(`winners archive failed: ${String(e)}`);
    }

    return result;
  },
});

/**
 * Fill in each launching client's Meta ad account id from its name.
 *
 * Client Data stores the ad account NAME. Names differ slightly between the
 * sheet, ClickUp and Meta ("City Wood" / "city wood industry co." / "City Wood
 * Industry"), so a normalized prefix match is used, and where the id came from
 * is recorded so a wrong match can be traced.
 */
export const resolveOnboardingAccounts = internalMutation({
  args: {
    accounts: v.array(v.object({ name: v.string(), id: v.string() })),
  },
  returns: v.object({ resolved: v.number(), stillMissing: v.number() }),
  handler: async (ctx, { accounts }) => {
    const rows = await ctx.db.query("onboardings").collect();
    let resolved = 0;
    let stillMissing = 0;
    for (const r of rows) {
      if (r.accountId) continue;
      const candidates = [r.accountName, r.client].filter(Boolean) as string[];
      let found: string | undefined;
      for (const c of candidates) {
        const key = normalize(c);
        if (!key) continue;
        const hit =
          accounts.find(a => a.name === key) ??
          accounts.find(
            a =>
              a.name.length >= 5 &&
              (a.name.startsWith(key) || key.startsWith(a.name)),
          );
        if (hit) {
          found = hit.id;
          break;
        }
      }
      if (found) {
        await ctx.db.patch(r._id, {
          accountId: found,
          accountIdSource: "meta",
        });
        resolved += 1;
      } else {
        stillMissing += 1;
      }
    }
    return { resolved, stillMissing };
  },
});

/** Which clients already have an open launch task. */
export const onboardingClients = internalQuery({
  args: {},
  returns: v.array(
    v.object({ client: v.string(), taskUrl: v.optional(v.string()) }),
  ),
  handler: async ctx =>
    (await ctx.db.query("onboardings").collect()).map(r => ({
      client: r.client,
      taskUrl: r.taskUrl,
    })),
});

/** Clients whose ClickUp card is still in a pre-launch stage. */
export const preLaunchClients = internalQuery({
  args: {},
  returns: v.array(v.object({ name: v.string(), stage: v.string() })),
  handler: async ctx =>
    (await ctx.db.query("clients").collect())
      .filter(c =>
        /launch booked|ready for launch|blueprint|onboarding booked/i.test(
          c.stage,
        ),
      )
      .map(c => ({ name: c.name, stage: c.stage })),
});

/** The launch watch, for the CSM feed: who is live while their card says otherwise. */
export const liveWatch = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      client: v.string(),
      spend7d: v.number(),
      sheetStatus: v.string(),
    }),
  ),
  handler: async ctx =>
    (await ctx.db.query("launchWatch").collect()).map(w => ({
      client: w.client,
      spend7d: w.spend7d,
      sheetStatus: w.sheetStatus,
    })),
});

/** Add rows to the watch without touching the ones the sheet pass wrote; one row per client. */
export const appendLaunchWatch = internalMutation({
  // biome-ignore lint/suspicious/noExplicitAny: watch rows
  args: { rows: v.array(v.any()) },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    const existing = await ctx.db.query("launchWatch").collect();
    const key = (x: string) => normalize(x);
    let added = 0;
    for (const r of rows) {
      const k = key(r.client);
      const dup = existing.find(w => {
        const a = key(w.client);
        return (
          a === k || (a.length >= 5 && (a.startsWith(k) || k.startsWith(a)))
        );
      });
      if (dup) {
        // The sheet pass already has this client; add the board issue to it.
        if (!dup.issues.some(i => /ads management board/.test(i)))
          await ctx.db.patch(dup._id, {
            issues: [...dup.issues, ...r.issues],
            spend7d: Math.max(dup.spend7d, r.spend7d),
          });
        continue;
      }
      await ctx.db.insert("launchWatch", { ...r, syncedAt: Date.now() });
      added++;
    }
    return added;
  },
});

export const storeLaunchWatch = internalMutation({
  // biome-ignore lint/suspicious/noExplicitAny: watch rows
  args: { rows: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("launchWatch").collect())
      await ctx.db.delete(old._id);
    for (const r of rows)
      await ctx.db.insert("launchWatch", { ...r, syncedAt: Date.now() });
    return null;
  },
});

/** Wipe the raw grain before a rewrite. Kept apart from `store` on purpose. */
export const clearGrain = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    for (const row of await ctx.db.query("dailyStats").collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("bookingEvents").collect())
      await ctx.db.delete(row._id);
    return null;
  },
});

export const storeGrain = internalMutation({
  args: {
    // biome-ignore lint/suspicious/noExplicitAny: grain rows
    daily: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: grain rows
    bookings: v.array(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { daily, bookings }) => {
    for (const d of daily) await ctx.db.insert("dailyStats", d);
    for (const b of bookings) await ctx.db.insert("bookingEvents", b);
    return null;
  },
});

export const syncNow = authenticatedAction({
  args: {},
  returns: v.object({
    campaigns: v.number(),
    ads: v.number(),
    offBoard: v.number(),
  }),
  handler: async (ctx): Promise<SyncResult> =>
    (await ctx.runAction(internal.sync.runSync, {})) as SyncResult,
});

/* ------------------------------------------------------------------ *
 * External input staging
 *
 * The Space's server-side tool endpoint is down platform-side, so the
 * sheets and ClickUp reads happen in the Viktor sandbox instead and are
 * staged here. runSync prefers staged input and falls back to fetching
 * for itself, so this all reverts to normal automatically once the
 * platform endpoint recovers.
 * ------------------------------------------------------------------ */

export const stageClear = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    for (const row of await ctx.db.query("syncInput").collect()) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

export const stagePut = internalMutation({
  args: { part: v.number(), data: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("syncInput", { ...args, at: Date.now() });
    return null;
  },
});

/** Preview iframes already stored, by ad id: reused so a sync costs one call per NEW ad. */
export const previewCache = internalQuery({
  args: {},
  returns: v.array(v.array(v.string())),
  handler: async ctx =>
    (await ctx.db.query("metaTree").collect())
      .filter(t => t.kind === "ad" && t.previewSrc)
      .map(t => [t.metaId, String(t.previewSrc)]),
});

/** Reassemble the staged chunks, if any are present and fresh. */
export const stagedInput = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async ctx => {
    const rows = await ctx.db.query("syncInput").collect();
    if (rows.length === 0) return null;
    // Stale staging is worse than none — it would silently serve old numbers.
    const newest = Math.max(...rows.map(r => r.at));
    if (Date.now() - newest > 6 * 3600 * 1000) return null;
    return rows
      .sort((a, b) => a.part - b.part)
      .map(r => r.data)
      .join("");
  },
});

/** Replace the onboarding list wholesale — staged by the sandbox bridge. */
export const storeOnboardings = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ written: v.number() }),
  handler: async (ctx, { rows }) => {
    for (const old of await ctx.db.query("onboardings").collect()) {
      await ctx.db.delete(old._id);
    }
    for (const r of rows) {
      await ctx.db.insert("onboardings", { ...r, syncedAt: Date.now() });
    }
    return { written: rows.length };
  },
});

/**
 * Hand the scoped ad performance to the creative director's Space.
 *
 * Deliberately a read of what `storeSnapshot` already stored, so both cockpits
 * agree on which campaigns count as ours instead of each deciding separately.
 * Only creative-relevant fields cross the boundary — no budgets, no revenue.
 */
export const exportAdPerformance = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const ads = await ctx.db.query("ads").collect();
    const campaigns = await ctx.db.query("campaigns").collect();
    return {
      ads: ads.map(a => ({
        campaignName: a.campaignName,
        adName: a.adName,
        spend: a.spend,
        leads: a.leads,
        cpl: a.cpl,
        linkCtr: a.linkCtr,
        cpm: a.cpm,
        optInRate: a.optInRate,
        frequency: a.frequency,
        thumbnailUrl: a.thumbnailUrl,
        // The creative director's whole job is the creative, so the preview
        // travels with the numbers. [aziz, 2026-09-06]
        previewSrc: a.previewSrc,
        metaAdId: a.metaAdId,
      })),
      campaigns: campaigns.map(c => ({
        campaignName: c.campaignName,
        accountName: c.accountName,
        clientName: c.clientName,
        clientTag: c.clientTag,
        serviceType: c.serviceType,
        spend7d: c.spend7d,
        leads7d: c.leads7d,
        cpl: c.cpl,
        // Booked / showed / cost per booking, the same numbers the CSM screen
        // shows, so he can see whether his creative actually converts.
        bookings7d: c.bookings7d,
        showed7d: c.showed7d,
        costPerBooking: c.costPerBooking,
        bookingRate: c.bookingRate,
        showRate: c.showRate,
        boardAdStatus: c.boardAdStatus,
        metaAccountId: c.metaAccountId,
        metaCampaignId: c.metaCampaignId,
      })),
      // Live ad sets and ads with Meta's previews, so the client view can show
      // what is actually running right now, not just what spent.
      tree: (await ctx.db.query("metaTree").collect()).map(t => ({
        campaignName: t.campaignName,
        kind: t.kind,
        metaId: t.metaId,
        name: t.name,
        status: t.status,
        effectiveStatus: t.effectiveStatus,
        adsetId: t.adsetId,
        previewSrc: t.previewSrc,
        thumbUrl: t.thumbUrl,
      })),
    };
  },
});

/** Read-only counters used to verify preview coverage after a sync. */
export const previewCoverage = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const ads = await ctx.db.query("ads").collect();
    const tree = await ctx.db.query("metaTree").collect();
    const treeAds = tree.filter(r => r.kind === "ad");
    return {
      perfAds: ads.length,
      perfWithThumb: ads.filter(a => a.thumbnailUrl).length,
      treeAds: treeAds.length,
      treeWithPreview: treeAds.filter(r => r.previewSrc).length,
      treeWithThumb: treeAds.filter(r => r.thumbUrl).length,
    };
  },
});

/** The last run's self-check, for the bridge to print after every sync. */
export const lastRunHealth = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const run = await ctx.db
      .query("syncRuns")
      .withIndex("by_at")
      .order("desc")
      .first();
    if (!run) return null;
    return {
      at: run.at,
      ok: run.ok,
      health: run.health,
      problems: run.problems,
    };
  },
});

/** Sample of stored lost-lead notes, to confirm form dumps are excluded. */
export const lostNotesSample = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const campaigns = await ctx.db.query("campaigns").collect();
    const out: { client: string; reason: string; note: string }[] = [];
    for (const c of campaigns) {
      // biome-ignore lint/suspicious/noExplicitAny: stored blob
      for (const n of ((c.lost as any)?.notes ?? []).slice(0, 3)) {
        out.push({
          client: c.clientName ?? c.accountName,
          reason: n.reason,
          note: String(n.note).slice(0, 120),
        });
      }
    }
    return {
      total: out.length,
      formDumps: out.filter(n => /form answers/i.test(n.note)).length,
      sample: out.slice(0, 12),
    };
  },
});
