/**
 * The churn tracker's rules, in one place (no Convex imports: the page uses
 * them too). They are mahara-context's churn tracker
 * (skills/meta/clickup-board-design/references/churn-tracker-build.md) and
 * the churn definition in the CSM contract
 * (skills/meta/comp-structure-design/references/churn-and-billing-timelines.md):
 *
 * - Churn is a client lost mid-programme, before day 90 from launch. A
 *   client who completes the term is never churn, renewed or not; that is
 *   the renewal line, so one client leaving is never counted twice.
 * - Per month: active at the start (typed, or carried from the month before)
 *   and new clients are typed; churned and completed come from the register;
 *   active at the end = start + new - churned - completed; churn rate =
 *   churned / start; the rolling three months is the number to manage
 *   against, because at 17 clients one departure is 5.9%.
 * - bandOf below grades a rate for the tracker; it is not pay. The CSM's
 *   retention bonus reads its own bands (src/lib/csmMoney.ts CHURN_BANDS,
 *   docs/pay/PAY-PLANS.md decision 4), where a band runs until the next one
 *   starts: 4.55% pays $1,500 there while bandOf, edge-inclusive at 4, calls
 *   it Good.
 */

export const PROGRAMME_DAYS = 90;
export const TARGET_PCT = 10;

/** Why a client left: the ClickUp card's "❌ Churn Reason" options, plus Other. */
export const REASONS = [
  "Cancelled",
  "Refund",
  "Chargeback",
  "Non-payment 14+ days",
  "Paused past 14 days",
  "Ghosted",
  "Completed term, did not renew",
  "Other",
] as const;
export type Reason = (typeof REASONS)[number];

export type Departure = {
  id: number;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string | null;
  reason: Reason;
  mrrLostUsd: number | null;
  csm: string | null;
  note: string | null;
  source: "cockpit" | "sheet";
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  /** The confirm's columns; absent on a read from before 20261101o. */
  confirm?: DepartureConfirm;
};

export type CountsAs = "churn" | "completed" | "unknown";

const DAY_MS = 86_400_000;

/** Days from launch to the day they left; null without a launch date. */
export function daysIn(d: {
  leftOn: string;
  launchedOn: string | null;
}): number | null {
  if (!d.launchedOn) return null;
  return Math.round(
    (Date.parse(`${d.leftOn}T00:00:00Z`) -
      Date.parse(`${d.launchedOn}T00:00:00Z`)) /
      DAY_MS,
  );
}

/** Before day 90 is churn; day 90 or later finished the term. */
export function countsAs(d: {
  leftOn: string;
  launchedOn: string | null;
}): CountsAs {
  const n = daysIn(d);
  if (n === null) return "unknown";
  return n < PROGRAMME_DAYS ? "churn" : "completed";
}

