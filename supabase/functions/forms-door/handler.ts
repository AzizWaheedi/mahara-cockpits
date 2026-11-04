// forms-door's one route (docs/forms/STAGE2B-CONTRACT.md 4.8, build 8;
// docs/forms/WAVE12-CONTRACT.md 4.4; docs/forms/WAVE34-CONTRACT.md 4.7 and
// 4.8; README.md here). Typeform posts each response of five forms, each
// signed with its own secret saved at
// registration (scripts/dev/forms_key.py register-typeform {form}), which the
// vault keeps (cockpit_forms_key_get('typeform_{form}')):
//
// - kickoff (tG7dnxBn): stored through cockpit_form_record_typeform, the raw
//   answers once in cockpit_csm_call_forms as the csm-calls worker would
//   write them, and a pointer response in the forms tables. Kickoff's Stage 1
//   path keeps its notices (Y49, Z21).
// - exit_survey (the termination survey, knIe4eF3) and pause_request (the
//   client's pause request, CTUjv6l3), waves 1-2 (C4a-2, W18): stored through
//   cockpit_form_record_legacy as a legacy response, matched to a card only by
//   the form's own hidden onboarding_client_id (never by a name, W12). The
//   signature proves Typeform sent it, not which card it is for: the hidden id
//   sits in a public link, so the database keeps the match as
//   hidden_id_unverified and never attaches the survey to a departure (a
//   person does). It queues the "Termination notice in" for the CSM; a pause
//   request is a row on Today. No card field changes (D11). Once the exit
//   survey turns native (C4b) its registry row keeps the Typeform id, so an
//   answer through the old link is still stored here, and the database posts
//   "Old form link used" (V16).
// - onboarding (the client's onboarding form, KFRCXPFx) and new_client (the
//   New Client Form, BTzMwXiw), waves 3-4 (C6, 4.8): Make owns every effect of
//   both; the door only records them through cockpit_form_record_make (no
//   notice, V23). An onboarding answer is shaped by the onboarding sync's own
//   mapping (formsFor in apps/client-success-cockpit/src/lib/onboardingCore.ts,
//   imported, never copied: one response, no Typeform API call), so the
//   onboarding read model gets the same entry the 10-minute read writes. The
//   New Client Form keeps the legacy forms' mapping, less every email and
//   phone, and its three hidden ids (contact_id, closer, setter). Nothing here
//   ever submits a form.
// - Stage 4 (docs/forms/WAVE56-CONTRACT.md 4.14.2, 4.15.3, X26): once
//   cockpit_form_stage4_go_live turns kickoff or onboarding native, its registry
//   row keeps its Typeform id, so the old link still reaches this door. A kickoff
//   through it is kept as a legacy record (cockpit_form_record_legacy, the legacy
//   mapping: no email or phone, the two hidden fields) with "Old form link used";
//   an onboarding answer goes to cockpit_form_onboarding_typeform with
//   onboardingAnswers' entry, so it runs the same native planner as a portal
//   answer, once per card (a card already answered stores it legacy).
// - The sale tie (docs/forms/WAVE56-CONTRACT.md 4.19, 20261103g): after a New
//   Client Form is recorded (inserted or a repeat), the delivery's own typed
//   phone (95a3901f) and email (a6ea04df), read before the contact filter drops
//   them, go to cockpit_sale_tie_open as tieKeys, which keeps only their
//   digests and opens the sale's row. They are never stored, logged or sent
//   anywhere else. A failed call never changes the 200: the door marks
//   detail.tie 'failed' on forms-door:new_client (cockpit_sale_tie_door_failed)
//   and the onboarding sync's sweep opens the row from what the cockpit stores.
//   The raw-phone answer (f322053a, a short_text the type filter misses) is
//   dropped by its ref, so no client phone is stored with the answers.
//
// It never delivers anything itself. Everything that touches the network or
// the clock comes in through Deps, so `bun test` runs it offline.
//
// One delivery, in order: the path (404) and the method (405); the form key,
// one of FORM_KEYS (404); the body, read once, 1,500,000 bytes at most (413); the
// registry row, still a Typeform form (404); the secret (503 while none is
// saved); the signature, before anything of the body is parsed (401, but only
// after one fresh read of the key when the cached one is 30 seconds old or
// more, so a rotated key works at once); a signed probe (200, nothing stored);
// a form_response of the registry's form, else 202 ignored; the record (200,
// inserted true or false; a refusal 500, which Typeform retries).
//
// Nothing of a body is logged or kept here: one line per delivery,
// `forms-door {form} {outcome}`, never a body, an answer, a hidden value, a
// header value or a secret. The client's email and phone ride in kickoff's
// hidden fields (apps/client-success-cockpit/src/forms/prefill.ts), so the
// response row holds a pointer only (3.9); the record RPC keeps the content in
// cockpit_csm_call_forms alone. The two client forms ask for contact details
// the card already holds (inventory 3.3, 3.4): their email and phone answers
// are dropped here, before anything is stored, and only the forms' two hidden
// fields (client_name, onboarding_client_id) are kept.

