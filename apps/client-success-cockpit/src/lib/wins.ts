/**
 * Every browser call of the wins ledger and the other waves 5-6 screens of
 * the client success cockpit (docs/forms/WAVE56-CONTRACT.md 3.3, 3.6, 3.7,
 * 4.10, 4.13): Log a win and its stages, the tie proposal, the invoice link,
 * the Today rows, the kickoff, the receipt link and the retire list. The
 * database gates each one and words each refusal; this file passes the
 * sentence on unchanged and reads every answer defensively, so a missing
 * amount stays "not known". Nothing here is called behind a closed door: the
 * screens read cockpit_form_doors() first (formDoorsW56).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WinContext, WinDeal, WinProposal } from "@/forms/staff/formDefs";
import type {
  Answers,
  FormTrailRow,
  Prefill,
  SubmitRef,
} from "@/forms/staff/formSheetCore";
import {
  type BandInput,
  type LogAnswer,
  logAnswerOf,
  type RetireItem,
  type TieCandidate,
  toCandidate,
  toRetireItem,
  totalsOf,
  toWinRow,
  type WinRow,
  type WinTotals,
} from "./winsCore";

type Any = any;
export type WinsClient = Pick<SupabaseClient, "rpc" | "functions">;

export class WinsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WinsError";
  }
}

async function rpc(
  c: WinsClient | null,
  name: string,
  args?: Record<string, unknown>,
): Promise<Any> {
  if (!c) throw new WinsError("Sign in to the cockpit, then try again.");
  const { data, error } = await Promise.resolve().then(() =>
    args === undefined ? c.rpc(name) : c.rpc(name, args),
  );
  if (error)
    throw new WinsError(
      String(error.message ?? "").trim() ||
        "The server refused this with no reason. Try again in a minute.",
    );
  return data;
}

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};
const number = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const rows = (v: unknown): Any[] => (Array.isArray(v) ? v : []);

// --- Reads ----------------------------------------------------------------------------

export type WinsRead = {
  wins: WinRow[];
  acceptedProposals: {
    proposalId: string;
    offerName: string;
    acceptedAt: string | null;
  }[];
  doorOpen: boolean;
  /** What Log a win picks from: sent proposals and recent signed deals (when the read carries them). */
  context: Pick<WinContext, "proposals" | "deals">;
};

function proposalsOf(v: unknown): WinProposal[] {
  return rows(v)
    .filter(p => text(p?.id ?? p?.proposalId))
    .map(p => ({
      id: String(p.id ?? p.proposalId),
      offerName: text(p.offerName) ?? "Offer",
      status: text(p.status) ?? "sent",
      totalUsd: number(p.totalUsd ?? p.sentPriceUsd),
      listUsd: number(p.listUsd ?? p.sentListUsd),
    }))
    .filter(p => !["draft", "archived", "not_now"].includes(p.status));
}

function dealsOf(v: unknown): WinDeal[] {
  return rows(v)
    .filter(d => text(d?.responseId))
    .map(d => ({
      responseId: String(d.responseId),
      business: text(d.business ?? d.businessName) ?? "A signed client",
      signedOn: text(d.signedOn) ?? "",
    }));
}

/** cockpit_csm_wins_read(p_task_id): the client page's wins. */
export async function winsRead(
  c: WinsClient | null,
  taskId: string,
): Promise<WinsRead> {
  const d =
    (await rpc(c, "cockpit_csm_wins_read", { p_task_id: taskId })) ?? {};
  return {
    wins: rows(d.wins)
      .map(toWinRow)
      .filter((w): w is WinRow => w !== null),
    acceptedProposals: rows(d.acceptedProposals)
      .filter(p => text(p?.proposalId))
      .map(p => ({
        proposalId: String(p.proposalId),
        offerName: text(p.offerName) ?? "Offer",
        acceptedAt: text(p.acceptedAt),
      })),
    doorOpen: d.doorOpen === true,
    context: {
      proposals: proposalsOf(d.proposals ?? d.sentProposals),
      deals: dealsOf(d.referralDeals ?? d.deals),
    },
  };
}

