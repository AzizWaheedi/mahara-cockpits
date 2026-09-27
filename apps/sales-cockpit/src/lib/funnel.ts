/**
 * The prospect's funnel, worked out while the call is on. What they said
 * (ad spend, inquiries, meetings booked and held, projects signed, the
 * average project) sits beside the numbers Mahara holds every client's
 * funnel to, and the math finds the one step that leaks the most and what
 * fixing only that step is worth: Temple Naylor's "one thing" frame, which
 * is how the demo's Quantify The Gap stage is told.
 *
 * Nothing is guessed. A number the prospect has not given stays missing,
 * never zero; where a step is worked out with our rate because they gave no
 * number for it, the result says so; numbers that cannot all be true (more
 * meetings than inquiries) are flagged and left out of the gap.
 */

export type Lang = "en" | "ar";
export type Currency = "USD" | "KWD" | "SAR" | "AED" | "QAR" | "BHD" | "OMR";

export const CURRENCIES: Currency[] = [
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
  "USD",
];

/**
 * Units of each currency to one US dollar: the Gulf pegs, and the dinar's
 * basket rate on 2026-09-27 (open.er-api.com: 0.3085).
 */
export const PER_USD: Record<Currency, number> = {
  USD: 1,
  KWD: 0.3085,
  SAR: 3.75,
  AED: 3.6725,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.3845,
};

const BY_COUNTRY: Record<string, Currency> = {
  KW: "KWD",
  SA: "SAR",
  AE: "AED",
  QA: "QAR",
  BH: "BHD",
  OM: "OMR",
};

/** The currency a lead most likely talks in, from their country code. */
export function currencyFor(country: string | null | undefined): Currency {
  return BY_COUNTRY[String(country ?? "").toUpperCase()] ?? "USD";
}

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as string[]).includes(v);
}

/**
 * The numbers Mahara holds every client's funnel to, the KPI gates in the
 * portal (src/lib/kpi.ts and convex/constants.ts): $15 a lead and $60 a
 * booking (Aziz, 2026-09-16), a quarter of inquiries booked, 60% of booked
 * meetings held (Aziz, 2026-09-21: "60% show rate is our thing for
 * clients"), a fifth of held meetings signed. The program is the demo
 * script's $6,000 for 90 days.
 */
export const OURS = {
  perLeadUsd: 15,
  perBookingUsd: 60,
  booking: 0.25,
  show: 0.6,
  close: 0.2,
  programUsd: 6000,
} as const;

// ---------------------------------------------------------------- reading

const EASTERN: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

const THOUSAND = /^(k|thousand|thousands|ألف|الف|آلاف|الاف|ألاف)$/;
const MILLION = /^(m|mn|mil|million|millions|مليون|ملايين|مليونين)$/;
const RANGE = /^\s*(-|–|—|~|to|or|and|الى|إلى|لـ|ل|او|أو|ولا|و)\s*$/;
// Said instead of typing 0: "none", "nothing", "ماكو".
const ZERO = /^(none|zero|nothing|nil|ماكو|مافي|ما في|صفر|ولا شي)$/;
const TOKEN =
  /(\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)\s*(k|m|mn|mil|millions?|thousands?|ألف|الف|آلاف|الاف|ألاف|مليون|ملايين)?(?![a-z])/g;

/**
 * A number as a rep types it on a call: "85k", "1.2m", "٨٥ ألف", "$4,500",
 * "50-80k" (the middle), "3 or 4". Null when there is no number at all, so
 * a blank never reads as zero.
 */