import {
  FORMS,
  type FormData,
  formEntry,
  formsFor,
} from "../../../apps/client-success-cockpit/src/lib/onboardingCore.ts";
import {
  fieldTitles,
  formAnswers,
  recordingIn,
} from "../../../hermes/csm-calls/match.ts";
import { type Rpc, restRpc } from "../cockpit-hours-sync/db.ts";
import { signedByTypeform } from "../team-onboarding-intake/signature.ts";

export type Deps = {
  env: (name: string) => string;
  fetch: typeof fetch;
  /** Wall-clock time in ms: the secret's and the registry's cache. */
  now: () => number;
  /** The one line per delivery. */
  log: (line: string) => void;
};

/**
 * The forms with a cockpit webhook: kickoff since 2b (Z58), the termination survey and the pause request since waves
 * 1-2 (4.4), client onboarding and the New Client Form since waves 3-4 (4.7, 4.8). The checkin row also has a
 * typeform_id and provider typeform, so the door names its forms itself.
 */
export const FORM_KEYS = [
  "kickoff",
  "exit_survey",
  "pause_request",
  "onboarding",
  "new_client",
] as const;
export type FormKey = (typeof FORM_KEYS)[number];
/** The two forms stored as legacy responses (cockpit_form_record_legacy), not through kickoff's store. */
export const LEGACY_FORMS: ReadonlySet<string> = new Set([
  "exit_survey",
  "pause_request",
]);
/** The two live Typeforms Make owns, recorded only (cockpit_form_record_make, waves 3-4 4.7 and 4.8). */
export const MAKE_FORMS: ReadonlySet<string> = new Set([
  "onboarding",
  "new_client",
]);
/** The two Stage 4 forms: still taken through their old Typeform link once native (4.15.3, X26). */
export const STAGE4_FORMS: ReadonlySet<string> = new Set([
  "kickoff",
  "onboarding",
]);
/** The New Client Form's hidden fields (cockpit_sales_client_forms.hidden): the lead and who sent it. */
const NEW_CLIENT_HIDDEN = ["contact_id", "closer", "setter"] as const;
/** The New Client Form's own refs the door reads or drops (apps/sales-cockpit/src/lib/clientForm.ts REF). */
export const NEW_CLIENT_REF = {
  phone: "95a3901f-4130-454e-8e45-14c9a99dd096",
  email: "a6ea04df-7b41-4a9f-b92b-8b5347a585be",
  rawPhone: "f322053a-3b86-4e8c-8596-93d31a096679",
} as const;
/**
 * New Client Form answers never stored, by ref: the raw phone is typed into a short_text, so the type filter below
 * misses it (sale-tie.md 1 and 2.5).
 */
const NEW_CLIENT_DROP_REFS: ReadonlySet<string> = new Set([
  NEW_CLIENT_REF.rawPhone,
]);
/** Answer and field types that carry a person's email or phone: never stored from the two client forms. */
const CONTACT_TYPES = new Set(["email", "phone_number", "contact_info"]);
/** The only hidden fields the two client forms set (inventory 3.3, 3.4). */
const LEGACY_HIDDEN = ["client_name", "onboarding_client_id"] as const;
const CARD_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** A delivery larger than this is refused before it is checked (a kickoff response is a few kilobytes). */
export const MAX_BODY_BYTES = 1_500_000;
/** The signing key and the registry row are read at most once in this long, per isolate. */
export const SECRET_TTL_MS = 5 * 60_000;
/**
 * While no key is saved (before registration), it is read again at most once in this long, per isolate. A signature
 * that fails against a key read this long ago or longer reads the key once more before the 401 (a rotated key), and a
 * failed signature reads it at most once in this long, so an unsigned flood costs one read in 30 seconds.
 */
export const MISSING_SECRET_TTL_MS = 30_000;
/**
 * An unsigned request, or one while no key is saved, is recorded in forms-door:{form} at most once in this long per
 * isolate and form, so a flood of them costs one write.
 */
