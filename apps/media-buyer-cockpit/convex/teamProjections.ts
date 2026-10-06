import { v } from "convex/values";
import type { ProjectionsPage } from "../src/lib/projectionsView";
import { internal } from "./_generated/api";
import { bridge } from "./comms";
import { authenticatedAction } from "./functions";
import {
  db,
  enc,
  isBoss,
  logChange,
  meetingOrRefuse,
  noted,
  type Who,
} from "./teamDb";

/**
 * The client success Projections screen on a Team meetings page.
 *
 * The CEO, 2026-09-27: the Sunday "Renewals & Re-sell Projections" meeting
 * shows the week's strip and the renewal window, and CSM Daily shows the
 * hardest renewal for Tuesday's role play. The data is the client success
 * cockpit's (convex/projections.ts there): this reads it and changes it
 * through the bridge, saying who is asking, so both screens show the same
 * numbers and every change is written by the same rules and audited there.
 * A copy of the change also goes in this meeting's change log.
 *
 * Who may: the meeting's people, admins and the CEO. Gold standard is the
 * CEO's alone; the client success side checks that from the flag sent here.
 */

const EMBEDS = new Set(["cs-projections", "cs-daily"]);

async function mayUse(w: Who, meetingId: string): Promise<void> {
  const m = await meetingOrRefuse(meetingId, "id,embed");
  if (!EMBEDS.has(String(m.embed ?? "")))
    throw new Error("This meeting does not show the client success panel.");
  if (isBoss(w)) return;
  const [me] = await db(`team_people?select=id&email=ilike.${enc(w.email)}`);
  if (me) {
    const rows = await db(
      `team_meeting_people?select=part&meeting_id=eq.${enc(meetingId)}&person_id=eq.${enc(String(me.id))}&removed=eq.false`,
    );
    if (rows.length) return;
  }
  throw new Error(
    "The projections on this page are for the people in this meeting, admins and the CEO.",
  );
}

const viewerOf = (w: Who) => ({
  email: w.email,
  isCeo: w.isCeo,
  isAdmin: w.isAdmin,
});

/** The client success cockpit's own words, without the bridge's wrapping. */
function said(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  if (/bridge not configured/.test(raw))
    return new Error(
      "The client success cockpit cannot be reached from here (its bridge is not set up).",
    );
  const words = raw
    .replace(/^csm:[A-Za-z]+ → HTTP \d+ /, "")
    .replace(/^(Uncaught )?(Convex)?Error: /, "")
    .trim();
  return new Error(
    words ||
      "The client success cockpit did not answer. Try again in a minute.",
  );
}

export const projections = authenticatedAction({
  args: { meetingId: v.string(), forEmail: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, a): Promise<ProjectionsPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mayUse(w, a.meetingId);
      try {
        return (await bridge("csm", "projections", {
          viewer: viewerOf(w),
          ...(a.forEmail ? { forEmail: a.forEmail } : {}),
        })) as ProjectionsPage;
      } catch (e) {
        throw said(e);
      }
    }),
});

/** What a change was, for this meeting's change log. */
function whatOf(edit: Record<string, unknown>): string {
  switch (edit.kind) {
    case "projection":
      return `set the ${String(edit.metric)} projection for the week of ${String(edit.weekStart)}`;
    case "actual":
      return `typed in the ${String(edit.metric)} actual for the week of ${String(edit.weekStart)}`;
    case "missReason":
      return `wrote why ${String(edit.metric)} was missed in the week of ${String(edit.weekStart)}`;
    case "plan":
      return "changed a renewal plan";
    case "status":
      return `set a renewal to ${String(edit.status).replace(/_/g, " ")}`;
    case "gold":
      return edit.on
        ? "marked a call gold standard"
        : "took a call out of the gold-standard library";
    default:
      return "changed the projections";
  }
}

export const projectionsEdit = authenticatedAction({
  args: {
    meetingId: v.string(),
    edit: v.any(),
    forEmail: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<ProjectionsPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mayUse(w, a.meetingId);
      const edit = (a.edit ?? {}) as Record<string, unknown>;
      let page: ProjectionsPage;
      try {
        page = (await bridge("csm", "projectionsEdit", {
          viewer: viewerOf(w),
          edit,
          ...(a.forEmail ? { forEmail: a.forEmail } : {}),
        })) as ProjectionsPage;
      } catch (e) {
        throw said(e);
      }
      await logChange(w.email, a.meetingId, whatOf(edit), {
        from: "the client success panel",
        kind: edit.kind ?? null,
        ...(edit.taskId ? { taskId: edit.taskId } : {}),
      });
      return page;
    }),
});

export const projectionsBook = authenticatedAction({
  args: {
    meetingId: v.string(),
    taskId: v.string(),
    day: v.string(),
    time: v.string(),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<{ when: string; title: string }> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      await mayUse(w, a.meetingId);
      let done: { when: string; title: string };
      try {
        done = (await bridge("csm", "projectionsBook", {
          viewer: viewerOf(w),
          taskId: a.taskId,
          day: a.day,
          time: a.time,
        })) as { when: string; title: string };
      } catch (e) {
        throw said(e);
      }
      await logChange(
        w.email,
        a.meetingId,
        `booked a proactive results call for ${a.day} ${a.time}`,
        { from: "the client success panel", taskId: a.taskId },
      );
      return done;
    }),
});
