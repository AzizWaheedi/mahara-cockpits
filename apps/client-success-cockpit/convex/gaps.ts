import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertRole } from "./roles";

// biome-ignore lint/suspicious/noExplicitAny: profile blobs
type Any = any;

type Gap = { gap: string; label: string; fix: string };

/**
 * Data the cockpit cannot show for an active client, and why.
 *
 * The card is only as good as what ClickUp, the stat sheet, GHL and Fathom
 * hand over. Each row here is one missing input on one client, with the fix.
 * Queueing a row creates a task on the Client Success list so it gets done.
 */
export function gapsFor(client: Any, profile: Any | undefined): Gap[] {
  const gaps: Gap[] = [];
  if (!client.sheetLink) {
    gaps.push({
      gap: "sheet_link",
      label: "No stat sheet on the ClickUp card",
      fix: "Paste the client's stat sheet URL into the Sheet Link field on the client task.",
    });
  } else if (profile?.performance?.error) {
    gaps.push({
      gap: "sheet_access",
      label: "Stat sheet cannot be read",
      fix: `Share the sheet with claude@studied-handler-508106-m5.iam.gserviceaccount.com (viewer). Last error: ${String(profile.performance.error).slice(0, 120)}`,
    });
  }
  // The match lives on the profile as ghlName; `lost` is only filled when the
  // matched account actually has lost leads, so it says nothing about the match.
  // [Aziz, 2026-09-10: "a lot of it isn't true because there are GHL accounts matched"]
  if (!profile?.ghlName) {
    gaps.push({
      gap: "ghl",
      label: "GHL sub-account not readable: no token on the Client Data row",
      fix: "In the database sheet, Client Data tab, paste the sub-account's private integration token (pit-…) in the token column of this client's row. The location id is usually already there.",
    });
  } else if (profile.lost?.error) {
    gaps.push({
      gap: "ghl_error",
      label: "GHL sub-account cannot be read",
      fix: `Check the token on the Client Data tab. Last error: ${String(profile.lost.error).slice(0, 120)}`,
    });
  }
  if (!profile?.calls?.length) {
    gaps.push({
      gap: "call",
      label: "No recorded call in 30 days",
      fix: "Book a check-in and record it with Fathom, or share the recording that exists.",
    });
  }
  if (!client.csmAssigned) {
    gaps.push({
      gap: "csm",
      label: "No CSM on the card",
      fix: "Set the CSM field on the client task in ClickUp.",
    });
  }
  return gaps;
}

export const list = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    const clients = (await ctx.db.query("clients").collect()).filter(
      c => c.bucket !== "inactive",
    );
    const profiles = await ctx.db.query("clientProfiles").collect();
    const byName = new Map(profiles.map(p => [p.clientName, p]));
    const queued = (await ctx.db.query("outbox").collect()).filter(
      o => o.kind === "issue",
    );
    const rows = clients
      .map(c => {
        const gaps = gapsFor(c, byName.get(c.name)).map(g => {
          const q = queued.find(
            o => o.clientTaskId === c.taskId && o.action === g.label,
          );
          return {
            ...g,
            queued: Boolean(q),
            sent: Boolean(q?.sentAt && !q.error),
            resultUrl: q?.resultUrl,
            error: q?.error,
          };
        });
        return {
          clientName: c.name,
          taskId: c.taskId,
          bucket: c.bucket,
          csm: c.csmAssigned,
          gaps,
        };
      })
      .filter(r => r.gaps.length > 0)
      .sort(
        (a, b) =>
          b.gaps.length - a.gaps.length ||
          a.clientName.localeCompare(b.clientName),
      );
    const counts: Record<string, number> = {};
    for (const r of rows)
      for (const g of r.gaps) counts[g.gap] = (counts[g.gap] ?? 0) + 1;
    return { rows, counts, activeClients: clients.length };
  },
});

/** Queue one gap as a ClickUp task on the Client Success list. */
export const queue = authenticatedMutation({
  args: {
    taskId: v.string(),
    clientName: v.string(),
    label: v.string(),
    fix: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, clientName, label, fix }) => {
    await assertRole(ctx, "csm");
    const already = (await ctx.db.query("outbox").collect()).find(
      o =>
        o.kind === "issue" && o.clientTaskId === taskId && o.action === label,
    );
    if (already) return null;
    await ctx.db.insert("outbox", {
      kind: "issue",
      clientTaskId: taskId,
      clientName,
      action: label,
      evidence: [
        "Flagged from the Client Success Cockpit data backlog.",
        "",
        `Fix: ${fix}`,
        `Client task: https://app.clickup.com/t/${taskId}`,
      ].join("\n"),
      createdAt: Date.now(),
    });
    return null;
  },
});

/** The same backlog for the command line and the feed logs (no user needed). */
export const summary = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const clients = (await ctx.db.query("clients").collect()).filter(
      c => c.bucket !== "inactive",
    );
    const profiles = await ctx.db.query("clientProfiles").collect();
    const byName = new Map(profiles.map(p => [p.clientName, p]));
    const out: Record<string, string[]> = {};
    const reasons: Record<string, number> = {};
    for (const c of clients) {
      const p = byName.get(c.name);
      for (const g of gapsFor(c, p)) {
        if (!out[g.gap]) out[g.gap] = [];
        out[g.gap].push(c.name);
        if (g.gap === "sheet_access") {
          const k = String(p?.performance?.error ?? "")
            .replace(/https?:\S+/g, "URL")
            .slice(0, 60);
          reasons[k] = (reasons[k] ?? 0) + 1;
        }
      }
    }
    return { activeClients: clients.length, gaps: out, sheetErrors: reasons };
  },
});
