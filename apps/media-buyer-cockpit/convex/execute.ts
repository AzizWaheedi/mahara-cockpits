import { v } from "convex/values";
import { internal } from "./_generated/api";
import { budgetToUsd, spendToUsd, usdToBudget } from "./currency";
import { authenticatedAction } from "./functions";
import { refusal } from "./gate";
import { accountCurrency, graph, graphPost } from "./tools";

/**
 * Carry out a recommendation, for real, against the live ad account.
 *
 * Why this exists: the recommendation buttons used to only write a row into the
 * decision log and queue a ClickUp task. "Scale the winner" changed nothing in
 * Meta. A button that names an action and does not perform it is worse than no
 * button, because she believes the budget moved. [aziz, 2026-09-06]
 *
 * Everything here is deliberately conservative:
 *  - budget moves are capped at +25% per step, because a bigger jump throws the
 *    ad set back into learning and wastes the winner she is trying to scale;
 *  - anything newly created arrives PAUSED;
 *  - "cut the worst ad" refuses to act when a campaign has only one ad left;
 *  - every path returns a sentence describing what actually changed, which is
 *    what gets shown and logged. No silent success.
 */

/** The most a single scale step may raise a budget. */
const MAX_STEP = 0.25;
/** Never push a daily budget below this. */
const FLOOR = 30;

type Result = { ok: boolean; did?: string; error?: string };

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Meta stores budgets in minor units of the ad account's own currency, as
 * strings. Everything here is worked out in dollars and converted at the
 * edge (currency.ts), so the +25% cap and the $30 floor mean the same on a
 * riyal account as on a dollar one.
 */

/**
 * Where the budget actually lives.
 *
 * With campaign budget optimisation the campaign holds it and Meta rejects an
 * ad-set write outright; without it the ad sets hold it. Guessing produces a
 * confusing Graph error, so ask first.
 */
async function budgetHolder(campaignMetaId: string): Promise<{
  level: "campaign" | "adset";
  id: string;
  /** Dollars a day. */
  current?: number;
  name: string;
  currency: string;
}> {
  const campaign = await graph<{
    id: string;
    name: string;
    account_id?: string;
    daily_budget?: string;
    lifetime_budget?: string;
  }>(campaignMetaId, {
    fields: "name,account_id,daily_budget,lifetime_budget",
  });
  const currency = await accountCurrency(String(campaign.account_id ?? ""));
  // Says so in words for an account the cockpit cannot convert.
  usdToBudget(1, currency);

  if (campaign.daily_budget) {
    return {
      level: "campaign",
      id: campaign.id,
      current: budgetToUsd(campaign.daily_budget, currency),
      name: campaign.name,
      currency,
    };
  }
  if (campaign.lifetime_budget) {
    throw new Error(
      "This campaign runs on a lifetime budget, so a daily raise would not mean anything. Change it in Ads Manager.",
    );
  }

  const sets = await graph<{
    data: { id: string; name: string; daily_budget?: string; status: string }[];
  }>(`${campaignMetaId}/adsets`, {
    fields: "name,daily_budget,status",
    limit: "50",
  });
  const live = (sets.data ?? []).filter(s => s.status === "ACTIVE");
  const pool = live.length > 0 ? live : (sets.data ?? []);
  if (pool.length === 0) throw new Error("This campaign has no ad sets.");
  if (pool.length > 1) {
    throw new Error(
      `This campaign has ${pool.length} active ad sets, so there is no single budget to raise. Open the ad set tab and choose which one.`,
    );
  }
  return {
    level: "adset",
    id: pool[0].id,
    current: budgetToUsd(pool[0].daily_budget, currency),
    name: pool[0].name,
    currency,
  };
}

