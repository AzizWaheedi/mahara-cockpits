import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  cleanDosDonts,
  clickupCall,
  commentsOn,
  DOS_DONTS_FIELD,
  NOTES_MARK,
  valueOn,
} from "./dosDonts";

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payloads
type Any = any;

/**
 * Client comment watch (Aziz, 2026-09-14). Every 15 minutes, read the comments
 * on each current client's ClickUp card (Clients - Mahara). Call summaries,
 * kickoff handoffs, client briefs and notes people type go to Hermes for a
 * short digest: what happened, next steps, what the client asked for, risks,
 * what the ads and the creative should act on, and any new do's and don'ts.
 * New rules are added to the client's Do's & Don'ts field in the clean format;
 * the digest shows in all three cockpits.
 *
 * Never sent: system logs (billing, touchpoints, ClickBot), the notes this
 * cockpit moves out of Do's & Don'ts, sales handoffs (personal details) and
 * research reports (background, not the client speaking).
 */

const CLIENTS_LIST = "901816559981";
const NOT_CURRENT = ["stopped", "sales team to contact"];
/** On the first scan, only comments this recent get a digest. */
const BACKFILL_DAYS = 21;

const list = { type: "array", items: { type: "string" } };
export const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    nextSteps: list,
    clientRequests: list,
    risks: list,
    forAds: list,
    forCreative: list,
    dos: list,
    donts: list,
  },
  required: [
    "summary",
    "nextSteps",
    "clientRequests",
    "risks",
    "forAds",
    "forCreative",
    "dos",
    "donts",
  ],
};

const KIND_LABEL: Record<string, string> = {
  call: "a call summary",
  kickoff: "a kickoff handoff or onboarding form",
  brief: "a client brief",
  note: "a comment someone typed",
};

/** What a comment is, from its text and author. "skip" is never digested. */
export function kindOf(text: string, by: string): string {
  const t = text.trim();
  if (!t || t.startsWith(NOTES_MARK) || /clickbot/i.test(by)) return "skip";
  if (
    /^(BILLING_|🎯|🤖)/u.test(t) ||
    /Logged by the CSM via the Client Success Cockpit/i.test(t)
  )
    return "skip";
  if (/^\**\s*CLOSER\s*:?/i.test(t)) return "skip";
  if (/^\W*(Client Research Report|Market Intelligence Report)/i.test(t))
    return "skip";
  // Handoffs carry a "Call recording: Not provided" line, so they are matched
  // before calls.
  if (/KICKOFF HANDOFF|Kickoff form|Onboarding Form Answers/i.test(t))
    return "kickoff";
  if (
    /^\W*CALL RECORDING|fathom\.video\/share|To-?Do List|Next Steps from/i.test(
      t,
    )
  )
    return "call";
  if (/Master Client Brief/i.test(t)) return "brief";
  return t.length >= 40 ? "note" : "skip";
}

function statusOf(t: Any): string {
  const cf = (t.custom_fields ?? []).find(
    (f: Any) => f.name === "Client Status",
  );
  if (cf?.value === undefined || cf?.value === null) return "";
  const opts: Any[] = cf.type_config?.options ?? [];
  const hit = opts.find(o => o.id === cf.value || o.orderindex === cf.value);
  return String(hit?.name ?? "");
}

