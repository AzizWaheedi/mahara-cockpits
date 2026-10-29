// The 1-1 notes writer: job "forms" (docs/forms/STAGE2B-CONTRACT.md build 1,
// sections 3.3 and 4.1). One queue row of kind 'form' per check-in effect
// the cockpit owns, written by migration 20261029w; four effect keys, in
// Make's order on a client card: the to-do comment, Client Happiness, Last
// POC and Last Check-in Call.
//
// OUTWARD SAFETY. Only CLICKUP_WRITEBACK_APPLY_FORMS exactly "true" opens the
// kind 'form' (formsGate). CLICKUP_WRITEBACK_APPLY, _APPLY_REQUESTS,
// _APPLY_CSM_TICKETS, _APPLY_KPI and _ONLY_TASKS neither open nor narrow it.
// CLICKUP_WRITEBACK_FORMS_ONLY_CARDS (comma-separated client card ids) narrows
// a live run to those cards: the canary value is the internal test card
// 86eywg1cq. A value that holds no card id, or anything but card ids, is an
// error and reads as off, never as every card (FORMS_NOT_A_CARD). The database
// holds the second brake: its claim takes nothing
// unless the writer last reported a live mode, and asks the owner gate
// (cockpit_form_effect_gate) for every row, so a row Make owns again never
// reaches this file.
//
// The comment text is never in the queue payload (Z6): it comes from the
// effect plan through the claim, is checked against the payload's sha256 and
// frozen in the row's steps column before the first write. progress holds
// each step's state and ids only, because the queue's audit trigger copies
// progress whole into cockpit_audit_log.
//
// Retry safety: every write records "started" before the call and "done"
// after its read-back. A comment is found by its marker (Cockpit ref F- and
// the first 10 hex of the response id) before anything is posted again, and
// once ClickUp has answered a comment with its id it is never posted a second
// time. Field writes read the card first and again after the write; dates
// move forward only, by the Kuwait calendar day, never by the millisecond
// (ClickUp keeps a date-only value at its own hour: 03:00Z or 04:00Z). A call
// ClickUp does not answer is unknown once its step has started (the write may
// have landed) and a plain retry before that (nothing was sent to the card).
// A 429 on the write itself is a plain retry (ClickUp refused it); a 429 on a
// read once the step has started, the read-back above all, is unknown.

import type { Provider } from "./queue.ts";
import {
  errorKind,
  errorText,
  fieldMatches,
  findComment,
  halt,
  kuwaitDay,
  noonKuwait,
  outcomeOf,
  type RequestOutcome,
  type Save,
  StepBook,
} from "./requests.ts";
import { CLIENTS_LIST, type Row } from "./rules.ts";

// --- Constants (ClickUp's own ids, 20261027h_checkin_plans.sql) ------------------------------

