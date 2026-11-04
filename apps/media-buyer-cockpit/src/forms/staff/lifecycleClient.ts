/**
 * Every browser call of the staff forms and their doors
 * (docs/forms/WAVE12-CONTRACT.md 3.1, 4.12): the five sends, the after-send
 * trail, the prefill, which doors may show, the notice answers and the reads
 * behind Today's bands. The database gates each one and words each refusal;
 * this file passes the sentence on unchanged. It imports only the Supabase
 * client's type and formSheetCore (types and the date and money words), so
 * the client success and CEO
 * cockpits hold it byte for byte (scripts/check-shared.sh). The churn
 * tracker and the billing sheet import it; nothing copies it.
 *
 * Request ids: the caller makes one per open sheet and sends it again on a
 * retry, so a double press or a retry never writes twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Answers,
  CallPick,
  FormTrailRow,
  PauseConsent,
  Prefill,
  SheetKey,
  SubmitRef,
  W56Doors,
} from "./formSheetCore";
import { ALL_CLOSED, kuwaitDay, readDoorsW56, usd } from "./formSheetCore";

type Any = any;

/** A refusal or a lost connection, with the sentence to show. */
export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

async function rpc(
  client: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<Any> {
  // A synchronous throw (a stub, a missing client) is a refusal like any other.
  const { data, error } = await Promise.resolve().then(() =>
    args === undefined ? client.rpc(name) : client.rpc(name, args),
  );
  if (error)
    throw new LifecycleError(
      String(error.message ?? "").trim() ||
        "The server refused this. Try again in a minute.",
    );
  return data;
}

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};
const number = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const yes = (v: unknown): boolean => v === true || v === "yes";
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** What a send hands back to FormSheet: the done line's words and the trail's reference. */
export type SendResult = {
  message: string;
  ref: SubmitRef;
  cardState: string | null;
};

export type SendOptions = {
  /** Who presses: the CEO's seat writes as the CEO, everyone else as the CSM. */
  source?: "ceo" | "csm";
  /** Give more time while a grant runs: the live grant it replaces (W23). */
  replacesGrantId?: number | null;
  /** Client is leaving: the termination survey this confirm answers. */
  surveyResponseId?: string | null;
  /** The CSM ticked that a survey found only by the link's hidden id is this client's. */
  surveyConfirmed?: boolean;
  /**
   * Pause for a client request once the client signs it (WAVE34-CONTRACT.md
   * 4.3.5): the signed consent's response, in place of the two ticks.
   */
  consentResponseId?: string | null;
};

function sendResult(data: Any, message: string): SendResult {
  const d = data && typeof data === "object" ? data : {};
  const eventId = number(d.eventId ?? d.event_id);
  const departureId = number(d.departureId ?? d.departure_id);
  const responseId = text(d.responseId ?? d.response_id);
  return {
    message,
    cardState: text(d.cardState ?? d.card_state),
    ref: {
      ...(eventId !== null ? { eventId } : {}),
      ...(responseId ? { responseId } : {}),
      ...(departureId !== null ? { departureId } : {}),
    },
  };
}

/** "16 Nov" for a day, or null when there is none. */
const dayWords = (iso: unknown): string | null => kuwaitDay(text(iso)) || null;

/** The edit FormSheet's extension answers send to cockpit_billing_write (4.7). */
export function extensionEdit(
  a: Answers,
  requestId: string,
  replacesGrantId?: number | null,
) {
  return {
    kind: "extension",
    weeks: number(a.weeks),
    reason: text(a.reason),
    ours: yes(a.ours),
    limitations: list(a.limitations),
    atRisk: yes(a.atRisk),
    callId: a.noCall === true ? null : text(a.callId),
    noCall: a.noCall === true,
    noCallReason: a.noCall === true ? text(a.noCallReason) : null,
    prevent: text(a.prevent),
    replacesGrantId: replacesGrantId ?? null,
    requestId,
  };
}

/**
 * The pause edit (4.8): the call is the consent, with the CSM's two ticks
 * (W8). Once the client signs the pause consent (waves 3-4, 4.3.5) the
 * signed response goes instead of the ticks, and the database writes the
 * signed consent itself.
 */
