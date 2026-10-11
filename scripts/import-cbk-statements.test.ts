// R1: the statement import script's checks and SQL. Made-up statements only; no network.
import { expect, test } from "bun:test";
import { ageDays, commitSql, existingSql, identify, kinds, plan, planSha, readbackSql } from "./import-cbk-statements.ts";

const PDF_TEXT = [
  "Card No: 5370xxxxxxxx4348",
  "Statement Period:",
  "01/09/2026 to: 30/09/2026",
  "KWD Pages: 1/1",
  "Balance B/Fwd: 100.000 CR",
  "01/09/2026 31/08/2026 SHOP ONE -",
  "10.000",
  "90.000 CR",
  "02/09/2026 02/09/2026 CARD PAYMENT TIJARI MOBILE +",
  "50.000",
  "140.000 CR",
  "03/09/2026 03/09/2026 Non Sufficient Bal. Decline Fee -",
  "0.150",
  "139.850 CR",
  "Total Credit Amount 50.000 Total Debit Amount 10.150",
  "Balance C/F: 139.850 CR",
].join("\n");

test("a card statement: printed totals, running balance and closing balance all agree", () => {
  const p = plan("/x/Credit Card Statement.PDF", Buffer.from("pdf-bytes"), PDF_TEXT, 1);
  expect(p.refused).toBeNull();
  expect(p.body!.statement).toMatchObject({ id: "5370xxxxxxxx4348:2026-09-01:2026-09-30", account_kind: "card", currency: "KWD", closing_balance: 139.85 });
  expect(p.body!.lines.map(l => [l.day, l.amount, l.kind])).toEqual([
    ["2026-09-01", -10, "expense"],
    ["2026-09-02", 50, "own_transfer"],
    ["2026-09-03", -0.15, "fee"],
  ]);
  expect(p.checks).toEqual({ balanceBreaks: 0, printedDebit: -10.15, printedCredit: 50, totalsMatch: true, openingBalance: 100, closingFollows: true, footerInReference: 1 });
  // The parser joins the page footer to the last transaction's reference, as it did on the real 2 Oct statement.
  expect(p.body!.lines[2].reference).toContain("Total Credit Amount");
  expect(kinds(p.body!.lines, "KWD")).toEqual([
    { kind: "expense", count: 1, amount: -10, usd: -32.6 },
    { kind: "fee", count: 1, amount: -0.15, usd: -0.49 },
    { kind: "own_transfer", count: 1, amount: 50, usd: 163 },
  ]);
});

test("a broken running balance and wrong printed totals are reported, not hidden", () => {
  const broken = PDF_TEXT.replace("140.000 CR", "141.000 CR").replace("Total Credit Amount 50.000", "Total Credit Amount 55.000");
  const p = plan("/x/s.PDF", Buffer.from("b"), broken, 1);
  expect(p.checks!.balanceBreaks).toBeGreaterThan(0);
  expect(p.checks!.totalsMatch).toBe(false);
});

test("a transfer receipt is refused by the parser and named", () => {
  const text = "Account Transaction Details Receipt\nOutgoing INTL transfer - SWIFT\nTransaction Details\n06/10/2026\n-21033.00Amount";
  const p = plan("/x/ACCOUNT_STATEMENT_DETAILS_1.pdf", Buffer.from("r"), text, 1);
  expect(p.body).toBeNull();
  expect(p.refused).toContain("not a CBK statement export");
  expect(p.what).toBe("a receipt for one transfer (Account Transaction Details Receipt), not an account statement");
  expect(identify("")).toBe("a PDF with no readable text");
});