/** The four effect keys this writer knows, in Make's order on a card. */
export const FORM_KEYS = ["todo_comment", "happiness", "last_poc", "last_checkin_call"] as const;
export type FormKey = (typeof FORM_KEYS)[number];
/** The Clients - Mahara list: the only list a 1-1 notes write may touch. */
export const FORMS_LIST = CLIENTS_LIST;
/** The internal test card the canary runs on (CLICKUP_WRITEBACK_FORMS_ONLY_CARDS at cut-over step 6). */
export const FORMS_TEST_CARD = "86eywg1cq";
export const FORM_FIELDS = {
  happiness: "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
  last_poc: "e183f2ce-8b7a-491a-b160-2287a247758b",
  last_checkin_call: "032203ad-e327-4d76-a0ce-c07496da6486",
} as const;
/** Client Happiness by DEFCON label, as cockpit_form_happiness_option writes the option id. */
export const HAPPINESS_OPTIONS: Record<string, string> = {
  Paused: "67c08bcd-e629-47ab-85ba-3ac4b3796734",
  "At Risk": "f0623c2a-161d-4aa2-8833-d1337c69e1c2",
  Neutral: "46e595a3-17d7-4835-80f9-8a4c578b72a3",
  Happy: "c5d6b01f-5f2b-40c1-afac-5b9f1efab213",
  "Very Happy (testimonial)": "d403adf4-24aa-40f0-a960-05e6a4621ee9",
  Churned: "1c055070-45d6-4a19-ade3-958851313d7c",
};
const FIELD_LABEL: Record<Exclude<FormKey, "todo_comment">, string> = {
  happiness: "Client Happiness",
  last_poc: "Last POC",
  last_checkin_call: "Last Check-in Call",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// --- Copy (plain, active) -------------------------------------------------------------------------

export const SAY_FORMS = {
  offList: "This card is not on the Clients - Mahara list, so nothing was written.",
  mismatch: "The 1-1 notes plan for this write does not match its queue row, so nothing was written. Tell the tech lead.",
  noPlan: "The 1-1 notes plan for this write was not found, so nothing was written. Tell the tech lead.",
  commentMissing: "The 1-1 notes comment did not read back on the card. The next run looks for it by its Cockpit ref.",
  commentLost:
    "ClickUp answered the 1-1 notes comment with its id, but the comment is not on the card now. It is not posted again: check the card in ClickUp.",
  heldOff: "Held: the 1-1 notes writer is off until the switch-over.",
  heldLimited: "Held: the 1-1 notes writer is open only for the test card.",
  noField: (label: string) => `${label} is not on this card in ClickUp, so nothing was written.`,
  noOption: (label: string) => `ClickUp's Client Happiness has no "${label}" option, so nothing was written. The tech lead runs the forms doctor.`,
  notBack: (label: string, what: string) => `${label} did not read back as ${what}. The next run reads it again.`,
  /** Byte for byte the trail's sentence (apps/client-success-cockpit/src/dev/checkinFixtures.ts). */
  stays: (key: "last_poc" | "last_checkin_call", day: string) =>
    `${key === "last_poc" ? "Last POC" : "Last check-in call"} stays ${shortDay(day)}: it is newer than this call.`,
} as const;

/** "26 Oct" from "2026-10-26". */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

// --- Gate ---------------------------------------------------------------------------------------

/** A ClickUp card id, as CLICKUP_WRITEBACK_FORMS_ONLY_CARDS must list them (hermes/client-messages/worker.ts's rule). */
const CARD_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** Never names what the secret holds: it may be a pasted value. */
export const FORMS_NOT_A_CARD =
  "CLICKUP_WRITEBACK_FORMS_ONLY_CARDS names something that is not a card id, so nothing is written to ClickUp. Write card ids separated by commas, nothing else.";

/**
 * The forms switch: CLICKUP_WRITEBACK_APPLY_FORMS exactly "true", narrowed by CLICKUP_WRITEBACK_FORMS_ONLY_CARDS.
 * Only a card list that is unset or empty means every card. Separators or spaces alone, or anything in the list that
 * is not a card id, set `error` and read as off, with no cards: a canary that cannot be read never widens to every
 * client. A trailing comma adds nothing.
 */
export function formsGate(env: (name: string) => string | undefined) {
  const rawCards = String(env("CLICKUP_WRITEBACK_FORMS_ONLY_CARDS") ?? "");
  const listed = rawCards
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const error = rawCards !== "" && (!listed.length || listed.some(c => !CARD_ID.test(c))) ? FORMS_NOT_A_CARD : null;
  const apply = error === null && env("CLICKUP_WRITEBACK_APPLY_FORMS") === "true";
  const onlyCards = new Set(error ? [] : listed);
  return {
    apply,
    onlyCards,
    error,
    mode: (!apply ? "dry_run" : onlyCards.size ? "apply_limited" : "apply") as "dry_run" | "apply_limited" | "apply",
    /** A row is live by its client card (the queue row's task_id). */
    live: (taskId: unknown) => apply && (onlyCards.size === 0 || (typeof taskId === "string" && onlyCards.has(taskId))),
  };
}

/** The forms switch in words, for the doctors' notes. */
export function formsWords(env: (name: string) => string | undefined) {
  const g = formsGate(env);
  const cards = [...g.onlyCards];
  return {
    mode: g.mode,
    cards,
    error: g.error,
    text: g.error
      ? "off, because CLICKUP_WRITEBACK_FORMS_ONLY_CARDS is not a list of card ids"
      : !g.apply
        ? "dry run (they are written only when CLICKUP_WRITEBACK_APPLY_FORMS is true)"
        : cards.length
          ? `apply_limited to the cards ${cards.join(", ")} (CLICKUP_WRITEBACK_FORMS_ONLY_CARDS)`
          : "apply",
  };
}

// --- The database calls (migration 20261029t, service role only) --------------------------------

export function formsDb(rpc: (name: string, params?: Row) => Promise<any>) {
  return {
    claim: (token: string, limit: number) => rpc("cockpit_clickup_writeback_claim_forms", { p_token: token, p_limit: limit }),
    /** Hand a held row back without counting a try: queued, or retry once its steps hold anything. */
    release: (id: string, token: string, planned: unknown[], note: string, nextAttemptAt: string) =>
      rpc("cockpit_clickup_writeback_release", { p_id: id, p_token: token, p_planned: planned, p_note: note, p_next_attempt_at: nextAttemptAt }),
    state: (ok: boolean, note: string, mode: string, onlyCards: string[], counts: Row = {}) =>
      rpc("cockpit_clickup_forms_state", { p_ok: ok, p_note: note, p_mode: mode, p_only_cards: onlyCards, p_counts: counts }),
    doctorInputs: () => rpc("cockpit_clickup_forms_doctor_inputs", {}),
  };
}

// --- Rows and steps -------------------------------------------------------------------------------

export type FormItem = {
  id: string;
  kind: "form";
  payload: Row;
  attempts: number;
  created_at: string;
  task_id: string | null;
  steps?: FormStep[] | null;
  progress?: Row | null;
  state?: string;
  /** The effect behind the row, from the claim: its id, state and plan less the browser lines. */
  effect?: { id: string; state: string; plan: Row } | null;
};

export type FormStep =
  | { key: "todo_comment"; type: "comment"; taskId: string; text: string; marker: string }
  | { key: "happiness"; type: "select"; taskId: string; fieldId: string; optionId: string; label: string }
  | { key: "last_poc" | "last_checkin_call"; type: "date"; taskId: string; fieldId: string; day: string; value: number };

/** The marker that finds a 1-1 notes comment again: Cockpit ref F- and the first 10 hex of the response id. */
export const formMarker = (responseId: string) => `Cockpit ref F-${String(responseId).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 10)}`;

/** The hex sha256 of a text's UTF-8 bytes (drafts.ts, migration 20261029w commentSha256). */
export async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

const isKey = (k: unknown): k is FormKey => typeof k === "string" && (FORM_KEYS as readonly string[]).includes(k);

/**
 * The one write a row makes, checked before any call (4.1): for every effect the payload's card, the row's card
 * and the plan's card are one card; the to-do comment's text matches the payload's sha256; Client Happiness is one
 * of the six options on its field; a date is noon Kuwait of its own day on its own field. A happiness or comment
 * plan has no day. A mismatch fails the row with no call.
 */
export async function formStep(item: FormItem): Promise<{ step: FormStep } | { fail: string }> {
  const p = item.payload ?? {};
  const plan = item.effect?.plan;
  if (!item.effect || !plan || typeof plan !== "object") return { fail: SAY_FORMS.noPlan };
  const key = p.effectKey;
  if (!isKey(key)) return { fail: SAY_FORMS.mismatch };
  const card = item.task_id;
  if (typeof card !== "string" || !card || p.taskId !== card || plan.taskId !== card) return { fail: SAY_FORMS.mismatch };
  if (p.effectId !== undefined && String(p.effectId) !== String(item.effect.id)) return { fail: SAY_FORMS.mismatch };
  if (key === "todo_comment") {
    const text = plan.comment_text;
    if (typeof text !== "string" || !text.trim() || typeof p.commentSha256 !== "string") return { fail: SAY_FORMS.mismatch };
    if ((await sha256(text)) !== p.commentSha256) return { fail: SAY_FORMS.mismatch };
    if (typeof p.responseId !== "string" || !/[0-9a-f]{10}/i.test(p.responseId.replace(/-/g, ""))) return { fail: SAY_FORMS.mismatch };
    const marker = formMarker(p.responseId);
    return { step: { key, type: "comment", taskId: card, text: `${text}\n\n${marker}`, marker } };
  }
  if (plan.field !== FORM_FIELDS[key]) return { fail: SAY_FORMS.mismatch };
  if (key === "happiness") {
    const label = String(plan.label ?? "");
    const optionId = plan.value;
    if (typeof optionId !== "string" || HAPPINESS_OPTIONS[label] !== optionId) return { fail: SAY_FORMS.mismatch };
    return { step: { key, type: "select", taskId: card, fieldId: FORM_FIELDS.happiness, optionId, label } };
  }
  const day = plan.day;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number(plan.value) !== noonKuwait(day)) return { fail: SAY_FORMS.mismatch };
  return { step: { key, type: "date", taskId: card, fieldId: FORM_FIELDS[key], day, value: noonKuwait(day) } };
}

