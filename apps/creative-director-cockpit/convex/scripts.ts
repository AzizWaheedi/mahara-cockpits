import { v } from "convex/values";
import { authenticatedQuery } from "./functions";
import { allowedClients, assertRole, rowInScope } from "./roles";

/**
 * Completed script-request cards and their ClickUp descriptions, synced by
 * the media buyer every 15 minutes into `creativeTasks.script`. Descriptions
 * may be requests rather than final scripts. The page requires deliberate
 * entry and approval confirmation before sending a copy to the editors via
 * `clients.queueAction` (kind videoRequest), never back to ClickUp.
 *
 * Aziz, 2026-09-18: no AI scripting studio, he writes with his own LLM; the
 * cockpit's job is to keep what was made and make the hand-off one click.
 */

/** Finished, as the board spells it. Cancelled is not finished. */
const FINISHED = new Set(["complete", "closed", "done", "live 🚀"]);

export const list = authenticatedQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    await assertRole(ctx, "creative");
    const scope = await allowedClients(ctx);
    const cap = Math.max(1, Math.min(500, limit ?? 300));
    const tasks = await ctx.db.query("creativeTasks").collect();
    const drive = new Map<string, string | undefined>();
    for (const c of await ctx.db.query("clients").collect()) {
      drive.set(c.name, c.driveLink ?? c.driveFolder ?? undefined);
    }
    const rows = tasks
      .filter(
        t =>
          t.kind === "script" &&
          !t.parentId &&
          FINISHED.has((t.status ?? "").toLowerCase()) &&
          rowInScope(scope, t),
      )
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, cap)
      .map(t => ({
        taskId: t.taskId,
        name: t.name,
        url: t.url,
        status: t.status,
        client: t.client ?? null,
        otherClients: (t.clients ?? []).filter(n => n !== t.client),
        assignees: t.assignees,
        dueDate: t.dueDate ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        script: t.script ?? "",
        drive: t.client ? (drive.get(t.client) ?? null) : null,
      }));
    const clients = [
      ...new Set(rows.map(r => r.client).filter((c): c is string => !!c)),
    ].sort((a, b) => a.localeCompare(b));
    return { rows, clients };
  },
});
