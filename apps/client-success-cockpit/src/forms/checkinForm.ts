/**
 * The 1-1 call notes form (docs/forms/STAGE2-CONTRACT.md 2.1, 3.1, 3.2 and
 * 7.2): the browser's copy of the check-in schema v1, the value checks the
 * server makes (cockpit_form_checkin_value) as far as a browser can make
 * them, what is still missing before a send, and the answers the write
 * through will leave in cockpit_csm_call_forms. Pure: no React, no I/O.
 * scripts/checkin-form.test.ts holds SCHEMA to the SQL seed between the two
 * $checkin_v1$ tokens of supabase/migrations/20261027f_forms_core.sql.
 */

export type CheckinKey =
  | "call"
  | "defcon"
  | "priority"
  | "we_owe"
  | "they_owe"
  | "client_notes";
export type Answers = Record<string, unknown>;

export interface Legacy {
  ref: string;
  title: string;
  type: string;
  prefix?: string;
}

export interface CheckinField {
  key: CheckinKey;
  type: "call" | "choice" | "todos" | "long";
  label: string;
  required?: boolean;
  locked?: boolean | "choices";
  hint?: string;
  choices?: string[];
  side?: "ours" | "theirs";
  max?: number;
  legacy?: Legacy;
}

export interface CheckinSchema {
  key: "checkin";
  version: number;
  fields: CheckinField[];
  legacy: { clientId: Legacy; recording: Legacy };
}

/** The v1 schema, byte for byte the registry seed (cockpit_forms.schema). */
export const SCHEMA: CheckinSchema = {
  key: "checkin",
  version: 1,
  fields: [
    {
      key: "call",
      type: "call",
      label: "This call",
      required: true,
      locked: true,
    },
    {
      key: "defcon",
      type: "choice",
      label: "DEFCON",
      required: true,
      locked: "choices",
      hint: "How the client feels after this call. You pick it; the card's Client Happiness follows.",
      choices: [
        "Paused",
        "At Risk",
        "Neutral",
        "Happy",
        "Very Happy (testimonial)",
        "Churned",
      ],
      legacy: {
        ref: "ff7970f7-9fad-4fa5-b12b-4d719dfb7587",
        title: "Defcon Status",
        type: "multiple_choice",
      },
    },
    {
      key: "priority",
      type: "choice",
      label: "Priority",
      required: true,
      choices: ["911", "High", "Medium", "Low"],
      legacy: {
        ref: "c9f99fb1-fec9-47e7-9baa-c5554733723d",
        title: "Task Priority",
        type: "multiple_choice",
      },
    },
    {
      key: "we_owe",
      type: "todos",
      label: "We owe",
      side: "ours",
      max: 30,
      legacy: {
        ref: "82a6b434-15d9-4a14-8496-c20c94628536",
        title: "Additional Notes",
        type: "long_text",
        prefix: "Mahara: ",
      },
    },
    {
      key: "they_owe",
      type: "todos",
      label: "They owe",
      side: "theirs",
      max: 30,
      legacy: {
        ref: "82a6b434-15d9-4a14-8496-c20c94628536",
        title: "Additional Notes",
        type: "long_text",
        prefix: "Client: ",
      },
    },
    {
      key: "client_notes",
      type: "long",
      label: "Client notes",
      max: 4000,
      hint: "Internal: their mood, promises, risk talk (pause, cancel, budget), a testimonial offer.",
      legacy: {
        ref: "5d071906-da6a-4413-a729-0c76d0188d91",
        title: "Client Notes",
        type: "long_text",
      },
    },
  ],
  legacy: {
    clientId: {
      ref: "c484f390-9695-4ffa-9693-9cc219592713",
      title: "Client ID",
      type: "short_text",
    },
    recording: {
      ref: "cockpit:call",
      title: "Call recording",
      type: "url",
    },
  },
};

export const KEYS = SCHEMA.fields.map(f => f.key);
export const isCheckinKey = (k: string): k is CheckinKey =>
  (KEYS as string[]).includes(k);