/**
 * The step a row writes: the frozen one once it is saved (a retry posts exactly the same text), else the one just
 * checked. A frozen step for another key, card or field is a mismatch.
 */
export function frozenStep(item: FormItem, fresh: FormStep): FormStep | null {
  const saved = Array.isArray(item.steps) ? item.steps[0] : null;
  if (!saved) return fresh;
  const same = saved.key === fresh.key && saved.type === fresh.type && saved.taskId === fresh.taskId &&
    ("fieldId" in saved ? "fieldId" in fresh && saved.fieldId === fresh.fieldId : true);
  return same ? saved : null;
}

// --- The writer ------------------------------------------------------------------------------------

type Ctx = { item: FormItem; step: FormStep; provider: Provider; book: StepBook };

/** The client card, read fresh: off the Clients - Mahara list or gone is failed with no write. */
async function readCard(x: Ctx): Promise<Row> {
  let card: Row;
  try {
    card = await x.provider.call("clickup", "GET", `task/${x.step.taskId}`);
  } catch (e) {
    if (/rejected the request \(404/.test(errorText(e))) throw halt("failed", SAY_FORMS.offList);
    throw e;
  }
  if (String(card?.list?.id ?? "") !== FORMS_LIST) throw halt("failed", SAY_FORMS.offList);
  return card;
}

const fieldOf = (card: Row, fieldId: string): Row | undefined =>
  (Array.isArray(card.custom_fields) ? card.custom_fields : []).find((f: Row) => f.id === fieldId);

async function writeComment(x: Ctx & { step: Extract<FormStep, { type: "comment" }> }): Promise<RequestOutcome> {
  const { provider, book, step, item } = x;
  const st = book.get(step.key);
  const since = () => book.startedAt(step.key, item.created_at) - 60_000;
  if (st?.state === "started") {
    const found =
      (await findComment(provider, step.taskId, step.marker, since())) ??
      (st.commentId ? await findComment(provider, step.taskId, "", since(), String(st.commentId)) : undefined);
    if (found) {
      await book.set(step.key, "done", { commentId: String(found.id) });
      return { state: "delivered", progress: book.progress };
    }
    // ClickUp gave this comment an id once: a second post would put the notes on the card twice.
    if (st.commentId) throw halt("unknown", SAY_FORMS.commentLost);
  }
  await book.start(step.key);
  const made = await book.write(() =>
    provider.call("clickup", "POST", `task/${step.taskId}/comment`, { comment_text: step.text, notify_all: false }),
  );
  const cid = made?.id === undefined || made?.id === null ? null : String(made.id);
  if (cid) await book.set(step.key, "started", { commentId: cid });
  const back = await findComment(provider, step.taskId, step.marker, since(), cid);
  if (!back) throw halt("unknown", SAY_FORMS.commentMissing);
  await book.set(step.key, "done", { commentId: String(back.id) });
  return { state: "delivered", progress: book.progress };
}

async function writeHappiness(x: Ctx & { step: Extract<FormStep, { type: "select" }> }): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const card = await readCard(x);
  const field = fieldOf(card, step.fieldId);
  if (!field) throw halt("failed", SAY_FORMS.noField(FIELD_LABEL.happiness));
  const options: Row[] = Array.isArray(field.type_config?.options) ? field.type_config.options : [];
  if (!options.some(o => String(o.id) === step.optionId)) throw halt("failed", SAY_FORMS.noOption(step.label));
  // Make's rule: write unless the card already shows it.
  if (fieldMatches(card, step.fieldId, "select", step.optionId)) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  await book.write(() => provider.call("clickup", "POST", `task/${step.taskId}/field/${step.fieldId}`, { value: step.optionId }));
  if (!fieldMatches(await readCard(x), step.fieldId, "select", step.optionId)) throw halt("unknown", SAY_FORMS.notBack(FIELD_LABEL.happiness, step.label));
  await book.set(step.key, "done");
  return { state: "delivered", progress: book.progress };
}

