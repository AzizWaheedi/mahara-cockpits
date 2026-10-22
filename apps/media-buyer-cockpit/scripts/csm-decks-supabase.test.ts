/**
 * CSM decks backend (20261019120000_csm_decks.sql, docs/csm-decks/CONTENT.md
 * data map, DESIGN.md 10 and 12.3) and its video slots
 * (20261020120000_csm_deck_videos.sql, docs/csm-decks/VIDEOS.md 8) on an
 * isolated PostgreSQL with Supabase's default privileges on, so a missing
 * REVOKE opens the object here as it would in production.
 *
 * It stands on the real client gate (cockpit_csm_client_gate from 20261006c,
 * the seat rule from 20260927a, the roster tables from 20260927v), the real
 * client success seat gate (cockpit_csm_actor from 20260926m, which the video
 * functions call), the real name key (20261012c) and the canonical read-model
 * tables (20260927s/w/x).
 * Campaigns, ads, daily rows, HighLevel accounts, the editor's client cards,
 * the onboarding kit, the call store and the dialer's caller rows are cut-down
 * stand-ins with the live column names. Storage is a stand-in schema with RLS
 * on storage.objects. Every person, client, ad and form is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261019120000_csm_decks.sql";
const VIDEOS = "20261020120000_csm_deck_videos.sql";

const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // csm, Acme only
const CSM_A2 = "00000000-0000-4000-8000-0000000000a2"; // csm, Acme only (a second seat)
const CSM_ALL = "00000000-0000-4000-8000-0000000000a3"; // csm, every client
const CSM_B = "00000000-0000-4000-8000-0000000000b1"; // csm, Beta only
const BUYER = "00000000-0000-4000-8000-0000000000c1"; // media buyer only
const SALES = "00000000-0000-4000-8000-0000000000c2"; // sales only
const CEO = "00000000-0000-4000-8000-0000000000c3";
const GONE = "00000000-0000-4000-8000-0000000000c4"; // csm, deactivated
const UNCONFIRMED = "00000000-0000-4000-8000-0000000000c5"; // csm, email never confirmed

const A = "taskA1";
const B = "taskB1";
const STILL = `https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/${"a".repeat(64)}`;
const STILL_B = `https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/${"b".repeat(64)}`;

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function rows<T = Row>(who: string | null, text: string, params: unknown[] = []): Promise<T[]> {
  await actor(db, who);
  try {
    return (await db.query<T>(text, params)).rows;
  } finally {
    await asOwner();
  }
}
async function one<T = any>(who: string | null, text: string, params: unknown[] = []): Promise<T> {
  return (await rows<{ r: T }>(who, text, params))[0].r;
}
async function refused(who: string | null, text: string, params: unknown[] = []): Promise<string> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
const sources = (who: string, task: string) => one(who, "SELECT public.cockpit_csm_deck_sources($1) r", [task]);
const save = (who: string, task: string, deck: string, patch: unknown) =>
  one(who, "SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r", [task, deck, JSON.stringify(patch)]);
const reserve = (who: string, request: string, task: string, kind: string, mime: string, bytes: number, extra: unknown[] = [null, null, null, null, null, null]) =>
  one(who, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r", [request, task, kind, mime, bytes, ...extra]);
const accept = (who: string, task: string, id: string) => one(who, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid) r", [task, id]);
async function audits(entityType: string): Promise<Row[]> {
  await asOwner();
  return (await db.query<Row>("SELECT * FROM public.cockpit_audit_log WHERE entity_type=$1 ORDER BY created_at, id", [entityType])).rows;
}
async function putObject(name: string, size: number, mimetype: string) {
  await asOwner();
  await db.query("INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('cockpit-launch-ads',$1,$2::jsonb)", [name, JSON.stringify({ size, mimetype })]);
}
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  // Storage as Supabase has it, cut down: buckets, and objects under RLS.
  await db.exec(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb,
      UNIQUE(bucket_id, name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
    -- Another bucket's policy, to show this file's policy does not widen it.
    CREATE POLICY other_bucket_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'team-docs');`);

  // The roster and the client gate, from their canonical migrations.
  const roster = migration("20260927v_csm_read_models.sql");
  await db.exec(cut(roster, /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/, "cockpit_csm_source_state"));
  await db.exec(cut(roster, /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/, "cockpit_csm_source_state rows"));
  await db.exec(cut(roster, /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/, "cockpit_csm_sources"));
  await db.exec("REVOKE ALL ON public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;");
  await db.exec(cut(migration("20260927a_cockpit_ask_ai_jobs.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/, "cockpit_ask_ai_owner_allowed"));
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  await db.exec(cut(gate, /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/, "gate for actor"));
  await db.exec(cut(gate, /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/, "gate"));
  await db.exec(cut(gate, /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/, "gate grants"));
  const ads = migration("20261012c_csm_client_ads.sql");
  await db.exec(cut(ads, /CREATE OR REPLACE FUNCTION public\.cockpit_csm_name_key\([\s\S]*?\$\$;/, "name key"));
  await db.exec(cut(ads, /REVOKE ALL ON FUNCTION public\.cockpit_csm_name_key\(text\)[^\n]*\n/, "name key grants"));

  // The read models, from their canonical migrations.
  const media = migration("20260927w_media_read_models.sql");
  await db.exec(cut(media, /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/, "media state"));
  await db.exec(cut(media, /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/, "media state rows"));
  await db.exec(cut(media, /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/, "media sources"));
  const creative = migration("20260927s_creative_read_models.sql");
  await db.exec(cut(creative, /CREATE TABLE IF NOT EXISTS public\.cockpit_creative_source_state\([\s\S]*?\n\);/, "creative state"));
  await db.exec(cut(creative, /INSERT INTO public\.cockpit_creative_source_state[^\n]*\n/, "creative state rows"));
  await db.exec(cut(creative, /CREATE TABLE IF NOT EXISTS public\.cockpit_creative_sources\([\s\S]*?\n\);/, "creative sources"));
  await db.exec(cut(migration("20260927x_cockpit_native_media_sync.sql"),
    /CREATE TABLE IF NOT EXISTS public\.cockpit_native_stills \([\s\S]*?\n\);/, "native stills"));
  await db.exec(cut(migration("20261003a_client_logos.sql"),
    /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/, "client logos"));

  // Stand-ins with the live column names (checked 2026-10-19).
  await db.exec(`
    CREATE TABLE public.cockpit_campaigns(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, client_name text NOT NULL,
      meta_account_id text, raw_data jsonb NOT NULL DEFAULT '{}', source_deleted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(), cpl numeric, spend_7d numeric, leads_7d numeric);
    CREATE TABLE public.cockpit_ads(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, campaign_name text NOT NULL,
      ad_name text NOT NULL, meta_ad_id text, spend numeric, leads numeric, source_deleted boolean NOT NULL DEFAULT false);
    CREATE TABLE public.cockpit_media_daily_stats(source_id text PRIMARY KEY, campaign_name text, day date, data jsonb NOT NULL);
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, status text, clickup_id text, meta_ad_account text,
      country text, city text, language text, service text, service_mode text, has_token boolean, panel_token text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_client_onboarding(clickup_task_id text PRIMARY KEY, client_name text NOT NULL, signup_on date,
      onboarding_call_on date, launch_on date, links jsonb NOT NULL DEFAULT '{}', forms jsonb NOT NULL DEFAULT '{}', synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_calls(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id text, kind text NOT NULL,
      starts_at timestamptz, ends_at timestamptz, status text NOT NULL, join_url text);
    CREATE TABLE public.caller_fixture(location_id text, email text, name text);
    CREATE FUNCTION public.cockpit_client_caller_rows() RETURNS TABLE(location_id text, email text, name text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT location_id, email, name FROM public.caller_fixture $$;
    REVOKE ALL ON FUNCTION public.cockpit_client_caller_rows() FROM PUBLIC, anon, authenticated;`);

  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, CSM_A2, "csm-a2@tests.invalid", ["csm"]);
  await member(db, CSM_ALL, "csm-all@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await member(db, UNCONFIRMED, "unconfirmed@tests.invalid", ["csm"], true, false);
  await db.query("UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id = ANY($2::uuid[])", [["Acme Interiors"], [CSM_A, CSM_A2]]);
  await db.query("UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2", [["Beta Build"], CSM_B]);
  await db.query("UPDATE public.cockpit_members SET name='Noura Al-Sabah' WHERE auth_user_id=$1", [CSM_A]);
  await db.query("UPDATE public.cockpit_members SET name='csm-b@tests.invalid' WHERE auth_user_id=$1", [CSM_B]);

  // The roster: two real clients, a duplicate card of one, and two clients whose names share a key.
  const snap = "2026-10-19T08:00:00Z";
  const clients = [
    { taskId: A, name: "Acme Interiors", service: "DFY", stage: "Ready For Launch🚀", launchDate: "2026-11-01", bucket: "onboarding" },
    { taskId: B, name: "Beta Build", service: "DWY", stage: "Active", launchDate: null, bucket: "management" },
    { taskId: "taskA2", name: "acme interiors ", stage: "Active" }, // a duplicate card of the same client
    { taskId: "twin1", name: "Gamma Design", stage: "Active" },
    { taskId: "twin2", name: "Gamma Group", stage: "Active" },
  ];
  for (const c of clients)
    await db.query("INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [`c-${c.taskId}`, [c.name], JSON.stringify({ _id: `c-${c.taskId}`, ...c }), snap]);
  await db.query("UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'", [clients.length, snap]);

  // Campaigns. Beta's ad account is named after Acme: a match by account
  // name (as the Ads tab's position() rule does) would hand Acme Beta's form.
  const campaign = (client: string, data: Row, ended = false) =>
    db.query("INSERT INTO public.cockpit_campaigns(client_name,meta_account_id,raw_data,source_deleted,cpl,spend_7d,leads_7d) VALUES($1,$2,$3::jsonb,$4,9.5,700,40)",
      [client, data.metaAccountId, JSON.stringify(data), ended]);
  await campaign("Acme Interiors", { campaignName: "Acme | Kitchens", clientName: "Acme Interiors", metaAccountId: "111111", metaCampaignId: "9001", budgetDaily: 50, cpl: 9.5 });
  await campaign("Beta Build", { campaignName: "Beta | Villas", clientName: "Beta Build", metaAccountId: "222222", metaCampaignId: "9002", accountName: "Acme Interiors shared" });
  await campaign("Gamma Design", { campaignName: "Gamma | Fitout", clientName: "Gamma Design", metaAccountId: "333333", metaCampaignId: "9003" });
  // An account Acme shares with Beta does not count for the account rule.
  await campaign("Acme Interiors", { campaignName: "Acme | Shared", clientName: "Acme Interiors", metaAccountId: "444444", metaCampaignId: "9004" }, true);
  await campaign("Beta Build", { campaignName: "Beta | Shared", clientName: "Beta Build", metaAccountId: "444444", metaCampaignId: "9005" });

  const treeAd = (id: string, campaignName: string, accountId: string, extra: Row = {}) =>
    db.query("INSERT INTO public.cockpit_media_sources(table_name,source_id,data,source_snapshot_at) VALUES('metaTree',$1,$2::jsonb,$3)",
      [`t-${id}`, JSON.stringify({ _id: `t-${id}`, kind: "ad", metaId: id, name: `Ad ${id}`, campaignName, accountId, status: "ACTIVE", effectiveStatus: "ACTIVE", thumbUrl: "https://scontent.fbcdn.net/expiring", ...extra }), snap]);
  await treeAd("50001", "Acme | Kitchens", "111111", { creativeId: "70001", status: "PAUSED", effectiveStatus: "PAUSED" });
  await treeAd("50002", "Acme | Kitchens", "111111", { creativeId: "70002", stillUrl: "https://scontent.fbcdn.net/not-ours" });
  await treeAd("50003", "Acme | Old", "111111", { creativeId: "70003", stillUrl: STILL_B }); // only through Acme's own account
  await treeAd("50006", "Acme | Old", "444444", { creativeId: "70006" }); // shared account: not Acme's
  await treeAd("60001", "Beta | Villas", "222222", { creativeId: "80001" });
  await db.query("INSERT INTO public.cockpit_media_sources(table_name,source_id,data,source_snapshot_at) VALUES('metaTree','t-set',$1::jsonb,$2)",
    [JSON.stringify({ _id: "t-set", kind: "adset", metaId: "40001", campaignName: "Acme | Kitchens", dailyBudget: 50 }), snap]);
  await db.query("UPDATE public.cockpit_media_source_state SET ready=true,row_count=6,source_snapshot_at=$1 WHERE table_name='metaTree'", [snap]);
  await db.query("INSERT INTO public.cockpit_native_stills(key,data) VALUES('c:70001',$1::jsonb)",
    [JSON.stringify({ key: "c:70001", status: "saved", url: STILL, adId: "50001" })]);
  await db.query("INSERT INTO public.cockpit_ads(campaign_name,ad_name,meta_ad_id,spend,leads) VALUES('Acme | Kitchens','Board only','50004',300,12)");
  await db.query("INSERT INTO public.cockpit_media_daily_stats(source_id,campaign_name,day,data) VALUES('d1','Acme | Kitchens','2026-10-10',$1::jsonb)",
    [JSON.stringify({ metaAdId: "50005", spend: 40, leads: 3 })]);

  const funnel = (sourceId: string, data: Row) =>
    db.query("INSERT INTO public.cockpit_creative_sources(table_name,source_id,data,source_snapshot_at) VALUES('funnels',$1,$2::jsonb,$3)",
      [sourceId, JSON.stringify({ _id: sourceId, cpl: 12.5, leads: 40, leadsAllTime: 400, spend: 500, gates: 1, ...data }), snap]);
  await funnel("native:funnels:f1", {
    kind: "Instant form", formId: "8001", formName: "Kitchens form", account: "Acme Interiors", headline: "Tell us about your kitchen",
    ads: [{ adId: "50001", adName: "Ad 50001", status: "PAUSED" }], followUpUrl: "https://acme.example/thanks", url: "http://fb.me/", formStatus: "ACTIVE",
    questions: [
      { type: "CUSTOM", label: "What is your project?", options: ["Villa", "Office", 3], isGate: true, secret: "x" },
      { type: "PHONE", label: "Phone number", options: [], isGate: false },
    ],
  });
  await funnel("m-f1-old", { kind: "Instant form", formId: "8001", formName: "Kitchens form (old copy)", account: "acme", ads: [{ adId: "50001" }], questions: [] });
  await funnel("native:funnels:f2", { kind: "Instant form", formId: "8002", formName: "Beta form", account: "Acme Interiors", ads: [{ adId: "60001" }], questions: [{ type: "CUSTOM", label: "Beta question" }] });
  await funnel("native:funnels:f3", { kind: "Instant form", formId: "8003", formName: "Mixed form", account: "Acme Interiors", ads: [{ adId: "50002" }, { adId: "60001" }], questions: [] });
  await funnel("native:funnels:f4", { kind: "WhatsApp", account: "Someone else's name", ads: [{ adId: "50003" }], questions: [] });
  await funnel("native:funnels:f5", { kind: "Instant form", formId: "8005", formName: "Board form", account: "x", ads: [{ adId: "50004" }], questions: [] });
  await funnel("native:funnels:f6", { kind: "Instant form", formId: "8006", formName: "Shared account form", account: "x", ads: [{ adId: "50006" }], questions: [] });
  await db.query("UPDATE public.cockpit_creative_source_state SET ready=true,row_count=7,source_snapshot_at=$1 WHERE table_name='funnels'", [snap]);

  await db.query(`INSERT INTO public.cockpit_client_logos(client_key,clickup_task_id,storage_path,source_url,verified_at,updated_by)
    VALUES('acme interiors',$1,'verified/taskA1/0123456789abcdef.png','https://acme.example','2026-10-03T00:00:00Z','fixture')`, [A]);
  await db.query(`INSERT INTO public.ghl_clients(location_id,client_name,clickup_id,country,city,language,service_mode,has_token,panel_token)
    VALUES('locA','أكمي للتصميم',$1,'qt','Doha','AR','dfy',true,'SECRET-PANEL-TOKEN'),('locB','Beta',$2,'SA','Riyadh','ar','DWY',true,'SECRET-B')`, [A, B]);
  await db.query(`INSERT INTO public.editor_clients(task_id,name,dos_donts,offer,brand_dna,drive_url,instagram,synced_at)
    VALUES($1,'Acme Interiors',E'DO: show real projects\\nDON''T: show prices\\nNOTES: slow payer','Kitchens fitted in six weeks','Warm, exact, local','https://drive.google.com/acme','@acme','2026-10-18T00:00:00Z'),
          ($2,'Beta Build','','Beta offer',NULL,NULL,NULL,'2026-10-18T00:00:00Z')`, [A, B]);
  await db.query(`INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,signup_on,onboarding_call_on,launch_on,links,synced_at)
    VALUES($1,'Acme Interiors','2026-10-01','2026-10-09','2026-11-01',$2::jsonb,'2026-10-18T00:00:00Z')`,
    [A, JSON.stringify({ drive: "https://drive.google.com/acme", contract: "https://contracts.example/secret", sales_call: "https://fathom.example/secret", onboarding_map: "https://map.example/?phase=5" })]);
  await db.query(`INSERT INTO public.caller_fixture VALUES('locA','sara@tests.invalid','Sara Ahmed'),('locA','x@tests.invalid','x@tests.invalid'),('locB','bilal@tests.invalid','Bilal B')`);
  await db.query(`INSERT INTO public.cockpit_csm_calls(task_id,kind,starts_at,ends_at,status,join_url) VALUES
    ($1,'blueprint',now()+interval '2 days',now()+interval '2 days 45 minutes','confirmed','https://zoom.example/secret'),
    ($1,'checkin',now()+interval '20 days',NULL,'booked',NULL),
    ($1,'checkin',now()+interval '34 days',NULL,'booked',NULL),
    ($1,'launch',now()+interval '5 days',NULL,'cancelled',NULL),
    ($1,'onboarding',now()-interval '9 days',NULL,'held',NULL),
    ($1,'other',now()+interval '1 day',NULL,'booked',NULL),
    ($2,'blueprint',now()+interval '1 day',NULL,'booked',NULL)`, [A, B]);

  // The seat gate the video functions call. plpgsql resolves a call only when
  // it runs, so without it the videos file applies and every call fails.
  await db.exec(cut(migration("20260926m_cockpit_csm_state.sql"),
    /CREATE OR REPLACE FUNCTION public\.cockpit_csm_actor\(\)[\s\S]*?END \$\$;/, "csm actor"));
  await db.exec("REVOKE ALL ON FUNCTION public.cockpit_csm_actor() FROM PUBLIC, anon, authenticated, service_role;");

  // Applied twice: the second run must change nothing and raise nothing.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
  await db.exec(migration(VIDEOS));
  await db.exec(migration(VIDEOS));
}, 30000);
afterAll(async () => { await db?.close(); });

describe("tables, grants and the bucket", () => {
  test("browser roles cannot touch either table; the service role reads, inserts and updates only, and row security is on", async () => {
    for (const table of ["cockpit_csm_deck_prep", "cockpit_csm_launch_ads"]) {
      for (const role of ["anon", "authenticated"])
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege($1,$2,$3) ok`, [role, `public.${table}`, privilege])).rows[0].ok).toBe(false);
      for (const privilege of ["SELECT", "INSERT", "UPDATE"])
        expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege('service_role',$1,$2) ok`, [`public.${table}`, privilege])).rows[0].ok).toBe(true);
      // Supabase's default grants are taken back: no delete, and no truncate that would skip the audit.
      for (const privilege of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
        expect((await db.query<{ ok: boolean }>(`SELECT has_table_privilege('service_role',$1,$2) ok`, [`public.${table}`, privilege])).rows[0].ok).toBe(false);
      expect((await db.query<{ rls: boolean }>("SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass", [`public.${table}`])).rows[0].rls).toBe(true);
      expect(await refused(CSM_A, `SELECT * FROM public.${table}`)).toContain("permission denied");
    }
  });

  test("the browser functions run only for signed-in seats; the helpers run for nobody", async () => {
    const fns = (await db.query<{ sig: string; definer: boolean; config: string[] | null }>(`
      SELECT p.oid::regprocedure::text sig, p.prosecdef definer, p.proconfig config FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'cockpit_csm_deck%' OR p.proname LIKE 'cockpit_csm_launch%')`)).rows;
    const browser = [
      "cockpit_csm_launch_object_allowed", "cockpit_csm_deck_sources", "cockpit_csm_deck_prep_read", "cockpit_csm_launch_ads_read",
      "cockpit_csm_launch_ad_get", "cockpit_csm_deck_prep_save", "cockpit_csm_launch_ad_reserve", "cockpit_csm_launch_ad_accept",
      "cockpit_csm_launch_ad_update", "cockpit_csm_launch_ad_remove", "cockpit_csm_launch_ad_stale", "cockpit_csm_launch_ad_purged",
      "cockpit_csm_deck_videos_read", "cockpit_csm_deck_video_save", "cockpit_csm_deck_video_clear",
    ];
    // Plain IMMUTABLE helpers that read no table; every other function is a definer.
    const notDefiners = ["cockpit_csm_deck_text", "cockpit_csm_deck_choice",
      "cockpit_csm_deck_video_slots", "cockpit_csm_deck_video_slot_ok", "cockpit_csm_deck_video_parse"];
    expect(fns.length).toBe(29);
    for (const fn of fns) {
      const name = fn.sig.split("(")[0].replace(/^public\./, "");
      expect(fn.config).toContain('search_path=""');
      expect(fn.definer).toBe(!notDefiners.includes(name));
      const can = async (role: string) => (await db.query<{ ok: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') ok", [role, fn.sig])).rows[0].ok;
      expect(await can("anon")).toBe(false);
      expect(await can("service_role")).toBe(false);
      expect(await can("authenticated")).toBe(browser.includes(name));
    }
    expect(await refused(null, "SELECT public.cockpit_csm_deck_sources($1)", [A])).toContain("permission denied");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_meta($1,'Acme Interiors')", [A])).toContain("permission denied");
  });

  test("the bucket is private, 150 MB, pictures and videos only; one read policy and no write policy", async () => {
    const bucket = (await db.query<Row>("SELECT * FROM storage.buckets WHERE id='cockpit-launch-ads'")).rows;
    expect(bucket).toEqual([{ id: "cockpit-launch-ads", name: "cockpit-launch-ads", public: false, file_size_limit: 157286400,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"] }]);
    const policies = (await db.query<Row>("SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname")).rows;
    expect(policies.map(p => [p.policyname, p.cmd])).toEqual([["cockpit_launch_ads_read", "SELECT"], ["other_bucket_read", "SELECT"]]);
    const triggers = (await db.query<Row>("SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.cockpit_csm_deck_prep'::regclass,'public.cockpit_csm_launch_ads'::regclass) AND NOT tgisinternal ORDER BY 1")).rows;
    expect(triggers.map(t => t.tgname)).toEqual(["cockpit_csm_deck_prep_audit", "cockpit_csm_launch_ads_audit"]);
  });
});

describe("the gate", () => {
  test("a seat scoped to Acme is refused Beta on every function", async () => {
    const calls: [string, unknown[]][] = [
      ["SELECT public.cockpit_csm_deck_sources($1)", [B]],
      ["SELECT public.cockpit_csm_deck_prep_read($1)", [B]],
      ["SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"pain\":\"cost\"}'::jsonb)", [B]],
      ["SELECT public.cockpit_csm_launch_ads_read($1)", [B]],
      ["SELECT public.cockpit_csm_launch_ad_reserve($2::uuid,$1,'custom','image/png',10)", [B, uuid(900)]],
      ["SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [B, uuid(901)]],
      ["SELECT public.cockpit_csm_launch_ad_update($1,$2::uuid,'{\"hidden\":true}'::jsonb)", [B, uuid(901)]],
      ["SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid)", [B, uuid(901)]],
      ["SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid)", [B, uuid(901)]],
      ["SELECT public.cockpit_csm_launch_ad_stale($1)", [B]],
      ["SELECT public.cockpit_csm_launch_ad_purged($1,$2::uuid[])", [B, [uuid(901)]]],
    ];
    for (const [sql, params] of calls) expect(await refused(CSM_A, sql, params)).toContain("not on your access list");
    expect((await audits("cockpit_csm_deck_prep")).length).toBe(0);
  });

  test("seats without client success, a deactivated seat and an unconfirmed one are refused before any read", async () => {
    for (const who of [BUYER, SALES, GONE, UNCONFIRMED])
      expect(await refused(who, "SELECT public.cockpit_csm_deck_sources($1)", [A])).toContain("client-success access is required");
    for (const who of [UNCONFIRMED, GONE]) {
      expect(await refused(who, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"pain\":\"cost\"}'::jsonb)", [A])).toContain("client-success access is required");
      expect(await refused(who, "SELECT public.cockpit_csm_launch_ad_reserve($2::uuid,$1,'custom','image/png',10)", [A, uuid(902)])).toContain("client-success access is required");
    }
    // Signed out, the write functions are not even callable.
    expect(await refused(null, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"pain\":\"cost\"}'::jsonb)", [A])).toContain("permission denied");
    expect(await refused(null, "SELECT public.cockpit_csm_launch_ad_reserve($2::uuid,$1,'custom','image/png',10)", [A, uuid(903)])).toContain("permission denied");
    expect(await refused(null, "SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid)", [A, uuid(903)])).toContain("permission denied");
    await asOwner();
    expect((await db.query("SELECT 1 FROM public.cockpit_csm_launch_ads WHERE request_id = ANY($1::uuid[])", [[uuid(902), uuid(903)]])).rows.length).toBe(0);
    expect(await refused(BUYER, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"pain\":\"cost\"}'::jsonb)", [A])).toContain("client-success access is required");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_sources('bad id!')")).toContain("valid ClickUp client ID");
  });

  test("the CEO and an all-clients seat open both clients", async () => {
    for (const who of [CEO, CSM_ALL]) {
      expect((await sources(who, A)).clientName).toBe("Acme Interiors");
      expect((await sources(who, B)).clientName).toBe("Beta Build");
    }
  });
});

describe("deck sources", () => {
  test("Acme gets its logo, country, offer, Do's & Don'ts, kit, callers and calls, and nothing private", async () => {
    const s = await sources(CSM_A, A);
    expect(typeof s.logo.verifiedAt).toBe("string");
    expect({ ...s.logo, verifiedAt: "x" }).toEqual({ bucket: "cockpit-client-logos", path: "verified/taskA1/0123456789abcdef.png", verifiedAt: "x" });
    expect(s.ghl).toEqual({ name: "أكمي للتصميم", country: "QA", city: "Doha", language: "ar", serviceMode: "DFY" });
    expect(s.presenter).toEqual({ email: "csm-a@tests.invalid", firstName: "Noura" });
    expect((await sources(CSM_B, B)).presenter).toEqual({ email: "csm-b@tests.invalid", firstName: null });
    expect(s.client).toEqual({ stage: "Ready For Launch🚀", service: "DFY", launchDate: "2026-11-01", bucket: "onboarding" });
    expect(s.editor).toMatchObject({ offer: "Kitchens fitted in six weeks", brandDna: "Warm, exact, local", driveUrl: "https://drive.google.com/acme", instagram: "@acme", website: null });
    expect(s.dosDonts.text).toContain("DON'T: show prices");
    expect(s.kit).toEqual({ onboardingCallOn: "2026-10-09", launchOn: "2026-11-01", signupOn: "2026-10-01",
      links: { drive: "https://drive.google.com/acme", onboardingMap: "https://map.example/?phase=5" }, syncedAt: expect.any(String) });
    expect(s.callers).toEqual([{ firstName: null }, { firstName: "Sara" }]);
    expect(Object.keys(s.calls.next).sort()).toEqual(["blueprint", "checkin"]);
    expect(s.calls.next.blueprint.status).toBe("confirmed");
    expect(Date.parse(s.calls.next.checkin.startsAt)).toBeLessThan(Date.now() + 25 * 86400_000);
    expect(Object.keys(s.calls.last)).toEqual(["onboarding"]);
    expect(s.notes).toEqual([]);
    expect(s.prep).toEqual({ onboarding: null, launch: null });
    expect(s.launchAds).toEqual([]);
    const text = JSON.stringify(s);
    // The card's Do's & Don'ts reach the CSM seat whole, as the card has them;
    // the deck keeps DO and DON'T only (deck-launch.test.tsx, "never NOTES").
    for (const leak of ["cpl", "\"leads", "leadsAllTime", "spend", "budget", "dailyBudget", "SECRET", "secret", "zoom.example", "fbcdn", "Beta", "60001", "8002", "8003", "8006", "Bilal"])
      expect(text.includes(leak)).toBe(false);
  });

  test("Acme's Meta ads and forms come by exact ids, never by account name", async () => {
    const meta = (await sources(CSM_A, A)).meta;
    expect(meta.match).toBe("name");
    expect(meta.adsReady).toBe(true);
    expect(meta.campaigns.map((c: Row) => c.id).sort()).toEqual(["9001", "9004"]);
    expect(meta.ads.map((a: Row) => a.id).sort()).toEqual(["50001", "50002", "50003"]);
    const byId = Object.fromEntries(meta.ads.map((a: Row) => [a.id, a]));
    expect(byId["50001"]).toMatchObject({ status: "PAUSED", creativeId: "70001", still: { url: STILL, tinyUrl: null } });
    expect(byId["50002"].still).toBeNull(); // a Facebook CDN link is never passed on
    expect(byId["50003"].still).toEqual({ url: STILL_B, tinyUrl: null });
    expect(meta.funnels.map((f: Row) => f.sourceId).sort()).toEqual(["native:funnels:f1", "native:funnels:f4", "native:funnels:f5"]);
    const form = meta.funnels.find((f: Row) => f.formId === "8001");
    expect(form).toEqual({
      sourceId: "native:funnels:f1", formId: "8001", formName: "Kitchens form", kind: "Instant form", headline: "Tell us about your kitchen",
      url: "http://fb.me/", followUpUrl: "https://acme.example/thanks", formStatus: "ACTIVE", staleReason: null, checkedAt: null,
      questions: [
        { type: "CUSTOM", label: "What is your project?", options: ["Villa", "Office"], isGate: true },
        { type: "PHONE", label: "Phone number", options: [], isGate: false },
      ],
      adIds: ["50001"],
    });
    expect(meta.funnels.find((f: Row) => f.sourceId === "native:funnels:f4")).toMatchObject({ kind: "WhatsApp", formId: null, adIds: ["50003"] });
  });

  test("Beta gets only its own form, and the form shared with Acme's ad goes to neither", async () => {
    const meta = (await sources(CSM_B, B)).meta;
    expect(meta.ads.map((a: Row) => a.id)).toEqual(["60001"]);
    expect(meta.funnels.map((f: Row) => f.formId)).toEqual(["8002"]);
  });

  test("two clients each running a campaign with Meta's default name see only their own ads and forms", async () => {
    await asOwner();
    const added = { campaigns: [] as number[], tree: ["t-50009", "t-60009"], funnels: ["native:funnels:f8", "native:funnels:f9"] };
    for (const [client, account, id] of [["Acme Interiors", "111111", "9008"], ["Beta Build", "222222", "9009"]]) {
      const r = await db.query<{ id: number }>("INSERT INTO public.cockpit_campaigns(client_name,meta_account_id,raw_data) VALUES($1,$2,$3::jsonb) RETURNING id",
        [client, account, JSON.stringify({ campaignName: "New Leads Campaign", clientName: client, metaAccountId: account, metaCampaignId: id })]);
      added.campaigns.push(r.rows[0].id);
    }
    const snap = "2026-10-19T08:00:00Z";
    for (const [id, account] of [["50009", "111111"], ["60009", "222222"]])
      await db.query("INSERT INTO public.cockpit_media_sources(table_name,source_id,data,source_snapshot_at) VALUES('metaTree',$1,$2::jsonb,$3)",
        [`t-${id}`, JSON.stringify({ _id: `t-${id}`, kind: "ad", metaId: id, name: id === "60009" ? "Beta villa reel" : "Acme kitchen reel",
          campaignName: "New Leads Campaign", accountId: account, status: "ACTIVE", effectiveStatus: "ACTIVE" }), snap]);
    // A board row under the shared name carries no account: it is nobody's.
    await db.query("INSERT INTO public.cockpit_ads(campaign_name,ad_name,meta_ad_id) VALUES('New Leads Campaign','Whose?','50010')");
    for (const [source, formId, name, adId] of [["native:funnels:f8", "8008", "Acme kitchens form", "50009"], ["native:funnels:f9", "8009", "Beta villas form", "60009"]])
      await db.query("INSERT INTO public.cockpit_creative_sources(table_name,source_id,data,source_snapshot_at) VALUES('funnels',$1,$2::jsonb,$3)",
        [source, JSON.stringify({ _id: source, kind: "Instant form", formId, formName: name, ads: [{ adId }], questions: [] }), snap]);
    try {
      const acme = (await sources(CSM_A, A)).meta;
      const acmeText = JSON.stringify(acme);
      expect(acme.ads.map((a: Row) => a.id)).toContain("50009");
      expect(acme.funnels.map((f: Row) => f.formId)).toContain("8008");
      for (const leak of ["60009", "Beta villa reel", "222222", "8009", "Beta villas form", "50010"]) expect(acmeText.includes(leak)).toBe(false);
      const beta = (await sources(CSM_B, B)).meta;
      const betaText = JSON.stringify(beta);
      expect(beta.ads.map((a: Row) => a.id).sort()).toEqual(["60001", "60009"]);
      expect(beta.funnels.map((f: Row) => f.formId).sort()).toEqual(["8002", "8009"]);
      for (const leak of ["50009", "Acme kitchen reel", "8008", "50010"]) expect(betaText.includes(leak)).toBe(false);
      for (const patch of [{ form_confirmed: "8009" }, { their_pick: "60009" }, { phones: { feed: "60009" } }])
        expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify(patch)])).toMatch(/own campaigns|this client's creatives/);
      for (const patch of [{ form_confirmed: "8008" }, { their_pick: "50009" }])
        expect(await refused(CSM_B, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [B, JSON.stringify(patch)])).toMatch(/own campaigns|this client's creatives/);
    } finally {
      await asOwner();
      await db.query("DELETE FROM public.cockpit_campaigns WHERE id = ANY($1::bigint[])", [added.campaigns]);
      await db.query("DELETE FROM public.cockpit_media_sources WHERE source_id = ANY($1::text[])", [added.tree]);
      await db.query("DELETE FROM public.cockpit_ads WHERE meta_ad_id = '50010'");
      await db.query("DELETE FROM public.cockpit_creative_sources WHERE source_id = ANY($1::text[])", [added.funnels]);
    }
  });

  test("a duplicate card of the same client gets the same ads; two clients with one name key get none", async () => {
    const twin = (await sources(CSM_A, "taskA2")).meta;
    expect(twin.match).toBe("name");
    expect(twin.ads.map((a: Row) => a.id).sort()).toEqual(["50001", "50002", "50003"]);
    const meta = (await sources(CSM_ALL, "twin1")).meta;
    expect(meta).toMatchObject({ match: "ambiguous", campaigns: [], ads: [], funnels: [] });
    expect(meta.note).toContain("same name key");
  });

  test("unknown is never zero: missing sources come back null with a plain note", async () => {
    const s = await sources(CSM_ALL, "twin2");
    expect(s.logo).toBeNull();
    expect(s.ghl).toBeNull();
    expect(s.editor).toBeNull();
    expect(s.dosDonts).toBeNull();
    expect(s.kit).toBeNull();
    expect(s.callers).toBeNull();
    expect(s.notes.length).toBe(2);
    await db.query("UPDATE public.cockpit_creative_source_state SET ready=false WHERE table_name='funnels'");
    await db.query("UPDATE public.cockpit_media_source_state SET ready=false WHERE table_name='metaTree'");
    try {
      const meta = (await sources(CSM_A, A)).meta;
      expect(meta.ads).toBeNull();
      expect(meta.funnels).toBeNull();
      expect(meta.adsReady).toBe(false);
      expect(meta.funnelsReady).toBe(false);
    } finally {
      await db.query("UPDATE public.cockpit_creative_source_state SET ready=true WHERE table_name='funnels'");
      await db.query("UPDATE public.cockpit_media_source_state SET ready=true WHERE table_name='metaTree'");
    }
    // Beta's card has an empty Do's & Don'ts field: read, and empty.
    expect((await sources(CSM_B, B)).dosDonts.text).toBeNull();
  });
});

describe("prep", () => {
  test("saves merge key by key, a null removes a key, and each change leaves one diff-only audit row", async () => {
    const first = await save(CSM_A, A, "launch", { pain: "cost", goals: { goal90: "  Two villas booked  " }, hidden_slides: ["form", "form"] });
    expect(first).toMatchObject({ changed: true, revision: 1, updatedBy: "csm-a@tests.invalid",
      overrides: { pain: "cost", goals: { goal90: "Two villas booked" }, hidden_slides: ["form"] } });
    const second = await save(CSM_A2, A, "launch", { dialect: "sa", pain: null, selling_point: "A site supervisor on every project" });
    expect(second.revision).toBe(2);
    expect(second.overrides).toEqual({ goals: { goal90: "Two villas booked" }, hidden_slides: ["form"], dialect: "sa", selling_point: "A site supervisor on every project" });
    expect(second.updatedBy).toBe("csm-a2@tests.invalid");
    const same = await save(CSM_A, A, "launch", { dialect: "sa" });
    expect(same).toMatchObject({ changed: false, revision: 2 });
    const rowsNow = await audits("cockpit_csm_deck_prep");
    expect(rowsNow.length).toBe(2);
    expect(rowsNow.map(r => [r.action, r.entity_id, r.actor_email, r.source_app])).toEqual([
      ["deckPrep.save", "taskA1:launch", "csm-a@tests.invalid", "client-success"],
      ["deckPrep.save", "taskA1:launch", "csm-a2@tests.invalid", "client-success"],
    ]);
    expect(rowsNow[1].before.overrides).toEqual({ pain: "cost" });
    expect(rowsNow[1].after.overrides).toEqual({ dialect: "sa", selling_point: "A site supervisor on every project" });
    expect(rowsNow[1].metadata.changed).toEqual(["dialect", "pain", "selling_point"]);
    // Free text the Arabic deck needs in Arabic has an _ar twin under the same rule.
    const arabic = await save(CSM_A, A, "launch", { selling_point_ar: " عندنا مشرف بكل مشروع ", services: ["Kitchens", "Wardrobes", "Kitchens"], services_ar: ["مطابخ"], red_lines_ar: ["لا أسعار"] });
    expect(arabic.overrides).toMatchObject({ selling_point_ar: "عندنا مشرف بكل مشروع", services: ["Kitchens", "Wardrobes"], services_ar: ["مطابخ"], red_lines_ar: ["لا أسعار"] });
    await save(CSM_A, A, "launch", { selling_point_ar: null, services: null, services_ar: null, red_lines_ar: null });
    // The decks are separate rows; both come back to every reader.
    await save(CSM_A, A, "onboarding", { service_focus: "Kitchens", starter_pack: true });
    const both = await one(CSM_A, "SELECT public.cockpit_csm_deck_prep_read($1) r", [A]);
    expect(both.onboarding.overrides).toEqual({ service_focus: "Kitchens", starter_pack: true });
    expect(both.launch.revision).toBe(4);
    expect((await sources(CSM_A, A)).prep).toEqual(both);
  });

  test("unknown keys and bad values are refused with plain words and save nothing", async () => {
    const before = (await audits("cockpit_csm_deck_prep")).length;
    const bad: [Row, string][] = [
      [{ leads: 40 }, 'Prep does not keep "leads"'],
      [{ pain: "slow" }, "pain must be one of: delays, design, cost"],
      [{ starter_pack: "yes" }, "starter_pack is a yes or no"],
      [{ go_live: "2026-02-30" }, "Choose a valid go-live date"],
      [{ go_live: "2040-01-01" }, "Choose a valid go-live date"],
      [{ page_name: "x".repeat(201) }, "page_name is too long"],
      [{ access: { access: "maybe" } }, "Each access status must be one of"],
      [{ hidden_slides: ["Form!"] }, "hidden_slides must be a list of slide ids"],
      [{ form_questions: [{ label: "" }] }, "Each form question needs its label"],
      [{ form_questions: [{ label: "Budget?", extra: 1 }] }, "Each form question has a label"],
      [{ red_lines: Array.from({ length: 21 }, (_, i) => `line ${i}`) }, "red_lines is too long a list"],
      [{ phones: { stories: "50001" } }, "phones maps feed, reels and facebook"],
      [{ pain_ar: "cost" }, 'Prep does not keep "pain_ar"'],
      [{ "Pain": "cost" }, "Prep keys are short lowercase names"],
    ];
    for (const [patch, message] of bad)
      expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify(patch)])).toContain(message);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'sales','{\"pain\":\"cost\"}'::jsonb)", [A])).toContain("onboarding or the launch deck");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','[]'::jsonb)", [A])).toContain("named values");
    expect((await audits("cockpit_csm_deck_prep")).length).toBe(before);
  });

  test("references must be this client's own: forms, Meta ads and uploads", async () => {
    expect((await save(CSM_A, A, "launch", { form_confirmed: "8001" })).overrides.form_confirmed).toBe("8001");
    expect((await save(CSM_A, A, "launch", { form_confirmed: "native:funnels:f4" })).overrides.form_confirmed).toBe("native:funnels:f4");
    for (const form of ["8002", "8003", "8006", "native:funnels:f2"])
      expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify({ form_confirmed: form })])).toContain("own campaigns");
    expect((await save(CSM_A, A, "launch", { their_pick: "50001", meta_ad_text: { 50002: { headline: " Kitchens ", cta: "GET_QUOTE", primary_text: "" } } })).overrides)
      .toMatchObject({ their_pick: "50001", meta_ad_text: { 50002: { headline: "Kitchens", cta: "GET_QUOTE" } } });
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"their_pick\":\"60001\"}'::jsonb)", [A])).toContain("this client's creatives");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"meta_ad_text\":{\"60001\":{\"headline\":\"x\"}}}'::jsonb)", [A])).toContain("Meta ad ids");
    // The cover takes a ready custom upload of this client only.
    const custom = await reserve(CSM_A, uuid(1), A, "custom", "image/png", 2048, [1080, 1350, null, "cover.png", null, null]);
    const starter = await reserve(CSM_A, uuid(2), A, "starter", "image/jpeg", 1000);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify({ cover_creative: custom.id })])).toContain("own uploaded custom creatives");
    await putObject(custom.path, 2048, "image/png");
    await putObject(starter.path, 1000, "image/jpeg");
    await accept(CSM_A, A, custom.id);
    await accept(CSM_A, A, starter.id);
    expect((await save(CSM_A, A, "launch", { cover_creative: custom.id, phones: { feed: starter.id, reels: "50001", facebook: null } })).overrides)
      .toMatchObject({ cover_creative: custom.id, phones: { feed: starter.id, reels: "50001" } });
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify({ cover_creative: starter.id })])).toContain("custom creatives");
    const betaUpload = await reserve(CSM_B, uuid(3), B, "custom", "image/png", 50);
    await putObject(betaUpload.path, 50, "image/png");
    await accept(CSM_B, B, betaUpload.id);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_deck_prep_save($1,'launch',$2::jsonb)", [A, JSON.stringify({ their_pick: betaUpload.id })])).toContain("this client's creatives");
  });

  test("the agreement and presented stamps are the server's time and keep their first value", async () => {
    const t0 = Date.now();
    const first = await save(CSM_A, A, "launch", { creative_agreed_at: true });
    const stamp = first.overrides.creative_agreed_at;
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(stamp) - t0)).toBeLessThan(60_000);
    const again = await save(CSM_A, A, "launch", { creative_agreed_at: "1999-01-01T00:00:00Z" });
    expect(again).toMatchObject({ changed: false });
    expect(again.overrides.creative_agreed_at).toBe(stamp);
    expect((await save(CSM_A, A, "launch", { creative_agreed_at: null })).overrides.creative_agreed_at).toBeUndefined();
    const audit = (await audits("cockpit_csm_deck_prep")).filter(r => (r.metadata.changed ?? []).includes("creative_agreed_at"));
    expect(audit.length).toBe(2);
  });
});

describe("launch ads", () => {
  test("a reservation names its private path, is bound to its request id, and is audited", async () => {
    const before = (await audits("cockpit_csm_launch_ads")).length;
    const ad = await reserve(CSM_A, uuid(10), A, "custom", "video/quicktime", 64_000_000, [1080, 1920, 21.5, "C:\\Users\\me\\kitchen\u0007-reel.mov", "image/jpeg", 120_000]);
    expect(ad).toMatchObject({ taskId: A, kind: "custom", status: "uploading", mime: "video/quicktime", bytes: 64000000, width: 1080, height: 1920,
      seconds: 21.5, fileName: "kitchen-reel.mov", posterMime: "image/jpeg", posterBytes: 120000, createdBy: "csm-a@tests.invalid", hidden: false });
    expect(ad.path).toBe(`${A}/${ad.id}.mov`);
    expect(ad.posterPath).toBe(`${A}/${ad.id}-poster.jpg`);
    expect((await reserve(CSM_A, uuid(10), A, "custom", "video/quicktime", 64_000_000, [1080, 1920, 21.5, "other.mov", "image/jpeg", 120_000])).id).toBe(ad.id);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','video/quicktime',63000000)", [uuid(10), A])).toContain("different file");
    expect(await refused(CSM_A2, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','video/quicktime',64000000,1080,1920,21.5,'x.mov','image/jpeg',120000)", [uuid(10), A])).toContain("different file");
    const added = (await audits("cockpit_csm_launch_ads")).slice(before);
    expect(added.map(r => [r.action, r.entity_id, r.actor_email])).toEqual([["launchAds.reserve", ad.id, "csm-a@tests.invalid"]]);
  });

  test("files outside the rules are refused before any row exists", async () => {
    const cases: [string, unknown[], string][] = [
      ["application/pdf", [], "Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM)"],
      ["image/svg+xml", [], "Add a picture"],
    ];
    for (const [mime, , message] of cases)
      expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom',$3,100)", [uuid(20), A, mime])).toContain(message);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','video/mp4',157286401)", [uuid(21), A])).toContain("over 150 MB");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'logo','video/mp4',100)", [uuid(22), A])).toContain("is a picture");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','image/png',100,null,null,null,null,'image/jpeg',10)", [uuid(23), A])).toContain("Only a video has a poster");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'banner','image/png',100)", [uuid(24), A])).toContain("starter, custom, logo or page");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','image/png',0)", [uuid(25), A])).toContain("empty");
    await asOwner();
    expect((await db.query("SELECT 1 FROM public.cockpit_csm_launch_ads WHERE request_id = ANY($1::uuid[])", [[uuid(20), uuid(21), uuid(22), uuid(23), uuid(24), uuid(25)]])).rows.length).toBe(0);
  });

  test("accept checks Storage's own metadata, belongs to the seat that reserved, and runs once", async () => {
    const ad = await reserve(CSM_A, uuid(30), A, "custom", "video/mp4", 5000, [720, 1280, 9, "reel.mp4", "image/webp", 300]);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, ad.id])).toContain("did not arrive");
    await putObject(ad.path, 4999, "video/mp4");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, ad.id])).toContain("does not match");
    await asOwner();
    await db.query("UPDATE storage.objects SET metadata='{\"size\":5000,\"mimetype\":\"video/mp4\"}' WHERE name=$1", [ad.path]);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, ad.id])).toContain("poster did not arrive");
    await putObject(ad.posterPath, 300, "image/webp");
    expect(await refused(CSM_A2, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, ad.id])).toContain("Only the person who started this upload");
    expect(await refused(CSM_B, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [B, ad.id])).toContain("not one of this client's uploads");
    const before = (await audits("cockpit_csm_launch_ads")).length;
    const ready = await accept(CSM_A, A, ad.id);
    const readyAt = ready.readyAt;
    expect(typeof readyAt).toBe("string");
    expect(ready).toMatchObject({ status: "ready", updatedBy: "csm-a@tests.invalid" });
    expect((await accept(CSM_A, A, ad.id)).readyAt).toBe(readyAt);
    const added = (await audits("cockpit_csm_launch_ads")).slice(before);
    expect(added.map(r => [r.action, r.before.status, r.after.status])).toEqual([["launchAds.ready", "uploading", "ready"]]);
    expect((await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, ad.id])).mine).toBe(false);
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, ad.id])).mine).toBe(true);
  });

  test("text, placement, starter or custom and hidden are edited by any seat on the client; remove takes it off for good", async () => {
    const ad = await reserve(CSM_A, uuid(40), A, "starter", "image/webp", 777, [1080, 1080, null, "square.webp", null, null]);
    await putObject(ad.path, 777, "image/webp");
    await accept(CSM_A, A, ad.id);
    const edit = (who: string, patch: Row) => one(who, "SELECT public.cockpit_csm_launch_ad_update($1,$2::uuid,$3::jsonb) r", [A, ad.id, JSON.stringify(patch)]);
    const edited = await edit(CSM_A2, { primary_text: "  Your kitchen, fitted in six weeks.  ", headline: "Kitchens", cta: "GET_QUOTE", language: "en", placement: "feed", kind: "custom" });
    expect(edited).toMatchObject({ primaryText: "Your kitchen, fitted in six weeks.", headline: "Kitchens", cta: "GET_QUOTE", language: "en", placement: "feed", kind: "custom", updatedBy: "csm-a2@tests.invalid" });
    const before = (await audits("cockpit_csm_launch_ads")).length;
    expect((await edit(CSM_A, { headline: "Kitchens" })).updatedBy).toBe("csm-a2@tests.invalid"); // unchanged: no write
    expect((await audits("cockpit_csm_launch_ads")).length).toBe(before);
    expect((await edit(CSM_A, { headline: null, hidden: true })).headline).toBeNull();
    for (const [patch, message] of [
      [{ cta: "BUY_NOW" }, "The call to action must be one of"],
      [{ bytes: 1 }, 'A creative does not keep "bytes"'],
      [{ hidden: "yes" }, "hidden is a yes or no"],
      [{ kind: "logo" }, "kind must be one of: starter, custom"],
    ] as [Row, string][])
      expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_update($1,$2::uuid,$3::jsonb)", [A, ad.id, JSON.stringify(patch)])).toContain(message);
    // Hidden files stay in prep's list and leave the deck's.
    const all = await one(CSM_A, "SELECT public.cockpit_csm_launch_ads_read($1) r", [A]);
    const shown = await one(CSM_A, "SELECT public.cockpit_csm_launch_ads_read($1,false) r", [A]);
    expect(all.some((a: Row) => a.id === ad.id && a.hidden)).toBe(true);
    expect(shown.some((a: Row) => a.id === ad.id)).toBe(false);
    const removed = await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid) r", [A, ad.id]);
    const removedAt = removed.removedAt;
    expect(typeof removedAt).toBe("string");
    expect(removed.status).toBe("removed");
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid) r", [A, ad.id])).removedAt).toBe(removedAt);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_update($1,$2::uuid,'{\"hidden\":false}'::jsonb)", [A, ad.id])).toContain("was removed");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, ad.id])).toContain("was removed");
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ads_read($1) r", [A])).some((a: Row) => a.id === ad.id)).toBe(false);
    const actions = (await audits("cockpit_csm_launch_ads")).filter(r => r.entity_id === ad.id).map(r => r.action);
    expect(actions).toEqual(["launchAds.reserve", "launchAds.ready", "launchAds.update", "launchAds.update", "launchAds.remove"]);
  });

  test("the read policy opens a ready file of an allowed client only", async () => {
    const ready = await reserve(CSM_A, uuid(50), A, "custom", "image/jpeg", 10, [100, 100, null, "a.jpg", null, null]);
    const pending = await reserve(CSM_A, uuid(51), A, "custom", "image/jpeg", 10);
    await putObject(ready.path, 10, "image/jpeg");
    await putObject(pending.path, 10, "image/jpeg");
    await accept(CSM_A, A, ready.id);
    const video = (await one(CSM_A, "SELECT public.cockpit_csm_launch_ads_read($1) r", [A])).find((a: Row) => a.posterPath);
    // A file written straight into the bucket with no row, at a guessable path.
    await putObject(`${A}/${uuid(99)}.jpg`, 10, "image/jpeg");
    const visible = async (who: string | null) =>
      (await rows<{ name: string }>(who, "SELECT name FROM storage.objects WHERE bucket_id='cockpit-launch-ads' ORDER BY name")).map(r => r.name);
    const acme = await visible(CSM_A);
    expect(acme).toContain(ready.path);
    expect(acme).toContain(video.path);
    expect(acme).toContain(video.posterPath);
    expect(acme).not.toContain(pending.path);
    expect(acme).not.toContain(`${A}/${uuid(99)}.jpg`);
    expect(acme.every(name => name.startsWith(`${A}/`))).toBe(true);
    expect((await visible(CSM_B)).every(name => name.startsWith(`${B}/`))).toBe(true);
    expect((await visible(CSM_B)).length).toBe(1);
    expect(await visible(BUYER)).toEqual([]);
    expect(await visible(GONE)).toEqual([]);
    expect(await refused(null, "SELECT name FROM storage.objects")).toContain("permission denied");
    expect(await refused(CSM_A, "INSERT INTO storage.objects(bucket_id,name) VALUES('cockpit-launch-ads',$1)", [`${A}/${uuid(98)}.jpg`])).toContain("permission denied");
    // The policy function never raises, whatever it is given.
    for (const name of [null, "", "../x", `${A}/${uuid(50)}.jpg/../x`, `${B}/${ready.id}.jpg`])
      expect(await one(CSM_A, "SELECT public.cockpit_csm_launch_object_allowed($1) r", [name])).toBe(false);
  });

  test("another client's upload id is refused under one's own task id, and nothing changes", async () => {
    const ad = await reserve(CSM_A, uuid(60), A, "custom", "image/png", 64, [100, 100, null, "acme.png", null, null]);
    await putObject(ad.path, 64, "image/png");
    await accept(CSM_A, A, ad.id);
    const before = (await audits("cockpit_csm_launch_ads")).length;
    for (const [sql, params] of [
      ["SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid)", [B, ad.id]],
      ["SELECT public.cockpit_csm_launch_ad_update($1,$2::uuid,'{\"hidden\":true,\"headline\":\"Beta\"}'::jsonb)", [B, ad.id]],
      ["SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid)", [B, ad.id]],
      ["SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [B, ad.id]],
    ] as [string, unknown[]][])
      expect(await refused(CSM_B, sql, params)).toContain("not one of this client's uploads");
    const still = await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, ad.id]);
    expect(still).toMatchObject({ status: "ready", hidden: false, headline: null, taskId: A });
    expect((await audits("cockpit_csm_launch_ads")).length).toBe(before);
  });

  test("accept refuses a file or a poster of the right size but another type", async () => {
    const pic = await reserve(CSM_A, uuid(61), A, "custom", "image/png", 70);
    await putObject(pic.path, 70, "image/jpeg");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, pic.id])).toContain("does not match");
    const video = await reserve(CSM_A, uuid(62), A, "custom", "video/mp4", 900, [720, 1280, 5, "v.mp4", "image/jpeg", 80]);
    await putObject(video.path, 900, "video/mp4");
    await putObject(video.posterPath, 80, "image/png");
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid)", [A, video.id])).toContain("poster does not match");
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, pic.id])).status).toBe("uploading");
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, video.id])).status).toBe("uploading");
  });

  test("a request id replayed for another client the seat can open is refused", async () => {
    await reserve(CSM_ALL, uuid(63), A, "custom", "image/webp", 55);
    expect(await refused(CSM_ALL, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','image/webp',55)", [uuid(63), B])).toContain("different file");
    await asOwner();
    expect((await db.query("SELECT task_id FROM public.cockpit_csm_launch_ads WHERE request_id=$1", [uuid(63)])).rows).toEqual([{ task_id: A }]);
  });

  test("a seat's unfinished uploads and a client's files are capped", async () => {
    await asOwner();
    // 30 unfinished uploads by one seat in the last hour: the next is refused.
    await db.query(`INSERT INTO public.cockpit_csm_launch_ads(id,request_id,task_id,kind,storage_path,mime,bytes,created_by,created_by_email,created_at)
      SELECT x.id, gen_random_uuid(), $1, 'custom', $1 || '/' || x.id::text || '.png', 'image/png', 10, $2::uuid, 'csm-a2@tests.invalid', now() - interval '5 minutes'
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 30)) x`, [A, CSM_A2]);
    try {
      expect(await refused(CSM_A2, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','image/png',10)", [uuid(64), A])).toContain("Too many unfinished uploads");
      // Another seat is not held back by them.
      expect((await reserve(CSM_A, uuid(65), A, "custom", "image/png", 10)).status).toBe("uploading");
      // An hour on they stop counting: the cap clears itself.
      await asOwner();
      await db.query("UPDATE public.cockpit_csm_launch_ads SET created_at = now() - interval '61 minutes' WHERE created_by=$1 AND status='uploading'", [CSM_A2]);
      expect((await reserve(CSM_A2, uuid(64), A, "custom", "image/png", 10)).status).toBe("uploading");
    } finally {
      await asOwner();
      await db.query("DELETE FROM public.cockpit_csm_launch_ads WHERE created_by=$1 AND status='uploading'", [CSM_A2]);
    }
    // 200 files on one client: the next is refused, removed ones do not count.
    await db.query(`INSERT INTO public.cockpit_csm_launch_ads(id,request_id,task_id,kind,status,storage_path,mime,bytes,created_by,created_by_email,ready_at)
      SELECT x.id, gen_random_uuid(), 'twin2', 'custom', 'ready', 'twin2/' || x.id::text || '.png', 'image/png', 10, $1::uuid, 'csm-all@tests.invalid', now()
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 200)) x`, [CSM_ALL]);
    try {
      expect(await refused(CSM_ALL, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,'twin2','custom','image/png',10)", [uuid(66)])).toContain("200 files already");
      await db.query("UPDATE public.cockpit_csm_launch_ads SET status='removed', removed_at=now() WHERE id = (SELECT id FROM public.cockpit_csm_launch_ads WHERE task_id='twin2' LIMIT 1)");
      expect((await one(CSM_ALL, "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,'twin2','custom','image/png',10) r", [uuid(66)])).status).toBe("uploading");
    } finally {
      await asOwner();
      await db.query("DELETE FROM public.cockpit_csm_launch_ads WHERE task_id='twin2'");
    }
  });

  test("removed files and day-old unfinished uploads are listed for the sweep; purging marks only those of this client", async () => {
    const gone = await reserve(CSM_A, uuid(70), A, "custom", "video/mp4", 400, [720, 1280, 4, "gone.mp4", "image/jpeg", 20]);
    const fresh = await reserve(CSM_A, uuid(71), A, "custom", "image/png", 40);
    const old = await reserve(CSM_A, uuid(72), A, "custom", "image/png", 41);
    const kept = await reserve(CSM_A, uuid(73), A, "custom", "image/png", 42);
    await putObject(kept.path, 42, "image/png");
    await accept(CSM_A, A, kept.id);
    await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid) r", [A, gone.id]);
    await asOwner();
    await db.query("UPDATE public.cockpit_csm_launch_ads SET created_at = now() - interval '2 days' WHERE id=$1", [old.id]);
    const stale = await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_stale($1) r", [A]);
    const ids = stale.map((r: Row) => r.id);
    expect(ids).toContain(gone.id);
    expect(ids).toContain(old.id);
    expect(ids).not.toContain(fresh.id);
    expect(ids).not.toContain(kept.id);
    expect(stale.find((r: Row) => r.id === gone.id)).toEqual({ id: gone.id, path: gone.path, posterPath: gone.posterPath });
    const betaFile = (await one(CSM_B, "SELECT public.cockpit_csm_launch_ads_read($1) r", [B]))[0];
    const before = (await audits("cockpit_csm_launch_ads")).length;
    // Fresh, ready and another client's ids are left alone.
    expect(await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_purged($1,$2::uuid[]) r", [A, [gone.id, old.id, fresh.id, kept.id, betaFile.id]])).toBe(2);
    const after = (await audits("cockpit_csm_launch_ads")).slice(before);
    expect(after.map(r => [r.action, r.entity_id]).sort()).toEqual([["launchAds.purge", gone.id], ["launchAds.purge", old.id]].sort());
    const get = (id: string) => one(CSM_A, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [A, id]);
    expect(await get(old.id)).toMatchObject({ status: "removed", purgedAt: expect.any(String) });
    expect(await get(gone.id)).toMatchObject({ status: "removed", purgedAt: expect.any(String) });
    expect(await get(fresh.id)).toMatchObject({ status: "uploading", purgedAt: null });
    expect(await get(kept.id)).toMatchObject({ status: "ready", purgedAt: null });
    expect((await one(CSM_B, "SELECT public.cockpit_csm_launch_ad_get($1,$2::uuid) r", [B, betaFile.id])).status).toBe("ready");
    expect((await one(CSM_A, "SELECT public.cockpit_csm_launch_ad_stale($1) r", [A])).map((r: Row) => r.id)).not.toContain(gone.id);
    // A second purge changes nothing.
    expect(await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_purged($1,$2::uuid[]) r", [A, [gone.id, old.id]])).toBe(0);
    expect(await refused(CSM_A, "SELECT public.cockpit_csm_launch_ad_purged($1,$2::uuid[])", [A, Array.from({ length: 51 }, (_, i) => uuid(1000 + i))])).toContain("at most 50");
  });

  test("deck sources carry the ready uploads, hidden ones flagged", async () => {
    const s = await sources(CSM_A, A);
    expect(s.launchAds.length).toBeGreaterThan(0);
    expect(s.launchAds.every((a: Row) => a.status === "ready" && a.taskId === A)).toBe(true);
    expect(JSON.stringify(s.launchAds)).not.toContain("request");
  });
});

// ---------------------------------------------------------------------------
// Video slots (20261020120000_csm_deck_videos.sql, docs/csm-decks/VIDEOS.md)
// ---------------------------------------------------------------------------

const SEED_BY = "migration 20261020120000_csm_deck_videos";
const LOOM = "e2d83bffee614d9aa035d898d37d8989";
const YT = "dQw4w9WgXcQ";
const DRIVE = "1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123";
const HOSTS = "Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.";
const NO_VIDEO = (p: string) => `That ${p} link has no video in it. Copy the video's share link.`;
const SAVE_CONFLICT = "Someone else changed this video just now. Check it, then save again.";
const CLEAR_CONFLICT = "Someone else changed this video just now. Check it, then clear it again.";
const LAUNCH_SLOTS = ["launch:start-to-finish", "launch:testing", "launch:call-team", "launch:winning",
  "launch:portal-guide", "launch:calendar-hours", "launch:first-90-days", "launch:payments"];
const ONBOARDING_SLOTS = ["onboarding:welcome", "onboarding:meta-access", "onboarding:whatsapp-calendar", "onboarding:testing"];

type Video = { deck: string; slot: string; lang: string; url: string | null; title?: string | null; seconds?: number | null; revision: number | null };
const SAVE_SQL = `SELECT public.cockpit_csm_deck_video_save(p_deck => $1::text, p_slot_key => $2::text, p_lang => $3::text,
  p_url => $4::text, p_title => $5::text, p_duration_seconds => $6::integer, p_revision => $7::integer) r`;
const CLEAR_SQL = "SELECT public.cockpit_csm_deck_video_clear(p_deck => $1::text, p_slot_key => $2::text, p_lang => $3::text, p_revision => $4::integer) r";
const READ_SQL = "SELECT public.cockpit_csm_deck_videos_read($1::text) r";
const saveArgs = (v: Video) => [v.deck, v.slot, v.lang, v.url, v.title ?? null, v.seconds ?? null, v.revision];
const vSave = (who: string, v: Video) => one(who, SAVE_SQL, saveArgs(v));
const vClear = (who: string, deck: string, slot: string, lang: string, revision: number | null) =>
  one(who, CLEAR_SQL, [deck, slot, lang, revision]);
const vRead = (who: string, deck: string | null) => one(who, READ_SQL, [deck]);
async function failure(who: string | null, text: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "", message: err.message };
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function parse(url: string | null): Promise<Row> {
  await asOwner();
  return (await db.query<{ r: Row }>("SELECT public.cockpit_csm_deck_video_parse($1::text) r", [url])).rows[0].r;
}
async function parseFails(url: string | null): Promise<{ code: string; message: string }> {
  await asOwner();
  try {
    await db.query("SELECT public.cockpit_csm_deck_video_parse($1::text) r", [url]);
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "", message: err.message };
  }
  throw new Error(`Expected the parser to refuse ${url}`);
}
async function videoRow(deck: string, slot: string, lang: string): Promise<Row | undefined> {
  await asOwner();
  return (await db.query<Row>("SELECT * FROM public.cockpit_csm_deck_videos WHERE deck=$1 AND slot_key=$2 AND lang=$3", [deck, slot, lang])).rows[0];
}
const videoAudits = () => audits("cockpit_csm_deck_videos");

describe("deck videos", () => {
  test("the six seeds are there after the double apply, with their lengths and exactly six seed audit rows; a third apply keeps later changes", async () => {
    await asOwner();
    const seeded = (await db.query<Row>(`SELECT deck, slot_key, lang, provider, url, embed_url, title, duration_seconds, revision, updated_by, cleared_at
      FROM public.cockpit_csm_deck_videos ORDER BY deck, slot_key, lang`)).rows;
    expect(seeded).toEqual([
      { deck: "launch", slot_key: "calendar-hours", lang: "any", provider: "loom", url: "https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768",
        embed_url: "https://www.loom.com/embed/6aa67297dfcf421887f8961d3c1c7768?hideEmbedTopBar=true", title: null, duration_seconds: 11, revision: 1, updated_by: SEED_BY, cleared_at: null },
      { deck: "launch", slot_key: "portal-guide", lang: "ar", provider: "wistia", url: "https://fast.wistia.net/embed/iframe/hyuxh7skjv",
        embed_url: "https://fast.wistia.net/embed/iframe/hyuxh7skjv?seo=false", title: null, duration_seconds: 285, revision: 1, updated_by: SEED_BY, cleared_at: null },
      { deck: "launch", slot_key: "portal-guide", lang: "en", provider: "wistia", url: "https://fast.wistia.net/embed/iframe/lxlse6ckhf",
        embed_url: "https://fast.wistia.net/embed/iframe/lxlse6ckhf?seo=false", title: null, duration_seconds: 277, revision: 1, updated_by: SEED_BY, cleared_at: null },
      { deck: "onboarding", slot_key: "meta-access", lang: "any", provider: "loom", url: `https://www.loom.com/share/${LOOM}`,
        embed_url: `https://www.loom.com/embed/${LOOM}?hideEmbedTopBar=true`, title: null, duration_seconds: 94, revision: 1, updated_by: SEED_BY, cleared_at: null },
      { deck: "onboarding", slot_key: "welcome", lang: "any", provider: "wistia", url: "https://fast.wistia.net/embed/iframe/up0z6n691k",
        embed_url: "https://fast.wistia.net/embed/iframe/up0z6n691k?seo=false", title: null, duration_seconds: 148, revision: 1, updated_by: SEED_BY, cleared_at: null },
      { deck: "onboarding", slot_key: "whatsapp-calendar", lang: "any", provider: "loom", url: "https://www.loom.com/share/4ddc5519935f4ba8bdc7ac6f3667a701",
        embed_url: "https://www.loom.com/embed/4ddc5519935f4ba8bdc7ac6f3667a701?hideEmbedTopBar=true", title: null, duration_seconds: 231, revision: 1, updated_by: SEED_BY, cleared_at: null },
    ]);
    const seedAudits = await videoAudits();
    expect(seedAudits.length).toBe(6);
    expect(seedAudits.every(r => r.action === "deck_video.seed" && r.before === null && r.source_app === "client-success"
      && r.source_system === "supabase" && r.after?.updated_by === SEED_BY && r.metadata.op === "INSERT")).toBe(true);
    expect(seedAudits.map(r => r.entity_id).sort()).toEqual(["launch:calendar-hours:any", "launch:portal-guide:ar", "launch:portal-guide:en",
      "onboarding:meta-access:any", "onboarding:welcome:any", "onboarding:whatsapp-calendar:any"]);
    // A CSM changes one seed and clears another; the file applied again keeps both as they are.
    const titled = await vSave(CSM_A, { deck: "launch", slot: "calendar-hours", lang: "any", url: "https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768", title: "Block your hours", seconds: 11, revision: 1 });
    expect(titled).toMatchObject({ revision: 2, title: "Block your hours", changed: true });
    expect(await vClear(CSM_A, "onboarding", "welcome", "any", 1)).toEqual({ deck: "onboarding", slotKey: "welcome", lang: "any", cleared: true, revision: 2 });
    await asOwner();
    await db.exec(migration(VIDEOS));
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM public.cockpit_csm_deck_videos")).rows[0].n).toBe(6);
    expect(await videoRow("launch", "calendar-hours", "any")).toMatchObject({ title: "Block your hours", revision: 2, updated_by: "csm-a@tests.invalid" });
    expect(await videoRow("onboarding", "welcome", "any")).toMatchObject({ url: null, embed_url: null, provider: null, duration_seconds: null, revision: 2 });
    expect((await videoRow("onboarding", "welcome", "any"))?.cleared_at).not.toBeNull();
    const after = await videoAudits();
    expect(after.filter(r => r.action === "deck_video.seed").length).toBe(6);
    expect(after.length).toBe(8);
    // Put the welcome video back (prep's Undo: the same link with revision 0).
    expect(await vSave(CSM_A, { deck: "onboarding", slot: "welcome", lang: "any", url: "https://fast.wistia.net/embed/iframe/up0z6n691k", seconds: 148, revision: 0 }))
      .toMatchObject({ revision: 3, changed: true, durationSeconds: 148 });
  });

  test("the table: row security on, no policies, no browser grants, the service key reads only, and the audit trigger is on", async () => {
    await asOwner();
    const table = "public.cockpit_csm_deck_videos";
    const has = async (role: string, privilege: string) =>
      (await db.query<{ ok: boolean }>("SELECT has_table_privilege($1,$2,$3) ok", [role, table, privilege])).rows[0].ok;
    for (const role of ["anon", "authenticated"])
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(await has(role, privilege)).toBe(false);
    expect(await has("service_role", "SELECT")).toBe(true);
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await has("service_role", privilege)).toBe(false);
    expect((await db.query<{ rls: boolean }>("SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass", [table])).rows[0].rls).toBe(true);
    expect((await db.query("SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cockpit_csm_deck_videos'")).rows.length).toBe(0);
    const triggers = (await db.query<Row>("SELECT tgname FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal", [table])).rows;
    expect(triggers.map(t => t.tgname)).toEqual(["cockpit_csm_deck_videos_audit"]);
    for (const who of [CSM_A, CEO, null]) {
      expect(await refused(who, `SELECT * FROM ${table}`)).toContain("permission denied");
      expect(await refused(who, `INSERT INTO ${table}(deck,slot_key,lang,updated_by,cleared_at) VALUES('launch','payments','en','x',now())`)).toContain("permission denied");
    }
  });

  test("the gate: signed out, a seat without client success, a deactivated and an unconfirmed seat are refused with 42501; a CSM seat and the CEO read and save", async () => {
    const before = (await videoAudits()).length;
    const calls: [string, unknown[]][] = [
      [READ_SQL, ["launch"]],
      [SAVE_SQL, saveArgs({ deck: "launch", slot: "payments", lang: "en", url: `https://www.loom.com/share/${LOOM}`, revision: 0 })],
      [CLEAR_SQL, ["launch", "portal-guide", "en", 1]],
    ];
    for (const [sql, params] of calls) {
      const anon = await failure(null, sql, params);
      expect(anon.code).toBe("42501");
      expect(anon.message).toContain("permission denied");
      for (const who of [BUYER, SALES, GONE, UNCONFIRMED])
        expect(await failure(who, sql, params)).toEqual({ code: "42501", message: "Active client-success access required" });
    }
    expect((await videoAudits()).length).toBe(before);
    expect(await videoRow("launch", "payments", "en")).toBeUndefined();
    expect((await videoRow("launch", "portal-guide", "en"))?.revision).toBe(1);
    // A slot belongs to no client: a seat scoped to one client reads and saves every deck's slots.
    for (const who of [CSM_A, CSM_B, CSM_ALL, CEO]) {
      const read = await vRead(who, "launch");
      expect(read.slots).toEqual(LAUNCH_SLOTS);
      expect(read.rows.map((r: Row) => `${r.slotKey}:${r.lang}`)).toEqual(["calendar-hours:any", "portal-guide:ar", "portal-guide:en"]);
    }
    const byCeo = await vSave(CEO, { deck: "launch", slot: "payments", lang: "en", url: `https://www.loom.com/share/${LOOM}`, revision: 0 });
    expect(byCeo).toMatchObject({ revision: 1, updatedBy: "aziz@maharamedia.com", changed: true });
    expect(await vClear(CSM_B, "launch", "payments", "en", 1)).toMatchObject({ cleared: true, revision: 2 });
    const added = (await videoAudits()).slice(before);
    expect(added.map(r => [r.action, r.entity_id, r.actor_email])).toEqual([
      ["deck_video.save", "launch:payments:en", "aziz@maharamedia.com"],
      ["deck_video.clear", "launch:payments:en", "csm-b@tests.invalid"],
    ]);
  });

  test("null and unknown arguments get their sentence and code, never a raw violation; an unknown deck is the deck's sentence", async () => {
    const before = (await videoAudits()).length;
    const deckSentence = { code: "22023", message: "Choose the onboarding or the launch deck." };
    const url = `https://www.loom.com/share/${LOOM}`;
    // The read.
    expect(await failure(CSM_A, READ_SQL, [null])).toEqual(deckSentence);
    expect(await failure(CSM_A, READ_SQL, ["sales"])).toEqual(deckSentence);
    expect(await failure(CSM_A, "SELECT public.cockpit_csm_deck_videos_read() r")).toEqual(deckSentence);
    // Save and clear, in the order the checks run.
    const cases: [Partial<Video>, string, string][] = [
      [{ deck: null as unknown as string }, "Choose the onboarding or the launch deck.", "Choose the onboarding or the launch deck."],
      [{ deck: "sales", slot: "nope" }, "Choose the onboarding or the launch deck.", "Choose the onboarding or the launch deck."],
      [{ slot: null as unknown as string }, "That video slot is not in the launch deck.", "That video slot is not in the launch deck."],
      [{ slot: "nope" }, "That video slot is not in the launch deck.", "That video slot is not in the launch deck."],
      [{ slot: "welcome" }, "That video slot is not in the launch deck.", "That video slot is not in the launch deck."],
      [{ deck: "onboarding", slot: "portal-guide" }, "That video slot is not in the onboarding deck.", "That video slot is not in the onboarding deck."],
      [{ lang: null as unknown as string }, "Choose English, Arabic or any language.", "Choose English, Arabic or any language."],
      [{ lang: "fr" }, "Choose English, Arabic or any language.", "Choose English, Arabic or any language."],
      [{ revision: null }, "Read the videos again, then save.", "Read the videos again, then clear."],
      [{ revision: -1 }, "Read the videos again, then save.", "Read the videos again, then clear."],
    ];
    for (const [change, saveSentence, clearSentence] of cases) {
      const v: Video = { deck: "launch", slot: "testing", lang: "en", url, revision: 0, ...change };
      expect(await failure(CSM_A, SAVE_SQL, saveArgs(v))).toEqual({ code: "22023", message: saveSentence });
      expect(await failure(CSM_A, CLEAR_SQL, [v.deck, v.slot, v.lang, v.revision])).toEqual({ code: "22023", message: clearSentence });
    }
    // A save left without its revision (the default) is refused the same way.
    expect(await failure(CSM_A, "SELECT public.cockpit_csm_deck_video_save(p_deck => 'launch', p_slot_key => 'testing', p_lang => 'en', p_url => $1) r", [url]))
      .toEqual({ code: "22023", message: "Read the videos again, then save." });
    expect(await failure(CSM_A, "SELECT public.cockpit_csm_deck_video_clear(p_deck => 'launch', p_slot_key => 'testing', p_lang => 'en') r"))
      .toEqual({ code: "22023", message: "Read the videos again, then clear." });
    expect((await videoAudits()).length).toBe(before);
    expect(await videoRow("launch", "testing", "en")).toBeUndefined();
  });

  test("links: every accepted form gives its two addresses and is a fixed point; every refused form gives its sentence", async () => {
    const loom = (id: string) => ({ provider: "loom", url: `https://www.loom.com/share/${id}`, embedUrl: `https://www.loom.com/embed/${id}?hideEmbedTopBar=true` });
    const yt = (start?: number) => ({ provider: "youtube", url: `https://www.youtube.com/watch?v=${YT}${start ? `&t=${start}` : ""}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1${start ? `&start=${start}` : ""}` });
    const wistia = (id: string) => ({ provider: "wistia", url: `https://fast.wistia.net/embed/iframe/${id}`, embedUrl: `https://fast.wistia.net/embed/iframe/${id}?seo=false` });
    const vimeo = (hash?: string) => ({ provider: "vimeo", url: `https://vimeo.com/123456789${hash ? `/${hash}` : ""}`,
      embedUrl: `https://player.vimeo.com/video/123456789?dnt=1${hash ? `&h=${hash}` : ""}` });
    const drive = (key?: string) => ({ provider: "drive", url: `https://drive.google.com/file/d/${DRIVE}/view${key ? `?resourcekey=${key}` : ""}`,
      embedUrl: `https://drive.google.com/file/d/${DRIVE}/preview${key ? `?resourcekey=${key}` : ""}` });
    const accepted: [string, Row][] = [
      // The six seeds.
      ["https://fast.wistia.net/embed/iframe/up0z6n691k", wistia("up0z6n691k")],
      [`https://www.loom.com/share/${LOOM}`, loom(LOOM)],
      ["https://www.loom.com/share/4ddc5519935f4ba8bdc7ac6f3667a701", loom("4ddc5519935f4ba8bdc7ac6f3667a701")],
      ["https://fast.wistia.net/embed/iframe/lxlse6ckhf", wistia("lxlse6ckhf")],
      ["https://fast.wistia.net/embed/iframe/hyuxh7skjv", wistia("hyuxh7skjv")],
      ["https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768", loom("6aa67297dfcf421887f8961d3c1c7768")],
      // Loom.
      [`https://loom.com/share/${LOOM}`, loom(LOOM)],
      [`https://www.loom.com/embed/${LOOM}`, loom(LOOM)],
      [`https://www.loom.com/share/Some-Title-${LOOM}`, loom(LOOM)],
      [`HTTPS://WWW.LOOM.COM/share/${LOOM}`, loom(LOOM)],
      [`https://www.loom.com/share/${LOOM}/?sid=abc#t=10`, loom(LOOM)],
      [`  https://www.loom.com/share/${LOOM}  `, loom(LOOM)],
      // YouTube.
      [`https://youtu.be/${YT}`, yt()],
      [`https://www.youtube.com/watch?v=${YT}&t=1m30s`, yt(90)],
      [`https://www.youtube.com/embed/${YT}?start=45`, yt(45)],
      [`https://www.youtube-nocookie.com/embed/${YT}`, yt()],
      [`https://youtube.com/watch?v=${YT}`, yt()],
      [`https://m.youtube.com/watch?feature=share&v=${YT}&t=30s`, yt(30)],
      [`https://youtu.be/${YT}?t=1h2m3s`, yt(3723)],
      [`https://youtu.be/${YT}?t=99999999999`, yt()],
      [`https://youtu.be/${YT}?t=0`, yt()],
      [`https://youtu.be/${YT}?t=13h`, yt()],
      // Wistia, Vimeo and Drive.
      ["https://mahara.wistia.com/medias/abcde12345", wistia("abcde12345")],
      ["https://vimeo.com/123456789", vimeo()],
      ["https://www.vimeo.com/123456789/abcdef1234", vimeo("abcdef1234")],
      ["https://player.vimeo.com/video/123456789", vimeo()],
      ["https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0", vimeo("abcdef1234")],
      [`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing`, drive()],
      [`https://drive.google.com/file/d/${DRIVE}/preview`, drive()],
      [`https://drive.google.com/file/d/${DRIVE}`, drive()],
      [`https://drive.google.com/file/d/${DRIVE}/view?usp=sharing&resourcekey=0-AbC_dEf`, drive("0-AbC_dEf")],
    ];
    for (const [link, expected] of accepted) {
      const got = await parse(link);
      expect({ link, got }).toEqual({ link, got: expected });
      expect(await parse(got.url)).toEqual(got);
    }
    const longLink = `https://www.loom.com/share/${LOOM}?x=`;
    const refusedLinks: [string | null, string][] = [
      [`http://www.loom.com/share/${LOOM}`, "Use the https link."],
      [`HTTP://youtu.be/${YT}`, "Use the https link."],
      [`https://www.loom.com.example.org/share/${LOOM}`, HOSTS],
      [`https://www.loom.com./share/${LOOM}`, HOSTS],
      [`https://user@www.loom.com/share/${LOOM}`, HOSTS],
      [`https://www.loom.com:8443/share/${LOOM}`, HOSTS],
      [`https://www.loom.com\\@evil.org/share/${LOOM}`, HOSTS],
      [`https://www.loo%6D.com/share/${LOOM}`, HOSTS],
      [`https://www.loom.com/share/%65${LOOM.slice(1)}`, NO_VIDEO("Loom")],
      [`https://www.lоom.com/share/${LOOM}`, HOSTS],
      [`https://142.250.80.46/watch?v=${YT}`, HOSTS],
      [`https://www.loom.com/share/ ${LOOM}`, HOSTS],
      ["https://example.org/video.mp4", HOSTS],
      ["javascript:alert(1)", HOSTS],
      ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", HOSTS],
      ["", HOSTS],
      ["   ", HOSTS],
      [null, HOSTS],
      ["https://www.youtube.com/watch?v=dQw4w9WgXc", NO_VIDEO("YouTube")],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQQ", NO_VIDEO("YouTube")],
      ["https://www.youtube.com/@mahara", NO_VIDEO("YouTube")],
      ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz", "That Drive link is a folder. Paste the link to the video file."],
      ["https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz", "That Drive link is a folder. Paste the link to the video file."],
      ["https://vimeo.com/showcase/1234567", NO_VIDEO("Vimeo")],
      ["https://fast.wistia.net/embed/iframe/abcde1234", NO_VIDEO("Wistia")],
      [`https://www.loom.com/share/${LOOM.toUpperCase()}`, NO_VIDEO("Loom")],
      [longLink + "a".repeat(501 - longLink.length), "That link is too long. Copy the video's share link."],
    ];
    expect((longLink + "a".repeat(501 - longLink.length)).length).toBe(501);
    for (const [link, sentence] of refusedLinks) expect({ link, ...(await parseFails(link)) }).toEqual({ link, code: "22023", message: sentence });
    // A 500-character link is not too long.
    expect((await parse(longLink + "a".repeat(500 - longLink.length))).url).toBe(`https://www.loom.com/share/${LOOM}`);
    // The save refuses the same links with the same sentence and writes nothing.
    const before = (await videoAudits()).length;
    for (const [link, sentence] of [
      ["https://evil.example.org/share/x", HOSTS],
      [`http://www.loom.com/share/${LOOM}`, "Use the https link."],
      ["javascript:alert(document.cookie)", HOSTS],
      ["data:text/html,<script>alert(1)</script>", HOSTS],
    ])
      expect(await failure(CSM_A, SAVE_SQL, saveArgs({ deck: "launch", slot: "winning", lang: "any", url: link, revision: 0 }))).toEqual({ code: "22023", message: sentence });
    expect((await videoAudits()).length).toBe(before);
    expect(await videoRow("launch", "winning", "any")).toBeUndefined();
  });

  test("save: revision 0 records an empty slot, the same values change nothing, a stale or blind save conflicts, and bad fields get their sentences", async () => {
    const audited = async () => (await videoAudits()).filter(r => r.entity_id === "launch:testing:en");
    const v: Video = { deck: "launch", slot: "testing", lang: "en", url: `https://youtu.be/${YT}?t=90`, revision: 0 };
    const first = await vSave(CSM_A, v);
    expect(first).toEqual({ deck: "launch", slotKey: "testing", lang: "en", provider: "youtube", url: `https://www.youtube.com/watch?v=${YT}&t=90`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}?rel=0&playsinline=1&enablejsapi=1&start=90`, title: null, durationSeconds: null,
      revision: 1, updatedBy: "csm-a@tests.invalid", updatedAt: expect.any(String), changed: true });
    expect(Number.isNaN(Date.parse(first.updatedAt))).toBe(false);
    let rowsNow = await audited();
    expect(rowsNow.length).toBe(1);
    expect(rowsNow[0]).toMatchObject({ action: "deck_video.save", actor_email: "csm-a@tests.invalid", before: null, source_app: "client-success", source_system: "supabase" });
    expect(rowsNow[0].after).toMatchObject({ url: first.url, embed_url: first.embedUrl, revision: 1 });
    expect(rowsNow[0].metadata).toMatchObject({ op: "INSERT", deck: "launch", slot_key: "testing", lang: "en" });
    // The same values with the read's revision: nothing written. Another spelling of the same link is the same link.
    const same = await vSave(CSM_A2, { ...v, url: `https://www.youtube.com/watch?v=${YT}&t=90`, revision: 1 });
    expect(same).toMatchObject({ revision: 1, changed: false, updatedBy: "csm-a@tests.invalid" });
    expect((await audited()).length).toBe(1);
    // A new title (trimmed) and a length: revision 2, one audit row.
    const titled = await vSave(CSM_A2, { ...v, title: "  Why we test so many ads  ", seconds: 160, revision: 1 });
    expect(titled).toMatchObject({ revision: 2, title: "Why we test so many ads", durationSeconds: 160, updatedBy: "csm-a2@tests.invalid", changed: true });
    rowsNow = await audited();
    expect(rowsNow.length).toBe(2);
    expect(rowsNow[1]).toMatchObject({ action: "deck_video.save", actor_email: "csm-a2@tests.invalid" });
    expect(rowsNow[1].before).toMatchObject({ revision: 1, title: null });
    expect(rowsNow[1].after).toMatchObject({ revision: 2, title: "Why we test so many ads" });
    // A stale revision, a blind "I saw it empty" and a revision for a row that does not exist: conflicts, nothing written.
    const conflict = { code: "40001", message: SAVE_CONFLICT };
    expect(await failure(CSM_A, SAVE_SQL, saveArgs({ ...v, title: "Mine", revision: 1 }))).toEqual(conflict);
    expect(await failure(CSM_A, SAVE_SQL, saveArgs({ ...v, title: "Mine", revision: 0 }))).toEqual(conflict);
    expect(await failure(CSM_A, SAVE_SQL, saveArgs({ ...v, lang: "ar", revision: 3 }))).toEqual(conflict);
    expect((await audited()).length).toBe(2);
    expect(await videoRow("launch", "testing", "en")).toMatchObject({ title: "Why we test so many ads", revision: 2 });
    expect(await videoRow("launch", "testing", "ar")).toBeUndefined();
    // Field sentences, each before anything is written.
    const fields: [Partial<Video>, string][] = [
      [{ title: "x".repeat(41) }, "Keep the title under 40 characters."],
      [{ title: "Why we test\u0007" }, "The title has a character it can't keep. Type it again."],
      [{ title: "Why we\ntest" }, "The title has a character it can't keep. Type it again."],
      // A bidi override or isolate, or a line separator, would reorder or
      // split the recap's "- title: link" line in WhatsApp.
      [{ title: "Watch\u202Eevil" }, "The title has a character it can't keep. Type it again."],
      [{ title: "Watch\u2066evil" }, "The title has a character it can't keep. Type it again."],
      [{ title: "Watch\u2028evil" }, "The title has a character it can't keep. Type it again."],
      [{ seconds: 0 }, "The length must be between 1 second and 3 hours."],
      [{ seconds: 10801 }, "The length must be between 1 second and 3 hours."],
      [{ seconds: -5 }, "The length must be between 1 second and 3 hours."],
      [{ slot: "made-up" }, "That video slot is not in the launch deck."],
      [{ lang: "EN" }, "Choose English, Arabic or any language."],
    ];
    for (const [change, sentence] of fields)
      expect(await failure(CSM_A, SAVE_SQL, saveArgs({ ...v, revision: 2, ...change }))).toEqual({ code: "22023", message: sentence });
    expect((await audited()).length).toBe(2);
    // Forty characters and three hours are kept; a blank title is no title.
    expect(await vSave(CSM_A, { ...v, title: "y".repeat(40), seconds: 10800, revision: 2 })).toMatchObject({ revision: 3, title: "y".repeat(40), durationSeconds: 10800 });
    expect(await vSave(CSM_A, { ...v, title: "   ", seconds: 1, revision: 3 })).toMatchObject({ revision: 4, title: null, durationSeconds: 1 });
    expect((await audited()).length).toBe(4);
    // Arabic, with a right-to-left mark, is kept (another slot, so this
    // test's revisions stay as the next test reads them).
    expect(await vSave(CSM_A, { deck: "launch", slot: "call-team", lang: "ar", url: `https://www.loom.com/share/${LOOM}`, title: "كيف يشتغل\u200F فريق الاتصال", seconds: null, revision: 0 })).toMatchObject({ revision: 1, title: "كيف يشتغل\u200F فريق الاتصال" });
    // The read carries the row in the same shape.
    const read = await vRead(CSM_B, "launch");
    const { changed: _changed, ...shape } = await vSave(CSM_A, { ...v, title: null, seconds: 1, revision: 4 });
    expect(_changed).toBe(false);
    expect(read.rows.find((r: Row) => r.slotKey === "testing" && r.lang === "en")).toEqual(shape);
  });

  test("clear: keeps the row with its link removed, leaves the read, runs once, and a save with revision 0 records it again", async () => {
    const audited = async () => (await videoAudits()).filter(r => r.entity_id === "launch:testing:en");
    const before = (await audited()).length;
    const current = (await videoRow("launch", "testing", "en"))!;
    expect(current.revision).toBe(4);
    // A blind clear ("I saw it empty") on a recorded slot conflicts.
    expect(await failure(CSM_A, CLEAR_SQL, ["launch", "testing", "en", 0])).toEqual({ code: "40001", message: CLEAR_CONFLICT });
    expect(await failure(CSM_A, CLEAR_SQL, ["launch", "testing", "en", 3])).toEqual({ code: "40001", message: CLEAR_CONFLICT });
    expect((await audited()).length).toBe(before);
    const cleared = await vClear(CSM_A2, "launch", "testing", "en", 4);
    expect(cleared).toEqual({ deck: "launch", slotKey: "testing", lang: "en", cleared: true, revision: 5 });
    const row = (await videoRow("launch", "testing", "en"))!;
    expect(row).toMatchObject({ provider: null, url: null, embed_url: null, title: null, duration_seconds: null, revision: 5, updated_by: "csm-a2@tests.invalid" });
    expect(row.cleared_at).not.toBeNull();
    let added = (await audited()).slice(before);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({ action: "deck_video.clear", actor_email: "csm-a2@tests.invalid" });
    expect(added[0].before).toMatchObject({ url: `https://www.youtube.com/watch?v=${YT}&t=90`, revision: 4 });
    expect(added[0].after).toMatchObject({ url: null, revision: 5 });
    // The read leaves it out; a second clear (any revision of 0 or more) changes nothing.
    expect((await vRead(CSM_A, "launch")).rows.some((r: Row) => r.slotKey === "testing")).toBe(false);
    expect(await vClear(CSM_A, "launch", "testing", "en", 5)).toEqual({ deck: "launch", slotKey: "testing", lang: "en", cleared: false, revision: 5 });
    expect(await vClear(CSM_A, "launch", "testing", "en", 0)).toEqual({ deck: "launch", slotKey: "testing", lang: "en", cleared: false, revision: 5 });
    expect(await vClear(CSM_A, "launch", "first-90-days", "ar", 0)).toEqual({ deck: "launch", slotKey: "first-90-days", lang: "ar", cleared: false, revision: null });
    expect((await audited()).length).toBe(before + 1);
    // Undo: the same link with revision 0 records the cleared slot again.
    const undone = await vSave(CSM_A2, { deck: "launch", slot: "testing", lang: "en", url: `https://www.youtube.com/watch?v=${YT}&t=90`, seconds: 1, revision: 0 });
    expect(undone).toMatchObject({ revision: 6, changed: true, durationSeconds: 1 });
    expect((await videoRow("launch", "testing", "en"))?.cleared_at).toBeNull();
    expect((await vRead(CSM_A, "launch")).rows.some((r: Row) => r.slotKey === "testing" && r.lang === "en")).toBe(true);
    added = (await audited()).slice(before);
    expect(added.map(r => r.action)).toEqual(["deck_video.clear", "deck_video.save"]);
    // A cleared slot also takes its stored revision.
    await vClear(CSM_A, "launch", "testing", "en", 6);
    expect(await vSave(CSM_A, { deck: "launch", slot: "testing", lang: "en", url: `https://youtu.be/${YT}`, revision: 7 })).toMatchObject({ revision: 8, changed: true });
  });

  test("the table's own checks hold even for the owner", async () => {
    await asOwner();
    const insert = "INSERT INTO public.cockpit_csm_deck_videos(deck,slot_key,lang,provider,url,embed_url,title,duration_seconds,updated_by,cleared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'owner',$9)";
    const ownerFails = async (params: unknown[]) => {
      try {
        await db.query(insert, params);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error(`Expected the table to refuse ${JSON.stringify(params)}`);
    };
    const before = (await videoAudits()).length;
    // An unlisted host: the parser's sentence from inside the check.
    expect(await ownerFails(["launch", "payments", "any", "loom", "https://evil.example.org/share/x", "https://evil.example.org/embed/x", null, null, null])).toContain(HOSTS);
    // A listed link with an embed address the parser would not build.
    expect(await ownerFails(["launch", "payments", "any", "loom", `https://www.loom.com/share/${LOOM}`, "https://evil.example.org/embed", null, null, null])).toContain("cockpit_csm_deck_videos_link");
    expect(await ownerFails(["launch", "payments", "any", "youtube", `https://www.loom.com/share/${LOOM}`, `https://www.loom.com/embed/${LOOM}?hideEmbedTopBar=true`, null, null, null])).toContain("cockpit_csm_deck_videos_link");
    // A cleared row with a title, and half of each.
    expect(await ownerFails(["launch", "payments", "any", null, null, null, "A title", null, new Date().toISOString()])).toContain("cockpit_csm_deck_videos_state");
    expect(await ownerFails(["launch", "payments", "any", "loom", `https://www.loom.com/share/${LOOM}`, `https://www.loom.com/embed/${LOOM}?hideEmbedTopBar=true`, null, null, new Date().toISOString()])).toContain("cockpit_csm_deck_videos_state");
    // A slot not in the list.
    expect(await ownerFails(["launch", "welcome", "any", null, null, null, null, null, new Date().toISOString()])).toContain("cockpit_csm_deck_videos_slot");
    // An update is held to the same rule.
    let message = "";
    try {
      await db.query("UPDATE public.cockpit_csm_deck_videos SET url='https://evil.example.org/x' WHERE deck='launch' AND slot_key='portal-guide' AND lang='en'");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(HOSTS);
    expect((await videoAudits()).length).toBe(before);
    expect(await videoRow("launch", "payments", "any")).toBeUndefined();
  });

  test("the lists: each read carries its own deck's slots in registry order; the server holds twelve", async () => {
    const launch = await vRead(CSM_A, "launch");
    const onboarding = await vRead(CEO, "onboarding");
    expect(launch.slots).toEqual(LAUNCH_SLOTS);
    expect(onboarding.slots).toEqual(ONBOARDING_SLOTS);
    expect(launch.rows.every((r: Row) => r.deck === "launch")).toBe(true);
    expect(onboarding.rows.map((r: Row) => `${r.slotKey}:${r.lang}`)).toEqual(["meta-access:any", "welcome:any", "whatsapp-calendar:any"]);
    const keys = launch.rows.map((r: Row) => `${r.slotKey}:${r.lang}`);
    expect(keys).toEqual([...keys].sort());
    expect(Number.isNaN(Date.parse(launch.at))).toBe(false);
    expect(launch.rows.find((r: Row) => r.slotKey === "portal-guide" && r.lang === "en")).toEqual({
      deck: "launch", slotKey: "portal-guide", lang: "en", provider: "wistia",
      url: "https://fast.wistia.net/embed/iframe/lxlse6ckhf", embedUrl: "https://fast.wistia.net/embed/iframe/lxlse6ckhf?seo=false",
      title: null, durationSeconds: 277, revision: 1, updatedBy: SEED_BY, updatedAt: expect.any(String),
    });
    await asOwner();
    const all = (await db.query<{ r: string[] }>("SELECT public.cockpit_csm_deck_video_slots() r")).rows[0].r;
    expect(all).toEqual([...ONBOARDING_SLOTS, ...LAUNCH_SLOTS]);
    expect(all.length).toBe(12);
    for (const [deck, slot, ok] of [["launch", "testing", true], ["onboarding", "testing", true], ["launch", "welcome", false], [null, "testing", false], ["launch", null, false]] as [string | null, string | null, boolean][])
      expect((await db.query<{ ok: boolean }>("SELECT public.cockpit_csm_deck_video_slot_ok($1::text,$2::text) ok", [deck, slot])).rows[0].ok).toBe(ok);
    // No client data travels with a video read (a slot belongs to no client).
    for (const leak of ["taskA1", "taskB1", "Acme", "Beta", "clientName", "taskId"]) expect(JSON.stringify([launch, onboarding]).includes(leak)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The visual pass (docs/csm-decks/DRIVE-IMPORT.md 10, VIDEOS.md 9): the Drive
// imports (20261020160000), three prep keys (20261020160100) and the video
// posters (20261020160200), applied twice after every test above, so the
// earlier blocks keep testing the files as they stood.
// ---------------------------------------------------------------------------

const DRIVE_FILE = "20261020160000_csm_launch_ads_drive.sql";
const PREP_AR = "20261020160100_csm_deck_prep_dos_ar.sql";
const POSTERS = "20261020160200_csm_deck_video_posters.sql";
const WORKER = "editor-desk@vps-1";
const F = (n: number) => `1Folder${String(n).padStart(8, "0")}xyzAB`;
const FILE_ID = (n: number) => `1File${String(n).padStart(10, "0")}abcDE`;

type Failure = { code: string; message: string; hint: string | null };
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
  } finally {
    await asOwner();
  }
}
async function svcFail(text: string, params: unknown[] = []): Promise<Failure> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(text, params);
  } catch (e) {
    const err = e as { code?: string; message: string; hint?: string };
    return {
      code: err.code ?? "",
      message: err.message,
      hint: err.hint ?? null,
    };
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function fail(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<Failure> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    const err = e as { code?: string; message: string; hint?: string };
    return {
      code: err.code ?? "",
      message: err.message,
      hint: err.hint ?? null,
    };
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
const REQUEST = "SELECT public.cockpit_csm_launch_ads_import_request($1,$2) r";
const READ_IMPORTS = "SELECT public.cockpit_csm_launch_ads_imports_read($1) r";
const request = (who: string, task: string, link: string) =>
  one(who, REQUEST, [task, link]);
const claim = (worker = WORKER, peek = false) =>
  svc("SELECT public.cockpit_csm_launch_ads_import_claim($1,$2) r", [
    worker,
    peek,
  ]);
const heartbeat = (id: string, worker = WORKER) =>
  svc("SELECT public.cockpit_csm_launch_ads_import_heartbeat($1::uuid,$2) r", [
    id,
    worker,
  ]);
const PLAN =
  "SELECT public.cockpit_csm_launch_ads_import_plan($1::uuid,$2,$3,$4::jsonb,$5) r";
const plan = (
  id: string,
  files: Row[],
  kind = "folder",
  over = false,
  worker = WORKER,
) => svc(PLAN, [id, worker, kind, JSON.stringify(files), over]);
const RESERVE =
  "SELECT public.cockpit_csm_launch_ads_import_file_reserve($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) r";
const fileReserve = (
  id: string,
  file: string,
  mime: string,
  bytes: number,
  extra: unknown[] = [null, null, null, null, null, null],
  worker = WORKER,
) => svc(RESERVE, [id, worker, file, mime, bytes, ...extra]);
const LANDED =
  "SELECT public.cockpit_csm_launch_ads_import_file_landed($1::uuid,$2,$3) r";
const landed = (id: string, file: string, worker = WORKER) =>
  svc(LANDED, [id, worker, file]);
const FAILED =
  "SELECT public.cockpit_csm_launch_ads_import_file_failed($1::uuid,$2,$3,$4) r";
const fileFailed = (id: string, file: string, code: string, worker = WORKER) =>
  svc(FAILED, [id, worker, file, code]);
const FINISH =
  "SELECT public.cockpit_csm_launch_ads_import_finish($1::uuid,$2,$3) r";
const finish = (id: string, code: string | null = null, worker = WORKER) =>
  svc(FINISH, [id, worker, code]);
const media = (n: number, extra: Row = {}) => ({
  id: FILE_ID(n),
  name: `kitchen-${n}.mp4`,
  mime: "video/mp4",
  bytes: 1000 + n,
  createdTime: "2026-10-18T09:12:00Z",
  resourceKey: null,
  ...extra,
});
async function importRow(id: string): Promise<Row> {
  await asOwner();
  return (
    await db.query<Row>(
      "SELECT * FROM public.cockpit_csm_launch_ads_imports WHERE id=$1",
      [id],
    )
  ).rows[0];
}
async function adRow(id: string): Promise<Row> {
  await asOwner();
  return (
    await db.query<Row>(
      "SELECT * FROM public.cockpit_csm_launch_ads WHERE id=$1",
      [id],
    )
  ).rows[0];
}
const importAudits = () => audits("cockpit_csm_launch_ads_imports");
/** Every open import out of the way, so the next claim takes the one a test means. */
async function closeOpen() {
  await asOwner();
  await db.query(
    "UPDATE public.cockpit_csm_launch_ads_imports SET status='failed', code='not_started', message='closed by the test', finished_at=now() WHERE status IN ('queued','working')",
  );
}

