import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { authenticatedQuery } from "./functions";
import { allowedClients, assertRole, inScope } from "./roles";

/**
 * The funnel behind the ads.
 *
 * Aziz, 2026-09-07: "he also scripts the funnels and the questions on the
 * funnel if we need to increase lead quality." So this shows the destination
 * of every live ad, and for instant forms the exact question set, marked for
 * which questions actually filter a lead. Rows come from Meta through the
 * media buyer's feed, joined to 30 day spend. Nothing here is estimated.
 */

function norm(x?: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Row = {
  account: string;
  kind: string;
  url?: string;
  formName?: string;
  headline?: string;
  followUpUrl?: string;
  formId?: string;
  formStatus?: string;
  leadsAllTime?: number;
  questions: {
    label: string;
    type: string;
    options: string[];
    isGate: boolean;
  }[];
  gates: number;
  spend: number;
  leads: number;
  cpl?: number;
  ads: { adId: string; adName: string; status: string }[];
};

/**
 * Match a Meta ad account name to a client.
 *
 * Account names are written by hand and never match the board ("Arcturus World
 * Ad Account" against "Arcturus Company"), so containment alone misses most of
 * them. A shared distinctive word is the reliable signal. Industry words are
 * excluded, otherwise every construction company matches every other one.
 */
const GENERIC = new Set([
  "ad",
  "ads",
  "account",
  "acount",
  "company",
  "co",
  "group",
  "llc",
  "wll",
  "est",
  "the",
  "for",
  "and",
  "general",
  "trading",
  "projects",
  "project",
  "construction",
  "constructions",
  "contracting",
  "contractors",
  "engineering",
  "consultant",
  "consultants",
  "consulting",
  "design",
  "designs",
  "interior",
  "interiors",
  "decor",
  "usd",
  "kw",
  "ksa",
  "uae",
  "limited",
  "finishing",
  "buildings",
  "building",
  "industries",
  "industry",
  "mahara",
  "maharamedia",
  "\u0634\u0631\u0643\u0629",
  "\u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a",
  "\u0645\u0642\u0627\u0648\u0644\u0627\u062a",
  "\u0644\u0644\u062a\u0634\u064a\u062f",
]);

function words(x: string): string[] {
  return norm(x)
    .split(" ")
    .filter(w => w.length >= 4 && !GENERIC.has(w));
}

function matches(account: string, aliases: string[]): boolean {
  const a = norm(account);
  if (!a) return false;
  if (
    aliases.some(alias => {
      const b = norm(alias);
      return b.length >= 4 && (a.includes(b) || b.includes(a));
    })
  ) {
    return true;
  }
  const accWords = new Set(words(account));
  return aliases.some(alias => words(alias).some(w => accWords.has(w)));
}

export const list = authenticatedQuery({
  args: { client: v.optional(v.string()) },
  returns: v.object({
    rows: v.array(v.any()),
    byGates: v.array(v.any()),
    questionBank: v.array(v.any()),
    counts: v.object({
      destinations: v.number(),
      accounts: v.number(),
      forms: v.number(),
      noGate: v.number(),
    }),
    syncedAt: v.optional(v.number()),
  }),
  handler: async (ctx, { client }) => {
    await assertRole(ctx, "creative");
    return await buildFunnels(ctx, client, await allowedClients(ctx));
  },
});

export async function buildFunnels(
  ctx: QueryCtx,
  client: string | undefined,
  scope: Set<string> | null,
) {
  let all = (await ctx.db.query("funnels").collect()) as unknown as (Row & {
    syncedAt: number;
  })[];
  // Ad accounts carry no client of their own: with a client list from the
  // portal, keep only the accounts that match one of those clients.
  if (scope) {
    const mine = (await ctx.db.query("clients").collect()).filter(c =>
      inScope(scope, c.name),
    );
    all = all.filter(r =>
      mine.some(c => matches(r.account, [c.name, ...c.aliases])),
    );
  }

  let rows = all;
  if (client) {
    const c = await ctx.db
      .query("clients")
      .withIndex("by_name", q => q.eq("name", client))
      .first();
    const aliases = c ? [c.name, ...c.aliases] : [client];
    rows = all.filter(r => matches(r.account, aliases));
  }

  // Cost by how many filtering questions the form asks. This is the honest
  // version of "does adding questions improve lead quality": we can only see
  // volume and cost per lead here, so the number is labelled as that and not
  // dressed up as a quality score.
  const buckets = new Map<
    string,
    { spend: number; leads: number; forms: number }
  >();
  for (const r of all) {
    if (r.kind !== "Instant form") continue;
    const key = r.gates >= 3 ? "3+" : String(r.gates);
    const b = buckets.get(key) || { spend: 0, leads: 0, forms: 0 };
    b.spend += r.spend;
    b.leads += r.leads;
    b.forms += 1;
    buckets.set(key, b);
  }
  const byGates = [...buckets.entries()]
    .map(([gates, b]) => ({
      gates,
      forms: b.forms,
      spend: Math.round(b.spend),
      leads: b.leads,
      cpl: b.leads ? Math.round((b.spend / b.leads) * 100) / 100 : null,
    }))
    .sort((a, b) => a.gates.localeCompare(b.gates));

  // Every filtering question anyone is asking, with where it is used, so a
  // new form starts from what is already live rather than from scratch.
  const bank = new Map<
    string,
    {
      label: string;
      options: string[];
      accounts: string[];
      leads: number;
      spend: number;
    }
  >();
  for (const r of all) {
    for (const q of r.questions) {
      if (!q.isGate) continue;
      const key = norm(q.label);
      const e = bank.get(key) || {
        label: q.label,
        options: q.options,
        accounts: [],
        leads: 0,
        spend: 0,
      };
      if (!e.accounts.includes(r.account)) e.accounts.push(r.account);
      if (q.options.length > e.options.length) e.options = q.options;
      e.leads += r.leads;
      e.spend += r.spend;
      bank.set(key, e);
    }
  }
  const questionBank = [...bank.values()]
    .map(e => ({
      ...e,
      cpl: e.leads ? Math.round((e.spend / e.leads) * 100) / 100 : null,
      spend: Math.round(e.spend),
    }))
    .sort((a, b) => b.accounts.length - a.accounts.length || b.leads - a.leads);

  return {
    rows: [...rows].sort((a, b) => b.spend - a.spend),
    byGates,
    questionBank,
    counts: {
      destinations: rows.length,
      accounts: new Set(all.map(r => r.account)).size,
      forms: all.filter(r => r.kind === "Instant form").length,
      noGate: all.filter(r => r.kind === "Instant form" && r.gates === 0)
        .length,
    },
    syncedAt: all[0]?.syncedAt,
  };
}
