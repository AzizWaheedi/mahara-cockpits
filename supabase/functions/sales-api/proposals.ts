// What archiving or stopping a proposal does to the worker's queue: pure
// decisions, so the rules are tested apart from the database (proposals.test.ts).

type Row = Record<string, unknown>;

/** The proposal's open requests, as sales-api reads them. */
export interface OpenRequest {
  id: string;
  status: string;
}

export const BEING_WRITTEN = "It is being written right now. Archive it when it finishes.";

/**
 * A second Draft proposal while one is open (two tabs, or a page that had
 * not refreshed). It promises no time: a draft that waits on an outage can
 * take hours, and the lead's Proposal card says where it is and why.
 */
export const ALREADY_DRAFTING =
  "A proposal for this lead is already being drafted. Refresh the lead's page to see where it is.";

/**
 * Archiving stops the draft: every queued request for the proposal is
 * cancelled with it. One the worker is running cannot be called back, so
 * archiving waits for it (409), rather than archive a proposal the worker is
 * about to write over.
 */
export function archivePlan(open: OpenRequest[]): { ok: true; cancel: string[] } | { ok: false; error: string } {
  if (open.some(r => r.status === "running")) return { ok: false, error: BEING_WRITTEN };
  return { ok: true, cancel: open.filter(r => r.status === "queued").map(r => r.id) };
}

export const STOPPED =
  "Drafting was stopped before it finished. The last version is below; draft it again when you are ready.";

/**
 * The proposal after its queued request is stopped (request.set cancelled).
 * A first draft has nothing to show, so it is archived, as before. A retry
 * or a rebuild of a proposal that already has a version goes back to what
 * that version was (validation.status), so stopping it never hides a draft
 * the closer already had.
 */
export function stoppedProposal(p: { html_path?: unknown; validation?: unknown }): Row {
  const before = String(((p.validation ?? {}) as Row).status ?? "");
  if (p.html_path && ["needs_input", "ready", "failed"].includes(before))
    return { status: before, error: before === "failed" ? STOPPED : null };
  return { status: "archived" };
}

export const ARCHIVED_NO_RETRY =
  "This proposal was archived, so it is not drafted again. Draft proposal on the lead's page starts a new one.";
export const SENT_NO_RETRY =
  "This proposal was marked sent, so it is not drafted again. Draft proposal on the lead's page starts a new one.";

/**
 * Try again on a failed request (request.set to queued) puts the proposal
 * back to drafting: never one the closer archived or marked sent, which the
 * worker would then leave drafting for ever (an archived one is cancelled
 * unwritten). Null when it may go ahead.
 */
export function retryRefusal(p: { status?: unknown } | null | undefined): string | null {
  const status = String(p?.status ?? "");
  if (status === "archived") return ARCHIVED_NO_RETRY;
  if (status === "sent") return SENT_NO_RETRY;
  return null;
}

/**
 * What Draft again (proposal.retry) queues. After a rebuild that failed for
 * good (the request itself failed: storage, the browser), a rebuild again,
 * which keeps the closer's figures and asks no model. Otherwise a fresh draft
 * from the call, carrying the figures the closer typed into the last
 * version's blanks (deal.closer_figures, kept by applyFills), which the
 * worker puts back into the new draft's blanks.
 */
export function retryPlan(
  p: { deal?: unknown },
  last: { params?: unknown; status?: unknown } | null | undefined,
): { rebuild: true } | { rebuild: false; fills: Record<string, string> | null } {
  const deal = (p.deal && typeof p.deal === "object" ? p.deal : null) as Row | null;
  const params = (last?.params ?? {}) as Row;
  if (deal && params.rebuild === true && last?.status === "failed") return { rebuild: true };
  const kept = deal?.closer_figures;
  const fills =
    kept && typeof kept === "object" && !Array.isArray(kept)
      ? Object.fromEntries(
          Object.entries(kept as Row)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => [k, String(v)]),
        )
      : {};
  return { rebuild: false, fills: Object.keys(fills).length ? fills : null };
}
