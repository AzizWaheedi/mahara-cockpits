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
            // The pause runs from today; a later signed start waits for its day (the database refuses it too).
            if (
              isClientRequest(a) &&
              consent?.state === "signed" &&
              consent.start &&
              consent.start > today
            )
              return `The client signed a pause from ${kuwaitDay(consent.start)}. Confirm it on that day or send a new consent.`;
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

// --- Waves 5 and 6: Log a win and Client is back (WAVE56-CONTRACT.md 5.1, 5.11) ----

/** The win kinds in Log a win's order (3.1), the four Rs first, then the upsells. */
export const WIN_KIND_OPTIONS = [
  { value: "review", label: "Google review" },
  { value: "video_testimonial", label: "Video testimonial" },
  { value: "podcast", label: "Podcast case study" },
  { value: "referral", label: "Referral" },
  { value: "renewal", label: "Renewal" },
  { value: "reactivation", label: "Reactivation" },
  { value: "upsell_website", label: "Website" },
  { value: "upsell_smm", label: "Social media management" },
  { value: "upsell_backend", label: "Back-end programme" },
  { value: "upsell_seo_geo", label: "SEO and AI search" },
  { value: "upsell_second_campaign", label: "Second campaign" },
];

/** The wins ledger's refusals Log a win checks before a send (4.2), word for word. */
export const WIN_SAY = {
  kind: "Pick what you won.",
  review: "Add the review link or a screenshot link.",
  video: "Add the video link.",
  podcast: "Add the episode link.",
  referral: "Pick the referred client's signed deal.",
  agreement: "Add the agreement link or tie a payment later.",
  quoted: "Add the quoted price.",
  belowList: "Say why the price is below the list price.",
  date: "The win date is today or within the last 30 days.",
  upsellProof: "Pick the sent proposal or add a proof link.",
  monthly: "Add the monthly amount.",
  link: "A link starts with https://.",
} as const;

export type WinProposal = {
  id: string;
  offerName: string;
  status: string;
  totalUsd: number | null;
  listUsd: number | null;
};
export type WinDeal = {
  responseId: string;
  business: string;
  signedOn: string;
};

export type WinContext = {
  client: string;
  /** Offer Studio proposals that are sent, link copied or accepted (never a draft). */
  proposals: WinProposal[];
  /** Signed deals of the last 120 days, for a referral. */
  deals: WinDeal[];
};

const upsell = (a: Answers) => /^upsell_/.test(String(a.kind ?? ""));
const isKind = (k: string) => (a: Answers) => a.kind === k;
const https = (v: unknown) =>
  /^https:\/\/\S+$/i.test(String(v ?? "").trim()) ? null : WIN_SAY.link;

function proofField(
  key: string,
  label: string,
  kinds: string[],
  message: string,
  required: boolean,
): FieldDef {
  return {
    key,
    label,
    type: "text",
    required,
    showIf: a => kinds.includes(String(a.kind ?? "")),
    message,
    placeholder: "https://",
    check: https,
  };
}

/**
 * Log a win (5.1): what was won, when, its proof per kind, the referred
 * client's deal, an upsell's price, and a note. A proposal picked makes it
 * "Mark as offered"; the database refuses a draft in its own words.
 */
