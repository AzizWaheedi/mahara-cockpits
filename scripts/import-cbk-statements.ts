#!/usr/bin/env bun
/**
 * R1: import CBK statements through the cockpit's own parser and write path.
 *
 * The CEO, 2026-09-19: "credit card statement, my CBK account … You can scan
 * it automatically". This reads each PDF exactly as the Money tab upload does
 * (cockpit-ceo-api index.ts: unpdf 1.8.1 getDocumentProxy + extractText with
 * mergePages:false, pages joined with "\n\f\n"), runs the cockpit's own
 * parser (cockpit-ceo-api core.ts prepareBank → bank.ts), checks the result
 * against what the statement itself prints, compares every line hash with
 * cockpit_bank_lines (SELECT only), and prints what a commit would write.
 *
 * Dry run by default: nothing is written. `--apply --plan <sha256>` commits
 * the exact plan the dry run printed, through cockpit_ceo_action
 * ('bankImport.commit'), the same function the Money tab calls: it is
 * idempotent (statement ON CONFLICT(id) DO NOTHING, lines ON CONFLICT(hash)
 * DO NOTHING, a hash with a different day or amount raises), writes its own
 * audit row and moves the finance revision when a line is kept. That
 * function is gated on the CEO's session, so the transaction sets the CEO's
 * user id as the request's subject on his own Composio Supabase connection,
 * and a second audit row (bankImport.script) records that this script did it
 * for him, with the file and plan hashes. The Money tab upload, signed in as
 * the CEO, is the same door without this script.
 *
 *   bun scripts/import-cbk-statements.ts                       # dry run, the two files in ~/Downloads
 *   bun scripts/import-cbk-statements.ts a.pdf b.pdf           # dry run, these files
 *   bun scripts/import-cbk-statements.ts --apply --plan <sha>  # write the plan the dry run printed
 *
 * Reads production only through `composio execute SUPABASE_BETA_RUN_SQL_QUERY`
 * (stdin closed). Never prints a key.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { prepareBank } from "../supabase/functions/cockpit-ceo-api/core.ts";

export const PROJECT = "bldgtotkfmhoxmlzowdx";
export const CEO_EMAIL = "aziz@maharamedia.com";
/** The commit's fixed rates (cockpit_ceo_action bankImport.commit). */
export const COMMIT_RATE: Record<string, number> = { USD: 1, KWD: 3.26, AED: 0.2723, SAR: 0.2666, QAR: 0.2747 };
export const DEFAULT_FILES = [
  `${homedir()}/Downloads/Credit Card Statement_02_10_2026.PDF`,
  `${homedir()}/Downloads/ACCOUNT_STATEMENT_DETAILS_1791292639700.pdf`,
];

type Body = ReturnType<typeof prepareBank>["body"];
type Line = Body["lines"][number];
export type Checks = {
  /** Lines whose printed balance does not follow from the one before (the parser's own proof). */
  balanceBreaks: number;
  printedDebit: number | null;
  printedCredit: number | null;
  totalsMatch: boolean | null;
  openingBalance: number | null;
  closingFollows: boolean | null;
  footerInReference: number;
};
export type Planned = {
  file: string;
  fileSha256: string;
  pages: number;
  refused: string | null;
  what: string | null;
  body: Body | null;
  checks: Checks | null;
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;
const amountOf = (s: string) => Number(s.replace(/,/g, ""));

/** Checks against what the statement prints, independent of the parser's own totals. */
export function statementChecks(text: string, body: Body, problems: string[]): Checks {
  const flat = text.replace(/\s+/g, " ");
  const credit = /Total Credit Amount\s*([\d,]+\.\d{3})/i.exec(flat);
  const debit = /Total Debit Amount\s*([\d,]+\.\d{3})/i.exec(flat);
  const opening = /Balance B\/Fwd:?\s*([\d,]+\.\d{3})\s*(CR|DR)/i.exec(flat);
  const lines = body.lines;
  const sumDebit = round3(lines.filter(l => l.amount < 0).reduce((t, l) => t + l.amount, 0));
  const sumCredit = round3(lines.filter(l => l.amount > 0).reduce((t, l) => t + l.amount, 0));
  const printedDebit = debit ? -amountOf(debit[1]) : null;
  const printedCredit = credit ? amountOf(credit[1]) : null;
  const openingBalance = opening ? amountOf(opening[1]) * (opening[2].toUpperCase() === "DR" ? -1 : 1) : null;
  const closing = body.statement.closing_balance;
  return {
    balanceBreaks: problems.filter(p => /does not give the printed balance/.test(p)).length,
    printedDebit,
    printedCredit,
    totalsMatch: printedDebit === null || printedCredit === null ? null : printedDebit === sumDebit && printedCredit === sumCredit,
    openingBalance,
    closingFollows: openingBalance === null || closing === null || closing === undefined ? null
      : Math.abs(round3(openingBalance + sumCredit + sumDebit) - closing) < 0.0005,
    footerInReference: lines.filter(l => /Total (Credit|Debit) Amount/i.test(l.reference)).length,
  };
}

/** What a file the parser refuses looks like, in a few words, so the report can say it. */
export function identify(text: string): string | null {
  if (/Account Transaction Details Receipt/i.test(text))
    return "a receipt for one transfer (Account Transaction Details Receipt), not an account statement";
  if (!text.trim()) return "a PDF with no readable text";
  return null;
}

export async function readPdfText(file: string): Promise<{ text: string; pages: number }> {
  // The same package, version and call as the Money tab upload (cockpit-ceo-api index.ts).
  const unpdf = await import("../apps/media-buyer-cockpit/node_modules/unpdf/dist/index.mjs");
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(readFileSync(file)));
  const parsed = await unpdf.extractText(pdf, { mergePages: false });
  return { text: (parsed.text as string[]).join("\n\f\n"), pages: parsed.totalPages };
}

