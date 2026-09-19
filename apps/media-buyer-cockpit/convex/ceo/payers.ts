import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { isCeoEmail } from "./gate";
import { B2B, num, sql } from "./sb";

declare const process: { env: Record<string, string | undefined> };

/**
 * Who a Whop payer actually is.
 *
 * Two thirds of every dollar Mahara has collected on Whop — $75,471 of
 * $117,052 on 2026-09-19 — belongs to no deal and no client. The only rule
 * that ties a payment to a deal is an email match against the closing form,
 * and it links 42 of 124 paid rows.
 *
 * The rest cannot be recovered by matching harder, and it is worth being clear
 * why: the payer is a person and the client is a company. The single biggest
 * unattributed payer is "Abdullah Alhussaini", six payments worth $8,479,
 * which is AMHECO. No amount of string comparison gets from one to the other.
 *
 * What it needs instead is a short list of human decisions. 50 payers hold all
 * of it and 28 hold $67,947, so mapping the top of the list recovers ninety
 * percent of the missing attribution. A mapping applies to every payment from
 * that payer, past and future, which is what turns lifetime value from a typed
 * guess into something measured.
 *
 * The cockpit only ever suggests. Crediting the wrong client with somebody
 * else's money is worse than leaving it unattributed, so a suggestion is
 * offered, a person confirms it, and the note says why.
 *
 * Storage is `public.cockpit_payer_clients` in the Creative Triage project,
 * reached through PostgREST with the service-role key — the same door the
 * ideation feature uses. Until supabase/migrations/20260919_cockpit_core.sql
 * has been run that table does not exist, and the list still reads: the
 * payers, the money and the suggestions are all worth seeing on their own, and
 * the screen says plainly that assigning is not switched on yet.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "cockpit_payer_clients";

/** Same folding the rest of the cockpit uses to compare names across systems. */
const fold = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  // 404 and 42P01 both mean the migration has not been run yet, which is a
  // state the screen handles rather than an error worth throwing.
  if (res.status === 404 || text.includes("42P01")) return null;
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

export type UnmappedPayer = {
  payer: string;
  payments: number;
  usd: number;
  firstMonth: string;
  lastMonth: string;
  suggestion: { clickupTaskId: string; client: string; why: string } | null;
  mapped: { clickupTaskId: string; client: string; note: string | null } | null;
};

export type PayerList = {
  payers: UnmappedPayer[];
  /** False until the migration has been run; assigning is off until it is. */
  canAssign: boolean;
  totalUsd: number;
  mappedUsd: number;
};

export type CardsFor = {
  email: string;
  cards: { clickupTaskId: string; client: string }[];
};

/** The client cards a payer can be mapped to, and the CEO check for an action. */
export const cardsFor = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "").toLowerCase();
    if (!isCeoEmail(email)) throw new Error("The CEO cockpit is Aziz's only.");
    const cards = await ctx.db.query("ceoClientBilling").collect();
    return {
      email,
      cards: cards.map(c => ({ clickupTaskId: c.taskId, client: c.name })),
    };
  },
});

/**
 * Every Whop payer whose money reaches no deal, biggest first, with a
 * suggestion where the payer's name plainly matches a client card.
 *
 * A suggestion is offered only on an exact fold, or on one name clearly
 * containing the other with at least six characters to go on. A first name
 * alone never suggests anything: "Ahmed" appears on unrelated payments, and
 * matching it to a card would be a coin toss dressed up as a figure.
 */
export const list = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<PayerList> => {
    const { cards }: CardsFor = await ctx.runQuery(
      internal.ceo.payers.cardsFor,
      { userId: ctx.userId },
    );

    const rows = await sql(
      B2B,
      `select coalesce(nullif(btrim(billing_name), ''), user_email) as payer,
              count(*) as payments,
              sum(net_amount) as usd,
              to_char(min(paid_on), 'YYYY-MM') as first_month,
              to_char(max(paid_on), 'YYYY-MM') as last_month
       from public.whop_payments
       where status = 'paid' and deal_response_id is null
         and coalesce(nullif(btrim(billing_name), ''), user_email) is not null
       group by 1
       order by 3 desc`,
    );

    const stored = await rest(`${TABLE}?select=*`);
    const byPayer = new Map((stored ?? []).map(m => [String(m.payer_key), m]));

    const byKey = cards.map(c => ({ ...c, key: fold(c.client) }));

    let totalUsd = 0;
    let mappedUsd = 0;
    const payers = rows.map(r => {
      const payer = String(r.payer);
      const key = fold(payer);
      const usd = Math.round(num(r.usd) * 100) / 100;
      totalUsd += usd;

      let suggestion: UnmappedPayer["suggestion"] = null;
      const exact = byKey.find(c => c.key === key);
      if (exact)
        suggestion = {
          clickupTaskId: exact.clickupTaskId,
          client: exact.client,
          why: "the payer's name and the card's name are the same",
        };
      else if (key.length >= 6) {
        const near = byKey.find(
          c =>
            c.key.length >= 6 && (c.key.includes(key) || key.includes(c.key)),
        );
        if (near)
          suggestion = {
            clickupTaskId: near.clickupTaskId,
            client: near.client,
            why: "one name contains the other",
          };
      }

      const hit = byPayer.get(key);
      if (hit) mappedUsd += usd;
      return {
        payer,
        payments: num(r.payments),
        usd,
        firstMonth: String(r.first_month),
        lastMonth: String(r.last_month),
        suggestion,
        mapped: hit
          ? {
              clickupTaskId: String(hit.clickup_task_id),
              client: String(hit.client_name),
              note: hit.note ? String(hit.note) : null,
            }
          : null,
      };
    });

    return {
      payers,
      canAssign: stored !== null,
      totalUsd: Math.round(totalUsd * 100) / 100,
      mappedUsd: Math.round(mappedUsd * 100) / 100,
    };
  },
});

/** Say who a payer is, or take it back. Always a person's decision. */
export const assign = authenticatedAction({
  args: {
    payer: v.string(),
    /** Null takes an existing mapping back. */
    clickupTaskId: v.union(v.string(), v.null()),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    { payer, clickupTaskId, note },
  ): Promise<{ ok: true; cleared?: true; client?: string }> => {
    const { email, cards }: CardsFor = await ctx.runQuery(
      internal.ceo.payers.cardsFor,
      { userId: ctx.userId },
    );
    const key = fold(payer);
    if (!key) throw new Error("That payer has no name to map.");

    if (clickupTaskId === null) {
      const gone = await rest(
        `${TABLE}?payer_key=eq.${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        },
      );
      if (gone === null)
        throw new Error(
          "The payer table does not exist yet. Run supabase/migrations/20260919_cockpit_core.sql first.",
        );
      return { ok: true as const, cleared: true as const };
    }

    const card = cards.find(c => c.clickupTaskId === clickupTaskId);
    if (!card) throw new Error("No client card with that id.");

    const done = await rest(TABLE, {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: [
        {
          payer: payer.trim().slice(0, 200),
          payer_key: key,
          clickup_task_id: card.clickupTaskId,
          client_name: card.client,
          note: (note ?? "").trim().slice(0, 500) || null,
          mapped_by: email,
        },
      ],
    });
    if (done === null)
      throw new Error(
        "The payer table does not exist yet. Run supabase/migrations/20260919_cockpit_core.sql first.",
      );
    return { ok: true as const, client: card.client };
  },
});
