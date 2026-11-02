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
// Stage 4 (docs/forms/WAVE56-CONTRACT.md 4.13.4, 4.14): the native kickoff and onboarding add seven effect
// keys on the same rails: the handoff and raw answers comments, the task status IN PROGRESS, two sets of card
// fields (each field read back, a text as long as Make writes it), and the Onboarding Map at phase 3 or 4,
// which never moves back: a card already at that phase or later is kept. The two comments carry Make's text
// alone, with no Cockpit ref (X37, "match Make"). A row of a form not listed in CLICKUP_WRITEBACK_FORMS_KEYS
// (default checkin) is held by run.ts and never written here.
//
// card_facts (better-data plan B8, kickoff and onboarding): an addition on top of Make's output, separate from
// card_fields, that fills five card fields from typed answers ONLY while the card leaves them empty (CARD_FACTS:
// Consultation Types, ADs Platform, Fathom, Onboarding Call Date, Company Website; never Country, Daily Budget or any
// other field). The plan names each field with onlyIfEmpty true; an unknown field id, kind or option fails the row
// with no call. The card is read fresh: an empty field is written and read back, a set field is left as it is
// ("kept", with a note when its value differs from the form's). progress.steps.card_facts.fields is the receipt,
// saved before the first write: for each field id, `before` ("empty" or "set", what the first read saw) and `state`
// ("due", "written" or "kept"), plus `differs` and `note` on a kept field whose value is not the form's. Any kept
// field is said: a row that wrote nothing is skipped with the kept sentence as its reason; a row that wrote some
// fields is delivered with that sentence as its note (the queue row's error, and the step's own `note`, which the
// queue trigger copies into the effect's receipt.step). make_parity
// grades a write over a set value from it ("differs: overwrote a card value"); this writer never makes one.
//
// Retry safety: every write records "started" before the call and "done"
// after its read-back. The to-do comment is found by its marker (Cockpit ref
// F- and the first 10 hex of the response id) before anything is posted
// again; a Stage 4 comment by the id ClickUp answered with, else by its text
// (requests.ts commentKey) among the card's comments since its step started,
// or by the marker a writer before this one appended. Once ClickUp has
// answered a comment with its id it is never posted a second time. Field
// writes read the card first and again after the write; dates
// move forward only, by the Kuwait calendar day, never by the millisecond
// (ClickUp keeps a date-only value at its own hour: 03:00Z or 04:00Z). A call
// ClickUp does not answer is unknown once its step has started (the write may
// have landed) and a plain retry before that (nothing was sent to the card).
// A 429 on the write itself is a plain retry (ClickUp refused it); a 429 on a
// read once the step has started, the read-back above all, is unknown.
// A 401 is either the token or this one card ("Team not authorized" answers per
// card), and nothing the 401 answered landed. So one paced read that does not
// depend on the card tells them apart (checkToken). Refused there too, it is the
// token: the row goes back with no try used and the run stops, because a failed
// row has no requeue path. Answered there, it is the card: the row climbs the
// ladder like any other refusal and ends failed with a plain sentence, so the
// newer rows behind it on the card are not held for good.

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
  SAY,
  type Save,
  sameText,
  StepBook,
} from "./requests.ts";
import { CLIENTS_LIST, type Row } from "./rules.ts";

// --- Constants (ClickUp's own ids, 20261027h_checkin_plans.sql) ------------------------------

/** The four effect keys this writer knows, in Make's order on a card. */
export const FORM_KEYS = [
  "todo_comment",
  "happiness",
  "last_poc",
  "last_checkin_call",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];
/** Stage 4's effect keys (4.13.4): the kickoff's four, the onboarding's three, and card_facts on both (plan B8). */
export const STAGE4_KEYS = [
  "handoff_comment",
  "native_status",
  "card_fields",
  "map_phase4",
  "profile_fields",
  "raw_answers_comment",
  "map_phase3",
  "card_facts",
] as const;
export type Stage4Key = (typeof STAGE4_KEYS)[number];
/** Which form each Stage 4 key belongs to: card_facts comes from either. */
export const STAGE4_FORM: Record<
  Stage4Key,
  "kickoff" | "onboarding" | "either"
> = {
  handoff_comment: "kickoff",
  native_status: "kickoff",
  card_fields: "kickoff",
  map_phase4: "kickoff",
  profile_fields: "onboarding",
  raw_answers_comment: "onboarding",
  map_phase3: "onboarding",
  card_facts: "either",
};
/** The form keys CLICKUP_WRITEBACK_FORMS_KEYS may list. */
export const FORMS_FORM_KEYS = ["checkin", "kickoff", "onboarding"] as const;
/** The Onboarding Map field (a link with ?phase=N). */
export const MAP_FIELD = "51f49cb1-9f76-48be-b639-c42ca552d20a";
/** The only card fields each Stage 4 key may write, with their kinds (20261102j_stage4_native.sql). */
export const STAGE4_FIELDS: Record<
  "card_fields" | "profile_fields",
  Record<string, "drop_down" | "url" | "text">
> = {
  card_fields: {
    "9368ca9e-3549-4320-84ff-9abd0a2901cb": "drop_down",
    "924bba47-32d4-4557-94d4-f475cd548dd2": "drop_down",
    "a1520ef3-ec23-47a4-9584-e24257486a3e": "drop_down",
    "ac976d4a-409b-441c-8c13-4b0e73a0c12f": "drop_down",
    "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc": "drop_down",
    "bc7e70a2-1623-426f-8ed7-fac8fed9b160": "drop_down",
    "cc14ad2d-28ca-4eac-bbef-89b4f299ef8f": "drop_down",
    "d113cd99-9d35-4b12-a8fa-0cd0c19ec777": "drop_down",
    "e7d158a8-e303-4df8-a78a-61a0eb3843eb": "drop_down",
    "f0a20cef-e902-4200-8f55-43431b2574c6": "drop_down",
    "1b7a4a74-d0e7-4a7f-9218-59c80a738186": "url",
  },
  profile_fields: {
    "7755485f-74a8-496c-85d8-562588e77944": "text",
    "87d7d889-afea-42f8-9485-6f3ead5b857f": "url",
  },
};
/** The kinds of field card_facts writes. */
export type CardFactKind = "labels" | "drop_down" | "url" | "date";
/**
 * The ONLY fields card_facts may write (better-data plan B8), with their kinds, the trail's names and, for a labels
 * or dropdown field, the options it may write by id (the s40 snapshot of the Clients - Mahara list; the forms doctor
 * reads them live). Never Country, Daily Budget or any other field.
 */
export const CARD_FACTS: Record<
  string,
  { kind: CardFactKind; label: string; options?: Record<string, string> }
> = {
  "45fdd2ea-f83c-4721-bce7-2e6187a43541": {
    kind: "labels",
    label: "Consultation Types",
    options: {
      "82279634-6601-4dd2-a1bc-af6737260b6b": "In Office",
      "387c686d-5652-4635-abe6-10621f8359b3": "In Home / On Site",
      "d9c0f5a6-6db5-4e97-8dd4-cc80247b96ae": "Online",
    },
  },
  "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9": {
    kind: "drop_down",
    label: "ADs Platform",
    options: {
      "88d55b4b-f296-4a0b-abc6-3b228889444a": "Facebook/Meta",
      "c115bdfe-661f-4855-a86b-69a54b2e616a": "Tiktok",
      "97b22a7b-c18b-4be9-bd03-ff271bacfd77": "Snapchat",
    },
  },
  "abaa31ee-28ff-46f6-83bf-6c6d357a26d5": { kind: "url", label: "Fathom" },
  "ee9bf855-e05b-4afc-addf-1063cb54d3f0": {
    kind: "date",
    label: "Onboarding Call Date",
  },
  "5d57fdde-eb70-4610-a23b-88f718b4451d": {
    kind: "url",
    label: "Company Website",
  },
};
/** The phase an Onboarding Map link points at, or null. */
export function mapPhaseOf(value: unknown): number | null {
  const m = /[?&]phase=(\d+)/.exec(String(value ?? ""));
  return m ? Number(m[1]) : null;
}
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
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// --- Copy (plain, active) -------------------------------------------------------------------------

