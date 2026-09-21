import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import {
  categorise,
  classifyLine,
  type Exclusion,
  isExcluded,
  KIND_LABEL,
  type LineKind,
  lineHash,
  parseStatement,
  statementId,
  toUsd,
} from "./bank";
import { rest, type SbRow, upsertIgnore, upsertMerge } from "./sbWrite";
import { kuwaitDay } from "./time";

/**
 * The Money tab's bank statement door (Aziz, 2026-09-21). A CBK Online CSV is
 * parsed on the server, every line gets a kind, lines the cockpit already
 * holds are skipped by their bank transaction number, and the statement is
 * kept so the screen can say how old the newest one is. Exclusions (personal
 * spend by card or vendor) are edited here too and re-applied to the lines.
 *
 * Every entry point passes the CEO gate (ltv.whoami) and leaves an audit row.
 * The tables live in Creative Triage (supabase/migrations/20260921c_bank_statements.sql).
 */

const KINDS: LineKind[] = [
  "client_payment",
  "whop_payout",
  "whop_topup",
  "tap_settlement",
  "own_transfer",
  "refund_in",
  "expense",
  "fee",
  "excluded",
  "unknown",
];

const vKind = v.union(...KINDS.map(k => v.literal(k)));

/** One audit row per import, exclusion change or reclassification. */
export const recordAudit = internalMutation({
  args: {
    action: v.string(),
    table: v.string(),
    rowId: v.string(),
    what: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", { ...a, at: Date.now() });
    return null;
  },
});

async function exclusions(): Promise<
  (Exclusion & { id: number; note: string | null })[]
> {
  const rows =
    (await rest(
      "cockpit_expense_exclusions?select=id,kind,pattern,note&order=id",
    )) ?? [];
  return rows.map(r => ({
    id: Number(r.id),
    kind: r.kind === "card" ? "card" : "vendor",
    pattern: String(r.pattern ?? ""),
    note: r.note ? String(r.note) : null,
  }));
}

const usdWords = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

/**
 * Upload one statement. Returns what was read and what was kept, so the
 * screen can say "148 lines, 140 new, 8 already here" before the next refresh
 * folds them into cash and expenses.
 */