async function writeDate(x: Ctx & { step: Extract<FormStep, { type: "date" }> }): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const label = FIELD_LABEL[step.key];
  const resumed = book.get(step.key)?.state === "started";
  const kept = async (cardDay: string): Promise<RequestOutcome> => {
    await book.set(step.key, "skipped", { cardDay });
    return { state: "skipped", progress: book.progress, error: SAY_FORMS.stays(step.key, cardDay) };
  };
  const card = await readCard(x);
  const field = fieldOf(card, step.fieldId);
  if (!field) throw halt("failed", SAY_FORMS.noField(label));
  const cardDay = kuwaitDay(field.value);
  // Forward only, by the Kuwait day: a newer day on the card stays, the same day needs no write.
  if (cardDay && cardDay > step.day) return kept(cardDay);
  if (cardDay === step.day) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  await book.write(() =>
    provider.call("clickup", "POST", `task/${step.taskId}/field/${step.fieldId}`, { value: step.value, value_options: { time: false } }),
  );
  const backDay = kuwaitDay(fieldOf(await readCard(x), step.fieldId)?.value);
  if (backDay === step.day) {
    await book.set(step.key, "done");
    return { state: "delivered", progress: book.progress };
  }
  // A newer day landed between the read and the write (the Next POC sync, build 6): it stays.
  if (backDay && backDay > step.day) return kept(backDay);
  throw halt("unknown", SAY_FORMS.notBack(label, shortDay(step.day)));
}