test("the plan hash names exactly what would be written", () => {
  const a = plan("/x/s.PDF", Buffer.from("same"), PDF_TEXT, 1);
  const b = plan("/x/s.PDF", Buffer.from("same"), PDF_TEXT, 1);
  const c = plan("/x/s.PDF", Buffer.from("same"), PDF_TEXT.replace("SHOP ONE", "SHOP TWO"), 1);
  const refused = plan("/x/r.pdf", Buffer.from("r"), "Account Transaction Details Receipt", 1);
  expect(planSha([a])).toBe(planSha([b]));
  expect(planSha([a])).not.toBe(planSha([c]));
  expect(planSha([a, refused])).toBe(planSha([a])); // a refused file adds nothing to write
});

test("the lookup is one SELECT over the plan's hashes and ids", () => {
  const p = plan("/x/s.PDF", Buffer.from("s"), PDF_TEXT, 1);
  const q = existingSql([p]);
  expect(q.trim().toLowerCase().startsWith("select")).toBe(true);
  expect(q).toContain("'4348:2026-09-01:-10.000:90.000'");
  expect(q).toContain("'5370xxxxxxxx4348:2026-09-01:2026-09-30'");
  expect(q).not.toMatch(/\b(insert|update|delete)\b/i);
  expect(existingSql([])).toContain("array['']::text[]");
});

test("the commit goes through the CEO's gated door in one transaction, with the script's own audit row", () => {
  const p = plan("/x/s.PDF", Buffer.from("s"), PDF_TEXT, 1);
  const q = commitSql(p, "f".repeat(64));
  expect(q.startsWith("begin;")).toBe(true);
  expect(q.trim().endsWith("commit;")).toBe(true);
  expect(q).toContain("public.cockpit_ceo_action('bankImport.commit', $body$");
  expect(q).toContain("'bankImport.script'");
  expect(q).toContain('"plan_sha256":"' + "f".repeat(64) + '"');
  expect(q).toContain("where m.email = 'aziz@maharamedia.com' and m.active");
  expect(q).not.toMatch(/insert into public\.cockpit_bank_lines|insert into public\.cockpit_statements/i);
  const quoted = plan("/x/s.PDF", Buffer.from("s"), PDF_TEXT.replace("SHOP ONE", "SHOP $body$ ONE"), 1);
  expect(() => commitSql(quoted, "x")).toThrow(/quoting marker/);
  // A marker past the body's 120-character file name still reaches meta in full.
  const longName = plan(`/x/${"s".repeat(130)}$meta$.PDF`, Buffer.from("s"), PDF_TEXT, 1);
  expect(longName.body?.statement.file_name).not.toContain("$meta$");
  expect(() => commitSql(longName, "x")).toThrow(/quoting marker/);
  expect(readbackSql("it's")).toContain("'it''s'");
});

test("age in days", () => {
  expect(ageDays("2026-10-02", "2026-10-11")).toBe(9);
  expect(ageDays("2026-10-11", "2026-10-11")).toBe(0);
});

// The --apply SQL, run against the repo's own cockpit_ceo_action (its bankImport.commit branch is the
// live one, compared with pg_get_functiondef on 2026-10-11) on PGlite, the way Composio runs it as postgres.
import { actor, cockpitTestDb, member, migration, owner } from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";