export const monthOf = (day: string) => day.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** "October 2026" from "2026-10". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${
    [
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
    ][m - 1]
  } ${y}`;
}

export type Band = {
  label: "Excellent" | "Good" | "On target" | "Watch" | "Bad" | "Critical";
  tone: "good" | "warn" | "bad";
};

/**
 * The tracker's grade of a rate, each edge included: 0-4 Excellent, 5-8 Good,
 * 9-10 On target, 11-12 Watch, 13-15 Bad, over 15 Critical. Pay does not read
 * this; the retention bonus picks from csmMoney.ts CHURN_BANDS.
 */
export function bandOf(pct: number): Band {
  if (pct <= 4) return { label: "Excellent", tone: "good" };
  if (pct <= 8) return { label: "Good", tone: "good" };
  if (pct <= 10) return { label: "On target", tone: "good" };
  if (pct <= 12) return { label: "Watch", tone: "warn" };
  if (pct <= 15) return { label: "Bad", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

export type MonthInput = {
  month: string;
  activeAtStart: number | null;
  newClients: number | null;
  lostBeforeRegister: number | null;
  note: string | null;
};

export type MonthRow = {
  month: string;
  activeAtStart: number | null;
  /** The start came from the month before, not typed. */
  startCarried: boolean;
  newClients: number | null;
  churned: number;
  completed: number;
  /** Departures with no launch date: not counted until one is given. */
  unknown: number;
  /** The old sheet's count, for a month before the register. */
  lostBeforeRegister: number | null;
  activeAtEnd: number | null;
  churnPct: number | null;
  retentionPct: number | null;
  netGrowth: number | null;
  rolling3Pct: number | null;
  /** How many of the three months had a start figure, so the rate could count them. */
  rolling3Months: number;
  /** The month is `through` and still running: its figures are to date. */
  running: boolean;
  /**
   * The old sheet counted more lost clients than the register holds for a
   * month the register only partly covers: departures not logged yet.
   */
  registerShort: number;
  band: Band | null;
  note: string | null;
  /** Anything typed or logged: a month with nothing is left out of the list. */
  hasData: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Every month from the first one with anything in it to `through`, oldest
 * first. A blank start is carried from the month before when that month's
 * end is known; a month only the old sheet covered counts its lost clients
 * as churned, as the sheet did.
 */
export function rollUp(
  inputs: MonthInput[],
  departures: Pick<Departure, "leftOn" | "launchedOn">[],
  through: string,
): MonthRow[] {
  const byMonth = new Map(inputs.map(i => [i.month, i]));
  const months = [
    ...inputs.map(i => i.month),
    ...departures.map(d => monthOf(d.leftOn)),
    through,
  ].sort();
  const first = months[0];
  const out: MonthRow[] = [];
  let prevEnd: number | null = null;
  for (let m = first; m <= through; m = addMonths(m, 1)) {
    const input = byMonth.get(m);
    const mine = departures.filter(d => monthOf(d.leftOn) === m);
    const register = {
      churn: mine.filter(d => countsAs(d) === "churn").length,
      completed: mine.filter(d => countsAs(d) === "completed").length,
      unknown: mine.filter(d => countsAs(d) === "unknown").length,
    };
    // The old sheet's count stands only for a month the register does not
    // cover: once a departure is logged for it, the register is the count,
    // so one client is never counted from both.
    const lostBefore = mine.length ? null : (input?.lostBeforeRegister ?? null);
    const churned = register.churn + (lostBefore ?? 0);
    // The register still wins, but a shortfall against the sheet is shown,
    // never silently dropped.
    const sheetLost = input?.lostBeforeRegister ?? null;
    const registerShort =
      mine.length && sheetLost !== null && sheetLost > register.churn
        ? sheetLost - register.churn
        : 0;
    const typedStart = input?.activeAtStart ?? null;
    const start: number | null = typedStart ?? prevEnd;
    const fresh = input?.newClients ?? null;
    const end: number | null =
      start === null || fresh === null
        ? null
        : start + fresh - churned - register.completed;
    const churnPct = start ? round1((churned / start) * 100) : null;
    out.push({
      month: m,
      activeAtStart: start,
      startCarried: typedStart === null && start !== null,
      newClients: fresh,
      churned,
      completed: register.completed,
      unknown: register.unknown,
      lostBeforeRegister: lostBefore,
      activeAtEnd: end,
      churnPct,
      retentionPct: churnPct === null ? null : round1(100 - churnPct),
      netGrowth: fresh === null ? null : fresh - churned - register.completed,
      rolling3Pct: null,
      rolling3Months: 0,
      running: m === through,
      registerShort,
      band: null,
      note: input?.note ?? null,
      hasData: Boolean(input) || mine.length > 0 || m === through,
    });
    prevEnd = end;
  }
  // The rolling three months: churned over starts, across the months with a start.
  for (let i = 0; i < out.length; i++) {
    const window = out
      .slice(Math.max(0, i - 2), i + 1)
      .filter(r => r.activeAtStart);
    const starts = window.reduce((s, r) => s + (r.activeAtStart ?? 0), 0);
    const lost = window.reduce((s, r) => s + r.churned, 0);
    out[i].rolling3Pct = starts ? round1((lost / starts) * 100) : null;
    out[i].rolling3Months = window.length;
    out[i].band =
      out[i].rolling3Pct === null ? null : bandOf(out[i].rolling3Pct as number);
  }
  return out;
}

/** "Day 47: churn" style line for a departure, in plain words. */
export function verdictLine(d: {
  leftOn: string;
  launchedOn: string | null;
}): string {
  const n = daysIn(d);
  if (n === null) return "Needs a launch date before it counts either way";
  return n < PROGRAMME_DAYS
    ? `Day ${n} of ${PROGRAMME_DAYS}: counts as churn in ${monthName(monthOf(d.leftOn))}`
    : `Day ${n}: finished the term, not churn`;
}

/** What a typed departure must hold before it is saved. */
export function departureProblem(d: {
  client: string;
  leftOn: string;
  launchedOn: string | null;
  reason: string;
  mrrLostUsd: number | null;
}): string | null {
  if (!d.client.trim()) return "Name the client.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.leftOn)) return "Give the day they left.";
  if (d.launchedOn && !/^\d{4}-\d{2}-\d{2}$/.test(d.launchedOn))
    return "The launch date is not a date.";
  if (d.launchedOn && d.launchedOn > d.leftOn)
    return "The launch date is after the day they left.";
  if (!(REASONS as readonly string[]).includes(d.reason))
    return "Pick why they left.";
  if (
    d.mrrLostUsd !== null &&
    (!Number.isFinite(d.mrrLostUsd) || d.mrrLostUsd < 0)
  )
    return "MRR lost is a dollar amount, 0 or more.";
  return null;
}

// --- The confirm (docs/forms/WAVE12-CONTRACT.md 4.5, 5.5) ------------------------------------

/** The card's Churn Type, as the confirm records it. */
export type ChurnType = "mid_programme" | "completed";
export type SurveyState = "not_sent" | "sent" | "filled" | "declined";

/** What a register row knows about its confirm (20261101o). Null: nobody holds it. */
export type DepartureConfirm = {
  noticeOn: string | null;
  surveyState: SurveyState | null;
  surveyResponseId: string | null;
  whyDetail: string | null;
  howToStop: string | null;
  churnType: ChurnType | null;
  /** The confirm's time; null while the row is logged, not confirmed. */
  confirmedAt: string | null;
  /** "the CSM", "the CEO": never an address. */
  confirmedRole: string | null;
  /** The card write's queue state: held, queued, sending, retry, delivered, skipped, failed, unknown, none. */
  cardState: string | null;
  cardError: string | null;
  /** The day-90 rule's answer for this row (cockpit_churn_type_default). */
  typeDefault: ChurnType | null;
};

export const CHURN_TYPE_WORDS: Record<ChurnType, string> = {
  mid_programme: "Counts as churn",
  completed: "Finished the term",
};

/** The Kuwait day (YYYY-MM-DD) of a timestamp; Kuwait has no daylight saving. */
export function kuwaitIsoDay(at: string | null | undefined): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t))
    return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : null;
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The register's status line (5.5): "Confirmed {day} · {role}" with a teal
 * ring, or "Logged, not confirmed" in amber. `day` is "1 Nov" style.
 */
export function confirmLine(
  c: Pick<DepartureConfirm, "confirmedAt" | "confirmedRole">,
  dayWords: (iso: string) => string,
): { confirmed: boolean; line: string } {
  const day = kuwaitIsoDay(c.confirmedAt);
  if (!day) return { confirmed: false, line: "Logged, not confirmed" };
  return {
    confirmed: true,
    line: `Confirmed ${dayWords(day)}${c.confirmedRole ? ` · ${c.confirmedRole}` : ""}`,
  };
}

export type CardTone = "good" | "warn" | "bad" | "neutral";

/**
 * Where the confirm stands on the ClickUp card, in the FormSheet trail's
 * words (5.1): `line` is the full sentence, `short` fits a register row.
 */
export function cardLine(
  state: string | null | undefined,
  error?: string | null,
): { tone: CardTone; line: string; short: string } | null {
  const say = (tone: CardTone, line: string, short = line) => ({
    tone,
    line,
    short,
  });
  switch (state) {
    case null:
    case undefined:
    case "":
      return null;
    case "none":
      return say("neutral", "Nothing to write on the card");
    case "held":
    case "dry_run":
      return say(
        "warn",
        "Held: card writes for churn are off. When the CEO turns them on, this edit is reviewed and sent or closed.",
        "Held: card writes for churn are off",
      );
    case "queued":
      return say("warn", "Queued for the ClickUp card");
    case "sending":
    case "retry":
    case "unknown":
      return say("warn", "Waiting for ClickUp to confirm");
    case "delivered":
      return say("good", "Card shows it");
    case "skipped":
      return /voided|closed/i.test(error ?? "")
        ? say("neutral", `Closed: ${error}`, "Closed in the cockpit")
        : say(
            "neutral",
            "ClickUp already showed this, so nothing was written.",
            "Card already showed it",
          );
    case "failed":
      return say(
        "bad",
        `ClickUp refused it${error ? `: ${error}` : ""}. It stays in the cockpit; tell the systems manager.`,
        "ClickUp refused it",
      );
    default:
      return say("neutral", `Card: ${state}`);
  }
}

/**
 * The tracker counts by the day-90 rule (it feeds pay); a confirmed type that
 * reads otherwise is said beside the row, never silently counted.
 */
export function typeNote(d: {
  leftOn: string;
  launchedOn: string | null;
  churnType: ChurnType | null;
}): string | null {
  if (!d.churnType) return null;
  const rule = countsAs(d);
  if (rule === "unknown") return null;
  if (rule === "churn" && d.churnType === "completed")
    return "Confirmed as a finished term; the day-90 rule still counts it as churn here.";
  if (rule === "completed" && d.churnType === "mid_programme")
    return "Confirmed as churn on the card; the day-90 rule counts it as a finished term here, and pay reads that.";
  return null;
}

/** The "Not leaving" note, checked as cockpit_form_notice_answer checks it. */
export function answerProblem(note: string): string | null {
  return note.trim().replace(/\s+/g, " ").length < 4
    ? "Say what the client said, so the answer reads back."
    : null;
}

/** The exit survey's state, in words. */
export const SURVEY_WORDS: Record<SurveyState, string> = {
  not_sent: "Exit survey not sent",
  sent: "Exit survey sent",
  filled: "Exit survey filled",
  declined: "Exit survey declined",
};

/** One prefilled answer and where it came from, shown as "{value} · from {source}" (FormSheet). */
export type PrefillLine = { key: string; value: unknown; source: string };

/**
 * The confirm's answers the tracker already holds, for FormSheet: the
 * register row, the termination survey or the card. The server's prefill
 * (cockpit_form_prefill) wins key by key when it is open; this fills the
 * rest, and leaves out what nobody holds rather than guessing it.
 */
export function confirmPrefill(x: {
  leftOn?: string | null;
  leftOnFrom?: "register" | "card";
  reason?: string | null;
  mrrLostUsd?: number | null;
  mrrFrom?: "register" | "card";
  churnType?: ChurnType | null;
  typeDefault?: ChurnType | null;
  survey?: { noticeOn: string | null; dayWords: string } | null;
}): PrefillLine[] {
  const out: PrefillLine[] = [];
  const from = (f?: "register" | "card") =>
    f === "card" ? "the ClickUp card" : "the churn register";
  if (x.leftOn)
    out.push({ key: "leftOn", value: x.leftOn, source: from(x.leftOnFrom) });
  if (x.survey?.noticeOn)
    out.push({
      key: "noticeOn",
      value: x.survey.noticeOn,
      source: `the termination survey, ${x.survey.dayWords}`,
    });
  if (x.survey)
    out.push({
      key: "surveyState",
      value: "filled",
      source: `the termination survey, ${x.survey.dayWords}`,
    });
  if (x.reason && (REASONS as readonly string[]).includes(x.reason))
    out.push({ key: "reason", value: x.reason, source: "the churn register" });
  if (x.churnType)
    out.push({
      key: "churnType",
      value: x.churnType,
      source: "the churn register",
    });
  else if (x.typeDefault)
    out.push({
      key: "churnType",
      value: x.typeDefault,
      source: "the day-90 rule",
    });
  if (
    x.mrrLostUsd !== null &&
    x.mrrLostUsd !== undefined &&
    Number.isFinite(x.mrrLostUsd)
  )
    out.push({
      key: "mrrLostUsd",
      value: x.mrrLostUsd,
      source: from(x.mrrFrom),
    });
  return out;
}

/** Server rows first, then the tracker's own for the keys the server left out. */
export function mergePrefill(
  server: PrefillLine[],
  local: PrefillLine[],
): PrefillLine[] {
  const have = new Set(
    server
      .filter(p => p.value !== null && p.value !== undefined)
      .map(p => p.key),
  );
  return [
    ...server.filter(
      p => !(p.value === null && local.some(l => l.key === p.key)),
    ),
    ...local.filter(l => !have.has(l.key)),
  ];
}
