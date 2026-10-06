import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { addDays, kuwaitToday, sb } from "./billingCore";
import {
  addMonths,
  type Departure,
  departureProblem,
  type MonthInput,
  type MonthRow,
  monthOf,
  REASONS,
  type Reason,
  rollUp,
} from "./churnCore";
import { PAUSE_IS_CHURN_DAYS } from "./csmSync";
import { authenticatedAction } from "./functions";
import { hasAccess, seatOf } from "./roles";

declare const process: { env: Record<string, string | undefined> };

/**
 * The churn tracker (the CEO, 2026-10-01): the register of clients who left
 * and the month-by-month rate, kept in Supabase (cockpit_churn_*, migration
 * 20261001a) and counted by churnCore.ts, mahara-context's rules.
 *
 * Who may do what: everyone with a seat in this cockpit reads it, logs a
 * departure, corrects one and types a month's two numbers; only the CEO and
 * admins remove a row, with the reason kept, because a churn number that can
 * be argued down at month end stops driving anything. Every change is a row
 * in cockpit_churn_log.
 *
 * What is waiting to be logged comes from evidence only: a ClickUp card
 * marked Stopped with a churn date, a loss the daily roster saw, or a pause
 * past the 14-day line. A Stopped card with no date is history the old sheet
 * already counted, and is not offered.
 */

function plain(e: unknown): ConvexError<{ message: string }> {
  if (e instanceof ConvexError) return e as ConvexError<{ message: string }>;
  const raw = e instanceof Error ? e.message : String(e);
  const message =
    raw
      .replace(/^[\s\S]*?Uncaught Error: /, "")
      .split("\n")[0]
      .trim()
      .slice(0, 300) || "That did not work. Try again in a minute.";
  return new ConvexError({ message });
}

async function plainly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw plain(e);
  }
}

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key)
    throw new Error(
      "The churn tracker cannot reach Supabase: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the client success deployment. Ask Aziz.",
    );
  return { url, key };
}

type Seat = { email: string; isCeo: boolean; isAdmin: boolean };

export const seat = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }): Promise<Seat> => {
    const user = await ctx.db.get(userId);
    if (!(await hasAccess(ctx, user?.email)))
      throw new Error(
        "The churn tracker is for client success. Ask Aziz to add you in the portal.",
      );
    const s = await seatOf({ ...ctx, userId });
    return { email: s.email, isCeo: s.isCeo, isAdmin: s.isAdmin };
  },
});

/** The roster's kinds that mean a client left. */
const LEFT = new Set(["lost", "removed", "offboarded"]);

type RosterCard = {
  key: string;
  name: string;
  stage: string;
  launchedOn: string | null;
  csm: string | null;
  pausedSince: string | null;
  pausedDays: number | null;
};

/**
 * What the daily roster knows: every card, the losses it recorded since
 * `since`, and how many clients were paying on each month's first roster day
 * (the start a month can be filled with).
 */
export const roster = internalQuery({
  args: { since: v.string(), through: v.string() },
  returns: v.any(),
  handler: async (ctx, { since, through }) => {
    const cards: RosterCard[] = (await ctx.db.query("clients").collect()).map(
      c => ({
        key: String(c.taskId),
        name: String(c.name),
        stage: String(c.stage ?? ""),
        launchedOn: c.launchDate ? String(c.launchDate).slice(0, 10) : null,
        csm: c.csmAssigned ?? null,
        pausedSince: c.pausedSince ?? null,
        pausedDays: typeof c.pausedDays === "number" ? c.pausedDays : null,
      }),
    );
    const left: { key: string; name: string; day: string; to: string }[] = [];
    const starts: {
      month: string;
      day: string | null;
      paying: number | null;
    }[] = [];
    for (let m = since; m <= through; m = addMonths(m, 1)) {
      const events = await ctx.db
        .query("churnEvents")
        .withIndex("by_month", q => q.eq("month", m))
        .collect();
      for (const e of events)
        if (LEFT.has(e.kind))
          left.push({
            key: String(e.key),
            name: String(e.name),
            day: String(e.day),
            to: String(e.to ?? e.kind),
          });
      const first = await ctx.db
        .query("rosterDays")
        .withIndex("by_month", q => q.eq("month", m))
        .order("asc")
        .first();
      starts.push({
        month: m,
        day: first?.day ?? null,
        paying: typeof first?.paying === "number" ? first.paying : null,
      });
    }
    return { cards, left, starts };
  },
});

