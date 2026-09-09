import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { CF } from "./csmSync";
import { callTool, unwrap } from "./tools";
import { DEPARTMENT_LIST } from "./writeback";

const CLIENTS_LIST = "901816559981";
const CS_LIST = "901816723211";
/** The board's own intake field, so my tickets look like the form's tickets. */
const REQUEST_TYPE_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";

/**
 * Map the CSM's plain-language request onto the Request Type the team already uses.
 * Anything unmapped still creates a task, it just carries no type.
 */
const REQUEST_TYPE: Record<string, string> = {
  "Switch this campaign to a landing page": "Create Landing Page📊",
  "Add qualification questions to the lead form":
    "Add Custom Qualification Questions🙋",
  "Tracking / page is broken": "Missing Leads ❌",
  "Pause this client": "Client Pause Request ⏸️",
  "Relaunch this client": "Client Relaunch Request ⏯️",
  "Offboard this client": "Client Offboarding Request 🔴",
  "Client success management request": "Client Success Management Request 🙋‍♂️",
};

async function post(url: string, json_body: Record<string, unknown>) {
  return unwrap(await callTool("pd_clickup_proxy_post", { url, json_body }));
}

async function setField(taskId: string, fieldId: string, value: unknown) {
  await post(`https://api.clickup.com/api/v2/task/${taskId}/field/${fieldId}`, {
    value,
  });
}

async function optionId(
  fieldId: string,
  label: string,
  listId: string = CLIENTS_LIST,
): Promise<string | undefined> {
  const defs = unwrap(
    await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${listId}/field`,
    }),
  );
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const f = (defs?.fields ?? []).find((x: any) => x.id === fieldId);
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  return (f?.type_config?.options ?? []).find((o: any) => o.name === label)?.id;
}

function msAt(iso: string): number {
  return Date.parse(`${iso}T09:00:00+03:00`);
}

export const getDecision = internalQuery({
  args: { id: v.id("decisions") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getPlanItem = internalQuery({
  args: { id: v.id("planItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/**
 * One entry point for every CSM action. Writes the real field on the client's
 * ClickUp task, then leaves a comment that reads like a human wrote it, so the
 * task itself becomes the client's history.
 */
export const apply = internalAction({
  args: {
    decisionId: v.id("decisions"),
    clientTaskId: v.string(),
    clientName: v.string(),
    kind: v.string(),
    value: v.optional(v.string()),
    department: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const d = await ctx.runQuery(internal.csmWriteback.getDecision, {
      id: args.decisionId,
    });
    if (!d) return null;
    const today = new Date(Date.now() + 3 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    let ticketUrl: string | undefined;
    try {
      if (args.kind === "touchpoint" || args.kind === "call") {
        await setField(args.clientTaskId, CF.lastPoc, msAt(today));
        if (args.kind === "call")
          await setField(args.clientTaskId, CF.lastCall, msAt(today));
      } else if (args.kind === "booked" && args.value) {
        await setField(args.clientTaskId, CF.nextPoc, msAt(args.value));
      } else if (args.kind === "stage" && args.value) {
        const id = await optionId(CF.status, args.value);
        if (id) await setField(args.clientTaskId, CF.status, id);
      } else if (args.kind === "happiness" && args.value) {
        const id = await optionId(CF.happiness, args.value);
        if (id) await setField(args.clientTaskId, CF.happiness, id);
      }

      // A request for another team becomes a real task on that team's board.
      if (args.department) {
        const dept = DEPARTMENT_LIST[args.department];
        if (dept) {
          const created = await post(
            `https://api.clickup.com/api/v2/list/${dept.id}/task`,
            {
              name: `${args.clientName} — ${d.action}`,
              description: [
                `Requested by the CSM via the Client Success Cockpit.`,
                "",
                `Client: ${args.clientName}`,
                `Why: ${d.evidence}`,
                d.reason ? `Note: ${d.reason}` : "",
                `Client task: https://app.clickup.com/t/${args.clientTaskId}`,
              ]
                .filter(Boolean)
                .join("\n"),
              due_date: Date.now() + 2 * 86400000,
            },
          );
          ticketUrl = created?.url;
          const typeLabel = REQUEST_TYPE[d.action];
          if (created?.id && typeLabel) {
            const optId = await optionId(
              REQUEST_TYPE_FIELD,
              typeLabel,
              dept.id,
            );
            if (optId) await setField(created.id, REQUEST_TYPE_FIELD, optId);
          }
        }
      }

      const head =
        args.kind === "call"
          ? "CALL LOGGED"
          : args.kind === "touchpoint"
            ? "TOUCHPOINT"
            : args.kind === "left"
              ? "LEFT AS IS"
              : args.department
                ? `SENT TO ${(DEPARTMENT_LIST[args.department]?.label ?? args.department).toUpperCase()}`
                : "UPDATED";
      const lines = [
        `🎯 Cockpit · ${head} — ${d.action}`,
        "",
        `Why: ${d.evidence}`,
        d.reason ? `Note: ${d.reason}` : "",
        d.snooze ? `Checked again: ${d.snooze}` : "",
        ticketUrl ? `Task created: ${ticketUrl}` : "",
        "Logged by the CSM via the Client Success Cockpit.",
      ].filter(Boolean);
      await post(
        `https://api.clickup.com/api/v2/task/${args.clientTaskId}/comment`,
        {
          comment_text: lines.join("\n"),
          notify_all: false,
        },
      );
      await ctx.runMutation(internal.writeback.markLogged, {
        id: args.decisionId,
        clickupTaskId: args.clientTaskId,
        clickupTaskUrl: ticketUrl,
      });
    } catch (e) {
      await ctx.runMutation(internal.writeback.markLogged, {
        id: args.decisionId,
        error: String(e).slice(0, 300),
      });
    }
    return null;
  },
});

