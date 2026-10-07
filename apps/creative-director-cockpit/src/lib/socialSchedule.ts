/**
 * When each post in a month goes out.
 *
 * Spread across the working days of the month rather than scheduled
 * together, because eight posts at the same minute is not a content
 * calendar. Mid-morning Kuwait, which is 07:00 UTC.
 */
export function spread(month: string, n: number): string[] {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const out: string[] = [];
  // Start a day in, so a batch approved on the 1st is never scheduled for
  // a moment that has already passed.
  const first = 2;
  const usable = Math.max(1, days - first);
  for (let i = 0; i < n; i++) {
    const day = Math.min(
      days,
      first + Math.round((i * usable) / Math.max(1, n)),
    );
    out.push(new Date(Date.UTC(year, mon - 1, day, 7, 0, 0)).toISOString());
  }
  return out;
}
