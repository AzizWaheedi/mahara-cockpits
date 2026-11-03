// The market research writer: job "research" (next-design plan build MI-1b, CEO item 1;
// docs/forms/WAVE56-CONTRACT.md 4.23.1). hermes/market-intel researches a new client's market (4.23). From MI-3 a
// published run (mode live) makes its Google Doc on the client's Shared Drive, then two queue rows of kind 'research'
// that this file writes on the client card, as today's job does:
// - research_field: the card's Market Research doc (7489dbcc, a url field) = the run's Doc link. Written only while
//   the field is empty or still holds a Doc an EARLIER run of this worker made (the claim's `replaceable` ids); any
//   other link (a person's, the old job's Google Doc, a ClickUp doc) is kept and the row says so. The card is read
//   fresh before the write and read back after it.
// - research_comment: one comment on the card, not notifying, its last line the marker "Cockpit ref MI-<8 hex of the
//   run id>". The card is searched for that marker before the comment is ever posted, and once ClickUp answered the
//   post with an id it is never posted a second time.
//
// OUTWARD SAFETY. Three Edge Function secrets, and nothing else, open these writes (researchGate):
//   CLICKUP_WRITEBACK_APPLY_RESEARCH       exactly "true";
//   CLICKUP_WRITEBACK_RESEARCH_KEYS        the outputs written, a comma list of field and comment. Unset or empty
//                                          means none (the CLICKUP_WRITEBACK_FORMS_KEYS pattern with no default
//                                          lane), so every row is held until MI-3 lists them; anything else in the
//                                          list writes nothing and says so;
//   CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS  client card ids: narrows a live run to a canary (86eywg1cq first). A value
//                                          that is not a list of card ids reads as off, never as every card.
// CLICKUP_WRITEBACK_APPLY, _APPLY_FORMS, _FORMS_KEYS and every other switch neither open nor narrow it. A held row is
// handed back untouched, its try not counted. The database holds the second brake (the MI-3 migration, 4.23.1): its
// claim takes nothing unless this writer last reported a live mode (cockpit_sync_state clickup-writeback:research)
// and the setting market_intel.apply_clickup is on (narrowed by its only_cards), and a shadow run never has a row
// (cockpit_market_intel_done already refuses a shadow run's Doc, field or comment).
//
// The Doc link and the comment text are never in the queue payload (the queue's audit trigger copies payloads into
// cockpit_audit_log): they come from the run through the claim (item.run.plan), are checked against the payload's
// sha256 before any call and frozen in the row's steps column before the first write. progress holds each step's
// state, ids and receipt only (before: empty, ours, same or set; result: written or kept), never a link or a text.
//
// Retry safety, as the forms writer (forms.ts): a write books "started" before the call and "done" after its
// read-back. A call ClickUp does not answer is unknown once its step has started (the write may have landed) and a
// plain retry before that (nothing was sent). A 429 on the write itself never landed; on a read once the step has
// started it is unknown. A 401 is the token or this one card, which runResearch tells apart with forms.ts checkToken.

import type { Provider } from "./queue.ts";
import { errorKind, errorText, findComment, halt, outcomeOf, type RequestOutcome, SAY, type Save, StepBook } from "./requests.ts";
import { FORMS_LIST, FORMS_TEST_CARD, type FormOutcome, sha256 } from "./forms.ts";
import type { Row } from "./rules.ts";

// --- Constants ----------------------------------------------------------------------------------------------------

