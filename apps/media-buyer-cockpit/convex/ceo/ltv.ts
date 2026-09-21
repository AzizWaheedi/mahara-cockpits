import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { authenticatedAction, authenticatedQuery } from "../functions";
import { callTool, unwrap } from "../tools";
import { CFB, groupOf, isInternalCard } from "./billing";
import { isCeoEmail, requireCeo } from "./gate";

/**
 * Lifetime value on the ClickUp client card: a frozen baseline plus the cash
 * the cockpit can actually attribute.
 *
 * Aziz's decision, 2026-09-19 (option two of two). The LTV field holds numbers
 * somebody typed once, and they are unreliable: of the 17 cards carrying one,
 * 4 agree with Whop, 3 are badly out, and 8 have no Whop payment at all. They
 * are still the only record of money collected before the cockpit existed, so
 * they are kept rather than replaced.
 *
 * So the field becomes:
 *
 *     LTV = baseline + every payment logged since the baseline was taken
 *
 * The baseline is the earliest `money.ltv.card` daily point for that card,
 * which the money adapter has recorded on every refresh since 2026-09-19 —
 * in other words what the field said before the cockpit ever wrote to it. It
 * never moves again, so a later write can never fold a written figure back
 * into itself.
 *
 * Two consequences worth stating plainly, because the figure is only honest
 * if they are:
 *
 *  - Part of every number here is unverifiable. The baseline was typed from
 *    memory and nothing can check it. It is carried, not trusted.
 *  - Only hand-logged payments count towards the new part today. Whop money is
 *    deliberately left out: only 42 of 124 paid rows carry a deal id, so
 *    adding "matched Whop cash" would credit some clients and not others for
 *    reasons that have nothing to do with what they paid.
 *
 * Every write is a recompute, never an increment, so running it twice changes
 * nothing and removing a logged payment lowers the field again.
 *
 * Scope, Aziz 2026-09-19: active and onboarding clients only. A stopped or
 * paused card is left alone, because its LTV is a closed number and rewriting
 * it would only churn history. Cards in scope that carry no LTV value at all
 * come back under `missing`, since without a figure there is nothing to build
 * on and Aziz fills those in himself.
 */

/** Where the money adapter stores each card's LTV field, day by day. */
const LTV_METRIC = "money.ltv.card";

/** The stages in scope: live clients and those still being onboarded. */
const IN_SCOPE = new Set(["active", "pipeline"]);

export type LtvPlan = {
  rows: LtvRow[];
  /** In-scope cards with no LTV figure, so no baseline exists to build on. */
  missing: { clickupTaskId: string; client: string; stage: string | null }[];
  /** Cards left alone because they are paused, stopped, cancelled or ours. */
  outOfScope: number;
};

