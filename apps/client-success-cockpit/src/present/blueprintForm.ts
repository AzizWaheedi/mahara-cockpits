/**
 * The Brand Blueprint form: the one list of its questions (docs/brand-
 * blueprint/SPEC.md 1.2 to 1.7). Pure, no React, no I/O. Every answer key,
 * its type and its part are here, and the browser's mirror of the server's
 * checks (`missing`, `partAnswers`, `checkValue`), so a typed answer the
 * server would refuse is caught before it is sent. The SQL allow-list and
 * required keys are tested against this file
 * (scripts/blueprint-form.test.ts).
 */

export type BpPart = 1 | 2 | 3;
export type Answers = Record<string, unknown>;
export type FieldType =
  | "text"
  | "long"
  | "choice"
  | "ticks"
  | "lines"
  | "money"
  | "usd"
  | "url"
  | "date"
  | "names"
  | "rules"
  | "offer";

/** The five main services, in the kickoff's order (the server's choices). */
export const BP_SERVICES = [
  "design-build",
  "interior",
  "architecture",
  "fitout",
  "construction",
] as const;
export type BpService = (typeof BP_SERVICES)[number];

export const CURRENCIES = [
  "KWD",
  "SAR",
  "AED",
  "QAR",
  "BHD",
  "OMR",
  "USD",
] as const;
export type Currency = (typeof CURRENCIES)[number];

interface FieldDef {
  type: FieldType;
  part: BpPart;
  choices?: readonly string[];
}

const f = (
  type: FieldType,
  part: BpPart,
  choices?: readonly string[],
): FieldDef => ({ type, part, ...(choices ? { choices } : {}) });

/** Every answer key the server keeps (shot_list_due is the server's own). */
export const FIELDS = {
  service: f("choice", 1, BP_SERVICES),
  capacity: f("choice", 1, ["yes", "tight", "no"]),
  capacity_note: f("text", 1),
  starter: f("choice", 1, ["yes", "no"]),
  pack_url: f("url", 1),
  pack_approval: f("choice", 1, ["on_call", "before", "wants_changes"]),
  pack_changes: f("long", 1),
  daily_budget: f("usd", 1),
  destination: f("choice", 1, ["lead_form", "landing_page"]),
  identity: f("choice", 1, ["their_page", "our_page"]),
  red_lines: f("lines", 1),
  best_client: f("long", 2),
  not_for: f("long", 2),
  method: f("long", 2),
  city_cant: f("long", 2),
  pricing: f("long", 2),
  minimum: f("money", 2),
  anchor: f("money", 2),
  terms: f("long", 2),
  margin: f("text", 2),
  competitors: f("names", 2),
  why_us: f("long", 2),
  approval: f("choice", 2, ["every", "first_batch", "run_then_show"]),
  dna_status: f("choice", 2, ["complete", "small_gaps", "big_gaps"]),
  dna_missing: f("long", 2),
  rules: f("rules", 2),
  camera: f("choice", 2, ["yes_studio", "yes_phone", "no", "unsure"]),
  content_rating: f("choice", 2, ["strong", "usable", "weak", "none"]),
  shot_list: f("ticks", 2),
  events: f("long", 2),
  readback_yes: f("ticks", 2),
  csm_signals: f("long", 2),
  anything_else: f("long", 2),
  offer: f("offer", 3),
  scripts_status: f("choice", 3, ["in_progress", "with_editors"]),
  scripts_date: f("date", 3),
} as const satisfies Record<string, FieldDef>;

export type BpKey = keyof typeof FIELDS;
export const BP_KEYS = Object.keys(FIELDS) as BpKey[];
export const isBpKey = (k: string): k is BpKey => Object.hasOwn(FIELDS, k);

