import { Check, Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { KICKER } from "@/components/ceo/Kicker";
import { useWidth } from "@/components/ceo/useWidth";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  BAND_METRIC,
  type Band,
  type BandMetric,
  type BandPart,
  bandRanges,
  COVERS,
  COVERS_LABEL,
  type Covers,
  pickBand,
  suggestBands,
} from "@/types/ceo/payPlan";
import { CheckRow, NumberBox, PHONE_LABEL } from "./fields";
import {
  type AlsoLine,
  alsoSentence,
  edgeLabel,
  payoutLabel,
  renameForMetric,
  rulerLayout,
  valueText,
} from "./payCopy";

/**
 * The band ruler, the one element the pay screens are remembered by
 * (PAY-PLANS.md 8.3, pay_design.md section 2). A bonus by band is a number
 * line: each band is a segment as wide as its share of the metric, its
 * payout printed above it, its edges below in Geist Mono, and this month's
 * value a 2px tick in the band it falls in. The band being paid now is solid
 * teal; the other paying bands are washes of the same teal, deeper where
 * they pay more; the band that pays nothing is grey, and a deduction band is
 * grey with a red dot. It answers the two questions a table of thresholds
 * hides: where this month's number sits, and what the next band is worth.
 */

export type RulerMark = {
  /** The value as the server sent it (already rounded); never rounded again. */
  value: number;
  /** "Oct", "Sara · Oct". */
  label: string;
};

/** Rough width of Geist Mono 11px text, for leaving out labels that would collide. */
const monoWidth = (text: string) => text.length * 6.7 + 6;

/** The ruler's sentence for a screen reader. */
export function rulerSentence(
  part: Pick<BandPart, "label" | "metric" | "bands">,
  marks: readonly RulerMark[],
): string {
  const ranges = bandRanges(part.metric, part.bands);
  const said = part.bands
    .map((b, i) => `${ranges[i]} pays ${payoutLabel(b.amount)}`)
    .join(", ");
  const unit = BAND_METRIC[part.metric].unit;
  const where = marks
    .map(m => {
      const pick = pickBand(part.bands, m.value);
      const amount = pick?.amount ?? null;
      return `${m.label}: ${valueText(m.value, unit)}, in the ${amount === null ? "unknown" : payoutLabel(amount)} band.`;
    })
    .join(" ");
  return `${part.label}: ${said}.${where ? ` ${where}` : ""}`;
}

