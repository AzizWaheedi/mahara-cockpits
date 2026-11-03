/**
 * The forms editor's pure core (docs/forms/WAVE34-CONTRACT.md 3.1, 4.9,
 * 5.13): the client form schema v1 as the editor reads it, the draft's
 * edits, the field guard the screen mirrors (the database decides; this
 * only disables what it would refuse), the change list shown before Publish,
 * the routing bounds, and the words of the history line. No React, no
 * network, no `@/` import: the media buyer app's PGlite test reads the
 * fixtures that import these types.
 */

export type Lang = "en" | "ar";
export type Text = { en: string; ar: string };

export const FIELD_TYPES = [
  "scale",
  "choice",
  "multi",
  "text",
  "longtext",
  "tick",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldOption = { value: string; label: Text };
export type ShowIf = { key: string; equals: unknown } | null;
export type BoldIf = { context: string; equals: unknown } | null;

export type FormField = {
  key: string;
  type: FieldType;
  label: Text;
  hint?: Text | null;
  required: boolean;
  min?: number;
  max?: number;
  lowLabel?: Text;
  highLabel?: Text;
  options?: FieldOption[];
  maxLength?: number;
  showIf?: ShowIf;
  boldIf?: BoldIf;
};

export type ContextFact = { key: string; type: string; label: Text };

export type ClientFormSchema = {
  v: 1;
  key: string;
  title: Text;
  intro: Text | null;
  minutes: number;
  audience: "any" | "admin";
  signer: "none" | "typed";
  context: ContextFact[];
  fields: FormField[];
  reads: Record<string, string[]>;
  submit: Text;
  done: Text;
  invite: { whatsapp: Text; push: Text };
};

export type FormGroup = "client" | "staff" | "typeform";

/** One form's line on the editor's list (cockpit_form_editor_row). */
export type EditorFormRow = {
  key: string;
  title: string;
  titleAr: string | null;
  group: FormGroup;
  editable: boolean;
  why: string | null;
  provider: string;
  audience: string;
  version: number | null;
  registryVersion: number;
  publishedAt: string | null;
  publishedBy: string | null;
  questions: number | null;
  live: boolean | null;
  draft: {
    baseVersion: number;
    savedAt: string;
    savedBy: string;
    stale: boolean;
  } | null;
};

export type NpsRule = {
  firstDay: number;
  everyDays: number;
  remindAfterDays: number;
};
export type CsatRule = {
  afterLaunchDays: number;
  whatsappAfterDays: number;
  snoozeDays: number;
  reissues: number;
  retryAfterDays: number;
  maxAgeDays: number;
};
export type ScheduleRow<R> = {
  on: boolean;
  rule: Partial<R> & Record<string, unknown>;
  updatedAt?: string | null;
  updatedBy?: string | null;
};
export type Routing = {
  schedules: {
    nps?: ScheduleRow<NpsRule>;
    csat?: ScheduleRow<CsatRule>;
  } | null;
  lowScore: { max: number } | null;
  scheduleOn: boolean | null;
  note: string;
};

export type Workspace = { locationId: string; name: string; status: string };

export type EditorRead = {
  forms: EditorFormRow[];
  routing: Routing;
  portalBase: string;
  workspaces: Workspace[];
};

export type HistoryItem = {
  version: number;
  publishedAt: string;
  publishedBy: string;
  note: string | null;
  client: boolean;
  current: boolean;
};

export type EditorOne = {
  form: EditorFormRow;
  published: {
    version: number;
    schema: ClientFormSchema;
    publishedAt: string;
    publishedBy: string;
    note: string | null;
  } | null;
  draft: {
    schema: ClientFormSchema;
    baseVersion: number;
    savedAt: string;
    savedBy: string;
    stale: boolean;
    problem: string | null;
    where: string | null;
  } | null;
  history: HistoryItem[];
  reads: { effect: string; label: string; fields: string[] }[];
  record: {
    fields: string[];
    lives: string | null;
    typeformId: string | null;
  } | null;
};

export type RoutingPatch = {
  nps?: { on?: boolean; rule?: Partial<NpsRule> };
  csat?: { on?: boolean; rule?: Partial<CsatRule> };
  lowScore?: { max: number };
};

// --- Words ---------------------------------------------------------------

export const GROUP_TITLE: Record<FormGroup, string> = {
  client: "Client forms",
  staff: "Staff forms",
  typeform: "Typeform and Make forms",
};

export const GROUP_SUB: Record<FormGroup, string> = {
  client:
    "What clients see in their portal and by WhatsApp link. Each change publishes as a new version.",
  staff: "Filled by the team in the cockpit. Read only here.",
  typeform: "Still filled in Typeform. Read only here.",
};

export const TYPE_LABEL: Record<FieldType, string> = {
  scale: "Scale",
  choice: "One choice",
  multi: "Several choices",
  text: "Short answer",
  longtext: "Long answer",
  tick: "Tick box",
};

export const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  ar: "Arabic",
};

