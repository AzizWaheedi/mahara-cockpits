import { ago } from "./format";
import type { Proposal, ProposalStatus, WorkRequest } from "./types";

/**
 * What the proposal screens say about a draft, worked out apart from the
 * screens so the words are tested (proposals.test.ts). The writer is
 * hermes/sales-desk: it drafts every two minutes, tries a draft four times,
 * and while an outage holds a draft it puts one sentence for the closer on
 * the proposal (`error`) and the fix on the request.
 */

/** The writer's tries per draft (hermes/sales-desk config MAX_ATTEMPTS). */
export const MAX_TRIES = 4;
/** After this long a draft is "taking longer than usual". */
export const SLOW_MINUTES = 20;

/** What a closer does about a slow draft. */
const STILL_DRAFTING =
  "It is still drafting by itself, so there is no need to ask again. If it is not written an hour after you asked, tell the CEO.";

/** The writer's note on a try that failed and will be made again. */
const RETRY = /^Try \d+ of \d+ failed/;

export interface DraftWait {
  /** callout-good while all is well, callout-warn once it waits or is slow. */
  tone: "good" | "warn";
  /** The first line, said as a state. */
  head: string;
  /** Why it waits (the writer's own sentence), or what happens next. */
  body: string;
  /** "Asked 35 min ago · writing now, try 2 of 4". */
  meta: string;
  slow: boolean;
  /** The request has not started, so it can still be stopped. */
  stoppable: boolean;
}

/** Where the request is, with its tries. */
export function tryWords(r: WorkRequest | null): string {
  if (!r) return "waiting for the writer";
  const n = Number(r.attempts) || 0;
  if (r.status === "running")
    return n > 1 ? `writing now, try ${n} of ${MAX_TRIES}` : "writing now";
  if (n > 0)
    return `waiting to try again, ${n} of ${MAX_TRIES} ${n === 1 ? "try" : "tries"} made`;
  return "waiting for the writer";
}

/**
 * The drafting callout. The reason is the closer's sentence on the proposal,
 * else the writer's on the request (an older row, or a run that held it for
 * another proposal's sake).
 */
export function draftWait(
  p: Pick<Proposal, "error" | "created_at">,
  r: WorkRequest | null,
  now = Date.now(),
): DraftWait {
  const asked = r?.requested_at ?? p.created_at;
  const minutes = (now - Date.parse(asked)) / 60_000;
  const slow = minutes >= SLOW_MINUTES;
  const reason = (p.error || r?.error || "").trim();
  const meta = `Asked ${ago(asked, now)} · ${tryWords(r)}`;
  const stoppable = r?.status === "queued";
  if (reason)
    return {
      tone: "warn",
      head: slow
        ? "Taking longer than usual"
        : "The proposal is not written yet",
      // Once it is slow, the closer is told what to do, if the writer's
      // sentence does not say so already (a try that failed does not).
      body:
        slow && !/tell the CEO/i.test(reason)
          ? `${sentence(reason)} ${STILL_DRAFTING}`
          : reason,
      meta,
      slow,
      stoppable,
    };
  if (slow)
    return {
      tone: "warn",
      head: "Taking longer than usual",
      body: STILL_DRAFTING,
      meta,
      slow,
      stoppable,
    };
  // A rebuild puts the closer's figures into the document: no model, minutes.
  if (r?.params?.rebuild)
    return {
      tone: "good",
      head: "Your figures are going into the document",
      // Rebuilds go before drafts, but not before one already being written.
      body: "It usually takes a minute or two, longer while another proposal is being written; this page updates by itself.",
      meta,
      slow,
      stoppable,
    };
  return {
    tone: "good",
    head: "The proposal is being written",
    body: "It usually takes about ten minutes; this page updates by itself.",
    meta,
    slow,
    stoppable,
  };
}

/** A drafting proposal that waits, in a chip's few words. */
export function waitLabel(
  p: Pick<Proposal, "status" | "error">,
): string | null {
  if (p.status !== "drafting" || !p.error) return null;
  return RETRY.test(p.error) ? "Retrying" : "Waiting: writer offline";
}

/** The one download: the PDF, or the page itself, said for what it is. */
export function downloadLabel(
  p: Pick<Proposal, "status" | "pdf_path" | "html_path">,
): string | null {
  if (p.pdf_path) return "Download PDF";
  if (!p.html_path) return null;
  if (p.status === "needs_input") return "Download draft (has blanks)";
  if (p.status === "ready") return "Download page (no PDF)";
  return "Download page";
}

