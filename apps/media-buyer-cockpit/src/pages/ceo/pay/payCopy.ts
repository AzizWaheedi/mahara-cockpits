import {
  decimal,
  kuwaitDay,
  money,
  NA,
  plural,
  shiftMonth,
  shortDate,
} from "@/components/ceo/format";
import type { StatusTone } from "@/components/ceo/StatusChip";
import {
  COMMISSION_SHORT,
  type CommissionBasis,
  SHARE_BASES,
} from "@/types/ceo/commission";
import {
  BAND_METRIC,
  type Band,
  type BandMetric,
  EVENTS,
  type EventKey,
  lowerFirst,
  type Part,
  type PartKind,
  type PayDrift,
  type PayInput,
  type PayMonth,
  type PayPartResult,
  type PayPerson,
  type PayPlanRow,
  type PayPlansList,
  type Plan,
  type PlanCommission,
  type PlanFor,
  partSummary,
  pickBand,
  planFor,
  planSentence,
  SHARE_OF_LABEL,
  type ShareOf,
  usd,
} from "@/types/ceo/payPlan";

/**
 * The words and small rules the pay screens share (PAY-PLANS.md section 8):
 * months, state chips, how an input reads, which confirmation a part asks
 * for, the band ruler's geometry and the "Add a part" templates. Pure, so
 * scripts/pay-screens.test.tsx checks them without a screen. The server works
 * out every paid amount; nothing here prices pay.
 */

// ---------------------------------------------------------------------------
// Months

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** This Kuwait month, "YYYY-MM". */
export const thisMonth = (now: number = Date.now()) =>
  kuwaitDay(now).slice(0, 7);

/** "October" from "2026-10" or "2026-10-01". */
export function monthName(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS_LONG[m - 1] ?? ym;
}

/** "October 2026". */
export const monthYear = (ym: string) => `${monthName(ym)} ${ym.slice(0, 4)}`;

/** "Oct 2026", for a plan row. */
export const monthShortYear = (ym: string) =>
  `${monthName(ym).slice(0, 3)} ${ym.slice(0, 4)}`;

/** The month after, "YYYY-MM". */
export const nextMonth = (ym: string) => shiftMonth(ym, 1) ?? ym;

/** The month chips on Pay for [month]: this month and `back` before it, newest first. */
export function monthChips(today: string, back = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i <= back; i++) {
    const m = shiftMonth(today.slice(0, 7), -i);
    if (m) out.push(m);
  }
  return out;
}

/** "Earned in October, paid with November's payroll." (decision 9). */
export const payWhen = (ym: string) =>
  `Earned in ${monthName(ym)}, paid with ${monthName(nextMonth(ym))}'s payroll.`;

/**
 * A pay figure as it is paid, to the cent: "$512.50", "$1,500", "−$250".
 * Receipts, totals, the floor and Approve use it; money() rounds anything
 * over $100 to the dollar, which would show $513 for a $512.50 line and an
 * "at least" above the real floor.
 */
