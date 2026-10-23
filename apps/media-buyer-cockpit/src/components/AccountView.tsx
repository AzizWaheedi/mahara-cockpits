import "@/components/ceo/ceo.css";
import { ArrowUpRight, ChevronLeft, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AppointmentFeedback } from "@/components/AppointmentFeedback";
import {
  CallCentreSection,
  CallerLine,
  useCallsHoldLost,
} from "@/components/CallCentreSection";
import { CreativePreview } from "@/components/CreativePreview";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, shortDate } from "@/components/ceo/format";
import { StatTile } from "@/components/ceo/StatTile";
import {
  STATUS_COLOR,
  StatusChip,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { LostLeads } from "@/components/LostLeads";
import { LeadPageSection } from "@/components/pageform/LeadPageSection";
import { RangePicker } from "@/components/RangePicker";
import { RequestCreativeButton } from "@/components/RequestCreativeButton";
import {
  type SavedState,
  SaveWinnerButton,
} from "@/components/SaveWinnerButton";
import {
  SECTION_OFFSET,
  SectionNav,
  type SectionNavPart,
} from "@/components/SectionNav";
import { StatusToggle } from "@/components/StatusToggle";
import { TrendChart } from "@/components/TrendChart";
import { Button } from "@/components/ui/button";
import { accountIssueFlag, metaBillingUrl } from "@/lib/adBillingStrip";
import { callCentreKey } from "@/lib/callCentreClient";
import {
  accountKey,
  type ClientRangeRead,
  campaignsNotListed,
  clientCpb,
  clientPagePlan,
  clientRangeNotes,
  countedLine,
} from "@/lib/clientRange";
import { api, useQueries, useQuery, useQueryState } from "@/lib/cockpitApi";
import {
  COST_DOT,
  type CostTone,
  cpbDisplay,
  cpbValue,
  cplTone,
  spendNotInWhy,
} from "@/lib/costTone";
import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from "@/lib/kpi";
import { everyBookingPlaced, pairedDay } from "@/lib/mediaStatsClient";
import { usePageForms } from "@/lib/pageFormClient";
import { kuwaitDay, type Range } from "@/lib/range";
import { cn } from "@/lib/utils";
import { LeadSyncPanel } from "./LeadSync";

/**
 * One client on a page of its own: everything the Ads management table can
 * do for its campaigns, and more to see.
 *
 * Aziz, 2026-09-27: "When I open up the account itself on a specific page
 * all by itself, I want to have as many, if not more, details, and the
 * previews should all show for that account ... do all of the other actions
 * like I would have been able to in the table view ... and I should be able
 * to look at the time frame in whatever time I want."
 *
 * So one range drives the whole page: the account's numbers and daily
 * trends, every ad with its picture and its numbers (the wall), and each
 * campaign in full through the table's own panel. The ads, the campaigns and
 * the daily charts are the range table's (`stats.range`, one read per
 * campaign, shared with the open panel's own read). The client's totals are
 * its own read (`stats.clientRange`, clientRange.ts, 2026-10-22): Mahara's
 * campaigns on its ad accounts, stopped ones included, with the board's
 * confirmed bookings, so a campaign removed from the list no longer drops
 * out of them. When that read fails, the campaigns listed are summed and the
 * page says so.
 */
type Row = any;

type RangeRow = {
  key: string;
  adIds?: string[];
  spend: number;
  leads: number;
  cpl?: number;
  bookings: number;
  costPerBooking?: number;
  bookingRate?: number;
  linkCtr?: number;
  frequency?: number;
  bookingsAttributed: boolean;
};

/** Below these, rates are noise (the same floors as stats.ts). */
const MIN_IMPRESSIONS = 1000;
const MIN_LINK_CLICKS = 50;
/** An ad needs this many leads before its cost per lead can be the best. */
const BEST_MIN_LEADS = 3;
/** Cards shown before "Show all". */
const WALL_PAGE = 48;
/** Why an ad tile reads n/a: on hover, since the wall says it once. */
const FAILED_READ =
  "This campaign's numbers could not be read. Reload to try again.";

const VERDICT_TONE: Record<string, StatusTone> = {
  scale: "good",
  hold: "warning",
  kill: "serious",
  fatiguing: "warning",
  "off board": "serious",
  "below KPI": "warning",
};

const sentence = (s: unknown) => {
  const t = String(s ?? "");
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

const isLive = (n: Row) => (n?.effectiveStatus ?? n?.status) === "ACTIVE";

/** Meta's CAMPAIGN_PAUSED as words. */
const metaWords = (n: Row) => {
  const s = n?.effectiveStatus ?? n?.status;
  return s ? sentence(String(s).toLowerCase().replace(/_/g, " ")) : "";
};

const usd2 = (n: number | undefined) =>
  n === undefined || Number.isNaN(n)
    ? "n/a"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pctText = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "n/a" : `${n.toFixed(2)}%`;

/**
 * "3 booked at $75", "None booked yet", or "None booked on $233": a
 * campaign's bookings in its line on a client's page (2026-10-21). A range
 * after the media data's last day keeps its real count with no cost:
 * "2 booked" (2026-10-22).
 */
function bookedFacts(
  spend: number,
  booked: number,
  cost?: number,
  spendNotIn?: string,
): string {
  const shown = cpbDisplay(spend, booked, { cost, spendNotIn });
  if (booked > 0)
    return shown.text === "n/a"
      ? `${booked} booked`
      : `${booked} booked at ${shown.text}`;
  return shown.noneOnSpend
    ? `None booked on ${money(spend)}`
    : "None booked yet";
}

/** One read per campaign over the range, keyed by campaign name. */
function byCampaign(
  reads: string,
  query: typeof api.stats.range | typeof api.stats.campaignTrend,
) {
  const [names, start, end] = JSON.parse(reads) as [string[], string, string];
  return Object.fromEntries(
    names.map(campaignName => [
      campaignName,
      { query, args: { campaignName, start, end } },
    ]),
  );
}

type AdCard = {
  key: string;
  campaign: Row;
  name: string;
  /** Its numbers over the range; absent when it did not spend in it. */
  row?: RangeRow;
  /** Its campaign's numbers could not be read: n/a, never $0 and 0. */
  failed: boolean;
  /**
   * Every booking in its campaign's range was credited to one of its ads, so
   * an ad with none really has none.
   */
  allTraced: boolean;
  /**
   * The media data's last day, when the whole range comes after it: the
   * ad's spend and leads are not in yet, so they read n/a, never $0.00 and 0.
   */
  spendNotIn?: string;
  /** The Meta tree nodes behind this name (several ads can share one). */
  nodes: Row[];
  ids: string[];
  running: boolean;
  verdict?: string;
  picture: {
    metaAdId?: string;
    accountId?: string;
    stillUrl?: string;
    stillTinyUrl?: string;
    thumbUrl?: string;
  };
};

export function AccountView({
  client,
  clientTaskId,
  campaigns,
  tree,
  verdicts,
  range,
  onRangeChange,
  selected,
  onSelect,
  renderPanel,
  onClose,
  accountIds,
}: {
  client: string;
  clientTaskId?: string;
  /** The client's campaigns from the snapshot, running and off. */
  campaigns: Row[];
  /**
   * The ad accounts the page was opened with (`?adAccounts=`): a client with
   * no campaign listed reads its own numbers by them, on any range.
   */
  accountIds?: string[];
  /** Meta's tree for those campaigns: ad sets and ads, with their pictures. */
  tree: Row[];
  /** The 7-day call per ad (the snapshot's `ads` rows). */
  verdicts: Row[];
  range: Range;
  onRangeChange: (r: Range) => void;
  /** The campaign shown in full under the list. */
  selected: string | null;
  onSelect: (campaignName: string) => void;
  /** The table's own campaign panel, so every action is here too. */
  renderPanel: (c: Row) => ReactNode;
  onClose: () => void;
}) {
  const names = campaigns.map(c => String(c.campaignName));
  // useQueries keys its subscription on the identity of the object it gets.
  // A new object on every render resubscribes and sets state during render,
  // forever: React error #301 when this page first shipped (2026-09-27). So
  // one object per set of campaigns and range, rebuilt only when they change.
  const reads = JSON.stringify([names, range.start, range.end]);
  const rangeQueries = useMemo(
    () => byCampaign(reads, api.stats.range),
    [reads],
  );
  const trendQueries = useMemo(
    () => byCampaign(reads, api.stats.campaignTrend),
    [reads],
  );
  const ranges = useQueries(rangeQueries) as Record<string, Row>;
  const trends = useQueries(trendQueries) as Record<string, Row>;
  const coverage = useQuery(api.stats.coverage, {});
  // The client's own totals over the range, read by its ad accounts: its
  // campaigns', else the ones the page was opened with (a client with no
  // campaign listed), else found by its name (R8, 2026-10-22).
  const listedAccounts = [
    ...new Set(campaigns.map(c => accountKey(c.metaAccountId)).filter(Boolean)),
  ].sort();
  const accounts =
    listedAccounts.length > 0 ? listedAccounts : (accountIds ?? []);
  const clientRead = useQueryState<ClientRangeRead>(api.stats.clientRange, {
    start: range.start,
    end: range.end,
    accounts: accounts.length > 0 ? accounts : null,
  });
  // Whose figures the totals are (clientPagePlan): the client's own read
  // when it counts the range; the campaigns listed, summed, with the reason,
  // when it fails, counts no day of the range (Today before the nightly
  // pull), or starts later than a range that has campaigns listed (before
  // 24 Sep 2026), since the charts, the ads and the campaign rows cover the
  // whole range.
  const plan = clientPagePlan({
    read: clientRead.data,
    failed: Boolean(clientRead.error),
    name: client,
    accounts,
    listed: campaigns.length,
    start: range.start,
    end: range.end,
  });
  const clientRow = plan.row;
  const whole = plan.whole;
  const clientPending = clientRead.data === undefined && !clientRead.error;

  const results = names.map(n => ranges[n]);
  const loading = results.some(r => r === undefined);
  const failed = names.filter(n => ranges[n] instanceof Error);
  const read = (n: string) =>
    ranges[n] && !(ranges[n] instanceof Error) ? ranges[n] : undefined;
  const leadsOnly =
    campaigns.length > 0
      ? campaigns.every(c => c.serviceMode === "DWY")
      : clientRow?.serviceMode === "DWY";

  // The account over the range: the campaigns' own totals, summed, and the
  // rates worked out again from the sums rather than averaged.
  const sum = {
    spend: 0,
    leads: 0,
    impressions: 0,
    linkClicks: 0,
    bookings: 0,
    hasData: false,
  };
  for (const n of names) {
    const r = read(n);
    if (!r) continue;
    sum.hasData ||= Boolean(r.hasData);
    sum.spend += Number(r.total?.spend ?? 0);
    sum.leads += Number(r.total?.leads ?? 0);
    sum.impressions += Number(r.total?.impressions ?? 0);
    sum.linkClicks += Number(r.total?.linkClicks ?? 0);
    sum.bookings += Number(r.bookingsTotal ?? r.total?.bookings ?? 0);
  }
  // The media data's last day when the whole range comes after it (Today):
  // every campaign's read names the same day (mediaStatsClient.ts).
  const spendNotIn = names
    .map(n => read(n)?.spendNotIn as string | undefined)
    .find(Boolean);
  // The page's totals: the client's own when its read has them, else the
  // campaigns listed here, summed. A figure the client read could not know
  // is null and reads n/a with its reason, never 0.
  const total: {
    spend: number | null;
    leads: number | null;
    bookings: number | null;
    cost?: number | null;
    hasData: boolean;
  } = whole
    ? {
        spend: whole.spend,
        leads: whole.leads,
        bookings: whole.bookings,
        cost: whole.costPerBooking,
        hasData:
          (whole.spend ?? 0) > 0 ||
          (whole.leads ?? 0) > 0 ||
          (whole.bookings ?? 0) > 0,
      }
    : {
        spend: sum.spend,
        leads: sum.leads,
        bookings: sum.bookings,
        cost:
          sum.bookings > 0 && sum.spend > 0
            ? sum.spend / sum.bookings
            : undefined,
        hasData: sum.hasData,
      };
  const cpl =
    total.spend !== null && total.leads !== null && total.leads > 0
      ? total.spend / total.leads
      : undefined;
  // No booking on more than $60 reads "None on $233" with the grid's chip,
  // not a grey n/a (2026-10-21).
  // The client's own read can know bookings and spend and still have no cost
  // for them (clientCpb): n/a with its reason, never the two divided.
  const cpbShown = whole
    ? clientCpb(whole)
    : cpbDisplay(total.spend, total.bookings, {
        cost: total.cost,
        spendNotIn,
      });
  const bookingRate =
    total.bookings !== null && total.leads !== null && total.leads > 0
      ? (total.bookings / total.leads) * 100
      : undefined;
  // The rates need impressions and clicks, which only the campaigns' own
  // reads carry: they are the campaigns listed here.
  const rateable = sum.impressions >= MIN_IMPRESSIONS;
  const linkCtr = rateable
    ? (sum.linkClicks / sum.impressions) * 100
    : undefined;
  const cpm = rateable ? (sum.spend / sum.impressions) * 1000 : undefined;
  const optIn =
    sum.linkClicks >= MIN_LINK_CLICKS
      ? (sum.leads / sum.linkClicks) * 100
      : undefined;

  const byDate = new Map<string, { spend: number; leads: number }>();
  for (const n of names) {
    const rows = trends[n];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const d = byDate.get(r.date) ?? { spend: 0, leads: 0 };
      d.spend += Number(r.spend ?? 0);
      d.leads += Number(r.leads ?? 0);
      byDate.set(r.date, d);
    }
  }
  const trend = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, d]) => ({
      date,
      spend: Math.round(d.spend * 100) / 100,
      leads: d.leads,
      cpl: d.leads ? Math.round((d.spend / d.leads) * 100) / 100 : null,
    }));
  const pts = (k: "spend" | "leads" | "cpl") =>
    trend.map(r => ({ x: r.date, y: r[k] ?? null }));

  // Every ad in the account: the ones that spent in the range with their
  // numbers, then every other ad Meta has, at $0. When a campaign's read
  // failed its ads show n/a with the reason, never $0 and 0.
  const cards: AdCard[] = [];
  {
    const out = cards;
    for (const c of campaigns) {
      const name = String(c.campaignName);
      const failedRead = ranges[name] instanceof Error;
      const rows: RangeRow[] = read(name)?.ads ?? [];
      const whole = read(name);
      // Every booking was credited to one of the ads listed, not only given
      // an ad id: an id that maps to no row leaves its booking unplaced.
      const allTraced = everyBookingPlaced(whole);
      const cardSpendNotIn =
        typeof whole?.spendNotIn === "string" ? whole.spendNotIn : undefined;
      const nodes = tree.filter(
        (t: Row) => t.kind === "ad" && t.campaignName === name,
      );
      const used = new Set<string>();
      const verdictOf = (adName: string) =>
        verdicts.find(
          (a: Row) => a.campaignName === name && a.adName === adName,
        );
      const make = (key: string, adName: string, row?: RangeRow) => {
        const byId = (row?.adIds ?? [])
          .map(id => nodes.find((n: Row) => n.metaId === id))
          .filter(Boolean);
        const mine = row
          ? byId.length > 0
            ? byId
            : nodes.filter((n: Row) => n.name === adName)
          : nodes.filter((n: Row) => n.name === adName && !used.has(n._id));
        for (const n of mine) used.add(n._id);
        const ids = row?.adIds?.length
          ? row.adIds
          : mine.map((n: Row) => String(n.metaId)).filter(Boolean);
        const node =
          mine.find((n: Row) => n.stillUrl || n.stillTinyUrl) ?? mine[0];
        // The snapshot's ads row carries a picture too; it is trusted only
        // when it is the same ad.
        const snapAd = verdictOf(adName);
        const metaAdId: string | undefined = node?.metaId ?? ids[0];
        const same =
          snapAd &&
          (!snapAd.metaAdId || !metaAdId || snapAd.metaAdId === metaAdId);
        out.push({
          key,
          campaign: c,
          name: adName,
          row,
          failed: !row && failedRead,
          allTraced,
          spendNotIn: cardSpendNotIn,
          nodes: mine,
          ids,
          running: mine.some(isLive),
          verdict: snapAd?.verdict,
          picture: {
            metaAdId: metaAdId ?? snapAd?.metaAdId,
            accountId: node?.accountId ?? c.metaAccountId ?? undefined,
            stillUrl: node?.stillUrl ?? (same ? snapAd?.stillUrl : undefined),
            stillTinyUrl:
              node?.stillTinyUrl ?? (same ? snapAd?.stillTinyUrl : undefined),
            thumbUrl:
              (same ? snapAd?.thumbnailUrl : undefined) ?? node?.thumbUrl,
          },
        });
      };
      for (const r of rows) make(`${name}\u0000${r.key}`, r.key, r);
      const quiet = [
        ...new Set(
          nodes
            .filter((n: Row) => !used.has(n._id))
            .map((n: Row) => String(n.name)),
        ),
      ];
      for (const adName of quiet)
        make(`${name}\u0000${adName}\u0000quiet`, adName);
    }
    out.sort((a, b) => (b.row?.spend ?? 0) - (a.row?.spend ?? 0));
  }

  // The one ad the page points at: the cheapest lead with enough of them.
  const best = cards
    .filter(
      c => (c.row?.leads ?? 0) >= BEST_MIN_LEADS && c.row?.cpl !== undefined,
    )
    .sort((a, b) => (a.row?.cpl ?? 0) - (b.row?.cpl ?? 0))[0]?.key;

  const allIds = [...new Set(cards.flatMap(c => c.ids))].sort().slice(0, 300);
  const savedIn = useQuery(
    api.winnerSaves.savedIn,
    allIds.length > 0 ? { adIds: allIds } : "skip",
  ) as Record<string, SavedState> | undefined;

  const [show, setShow] = useState<"all" | "running" | "off">("all");
  const [more, setMore] = useState(false);
  const [openAd, setOpenAd] = useState<string | null>(null);
  const counts = {
    all: cards.length,
    running: cards.filter(c => c.running).length,
    off: cards.filter(c => !c.running).length,
  };
  const shown = cards.filter(c =>
    show === "all" ? true : show === "running" ? c.running : !c.running,
  );
  const visible = more ? shown : shown.slice(0, WALL_PAGE);

  // Campaigns, biggest spender first; the open one defaults to the first.
  const ordered = [...campaigns].sort(
    (a, b) => Number(b.spend7d ?? 0) - Number(a.spend7d ?? 0),
  );
  const current =
    ordered.find(c => c.campaignName === selected) ?? ordered[0] ?? null;
  const panelRef = useRef<HTMLElement>(null);
  const picked = useRef(false);
  // Opened from anywhere down the table, the page starts at its top.
  useEffect(() => {
    if (client) window.scrollTo({ top: 0 });
  }, [client]);
  useEffect(() => {
    if (!picked.current || !current) return;
    picked.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRef.current?.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "start",
    });
  }, [current]);

  // Campaigns in the client's read that are no longer listed here: stopped,
  // with spend, leads or bookings in the range. Their numbers are in the
  // totals; they are listed under Campaigns without a panel.
  const notListed = campaignsNotListed(whole, names);
  const liveCampaigns = campaigns.filter(c =>
    tree.some(
      (t: Row) =>
        t.campaignName === c.campaignName && t.kind === "ad" && isLive(t),
    ),
  ).length;
  const multi = campaigns.length > 1;
  // Bookings come from one HighLevel read per client, so any campaign carries them.
  const lost = campaigns.find(c => c.lost)?.lost;
  // The client's calls are read by its ad account (CallCentreSection); a
  // client with no campaign listed by the accounts its own read names.
  const callsKey = callCentreKey(
    campaigns.length > 0
      ? campaigns
      : (clientRow?.accounts ?? accounts).map(a => ({ metaAccountId: a })),
  );
  // One lost breakdown per client: for a client we call, the Calls part's
  // "Why leads were lost" (the dialer's outcomes, with the calls to play)
  // stands in for the lost pipeline; done-with-you clients keep the pipeline.
  const callsHoldLost = useCallsHoldLost(callsKey, range, leadsOnly);
  // The client's own lead page (Merge Studio first): shown when there is one,
  // or when the read failed, so a failure is never read as "no page".
  const pageForms = usePageForms(client);
  const showLeadPage = Boolean(pageForms.error || pageForms.data?.length);
  // The contents bar: one pill per card, in page order. Lost leads and the
  // open campaign show only when the page has them.
  const parts: SectionNavPart[] = [
    { id: "account-numbers", label: "Numbers" },
    { id: "account-feedback", label: "Client feedback" },
    ...(lost?.total && !callsHoldLost
      ? [{ id: "account-lost", label: "Lost leads", count: lost.total }]
      : []),
    { id: "calls", label: "Calls" },
    { id: "account-ads", label: "Ads", count: cards.length },
    {
      id: "account-campaigns",
      label: "Campaigns",
      count: campaigns.length + notListed.length,
    },
    ...(current
      ? [{ id: "account-campaign", label: String(current.campaignName) }]
      : []),
    ...(showLeadPage ? [{ id: "lead-page", label: "Lead page" }] : []),
  ];
  // The last day every account's spend is in (pairedDay): before the
  // tracker sheet fills, it is behind yesterday, and the page says so.
  const paired = pairedDay(coverage);
  const behind = Boolean(paired && paired < kuwaitDay(1) && range.end > paired);
  // Spend, leads and bookings stop on that day when the range runs past it
  // (mediaStatsClient.ts, 2026-10-21 and 2026-10-22); every campaign's read
  // and the client's own read name the same day.
  const bookingsThrough = whole
    ? plan.countedTo
    : names
        .map(n => read(n)?.bookingsThrough as string | undefined)
        .find(Boolean);

  const tile = (
    label: string,
    value: string,
    extra: {
      sub?: string;
      status?: ReactNode;
      hint?: string;
      naHint?: string;
    } = {},
  ) => (
    <StatTile
      key={label}
      variant="plain"
      className="rounded-xl bg-muted/40 p-3"
      label={label}
      value={value === "n/a" ? null : value}
      sub={extra.sub}
      status={extra.status}
      hint={extra.hint}
      naHint={extra.naHint}
    />
  );
  const fewImpressions =
    "Fewer than 1,000 impressions in this range, so the rate would be noise.";
  // The rates come from the campaigns listed: say so when the totals beside
  // them hold more (a stopped campaign), and why they are n/a with none.
  const ratesNote =
    whole && notListed.length > 0
      ? "Link CTR, CPM and opt-in rate are the campaigns listed here: a stopped campaign's impressions and clicks are not read."
      : "";
  const noRates =
    names.length === 0
      ? "No campaign of this client is listed now, so its impressions and clicks are not read here."
      : undefined;
  // Muhammed's grid (kpi.ts): good to the gate, a warning to the bad line,
  // serious above it. The same bands colour the board.
  const gate = (
    value: number | undefined,
    tone: CostTone | undefined,
    limit: number,
    bad: number,
  ) =>
    value === undefined || !tone ? undefined : (
      <StatusChip
        tone={
          tone === "good" ? "good" : tone === "warn" ? "warning" : "serious"
        }
        label={
          tone === "good"
            ? `Within $${limit}`
            : tone === "warn"
              ? `Over $${limit}`
              : `Over $${Number.isInteger(bad) ? bad : bad.toFixed(2)}`
        }
      />
    );
  const allFailed = names.length > 0 && failed.length === names.length;
  // The tiles wait for the client's own read too, so they never flash the
  // campaigns' sum first.
  const numbersLoading = loading || clientPending;
  // The days the totals count, when they are not the range picked: from the
  // client read's first day (a client with no campaign listed), to the
  // paired day. Before the sheet fills, the callout above says the second.
  const countedNote = countedLine(
    leadsOnly ? "Spend and leads" : "Spend, leads and bookings",
    plan.countedFrom,
    behind ? undefined : bookingsThrough,
  );
  // The client's read counts the days but cannot know its spend (no ad
  // account of its own): say that, never "No spend".
  const spendUnknown = whole !== undefined && whole.spend === null;
  // Meta flags this client's ad account: one line, once per account.
  const issues = [
    ...new Map(
      campaigns
        .filter(c => accountIssueFlag(c.accountIssue))
        .map(c => [String(c.metaAccountId ?? c.accountIssue), c] as const),
    ).values(),
  ];

  return (
    // ceo-root: the kit's status chips take their colours from it.
    <div className="ceo-root space-y-6">
      {/* The client and the range stay above the contents bar, as on the
          client success client page; the bar then holds while you scroll. */}
      <header>
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 mb-2 h-8 px-2 text-xs text-muted-foreground"
          onClick={onClose}
        >
          <ChevronLeft aria-hidden />
          All accounts
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-xl font-semibold tracking-tight break-words"
              dir="auto"
            >
              {client}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {campaigns.length > 0
                ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · ${liveCampaigns} running on Meta`
                : "No campaign listed now"}{" "}
              · {range.start} to {range.end}
            </p>
            <CallerLine
              clientName={client}
              accountKey={callsKey}
              range={range}
              leadsOnly={leadsOnly}
            />
          </div>
          <RangePicker value={range} onChange={onRangeChange} />
        </div>
        <div className="mt-3">
          <LeadSyncPanel client={client} />
        </div>
        {issues.map(c => {
          const flag = accountIssueFlag(c.accountIssue);
          return (
            <p
              key={String(c.metaAccountId ?? c.accountIssue)}
              className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/40 px-3 py-2 text-sm"
            >
              <TriangleAlert
                className="size-4 shrink-0"
                style={{ color: STATUS_COLOR[flag?.tone ?? "warning"] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">{c.accountIssue}</span>
              {c.metaAccountId ? (
                <a
                  className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                  href={metaBillingUrl(String(c.metaAccountId))}
                  target="_blank"
                  rel="noreferrer"
                >
                  Meta billing
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </p>
          );
        })}
      </header>

      <SectionNav parts={parts} />

      <section
        id="account-numbers"
        aria-labelledby="account-numbers-title"
        className={cn("rounded-2xl border bg-card p-4 sm:p-6", SECTION_OFFSET)}
      >
        <h3 id="account-numbers-title" className="text-[15px] font-semibold">
          Numbers
        </h3>
        {behind && paired && (
          <p className="callout-warn mt-4 rounded-lg border px-3 py-2 text-xs">
            The tracker sheet has spend up to {shortDate(paired)}, so spend,
            leads{leadsOnly ? "" : " and bookings"} are counted to that day.
            Anything after it has not been pulled yet; it is not missing.
          </p>
        )}
        {countedNote && (
          <p className="mt-2 text-xs text-muted-foreground">{countedNote}</p>
        )}
        {/* The client's own read counts stopped campaigns (R8, 2026-10-22):
            Atlantis 14-20 Oct reads $174.53 / 4 = $43.63 here as on the
            Client Performance board, its fourth booking from 13\9, a stopped
            campaign. Without that read the campaigns listed are summed and
            the line says so. */}
        {whole ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {clientRangeNotes(whole, {
              leadsOnly,
              unlinked: plan.unlinked,
            }).join(" ")}
          </p>
        ) : names.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {plan.why} A campaign removed from the list is left out, with its
            spend and bookings; the Client Performance board counts the whole ad
            account.
          </p>
        ) : null}
        {failed.length > 0 && !allFailed && (
          <p className="callout-warn mt-4 rounded-lg border px-3 py-2 text-xs">
            The numbers for {failed.join(", ")} could not be read, so the totals
            below leave them out. Reload the page to try again.
          </p>
        )}

        <div className="@container mt-4">
          {numbersLoading ? (
            <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
              Loading {range.label.toLowerCase()}…
            </p>
          ) : allFailed && !whole ? (
            <EmptyState
              compact
              title="The numbers could not be read"
              text="This does not mean nothing was spent. Reload the page to try again."
            />
          ) : names.length === 0 && !whole ? (
            // No campaign listed and no figure from the client's own read:
            // nothing to sum, so the reason, never "No spend".
            <EmptyState
              compact
              title={
                clientRead.error
                  ? "The client's numbers could not be read"
                  : "No numbers for this client in this range"
              }
              text={
                clientRead.error
                  ? plan.why
                  : `${plan.why} Pick another range above.`
              }
            />
          ) : !total.hasData ? (
            <EmptyState
              compact
              title={
                spendUnknown
                  ? "This client's spend is not known for these days"
                  : !whole && spendNotIn
                    ? spendNotInWhy(spendNotIn)
                    : `No spend between ${(whole && plan.countedFrom) || range.start} and ${(whole && plan.countedTo) || range.end}`
              }
              text={
                spendUnknown
                  ? (whole?.why ??
                    "Its ad account is not linked on the Client Performance board.")
                  : !whole && spendNotIn && !leadsOnly && sum.bookings > 0
                    ? `${sum.bookings} booking${sum.bookings === 1 ? " was" : "s were"} made in this range: see Campaigns below. ${sum.bookings === 1 ? "Its" : "Their"} cost waits for the spend; pick another range for the full numbers.`
                    : "Pick another range above. Today's numbers appear once the tracker has pulled the day."
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @6xl:grid-cols-8">
              {tile("Spend", money(total.spend), {
                naHint: whole?.why ?? undefined,
              })}
              {tile(
                "Leads",
                total.leads === null ? "n/a" : String(total.leads),
                {
                  naHint: whole?.why ?? undefined,
                },
              )}
              {tile("Cost per lead", usd2(cpl), {
                status: gate(cpl, cplTone(cpl), CPL_GATE, CPL_BAD),
                // Leads or spend not known is not "no leads".
                naHint:
                  total.leads === null
                    ? (whole?.why ??
                      "The leads for this range could not be read.")
                    : total.spend === null && total.leads > 0
                      ? (whole?.why ??
                        "The spend for this range could not be read.")
                      : "No leads in this range.",
              })}
              {!leadsOnly &&
                tile(
                  "Bookings",
                  total.bookings === null ? "n/a" : String(total.bookings),
                  {
                    sub:
                      bookingRate === undefined
                        ? undefined
                        : `${Math.round(bookingRate)}% of leads`,
                    naHint:
                      whole?.why ??
                      "The bookings for this range could not be read.",
                  },
                )}
              {!leadsOnly &&
                tile("Cost per booking", cpbShown.text, {
                  status: gate(
                    cpbShown.judged,
                    cpbShown.tone,
                    CPB_GATE,
                    CPB_BAD,
                  ),
                  hint: cpbShown.why,
                  naHint:
                    cpbShown.why ??
                    (total.bookings === null
                      ? (whole?.why ??
                        "The bookings for this range could not be read.")
                      : "No bookings in this range."),
                })}
              {tile("Link CTR", pctText(linkCtr), {
                hint: "Link clicks divided by impressions. Not CTR (all).",
                naHint: noRates ?? fewImpressions,
              })}
              {tile("CPM", usd2(cpm), { naHint: noRates ?? fewImpressions })}
              {tile("Opt-in rate", pctText(optIn), {
                hint: "Of those who clicked through, how many left their details.",
                naHint: noRates ?? "Fewer than 50 link clicks in this range.",
              })}
            </div>
          )}
        </div>
        {ratesNote && !numbersLoading && total.hasData && (
          <p className="mt-2 text-xs text-muted-foreground">{ratesNote}</p>
        )}

        {trend.length >= 2 && whole && notListed.length > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            The daily charts are the campaigns listed here; the{" "}
            {notListed.length === 1
              ? "stopped campaign"
              : `${notListed.length} stopped campaigns`}{" "}
            under Campaigns {notListed.length === 1 ? "is" : "are"} in the
            totals above only.
          </p>
        )}
        {trend.length >= 2 && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <TrendChart
              title="Leads per day"
              points={pts("leads")}
              kind="bar"
            />
            <TrendChart title="Spend per day" points={pts("spend")} unit="$" />
            <TrendChart
              title="Cost per lead"
              points={pts("cpl")}
              unit="$"
              mode="avg"
              goodWhen="down"
            />
          </div>
        )}
        {callsHoldLost ? null : (
          <div id="account-lost" className={SECTION_OFFSET}>
            <LostLeads
              lost={lost}
              adNameById={Object.fromEntries(
                tree
                  .filter((t: Row) => t.kind === "ad" && t.metaId)
                  .map((t: Row) => [t.metaId, t.name]),
              )}
            />
          </div>
        )}
      </section>

      <div id="account-feedback" className={SECTION_OFFSET}>
        <AppointmentFeedback
          taskId={clientTaskId}
          from={range.start}
          to={range.end}
        />
      </div>

      <CallCentreSection
        accountKey={callsKey}
        clientName={client}
        range={range}
        leadsOnly={leadsOnly}
      />

      <section
        id="account-ads"
        className={cn("rounded-2xl border bg-card p-4 sm:p-6", SECTION_OFFSET)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold">Every ad</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Numbers for {range.label.toLowerCase()}. Watch plays Meta's own
              preview; the most spent comes first.
            </p>
          </div>
          <div
            className="-mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Which ads"
          >
            {(
              [
                ["all", "All"],
                ["running", "Running"],
                ["off", "Not running"],
              ] as const
            ).map(([key, label]) =>
              counts[key] === 0 && key !== "all" && key !== show ? null : (
                <button
                  key={key}
                  type="button"
                  aria-pressed={show === key}
                  onClick={() => setShow(key)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
                    show === key
                      ? "border-primary/40 bg-primary/15 text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {counts[key]}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>

        {!loading && failed.length > 0 && cards.some(c => c.failed) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {allFailed
              ? "The numbers could not be read, so every ad shows n/a."
              : `Ads in ${failed.join(", ")} show n/a: their numbers could not be read.`}{" "}
            Reload the page to try again.
          </p>
        )}
        {loading ? (
          <p className="mt-4 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            Loading the ads for {range.label.toLowerCase()}…
          </p>
        ) : cards.length === 0 ? (
          <EmptyState
            compact
            className="mt-4"
            title="No ads found for this client"
            text={
              campaigns.length === 0
                ? "No campaign of this client is listed now, so its ads are not read here. The numbers above come from its ad account's daily rows."
                : "Meta has no ads under these campaigns, and none spent in this range."
            }
          />
        ) : (
          <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {visible.map(card => (
              <AdTile
                key={card.key}
                card={card}
                best={card.key === best}
                showCampaign={multi}
                range={range}
                savedIn={savedIn}
                open={openAd === card.key}
                onOpenChange={o => setOpenAd(o ? card.key : null)}
              />
            ))}
          </ul>
        )}
        {!more && shown.length > WALL_PAGE && (
          <div className="mt-4">
            <Button size="sm" variant="outline" onClick={() => setMore(true)}>
              Show the other {shown.length - WALL_PAGE}
            </Button>
          </div>
        )}
      </section>

      <section
        id="account-campaigns"
        className={cn("rounded-2xl border bg-card p-4 sm:p-6", SECTION_OFFSET)}
      >
        <h3 className="text-[15px] font-semibold">Campaigns</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {campaigns.length > 0
            ? "Pick one to see it in full below, with every action the table has. The call is the 7-day read."
            : "No campaign of this client is listed now."}
          {notListed.length > 0 &&
            (campaigns.length > 0
              ? " Last come the stopped campaigns that spent or booked in this range, with their numbers for it: they are in the totals above."
              : " These stopped campaigns spent or booked in this range; their numbers are in the totals above.")}
        </p>
        <ul className="mt-3 space-y-1.5">
          {ordered.map(c => {
            const r = read(String(c.campaignName));
            const on = current?.campaignName === c.campaignName;
            const live = tree.some(
              (t: Row) =>
                t.campaignName === c.campaignName &&
                t.kind === "ad" &&
                isLive(t),
            );
            const dwy = c.serviceMode === "DWY";
            const facts = [
              r?.spendNotIn
                ? spendNotInWhy(String(r.spendNotIn))
                : r
                  ? `${money(r.total?.spend)} · ${r.total?.leads ?? 0} leads · ${usd2(r.total?.cpl)} a lead`
                  : ranges[String(c.campaignName)] instanceof Error
                    ? "Numbers could not be read. Reload to try again."
                    : "Loading…",
              r && !dwy && r.total?.bookings !== undefined
                ? bookedFacts(
                    Number(r.total?.spend ?? 0),
                    Number(r.bookingsTotal ?? r.total.bookings),
                    r.total?.costPerBooking,
                    r.spendNotIn,
                  )
                : null,
              c.budgetDaily !== undefined
                ? `${money(c.budgetDaily)}/day ${c.budgetLevel === "campaign" ? "CBO" : c.budgetLevel === "adset" ? "ABO" : ""}`.trim()
                : c.budgetLifetime !== undefined
                  ? `${money(c.budgetLifetime)} lifetime`
                  : null,
            ].filter(Boolean);
            return (
              <li
                key={c._id ?? c.campaignName}
                className={cn(
                  "flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
                  on
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                    : "hover:bg-muted/40",
                )}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    picked.current = true;
                    onSelect(String(c.campaignName));
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className="block break-words text-sm font-semibold"
                    dir="auto"
                  >
                    {c.campaignName}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {facts.join(" · ")}
                  </span>
                </button>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {c.verdict && (
                    <StatusChip
                      tone={VERDICT_TONE[c.verdict] ?? "neutral"}
                      label={sentence(c.verdict)}
                      hint={c.reason}
                    />
                  )}
                  <StatusToggle
                    compact
                    metaId={c.metaCampaignId}
                    level="campaign"
                    name={c.campaignName}
                    clientTag={c.clientTag}
                    campaignName={c.campaignName}
                    active={live}
                  />
                </span>
              </li>
            );
          })}
          {notListed.map(c => (
            <li
              key={`stopped\u0000${c.campaignName}`}
              className="flex items-start gap-3 rounded-xl px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block break-words text-sm font-semibold"
                  dir="auto"
                >
                  {c.campaignName}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[
                    `${money(c.spend)} · ${c.leads ?? "n/a"} leads`,
                    !leadsOnly && c.bookings !== null
                      ? bookedFacts(Number(c.spend ?? 0), c.bookings)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <StatusChip tone="neutral" label="Not listed now" />
            </li>
          ))}
        </ul>
      </section>

      {current && (
        <section
          ref={panelRef}
          id="account-campaign"
          className={cn(
            "rounded-2xl border bg-card p-4 sm:p-6",
            SECTION_OFFSET,
          )}
          aria-label={`${current.campaignName} in full`}
        >
          <h3 className="mb-4 break-words text-[15px] font-semibold" dir="auto">
            {current.campaignName}
          </h3>
          {renderPanel(current)}
        </section>
      )}

      {showLeadPage && (
        <LeadPageSection read={pageForms} className={SECTION_OFFSET} />
      )}
    </div>
  );
}

/** One ad on the wall: its picture, its numbers for the range, its controls. */
function AdTile({
  card,
  best,
  showCampaign,
  range,
  savedIn,
  open,
  onOpenChange,
}: {
  card: AdCard;
  best: boolean;
  showCampaign: boolean;
  range: Range;
  savedIn?: Record<string, SavedState>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const c = card.campaign;
  const r = card.row;
  const dwy = c.serviceMode === "DWY";
  const status = card.running
    ? "Running"
    : card.nodes.length
      ? metaWords(card.nodes[0]) || "Not running"
      : "Not in Meta's list";
  // A failed read is n/a, never $0.00 and 0; so is a range whose spend is
  // not in yet (Today); an ad that did not spend in a range that was read is
  // $0.00 and 0. Cost colours follow the grid.
  const quiet = card.failed || (!r && card.spendNotIn) ? "n/a" : undefined;
  const cells: [string, ReactNode, CostTone?, string?][] = [
    ["Spend", quiet ?? (r ? usd2(r.spend) : "$0.00")],
    ["Leads", quiet ?? (r ? String(r.leads) : "0")],
    ["CPL", usd2(r?.cpl), cplTone(r?.cpl)],
  ];
  if (!dwy) {
    // No booking credited to this ad: "None yet" or "None on $233", coloured
    // only when every booking in the range was credited to one of the ads
    // listed (2026-10-21); otherwise the hover says why it has no colour.
    const none =
      r?.bookingsAttributed && r.bookings === 0
        ? cpbDisplay(r.spend, 0)
        : undefined;
    const counted =
      r?.bookingsAttributed && r.costPerBooking !== undefined
        ? cpbValue(r.costPerBooking)
        : undefined;
    const shown = none ?? counted;
    const untraced = Boolean(none?.noneOnSpend && !card.allTraced);
    cells.push(
      ["Booked", r?.bookingsAttributed ? String(r.bookings) : "n/a"],
      [
        "Per booking",
        shown ? shown.text : "n/a",
        untraced ? undefined : shown?.tone,
        untraced
          ? "No booking was credited to this ad, but some bookings in this range could not be tied to one ad, so it is not coloured."
          : shown?.why,
      ],
    );
  }
  cells.push(["Link CTR", pctText(r?.linkCtr)]);

  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-xl bg-muted/40 p-3",
        best && "glow-teal",
      )}
    >
      {best && (
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">
          Best cost per lead
        </span>
      )}
      <CreativePreview
        variant="card"
        name={card.name}
        metaAdId={card.picture.metaAdId}
        accountId={card.picture.accountId}
        stillUrl={card.picture.stillUrl}
        stillTinyUrl={card.picture.stillTinyUrl}
        thumbUrl={card.picture.thumbUrl}
        open={open}
        onOpenChange={onOpenChange}
      />
      <div className="min-w-0">
        <p
          className="line-clamp-2 break-words text-sm font-semibold"
          dir="auto"
          title={card.name}
        >
          {card.name}
        </p>
        {showCampaign && (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {c.campaignName}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip tone={card.running ? "good" : "neutral"} label={status} />
        {card.verdict && (
          <StatusChip
            tone={VERDICT_TONE[card.verdict] ?? "neutral"}
            label={`7 days: ${sentence(card.verdict)}`}
          />
        )}
        {card.nodes.length > 1 && (
          <span className="text-xs text-muted-foreground">
            {card.nodes.length} ads share this name
          </span>
        )}
      </div>
      <dl
        className="grid grid-cols-3 gap-x-2 gap-y-2"
        // Said once above the wall; the tile keeps the reason on hover.
        title={
          card.failed
            ? FAILED_READ
            : !r && card.spendNotIn
              ? `${spendNotInWhy(card.spendNotIn)}.`
              : undefined
        }
      >
        {cells.map(([label, value, tone, why]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </dt>
            <dd
              className="flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold tabular-nums"
              title={why}
            >
              {tone && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: COST_DOT[tone] }}
                />
              )}
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-2.5">
        <StatusToggle
          compact
          metaId={card.nodes.length === 1 ? card.nodes[0].metaId : undefined}
          level="ad"
          name={card.name}
          clientTag={c.clientTag}
          campaignName={c.campaignName}
          active={card.running}
        />
        <RequestCreativeButton
          compact
          campaignName={c.campaignName}
          adId={card.ids.length === 1 ? card.ids[0] : undefined}
          adName={card.name}
          ads={
            card.ids.length > 1
              ? card.nodes.map((n: Row) => ({
                  metaId: String(n.metaId),
                  name: String(n.name),
                }))
              : undefined
          }
        />
        <SaveWinnerButton
          campaignName={c.campaignName}
          range={range}
          row={{ key: card.name, leads: r?.leads ?? 0, adIds: card.ids }}
          leadsOnly={dwy}
          savedIn={savedIn}
        />
      </div>
    </li>
  );
}