/**
 * The census of every deck function (the decks, the launch ads, the Drive
 * imports and the video posters): how many, an empty search path each, a
 * definer but the immutable helpers, and who may call which. Run after the
 * visual pass's files and again after 20261020160300.
 */
async function census() {
  const fns = (
    await db.query<{
      sig: string;
      definer: boolean;
      config: string[] | null;
    }>(`
    SELECT p.oid::regprocedure::text sig, p.prosecdef definer, p.proconfig config FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'cockpit_csm_deck%' OR p.proname LIKE 'cockpit_csm_launch%'
        OR p.proname LIKE 'cockpit_csm_drive%')`)
  ).rows;
  expect(fns.length).toBe(45);
  const browser = [
    "cockpit_csm_launch_object_allowed",
    "cockpit_csm_deck_sources",
    "cockpit_csm_deck_prep_read",
    "cockpit_csm_launch_ads_read",
    "cockpit_csm_launch_ad_get",
    "cockpit_csm_deck_prep_save",
    "cockpit_csm_launch_ad_reserve",
    "cockpit_csm_launch_ad_accept",
    "cockpit_csm_launch_ad_update",
    "cockpit_csm_launch_ad_remove",
    "cockpit_csm_launch_ad_stale",
    "cockpit_csm_launch_ad_purged",
    "cockpit_csm_deck_videos_read",
    "cockpit_csm_deck_video_save",
    "cockpit_csm_deck_video_clear",
    "cockpit_csm_launch_ads_import_request",
    "cockpit_csm_launch_ads_imports_read",
  ];
  const worker = [
    "cockpit_csm_launch_ads_import_claim",
    "cockpit_csm_launch_ads_import_heartbeat",
    "cockpit_csm_launch_ads_import_plan",
    "cockpit_csm_launch_ads_import_file_reserve",
    "cockpit_csm_launch_ads_import_file_landed",
    "cockpit_csm_launch_ads_import_file_failed",
    "cockpit_csm_launch_ads_import_finish",
    "cockpit_csm_deck_video_posters_due",
    "cockpit_csm_deck_video_poster_save",
  ];
  const notDefiners = [
    "cockpit_csm_deck_text",
    "cockpit_csm_deck_choice",
    "cockpit_csm_deck_video_slots",
    "cockpit_csm_deck_video_slot_ok",
    "cockpit_csm_deck_video_parse",
    "cockpit_csm_drive_link_parse",
    "cockpit_csm_drive_import_sentence",
  ];
  for (const fn of fns) {
    const name = fn.sig.split("(")[0].replace(/^public\./, "");
    expect(fn.config).toContain('search_path=""');
    expect(fn.definer).toBe(!notDefiners.includes(name));
    const can = async (role: string) =>
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, fn.sig],
        )
      ).rows[0].ok;
    expect(await can("anon")).toBe(false);
    expect(await can("authenticated")).toBe(browser.includes(name));
    expect(await can("service_role")).toBe(worker.includes(name));
  }
  // The internal ones are definers callable by nobody.
  for (const name of [
    "cockpit_csm_launch_ads_import_json",
    "cockpit_csm_launch_ads_import_end",
    "cockpit_csm_deck_video_poster_reset",
  ])
    expect(
      fns.some(
        f =>
          f.sig.replace(/^public\./, "").startsWith(`${name}(`) && f.definer,
      ),
    ).toBe(true);
}