/** cockpit_csm_wins_list(p_from, p_to): the Money tab's rows across clients. */
export async function winsList(
  c: WinsClient | null,
  from: string,
  to: string,
): Promise<{ wins: WinRow[]; totals: WinTotals }> {
  const d =
    (await rpc(c, "cockpit_csm_wins_list", { p_from: from, p_to: to })) ?? {};
  const wins = rows(d.wins)
    .map(toWinRow)
    .filter((w): w is WinRow => w !== null);
  return { wins, totals: totalsOf(d.totals, wins) };
}

/** cockpit_csm_wins_today(): the Today rows (5.12), as band inputs. */
export async function winsToday(c: WinsClient | null): Promise<BandInput[]> {
  const d = await rpc(c, "cockpit_csm_wins_today");
  const list = Array.isArray(d) ? d : rows(d?.rows);
  return list
    .filter(r => r && typeof r.kind === "string")
    .map(r => ({
      ...r,
      kind: String(r.kind),
      taskId: text(r.taskId),
      client: text(r.client ?? r.clientName),
      offer: text(r.offer ?? r.offerName),
      proposalId: text(r.proposalId),
      winId: text(r.winId),
      count: number(r.count),
      returnedOn: text(r.returnedOn),
      dueOn: text(r.dueOn),
      part: text(r.part),
      partNo: number(r.partNo),
      expectedAmount: number(r.expectedAmount),
      currency: text(r.currency),
      dealResponseId: text(r.dealResponseId),
    }));
}

/** cockpit_win_tie_candidates(p_win_id). */
export async function tieCandidates(
  c: WinsClient | null,
  winId: string,
): Promise<TieCandidate[]> {
  const d = await rpc(c, "cockpit_win_tie_candidates", { p_win_id: winId });
  return (Array.isArray(d) ? d : rows(d?.candidates))
    .map(toCandidate)
    .filter((x): x is TieCandidate => x !== null);
}

// --- Writes ---------------------------------------------------------------------------

const upsell = (a: Answers) => /^upsell_/.test(String(a.kind ?? ""));

/** Log a win's answers as cockpit_csm_win_log's p (3.3). */
export function winLogArgs(
  taskId: string,
  a: Answers,
  requestId: string,
  ctx?: Pick<WinContext, "proposals">,
) {
  const kind = String(a.kind ?? "");
  const proof =
    kind === "review"
      ? a.proofReview
      : kind === "video_testimonial"
        ? a.proofVideo
        : kind === "podcast"
          ? a.proofPodcast
          : upsell(a)
            ? a.proofUpsell
            : null;
  const proposal = upsell(a)
    ? ctx?.proposals.find(p => p.id === a.proposalId)
    : undefined;
  return {
    requestId,
    taskId,
    kind,
    wonOn: text(a.wonOn),
    proofUrl: text(proof),
    proposalId: upsell(a) ? text(a.proposalId) : null,
    quotedUsd: upsell(a) ? number(a.quotedUsd) : null,
    listUsd: proposal?.listUsd ?? null,
    belowListReason: upsell(a) ? text(a.belowListReason) : null,
    recurring: upsell(a) && a.recurring === true,
    monthlyUsd: upsell(a) && a.recurring === true ? number(a.monthlyUsd) : null,
    agreementUrl:
      kind === "renewal" || kind === "reactivation"
        ? text(a.agreementUrl)
        : null,
    referralDealResponseId:
      kind === "referral" ? text(a.referralDealResponseId) : null,
    note: text(a.note),
    ...(a.confirmDuplicate === true ? { confirmDuplicate: true } : {}),
  };
}