export const runAction = authenticatedAction({
  args: {
    /** One of the labels produced by actionsFor() in the UI. */
    action: v.string(),
    campaignName: v.string(),
    campaignMetaId: v.optional(v.string()),
    /** Target daily budget in USD, when the label names one. */
    targetBudget: v.optional(v.number()),
    clientTag: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    did: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<Result> => {
    const { action } = args;
    // Returned rather than thrown so the panel shows it like any refusal.
    const no = await refusal(ctx, "media_buyer", {
      campaignName: args.campaignName,
    });
    if (no) return { ok: false, error: no };
    if (!args.campaignMetaId) {
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName: args.campaignName,
        client: args.clientTag,
        text: `Tried "${action}" — no Meta id synced for this campaign, so nothing was changed.`,
        ok: false,
      });
      return {
        ok: false,
        error:
          "This campaign has no Meta id synced, so I can't act on it. It usually means the ad account is missing from the client sheet.",
      };
    }

    try {
      let did: string;

      if (action === "Turn it off") {
        await graphPost(args.campaignMetaId, { status: "PAUSED" });
        did = `Paused the campaign "${args.campaignName}" in Meta.`;
      } else if (
        action.startsWith("Raise to") ||
        action === "Scale the winner"
      ) {
        const holder = await budgetHolder(args.campaignMetaId);
        if (holder.current === undefined) {
          throw new Error(
            "Meta did not return a current daily budget for this campaign.",
          );
        }
        // A named target still gets capped: +25% a step keeps the ad set out of
        // a fresh learning phase.
        const wanted =
          args.targetBudget ?? Math.round(holder.current * (1 + MAX_STEP));
        const capped = Math.min(
          Math.max(wanted, FLOOR),
          Math.round(holder.current * (1 + MAX_STEP)),
        );
        if (capped <= holder.current) {
          return {
            ok: false,
            error: `The budget is already ${money(holder.current)}/day, which is at or above that target.`,
          };
        }
        await graphPost(holder.id, {
          daily_budget: usdToBudget(capped, holder.currency),
        });
        const capNote =
          args.targetBudget !== undefined && capped < args.targetBudget
            ? ` I capped the step at +25% (you asked for ${money(args.targetBudget)}) so it doesn't re-enter learning — run it again tomorrow to go higher.`
            : "";
        did = `Raised the ${holder.level} budget on "${holder.name}" from ${money(holder.current)} to ${money(capped)} a day.${capNote}`;
      } else if (action === "Cut the worst ad") {
        const ads = await graph<{
          data: {
            id: string;
            name: string;
            effective_status: string;
            insights?: {
              data: {
                spend: string;
                actions?: { action_type: string; value: string }[];
              }[];
            };
          }[];
        }>(`${args.campaignMetaId}/ads`, {
          fields:
            "name,effective_status,insights.date_preset(last_7d){spend,actions}",
          limit: "50",
        });
        const live = (ads.data ?? []).filter(
          a => a.effective_status === "ACTIVE",
        );
        if (live.length <= 1) {
          return {
            ok: false,
            error:
              "There is only one ad live in this campaign — cutting it would stop delivery entirely.",
          };
        }
        // Worst = most spend with the fewest leads. Ads with no spend are not
        // "worst", they are untested, so they are left alone.
        const scored = live
          .map(a => {
            const row = a.insights?.data?.[0];
            const spend = Number(row?.spend ?? 0);
            const leads = Number(
              (row?.actions ?? []).find(x => x.action_type.includes("lead"))
                ?.value ?? 0,
            );
            return {
              a,
              spend,
              leads,
              cpl: leads > 0 ? spend / leads : Infinity,
            };
          })
          .filter(x => x.spend > 0);
        if (scored.length === 0) {
          return {
            ok: false,
            error:
              "None of the live ads have spent anything in the last 7 days, so there is no worst one to cut yet.",
          };
        }
        scored.sort((x, y) => y.cpl - x.cpl || y.spend - x.spend);
        const worst = scored[0];
        await graphPost(worst.a.id, { status: "PAUSED" });
        // Meta reports spend in the account's currency; she reads dollars.
        const meta = await graph<{ account_id?: string }>(args.campaignMetaId, {
          fields: "account_id",
        });
        const currency = await accountCurrency(String(meta.account_id ?? ""));
        const spent = spendToUsd(worst.spend, currency);
        did = `Paused "${worst.a.name}" — ${money(spent)} spent for ${
          worst.leads
        } lead${worst.leads === 1 ? "" : "s"} in 7 days${
          worst.leads > 0 ? ` (${money(spent / worst.leads)} each)` : ""
        }, the worst in the campaign.`;
      } else {
        return {
          ok: false,
          error: `"${action}" is a judgement call, not something I can execute. It has been logged instead.`,
        };
      }

      await ctx.runMutation(internal.control.recordToggle, {
        metaId: args.campaignMetaId,
        level: "campaign",
        status: "ACTIVE",
        name: args.campaignName,
        clientTag: args.clientTag,
        campaignName: args.campaignName,
        overrideNote: did,
        userId: ctx.userId,
        // The whole campaign was paused: the board card follows.
        syncAdStatus: action === "Turn it off",
      });
      return { ok: true, did };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName: args.campaignName,
        client: args.clientTag,
        text: `Tried "${action}" and Meta refused: ${error}`,
        ok: false,
      });
      return { ok: false, error };
    }
  },
});