function piece(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

test("--apply writes once through the gated door, with both audit rows; a second run keeps nothing", async () => {
  const db = await cockpitTestDb();
  try {
    await db.exec(migration("20260921c_bank_statements.sql"));
    await db.exec(piece(migration("20260927d_cockpit_manual_payments_access.sql"), /CREATE TABLE IF NOT EXISTS public\.cockpit_manual_payment_state\([\s\S]*?ON CONFLICT DO NOTHING;/, "payment state"));
    const actions = migration("20260927h_cockpit_ceo_actions.sql");
    await db.exec(`ALTER TABLE public.cockpit_expense_exclusions ADD COLUMN IF NOT EXISTS removed_at timestamptz;
      ALTER TABLE public.cockpit_bank_lines ADD COLUMN IF NOT EXISTS base_kind text;
      ALTER TABLE public.cockpit_bank_lines ADD COLUMN IF NOT EXISTS manual_kind boolean NOT NULL DEFAULT false;`);
    await db.exec(piece(actions, /CREATE TABLE IF NOT EXISTS public\.cockpit_team_status_state[\s\S]*?ON CONFLICT DO NOTHING;/, "team status state"));
    await db.exec(piece(actions, /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_action\(p_action text[\s\S]*?\nEND \$\$;/, "cockpit_ceo_action"));
    await db.exec("UPDATE public.cockpit_manual_payment_state SET history_ready=true, revision=121");
    await member(db, "00000000-0000-4000-8000-0000000000c1", "aziz@maharamedia.com", []);
    await owner(db);

    const p = plan("/x/Credit Card Statement.PDF", Buffer.from("s"), PDF_TEXT, 1);
    await db.exec(commitSql(p, "a".repeat(64)));
    const id = p.body!.statement.id;
    const lines = (await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_bank_lines WHERE statement_id=$1", [id])).rows[0].n;
    expect(lines).toBe(3);
    const statement = (await db.query<any>("SELECT imported_by, lines, total_debit::text d, total_credit::text c FROM public.cockpit_statements WHERE id=$1", [id])).rows[0];
    expect(statement).toEqual({ imported_by: "aziz@maharamedia.com", lines: 3, d: "-10.150", c: "50.000" });
    const audit = (await db.query<{ action: string; actor_email: string; metadata: any }>("SELECT action, actor_email, metadata FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY action", [id])).rows;
    expect(audit.map(a => [a.action, a.actor_email])).toEqual([["bankImport.commit", "aziz@maharamedia.com"], ["bankImport.script", "claude-for:aziz@maharamedia.com"]]);
    expect(audit[1].metadata).toMatchObject({ script: "scripts/import-cbk-statements.ts", plan_sha256: "a".repeat(64), lines: 3 });
    expect((await db.query<{ r: string }>("SELECT revision::text r FROM public.cockpit_manual_payment_state")).rows[0].r).toBe("122");
    // The claims were local to the transaction: nothing of the CEO's identity is left on the session.
    expect((await db.query<{ s: string | null }>("SELECT nullif(current_setting('request.jwt.claim.sub', true), '') s")).rows[0].s).toBeNull();

    // Idempotent: the same plan again keeps nothing and does not move the revision.
    await db.exec(commitSql(p, "a".repeat(64)));
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_bank_lines")).rows[0].n).toBe(3);
    expect((await db.query<{ r: string }>("SELECT revision::text r FROM public.cockpit_manual_payment_state")).rows[0].r).toBe("122");
    const second = (await db.query<{ after: any }>("SELECT after FROM public.cockpit_audit_log WHERE action='bankImport.script' ORDER BY created_at DESC, (after->>'kept')::int ASC LIMIT 1")).rows[0];
    expect(second.after).toEqual({ statementId: id, kept: 0 });

    // A stored hash with a different amount makes the whole transaction fail: nothing half-written.
    const changed = plan("/x/s2.PDF", Buffer.from("s2"), PDF_TEXT.replace("Statement Period:\n01/09/2026 to: 30/09/2026", "Statement Period:\n01/09/2026 to: 29/09/2026"), 1);
    await db.exec(`UPDATE public.cockpit_bank_lines SET amount=-11 WHERE hash='4348:2026-09-01:-10.000:90.000'`);
    await expect(db.exec(commitSql(changed, "b".repeat(64)))).rejects.toThrow(/conflicts with a stored original/);
    await db.exec("ROLLBACK").catch(() => undefined);
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_statements")).rows[0].n).toBe(1);

    // Without the CEO's member row the door refuses.
    await db.exec("UPDATE public.cockpit_members SET active=false");
    await expect(db.exec(commitSql(p, "a".repeat(64)))).rejects.toThrow(/Founder access required/);
    await db.exec("ROLLBACK").catch(() => undefined);
    void actor;
  } finally {
    await db.close();
  }
}, 30_000);