export const SAY_FORMS = {
  offList:
    "This card is not on the Clients - Mahara list, so nothing was written.",
  /** The three *Started sentences are for a step that has already started: a write may be on the card, so "nothing was written" would be false. */
  offListStarted:
    "This card is not on the Clients - Mahara list now, and a write may have reached it first, so check it in ClickUp.",
  mismatch:
    "The 1-1 notes plan for this write does not match its queue row, so nothing was written. Tell the tech lead.",
  noPlan:
    "The 1-1 notes plan for this write was not found, so nothing was written. Tell the tech lead.",
  commentMissing:
    "The 1-1 notes comment did not read back on the card. The next run looks for it by its Cockpit ref.",
  commentLost:
    "ClickUp answered the 1-1 notes comment with its id, but the comment is not on the card now. It is not posted again: check the card in ClickUp.",
  /** A Stage 4 comment carries no Cockpit ref (X37): it is looked for by its id, else by its text. */
  textMissing: (what: string) =>
    `The ${what} did not read back on the card. The next run looks for it.`,
  textLost: (what: string) =>
    `ClickUp answered the ${what} with its id, but the comment is not on the card now. It is not posted again: check the card in ClickUp.`,
  heldOff: "Held: the 1-1 notes writer is off until the switch-over.",
  /** A row of a form CLICKUP_WRITEBACK_FORMS_KEYS does not list (4.13.4). */
  heldForm: (form: string) => `Held: ${form} card writes are not switched on.`,
  /** The Onboarding Map never moves back (4.13.4). */
  mapKept: (phase: number) => `kept: the map is already at phase ${phase}`,
  noFieldOption: (label: string, name: string) =>
    `ClickUp's ${label} has no "${name}" option, so nothing was written. The tech lead runs the forms doctor.`,
  noFieldOptionStarted: (label: string, name: string) =>
    `ClickUp's ${label} has no "${name}" option now, and a write may have reached the card first, so check it in ClickUp. The tech lead runs the forms doctor.`,
  /** card_facts (plan B8): what the trail reads when every field it would fill is already set on the card. */
  factsKept: (kept: string[], differs: string[]) =>
    `kept: the card already has a value for ${listWords(kept)}${
      differs.length
        ? `; ${listWords(differs)} ${differs.length === 1 ? "differs" : "differ"} from the form, so check ${differs.length === 1 ? "it" : "them"} on the card`
        : ""
    }`,
  /** A kept card_facts field's note in the receipt, never its value. */
  factDiffers: "kept: the card already has another value",
  factRaced: "kept: another value reached the card during this write",
  statusNotBack:
    "The task status did not read back as IN PROGRESS. The next run reads it again.",
  heldLimited: "Held: the 1-1 notes writer is open only for the test card.",
  noField: (label: string) =>
    `${label} is not on this card in ClickUp, so nothing was written.`,
  noFieldStarted: (label: string) =>
    `${label} is not on this card in ClickUp now, and a write may have reached it first, so check it in ClickUp.`,
  noOption: (label: string) =>
    `ClickUp's Client Happiness has no "${label}" option, so nothing was written. The tech lead runs the forms doctor.`,
  noOptionStarted: (label: string) =>
    `ClickUp's Client Happiness has no "${label}" option now, and a write may have reached the card first, so check it in ClickUp. The tech lead runs the forms doctor.`,
  notBack: (label: string, what: string) =>
    `${label} did not read back as ${what}. The next run reads it again.`,
  /** Byte for byte the trail's sentence (apps/client-success-cockpit/src/dev/checkinFixtures.ts). */
  stays: (key: "last_poc" | "last_checkin_call", day: string) =>
    `${key === "last_poc" ? "Last POC" : "Last check-in call"} stays ${shortDay(day)}: it is newer than this call.`,
  /** What a CSM reads on the trail in place of ClickUp's own sentence: the trail adds "The cockpit checks before it tries again." or "Tell the tech lead." */
  notConfirmed: "ClickUp did not confirm this write.",
  refused: "ClickUp refused this write.",
  readRefused:
    "ClickUp refused the read after this write, so check the card in ClickUp.",
  tokenRefused:
    "ClickUp refused the cockpit's token (401), so the writes wait and use no try. Check CLICKUP_API_TOKEN.",
  /** The token answers elsewhere and this card keeps refusing it: where such a row ends, on the effect's trail too. */
  cardRefused:
    "ClickUp refused this card to the cockpit's token, so nothing was written.",
  tokenUnsure:
    "ClickUp refused a card and did not answer the check on the cockpit's token, so the writes wait and use no try. The next run checks again.",
} as const;

