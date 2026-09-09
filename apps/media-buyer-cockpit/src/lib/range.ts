/**
 * Date ranges, in Kuwait days.
 *
 * Everything the cockpit stores is stamped with the Kuwait calendar day the
 * tracker uses, so ranges are computed the same way — never in the browser's
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
];

export function defaultRange(): Range {
  return PRESETS.find(p => p.key === "7d")?.make() as Range;
}

export function customRange(start: string, end: string): Range {
  const [a, b] = start <= end ? [start, end] : [end, start];
  return { start: a, end: b, label: `${a} → ${b}`, key: "custom" };
}

/** How many days a range covers, inclusive. */
export function rangeDays(r: Range): number {
  return Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000) + 1;
}