export function payUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return usd(Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------------
// Chips and states

export const STATUS_CHIP: Record<
  PayPerson["status"],
  { tone: StatusTone; label: string }
> = {
  in_progress: { tone: "neutral", label: "In progress" },
  waiting: { tone: "warning", label: "Waiting for you" },
  ready: { tone: "good", label: "Ready to approve" },
  approved: { tone: "good", label: "Approved" },
};

/** How an input came to be, in words. */
export const INPUT_STATE: Record<PayInput["state"], string> = {
  measured: "measured",
  confirmed: "confirmed by you",
  typed: "typed by you",
  missing: "missing",
  not_met: "rule not met",
  waiting: "waiting for you",
};

/** A typed part (an entry the CEO types each month), as opposed to a measure. */
export const isTypedPart = (p: Pick<PayPartResult, "kind" | "input">) =>
  (p.kind === "per_event" || p.kind === "share") &&
  p.input?.source === "cockpit_pay_entries";

/** A typed share of money (social media management, upsells, recurring services): typed as cash, not a count. */
export const isCashPart = (p: Pick<PayPartResult, "kind" | "input">) =>
  isTypedPart(p) && (p.kind === "share" || p.input?.unit === "cash");

/**
 * The chip beside a part that is not simply known: "Waiting for your count"
 * for a typed count, "Waiting for the month's cash" for a typed share of
 * money, "Needs your confirmation" for a measure to confirm, "Not paid" when
 * a rule is not met (a real $0, with its reason), and "Waiting for you"
 * while something waits on a decision.
 */
export function partChip(
  p: Pick<PayPartResult, "kind" | "input" | "state">,
): { tone: StatusTone; label: string } | null {
  if (p.state === "known") return null;
  if (p.state === "not_met") return { tone: "neutral", label: "Not paid" };
  if (p.state === "waiting")
    return { tone: "warning", label: "Waiting for you" };
  if (isCashPart(p))
    return { tone: "warning", label: "Waiting for the month's cash" };
  return isTypedPart(p)
    ? { tone: "warning", label: "Waiting for your count" }
    : { tone: "warning", label: "Needs your confirmation" };
}

/**
 * The note under a part: how its input came to be and the server's
 * sentence, without repeating the chip. A typed part still waiting says it
 * in its chip and its button, so it carries no note.
 */
export function partNote(
  p: Pick<PayPartResult, "kind" | "input" | "state">,
): string {
  const input = p.input;
  if (!input) return "";
  if (p.state === "missing" && isTypedPart(p)) return "";
  const what =
    input.value === null
      ? INPUT_STATE[input.state]
      : `${valueText(input.value, input.unit)} · ${INPUT_STATE[input.state]}`;
  const said = [what, input.note].filter(Boolean).join(" · ");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** A value as its unit reads: "$12.45", "4.55%", "18", "$2,000". */
export function valueText(
  v: number | null | undefined,
  unit: PayInput["unit"] | "usd" | "pct",
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (unit === "pct") return `${decimal(v, 2)}%`;
  if (unit === "count") return decimal(v, 0);
  // Money keeps its cents when it has any: a cost per lead of $12.45 is not $12.
  return Math.round(v * 100) % 100 === 0 ? money(v) : usd(v);
}

/** The basis of a commission line in short words; a basis this code does not know is named as such. */
export const basisWords = (basis: string) =>
  (COMMISSION_SHORT as Record<string, string>)[basis] ??
  `Unknown rule: ${basis}`;

/** "$5 × 14", "10% of $8,750": what a measured line multiplied. */
export function lineWorking(line: {
  basis: string;
  rate: number | null;
  quantity: number | null;
  baseUsd: number | null;
}): string | null {
  if (line.rate === null) return null;
  if (SHARE_BASES.has(line.basis as CommissionBasis))
    return line.baseUsd === null
      ? null
      : `${decimal(line.rate * 100, 2)}% of ${payUsd(line.baseUsd)}`;
  return line.quantity === null
    ? null
    : `${usd(line.rate)} × ${decimal(line.quantity, 0)}`;
}

/**
 * A person nothing is worked out for here: every commission line is priced
 * on Costs and there are no parts. Their month is never ready (PAY-PLANS.md
 * section 6), so the chip says so rather than "In progress" for ever.
 */
export const notWorkedOutHere = (
  p: Pick<
    PayPerson,
    "status" | "missing" | "commission" | "parts" | "notPriced"
  >,
) =>
  p.status === "in_progress" &&
  p.missing.length === 0 &&
  p.parts.length === 0 &&
  p.notPriced.length > 0 &&
  p.commission.every(l => l.state === "not_here");

/** The chip on a receipt: its status, or "Not approved here" for a month nothing is worked out for. */
export function statusChip(
  p: Pick<
    PayPerson,
    "status" | "missing" | "commission" | "parts" | "notPriced"
  >,
): { tone: StatusTone; label: string } {
  if (notWorkedOutHere(p))
    return { tone: "neutral", label: "Not approved here" };
  return STATUS_CHIP[p.status];
}

/**
 * Why a person is not in "Approve [month]": waiting for the CEO, still
 * open, or nothing worked out here. Null for the ready and the approved.
 */
export function whyNotApproved(p: PayPerson): string | null {
  if (p.status === "approved" || p.approval !== null) return null;
  if (p.status === "ready" && p.totalUsd !== null) return null;
  if (notWorkedOutHere(p))
    return `${p.plan.source === "none" ? "their commission lines are" : "nothing on their pay plan is"} not worked out here; their base is paid through Hours and pay`;
  const first = p.missing[0];
  if (p.status === "waiting")
    return first ? `waiting for you: ${lowerFirst(first)}` : "waiting for you";
  return first ? `still open: ${lowerFirst(first)}` : "still open";
}

/**
 * The month's headline over everyone: what the complete months come to and
 * the least everyone comes to, and whether the month is still running.
 */
export function monthHeadline(m: Pick<PayMonth, "closed" | "people">): {
  items: { label: string; value: string }[];
  sentence: string | null;
} {
  const people = m.people;
  const complete = people.filter(p => p.totalUsd !== null);
  const known = complete.reduce((s, p) => s + (p.totalUsd ?? 0), 0);
  const floor = people.reduce((s, p) => s + (p.totalUsd ?? p.lowestUsd), 0);
  const all = people.length > 0 && complete.length === people.length;
  if (all)
    return {
      items: [{ label: m.closed ? "Total" : "So far", value: payUsd(known) }],
      sentence: m.closed
        ? null
        : "Everyone's figures are in so far. The month is still running, so they can still move until it is approved.",
    };
  return {
    items: [
      {
        label: `Complete for ${complete.length} of ${people.length}`,
        value: payUsd(known),
      },
      { label: "At least, for everyone", value: payUsd(floor) },
    ],
    sentence: `${plural(complete.length, "person has", "people have")} a complete month, ${payUsd(known)}. The other ${people.length - complete.length} still have something open; with every open part at its worst, everyone comes to at least ${payUsd(floor)}.`,
  };
}

// ---------------------------------------------------------------------------
// Which plan, in words

/** "Media buyer plan · role", "Own plan", "Follows the Media buyer plan", "No pay plan". */
export function planSourceWords(p: Pick<PlanFor, "source" | "role">): string {
  if (p.source === "own") return "Own plan";
  if (p.source === "role") return `${p.role ?? "Role"} plan · role`;
  return "No pay plan";
}

/**
 * The one line under a person's commission on the roster: "Media buyer plan ·
 * role: bonus by cost per lead, up to $400". Base only when there is nothing.
 */
export function personPlanLine(
  plans: PayPlansList,
  person: { id: number; role: string | null },
  month: string,
): { words: string; has: boolean; source: PlanFor["source"] } {
  const pf = planFor(plans.plans, person, `${month.slice(0, 7)}-01`);
  if (!pf.plan) return { words: "Base only", has: false, source: "none" };
  // A person's line never repeats the role plan's commission: those lines sit on the row.
  const parts = pf.plan.parts.map(partSummary);
  return {
    words: `${planSourceWords(pf)}: ${parts.length ? parts.join(" + ") : "the commission lines above, no bonuses"}`,
    has: parts.length > 0,
    source: pf.source,
  };
}

/** The role plan in force for a role in a month (latest row on or before it), or null. */
export function rolePlanRow(
  plans: PayPlansList,
  role: string | null | undefined,
  month: string,
): PayPlanRow | null {
  const key = (role ?? "").trim().toLowerCase();
  if (!key) return null;
  const m0 = `${month.slice(0, 7)}-01`;
  return (
    plans.plans
      .filter(
        r =>
          r.role !== null &&
          r.role.trim().toLowerCase() === key &&
          r.fromMonth.slice(0, 10) <= m0 &&
          r.plan,
      )
      .sort((a, b) => b.fromMonth.localeCompare(a.fromMonth))[0] ?? null
  );
}

/**
 * The commission lines picking a role pre-fills on the roster (decision 3):
 * the role plan's, or null when the role has no plan or the plan has none.
 */
export function rolePrefill(
  plans: PayPlansList | null,
  role: string | null | undefined,
  month: string,
): PlanCommission[] | null {
  if (!plans) return null;
  const row = rolePlanRow(plans, role, month);
  const lines = row?.plan?.commission ?? [];
  return lines.length ? lines : null;
}

/** "Media buyer plan applies: base you type + bonus by cost per lead, up to $400." */
export function addSomeoneLine(
  plans: PayPlansList | null,
  role: string,
  month: string,
): string | null {
  if (!plans || !role.trim()) return null;
  const row = rolePlanRow(plans, role, month);
  if (!row?.plan)
    return `No pay plan for ${role.trim()} yet: pay is the base you type.`;
  const said = planSentence(row.plan);
  return `${row.role} plan applies: base you type${said === "base only" ? "" : ` + ${said}`}.`;
}

// ---------------------------------------------------------------------------
// What a part asks the CEO to confirm (section 4, confirmations)

export type ConfirmKind = "churn" | "owned" | "qualifying" | "ramp";
export type ConfirmTarget = {
  kind: ConfirmKind;
  key: string;
  /** The month the confirmation is stored under, "YYYY-MM". */
  month: string;
  title: string;
};

/** The plan part behind a month's part result, from the stored plan the person follows. */
export function planPartOf(
  plans: PayPlansList | null,
  person: Pick<PayPerson, "plan">,
  key: string,
): Part | null {
  const id = person.plan.planId;
  if (!plans || id === null) return null;
  return (
    plans.plans.find(r => r.id === id)?.plan?.parts.find(p => p.key === key) ??
    null
  );
}

/**
 * The confirmation a part reads, or null when it reads none: churn of the
 * person's book (`csm_churn:<id>`), last month's logo churn (`logo_churn`,
 * stored under the month before), the clients whose creative they own
 * (`owned_creative:<id>`), qualifying clients (`qualifying:<id>`) and the
 * contract start of a ramp guarantee (`ramp_start:<id>`, under its month).
 */
export function confirmFor(
  part: Pick<PayPartResult, "kind" | "input" | "label">,
  personId: number,
  month: string,
  planPart?: Part | null,
): ConfirmTarget | null {
  const ym = month.slice(0, 7);
  const source = part.input?.source ?? "";
  const metric: BandMetric | null =
    planPart?.kind === "band" ? planPart.metric : null;
  if (part.kind === "band") {
    if (source.startsWith("csm_churn:") || metric === "csm_churn")
      return {
        kind: "churn",
        key: `csm_churn:${personId}`,
        month: ym,
        title: `Churn of their clients in ${monthName(ym)}`,
      };
    if (source === "logo_churn" || metric === "logo_churn_prior") {
      const prior = shiftMonth(ym, -1) ?? ym;
      return {
        kind: "churn",
        key: "logo_churn",
        month: prior,
        title: `The company's churn in ${monthName(prior)}`,
      };
    }
    if (
      source.startsWith("owned_creative:") ||
      (planPart?.kind === "band" && planPart.covers === "owned_creative")
    )
      return {
        kind: "owned",
        key: `owned_creative:${personId}`,
        month: ym,
        title: `Clients whose running creative they own in ${monthName(ym)}`,
      };
    return null;
  }
  if (part.kind === "per_above")
    return {
      kind: "qualifying",
      key: `qualifying:${personId}`,
      month: ym,
      title: `Qualifying clients in ${monthName(ym)}`,
    };
  if (part.kind === "floor") {
    const start =
      typeof part.input?.start === "string" ? part.input.start : null;
    return {
      kind: "ramp",
      key: `ramp_start:${personId}`,
      month: start ? start.slice(0, 7) : ym,
      title: "The contract start for the guarantee",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Approved months and drift

/** Who "Approve [month]" sends: everyone ready with a total, with the hash they were shown. */
export function approvable(m: PayMonth | null): PayPerson[] {
  if (!m) return [];
  return m.people.filter(
    p => p.status === "ready" && p.totalUsd !== null && p.approval === null,
  );
}

/** The approve payload: totals and hashes exactly as shown. */
export function approvePayload(m: PayMonth, people: PayPerson[]) {
  return {
    month: m.month.slice(0, 7),
    people: people.map(p => ({
      personId: p.personId,
      totalUsd: p.totalUsd as number,
      resultHash: p.resultHash,
    })),
  };
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** One change since approval in words: "Per client appointment shown 27 → 31 (4 added)". */
function changeWords(c: PayDrift["changes"][number]): string {
  const what =
    c.kind === "line"
      ? basisWords(c.what)
      : c.kind === "base"
        ? "Base"
        : c.what;
  const q0 = num(c.frozen.quantity) ?? num(c.frozen.value);
  const q1 = num(c.now.quantity) ?? num(c.now.value);
  const a0 = num(c.frozen.amountUsd);
  const a1 = num(c.now.amountUsd);
  if (c.unread) return `${what} could not be read (approved at ${payUsd(a0)})`;
  const moved =
    q0 !== null && q1 !== null
      ? `${decimal(q0, 2)} → ${decimal(q1, 2)}`
      : a0 !== null || a1 !== null
        ? `${payUsd(a0)} → ${payUsd(a1)}`
        : "changed";
  const added = c.items?.added?.length ?? 0;
  const removed = c.items?.removed?.length ?? 0;
  const items = [
    added ? `${added} added` : null,
    removed ? `${removed} removed` : null,
  ].filter(Boolean);
  return `${what} ${moved}${items.length ? ` (${items.join(", ")})` : ""}`;
}

/**
 * "Changed since approval: +$20 · Per client appointment shown 27 → 31 (4 added)."
 * With a figure that cannot be read now, the change is not known and is never
 * shown as a clawback.
 */
export function driftSentence(d: PayDrift): string {
  if (d.deltaUsd === null)
    return `Some figures could not be read since approval, so the change is not known: ${d.changes.map(changeWords).join("; ")}. Open the month again once they can be read.`;
  const delta =
    d.deltaUsd === 0
      ? "$0"
      : `${d.deltaUsd > 0 ? "+" : "−"}${payUsd(Math.abs(d.deltaUsd))}`;
  const changes = d.changes.map(changeWords).join("; ");
  return `Changed since approval: ${delta}${changes ? ` · ${changes}` : ""}.`;
}

/** The note an adjustment from drift carries. */
export const driftNote = (d: PayDrift, approvedMonth: string) =>
  `Changed since ${monthName(approvedMonth)}'s approval: ${d.changes.map(changeWords).join("; ") || "figures moved"}.`;

// ---------------------------------------------------------------------------
// Typed entries (section 5.1, cockpit_ceo_pay_entry_save)

/** The events and shares the general conditions govern: client, cleared date in the month and evidence. */
const CONDITION_EVENTS = new Set<EventKey>([
  "renewal",
  "reactivation",
  "referral",
]);
const CONDITION_SHARES = new Set<ShareOf>(["upsell_cash", "recurring_revenue"]);

/** The fields a typed entry needs, by the plan part it is for. */
export type EntryShape = {
  kind: "count" | "cash" | "adjustment";
  /** Client, cleared on and evidence reference are required for a count or cash that is not 0. */
  conditions: boolean;
  /**
   * The client is required whatever the amount: a share that ends (on a
   * cancel or a lapse) is matched by client, as cockpit_ceo_pay_entry_save
   * checks it.
   */
  client: boolean;
  /** A Google review: a link and the posted day. */
  review: boolean;
  /** A share with more than one step: which month of the engagement. */
  engagement: boolean;
  /** A share that ends on a cancel: the cancel day. */
  cancel: boolean;
  /** A share: the product. */
  product: boolean;
};

export function entryShape(part: Part | "adjustment" | null): EntryShape {
  const none = {
    conditions: false,
    client: false,
    review: false,
    engagement: false,
    cancel: false,
    product: false,
  };
  if (part === "adjustment" || part === null)
    return { kind: "adjustment", ...none };
  if (part.kind === "share")
    return {
      kind: "cash",
      ...none,
      conditions: CONDITION_SHARES.has(part.of),
      client: Boolean(part.ends),
      engagement: part.steps.length > 1,
      cancel: Boolean(part.ends?.onCancel || part.prorateOnCancel),
      product: true,
    };
  if (part.kind === "per_event")
    return {
      kind: "count",
      ...none,
      conditions: CONDITION_EVENTS.has(part.event),
      review: part.event === "google_review",
    };
  return { kind: "count", ...none };
}

/** The sentence a receipt carries when it has a part the general conditions govern. */
export const CONDITIONS_SENTENCE =
  "Renewals, reactivations, upsells, recurring services and referrals count only with a signed agreement or a payment recorded in the CRM, in the month the payment cleared.";

/** Whether a person's plan has a part the general conditions govern. */
export function hasConditionParts(parts: (Part | null)[]): boolean {
  return parts.some(p => {
    if (!p) return false;
    const s = entryShape(p);
    return s.conditions;
  });
}

// ---------------------------------------------------------------------------
// "Add a part": templates, grouped by kind

/** A part before it has a key: each kind keeps its own fields. */
export type NewPart = Part extends infer P
  ? P extends Part
    ? Omit<P, "key">
    : never
  : never;

export type PartTemplate = {
  id: string;
  group: string;
  label: string;
  make: () => NewPart;
};

const band = (metric: BandMetric, label: string, bands: Band[]): NewPart => ({
  kind: "band",
  label,
  metric,
  bands,
});
const perEvent = (event: EventKey, label: string, amount: number) =>
  ({ kind: "per_event", label, event, amount }) as NewPart;
const share = (of: ShareOf, label: string) =>
  ({
    kind: "share",
    label,
    of,
    steps: [{ fromMonth: 1, rate: 0.1 }],
  }) as NewPart;

const EVENT_PLURAL: Record<EventKey, string> = {
  renewal: "Renewals",
  reactivation: "Reactivations",
  referral: "Referrals",
  video_testimonial: "Video testimonials",
  google_review: "Google reviews",
  podcast_case_study: "Podcast case studies",
  system_built: "Fully built-out systems",
  system_built_large: "Huge built-out systems",
  custom: "Something else you count",
  pif_deal_closed: "Paid-in-full bonus",
};

export const PART_TEMPLATES: PartTemplate[] = [
  {
    id: "band:cpl",
    group: "A bonus by band",
    label: "Bonus by cost per lead",
    make: () =>
      band("cpl", "Bonus by cost per lead", [
        { upTo: 10, inclusive: false, amount: 200 },
        { upTo: 15, inclusive: true, amount: 100 },
        { upTo: null, amount: 0 },
      ]),
  },
  {
    id: "band:cpb",
    group: "A bonus by band",
    label: "Bonus by cost per booking",
    make: () =>
      band("cpb", "Bonus by cost per booking", [
        { upTo: 40, inclusive: false, amount: 200 },
        { upTo: 60, inclusive: true, amount: 100 },
        { upTo: null, amount: 0 },
      ]),
  },
  {
    id: "band:csm_churn",
    group: "A bonus by band",
    label: "Bonus by churn of their clients",
    make: () =>
      band("csm_churn", "Retention bonus by churn", [
        { upTo: 5, inclusive: false, amount: 500 },
        { upTo: null, amount: 0 },
      ]),
  },
  {
    id: "band:logo_churn_prior",
    group: "A bonus by band",
    label: "Bonus by last month's churn",
    make: () =>
      band("logo_churn_prior", "Bonus by last month's churn", [
        { upTo: 5, inclusive: false, amount: 500 },
        { upTo: null, amount: 0 },
      ]),
  },
  ...(
    [
      "renewal",
      "reactivation",
      "referral",
      "video_testimonial",
      "google_review",
      "podcast_case_study",
      "system_built",
      "system_built_large",
      "custom",
    ] as EventKey[]
  ).map(e => ({
    id: `per_event:${e}`,
    group: "An amount per event, typed by you",
    label: EVENT_PLURAL[e],
    make: () =>
      e === "custom"
        ? ({
            kind: "per_event",
            label: "Something else",
            event: "custom",
            eventLabel: "Thing counted",
            amount: 100,
          } as NewPart)
        : perEvent(e, EVENT_PLURAL[e], 100),
  })),
  {
    id: "per_event:pif_deal_closed",
    group: "An amount per event, counted by the cockpit",
    label: EVENTS.pif_deal_closed.label,
    make: () => perEvent("pif_deal_closed", "Paid-in-full bonus", 250),
  },
  ...(
    ["upsell_cash", "recurring_revenue", "smm_revenue", "custom_cash"] as const
  ).map(of => ({
    id: `share:${of}`,
    group: "A share of money",
    label: `A share of ${SHARE_OF_LABEL[of]}`,
    make: () =>
      share(
        of,
        of === "upsell_cash"
          ? "Backend upsells"
          : of === "recurring_revenue"
            ? "Recurring services"
            : of === "smm_revenue"
              ? "Social media management commission"
              : "A share of cash",
      ),
  })),
  {
    id: "per_above:qualifying_clients",
    group: "An amount per client over a line",
    label: "Per qualifying client over a line",
    make: () =>
      ({
        kind: "per_above",
        label: "Per qualifying client over 20",
        measure: "qualifying_clients",
        over: 20,
        amount: 50,
      }) as NewPart,
  },
  {
    id: "floor",
    group: "A floor until a date",
    label: "A guarantee for the first days",
    make: () =>
      ({
        kind: "floor",
        label: "Ramp guarantee",
        amount: 1200,
        days: 60,
      }) as NewPart,
  },
];

/** A key for a new part, unique in the plan: "cpl_bonus", "renewals_2". */
export function uniqueKey(part: NewPart, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem =
    part.kind === "band"
      ? `${part.metric}_bonus`
      : part.kind === "per_event"
        ? part.event === "pif_deal_closed"
          ? "pif"
          : `${part.event}s`
        : part.kind === "share"
          ? part.of.replace(/_(cash|revenue)$/, "")
          : part.kind === "per_above"
            ? "over_line"
            : "floor";
  const base = stem.replace(/[^a-z0-9_]/g, "_").slice(0, 36) || "part";
  if (!used.has(base) && base !== "adjustment") return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}_${i}`;
    if (!used.has(k)) return k;
  }
  return `${base}_${Date.now() % 1000}`;
}

/** A plan without the role-only commission, for a person's own plan. */
export const ownCopy = (plan: Plan | null | undefined): Plan => ({
  version: 1,
  parts: structuredClone(plan?.parts ?? []),
});

/** Which kinds read a confirmation every month (for the sheet's notes). */
export const KIND_NOTE: Partial<Record<PartKind, string>> = {
  per_above:
    "Qualifying means active and paid up for the last 30 days. You confirm the count on the month; the data's upper bound is offered.",
  floor:
    "Tops pay up to the amount, base included, for the days from the contract start. You type the start once, on the month.",
};

// ---------------------------------------------------------------------------
// Cost per lead and cost per booking side by side

/**
 * The other money metric beside a band part, for "Also tracked": over every
 * client (the facts' pooled figure, which is what an every-client part with
 * no guard reads), or over the same clients and guard as the part, one value
 * per person shown.
 */
export type AlsoLine = {
  metric: BandMetric;
  /** "YYYY-MM". */
  month: string;
  /** every_client: the pooled figure; same: the part's own clients and guard; every_client_only: the pooled figure beside a part that counts fewer clients. */
  over: "every_client" | "same" | "every_client_only";
  values: { who: string | null; value: number | null; note?: string | null }[];
};

/** "Also tracked: cost per booking $103 in October, not paid on." and its scoped forms. */
export function alsoSentence(a: AlsoLine): string {
  const name = BAND_METRIC[a.metric].label.toLowerCase();
  const month = monthName(a.month);
  const one = a.values.length === 1 && !a.values[0].who ? a.values[0] : null;
  if (a.over === "every_client" && one)
    return `Also tracked: ${name} ${valueText(one.value, "usd")} in ${month}, not paid on.`;
  if (a.over === "every_client_only" && one)
    return `Also tracked: ${name} ${valueText(one.value, "usd")} in ${month} over every client, not only the clients this part counts; not paid on.`;
  if (one)
    return one.value === null
      ? `Also tracked: ${name} over the same clients and guard in ${month}: not worked out${one.note ? ` (${one.note.replace(/\.$/, "")})` : ""}. Not paid on.`
      : `Also tracked: ${name} ${valueText(one.value, "usd")} in ${month} over the same clients and guard, not paid on.`;
  const each = a.values
    .map(v => `${v.who ?? "this part"} ${valueText(v.value, "usd")}`)
    .join(", ");
  return `Also tracked: ${name} in ${month} over the same clients and guard: ${each}. Not paid on.`;
}

/**
 * The receipt's name after a switch between cost per lead and cost per
 * booking: the old metric's name in the label becomes the new one's ("Bonus
 * by cost per lead" → "Bonus by cost per booking"); a label that does not
 * name it is kept as typed.
 */
export function renameForMetric(
  label: string,
  from: BandMetric,
  to: BandMetric,
): string {
  const old = BAND_METRIC[from].label.toLowerCase();
  const next = BAND_METRIC[to].label.toLowerCase();
  const at = label.toLowerCase().indexOf(old);
  if (at < 0) return label;
  const cased = at === 0 ? next.charAt(0).toUpperCase() + next.slice(1) : next;
  return label.slice(0, at) + cased + label.slice(at + old.length);
}

/** The money metric a band part's name says, when it says the other one: "Bonus by cost per lead" paid on cost per booking. */
export function labelNamesOther(
  part: Pick<Part, "kind" | "label"> & { metric?: BandMetric },
): BandMetric | null {
  if (part.kind !== "band" || !part.metric) return null;
  const said = part.label.toLowerCase();
  const names = (m: BandMetric) =>
    said.includes(BAND_METRIC[m].label.toLowerCase()) ||
    new RegExp(`\\b${m}\\b`).test(said);
  if (part.metric === "cpb" && names("cpl") && !names("cpb")) return "cpl";
  if (part.metric === "cpl" && names("cpb") && !names("cpl")) return "cpb";
  return null;
}

// ---------------------------------------------------------------------------
// The band ruler's geometry (BandRuler.tsx draws it)

export type RulerSegment = {
  index: number;
  /** Where the band starts and ends on the metric (the last runs to `top`). */
  lo: number;
  hi: number;
  open: boolean;
  /** Share of the track, 0..1. */
  start: number;
  width: number;
  amount: number;
};
export type RulerEdge = { at: number; value: number; inclusive: boolean };

/** The smallest share of the track a band takes, so "0%" and narrow bands stay visible. */
const MIN_SHARE = 0.07;

/**
 * Lays the bands on a track from 0: each band's width is its share of the
 * metric's range, with a floor so a zero-width band (churn "0%") still
 * shows; the open last band runs a third past the last edge, further when a
 * value sits beyond it. A value is placed inside the band pickBand puts it
 * in, so the tick and the payout always agree.
 */
export function rulerLayout(
  bands: readonly Band[],
  values: readonly number[] = [],
): {
  segments: RulerSegment[];
  edges: RulerEdge[];
  top: number;
  at: (v: number) => number;
} {
  const edgesRaw = bands
    .slice(0, -1)
    .map(b => (typeof b.upTo === "number" ? b.upTo : 0));
  const last = edgesRaw.length ? Math.max(...edgesRaw) : 1;
  const span = Math.max(last, 1e-9);
  const beyond = values
    .filter(v => Number.isFinite(v))
    .reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);
  const top = Math.max(
    last + span / 3,
    beyond > last ? beyond + span / 10 : Number.NEGATIVE_INFINITY,
  );
  const lows = bands.map((_, i) => (i === 0 ? 0 : (edgesRaw[i - 1] ?? 0)));
  const highs = bands.map((_, i) =>
    i < bands.length - 1 ? (edgesRaw[i] ?? 0) : top,
  );
  const raw = bands.map((_, i) => Math.max(0, highs[i] - lows[i]));
  const total = raw.reduce((s, x) => s + x, 0) || 1;
  // Floor the narrow bands, then share what is left among the rest.
  let share = raw.map(x => x / total);
  for (let pass = 0; pass < 3; pass++) {
    const small = share.map(s => s < MIN_SHARE);
    const fixed = small.filter(Boolean).length * MIN_SHARE;
    const restRaw = raw.reduce((s, x, i) => s + (small[i] ? 0 : x), 0) || 1;
    share = raw.map((x, i) =>
      small[i] ? MIN_SHARE : ((1 - fixed) * x) / restRaw,
    );
    if (!share.some((s, i) => !small[i] && s < MIN_SHARE)) break;
  }
  let start = 0;
  const segments: RulerSegment[] = bands.map((b, i) => {
    const seg = {
      index: i,
      lo: lows[i],
      hi: highs[i],
      open: i === bands.length - 1,
      start,
      width: share[i],
      amount: b.amount,
    };
    start += share[i];
    return seg;
  });
  const edges: RulerEdge[] = bands.slice(0, -1).map((b, i) => ({
    at: segments[i].start + segments[i].width,
    value: edgesRaw[i],
    inclusive: b.inclusive === true,
  }));
  const at = (v: number) => {
    const pick = pickBand(bands, v);
    const seg = segments[pick?.index ?? 0];
    if (!seg) return 0;
    const f =
      seg.hi === seg.lo
        ? 0.5
        : Math.min(1, Math.max(0, (v - seg.lo) / (seg.hi - seg.lo)));
    return seg.start + f * seg.width;
  };
  return { segments, edges, top, at };
}

/** An edge on the ruler: "$8", "4.5%". */
export const edgeLabel = (metric: BandMetric, v: number) =>
  BAND_METRIC[metric].unit === "pct" ? `${decimal(v, 2)}%` : usd(v);

/** A payout on the ruler: "$400", "nothing", "−$250". */
export const payoutLabel = (amount: number) =>
  amount === 0 ? "nothing" : usd(amount);

/**
 * The base line's note on a receipt: where the base comes from, the days a
 * paused person's base is held back for (as the roster and Hours and pay
 * hold them back), and a base in another currency.
 */
export function baseNote(base: PayPerson["base"]): string {
  if (base.usd === null) return base.note;
  const cur =
    base.currency !== "USD"
      ? `, ${base.currency} ${base.amount.toLocaleString("en-US")} at the cockpit's rate`
      : "";
  const p = base.paused;
  if (!p)
    return `${base.source === "hours_approved" ? "Approved on Hours and pay" : "From the roster"}${cur}`;
  const span =
    p.from === p.to
      ? shortDate(p.from)
      : `${shortDate(p.from)} to ${shortDate(p.to)}`;
  if (p.days >= p.of)
    return `Paused ${span}: the ${payUsd(p.fullUsd)} roster base is held back`;
  return `From the roster, less ${p.days} of ${p.of} days paused (${span}): ${payUsd(p.heldUsd)} of ${payUsd(p.fullUsd)} held back${cur}`;
}

/** A day, as the receipts print it: "7 Oct". */
export const dayText = (d: string | null | undefined) =>
  d ? shortDate(d.slice(0, 10)) : "n/a";
