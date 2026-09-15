import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

type Any = any;

/** Digests older than this are not the client's "latest update" any more. */
const DIGEST_DAYS = 60;

/** A ClickUp task id from a card url (https://app.clickup.com/t/<id>). */
const taskIdFromUrl = (url: unknown): string | null =>
  /\/t\/([A-Za-z0-9_-]+)/.exec(String(url ?? ""))?.[1] ?? null;

/**
 * Digest summaries are written by Hermes from card comments. Keep the
 * summary only, and mask anything that looks like an email or a phone
 * number in case a comment quoted one.
 */
const SUMMARY_MAX = 280;
const cleanSummary = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const text = s
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, m =>
      // A date like 2026-09-14 is not a phone number.
      /^\d{4}-\d{1,2}-\d{1,2}$/.test(m) || m.replace(/\D/g, "").length < 8
        ? m
        : "[number]",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= SUMMARY_MAX) return text || null;
  // Cut on a word so the screen never shows half a word.
  const cut = text.slice(0, SUMMARY_MAX - 3);
  const space = cut.lastIndexOf(" ");
  return `${space > 200 ? cut.slice(0, space) : cut}...`;
};

/**
 * Convex tables the CEO "clients" adapter reads, in one bounded query.
 *
 * clients (the csmSync roster, about 50 rows), clientLinks (about 60) and
 * campaigns (on-board campaigns, a few dozen) are rebuilt by the sync, so a
 * capped take is the whole table. Comments come through by_status with a
 * date bound. Only the fields the section needs leave this query: never
 * campaigns.lost (lead notes), commitments, loose ends or raw comments.
 */
export const load = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const clients = (await ctx.db.query("clients").take(1000)).map(c => ({
      taskId: c.taskId,
      name: c.name,
      stage: c.stage,
      bucket: c.bucket ?? null,
      csm: c.csmAssigned ?? null,
      service: c.service ?? null,
      happiness: c.happiness ?? null,
      silentDays: c.silentDays ?? null,
      lastPoc: c.lastPoc ?? null,
      lastCall: c.lastCall ?? null,
      paymentDate: c.paymentDate ?? null,
      paymentDue: c.paymentDue ?? null,
      extendedUntil: c.extendedUntil ?? null,
      defcon: c.defcon ?? null,
      syncedAt: c.syncedAt,
    }));

    // Names and aliases per client card, so a campaign's client label can be
    // matched to the card even when it is spelled differently.
    const links = (await ctx.db.query("clientLinks").take(1000))
      .map(l => ({
        name: l.name,
        aliases: l.aliases,
        taskId: taskIdFromUrl(l.url),
      }))
      .filter(l => l.taskId);

    const campaigns = (await ctx.db.query("campaigns").take(500))
      .filter(c => c.onBoard && !c.internal)
      .map(c => ({
        clientName: c.clientName ?? null,
        clientTag: c.clientTag ?? null,
        tags: c.tags ?? [],
        spend7d: Number(c.spend7d ?? 0),
        leads7d: Number(c.leads7d ?? 0),
        // Set only when the sync could read the client's GHL.
        bookings7d: (c.bookings7d as number | undefined) ?? null,
        syncedAt: c.syncedAt,
      }));

    // Newest digest with a summary per client card.
    const since = Date.now() - DIGEST_DAYS * 86_400_000;
    const latestUpdate: Record<string, { at: number; summary: string }> = {};
    const digests: Any[] = await ctx.db
      .query("clientComments")
      .withIndex("by_status", q => q.eq("status", "done").gte("at", since))
      .order("desc")
      .take(400);
    for (const r of digests) {
      if (latestUpdate[r.taskId]) continue;
      const summary = cleanSummary(r.digest?.summary);
      if (summary) latestUpdate[r.taskId] = { at: r.at, summary };
    }

    return { clients, links, campaigns, latestUpdate };
  },
});
