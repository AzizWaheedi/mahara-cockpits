// Generated from the original calculator. Source SHA256: 47158039b37ab1cb814f1102b7599e9377ae107cc75b28529821f04caebe81d6
// Regenerate with node hermes/cockpit-sync/extract.cjs; no service runtime dependency.
import {type ActionCtx,internal,graph,allAdAccounts,callTool,supabaseQuery,unwrap,providerFetch,recordLog,MAHARA_BUSINESS_ID} from './runtime';
import {CPL_GATE,CPB_GATE,NEW_CAMPAIGN_FORM_URL} from './constants';
import {withoutExcludedAds} from './excludedAds';
import {hasPicture,isMetaId,metaImageExpiry,metaImageUsable,sameStoredRow,stillCaptureDue,stillKeyFor} from './metaMedia';
const TRACKER = "1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro";

const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

const ADS_LIST = "901817774521";

/**
 * The creative director's boards. Exported because the sandbox bridge reads
 * these ids out of this file — this stays the one place they are defined.
 */
export const CREATIVE_LIST = "901818016338";

// Media/Creative — his task board
export const VIDEO_LIST = "901816720767";

// Video Pipeline — editor deadlines
export const CONTENT_LIST = "901818697220";

// Content Calendar — social posts
export const CLIENTS_LIST = "901816559981";

// Clients - Mahara — the client spine
// Mahara's own lead-gen account is not a client campaign.
const INTERNAL_ACCOUNTS = ["maharamedia"];

const NADA = "113428468";

/** Boards the media buyer works out of. */
const HER_LISTS = ["901817774521", "901816723196"];

/** Marketing / ADs: everything open on it is her task list. [aziz, 2026-09-09] */
const MARKETING_LIST = "901816723196";

const BUDGET_FLOOR = 30;

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

export function num(x: unknown): number {
  const n = Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - n * 86400000)
    .toISOString()
    .slice(0, 10);
}

