/**
 * CSM decks backend (20261019120000_csm_decks.sql, docs/csm-decks/CONTENT.md
 * data map, DESIGN.md 10 and 12.3) on an isolated PostgreSQL with Supabase's
 * default privileges on, so a missing REVOKE opens the object here as it
 * would in production.
 *
 * It stands on the real client gate (cockpit_csm_client_gate from 20261006c,
 * the seat rule from 20260927a, the roster tables from 20260927v), the real
 * name key (20261012c) and the canonical read-model tables (20260927s/w/x).
 * Campaigns, ads, daily rows, HighLevel accounts, the editor's client cards,
 * the onboarding kit, the call store and the dialer's caller rows are cut-down
 * stand-ins with the live column names. Storage is a stand-in schema with RLS
 * on storage.objects. Every person, client, ad and form is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261019120000_csm_decks.sql";

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

  // Applied twice: the second run must change nothing and raise nothing.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
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
    ];
    expect(fns.length).toBe(21);
    for (const fn of fns) {
      const name = fn.sig.split("(")[0].replace(/^public\./, "");
      expect(fn.config).toContain('search_path=""');
      if (!["cockpit_csm_deck_text", "cockpit_csm_deck_choice"].includes(name)) expect(fn.definer).toBe(true);
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
