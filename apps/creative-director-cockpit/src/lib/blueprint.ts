import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { portalUrl } from "./portal";

/**
 * The Brand Blueprint in the creative director cockpit (docs/brand-blueprint
 * SPEC.md 4): the three parts' states, the offer's save and press, the
 * Settings, and the way into the call window.
 *
 * The form's registry lives in the client success app's deck
 * (src/present/blueprintForm.ts), and an app cannot import from another, so
 * the few rules the card needs are mirrored here from the SQL itself
 * (cockpit_blueprint_part_answers and cockpit_blueprint_missing in
 * supabase/migrations/20261024a_brand_blueprints.sql). A test runs both on
 * the same answers (media-buyer-cockpit scripts/creative-source-models.test.ts).
 */

export type Part = 1 | 2 | 3;
export const PARTS: readonly Part[] = [1, 2, 3];
export type Answers = Record<string, unknown>;

/** Each part's keys, as cockpit_blueprint_part_answers lists them. */
export const PART_KEYS: Record<Part, readonly string[]> = {
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

export const PART_NAME: Record<Part, string> = {
  1: "Starter ads",
  2: "Brand and money",
  3: "The offer",
};

/** What each part's press is called, on the call and here. */
export const PRESS: Record<Part, string> = {
  1: "Send to media",
  2: "Close the call",
  3: "Lock the offer",
};

/** Short names for a missing answer, for "Still missing: …". */
export const KEY_LABEL: Record<string, string> = {
  service: "the service",
  capacity: "their capacity",
  capacity_note: "the capacity note for the CSM",
  starter: "starter ads, yes or no",
  pack_url: "the starter pack's Drive link",
  pack_approval: "their yes to the pack",
  pack_changes: "the changes they want to the pack",
  daily_budget: "the daily budget",
  destination: "where the ad sends people",
  identity: "the publishing identity",
  red_lines: "the red lines",
  best_client: "the clients they want more of",
  not_for: "who they don't want",
  method: "how a project runs with them",
  city_cant: "what most firms in their city can't do",
  pricing: "how they price",
  minimum: "the smallest project",
  anchor: "the project size the ads point to",
  terms: "deposit and payment terms",
  margin: "the margin",
  competitors: "who they're up against",
  why_us: "why people pick them",
  approval: "how they approve their custom ads",
  dna_status: "the Brand DNA status",
  dna_missing: "what the Brand DNA is missing",
  rules: "the always, never and never-show lines",
  camera: "on camera, and how",
  content_rating: "their existing content",
  shot_list: "the shot list",
  events: "events to script for",
  readback_yes: "their yes to the read-back",
  csm_signals: "the signals for the CSM",
  anything_else: "anything else",
  offer: "the offer's name, what they get and the free first step",
  scripts_status: "the custom scripts' status",
  scripts_date: "the custom scripts' date",
};

const OFFER_LINES = ["name", "what", "firstStep"] as const;
export type OfferLine = (typeof OFFER_LINES)[number];
export type Offer = Partial<Record<OfferLine, string>>;

/** The offer slip's three lines, as the client saw them on slide 13. */
export const OFFER_LABEL: Record<OfferLine, string> = {
  name: "Offer name",
  what: "What they get",
  firstStep: "Free first step",
};
export const OFFER_MAX: Record<OfferLine, number> = {
  name: 80,
  what: 200,
  firstStep: 160,
};

const blank = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** One offer line, trimmed and with its spaces folded, as the server keeps it. */
export const tidy = (s: unknown) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

export function offerOf(v: unknown): Offer {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out: Offer = {};
  for (const k of OFFER_LINES) {
    const t = tidy(o[k]);
    if (t) out[k] = t;
  }
  return out;
}

/** "Name: what they get. First step: …", one sentence, or null. */
export function offerLine(v: unknown): string | null {
  const o = offerOf(v);
  if (!o.name && !o.what && !o.firstStep) return null;
  const head = [o.name, o.what].filter(Boolean).join(": ");
  const tail = o.firstStep ? `First step: ${o.firstStep}` : "";
  return [head, tail]
    .filter(Boolean)
    .map(s => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(" ");
}

/**
 * A part's answers as they count for its press: its own keys, without the
 * ones its conditions switch off (cockpit_blueprint_part_answers).
 */
export function partAnswers(part: Part, answers: Answers): Answers {
  const a: Answers = {};
  for (const k of PART_KEYS[part]) if (!blank(answers[k])) a[k] = answers[k];
  if (part === 1) {
    if (a.starter !== "yes") {
      delete a.pack_url;
      delete a.pack_approval;
      delete a.pack_changes;
    }
    if (a.pack_approval !== "wants_changes") delete a.pack_changes;
    if (a.capacity !== "tight" && a.capacity !== "no") delete a.capacity_note;
  } else if (part === 2) {
    if ((a.dna_status ?? "complete") === "complete") delete a.dna_missing;
    if (a.shot_list !== true) delete a.shot_list_due;
  }
  return a;
}

/** The keys a part requires with these answers, in the form's order. */
export function required(part: Part, answers: Answers): string[] {
  const a = partAnswers(part, answers);
  if (part === 3) return ["offer"];
  if (part === 1) {
    const keys = ["service", "capacity"];
    if (a.capacity === "tight" || a.capacity === "no")
      keys.push("capacity_note");
    keys.push("starter");
    if (a.starter === "yes") {
      keys.push("pack_url", "pack_approval");
      if (a.pack_approval === "wants_changes") keys.push("pack_changes");
    }
    keys.push("daily_budget", "destination", "identity");
    return keys;
  }
  const keys = [
    "best_client",
    "method",
    "pricing",
    "minimum",
    "anchor",
    "competitors",
    "approval",
    "dna_status",
  ];
  if (a.dna_status === "small_gaps" || a.dna_status === "big_gaps")
    keys.push("dna_missing");
  keys.push("rules", "camera", "readback_yes");
  return keys;
}

/** What a part still lacks (cockpit_blueprint_missing). */
export function missing(part: Part, answers: Answers): string[] {
  const a = partAnswers(part, answers);
  if (part === 3) {
    const o = offerOf(a.offer);
    return o.name && o.what && o.firstStep ? [] : ["offer"];
  }
  return required(part, answers).filter(k => blank(a[k]));
}

export function missingSentence(keys: string[]): string {
  const names = keys.map(k => KEY_LABEL[k] ?? k);
  return `Still missing: ${names.join(", ")}.`;
}

/** The same JSON whatever the key order, so two reads compare as equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter(k => o[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// ---------------------------------------------------------------- the record

const text = z.string();
const stamp = z.object({
  status: text,
  firstAt: text,
  firstBy: text.nullable().optional(),
  lastAt: text,
  lastBy: text.nullable().optional(),
  presses: z.number(),
  lastRequestId: text.optional(),
  sent: z.record(text, z.unknown()).optional(),
});
const outbox = z.object({
  id: text,
  state: text,
  error: text.nullable().optional(),
  result: z.unknown().optional(),
  createdAt: text,
  settledAt: text.nullable().optional(),
});
const rowSchema = z.object({
  taskId: text,
  clientName: text,
  answers: z.record(text, z.unknown()),
  meta: z
    .record(
      text,
      z.object({
        by: text.nullable().optional(),
        at: text.nullable().optional(),
        from: text.nullable().optional(),
      }),
    )
    .optional(),
  parts: z.record(text, stamp),
  revision: z.number(),
  launchTaskId: text.nullable().optional(),
  createdAt: text.optional(),
  updatedAt: text.optional(),
  updatedBy: text.nullable().optional(),
  outbox: z.record(text, outbox.nullable()).nullable().optional(),
  can: z.object({ write: z.boolean() }).optional(),
});
export type BlueprintRow = z.infer<typeof rowSchema>;
export type PartStamp = z.infer<typeof stamp>;
export type OutboxRow = z.infer<typeof outbox>;

const readSchema = z.object({ rows: z.array(rowSchema), now: text });
const saveSchema = z.object({
  row: rowSchema.nullable(),
  applied: z.array(text),
  conflicts: z.array(
    z.object({
      key: text,
      theirs: z.unknown(),
      by: text.nullable().optional(),
      at: text.nullable().optional(),
    }),
  ),
});
export type SaveResult = z.infer<typeof saveSchema>;
export type Conflict = SaveResult["conflicts"][number];
const pressSchema = z.object({
  id: text,
  state: text,
  part: z.number(),
  firstAt: text.nullable().optional(),
  presses: z.number(),
  again: z.boolean().optional(),
  duplicate: z.boolean().optional(),
  lastAt: text.nullable().optional(),
});
export type PressResult = z.infer<typeof pressSchema>;

export const stampOf = (row: BlueprintRow | null, part: Part) =>
  row?.parts?.[String(part)] ?? null;
export const outboxOf = (row: BlueprintRow | null, part: Part) =>
  row?.outbox?.[String(part)] ?? null;

/** The launch task the last Send to media wrote to, from the record or its run. */
export function launchTaskOf(row: BlueprintRow | null): string | null {
  if (row?.launchTaskId) return row.launchTaskId;
  const r = outboxOf(row, 1)?.result as { launchTaskId?: unknown } | undefined;
  return typeof r?.launchTaskId === "string" &&
    /^[A-Za-z0-9]{4,20}$/.test(r.launchTaskId)
    ? r.launchTaskId
    : null;
}
export const clickupTask = (id: string) => `https://app.clickup.com/t/${id}`;

// ------------------------------------------------------------- part states

export type PartState =
  | { kind: "not_started" }
  | { kind: "in_progress"; done: number; of: number }
  | { kind: "ready" }
  | { kind: "sending" }
  | { kind: "sent"; at: string; presses: number }
  | { kind: "unconfirmed"; id: string; error: string | null }
  | { kind: "needs_look"; id: string; error: string }
  | { kind: "changed"; at: string; keys: string[] };

/** A pending row this young is a press that is still running somewhere. */
const RUNNING_GRACE_MS = 60_000;

/**
 * One state per part (SPEC 4.1): what the record says, with what this
 * window is doing on top. `answers` are the record's answers with any typed
 * but unsaved lines over them.
 */
export function partState(
  row: BlueprintRow | null,
  part: Part,
  answers: Answers,
  now: number,
  local: { running?: boolean; error?: string | null } = {},
): PartState {
  if (local.running) return { kind: "sending" };
  const s = stampOf(row, part);
  const o = outboxOf(row, part);
  if (o) {
    if (o.state === "reconcile" || o.state === "failed")
      return {
        kind: "needs_look",
        id: o.id,
        error: o.error?.trim() || "The run stopped part way.",
      };
    if (o.state === "sending") return { kind: "sending" };
    if (o.state === "pending") {
      const age = now - Date.parse(o.createdAt);
      if (!local.error && Number.isFinite(age) && age < RUNNING_GRACE_MS)
        return { kind: "sending" };
      return { kind: "unconfirmed", id: o.id, error: local.error ?? null };
    }
  }
  if (s) {
    const now_ = partAnswers(part, answers);
    const sent = s.sent ?? {};
    if (canonical(now_) !== canonical(sent)) {
      const keys = [...new Set([...Object.keys(now_), ...Object.keys(sent)])]
        .filter(k => canonical(now_[k]) !== canonical(sent[k]))
        .sort(
          (x, y) => PART_KEYS[part].indexOf(x) - PART_KEYS[part].indexOf(y),
        );
      return { kind: "changed", at: s.lastAt, keys };
    }
    return { kind: "sent", at: s.lastAt, presses: s.presses };
  }
  const lacks = missing(part, answers);
  if (lacks.length === 0) return { kind: "ready" };
  if (part === 3) {
    const o3 = offerOf(answers.offer);
    const done = OFFER_LINES.filter(k => o3[k]).length;
    return done > 0
      ? { kind: "in_progress", done, of: 3 }
      : { kind: "not_started" };
  }
  const own = Object.keys(partAnswers(part, answers)).length;
  if (own === 0) return { kind: "not_started" };
  const req = required(part, answers);
  return {
    kind: "in_progress",
    done: req.length - lacks.length,
    of: req.length,
  };
}

/** All three parts sent and nothing waiting: the card folds to one line. */
export function blueprintDone(
  row: BlueprintRow | null,
  answers: Answers,
  now: number,
): boolean {
  return PARTS.every(p => partState(row, p, answers, now).kind === "sent");
}

/** Part 3 has waited since the call closed; orange after 48 hours. */
export function offerWait(
  row: BlueprintRow | null,
  now: number,
): { since: string; hours: number; late: boolean } | null {
  const closed = stampOf(row, 2);
  if (!closed || stampOf(row, 3)) return null;
  const hours = (now - Date.parse(closed.firstAt)) / 3_600_000;
  if (!Number.isFinite(hours)) return null;
  return { since: closed.firstAt, hours, late: hours >= 48 };
}

// ------------------------------------------------------------------- times

const KUWAIT_MS = 3 * 3_600_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
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

function kuwait(iso: string | null | undefined) {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + KUWAIT_MS);
  return {
    day: d.toISOString().slice(0, 10),
    weekday: WEEKDAY[d.getUTCDay()],
    date: `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`,
    time: d.toISOString().slice(11, 16),
  };
}

/** "Wed 22 Oct 10:12", Kuwait's clock. */
export function whenLong(iso: string | null | undefined): string {
  const k = kuwait(iso);
  return k ? `${k.weekday} ${k.date} ${k.time}` : "";
}
/** "22 Oct". */
export function dayShort(iso: string | null | undefined): string {
  return kuwait(iso)?.date ?? "";
}
/** "10:44" on the same Kuwait day as `near`, else "Sat 24 Oct 10:44". */
export function whenNear(
  iso: string | null | undefined,
  near: string | null | undefined,
): string {
  const k = kuwait(iso);
  if (!k) return "";
  return near && kuwait(near)?.day === k.day
    ? k.time
    : `${k.weekday} ${k.date} ${k.time}`;
}
export function waited(hours: number): string {
  if (hours < 24) return "under a day";
  const d = Math.floor(hours / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

// ----------------------------------------------------------- the call window

type Opener = (url: string, name: string, features?: string) => Window | null;

/**
 * Opens a named window, or brings it forward as it is (the deck's openNamed,
 * copied: window.open(url, name) would reload a deck that is already open
 * and send a shared deck back to its cover mid-call).
 */
export function openNamed(
  url: string,
  name: string,
  features?: string,
  open: Opener = (u, n, f) => window.open(u, n, f),
): Window | null {
  const w = open("", name, features);
  if (!w) return null;
  let isBlank = true;
  try {
    isBlank = w.location.href === "about:blank";
  } catch {
    // another origin's page in that window: send it to the deck
  }
  if (isBlank) w.location.replace(url);
  w.focus();
  return w;
}

/**
 * The Blueprint's prep view in the client success app, at a part when
 * given. A rehearsal carries its flag, so every window it opens stays one
 * (each reads ?rehearse=1 from its own address).
 */
export function prepUrl(
  taskId: string,
  at?: "part1" | "part2" | "part3",
  rehearse = false,
) {
  return `${portalUrl()}/client-success/clients/${encodeURIComponent(taskId)}/present/blueprint?view=prep${rehearse ? "&rehearse=1" : ""}${at ? `#${at}` : ""}`;
}
export function openPrep(
  taskId: string,
  at?: "part1" | "part2" | "part3",
  open?: Opener,
  rehearse = false,
) {
  // Its own window name, so an open real prep is never reused for it.
  const w = openNamed(
    prepUrl(taskId, at, rehearse),
    `mahara-prep-${taskId}-blueprint${rehearse ? "-rehearse" : ""}`,
    undefined,
    open,
  );
  if (w && at) {
    try {
      if (w.location.hash !== `#${at}`) w.location.hash = at;
    } catch {
      // not ours to steer
    }
  }
  return w;
}

// ---------------------------------------------------------------- sessions

const SESSION_KEY = "mahara-bp-session";
const SESSION_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
let windowSession: string | null = null;

function freshSession(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => SESSION_CHARS[b % 64]).join("");
}

/**
 * One ID per browser profile, shared with the deck and notes windows (same
 * origin), so a save from this card and one from the call's windows are
 * told apart from another person's. A fresh one per window when storage
 * throws.
 */
export function blueprintSession(): string {
  try {
    const kept = localStorage.getItem(SESSION_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
    const made = freshSession();
    localStorage.setItem(SESSION_KEY, made);
    return made;
  } catch {
    windowSession ??= freshSession();
    return windowSession;
  }
}

// ------------------------------------------------------------------- calls

type Rpc = Pick<SupabaseClient, "rpc" | "functions" | "auth">;

type PgError = { message?: string; details?: string | null; code?: string };

/** A server refusal as a plain sentence. */
export function problem(error: unknown): string {
  const e = (error ?? {}) as PgError;
  const msg = String(e.message ?? error ?? "").trim();
  if (msg === "Still missing")
    return missingSentence(
      String(e.details ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean),
    );
  if (/JWT|not authenticated|Sign in/i.test(msg))
    return "Sign in again, then try once more.";
  if (/Failed to fetch|NetworkError|network/i.test(msg))
    return "No connection. Nothing was lost; try again when you are back online.";
  return msg || "The Blueprint did not answer. Try again.";
}

export class BlueprintError extends Error {
  missing: string[];
  constructor(message: string, missingKeys: string[] = []) {
    super(message);
    this.missing = missingKeys;
  }
}

function fail(error: unknown): never {
  const e = (error ?? {}) as PgError;
  const keys =
    e.message === "Still missing"
      ? String(e.details ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      : [];
  throw new BlueprintError(problem(error), keys);
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const out = schema.safeParse(data);
  if (!out.success)
    throw new BlueprintError(
      `The Blueprint's ${what} came back in a shape this page does not read. Reload the page.`,
    );
  return out.data;
}

export async function readBlueprints(
  client: Rpc,
  taskIds: string[],
): Promise<{ rows: BlueprintRow[]; now: string }> {
  const ids = [
    ...new Set(taskIds.filter(t => /^[A-Za-z0-9_-]{1,40}$/.test(t))),
  ];
  const rows: BlueprintRow[] = [];
  let now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.rpc("cockpit_blueprint_read", {
      p_task_ids: ids.slice(i, i + 200),
    });
    if (error) fail(error);
    const page = parse(readSchema, data, "record");
    rows.push(...page.rows);
    now = page.now;
  }
  return { rows, now };
}

export type Change = { value: unknown; seen: unknown; from?: string };

export async function saveBlueprint(
  client: Rpc,
  args: {
    taskId: string;
    changes: Record<string, Change>;
    session: string;
    baseRevision: number | null;
  },
): Promise<SaveResult> {
  const { data, error } = await client.rpc("cockpit_blueprint_save", {
    p_task_id: args.taskId,
    p_changes: args.changes,
    p_session: args.session,
    p_base_revision: args.baseRevision,
  });
  if (error) fail(error);
  return parse(saveSchema, data, "save");
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(bytes))
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Where a press keeps its request ID until its run is done (SPEC 3.1). */
export async function pressKey(
  client: Rpc,
  taskId: string,
  part: Part,
  answers: Answers,
): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new BlueprintError("Sign in again, then press once more.");
  const hash = await digest({
    taskId,
    part,
    answers: partAnswers(part, answers),
  });
  return `cockpit-bp-press:${data.user.id}:${hash}`;
}

/**
 * The press: one request ID per (card, part, answers), kept until its run
 * is done, so a retry after a dropped connection is the same press.
 */
export async function blueprintPartDone(
  client: Rpc,
  args: { taskId: string; part: Part; answers: Answers },
): Promise<PressResult & { key: string }> {
  const key = await pressKey(client, args.taskId, args.part, args.answers);
  const kept = storage()?.getItem(key);
  const requestId =
    kept && /^[0-9a-f-]{36}$/i.test(kept) ? kept : crypto.randomUUID();
  try {
    storage()?.setItem(key, requestId);
  } catch {
    // a press still runs without the retry memory
  }
  const { data, error } = await client.rpc("cockpit_blueprint_part_done", {
    p_task_id: args.taskId,
    p_part: args.part,
    p_request_id: requestId,
  });
  if (error) fail(error);
  return { ...parse(pressSchema, data, "press"), key };
}

export function forgetPress(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing to forget
  }
}

export type RunResult =
  | { ok: true; result: unknown; note: string | null }
  | { ok: false; error: string };

/** Runs a queued press through cockpit-creative-api, as the outbox runs any. */
export async function runBlueprintPart(
  client: Rpc,
  id: string,
): Promise<RunResult> {
  const out = await client.functions.invoke("cockpit-creative-api", {
    body: { operation: "clientAction", args: { id }, apply: true },
  });
  if (out.error) {
    let detail: { error?: string } | undefined;
    try {
      detail = await (out.error as { context?: Response }).context?.json();
    } catch {}
    return {
      ok: false,
      error: problem({ message: detail?.error ?? out.error.message }),
    };
  }
  const data = out.data as {
    state?: string;
    result?: unknown;
    note?: string;
    error?: string;
  } | null;
  if (data?.state !== "done")
    return {
      ok: false,
      error:
        data?.error ??
        "The press was saved but its run was not confirmed. Run it again.",
    };
  return { ok: true, result: data.result, note: data.note ?? null };
}

/** Rehearsal (admins and the CEO): the plan from ClickUp reads only. */
export async function rehearseBlueprintPart(
  client: Rpc,
  args: { taskId: string; part: Part; answers: Answers },
): Promise<{ missing: string[]; lines: string[] }> {
  const out = await client.functions.invoke("cockpit-creative-api", {
    body: { operation: "blueprintRehearse", args },
  });
  if (out.error) {
    let detail: { error?: string } | undefined;
    try {
      detail = await (out.error as { context?: Response }).context?.json();
    } catch {}
    throw new BlueprintError(
      problem({ message: detail?.error ?? out.error.message }),
    );
  }
  const data = (out.data ?? {}) as { missing?: unknown; lines?: unknown };
  return {
    missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
    lines: Array.isArray(data.lines) ? data.lines.map(String) : [],
  };
}

// ---------------------------------------------------------------- settings

/** The five main services, in the kickoff's order and words. */
export const SERVICES = [
  { key: "design-build", label: "Design and build" },
  { key: "interior", label: "Interior design" },
  { key: "architecture", label: "Architectural design" },
  { key: "fitout", label: "Fit out and renovation" },
  { key: "construction", label: "Construction only" },
] as const;
export type ServiceKey = (typeof SERVICES)[number]["key"];

export const CLOSE_ROUTES = [
  {
    key: "card_only",
    label: "Card only",
    line: "The cockpit writes the card and its comments. The CSM pastes the phase 5 WhatsApp from the card comment.",
  },
  {
    key: "slack",
    label: "Card and Slack",
    line: "As card only, and the cockpit posts the close to #media-general. Needs the Slack bot in #media-general first.",
  },
  {
    key: "make",
    label: "Make",
    line: "Make 14 posts to Slack, writes Can Self-Record? and the Onboarding Map, and sends the phase 5 WhatsApp. Needs Make 14's route and the server switch; until both exist the close falls back to card only.",
  },
] as const;
export type CloseRoute = (typeof CLOSE_ROUTES)[number]["key"];

export const DRIVE_FOLDER =
  /^https:\/\/drive\.google\.com\/drive\/(u\/[0-9]\/)?folders\/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$/;

/** Drive's own folder view, for the Preview frame (the deck uses the same). */
export function folderView(url: string): string | null {
  const id = url.match(/\/folders\/([A-Za-z0-9_-]{10,100})/)?.[1];
  return id
    ? `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}#grid`
    : null;
}

const settingsSchema = z.object({
  packs: z.record(text, text.nullable()).nullable(),
  assignee: z
    .object({ id: text, label: text.nullable().optional() })
    .nullable(),
  closeRoute: text,
  changes: z
    .record(text, z.object({ at: text, by: text.nullable().optional() }))
    .nullable()
    .optional(),
  can: z.object({ packs: z.boolean(), closeRoute: z.boolean() }),
});
export type BlueprintSettings = z.infer<typeof settingsSchema>;

export async function readBlueprintSettings(
  client: Rpc,
): Promise<BlueprintSettings> {
  const { data, error } = await client.rpc("cockpit_blueprint_settings_read");
  if (error) fail(error);
  return parse(settingsSchema, data, "settings");
}

export async function setBlueprintSetting(
  client: Rpc,
  key: `pack.${ServiceKey}` | "launch_assignee" | "close_route",
  value: string | null,
  label: string | null = null,
): Promise<BlueprintSettings> {
  const { data, error } = await client.rpc("cockpit_blueprint_settings_set", {
    p_key: key,
    p_value: value,
    p_label: label,
  });
  if (error) fail(error);
  return parse(settingsSchema, data, "settings");
}

export async function blueprintMembers(
  client: Rpc,
): Promise<{ id: string; name: string }[]> {
  const out = await client.functions.invoke("cockpit-creative-api", {
    body: { operation: "blueprintMembers", args: {} },
  });
  if (out.error) {
    let detail: { error?: string } | undefined;
    try {
      detail = await (out.error as { context?: Response }).context?.json();
    } catch {}
    throw new BlueprintError(
      problem({ message: detail?.error ?? out.error.message }),
    );
  }
  const members = (out.data as { members?: unknown } | null)?.members;
  return parse(
    z.array(z.object({ id: text, name: text })),
    members,
    "member list",
  );
}

// ------------------------------------------------------------ the saver

export type SaverIO = {
  save: (
    changes: Record<string, Change>,
    baseRevision: number | null,
  ) => Promise<SaveResult>;
};

/**
 * The card's autosave (SPEC 2.4): 600 ms after the last key, one save in
 * flight, what arrives meanwhile goes in the next. `seen` per key is the
 * value this card last showed for that key, as the server confirmed it;
 * saves carry no base revision, so the server checks every key against it
 * and never lets a stale line overwrite another seat's.
 */
export type SaverEvents = {
  saved: (r: SaveResult) => void;
  failed: (message: string) => void;
  busy?: (busy: boolean) => void;
};

export class FieldSaver {
  private confirmed: Answers;
  /** Per key, the value this card last showed as the server's. */
  private seen: Answers;
  private pending: Answers = {};
  private revision: number | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private io: SaverIO;
  private on: SaverEvents;
  private delay: number;

  constructor(
    io: SaverIO,
    row: BlueprintRow | null,
    on: SaverEvents,
    delay = 600,
  ) {
    this.io = io;
    this.on = on;
    this.delay = delay;
    this.confirmed = { ...(row?.answers ?? {}) };
    this.seen = { ...this.confirmed };
    this.revision = row?.revision ?? null;
  }

  /**
   * A newer read of the record (another window saved): adopt it. The card
   * shows it only when nothing is being typed, so only then is it seen.
   */
  adopt(row: BlueprintRow | null) {
    this.confirmed = { ...(row?.answers ?? {}) };
    this.revision = row?.revision ?? null;
    if (!this.dirty) this.seen = { ...this.confirmed };
  }

  /** The revision this card last read or saved (for display and tests). */
  get readRevision(): number | null {
    return this.revision;
  }

  get dirty() {
    return Object.keys(this.pending).length > 0 || this.flight !== null;
  }

  /** The answers as the server last confirmed them to this window. */
  get answers(): Answers {
    return { ...this.confirmed };
  }

  set(key: string, value: unknown, now = false) {
    this.pending[key] = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), now ? 0 : this.delay);
  }

  /** Saves again with `seen` set to the stored value: "Use mine". */
  insist(key: string, value: unknown, theirs: unknown) {
    this.seen[key] = theirs;
    this.set(key, value, true);
  }

  /** "Keep theirs": the card now shows the stored value, so it is seen. */
  accept(key: string, theirs: unknown) {
    this.seen[key] = theirs;
    delete this.pending[key];
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.flight) await this.flight;
    const keys = Object.keys(this.pending);
    if (keys.length === 0) return;
    const sending = this.pending;
    this.pending = {};
    const changes: Record<string, Change> = {};
    for (const k of keys)
      changes[k] = {
        value: sending[k] ?? null,
        seen: this.seen[k] ?? null,
      };
    this.on.busy?.(true);
    this.flight = (async () => {
      try {
        const r = await this.io.save(changes, null);
        if (r.row) {
          this.confirmed = { ...r.row.answers };
          this.revision = r.row.revision;
        }
        for (const k of r.applied)
          this.seen[k] = r.row
            ? (r.row.answers[k] ?? null)
            : (changes[k]?.value ?? null);
        for (const c of r.conflicts) this.seen[c.key] = c.theirs;
        this.on.saved(r);
      } catch (e) {
        // Keep what was typed: it goes again with the next save.
        for (const k of keys)
          if (!(k in this.pending)) this.pending[k] = sending[k];
        this.on.failed(e instanceof Error ? e.message : problem(e));
      } finally {
        this.flight = null;
        this.on.busy?.(false);
      }
    })();
    await this.flight;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }
}
