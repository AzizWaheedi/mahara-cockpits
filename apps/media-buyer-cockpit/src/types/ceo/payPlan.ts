import { CPB_GATE, CPL_GATE } from "../../lib/kpi";
import {
  COMMISSION_BASES,
  COMMISSION_LABEL,
  type CommissionBasis,
  SHARE_BASES,
} from "./commission";

/**
 * Pay plans: commission and bonuses on Team & payroll (docs/pay/PAY-PLANS.md,
 * the CEO, 2026-10-18). A plan is a list of parts on top of the base, which
 * never changes here ("add these for now but keep the bases the same"). It
 * belongs to a role or to one person and applies from a month.
 *
 * The rule is written twice and must agree: `checkPlan` here and
 * `cockpit_pay_plan_check` in supabase/migrations/20261018a_ceo_pay_plans.sql
 * return the same sentence for the same plan, and `pickBand` here and
 * `cockpit_pay_band_pick` pick the same band
 * (scripts/pay-plan-model.test.ts runs both over one table). The server
 * works out every paid amount; this file checks a draft, reads it back in
 * words and draws it.
 */

// ---------------------------------------------------------------------------
// The plan (section 3)

export const PART_KINDS = [
  "band",
  "per_event",
  "share",
  "per_above",
  "floor",
] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** The "Add a part" select, in the CEO's words. */
export const PART_KIND_LABEL: Record<PartKind, string> = {
  band: "A bonus by band",
  per_event: "An amount per event",
  share: "A share of money",
  per_above: "An amount per client over a line",
  floor: "A floor until a date",
};

export const BAND_METRICS = [
  "cpl",
  "cpb",
  "logo_churn_prior",
  "csm_churn",
] as const;
export type BandMetric = (typeof BAND_METRICS)[number];

/** What a band part is paid on: its name, its unit and how it is read. */
export const BAND_METRIC: Record<
  BandMetric,
  { label: string; unit: "usd" | "pct"; note: string }
> = {
  cpl: {
    label: "Cost per lead",
    unit: "usd",
    note: "Lead-campaign spend over Meta leads, pooled over the clients it covers.",
  },
  cpb: {
    label: "Cost per booking",
    unit: "usd",
    note: "All spend over confirmed bookings, pooled over the clients it covers.",
  },
  logo_churn_prior: {
    label: "Last month's churn",
    unit: "pct",
    note: "The company's logo churn in the month before, as you confirm it.",
  },
  csm_churn: {
    label: "Churn of their clients",
    unit: "pct",
    note: "Clients in their book lost mid-programme this month, as you confirm it.",
  },
};

/** Which clients a cost-per-lead or cost-per-booking bonus covers. */
export const COVERS = ["all_clients", "owned_creative"] as const;
export type Covers = (typeof COVERS)[number];
export const COVERS_LABEL: Record<Covers, string> = {
  all_clients: "Every client in the month",
  owned_creative: "Clients whose running creative they own",
};

/** Events typed by the CEO each month, then the one the cockpit counts. */
export const TYPED_EVENTS = [
  "renewal",
  "reactivation",
  "referral",
  "video_testimonial",
  "google_review",
  "podcast_case_study",
  "system_built",
  "system_built_large",
  "custom",
] as const;
export const COUNTED_EVENTS = ["pif_deal_closed"] as const;
export type EventKey =
  | (typeof TYPED_EVENTS)[number]
  | (typeof COUNTED_EVENTS)[number];

/** Each event: its words, and who counts it ("typed": the CEO each month). */
export const EVENTS: Record<
  EventKey,
  { label: string; by: "typed" | "counted" }
> = {
  renewal: { label: "Renewal", by: "typed" },
  reactivation: { label: "Reactivation", by: "typed" },
  referral: { label: "Referral", by: "typed" },
  video_testimonial: { label: "Video testimonial", by: "typed" },
  google_review: { label: "Google review", by: "typed" },
  podcast_case_study: { label: "Podcast case study", by: "typed" },
  system_built: { label: "Fully built-out system", by: "typed" },
  system_built_large: { label: "Huge built-out system", by: "typed" },
  custom: { label: "Something else", by: "typed" },
  pif_deal_closed: {
    label: "Deal they closed, paid in full",
    by: "counted",
  },
};

export const SHARE_OF = [
  "upsell_cash",
  "recurring_revenue",
  "smm_revenue",
  "custom_cash",
] as const;
export type ShareOf = (typeof SHARE_OF)[number];
export const SHARE_OF_LABEL: Record<ShareOf, string> = {
  upsell_cash: "upsell cash",
  recurring_revenue: "recurring revenue",
  smm_revenue: "social media management revenue",
  custom_cash: "the cash you type",
};

export type Band = { upTo: number | null; inclusive?: boolean; amount: number };
export type Guard = {
  minClients?: number;
  minSpendUsd?: number;
  excludeDays?: number;
};
export type Step = { fromMonth: number; rate: number };

type PartBase = { key: string; label: string };
export type BandPart = PartBase & {
  kind: "band";
  metric: BandMetric;
  /** Cost per lead or per booking only; every client when absent. */
  covers?: Covers;
  bands: Band[];
  /** Cost per lead or per booking only. */
  guard?: Guard;
};
export type PerEventPart = PartBase & {
  kind: "per_event";
  event: EventKey;
  amount: number;
  /** A custom event's name. */
  eventLabel?: string;
};
export type SharePart = PartBase & {
  kind: "share";
  of: ShareOf;
  steps: Step[];
  ends?: { onCancel: boolean; lapseDays?: number };
  prorateOnCancel?: boolean;
};
export type PerAbovePart = PartBase & {
  kind: "per_above";
  measure: "qualifying_clients";
  over: number;
  amount: number;
};
export type FloorPart = PartBase & {
  kind: "floor";
  amount: number;
  days: number;
};
export type Part =
  | BandPart
  | PerEventPart
  | SharePart
  | PerAbovePart
  | FloorPart;

