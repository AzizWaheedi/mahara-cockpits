/**
 * What the CEO cockpit's Hiring tab can do, through hiring-api.
 *
 * Ported from apps/media-buyer-cockpit/convex/hiring/actions.ts. The door
 * (doors.ts) has already checked that the caller is the CEO. Every action
 * here writes its cockpit_audit_log row before it changes anything, so a
 * missing audit stops the action instead of hiding it.
 *
 * GoHighLevel writes (grade, reassign) are dry runs unless HIRING_APPLY is
 * exactly "true": the plan is returned and nothing is written anywhere.
 * A draft is sent only by sendDraft, only with HIRING_SEND_ENABLED "true",
 * and every attempt, refused or not, leaves a cockpit_hiring_sends row.
 */

import { JOB_LABEL, runJob, type Ctx } from "./context.ts";
import { parseDraft } from "./engine.ts";
import { loadMeta, requireGhl } from "./meta.ts";
import { totalScore } from "./mirror.ts";
import { GateError } from "./providers.ts";
import { mergeSettings, SETTINGS_KEY, SettingsError, settingsPatch } from "./settings.ts";
import { roleByKey, STAGE_KEYS, type StageKey, stageName } from "./spec.ts";
import type { Row } from "./store.ts";

export class ActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type DryRun = { dryRun: true; message: string; plan: Row };

const SCORES: Record<string, { field: string; col: string; label: string }> = {
  application: { field: "scoreApplication", col: "score_application", label: "Application" },
  loom: { field: "scoreLoom", col: "score_loom", label: "Loom request" },
  group: { field: "scoreGroup", col: "score_group", label: "Group interview" },
  oneToOne: { field: "scoreOneToOne", col: "score_one_to_one", label: "One to one interview" },
  testProject: { field: "scoreTestProject", col: "score_test_project", label: "Test project" },
};

const str = (v: unknown, what: string, max = 200): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > max) throw new ActionError(`Choose a valid ${what}.`);
  return s;
};
const optText = (v: unknown, max = 2000): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new ActionError("Write the note as text.");
  return v.trim().slice(0, max);
};

async function candidate(ctx: Ctx, id: string): Promise<Row> {
  const row = await ctx.store.candidate(id);
  if (!row) throw new ActionError("That candidate is not on the board any more.", 404);
  return row;
}

const audit = (ctx: Ctx, action: string, entityType: string, entityId: string | null, rest: Row) =>
  ctx.store.audit({
    action,
    entity_type: entityType,
    entity_id: entityId,
    actor_email: ctx.actor,
    before: rest.before,
    after: rest.after,
    metadata: { apply: ctx.apply, sendEnabled: ctx.sendEnabled, ...(rest.metadata ?? {}) },
  });

const dryRunLine = (would: string) =>
  `Dry run: GoHighLevel writes are off on the server (HIRING_APPLY is not true), so nothing was saved. It would ${would}.`;

/** Custom field ids for the values given, by spec key. Keys with no field are listed. */
function fieldsFor(fields: Record<string, string>, values: Record<string, string | number | null>) {
  const customFields: { id: string; value: string }[] = [];
  const missing: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!fields[key]) missing.push(key);
    else customFields.push({ id: fields[key], value: value === null ? "" : String(value) });
  }
  return { customFields, missing };
}