/** The editor's copy (5.13), in one place so the tests read the same words. */
export const COPY = {
  saveDraft: "Save draft",
  draftSaved: "Draft saved",
  publish: (next: number) => `Publish version ${next}`,
  published: "Published",
  notePrompt: "What changed? (shown in the history)",
  goBack: (n: number) => `Go back to version ${n}`,
  restored: (m: number) => `Restored as version ${m}`,
  realPreview: "Open the real preview",
  noChanges: "No changes yet.",
  discard: "Discard draft",
  discarded: "Draft discarded",
  doorClosed: "Opens after the next cockpit update.",
  saveRouting: "Save routing",
  routingSaved: "Routing saved",
} as const;

// --- Dates (Kuwait) --------------------------------------------------------

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kuwait",
});

/** "2 Nov", Kuwait time; an empty string for a missing or bad date. */
export function kuwaitDay(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : DAY.format(d);
}

/** The history line (5.13): "v3 published 2 Nov · an admin". */
export function historyLine(h: HistoryItem): string {
  const day = kuwaitDay(h.publishedAt);
  return `v${h.version} published${day ? ` ${day}` : ""} · ${h.publishedBy}`;
}

// --- Reading a schema -----------------------------------------------------

/** effect key → field keys, inverted: field key → effect keys (sorted). */
export function readsByField(
  schema: Pick<ClientFormSchema, "reads"> | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [effect, fields] of Object.entries(schema?.reads ?? {}))
    for (const f of Array.isArray(fields) ? fields : []) {
      const list = out[f] ?? [];
      list.push(effect);
      out[f] = list;
    }
  for (const k of Object.keys(out)) out[k]?.sort();
  return out;
}

/**
 * What the screen locks for one field (4.9.3): a field an effect reads keeps
 * its place, visibility, type, range, requirement and choice values; any
 * published field keeps its key and type (a key keeps its type for good).
 */
export function fieldLocks(
  published: ClientFormSchema | null | undefined,
  key: string,
): {
  published: boolean;
  read: boolean;
  effects: string[];
} {
  const isPublished = Boolean(published?.fields.some(f => f.key === key));
  const effects = readsByField(published)[key] ?? [];
  return { published: isPublished, read: effects.length > 0, effects };
}

/** Field keys: ^[a-z][a-zA-Z0-9]{1,30}$ (3.1). */
export const FIELD_KEY = /^[a-z][a-zA-Z0-9]{1,30}$/;
/** Option values: ^[a-z][a-z0-9_]{1,30}$ (3.1). */
export const OPTION_VALUE = /^[a-z][a-z0-9_]{1,30}$/;

