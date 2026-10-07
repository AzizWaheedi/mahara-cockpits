// The rules every send shares (the hooks commit, contract v2 sections 3, 9
// and 11), kept apart from index.ts so they can be tested without the
// Supabase runtime:
// - one clock for the lead's hours, the desk's (UAE and Oman UTC+4);
// - the first-message hours and the day off;
// - the read-back that matches the words, not just any outbound message;
// - the duplicate detector (two identical outbound messages within 60 s);
// - WhatsApp health per source;
// - the month's template budget;
// - the two settings saves that keep every key they do not edit.

import { failedStatus } from "./lib.ts";

type Row = Record<string, unknown>;

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// The lead's clock (followups.py LEAD_ZONES, finding 23: one table, two doors)
// ---------------------------------------------------------------------------

/** Every UAE and Oman place the desk knows, in English and Arabic: UTC+4. Everyone else in the Gulf is UTC+3. */
export const PLUS_FOUR =
  /^\s*(ae|om)\s*$|emirates|\buae\b|u\.a\.e|dubai|abu dhabi|sharjah|ajman|\boman\b|muscat|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|مسقط/i;
const OMAN = /^\s*om\s*$|\boman\b|muscat|مسقط|عمان/i;

/**
 * The lead's time zone by the ISO country code the cockpit stores (about 250
 * leads are outside the Gulf: US, Egypt, Singapore, the UK and more). A
 * country that spans zones lists its first and last, and a first message
 * goes only in hours that are daytime in both. The desk keeps the same
 * table (desk/followups.py LEAD_ZONES); tests/test_stress_time.py compares them.
 */
export const LEAD_ZONES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  kw: ["Asia/Kuwait"], sa: ["Asia/Riyadh"], qa: ["Asia/Qatar"], bh: ["Asia/Bahrain"], ae: ["Asia/Dubai"], om: ["Asia/Muscat"],
  iq: ["Asia/Baghdad"], jo: ["Asia/Amman"], lb: ["Asia/Beirut"], sy: ["Asia/Damascus"], ye: ["Asia/Aden"], ps: ["Asia/Gaza"],
  il: ["Asia/Jerusalem"], ir: ["Asia/Tehran"], tr: ["Europe/Istanbul"], eg: ["Africa/Cairo"], ly: ["Africa/Tripoli"],
  tn: ["Africa/Tunis"], dz: ["Africa/Algiers"], ma: ["Africa/Casablanca"], sd: ["Africa/Khartoum"], et: ["Africa/Addis_Ababa"],
  ke: ["Africa/Nairobi"], ng: ["Africa/Lagos"], za: ["Africa/Johannesburg"], gh: ["Africa/Accra"],
  gb: ["Europe/London"], uk: ["Europe/London"], ie: ["Europe/Dublin"], fr: ["Europe/Paris"], de: ["Europe/Berlin"],
  it: ["Europe/Rome"], es: ["Europe/Madrid"], pt: ["Europe/Lisbon"], nl: ["Europe/Amsterdam"], be: ["Europe/Brussels"],
  ch: ["Europe/Zurich"], at: ["Europe/Vienna"], se: ["Europe/Stockholm"], no: ["Europe/Oslo"], dk: ["Europe/Copenhagen"],
  fi: ["Europe/Helsinki"], pl: ["Europe/Warsaw"], cz: ["Europe/Prague"], gr: ["Europe/Athens"], ro: ["Europe/Bucharest"],
  hu: ["Europe/Budapest"], ua: ["Europe/Kyiv"], cy: ["Asia/Nicosia"], ru: ["Europe/Moscow", "Asia/Vladivostok"],
  pk: ["Asia/Karachi"], in: ["Asia/Kolkata"], bd: ["Asia/Dhaka"], lk: ["Asia/Colombo"], np: ["Asia/Kathmandu"],
  af: ["Asia/Kabul"], cn: ["Asia/Shanghai"], hk: ["Asia/Hong_Kong"], tw: ["Asia/Taipei"], jp: ["Asia/Tokyo"],
  kr: ["Asia/Seoul"], sg: ["Asia/Singapore"], my: ["Asia/Kuala_Lumpur"], th: ["Asia/Bangkok"], vn: ["Asia/Ho_Chi_Minh"],
  ph: ["Asia/Manila"], id: ["Asia/Jakarta", "Asia/Jayapura"], au: ["Australia/Perth", "Australia/Sydney"],
  nz: ["Pacific/Auckland"], us: ["America/New_York", "America/Los_Angeles"], ca: ["America/Halifax", "America/Vancouver"],
  mx: ["America/Mexico_City", "America/Tijuana"], br: ["America/Sao_Paulo", "America/Manaus"], ar: ["America/Argentina/Buenos_Aires"],
  cl: ["America/Santiago"], co: ["America/Bogota"], pe: ["America/Lima"],
});