// --- the page ------------------------------------------------------------------------

export type Waiting = {
  key: string;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string | null;
  reason: Reason | null;
  mrrLostUsd: number | null;
  csm: string | null;
  /** The evidence, in plain words. */
  why: string;
};

export type PickClient = {
  key: string;
  name: string;
  stage: string;
  launchedOn: string | null;
  csm: string | null;
  mrrUsd: number | null;
};

export type ChurnPage = {
  today: string;
  month: string;
  me: { email: string; canRemove: boolean };
  reasons: readonly string[];
  departures: Departure[];
  /** Newest first, months with something in them, the current one always. */
  months: MonthRow[];
  waiting: Waiting[];
  clients: PickClient[];
  /** The roster's paying count on each month's first day, to fill a start with. */
  starts: { month: string; day: string | null; paying: number | null }[];
  /** Cards that launched in each month, to fill new clients with. */
  launches: { month: string; names: string[] }[];
  log: { at: string; by: string; what: string }[];
};

type Row = Record<string, any>;

function departureOf(r: Row): Departure {
  return {
    id: Number(r.id),
    client: String(r.client),
    clickupTaskId: r.clickup_task_id ?? null,
    leftOn: String(r.left_on).slice(0, 10),
    launchedOn: r.launched_on ? String(r.launched_on).slice(0, 10) : null,
    reason: (REASONS as readonly string[]).includes(r.reason)
      ? (r.reason as Reason)
      : "Other",
    mrrLostUsd:
      r.mrr_lost_usd === null || r.mrr_lost_usd === undefined
        ? null
        : Number(r.mrr_lost_usd),
    csm: r.csm ?? null,
    note: r.note ?? null,
    source: r.source === "sheet" ? "sheet" : "cockpit",
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedBy: r.updated_by ?? null,
    updatedAt: String(r.updated_at),
  };
}

