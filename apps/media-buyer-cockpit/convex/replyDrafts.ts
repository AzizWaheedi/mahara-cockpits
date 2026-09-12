import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { bridge } from "./comms";
import { googleAccessToken } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: thread rows and doc payloads
type Any = any;

/**
 * A recommended reply for every WhatsApp thread waiting on us, written by
 * Hermes from the Client Communication SOP and the thread itself. Aziz,
 * 2026-09-12: "the recommended reply is based on the client communication
 * SOP … I can send it straight from there."
 */

export const SOP_DOC = "10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY";
const SOP_MAX_AGE_H = 24;
const SOP_CHARS = 14000;

export const cachedDoc = internalQuery({
  args: { docId: v.string() },
  returns: v.any(),
  handler: async (ctx, { docId }) =>
    await ctx.db
      .query("docCache")
      .withIndex("by_doc", q => q.eq("docId", docId))
      .first(),
});

export const saveDoc = internalMutation({
  args: { docId: v.string(), title: v.optional(v.string()), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("docCache")
      .withIndex("by_doc", q => q.eq("docId", args.docId))
      .first();
    if (old) await ctx.db.patch(old._id, { ...args, at: Date.now() });
    else await ctx.db.insert("docCache", { ...args, at: Date.now() });
    return null;
  },
});

/** The SOP as plain text, from Google Docs, at most a day old. */
async function sopText(ctx: Any): Promise<string> {
  const cached = await ctx.runQuery(internal.replyDrafts.cachedDoc, {
    docId: SOP_DOC,
  });
  if (cached && Date.now() - cached.at < SOP_MAX_AGE_H * 3600_000)
    return cached.text;
  const token = await googleAccessToken();
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${SOP_DOC}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const doc: Any = await res.json();
  if (!res.ok) {
    if (cached) return cached.text;
    throw new Error(`SOP doc: ${doc?.error?.message ?? res.status}`);
  }
  const lines: string[] = [];
  for (const el of doc.body?.content ?? []) {
    const t = (el.paragraph?.elements ?? [])
      .map((e: Any) => e.textRun?.content ?? "")
      .join("")
      .trim();
    if (t) lines.push(t);
  }
  const text = lines.join("\n");
  await ctx.runMutation(internal.replyDrafts.saveDoc, {
    docId: SOP_DOC,
    title: doc.title,
    text,
  });
  return text;
}

export const draftFor = internalQuery({
  args: { chatId: v.string() },
  returns: v.any(),
  handler: async (ctx, { chatId }) =>
    await ctx.db
      .query("replyDrafts")
      .withIndex("by_chat", q => q.eq("chatId", chatId))
      .order("desc")
      .first(),
});

export const saveDraft = internalMutation({
  args: {
    chatId: v.string(),
    lastAt: v.number(),
    jobId: v.optional(v.string()),
    status: v.string(),
    draft: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("replyDrafts")
      .withIndex("by_chat", q => q.eq("chatId", args.chatId))
      .order("desc")
      .first();
    if (old && old.lastAt === args.lastAt)
      await ctx.db.patch(old._id, { ...args, at: Date.now() });
    else await ctx.db.insert("replyDrafts", { ...args, at: Date.now() });
    return null;
  },
});

const SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" } },
  required: ["reply"],
};

function prompt(sop: string, t: Any, profile: Any): string {
  const turns = (t.recent ?? [])
    .map((m: Any) => `${m.fromMe ? "Mahara" : m.who || "Client"}: ${m.text}`)
    .join("\n");
  return `You draft WhatsApp replies for Mahara Media's client success manager, following the Client Communication SOP below. Mahara is a marketing agency for construction and design businesses in the Gulf.

The SOP (templates and rules):
${sop.slice(0, SOP_CHARS)}

Thread: "${t.name}"${t.clientName ? ` (client: ${t.clientName})` : ""}
${profile ? `What the cockpit knows about this client (JSON): ${JSON.stringify(profile).slice(0, 2500)}` : ""}

Recent messages, oldest first:
${turns}

Write the reply Mahara should send now, as one WhatsApp message.
- Pick the SOP template that fits the situation and adapt it to what was actually said; do not paste a template blindly.
- Same language as the client's last message (Gulf Arabic if they wrote Arabic).
- Warm, direct, specific. Give them something: an answer, a next step, a date. "Just checking in" is not a reply.
- If their message is a concern, the SOP says call them: then the reply acknowledges it and promises the call, with a time.
- No em dashes. No sign-off with a name unless the SOP template has one.
- Never invent numbers or promises the context does not support.

Return JSON: {"reply": "<the message>"}`;
}

/** Queue a draft for every waiting thread whose last message has no draft yet. */
export const queue = internalAction({
  args: { threads: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, { threads }) => {
    let queued = 0;
    let have = 0;
    if (!threads.length) return { queued, have };
    const sop = await sopText(ctx);
    for (const t of threads) {
      const existing = await ctx.runQuery(internal.replyDrafts.draftFor, {
        chatId: t.chatId,
      });
      if (existing && existing.lastAt === t.lastAt) {
        have++;
        continue;
      }
      let profile: Any;
      if (t.clientName) {
        try {
          profile = await bridge("csm", "profileFor", {
            clientName: t.clientName,
          });
          if (profile)
            profile = {
              stage: profile.stage,
              liveDays: profile.liveDays,
              month: profile.performance?.month,
              gaps: (profile.gaps ?? []).map((g: Any) => g.label),
              brief: profile.callsBrief,
            };
        } catch {
          profile = undefined;
        }
      }
      const jobId: string = await ctx.runMutation(internal.askAi.enqueue, {
        kind: "reply_draft",
        refId: `reply:${t.chatId}:${t.lastAt}`,
        prompt: prompt(sop, t, profile),
        schema: SCHEMA,
      });
      await ctx.runMutation(internal.replyDrafts.saveDraft, {
        chatId: t.chatId,
        lastAt: Number(t.lastAt),
        jobId: String(jobId),
        status: "queued",
      });
      await ctx.runMutation(internal.hermesDrain.addRelay, {
        app: "wadraft",
        messageId: `${t.chatId}|${t.lastAt}`,
        jobId: String(jobId),
      });
      queued++;
    }
    return { queued, have };
  },
});

/** Hermes answered: keep the draft and hand it to both cockpits. */
export const deliver = internalAction({
  args: { chatId: v.string(), lastAt: v.number(), draft: v.string() },
  returns: v.null(),
  handler: async (ctx, { chatId, lastAt, draft }) => {
    await ctx.runMutation(internal.replyDrafts.saveDraft, {
      chatId,
      lastAt,
      status: "done",
      draft,
    });
    for (const app of ["csm", "creative"] as const) {
      try {
        await bridge(app, "storeReplyDraft", {
          chatId,
          draft,
          draftAt: Date.now(),
        });
      } catch (e) {
        console.warn(`draft to ${app}: ${String(e).slice(0, 100)}`);
      }
    }
    return null;
  },
});
