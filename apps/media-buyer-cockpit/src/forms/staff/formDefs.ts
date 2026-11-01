/**
 * The five staff forms (docs/forms/WAVE12-CONTRACT.md 3.7). This file is
 * their definition until the form editor ships (W19): cockpit_forms holds a
 * record of the same keys and refuses edits, and a test keeps the two equal.
 * Field keys are the argument keys of the RPCs in lifecycleClient.ts, and
 * every refusal sentence is the database's, word for word.
 *
 * Shared byte for byte by the client success and CEO cockpits.
 */

import type {
  Answers,
  FieldDef,
  FormDef,
  FormKey,
  PauseConsent,
} from "./formSheetCore";
import { addDays, daysBetween, kuwaitDay, usd } from "./formSheetCore";

/** The extension's client limitations, the cockpit's own list in this order (W17). */
export const LIMITATIONS = [
  "No limitations",
  "Budget",
  "Launch slipped on their side",
  "Ad account or page issue",
  "Content not ready",
  "Team or owner change",
  "Season or holiday",
  "Other",
] as const;

/** Why a client left: the churn register's eight reasons (churnCore.ts REASONS). */
export const CHURN_REASONS = [
  "Cancelled",
  "Refund",
  "Chargeback",
  "Non-payment 14+ days",
  "Paused past 14 days",
  "Ghosted",
  "Completed term, did not renew",
  "Other",
] as const;

/** The card's Churn Type options, by the register's value. */
export const CHURN_TYPES = [
  { value: "mid_programme", label: "Mid-programme loss (counts as churn)" },
  { value: "completed", label: "Completed term (not counted as churn)" },
];

const opts = (list: readonly string[]) =>
  list.map(v => ({ value: v, label: v }));
const isClientRequest = (a: Answers) => a.pauseKind === "client_request";
const num = (v: unknown) =>
  v === null || v === undefined || v === "" ? Number.NaN : Number(v);

/** The pause's two consents, in 3.5's words. */
export const CONSENT_TERM =
  "On the call the client agreed the 90-day term keeps running.";
export const CONSENT_OVER_14 =
  "On the call the client agreed that a pause over 14 days ends the engagement.";
export const CONSENT_SENTENCE =
  "Tick both consents the client gave on the call.";

const callFields = (required: boolean): FieldDef[] => [
  {
    key: "callId",
    label: "The call where you agreed it",
    type: "call",
    required: a => required && a.noCall !== true,
    showIf: a => a.noCall !== true,
    message:
      "Pick the call where you agreed it, or tick that there was no call.",
  },
  {
    key: "noCall",
    label: "There was no call",
    type: "tick",
  },
  {
    key: "noCallReason",
    label: "Why there was no call",
    type: "text",
    min: 4,
    required: a => a.noCall === true,
    showIf: a => a.noCall === true,
    message: "Say why there was no call, so the decision reads back.",
  },
];

const extension: FormDef = {
  key: "extension",
  version: 1,
  title: "Give more time",
  cardWords: "extensions",
  ticket: null,
  ticketNone: "No ticket for an extension",
  notice: true,
  doneLabel: "Given",
  submitLabel: a => {
    const n = num(a.weeks);
    return Number.isFinite(n)
      ? `Give ${n} ${n === 1 ? "week" : "weeks"}`
      : "Give more time";
  },
  fields: [
    {
      key: "weeks",
      label: "Weeks",
      type: "choice",
      required: true,
      options: [
        { value: "1", label: "1 week" },
        { value: "2", label: "2 weeks" },
        { value: "4", label: "4 weeks" },
      ],
      message: "Pick 1, 2 or 4 weeks.",
    },
    {
      key: "reason",
      label: "Why",
      type: "text",
      required: true,
      min: 4,
      placeholder: "What happened, in a line",
      message: "Say why they need more time, so the card reads back.",
    },
    {
      key: "ours",
      label: "In or out of our control",
      type: "yesno",
      required: true,
      options: [
        { value: "yes", label: "In our control" },
        { value: "no", label: "Out of our control" },
      ],
      message: "Say whether the delay was in our control.",
    },
    {
      key: "limitations",
      label: "What holds the client back",
      type: "multi",
      options: opts(LIMITATIONS),
      exclusive: "No limitations",
      check: v =>
        Array.isArray(v) && v.includes("No limitations") && v.length > 1
          ? "No limitations cannot go with another pick."
          : null,
    },
    {
      key: "atRisk",
      label: "Will they stop if billed on schedule?",
      type: "yesno",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      message: "Say whether they would stop if billed on schedule.",
    },
    ...callFields(true),
    {
      key: "prevent",
      label: "How we avoid this next time",
      type: "text",
      placeholder: "Optional",
    },
  ],
};

