import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { isCeoEmail } from "./gate";
import { rest } from "./sbWrite";

/**
 * Changes and bugs Aziz logs on the cockpit (2026-09-21), queued in
 * cockpit_feedback (Creative Triage). Only the founder addresses may read
 * or write here, not the wider CEO role: "only shows for me, Aziz". The
 * Deploy button marks the queued items as one dispatched batch; a scheduled
 * scan reads the table, fixes bugs on the next scan, builds changes once
 * dispatched, and writes its state back.
 */

const KINDS = ["change", "bug"] as const;
const STATUSES = [
  "queued",
  "dispatched",
  "in_progress",
  "done",
  "dismissed",
] as const;

/** The founder, or nothing. */
export const founder = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "").toLowerCase();
    if (!isCeoEmail(email))
      throw new Error("This part of the cockpit is Aziz's only.");
    return email;
  },
});

export const recordAudit = internalMutation({
  args: {
    action: v.string(),
    rowId: v.string(),
    what: v.string(),
    after: v.optional(v.any()),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      ...a,
      table: "cockpit_feedback",
      at: Date.now(),
    });
    return null;
  },
});

type Item = {
  id: number;
  kind: "change" | "bug";
  text: string;
  status: (typeof STATUSES)[number];
  batch: string | null;
  note: string | null;
  createdAt: number | null;
  dispatchedAt: number | null;
  doneAt: number | null;
};

const shape = (r: Record<string, unknown>): Item => ({
  id: Number(r.id),
  kind: r.kind === "bug" ? "bug" : "change",
  text: String(r.text ?? ""),
  status: (STATUSES.includes(r.status as never)
    ? r.status
    : "queued") as Item["status"],
  batch: r.batch ? String(r.batch) : null,
  note: r.note ? String(r.note) : null,
  createdAt: r.created_at ? Date.parse(String(r.created_at)) : null,
  dispatchedAt: r.dispatched_at ? Date.parse(String(r.dispatched_at)) : null,
  doneAt: r.done_at ? Date.parse(String(r.done_at)) : null,
});

/** The queue, newest first, done and dismissed items last. */
export const list = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.feedback.founder, { userId: ctx.userId });
    const rows =
      (await rest(
        "cockpit_feedback?select=*&order=created_at.desc&limit=200",
      )) ?? [];
    const items = rows.map(shape);
    const open = items.filter(
      i =>
        i.status === "queued" ||
        i.status === "dispatched" ||
        i.status === "in_progress",
    );
    const closed = items
      .filter(i => i.status === "done" || i.status === "dismissed")
      .slice(0, 40);
    return {
      open,
      closed,
      queued: open.filter(i => i.status === "queued").length,
    };
  },
});

export const add = authenticatedAction({
  args: { kind: v.union(...KINDS.map(k => v.literal(k))), text: v.string() },
  returns: v.any(),
  handler: async (ctx, a) => {
    const by: string = await ctx.runQuery(internal.ceo.feedback.founder, {
      userId: ctx.userId,
    });
    const text = a.text.trim().slice(0, 4000);
    if (text.length < 3) throw new Error("Say what to change, or what broke.");
    const rows = await rest("cockpit_feedback", {
      method: "POST",
      body: [{ kind: a.kind, text, created_by: by }],
      prefer: "return=representation",
    });
    const row = rows?.[0];
    await ctx.runMutation(internal.ceo.feedback.recordAudit, {
      action: "feedback.add",
      rowId: String(row?.id ?? ""),
      what: `Logged a ${a.kind}: ${text.slice(0, 120)}`,
      after: { kind: a.kind },
      by,
    });
    return row ? shape(row) : null;
  },
});

/** Withdraw an item, or put it back in the queue. */
export const setStatus = authenticatedAction({
  args: {
    id: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("dismissed"),
      v.literal("done"),
    ),
  },
  returns: v.any(),
  handler: async (ctx, a) => {
    const by: string = await ctx.runQuery(internal.ceo.feedback.founder, {
      userId: ctx.userId,
    });
    const now = new Date().toISOString();
    await rest(`cockpit_feedback?id=eq.${a.id}`, {
      method: "PATCH",
      body: {
        status: a.status,
        updated_at: now,
        ...(a.status === "done" ? { done_at: now } : {}),
      },
      prefer: "return=minimal",
    });
    await ctx.runMutation(internal.ceo.feedback.recordAudit, {
      action: "feedback.setStatus",
      rowId: String(a.id),
      what: `Marked item ${a.id} ${a.status}`,
      by,
    });
    return { ok: true };
  },
});

/** The Deploy button: every queued item becomes one dispatched batch. */
export const dispatch = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const by: string = await ctx.runQuery(internal.ceo.feedback.founder, {
      userId: ctx.userId,
    });
    const now = new Date();
    const batch = `batch-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    const rows =
      (await rest("cockpit_feedback?status=eq.queued&select=id,kind,text")) ??
      [];
    if (!rows.length) return { dispatched: 0, batch: null };
    await rest("cockpit_feedback?status=eq.queued", {
      method: "PATCH",
      body: {
        status: "dispatched",
        batch,
        dispatched_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      prefer: "return=minimal",
    });
    await ctx.runMutation(internal.ceo.feedback.recordAudit, {
      action: "feedback.dispatch",
      rowId: batch,
      what: `Dispatched ${rows.length} item${rows.length === 1 ? "" : "s"} as ${batch}: ${rows
        .map(r => `${r.kind}: ${String(r.text).slice(0, 60)}`)
        .join(" · ")
        .slice(0, 600)}`,
      after: { ids: rows.map(r => Number(r.id)) },
      by,
    });
    return { dispatched: rows.length, batch };
  },
});