/** "A", "A and B", "A, B and C". */
function listWords(words: string[]): string {
  return words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

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
  const error =
    rawCards !== "" && (!listed.length || listed.some(c => !CARD_ID.test(c)))
      ? FORMS_NOT_A_CARD
      : null;
  const apply =
    error === null && env("CLICKUP_WRITEBACK_APPLY_FORMS") === "true";
  const onlyCards = new Set(error ? [] : listed);
  return {
    apply,
    onlyCards,
    error,
    mode: (!apply ? "dry_run" : onlyCards.size ? "apply_limited" : "apply") as
      | "dry_run"
      | "apply_limited"
      | "apply",
    /** A row is live by its client card (the queue row's task_id). */
    live: (taskId: unknown) =>
      apply &&
      (onlyCards.size === 0 ||
        (typeof taskId === "string" && onlyCards.has(taskId))),
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

/** Never names what the secret holds. */
export const FORMS_KEYS_BAD =
  "CLICKUP_WRITEBACK_FORMS_KEYS names something that is not checkin, kickoff or onboarding, so only checkin is written.";

/**
 * Which forms' card writes are on: CLICKUP_WRITEBACK_FORMS_KEYS, a comma list of checkin, kickoff and onboarding,
 * checkin when unset (4.13.4). A list with anything else keeps checkin alone and says so: it never widens.
 */
export function formsKeysGate(env: (name: string) => string | undefined) {
  const raw = env("CLICKUP_WRITEBACK_FORMS_KEYS");
  const blank = raw === undefined || raw.trim() === "";
  const listed = String(raw ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const bad =
    !blank &&
    (!listed.length ||
      listed.some(k => !(FORMS_FORM_KEYS as readonly string[]).includes(k)));
  const keys = new Set<string>(blank || bad ? ["checkin"] : listed);
  return {
    keys,
    error: bad ? FORMS_KEYS_BAD : null,
    has: (form: unknown) => keys.has(String(form ?? "checkin")),
  };
}

// --- The database calls (migration 20261029t, service role only) --------------------------------

export function formsDb(rpc: (name: string, params?: Row) => Promise<any>) {
  return {
    claim: (token: string, limit: number) =>
      rpc("cockpit_clickup_writeback_claim_forms", {
        p_token: token,
        p_limit: limit,
      }),
    /** Hand a held row back without counting a try: queued, or retry once its steps hold anything. */
    release: (
      id: string,
      token: string,
      planned: unknown[],
      note: string,
      nextAttemptAt: string,
    ) =>
      rpc("cockpit_clickup_writeback_release", {
        p_id: id,
        p_token: token,
        p_planned: planned,
        p_note: note,
        p_next_attempt_at: nextAttemptAt,
      }),
    state: (
      ok: boolean,
      note: string,
      mode: string,
      onlyCards: string[],
      counts: Row = {},
    ) =>
      rpc("cockpit_clickup_forms_state", {
        p_ok: ok,
        p_note: note,
        p_mode: mode,
        p_only_cards: onlyCards,
        p_counts: counts,
      }),
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
  | {
      key: "todo_comment" | "handoff_comment" | "raw_answers_comment";
      type: "comment";
      taskId: string;
      /** What is posted: the to-do comment with its marker last, a Stage 4 comment as Make's text alone. */
      text: string;
      /** The to-do comment's own marker; for a Stage 4 comment, the line a writer before this one appended. */
      marker: string;
    }
  | {
      key: "happiness";
      type: "select";
      taskId: string;
      fieldId: string;
      optionId: string;
      label: string;
    }
  | {
      key: "last_poc" | "last_checkin_call";
      type: "date";
      taskId: string;
      fieldId: string;
      day: string;
      value: number;
    }
  | { key: "native_status"; type: "status"; taskId: string; status: string }
  | {
      key: "card_fields" | "profile_fields";
      type: "fields";
      taskId: string;
      fields: CardField[];
    }
  | {
      key: "map_phase3" | "map_phase4";
      type: "map";
      taskId: string;
      fieldId: string;
      value: string;
      phase: number;
    }
  | { key: "card_facts"; type: "facts"; taskId: string; fields: CardFact[] };

/**
 * One field card_facts fills while the card leaves it empty: labels by option ids, a dropdown by option id, a link,
 * or a date as its Kuwait day (written at noon Kuwait). `label` is CARD_FACTS' name for it, never the plan's.
 */
export type CardFact = {
  fieldId: string;
  kind: CardFactKind;
  label: string;
  optionIds?: string[];
  optionId?: string;
  value?: string;
  day?: string;
};

/** One field's line in card_facts' receipt (progress.steps.card_facts.fields[fieldId]): states and notes, never values. */
export type FactReceipt = {
  before: "empty" | "set";
  state: "due" | "written" | "kept";
  differs?: true;
  note?: string;
};

/** One card field a Stage 4 key writes: a dropdown by option id or name, a link or a text. */
export type CardField = {
  fieldId: string;
  kind: "drop_down" | "url" | "text";
  label: string;
  optionId?: string;
  optionName?: string;
  value?: string;
};

/** The marker that finds a 1-1 notes comment again: Cockpit ref F- and the first 10 hex of the response id. */
export const formMarker = (responseId: string) =>
  `Cockpit ref F-${String(responseId)
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 10)}`;

/** The hex sha256 of a text's UTF-8 bytes (drafts.ts, migration 20261029w commentSha256). */
export async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(digest), b =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const isKey = (k: unknown): k is FormKey =>
  typeof k === "string" && (FORM_KEYS as readonly string[]).includes(k);
const isStage4 = (k: unknown): k is Stage4Key =>
  typeof k === "string" && (STAGE4_KEYS as readonly string[]).includes(k);
const HTTPS = /^https:\/\/\S+$/;
/** The Stage 4 comments that mirror Make's (Make 12 [11], Make 13 [47]): posted as Make's text alone (X37). */
const MAKE_TEXT_KEYS = new Set<string>([
  "handoff_comment",
  "raw_answers_comment",
]);

/**
 * Stage 4's check of one row (4.13.4): its form, its card, its comment's sha256, and only its own fields. A text
 * field is written as long as Make writes it (Make 13 [29] writes the Client Profile uncut, X37): only its kind and,
 * for a link, https are checked, and a value ClickUp itself refuses is reported as any refusal is.
 */
async function stage4Step(
  item: FormItem,
  key: Stage4Key,
): Promise<{ step: FormStep } | { fail: string }> {
  const p = item.payload ?? {};
  const plan = item.effect?.plan ?? {};
  const card = item.task_id as string;
  const form = STAGE4_FORM[key];
  if (
    form === "either"
      ? p.formKey !== "kickoff" && p.formKey !== "onboarding"
      : p.formKey !== form
  )
    return { fail: SAY_FORMS.mismatch };
  if (key === "handoff_comment" || key === "raw_answers_comment") {
    const text = plan.comment_text;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      typeof p.commentSha256 !== "string"
    )
      return { fail: SAY_FORMS.mismatch };
    if ((await sha256(text)) !== p.commentSha256)
      return { fail: SAY_FORMS.mismatch };
    if (
      typeof p.responseId !== "string" ||
      !/[0-9a-f]{10}/i.test(p.responseId.replace(/-/g, ""))
    )
      return { fail: SAY_FORMS.mismatch };
    // Make's text alone. The marker is kept on the step only to find a comment a writer before this one posted
    // with it (writeComment).
    return {
      step: {
        key,
        type: "comment",
        taskId: card,
        text,
        marker: formMarker(p.responseId),
      },
    };
  }
  if (key === "native_status") {
    if (plan.status !== "IN PROGRESS") return { fail: SAY_FORMS.mismatch };
    return {
      step: { key, type: "status", taskId: card, status: "IN PROGRESS" },
    };
  }
  if (key === "map_phase3" || key === "map_phase4") {
    const phase = key === "map_phase3" ? 3 : 4;
    const value = plan.value;
    if (
      plan.fieldId !== MAP_FIELD ||
      Number(plan.phase) !== phase ||
      typeof value !== "string" ||
      !HTTPS.test(value) ||
      mapPhaseOf(value) !== phase
    )
      return { fail: SAY_FORMS.mismatch };
    return {
      step: {
        key,
        type: "map",
        taskId: card,
        fieldId: MAP_FIELD,
        value,
        phase,
      },
    };
  }
  if (key === "card_facts") return factsStep(plan, card);
  const allowed = STAGE4_FIELDS[key];
  const raw: Row[] = Array.isArray(plan.fields) ? plan.fields : [];
  if (!raw.length) return { fail: SAY_FORMS.mismatch };
  const fields: CardField[] = [];
  for (const f of raw) {
    const kind = allowed[String(f?.fieldId)];
    if (!kind || f.kind !== kind || typeof f.label !== "string")
      return { fail: SAY_FORMS.mismatch };
    if (kind === "drop_down") {
      if (typeof f.optionId !== "string" && typeof f.optionName !== "string")
        return { fail: SAY_FORMS.mismatch };
      fields.push({
        fieldId: f.fieldId,
        kind,
        label: f.label,
        optionId: f.optionId,
        optionName: f.optionName,
      });
    } else {
      if (
        typeof f.value !== "string" ||
        (kind === "url" && !HTTPS.test(f.value))
      )
        return { fail: SAY_FORMS.mismatch };
      fields.push({ fieldId: f.fieldId, kind, label: f.label, value: f.value });
    }
  }
  return { step: { key, type: "fields", taskId: card, fields } };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day as written, when it is one ("2026-02-30" is not). */
function realDay(d: unknown): string | null {
  if (typeof d !== "string" || !DAY.test(d)) return null;
  const ms = Date.parse(`${d}T09:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d
    ? d
    : null;
}
/** An instant with its zone written out ("...Z" or "...+03:00"); one without a zone could be any day. */
const ZONED =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
/**
 * A card_facts date's Kuwait day: the plan's value as "YYYY-MM-DD", or an instant (milliseconds, or ISO with its
 * zone, as a call's starts_at) read as its Kuwait day. With `day` the plan names, both must be one day. A day outside
 * 2020 to 2099 (seconds taken for milliseconds read as 1970) is null, as is anything else.
 */
function factDay(f: Row): string | null {
  const v = f.value;
  let day: string | null = null;
  if (typeof v === "string" && DAY.test(v)) day = realDay(v);
  else if (typeof v === "string" && ZONED.test(v))
    day = kuwaitDay(Date.parse(v));
  else if (
    (typeof v === "number" && Number.isInteger(v)) ||
    (typeof v === "string" && /^\d{1,16}$/.test(v))
  )
    day = kuwaitDay(Number(v));
  if (!day || day < "2020-01-01" || day > "2099-12-31") return null;
  return f.day === undefined || realDay(f.day) === day ? day : null;
}

/**
 * card_facts' check before any call (plan B8): one to five fields, each in CARD_FACTS with its own kind, onlyIfEmpty
 * true, a label, and a value of its kind: labels by known option ids, a dropdown by one known option id, a link on
 * https, a date as a real day. A field twice, an unknown field id, kind or option, or anything else fails the row.
 */
function factsStep(
  plan: Row,
  card: string,
): { step: FormStep } | { fail: string } {
  const raw: Row[] = Array.isArray(plan.fields) ? plan.fields : [];
  const no = { fail: SAY_FORMS.mismatch };
  if (!raw.length || raw.length > Object.keys(CARD_FACTS).length) return no;
  const fields: CardFact[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const fieldId = String(f?.fieldId ?? "");
    const known = Object.hasOwn(CARD_FACTS, fieldId)
      ? CARD_FACTS[fieldId]
      : undefined;
    if (
      !known ||
      seen.has(fieldId) ||
      f.kind !== known.kind ||
      f.onlyIfEmpty !== true ||
      typeof f.label !== "string"
    )
      return no;
    seen.add(fieldId);
    const base = { fieldId, kind: known.kind, label: known.label };
    const option = (id: unknown) =>
      typeof id === "string" &&
      known.options !== undefined &&
      Object.hasOwn(known.options, id);
    if (known.kind === "labels") {
      const ids: unknown[] = Array.isArray(f.optionIds) ? f.optionIds : [];
      if (!ids.length || !ids.every(option) || new Set(ids).size !== ids.length)
        return no;
      fields.push({ ...base, optionIds: ids as string[] });
    } else if (known.kind === "drop_down") {
      if (!option(f.optionId)) return no;
      fields.push({ ...base, optionId: f.optionId });
    } else if (known.kind === "url") {
      if (typeof f.value !== "string" || !HTTPS.test(f.value)) return no;
      fields.push({ ...base, value: f.value });
    } else {
      const day = factDay(f);
      if (!day) return no;
      fields.push({ ...base, day });
    }
  }
  return { step: { key: "card_facts", type: "facts", taskId: card, fields } };
}

/**
 * The one write a row makes, checked before any call (4.1): for every effect the payload's card, the row's card
 * and the plan's card are one card; the to-do comment's text matches the payload's sha256; Client Happiness is one
 * of the six options on its field; a date is noon Kuwait of its own day on its own field. A happiness or comment
 * plan has no day. A mismatch fails the row with no call.
 */
export async function formStep(
  item: FormItem,
): Promise<{ step: FormStep } | { fail: string }> {
  const p = item.payload ?? {};
  const plan = item.effect?.plan;
  if (!item.effect || !plan || typeof plan !== "object")
    return { fail: SAY_FORMS.noPlan };
  const key = p.effectKey;
  if (!isKey(key) && !isStage4(key)) return { fail: SAY_FORMS.mismatch };
  const card = item.task_id;
  if (
    typeof card !== "string" ||
    !card ||
    p.taskId !== card ||
    plan.taskId !== card
  )
    return { fail: SAY_FORMS.mismatch };
  if (p.effectId !== undefined && String(p.effectId) !== String(item.effect.id))
    return { fail: SAY_FORMS.mismatch };
  if (isStage4(key)) return stage4Step(item, key);
  if (key === "todo_comment") {
    const text = plan.comment_text;
    if (
      typeof text !== "string" ||
      !text.trim() ||
      typeof p.commentSha256 !== "string"
    )
      return { fail: SAY_FORMS.mismatch };
    if ((await sha256(text)) !== p.commentSha256)
      return { fail: SAY_FORMS.mismatch };
    if (
      typeof p.responseId !== "string" ||
      !/[0-9a-f]{10}/i.test(p.responseId.replace(/-/g, ""))
    )
      return { fail: SAY_FORMS.mismatch };
    const marker = formMarker(p.responseId);
    return {
      step: {
        key,
        type: "comment",
        taskId: card,
        text: `${text}\n\n${marker}`,
        marker,
      },
    };
  }
  if (plan.field !== FORM_FIELDS[key]) return { fail: SAY_FORMS.mismatch };
  if (key === "happiness") {
    const label = String(plan.label ?? "");
    const optionId = plan.value;
    if (typeof optionId !== "string" || HAPPINESS_OPTIONS[label] !== optionId)
      return { fail: SAY_FORMS.mismatch };
    return {
      step: {
        key,
        type: "select",
        taskId: card,
        fieldId: FORM_FIELDS.happiness,
        optionId,
        label,
      },
    };
  }
  const day = plan.day;
  if (
    typeof day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number(plan.value) !== noonKuwait(day)
  )
    return { fail: SAY_FORMS.mismatch };
  return {
    step: {
      key,
      type: "date",
      taskId: card,
      fieldId: FORM_FIELDS[key],
      day,
      value: noonKuwait(day),
    },
  };
}

/**
 * The step a row writes: the frozen one once it is saved (a retry posts exactly the same text), else the one just
 * checked. A frozen step for another key, card or field is a mismatch.
 */
export function frozenStep(item: FormItem, fresh: FormStep): FormStep | null {
  const saved = Array.isArray(item.steps) ? item.steps[0] : null;
  if (!saved) return fresh;
  const same =
    saved.key === fresh.key &&
    saved.type === fresh.type &&
    saved.taskId === fresh.taskId &&
    ("fieldId" in saved
      ? "fieldId" in fresh && saved.fieldId === fresh.fieldId
      : true);
  return same ? saved : null;
}

// --- The writer ------------------------------------------------------------------------------------

type Ctx = {
  item: FormItem;
  step: FormStep;
  provider: Provider;
  book: StepBook;
};

/**
 * Has this step started, in this run or an earlier one? Then a write may be on the card: a resume after a POST that
 * went unanswered, or the read-back straight after one ClickUp answered. Only a step with nothing booked has sent
 * nothing, so only that step may say "nothing was written" (break-it review; plainOf draws the same line).
 */
const hasStarted = (x: Ctx) => x.book.get(x.step.key) !== undefined;

/** The client card, read fresh: off the Clients - Mahara list or gone is failed, and no write follows. */
async function readCard(x: Ctx): Promise<Row> {
  const off = () =>
    halt(
      "failed",
      hasStarted(x) ? SAY_FORMS.offListStarted : SAY_FORMS.offList,
    );
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
  (Array.isArray(card.custom_fields) ? card.custom_fields : []).find(
    (f: Row) => f.id === fieldId,
  );

/**
 * The text a Stage 4 comment posts: Make's alone. A step a writer before this one froze ends with its Cockpit ref
 * line, which is not posted again.
 */
export function makeText(step: Extract<FormStep, { type: "comment" }>): string {
  const line = `\n\n${step.marker}`;
  return step.text.endsWith(line)
    ? step.text.slice(0, -line.length)
    : step.text;
}

async function writeComment(
  x: Ctx & { step: Extract<FormStep, { type: "comment" }> },
): Promise<RequestOutcome> {
  const { provider, book, step, item } = x;
  const st = book.get(step.key);
  const since = () => book.startedAt(step.key, item.created_at) - 60_000;
  const mirrorsMake = MAKE_TEXT_KEYS.has(step.key);
  const text = mirrorsMake ? makeText(step) : step.text;
  const what = mirrorsMake
    ? STAGE4_WORDS[step.key as Stage4Key].toLowerCase()
    : "";
  // The to-do comment is found by its marker (and its id, once ClickUp gave one). A Stage 4 comment carries no
  // marker: with an id from ClickUp it is found by that id alone, else by its text since the step started, or by
  // the marker a writer before this one appended.
  const match = (id: string | null) =>
    !mirrorsMake ? step.marker : id ? "" : sameText(text, since(), step.marker);
  if (st?.state === "started") {
    const id = st.commentId ? String(st.commentId) : null;
    const found = mirrorsMake
      ? await findComment(provider, step.taskId, match(id), since(), id)
      : ((await findComment(provider, step.taskId, step.marker, since())) ??
        (id
          ? await findComment(provider, step.taskId, "", since(), id)
          : undefined));
    if (found) {
      await book.set(step.key, "done", { commentId: String(found.id) });
      return { state: "delivered", progress: book.progress };
    }
    // ClickUp gave this comment an id once: a second post would put it on the card twice.
    if (id)
      throw halt(
        "unknown",
        mirrorsMake ? SAY_FORMS.textLost(what) : SAY_FORMS.commentLost,
      );
  }
  await book.start(step.key);
  const made = await book.write(() =>
    provider.call("clickup", "POST", `task/${step.taskId}/comment`, {
      comment_text: text,
      notify_all: false,
    }),
  );
  const cid =
    made?.id === undefined || made?.id === null ? null : String(made.id);
  if (cid) await book.set(step.key, "started", { commentId: cid });
  const back = await findComment(
    provider,
    step.taskId,
    match(cid),
    since(),
    cid,
  );
  if (!back)
    throw halt(
      "unknown",
      mirrorsMake ? SAY_FORMS.textMissing(what) : SAY_FORMS.commentMissing,
    );
  await book.set(step.key, "done", { commentId: String(back.id) });
  return { state: "delivered", progress: book.progress };
}

async function writeHappiness(
  x: Ctx & { step: Extract<FormStep, { type: "select" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const card = await readCard(x);
  const field = fieldOf(card, step.fieldId);
  if (!field)
    throw halt(
      "failed",
      resumed
        ? SAY_FORMS.noFieldStarted(FIELD_LABEL.happiness)
        : SAY_FORMS.noField(FIELD_LABEL.happiness),
    );
  const options: Row[] = Array.isArray(field.type_config?.options)
    ? field.type_config.options
    : [];
  if (!options.some(o => String(o.id) === step.optionId))
    throw halt(
      "failed",
      resumed
        ? SAY_FORMS.noOptionStarted(step.label)
        : SAY_FORMS.noOption(step.label),
    );
  // Make's rule: write unless the card already shows it.
  if (fieldMatches(card, step.fieldId, "select", step.optionId)) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  await book.write(() =>
    provider.call(
      "clickup",
      "POST",
      `task/${step.taskId}/field/${step.fieldId}`,
      { value: step.optionId },
    ),
  );
  if (!fieldMatches(await readCard(x), step.fieldId, "select", step.optionId))
    throw halt("unknown", SAY_FORMS.notBack(FIELD_LABEL.happiness, step.label));
  await book.set(step.key, "done");
  return { state: "delivered", progress: book.progress };
}

async function writeDate(
  x: Ctx & { step: Extract<FormStep, { type: "date" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const label = FIELD_LABEL[step.key];
  const resumed = book.get(step.key)?.state === "started";
  const kept = async (cardDay: string): Promise<RequestOutcome> => {
    await book.set(step.key, "skipped", { cardDay });
    return {
      state: "skipped",
      progress: book.progress,
      error: SAY_FORMS.stays(step.key, cardDay),
    };
  };
  const card = await readCard(x);
  const field = fieldOf(card, step.fieldId);
  if (!field)
    throw halt(
      "failed",
      resumed ? SAY_FORMS.noFieldStarted(label) : SAY_FORMS.noField(label),
    );
  const cardDay = kuwaitDay(field.value);
  // Forward only, by the Kuwait day: a newer day on the card stays, the same day needs no write.
  if (cardDay && cardDay > step.day) return kept(cardDay);
  if (cardDay === step.day) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  await book.write(() =>
    provider.call(
      "clickup",
      "POST",
      `task/${step.taskId}/field/${step.fieldId}`,
      { value: step.value, value_options: { time: false } },
    ),
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

async function writeStatus(
  x: Ctx & { step: Extract<FormStep, { type: "status" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const shows = (card: Row) =>
    String(card?.status?.status ?? "").toLowerCase() ===
    step.status.toLowerCase();
  if (shows(await readCard(x))) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  await book.write(() =>
    provider.call("clickup", "PUT", `task/${step.taskId}`, {
      status: step.status,
    }),
  );
  if (!shows(await readCard(x))) throw halt("unknown", SAY_FORMS.statusNotBack);
  await book.set(step.key, "done");
  return { state: "delivered", progress: book.progress };
}

/** A dropdown's option id on this card's field, by id or by name; null when ClickUp has no such option. */
function optionOf(field: Row, f: CardField): string | null {
  const options: Row[] = Array.isArray(field.type_config?.options)
    ? field.type_config.options
    : [];
  const hit = f.optionId
    ? options.find(o => String(o.id) === f.optionId)
    : options.find(o => String(o.name) === f.optionName);
  return hit ? String(hit.id) : null;
}

/** Card fields (4.13.3 card_fields, 4.14.3 profile_fields): each field read first, written when it differs, all read back. */
async function writeFields(
  x: Ctx & { step: Extract<FormStep, { type: "fields" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const card = await readCard(x);
  const plan: {
    fieldId: string;
    kind: string;
    value: string;
    label: string;
  }[] = [];
  for (const f of step.fields) {
    const field = fieldOf(card, f.fieldId);
    if (!field)
      throw halt(
        "failed",
        resumed
          ? SAY_FORMS.noFieldStarted(f.label)
          : SAY_FORMS.noField(f.label),
      );
    if (f.kind === "drop_down") {
      const id = optionOf(field, f);
      if (!id)
        throw halt(
          "failed",
          SAY_FORMS.noFieldOption(f.label, f.optionName ?? f.optionId ?? ""),
        );
      plan.push({
        fieldId: f.fieldId,
        kind: "select",
        value: id,
        label: f.label,
      });
    } else
      plan.push({
        fieldId: f.fieldId,
        kind: "text",
        value: f.value ?? "",
        label: f.label,
      });
  }
  const due = plan.filter(w => !fieldMatches(card, w.fieldId, w.kind, w.value));
  if (!due.length) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  await book.start(step.key);
  for (const w of due)
    await book.write(() =>
      provider.call(
        "clickup",
        "POST",
        `task/${step.taskId}/field/${w.fieldId}`,
        {
          value: w.value,
        },
      ),
    );
  const back = await readCard(x);
  const missing = plan.find(
    w => !fieldMatches(back, w.fieldId, w.kind, w.value),
  );
  if (missing)
    throw halt("unknown", SAY_FORMS.notBack(missing.label, "written"));
  await book.set(step.key, "done");
  return { state: "delivered", progress: book.progress };
}

// --- card_facts (plan B8): fill a field only while the card leaves it empty -------------------------

/** Nothing on the card in this field: no value, an empty text, or no labels. */
function factEmpty(field: Row): boolean {
  const v = field.value;
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Does the card's field hold exactly what this fact writes? Labels as a set of option ids, a dropdown by id or orderindex, a date by its Kuwait day. */
function factMatches(card: Row, f: CardFact): boolean {
  const field = fieldOf(card, f.fieldId);
  if (!field || factEmpty(field)) return false;
  const v = field.value;
  if (f.kind === "labels") {
    const on = (Array.isArray(v) ? v : []).map((x: unknown) =>
      String(x !== null && typeof x === "object" ? (x as Row).id : x),
    );
    const want = f.optionIds ?? [];
    return (
      new Set(on).size === want.length && want.every(id => on.includes(id))
    );
  }
  if (f.kind === "drop_down")
    return fieldMatches(card, f.fieldId, "select", f.optionId);
  if (f.kind === "date") return kuwaitDay(v) === f.day;
  return String(v).trim() === String(f.value ?? "").trim();
}

/** What ClickUp is sent for one fact: a date at noon Kuwait as a date-only value, as the check-in dates are. */
function factBody(f: CardFact): Row {
  if (f.kind === "labels") return { value: f.optionIds };
  if (f.kind === "drop_down") return { value: f.optionId };
  if (f.kind === "date")
    return { value: noonKuwait(String(f.day)), value_options: { time: false } };
  return { value: f.value };
}

/** The receipt's fields as saved, when the step has started before. */
function savedReceipt(saved: Row | undefined): Record<string, FactReceipt> {
  const f = saved?.fields;
  return f && typeof f === "object" && !Array.isArray(f)
    ? structuredClone(f)
    : {};
}

/** The trail's kept sentence for a card_facts row: which fields the card already had, and which differ. */
function factsKeptSaid(
  step: Extract<FormStep, { type: "facts" }>,
  receipt: Record<string, FactReceipt>,
): string {
  const kept = step.fields.filter(f => receipt[f.fieldId]?.state === "kept");
  return SAY_FORMS.factsKept(
    kept.map(f => f.label),
    kept.filter(f => receipt[f.fieldId]?.differs).map(f => f.label),
  );
}

/**
 * A delivered card_facts row's note (plan B8): the same kept sentence when it wrote some fields and kept others, so a
 * kept field, and one whose value differs from the form's above all, is said on a delivered row too. None when
 * nothing was kept.
 */
function factsKeptNote(
  step: Extract<FormStep, { type: "facts" }>,
  receipt: Record<string, FactReceipt>,
): string | undefined {
  return step.fields.some(f => receipt[f.fieldId]?.state === "kept")
    ? factsKeptSaid(step, receipt)
    : undefined;
}

/**
 * card_facts (plan B8): the card read fresh, each field written only when it is empty and read back; a set field is
 * left as it is ("kept", noted when its value is not the form's). The receipt (progress.steps.card_facts.fields) is
 * saved before the first write and keeps what the FIRST read saw, so a resume never takes this writer's own value for
 * one the card already had: a field it found empty and now holds the form's value is written; still empty, it is
 * written again (the same value, so nothing doubles); holding another value, another writer filled it meanwhile and
 * it is kept. Every field and option is checked on the card before anything is written. Nothing written at all reads
 * "skipped" with the trail's kept sentence, as the map's kept row does. Some written and some kept reads "delivered"
 * with that sentence as its note, saved on the step too (progress.steps.card_facts.note).
 */
async function writeFacts(
  x: Ctx & { step: Extract<FormStep, { type: "facts" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const first = savedReceipt(book.get(step.key));
  const card = await readCard(x);
  for (const f of step.fields)
    if (!fieldOf(card, f.fieldId))
      throw halt(
        "failed",
        resumed
          ? SAY_FORMS.noFieldStarted(f.label)
          : SAY_FORMS.noField(f.label),
      );
  const receipt: Record<string, FactReceipt> = {};
  const due: CardFact[] = [];
  const differs = (raced: boolean): FactReceipt => ({
    before: raced ? "empty" : "set",
    state: "kept",
    differs: true,
    note: raced ? SAY_FORMS.factRaced : SAY_FORMS.factDiffers,
  });
  for (const f of step.fields) {
    const was = first[f.fieldId]?.before;
    const field = fieldOf(card, f.fieldId) as Row;
    if (was === "set") receipt[f.fieldId] = first[f.fieldId];
    else if (factEmpty(field)) {
      receipt[f.fieldId] = { before: "empty", state: "due" };
      due.push(f);
    } else if (was === "empty")
      // Found empty before this writer's write: its own value is "written"; another value got there meanwhile.
      receipt[f.fieldId] = factMatches(card, f)
        ? { before: "empty", state: "written" }
        : differs(true);
    else
      receipt[f.fieldId] = factMatches(card, f)
        ? { before: "set", state: "kept" }
        : differs(false);
  }
  // Every option the writes send is on its field now, before anything is written.
  for (const f of due) {
    if (f.kind !== "labels" && f.kind !== "drop_down") continue;
    const options = fieldOf(card, f.fieldId)?.type_config?.options;
    const on: Row[] = Array.isArray(options) ? options : [];
    const ids =
      f.kind === "labels" ? (f.optionIds ?? []) : [String(f.optionId)];
    const gone = ids.find(id => !on.some(o => String(o.id) === id));
    if (gone !== undefined) {
      const name = CARD_FACTS[f.fieldId]?.options?.[gone] ?? gone;
      throw halt(
        "failed",
        resumed
          ? SAY_FORMS.noFieldOptionStarted(f.label, name)
          : SAY_FORMS.noFieldOption(f.label, name),
      );
    }
  }
  const settle = async (): Promise<RequestOutcome> => {
    if (Object.values(receipt).some(r => r.state === "written")) {
      const note = factsKeptNote(step, receipt);
      await book.set(step.key, "done", {
        fields: receipt,
        ...(note ? { note } : {}),
      });
      return {
        state: "delivered",
        progress: book.progress,
        ...(note ? { note } : {}),
      };
    }
    await book.set(step.key, "skipped", { fields: receipt });
    return {
      state: "skipped",
      progress: book.progress,
      error: factsKeptSaid(step, receipt),
    };
  };
  if (!due.length) return settle();
  await book.start(step.key, { fields: receipt });
  for (const [i, f] of due.entries()) {
    try {
      await book.write(() =>
        provider.call(
          "clickup",
          "POST",
          `task/${step.taskId}/field/${f.fieldId}`,
          factBody(f),
        ),
      );
    } catch (e) {
      // A 429 or 401 on a write that never landed starts its step clean (StepBook.forget). Once a write before this
      // one may be on the card, in this run or an earlier one, the step keeps its receipt instead: started clean, the
      // next read would take this writer's own value for one the card already had. The row then reads unknown and
      // the next run reads the card back first.
      const status = /rejected the request \((\d{3})/.exec(errorText(e))?.[1];
      if ((resumed || i > 0) && (errorKind(e) === "retry" || status === "401"))
        book.writing = false;
      throw e;
    }
  }
  const back = await readCard(x);
  const missing: CardFact[] = [];
  for (const f of due) {
    const field = fieldOf(back, f.fieldId);
    if (field && factMatches(back, f))
      receipt[f.fieldId] = { before: "empty", state: "written" };
    else if (field && !factEmpty(field)) receipt[f.fieldId] = differs(true);
    else missing.push(f);
  }
  if (missing.length) {
    await book.set(step.key, "started", { fields: receipt });
    throw halt("unknown", SAY_FORMS.notBack(missing[0].label, "written"));
  }
  return settle();
}

/** The Onboarding Map at phase 3 or 4, never moved back: a card at that phase or later is kept (4.13.4). */
async function writeMap(
  x: Ctx & { step: Extract<FormStep, { type: "map" }> },
): Promise<RequestOutcome> {
  const { provider, book, step } = x;
  const resumed = book.get(step.key)?.state === "started";
  const label = "Onboarding Map";
  const field = fieldOf(await readCard(x), step.fieldId);
  if (!field)
    throw halt(
      "failed",
      resumed ? SAY_FORMS.noFieldStarted(label) : SAY_FORMS.noField(label),
    );
  const kept = async (cardPhase: number): Promise<RequestOutcome> => {
    await book.set(step.key, "skipped", { cardPhase });
    return {
      state: "skipped",
      progress: book.progress,
      error: SAY_FORMS.mapKept(cardPhase),
    };
  };
  if (String(field.value ?? "").trim() === step.value) {
    await book.set(step.key, resumed ? "done" : "unchanged");
    return { state: "delivered", progress: book.progress };
  }
  const phase = mapPhaseOf(field.value);
  if (phase !== null && phase >= step.phase) return kept(phase);
  await book.start(step.key);
  await book.write(() =>
    provider.call(
      "clickup",
      "POST",
      `task/${step.taskId}/field/${step.fieldId}`,
      {
        value: step.value,
      },
    ),
  );
  const backField = fieldOf(await readCard(x), step.fieldId);
  if (String(backField?.value ?? "").trim() === step.value) {
    await book.set(step.key, "done");
    return { state: "delivered", progress: book.progress };
  }
  // Another writer moved the map further between the read and the write: it stays.
  const backPhase = mapPhaseOf(backField?.value);
  if (backPhase !== null && backPhase > step.phase) return kept(backPhase);
  throw halt("unknown", SAY_FORMS.notBack(label, `phase ${step.phase}`));
}

/**
 * executeForm's answer. `error` stays what ClickUp or the step said; `plain` is the sentence the queue row and its
 * effect carry when `error` is ClickUp's own wording, because 3.6 copies the row's error to the effect and the CSM's
 * trail prints it (finish review). A row still on `retry` keeps the wording: its error reaches no effect.
 * `tokenRefused` is a 401: the token or this card, which runForms tells apart with checkToken before it settles
 * anything. `endsAs` is the sentence a row carries when the ladder ends, in place of the ladder's own.
 */
export type FormOutcome = RequestOutcome & {
  plain?: string;
  tokenRefused?: boolean;
  endsAs?: string;
};

/**
 * After a 401 on a card, is it the token? One read that does not depend on the card, the list's fields, which the
 * doctor also reads. It must come back with the field list to count as an answer. A 401 there is the token. A 429, a
 * 5xx, a timeout or any other answer tells nothing about the token, so the row is not charged a try for it.
 */
export async function checkToken(
  provider: Provider,
): Promise<"good" | "refused" | "slow" | "unsure"> {
  try {
    const r = await provider.call("clickup", "GET", `list/${FORMS_LIST}/field`);
    return Array.isArray(r?.fields) ? "good" : "unsure";
  } catch (e) {
    const status = /rejected the request \((\d{3})/.exec(errorText(e))?.[1];
    return status === "401" ? "refused" : status === "429" ? "slow" : "unsure";
  }
}

/**
 * A 401 on a card while the token answers elsewhere: this card's own refusal, settled by the ladder (contract 4.1).
 * A step already started may have reached the card before the 401 (a read-back, or a read on a later try), so that
 * row is unknown and its ladder ends on the check-the-card sentence. Otherwise nothing was sent to the card.
 */
export function cardRefused(o: FormOutcome, key: string): FormOutcome {
  const { tokenRefused: _token, ...rest } = o;
  return (o.progress as Row)?.steps?.[key]?.state === "started"
    ? { ...rest, state: "unknown", plain: SAY_FORMS.readRefused }
    : {
        ...rest,
        state: "retry",
        plain: SAY_FORMS.cardRefused,
        endsAs: SAY_FORMS.cardRefused,
      };
}

/** The sentence for ClickUp's own answer, by what is known to have happened on the card. */
function plainOf(
  o: RequestOutcome,
  status: string | undefined,
  book: StepBook,
  key: string,
): string {
  if (o.state !== "failed") return SAY_FORMS.notConfirmed;
  // Nothing landed: the write itself was refused, or nothing had started yet.
  const sentNothing = book.writing || book.get(key) === undefined;
  if (status === "404" && sentNothing) return SAY_FORMS.offList;
  return sentNothing ? SAY_FORMS.refused : SAY_FORMS.readRefused;
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
export async function executeForm(
  item: FormItem,
  step: FormStep,
  provider: Provider,
  save: Save,
  now: () => number,
): Promise<FormOutcome> {
  const { lastDetail: _earlier, ...progress } = structuredClone(
    item.progress ?? {},
  ) as Row;
  const book = new StepBook(progress, save, now);
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
    if (
      done.state === "skipped" &&
      typeof done.cardDay === "string" &&
      step.type === "date"
    )
      return {
        state: "skipped",
        progress: book.progress,
        error: SAY_FORMS.stays(step.key, done.cardDay),
      };
    if (
      done.state === "skipped" &&
      typeof done.cardPhase === "number" &&
      step.type === "map"
    )
      return {
        state: "skipped",
        progress: book.progress,
        error: SAY_FORMS.mapKept(done.cardPhase),
      };
    if (done.state === "skipped" && step.type === "facts")
      return {
        state: "skipped",
        progress: book.progress,
        error: factsKeptSaid(step, savedReceipt(done)),
      };
    if (step.type === "facts") {
      const note = factsKeptNote(step, savedReceipt(done));
      if (note) return { state: "delivered", progress: book.progress, note };
    }
    return { state: "delivered", progress: book.progress };
  }
  try {
    if (step.type === "comment") return await writeComment({ ...x, step });
    if (step.type === "select") return await writeHappiness({ ...x, step });
    if (step.type === "status") return await writeStatus({ ...x, step });
    if (step.type === "fields") return await writeFields({ ...x, step });
    if (step.type === "map") return await writeMap({ ...x, step });
    if (step.type === "facts") return await writeFacts({ ...x, step });
    return await writeDate({ ...x, step });
  } catch (e) {
    if (
      e === raw &&
      book.get(step.key) === undefined &&
      errorKind(e) === "unknown"
    )
      return {
        state: "retry",
        progress: book.progress,
        error: errorText(e),
        plain: SAY_FORMS.notConfirmed,
      };
    const status =
      e === raw
        ? /rejected the request \((\d{3})/.exec(errorText(e))?.[1]
        : undefined;
    // A 401 is the token or this card, not this write: settling it failed here would lose every due row for good on a
    // bad token, with no requeue path (finish review), so runForms asks checkToken first. Nothing the 401 answered
    // landed. A step that started earlier stays started, so the next try reads the card back first.
    if (status === "401") {
      if (book.writing) book.forget(step.key);
      return {
        state: "retry",
        progress: book.progress,
        error: errorText(e),
        tokenRefused: true,
      };
    }
    const o = outcomeOf(e, book, step.key);
    const said = (out: RequestOutcome): FormOutcome => {
      if (e === raw)
        return { ...out, plain: plainOf(out, status, book, step.key) };
      // Our own save failed: its sentence stands, without the database's wording after it.
      return out.error?.startsWith(SAY.bookkeeping)
        ? { ...out, plain: SAY.bookkeeping }
        : out;
    };
    // A 429 (or a missing secret) on a read once the step has started, the read-back after a write that went
    // through above all, is not a plain retry: the write may be on the card, so the row and its effect read
    // unknown, and a rollback or the end of the ladder says to check the card (review round 3). A 429 on the
    // write call itself never landed (book.writing), and one before the step started sent nothing: both stay
    // retry. The run still stops on a 429 settled unknown.
    if (
      o.state === "retry" &&
      !book.writing &&
      book.get(step.key)?.state === "started"
    )
      return said({ ...o, state: "unknown" });
    return said(o);
  }
}

/** What a held row would write, for the run's planned list: never the comment text. */
/** The words a held Stage 4 row shows: never a comment's text or a field's value. */
const STAGE4_WORDS: Record<Stage4Key, string> = {
  handoff_comment: "Kickoff handoff comment",
  native_status: "Task status",
  card_fields: "Card fields",
  map_phase4: "Onboarding Map",
  profile_fields: "Client Profile and kickoff link",
  raw_answers_comment: "Raw onboarding answers comment",
  map_phase3: "Onboarding Map",
  card_facts: "Empty card fields filled from the answers",
};

export function planForm(item: FormItem): Row[] {
  const p = item.payload ?? {};
  const key = String(p.effectKey ?? "");
  if (isStage4(key))
    return [
      {
        queueId: item.id,
        kind: "form",
        taskId: item.task_id ?? null,
        field: STAGE4_WORDS[key],
        old: null,
        new:
          key === "handoff_comment" || key === "raw_answers_comment"
            ? `${Number(p.commentChars) || 0} characters`
            : key === "native_status"
              ? "IN PROGRESS"
              : key === "map_phase3" || key === "map_phase4"
                ? `phase ${key === "map_phase3" ? 3 : 4}`
                : key === "card_facts"
                  ? `up to ${Array.isArray(p.fields) ? p.fields.length : 0}, each only where the card is empty`
                  : `${Array.isArray(p.fields) ? p.fields.length : 0} fields`,
      },
    ];
  return [
    {
      queueId: item.id,
      kind: "form",
      taskId: item.task_id ?? null,
      field:
        key === "todo_comment"
          ? "1-1 notes comment"
          : (FIELD_LABEL[key as Exclude<FormKey, "todo_comment">] ?? key),
      old: null,
      new:
        key === "todo_comment"
          ? `${Number(p.commentChars) || 0} characters`
          : key === "happiness"
            ? (p.label ?? null)
            : (p.day ?? null),
    },
  ];
}

// --- The doctor's checks, reads only ---------------------------------------------------------------

/**
 * Against ClickUp, reads only: the six Client Happiness options the planner writes are on the field (and the
 * database names the same six), Last POC and Last Check-in Call are date fields, the three field ids are the
 * ones the database plans with, and each canary card (the test card when none is set) is on Clients - Mahara.
 */
export async function formsDoctorChecks(
  inputs: Row,
  provider: Provider,
  onlyCards: string[],
  forms: readonly string[] = ["checkin"],
): Promise<{ problems: string[]; counts: Row }> {
  const problems: string[] = [];
  const dbOptions: Row[] = Array.isArray(inputs?.happinessOptions)
    ? inputs.happinessOptions
    : [];
  const wanted = Object.entries(HAPPINESS_OPTIONS);
  if (
    dbOptions.length &&
    (dbOptions.length !== wanted.length ||
      dbOptions.some(
        o => HAPPINESS_OPTIONS[String(o.label)] !== String(o.optionId),
      ))
  )
    problems.push(
      "The database and the writer name different Client Happiness options. Re-read 20261027h before any 1-1 notes write.",
    );
  if (
    inputs?.fields &&
    (inputs.fields.happiness !== FORM_FIELDS.happiness ||
      inputs.fields.lastPoc !== FORM_FIELDS.last_poc ||
      inputs.fields.lastCheckinCall !== FORM_FIELDS.last_checkin_call)
  )
    problems.push(
      "The database and the writer name different ClickUp fields for the 1-1 notes.",
    );
  let fields: Row[] | null = null;
  try {
    const r = await provider.call("clickup", "GET", `list/${FORMS_LIST}/field`);
    if (!Array.isArray(r.fields)) throw new Error("no field list came back");
    fields = r.fields;
  } catch (e) {
    problems.push(
      `Could not read the Clients - Mahara fields from ClickUp: ${errorText(e).slice(0, 160)}`,
    );
  }
  let options = 0;
  if (fields) {
    const happy = fields.find(f => f.id === FORM_FIELDS.happiness);
    if (!happy)
      problems.push(
        "Client Happiness is not on the Clients - Mahara list in ClickUp.",
      );
    else {
      const ids = new Set(
        (Array.isArray(happy.type_config?.options)
          ? happy.type_config.options
          : []
        ).map((o: Row) => String(o.id)),
      );
      for (const [label, id] of wanted) {
        if (ids.has(id)) options += 1;
        else
          problems.push(
            `Client Happiness has no "${label}" option in ClickUp any more, so a 1-1 notes write with it would fail.`,
          );
      }
    }
    // Stage 4's fields, only while their form is switched on (CLICKUP_WRITEBACK_FORMS_KEYS).
    const wanted4: [string, string][] = [];
    if (forms.includes("kickoff"))
      wanted4.push(
        ...Object.keys(STAGE4_FIELDS.card_fields).map(
          id => [id, "kickoff"] as [string, string],
        ),
        [MAP_FIELD, "kickoff"],
      );
    if (forms.includes("onboarding"))
      wanted4.push(
        ...Object.keys(STAGE4_FIELDS.profile_fields).map(
          id => [id, "onboarding"] as [string, string],
        ),
        [MAP_FIELD, "onboarding"],
      );
    for (const [id, form] of wanted4)
      if (!fields.some(x => x.id === id))
        problems.push(
          `The ${form} writes a field (${id.slice(0, 8)}) that is not on the Clients - Mahara list.`,
        );
    // card_facts' five fields (plan B8), while the kickoff or the onboarding is switched on: each on the list, of its
    // kind, with every option the writer may send (read live; the ids came from a snapshot).
    if (forms.includes("kickoff") || forms.includes("onboarding"))
      for (const [id, fact] of Object.entries(CARD_FACTS)) {
        const f = fields.find(x => x.id === id);
        if (!f) {
          problems.push(
            `Card facts write ${fact.label} (${id.slice(0, 8)}), which is not on the Clients - Mahara list.`,
          );
          continue;
        }
        if (String(f.type) !== fact.kind) {
          problems.push(
            `${fact.label} is a ${String(f.type)} field in ClickUp, not ${fact.kind}, so card facts would not write it.`,
          );
          continue;
        }
        const on: Row[] = Array.isArray(f.type_config?.options)
          ? f.type_config.options
          : [];
        for (const [optionId, name] of Object.entries(fact.options ?? {}))
          if (!on.some(o => String(o.id) === optionId))
            problems.push(
              `${fact.label} has no "${name}" option in ClickUp any more, so a card facts write with it would fail.`,
            );
      }
    for (const key of ["last_poc", "last_checkin_call"] as const) {
      const f = fields.find(x => x.id === FORM_FIELDS[key]);
      if (!f)
        problems.push(
          `${FIELD_LABEL[key]} is not on the Clients - Mahara list in ClickUp.`,
        );
      else if (String(f.type) !== "date")
        problems.push(
          `${FIELD_LABEL[key]} is a ${String(f.type)} field in ClickUp, not a date.`,
        );
    }
  }
  const cards = onlyCards.length ? onlyCards : [FORMS_TEST_CARD];
  const onList: string[] = [];
  for (const id of cards) {
    try {
      const t = await provider.call("clickup", "GET", `task/${id}`);
      if (String(t?.list?.id ?? "") === FORMS_LIST) onList.push(id);
      else
        problems.push(
          `The test card ${id} is not on the Clients - Mahara list.`,
        );
    } catch (e) {
      problems.push(
        `Could not read the test card ${id} from ClickUp: ${errorText(e).slice(0, 160)}`,
      );
    }
  }
  return {
    problems,
    counts: { options, fields: fields?.length ?? null, cards: onList },
  };
}