export function BandRuler({
  part,
  marks = [],
  className,
}: {
  part: Pick<BandPart, "label" | "metric" | "bands">;
  /** This month's value for each person shown, at most three. */
  marks?: readonly RulerMark[];
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const shown = marks.slice(0, 3);
  const layout = rulerLayout(
    part.bands,
    shown.map(m => m.value),
  );
  const current =
    shown.length > 0
      ? (pickBand(part.bands, shown[0].value)?.index ?? null)
      : null;
  const paying = part.bands.map(b => b.amount).filter(a => a > 0);
  const most = paying.length ? Math.max(...paying) : 1;
  // The first mark's value, so its label washes once when it moves.
  const first = useRef(shown[0]?.value);
  const px = (share: number) => share * (width || 320);

  // Edges below the track, left out when they would run into the one before.
  const edgeTexts = layout.edges.map(e => edgeLabel(part.metric, e.value));
  const keepEdge: boolean[] = [];
  let lastRight = monoWidth(edgeLabel(part.metric, 0));
  layout.edges.forEach((e, i) => {
    const w = monoWidth(edgeTexts[i]);
    const left = px(e.at) - w / 2;
    const fits = left >= lastRight && px(e.at) + w / 2 <= (width || 320);
    keepEdge.push(fits);
    if (fits) lastRight = left + w;
  });

  return (
    <div
      ref={ref}
      role="img"
      aria-label={rulerSentence(part, shown)}
      className={cn("pay-ruler relative min-w-0 select-none", className)}
    >
      {/* Payouts, each over its band; a band too narrow for its payout leaves it to the rows below. */}
      <div className="relative h-4" aria-hidden>
        {layout.segments.map(s => {
          const text = payoutLabel(s.amount);
          if (px(s.width) < monoWidth(text)) return null;
          return (
            <span
              key={s.index}
              className={cn(
                "absolute bottom-0 truncate text-center font-mono text-[11px] leading-4 tabular-nums",
                s.index === current
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
              style={{
                left: `${s.start * 100}%`,
                width: `${s.width * 100}%`,
              }}
            >
              {text}
            </span>
          );
        })}
      </div>
      {/* The track. */}
      <div className="relative mt-1 h-2" aria-hidden>
        {layout.segments.map((s, i) => {
          const now = s.index === current;
          const fill =
            s.amount > 0
              ? now
                ? "var(--ceo-emphasis)"
                : `color-mix(in srgb, var(--ceo-emphasis) ${Math.round(16 + (30 * s.amount) / most)}%, transparent)`
              : "var(--ceo-deemphasis)";
          return (
            <span
              key={s.index}
              className="absolute inset-y-0 px-px"
              style={{ left: `${s.start * 100}%`, width: `${s.width * 100}%` }}
            >
              <span
                className={cn(
                  "relative flex h-full items-center justify-center",
                  i === 0 && "rounded-l-full",
                  i === layout.segments.length - 1 && "rounded-r-full",
                  s.amount <= 0 && !now && "opacity-60",
                )}
                style={{ backgroundColor: fill }}
              >
                {s.amount < 0 ? (
                  <span
                    className="block size-1.5 rounded-full"
                    style={{ backgroundColor: "var(--ceo-critical)" }}
                  />
                ) : null}
              </span>
            </span>
          );
        })}
        {shown.map((m, i) => (
          <span
            key={`${m.label}-${i}`}
            className="absolute -top-1.5 h-5 w-0.5 rounded-full bg-foreground transition-[left] duration-500 ease-out motion-reduce:transition-none"
            style={{ left: `calc(${layout.at(m.value) * 100}% - 1px)` }}
          />
        ))}
      </div>
      {/* Edges, in Mono, under the boundaries they mark. */}
      <div className="relative mt-1 h-4" aria-hidden>
        <span className="absolute left-0 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">
          {edgeLabel(part.metric, 0)}
        </span>
        {layout.edges.map((e, i) =>
          keepEdge[i] ? (
            <span
              key={`${e.value}-${i}`}
              className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] leading-4 text-muted-foreground tabular-nums"
              style={{ left: `${e.at * 100}%` }}
            >
              {edgeTexts[i]}
            </span>
          ) : null,
        )}
      </div>
      {/* This month's value under its tick; the label turns inward near either end. */}
      {shown.map((m, i) => {
        const at = layout.at(m.value);
        const side =
          at < 0.15
            ? { left: `${at * 100}%` }
            : at > 0.85
              ? { right: `${(1 - at) * 100}%` }
              : { left: `${at * 100}%`, transform: "translateX(-50%)" };
        return (
          <div key={`${m.label}-${i}`} className="relative h-5" aria-hidden>
            <span
              key={m.value}
              className={cn(
                "absolute top-0.5 whitespace-nowrap rounded px-1 text-[11px] leading-4",
                i === 0 && m.value !== first.current && "ceo-flash",
              )}
              style={side}
            >
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {valueText(m.value, BAND_METRIC[part.metric].unit)}
              </span>
              <span className="text-muted-foreground">{` ${m.label}`}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor around it

const METRIC_GROUPS: { label: string; metrics: BandMetric[] }[] = [
  { label: "Ads", metrics: ["cpl", "cpb"] },
  { label: "Clients", metrics: ["csm_churn", "logo_churn_prior"] },
];

/** A money metric (cost per lead or per booking), the only ones with clients to cover and a guard. */
const isMoney = (m: BandMetric) => m === "cpl" || m === "cpb";

/**
 * A money bonus switched to the other money metric with the bands the
 * dialog suggested: same key, clients and guard; the receipt's name follows
 * the metric when it names the old one ("Bonus by cost per lead" → "Bonus by
 * cost per booking").
 */
export function switchedPart(
  part: BandPart,
  to: BandMetric,
  bands: Band[],
): BandPart {
  return {
    ...part,
    metric: to,
    bands,
    label: renameForMetric(part.label, part.metric, to),
  };
}

/**
 * "Pay the bonus on cost per booking?": the bands suggested at the gate ratio
 * (× 4 from cost per lead, ÷ 4 back), shown before anything changes. The
 * suggestion goes into the plan being edited only on the click; the plan is
 * saved only with Save the pay plan.
 */
export function MetricSwitchDialog({
  open,
  part,
  to,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  part: Pick<BandPart, "metric" | "bands"> & { label?: string };
  to: BandMetric;
  onCancel: () => void;
  onConfirm: (bands: Band[]) => void;
}) {
  const suggested = suggestBands(part.bands, part.metric, to) ?? part.bands;
  const renamed =
    part.label !== undefined
      ? renameForMetric(part.label, part.metric, to)
      : null;
  const before = bandRanges(part.metric, part.bands);
  const after = bandRanges(to, suggested);
  const toName = BAND_METRIC[to].label.toLowerCase();
  const fromName = BAND_METRIC[part.metric].label.toLowerCase();
  const up = part.metric === "cpl" && to === "cpb";
  return (
    <Dialog open={open} onOpenChange={o => (o ? null : onCancel())}>
      <DialogContent className="ceo-root sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>{`Pay the bonus on ${toName}?`}</DialogTitle>
          <DialogDescription>
            {up
              ? `The bands are in dollars per lead. A booking costs about 4 times a lead at the gates ($15 and $60), so the bands below are 4 times as high. Check them before you switch.`
              : `The bands are in dollars per booking. A lead costs about a quarter of a booking at the gates ($60 and $15), so the bands below are a quarter as high. Check them before you switch.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1 text-sm">
          {suggested.map((b, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b py-1.5 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block">{after[i]}</span>
                <span className="block text-xs text-muted-foreground">{`was ${before[i]} ${fromName}`}</span>
              </span>
              <span className="font-mono tabular-nums">
                {payoutLabel(b.amount)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {renamed && renamed !== part.label
            ? `Its name on the receipt becomes "${renamed}". Nothing is saved until you press Save the pay plan.`
            : "Nothing is saved until you press Save the pay plan."}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(suggested)}>
            <Check aria-hidden />
            {`Switch to ${toName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A bonus by band, edited: what it is paid on, the ruler, then one row per
 * band. A band starts where the one before ends, so only each upper edge and
 * each payout are typed, and "Includes $15" says whether the edge itself
 * pays this band or the next (decision 4).
 */
export function BandEditor({
  part,
  onChange,
  marks,
  also,
  disabled,
}: {
  part: BandPart;
  onChange: (next: BandPart) => void;
  marks: readonly RulerMark[];
  /** The other money metric this month, tracked and not paid on: "cost per booking $103 in October". */
  also: AlsoLine | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [switching, setSwitching] = useState<BandMetric | null>(null);
  const ranges = bandRanges(part.metric, part.bands);
  const money = BAND_METRIC[part.metric].unit === "usd";
  const unitPrefix = money ? "$" : undefined;
  const unitSuffix = money ? undefined : "%";
  const setBands = (bands: Band[]) => onChange({ ...part, bands });
  const setBand = (i: number, patch: Partial<Band>) =>
    setBands(part.bands.map((b, n) => (n === i ? { ...b, ...patch } : b)));

  const changeMetric = (to: BandMetric) => {
    if (to === part.metric) return;
    if (isMoney(part.metric) && isMoney(to)) {
      setSwitching(to);
      return;
    }
    // Churn has no clients to cover and no guard: they go with the switch.
    const { covers: _c, guard: _g, ...rest } = part;
    onChange(isMoney(to) ? { ...part, metric: to } : { ...rest, metric: to });
  };

  const addBand = () => {
    const bands = part.bands;
    const edges = bands
      .slice(0, -1)
      .map(b => b.upTo)
      .filter((x): x is number => typeof x === "number");
    const lastEdge = edges.at(-1) ?? 0;
    const step =
      edges.length > 1 ? lastEdge - (edges.at(-2) ?? 0) : lastEdge || 5;
    const next: Band = {
      upTo: Math.round((lastEdge + Math.max(step, 1)) * 100) / 100,
      inclusive: false,
      amount: 0,
    };
    setBands([...bands.slice(0, -1), next, bands[bands.length - 1]]);
  };
  const removeBand = (i: number) =>
    setBands(part.bands.filter((_, n) => n !== i));

  return (
    <div className="grid gap-4">
      {/* Each label wraps with its own select, never left at the end of a line. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex min-w-0 max-w-full items-center gap-x-3">
          <label
            htmlFor={`${id}-metric`}
            className="shrink-0 text-muted-foreground"
          >
            Paid on
          </label>
          <AnimatedSelect
            id={`${id}-metric`}
            value={part.metric}
            disabled={disabled}
            onChange={e => changeMetric(e.target.value as BandMetric)}
            aria-label={`What ${part.label} is paid on`}
            className="ceo-select-sm min-w-0 max-w-full"
          >
            {METRIC_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.metrics.map(m => (
                  <option key={m} value={m}>
                    {BAND_METRIC[m].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </AnimatedSelect>
        </span>
        {isMoney(part.metric) ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-x-3">
            <span className="shrink-0 text-muted-foreground">Counts</span>
            <AnimatedSelect
              value={part.covers ?? "all_clients"}
              disabled={disabled}
              onChange={e =>
                onChange({ ...part, covers: e.target.value as Covers })
              }
              aria-label={`Which clients ${part.label} counts`}
              className="ceo-select-sm min-w-0 max-w-full"
            >
              {COVERS.map(c => (
                <option key={c} value={c}>
                  {COVERS_LABEL[c]}
                </option>
              ))}
            </AnimatedSelect>
          </span>
        ) : null}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {BAND_METRIC[part.metric].note} Lower is better.
      </p>

      <BandRuler part={part} marks={marks} />

      <div className="@container grid gap-2">
        <span className={KICKER}>Bands</span>
        {part.bands.map((b, i) => {
          const isLast = i === part.bands.length - 1;
          return (
            <div
              key={i}
              className="grid items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 @md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
            >
              <span className="min-w-0 text-sm">{ranges[i]}</span>
              {isLast ? (
                <span className="hidden text-xs text-muted-foreground @md:block">
                  no upper edge
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span className={PHONE_LABEL}>Ends at</span>
                  <NumberBox
                    value={typeof b.upTo === "number" ? b.upTo : Number.NaN}
                    onChange={v => setBand(i, { upTo: v })}
                    label={`Where band ${i + 1} of ${part.label} ends`}
                    prefix={unitPrefix}
                    suffix={unitSuffix}
                    disabled={disabled}
                  />
                  <CheckRow
                    checked={b.inclusive === true}
                    disabled={disabled}
                    onChange={on => setBand(i, { inclusive: on })}
                    className="gap-1.5 text-xs text-muted-foreground"
                  >
                    {`Includes ${typeof b.upTo === "number" ? edgeLabel(part.metric, b.upTo) : "the edge"}`}
                  </CheckRow>
                </span>
              )}
              <span className="flex items-center gap-2">
                <span className={PHONE_LABEL}>Pays</span>
                <span className="hidden text-xs text-muted-foreground @md:inline">
                  pays
                </span>
                <NumberBox
                  value={b.amount}
                  onChange={v => setBand(i, { amount: v })}
                  label={`What band ${i + 1} of ${part.label} pays`}
                  prefix="$"
                  width="w-24"
                  disabled={disabled}
                />
              </span>
              <span className="flex justify-end">
                {!isLast && part.bands.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={disabled}
                    onClick={() => removeBand(i)}
                    aria-label={`Remove the band ${ranges[i]}`}
                  >
                    <X aria-hidden />
                  </Button>
                ) : (
                  <span className="hidden size-8 @md:block" />
                )}
              </span>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled || part.bands.length >= 10}
          onClick={addBand}
        >
          <Plus aria-hidden /> Add a band
        </Button>
      </div>

      {isMoney(part.metric) ? (
        <GuardFields part={part} onChange={onChange} disabled={disabled} />
      ) : null}

      {also ? (
        <p className="text-xs text-muted-foreground">{alsoSentence(also)}</p>
      ) : null}

      {switching ? (
        <MetricSwitchDialog
          open
          part={part}
          to={switching}
          onCancel={() => setSwitching(null)}
          onConfirm={bands => {
            onChange(switchedPart(part, switching, bands));
            setSwitching(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** "Counts only when": at least N clients, each spending $X, the first D days after a creative start left out. */
function GuardFields({
  part,
  onChange,
  disabled,
}: {
  part: BandPart;
  onChange: (next: BandPart) => void;
  disabled?: boolean;
}) {
  const g = part.guard;
  const on = g !== undefined;
  return (
    <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
      <CheckRow
        checked={on}
        disabled={disabled}
        className="text-sm"
        onChange={v => {
          if (v)
            onChange({
              ...part,
              guard: { minClients: 5, minSpendUsd: 500, excludeDays: 14 },
            });
          else {
            const { guard: _g, ...rest } = part;
            onChange(rest);
          }
        }}
      >
        Counts only when there are enough clients
      </CheckRow>
      {on ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          <span className="text-muted-foreground">At least</span>
          <NumberBox
            value={g?.minClients ?? Number.NaN}
            onChange={v =>
              onChange({ ...part, guard: { ...g, minClients: v } })
            }
            label={`Fewest clients ${part.label} needs`}
            width="w-16"
            integer
            disabled={disabled}
          />
          <span className="text-muted-foreground">
            clients, each spending at least
          </span>
          <NumberBox
            value={g?.minSpendUsd ?? Number.NaN}
            onChange={v =>
              onChange({ ...part, guard: { ...g, minSpendUsd: v } })
            }
            label={`Least spend a client needs for ${part.label}`}
            prefix="$"
            width="w-20"
            disabled={disabled}
          />
          <span className="text-muted-foreground">
            in the month, leaving out the first
          </span>
          <NumberBox
            value={g?.excludeDays ?? Number.NaN}
            onChange={v =>
              onChange({ ...part, guard: { ...g, excludeDays: v } })
            }
            label={`Days left out after a creative start for ${part.label}`}
            width="w-16"
            integer
            disabled={disabled}
          />
          <span className="text-muted-foreground">
            days after each creative start.
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pays on every client it covers, whatever their spend.
        </p>
      )}
    </div>
  );
}
