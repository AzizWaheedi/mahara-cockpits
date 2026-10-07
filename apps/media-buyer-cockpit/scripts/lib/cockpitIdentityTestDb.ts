import { cockpitTestDb, migration } from "./cockpitTestDb";
import { readFileSync } from "node:fs";

/** Canonical directory constraints, touch and audit triggers are mandatory. */
export async function cockpitIdentityTestDb() {
  const db = await cockpitTestDb();
  try {
    const sql = migration("20260922a_cockpit_identity_audit_issue_reports.sql");
    for (const pattern of [
      /DO \$\$[\s\S]*?cockpit_members_email_normalized[\s\S]*?\$\$;/,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_cockpit_members_auth_user_unique[\s\S]*?;/,
      /CREATE OR REPLACE FUNCTION public\.cockpit_touch_updated_at\(\)[\s\S]*?EXECUTE FUNCTION public\.cockpit_touch_updated_at\(\);/,
      /CREATE OR REPLACE FUNCTION public\.trg_cockpit_members_audit\(\)[\s\S]*?EXECUTE FUNCTION public\.trg_cockpit_members_audit\(\);/,
    ]) {
      const definition = sql.match(pattern)?.[0];
      if (!definition) throw new Error(`Required canonical identity definition missing: ${pattern}`);
      await db.exec(definition);
    }
    await db.exec(readFileSync(new URL("../fixtures/cockpit-editor-catalog.sql", import.meta.url), "utf8"));
    await db.exec(migration("20261004a_cockpit_staff_identity_adoption.sql"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