/**
 * The lead's zones: the ISO code's, the Gulf by name (UAE and Oman UTC+4),
 * Kuwait for no country at all (the cockpit's leads, as before), and null
 * for a code the table does not know: then a first message waits for a person.
 */
export function leadZones(country: unknown): readonly string[] | null {
  const c = String(country ?? "").trim();
  if (!c) return LEAD_ZONES.kw as readonly string[];
  const code = c.toLowerCase();
  if (LEAD_ZONES[code]) return LEAD_ZONES[code] as readonly string[];
  if (PLUS_FOUR.test(c)) return OMAN.test(c) ? (LEAD_ZONES.om as readonly string[]) : (LEAD_ZONES.ae as readonly string[]);
  if (/^[a-z]{2}$/i.test(c)) return null;
  return LEAD_ZONES.kw as readonly string[];
}

/**
 * The Gulf country a phone number dials into (the dialer only rings these:
 * dialer.ts ROUTES), or null. The number the dialer rang names the lead's
 * clock better than a stored country (m1 round 3: 209 leads with a +971
 * phone are stored KW, 89 with a +966 phone are stored US).
 */
const GULF_CODES: readonly [string, string][] = [
  ["965", "KW"],
  ["966", "SA"],
  ["971", "AE"],
  ["968", "OM"],
  ["973", "BH"],
  ["974", "QA"],
];
export function phoneCountry(phone: unknown): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  // International form only (+965..., or 00965...): a bare local number names no country.
  const intl = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : null;
  if (!intl) return null;
  return GULF_CODES.find(([code]) => intl.startsWith(code))?.[1] ?? null;
}

/** The country whose clock a lead keeps: a Gulf number's own, else the stored country (m1 round 3). */
export function clockCountry(country: unknown, phone: unknown): string {
  return phoneCountry(phone) ?? String(country ?? "").trim();
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneClock(zone: string, now: number): { hour: number; day: number } {
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23", weekday: "short" });
    zoneFormats.set(zone, f);
  }
  const parts = f.formatToParts(now);
  return {
    hour: Number(parts.find(p => p.type === "hour")?.value),
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.find(p => p.type === "weekday")?.value)),
  };
}

/** UTC+4 for the UAE and Oman, else UTC+3: the old two-zone rule, kept for the words that name the lead's clock. */
export function leadOffsetHours(country: unknown): 3 | 4 {
  return PLUS_FOUR.test(String(country ?? "")) ? 4 : 3;
}
/** The hour on the lead's clock (their first zone; Kuwait's when the country is unknown). */
export function leadHour(country: unknown, now: number): number {
  return zoneClock((leadZones(country) ?? (LEAD_ZONES.kw as readonly string[]))[0] as string, now).hour;
}
const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** The calendar date (YYYY-MM-DD) and weekday name of `at` on this zone's clock. */
function zoneDate(zone: string, at: number): { date: string; weekday: string } {
  let f = dateFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" });
    dateFormats.set(zone, f);
  }
  const parts = f.formatToParts(at);
  const get = (t: string) => String(parts.find(p => p.type === t)?.value ?? "");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

/**
 * The call's day as a message may name it on the lead's clock (their first
 * zone; Kuwait's when unknown): "today", "tomorrow", or the weekday's name.
 * The desk's call_words (followups.py) writes the same words.
 */
export function relativeDay(start: number, now: number, country: unknown): string {
  const zone = (leadZones(country) ?? (LEAD_ZONES.kw as readonly string[]))[0] as string;
  const call = zoneDate(zone, start);
  if (call.date === zoneDate(zone, now).date) return "today";
  if (call.date === zoneDate(zone, now + 86_400_000).date) return "tomorrow";
  return call.weekday;
}

/** 0 Sunday to 6 Saturday, on the lead's clock. */
export function leadWeekday(country: unknown, now: number): number {
  return zoneClock((leadZones(country) ?? (LEAD_ZONES.kw as readonly string[]))[0] as string, now).day;
}

