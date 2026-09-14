import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * States that mean "this client is paying us this month". Anything else is not counted
 * in the churn denominator. Stopped/Cancelled/Paused are the exits.
 */
const LOST_MARKERS = ["stop", "cancel", "churn", "lost", "offboard"];
/** A pause turns into churn at this many days. Company rule, 2026-09-03. */
export const PAUSE_IS_CHURN_DAYS = 14;

const PAUSE_MARKERS = ["pause", "freeze", "hold"];

export function payingState(status: string): boolean {
  const s = (status || "").toLowerCase();
  if (LOST_MARKERS.some(m => s.includes(m))) return false;
  if (PAUSE_MARKERS.some(m => s.includes(m))) return false;
  return s.trim().length > 0;
}

export function stateOf(status: string): "paying" | "paused" | "lost" {
  const s = (status || "").toLowerCase();
  if (LOST_MARKERS.some(m => s.includes(m))) return "lost";
  if (PAUSE_MARKERS.some(m => s.includes(m))) return "paused";
  return "paying";
}

/**
 * Write today's roster and diff it against the last one we stored. Runs on every sync,
 * so the transition is caught the same day it happens rather than remembered later.
 */
async function recordRoster(
  // biome-ignore lint/suspicious/noExplicitAny: convex mutation ctx
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
  clients: any[],
  day: string,
): Promise<void> {
  const month = day.slice(0, 7);
  const rows = clients.map(c => ({
    key: String(c.taskId ?? c.name),
    name: String(c.name ?? "unnamed"),
    status: String(c.stage ?? c.status ?? ""),
    paying: payingState(String(c.stage ?? c.status ?? "")),
  }));

  const previous = await ctx.db.query("rosterDays").order("desc").first();
  const today = await ctx.db
    .query("rosterDays")
    .withIndex("by_day", (q: any) => q.eq("day", day))
    .first();
  const doc = {
    day,
    month,
    clients: rows,
    paying: rows.filter(r => r.paying).length,
    total: rows.length,
    at: Date.now(),
  };
  if (today) await ctx.db.patch(today._id, doc);
  else await ctx.db.insert("rosterDays", doc);

  // Diff against the most recent *earlier* day, so repeated same-day syncs stay quiet.
  if (!previous || previous.day === day) return;
  const before = new Map(
    (previous.clients as typeof rows).map(r => [r.key, r]),
  );
  for (const now of rows) {
    const was = before.get(now.key);
    if (!was) {
      await ctx.db.insert("churnEvents", {
        day,
        month,
        key: now.key,
        name: now.name,
        from: "-",
        to: now.status,
        kind: now.paying ? "new" : "new_inactive",
        at: Date.now(),
      });
      continue;
    }
    const a = stateOf(was.status);
    const b = stateOf(now.status);
    if (a === b) continue;
    await ctx.db.insert("churnEvents", {
      day,
      month,
      key: now.key,
      name: now.name,
      from: was.status,
      to: now.status,
      kind: b === "paying" ? "regained" : b === "lost" ? "lost" : "paused",
      at: Date.now(),
    });
  }
  for (const [key, was] of before) {
    if (rows.some(r => r.key === key)) continue;
    await ctx.db.insert("churnEvents", {
      day,
      month,
      key,
      name: was.name,
      from: was.status,
      to: "removed from the board",
      kind: was.paying ? "lost" : "removed",
      at: Date.now(),
    });
  }
}

