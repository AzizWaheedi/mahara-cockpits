import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  checkManualPayment,
  manualPaymentsToCheck,
  PaymentCheckError,
} from "../src/lib/paymentChecks";
import { actor, member, migration, owner } from "./lib/cockpitTestDb";
import { CEO, hoursTestDb, service } from "./lib/hoursTestDb";

// supabase/migrations/20261101n_checked_money.sql (docs/forms/WAVE12-CONTRACT.md
// sections 2.5, 3.1, 4.2 and 8, the checked-money row), in PGlite with
// Supabase's default privileges on. Every function the file replaces loads
// from its canonical migration, so the drift guard sees the live bodies the
// contract read (11.2-c). Made-up clients, people and amounts, except the 8
// Q20 ids and their $21,239.16, which the migration asserts by id (11.2-i);
// they carry made-up names here. No live credentials.

const N = "20261101n_checked_money.sql";
const FINANCE = "00000000-0000-4000-8000-0000000000f1";
const CSM = "00000000-0000-4000-8000-0000000000e1";
const OTHER_CSM = "00000000-0000-4000-8000-0000000000e2";
const BUYER = "00000000-0000-4000-8000-0000000000e3";

/** The 8 hand-logged rows of 11.2-i: ids and dollars as the contract read them. */
const Q20: {
  id: string;
  day: string;
  usd: number;
  rail: string;
  task: string;
  source?: [string, string];
}[] = [
  {
    id: "768e486a-6bef-47ae-9d2e-781ccdbf93a5",
    day: "2026-04-02",
    usd: 4000,
    rail: "bank_transfer",
    task: "task_a",
  },
  {
    id: "sx7fc98m8am8fgyjfqtjnwy4718ey703",
    day: "2026-09-23",
    usd: 1333,
    rail: "cheque",
    task: "task_b",
  },
  {
    id: "54be0e69-fd63-4dec-95d2-adc32b5a8bd1",
    day: "2026-10-03",
    usd: 505.3,
    rail: "bank_transfer",
    task: "task_c",
  },
  {
    id: "sx764zvpnc7gt1sb9yepq7vn4h8ftjds",
    day: "2026-10-06",
    usd: 2300,
    rail: "bank_transfer",
    task: "task_d",
    source: ["billing-inbox", "2"],
  },
  {
    id: "sx7bhrq78qtqa1mn5yvagcz0198fvqsn",
    day: "2026-10-06",
    usd: 5608.8,
    rail: "bank_transfer",
    task: "task_c",
    source: ["billing-inbox", "3"],
  },
  {
    id: "cef7fc83-5eee-45bc-83c9-234d5330ec6a",
    day: "2026-10-18",
    usd: 1997.18,
    rail: "bank_transfer",
    task: "task_e",
  },
  {
    id: "1ccf2cb8-3478-48fa-b4ff-2c44b7009978",
    day: "2026-10-27",
    usd: 2000,
    rail: "bank_transfer",
    task: "task_a",
    source: ["billing-inbox", "5"],
  },
  {
    id: "bdf92a9d-9d6e-4e7f-8617-90088e35b5e7",
    day: "2026-10-28",
    usd: 3494.88,
    rail: "bank_transfer",
    task: "task_e",
  },
];
const Q20_USD = 21239.16;
const Q20_REF = "logged before the check rule, 2026-11-01";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit)
    throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

/** A migration without its pg_cron block (pg_cron, pg_net and the vault are not in the test engine). */
function withoutCron(file: string): string {
  const text = migration(file);
  const start = text.indexOf("-- cron:begin");
  const end = text.indexOf("-- cron:end");
  if (start < 0) return text;
  return `${text.slice(0, start)}${text.slice(end + "-- cron:end".length)}`;
}