export const UNSIGNED_SEEN_TTL_MS = 30_000;
/** Each database call gives up after this long; Typeform retries a delivery that was not answered. */
const DB_TIMEOUT_MS = 15_000;
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
/** The outcomes cockpit_forms_door_seen takes (3.9), and what the log line can say besides. */
export type Seen =
  | "recorded"
  | "repeat"
  | "ignored"
  | "probe"
  | "unsigned"
  | "failed";
type Outcome =
  | Seen
  | "path"
  | "method"
  | "form"
  | "too_large"
  | "no_database"
  | "not_typeform";
type Row = Record<string, any>;

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, ...extra },
  });
}

/**
 * The form key in a request path, or null when the path is not the door's one route. Supabase hands the function
 * its path with the function's name in front ("/forms-door/typeform/kickoff"); a local run may add /functions/v1.
 */
export function formKeyOf(pathname: string): string | null {
  const m = /^(?:\/functions\/v1)?\/forms-door\/typeform\/([^/]+)\/?$/.exec(
    pathname,
  );
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** The raw body as text, or null when it is larger than `max` bytes (read a chunk at a time, never whole). */
async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The form_response of a signed body, or null when the body is not a form_response event. */
function responseOf(raw: string): Row | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Row;
  if (b.event_type !== "form_response") return null;
  const r = b.form_response;
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Row) : null;
}

/**
 * The record RPC's input (3.9), built with the csm-calls worker's own rules (match.ts formAnswers, fieldTitles,
 * recordingIn), so a webhook delivery and the 15-minute read store the same row. Only 3.9's keys: never the raw body,
 * the definition or anything else of the delivery.
 */
export function recordInput(formKey: string, response: Row): Row {
  const answers = formAnswers(response, fieldTitles(response.definition ?? {}));
  const hidden =
    response.hidden &&
    typeof response.hidden === "object" &&
    !Array.isArray(response.hidden)
      ? response.hidden
      : {};
  return {
    formKey,
    token: String(response.token ?? ""),
    submittedAt: String(response.submitted_at ?? ""),
    hidden,
    answers,
    recordingUrl: recordingIn(answers) ?? null,
    via: "typeform_webhook",
  };
}

/**
 * cockpit_form_record_legacy's input for a termination survey or a pause request (waves 1-2, 3.1): the answers as
 * {fields: [{ref, title, type, value}]} with the worker's own mapping, less every email and phone answer; the two
 * hidden fields only; the card from the form's hidden onboarding_client_id when it looks like a card id (the database
 * keeps it only when the card is on the billing sheet). Never the raw body or anything else of the delivery.
 */
export function legacyInput(
  formKey: string,
  response: Row,
  backfill = false,
): Row {
  const raw: Row[] = Array.isArray(response.answers) ? response.answers : [];
  const kept = raw.filter(
    a =>
      a &&
      typeof a === "object" &&
      !CONTACT_TYPES.has(String(a.type ?? "")) &&
      !CONTACT_TYPES.has(String(a.field?.type ?? "")),
  );
  const fields = formAnswers(
    { ...response, answers: kept },
    fieldTitles(response.definition ?? {}),
  );
  const given =
    response.hidden &&
    typeof response.hidden === "object" &&
    !Array.isArray(response.hidden)
      ? response.hidden
      : {};
  const hidden: Row = {};
  for (const k of LEGACY_HIDDEN) {
    const v = typeof given[k] === "string" ? given[k].trim() : "";
    if (v) hidden[k] = v;
  }
  const card =
    typeof hidden.onboarding_client_id === "string" &&
    CARD_ID.test(hidden.onboarding_client_id)
      ? hidden.onboarding_client_id
      : null;
  return {
    formKey,
    externalId: String(response.token ?? ""),
    submittedAt: String(response.submitted_at ?? ""),
    answers: { fields },
    hidden,
    taskId: card,
    clientName:
      typeof hidden.client_name === "string" ? hidden.client_name : null,
    backfill,
  };
}

/** A delivery's hidden object, or an empty one. */
function hiddenOf(response: Row): Row {
  return response.hidden &&
    typeof response.hidden === "object" &&
    !Array.isArray(response.hidden)
    ? response.hidden
    : {};
}