function monthInputOf(r: Row): MonthInput {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    month: String(r.month),
    activeAtStart: n(r.active_at_start),
    newClients: n(r.new_clients),
    lostBeforeRegister: n(r.lost_before_register),
    note: r.note ?? null,
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function build(
  seatRow: Seat,
  ctx: {
    runQuery: (...a: any[]) => Promise<any>;
  },
): Promise<ChurnPage> {
  const e = env();
  const today = kuwaitToday();
  const month = monthOf(today);
  const [deps, monthRows, cards, log] = await Promise.all([
    sb(
      e.url,
      e.key,
      "cockpit_churn_departures?select=*&removed_at=is.null&order=left_on.desc,id.desc&limit=500",
    ),
    sb(e.url, e.key, "cockpit_churn_months?select=*&order=month.asc"),
    sb(
      e.url,
      e.key,
      "cockpit_billing_accounts?select=clickup_task_id,client_name,stage,stage_group,mrr_usd,churn_date,csm",
    ),
    sb(
      e.url,
      e.key,
      "cockpit_churn_log?select=at,by_whom,what,detail&order=at.desc&limit=200",
    ),
  ]);
  const departures = deps.map(departureOf);
  const since = addMonths(month, -3);
  const r: {
    cards: RosterCard[];
    left: { key: string; name: string; day: string; to: string }[];
    starts: { month: string; day: string | null; paying: number | null }[];
  } = await ctx.runQuery(internal.churn.roster, { since, through: month });

  const billing = new Map(cards.map(c => [String(c.clickup_task_id), c]));
  const rosterByKey = new Map(r.cards.map(c => [c.key, c]));

  // The pick list: every card the roster or billing knows, live ones first.
  const keys = new Set([...rosterByKey.keys(), ...billing.keys()]);
  const clients: PickClient[] = [...keys]
    .map(k => {
      const rc = rosterByKey.get(k);
      const bc = billing.get(k);
      return {
        key: k,
        name: String(rc?.name ?? bc?.client_name ?? k),
        stage: String(rc?.stage ?? bc?.stage ?? ""),
        launchedOn: rc?.launchedOn ?? null,
        csm: (bc?.csm as string | null) ?? rc?.csm ?? null,
        mrrUsd:
          bc?.mrr_usd === null || bc?.mrr_usd === undefined
            ? null
            : Number(bc.mrr_usd),
      };
    })
    .filter(c => !/playing account|\[internal test\]/i.test(c.name))
    .sort(
      (a, b) =>
        Number(/stop|cancel/i.test(a.stage)) -
          Number(/stop|cancel/i.test(b.stage)) || a.name.localeCompare(b.name),
    );

  // Waiting: evidence of a departure the register does not hold yet.
  const loggedKeys = new Set(
    departures.map(d => d.clickupTaskId).filter(Boolean) as string[],
  );
  const loggedNames = new Set(departures.map(d => norm(d.client)));
  const dismissed = new Set(
    log
      .filter(l => l.what === "dismissed a suggestion")
      .map(l => String(l.detail?.key ?? "")),
  );
  const cutoff = addDays(today, -75);
  const waiting = new Map<string, Waiting>();
  const offer = (w: Waiting) => {
    if (
      loggedKeys.has(w.key) ||
      loggedNames.has(norm(w.client)) ||
      dismissed.has(`${w.key}:${w.leftOn}`) ||
      waiting.has(w.key) ||
      w.leftOn < cutoff
    )
      return;
    waiting.set(w.key, w);
  };
  for (const c of cards)
    if (c.stage_group === "gone" && c.churn_date)
      offer({
        key: String(c.clickup_task_id),
        client: String(c.client_name),
        clickupTaskId: String(c.clickup_task_id),
        leftOn: String(c.churn_date).slice(0, 10),
        launchedOn:
          rosterByKey.get(String(c.clickup_task_id))?.launchedOn ?? null,
        reason: null,
        mrrLostUsd: c.mrr_usd === null ? null : Number(c.mrr_usd),
        csm: c.csm ?? null,
        why: `The ClickUp card is ${c.stage} with a churn date`,
      });
  for (const l of r.left) {
    const rc = rosterByKey.get(l.key);
    const bc = billing.get(l.key);
    offer({
      key: l.key,
      client: rc?.name ?? l.name,
      clickupTaskId: rc || bc ? l.key : null,
      leftOn: l.day,
      launchedOn: rc?.launchedOn ?? null,
      reason: null,
      mrrLostUsd:
        bc?.mrr_usd === null || bc?.mrr_usd === undefined
          ? null
          : Number(bc.mrr_usd),
      csm: (bc?.csm as string | null) ?? rc?.csm ?? null,
      why: `The daily roster saw it leave (${l.to})`,
    });
  }
  for (const c of r.cards)
    if (
      c.pausedSince &&
      c.pausedDays !== null &&
      c.pausedDays >= PAUSE_IS_CHURN_DAYS
    ) {
      const bc = billing.get(c.key);
      offer({
        key: c.key,
        client: c.name,
        clickupTaskId: c.key,
        leftOn: addDays(c.pausedSince, PAUSE_IS_CHURN_DAYS),
        launchedOn: c.launchedOn,
        reason: "Paused past 14 days",
        mrrLostUsd:
          bc?.mrr_usd === null || bc?.mrr_usd === undefined
            ? null
            : Number(bc.mrr_usd),
        csm: (bc?.csm as string | null) ?? c.csm,
        why: `Paused ${c.pausedDays} days: past the 14-day line`,
      });
    }

  const rows = rollUp(monthRows.map(monthInputOf), departures, month);
  const launches = new Map<string, string[]>();
  for (const c of r.cards)
    if (c.launchedOn && c.launchedOn.slice(0, 7) >= addMonths(month, -12))
      launches.set(c.launchedOn.slice(0, 7), [
        ...(launches.get(c.launchedOn.slice(0, 7)) ?? []),
        c.name,
      ]);

  return {
    today,
    month,
    me: {
      email: seatRow.email,
      canRemove: seatRow.isCeo || seatRow.isAdmin,
    },
    reasons: REASONS,
    departures,
    months: rows.filter(x => x.hasData).reverse(),
    waiting: [...waiting.values()].sort((a, b) =>
      b.leftOn.localeCompare(a.leftOn),
    ),
    clients,
    starts: r.starts,
    launches: [...launches.entries()].map(([m, names]) => ({
      month: m,
      names: names.sort(),
    })),
    log: log.slice(0, 30).map(l => ({
      at: String(l.at),
      by: String(l.by_whom),
      what: String(l.what),
    })),
  };
}

async function logRow(by: string, what: string, detail?: Row): Promise<void> {
  const e = env();
  await sb(e.url, e.key, "cockpit_churn_log", {
    method: "POST",
    body: { by_whom: by, what, detail: detail ?? null },
    prefer: "return=minimal",
  });
}

export const page = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: (ctx): Promise<ChurnPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      return build(s, ctx);
    }),
});

