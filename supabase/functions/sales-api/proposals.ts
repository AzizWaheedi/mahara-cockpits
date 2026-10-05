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
