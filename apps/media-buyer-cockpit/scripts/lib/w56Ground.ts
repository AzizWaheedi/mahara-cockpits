/**
 * What the real 20261102h (wins-pay) stands on beyond the forms chain: the people and pay columns,
 * the pay plans (20261009a hours, 20261011d, 20261018a) and Offer Studio's catalog and proposals
 * table (20261026u whole, 20261026w cut). Taken from wins-pay-supabase.test.ts so the client-tail
 * and Stage 4 suites, which apply the real g, h and i once they are merged, ground h the same way.
 *
 * Call it after 20261102a to f and before 20261102g.
 */

import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./cockpitTestDb";

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

function withoutCron(text: string): string {
  const start = text.indexOf("-- cron:begin");
  if (start < 0) return text;
  const end = text.indexOf("-- cron:end", start);
  if (end < 0) throw new Error("The schedule block is missing its end marker");
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

const PAY = [
  "20261009a_cockpit_team_hours.sql",
  "20261011d_ceo_commission_two_lines.sql",
  "20261018a_ceo_pay_plans.sql",
] as const;

async function payGround(db: PGlite) {
  for (const file of [
    "20260920a_people_commission.sql",
    "20260922c_people_paused.sql",
    "20260922d_people_bot_engagement.sql",
  ]) {
    try {
      await db.exec(migration(file));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  const restore = migration("20261007c_cockpit_rpc_restore.sql");
  await db.exec(
    cut(
      restore,
      /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_people_set_pay\(p_patch jsonb\)[\s\S]*?END \$\$;/,
      "people_set_pay",
    ),
  );
  await db.exec(
    cut(
      restore,
      /CREATE OR REPLACE FUNCTION public\.cockpit_people_write_audit\(\)[\s\S]*?\$\$;/,
      "people_write_audit",
    ),
  );
  await db.exec(
    cut(
      migration("20261007e_cockpit_provider_rpc_restore.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ceo_verified_actor_email\(p_actor_id uuid\)[\s\S]*?\n\$\$;/,
      "verified_actor_email",
    ),
  );
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb), public.cockpit_people_write_audit(),
      public.cockpit_ceo_verified_actor_email(uuid) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_people_set_pay(jsonb) TO authenticated;`);
  await db.exec(`ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
    ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(), ADD COLUMN IF NOT EXISTS owner uuid;
    GRANT USAGE ON SCHEMA storage TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;`);
}

async function offers(db: PGlite) {
  await db.exec(withoutCron(migration("20261026u_upsell_catalog.sql")));
  const w = migration("20261026w_upsell_proposals.sql");
  await db.exec(
    cut(
      w,
      /CREATE OR REPLACE FUNCTION public\.cockpit_upsell_price_ok\(p jsonb\)[\s\S]*?\$\$;/,
      "price ok",
    ),
  );
  // A stand-in for the content shape check (Offer Studio's own tests cover the real one).
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_content_ok(p jsonb, p_offer text) RETURNS boolean
    LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT jsonb_typeof(p) = 'object' $$;`);
  await db.exec(
    cut(
      w,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_upsell_proposals \([\s\S]*?\n\);/,
      "proposals",
    ),
  );
  await db.exec(`ALTER TABLE public.cockpit_upsell_proposals ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.cockpit_upsell_proposals FROM PUBLIC, anon, authenticated;`);
}

/** The pay ground, the pay plans and Offer Studio, in wins-pay's order. */
export async function winsPayGround(db: PGlite) {
  await payGround(db);
  for (const file of PAY) {
    try {
      await db.exec(withoutCron(migration(file)));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  await offers(db);
}
