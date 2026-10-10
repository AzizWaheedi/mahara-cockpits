import { clockCountry, leadClock } from "./leadClock";
import { CLOSER_KEY } from "./script";

/**
 * Booking the demo from the intro script (sales simplify, 2026-10-10): the
 * soonest free times as buttons, the setter's intro marked held first when
 * it is plainly happening, the line for the closer written from what the
 * setter captured, and the times said the way the lead hears them, on
 * their own clock. The booking itself goes through book.create unchanged.
 */

export interface SlotDay {
  day: string;
  slots: string[];
}

/** The soonest free times across the days the calendar gave, in time order. */
export function nextSlots(
  days: SlotDay[] | null | undefined,
  n = 4,
  now = Date.now(),
): string[] {
  const seen = new Set<number>();
  const all: { iso: string; t: number }[] = [];
  for (const d of days ?? [])
    for (const iso of d.slots ?? []) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || t <= now || seen.has(t)) continue;
      seen.add(t);
      all.push({ iso, t });
    }
  return all
    .sort((a, b) => a.t - b.t)
    .slice(0, n)
    .map(x => x.iso);
}

export interface ApptLike {
  appointment_id: string;
  call_type: string | null;
  start_at: string | null;
  status: string | null;
  marked_status?: string | null;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
}

const OVER = ["cancelled", "noshow", "showed", "invalid"];

/**
 * The intro to mark held before the demo is booked: one that started in the
 * last 3 hours, or starts within 10 minutes (sales-api refuses a showed mark
 * on a call more than 10 minutes ahead), with no mark yet, that this rep may
 * mark (theirs, or any for a manager). None means nothing is marked.
 */
export function introToMark<T extends ApptLike>(
  appts: T[],
  me: { ghl_user_id?: string | null; manager?: boolean | null },
  now = Date.now(),
): T | null {
  const hits = appts.filter(a => {
    if (a.call_type !== "intro" || !a.start_at) return false;
    const t = Date.parse(a.start_at);
    if (!Number.isFinite(t)) return false;
    if (t < now - 3 * 3_600_000 || t > now + 10 * 60_000) return false;
    if (a.marked_status || OVER.includes(String(a.status ?? ""))) return false;
    return Boolean(
      me.manager || (me.ghl_user_id && a.assigned_user_id === me.ghl_user_id),
    );
  });
  hits.sort(
    (a, b) =>
      Math.abs(Date.parse(String(a.start_at)) - now) -
      Math.abs(Date.parse(String(b.start_at)) - now),
  );
  return hits[0] ?? null;
}

/** The lead's demo that has not happened yet, if one is booked. */
export function bookedDemo<T extends ApptLike>(
  appts: T[],
  now = Date.now(),
): T | null {
  return (
    appts
      .filter(
        a =>
          a.call_type === "demo" &&
          a.start_at &&
          Date.parse(a.start_at) > now - 60 * 60_000 &&
          !["cancelled", "invalid", "noshow"].includes(
            String(a.marked_status ?? a.status ?? ""),
          ),
      )
      .sort(
        (a, b) =>
          Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)),
      )[0] ?? null
  );
}

/**
 * The line for whoever takes the demo (book.create wants 3 characters at
 * least): the setter's own words for the closer first, then the pain and
 * the goal they captured.
 */
export function closerLine(values: Record<string, string | undefined>): string {
  const clean = (v: string | undefined) =>
    (v ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/, "");
  const parts = [
    clean(values[CLOSER_KEY]),
    clean(values.pain) ? `The pain: ${clean(values.pain)}` : "",
    clean(values.goal) ? `Goal: ${clean(values.goal)}` : "",
  ].filter(Boolean);
  const line = parts.length ? `${parts.join(". ")}.` : "";
  return line.length > 600 ? `${line.slice(0, 599).trimEnd()}…` : line;
}

// ------------------------------------------------------------------ times

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const AR_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];
const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];
const AR = "٠١٢٣٤٥٦٧٨٩";

/** 0–9 as Arabic-Indic digits; no thousands mark. */
export function arDigits(s: string | number): string {
  return String(s).replace(/\d/g, d => AR[Number(d)]);
}