export function readNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s
    .replace(/[٠-٩۰-۹]/g, d => EASTERN[d] ?? d)
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/،/g, " ")
    .toLowerCase();
  const found: {
    value: number;
    scale: number | null;
    end: number;
    start: number;
  }[] = [];
  for (const m of s.matchAll(TOKEN)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const word = (m[2] ?? "").trim();
    const scale = !word
      ? null
      : THOUSAND.test(word)
        ? 1_000
        : MILLION.test(word)
          ? 1_000_000
          : null;
    found.push({
      value,
      scale,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
    if (found.length === 2) break;
  }
  if (!found.length) return ZERO.test(s.trim()) ? 0 : null;
  const [a, b] = found;
  if (b && RANGE.test(s.slice(a.end, b.start))) {
    const scale = b.scale ?? a.scale ?? 1;
    const lo = a.value * (a.scale ?? scale);
    const hi = b.value * scale;
    return (lo + hi) / 2;
  }
  return a.value * (a.scale ?? 1);
}

// ------------------------------------------------------------- the funnel

/** The capture keys the math reads, as the scripts name them. */
export const FUNNEL_KEYS = {
  spend: "ad_spend_month",
  adLeads: "ad_leads_month",
  leads: "leads_month",
  booked: "booked_month",
  showed: "showed_month",
  closed: "closed_month",
  aov: "project_value",
  closed12: "projects_closed_12m",
  quotes12: "quotes_12m",
  revenue12: "revenue_12m",
  good: "good_month_projects",
  slow: "slow_month_projects",
  slowMonths: "slow_months",
  years: "years_in_business",
  hours: "hours_chasing",
} as const;

export type Given = { [K in keyof typeof FUNNEL_KEYS]: number | null };

export type StepKey = "ads" | "booking" | "show" | "close";
export type LeakKey = StepKey | "volume" | "referrals";

export interface Step {
  key: StepKey;
  /** Their rate (0 to 1), or for ads their cost of an inquiry. */
  theirs: number | null;
  /** Ours, in the same unit (the ads cost in their currency). */
  ours: number;
  /** behind ours, at or better than ours, not worked out, or not possible. */
  standing: "behind" | "ahead" | "unknown" | "impossible";
  /** Projects a month more if only this step matched ours. */
  extraMonth: number | null;
  /** Meetings (booking, show) or inquiries (ads) a month more. */
  extraUnits: number | null;
  /** A later step they gave no number for was taken at our rate. */
  usesOurs: boolean;
}

export interface Funnel {
  currency: Currency;
  given: Given;
  /** Projects signed a month, given or worked out from the last 12 months. */
  closed: number | null;
  closedFromYear: boolean;
  /** Inquiries the ads bring, or every inquiry when that is all they gave. */
  adLeads: number | null;
  rates: {
    booking: number | null;
    show: number | null;
    close: number | null;
    leadToClient: number | null;
    quoteWin: number | null;
  };
  costs: {
    perLead: number | null;
    /** The cost of an inquiry counts referrals too (no ads-only number). */
    perLeadAllSources: boolean;
    perBooking: number | null;
    perClient: number | null;
  };
  ours: {
    perLead: number;
    perBooking: number;
    booking: number;
    show: number;
    close: number;
    program: number;
  };
  steps: Step[];
  /** The step that leaks the most, or where the gap comes from. */
  leak: LeakKey | null;
  /** Numbers that cannot all be true, by key. */
  problems: (
    | "booked_over_leads"
    | "showed_over_booked"
    | "closed_over_showed"
    | "ad_leads_over_leads"
  )[];
}

const pos = (n: number | null): n is number => n != null && n > 0;
const known = (n: number | null): n is number => n != null && n >= 0;

/** A step only counts as the leak when fixing it is worth a project a year. */
const WORTH_A_PROJECT = 0.5 / 12;

export function readGiven(values: Record<string, string | undefined>): Given {
  const out = {} as Given;
  for (const [k, key] of Object.entries(FUNNEL_KEYS))
    (out as Record<string, number | null>)[k] = readNumber(values[key]);
  return out;
}

export function funnel(given: Given, currency: Currency): Funnel {
  const fx = PER_USD[currency];
  const ours = {
    perLead: OURS.perLeadUsd * fx,
    perBooking: OURS.perBookingUsd * fx,
    booking: OURS.booking,
    show: OURS.show,
    close: OURS.close,
    program: OURS.programUsd * fx,
  };
  const { spend, leads, booked, showed } = given;
  const closedFromYear = given.closed == null && given.closed12 != null;
  const closed =
    given.closed ?? (given.closed12 != null ? given.closed12 / 12 : null);
  const adLeads = given.adLeads ?? leads;

  const problems: Funnel["problems"] = [];
  if (known(booked) && pos(leads) && booked > leads)
    problems.push("booked_over_leads");
  if (known(showed) && pos(booked) && showed > booked)
    problems.push("showed_over_booked");
  if (known(closed) && pos(showed) && closed > showed && !closedFromYear)
    problems.push("closed_over_showed");
  if (known(given.adLeads) && pos(leads) && given.adLeads > leads)
    problems.push("ad_leads_over_leads");

  const booking = pos(leads) && known(booked) ? booked / leads : null;
  const show = pos(booked) && known(showed) ? showed / booked : null;
  const close =
    pos(showed) && known(closed) && !closedFromYear ? closed / showed : null;
  const leadToClient = pos(leads) && known(closed) ? closed / leads : null;
  const quoteWin =
    pos(given.quotes12) && known(given.closed12)
      ? given.closed12 / given.quotes12
      : null;

  const perLead = pos(spend) && pos(adLeads) ? spend / adLeads : null;
  const perBooking = pos(spend) && pos(booked) ? spend / booked : null;
  const perClient = pos(spend) && pos(closed) ? spend / closed : null;

  const ok = (r: number | null) => r != null && r <= 1;
  const standing = (
    theirs: number | null,
    target: number,
    lowerIsBetter = false,
  ) =>
    theirs == null
      ? ("unknown" as const)
      : !lowerIsBetter && theirs > 1
        ? ("impossible" as const)
        : (lowerIsBetter ? theirs > target : theirs < target)
          ? ("behind" as const)
          : ("ahead" as const);

  // After a step, the rest of the funnel runs at their own rates where they
  // gave them, and at ours where they did not (said on the step).
  const showOr = ok(show) ? (show as number) : ours.show;
  const closeOr = ok(close) ? (close as number) : ours.close;

  const steps: Step[] = [];

  // Ads: the same budget at our cost of an inquiry, then their own path
  // from inquiry to signed project. Only their own path: at our rates the
  // claim would rest on nothing they said.
  {
    const s = standing(perLead, ours.perLead, true);
    let extraMonth: number | null = null;
    let extraUnits: number | null = null;
    if (s === "behind" && pos(spend) && pos(adLeads)) {
      extraUnits = spend / ours.perLead - adLeads;
      if (leadToClient != null && ok(leadToClient))
        extraMonth = extraUnits * leadToClient;
    }
    steps.push({
      key: "ads",
      theirs: perLead,
      ours: ours.perLead,
      standing: s,
      extraMonth,
      extraUnits,
      usesOurs: false,
    });
  }
  // Booking: a quarter of the same inquiries booked, then their own path.
  {
    const s = standing(booking, ours.booking);
    let extraMonth: number | null = null;
    let extraUnits: number | null = null;
    let usesOurs = false;
    if (s === "behind" && pos(leads) && known(booked)) {
      extraUnits = leads * ours.booking - booked;
      let after: number;
      if (pos(booked) && known(closed) && closed <= booked && !closedFromYear)
        after = closed / booked;
      else {
        after = showOr * closeOr;
        usesOurs = !ok(show) || !ok(close);
      }
      extraMonth = extraUnits * after;
    }
    steps.push({
      key: "booking",
      theirs: booking,
      ours: ours.booking,
      standing: s,
      extraMonth,
      extraUnits,
      usesOurs,
    });
  }
  // Show: 60% of the same bookings held, then their own close rate.
  {
    const s = standing(show, ours.show);
    let extraMonth: number | null = null;
    let extraUnits: number | null = null;
    let usesOurs = false;
    if (s === "behind" && pos(booked) && known(showed)) {
      extraUnits = booked * ours.show - showed;
      usesOurs = !ok(close);
      extraMonth = extraUnits * closeOr;
    }
    steps.push({
      key: "show",
      theirs: show,
      ours: ours.show,
      standing: s,
      extraMonth,
      extraUnits,
      usesOurs,
    });
  }
  // Close: a fifth of the same held meetings signed.
  {
    const s = standing(close, ours.close);
    let extraMonth: number | null = null;
    if (s === "behind" && pos(showed) && known(closed))
      extraMonth = showed * ours.close - closed;
    steps.push({
      key: "close",
      theirs: close,
      ours: ours.close,
      standing: s,
      extraMonth,
      extraUnits: null,
      usesOurs: false,
    });
  }

  // The one thing is a step inside their funnel when one is behind: those
  // are fixed without spending a dollar more, which is how it is told. The
  // cost of an inquiry leads only when every step inside is at ours; its
  // numbers are still on screen, and in its branch, for the rep to use.
  let leak: LeakKey | null = null;
  let best = WORTH_A_PROJECT;
  for (const st of steps)
    if (
      st.key !== "ads" &&
      st.standing === "behind" &&
      st.extraMonth != null &&
      st.extraMonth >= best
    ) {
      best = st.extraMonth;
      leak = st.key;
    }
  const ads = steps[0];
  if (
    !leak &&
    ads.standing === "behind" &&
    (ads.extraMonth ?? 0) >= WORTH_A_PROJECT
  )
    leak = "ads";
  if (!leak && pos(leads) && pos(closed) && !problems.length) leak = "volume";
  if (
    !leak &&
    known(given.good) &&
    known(given.slow) &&
    pos(given.slowMonths) &&
    given.good > given.slow
  )
    leak = "referrals";

  return {
    currency,
    given,
    closed,
    closedFromYear,
    adLeads,
    rates: { booking, show, close, leadToClient, quoteWin },
    costs: {
      perLead,
      perLeadAllSources: given.adLeads == null && perLead != null,
      perBooking,
      perClient,
    },
    ours,
    steps,
    leak,
    problems,
  };
}

export interface Gap {
  key: LeakKey;
  /** Projects a year more (or lost, for referrals). */
  projectsYear: number | null;
  /** Meetings or inquiries a month more, for the steps that have them. */
  unitsMonth: number | null;
  moneyMonth: number | null;
  moneyYear: number | null;
  usesOurs: boolean;
  /**
   * More than twice what they sign a year now: true to their numbers, but a
   * rep should lead with part of it or with a step inside their funnel.
   */
  big: boolean;
}

/** What one step is worth: the leak by default, or any step a rep opens. */
export function gapFor(f: Funnel, key: LeakKey | null = f.leak): Gap | null {
  if (!key) return null;
  const aov = f.given.aov;
  const money = (projectsYear: number | null) =>
    projectsYear != null && pos(aov) ? projectsYear * aov : null;
  const big = (projectsYear: number | null) =>
    projectsYear != null && pos(f.closed) && projectsYear > 2 * f.closed * 12;
  if (key === "volume") {
    // Twice the inquiries at their own rates: as many again as they sign.
    const projectsYear = pos(f.closed) ? f.closed * 12 : null;
    const moneyYear = money(projectsYear);
    return {
      key,
      projectsYear,
      unitsMonth: f.given.leads,
      moneyMonth: moneyYear == null ? null : moneyYear / 12,
      moneyYear,
      usesOurs: false,
      big: false,
    };
  }
  if (key === "referrals") {
    const { good, slow, slowMonths } = f.given;
    if (!known(good) || !known(slow) || !pos(slowMonths) || good <= slow)
      return null;
    const projectsYear = (good - slow) * slowMonths;
    const moneyYear = money(projectsYear);
    return {
      key,
      projectsYear,
      unitsMonth: good - slow,
      moneyMonth: moneyYear == null ? null : moneyYear / 12,
      moneyYear,
      usesOurs: false,
      big: false,
    };
  }
  const st = f.steps.find(s => s.key === key);
  if (!st || st.extraMonth == null || st.standing !== "behind") return null;
  const projectsYear = st.extraMonth * 12;
  const moneyYear = money(projectsYear);
  return {
    key,
    projectsYear,
    unitsMonth: st.extraUnits,
    moneyMonth: moneyYear == null ? null : moneyYear / 12,
    moneyYear,
    usesOurs: st.usesOurs,
    big: big(projectsYear),
  };
}

/**
 * Every step inside their funnel at our number at once (booking, show-up,
 * closing), from the inquiries they already get: the same "without spending
 * a dollar more" frame as the one thing, so it never counts the ad budget
 * at our cost per inquiry.
 */
export function wholeFunnel(
  f: Funnel,
): { projectsYear: number; moneyYear: number | null } | null {
  const { leads, aov } = f.given;
  const r = f.rates;
  if (!pos(leads) || !known(f.closed) || f.problems.length || f.closedFromYear)
    return null;
  if (r.booking == null || r.show == null || r.close == null) return null;
  const at = (theirs: number, ours: number) => Math.max(theirs, ours);
  const signed =
    leads *
    at(r.booking, f.ours.booking) *
    at(r.show, f.ours.show) *
    at(r.close, f.ours.close);
  const projectsYear = Math.max(0, signed - f.closed) * 12;
  return { projectsYear, moneyYear: pos(aov) ? projectsYear * aov : null };
}

/** Moving the close rate ten points, for the pitch's closing pillar. */
export function closePlusTen(
  f: Funnel,
): { rate: number; moneyYear: number | null } | null {
  const { close } = f.rates;
  const { showed, aov } = f.given;
  if (close == null || close > 1 || !pos(showed)) return null;
  const rate = Math.min(close + 0.1, 1);
  const extraYear = showed * (rate - close) * 12;
  return { rate, moneyYear: pos(aov) ? extraYear * aov : null };
}

// ------------------------------------------------------------- the words

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function digits(s: string, lang: Lang): string {
  if (lang === "en") return s;
  return s
    .replace(/\d/g, d => AR_DIGITS[Number(d)])
    .replace(/\./g, "٫")
    .replace(/,/g, "٬");
}

function trim(n: number, places: number): string {
  return n
    .toFixed(places)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

const CURRENCY_WORD: Record<Currency, { en: string; ar: string }> = {
  USD: { en: "$", ar: "دولار" },
  KWD: { en: "KWD", ar: "دينار" },
  SAR: { en: "SAR", ar: "ريال" },
  AED: { en: "AED", ar: "درهم" },
  QAR: { en: "QAR", ar: "ريال" },
  BHD: { en: "BHD", ar: "دينار" },
  OMR: { en: "OMR", ar: "ريال" },
};

/** An amount the way it is said on a call: 4.6 KWD, 85,000 KWD, 1.2 million KWD. */
export function sayMoney(n: number, currency: Currency, lang: Lang): string {
  const word = CURRENCY_WORD[currency][lang];
  const a = Math.abs(n);
  if (lang === "en") {
    let body: string;
    if (a < 100) body = trim(a, 1);
    else if (a < 10_000) body = grouped(a);
    else if (a < 1_000_000) body = grouped(Math.round(a / 1_000) * 1_000);
    else body = `${trim(a / 1_000_000, 1)} million`;
    return currency === "USD" ? `$${body}` : `${body} ${word}`;
  }
  let body: string;
  if (a < 100) body = digits(trim(a, 1), lang);
  else if (a < 1_000) body = digits(grouped(a), lang);
  else if (a < 999_500) {
    const k = a < 10_000 ? Number(trim(a / 1_000, 1)) : Math.round(a / 1_000);
    body =
      k === 1 ? "ألف" : k === 2 ? "ألفين" : `${digits(String(k), lang)} ألف`;
  } else {
    const m = Number(trim(a / 1_000_000, 1));
    body =
      m === 1
        ? "مليون"
        : m === 2
          ? "مليونين"
          : `${digits(String(m), lang)} مليون`;
  }
  return `${body} ${word}`;
}

export function sayPct(r: number, lang: Lang): string {
  const p = r * 100;
  const s = p < 10 ? trim(p, 1) : String(Math.round(p));
  return lang === "en" ? `${s}%` : `${digits(s, lang)}٪`;
}

/** A count on its own: 12, 1.5. */
export function sayCount(n: number, lang: Lang): string {
  return digits(Number.isInteger(n) ? String(n) : trim(n, 1), lang);
}

type Noun = {
  en: [string, string];
  ar: { one: string; two: string; few: string; many: string };
};

const NOUNS = {
  project: {
    en: ["project", "projects"],
    ar: { one: "مشروع واحد", two: "مشروعين", few: "مشاريع", many: "مشروع" },
  },
  meeting: {
    en: ["meeting", "meetings"],
    ar: { one: "موعد واحد", two: "موعدين", few: "مواعيد", many: "موعد" },
  },
  inquiry: {
    en: ["inquiry", "inquiries"],
    ar: {
      one: "استفسار واحد",
      two: "استفسارين",
      few: "استفسارات",
      many: "استفسار",
    },
  },
  year: {
    en: ["year", "years"],
    ar: { one: "سنة وحدة", two: "سنتين", few: "سنين", many: "سنة" },
  },
  hour: {
    en: ["hour", "hours"],
    ar: { one: "ساعة وحدة", two: "ساعتين", few: "ساعات", many: "ساعة" },
  },
  slowMonth: {
    en: ["slow month", "slow months"],
    ar: {
      one: "شهر واحد بطيء",
      two: "شهرين بطيئين",
      few: "شهور بطيئة",
      many: "شهر بطيء",
    },
  },
} satisfies Record<string, Noun>;

/**
 * A whole number of things, said properly in each language: "11 more
 * projects", "مشروعين زيادة", "٣ مشاريع". Rounded to whole things, because
 * nobody signs half a project.
 */
export function sayMany(
  n: number,
  noun: keyof typeof NOUNS,
  lang: Lang,
  more = false,
): string {
  const k = Math.max(0, Math.round(n));
  const w = NOUNS[noun];
  if (lang === "en") {
    const word = k === 1 ? w.en[0] : w.en[1];
    return `${k} ${more ? "more " : ""}${word}`;
  }
  const extra = more ? " زيادة" : "";
  if (k === 0) return `ولا ${w.ar.many}${extra}`;
  if (k === 1) return `${w.ar.one}${extra}`;
  if (k === 2) return `${w.ar.two}${extra}`;
  if (k <= 10) return `${digits(String(k), lang)} ${w.ar.few}${extra}`;
  return `${digits(String(k), lang)} ${w.ar.many}${extra}`;
}

const STEP_WORDS: Record<LeakKey, { en: string; ar: string }> = {
  ads: { en: "the cost of each inquiry", ar: "تكلفة الاستفسار الواحد" },
  booking: {
    en: "the step from inquiry to meeting",
    ar: "الخطوة من الاستفسار للموعد",
  },
  show: {
    en: "the step from booking to show-up",
    ar: "الخطوة من الحجز للحضور",
  },
  close: {
    en: "the step from meeting to signature",
    ar: "الخطوة من الاجتماع للتوقيع",
  },
  volume: {
    en: "the number of inquiries coming in",
    ar: "عدد الاستفسارات اللي تدخل",
  },
  referrals: { en: "the slow months", ar: "الشهور البطيئة" },
};

export function stepWords(key: LeakKey, lang: Lang): string {
  return STEP_WORDS[key][lang];
}

function joinList(parts: string[], lang: Lang): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (lang === "ar")
    return `${parts.slice(0, -1).join("، ")}، و${parts[parts.length - 1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The steps at or better than ours, said as a compliment. Null when none are. */
export function strengths(f: Funnel, lang: Lang): string | null {
  const parts: string[] = [];
  for (const st of f.steps) {
    if (st.standing !== "ahead" || st.theirs == null) continue;
    if (st.key === "ads")
      parts.push(
        lang === "en"
          ? "what you pay for an inquiry is already under our number"
          : "تكلفة استفسارك أصلاً أقل من رقمنا",
      );
    if (st.key === "booking")
      parts.push(
        lang === "en"
          ? `you turn ${sayPct(st.theirs, lang)} of your inquiries into meetings`
          : `تحوّل ${sayPct(st.theirs, lang)} من استفساراتك لمواعيد`,
      );
    if (st.key === "show")
      parts.push(
        lang === "en"
          ? `${sayPct(st.theirs, lang)} of your meetings actually happen`
          : `${sayPct(st.theirs, lang)} من مواعيدك تصير فعلاً`,
      );
    if (st.key === "close")
      parts.push(
        lang === "en"
          ? `you sign ${sayPct(st.theirs, lang)} of the people you meet`
          : `توقّع مع ${sayPct(st.theirs, lang)} من اللي تقابلهم`,
      );
  }
  return parts.length ? joinList(parts, lang) : null;
}

/** How many projects at their average cover the program, without saying the price. */
export function payback(f: Funnel, lang: Lang): string | null {
  const aov = f.given.aov;
  if (!pos(aov)) return null;
  const n = Math.ceil(f.ours.program / aov);
  const value = sayMoney(aov, f.currency, lang);
  if (lang === "en")
    return n <= 1
      ? `a single extra project at your average of ${value} more than covers the investment`
      : `about ${n} extra projects at your average of ${value} cover the investment`;
  if (n <= 1) return `مشروع واحد زيادة بمتوسطك ${value} يغطي الاستثمار وزيادة`;
  return `تقريباً ${sayMany(n, "project", lang, true)} بمتوسطك ${value} يغطون الاستثمار`;
}

/**
 * The script's placeholders this funnel can fill, in the script's language.
 * The gap tokens ([GAP YEAR], [EXTRA PROJECTS A YEAR] and the like) speak
 * for one step: the leak unless another is asked for, so a branch the rep
 * opens for a different step says that step's numbers.
 */
export function funnelTokens(
  f: Funnel,
  lang: Lang,
  key: LeakKey | null = f.leak,
): Record<string, string> {
  const t: Record<string, string> = {};
  const m = (n: number | null) =>
    n == null ? null : sayMoney(n, f.currency, lang);
  const put = (k: string, v: string | null | undefined) => {
    if (v != null && v !== "") t[k] = v;
  };
  const g = f.given;
  put("AD SPEND", m(g.spend));
  put("AD LEADS", f.adLeads == null ? null : sayCount(f.adLeads, lang));
  put("LEADS", g.leads == null ? null : sayCount(g.leads, lang));
  put("BOOKED", g.booked == null ? null : sayCount(g.booked, lang));
  put("SHOWED", g.showed == null ? null : sayCount(g.showed, lang));
  put(
    "CLOSED",
    f.closed == null ? null : sayCount(Math.round(f.closed * 10) / 10, lang),
  );
  put("PROJECT VALUE", m(g.aov));
  put("REVENUE", m(g.revenue12));
  put(
    "BOOKING RATE",
    f.rates.booking == null || f.rates.booking > 1
      ? null
      : sayPct(f.rates.booking, lang),
  );
  put(
    "SHOW RATE",
    f.rates.show == null || f.rates.show > 1
      ? null
      : sayPct(f.rates.show, lang),
  );
  put(
    "CLOSE RATE",
    f.rates.close == null || f.rates.close > 1
      ? null
      : sayPct(f.rates.close, lang),
  );
  put(
    "QUOTE WIN RATE",
    f.rates.quoteWin == null || f.rates.quoteWin > 1
      ? null
      : sayPct(f.rates.quoteWin, lang),
  );
  put("CPL", m(f.costs.perLead));
  put("OUR CPL", m(f.ours.perLead));
  put("OUR BOOKING RATE", sayPct(f.ours.booking, lang));
  put("OUR SHOW RATE", sayPct(f.ours.show, lang));
  put("OUR CLOSE RATE", sayPct(f.ours.close, lang));
  if (g.spend != null && g.spend > 0)
    put("LEADS AT OUR CPL", sayMany(g.spend / f.ours.perLead, "inquiry", lang));
  put(
    "YEARS IN BUSINESS",
    g.years == null ? null : sayMany(g.years, "year", lang),
  );
  put(
    "SLOW MONTHS",
    g.slowMonths == null ? null : sayMany(g.slowMonths, "slowMonth", lang),
  );
  put("HOURS A WEEK", g.hours == null ? null : sayMany(g.hours, "hour", lang));
  if (g.good != null && g.slow != null && g.good > g.slow)
    put(
      "PROJECTS LOST A SLOW MONTH",
      sayMany(g.good - g.slow, "project", lang),
    );
  put("STRONG STEPS", strengths(f, lang));
  put("PAYBACK", payback(f, lang));
  const plus = closePlusTen(f);
  if (plus) {
    put("CLOSE RATE PLUS 10", sayPct(plus.rate, lang));
    put("PLUS 10 A YEAR", m(plus.moneyYear));
  }
  const gap = gapFor(f, key);
  if (gap && key) {
    put("WEAK STEP", stepWords(key, lang));
    if (gap.projectsYear != null && gap.projectsYear >= 0.5) {
      put(
        "EXTRA PROJECTS A YEAR",
        sayMany(gap.projectsYear, "project", lang, true),
      );
      put("LOST PROJECTS A YEAR", sayMany(gap.projectsYear, "project", lang));
    }
    if (
      gap.unitsMonth != null &&
      gap.unitsMonth >= 0.5 &&
      (key === "booking" || key === "show")
    )
      put("EXTRA MEETINGS", sayMany(gap.unitsMonth, "meeting", lang, true));
    put("GAP MONTH", m(gap.moneyMonth));
    put("GAP YEAR", m(gap.moneyYear));
  }
  return t;
}

/** What each placeholder asks for, shown in its place while it is blank. */
export const TOKEN_LABELS: Record<string, { en: string; ar: string }> = {
  "AD SPEND": { en: "ad spend", ar: "الصرف" },
  "AD LEADS": { en: "ad inquiries", ar: "استفسارات الإعلانات" },
  LEADS: { en: "inquiries", ar: "الاستفسارات" },
  BOOKED: { en: "booked", ar: "المحجوز" },
  SHOWED: { en: "held", ar: "اللي صار" },
  CLOSED: { en: "signed", ar: "الموقّع" },
  "PROJECT VALUE": { en: "average project", ar: "متوسط المشروع" },
  REVENUE: { en: "revenue", ar: "الدخل" },
  "BOOKING RATE": { en: "booking rate", ar: "نسبة الحجز" },
  "SHOW RATE": { en: "show rate", ar: "نسبة الحضور" },
  "CLOSE RATE": { en: "close rate", ar: "نسبة الإقفال" },
  "QUOTE WIN RATE": { en: "quotes won", ar: "العروض المكسوبة" },
  CPL: { en: "cost per inquiry", ar: "تكلفة الاستفسار" },
  "OUR CPL": { en: "our cost per inquiry", ar: "تكلفتنا" },
  "OUR BOOKING RATE": { en: "our booking rate", ar: "نسبتنا" },
  "OUR SHOW RATE": { en: "our show rate", ar: "نسبتنا" },
  "OUR CLOSE RATE": { en: "our close rate", ar: "نسبتنا" },
  "LEADS AT OUR CPL": {
    en: "inquiries at our cost",
    ar: "الاستفسارات بتكلفتنا",
  },
  "YEARS IN BUSINESS": { en: "years", ar: "السنين" },
  "SLOW MONTHS": { en: "slow months", ar: "الشهور البطيئة" },
  "HOURS A WEEK": { en: "hours", ar: "الساعات" },
  "PROJECTS LOST A SLOW MONTH": {
    en: "projects lost",
    ar: "المشاريع اللي راحت",
  },
  "STRONG STEPS": { en: "what's at our numbers", ar: "اللي زين عندهم" },
  PAYBACK: { en: "needs their average project", ar: "يبي متوسط المشروع" },
  "CLOSE RATE PLUS 10": { en: "close rate + 10", ar: "الإقفال +١٠" },
  "PLUS 10 A YEAR": { en: "what +10 is worth", ar: "قيمة +١٠" },
  "WEAK STEP": { en: "the leak", ar: "مكان التسريب" },
  "EXTRA PROJECTS A YEAR": { en: "extra projects", ar: "المشاريع الزيادة" },
  "LOST PROJECTS A YEAR": { en: "projects lost", ar: "المشاريع اللي تطيح" },
  "EXTRA MEETINGS": { en: "extra meetings", ar: "المواعيد الزيادة" },
  "GAP MONTH": { en: "gap a month", ar: "الفجوة بالشهر" },
  "GAP YEAR": { en: "gap a year", ar: "الفجوة بالسنة" },
};

/**
 * The scripts' older placeholders that mean one of the tokens above:
 * "$[V]" is the average project, "$[gap]" the gap a year, and so on. The
 * intro's own [STRENGTHS] is what the setter heard them do well, not a
 * number, so the funnel's compliment is [STRONG STEPS].
 */
export const TOKEN_ALIASES: Record<string, string> = {
  V: "PROJECT VALUE",
  GAP: "GAP YEAR",
  "GAP FROM STAGE 06": "GAP YEAR",
  "GAP FROM COST OF INACTION": "GAP YEAR",
  "ANNUAL FIGURE": "GAP YEAR",
  "MONTHLY LOSS": "GAP MONTH",
  "MONTHLY FIGURE": "GAP MONTH",
  "MONTHLY GAP": "GAP MONTH",
  "X YEARS IN BUSINESS": "YEARS IN BUSINESS",
  "X YEARS": "YEARS IN BUSINESS",
  "X سنين في الشغل": "YEARS IN BUSINESS",
  "X سنوات": "YEARS IN BUSINESS",
  "عدد السنوات": "YEARS IN BUSINESS",
  "الفجوة من تكلفة عدم الفعل": "GAP YEAR",
  "الفجوة الشهرية": "GAP MONTH",
};
