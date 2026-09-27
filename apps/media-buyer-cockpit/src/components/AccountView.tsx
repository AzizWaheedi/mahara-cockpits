import { useQueries, useQuery } from "@/lib/cockpitApi";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CreativePreview } from "@/components/CreativePreview";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money } from "@/components/ceo/format";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { LostLeads } from "@/components/LostLeads";
import { RangePicker } from "@/components/RangePicker";
import { RequestCreativeButton } from "@/components/RequestCreativeButton";
import {
  type SavedState,
  SaveWinnerButton,
} from "@/components/SaveWinnerButton";
import { StatusToggle } from "@/components/StatusToggle";
import { TrendChart } from "@/components/TrendChart";
import { Button } from "@/components/ui/button";
import { CPB_GATE, CPL_GATE } from "@/lib/kpi";
import { kuwaitDay, type Range } from "@/lib/range";
import { cn } from "@/lib/utils";
import { api } from "@/lib/cockpitApi";

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
 * campaign in full through the table's own panel. The numbers are the
 * range table's (`stats.range`, one read per campaign, shared with the open
 * panel's own read), summed; nothing here is a second formula.
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
  campaigns,
  tree,
  verdicts,
  range,
  onRangeChange,
  selected,
  onSelect,
  renderPanel,
  onClose,
}: {
  client: string;
  /** The client's campaigns from the snapshot, running and off. */
  campaigns: Row[];
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

  const results = names.map(n => ranges[n]);
  const loading = results.some(r => r === undefined);
  const failed = names.filter(n => ranges[n] instanceof Error);
  const read = (n: string) =>
    ranges[n] && !(ranges[n] instanceof Error) ? ranges[n] : undefined;
  const leadsOnly = campaigns.every(c => c.serviceMode === "DWY");

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
  const cpl = sum.leads > 0 ? sum.spend / sum.leads : undefined;
  const cpb =
    sum.bookings > 0 && sum.spend > 0 ? sum.spend / sum.bookings : undefined;
  const bookingRate =
    sum.leads > 0 ? (sum.bookings / sum.leads) * 100 : undefined;
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
  // numbers, then every other ad Meta has, at $0.
  const cards: AdCard[] = [];
  {
    const out = cards;
    for (const c of campaigns) {
      const name = String(c.campaignName);
      const rows: RangeRow[] = read(name)?.ads ?? [];
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

  const liveCampaigns = campaigns.filter(c =>
    tree.some(
      (t: Row) =>
        t.campaignName === c.campaignName && t.kind === "ad" && isLive(t),
    ),
  ).length;
  const multi = campaigns.length > 1;
  // Bookings come from one HighLevel read per client, so any campaign carries them.
  const lost = campaigns.find(c => c.lost)?.lost;
  const behind =
    coverage?.last && coverage.last < kuwaitDay(1) && range.end > coverage.last;

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
  const gate = (value: number | undefined, limit: number) =>
    value === undefined ? undefined : (
      <StatusChip
        tone={value > limit ? "serious" : "good"}
        label={value > limit ? `Over $${limit}` : `Under $${limit}`}
      />
    );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
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
              {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
              {liveCampaigns} running on Meta · {range.start} to {range.end}
            </p>
          </div>
          <RangePicker value={range} onChange={onRangeChange} />
        </div>

        {behind && (
          <p className="callout-warn mt-4 rounded-lg border px-3 py-2 text-xs">
            The tracker sheet has spend up to {coverage.last}. Anything after
            that has not been pulled yet; it is not missing.
          </p>
        )}
        {failed.length > 0 && (
          <p className="callout-warn mt-4 rounded-lg border px-3 py-2 text-xs">
            The numbers for {failed.join(", ")} could not be read, so the totals
            below leave them out. Reload the page to try again.
          </p>
        )}

        <div className="@container mt-5">
          {loading ? (
            <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
              Loading {range.label.toLowerCase()}…
            </p>
          ) : !sum.hasData ? (
            <EmptyState
              compact
              title={`No spend between ${range.start} and ${range.end}`}
              text="Pick another range above. Today's numbers appear once the tracker has pulled the day."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @6xl:grid-cols-8">
              {tile("Spend", money(sum.spend))}
              {tile("Leads", String(sum.leads))}
              {tile("Cost per lead", usd2(cpl), {
                status: gate(cpl, CPL_GATE),
                naHint: "No leads in this range.",
              })}
              {!leadsOnly &&
                tile("Bookings", String(sum.bookings), {
                  sub:
                    bookingRate === undefined
                      ? undefined
                      : `${Math.round(bookingRate)}% of leads`,
                })}
              {!leadsOnly &&
                tile(
                  "Cost per booking",
                  cpb === undefined ? "n/a" : money(cpb),
                  {
                    status: gate(cpb, CPB_GATE),
                    naHint: "No bookings in this range.",
                  },
                )}
              {tile("Link CTR", pctText(linkCtr), {
                hint: "Link clicks divided by impressions. Not CTR (all).",
                naHint: fewImpressions,
              })}
              {tile("CPM", usd2(cpm), { naHint: fewImpressions })}
              {tile("Opt-in rate", pctText(optIn), {
                hint: "Of those who clicked through, how many left their details.",
                naHint: "Fewer than 50 link clicks in this range.",
              })}
            </div>
          )}
        </div>

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
        <LostLeads
          lost={lost}
          adNameById={Object.fromEntries(
            tree
              .filter((t: Row) => t.kind === "ad" && t.metaId)
              .map((t: Row) => [t.metaId, t.name]),
          )}
        />
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
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

        {loading ? (
          <p className="mt-4 rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            Loading the ads for {range.label.toLowerCase()}…
          </p>
        ) : cards.length === 0 ? (
          <EmptyState
            compact
            className="mt-4"
            title="No ads found for this client"
            text="Meta has no ads under these campaigns, and none spent in this range."
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

      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <h3 className="text-[15px] font-semibold">Campaigns</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick one to see it in full below, with every action the table has. The
          call is the 7-day read.
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
              r
                ? `${money(r.total?.spend)} · ${r.total?.leads ?? 0} leads · ${usd2(r.total?.cpl)} a lead`
                : "Loading…",
              r && !dwy && r.total?.bookings !== undefined
                ? `${r.bookingsTotal ?? r.total.bookings} booked${r.total?.costPerBooking !== undefined ? ` at ${money(r.total.costPerBooking)}` : ""}`
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
        </ul>
      </section>

      {current && (
        <section
          ref={panelRef}
          className="scroll-mt-6 rounded-2xl border bg-card p-4 sm:p-6"
          aria-label={`${current.campaignName} in full`}
        >
          <h3 className="mb-4 break-words text-[15px] font-semibold" dir="auto">
            {current.campaignName}
          </h3>
          {renderPanel(current)}
        </section>
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
  const cells: [string, ReactNode, string?][] = [
    ["Spend", r ? usd2(r.spend) : "$0.00"],
    ["Leads", r ? String(r.leads) : "0"],
    [
      "CPL",
      usd2(r?.cpl),
      r?.cpl === undefined ? undefined : r.cpl > CPL_GATE ? "bad" : "good",
    ],
  ];
  if (!dwy) {
    cells.push(
      ["Booked", r?.bookingsAttributed ? String(r.bookings) : "n/a"],
      [
        "Per booking",
        r?.bookingsAttributed && r.costPerBooking !== undefined
          ? money(r.costPerBooking)
          : "n/a",
        r?.bookingsAttributed && r.costPerBooking !== undefined
          ? r.costPerBooking > CPB_GATE
            ? "bad"
            : "good"
          : undefined,
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
      <dl className="grid grid-cols-3 gap-x-2 gap-y-2">
        {cells.map(([label, value, tone]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </dt>
            <dd className="flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold tabular-nums">
              {tone && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      tone === "bad" ? "var(--destructive)" : "var(--success)",
                  }}
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
