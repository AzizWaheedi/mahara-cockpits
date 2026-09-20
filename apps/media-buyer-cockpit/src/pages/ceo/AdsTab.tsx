import { useAction } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Megaphone,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, countCompact, money, pct } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bAdWindow,
  B2bPeople,
  B2bVerdict,
} from "../../../convex/ceo/payloads";
import { LaunchCard } from "./LaunchCard";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own ad account, read the way the old B2B dashboard read it and
 * further: the whole funnel from the impression to the signed contract on
 * every campaign, ad set and ad, with the unit cost at each stage, the
 * conversion between stages, the stage that is holding the campaign back,
 * and the people who worked its calls. A switch on every row.
 *
 * Two ways to look at it. The funnel view is one ribbon per row: nine
 * stages left to right, the conversion on the arrow between them, the cost
 * under each. The table view is the old dashboard's marketing lab: every
 * ad in one sortable table, so the eye can run down a column.
 */

type Win = "w7" | "w30";
type View = "funnel" | "table";

const TONE: Record<B2bVerdict["verdict"], StatusTone> = {
  scale: "good",
  hold: "warning",
  kill: "critical",
  fatiguing: "warning",
  "no delivery": "neutral",
  off: "neutral",
  "leads do not book": "serious",
  "intros do not convert": "serious",
  "demos do not close": "serious",
};

const OWNER: Record<NonNullable<B2bVerdict["owner"]>, string> = {
  ads: "the ad",
  setter: "the setter",
  closer: "the closer",
};

const CONSTRAINT_OWNER: Record<string, string> = {
  ads: "the creative",
  landing: "the landing page",
  setter: "the setter",
  closer: "the closer",
};

/** Which ribbon stage a constraint points at. */
const CONSTRAINT_STAGE: Record<string, string> = {
  "impressions to link clicks": "clicks",
  "clicks to leads": "leads",
  "leads to intros booked": "booked",
  "intros booked to shown": "shown",
  "intros shown to demos booked": "demos",
  "demos shown to closes": "signed",
};

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

const dash = (v: number | null, f: (x: number) => string) =>
  v === null ? "—" : f(v);