/** A score for one stage, the reason, and an optional move. */
export async function grade(ctx: Ctx, args: Row): Promise<Row | DryRun> {
  const candidateId = str(args.candidateId, "candidate");
  const key = String(args.stage ?? "");
  const spec = SCORES[key];
  if (!spec) throw new ActionError("Choose which stage the score is for.");
  const score = Number(args.score);
  if (typeof args.score !== "number" || !Number.isFinite(score) || score < 0 || score > 10)
    throw new ActionError("A score is out of ten.");
  const moveTo = args.moveTo === undefined || args.moveTo === null || args.moveTo === ""
    ? null
    : String(args.moveTo) as StageKey;
  if (moveTo && !STAGE_KEYS.includes(moveTo)) throw new ActionError("Choose a stage on the board.");
  const note = optText(args.note);

  const row = await candidate(ctx, candidateId);
  const ghl = requireGhl(ctx);
  const m = await loadMeta(ctx);
  const scores: Record<string, number | null> = {};
  for (const [k, s] of Object.entries(SCORES))
    scores[k] = row[s.col] === null || row[s.col] === undefined ? null : Number(row[s.col]);
  scores[key] = score;
  const total = totalScore(Object.values(scores));
  const stamp = ctx.now().toISOString().slice(0, 10);
  const line = `${stamp}, ${spec.label}, ${score}/10 by ${ctx.actor}${note ? `: ${note}` : ""}`;
  const notes = [line, String(row.notes ?? "")].filter(Boolean).join("\n\n").slice(0, 8000);
  const stageId = moveTo ? m.stageIdByKey[String(row.role)]?.[moveTo] : null;
  if (moveTo && !stageId)
    throw new ActionError(
      `There is no ${stageName(moveTo)} stage on the ${row.role_label ?? row.role} board. Run the hiring setup again.`,
      409,
    );
  const { customFields, missing } = fieldsFor(m.fields, {
    [spec.field]: score,
    scoreTotal: total,
    notes,
  });
  const plan = {
    contact: { contactId: row.contact_id, write: [spec.field, "scoreTotal", "notes"], missingFields: missing },
    move: moveTo ? { from: row.stage, to: moveTo } : null,
  };
  await audit(ctx, "hiring.grade", "cockpit_hiring_candidates", candidateId, {
    before: { [spec.col]: row[spec.col] ?? null, score_total: row.score_total ?? null, stage: row.stage },
    after: { [spec.col]: score, score_total: total, stage: moveTo ?? row.stage },
    metadata: { dryRun: !ctx.apply, note: Boolean(note), plan },
  });
  if (!ctx.apply)
    return {
      dryRun: true,
      message: dryRunLine(
        `set ${spec.label} to ${score} out of 10${moveTo ? ` and move them to ${stageName(moveTo)}` : ""}`,
      ),
      plan,
    };

  if (customFields.length)
    await ghl.write("PUT", `/contacts/${encodeURIComponent(String(row.contact_id))}`, { customFields });
  await ctx.store.insertEvents([{
    candidate_id: candidateId,
    role: String(row.role),
    kind: "score",
    to_stage: String(row.stage),
    detail: line,
    by_whom: ctx.actor,
  }]);
  await ctx.store.patchCandidate(candidateId, { [spec.col]: score, score_total: total, notes });
  let moved: string | null = null;
  if (moveTo && stageId) {
    await ghl.write("PUT", `/opportunities/${encodeURIComponent(candidateId)}`, { pipelineStageId: stageId });
    moved = stageName(moveTo);
    await ctx.store.insertEvents([{
      candidate_id: candidateId,
      role: String(row.role),
      kind: "stage",
      from_stage: String(row.stage),
      to_stage: moveTo,
      detail: `Moved to ${moved} after grading.`,
      by_whom: ctx.actor,
    }]);
    await ctx.store.patchCandidate(candidateId, {
      stage: moveTo,
      stage_name: moved,
      stage_since: ctx.now().toISOString(),
    });
  }
  return { ok: true, score, total, moved };
}

/** Move a candidate to another role's board at the same stage. */
export async function reassign(ctx: Ctx, args: Row): Promise<Row | DryRun> {
  const candidateId = str(args.candidateId, "candidate");
  const reason = optText(args.reason, 500);
  const row = await candidate(ctx, candidateId);
  const from = roleByKey(String(row.role));
  const to = roleByKey(String(args.role ?? ""));
  if (!to) throw new ActionError(`There is no role called ${String(args.role ?? "") || "that"}.`);
  if (to.key === String(row.role)) throw new ActionError(`They are already on the ${to.label} board.`);
  const ghl = requireGhl(ctx);
  const m = await loadMeta(ctx);
  const stage = String(row.stage) as StageKey;
  const pipelineId = m.pipelines[to.key];
  const stageId = m.stageIdByKey[to.key]?.[stage];
  if (!pipelineId || !stageId)
    throw new ActionError(`The ${to.label} pipeline is not built yet. Run the hiring setup, then try again.`, 409);
  const fromLabel = from?.label ?? String(row.role);
  const detail = `Moved from ${fromLabel} to ${to.label}${reason ? `: ${reason}` : "."}`;
  const plan = { opportunity: candidateId, from: row.role, to: to.key, stage, pipelineId };
  await audit(ctx, "hiring.reassign", "cockpit_hiring_candidates", candidateId, {
    before: { role: row.role, pipeline_id: row.pipeline_id },
    after: { role: to.key, pipeline_id: pipelineId },
    metadata: { dryRun: !ctx.apply, reason: Boolean(reason) },
  });
  if (!ctx.apply)
    return {
      dryRun: true,
      message: dryRunLine(`move them from ${fromLabel} to ${to.label}, still in ${stageName(stage)}`),
      plan,
    };
  await ghl.write("PUT", `/opportunities/${encodeURIComponent(candidateId)}`, {
    pipelineId,
    pipelineStageId: stageId,
  });
  let warning: string | null = null;
  const { customFields } = fieldsFor(m.fields, { role: to.label });
  if (customFields.length)
    await ghl
      .write("PUT", `/contacts/${encodeURIComponent(String(row.contact_id))}`, { customFields })
      .catch(e => {
        warning = `The card moved, but the contact's role field was not updated: ${(e as Error).message}`;
      });
  await ctx.store.insertEvents([{
    candidate_id: candidateId,
    role: to.key,
    kind: "note",
    to_stage: stage,
    detail,
    by_whom: ctx.actor,
  }]);
  await ctx.store.patchCandidate(candidateId, { role: to.key, role_label: to.label, pipeline_id: pipelineId });
  return { ok: true, role: to.label, stage: stageName(stage), warning };
}

