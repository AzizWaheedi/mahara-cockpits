import { expect, test } from "bun:test";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002",
  C = "00000000-0000-4000-8000-000000000003";
// Yesterday in Kuwait: inside the function's one-week window on any run date.
const DAY = new Date(Date.now() + 3 * 3600000 - 86400000)
  .toISOString()
  .slice(0, 10);
async function fixture() {
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(`CREATE TABLE cockpit_campaigns(client_name text,meta_account_id text,source_deleted boolean DEFAULT false,updated_at timestamptz DEFAULT now());
 CREATE TABLE cockpit_csm_meta_activities(account_id text,event_time timestamptz,actor_name text,event_type text,translated_event_type text,object_type text,object_name text);
 CREATE TABLE cockpit_meta_people(actor_name text,kind text);`);
  const owned = migration("20260927a_cockpit_ask_ai_jobs.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed[\s\S]*?\n\$\$;/,
  )![0];
  await db.exec(owned);
  for (let i = 0; i < 2; i++)
    await db.exec(migration("20261024r_media_eod_meta_changes.sql"));
  await member(db, A, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, B, "lead@tests.invalid", ["media_buyer"]);
  await member(db, C, "csm@tests.invalid", ["csm"]);
  await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${A}';
 INSERT INTO cockpit_campaigns(client_name,meta_account_id,source_deleted) VALUES('Alpha','111',false),('Beta','act_222',false),('Gone','333',true);
 INSERT INTO cockpit_meta_people VALUES('Nada Al Saed','mahara'),('Muhammed Burhan','mahara');
 INSERT INTO cockpit_csm_meta_activities VALUES
  ('111',('${DAY}'::timestamp+interval '9 hours') AT TIME ZONE 'Asia/Kuwait','Nada Al Saed','update_ad_set_budget','Ad set budget updated','ADSET','Alpha set'),
  ('111',('${DAY}'::timestamp+interval '27 hours 30 minutes') AT TIME ZONE 'Asia/Kuwait','Nada Al Saed','create_ad','Ad created','AD','After midnight, same EOD day'),
  ('111',('${DAY}'::timestamp+interval '3 hours') AT TIME ZONE 'Asia/Kuwait','Nada Al Saed','create_ad','Ad created','AD','Before 04:00, the day before'),
  ('111',('${DAY}'::timestamp+interval '29 hours') AT TIME ZONE 'Asia/Kuwait','Nada Al Saed','create_ad','Ad created','AD','After 04:00, the next day'),
  ('111',('${DAY}'::timestamp+interval '10 hours') AT TIME ZONE 'Asia/Kuwait','Outside Person','update_campaign_run_status','Campaign status updated','CAMPAIGN','Outsider'),
  ('222',('${DAY}'::timestamp+interval '11 hours') AT TIME ZONE 'Asia/Kuwait','Muhammed Burhan','update_ad_run_status','Ad status updated','AD','Beta ad'),
  ('333',('${DAY}'::timestamp+interval '12 hours') AT TIME ZONE 'Asia/Kuwait','Nada Al Saed','create_ad','Ad created','AD','Retired account');`);
  return db;
}
test("a buyer reads only Mahara people, only her clients, only the EOD day from 04:00 to 04:00", async () => {
  const db = await fixture();
  try {
    await actor(db, A);
    const rows = (
      await db.query<any>("SELECT cockpit_media_eod_changes($1::date) v", [DAY])
    ).rows[0].v;
    expect(rows.map((r: any) => r.objectName)).toEqual([
      "Alpha set",
      "After midnight, same EOD day",
    ]);
    expect(rows[0]).toMatchObject({
      client: "Alpha",
      actor: "Nada Al Saed",
      eventType: "Ad set budget updated",
      objectType: "ADSET",
    });
    expect(typeof rows[0].at).toBe("number");
    await actor(db, B);
    const all = (
      await db.query<any>("SELECT cockpit_media_eod_changes($1::date) v", [DAY])
    ).rows[0].v;
    expect(all.map((r: any) => r.client)).toEqual(["Alpha", "Beta", "Alpha"]);
  } finally {
    await db.close();
  }
});
test("other seats, anonymous callers and days outside the week are refused", async () => {
  const db = await fixture();
  try {
    await actor(db, C);
    await expect(
      db.query("SELECT cockpit_media_eod_changes($1::date)", [DAY]),
    ).rejects.toThrow("media-buyer access");
    await actor(db, null);
    await expect(
      db.query("SELECT cockpit_media_eod_changes($1::date)", [DAY]),
    ).rejects.toThrow("permission denied");
    await actor(db, A);
    await expect(
      db.query("SELECT cockpit_media_eod_changes('2026-01-01')"),
    ).rejects.toThrow("within the last week");
    await owner(db);
    const acl = (
      await db.query<any>(
        "SELECT has_function_privilege('anon','public.cockpit_media_eod_changes(date)','EXECUTE') anon,has_function_privilege('authenticated','public.cockpit_media_eod_changes(date)','EXECUTE') auth",
      )
    ).rows[0];
    expect(acl).toEqual({ anon: false, auth: true });
  } finally {
    await db.close();
  }
});