/** cockpit_csm_win_log: stored ({ok, winId}) or a warning that stored nothing. */
export async function logWin(
  c: WinsClient | null,
  taskId: string,
  a: Answers,
  requestId: string,
  ctx?: Pick<WinContext, "proposals">,
): Promise<LogAnswer & { ref: SubmitRef }> {
  const d = await rpc(c, "cockpit_csm_win_log", {
    p: winLogArgs(taskId, a, requestId, ctx),
  });
  const out = logAnswerOf(d, Boolean(a.proposalId));
  const eventId = number(d?.eventId);
  const responseId = text(d?.responseId);
  return {
    ...out,
    ref: {
      ...(out.ok && out.winId ? { winId: out.winId } : {}),
      ...(eventId !== null ? { eventId } : {}),
      ...(responseId ? { responseId } : {}),
    },
  };
}

/** Mark as offered from Offer Studio (4.3.1): the proposal's own price as the quote. */
export function offeredArgs(
  taskId: string,
  p: {
    proposalId: string;
    kind: string;
    totalUsd: number | null;
    listUsd: number | null;
  },
  requestId: string,
  today: string,
) {
  return {
    requestId,
    taskId,
    kind: p.kind,
    wonOn: today,
    proofUrl: null,
    proposalId: p.proposalId,
    quotedUsd: p.totalUsd,
    listUsd: p.listUsd,
    belowListReason: null,
    recurring: false,
    monthlyUsd: null,
    agreementUrl: null,
    referralDealResponseId: null,
    note: null,
  };
}

export async function markOffered(
  c: WinsClient | null,
  args: ReturnType<typeof offeredArgs>,
): Promise<LogAnswer> {
  return logAnswerOf(await rpc(c, "cockpit_csm_win_log", { p: args }), true);
}

/** cockpit_csm_win_stage: accept (agreement link), void (reason), proof. */
export async function winStage(
  c: WinsClient | null,
  p: {
    requestId: string;
    winId: string;
    act: "accept" | "void" | "proof";
    agreementUrl?: string | null;
    reason?: string | null;
    proofUrl?: string | null;
  },
): Promise<string> {
  const d = await rpc(c, "cockpit_csm_win_stage", {
    p: {
      requestId: p.requestId,
      winId: p.winId,
      act: p.act,
      ...(p.agreementUrl ? { agreementUrl: p.agreementUrl.trim() } : {}),
      ...(p.reason ? { reason: p.reason.trim() } : {}),
      ...(p.proofUrl ? { proofUrl: p.proofUrl.trim() } : {}),
    },
  });
  return (
    text(d?.sentence) ??
    (p.act === "void"
      ? "Voided."
      : p.act === "accept"
        ? "Marked as accepted."
        : "Saved.")
  );
}

/** cockpit_csm_win_tie_propose: the CSM asks the CEO to tie a payment to the win. */
export async function proposeTie(
  c: WinsClient | null,
  p: { requestId: string; winId: string; paymentId: string },
): Promise<string> {
  const d = await rpc(c, "cockpit_csm_win_tie_propose", { p });
  return text(d?.sentence) ?? "Sent to the CEO to confirm.";
}

/** cockpit_csm_win_invoice_link: after "Invoice this" made the invoice. */
export async function linkInvoice(
  c: WinsClient | null,
  winId: string,
  invoiceId: string,
): Promise<void> {
  await rpc(c, "cockpit_csm_win_invoice_link", {
    p_win_id: winId,
    p_invoice_id: invoiceId,
  });
}

/** The after-send trail of a win or a reopen (cockpit_form_trail with the send's reference). */
export async function trailOf(
  c: WinsClient | null,
  ref: SubmitRef,
): Promise<FormTrailRow> {
  const d = await rpc(c, "cockpit_form_trail", { p_ref: ref });
  return d && typeof d === "object" ? (d as FormTrailRow) : {};
}

// --- The kickoff (4.13, 5.13) -----------------------------------------------------------

export type KickoffPrefill = {
  live: boolean;
  why: string | null;
  client: string | null;
  answered: { at: string | null; byRole: string | null } | null;
  prefill: Prefill[];
  onboardingAt: string | null;
  card: { mrrUsd: number | null; status: string | null };
};