/** A role plan's commission default: what picking the role pre-fills on the roster. */
export type PlanCommission = { basis: CommissionBasis; rate: number };

export type Plan = {
  version: 1;
  parts: Part[];
  /** Role plans only, at most 2. */
  commission?: PlanCommission[];
};

/** The commission bases a pay month works out itself; the rest are priced on Costs from the plan. */
export const MEASURED_BASES: ReadonlySet<CommissionBasis> =
  new Set<CommissionBasis>([
    "closed_cash",
    "set_cash",
    "per_client_appt_shown",
    "per_client_deal_closed",
  ]);

/** Plan amounts are USD (decision 12). */
export const PLAN_CURRENCY = "USD";

// ---------------------------------------------------------------------------
// The check: the same sentences, in the same order, as cockpit_pay_plan_check

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** A JSON number, as the server reads one (cockpit_pay_num); anything else is null. */
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/** Present in the JSON: a key whose value is undefined is dropped when it is sent. */
const has = (o: Obj, k: string) => Object.hasOwn(o, k) && o[k] !== undefined;
/** Postgres btrim and length: spaces only, counted in characters. */
const btrimLength = (s: string) => [...s.replace(/^ +| +$/g, "")].length;
const between = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
const whole = (x: number) => Number.isInteger(x);

const utf8 = new TextEncoder();
/**
 * An object's keys in the order jsonb_object_keys returns them (shorter keys
 * first, then byte order), so a plan with two unknown fields names the same
 * one first on both sides.
 */
function jsonbKeys(o: Obj): string[] {
  return Object.keys(o)
    .filter(k => o[k] !== undefined)
    .map(k => ({ k, b: utf8.encode(k) }))
    .sort((x, y) => {
      if (x.b.length !== y.b.length) return x.b.length - y.b.length;
      for (let i = 0; i < x.b.length; i++)
        if (x.b[i] !== y.b[i]) return x.b[i] - y.b[i];
      return 0;
    })
    .map(x => x.k);
}
const unknownKey = (o: Obj, allowed: readonly string[]) =>
  jsonbKeys(o).find(k => !allowed.includes(k)) ?? null;

const PART_FIELDS: Record<PartKind, readonly string[]> = {
  band: ["key", "kind", "label", "metric", "covers", "bands", "guard"],
  per_event: ["key", "kind", "label", "event", "amount", "eventLabel"],
  share: ["key", "kind", "label", "of", "steps", "ends", "prorateOnCancel"],
  per_above: ["key", "kind", "label", "measure", "over", "amount"],
  floor: ["key", "kind", "label", "amount", "days"],
};
const EVENT_KEYS: readonly string[] = [...TYPED_EVENTS, ...COUNTED_EVENTS];
/** Every basis but none and other: what a role plan's commission line may name. */
const PLAN_BASES: readonly string[] = COMMISSION_BASES.filter(
  b => b !== "none" && b !== "other",
);

/**
 * The plan's first fault as a sentence, or null when it is valid. The same
 * sentences, checked in the same order, as cockpit_pay_plan_check(plan,
 * is_role): unknown keys are refused at every level; a role plan may carry
 * commission lines, a person's may not.
 */
