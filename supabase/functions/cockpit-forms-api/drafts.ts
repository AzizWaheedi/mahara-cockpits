/**
 * The drafts of a 1-1 call (docs/forms/STAGE2-CONTRACT.md 6.5): We owe / They owe
 * from Fathom's action items (todos.ts, no model), the client notes on
 * deepseek-flash, the DEFCON and priority suggestions, the grade and the recap on
 * claude-opus-5-5. Drafts belong to the recording and the client, not to the
 * response: cockpit_form_draft_begin returns a draft already made from the same
 * input, keeps one grade per call, and counts the five attempts; a changed input
 * starts the next attempt.
 *
 * checkin.drafts answers at once: what cannot be drafted is answered with its
 * sentence and never stored (no recording, a recording that cannot be this
 * client's call, the recap before the send, a summary or a transcript the
 * drafts cannot read yet), a missing key is one `off` row, the We owe / They
 * owe list is made inline, and the model drafts run in the background. The
 * response is read through the seat's own token, so its gate is the
 * response's gate.
 */
import { actionItems as fathomActionItems } from "../../../hermes/csm-calls/fathomRules.ts";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { type ModelEnv, ModelError, type ModelOptions, structuredJsonDetailed } from "../cockpit-media-api/model.ts";
import { DoorError, type OpCtx } from "./door.ts";
import {
  clientNameOf,
  type DraftInputs,
  isTieRefusal,
  matchCtx,
  NOT_IN_COCKPIT,
  onOtherClient,
  readSummary,
  readTranscript,
  recordingFor,
  savedCallRefusal,
  seesClient,
  tieSentence,
  toBooking,
  toRecording,
} from "./fathom.ts";
import * as clientNotes from "./prompts/clientNotes.ts";
import * as defconPriority from "./prompts/defconPriority.ts";
import * as grade from "./prompts/grade.ts";
import * as recap from "./prompts/recap.ts";
import { todoItems } from "./todos.ts";
import { cut, labelLines, type Line, parseTranscript, sideOfNameFrom } from "./transcript.ts";

export const KINDS = ["todos", "client_notes", "defcon_priority", "grade", "recap"] as const;
export type Kind = (typeof KINDS)[number];
export const TODOS_VERSION = "checkin.todos.v1";
export const ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEEPSEEK_MODEL = "deepseek-flash";
const PROVIDER: Record<Kind, "none" | "deepseek" | "anthropic"> = {
  todos: "none",
  client_notes: "deepseek",
  defcon_priority: "anthropic",
  grade: "anthropic",
  recap: "anthropic",
};
const VERSION: Record<Kind, string> = {
  todos: TODOS_VERSION,
  client_notes: clientNotes.VERSION,
  defcon_priority: defconPriority.VERSION,
  grade: grade.VERSION,
  recap: recap.VERSION,
};
const TIMEOUT_MS = 120_000;
const OPTIONS: Record<Exclude<Kind, "todos">, ModelOptions> = {
  client_notes: { maxTokens: 4000, timeoutMs: TIMEOUT_MS },
  defcon_priority: { effort: "low", fallbacks: "default", timeoutMs: TIMEOUT_MS },
  grade: { effort: "medium", fallbacks: "default", timeoutMs: TIMEOUT_MS },
  recap: { effort: "medium", fallbacks: "default", timeoutMs: TIMEOUT_MS },
};
/** The kinds that need the summary (6.5); todos never waits. */
const NEEDS_SUMMARY = new Set<Kind>(["client_notes", "defcon_priority", "grade", "recap"]);
/**
 * The kinds that read the transcript's lines (they cite or grade them), so they
 * wait for it as for the summary: a grade is made once per call and kept, so
 * one made from no transcript could never be put right. todos never waits.
 */
const NEEDS_TRANSCRIPT = new Set<Kind>(["client_notes", "defcon_priority", "grade", "recap"]);
/** The kinds the notes' fields take; once the notes are sent only the grade and the recap are still drafted. */
const FIELDS = new Set<Kind>(["todos", "client_notes", "defcon_priority"]);
const SIDE_MAX = 30;