/** A part's keys, in the server's order (cockpit_blueprint_part_answers). */
export const PART_KEYS: Record<BpPart, readonly string[]> = {
  1: [
    "service",
    "capacity",
    "capacity_note",
    "starter",
    "pack_url",
    "pack_approval",
    "pack_changes",
    "daily_budget",
    "destination",
    "identity",
    "red_lines",
  ],
  2: [
    "best_client",
    "not_for",
    "method",
    "city_cant",
    "pricing",
    "minimum",
    "anchor",
    "terms",
    "margin",
    "competitors",
    "why_us",
    "approval",
    "dna_status",
    "dna_missing",
    "rules",
    "camera",
    "content_rating",
    "shot_list",
    "shot_list_due",
    "events",
    "readback_yes",
    "csm_signals",
    "anything_else",
  ],
  3: ["offer", "scripts_status", "scripts_date"],
};

/** Where a question is answered (SPEC 1.1 "Where"). */
export type Place =
  | { slide: string; notes?: false }
  | { notes: string }
  | { prep: true }
  | { cd: true };

/** One visible question (SPEC 1.2 to 1.4): 33 in all, 3.2 being a link. */
export interface Question {
  n: string;
  part: BpPart;
  /** Its main answer key; null for the part 3 press. */
  key: BpKey | null;
  /** The answer that comes with it on a condition (a note, the missing part). */
  sub?: BpKey;
  label: string;
  /** "when": required on a condition (SPEC 1.6). */
  req: "yes" | "no" | "when";
  /** P prefilled, S a summary, D a seeded default, N new, AUTO the server's. */
  prefill: "P" | "S" | "D" | "N" | "AUTO";
  /** Typed or tapped on the shared slide: the client sees it. */
  client: boolean;
  where: Place[];
}

const q = (
  n: string,
  key: BpKey | null,
  label: string,
  req: Question["req"],
  prefill: Question["prefill"],
  client: boolean,
  where: Place[],
  sub?: BpKey,
): Question => ({
  n,
  part: Number(n[0]) as BpPart,
  key,
  label,
  req,
  prefill,
  client,
  where,
  ...(sub ? { sub } : {}),
});