const SOURCE_WORDS: Record<string, string> = {
  onboarding: "the onboarding form",
  onboarding_form: "the onboarding form",
  card: "the card",
  clickup: "the card",
};

/** cockpit_kickoff_prefill(p_task_id): each value with where it came from. */
export async function kickoffPrefill(
  c: WinsClient | null,
  taskId: string,
): Promise<KickoffPrefill> {
  const d =
    (await rpc(c, "cockpit_kickoff_prefill", { p_task_id: taskId })) ?? {};
  const fields = d.fields && typeof d.fields === "object" ? d.fields : {};
  const prefill: Prefill[] = Object.entries(fields as Record<string, Any>).map(
    ([key, v]) => ({
      key,
      value:
        v && typeof v === "object" && "value" in v ? (v.value ?? null) : null,
      source:
        SOURCE_WORDS[String(v?.source ?? "")] ??
        text(v?.source) ??
        "the cockpit",
    }),
  );
  const card = d.card && typeof d.card === "object" ? d.card : {};
  return {
    live: d.live === true,
    why: text(d.why),
    client: text(d.client),
    answered:
      d.answered && typeof d.answered === "object"
        ? { at: text(d.answered.at), byRole: text(d.answered.byRole) }
        : null,
    prefill,
    onboardingAt: text(d.onboarding?.submittedAt),
    card: { mrrUsd: number(card.mrrUsd), status: text(card.status) },
  };
}

/** cockpit_kickoff_submit: the answers keyed by field, one request id per open sheet. */
export async function kickoffSubmit(
  c: WinsClient | null,
  taskId: string,
  answers: Record<string, unknown>,
  requestId: string,
): Promise<{
  responseId: string | null;
  trail: { step: string; state: string }[];
}> {
  const d =
    (await rpc(c, "cockpit_kickoff_submit", {
      p_task_id: taskId,
      p_answers: answers,
      p_request_id: requestId,
    })) ?? {};
  return {
    responseId: text(d.responseId),
    trail: rows(d.trail)
      .filter(t => text(t?.step))
      .map(t => ({ step: String(t.step), state: String(t.state ?? "") })),
  };
}

// --- Receipts (4.10.4) and the retire list (3.7) ------------------------------------------

/**
 * cockpit-forms-api `file.url`: a 5-minute signed link to a client's receipt.
 * The link is returned once and never stored or logged.
 */
export async function receiptUrl(
  c: WinsClient | null,
  responseId: string,
  field = "receipt",
): Promise<string> {
  if (!c) throw new WinsError("Sign in to the cockpit, then try again.");
  const { data, error } = await c.functions.invoke("cockpit-forms-api", {
    body: { op: "file.url", responseId, field },
  });
  let answer: Any = data;
  if (error && "context" in error && error.context instanceof Response)
    answer = await error.context
      .clone()
      .json()
      .catch(() => null);
  if (answer && typeof answer.error === "string")
    throw new WinsError(answer.error);
  const url = text(answer?.url);
  if (error || !url)
    throw new WinsError(
      "The receipt link did not come back. Try again in a minute.",
    );
  return url;
}

/** cockpit_retire_items_read(): every old form and scenario and where it stands. */
export async function retireItems(c: WinsClient | null): Promise<RetireItem[]> {
  const d = (await rpc(c, "cockpit_retire_items_read")) ?? {};
  return rows(d.items)
    .map(toRetireItem)
    .filter((x): x is RetireItem => x !== null);
}

/** Every RPC this file can call, for the deploy's to_regprocedure check. */
export const RPC_NAMES = [
  "cockpit_csm_wins_read",
  "cockpit_csm_wins_list",
  "cockpit_csm_wins_today",
  "cockpit_win_tie_candidates",
  "cockpit_csm_win_log",
  "cockpit_csm_win_stage",
  "cockpit_csm_win_tie_propose",
  "cockpit_csm_win_invoice_link",
  "cockpit_form_trail",
  "cockpit_kickoff_prefill",
  "cockpit_kickoff_submit",
  "cockpit_retire_items_read",
] as const;
