import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { bridge } from "./comms";
import { callTool } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: chat rows and job results
type Any = any;

/**
 * Relays every cockpit's chat to Hermes and brings his answers back.
 *
 * Each user message becomes an aiJobs row of kind "chat" (Hermes polls those
 * through /askai). The prompt carries the cockpit's role, what the screen
 * knew when the question was asked, and the last turns of the thread. When
 * the job is done, the reply is written into the same thread. Runs every 20
 * seconds so it feels like a conversation, not a ticket.
 */

const CHAT_KIND = "chat";
const CHAT_SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" } },
  required: ["reply"],
};
const GIVE_UP_MIN = 30;

type App = "local" | "csm" | "creative";

const ROLE: Record<App, string> = {
  local:
    "You are Hermes, the assistant inside the Media Buyer Cockpit at Mahara Media, a marketing agency for construction and design businesses in the Gulf. You are talking to the media buyer (Nada, or Aziz the founder). You know the campaigns, spend, leads, cost per lead, bookings, and the rules of the cockpit.",
  csm: "You are Hermes, the assistant inside the Client Success Cockpit at Mahara Media, a marketing agency for construction and design businesses in the Gulf. You are talking to the client success manager (Abdulelah, or Aziz the founder). You know each client's stage, cadence, numbers from their stat sheet, lost-lead reasons, recorded calls, and the CSM SOP.",
  creative:
    "You are Hermes, the assistant inside the Creative Director Cockpit at Mahara Media, a marketing agency for construction and design businesses in the Gulf. You are talking to the creative director (Sabry, or Aziz the founder). You know each client's brand DNA, offer, scripts, video pipeline, what works in the ads, and the touchpoint rule.",
};

const RULES = `
How to answer:
- Use only what is in the context and the conversation. If something is not there, say you do not have it and name the screen or source that does.
- Be direct and specific, like a sharp colleague, in plain English (or Gulf Arabic if the question is in Arabic).
- Numbers: quote them exactly as given. All money in USD. Never invent a figure.
- Never use an em dash or an en dash. A comma or a full stop.
- Keep it short: a few sentences, or a short list when there are several items. No preamble, no sign-off.
- You cannot take actions yourself; when the right move is a button in the cockpit or a step in ClickUp, say which one.`;

function prompt(app: App, m: Any): string {
  const turns = (m.history ?? [])
    .map((h: Any) => `${h.role === "user" ? "User" : "Hermes"}: ${h.text}`)
    .join("\n");
  return [
    ROLE[app],
    RULES,
    m.clientName ? `\nThe question is about the client "${m.clientName}".` : "",
    m.page ? `Screen: ${m.page}` : "",
    "\nContext the cockpit attached (JSON or notes):",
    String(m.context ?? "(none)").slice(0, 6000),
    turns ? `\nConversation so far:\n${turns}` : "",
    `\nUser: ${m.text}`,
    '\nReturn JSON: {"reply": "<your answer>"}',
  ]
    .filter(Boolean)
    .join("\n");
}

async function pendingFor(ctx: Any, app: App): Promise<Any[]> {
  if (app === "local") return await ctx.runQuery(internal.hermes.pending, {});
  return (await bridge(app, "chatPending", {})) ?? [];
}
async function markSent(ctx: Any, app: App, id: string, jobId: string) {
  if (app === "local")
    return await ctx.runMutation(internal.hermes.markSent, { id, jobId });
  return await bridge(app, "chatSent", { id, jobId });
}
async function markReading(ctx: Any, app: App, id: string) {
  if (app === "local")
    return await ctx.runMutation(internal.hermes.markReading, { id });
  return await bridge(app, "chatReading", { id });
}
async function answer(
  ctx: Any,
  app: App,
  id: string,
  text?: string,
  error?: string,
) {
  if (app === "local")
    return await ctx.runMutation(internal.hermes.answer, { id, text, error });
  return await bridge(app, "chatAnswer", { id, text, error });
}

/** Relay rows: which chat message is waiting on which job. */
export const openRelays = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx =>
    (await ctx.db.query("chatRelay").collect()).filter(r => !r.deliveredAt),
});

export const addRelay = internalMutation({
  args: { app: v.string(), messageId: v.string(), jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("chatRelay", { ...args, at: Date.now() });
    return null;
  },
});

export const markRelayReading = internalMutation({
  args: { id: v.id("chatRelay") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { readingAt: Date.now() });
    return null;
  },
});