export const QUESTIONS: readonly Question[] = [
  q("1.1", "service", "The one service this campaign sells", "yes", "P", true, [
    { slide: "one-service" },
  ]),
  q(
    "1.2",
    "capacity",
    "Capacity to take more of it",
    "yes",
    "N",
    false,
    [{ notes: "one-service" }],
    "capacity_note",
  ),
  q(
    "1.3",
    "starter",
    "Start with our starter ads while we make yours?",
    "yes",
    "P",
    true,
    [{ slide: "first-ads" }],
  ),
  q("1.4", "pack_url", "Which pack (a Drive folder)", "when", "P", false, [
    { notes: "first-ads" },
  ]),
  q(
    "1.5",
    "pack_approval",
    "The client approved the pack",
    "when",
    "D",
    true,
    [{ slide: "first-ads" }],
    "pack_changes",
  ),
  q("1.6", "daily_budget", "Daily budget", "yes", "P", false, [
    { notes: "so-far" },
    { notes: "first-ads" },
  ]),
  q("1.7", "destination", "Where the ad sends people", "yes", "P", false, [
    { notes: "first-ads" },
  ]),
  q("1.8", "identity", "Publishing identity", "yes", "P", false, [
    { notes: "first-ads" },
  ]),
  q("1.9", "red_lines", "Red lines for any ad", "no", "S", true, [
    { slide: "so-far" },
  ]),
  q("2.1", "best_client", "The clients you want more of", "yes", "S", true, [
    { slide: "so-far" },
    { slide: "best-at" },
  ]),
  q("2.2", "not_for", "Who you don't want", "no", "N", true, [
    { slide: "best-at" },
  ]),
  q(
    "2.3",
    "method",
    "How a project runs with you, first call to handover",
    "yes",
    "N",
    true,
    [{ slide: "best-at" }],
  ),
  q(
    "2.4",
    "city_cant",
    "What most firms in your city can't do",
    "no",
    "N",
    true,
    [{ slide: "best-at" }],
  ),
  q(
    "2.5",
    "pricing",
    "How you price, and where most projects land",
    "yes",
    "S",
    true,
    [{ slide: "pricing" }],
  ),
  q("2.6", "minimum", "The smallest project you take", "yes", "N", true, [
    { slide: "pricing" },
  ]),
  q("2.7", "anchor", "The project size your ads point to", "yes", "N", true, [
    { slide: "pricing" },
  ]),
  q("2.8", "terms", "Deposit and payment terms", "no", "S", true, [
    { slide: "pricing" },
  ]),
  q(
    "2.9",
    "margin",
    "Margin on this service (a % or a range)",
    "no",
    "N",
    false,
    [{ notes: "pricing" }],
  ),
  q(
    "2.10",
    "competitors",
    "Who you're up against, and who you actually lose to",
    "yes",
    "S",
    true,
    [{ slide: "competitors" }],
  ),
  q("2.11", "why_us", "Why people pick you instead", "no", "N", true, [
    { slide: "competitors" },
  ]),
  q("2.12", "approval", "How you approve your own ads", "yes", "D", true, [
    { slide: "how-ads-work" },
  ]),
  q(
    "2.13",
    "dna_status",
    "Brand DNA doc status, and what is missing",
    "yes",
    "N",
    false,
    [{ notes: "brand" }],
    "dna_missing",
  ),
  q(
    "2.14",
    "rules",
    "What must always appear, never appear, and never be shown",
    "yes",
    "S",
    true,
    [{ slide: "brand" }],
  ),
  q("2.15", "camera", "On camera, and how", "yes", "D", true, [
    { slide: "content" },
  ]),
  q("2.16", "content_rating", "Their existing content", "no", "S", false, [
    { notes: "content" },
  ]),
  q(
    "2.17",
    "shot_list",
    "Shot list given; due 72 hours after the call",
    "no",
    "AUTO",
    false,
    [{ notes: "content" }],
  ),
  q("2.18", "events", "Events coming up to script for", "no", "N", false, [
    { notes: "content" },
  ]),
  q(
    "2.19",
    "readback_yes",
    "They said yes to the read-back",
    "yes",
    "N",
    false,
    [{ notes: "read-back" }],
  ),
  q(
    "2.20",
    "csm_signals",
    "Capacity, UGC or upsell signals for the CSM",
    "no",
    "N",
    false,
    [{ notes: "next" }],
  ),
  q(
    "2.21",
    "anything_else",
    "Anything else the team should know",
    "no",
    "N",
    false,
    [{ notes: "next" }],
  ),
  q(
    "3.1",
    "offer",
    "Your offer: its name, what they get, and the free first step",
    "yes",
    "N",
    true,
    [{ notes: "offer" }, { slide: "read-back" }, { cd: true }],
  ),
  q("3.3", null, "Offer locked in the doc", "yes", "N", false, [{ cd: true }]),
  q(
    "3.4",
    "scripts_status",
    "Custom scripts: in progress or with the editors, and a date",
    "no",
    "N",
    false,
    [{ cd: true }],
    "scripts_date",
  ),
];

export const questionOf = (key: string): Question | undefined =>
  QUESTIONS.find(x => x.key === key || x.sub === key);

/** A key's label for the notes and prep ("Daily budget"). */
export function labelOf(key: string): string {
  const qn = questionOf(key);
  if (!qn) return key;
  if (qn.sub === key) return SUB_LABEL[key] ?? qn.label;
  return qn.label;
}
const SUB_LABEL: Record<string, string> = {
  capacity_note: "One line for the CSM on capacity",
  pack_changes: "The changes they want to the pack",
  dna_missing: "What is missing in the Brand DNA doc",
  scripts_date: "The scripts' date",
};

// ------------------------------------------------------------ values

