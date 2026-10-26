/**
 * Slack notices (20261025n_slack_notices.sql, docs/forms/STAGE1-CONTRACT.md
 * 2.1 and 9) on an isolated PostgreSQL with Supabase's default privileges on,
 * so a missing REVOKE opens the object here as it would in production.
 *
 * It stands on the real gates: the CEO gate and cockpit_has_role
 * (20260923m), the CSM client gate (20261006c with the roster of 20260927v
 * and the seat rule of 20260927a) and cockpit_client_allowed (20261017b).
 * The tables it reads are cut from their canonical migrations: the sync
 * state (20260921e), the people list (20260919b), the Slack ids
 * (20261015210000), the onboarding mirror (20261005a), the creative outbox
 * (20260927s), the form sends (20261023a) and the calls (20261011c). Every
 * person, client, response and Slack id is invented. PGlite has no pg_cron,
 * vault or pg_net, so the guarded blocks skip and the kick only writes its note.
 * Nothing here reaches Slack: a post is a row and an audit row.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261025n_slack_notices.sql";

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // csm, Acme only
const CSM_B = "00000000-0000-4000-8000-0000000000b1"; // csm, Beta only
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative, every client
const CREATIVE_B = "00000000-0000-4000-8000-0000000000e2"; // creative, Beta only, no people row
const BUYER = "00000000-0000-4000-8000-0000000000f1"; // media buyer
const EDITOR_ROW = "00000000-0000-4000-8000-0000000000f2"; // media buyer, given the right by a row
const EDITOR_ROLE = "00000000-0000-4000-8000-0000000000f3"; // forms_editor role only, no people row
const GONE = "00000000-0000-4000-8000-0000000000f4"; // csm, deactivated

const A = "taskA1"; // Acme Interiors
const B = "taskB1"; // Beta Build
const C = "taskC1"; // Gamma Design
const K = "taskK1"; // Kappa Homes
const FRESH = "taskF1"; // a kickoff newer than 48 hours before the migration

const CSM_GENERAL = "C09RZ0GS0V9";
const MEDIA_GENERAL = "C0AE8G5MT7Y";

let db: PGlite;
type Row = Record<string, any>;
const people: Record<string, number> = {};

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await asOwner();
  return (await db.query<T>(text, params)).rows;
}
async function one<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function refused(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<string> {
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
async function svc<T = any>(text: string, params: unknown[] = []): Promise<T> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function svcRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function ownerRefused(
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await asOwner();
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Expected a refusal for ${text}`);
}
async function count(text: string, params: unknown[] = []): Promise<number> {
  return Number((await q<{ n: number }>(text, params))[0].n);
}

const claim = (only: string | null = null, limit = 10) =>
  svc<Row>("SELECT public.cockpit_slack_notice_claim($1,$2) r", [limit, only]);
const result = (
  id: string,
  outcome: string,
  ts: string | null = null,
  channel: string | null = null,
  error: string | null = null,
  detail: Row = {},
) =>
  svc<Row>(
    "SELECT public.cockpit_slack_notice_result($1,$2,$3,$4,$5,$6::jsonb) r",
    [id, outcome, ts, channel, error, JSON.stringify(detail)],
  );
const resultRefused = (
  id: string,
  outcome: string,
  ts: string | null = null,
  channel: string | null = null,
  error: string | null = null,
  detail: Row = {},
) =>
  svcRefused(
    "SELECT public.cockpit_slack_notice_result($1,$2,$3,$4,$5,$6::jsonb)",
    [id, outcome, ts, channel, error, JSON.stringify(detail)],
  );
const sweep = () => svc<Row>("SELECT public.cockpit_slack_notice_sweep() r");
async function notice(key: string): Promise<Row> {
  const rows = await q(
    "SELECT * FROM public.cockpit_slack_notices WHERE dedupe_key=$1",
    [key],
  );
  if (!rows[0]) throw new Error(`No notice ${key}`);
  return rows[0];
}
const maybeNotice = async (key: string) =>
  (
    await q("SELECT * FROM public.cockpit_slack_notices WHERE dedupe_key=$1", [
      key,
    ])
  )[0] ?? null;
const notices = () =>
  count("SELECT count(*) n FROM public.cockpit_slack_notices");
const audits = (entity: string) =>
  q(
    "SELECT * FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY created_at",
    [entity],
  );
const setKickoff = (
  task: string,
  rid: string,
  submitted: string | null,
  extra: Row = {},
) =>
  q(
    `UPDATE public.cockpit_client_onboarding
        SET forms = jsonb_set(forms, '{kickoff}', $2::jsonb, true), synced_at = now() WHERE clickup_task_id=$1`,
    [
      task,
      JSON.stringify({
        form_id: "tG7dnxBn",
        response_id: rid,
        ...(submitted === null ? {} : { submitted_at: submitted }),
        answers: [],
        ...extra,
      }),
    ],
  );
const onboard = (
  task: string,
  name: string,
  forms: Row = {},
  status = "Onboarding Booked",
) =>
  q(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id, client_name, client_status, links, forms, card_updated_at)
     VALUES($1,$2,$3,'{"blueprint_form":"https://form.typeform.com/to/old"}'::jsonb,$4::jsonb, now() - interval '30 days')`,
    [task, name, status, JSON.stringify(forms)],
  );
const kickoffForm = (rid: string, submitted: string | null) => ({
  kickoff: {
    form_id: "BbJy6xg4",
    response_id: rid,
    ...(submitted === null ? {} : { submitted_at: submitted }),
    answers: [],
  },
});
async function outbox(
  kind: string,
  task: string | null,
  client: string,
  opts: {
    state?: string;
    payload?: Row;
    result?: Row | null;
    settled?: boolean;
  } = {},
): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO public.cockpit_creative_outbox(client_name, kind, task_id, payload, actor_id, actor_email, state, result, settled_at)
     VALUES($1,$2,$3,$4::jsonb,$5,'creative@tests.invalid',$6,$7::jsonb, CASE WHEN $8 THEN now() END) RETURNING id`,
    [
      client,
      kind,
      task,
      JSON.stringify(opts.payload ?? {}),
      CREATIVE,
      opts.state ?? "pending",
      opts.result ? JSON.stringify(opts.result) : null,
      opts.settled ?? false,
    ],
  );
  return rows[0].id;
}
// As cockpit-creative-api settles a press: only a run that finished writes
// its result; a reconcile (and a stuck send settled by hand) writes none.
const move = (id: string, state: string, res: Row | null = null) =>
  q(
    `UPDATE public.cockpit_creative_outbox SET state=$2,
       result = CASE WHEN $2 = 'done' THEN coalesce($3::jsonb, result) ELSE result END,
       settled_at = CASE WHEN $2 IN ('done','reconcile','failed') THEN now() ELSE settled_at END WHERE id=$1`,
    [id, state, res ? JSON.stringify(res) : null],
  );
async function press(
  kind: string,
  task: string,
  client: string,
  end: string[],
  payload: Row = {},
  res: Row | null = null,
) {
  const id = await outbox(kind, task, client, { payload });
  await move(id, "sending");
  for (const state of end) await move(id, state, res);
  return id;
}
const settingsSet = (who: string, kind: string, patch: unknown) =>
  one<Row>(
    who,
    "SELECT public.cockpit_slack_notice_settings_set($1,$2::jsonb) r",
    [kind, JSON.stringify(patch)],
  );
const settingsRefused = (who: string, kind: string, patch: unknown) =>
  refused(
    who,
    "SELECT public.cockpit_slack_notice_settings_set($1,$2::jsonb)",
    [kind, JSON.stringify(patch)],
  );
const settingsRead = (who: string) =>
  one<Row>(who, "SELECT public.cockpit_slack_notice_settings_read() r");
const memberId = async (uid: string) =>
  (
    await q<{ id: string }>(
      "SELECT id FROM public.cockpit_members WHERE auth_user_id=$1",
      [uid],
    )
  )[0].id;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The sync state, the people list and their Slack ids.
  await db.exec(
    cut(
      migration("20260921e_tap_charges.sql"),
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "cockpit_sync_state",
    ),
  );
  await db.exec(
    cut(
      migration("20260919b_people.sql"),
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "cockpit_people",
    ),
  );
  await db.exec(
    cut(
      migration("20261015210000_eod_radar.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_eod_radar_slack_ids \([\s\S]*?\n\);/,
      "cockpit_eod_radar_slack_ids",
    ),
  );
  // The onboarding mirror, the creative outbox, the form sends and the calls.
  await db.exec(
    cut(
      migration("20261005a_client_onboarding.sql"),
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "cockpit_client_onboarding",
    ),
  );
  await db.exec(
    cut(
      migration("20260927s_creative_read_models.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_creative_outbox\([^\n]*\n/,
      "cockpit_creative_outbox",
    ),
  );
  await db.exec(
    cut(
      migration("20261023a_csm_form_sends.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_form_sends \([\s\S]*?\n\);/,
      "cockpit_csm_form_sends",
    ),
  );
  await db.exec(
    cut(
      migration("20261011c_csm_call_store.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_calls\([\s\S]*?\n\);/,
      "cockpit_csm_calls",
    ),
  );
  // The press journal and the Blueprint record: a close that settled without
  // a result takes its facts from them.
  await db.exec(
    cut(
      migration("20260927g_cockpit_media_actions.sql"),
      /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/,
      "cockpit_media_actions",
    ),
  );
  await db.exec(
    cut(
      migration("20261024a_brand_blueprints.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_blueprints \([\s\S]*?\n\);/,
      "cockpit_blueprints",
    ),
  );

  // The roster and the client gates, from their canonical migrations.
  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "cockpit_csm_source_state",
    ],
    [
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "cockpit_csm_source_state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "cockpit_csm_sources",
    ],
  ] as const)
    await db.exec(cut(roster, pattern, what));
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
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "cockpit_is_team_only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "cockpit_client_allowed",
    ),
  );
  await db.exec(`
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_creative_outbox, public.cockpit_csm_form_sends,
      public.cockpit_csm_calls, public.cockpit_csm_source_state, public.cockpit_csm_sources,
      public.cockpit_media_actions, public.cockpit_blueprints FROM anon, authenticated;`);

  // Seats.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "sm@tests.invalid", ["admin"]);
  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await member(db, CREATIVE_B, "creative-b@tests.invalid", ["creative"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, EDITOR_ROW, "mb-editor@tests.invalid", ["media_buyer"]);
  await member(db, EDITOR_ROLE, "editor-role@tests.invalid", ["forms_editor"]);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  for (const [uid, clients] of [
    [CSM_A, ["Acme Interiors"]],
    [CSM_B, ["Beta Build"]],
    [CREATIVE_B, ["Beta Build"]],
    [EDITOR_ROW, ["Acme Interiors"]],
  ] as const)
    await db.query(
      "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
      [clients, uid],
    );
  await db.query(
    "UPDATE public.cockpit_members SET name='Mona Editor' WHERE auth_user_id=$1",
    [EDITOR_ROW],
  );

  // People and their Slack ids.
  for (const [key, name, email, role, active, slack] of [
    [
      "noura",
      "Noura Al-Sabah",
      "csm-a@tests.invalid",
      "Client success manager",
      true,
      "U0CSMAAAA1",
    ],
    [
      "sara",
      "Sara Q",
      "csm-b@tests.invalid",
      "Client success manager",
      true,
      null,
    ],
    [
      "omar",
      "Omar K",
      "creative@tests.invalid",
      "Creative strategist",
      true,
      "U0CREATIV1",
    ],
    [
      "huda",
      "Huda M",
      "sm@tests.invalid",
      "Systems manager",
      true,
      "U0SYSMANA1",
    ],
    ["aziz", "Aziz W", "aziz@maharamedia.com", "CEO", true, null],
    [
      "bilal",
      "Bilal R",
      "buyer@tests.invalid",
      "Media buyer",
      true,
      "U0BUYERAA1",
    ],
    [
      "left",
      "Old Hand",
      "left@tests.invalid",
      "Media buyer",
      false,
      "U0LEFTAAA1",
    ],
    ["noemail", "No Address", null, "Closer", true, null],
  ] as const) {
    const id = (
      await db.query<{ id: number }>(
        "INSERT INTO public.cockpit_people(name,email,role,active,added_by) VALUES($1,$2,$3,$4,'test') RETURNING id",
        [name, email, role, active],
      )
    ).rows[0].id;
    people[key] = Number(id);
    if (slack)
      await db.query(
        "INSERT INTO public.cockpit_eod_radar_slack_ids(person_id,slack_user_id,source,state) VALUES($1,$2,'manual','ok')",
        [id, slack],
      );
  }

  // The client roster the CSM gate reads.
  const snap = "2026-10-24T08:00:00Z";
  const roster_ = [
    [A, "Acme Interiors"],
    [B, "Beta Build"],
    [C, "Gamma Design"],
    [K, "Kappa Homes"],
  ];
  for (const [taskId, name] of roster_)
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [roster_.length, snap],
  );

  // The mirror as the migration finds it: two old kickoffs, one newer than
  // 48 hours (left to the sweep), two cards with no kickoff yet.
  await onboard(
    "taskold1",
    "Old One",
    kickoffForm("kickold00001", "2026-09-01T10:00:00Z"),
  );
  await onboard("taskold2", "Old Two", kickoffForm("kickold00002", null));
  await onboard(FRESH, "Fresh Client", kickoffForm("kickfresh001", ago(60)));
  await onboard(A, "Acme Interiors");
  await onboard(B, "Beta Build");

  // Applied twice: the second run must change nothing and raise nothing.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("the migration", () => {
  const TABLES = [
    "cockpit_slack_channels",
    "cockpit_slack_notice_settings",
    "cockpit_forms_editors",
    "cockpit_slack_notices",
    "cockpit_slack_people",
  ];
  test("browser roles cannot touch the five tables; the service role only reads them; row security is on", async () => {
    for (const table of TABLES) {
      for (const role of ["anon", "authenticated"])
        for (const privilege of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
        ])
          expect(
            (
              await q<{ ok: boolean }>(
                "SELECT has_table_privilege($1,$2,$3) ok",
                [role, `public.${table}`, privilege],
              )
            )[0].ok,
          ).toBe(false);
      expect(
        (
          await q<{ ok: boolean }>(
            "SELECT has_table_privilege('service_role',$1,'SELECT') ok",
            [`public.${table}`],
          )
        )[0].ok,
      ).toBe(true);
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
        expect(
          (
            await q<{ ok: boolean }>(
              "SELECT has_table_privilege('service_role',$1,$2) ok",
              [`public.${table}`, privilege],
            )
          )[0].ok,
        ).toBe(false);
      expect(
        (
          await q<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${table}`],
          )
        )[0].rls,
      ).toBe(true);
    }
    expect(
      await refused(CSM_A, "SELECT * FROM public.cockpit_slack_notices"),
    ).toContain("permission denied");
    expect(
      await svcRefused("UPDATE public.cockpit_slack_notices SET error='x'"),
    ).toContain("permission denied");
  });

  test("each function has exactly its grant, and every one is a definer with an empty search path", async () => {
    const can = async (role: string, sig: string) =>
      (
        await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, sig],
        )
      )[0].ok;
    const service = [
      "cockpit_slack_notice_sweep()",
      "cockpit_slack_notice_claim(integer,uuid)",
      "cockpit_slack_notice_result(uuid,text,text,text,text,jsonb)",
      "cockpit_slack_notice_unknowns(integer)",
      "cockpit_slack_channel_pending()",
      "cockpit_slack_channel_checked(text,boolean,text,boolean,text)",
      "cockpit_slack_notice_inputs(jsonb)",
      "cockpit_slack_notice_doctor_inputs()",
      "cockpit_slack_notice_rehearse_service(text,text)",
      "cockpit_slack_notice_fix(uuid,text,text)",
      "cockpit_slack_person_pending()",
      "cockpit_slack_person_checked(bigint,text,text,text)",
    ];
    const browser = [
      "cockpit_slack_notice_read(text)",
      "cockpit_slack_notice_settings_read()",
      "cockpit_slack_notice_settings_set(text,jsonb)",
      "cockpit_slack_channel_add(text,text)",
      "cockpit_slack_channel_remove(text)",
      "cockpit_slack_notice_rehearse(text)",
      "cockpit_forms_editor_set(uuid,boolean)",
    ];
    const internal = [
      "cockpit_slack_notice_ts(text)",
      "cockpit_slack_notice_card_done(text,timestamptz,timestamptz)",
      "cockpit_slack_notice_shape(text)",
      "cockpit_slack_notice_role_of(text)",
      "cockpit_slack_notice_mentions(text[],bigint[],text)",
      "cockpit_slack_notice_queue(text,text,text,text,jsonb,uuid,text,text)",
      "cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)",
      "cockpit_slack_notice_close_found(public.cockpit_creative_outbox)",
      "cockpit_slack_notice_launch_task(public.cockpit_creative_outbox)",
      "cockpit_slack_notice_close_facts(public.cockpit_creative_outbox)",
      "cockpit_slack_notice_offer_facts(public.cockpit_creative_outbox)",
      "cockpit_slack_notice_live(public.cockpit_slack_notices)",
      "cockpit_slack_notice_view(public.cockpit_slack_notices)",
      "cockpit_slack_notice_from_onboarding()",
      "cockpit_slack_notice_from_outbox()",
      "cockpit_slack_notice_guard()",
      "cockpit_slack_notice_refuse_delete()",
      "cockpit_slack_notice_audit()",
      "cockpit_forms_editor_gate()",
      "cockpit_slack_notice_viewer()",
      "cockpit_slack_notices_kick()",
      "cockpit_slack_person_id(bigint)",
      "cockpit_slack_person_state(bigint)",
      "cockpit_slack_person_label(text)",
      "cockpit_slack_people_queue(bigint[],text)",
      "cockpit_forms_editor_seat_off()",
    ];
    for (const fn of service) {
      expect(await can("service_role", `public.${fn}`)).toBe(true);
      expect(await can("authenticated", `public.${fn}`)).toBe(false);
      expect(await can("anon", `public.${fn}`)).toBe(false);
    }
    for (const fn of browser) {
      expect(await can("authenticated", `public.${fn}`)).toBe(true);
      expect(await can("service_role", `public.${fn}`)).toBe(false);
      expect(await can("anon", `public.${fn}`)).toBe(false);
    }
    for (const fn of internal)
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, `public.${fn}`)).toBe(false);
    // Every function this file made, including its small helpers.
    const fns = await q<{
      name: string;
      definer: boolean;
      config: string[] | null;
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(`
      SELECT p.proname AS name, p.prosecdef definer, p.proconfig config,
             has_function_privilege('anon', p.oid, 'EXECUTE') anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') svc
        FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace
         AND (p.proname LIKE 'cockpit_slack_%' OR p.proname LIKE 'cockpit_forms_editor%')`);
    expect(fns.length).toBeGreaterThanOrEqual(
      service.length + browser.length + internal.length,
    );
    const nameOf = (sig: string) => sig.slice(0, sig.indexOf("("));
    const serviceNames = new Set(service.map(nameOf));
    const browserNames = new Set(browser.map(nameOf));
    for (const fn of fns) {
      expect(fn.definer).toBe(true);
      expect(fn.config).toContain('search_path=""');
      // Exactly one grant for an RPC, none at all for a helper.
      expect([fn.name, fn.anon, fn.auth, fn.svc]).toEqual([
        fn.name,
        false,
        browserNames.has(fn.name),
        serviceNames.has(fn.name),
      ]);
    }
    expect(
      await refused(null, "SELECT public.cockpit_slack_notice_settings_read()"),
    ).toContain("permission denied");
    expect(
      await refused(CEO, "SELECT public.cockpit_slack_notice_claim(10)"),
    ).toContain("permission denied");
  });

  test("the seed: every kickoff older than 48 hours is skipped, none is queued, the newer one is left to the sweep", async () => {
    const old = await notice("kickoff:kickold00001");
    expect(old).toMatchObject({
      kind: "kickoff",
      state: "skipped",
      task_id: "taskold1",
      client_name: "Old One",
    });
    expect(old.error).toBe(
      "This kickoff was more than 48 hours old when the notices began, so it was not posted.",
    );
    expect(old.finished_at).not.toBeNull();
    expect(old.facts).toMatchObject({
      taskId: "taskold1",
      responseId: "kickold00001",
      formId: "BbJy6xg4",
      second: false,
    });
    // No submit time at all counts as old.
    expect((await notice("kickoff:kickold00002")).state).toBe("skipped");
    expect(await maybeNotice("kickoff:kickfresh001")).toBeNull();
    expect(
      await count("SELECT count(*) n FROM public.cockpit_slack_notices"),
    ).toBe(2);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_slack_notices WHERE state='queued'",
      ),
    ).toBe(0);
  });

  test("the seeds: two ready channels and eight settings, each written once with its audit row", async () => {
    const channels = await q(
      "SELECT * FROM public.cockpit_slack_channels ORDER BY id",
    );
    expect(channels.map(c => [c.id, c.name, c.state, c.private])).toEqual([
      [CSM_GENERAL, "csm-general", "ok", true],
      [MEDIA_GENERAL, "media-general", "ok", true],
    ]);
    const settings = await q(
      "SELECT kind, enabled, channel, mention_rule FROM public.cockpit_slack_notice_settings",
    );
    const byKind = Object.fromEntries(settings.map(s => [s.kind, s]));
    expect(Object.keys(byKind).sort()).toEqual([
      "blueprint.close",
      "blueprint.media",
      "blueprint.offer",
      "blueprint.updated",
      "kickoff",
      "kickoff.late",
      "kickoff.second",
      "kickoff.updated",
    ]);
    expect(byKind.kickoff).toMatchObject({
      enabled: true,
      channel: CSM_GENERAL,
      mention_rule: ["seat:creative"],
    });
    expect(byKind["kickoff.late"]).toMatchObject({
      channel: null,
      mention_rule: ["seat:csm", "seat:systems_manager"],
    });
    expect(byKind["kickoff.second"].mention_rule).toEqual(["seat:csm"]);
    expect(byKind["blueprint.close"]).toMatchObject({
      channel: CSM_GENERAL,
      mention_rule: ["seat:csm"],
    });
    expect(byKind["blueprint.media"]).toMatchObject({
      channel: MEDIA_GENERAL,
      mention_rule: [],
    });
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.setting' AND before IS NULL",
      ),
    ).toBe(8);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.channel'",
      ),
    ).toBe(2);
    // The table CHECKs hold the shape: a reply names no channel, a variant stays on.
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_slack_notice_settings SET channel=$1 WHERE kind='kickoff.updated'",
        [CSM_GENERAL],
      ),
    ).toContain("check");
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_slack_notice_settings SET enabled=false WHERE kind='kickoff.late'",
      ),
    ).toContain("check");
  });

  test("the cron block is skipped where pg_cron is missing, and the stage pattern is BLUEPRINT_ON byte for byte", async () => {
    const ts = readFileSync(
      new URL(
        "../../client-success-cockpit/src/forms/formStatus.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const hit = ts.match(
      /BLUEPRINT_ON\s*=\s*\/((?:\\\/|[^/\n])+)\/([a-z]*)\s*;/,
    );
    expect(hit).not.toBeNull();
    const [, pattern, flags] = hit!;
    expect(flags).toBe("i");
    const fn = cut(
      migration(FILE),
      /FUNCTION public\.cockpit_slack_notice_card_done\([\s\S]*?\$\$;/,
      "card_done",
    );
    expect(fn).toContain(`~* '${pattern}'`);
    // And they agree on real stages.
    const js = new RegExp(pattern, flags);
    for (const stage of [
      "Brand Blueprint Booked♠️",
      "LAUNCH BOOKED",
      "Ready For Launch🚀",
      "Active",
      "  active ",
      "Inactive",
      "Not active yet",
      "Onboarding Booked",
      "Stopped",
      "",
    ]) {
      const sql = (
        await q<{ ok: boolean }>(
          "SELECT public.cockpit_slack_notice_card_done($1, now(), now() - interval '1 minute') ok",
          [stage],
        )
      )[0].ok;
      expect(sql).toBe(js.test(stage));
    }
    // An older card change never counts, nor does a missing one.
    expect(
      (
        await q<{ ok: boolean }>(
          "SELECT public.cockpit_slack_notice_card_done('Active', now() - interval '1 hour', now()) ok",
        )
      )[0].ok,
    ).toBe(false);
    expect(
      (
        await q<{ ok: boolean }>(
          "SELECT public.cockpit_slack_notice_card_done('Active', NULL, now()) ok",
        )
      )[0].ok,
    ).toBe(false);
  });
});

describe("the kickoff trigger", () => {
  test("a new response ID queues exactly one kickoff, with its facts and an audit row", async () => {
    await setKickoff(A, "kickacme0001", ago(5));
    const n = await notice("kickoff:kickacme0001");
    expect(n).toMatchObject({
      kind: "kickoff",
      state: "queued",
      task_id: A,
      client_name: "Acme Interiors",
      attempts: 0,
    });
    expect(n.facts).toEqual({
      taskId: A,
      client: "Acme Interiors",
      responseId: "kickacme0001",
      formId: "tG7dnxBn",
      submittedAt: n.facts.submittedAt,
      second: false,
      previousResponseId: null,
    });
    const audit = (await audits(n.id))[0];
    expect(audit).toMatchObject({
      action: "slack_notice.queued",
      entity_type: "cockpit_slack_notices",
      source_app: "client-success",
      source_system: "supabase",
      before: null,
    });
    expect(Object.keys(audit.after).sort()).toEqual([
      "attempts",
      "channel",
      "error",
      "slack_ts",
      "state",
      "target",
      "variant",
    ]);
    expect(audit.metadata).toEqual({
      kind: "kickoff",
      task_id: A,
      dedupe_key: "kickoff:kickacme0001",
      op: "insert",
    });
  });

  test("a re-publish with the same ID does nothing", async () => {
    const before = await notices();
    await setKickoff(
      A,
      "kickacme0001",
      (await notice("kickoff:kickacme0001")).facts.submittedAt,
      {
        answers: [{ ref: "x", title: "Relabelled", value: "y" }],
      },
    );
    await q(
      "UPDATE public.cockpit_client_onboarding SET synced_at=now(), client_status='Onboarding Booked' WHERE clickup_task_id=$1",
      [A],
    );
    expect(await notices()).toBe(before);
  });

  test("a new ID on the same card is a second kickoff, naming the first", async () => {
    await setKickoff(A, "kickacme0002", ago(2));
    const n = await notice("kickoff:kickacme0002");
    expect(n.state).toBe("queued");
    expect(n.facts).toMatchObject({
      second: true,
      previousResponseId: "kickacme0001",
      responseId: "kickacme0002",
    });
  });

  test("an old kickoff and one without a readable time are skipped with a plain reason", async () => {
    await onboard("taskD1", "Delta Fitout", {
      ...kickoffForm("kickdelta001", ago(60 * 72)),
      blueprint: {
        form_id: "oYZKtogO",
        response_id: "bpdelta00001",
        submitted_at: "2026-09-13T10:00:00Z",
        answers: [],
      },
    });
    const old = await notice("kickoff:kickdelta001");
    expect(old.state).toBe("skipped");
    expect(old.error).toBe(
      "This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.",
    );
    expect(old.finished_at).not.toBeNull();
    await onboard(
      "taskE1",
      "Epsilon",
      kickoffForm("kickeps00001", "not a time"),
    );
    const bad = await notice("kickoff:kickeps00001");
    expect(bad.state).toBe("skipped");
    expect(bad.error).toBe(
      "The kickoff has no readable submit time, so it was not posted.",
    );
  });

  test("the cockpit's own send record can make it a second kickoff", async () => {
    await q(
      `INSERT INTO public.cockpit_csm_form_sends(response_id,form_key,form_id,task_id,client_name,hidden_keys,hidden_sha256,second,sent_by,sent_by_email)
       VALUES('kickgamma001','kickoff','tG7dnxBn',$1,'Gamma Design',ARRAY['onboarding_client_id'],$2,true,$3,'csm-a@tests.invalid')`,
      [C, "a".repeat(64), CSM_A],
    );
    await onboard(C, "Gamma Design", kickoffForm("kickgamma001", ago(1)));
    const n = await notice("kickoff:kickgamma001");
    expect(n.state).toBe("queued");
    expect(n.facts.second).toBe(true);
    expect(n.facts.previousResponseId).toBeNull();
    await onboard(K, "Kappa Homes", kickoffForm("kickkappa001", ago(25)));
    expect((await notice("kickoff:kickkappa001")).state).toBe("queued");
  });

  test("a row the notice cannot take never stops the mirror: the insert lands and the note says why", async () => {
    await onboard(
      "bad task id",
      "Broken Card",
      kickoffForm("kickbroken01", ago(1)),
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_client_onboarding WHERE clickup_task_id='bad task id'",
      ),
    ).toBe(1);
    expect(await maybeNotice("kickoff:kickbroken01")).toBeNull();
    const note = (
      await q(
        "SELECT * FROM public.cockpit_sync_state WHERE key='slack-notices-queue'",
      )
    )[0];
    expect(note.ok).toBe(false);
    expect(note.note).toContain("cockpit_slack_notices");
    expect(note.last_run_at).not.toBeNull();
  });
});

describe("the Brand Blueprint triggers", () => {
  const LAUNCH = {
    kind: "blueprintClose",
    launchTaskId: "86launchB1",
    closeRoute: "card_only",
    mapPhase: 4,
    mapSkipped: false,
  };

  test("a close from sending to done queues the close and the media notice once, with their facts", async () => {
    await press(
      "blueprintClose",
      B,
      "Beta Build",
      ["done"],
      { service: "interior" },
      LAUNCH,
    );
    const close = await notice(`blueprint:${B}:close`);
    const media = await notice(`blueprint:${B}:media`);
    expect(close).toMatchObject({
      kind: "blueprint.close",
      state: "queued",
      task_id: B,
      parent_id: null,
    });
    expect(close.facts).toMatchObject({
      taskId: B,
      client: "Beta Build",
      source: "cockpit",
      responseId: null,
      settled: "done",
      closedByRole: "the creative director",
      launchTaskId: "86launchB1",
      mapPhase: 4,
      service: "interior",
    });
    expect(Date.parse(close.facts.closedAt)).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(media.facts).toEqual({
      taskId: B,
      client: "Beta Build",
      outboxId: close.facts.outboxId,
      service: "interior",
      launchTaskId: "86launchB1",
      mapPhase: 4,
    });
  });

  test("a second close on the card queues nothing", async () => {
    const before = await notices();
    await press(
      "blueprintClose",
      B,
      "Beta Build",
      ["done"],
      { service: "interior" },
      LAUNCH,
    );
    expect(await notices()).toBe(before);
  });

  test("a close that needs a check, then confirmed, queues the close, the media notice and one reply", async () => {
    await press(
      "blueprintClose",
      "taskR1",
      "Rho Studio",
      ["reconcile", "done"],
      { service: "fitout" },
      { ...LAUNCH, mapPhase: null },
    );
    const close = await notice("blueprint:taskR1:close");
    expect(close.facts.settled).toBe("reconcile");
    expect(close.facts.mapPhase).toBeNull();
    expect((await notice("blueprint:taskR1:media")).state).toBe("queued");
    const updated = await notice("blueprint:taskR1:updated");
    expect(updated).toMatchObject({
      kind: "blueprint.updated",
      parent_id: close.id,
      state: "queued",
    });
    expect(Object.keys(updated.facts).sort()).toEqual([
      "client",
      "confirmedAt",
      "outboxId",
      "taskId",
    ]);
    // Another press that goes the same way adds nothing.
    const before = await notices();
    await press("blueprintClose", "taskR1", "Rho Studio", [
      "reconcile",
      "done",
    ]);
    expect(await notices()).toBe(before);
  });

  test("a close that settles to reconcile, or by hand, keeps its launch task and the map phase it read (X28)", async () => {
    // Part 1 recorded the launch task on the Blueprint; the close's run
    // wrote its journal (with the plan's own values) and then went to
    // reconcile, which writes no result.
    await q(
      "INSERT INTO public.cockpit_blueprints(task_id, client_name, launch_task_id, updated_by) VALUES('taskX1','Xi Homes','86launchX1','creative@tests.invalid')",
    );
    const id = await outbox("blueprintClose", "taskX1", "Xi Homes", {
      payload: { service: "fitout" },
    });
    await q(
      `INSERT INTO public.cockpit_media_actions(id, actor_id, operation, request)
       VALUES($1, $2, 'creativeClient.blueprintClose', $3::jsonb)`,
      [
        id,
        CREATIVE,
        JSON.stringify({
          outbox: { id },
          planned: {
            kind: "blueprintClose",
            launchTaskId: null,
            closeRoute: "card_only",
            mapPhase: 6,
            mapSkipped: true,
          },
        }),
      ],
    );
    await move(id, "sending");
    await move(id, "reconcile");
    expect(
      (
        await q(
          "SELECT result FROM public.cockpit_creative_outbox WHERE id=$1",
          [id],
        )
      )[0].result,
    ).toBeNull();
    expect((await notice("blueprint:taskX1:close")).facts).toMatchObject({
      settled: "reconcile",
      launchTaskId: "86launchX1",
      mapPhase: 6,
    });
    expect((await notice("blueprint:taskX1:media")).facts).toMatchObject({
      launchTaskId: "86launchX1",
      mapPhase: 6,
    });

    // A stuck send settled to done by hand (RUNBOOK): no result, no journal
    // planned values either; the Blueprint's launch task still comes through,
    // and the phase is unknown, never zero.
    await q(
      "INSERT INTO public.cockpit_blueprints(task_id, client_name, launch_task_id, updated_by) VALUES('taskX2','Xi Two','86launchX2','creative@tests.invalid')",
    );
    const hand = await outbox("blueprintClose", "taskX2", "Xi Two");
    await q(
      `INSERT INTO public.cockpit_media_actions(id, actor_id, operation, request)
       VALUES($1, $2, 'creativeClient.blueprintClose', '{"outbox":{}}'::jsonb)`,
      [hand, CREATIVE],
    );
    await move(hand, "sending");
    await q(
      "UPDATE public.cockpit_creative_outbox SET state='done', settled_at=now() WHERE id=$1",
      [hand],
    );
    expect((await notice("blueprint:taskX2:close")).facts).toMatchObject({
      settled: "done",
      launchTaskId: "86launchX2",
      mapPhase: null,
    });
    // A close whose run finished keeps its own result over both.
    await q(
      "INSERT INTO public.cockpit_blueprints(task_id, client_name, launch_task_id, updated_by) VALUES('taskX3','Xi Three','86launchOLD','creative@tests.invalid')",
    );
    await press(
      "blueprintClose",
      "taskX3",
      "Xi Three",
      ["done"],
      {},
      { ...LAUNCH, launchTaskId: "86launchX3", mapPhase: 3 },
    );
    expect((await notice("blueprint:taskX3:media")).facts).toMatchObject({
      launchTaskId: "86launchX3",
      mapPhase: 3,
    });
  });

  test("a later press that settles done after a close left to check queues the reply once", async () => {
    await press("blueprintClose", "taskS1", "Sigma Build", ["reconcile"]);
    const close = await notice("blueprint:taskS1:close");
    expect(await maybeNotice("blueprint:taskS1:updated")).toBeNull();
    await press("blueprintClose", "taskS1", "Sigma Build", ["done"]);
    expect((await notice("blueprint:taskS1:updated")).parent_id).toBe(close.id);
    const before = await notices();
    await press("blueprintClose", "taskS1", "Sigma Build", ["done"]);
    expect(await notices()).toBe(before);
  });

  test("an offer queues a reply under the close, or a top-level notice when there is no close", async () => {
    await press("blueprintOffer", B, "Beta Build", ["done"], {
      dna_status: "complete",
    });
    const offer = await notice(`blueprint:${B}:offer`);
    expect(offer).toMatchObject({
      kind: "blueprint.offer",
      parent_id: (await notice(`blueprint:${B}:close`)).id,
    });
    expect(offer.facts).toMatchObject({
      taskId: B,
      offeredByRole: "the creative director",
      dnaComplete: true,
    });
    await press("blueprintOffer", "taskO1", "Omicron", ["done"], {
      dna_status: "partial",
    });
    const lone = await notice("blueprint:taskO1:offer");
    expect(lone.parent_id).toBeNull();
    expect(lone.facts.dnaComplete).toBe(false);
  });

  test("other kinds, other moves and a press without a card queue nothing and never raise", async () => {
    const before = await notices();
    await press("blueprintLaunch", "taskL1", "Lambda", ["done"]);
    await press("blueprintOffer", "taskL1", "Lambda", ["failed"]);
    const id = await outbox("blueprintClose", "taskL1", "Lambda");
    await move(id, "sending");
    expect(await notices()).toBe(before);
    const lost = await outbox("blueprintClose", null, "No Card");
    await move(lost, "sending");
    await move(lost, "done");
    expect(await notices()).toBe(before);
    const note = (
      await q(
        "SELECT note FROM public.cockpit_sync_state WHERE key='slack-notices-queue'",
      )
    )[0].note;
    expect(note).toContain("has no card ID, so no notice was queued");
  });

  test("the old Typeform Blueprint queues a close within 48 hours, and an older record nothing at all", async () => {
    await q(
      `UPDATE public.cockpit_client_onboarding SET forms = forms || $2::jsonb WHERE clickup_task_id=$1`,
      [
        A,
        JSON.stringify({
          blueprint: {
            form_id: "oYZKtogO",
            response_id: "bpacme00001",
            submitted_at: ago(60),
            answers: [],
          },
        }),
      ],
    );
    const close = await notice(`blueprint:${A}:close`);
    expect(close.state).toBe("queued");
    expect(close.facts).toMatchObject({
      source: "typeform",
      responseId: "bpacme00001",
      outboxId: null,
      settled: null,
      closedByRole: null,
    });
    // Delta's record is from September: no row, so it never blocks a native close.
    expect(await maybeNotice("blueprint:taskD1:close")).toBeNull();
  });
});

describe("the claim", () => {
  test("a kickoff waits, unwritten, until the card looks done; then it is claimed with its tags", async () => {
    const n = await notice("kickoff:kickacme0001");
    expect((await claim(n.id)).rows).toEqual([]);
    const after = await notice("kickoff:kickacme0001");
    expect(after.state).toBe("queued");
    expect(after.updated_at).toEqual(n.updated_at);
    await q(
      "UPDATE public.cockpit_client_onboarding SET client_status='Brand Blueprint Booked♠️', card_updated_at=now() WHERE clickup_task_id=$1",
      [A],
    );
    const got = await claim(n.id);
    expect(got.busy).toBe(false);
    expect(got.rows.length).toBe(1);
    const row = got.rows[0];
    expect(row).toMatchObject({
      id: n.id,
      ref: `CN-${n.id.slice(0, 8)}`,
      kind: "kickoff",
      taskId: A,
      clientName: "Acme Interiors",
      attempts: 0,
      target: CSM_GENERAL,
      threadTs: null,
      parentId: null,
    });
    expect(row.facts.responseId).toBe("kickacme0001");
    expect(row.live).toMatchObject({
      clientStatus: "Brand Blueprint Booked♠️",
      blueprintLink: true,
      looksDone: true,
      filledByRole: null,
    });
    expect(Date.parse(row.live.dueBy) - Date.parse(row.facts.submittedAt)).toBe(
      20 * 60_000,
    );
    // Kickoff: the creative seat. Late: the CSM of this client and the systems manager. Second: the CSM.
    expect(row.mentions.main).toEqual([
      {
        rule: "seat:creative",
        personId: people.omar,
        label: "the creative director",
        slackId: "U0CREATIV1",
        email: "creative@tests.invalid",
        missing: false,
      },
    ]);
    expect(row.mentions.late.map((m: Row) => [m.rule, m.slackId])).toEqual([
      ["seat:csm", "U0CSMAAAA1"],
      ["seat:systems_manager", "U0SYSMANA1"],
    ]);
    expect(row.mentions.second.map((m: Row) => m.label)).toEqual(["the CSM"]);
    expect(row).not.toHaveProperty("rehearsal");
    const stored = await notice("kickoff:kickacme0001");
    expect(stored).toMatchObject({
      state: "sending",
      target: CSM_GENERAL,
      attempts: 0,
    });
    expect(stored.claimed_at).not.toBeNull();
  });

  test("a kickoff 20 minutes old is claimed although the card has not caught up", async () => {
    const n = await notice("kickoff:kickkappa001");
    const got = await claim(n.id);
    expect(got.rows.map((r: Row) => r.id)).toEqual([n.id]);
    expect(got.rows[0].live.looksDone).toBe(false);
  });

  test("a notice turned off becomes muted at the claim (D17)", async () => {
    await settingsSet(CEO, "blueprint.media", { on: false });
    const media = await notice(`blueprint:${B}:media`);
    expect((await claim(media.id)).rows).toEqual([]);
    const after = await notice(`blueprint:${B}:media`);
    expect(after.state).toBe("muted");
    expect(after.error).toBe("Turned off in Settings, Notices and routing.");
    expect(after.finished_at).not.toBeNull();
    await settingsSet(CEO, "blueprint.media", { on: true });
  });

  test("a reply waits for its first notice, then goes in its thread", async () => {
    const close = await notice("blueprint:taskR1:close");
    const reply = await notice("blueprint:taskR1:updated");
    expect((await claim(reply.id)).rows).toEqual([]);
    expect((await notice("blueprint:taskR1:updated")).state).toBe("queued");
    const claimed = await claim(close.id);
    expect(claimed.rows[0]).toMatchObject({
      target: CSM_GENERAL,
      threadTs: null,
    });
    expect(claimed.rows[0].live).toHaveProperty("launchCallAt", null);
    expect(claimed.rows[0].mentions.main.map((m: Row) => m.missing)).toEqual([
      true,
    ]);
    await result(close.id, "posted", "1792872070.187739", CSM_GENERAL, null, {
      variant: "reconcile",
    });
    const got = await claim(reply.id);
    expect(got.rows[0]).toMatchObject({
      target: CSM_GENERAL,
      threadTs: "1792872070.187739",
      parentId: close.id,
    });
    await result(reply.id, "posted", "1792872071.000100", CSM_GENERAL, null, {
      variant: "thread",
    });
  });

  test("a reply whose first notice failed goes top level; one whose first notice did not post is skipped, except an offer", async () => {
    const close = await notice(`blueprint:${B}:close`);
    await claim(close.id);
    await result(
      close.id,
      "failed",
      null,
      null,
      "Slack refused it: mahara-club-bot is not in #csm-general.",
    );
    const offer = await notice(`blueprint:${B}:offer`);
    expect((await claim(offer.id)).rows[0]).toMatchObject({
      target: CSM_GENERAL,
      threadTs: null,
      parentId: close.id,
    });

    await settingsSet(CEO, "blueprint.close", { on: false });
    const sClose = await notice("blueprint:taskS1:close");
    await claim(sClose.id);
    expect((await notice("blueprint:taskS1:close")).state).toBe("muted");
    await settingsSet(CEO, "blueprint.close", { on: true });
    const sReply = await notice("blueprint:taskS1:updated");
    expect((await claim(sReply.id)).rows).toEqual([]);
    const skipped = await notice("blueprint:taskS1:updated");
    expect(skipped.state).toBe("skipped");
    expect(skipped.error).toBe(
      "Its first notice did not post, so this reply was not sent.",
    );
    await press("blueprintOffer", "taskS1", "Sigma Build", ["done"]);
    const sOffer = await notice("blueprint:taskS1:offer");
    expect(sOffer.parent_id).toBe(sClose.id);
    expect((await claim(sOffer.id)).rows[0]).toMatchObject({
      target: CSM_GENERAL,
      threadTs: null,
    });
  });

  test("a top-level notice whose channel is not ready fails without being sent", async () => {
    await svc(
      "SELECT public.cockpit_slack_channel_checked($1,false,'media-general',true,'Invite @mahara-club-bot to #media-general, then add it again.') r",
      [MEDIA_GENERAL],
    );
    const media = await notice("blueprint:taskR1:media");
    expect((await claim(media.id)).rows).toEqual([]);
    const after = await notice("blueprint:taskR1:media");
    expect(after).toMatchObject({ state: "failed", target: null });
    expect(after.error).toBe(
      `The channel for this notice is not ready (${MEDIA_GENERAL}). Choose one in Settings, Notices and routing.`,
    );
    const states = (await audits(media.id)).map(a => a.action);
    expect(states).toEqual(
      expect.arrayContaining([
        "slack_notice.queued",
        "slack_notice.sending",
        "slack_notice.failed",
      ]),
    );
    await svc(
      "SELECT public.cockpit_slack_channel_checked($1,true,'media-general',true,'mahara-club-bot is in it.') r",
      [MEDIA_GENERAL],
    );
  });

  test("without p_only it claims due rows oldest first, up to the limit; a kickoff not due is passed over", async () => {
    const second = await notice("kickoff:kickacme0002");
    const gamma = await notice("kickoff:kickgamma001");
    const got = await claim(null, 1);
    expect(got.rows.map((r: Row) => r.id)).toEqual([second.id]);
    expect((await notice("kickoff:kickgamma001")).updated_at).toEqual(
      gamma.updated_at,
    );
  });

  test("after an outage, a notice more than 48 hours past its event is skipped with a plain reason, never posted", async () => {
    // Queued while nothing could post (no vault secret, or the wrong bot
    // requeueing every 5 minutes, which is never an attempt), then three
    // days pass.
    await onboard(
      "taskY1",
      "Ypsilon Homes",
      kickoffForm("kickypsil001", ago(5)),
    );
    const kick = await notice("kickoff:kickypsil001");
    await press(
      "blueprintClose",
      "taskY2",
      "Ypsilon Two",
      ["done"],
      {},
      { kind: "blueprintClose", mapPhase: 4, mapSkipped: false },
    );
    const close = await notice("blueprint:taskY2:close");
    const media = await notice("blueprint:taskY2:media");
    // The guard keeps a row's creation time; the test turns it off to age them.
    await q(
      "ALTER TABLE public.cockpit_slack_notices DISABLE TRIGGER cockpit_slack_notices_guard",
    );
    await q(
      `UPDATE public.cockpit_slack_notices
          SET created_at = now() - interval '72 hours', next_attempt_at = now(),
              facts = facts || jsonb_build_object('submittedAt', $2::text, 'closedAt', CASE WHEN facts ? 'closedAt' THEN $2::text END)
        WHERE id = ANY($1::uuid[])`,
      [[kick.id, close.id, media.id], ago(72 * 60)],
    );
    await q(
      "ALTER TABLE public.cockpit_slack_notices ENABLE TRIGGER cockpit_slack_notices_guard",
    );
    for (const id of [kick.id, close.id, media.id])
      expect((await claim(id)).rows).toEqual([]);
    expect(await notice("kickoff:kickypsil001")).toMatchObject({
      state: "skipped",
      error:
        "This kickoff was more than 48 hours old by the time the cockpit could send it, so it was not posted.",
    });
    for (const key of ["blueprint:taskY2:close", "blueprint:taskY2:media"])
      expect(await notice(key)).toMatchObject({
        state: "skipped",
        error:
          "This notice was more than 48 hours old by the time the cockpit could send it, so it was not posted.",
      });
    // Each skip left its audit row, from the cron.
    expect((await audits(kick.id)).at(-1)!.source_system).toBe("cron");
  });
});

describe("recording what Slack answered", () => {
  test("a post counts only on the channel it was asked for, and saves the detail it was sent with", async () => {
    const n = await notice("kickoff:kickacme0001");
    expect(
      await resultRefused(n.id, "posted", "1792900000.000100", MEDIA_GENERAL),
    ).toContain("Slack answered for another channel");
    expect(
      await resultRefused(n.id, "posted", "1792900000.000100", "D0123456789"),
    ).toContain("Slack answered for another channel");
    expect(
      await resultRefused(n.id, "posted", "not-a-ts", CSM_GENERAL),
    ).toContain("Slack answered for another channel");
    const view = await result(
      n.id,
      "posted",
      "1792900000.000100",
      CSM_GENERAL,
      null,
      {
        variant: "complete",
        text: `Kickoff complete: Acme Interiors. Next is the Brand Blueprint call. Ref CN-${n.id.slice(0, 8)}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Kickoff complete: Acme Interiors*",
            },
          },
        ],
        permalink:
          "https://mahara.slack.com/archives/C09RZ0GS0V9/p1792900000000100",
        facts: { commentCheck: "found", handoffAt: ago(3), filledByRole: null },
        unknownKey: "ignored",
      },
    );
    expect(view).toMatchObject({
      id: n.id,
      kind: "kickoff",
      state: "posted",
      variant: "complete",
      responseId: "kickacme0001",
      channel: { id: CSM_GENERAL, name: "csm-general" },
      permalink:
        "https://mahara.slack.com/archives/C09RZ0GS0V9/p1792900000000100",
      reason: null,
      dueAt: null,
    });
    const stored = await notice("kickoff:kickacme0001");
    expect(stored).toMatchObject({
      slack_ts: "1792900000.000100",
      channel: CSM_GENERAL,
      error: null,
    });
    expect(stored.text).toContain("Ref CN-");
    expect(stored.blocks.length).toBe(1);
    expect(stored.facts).toMatchObject({
      responseId: "kickacme0001",
      commentCheck: "found",
    });
    const posted = (await audits(n.id)).find(
      a => a.action === "slack_notice.posted",
    )!;
    expect(posted.source_system).toBe("cron");
    expect(posted.after).toMatchObject({
      state: "posted",
      slack_ts: "1792900000.000100",
      channel: CSM_GENERAL,
      variant: "complete",
    });
    expect(JSON.stringify(posted)).not.toContain("Kickoff complete");
    // The same answer again changes nothing; another message is refused.
    const auditCount = (await audits(n.id)).length;
    expect(
      (await result(n.id, "posted", "1792900000.000100", CSM_GENERAL)).state,
    ).toBe("posted");
    expect((await audits(n.id)).length).toBe(auditCount);
    expect(
      await resultRefused(n.id, "posted", "1792900099.000100", CSM_GENERAL),
    ).toContain("posted to posted");
    // A bad permalink is not kept.
    expect(stored.permalink).toMatch(/^https:\/\/mahara\.slack\.com\//);
  });

  test("requeue waits without counting an attempt; it waits 30 seconds at least", async () => {
    const n = await notice("kickoff:kickkappa001");
    const view = await result(
      n.id,
      "requeue",
      null,
      null,
      "Waiting for Make's Kickoff Handoff comment.",
      { retryAfterSec: 120 },
    );
    expect(view).toMatchObject({
      state: "queued",
      reason: "Waiting for Make's Kickoff Handoff comment.",
    });
    let row = await notice("kickoff:kickkappa001");
    expect(row.attempts).toBe(0);
    const wait = (new Date(row.next_attempt_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(110);
    expect(wait).toBeLessThan(125);
    expect((await claim(n.id)).rows).toEqual([]);
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
      [n.id],
    );
    await claim(n.id);
    await result(n.id, "requeue", null, null, null, { retryAfterSec: 5 });
    row = await notice("kickoff:kickkappa001");
    const floor = (new Date(row.next_attempt_at).getTime() - Date.now()) / 1000;
    expect(floor).toBeGreaterThan(25);
    expect(floor).toBeLessThan(35);
    expect(row.attempts).toBe(0);
    // Posted later as late (the sweep's follow-up test uses it).
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
      [n.id],
    );
    await claim(n.id);
    await result(n.id, "posted", "1792900100.000200", CSM_GENERAL, null, {
      variant: "late",
    });
    expect((await notice("kickoff:kickkappa001")).variant).toBe("late");
  });

  test("retry counts each attempt and fails at the third", async () => {
    const n = await notice("kickoff:kickacme0002");
    await result(
      n.id,
      "retry",
      null,
      null,
      "Slack asked the cockpit to slow down.",
      { retryAfterSec: 2 },
    );
    let row = await notice("kickoff:kickacme0002");
    expect(row).toMatchObject({
      state: "queued",
      attempts: 1,
      error: "Slack asked the cockpit to slow down.",
    });
    expect(new Date(row.next_attempt_at).getTime() - Date.now()).toBeLessThan(
      5_000,
    );
    for (const expected of [2, 3]) {
      await q(
        "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
        [n.id],
      );
      expect((await claim(n.id)).rows.length).toBe(1);
      await result(n.id, "retry", null, null, null, { retryAfterSec: 1 });
      row = await notice("kickoff:kickacme0002");
      expect(row.attempts).toBe(expected);
    }
    expect(row).toMatchObject({
      state: "failed",
      attempts: 3,
      error: "It could not be sent after 3 tries.",
    });
    expect(row.finished_at).not.toBeNull();
  });

  test("every move the sender does not make is refused", async () => {
    const posted = await notice("kickoff:kickacme0001");
    const failed = await notice("kickoff:kickacme0002");
    const queued = await notice("kickoff:kickgamma001");
    expect(await resultRefused(queued.id, "requeue")).toContain(
      "A notice goes from queued to queued only through the sender",
    );
    expect(await resultRefused(queued.id, "failed", null, null, "x")).toContain(
      "from queued to failed",
    );
    expect(
      await resultRefused(
        failed.id,
        "posted",
        "1792900000.000300",
        CSM_GENERAL,
      ),
    ).toContain("from failed to posted");
    expect(await resultRefused(posted.id, "retry")).toContain(
      "from posted to queued",
    );
    expect(await resultRefused(queued.id, "nope")).toContain(
      "Choose posted, failed, unknown, requeue or retry",
    );
    expect(
      await resultRefused(
        "00000000-0000-4000-8000-00000000dead",
        "posted",
        "1.1",
        CSM_GENERAL,
      ),
    ).toContain("no notice");
    for (const [sql, words] of [
      [
        "UPDATE public.cockpit_slack_notices SET state='queued' WHERE id=$1",
        "from posted to queued",
      ],
      [
        "UPDATE public.cockpit_slack_notices SET slack_ts='1.2' WHERE id=$1",
        "keeps its Slack message",
      ],
      [
        "UPDATE public.cockpit_slack_notices SET kind='blueprint.close' WHERE id=$1",
        "keeps its kind",
      ],
      [
        "UPDATE public.cockpit_slack_notices SET dedupe_key='kickoff:moved' WHERE id=$1",
        "keeps its kind",
      ],
      [
        "DELETE FROM public.cockpit_slack_notices WHERE id=$1",
        "A notice is never deleted",
      ],
    ] as const)
      expect(await ownerRefused(sql, [posted.id])).toContain(words);
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_slack_notices SET state='queued' WHERE id=$1",
        [failed.id],
      ),
    ).toContain("from failed to queued");
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_slack_notices SET state='posted', slack_ts='1.3', channel=$2 WHERE id=$1",
        [queued.id, CSM_GENERAL],
      ),
    ).toContain("from queued to posted");
    expect(
      await ownerRefused("TRUNCATE public.cockpit_slack_notices"),
    ).toContain("A notice is never deleted");
    expect(
      await ownerRefused(
        "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,task_id,state,slack_ts,channel) VALUES('kickoff','kickoff:posted',$1,'posted','1.1',$2)",
        [A, CSM_GENERAL],
      ),
    ).toContain("A notice starts queued or skipped");
    expect(
      await ownerRefused(
        "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,task_id,target) VALUES('kickoff','kickoff:elsewhere',$1,'C0NOTLISTED1')",
        [A],
      ),
    ).toContain("is not ready for notices");
    expect(
      await ownerRefused(
        "DELETE FROM public.cockpit_slack_notice_settings WHERE kind='kickoff'",
      ),
    ).toContain("never deleted");
    expect(
      await ownerRefused(
        "DELETE FROM public.cockpit_slack_channels WHERE id=$1",
        [MEDIA_GENERAL],
      ),
    ).toContain("never deleted");
    // A failed or unknown needs its sentence.
    const offer = await notice(`blueprint:${B}:offer`);
    expect((await notice(`blueprint:${B}:offer`)).state).toBe("sending");
    expect(await resultRefused(offer.id, "failed")).toContain("plain sentence");
    expect(
      await resultRefused(offer.id, "unknown", null, null, "   "),
    ).toContain("plain sentence");
  });

  test("an unknown is handed out for reconcile at most every 10 minutes, then settles as posted", async () => {
    const offer = await notice(`blueprint:${B}:offer`);
    const view = await result(
      offer.id,
      "unknown",
      null,
      null,
      "Slack did not confirm the post; it is not sent again in case it arrived.",
    );
    expect(view).toMatchObject({
      state: "unknown",
      reason:
        "Slack did not confirm the post; it is not sent again in case it arrived.",
    });
    // A reply under a posted close carries its thread.
    await press("blueprintOffer", "taskR1", "Rho Studio", ["done"]);
    const rOffer = await notice("blueprint:taskR1:offer");
    expect((await claim(rOffer.id)).rows[0].threadTs).toBe("1792872070.187739");
    await result(
      rOffer.id,
      "unknown",
      null,
      null,
      "Slack did not confirm the post; it is not sent again in case it arrived.",
    );
    const auditsBefore = (await audits(offer.id)).length;
    const first = await svc<Row[]>(
      "SELECT public.cockpit_slack_notice_unknowns(10) r",
    );
    const mine = first.find(u => u.id === offer.id)!;
    const claimedAt = new Date(
      (await notice(`blueprint:${B}:offer`)).claimed_at,
    ).getTime();
    expect(mine).toMatchObject({
      ref: `CN-${offer.id.slice(0, 8)}`,
      kind: "blueprint.offer",
      target: CSM_GENERAL,
      channel: CSM_GENERAL,
      threadTs: null,
    });
    expect(
      Math.abs(Number(mine.oldest) * 1000 - (claimedAt - 60_000)),
    ).toBeLessThan(2);
    expect(first.find(u => u.id === rOffer.id)).toMatchObject({
      channel: CSM_GENERAL,
      threadTs: "1792872070.187739",
    });
    expect((await notice(`blueprint:${B}:offer`)).checked_at).not.toBeNull();
    // A look moves checked_at only: no audit row.
    expect((await audits(offer.id)).length).toBe(auditsBefore);
    expect(
      (
        await svc<Row[]>("SELECT public.cockpit_slack_notice_unknowns(10) r")
      ).map(u => u.id),
    ).not.toContain(offer.id);
    await q(
      "UPDATE public.cockpit_slack_notices SET checked_at=now() - interval '11 minutes' WHERE id=$1",
      [offer.id],
    );
    expect(
      (
        await svc<Row[]>("SELECT public.cockpit_slack_notice_unknowns(10) r")
      ).map(u => u.id),
    ).toEqual([offer.id]);
    // Reconcile found its Ref.
    expect(
      (await result(offer.id, "posted", "1792900200.000300", CSM_GENERAL))
        .state,
    ).toBe("posted");
  });

  test("the runbook's fixes: requeue a failed notice from scratch, mark a checked unknown as not posted", async () => {
    const n = await notice("kickoff:kickacme0002");
    const view = await svc<Row>(
      "SELECT public.cockpit_slack_notice_fix($1,'requeue',NULL) r",
      [n.id],
    );
    expect(view.state).toBe("queued");
    let row = await notice("kickoff:kickacme0002");
    expect(row).toMatchObject({ attempts: 0, error: null, finished_at: null });
    expect((await audits(n.id)).map(a => a.action)).toContain(
      "slack_notice.fix_requeue",
    );
    expect(
      await svcRefused(
        "SELECT public.cockpit_slack_notice_fix($1,'requeue',NULL)",
        [n.id],
      ),
    ).toContain("from queued to queued");
    expect(
      await svcRefused(
        "SELECT public.cockpit_slack_notice_fix($1,'delete',NULL)",
        [n.id],
      ),
    ).toContain("Choose requeue or not_posted");
    await claim(n.id);
    await result(
      n.id,
      "unknown",
      null,
      null,
      "Slack did not confirm the post; it is not sent again in case it arrived.",
    );
    await svc(
      "SELECT public.cockpit_slack_notice_fix($1,'not_posted','Looked in #csm-general for the Ref.') r",
      [n.id],
    );
    row = await notice("kickoff:kickacme0002");
    expect(row.state).toBe("failed");
    expect(row.error).toBe(
      "Checked by a person: not in Slack. Looked in #csm-general for the Ref.",
    );
    // The switch is off again outside the fix.
    expect(
      await ownerRefused(
        "UPDATE public.cockpit_slack_notices SET state='queued' WHERE id=$1",
        [n.id],
      ),
    ).toContain("only through the sender");
  });
});

describe("the sweep", () => {
  test("it finds every missed notice and stuck send, counted once", async () => {
    // A send stuck for 11 minutes.
    const stuck = await notice("blueprint:taskS1:offer");
    expect(stuck.state).toBe("sending");
    await q(
      "UPDATE public.cockpit_slack_notices SET claimed_at=now() - interval '11 minutes' WHERE id=$1",
      [stuck.id],
    );
    // A second kickoff, a Typeform Blueprint and a close the triggers never saw.
    await q(
      "ALTER TABLE public.cockpit_client_onboarding DISABLE TRIGGER cockpit_slack_notice_kickoff",
    );
    await setKickoff(K, "kickkappa002", ago(3));
    await onboard("taskT1", "Tau Living", {
      blueprint: {
        form_id: "oYZKtogO",
        response_id: "bptau000001",
        submitted_at: ago(30),
        answers: [],
      },
    });
    await q(
      "ALTER TABLE public.cockpit_client_onboarding ENABLE TRIGGER cockpit_slack_notice_kickoff",
    );
    await outbox("blueprintClose", "taskM1", "Mu Design", {
      state: "done",
      settled: true,
      payload: { service: "fitout" },
      result: {
        kind: "blueprintClose",
        launchTaskId: "86launchM1",
        closeRoute: "card_only",
        mapPhase: 6,
        mapSkipped: true,
      },
    });
    await outbox("blueprintOffer", "taskM1", "Mu Design", {
      state: "done",
      settled: true,
      payload: { dna_status: "complete" },
    });
    // A close left to check, then a done press written straight in.
    await press("blueprintClose", "taskN1", "Nu Homes", ["reconcile"]);
    const confirmed = await outbox("blueprintClose", "taskN1", "Nu Homes", {
      state: "done",
      settled: true,
    });
    // A later press settles after the close notice was made. PGlite's clock
    // ticks in milliseconds, so two statements can share one now().
    await q(
      "UPDATE public.cockpit_creative_outbox SET settled_at = now() + interval '1 second' WHERE id=$1",
      [confirmed],
    );
    // The late kickoff's card has caught up.
    await q(
      "UPDATE public.cockpit_client_onboarding SET client_status='Brand Blueprint Booked', card_updated_at=now() WHERE clickup_task_id=$1",
      [K],
    );

    const swept = await sweep();
    expect(swept).toEqual({
      unknown: 1,
      kickoffs: 2,
      closes: 2,
      media: 1,
      offers: 1,
      followups: 2,
    });

    const unknown = await notice("blueprint:taskS1:offer");
    expect(unknown.state).toBe("unknown");
    expect(unknown.error).toBe(
      "The sender stopped while posting. Look in Slack for this notice's Ref before anything else.",
    );
    expect((await audits(unknown.id)).at(-1)!.source_system).toBe("cron");
    expect((await notice("kickoff:kickfresh001")).state).toBe("queued");
    expect((await notice("kickoff:kickkappa002")).facts).toMatchObject({
      second: true,
      previousResponseId: "kickkappa001",
    });
    expect((await notice("blueprint:taskT1:close")).facts.source).toBe(
      "typeform",
    );
    const mClose = await notice("blueprint:taskM1:close");
    expect(mClose.facts).toMatchObject({
      settled: "done",
      mapPhase: 6,
      service: "fitout",
      launchTaskId: "86launchM1",
    });
    expect((await notice("blueprint:taskM1:media")).facts.mapPhase).toBe(6);
    expect((await notice("blueprint:taskM1:offer")).parent_id).toBe(mClose.id);
    expect((await notice("blueprint:taskN1:updated")).parent_id).toBe(
      (await notice("blueprint:taskN1:close")).id,
    );
    const followUp = await notice("kickoff:kickkappa001:updated");
    expect(followUp).toMatchObject({
      kind: "kickoff.updated",
      parent_id: (await notice("kickoff:kickkappa001")).id,
    });
    expect(Object.keys(followUp.facts).sort()).toEqual([
      "cardUpdatedAt",
      "client",
      "responseId",
      "submittedAt",
      "taskId",
    ]);
    // The sender re-checks the card's Kickoff Handoff comment from the kickoff's time.
    expect(followUp.facts.submittedAt).toBe(
      (await notice("kickoff:kickkappa001")).facts.submittedAt,
    );

    // A second sweep finds nothing new.
    expect(await sweep()).toEqual({
      unknown: 0,
      kickoffs: 0,
      closes: 0,
      media: 0,
      offers: 0,
      followups: 0,
    });
  });

  test("the follow-up reply goes in the late notice's thread", async () => {
    const reply = await notice("kickoff:kickkappa001:updated");
    const got = await claim(reply.id);
    expect(got.rows[0]).toMatchObject({
      kind: "kickoff.updated",
      threadTs: "1792900100.000200",
      target: CSM_GENERAL,
    });
    expect(got.rows[0].live).toMatchObject({
      clientStatus: "Brand Blueprint Booked",
    });
    expect(got.rows[0].mentions).toEqual({ main: [] });
    await result(reply.id, "posted", "1792900300.000400", CSM_GENERAL, null, {
      variant: "thread",
    });
  });

  test("a card that already looked done when the late notice posted gets its reply queued at once; the sender holds it for the comment, and none past 48 hours", async () => {
    const L = "taskL1";
    // A second kickoff on a card already at Brand Blueprint Booked: Make did
    // not write the new Kickoff Handoff comment, but the card was touched
    // after the submit, so it looks done.
    await onboard(
      L,
      "Lambda Living",
      kickoffForm("kicklambda01", ago(25)),
      "Brand Blueprint Booked♠️",
    );
    await q(
      "UPDATE public.cockpit_client_onboarding SET card_updated_at=now() - interval '19 minutes' WHERE clickup_task_id=$1",
      [L],
    );
    const late = await notice("kickoff:kicklambda01");
    const got = await claim(late.id);
    expect(got.rows[0].live).toMatchObject({ looksDone: true });
    await result(late.id, "posted", "1792900700.000800", CSM_GENERAL, null, {
      variant: "late",
      facts: {
        commentCheck: "missing",
        looksDone: true,
        cardUpdatedAt: got.rows[0].live.cardUpdatedAt,
      },
    });
    // The late notice saw the comment missing, so the card that looks done
    // gets its reply now, with a card time from before the alarm, and the
    // kickoff's time so the sender checks the comment before posting it.
    expect((await sweep()).followups).toBe(1);
    const reply = await notice("kickoff:kicklambda01:updated");
    expect(reply.parent_id).toBe(late.id);
    expect(Date.parse(reply.facts.cardUpdatedAt)).toBeLessThan(
      Date.parse((await notice("kickoff:kicklambda01")).finished_at),
    );
    expect(reply.facts.submittedAt).toBe(late.facts.submittedAt);
    expect((await sweep()).followups).toBe(0);
    // Waiting for the comment, the sender requeues it; 48 hours after the
    // kickoff the claim lets it go without a post.
    await claim(reply.id);
    await result(
      reply.id,
      "requeue",
      null,
      null,
      "Waiting for the card's Kickoff Handoff comment.",
      {
        retryAfterSec: 600,
      },
    );
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now(), facts = facts || jsonb_build_object('submittedAt', $2::text) WHERE id=$1",
      [reply.id, ago(49 * 60)],
    );
    expect((await claim(reply.id)).rows).toEqual([]);
    const ended = await notice("kickoff:kicklambda01:updated");
    expect(ended.state).toBe("skipped");
    expect(ended.error).toBe(
      "The card had no Kickoff Handoff comment 48 hours after the kickoff, so no reply was posted. The late notice stands.",
    );
  });

  test("a late notice whose comment read failed, on a card already done, gets its reply (X19)", async () => {
    const U = "taskU1";
    // Make finished at 3 minutes; the 20-minute send could not read the
    // comments (a 429, a 5xx, the timeout), so the late notice went out with
    // commentCheck unread although the card looked done.
    await onboard(
      U,
      "Upsilon Homes",
      kickoffForm("kickupsil001", ago(21)),
      "Brand Blueprint Booked",
    );
    await q(
      "UPDATE public.cockpit_client_onboarding SET card_updated_at=now() - interval '18 minutes' WHERE clickup_task_id=$1",
      [U],
    );
    const late = await notice("kickoff:kickupsil001");
    const got = await claim(late.id);
    expect(got.rows[0].live).toMatchObject({ looksDone: true });
    await result(late.id, "posted", "1792900710.000810", CSM_GENERAL, null, {
      variant: "late",
      facts: {
        commentCheck: "unread",
        looksDone: true,
        cardUpdatedAt: got.rows[0].live.cardUpdatedAt,
      },
    });
    // Nothing else edits the card: the reply is queued all the same.
    expect((await sweep()).followups).toBe(1);
    const reply = await notice("kickoff:kickupsil001:updated");
    expect(reply).toMatchObject({
      kind: "kickoff.updated",
      parent_id: late.id,
      state: "queued",
    });
    const thread = await claim(reply.id);
    expect(thread.rows[0]).toMatchObject({
      threadTs: "1792900710.000810",
      target: CSM_GENERAL,
    });
    await result(reply.id, "posted", "1792900720.000820", CSM_GENERAL, null, {
      variant: "thread",
    });
    expect((await sweep()).followups).toBe(0);
  });

  test("a late notice the mirror was behind on gets its reply once the mirror shows the card done, with a card time before the alarm (X19)", async () => {
    const M = "taskV1";
    await onboard(
      M,
      "Vega Studio",
      kickoffForm("kickvega0001", ago(21)),
      "Onboarding Booked",
    );
    const late = await notice("kickoff:kickvega0001");
    const got = await claim(late.id);
    expect(got.rows[0].live).toMatchObject({ looksDone: false });
    await result(late.id, "posted", "1792900730.000830", CSM_GENERAL, null, {
      variant: "late",
      facts: {
        commentCheck: "found",
        looksDone: false,
        cardUpdatedAt: got.rows[0].live.cardUpdatedAt,
      },
    });
    // The card is not done yet: no reply.
    expect((await sweep()).followups).toBe(0);
    expect(await maybeNotice("kickoff:kickvega0001:updated")).toBeNull();
    // The next mirror run brings the card in as done, changed 6 minutes ago:
    // before the late notice posted.
    await q(
      "UPDATE public.cockpit_client_onboarding SET client_status='Brand Blueprint Booked', card_updated_at=now() - interval '6 minutes' WHERE clickup_task_id=$1",
      [M],
    );
    expect((await sweep()).followups).toBe(1);
    const reply = await notice("kickoff:kickvega0001:updated");
    expect(reply.parent_id).toBe(late.id);
    expect(Date.parse(reply.facts.cardUpdatedAt)).toBeLessThan(
      Date.parse((await notice("kickoff:kickvega0001")).finished_at),
    );
    expect((await sweep()).followups).toBe(0);
    await claim(reply.id);
    await result(reply.id, "posted", "1792900740.000840", CSM_GENERAL, null, {
      variant: "thread",
    });
  });

  test("an unknown reply is looked for where the claim sent it, even after its first notice posts later", async () => {
    const P = "taskP1";
    await press(
      "blueprintClose",
      P,
      "Pi Studio",
      ["done"],
      {},
      {
        kind: "blueprintClose",
        mapPhase: 4,
        mapSkipped: false,
      },
    );
    const close = await notice(`blueprint:${P}:close`);
    await claim(close.id);
    await result(
      close.id,
      "retry",
      null,
      null,
      "Slack asked the cockpit to slow down (try 3 of 3).",
      {},
    );
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
      [close.id],
    );
    await claim(close.id);
    await result(close.id, "retry", null, null, null, {});
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
      [close.id],
    );
    await claim(close.id);
    await result(close.id, "retry", null, null, null, {});
    expect((await notice(`blueprint:${P}:close`)).state).toBe("failed");
    // The offer goes top level, and Slack does not confirm it.
    await press("blueprintOffer", P, "Pi Studio", ["done"]);
    const offer = await notice(`blueprint:${P}:offer`);
    const top = await claim(offer.id);
    expect(top.rows[0]).toMatchObject({ threadTs: null, target: CSM_GENERAL });
    expect((await notice(`blueprint:${P}:offer`)).thread_ts).toBeNull();
    await result(
      offer.id,
      "unknown",
      null,
      null,
      "Slack did not confirm the post; it is not sent again in case it arrived.",
      {
        variant: "top",
      },
    );
    // The tech lead fixes the channel and requeues the close; it posts.
    await svc("SELECT public.cockpit_slack_notice_fix($1,'requeue',null) r", [
      close.id,
    ]);
    await claim(close.id);
    await result(close.id, "posted", "1792999999.000100", CSM_GENERAL, null, {
      variant: "done",
    });
    const out = await svc<Row[]>(
      "SELECT public.cockpit_slack_notice_unknowns(10) r",
    );
    expect(out.find(u => u.id === offer.id)).toMatchObject({
      channel: CSM_GENERAL,
      threadTs: null,
    });
    // A reply that did go in a thread keeps that thread.
    const reply = await notice("blueprint:taskR1:updated");
    expect(reply.thread_ts).toBe("1792872070.187739");
    await q(
      "UPDATE public.cockpit_slack_notices SET checked_at=now() WHERE id=$1",
      [offer.id],
    );
  });
});

describe("reading a card's notices", () => {
  const READ = "SELECT public.cockpit_slack_notice_read($1) r";
  const VIEW_KEYS = [
    "at",
    "channel",
    "dueAt",
    "id",
    "kind",
    "outboxId",
    "parentKind",
    "permalink",
    "reason",
    "responseId",
    "state",
    "variant",
  ];

  test("the client's CSM sees its notices, newest first, without text, blocks or facts", async () => {
    const r = await one<Row>(CSM_A, READ, [A]);
    expect(r.taskId).toBe(A);
    expect(typeof r.now).toBe("string");
    expect(r.notices.map((n: Row) => n.kind)).toEqual([
      "blueprint.close",
      "kickoff",
      "kickoff",
    ]);
    for (const n of r.notices) expect(Object.keys(n).sort()).toEqual(VIEW_KEYS);
    const [typeform, second, first] = r.notices;
    // Not claimed yet: it names where it is set to post now.
    expect(typeform).toMatchObject({
      state: "queued",
      reason: "Queued.",
      responseId: "bpacme00001",
      channel: { id: CSM_GENERAL, name: "csm-general" },
    });
    expect(first).toMatchObject({
      state: "posted",
      channel: { id: CSM_GENERAL, name: "csm-general" },
      reason: null,
    });
    expect(second).toMatchObject({
      state: "failed",
      reason:
        "Checked by a person: not in Slack. Looked in #csm-general for the Ref.",
    });
    const text = JSON.stringify(r);
    for (const secret of [
      "Kickoff complete",
      "commentCheck",
      "mrkdwn",
      "submittedAt",
    ])
      expect(text).not.toContain(secret);
    // A rehearsal may carry a card ID; the read still never shows it.
    await q(
      "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,task_id,target,facts) VALUES('rehearsal','rehearsal:on-card',$1,'U0CSMAAAA1',$2::jsonb)",
      [A, JSON.stringify({ of: "kickoff", sample: true, requestedBy: "cron" })],
    );
    const again = await one<Row>(CSM_A, READ, [A]);
    expect(again.notices.length).toBe(3);
    expect(again.notices.map((n: Row) => n.kind)).not.toContain("rehearsal");
    await claim((await notice("rehearsal:on-card")).id);
    await result(
      (await notice("rehearsal:on-card")).id,
      "failed",
      null,
      null,
      "Test cleared.",
    );
  });

  test("a queued kickoff says what it waits for and when it is due", async () => {
    const r = await one<Row>(CSM_A, READ, [C]).catch(() => null);
    expect(r).toBeNull(); // Gamma is not on the Acme CSM's list
    const g = await one<Row>(CEO, READ, [C]);
    expect(g.notices[0]).toMatchObject({
      kind: "kickoff",
      state: "queued",
      reason: "Waiting for Make to update the card.",
    });
    const kick = await notice("kickoff:kickgamma001");
    expect(Date.parse(g.notices[0].dueAt)).toBe(
      Date.parse(kick.facts.submittedAt) + 20 * 60_000,
    );
    // Its channel is the one Settings names now (D17): an editor's move
    // shows on every screen before the notice is claimed.
    expect(kick.target).toBeNull();
    expect(g.notices[0].channel).toEqual({
      id: CSM_GENERAL,
      name: "csm-general",
    });
    await q(
      "UPDATE public.cockpit_slack_notice_settings SET channel=$1 WHERE kind='kickoff'",
      [MEDIA_GENERAL],
    );
    try {
      const moved = await one<Row>(CEO, READ, [C]);
      expect(moved.notices[0].channel).toEqual({
        id: MEDIA_GENERAL,
        name: "media-general",
      });
    } finally {
      await q(
        "UPDATE public.cockpit_slack_notice_settings SET channel=$1 WHERE kind='kickoff'",
        [CSM_GENERAL],
      );
    }
  });

  test("another CSM, a creative seat without the client and a media buyer are refused; the creative seat with it, the CEO and an admin read", async () => {
    expect(await refused(CSM_B, READ, [A])).toContain(
      "That client is not on your access list",
    );
    expect(await refused(CREATIVE_B, READ, [A])).toContain(
      "That client is not on your access list",
    );
    expect(await refused(BUYER, READ, [A])).toContain(
      "That client is not on your access list",
    );
    expect(await refused(GONE, READ, [A])).toContain(
      "That client is not on your access list",
    );
    expect(await refused(null, READ, [A])).toContain("permission denied");
    expect(await refused(CSM_A, READ, ["bad id!"])).toContain(
      "Choose a valid ClickUp client ID",
    );
    expect((await one<Row>(CREATIVE, READ, [A])).notices.length).toBe(3);
    expect(
      (await one<Row>(CREATIVE_B, READ, [B])).notices.length,
    ).toBeGreaterThan(0);
    expect((await one<Row>(CEO, READ, [A])).notices.length).toBe(3);
    expect((await one<Row>(ADMIN, READ, [A])).notices.length).toBe(3);
    // A card that is not in the mirror: the creative seat is checked on the newest notice's client.
    expect(
      (await one<Row>(CREATIVE, READ, ["taskO1"])).notices.map(
        (n: Row) => n.kind,
      ),
    ).toEqual(["blueprint.offer"]);
    expect(await refused(CREATIVE_B, READ, ["taskO1"])).toContain(
      "not on your access list",
    );
    // The CSM gate's own words for a CSM seat.
    expect(await refused(CSM_A, READ, ["taskO1"])).toContain(
      "missing or ambiguous",
    );
  });
});

describe("notices and routing settings (D17)", () => {
  test("a client success or creative seat reads the card without edit rights; others are refused", async () => {
    const r = await settingsRead(CSM_A);
    expect(r.can).toEqual({ edit: false, editors: false });
    expect(r.people).toEqual([]);
    expect(r.editors).toEqual([]);
    expect(r.members).toEqual([]);
    expect(r.notices.map((n: Row) => n.kind)).toEqual([
      "kickoff",
      "kickoff.late",
      "kickoff.second",
      "kickoff.updated",
      "blueprint.close",
      "blueprint.updated",
      "blueprint.media",
      "blueprint.offer",
    ]);
    const byKind = Object.fromEntries(r.notices.map((n: Row) => [n.kind, n]));
    expect(byKind.kickoff).toMatchObject({
      shape: "post",
      on: true,
      fixedOn: false,
      channel: { id: CSM_GENERAL, name: "csm-general" },
      mentionRule: ["seat:creative"],
      mentionPeople: [],
      tags: [{ rule: "seat:creative", found: true, slackKnown: true }],
      updatedBy: "the migration",
    });
    // The newest kickoff (two made by one sweep share a time; the id breaks the tie).
    const newest = (
      await q(
        "SELECT facts->>'responseId' AS rid FROM public.cockpit_slack_notices WHERE kind='kickoff' ORDER BY created_at DESC, id LIMIT 1",
      )
    )[0].rid;
    expect([
      "kickfresh001",
      "kickkappa002",
      "kicklambda01",
      "kickupsil001",
      "kickvega0001",
    ]).toContain(newest);
    expect(byKind.kickoff.last.responseId).toBe(newest);
    expect(byKind["kickoff.late"]).toMatchObject({
      shape: "variant",
      fixedOn: true,
      channel: null,
    });
    expect(byKind["kickoff.late"].last.responseId).toBe(
      (
        await q(
          "SELECT facts->>'responseId' AS rid FROM public.cockpit_slack_notices WHERE kind='kickoff' AND variant='late' ORDER BY created_at DESC, id LIMIT 1",
        )
      )[0].rid,
    );
    expect(byKind["kickoff.second"].last.kind).toBe("kickoff");
    expect(byKind["kickoff.updated"]).toMatchObject({
      shape: "reply",
      channel: null,
      mentionRule: [],
      tags: [],
    });
    expect(byKind["blueprint.media"].updatedBy).toBe("the CEO");
    expect(r.channels.map((c: Row) => [c.id, c.state, c.inUse])).toEqual([
      [CSM_GENERAL, "ok", true],
      [MEDIA_GENERAL, "ok", true],
    ]);
    expect(r.test).toBeNull();
    expect((await settingsRead(CREATIVE)).can.edit).toBe(false);
    expect(
      await refused(
        BUYER,
        "SELECT public.cockpit_slack_notice_settings_read()",
      ),
    ).toContain(
      "Current confirmed client-success or creative access is required",
    );
    expect(
      await refused(
        EDITOR_ROW,
        "SELECT public.cockpit_slack_notice_settings_read()",
      ),
    ).toContain("client-success or creative");
    expect(
      await refused(GONE, "SELECT public.cockpit_slack_notice_settings_read()"),
    ).toContain("client-success or creative");
  });

  test("the editor gate refuses a CSM seat and allows the CEO, an admin and a forms_editor role", async () => {
    const words =
      "Only the CEO, an admin or someone they add can change notices and routing.";
    expect(await settingsRefused(CSM_A, "kickoff", { on: true })).toContain(
      words,
    );
    expect(await settingsRefused(BUYER, "kickoff", { on: true })).toContain(
      words,
    );
    expect(await settingsRefused(CREATIVE, "kickoff", { on: true })).toContain(
      words,
    );
    expect(
      await refused(CSM_A, "SELECT public.cockpit_slack_channel_add($1,NULL)", [
        "C0SOMEWHERE1",
      ]),
    ).toContain(words);
    expect(
      await refused(
        CSM_A,
        "SELECT public.cockpit_slack_notice_rehearse('kickoff')",
      ),
    ).toContain(words);
    const ceo = await settingsRead(CEO);
    expect(ceo.can).toEqual({ edit: true, editors: true });
    expect(ceo.people.map((p: Row) => p.label)).toContain("Bilal, Media buyer");
    expect(ceo.people.map((p: Row) => p.label)).not.toContain(
      "Old, Media buyer",
    );
    expect(ceo.people.map((p: Row) => p.label)).not.toContain("No, Closer");
    expect((await settingsRead(ADMIN)).can).toEqual({
      edit: true,
      editors: true,
    });
    expect((await settingsRead(EDITOR_ROLE)).can).toEqual({
      edit: true,
      editors: false,
    });
    expect(
      (await settingsSet(EDITOR_ROLE, "kickoff.updated", { on: true })).can
        .edit,
    ).toBe(true);
  });

  test("every patch refusal says what to do", async () => {
    const cases: [string, unknown, string][] = [
      ["nope", { on: true }, "There is no notice called nope."],
      ["kickoff", [], "Send the changes as an object."],
      ["kickoff", { colour: "teal" }, "Unknown setting: colour."],
      ["kickoff", { on: "yes" }, "Send on as true or false."],
      [
        "kickoff.late",
        { on: false },
        "This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.",
      ],
      ["kickoff.second", { on: false }, "stays on"],
      [
        "blueprint.updated",
        { channel: CSM_GENERAL },
        "Replies post in their first notice's thread.",
      ],
      [
        "kickoff.late",
        { channel: CSM_GENERAL },
        "Replies post in their first notice's thread.",
      ],
      [
        "kickoff",
        { channel: "C0NOTLISTED1" },
        "Add that channel under Channels first; the cockpit checks the bot is in it.",
      ],
      ["kickoff", { channel: null }, "Add that channel under Channels first"],
      [
        "kickoff",
        { mentionRule: ["seat:ceo"] },
        "Choose who to tag from the list.",
      ],
      [
        "kickoff",
        { mentionRule: "seat:csm" },
        "Choose who to tag from the list.",
      ],
      ["kickoff", { mentionRule: [1] }, "Choose who to tag from the list."],
      [
        "kickoff",
        { mentionPeople: [people.left] },
        "Choose people from the team list.",
      ],
      [
        "kickoff",
        { mentionPeople: [people.noemail] },
        "Choose people from the team list.",
      ],
      [
        "kickoff",
        { mentionPeople: ["U0BUYERAA1"] },
        "Choose people from the team list.",
      ],
      [
        "kickoff",
        { mentionPeople: Array.from({ length: 11 }, (_, i) => 1000 + i) },
        "Choose people from the team list.",
      ],
    ];
    const before = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.setting'",
    );
    for (const [kind, patch, words] of cases)
      expect(await settingsRefused(CEO, kind, patch)).toContain(words);
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.setting'",
      ),
    ).toBe(before);
  });

  test("a change writes the row and one audit row with the old and new value; no change writes nothing", async () => {
    const r = await settingsSet(CEO, "kickoff", {
      mentionRule: ["seat:creative", "seat:csm", "seat:creative"],
    });
    const kickoff = r.notices.find((n: Row) => n.kind === "kickoff");
    expect(kickoff.mentionRule).toEqual(["seat:creative", "seat:csm"]);
    expect(kickoff.updatedBy).toBe("the CEO");
    expect(
      (
        await q(
          "SELECT updated_by FROM public.cockpit_slack_notice_settings WHERE kind='kickoff'",
        )
      )[0].updated_by,
    ).toBe("aziz@maharamedia.com");
    const audit = (
      await q(
        "SELECT * FROM public.cockpit_audit_log WHERE action='slack_notice.setting' AND entity_id='kickoff' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    expect(audit).toMatchObject({
      entity_type: "cockpit_slack_notice_settings",
      actor_email: "aziz@maharamedia.com",
      source_system: "supabase",
    });
    expect(audit.before.mention_rule).toEqual(["seat:creative"]);
    expect(audit.after.mention_rule).toEqual(["seat:creative", "seat:csm"]);
    expect(audit.before.updated_by).toBe("migration");
    const n = await count(
      "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.setting'",
    );
    await settingsSet(CEO, "kickoff", {
      mentionRule: ["seat:creative", "seat:csm"],
      on: true,
    });
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='slack_notice.setting'",
      ),
    ).toBe(n);
    await settingsSet(ADMIN, "kickoff", { mentionRule: ["seat:creative"] });
    expect((await settingsRead(CSM_A)).notices[0].updatedBy).toBe(
      "the systems manager",
    );
  });

  test("named people are tagged by their Slack id, resolved at send time", async () => {
    const r = await settingsSet(CEO, "blueprint.offer", {
      mentionPeople: [people.bilal, String(people.bilal), people.sara],
    });
    const offer = r.notices.find((n: Row) => n.kind === "blueprint.offer");
    // Sara has no Slack id yet, so the save queued a check for her (X4).
    expect(offer.mentionPeople).toEqual([
      {
        id: people.bilal,
        label: "Bilal, Media buyer",
        role: "the media buyer",
        slack: "ok",
        slackKnown: true,
      },
      {
        id: people.sara,
        label: "Sara, Client success manager",
        role: "the client success manager",
        slack: "checking",
        slackKnown: false,
      },
    ]);
    const dry = await svc<Row>(
      "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
      [
        JSON.stringify({
          kind: "blueprint.offer",
          taskId: B,
          facts: { taskId: B, client: "Beta Build" },
        }),
      ],
    );
    expect(
      dry.mentions.main.map((m: Row) => [m.rule, m.label, m.slackId, m.email]),
    ).toEqual([
      ["people", "the media buyer", "U0BUYERAA1", "buyer@tests.invalid"],
      ["people", "the client success manager", null, "csm-b@tests.invalid"],
    ]);
    await settingsSet(CEO, "blueprint.offer", { mentionPeople: [] });
  });

  test("a person an editor tags is checked in Slack by the sender; the card says what the next notice does with them", async () => {
    const PENDING = "SELECT public.cockpit_slack_person_pending() r";
    const CHECKED = "SELECT public.cockpit_slack_person_checked($1,$2,$3,$4) r";
    // The CEO has no Slack id row (contract section 10): choosing him queues
    // a check, as does Sara; Bilal's EOD radar id is already known.
    await settingsSet(CEO, "blueprint.offer", {
      mentionPeople: [people.aziz, people.sara, people.bilal],
    });
    expect(
      (await svc<Row[]>(PENDING)).map(p => [p.personId, p.email]).sort(),
    ).toEqual(
      [
        [people.aziz, "aziz@maharamedia.com"],
        [people.sara, "csm-b@tests.invalid"],
      ].sort(),
    );
    expect(await refused(CEO, PENDING)).toContain("permission denied");
    expect(
      await refused(CEO, CHECKED, [people.aziz, "ok", "U0CEOAAAA1", null]),
    ).toContain("permission denied");
    // A viewer reads the role, never the first name.
    const viewer = (await settingsRead(CSM_A)).notices.find(
      (n: Row) => n.kind === "blueprint.offer",
    );
    expect(
      viewer.mentionPeople.map((p: Row) => [p.label, p.role, p.slack]),
    ).toEqual([
      ["the CEO", "the CEO", "checking"],
      ["the client success manager", "the client success manager", "checking"],
      ["the media buyer", "the media buyer", "ok"],
    ]);
    expect(JSON.stringify(viewer)).not.toMatch(/Aziz|Sara|Bilal/);

    // The sender answers: the CEO is in Slack, Sara's address is not.
    expect(
      await svcRefused(CHECKED, [people.aziz, "ok", "not-an-id", null]),
    ).toContain("member ID");
    expect(
      await svc<Row>(CHECKED, [
        people.aziz,
        "ok",
        "U0CEOAAAA1",
        "Found in Slack.",
      ]),
    ).toMatchObject({ personId: people.aziz, state: "ok" });
    await svc<Row>(CHECKED, [
      people.sara,
      "not_found",
      null,
      "Slack has no member with the address on the team list.",
    ]);
    expect(await svc<Row[]>(PENDING)).toEqual([]);
    const after = (await settingsRead(CEO)).notices.find(
      (n: Row) => n.kind === "blueprint.offer",
    );
    expect(
      after.mentionPeople.map((p: Row) => [p.id, p.slack, p.slackKnown]),
    ).toEqual([
      [people.aziz, "ok", true],
      [people.sara, "not_found", false],
      [people.bilal, "ok", true],
    ]);
    const dry = await svc<Row>(
      "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
      [
        JSON.stringify({
          kind: "blueprint.offer",
          taskId: B,
          facts: { taskId: B, client: "Beta Build" },
        }),
      ],
    );
    expect(dry.mentions.main.map((m: Row) => [m.label, m.slackId])).toEqual([
      ["the CEO", "U0CEOAAAA1"],
      ["the client success manager", null],
      ["the media buyer", "U0BUYERAA1"],
    ]);
    const audit = (await audits(String(people.aziz))).filter(
      a => a.entity_type === "cockpit_slack_people",
    );
    expect(audit.map(a => [a.action, a.after?.state])).toEqual([
      ["slack_notice.person", "checking"],
      ["slack_notice.person", "ok"],
    ]);

    // Choosing Sara again asks Slack again (her address may have changed);
    // the CEO, now found, is not asked again.
    await settingsSet(CEO, "blueprint.offer", { mentionPeople: [] });
    await settingsSet(CEO, "blueprint.offer", {
      mentionPeople: [people.sara, people.aziz],
    });
    expect((await svc<Row[]>(PENDING)).map(p => p.personId)).toEqual([
      people.sara,
    ]);
    // A seat rule queues a check for whoever holds the seat without an id.
    await settingsSet(CEO, "blueprint.offer", { mentionPeople: [] });
    await q("DELETE FROM public.cockpit_slack_people");
    await settingsSet(CEO, "blueprint.offer", { mentionRule: ["seat:csm"] });
    expect((await svc<Row[]>(PENDING)).map(p => p.personId)).toEqual([
      people.sara,
    ]);
    const seat = (await settingsRead(CEO)).notices.find(
      (n: Row) => n.kind === "blueprint.offer",
    );
    expect(seat.tags).toEqual([
      { rule: "seat:csm", found: true, slackKnown: true, checking: true },
    ]);
    await settingsSet(CEO, "blueprint.offer", { mentionRule: [] });
    await q("DELETE FROM public.cockpit_slack_people");
  });

  test("channels: added as checking, checked by the sender, refused or ready, removed only when no notice posts there", async () => {
    const add = (who: string, id: string, name: string | null = null) =>
      one<Row>(who, "SELECT public.cockpit_slack_channel_add($1,$2) r", [
        id,
        name,
      ]);
    const addRefused = (id: string, name: string | null = null) =>
      refused(CEO, "SELECT public.cockpit_slack_channel_add($1,$2)", [
        id,
        name,
      ]);
    expect(await addRefused("not-an-id")).toContain(
      "Paste the channel's ID from Slack (it starts with C or G).",
    );
    expect(await addRefused("U0123456789")).toContain("Paste the channel's ID");
    expect(await addRefused("C0NEWCHAN01", "new chan")).toContain(
      "without spaces",
    );
    expect(await addRefused(CSM_GENERAL)).toContain(
      "That channel is already on the list.",
    );
    let r = await add(EDITOR_ROLE, " c0newchan01 ", "#new-chan");
    const chan = r.channels.find((c: Row) => c.id === "C0NEWCHAN01");
    expect(chan).toMatchObject({
      name: "new-chan",
      state: "checking",
      note: "Checking that mahara-club-bot is in it.",
      inUse: false,
    });
    expect(
      (
        await q(
          "SELECT added_by FROM public.cockpit_slack_channels WHERE id='C0NEWCHAN01'",
        )
      )[0].added_by,
    ).toBe("editor-role@tests.invalid");
    // A channel being checked cannot be chosen yet.
    expect(
      await settingsRefused(CEO, "kickoff", { channel: "C0NEWCHAN01" }),
    ).toContain("Add that channel under Channels first");
    expect(
      await svc<Row[]>("SELECT public.cockpit_slack_channel_pending() r"),
    ).toEqual([{ id: "C0NEWCHAN01", name: "new-chan" }]);
    const checked = await svc<Row>(
      "SELECT public.cockpit_slack_channel_checked('C0NEWCHAN01',false,'new-chan',false,'Invite @mahara-club-bot to #new-chan, then add it again.') r",
    );
    expect(checked).toMatchObject({
      id: "C0NEWCHAN01",
      state: "refused",
      private: false,
    });
    expect(
      await svc<Row[]>("SELECT public.cockpit_slack_channel_pending() r"),
    ).toEqual([]);
    r = await add(CEO, "C0NEWCHAN01");
    expect(r.channels.find((c: Row) => c.id === "C0NEWCHAN01").state).toBe(
      "checking",
    );
    await svc(
      "SELECT public.cockpit_slack_channel_checked('C0NEWCHAN01',true,NULL,NULL,'mahara-club-bot is in it.') r",
    );
    r = await settingsSet(CEO, "kickoff", { channel: "c0newchan01" });
    expect(r.notices[0].channel).toEqual({
      id: "C0NEWCHAN01",
      name: "new-chan",
    });
    expect(
      await refused(CEO, "SELECT public.cockpit_slack_channel_remove($1)", [
        "C0NEWCHAN01",
      ]),
    ).toContain(
      "The Kickoff complete notice posts there. Choose another channel for it first.",
    );
    expect(
      await refused(CEO, "SELECT public.cockpit_slack_channel_remove($1)", [
        MEDIA_GENERAL,
      ]),
    ).toContain("The Brand Blueprint completed, for media notice posts there.");
    await settingsSet(CEO, "kickoff", { channel: CSM_GENERAL });
    r = await one<Row>(
      CEO,
      "SELECT public.cockpit_slack_channel_remove($1) r",
      ["C0NEWCHAN01"],
    );
    expect(r.channels.map((c: Row) => c.id)).not.toContain("C0NEWCHAN01");
    expect(
      (
        await q(
          "SELECT state FROM public.cockpit_slack_channels WHERE id='C0NEWCHAN01'",
        )
      )[0].state,
    ).toBe("removed");
    expect(
      await refused(CEO, "SELECT public.cockpit_slack_channel_remove($1)", [
        "C0NEWCHAN01",
      ]),
    ).toContain("not on the list");
    expect(
      await settingsRefused(CEO, "kickoff", { channel: "C0NEWCHAN01" }),
    ).toContain("Add that channel under Channels first");
    // A removed channel stays removed when the sender reports on it.
    expect(
      (
        await svc<Row>(
          "SELECT public.cockpit_slack_channel_checked('C0NEWCHAN01',true,NULL,NULL,'x') r",
        )
      ).state,
    ).toBe("removed");
    const trail = await q(
      "SELECT after->>'state' AS s FROM public.cockpit_audit_log WHERE entity_id='C0NEWCHAN01' ORDER BY created_at",
    );
    expect(trail.map(t => t.s)).toEqual([
      "checking",
      "refused",
      "checking",
      "ok",
      "removed",
    ]);
  });

  test("only the CEO or an admin chooses the editors; a seat given the right can then edit", async () => {
    const editorRow = await memberId(EDITOR_ROW);
    const set = (who: string, id: string, on: boolean) =>
      one<Row>(who, "SELECT public.cockpit_forms_editor_set($1,$2) r", [
        id,
        on,
      ]);
    const words =
      "Only the CEO or an admin chooses who changes notices and routing.";
    expect(
      await refused(CSM_A, "SELECT public.cockpit_forms_editor_set($1,true)", [
        editorRow,
      ]),
    ).toContain(words);
    expect(
      await refused(
        EDITOR_ROLE,
        "SELECT public.cockpit_forms_editor_set($1,true)",
        [editorRow],
      ),
    ).toContain(words);
    expect(
      await refused(CEO, "SELECT public.cockpit_forms_editor_set($1,true)", [
        await memberId(GONE),
      ]),
    ).toContain("Choose an active seat.");
    expect(
      await refused(CEO, "SELECT public.cockpit_forms_editor_set($1,true)", [
        "00000000-0000-4000-8000-00000000beef",
      ]),
    ).toContain("Choose an active seat.");
    const before = await settingsRead(CEO);
    expect(before.members.map((m: Row) => m.memberId)).toContain(editorRow);
    expect(before.members.map((m: Row) => m.label)).not.toContain("Aziz, CEO");
    expect(before.members.map((m: Row) => m.memberId)).not.toContain(
      await memberId(ADMIN),
    );
    let r = await set(CEO, editorRow, true);
    expect(r.editors).toEqual([
      { memberId: editorRow, label: "Mona, Media buyer" },
    ]);
    expect(r.members.map((m: Row) => m.memberId)).not.toContain(editorRow);
    expect((await set(CEO, editorRow, true)).editors.length).toBe(1);
    const added = (await audits(editorRow)).filter(
      a => a.action === "forms.editor_added",
    );
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({
      entity_type: "cockpit_forms_editors",
      actor_email: "aziz@maharamedia.com",
    });
    // The media buyer seat may now read and change the settings.
    expect((await settingsRead(EDITOR_ROW)).can).toEqual({
      edit: true,
      editors: false,
    });
    expect(
      (await settingsSet(EDITOR_ROW, "blueprint.updated", { on: true })).can
        .edit,
    ).toBe(true);
    r = await set(ADMIN, editorRow, false);
    expect(r.editors).toEqual([]);
    expect((await audits(editorRow)).map(a => a.action)).toContain(
      "forms.editor_removed",
    );
    expect(
      await refused(
        EDITOR_ROW,
        "SELECT public.cockpit_slack_notice_settings_read()",
      ),
    ).toContain("client-success or creative");
    // The row comes back, so the rehearsal test can use this seat.
    await set(CEO, editorRow, true);
  });

  test("the right to change notices ends with the seat: re-adding the address later does not bring it back", async () => {
    const LEAVER = "00000000-0000-4000-8000-0000000000f5";
    await member(db, LEAVER, "leaver@tests.invalid", ["csm"]);
    const id = await memberId(LEAVER);
    await one<Row>(CEO, "SELECT public.cockpit_forms_editor_set($1,true) r", [
      id,
    ]);
    expect((await settingsRead(LEAVER)).can.edit).toBe(true);
    // The Admin page's remove: the seat is switched off and its roles cleared
    // (cockpit_admin_remove_member), the row kept.
    await actor(db, ADMIN);
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE public.cockpit_members SET active=false, roles='{}', updated_at=now() WHERE id=$1",
      [id],
    );
    await asOwner();
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_forms_editors WHERE member_id=$1",
        [id],
      ),
    ).toBe(0);
    const gone = (await audits(id)).filter(
      a => a.action === "forms.editor_removed",
    );
    expect(gone.length).toBe(1);
    expect(gone[0]).toMatchObject({
      actor_email: "sm@tests.invalid",
      metadata: { op: "delete", why: "seat_off" },
    });
    // Re-added months later with another role (cockpit_admin_upsert_member
    // keeps the id): no right comes back without a new grant.
    await q(
      "UPDATE public.cockpit_members SET active=true, roles=ARRAY['media_buyer'], updated_at=now() WHERE id=$1",
      [id],
    );
    expect(await memberId(LEAVER)).toBe(id);
    expect(await settingsRefused(LEAVER, "kickoff", { on: false })).toContain(
      "Only the CEO, an admin or someone they add",
    );
    expect(
      await refused(
        LEAVER,
        "SELECT public.cockpit_slack_channel_add('C0SOMEWHERE1',NULL)",
      ),
    ).toContain("Only the CEO, an admin or someone they add");
    expect(
      (await settingsRead(CEO)).editors.map((e: Row) => e.memberId),
    ).not.toContain(id);
    // A seat switched off for another reason, or a change that keeps it on,
    // leaves the other editors' rows alone.
    await q(
      "UPDATE public.cockpit_members SET name='Mona E', updated_at=now() WHERE auth_user_id=$1",
      [EDITOR_ROW],
    );
    expect(
      await count(
        "SELECT count(*) n FROM public.cockpit_forms_editors WHERE member_id=$1",
        [await memberId(EDITOR_ROW)],
      ),
    ).toBe(1);
  });
});

describe("send a test to me", () => {
  test("an editor queues one test at a time; the claim finds their Slack id or their address", async () => {
    const r = await one<Row>(
      ADMIN,
      "SELECT public.cockpit_slack_notice_rehearse('blueprint.close') r",
    );
    expect(r).toMatchObject({
      state: "queued",
      note: "Your test reaches your Slack direct messages within a minute.",
    });
    expect(
      await refused(
        ADMIN,
        "SELECT public.cockpit_slack_notice_rehearse('kickoff')",
      ),
    ).toContain(
      "A test is already on its way. Wait for it, then send another.",
    );
    expect(
      await refused(
        ADMIN,
        "SELECT public.cockpit_slack_notice_rehearse('kickoff.late')",
      ),
    ).toContain("There is no notice called");
    const row = (
      await q("SELECT * FROM public.cockpit_slack_notices WHERE id=$1", [r.id])
    )[0];
    expect(row).toMatchObject({
      kind: "rehearsal",
      task_id: null,
      target: null,
    });
    expect(row.facts).toEqual({
      of: "blueprint.close",
      variant: null,
      sample: true,
      requestedBy: ADMIN,
    });
    const got = await claim(r.id);
    expect(got.rows[0]).toMatchObject({
      kind: "rehearsal",
      target: "U0SYSMANA1",
      mentions: { main: [] },
      rehearsal: { of: "blueprint.close", lookupEmail: null },
      live: {},
    });
    expect(
      await resultRefused(r.id, "posted", "1792900400.000500", "C09RZ0GS0V9"),
    ).toContain("another channel");
    await result(r.id, "posted", "1792900400.000500", "D0SYSMANA12");
    const test_ = (await settingsRead(ADMIN)).test;
    expect(test_).toMatchObject({
      id: r.id,
      kind: "blueprint.close",
      state: "posted",
      reason: null,
    });
    // Nobody else sees it.
    expect((await settingsRead(CEO)).test).toBeNull();
    // A seat with no Slack id gets its address looked up by the sender.
    const t = await one<Row>(
      EDITOR_ROLE,
      "SELECT public.cockpit_slack_notice_rehearse(NULL) r",
    );
    const lookup = await claim(t.id);
    expect(lookup.rows[0]).toMatchObject({
      target: null,
      rehearsal: { of: "kickoff", lookupEmail: "editor-role@tests.invalid" },
    });
    const view = await result(
      t.id,
      "posted",
      "1792900500.000600",
      "D0EDITORR12",
      null,
      { target: "U0EDITORR12" },
    );
    expect(view.state).toBe("posted");
    expect(
      (
        await q("SELECT target FROM public.cockpit_slack_notices WHERE id=$1", [
          t.id,
        ])
      )[0].target,
    ).toBe("U0EDITORR12");
  });

  test("five tests an hour at most, and a test nobody can receive fails with a plain reason", async () => {
    for (let i = 0; i < 4; i++)
      await q(
        "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,facts,state) VALUES('rehearsal',$1,$2::jsonb,'skipped')",
        [
          `rehearsal:test-${i}`,
          JSON.stringify({ of: "kickoff", sample: true, requestedBy: ADMIN }),
        ],
      );
    expect(
      await refused(
        ADMIN,
        "SELECT public.cockpit_slack_notice_rehearse('kickoff')",
      ),
    ).toContain("That is five tests in an hour. Try again later.");
    const id = (
      await q<{ id: string }>(
        "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,facts) VALUES('rehearsal','rehearsal:nobody',$1::jsonb) RETURNING id",
        [
          JSON.stringify({
            of: "kickoff",
            sample: true,
            requestedBy: "00000000-0000-4000-8000-00000000f00d",
          }),
        ],
      )
    )[0].id;
    expect((await claim(id)).rows).toEqual([]);
    const row = (
      await q("SELECT * FROM public.cockpit_slack_notices WHERE id=$1", [id])
    )[0];
    expect(row.state).toBe("failed");
    expect(row.error).toBe(
      "No Slack account was found for you. Ask the tech lead to add your address to the team list.",
    );
  });

  test("the sender's own rehearsal goes to the member ID it was given", async () => {
    expect(
      await svcRefused(
        "SELECT public.cockpit_slack_notice_rehearse_service('kickoff','C09RZ0GS0V9')",
      ),
    ).toContain("Send a Slack member ID");
    expect(
      await svcRefused(
        "SELECT public.cockpit_slack_notice_rehearse_service('nope','U09305KE2KS')",
      ),
    ).toContain("There is no notice called nope.");
    const r = await svc<Row>(
      "SELECT public.cockpit_slack_notice_rehearse_service(NULL,'U09305KE2KS') r",
    );
    const row = (
      await q("SELECT * FROM public.cockpit_slack_notices WHERE id=$1", [r.id])
    )[0];
    expect(row).toMatchObject({
      kind: "rehearsal",
      target: "U09305KE2KS",
      state: "queued",
    });
    expect(row.facts).toEqual({
      of: "kickoff",
      variant: null,
      sample: true,
      requestedBy: "cron",
    });
    const got = await claim(r.id);
    expect(got.rows[0]).toMatchObject({
      target: "U09305KE2KS",
      rehearsal: { of: "kickoff", lookupEmail: null },
    });
    await result(r.id, "posted", "1792900600.000700", "D09305KE2KS");
    // A rehearsal can never be pointed at a channel.
    expect(
      await ownerRefused(
        "INSERT INTO public.cockpit_slack_notices(kind,dedupe_key,target) VALUES('rehearsal','rehearsal:chan',$1)",
        [CSM_GENERAL],
      ),
    ).toContain("check");
  });
});

describe("mentions and role labels", () => {
  const mentions = (
    rules: string[],
    peopleIds: number[],
    client: string | null,
  ) =>
    q<{ m: Row[] }>(
      "SELECT public.cockpit_slack_notice_mentions($1::text[],$2::bigint[],$3) m",
      [rules, peopleIds, client],
    ).then(r => r[0].m);

  test("each seat rule resolves to the seats of that client, with their Slack id or their address", async () => {
    expect(await mentions(["seat:creative"], [], "Acme Interiors")).toEqual([
      {
        rule: "seat:creative",
        personId: people.omar,
        label: "the creative director",
        slackId: "U0CREATIV1",
        email: "creative@tests.invalid",
        missing: false,
      },
    ]);
    expect(await mentions(["seat:creative"], [], "beta build ")).toEqual([
      {
        rule: "seat:creative",
        personId: people.omar,
        label: "the creative director",
        slackId: "U0CREATIV1",
        email: "creative@tests.invalid",
        missing: false,
      },
      {
        rule: "seat:creative",
        personId: null,
        label: "the creative director",
        slackId: null,
        email: "creative-b@tests.invalid",
        missing: false,
      },
    ]);
    expect(await mentions(["seat:csm"], [], "Beta Build")).toEqual([
      {
        rule: "seat:csm",
        personId: people.sara,
        label: "the CSM",
        slackId: null,
        email: "csm-b@tests.invalid",
        missing: false,
      },
    ]);
    // No client: every seat counts (the doctor's view).
    expect(
      (await mentions(["seat:csm"], [], null)).map(m => m.personId).sort(),
    ).toEqual([people.noura, people.sara].sort());
  });

  test("the systems manager comes from the people list by role, although the seat is an admin", async () => {
    expect(
      await mentions(["seat:systems_manager"], [], "Acme Interiors"),
    ).toEqual([
      {
        rule: "seat:systems_manager",
        personId: people.huda,
        label: "the systems manager",
        slackId: "U0SYSMANA1",
        email: "sm@tests.invalid",
        missing: false,
      },
    ]);
  });

  test("a rule that finds nobody, and a person no longer active, are marked missing; repeats are dropped", async () => {
    expect(await mentions(["seat:csm"], [], "Nobody Client")).toEqual([
      {
        rule: "seat:csm",
        personId: null,
        label: "the CSM",
        slackId: null,
        email: null,
        missing: true,
      },
    ]);
    expect(
      await mentions(
        ["seat:csm", "seat:csm"],
        [people.noura, people.left],
        "Acme Interiors",
      ),
    ).toEqual([
      {
        rule: "seat:csm",
        personId: people.noura,
        label: "the CSM",
        slackId: "U0CSMAAAA1",
        email: "csm-a@tests.invalid",
        missing: false,
      },
      {
        rule: "people",
        personId: people.left,
        label: "a team member",
        slackId: null,
        email: null,
        missing: true,
      },
    ]);
    expect((await mentions([], [people.aziz], null))[0]).toMatchObject({
      rule: "people",
      label: "the CEO",
      slackId: null,
    });
    expect(await mentions([], [], "Acme Interiors")).toEqual([]);
  });

  test("role labels name the seat, never the person", async () => {
    const role = async (email: string | null) =>
      (
        await q<{ r: string | null }>(
          "SELECT public.cockpit_slack_notice_role_of($1) r",
          [email],
        )
      )[0].r;
    expect(await role("Aziz@MaharaMedia.com ")).toBe("the CEO");
    expect(await role("sm@tests.invalid")).toBe("the systems manager");
    expect(await role("csm-a@tests.invalid")).toBe("the CSM");
    expect(await role("creative-b@tests.invalid")).toBe(
      "the creative director",
    );
    expect(await role("buyer@tests.invalid")).toBe("the media buyer");
    expect(await role("editor-role@tests.invalid")).toBe("a team member");
    expect(await role("stranger@tests.invalid")).toBe("a team member");
    expect(await role(null)).toBeNull();
  });
});

describe("the dry run, the doctor's inputs and the kick", () => {
  test("a dry run builds the claim's inputs and writes nothing", async () => {
    const before = await notices();
    const k = await svc<Row>(
      "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
      [JSON.stringify({ responseId: "kickgamma001" })],
    );
    expect(k).toMatchObject({
      kind: "kickoff",
      taskId: C,
      clientName: "Gamma Design",
      ref: "CN-dryrun00",
      target: CSM_GENERAL,
      threadTs: null,
    });
    expect(k.facts).toMatchObject({ responseId: "kickgamma001", second: true });
    expect(k.live).toMatchObject({ looksDone: false, filledByRole: "the CSM" });
    expect(Object.keys(k.mentions).sort()).toEqual(["late", "main", "second"]);
    await q(
      "INSERT INTO public.cockpit_csm_calls(source,source_id,task_id,client_name,kind,starts_at,status) VALUES('manual','launch-b1',$1,'Beta Build','launch',now() + interval '3 days','booked')",
      [B],
    );
    const close = await svc<Row>(
      "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
      [
        JSON.stringify({
          kind: "blueprint.close",
          taskId: B,
          facts: { taskId: B, client: "Beta Build", settled: "done" },
          variant: "done",
        }),
      ],
    );
    expect(close).toMatchObject({
      kind: "blueprint.close",
      clientName: "Beta Build",
      target: CSM_GENERAL,
    });
    expect(Date.parse(close.live.launchCallAt)).toBeGreaterThan(
      Date.now() + 2 * 86_400_000,
    );
    expect(close.mentions.main.map((m: Row) => m.email)).toEqual([
      "csm-b@tests.invalid",
    ]);
    const media = await svc<Row>(
      "SELECT public.cockpit_slack_notice_inputs($1::jsonb) r",
      [
        JSON.stringify({
          kind: "blueprint.media",
          taskId: "taskZ1",
          facts: { client: "Zeta" },
        }),
      ],
    );
    expect(media).toMatchObject({
      target: MEDIA_GENERAL,
      clientName: "Zeta",
      live: { clientStatus: null },
    });
    expect(
      await svcRefused("SELECT public.cockpit_slack_notice_inputs($1::jsonb)", [
        JSON.stringify({ responseId: "nope00000000" }),
      ]),
    ).toContain("No kickoff with that response ID is in the mirror.");
    expect(
      await svcRefused("SELECT public.cockpit_slack_notice_inputs($1::jsonb)", [
        JSON.stringify({ kind: "rehearsal", taskId: B, facts: {} }),
      ]),
    ).toContain("There is no notice called rehearsal.");
    expect(
      await svcRefused("SELECT public.cockpit_slack_notice_inputs($1::jsonb)", [
        JSON.stringify({ kind: "kickoff", taskId: B, facts: [] }),
      ]),
    ).toContain("Send the facts as an object");
    expect(
      await svcRefused("SELECT public.cockpit_slack_notice_inputs($1::jsonb)", [
        JSON.stringify({ job: "dryRun" }),
      ]),
    ).toContain('Send {"responseId"');
    expect(await notices()).toBe(before);
  });

  test("the doctor's inputs list the live channels and every setting's tags", async () => {
    const d = await svc<Row>(
      "SELECT public.cockpit_slack_notice_doctor_inputs() r",
    );
    expect(d.channels.map((c: Row) => c.id)).toEqual([
      CSM_GENERAL,
      MEDIA_GENERAL,
    ]);
    expect(d.settings.length).toBe(8);
    const late = d.settings.find((s: Row) => s.kind === "kickoff.late");
    expect(late.mentions.map((m: Row) => m.label)).toEqual([
      "the CSM",
      "the CSM",
      "the systems manager",
    ]);
    expect(
      d.settings.find((s: Row) => s.kind === "blueprint.media").mentions,
    ).toEqual([]);
  });

  test("the kick sweeps, posts nothing without the vault, and says so; with nothing due it says that", async () => {
    const r = await q<{ r: string | null }>(
      "SELECT public.cockpit_slack_notices_kick() r",
    );
    expect(r[0].r).toBeNull();
    let state = (
      await q(
        "SELECT * FROM public.cockpit_sync_state WHERE key='slack-notices-kick'",
      )
    )[0];
    expect(state.ok).toBe(false);
    expect(state.note).toBe(
      "The vault has no cockpit_notices_cron_secret, so the Slack notices did not run. Add it to the vault.",
    );
    // Nothing due, no unknown to look for, no channel being checked.
    await q(
      "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() + interval '1 hour' WHERE state='queued'",
    );
    await q(
      "UPDATE public.cockpit_slack_notices SET checked_at=now() WHERE state='unknown'",
    );
    expect(
      (
        await q<{ r: string | null }>(
          "SELECT public.cockpit_slack_notices_kick() r",
        )
      )[0].r,
    ).toBeNull();
    state = (
      await q(
        "SELECT * FROM public.cockpit_sync_state WHERE key='slack-notices-kick'",
      )
    )[0];
    expect(state).toMatchObject({ ok: true, note: "Nothing to send" });
    // A person an editor tagged, waiting for the sender's Slack check, is work.
    await q(
      "INSERT INTO public.cockpit_slack_people(person_id,state,requested_by) VALUES($1,'checking','test')",
      [people.sara],
    );
    await q("SELECT public.cockpit_slack_notices_kick()");
    state = (
      await q(
        "SELECT * FROM public.cockpit_sync_state WHERE key='slack-notices-kick'",
      )
    )[0];
    expect(state.ok).toBe(false);
    await q("DELETE FROM public.cockpit_slack_people");
    expect(
      await count("SELECT count(*) n FROM pg_proc WHERE proname='schedule'"),
    ).toBe(0);
  });

  test("with the vault and pg_net it posts one run to cockpit-notices, with the anon key only when the vault has it", async () => {
    const kick = async () =>
      (
        await q<{ r: string | null }>(
          "SELECT public.cockpit_slack_notices_kick() r",
        )
      )[0].r;
    const note = async () =>
      (
        await q(
          "SELECT ok, note, last_ok_at FROM public.cockpit_sync_state WHERE key='slack-notices-kick'",
        )
      )[0];
    await asOwner();
    await db.exec(`
      CREATE SCHEMA vault;
      CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY, decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES ('cockpit_notices_cron_secret','test-notices-secret');`);
    try {
      const due = await notice("kickoff:kickfresh001");
      await q(
        "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() WHERE id=$1",
        [due.id],
      );
      expect(await kick()).toBeNull();
      expect(await note()).toMatchObject({
        ok: false,
        note: "pg_net is not installed, so the Slack notices did not run.",
      });
      await db.exec(`
        CREATE SCHEMA net;
        CREATE TABLE net.calls(url text, body jsonb, headers jsonb, timeout_ms integer);
        CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint
          LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (url, body, headers, timeout_milliseconds); SELECT 42::bigint $$;`);
      expect(Number(await kick())).toBe(42);
      const posted = await note();
      expect(posted).toMatchObject({ ok: true, note: "Posted a notices run" });
      expect(posted.last_ok_at).not.toBeNull();
      await db.exec(
        "INSERT INTO vault.decrypted_secrets VALUES ('cockpit_anon_key','test-anon-key')",
      );
      expect(Number(await kick())).toBe(42);
      const calls = (
        await db.query<Row>(
          "SELECT url, body, headers, timeout_ms FROM net.calls",
        )
      ).rows;
      const url =
        "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-notices";
      expect(calls).toEqual([
        {
          url,
          body: { job: "run" },
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": "test-notices-secret",
          },
          timeout_ms: 5000,
        },
        {
          url,
          body: { job: "run" },
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": "test-notices-secret",
            Authorization: "Bearer test-anon-key",
          },
          timeout_ms: 5000,
        },
      ]);
      // The secret never lands in the note or the audit log.
      expect(
        JSON.stringify(await q("SELECT * FROM public.cockpit_sync_state")),
      ).not.toContain("test-notices-secret");
      expect(
        await count(
          "SELECT count(*) n FROM public.cockpit_audit_log WHERE after::text LIKE '%test-notices-secret%'",
        ),
      ).toBe(0);
    } finally {
      await asOwner();
      await db.exec(
        "DROP SCHEMA IF EXISTS net CASCADE; DROP SCHEMA IF EXISTS vault CASCADE;",
      );
      await q(
        "UPDATE public.cockpit_slack_notices SET next_attempt_at=now() + interval '1 hour' WHERE state='queued'",
      );
    }
  });

  test("applying the file again keeps every row, every edited setting and every grant", async () => {
    const before = await notices();
    const setting = (
      await q(
        "SELECT * FROM public.cockpit_slack_notice_settings WHERE kind='kickoff'",
      )
    )[0];
    await asOwner();
    await db.exec(migration(FILE));
    expect(await notices()).toBe(before);
    expect(
      (
        await q(
          "SELECT * FROM public.cockpit_slack_notice_settings WHERE kind='kickoff'",
        )
      )[0],
    ).toEqual(setting);
    expect(
      (
        await q<{ ok: boolean }>(
          "SELECT has_table_privilege('authenticated','public.cockpit_slack_notices','SELECT') ok",
        )
      )[0].ok,
    ).toBe(false);
    expect((await settingsRead(CSM_A)).notices.length).toBe(8);
  });
});