/** The engine's switches, stored in cockpit_hiring_meta "engine". */
export async function setEngine(ctx: Ctx, args: Row): Promise<Row> {
  const current = mergeSettings(await ctx.store.getMeta(SETTINGS_KEY));
  let patch;
  try {
    patch = settingsPatch(current, args);
  } catch (e) {
    if (e instanceof SettingsError) throw new ActionError(e.message);
    throw e;
  }
  const next = { ...current, ...patch };
  await audit(ctx, "hiring.setEngine", "cockpit_hiring_meta", SETTINGS_KEY, {
    before: current,
    after: next,
    metadata: { patch },
  });
  await ctx.store.putMeta(SETTINGS_KEY, next);
  return next;
}

/** The drafts not yet sent or being sent, newest first. */
export async function drafts(ctx: Ctx): Promise<Row[]> {
  const rows = await ctx.store.drafts(50);
  const busy = new Set(await ctx.store.liveSends(rows.map(r => Number(r.id))));
  const open = rows.filter(r => !busy.has(Number(r.id)));
  const people = await ctx.store.candidatesByIds([...new Set(open.map(r => String(r.candidate_id)))]);
  const byId = new Map(people.map(p => [String(p.id), p]));
  return open.map(r => ({
    id: Number(r.id),
    candidateId: String(r.candidate_id),
    name: String(byId.get(String(r.candidate_id))?.name ?? "") || "Someone",
    stage: String(byId.get(String(r.candidate_id))?.stage_name ?? ""),
    role: String(r.role),
    action: String(r.action ?? ""),
    text: String(r.detail ?? ""),
    at: Date.parse(String(r.at)),
  }));
}