export type LtvRow = {
  clickupTaskId: string;
  client: string;
  /** What the field said before the cockpit first wrote to it. */
  baseline: number;
  /** The day that baseline was taken. */
  baselineDay: string;
  /** Hand-logged payments for this card dated on or after the baseline day. */
  logged: number;
  loggedCount: number;
  /** baseline + logged: what the field should say. */
  target: number;
  /** What the field says right now. */
  current: number | null;
  /** target - current. Zero means there is nothing to write. */
  delta: number;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * What every card's LTV should be, and what it is.
 *
 * A card with no recorded baseline is left out entirely rather than treated as
 * starting from zero: that would wipe a hand-typed figure the first time
 * somebody logged a payment. The baseline appears on the next refresh after
 * the card gains an LTV value, so the cure is to wait one cycle, not to guess.
 */
export const plan = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }): Promise<LtvPlan> => {
    const user = await ctx.db.get(userId);
    if (!isCeoEmail(user?.email))
      throw new Error("The CEO cockpit is Aziz's only.");

    const billing = await ctx.db.query("ceoClientBilling").collect();
    // Every payment in attributed to a client card, from the money section's
    // attribution (Whop, Tap, bank statements, hand-logged): the client's LTV
    // table (Aziz, 2026-09-21). Hand-logged entries are inside it already,
    // so they are not read twice.
    const moneyRow = await ctx.db
      .query("ceoSections")
      .withIndex("by_key", q => q.eq("key", "money"))
      .first();
    // biome-ignore lint/suspicious/noExplicitAny: the stored payload is untyped
    const tx: any[] = moneyRow?.payload?.attribution?.transactions ?? [];
    const payments: { clickupTaskId: string; day: string; amountUsd: number }[] = tx
      .filter(t => t && t.direction === "in" && t.clientTaskId && typeof t.usd === "number")
      .map(t => ({
        clickupTaskId: String(t.clientTaskId),
        day: String(t.day),
        amountUsd: Number(t.usd),
      }));

    const byCard = new Map<string, { usd: number; n: number; first: string }>();
    for (const p of payments) {
      const id = String(p.clickupTaskId);
      const r = byCard.get(id) ?? { usd: 0, n: 0, first: p.day };
      r.usd += p.amountUsd;
      r.n += 1;
      if (p.day < r.first) r.first = p.day;
      byCard.set(id, r);
    }

    const out: LtvRow[] = [];
    const missing: LtvPlan["missing"] = [];
    let outOfScope = 0;
    for (const card of billing) {
      if (!IN_SCOPE.has(groupOf(card.stage)) || isInternalCard(card.name)) {
        outOfScope += 1;
        continue;
      }
      const scope = `client:${card.taskId}`;
      // The earliest point is the baseline: by_metric_scope_date is ordered by
      // date, so the first row is the oldest.
      const oldest = await ctx.db
        .query("ceoDaily")
        .withIndex("by_metric_scope_date", q =>
          q.eq("metric", LTV_METRIC).eq("scope", scope),
        )
        .first();
      if (!oldest) {
        missing.push({
          clickupTaskId: card.taskId,
          client: card.name,
          stage: card.stage ?? null,
        });
        continue;
      }
      const paid = byCard.get(card.taskId);
      // Only money received on or after the baseline day can be new: anything
      // earlier is already inside the figure that was typed.
      const logged = paid
        ? payments
            .filter(
              p => p.clickupTaskId === card.taskId && p.day >= oldest.date,
            )
            .reduce((n, p) => n + p.amountUsd, 0)
        : 0;
      const loggedCount = paid
        ? payments.filter(
            p => p.clickupTaskId === card.taskId && p.day >= oldest.date,
          ).length
        : 0;
      const baseline = round2(oldest.value);
      const target = round2(baseline + logged);
      const current = typeof card.ltvUsd === "number" ? card.ltvUsd : null;
      out.push({
        clickupTaskId: card.taskId,
        client: card.name,
        baseline,
        baselineDay: oldest.date,
        logged: round2(logged),
        loggedCount,
        target,
        current,
        delta: round2(target - (current ?? 0)),
      });
    }
    return {
      rows: out
        .filter(r => r.loggedCount > 0 || Math.abs(r.delta) >= 0.01)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      missing: missing.sort((a, b) => a.client.localeCompare(b.client)),
      outOfScope,
    };
  },
});

/**
 * Put a starting LTV on a card that has none, so it gains a baseline.
 *
 * A card with an empty LTV field is left out of every figure here, because
 * assuming zero would erase whatever the client actually paid before the
 * cockpit existed. The only cure is somebody who knows the number typing it in,
 * and this is that door. It refuses a card that already carries a figure:
 * changing an existing baseline is a different and much riskier act, and it
 * belongs in the recompute above rather than here.
 */
