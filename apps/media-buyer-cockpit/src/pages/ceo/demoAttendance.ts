import type { GrowthDay } from "@/types/ceo/payloads";

/** Sales' appointment-day counts, only when every day is present and measured. */
export function demoAttendanceForDays(
  days: GrowthDay[] | null | undefined,
  from: string,
  to: string,
): { held: number; disqualified: number } | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  )
    return null;
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    new Date(first).toISOString().slice(0, 10) !== from ||
    new Date(last).toISOString().slice(0, 10) !== to ||
    (last - first) / 86_400_000 > 366
  )
    return null;
  const rows = (days ?? []).filter(d => d.date >= from && d.date <= to);
  const byDay = new Map(rows.map(d => [d.date, d]));
  if (
    byDay.size !== rows.length ||
    byDay.size !== (last - first) / 86_400_000 + 1
  )
    return null;
  let held = 0;
  let qualified = 0;
  for (let date = first; date <= last; date += 86_400_000) {
    const row = byDay.get(new Date(date).toISOString().slice(0, 10));
    if (
      !row ||
      !Number.isSafeInteger(row.demosShown) ||
      !Number.isSafeInteger(row.demosQualified) ||
      row.demosShown! < 0 ||
      row.demosQualified! < 0 ||
      row.demosQualified! > row.demosShown!
    )
      return null;
    held += row.demosShown!;
    qualified += row.demosQualified!;
  }
  return { held, disqualified: held - qualified };
}