export const HOURS_COPY = {
  first: "A first message goes between {from} and {to}, their time.",
  night: "It is night where the lead is. Send it after 9 in the morning, their time.",
  friday: "It is Friday where the lead is, their day off. It goes on Saturday.",
  /** Friday off and Saturday a quiet day too (stress2 round 3): the next day the agent sends is named. */
  friday_next: "It is Friday where the lead is, their day off. It goes on {next}.",
  day_off: "It is {day} where the lead is, a day the agent does not send. It goes on their next working day.",
  zone_unknown: "The cockpit does not know the lead's time zone ({country}), so a person sends this first message.",
} as const;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** followups.quiet_days: the days on the lead's clock the agent does not send (Friday when not set). */
/**
 * The zones whose weekend includes Friday or keeps Friday off (the Gulf, most
 * of the Arab world, Iran, Afghanistan, Bangladesh): followups.quiet_days is read
 * there as written. The desk keeps the same list (followups.py
 * FRIDAY_WEEKEND_ZONES). Not the UAE (Asia/Dubai): its weekend has been
 * Saturday and Sunday since 1 January 2022, Friday a working day (stress2
 * round 3, uae-weekend-read-as-friday).
 */
export const FRIDAY_WEEKEND_ZONES: ReadonlySet<string> = new Set([
  "Asia/Kuwait", "Asia/Riyadh", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Baghdad", "Asia/Amman",
  "Asia/Damascus", "Asia/Aden", "Asia/Gaza", "Asia/Jerusalem", "Asia/Tehran", "Asia/Kabul", "Asia/Dhaka",
  "Africa/Cairo", "Africa/Tripoli", "Africa/Algiers", "Africa/Khartoum",
]);

/**
 * The lead's days off in one zone (fix round 4): quiet_days as written where
 * the weekend includes Friday; elsewhere (a lead in the United States, in
 * Europe) Friday is a working day, and their own Saturday and Sunday are off.
 */
export function zoneDaysOff(zone: string, off: Set<number>): Set<number> {
  if (FRIDAY_WEEKEND_ZONES.has(zone) || !off.has(5)) return off;
  const out = new Set([...off].filter(d => d !== 5));
  out.add(6);
  out.add(0);
  return out;
}

/**
 * The follow-up agent's switch (followups.enabled), read as the desk reads it
 * (followups.run and waves.run: `not settings.get("enabled", True)`): a value
 * set to anything but on (false, null, 0, an empty word) is off; no value at
 * all is on. One reading on every door (fix round 4).
 */
export function agentOff(followups: unknown): boolean {
  const f = (followups && typeof followups === "object" ? followups : {}) as Row;
  return Object.prototype.hasOwnProperty.call(f, "enabled") && !f.enabled;
}

/**
 * The follow-up agent's own sends (Milestone 1 fence, 20261004a): backlog
 * waves, the approved batch, the desk's paced send (followup.send_due),
 * levels that send by themselves, autosend and confirmation drafts. Off
 * unless followups.agent is true (missing is off), and always off while
 * followups.enabled is off. The drafts reps approve one by one keep
 * followups.enabled alone (agentOff).
 */
export function agentWorkOff(followups: unknown): boolean {
  const f = (followups && typeof followups === "object" ? followups : {}) as Row;
  return agentOff(f) || f.agent !== true;
}

export function quietDays(followups: unknown): Set<number> {
  const v = (followups as Row | null)?.quiet_days;
  const list = Array.isArray(v) ? v.map(d => String(d).toLowerCase()) : ["friday"];
  return new Set(list.map(d => DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number])).filter(d => d >= 0));
}

function clock(h: number): string {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return String(h > 12 ? h - 12 : h);
}

/** followups.first_hours as [from, to): two whole hours 0 to 24 in order, else [9, 18]. */
export function firstHours(followups: unknown): [number, number] {
  const v = (followups as Row | null)?.first_hours;
  if (Array.isArray(v) && v.length === 2) {
    const [a, b] = v.map(Number);
    if (Number.isInteger(a) && Number.isInteger(b) && (a as number) >= 0 && (b as number) <= 24 && (a as number) < (b as number))
      return [a as number, b as number];
  }
  return [9, 18];
}

/** The demo chat's holdout salt (C36): the waves' salt may never be this one. */
export const THREADS_SALT = "threads";

/** followups.quiet as the hours a later message may go: from quiet.to (9) until quiet.from (21). */
export function laterHours(followups: unknown): [number, number] {
  const q = ((followups as Row | null)?.quiet ?? {}) as Row;
  const quietFrom = Number(q.from ?? 21);
  const quietTo = Number(q.to ?? 9);
  if (!Number.isInteger(quietFrom) || !Number.isInteger(quietTo) || quietFrom < 0 || quietFrom > 24 || quietTo < 0 || quietTo > 24)
    return [9, 21];
  // Quiet across midnight (21 to 9): later messages go from its end to its start.
  if (quietTo < quietFrom) return [quietTo, quietFrom];
  // Quiet that starts at midnight or sits inside one day (0 to 9, the desk's
  // quiet() reads it so): later messages go from its end until midnight.
  return quietTo < 24 ? [quietTo, 24] : [9, 21];
}