function digestPrompt(
  client: string,
  kind: string,
  at: number,
  by: string,
  text: string,
  current: string,
): string {
  return `You are reading one comment from the ClickUp card of Mahara Media's client "${client}". Mahara runs Meta lead-generation ads for construction, architecture, interior design and contracting firms in the Gulf. The team is a media buyer (Meta campaigns), a creative director (scripts and videos) and a client success manager.

The comment is ${KIND_LABEL[kind] ?? "a comment"}, posted ${new Date(at).toISOString().slice(0, 10)} by ${by || "someone"}:
---
${text.slice(0, 12000)}
---

The client's current Do's & Don'ts:
${current || "(none yet)"}

Return JSON matching the schema:
- summary: 1 to 3 plain sentences on what this comment says happened or was agreed. Empty string if nothing useful.
- nextSteps: short lines, each starting with who owns it, "Mahara:" or "Client:".
- clientRequests: what the client explicitly asked for.
- risks: anything that threatens the account (unhappy client, payment, lead quality, delays).
- forAds: what the media buyer should act on (targeting, budget, platforms, offer, lead forms, lead quality).
- forCreative: what the creative director should act on (scripts, videos, footage, approvals, brand look).
- dos and donts: rules for how Mahara markets this client: who to target or exclude, what to say or never say, what to promise or not, how the ads and videos should look, how to handle their leads. Each one must be stated in the comment itself, lasting, and not already covered by the current Do's & Don'ts. Never payment or contract terms, setup tasks, one-off to-dos, or anything you inferred. Short imperative lines, don'ts start with "Don't", no source in the text. When in doubt, leave it out.

Rules: use only what the comment says, never guess or fill gaps. Nothing about other clients. No phone numbers, emails, or names of leads. Plain English, no em dashes. Empty arrays when there is nothing.`;
}

export const seenIds = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async ctx =>
    (await ctx.db.query("clientComments").collect()).map(r => r.commentId),
});

export const record = internalMutation({
  args: {
    taskId: v.string(),
    clientName: v.string(),
    commentId: v.string(),
    at: v.number(),
    by: v.optional(v.string()),
    kind: v.string(),
    status: v.string(),
  },
  returns: v.id("clientComments"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clientComments")
      .withIndex("by_comment", q => q.eq("commentId", args.commentId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("clientComments", {
      ...args,
      syncedAt: Date.now(),
    });
  },
});

export const setJob = internalMutation({
  args: { id: v.id("clientComments"), jobId: v.id("aiJobs") },
  returns: v.null(),
  handler: async (ctx, { id, jobId }) => {
    await ctx.db.patch(id, { jobId });
    return null;
  },
});

/** Digests still waiting whose Hermes job gave up: mark them, so they stop counting as pending. */
export const reconcile = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    const waiting = await ctx.db
      .query("clientComments")
      .withIndex("by_status", q => q.eq("status", "queued"))
      .collect();
    let failed = 0;
    for (const r of waiting) {
      const job = r.jobId ? await ctx.db.get(r.jobId) : null;
      if (!job || job.status === "failed") {
        await ctx.db.patch(r._id, { status: "failed", syncedAt: Date.now() });
        failed++;
      }
    }
    return failed;
  },
});

