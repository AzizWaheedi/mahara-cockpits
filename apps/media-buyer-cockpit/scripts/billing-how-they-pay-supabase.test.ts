import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { METHODS, PLANS } from "../src/lib/billingCore";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

// How they pay on the ClickUp card (supabase/migrations/20261103a_how_they_pay_card.sql): the
// deploy connection's canary takes method, plan and amount on the test card only, checked as
// cockpit_billing_write checks them, and each one queues the same card write a real save queues.
// The ground is billing-rails-supabase.test.ts's (20261009a, f and j, then 20261101m), with
// 20261102g's trigger, write map, comment, detail and canary on top, exactly as they are live.
// No test reaches ClickUp: the queue rows are read back.

setDefaultTimeout(120_000);

const CEO = "00000000-0000-4000-8000-000000000001";
const TEST_CARD = "86eywg1cq";
const FILE = "20261103a_how_they_pay_card.sql";
const G = "20261102g_money_rails_w5.sql";
/** cockpit_billing_canary as 20261102g left it, which is the body read live on 2026-11-03. */
const LIVE_MD5 = "c73b594b4589bf2b17f3b55e30025333";

function withoutCron(text: string): string {
  const start = text.indexOf("-- cron:begin");
  if (start < 0) return text;
  const end = text.indexOf("-- cron:end", start);
  if (end < 0) throw new Error("The schedule block is missing its end marker");
  return text.slice(0, start) + text.slice(end + "-- cron:end".length);
}

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit)
    throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

