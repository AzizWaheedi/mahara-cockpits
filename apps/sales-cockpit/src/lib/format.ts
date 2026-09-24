/** Small, boring formatters. Kuwait is UTC+3 and never moves. */

export const KUWAIT = "Asia/Kuwait";
const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;

/** YYYY-MM-DD of a moment, in Kuwait. */
export function kuwaitDay(ms: number): string {
  return new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Kuwait that starts the given Kuwait day, as a Date. */
export function kuwaitMidnight(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - KUWAIT_OFFSET_MS);
}

/** Minutes since Kuwait midnight for a moment. */
export function kuwaitMinutes(ms: number): number {
  const d = new Date(ms + KUWAIT_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("en-GB", {
    timeZone: KUWAIT,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Today", "Yesterday", "Tomorrow", or "Thu 24 Sep". */
export function dayLabel(
  iso: string | null | undefined,
  now = Date.now(),
): string {
  if (!iso) return "--";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--";
  const d = kuwaitDay(t);
  const today = kuwaitDay(now);
  if (d === today) return "Today";
  if (d === kuwaitDay(now - 86_400_000)) return "Yesterday";
  if (d === kuwaitDay(now + 86_400_000)) return "Tomorrow";
  return new Date(t).toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function when(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "--";
  return `${dayLabel(iso, now)} ${clock(iso)}`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** "4 min ago", "3 h ago", "2 days ago", "in 20 min". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--";
  const m = Math.round((now - t) / 60_000);
  if (m < 0) {
    const f = -m;
    if (f < 60) return `in ${f} min`;
    if (f < 48 * 60) return `in ${Math.round(f / 60)} h`;
    return `in ${Math.round(f / 1440)} days`;
  }
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds))
    return "--";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Money with no cents: "$6,000". A missing amount is a dash, never $0. */
export function money(v: unknown, currency = "USD"): string {
  const n = num(v);
  if (n === null) return "--";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  }
}

/** A rate B2B already gives as a percentage (62.5 means 62.5%). */
export function pct(v: unknown, digits = 0): string {
  const n = num(v);
  if (n === null) return "--";
  return `${n.toFixed(digits)}%`;
}

/** part ÷ whole as a percentage, or a dash when there is nothing to divide. */
export function share(part: unknown, whole: unknown, digits = 0): string {
  const p = num(part);
  const w = num(whole);
  if (p === null || w === null || w <= 0) return "--";
  return `${((100 * p) / w).toFixed(digits)}%`;
}

export function count(v: unknown): string {
  const n = num(v);
  return n === null ? "--" : n.toLocaleString("en-US");
}

const CALL_TYPES: Record<string, string> = {
  intro: "Intro",
  demo: "Demo",
  follow_up: "Follow-up",
  callback: "Callback",
};

export function callType(t: string | null | undefined): string {
  return CALL_TYPES[String(t ?? "")] ?? "Call";
}

/** Typical length of each kind of call, for the day line. */
export function callMinutes(t: string | null | undefined): number {
  return t === "demo" ? 45 : t === "follow_up" ? 30 : 15;
}

const STATUS: Record<string, string> = {
  showed: "Showed",
  noshow: "No-show",
  cancelled: "Cancelled",
  invalid: "Disqualified",
  confirmed: "Confirmed",
  new: "Booked",
  rescheduled: "Rescheduled",
};

export function statusLabel(s: string | null | undefined): string {
  return STATUS[String(s ?? "")] ?? (s ? String(s) : "Unknown");
}

const CLASS: Record<string, string> = {
  qualified: "Qualified",
  unqualified: "Unqualified",
  unprepared: "Not ready",
};

export function classLabel(c: string | null | undefined): string {
  return c ? (CLASS[c] ?? c) : "No lead tag";
}

/** Names from HighLevel stages carry emoji; the list reads better without. */
export function plainStage(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\u{FE0F}|\u{200D}/gu, "")
    .trim();
}

/** True when a string is mostly Arabic, so it can be set right to left. */
export function isArabic(s: string | null | undefined): boolean {
  const t = String(s ?? "");
  const ar = (t.match(/[؀-ۿ]/g) ?? []).length;
  const lat = (t.match(/[A-Za-z]/g) ?? []).length;
  return ar > lat;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