const dayOrNull = v.optional(v.union(v.string(), v.null()));

/** Log a departure, or correct one (`id`). */
export const saveDeparture = authenticatedAction({
  args: {
    id: v.optional(v.number()),
    client: v.string(),
    clickupTaskId: dayOrNull,
    leftOn: v.string(),
    launchedOn: dayOrNull,
    reason: v.string(),
    mrrLostUsd: v.optional(v.union(v.number(), v.null())),
    csm: dayOrNull,
    note: dayOrNull,
  },
  returns: v.any(),
  handler: (ctx, a): Promise<ChurnPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      const fields = {
        client: a.client.replace(/\s+/g, " ").trim().slice(0, 160),
        leftOn: a.leftOn,
        launchedOn: a.launchedOn || null,
        reason: a.reason,
        mrrLostUsd: a.mrrLostUsd ?? null,
      };
      const problem = departureProblem(fields);
      if (problem) throw new Error(problem);
      if (fields.leftOn > kuwaitToday())
        throw new Error(
          "The day they left is in the future. Log it on the day.",
        );
      const e = env();
      const row = {
        client: fields.client,
        clickup_task_id: a.clickupTaskId || null,
        left_on: fields.leftOn,
        launched_on: fields.launchedOn,
        reason: fields.reason,
        mrr_lost_usd: fields.mrrLostUsd,
        csm: a.csm?.trim() || null,
        note: a.note?.trim().slice(0, 2000) || null,
        updated_by: s.email,
        updated_at: new Date().toISOString(),
      };
      if (a.id) {
        const [before] = await sb(
          e.url,
          e.key,
          `cockpit_churn_departures?id=eq.${Math.trunc(a.id)}&removed_at=is.null&select=*`,
        );
        if (!before)
          throw new Error("That row is not in the register any more. Refresh.");
        await sb(
          e.url,
          e.key,
          `cockpit_churn_departures?id=eq.${Math.trunc(a.id)}`,
          { method: "PATCH", body: row, prefer: "return=minimal" },
        );
        await logRow(s.email, `corrected ${fields.client}`, {
          id: a.id,
          before,
          after: row,
        });
      } else {
        try {
          await sb(e.url, e.key, "cockpit_churn_departures", {
            method: "POST",
            body: { ...row, created_by: s.email, source: "cockpit" },
            prefer: "return=minimal",
          });
        } catch (err) {
          if (/23505|duplicate/i.test(String(err)))
            throw new Error(
              `${fields.client} is already in the register for that day.`,
            );
          throw err;
        }
        await logRow(s.email, `logged ${fields.client} leaving`, row);
      }
      return build(s, ctx);
    }),
});