const x = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}×`);

type Stage = {
  key: string;
  label: string;
  value: string;
  /** Under the value: the unit cost or the rate that belongs to this stage. */
  unit: string;
  /** Conversion from the stage before, shown on the arrow into this one. */
  from: number | null;
  dim?: boolean;
};

function stagesOf(w: B2bAdWindow): Stage[] {
  return [
    {
      key: "impressions",
      label: "Impressions",
      value: countCompact(w.impressions),
      unit: `CPM ${dash(w.cpm, money)}${w.frequency !== null ? ` · freq ${w.frequency.toFixed(1)}` : ""}`,
      from: null,
    },
    {
      key: "clicks",
      label: "Link clicks",
      value: countCompact(w.linkClicks),
      unit: `CPC ${dash(w.cpc, money)} · CTR ${dash(w.ctrLink, pct)}`,
      from: w.ctrLink,
    },
    {
      key: "leads",
      label: "Leads",
      value: count(w.leads),
      unit: `CPL ${dash(w.cpl, money)}${w.leads ? ` · ${dash(w.qualifiedPct, pct)} a fit` : ""}${w.metaLeads !== w.leads ? ` · Meta ${count(w.metaLeads)}` : ""}`,
      from: w.linkClicks > 0 ? w.leads / w.linkClicks : null,
    },
    {
      key: "booked",
      label: "Intros booked",
      value: count(w.introsBooked),
      unit: `${dash(w.costPerIntroBooked, money)} each`,
      from: w.bookRate,
    },
    {
      key: "shown",
      label: "Intros shown",
      value: `${count(w.introsShown)}${w.introsDue ? ` of ${count(w.introsDue)}` : ""}`,
      unit: `show ${dash(w.introShowRate, pct)} · ${dash(w.costPerIntroShown, money)} each`,
      from: w.introShowRate,
    },
    {
      key: "demos",
      label: "Demos booked",
      value: count(w.demosBooked),
      unit: `${dash(w.costPerDemoBooked, money)} each`,
      from: w.introToDemo,
    },
    {
      key: "demoshown",
      label: "Demos shown",
      value: `${count(w.demosShown)}${w.demosDue ? ` of ${count(w.demosDue)}` : ""}`,
      unit: `show ${dash(w.demoShowRate, pct)} · ${dash(w.costPerDemo, money)} each`,
      from: w.demoShowRate,
    },
    {
      key: "signed",
      label: "Signed",
      value: count(w.closes),
      unit: `close ${dash(w.closeRate, pct)} · CAC ${dash(w.cac, money)}`,
      from: w.closeRate,
    },
    {
      key: "revenue",
      label: "Contracted",
      value: money(w.contracted),
      unit: `ROAS ${x(w.roas)} · cash ${x(w.cashRoas)}`,
      from: null,
    },
  ];
}

/**
 * The funnel as a grid of stages that wraps to the width it has: the count,
 * then the unit cost, with the conversion from the stage before at the top
 * of each cell. The spend and nine stages make ten cells: two rows of five
 * on a laptop, three across on a tablet, two across on a phone, and the
 * reading order never changes. The stage a campaign is stuck on is
 * outlined, so the eye lands on the fix.
 */
function FunnelRibbon({
  w,
  spend,
  constraint,
  compact = false,
}: {
  w: B2bAdWindow;
  spend: number;
  constraint?: string | null;
  compact?: boolean;
}) {
  const stages = stagesOf(w);
  const stuck = constraint ? CONSTRAINT_STAGE[constraint] : undefined;
  const cell = "flex min-w-0 flex-col justify-start rounded-md px-2 py-1.5";
  const valueCls = `truncate font-semibold ${compact ? "text-sm" : "text-base"}`;
  const topCls =
    "min-h-[14px] truncate text-[10px] leading-[14px] text-muted-foreground";
  return (
    <div
      className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-5"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <div className={cell}>
        <div className={topCls} />
        <div className={valueCls}>{money(spend)}</div>
        <div className="truncate text-[11px] text-muted-foreground">Spent</div>
        <div className="min-h-4 truncate text-[11px]" />
      </div>
      {stages.map((s, i) => (
        <div
          key={s.key}
          className={`${cell} ${
            stuck === s.key
              ? "ring-1 ring-[var(--ceo-serious)] bg-[color-mix(in_srgb,var(--ceo-serious)_8%,transparent)]"
              : ""
          }`}
        >
          <div className={topCls} title="Conversion from the stage before">
            {i > 0 ? `↳ ${dash(s.from, pct)}` : ""}
          </div>
          <div
            className={`${valueCls} ${s.dim ? "text-muted-foreground" : ""}`}
          >
            {s.value}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {s.label}
          </div>
          <div className="truncate text-[11px]" title={s.unit}>
            {s.unit}
          </div>
        </div>
      ))}
    </div>
  );
}

function People({ p }: { p: B2bPeople }) {
  if (!p.setter && !p.closer) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {p.setter ? (
        <span title="The setter with the most intro calls on this in thirty days, and their show rate on them">
          {`Setter ${p.setter.name}: ${count(p.setter.shown)} of ${count(p.setter.due)} shown`}
        </span>
      ) : null}
      {p.closer ? (
        <span title="The closer with the most signed deals from this in thirty days">
          {`Closer ${p.closer.name}: ${count(p.closer.closes)} signed`}
        </span>
      ) : null}
    </div>
  );
}

function Toggle({
  metaId,
  level,
  name,
  running,
  onDone,
}: {
  metaId: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  running: boolean;
  onDone: (m: string) => void;
}) {
  const setStatus = useAction(api.ceo.b2bControl.setStatus);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={running}
      aria-label={`${running ? "Turn off" : "Turn on"} ${level} ${name}`}
      disabled={busy}
      onClick={async e => {
        e.stopPropagation();
        setBusy(true);
        try {
          const res = await setStatus({
            metaId,
            level,
            active: !running,
            name,
          });
          onDone(
            res.ok
              ? `${running ? "Turned off" : "Turned on"} ${name}. The next refresh re-reads Meta.`
              : (res.error ?? "Meta refused it."),
          );
        } catch (err) {
          onDone(
            String(err instanceof Error ? err.message : err).slice(0, 200),
          );
        } finally {
          setBusy(false);
        }
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${running ? "bg-[var(--ceo-emphasis)]" : "bg-muted-foreground/40"} disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-background transition-[left] ${running ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

function AdRow({
  ad,
  win,
  account,
  onDone,
}: {
  ad: B2bAdNode;
  win: Win;
  account: string;
  onDone: (m: string) => void;
}) {
  const w = ad[win];
  return (
    <div className="grid gap-2 border-t py-3 pl-3">
      <div className="flex items-start gap-3">
        {ad.thumbnail ? (
          <img
            src={ad.thumbnail}
            alt=""
            loading="lazy"
            className="size-12 shrink-0 rounded object-cover"
            onError={e => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{ad.name}</span>
            <StatusChip
              tone={TONE[ad.verdict.verdict]}
              label={ad.verdict.verdict}
            />
            {ad.verdict.owner && ad.verdict.owner !== "ads" ? (
              <span className="text-xs text-muted-foreground">
                {`→ ${OWNER[ad.verdict.owner]}`}
              </span>
            ) : null}
            <a
              href={adsManagerUrl(account, "ad", ad.id)}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open in Ads Manager"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <span className="ml-auto">
              <Toggle
                metaId={ad.id}
                level="ad"
                name={ad.name}
                running={ad.running}
                onDone={onDone}
              />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ad.verdict.reason}
          </p>
          <People p={ad.people} />
        </div>
      </div>
      <FunnelRibbon w={w} spend={w.spend} compact />
    </div>
  );
}

function CampaignCard({
  c,
  win,
  account,
  onDone,
}: {
  c: B2bAdsPayload["campaigns"][number];
  win: Win;
  account: string;
  onDone: (m: string) => void;
}) {
  const [open, setOpen] = useState(c.running);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const w = c[win];
  return (
    <div className="rounded-md border">
      {/* The switch and the link sit beside the button, not inside it: a button cannot hold another control. */}
      <div className="flex items-start gap-3 p-3 hover:bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          {open ? (
            <ChevronDown
              className="mt-1 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="mt-1 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.name}</span>
              <StatusChip
                tone={
                  c.type === "lead_gen"
                    ? "good"
                    : c.type === "retargeting"
                      ? "neutral"
                      : "warning"
                }
                label={c.type.replace(/_/g, " ")}
              />
              <span className="text-xs text-muted-foreground">
                {`${c.adsets.length} ad ${c.adsets.length === 1 ? "set" : "sets"} · ${c.adsets.reduce((n, a) => n + a.ads.length, 0)} ads`}
              </span>
            </div>
            {c.constraint ? (
              <p className="mt-1 text-xs">
                <span className="font-medium text-[var(--ceo-serious)]">
                  {`Stuck at ${CONSTRAINT_OWNER[c.constraint.owner]}: `}
                </span>
                <span className="text-muted-foreground">
                  {`${c.constraint.stage} runs at ${pct(c.constraint.mine)} against ${pct(c.constraint.account)} across the account.`}
                </span>
              </p>
            ) : null}
            <div className="mt-2">
              <FunnelRibbon
                w={w}
                spend={w.spend}
                constraint={c.constraint?.stage ?? null}
              />
            </div>
            <div className="mt-1">
              <People p={c.people} />
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <a
            href={adsManagerUrl(account, "campaign", c.id)}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            title="Open in Ads Manager"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <Toggle
            metaId={c.id}
            level="campaign"
            name={c.name}
            running={c.running}
            onDone={onDone}
          />
        </div>
      </div>
      {open ? (
        <div className="border-t px-3 pb-2">
          {c.adsets.map(s => {
            const so = openSets[s.id] ?? s.running;
            const sw = s[win];
            return (
              <div key={s.id} className="border-t first:border-t-0">
                <div className="flex items-start gap-2 py-3 hover:bg-muted/30">
                  <button
                    type="button"
                    onClick={() => setOpenSets(m => ({ ...m, [s.id]: !so }))}
                    aria-expanded={so}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    {so ? (
                      <ChevronDown
                        className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <ChevronRight
                        className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{`${s.ads.length} ads`}</span>
                      </div>
                      <div className="mt-2">
                        <FunnelRibbon w={sw} spend={sw.spend} compact />
                      </div>
                    </div>
                  </button>
                  <div className="shrink-0 pt-0.5">
                    <Toggle
                      metaId={s.id}
                      level="adset"
                      name={s.name}
                      running={s.running}
                      onDone={onDone}
                    />
                  </div>
                </div>
                {so ? (
                  <div className="pb-2 pl-5">
                    {s.ads.map(a => (
                      <AdRow
                        key={a.id}
                        ad={a}
                        win={win}
                        account={account}
                        onDone={onDone}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
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
    label: "CTR",
    title: "Link clicks over impressions",
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
    title:
      "Leads whose stage reached demo booked, confirmed, closed or hot lead",
    get: w => w.qualifiedPct,
    fmt: pct,
  },
  {
    key: "introsBooked",
    label: "Intros",
    title: "Intro calls booked",
    get: w => w.introsBooked,
    fmt: count,
  },
  {
    key: "introShowRate",
    label: "Show",
    title: "Intros shown over intros due",
    get: w => w.introShowRate,
    fmt: pct,
  },
  {
    key: "costPerIntroShown",
    label: "$/intro",
    title: "Spend over intros shown",
    get: w => w.costPerIntroShown,
    fmt: money,
    low: true,
  },
  {
    key: "demosBooked",
    label: "Demos",
    title: "Demos booked",
    get: w => w.demosBooked,
    fmt: count,
  },
  {
    key: "demoShowRate",
    label: "Show",
    title: "Demos shown over demos due",
    get: w => w.demoShowRate,
    fmt: pct,
  },
  {
    key: "costPerDemo",
    label: "$/demo",
    title: "Spend over demos shown",
    get: w => w.costPerDemo,
    fmt: money,
    low: true,
  },
  { key: "closes", label: "Signed", get: w => w.closes, fmt: count },
  {
    key: "closeRate",
    label: "Close",
    title: "Signed over demos shown",
    get: w => w.closeRate,
    fmt: pct,
  },
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
    fmt: v => `${v.toFixed(1)}×`,
  },
];

function AdTable({
  p,
  win,
  onDone,
}: {
  p: B2bAdsPayload;
  win: Win;
  onDone: (m: string) => void;
}) {
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
    const col = COLS.find(c => c.key === sort.key) ?? COLS[0];
    return all.sort((x, y) => {
      const vx = col.get(x.a[win]);
      const vy = col.get(y.a[win]);
      if (vx === null && vy === null) return 0;
      if (vx === null) return 1;
      if (vy === null) return -1;
      return (vx - vy) * sort.dir;
    });
  }, [p, win, sort]);

  return (
    <div className="ceo-scroll-x overflow-x-auto">
      <table
        className="w-full text-xs"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card py-2 pr-3 font-medium">
              Ad
            </th>
            {COLS.map(c => (
              <th key={c.key} className="px-2 py-2 text-right font-medium">
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
                  className={`whitespace-nowrap hover:text-foreground ${sort.key === c.key ? "text-foreground" : ""}`}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Who</th>
            <th className="px-2 py-2 text-right font-medium">Verdict</th>
            <th className="px-2 py-2 text-right font-medium">On</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, campaign, adset, type }) => {
            const w = a[win];
            return (
              <tr
                key={a.id}
                className="border-b last:border-b-0 hover:bg-muted/30"
              >
                <td className="sticky left-0 z-10 max-w-[10rem] bg-card py-2 pr-3 @md:max-w-[15rem]">
                  <div className="flex items-center gap-2">
                    {a.thumbnail ? (
                      <img
                        src={a.thumbnail}
                        alt=""
                        loading="lazy"
                        className="size-7 shrink-0 rounded object-cover"
                        onError={e => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {a.name}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">{`${type === "retargeting" ? "retargeting · " : ""}${campaign} · ${adset}`}</div>
                    </div>
                  </div>
                </td>
                {COLS.map(c => {
                  const v = c.get(w);
                  return (
                    <td
                      key={c.key}
                      className="whitespace-nowrap px-2 py-2 text-right"
                    >
                      {v === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        c.fmt(v)
                      )}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-2 py-2 text-right text-muted-foreground">
                  {[
                    a.people.setter
                      ? `S ${a.people.setter.name.split(" ")[0]}`
                      : null,
                    a.people.closer
                      ? `C ${a.people.closer.name.split(" ")[0]}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-2 py-2 text-right">
                  <StatusChip
                    tone={TONE[a.verdict.verdict]}
                    label={a.verdict.verdict}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <Toggle
                    metaId={a.id}
                    level="ad"
                    name={a.name}
                    running={a.running}
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