/** The writer's notes on the version shown, as plain lines. */
export function notesOf(validation: Proposal["validation"]): string[] {
  const v = validation?.notes;
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
}

const TITLES: Record<ProposalStatus, string> = {
  drafting: "Proposal being drafted",
  needs_input: "Proposal drafted, needs figures",
  ready: "Proposal ready to send",
  sent: "Proposal sent",
  failed: "Proposal draft failed",
  archived: "Proposal archived",
};

/** The lead's history names a proposal by where it is. */
export function proposalTitle(p: Pick<Proposal, "status" | "sent_at">): string {
  if (p.sent_at) return TITLES.sent;
  return TITLES[p.status] ?? "Proposal";
}

/**
 * The proposal document's frame: scripts for its own editor, modals for its
 * print window, downloads for Save. Never allow-same-origin (the page would
 * share the cockpit's origin, its session and storage), never top navigation
 * or popups (it could take the closer's tab, or open the cockpit unsandboxed).
 */
export const DOCUMENT_SANDBOX = "allow-scripts allow-modals allow-downloads";

/**
 * A drafting proposal whose request is not there (deleted, or never made):
 * the writer will never pick it up, so the page says so and what to do,
 * rather than "Reading where the draft is" for ever.
 */
export const REQUEST_GONE =
  "The writer has no request for this draft, so it will not be written. Archive it, then draft a new one from the lead's page.";

/** A request read by id: a row that is not there is said, never left blank. */
export function requestRead<T>(
  data: T | null,
  error: { message: string } | null,
): { data: T | null; error: { message: string } | null } {
  if (error) return { data: null, error };
  return data
    ? { data, error: null }
    : { data: null, error: { message: REQUEST_GONE } };
}

/** The document card when there is no document, with what to do next. */
export function noDocument(status: ProposalStatus): string {
  if (status === "drafting")
    return "The document appears here when the draft is done.";
  if (status === "archived")
    return "No document was built before it was archived. Draft proposal on the lead's page starts a new one.";
  if (status === "failed")
    return "No document was built. Draft it again from the box above.";
  return "No document was built. Draft it again from the lead's page.";
}

/** The proposals a closer has to act on: fill, send, or draft again. */
export function waitsOnCloser(p: Pick<Proposal, "status">): boolean {
  return (
    p.status === "needs_input" || p.status === "ready" || p.status === "failed"
  );
}

/** A sentence from the writer, ended once: never "found..". */
export function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * What Draft again says once it is asked (sales-api proposal.retry): a
 * rebuild that failed is rebuilt with the closer's figures, and a fresh
 * draft takes the figures the closer typed back into its blanks.
 */
export function retryToast(
  out: { rebuild?: boolean; figures_kept?: boolean } | null | undefined,
): string {
  if (out?.rebuild)
    return "Rebuilding the document with your figures. It usually takes a minute or two.";
  if (out?.figures_kept)
    return "Drafting again with the same choices, and your figures go back in. It usually takes about ten minutes.";
  return "Drafting again with the same choices. It usually takes about ten minutes.";
}

/** A failed draft on the lead's card: the writer's sentence, with the next step when it has none. */
export function failedLine(error: string | null): string {
  const said = sentence(error?.trim() || "The writer gave no reason");
  return /draft (it )?again/i.test(said)
    ? said
    : `${said} Open it to draft again.`;
}

/**
 * The outage a desk job waits out, from its health line: the desk writes
 * "waiting: <why>", after what a fallback drafted meanwhile when it did
 * (hermes/sales-desk desk.py cmd_requests). Null when it is not waiting.
 */
export function waitingFor(detail: string | null | undefined): string | null {
  const m = /(?:^|; )waiting: (.+)$/s.exec(detail ?? "");
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

/**
 * What is wrong, from the desk's reason: its first sentence. The rest is
 * the fix (a key's name, a command on the VPS), for whoever fixes it.
 */
export function whatIsWrong(reason: string): string {
  const t = reason.trim();
  const m = /^.*?[.!?](?=\s|$)/s.exec(t);
  return (m ? m[0] : t).replace(/[.!?]$/, "");
}