/**
 * Where each fRokTITH question went (STAGE2-CONTRACT.md 2.1): the Client ID
 * is the route's card ID, the pasted transcript is the call (the
 * transcript stays in Fathom), Additional Notes is We owe and They owe.
 */
export const FROKTITH: Record<string, { title: string; native: string[] }> = {
  "c484f390-9695-4ffa-9693-9cc219592713": {
    title: "Client ID",
    native: ["task_id"],
  },
  "0773087f-beda-4e2c-bf50-acdac0dcbe05": {
    title: "Clients Call Transcript",
    native: ["call"],
  },
  "82a6b434-15d9-4a14-8496-c20c94628536": {
    title: "Additional Notes",
    native: ["we_owe", "they_owe"],
  },
  "5d071906-da6a-4413-a729-0c76d0188d91": {
    title: "Client Notes",
    native: ["client_notes"],
  },
  "ff7970f7-9fad-4fa5-b12b-4d719dfb7587": {
    title: "Defcon Status",
    native: ["defcon"],
  },
  "c9f99fb1-fec9-47e7-9baa-c5554733723d": {
    title: "Task Priority",
    native: ["priority"],
  },
};

/** DEFCON labels to the card's Client Happiness option ids (7.1). */
export const DEFCON_OPTIONS: Record<string, string> = {
  Paused: "67c08bcd-e629-47ab-85ba-3ac4b3796734",
  "At Risk": "f0623c2a-161d-4aa2-8833-d1337c69e1c2",
  Neutral: "46e595a3-17d7-4835-80f9-8a4c578b72a3",
  Happy: "c5d6b01f-5f2b-40c1-afac-5b9f1efab213",
  "Very Happy (testimonial)": "d403adf4-24aa-40f0-a960-05e6a4621ee9",
  Churned: "1c055070-45d6-4a19-ade3-958851313d7c",
};

/** A field of a schema (the registry's own, else this file's). */
export function fieldOf(
  key: string,
  schema: CheckinSchema = SCHEMA,
): CheckinField | undefined {
  return (
    schema.fields.find(f => f.key === key) ??
    SCHEMA.fields.find(f => f.key === key)
  );
}
export const labelOf = (key: string, schema: CheckinSchema = SCHEMA) =>
  fieldOf(key, schema)?.label ?? key;
export const choicesOf = (key: string, schema: CheckinSchema = SCHEMA) =>
  fieldOf(key, schema)?.choices ?? [];

/**
 * The registry's schema when it reads as one, else this file's: the window
 * takes its labels, hints and choices from the registry (D17), so an editor
 * can change them later without a code change.
 */
export function schemaFrom(raw: unknown): CheckinSchema {
  const s = raw as Partial<CheckinSchema> | null;
  if (
    !s ||
    typeof s !== "object" ||
    s.key !== "checkin" ||
    !Array.isArray(s.fields) ||
    !KEYS.every(k => s.fields?.some(f => f?.key === k))
  )
    return SCHEMA;
  return { ...SCHEMA, ...s } as CheckinSchema;
}

// ------------------------------------------------------------ the call

/** Why a call was picked (3.1); the window asks about the five in ASK. */
export const WHYS = [
  "same_room",
  "invitee_email",
  "pasted",
  "matched",
  "speaker_name",
  "title",
  "domain",
  "near_booking",
  "latest_unlinked",
  "picked",
  "booking",
  "none",
] as const;
export type Why = (typeof WHYS)[number];

/** Picks the server confirms on its own. */
export const CONFIRMED_WHYS: ReadonlySet<string> = new Set([
  "same_room",
  "invitee_email",
  "pasted",
  "matched",
  "picked",
  "booking",
  "none",
]);
/** Guesses: "Is this the call?" until the person says yes. */
export const ASK_WHYS: ReadonlySet<string> = new Set([
  "speaker_name",
  "title",
  "domain",
  "near_booking",
  "latest_unlinked",
]);