export function normalize(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Ad-level daily rows, straight from Meta, for every visible account with
 * spend in the last 30 days that the tracker sheet does not keep up to date:
 * accounts with no row at all, and accounts whose rows stop more than a day
 * short of yesterday. Same columns as `data_fb` (see `C`), so the rest of
 * the sync does not care where a row came from.
 *
 * The second kind is Arcturus on 2026-09-23: its connector stopped on the
 * 14th while the account kept spending, and because the sheet had *some*
 * rows the old check never asked Meta -- nine days of spend went missing
 * from the grain, and with them every per-ad cost per booking. Only the
 * days after the sheet's last one are taken, so no day is counted twice.
 */
/** The keys one ad-day row is known by: its ad id, and its names. */
export function rowKeys(r: {
  date: string;
  adId?: string;
  campaign?: string;
  adSet?: string;
  adName?: string;
}): string[] {
  const keys: string[] = [];
  if (r.adId) keys.push(`${r.date}|id:${r.adId}`);
  if (r.campaign && r.adName)
    keys.push(
      `${r.date}|${normalize(r.campaign)}|${normalize(r.adSet ?? "")}|${normalize(r.adName)}`,
    );
  return keys;
}

export async function metaRowsForMissingAccounts(
  sheetRows: string[][],
  since: string,
): Promise<{ rows: string[][]; accounts: string[] }> {
  const lastInSheet = new Map<string, string>();
  // Every ad-day the sheet already has. A Meta row matching one is the same
  // row, whatever either source calls the account: Ardon's spend and leads
  // were counted twice here until 2026-10-08 (ported from sync.ts e4229c5f).
  const inSheet = new Set<string>();
  for (const r of sheetRows)
    if (r[C.date] >= since && r[C.account]) {
      const k = normalize(r[C.account]);
      if ((lastInSheet.get(k) ?? "") < r[C.date]) lastInSheet.set(k, r[C.date]);
      for (const key of rowKeys({
        date: r[C.date],
        adId: r[C.adId],
        campaign: r[C.campaign],
        adSet: r[C.adSet],
        adName: r[C.adName],
      }))
        inSheet.add(key);
    }
  // A day of slack: the connector fills yesterday some time today, and a
  // sheet one day behind is on schedule, not broken.
  const stale = daysAgo(2);
  const until = daysAgo(1);
  // One call per edge for the 30-day spend of every account at once.
  // biome-ignore lint/suspicious/noExplicitAny: Graph rows
  const accounts: any[] = [];
  for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
    // biome-ignore lint/suspicious/noExplicitAny: Graph rows
    const r = await graph<any>(`${MAHARA_BUSINESS_ID}/${edge}`, {
      fields: "id,name,currency,insights.date_preset(last_30d){spend}",
      limit: 200,
    });
    accounts.push(...(r.data ?? []));
  }
  const out: string[][] = [];
  const names: string[] = [];
  for (const a of accounts) {
    const name = String(a.name ?? "").trim();
    const key = normalize(name);
    if (!key || INTERNAL_ACCOUNTS.includes(key)) continue;
    const last = lastInSheet.get(key);
    if (last && last >= stale) continue;
    const spend = num(a.insights?.data?.[0]?.spend);
    if (spend <= 0) continue;
    const currency = String(a.currency ?? "USD");
    // From the day after the sheet's last row, or the whole window when the
    // sheet has none.
    const from = last
      ? new Date(Date.parse(`${last}T00:00:00Z`) + 86400000)
          .toISOString()
          .slice(0, 10)
      : since;
    if (from > until) continue;
    // biome-ignore lint/suspicious/noExplicitAny: Graph rows
    let page: any = await graph<any>(`${a.id}/insights`, {
      level: "ad",
      time_increment: 1,
      time_range: JSON.stringify({ since: from, until }),
      fields:
        "date_start,campaign_name,adset_name,ad_name,ad_id,spend,impressions,inline_link_clicks,frequency,actions",
      limit: 500,
    });
    let guard = 0;
    while (page && guard++ < 10) {
      for (const d of page.data ?? []) {
        if (
          rowKeys({
            date: String(d.date_start ?? ""),
            adId: String(d.ad_id ?? ""),
            campaign: String(d.campaign_name ?? ""),
            adSet: String(d.adset_name ?? ""),
            adName: String(d.ad_name ?? ""),
          }).some(k => inSheet.has(k))
        )
          continue;
        const leads = num(
          // biome-ignore lint/suspicious/noExplicitAny: Graph rows
          (d.actions ?? []).find((x: any) => x.action_type === "lead")?.value,
        );
        const cost = num(d.spend);
        const row: string[] = new Array(25).fill("");
        row[C.date] = String(d.date_start ?? "");
        row[C.account] = name;
        row[C.campaign] = String(d.campaign_name ?? "");
        row[C.adSet] = String(d.adset_name ?? "");
        row[C.cost] = String(cost);
        row[C.leads] = String(leads);
        row[6] = leads ? String(Math.round((cost / leads) * 100) / 100) : "";
        row[C.impressions] = String(num(d.impressions));
        row[C.linkClicks] = String(num(d.inline_link_clicks));
        row[C.frequency] = String(num(d.frequency));
        row[C.adId] = String(d.ad_id ?? "");
        row[C.adName] = String(d.ad_name ?? "");
        row[C.status] = "ACTIVE";
        row[C.currency] = currency;
        out.push(row);
      }
      const next = page.paging?.next;
      if (!next) break;
      const res = await providerFetch(next);
      page = await res.json();
      if (page?.error) break;
    }
    names.push(last ? `${name} (after ${last}, the sheet stopped)` : name);
  }
  return { rows: out, accounts: names };
}

