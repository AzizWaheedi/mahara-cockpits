import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import {
  PORTAL_FORM_URL,
  PORTAL_LIST_ID,
  type PortalTask,
  portalTask,
  sortPortalTasks,
  TEAM_SPACE_ID,
  tagFor,
} from "./portalTasksCore";
import { allowedClients, assertRole } from "./roles";
import { callTool } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: ClickUp bodies are untyped
type Any = any;

/**
 * The client's Mahara OS portal tasks for the CSM (portalTasksCore.ts): the
 * tag to pick in ClickUp's form and the tasks already on the Client Portal
 * Tasks list. Read only; the form itself creates the tasks.
 */

/** The client, if this seat may see them: role, revoked access and the portal's client scope. */
export const client = internalQuery({
  args: { userId: v.id("users"), taskId: v.string() },
  returns: v.any(),
  handler: async (ctx, a) => {
    const auth = { ...ctx, userId: a.userId };
    await assertRole(auth);
    const user = await ctx.db.get(a.userId);
    const member = user?.email
      ? await ctx.db
          .query("portalMembers")
          .withIndex("by_email", q =>
            q.eq("email", String(user.email).trim().toLowerCase()),
          )
          .unique()
      : null;
    if (member?.revokedAt) throw new Error("Your cockpit access has ended.");
    const c = await ctx.db
      .query("clients")
      .withIndex("by_taskId", q => q.eq("taskId", a.taskId))
      .unique();
    const scope = await allowedClients(auth);
    if (!c || (scope && !scope.has(c.name.toLowerCase())))
      throw new Error("That client is not on your list.");
    return { name: c.name };
  },
});

const clickup = (path: string): Promise<Any> =>
  callTool("pd_clickup_proxy_get", {
    url: `https://api.clickup.com/api/v2/${path}`,
  });

export const forClient = authenticatedAction({
  args: { taskId: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    a,
  ): Promise<{
    clientName: string;
    tag: string | null;
    formUrl: string;
    tasks: PortalTask[];
  }> => {
    try {
      const c = await ctx.runQuery(internal.portalTasks.client, {
        userId: ctx.userId,
        taskId: a.taskId,
      });
      const tags = ((await clickup(`space/${TEAM_SPACE_ID}/tag`))?.tags ??
        []) as { name?: string }[];
      const tag = tagFor(c.name, tags);
      const tasks: PortalTask[] = [];
      if (tag)
        for (let page = 0; page < 5; page++) {
          const q = new URLSearchParams({
            page: String(page),
            include_closed: "true",
            subtasks: "true",
          });
          q.append("tags[]", tag);
          const r = await clickup(`list/${PORTAL_LIST_ID}/task?${q}`);
          const batch = (r?.tasks ?? []) as Any[];
          tasks.push(...batch.map(portalTask));
          if (r?.last_page !== false || batch.length === 0) break;
        }
      return {
        clientName: c.name,
        tag,
        formUrl: PORTAL_FORM_URL,
        tasks: sortPortalTasks(tasks),
      };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      throw new ConvexError({
        message: /CLICKUP_API_TOKEN is not set/.test(raw)
          ? "ClickUp cannot be read: CLICKUP_API_TOKEN is not set on the client success deployment. Ask Aziz."
          : raw
              .replace(/^[\s\S]*?Uncaught Error: /, "")
              .split("\n")[0]
              .slice(0, 300) ||
            "The portal tasks could not be read. Try again in a minute.",
      });
    }
  },
});