/** The call answer as the browser saves it and as the server stores it. */
export type CallAnswer =
  | {
      kind: "fathom";
      recordingId: string;
      why: Why;
      /** Always sent by the browser; read defensively from older rows. */
      confirmed?: boolean;
      callId?: number | null;
      shareUrl?: string | null;
      startsAt?: string;
      endsAt?: string | null;
      title?: string;
      recorder?: "csm" | "team" | "other";
    }
  | {
      kind: "booking";
      callId: number;
      why: "booking";
      confirmed?: boolean;
      startsAt?: string;
      endsAt?: string | null;
    }
  | { kind: "none"; why: "none"; confirmed?: boolean };

/** The answer's call, when it reads as one. */
export function callOf(v: unknown): CallAnswer | null {
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c !== "object") return null;
  if (
    c.kind === "fathom" &&
    typeof c.recordingId === "string" &&
    /^[0-9]{3,20}$/.test(c.recordingId)
  )
    return c as CallAnswer;
  if (c.kind === "booking" && Number.isSafeInteger(c.callId))
    return c as CallAnswer;
  if (c.kind === "none") return c as CallAnswer;
  return null;
}

/** The call counts as answered once it is confirmed (3.1). */
export function confirmed(call: CallAnswer | null): boolean {
  if (!call) return false;
  if (call.kind !== "fathom") return true;
  if (call.confirmed === true) return true;
  return call.confirmed === undefined && CONFIRMED_WHYS.has(call.why);
}

/** One call's key in checkin.calls' views: "fathom:194756343" or "booking:54462". */
export function callRef(call: CallAnswer | null): string | null {
  if (!call) return null;
  if (call.kind === "fathom") return `fathom:${call.recordingId}`;
  if (call.kind === "booking") return `booking:${call.callId}`;
  return "none";
}

// ------------------------------------------------------------ to-dos

export interface TodoItem {
  text: string;
  owner: string | null;
  at: number | null;
  href: string | null;
  from: "fathom" | "csm";
  unsure: boolean;
}

const FATHOM_LINK = /^https:\/\/fathom\.video\/\S+$/;

function todos(value: unknown): { value: TodoItem[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "Keep it to 30 lines." };
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  for (const raw of value as Record<string, unknown>[]) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) return { error: "A line is missing its text." };
    if (text.length > 300)
      return { error: "Keep each line under 300 characters." };
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const owner =
      typeof raw.owner === "string" && raw.owner.trim()
        ? raw.owner.trim().slice(0, 80)
        : null;
    const at =
      typeof raw.at === "number" && raw.at >= 0 && raw.at <= 86400
        ? Math.round(raw.at)
        : null;
    const href =
      typeof raw.href === "string" && FATHOM_LINK.test(raw.href)
        ? raw.href
        : null;
    out.push({
      text,
      owner,
      at,
      href,
      from: raw.from === "fathom" ? "fathom" : "csm",
      unsure: raw.unsure === true,
    });
  }
  if (out.length > 30) return { error: "Keep it to 30 lines." };
  return { value: out };
}

/** The answer's lines, when it holds any. */
export function todosOf(v: unknown): TodoItem[] {
  const c = Array.isArray(v) ? todos(v) : null;
  return c && "value" in c ? c.value : [];
}

// ------------------------------------------------------------ the checks

/**
 * The browser's mirror of cockpit_form_checkin_value (3.2): the normalised
 * value, or the field's sentence. `null` clears the answer. The server
 * checks the call against the store as well; this only checks its shape.
 */