export const getFeedback = internalQuery({
  args: { id: v.id("feedback") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const attachFeedback = internalMutation({
  args: { id: v.id("feedback"), taskUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, taskUrl }) => {
    await ctx.db.patch(id, { clickupTaskUrl: taskUrl });
    return null;
  },
});

/** A dashboard complaint becomes an owned task, not a lost message. */
export const fileIssue = internalAction({
  args: { id: v.id("feedback") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const fb = await ctx.runQuery(internal.csmWriteback.getFeedback, { id });
    if (!fb) return null;
    try {
      const created = await post(
        `https://api.clickup.com/api/v2/list/${CS_LIST}/task`,
        {
          name: `Cockpit fix — ${String(fb.text).slice(0, 60)}`,
          description: [
            "Reported from inside the Client Success Cockpit.",
            "",
            `Screen: ${fb.page}`,
            `Reported by: ${fb.email ?? "unknown"}`,
            "",
            fb.text,
          ].join("\n"),
          due_date: Date.now() + 86400000,
        },
      );
      await ctx.runMutation(internal.csmWriteback.attachFeedback, {
        id,
        taskUrl: created?.url ?? "",
      });
    } catch {
      // The report is stored either way; the task is a convenience.
    }
    return null;
  },
});

/** Plan Tomorrow Today → owned, dated tasks on the Client Success board. */
export const createPlanTask = internalAction({
  args: { id: v.id("planItems") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const item = await ctx.runQuery(internal.csmWriteback.getPlanItem, { id });
    if (!item) return null;
    try {
      const created = await post(
        `https://api.clickup.com/api/v2/list/${CS_LIST}/task`,
        {
          name: item.clientName
            ? `${item.clientName} — ${item.text}`
            : item.text,
          description: "Planned in the Client Success Cockpit end-of-day.",
          due_date: Date.now() + 86400000,
        },
      );
      await ctx.runMutation(internal.csmWriteback.attachPlanTask, {
        id,
        taskId: created?.id ?? "",
        taskUrl: created?.url ?? "",
      });
    } catch {
      // Left unattached; it stays visible on tomorrow's screen either way.
    }
    return null;
  },
});

export const attachPlanTask = internalMutation({
  args: { id: v.id("planItems"), taskId: v.string(), taskUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, taskId, taskUrl }) => {
    await ctx.db.patch(id, {
      confirmed: true,
      clickupTaskId: taskId || undefined,
      clickupTaskUrl: taskUrl || undefined,
    });
    return null;
  },
});