export const importStatement = authenticatedAction({
  args: { fileName: v.string(), text: v.string() },
  returns: v.any(),
  handler: async (ctx, { fileName, text }) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    if (text.length > 4_000_000)
      throw new Error(
        "That file is over 4 MB; a statement export is far smaller.",
      );
    const parsed = parseStatement(text);
    if (!parsed.lines.length)
      throw new Error("The statement has no transaction lines.");
    if (!parsed.account) throw new Error("The statement names no account.");
    const rate = toUsd(1, parsed.currency);
    if (rate === null)
      throw new Error(
        `The statement is in ${parsed.currency}, which the cockpit has no fixed rate for.`,
      );
    const ex = await exclusions();
    const sid = statementId(parsed);
    const lines: SbRow[] = parsed.lines.map(l => {
      const kind = classifyLine(l, parsed.accountKind, parsed.account, ex);
      return {
        statement_id: sid,
        account: parsed.account,
        account_kind: parsed.accountKind,
        trsh: l.trsh,
        hash: lineHash(parsed.account, l),
        day: l.day,
        amount: l.amount,
        balance: l.balance,
        reference: l.reference || null,
        currency: parsed.currency,
        usd: toUsd(l.amount, parsed.currency),
        kind,
        category:
          kind === "expense" || kind === "fee" || kind === "excluded"
            ? categorise(l.reference)
            : null,
      };
    });
    const totalDebit = parsed.lines
      .filter(l => l.amount < 0)
      .reduce((t, l) => t + l.amount, 0);
    const totalCredit = parsed.lines
      .filter(l => l.amount > 0)
      .reduce((t, l) => t + l.amount, 0);
    await upsertMerge(
      "cockpit_statements",
      [
        {
          id: sid,
          account: parsed.account,
          account_kind: parsed.accountKind,
          currency: parsed.currency,
          from_day: parsed.fromDay,
          to_day:
            parsed.toDay ?? parsed.lines[parsed.lines.length - 1]?.day ?? null,
          lines: parsed.lines.length,
          total_debit: Math.round(totalDebit * 1000) / 1000,
          total_credit: Math.round(totalCredit * 1000) / 1000,
          closing_balance: parsed.closingBalance,
          file_name: fileName.slice(0, 120),
          imported_by: by,
          imported_at: new Date().toISOString(),
        },
      ],
      "id",
    );
    // Skip lines already held (same bank transaction number): a re-upload of
    // an overlapping period adds only what is new.
    const kept =
      (await upsertIgnore("cockpit_bank_lines", lines, "hash")) ?? [];
    const byKind = new Map<string, { count: number; usd: number }>();
    for (const l of kept) {
      const k = String(l.kind);
      const r = byKind.get(k) ?? { count: 0, usd: 0 };
      r.count += 1;
      r.usd += Number(l.usd ?? 0);
      byKind.set(k, r);
    }
    const clientCash = byKind.get("client_payment")?.usd ?? 0;
    const spend =
      (byKind.get("expense")?.usd ?? 0) + (byKind.get("fee")?.usd ?? 0);
    await ctx.runMutation(internal.ceo.bankImport.recordAudit, {
      action: "bank.import",
      table: "cockpit_statements",
      rowId: sid,
      what: `Imported the ${parsed.account} statement ${parsed.fromDay ?? "?"} to ${parsed.toDay ?? "?"} from ${fileName}: ${parsed.lines.length} lines read, ${kept.length} new, ${usdWords(clientCash)} of client payments and ${usdWords(-spend)} of expenses among the new ones.`,
      after: { lines: parsed.lines.length, kept: kept.length },
      by,
    });
    return {
      statementId: sid,
      account: parsed.account,
      accountKind: parsed.accountKind,
      currency: parsed.currency,
      fromDay: parsed.fromDay,
      toDay: parsed.toDay,
      read: parsed.lines.length,
      kept: kept.length,
      skipped: parsed.lines.length - kept.length,
      problems: parsed.problems.slice(0, 10),
      byKind: [...byKind.entries()].map(([kind, r]) => ({
        kind,
        label: KIND_LABEL[kind as LineKind] ?? kind,
        count: r.count,
        usd: Math.round(r.usd * 100) / 100,
      })),
      totals: {
        debit: parsed.totalDebit,
        credit: parsed.totalCredit,
        closingBalance: parsed.closingBalance,
      },
    };
  },
});

/** The statements held, the exclusions, and how old the newest statement is. */
export const overview = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const statements =
      (await rest(
        "cockpit_statements?select=id,account,account_kind,currency,from_day,to_day,lines,total_debit,total_credit,closing_balance,file_name,imported_at&order=to_day.desc.nullslast,imported_at.desc&limit=36",
      )) ?? [];
    const ex = await exclusions();
    const today = kuwaitDay();
    const last = statements.reduce<string | null>(
      (m, s) =>
        s.to_day && (!m || String(s.to_day) > m) ? String(s.to_day) : m,
      null,
    );
    const daysSince = last
      ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000)
      : null;
    return {
      statements: statements.map(s => ({
        id: String(s.id),
        account: String(s.account),
        accountKind: String(s.account_kind),
        currency: String(s.currency),
        fromDay: s.from_day ? String(s.from_day) : null,
        toDay: s.to_day ? String(s.to_day) : null,
        lines: Number(s.lines ?? 0),
        totalDebit: s.total_debit === null ? null : Number(s.total_debit),
        totalCredit: s.total_credit === null ? null : Number(s.total_credit),
        closingBalance:
          s.closing_balance === null ? null : Number(s.closing_balance),
        fileName: s.file_name ? String(s.file_name) : null,
        importedAt: s.imported_at ? Date.parse(String(s.imported_at)) : null,
      })),
      exclusions: ex,
      lastStatementTo: last,
      daysSince,
      stale: daysSince === null || daysSince > 7,
    };
  },
});

