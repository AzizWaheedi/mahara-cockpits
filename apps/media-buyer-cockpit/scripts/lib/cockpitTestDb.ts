import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

export function migration(name: string): string {
  if (!/^[a-zA-Z0-9_]+\.sql$/.test(name)) throw new Error("Invalid fixture migration name");
  return readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8");
}

function definition(sql: string, pattern: RegExp): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
  return hit[0];
}

/** An isolated PostgreSQL engine. No connection URL or live credentials accepted. */
export async function cockpitTestDb(): Promise<PGlite> {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    `);
    const base = migration("20260922a_cockpit_identity_audit_issue_reports.sql");
    for (const pattern of [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_members \([\s\S]*?\n\);/,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_audit_log \([\s\S]*?\n\);/,
      /CREATE OR REPLACE FUNCTION public\.cockpit_audit_log_immutable\(\)[\s\S]*?\$\$;/,
      /DROP TRIGGER IF EXISTS trg_cockpit_audit_log_immutable[\s\S]*?EXECUTE FUNCTION public\.cockpit_audit_log_immutable\(\);/,
    ]) await db.exec(definition(base, pattern));
    await db.exec(`ALTER TABLE public.cockpit_members ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.cockpit_audit_log ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.cockpit_members, public.cockpit_audit_log FROM anon, authenticated;`);
    await db.exec(migration("20260923m_cockpit_ceo_gate.sql"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function member(db: PGlite, id: string, email: string, roles: string[], active = true, confirmed = true) {
  await db.exec("RESET ROLE");
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,$3)",
    [id, email, confirmed ? "2026-09-01T00:00:00Z" : null]);
  await db.query("INSERT INTO public.cockpit_members(auth_user_id,email,roles,active) VALUES($1,$2,$3,$4)",
    [id, email.toLowerCase().trim(), roles, active]);
}

export async function actor(db: PGlite, id: string | null) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  const claims = id ? (await db.query<{email: string}>("SELECT email FROM auth.users WHERE id=$1", [id])).rows[0] : null;
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id,email:claims?.email,role:id ? "authenticated" : "anon"})]);
  await db.exec(id ? "SET ROLE authenticated" : "SET ROLE anon");
}

export async function owner(db: PGlite) { await db.exec("RESET ROLE"); }
