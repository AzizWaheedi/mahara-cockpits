import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { plainText } from "./format";
import { dayLabel, kuwaitDay, shiftDay } from "./reportPeriod";

/**
 * One client's campaigns, ad sets and ads for a period, for the Results tab
 * (Muhammed, 2026-10-12). The numbers come from cockpit_csm_client_ads, which
 * reads the same daily statistics and booked calls as the media buyer's range
 * table, and the sums here follow its rules (mediaStatsClient.ts in the media
 * buyer cockpit):
 *
 * - spend, leads, impressions and link clicks add up by day;
 * - link CTR and CPM need 1,000 impressions;
 * - a booking counts on the day it was made and is credited to the ad that
 *   brought the lead, through the ad id; one with no such ad counts only in
 *   its campaign's totals;
 * - cost per booking needs both spend and a booking.
 *
 * A booked call counts as attended when it is marked showed, or confirmed or
 * invalid once its time has passed: Aziz's rule, the media buyer's funnel sheet.
 */

const MIN_IMPRESSIONS_FOR_RATES = 1000;
/** Longer periods chart by week, as the client charts do. */
export const WEEKLY_AFTER_DAYS = 45;
/** The function reads at most 400 days at a time. */
export const MAX_RANGE_DAYS = 400;

// ---------------------------------------------------------------------------
// The read.

// A missing field reads as empty, never as a broken read: the 30 days before
// the period come without impressions, link clicks or frequency.
const text = z
  .unknown()
  .optional()
  .transform(v => (typeof v === "string" && v.trim() ? v : undefined));
