import {
  ArrowUpRight,
  ChartLine,
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { CreativePreview } from "@/components/CreativePreview";
import { Hint } from "@/components/Hint";
import { Chip, Dot, Pill, PillRow } from "@/components/kit";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  type AdNode,
  type AdsModel,
  adSetUrl,
  adUrl,
  buildAdsModel,
  type CampaignNode,
  type ChartPoint,
  type ClientAdsRead,
  campaignUrl,
  chartSeries,
  fetchClientAds,
  findScope,
  type Measure,
  type Metrics,
  money,
  type Scope,
  type SetNode,
  SORTS,
  sameScope,
  scopeName,
  scopeTotals,
  validScope,
} from "@/lib/clientAds";
import { plural } from "@/lib/format";
import { dayLabel } from "@/lib/reportPeriod";
import { cn } from "@/lib/utils";

/**
 * The client's ads for the chosen period, on the Results tab (Muhammed,
 * 2026-10-12, from the approved mock): one chart that follows a campaign, an
 * ad set or an ad, with the media buyer's changes marked on it; then each
 * campaign, its ad sets, and their ads with a picture, the numbers that
 * matter and a link to Ads Manager.
 */

type Period = { from: string; to: string; label: string };

const MEASURES: { key: Measure; label: string; booking?: boolean }[] = [
  { key: "leads", label: "Leads" },
  { key: "spend", label: "Spend" },
  { key: "cpl", label: "Cost per lead" },
  { key: "booked", label: "Booked", booking: true },
];

export function ClientAds({
  taskId,
  clientName,
  per,
  dwy,
  onCount,
}: {
  taskId?: string;
  clientName: string;
  per: Period;
  /** Done with you: the client books their own calls, so no booking numbers. */
  dwy: boolean;
  /** How many ads spent or brought a lead in the period, once read. */
  onCount?: (n: number | undefined) => void;
}) {
  const auth = useCockpitAuth();
  const [read, setRead] = useState<ClientAdsRead | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRead(undefined);
    setError(null);
    if (!auth.client || !taskId) return;
    let live = true;
    fetchClientAds(auth.client, taskId, per.from, per.to)
      .then(r => {
        if (live) setRead(r);
      })
      .catch(e => {
        if (live)
          setError(
            e instanceof Error ? e.message : "The ads could not be read.",
          );
      });
    return () => {
      live = false;
    };
  }, [auth.client, taskId, per.from, per.to]);

  const model = useMemo(
    () => (read ? buildAdsModel(read, per) : undefined),
    [read, per],
  );
  useEffect(() => {
    onCount?.(
      model
        ? model.campaigns
            .flatMap(c => c.sets)
            .flatMap(s => s.ads)
            .filter(a => a.active).length
        : undefined,
    );
  }, [model, onCount]);

  if (!taskId)
    return (
      <p className="text-sm text-muted-foreground">
        This client has no ClickUp card yet, so their ads cannot be matched.
      </p>
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        The ads could not be read: {error.replace(/\.?\s*$/, ".")} Reload the
        page. If it keeps failing, use Report an issue at the top of the page.
      </p>
    );
  if (!model)
    return <p className="text-sm text-muted-foreground">Loading the ads…</p>;
  if (!model.campaigns.length)
    return (
      <p className="text-sm text-muted-foreground">
        No campaigns are matched to {clientName}. If they run ads, the ads board
        is missing the client name: say so with Report an issue at the top of
        this page and the mapping gets fixed.
      </p>
    );
  return <AdsView model={model} clientName={clientName} per={per} dwy={dwy} />;
}

