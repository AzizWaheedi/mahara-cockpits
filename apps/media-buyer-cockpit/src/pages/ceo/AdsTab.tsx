import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChartColumn,
  ChevronRight,
  Columns3,
  Loader2,
  Megaphone,
  Table2,
  TriangleAlert,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CreativePreview } from "@/components/CreativePreview";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  count,
  countCompact,
  humanize,
  money,
  pct,
  plural,
} from "@/components/ceo/format";
import { LINK_CTR, LINK_CTR_HINT } from "@/components/ceo/linkCtr";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import {
  gateLabel,
  gateTone,
  StatusChip,
  StatusDot,
} from "@/components/ceo/StatusChip";
import { useServerWindow } from "@/components/ceo/serverWindow";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { useTimeframe } from "@/components/ceo/timeframe";
import { rereadCeoSections, STALE_AFTER_MS } from "@/components/ceo/useCeo";
import { range as rangeText } from "@/components/ceo/windows";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bAdWindow,
  B2bVerdict,
} from "@/types/ceo/payloads";
import {
  CONFIRMED_INTROS_HINT,
  COVERAGE_HINT,
  constraintText,
  coverageLine,
  Fact,
  FIT_HINT,
  frequencyFact,
  frequencyHint,
  INTROS_HINT,
  introFigures,
  LEAD_TO_INTRO_HINT,
  LEADS_HINT,
  NA_ZERO,
  Num,
  People,
  RETIRED_STAGES,
  type StageFact,
  TONE,
  verdictChips,
  verdictLabel,
} from "./adsFacts";
import { ManageBar, ManagePanel, type Target } from "./adsManage";
import { EXTRA_COLS, MetricPicker, useExtraMetrics } from "./adsMetrics";
import {
  anyTurnedOn,
  heldSentence,
  heldWord,
  isHeld,
  liveHolds,
  liveStatusAt,
  metaReadAt,
  newerSwitches,
  nextRefreshAt,
  OnNotRunning,
  onIds,
  REREAD_EVERY_MS,
  RowSwitch,
  rereadDelay,
  type SetStatus,
  type SwitchClock,
  SwitchNote,
  settleSwitches,
  switchedOn,
  UnlessHeld,
  useSwitches,
} from "./adsSwitch";
import { LaunchCard } from "./LaunchCard";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own ad account, read the way the old B2B dashboard read it and
 * further: the funnel from the impression to the signed contract, with the
 * unit cost at each stage, the conversion between stages, the stage that is
 * holding a campaign back, and the people who worked its calls. A switch on
 * every row. Per ad the calls stop at the intro (the CEO, 2026-10-18: "the
 * link to intro, that's it"): intros and confirmed intros, each lead once.
 * Demos are read on the Sales tab.
 *
 * Two ways to look at it. The funnel view lists the campaigns: a campaign
 * that spent carries the full stage-by-stage ribbon, and its ad sets and ads
 * carry one line each (spend, leads, cost per lead, the verdict). The table
 * view is the old dashboard's marketing lab: every ad in one sortable table
 * with every stage, so the eye can run down a column.
 */

type Win = "w7" | "w30";
type View = "funnel" | "table";

/** Whose problem a verdict is, as a plain label beside it. */
const OWNER: Record<NonNullable<B2bVerdict["owner"]>, string> = {
  ads: "Ad to fix",
  setter: "Setter to fix",
  closer: "Closer to fix",
};

const CONSTRAINT_OWNER: Record<string, string> = {
  ads: "the creative",
  landing: "the landing page",
  setter: "the setter",
  closer: "the closer",
};

/**
 * Which ribbon stage a constraint points at. A stage that read appointments
 * or demos (RETIRED_STAGES) is left off the screen until the next refresh.
 */
const CONSTRAINT_STAGE: Record<string, string> = {
  "impressions to link clicks": "clicks",
  "clicks to leads": "leads",
  "leads to intros": "intros",
  // The label before 2026-10-18, on a payload stored before then.
  "leads to intros booked": "intros",
  "intros to confirmed intros": "confirmed",
};

/** The cost per lead gate every tab judges against. */
const CPL_GATE = 15;

function adsManagerUrl(
  account: string,
  level: "campaign" | "adset" | "ad",
  id: string,
) {
  const key =
    level === "campaign"
      ? "selected_campaign_ids"
      : level === "adset"
        ? "selected_adset_ids"
        : "selected_ad_ids";
  return `https://adsmanager.facebook.com/adsmanager/manage/${level === "ad" ? "ads" : level === "adset" ? "adsets" : "campaigns"}?act=${account}&${key}=${id}`;
}

/** A rate or unit cost, or null when its denominator is zero, which the screen shows as the explained n/a. */
const dash = (v: number | null, f: (x: number) => string) =>
  v === null ? null : f(v);
// Round half up first: toFixed(1) alone shows 19.45 as 19.4 (binary floats).
const times = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}×`;
const x = (v: number | null) => (v === null ? null : times(v));

type Stage = {
  key: string;
  label: string;
  /** The count; the explained n/a on a payload that does not carry it. */
  value: ReactNode;
  /** Label-first rates and unit costs for this stage, e.g. "Show rate 60%", "Cost $40". */
  facts: StageFact[];
  /** What the stage counts, on hover. */
  hint?: string;
};

/** `freqHint` names whose frequency it is and the days it covers (`frequencyHint`). */
function stagesOf(w: B2bAdWindow, freqHint: string): Stage[] {
  const i = introFigures(w);
  return [
    {
      key: "impressions",
      label: "Impressions",
      value: countCompact(w.impressions),
      facts: [
        { label: "CPM", v: w.cpm, f: money },
        ...frequencyFact(w, freqHint),
      ],
    },
    {
      key: "clicks",
      label: "Link clicks",
      value: countCompact(w.linkClicks),
      facts: [
        { label: LINK_CTR, v: w.ctrLink, f: pct },
        { label: "CPC", v: w.cpc, f: money },
      ],
      hint: LINK_CTR_HINT,
    },
    {
      key: "leads",
      label: "Leads",
      value: count(w.leads),
      facts: [
        {
          label: "Click to lead",
          v:
            w.linkClicks !== null && w.linkClicks > 0
              ? w.leads / w.linkClicks
              : null,
          f: pct,
        },
        { label: "CPL", v: w.cpl, f: money },
        ...(w.leads
          ? [{ label: "Fit", v: w.qualifiedPct, f: pct, hint: FIT_HINT }]
          : []),
        ...(w.metaLeads !== w.leads
          ? [{ label: "Meta", v: w.metaLeads, f: count }]
          : []),
      ],
      hint: LEADS_HINT,
    },
    {
      key: "intros",
      label: "Intros",
      value: i.intros === null ? <Na hint={i.na} /> : count(i.intros),
      facts: [
        {
          label: "Lead to intro",
          v: i.leadToIntro,
          f: pct,
          hint: LEAD_TO_INTRO_HINT,
          na: i.na,
        },
        { label: "Cost", v: i.costPerIntro, f: money, na: i.na },
      ],
      hint: INTROS_HINT,
    },
    {
      // Out of the intros above it, so the step reads at a glance: "2 of 9".
      key: "confirmed",
      label: "Confirmed intros",
      value:
        i.confirmed === null ? (
          <Na hint={i.na} />
        ) : (
          `${count(i.confirmed)}${i.intros ? ` of ${count(i.intros)}` : ""}`
        ),
      facts: [
        { label: "Of intros", v: i.confirmedShare, f: pct, na: i.na },
        { label: "Cost", v: i.costPerConfirmed, f: money, na: i.na },
      ],
      hint: CONFIRMED_INTROS_HINT,
    },
    {
      key: "signed",
      label: "Signed",
      value: count(w.closes),
      facts: [{ label: "CAC", v: w.cac, f: money }],
      hint: "Signed deals credited to the ad. CAC is spend over signed.",
    },
    {
      key: "revenue",
      label: "Contracted",
      value: money(w.contracted),
      facts: [
        { label: "ROAS", v: w.roas, f: times },
        { label: "Cash ROAS", v: w.cashRoas, f: times },
      ],
      hint: "ROAS is contracted over spend; cash ROAS is cash collected over spend.",
    },
  ];
}

/**
 * The funnel as a grid of stages that wraps to the width it has: the stage,
 * its count, then its rates and unit costs, label first. Two across on a
 * phone, three on a tablet, five on a laptop, and the reading order never
 * changes. A campaign's ribbon, which opens with its spend, is two rows of
 * four on a laptop: what Meta delivered, then what the CRM made of it, so
 * intros and confirmed intros always sit side by side. The stage a campaign
 * is stuck on is outlined, so the eye lands on the fix. The spend leads the
 * ribbon unless a tile beside it already shows it.
 */
function FunnelRibbon({
  w,
  freqHint,
  spend,
  constraint,
}: {
  w: B2bAdWindow;
  /** The frequency fact's hint, from `frequencyHint` for this window. */
  freqHint: string;
  spend?: number;
  constraint?: string | null;
}) {
  const stuck = constraint ? CONSTRAINT_STAGE[constraint] : undefined;
  const cells: Stage[] = [
    ...(spend === undefined
      ? []
      : [{ key: "spend", label: "Spend", value: money(spend), facts: [] }]),
    ...stagesOf(w, freqHint),
  ];
  return (
    <ol
      aria-label="The funnel, stage by stage"
      className={cn(
        "-mx-2 grid grid-cols-2 gap-2 tabular-nums @md:grid-cols-3",
        cells.length === 8 ? "@2xl:grid-cols-4" : "@2xl:grid-cols-5",
      )}
    >
      {cells.map(s => {
        const isStuck = stuck === s.key;
        return (
          <li
            key={s.key}
            title={s.hint}
            className={cn(
              "flex min-w-0 flex-col rounded-lg px-2 py-1.5",
              isStuck &&
                "bg-[color-mix(in_srgb,var(--ceo-serious)_8%,transparent)] ring-1 ring-[var(--ceo-serious)]",
            )}
          >
            <span className="truncate text-xs text-muted-foreground">
              {s.label}
              {isStuck ? (
                <span className="sr-only">, the stage holding it back</span>
              ) : null}
            </span>
            <span className="truncate text-base font-semibold text-foreground">
              {s.value}
            </span>
            {s.facts.length ? (
              <span className="flex flex-wrap gap-x-3 text-xs leading-5 text-muted-foreground">
                {s.facts.map(f => (
                  <Fact key={f.label} label={f.label} hint={f.hint}>
                    <Num v={f.v} f={f.f} na={f.na} />
                  </Fact>
                ))}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Anything to read in a window: spend, or a lead or close it produced. An intro is always a lead's. */
function hasActivity(w: B2bAdWindow): boolean {
  return w.spend > 0 || w.leads > 0 || w.closes > 0;
}

/**
 * Spend, leads and cost per lead on one quiet line: what an ad set or an ad
 * needs at a glance. Intros and confirmed intros follow when there are leads
 * (each lead once), and signed deals when there are any, so neither is
 * hidden behind the table view.
 */
function CompactLine({
  w,
  children,
}: {
  w: B2bAdWindow;
  children?: ReactNode;
}) {
  const i = introFigures(w);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      <Fact label="Spend">{money(w.spend)}</Fact>
      <Fact label="Leads">{count(w.leads)}</Fact>
      <Fact label="CPL">
        <Num v={w.cpl} f={money} />
      </Fact>
      {w.leads > 0 ? (
        <>
          <Fact label="Intros" hint={INTROS_HINT}>
            <Num v={i.intros} f={count} na={i.na} />
          </Fact>
          <Fact label="Confirmed" hint={CONFIRMED_INTROS_HINT}>
            <Num v={i.confirmed} f={count} na={i.na} />
          </Fact>
        </>
      ) : null}
      {w.closes > 0 ? <Fact label="Signed">{count(w.closes)}</Fact> : null}
      {children}
    </div>
  );
}

/** The one link out to Ads Manager a row carries, then its switch. */
function RowControls({
  href,
  children,
}: {
  href?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label="Open in Ads Manager"
          title="Open in Ads Manager"
          className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      ) : null}
      {children}
    </div>
  );
}

/** The expand button of a campaign or ad set row: one chevron that turns. */
function ExpandButton({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-90",
        )}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </button>
  );
}

type RowProps = {
  win: Win;
  account: string;
  onDone: (m: string | null) => void;
  payload: B2bAdsPayload;
  target: Target | null;
  onOpen: (t: Target | null) => void;
  frozen: string | null;
  /** When the payload last read Meta, what it shows on, and the next refresh, for the switches. */
  clock: SwitchClock;
  setStatus: SetStatus;
};

function AdRow({ ad, ...r }: RowProps & { ad: B2bAdNode }) {
  const w = ad[r.win];
  const owner =
    ad.verdict.owner && ad.verdict.owner !== "ads"
      ? OWNER[ad.verdict.owner]
      : null;
  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <CreativePreview
          name={ad.name}
          metaAdId={ad.id}
          accountId={r.account}
          thumbUrl={ad.thumbnail ?? undefined}
          size="sm"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 pt-1.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
              {ad.name}
            </p>
            <RowControls href={adsManagerUrl(r.account, "ad", ad.id)}>
              <RowSwitch
                metaId={ad.id}
                level="ad"
                name={ad.name}
                running={switchedOn(ad)}
                clock={r.clock}
                setStatus={r.setStatus}
                onDone={r.onDone}
              />
            </RowControls>
          </div>
          <SwitchNote metaId={ad.id} clock={r.clock} />
          {/* A change Meta confirmed since this read: the verdict is about the
              state before it, so its chip and its sentence wait for the payload. */}
          <CompactLine w={w}>
            <UnlessHeld metaId={ad.id} clock={r.clock}>
              <StatusChip
                tone={TONE[ad.verdict.verdict]}
                label={verdictLabel(ad.verdict.verdict)}
              />
              {owner ? <span>{owner}</span> : null}
            </UnlessHeld>
          </CompactLine>
          <UnlessHeld metaId={ad.id} clock={r.clock}>
            <p className="text-xs text-muted-foreground">{ad.verdict.reason}</p>
          </UnlessHeld>
          <People p={ad.people} windows={r.payload.windows} />
          <ManageBar
            level="ad"
            id={ad.id}
            name={ad.name}
            open={r.target}
            onOpen={r.onOpen}
            frozen={r.frozen}
          />
        </div>
      </div>
      {r.target?.id === ad.id ? (
        <div className="mt-3">
          <ManagePanel
            target={r.target}
            payload={r.payload}
            onClose={() => r.onOpen(null)}
            onDone={r.onDone}
          />
        </div>
      ) : null}
    </div>
  );
}

function AdsetRow({
  s,
  open,
  onToggle,
  ...r
}: RowProps & {
  s: B2bAdsPayload["campaigns"][number]["adsets"][number];
  open: boolean;
  onToggle: () => void;
}) {
  const sw = s[r.win];
  return (
    <div className="py-3">
      <div className="flex items-start gap-2">
        <ExpandButton open={open} onClick={onToggle}>
          <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
            {s.name}
          </span>
          <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
            {plural(s.ads.length, "ad")}
          </span>
        </ExpandButton>
        <RowControls>
          <RowSwitch
            metaId={s.id}
            level="adset"
            name={s.name}
            running={switchedOn(s)}
            clock={r.clock}
            setStatus={r.setStatus}
            onDone={r.onDone}
          />
        </RowControls>
      </div>
      <div className="mt-1.5 space-y-2 pl-6">
        <SwitchNote metaId={s.id} clock={r.clock} />
        <OnNotRunning node={s} clock={r.clock} />
        <CompactLine w={sw} />
        <ManageBar
          level="adset"
          id={s.id}
          name={s.name}
          open={r.target}
          onOpen={r.onOpen}
          frozen={r.frozen}
        />
        {r.target?.id === s.id ? (
          <ManagePanel
            target={r.target}
            payload={r.payload}
            onClose={() => r.onOpen(null)}
            onDone={r.onDone}
          />
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 divide-y @md:pl-6">
          {s.ads.map(a => (
            <AdRow key={a.id} ad={a} {...r} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CampaignRow({
  c,
  ...r
}: RowProps & { c: B2bAdsPayload["campaigns"][number] }) {
  const [open, setOpen] = useState(c.running);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const w = c[r.win];
  const adCount = c.adsets.reduce((n, a) => n + a.ads.length, 0);
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      {/* The switch and the link sit beside the button, not inside it: a button cannot hold another control. */}
      <div className="flex items-start gap-2">
        <ExpandButton open={open} onClick={() => setOpen(v => !v)}>
          <span className="block font-semibold text-foreground [overflow-wrap:anywhere]">
            {c.name}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StatusChip
              tone={
                c.type === "lead_gen"
                  ? "good"
                  : c.type === "retargeting"
                    ? "neutral"
                    : "warning"
              }
              label={humanize(c.type)}
            />
            <span>{`${plural(c.adsets.length, "ad set")} · ${plural(adCount, "ad")}`}</span>
          </span>
        </ExpandButton>
        <RowControls href={adsManagerUrl(r.account, "campaign", c.id)}>
          <RowSwitch
            metaId={c.id}
            level="campaign"
            name={c.name}
            running={switchedOn(c)}
            clock={r.clock}
            setStatus={r.setStatus}
            onDone={r.onDone}
          />
        </RowControls>
      </div>
      <div className="@container mt-3 space-y-3 pl-6">
        <SwitchNote metaId={c.id} clock={r.clock} />
        <OnNotRunning node={c} clock={r.clock} />
        {c.constraint && !RETIRED_STAGES.has(c.constraint.stage) ? (
          <p className="flex items-start gap-1.5 text-xs">
            <TriangleAlert
              className="mt-0.5 size-3.5 shrink-0"
              style={{ color: "var(--ceo-serious)" }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">
                {`Stuck at ${CONSTRAINT_OWNER[c.constraint.owner]}: `}
              </span>
              <span className="text-muted-foreground">
                {constraintText(c.constraint, r.payload.windows)}
              </span>
            </span>
          </p>
        ) : null}
        {/* The full ribbon only where there is spend to read; a campaign that spent nothing in the window gets the one line. */}
        {w.spend > 0 ? (
          <FunnelRibbon
            w={w}
            freqHint={frequencyHint(r.payload.windows, r.win)}
            spend={w.spend}
            constraint={c.constraint?.stage ?? null}
          />
        ) : (
          <CompactLine w={w} />
        )}
        <People p={c.people} windows={r.payload.windows} />
        <ManageBar
          level="campaign"
          id={c.id}
          name={c.name}
          open={r.target}
          onOpen={r.onOpen}
          frozen={r.frozen}
        />
        {r.target?.id === c.id ? (
          <ManagePanel
            target={r.target}
            payload={r.payload}
            onClose={() => r.onOpen(null)}
            onDone={r.onDone}
          />
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 divide-y border-t pl-6">
          {c.adsets.map(s => {
            const so = openSets[s.id] ?? s.running;
            return (
              <AdsetRow
                key={s.id}
                s={s}
                open={so}
                onToggle={() => setOpenSets(m => ({ ...m, [s.id]: !so }))}
                {...r}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---- the table: every ad in one sortable grid, the old marketing lab -------

type Col = {
  key: string;
  label: string;
  title?: string;
  get: (w: B2bAdWindow) => number | null;
  fmt: (v: number) => string;
  /** Lower is better, so the sort arrow and the tint read the right way. */
  low?: boolean;
  /** An intro figure: n/a on a payload stored before intros were counted once per lead. */
  intro?: boolean;
};

const COLS: Col[] = [
  { key: "spend", label: "Spend", get: w => w.spend, fmt: money },
  {
    key: "impressions",
    label: "Impr.",
    get: w => w.impressions,
    fmt: countCompact,
  },
  { key: "cpm", label: "CPM", get: w => w.cpm, fmt: money, low: true },
  {
    key: "ctrLink",
    label: LINK_CTR,
    title: LINK_CTR_HINT,
    get: w => w.ctrLink,
    fmt: pct,
  },
  { key: "cpc", label: "CPC", get: w => w.cpc, fmt: money, low: true },
  {
    key: "leads",
    label: "Leads",
    title: "Leads that reached the CRM",
    get: w => w.leads,
    fmt: count,
  },
  { key: "cpl", label: "CPL", get: w => w.cpl, fmt: money, low: true },
  {
    key: "qualifiedPct",
    label: "Fit",
    title: FIT_HINT,
    get: w => w.qualifiedPct,
    fmt: pct,
  },
  {
    key: "intros",
    label: "Intros",
    title: INTROS_HINT,
    get: w => introFigures(w).intros,
    fmt: count,
    intro: true,
  },
  {
    key: "costPerIntro",
    label: "$/intro",
    title: "Spend over intros, each lead once",
    get: w => introFigures(w).costPerIntro,
    fmt: money,
    low: true,
    intro: true,
  },
  {
    key: "confirmed",
    label: "Confirmed",
    title: CONFIRMED_INTROS_HINT,
    get: w => introFigures(w).confirmed,
    fmt: count,
    intro: true,
  },
  {
    key: "confirmedShare",
    label: "Of intros",
    title: "Confirmed intros over intros, each lead once",
    get: w => introFigures(w).confirmedShare,
    fmt: pct,
    intro: true,
  },
  {
    key: "costPerConfirmed",
    label: "$/confirmed",
    title: "Spend over confirmed intros, each lead once",
    get: w => introFigures(w).costPerConfirmed,
    fmt: money,
    low: true,
    intro: true,
  },
  { key: "closes", label: "Signed", get: w => w.closes, fmt: count },
  {
    key: "cac",
    label: "CAC",
    title: "Spend over signed",
    get: w => w.cac,
    fmt: money,
    low: true,
  },
  { key: "contracted", label: "Revenue", get: w => w.contracted, fmt: money },
  {
    key: "roas",
    label: "ROAS",
    title: "Contracted over spend",
    get: w => w.roas,
    fmt: times,
  },
];

function AdTable({
  p,
  win,
  onDone,
  clock,
  setStatus,
  extra,
}: {
  p: B2bAdsPayload;
  win: Win;
  onDone: (m: string | null) => void;
  clock: SwitchClock;
  setStatus: SetStatus;
  /** Ticked extra metrics; empty is the classic table, untouched. */
  extra: string[];
}) {
  const { held } = useSwitches();
  const cols = useMemo(
    () => [...COLS, ...EXTRA_COLS.filter(c => extra.includes(c.key))],
    [extra],
  );
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({
    key: "spend",
    dir: -1,
  });
  const rows = useMemo(() => {
    const all = p.campaigns.flatMap(c =>
      c.adsets.flatMap(s =>
        s.ads.map(a => ({ a, campaign: c.name, type: c.type, adset: s.name })),
      ),
    );
    const col = cols.find(c => c.key === sort.key) ?? COLS[0];
    return all.sort((x, y) => {
      const vx = col.get(x.a[win]);
      const vy = col.get(y.a[win]);
      if (vx === null && vy === null) return 0;
      if (vx === null) return 1;
      if (vy === null) return -1;
      return (vx - vy) * sort.dir;
    });
  }, [p, win, sort, cols]);

  return (
    <div className="ceo-table-scroll overflow-x-auto">
      <table className="w-full min-w-max text-xs tabular-nums">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card py-2 pr-3 font-medium">
              Ad
            </th>
            {cols.map(c => {
              const active = sort.key === c.key;
              const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.key}
                  aria-sort={
                    active
                      ? sort.dir === 1
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className="px-2 py-2 text-right font-medium"
                >
                  <button
                    type="button"
                    title={c.title}
                    onClick={() =>
                      setSort(s =>
                        s.key === c.key
                          ? { key: c.key, dir: s.dir === 1 ? -1 : 1 }
                          : { key: c.key, dir: c.low ? 1 : -1 },
                      )
                    }
                    className={cn(
                      "no-touch relative inline-flex items-center gap-0.5 whitespace-nowrap rounded-sm after:absolute after:-inset-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active && "text-foreground",
                    )}
                  >
                    {c.label}
                    {active ? <Arrow className="size-3" aria-hidden /> : null}
                  </button>
                </th>
              );
            })}
            <th className="px-2 py-2 text-right font-medium">Who</th>
            <th className="px-2 py-2 text-right font-medium">Verdict</th>
            <th className="px-2 py-2 text-right font-medium">On</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ a, campaign, adset, type }) => {
            const w = a[win];
            const who = [
              a.people.setter
                ? `S ${a.people.setter.name.split(" ")[0]}`
                : null,
              a.people.closer
                ? `C ${a.people.closer.name.split(" ")[0]}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <tr key={a.id} className="hover:bg-muted/30">
                <td className="sticky left-0 z-10 max-w-[10rem] bg-card py-2 pr-3 @md:max-w-[15rem]">
                  <div className="flex items-center gap-2">
                    <CreativePreview
                      name={a.name}
                      metaAdId={a.id}
                      accountId={p.accountId}
                      thumbUrl={a.thumbnail ?? undefined}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {a.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{`${type === "retargeting" ? "Retargeting · " : ""}${campaign} · ${adset}`}</div>
                    </div>
                  </div>
                </td>
                {cols.map(c => (
                  <td
                    key={c.key}
                    className="whitespace-nowrap px-2 py-2 text-right"
                  >
                    <Num
                      v={c.get(w)}
                      f={c.fmt}
                      na={c.intro ? introFigures(w).na : undefined}
                    />
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                  {who || (
                    <Na hint="No setter or closer worked this ad's leads in the last thirty days." />
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {/* No room for the note in a table: the chip carries the held change, its sentence on hover. */}
                  {isHeld(a.id, held[a.id], clock) ? (
                    <StatusChip
                      tone={held[a.id].on ? "good" : "neutral"}
                      label={heldWord(held[a.id].on)}
                      hint={heldSentence(held[a.id], clock)}
                    />
                  ) : (
                    <StatusChip
                      tone={TONE[a.verdict.verdict]}
                      label={verdictLabel(a.verdict.verdict)}
                      hint={a.verdict.reason}
                    />
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <RowSwitch
                    metaId={a.id}
                    level="ad"
                    name={a.name}
                    running={switchedOn(a)}
                    clock={clock}
                    setStatus={setStatus}
                    onDone={onDone}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Funnel or table, in the look of the chart and table switch the kit draws
 * under every chart, so a view switch reads the same everywhere.
 */
function ViewSwitch({
  view,
  onView,
}: {
  view: View;
  onView: (v: View) => void;
}) {
  const btn = (active: boolean) =>
    cn(
      "no-touch inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors pointer-coarse:h-9 pointer-coarse:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div
      role="group"
      aria-label="Show as"
      className="inline-flex h-7 shrink-0 items-center rounded-lg bg-muted p-0.5 pointer-coarse:h-10"
    >
      <button
        type="button"
        aria-pressed={view === "funnel"}
        onClick={() => onView("funnel")}
        className={btn(view === "funnel")}
      >
        <ChartColumn className="size-3" aria-hidden />
        Funnel
      </button>
      <button
        type="button"
        aria-pressed={view === "table"}
        onClick={() => onView("table")}
        className={btn(view === "table")}
      >
        <Table2 className="size-3" aria-hidden />
        Table
      </button>
    </div>
  );
}

/** How the adapter's note opens when no ad on the account is running (hermes/ceo-refresh b2bAds.js). */
const NOTHING_DELIVERING = "Nothing on the account is delivering.";

export function AdsTab({ sections, now }: CeoTabProps) {
  const section = sections.b2bAds;
  const stored = section?.payload ?? null;
  const tf = useTimeframe("7d");
  const [view, setView] = useState<View>("funnel");
  const [extra, setExtra] = useExtraMetrics();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const readWindow = useAction(api.ceo.windows.ads);
  const setStatus = useAction(api.ceo.b2bControl.setStatus) as SetStatus;

  // The switches hold a change Meta confirmed until the payload has read
  // Meta since it: the stored section's snapshot stamp, which travels with
  // its payload (a failed run leaves both as they were). When it was
  // published says nothing, as the snapshot sync keeps its own clock. The
  // next refresh is 15 minutes after the last publish.
  const lastRun = section?.computedAt || null;
  const readAt = metaReadAt(section?.sources);
  // Since 2026-10-19 the payload reads on and off from Meta itself and says
  // when: a read after the change ends the hold, on or off.
  const statusReadAt = liveStatusAt(stored);
  const on = useMemo(() => onIds(stored), [stored]);
  const clock: SwitchClock = useMemo(
    () => ({
      readAt,
      statusReadAt,
      on,
      refreshAt: nextRefreshAt(lastRun, now, STALE_AFTER_MS),
      now,
    }),
    [readAt, statusReadAt, on, lastRun, now],
  );
  const switches = useSwitches();
  const holds = liveHolds(switches.held, clock);
  // A change that turned something on outranks "nothing running".
  const turnedOn = anyTurnedOn(switches.held, clock);
  useEffect(() => {
    settleSwitches(clock);
  }, [clock]);
  // The page reads the sections once; while a change is held it reads them
  // again just after the next refresh, then every five minutes until the
  // payload catches up or the hour runs out.
  const waiting = holds > 0;
  useEffect(() => {
    if (!waiting) return;
    let timer: ReturnType<typeof setTimeout>;
    const reread = () => {
      rereadCeoSections();
      timer = setTimeout(reread, REREAD_EVERY_MS);
    };
    timer = setTimeout(reread, rereadDelay(lastRun, Date.now()));
    return () => clearTimeout(timer);
  }, [waiting, lastRun]);

  // The stored payload already holds seven days and thirty. Any other run of
  // days is read live, with the same query and the same rules.
  const pick = useCallback(
    (b: {
      from: string;
      to: string;
    }): { p: B2bAdsPayload; win: Win } | null => {
      if (!stored || b.to !== stored.windows.to) return null;
      if (b.from === stored.windows.from7) return { p: stored, win: "w7" };
      if (b.from === stored.windows.from30) return { p: stored, win: "w30" };
      return null;
    },
    [stored],
  );
  const fetchWindow = useCallback(
    async (b: { from: string; to: string }) => {
      const p = (await readWindow(b)) as B2bAdsPayload;
      return { p, win: "w7" as Win };
    },
    [readWindow],
  );
  const shown = useServerWindow({
    tf,
    first: stored?.firstSnapshotDay ?? null,
    last: stored?.windows.to ?? null,
    stored: pick,
    read: fetchWindow,
  });

  const p = shown.data?.p ?? null;
  const win: Win = shown.data?.win ?? "w7";
  const chips = useMemo(() => (p ? verdictChips(p.verdicts) : []), [p]);
  // A picked range is read once; the stored payload reads Meta's own status
  // again every refresh. When that read is the newer one, it places the
  // switches, so a change made here does not snap back on a range once its
  // hold gives way to the stored read (2026-10-19).
  const newer = useMemo(() => newerSwitches(stored, p), [stored, p]);
  const rowClock: SwitchClock = useMemo(
    () => (newer ? { ...clock, newer } : clock),
    [clock, newer],
  );

  if (!stored)
    return (
      <SectionCard title="Our ads" section={section}>
        {() => null}
      </SectionCard>
    );

  const label = shown.bounds
    ? rangeText(shown.bounds.from, shown.bounds.to)
    : "Pick both dates";
  const bar = (
    <TimeframeBar
      tf={tf}
      bounds={shown.bounds}
      ariaLabel="Timeframe for the ad account"
      first={stored.firstSnapshotDay}
      last={stored.windows.to}
      note={
        shown.live
          ? "Read from Meta's snapshots for exactly these days, so every verdict judges this window against itself."
          : undefined
      }
    />
  );

  if (!p)
    return (
      <div className="grid gap-4 lg:gap-6">
        {bar}
        <SectionCard title="Our ads" section={section} order={0}>
          {() =>
            shown.error ? (
              <p className="text-sm text-[var(--ceo-critical)]">
                {shown.error}
              </p>
            ) : shown.loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {`Reading ${label} from the snapshots`}
              </p>
            ) : (
              <EmptyState
                title="Pick both dates"
                text="A custom timeframe needs a first and a last day."
                icon={Megaphone}
              />
            )
          }
        </SectionCard>
      </div>
    );

  const a = p.account[win];
  // Meta refuses every write on an account that is not in good standing
  // (#2490592, verified against the live account on 2026-09-22), so the rows
  // say so rather than letting a brief be written into a wall.
  const frozen =
    p.accountStatus && p.accountStatus.code !== 1
      ? p.accountStatus.label
      : null;
  const cplTone = gateTone(a.cpl, CPL_GATE);
  const ai = introFigures(a);
  // The adapter's "nothing is delivering" note is about the account before a
  // change here turned something on; it comes back if the hold gives way.
  const notes =
    turnedOn && p.running === 0
      ? p.notes.filter(n => !n.text.startsWith(NOTHING_DELIVERING))
      : p.notes;
  const retargeting = p.retargetingSpend[win];
  const rows: RowProps = {
    win,
    account: p.accountId,
    onDone: setMsg,
    payload: p,
    target,
    onOpen: setTarget,
    frozen,
    clock: rowClock,
    setStatus,
  };

  return (
    <div className="@container grid gap-4 lg:gap-6">
      {bar}
      <SectionCard
        kicker="Mahara's own account"
        title="Our ads"
        section={section}
        notes={notes}
        actions={
          <>
            {shown.loading ? (
              <Loader2
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
            {p.accountStatus && p.accountStatus.code !== 1 ? (
              <StatusChip
                tone="critical"
                label={`Account ${p.accountStatus.label}`}
              />
            ) : null}
          </>
        }
        order={0}
      >
        {() => (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
              <StatTile
                variant="plain"
                label="Lead-gen spend"
                value={money(a.spend)}
                sub={
                  retargeting
                    ? `${money(retargeting)} more on retargeting`
                    : undefined
                }
                hint="Lead-gen campaigns only, the way the B2B dashboard reads the account. Retargeting is beside it, never inside a cost per lead."
              />
              <StatTile
                variant="plain"
                label="Cost per lead"
                value={dash(a.cpl, money)}
                naHint={NA_ZERO}
                sub={plural(a.leads, "lead")}
                status={
                  a.cpl === null ? undefined : (
                    <StatusChip
                      tone={cplTone}
                      label={gateLabel(cplTone, CPL_GATE)}
                    />
                  )
                }
                hint="Spend over the leads that reached the CRM. Meta's own count is on the funnel below."
              />
              <StatTile
                variant="plain"
                label="Cost per confirmed intro"
                value={dash(ai.costPerConfirmed, money)}
                naHint={ai.na}
                sub={
                  ai.intros === null || ai.confirmed === null
                    ? undefined
                    : `${count(ai.confirmed)} of ${plural(ai.intros, "intro")} confirmed`
                }
                hint="Lead-gen spend over the leads whose intro showed, or is still marked confirmed after its time. Each lead counts once, however often the intro was rebooked."
              />
              <StatTile
                variant="plain"
                label="ROAS"
                value={x(a.roas)}
                naHint={NA_ZERO}
                sub={`${money(a.contracted)} contracted`}
                status={
                  p.running === 0 && !turnedOn ? (
                    <StatusChip tone="critical" label="Nothing running" />
                  ) : undefined
                }
              />
            </div>
            {/* A window with nothing in it would draw nine zeros; the tiles already say so. */}
            {hasActivity(a) ? (
              <FunnelRibbon
                w={a}
                freqHint={frequencyHint(p.windows, win, "lead gen")}
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{`${count(p.running)} of ${count(p.total)} ads running`}</span>
              {holds ? (
                <span title="Switched on or off here since these numbers last read Meta. Meta has them; the count takes them in once a refresh reads them, and an ad switched on once it delivers.">
                  {`${count(holds)} ${holds === 1 ? "change" : "changes"} made here not counted yet`}
                </span>
              ) : null}
              <span title={COVERAGE_HINT}>{coverageLine(p.coverage[win])}</span>
              {chips.map(v => (
                <span
                  key={v.key}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <StatusDot tone={v.tone} label={`${v.label} verdict`} />
                  {`${count(v.n)} ${v.label}`}
                </span>
              ))}
            </div>
            {msg ? (
              <p
                role="status"
                className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground"
              >
                {msg}
              </p>
            ) : null}
          </div>
        )}
      </SectionCard>

      {p.campaigns.length ? (
        <SectionCard
          title={view === "table" ? "Every ad" : "Campaigns"}
          description={
            view === "table" ? "Tap a column heading to sort." : undefined
          }
          section={section}
          hideAsOf
          actions={
            <div className="flex items-center gap-2">
              {view === "table" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={picking}
                  aria-controls="ads-metrics"
                  onClick={() => setPicking(x => !x)}
                >
                  <Columns3 aria-hidden />
                  {extra.length ? `Metrics · ${extra.length} more` : "Metrics"}
                </Button>
              ) : null}
              <ViewSwitch view={view} onView={setView} />
            </div>
          }
          order={1}
        >
          {() => (
            <div className="grid gap-4">
              {frozen ? (
                <p className="ceo-stale flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-foreground">
                  <TriangleAlert
                    className="mt-0.5 size-3.5 shrink-0"
                    style={{ color: "var(--ceo-warning)" }}
                    aria-hidden
                  />
                  {`Meta is refusing changes while the ad account is ${frozen}. Settle it in Ads Manager and every row can be changed again.`}
                </p>
              ) : null}
              {view === "table" && picking ? (
                <MetricPicker shown={extra} onChange={setExtra} />
              ) : null}
              {view === "table" ? (
                <AdTable
                  extra={extra}
                  p={p}
                  win={win}
                  onDone={setMsg}
                  clock={rowClock}
                  setStatus={setStatus}
                />
              ) : (
                <div className="divide-y">
                  {p.campaigns.map(c => (
                    <CampaignRow key={c.id} c={c} {...rows} />
                  ))}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Campaigns" section={section} order={1}>
          {() => (
            <EmptyState
              title={`No campaigns in ${label}`}
              text="Meta has no snapshot rows for the account in this window."
              icon={Megaphone}
            />
          )}
        </SectionCard>
      )}

      <LaunchCard ads={stored} order={2} />
    </div>
  );
}
