/**
 * Kuwait time (UTC+3, no daylight saving). The company works Saturday to
 * Thursday; every CEO "day", "week" and "month" is on this clock.
 */
export const KUWAIT_OFFSET_MS = 3 * 3600_000;

/** YYYY-MM-DD in Kuwait for an epoch ms. */
export function kuwaitDay(at: number = Date.now()): string {
  return new Date(at + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Kuwait day n days before `day`. */
export function addDays(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** First day of the Kuwait month containing `day`. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Days in the month of `day`. */
export function daysInMonth(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