async function schema(db: PGlite) {
  await owner(db);
  const core = migration("20260919_cockpit_core.sql");
  for (const name of [
    "cockpit_client_billing_days",
    "cockpit_metric_days",
    "cockpit_payer_clients",
  ])
    await db.exec(
      extract(
        "20260919_cockpit_core.sql",
        new RegExp(
          `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
  void core;
  await db.exec(migration("20260921c_bank_statements.sql"));
  await db.exec(
    extract(
      "20260921d_cockpit_metrics.sql",
      /create table if not exists public\.cockpit_sections \([\s\S]*?\n\);/i,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_sections ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sections FROM anon, authenticated;",
  );
  await db.exec(migration("20260923a_client_billing.sql"));
  // The CSM read models: the domain tables, the CSM state (cockpit_client_allowed) and the projections.
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY)");
  for (const relation of [
    "cockpit_campaigns",
    "cockpit_ads",
    "cockpit_client_profiles",
    "cockpit_decisions",
  ]) {
    await db.exec(
      extract(
        "20260923o_cockpit_domain_tables.sql",
        new RegExp(
          `create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
    await db.exec(`ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`);
  }
  await db.exec(migration("20260926a_cockpit_decision_details.sql"));
  await db.exec(
    extract(
      "20260923p_cockpit_actions_and_rpcs.sql",
      /create table if not exists public\.cockpit_plan_items\s*\([\s\S]*?\n\);/i,
    ),
  );
  for (const relation of [
    "team_people",
    "team_meetings",
    "team_meeting_people",
  ])
    await db.exec(
      extract(
        "20260922b_team_meetings.sql",
        new RegExp(
          `create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
  await db.exec(
    extract(
      "20260923d_team_meetings_screen.sql",
      /create table if not exists public\.team_changes\s*\([\s\S]*?\n\);/i,
    ),
  );
  await db.exec(
    extract(
      "20260923d_team_meetings_screen.sql",
      /alter table public\.team_meeting_people\s+add column[\s\S]*?;/i,
    ),
  );
  await db.exec(
    extract(
      "20260927d_team_meetings_v5.sql",
      /alter table public\.team_meetings\s+add column[\s\S]*?;[ \t]*\r?$/im,
    ),
  );
  await db.exec(
    extract(
      "20260927g_renewals_projections_meeting.sql",
      /alter table public\.team_meetings add column if not exists embed text;/i,
    ),
  );
  for (const relation of [
    "cockpit_churn_departures",
    "cockpit_churn_months",
    "cockpit_churn_log",
  ])
    await db.exec(
      extract(
        "20261001a_churn_tracker.sql",
        new RegExp(
          `create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`,
          "i",
        ),
      ),
    );
  await db.exec(
    extract(
      "20260922a_eod_outbox.sql",
      /create table if not exists public\.eod_outbox\s*\([\s\S]*?\n\);/i,
    ),
  );
  await db.exec(
    extract(
      "20260920b_wa_inbox.sql",
      /create table if not exists public\.wa_threads\s*\([\s\S]*?\n\);/i,
    ),
  );
  // The hand-logged ledger as built (protect and audit triggers, the CEO's door).
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  // The finance refresh as live: 20260927h's columns, 20260927i, 20261007e's worker path.
  const actions = migration("20260927h_cockpit_ceo_actions.sql");
  for (const pattern of [
    /ALTER TABLE public\.cockpit_payer_clients ADD COLUMN IF NOT EXISTS cleared_at timestamptz;/,
    /CREATE TABLE IF NOT EXISTS public\.cockpit_ceo_provider_health\(.*\);/,
    /ALTER TABLE public\.cockpit_expense_exclusions ADD COLUMN IF NOT EXISTS removed_at timestamptz;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS base_kind text;/,
    /ALTER TABLE public\.cockpit_bank_lines ADD COLUMN IF NOT EXISTS manual_kind boolean NOT NULL DEFAULT false;/,
  ]) {
    const hit = actions.match(pattern);
    if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
    await db.exec(hit[0]);
  }
  await db.exec(migration("20260927i_cockpit_finance_refresh.sql"));
  const restore = migration("20261007e_cockpit_provider_rpc_restore.sql");
  await db.exec(
    "ALTER TABLE public.cockpit_finance_refreshes ALTER COLUMN actor_id DROP NOT NULL",
  );
  for (const fn of [
    "cockpit_ceo_refresh_require_service",
    "cockpit_ceo_refresh_finance_snapshot",
    "cockpit_ceo_worker_begin_finance_refresh",
    "cockpit_finance_refresh_input",
  ]) {
    const hit = restore.match(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`,
      ),
    );
    if (!hit) throw new Error(`Canonical definition missing: ${fn}`);
    await db.exec(hit[0]);
  }
  await db.exec(`
    REVOKE ALL ON FUNCTION public.cockpit_ceo_refresh_require_service(), public.cockpit_ceo_refresh_finance_snapshot(),
      public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cockpit_ceo_worker_begin_finance_refresh(), public.cockpit_finance_refresh_input(uuid) TO service_role;`);
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
  await db.exec(migration("20260927v_csm_read_models.sql"));
  await db.exec(migration("20261004a_csm_churn_projections.sql"));
  await db.exec(migration("20261004b_csm_providers.sql"));
  // The billing inbox and its ingest (20261009a, 20261009h).
  await db.exec(withoutCron("20261009a_billing_native_sync.sql"));
  await db.exec(migration("20261009h_billing_browser_writes_closed.sql"));
  // The ClickUp write-back queue (20261009f) and the billing write-back trigger (20261009j).
  const f = "20261009f_clickup_writeback_native.sql";
  await db.exec(
    [
      extract(
        f,
        /CREATE TABLE IF NOT EXISTS public\.cockpit_clickup_writeback_queue\([\s\S]*?\n\);/,
      ),
      "ALTER TABLE public.cockpit_clickup_writeback_queue ENABLE ROW LEVEL SECURITY;",
      "REVOKE ALL ON public.cockpit_clickup_writeback_queue FROM PUBLIC,anon,authenticated;",
      "GRANT SELECT,INSERT,UPDATE ON public.cockpit_clickup_writeback_queue TO service_role;",
      extract(
        f,
        /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_audit\(\)[\s\S]*?END \$\$;/,
      ),
      extract(
        f,
        /DROP TRIGGER IF EXISTS cockpit_clickup_writeback_queue_audit_insert[\s\S]*?EXECUTE FUNCTION public\.cockpit_clickup_writeback_audit\(\);/,
      ),
      migration("20261009j_billing_clickup_writeback.sql"),
    ].join("\n"),
  );
  // Signed deals, the deal ledger and its ties (20261018c), Ecom and the billing balances (x, y, p).
  await db.exec(
    extract(
      "20260924a_sales_cockpit.sql",
      /create table if not exists public\.cockpit_sales_deals \([\s\S]*?\n\);/i,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_sales_deals ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_sales_deals FROM anon, authenticated;",
  );
  await db.exec(migration("20261018c_money_ties_deal_payments.sql"));
  await db.exec(
    extract(
      "20261011v_cockpit_invoices.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_invoices\([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    extract(
      "20261015a_cockpit_invoice_whop_links.sql",
      /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS checkout_source[\s\S]*?;/,
    ),
  );
  await db.exec(
    extract(
      "20261022a_cockpit_invoice_tax_id.sql",
      /ALTER TABLE public\.cockpit_invoices\n ADD COLUMN IF NOT EXISTS client_tax_id[\s\S]*?;/,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_invoices ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_invoices FROM PUBLIC, anon, authenticated;",
  );
  await db.exec(migration("20261022b_ecom_payments.sql"));
  await db.exec(migration("20261022c_ecom_money_rails.sql"));
  await db.exec(migration("20261005a_client_onboarding.sql"));
  for (const t of ["cockpit_csm_calls", "cockpit_csm_call_forms"])
    await db.exec(
      extract(
        "20261011c_csm_call_store.sql",
        new RegExp(
          `CREATE TABLE IF NOT EXISTS public\\.${t}\\([\\s\\S]*?\\n\\);`,
        ),
      ),
    );
  await db.exec(
    "ALTER TABLE public.cockpit_csm_calls ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cockpit_csm_call_forms ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.cockpit_csm_calls, public.cockpit_csm_call_forms FROM PUBLIC, anon, authenticated;",
  );
  await db.exec(
    extract(
      "20260924q_ceo_and_team_access.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated;",
  );
  await db.exec(migration("20261023x_billing_balances.sql"));
  await db.exec(migration("20261023y_billing_balance_write.sql"));
  await db.exec(migration("20261024p_billing_payment_exclusions.sql"));
  // Every forms.% switch change leaves an audit row (20261029z), so the forms.doors merge is audited.
  await db.exec(
    extract(
      "20261029z_forms_move_recording.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_settings_forms_audit\(\)[\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    extract(
      "20261029z_forms_move_recording.sql",
      /DROP TRIGGER IF EXISTS cockpit_settings_forms_audit[\s\S]*?EXECUTE FUNCTION public\.cockpit_settings_forms_audit\(\);/,
    ),
  );
}

/** The seats, the cards, the 8 Q20 rows and their inbox rows, as the live database held them on 11-01. */
async function seed(
  db: PGlite,
  opts: { ninth?: boolean; q20?: boolean; changeQ20?: boolean } = {},
) {
  await member(db, FINANCE, "fin@tests.invalid", ["finance"]);
  await member(db, CSM, "sara@tests.invalid", ["csm"]);
  await member(db, OTHER_CSM, "omar@tests.invalid", ["csm"]);
  await member(db, BUYER, "nada@tests.invalid", ["media_buyer"]);
  await owner(db);
  await db.exec(`
    UPDATE cockpit_members SET clients=ARRAY['Acme'] WHERE email='sara@tests.invalid';
    UPDATE cockpit_members SET clients=ARRAY['Beta Co'] WHERE email='omar@tests.invalid';
    INSERT INTO cockpit_billing_accounts(clickup_task_id,client_name,stage,stage_group,client_status) VALUES
      ('task_a','Acme','Active','active','Active'),('task_b','Beta Co','Active','active','Active'),
      ('task_c','Gamma Build','Active','active','Active'),('task_d','Delta Fitout','Active','active','Active'),
      ('task_e','Epsilon Design','Active','active','Active');
    INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('money','Money',now(),'{"rails":{"tap":{"connected":true}}}');
    UPDATE cockpit_manual_payment_state SET history_ready=true;
    UPDATE cockpit_finance_source_state SET aliases_ready=true, manual_ready=true;
    INSERT INTO cockpit_settings(key,value,updated_by) VALUES('forms.doors','{"churn":false}','fixture');`);
  if (opts.q20 !== false) {
    const names: Record<string, string> = {
      task_a: "Acme",
      task_b: "Beta Co",
      task_c: "Gamma Build",
      task_d: "Delta Fitout",
      task_e: "Epsilon Design",
    };
    for (const [i, r] of Q20.entries()) {
      const usd = opts.changeQ20 && i === 0 ? r.usd + 1 : r.usd;
      await db.query(
        `INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by,source_deployment,source_id,added_at)
         VALUES($1,$2,$3,'USD',$3,1,$4,$5,$6,$7,'fixture: import',$8,$9,'2026-10-30T12:00:00Z')`,
        [
          r.id,
          r.day,
          usd,
          names[r.task],
          names[r.task].toLowerCase().replace(/\W/g, ""),
          r.task,
          r.rail,
          r.source?.[0] ?? null,
          r.source?.[1] ?? null,
        ],
      );
    }
    await db.exec(`
      INSERT INTO cockpit_billing_inbox(id,clickup_task_id,client_name,paid_on,amount,currency,method,source,logged_by,status,ledger_id) VALUES
        (2,'task_d','Delta Fitout','2026-10-06',2300,'USD','bank_transfer','maher','maher','ingested','sx764zvpnc7gt1sb9yepq7vn4h8ftjds'),
        (3,'task_c','Gamma Build','2026-10-06',5608.8,'USD','bank_transfer','maher','maher','ingested','sx7bhrq78qtqa1mn5yvagcz0198fvqsn'),
        (4,'task_b','Beta Co','2026-10-20',100,'KWD','tap','maher','maher','rejected',NULL),
        (5,'task_a','Acme','2026-10-27',2000,'USD','bank_transfer','csm','sara@tests.invalid','ingested','1ccf2cb8-3478-48fa-b4ff-2c44b7009978');
      SELECT setval('cockpit_billing_inbox_id_seq', 9);`);
  }
  if (opts.ninth)
    await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
      VALUES('ninth-after-the-read','2026-10-31',500,'USD',500,1,'Acme','acme','task_a','bank_transfer','fixture: import')`);
  // Every manual row the refresh last wrote, as live: rail payments and the hand-logged ones.
  await db.exec(`
    INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,active) VALUES
      ('whop:pay_live1','task_a','Acme','2026-10-10',900,'whop','back_end','client',true)
      ${opts.q20 === false ? "" : `,${Q20.map(r => `('manual:${r.id}','${r.task}','x','${r.day}',${r.usd},'manual','back_end','client',true)`).join(",")}`}
      ${opts.ninth ? ",('manual:ninth-after-the-read','task_a','Acme','2026-10-31',500,'manual','back_end','client',true)" : ""};`);
}

async function freshDb(opts: Parameters<typeof seed>[1] = {}) {
  const db = await hoursTestDb();
  await schema(db);
  await seed(db, opts);
  return db;
}

async function rows<T = Record<string, unknown>>(
  db: PGlite,
  q: string,
  params: unknown[] = [],
): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(q, params)).rows;
}

async function failure(
  p: Promise<unknown>,
): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code, message: String(err.message ?? e) };
  }
  throw new Error("Expected a refusal");
}

/** The browser's door, played against PGlite as the acting seat. */
function client(db: PGlite) {
  const keys: Record<string, string[]> = {
    cockpit_manual_payments_to_check: [],
    cockpit_manual_payment_check: [
      "p_id",
      "p_verdict",
      "p_ref",
      "p_statement_line_id",
    ],
    cockpit_form_doors: [],
  };
  return {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (!keys[name])
        return {
          data: null,
          error: { message: `Unknown function ${name}`, code: "42883" },
        };
      expect(Object.keys(args).sort()).toEqual([...keys[name]].sort());
      try {
        const r = await db.query<{ r: unknown }>(
          `SELECT public.${name}(${keys[name].map((k, i) => `${k}=>$${i + 1}`).join(",")}) AS r`,
          keys[name].map(k => args[k]),
        );
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, code: err.code } };
      }
    },
  } as unknown as Parameters<typeof manualPaymentsToCheck>[0];
}

async function beginRefresh(db: PGlite): Promise<string> {
  await service(db);
  return (
    await db.query<{ r: { id: string } }>(
      "SELECT public.cockpit_ceo_worker_begin_finance_refresh() AS r",
    )
  ).rows[0].r.id;
}

function output(
  payments: Record<string, unknown>[],
  dealPayments: Record<string, unknown>[] = [],
) {
  return {
    sections: [
      {
        key: "money",
        label: "Money",
        payload: {
          attribution: { transactions: [] },
          rails: { manual: { connected: true }, tap: { connected: true } },
        },
        sources: [{ name: "Fixture", ok: true }],
      },
      {
        key: "expenses",
        label: "Expenses",
        payload: { month: "2026-11" },
        sources: [{ name: "Fixture", ok: true }],
      },
    ],
    payments,
    dealPayments,
  };
}

async function finish(db: PGlite, id: string, out: unknown) {
  await service(db);
  return (
    await db.query<{ r: unknown }>(
      "SELECT public.cockpit_finish_finance_refresh($1::uuid,$2::jsonb) AS r",
      [id, JSON.stringify(out)],
    )
  ).rows[0].r;
}

const today = async (db: PGlite) =>
  (
    await rows<{ d: string }>(
      db,
      "SELECT ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text AS d",
    )
  )[0].d;

describe("20261101n on the ledger as the contract read it", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb({ ninth: true });
    await db.exec(migration(N));
  }, 120000);
  afterAll(async () => {
    await db.close();
  });

  test("Q20: exactly the 8 ids are checked with the reference, and checked cash is today's $21,239.16", async () => {
    const checked = await rows<{
      id: string;
      checked_ref: string;
      checked_by: string;
    }>(
      db,
      "SELECT id, checked_ref, checked_by FROM cockpit_manual_payments WHERE check_state='checked' ORDER BY id",
    );
    expect(checked.map(r => r.id).sort()).toEqual(Q20.map(r => r.id).sort());
    expect(new Set(checked.map(r => r.checked_ref))).toEqual(
      new Set([Q20_REF]),
    );
    expect(new Set(checked.map(r => r.checked_by))).toEqual(
      new Set(["migration 20261101n (Q20)"]),
    );
    const [sum] = await rows<{ usd: string }>(
      db,
      "SELECT sum(amount_usd)::text AS usd FROM cockpit_manual_payments WHERE check_state='checked'",
    );
    expect(Number(sum.usd)).toBe(Q20_USD);
    // The rows the last refresh wrote keep counting: the 8 checked, the rail payment checked.
    const cp = await rows<{ payment_id: string; checked: boolean }>(
      db,
      "SELECT payment_id, checked FROM cockpit_client_payments ORDER BY payment_id",
    );
    expect(cp.filter(r => r.checked).length).toBe(9);
    expect(
      Number(
        (
          await rows<{ s: string }>(
            db,
            "SELECT sum(usd)::text s FROM cockpit_client_payments WHERE checked AND rail='manual'",
          )
        )[0].s,
      ),
    ).toBe(Q20_USD);
  });

  test("a ninth row added before the apply stays logged, with no check time, and is not checked money", async () => {
    const [r] = await rows<{ check_state: string; checked_at: string | null }>(
      db,
      "SELECT check_state, checked_at FROM cockpit_manual_payments WHERE id='ninth-after-the-read'",
    );
    expect(r).toEqual({ check_state: "logged", checked_at: null });
    expect(
      (
        await rows<{ checked: boolean }>(
          db,
          "SELECT checked FROM cockpit_client_payments WHERE payment_id='manual:ninth-after-the-read'",
        )
      )[0].checked,
    ).toBe(false);
  });

  test("the inbox: rows 2, 3 and 5 checked, row 4 rejected", async () => {
    expect(
      await rows(
        db,
        "SELECT id::int AS id, check_state FROM cockpit_billing_inbox ORDER BY id",
      ),
    ).toEqual([
      { id: 2, check_state: "checked" },
      { id: 3, check_state: "checked" },
      { id: 4, check_state: "rejected" },
      { id: 5, check_state: "checked" },
    ]);
  });

  test("Q20 audits each row as a check, never as a restore, and moves the finance revision", async () => {
    const audit = await rows<{ action: string; n: number }>(
      db,
      "SELECT action, count(*)::int AS n FROM cockpit_audit_log WHERE entity_type='cockpit_manual_payments' AND action<>'manualPayment.add' GROUP BY action",
    );
    expect(audit).toEqual([{ action: "billing.payment_check", n: 8 }]);
  });

  test("the CHECK is in place and holds: a logged row has no check time, a checked one has one", async () => {
    const [c] = await rows<{ def: string }>(
      db,
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='cockpit_manual_payments_checked_when'",
    );
    expect(c.def).toContain("check_state = 'logged'");
    const bad = await failure(
      db.query(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,rail,added_by,check_state)
      VALUES('bad-check','2026-10-31',1,'USD',1,1,'Acme','acme','cash','fixture','checked')`),
    );
    expect(bad.code).toBe("23514");
  });

  test("forms.doors gains checks without losing the other markers", async () => {
    expect(
      (
        await rows<{ value: unknown }>(
          db,
          "SELECT value FROM cockpit_settings WHERE key='forms.doors'",
        )
      )[0].value,
    ).toEqual({ churn: false, checks: true });
    expect(
      (
        await rows<{ n: number }>(
          db,
          "SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='cockpit_settings' AND entity_id='forms.doors' AND actor_email='migration 20261101n'",
        )
      )[0].n,
    ).toBe(1);
  });

  test("the file applies a second time and changes nothing", async () => {
    const before = await rows(
      db,
      "SELECT id, check_state, checked_at::text FROM cockpit_manual_payments ORDER BY id",
    );
    const audits = (
      await rows<{ n: number }>(
        db,
        "SELECT count(*)::int n FROM cockpit_audit_log",
      )
    )[0].n;
    await db.exec(migration(N));
    expect(
      await rows(
        db,
        "SELECT id, check_state, checked_at::text FROM cockpit_manual_payments ORDER BY id",
      ),
    ).toEqual(before);
    expect(
      (
        await rows<{ n: number }>(
          db,
          "SELECT count(*)::int n FROM cockpit_audit_log",
        )
      )[0].n,
    ).toBe(audits);
  });

  test("grants: the doors to signed-in seats, the writers to the service role, the helpers to nobody", async () => {
    const can = async (role: string, fn: string) =>
      (
        await rows<{ ok: boolean }>(
          db,
          `SELECT has_function_privilege('${role}','public.${fn}','EXECUTE') AS ok`,
        )
      )[0].ok;
    const expected: Record<string, string[]> = {
      "cockpit_manual_payment_check(text,text,text,text)": ["authenticated"],
      "cockpit_manual_payments_to_check()": ["authenticated"],
      "cockpit_ceo_manual_payment_add(jsonb,uuid)": ["authenticated"],
      "cockpit_billing_balances_read()": ["authenticated"],
      "cockpit_csm_projection_read(text,text)": ["authenticated"],
      "cockpit_csm_projection_refresh_billing()": ["authenticated"],
      "cockpit_billing_ingest_inbox(boolean,integer)": ["service_role"],
      "cockpit_finish_finance_refresh(uuid,jsonb,text)": ["service_role"],
      "cockpit_manual_payment_protect()": ["service_role"],
      "cockpit_billing_deal_rails_held(text,text)": [],
      "cockpit_billing_deal_assignments()": [],
      "cockpit_csm_projection_facts(jsonb)": [],
      "cockpit_payment_checked(text,text)": [],
      "cockpit_payment_row_checked(text)": [],
    };
    for (const [fn, roles] of Object.entries(expected))
      for (const role of ["anon", "authenticated", "service_role"])
        expect([fn, role, await can(role, fn)]).toEqual([
          fn,
          role,
          roles.includes(role),
        ]);
    // Dropped and made again, the reader keeps the owner-only grant it had live.
    const [acl] = await rows<{ acl: string }>(
      db,
      "SELECT proacl::text AS acl FROM pg_proc WHERE oid='public.cockpit_billing_deal_rails_held(text,text)'::regprocedure",
    );
    expect(acl.acl).toMatch(/^\{[a-z_]+=X\/[a-z_]+\}$/);
  });

  test("the check door: finance checks with a reference, the CEO rejects with a reason, each once", async () => {
    const c = client(db);
    await actor(db, FINANCE);
    const waiting = await manualPaymentsToCheck(c);
    expect(waiting.map(r => r.id)).toEqual(["ninth-after-the-read"]);
    expect(waiting[0]).toMatchObject({
      clientName: "Acme",
      taskId: "task_a",
      amountUsd: 500,
      rail: "bank_transfer",
      addedBy: "Imported",
    });
    const revision = Number(
      (
        await rows<{ r: string }>(
          db,
          "SELECT revision::text r FROM cockpit_manual_payment_state",
        )
      )[0].r,
    );
    await actor(db, FINANCE);
    const done = await checkManualPayment(c, {
      id: "ninth-after-the-read",
      verdict: "checked",
      ref: "CBK FT2611010042",
    });
    expect(done).toMatchObject({
      id: "ninth-after-the-read",
      state: "checked",
      sentence: "Checked",
    });
    const [row] = await rows<Record<string, unknown>>(
      db,
      "SELECT check_state, checked_by, checked_ref, statement_line_id FROM cockpit_manual_payments WHERE id='ninth-after-the-read'",
    );
    expect(row).toEqual({
      check_state: "checked",
      checked_by: "fin@tests.invalid",
      checked_ref: "CBK FT2611010042",
      statement_line_id: null,
    });
    expect(
      Number(
        (
          await rows<{ r: string }>(
            db,
            "SELECT revision::text r FROM cockpit_manual_payment_state",
          )
        )[0].r,
      ),
    ).toBe(revision + 1);
    const audit = await rows<{ action: string; what: string }>(
      db,
      "SELECT action, metadata->>'what' AS what FROM cockpit_audit_log WHERE entity_type='cockpit_manual_payments' AND entity_id='ninth-after-the-read' ORDER BY created_at",
    );
    expect(audit.map(a => a.action)).toEqual([
      "manualPayment.add",
      "billing.payment_check",
    ]);
    expect(audit[1].what).toContain("bank reference CBK FT2611010042");
    // A second check is refused with the day it was checked.
    await actor(db, FINANCE);
    const again = await checkManualPayment(c, {
      id: "ninth-after-the-read",
      verdict: "rejected",
      ref: "Not on the statement",
    }).catch(e => e);
    expect(again).toBeInstanceOf(PaymentCheckError);
    expect(again.message).toMatch(
      /^This payment was already checked on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/,
    );
    await actor(db, FINANCE);
    expect(await manualPaymentsToCheck(c)).toEqual([]);
  });

  test("the check door refuses a CSM, a buyer, anon, and a check that names nothing", async () => {
    await owner(db);
    await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
      VALUES('door-test','2026-10-31',300,'USD',300,1,'Beta Co','betaco','task_b','cash','fixture')`);
    const c = client(db);
    for (const who of [CSM, BUYER]) {
      await actor(db, who);
      const r = await failure(
        checkManualPayment(c, {
          id: "door-test",
          verdict: "checked",
          ref: "CBK 123",
        }),
      );
      expect(r.message).toBe(
        "Only finance or the CEO checks a payment against the bank.",
      );
    }
    await actor(db, null);
    expect(
      (
        await failure(
          db.query(
            "SELECT public.cockpit_manual_payment_check('door-test','checked','CBK 123',NULL)",
          ),
        )
      ).code,
    ).toBe("42501");
    await actor(db, FINANCE);
    expect(
      (
        await failure(
          checkManualPayment(c, { id: "door-test", verdict: "checked" }),
        )
      ).message,
    ).toBe(
      "Name the bank reference or pick the statement line, so the check reads back.",
    );
    await actor(db, FINANCE);
    expect(
      (
        await failure(
          checkManualPayment(c, { id: "door-test", verdict: "rejected" }),
        )
      ).message,
    ).toBe(
      "Say why it is rejected (3 to 200 characters), so the log reads back.",
    );
    await actor(db, FINANCE);
    expect(
      (
        await failure(
          checkManualPayment(c, {
            id: "door-test",
            verdict: "checked",
            statementLineId: "424242",
          }),
        )
      ).message,
    ).toBe(
      "That statement line is not money in on an uploaded statement. Pick it again.",
    );
    await actor(db, CEO);
    expect(
      await checkManualPayment(c, {
        id: "door-test",
        verdict: "rejected",
        ref: "Client says it was never sent",
      }),
    ).toMatchObject({ state: "rejected", sentence: "Rejected" });
    expect(
      (
        await rows<{ checked: boolean }>(
          db,
          "SELECT public.cockpit_payment_checked('manual:door-test','manual') AS checked",
        )
      )[0].checked,
    ).toBe(false);
  });

  test("the list: finance and the CEO see every logged row, a CSM their own clients', a buyer none", async () => {
    await owner(db);
    await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by,request_id,request_data)
      VALUES('list-acme','2026-10-31',200,'KWD',652,3.26,'Acme','acme','task_a','cheque','aziz@maharamedia.com',gen_random_uuid(),'{"reference":"CHQ 0042"}'),
            ('list-beta','2026-10-31',100,'USD',100,1,'Beta Co','betaco','task_b','cash','fixture',NULL,NULL)`);
    const c = client(db);
    await actor(db, CEO);
    expect((await manualPaymentsToCheck(c)).map(r => r.id).sort()).toEqual([
      "list-acme",
      "list-beta",
    ]);
    await actor(db, CSM);
    const mine = await manualPaymentsToCheck(c);
    expect(mine.map(r => r.id)).toEqual(["list-acme"]);
    expect(mine[0]).toMatchObject({
      addedBy: "The CEO",
      reference: "CHQ 0042",
      currency: "KWD",
      amount: 200,
      amountUsd: 652,
    });
    await actor(db, OTHER_CSM);
    expect((await manualPaymentsToCheck(c)).map(r => r.id)).toEqual([
      "list-beta",
    ]);
    await actor(db, BUYER);
    expect((await failure(manualPaymentsToCheck(c))).message).toMatch(
      /finance, client success or CEO seat/,
    );
  });

  test("the protect trigger: only the door moves the check columns, once, and nothing else moves", async () => {
    await owner(db);
    await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
      VALUES('protect-test','2026-10-31',50,'USD',50,1,'Acme','acme','task_a','cash','fixture')`);
    const immutable = /immutable; remove and re-enter instead/;
    expect(
      (
        await failure(
          db.exec(
            "UPDATE cockpit_manual_payments SET check_state='checked', checked_at=now() WHERE id='protect-test'",
          ),
        )
      ).message,
    ).toMatch(immutable);
    expect(
      (
        await failure(
          db.exec(
            "UPDATE cockpit_manual_payments SET amount_usd=51 WHERE id='protect-test'",
          ),
        )
      ).message,
    ).toMatch(immutable);
    await db.exec(
      "BEGIN; SELECT set_config('cockpit.payment_check','another-id',true);",
    );
    expect(
      (
        await failure(
          db.exec(
            "UPDATE cockpit_manual_payments SET check_state='checked', checked_at=now() WHERE id='protect-test'",
          ),
        )
      ).message,
    ).toMatch(immutable);
    await db.exec("ROLLBACK");
    await db.exec(
      "BEGIN; SELECT set_config('cockpit.payment_check','protect-test',true);",
    );
    expect(
      (
        await failure(
          db.exec(
            "UPDATE cockpit_manual_payments SET check_state='checked', checked_at=now(), deleted_at=now(), deleted_by='x' WHERE id='protect-test'",
          ),
        )
      ).message,
    ).toMatch(immutable);
    await db.exec("ROLLBACK");
    // Remove and restore stay free, and leave the payment's own audit rows.
    await db.exec(
      "UPDATE cockpit_manual_payments SET deleted_at=now(), deleted_by='fixture', delete_reason='Typed twice' WHERE id='protect-test'",
    );
    await db.exec(
      "UPDATE cockpit_manual_payments SET deleted_at=NULL, deleted_by=NULL, delete_reason=NULL WHERE id='protect-test'",
    );
    expect(
      (
        await rows<{ action: string }>(
          db,
          "SELECT action FROM cockpit_audit_log WHERE entity_id='protect-test' ORDER BY created_at",
        )
      ).map(a => a.action),
    ).toEqual([
      "manualPayment.add",
      "manualPayment.remove",
      "manualPayment.restore",
    ]);
    // A checked row never moves again, not even back to logged.
    await db.exec(
      "BEGIN; SELECT set_config('cockpit.payment_check','protect-test',true); UPDATE cockpit_manual_payments SET check_state='checked', checked_at=now(), checked_ref='CBK 9' WHERE id='protect-test'; COMMIT;",
    );
    await db.exec(
      "BEGIN; SELECT set_config('cockpit.payment_check','protect-test',true);",
    );
    expect(
      (
        await failure(
          db.exec(
            "UPDATE cockpit_manual_payments SET check_state='logged', checked_at=NULL WHERE id='protect-test'",
          ),
        )
      ).message,
    ).toMatch(immutable);
    await db.exec("ROLLBACK");
  });

  test("the CEO's own entry is checked with a bank reference, logged without one", async () => {
    await actor(db, CEO);
    const day = await today(db);
    const add = async (input: Record<string, unknown>) =>
      (
        await db.query<{ id: string }>(
          "SELECT public.cockpit_ceo_manual_payment_add($1::jsonb, gen_random_uuid()) AS id",
          [JSON.stringify(input)],
        )
      ).rows[0].id;
    const base = {
      day,
      amount: 700,
      currency: "USD",
      rail: "bank_transfer",
      clientName: "Gamma Build",
      clickupTaskId: "task_c",
    };
    const withRef = await add({ ...base, reference: "CBK FT26110199" });
    await actor(db, CEO);
    const withoutRef = await add({ ...base, amount: 701 });
    await actor(db, CEO);
    expect(
      (await failure(add({ ...base, amount: 702, reference: "ab" }))).message,
    ).toMatch(/whole bank reference/);
    const got = await rows<Record<string, unknown>>(
      db,
      "SELECT id, check_state, checked_by, checked_ref, checked_at IS NOT NULL AS has_time FROM cockpit_manual_payments WHERE id = ANY($1) ORDER BY amount",
      [[withRef, withoutRef]],
    );
    expect(got).toEqual([
      {
        id: withRef,
        check_state: "checked",
        checked_by: "aziz@maharamedia.com",
        checked_ref: "CBK FT26110199",
        has_time: true,
      },
      {
        id: withoutRef,
        check_state: "logged",
        checked_by: null,
        checked_ref: null,
        has_time: false,
      },
    ]);
  });

  test("the drift guard refuses a body changed since the contract read it, and nothing applies", async () => {
    await owner(db);
    await db.exec("BEGIN");
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_billing_deal_assignments()
      RETURNS TABLE(deal_response_id text, signed_at timestamptz, clickup_task_id text, matched_by text, conflict boolean, conflict_with text[], linked_by text, link_id bigint)
      LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT NULL::text, NULL::timestamptz, NULL::text, NULL::text, false, '{}'::text[], NULL::text, NULL::bigint WHERE false $$;`);
    const r = await failure(
      db.exec(
        migration(N)
          .replace(/^BEGIN;$/m, "")
          .replace(/^COMMIT;$/m, ""),
      ),
    );
    await db.exec("ROLLBACK");
    expect(r.code).toBe("55000");
    expect(r.message).toBe(
      "cockpit_billing_deal_assignments() changed since the waves 1-2 contract read it; stop and re-read it.",
    );
  });
});