export const get = internalQuery({
  args: { id: v.id("clientComments") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const markApplied = internalMutation({
  args: { id: v.id("clientComments"), rulesAdded: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, rulesAdded }) => {
    await ctx.db.patch(id, { rulesAdded, appliedAt: Date.now() });
    return null;
  },
});

/** The newest digests per client card, for the three cockpits. */
export const latestByTask = internalQuery({
  args: { perTask: v.optional(v.number()), days: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { perTask, days }) => {
    const since = Date.now() - (days ?? 60) * 86_400_000;
    const rows = await ctx.db
      .query("clientComments")
      .withIndex("by_status", q => q.eq("status", "done").gte("at", since))
      .collect();
    rows.sort((a, b) => b.at - a.at);
    const out: Record<string, Any[]> = {};
    for (const r of rows) {
      const d = r.digest ?? {};
      const strings = (x: unknown) =>
        Array.isArray(x)
          ? x.map(String).filter(s => s.trim())
          : ([] as string[]);
      const item = {
        clientName: r.clientName,
        taskId: r.taskId,
        at: r.at,
        kind: r.kind,
        summary: String(d.summary ?? "").trim(),
        nextSteps: strings(d.nextSteps),
        clientRequests: strings(d.clientRequests),
        risks: strings(d.risks),
        forAds: strings(d.forAds),
        forCreative: strings(d.forCreative),
      };
      const empty =
        !item.summary &&
        !item.nextSteps.length &&
        !item.clientRequests.length &&
        !item.risks.length &&
        !item.forAds.length &&
        !item.forCreative.length;
      if (empty) continue;
      const bucket = out[r.taskId] ?? [];
      if (bucket.length < (perTask ?? 3)) bucket.push(item);
      out[r.taskId] = bucket;
    }
    return out;
  },
});

/** Read every current client card's comments; queue a digest for each new one worth reading. */
export const scan = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const failed: number = await ctx.runMutation(
      internal.commentWatch.reconcile,
      {},
    );
    const tasks: Any[] = [];
    for (let page = 0; page < 10; page++) {
      const r = await clickupCall(
        "GET",
        `list/${CLIENTS_LIST}/task?include_closed=true&page=${page}`,
      );
      const batch: Any[] = r?.tasks ?? [];
      tasks.push(...batch);
      if (batch.length < 100) break;
    }
    const current = tasks.filter(t => {
      const status = statusOf(t).trim().toLowerCase();
      return (
        status &&
        !NOT_CURRENT.includes(status) &&
        !/playing account/i.test(String(t.name))
      );
    });
    const seenList: string[] = await ctx.runQuery(
      internal.commentWatch.seenIds,
      {},
    );
    const seen = new Set(seenList);
    const firstScan = seen.size === 0;
    const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
    let queued = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const t of current) {
      let comments: Any[] = [];
      try {
        comments = await commentsOn(t.id);
      } catch (e) {
        errors.push(`${t.name}: ${String(e).slice(0, 120)}`);
        continue;
      }
      for (const c of comments) {
        const commentId = String(c.id);
        if (seen.has(commentId)) continue;
        const text = String(c.comment_text ?? "");
        const by = String(c.user?.username ?? c.user?.email ?? "");
        const at = Number(c.date) || Date.now();
        const kind = kindOf(text, by);
        const digest = kind !== "skip" && (!firstScan || at >= cutoff);
        const id: Id<"clientComments"> = await ctx.runMutation(
          internal.commentWatch.record,
          {
            taskId: t.id,
            clientName: String(t.name),
            commentId,
            at,
            by,
            kind,
            status: digest ? "queued" : "skipped",
          },
        );
        if (!digest) {
          skipped++;
          continue;
        }
        const field = (t.custom_fields ?? []).find(
          (f: Any) => f.id === DOS_DONTS_FIELD,
        );
        const rules = cleanDosDonts(
          typeof field?.value === "string" ? field.value : "",
        ).text;
        const jobId: Id<"aiJobs"> = await ctx.runMutation(
          internal.askAi.enqueue,
          {
            kind: "comment_digest",
            refId: id,
            prompt: digestPrompt(String(t.name), kind, at, by, text, rules),
            schema: DIGEST_SCHEMA,
          },
        );
        await ctx.runMutation(internal.commentWatch.setJob, { id, jobId });
        queued++;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return {
      clients: current.length,
      queued,
      skipped,
      failedDigests: failed,
      errors,
    };
  },
});

/**
 * A digest came back: add its new rules to the client's Do's & Don'ts, in the
 * clean format, only if nobody edited the field meanwhile (one retry).
 */
const STOP = new Set(
  "the and for with not are but from that this their them they into than any all only each per its our who what when how".split(
    " ",
  ),
);
function words(rule: string): Set<string> {
  return new Set(
    rule
      .replace(/\([^)]*\)\s*$/, "")
      .toLowerCase()
      .replace(/don't|do not|never/g, "")
      .split(/[^a-z0-9\u0600-\u06ff]+/)
      .filter(w => w.length > 2 && !STOP.has(w)),
  );
}
/**
 * Two digests of the same client can land together, each written against the
 * rules as they were before the other one. A new rule that mostly repeats an
 * existing line (most of its words already there) is dropped.
 */
function nearDuplicate(rule: string, existing: string[]): boolean {
  const a = words(rule);
  if (!a.size) return true;
  return existing.some(line => {
    const b = words(line);
    if (!b.size) return false;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.7;
  });
}