/** An answer is there: not null, not a blank text, not an empty list. */
export const has = (a: Answers, k: string) => {
  if (!Object.hasOwn(a, k)) return false;
  const v = a[k];
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

/**
 * A part's answers as they count for its press (cockpit_blueprint_part_
 * answers): its own keys, without the ones its conditions switch off.
 */
export function partAnswers(part: BpPart, answers: Answers): Answers {
  const out: Answers = {};
  for (const k of PART_KEYS[part]) if (has(answers, k)) out[k] = answers[k];
  if (part === 1) {
    if (out.starter !== "yes") {
      delete out.pack_url;
      delete out.pack_approval;
      delete out.pack_changes;
    }
    if (out.pack_approval !== "wants_changes") delete out.pack_changes;
    if (out.capacity !== "tight" && out.capacity !== "no")
      delete out.capacity_note;
  } else if (part === 2) {
    if ((out.dna_status ?? "complete") === "complete") delete out.dna_missing;
    if (out.shot_list !== true) delete out.shot_list_due;
  }
  return out;
}

/**
 * The required keys a part still lacks, in the form's order
 * (cockpit_blueprint_missing, SPEC 1.6). Part 3's offer needs all three of
 * its lines.
 */
export function missing(part: BpPart, answers: Answers): string[] {
  const a = partAnswers(part, answers);
  const m: string[] = [];
  const need = (k: string) => {
    if (!has(a, k)) m.push(k);
  };
  if (part === 1) {
    need("service");
    need("capacity");
    if (a.capacity === "tight" || a.capacity === "no") need("capacity_note");
    need("starter");
    if (a.starter === "yes") {
      need("pack_url");
      need("pack_approval");
      if (a.pack_approval === "wants_changes") need("pack_changes");
    }
    need("daily_budget");
    need("destination");
    need("identity");
  } else if (part === 2) {
    for (const k of [
      "best_client",
      "method",
      "pricing",
      "minimum",
      "anchor",
      "competitors",
      "approval",
      "dna_status",
    ])
      need(k);
    if (a.dna_status === "small_gaps" || a.dna_status === "big_gaps")
      need("dna_missing");
    for (const k of ["rules", "camera", "readback_yes"]) need(k);
  } else {
    const o = (a.offer ?? {}) as Record<string, unknown>;
    if (!str(o.name) || !str(o.what) || !str(o.firstStep)) m.push("offer");
  }
  return m;
}

/** Whether a question asks for an answer on these answers (SPEC 1.6). */
export function required(qn: Question, answers: Answers): boolean {
  if (qn.req === "yes") return true;
  if (qn.req === "no") return false;
  return answers.starter === "yes";
}

/** Whether a question shows on these answers (1.4 and 1.5 only when starter = yes). */
export function shown(qn: Question, answers: Answers): boolean {
  if (qn.key === "pack_url" || qn.key === "pack_approval")
    return answers.starter === "yes";
  return true;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const DRIVE_FOLDER =
  /^https:\/\/drive\.google\.com\/drive\/(u\/[0-9]\/)?folders\/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$/;
export const isDriveFolder = (v: unknown) =>
  typeof v === "string" && DRIVE_FOLDER.test(v.trim());

/** The Drive folder's id, for the embedded folder view. */
export function folderId(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /\/folders\/([A-Za-z0-9_-]{10,100})/.exec(url);
  return m ? m[1] : null;
}

function lines(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) throw Error(`${what} is a list of lines.`);
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") throw Error(`${what} is a list of lines.`);
    const s = x.trim().replace(/\s+/g, " ");
    if (!s || out.some(y => y.toLowerCase() === s.toLowerCase())) continue;
    if (s.length > 200) throw Error(`Keep each line under 200 characters.`);
    out.push(s);
  }
  if (out.length > 12) throw Error("Keep it to 12 lines at most.");
  return out;
}

/**
 * One answer as the server will keep it, or a plain sentence saying why it
 * would be refused. Null removes the key (a blank, an empty list).
 */