describe("the Q20 guard", () => {
  test("a changed Q20 set stops the file and leaves every row as it was", async () => {
    const db = await freshDb({ changeQ20: true });
    try {
      const r = await failure(db.exec(migration(N)));
      await db.exec("ROLLBACK").catch(() => {});
      expect(r.code).toBe("55000");
      expect(r.message).toBe(
        "The Q20 rows changed since the contract read them; stop and re-read.",
      );
      expect(
        (
          await rows<{ n: number }>(
            db,
            "SELECT count(*)::int n FROM information_schema.columns WHERE table_name='cockpit_manual_payments' AND column_name='check_state'",
          )
        )[0].n,
      ).toBe(0);
    } finally {
      await db.close();
    }
  }, 120000);

  test("a database with none of the 8 rows marks nothing, and its rows start logged", async () => {
    const db = await freshDb({ q20: false });
    try {
      await owner(db);
      await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
        VALUES('other-ledger','2026-10-31',10,'USD',10,1,'Acme','acme','task_a','cash','fixture')`);
      await db.exec(migration(N));
      expect(
        await rows(db, "SELECT id, check_state FROM cockpit_manual_payments"),
      ).toEqual([{ id: "other-ledger", check_state: "logged" }]);
    } finally {
      await db.close();
    }
  }, 120000);
});

describe("a payment logged by a CSM, from the inbox to the check", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await db.exec(migration(N));
    // The CSM's log, as the billing sheet's write puts it in the inbox; a seed-day deal for Acme.
    await owner(db);
    await db.exec(`
      INSERT INTO cockpit_billing_inbox(clickup_task_id,client_name,paid_on,amount,currency,method,reference,evidence_url,source,logged_by)
        VALUES('task_a','Acme',((now() AT TIME ZONE 'Asia/Kuwait')::date - 1),1000,'USD','bank_transfer','FT-ACME-77','https://example.test/receipt.pdf','csm','sara@tests.invalid');
      INSERT INTO cockpit_sales_deals(response_id,submitted_at,closer,client_name,business_name,payment_structure,cash_collected,contracted_revenue,voided)
        VALUES('resp_acme','2026-10-20T09:00:00Z','Closer One','Contact Alpha','Acme','Paid in full',500,3000,false);
      INSERT INTO cockpit_csm_source_state(table_name,ready,source_snapshot_at,row_count)
        SELECT t, true, now(), 0 FROM unnest(ARRAY['clients','decisions','appointments','clientProfiles']) t
        ON CONFLICT (table_name) DO UPDATE SET ready=true, source_snapshot_at=excluded.source_snapshot_at, row_count=0;`);
  }, 120000);
  afterAll(async () => {
    await db.close();
  });

  const ledgerId = async () =>
    (
      await rows<{ id: string }>(
        db,
        "SELECT id FROM cockpit_manual_payments WHERE source_deployment='billing-inbox' AND source_id=(SELECT max(id)::text FROM cockpit_billing_inbox)",
      )
    )[0]?.id;

  test("ingest takes it in as logged; the inbox row says the same", async () => {
    await service(db);
    const r = (
      await db.query<{ r: { ingested: number } }>(
        "SELECT public.cockpit_billing_ingest_inbox(true, 50) AS r",
      )
    ).rows[0].r;
    expect(r.ingested).toBe(1);
    const id = await ledgerId();
    expect(id).toBeTruthy();
    expect(
      (
        await rows(
          db,
          "SELECT check_state FROM cockpit_manual_payments WHERE id=$1",
          [id],
        )
      )[0],
    ).toEqual({ check_state: "logged" });
    expect(
      (
        await rows(
          db,
          "SELECT check_state FROM cockpit_billing_inbox WHERE ledger_id=$1",
          [id],
        )
      )[0],
    ).toEqual({ check_state: "logged" });
  });

  test("the refresh lands it not checked, whatever its output says, and keeps it out of the deal ledger", async () => {
    const id = await ledgerId();
    const day = await today(db);
    const job = await beginRefresh(db);
    await finish(
      db,
      job,
      output(
        [
          {
            payment_id: `manual:${id}`,
            clickup_task_id: "task_a",
            client_name: "Acme",
            day,
            usd: 1000,
            rail: "manual",
            side: "back_end",
            kind: "client",
            person: null,
            checked: true,
          },
          {
            payment_id: "whop:pay_acme1",
            clickup_task_id: "task_a",
            client_name: "Acme",
            day,
            usd: 400,
            rail: "whop",
            side: "front_end",
            kind: "deposit",
            person: "Closer One",
          },
        ],
        [
          {
            payment_id: `manual:${id}`,
            deal_response_id: "resp_acme",
            day,
            usd: 1000,
            rail: "manual",
            kind: "remainder",
            deposit_usd: 0,
            matched_by: "card_typed",
          },
          {
            payment_id: "whop:pay_acme1",
            deal_response_id: "resp_acme",
            day,
            usd: 400,
            rail: "whop",
            kind: "deposit",
            deposit_usd: 400,
            matched_by: "deal_id",
          },
        ],
      ),
    );
    expect(
      await rows(
        db,
        "SELECT payment_id, checked FROM cockpit_client_payments WHERE active AND clickup_task_id='task_a' ORDER BY payment_id",
      ),
    ).toEqual([
      { payment_id: `manual:${id}`, checked: false },
      { payment_id: "whop:pay_acme1", checked: true },
    ]);
    expect(
      (
        await rows<{ payment_id: string }>(
          db,
          "SELECT payment_id FROM cockpit_deal_payments WHERE active ORDER BY payment_id",
        )
      ).map(r => r.payment_id),
    ).toEqual(["whop:pay_acme1"]);
  });

  test("Pending payments: the deal's rails carry it as not checked; the match counts checked money only", async () => {
    const id = await ledgerId();
    const held = await rows<{
      payment_id: string;
      checked: boolean;
      from_ledger: boolean;
    }>(
      db,
      "SELECT payment_id, checked, from_ledger FROM public.cockpit_billing_deal_rails_held('resp_acme','task_a') ORDER BY payment_id",
    );
    expect(held).toEqual([
      { payment_id: `manual:${id}`, checked: false, from_ledger: false },
      { payment_id: "whop:pay_acme1", checked: true, from_ledger: true },
    ]);
    await actor(db, CSM);
    const read = (
      await db.query<{
        r: { rails: { paymentId: string; checked: boolean }[] };
      }>("SELECT public.cockpit_billing_balances_read() AS r")
    ).rows[0].r;
    const rails = read.rails.filter(
      r => r.paymentId.endsWith(id) || r.paymentId === "whop:pay_acme1",
    );
    expect(rails.map(r => [r.paymentId, r.checked]).sort()).toEqual(
      [
        [`manual:${id}`, false],
        ["whop:pay_acme1", true],
      ].sort(),
    );
  });

  test("the CSM projections: collected is checked money; the receipt is on its own line", async () => {
    const id = await ledgerId();
    await actor(db, CEO);
    const r = (
      await db.query<{
        r: {
          feed: {
            payments: { id: string }[];
            logged: { id: string; note: string }[];
          };
        };
      }>("SELECT public.cockpit_csm_projection_read(NULL, NULL) AS r")
    ).rows[0].r;
    expect(r.feed.payments.map(p => p.id)).not.toContain(`manual:${id}`);
    expect(r.feed.payments.map(p => p.id)).toContain("whop:pay_acme1");
    expect(r.feed.logged).toEqual([
      expect.objectContaining({
        id: `manual:${id}`,
        note: "Receipt in, not checked",
      }),
    ]);
    await owner(db);
    const facts = (
      await db.query<{ f: { label: string; value: string }[] }>(
        `SELECT public.cockpit_csm_projection_facts('{"taskId":"task_a","name":"Acme"}'::jsonb) AS f`,
      )
    ).rows[0].f;
    // The refresh rewrote the twelve months, so the whop deposit is the card's only checked payment now.
    expect(facts.find(f => f.label === "Paid so far")?.value).toMatch(
      /^\$400(\.00)?$/,
    );
    expect(
      facts.find(f => f.label === "Receipt in, not checked")?.value,
    ).toMatch(/^\$1000(\.00)?$/);
  });

  test("once finance checks it, the next refresh counts it: client payment, deal ledger, projections", async () => {
    const id = await ledgerId();
    await actor(db, FINANCE);
    await checkManualPayment(client(db), {
      id,
      verdict: "checked",
      ref: "FT-ACME-77",
    });
    expect(
      (
        await rows(
          db,
          "SELECT check_state FROM cockpit_billing_inbox WHERE ledger_id=$1",
          [id],
        )
      )[0],
    ).toEqual({ check_state: "checked" });
    const day = await today(db);
    const job = await beginRefresh(db);
    await finish(
      db,
      job,
      output(
        [
          {
            payment_id: `manual:${id}`,
            clickup_task_id: "task_a",
            client_name: "Acme",
            day,
            usd: 1000,
            rail: "manual",
            side: "back_end",
            kind: "client",
            person: null,
          },
        ],
        [
          {
            payment_id: `manual:${id}`,
            deal_response_id: "resp_acme",
            day,
            usd: 1000,
            rail: "manual",
            kind: "remainder",
            deposit_usd: 0,
            matched_by: "card_typed",
          },
        ],
      ),
    );
    expect(
      (
        await rows(
          db,
          "SELECT checked FROM cockpit_client_payments WHERE payment_id=$1",
          [`manual:${id}`],
        )
      )[0],
    ).toEqual({ checked: true });
    expect(
      (
        await rows<{ payment_id: string }>(
          db,
          "SELECT payment_id FROM cockpit_deal_payments WHERE active",
        )
      ).map(r => r.payment_id),
    ).toEqual([`manual:${id}`]);
  });

  test("a check made while a refresh runs fails that refresh's write, so it reruns", async () => {
    await owner(db);
    await db.exec(`INSERT INTO cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,added_by)
      VALUES('race-test','2026-10-31',80,'USD',80,1,'Acme','acme','task_a','cash','fixture')`);
    const job = await beginRefresh(db);
    await actor(db, FINANCE);
    await checkManualPayment(client(db), {
      id: "race-test",
      verdict: "checked",
      ref: "CBK 80",
    });
    const r = await failure(finish(db, job, output([])));
    expect(r.message).toMatch(/changed/);
  });
});