const pause: FormDef = {
  key: "pause",
  version: 1,
  title: "Pause this client",
  tone: "destructive",
  cardWords: "pauses",
  ticket: {
    type: "client_pause",
    label: "Open the pause tickets",
    waiting: "The pause needs its tickets",
  },
  ticketNone: "No ticket for a pause",
  notice: true,
  doneLabel: "Paused",
  submitLabel: () => "Pause this client",
  fields: [
    {
      key: "pauseKind",
      label: "Kind of pause",
      type: "choice",
      required: true,
      options: [
        { value: "client_request", label: "Client request" },
        { value: "non_payment", label: "Non-payment" },
      ],
      message: "Pick whether the client asked or it is for non-payment.",
    },
    {
      key: "restart",
      label: "Restart date",
      type: "date",
      required: isClientRequest,
      hint: "The pause starts today.",
      message: "Pick the restart date, after today.",
      check: (v, _a, today) =>
        String(v) <= today ? "Pick the restart date, after today." : null,
    },
    {
      key: "reasonCat",
      label: "Reason",
      type: "choice",
      required: true,
      options: [
        { value: "client_asked", label: "Client asked" },
        { value: "not_paying", label: "Not paying" },
        { value: "launch_slipped", label: "Client's own launch slipped" },
        { value: "seasonal", label: "Seasonal" },
        { value: "other", label: "Other" },
      ],
      message: "Pick the reason for the pause.",
    },
    {
      key: "reason",
      label: "In a line",
      type: "text",
      required: true,
      min: 4,
      message: "Say why in a line, so the card reads back.",
    },
    {
      key: "callId",
      label: "The call where the client agreed",
      type: "call",
      required: isClientRequest,
      showIf: isClientRequest,
      message: "Pick the call where the client agreed the pause.",
    },
    {
      key: "consentTerm",
      label: CONSENT_TERM,
      type: "tick",
      required: isClientRequest,
      showIf: isClientRequest,
      message: CONSENT_SENTENCE,
    },
    {
      key: "consentOver14",
      label: CONSENT_OVER_14,
      type: "tick",
      required: isClientRequest,
      showIf: isClientRequest,
      message: CONSENT_SENTENCE,
      emphasis: (a, today) =>
        typeof a.restart === "string" && a.restart > addDays(today, 14),
    },
  ],
};

const resume: FormDef = {
  key: "resume",
  version: 1,
  title: "Resume this client",
  cardWords: "resumes",
  ticket: {
    type: "client_relaunch",
    label: "Open the relaunch ticket",
    waiting: "The relaunch needs its ticket",
  },
  ticketNone: "No ticket for a resume",
  notice: true,
  doneLabel: "Resumed",
  submitLabel: () => "Resume this client",
  fields: [
    {
      key: "on",
      label: "Resumed on",
      type: "date",
      required: true,
      initial: today => today,
      message: "Pick the day they resume.",
    },
    {
      key: "nextDate",
      label: "Next payment date",
      type: "date",
      hint: "Suggested: the old date moved by the pause's length.",
    },
  ],
};

const churnConfirm: FormDef = {
  key: "churn_confirm",
  version: 1,
  title: "Client is leaving",
  tone: "destructive",
  cardWords: "churn",
  ticket: {
    type: "client_offboarding",
    label: "Open the offboarding ticket",
    waiting: "The offboarding needs its ticket",
  },
  ticketNone: "No ticket for a churn",
  notice: true,
  doneLabel: "Churn confirmed",
  submitLabel: () => "Confirm churn",
  fields: [
    {
      key: "leftOn",
      label: "The day they left",
      type: "date",
      required: true,
      message: "Pick the day they left, today or before.",
      check: (v, _a, today) =>
        String(v) > today ? "Pick the day they left, today or before." : null,
    },
    {
      key: "noticeOn",
      label: "The day they gave notice",
      type: "date",
      hint: "From the termination survey when there is one.",
    },
    {
      key: "reason",
      label: "Reason",
      type: "choice",
      required: true,
      options: opts(CHURN_REASONS),
      message: "Pick the reason they left.",
    },
    {
      key: "churnType",
      label: "Churn type",
      type: "choice",
      required: true,
      options: CHURN_TYPES,
      hint: "Set by the day-90 rule. Change it only with the reason in Why they left.",
      message: "Pick the churn type.",
    },
    {
      key: "whyDetail",
      label: "Why they left",
      type: "longtext",
      required: true,
      min: 10,
      message: "Say why they left in detail, so the lock-in reads back.",
    },
    {
      key: "howToStop",
      label: "How we stop this next time",
      type: "longtext",
      required: true,
      min: 10,
      message: "Say how we stop this next time.",
    },
    {
      key: "mrrLostUsd",
      label: "MRR lost (USD)",
      type: "number",
      min: 0,
      message: "Use a number of 0 or more.",
    },
    {
      key: "exitCallId",
      label: "The exit call",
      type: "call",
      noneLabel: "No exit call",
    },
    {
      key: "surveyState",
      label: "Exit survey",
      type: "choice",
      required: true,
      initial: () => "not_sent",
      options: [
        { value: "not_sent", label: "Not sent" },
        { value: "sent", label: "Sent" },
        { value: "filled", label: "Filled" },
        { value: "declined", label: "Declined" },
      ],
      message: "Pick where the exit survey stands.",
    },
  ],
};

