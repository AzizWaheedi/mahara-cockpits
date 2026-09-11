import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { allAdAccounts, graph, graphPost } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads
type Any = any;

/**
 * Can the cockpit actually WRITE to each ad account?
 *
 * Reading works through the business edges even where writing does not: an
 * account the system user is not assigned to (or is assigned to as an
 * analyst) reads fine and fails the moment a button tries to pause, scale or
 * create. Meta's `execution_options=validate_only` runs the create-campaign
 * request through every permission and validation check and writes nothing,
 * so this is the honest test. Aziz, 2026-09-11: "make sure it actually works".
 */
export const accounts = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const all = await allAdAccounts();
    const out: Any[] = [];
    for (const a of all) {
      const id = String(a.account_id);
      const row: Any = { name: a.name, id };
      try {
        const info: Any = await graph(`act_${id}`, {
          fields:
            "account_status,disable_reason,currency,spend_cap,amount_spent",
        });
        row.status = info.account_status;
        row.currency = info.currency;
        if (info.disable_reason) row.disableReason = info.disable_reason;
      } catch (e) {
        row.read = `FAILED ${String(e).slice(0, 120)}`;
      }
      try {
        // validate_only: full permission + validation pass, nothing created.
        await graphPost(`act_${id}/campaigns`, {
          name: "cockpit write probe (never created)",
          objective: "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: "[]",
          is_adset_budget_sharing_enabled: "false",
          execution_options: '["validate_only"]',
        });
        row.write = "ok";
      } catch (e) {
        const msg = String(e);
        row.write =
          /permission|\(#200\)|\(#10\)|not authorized|does not have/i.test(msg)
            ? `NO PERMISSION ${msg.slice(0, 160)}`
            : `FAILED ${msg.slice(0, 160)}`;
      }
      out.push(row);
    }
    const bad = out.filter(r => r.write !== "ok" || r.read);
    console.log(
      `write probe: ${out.length} accounts, ${bad.length} cannot be written: ${bad
        .map(r => `${r.name} (${r.write ?? r.read})`)
        .join(" | ")
        .slice(0, 800)}`,
    );
    return {
      total: out.length,
      writable: out.length - bad.length,
      bad,
      all: out,
    };
  },
});
