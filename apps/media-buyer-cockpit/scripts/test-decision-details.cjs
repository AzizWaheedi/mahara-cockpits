// Offline only. Uses an in-memory PostgreSQL instance, never DATABASE_URL.
// Install @electric-sql/pglite outside the repository; point PGLITE_MODULE
// to its package directory. Auth helpers in the SQL fixture are substitutes:
// this proves the decision contract, not deployed Supabase identity/RLS.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const root = path.resolve(__dirname, "../../..");

async function main() {
  const db = new PGlite();
  try {
    await db.exec("SET cockpit.disposable_test = 'on'; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    const base = fs.readFileSync(path.join(root, "supabase/migrations/20260922a_cockpit_identity_audit_issue_reports.sql"), "utf8");
    // Load the actual audit schema and guard, not a test-specific imitation.
    for (const pattern of [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_audit_log \([\s\S]*?\n\);/,
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_log_immutable\(\)[\s\S]*?\$\$;/,
      /DROP TRIGGER IF EXISTS trg_cockpit_audit_log_immutable[\s\S]*?EXECUTE FUNCTION public\.cockpit_audit_log_immutable\(\);/,
    ]) {
      const match = base.match(pattern);
      assert.ok(match, "Canonical audit definition must exist");
      await db.exec(match[0]);
    }
    const fixture = fs.readFileSync(path.join(__dirname, "test-decision-details.sql"), "utf8");
    const expanded = fixture.replace(/^\\set ON_ERROR_STOP on\r?$/gm, "").replace(/^\\i (.+)$/gm, (_, relative) => {
      const include = path.resolve(root, relative.trim());
      assert.ok(include.startsWith(root + path.sep), "Fixture include stays in repository");
      return fs.readFileSync(include, "utf8");
    });
    await db.exec(expanded);
    // A revoked role with a still-present user ID must also be denied.
    await db.exec("UPDATE public._test_session SET current_roles = ARRAY[]::text[];");
    await assert.rejects(
      db.query("SELECT public.cockpit_log_decision('media_buyer', '2026-09-26', 'Fixture', 'hold')"),
      error => error.code === "42501",
    );
    const access = await db.query(`SELECT
      has_function_privilege('anon', 'public.cockpit_log_decision(text,date,text,text,text,text,text,numeric,jsonb)', 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', 'public.cockpit_log_decision(text,date,text,text,text,text,text,numeric,jsonb)', 'EXECUTE') AS staff_execute,
      has_table_privilege('authenticated', 'public.cockpit_decisions', 'INSERT') AS direct_insert`);
    assert.deepEqual(access.rows[0], { anon_execute: false, staff_execute: true, direct_insert: false });
    // Reapplying this additive migration must preserve its audit history.
    const before = await db.query("SELECT count(*)::int AS n FROM public.cockpit_audit_log");
    await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20260926a_cockpit_decision_details.sql"), "utf8"));
    const after = await db.query("SELECT count(*)::int AS n FROM public.cockpit_audit_log");
    assert.equal(after.rows[0].n, before.rows[0].n);
    console.log("PASS: decision persistence, zero values, insert/update/delete audits, immutable history, denied callers, grants and additive rerun.");
    console.log("Local PostgreSQL only; deployed authentication and client isolation remain unverified.");
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