export async function sheet(id: string, range: string): Promise<string[][]> {
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

export function diagnose(c: {
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
  eventId?: string; locationId?: string; contactId?: string; startTime?: string;
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
export async function ghlBookingEvents(
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
    const calRes = await providerFetch(
      `https://services.leadconnectorhq.com/calendars/?locationId=${loc}`,
      { headers: calHeaders },
    );
    if (!calRes.ok) return undefined;
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const cals: any[] = (await calRes.json())?.calendars ?? [];
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const events: any[] = [];
    for (const c of cals) {
      // "Not Confirmed Appointments" is the provisional calendar and the
      // callback / reschedule calendars are agent scheduling, not bookings.
      // Counting them inflated bookings7d until 2026-09-12.
      if (
        /not confirmed|callback|reschedule|personal calendar/i.test(
          String(c.name ?? ""),
        )
      )
        continue;
      const evRes = await providerFetch(
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
      const oRes = await providerFetch(
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
        eventId: e.id ? String(e.id) : undefined, locationId: loc, contactId: e.contactId, startTime: e.startTime,
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
export function bookingTotals(
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
export async function ghlLostLeads(
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
    const pRes = await providerFetch(
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

    const oRes = await providerFetch(
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
            const r = await providerFetch(
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

export function judge(
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

/** Stills handed to one capture run per sync; the rest wait for the next sync. */
const STILLS_PER_SYNC = 30;

type SyncResult = { campaigns: number; ads: number; offBoard: number };

export async function syncOnce(ctx: ActionCtx): Promise<SyncResult> {
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

  // If the tracker sheet cannot be read at all, the Meta fallback below
  // covers every account with spend, so the cockpits still refresh.
  let rows: string[][] = staged?.rows ?? [];
  if (!staged?.rows) {
    try {
      rows = await sheet(TRACKER, "'data_fb'!A3:Y11005");
    } catch (e) {
      recordLog("error",
        `tracker sheet unreadable, Meta only: ${String(e).slice(0, 160)}`,
      );
    }
  }
  const clientRows: string[][] =
    staged?.clientRows ?? (await sheet(DATABASE, "'Client Data'!A1:S200"));
  // The tracker sheet only carries the accounts its connector was set up
  // for. Any account Meta shows us that the sheet does not (City Wood, Al Ola
  // on 2026-09-12) is read straight from Meta in the same row shape, so a new
  // ad account never needs anyone to touch the sheet's connector first.
  try {
    const extra = await metaRowsForMissingAccounts(rows, since30);
    if (extra.rows.length) {
      rows.push(...extra.rows);
      recordLog("log",
        `meta fallback: ${extra.rows.length} row(s) for ${extra.accounts.join(", ")}`,
      );
    }
  } catch (e) {
    recordLog("error",`meta fallback: ${String(e).slice(0, 200)}`);
  }
  // Unauthorized ads from the October 2026 account compromise never count.
  rows = withoutExcludedAds(rows);

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
    // Each row needs its own sub-account token: agency-level tokens cannot
    // read location endpoints (tested 2026-09-10).
    const token = String(r[col("GHL API")] ?? "").trim();
    if (name && loc && token.startsWith("pit-")) {
      ghlByClient.set(normalize(name), {
        loc: String(loc),
        token,
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
  // Every card on the board, for the board view in the cockpit (old,
  // paused and dead campaigns included). [Aziz, 2026-09-14]
  try {
    await ctx.runMutation(internal.board.storeBoardCards, {
      rows: (tasks as any[]).map(t => {
        const f = (t.custom_fields ?? []).find(
          (x: any) => x.name === "Ad Status",
        );
        const opts: any[] = f?.type_config?.options ?? [];
        const hit =
          f && f.value !== undefined && f.value !== null
            ? (opts.find(o => o.id === f.value) ??
              opts[typeof f.value === "number" ? f.value : -1])
            : undefined;
        return {
          taskId: String(t.id),
          name: String(t.name ?? ""),
          url: t.url ? String(t.url) : undefined,
          adStatus: hit?.name ? String(hit.name) : undefined,
          advertisingCities: (() => {
            const cf = (t.custom_fields ?? []).find(
              (x: any) => x.name === "Advertising Cities",
            );
            if (!Array.isArray(cf?.value) || !cf.value.length) return undefined;
            const o: any[] = cf.type_config?.options ?? [];
            return cf.value.map(
              (id: unknown) => o.find(x => x.id === id)?.label ?? String(id),
            );
          })(),
          tag: t.tags?.[0]?.name ? String(t.tags[0].name) : undefined,
          updatedAt: Number(t.date_updated ?? 0) || undefined,
        };
      }),
    });
  } catch (e) {
    recordLog("warn",`board cards: ${String(e).slice(0, 120)}`);
  }
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
  const accountIssueByName = new Map<string, string>();
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
      // Meta refuses every write on an unsettled or disabled account. Say
      // so on the row instead of letting a button fail. [2026-09-11]
      const st = Number(a.account_status ?? 1);
      const issue =
        st === 3
          ? "Ad account unsettled: an unpaid Meta balance. Meta refuses pauses, budget changes and new ads until it is paid."
          : st === 2
            ? "Ad account disabled by Meta. Nothing can be changed until it is reinstated."
            : st === 9
              ? "Ad account in payment grace period."
              : st === 100 || st === 101
                ? "Ad account closed or closing."
                : st === 7 || st === 8
                  ? "Ad account pending review or settlement at Meta."
                  : undefined;
      if (issue) accountIssueByName.set(normalize(a.name ?? ""), issue);
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

  // The launch watch: every open launch task on ClickUp, checked against
  // Client Data, Meta and actual spend. Runs on every sync, so a stalled launch
  // announces itself instead of waiting to be noticed. [aziz, 2026-09-07]
  {
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
    // Aziz, 2026-09-11: "don't use the sheet; use whatever is on ClickUp
    // as a task for new campaign launches as the source of truth." A client
    // is launching when there is an open "New Client Campaign Launch" task,
    // full stop. The sheet's Status column is no longer read here.
    const launching: {
      client: string;
      taskUrl?: string;
      status?: string;
      accountId?: string;
      accountName?: string;
    }[] = await ctx.runQuery(internal.sync.onboardingClients, {});
    for (const o of launching) {
      const client = o.client;
      const key = o.accountName ? normalize(o.accountName) : "";
      const accountId =
        o.accountId ??
        (key
          ? (accountIdByName.get(key) ??
            [...accountIdByName.entries()].find(
              ([n]) =>
                n.length >= 5 && (n.startsWith(key) || key.startsWith(n)),
            )?.[1])
          : undefined);
      let spend7d = key ? (spendByAccount.get(key) ?? 0) : 0;
      if (!spend7d) {
        // No account on the row yet: any spend under the client's own name.
        const nk = normalize(client);
        const first = normalize(client.split(/[\s\-_/]+/)[0] ?? "");
        for (const [campaignKey, agg] of byCampaign) {
          const acct = normalize(agg.account);
          const camp = normalize(String(campaignKey));
          const hit = (x: string) =>
            x.length >= 5 &&
            (x.startsWith(nk) ||
              nk.startsWith(x) ||
              (first.length >= 5 && x.startsWith(first)));
          if (hit(acct) || hit(camp)) spend7d += agg.spend;
        }
      }
      const issues: string[] = [];
      if (!o.accountName && !o.accountId) {
        issues.push(
          "No ad account in Client Data — nothing can be built until that cell is filled.",
        );
      } else if (!accountId) {
        issues.push(
          `Client Data says the ad account is "${o.accountName}", but no Meta account of ours has that name. Either the name is wrong or the account has not been shared with us.`,
        );
      }
      if (spend7d > 0) {
        issues.push(
          `Already spending ($${spend7d.toFixed(0)} in 7 days) while the launch task is still open — close the launch task and set the client Active.`,
        );
      }
      watch.push({
        client,
        sheetStatus: `launch task: ${o.status || "open"}`,
        accountName: o.accountName,
        accountId,
        hasTask: true,
        taskUrl: o.taskUrl,
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
    recordLog("log",
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
    // Last resort: the campaign name's first word against the client tags
    // ("CASTELLO-mahaa-9\9" → tag "castello industries"). A typo in the
    // campaign name, or spend in a second ad account the sheet does not
    // list, used to leave a carded client looking off-board. [2026-09-10]
    const firstWord = normalize(name.split(/[\s\-_/|(),]+/)[0] ?? "");
    const byTagPrefix =
      !byName && !byTag && firstWord.length >= 5
        ? [...taskByTag.entries()].find(([k]) => k.startsWith(firstWord))?.[1]
        : undefined;
    const task = byName ?? byTag ?? byTagPrefix;
    // A tag match also tells us who the client is when the account did not.
    const clientFromTag =
      !client && task
        ? (task.tags ?? []).map((t: any) => String(t.name))[0]
        : undefined;
    // Matched on the client tag but the task still names an older campaign.
    const staleTaskName = !byName && byTag ? byTag.name : undefined;
    const cpl = a.leads > 0 ? a.spend / a.leads : undefined;
    // Link CTR, CPM and opt-in rate. Aziz asked for link CTR specifically —
    // the sheet's "CTR (all)" column counts every click including reactions
    // and profile taps, so it flatters a bad hook. It is deliberately unused.
    const rateable = a.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS;
    const linkCtr = rateable ? (a.linkClicks / a.impressions) * 100 : undefined;
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
    // Labels fields (Advertising Cities) come back as a list of option ids.
    const labels = (n: string): string[] | undefined => {
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      const f = (task?.custom_fields ?? []).find((c: any) => c.name === n);
      if (!Array.isArray(f?.value) || !f.value.length) return undefined;
      // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
      const opts: any[] = f.type_config?.options ?? [];
      return f.value.map(
        (id: unknown) => opts.find(o => o.id === id)?.label ?? String(id),
      );
    };

    campaigns.push({
      campaignName: name,

      accountName: a.account,
      accountIssue: accountIssueByName.get(normalize(a.account)),
      clientName: client ?? clientFromTag,
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
      advertisingCities: labels("Advertising Cities"),
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
      rank: isInternal ? 60 : task ? Math.min(cpbJudged?.rank ?? 99, rank) : 1,
      syncedAt: now,
    });

    // Raw daily grain for this campaign, and its bookings tied to ads.
    const adIdsHere = new Set<string>();
    // The tracker's own ad id per ad name (latest day wins), so an ad that is
    // no longer in Meta's list can still get its picture and preview.
    const adIdByName = new Map<string, { id: string; date: string }>();
    for (const d of a.daily.values()) {
      if (d.metaAdId) {
        adIdsHere.add(d.metaAdId);
        const seen = adIdByName.get(d.adName);
        if (!seen || d.date > seen.date)
          adIdByName.set(d.adName, { id: d.metaAdId, date: d.date });
      }
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
          : Boolean(client) && !unattributedTaken.has(normalize(client ?? ""));
        if (!mine) continue;
        bookingRows.push({
          campaignName: name,
          client,
          date: e.date,
          appointmentDate: e.appointmentDate,
          eventId: e.eventId, locationId: e.locationId, contactId: e.contactId, startTime: e.startTime,
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
        metaAdId: adIdByName.get(adName)?.id,
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
      if (!c.id) throw new Error("ClickUp mention has no provider comment identity");
      inbox.push({
        kind: "mention",
        taskId: t.id,
        commentId: String(c.id),
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
        if (k.length >= 5 && (key.startsWith(k) || k.startsWith(key))) return v;
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
        recordLog("warn",
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
    recordLog("log",`open launches: ${onboardingRows.length}`);
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
  recordLog("log",
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

  // One card, one campaign. A client's second campaign used to match the
  // first campaign's card through the client tag, so both shared one Ad
  // Status and pausing one paused both (Ocean Home 2/9 and 9/9, Liwan,
  // 2026-09-14). The card stays with the campaign it is named after, else
  // the one spending most; the others are "not on the board" and get their
  // own card from the cockpit.
  {
    const byTask = new Map<string, any[]>();
    for (const c of campaigns)
      if (c.taskId) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
    for (const [, list] of byTask) {
      if (list.length < 2) continue;
      const owner =
        list.find(c => !c.staleTaskName) ??
        [...list].sort((a, b) => (b.spend7d ?? 0) - (a.spend7d ?? 0))[0];
      for (const c of list) {
        if (c === owner) continue;
        c.onBoard = false;
        c.taskId = undefined;
        c.taskUrl = undefined;
        c.staleTaskName = undefined;
        c.boardAdStatus = undefined;
        c.advertisingCities = undefined;
        c.adStatus = undefined;
      }
      recordLog("log",
        `board: card shared by ${list.map(c => c.campaignName).join(" + ")}; kept for ${owner.campaignName}`,
      );
    }
  }

  // Pull the live structure under every campaign we can actually see in the API,
  // so she can read ad sets and ads in place. Preview links are no longer
  // fetched here: Meta's expire within a day, so previews.ts fetches one when
  // someone opens an ad, and pictures come from our own saved stills.
  // [2026-09-16]
  // biome-ignore lint/suspicious/noExplicitAny: Meta rows
  const metaTree: any[] = [];
  let pictureOk = 0;
  let pictureMissing = 0;
  for (const c of campaigns) {
    if (!c.metaAccountId || !c.metaCampaignId) continue;
    try {
      // Graph direct, not the tool gateway: previews were silently failing
      // whenever the gateway 500'd, and a missing preview is the one thing
      // Nada actually looks at. See tools.ts:graph().
      // The campaign's own budget and its ad sets in one call: a budget on
      // the campaign means CBO, and edits must go there (2026-09-14).
      const campRes = await graph<any>(c.metaCampaignId, {
        fields:
          "daily_budget,lifetime_budget,adsets.limit(200){id,name,status,effective_status,daily_budget,lifetime_budget}",
      });
      const sets = campRes?.adsets ?? { data: [] };
      {
        const minor = (x: unknown) => (x ? Number(x) / 100 : undefined);
        const setRows = (sets?.data ?? []) as any[];
        const delivering = setRows.filter(
          s => String(s.effective_status ?? s.status) === "ACTIVE",
        );
        const counted = delivering.length ? delivering : setRows;
        if (campRes?.daily_budget || campRes?.lifetime_budget) {
          c.budgetLevel = "campaign";
          c.budgetDaily = minor(campRes.daily_budget);
          c.budgetLifetime = minor(campRes.lifetime_budget);
        } else {
          c.budgetLevel = "adset";
          const daily = counted.reduce(
            (sum, s) => sum + (minor(s.daily_budget) ?? 0),
            0,
          );
          const lifetime = counted.reduce(
            (sum, s) => sum + (minor(s.lifetime_budget) ?? 0),
            0,
          );
          c.budgetDaily = daily || undefined;
          c.budgetLifetime = lifetime || undefined;
        }
      }
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

      // Every ad, not the first ten. The creative id keys the saved still;
      // its thumbnail is a short-lived Meta link, used only until it expires.
      const adsRes = await graph<any>(`${c.metaCampaignId}/ads`, {
        fields:
          "id,name,status,effective_status,adset_id," +
          "creative{id,thumbnail_url,image_url,object_story_spec{video_data{image_url},link_data{picture}}}",
        limit: 200,
      });
      const ads = (adsRes?.data ?? []) as any[];

      for (const ad of ads) {
        const cr = ad.creative ?? {};
        const creativeId: string | undefined = cr.id
          ? String(cr.id)
          : undefined;
        const thumbUrl: string | undefined =
          cr.image_url ??
          cr.thumbnail_url ??
          cr.object_story_spec?.video_data?.image_url ??
          cr.object_story_spec?.link_data?.picture ??
          undefined;
        if (thumbUrl) pictureOk++;
        else pictureMissing++;
        metaTree.push({
          campaignName: c.campaignName,
          kind: "ad",
          metaId: String(ad.id),
          name: String(ad.name ?? ""),
          status: String(ad.status ?? ""),
          effectiveStatus: ad.effective_status,
          adsetId: ad.adset_id ? String(ad.adset_id) : undefined,
          thumbUrl,
          accountId: String(c.metaAccountId).replace(/^act_/, ""),
          creativeId,
          stillKey: stillKeyFor(creativeId, String(ad.id)),
          syncedAt: now,
        });
      }
    } catch {
      // Account genuinely unreachable — the row still deep-links out to Meta.
    }
  }
  recordLog("log",
    `metaTree: ${metaTree.filter(r => r.kind === "ad").length} ads, ` +
      `${pictureOk} with a Meta picture, ${pictureMissing} without`,
  );

  // Give every performance row the creative that produced it. The spend rows
  // and the Meta tree are two different sources keyed by the same ad name, so
  // join them here rather than making the UI guess. Meta's own thumbnail wins
  // over the Supabase one, which is often stale or missing entirely. The
  // tracker's own ad id is the fallback join when the names differ.
  type TreeHit = { thumbUrl?: string; metaId: string; stillKey?: string };
  const treeByName = new Map<string, TreeHit>();
  const treeById = new Map<string, TreeHit>();
  for (const r of metaTree) {
    if (r.kind !== "ad") continue;
    const hit = {
      thumbUrl: r.thumbUrl,
      metaId: r.metaId,
      stillKey: r.stillKey,
    };
    treeByName.set(`${normalize(r.campaignName)}|${normalize(r.name)}`, hit);
    treeById.set(r.metaId, hit);
  }
  let adsWithCreative = 0;
  for (const a of ads) {
    const hit =
      treeByName.get(`${normalize(a.campaignName)}|${normalize(a.adName)}`) ??
      (a.metaAdId ? treeById.get(a.metaAdId) : undefined);
    if (hit) {
      a.metaAdId = hit.metaId;
      a.stillKey = hit.stillKey;
      if (hit.thumbUrl) a.thumbnailUrl = hit.thumbUrl;
    }
    if (a.thumbnailUrl) adsWithCreative++;
  }
  recordLog("log",
    `ad performance rows: ${ads.length}, ${adsWithCreative} with a Meta picture`,
  );

  // Who changed what in each campaign over the last 14 days. Meta activities
  // belong to an account; use the object id to avoid showing one campaign's
  // edits under every other campaign in that account.
  // biome-ignore lint/suspicious/noExplicitAny: change rows
  const adChanges: any[] = [];
  try {
    const byObject = new Map<string, string>();
    for (const c of campaigns) {
      if (c.metaCampaignId)
        byObject.set(String(c.metaCampaignId), c.campaignName);
    }
    for (const node of metaTree)
      byObject.set(String(node.metaId), node.campaignName);
    for (const r of await supabaseQuery(`
        select activity_hash, meta_ad_account_id, event_time, actor_name,
               event_type, translated_event_type, object_id, object_name, object_type
        from ad_account_activities
        where event_time >= now() - interval '14 days'
        order by event_time desc limit 1500
      `)) {
      const objectId = String(r.object_id ?? "");
      const campaignName = byObject.get(objectId);
      if (!campaignName) continue;
      const campaign = campaigns.find(c => c.campaignName === campaignName);
      if (
        !campaign ||
        String(campaign.metaAccountId ?? "").replace(/^act_/, "") !==
          String(r.meta_ad_account_id ?? "").replace(/^act_/, "")
      )
        continue;
      adChanges.push({
        campaignName,
        at: Date.parse(String(r.event_time)),
        activityHash: r.activity_hash ? String(r.activity_hash) : undefined,
        objectId,
        actor: r.actor_name ? String(r.actor_name) : undefined,
        eventType: String(r.translated_event_type ?? r.event_type ?? ""),
        objectName: r.object_name ? String(r.object_name) : undefined,
        objectType: r.object_type ? String(r.object_type) : undefined,
      });
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

  const { missingStills, ...result } = await ctx.runMutation(
    internal.sync.store,
    {
      campaigns,
      ads,
      metaTree,
      adChanges,
      checks,
      inbox,
    },
  );
  // Ads with no saved still yet: one capture run, at most 30 per sync.
  if (missingStills.length) {
    try {
      await ctx.scheduler.runAfter(0, internal.previews.captureStills, {
        items: missingStills,
      });
    } catch (e) {
      recordLog("error",`stills: could not schedule: ${String(e).slice(0, 120)}`);
    }
  }

  // The raw grain goes in its own chunked pass: thousands of rows will not
  // fit in one mutation, and it must never be able to fail the main store.
  const onBoardNames = new Set(
    campaigns.filter(c => c.onBoard).map(c => c.campaignName),
  );
  const dailyScoped = daily.filter(d => onBoardNames.has(d.campaignName));
  const bookingScoped = bookingRows.filter(b =>
    onBoardNames.has(b.campaignName),
  );
  await replaceGrainForSync(ctx, {
    campaignCount: campaigns.length,
    since: since30,
    daily: dailyScoped,
    bookings: bookingScoped,
  });

  // Keep the permanent winners archive in step: it needs the fresh daily
  // grain for the winning window and the fresh Meta tree for whether the ad
  // is still running. A winner that gets switched off is kept, not lost.
  // It reads four whole tables, so it runs once a day (the 03:00 UTC sync)
  // and after the weekly collector, not on every sync. [2026-09-16]
  try {
    // The other two cockpits read from what this sync just stored.
    await ctx.scheduler.runAfter(0, internal.fanout.runFanout, {
      withStats: true,
    });
    const arch = await ctx.runMutation(internal.market.archiveWinners, {
      ifDue: true,
    });
    recordLog("log",
      `winners archive: ${arch.archived} kept (${arch.added} new, ${arch.retired} newly off)`,
    );
  } catch (e) {
    recordLog("error",`winners archive failed: ${String(e)}`);
  }

  return result;
}

/** Keep the last good history when the campaign fetch produced no snapshot. */
export async function replaceGrainForSync(
  ctx: ActionCtx,
  data: {
    campaignCount: number;
    since: string;
    daily: any[];
    bookings: any[];
  },
) {
  if (data.campaignCount === 0) return { preserved: true };
  // Daily rows: one difference per campaign, so a day that has not changed
  // is not rewritten and nothing reading the table re-runs for nothing.
  const byCampaign = new Map<string, any[]>();
  for (const r of data.daily) {
    const list = byCampaign.get(r.campaignName) ?? [];
    list.push(r);
    byCampaign.set(r.campaignName, list);
  }
  for (const [campaignName, rows] of byCampaign)
    await ctx.runMutation(internal.sync.syncDailyCampaign, {
      campaignName,
      since: data.since,
      rows: rows.filter(r => r.date >= data.since),
    });
  await ctx.runMutation(internal.sync.pruneDaily, {
    since: data.since,
    keep: [...byCampaign.keys()],
  });
  // Bookings: the window is wiped and written, read as an index range.
  await ctx.runMutation(internal.sync.clearBookings, { since: data.since });
  const chunk = 400;
  for (let i = 0; i < data.bookings.length; i += chunk)
    await ctx.runMutation(internal.sync.storeGrain, {
      daily: [],
      bookings: data.bookings.slice(i, i + chunk),
    });
  return { preserved: false };
}

/** The fields a daily row can change on; the key is everything else. */
const DAILY_VALUES = [
  "spend",
  "leads",
  "impressions",
  "linkClicks",
  "frequency",
] as const;

// biome-ignore lint/suspicious/noExplicitAny: grain rows
const dailyKey = (r: any) =>
  `${r.date}|${r.adName}|${r.metaAdId ?? ""}|${r.adSetName ?? ""}`;