/**
 * The row's one write, booked as one StepBook step under the key payload.effectKey (3.6's receipt reads
 * progress.steps[effectKey]). A step already settled is not written again.
 *
 * Unknown means a write may have landed, so it is kept for a step that has started, in this run or an earlier one.
 * A ClickUp 5xx, a timeout or an unreadable answer on a read made before the step started (the card read that opens
 * a field step) cannot have changed the card: that row is a plain retry, so its effect stays queued and the end of
 * the ladder never tells a person to check a card nothing was sent to (review round 2).
 */
export async function executeForm(item: FormItem, step: FormStep, provider: Provider, save: Save, now: () => number): Promise<RequestOutcome> {
  const book = new StepBook(structuredClone(item.progress ?? {}), save, now);
  // The last error ClickUp's own call threw, so a step's own sentence (a halt) or our bookkeeping is never mistaken
  // for a read that went unanswered.
  let raw: unknown = undefined;
  const watched: Provider = {
    call: (p, method, path, body) =>
      provider.call(p, method, path, body).catch(e => {
        raw = e;
        throw e;
      }),
  };
  const x: Ctx = { item, step, provider: watched, book };
  const done = book.get(step.key);
  if (done && done.state !== "started") {
    if (done.state === "skipped" && typeof done.cardDay === "string" && step.type === "date")
      return { state: "skipped", progress: book.progress, error: SAY_FORMS.stays(step.key, done.cardDay) };
    return { state: "delivered", progress: book.progress };
  }
  try {
    if (step.type === "comment") return await writeComment({ ...x, step });
    if (step.type === "select") return await writeHappiness({ ...x, step });
    return await writeDate({ ...x, step });
  } catch (e) {
    if (e === raw && book.get(step.key) === undefined && errorKind(e) === "unknown")
      return { state: "retry", progress: book.progress, error: errorText(e) };
    const o = outcomeOf(e, book, step.key);
    // A 429 (or a missing secret) on a read once the step has started, the read-back after a write that went
    // through above all, is not a plain retry: the write may be on the card, so the row and its effect read
    // unknown, and a rollback or the end of the ladder says to check the card (review round 3). A 429 on the
    // write call itself never landed (book.writing), and one before the step started sent nothing: both stay
    // retry. The run still stops on a 429 settled unknown.
    if (o.state === "retry" && !book.writing && book.get(step.key)?.state === "started") return { ...o, state: "unknown" };
    return o;
  }
}