/**
 * Why a follow-up may not go now, on the lead's clock, or null. An answer to
 * a lead who just wrote goes any time; a first message (touch 1, not a reply
 * or a confirmation) only within first_hours; anything else within 9 to 21.
 * A lead in a country that spans zones gets it only in hours that hold in
 * every one of them. `dayOff` adds followups.quiet_days (Friday as shipped;
 * the desk's own sends: followup.send_due), on the lead's own calendar.
 */
export function hoursRefusal(o: {
  segment: unknown;
  touch: unknown;
  country: unknown;
  now: number;
  followups: unknown;
  dayOff?: boolean;
}): string | null {
  if (o.segment === "reply") return null;
  const known = leadZones(o.country);
  const first = o.segment !== "confirm" && Number(o.touch ?? 1) <= 1;
  // A first message to a lead whose zone is not known waits for a person; a
  // later one keeps to Kuwait's clock, as before.
  if (!known && first) return HOURS_COPY.zone_unknown.replace("{country}", String(o.country ?? "").trim().toUpperCase());
  const zones = known ?? (LEAD_ZONES.kw as readonly string[]);
  const clocks = zones.map(z => zoneClock(z, o.now));
  if (o.dayOff) {
    const off = quietDays(o.followups);
    const at = clocks.findIndex((c, i) => zoneDaysOff(zones[i] as string, off).has(c.day));
    const day = at < 0 ? undefined : clocks[at]?.day;
    if (day !== undefined) {
      if (day !== 5) return HOURS_COPY.day_off.replace("{day}", (DAY_NAMES[day] as string).replace(/^./, ch => ch.toUpperCase()));
      // The next day the agent sends on that lead's calendar: never a promise of a day that is off too.
      const mine = zoneDaysOff(zones[at] as string, off);
      let next = 6;
      while (mine.has(next % 7) && next < 12) next++;
      return next % 7 === 6 ? HOURS_COPY.friday : HOURS_COPY.friday_next.replace("{next}", (DAY_NAMES[next % 7] as string).replace(/^./, ch => ch.toUpperCase()));
    }
  }
  if (first) {
    const [from, to] = firstHours(o.followups);
    if (clocks.some(c => c.hour < from || c.hour >= to))
      return HOURS_COPY.first.replace("{from}", clock(from)).replace("{to}", clock(to));
    return null;
  }
  const [from, to] = laterHours(o.followups);
  return clocks.some(c => c.hour < from || c.hour >= to) ? HOURS_COPY.night : null;
}

// ---------------------------------------------------------------------------
// The read-back and the duplicate detector (C28, C29)
// ---------------------------------------------------------------------------