export const closeRelay = internalMutation({
  args: { id: v.id("chatRelay") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { deliveredAt: Date.now() });
    return null;
  },
});

export const jobState = internalQuery({
  args: { jobId: v.string() },
  returns: v.any(),
  handler: async (ctx, { jobId }) => {
    const j = await ctx.db.get(jobId as Any);
    return j
      ? {
          status: (j as Any).status,
          result: (j as Any).result,
          error: (j as Any).error,
          createdAt: (j as Any).createdAt,
          claimedAt: (j as Any).claimedAt,
        }
      : null;
  },
});

export const run = internalAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    let relayed = 0;
    let delivered = 0;
    const errors: string[] = [];
    // 1. New questions → Hermes's queue.
    for (const app of ["local", "csm", "creative"] as App[]) {
      let rows: Any[] = [];
      try {
        rows = await pendingFor(ctx, app);
      } catch (e) {
        errors.push(`${app} pending: ${String(e).slice(0, 120)}`);
        continue;
      }
      for (const m of rows) {
        try {
          const jobId: string = await ctx.runMutation(internal.askAi.enqueue, {
            kind: CHAT_KIND,
            refId: `${app}:${m.id}`,
            prompt: prompt(app, m),
            schema: CHAT_SCHEMA,
          });
          await ctx.runMutation(internal.hermesDrain.addRelay, {
            app,
            messageId: String(m.id),
            jobId: String(jobId),
          });
          await markSent(ctx, app, String(m.id), String(jobId));
          relayed++;
        } catch (e) {
          errors.push(`${app} relay: ${String(e).slice(0, 120)}`);
        }
      }
    }
    // 2. Answers → back to the thread they came from.
    const open: Any[] = await ctx.runQuery(internal.hermesDrain.openRelays, {});
    for (const r of open) {
      const job = await ctx.runQuery(internal.hermesDrain.jobState, {
        jobId: r.jobId,
      });
      if (!job) continue;
      const app = r.app as App;
      const waitedMin = (Date.now() - Number(job.createdAt ?? r.at)) / 60_000;
      let text: string | undefined;
      let error: string | undefined;
      if (job.status === "done") {
        const res =
          typeof job.result === "string" ? safeParse(job.result) : job.result;
        text = String(
          res?.reply ?? res?.text ?? (typeof res === "string" ? res : ""),
        ).trim();
        if (!text) error = "Hermes answered with nothing";
      } else if (job.status === "failed") {
        error = `Hermes could not answer: ${String(job.error ?? "").slice(0, 160)}`;
      } else if (waitedMin > GIVE_UP_MIN) {
        error = `No answer from Hermes after ${GIVE_UP_MIN} minutes. Ask again, or check that he is running.`;
      } else {
        // Claimed but not answered yet: the panel shows "typing".
        if (job.claimedAt && !r.readingAt) {
          try {
            await markReading(ctx, app, r.messageId);
            await ctx.runMutation(internal.hermesDrain.markRelayReading, {
              id: r._id,
            });
          } catch (e) {
            errors.push(`${app} reading: ${String(e).slice(0, 120)}`);
          }
        }
        continue;
      }
      try {
        if ((r.app as string) === "fix") {
          // Hermes's report on a flagged error goes to Aziz, not to a thread.
          const res =
            typeof job.result === "string" ? safeParse(job.result) : job.result;
          const line = res?.status
            ? `${String(res.status).replace("_", " ")}: ${res.summary ?? ""}${Array.isArray(res.changes) && res.changes.length ? `\n${res.changes.map((c: Any) => `• ${c}`).join("\n")}` : ""}`
            : (error ?? text ?? "");
          await callTool("coworker_send_slack_message", {
            channel_id: "D0B21PZHDH9",
            text: `Hermes on "${r.messageId}"\n${line}`.slice(0, 3000),
          });
        } else {
          await answer(ctx, app, r.messageId, text, error);
        }
        await ctx.runMutation(internal.hermesDrain.closeRelay, { id: r._id });
        delivered++;
      } catch (e) {
        errors.push(`${app} deliver: ${String(e).slice(0, 120)}`);
      }
    }
    if (relayed || delivered || errors.length)
      console.log(
        `hermes chat: ${relayed} relayed, ${delivered} delivered${errors.length ? ` · ${errors.join(" | ")}` : ""}`,
      );
    return { relayed, delivered, errors };
  },
});

function safeParse(s: string): Any {
  try {
    return JSON.parse(s);
  } catch {
    return { reply: s };
  }
}