describe("the visual pass: Drive imports, prep keys and video posters", () => {
  beforeAll(async () => {
    await asOwner();
    for (const file of [DRIVE_FILE, PREP_AR, POSTERS]) {
      await db.exec(migration(file));
      await db.exec(migration(file));
    }
  }, 30000);

  test("the parser gives every row of driveLink.cases.json what the browser's does", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const cases = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dir,
          "../../client-success-cockpit/src/present/driveLink.cases.json",
        ),
        "utf8",
      ),
    ).cases as { name: string; link: string | null; want: Row }[];
    expect(cases.length).toBeGreaterThan(60);
    await asOwner();
    for (const c of cases) {
      const got = (
        await db.query<{ r: Row }>(
          "SELECT public.cockpit_csm_drive_link_parse($1::text) r",
          [c.link],
        )
      ).rows[0].r;
      expect({ name: c.name, got }).toEqual({ name: c.name, got: c.want });
    }
  });

  test("the census: 45 functions, every one with an empty search path; who may call which", async () => {
    await census();
  });

  test("the two tables: row security on, no policies, no grant to any role, the service key included; the trigger audits the imports", async () => {
    for (const table of [
      "public.cockpit_csm_launch_ads_imports",
      "public.cockpit_csm_drive_import_worker",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"])
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
        ])
          expect(
            (
              await db.query<{ ok: boolean }>(
                "SELECT has_table_privilege($1,$2,$3) ok",
                [role, table, privilege],
              )
            ).rows[0].ok,
          ).toBe(false);
      expect(
        (
          await db.query<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [table],
          )
        ).rows[0].rls,
      ).toBe(true);
    }
    expect(
      (
        await db.query(
          "SELECT 1 FROM pg_policies WHERE tablename IN ('cockpit_csm_launch_ads_imports','cockpit_csm_drive_import_worker')",
        )
      ).rows.length,
    ).toBe(0);
    expect(
      await svcFail("SELECT * FROM public.cockpit_csm_launch_ads_imports"),
    ).toMatchObject({ message: expect.stringContaining("permission denied") });
    expect(
      await fail(CSM_A, "SELECT * FROM public.cockpit_csm_launch_ads_imports"),
    ).toMatchObject({ message: expect.stringContaining("permission denied") });
    const triggers = (
      await db.query<Row>(
        "SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.cockpit_csm_launch_ads_imports'::regclass,'public.cockpit_csm_drive_import_worker'::regclass) AND NOT tgisinternal",
      )
    ).rows;
    expect(triggers.map(t => t.tgname)).toEqual([
      "cockpit_csm_launch_ads_imports_audit",
    ]);
    // The claim's sweep takes rows FOR UPDATE SKIP LOCKED (PGlite is one session, so it is read from the body).
    const body = (
      await db.query<{ d: string }>(
        "SELECT pg_get_functiondef('public.cockpit_csm_launch_ads_import_claim(text,boolean)'::regprocedure) d",
      )
    ).rows[0].d;
    expect(body).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  test("request: the gate, each refusal's code in its hint, the rebuilt link stored, the same open link once", async () => {
    await closeOpen();
    const before = (await importAudits()).length;
    const link = `https://drive.google.com/drive/u/1/folders/${F(1)}?authuser=noura@acme.example&usp=sharing`;
    for (const who of [BUYER, SALES, GONE, UNCONFIRMED, CSM_B])
      expect((await fail(who, REQUEST, [A, link])).code).toBe("42501");
    expect((await fail(null, REQUEST, [A, link])).message).toContain(
      "permission denied",
    );
    const refusals: [string, string, string][] = [
      [
        "",
        "link_empty",
        "Paste a Drive link: a folder, or one video or picture.",
      ],
      [
        "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit",
        "link_docs",
        "That's a Google Docs link. Paste a Drive folder, or one video or picture.",
      ],
      [
        "https://drive.google.com/drive/my-drive",
        "link_page",
        "This link opens a Drive page, not a folder. Open the folder and copy its link.",
      ],
      [
        "javascript:alert(1)",
        "link_bad",
        "This isn't a Drive folder or file link.",
      ],
    ];
    for (const [bad, hint, message] of refusals)
      expect(await fail(CSM_A, REQUEST, [A, bad])).toEqual({
        code: "22023",
        hint,
        message,
      });
    expect((await importAudits()).length).toBe(before);
    const first = await request(CSM_A, A, link);
    expect(first).toMatchObject({
      existing: false,
      taskId: A,
      status: "queued",
      kind: "folder",
      driveId: F(1),
      found: null,
      link: `https://drive.google.com/drive/folders/${F(1)}`,
      requestedBy: "csm-a@tests.invalid",
      files: [],
      landed: 0,
    });
    expect(JSON.stringify(first)).not.toContain("acme.example");
    const again = await request(
      CSM_A2,
      A,
      `https://drive.google.com/drive/folders/${F(1)}`,
    );
    expect(again).toMatchObject({ existing: true, id: first.id });
    const added = (await importAudits()).slice(before);
    expect(added.map(r => [r.action, r.actor_email, r.entity_id])).toEqual([
      ["driveImport.request", "csm-a@tests.invalid", first.id],
    ]);
    // Beta's seat cannot read Acme's imports.
    expect((await fail(CSM_B, READ_IMPORTS, [A])).code).toBe("42501");
  });

  test("ten open imports a client, thirty links a seat an hour", async () => {
    await closeOpen();
    const task = "twin1";
    for (let i = 0; i < 10; i++)
      await request(
        CSM_ALL,
        task,
        `https://drive.google.com/drive/folders/${F(100 + i)}`,
      );
    expect(
      await fail(CSM_ALL, REQUEST, [
        task,
        `https://drive.google.com/drive/folders/${F(110)}`,
      ]),
    ).toEqual({
      code: "22023",
      hint: "too_many_open",
      message:
        "Ten imports are already running for this client. Wait for one to finish, then paste the link again.",
    });
    await closeOpen();
    // Twenty more in the last hour from this seat (finished ones count too).
    await asOwner();
    for (let i = 0; i < 20; i++)
      await db.query(
        `INSERT INTO public.cockpit_csm_launch_ads_imports(task_id,link,drive_id,kind,status,code,message,requested_by,requested_by_email,finished_at)
        VALUES('twin2',$1,$2,'folder','failed','not_found','x',$3,'csm-all@tests.invalid',now())`,
        [
          `https://drive.google.com/drive/folders/${F(200 + i)}`,
          F(200 + i),
          CSM_ALL,
        ],
      );
    expect(
      await fail(CSM_ALL, REQUEST, [
        task,
        `https://drive.google.com/drive/folders/${F(111)}`,
      ]),
    ).toEqual({
      code: "22023",
      hint: "too_many_links",
      message:
        "Too many Drive links in the last hour. Wait a few minutes, then paste it again.",
    });
    // An hour later the seat may paste again (the next tests start clean).
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET requested_at = requested_at - interval '2 hours' WHERE requested_by=$1",
      [CSM_ALL],
    );
  });

  test("read: open ones first whatever their age, then 14 days of finished ones, 20 at most, newest first; found null before the plan", async () => {
    await closeOpen();
    await asOwner();
    await db.query(
      `INSERT INTO public.cockpit_csm_launch_ads_imports(task_id,link,drive_id,kind,status,code,message,requested_by,requested_by_email,requested_at,finished_at)
      VALUES('twin2',$1,$2,'folder','failed','not_found','x',$3,'csm-all@tests.invalid',now()-interval '20 days',now()-interval '20 days')`,
      [`https://drive.google.com/drive/folders/${F(300)}`, F(300), CSM_ALL],
    );
    const old = await request(
      CSM_ALL,
      "twin2",
      `https://drive.google.com/drive/folders/${F(301)}`,
    );
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET requested_at=now()-interval '40 days' WHERE id=$1",
      [old.id],
    );
    const read = await one(CSM_ALL, READ_IMPORTS, ["twin2"]);
    expect(read.imports.length).toBe(20);
    expect(read.imports.some((i: Row) => i.id === old.id)).toBe(true);
    expect(read.imports.some((i: Row) => i.driveId === F(300))).toBe(false);
    const times = read.imports.map((i: Row) => Date.parse(i.requestedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(read.imports.find((i: Row) => i.id === old.id).found).toBeNull();
    expect(Number.isNaN(Date.parse(read.at))).toBe(false);
  });

  test("a folder comes in: claim, plan, reserve, upload, landed, finish; each write audited with the worker as actor", async () => {
    await closeOpen();
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(2)}`,
    );
    // Already in the tray: one file from an earlier import.
    await asOwner();
    const peek = await claim("doctor", true);
    expect(peek).toMatchObject({ queued: 1, working: 0 });
    const auditsBefore = (await importAudits()).length;
    const taken = await claim();
    expect(taken.import).toMatchObject({
      id: imp.id,
      status: "working",
      resumed: false,
      resourceKey: null,
    });
    expect(taken.queued).toBe(0);
    // The worker row is written; the doctor's peek wrote nothing.
    const planned = await plan(imp.id, [
      media(1),
      media(2, { name: "../../etc/pass‮wd.jpg", mime: "image/jpeg" }),
      media(3),
    ]);
    expect(planned.found).toBe(3);
    expect(planned.files.map((f: Row) => [f.name, f.status])).toEqual([
      ["kitchen-1.mp4", "queued"],
      ["passwd.jpg", "queued"],
      ["kitchen-3.mp4", "queued"],
    ]);
    // Video: reserve, then the bytes and the poster, then landed.
    const r1 = await fileReserve(imp.id, FILE_ID(1), "video/mp4", 5_000_000, [
      1080,
      1920,
      30,
      "image/jpeg",
      90_000,
      "converted",
    ]);
    expect(r1.resumed).toBe(false);
    expect(r1.path).toBe(`${A}/${r1.adId}.mp4`);
    expect(r1.posterPath).toBe(`${A}/${r1.adId}-poster.jpg`);
    const row = await adRow(r1.adId);
    expect(row).toMatchObject({
      task_id: A,
      kind: "custom",
      status: "uploading",
      source: "drive",
      source_drive_id: FILE_ID(1),
      import_id: imp.id,
      created_by: CSM_A,
      created_by_email: "csm-a@tests.invalid",
      updated_by: `worker:${WORKER}`,
      file_name: "kitchen-1.mp4",
    });
    expect(row.request_id).not.toBe(row.id);
    // The file did not arrive: refused.
    expect(await svcFail(LANDED, [imp.id, WORKER, FILE_ID(1)])).toMatchObject({
      code: "22023",
      message: "The file did not arrive. Upload it again.",
    });
    await putObject(r1.path, 5_000_000, "video/mp4");
    await putObject(r1.posterPath, 90_000, "image/jpeg");
    const after1 = await landed(imp.id, FILE_ID(1));
    expect(after1.landed).toBe(1);
    expect(after1.files[0]).toMatchObject({
      status: "landed",
      note: "converted",
      adId: r1.adId,
    });
    expect((await adRow(r1.adId)).status).toBe("ready");
    // A second landed writes nothing.
    const n = (await importAudits()).length;
    await landed(imp.id, FILE_ID(1));
    expect((await importAudits()).length).toBe(n);
    // A picture: Storage's size differs, so it is refused; the worker reports storage.
    const r2 = await fileReserve(imp.id, FILE_ID(2), "image/jpeg", 2048, [
      1080,
      1350,
      null,
      null,
      null,
      null,
    ]);
    await putObject(r2.path, 2047, "image/jpeg");
    expect((await svcFail(LANDED, [imp.id, WORKER, FILE_ID(2)])).message).toBe(
      "The file did not arrive. Upload it again.",
    );
    const failed2 = await fileFailed(imp.id, FILE_ID(2), "storage");
    expect(failed2.files[1]).toMatchObject({
      status: "failed",
      code: "storage",
      message:
        "passwd.jpg didn't save. Paste the link again; files already in the tray are skipped.",
    });
    expect((await adRow(r2.adId)).status).toBe("removed");
    // The third never got past its download: finish fails it as unfinished.
    const done = await finish(imp.id);
    expect(done).toMatchObject({
      status: "done",
      code: null,
      message: null,
      landed: 1,
      failed: 2,
      found: 3,
    });
    expect(done.files[2]).toMatchObject({
      status: "failed",
      code: "unfinished",
      message:
        "kitchen-3.mp4 didn't finish. Paste the link again; files already in the tray are skipped.",
    });
    expect(await finish(imp.id)).toMatchObject({ status: "done" });
    // Every write audited once, the worker named, only changed columns kept.
    const added = (await importAudits()).slice(auditsBefore);
    expect(added.map(r => r.action)).toEqual([
      "driveImport.claim",
      "driveImport.plan",
      "driveImport.reserve",
      "driveImport.ready",
      "driveImport.reserve",
      "driveImport.fileFailed",
      "driveImport.finish",
    ]);
    expect(added.every(r => r.actor_email === `worker:${WORKER}`)).toBe(true);
    const ready = added.find(r => r.action === "driveImport.ready");
    expect(ready?.after.landed).toBe(1);
    expect(ready?.after.status).toBeUndefined();
    expect(Object.keys(ready?.after.files)).toEqual([FILE_ID(1)]);
    const adAudits = (await audits("cockpit_csm_launch_ads")).filter(
      r => r.entity_id === r1.adId || r.entity_id === r2.adId,
    );
    expect(adAudits.map(r => [r.action, r.actor_email])).toEqual([
      ["driveImport.reserve", `worker:${WORKER}`],
      ["driveImport.ready", `worker:${WORKER}`],
      ["driveImport.reserve", `worker:${WORKER}`],
      ["driveImport.drop", `worker:${WORKER}`],
    ]);
    // The browser reads it without the worker's fields.
    const read = await one(CSM_A, READ_IMPORTS, [A]);
    const mine = read.imports.find((i: Row) => i.id === imp.id);
    expect(mine.files[0]).toEqual({
      driveId: FILE_ID(1),
      name: "kitchen-1.mp4",
      kind: "video",
      bytes: 1001,
      status: "landed",
      code: null,
      message: null,
      note: "converted",
      adId: r1.adId,
    });
    expect(mine.resourceKey).toBeUndefined();
    expect(mine.startedAt).not.toBeNull();
    // A later plain service-role write is not the worker's (the actor is transaction-local).
    await asOwner();
    await db.exec("SET ROLE service_role");
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads SET hidden=true WHERE id=$1",
      [r1.adId],
    );
    await asOwner();
    const last = (await audits("cockpit_csm_launch_ads")).at(-1);
    expect(last?.actor_email).not.toContain("worker:");
  });

  test("the same file twice: skipped at plan, skipped at reserve, and a racing reserve is skipped, not an error", async () => {
    await closeOpen();
    // FILE_ID(1) landed above for Acme.
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(3)}`,
    );
    await claim();
    const planned = await plan(imp.id, [media(1), media(4)]);
    expect(planned.files.map((f: Row) => f.status)).toEqual([
      "skipped",
      "queued",
    ]);
    expect(planned.skipped).toBe(1);
    // Another import of the same client reserves FILE_ID(4) first.
    const other = await request(
      CSM_A,
      A,
      `https://drive.google.com/file/d/${FILE_ID(4)}/view`,
    );
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET status='working', claimed_at=now(), claimed_by='other-run', heartbeat_at=now() WHERE id=$1",
      [other.id],
    );
    await svc(PLAN, [
      other.id,
      "other-run",
      "file",
      JSON.stringify([media(4)]),
      false,
    ]);
    const otherRes = await svc(RESERVE, [
      other.id,
      "other-run",
      FILE_ID(4),
      "video/mp4",
      4000,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(otherRes.resumed).toBe(false);
    // Ours: an ad with that Drive id exists now: skipped.
    expect(await fileReserve(imp.id, FILE_ID(4), "video/mp4", 4000)).toEqual({
      skipped: true,
    });
    const row = await importRow(imp.id);
    expect(row.skipped).toBe(2);
    const actions = (await importAudits())
      .filter(r => r.entity_id === imp.id)
      .map(r => r.action);
    expect(actions).toContain("driveImport.skip");
  });

  test("a resumed import: the claim expires, the next run takes it again (resumed), re-reserves the same row and lands it; another mime is refused", async () => {
    await closeOpen();
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(5)}`,
    );
    await claim("run-one");
    await svc(PLAN, [
      imp.id,
      "run-one",
      "folder",
      JSON.stringify([media(10), media(11)]),
      false,
    ]);
    const first = await svc(RESERVE, [
      imp.id,
      "run-one",
      FILE_ID(10),
      "video/mp4",
      7000,
      1080,
      1920,
      12,
      null,
      null,
      null,
    ]);
    // run-one dies; five minutes pass without a heartbeat.
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET heartbeat_at=now()-interval '6 minutes' WHERE id=$1",
      [imp.id],
    );
    const again = await claim("run-two");
    expect(again.import).toMatchObject({ id: imp.id, resumed: true });
    expect((await importRow(imp.id)).attempts).toBe(2);
    // The slower run is stopped at its next call, and writes nothing.
    expect(
      await svcFail(LANDED, [imp.id, "run-one", FILE_ID(10)]),
    ).toMatchObject({
      code: "40001",
      message: "This import is not yours to work on.",
    });
    expect(
      await svcFail(
        "SELECT public.cockpit_csm_launch_ads_import_heartbeat($1::uuid,$2) r",
        [imp.id, "run-one"],
      ),
    ).toMatchObject({ code: "40001" });
    // Plan is not sent again; a plan after a file started is 55000, never 40001.
    expect(
      await svcFail(PLAN, [
        imp.id,
        "run-two",
        "folder",
        JSON.stringify([media(10)]),
        false,
      ]),
    ).toMatchObject({
      code: "55000",
      message: "This import already started its files.",
    });
    expect(
      await svcFail(RESERVE, [
        imp.id,
        "run-two",
        FILE_ID(10),
        "video/quicktime",
        7000,
        null,
        null,
        null,
        null,
        null,
        null,
      ]),
    ).toMatchObject({
      code: "22023",
      message: "That file changed in Drive since it was reserved.",
    });
    const resumed = await svc(RESERVE, [
      imp.id,
      "run-two",
      FILE_ID(10),
      "video/mp4",
      7100,
      1080,
      1920,
      12,
      null,
      null,
      null,
    ]);
    expect(resumed).toEqual({
      adId: first.adId,
      path: first.path,
      posterPath: null,
      resumed: true,
    });
    expect(Number((await adRow(first.adId)).bytes)).toBe(7100);
    await putObject(first.path, 7100, "video/mp4");
    const out = await svc(LANDED, [imp.id, "run-two", FILE_ID(10)]);
    expect(out.landed).toBe(1);
    expect((await importRow(imp.id)).attempts).toBe(0);
    expect(await svc(FINISH, [imp.id, "run-two", null])).toMatchObject({
      status: "done",
      landed: 1,
      failed: 1,
    });
  });

  test("claim: three takes in a row without a file landing end it stopped, with its uploading rows removed", async () => {
    await closeOpen();
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(6)}`,
    );
    await claim();
    await plan(imp.id, [media(20)]);
    const res = await fileReserve(imp.id, FILE_ID(20), "video/mp4", 9000);
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET attempts=3, heartbeat_at=now()-interval '6 minutes' WHERE id=$1",
      [imp.id],
    );
    expect((await claim()).import).toBeNull();
    const row = await importRow(imp.id);
    expect(row).toMatchObject({
      status: "failed",
      code: "stopped",
      message:
        "This import stopped three times without bringing anything in. Paste the link again, or upload the files here.",
    });
    expect(row.files[0]).toMatchObject({
      status: "failed",
      code: "unfinished",
    });
    expect((await adRow(res.adId)).status).toBe("removed");
  });

  test("claim: a requester who lost the client ends it access_revoked; a client gone from the roster does not block the next client's import, and ends not_started after 30 minutes", async () => {
    await closeOpen();
    const revoked = await request(
      CSM_B,
      B,
      `https://drive.google.com/drive/folders/${F(7)}`,
    );
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
      [["Acme Interiors"], CSM_B],
    );
    expect((await claim()).import).toBeNull();
    expect(await importRow(revoked.id)).toMatchObject({
      status: "failed",
      code: "access_revoked",
    });
    await db.query(
      "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
      [["Beta Build"], CSM_B],
    );
    // twin1's card goes missing from the roster; Acme's import is queued after it.
    const stuck = await request(
      CSM_ALL,
      "twin2",
      `https://drive.google.com/drive/folders/${F(8)}`,
    );
    const next = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(9)}`,
    );
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_sources SET data = data || '{\"taskId\":\"twin2-gone\"}'::jsonb WHERE table_name='clients' AND data->>'taskId'='twin2'",
    );
    const taken = await claim();
    expect(taken.import?.id).toBe(next.id);
    expect((await importRow(stuck.id)).status).toBe("queued");
    await closeOpen();
    const stuck2 = await request(
      CSM_ALL,
      "twin1",
      `https://drive.google.com/drive/folders/${F(10)}`,
    );
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET status='queued', code=NULL, message=NULL, finished_at=NULL, claimed_at=NULL WHERE id=$1",
      [stuck.id],
    );
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET status='failed', code='not_found', message='x', finished_at=now() WHERE id=$1",
      [stuck2.id],
    );
    const waiting = await claim();
    expect(waiting).toMatchObject({
      import: null,
      waiting:
        "The client ID is missing or ambiguous. Refresh its native source",
    });
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET requested_at=now()-interval '31 minutes' WHERE id=$1",
      [stuck.id],
    );
    await claim();
    expect(await importRow(stuck.id)).toMatchObject({
      status: "failed",
      code: "not_started",
    });
    await db.query(
      "UPDATE public.cockpit_csm_sources SET data = data || '{\"taskId\":\"twin2\"}'::jsonb WHERE table_name='clients' AND data->>'taskId'='twin2-gone'",
    );
  });

  test("a roster mid-refresh at reserve is the import's, not the file's: 55006, nothing written", async () => {
    await closeOpen();
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(11)}`,
    );
    await claim();
    await plan(imp.id, [media(30)]);
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_source_state SET ready=false WHERE table_name='clients'",
    );
    expect(
      await svcFail(RESERVE, [
        imp.id,
        WORKER,
        FILE_ID(30),
        "video/mp4",
        100,
        null,
        null,
        null,
        null,
        null,
        null,
      ]),
    ).toMatchObject({ code: "55006", hint: "roster" });
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_source_state SET ready=true WHERE table_name='clients'",
    );
    expect((await importRow(imp.id)).files[0].status).toBe("queued");
  });

  test("heartbeat: refreshes the import and the worker row, writes no audit row; workerSeenAt is the later of the two", async () => {
    await closeOpen();
    const imp = await request(
      CSM_A,
      A,
      `https://drive.google.com/drive/folders/${F(12)}`,
    );
    await claim();
    const before = (await importAudits()).length;
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_csm_drive_import_worker SET seen_at=now()-interval '1 hour'",
    );
    await db.query(
      "UPDATE public.cockpit_csm_launch_ads_imports SET heartbeat_at=now()-interval '2 hours' WHERE id=$1",
      [imp.id],
    );
    await heartbeat(imp.id);
    expect((await importAudits()).length).toBe(before);
    const row = await importRow(imp.id);
    expect(Date.now() - Date.parse(row.heartbeat_at)).toBeLessThan(60_000);
    const read = await one(CSM_A, READ_IMPORTS, [A]);
    expect(Date.now() - Date.parse(read.workerSeenAt)).toBeLessThan(60_000);
    // Plan's checks: each file once, at least one, a known kind; finish takes the worker's four codes only.
    expect(
      await svcFail(PLAN, [
        imp.id,
        WORKER,
        "folder",
        JSON.stringify([media(40), media(40)]),
        false,
      ]),
    ).toMatchObject({ code: "22023", message: "Send each file once." });
    expect(
      await svcFail(PLAN, [imp.id, WORKER, "folder", "[]", false]),
    ).toMatchObject({
      message: "Send at least one file, or finish with nothing_found.",
    });
    expect(
      await svcFail(FINISH, [imp.id, WORKER, "access_revoked"]),
    ).toMatchObject({ code: "22023", message: "Name an import failure." });
    expect(
      await svcFail(FAILED, [imp.id, WORKER, FILE_ID(40), "nope"]),
    ).toMatchObject({ code: "22023", message: "Name a file failure." });
    expect(
      await svcFail(
        "SELECT public.cockpit_csm_launch_ads_import_claim($1,false) r",
        ["Bad Worker!"],
      ),
    ).toMatchObject({ code: "22023", message: "Name the worker." });
    expect(
      await svcFail(
        "SELECT public.cockpit_csm_launch_ads_import_heartbeat($1::uuid,$2) r",
        ["00000000-0000-4000-8000-000000000000", WORKER],
      ),
    ).toMatchObject({ code: "P0002" });
    const failed = await finish(imp.id, "not_found");
    expect(failed).toMatchObject({
      status: "failed",
      code: "not_found",
      message:
        "We can't open this folder. Ask the client to share it as anyone with the link, or move it into their Drive folder.",
    });
  });

  test("prep keeps the three keys: the Arabic of card lines, the example's theme, and the choice the server stamps every time", async () => {
    const saved = await save(CSM_A, A, "launch", {
      dos_donts_ar: {
        " Never show prices in an ad ": " ما نعرض الأسعار ",
        "Show real projects": "",
      },
    });
    expect(saved.overrides.dos_donts_ar).toEqual({
      "Never show prices in an ad": "ما نعرض الأسعار",
    });
    for (const [patch, message] of [
      [{ dos_donts_ar: ["x"] }, "dos_donts_ar maps card lines to their Arabic"],
      [{ dos_donts_ar: { " ": "x" } }, "card line that is empty or too long"],
      [{ example_theme: "garage" }, "example_theme must be one of"],
      [
        { starter_pack: "kitchens" },
        "starter_pack is a yes or no, or one of the service keys",
      ],
      [
        { service_chosen_at: 5 },
        "service_chosen_at is set with true and cleared with null",
      ],
    ] as [Row, string][])
      expect(
        await refused(
          CSM_A,
          "SELECT public.cockpit_csm_deck_prep_save($1,'onboarding',$2::jsonb)",
          [A, JSON.stringify(patch)],
        ),
      ).toContain(message);
    expect(
      (await save(CSM_A, A, "launch", { dos_donts_ar: null })).overrides
        .dos_donts_ar,
    ).toBeUndefined();
    expect(
      (await save(CSM_A, A, "onboarding", { example_theme: "majlis" }))
        .overrides.example_theme,
    ).toBe("majlis");
    // The CEO, 2026-10-21: the example follows the main service. The five
    // service keys and the six scenes added for them are kept too.
    for (const theme of ["design-build", "interior", "architecture", "fitout", "construction", "fitout2", "designbuild", "architecture2"])
      expect(
        (await save(CSM_A, A, "onboarding", { example_theme: theme })).overrides.example_theme,
      ).toBe(theme);
    // The starter pack names the service it was made for (fixer round 2),
    // and a yes saved before keys is kept as it was.
    for (const pack of ["interior", "fitout", "other", true])
      expect(
        (await save(CSM_A, A, "onboarding", { starter_pack: pack })).overrides.starter_pack,
      ).toBe(pack);
    await save(CSM_A, A, "onboarding", { starter_pack: null });
    const first = await save(CSM_A, A, "onboarding", {
      service_chosen_at: true,
    });
    const stamp = first.overrides.service_chosen_at;
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await new Promise(r => setTimeout(r, 15));
    const second = await save(CSM_A, A, "onboarding", {
      service_chosen_at: "1999-01-01T00:00:00Z",
    });
    expect(second.overrides.service_chosen_at).not.toBe(
      "1999-01-01T00:00:00.000Z",
    );
    expect(
      Date.parse(second.overrides.service_chosen_at),
    ).toBeGreaterThanOrEqual(Date.parse(stamp));
    expect(
      (await save(CSM_A, A, "onboarding", { service_chosen_at: null }))
        .overrides.service_chosen_at,
    ).toBeUndefined();
    expect(
      await refused(
        CSM_A,
        "SELECT public.cockpit_csm_deck_prep_save($1,'launch','{\"leads\":1}'::jsonb)",
        [A],
      ),
    ).toContain('Prep does not keep "leads"');
  });

  test("posters: the six seeds backfilled, the read carries them, a new link clears one, the worker's due list and save", async () => {
    await asOwner();
    const seeds = (
      await db.query<Row>(
        "SELECT deck, slot_key, lang, poster_url FROM public.cockpit_csm_deck_videos WHERE url IS NOT NULL ORDER BY deck, slot_key, lang",
      )
    ).rows;
    // The welcome seed was cleared and saved again above, so its link is still the seed's.
    expect(seeds.filter(s => s.poster_url).length).toBeGreaterThanOrEqual(5);
    const read = await vRead(CSM_A, "onboarding");
    const meta = read.rows.find((r: Row) => r.slotKey === "meta-access");
    expect(meta.posterUrl).toBe(
      "https://cdn.loom.com/sessions/thumbnails/e2d83bffee614d9aa035d898d37d8989-b17bc3f4ce782f9b.jpg",
    );
    // The table refuses another host, even for the owner.
    let message = "";
    try {
      await db.query(
        "UPDATE public.cockpit_csm_deck_videos SET poster_url='https://evil.example/x.jpg' WHERE deck='onboarding' AND slot_key='meta-access'",
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("cockpit_csm_deck_videos_poster");
    // A new link clears its poster.
    const before = await vRead(CSM_A, "launch");
    const cal = before.rows.find((r: Row) => r.slotKey === "calendar-hours");
    await vSave(CSM_A, {
      deck: "launch",
      slot: "calendar-hours",
      lang: "any",
      url: `https://www.loom.com/share/${LOOM}`,
      revision: cal.revision,
    });
    expect(
      (await videoRow("launch", "calendar-hours", "any"))?.poster_url,
    ).toBeNull();
    const due = await svc(
      "SELECT public.cockpit_csm_deck_video_posters_due($1) r",
      [WORKER],
    );
    expect(
      due.due.some(
        (d: Row) =>
          d.slotKey === "calendar-hours" &&
          d.url === `https://www.loom.com/share/${LOOM}`,
      ),
    ).toBe(true);
    expect(due.due.every((d: Row) => d.provider !== "drive")).toBe(true);
    const SAVE_POSTER =
      "SELECT public.cockpit_csm_deck_video_poster_save($1,$2,$3,$4,$5,$6) r";
    const auditsBefore = (await videoAudits()).length;
    // An old link: nothing written.
    expect(
      await svc(SAVE_POSTER, [
        WORKER,
        "launch",
        "calendar-hours",
        "any",
        "https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768",
        "https://cdn.loom.com/x.jpg",
      ]),
    ).toEqual({ saved: false });
    // A failed check: the time only, no audit row; it is not due again for a day.
    expect(
      await svc(SAVE_POSTER, [
        WORKER,
        "launch",
        "calendar-hours",
        "any",
        `https://www.loom.com/share/${LOOM}`,
        null,
      ]),
    ).toEqual({ saved: true, posterUrl: null });
    expect((await videoAudits()).length).toBe(auditsBefore);
    expect(
      (
        await svc("SELECT public.cockpit_csm_deck_video_posters_due($1) r", [
          WORKER,
        ])
      ).due.some((d: Row) => d.slotKey === "calendar-hours"),
    ).toBe(false);
    expect(
      await svcFail(SAVE_POSTER, [
        WORKER,
        "launch",
        "calendar-hours",
        "any",
        `https://www.loom.com/share/${LOOM}`,
        "https://i.ytimg.com/vi/x/hqdefault.jpg",
      ]),
    ).toMatchObject({
      code: "22023",
      message: "That poster is not from the video's provider.",
    });
    const rev = (await videoRow("launch", "calendar-hours", "any"))?.revision;
    expect(
      await svc(SAVE_POSTER, [
        WORKER,
        "launch",
        "calendar-hours",
        "any",
        `https://www.loom.com/share/${LOOM}`,
        "https://cdn.loom.com/sessions/thumbnails/abc-def.jpg",
      ]),
    ).toEqual({
      saved: true,
      posterUrl: "https://cdn.loom.com/sessions/thumbnails/abc-def.jpg",
    });
    const row = await videoRow("launch", "calendar-hours", "any");
    expect(row?.revision).toBe(rev);
    const added = (await videoAudits()).slice(auditsBefore);
    expect(added.map(r => [r.action, r.actor_email])).toEqual([
      ["deck_video.poster", `worker:${WORKER}`],
    ]);
  });

  // The security review (2026-10-21): links built to slip past a parser.
  // The same table runs through the worker's parser (test_deck_import.py).
  test("the parser refuses look-alike hosts, userinfo, encoded ids, invisible marks and path tricks, and keeps only a clean resource key", async () => {
    const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    const ID2 = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765";
    const bad: [string, string][] = [
      [`https://drive.google.com/drive/folders/%31${ID.slice(1)}`, "link_bad"],
      [`https://drive.google.com/open?id=%31${ID.slice(1)}`, "link_bad"],
      [`https://drive.google.com/file/d/${ID}%2F..%2F/view`, "link_bad"],
      [`https://drive.google.com/drive/folders/${ID}\u200f`, "link_bad"],
      [`\u202ehttps://drive.google.com/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com/drive/folders/${ID}\u200b`, "link_bad"],
      [`https://dr\u0456ve.google.com/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com\\@evil.example/drive/folders/${ID}`, "link_bad"],
      [`https://evil.example\\.drive.google.com/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com#@evil.example/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com?/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com./drive/folders/${ID}`, "link_bad"],
      [`https://127.0.0.1/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com/drive/folders/${ID}/../../file/d/${ID2}`, "link_bad"],
      [`https:/drive.google.com/drive/folders/${ID}`, "link_bad"],
      [`https:\\\\drive.google.com/drive/folders/${ID}`, "link_bad"],
      [`//drive.google.com/drive/folders/${ID}`, "link_bad"],
      [`https://drive.google.com/drive/folders/${ID}\thttps://drive.google.com/drive/folders/${ID2}`, "link_bad"],
      [`https://forms.gle/AbCdEfGhIjKl`, "link_bad"],
      [`https://docs.google.com/forms/d/e/1FAIpQLSfAbCdEf/viewform?usp=sf_link`, "link_docs"],
    ];
    await asOwner();
    for (const [link, code] of bad) {
      const r = (await db.query<{ r: Row }>("SELECT public.cockpit_csm_drive_link_parse($1::text) r", [link])).rows[0].r;
      expect({ link, r }).toEqual({ link, r: { ok: false, code } });
    }
    const good: [string, Row][] = [
      [`https://drive.google.com/open?id=${ID}&resourcekey=0-abc%2F..`,
        { ok: true, id: ID, kind: "either", resourceKey: null, link: `https://drive.google.com/open?id=${ID}` }],
      [`https://drive.google.com/drive/folders/${ID}?resourcekey=0-ok&resourcekey=0-second`,
        { ok: true, id: ID, kind: "folder", resourceKey: "0-ok", link: `https://drive.google.com/drive/folders/${ID}?resourcekey=0-ok` }],
      [`https://DRIVE.google.com/file/d/${ID}/view?resourcekey=RK_1-x#frag`,
        { ok: true, id: ID, kind: "file", resourceKey: "RK_1-x", link: `https://drive.google.com/file/d/${ID}/view?resourcekey=RK_1-x` }],
      [`https://drive.google.com/uc?id=${ID}&id=${ID2}`,
        { ok: true, id: ID, kind: "file", resourceKey: null, link: `https://drive.google.com/file/d/${ID}/view` }],
    ];
    for (const [link, want] of good) {
      const r = (await db.query<{ r: Row }>("SELECT public.cockpit_csm_drive_link_parse($1::text) r", [link])).rows[0].r;
      expect({ link, r }).toEqual({ link, r: want });
    }
    // Through the browser's call: refused, and nothing stored.
    const before = (await importAudits()).length;
    expect(await fail(CSM_A, REQUEST, [A, `https://drive.google.com\\@evil.example/drive/folders/${ID}`])).toMatchObject({
      code: "22023",
      hint: "link_bad",
    });
    expect((await importAudits()).length).toBe(before);
  });

  test("plan: a name loses its invisible and direction marks, and a name with nothing left is the file's id, never a refused plan", async () => {
    await closeOpen();
    const imp = await request(CSM_A, A, `https://drive.google.com/drive/folders/${F(13)}`);
    await claim();
    const planned = await plan(imp.id, [
      media(50, { name: "a\u061cb\u2066c\u2069\u0085d\u200be.mp4" }),
      media(51, { name: "\u202e\u200b \u200f" }),
      media(52, { name: "folder/sub\\clip\u2028.mov" }),
    ]);
    expect(planned.files.map((f: Row) => f.name)).toEqual(["abcde.mp4", FILE_ID(51), "clip.mov"]);
    expect(await finish(imp.id)).toMatchObject({ status: "done", failed: 3 });
  });
});

