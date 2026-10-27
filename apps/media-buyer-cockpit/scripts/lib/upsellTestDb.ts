/**
 * The upsell studio's database on an isolated PostgreSQL (PGlite), with
 * Supabase's default privileges on, so a missing REVOKE opens the object here
 * as it would in production (docs/upsell-studio/BACKEND.md).
 *
 * It stands on the real client gate (cockpit_csm_client_gate from 20261006c,
 * the seat rule from 20260927a, the roster tables from 20260927v), the real
 * client success seat gate and client rule (cockpit_csm_actor and
 * cockpit_client_allowed from 20260926m), the real name key (20261012c), the
 * pay plan's fixed rates (cockpit_pay_usd_per from 20261018a), the verified
 * logos table (20261003a), and the deck migrations of 19 and 20 October in
 * the order production has them. Then the upsell files u, v and w, and x
 * (the content builder's copy) when it exists.
 *
 * Campaigns, ads, daily rows, HighLevel accounts, the editor's client cards,
 * the onboarding kit, the call store, the client overrides, the renewal plans,
 * the client days and the dialer's caller rows are cut-down stand-ins with the
 * live column names (checked 2026-10-26). Storage is a stand-in schema with
 * row security on storage.objects. Every person, client and file is invented.
 *
 * Exported for the content and proposal builders' tests: they call
 * upsellTestDb() and the helpers below, and read SEATS and TASKS.
 */

import { existsSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./cockpitTestDb";

export const UPSELL_FILES = {
  u: "20261026u_upsell_catalog.sql",
  v: "20261026v_upsell_offer_decks.sql",
  w: "20261026w_upsell_proposals.sql",
  x: "20261026x_upsell_catalog_copy.sql",
} as const;
export type UpsellStage = "base" | keyof typeof UPSELL_FILES;

/** The deck files production has, in the order they were applied. */
export const DECK_FILES = [
  "20261019120000_csm_decks.sql",
  "20261020090000_csm_deck_presenter_name.sql",
  "20261020120000_csm_deck_videos.sql",
  "20261020160000_csm_launch_ads_drive.sql",
  "20261020160100_csm_deck_prep_dos_ar.sql",
  "20261020160200_csm_deck_video_posters.sql",
  "20261020160300_csm_launch_ads_source.sql",
] as const;

export const SEATS = {
  CSM_A: "00000000-0000-4000-8000-0000000000a1", // csm, Acme only
  CSM_A2: "00000000-0000-4000-8000-0000000000a2", // csm, Acme only (a second seat)
  CSM_ALL: "00000000-0000-4000-8000-0000000000a3", // csm, every client
  CSM_B: "00000000-0000-4000-8000-0000000000b1", // csm, Beta only
  BUYER: "00000000-0000-4000-8000-0000000000c1", // media buyer only
  SALES: "00000000-0000-4000-8000-0000000000c2", // sales only
  CEO: "00000000-0000-4000-8000-0000000000c3",
  GONE: "00000000-0000-4000-8000-0000000000c4", // csm, deactivated
  UNCONFIRMED: "00000000-0000-4000-8000-0000000000c5", // csm, email never confirmed
} as const;
export const EMAILS: Record<keyof typeof SEATS, string> = {
  CSM_A: "csm-a@tests.invalid",
  CSM_A2: "csm-a2@tests.invalid",
  CSM_ALL: "csm-all@tests.invalid",
  CSM_B: "csm-b@tests.invalid",
  BUYER: "buyer@tests.invalid",
  SALES: "sales@tests.invalid",
  CEO: "aziz@maharamedia.com",
  GONE: "gone@tests.invalid",
  UNCONFIRMED: "unconfirmed@tests.invalid",
};

/**
 * Three invented clients. Acme passes the offer gate as seeded (Active, 45
 * days live, Happy and confirmed on a held call 5 days ago, green, a
 * quotation 12 days ago, launch + 90 still 45 days out). Beta is a Saudi,
 * done-with-you client with no win. Cedar is stopped.
 */
export const TASKS = { A: "taskA1", B: "taskB1", C: "taskC1" } as const;
export const CLIENTS = {
  A: "Acme Interiors",
  B: "Beta Build",
  C: "Cedar Homes",
} as const;
export const LOCATIONS = { A: "locA", B: "locB", C: "locC" } as const;

/**
 * Today in Kuwait, as SQL. The upsell functions count days in Kuwait
 * (cockpit_upsell_today, 20261026u) and the database clock is UTC, so every
 * fixture date starts from this, never from current_date: between 21:00 and
 * 24:00 UTC the two differ by a day.
 */
export const KW_TODAY = "(now() AT TIME ZONE 'Asia/Kuwait')::date";

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

/** Whether a stage's migration file is in the worktree (x is the content builder's). */
export function upsellFileExists(stage: keyof typeof UPSELL_FILES): boolean {
  return existsSync(
    new URL(
      `../../../../supabase/migrations/${UPSELL_FILES[stage]}`,
      import.meta.url,
    ),
  );
}

/** The roster row of one client, as the native sync writes it, with dates from today. */
export async function setClient(
  db: PGlite,
  key: keyof typeof TASKS,
  patch: Record<string, unknown> = {},
  launchDaysAgo: number | null = null,
) {
  await db.exec("RESET ROLE");
  await db.query(
    `UPDATE public.cockpit_csm_sources SET data = (data || $2::jsonb)
       || CASE WHEN $3::int IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('launchDate', to_char(${KW_TODAY} - $3::int, 'YYYY-MM-DD'), 'liveDays', $3::int) END
      WHERE table_name = 'clients' AND data->>'taskId' = $1`,
    [TASKS[key], JSON.stringify(patch), launchDaysAgo],
  );
}

/**
 * The database through a stage: "base" is the deck backend alone; "u", "v",
 * "w" and "x" add the upsell files in order. Each upsell file is applied twice
 * (unless twice is false), as production may see it.
 */
export async function upsellTestDb(
  opts: { through?: UpsellStage; twice?: boolean } = {},
): Promise<PGlite> {
  const through = opts.through ?? (upsellFileExists("x") ? "x" : "w");
  const twice = opts.twice ?? true;
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  try {
    // Storage as Supabase has it, cut down: buckets, and objects under RLS.
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb,
        UNIQUE(bucket_id, name));
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO service_role;
      CREATE POLICY other_bucket_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'team-docs');`);

    // The roster and the client gate, from their canonical migrations.
    const roster = migration("20260927v_csm_read_models.sql");
    await db.exec(
      cut(
        roster,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
        "cockpit_csm_source_state",
      ),
    );
    await db.exec(
      cut(
        roster,
        /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
        "cockpit_csm_source_state rows",
      ),
    );
    await db.exec(
      cut(
        roster,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
        "cockpit_csm_sources",
      ),
    );
    await db.exec(
      "REVOKE ALL ON public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;",
    );
    await db.exec(
      cut(
        migration("20260927a_cockpit_ask_ai_jobs.sql"),
        /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
        "cockpit_ask_ai_owner_allowed",
      ),
    );
    const gate = migration("20261006c_csm_onboarding_checkins.sql");
    await db.exec(
      cut(
        gate,
        /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
        "gate for actor",
      ),
    );
    await db.exec(
      cut(
        gate,
        /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
        "gate",
      ),
    );
    await db.exec(
      cut(
        gate,
        /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
        "gate grants",
      ),
    );
    const ads = migration("20261012c_csm_client_ads.sql");
    await db.exec(
      cut(
        ads,
        /CREATE OR REPLACE FUNCTION public\.cockpit_csm_name_key\([\s\S]*?\$\$;/,
        "name key",
      ),
    );
    await db.exec(
      cut(
        ads,
        /REVOKE ALL ON FUNCTION public\.cockpit_csm_name_key\(text\)[^\n]*\n/,
        "name key grants",
      ),
    );
    const state = migration("20260926m_cockpit_csm_state.sql");
    await db.exec(
      cut(
        state,
        /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
        "client allowed",
      ),
    );
    await db.exec(
      cut(
        state,
        /CREATE OR REPLACE FUNCTION public\.cockpit_csm_actor\(\)[\s\S]*?END \$\$;/,
        "csm actor",
      ),
    );
    await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_client_allowed(text), public.cockpit_csm_actor() FROM PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;`);
    await db.exec(
      cut(
        migration("20261018a_ceo_pay_plans.sql"),
        /CREATE OR REPLACE FUNCTION public\.cockpit_pay_usd_per\(p_currency text\)[\s\S]*?\$\$;/,
        "usd per",
      ),
    );

    // The read models the deck files read, from their canonical migrations.
    const media = migration("20260927w_media_read_models.sql");
    await db.exec(
      cut(
        media,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_media_source_state\([\s\S]*?\n\);/,
        "media state",
      ),
    );
    await db.exec(
      cut(
        media,
        /INSERT INTO public\.cockpit_media_source_state[^\n]*\n/,
        "media state rows",
      ),
    );
    await db.exec(
      cut(
        media,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_media_sources\([\s\S]*?\n\);/,
        "media sources",
      ),
    );
    const creative = migration("20260927s_creative_read_models.sql");
    await db.exec(
      cut(
        creative,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_creative_source_state\([\s\S]*?\n\);/,
        "creative state",
      ),
    );
    await db.exec(
      cut(
        creative,
        /INSERT INTO public\.cockpit_creative_source_state[^\n]*\n/,
        "creative state rows",
      ),
    );
    await db.exec(
      cut(
        creative,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_creative_sources\([\s\S]*?\n\);/,
        "creative sources",
      ),
    );
    await db.exec(
      cut(
        migration("20260927x_cockpit_native_media_sync.sql"),
        /CREATE TABLE IF NOT EXISTS public\.cockpit_native_stills \([\s\S]*?\n\);/,
        "native stills",
      ),
    );
    await db.exec(
      cut(
        migration("20261003a_client_logos.sql"),
        /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/,
        "client logos",
      ),
    );
    await db.exec(
      "REVOKE ALL ON public.cockpit_client_logos FROM PUBLIC, anon, authenticated;",
    );

    // Stand-ins with the live column names (checked 2026-10-26).
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
        starts_at timestamptz, ends_at timestamptz, status text NOT NULL, join_url text, summary text);
      CREATE TABLE public.cockpit_csm_client_overrides(task_id text PRIMARY KEY, client_name text NOT NULL, data jsonb NOT NULL,
        action_id uuid, confirmed_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.cockpit_csm_renewal_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id text NOT NULL,
        client_name text NOT NULL, renewal_date date NOT NULL, data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
        source_id text UNIQUE, UNIQUE(task_id, renewal_date));
      CREATE TABLE public.cockpit_client_days(location_id text NOT NULL, day date NOT NULL, crm_leads integer, confirmed_bookings integer,
        shows integer, quotations integer, closes integer, closes_with_value integer, revenue_usd numeric(14,2),
        computed_at timestamptz NOT NULL DEFAULT now(), sources jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(location_id, day));
      CREATE TABLE public.cockpit_people(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text NOT NULL CHECK (length(btrim(name)) > 0), email text, active boolean NOT NULL DEFAULT true);
      CREATE TABLE public.caller_fixture(location_id text, email text, name text);
      CREATE FUNCTION public.cockpit_client_caller_rows() RETURNS TABLE(location_id text, email text, name text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT location_id, email, name FROM public.caller_fixture $$;
      REVOKE ALL ON FUNCTION public.cockpit_client_caller_rows() FROM PUBLIC, anon, authenticated;
      REVOKE ALL ON public.cockpit_campaigns, public.cockpit_ads, public.cockpit_media_daily_stats, public.ghl_clients,
        public.editor_clients, public.cockpit_client_onboarding, public.cockpit_csm_calls, public.cockpit_csm_client_overrides,
        public.cockpit_csm_renewal_plans, public.cockpit_client_days, public.cockpit_people, public.caller_fixture
        FROM PUBLIC, anon, authenticated;`);

    await member(db, SEATS.CSM_A, EMAILS.CSM_A, ["csm"]);
    await member(db, SEATS.CSM_A2, EMAILS.CSM_A2, ["csm"]);
    await member(db, SEATS.CSM_ALL, EMAILS.CSM_ALL, ["csm"]);
    await member(db, SEATS.CSM_B, EMAILS.CSM_B, ["csm"]);
    await member(db, SEATS.BUYER, EMAILS.BUYER, ["media_buyer"]);
    await member(db, SEATS.SALES, EMAILS.SALES, ["sales"]);
    await member(db, SEATS.CEO, EMAILS.CEO, []);
    await member(db, SEATS.GONE, EMAILS.GONE, ["csm"], false);
    await member(
      db,
      SEATS.UNCONFIRMED,
      EMAILS.UNCONFIRMED,
      ["csm"],
      true,
      false,
    );
    await db.query(
      "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id = ANY($2::uuid[])",
      [[CLIENTS.A], [SEATS.CSM_A, SEATS.CSM_A2]],
    );
    await db.query(
      "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
      [[CLIENTS.B], SEATS.CSM_B],
    );
    await db.query(
      "UPDATE public.cockpit_members SET name='Noura Al-Sabah' WHERE auth_user_id=$1",
      [SEATS.CSM_A],
    );
    await db.query(
      "INSERT INTO public.cockpit_people(name,email) VALUES('Aziz Waheedi',$1)",
      [EMAILS.CEO],
    );

    // The roster: three clients, one snapshot, synced yesterday.
    await db.exec(`
      INSERT INTO public.cockpit_csm_sources(table_name, source_id, client_names, data, source_snapshot_at)
      SELECT 'clients', 'c-' || x.task, ARRAY[x.name], jsonb_build_object(
          '_id', 'c-' || x.task, 'taskId', x.task, 'name', x.name, 'service', x.service, 'stage', x.stage,
          'launchDate', to_char(${KW_TODAY} - x.live, 'YYYY-MM-DD'), 'liveDays', x.live,
          'happiness', x.happy, 'level', x.level, 'pauseRequired', false, 'bucket', 'management',
          'syncedAt', (extract(epoch FROM now() - interval '1 day') * 1000)::bigint),
        '2026-10-26T06:00:00Z'
      FROM (VALUES ('taskA1','Acme Interiors','DFY','Active',45,'Happy','green'),
                   ('taskB1','Beta Build','DWY','Active',200,'Very Happy (testimonial)','green'),
                   ('taskC1','Cedar Homes','DFY','Stopped',120,'Neutral','amber')) x(task, name, service, stage, live, happy, level);
      UPDATE public.cockpit_csm_source_state SET ready=true, row_count=3, source_snapshot_at='2026-10-26T06:00:00Z' WHERE table_name='clients';
      INSERT INTO public.ghl_clients(location_id, client_name, clickup_id, country, city, language, service_mode, has_token, panel_token) VALUES
        ('locA','Acme Interiors','taskA1','KW','Kuwait City','en','DFY',true,'SECRET-PANEL-A'),
        ('locB','Beta Build','taskB1','SA','Riyadh','ar','DWY',true,'SECRET-PANEL-B'),
        ('locC','Cedar Homes','taskC1','BH','Manama','en','DFY',true,'SECRET-PANEL-C');
      INSERT INTO public.editor_clients(task_id, name, website, synced_at) VALUES
        ('taskA1','Acme Interiors','https://acme-interiors.example','2026-10-25T00:00:00Z'),
        ('taskB1','Beta Build',NULL,'2026-10-25T00:00:00Z');
      INSERT INTO public.cockpit_csm_calls(task_id, kind, starts_at, status, summary) VALUES
        ('taskA1','checkin', now() - interval '5 days','held','They liked the new kitchen ads. Next step: more villa shots.'),
        ('taskB1','checkin', now() - interval '40 days','held','Quiet call. All good.');
      INSERT INTO public.cockpit_client_days(location_id, day, quotations, closes, closes_with_value, revenue_usd) VALUES
        ('locA', ${KW_TODAY} - 12, 1, 0, 0, NULL),
        ('locA', ${KW_TODAY} - 90, 0, 0, 0, NULL),
        ('locB', ${KW_TODAY} - 60, 0, 0, 0, NULL);`);
    await db.query(
      `INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, launch_on, links, forms, synced_at)
      VALUES('taskA1','Acme Interiors', ${KW_TODAY} - 45, $1::jsonb, $2::jsonb, now())`,
      [
        JSON.stringify({
          website: "https://acme-interiors.example/",
          contract: "https://contracts.example/secret",
        }),
        JSON.stringify({
          onboarding: {
            submitted_at: "2026-09-03T09:00:00Z",
            answers: [
              {
                ref: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
                title: "What is your realistic goal revenue in 90 Days?",
                value: "Three villa projects signed",
              },
              {
                ref: "f4b96a9b-bd7c-4398-98b4-6a28a7d3595a",
                title:
                  "What is your ideal/stretch revenue goal within the next 12-24 months?",
                value: "Open a Riyadh branch",
              },
              {
                ref: "fcf43e6a-cc84-4ae7-9cef-2336069d0280",
                title: "What are the TOP 3 challenges",
                value: "Clients find us on Instagram only",
              },
              {
                ref: "7426c6c5-344f-44c9-9999-3b9daf3a06b8",
                title: "What motivated you to join our program?",
                value: "We want steady projects",
              },
              {
                ref: "d976036f-6c2e-4d5d-999a-64cf9bb2ef02",
                title: "1) What services do you offer",
                value: "Villa fit out, typical project 18,000 KWD",
              },
              {
                ref: "64f2fb80-b074-4017-b8b7-b7d549947e52",
                title: "Phone",
                value: "+96500000000",
              },
            ],
          },
        }),
      ],
    );
    await db.query(
      `INSERT INTO public.cockpit_client_logos(client_key, clickup_task_id, storage_path, source_url, verified_at, updated_by)
      VALUES('acme interiors',$1,'verified/taskA1/0123456789abcdef.png','https://acme-interiors.example','2026-10-03T00:00:00Z','fixture')`,
      [TASKS.A],
    );

    for (const file of DECK_FILES) await db.exec(migration(file));
    const files: (keyof typeof UPSELL_FILES)[] = ["u", "v", "w", "x"];
    for (const stage of files.slice(
      0,
      through === "base" ? 0 : files.indexOf(through) + 1,
    )) {
      if (stage === "x" && !upsellFileExists("x")) break;
      await db.exec(migration(UPSELL_FILES[stage]));
      if (twice) await db.exec(migration(UPSELL_FILES[stage]));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export type Row = Record<string, any>;
export type Failure = { code: string; message: string; detail?: string };

/** Calls as a seat (null = signed out), as the service key, and as the owner. */
export function upsellHelpers(db: PGlite) {
  const asOwner = async () => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await db.query("SELECT set_config('request.jwt.claims','',false)");
  };
  const rows = async <T = Row>(
    who: string | null,
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    await actor(db, who);
    try {
      return (await db.query<T>(text, params)).rows;
    } finally {
      await asOwner();
    }
  };
  /** The first row's `r` column. */
  const one = async <T = any>(
    who: string | null,
    text: string,
    params: unknown[] = [],
  ): Promise<T> => (await rows<{ r: T }>(who, text, params))[0].r;
  const failure = async (
    who: string | null | "service",
    text: string,
    params: unknown[] = [],
  ): Promise<Failure> => {
    if (who === "service") {
      await asOwner();
      await db.exec("SET ROLE service_role");
    } else await actor(db, who);
    try {
      await db.query(text, params);
    } catch (e) {
      const err = e as { code?: string; message: string; detail?: string };
      return {
        code: err.code ?? "",
        message: err.message,
        ...(err.detail ? { detail: err.detail } : {}),
      };
    } finally {
      await asOwner();
    }
    throw new Error(`Expected a refusal for ${text}`);
  };
  const svc = async <T = any>(
    text: string,
    params: unknown[] = [],
  ): Promise<T> => {
    await asOwner();
    await db.exec("SET ROLE service_role");
    try {
      return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
    } finally {
      await asOwner();
    }
  };
  const owner = async <T = Row>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    await asOwner();
    return (await db.query<T>(text, params)).rows;
  };
  const audits = async (entityType: string): Promise<Row[]> =>
    owner(
      "SELECT * FROM public.cockpit_audit_log WHERE entity_type=$1 ORDER BY created_at, id",
      [entityType],
    );
  const putObject = async (
    bucket: string,
    name: string,
    size: number,
    mimetype: string,
  ) => {
    await asOwner();
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,metadata) VALUES($1,$2,$3::jsonb) ON CONFLICT (bucket_id, name) DO NOTHING",
      [bucket, name, JSON.stringify({ size, mimetype })],
    );
  };
  /** A ready capture of a client, through reserve, the object and accept, as a seat. */
  const capture = async (
    who: string,
    task: string,
    request: string,
    capturedDaysAgo = 1,
    mime = "image/png",
    bytes = 2048,
  ) => {
    const r = await one<Row>(
      who,
      `SELECT public.cockpit_upsell_file_reserve($1::uuid,$2,'capture',$3,$4,1280,720,'their-site.png',${KW_TODAY} - $5::int,'Kuwait City') r`,
      [request, task, mime, bytes, capturedDaysAgo],
    );
    await putObject("cockpit-upsell-files", r.path, bytes, mime);
    return one<Row>(
      who,
      "SELECT public.cockpit_upsell_file_accept($1,$2::uuid) r",
      [task, r.id],
    );
  };
  return {
    asOwner,
    rows,
    one,
    failure,
    svc,
    owner,
    audits,
    putObject,
    capture,
  };
}

export const uuid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