export function plan(file: string, bytes: Buffer, text: string, pages: number): Planned {
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const name = basename(file);
  try {
    const prepared = prepareBank(name, text);
    return { file: name, fileSha256, pages, refused: null, what: null, body: prepared.body, checks: statementChecks(text, prepared.body, prepared.parsed.problems) };
  } catch (e) {
    return { file: name, fileSha256, pages, refused: e instanceof Error ? e.message : String(e), what: identify(text), body: null, checks: null };
  }
}

/** The canonical plan hash: what --apply must be given to write exactly this. */
export function planSha(planned: Planned[]): string {
  const canon = planned.filter(p => p.body).map(p => ({ file: p.file, fileSha256: p.fileSha256, body: p.body }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function kinds(lines: Line[], currency: string) {
  const rate = COMMIT_RATE[currency];
  const by = new Map<string, { count: number; amount: number; usd: number | null }>();
  for (const l of lines) {
    const row = by.get(l.kind) ?? { count: 0, amount: 0, usd: rate === undefined ? null : 0 };
    row.count++;
    row.amount = round3(row.amount + l.amount);
    if (row.usd !== null) row.usd = round2(row.usd + l.amount * rate);
    by.set(l.kind, row);
  }
  return [...by].map(([kind, r]) => ({ kind, ...r })).sort((a, b) => a.kind.localeCompare(b.kind));
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** One SELECT for every hash and statement id in the plan. */
export function existingSql(planned: Planned[]): string {
  const hashes = planned.flatMap(p => p.body?.lines.map(l => l.hash) ?? []);
  const ids = planned.flatMap(p => (p.body ? [p.body.statement.id] : []));
  const arr = (xs: string[]) => `array[${xs.map(sqlText).join(",") || "''"}]::text[]`;
  return `select 'line' as what, hash as key, to_char(day,'YYYY-MM-DD') as day, amount::text as amount, statement_id from public.cockpit_bank_lines where hash = any(${arr(hashes)})
union all
select 'statement', id, to_char(to_day,'YYYY-MM-DD'), lines::text, imported_by from public.cockpit_statements where id = any(${arr(ids)})
union all
select 'newest', id, to_char(to_day,'YYYY-MM-DD'), lines::text, imported_by from (select * from public.cockpit_statements order by to_day desc nulls last limit 1) s
union all
select 'revision', 'finance', null, revision::text || '/' || totals_revision::text, null from public.cockpit_manual_payment_state where id`;
}

/**
 * The write for one statement: the CEO's gated door with his user id as the
 * request's subject, then this script's own audit row. One transaction.
 */
export function commitSql(p: Planned, planHash: string): string {
  if (!p.body) throw new Error(`${p.file} has nothing to commit`);
  const body = JSON.stringify(p.body);
  const meta = JSON.stringify({ script: "scripts/import-cbk-statements.ts", file: p.file, file_sha256: p.fileSha256, plan_sha256: planHash, lines: p.body.lines.length, done_for: CEO_EMAIL });
  // Both quoted blocks are checked: the file name reaches meta in full, the body only its first 120 characters.
  if ([body, meta].some(text => text.includes("$body$") || text.includes("$meta$")))
    throw new Error("The statement text or file name contains a quoting marker; refusing to build SQL");
  return `begin;
select set_config('request.jwt.claim.sub', (select m.auth_user_id::text from public.cockpit_members m where m.email = ${sqlText(CEO_EMAIL)} and m.active), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('request.jwt.claim.sub', true), 'role', 'authenticated', 'email', ${sqlText(CEO_EMAIL)})::text, true);
with result as (select public.cockpit_ceo_action('bankImport.commit', $body$${body}$body$::jsonb) as r)
insert into public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after", metadata)
select 'bankImport.script', 'cockpit_statements', ${sqlText(p.body.statement.id)}, 'claude-for:' || ${sqlText(CEO_EMAIL)}, 'scripts', 'composio-sql', null,
       jsonb_build_object('statementId', r->>'statementId', 'kept', r->'kept'), $meta$${meta}$meta$::jsonb
from result;
commit;`;
}

export function readbackSql(id: string): string {
  return `select s.id, s.lines, s.total_debit::text, s.total_credit::text, to_char(s.to_day,'YYYY-MM-DD') as to_day,
  (select count(*) from public.cockpit_bank_lines l where l.statement_id = s.id) as kept_here,
  (select count(*) from public.cockpit_audit_log a where a.action in ('bankImport.commit','bankImport.script') and a.entity_id = s.id) as audit_rows,
  (select revision::text || '/' || totals_revision::text from public.cockpit_manual_payment_state where id) as revision
  from public.cockpit_statements s where s.id = ${sqlText(id)}`;
}

export function composioSql(query: string): Record<string, unknown>[] {
  const run = spawnSync("composio", ["execute", "SUPABASE_BETA_RUN_SQL_QUERY", "-d", JSON.stringify({ ref: PROJECT, query })],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0 && !run.stdout) throw new Error(`composio failed: ${(run.stderr ?? "").slice(0, 300)}`);
  let out = JSON.parse(run.stdout);
  // A large answer is written to a file and only its path comes back.
  if (out.storedInFile && typeof out.outputFilePath === "string") {
    const file = out.outputFilePath;
    out = JSON.parse(readFileSync(file, "utf8"));
    rmSync(file, { force: true });
  }
  if (!out.successful) throw new Error(`SQL failed: ${String(out.error ?? out.data?.message ?? "unknown").slice(0, 400)}`);
  return (out.data?.result ?? []) as Record<string, unknown>[];
}

export function ageDays(toDay: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${toDay}T00:00:00Z`)) / 86_400_000);
}

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const planArg = args.includes("--plan") ? args[args.indexOf("--plan") + 1] : null;
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--plan").map(f => resolve(f));
  const targets = files.length ? files : DEFAULT_FILES;

  const planned: Planned[] = [];
  for (const file of targets) {
    const bytes = readFileSync(file);
    const { text, pages } = await readPdfText(file);
    planned.push(plan(file, bytes, text, pages));
  }
  const planHash = planSha(planned);
  const existing = composioSql(existingSql(planned));
  const lineRows = new Map(existing.filter(r => r.what === "line").map(r => [String(r.key), r]));
  const statementRows = new Map(existing.filter(r => r.what === "statement").map(r => [String(r.key), r]));
  const newest = existing.find(r => r.what === "newest");
  const revision = existing.find(r => r.what === "revision");
  const today = kuwaitToday();

  console.log(`CBK statement import, ${apply ? "APPLY" : "dry run (nothing is written)"}, ${today} Kuwait`);
  console.log(`Newest statement stored now: ${newest ? `${newest.key}, ends ${newest.day} (${ageDays(String(newest.day), today)} days ago)` : "none"}. Finance revision/totals_revision: ${revision?.amount ?? "unknown"}.`);
  let newestAfter = newest ? String(newest.day) : null;
  const writable: Planned[] = [];
  for (const p of planned) {
    console.log(`\n${p.file}  sha256 ${p.fileSha256}  ${p.pages} page${p.pages === 1 ? "" : "s"}`);
    if (!p.body || !p.checks) {
      console.log(`  Refused by the cockpit's parser: ${p.refused}`);
      if (p.what) console.log(`  It is ${p.what}. Nothing from it is written.`);
      continue;
    }
    const s = p.body.statement;
    const lines = p.body.lines;
    const already = lines.filter(l => lineRows.has(l.hash));
    const conflicts = already.filter(l => {
      const r = lineRows.get(l.hash)!;
      return String(r.day) !== l.day || Number(r.amount) !== l.amount;
    });
    const fresh = lines.filter(l => !lineRows.has(l.hash));
    const debits = round3(lines.filter(l => l.amount < 0).reduce((t, l) => t + l.amount, 0));
    const credits = round3(lines.filter(l => l.amount > 0).reduce((t, l) => t + l.amount, 0));
    console.log(`  Statement ${s.id}: ${s.account_kind} ${s.account}, ${s.currency}, ${s.from_day} to ${s.to_day}`);
    console.log(`  ${lines.length} lines, debits ${debits}, credits ${credits}, closing balance ${s.closing_balance}; parser problems: ${p.body.problems.length}`);
    const c = p.checks;
    console.log(`  Printed totals: debit ${c.printedDebit ?? "not printed"}, credit ${c.printedCredit ?? "not printed"} → ${c.totalsMatch === null ? "cannot compare" : c.totalsMatch ? "match the lines" : "DO NOT match the lines"}`);
    console.log(`  Running balance: ${c.balanceBreaks ? `${c.balanceBreaks} lines break the printed balance` : "every printed balance follows from the one before"}; opening ${c.openingBalance ?? "not printed"} + credits + debits ${c.closingFollows === null ? "cannot be compared with" : c.closingFollows ? "equals" : "DOES NOT equal"} the closing balance`);
    if (c.footerInReference) console.log(`  Note: ${c.footerInReference} line's reference carries the page footer text (the parser's own reading; it does not change the amount or the hash).`);
    console.log(`  Already stored: ${already.length} of ${lines.length} hashes (${already.length ? `${already[0].day} to ${already.at(-1)!.day}` : "none"}); hash conflicts: ${conflicts.length}; statement row ${statementRows.has(s.id) ? "exists" : "is new"}`);
    console.log(`  A commit would keep ${fresh.length} new line${fresh.length === 1 ? "" : "s"}${fresh.length ? ` (${fresh[0].day} to ${fresh.at(-1)!.day})` : ""}, by kind at the commit's fixed rate (1 ${s.currency} = $${COMMIT_RATE[s.currency] ?? "?"}):`);
    for (const k of kinds(fresh, s.currency)) console.log(`    ${k.kind.padEnd(15)} ${String(k.count).padStart(4)}  ${k.amount.toFixed(3).padStart(12)} ${s.currency}  ${k.usd === null ? "no rate" : `$${k.usd.toFixed(2)}`}`);
    if (conflicts.length) {
      console.log("  A stored hash has a different day or amount, so the commit would raise. Nothing from this statement is written.");
      continue;
    }
    if (!fresh.length && statementRows.has(s.id)) {
      console.log("  Nothing new: already imported.");
      continue;
    }
    writable.push(p);
    if (s.to_day && (!newestAfter || s.to_day > newestAfter)) newestAfter = s.to_day;
  }
  if (newestAfter) {
    const age = ageDays(newestAfter, today);
    console.log(`\nAfter this import the newest statement ends ${newestAfter}: ${age} days ago, so ${age > 7 ? "Money and Expenses carry the past-7-days warning until a newer statement is uploaded" : "it is inside the 7-day window"}.`);
  }
  console.log(`Plan sha256: ${planHash}`);
  if (!apply) {
    console.log(writable.length ? `To write it: bun scripts/import-cbk-statements.ts${files.length ? ` ${files.map(f => JSON.stringify(f)).join(" ")}` : ""} --apply --plan ${planHash}` : "Nothing to write.");
    return;
  }
  if (planArg !== planHash) throw new Error("--apply needs --plan with the sha256 this dry run printed; the plan changed or was not given. Nothing was written.");
  for (const p of writable) {
    composioSql(commitSql(p, planHash));
    const [r] = composioSql(readbackSql(p.body!.statement.id));
    console.log(`Written ${p.body!.statement.id}: ${JSON.stringify(r)}`);
  }
}

if (import.meta.main) await main();
