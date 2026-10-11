import { clockCountry, leadClock } from "./leadClock";
import type { CallKind, LeadLike } from "./reschedule";
import { leadFirst } from "./reschedule";
import { callWords, fillSnippet, type Moment, type Snippet } from "./whatsapp";
import { callWhen, type Lang } from "./zoomLink";

/**
 * Tell them (2026-10-11): the message a rep sends the lead from their own
 * WhatsApp after a call is booked, rescheduled or missed, in the lead's
 * language and on the lead's clock. The cockpit itself sends nothing:
 * HighLevel's own confirmations and reminders are the only automatic
 * messages (plan D24). The team's library has the words when it holds a
 * message for the moment (cockpit_sales_snippets); otherwise the built-in
 * text below, from the design's copy table.
 *
 * Arabic follows the Kuwaiti voice rules: no em dash, no guillemets,
 * Arabic-Indic digits, no thousands mark, and اختار, not اختر.
 */

export type TellMoment =
  | "rescheduled"
  | "booked"
  | "confirm"
  | "missed_booked"
  | "missed_open"
  | "pick_time";

/** What the panel calls each message. */
export const TELL_LABELS: Record<TellMoment, string> = {
  rescheduled: "Rescheduled",
  booked: "Just booked",
  confirm: "Confirm the call",
  missed_booked: "Missed, booked again",
  missed_open: "Missed, not booked yet",
  pick_time: "Pick a time",
};

/** The library's moment for each message; none where the library has no such moment. */
const LIBRARY: Record<TellMoment, Moment | null> = {
  rescheduled: "rescheduled",
  booked: "booked",
  confirm: "confirm",
  missed_booked: null,
  missed_open: "no_show",
  pick_time: null,
};

export interface TellInput {
  moment: TellMoment;
  lang: Lang;
  lead: LeadLike;
  kind: CallKind;
  /** The call's time (the new one after a move). */
  start: string | null;
  /** The host's first name, and how it reads in Arabic when the team set it. */
  host?: { en: string | null; ar?: string | null } | null;
  /** The rep sending it. */
  rep?: { en: string | null; ar?: string | null } | null;
  /** The call's video link, when it has one. */
  zoom?: string | null;
  /** The lead's own link to pick another time (pick_time only). */
  link?: string | null;
  now?: number;
  snippets?: Snippet[] | null;
}

const AR_NOUN: Record<CallKind, string> = {
  intro: "مكالمة التعارف",
  demo: "الديمو",
  follow_up: "مكالمة المتابعة",
};
const EN_NOUN: Record<CallKind, string> = {
  intro: "intro call",
  demo: "demo",
  follow_up: "follow-up call",
};

const GULF = new Set([
  "Asia/Kuwait",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Muscat",
]);

const ymdFormats = new Map<string, Intl.DateTimeFormat>();
function ymd(ms: number, zone: string): string {
  let f = ymdFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    ymdFormats.set(zone, f);
  }
  return f.format(new Date(ms));
}

/** The clock a message names: the lead's; Arabic keeps to Kuwait's outside the Gulf (as callWhen does). */
function zoneFor(lead: LeadLike, lang: Lang): string {
  const z = leadClock(clockCountry(lead.country, lead.phone)) ?? "Asia/Kuwait";
  return lang === "ar" && !GULF.has(z) ? "Asia/Kuwait" : z;
}

/**
 * The call's day and time as the message says it, on the lead's clock:
 * "today at 5:00 pm Kuwait time", "tomorrow, Mon, at 5:30 pm UAE time",
 * "Tue 13 Oct at 6:00 pm UAE time"; in Arabic "اليوم الساعة ٥ العصر بتوقيت
 * الكويت", "باجر الاثنين الساعة ٥:٣٠ العصر بتوقيت الإمارات", "الثلاثاء ١٣
 * أكتوبر الساعة ٦ المغرب بتوقيت الإمارات". `dated` says whether it is a date
 * (an English sentence puts "on" before one).
 */
export function tellWhen(
  iso: string,
  lead: LeadLike,
  lang: Lang,
  now = Date.now(),
): { text: string; dated: boolean } {
  const w = callWhen(iso, lead.country, lang, lead.phone);
  const zone = zoneFor(lead, lang);
  const t = Date.parse(iso);
  const day = ymd(t, zone);
  const today = day === ymd(now, zone);
  const tomorrow = day === ymd(now + 86_400_000, zone);
  const weekday = w.day.split(" ")[0] ?? "";
  if (lang === "ar") {
    if (today)
      return { text: `اليوم الساعة ${w.time} ${w.zone}`, dated: false };
    if (tomorrow)
      return {
        text: `باجر ${weekday} الساعة ${w.time} ${w.zone}`,
        dated: false,
      };
    return { text: w.text, dated: true };
  }
  if (today) return { text: `today at ${w.time} ${w.zone}`, dated: false };
  if (tomorrow)
    return {
      text: `tomorrow, ${weekday}, at ${w.time} ${w.zone}`,
      dated: false,
    };
  return { text: w.text, dated: true };
}

function hostName(i: TellInput): string {
  if (i.lang === "ar") return i.host?.ar?.trim() || i.host?.en?.trim() || "";
  return i.host?.en?.trim() || "";
}

