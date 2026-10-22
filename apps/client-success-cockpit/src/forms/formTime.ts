import { shortDay } from "@/lib/format";

/**
 * Times as the CSM reads them: Kuwait's clock (UTC+3, no daylight saving),
 * whatever the browser's own zone. Pure, for the trail and the side panel.
 */

const KUWAIT_MS = 3 * 3_600_000;

const at = (iso: string | null | undefined) => {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? ms : null;
};

/** The Kuwait calendar day of an instant, as YYYY-MM-DD. */
export function kuwaitDay(iso: string | null | undefined): string | null {
  const ms = at(iso);
  return ms === null
    ? null
    : new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
}

/** "14:02" in Kuwait. */
export function kuwaitTime(iso: string | null | undefined): string {
  const ms = at(iso);
  return ms === null
    ? ""
    : new Date(ms + KUWAIT_MS).toISOString().slice(11, 16);
}

/** "13 Oct" in Kuwait. */
export function kuwaitShortDay(iso: string | null | undefined): string {
  return shortDay(kuwaitDay(iso));
}

/** "today 13:10", or "13 Oct 13:10" on another day. */
export function whenSaid(
  iso: string | null | undefined,
  nowIso: string,
): string {
  const day = kuwaitDay(iso);
  if (!day) return "";
  const time = kuwaitTime(iso);
  return day === kuwaitDay(nowIso)
    ? `today ${time}`
    : `${shortDay(day)} ${time}`;
}

/** "today at 14:02", or "on 15 Oct at 14:02" on another day. */
export function atWhen(iso: string | null | undefined, nowIso: string): string {
  const day = kuwaitDay(iso);
  if (!day) return "";
  const time = kuwaitTime(iso);
  return day === kuwaitDay(nowIso)
    ? `today at ${time}`
    : `on ${shortDay(day)} at ${time}`;
}