/** The card field every reader of the research link reads (onboarding-sync, the Blueprint, the portal, briefs). */
export const MARKET_RESEARCH_FIELD = "7489dbcc-fbbd-4eec-abfd-1306be7ff4b8";
/** The two effect keys a published run queues, in the order the claim hands them over on a card. */
export const RESEARCH_KEYS = ["research_field", "research_comment"] as const;
export type ResearchKey = (typeof RESEARCH_KEYS)[number];
/** The outputs CLICKUP_WRITEBACK_RESEARCH_KEYS may list: one per effect key. */
export const RESEARCH_LANES = ["field", "comment"] as const;
export type ResearchLane = (typeof RESEARCH_LANES)[number];
const LANE_OF: Record<ResearchKey, ResearchLane> = { research_field: "field", research_comment: "comment" };
/** The lane a row waits in until the switch lists it; null for a key this writer does not know (it fails as a mismatch). */
export function researchLane(payload: Row | null | undefined): ResearchLane | null {
  const k = payload?.effectKey;
  return isKey(k) ? LANE_OF[k] : null;
}
/** A Google Doc link as the worker and today's job write it (".../d/<id>/edit", or with "?usp=drivesdk"). */
const DOC_LINK = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{25,128})(?:[/?#]\S*)?$/;
const DOC_ID = /^[A-Za-z0-9_-]{25,128}$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** No link the worker makes is longer; a longer value is not its. */
export const LINK_MAX = 300;
/** The worker's comment is two lines; anything near this is not its. */
export const COMMENT_MAX = 2000;
/** Earlier reports of one card that the field may still hold. */
export const REPLACEABLE_MAX = 20;
/** The run states a published run's rows are written in: its Doc exists (publishing) or the run has ended done. */
export const PUBLISHED_STATES = ["publishing", "done"] as const;
/**
 * A run back in progress: cockpit_market_intel_release sends a run that already published back to queued (an error,
 * an outage, a pause) and its claim takes it on through the stages again. Its rows wait for it, with no try used:
 * failing them would lose the writes for good, since the run's next publish dedupes on research:<run>:<key>.
 */
export const RUN_IN_PROGRESS = ["queued", "claimed", "pulling", "picking", "writing", "checking"] as const;
/** A run that ended without done after its Doc was made: its rows are written while the run still names this Doc. */
export const ENDED_KEEPING_DOC = ["failed", "needs_person"] as const;

/** The Doc id of a Google Doc link, or null for anything else (a ClickUp doc, a person's other link, a blank). */
export function docIdOf(value: unknown): string | null {
  const m = DOC_LINK.exec(String(value ?? "").trim());
  return m ? m[1] : null;
}

/** The marker that finds a run's comment again: Cockpit ref MI- and the first 8 hex of the run id (mi/render.py outputs). */
export const researchMarker = (runId: string) =>
  `Cockpit ref MI-${String(runId).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8)}`;

const isKey = (k: unknown): k is ResearchKey => typeof k === "string" && (RESEARCH_KEYS as readonly string[]).includes(k);

// --- Copy (plain, active) -----------------------------------------------------------------------------------------

export const SAY_RESEARCH = {
  mismatch: "The market research plan for this write does not match its queue row, so nothing was written. Tell the tech lead.",
  noPlan: "The market research run behind this write was not found, so nothing was written. Tell the tech lead.",
  notPublished:
    "This research run is not a published run (live, with its Doc made), so nothing was written to the card. Publish it again from the cockpit or with mi.py resend.",
  heldOff:
    "Held: market research writes are switched off. They open when CLICKUP_WRITEBACK_APPLY_RESEARCH is true and CLICKUP_WRITEBACK_RESEARCH_KEYS lists field or comment.",
  heldLimited: "Held: the market research writer is open only for the test card.",
  /** The run went back in progress after it published (an error, an outage or a pause): the row waits for it. */
  heldRun: "Held: this research run is running again, so the card is written once it publishes.",
  heldLane: (lane: string) =>
    `Held: market research ${lane === "field" ? "card field" : lane} writes are not switched on (CLICKUP_WRITEBACK_RESEARCH_KEYS).`,
  offList: "This card is not on the Clients - Mahara list, so nothing was written.",
  offListStarted: "This card is not on the Clients - Mahara list now, and a write may have reached it first, so check it in ClickUp.",
  noField: "Market Research doc is not on this card in ClickUp, so nothing was written.",
  noFieldStarted: "Market Research doc is not on this card in ClickUp now, and a write may have reached it first, so check it in ClickUp.",
  notUrl: (type: string) =>
    `Market Research doc is a ${type || "nameless"} field in ClickUp, not a link, so nothing was written. The tech lead runs the research doctor.`,
  /** The field holds a link this worker did not make: a person's, the old job's Doc or a ClickUp doc. Never its value. */
  kept: "kept: the card's Market Research doc already holds another link, so it stays. The new report is in the card comment and the cockpit.",
  raced: "kept: another link reached the card's Market Research doc during this write, so it stays.",
  fieldNotBack: "Market Research doc did not read back as this report's Doc. The next run reads it again.",
  commentMissing: "The market research comment did not read back on the card. The next run looks for it by its Cockpit ref.",
  commentLost:
    "ClickUp answered the market research comment with its id, but the comment is not on the card now. It is not posted again: check the card in ClickUp.",
  notConfirmed: "ClickUp did not confirm this write.",
  refused: "ClickUp refused this write.",
  readRefused: "ClickUp refused the read after this write, so check the card in ClickUp.",
  /** Before the MI-3 migration: missing is never zero, so the job says so instead of "Nothing to write". */
  notInstalled:
    "Market research writes open with the MI-3 migration: the database has no research queue yet (cockpit_clickup_writeback_claim_research). Nothing was read or written.",
} as const;

// --- Gate ---------------------------------------------------------------------------------------------------------

/** Never names what the secret holds: it may be a pasted value. */
export const RESEARCH_NOT_A_CARD =
  "CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS names something that is not a card id, so no market research write goes to ClickUp. Write card ids separated by commas, nothing else.";
export const RESEARCH_KEYS_BAD =
  "CLICKUP_WRITEBACK_RESEARCH_KEYS names something that is not field or comment, so no market research write goes to ClickUp.";

const listOf = (v: string | undefined) =>
  String(v ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

/**
 * The research switch: CLICKUP_WRITEBACK_APPLY_RESEARCH exactly "true", the outputs CLICKUP_WRITEBACK_RESEARCH_KEYS
 * lists (none when unset), narrowed by CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS. A card list or a key list that cannot be
 * read sets `error` and opens nothing: a canary that cannot be read never widens to every client, and a key list with
 * a typo never writes a lane nobody named. The mode is dry_run until both the switch and at least one output are on.
 */
export function researchGate(env: (name: string) => string | undefined) {
  const rawCards = String(env("CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS") ?? "");
  const cards = listOf(rawCards);
  const cardsError = rawCards !== "" && (!cards.length || cards.some(c => !CARD_ID.test(c))) ? RESEARCH_NOT_A_CARD : null;
  const rawKeys = String(env("CLICKUP_WRITEBACK_RESEARCH_KEYS") ?? "");
  const keysListed = listOf(rawKeys);
  const keysError =
    rawKeys.trim() !== "" && (!keysListed.length || keysListed.some(k => !(RESEARCH_LANES as readonly string[]).includes(k)))
      ? RESEARCH_KEYS_BAD
      : null;
  const error = cardsError ?? keysError;
  const apply = error === null && env("CLICKUP_WRITEBACK_APPLY_RESEARCH") === "true";
  const keys = new Set<ResearchLane>(error ? [] : (keysListed as ResearchLane[]));
  const onlyCards = new Set(error ? [] : cards);
  const mode = (!apply || keys.size === 0 ? "dry_run" : onlyCards.size ? "apply_limited" : "apply") as "dry_run" | "apply_limited" | "apply";
  /** The outputs open now, in the order the claim hands them over; none while the mode is dry_run. */
  const open = mode === "dry_run" ? [] : RESEARCH_LANES.filter(l => keys.has(l));
  const text = cardsError
    ? "off, because CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS is not a list of card ids"
    : keysError
      ? "off, because CLICKUP_WRITEBACK_RESEARCH_KEYS names something other than field and comment"
      : !apply
        ? "dry run (written only when CLICKUP_WRITEBACK_APPLY_RESEARCH is true and CLICKUP_WRITEBACK_RESEARCH_KEYS lists field or comment)"
        : keys.size === 0
          ? "dry run (CLICKUP_WRITEBACK_RESEARCH_KEYS lists no output, so none is written)"
          : mode === "apply_limited"
            ? `apply_limited to the cards ${[...onlyCards].join(", ")} (CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS): ${open.join(", ")}`
            : `apply: ${open.join(", ")}`;
  return {
    apply,
    keys,
    onlyCards,
    error,
    mode,
    open,
    text,
    /** A row is live by its client card (the queue row's task_id) while at least one output is open. */
    live: (taskId: unknown) => mode !== "dry_run" && (onlyCards.size === 0 || (typeof taskId === "string" && onlyCards.has(taskId))),
    has: (lane: unknown) => keys.has(lane as ResearchLane),
  };
}

// --- The database calls (the MI-3 migration, service role only; contract 4.23.1) ----------------------------------

export function researchDb(rpc: (name: string, params?: Row) => Promise<any>) {
  return {
    /** Due research rows, oldest run first per card, each with its run (id, state, mode) and the plan for its key. */
    claim: (token: string, limit: number) => rpc("cockpit_clickup_writeback_claim_research", { p_token: token, p_limit: limit }),
    /** Hand a held row back without counting a try: queued, or retry once its steps hold anything. */
    release: (id: string, token: string, planned: unknown[], note: string, nextAttemptAt: string) =>
      rpc("cockpit_clickup_writeback_release", { p_id: id, p_token: token, p_planned: planned, p_note: note, p_next_attempt_at: nextAttemptAt }),
    /** The research rows by state, the oldest due, the stuck sending and the setting's publish brake. */
    doctorInputs: () => rpc("cockpit_clickup_research_doctor_inputs", {}),
  };
}

/** A database error that says the function is not there yet (PostgREST PGRST202, a 404 on rpc/...). */
export const notInstalled = (e: unknown) => /PGRST202|Could not find the function|Supabase 404/.test(errorText(e));

// --- Rows and steps -----------------------------------------------------------------------------------------------

export type ResearchItem = {
  id: string;
  kind: "research";
  payload: Row;
  attempts: number;
  created_at: string;
  task_id: string | null;
  steps?: ResearchStep[] | null;
  progress?: Row | null;
  state?: string;
  /** The run behind the row, from the claim: its id, state, mode and Doc id (doc_id), and the plan for this row's key. */
  run?: { id: string; state: string; mode: string; docId?: string | null; plan: Row } | null;
};

export type ResearchStep =
  | {
      key: "research_field";
      type: "field";
      taskId: string;
      fieldId: string;
      /** The run's Doc link: what the field is set to. */
      value: string;
      docId: string;
      /** Doc ids of this card's earlier published runs: a field still holding one of them is this worker's to replace. */
      replaceable: string[];
    }
  | {
      key: "research_comment";
      type: "comment";
      taskId: string;
      /** What is posted, the marker as its last line. */
      text: string;
      marker: string;
      docId: string;
    };

/**
 * The one write a row makes, checked before any call: the row's card, the payload's and the plan's are one card on
 * the Clients - Mahara id shape; the payload names this run, the run is published (live, publishing or done, or ended
 * failed or needs_person still naming this Doc); the link is a Google Doc link whose id is the payload's and whose
 * sha256 is the payload's; the comment's sha256 is the payload's, its last line is this run's marker and it links this
 * run's Doc. A mismatch fails the row with no call. A live run back in progress (RUN_IN_PROGRESS) is a wait, never a
 * failure: runResearch hands the row back with no try used until the run publishes again.
 */
export async function researchStep(item: ResearchItem): Promise<{ step: ResearchStep } | { fail: string } | { wait: string }> {
  const p = item.payload ?? {};
  const run = item.run;
  const plan = run?.plan;
  if (!run || !plan || typeof plan !== "object" || Array.isArray(plan)) return { fail: SAY_RESEARCH.noPlan };
  const no = { fail: SAY_RESEARCH.mismatch };
  const key = p.effectKey;
  if (!isKey(key) || (p.kind !== undefined && p.kind !== "research")) return no;
  const card = item.task_id;
  if (typeof card !== "string" || !CARD_ID.test(card) || p.taskId !== card || plan.taskId !== card) return no;
  if (typeof p.runId !== "string" || !RUN_ID.test(p.runId) || String(run.id).toLowerCase() !== p.runId.toLowerCase()) return no;
  const docId = p.docId;
  if (typeof docId !== "string" || !DOC_ID.test(docId)) return no;
  const state = String(run.state);
  if (run.mode !== "live") return { fail: SAY_RESEARCH.notPublished };
  if ((RUN_IN_PROGRESS as readonly string[]).includes(state)) return { wait: SAY_RESEARCH.heldRun };
  const keptDoc = (ENDED_KEEPING_DOC as readonly string[]).includes(state) && run.docId === docId;
  if (!(PUBLISHED_STATES as readonly string[]).includes(state) && !keptDoc) return { fail: SAY_RESEARCH.notPublished };
  if (key === "research_field") {
    const value = plan.value;
    if (plan.fieldId !== MARKET_RESEARCH_FIELD || plan.kind !== "url") return no;
    if (typeof value !== "string" || value !== value.trim() || value.length > LINK_MAX || docIdOf(value) !== docId) return no;
    if (typeof p.valueSha256 !== "string" || (await sha256(value)) !== p.valueSha256) return no;
    const raw: unknown = plan.replaceable ?? [];
    if (!Array.isArray(raw) || raw.length > REPLACEABLE_MAX || !raw.every(id => typeof id === "string" && DOC_ID.test(id))) return no;
    const replaceable = [...new Set(raw as string[])].filter(id => id !== docId);
    return { step: { key, type: "field", taskId: card, fieldId: MARKET_RESEARCH_FIELD, value, docId, replaceable } };
  }
  const text = plan.text;
  if (typeof text !== "string" || !text.trim() || text.length > COMMENT_MAX) return no;
  if (typeof p.commentSha256 !== "string" || (await sha256(text)) !== p.commentSha256) return no;
  const marker = researchMarker(p.runId);
  // The marker once, as the last line; the run's own Doc linked above it.
  if (!text.endsWith(`\n${marker}`) || text.indexOf(marker) !== text.length - marker.length) return no;
  if (!text.includes(`https://docs.google.com/document/d/${docId}`)) return no;
  return { step: { key, type: "comment", taskId: card, text, marker, docId } };
}

/**
 * The step a row writes: the frozen one once it is saved (a retry posts exactly the same text), else the one just
 * checked. A frozen step for another key, card, Doc or field is a mismatch.
 */
export function researchFrozen(item: ResearchItem, fresh: ResearchStep): ResearchStep | null {
  const saved = Array.isArray(item.steps) ? item.steps[0] : null;
  if (!saved) return fresh;
  const same =
    saved.key === fresh.key &&
    saved.type === fresh.type &&
    saved.taskId === fresh.taskId &&
    saved.docId === fresh.docId &&
    (saved.type !== "field" || (fresh.type === "field" && saved.fieldId === fresh.fieldId));
  return same ? saved : null;
}

// --- The writer ---------------------------------------------------------------------------------------------------

type Ctx = { item: ResearchItem; step: ResearchStep; provider: Provider; book: StepBook };

/** Has this step booked anything, in this run or an earlier one? Then a write may be on the card. */
const hasStarted = (x: Ctx) => x.book.get(x.step.key) !== undefined;

/** The client card, read fresh: off the Clients - Mahara list or gone is failed, and no write follows. */
async function readCard(x: Ctx): Promise<Row> {
  const off = () => halt("failed", hasStarted(x) ? SAY_RESEARCH.offListStarted : SAY_RESEARCH.offList);
  let card: Row;
  try {
    card = await x.provider.call("clickup", "GET", `task/${x.step.taskId}`);
  } catch (e) {
    if (/rejected the request \(404/.test(errorText(e))) throw off();
    throw e;
  }
  if (String(card?.list?.id ?? "") !== FORMS_LIST) throw off();
  return card;
}

const fieldOf = (card: Row, fieldId: string): Row | undefined =>
  (Array.isArray(card.custom_fields) ? card.custom_fields : []).find((f: Row) => f.id === fieldId);

/** What the field holds against this step: this run's Doc, nothing, an earlier report's Doc, or anything else. */
type Seen = "same" | "empty" | "ours" | "other";
function seen(field: Row | undefined, step: Extract<ResearchStep, { type: "field" }>): Seen {
  const v = field?.value;
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return "empty";
  const id = docIdOf(v);
  if (id === step.docId) return "same";
  if (id !== null && step.replaceable.includes(id)) return "ours";
  return "other";
}

/**
 * The Market Research doc: the card read fresh; this run's Doc already there is delivered with no write; empty or an
 * earlier report's Doc is written and read back; anything else is kept. The receipt (progress.steps.research_field)
 * is saved before the write: `before` is what the FIRST read saw (empty or ours), so a resume never takes this
 * writer's own value for one the card already had. On a resume, the field still empty or still an earlier report is
 * written again (the same value, so nothing doubles); another link there now got there meanwhile and is kept.
 */
async function writeField(x: Ctx & { step: Extract<ResearchStep, { type: "field" }> }): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const was = book.get(step.key);
  const resumed = was?.state === "started";
  const card = await readCard(x);
  const field = fieldOf(card, step.fieldId);
  if (!field) throw halt("failed", resumed ? SAY_RESEARCH.noFieldStarted : SAY_RESEARCH.noField);
  const type = String(field.type ?? "url");
  if (type !== "url") throw halt("failed", SAY_RESEARCH.notUrl(type));
  const now = seen(field, step);
  if (now === "same") {
    await book.set(step.key, resumed ? "done" : "unchanged", { before: was?.before ?? "same", result: "written" });
    return { state: "delivered", progress: book.progress };
  }
  if (now === "other") {
    // Not this worker's link: it stays. Found empty or an earlier report before this writer's write, another link
    // reached the card meanwhile.
    await book.set(step.key, "skipped", resumed ? { result: "kept", raced: true } : { before: "set", result: "kept" });
    return { state: "skipped", progress: book.progress, error: resumed ? SAY_RESEARCH.raced : SAY_RESEARCH.kept };
  }
  await book.start(step.key, { before: was?.before ?? now });
  await book.write(() => provider.call("clickup", "POST", `task/${step.taskId}/field/${step.fieldId}`, { value: step.value }));
  const back = seen(fieldOf(await readCard(x), step.fieldId), step);
  if (back === "same") {
    await book.set(step.key, "done", { result: "written" });
    return { state: "delivered", progress: book.progress };
  }
  if (back === "other") {
    await book.set(step.key, "skipped", { result: "kept", raced: true });
    return { state: "skipped", progress: book.progress, error: SAY_RESEARCH.raced };
  }
  throw halt("unknown", SAY_RESEARCH.fieldNotBack);
}

/**
 * The one comment: looked for by its marker before it is ever posted (a row before this one, or progress a save lost,
 * may have put it there), posted not notifying, its id booked, then found again by marker and id. Once ClickUp answered
 * with an id it is never posted a second time.
 */
async function writeComment(x: Ctx & { step: Extract<ResearchStep, { type: "comment" }> }): Promise<RequestOutcome> {
  const { provider, book, step, item } = x;
  const st = book.get(step.key);
  const since = () => book.startedAt(step.key, item.created_at) - 60_000;
  if (st?.state === "started") {
    const id = st.commentId ? String(st.commentId) : null;
    const found =
      (await findComment(provider, step.taskId, step.marker, since())) ??
      (id ? await findComment(provider, step.taskId, "", since(), id) : undefined);
    if (found) {
      await book.set(step.key, "done", { commentId: String(found.id) });
      return { state: "delivered", progress: book.progress };
    }
    if (id) throw halt("unknown", SAY_RESEARCH.commentLost);
  }
  await readCard(x);
  if (st?.state !== "started") {
    const queued = Date.parse(item.created_at);
    const found = await findComment(provider, step.taskId, step.marker, Number.isFinite(queued) ? queued - 60_000 : 0);
    if (found) {
      await book.set(step.key, "unchanged", { commentId: String(found.id) });
      return { state: "delivered", progress: book.progress };
    }
  }
  await book.start(step.key);
  const made = await book.write(() =>
    provider.call("clickup", "POST", `task/${step.taskId}/comment`, { comment_text: step.text, notify_all: false }),
  );
  const cid = made?.id === undefined || made?.id === null ? null : String(made.id);
  if (cid) await book.set(step.key, "started", { commentId: cid });
  const back = await findComment(provider, step.taskId, step.marker, since(), cid);
  if (!back) throw halt("unknown", SAY_RESEARCH.commentMissing);
  await book.set(step.key, "done", { commentId: String(back.id) });
  return { state: "delivered", progress: book.progress };
}

/** The sentence for ClickUp's own answer, by what is known to have happened on the card (forms.ts plainOf). */
function plainOf(o: RequestOutcome, status: string | undefined, book: StepBook, key: string): string {
  if (o.state !== "failed") return SAY_RESEARCH.notConfirmed;
  const sentNothing = book.writing || book.get(key) === undefined;
  if (status === "404" && sentNothing) return SAY_RESEARCH.offList;
  return sentNothing ? SAY_RESEARCH.refused : SAY_RESEARCH.readRefused;
}

/** A settled step's outcome again, with no call: a kept field says why. */
function settledOutcome(book: StepBook, key: string): FormOutcome {
  const s = book.get(key) as Row;
  if (s.state === "skipped") return { state: "skipped", progress: book.progress, error: s.raced ? SAY_RESEARCH.raced : SAY_RESEARCH.kept };
  return { state: "delivered", progress: book.progress };
}

/**
 * The row's one write, booked as one StepBook step under its effect key (progress.steps.research_field or
 * .research_comment, which the MI-3 migration mirrors onto the run: field_state written or kept, comment_id). A step
 * already settled is not written again. Unknown means a write may have landed; a read that went unanswered before the
 * step started sent nothing, so that row is a plain retry.
 */
export async function executeResearch(
  item: ResearchItem,
  step: ResearchStep,
  provider: Provider,
  save: Save,
  now: () => number,
): Promise<FormOutcome> {
  const { lastDetail: _earlier, ...progress } = structuredClone(item.progress ?? {}) as Row;
  const book = new StepBook(progress, save, now);
  let raw: unknown = undefined;
  const watched: Provider = {
    call: (p, method, path, body) =>
      provider.call(p, method, path, body).catch(e => {
        raw = e;
        throw e;
      }),
  };
  const x: Ctx = { item, step, provider: watched, book };
  const booked = book.get(step.key);
  if (booked && booked.state !== "started") return settledOutcome(book, step.key);
  try {
    return step.type === "field" ? await writeField({ ...x, step }) : await writeComment({ ...x, step });
  } catch (e) {
    if (e === raw && book.get(step.key) === undefined && errorKind(e) === "unknown")
      return { state: "retry", progress: book.progress, error: errorText(e), plain: SAY_RESEARCH.notConfirmed };
    const status = e === raw ? /rejected the request \((\d{3})/.exec(errorText(e))?.[1] : undefined;
    // A 401 is the token or this card: runResearch asks checkToken before it settles anything. Nothing it answered landed.
    if (status === "401") {
      if (book.writing) book.forget(step.key);
      return { state: "retry", progress: book.progress, error: errorText(e), tokenRefused: true };
    }
    const o = outcomeOf(e, book, step.key);
    const said = (out: RequestOutcome): FormOutcome => {
      if (e === raw) return { ...out, plain: plainOf(out, status, book, step.key) };
      return out.error?.startsWith(SAY.bookkeeping) ? { ...out, plain: SAY.bookkeeping } : out;
    };
    // A 429 on a read once the step has started (the read-back above all) may follow a write that landed: unknown.
    if (o.state === "retry" && !book.writing && book.get(step.key)?.state === "started") return said({ ...o, state: "unknown" });
    return said(o);
  }
}

/** What a held row would write, for the run's planned list: words only, never the link or the comment's text. */
export function planResearch(item: ResearchItem): Row[] {
  const p = item.payload ?? {};
  const key = p.effectKey;
  return [
    {
      queueId: item.id,
      kind: "research",
      taskId: item.task_id ?? null,
      field: key === "research_field" ? "Market Research doc" : key === "research_comment" ? "Market research comment" : String(key ?? "unknown"),
      old: null,
      new:
        key === "research_field"
          ? "the report's Doc link, only if the field is empty or holds an earlier report"
          : key === "research_comment"
            ? `${Number(p.commentChars) || 0} characters, posted once`
            : null,
    },
  ];
}

// --- The doctor's checks, reads only -----------------------------------------------------------------------------

/**
 * Against ClickUp, reads only: the Market Research doc is on the Clients - Mahara list as a url field, and each canary
 * card (the test card when none is set) is on that list. One plain sentence per problem.
 */
export async function researchDoctorChecks(provider: Provider, onlyCards: string[]): Promise<{ problems: string[]; counts: Row }> {
  const problems: string[] = [];
  let fieldType: string | null = null;
  try {
    const r = await provider.call("clickup", "GET", `list/${FORMS_LIST}/field`);
    if (!Array.isArray(r?.fields)) throw new Error("no field list came back");
    const f = (r.fields as Row[]).find(x => x.id === MARKET_RESEARCH_FIELD);
    if (!f) problems.push("Market Research doc (7489dbcc) is not on the Clients - Mahara list in ClickUp, so the research writer would not write it.");
    else {
      fieldType = String(f.type ?? "");
      if (fieldType !== "url")
        problems.push(`Market Research doc is a ${fieldType || "nameless"} field in ClickUp, not a link, so the research writer would not write it.`);
    }
  } catch (e) {
    problems.push(`Could not read the Clients - Mahara fields from ClickUp: ${errorText(e).slice(0, 160)}`);
  }
  const cards = onlyCards.length ? onlyCards : [FORMS_TEST_CARD];
  const onList: string[] = [];
  for (const id of cards) {
    try {
      const t = await provider.call("clickup", "GET", `task/${id}`);
      if (String(t?.list?.id ?? "") === FORMS_LIST) onList.push(id);
      else problems.push(`The test card ${id} is not on the Clients - Mahara list.`);
    } catch (e) {
      problems.push(`Could not read the test card ${id} from ClickUp: ${errorText(e).slice(0, 160)}`);
    }
  }
  return { problems, counts: { fieldType, cards: onList } };
}