/** What a held row would write, for the run's planned list: never the comment text. */
export function planForm(item: FormItem): Row[] {
  const p = item.payload ?? {};
  const key = String(p.effectKey ?? "");
  return [
    {
      queueId: item.id,
      kind: "form",
      taskId: item.task_id ?? null,
      field: key === "todo_comment" ? "1-1 notes comment" : (FIELD_LABEL[key as Exclude<FormKey, "todo_comment">] ?? key),
      old: null,
      new: key === "todo_comment" ? `${Number(p.commentChars) || 0} characters` : key === "happiness" ? (p.label ?? null) : (p.day ?? null),
    },
  ];
}

// --- The doctor's checks, reads only ---------------------------------------------------------------

/**
 * Against ClickUp, reads only: the six Client Happiness options the planner writes are on the field (and the
 * database names the same six), Last POC and Last Check-in Call are date fields, the three field ids are the
 * ones the database plans with, and each canary card (the test card when none is set) is on Clients - Mahara.
 */
export async function formsDoctorChecks(inputs: Row, provider: Provider, onlyCards: string[]): Promise<{ problems: string[]; counts: Row }> {
  const problems: string[] = [];
  const dbOptions: Row[] = Array.isArray(inputs?.happinessOptions) ? inputs.happinessOptions : [];
  const wanted = Object.entries(HAPPINESS_OPTIONS);
  if (dbOptions.length && (dbOptions.length !== wanted.length || dbOptions.some(o => HAPPINESS_OPTIONS[String(o.label)] !== String(o.optionId))))
    problems.push("The database and the writer name different Client Happiness options. Re-read 20261027h before any 1-1 notes write.");
  if (inputs?.fields && (inputs.fields.happiness !== FORM_FIELDS.happiness || inputs.fields.lastPoc !== FORM_FIELDS.last_poc ||
      inputs.fields.lastCheckinCall !== FORM_FIELDS.last_checkin_call))
    problems.push("The database and the writer name different ClickUp fields for the 1-1 notes.");
  let fields: Row[] | null = null;
  try {
    const r = await provider.call("clickup", "GET", `list/${FORMS_LIST}/field`);
    if (!Array.isArray(r.fields)) throw new Error("no field list came back");
    fields = r.fields;
  } catch (e) {
    problems.push(`Could not read the Clients - Mahara fields from ClickUp: ${errorText(e).slice(0, 160)}`);
  }
  let options = 0;
  if (fields) {
    const happy = fields.find(f => f.id === FORM_FIELDS.happiness);
    if (!happy) problems.push("Client Happiness is not on the Clients - Mahara list in ClickUp.");
    else {
      const ids = new Set((Array.isArray(happy.type_config?.options) ? happy.type_config.options : []).map((o: Row) => String(o.id)));
      for (const [label, id] of wanted) {
        if (ids.has(id)) options += 1;
        else problems.push(`Client Happiness has no "${label}" option in ClickUp any more, so a 1-1 notes write with it would fail.`);
      }
    }
    for (const key of ["last_poc", "last_checkin_call"] as const) {
      const f = fields.find(x => x.id === FORM_FIELDS[key]);
      if (!f) problems.push(`${FIELD_LABEL[key]} is not on the Clients - Mahara list in ClickUp.`);
      else if (String(f.type) !== "date") problems.push(`${FIELD_LABEL[key]} is a ${String(f.type)} field in ClickUp, not a date.`);
    }
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
  return { problems, counts: { options, fields: fields?.length ?? null, cards: onList } };
}