export function pauseEdit(
  a: Answers,
  requestId: string,
  consentResponseId?: string | null,
) {
  const request = a.pauseKind === "client_request";
  const signed = request && Boolean(consentResponseId);
  return {
    kind: "pause",
    pauseKind: text(a.pauseKind),
    restart: text(a.restart),
    reasonCat: text(a.reasonCat),
    reason: text(a.reason),
    callId: request ? text(a.callId) : null,
    consent:
      request && !signed
        ? {
            kind: "call",
            term_runs: a.consentTerm === true,
            over_14_ends: a.consentOver14 === true,
          }
        : null,
    ...(signed ? { consentResponseId } : {}),
    requestId,
  };
}

export function resumeEdit(a: Answers, requestId: string) {
  return {
    kind: "resume",
    on: text(a.on),
    nextDate: text(a.nextDate),
    requestId,
  };
}

export function mrrEdit(a: Answers, requestId: string) {
  return {
    kind: "mrr",
    value: number(a.mrrUsd),
    reasonCat: text(a.reasonCat),
    reason: text(a.reason),
    effective: text(a.effective),
    requestId,
    // A paid recurring win's "Add to MRR?" (WAVE56-CONTRACT.md 4.3.7): the live mrr kind's win_id key.
    ...(text(a.winId) ? { winId: text(a.winId) } : {}),
  };
}

/** The churn confirm's arguments (cockpit_client_lifecycle_confirm, 3.1). */
export function churnArgs(
  taskId: string,
  a: Answers,
  requestId: string,
  surveyResponseId?: string | null,
  surveyConfirmed?: boolean,
) {
  return {
    taskId,
    requestId,
    leftOn: text(a.leftOn),
    noticeOn: text(a.noticeOn),
    reason: text(a.reason),
    churnType: text(a.churnType),
    whyDetail: text(a.whyDetail),
    howToStop: text(a.howToStop),
    mrrLostUsd: number(a.mrrLostUsd),
    exitCallId: text(a.exitCallId),
    surveyState: text(a.surveyState) ?? "not_sent",
    surveyResponseId: surveyResponseId ?? null,
    // Only with a survey and the person's tick (20261101o refuses an unchecked one without it).
    ...(surveyResponseId && surveyConfirmed === true
      ? { surveyConfirmed: true }
      : {}),
  };
}

async function billingEdit(
  c: SupabaseClient,
  taskId: string,
  edit: Record<string, unknown>,
  source: "ceo" | "csm",
): Promise<Any> {
  return rpc(c, "cockpit_billing_write", {
    p_action: "edit",
    p_args: { taskId, edit, source },
  });
}

/** Give more time (or Add to the extension): one write with the new fields (4.7). */
export async function giveMoreTime(
  c: SupabaseClient,
  taskId: string,
  a: Answers,
  requestId: string,
  o: SendOptions = {},
): Promise<SendResult> {
  const data = await billingEdit(
    c,
    taskId,
    extensionEdit(a, requestId, o.replacesGrantId),
    o.source ?? "csm",
  );
  const n = number(a.weeks);
  const to = dayWords(data?.newDate ?? data?.new_date);
  return sendResult(
    data,
    `${n} ${n === 1 ? "week" : "weeks"}${to ? ` to ${to}` : ""}`,
  );
}

export async function pauseClient(
  c: SupabaseClient,
  taskId: string,
  a: Answers,
  requestId: string,
  o: SendOptions = {},
): Promise<SendResult> {
  const data = await billingEdit(
    c,
    taskId,
    pauseEdit(a, requestId, o.consentResponseId),
    o.source ?? "csm",
  );
  const back = dayWords(a.restart);
  return sendResult(
    data,
    back ? `from today, restarts ${back}` : "from today, no restart date",
  );
}

export async function resumeClient(
  c: SupabaseClient,
  taskId: string,
  a: Answers,
  requestId: string,
  o: SendOptions = {},
): Promise<SendResult> {
  const data = await billingEdit(
    c,
    taskId,
    resumeEdit(a, requestId),
    o.source ?? "csm",
  );
  const next = dayWords(a.nextDate);
  return sendResult(
    data,
    `${dayWords(a.on) ?? "today"}${next ? `, next payment ${next}` : ""}`,
  );
}

export async function setMrr(
  c: SupabaseClient,
  taskId: string,
  a: Answers,
  requestId: string,
  o: SendOptions = {},
): Promise<SendResult> {
  const data = await billingEdit(
    c,
    taskId,
    mrrEdit(a, requestId),
    o.source ?? "csm",
  );
  const n = number(a.mrrUsd);
  return sendResult(
    data,
    `${usd(n)} a month from ${dayWords(a.effective) ?? "today"}`,
  );
}

