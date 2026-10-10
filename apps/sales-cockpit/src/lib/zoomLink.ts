/**
 * The words and links of the instant Zoom link and the WhatsApp group
 * (2026-10-10), pure so they are tested: the lead's WhatsApp number, the
 * wa.me link that opens the rep's own WhatsApp with the message filled in,
 * the call's time on the lead's clock, the messages in both languages, the
 * group's name and the lead's contact card.
 *
 * Arabic follows the Kuwaiti voice rules: no em dash, no guillemets,
 * Arabic-Indic digits, no thousands mark. The Zoom message is the approved
 * call_link backup body (docs/live-calls/final_arabic.md) without its
 * "10 minutes" line, since this link has no wait.
 */
import { clockCountry, leadClock } from "./leadClock";

export type Lang = "ar" | "en";

/** The digits wa.me needs: an international number only (it starts with +, at least 8 digits). */
export function waDigits(phone: string | null | undefined): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw.startsWith("+")) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Opens the rep's own WhatsApp on that number with the text filled in. */
export function waLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Why the WhatsApp button is not offered, or null when it is (plan D1.12). */
export function waBlocked(lead: {
  dnd?: boolean | null;
  phone?: string | null;
}): string | null {
  if (lead.dnd)
    return "Do not disturb is on in HighLevel, so the cockpit does not open WhatsApp for this lead. Copy the message if they asked for it.";
  if (!String(lead.phone ?? "").trim())
    return "There is no phone number for this lead. Copy the message instead.";
  if (!waDigits(lead.phone))
    return "The number has no country code, so WhatsApp cannot open it. Copy the message instead.";
  return null;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** 0 to 9 as Arabic-Indic digits; no thousands mark is ever added. */
export function arDigits(s: string): string {
  return s.replace(/[0-9]/g, d => AR_DIGITS[Number(d)]);
}

export function firstName(name: string | null | undefined): string {
  return (
    String(name ?? "")
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

/** The Gulf clocks by country, with how a message names them. */
const ZONE_WORDS: Record<string, { zone: string; en: string; ar: string }> = {
  KW: { zone: "Asia/Kuwait", en: "Kuwait", ar: "الكويت" },
  SA: { zone: "Asia/Riyadh", en: "Saudi", ar: "السعودية" },
  AE: { zone: "Asia/Dubai", en: "UAE", ar: "الإمارات" },
  QA: { zone: "Asia/Qatar", en: "Qatar", ar: "قطر" },
  BH: { zone: "Asia/Bahrain", en: "Bahrain", ar: "البحرين" },
  OM: { zone: "Asia/Muscat", en: "Oman", ar: "عُمان" },
};
const GULF_BY_ZONE = new Map(
  Object.values(ZONE_WORDS).map(z => [z.zone, z] as const),
);

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

const wall = new Map<string, Intl.DateTimeFormat>();
function wallClock(ms: number, zone: string) {
  let f = wall.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    wall.set(zone, f);
  }
  const parts = f.formatToParts(ms);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")) - 1,
    d: Number(get("day")),
    h: Number(get("hour")),
    min: Number(get("minute")),
    dow: EN_DAYS.indexOf(get("weekday")),
  };
}

/**
 * The part of the day an Arabic time is said with. The plan asked for
 * الصبح before 12 and المسا after; these are the buckets the cockpit's
 * confirmation messages already use (whatsapp.ts callWords), so a lead never
 * reads "٢ المسا" in the group and "٢ الظهر" in the confirmation.
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

export interface CallWhen {
  /** "Sun 12 Oct" / "الأحد ١٢ أكتوبر" */
  day: string;
  /** "6:00 pm" / "٦ المغرب" */
  time: string;
  /** "Kuwait time" / "بتوقيت الكويت" */
  zone: string;
  /** All of it: "Sun 12 Oct at 6:00 pm Kuwait time" / "الأحد ١٢ أكتوبر الساعة ٦ المغرب بتوقيت الكويت" */
  text: string;
}

/**
 * A call's day and time on the lead's own clock (a Gulf number's country
 * first, then the stored one; Kuwait when not known). English names any
 * clock by its city; Arabic names the six Gulf countries and keeps to
 * Kuwait's clock for anywhere else, since there is no Arabic city name to
 * give it.
 */
export function callWhen(
  iso: string,
  country: string | null | undefined,
  lang: Lang,
  phone?: string | null,
): CallWhen {
  const ms = Date.parse(iso);
  const clock = leadClock(clockCountry(country, phone)) ?? "Asia/Kuwait";
  const gulf = GULF_BY_ZONE.get(clock);
  const zone = lang === "ar" && !gulf ? "Asia/Kuwait" : clock;
  const named = GULF_BY_ZONE.get(zone);
  const w = wallClock(ms, zone);
  if (lang === "ar") {
    const day = arDigits(`${AR_DAYS[w.dow]} ${w.d} ${AR_MONTHS[w.m]}`);
    const clockText = w.min
      ? `${w.h % 12 || 12}:${String(w.min).padStart(2, "0")}`
      : `${w.h % 12 || 12}`;
    const time = `${arDigits(clockText)} ${arPart(w.h)}`;
    const zoneWords = `بتوقيت ${named?.ar ?? "الكويت"}`;
    return {
      day,
      time,
      zone: zoneWords,
      text: `${day} الساعة ${time} ${zoneWords}`,
    };
  }
  const day = `${EN_DAYS[w.dow]} ${w.d} ${EN_MONTHS[w.m]}`;
  const time = `${w.h % 12 || 12}:${String(w.min).padStart(2, "0")} ${w.h < 12 ? "am" : "pm"}`;
  const place =
    named?.en ?? (zone.split("/").pop() || "Kuwait").replace(/_/g, " ");
  const zoneWords = `${place} time`;
  return { day, time, zone: zoneWords, text: `${day} at ${time} ${zoneWords}` };
}