export function winDef(ctx: WinContext): FormDef {
  const listOf = (a: Answers) => {
    const p = ctx.proposals.find(x => x.id === a.proposalId);
    return p?.listUsd ?? null;
  };
  const below = (a: Answers) => {
    const list = listOf(a);
    const q = num(a.quotedUsd);
    return upsell(a) && list !== null && Number.isFinite(q) && q < list;
  };
  return {
    key: "win",
    version: 1,
    title: `Log a win for ${ctx.client}`,
    lede: "Log it the day it happens, with its proof.",
    cardWords: "wins",
    ticket: null,
    ticketNone: "No ticket for a win",
    notice: true,
    doneLabel: "Logged",
    submitLabel: a => (a.proposalId ? "Mark as offered" : "Log the win"),
    words: {
      stored: "Win stored",
      storing: "Storing the win",
      cardQueued: "Card comment queued",
      cardDone: "Card comment confirmed",
      held: "Waits for the switch-on",
    },
    fields: [
      {
        key: "kind",
        label: "What did you win?",
        type: "choice",
        required: true,
        message: WIN_SAY.kind,
        options: WIN_KIND_OPTIONS,
        optionGroups: [
          {
            label: null,
            values: WIN_KIND_OPTIONS.slice(0, 6).map(o => o.value),
          },
          {
            label: "Upsells",
            values: WIN_KIND_OPTIONS.slice(6).map(o => o.value),
          },
        ],
      },
      {
        key: "wonOn",
        label: "When",
        type: "date",
        required: true,
        hint: "Today or within the last 30 days.",
        message: WIN_SAY.date,
        initial: today => today,
        check: (v, _a, today) => {
          const d = String(v);
          return d > today || daysBetween(d, today) > 30 ? WIN_SAY.date : null;
        },
      },
      proofField(
        "proofReview",
        "Review link or screenshot link",
        ["review"],
        WIN_SAY.review,
        true,
      ),
      proofField(
        "proofVideo",
        "Video link",
        ["video_testimonial"],
        WIN_SAY.video,
        true,
      ),
      proofField(
        "proofPodcast",
        "Episode link",
        ["podcast"],
        WIN_SAY.podcast,
        true,
      ),
      {
        key: "referralDealResponseId",
        label: "Referred client",
        type: "choice",
        required: isKind("referral"),
        showIf: isKind("referral"),
        message: WIN_SAY.referral,
        hint: ctx.deals.length
          ? "Signed deals of the last 120 days, by business name."
          : "No signed deal in the last 120 days to pick yet.",
        options: ctx.deals.map(d => ({
          value: d.responseId,
          label: `${d.business} · signed ${kuwaitDay(d.signedOn) || "on a day not recorded"}`,
        })),
      },
      {
        key: "proposalId",
        label: "Proposal",
        type: "choice",
        showIf: a => upsell(a) && ctx.proposals.length > 0,
        hint: "A sent proposal. A draft is not a win.",
        options: ctx.proposals.map(p => ({
          value: p.id,
          label: `${p.offerName}${p.totalUsd !== null ? ` · ${usd(p.totalUsd)}` : ""}`,
        })),
      },
      {
        ...proofField(
          "proofUpsell",
          "Proof link",
          WIN_KIND_OPTIONS.slice(6).map(o => o.value),
          WIN_SAY.upsellProof,
          false,
        ),
        required: a => upsell(a) && !a.proposalId,
      },
      {
        key: "agreementUrl",
        label: "Agreement link (optional now, needed for pay)",
        type: "text",
        showIf: a => a.kind === "renewal" || a.kind === "reactivation",
        placeholder: "https://",
        check: https,
      },
      {
        key: "quotedUsd",
        label: "Quoted price (USD)",
        type: "number",
        required: upsell,
        showIf: upsell,
        message: WIN_SAY.quoted,
        check: v => (num(v) > 0 && num(v) <= 1_000_000 ? null : WIN_SAY.quoted),
      },
      {
        key: "recurring",
        label: "Monthly",
        type: "tick",
        showIf: upsell,
      },
      {
        key: "monthlyUsd",
        label: "Monthly amount (USD)",
        type: "number",
        required: a => upsell(a) && a.recurring === true,
        showIf: a => upsell(a) && a.recurring === true,
        message: WIN_SAY.monthly,
        check: v => (num(v) > 0 ? null : WIN_SAY.monthly),
      },
      {
        key: "belowListReason",
        label: "Why below the list price?",
        type: "text",
        required: below,
        showIf: below,
        min: 3,
        message: WIN_SAY.belowList,
        hint: "The proposal's list price is higher than the quoted price.",
      },
      { key: "note", label: "Note (optional)", type: "longtext" },
    ],
  };
}

/** An upsell needs a sent proposal or a proof link (3.2); said before the send. */
export function winProblem(a: Answers): string | null {
  if (!upsell(a)) return null;
  const proof = String(a.proofUpsell ?? "").trim();
  return a.proposalId || proof ? null : WIN_SAY.upsellProof;
}

/** The departure Client is back reopens, as the sheet's read-only facts say it. */
export type Departure = {
  id: number;
  leftOn: string | null;
  reason: string | null;
  churnType: string | null;
};

export const REACTIVATE_SAY = {
  why: "Say why they came back in 10 to 500 characters.",
  date: "The return date is on or after the day they left, and within 14 days from now.",
} as const;

/**
 * Client is back (5.11): a churned client returning. One act reopens the
 * card through the rails; the month they left keeps its churn.
 */
export function reactivateDef(client: string, d: Departure): FormDef {
  const type =
    CHURN_TYPES.find(t => t.value === d.churnType)?.label.replace(
      / \(.*\)$/,
      "",
    ) ?? "churn type not recorded";
  return {
    key: "reactivate",
    version: 1,
    title: `${client} is back`,
    lede: `Left on ${kuwaitDay(d.leftOn) || "a day not recorded"} · ${d.reason ?? "no reason recorded"} · ${type}`,
    cardWords: "reactivations",
    ticket: null,
    ticketNone: "No ticket: open the relaunch ticket from Today",
    notice: true,
    doneLabel: "Reopened",
    submitLabel: () => "Reopen the client",
    words: {
      stored: "Stored",
      storing: "Storing",
      cardQueued: "Card queued",
      cardDone: "Card confirmed",
      held: "Waits for the switch-on",
    },
    fields: [
      {
        key: "returnOn",
        label: "Back from",
        type: "date",
        required: true,
        initial: today => today,
        message: REACTIVATE_SAY.date,
        check: (v, _a, today) => {
          const day = String(v);
          if (d.leftOn && day < d.leftOn) return REACTIVATE_SAY.date;
          return daysBetween(today, day) > 14 ? REACTIVATE_SAY.date : null;
        },
      },
      {
        key: "status",
        label: "Back as",
        type: "choice",
        required: true,
        initial: () => "Active",
        options: [
          { value: "Active", label: "Active" },
          { value: "Onboarding Booked", label: "Onboarding again" },
        ],
      },
      {
        key: "nextPaymentDate",
        label: "Next payment date (optional)",
        type: "date",
      },
      {
        key: "mrrUsd",
        label: "MRR (USD, optional)",
        type: "number",
        check: v => (num(v) >= 0 ? null : "Use a number of 0 or more."),
      },
      {
        key: "agreementUrl",
        label: "Agreement link (optional, needed for pay)",
        type: "text",
        placeholder: "https://",
        check: https,
      },
      {
        key: "why",
        label: "Why did they come back?",
        type: "longtext",
        required: true,
        min: 10,
        message: REACTIVATE_SAY.why,
        check: v => (String(v).trim().length > 500 ? REACTIVATE_SAY.why : null),
      },
      {
        key: "callId",
        label: "Call (optional)",
        type: "call",
        noneLabel: "No call",
      },
    ],
  };
}
