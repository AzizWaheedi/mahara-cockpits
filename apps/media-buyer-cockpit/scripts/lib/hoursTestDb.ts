/**
 * A PGlite database with the roster, the audit log, the CEO gate and the
 * hours migration, with Supabase's default privileges emulated, for the
 * hours RPC tests. Made-up people and figures only.
 */
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./cockpitTestDb";

export const CEO = "00000000-0000-4000-8000-0000000000c1";
export const ADMIN = "00000000-0000-4000-8000-0000000000a1";
export const MEMBER = "00000000-0000-4000-8000-0000000000b1";

function extract(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

export async function hoursTestDb(): Promise<PGlite> {
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const core = migration("20260919_cockpit_core.sql");
  for (const pattern of [
    /create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i,
    /create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i,
  ]) await db.exec(extract(core, pattern, String(pattern)));
  for (const file of [
    "20260919b_people.sql", "20260920a_people_commission.sql", "20260921b_people_schedule.sql",
    "20260922c_people_paused.sql", "20260922d_people_bot_engagement.sql", "20260927c_cockpit_people_access.sql",
    "20260921e_tap_charges.sql",
  ]) await db.exec(migration(file));
  await db.exec(extract(migration("20260926l_cockpit_ceo_goals_access.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_goal_actor\(\)[\s\S]*?END \$\$;/, "cockpit_goal_actor"));
  const restore = migration("20261007c_cockpit_rpc_restore.sql");
  await db.exec(extract(restore, /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_people_set_pay\(p_patch jsonb\)[\s\S]*?END \$\$;/, "people_set_pay"));
  await db.exec(extract(restore, /CREATE OR REPLACE FUNCTION public\.cockpit_people_write_audit\(\)[\s\S]*?\$\$;/, "people_write_audit"));
  await db.exec(`
    REVOKE ALL ON FUNCTION public.cockpit_goal_actor(), public.cockpit_ceo_people_set_pay(jsonb), public.cockpit_people_write_audit() FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb) TO authenticated;
    DROP TRIGGER IF EXISTS cockpit_people_audit ON public.cockpit_people;
    CREATE TRIGGER cockpit_people_audit AFTER INSERT OR UPDATE ON public.cockpit_people FOR EACH ROW EXECUTE FUNCTION public.cockpit_people_write_audit();
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_tap_charges FROM anon, authenticated;`);
  await db.exec(extract(migration("20261007e_cockpit_provider_rpc_restore.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_verified_actor_email\(p_actor_id uuid\)[\s\S]*?\n\$\$;/, "verified_actor_email"));
  await db.exec("REVOKE ALL ON FUNCTION public.cockpit_ceo_verified_actor_email(uuid) FROM PUBLIC, anon, authenticated, service_role;");
  await db.exec(migration("20261009a_cockpit_team_hours.sql"));
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "admin@tests.invalid", ["admin", "ceo"]);
  await member(db, MEMBER, "member@tests.invalid", ["media"]);
  await owner(db);
  return db;
}

/** Act as the service role, the way the Edge Functions call RPCs. */
export async function service(db: PGlite) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("SET ROLE service_role");
}

export { actor, owner };

/** Call `fn(p jsonb)` and return its jsonb. */
export async function call(db: PGlite, fn: string, p: unknown): Promise<Record<string, unknown>> {
  const r = await db.query<{ r: Record<string, unknown> }>(`SELECT public.${fn}($1::jsonb) AS r`, [JSON.stringify(p)]);
  return r.rows[0].r;
}

const ARG_TYPES: Record<string, string> = { p: "jsonb", p_provider: "text", p_month: "date", p_person: "bigint", p_actor_id: "uuid" };

/** The Edge Functions' service-role RPC door, played against PGlite. */
export function pgRpc(db: PGlite) {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (!/^cockpit_[a-z_]+$/.test(name)) throw new Error("Unknown function");
    await service(db);
    const keys = Object.keys(args);
    const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${ARG_TYPES[k] ?? "text"}`).join(", ")}) AS r`;
    const values = keys.map(k => (ARG_TYPES[k] === "jsonb" ? JSON.stringify(args[k]) : args[k]));
    const res = await db.query<{ r: unknown }>(sql, values as unknown[]);
    return res.rows[0]?.r ?? null;
  };
}

/** Receipts into cockpit_hours_provider_health as the service role. */
export function pgReceipts(db: PGlite) {
  return async (row: Record<string, unknown>) => {
    await service(db);
    await db.query("INSERT INTO public.cockpit_hours_provider_health(provider,method,resource,phase,http_status,run_id,receipt_index,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [row.provider, row.method, row.resource, row.phase, row.http_status ?? null, row.run_id ?? null, row.receipt_index ?? null, row.error ?? null]);
  };
}