export async function confirmChurn(
  c: SupabaseClient,
  taskId: string,
  a: Answers,
  requestId: string,
  o: SendOptions = {},
): Promise<SendResult> {
  const data = await rpc(c, "cockpit_client_lifecycle_confirm", {
    p_kind: "churn",
    p_args: churnArgs(
      taskId,
      a,
      requestId,
      o.surveyResponseId,
      o.surveyConfirmed,
    ),
  });
  return sendResult(data, `left ${dayWords(a.leftOn) ?? "today"}`);
}

/** The after-send trail of one decision (cockpit_form_trail). */
export async function formTrail(
  c: SupabaseClient,
  ref: SubmitRef,
): Promise<FormTrailRow> {
  const data = await rpc(c, "cockpit_form_trail", { p_ref: ref });
  return data && typeof data === "object" ? (data as FormTrailRow) : {};
}

export type PrefillRead = {
  prefill: Prefill[];
  calls: CallPick[];
  hints: Prefill[];
  /** The live extension grant (cockpit_extensions_v row), or null. */
  grant: {
    grantId: number | null;
    until: string | null;
    weeks: number | null;
  } | null;
  card: Record<string, unknown> | null;
  /** The card's latest termination survey; unverified when only the link's hidden id put it there. */
  survey: {
    responseId: string | null;
    submittedAt: string | null;
    unverified: boolean;
  } | null;
  churnTypeDefault: string | null;
  /** The pause's client consent (waves 3-4, 4.3.4); null before migration 20261102b. */
  consent?: PauseConsent | null;
};

const CONSENT_STATES = ["none", "sent", "signed", "dates_wrong", "expired"];

/** cockpit_pause_consent_for's answer, read defensively; null when there is none. */
export function pauseConsentOf(v: unknown): PauseConsent | null {
  const o = v && typeof v === "object" ? (v as Any) : null;
  if (!o || !CONSENT_STATES.includes(o.state)) return null;
  return {
    state: o.state,
    inviteId: text(o.inviteId ?? o.invite_id),
    sentAt: text(o.sentAt ?? o.sent_at),
    responseId: text(o.responseId ?? o.response_id),
    signedAt: text(o.signedAt ?? o.signed_at),
    via: o.via === "link" || o.via === "portal" ? o.via : null,
    signer: text(o.signer),
    start: text(o.start),
    restart: text(o.restart),
    datesNote: text(o.datesNote ?? o.dates_note),
    ...(typeof o.live === "boolean" ? { live: o.live } : {}),
  };
}

const prefillRows = (v: unknown): Prefill[] =>
  (Array.isArray(v) ? v : [])
    .filter(p => p && typeof p.key === "string" && typeof p.source === "string")
    .map(p => ({ key: p.key, value: p.value ?? null, source: p.source }));

/** One read per sheet open: each value with the sentence that says where it came from. */
export async function formPrefill(
  c: SupabaseClient,
  formKey: SheetKey,
  taskId: string,
): Promise<PrefillRead> {
  const d =
    (await rpc(c, "cockpit_form_prefill", {
      p_form_key: formKey,
      p_task_id: taskId,
    })) ?? {};
  const g = d.grant && typeof d.grant === "object" ? d.grant : null;
  const s = d.survey && typeof d.survey === "object" ? d.survey : null;
  const prefill = prefillRows(d.values);
  const churnTypeDefault = text(d.churnTypeDefault);
  if (churnTypeDefault && !prefill.some(p => p.key === "churnType"))
    prefill.push({
      key: "churnType",
      value: churnTypeDefault,
      source: "the day-90 rule",
    });
  return {
    prefill,
    calls: (Array.isArray(d.calls) ? d.calls : [])
      .filter((x: Any) => x && x.id !== null && x.id !== undefined)
      .map((x: Any) => ({
        id: String(x.id),
        at: String(x.at ?? ""),
        kind: String(x.kind ?? "call"),
        source: String(x.source ?? ""),
      })),
    hints: (Array.isArray(d.hints) ? d.hints : [])
      .filter((h: Any) => h && typeof h.text === "string")
      .map((h: Any, i: number) => ({
        key: `hint${i}`,
        value: h.text,
        source: String(h.source ?? ""),
      })),
    grant: g
      ? {
          grantId: number(g.grantId ?? g.grant_id),
          until: text(g.until),
          weeks: number(g.weeks),
        }
      : null,
    card: d.card && typeof d.card === "object" ? d.card : null,
    survey: s
      ? {
          responseId: text(s.responseId ?? s.id),
          submittedAt: text(s.submittedAt ?? s.submitted_at),
          unverified: s.unverified === true,
        }
      : null,
    churnTypeDefault,
    consent: pauseConsentOf(d.consent),
  };
}