/** Re-read every expense-side line of the last 12 months against the exclusions and fix the ones that changed. */
async function reapplyExclusions(): Promise<number> {
  const ex = await exclusions();
  const since = kuwaitDay(Date.now() - 366 * 86_400_000);
  const rows =
    (await rest(
      `cockpit_bank_lines?select=id,amount,reference,account,account_kind,kind&amount=lt.0&day=gte.${since}&kind=in.(expense,fee,excluded)&limit=5000`,
    )) ?? [];
  let changed = 0;
  for (const r of rows) {
    const next = isExcluded(String(r.reference ?? ""), String(r.account), ex)
      ? "excluded"
      : classifyLine(
          { amount: Number(r.amount), reference: String(r.reference ?? "") },
          r.account_kind === "card" ? "card" : "account",
          String(r.account),
          [],
        );
    if (next !== r.kind) {
      await rest(`cockpit_bank_lines?id=eq.${Number(r.id)}`, {
        method: "PATCH",
        body: { kind: next },
        prefer: "return=minimal",
      });
      changed += 1;
    }
  }
  return changed;
}

/** Keep a card or a vendor out of the P&L. Existing lines are re-sorted at once. */
export const addExclusion = authenticatedAction({
  args: {
    kind: v.union(v.literal("card"), v.literal("vendor")),
    pattern: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const pattern = a.pattern.trim();
    if (pattern.length < 3)
      throw new Error("An exclusion needs at least three characters.");
    const rows = await rest("cockpit_expense_exclusions", {
      method: "POST",
      body: [
        { kind: a.kind, pattern, note: a.note?.trim() || null, added_by: by },
      ],
      prefer: "return=representation",
    });
    const id = rows?.[0]?.id;
    const changed = await reapplyExclusions();
    await ctx.runMutation(internal.ceo.bankImport.recordAudit, {
      action: "bank.exclude",
      table: "cockpit_expense_exclusions",
      rowId: String(id ?? pattern),
      what: `Excluded ${a.kind === "card" ? "the card" : "the vendor"} "${pattern}" from the P&L; ${changed} existing line${changed === 1 ? "" : "s"} moved.`,
      after: { kind: a.kind, pattern },
      by,
    });
    return { id, changed };
  },
});

export const removeExclusion = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const before = (
      await rest(
        `cockpit_expense_exclusions?id=eq.${id}&select=id,kind,pattern`,
      )
    )?.[0];
    if (!before) throw new Error("That exclusion is not on the list.");
    await rest(`cockpit_expense_exclusions?id=eq.${id}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    const changed = await reapplyExclusions();
    await ctx.runMutation(internal.ceo.bankImport.recordAudit, {
      action: "bank.include",
      table: "cockpit_expense_exclusions",
      rowId: String(id),
      what: `Removed the exclusion "${before.pattern}"; ${changed} line${changed === 1 ? "" : "s"} moved back.`,
      before: { kind: before.kind, pattern: before.pattern },
      by,
    });
    return { changed };
  },
});

/** Give one line another kind by hand, for the cases the rules get wrong. */
export const reclassify = authenticatedAction({
  args: { id: v.number(), kind: vKind, note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, a) => {
    const by: string = await ctx.runQuery(internal.ceo.ltv.whoami, {
      userId: ctx.userId,
    });
    const before = (
      await rest(
        `cockpit_bank_lines?id=eq.${a.id}&select=id,kind,reference,usd,day`,
      )
    )?.[0];
    if (!before) throw new Error("That line is not held.");
    await rest(`cockpit_bank_lines?id=eq.${a.id}`, {
      method: "PATCH",
      body: { kind: a.kind, note: a.note?.trim() || null },
      prefer: "return=minimal",
    });
    await ctx.runMutation(internal.ceo.bankImport.recordAudit, {
      action: "bank.reclassify",
      table: "cockpit_bank_lines",
      rowId: String(a.id),
      what: `Marked the ${before.day} line "${String(before.reference ?? "").slice(0, 60)}" (${usdWords(Number(before.usd))}) as ${KIND_LABEL[a.kind]} instead of ${KIND_LABEL[before.kind as LineKind] ?? before.kind}.`,
      before: { kind: before.kind },
      after: { kind: a.kind },
      by,
    });
    return { ok: true };
  },
});
