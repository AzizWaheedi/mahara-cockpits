import { beforeAll, afterAll, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";
import { fetchWebinarTargetContext, saveWebinarTargets } from "../src/lib/webinarTargetsClient";
import { WEBINAR_TARGETS } from "../src/types/ceo/webinarTargetsModel";

let db: PGlite;
const founder = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const unconfirmed = "00000000-0000-4000-8000-000000000003";
let calls = 0;
const client = {
  async rpc(name: string, args: Record<string, unknown>) {
    calls++;
    try {
      const result = name === "cockpit_ceo_webinar_target_context"
        ? await db.query<{result:unknown}>("SELECT public.cockpit_ceo_webinar_target_context($1) AS result", [args.p_scope])
        : name === "cockpit_ceo_save_webinar_targets"
          ? await db.query<{result:unknown}>("SELECT public.cockpit_ceo_save_webinar_targets($1,$2,$3::jsonb,$4::uuid) AS result", [args.p_scope, args.p_expected_revision, JSON.stringify(args.p_values), args.p_request_id])
          : (() => { throw new Error(`Unexpected RPC ${name}`); })();
      return {data:result.rows[0].result,error:null};
    } catch (error) { return {data:null,error}; }
  },
} as unknown as SupabaseClient;

beforeAll(async () => {
  db = await cockpitTestDb();
  await db.exec(migration("20260921d_cockpit_metrics.sql"));
  await db.exec(migration("20260926074942_webinar_target_versions.sql"));
  await member(db, founder, "aziz@maharamedia.com", []);
  await member(db, admin, "admin@tests.invalid", ["admin", "ceo"]);
  await member(db, unconfirmed, "awaheedi2008@gmail.com", ["ceo"], true, false);
  await db.query(`INSERT INTO public.cockpit_sections(key,label,computed_at,payload) VALUES('webinar','Fixture',now(),$1::jsonb)`, [JSON.stringify({rounds:[
    {key:"sep",spendFrom:"2026-09-01",registration:{firstRegisteredAt:Date.parse("2026-09-02T10:00:00Z")}},
    {key:"unknown-start",spendFrom:null,registration:{firstRegisteredAt:null}},
  ]})]);
  for (const [revision, at, spend] of [[1,"2026-08-01T00:00:00Z",2000],[2,"2026-09-10T00:00:00Z",3000]] as const) {
    await db.query(`INSERT INTO public.cockpit_webinar_target_versions(scope_key,revision,values,changed_at,changed_by,request_id)
      VALUES('defaults',$1,$2::jsonb,$3::timestamptz,'fixture-import',$4::uuid)`,
      [revision,JSON.stringify({...WEBINAR_TARGETS,plannedSpend:spend}),at,`10000000-0000-4000-8000-00000000000${revision}`]);
  }
  await db.exec(migration("20260926k_cockpit_webinar_target_access.sql"));
}, 15000);
afterAll(async () => { await db.close(); });

test("existing round inherits its historical defaults, not newer defaults", async () => {
  await actor(db, founder);
  const round = await fetchWebinarTargetContext(client, "round:sep");
  expect(round.selection.values.plannedSpend).toBe(2000);
  expect(round.selection.revision).toBe(0);
  expect(round.selection.basis).toBe("defaults");
  const unknown = await fetchWebinarTargetContext(client, "round:unknown-start");
  expect(unknown.selection.basis).toBe("original");
  const raw = await db.query<{context:{startedAt:number}}>("SELECT public.cockpit_ceo_webinar_target_context('round:sep') AS context");
  expect(raw.rows[0].context.startedAt).toBe(Date.parse("2026-09-01T00:00:00+03:00"));
});

test("real client saves, reads after refresh, retries without duplicate version or audit", async () => {
  await actor(db, founder);
  const request = {scope:"round:sep",expectedRevision:0,values:{...WEBINAR_TARGETS,plannedSpend:4200},requestId:"20000000-0000-4000-8000-000000000001"};
  const beforeCalls = calls;
  const saved = await saveWebinarTargets(client, request);
  expect(calls - beforeCalls).toBe(1); // No second read is required to confirm a committed save.
  expect(saved.conflict).toBe(false);
  const refreshed = await fetchWebinarTargetContext(client, "round:sep");
  expect(refreshed.selection.values.plannedSpend).toBe(4200);
  expect(refreshed.selection.revision).toBe(1);
  expect((await saveWebinarTargets(client, request)).conflict).toBe(false);
  const conflict = await saveWebinarTargets(client, {...request,requestId:"20000000-0000-4000-8000-000000000002"});
  expect(conflict).toEqual({conflict:true});
  await owner(db);
  const rows = await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cockpit_webinar_target_versions WHERE scope_key='round:sep'");
  const audits = await db.query<{actor_email:string;after:{values:{plannedSpend:number}}}>("SELECT actor_email,after FROM public.cockpit_audit_log WHERE entity_id='round:sep:1'");
  expect(rows.rows[0].n).toBe(1);
  expect(audits.rows).toHaveLength(1);
  expect(audits.rows[0].actor_email).toBe("aziz@maharamedia.com");
  expect(audits.rows[0].after.values.plannedSpend).toBe(4200);
  await expect(db.query("DELETE FROM public.cockpit_audit_log")).rejects.toThrow("immutable");
});

test("anonymous, ordinary admin, unconfirmed and revoked founder cannot read or write", async () => {
  const args = ["defaults",2,JSON.stringify(WEBINAR_TARGETS),"30000000-0000-4000-8000-000000000001"];
  for (const id of [null, admin, unconfirmed]) {
    await actor(db, id);
    await expect(db.query("SELECT public.cockpit_ceo_webinar_target_context('defaults')")).rejects.toMatchObject({code:"42501"});
    await expect(db.query("SELECT public.cockpit_ceo_save_webinar_targets($1,$2,$3::jsonb,$4::uuid)", args)).rejects.toMatchObject({code:"42501"});
  }
  await owner(db);
  await db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1", [founder]);
  await actor(db, founder);
  await expect(fetchWebinarTargetContext(client, "defaults")).rejects.toThrow("CEO");
  await expect(db.query("SELECT public.cockpit_ceo_save_webinar_targets($1,$2,$3::jsonb,$4::uuid)", args)).rejects.toMatchObject({code:"42501"});
  await owner(db);
  await db.query("UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1", [founder]);
});

test("invalid scopes/values fail, underlying service function and table remain inaccessible", async () => {
  await actor(db, founder);
  for (const scope of ["round:next","round:untagged","round:missing","bad-scope"]) {
    await expect(fetchWebinarTargetContext(client, scope)).rejects.toThrow("scope");
  }
  await expect(db.query("SELECT public.cockpit_ceo_save_webinar_targets('defaults',2,'{}'::jsonb,'30000000-0000-4000-8000-000000000002')")).rejects.toThrow();
  await expect(db.query("SELECT * FROM public.cockpit_webinar_target_versions")).rejects.toMatchObject({code:"42501"});
  await expect(db.query("SELECT public.cockpit_resolve_webinar_scope('defaults')")).rejects.toMatchObject({code:"42501"});
  await expect(db.query("SELECT public.cockpit_save_webinar_targets('defaults',2,$1::jsonb,'spoofed','30000000-0000-4000-8000-000000000003')", [JSON.stringify(WEBINAR_TARGETS)])).rejects.toMatchObject({code:"42501"});
});

test("migration rerun preserves history and service-side inserts also receive one audit", async () => {
  await owner(db);
  await db.exec(migration("20260926k_cockpit_webinar_target_access.sql"));
  expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cockpit_webinar_target_versions")).rows[0].n).toBe(3);
  await db.exec("SET ROLE service_role");
  const request = [JSON.stringify({...WEBINAR_TARGETS,plannedSpend:5000}),"40000000-0000-4000-8000-000000000001"];
  const sql = "SELECT public.cockpit_save_webinar_targets('defaults',2,$1::jsonb,'trusted-worker',$2::uuid)";
  await db.query(sql, request);
  await db.query(sql, request);
  await owner(db);
  expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cockpit_audit_log WHERE entity_id='defaults:3'")).rows[0].n).toBe(1);
});

test("malformed successful responses cannot masquerade as loaded defaults or saved targets", async () => {
  const malformed = {rpc:async () => ({data:{},error:null})} as unknown as SupabaseClient;
  await expect(fetchWebinarTargetContext(malformed, "defaults")).rejects.toThrow("Unrecognized");
  await expect(saveWebinarTargets(malformed,{scope:"defaults",expectedRevision:0,values:WEBINAR_TARGETS,requestId:"50000000-0000-4000-8000-000000000001"})).rejects.toThrow("Unrecognized");
});