/** The section itself, from a built model: the page reads it, a preview can pass one. */
export function AdsView({
  model,
  clientName,
  per,
  dwy,
}: {
  model: AdsModel;
  clientName: string;
  per: Period;
  dwy: boolean;
}) {
  const [scope, setScope] = useState<Scope>({ level: "all" });
  const [measure, setMeasure] = useState<Measure>("leads");
  const [sort, setSort] = useState<Measure>("spend");
  const shown = validScope(model, scope);
  const bookings = !dwy;
  if (model.dataTo < model.dataFrom)
    return (
      <p className="text-sm text-muted-foreground">
        No ad numbers are in for {per.label} yet. Each day is imported after it
        ends, and the last imported day is {dayLabel(model.dataTo)}.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Spend, leads and clicks come from Meta.
        {bookings
          ? " Bookings come from the GHL calendar, matched to the ad that brought the lead."
          : null}{" "}
        The numbers run to {dayLabel(model.dataTo)}.
      </p>
      {model.cut ? (
        <Callout>
          Ad numbers start on {dayLabel(model.dataFrom)}. The period reaches
          further back, so the ads below show {dayLabel(model.dataFrom)} to{" "}
          {dayLabel(model.dataTo)} only.
        </Callout>
      ) : null}
      {bookings && !model.bookingsReady ? (
        <Callout>
          Booked calls are not imported yet, so booked and attended show as not
          imported, not as zero.
        </Callout>
      ) : null}

      <AdsChart
        model={model}
        scope={shown}
        onScope={setScope}
        measure={!bookings && measure === "booked" ? "leads" : measure}
        onMeasure={setMeasure}
        bookings={bookings}
        label={per.label}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2">
        <h3 className="text-sm font-semibold">Campaigns, ad sets and ads</h3>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            Sort ads
          </span>
          <PillRow>
            {MEASURES.filter(m => bookings || !m.booking).map(m => (
              <Pill
                key={m.key}
                active={sort === m.key}
                onClick={() => setSort(m.key)}
              >
                {m.label}
              </Pill>
            ))}
          </PillRow>
        </div>
      </div>

      <CampaignList
        model={model}
        scope={shown}
        onScope={s => {
          setScope(s);
          document
            .getElementById("ads-chart")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        sort={sort}
        bookings={bookings}
        clientName={clientName}
      />

      {bookings && model.unattributedCount ? (
        <p className="text-xs text-muted-foreground">
          {plural(model.unattributedCount, "booking")} in this period came from
          no tracked ad. They count in the campaign totals only, not under an
          ad.
        </p>
      ) : null}
      {model.missingPictures ? (
        <p className="text-xs text-muted-foreground">
          {plural(model.missingPictures, "ad")} that no longer{" "}
          {model.missingPictures === 1 ? "runs has" : "run have"} no saved
          picture, so{" "}
          {model.missingPictures === 1 ? "its tile stays" : "their tiles stay"}{" "}
          blank.
        </p>
      ) : null}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm ring-1 ring-inset ring-warning/30">
      <TriangleAlert
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces shared by the chart and the tree.

/** A name that opens Ads Manager: the name, then one trailing arrow. */
function AmLink({
  href,
  children,
  className,
}: {
  href?: string;
  children: string;
  className?: string;
}) {
  if (!href)
    return (
      <span
        className={cn("block [overflow-wrap:anywhere]", className)}
        dir="auto"
      >
        {children}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open in Ads Manager"
      className={cn(
        "group inline [overflow-wrap:anywhere] underline-offset-4 hover:text-primary hover:underline",
        className,
      )}
    >
      <span dir="auto">{children}</span>
      {/* A word joiner keeps the arrow on the name's last line. */}
      <span className="whitespace-nowrap">
        {"⁠"}
        <ArrowUpRight
          aria-hidden
          className="ml-1 inline size-3.5 -translate-y-px text-muted-foreground group-hover:text-primary"
        />
      </span>
      <span className="sr-only"> (opens Ads Manager)</span>
    </a>
  );
}

function ChartButton({
  target,
  scope,
  onScope,
  label,
}: {
  target: Scope;
  scope: Scope;
  onScope: (s: Scope) => void;
  label: string;
}) {
  const on = sameScope(target, scope);
  return (
    <Hint content={label} tap={false}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        onClick={() => onScope(target)}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground",
          on &&
            "border-primary/50 bg-primary/12 text-primary hover:text-primary",
        )}
      >
        <ChartLine aria-hidden className="size-4" />
      </button>
    </Hint>
  );
}

const pct = (v?: number) => (v === undefined ? undefined : `${v.toFixed(1)}%`);

function Stat({
  label,
  value,
  empty,
}: {
  label: string;
  value?: string | number;
  empty: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs leading-tight text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-auto whitespace-nowrap pt-0.5 tabular-nums",
          value === undefined
            ? "text-[13px] text-muted-foreground"
            : "text-sm font-medium",
        )}
      >
        {value ?? empty}
      </dd>
    </div>
  );
}

/** Spent, leads, cost per lead, then the booking three when they apply. */
function Stats({
  t,
  currency,
  bookings,
  ready,
  className,
}: {
  t: Metrics;
  currency: string;
  bookings: boolean;
  ready: boolean;
  className?: string;
}) {
  const missing = ready ? undefined : "Not imported";
  return (
    <dl
      className={cn(
        "grid grid-cols-3 gap-x-3 gap-y-2.5",
        bookings && "@2xl:grid-cols-6",
        className,
      )}
    >
      <Stat label="Spent" value={money(t.spend, currency)} empty="-" />
      <Stat label="Leads" value={t.leads} empty="-" />
      <Stat
        label="Cost per lead"
        value={money(t.cpl, currency, true)}
        empty="No leads"
      />
      {bookings ? (
        <>
          <Stat
            label="Booked"
            value={ready ? t.booked : undefined}
            empty={missing ?? "-"}
          />
          <Stat
            label="Attended"
            value={ready ? t.attended : undefined}
            empty={missing ?? "-"}
          />
          <Stat
            label="Cost per booking"
            value={ready ? money(t.cpb, currency) : undefined}
            empty={missing ?? "No bookings"}
          />
        </>
      ) : null}
    </dl>
  );
}

/**
 * The signature: this ad's cost per lead, or per booking, against the
 * client's average. Both are shown (Muhammed, 2026-10-13): neither number
 * judges an ad alone.
 */