/** Take a wrong row out of the register. The CEO and admins only; the reason is kept. */
export const removeDeparture = authenticatedAction({
  args: { id: v.number(), why: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<ChurnPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      if (!(s.isCeo || s.isAdmin))
        throw new Error(
          "Only Aziz or an admin takes a row out of the register. Correct it instead, or ask Aziz.",
        );
      const why = a.why.trim();
      if (why.length < 4) throw new Error("Say why it comes out.");
      const e = env();
      const [before] = await sb(
        e.url,
        e.key,
        `cockpit_churn_departures?id=eq.${Math.trunc(a.id)}&removed_at=is.null&select=*`,
      );
      if (!before) throw new Error("That row is already out. Refresh.");
      await sb(
        e.url,
        e.key,
        `cockpit_churn_departures?id=eq.${Math.trunc(a.id)}`,
        {
          method: "PATCH",
          body: {
            removed_at: new Date().toISOString(),
            removed_by: s.email,
            removed_why: why.slice(0, 500),
          },
          prefer: "return=minimal",
        },
      );
      await logRow(s.email, `took ${before.client} out of the register`, {
        id: a.id,
        why,
        before,
      });
      return build(s, ctx);
    }),
});

/** A month's two typed numbers. A null clears it (a start is then carried). */
export const saveMonth = authenticatedAction({
  args: {
    month: v.string(),
    activeAtStart: v.optional(v.union(v.number(), v.null())),
    newClients: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<ChurnPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      if (!/^\d{4}-\d{2}$/.test(a.month))
        throw new Error("That is not a month.");
      if (a.month > monthOf(kuwaitToday()))
        throw new Error("That month has not started yet.");
      const ok = (n: number | null | undefined) =>
        n === undefined ||
        n === null ||
        (Number.isInteger(n) && n >= 0 && n < 10000);
      if (!ok(a.activeAtStart) || !ok(a.newClients))
        throw new Error("A count is a whole number, 0 or more.");
      const e = env();
      const [before] = await sb(
        e.url,
        e.key,
        `cockpit_churn_months?month=eq.${a.month}&select=*`,
      );
      const body: Row = {
        month: a.month,
        updated_by: s.email,
        updated_at: new Date().toISOString(),
      };
      if (a.activeAtStart !== undefined) body.active_at_start = a.activeAtStart;
      if (a.newClients !== undefined) body.new_clients = a.newClients;
      await sb(e.url, e.key, "cockpit_churn_months?on_conflict=month", {
        method: "POST",
        body,
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      await logRow(s.email, `set ${a.month}'s numbers`, {
        before: before ?? null,
        after: body,
      });
      return build(s, ctx);
    }),
});

/** A suggestion that is not a departure (a card stopped before onboarding, a test card). */
export const dismiss = authenticatedAction({
  args: {
    key: v.string(),
    leftOn: v.string(),
    client: v.string(),
    why: v.string(),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<ChurnPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      await logRow(s.email, "dismissed a suggestion", {
        key: `${a.key}:${a.leftOn}`,
        client: a.client,
        why: a.why.trim().slice(0, 300) || null,
      });
      return build(s, ctx);
    }),
});

/** This month's numbers for the CSM's money screen: the tracker is the one churn figure. */
export const thisMonth = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: (ctx): Promise<MonthRow | null> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.churn.seat, {
        userId: ctx.userId,
      });
      const page = await build(s, ctx);
      return page.months.find(m => m.month === page.month) ?? null;
    }),
});