/** Words as compared: no case, no marks, one space. */
export function normText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The same message: equal once normalised, or one starts with the other's
 * first 60 characters (HighLevel can add a template's button or footer).
 */
export function sameText(a: unknown, b: unknown): boolean {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(60, x.length, y.length);
  return n >= 20 && (x.startsWith(y.slice(0, n)) || y.startsWith(x.slice(0, n)));
}

/**
 * An email in the conversation carries these words: HighLevel keeps the
 * email's HTML as its body, so the tags and entities are taken out and the
 * words compared as sameText does, or found inside the email (a signature
 * or a footer around them).
 */
export function sameEmailText(body: unknown, text: unknown): boolean {
  const plain = plainEmail(body);
  if (sameText(plain, text)) return true;
  const x = normText(plain);
  const y = normText(text);
  const n = Math.min(60, y.length);
  return n >= 20 && x.includes(y.slice(0, n));
}

/** An email body as words: HighLevel keeps its HTML, so the tags and entities are taken out. */
function plainEmail(body: unknown): string {
  return String(body ?? "")
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** The links in a message's words (a room's join link or short link), each as written. */
export function linksIn(text: unknown): string[] {
  return [...String(text ?? "").matchAll(/https?:\/\/[^\s<>"']+/gi)].map(m => m[0].replace(/[.,;:!?)\]]+$/, "")).filter(Boolean);
}

/**
 * A message carries every link in the words that were sent (m1 round 5,
 * lost-send-matched-to-previous-room-link): two rooms' links to one lead
 * share all their words but the link, so words alike are never this send
 * unless its own link is in it.
 */
export function carriesLinks(body: unknown, links: string[], channel: "whatsapp" | "email"): boolean {
  if (!links.length) return true;
  const words = channel === "email" ? plainEmail(body) : String(body ?? "");
  return links.every(l => words.includes(l));
}

export interface SeenMessage {
  id?: string | null;
  direction?: unknown;
  channel?: unknown;
  body?: unknown;
  at?: unknown;
  status?: unknown;
}

/**
 * The outbound WhatsApp message a send became: after `since` (less 15 s of
 * clock drift), and with the words that were sent when they are known, so a
 * WA Connector copy or another rep's message never counts as this one.
 * `went`: only a message that reached the lead counts (never one Meta
 * failed or left undelivered): the question "did this send go?" after its
 * answer was lost. The read-back right after a send leaves it off, so it
 * sees a Meta failure and records it.
 */
export function matchSent<T extends SeenMessage>(
  list: T[],
  since: number,
  text?: string | null,
  o: { went?: boolean; channel?: "whatsapp" | "email" } = {},
): T | null {
  const channel = o.channel ?? "whatsapp";
  const links = text ? linksIn(text) : [];
  for (const m of list) {
    const t = Date.parse(String(m.at ?? ""));
    if (m.direction !== "outbound" || m.channel !== channel || !Number.isFinite(t) || t < since - 15_000) continue;
    if (text && !(channel === "email" ? sameEmailText(m.body, text) : sameText(m.body, text))) continue;
    if (!carriesLinks(m.body, links, channel)) continue;
    if (o.went && failedStatus(m.status)) continue;
    return m;
  }
  return null;
}

/**
 * Two identical outbound WhatsApp messages to one lead within `windowS`
 * seconds: the pair, or null. `skip` leaves out a pair that is no copy (two
 * of the cockpit's own sends, each with its own request id: stress2, round 1).
 */
export function duplicatePair<T extends SeenMessage>(list: T[], windowS = 60, skip?: (a: T, b: T) => boolean): [T, T] | null {
  const out = list
    .filter(m => m.direction === "outbound" && m.channel === "whatsapp" && normText(m.body) && Number.isFinite(Date.parse(String(m.at ?? ""))))
    .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i] as T;
      const b = out[j] as T;
      if (Date.parse(String(b.at)) - Date.parse(String(a.at)) > windowS * 1000) break;
      if (a.id && a.id === b.id) continue;
      if (normText(a.body) === normText(b.body) && !skip?.(a, b)) return [a, b];
    }
  return null;
}

/**
 * Whether the duplicate detector watches the sends that just went (C28). It
 * proves the WA Connector is really off, so it watches only once a manager
 * has said so (whatsapp_guard.connector_off), and not while a pause already
 * stands. Before that every send is known to be copied, and a watch would
 * pause WhatsApp for every rep on the first one.
 */
export function duplicateWatchOn(guard: unknown): boolean {
  const g = (guard ?? {}) as Row;
  return g.connector_off === true && !g.dup_paused_at;
}

export const DUPLICATE_PAUSED =
  "WhatsApp sends are paused: two identical messages went to one lead within {seconds} seconds, so the WA Connector may still be on. A manager clears the pause under Follow-ups, How it works, once only one copy goes.";

// ---------------------------------------------------------------------------
// WhatsApp health per source (C27) and the gate
// ---------------------------------------------------------------------------

export type SendSource = "rep" | "followup" | "room" | "thread";

export function healthCfg(guard: unknown, source: SendSource): { window: number; fail_share: number; min_sends: number } {
  const g = (guard ?? {}) as Row;
  const per = (((g.health ?? {}) as Row)[source] ?? {}) as Row;
  const n = (v: unknown, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? x : d;
  };
  return {
    window: Math.round(n(per.window, 20, 1, 1000)),
    fail_share: n(per.fail_share, 0.3, 0.01, 1),
    min_sends: Math.round(n(per.min_sends ?? g.pause_min_sends, 5, 1, 1000)),
  };
}

/** A source's last `window` WhatsApp sends, newest first: paused when the failed share reaches fail_share. */
export function sourceHealth(
  rows: { state?: unknown; error?: unknown }[],
  cfg: { window: number; fail_share: number; min_sends: number },
  source: SendSource,
): { paused: boolean; why: string; sent: number; failed: number } {
  const last = rows.slice(0, cfg.window);
  const failed = last.filter(r => r.state === "failed");
  const paused = last.length >= cfg.min_sends && failed.length / last.length >= cfg.fail_share;
  const reason = failed.map(r => String(r.error ?? "")).find(Boolean) ?? "no reason given";
  return {
    paused,
    sent: last.length,
    failed: failed.length,
    why: paused
      ? `Automatic WhatsApp sends for ${source === "followup" ? "follow-ups" : `${source} messages`} are paused: ${failed.length} of the last ${last.length} failed (${reason.slice(0, 160)}). A person sends until that clears.`
      : "",
  };
}

/**
 * The WhatsApp gate (glossary 1.4): open only once the WA Connector is off
 * and the single-copy test has passed since it went off (connector_off_at):
 * a test from before the connector came back on proves nothing.
 */
export function gateOpen(guard: unknown): boolean {
  const g = (guard ?? {}) as Row;
  if (g.connector_off !== true || typeof g.single_copy_ok_at !== "string") return false;
  const ok = Date.parse(g.single_copy_ok_at);
  if (!Number.isFinite(ok)) return false;
  const off = typeof g.connector_off_at === "string" ? Date.parse(g.connector_off_at) : Number.NaN;
  return !Number.isFinite(off) || ok >= off;
}
export const GATE_SHUT = "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes.";

// ---------------------------------------------------------------------------
// The month's template budget (D18, finding 27)
// ---------------------------------------------------------------------------

/** Kuwait's first of the month that holds `now`, as an instant. */
export function kuwaitMonthStart(now: number): string {
  const k = new Date(now + 3 * HOUR);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 3 * HOUR).toISOString();
}

export function budgetOf(guard: unknown): { budget: number; rate: number } {
  const g = (guard ?? {}) as Row;
  const b = Number(g.template_budget_usd_month);
  const r = Number(g.template_rate_usd);
  return { budget: Number.isFinite(b) && b >= 0 ? b : 100, rate: Number.isFinite(r) && r > 0 && r <= 1 ? r : 0.0792 };
}

/** The most templates a month the budget pays for: the desk's floor(budget / rate) (desk/waves.py template_budget). */
export function budgetCap(guard: unknown): number {
  const { budget, rate } = budgetOf(guard);
  return Math.floor(budget / rate + 1e-9);
}

/**
 * This month's spend estimate, and the refusal when the next template would
 * take it past the budget (a ceiling: the month never ends above it). The
 * desk stops at the same template (budgetCap).
 */
export function budgetCheck(sentThisMonth: number, guard: unknown): { spend: number; budget: number; refusal: string | null } {
  const { budget, rate } = budgetOf(guard);
  const spend = Math.round(sentThisMonth * rate * 100) / 100;
  return {
    spend,
    budget,
    refusal:
      sentThisMonth >= budgetCap(guard)
        ? `This month's WhatsApp template budget of $${budget} is spent: about $${spend.toFixed(2)} so far (estimate). A manager raises it under Follow-ups, How it works, after checking the wallet.`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Settings saves that keep every key (lc-db and lc-desk finding 17)
// ---------------------------------------------------------------------------

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function whole(x: unknown, lo: number, hi: number, name: string): number | string {
  const n = Number(x);
  if (!Number.isInteger(n) || n < lo || n > hi) return `${name} has to be a whole number from ${lo} to ${hi}.`;
  return n;
}

/**
 * The `followups` setting as a manager's save leaves it. Only what was sent
 * changes; every other key, including those this screen does not know
 * (waves, first_hours, stop_pause_days, graduation, reply_alerts,
 * untagged_every_days), keeps its value. The new keys are checked with the
 * desk's bounds. Openers go only by batch, so autosend.reactivate is false.
 */
export function followupSettingsValue(before: Row, v: Row, segments: readonly string[]): Check<Row> {
  const given = (k: string) => (v[k] !== undefined ? v[k] : before[k]);
  const map = (k: string) => ({ ...((before[k] ?? {}) as Row), ...((v[k] ?? {}) as Row) });
  const errs: string[] = [];
  const int = (x: unknown, lo: number, hi: number, name: string) => {
    const r = whole(x, lo, hi, name);
    if (typeof r === "string") {
      errs.push(r);
      return lo;
    }
    return r;
  };
  const quiet = (given("quiet") ?? {}) as Row;
  const quietFrom = int(quiet.from ?? 21, 0, 23, "The quiet hours' start");
  const quietTo = int(quiet.to ?? 9, 0, 23, "The quiet hours' end");
  const auto = map("autosend");
  const takeover = map("takeover");
  const fallback = map("email_fallback");
  const replaces = (before.replaces ?? {}) as Row;
  const days = given("quiet_days");
  const value: Row = {
    ...before,
    enabled: given("enabled") !== false,
    // The agent's own sends (Milestone 1 fence): on only when a manager sends true.
    agent: given("agent") === true,
    autosend: Object.fromEntries(segments.map(s => [s, s !== "reactivate" && auto[s] === true])),
    takeover: Object.fromEntries(Object.keys(replaces).map(s => [s, takeover[s] === true])),
    replaces,
    email_fallback: Object.fromEntries(segments.map(s => [s, fallback[s] !== false])),
    cadence: before.cadence ?? {},
    automation_gap_hours: int(given("automation_gap_hours") ?? 20, 0, 72, "Hours to wait after an automation's message"),
    quiet_days: (Array.isArray(days) ? days : ["friday"])
      .map(d => String(d).toLowerCase())
      .filter(d => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(d)),
    per_run: int(given("per_run") ?? 12, 1, 50, "Drafts per run"),
    per_day: int(given("per_day") ?? 60, 1, 400, "Drafts per day"),
    quiet: { from: quietFrom, to: quietTo },
    nurture_every_days: int(given("nurture_every_days") ?? 7, 2, 60, "Days between nurture messages"),
    nurture_per_day: int(given("nurture_per_day") ?? 20, 0, 200, "Long-term messages a day"),
  };
  if (given("waves") !== undefined) {
    const w = { ...((before.waves ?? {}) as Row), ...((v.waves ?? {}) as Row) };
    const share = Number(w.holdout_share ?? 0.1);
    if (!Number.isFinite(share) || share < 0 || share > 0.5) errs.push("The holdout share is between 0 and 0.5.");
    value.waves = {
      ...w,
      per_day: int(w.per_day ?? 40, 0, 200, "Openers a day"),
      holdout_share: share,
      batch_gap_s: int(w.batch_gap_s ?? 45, 30, 3600, "Seconds between openers"),
      salt: typeof w.salt === "string" && w.salt.trim() ? w.salt.trim().slice(0, 40) : "waves",
    };
    // C36: the demo chat's holdout is drawn with the salt "threads"; the same
    // salt here would hold back the same leads in both experiments.
    if (String((value.waves as Row).salt).toLowerCase() === THREADS_SALT)
      errs.push("The waves' holdout salt must differ from the demo chat's (threads), so the two experiments hold back different leads.");
  }
  if (given("first_hours") !== undefined) {
    const f = given("first_hours");
    const ok = Array.isArray(f) && f.length === 2 && f.every(n => Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 24);
    if (!ok || Number((f as unknown[])[0]) >= Number((f as unknown[])[1]))
      errs.push("First-message hours are two whole hours from 0 to 24, the first before the second.");
    else value.first_hours = (f as unknown[]).map(Number);
  }
  if (given("stop_pause_days") !== undefined)
    value.stop_pause_days = int(given("stop_pause_days"), 1, 90, "Days a stop word pauses the agent");
  return errs.length ? { ok: false, error: errs[0] as string } : { ok: true, value };
}

/**
 * The `whatsapp_guard` setting as a manager's save leaves it, keeping every
 * key it does not edit (one save used to drop connector_off and
 * single_copy_ok_at and shut the gate). Only a manager sets connector_off
 * and single_copy_ok_at; the duplicate detector's pause is cleared here.
 */
export function whatsappGuardValue(before: Row, v: Row, now: number): Check<Row> {
  const given = (k: string) => (v[k] !== undefined ? v[k] : before[k]);
  const perDay = Number(given("templates_per_day") ?? 250);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 5000)
    return { ok: false, error: "Templates a day is a whole number from 1 to 5,000." };
  const share = Number(given("pause_fail_share") ?? 0.3);
  if (!Number.isFinite(share) || share <= 0 || share > 1) return { ok: false, error: "The pause share is between 0 and 1." };
  const value: Row = {
    ...before,
    templates_per_day: perDay,
    pause_fail_share: share,
    pause_min_sends: Math.max(1, Math.round(Number(given("pause_min_sends") ?? 5))),
  };
  if (v.connector_off !== undefined) {
    if (typeof v.connector_off !== "boolean") return { ok: false, error: "Say whether the WA Connector is off (yes or no)." };
    // The connector on again makes every earlier single-copy test void; off
    // again needs a new one (the time it went off is kept to compare).
    if (v.connector_off && before.connector_off !== true) {
      value.connector_off_at = new Date(now).toISOString();
      if (v.single_copy_ok_at === undefined) value.single_copy_ok_at = null;
    }
    if (!v.connector_off) {
      value.connector_off_at = null;
      value.single_copy_ok_at = null;
    }
    value.connector_off = v.connector_off;
  }
  if (v.single_copy_ok_at !== undefined) {
    const s = v.single_copy_ok_at;
    if (s === null) value.single_copy_ok_at = null;
    else if (s === true) value.single_copy_ok_at = new Date(now).toISOString();
    else if (typeof s === "string" && Number.isFinite(Date.parse(s)) && Date.parse(s) <= now + 60_000)
      value.single_copy_ok_at = new Date(Date.parse(s)).toISOString();
    else return { ok: false, error: "The single-copy test's time is not a time that has passed." };
  }
  if (v.dup_window_s !== undefined) {
    const n = whole(v.dup_window_s, 10, 600, "The duplicate window");
    if (typeof n === "string") return { ok: false, error: n };
    value.dup_window_s = n;
  }
  if (v.template_budget_usd_month !== undefined) {
    const n = Number(v.template_budget_usd_month);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) return { ok: false, error: "The month's template budget is a dollar amount of 0 or more." };
    value.template_budget_usd_month = Math.round(n * 100) / 100;
  }
  if (v.template_rate_usd !== undefined) {
    const n = Number(v.template_rate_usd);
    if (!Number.isFinite(n) || n <= 0 || n > 1) return { ok: false, error: "The rate per template is a dollar amount above 0 and at most 1." };
    value.template_rate_usd = n;
  }
  // The duplicate detector's pause is only ever cleared by a person.
  if (v.dup_paused_at === null) {
    value.dup_paused_at = null;
    value.dup_reason = null;
  }
  // "Clear the pause" on a source's own failure share (follow-ups, rooms):
  // sends from before now no longer count (whatsappHealth reads from here).
  if (v.health_cleared_at !== undefined) {
    if (v.health_cleared_at === true) value.health_cleared_at = new Date(now).toISOString();
    else if (v.health_cleared_at === null) value.health_cleared_at = null;
    else return { ok: false, error: "Clear the pause with a press, not a time." };
  }
  return { ok: true, value };
}

/** The first moment a source's WhatsApp health counts sends from: the last day, or a manager's later "Clear the pause". */
export function healthSince(guard: unknown, now: number): number {
  const cleared = Date.parse(String(((guard ?? {}) as Row).health_cleared_at ?? ""));
  return Math.max(now - 86_400_000, Number.isFinite(cleared) ? cleared : 0);
}

/** How long a template's own send may still be running (rooms.ts SEND_BUDGET_MS): a "sending" row older than this was orphaned. */
export const TEMPLATE_SEND_BUDGET_MS = 90_000;
/** How long an earlier template to a lead may still sit in HighLevel's workflow queue. */
export const TEMPLATE_WAIT_MS = 6 * 3_600_000;

/**
 * The filter for the workflow templates to one lead that may still be in
 * HighLevel's delayed workflow queue (stress2, round 2): taken and not seen
 * (sent / enrolled), an enrolment whose answer was lost (unclear), or a send
 * orphaned between its row and HighLevel's answer (sending, older than the
 * send's own budget). Read with templateMayBeQueued over the rows it gives.
 */
export function queuedTemplatesQuery(contactId: string, now: number): string {
  return `cockpit_sales_messages?contact_id=eq.${encodeURIComponent(contactId)}&via=eq.workflow&state=in.(sent,unclear,sending)&created_at=gte.${encodeURIComponent(new Date(now - TEMPLATE_WAIT_MS).toISOString())}&select=*&order=created_at.desc&limit=20`;
}

/** Whether any of these message rows is a template that may still be in HighLevel's queue (queuedTemplatesQuery). */
export function templateMayBeQueued(rows: Row[], now: number): boolean {
  return rows.some(r => {
    const state = String(r.state ?? "");
    if (state === "sent") return String(r.provider_status ?? "") === "enrolled";
    if (state === "unclear") return true;
    if (state === "sending") {
      // A row HighLevel was never asked about (no ghl_asked_at, 20261004a):
      // its slot's answer was lost and nothing was enrolled, so it holds no
      // template back (stress2 round 5).
      if (Object.hasOwn(r, "ghl_asked_at") && !r.ghl_asked_at) return false;
      const at = Date.parse(String(r.created_at ?? ""));
      return !Number.isFinite(at) || now - at >= TEMPLATE_SEND_BUDGET_MS;
    }
    return false;
  });
}