/** A camelCase key from English words, unique among `taken`. */
export function keyFromLabel(label: string, taken: Iterable<string>): string {
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  let base = words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  if (!/^[a-z]/.test(base)) base = `question${base}`;
  base = base.slice(0, 24);
  if (base.length < 2) base = "question";
  const used = new Set(taken);
  if (!used.has(base) && FIELD_KEY.test(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const k = `${base}${i}`;
    if (!used.has(k)) return k;
  }
  return `${base}${Date.now() % 1000}`;
}

/** An option value from English words, unique among `taken`. */
export function valueFromLabel(label: string, taken: Iterable<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  if (!/^[a-z]/.test(base)) base = `option_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = "option";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const v = `${base}_${i}`;
    if (!used.has(v)) return v;
  }
  return `${base}_x`;
}

const blank = (): Text => ({ en: "", ar: "" });

/** A new question of a type, with the bounds 3.1 allows. */
export function newField(type: FieldType, taken: Iterable<string>): FormField {
  const key = keyFromLabel(`new ${type}`, taken);
  const base: FormField = { key, type, label: blank(), required: false };
  switch (type) {
    case "scale":
      return {
        ...base,
        min: 0,
        max: 10,
        lowLabel: blank(),
        highLabel: blank(),
      };
    case "choice":
    case "multi":
      return {
        ...base,
        options: [
          { value: "option_one", label: blank() },
          { value: "option_two", label: blank() },
        ],
      };
    case "text":
      return { ...base, maxLength: 200 };
    case "longtext":
      return { ...base, maxLength: 2000 };
    default:
      return base;
  }
}

/**
 * The longest answer a text question of a form may allow, as
 * cockpit_form_schema_check takes it: 200 characters for a text and 2,000 for
 * a long text, except on the client onboarding, which takes what its Typeform
 * took (1,000 and 10,000, migration 20261102o).
 */
export function maxLengthCap(formKey: string, type: string): number {
  const onboarding = formKey === "onboarding";
  if (type === "text") return onboarding ? 1000 : 200;
  return onboarding ? 10000 : 2000;
}

// --- Draft edits (each returns a new schema) --------------------------------

export function updateField(
  schema: ClientFormSchema,
  key: string,
  patch: Partial<FormField>,
): ClientFormSchema {
  return {
    ...schema,
    fields: schema.fields.map(f => (f.key === key ? { ...f, ...patch } : f)),
  };
}

export function addField(
  schema: ClientFormSchema,
  type: FieldType,
): { schema: ClientFormSchema; key: string } {
  const field = newField(
    type,
    schema.fields.map(f => f.key),
  );
  return {
    schema: { ...schema, fields: [...schema.fields, field] },
    key: field.key,
  };
}

export function removeField(
  schema: ClientFormSchema,
  key: string,
): ClientFormSchema {
  return {
    ...schema,
    // A later question that showed only after this one shows always now.
    fields: schema.fields
      .filter(f => f.key !== key)
      .map(f => (f.showIf?.key === key ? { ...f, showIf: null } : f)),
  };
}

/** Moves a question to `to`; a question never moves above the one its show-if reads. */
export function moveField(
  schema: ClientFormSchema,
  key: string,
  to: number,
): ClientFormSchema {
  const from = schema.fields.findIndex(f => f.key === key);
  if (from < 0) return schema;
  const target = Math.max(0, Math.min(schema.fields.length - 1, to));
  if (target === from) return schema;
  const next = [...schema.fields];
  const [item] = next.splice(from, 1);
  if (!item) return schema;
  next.splice(target, 0, item);
  const order = new Map(next.map((f, i) => [f.key, i]));
  for (const f of next)
    if (f.showIf && (order.get(f.showIf.key) ?? -1) >= (order.get(f.key) ?? 0))
      return schema;
  return { ...schema, fields: next };
}

/** Whether moving `key` to `to` keeps every show-if pointing at an earlier question. */
export function canMove(
  schema: ClientFormSchema,
  key: string,
  to: number,
): boolean {
  return moveField(schema, key, to) !== schema;
}

// --- What changed (shown before Publish) -------------------------------------

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Plain lines saying what a draft changes against the published version. */
export function changeList(
  published: ClientFormSchema | null | undefined,
  draft: ClientFormSchema | null | undefined,
): string[] {
  if (!draft) return [];
  if (!published) return ["A first version of this form."];
  const out: string[] = [];
  const label = (f: FormField) => f.label.en || f.key;
  const before = new Map(published.fields.map(f => [f.key, f]));
  const after = new Map(draft.fields.map(f => [f.key, f]));
  for (const f of draft.fields)
    if (!before.has(f.key)) out.push(`Added: ${label(f)}`);
  for (const f of published.fields)
    if (!after.has(f.key)) out.push(`Removed: ${label(f)}`);
  for (const f of draft.fields) {
    const old = before.get(f.key);
    if (!old || same(old, f)) continue;
    const parts: string[] = [];
    if (!same(old.label, f.label) || !same(old.hint ?? null, f.hint ?? null))
      parts.push("wording");
    if (old.required !== f.required)
      parts.push(f.required ? "now required" : "now optional");
    if (old.min !== f.min || old.max !== f.max) parts.push("range");
    if (!same(old.lowLabel, f.lowLabel) || !same(old.highLabel, f.highLabel))
      parts.push("scale ends");
    if (!same(old.options, f.options)) parts.push("choices");
    if (!same(old.showIf ?? null, f.showIf ?? null))
      parts.push("when it shows");
    if (old.maxLength !== f.maxLength) parts.push("length");
    if (old.type !== f.type) parts.push("type");
    out.push(`Changed: ${label(f)} (${parts.join(", ") || "details"})`);
  }
  const order = (s: ClientFormSchema) =>
    s.fields.map(f => f.key).filter(k => before.has(k) && after.has(k));
  if (!same(order(published), order(draft))) out.push("New order of questions");
  if (!same(published.title, draft.title)) out.push("New title");
  if (!same(published.intro, draft.intro)) out.push("New introduction");
  if (published.minutes !== draft.minutes)
    out.push(`Minutes shown: ${draft.minutes}`);
  if (!same(published.submit, draft.submit)) out.push("New button words");
  if (!same(published.done, draft.done)) out.push("New thank-you line");
  if (!same(published.invite?.whatsapp, draft.invite?.whatsapp))
    out.push("New WhatsApp text");
  if (!same(published.invite?.push, draft.invite?.push))
    out.push("New phone alert text");
  if (!same(published.context, draft.context))
    out.push("New wording of the invite facts");
  return out;
}

// --- Where a refusal points ----------------------------------------------------

/**
 * A server path (".fields[2].label.en", ".fields.recommend", ".invite.whatsapp.ar")
 * as words for the line under a refusal.
 */
export function describePath(
  schema: ClientFormSchema | null | undefined,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const lang = /\.(en|ar)$/.exec(path)?.[1] as Lang | undefined;
  const inLang = lang ? ` (${LANG_LABEL[lang]})` : "";
  const byIndex = /^\.fields\[(\d+)\](.*)$/.exec(path);
  const byKey = /^\.fields\.([a-zA-Z0-9]+)$/.exec(path);
  const field = byIndex
    ? schema?.fields[Number(byIndex[1])]
    : byKey
      ? schema?.fields.find(f => f.key === byKey[1])
      : undefined;
  if (field || byIndex) {
    const name = field?.label.en || field?.key || "a question";
    const rest = byIndex?.[2] ?? "";
    const part = /^\.options\[(\d+)\]/.test(rest)
      ? `, choice ${Number(/^\.options\[(\d+)\]/.exec(rest)?.[1]) + 1}`
      : rest.startsWith(".hint")
        ? ", its hint"
        : rest.startsWith(".lowLabel")
          ? ", its low end"
          : rest.startsWith(".highLabel")
            ? ", its high end"
            : "";
    return `In “${name}”${part}${inLang}`;
  }
  const top: Record<string, string> = {
    ".title": "In the title",
    ".intro": "In the introduction",
    ".submit": "In the button words",
    ".done": "In the thank-you line",
    ".invite.whatsapp": "In the WhatsApp text",
    ".invite.push": "In the phone alert text",
    ".context": "In the invite facts",
    ".reads": "In what the cockpit reads",
  };
  for (const [prefix, words] of Object.entries(top))
    if (path.startsWith(prefix)) return `${words}${inLang}`;
  return null;
}

// --- Routing (4.9.2) ---------------------------------------------------------

export type Bound = { key: string; words: string; lo: number; hi: number };

export const NPS_BOUNDS: readonly Bound[] = [
  { key: "firstDay", words: "The first NPS day after launch", lo: 30, hi: 180 },
  { key: "everyDays", words: "The days between NPS rounds", lo: 30, hi: 365 },
  {
    key: "remindAfterDays",
    words: "The days before an unanswered NPS shows on Today",
    lo: 1,
    hi: 14,
  },
];

export const CSAT_BOUNDS: readonly Bound[] = [
  {
    key: "afterLaunchDays",
    words: "The days after launch before the onboarding survey",
    lo: 0,
    hi: 30,
  },
  {
    key: "whatsappAfterDays",
    words: "The day after launch the WhatsApp link goes",
    lo: 0,
    hi: 14,
  },
  { key: "snoozeDays", words: 'The days "Not now" waits', lo: 1, hi: 14 },
  { key: "reissues", words: "The number of re-tries", lo: 0, hi: 3 },
  { key: "retryAfterDays", words: "The days between re-tries", lo: 1, hi: 30 },
  {
    key: "maxAgeDays",
    words: "The last day after launch it can go",
    lo: 14,
    hi: 120,
  },
];

export const LOW_SCORE_BOUND: Bound = {
  key: "max",
  words: "The low-score line",
  lo: 0,
  hi: 8,
};

/** The first problem with a rule, in the server's words; null when it saves. */
export function ruleProblem(
  bounds: readonly Bound[],
  rule: Record<string, unknown>,
): string | null {
  for (const b of bounds) {
    const v = rule[b.key];
    if (v === undefined || v === null || v === "")
      return `${b.words} is missing. Set it, then save.`;
    if (typeof v !== "number" || !Number.isInteger(v) || v < b.lo || v > b.hi)
      return `${b.words} is a whole number from ${b.lo} to ${b.hi}.`;
  }
  if (
    bounds === CSAT_BOUNDS &&
    (Number(rule.maxAgeDays) <= Number(rule.afterLaunchDays) ||
      Number(rule.maxAgeDays) <= Number(rule.whatsappAfterDays))
  )
    return "The last day it can go must come after the day it first goes.";
  return null;
}

/** One rule sentence for the routing card. */
export function npsSentence(r: Partial<NpsRule>): string {
  return `First NPS on day ${r.firstDay ?? "?"} after launch, then every ${r.everyDays ?? "?"} days. Unanswered after ${r.remindAfterDays ?? "?"} days, it shows on Today.`;
}

export function csatSentence(r: Partial<CsatRule>): string {
  return `Goes ${r.afterLaunchDays === 0 ? "on launch day" : `${r.afterLaunchDays ?? "?"} days after launch`} in the portal; by WhatsApp from day ${r.whatsappAfterDays ?? "?"} for clients who have not opened it. Up to ${r.reissues ?? "?"} re-tries, ${r.retryAfterDays ?? "?"} days apart, until day ${r.maxAgeDays ?? "?"}.`;
}

// --- The real preview (3.7, 4.9.7) -------------------------------------------

/** The portal's staff preview: `/?clientId=<workspace>&formPreview=<key>[&draft=1]`. */
export function previewUrl(
  base: string,
  locationId: string,
  formKey: string,
  draft: boolean,
): string {
  const q = new URLSearchParams({ clientId: locationId, formPreview: formKey });
  if (draft) q.set("draft", "1");
  return `${base.replace(/\/$/, "")}/?${q.toString()}`;
}

/** The workspace the preview opens on by default: the first Active one by name. */
export function defaultWorkspace(ws: readonly Workspace[]): Workspace | null {
  return (
    [...ws]
      .filter(w => w.status === "Active")
      .sort((a, b) => a.name.localeCompare(b.name))[0] ??
    ws[0] ??
    null
  );
}

/** Every {en, ar} text of a schema with its path, as the server walks them. */
export function textsOf(
  schema: unknown,
  path = "",
): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  if (Array.isArray(schema))
    schema.forEach((v, i) => {
      out.push(...textsOf(v, `${path}[${i}]`));
    });
  else if (schema && typeof schema === "object")
    for (const [k, v] of Object.entries(schema)) {
      const p = `${path}.${k}`;
      if (typeof v === "string" && (k === "en" || k === "ar"))
        out.push({ path: p, value: v });
      else out.push(...textsOf(v, p));
    }
  return out;
}

/** Texts still blank in a draft (both languages are required, 3.1). */
export function blankTexts(schema: ClientFormSchema): string[] {
  return textsOf(schema)
    .filter(t => t.value.trim() === "")
    .map(t => t.path);
}

// --- The structured onboarding (client form schema version 2), read only here --------------------------------
// supabase/migrations/20261103h_onboarding_schema_v2.sql (docs/forms/WAVE56-CONTRACT.md 4.22): a form whose newest
// version is written in schema version 2 is read only in the editor, on the server; its questions change in a
// migration. The page shows that version's outline from cockpit_form_editor_structured.

/** A show-if of schema version 2: exactly one of equals, in or includes. */
export type StructuredShowIf = {
  key: string;
  equals?: unknown;
  in?: string[];
  includes?: string;
};

export type StructuredColumn = {
  key: string;
  type: "text" | "longtext" | "number" | "choice" | "tick";
  label: Text;
  hint?: Text | null;
  required: boolean;
  options?: FieldOption[];
};

export type StructuredField = {
  key: string;
  type: string;
  label: Text;
  hint?: Text | null;
  required?: boolean;
  options?: FieldOption[];
  showIf?: StructuredShowIf | null;
  columns?: StructuredColumn[];
  minRows?: number;
  maxRows?: number;
  link?: { href: string; label: Text } | null;
  currencyFrom?: string;
};

export type StructuredSchema = {
  v: 2;
  key: string;
  title: Text;
  minutes: number;
  fields: StructuredField[];
};

export type StructuredState = "off" | "canary" | "on";

/** cockpit_form_editor_structured: the form's newest version, when it is in schema version 2. */
export type StructuredRead = {
  version: number;
  schema: StructuredSchema;
  publishedAt: string | null;
  publishedBy: string;
  note: string | null;
  state: StructuredState;
  issuing: number | null;
  answers: number;
  openInvites: number;
};

/** The server's sentence for the read-only rule (cockpit_form_editor_kind). */
export const STRUCTURED_WHY =
  "Its structured questions change in a migration for now.";

/** forms.client.schema_v2, in words, with the tone of its chip. */
export const STRUCTURED_STATE: Record<
  StructuredState,
  { words: string; tone: "neutral" | "warn" | "good" }
> = {
  off: { words: "Stored, not live", tone: "neutral" },
  canary: { words: "On the test card only", tone: "warn" },
  on: { words: "Live for new invites", tone: "good" },
};

const STRUCTURED_TYPE: Record<string, string> = {
  text: "Short answer",
  longtext: "Long answer",
  number: "Number",
  choice: "One choice",
  multi: "Several choices",
  tick: "Tick box",
  scale: "Scale",
  date: "Date",
  file: "File",
};

/** One question's kind: "Rows, 1 to 25", "Several choices (19)", "Note with a link". */
export function structuredKind(f: StructuredField): string {
  if (f.type === "rows")
    return `Rows, ${Math.max(f.required ? 1 : 0, f.minRows ?? 0)} to ${f.maxRows ?? "?"}`;
  if (f.type === "note") return f.link ? "Note with a link" : "Note";
  if (f.type === "choice" || f.type === "multi")
    return `${STRUCTURED_TYPE[f.type]} (${f.options?.length ?? 0})`;
  if (f.type === "number" && f.currencyFrom)
    return "Number, read back in the form's currency";
  return STRUCTURED_TYPE[f.type] ?? f.type;
}

/** When a question shows, in words, from the earlier question it reads; null when it always shows. */
export function showIfWords(
  f: StructuredField,
  byKey: ReadonlyMap<string, StructuredField>,
): string | null {
  const s = f.showIf;
  if (!s) return null;
  const src = byKey.get(s.key);
  const name = src?.label.en || s.key;
  const opt = (v: unknown) =>
    src?.options?.find(o => o.value === v)?.label.en ?? String(v);
  if (s.includes !== undefined)
    return `Shows when “${name}” includes ${opt(s.includes)}`;
  if (Array.isArray(s.in))
    return `Shows when “${name}” is ${s.in.map(opt).join(" or ")}`;
  if (src?.type === "tick")
    return `Shows when “${name}” is ${s.equals ? "ticked" : "not ticked"}`;
  return `Shows when “${name}” is ${opt(s.equals)}`;
}

export type OutlineItem = {
  key: string;
  label: Text;
  kind: string;
  required: boolean;
  note: boolean;
  shows: string | null;
  columns: string[];
};
export type OutlineSection = { title: Text | null; items: OutlineItem[] };

/** The structured form as its sections (one per heading), each with its questions and notes in order. */
export function structuredOutline(schema: StructuredSchema): OutlineSection[] {
  const byKey = new Map(schema.fields.map(f => [f.key, f]));
  const out: OutlineSection[] = [];
  let section: OutlineSection | null = null;
  for (const f of schema.fields) {
    if (f.type === "heading") {
      section = { title: f.label, items: [] };
      out.push(section);
      continue;
    }
    if (!section) {
      section = { title: null, items: [] };
      out.push(section);
    }
    section.items.push({
      key: f.key,
      label: f.label,
      kind: structuredKind(f),
      required: Boolean(f.required),
      note: f.type === "note",
      shows: showIfWords(f, byKey),
      columns: (f.columns ?? []).map(c => c.label.en || c.key),
    });
  }
  return out;
}

/** How many questions a structured form asks (headings and notes are shown, never answered). */
export const structuredAsked = (schema: StructuredSchema) =>
  schema.fields.filter(f => f.type !== "heading" && f.type !== "note").length;

/** The line under the state: the version new invites get, and what uses this one. */
export function structuredUse(r: StructuredRead): string {
  const issuing =
    r.issuing === null
      ? "No version goes to clients yet."
      : `New invites get version ${r.issuing}.`;
  if (!r.answers && !r.openInvites)
    return `${issuing} No answer or open invite uses version ${r.version} yet.`;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${issuing} ${plural(r.answers, "answer")} and ${plural(r.openInvites, "open invite")} on version ${r.version}.`;
}
