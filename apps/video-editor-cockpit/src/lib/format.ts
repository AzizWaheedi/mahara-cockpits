/** Small, boring formatters. Kuwait is UTC+3 and never moves. */

const KUWAIT = "Asia/Kuwait";

/** Filing day is Kuwait UTC+3, independent of the browser's local timezone. */
export function kuwaitDay(now = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
}

/** What an empty value reads as, in words rather than dashes. */
const NOT_SET = "Not set";

export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds))
    return NOT_SET;
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

export function minutes(seconds: number | null | undefined): string {
  if (!seconds) return "0 min";
  const m = seconds / 60;
  return m < 1 ? `${Math.round(seconds)} sec` : `${m.toFixed(1)} min`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return NOT_SET;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_SET;
  return d.toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
  });
}

export function moment(iso: string | null | undefined): string {
  if (!iso) return NOT_SET;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_SET;
  return d.toLocaleString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Kuwait calendar days from today to the due date: 0 is today, -1 yesterday.
 *
 * ClickUp stores a date-only due date at 04:00 Kuwait, so the time of day
 * means nothing. Rounding hours turned a job due today into "1 day late"
 * from about 16:00 onwards.
 */
export function dueDays(
  iso: string | null | undefined,
  now = new Date(),
): number | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const a = Date.parse(kuwaitDay(due));
  const b = Date.parse(kuwaitDay(now));
  return Math.round((a - b) / 86_400_000);
}

/** "3 days late", "due today", "in 2 days". Plain words, no colour logic here. */
export function whenDue(
  iso: string | null | undefined,
  now = new Date(),
): {
  text: string;
  late: boolean;
} {
  const days = dueDays(iso, now);
  if (days === null) return { text: "no date", late: false };
  if (days < -1) return { text: `${Math.abs(days)} days late`, late: true };
  if (days === -1) return { text: "1 day late", late: true };
  if (days === 0) return { text: "due today", late: false };
  if (days === 1) return { text: "due tomorrow", late: false };
  return { text: `in ${days} days`, late: false };
}

export function shape(width: number | null, height: number | null): string {
  if (!width || !height) return "";
  const r = width / height;
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(r - 1) < 0.02) return "1:1";
  if (Math.abs(r - 4 / 5) < 0.02) return "4:5";
  return `${width}x${height}`;
}

/** A Drive file id embedded in a preview frame. */
export function drivePreview(
  driveId: string | null | undefined,
): string | null {
  return driveId ? `https://drive.google.com/file/d/${driveId}/preview` : null;
}