// ---------------------------------------------------------------------------
// Where each tray file came from, and two tidy-ups from the Drive import's
// review (docs/csm-decks/DRIVE-IMPORT.md 12): 20261020160300 applied twice
// on top of everything above (the tray's read gains its source, a hand
// upload's name is cleaned as a Drive file's is), and the claim window of
// 20261020160000 (twenty imports at a time, not five).
// ---------------------------------------------------------------------------

const SOURCE = "20261020160300_csm_launch_ads_source.sql";
const READ_ADS = "SELECT public.cockpit_csm_launch_ads_read($1) r";
const ADDED = ["source", "importedBy", "importedAt"];

describe("the tray's source, the claim window and a hand upload's name", () => {
  beforeAll(async () => {
    await asOwner();
    // The team list, cut down to the columns the read uses (the live names,
    // checked 2026-10-21). The read is a definer, so the stand-in grants
    // nothing (live: authenticated SELECT under row security).
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.cockpit_people(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text NOT NULL CHECK (length(btrim(name)) > 0), email text, active boolean NOT NULL DEFAULT true);
      REVOKE ALL ON public.cockpit_people FROM PUBLIC, anon, authenticated;`);
    await db.exec(migration(SOURCE));
    await db.exec(migration(SOURCE));
  }, 30000);

  test("the census after it: still 45 functions; the two it replaces stay definers for signed-in seats only, the read stable", async () => {
    await census();
    const vol = (
      await db.query<{ name: string; vol: string }>(
        `SELECT p.proname name, p.provolatile vol FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
           AND p.proname IN ('cockpit_csm_launch_ads_read','cockpit_csm_launch_ad_reserve') ORDER BY 1`,
      )
    ).rows;
    expect(vol.map(v => [v.name, v.vol])).toEqual([
      ["cockpit_csm_launch_ad_reserve", "v"],
      ["cockpit_csm_launch_ads_read", "s"],
    ]);
  });

  test("read: every row and field it returned, in its order, plus the source; a Drive file adds the importer's first name and when the link was pasted, and nothing it adds names an address or the link", async () => {
    // A hand upload and a Drive file, both in Acme's tray.
    const up = await reserve(CSM_A2, uuid(9001), A, "custom", "image/png", 512, [800, 800, null, "hand.png", null, null]);
    await putObject(up.path, 512, "image/png");
    await accept(CSM_A2, A, up.id);
    await closeOpen();
    const imp = await request(CSM_A, A, `https://drive.google.com/drive/folders/${F(30)}`);
    await claim();
    await plan(imp.id, [media(70, { name: "majlis.jpg", mime: "image/jpeg" })]);
    const r = await fileReserve(imp.id, FILE_ID(70), "image/jpeg", 4096, [1080, 1350, null, null, null, null]);
    await putObject(r.path, 4096, "image/jpeg");
    await landed(imp.id, FILE_ID(70));
    await finish(imp.id);
    await asOwner();
    await db.query("UPDATE public.cockpit_csm_launch_ads_imports SET requested_at='2026-10-20T16:40:00Z' WHERE id=$1", [imp.id]);

    // What it returned before, row for row and field for field.
    const before = (await db.query<{ r: Row[] }>("SELECT public.cockpit_csm_launch_ads_rows($1, true) r", [A])).rows[0].r;
    const read: Row[] = await one(CSM_A, READ_ADS, [A]);
    const strip = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => !ADDED.includes(k)));
    expect(read.map(strip)).toEqual(before);
    expect(read.length).toBeGreaterThanOrEqual(2);
    for (const row of read) expect(["upload", "drive"]).toContain(row.source);
    const hand = read.find(x => x.id === up.id) as Row;
    expect(hand.source).toBe("upload");
    expect("importedBy" in hand || "importedAt" in hand).toBe(false);
    const drive = read.find(x => x.id === r.adId) as Row;
    expect(drive.source).toBe("drive");
    // No team-list row: the address's local part, capitalised.
    expect(drive.importedBy).toBe("Csm-A");
    expect(Date.parse(drive.importedAt)).toBe(Date.parse("2026-10-20T16:40:00Z"));
    // Nothing it adds names an address; nothing in the row is the link.
    const added = JSON.stringify(read.map(x => ADDED.map(k => x[k])));
    expect(added).not.toContain("@");
    expect(JSON.stringify(read)).not.toContain("drive.google.com");
    expect(JSON.stringify(read)).not.toContain(F(30));

    // On the team list: the first word of the active row's name for that
    // address (any case, spaces around it), never a name that is an address.
    await asOwner();
    await db.query(
      "INSERT INTO public.cockpit_people(name,email,active) VALUES('Old Name','csm-a@tests.invalid',false),('noura al-sabah',' CSM-A@tests.invalid ',true),('csm-a@tests.invalid','csm-a@tests.invalid',true)",
    );
    const named = async () => ((await one(CSM_A, READ_ADS, [A])) as Row[]).find(x => x.id === r.adId)?.importedBy;
    expect(await named()).toBe("Noura");
    await asOwner();
    await db.query("UPDATE public.cockpit_people SET name='نورة الصباح' WHERE name='noura al-sabah'");
    expect(await named()).toBe("نورة");
    await db.query("UPDATE public.cockpit_people SET name='McKenzie Ray' WHERE name='نورة الصباح'");
    expect(await named()).toBe("McKenzie");
    // A title or a lone initial is not a first name: the next word is.
    await db.query("UPDATE public.cockpit_people SET name='Eng. Khalid Saad' WHERE name='McKenzie Ray'");
    expect(await named()).toBe("Khalid");
    await db.query("UPDATE public.cockpit_people SET name='K Saad' WHERE name='Eng. Khalid Saad'");
    expect(await named()).toBe("Saad");
    await db.query("DELETE FROM public.cockpit_people");
    // The row's own createdBy (returned since 20261019120000) is unchanged:
    // on a Drive row it is the importer's address, as before.
    const own = ((await one(CSM_A, READ_ADS, [A])) as Row[]).find(x => x.id === r.adId) as Row;
    expect(own.createdBy).toBe("csm-a@tests.invalid");
    // The name comes from this client's own import only: a row pointed at
    // another client's import reads its source and no name.
    await asOwner();
    const other = (
      await db.query<{ id: string }>(
        `INSERT INTO public.cockpit_csm_launch_ads_imports(task_id,link,drive_id,kind,requested_by,requested_by_email)
         VALUES('twin2',$1,$2,'folder',$3,'csm-all@tests.invalid') RETURNING id`,
        [`https://drive.google.com/drive/folders/${F(450)}`, F(450), CSM_ALL],
      )
    ).rows[0].id;
    await db.query("UPDATE public.cockpit_csm_launch_ads SET import_id=$1 WHERE id=$2", [other, r.adId]);
    try {
      const moved = ((await one(CSM_A, READ_ADS, [A])) as Row[]).find(x => x.id === r.adId) as Row;
      expect(moved.source).toBe("drive");
      expect("importedBy" in moved || "importedAt" in moved).toBe(false);
    } finally {
      await asOwner();
      await db.query("UPDATE public.cockpit_csm_launch_ads SET import_id=$1 WHERE id=$2", [imp.id, r.adId]);
      await db.query("DELETE FROM public.cockpit_csm_launch_ads_imports WHERE id=$1", [other]);
    }

    // The deck's own read never carries where a file came from.
    const deck = await sources(CSM_A, A);
    expect(deck.launchAds.some((x: Row) => x.id === r.adId)).toBe(true);
    for (const x of deck.launchAds as Row[]) for (const k of ADDED) expect(k in x).toBe(false);
  });

  test("read: only to a seat with that client; the CEO and an all-clients seat see the source too", async () => {
    expect(await refused(CSM_B, READ_ADS, [A])).toContain("not on your access list");
    for (const who of [BUYER, SALES, GONE, UNCONFIRMED])
      expect(await refused(who, READ_ADS, [A])).toContain("client-success access is required");
    expect(await refused(null, READ_ADS, [A])).toContain("permission denied");
    await asOwner();
    await db.exec("SET ROLE service_role");
    let message = "";
    try {
      await db.query(READ_ADS, [A]);
    } catch (e) {
      message = (e as Error).message;
    } finally {
      await asOwner();
    }
    expect(message).toContain("permission denied");
    for (const who of [CEO, CSM_ALL]) {
      const read: Row[] = await one(who, READ_ADS, [A]);
      expect(read.some(x => x.source === "drive" && x.importedBy === "Csm-A")).toBe(true);
    }
  });

  test("a hand upload's name: no folders, no invisible or direction marks; a name with nothing left is the file's id, no name stays none", async () => {
    const made: string[] = [];
    const name = async (n: number, sent: string | null) => {
      const a = await reserve(CSM_A2, uuid(9100 + n), A, "custom", "video/mp4", 1000 + n, [1080, 1920, 12, sent, null, null]);
      made.push(a.id);
      return { id: a.id as string, name: (await adRow(a.id)).file_name as string | null, json: a.fileName as string | null };
    };
    expect((await name(1, "a\u061cb\u2066c\u2069\u0085d\u200be.mp4")).name).toBe("abcde.mp4");
    expect((await name(2, "folder/sub\\clip\u2028.mov")).name).toBe("clip.mov");
    expect((await name(3, "  \u200fsite walk\ufeff.mp4\u0007  ")).name).toBe("site walk.mp4");
    const empty = await name(4, "\u202e\u200b \u200f");
    expect(empty.name).toBe(empty.id);
    expect(empty.json).toBe(empty.id);
    expect((await name(5, null)).name).toBeNull();
    expect((await name(6, `${"x".repeat(250)}.mp4`)).name).toBe("x".repeat(200));
    // Printable marks stay: a dash, curly quotes and an ellipsis are a name's
    // own (the class is the plan's, written as \u escapes, never a range
    // an editor's line-terminator fix could widen).
    expect((await name(7, "site \u2013 walk \u2018a\u2019\u2026.mp4")).name).toBe("site \u2013 walk \u2018a\u2019\u2026.mp4");
    // The same request again returns the same reservation, name and all.
    const again = await reserve(CSM_A2, uuid(9101), A, "custom", "video/mp4", 1001, [1080, 1920, 12, "another name.mp4", null, null]);
    expect(again.fileName).toBe("abcde.mp4");
    for (const id of made) await one(CSM_A2, "SELECT public.cockpit_csm_launch_ad_remove($1,$2::uuid) r", [A, id]);
  });

  test("the file names its own invisible characters as escapes, the plan's class byte for byte", () => {
    const cls = (file: string) => /E'\[\[:cntrl:\][^']*'/.exec(migration(file))?.[0];
    expect(cls(SOURCE)).toBe(cls(DRIVE_FILE));
    expect(cls(SOURCE)).toContain("\\u2028-\\u202E");
    // Nothing in it is a literal invisible, bidi or line-separator character.
    expect(migration(SOURCE)).not.toMatch(/[\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
  });

  test("applied before 20261020160000 it is refused, so prep's read never breaks in production", async () => {
    await asOwner();
    await db.exec("BEGIN; ALTER TABLE public.cockpit_csm_launch_ads RENAME COLUMN import_id TO import_id_gone;");
    let message = "";
    try {
      await db.exec(migration(SOURCE));
    } catch (e) {
      message = (e as Error).message;
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(message).toContain("Apply 20261020160000_csm_launch_ads_drive.sql first");
    const cols = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM pg_attribute WHERE attrelid='public.cockpit_csm_launch_ads'::regclass AND attname='import_id' AND NOT attisdropped",
      )
    ).rows[0].n;
    expect(cols).toBe(1);
  });

  test("claim: twenty imports at a time, so six stuck behind a missing card never hold back the next client's", async () => {
    await closeOpen();
    await asOwner();
    // twin2's card goes missing from the roster; six of its imports are older than Acme's.
    for (let i = 0; i < 6; i++)
      await db.query(
        `INSERT INTO public.cockpit_csm_launch_ads_imports(task_id,link,drive_id,kind,requested_by,requested_by_email,requested_at)
         VALUES('twin2',$1,$2,'folder',$3,'csm-all@tests.invalid',now()-interval '2 minutes')`,
        [`https://drive.google.com/drive/folders/${F(400 + i)}`, F(400 + i), CSM_ALL],
      );
    await db.query(
      "UPDATE public.cockpit_csm_sources SET data = data || '{\"taskId\":\"twin2-gone\"}'::jsonb WHERE table_name='clients' AND data->>'taskId'='twin2'",
    );
    try {
      const next = await request(CSM_A, A, `https://drive.google.com/drive/folders/${F(410)}`);
      const taken = await claim();
      expect(taken.import?.id).toBe(next.id);
      await asOwner();
      const stuck = (
        await db.query<{ status: string }>("SELECT status FROM public.cockpit_csm_launch_ads_imports WHERE task_id='twin2' AND drive_id = ANY($1::text[])", [
          [0, 1, 2, 3, 4, 5].map(i => F(400 + i)),
        ])
      ).rows;
      expect(stuck.map(s => s.status)).toEqual(Array(6).fill("queued"));
      // The window is in the file itself, so the worker's claim sees twenty.
      expect(migration(DRIVE_FILE)).toMatch(/ORDER BY x\.requested_at, x\.id LIMIT 20\n/);
    } finally {
      await asOwner();
      await db.query(
        "UPDATE public.cockpit_csm_sources SET data = data || '{\"taskId\":\"twin2\"}'::jsonb WHERE table_name='clients' AND data->>'taskId'='twin2-gone'",
      );
      await closeOpen();
    }
  });
});