export function checkPlan(
  plan: unknown,
  opts: { isRole: boolean },
): string | null {
  if (!isObj(plan))
    return "A pay plan is an object with a version and a list of parts.";
  const extra = unknownKey(plan, ["version", "parts", "commission"]);
  if (extra) return `Unknown field "${extra}" in the plan.`;
  if (plan.version !== 1) return "The plan's version must be 1.";
  if (!Array.isArray(plan.parts))
    return "The plan needs a list of parts (it may be empty).";
  if (plan.parts.length > 20) return "A plan has at most 20 parts.";
  const keys = new Set<string>();
  const measures = new Set<string>();
  let floors = 0;
  let pifs = 0;
  let pi = 0;
  for (const part of plan.parts) {
    pi += 1;
    if (!isObj(part)) return `Part ${pi} is not an object.`;
    const pk = typeof part.key === "string" ? part.key : null;
    if (pk === null || !/^[a-z][a-z0-9_]{0,39}$/.test(pk))
      return `Part ${pi} needs a key: a lowercase letter, then letters, digits or _ (up to 40).`;
    if (pk === "adjustment")
      return 'The key "adjustment" is kept for adjustments.';
    if (keys.has(pk)) return `Two parts share the key "${pk}".`;
    keys.add(pk);
    const kind =
      typeof part.kind === "string" &&
      (PART_KINDS as readonly string[]).includes(part.kind)
        ? (part.kind as PartKind)
        : null;
    if (!kind) return `Part "${pk}" has an unknown kind.`;
    const field = unknownKey(part, PART_FIELDS[kind]);
    if (field) return `Unknown field "${field}" in part "${pk}".`;
    if (
      typeof part.label !== "string" ||
      !between(btrimLength(part.label), 1, 80)
    )
      return `Part "${pk}" needs a label of 1 to 80 characters.`;

    if (kind === "band") {
      const m =
        typeof part.metric === "string" &&
        (BAND_METRICS as readonly string[]).includes(part.metric)
          ? part.metric
          : null;
      if (!m) return `Part "${pk}" pays on an unknown metric.`;
      const churn = m === "logo_churn_prior" || m === "csm_churn";
      if (has(part, "covers")) {
        if (churn)
          return `Part "${pk}": only cost per lead or cost per booking covers clients.`;
        if (
          typeof part.covers !== "string" ||
          !(COVERS as readonly string[]).includes(part.covers)
        )
          return `Part "${pk}" covers all_clients or owned_creative.`;
      }
      if (has(part, "guard")) {
        if (churn)
          return `Part "${pk}": only cost per lead or cost per booking has a guard.`;
        const g = part.guard;
        if (!isObj(g)) return `The guard of part "${pk}" is an object.`;
        const gf = unknownKey(g, ["minClients", "minSpendUsd", "excludeDays"]);
        if (gf) return `Unknown field "${gf}" in the guard of part "${pk}".`;
        let x = num(g.minClients);
        if (
          has(g, "minClients") &&
          (x === null || !whole(x) || !between(x, 1, 100))
        )
          return `The guard of part "${pk}" needs minClients from 1 to 100.`;
        x = num(g.minSpendUsd);
        if (has(g, "minSpendUsd") && (x === null || !between(x, 0, 100000)))
          return `The guard of part "${pk}" needs minSpendUsd from 0 to 100,000.`;
        x = num(g.excludeDays);
        if (
          has(g, "excludeDays") &&
          (x === null || !whole(x) || !between(x, 0, 90))
        )
          return `The guard of part "${pk}" needs excludeDays from 0 to 90.`;
      }
      const bands = part.bands;
      if (!Array.isArray(bands) || !between(bands.length, 2, 10))
        return `Part "${pk}" needs 2 to 10 bands.`;
      let prev: number | null = null;
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        const bi = i + 1;
        if (!isObj(b)) return `Band ${bi} of part "${pk}" is not an object.`;
        const bf = unknownKey(b, ["upTo", "inclusive", "amount"]);
        if (bf) return `Unknown field "${bf}" in band ${bi} of part "${pk}".`;
        const amount = num(b.amount);
        if (amount === null || Math.abs(amount) > 100000)
          return `Band ${bi} of part "${pk}" needs an amount between -100,000 and 100,000.`;
        if (bi < bands.length) {
          const up = num(b.upTo);
          if (up === null)
            return `Band ${bi} of part "${pk}" needs a number upTo; only the last band runs on.`;
          if (typeof b.inclusive !== "boolean")
            return `Band ${bi} of part "${pk}" needs inclusive: true or false.`;
          if (churn && !between(up, 0, 100))
            return `Band edges of part "${pk}" are percents from 0 to 100.`;
          if (!churn && up <= 0)
            return `Band edges of part "${pk}" are amounts above 0.`;
          if (prev !== null && up <= prev)
            return `The bands of part "${pk}" must rise.`;
          prev = up;
        } else {
          if (!has(b, "upTo") || b.upTo !== null)
            return `The last band of part "${pk}" runs on: upTo null.`;
          if (has(b, "inclusive") && typeof b.inclusive !== "boolean")
            return `Band ${bi} of part "${pk}" needs inclusive: true or false.`;
        }
      }
      const measure = churn
        ? m
        : `${m}:${typeof part.covers === "string" ? part.covers : "all_clients"}`;
      if (measures.has(measure))
        return `Two parts pay on the same measure (${measure}).`;
      measures.add(measure);
    } else if (kind === "per_event") {
      const ev =
        typeof part.event === "string" && EVENT_KEYS.includes(part.event)
          ? part.event
          : null;
      if (!ev) return `Part "${pk}" has an unknown event.`;
      const x = num(part.amount);
      if (x === null || x < 0 || x > 100000)
        return `Part "${pk}" needs an amount from 0 to 100,000.`;
      if (ev === "custom") {
        if (
          typeof part.eventLabel !== "string" ||
          !between(btrimLength(part.eventLabel), 1, 80)
        )
          return `Part "${pk}" needs an event label of 1 to 80 characters.`;
      } else if (has(part, "eventLabel"))
        return `Part "${pk}": only a custom event has a label.`;
      if (ev === "pif_deal_closed") {
        pifs += 1;
        if (pifs > 1) return "The paid-in-full bonus can be in a plan once.";
      }
    } else if (kind === "share") {
      if (
        typeof part.of !== "string" ||
        !(SHARE_OF as readonly string[]).includes(part.of)
      )
        return `Part "${pk}" is a share of an unknown amount.`;
      const steps = part.steps;
      if (!Array.isArray(steps) || !between(steps.length, 1, 6))
        return `Part "${pk}" needs 1 to 6 steps.`;
      let prevm: number | null = null;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const si = i + 1;
        if (!isObj(s)) return `Step ${si} of part "${pk}" is not an object.`;
        const sf = unknownKey(s, ["fromMonth", "rate"]);
        if (sf) return `Unknown field "${sf}" in step ${si} of part "${pk}".`;
        const from = num(s.fromMonth);
        if (from === null || !whole(from) || !between(from, 1, 600))
          return `Step ${si} of part "${pk}" needs fromMonth, a month number from 1.`;
        if (si === 1 && from !== 1)
          return `The first step of part "${pk}" starts in month 1.`;
        if (prevm !== null && from <= prevm)
          return `The steps of part "${pk}" must start in later months.`;
        prevm = from;
        const rate = num(s.rate);
        if (rate === null || !between(rate, 0, 1))
          return `Step ${si} of part "${pk}" needs a rate from 0 to 1.`;
      }
      if (has(part, "ends")) {
        const e = part.ends;
        if (!isObj(e)) return `The ends of part "${pk}" are an object.`;
        const ef = unknownKey(e, ["onCancel", "lapseDays"]);
        if (ef) return `Unknown field "${ef}" in the ends of part "${pk}".`;
        if (typeof e.onCancel !== "boolean")
          return `The ends of part "${pk}" need onCancel: true or false.`;
        const lapse = num(e.lapseDays);
        if (
          has(e, "lapseDays") &&
          (lapse === null || !whole(lapse) || !between(lapse, 1, 365))
        )
          return `Part "${pk}" needs lapseDays from 1 to 365.`;
      }
      if (
        has(part, "prorateOnCancel") &&
        typeof part.prorateOnCancel !== "boolean"
      )
        return `Part "${pk}" needs prorateOnCancel: true or false.`;
    } else if (kind === "per_above") {
      if (part.measure !== "qualifying_clients")
        return `Part "${pk}" counts an unknown measure.`;
      const over = num(part.over);
      if (over === null || !whole(over) || !between(over, 0, 1000))
        return `Part "${pk}" needs over from 0 to 1,000.`;
      const x = num(part.amount);
      if (x === null || x < 0 || x > 100000)
        return `Part "${pk}" needs an amount from 0 to 100,000.`;
    } else {
      const x = num(part.amount);
      if (x === null || x <= 0 || x > 100000)
        return `Part "${pk}" needs an amount above 0 and up to 100,000.`;
      const days = num(part.days);
      if (days === null || !whole(days) || !between(days, 1, 366))
        return `Part "${pk}" needs days from 1 to 366.`;
      floors += 1;
      if (floors > 1) return "A plan has at most one floor.";
    }
  }

  if (has(plan, "commission")) {
    if (!opts.isRole)
      return "Only a role plan carries commission lines; set a person's lines on the roster.";
    const lines = plan.commission;
    if (!Array.isArray(lines) || lines.length > 2)
      return "A role plan has at most 2 commission lines.";
    const bases = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const li = i + 1;
      if (!isObj(line)) return `Commission line ${li} is not an object.`;
      const lf = unknownKey(line, ["basis", "rate"]);
      if (lf) return `Unknown field "${lf}" in commission line ${li}.`;
      const basis =
        typeof line.basis === "string" && PLAN_BASES.includes(line.basis)
          ? (line.basis as CommissionBasis)
          : null;
      if (!basis) return `Commission line ${li} has an unknown basis.`;
      const rate = num(line.rate);
      if (SHARE_BASES.has(basis)) {
        if (rate === null || !between(rate, 0, 1))
          return `Commission line ${li} needs a rate from 0 to 1.`;
      } else if (rate === null || !between(rate, 0, 100000))
        return `Commission line ${li} needs a rate from 0 to 100,000.`;
      if (bases.has(basis))
        return "The two commission lines need different bases.";
      bases.add(basis);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The band pick

/**
 * A decimal string rounded half away from zero to `dp` places, as Postgres
 * rounds numeric ("9.995" is "10.00", where JavaScript's float rounding says
 * 9.99). Null when the text is not a plain decimal.
 */
export function roundDecimal(text: string, dp = 2): string | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m || `${m[2]}${m[3] ?? ""}` === "") return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const frac = m[3] ?? "";
  let scaled = BigInt(`${m[2] || "0"}${frac.slice(0, dp).padEnd(dp, "0")}`);
  if ((frac[dp] ?? "0") >= "5") scaled += 1n;
  const digits = scaled.toString().padStart(dp + 1, "0");
  const units = digits.slice(0, digits.length - dp);
  const out = dp ? `${units}.${digits.slice(digits.length - dp)}` : units;
  return sign < 0n && scaled !== 0n ? `-${out}` : out;
}