function repName(i: TellInput): string {
  if (i.lang === "ar")
    return i.rep?.ar?.trim() || i.rep?.en?.trim() || "فريق مهارة ميديا";
  return i.rep?.en?.trim() || "the team";
}

function zoomLine(i: TellInput): string {
  if (!i.zoom) return "";
  return i.lang === "ar" ? `\nلينك الزوم: ${i.zoom}` : `\nZoom link: ${i.zoom}`;
}

/** The built-in message for the moment, as the design's copy table writes it. */
export function builtIn(i: TellInput): string {
  const now = i.now ?? Date.now();
  const first = leadFirst(i.lead);
  const host = hostName(i);
  const zoom = zoomLine(i);
  if (i.lang === "ar") {
    const hi = `هلا${first ? ` ${first}` : ""}،`;
    const noun = AR_NOUN[i.kind];
    const withHost = host ? ` مع ${host}` : "";
    const when = i.start ? tellWhen(i.start, i.lead, "ar", now).text : "";
    switch (i.moment) {
      case "rescheduled":
        return `${hi} غيرنا موعد ${noun}${withHost}. صار ${when}. إذا ما يناسبك الوقت، اكتب لي هني.${zoom}`;
      case "booked":
        return `${hi} حجزت لك ${noun}${withHost} ${when}. أي سؤال قبلها، اكتبه هني.${zoom}`;
      case "confirm":
        return `${hi} نذكرك ب${noun}${withHost} ${when}. إذا تبي تغير الوقت، اكتب لي هني.${zoom}`;
      case "missed_booked":
        return `${hi} معاك ${repName(i)} من مهارة ميديا.\nشكله صار عندك شي وقت المكالمة، فحجزت لك موعد ثاني ${when}.\nإذا حاب نكمل، رد علي هني.${zoom}`;
      case "missed_open":
        return `${hi} شكله صار عندك شي وقت المكالمة. متى يناسبك نحجز موعد ثاني؟`;
      case "pick_time":
        return `${hi} إذا تبي تغير موعد ${noun}، اختار الوقت اللي يناسبك من هني:\n${i.link ?? ""}`;
    }
  }
  const hi = `Hi${first ? ` ${first}` : ""},`;
  const noun = EN_NOUN[i.kind];
  const withHost = host ? ` with ${host}` : "";
  const w = i.start ? tellWhen(i.start, i.lead, "en", now) : null;
  const when = w?.text ?? "";
  const onWhen = w ? `${w.dated ? "on " : ""}${w.text}` : "";
  switch (i.moment) {
    case "rescheduled":
      return `${hi} your ${noun}${withHost} is now ${onWhen}. If that time doesn't suit you, reply here.${zoom}`;
    case "booked":
      return `${hi} your ${noun}${withHost} is booked for ${when}. Any question before then, write it here.${zoom}`;
    case "confirm":
      return `${hi} a reminder of your ${noun}${withHost} ${onWhen}. If you need another time, reply here.${zoom}`;
    case "missed_booked":
      return `${hi} it's ${repName(i)} from Mahara Media. Looks like something came up at call time, so I booked you again for ${when}. If you'd like to go ahead, reply here.${zoom}`;
    case "missed_open":
      return `${hi} looks like something came up at call time. When suits you for another one?`;
    case "pick_time":
      return `${hi} if you'd like another time for your ${noun}, pick the one that suits you here:\n${i.link ?? ""}`;
  }
}

/** The team's own message for the moment and language, first in the library's order. */
export function librarySnippet(
  snippets: Snippet[] | null | undefined,
  moment: TellMoment,
  lang: Lang,
): Snippet | null {
  const m = LIBRARY[moment];
  if (!m) return null;
  return (
    (snippets ?? [])
      .filter(s => s.moment === m && s.language === lang && s.body?.trim())
      .sort((a, b) => a.sort - b.sort)[0] ?? null
  );
}

/**
 * The message: the library's for the moment and language when there is
 * one (its {name}, {rep}, {day} and {time} filled in on the lead's clock,
 * the call's video link added), else the built-in one.
 */
export function tellMessage(i: TellInput): {
  text: string;
  from: "library" | "built_in";
} {
  const s = librarySnippet(i.snippets, i.moment, i.lang);
  if (!s) return { text: builtIn(i), from: "built_in" };
  const now = i.now ?? Date.now();
  const words = i.start
    ? callWords(i.start, i.lang, now, zoomZone(i))
    : { day: null, time: null };
  const text = fillSnippet(s.body, {
    name: leadFirst(i.lead) || null,
    rep: repName(i),
    day: words.day,
    time: words.time,
  });
  const withZoom =
    i.moment === "missed_open" || i.moment === "pick_time"
      ? text
      : `${text}${zoomLine(i)}`;
  return { text: withZoom, from: "library" };
}

function zoomZone(i: TellInput): string {
  return zoneFor(i.lead, i.lang);
}

/** The moment a booked call's Tell them opens on: confirm it, unless it was just booked or moved. */
export function rowMoment(o: {
  status: string | null | undefined;
  movedRecently: boolean;
  bookedRecently: boolean;
  missed?: "booked" | "open" | null;
}): TellMoment {
  if (o.missed === "booked") return "missed_booked";
  if (o.missed === "open") return "missed_open";
  if (o.movedRecently) return "rescheduled";
  if (o.bookedRecently) return "booked";
  return "confirm";
}