function Meter({
  t,
  avg,
  currency,
  measure = "cpl",
  className = "flex-[1_1_320px]",
}: {
  t: Metrics;
  avg?: number;
  currency: string;
  measure?: "cpl" | "cpb";
  className?: string;
}) {
  const noun = measure === "cpl" ? "lead" : "booking";
  if (measure === "cpl" && !t.leads)
    return t.spend > 0 ? (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Dot tone="bad" />
        No leads from {money(t.spend, currency)} in this period
      </div>
    ) : null;
  // No booking yet is worth a line only once the ad has spent more than an
  // average booking costs this client.
  if (measure === "cpb" && !t.booked)
    return avg && t.spend > avg ? (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <Dot tone="bad" />
        No booking from {money(t.spend, currency)}, more than this client's
        average of {money(avg, currency, true)} a booking
      </div>
    ) : null;
  const value = measure === "cpl" ? t.cpl : t.cpb;
  if (!avg || value === undefined) return null;
  const r = value / avg;
  const pos = Math.max(2, Math.min(98, (r - 0.5) * 100));
  const diff = Math.round((r - 1) * 100);
  const tone = Math.abs(diff) <= 4 ? "even" : diff < 0 ? "cheap" : "dear";
  const words =
    tone === "even"
      ? `About this client's average of ${money(avg, currency, true)} a ${noun}`
      : `${Math.abs(diff)}% ${diff < 0 ? "cheaper" : "more expensive"} than this client's average of ${money(avg, currency, true)} a ${noun}`;
  const color =
    tone === "cheap"
      ? "bg-primary"
      : tone === "dear"
        ? "bg-warning"
        : "bg-foreground";
  return (
    <div
      role="img"
      aria-label={words}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2",
        className,
      )}
    >
      <span className="relative h-1.5 min-w-30 max-w-50 flex-[1_1_140px] rounded-full bg-muted">
        <span className="absolute inset-y-[-5px] left-1/2 -ml-px w-0.5 rounded-sm bg-foreground/45" />
        {tone === "even" ? null : (
          <span
            className={cn("absolute inset-y-0 rounded-full opacity-55", color)}
            style={{
              left: `${Math.min(pos, 50)}%`,
              width: `${Math.abs(pos - 50)}%`,
            }}
          />
        )}
        <span
          className={cn(
            "absolute top-1/2 -mt-1.5 -ml-1.5 size-3 rounded-full border-2 border-card",
            color,
            tone === "cheap" && "shadow-[0_0_10px_rgb(0_207_200/60%)]",
          )}
          style={{ left: `${pos}%` }}
        />
      </span>
      <span className="min-w-0 flex-[1_1_220px] text-xs text-muted-foreground">
        {tone === "even" ? (
          words
        ) : (
          <>
            <b className="font-medium text-foreground">
              {Math.abs(diff)}% {diff < 0 ? "cheaper" : "more expensive"}
            </b>{" "}
            than this client's average of {money(avg, currency, true)} a {noun}
          </>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The one chart.

/** Changes listed under the chart before "Show all". */
const CHANGES_SHOWN = 3;

const fmtY = (
  v: number | null | undefined,
  money$: boolean,
  currency?: string,
) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (money$) {
    const n =
      v >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
    return currency && currency !== "USD" ? `${n}` : `$${n}`;
  }
  return v >= 1000
    ? `${(v / 1000).toFixed(1)}k`
    : String(Math.round(v * 10) / 10);
};

/**
 * Which marks carry a number. Marks closer than 20px would print over each
 * other, so the first of a run carries "4+" and the rest keep only their line.
 */
function markLabels(pts: ChartPoint[], width: number): Map<string, string> {
  const band =
    width > 0 ? Math.max(1, (width - 50) / Math.max(1, pts.length)) : 20;
  const out = new Map<string, string>();
  let lead: { key: string; at: number; n: number } | undefined;
  pts.forEach((p, i) => {
    if (!p.changes.length) return;
    if (lead && (i - lead.at) * band < 20) {
      out.set(lead.key, `${lead.n}+`);
      return;
    }
    lead = { key: p.key, at: i, n: p.changes[0].n };
    out.set(p.key, p.changes.length > 1 ? `${lead.n}+` : String(lead.n));
  });
  return out;
}

function MarkLabel({
  viewBox,
  text,
}: {
  viewBox?: { x?: number; y?: number };
  text: string;
}) {
  const x = viewBox?.x;
  const y = viewBox?.y;
  if (x === undefined || y === undefined) return null;
  return (
    <g>
      <circle
        cx={x}
        cy={y - 14}
        r={text.length > 1 ? 9.5 : 8.5}
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeOpacity={0.6}
      />
      <text
        x={x}
        y={y - 10.6}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {text}
      </text>
    </g>
  );
}

function AdsChart({
  model,
  scope,
  onScope,
  measure,
  onMeasure,
  bookings,
  label,
}: {
  model: AdsModel;
  scope: Scope;
  onScope: (s: Scope) => void;
  measure: Measure;
  onMeasure: (m: Measure) => void;
  bookings: boolean;
  label: string;
}) {
  const [allChanges, setAllChanges] = useState(false);
  const f = findScope(model, scope);
  const currency =
    scope.level === "all" ? model.currency : (f.campaign?.currency ?? "USD");
  // Spend in two currencies does not add up: those two measures wait for a campaign.
  const mixed = currency === undefined;
  const shownMeasure: Measure =
    mixed && (measure === "spend" || measure === "cpl") ? "leads" : measure;
  const series = useMemo(
    () => chartSeries(model, scope, shownMeasure),
    [model, scope, shownMeasure],
  );
  const t = scopeTotals(model, scope);
  const isMoney = shownMeasure === "spend" || shownMeasure === "cpl";
  const unit = series.weekly ? "week" : "day";
  const title =
    shownMeasure === "leads"
      ? `Leads per ${unit}`
      : shownMeasure === "spend"
        ? `Spend per ${unit}`
        : shownMeasure === "booked"
          ? `Booked per ${unit}`
          : series.weekly
            ? "Cost per lead per week"
            : "Cost per lead, 7-day average";
  const head =
    shownMeasure === "leads"
      ? String(t.leads)
      : shownMeasure === "spend"
        ? (money(t.spend, currency) ?? "-")
        : shownMeasure === "booked"
          ? model.bookingsReady
            ? String(t.booked)
            : "Not imported"
          : (money(t.cpl, currency, true) ?? "No leads");
  const avg = shownMeasure === "cpl" ? t.cpl : undefined;
  const hasData = series.points.some(p => p.y !== null);
  const name = scopeName(model, scope);
  const visible = allChanges
    ? series.changes
    : series.changes.slice(0, CHANGES_SHOWN);
  const pts = series.points;
  const [width, setWidth] = useState(0);
  const labels = useMemo(() => markLabels(pts, width), [pts, width]);
  // The chart's width decides which change marks have room for a number.
  const measure$ = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tick = (k: string) => {
    const p = pts.find(x => x.key === k);
    return (p?.label ?? k).replace("Week of ", "");
  };

  return (
    <section
      id="ads-chart"
      aria-label="Ads over time"
      className="@container scroll-mt-4 space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
    >
      <div className="space-y-1.5">
        <FilterRow label="Campaign">
          <Pill
            active={scope.level === "all"}
            onClick={() => onScope({ level: "all" })}
          >
            All campaigns
          </Pill>
          {model.campaigns
            .filter(c => c.active)
            .map(c => (
              <Pill
                key={c.name}
                active={scope.level !== "all" && scope.campaign === c.name}
                onClick={() => onScope({ level: "campaign", campaign: c.name })}
              >
                <span dir="auto">{c.name}</span>
              </Pill>
            ))}
        </FilterRow>
        {(scope.level === "set" || scope.level === "ad") && f.campaign ? (
          <FilterRow label="Focus">
            <span className="inline-flex h-8 max-w-full shrink-0 items-center gap-1 rounded-full bg-primary/15 pl-3 pr-1 text-xs font-medium ring-1 ring-inset ring-primary/40">
              <span className="truncate" dir="auto">
                {scope.level === "set"
                  ? `Ad set: ${f.set?.name}`
                  : `Ad: ${f.ad?.name}`}
              </span>
              <button
                type="button"
                onClick={() =>
                  onScope({ level: "campaign", campaign: scope.campaign })
                }
                aria-label="Show the whole campaign"
                className="no-touch relative inline-flex size-6 items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </span>
          </FilterRow>
        ) : null}
        <FilterRow label="Show">
          {MEASURES.filter(m => bookings || !m.booking).map(m => (
            <Pill
              key={m.key}
              active={shownMeasure === m.key}
              disabled={mixed && (m.key === "spend" || m.key === "cpl")}
              onClick={() => onMeasure(m.key)}
            >
              {m.label}
            </Pill>
          ))}
        </FilterRow>
        {mixed ? (
          <p className="text-xs text-muted-foreground">
            These campaigns spend in different currencies. Pick one campaign to
            see its spend and cost per lead.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div
            className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]"
            dir="auto"
          >
            {name}, {label}
          </div>
        </div>
        <div className="text-right text-2xl font-semibold tracking-tight tabular-nums">
          {head}
          <small className="block text-xs font-normal tracking-normal text-muted-foreground">
            {shownMeasure === "cpl" ? "for the period" : "in the period"}
          </small>
        </div>
      </div>

      {hasData ? (
        <div ref={measure$}>
          <ChartContainer
            config={{ y: { label: title } }}
            className="aspect-auto h-[200px] w-full text-[color:var(--chart-1)] @xl:h-[230px]"
            aria-label={`${title}, ${name}. The table below lists the same numbers.`}
          >
            <ComposedChart
              data={pts}
              margin={{ top: 28, right: 6, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="2 4" />
              <XAxis
                dataKey="key"
                tickFormatter={tick}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                fontSize={10.5}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                fontSize={10.5}
                allowDecimals={isMoney}
                tickFormatter={v => fmtY(Number(v), isMoney, currency)}
              />
              <ChartTooltip
                cursor={
                  shownMeasure === "leads" || shownMeasure === "booked"
                    ? { fill: "var(--muted)" }
                    : { stroke: "var(--border)" }
                }
                content={
                  <ChartTip
                    isMoney={isMoney}
                    currency={currency}
                    measure={shownMeasure}
                  />
                }
              />
              {pts
                .filter(p => p.changes.length)
                .map(p => (
                  <ReferenceLine
                    key={`mark-${p.key}`}
                    x={p.key}
                    stroke="var(--foreground)"
                    strokeOpacity={0.5}
                    strokeDasharray="2 3"
                    label={
                      labels.has(p.key) ? (
                        <MarkLabel text={labels.get(p.key) ?? ""} />
                      ) : undefined
                    }
                  />
                ))}
              {avg !== undefined ? (
                <ReferenceLine
                  y={avg}
                  stroke="var(--foreground)"
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                  label={{
                    value: `average ${money(avg, currency, true)}`,
                    position: "insideTopRight",
                    fill: "var(--muted-foreground)",
                    fontSize: 10.5,
                  }}
                />
              ) : null}
              {shownMeasure === "leads" || shownMeasure === "booked" ? (
                <Bar
                  dataKey="y"
                  fill="currentColor"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              ) : shownMeasure === "spend" ? (
                <Area
                  type="monotone"
                  dataKey="y"
                  stroke="currentColor"
                  strokeWidth={2}
                  fill="currentColor"
                  fillOpacity={0.14}
                  connectNulls={false}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="currentColor"
                  strokeWidth={2}
                  connectNulls={false}
                  // A day with no neighbours would vanish as a line: draw it as a dot.
                  dot={(d: { cx?: number; cy?: number; index?: number }) => {
                    const i = d.index ?? -1;
                    const alone =
                      pts[i]?.y !== null &&
                      pts[i - 1]?.y == null &&
                      pts[i + 1]?.y == null;
                    return alone && d.cx !== undefined && d.cy !== undefined ? (
                      <circle
                        key={`dot-${i}`}
                        cx={d.cx}
                        cy={d.cy}
                        r={3}
                        fill="currentColor"
                      />
                    ) : (
                      <g key={`dot-${i}`} />
                    );
                  }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ChartContainer>
        </div>
      ) : (
        <p className="flex h-[120px] items-center justify-center rounded-xl bg-muted/40 text-sm text-muted-foreground">
          {shownMeasure === "cpl"
            ? "No leads in this period."
            : "Nothing in this period."}
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-[13px] font-medium">What changed</h4>
        {series.changes.length ? (
          <ol className="space-y-2">
            {visible.map(ch => (
              <li
                key={`${ch.n}`}
                className="flex items-baseline gap-2.5 text-[13px]"
              >
                <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-foreground/50 text-[10px] font-semibold tabular-nums">
                  {ch.n}
                </span>
                <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                  {dayLabel(ch.day)}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {ch.action}
                  {ch.subject && ch.level !== "account" ? (
                    <span className="text-muted-foreground" dir="auto">
                      {" "}
                      · {ch.subject}
                    </span>
                  ) : null}
                  {scope.level === "all" &&
                  ch.campaigns.length === 1 &&
                  ch.level !== "campaign" ? (
                    <span className="text-muted-foreground" dir="auto">
                      {" "}
                      · {ch.campaigns[0]}
                    </span>
                  ) : null}
                  {ch.actor ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · by {ch.actor}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No changes in this period.
          </p>
        )}
        {series.changes.length > CHANGES_SHOWN ? (
          <button
            type="button"
            onClick={() => setAllChanges(v => !v)}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {allChanges
              ? "Show fewer changes"
              : `Show all ${series.changes.length} changes`}
          </button>
        ) : null}
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Show these numbers as a table
        </summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-xl border">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="px-3 py-2 font-normal">
                  {series.weekly ? "Week" : "Day"}
                </th>
                <th className="px-3 py-2 font-normal">Leads</th>
                <th className="px-3 py-2 font-normal">Spend</th>
                <th className="px-3 py-2 font-normal">Cost per lead</th>
                {bookings ? (
                  <th className="px-3 py-2 font-normal">Booked</th>
                ) : null}
                <th className="px-3 py-2 font-normal">Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pts.map(p => (
                <tr key={p.key}>
                  <td className="whitespace-nowrap px-3 py-1.5">{p.label}</td>
                  <td className="px-3 py-1.5">{p.leads}</td>
                  <td className="px-3 py-1.5">
                    {mixed ? "-" : money(p.spend, currency)}
                  </td>
                  <td className="px-3 py-1.5">
                    {!mixed && p.leads
                      ? money(p.spend / p.leads, currency, true)
                      : "-"}
                  </td>
                  {bookings ? (
                    <td className="px-3 py-1.5">
                      {model.bookingsReady ? p.booked : "-"}
                    </td>
                  ) : null}
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {p.changes.map(c => `${c.n}. ${c.action}`).join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <PillRow className="min-w-0 flex-1">{children}</PillRow>
    </div>
  );
}

function ChartTip({
  active,
  payload,
  isMoney,
  currency,
  measure,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  isMoney: boolean;
  currency?: string;
  measure: Measure;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const value =
    p.y === null
      ? measure === "cpl"
        ? "No leads"
        : "-"
      : isMoney
        ? money(p.y, currency, measure === "cpl")
        : String(p.y);
  return (
    <div className="max-w-64 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-sm dark:shadow-none">
      <div className="font-semibold">{p.label}</div>
      <div className="tabular-nums">{value}</div>
      {p.changes.slice(0, 4).map(c => (
        <div
          key={c.n}
          className="mt-1.5 flex items-baseline gap-2 text-muted-foreground"
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/50 text-[9.5px] font-semibold text-foreground">
            {c.n}
          </span>
          <span dir="auto">
            {c.action}
            {c.subject && c.level !== "account" ? ` · ${c.subject}` : ""}
          </span>
        </div>
      ))}
      {p.changes.length > 4 ? (
        <div className="mt-1 text-muted-foreground">
          and {p.changes.length - 4} more
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaign, then ad set, then ad.

function CampaignList({
  model,
  scope,
  onScope,
  sort,
  bookings,
  clientName,
}: {
  model: AdsModel;
  scope: Scope;
  onScope: (s: Scope) => void;
  sort: Measure;
  bookings: boolean;
  clientName: string;
}) {
  const active = model.campaigns
    .filter(c => c.active)
    .sort((x, y) => y.t.spend - x.t.spend);
  const quiet = model.campaigns.filter(c => !c.active);
  return (
    <div className="space-y-3">
      {active.length ? null : (
        <p className="text-sm text-muted-foreground">
          No ad spent or brought a lead in this period.
        </p>
      )}
      {active.map(c => (
        <CampaignCard
          key={c.name}
          c={c}
          model={model}
          scope={scope}
          onScope={onScope}
          sort={sort}
          bookings={bookings}
          clientName={clientName}
        />
      ))}
      {quiet.length ? (
        <details className="rounded-2xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-[13px] text-muted-foreground hover:text-foreground sm:px-6">
            {plural(quiet.length, "campaign")} did not spend in this period
          </summary>
          <ul className="space-y-2 px-4 pb-4 sm:px-6">
            {quiet.map(c => (
              <li key={c.name} className="flex items-center gap-2 text-[13px]">
                <Dot tone={c.tone} />
                <span className="min-w-0 flex-1">
                  <AmLink href={campaignUrl(c)}>{c.name}</AmLink>
                </span>
                <small className="shrink-0 text-xs text-muted-foreground">
                  {c.statusText}
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Spent, leads, cost per lead and booked, as one line of words. */
function Totals({
  t,
  currency,
  booked,
  className,
}: {
  t: Metrics;
  currency: string;
  booked: boolean;
  className?: string;
}) {
  const b = (v?: string | number) => (
    <b className="font-medium text-foreground tabular-nums">{v}</b>
  );
  return (
    <p
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>{b(money(t.spend, currency) ?? "-")} spent</span>
      <span>
        {b(t.leads)} {t.leads === 1 ? "lead" : "leads"}
      </span>
      {t.cpl !== undefined ? (
        <span>{b(money(t.cpl, currency, true))} a lead</span>
      ) : null}
      {booked ? <span>{b(t.booked)} booked</span> : null}
    </p>
  );
}

function CampaignCard({
  c,
  model,
  scope,
  onScope,
  sort,
  bookings,
  clientName,
}: {
  c: CampaignNode;
  model: AdsModel;
  scope: Scope;
  onScope: (s: Scope) => void;
  sort: Measure;
  bookings: boolean;
  clientName: string;
}) {
  // An ended campaign opens folded: its line says what it did in the period,
  // and its ads are a tap away.
  const [open, setOpen] = useState(!c.ended);
  const sets = [...c.sets].sort((x, y) => y.t.spend - x.t.spend);
  const spent = sets.filter(s => s.active);
  const quiet = sets.filter(s => !s.active);
  // The meter compares with the client's average, or the campaign's when the
  // client's campaigns spend in different currencies.
  const avg = model.currency ? model.t.cpl : c.t.cpl;
  return (
    <article className="@container overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-start gap-2 px-3 py-3.5 @xl:px-5">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Fold this campaign" : "Open this campaign"}
          onClick={() => setOpen(v => !v)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-90")}
          />
        </button>
        <div className="min-w-0 flex-1 pt-1">
          <AmLink href={campaignUrl(c)} className="text-sm font-semibold">
            {c.name}
          </AmLink>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[c.accountName, c.budgetText, plural(c.sets.length, "ad set")]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <Totals
            t={c.t}
            currency={c.currency}
            booked={bookings && model.bookingsReady}
            className="mt-1.5"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Chip tone={c.tone}>{c.statusText}</Chip>
          <ChartButton
            target={{ level: "campaign", campaign: c.name }}
            scope={scope}
            onScope={onScope}
            label="Show this campaign on the chart"
          />
        </div>
      </header>
      {open ? (
        <div className="border-t">
          {spent.map(s => (
            <SetBlock
              key={s.key}
              s={s}
              c={c}
              avg={avg}
              model={model}
              scope={scope}
              onScope={onScope}
              sort={sort}
              bookings={bookings}
              clientName={clientName}
            />
          ))}
          {quiet.length ? (
            <details className="border-t">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted-foreground hover:text-foreground @xl:px-6">
                {plural(quiet.length, "ad set")} did not spend in this period
              </summary>
              <ul className="space-y-2 px-4 pb-3 @xl:px-6">
                {quiet.map(s => (
                  <li
                    key={s.key}
                    className="flex items-center gap-2 text-[13px]"
                  >
                    <Dot tone={s.tone} />
                    <span className="min-w-0 flex-1">
                      <AmLink href={adSetUrl(s, c)}>{s.name}</AmLink>
                    </span>
                    <small className="shrink-0 text-xs text-muted-foreground">
                      {plural(s.ads.length, "ad")}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// One grid for the column labels and every ad, so the numbers line up. The
// columns appear once the card is wide enough; narrower, an ad reads as a
// line of words under its name.
const AD_GRID = "grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-3";
const AD_COLUMNS = {
  booked: "@2xl:grid-cols-[40px_minmax(0,1fr)_repeat(4,5.5rem)_7.5rem]",
  plain: "@2xl:grid-cols-[40px_minmax(0,1fr)_repeat(3,5.5rem)_7.5rem]",
};

function SetBlock({
  s,
  c,
  avg,
  model,
  scope,
  onScope,
  sort,
  bookings,
  clientName,
}: {
  s: SetNode;
  c: CampaignNode;
  avg?: number;
  model: AdsModel;
  scope: Scope;
  onScope: (s: Scope) => void;
  sort: Measure;
  bookings: boolean;
  clientName: string;
}) {
  const spent = s.ads.filter(a => a.active).sort(SORTS[sort]);
  const quiet = s.ads.filter(a => !a.active);
  const cols = bookings ? AD_COLUMNS.booked : AD_COLUMNS.plain;
  return (
    <div className="border-t first:border-t-0">
      <div className="flex items-start justify-between gap-3 bg-muted/40 px-4 py-2.5 @xl:px-6">
        <div className="min-w-0">
          <p className="text-[13px]">
            <span className="text-muted-foreground">Ad set </span>
            <AmLink href={adSetUrl(s, c)} className="font-medium">
              {s.name}
            </AmLink>
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <Dot tone={s.tone} />
            <span>{s.statusText}</span>
            {s.budgetText ? (
              <>
                <span aria-hidden>·</span>
                <span>{s.budgetText}</span>
              </>
            ) : null}
          </div>
          <Totals
            t={s.t}
            currency={c.currency}
            booked={bookings && model.bookingsReady}
            className="mt-1"
          />
        </div>
        <ChartButton
          target={{ level: "set", campaign: c.name, set: s.key }}
          scope={scope}
          onScope={onScope}
          label="Show this ad set on the chart"
        />
      </div>
      <div className="px-4 pb-1 @xl:px-6">
        <div
          aria-hidden
          className={cn(
            AD_GRID,
            cols,
            "hidden pt-2.5 pl-[34px] text-xs text-muted-foreground @2xl:grid",
          )}
        >
          <span />
          <span>Ad</span>
          <span className="text-right">Spent</span>
          <span className="text-right">Leads</span>
          <span className="text-right">Cost per lead</span>
          {bookings ? <span className="text-right">Booked</span> : null}
          <span />
        </div>
        <ul className="ads-tree">
          {spent.map(a => (
            <AdRow
              key={a.key}
              a={a}
              c={c}
              avg={avg}
              model={model}
              scope={scope}
              onScope={onScope}
              bookings={bookings}
              clientName={clientName}
              cols={cols}
            />
          ))}
        </ul>
      </div>
      {quiet.length ? (
        <details className="border-t">
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted-foreground hover:text-foreground @xl:px-6">
            {plural(quiet.length, "ad")} in this ad set did not spend in this
            period
          </summary>
          <ul className="space-y-2 px-4 pb-3 @xl:px-6">
            {quiet.map(a => (
              <li key={a.key} className="flex items-center gap-2.5 text-[13px]">
                <AdPicture a={a} c={c} clientName={clientName} size="sm" />
                <span className="min-w-0 flex-1">
                  <AmLink href={adUrl(a)}>{a.name}</AmLink>
                </span>
                <small className="shrink-0 text-xs text-muted-foreground">
                  {a.statusText}
                </small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Every ad shows a picture: the saved copy, Meta's, or one asked for now. */
function AdPicture({
  a,
  c,
  clientName,
  size,
}: {
  a: AdNode;
  c: CampaignNode;
  clientName: string;
  size: "sm" | "md";
}) {
  return (
    <CreativePreview
      name={a.name}
      metaAdId={a.id}
      accountId={a.accountId}
      stillUrl={a.stillUrl}
      stillTinyUrl={a.stillTinyUrl}
      thumbUrl={a.thumbUrl}
      campaignName={c.name}
      clientName={clientName}
      size={size}
      // An ad that still runs asks Meta for a missing picture; one that no
      // longer runs is not looked up (Muhammed, 2026-10-12).
      autoFetch={a.listed}
    />
  );
}

/** One number in an ad's row, in its column once the card is wide. */
function Num({ v, empty = "-" }: { v?: string | number; empty?: string }) {
  return (
    <span
      className={cn(
        "hidden pt-0.5 text-right tabular-nums @2xl:block",
        v === undefined ? "text-xs text-muted-foreground" : "text-sm",
      )}
    >
      {v ?? empty}
    </span>
  );
}

/**
 * One ad on one line: picture, name, verdict and the four numbers. "Details"
 * opens the rest: attended, cost per booking, the meter and the delivery
 * numbers.
 */
function AdRow({
  a,
  c,
  avg,
  model,
  scope,
  onScope,
  bookings,
  clientName,
  cols,
}: {
  a: AdNode;
  c: CampaignNode;
  avg?: number;
  model: AdsModel;
  scope: Scope;
  onScope: (s: Scope) => void;
  bookings: boolean;
  clientName: string;
  cols: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = c.currency;
  const ready = model.bookingsReady;
  // The same base as the cost per lead meter: the client, or the campaign
  // when the client's campaigns spend in different currencies.
  const avgCpb = model.currency ? model.t.cpb : c.t.cpb;
  return (
    <li className="border-t py-2.5 first:border-t-0">
      <div className={cn(AD_GRID, cols, "items-start gap-y-1")}>
        <AdPicture a={a} c={c} clientName={clientName} size="sm" />
        <div className="min-w-0">
          <AmLink href={adUrl(a)} className="text-sm font-medium">
            {a.name}
          </AmLink>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <Dot tone={a.tone} />
              <span>{a.statusText}</span>
            </span>
            <Verdict a={a} />
          </div>
          <Totals
            t={a.t}
            currency={cur}
            booked={bookings && ready}
            className="mt-1 @2xl:hidden"
          />
        </div>
        <Num v={money(a.t.spend, cur)} />
        <Num v={a.t.leads} />
        <Num v={money(a.t.cpl, cur, true)} empty="No leads" />
        {bookings ? (
          <Num v={ready ? a.t.booked : undefined} empty="Not imported" />
        ) : null}
        <div className="flex items-center justify-end gap-1">
          <ChartButton
            target={{ level: "ad", campaign: c.name, set: a.setKey, ad: a.key }}
            scope={scope}
            onScope={onScope}
            label="Show this ad on the chart"
          />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
            className="inline-flex h-8 items-center gap-0.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <span className="hidden @md:inline">Details</span>
            <span className="sr-only @md:hidden">Details</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-2.5 space-y-3 rounded-xl bg-muted/40 p-3 @2xl:ml-[52px]">
          <Stats
            t={a.t}
            currency={cur}
            bookings={bookings}
            ready={model.bookingsReady}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
            <div className="min-w-0 flex-[1_1_320px] space-y-2.5">
              <Meter t={a.t} avg={avg} currency={cur} className="" />
              {bookings && ready ? (
                <Meter
                  t={a.t}
                  avg={avgCpb}
                  currency={cur}
                  measure="cpb"
                  className=""
                />
              ) : null}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <SmallStat label="Link CTR" value={pct(a.t.linkCtr)} />
              <SmallStat label="CPM" value={money(a.t.cpm, cur, true)} />
              <SmallStat
                label="Frequency"
                value={
                  a.t.frequency !== undefined
                    ? a.t.frequency.toFixed(1)
                    : undefined
                }
              />
            </dl>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The media buyer's 7-day call on the ad, with the reason on hover or tap. */
function Verdict({ a, className }: { a: AdNode; className?: string }) {
  if (!a.verdict) return null;
  return (
    <Hint
      content={`Media buyer's call on the last 7 days.${a.verdict.reason ? ` ${a.verdict.reason}` : ""}`}
    >
      <button
        type="button"
        className={cn(
          "no-touch relative inline-flex h-6 cursor-help items-center gap-1.5 whitespace-nowrap rounded-full border bg-muted px-2.5 text-xs text-foreground after:absolute after:-inset-2 after:content-['']",
          className,
        )}
      >
        <Dot tone={a.verdict.tone} />
        {a.verdict.label}
      </button>
    </Hint>
  );
}

function SmallStat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value ?? (label === "Frequency" ? "-" : "Too few views")}
      </dd>
    </div>
  );
}