/** The named hidden fields only, each a trimmed non-empty string. */
function pickHidden(given: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) {
    const v = typeof given[k] === "string" ? given[k].trim() : "";
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The client onboarding answer as the onboarding sync shapes it (4.7.2): a FormData of this one response and its
 * definition, through formsFor for the card the hidden onboarding_client_id names, so the stored answers equal the
 * entry the 10-minute read writes into cockpit_client_onboarding.forms.onboarding. A response with no card id is
 * shaped by the same file's formEntry. No Typeform API call: the webhook carries the definition.
 */
export function onboardingAnswers(response: Row): {
  taskId: string | null;
  answers: unknown[];
} {
  const hidden = pickHidden(hiddenOf(response), [
    "onboarding_client_id",
    "client_name",
  ]);
  const taskId =
    typeof hidden.onboarding_client_id === "string" &&
    CARD_ID.test(hidden.onboarding_client_id)
      ? hidden.onboarding_client_id
      : null;
  const definition = response.definition ?? {};
  if (taskId) {
    const data: FormData = {
      definitions: { onboarding: definition },
      responses: { onboarding: [response] },
    };
    const entry = formsFor(taskId, data).onboarding;
    if (entry) return { taskId, answers: entry.answers };
  }
  return {
    taskId,
    answers: formEntry(FORMS.onboarding, definition, response).answers,
  };
}

/** The sale's two keys for the sale tie, as typed: each a trimmed string, or null. */
export type TieKeys = { phone: string | null; email: string | null };

/**
 * The New Client Form's own typed phone (95a3901f, a phone_number answer) and email (a6ea04df, an email answer), read
 * from the raw delivery before the contact filter drops them (4.19). Only these two answers, by ref and by type: never
 * the raw-phone short_text, a hidden field or another answer. Only cockpit_sale_tie_open receives them.
 */
export function tieKeysOf(response: Row): TieKeys {
  const raw: Row[] = Array.isArray(response.answers) ? response.answers : [];
  const typed = (ref: string, type: "phone_number" | "email") => {
    const a = raw.find(
      x =>
        x &&
        typeof x === "object" &&
        x.type === type &&
        x.field &&
        typeof x.field === "object" &&
        x.field.ref === ref,
    );
    const v = a?.[type];
    return typeof v === "string" && v.trim() !== "" && v.length <= 320
      ? v.trim()
      : null;
  };
  return {
    phone: typed(NEW_CLIENT_REF.phone, "phone_number"),
    email: typed(NEW_CLIENT_REF.email, "email"),
  };
}

/**
 * cockpit_form_record_make's input for client onboarding or the New Client Form (4.7.3): the answers as {fields: [...]},
 * each form's own hidden fields, the card from onboarding's hidden id (the database keeps it only when it mirrors the
 * card). The New Client Form keeps the legacy mapping less every email and phone answer and its raw phone (by ref), and
 * no card (Make makes it); beside the record it carries tieKeys (4.19), which the handler sends to the sale tie alone
 * and never to the record (recordOf).
 */
export function makeInput(
  formKey: string,
  response: Row,
  backfill = false,
): Row {
  const base = {
    formKey,
    externalId: String(response.token ?? response.response_id ?? ""),
    submittedAt: String(response.submitted_at ?? ""),
    backfill,
  };
  if (formKey === "onboarding") {
    const { taskId, answers } = onboardingAnswers(response);
    return {
      ...base,
      answers: { fields: answers },
      hidden: pickHidden(hiddenOf(response), [
        "client_name",
        "onboarding_client_id",
      ]),
      taskId,
    };
  }
  const answers: Row[] = Array.isArray(response.answers) ? response.answers : [];
  const legacy = legacyInput(
    formKey,
    {
      ...response,
      answers: answers.filter(
        a => !NEW_CLIENT_DROP_REFS.has(String(a?.field?.ref ?? "")),
      ),
    },
    backfill,
  );
  return {
    ...base,
    answers: legacy.answers,
    hidden: pickHidden(hiddenOf(response), NEW_CLIENT_HIDDEN),
    taskId: null,
    tieKeys: tieKeysOf(response),
  };
}

/** The record RPC's input alone: makeInput less the sale tie's keys, which never reach the record. */
export function recordOf(input: Row): Row {
  const { tieKeys: _keys, ...p } = input;
  return p;
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (n: string) => (deps.env(n) ?? "").trim();
  let door: Rpc | null = null;
  // Each form has its own key, registry row and limiters, so one form's flood or rotation never touches another's.
  const secretCache = new Map<string, { secret: string | null; at: number }>();
  /** When a failed signature last read a form's key again, kept apart so a read that throws still waits its 30 seconds. */
  const rereadAt = new Map<string, number>();
  const registryCache = new Map<string, { row: Row | null; at: number }>();
  const seenAt = new Map<string, number>();

  const timed = ((input: RequestInfo | URL, init?: RequestInit) =>
    deps.fetch(input, {
      ...init,
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    })) as typeof fetch;
  const base = () => env("SUPABASE_URL").replace(/\/+$/, "");
  const serviceKey = () => env("SUPABASE_SERVICE_ROLE_KEY");

  function rpc(): Rpc | null {
    if (door) return door;
    if (!base() || !serviceKey()) return null;
    door = restRpc(base(), serviceKey(), timed);
    return door;
  }

  /** The registry row of the form (cockpit_forms: provider, typeform_id), read with the service key, kept 5 minutes. */
  async function registryOf(formKey: string): Promise<Row | null> {
    const now = deps.now();
    const cached = registryCache.get(formKey);
    if (cached && now - cached.at < SECRET_TTL_MS) return cached.row;
    const res = await timed(
      `${base()}/rest/v1/cockpit_forms?select=provider,typeform_id&key=eq.${encodeURIComponent(formKey)}`,
      {
        headers: {
          apikey: serviceKey(),
          Authorization: `Bearer ${serviceKey()}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) throw new Error(`The registry read answered ${res.status}`);
    const rows = (await res.json()) as unknown;
    const row =
      Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
        ? (rows[0] as Row)
        : null;
    registryCache.set(formKey, { row, at: now });
    return row;
  }

  /**
   * The signing key, from the vault through the service RPC; a found one is kept 5 minutes, a missing one 30 seconds.
   * `fresh` reads it whatever the cache holds (a signature that failed against an older key).
   */
  async function secretOf(
    db: Rpc,
    formKey: string,
    fresh = false,
  ): Promise<string | null> {
    const now = deps.now();
    const cached = secretCache.get(formKey);
    if (
      !fresh &&
      cached &&
      now - cached.at < (cached.secret ? SECRET_TTL_MS : MISSING_SECRET_TTL_MS)
    )
      return cached.secret;
    const key = (await db("cockpit_forms_key_get", {
      p_provider: `typeform_${formKey}`,
    })) as Row | null;
    const secret =
      typeof key?.secret === "string" && key.secret ? key.secret : null;
    secretCache.set(formKey, { secret, at: now });
    return secret;
  }

  return async req => {
    let formKey = "-";
    const answer = (
      outcome: Outcome,
      status: number,
      body: Row,
      extra: Record<string, string> = {},
    ): Response => {
      deps.log(`forms-door ${formKey} ${outcome}`);
      return json(body, status, extra);
    };
    const key = formKeyOf(new URL(req.url).pathname);
    if (key === null) return answer("path", 404, { ok: false });
    if (req.method !== "POST")
      return answer("method", 405, { ok: false }, { allow: "POST" });
    if (!(FORM_KEYS as readonly string[]).includes(key))
      return answer("form", 404, { ok: false });
    formKey = key;
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return answer("too_large", 413, { ok: false });

    const db = rpc();
    if (!db) return answer("no_database", 503, { ok: false });
    // The last delivery and its outcome in cockpit_sync_state forms-door:{form}, best effort: a failed write never
    // changes the answer Typeform gets.
    const seen = (outcome: Seen, reason: string | null) =>
      db("cockpit_forms_door_seen", {
        p_form_key: formKey,
        p_outcome: outcome,
        p_reason: reason,
      }).catch(() => {});
    // The two outcomes anyone can cause without the key are written at most once in 30 seconds.
    const seenAtMost = async (outcome: Seen, reason: string) => {
      const now = deps.now();
      const at = `${formKey}:${reason}`;
      const last = seenAt.get(at);
      if (last !== undefined && now - last < UNSIGNED_SEEN_TTL_MS) return;
      seenAt.set(at, now);
      await seen(outcome, reason);
    };

    // The sale tie (4.19): the sale's row, opened once with the two typed keys' digests. Best effort: a refusal or an
    // outage never changes the answer Typeform gets; it marks detail.tie on forms-door:new_client for the guardian, and
    // the onboarding sync's sweep opens the row from what the cockpit stores.
    const tieOpen = async (input: Row) => {
      try {
        await db("cockpit_sale_tie_open", {
          p: {
            externalId: input.externalId,
            submittedAt: input.submittedAt,
            tieKeys: input.tieKeys,
          },
        });
      } catch {
        await db("cockpit_sale_tie_door_failed", {}).catch(() => {});
      }
    };

    // The form must still be filled in Typeform: the registry row with its typeform_id and provider typeform. A legacy
    // form that turned native keeps its Typeform id, so an answer through the old link is still kept (V16).
    let registry: Row | null;
    try {
      registry = await registryOf(formKey);
    } catch {
      return answer("no_database", 503, { ok: false });
    }
    const formId =
      typeof registry?.typeform_id === "string" ? registry.typeform_id : "";
    const native = registry?.provider === "native";
    const filledInTypeform =
      registry?.provider === "typeform" ||
      (native && (LEGACY_FORMS.has(formKey) || STAGE4_FORMS.has(formKey)));
    if (!formId || !filledInTypeform)
      return answer("not_typeform", 404, { ok: false });

    // Nothing of the body is read before the signature holds: no key, or a key that cannot be read, is a 503.
    let secret: string | null;
    try {
      secret = await secretOf(db, formKey);
    } catch {
      return answer("no_database", 503, { ok: false });
    }
    const noKey = async () => {
      await seenAtMost("failed", "No signing key saved");
      return answer("failed", 503, { ok: false });
    };
    if (!secret) return noKey();
    const signature = req.headers.get("typeform-signature");
    let signed = await signedByTypeform(secret, raw, signature);
    // A key rotation (forms_key.py typeform-secret, then register-typeform) must not wait out the 5-minute cache: a
    // signature that fails against a key read 30 seconds ago or more reads the key once more and checks again. At most
    // once in 30 seconds per isolate, so anyone without the key still costs one read in 30 seconds.
    const t = deps.now();
    const read = secretCache.get(formKey);
    if (
      !signed &&
      read &&
      t - read.at >= MISSING_SECRET_TTL_MS &&
      t - (rereadAt.get(formKey) ?? Number.NEGATIVE_INFINITY) >=
        MISSING_SECRET_TTL_MS
    ) {
      rereadAt.set(formKey, t);
      try {
        secret = await secretOf(db, formKey, true);
      } catch {
        return answer("no_database", 503, { ok: false });
      }
      if (!secret) return noKey();
      signed = await signedByTypeform(secret, raw, signature);
    }
    if (!signed) {
      await seenAtMost(
        "unsigned",
        "The signature was missing or did not match.",
      );
      return answer("unsigned", 401, { ok: false });
    }
    if (req.headers.get("x-forms-door-probe") === "1") {
      await seen("probe", "A signed probe; nothing stored.");
      return answer("probe", 200, { ok: true, probe: true });
    }
    const response = responseOf(raw);
    if (!response || response.form_id !== formId) {
      await seen("ignored", `Not a form response of ${formId}.`);
      return answer("ignored", 202, { ignored: true });
    }
    try {
      // Kickoff keeps its 2b store; the two client forms are legacy records (3.1); the two Make forms are records only.
      // Once native (Stage 4): an old kickoff link's answer is a legacy record, an onboarding answer runs the native
      // planner through cockpit_form_onboarding_typeform.
      const out = (
        native && formKey === "kickoff"
          ? await db("cockpit_form_record_legacy", {
              p: legacyInput(formKey, response),
            })
          : native && formKey === "onboarding"
            ? await db("cockpit_form_onboarding_typeform", {
                p_payload: makeInput(formKey, response),
              })
            : LEGACY_FORMS.has(formKey)
              ? await db("cockpit_form_record_legacy", {
                  p: legacyInput(formKey, response),
                })
              : MAKE_FORMS.has(formKey)
                ? await db("cockpit_form_record_make", {
                    p: recordOf(makeInput(formKey, response)),
                  })
                : await db("cockpit_form_record_typeform", {
                    p: recordInput(formKey, response),
                  })
      ) as Row | null;
      if (typeof out?.inserted !== "boolean")
        throw new Error("The record RPC answered without inserted");
      await seen(out.inserted ? "recorded" : "repeat", null);
      if (formKey === "new_client" && !native)
        await tieOpen(makeInput(formKey, response));
      return answer(out.inserted ? "recorded" : "repeat", 200, {
        ok: true,
        inserted: out.inserted,
      });
    } catch (e) {
      // The database's error code only: an error's text can carry a value from the body.
      const code =
        typeof (e as { code?: unknown })?.code === "string"
          ? ` (${(e as { code: string }).code})`
          : "";
      await seen("failed", `The store refused the response${code}.`);
      return answer("failed", 500, { ok: false });
    }
  };
}