/** billing-rails-supabase.test.ts's base: 20261009a's billing tables and write, 20261009f's queue, 20261009j's write-back. */
async function base(): Promise<PGlite> {
  const db = await cockpitTestDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;",
  );
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
  await db.exec(
    extract(
      "20260927x_cockpit_native_media_sync.sql",
      /ALTER TABLE public\.cockpit_client_billing_days[\s\S]*?source_record jsonb;/,
    ),
  );
  await db.exec(
    extract(
      "20260919b_people.sql",
      /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i,
    ),
  );
  for (const f of [
    "20260921c_bank_statements.sql",
    "20260921d_cockpit_metrics.sql",
    "20260921a_cockpit_settings.sql",
    "20260921f_cockpit_feedback.sql",
    "20260922e_goals_and_people.sql",
    "20260921e_tap_charges.sql",
    "20260923a_client_billing.sql",
  ])
    await db.exec(migration(f));
  await db.exec(
    extract(
      "20261007d_cockpit_team_rpc_restore.sql",
      /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat() TO authenticated, service_role;",
  );
  await db.exec(
    extract(
      "20261011c_csm_call_store.sql",
      /ALTER TABLE public\.cockpit_sync_state ADD COLUMN IF NOT EXISTS detail jsonb;/,
    ),
  );
  await db.exec(
    extract(
      "20260924r_billing_and_comms_access.sql",
      /-- 1\. Cockpit Billing Accounts[\s\S]*?(?=-- 4\. WhatsApp)/,
    ),
  );
  await db.exec(
    extract(
      "20260926m_cockpit_csm_state.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;",
  );
  await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
  await db.exec(migration("20260927h_cockpit_ceo_actions.sql"));
  await db.exec(withoutCron(migration("20261009a_billing_native_sync.sql")));
  await db.exec(migration("20261009h_billing_browser_writes_closed.sql"));
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
  // The live kind list (11.2-d): 20261023x and 20261024p widened 20261009a's.
  await db.exec(`ALTER TABLE cockpit_billing_events DROP CONSTRAINT cockpit_billing_events_kind_check;
    ALTER TABLE cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN ('amount','assign','chase','churn','confirm','date','exclude','extension','invoice','link','method','note','pause','payment','plan','resume','unconfirm','unexclude','unlink'));`);
  return db;
}

/** 20261102g's own definitions of what a canary event runs through, then its grants for them. */
function waves56(): string {
  return [
    extract(
      G,
      /DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback[\s\S]*?EXECUTE FUNCTION public\.cockpit_billing_writeback_enqueue\(\);/,
    ),
    ...[
      "cockpit_billing_writeback_writes",
      "cockpit_billing_writeback_comment",
      "cockpit_billing_detail",
      "cockpit_billing_canary",
    ].map(fn =>
      extract(
        G,
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$function\\$;`,
        ),
      ),
    ),
    "REVOKE ALL ON FUNCTION public.cockpit_billing_detail(text,jsonb), public.cockpit_billing_canary(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;",
  ].join("\n");
}

let db: PGlite;

/** The owner with no signed-in seat: the deploy connection runs as this. */
async function deploy() {
  await owner(db);
  await db.query(
    "SELECT set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims','',false)",
  );
}
const rows = async (sql: string, params: unknown[] = []) => {
  await deploy();
  return (await db.query<Record<string, any>>(sql, params)).rows;
};
const one = async (sql: string, params: unknown[] = []) =>
  (await rows(sql, params))[0];
const val = async (sql: string, params: unknown[] = []) =>
  Object.values((await rows(sql, params))[0] ?? {})[0];
const md5Of = () =>
  val(
    "SELECT md5(regexp_replace(p.prosrc,'\\s+',' ','g')) FROM pg_proc p WHERE p.oid=to_regprocedure('public.cockpit_billing_canary(text,jsonb)')",
  );
const canary = async (kind: string, args: Record<string, unknown>) =>
  Number(
    await val("SELECT cockpit_billing_canary($1, $2::jsonb)", [
      kind,
      JSON.stringify(args),
    ]),
  );
const events = async () =>
  Number(await val("SELECT count(*) FROM cockpit_billing_events"));

async function refused(
  sql: string,
  params: unknown[] = [],
): Promise<{ message: string; code?: string }> {
  try {
    await (params.length || !sql.includes(";")
      ? db.query(sql, params)
      : db.exec(sql));
  } catch (e) {
    const err = e as { message: string; code?: string };
    return { message: err.message, code: err.code };
  }
  throw new Error(`Expected the server to refuse: ${sql}`);
}
const refusedCanary = async (kind: string, args: Record<string, unknown>) => {
  await deploy();
  return refused("SELECT cockpit_billing_canary($1, $2::jsonb)", [
    kind,
    JSON.stringify(args),
  ]);
};

/** The event a canary wrote and the queue row the trigger made for it. */
async function written(id: number) {
  const e = await one(
    "SELECT clickup_task_id, client_name, kind, from_value, to_value, source, by_whom FROM cockpit_billing_events WHERE id=$1",
    [id],
  );
  const q = await one(
    "SELECT kind, task_id, payload FROM cockpit_clickup_writeback_queue WHERE source_id=$1",
    [String(id)],
  );
  return { e, q };
}

beforeAll(async () => {
  db = await base();
  await db.exec(withoutCron(migration("20261101m_billing_rails.sql")));
  await db.exec(waves56());
  await member(db, CEO, "aziz@maharamedia.com", []);
  await owner(db);
  expect(await md5Of()).toBe(LIVE_MD5);
  await db.exec(migration(FILE));
}, 300_000);
afterAll(async () => {
  await db?.close();
});

describe("20261103a applies over the live canary", () => {
  test("it is one transaction, its after-md5 is the body it installs, and a second apply changes nothing", async () => {
    const text = migration(FILE);
    expect(text.split("\n").find(l => l.trim() && !l.startsWith("--"))).toBe(
      "BEGIN;",
    );
    expect(text.trimEnd().endsWith("COMMIT;")).toBe(true);
    const guard = text.match(/NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/);
    expect(guard?.[1]).toBe(LIVE_MD5);
    const after = await md5Of();
    expect(after).toBe(guard?.[2]);
    await db.exec(migration(FILE));
    expect(await md5Of()).toBe(after);
  });

  test("it replaces only the canary: no write door, trigger, write map or enqueue function", () => {
    const code = migration(FILE)
      .split("\n")
      .filter(l => !l.trim().startsWith("--"))
      .join("\n");
    expect(
      [
        ...code.matchAll(
          /CREATE (?:OR REPLACE )?FUNCTION (public\.[a-z_]+)\(/g,
        ),
      ].map(m => m[1]),
    ).toEqual(["public.cockpit_billing_canary"]);
    expect(code).not.toMatch(
      /TRIGGER|cockpit_billing_write\(|cockpit_billing_writeback_|GRANT |ALTER /,
    );
  });

  test("the canary stays owner only: no role may run it, and a signed-in session is refused inside", async () => {
    for (const role of ["anon", "authenticated", "service_role"])
      expect([
        role,
        await val(
          "SELECT has_function_privilege($1, 'public.cockpit_billing_canary(text,jsonb)', 'EXECUTE')",
          [role],
        ),
      ]).toEqual([role, false]);
    await actor(db, CEO);
    expect(
      (
        await refused(
          "SELECT cockpit_billing_canary('method','{\"to\":\"Card on file\"}')",
        )
      ).message,
    ).toContain("permission denied");
    // The owner's connection carrying a person's session is not the deploy connection.
    await owner(db);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      CEO,
    ]);
    expect(
      await refused(
        "SELECT cockpit_billing_canary('method','{\"to\":\"Card on file\"}')",
      ),
    ).toEqual({
      message: "The canary runs only through the deploy connection.",
      code: "42501",
    });
    await deploy();
  });
});

describe("How they pay on the test card", () => {
  test("a method is one CEO event on the test card, queued as Payment Method with no comment", async () => {
    const id = await canary("method", { to: "Card on file" });
    const { e, q } = await written(id);
    expect(e).toEqual({
      clickup_task_id: TEST_CARD,
      client_name: "Test card (canary)",
      kind: "method",
      from_value: null,
      to_value: "Card on file",
      source: "ceo",
      by_whom: "canary",
    });
    expect(q.kind).toBe("billing");
    expect(q.task_id).toBe(TEST_CARD);
    expect(q.payload).toMatchObject({
      eventId: id,
      taskId: TEST_CARD,
      kind: "method",
      source: "ceo",
      by: "canary",
      comment: null,
      note: null,
    });
    expect(q.payload.writes).toEqual([
      { field: "method", value: "Card on file", old: null },
    ]);
  });

  test("a plan is queued as Payment Plan, with what the card showed before when it is sent", async () => {
    const id = await canary("plan", {
      to: "Monthly",
      from: "Split Pay (2x payments)",
    });
    const { e, q } = await written(id);
    expect([e.kind, e.from_value, e.to_value]).toEqual([
      "plan",
      "Split Pay (2x payments)",
      "Monthly",
    ]);
    expect(q.payload.writes).toEqual([
      { field: "plan", value: "Monthly", old: "Split Pay (2x payments)" },
    ]);
    expect(q.payload.comment).toBeNull();
  });

  test("an amount is queued as the Next Payment Amount number, written as the real door writes it", async () => {
    const id = await canary("amount", { to: "1234" });
    const { e, q } = await written(id);
    expect([e.kind, e.to_value]).toEqual(["amount", "1234"]);
    expect(q.payload.writes).toEqual([
      { field: "nextAmount", value: 1234, old: null },
    ]);
    // Cents are kept, a trailing zero is not (cockpit_billing_write's trim_scale).
    const cents = await written(
      await canary("amount", { to: "1750.50", from: "1500" }),
    );
    expect(cents.e.to_value).toBe("1750.5");
    expect(cents.q.payload.writes).toEqual([
      { field: "nextAmount", value: 1750.5, old: 1500 },
    ]);
    expect(
      (await written(await canary("amount", { to: "100000" }))).e.to_value,
    ).toBe("100000");
  });

  test("every method and plan the cockpit offers is one the canary takes", async () => {
    for (const m of METHODS)
      expect(
        (await written(await canary("method", { to: m }))).e.to_value,
      ).toBe(m);
    for (const p of PLANS)
      expect((await written(await canary("plan", { to: p }))).e.to_value).toBe(
        p,
      );
  });

  test("what is not on the card, or not a real payment, is refused and writes nothing", async () => {
    const before = await events();
    const METHOD =
      "A method canary needs one of the payment methods on the card in to.";
    const PLAN =
      "A plan canary needs one of the payment plans on the card in to.";
    const AMOUNT =
      "An amount canary needs a dollar amount above 0 and up to 100000 in to.";
    for (const [kind, args, message] of [
      ["method", { to: "Ecom link" }, METHOD],
      ["method", { to: "Cash" }, METHOD],
      ["method", { to: "card on file" }, METHOD],
      ["method", {}, METHOD],
      ["plan", { to: "Weekly" }, PLAN],
      ["plan", { to: "" }, PLAN],
      ["amount", { to: "0" }, AMOUNT],
      ["amount", { to: "0.00" }, AMOUNT],
      ["amount", { to: "100000.01" }, AMOUNT],
      ["amount", { to: "12.345" }, AMOUNT],
      ["amount", { to: "-5" }, AMOUNT],
      ["amount", { to: "1,200" }, AMOUNT],
      ["amount", { to: "lots" }, AMOUNT],
      ["amount", {}, AMOUNT],
      [
        "method",
        { to: "Card on file", system: true },
        "Only an extension clear, a late event, a survey, NPS sent or LTV comes from the cockpit itself.",
      ],
      [
        "amount",
        { to: "1234", system: true },
        "Only an extension clear, a late event, a survey, NPS sent or LTV comes from the cockpit itself.",
      ],
      [
        "plan",
        { to: "Monthly", taskId: "task_a" },
        "The canary writes only the test card 86eywg1cq.",
      ],
      [
        "note",
        { to: "x" },
        "The canary takes churn, extension, pause, resume, mrr, late, date, survey, nps_sent, ltv, win, reactivate, method, plan or amount.",
      ],
    ] as const)
      expect([kind, args, await refusedCanary(kind, args)]).toEqual([
        kind,
        args,
        { message, code: "22023" },
      ]);
    expect(await events()).toBe(before);
  });

  test("the kinds it took before still behave as 20261102g had them", async () => {
    const id = await canary("date", { to: "2026-11-20", from: "2026-10-08" });
    expect((await written(id)).q.payload.writes).toEqual([
      { field: "nextDate", value: "2026-11-20", old: "2026-10-08" },
    ]);
    expect((await refusedCanary("ltv", { to: "10" })).message).toBe(
      "An LTV event comes from the cockpit itself: send system true.",
    );
    expect((await refusedCanary("date", { to: "soon" })).message).toBe(
      "A date canary needs the new day in to (YYYY-MM-DD).",
    );
  });
});

describe("the drift guard", () => {
  // Last: a refused file leaves its transaction to roll back.
  test("a canary changed by anyone else stops the file", async () => {
    await deploy();
    await db.exec(
      "CREATE OR REPLACE FUNCTION public.cockpit_billing_canary(p_kind text, p_args jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$",
    );
    const stop = await refused(migration(FILE));
    await db.exec("ROLLBACK");
    expect(stop).toEqual({
      message:
        "cockpit_billing_canary(text,jsonb) changed since How they pay read it; stop and re-read it.",
      code: "55000",
    });
    expect(await val("SELECT cockpit_billing_canary('method','{}')")).toBe(1);
  });
});