export type Doors = Record<
  | "churnConfirm"
  | "extension"
  | "pause"
  | "mrr"
  | "reviews"
  | "checks"
  | "prefill",
  boolean
>;

export const NO_DOORS: Doors = {
  churnConfirm: false,
  extension: false,
  pause: false,
  mrr: false,
  reviews: false,
  checks: false,
  prefill: false,
};

/** Which new doors may show (cockpit_form_doors). Any error reads as all closed. */
export async function formDoors(c: SupabaseClient): Promise<Doors> {
  try {
    const d = await rpc(c, "cockpit_form_doors");
    if (!d || typeof d !== "object") return { ...NO_DOORS };
    const out = { ...NO_DOORS };
    for (const k of Object.keys(out) as (keyof Doors)[]) out[k] = d[k] === true;
    return out;
  } catch {
    return { ...NO_DOORS };
  }
}

/**
 * Waves 5-6's six doors with why each is closed (WAVE56-CONTRACT.md 3.10):
 * `missing` reads "Opens after the next cockpit update.", `off` reads "Not
 * switched on yet.". Any error reads as every door missing, and nothing is
 * called behind a closed one.
 */
export async function formDoorsW56(
  c: SupabaseClient | null,
): Promise<W56Doors> {
  if (!c) return { ...ALL_CLOSED };
  try {
    return readDoorsW56(await rpc(c, "cockpit_form_doors"));
  } catch {
    return { ...ALL_CLOSED };
  }
}

/** Client is back's arguments (4.12): one audited act, the departure named. */
export function reactivateArgs(
  taskId: string,
  departureId: number,
  a: Answers,
  requestId: string,
) {
  return {
    requestId,
    taskId,
    departureId,
    returnOn: text(a.returnOn),
    status: a.status === "Onboarding Booked" ? "Onboarding Booked" : "Active",
    nextPaymentDate: text(a.nextPaymentDate),
    mrrUsd: number(a.mrrUsd),
    agreementUrl: text(a.agreementUrl),
    why: text(a.why),
    callId: text(a.callId),
  };
}

/** Reopen a churned client (cockpit_client_lifecycle_confirm 'reactivate'). */
export async function reactivateClient(
  c: SupabaseClient,
  taskId: string,
  departureId: number,
  a: Answers,
  requestId: string,
): Promise<SendResult> {
  const data = await rpc(c, "cockpit_client_lifecycle_confirm", {
    p_kind: "reactivate",
    p_args: reactivateArgs(taskId, departureId, a, requestId),
  });
  return sendResult(
    data,
    `back from ${dayWords(a.returnOn) ?? "today"} as ${a.status === "Onboarding Booked" ? "onboarding again" : "Active"}`,
  );
}

/** "Not leaving" on a notice, or "Handled" on a pause request, with what the client said. */
export async function answerNotice(
  c: SupabaseClient,
  responseId: string,
  answer: "staying" | "handled",
  note: string,
): Promise<void> {
  await rpc(c, "cockpit_form_notice_answer", {
    p_response_id: responseId,
    p_answer: answer,
    p_note: note.trim(),
  });
}

export type NoticeIn = {
  kind: "termination" | "pause_request" | "pause_consent";
  responseId: string;
  taskId: string | null;
  clientName: string;
  noticeOn: string | null;
  submittedAt: string | null;
  matched: boolean;
  /** On its card only by the link's hidden id: nobody has checked it is this client's. */
  unverified: boolean;
  departureId: number | null;
  /** A native exit survey (waves 3-4): its ratings, numbers only. */
  ratings?: { title: string; value: number }[];
  /** A pause consent row (4.3.7): signed or the dates said wrong, and how it was signed. */
  consent?: PauseConsent | null;
};

const NOTICE_KINDS = ["termination", "pause_request", "pause_consent"];