/** The Gulf clocks the scripts name, as a time is said: "Saudi time". */
const ZONES: Record<string, [string, string]> = {
  "Asia/Kuwait": ["Kuwait", "الكويت"],
  "Asia/Riyadh": ["Saudi", "السعودية"],
  "Asia/Dubai": ["UAE", "الإمارات"],
  "Asia/Qatar": ["Qatar", "قطر"],
  "Asia/Bahrain": ["Bahrain", "البحرين"],
  "Asia/Muscat": ["Oman", "عُمان"],
};

/** The lead's clock when the cockpit can name it, else Kuwait's. */
export function leadZone(country: unknown, phone?: unknown): string {
  const z = leadClock(clockCountry(country, phone));
  return z && z in ZONES ? z : "Asia/Kuwait";
}

interface Wall {
  wd: number;
  day: number;
  month: number;
  hour: number;
  minute: number;
  ymd: string;
}

function wall(t: number, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  return {
    wd: EN_DAYS.indexOf(get("weekday")),
    day,
    month,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    ymd: `${get("year")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function enClock(w: Wall): string {
  const h = w.hour % 12 || 12;
  return `${h}:${String(w.minute).padStart(2, "0")} ${w.hour < 12 ? "am" : "pm"}`;
}

/**
 * The part of the day, as the cockpit's confirmations (whatsapp.ts) and the
 * group invite (zoomLink.ts) say it: what the setter says on the call is
 * what the lead then reads.
 */
function arPart(h: number): string {
  return h < 12
    ? "الصبح"
    : h < 15
      ? "الظهر"
      : h < 18
        ? "العصر"
        : h < 20
          ? "المغرب"
          : "بالليل";
}

function arClock(w: Wall): string {
  const h = w.hour % 12 || 12;
  const m = w.minute ? `:${arDigits(String(w.minute).padStart(2, "0"))}` : "";
  return `${arDigits(h)}${m} ${arPart(w.hour)}`;
}

/**
 * A time as a booking button shows it: Kuwait's clock ("Sun 12 Oct, 6:00
 * pm"), and the lead's own when it reads differently ("5:00 pm Saudi time").
 */
export function slotWords(
  iso: string,
  country: unknown,
  phone?: unknown,
): { kuwait: string; day: string; time: string; theirs: string | null } {
  const t = Date.parse(iso);
  const k = wall(t, "Asia/Kuwait");
  const zone = leadZone(country, phone);
  const l = wall(t, zone);
  const day = `${EN_DAYS[k.wd]} ${k.day} ${EN_MONTHS[k.month - 1]}`;
  const time = enClock(k);
  const differs = l.hour !== k.hour || l.minute !== k.minute || l.ymd !== k.ymd;
  return {
    kuwait: `${day}, ${time}`,
    day,
    time,
    theirs: differs
      ? `${l.ymd !== k.ymd ? `${EN_DAYS[l.wd]} ` : ""}${enClock(l)} ${ZONES[zone][0]} time`
      : null,
  };
}

/**
 * A time as the script says it to the lead, on their clock. Short (the two
 * free times of "__ or __"): "Sun 6:00 pm", "الأحد الساعة ٦ المغرب". Whole
 * (the booked time of [TIME + TIMEZONE]): with the date and the zone,
 * "Sun 12 Oct at 6:00 pm Kuwait time", "الأحد ١٢ أكتوبر الساعة ٦ المغرب
 * بتوقيت الكويت".
 */
export function sayWhen(
  iso: string,
  lang: "en" | "ar",
  opts: { country?: unknown; phone?: unknown; whole?: boolean } = {},
): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const zone = leadZone(opts.country, opts.phone);
  const w = wall(t, zone);
  if (lang === "ar") {
    const date = opts.whole
      ? ` ${arDigits(w.day)} ${AR_MONTHS[w.month - 1]}`
      : "";
    const where = opts.whole ? ` بتوقيت ${ZONES[zone][1]}` : "";
    return `${AR_DAYS[w.wd]}${date} الساعة ${arClock(w)}${where}`;
  }
  if (!opts.whole) return `${EN_DAYS[w.wd]} ${enClock(w)}`;
  return `${EN_DAYS[w.wd]} ${w.day} ${EN_MONTHS[w.month - 1]} at ${enClock(w)} ${ZONES[zone][0]} time`;
}