/** A lower MRR than the card's, or 0, needs a reason (Q13). */
const mrrDown = (a: Answers) => {
  const to = num(a.mrrUsd);
  const from = num(a._fromMrrUsd);
  return (
    to === 0 || (Number.isFinite(from) && Number.isFinite(to) && to < from)
  );
};

const mrr: FormDef = {
  key: "mrr",
  version: 1,
  title: "Set MRR",
  cardWords: "MRR",
  ticket: null,
  ticketNone: "No ticket for an MRR change",
  notice: false,
  doneLabel: "MRR set",
  submitLabel: a => {
    const n = num(a.mrrUsd);
    return Number.isFinite(n) && n >= 0 ? `Set MRR to ${usd(n)}` : "Set MRR";
  },
  fields: [
    {
      key: "mrrUsd",
      label: "MRR (USD a month)",
      type: "number",
      required: true,
      min: 0,
      message: "Type the monthly amount in dollars, 0 or more.",
    },
    {
      key: "reasonCat",
      label: "What changed",
      type: "choice",
      required: true,
      options: [
        { value: "price_change", label: "Price change" },
        { value: "plan_change", label: "Plan change" },
        { value: "upsell", label: "Upsell" },
        { value: "downgrade", label: "Downgrade" },
        { value: "correction", label: "Correction" },
      ],
      message: "Pick what changed.",
    },
    {
      key: "reason",
      label: "Why",
      type: "text",
      min: 4,
      required: mrrDown,
      message:
        "Say why the MRR goes down or to 0, so the downgrade reads back.",
    },
    {
      key: "effective",
      label: "From",
      type: "date",
      required: true,
      initial: today => today,
      message: "Pick the day the new MRR starts.",
    },
  ],
};

export const FORM_DEFS: Record<FormKey, FormDef> = {
  extension,
  pause,
  resume,
  churn_confirm: churnConfirm,
  mrr,
};

/** The field keys of each form, as the registry records them (W19). */
export function formKeys(key: FormKey): string[] {
  return FORM_DEFS[key].fields.map(f => f.key);
}

/**
 * Give more time while a grant runs: "Add to the extension", and the line
 * that says where the new weeks start (W23). The grant id goes with the send.
 */
export function extensionDef(liveUntil: string | null | undefined): FormDef {
  if (!liveUntil) return extension;
  return {
    ...extension,
    title: "Add to the extension",
    lede: `An extension runs to ${kuwaitDay(liveUntil)}; these weeks add from that date.`,
  };
}

/**
 * The pause once the client signs it in the portal or by link
 * (WAVE34-CONTRACT.md 4.3.6, 5.2): for a client request the two ticks give
 * way to the sheet's consent row (FormSheet `after`), the action reads
 * Confirm pause, and a restart other than the signed one is refused in the
 * database's words. The field keys stay the registry's (W19); a
 * non-payment pause is unchanged.
 */
export function pauseConsentDef(consent: PauseConsent | null): FormDef {
  return {
    ...pause,
    submitLabel: a =>
      isClientRequest(a) ? "Confirm pause" : "Pause this client",
    fields: pause.fields.map(f => {
      if (f.key === "consentTerm" || f.key === "consentOver14")
        return { ...f, required: false, showIf: () => false };
      if (f.key === "restart")
        return {
          ...f,
          check: (v, a, today) => {
            if (String(v) <= today)
              return "Pick the restart date, after today.";
            if (
              isClientRequest(a) &&
              consent?.state === "signed" &&
              consent.restart &&
              String(v) !== consent.restart
            )
              return `The client signed a restart of ${kuwaitDay(consent.restart)}. Use that date or send a new consent.`;
            return null;
          },
        };
      return f;
    }),
  };
}

/** The resume form's suggested next date: the old date moved by the pause's length. */
export function suggestedNextDate(
  oldNextDate: string | null | undefined,
  pausedOn: string | null | undefined,
  today: string,
): string | null {
  if (!oldNextDate || !pausedOn) return null;
  const length = daysBetween(pausedOn, today);
  return length >= 0 ? addDays(oldNextDate, length) : null;
}
