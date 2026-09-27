import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

let db: PGlite;
const founder = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const unconfirmed = "00000000-0000-4000-8000-000000000003";
const read = (from: string | null, to: string | null) => db.query<{report: unknown}>(
  "SELECT public.cockpit_ceo_call_center_report($1::date,$2::date) AS report", [from, to]);

beforeAll(async () => {
  db = await cockpitTestDb();
  // Instrument the underlying private source: verify exact arguments and preserved result.
  await db.exec(`CREATE FUNCTION public.mahara_call_center_report(date,date,text,text)
    RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('from',$1,'to',$2,
      'agent',$3,'client',$4,'source','canonical report','warnings',jsonb_build_array('fixture warning')) $$;
    REVOKE ALL ON FUNCTION public.mahara_call_center_report(date,date,text,text) FROM PUBLIC;`);
  await member(db,founder,"aziz@maharamedia.com",["admin"]);
  await member(db,admin,"admin@tests.invalid",["admin","ceo"]);
  await member(db,unconfirmed,"awaheedi2008@gmail.com",["admin"],true,false);
  await db.exec(migration("20260927f_cockpit_call_center_access.sql"));
});
afterAll(async () => { await db?.close(); });

test("verified founder receives the original report without filters or manufactured totals",async () => {
  await actor(db,founder);
  expect((await read("2026-09-01","2026-09-27")).rows[0].report).toEqual({
    from:"2026-09-01",to:"2026-09-27",agent:null,client:null,source:"canonical report",warnings:["fixture warning"],
  });
  await expect(db.query("SELECT public.mahara_call_center_report('2026-09-01','2026-09-27',null,null)")).rejects.toThrow();
});
test("anon, ordinary admin, unconfirmed and revoked founder cannot read the private report",async () => {
  for (const id of [null,admin,unconfirmed]) {
    await actor(db,id); await expect(read("2026-09-01","2026-09-27")).rejects.toThrow();
  }
  await owner(db); await db.query("UPDATE cockpit_members SET active=false WHERE auth_user_id=$1",[founder]);
  await actor(db,founder); await expect(read("2026-09-01","2026-09-27")).rejects.toThrow();
  await owner(db); await db.query("UPDATE cockpit_members SET active=true WHERE auth_user_id=$1",[founder]);
});
test("date guard accepts 93 days and refuses null, reversed, invalid and overlong ranges",async () => {
  await actor(db,founder);
  await read("2026-06-27","2026-09-27");
  for (const [from,to] of [[null,"2026-09-27"],["2026-09-27",null],["2026-09-27","2026-09-01"],["2026-06-26","2026-09-27"],["2026-02-30","2026-03-01"]]) {
    await expect(read(from,to)).rejects.toThrow();
  }
});
