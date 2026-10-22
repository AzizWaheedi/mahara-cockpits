/**
 * The Ads table's metric picker (Aziz, 2026-10-20): the classic columns stay
 * exactly as they were and are the default. Any other number the payload
 * already carries can be ticked on, and "Back to classic" puts the table
 * back. No all-clicks CTR: the CEO reads link CTR only (2026-10-08). Same look as the Client performance column picker, so both read
 * alike. The pick is remembered in this browser only.
 */
import { useState } from "react";
import { count, money, pct } from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { Button } from "@/components/ui/button";
import type { B2bAdWindow } from "@/types/ceo/payloads";

export type MetricCol = {
  key: string;
  label: string;
  title?: string;
  get: (w: B2bAdWindow) => number | null;
  fmt: (v: number) => string;
  low?: boolean;
  intro?: boolean;
};

const times = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}×`;
const freq = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export type ExtraGroup = { key: string; label: string; cols: MetricCol[] };

/** Off by default. Every one is a field the server already sends; none is worked out here except a plain ratio. */
export const EXTRA_GROUPS: ExtraGroup[] = [
  {
    key: "delivery",
    label: "Delivery",
    cols: [
      {
        key: "clicks",
        label: "Clicks (all)",
        title: "Every click Meta counts",
        get: w => w.clicks,
        fmt: count,
      },
      {
        key: "linkClicks",
        label: "Link clicks",
        get: w => w.linkClicks,
        fmt: count,
      },
      {
        key: "frequency",
        label: "Frequency",
        title: "Meta's own frequency for the window",
        get: w => w.frequency,
        fmt: freq,
      },
    ],
  },
  {
    key: "results",
    label: "Results",
    cols: [
      {
        key: "metaLeads",
        label: "Meta results",
        title:
          "What Meta counts for the ad: form leads, or applicants on a hiring form. The CRM's leads are the classic Leads column.",
        get: w => w.metaLeads,
        fmt: count,
      },
      {
        key: "costPerMetaLead",
        label: "$/Meta result",
        title: "Spend over what Meta counts",
        get: w => (w.metaLeads > 0 ? w.spend / w.metaLeads : null),
        fmt: money,
        low: true,
      },
      {
        key: "qualifiedLeads",
        label: "Fit leads",
        title: "Leads the setters tagged roas-qualified",
        get: w => w.qualifiedLeads,
        fmt: count,
      },
      {
        key: "costPerQualified",
        label: "$/fit lead",
        get: w => w.costPerQualified,
        fmt: money,
        low: true,
      },
      {
        key: "notReadyLeads",
        label: "Not ready",
        title: "Contacts tagged roas-unprepared, outside Leads",
        get: w => w.notReadyLeads,
        fmt: count,
      },
    ],
  },
  {
    key: "intros",
    label: "Intro calls",
    cols: [
      {
        key: "bookRate",
        label: "Lead to intro",
        title: "Leads with an intro booked after they came in",
        get: w => w.bookRate,
        fmt: pct,
      },
      {
        key: "introsShown",
        label: "Intros shown",
        get: w => w.introsShown,
        fmt: count,
      },
      {
        key: "introShowRate",
        label: "Intro show",
        title: "Intros shown over intros due",
        get: w => w.introShowRate,
        fmt: pct,
      },
      {
        key: "costPerIntroShown",
        label: "$/intro shown",
        get: w => w.costPerIntroShown,
        fmt: money,
        low: true,
      },
      {
        key: "introsCancelled",
        label: "Intros cancelled",
        get: w => w.introsCancelled,
        fmt: count,
        low: true,
      },
    ],
  },
  {
    key: "demos",
    label: "Demos and deals",
    cols: [
      {
        key: "demosBooked",
        label: "Demos booked",
        get: w => w.demosBooked,
        fmt: count,
      },
      {
        key: "leadToDemo",
        label: "Lead to demo",
        get: w => w.leadToDemo,
        fmt: pct,
      },
      {
        key: "demosShown",
        label: "Demos shown",
        get: w => w.demosShown,
        fmt: count,
      },
      {
        key: "demoShowRate",
        label: "Demo show",
        title: "Demos shown over demos due",
        get: w => w.demoShowRate,
        fmt: pct,
      },
      {
        key: "costPerDemo",
        label: "$/demo shown",
        get: w => w.costPerDemo,
        fmt: money,
        low: true,
      },
      {
        key: "closeRate",
        label: "Close rate",
        title: "Signed over demos shown",
        get: w => w.closeRate,
        fmt: pct,
      },
      { key: "cash", label: "Cash", get: w => w.cash, fmt: money },
      {
        key: "cashRoas",
        label: "Cash ROAS",
        title: "Cash over spend",
        get: w => w.cashRoas,
        fmt: times,
      },
    ],
  },
];

export const EXTRA_COLS: MetricCol[] = EXTRA_GROUPS.flatMap(g => g.cols);
const KNOWN = new Set(EXTRA_COLS.map(c => c.key));
const KEY = "cockpit.ceo.ads.extraMetrics.v1";

function readPick(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((k): k is string => typeof k === "string" && KNOWN.has(k))
      : [];
  } catch {
    return [];
  }
}

/** The ticked extras, in the picker's order. Empty = classic. */
export function useExtraMetrics(): [string[], (keys: string[]) => void] {
  const [pick, setPick] = useState<string[]>(readPick);
  const save = (keys: string[]) => {
    const ordered = EXTRA_COLS.map(c => c.key).filter(k => keys.includes(k));
    setPick(ordered);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ordered));
    } catch {
      // A private window: the pick lasts this visit only.
    }
  };
  return [pick, save];
}

export function MetricPicker({
  shown,
  onChange,
}: {
  shown: string[];
  onChange: (keys: string[]) => void;
}) {
  const set = new Set(shown);
  const toggle = (key: string) =>
    onChange(set.has(key) ? shown.filter(k => k !== key) : [...shown, key]);
  return (
    <div className="rounded-xl bg-muted/40 p-4" id="ads-metrics">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {shown.length ? `Classic + ${shown.length} more` : "Classic columns"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!shown.length}
          onClick={() => onChange([])}
        >
          Back to classic
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(EXTRA_COLS.map(c => c.key))}
        >
          Every metric
        </Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {EXTRA_GROUPS.map(g => (
          <fieldset key={g.key} className="min-w-0">
            <legend>
              <Kicker as="span">{g.label}</Kicker>
            </legend>
            <ul className="mt-1.5 space-y-1">
              {g.cols.map(c => (
                <li key={c.key}>
                  <label
                    className="flex cursor-pointer items-center gap-2 text-[13px]"
                    title={c.title}
                  >
                    <input
                      type="checkbox"
                      checked={set.has(c.key)}
                      onChange={() => toggle(c.key)}
                      className="size-4"
                    />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