export const setStartingFigures = internalAction({
  args: {
    userId: v.id("users"),
    entries: v.array(v.object({ taskId: v.string(), value: v.number() })),
  },
  returns: v.any(),
  handler: async (
    ctx,
    { userId, entries },
  ): Promise<{
    written: { client: string; value: number }[];
    errors: string[];
  }> => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, { userId });
    const cards: { taskId: string; name: string; ltvUsd?: number }[] =
      await ctx.runQuery(internal.ceo.billing.allBilling, {});
    const errors: string[] = [];
    const written: { client: string; value: number }[] = [];
    const audit: LtvRow[] = [];

    for (const e of entries) {
      const card = cards.find(c => c.taskId === e.taskId);
      if (!card) {
        errors.push(`${e.taskId}: no client card with that id`);
        continue;
      }
      if (typeof card.ltvUsd === "number") {
        errors.push(
          `${card.name}: already carries $${card.ltvUsd}, so it has a baseline already`,
        );
        continue;
      }
      if (!Number.isFinite(e.value) || e.value < 0) {
        errors.push(
          `${card.name}: ${e.value} is not a figure that can be written`,
        );
        continue;
      }
      try {
        unwrap(
          await callTool("pd_clickup_proxy_post", {
            url: `https://api.clickup.com/api/v2/task/${e.taskId}/field/${CFB.ltv}`,
            json_body: { value: e.value },
          }),
        );
        written.push({ client: card.name, value: e.value });
        audit.push({
          clickupTaskId: e.taskId,
          client: card.name,
          baseline: e.value,
          baselineDay: "(set by hand)",
          logged: 0,
          loggedCount: 0,
          target: e.value,
          current: null,
          delta: e.value,
        });
      } catch (err) {
        errors.push(
          `${card.name}: ${String(err instanceof Error ? err.message : err).slice(0, 140)}`,
        );
      }
    }
    if (audit.length)
      await ctx.runMutation(internal.ceo.ltv.recordWrite, { rows: audit, by });
    return { written, errors };
  },
});

/** The before-and-after the screen shows before anything is written. */
export const preview = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<LtvPlan> => {
    await requireCeo(ctx);
    return await ctx.runQuery(internal.ceo.ltv.plan, { userId: ctx.userId });
  },
});

/** The signed-in CEO's email, for the audit row. */
export const whoami = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "").toLowerCase();
    if (!isCeoEmail(email)) throw new Error("The CEO cockpit is Aziz's only.");
    return email;
  },
});

/** One line per card written, kept so a figure on ClickUp can always be traced. */
export const recordWrite = internalMutation({
  args: {
    rows: v.array(v.any()),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { rows, by }) => {
    const at = Date.now();
    for (const r of rows)
      await ctx.db.insert("ceoAudit", {
        action: "ltv.write",
        table: "ceoClientBilling",
        rowId: String(r.clickupTaskId),
        what: `Set ${r.client}'s LTV to $${r.target.toLocaleString("en-US")} on ClickUp: a baseline of $${r.baseline.toLocaleString("en-US")} taken ${r.baselineDay} plus ${r.loggedCount} logged payment${r.loggedCount === 1 ? "" : "s"} worth $${r.logged.toLocaleString("en-US")}.`,
        before: { ltvUsd: r.current },
        after: { ltvUsd: r.target },
        by,
        at,
      });
    return null;
  },
});

/**
 * Write the computed LTV onto the client cards.
 *
 * Only cards whose field is actually wrong are touched, and only by the amount
 * the ledger explains. A card the plan cannot compute a baseline for is never
 * written at all.
 */
export const apply = authenticatedAction({
  args: { taskIds: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (
    ctx,
    { taskIds },
  ): Promise<{ written: number; skipped: number; errors: string[] }> => {
    const { rows }: LtvPlan = await ctx.runQuery(internal.ceo.ltv.plan, {
      userId: ctx.userId,
    });
    // The gate already passed inside plan(); this is the email it passed as,
    // so the audit row names a person rather than "the cockpit".
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const pick = taskIds?.length ? new Set(taskIds) : null;
    const errors: string[] = [];
    const done: LtvRow[] = [];
    let skipped = 0;

    for (const r of rows) {
      if (pick && !pick.has(r.clickupTaskId)) continue;
      if (Math.abs(r.delta) < 0.01) {
        skipped += 1;
        continue;
      }
      try {
        unwrap(
          await callTool("pd_clickup_proxy_post", {
            url: `https://api.clickup.com/api/v2/task/${r.clickupTaskId}/field/${CFB.ltv}`,
            json_body: { value: r.target },
          }),
        );
        done.push(r);
      } catch (e) {
        errors.push(
          `${r.client}: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`,
        );
      }
    }

    if (done.length)
      await ctx.runMutation(internal.ceo.ltv.recordWrite, {
        rows: done,
        by,
      });
    return { written: done.length, skipped, errors };
  },
});
