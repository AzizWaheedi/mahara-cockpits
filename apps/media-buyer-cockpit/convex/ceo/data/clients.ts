import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { addDays, kuwaitDay, monthStart } from "../time";

type Any = any;

/** Digests older than this are not the client's "latest update" any more. */
const DIGEST_DAYS = 60;

/**
 * The daily point the clients adapter writes per client card (scope
 * `client:<ClickUp task id>`): 0 active, 1 onboarding, 2 paused, 3 churned.
 * The first day a client reads 3 is the day it stopped, which is how the
 * churn rule dates a loss (ClickUp keeps no stage history of its own).
 */
export const BUCKET_METRIC = "clients.bucket";
export const BUCKET_CHURNED = 3;

/**
 * The card's Launch Date as a daily point per client (days since 1970-01-01),
 * written beside BUCKET_METRIC, so a card that later leaves the client list
 * still says whether and when it launched.
 */
export const LAUNCH_METRIC = "clients.launchDay";

/**
 * How far back one client's stop is looked for. A client that has read
 * churned for longer than this stopped more than three months ago, which is
 * all the churn rule needs to know about it, and the read stays bounded.
 */
const STOP_WALK = 100;

/**
 * The month scan reads every daily point from the day before the month began
 * (all metrics share the by_date index): about 200 a day once the per-client
 * points exist, so 8,000 covers a month with room to spare and keeps this
 * query well inside Convex's per-query read limit together with the stop
 * walk. If it is ever reached the adapter says so and withholds the rate.
 */
const MONTH_SCAN_CAP = 8000;

/** How many hand-logged payments the renewal rule reads at most. */
const MANUAL_CAP = 5000;

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
 *
 * For the churn and renewal rule (2026-09-16) it also returns, read only:
 * - `stops`: per roster client, the run of churned days its own daily history
 *   ends with (see BUCKET_METRIC), so the adapter can date a stop;
 * - `bucketMonth`: every per-client point (stage and Launch Date) since the
 *   day before this Kuwait month began, for regained clients, clients that
 *   left the roster, and days with nothing stored;
 * - `manualPayments`: the live hand-logged payments (ceoManualPayments with no
 *   deletedAt), day, USD, rail and who they were logged against. Never the
 *   note, the typed amount or who logged them.
 */
export const load = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const today = kuwaitDay(Date.now());
    const rosterRows = await ctx.db.query("clients").take(1000);
    const clients = rosterRows.map(c => ({
      taskId: c.taskId,
      name: c.name,
      stage: c.stage,
      bucket: c.bucket ?? null,
      launchDate: c.launchDate ?? null,
      // Days since the ClickUp card's date_created as of this sync: the
      // clock for time to first launch.
      signupDays: c.signupDays ?? null,
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

    // Each client's own history, newest first, until it reads anything but
    // churned. A live client stops at its first row.
    const stops: Any[] = [];
    let historyStart: string | null = null;
    for (const c of rosterRows) {
      const scope = `client:${c.taskId}`;
      const first = await ctx.db
        .query("ceoDaily")
        .withIndex("by_metric_scope_date", q =>
          q.eq("metric", BUCKET_METRIC).eq("scope", scope),
        )
        .first();
      if (first && (historyStart === null || first.date < historyStart))
        historyStart = first.date;
      let churnedFrom: string | null = null;
      let liveOn: string | null = null;
      let read = 0;
      for await (const p of ctx.db
        .query("ceoDaily")
        .withIndex("by_metric_scope_date", q =>
          q.eq("metric", BUCKET_METRIC).eq("scope", scope),
        )
        .order("desc")) {
        read++;
        if (p.value !== BUCKET_CHURNED) {
          liveOn = p.date;
          break;
        }
        churnedFrom = p.date;
        if (read >= STOP_WALK) break;
      }
      stops.push({
        taskId: c.taskId,
        // First day of the churned run the history ends with, or null.
        churnedFrom,
        // Newest day the client read anything but churned, or null when the
        // walk found none (history starts churned, or the walk hit its cap).
        liveOn,
        firstDay: first?.date ?? null,
        capped: liveOn === null && read >= STOP_WALK,
      });
    }

    const from = addDays(monthStart(today), -1);
    const points: Any[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const p of ctx.db
      .query("ceoDaily")
      .withIndex("by_date", q => q.gte("date", from))) {
      if (++scanned > MONTH_SCAN_CAP) {
        truncated = true;
        break;
      }
      if (
        (p.metric === BUCKET_METRIC || p.metric === LAUNCH_METRIC) &&
        p.scope.startsWith("client:")
      )
        points.push({
          taskId: p.scope.slice("client:".length),
          metric: p.metric,
          date: p.date,
          value: p.value,
        });
    }

    const manualRows = await ctx.db
      .query("ceoManualPayments")
      .withIndex("by_deleted_day", q => q.eq("deletedAt", undefined))
      .take(MANUAL_CAP);
    const manualPayments = manualRows.map(m => ({
      day: m.day,
      amountUsd: m.amountUsd,
      clientName: m.clientName,
      clickupTaskId: m.clickupTaskId ?? null,
      rail: m.rail,
    }));

    return {
      clients,
      links,
      campaigns,
      latestUpdate,
      today,
      stops,
      historyStart,
      bucketMonth: { from, points, truncated },
      manualPayments,
      manualCapped: manualRows.length >= MANUAL_CAP,
    };
  },
});