/** The derived "Notice in", "Pause request in" and pause consent rows (cockpit_form_notices_in). */
export async function noticesIn(c: SupabaseClient): Promise<NoticeIn[]> {
  const d = await rpc(c, "cockpit_form_notices_in");
  return (Array.isArray(d) ? d : [])
    .filter(
      (r: Any) => r && NOTICE_KINDS.includes(r.kind) && text(r.responseId),
    )
    .map((r: Any) => ({
      kind: r.kind,
      responseId: String(r.responseId),
      taskId: text(r.taskId),
      clientName: text(r.clientName) ?? "A client",
      noticeOn: text(r.noticeOn),
      submittedAt: text(r.submittedAt),
      matched: r.matched === true && Boolean(text(r.taskId)),
      unverified: r.unverified === true,
      departureId: number(r.departureId),
      ...(Array.isArray(r.ratings)
        ? {
            ratings: r.ratings
              .filter(
                (x: Any) =>
                  x && typeof x.title === "string" && number(x.value) !== null,
              )
              .slice(0, 5)
              .map((x: Any) => ({ title: x.title, value: Number(x.value) })),
          }
        : {}),
      ...(r.kind === "pause_consent"
        ? {
            consent: pauseConsentOf({
              ...r,
              state: CONSENT_STATES.includes(r.state)
                ? r.state
                : r.datesWrong === true
                  ? "dates_wrong"
                  : "signed",
              responseId: r.responseId,
            }),
          }
        : {}),
    }));
}

/** Pick the card for an unmatched survey (the gate limits a CSM to their own clients). */
export async function matchLegacy(
  c: SupabaseClient,
  responseId: string,
  taskId: string,
): Promise<Any> {
  return rpc(c, "cockpit_form_legacy_match", {
    p_response_id: responseId,
    p_task_id: taskId,
  });
}

export type LadderRow = {
  taskId: string;
  clientName: string;
  step: "pause_review" | "cancel_review" | "pause_day14";
  dueOn: string | null;
  daysLate: number | null;
  amountUsd: number | null;
  extendedUntil: string | null;
  pausedOn: string | null;
};

/** The overdue ladder's review rows (cockpit_billing_ladder_due): rows, never card changes. */
export async function ladderDue(c: SupabaseClient): Promise<LadderRow[]> {
  const d = await rpc(c, "cockpit_billing_ladder_due");
  return (Array.isArray(d) ? d : [])
    .filter(
      (r: Any) =>
        r &&
        text(r.taskId) &&
        ["pause_review", "cancel_review", "pause_day14"].includes(r.step),
    )
    .map((r: Any) => ({
      taskId: String(r.taskId),
      clientName: text(r.clientName) ?? "A client",
      step: r.step,
      dueOn: text(r.dueOn),
      daysLate: number(r.daysLate),
      amountUsd: number(r.amountUsd),
      extendedUntil: text(r.extendedUntil),
      pausedOn: text(r.pausedOn),
    }));
}

export async function ladderRead(
  c: SupabaseClient,
): Promise<{ pauseReviewDay: number | null; cancelReviewDay: number | null }> {
  const d = (await rpc(c, "cockpit_billing_ladder_read")) ?? {};
  return {
    pauseReviewDay: number(d.pauseReviewDay),
    cancelReviewDay: number(d.cancelReviewDay),
  };
}

export async function ladderSet(
  c: SupabaseClient,
  p: { pauseReviewDay: number; cancelReviewDay: number },
): Promise<Any> {
  return rpc(c, "cockpit_billing_ladder_set", { p });
}

export type PaymentToCheck = {
  id: string;
  day: string | null;
  clientName: string;
  taskId: string | null;
  amount: number | null;
  currency: string | null;
  amountUsd: number | null;
  rail: string | null;
  reference: string | null;
  evidenceUrl: string | null;
  addedBy: string | null;
  daysWaiting: number | null;
};

/** Hand-logged payments waiting on a bank check (cockpit_manual_payments_to_check). */
export async function paymentsToCheck(
  c: SupabaseClient,
): Promise<PaymentToCheck[]> {
  const d = await rpc(c, "cockpit_manual_payments_to_check");
  return (Array.isArray(d) ? d : [])
    .filter((r: Any) => r && text(r.id))
    .map((r: Any) => ({
      id: String(r.id),
      day: text(r.day),
      clientName: text(r.clientName) ?? "A client",
      taskId: text(r.taskId),
      amount: number(r.amount),
      currency: text(r.currency),
      amountUsd: number(r.amountUsd),
      rail: text(r.rail),
      reference: text(r.reference),
      evidenceUrl: text(r.evidenceUrl),
      addedBy: text(r.addedBy),
      daysWaiting: number(r.daysWaiting),
    }));
}

