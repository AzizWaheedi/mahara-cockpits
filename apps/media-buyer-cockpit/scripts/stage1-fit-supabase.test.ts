/**
 * Stage 1 fit (docs/forms/STAGE1-CONTRACT.md section 9, the orchestrator's
 * read): the two Stage 1 migrations together, 20261025n_slack_notices.sql
 * then 20261025o_blueprint_close_drain.sql, applied twice in that order on
 * one database over 20261024a_brand_blueprints.sql, and every piece that
 * crosses a builder's boundary driven through its real code:
 *
 *   the mirror's kickoff and the creative director's presses (real SQL)
 *   -> the queue triggers (20261025n)
 *   -> the cockpit-notices sender (real run.ts and send.ts, fake Slack and
 *      ClickUp, receipts into the provider ledger)
 *   -> the browsers' own zod-parsed calls: the client success cockpit's
 *      lib/notices.ts and kickoff trail, the creative director's
 *      lib/notices.ts and lib/blueprint.ts (blueprintCall, attempts).
 *
 * The other suites test each piece against its own contract with stand-ins;
 * this one only checks that the pieces fit. PGlite has no pg_cron, vault or
 * pg_net: the guarded blocks skip, and the kicks write their notes. Every
 * client, person and card is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { runNotices } from "../../../supabase/functions/cockpit-notices/run";
import type { NoticeDeps } from "../../../supabase/functions/cockpit-notices/send";
import * as kit from "../../../supabase/functions/cockpit-notices/testkit";
import {
  sendNotice,
  slackStop,
} from "../../client-success-cockpit/src/forms/formStatus";
import { KICKOFF } from "../../client-success-cockpit/src/forms/kickoff";
import * as BS from "../../client-success-cockpit/src/lib/blueprintStatus";
import * as CSN from "../../client-success-cockpit/src/lib/notices";
import * as CDB from "../../creative-director-cockpit/src/lib/blueprint";
import * as CDN from "../../creative-director-cockpit/src/lib/notices";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

// Keep direct, ship and readiness runs consistent on busy build hosts.
// Every SQL assertion still runs, with a finite per-test allowance.
setDefaultTimeout(120_000);

const NOTICES = "20261025n_slack_notices.sql";
const DRAIN = "20261025o_blueprint_close_drain.sql";

const CEO = "00000000-0000-4000-8000-0000000000c3";
const ADMIN = "00000000-0000-4000-8000-0000000000d1"; // admin seat, the systems manager
const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // csm, Acme only
const CREATIVE = "00000000-0000-4000-8000-0000000000e1"; // creative, every client

const A = "taskA1"; // Acme Interiors
const C = "taskC1"; // Gamma Design: a press nobody finished
const S1 = "sessionFITAAAAAAAAAAA1";
const RID = "kickacmefit01";
const NEW_CHANNEL = "C0NEWCHAN01";
// The review fixes' cards (2026-10-26): each its own invented client.
const D = "taskD1"; // Delta Studio: a late kickoff and its reply
const E = "taskE1"; // Echo Build: Make wrote its comment and stopped
const F = "taskF1"; // Foxtrot Build: a reply that went top level
const G = "taskG1"; // Golf Homes: already live at the close
const RID_D = "kickdeltafit1";
const RID_E = "kickechofit01";
const MEDIA = "00000000-0000-4000-8000-0000000000f1"; // media buyer, every client

const PART1 = {
  service: "interior",
  capacity: "tight",
  capacity_note: "Two site teams busy until December",
  starter: "yes",
  pack_url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv",
  pack_approval: "on_call",
  daily_budget: { usd: 40, said: "$50 a day" },
  destination: "lead_form",
  identity: "their_page",
  red_lines: ["No before and after photos"],
};
const PART2 = {
  best_client: "Villa owners renovating a whole floor (example)",
  method: "Site visit, concept, 3D, then build (example)",
  pricing: "By square metre (example)",
  minimum: { amount: 3000, currency: "KWD" },
  anchor: { amount: 12000, currency: "KWD" },
  competitors: [{ name: "Example Studio", lose: true }],
  approval: "first_batch",
  dna_status: "complete",
  rules: { always: ["The logo at the end"], never: ["No prices on screen"] },
  camera: "yes_phone",
  readback_yes: true,
};
const OFFER = {
  offer: {
    name: "The Site Visit (example)",
    what: "A measured plan",
    firstStep: "A free visit by the lead designer",
  },
};

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
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await asOwner();
  return (await db.query<T>(text, params)).rows;
}
const uuid = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// supabase-js over this database: rpc(name, args) in named notation, as
// PostgREST calls it, run as the seat.
const CAST: Record<string, string> = {
  p_task_ids: "text[]",
  p_changes: "jsonb",
  p_patch: "jsonb",
  p_member_id: "uuid",
  p_on: "boolean",
  p_base_revision: "integer",
  p_part: "integer",
  p_request_id: "uuid",
};
const client = (who: string) => ({
  rpc: async (name: string, args: Record<string, unknown> = {}) => {
    const keys = Object.keys(args);
    const sql = `SELECT public.${name}(${keys
      .map((k, i) => `${k} => $${i + 1}::${CAST[k] ?? "text"}`)
      .join(", ")}) r`;
    const params = keys.map(k =>
      CAST[k] === "jsonb" ? JSON.stringify(args[k]) : args[k],
    );
    await actor(db, who);
    try {
      return {
        data: (await db.query<{ r: unknown }>(sql, params)).rows[0].r,
        error: null,
      };
    } catch (e) {
      const x = e as Error & { detail?: string; code?: string };
      return {
        data: null,
        error: {
          message: x.message,
          details: x.detail ?? null,
          code: x.code ?? null,
        },
      };
    } finally {
      await asOwner();
    }
  },
});

// The sender's database door: the service role, named arguments.
async function rpcAsService(name: string, args: Record<string, unknown>) {
  await asOwner();
  await db.exec("SET ROLE service_role");
  const keys = Object.keys(args);
  const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS r`;
  try {
    const res = await db.query<{ r: unknown }>(
      sql,
      keys.map(k => {
        const v = args[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      }),
    );
    return res.rows[0].r;
  } finally {
    await asOwner();
  }
}
// Receipts go to the provider ledger as the service role, as restHealth does.
async function insertHealth(row: Record<string, unknown>) {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(
      "INSERT INTO public.cockpit_csm_provider_health(provider,method,resource,phase,http_status,object_id,action_id,run_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        row.provider,
        row.method,
        row.resource,
        row.phase,
        row.http_status,
        row.object_id,
        row.action_id,
        row.run_key,
      ],
    );
  } finally {
    await asOwner();
  }
}

let slack: kit.FakeSlack;
let clickup: kit.FakeClickUp;
let deps: NoticeDeps;
// A fresh fake Slack and ClickUp for each database.
function freshFakes() {
  slack = new kit.FakeSlack();
  slack.clock = () => Date.now();
  slack.dms.set("U0SYSMANA1", "D0SYSMDM001");
  clickup = new kit.FakeClickUp();
  const net = kit.fakeFetch(slack.route, clickup.route);
  deps = {
    rpc: rpcAsService,
    insertHealth: insertHealth as NoticeDeps["insertHealth"],
    fetch: net.request,
    now: () => new Date(),
    sleep: async () => {},
    slackToken: () => "xoxb-test",
    clickupToken: () => "pk_test",
    botUser: () => kit.BOT_USER,
    alertTo: () => "U09305KE2KS",
    secrets: () => ({
      SLACK_BOT_TOKEN: true,
      CLICKUP_API_TOKEN: true,
      NOTICES_CRON_SECRET: true,
    }),
  };
}
const notice = async (key: string) =>
  (
    await q("SELECT * FROM public.cockpit_slack_notices WHERE dedupe_key=$1", [
      key,
    ])
  )[0] ?? null;
const textOf = (channel: string, needle: string) =>
  (slack.messages.get(channel) ?? []).find(m =>
    String(m.text).includes(needle),
  ) ?? null;

// The creative API's settle (cockpit-creative-api/outbox.ts runClientAction):
// the claim, then the result and the settle time in one update.
async function settle(
  id: string,
  state: "done" | "reconcile",
  result: Row | null,
) {
  await asOwner();
  await db.exec("SET ROLE service_role");
  try {
    await db.query(
      "UPDATE public.cockpit_creative_outbox SET state='sending' WHERE id=$1 AND state='pending'",
      [id],
    );
    await db.query(
      state === "done"
        ? "UPDATE public.cockpit_creative_outbox SET state='done', result=$2::jsonb, settled_at=now() WHERE id=$1 AND state='sending'"
        : "UPDATE public.cockpit_creative_outbox SET state='reconcile', error=$2 WHERE id=$1 AND state='sending'",
      [
        id,
        state === "done" ? JSON.stringify(result) : "Read-back did not match",
      ],
    );
  } finally {
    await asOwner();
  }
}
async function save(values: Row, task = A) {
  const rev =
    (
      await q<{ r: number | null }>(
        "SELECT revision r FROM public.cockpit_blueprints WHERE task_id=$1",
        [task],
      )
    )[0]?.r ?? null;
  const changes = Object.fromEntries(
    Object.entries(values).map(([k, value]) => [k, { value, seen: null }]),
  );
  const out = await client(CREATIVE).rpc("cockpit_blueprint_save", {
    p_task_id: task,
    p_changes: changes,
    p_session: S1,
    p_base_revision: rev,
  });
  if (out.error) throw new Error(out.error.message);
}
async function pressPart(part: number, id: string, task = A) {
  const out = await client(CREATIVE).rpc("cockpit_blueprint_part_done", {
    p_task_id: task,
    p_part: part,
    p_request_id: id,
  });
  if (out.error) throw new Error(out.error.message);
  return out.data as Row;
}

// One more card on both rosters and in the onboarding mirror.
async function addClient(
  taskId: string,
  name: string,
  status: string,
  phase: number,
) {
  const snap = "2026-10-24T08:00:00Z";
  for (const table of ["cockpit_csm_sources", "cockpit_creative_sources"])
    await q(
      `INSERT INTO public.${table}(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)`,
      [
        `x-${taskId}`,
        [name],
        JSON.stringify({ _id: `x-${taskId}`, taskId, name }),
        snap,
      ],
    );
  // The client success gate counts the roster against its state row.
  for (const [state, table] of [
    ["cockpit_csm_source_state", "cockpit_csm_sources"],
    ["cockpit_creative_source_state", "cockpit_creative_sources"],
  ])
    await q(
      `UPDATE public.${state} SET row_count=(SELECT count(*) FROM public.${table} WHERE table_name='clients') WHERE table_name='clients'`,
    );
  await q(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,client_status,csm,links,forms,card_updated_at)
     VALUES($1,$2,$3,NULL,$4::jsonb,'{}'::jsonb, now() - interval '3 days')`,
    [
      taskId,
      name,
      status,
      JSON.stringify({
        onboarding_map: `https://mahara-onboarding-map.vercel.app/?phase=${phase}&cid=${taskId}`,
      }),
    ],
  );
}
// The mirror lists a kickoff submitted some minutes ago.
async function kickoffFor(taskId: string, rid: string, minutesAgo: number) {
  await q(
    "UPDATE public.cockpit_client_onboarding SET forms = jsonb_build_object('kickoff', $2::jsonb) WHERE clickup_task_id=$1",
    [
      taskId,
      JSON.stringify({
        form_id: "tG7dnxBn",
        response_id: rid,
        submitted_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        answers: [],
      }),
    ],
  );
}

async function build(files: readonly string[]) {
  freshFakes();
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // What 20261025n reads, from the canonical migrations.
  for (const [file, pattern, what] of [
    [
      "20260921e_tap_charges.sql",
      /create table if not exists public\.cockpit_sync_state \([\s\S]*?\n\);/,
      "sync state",
    ],
    [
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/,
      "people",
    ],
    [
      "20261015210000_eod_radar.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_eod_radar_slack_ids \([\s\S]*?\n\);/,
      "slack ids",
    ],
    [
      "20261005a_client_onboarding.sql",
      /create table if not exists public\.cockpit_client_onboarding \([\s\S]*?\n\);/,
      "onboarding",
    ],
    [
      "20261023a_csm_form_sends.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_form_sends \([\s\S]*?\n\);/,
      "form sends",
    ],
    [
      "20261011c_csm_call_store.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_calls\([\s\S]*?\n\);/,
      "calls",
    ],
  ] as const)
    await db.exec(cut(migration(file), pattern, what));

  // The client success roster and gate.
  const roster = migration("20260927v_csm_read_models.sql");
  for (const [pattern, what] of [
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "source state",
    ],
    [
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "source state rows",
    ],
    [
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "csm sources",
    ],
  ] as const)
    await db.exec(cut(roster, pattern, what));
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "owner allowed",
    ),
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  for (const [pattern, what] of [
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
      "gate for actor",
    ],
    [
      /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
      "gate",
    ],
    [
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ],
  ] as const)
    await db.exec(cut(gate, pattern, what));
  const teamOnly = migration("20261017b_team_only_seats.sql");
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\$\$;/,
      "team only",
    ),
  );
  await db.exec(
    cut(
      teamOnly,
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$function\$;/,
      "client allowed",
    ),
  );

  // The creative read models, outbox and client action, whole; what the
  // Blueprint migration reads beside them.
  await db.exec(migration("20260927s_creative_read_models.sql"));
  await db.exec(
    cut(
      migration("20261019120000_csm_decks.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_deck_prep \([\s\S]*?\n\);/,
      "deck prep",
    ),
  );
  await db.exec(
    cut(
      migration("20260927g_cockpit_media_actions.sql"),
      /CREATE TABLE public\.cockpit_media_actions \([\s\S]*?\n\);/,
      "media actions",
    ),
  );
  await db.exec(
    cut(
      migration("20261003a_client_logos.sql"),
      /CREATE TABLE IF NOT EXISTS public\.cockpit_client_logos \([\s\S]*?\n\);/,
      "client logos",
    ),
  );
  // Stand-ins with the live column names (checked 2026-10-22 and 2026-10-25).
  await db.exec(`
    CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, clickup_id text, country text, city text,
      language text, service_mode text);
    CREATE TABLE public.editor_clients(task_id text PRIMARY KEY, name text, dos_donts text, brand_dna_url text, brand_dna text,
      offer_url text, offer text, drive_url text, website text, instagram text, docs_read_at timestamptz, synced_at timestamptz);
    CREATE TABLE public.cockpit_csm_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid,
      method text NOT NULL, resource text NOT NULL, phase text NOT NULL, http_status integer, object_id text,
      created_at timestamptz NOT NULL DEFAULT now(), provider text NOT NULL DEFAULT 'clickup', run_key text);
    REVOKE ALL ON public.cockpit_sync_state, public.cockpit_people, public.cockpit_eod_radar_slack_ids,
      public.cockpit_client_onboarding, public.cockpit_csm_form_sends, public.cockpit_csm_calls,
      public.cockpit_csm_source_state, public.cockpit_csm_sources, public.cockpit_csm_deck_prep,
      public.cockpit_media_actions, public.cockpit_client_logos, public.ghl_clients, public.editor_clients,
      public.cockpit_csm_provider_health FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT ON public.cockpit_csm_provider_health TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.cockpit_media_actions TO service_role;`);

  // Seats, the roster and their Slack ids.
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, ADMIN, "sm@tests.invalid", ["admin"]);
  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
  await q(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CSM_A],
  );
  for (const [name, email, role, slackId] of [
    [
      "Noura Example",
      "csm-a@tests.invalid",
      "Client success manager",
      "U0CSMAAAA1",
    ],
    [
      "Omar Example",
      "creative@tests.invalid",
      "Creative director",
      "U0CREATIV1",
    ],
    ["Huda Example", "sm@tests.invalid", "Systems manager", "U0SYSMANA1"],
    ["Aziz Example", "aziz@maharamedia.com", "CEO", null],
  ] as const) {
    const id = (
      await q<{ id: number }>(
        "INSERT INTO public.cockpit_people(name,email,role,added_by) VALUES($1,$2,$3,'test') RETURNING id",
        [name, email, role],
      )
    )[0].id;
    if (slackId)
      await q(
        "INSERT INTO public.cockpit_eod_radar_slack_ids(person_id,slack_user_id,source,state) VALUES($1,$2,'manual','ok')",
        [id, slackId],
      );
  }
  const snap = "2026-10-24T08:00:00Z";
  for (const [taskId, name] of [
    [A, "Acme Interiors"],
    [C, "Gamma Design"],
  ]) {
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${taskId}`,
        [name],
        JSON.stringify({ _id: `c-${taskId}`, taskId, name }),
        snap,
      ],
    );
    await q(
      "INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `cl-${taskId}`,
        [name],
        JSON.stringify({ _id: `cl-${taskId}`, taskId, name }),
        snap,
      ],
    );
  }
  await q(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=$1 WHERE table_name='clients'",
    [snap],
  );
  await q(
    "UPDATE public.cockpit_creative_source_state SET ready=true,row_count=2,source_snapshot_at=$1 WHERE table_name='clients'",
    [snap],
  );
  // Acme is waiting for its kickoff; the Brand Blueprint call is held later.
  await q(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,client_status,csm,links,forms,card_updated_at)
     VALUES($1,'Acme Interiors','Onboarding Booked','noura example',$2::jsonb,'{}'::jsonb, now() - interval '3 days'),
           ($3,'Gamma Design','Brand Blueprint Booked♠️',NULL,'{}'::jsonb,'{}'::jsonb, now() - interval '3 days')`,
    [
      A,
      JSON.stringify({
        onboarding_map: `https://mahara-onboarding-map.vercel.app/?phase=4&cid=${A}`,
      }),
      C,
    ],
  );

  // The Blueprint record, then the Stage 1 migrations in the order given.
  await db.exec(migration("20261024a_brand_blueprints.sql"));
  for (const file of files) await db.exec(migration(file));
}

// Each Stage 1 migration applied twice, in order; and once each, in the order
// production applies them (the notices' functions then predate the outbox's
// new attempts column).
const ORDERS = [
  {
    name: "20261025n then 20261025o, each twice in order",
    files: [NOTICES, DRAIN, NOTICES, DRAIN],
  },
  {
    name: "20261025n then 20261025o once, as production applies them",
    files: [NOTICES, DRAIN],
  },
] as const;

for (const order of ORDERS)
  describe(order.name, () => {
    beforeAll(() => build(order.files), 120000);
    afterAll(async () => {
      await db?.close();
    });

    describe("the two migrations together", () => {
      test("each keeps what the other built", async () => {
        const [shape] = await q(`SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='cockpit_creative_outbox' AND column_name='attempts') AS attempts,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cockpit_slack_notice_blueprint' AND NOT tgisinternal) AS notice_trigger,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='cockpit_slack_notice_kickoff' AND NOT tgisinternal) AS kickoff_trigger,
      pg_get_functiondef('public.cockpit_creative_outbox_audit()'::regprocedure) LIKE '%x-cockpit-source%' AS audit_source,
      pg_get_functiondef('public.cockpit_blueprint_sources(text)'::regprocedure) LIKE '%blueprintCall%' AS blueprint_call,
      (SELECT count(*) FROM public.cockpit_slack_notice_settings)::int AS settings,
      (SELECT count(*) FROM public.cockpit_slack_channels)::int AS channels`);
        expect(shape).toEqual({
          attempts: true,
          notice_trigger: true,
          kickoff_trigger: true,
          audit_source: true,
          blueprint_call: true,
          settings: 8,
          channels: 2,
        });
        const can = async (role: string, fn: string) =>
          (
            await q<{ ok: boolean }>(
              "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
              [role, fn],
            )
          )[0].ok;
        for (const fn of [
          "public.cockpit_slack_notice_read(text)",
          "public.cockpit_slack_notice_settings_read()",
          "public.cockpit_blueprint_sources(text)",
        ]) {
          expect(await can("authenticated", fn)).toBe(true);
          expect(await can("anon", fn)).toBe(false);
        }
        for (const fn of [
          "public.cockpit_slack_notice_claim(integer,uuid)",
          "public.cockpit_creative_outbox_due(boolean)",
          "public.cockpit_creative_outbox_load_for_actor(uuid)",
          "public.cockpit_creative_outbox_refused(uuid,text)",
        ]) {
          expect(await can("service_role", fn)).toBe(true);
          expect(await can("authenticated", fn)).toBe(false);
        }
        for (const fn of [
          "public.cockpit_slack_notices_kick()",
          "public.cockpit_creative_drain_kick()",
        ])
          for (const role of ["anon", "authenticated", "service_role"])
            expect(await can(role, fn)).toBe(false);
      });

      test("with no work, both kicks post nothing and say so", async () => {
        expect(
          (await q("SELECT public.cockpit_slack_notices_kick() r"))[0].r,
        ).toBeNull();
        expect(
          (await q("SELECT public.cockpit_creative_drain_kick() r"))[0].r,
        ).toBeNull();
        const notes = await q(
          "SELECT key, ok, note FROM public.cockpit_sync_state WHERE key IN ('slack-notices-kick','creative-drain-kick') ORDER BY key",
        );
        expect(notes).toEqual([
          { key: "creative-drain-kick", ok: true, note: "Nothing to drain" },
          { key: "slack-notices-kick", ok: true, note: "Nothing to send" },
        ]);
      });
    });

    describe("a kickoff, from the mirror to the CSM's trail", () => {
      test("queued by the mirror, held for Make, posted complete once, read back by both cockpits", async () => {
        await q(
          "UPDATE public.cockpit_client_onboarding SET forms = jsonb_build_object('kickoff', $2::jsonb) WHERE clickup_task_id=$1",
          [
            A,
            JSON.stringify({
              form_id: "tG7dnxBn",
              response_id: RID,
              submitted_at: new Date(Date.now() - 3 * 60_000).toISOString(),
              answers: [],
            }),
          ],
        );
        expect((await notice(`kickoff:${RID}`)).state).toBe("queued");

        // The CSM's trail before Make: the Slack stop waits.
        const ctx = async () => {
          const notices = await CSN.readNotices(client(CSM_A) as never, A);
          return sendNotice(KICKOFF, { notices, failed: {} }, RID)!;
        };
        const waiting = slackStop(KICKOFF, await ctx());
        expect(waiting).toMatchObject({
          key: "slack",
          label: "The team hears in #csm-general",
          done: false,
        });
        expect((await runNotices(deps)).claimed).toBe(0);

        // Make updates the card and writes its comment.
        await q(
          `UPDATE public.cockpit_client_onboarding SET client_status='Brand Blueprint Booked♠️', card_updated_at=now(),
         links = links || '{"blueprint_form":"https://form.typeform.com/to/example"}'::jsonb WHERE clickup_task_id=$1`,
          [A],
        );
        clickup.handoff(A, new Date().toISOString());
        expect(await runNotices(deps)).toMatchObject({
          ok: true,
          claimed: 1,
          posted: 1,
        });
        expect(await runNotices(deps)).toMatchObject({ claimed: 0, posted: 0 });

        const row = await notice(`kickoff:${RID}`);
        expect(row).toMatchObject({
          state: "posted",
          variant: "complete",
          channel: kit.CSM_GENERAL,
        });
        const posted = textOf(
          kit.CSM_GENERAL,
          "Kickoff complete: Acme Interiors.",
        );
        expect(posted).not.toBeNull();
        const body = slack.posts().at(-1)!.body!;
        expect(JSON.stringify(body.blocks)).toContain("<@U0CREATIV1>");
        expect(String(body.text)).toEndWith(
          `Ref CN-${String(row.id).slice(0, 8)}`,
        );

        // Every Slack and ClickUp call has its intent and its answer in the ledger.
        const ledger = await q(
          "SELECT provider, resource, phase FROM public.cockpit_csm_provider_health WHERE run_key=$1 ORDER BY id",
          [row.id],
        );
        for (const resource of [
          "slack.com/api/chat.postMessage",
          `task/${A}/comment`,
        ])
          expect(
            ledger
              .filter(l => String(l.resource).includes(resource))
              .map(l => l.phase),
          ).toEqual(["intent", "response"]);

        // The trail: posted, with the link to the message.
        const stop = slackStop(KICKOFF, await ctx());
        expect(stop.done).toBe(true);
        expect(stop.label).toMatch(/^Posted in #csm-general at \d{2}:\d{2}$/);
        expect(stop.link).toEqual({
          href: row.permalink,
          label: "Open in Slack",
        });
        // The creative director's read of the same card parses too.
        const cd = await CDN.readNotices(client(CREATIVE) as never, A);
        expect(CDN.noticeOf(cd, "kickoff")).toMatchObject({
          state: "posted",
          responseId: RID,
        });
      });
    });

    describe("a Brand Blueprint close, from the press to both channels and the card", () => {
      test("the nudge, the press's real payload, the settle, close and media posted, the stops", async () => {
        // The Blueprint call was held yesterday and nothing is on record yet.
        await q(
          `INSERT INTO public.cockpit_csm_calls(source, source_id, task_id, client_name, kind, starts_at, status)
       VALUES('manual','fit-bp-1',$1,'Acme Interiors','blueprint', now() - interval '1 day','held')`,
          [A],
        );
        expect(
          await CDB.readBlueprintCall(client(CREATIVE) as never, A),
        ).toMatchObject({
          status: "held",
          stage: "Brand Blueprint Booked♠️",
          mapPhase: 4,
          nudge: true,
        });

        // Send to media (part 1) settles; it is no notice.
        await save({ ...PART1, ...PART2 });
        await pressPart(1, uuid(1));
        await settle(uuid(1), "done", {
          kind: "blueprintLaunch",
          launchTaskId: "86launchA1",
        });
        // Close the call (part 2): the shape cockpit-creative-api/blueprint.ts returns.
        await pressPart(2, uuid(2));
        expect(
          await CDB.readBlueprintCall(client(CREATIVE) as never, A),
        ).toMatchObject({ nudge: false });
        await settle(uuid(2), "done", {
          kind: "blueprintClose",
          launchTaskId: "86launchA1",
          closeRoute: "card_only",
          mapPhase: 4,
          mapSkipped: false,
        });
        expect(
          (
            await q(
              "SELECT count(*)::int n FROM public.cockpit_slack_notices WHERE kind LIKE 'blueprint%'",
            )
          )[0].n,
        ).toBe(2);
        const close = await notice(`blueprint:${A}:close`);
        expect(close.facts).toMatchObject({
          source: "cockpit",
          outboxId: uuid(2),
          settled: "done",
          closedByRole: "the creative director",
          launchTaskId: "86launchA1",
          mapPhase: 4,
          service: "interior",
        });
        expect((await notice(`blueprint:${A}:media`)).facts).toMatchObject({
          service: "interior",
          mapPhase: 4,
        });

        expect(await runNotices(deps)).toMatchObject({
          ok: true,
          claimed: 2,
          posted: 2,
        });
        expect(
          textOf(kit.CSM_GENERAL, "Brand Blueprint complete: Acme Interiors."),
        ).not.toBeNull();
        const media = textOf(
          kit.MEDIA_GENERAL,
          "Brand Blueprint completed: Acme Interiors.",
        );
        expect(media).not.toBeNull();
        const mediaPost = slack
          .posts()
          .find(p => p.body?.channel === kit.MEDIA_GENERAL)!;
        expect(JSON.stringify(mediaPost.body?.blocks)).toContain(
          "Interior design",
        );
        const closePost = slack
          .posts()
          .find(p =>
            String(p.body?.text).startsWith("Brand Blueprint complete: "),
          )!;
        expect(JSON.stringify(closePost.body?.blocks)).toContain(
          "<@U0CSMAAAA1>",
        );

        // The creative director's card: attempts on every part, and both stops.
        const record = await CDB.readBlueprints(client(CREATIVE) as never, [A]);
        expect(record.rows[0].outbox?.["2"]).toMatchObject({
          id: uuid(2),
          state: "done",
          attempts: 0,
        });
        const cd = await CDN.readNotices(client(CREATIVE) as never, A);
        expect(CDN.noticeOf(cd, "blueprint.close")).toMatchObject({
          state: "posted",
          outboxId: uuid(2),
          channel: { id: kit.CSM_GENERAL, name: "csm-general" },
        });
        expect(CDN.noticeOf(cd, "blueprint.media")).toMatchObject({
          state: "posted",
          channel: { id: kit.MEDIA_GENERAL, name: "media-general" },
        });
        // The CSM's Onboarding panel stop.
        const cs = await CSN.readNotices(client(CSM_A) as never, A);
        const view = cs.notices.find(n => n.kind === "blueprint.close")!;
        expect(CSN.noticeStop(view, cs.now)).toMatchObject({
          tone: "good",
          href: view.permalink,
        });
        expect(CSN.noticeStop(view, cs.now).text).toStartWith(
          "Posted in #csm-general",
        );
      });

      test("Lock the offer replies in the close's thread", async () => {
        await save(OFFER);
        await pressPart(3, uuid(3));
        await settle(uuid(3), "done", {
          kind: "blueprintOffer",
          launchTaskId: "86launchA1",
        });
        const offer = await notice(`blueprint:${A}:offer`);
        const close = await notice(`blueprint:${A}:close`);
        expect(offer).toMatchObject({ parent_id: close.id, state: "queued" });
        expect(offer.facts).toMatchObject({
          dnaComplete: true,
          offeredByRole: "the creative director",
        });
        expect(await runNotices(deps)).toMatchObject({ posted: 1 });
        expect(slack.posts().at(-1)!.body?.thread_ts).toBe(close.slack_ts);
        const cd = await CDN.readNotices(client(CREATIVE) as never, A);
        expect(CDN.noticeOf(cd, "blueprint.offer")).toMatchObject({
          state: "posted",
          variant: "thread",
          parentKind: "blueprint.close",
        });
      });

      test("a press nobody finished: the drain sees it, fails it at 30 minutes, and no notice follows", async () => {
        await q(
          `INSERT INTO public.cockpit_creative_outbox(id,client_name,kind,task_id,payload,actor_id,actor_email,created_at)
       VALUES($1,'Gamma Design','blueprintClose',$2,'{}'::jsonb,$3,'creative@tests.invalid', now() - interval '5 minutes'),
             ($4,'Gamma Design','blueprintOffer',$2,'{}'::jsonb,$3,'creative@tests.invalid', now() - interval '31 minutes')`,
          [uuid(10), C, CREATIVE, uuid(11)],
        );
        const dry = await rpcAsService("cockpit_creative_outbox_due", {
          p_apply: false,
        });
        expect(dry).toMatchObject({ apply: false, failed: 1 });
        expect(
          (dry as Row).rows.map((r: Row) => [r.id, r.actorId, r.attempts]),
        ).toEqual([[uuid(10), CREATIVE, 0]]);
        const run = await rpcAsService("cockpit_creative_outbox_due", {
          p_apply: true,
        });
        expect(run).toMatchObject({ apply: true, failed: 1 });
        const loaded = (await rpcAsService(
          "cockpit_creative_outbox_load_for_actor",
          { p_id: uuid(10) },
        )) as Row;
        expect(loaded).toMatchObject({
          id: uuid(10),
          task_id: C,
          state: "pending",
          attempts: 0,
        });
        expect(
          (
            await q(
              "SELECT state FROM public.cockpit_creative_outbox WHERE id=$1",
              [uuid(11)],
            )
          )[0].state,
        ).toBe("failed");
        expect(
          (
            await q(
              "SELECT count(*)::int n FROM public.cockpit_slack_notices WHERE task_id=$1",
              [C],
            )
          )[0].n,
        ).toBe(0);
        // The drain's audit row names the cron.
        expect(
          (
            await q(
              "SELECT source_system FROM public.cockpit_audit_log WHERE entity_type='creative_outbox' AND entity_id=$1 AND after->>'state'='failed'",
              [uuid(11)],
            )
          )[0].source_system,
        ).toBe("cron");
      });
    });

    describe("Notices and routing, through the client success cockpit's own calls", () => {
      test("the read parses for an editor and a viewer, with every kind the card shows", async () => {
        const admin = await CSN.readNoticeSettings(client(ADMIN) as never);
        expect(admin.can).toEqual({ edit: true, editors: true });
        // The server lists them in its seed order; the card orders its own rows.
        // This file applies Stage 1's migrations only, so the two kinds 2b's
        // 20261029u seeds are not in its database (stage2b-fit proves those).
        const inStage2b = ["checkin.grade", "checkin.recap_late"];
        expect(admin.notices.map(n => n.kind).sort()).toEqual(
          [...CSN.NOTICE_KINDS].filter(k => !inStage2b.includes(k)).sort(),
        );
        const kickoff = admin.notices.find(n => n.kind === "kickoff")!;
        expect(kickoff).toMatchObject({
          shape: "post",
          on: true,
          channel: { id: kit.CSM_GENERAL, name: "csm-general" },
          mentionRule: ["seat:creative"],
          tags: [{ rule: "seat:creative", found: true, slackKnown: true }],
          last: { state: "posted", responseId: RID },
        });
        expect(admin.people.map(p => p.label)).toContain(
          "Huda, Systems manager",
        );
        const viewer = await CSN.readNoticeSettings(client(CSM_A) as never);
        expect(viewer.can).toEqual({ edit: false, editors: false });
        expect(viewer.people).toEqual([]);
      });

      test("a change, a refusal in the server's words, a new channel checked by the sender, and a test to me", async () => {
        const changed = await CSN.setNoticeSetting(
          client(ADMIN) as never,
          "blueprint.close",
          {
            mentionRule: ["seat:csm", "seat:systems_manager"],
          },
        );
        expect(
          changed.notices
            .find(n => n.kind === "blueprint.close")
            ?.tags.map(t => t.rule),
        ).toEqual(["seat:csm", "seat:systems_manager"]);
        const late = await CSN.setNoticeSetting(
          client(ADMIN) as never,
          "kickoff.late",
          { on: false },
        ).catch(e => e);
        expect(late).toBeInstanceOf(CSN.NoticeError);
        expect(late.message).toBe(
          "This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.",
        );
        expect(late.code).toBe("22023");
        const csm = await CSN.setNoticeSetting(
          client(CSM_A) as never,
          "kickoff",
          {
            on: false,
          },
        ).catch(e => e);
        expect(csm).toBeInstanceOf(CSN.NoticeError);
        expect(csm.code).toBe("42501");

        // A channel: Checking until the sender's next run, then Ready.
        slack.channels.set(NEW_CHANNEL, {
          name: "client-wins",
          is_private: true,
          is_member: true,
        });
        const added = await CSN.addSlackChannel(
          client(ADMIN) as never,
          NEW_CHANNEL,
          "client-wins",
        );
        expect(added.channels.find(c => c.id === NEW_CHANNEL)?.state).toBe(
          "checking",
        );
        expect((await runNotices(deps)).channels).toBe(1);
        const checked = await CSN.readNoticeSettings(client(ADMIN) as never);
        expect(checked.channels.find(c => c.id === NEW_CHANNEL)).toMatchObject({
          state: "ok",
          inUse: false,
        });

        // Send a test to me: the systems manager's own direct messages.
        const test1 = await CSN.rehearseNotice(
          client(ADMIN) as never,
          "kickoff",
        );
        expect(test1).toMatchObject({ state: "queued" });
        expect(await runNotices(deps)).toMatchObject({ posted: 1 });
        expect(slack.posts().at(-1)!.body).toMatchObject({
          channel: "U0SYSMANA1",
        });
        expect(String(slack.posts().at(-1)!.body?.text)).toStartWith(
          "[Rehearsal] ",
        );
        const after = await CSN.readNoticeSettings(client(ADMIN) as never);
        expect(after.test).toMatchObject({
          id: test1.id,
          kind: "kickoff",
          state: "posted",
        });
        const dm = await q(
          "SELECT target, channel FROM public.cockpit_slack_notices WHERE id=$1",
          [test1.id],
        );
        expect(dm[0]).toEqual({ target: "U0SYSMANA1", channel: "D0SYSMDM001" });
      });
    });

    // The review fixes of 2026-10-26 (contract X18 to X29), each where one
    // builder's piece meets another's.
    describe("the review fixes, across the pieces", () => {
      const WAITING_REPLY =
        "Waiting for the card's Kickoff Handoff comment before saying the card is updated.";

      test("X18, X26: the comment there but the card not moved is late, posted where Settings says now", async () => {
        await addClient(E, "Echo Build", "Onboarding Booked", 4);
        // An editor moves the kickoff notice to the channel checked earlier.
        await CSN.setNoticeSetting(client(ADMIN) as never, "kickoff", {
          channel: NEW_CHANNEL,
        });
        await kickoffFor(E, RID_E, 25);
        const trail = async () =>
          slackStop(
            KICKOFF,
            sendNotice(
              KICKOFF,
              {
                notices: await CSN.readNotices(client(ADMIN) as never, E),
                failed: {},
              },
              RID_E,
            )!,
          );
        // Queued: the trail names the channel Settings gives it now.
        expect((await trail()).label).toBe("The team hears in #client-wins");
        // Make wrote its comment, then stopped before it moved the card.
        clickup.handoff(E, new Date(Date.now() - 24 * 60_000).toISOString());
        expect(await runNotices(deps)).toMatchObject({ claimed: 1, posted: 1 });
        const row = await notice(`kickoff:${RID_E}`);
        expect(row).toMatchObject({
          state: "posted",
          variant: "late",
          channel: NEW_CHANNEL,
        });
        expect(row.facts).toMatchObject({
          commentCheck: "found",
          looksDone: false,
        });
        const body = slack.posts().at(-1)!.body!;
        expect(body.channel).toBe(NEW_CHANNEL);
        expect(String(body.text)).toStartWith(
          "Kickoff in, card not updated: Echo Build.",
        );
        const blocks = JSON.stringify(body.blocks);
        expect(blocks).toContain(
          "The Kickoff Handoff comment is on the card, but 20 minutes after the kickoff the card shows Onboarding Booked, not Brand Blueprint Booked.",
        );
        // Late tags the CSM (nobody holds the seat for this client: plain
        // text, and the warning row) and the systems manager.
        expect(blocks).toContain("<@U0SYSMANA1>");
        expect(
          await q(
            "SELECT http_status FROM public.cockpit_csm_provider_health WHERE run_key=$1 AND resource='notices/mentions'",
            [row.id],
          ),
        ).toEqual([{ http_status: null }]);
        expect((await trail()).label).toMatch(
          /^Posted in #client-wins at \d{2}:\d{2}$/,
        );
        await CSN.setNoticeSetting(client(ADMIN) as never, "kickoff", {
          channel: kit.CSM_GENERAL,
        });
      });

      test("X19, X21: a late kickoff's reply waits for the comment and says so, then posts in the late notice's thread", async () => {
        await addClient(D, "Delta Studio", "Onboarding Booked", 4);
        await kickoffFor(D, RID_D, 25);
        // No comment 20 minutes on: late.
        expect(await runNotices(deps)).toMatchObject({ claimed: 1, posted: 1 });
        const late = await notice(`kickoff:${RID_D}`);
        expect(late).toMatchObject({ state: "posted", variant: "late" });
        expect(late.facts).toMatchObject({ commentCheck: "missing" });
        // The card has not changed since the alarm: no reply.
        await runNotices(deps);
        expect(await notice(`kickoff:${RID_D}:updated`)).toBeNull();
        // Someone moves the card by hand, without Make's comment.
        await q(
          "UPDATE public.cockpit_client_onboarding SET client_status='Brand Blueprint Booked♠️', card_updated_at=now() + interval '1 second' WHERE clickup_task_id=$1",
          [D],
        );
        expect(await runNotices(deps)).toMatchObject({
          claimed: 1,
          requeued: 1,
          posted: 0,
        });
        const waiting = await notice(`kickoff:${RID_D}:updated`);
        expect(waiting).toMatchObject({
          state: "queued",
          parent_id: late.id,
          error: WAITING_REPLY,
        });
        // Settings says what it waits for, not "its first notice".
        const read = await CSN.readNoticeSettings(client(ADMIN) as never);
        const last = read.notices.find(n => n.kind === "kickoff.updated")!
          .last!;
        expect(last).toMatchObject({ state: "queued", reason: WAITING_REPLY });
        expect(CSN.noticeStop(last, read.now).text).toBe(WAITING_REPLY);
        // The comment comes; at the reply's next turn it posts in the thread.
        clickup.handoff(D, new Date().toISOString());
        await q(
          "UPDATE public.cockpit_slack_notices SET next_attempt_at = now() WHERE id=$1",
          [waiting.id],
        );
        expect(await runNotices(deps)).toMatchObject({ claimed: 1, posted: 1 });
        const reply = await notice(`kickoff:${RID_D}:updated`);
        expect(reply).toMatchObject({
          state: "posted",
          variant: "thread",
          thread_ts: late.slack_ts,
          channel: late.channel,
        });
        const body = slack.posts().at(-1)!.body!;
        expect(body.thread_ts).toBe(late.slack_ts);
        expect(String(body.text)).toMatch(
          /^Card updated at \d{2}:\d{2}\. It has the Kickoff Handoff comment and shows Brand Blueprint Booked\. Ref CN-/,
        );
      });

      test("X21: a reply that went top level is looked for at top level, after its first notice posts", async () => {
        const at = new Date().toISOString();
        const queue = async (
          kind: string,
          key: string,
          facts: Row,
          parent: string | null,
        ) =>
          (
            await q<{ r: string }>(
              "SELECT public.cockpit_slack_notice_queue($1,$2,$3,'Foxtrot Build',$4::jsonb,$5::uuid,'queued',NULL) r",
              [kind, key, F, JSON.stringify(facts), parent],
            )
          )[0].r;
        const closeId = await queue(
          "blueprint.close",
          `blueprint:${F}:close`,
          {
            taskId: F,
            client: "Foxtrot Build",
            source: "cockpit",
            settled: "done",
            closedAt: at,
            closedByRole: "the creative director",
            mapPhase: 4,
            service: "fitout",
          },
          null,
        );
        const offerId = await queue(
          "blueprint.offer",
          `blueprint:${F}:offer`,
          {
            taskId: F,
            client: "Foxtrot Build",
            offeredAt: at,
            offeredByRole: "the creative director",
            dnaComplete: true,
          },
          closeId,
        );
        const state = async (id: string) =>
          (
            await q(
              "SELECT state, target, channel, slack_ts, thread_ts FROM public.cockpit_slack_notices WHERE id=$1",
              [id],
            )
          )[0];
        // The close is refused while the offer waits for it; the offer then
        // goes top level and Slack does not answer.
        slack.post = { refuse: "not_in_channel" };
        expect(await runNotices(deps)).toMatchObject({ claimed: 1, failed: 1 });
        slack.post = "5xx";
        expect(await runNotices(deps)).toMatchObject({
          claimed: 1,
          unknown: 1,
        });
        expect(await state(offerId)).toMatchObject({
          state: "unknown",
          target: kit.CSM_GENERAL,
          thread_ts: null,
        });
        // Fixed and requeued, the close posts and starts a thread.
        slack.post = "ok";
        await rpcAsService("cockpit_slack_notice_fix", {
          p_id: closeId,
          p_action: "requeue",
          p_note: null,
        });
        expect(await runNotices(deps)).toMatchObject({
          posted: 1,
          reconciled: 0,
        });
        expect((await state(closeId)).state).toBe("posted");
        // The offer had arrived after all, at top level: the next look finds
        // it there, not in the close's new thread.
        const ts = slack.seed(
          kit.CSM_GENERAL,
          `Offer locked: Foxtrot Build. Ref CN-${offerId.slice(0, 8)}`,
        );
        await q(
          "UPDATE public.cockpit_slack_notices SET checked_at = NULL WHERE id=$1",
          [offerId],
        );
        expect(await runNotices(deps)).toMatchObject({
          reconciled: 1,
          posted: 0,
        });
        expect(await state(offerId)).toMatchObject({
          state: "posted",
          slack_ts: ts,
          channel: kit.CSM_GENERAL,
          thread_ts: null,
        });
      });

      test("X27: an editor tags people; the sender checks them in Slack; the card reads the answer, by role", async () => {
        const pm = (
          await q<{ id: number }>(
            "INSERT INTO public.cockpit_people(name,email,role,added_by) VALUES('Sara Example','pm@tests.invalid','Project manager','test') RETURNING id",
          )
        )[0].id;
        const ceo = (
          await q<{ id: number }>(
            "SELECT id FROM public.cockpit_people WHERE email='aziz@maharamedia.com'",
          )
        )[0].id;
        const people = (r: CSN.SettingsRead) =>
          r.notices.find(n => n.kind === "blueprint.offer")!.mentionPeople;
        const saved = await CSN.setNoticeSetting(
          client(ADMIN) as never,
          "blueprint.offer",
          { mentionPeople: [pm, ceo] },
        );
        expect(
          people(saved).map(p => [
            p.id,
            p.label,
            p.role,
            p.slack,
            p.slackKnown,
          ]),
        ).toEqual([
          [
            pm,
            "Sara, Project manager",
            "the project manager",
            "checking",
            false,
          ],
          [ceo, "Aziz, CEO", "the CEO", "checking", false],
        ]);
        // Anyone else reads the role only.
        expect(
          people(await CSN.readNoticeSettings(client(CSM_A) as never)).map(
            p => p.label,
          ),
        ).toEqual(["the project manager", "the CEO"]);
        // Slack knows the CEO's address and not the project manager's.
        slack.users.set("aziz@maharamedia.com", "U0AZIZEX01");
        expect((await runNotices(deps)).people).toBe(2);
        expect(
          people(await CSN.readNoticeSettings(client(ADMIN) as never)).map(
            p => [p.slack, p.slackKnown],
          ),
        ).toEqual([
          ["not_found", false],
          ["ok", true],
        ]);
        // The next offer tags the CEO by the id the check found.
        const inputs = (await rpcAsService(
          "cockpit_slack_notice_doctor_inputs",
          {},
        )) as Row;
        expect(
          inputs.settings
            .find((s: Row) => s.kind === "blueprint.offer")
            .mentions.map((m: Row) => [m.personId, m.slackId])
            .sort(),
        ).toEqual(
          [
            [pm, null],
            [ceo, "U0AZIZEX01"],
          ].sort(),
        );
        await CSN.setNoticeSetting(client(ADMIN) as never, "blueprint.offer", {
          mentionPeople: [],
        });
      });

      test("X24, X25: a media buyer the CEO adds can change notices; switching the seat off ends the right for good", async () => {
        await member(db, MEDIA, "media@tests.invalid", ["media_buyer"]);
        expect(
          CSN.noAccess(
            await CSN.readNoticeSettings(client(MEDIA) as never).catch(e => e),
          ),
        ).toBe(true);
        const seat = (
          await q<{ id: string }>(
            "SELECT id FROM public.cockpit_members WHERE auth_user_id=$1",
            [MEDIA],
          )
        )[0].id;
        const added = await CSN.setFormsEditor(
          client(CEO) as never,
          seat,
          true,
        );
        expect(added.editors.map(e => e.memberId)).toContain(seat);
        expect(
          (await CSN.readNoticeSettings(client(MEDIA) as never)).can,
        ).toEqual({ edit: true, editors: false });
        const changed = await CSN.setNoticeSetting(
          client(MEDIA) as never,
          "kickoff.updated",
          { mentionRule: ["seat:csm"] },
        );
        expect(
          changed.notices.find(n => n.kind === "kickoff.updated")!.mentionRule,
        ).toEqual(["seat:csm"]);
        await CSN.setNoticeSetting(client(MEDIA) as never, "kickoff.updated", {
          mentionRule: [],
        });
        // Switched off, then on again: the right does not come back.
        await q("UPDATE public.cockpit_members SET active=false WHERE id=$1", [
          seat,
        ]);
        expect(
          await q(
            "SELECT count(*)::int n FROM public.cockpit_forms_editors WHERE member_id=$1",
            [seat],
          ),
        ).toEqual([{ n: 0 }]);
        expect(
          (
            await q(
              "SELECT action, metadata FROM public.cockpit_audit_log WHERE entity_type='cockpit_forms_editors' AND entity_id=$1 AND action='forms.editor_removed'",
              [seat],
            )
          )[0],
        ).toMatchObject({ metadata: { why: "seat_off" } });
        await q("UPDATE public.cockpit_members SET active=true WHERE id=$1", [
          seat,
        ]);
        expect(
          CSN.noAccess(
            await CSN.readNoticeSettings(client(MEDIA) as never).catch(e => e),
          ),
        ).toBe(true);
      });

      test("X28, X29: a close for a client already past phase 5 says it is live, and the CSM gets no phase 5 copy", async () => {
        await addClient(G, "Golf Homes", "Active", 6);
        await save({ ...PART1, ...PART2 }, G);
        await pressPart(1, uuid(21), G);
        await settle(uuid(21), "done", {
          kind: "blueprintLaunch",
          launchTaskId: "86launchG1",
        });
        await pressPart(2, uuid(22), G);
        // The shape cockpit-creative-api/blueprint.ts returns at phase 5 or later.
        await settle(uuid(22), "done", {
          kind: "blueprintClose",
          launchTaskId: "86launchG1",
          closeRoute: "card_only",
          mapPhase: 6,
          mapSkipped: true,
        });
        expect((await notice(`blueprint:${G}:close`)).facts).toMatchObject({
          mapPhase: 6,
        });
        expect(await runNotices(deps)).toMatchObject({ claimed: 2, posted: 2 });
        const posted = (channel: string) =>
          slack
            .posts()
            .find(
              p =>
                p.body?.channel === channel &&
                String(p.body?.text).includes("Golf Homes"),
            )!.body!;
        const close = posted(kit.CSM_GENERAL);
        expect(String(close.text)).toStartWith(
          "Brand Blueprint complete: Golf Homes. The client is already live.",
        );
        expect(JSON.stringify(close.blocks)).toContain(
          "the Onboarding Map is already at phase 6, so there is no phase 5 WhatsApp to send and no launch call to book.",
        );
        expect(JSON.stringify(close.blocks)).not.toContain("Launch call");
        expect(String(posted(kit.MEDIA_GENERAL).text)).toStartWith(
          "Brand Blueprint completed: Golf Homes. The client is already live.",
        );
        // The CSM's Onboarding panel leaves the phase 5 copy out for this
        // card, and keeps it for a card whose first close moved the map.
        const golf = await BS.readBlueprintStatus(client(ADMIN) as never, G);
        expect(golf.closeMapSkipped).toBe(true);
        expect(
          BS.phase5Copy({
            taskId: G,
            clientName: "Golf Homes",
            status: golf,
            links: {},
          }),
        ).toBeNull();
        const acme = await BS.readBlueprintStatus(client(CSM_A) as never, A);
        expect(acme.closeMapSkipped).toBeUndefined();
        expect(
          BS.phase5Copy({
            taskId: A,
            clientName: "Acme Interiors",
            status: acme,
            links: {},
          }),
        ).not.toBeNull();
      });
    });
  });