export const NO_RECORDING = "No recording, so there is nothing to draft from.";
export const RECAP_AFTER_SEND = "The recap is drafted after you send the notes.";
export const SUMMARY_WAIT = "Fathom is still writing this call's summary. Drafts start when it is ready.";
/** As SUMMARY_WAIT, so the window keeps asking (it polls while a reason says "still writing"). */
export const TRANSCRIPT_WAIT = "Fathom is still writing this call's transcript. Drafts start when it is ready.";
export const NOT_CLIENT_CALL = "That recording is not a client call.";
export const OFF = {
  anthropic: "AI drafts are off: no Anthropic key. Fill this by hand.",
  deepseek: "AI drafts are off: no DeepSeek key. Fill this by hand.",
} as const;
export const FAILED = {
  refused: "The model declined this call. Fill this by hand.",
  cut: "The draft was cut off. Draft again.",
  timeout: "The draft took too long. Draft again.",
  other: "The draft could not be made just now. Draft again.",
} as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DraftView = {
  kind: Kind;
  state: "drafting" | "ready" | "off" | "failed" | "skipped";
  attempt: number;
  provider: "none" | "deepseek" | "anthropic";
  model: string | null;
  promptVersion: string;
  at: string;
  reason: string | null;
  output: Record<string, unknown> | null;
};
export type DraftsAnswer = { recordingId: string | null; drafts: DraftView[]; started: Kind[]; now: string };

/** An answer that is not stored (6.5: no recording, the recap before the send, the summary not written yet). */
const answered = (kind: Kind, state: "skipped" | "off", reason: string, at: string): DraftView => ({
  kind,
  state,
  attempt: 0,
  provider: PROVIDER[kind],
  model: null,
  promptVersion: VERSION[kind],
  at,
  reason,
  output: null,
});

// ---------------------------------------------------------------- the summary and the input bundle

export type Bullet = { text: string; at: number | null };
export type Sections = { purpose: Bullet[]; takeaways: Bullet[]; topics: Bullet[]; nextSteps: Bullet[] };
const HEADINGS: Record<string, keyof Sections> = {
  "meeting purpose": "purpose",
  "الغرض من الاجتماع": "purpose",
  "key takeaways": "takeaways",
  "أبرز النقاط": "takeaways",
  topics: "topics",
  "المواضيع": "topics",
  "next steps": "nextSteps",
  "الخطوات التالية": "nextSteps",
};
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const FATHOM_LINK = /https?:\/\/(?:www\.)?fathom\.video\/[^\s)\]]+/i;
const STAMP = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/;

/** One summary line as plain text, with the call time its Fathom link points at. */
export function bullet(raw: string): Bullet {
  const link = FATHOM_LINK.exec(raw)?.[0] ?? null;
  let at: number | null = null;
  if (link) {
    const t = /[?&]timestamp=(\d+(?:\.\d+)?)/.exec(link);
    at = t ? Math.floor(Number(t[1])) : null;
  }
  const text = raw
    .replace(LINK, (_, label: string) => (STAMP.test(label) ? "" : label))
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/(\S)[*_](\s|$)/g, "$1$2")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:–—-]+$/, "")
    .trim();
  return { text: cut(text, 300), at };
}

/**
 * Fathom's summary by its four headings (English or Arabic); a paragraph counts
 * as one line of its section. A sub-heading (### or deeper) that is not one of
 * the four stays in its section: Fathom writes Topics as `## Topics` and then
 * `### {topic}` with the bullets under each, so the topic's name is one of its
 * lines (clientBrief.ts reads it the same way).
 */
export function summarySections(markdown: string | null): Sections {
  const out: Sections = { purpose: [], takeaways: [], topics: [], nextSteps: [] };
  let section: keyof Sections | null = null;
  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    const heading = /^\s*(#{1,6})\s*(.+?)\s*#*\s*$/.exec(raw);
    if (heading) {
      const known = HEADINGS[heading[2].replace(/\*\*/g, "").trim().toLowerCase()];
      if (known) section = known;
      else if (heading[1].length >= 3 && section) {
        if (section === "topics") {
          const b = bullet(heading[2]);
          if (b.text) out.topics.push(b);
        }
      } else section = null;
      continue;
    }
    if (!section) continue;
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(raw)?.[1] ?? raw;
    const b = bullet(item);
    if (b.text) out[section].push(b);
  }
  return out;
}