export const apply = internalAction({
  args: { id: v.id("clientComments") },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Any> => {
    const row: Any = await ctx.runQuery(internal.commentWatch.get, { id });
    const d = row?.digest;
    if (!row || !d) return { applied: false };
    const lines = (x: unknown) =>
      Array.isArray(x) ? x.map(String).filter(s => s.trim()) : [];
    const day = new Date(row.at).toISOString().slice(0, 10);
    const label: Record<string, string> = {
      call: "Call",
      kickoff: "Onboarding",
      brief: "Client brief",
    };
    const source = `${label[row.kind] ?? "ClickUp comment"}, ${day}`;
    const tag = (s: string) => `${s.trim().replace(/[.\s]+$/, "")} (${source})`;
    const current = (await valueOn(row.taskId))
      .split("\n")
      .filter(l => l.startsWith("- "))
      .map(l => l.slice(2));
    const dos = lines(d.dos)
      .filter(r => !nearDuplicate(r, current))
      .map(tag);
    const donts = lines(d.donts)
      .filter(r => !nearDuplicate(r, current))
      .map(tag);
    let added = 0;
    if (dos.length || donts.length) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = await valueOn(row.taskId);
        const merged = cleanDosDonts(
          [
            before,
            "DO",
            ...dos.map(s => `- ${s}`),
            "DON'T",
            ...donts.map(s => `- ${s}`),
          ].join("\n"),
        ).text;
        const was = cleanDosDonts(before).text;
        if (merged === was) break;
        if ((await valueOn(row.taskId)).trim() !== before.trim()) continue;
        await clickupCall(
          "POST",
          `task/${row.taskId}/field/${DOS_DONTS_FIELD}`,
          {
            value: merged,
          },
        );
        added =
          merged.split("\n").filter(l => l.startsWith("- ")).length -
          was.split("\n").filter(l => l.startsWith("- ")).length;
        break;
      }
    }
    await ctx.runMutation(internal.commentWatch.markApplied, {
      id,
      rulesAdded: Math.max(0, added),
    });
    return { applied: true, rulesAdded: added };
  },
});

/** Take a digested comment off the dashboards (for noise that slipped through). */
export const dismiss = internalMutation({
  args: { commentId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { commentId }) => {
    const row = await ctx.db
      .query("clientComments")
      .withIndex("by_comment", q => q.eq("commentId", commentId))
      .first();
    if (!row) return false;
    await ctx.db.patch(row._id, { status: "skipped", syncedAt: Date.now() });
    return true;
  },
});

export const setKind = internalMutation({
  args: { id: v.id("clientComments"), kind: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, kind }) => {
    await ctx.db.patch(id, { kind });
    return null;
  },
});

export const rowsForTasks = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("clientComments").collect())
      .filter(r => r.kind !== "skip")
      .map(r => ({
        id: r._id,
        taskId: r.taskId,
        commentId: r.commentId,
        kind: r.kind,
      })),
});

/** Re-label recorded comments with the current rules (read from ClickUp again). */
export const reclassify = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const rows: Any[] = await ctx.runQuery(
      internal.commentWatch.rowsForTasks,
      {},
    );
    const changes: string[] = [];
    for (const taskId of [...new Set(rows.map(r => r.taskId))]) {
      const comments = await commentsOn(taskId);
      for (const r of rows.filter(x => x.taskId === taskId)) {
        const c = comments.find(x => String(x.id) === r.commentId);
        if (!c) continue;
        const kind = kindOf(
          String(c.comment_text ?? ""),
          String(c.user?.username ?? ""),
        );
        if (kind !== r.kind) {
          await ctx.runMutation(internal.commentWatch.setKind, {
            id: r.id,
            kind,
          });
          changes.push(`${r.commentId}: ${r.kind} -> ${kind}`);
        }
      }
    }
    return changes;
  },
});

/** Digest jobs Hermes has not answered yet get the current rule wording. */
export const refreshPrompts = internalMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.number(),
  handler: async (ctx, { from, to }) => {
    let n = 0;
    for (const status of ["queued", "claimed"]) {
      const jobs = await ctx.db
        .query("aiJobs")
        .withIndex("by_status", q => q.eq("status", status))
        .collect();
      for (const j of jobs)
        if (j.kind === "comment_digest" && j.prompt.includes(from)) {
          await ctx.db.patch(j._id, { prompt: j.prompt.replace(from, to) });
          n++;
        }
    }
    return n;
  },
});