export const store = internalMutation({
  args: {
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    clients: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    tasks: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: checklist rows
    checks: v.array(v.any()),
  },
  returns: v.object({ clients: v.number(), tasks: v.number() }),
  handler: async (ctx, args) => {
    for (const row of await ctx.db.query("clients").collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("csTasks").collect())
      await ctx.db.delete(row._id);
    const day = kuwaitToday();
    // How long has each paused client been paused? Taken from our own recorded pause
    // events, never guessed. Unknown stays unknown — a made-up day count would drive
    // fake churn. 14 days paused is the churn line, so this number matters.
    // Walked in date order so the start is the current pause: a client paused in
    // June, back in July and paused again today counts from today, not June.
    const pauseEvents = await ctx.db.query("churnEvents").collect();
    pauseEvents.sort((a, b) =>
      a.day === b.day ? a.at - b.at : a.day < b.day ? -1 : 1,
    );
    const pausedSince = new Map<string, string>();
    for (const e of pauseEvents) {
      if (e.kind === "paused" || e.kind === "paused_by_csm") {
        if (!pausedSince.has(e.key)) pausedSince.set(e.key, e.day);
      } else if (
        ["regained", "lost", "new", "removed", "offboarded"].includes(e.kind)
      ) {
        pausedSince.delete(e.key);
      }
    }
    for (const c of args.clients) {
      const key = String(c.taskId ?? c.name);
      const since = pausedSince.get(key);
      const paused = stateOf(String(c.stage ?? "")) === "paused";
      await ctx.db.insert("clients", {
        ...c,
        pausedSince: paused ? since : undefined,
        pausedDays:
          paused && since
            ? Math.round(
                (Date.parse(`${day}T00:00:00Z`) -
                  Date.parse(`${since}T00:00:00Z`)) /
                  86400000,
              )
            : undefined,
      });
    }
    for (const t of args.tasks) await ctx.db.insert("csTasks", t);

    const existing = await ctx.db
      .query("checks")
      .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
      .collect();
    const byKey = new Map(existing.map(c => [c.key, c]));
    // A check whose work no longer exists must disappear, not linger from an earlier run.
    const keep = new Set(args.checks.map((c: { key: string }) => c.key));
    for (const c of existing) if (!keep.has(c.key)) await ctx.db.delete(c._id);
    for (const c of args.checks) {
      const prev = byKey.get(c.key);
      if (prev)
        await ctx.db.patch(prev._id, {
          detail: c.detail,
          label: c.label,
          block: c.block,
        });
      else
        await ctx.db.insert("checks", { ...c, role: "csm", day, done: false });
    }
    await recordRoster(ctx, args.clients, day);
    await ctx.db.insert("syncRuns", {
      at: Date.now(),
      ok: true,
      role: "csm",
      campaigns: args.clients.length,
      ads: args.tasks.length,
      offBoard: 0,
    });
    return { clients: args.clients.length, tasks: args.tasks.length };
  },
});

/**
 * Churn / revenue KPIs pushed in by the bridge from the Churn Tracker sheet.
 * Replaces the whole set each run so a KPI he deletes upstream disappears here too.
 */
/**
 * Replaces the client profile set. The bridge reads the client sheets, GHL locations and
 * the media buyer's Meta sync outside the Space (the Space's own tool gateway is broken),
 * so this mutation is a pure write.
 */
/** Replace the booked-calls table. GHL is the source of truth, so a full swap is honest. */
export const storeAppointments = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.object({ appointments: v.number() }),
  handler: async (ctx, args) => {
    for (const row of await ctx.db.query("appointments").collect())
      await ctx.db.delete(row._id);
    for (const r of args.rows) await ctx.db.insert("appointments", r);
    return { appointments: args.rows.length };
  },
});