/** The call's Fathom page without query, fragment or trailing slash; null for any other link. */
export function sharePage(url: string | null | undefined): string | null {
  const m = /^https:\/\/fathom\.video(\/[^?#\s]*)/i.exec(String(url ?? "").trim());
  const path = m ? m[1].replace(/\/+$/, "") : "";
  return path ? `https://fathom.video${path}` : null;
}

type Bundle = {
  recordingId: string;
  taskId: string;
  summary: string | null;
  transcript: string | null;
  lines: Line[];
  actionItems: unknown[] | null;
  share: string | null;
  staff: DraftInputs["staff"];
  client: { name: string; stage: string | null; happiness: string | null };
  lastForm: DraftInputs["lastForm"];
  sections: Sections;
  theyOwe: string[];
};

/** Keys sorted at every level, so the same input always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

export async function sha256(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The input hash (6.5): the kind, its prompt version, the call, the summary, the
 * transcript, the action items and `extra` (the sent They owe and the business
 * name for the recap). The client notes and the suggestions also read the card
 * (stage, Client Happiness) and the last 1-1 notes, so those ride in `context`:
 * a changed Client Happiness is a changed input (2.1 begin rule 2).
 */
export function inputOf(kind: Kind, b: Bundle): Record<string, unknown> {
  return {
    kind,
    promptVersion: VERSION[kind],
    recordingId: b.recordingId,
    taskId: b.taskId,
    summary: b.summary,
    transcript: b.transcript,
    actionItems: b.actionItems,
    extra: kind === "recap" ? { theyOwe: b.theyOwe, client: b.client.name } : {},
    ...(kind === "client_notes" || kind === "defcon_priority"
      ? { context: { stage: b.client.stage, happiness: b.client.happiness, lastForm: b.lastForm } }
      : {}),
  };
}

/** We owe / They owe (todos.ts) and Fathom's Next Steps, each side at most the field's 30 lines. */
export function todosOutput(b: Bundle): Record<string, unknown> {
  const items = todoItems(fathomActionItems({ action_items: b.actionItems ?? [] }), {
    shareUrl: b.share,
    staff: b.staff,
    sideOfName: b.lines.length ? sideOfNameFrom(b.lines) : undefined,
  });
  const we = items.filter(i => i.side === "we").slice(0, SIDE_MAX);
  const they = items.filter(i => i.side === "they").slice(0, SIDE_MAX);
  const nextSteps = b.sections.nextSteps.slice(0, SIDE_MAX).map(s => ({
    text: s.text,
    at: s.at,
    href: b.share && s.at !== null ? `${b.share}?tab=summary&timestamp=${s.at}` : null,
  }));
  return { items: [...we, ...they], nextSteps };
}

// ---------------------------------------------------------------- the model drafts

type Made = { state: "ready" | "failed" | "skipped"; output: Record<string, unknown> | null; text?: string | null; reason?: string | null };

function promptOf(kind: Exclude<Kind, "todos">, b: Bundle): { prompt: string; schema: unknown } {
  const texts = (xs: Bullet[]) => xs.map(x => x.text);
  if (kind === "client_notes")
    return {
      prompt: clientNotes.prompt({ client: b.client.name, stage: b.client.stage, lastNotes: b.lastForm?.notes ?? null, takeaways: texts(b.sections.takeaways), topics: texts(b.sections.topics), lines: b.lines }),
      schema: clientNotes.SCHEMA,
    };
  if (kind === "defcon_priority")
    return {
      prompt: defconPriority.prompt({
        client: b.client.name,
        stage: b.client.stage,
        happiness: b.client.happiness,
        lastForm: b.lastForm,
        takeaways: texts(b.sections.takeaways),
        nextSteps: texts(b.sections.nextSteps),
        lines: b.lines,
      }),
      schema: defconPriority.SCHEMA,
    };
  if (kind === "grade") return { prompt: grade.prompt({ lines: b.lines }), schema: grade.SCHEMA };
  return {
    prompt: recap.prompt({ client: b.client.name, theyOwe: b.theyOwe, purpose: texts(b.sections.purpose), takeaways: texts(b.sections.takeaways), topics: texts(b.sections.topics), lines: b.lines }),
    schema: recap.SCHEMA,
  };
}

function checked(kind: Exclude<Kind, "todos">, data: unknown, b: Bundle): Made {
  if (kind === "client_notes") {
    const c = clientNotes.check(data, { lines: b.lines });
    return c.ok ? { state: "ready", output: c.output, text: c.output.text } : { state: "failed", output: null, reason: c.reason };
  }
  if (kind === "defcon_priority") {
    const c = defconPriority.check(data, { lines: b.lines, share: b.share, stage: b.client.stage, happiness: b.client.happiness });
    return { state: "ready", output: c.output, reason: c.reason };
  }
  if (kind === "grade") {
    const c = grade.check(data);
    return c.ok ? { state: "ready", output: c.output } : { state: "failed", output: null, reason: c.reason };
  }
  const c = recap.check(data);
  return { state: c.state, output: c.output, text: c.text, reason: c.reason };
}

function envFor(provider: "deepseek" | "anthropic", key: string): ModelEnv {
  const vars: Record<string, string> =
    provider === "deepseek"
      ? { AI_JSON_PROVIDERS: "deepseek", DEEPSEEK_API_KEY: key, DEEPSEEK_MODEL }
      : { AI_JSON_PROVIDERS: "anthropic", ANTHROPIC_API_KEY: key, ANTHROPIC_MODEL };
  return name => vars[name];
}

const failure = (e: unknown) =>
  e instanceof ModelError && (e.kind === "refused" || e.kind === "cut" || e.kind === "timeout") ? FAILED[e.kind] : FAILED.other;

/** One model attempt: the request with this draft's receipts, the checks, the finish. Never throws. */
async function runModel(op: OpCtx, kind: Exclude<Kind, "todos">, id: string, b: Bundle, key: string): Promise<void> {
  const provider = PROVIDER[kind] as "deepseek" | "anthropic";
  const finish = (p: Record<string, unknown>) =>
    op.deps.rpc("cockpit_form_draft_finish", { p_id: id, p: { ...p, reason: p.reason ? String(p.reason).slice(0, 240) : null, actorEmail: op.actor.email } });
  try {
    const { prompt, schema } = promptOf(kind, b);
    const health = (row: Record<string, unknown>) => op.deps.health({ ...row, run_key: `draft:${id}`, action_id: null });
    const answer = await structuredJsonDetailed(prompt, schema, envFor(provider, key), health, OPTIONS[kind], op.deps.fetch);
    const made = checked(kind, answer.data, b);
    await finish({ state: made.state, output: made.output, text: made.text ?? null, model: answer.model || null, usage: answer.usage ?? null, reason: made.reason ?? null });
  } catch (e) {
    await finish({ state: "failed", reason: failure(e) }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- checkin.drafts and checkin.draftAgain

async function readDrafts(op: OpCtx, responseId: string): Promise<{ recordingId: string | null; drafts: DraftView[] }> {
  const r = (await op.userRpc("cockpit_form_drafts_read", { p_response_id: responseId })) as { recordingId?: string | null; drafts?: DraftView[] } | null;
  return { recordingId: r?.recordingId ?? null, drafts: Array.isArray(r?.drafts) ? r.drafts : [] };
}

async function keyOf(op: OpCtx, provider: "fathom" | "deepseek" | "anthropic"): Promise<string | null> {
  const row = (await op.deps.rpc("cockpit_forms_key_get", { p_provider: provider })) as { secret?: string } | null;
  return row?.secret ? String(row.secret) : null;
}

/**
 * checkin.drafts (again = null) and checkin.draftAgain (again = the kind). The
 * grade is never drafted again; the recap only for sent notes.
 */
export async function checkinDrafts(op: OpCtx, body: Record<string, unknown>, again: Kind | null): Promise<DraftsAnswer> {
  const responseId = String(body.responseId ?? "");
  if (!UUID.test(responseId)) throw new DoorError("Open the notes from the client page.", 400);
  if (again === "grade") throw new DoorError("A call is graded once.", 400);
  const read = (await op.userRpc("cockpit_form_responses_read", { p_response_id: responseId })) as { response?: Record<string, any> } | null;
  const response = read?.response ?? {};
  const sent = response.state === "submitted" || response.state === "confirmed";
  if (again === "recap" && !sent) throw new DoorError(RECAP_AFTER_SEND, 400);
  const nowIso = op.deps.now().toISOString();
  const call = response.answers?.call;
  const recordingId = call?.kind === "fathom" && /^\d{3,20}$/.test(String(call.recordingId ?? "")) ? String(call.recordingId) : null;
  if (!recordingId) return { recordingId: null, drafts: KINDS.map(k => answered(k, "skipped", NO_RECORDING, nowIso)), started: [], now: nowIso };
  const taskId = String(response.taskId ?? "");
  const d = (await op.deps.rpc("cockpit_form_draft_inputs", { p_task_id: taskId, p_recording_id: recordingId })) as DraftInputs;
  const skipAll = (reason: string): DraftsAnswer => ({ recordingId, drafts: KINDS.map(k => answered(k, "skipped", reason, nowIso)), started: [], now: nowIso });
  if ((d.class !== "client" && d.class !== "candidate") || d.gone) return skipAll(NOT_CLIENT_CALL);
  // Before any content is read, the recording must still be one this client's notes can use: on no
  // other client, and, when it was made outside Customer Success (a prospect's sales call reads client
  // until the sales desk indexes it), tied to this client for the seat whose response saved it (the
  // database's tie rule, A7.14: rule 4 reads the response's own seat, never the one asking).
  const found = await recordingFor(op, taskId, recordingId, d.startsAt);
  if (!found.item) return skipAll(NOT_IN_COCKPIT);
  const refusal = await savedCallRefusal(
    op,
    toRecording(found.item),
    taskId,
    found.inputs.bookings.map(toBooking),
    matchCtx(found.inputs, op.deps.now().getTime()),
    responseId,
  );
  if (refusal?.reason === "other") {
    const other = refusal.otherTask as string;
    return skipAll(onOtherClient((await seesClient(op, other)) ? clientNameOf(found.inputs, other) : null));
  }
  // The tie rule's sentence: OUTSIDE_CS_LIKELY when its call row is on this client by a likely sign (A7.18).
  if (refusal) return skipAll(isTieRefusal(refusal) ? tieSentence(refusal) : NOT_CLIENT_CALL);

  const kinds = KINDS.filter(k => (sent ? !FIELDS.has(k) : true));
  const keys: Record<"deepseek" | "anthropic", string | null> = {
    deepseek: kinds.includes("client_notes") ? await keyOf(op, "deepseek") : null,
    anthropic: kinds.some(k => PROVIDER[k] === "anthropic") ? await keyOf(op, "anthropic") : null,
  };
  const hasKey = (k: Kind) => PROVIDER[k] === "none" || !!keys[PROVIDER[k] as "deepseek" | "anthropic"];
  const fathomKey = await keyOf(op, "fathom");
  // The reads before any draft exists (the hash needs them) are receipted under the response.
  const draftRun = `drafts:${responseId}`;
  let summary = d.summary;
  if (!summary && fathomKey && kinds.some(k => NEEDS_SUMMARY.has(k) && hasKey(k) && (k !== "recap" || sent))) {
    const fresh = await readSummary(op, fathomKey, d, draftRun);
    // Unshared since the store saw it: no longer a client call, so nothing is drafted from it.
    if (fresh.internal) return skipAll(NOT_CLIENT_CALL);
    summary = fresh.text;
  }
  const live = (k: Kind) => (k !== "recap" || sent) && (!NEEDS_SUMMARY.has(k) || !!summary) && hasKey(k);
  let transcript: string | null = null;
  if (kinds.some(live)) {
    if (d.transcriptPath) transcript = await op.deps.storage.read(d.transcriptPath);
    if (!transcript && fathomKey) transcript = await readTranscript(op, fathomKey, recordingId, draftRun);
  }
  const lines = labelLines(parseTranscript(transcript), { recorderEmail: d.recorderEmail, recorderName: d.recorderName, staff: d.staff ?? [] });
  const bundle: Bundle = {
    recordingId,
    taskId,
    summary: summary ?? null,
    transcript,
    lines,
    actionItems: Array.isArray(d.actionItems) ? d.actionItems : null,
    share: sharePage(d.shareUrl),
    staff: d.staff ?? [],
    client: { name: d.client?.name ?? String(response.clientName ?? ""), stage: d.client?.stage ?? null, happiness: d.client?.happiness ?? null },
    lastForm: d.lastForm ?? null,
    sections: summarySections(summary ?? null),
    theyOwe: (Array.isArray(response.answers?.they_owe) ? response.answers.they_owe : [])
      .map((t: { text?: unknown }) => String(t?.text ?? "").trim())
      .filter(Boolean),
  };

  // One `off` row records a missing key; the newest attempt says whether it is there already.
  const before = new Map(kinds.some(k => !hasKey(k)) ? (await readDrafts(op, responseId)).drafts.map(v => [v.kind, v] as const) : []);
  const said = new Map<Kind, DraftView>();
  const started: Kind[] = [];
  const background: Promise<void>[] = [];
  for (const kind of kinds) {
    if (kind === "recap" && !sent) {
      said.set(kind, answered(kind, "skipped", RECAP_AFTER_SEND, nowIso));
      continue;
    }
    if (NEEDS_SUMMARY.has(kind) && !summary) {
      said.set(kind, answered(kind, "skipped", SUMMARY_WAIT, nowIso));
      continue;
    }
    // No transcript line could be read (none stored yet, and Fathom refused or has none): wait, never draft from nothing.
    if (NEEDS_TRANSCRIPT.has(kind) && hasKey(kind) && !lines.length) {
      said.set(kind, answered(kind, "skipped", TRANSCRIPT_WAIT, nowIso));
      continue;
    }
    const provider = PROVIDER[kind];
    if (!hasKey(kind) && before.get(kind)?.state === "off") continue;
    let begun: { id: string; existing: boolean; state: string; attempt: number };
    try {
      begun = (await op.deps.rpc("cockpit_form_draft_begin", {
        p: {
          formKey: "checkin",
          taskId,
          recordingId,
          ...(kind === "recap" ? { responseId } : {}),
          kind,
          provider,
          promptVersion: VERSION[kind],
          inputSha256: await sha256(canonical(inputOf(kind, bundle))),
          again: again === kind,
          actorEmail: op.actor.email,
        },
      })) as typeof begun;
    } catch (e) {
      // A refusal of begin (five attempts, the recap rule) answers Draft again in its own sentence;
      // on an open it is that kind's answer, shown when no draft of it stands.
      if (e instanceof RpcError && e.code === "22023" && again !== kind) {
        said.set(kind, answered(kind, "skipped", e.message, nowIso));
        continue;
      }
      throw e;
    }
    if (begun.existing || begun.state !== "drafting") continue;
    if (!hasKey(kind)) {
      await op.deps.rpc("cockpit_form_draft_finish", { p_id: begun.id, p: { state: "off", reason: OFF[provider as "deepseek" | "anthropic"], actorEmail: op.actor.email } });
      continue;
    }
    started.push(kind);
    if (kind === "todos")
      await op.deps.rpc("cockpit_form_draft_finish", { p_id: begun.id, p: { state: "ready", output: todosOutput(bundle), actorEmail: op.actor.email } });
    else background.push(runModel(op, kind, begun.id, bundle, keys[provider as "deepseek" | "anthropic"] as string));
  }
  if (background.length) op.deps.waitUntil(Promise.allSettled(background));

  const after = await readDrafts(op, responseId);
  const stored = new Map(after.drafts.map(v => [v.kind, v] as const));
  const drafts = KINDS.flatMap(k => {
    const s = stored.get(k);
    const a = said.get(k);
    if (a && !(s && (s.state === "ready" || s.state === "drafting"))) return [a];
    return s ? [s] : [];
  });
  return { recordingId, drafts, started, now: nowIso };
}