export function checkValue(
  key: string,
  value: unknown,
  schema: CheckinSchema = SCHEMA,
): { value: unknown } | { error: string } {
  if (!isCheckinKey(key))
    return { error: "That is not a question of this form." };
  if (value === null || value === undefined) return { value: null };
  const field = fieldOf(key, schema);
  switch (field?.type) {
    case "call": {
      const c = value as Record<string, unknown>;
      const pick = {
        error: "Pick the call these notes are for, or choose No recording.",
      };
      if (!c || typeof c !== "object" || !WHYS.includes(c.why as Why))
        return pick;
      if (c.kind === "fathom") {
        if (
          typeof c.recordingId !== "string" ||
          !/^[0-9]{3,20}$/.test(c.recordingId)
        )
          return {
            error:
              "That recording is not in the cockpit yet. Check again in a minute.",
          };
        return {
          value: {
            kind: "fathom",
            recordingId: c.recordingId,
            why: c.why,
            confirmed: CONFIRMED_WHYS.has(c.why as string)
              ? true
              : c.confirmed === true,
          },
        };
      }
      if (c.kind === "booking") {
        if (!Number.isSafeInteger(c.callId) || (c.callId as number) <= 0)
          return { error: "That booked call is not on this client." };
        return { value: { kind: "booking", callId: c.callId, why: "booking" } };
      }
      if (c.kind === "none") return { value: { kind: "none", why: "none" } };
      return pick;
    }
    case "choice": {
      const s = typeof value === "string" ? value.trim() : "";
      if (!s) return { value: null };
      if (!(field.choices ?? []).includes(s))
        return { error: `"${s}" is not one of the answers.` };
      return { value: s };
    }
    case "todos": {
      const c = todos(value);
      if ("error" in c) return c;
      return { value: c.value.length ? c.value : null };
    }
    case "long": {
      if (typeof value !== "string") return { error: "This answer is text." };
      const s = value.trim();
      if (!s) return { value: null };
      if (s.length > 4000) return { error: "Keep it under 4,000 characters." };
      return { value: s };
    }
  }
  return { error: "That is not a question of this form." };
}

/** Two answers the same, as the server compares them (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map(k => [k, canon((v as Record<string, unknown>)[k])]),
    );
  return v ?? null;
}

/** The required answers still missing (cockpit_form_checkin_missing). */
export function missing(answers: Answers): CheckinKey[] {
  const out: CheckinKey[] = [];
  if (!confirmed(callOf(answers.call))) out.push("call");
  for (const k of ["defcon", "priority"] as const)
    if (typeof answers[k] !== "string" || !(answers[k] as string).trim())
      out.push(k);
  return out;
}

/** Why Send waits (8.5 Sending), or null when the notes can go. */
export function sendBlock(answers: Answers): string | null {
  const call = callOf(answers.call);
  if (!call)
    return "Pick the call these notes are for, or choose No recording.";
  if (!confirmed(call))
    return "Confirm the call: press Yes, this call, or pick another.";
  if (missing(answers).length) return "Pick DEFCON and priority to send.";
  return null;
}

// ------------------------------------------------------------ the write-through

export interface LegacyAnswer {
  ref: string;
  type: string;
  title: string;
  value: string;
}

/**
 * The answers the write-through leaves in cockpit_csm_call_forms, the
 * browser's mirror of cockpit_form_checkin_legacy (7.2): the exact Typeform
 * titles, so the client brief reads native notes as it reads the Typeform's.
 */
export function legacyAnswers(
  answers: Answers,
  taskId: string,
): LegacyAnswer[] {
  const out: LegacyAnswer[] = [{ ...SCHEMA.legacy.clientId, value: taskId }];
  const call = callOf(answers.call);
  const share =
    call?.kind === "fathom" && typeof call.shareUrl === "string"
      ? call.shareUrl
      : null;
  if (share) out.push({ ...SCHEMA.legacy.recording, value: share });
  const lines = [
    ...todosOf(answers.we_owe).map(t => `Mahara: ${t.text}`),
    ...todosOf(answers.they_owe).map(t => `Client: ${t.text}`),
  ];
  const notes = fieldOf("we_owe")?.legacy;
  if (lines.length && notes)
    out.push({
      ref: notes.ref,
      type: notes.type,
      title: notes.title,
      value: lines.join("\n"),
    });
  for (const k of ["client_notes", "defcon", "priority"] as const) {
    const v = answers[k];
    const l = fieldOf(k)?.legacy;
    if (l && typeof v === "string" && v.trim())
      out.push({ ref: l.ref, type: l.type, title: l.title, value: v.trim() });
  }
  return out;
}