export function AdsTab({ sections }: CeoTabProps) {
  const section = sections.b2bAds;
  const p = section?.payload ?? null;
  const [win, setWin] = useState<Win>("w7");
  const [view, setView] = useState<View>("funnel");
  const [msg, setMsg] = useState<string | null>(null);

  const verdictChips = useMemo(() => {
    if (!p) return [];
    return Object.entries(p.verdicts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k as B2bVerdict["verdict"], n }));
  }, [p]);

  if (!p)
    return (
      <SectionCard title="Our ads" section={section}>
        {() => null}
      </SectionCard>
    );

  const a = p.account[win];
  const label = win === "w7" ? "Last 7 days" : "Last 30 days";

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        kicker={`Mahara's own account · ${label}`}
        title="Our ads"
        section={section}
        notes={p.notes}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {p.accountStatus && p.accountStatus.code !== 1 ? (
              <StatusChip
                tone="critical"
                label={`Account ${p.accountStatus.label}`}
              />
            ) : null}
            <div className="flex gap-1">
              {(["w7", "w30"] as Win[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWin(k)}
                  aria-pressed={win === k}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    win === k
                      ? "bg-foreground text-background"
                      : "text-muted-foreground"
                  }`}
                >
                  {k === "w7" ? "7 days" : "30 days"}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(["funnel", "table"] as View[]).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setView(k)}
                  aria-pressed={view === k}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    view === k
                      ? "bg-foreground text-background"
                      : "text-muted-foreground"
                  }`}
                >
                  {k === "funnel" ? "Funnel" : "Table"}
                </button>
              ))}
            </div>
          </div>
        }
        order={0}
      >
        {() => (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 @md:grid-cols-3 @2xl:grid-cols-4">
              <StatTile
                variant="plain"
                label="Lead-gen spend"
                value={money(a.spend)}
                sub={`CPM ${dash(a.cpm, money)}${p.retargetingSpend[win] ? ` · +${money(p.retargetingSpend[win])} retargeting` : ""}`}
                hint="Lead-gen campaigns only, the way the B2B dashboard reads the account. Retargeting is beside it, never inside a cost per lead."
              />
              <StatTile
                variant="plain"
                label="Cost per lead"
                value={dash(a.cpl, money)}
                sub={`${count(a.leads)} leads · $15 gate`}
                hint="Spend over the leads that reached the CRM. Meta's own count is on the ribbon."
              />
              <StatTile
                variant="plain"
                label="Link CTR"
                value={dash(a.ctrLink, pct)}
                sub={`CPC ${dash(a.cpc, money)}`}
              />
              <StatTile
                variant="plain"
                label="Intro show rate"
                value={dash(a.introShowRate, pct)}
                sub={`${count(a.introsShown)} of ${count(a.introsDue)} due`}
                hint="Intros shown over intros whose time has passed. Confirmed or showed counts as shown."
              />
              <StatTile
                variant="plain"
                label="Demo show rate"
                value={dash(a.demoShowRate, pct)}
                sub={`${count(a.demosShown)} of ${count(a.demosDue)} due`}
              />
              <StatTile
                variant="plain"
                label="Cost per demo"
                value={dash(a.costPerDemo, money)}
                sub="spend over demos shown"
              />
              <StatTile
                variant="plain"
                label="Close rate"
                value={dash(a.closeRate, pct)}
                sub={`${count(a.closes)} signed · CAC ${dash(a.cac, money)}`}
              />
              <StatTile
                variant="plain"
                label="ROAS"
                value={x(a.roas)}
                sub={`${money(a.contracted)} contracted`}
                status={
                  p.running === 0 ? (
                    <StatusChip tone="critical" label="Nothing running" />
                  ) : undefined
                }
              />
            </div>
            <FunnelRibbon w={a} spend={a.spend} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{`${count(p.running)} of ${count(p.total)} ads running.`}</span>
              <span title="Everything in the CRM for the window against what carries an ad id. The rest is organic, WhatsApp or typed in by hand.">
                {`${count(p.coverage[win].adLeads)} of ${count(p.coverage[win].leads)} leads and ${count(p.coverage[win].adCloses)} of ${count(p.coverage[win].closes)} signed deals carry an ad.`}
              </span>
              {verdictChips.map(v => (
                <StatusChip
                  key={v.key}
                  tone={TONE[v.key]}
                  label={`${v.n} ${v.key}`}
                />
              ))}
            </div>
            {msg ? <p className="text-sm">{msg}</p> : null}
          </div>
        )}
      </SectionCard>

      {p.campaigns.length ? (
        view === "table" ? (
          <SectionCard
            title="Every ad"
            kicker={`${label} · click a column to sort`}
            section={section}
            order={1}
          >
            {() => <AdTable p={p} win={win} onDone={setMsg} />}
          </SectionCard>
        ) : (
          <div className="grid gap-3">
            {p.campaigns.map(c => (
              <CampaignCard
                key={c.id}
                c={c}
                win={win}
                account={p.accountId}
                onDone={setMsg}
              />
            ))}
          </div>
        )
      ) : (
        <SectionCard title="Campaigns" section={section} order={1}>
          {() => (
            <EmptyState
              title="No campaigns in the last thirty days"
              text="Meta has no snapshot rows for the account in this window."
              icon={Megaphone}
            />
          )}
        </SectionCard>
      )}

      <LaunchCard ads={p} order={2} />
    </div>
  );
}
