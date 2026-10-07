/**
 * Date ranges, in Kuwait days.
 *
 * Everything the cockpit stores is stamped with the Kuwait calendar day the
 * tracker uses, so ranges are computed the same way, never in the browser's
 * timezone, which would put "today" a day out for anyone travelling.
 * [aziz, 2026-09-07]
 */

export type Range = { start: string; end: string; label: string; key: string };

export function kuwaitDay(offsetDays = 0): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - offsetDays * 86400000)
    .toISOString()
    .slice(0, 10);
}

export function lastNDays(n: number): { start: string; end: string } {
  // n days ending today, inclusive.
  return { start: kuwaitDay(n - 1), end: kuwaitDay(0) };
}

export const PRESETS: { key: string; label: string; make: () => Range }[] = [
  {
    key: "today",
    label: "Today",
    make: () => ({
      ...lastNDays(1),
      label: "Today",
      key: "today",
    }),
  },
  {
    key: "yesterday",
    label: "Yesterday",
    make: () => ({
      start: kuwaitDay(1),
      end: kuwaitDay(1),
      label: "Yesterday",
      key: "yesterday",
    }),
  },
  {
    key: "3d",
    label: "3 days",
    make: () => ({ ...lastNDays(3), label: "Last 3 days", key: "3d" }),
  },
  {
    key: "7d",
    label: "7 days",
    make: () => ({ ...lastNDays(7), label: "Last 7 days", key: "7d" }),
  },
  {
    key: "14d",
    label: "14 days",
    make: () => ({ ...lastNDays(14), label: "Last 14 days", key: "14d" }),
  },
  {
    key: "30d",
    label: "30 days",
    make: () => ({ ...lastNDays(30), label: "Last 30 days", key: "30d" }),
  },
  {
    key: "mtd",
    label: "Month to date",
    make: () => ({
      start: `${kuwaitDay().slice(0, 7)}-01`,
      end: kuwaitDay(),
      label: "Month to date",
      key: "mtd",
    }),
  },
  {
    key: "last-month",
    label: "Last month",
    make: () => {
      const [year, month] = kuwaitDay().split("-").map(Number);
      const end = new Date(Date.UTC(year, month - 1, 0))
        .toISOString()
        .slice(0, 10);
      return {
        start: `${end.slice(0, 7)}-01`,
        end,
        label: "Last month",
        key: "last-month",
      };
    },
  },
  {
    key: "ytd",
    label: "Year to date",
    make: () => ({
      start: `${kuwaitDay().slice(0, 4)}-01-01`,
      end: kuwaitDay(),
      label: "Year to date",
      key: "ytd",
    }),
  },
  {
    key: "last-year",
    label: "Last year",
    make: () => {
      const year = Number(kuwaitDay().slice(0, 4)) - 1;
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        label: "Last year",
        key: "last-year",
      };
    },
  },
];

export function defaultRange(): Range {
  return PRESETS.find(p => p.key === "7d")?.make() as Range;
}

export function customRange(start: string, end: string): Range {
  const [a, b] = start <= end ? [start, end] : [end, start];
  return { start: a, end: b, label: `${a} to ${b}`, key: "custom" };
}

/** How many days a range covers, inclusive. */
export function rangeDays(r: Range): number {
  return Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000) + 1;
}

/** A range as it sits in the address: a preset's key, or "start..end". */
export function rangeToParam(r: Range): string {
  return r.key === "custom" ? `${r.start}..${r.end}` : r.key;
}

/** A range from the address, or undefined when the value is not one. */
export function rangeFromParam(
  value: string | null | undefined,
): Range | undefined {
  if (!value) return undefined;
  const preset = PRESETS.find(p => p.key === value);
  if (preset) return preset.make();
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
  return m ? customRange(m[1], m[2]) : undefined;
}

const SAVED_RANGE = "cockpit-range";

/**
 * The last preset picked on this device, so a 3-day pick is still 3 days
 * after a reload or a trip to another page (Nada, 2026-10-01: it snapped
 * back to 7). A custom span stays in the address only: dates go stale.
 */
export function savedRange(): Range | undefined {
  try {
    const key = window.localStorage.getItem(SAVED_RANGE);
    return key ? PRESETS.find(p => p.key === key)?.make() : undefined;
  } catch {
    return undefined;
  }
}

export function saveRange(r: Range): void {
  try {
    if (r.key !== "custom") window.localStorage.setItem(SAVED_RANGE, r.key);
  } catch {
    // A private window has no storage; the address still holds the range.
  }
}