/** The Zoom message, as the lead gets it from the rep's own WhatsApp. */
export function zoomMessage(
  lang: Lang,
  v: { first: string; rep: string; link: string },
): string {
  const first = v.first.trim();
  if (lang === "ar")
    return `هلا${first ? ` ${first}` : ""}، مكالمتك مع ${v.rep} من مهارة ميديا جاهزة. ادخل من هني:\n${v.link}`;
  return `Hi${first ? ` ${first}` : ""}, your call with ${v.rep} from Mahara Media is ready. Join here:\n${v.link}`;
}

/** Which name the message gives the rep: their Arabic name in Arabic when set, else the English first name. */
export function repName(
  lang: Lang,
  rep: { name?: string | null; name_ar?: string | null },
): string {
  if (lang === "ar" && rep.name_ar?.trim()) return rep.name_ar.trim();
  return firstName(rep.name) || "the team";
}

export interface GroupWords {
  first: string;
  closer: string;
  when: CallWhen | null;
}

/** The invite the setter sends the lead from her own WhatsApp. */
export function groupInvite(
  lang: Lang,
  v: GroupWords & { invite: string },
): string {
  const first = v.first.trim();
  if (lang === "ar") {
    const when = v.when
      ? ` ${v.when.day} الساعة ${v.when.time} ${v.when.zone}`
      : "";
    return `هلا${first ? ` ${first}` : ""}، سويت قروب واتساب مع ${v.closer} عشان الديمو${when}. ادخل من هني:\n${v.invite}`;
  }
  const when = v.when
    ? ` on ${v.when.day} at ${v.when.time} ${v.when.zone}`
    : "";
  return `Hi${first ? ` ${first}` : ""}, I've made a WhatsApp group with ${v.closer} for your demo${when}. Join here:\n${v.invite}`;
}

/** The first message in the group, with the Zoom line when a link was made for this demo. */
export function groupWelcome(
  lang: Lang,
  v: GroupWords & { zoom?: string | null },
): string {
  const first = v.first.trim();
  let text: string;
  if (lang === "ar") {
    const when = v.when
      ? ` ${v.when.day} الساعة ${v.when.time} ${v.when.zone}`
      : "";
    text = `هلا والله${first ? ` ${first}` : ""}. معانا هني ${v.closer}، اللي بيكون معاك بالديمو${when}. أي سؤال قبلها، اكتبه هني.`;
    if (v.zoom) text += `\nلينك الزوم: ${v.zoom}`;
    return text;
  }
  const when = v.when
    ? ` on ${v.when.day} at ${v.when.time} ${v.when.zone}`
    : "";
  text = `Welcome${first ? `, ${first}` : ""}. ${v.closer} is here too and will take your demo${when}. Any question before then, ask here.`;
  if (v.zoom) text += `\nZoom link: ${v.zoom}`;
  return text;
}

const SUFFIX = " | Mahara Media";
/** The group's name: the company, else the lead's full name, and Mahara Media; 100 characters at most (WhatsApp's limit). */
export function groupName(lead: {
  company?: string | null;
  name?: string | null;
}): string {
  const base =
    String(lead.company ?? "").trim() ||
    String(lead.name ?? "").trim() ||
    "New client";
  const room = 100 - SUFFIX.length;
  const cut = [...base].slice(0, room).join("").trim();
  return `${cut}${SUFFIX}`;
}

const vEscape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");

/** A vCard 3.0 for the lead, so the setter can add them to the group by hand. */
export function vcard(name: string, phone: string): string {
  const n = vEscape(name.trim() || "Lead");
  const tel = String(phone)
    .trim()
    .replace(/[^\d+]/g, "");
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${n}`,
    `N:${n};;;;`,
    `TEL;TYPE=CELL:${tel}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}

/** The time on this device's clock, for "Made at 14:02". */
export function clockTime(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A pressed link is reused for 12 hours (sales-api reuse_hours). */
export const REUSE_MS = 12 * 3_600_000;

/** The invite link WhatsApp copies, cleaned as sales-api cleans it; undefined when it is not one. */
export function cleanInvite(v: string): string | null | undefined {
  let s = v.trim();
  if (!s) return null;
  if (/^chat\.whatsapp\.com\//i.test(s)) s = `https://${s}`;
  s = s
    .replace(/^http:\/\//i, "https://")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/^https:\/\/chat\.whatsapp\.com\//i, "https://chat.whatsapp.com/");
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,64}$/.test(s)
    ? s
    : undefined;
}
