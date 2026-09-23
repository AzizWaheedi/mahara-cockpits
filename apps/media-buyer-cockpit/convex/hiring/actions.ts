import { v } from "convex/values";
import { internal } from "../_generated/api";
import { rest } from "../ceo/sbWrite";
import { authenticatedAction } from "../functions";
import { type EngineSettings, runOnce, settings } from "./engine";
import { type Any, ghlOk } from "./ghl";
import { intakeOnce } from "./intake";
import {
  ROLES,
  roleByKey,
  STAGE_KEYS,
  STAGE_SCORES,
  type StageKey,
  stageName,
  TRACKS,
} from "./spec";
import {
  meta,
  moveStage,
  pullOnce,
  totalScore,
  writeContactFields,
} from "./sync";

/**
 * What the Recruiting tab can do.
 *
 * Every entry point is gated on the CEO (ltv.whoami refuses anyone else),
 * writes to GoHighLevel so the board and the cockpit never disagree, and
 * leaves a row in cockpit_hiring_events so a candidate's history reads as one
 * story no matter which screen it was written from.
 */

const SCORE_FIELD: Record<string, string> = {
  application: "scoreApplication",
  loom: "scoreLoom",
  group: "scoreGroup",
  oneToOne: "scoreOneToOne",
  testProject: "scoreTestProject",
};

const vScoreKey = v.union(
  v.literal("application"),
  v.literal("loom"),
  v.literal("group"),
  v.literal("oneToOne"),
  v.literal("testProject"),
);

const vStage = v.union(
  ...(STAGE_KEYS.map(k => v.literal(k)) as [
    ReturnType<typeof v.literal>,
    ...ReturnType<typeof v.literal>[],
  ]),
);

