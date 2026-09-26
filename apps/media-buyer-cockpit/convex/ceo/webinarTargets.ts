import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { authenticatedAction } from "../functions";
import { flush } from "../health";
import { webinarTargetRest } from "../tools";
import type { WebinarPayload } from "./payloads";
import {
  roundTargetStart,
  selectTargets,
  type TargetEditorState,
  type TargetVersion,
  webinarTargetsSchema,
} from "./webinarTargetsModel";

async function scopeStart(scope: string): Promise<number | null> {
  if (scope === "defaults") return null;
  if (!scope.startsWith("round:") || scope.length > 200)
    throw new Error("Choose a webinar round from the dashboard.");
  const rows = await webinarTargetRest<{ payload: WebinarPayload }[]>(
    "cockpit_sections?key=eq.webinar&select=payload",
  );
  const round = rows[0]?.payload?.rounds?.find(r => `round:${r.key}` === scope);
  if (!round || ["next", "untagged"].includes(round.key))
    throw new Error(
      "This round needs a stable identity before targets can be saved. Edit future defaults instead.",
    );
  return roundTargetStart(round);
}
async function readState(
  scope: string,
  startedAt: number | null,
): Promise<TargetEditorState> {
  const own = await webinarTargetRest<TargetVersion[]>(
    `cockpit_webinar_target_versions?scope_key=eq.${encodeURIComponent(scope)}&order=revision.desc&limit=10`,
  );
  const defaults =
    scope !== "defaults" && startedAt !== null
      ? await webinarTargetRest<TargetVersion[]>(
          `cockpit_webinar_target_versions?scope_key=eq.defaults&changed_at=lte.${encodeURIComponent(new Date(startedAt).toISOString())}&order=revision.desc&limit=1`,
        )
      : [];
  return {
    scope,
    selection: selectTargets([...defaults, ...own], scope, startedAt),
    history: own,
  };
}
export const get = authenticatedAction({
  args: { scope: v.string() },
  returns: v.any(),
  handler: async (ctx, { scope }): Promise<TargetEditorState> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    try {
      return await readState(scope, await scopeStart(scope));
    } catch {
      throw new ConvexError({
        message:
          "Targets could not be loaded. Check the database connection and refresh targets.",
      });
    } finally {
      await flush(ctx);
    }
  },
});
export const save = authenticatedAction({
  args: {
    scope: v.string(),
    expectedRevision: v.number(),
    values: v.any(),
    requestId: v.string(),
  },
  returns: v.any(),
  handler: async (
    ctx,
    args,
  ): Promise<TargetEditorState | { conflict: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const parsed = webinarTargetsSchema.safeParse(args.values);
    if (
      !parsed.success ||
      !Number.isInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args.requestId)
    )
      throw new ConvexError({
        message: "Check the target values and ranges, then try again.",
      });
    try {
      const startedAt = await scopeStart(args.scope);
      const result = await webinarTargetRest<
        { status: "saved"; version: TargetVersion } | { status: "conflict" }
      >("rpc/cockpit_save_webinar_targets", {
        p_scope: args.scope,
        p_expected_revision: args.expectedRevision,
        p_values: parsed.data,
        p_by: by,
        p_request_id: args.requestId,
      });
      if (result.status === "conflict") return { conflict: true };
      // The database commit is the success receipt. A refresh failure must not tell the user their save failed.
      try {
        await ctx.scheduler.runAfter(0, internal.ceo.refresh.refreshAll, {
          only: ["webinar"],
        });
      } catch {
        /* Scheduled refresh will also pick it up. */
      }
      return {
        scope: args.scope,
        selection: selectTargets([result.version], args.scope, startedAt),
        history: [result.version],
      };
    } catch {
      throw new ConvexError({
        message:
          "Save could not be confirmed. Retry the same save, or reload targets to check what was stored.",
      });
    } finally {
      await flush(ctx);
    }
  },
});