/**
 * The band a value falls in: {index, amount}, or null with no value. The
 * first band with a number upTo and (inclusive ? v <= upTo : v < upTo), else
 * the last band. A number is taken as the server sent it (already rounded to
 * 2 places: never round it again here); a string is an unsaved draft and is
 * rounded half away from zero first, as the server would.
 */
export function pickBand(
  bands: readonly Band[] | null | undefined,
  value: number | string | null | undefined,
): { index: number; amount: number | null } | null {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  let v: number | null;
  if (typeof value === "string") {
    const r = roundDecimal(value, 2);
    v = r === null ? null : Number(r);
  } else v = num(value);
  if (v === null) return null;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i] as Band | undefined;
    const up = num(b?.upTo);
    if (up !== null && (b?.inclusive === true ? v <= up : v < up))
      return { index: i, amount: num(b?.amount) };
  }
  return {
    index: bands.length - 1,
    amount: num(bands[bands.length - 1]?.amount),
  };
}

/**
 * The bands switched to another metric: cost per lead to cost per booking
 * multiplies the edges by CPB_GATE / CPL_GATE (a booking costs about 4 leads
 * at the gates, $60 and $15), the other way divides. Amounts stay. A
 * suggestion only: the CEO checks it before anything is saved. Null between
 * a money metric and a churn metric.
 */
export function suggestBands(
  bands: readonly Band[],
  from: BandMetric,
  to: BandMetric,
): Band[] | null {
  if (from === to) return bands.map(b => ({ ...b }));
  const factor =
    from === "cpl" && to === "cpb"
      ? CPB_GATE / CPL_GATE
      : from === "cpb" && to === "cpl"
        ? CPL_GATE / CPB_GATE
        : null;
  if (factor === null) return null;
  return bands.map(b =>
    b.upTo === null
      ? { ...b }
      : { ...b, upTo: Math.round(b.upTo * factor * 100) / 100 },
  );
}

// ---------------------------------------------------------------------------
// In words

/** "$1,200", "$12.45", "−$250" (typographic minus). */
export function usd(v: number): string {
  const abs = Math.abs(v);
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "−" : ""}$${text}`;
}
/** "4.55%", "5%". */
const pctText = (v: number) =>
  `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