async function candidate(id: string): Promise<Any> {
  const rows = await rest(
    `cockpit_hiring_candidates?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  );
  const row = rows?.[0];
  if (!row) throw new Error("That candidate is not on the board any more.");
  return row;
}

async function event(row: Any): Promise<void> {
  await rest("cockpit_hiring_events", {
    method: "POST",
    body: [row],
    prefer: "return=minimal",
  });
}

/**
 * Give a candidate a score for one stage, and say why.
 *
 * The score goes onto the GoHighLevel contact so it is visible on the card,
 * the total is recomputed from every score given, and the note is prepended
 * to the candidate's notes with the stage and the day, so the reason a person
 * was advanced or dropped survives the month.
 */
export const grade = authenticatedAction({
  args: {
    candidateId: v.string(),
    stage: vScoreKey,
    score: v.number(),
    note: v.optional(v.string()),
    /** Move them on once graded. Optional, because a score is not a decision. */
    moveTo: v.optional(vStage),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    if (args.score < 0 || args.score > 10)
      throw new Error("A score is out of ten.");
    const row = await candidate(args.candidateId);
    const field = SCORE_FIELD[args.stage];
    const scores = {
      application: row.score_application,
      loom: row.score_loom,
      group: row.score_group,
      oneToOne: row.score_one_to_one,
      testProject: row.score_test_project,
    } as Record<string, number | null>;
    scores[args.stage] = args.score;
    const total = totalScore(
      Object.values(scores).map(x => (x === null ? null : Number(x))),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const line = args.note?.trim()
      ? `${stamp}, ${stageName(args.stage as StageKey)}, ${args.score}/10 by ${by}: ${args.note.trim()}`
      : `${stamp}, ${stageName(args.stage as StageKey)}, ${args.score}/10 by ${by}`;
    const notes = [line, String(row.notes ?? "")].filter(Boolean).join("\n\n");

    await writeContactFields(String(row.contact_id), {
      [field]: args.score,
      scoreTotal: total,
      notes: notes.slice(0, 8000),
    });
    await event({
      candidate_id: args.candidateId,
      role: String(row.role),
      kind: "score",
      to_stage: String(row.stage),
      detail: line,
      by_whom: by,
    });
    // Keep the mirror honest straight away; the next sync agrees with it.
    await rest(
      `cockpit_hiring_candidates?id=eq.${encodeURIComponent(args.candidateId)}`,
      {
        method: "PATCH",
        body: {
          [`score_${args.stage === "oneToOne" ? "one_to_one" : args.stage === "testProject" ? "test_project" : args.stage}`]:
            args.score,
          score_total: total,
          notes: notes.slice(0, 8000),
        },
        prefer: "return=minimal",
      },
    );

    let moved: string | null = null;
    if (args.moveTo) {
      await moveStage(
        args.candidateId,
        String(row.role) as never,
        args.moveTo as StageKey,
      );
      moved = stageName(args.moveTo as StageKey);
      await event({
        candidate_id: args.candidateId,
        role: String(row.role),
        kind: "stage",
        from_stage: String(row.stage),
        to_stage: args.moveTo,
        detail: `Moved to ${moved} after grading.`,
        by_whom: by,
      });
      await rest(
        `cockpit_hiring_candidates?id=eq.${encodeURIComponent(args.candidateId)}`,
        {
          method: "PATCH",
          body: {
            stage: args.moveTo,
            stage_name: moved,
            stage_since: new Date().toISOString(),
          },
          prefer: "return=minimal",
        },
      );
    }
    return { ok: true, score: args.score, total, moved };
  },
});

/** Move a candidate, with the reason the stage asks for. */
export const move = authenticatedAction({
  args: {
    candidateId: v.string(),
    stage: vStage,
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const row = await candidate(args.candidateId);
    const stage = args.stage as StageKey;
    const reason = args.reason?.trim() ?? "";
    if ((stage === "disqualified" || stage === "bench") && !reason)
      throw new Error(
        stage === "bench"
          ? "Say why they are benched. The reason is what brings them back."
          : "Say why they were disqualified, so the job post can be fixed.",
      );
    await moveStage(args.candidateId, String(row.role) as never, stage);
    if (reason)
      await writeContactFields(String(row.contact_id), {
        [stage === "bench" ? "benchReason" : "disqualifyReason"]: reason,
      }).catch(() => undefined);
    await event({
      candidate_id: args.candidateId,
      role: String(row.role),
      kind: "stage",
      from_stage: String(row.stage),
      to_stage: stage,
      detail: reason
        ? `Moved to ${stageName(stage)}: ${reason}`
        : `Moved to ${stageName(stage)}.`,
      by_whom: by,
    });
    await rest(
      `cockpit_hiring_candidates?id=eq.${encodeURIComponent(args.candidateId)}`,
      {
        method: "PATCH",
        body: {
          stage,
          stage_name: stageName(stage),
          stage_since: new Date().toISOString(),
          ...(stage === "bench" ? { bench_reason: reason } : {}),
          ...(stage === "disqualified" ? { disqualify_reason: reason } : {}),
        },
        prefer: "return=minimal",
      },
    );
    return { ok: true, stage: stageName(stage) };
  },
});

/**
 * Move a candidate to another role's board, keeping everything about them.
 *
 * Aziz, 2026-09-22, on the sales funnel: "I make them a setter, and then they
 * turn into a closer" or "I just bring them straight to becoming a closer. It
 * just depends on how skilled they are." Everyone answers the closer's form,
 * so this is the switch: the card moves to the other pipeline at the same
 * stage, the scores and the notes travel with it, and the move is on the
 * record with the reason.
 */
export const reassign = authenticatedAction({
  args: {
    candidateId: v.string(),
    role: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const row = await candidate(args.candidateId);
    const from = roleByKey(String(row.role));
    const to = roleByKey(args.role);
    if (!to) throw new Error(`No role called ${args.role}`);
    if (to.key === String(row.role))
      throw new Error(`They are already on the ${to.label} board.`);
    const m = await meta();
    const pipelineId = m.pipelines[to.key];
    const stage = String(row.stage) as StageKey;
    const stageId = m.stageIdByKey[to.key]?.[stage];
    if (!pipelineId || !stageId)
      throw new Error(
        `The ${to.label} pipeline is not built yet. Run the hiring setup, then try again.`,
      );
    await ghlOk("PUT", `/opportunities/${args.candidateId}`, {
      body: { pipelineId, pipelineStageId: stageId },
    });
    await writeContactFields(String(row.contact_id), {
      role: to.label,
    }).catch(() => undefined);
    const detail = args.reason?.trim()
      ? `Moved from ${from?.label ?? String(row.role)} to ${to.label}: ${args.reason.trim()}`
      : `Moved from ${from?.label ?? String(row.role)} to ${to.label}.`;
    await event({
      candidate_id: args.candidateId,
      role: to.key,
      kind: "note",
      to_stage: stage,
      detail,
      by_whom: by,
    });
    await rest(
      `cockpit_hiring_candidates?id=eq.${encodeURIComponent(args.candidateId)}`,
      {
        method: "PATCH",
        body: {
          role: to.key,
          role_label: to.label,
          pipeline_id: pipelineId,
        },
        prefer: "return=minimal",
      },
    );
    return { ok: true, role: to.label, stage: stageName(stage) };
  },
});

/** Write a note on a candidate without scoring them. */
export const note = authenticatedAction({
  args: { candidateId: v.string(), text: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const body = args.text.trim();
    if (!body) throw new Error("An empty note says nothing.");
    const row = await candidate(args.candidateId);
    const line = `${new Date().toISOString().slice(0, 10)}, ${by}: ${body}`;
    const notes = [line, String(row.notes ?? "")].filter(Boolean).join("\n\n");
    await writeContactFields(String(row.contact_id), {
      notes: notes.slice(0, 8000),
    });
    await event({
      candidate_id: args.candidateId,
      role: String(row.role),
      kind: "note",
      detail: line,
      by_whom: by,
    });
    await rest(
      `cockpit_hiring_candidates?id=eq.${encodeURIComponent(args.candidateId)}`,
      {
        method: "PATCH",
        body: { notes: notes.slice(0, 8000) },
        prefer: "return=minimal",
      },
    );
    return { ok: true };
  },
});

/** Everything written about one candidate, newest first. */
export const history = authenticatedAction({
  args: { candidateId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const row = await candidate(args.candidateId);
    const events =
      (await rest(
        `cockpit_hiring_events?candidate_id=eq.${encodeURIComponent(args.candidateId)}&select=kind,action,from_stage,to_stage,detail,ok,by_whom,at&order=at.desc&limit=100`,
      )) ?? [];
    const role = roleByKey(String(row.role));
    return {
      name: String(row.name ?? ""),
      role: role?.label ?? String(row.role),
      stage: String(row.stage_name ?? ""),
      notes: String(row.notes ?? ""),
      scorecard: role?.scorecard ?? [],
      scoresDue: STAGE_SCORES[String(row.stage) as never] ?? [],
      events,
    };
  },
});

/** Arm or disarm the engine, change the channel, switch one action off. */
export const setEngine = authenticatedAction({
  args: {
    sender: v.optional(v.union(v.literal("gohighlevel"), v.literal("cockpit"))),
    armed: v.optional(v.boolean()),
    email: v.optional(v.boolean()),
    sms: v.optional(v.boolean()),
    whatsappFallback: v.optional(v.boolean()),
    staleDays: v.optional(v.number()),
    action: v.optional(v.string()),
    on: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const current = await settings();
    const patch: Partial<EngineSettings> = {};
    if (args.sender) patch.sender = args.sender;
    if (args.armed !== undefined) patch.armed = args.armed;
    if (args.email !== undefined) patch.email = args.email;
    if (args.sms !== undefined) patch.sms = args.sms;
    if (args.whatsappFallback !== undefined)
      patch.whatsappFallback = args.whatsappFallback;
    if (args.staleDays !== undefined)
      patch.staleDays = Math.max(1, Math.min(60, Math.round(args.staleDays)));
    if (args.action && args.on !== undefined)
      patch.actions = { ...current.actions, [args.action]: args.on } as never;
    const next: EngineSettings = await ctx.runAction(
      internal.hiring.engine.setSettings,
      { patch },
    );
    await event({
      candidate_id: null,
      role: "",
      kind: "note",
      detail: `${by} changed the hiring engine: ${JSON.stringify(patch)}`,
      by_whom: by,
    }).catch(() => undefined);
    return next;
  },
});

/** Pull the forms, pull the board, then do whatever the moves ask for. */
export const refreshNow = authenticatedAction({
  args: { intake: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const took = args.intake === false ? null : await intakeOnce();
    const pulled = await pullOnce();
    const engine = await runOnce();
    await ctx.runAction(internal.ceo.refresh.refreshAll, { only: ["hiring"] });
    return { intake: took, sync: pulled, engine };
  },
});

/** The messages the engine has written but not sent, for a read through. */
export const drafts = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const rows =
      (await rest(
        "cockpit_hiring_events?kind=eq.action&ok=eq.false&select=id,candidate_id,role,action,detail,at&order=at.desc&limit=50",
      )) ?? [];
    const ids = rows.map(r => `"${String(r.candidate_id)}"`).join(",");
    const people = ids
      ? ((await rest(
          `cockpit_hiring_candidates?id=in.(${ids})&select=id,name,stage_name`,
        )) ?? [])
      : [];
    const byId = new Map(people.map(p => [String(p.id), p]));
    return rows.map(r => ({
      id: Number(r.id),
      candidateId: String(r.candidate_id),
      name: String(byId.get(String(r.candidate_id))?.name ?? "Someone"),
      stage: String(byId.get(String(r.candidate_id))?.stage_name ?? ""),
      role: String(r.role),
      action: String(r.action ?? ""),
      text: String(r.detail ?? ""),
      at: Date.parse(String(r.at)),
    }));
  },
});

/** Send one drafted message by hand, without arming the engine. */
export const sendDraft = authenticatedAction({
  args: { eventId: v.number() },
  returns: v.any(),
  handler: async (ctx, { eventId }) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const rows = await rest(
      `cockpit_hiring_events?id=eq.${eventId}&select=id,candidate_id,role,action,detail,ok&limit=1`,
    );
    const draft = rows?.[0];
    if (!draft) throw new Error("That draft is gone.");
    if (draft.ok === true) throw new Error("That message was already sent.");
    const row = await candidate(String(draft.candidate_id));
    const s = await settings();
    // The draft body is stored after the "Drafted, not sent" line, with the
    // short form on its own line at the end.
    const lines = String(draft.detail ?? "").split("\n");
    const shortAt = lines.findIndex(l => l.startsWith("Short form"));
    const body = lines
      .slice(1, shortAt === -1 ? undefined : shortAt)
      .join("\n")
      .trim();
    const short =
      shortAt === -1
        ? body
        : lines[shortAt].replace(/^Short form[^:]*:\s*/, "").trim();
    const [subject, ...rest_] = body.split("\n");
    const message = rest_.join("\n").trim();
    const sentOn: string[] = [];
    const refused: string[] = [];
    const send = async (type: string, payload: Record<string, unknown>) => {
      await ghlOk("POST", "/conversations/messages", {
        body: { type, contactId: String(row.contact_id), ...payload },
      });
    };
    if (s.email)
      await send("Email", {
        subject,
        html: message.replace(/\n/g, "<br>"),
        message,
      })
        .then(() => sentOn.push("email"))
        .catch(e => refused.push(`email: ${(e as Error).message}`));
    if (s.sms)
      await send("SMS", { message: short })
        .then(() => sentOn.push("SMS"))
        .catch(async e => {
          refused.push(`SMS: ${(e as Error).message}`);
          if (s.whatsappFallback)
            await send("WhatsApp", { message: short })
              .then(() => sentOn.push("WhatsApp"))
              .catch(e2 => refused.push(`WhatsApp: ${(e2 as Error).message}`));
        });
    if (!sentOn.length)
      throw new Error(
        refused.join("; ") || "No rail is switched on, so nothing was sent.",
      );
    await rest(`cockpit_hiring_events?id=eq.${eventId}`, {
      method: "PATCH",
      body: {
        ok: true,
        detail: `Sent by ${by} on ${sentOn.join(" and ")}.\n${body}`,
        by_whom: by,
      },
      prefer: "return=minimal",
    });
    return { ok: true, to: String(row.name ?? ""), sentOn, refused };
  },
});

/** The roles, their pay, their scorecard and their test project, for the screen. */
export const roles = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const m = await meta().catch(() => null);
    return ROLES.map(r => ({
      key: r.key,
      label: r.label,
      careersUrl: r.careersUrl,
      compensation: r.compensation,
      postOn: r.postOn,
      rampTime: r.rampTime,
      scorecard: r.scorecard,
      testProject: r.testProject,
      loomPrompt: r.loomPrompt,
      pipelineReady: Boolean(m?.pipelines?.[r.key]),
      // The other boards a candidate on this one can be moved to.
      tracks: (TRACKS[r.key] ?? []).map(k => ({
        key: k,
        label: roleByKey(k)?.label ?? k,
      })),
    }));
  },
});