const amount = z
  .unknown()
  .optional()
  .transform(v => {
    if (v === null || v === undefined || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
const maybe = z
  .unknown()
  .optional()
  .transform(v => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  });
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform(v => v.slice(0, 10));
const nativeUrl = z
  .string()
  .regex(
    /^https:\/\/bldgtotkfmhoxmlzowdx\.supabase\.co\/storage\/v1\/object\/public\/cockpit-ad-stills\/(?:[a-f0-9]{64}\/)?[a-f0-9]{64}$/,
  );

const rowSchema = z.object({
  date: day,
  campaignName: z.string(),
  adSetName: text,
  adName: text,
  adId: text,
  spend: amount,
  leads: amount,
  impressions: amount,
  linkClicks: amount,
  frequency: maybe,
});

const readSchema = z.object({
  clientName: z.string(),
  start: day,
  end: day,
  statsAt: text,
  bookingsReady: z.boolean(),
  coverage: z.object({ first: day.nullable(), last: day.nullable() }),
  feedFirst: day.nullable(),
  // The last imported day, from 20261012d. Older reads lack it.
  feedLast: day.nullish().transform(v => v ?? undefined),
  campaigns: z.array(
    z.object({
      name: z.string().min(1),
      metaCampaignId: text,
      accountId: text,
      accountName: text,
      currency: text,
      budgetDaily: maybe,
      budgetLevel: text,
      ended: z
        .boolean()
        .nullish()
        .transform(v => Boolean(v)),
    }),
  ),
  adsets: z.array(
    z.object({
      id: text,
      name: text,
      campaignName: text,
      status: text,
      effectiveStatus: text,
    }),
  ),
  ads: z.array(
    z.object({
      id: text,
      name: text,
      adsetId: text,
      campaignName: text,
      status: text,
      effectiveStatus: text,
      accountId: text,
      creativeId: text,
      thumbUrl: text,
    }),
  ),
  rows: z.array(rowSchema),
  history: z.array(rowSchema),
  bookings: z
    .array(
      z.object({
        date: day,
        campaignName: z.string(),
        adId: text,
        status: z
          .string()
          .nullish()
          .transform(v => String(v ?? "").toLowerCase()),
        startTime: text,
        appointmentDate: text,
      }),
    )
    .nullable(),
  verdicts: z.array(
    z.object({
      adId: text,
      adName: text,
      campaignName: text,
      verdict: text,
      reason: text,
    }),
  ),
  stills: z.record(
    z.string(),
    z.object({
      url: nativeUrl,
      tinyUrl: nativeUrl.nullish().transform(v => v ?? undefined),
    }),
  ),
  changes: z.array(
    z.object({
      day,
      at: maybe,
      kind: text,
      action: text,
      actor: text,
      source: text,
      subject: text,
      evidence: text,
      link: text,
    }),
  ),
});

export type ClientAdsRead = z.infer<typeof readSchema>;
type Row = z.infer<typeof rowSchema>;
type Booking = NonNullable<ClientAdsRead["bookings"]>[number];

/** The days to read: never past today, never more than 400 at once. */
export function adsRange(from: string, to: string, today = kuwaitDay()) {
  const end = to > today ? today : to;
  const earliest = shiftDay(end, -(MAX_RANGE_DAYS - 1));
  const start = from < earliest ? earliest : from > end ? end : from;
  return { start, end };
}

export async function fetchClientAds(
  client: SupabaseClient,
  taskId: string,
  from: string,
  to: string,
): Promise<ClientAdsRead> {
  const { start, end } = adsRange(from, to);
  const { data, error } = await client.rpc("cockpit_csm_client_ads", {
    p_task_id: taskId,
    p_start: start,
    p_end: end,
  });
  if (error) throw new Error(error.message);
  const parsed = readSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "The ad numbers came back in a shape this page cannot read.",
    );
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The model.

export type Tone = "good" | "warn" | "bad" | "neutral";

export type Metrics = {
  spend: number;
  leads: number;
  impressions: number;
  linkClicks: number;
  /** The highest daily frequency, as the media buyer's table shows it. */
  frequency?: number;
  booked: number;
  attended: number;
  cpl?: number;
  cpb?: number;
  linkCtr?: number;
  cpm?: number;
};

type DayCell = { spend: number; leads: number; booked: number };

export type AdNode = {
  key: string;
  id?: string;
  name: string;
  campaign: string;
  setKey: string;
  statusText: string;
  tone: Tone;
  /** First and last day with spend, history included. */
  firstDay?: string;
  lastSpend?: string;
  accountId?: string;
  thumbUrl?: string;
  stillUrl?: string;
  stillTinyUrl?: string;
  verdict?: { label: string; tone: Tone; reason?: string };
  /** Spent, booked or brought a lead in the period. */
  active: boolean;
  /** In Meta's current list of the client's ads, so it still runs or can. */
  listed: boolean;
  t: Metrics;
  days: Map<string, DayCell>;
};

export type SetNode = {
  key: string;
  id?: string;
  name: string;
  campaign: string;
  statusText: string;
  tone: Tone;
  budgetText: string;
  firstDay?: string;
  active: boolean;
  ads: AdNode[];
  t: Metrics;
};

export type CampaignNode = {
  name: string;
  id?: string;
  accountId?: string;
  accountName?: string;
  currency: string;
  budgetText: string;
  ended: boolean;
  statusText: string;
  tone: Tone;
  firstDay?: string;
  active: boolean;
  sets: SetNode[];
  t: Metrics;
  /** Bookings in the period no tracked ad brought, by day. */
  unattributed: Map<string, number>;
  unattributedCount: number;
};

export type ChangeLevel = "ad" | "set" | "campaign" | "account";

export type ScopedChange = {
  day: string;
  at?: number;
  action: string;
  subject?: string;
  actor?: string;
  level: ChangeLevel;
  campaigns: string[];
  setKeys: string[];
  adKeys: string[];
};

export type AdsModel = {
  clientName: string;
  /** The period asked for, and the days the numbers cover inside it. */
  from: string;
  to: string;
  dataFrom: string;
  dataTo: string;
  /** The period starts before the first imported day. */
  cut: boolean;
  feedFirst?: string;
  campaigns: CampaignNode[];
  t: Metrics;
  /** One currency for every campaign, so client totals may add up. */
  currency?: string;
  unattributedCount: number;
  bookingsReady: boolean;
  changes: ScopedChange[];
  /**
   * Ads that spent in the period, no longer run, and have no saved picture.
   * Pictures are saved only for ads that run (Muhammed, 2026-10-12), so these
   * tiles stay blank and the page says so.
   */
  missingPictures: number;
};

const empty = (): Metrics => ({
  spend: 0,
  leads: 0,
  impressions: 0,
  linkClicks: 0,
  booked: 0,
  attended: 0,
});

function finish(m: Metrics): Metrics {
  const rateable = m.impressions >= MIN_IMPRESSIONS_FOR_RATES;
  return {
    ...m,
    cpl: m.leads > 0 ? m.spend / m.leads : undefined,
    cpb: m.booked > 0 && m.spend > 0 ? m.spend / m.booked : undefined,
    linkCtr: rateable ? (m.linkClicks / m.impressions) * 100 : undefined,
    cpm: rateable ? (m.spend / m.impressions) * 1000 : undefined,
  };
}

function add(into: Metrics, from: Metrics) {
  into.spend += from.spend;
  into.leads += from.leads;
  into.impressions += from.impressions;
  into.linkClicks += from.linkClicks;
  into.booked += from.booked;
  into.attended += from.attended;
  if (from.frequency !== undefined)
    into.frequency = Math.max(into.frequency ?? 0, from.frequency);
}

const SHOWN_ONCE_PAST = new Set(["confirmed", "invalid"]);

/** Aziz's rule: showed, or confirmed or invalid once the call's time has passed. */
export function attended(b: Booking, now: number): boolean {
  if (b.status === "showed") return true;
  if (!SHOWN_ONCE_PAST.has(b.status)) return false;
  if (b.startTime) {
    const at = Date.parse(b.startTime);
    if (Number.isFinite(at)) return at <= now;
  }
  return (
    Boolean(b.appointmentDate) && String(b.appointmentDate) < kuwaitDay(now)
  );
}

/** Lower case, only letters, digits and Arabic: how names are matched. */
export function normName(name?: string | null): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

const VERDICTS: Record<string, { label: string; tone: Tone }> = {
  scale: { label: "Scale", tone: "good" },
  hold: { label: "Hold", tone: "warn" },
  fatiguing: { label: "Fatiguing", tone: "warn" },
  kill: { label: "Kill", tone: "bad" },
  "no delivery": { label: "No delivery", tone: "neutral" },
};

/** Meta's delivery status, in words. */
export function metaStatus(status?: string): { text: string; tone: Tone } {
  const s = String(status ?? "").toUpperCase();
  if (s === "ACTIVE") return { text: "Active", tone: "good" };
  if (s === "PAUSED") return { text: "Paused", tone: "neutral" };
  if (s === "ADSET_PAUSED") return { text: "Ad set paused", tone: "neutral" };
  if (s === "CAMPAIGN_PAUSED")
    return { text: "Campaign paused", tone: "neutral" };
  if (s === "DISAPPROVED") return { text: "Rejected by Meta", tone: "bad" };
  if (s === "WITH_ISSUES") return { text: "Has issues in Meta", tone: "warn" };
  if (s === "PENDING_REVIEW" || s === "IN_PROCESS")
    return { text: "In review", tone: "neutral" };
  if (s === "ARCHIVED" || s === "DELETED")
    return { text: "Ended", tone: "neutral" };
  if (!s) return { text: "Status unknown", tone: "neutral" };
  const words = s.toLowerCase().replace(/_/g, " ");
  return {
    text: words.charAt(0).toUpperCase() + words.slice(1),
    tone: "neutral",
  };
}

export function money(
  v: number | undefined,
  currency = "USD",
  cents = false,
): string | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  const n = cents
    ? v.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : Math.round(v).toLocaleString("en-US");
  return currency === "USD" ? `$${n}` : `${currency} ${n}`;
}

function budgetText(
  c: ClientAdsRead["campaigns"][number] | undefined,
  currency: string,
) {
  const daily = money(c?.budgetDaily, currency);
  if (!daily) return "Budget not recorded";
  return c?.budgetLevel === "adset"
    ? `${daily} a day, set on its ad sets`
    : `${daily} a day`;
}

export function buildAdsModel(
  read: ClientAdsRead,
  period: { from: string; to: string },
  now = Date.now(),
): AdsModel {
  const today = kuwaitDay(now);
  const statsDay = read.statsAt
    ? kuwaitDay(Date.parse(read.statsAt))
    : read.end;
  const to = period.to > today ? today : period.to;
  // Statistics arrive through the day before the import, so a day after the
  // last imported one is not in yet: it ends the period, never a zero.
  const lastIn =
    read.feedLast && read.feedLast < statsDay ? read.feedLast : statsDay;
  const dataTo = lastIn < to ? lastIn : to;
  const feedFirst = read.feedFirst ?? undefined;
  const dataFrom = feedFirst && feedFirst > read.start ? feedFirst : read.start;
  const inPeriod = (d: string) => d >= dataFrom && d <= dataTo;

  const campaignOf = new Map(read.campaigns.map(c => [c.name, c]));
  const treeSet = new Map(
    read.adsets.filter(s => s.id).map(s => [String(s.id), s]),
  );
  const treeAd = new Map(
    read.ads.filter(a => a.id).map(a => [String(a.id), a]),
  );
  const verdictById = new Map(
    read.verdicts.filter(v => v.adId).map(v => [String(v.adId), v]),
  );
  const verdictByName = new Map(
    read.verdicts.map(v => [`${v.campaignName}|${normName(v.adName)}`, v]),
  );

  const ads = new Map<string, AdNode>();
  const latestSetName = new Map<string, { date: string; name: string }>();
  const keyFor = (campaign: string, id?: string, name?: string) =>
    id ? `id:${id}` : `name:${campaign}|${normName(name)}`;
  const adFor = (
    campaign: string,
    id: string | undefined,
    name: string | undefined,
  ) => {
    const key = keyFor(campaign, id, name);
    let a = ads.get(key);
    if (!a) {
      a = {
        key,
        id,
        name: name ?? (id ? `Ad ${id}` : "Unnamed ad"),
        campaign,
        setKey: "",
        statusText: "",
        tone: "neutral",
        active: false,
        listed: false,
        t: empty(),
        days: new Map(),
      };
      ads.set(key, a);
    }
    return a;
  };

  for (const r of [...read.history, ...read.rows] as Row[]) {
    const a = adFor(r.campaignName, r.adId, r.adName);
    if (r.adName) a.name = r.adName;
    if (r.adSetName) {
      const seen = latestSetName.get(a.key);
      if (!seen || r.date >= seen.date)
        latestSetName.set(a.key, { date: r.date, name: r.adSetName });
    }
    if (r.spend > 0) {
      if (!a.firstDay || r.date < a.firstDay) a.firstDay = r.date;
      if (!a.lastSpend || r.date > a.lastSpend) a.lastSpend = r.date;
    }
    const cell = a.days.get(r.date) ?? { spend: 0, leads: 0, booked: 0 };
    cell.spend += r.spend;
    cell.leads += r.leads;
    a.days.set(r.date, cell);
    if (!inPeriod(r.date)) continue;
    a.t.spend += r.spend;
    a.t.leads += r.leads;
    a.t.impressions += r.impressions;
    a.t.linkClicks += r.linkClicks;
    if (r.frequency !== undefined)
      a.t.frequency = Math.max(a.t.frequency ?? 0, r.frequency);
  }
  // Meta's tree names the ads that did not spend, and the ad set each is in.
  for (const t of read.ads) {
    if (!t.id || !t.campaignName) continue;
    const a = adFor(t.campaignName, t.id, t.name);
    if (t.name) a.name = t.name;
  }

  const campaigns = new Map<string, CampaignNode>();
  const campaignFor = (name: string) => {
    let c = campaigns.get(name);
    if (!c) {
      const src = campaignOf.get(name);
      const currency = src?.currency ?? "USD";
      c = {
        name,
        id: src?.metaCampaignId,
        accountId: src?.accountId,
        accountName: src?.accountName,
        currency,
        budgetText: budgetText(src, currency),
        ended: Boolean(src?.ended),
        statusText: "",
        tone: "neutral",
        active: false,
        sets: [],
        t: empty(),
        unattributed: new Map(),
        unattributedCount: 0,
      };
      campaigns.set(name, c);
    }
    return c;
  };
  for (const c of read.campaigns) campaignFor(c.name);

  const byId = new Map<string, AdNode>();
  for (const a of ads.values()) if (a.id) byId.set(a.id, a);
  const bookings = read.bookingsReady ? (read.bookings ?? []) : [];
  for (const b of bookings) {
    if (!inPeriod(b.date)) continue;
    const c = campaignFor(b.campaignName);
    const a = b.adId ? byId.get(b.adId) : undefined;
    const shown = attended(b, now);
    if (a && a.campaign === b.campaignName) {
      a.t.booked += 1;
      if (shown) a.t.attended += 1;
      const cell = a.days.get(b.date) ?? { spend: 0, leads: 0, booked: 0 };
      cell.booked += 1;
      a.days.set(b.date, cell);
    } else {
      c.unattributed.set(b.date, (c.unattributed.get(b.date) ?? 0) + 1);
      c.unattributedCount += 1;
      c.t.booked += 1;
      if (shown) c.t.attended += 1;
    }
  }

  // Each ad into its ad set: Meta's tree first, else the latest name on its rows.
  const sets = new Map<string, SetNode>();
  for (const a of ads.values()) {
    const tree = a.id ? treeAd.get(a.id) : undefined;
    const treeParent = tree?.adsetId ? treeSet.get(tree.adsetId) : undefined;
    const setName =
      treeParent?.name ?? latestSetName.get(a.key)?.name ?? "Ad set not named";
    const setKey = `${a.campaign}|${normName(setName)}`;
    a.setKey = setKey;
    a.accountId = tree?.accountId ?? campaignOf.get(a.campaign)?.accountId;
    a.thumbUrl = tree?.thumbUrl;
    a.listed = Boolean(tree);
    const still = a.id ? read.stills[a.id] : undefined;
    a.stillUrl = still?.url;
    a.stillTinyUrl = still?.tinyUrl;
    if (tree) {
      const s = metaStatus(tree.effectiveStatus ?? tree.status);
      a.statusText = s.text;
      a.tone = s.tone;
    } else {
      a.statusText = a.lastSpend
        ? `Not running, last spent ${dayLabel(a.lastSpend)}`
        : "Not running";
    }
    const v =
      (a.id ? verdictById.get(a.id) : undefined) ??
      verdictByName.get(`${a.campaign}|${normName(a.name)}`);
    const kind = v?.verdict ? VERDICTS[v.verdict.toLowerCase()] : undefined;
    if (kind && v)
      a.verdict = {
        ...kind,
        reason: v.reason ? plainText(v.reason) : undefined,
      };
    a.active = a.t.spend > 0 || a.t.leads > 0 || a.t.booked > 0;
    a.t = finish(a.t);
    let s = sets.get(setKey);
    if (!s) {
      const camp = campaignOf.get(a.campaign);
      const treeMatch =
        treeParent ??
        read.adsets.find(
          x =>
            x.campaignName === a.campaign &&
            normName(x.name) === normName(setName),
        );
      s = {
        key: setKey,
        id: treeMatch?.id,
        name: setName,
        campaign: a.campaign,
        statusText: "",
        tone: "neutral",
        budgetText:
          camp?.budgetLevel === "adset"
            ? "Has its own budget"
            : camp?.budgetLevel === "campaign"
              ? "Uses the campaign budget"
              : "",
        active: false,
        ads: [],
        t: empty(),
      };
      if (treeMatch) {
        const st = metaStatus(treeMatch.effectiveStatus ?? treeMatch.status);
        s.statusText = st.text;
        s.tone = st.tone;
      }
      sets.set(setKey, s);
    }
    s.ads.push(a);
    add(s.t, a.t);
    if (a.firstDay && (!s.firstDay || a.firstDay < s.firstDay))
      s.firstDay = a.firstDay;
  }
  for (const s of sets.values()) {
    s.active = s.ads.some(a => a.active);
    if (!s.statusText) {
      const live = s.ads.some(a => a.tone === "good");
      s.statusText = live ? "Active" : "Not running";
      s.tone = live ? "good" : "neutral";
    }
    s.t = finish(s.t);
    const c = campaignFor(s.campaign);
    c.sets.push(s);
    add(c.t, s.t);
    if (s.firstDay && (!c.firstDay || s.firstDay < c.firstDay))
      c.firstDay = s.firstDay;
  }

  const total = empty();
  const currencies = new Set<string>();
  for (const c of campaigns.values()) {
    c.active = c.sets.some(s => s.active) || c.unattributedCount > 0;
    const inTree = c.sets.some(s => s.id);
    if (c.ended) {
      c.statusText = "Ended";
      c.tone = "neutral";
    } else if (c.sets.some(s => s.ads.some(a => a.tone === "good"))) {
      c.statusText = "Active";
      c.tone = "good";
    } else {
      c.statusText = inTree ? "Paused" : "Status unknown";
      c.tone = "neutral";
    }
    c.t = finish(c.t);
    if (c.active || !c.ended) currencies.add(c.currency);
    add(total, c.t);
  }
  const currency =
    currencies.size <= 1 ? ([...currencies][0] ?? "USD") : undefined;

  const list = [...campaigns.values()];
  const model: AdsModel = {
    clientName: read.clientName,
    from: period.from,
    to,
    dataFrom,
    dataTo,
    cut: dataFrom > period.from,
    feedFirst,
    campaigns: list,
    t: finish(total),
    currency,
    unattributedCount: list.reduce((n, c) => n + c.unattributedCount, 0),
    bookingsReady: read.bookingsReady,
    changes: [],
    missingPictures: list
      .flatMap(c => c.sets.flatMap(s => s.ads))
      .filter(
        a =>
          a.active &&
          !a.listed &&
          !a.stillUrl &&
          !a.stillTinyUrl &&
          !a.thumbUrl,
      ).length,
  };
  model.changes = mapChanges(read.changes, model);
  return model;
}

// ---------------------------------------------------------------------------
// Changes: which campaign, ad set or ad each one touched.

/** The level a change's kind names: update_ad_set_budget is an ad set's. */
function hintOf(kind?: string): ChangeLevel {
  const k = String(kind ?? "").toLowerCase();
  if (/ad_?set/.test(k)) return "set";
  if (/campaign/.test(k)) return "campaign";
  if (/(^|_)ads?(_|$)/.test(k)) return "ad";
  return "account";
}

/**
 * Each change is matched by its subject's name within this client's tree,
 * trying the level its kind names first (Meta sometimes files an ad set's
 * change under the campaign). A change that matches nothing is the account's:
 * it shows under All campaigns only.
 */
export function mapChanges(
  changes: ClientAdsRead["changes"],
  model: Pick<AdsModel, "campaigns">,
): ScopedChange[] {
  const index = {
    campaign: new Map<string, CampaignNode[]>(),
    set: new Map<string, SetNode[]>(),
    ad: new Map<string, AdNode[]>(),
  };
  const put = <T>(m: Map<string, T[]>, name: string, v: T) => {
    const k = normName(name);
    if (k) m.set(k, [...(m.get(k) ?? []), v]);
  };
  for (const c of model.campaigns) {
    put(index.campaign, c.name, c);
    for (const s of c.sets) {
      put(index.set, s.name, s);
      for (const a of s.ads) put(index.ad, a.name, a);
    }
  }
  return changes
    .map(ch => {
      const hint = hintOf(ch.kind);
      const order: Exclude<ChangeLevel, "account">[] =
        hint === "account"
          ? ["set", "ad", "campaign"]
          : [
              hint,
              ...(["set", "ad", "campaign"] as const).filter(l => l !== hint),
            ];
      const names = [ch.subject, ch.evidence].map(normName).filter(Boolean);
      const out: ScopedChange = {
        day: ch.day,
        at: ch.at,
        action: plainText(ch.action ?? displayKind(ch.kind)),
        subject: ch.subject ? plainText(ch.subject) : undefined,
        actor: ch.actor,
        level: "account",
        campaigns: [],
        setKeys: [],
        adKeys: [],
      };
      for (const level of order) {
        const found = index[level] as Map<
          string,
          (AdNode | SetNode | CampaignNode)[]
        >;
        const hits = names.flatMap(n => found.get(n) ?? []);
        if (!hits.length) continue;
        out.level = level;
        if (level === "campaign")
          out.campaigns = [...new Set(hits.map(h => (h as CampaignNode).name))];
        if (level === "set") {
          out.setKeys = [...new Set(hits.map(h => (h as SetNode).key))];
          out.campaigns = [...new Set(hits.map(h => (h as SetNode).campaign))];
        }
        if (level === "ad") {
          out.adKeys = [...new Set(hits.map(h => (h as AdNode).key))];
          out.setKeys = [...new Set(hits.map(h => (h as AdNode).setKey))];
          out.campaigns = [...new Set(hits.map(h => (h as AdNode).campaign))];
        }
        break;
      }
      return out;
    })
    .sort((x, y) =>
      x.day === y.day ? (x.at ?? 0) - (y.at ?? 0) : x.day < y.day ? -1 : 1,
    );
}

function displayKind(kind?: string) {
  const words = String(kind ?? "Change").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// The one chart: a scope, a measure, and the changes on it.

export type Scope =
  | { level: "all" }
  | { level: "campaign"; campaign: string }
  | { level: "set"; campaign: string; set: string }
  | { level: "ad"; campaign: string; set: string; ad: string };

export type Measure = "leads" | "spend" | "cpl" | "booked";

export function sameScope(a: Scope, b: Scope): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function findScope(model: AdsModel, scope: Scope) {
  if (scope.level === "all") return {};
  const campaign = model.campaigns.find(c => c.name === scope.campaign);
  const set =
    scope.level === "campaign"
      ? undefined
      : campaign?.sets.find(s => s.key === scope.set);
  const ad =
    scope.level === "ad" ? set?.ads.find(a => a.key === scope.ad) : undefined;
  return { campaign, set, ad };
}

/** A scope that no longer exists (a new period) falls back to all campaigns. */
export function validScope(model: AdsModel, scope: Scope): Scope {
  if (scope.level === "all") return scope;
  const f = findScope(model, scope);
  if (!f.campaign) return { level: "all" };
  if (scope.level === "set" && !f.set)
    return { level: "campaign", campaign: scope.campaign };
  if (scope.level === "ad" && !f.ad)
    return f.set
      ? { level: "set", campaign: scope.campaign, set: scope.set }
      : { level: "campaign", campaign: scope.campaign };
  return scope;
}

export function scopeAds(model: AdsModel, scope: Scope): AdNode[] {
  const all = model.campaigns.flatMap(c => c.sets.flatMap(s => s.ads));
  if (scope.level === "all") return all;
  if (scope.level === "campaign")
    return all.filter(a => a.campaign === scope.campaign);
  if (scope.level === "set") return all.filter(a => a.setKey === scope.set);
  return all.filter(a => a.key === scope.ad);
}

export function scopeName(model: AdsModel, scope: Scope): string {
  if (scope.level === "all") return "All campaigns";
  const f = findScope(model, scope);
  if (scope.level === "campaign") return scope.campaign;
  if (scope.level === "set")
    return `Ad set ${f.set?.name ?? ""}, in ${scope.campaign}`;
  return `Ad ${f.ad?.name ?? ""}, in ${f.set?.name ?? scope.campaign}`;
}

/** The totals for what the chart shows. */
export function scopeTotals(model: AdsModel, scope: Scope): Metrics {
  const f = findScope(model, scope);
  if (scope.level === "all") return model.t;
  if (scope.level === "campaign") return f.campaign?.t ?? finish(empty());
  if (scope.level === "set") return f.set?.t ?? finish(empty());
  return f.ad?.t ?? finish(empty());
}

/** The changes that touch what the chart shows, numbered in date order. */
export function scopeChanges(
  model: AdsModel,
  scope: Scope,
): (ScopedChange & { n: number })[] {
  const f = findScope(model, scope);
  const since = f.ad?.firstDay ?? f.set?.firstDay;
  return model.changes
    .filter(ch => ch.day >= model.dataFrom && ch.day <= model.dataTo)
    .filter(ch => {
      if (scope.level === "all") return true;
      if (!ch.campaigns.includes(scope.campaign)) return false;
      if (scope.level === "campaign") return true;
      // An ad set or an ad also shows what changed above it, once it ran.
      const above = !since || ch.day >= since;
      if (scope.level === "set")
        return (
          ch.setKeys.includes(scope.set) || (ch.level === "campaign" && above)
        );
      return (
        ch.adKeys.includes(scope.ad) ||
        (ch.level === "set" && ch.setKeys.includes(scope.set) && above) ||
        (ch.level === "campaign" && above)
      );
    })
    .map((ch, i) => ({ ...ch, n: i + 1 }));
}

export type Bucket = { key: string; days: string[]; label: string };

export function bucketsFor(
  from: string,
  to: string,
): { weekly: boolean; list: Bucket[] } {
  if (from > to) return { weekly: false, list: [] };
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);
  if (days.length <= WEEKLY_AFTER_DAYS)
    return {
      weekly: false,
      list: days.map(d => ({ key: d, days: [d], label: dayLabel(d) })),
    };
  const weeks = new Map<string, Bucket>();
  for (const d of days) {
    const weekday = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = shiftDay(d, -weekday);
    const w =
      weeks.get(monday) ??
      weeks
        .set(monday, {
          key: monday,
          days: [],
          label: `Week of ${dayLabel(monday < from ? from : monday)}`,
        })
        .get(monday);
    w?.days.push(d);
  }
  return { weekly: true, list: [...weeks.values()] };
}

export type ChartPoint = {
  key: string;
  label: string;
  y: number | null;
  spend: number;
  leads: number;
  booked: number;
  changes: (ScopedChange & { n: number })[];
};

export function chartSeries(model: AdsModel, scope: Scope, measure: Measure) {
  const ads = scopeAds(model, scope);
  const camps =
    scope.level === "all"
      ? model.campaigns
      : scope.level === "campaign"
        ? model.campaigns.filter(c => c.name === scope.campaign)
        : [];
  const sum = (days: string[]) => {
    const t = { spend: 0, leads: 0, booked: 0 };
    for (const a of ads)
      for (const d of days) {
        const cell = a.days.get(d);
        if (!cell) continue;
        t.spend += cell.spend;
        t.leads += cell.leads;
        t.booked += cell.booked;
      }
    // Bookings no ad brought belong to the campaign, so they count at
    // campaign level and above only.
    for (const c of camps)
      for (const d of days) t.booked += c.unattributed.get(d) ?? 0;
    return t;
  };
  const bk = bucketsFor(model.dataFrom, model.dataTo);
  const changes = scopeChanges(model, scope);
  const first = model.feedFirst ?? model.dataFrom;
  const points: ChartPoint[] = bk.list.map(b => {
    const t = sum(b.days);
    let y: number | null;
    if (measure === "leads") y = t.leads;
    else if (measure === "spend") y = Math.round(t.spend * 100) / 100;
    else if (measure === "booked") y = t.booked;
    else {
      // One lead swings a single day's cost per lead, so each day shows the
      // 7 days up to it; a week shows its own.
      const window: string[] = [];
      if (bk.weekly) window.push(...b.days);
      else
        for (let d = shiftDay(b.key, -6); d <= b.key; d = shiftDay(d, 1))
          if (d >= first) window.push(d);
      const w = bk.weekly ? t : sum(window);
      y = w.leads > 0 ? w.spend / w.leads : null;
    }
    return {
      key: b.key,
      label: b.label,
      y,
      ...t,
      changes: changes.filter(ch => b.days.includes(ch.day)),
    };
  });
  return { weekly: bk.weekly, points, changes };
}

// ---------------------------------------------------------------------------
// Ads Manager.

const AM = "https://adsmanager.facebook.com/adsmanager/manage";
const act = (accountId?: string) =>
  accountId ? `act=${encodeURIComponent(accountId.replace(/^act_/, ""))}&` : "";

export function campaignUrl(c: Pick<CampaignNode, "id" | "accountId">) {
  if (!c.id)
    return c.accountId
      ? `${AM}/campaigns?${act(c.accountId).slice(0, -1)}`
      : undefined;
  return `${AM}/campaigns?${act(c.accountId)}selected_campaign_ids=${encodeURIComponent(c.id)}`;
}

/** An ad set Meta no longer lists opens its campaign's ad sets. */
export function adSetUrl(
  s: Pick<SetNode, "id">,
  c: Pick<CampaignNode, "id" | "accountId">,
) {
  if (s.id)
    return `${AM}/adsets?${act(c.accountId)}selected_adset_ids=${encodeURIComponent(s.id)}`;
  if (c.id)
    return `${AM}/adsets?${act(c.accountId)}selected_campaign_ids=${encodeURIComponent(c.id)}`;
  return undefined;
}

export function adUrl(a: Pick<AdNode, "id" | "accountId">) {
  if (!a.id) return undefined;
  return `${AM}/ads?${act(a.accountId)}selected_ad_ids=${encodeURIComponent(a.id)}`;
}

export const SORTS: Record<Measure, (x: AdNode, y: AdNode) => number> = {
  spend: (x, y) => y.t.spend - x.t.spend,
  leads: (x, y) => y.t.leads - x.t.leads,
  cpl: (x, y) =>
    (x.t.cpl ?? Number.POSITIVE_INFINITY) -
    (y.t.cpl ?? Number.POSITIVE_INFINITY),
  booked: (x, y) => y.t.booked - x.t.booked,
};
