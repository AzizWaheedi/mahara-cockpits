/**
 * The lead's own clocks, by the country the cockpit stores (an ISO code, or
 * a Gulf place by name). The same table and rules as sales-api's
 * sendrules.ts LEAD_ZONES and leadZones, and the desk's followups.py
 * LEAD_ZONES: a message names the call's time on the lead's clock, and a
 * video link is never offered at night where the lead is (stress2 round 6,
 * confirm-prefill-time-on-kuwait-clock, night-video-link-auto-countdown-and-picker-loop).
 */

/** Every UAE and Oman place, in English and Arabic: UTC+4. */
const PLUS_FOUR =
  /^\s*(ae|om)\s*$|emirates|\buae\b|u\.a\.e|dubai|abu dhabi|sharjah|ajman|\boman\b|muscat|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|مسقط/i;
const OMAN = /^\s*om\s*$|\boman\b|muscat|مسقط|عمان/i;

export const LEAD_ZONES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    kw: ["Asia/Kuwait"],
    sa: ["Asia/Riyadh"],
    qa: ["Asia/Qatar"],
    bh: ["Asia/Bahrain"],
    ae: ["Asia/Dubai"],
    om: ["Asia/Muscat"],
    iq: ["Asia/Baghdad"],
    jo: ["Asia/Amman"],
    lb: ["Asia/Beirut"],
    sy: ["Asia/Damascus"],
    ye: ["Asia/Aden"],
    ps: ["Asia/Gaza"],
    il: ["Asia/Jerusalem"],
    ir: ["Asia/Tehran"],
    tr: ["Europe/Istanbul"],
    eg: ["Africa/Cairo"],
    ly: ["Africa/Tripoli"],
    tn: ["Africa/Tunis"],
    dz: ["Africa/Algiers"],
    ma: ["Africa/Casablanca"],
    sd: ["Africa/Khartoum"],
    et: ["Africa/Addis_Ababa"],
    ke: ["Africa/Nairobi"],
    ng: ["Africa/Lagos"],
    za: ["Africa/Johannesburg"],
    gh: ["Africa/Accra"],
    gb: ["Europe/London"],
    uk: ["Europe/London"],
    ie: ["Europe/Dublin"],
    fr: ["Europe/Paris"],
    de: ["Europe/Berlin"],
    it: ["Europe/Rome"],
    es: ["Europe/Madrid"],
    pt: ["Europe/Lisbon"],
    nl: ["Europe/Amsterdam"],
    be: ["Europe/Brussels"],
    ch: ["Europe/Zurich"],
    at: ["Europe/Vienna"],
    se: ["Europe/Stockholm"],
    no: ["Europe/Oslo"],
    dk: ["Europe/Copenhagen"],
    fi: ["Europe/Helsinki"],
    pl: ["Europe/Warsaw"],
    cz: ["Europe/Prague"],
    gr: ["Europe/Athens"],
    ro: ["Europe/Bucharest"],
    hu: ["Europe/Budapest"],
    ua: ["Europe/Kyiv"],
    cy: ["Asia/Nicosia"],
    ru: ["Europe/Moscow", "Asia/Vladivostok"],
    pk: ["Asia/Karachi"],
    in: ["Asia/Kolkata"],
    bd: ["Asia/Dhaka"],
    lk: ["Asia/Colombo"],
    np: ["Asia/Kathmandu"],
    af: ["Asia/Kabul"],
    cn: ["Asia/Shanghai"],
    hk: ["Asia/Hong_Kong"],
    tw: ["Asia/Taipei"],
    jp: ["Asia/Tokyo"],
    kr: ["Asia/Seoul"],
    sg: ["Asia/Singapore"],
    my: ["Asia/Kuala_Lumpur"],
    th: ["Asia/Bangkok"],
    vn: ["Asia/Ho_Chi_Minh"],
    ph: ["Asia/Manila"],
    id: ["Asia/Jakarta", "Asia/Jayapura"],
    au: ["Australia/Perth", "Australia/Sydney"],
    nz: ["Pacific/Auckland"],
    us: ["America/New_York", "America/Los_Angeles"],
    ca: ["America/Halifax", "America/Vancouver"],
    mx: ["America/Mexico_City", "America/Tijuana"],
    br: ["America/Sao_Paulo", "America/Manaus"],
    ar: ["America/Argentina/Buenos_Aires"],
    cl: ["America/Santiago"],
    co: ["America/Bogota"],
    pe: ["America/Lima"],
  });

/**
 * The lead's zones: the ISO code's, the Gulf by name (UAE and Oman UTC+4),
 * Kuwait for no country at all, and null for a code the table does not know.
 */
export function leadZones(country: unknown): readonly string[] | null {
  const c = String(country ?? "").trim();
  if (!c) return LEAD_ZONES.kw as readonly string[];
  const code = c.toLowerCase();
  if (LEAD_ZONES[code]) return LEAD_ZONES[code] as readonly string[];
  if (PLUS_FOUR.test(c))
    return OMAN.test(c)
      ? (LEAD_ZONES.om as readonly string[])
      : (LEAD_ZONES.ae as readonly string[]);
  if (/^[a-z]{2}$/i.test(c)) return null;
  return LEAD_ZONES.kw as readonly string[];
}

/**
 * The Gulf country a phone number dials into (the dialer only rings these),
 * or null; sales-api sendrules.ts phoneCountry. The number names the lead's
 * clock better than a stored country (m1 round 3: +971 leads stored KW,
 * +966 leads stored US).
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
  const digits = String(phone ?? "")
    .trim()
    .replace(/[^\d+]/g, "");
  const intl = digits.startsWith("+")
    ? digits.slice(1)
    : digits.startsWith("00")
      ? digits.slice(2)
      : null;
  if (!intl) return null;
  return GULF_CODES.find(([code]) => intl.startsWith(code))?.[1] ?? null;
}

/** The country whose clock a lead keeps: a Gulf number's own, else the stored country (sendrules.ts clockCountry). */
export function clockCountry(country: unknown, phone: unknown): string {
  return phoneCountry(phone) ?? String(country ?? "").trim();
}

/** The lead's first clock (the one a message names), or null when it is not known. */
export function leadClock(country: unknown): string | null {
  return leadZones(country)?.[0] ?? null;
}

const hourFormats = new Map<string, Intl.DateTimeFormat>();
/** The hour (0 to 23) on this zone's clock at `at`. */
export function zoneHour(zone: string, at: number): number {
  let f = hourFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      hourCycle: "h23",
    });
    hourFormats.set(zone, f);
  }
  return Number(f.formatToParts(at).find(p => p.type === "hour")?.value);
}

/**
 * Night where the lead is: outside 09:00 to 21:00 on any of their clocks
 * (sales-api's rule for a video link, rooms.ts leadAtNight), a Gulf
 * number's own clock first; a country the table does not know keeps to
 * Kuwait's clock.
 */
export function nightForLead(
  country: unknown,
  at: number,
  phone?: unknown,
): boolean {
  const zones =
    leadZones(clockCountry(country, phone)) ??
    (LEAD_ZONES.kw as readonly string[]);
  return zones.some(z => {
    const h = zoneHour(z, at);
    return !(h >= 9 && h < 21);
  });
}
