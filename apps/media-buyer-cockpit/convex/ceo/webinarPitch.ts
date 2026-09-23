import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { rest } from "./sbWrite";

/**
 * When each pitch started in a webinar session, set by hand on the Frontend
 * tab's webinar funnel. The room's retention at a pitch is read at these
 * minutes. Without them pitch 1 is found from the chat's "drop a 1" burst
 * (convex/ceo/webinarRoom.ts) and pitch 2 stays unknown.
 *
 * Writes the two pitch columns of cockpit_webinar_sessions in Creative
 * Triage, which hermes/webinar-pull never touches, and leaves an audit row
 * with the old and new times. CEO only.
 */

const MAX_MINUTE = 300;

const refuse = (message: string) => new ConvexError({ message });

export const record = internalMutation({
  args: {
    sessionUuid: v.string(),
    what: v.string(),
    before: v.any(),
    after: v.any(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: "webinar.pitches",
      table: "cockpit_webinar_sessions",
      rowId: a.sessionUuid,
      what: a.what,
      before: a.before,
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

function minuteProblem(m: number | null, name: string): string | null {
  if (m === null) return null;
  if (!Number.isInteger(m) || m < 0 || m > MAX_MINUTE)
    return `${name} has to be a whole minute between 0 and ${MAX_MINUTE}.`;
  return null;
}

export const set = authenticatedAction({
  args: {
    sessionUuid: v.string(),
    pitch1Min: v.union(v.number(), v.null()),
    pitch2Min: v.union(v.number(), v.null()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const problem =
      minuteProblem(a.pitch1Min, "Pitch 1") ??
      minuteProblem(a.pitch2Min, "Pitch 2") ??
      (a.pitch1Min !== null &&
      a.pitch2Min !== null &&
      a.pitch2Min <= a.pitch1Min
        ? "Pitch 2 has to come after pitch 1."
        : null);
    if (problem) throw refuse(problem);

    const id = encodeURIComponent(a.sessionUuid);
    let row: Record<string, unknown> | undefined;
    try {
      row = (
        await rest(
          `cockpit_webinar_sessions?uuid=eq.${id}&select=uuid,started_at,pitch1_at,pitch2_at`,
        )
      )?.[0];
    } catch (e) {
      throw refuse(
        `The session could not be read from Creative Triage: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
      );
    }
    if (!row) throw refuse("No Zoom session with that id.");
    const start = Date.parse(String(row.started_at));
    if (!Number.isFinite(start))
      throw refuse("The session has no start time to count minutes from.");
    const at = (m: number | null) =>
      m === null ? null : new Date(start + m * 60_000).toISOString();
    const after = {
      pitch1_at: at(a.pitch1Min),
      pitch2_at: at(a.pitch2Min),
      pitch_set_by: by,
      pitch_set_at: new Date().toISOString(),
    };
    try {
      await rest(`cockpit_webinar_sessions?uuid=eq.${id}`, {
        method: "PATCH",
        body: after,
        prefer: "return=minimal",
      });
    } catch (e) {
      throw refuse(
        `The pitch times were not saved: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
      );
    }
    const words = (m: number | null) =>
      m === null ? "not set" : `minute ${m}`;
    await ctx.runMutation(internal.ceo.webinarPitch.record, {
      sessionUuid: a.sessionUuid,
      what: `Set the webinar pitches: pitch 1 ${words(a.pitch1Min)}, pitch 2 ${words(a.pitch2Min)}`,
      before: {
        pitch1_at: row.pitch1_at ?? null,
        pitch2_at: row.pitch2_at ?? null,
      },
      after,
      by,
    });
    await ctx.scheduler.runAfter(0, internal.ceo.refresh.refreshAll, {
      only: ["webinar"],
    });
    return { ok: true };
  },
});