export function checkValue(
  key: string,
  value: unknown,
): { value: unknown } | { error: string } {
  if (!isBpKey(key))
    return { error: `The Brand Blueprint has no answer called ${key}.` };
  if (value === null || value === undefined) return { value: null };
  const d: FieldDef = FIELDS[key];
  try {
    switch (d.type) {
      case "choice": {
        const s = typeof value === "string" ? value.trim() : "";
        if (!s) return { value: null };
        if (!d.choices?.includes(s))
          return { error: `"${s}" is not one of the answers.` };
        return { value: s };
      }
      case "text":
      case "long": {
        if (typeof value !== "string") return { error: "This answer is text." };
        let s = value.trim();
        if (d.type === "text") s = s.replace(/\s*[\r\n]+\s*/g, " ");
        if (!s) return { value: null };
        const max = d.type === "text" ? 300 : 4000;
        if (s.length > max)
          return { error: `Keep it under ${max} characters.` };
        return { value: s };
      }
      case "url": {
        const s = typeof value === "string" ? value.trim() : "";
        if (!s) return { value: null };
        if (!DRIVE_FOLDER.test(s))
          return {
            error: "Paste the starter pack's Google Drive folder link.",
          };
        return { value: s };
      }
      case "date": {
        const s = typeof value === "string" ? value.trim() : "";
        if (!s) return { value: null };
        const ok =
          /^\d{4}-\d{2}-\d{2}$/.test(s) &&
          new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
        return ok ? { value: s } : { error: "Choose a real date." };
      }
      case "ticks":
        if (typeof value !== "boolean") return { error: "This is a tick." };
        return { value: value ? true : null };
      case "usd": {
        const o = value as { usd?: unknown; said?: unknown };
        if (typeof o !== "object" || typeof o.usd !== "number")
          return { error: "Enter the daily figure in dollars." };
        if (!(o.usd >= 1 && o.usd <= 100_000))
          return { error: "Enter a figure from 1 to 100,000 dollars." };
        const said = str(o.said);
        if (said && said.length > 200)
          return { error: "Keep what was said under 200 characters." };
        return { value: said ? { usd: o.usd, said } : { usd: o.usd } };
      }
      case "money": {
        const o = value as { amount?: unknown; currency?: unknown };
        if (typeof o !== "object" || typeof o.amount !== "number")
          return { error: "Enter the amount as a number." };
        if (!(o.amount >= 1 && o.amount <= 100_000_000))
          return { error: "Enter an amount from 1 to 100,000,000." };
        if (!CURRENCIES.includes(o.currency as Currency))
          return { error: "Choose the currency." };
        return { value: { amount: o.amount, currency: o.currency } };
      }
      case "lines": {
        const out = lines(value, "The red lines");
        return { value: out.length ? out : null };
      }
      case "rules": {
        const o = value as Record<string, unknown>;
        if (typeof o !== "object")
          return { error: "The rules are three lists." };
        const out: Record<string, string[]> = {};
        for (const k of ["always", "never", "neverShow"]) {
          const l =
            o[k] === undefined || o[k] === null
              ? []
              : lines(o[k], "A rule list");
          if (l.length) out[k] = l;
        }
        return { value: Object.keys(out).length ? out : null };
      }
      case "names": {
        if (!Array.isArray(value))
          return { error: "The competitors are a list of names." };
        // A name, marked or not as one they lose to, and what they are known
        // for in the client's words (slide 8's clipping), as the server keeps it.
        const out: { name: string; lose: boolean; note?: string }[] = [];
        for (const x of value as {
          name?: unknown;
          lose?: unknown;
          note?: unknown;
        }[]) {
          const nm = str(x?.name)?.replace(/\s+/g, " ");
          if (!nm || out.some(y => y.name.toLowerCase() === nm.toLowerCase()))
            continue;
          if (nm.length > 120)
            return { error: "Keep a competitor's name under 120 characters." };
          const note = str(x?.note)?.replace(/\s+/g, " ");
          if (note && note.length > 160)
            return {
              error:
                "Keep what a competitor is known for under 160 characters.",
            };
          out.push({
            name: nm,
            lose: x.lose === true,
            ...(note ? { note } : {}),
          });
        }
        if (out.length > 15) return { error: "Name 15 competitors at most." };
        return { value: out.length ? out : null };
      }
      case "offer": {
        const o = value as Record<string, unknown>;
        if (typeof o !== "object")
          return {
            error: "The offer is its name, what they get and the first step.",
          };
        const out: Record<string, string> = {};
        const max: Record<string, number> = {
          name: 80,
          what: 200,
          firstStep: 160,
        };
        for (const k of ["name", "what", "firstStep"]) {
          const s = str(o[k])?.replace(/\s+/g, " ");
          if (!s) continue;
          if (s.length > max[k])
            return {
              error: `Keep the offer's ${k === "firstStep" ? "first step" : k} under ${max[k]} characters.`,
            };
          out[k] = s;
        }
        return { value: Object.keys(out).length ? out : null };
      }
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { error: "This answer could not be read." };
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