/** Send one draft, pressed by the CEO. Every attempt is recorded. */
export async function sendDraft(ctx: Ctx, args: Row): Promise<Row> {
  const eventId = Number(args.eventId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new ActionError("Choose a draft to send.");
  const draft = await ctx.store.event(eventId);
  const refuse = async (reason: string, status = 409): Promise<never> => {
    await audit(ctx, "hiring.sendDraft.refused", "cockpit_hiring_events", String(eventId), {
      metadata: { reason },
    });
    if (draft)
      await ctx.store.recordSend({
        event_id: eventId,
        candidate_id: String(draft.candidate_id),
        actor_email: String(ctx.actor),
        status: "refused",
        detail: reason,
      });
    throw new ActionError(reason, status);
  };
  if (!draft || draft.kind !== "action") return refuse("That draft is gone.", 404);
  if (draft.ok === true) return refuse("That message was already sent.");
  const parts = parseDraft(String(draft.detail ?? ""));
  if (!parts) return refuse("That entry is not a draft the engine wrote, so it cannot be sent from here.");
  const row = await ctx.store.candidate(String(draft.candidate_id));
  if (!row) return refuse("That candidate is not on the board any more.", 404);
  const s = mergeSettings(await ctx.store.getMeta(SETTINGS_KEY));
  if (s.sender === "gohighlevel")
    return refuse("GoHighLevel is the sender, so the cockpit sends nothing. Switch the sender to the cockpit first.");
  if (!ctx.sendEnabled)
    return refuse("Sending is off on the server (HIRING_SEND_ENABLED is not true), so nothing was sent.");
  if (!ctx.ghl)
    return refuse("The hiring sub-account is not connected: set GHL_HIRING_PIT and GHL_HIRING_LOCATION.", 503);
  if (!s.email && !s.sms) return refuse("No rail is switched on, so nothing was sent.");

  const sendId = await ctx.store.claimSend({
    event_id: eventId,
    candidate_id: String(draft.candidate_id),
    actor_email: String(ctx.actor),
    status: "claimed",
  });
  if (!sendId)
    return refuse(
      "This draft is already being sent or was sent. Check the candidate's conversation in GoHighLevel before trying again.",
    );
  const rails = [s.email && "email", s.sms && "SMS", s.sms && s.whatsappFallback && "WhatsApp if SMS fails"]
    .filter(Boolean);
  try {
    await audit(ctx, "hiring.sendDraft", "cockpit_hiring_events", String(eventId), {
      metadata: { sendId, candidateId: String(draft.candidate_id), action: draft.action, rails },
    });
  } catch (e) {
    await ctx.store.finishSend(sendId, { status: "failed", detail: "The audit row could not be saved, so nothing was sent." });
    throw e;
  }

  const ghl = ctx.ghl;
  const contactId = String(row.contact_id);
  const sentOn: string[] = [];
  const refused: string[] = [];
  if (s.email)
    await ghl
      .send("Email", contactId, {
        subject: parts.subject,
        html: parts.message.replace(/\n/g, "<br>"),
        message: parts.message,
      })
      .then(() => sentOn.push("email"))
      .catch(e => refused.push(`email: ${(e as Error).message}`));
  if (s.sms)
    await ghl
      .send("SMS", contactId, { message: parts.sms })
      .then(() => sentOn.push("SMS"))
      .catch(async e => {
        refused.push(`SMS: ${(e as Error).message}`);
        // The phone rail is the one that gets read, so try WhatsApp too.
        if (s.whatsappFallback && !(e instanceof GateError))
          await ghl
            .send("WhatsApp", contactId, { message: parts.sms })
            .then(() => sentOn.push("WhatsApp"))
            .catch(e2 => refused.push(`WhatsApp: ${(e2 as Error).message}`));
      });
  if (!sentOn.length) {
    const why = refused.join("; ").slice(0, 600) || "Nothing was sent.";
    await ctx.store.finishSend(sendId, { status: "failed", rails: [], detail: why });
    throw new ActionError(`Nothing was sent. ${why}`.split("\n")[0], 502);
  }
  await ctx.store.finishSend(sendId, {
    status: "sent",
    rails: sentOn,
    detail: refused.length ? `Refused: ${refused.join("; ")}`.slice(0, 600) : null,
  });
  await ctx.store.patchEvent(eventId, {
    ok: true,
    detail: `Sent by ${ctx.actor} on ${sentOn.join(" and ")}.\n${parts.body}`.slice(0, 4000),
    by_whom: String(ctx.actor),
  });
  return { ok: true, to: String(row.name ?? ""), sentOn, refused };
}

/** Pull the forms, pull the board, then draft what the moves ask for. */
export async function refreshNow(ctx: Ctx, args: Row): Promise<Row> {
  const withIntake = args.intake !== false;
  await audit(ctx, "hiring.refreshNow", "cockpit_hiring_runs", null, {
    metadata: { intake: withIntake },
  });
  const intake = withIntake ? await runJob(ctx, "intake", "refreshNow") : null;
  const sync = await runJob(ctx, "mirror", "refreshNow");
  const engine = await runJob(ctx, "engine", "refreshNow");
  const failed = [intake, sync, engine].filter(x => x && !x.ok);
  if (failed.length) {
    const done = sync.ok ? `The board was pulled (${sync.added} new, ${sync.moved} moved). ` : "";
    const why = failed.map(f => `${JOB_LABEL[f!.job]}: ${f!.note}`).join(" ");
    throw new ActionError(`${done}Not done: ${why}`.replace(/\s*\n\s*/g, " ").slice(0, 600), 502);
  }
  return { intake, sync, engine };
}

export const OPERATIONS = {
  refreshNow,
  grade,
  reassign,
  setEngine,
  drafts: (ctx: Ctx) => drafts(ctx),
  sendDraft,
} as const;
export type Operation = keyof typeof OPERATIONS;
