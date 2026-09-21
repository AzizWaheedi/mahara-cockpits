import { Image as ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { BarList, type BarListItem } from "@/components/ceo/BarList";
import {
  type CustomRange,
  RangeControl,
  type RangeKey,
  rangeStart,
} from "@/components/ceo/chartKit";
import { type Column, DataTable } from "@/components/ceo/DataTable";
import { Delta, type DeltaKind, type GoodWhen } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import {
  change,
  count,
  date,
  diff,
  isNum,
  kuwaitDay,
  money,
  NA,
  pct,
  plural,
  type Unit,
} from "@/components/ceo/format";
import { DERIVED_NOTE, useGrowthWindow } from "@/components/ceo/growthWindow";
import { Na, Value } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { TimeSeriesChart } from "@/components/ceo/TimeSeriesChart";
import { useTimeframe } from "@/components/ceo/timeframe";
import { useFrequency } from "@/components/ceo/useFrequency";
import { range } from "@/components/ceo/windows";
import type { FrequencyFigure } from "../../../convex/ceo/frequency";
import type {
  FunnelWindow,
  GrowthPayload,
  Note,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

// --- Derived numbers, each null when its denominator is 0 ---

/** "20.5 h" or "35 min", a dash when there is none. */
function minutesText(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  return m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`;
}

/** Intro plus demo calls booked in the window. */
function bookedCalls(w: FunnelWindow): number {
  return w.introsBooked + w.demosBooked;
}

/** Leads that booked at least one call, over leads. Per lead, so it never passes 100%. */
function bookedRate(w: FunnelWindow): number | null {
  return w.leadToBooked.rate;
}

/**
 * Lead-gen ad spend per intro call shown, worked out here from two of the B2B
 * dashboard's own figures (`spend` and `intros_shown`). No B2B database
 * function returns a cost per intro, so this is not labelled as the
 * dashboard's. Null when the window has none, or the source gave no count.
 */
function costPerIntroShown(w: FunnelWindow): number | null {
  const n = w.raw.intros_shown;
  return isNum(n) && n > 0 ? w.spend / n : null;
}

/** Retargeting money, which the headline spend leaves out. Absent for a window the source did not give it for. */
function retargeting(w: FunnelWindow): number | null {
  const v = w.raw.spend_retargeting;
  return isNum(v) ? v : null;
}

// --- Notes: each caveat beside the card it qualifies ---

type CardKey = "spend" | "booked" | "ads" | "sources" | "daily";

/**
 * Caveats that qualify numbers on the Sales tab only, so they are not shown
 * here. The reps note also carries the top ads rule, which this tab states in
 * its own words on the ads card instead.
 */
const SALES_ONLY =
  /^reps:|rep scorecard|show rate|demos due|still marked confirmed|contracted and cash come from|closed-deal form/i;

/** Everything else lands on the spend card, so no marketing caveat is dropped. */
const NOTE_ROUTES: readonly (readonly [RegExp, CardKey])[] = [
  [/top ads/i, "ads"],
  [/lead sources/i, "sources"],
  [/daily series/i, "daily"],
  [/each stage is dated|ghl calls/i, "booked"],
];

function routeNotes(notes: Note[] | null | undefined) {
  const out: Partial<Record<CardKey, Note[]>> = {};
  for (const note of notes ?? []) {
    if (SALES_ONLY.test(note.text)) continue;
    const key = NOTE_ROUTES.find(([re]) => re.test(note.text))?.[1] ?? "spend";
    out[key] = [...(out[key] ?? []), note];
  }
  return out;
}

/** Caveats this tab owns: they belong to how the screen reads the numbers, not to the source. */
const OWN_NOTES: Record<CardKey, Note[]> = {
  spend: [
    {
      level: "info",
      text: "Cost per lead divides the lead-gen spend by leads. The retargeting figure beside it is separate money and is not in it.",
    },
  ],
  booked: [
    {
      level: "info",
      text: "Lead to booked call is per lead: the leads created in this window that have at least one intro or demo booked against their contact, whenever it was booked, over the leads created in this window. A lead booked twice counts once, so the rate never passes 100%. The booked-call counts beside it are dated by booking day, which is a different clock.",
    },
    {
      level: "info",
      text: "Cost per demo shown and cost per demo booked are the B2B dashboard's own figures: this window's lead-gen ad spend over demos shown, and over demos booked. Cost per intro shown is worked out here from two of the dashboard's figures: the same spend over intro calls shown. Retargeting money is in none of them.",
    },
  ],
  ads: [
    {
      level: "info",
      text: "The top 6 ads by spend over the last 7 days. This table includes retargeting spend, the opposite of the headline spend above, which is lead-gen only, so the two do not add up.",
    },
    {
      level: "info",
      text: "Leads are credited to an ad inside the B2B dashboard function. An ad with no lead tied to it shows n/a for cost per lead.",
    },
  ],
  sources: [
    {
      level: "info",
      text: "The three tiles split this month's leads by the ad id rule; the bars below are the raw source field, top 10, and a lead that arrived without one reads as no source recorded. GoHighLevel's first-touch attribution is empty on most contacts, so a true first click needs UTMs on the forms and the WhatsApp link, or a \"how did you find us\" answer at the form.",
    },
  ],
  daily: [
    {
      level: "info",
      text: "Days run to yesterday. Today is still running, so a part day would read as a drop on every chart and is left off.",
    },
  ],
};

function cardNotes(
  routed: Partial<Record<CardKey, Note[]>>,
  key: CardKey,
): Note[] {
  return [...OWN_NOTES[key], ...(routed[key] ?? [])];
}

// --- What marketing has no source for at all ---

const META_ONLY =
  "The cockpit reads the Meta ad snapshots for spend and leads only. A Meta insights pull carrying this column would be needed.";
const NO_ANALYTICS =
  "No web analytics source is connected to the cockpit at all.";

const NOT_MEASURED: { label: string; why: string }[] = [
  { label: "Impressions", why: META_ONLY },
  { label: "Clicks", why: META_ONLY },
  { label: "Click through rate", why: META_ONLY },
  { label: "Cost per click", why: META_ONLY },
  { label: "Landing page views", why: NO_ANALYTICS },
  { label: "Landing page conversion rate", why: NO_ANALYTICS },
  {
    label: "Email and owned social as lead sources",
    why: "Organic is split by the ad id rule on the sources card. Email and owned social carry no marker of their own on a contact, so they cannot be told apart from it.",
  },
  {
    label: "Hook rate, thumbstop and video views",
    why: "Creative level performance is not in the Meta snapshots and not in the Creative Triage project.",
  },
];

/** Metrics with no source at all: named, shown as n/a, each with what is missing. */
function NotMeasured({ order }: { order: number }) {
  return (
    <SectionCard
      kicker="Marketing"
      title="Not measured yet"
      order={order}
      bodyClassName="mt-4"
    >
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        These are the marketing numbers a CEO would normally ask for that no
        source the cockpit reads can give. They are named here rather than left
        off, so nobody hunts for a number that does not exist.
      </p>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {NOT_MEASURED.map(m => (
          <div key={m.label} className="min-w-0">
            <dt className="text-[13px] leading-5 text-muted-foreground">
              {m.label}
            </dt>
            <dd className="mt-0.5 min-w-0">
              <span className="text-base font-semibold tracking-tight">
                <Na hint={m.why} />
              </span>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {m.why}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}

// --- The tab ---

/** Marketing for Mahara itself: spend, leads, cost per lead and the calls they book. */
export function MarketingTab({ sections, now, day }: CeoTabProps) {
  const section = sections.growth;
  const payload = section?.payload ?? null;
  const today = day ?? kuwaitDay(now);
  const tf = useTimeframe("mtd");
  const gw = useGrowthWindow(payload, tf, today);
  const { current, previous } = gw;
  const notes = useMemo(() => routeNotes(payload?.notes), [payload]);
  const windowLabel = gw.bounds
    ? range(gw.bounds.from, gw.bounds.to)
    : "Timeframe";

  // With nothing to show, one card says so instead of five identical empty states.
  if (!payload)
    return (
      <div className="grid gap-5 lg:gap-7">
        <SectionCard title="Marketing" section={section}>
          {() => null}
        </SectionCard>
        <NotMeasured order={1} />
      </div>
    );

  return (
    <div className="grid gap-5 lg:gap-7">
      <TimeframeBar
        tf={tf}
        bounds={gw.bounds}
        compare={gw.compare}
        ariaLabel="Timeframe for spend, leads and calls booked"
        first={gw.first}
        last={gw.last}
        note={gw.derived ? DERIVED_NOTE : undefined}
      />

      <div className="grid gap-5 lg:gap-7 xl:grid-cols-12">
        <SectionCard
          kicker={windowLabel}
          title="Spend and leads"
          section={section}
          notes={cardNotes(notes, "spend")}
          order={0}
          className="xl:col-span-7"
        >
          {p => <SpendAndLeads w={current ?? p.windows.mtd} prev={previous} />}
        </SectionCard>
        <SectionCard
          kicker={windowLabel}
          title="Calls booked and cost per call"
          section={section}
          notes={cardNotes(notes, "booked")}
          order={1}
          className="xl:col-span-5"
        >
          {p => <CallsBooked w={current ?? p.windows.mtd} prev={previous} />}
        </SectionCard>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          Ads, sources and the trend
        </h2>
        <p className="text-xs text-muted-foreground">
          The ads table is always the last 7 days and the source bars this
          month; the charts and the reach card carry their own timeframe.
        </p>
      </div>

      <div className="grid gap-5 lg:gap-7 xl:grid-cols-12">
        <SectionCard
          kicker="Last 7 days"
          title="Ads by spend"
          section={section}
          notes={cardNotes(notes, "ads")}
          order={2}
          className="xl:col-span-7"
        >
          {p => <TopAds ads={p.topAds} />}
        </SectionCard>
        <SectionCard
          kicker="Month to date"
          title="Where leads come from"
          section={section}
          notes={cardNotes(notes, "sources")}
          order={3}
          className="xl:col-span-5"
        >
          {p => (
            <LeadSources sources={p.leadSources} w={current ?? p.windows.mtd} />
          )}
        </SectionCard>
      </div>

      <SectionCard
        kicker="Daily, through yesterday"
        title="Spend, leads and calls booked"
        section={section}
        notes={cardNotes(notes, "daily")}
        order={4}
      >
        {p => <DailyBody rows={p.daily} today={today} />}
      </SectionCard>

      <SectionCard
        kicker="Meta, over the timeframe chosen here"
        title="Reach and frequency"
        section={section}
        notes={FREQUENCY_NOTES}
        order={5}
      >
        {p => <FrequencyBody rows={p.daily} today={today} />}
      </SectionCard>

      <SectionCard
        kicker={`Last ${payload?.winningAds?.windowDays ?? 90} days, best first`}
        title="Winning ads"
        section={section}
        order={6}
      >
        {p => <WinningAdsBody p={p} />}
      </SectionCard>

      <NotMeasured order={7} />
    </div>
  );
}

// --- Card 1: spend and leads ---

function SpendAndLeads({
  w,
  prev,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
}) {
  const vs = prev ? `vs ${range(prev.from, prev.to)}` : undefined;
  const delta = (
    value: number | null,
    goodWhen: GoodWhen,
    kind: DeltaKind = "pct",
  ) =>
    prev && isNum(value) ? (
      <Delta value={value} goodWhen={goodWhen} kind={kind} vs={vs} />
    ) : undefined;

  const retarget = retargeting(w);

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
        <StatTile
          variant="plain"
          label="Lead-gen ad spend"
          value={money(w.spend)}
          delta={delta(change(w.spend, prev?.spend), "neither")}
          hint="What Mahara spends on its own lead-gen campaigns, as on the B2B dashboard overview. Days are the Meta ad account's reporting day. Money spent on client ads is a different pool and sits on the Delivery tab."
        />
        <StatTile
          variant="plain"
          label="Leads"
          value={count(w.leads)}
          delta={delta(change(w.leads, prev?.leads), "up")}
          sub={`${count(w.leadClasses.qualified)} qualified · ${count(w.leadClasses.unqualified)} unqualified`}
          hint="What the setters tagged in GoHighLevel, dated by the day the contact was created: ROAS qualified and ROAS unqualified are leads; ROAS unprepared is not ready and is shown but not counted; a contact with no ROAS tag yet is shown but not counted."
        />
        <StatTile
          variant="plain"
          label="Speed to lead"
          value={minutesText(
            w.speedToLead.workingMedianMin ?? w.speedToLead.medianMin,
          )}
          sub={`${typeof w.speedToLead.workingMedianMin === "number" ? `working hours · ${minutesText(w.speedToLead.medianMin)} on the plain clock · ` : ""}${count(w.speedToLead.called)} of ${count(w.speedToLead.leads)} leads called by a sales rep · ${count(w.speedToLead.neverCalled)} never called${w.speedToLead.within5Share !== null ? ` · ${pct(w.speedToLead.workingWithin5Share ?? w.speedToLead.within5Share)} within 5 min` : ""}`}
          hint="From the lead's creation to the first Maqsam call with it made by a sales rep on the roster (setter, closer or both), never a call-centre agent, matched by the CRM contact or the phone's last eight digits. On the working clock the time starts at the later of the lead's creation and the next working window and only working minutes count; the plain clock figure is beside it. The median over the leads that were called; the never-called are counted beside it, not inside it."
          naHint="No lead in this window has a sales rep's Maqsam call against it."
        />
        <StatTile
          variant="plain"
          label="Cost per lead"
          value={money(w.cpl)}
          delta={delta(change(w.cpl, prev?.cpl), "down")}
          naHint="No leads in this window, so there is no cost per lead."
        />
      </div>
      <Facts
        items={[
          {
            label: "Retargeting spend",
            value: money(retarget),
            hint: "Different money, never in cost per lead.",
          },
          { label: "Not ready", value: count(w.leadClasses.notReady) },
          { label: "Not yet tagged", value: count(w.leadClasses.untagged) },
        ]}
      />
    </div>
  );
}

// --- Card 2: calls booked ---

function CallsBooked({
  w,
  prev,
}: {
  w: FunnelWindow;
  prev: FunnelWindow | null;
}) {
  const vs = prev ? `vs ${range(prev.from, prev.to)}` : undefined;
  const delta = (
    value: number | null,
    goodWhen: GoodWhen,
    kind: DeltaKind = "pct",
  ) =>
    prev && isNum(value) ? (
      <Delta value={value} goodWhen={goodWhen} kind={kind} vs={vs} />
    ) : undefined;

  const booked = bookedCalls(w);
  const rate = bookedRate(w);
  const prevRate = prev ? bookedRate(prev) : null;
  const perIntro = costPerIntroShown(w);

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6">
        <StatTile
          variant="plain"
          label="Intro calls booked"
          value={count(w.introsBooked)}
          delta={delta(change(w.introsBooked, prev?.introsBooked), "up")}
          hint="Intro calls on a rep's calendar, dated by the day they were booked."
        />
        <StatTile
          variant="plain"
          label="Demos booked"
          value={count(w.demosBooked)}
          delta={delta(change(w.demosBooked, prev?.demosBooked), "up")}
          hint="Demos on a rep's calendar, dated by the day they were booked. What happens on the call is on the Sales tab."
        />
        <StatTile
          variant="plain"
          label="Lead to booked call"
          value={pct(rate)}
          delta={delta(diff(rate, prevRate), "up", "points")}
          sub={
            <span>
              {count(w.leadToBooked.bookedLeads)} of {plural(w.leads, "lead")}{" "}
              booked a call · {plural(booked, "call")} booked in the window
            </span>
          }
          hint="Leads created in this window with at least one intro or demo booked against their contact, ever, over the leads created in this window. Per lead, never per booking."
          naHint="No leads in this window, so there is no rate."
        />
        <StatTile
          variant="plain"
          label="Cost per demo shown"
          value={money(w.costPerDemo)}
          delta={delta(change(w.costPerDemo, prev?.costPerDemo), "down")}
          hint="The B2B dashboard's cost per demo: lead-gen ad spend in this window divided by the demos shown in it."
          naHint="No demos were shown in this window."
        />
      </div>
      <Facts
        items={[
          {
            label: "Cost per intro shown",
            value: money(perIntro),
            hint: "Lead-gen spend over intro calls shown; worked out here from two of the dashboard's figures.",
          },
          {
            label: "Cost per demo booked",
            value: money(w.costPerDemoBooked),
            hint: "The dashboard's own: lead-gen spend over demos booked.",
          },
          { label: "Calls booked", value: count(booked) },
        ]}
      />
    </div>
  );
}

// --- Card 3: ads ---

type Ad = GrowthPayload["topAds"][number];

const AD_COLUMNS: Column<Ad>[] = [
  {
    key: "name",
    header: "Ad",
    cell: a => (
      <span
        className="block min-w-0 max-w-[22rem] truncate text-foreground"
        title={a.name}
      >
        {a.name}
      </span>
    ),
    sortValue: a => a.name,
  },
  {
    key: "spend",
    header: "Spend",
    cell: a => money(a.spend),
    sortValue: a => a.spend,
    numeric: true,
  },
  {
    key: "leads",
    header: "Leads",
    cell: a => count(a.leads),
    sortValue: a => a.leads,
    numeric: true,
  },
  {
    key: "cpl",
    header: "Cost per lead",
    cell: a => (
      <Value
        value={money(a.cpl)}
        hint="No lead is tied to this ad in the last 7 days."
      />
    ),
    sortValue: a => a.cpl,
    numeric: true,
  },
];

function TopAds({ ads }: { ads: Ad[] }) {
  return (
    <DataTable
      rows={ads}
      columns={AD_COLUMNS}
      rowKey={(a, i) => `${a.name}-${i}`}
      initialSort={{ key: "spend", dir: "desc" }}
      caption="Top ads by spend over the last 7 days, with leads and cost per lead"
      emptyText="No ad spend in the last 7 days."
      stickyFirst
    />
  );
}

// --- Card 4: lead sources ---

function LeadSources({
  sources,
  w,
}: {
  sources: GrowthPayload["leadSources"];
  w: FunnelWindow;
}) {
  const items: BarListItem[] = sources.map((s, i) => ({
    key: `${s.source}-${i}`,
    label: s.source === "(none)" ? "No source recorded" : s.source,
    value: s.leads,
  }));
  const split = w.sources;
  const total = split.ads + split.organic + split.assumedAds;
  const share = (n: number) => (total > 0 ? pct(n / total) : NA);
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        <StatTile
          variant="plain"
          label="Ads"
          value={count(split.ads)}
          sub={share(split.ads)}
          hint="Leads whose contact carries an ad id, or whose GoHighLevel attribution carries one (a click-to-message ad puts it in mediumId)."
        />
        <StatTile
          variant="plain"
          label="Organic"
          value={count(split.organic)}
          sub={share(split.organic)}
          hint="Leads with no ad id whose source, tags or attribution medium say inbound WhatsApp, Instagram DM, YouTube, referral or organic."
        />
        <StatTile
          variant="plain"
          label="Ads, assumed"
          value={count(split.assumedAds)}
          sub={share(split.assumedAds)}
          hint="Leads with no ad id and nothing that says organic. They are counted as ads because that is where nearly every lead comes from, and labelled assumed because nothing proves it."
        />
      </div>
      <BarList
        items={items}
        format={count}
        limit={10}
        ariaLabel="Leads by source this month"
        emptyText="No leads this month yet."
      />
    </div>
  );
}

// --- Card 5: the trend ---

const DAILY_SERIES: {
  key: "spend" | "leads" | "booked";
  title: string;
  unit: Unit;
  noun: string;
}[] = [
  {
    key: "spend",
    title: "Lead-gen ad spend",
    unit: "money",
    noun: "Lead-gen ad spend",
  },
  { key: "leads", title: "Leads", unit: "count", noun: "Leads created" },
  {
    key: "booked",
    title: "Calls booked",
    unit: "count",
    noun: "Intro and demo calls booked",
  },
];

function DailyBody({
  rows,
  today,
}: {
  rows: GrowthPayload["daily"];
  today: string;
}) {
  // Today is still running; a partial last day would read as a drop on every chart.
  const days = rows.filter(r => r.date < today);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const span = first && last ? `from ${date(first)} to ${date(last)}` : "";

  return (
    <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
      {DAILY_SERIES.map(s => (
        <TimeSeriesChart
          initialRange="90d"
          key={s.key}
          data={days}
          series={[{ key: s.key, label: s.title }]}
          unit={s.unit}
          title={s.title}
          height={180}
          syncId="ceo-marketing-daily"
          ariaLabel={`${s.noun} per day ${span}.`}
          emptyText="No days to plot yet."
        />
      ))}
    </div>
  );
}

// --- Card 6: reach and frequency, straight from Meta for the chosen window ---

const FREQUENCY_NOTES: Note[] = [
  {
    level: "info",
    text: "Frequency is impressions over the distinct people reached in the whole timeframe, read from Meta for that timeframe. It cannot be added up from daily rows, because the same person on two days is one person. Lead-gen and retargeting campaigns are sorted by name the way the B2B dashboard sorts them; hiring campaigns are left out.",
  },
  {
    level: "info",
    text: "The timeframe choices are the same as the charts above; days run to yesterday. A new timeframe is read from Meta once and kept for three hours.",
  },
];

function FrequencyBody({
  rows,
  today,
}: {
  rows: GrowthPayload["daily"];
  today: string;
}) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("90d");
  const [custom, setCustom] = useState<CustomRange>({ from: "", to: "" });
  const days = rows.filter(r => r.date < today);
  const first = days[0]?.date ?? null;
  const last = days[days.length - 1]?.date ?? null;
  let from: string | null = null;
  let to: string | null = null;
  if (rangeKey === "custom") {
    from = custom.from || null;
    to = custom.to || null;
  } else if (last) {
    from = rangeStart(rangeKey, last) ?? first;
    to = last;
  }
  const { read, loading, error } = useFrequency(from, to);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          {from && to ? (
            <span className="font-medium text-foreground">
              {range(from, to)}
            </span>
          ) : (
            "Pick both dates"
          )}
          {loading ? ", reading Meta" : ""}
        </p>
        <RangeControl
          range={rangeKey}
          onRange={setRangeKey}
          custom={custom}
          onCustom={setCustom}
          first={first}
          last={last}
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive">
          Meta could not be read for this timeframe: {error}
        </p>
      ) : null}
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <FrequencyFigureTiles
          title="Lead-gen campaigns"
          figure={read?.leadGen ?? null}
          stale={read !== null && (read.from !== from || read.to !== to)}
        />
        <FrequencyFigureTiles
          title="Retargeting campaigns"
          figure={read?.retargeting ?? null}
          stale={read !== null && (read.from !== from || read.to !== to)}
        />
      </div>
    </div>
  );
}

function FrequencyFigureTiles({
  title,
  figure,
  stale,
}: {
  title: string;
  figure: FrequencyFigure | null;
  stale: boolean;
}) {
  const na = figure
    ? undefined
    : "No campaign of this kind on the account, or Meta has not answered yet.";
  return (
    <section aria-label={title} className={stale ? "opacity-60" : undefined}>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <StatTile
          variant="plain"
          label="Frequency"
          value={
            figure?.frequency !== null && figure?.frequency !== undefined
              ? `${figure.frequency.toFixed(1)}x`
              : NA
          }
          hint="Impressions over the distinct people reached in this timeframe, as Meta computes it."
          naHint={na ?? "Nobody was reached in this timeframe."}
        />
        <StatTile
          variant="plain"
          label="People reached"
          value={figure ? count(figure.reach) : NA}
          naHint={na}
        />
        <StatTile
          variant="plain"
          label="Impressions"
          value={figure ? count(figure.impressions) : NA}
          naHint={na}
        />
        <StatTile
          variant="plain"
          label="Spend"
          value={figure ? money(figure.spend) : NA}
          sub={figure ? plural(figure.campaigns, "campaign") : undefined}
          naHint={na}
        />
      </div>
    </section>
  );
}

/**
 * Our own ads, judged on what they produced.
 *
 * Ranked closes first, then demos, then leads, because the biggest spender is
 * rarely the winner: the best ad here turned $2,256 into 46 demos and 4 closes
 * while one costing nearly as much produced none.
 */
function WinningAdsBody({ p }: { p: GrowthPayload }) {
  const w = p.winningAds;
  if (!w?.rows.length)
    return (
      <EmptyState
        title="No ad rows yet"
        text="They arrive on the next refresh."
        icon={ImageIcon}
        compact
      />
    );

  // Two ads can carry the same name (a relaunch under a new id), so say which
  // rows share one rather than let the reader think a number contradicts itself.
  const seen = new Map<string, number>();
  for (const r of w.rows) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-md border">
        <table
          className="w-full text-sm"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">Ad</th>
              <th className="p-2 text-right font-medium">Spend</th>
              <th className="p-2 text-right font-medium">Leads</th>
              <th className="p-2 text-right font-medium">Cost/lead</th>
              <th className="p-2 text-right font-medium">Qualified</th>
              <th className="p-2 text-right font-medium">Demos</th>
              <th className="p-2 text-right font-medium">Cost/demo</th>
              <th className="p-2 text-right font-medium">Closes</th>
              <th className="p-2 text-right font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {w.rows.map(r => (
              <tr key={r.adId} className="border-t align-middle">
                <td className="p-2">
                  <div className="flex items-center gap-3">
                    {r.thumbnail ? (
                      // Facebook serves these on an expiring link, so a broken
                      // one is not a fault in the data: drop it and keep the row.
                      <img
                        src={r.thumbnail}
                        alt=""
                        loading="lazy"
                        className="size-10 shrink-0 rounded object-cover"
                        onError={e => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          r.inMeta ? null : "Meta has no snapshot",
                          (seen.get(r.name) ?? 0) > 1
                            ? "two ads share this name"
                            : null,
                          r.status?.includes("PAUSED") ? "paused" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="p-2 text-right">
                  {r.inMeta ? (
                    money(r.spend)
                  ) : (
                    <span className="text-muted-foreground">unknown</span>
                  )}
                </td>
                <td className="p-2 text-right">{count(r.leads)}</td>
                <td className="p-2 text-right">
                  <Value value={r.cpl === null ? NA : money(r.cpl)} />
                </td>
                <td className="p-2 text-right">
                  {count(r.qualified)}
                  {r.qualifiedPct === null ? null : (
                    <span className="block text-xs text-muted-foreground">
                      {`${r.qualifiedPct}%`}
                    </span>
                  )}
                </td>
                <td className="p-2 text-right">{count(r.demos)}</td>
                <td className="p-2 text-right">
                  <Value
                    value={r.costPerDemo === null ? NA : money(r.costPerDemo)}
                  />
                </td>
                <td className="p-2 text-right font-medium">
                  {r.sales > 0 ? count(r.sales) : "—"}
                </td>
                <td className="p-2 text-right">
                  {r.revRoas === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `${r.revRoas.toFixed(1)}x`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