export const storeProfiles = internalMutation({
  args: {
    profiles: v.array(v.any()),
    reset: v.optional(v.boolean()),
    syncId: v.optional(v.string()),
  },
  returns: v.object({ profiles: v.number() }),
  handler: async (ctx, args) => {
    // Batched write, commit last. The old set stays readable until `commitProfiles` says the
    // new one is complete, so a push that dies halfway leaves yesterday's full board rather
    // than a truncated one. `reset` is kept only for the legacy caller and does nothing now.
    for (const p of args.profiles) {
      await ctx.db.insert("clientProfiles", {
        clientName: String(p.clientName),
        taskId: p.taskId ?? undefined,
        links: p.links ?? {},
        ghlName: p.ghlName ?? undefined,
        service: p.service ?? undefined,
        adsPlatform: p.adsPlatform ?? undefined,
        profileText: p.profileText ?? undefined,
        dosDonts: p.dosDonts ?? undefined,
        updates: p.updates ?? undefined,
        stage: p.stage ?? undefined,
        happiness: p.happiness ?? undefined,
        launchDate: p.launchDate ?? undefined,
        liveDays: p.liveDays ?? undefined,
        performance: p.performance ?? undefined,
        ads: p.ads ?? [],
        live: p.live ?? undefined,
        lost: p.lost ?? undefined,
        adsAccess: p.adsAccess ?? undefined,
        calls: p.calls ?? undefined,
        gaps: Array.isArray(p.gaps) ? p.gaps : undefined,
        adLeads: p.adLeads ?? undefined,
        provisional: p.provisional ?? undefined,
        callsBrief: p.callsBrief ?? undefined,
        reportNudge: p.reportNudge ?? undefined,
        syncedAt: Date.now(),
        syncId: args.syncId ?? undefined,
      });
    }
    return { profiles: args.profiles.length };
  },
});

export const storeKpi = internalMutation({
  args: { rows: v.array(v.any()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("kpi").collect())
      await ctx.db.delete(old._id);
    for (const r of args.rows)
      await ctx.db.insert("kpi", { ...r, at: Date.now() });
    return { kpis: args.rows.length };
  },
});

/** Row counts for the bridge's post-sync verification. */
export const countRows = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => ({
    clients: (await ctx.db.query("clients").collect()).length,
    profiles: (await ctx.db.query("clientProfiles").collect()).length,
    withSheet: (await ctx.db.query("clientProfiles").collect()).filter(
      p => (p.links as Record<string, string>)?.sheet,
    ).length,
    stale: (await ctx.db.query("clientProfiles").collect()).reduce(
      // biome-ignore lint/suspicious/noExplicitAny: stored payload
      (n, p) => n + ((p.performance as any)?.staleCount ?? 0),
      0,
    ),
  }),
});

/**
 * Finish a profile push: drop every row that is not from this sync.
 *
 * Called once, after the last batch lands. If it never runs, the app keeps showing both the
 * old and the new set, which is visible and fixable, unlike silently losing 28 clients.
 */
export const commitProfiles = internalMutation({
  args: { syncId: v.string() },
  returns: v.object({ kept: v.number(), removed: v.number() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("clientProfiles").collect();
    let removed = 0;
    for (const row of rows) {
      if (row.syncId !== args.syncId) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return { kept: rows.length - removed, removed };
  },
});

/**
 * The bridge's own report card, written at the end of every run. `ok` false means at least
 * one feed failed, and the app shows an amber strip rather than pretending the data is fresh.
 */
export const recordHealth = internalMutation({
  args: {
    ok: v.boolean(),
    clients: v.number(),
    profiles: v.number(),
    errors: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("syncRuns", {
      at: Date.now(),
      ok: args.ok,
      role: "csm",
      kind: "health",
      campaigns: args.clients,
      ads: 0,
      offBoard: 0,
      profiles: args.profiles,
      errors: args.errors,
      message: args.errors[0],
    });
    // Keep the table small: health rows older than the last 200 are noise.
    const old = await ctx.db
      .query("syncRuns")
      .withIndex("by_kind_at", q => q.eq("kind", "health"))
      .order("desc")
      .collect();
    for (const row of old.slice(200)) await ctx.db.delete(row._id);
    return { ok: args.ok };
  },
});

export const health = internalQuery({
  args: {},
  handler: async ctx => {
    const row = await ctx.db
      .query("syncRuns")
      .withIndex("by_kind_at", q => q.eq("kind", "health"))
      .order("desc")
      .first();
    if (!row) return null;
    return {
      at: row.at,
      ok: row.ok,
      clients: row.campaigns,
      profiles: row.profiles ?? 0,
      errors: row.errors ?? [],
    };
  },
});