/** A share: 0.1 is "10%", 0.125 "12.5%". */
const rateText = (r: number) =>
  `${(Math.round(r * 10000) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
/** Words that keep their capital inside a sentence: names and acronyms ("Google reviews", "SMM"). */
const KEEPS_CAPITAL =
  /^(?:Google|Meta|Facebook|Instagram|TikTok|YouTube|WhatsApp|Whop|Tap|ClickUp|HighLevel|Zoom|Slack)\b|^[A-Z0-9]{2,}\b/;
/** The first letter lowered for use inside a sentence, unless it starts a name. */
export const lowerFirst = (s: string) =>
  KEEPS_CAPITAL.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
const edgeText = (metric: BandMetric, v: number) =>
  BAND_METRIC[metric].unit === "pct" ? pctText(v) : usd(v);

/**
 * Each band in words, in order: "under $8", "$8 to under $10", "$13 up to
 * $15", "over $15"; a churn band that ends at 0% inclusive is "0%". For the
 * band rows and the ruler's aria-label.
 */
export function bandRanges(
  metric: BandMetric,
  bands: readonly Band[],
): string[] {
  const e = (v: number) => edgeText(metric, v);
  return bands.map((b, i) => {
    const prev = i > 0 ? bands[i - 1] : null;
    const after = prev?.upTo ?? null;
    if (b.upTo === null) {
      if (after === null) return "any value";
      return prev?.inclusive ? `over ${e(after)}` : `${e(after)} or more`;
    }
    if (after === null)
      return b.inclusive
        ? b.upTo === 0
          ? e(0)
          : `up to ${e(b.upTo)}`
        : `under ${e(b.upTo)}`;
    const start = prev?.inclusive ? `over ${e(after)}` : e(after);
    return `${start} ${b.inclusive ? "up to" : "to under"} ${e(b.upTo)}`;
  });
}

/** "pays $400", "pays nothing", "pays −$250". */
const paysText = (amount: number) =>
  amount === 0 ? "pays nothing" : `pays ${usd(amount)}`;

function stepsText(steps: readonly Step[]): string {
  if (steps.length === 1) return rateText(steps[0].rate);
  return steps
    .map((s, i) =>
      i === 0
        ? `${rateText(s.rate)} in month 1`
        : `${rateText(s.rate)} from month ${s.fromMonth}`,
    )
    .join(", ");
}

const eventName = (p: PerEventPart) =>
  p.event === "custom" && p.eventLabel
    ? p.eventLabel
    : (EVENTS[p.event]?.label ?? p.event);

/**
 * One part in a full sentence, for the plan sheet, the receipt and screen
 * readers: "Bonus by cost per lead: under $8 pays $400, $8 to under $10 pays
 * $300, … over $15 pays nothing."
 */
export function partSentence(part: Part): string {
  switch (part.kind) {
    case "band": {
      const ranges = bandRanges(part.metric, part.bands);
      const said = part.bands
        .map((b, i) => `${ranges[i]} ${paysText(b.amount)}`)
        .join(", ");
      const extra: string[] = [];
      if (part.covers === "owned_creative")
        extra.push("Counts only clients whose running creative they own.");
      const g = part.guard;
      if (g) {
        const needs: string[] = [];
        if (g.minClients !== undefined)
          needs.push(
            `${g.minClients} client${g.minClients === 1 ? "" : "s"} or more`,
          );
        if (g.minSpendUsd !== undefined)
          needs.push(
            `each spending ${usd(g.minSpendUsd)} or more in the month`,
          );
        if (needs.length) extra.push(`Needs ${needs.join(", ")}.`);
        if (g.excludeDays)
          extra.push(
            `The first ${g.excludeDays} days after each creative start are left out.`,
          );
      }
      // The metric is named when the label does not already say it.
      const metric = BAND_METRIC[part.metric].label;
      const named = part.label.toLowerCase().includes(metric.toLowerCase());
      return [
        `${part.label}${named ? "" : ` (${lowerFirst(metric)})`}: ${said}.`,
        ...extra,
      ].join(" ");
    }
    case "per_event":
      return part.event === "pif_deal_closed"
        ? `${part.label}: ${usd(part.amount)} for each deal they closed that is paid in full, counted by the cockpit.`
        : `${part.label}: ${usd(part.amount)} for each ${lowerFirst(eventName(part))}, typed by you each month.`;
    case "share": {
      const ends: string[] = [];
      if (part.ends?.onCancel) ends.push("the client cancels");
      if (part.ends?.lapseDays)
        ends.push(`nothing is paid for ${part.ends.lapseDays} days`);
      return [
        `${part.label}: ${stepsText(part.steps)} of ${SHARE_OF_LABEL[part.of]}${part.steps.length > 1 ? " by month of the engagement" : ""}, typed by you each month.`,
        ends.length ? `Ends when ${ends.join(" or ")}.` : null,
        part.prorateOnCancel ? "Pro-rated to a mid-month cancel." : null,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "per_above":
      return `${part.label}: ${usd(part.amount)} for each qualifying client over ${part.over}.`;
    case "floor":
      return `${part.label}: at least ${usd(part.amount)} a month, base included, for the first ${part.days} days from the contract start.`;
  }
}

/** One part in a few words, for a summary line: "bonus by cost per lead, up to $400". */
export function partSummary(part: Part): string {
  const label = lowerFirst(part.label);
  switch (part.kind) {
    case "band": {
      const amounts = part.bands.map(b => b.amount);
      const top = Math.max(...amounts);
      const low = Math.min(...amounts);
      return `${label}, up to ${usd(top)}${low < 0 ? ` (or ${usd(low)})` : ""}`;
    }
    case "per_event":
      return `${label}, ${usd(part.amount)} each`;
    case "share":
      return `${label}, ${part.steps.map(s => rateText(s.rate)).join(" then ")}`;
    case "per_above":
      return `${label}, ${usd(part.amount)} each`;
    case "floor":
      return `${label}, at least ${usd(part.amount)} a month for ${part.days} days`;
  }
}

/** A role plan's commission line in words: "$5 per client appointment that shows up", "10% of cash collected on deals they close". */
export function planCommissionText(line: PlanCommission): string {
  const amount = SHARE_BASES.has(line.basis)
    ? rateText(line.rate)
    : usd(line.rate);
  return `${amount} ${COMMISSION_LABEL[line.basis]}`;
}

/**
 * The whole plan in one line, for a row or a card: "bonus by cost per lead,
 * up to $400"; parts and a role plan's commission joined with " + ".
 * "base only" with nothing on top.
 */
export function planSentence(plan: Plan | null | undefined): string {
  if (!plan) return "base only";
  const said = [
    ...(plan.commission ?? []).map(planCommissionText),
    ...plan.parts.map(partSummary),
  ];
  return said.length ? said.join(" + ") : "base only";
}

// ---------------------------------------------------------------------------
// Which plan a person follows

/** A stored plan row, as cockpit_ceo_pay_plans_list returns it. */
export type PayPlanRow = {
  id: number;
  role: string | null;
  personId: number | null;
  /** The 1st of the month it applies from, YYYY-MM-DD. */
  fromMonth: string;
  /** Null on a person row: they follow the role plan from that month. */
  plan: Plan | null;
  note: string | null;
  setBy: string;
  setAt: string;
};

export type PayPlansList = {
  plans: PayPlanRow[];
  roles: string[];
  people: { id: number; name: string; role: string | null; active: boolean }[];
  /** Each person's latest approved pay month (YYYY-MM-DD). */
  lastApproved: { personId: number; month: string }[];
  /** Plans used by an approved month: replacing one is refused. */
  approvedPlanIds: number[];
};

export type PlanFor = {
  source: "own" | "role" | "none";
  planId: number | null;
  fromMonth: string | null;
  plan: Plan | null;
  role: string | null;
  /** A person row says "follow the role plan". */
  follows: boolean;
};

const roleKey = (r: string | null | undefined) =>
  (r ?? "").trim().toLowerCase();
const monthStart = (m: string) => `${m.slice(0, 7)}-01`;

/**
 * The plan a person follows in a month, as cockpit_pay_plan_for: their own
 * (the latest person row on or before the month with a plan), else their
 * role's (matched on lower(btrim(role))), else none. The browser knows only
 * the role a person has now; the server reads the role they had that month.
 */
export function planFor(
  rows: readonly PayPlanRow[],
  person: { id: number; role: string | null },
  month: string,
): PlanFor {
  const m0 = monthStart(month);
  const latest = (list: PayPlanRow[]) =>
    list
      .filter(r => r.fromMonth.slice(0, 10) <= m0)
      .sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0];
  const role = person.role?.trim() || null;
  const own = latest(rows.filter(r => r.personId === person.id));
  if (own?.plan)
    return {
      source: "own",
      planId: own.id,
      fromMonth: own.fromMonth,
      plan: own.plan,
      role,
      follows: false,
    };
  const follows = Boolean(own);
  const rp = role
    ? latest(
        rows.filter(r => r.role !== null && roleKey(r.role) === roleKey(role)),
      )
    : undefined;
  if (rp?.plan)
    return {
      source: "role",
      planId: rp.id,
      fromMonth: rp.fromMonth,
      plan: rp.plan,
      role: rp.role,
      follows,
    };
  return {
    source: "none",
    planId: null,
    fromMonth: null,
    plan: null,
    role,
    follows,
  };
}

/**
 * Whether a person's commission lines are the role plan's: the same bases at
 * the same rates, in any order, as the pay month compares them. True when
 * the role plan has no commission.
 */
export function commissionMatches(
  planLines: readonly PlanCommission[] | undefined,
  lines: readonly { basis: CommissionBasis; rate: number | null }[],
): boolean {
  const want = (planLines ?? []).map(l => `${l.basis}:${l.rate}`).sort();
  if (!want.length) return true;
  const have = lines
    .filter(l => l.basis !== "none")
    .map(l => `${l.basis}:${l.rate}`)
    .sort();
  return want.length === have.length && want.every((w, i) => w === have[i]);
}

// ---------------------------------------------------------------------------
// The plans seeded on go-live (section 2), from October 2026

/** The six role plans of PAY-PLANS.md section 2, keyed by role. Bases stay as they are. */
export const ROLE_PLANS_2026_10: Readonly<Record<string, Plan>> = {
  "Media buyer": {
    version: 1,
    parts: [
      {
        key: "cpl_bonus",
        kind: "band",
        label: "Bonus by cost per lead",
        metric: "cpl",
        covers: "all_clients",
        bands: [
          { upTo: 8, inclusive: false, amount: 400 },
          { upTo: 10, inclusive: false, amount: 300 },
          { upTo: 13, inclusive: false, amount: 200 },
          { upTo: 15, inclusive: true, amount: 100 },
          { upTo: null, amount: 0 },
        ],
      },
    ],
  },
  "Creative strategist": {
    version: 1,
    parts: [
      {
        key: "churn_bonus",
        kind: "band",
        label: "Bonus by last month's churn",
        metric: "logo_churn_prior",
        bands: [
          { upTo: 5, inclusive: false, amount: 1200 },
          { upTo: 8, inclusive: false, amount: 700 },
          { upTo: 10, inclusive: false, amount: 300 },
          { upTo: 12, inclusive: true, amount: 150 },
          { upTo: null, amount: 0 },
        ],
      },
      {
        key: "cpl_bonus",
        kind: "band",
        label: "Bonus by cost per lead",
        metric: "cpl",
        covers: "owned_creative",
        guard: { minClients: 5, minSpendUsd: 500, excludeDays: 14 },
        bands: [
          { upTo: 10, inclusive: false, amount: 300 },
          { upTo: 13, inclusive: false, amount: 200 },
          { upTo: 15, inclusive: false, amount: 100 },
          { upTo: null, amount: 0 },
        ],
      },
      {
        key: "smm",
        kind: "share",
        label: "Social media management commission",
        of: "smm_revenue",
        steps: [
          { fromMonth: 1, rate: 0 },
          { fromMonth: 2, rate: 0.1 },
          { fromMonth: 7, rate: 0.05 },
        ],
        ends: { onCancel: true },
        prorateOnCancel: true,
      },
    ],
  },
  "Client success manager": {
    version: 1,
    parts: [
      {
        key: "over_20",
        kind: "per_above",
        label: "Per qualifying client over 20",
        measure: "qualifying_clients",
        over: 20,
        amount: 50,
      },
      {
        key: "ramp",
        kind: "floor",
        label: "Ramp guarantee",
        amount: 1200,
        days: 60,
      },
      {
        key: "retention",
        kind: "band",
        label: "Retention bonus by churn",
        metric: "csm_churn",
        bands: [
          { upTo: 0, inclusive: true, amount: 2000 },
          { upTo: 5, inclusive: false, amount: 1500 },
          { upTo: 9, inclusive: false, amount: 1000 },
          { upTo: 11, inclusive: false, amount: 500 },
          { upTo: 13, inclusive: false, amount: 250 },
          { upTo: 15, inclusive: true, amount: 0 },
          { upTo: null, amount: -250 },
        ],
      },
      {
        key: "renewals",
        kind: "per_event",
        label: "Renewals",
        event: "renewal",
        amount: 300,
      },
      {
        key: "reactivations",
        kind: "per_event",
        label: "Reactivations",
        event: "reactivation",
        amount: 300,
      },
      {
        key: "upsells",
        kind: "share",
        label: "Backend upsells",
        of: "upsell_cash",
        steps: [{ fromMonth: 1, rate: 0.1 }],
      },
      {
        key: "recurring",
        kind: "share",
        label: "Recurring services",
        of: "recurring_revenue",
        steps: [
          { fromMonth: 1, rate: 0.2 },
          { fromMonth: 2, rate: 0.05 },
        ],
        ends: { onCancel: true, lapseDays: 30 },
      },
      {
        key: "referrals",
        kind: "per_event",
        label: "Referrals",
        event: "referral",
        amount: 250,
      },
      {
        key: "video_testimonials",
        kind: "per_event",
        label: "Video testimonials",
        event: "video_testimonial",
        amount: 150,
      },
      {
        key: "google_reviews",
        kind: "per_event",
        label: "Google reviews",
        event: "google_review",
        amount: 75,
      },
      {
        key: "podcasts",
        kind: "per_event",
        label: "Podcast case studies",
        event: "podcast_case_study",
        amount: 250,
      },
    ],
  },
  "Systems manager": {
    version: 1,
    parts: [
      {
        key: "systems",
        kind: "per_event",
        label: "Fully built-out systems",
        event: "system_built",
        amount: 200,
      },
      {
        key: "systems_large",
        kind: "per_event",
        label: "Huge built-out systems",
        event: "system_built_large",
        amount: 400,
      },
    ],
  },
  "Call centre agent": {
    version: 1,
    parts: [],
    commission: [
      { basis: "per_client_appt_shown", rate: 5 },
      { basis: "per_client_deal_closed", rate: 20 },
    ],
  },
  Closer: {
    version: 1,
    parts: [
      {
        key: "pif",
        kind: "per_event",
        label: "Paid-in-full bonus",
        event: "pif_deal_closed",
        amount: 250,
      },
    ],
    commission: [
      { basis: "closed_cash", rate: 0.1 },
      { basis: "set_cash", rate: 0.05 },
    ],
  },
};

// ---------------------------------------------------------------------------
// The month, as cockpit_ceo_pay_month returns it (section 6)

export type InputState =
  | "measured"
  | "confirmed"
  | "typed"
  | "missing"
  | "not_met"
  | "waiting";
export type PartState = "known" | "missing" | "not_met" | "waiting";
export type LineState = "measured" | "missing" | "waiting" | "not_here";
export type PayStatus = "in_progress" | "waiting" | "ready" | "approved";

/** A client left out of a pooled figure, and why. */
export type LeftOut = {
  clickupId?: string | null;
  name?: string | null;
  why: string;
};

/** What a part read this month. `value` is already rounded by the server. */
export type PayInput = {
  value: number | null;
  unit: "usd" | "pct" | "count" | "cash";
  state: InputState;
  source: string;
  note?: string | null;
  /** The list behind a measure to confirm: the server's suggestion. */
  proposal?: unknown;
  /** Clients behind a pooled figure (ClickUp ids). */
  clients?: unknown[];
  out?: LeftOut[];
  nonLeadSpendUsd?: number | null;
  /** Deals waiting for the CEO: a paid-in-full between 90 and 99% ({responseId, business, shortUsd, day}). */
  waiting?: unknown[];
  /** A cost-per-lead or cost-per-booking part: the other money metric, tracked and never paid on. */
  alsoTracked?: AlsoTracked | null;
  /** The stored confirmation this input was read from ({lost, activeAtStart, clients}, {clients}, {count}). */
  confirmed?: unknown;
  /** The floor's window. */
  start?: string;
  end?: string;
};

/**
 * The other money metric beside a cost-per-lead or cost-per-booking part
 * (cockpit_pay_band_input): over every client in the month, or over the same
 * clients and guard as the part. Value null with a note when it cannot be
 * worked out (not_met, missing).
 */
export type AlsoTracked = {
  metric: BandMetric;
  over: "every_client" | "same";
  value: number | null;
  state: "measured" | "missing" | "not_met";
  note?: string | null;
};

export type PayPartResult = {
  key: string;
  kind: PartKind | "adjustment";
  label: string;
  input: PayInput | null;
  band: { index: number } | null;
  amountUsd: number | null;
  state: PartState;
  /** Ids behind the amount: clients, entries, deals. */
  evidence: unknown[];
};

export type PayLineResult = {
  line: number;
  basis: string;
  rate: number | null;
  quantity: number | null;
  /** The cash a share line is a share of. */
  baseUsd: number | null;
  amountUsd: number | null;
  state: LineState;
  note: string;
  /** Appointment or deal ids behind the amount. */
  evidence: unknown[];
  /**
   * Closes or deals waiting for the CEO's confirmation: a close
   * {appointmentId, client, meetingAt}, a deal whose setter is not known
   * {responseId, business, state, form, intro}.
   */
  waiting?: unknown[];
  /** Payment ids behind a cash line. */
  payments?: unknown[];
  unmarked?: number;
};

export type PayEntry = {
  id: number;
  partKey: string;
  quantity: number | null;
  cashUsd: number | null;
  amountUsd: number | null;
  engagementMonth: number | null;
  client: string | null;
  product: string | null;
  clearedOn: string | null;
  postedOn: string | null;
  cancelledOn: string | null;
  evidenceRef: string | null;
  evidence: string | null;
  note: string | null;
  fromMonth: string | null;
  enteredBy: string;
  enteredAt: string;
};

export type PayDrift = {
  /** Null while any change is unread: the change since approval is not known, so nothing is pre-filled. */
  deltaUsd: number | null;
  /** A figure approved with an amount cannot be read now (its facts failed): never a change to $0. */
  unread?: boolean;
  changes: {
    what: string;
    kind: "line" | "part" | "base";
    line?: number;
    key?: string;
    frozen: Record<string, unknown>;
    now: Record<string, unknown>;
    /** This figure could not be read now; it is left out of deltaUsd. */
    unread?: boolean;
    items: { added: unknown[]; removed: unknown[] };
  }[];
};

/** The paused days of a pay month, from cockpit_pay_person (both ends inclusive). */
export type PausedBase = {
  days: number;
  /** Days in the month. */
  of: number;
  from: string;
  to: string;
  /** The roster base for the whole month, and the part held back. */
  fullUsd: number;
  heldUsd: number;
};

export type PayPerson = {
  personId: number;
  name: string;
  role: string | null;
  active: boolean;
  endedOn: string | null;
  currency: string;
  base:
    | {
        usd: number;
        amount: number;
        currency: string;
        source: "roster" | "hours_approved";
        /**
         * Days of the month the person was paused, held back from a roster
         * base as the roster and Hours and pay hold them back (an approved
         * Hours and pay figure has already left them out).
         */
        paused?: PausedBase;
      }
    | { usd: null; source: "none"; note: string };
  plan: {
    source: "own" | "role" | "none";
    planId: number | null;
    fromMonth: string | null;
    role: string | null;
    follows: boolean;
  };
  roleCommission:
    | { matches: true }
    | { matches: false; sentence: string; lines: PlanCommission[] }
    | null;
  commission: PayLineResult[];
  parts: PayPartResult[];
  entries: PayEntry[];
  reviewsToCheck: {
    entryId: number;
    postedOn: string;
    checkBy: string;
    due: boolean;
  }[];
  /** Everything settled: base, lines and parts that are known, and what a waiting line or part has settled so far. */
  knownUsd: number;
  /**
   * The least the month can come to: knownUsd with every missing band part at
   * its lowest band (and, while the lines differ from the role plan's, each
   * line at the lower of the two rates). Never above knownUsd.
   */
  lowestUsd: number;
  /** Null until nothing is missing or waiting and the base is known. */
  totalUsd: number | null;
  commissionUsd: number | null;
  partsUsd: number;
  /** Sentences: what is missing or waiting. */
  missing: string[];
  /** Commission bases not worked out here (priced on Costs from the plan). */
  notPriced: string[];
  note: string | null;
  status: PayStatus;
  approval: {
    id: number;
    approvedAt: string;
    approvedBy: string;
    totalUsd: number | null;
    frozen: Record<string, unknown>;
  } | null;
  sinceApproval: PayDrift | null;
  resultHash: string;
};

export type PayMonth = {
  /** The 1st of the month, YYYY-MM-DD. */
  month: string;
  today: string;
  /** Today is on or after the settle day: the month can be approved. */
  closed: boolean;
  settleDay: string;
  /** What the month read (ads, calls, clients, sales), for "Where these numbers come from". */
  facts: Record<string, unknown>;
  people: PayPerson[];
  notOnAPlan: {
    personId: number;
    name: string;
    role: string | null;
    why: string;
  }[];
  notes: string[];
};

/** cockpit_ceo_pay_costs, one approved person-month. */
export type PayCostRow = {
  personId: number;
  /** YYYY-MM. */
  month: string;
  commissionUsd: number | null;
  partsUsd: number;
  notPriced: string[];
};
