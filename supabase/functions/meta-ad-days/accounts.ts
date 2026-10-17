/**
 * Every ad account that spent, found the way hermes/cockpit-sync
 * calculator.ts (metaRowsForMissingAccounts) finds them: one call per edge of
 * Mahara's business (owned_ad_accounts, client_ad_accounts) with the spend
 * over the window folded in, then only the accounts with spend. On 2026-10-16
 * that was 28 of 59 accounts over 30 days; the board roster (cockpit_campaigns)
 * knew 15 of them.
 *
 * Mahara's own ad account (MaharaMedia) is left out like the calculator's
 * INTERNAL_ACCOUNTS: the board is about clients, and the CEO cockpit reads
 * that account on its own.
 *
 * Since 2026-10-17 the same two calls also bring each account's spending
 * limit, amount spent and disable reason, and the discovery returns every
 * listed account (`all`, with its Meta status) beside the ones that spent:
 * the budgets are read for the accounts that spent and for those tied to an
 * Active client, so a budget set and spending nothing shows (the spend-only
 * list can never show it). The ad-day and reach reads stay on the accounts
 * that spent.
 */
import { MAHARA_BUSINESS_ID, metaPages, type GraphDeps, type Row } from "./graph.ts";
import type { Span } from "./days.ts";

export const INTERNAL_ACCOUNT_IDS = new Set(["746108264865897"]);
const INTERNAL_NAMES = new Set(["maharamedia"]);

export type Account = {
  accountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  status: number | null;
  /** Spend over the discovery window, in the account's currency. */
  spend: number;
  edge: "owned" | "client";
  /** Meta's disable_reason (0 none). */
  disableReason: number | null;
  /** The account spending limit and the amount spent against it, Meta's minor units as digits ("0": no limit). */
  spendCap: string | null;
  amountSpent: string | null;
};

/** accounts: the ones that spent (as before); all: every listed account but Mahara's own, each once. */
export type Discovery = { accounts: Account[]; all: Account[]; listed: number; internal: string[]; unreadable: string[] };

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const normal = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function accountFields(span: Span): string {
  return `id,name,currency,timezone_name,account_status,disable_reason,spend_cap,amount_spent,insights.time_range(${JSON.stringify({ since: span.since, until: span.until })}){spend}`;
}

/** One edge row as an account; null when it is not one. */
export function readAccount(row: Row, edge: "owned" | "client"): Account | null {
  const raw = typeof row.id === "string" ? row.id : "";
  const accountId = raw.replace(/^act_/, "");
  if (!/^[0-9]{5,25}$/.test(accountId)) return null;
  const insights = isRow(row.insights) && Array.isArray(row.insights.data) ? row.insights.data : [];
  const first = insights.find(isRow);
  const spend = first ? Number(first.spend) : 0;
  const currency = typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null;
  return {
    accountId,
    name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 200) : null,
    currency,
    timezone: typeof row.timezone_name === "string" && row.timezone_name ? row.timezone_name : null,
    status: typeof row.account_status === "number" ? row.account_status : null,
    spend: Number.isFinite(spend) && spend > 0 ? spend : 0,
    edge,
    disableReason: typeof row.disable_reason === "number" ? row.disable_reason : null,
    spendCap: digits(row.spend_cap),
    amountSpent: digits(row.amount_spent),
  };
}

/** Meta's minor units as digits ("300000", or a number), else null. */
function digits(v: unknown): string | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^[0-9]{1,18}$/.test(s) ? s : null;
}

/** The accounts with spend in `span`, owned first, each once; and every listed account. */
export async function discoverAccounts(graph: GraphDeps, span: Span, only?: Set<string>): Promise<Discovery> {
  const byId = new Map<string, Account>();
  const all = new Map<string, Account>();
  const seen = new Set<string>();
  const internal: string[] = [];
  const unreadable: string[] = [];
  let listed = 0;
  for (const edge of ["owned", "client"] as const) {
    const rows = await metaPages(graph, `${MAHARA_BUSINESS_ID}/${edge}_ad_accounts`, { fields: accountFields(span), limit: 200 }, 10);
    for (const row of rows) {
      const a = readAccount(row, edge);
      if (!a) {
        unreadable.push(String(row.id ?? "?").slice(0, 40));
        continue;
      }
      listed += 1;
      if (seen.has(a.accountId)) continue;
      seen.add(a.accountId);
      if (INTERNAL_ACCOUNT_IDS.has(a.accountId) || (a.name && INTERNAL_NAMES.has(normal(a.name)))) {
        if (a.spend > 0) internal.push(a.accountId);
        continue;
      }
      if (only && !only.has(a.accountId)) continue;
      all.set(a.accountId, a);
      if (a.spend > 0) byId.set(a.accountId, a);
    }
  }
  return { accounts: [...byId.values()], all: [...all.values()], listed, internal, unreadable };
}