/** Check a payment against the bank, or reject it with the reason (finance or the CEO). */
export async function checkPayment(
  c: SupabaseClient,
  id: string,
  verdict: "checked" | "rejected",
  ref: string | null,
  statementLineId: string | null = null,
): Promise<Any> {
  return rpc(c, "cockpit_manual_payment_check", {
    p_id: id,
    p_verdict: verdict,
    p_ref: ref?.trim() || null,
    p_statement_line_id: statementLineId,
  });
}

export type Lifecycle = {
  taskId: string;
  clientStatus: string | null;
  pausedOn: string | null;
  pauseRestart: string | null;
  extensionUntil: string | null;
  departureId: number | null;
  leftOn: string | null;
  churnConfirmedAt: string | null;
  daysLate: number | null;
  ladderStep: string | null;
  /** Waves 5-6 (20261102i): the confirmed departure's return day, once Client is back reopened it. */
  returnedOn?: string | null;
  /** The departure's reason and churn type, for Client is back's facts, when the read carries them. */
  reason?: string | null;
  churnType?: string | null;
};

/** One card's lifecycle row (cockpit_client_lifecycle_read); null when it has none. */
export async function lifecycleRead(
  c: SupabaseClient,
  taskId: string,
): Promise<Lifecycle | null> {
  const d = await rpc(c, "cockpit_client_lifecycle_read", {
    p_task_id: taskId,
  });
  if (!d || typeof d !== "object") return null;
  const r = d.row && typeof d.row === "object" ? d.row : d;
  return {
    taskId,
    clientStatus: text(r.client_status ?? r.clientStatus),
    pausedOn: text(r.paused_on ?? r.pausedOn),
    pauseRestart: text(r.pause_restart ?? r.pauseRestart),
    extensionUntil: text(r.extension_until ?? r.extensionUntil),
    departureId: number(r.departure_id ?? r.departureId),
    leftOn: text(r.left_on ?? r.leftOn),
    churnConfirmedAt: text(r.churn_confirmed_at ?? r.churnConfirmedAt),
    daysLate: number(r.days_late ?? r.daysLate),
    ladderStep: text(r.ladder_step ?? r.ladderStep),
    returnedOn: text(r.returned_on ?? r.returnedOn),
    reason: text(r.churn_reason ?? r.reason),
    churnType: text(r.churn_type ?? r.churnType),
  };
}

export async function extensionsRead(
  c: SupabaseClient,
  from: string,
  to: string,
): Promise<Any> {
  return rpc(c, "cockpit_extensions_read", { p_from: from, p_to: to });
}

export async function latePaymentsRead(
  c: SupabaseClient,
  from: string,
  to: string,
): Promise<Any> {
  return rpc(c, "cockpit_late_payments_read", { p_from: from, p_to: to });
}

export async function mrrRead(c: SupabaseClient): Promise<Any> {
  return rpc(c, "cockpit_mrr_read");
}

/** Void a billing edit that has not reached the card (CEO or finance). */
export async function voidBillingEvent(
  c: SupabaseClient,
  eventId: number,
  reason: string,
): Promise<Any> {
  return rpc(c, "cockpit_billing_event_void", {
    p_event_id: eventId,
    p_reason: reason.trim(),
  });
}

/** Every RPC this file can call, for the deploy's to_regprocedure check (D-S1). */
export const RPC_NAMES = [
  "cockpit_billing_write",
  "cockpit_client_lifecycle_confirm",
  "cockpit_form_trail",
  "cockpit_form_prefill",
  "cockpit_form_doors",
  "cockpit_form_notice_answer",
  "cockpit_form_notices_in",
  "cockpit_form_legacy_match",
  "cockpit_billing_ladder_due",
  "cockpit_billing_ladder_read",
  "cockpit_billing_ladder_set",
  "cockpit_manual_payments_to_check",
  "cockpit_manual_payment_check",
  "cockpit_client_lifecycle_read",
  "cockpit_extensions_read",
  "cockpit_late_payments_read",
  "cockpit_mrr_read",
  "cockpit_billing_event_void",
] as const;
