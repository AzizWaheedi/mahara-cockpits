import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { runRefresh } from "./worker.ts";
import { createProviderDriver } from "./providerTools.ts";

type TestDb = PGlite;
type Fetcher = typeof fetch;
const fixtureNow = Date.now();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CEO refresh smoke failed: ${message}`);
}

function definition(sql: string, pattern: RegExp): string {
  const match = sql.match(pattern);
  if (!match) throw new Error(`Canonical SQL definition missing: ${pattern}`);
  return match[0];
}

async function prepareCanonicalDb(): Promise<TestDb> {
  const db = await cockpitTestDb();
  await db.exec(`
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
    CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT,INSERT ON storage.objects TO authenticated;
  `);
  const core = migration("20260919_cockpit_core.sql");
  for (const name of ["cockpit_client_billing_days", "cockpit_metric_days", "cockpit_payer_clients"]) {
    await db.exec(definition(core, new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`, "i")));
  }
  const manual = migration("20260927d_cockpit_manual_payments_access.sql");
  for (const [name, pattern] of [
    ["manual state", /CREATE TABLE IF NOT EXISTS public\.cockpit_manual_payment_state\([\s\S]*?\n\);/],
    ["manual payments", /CREATE TABLE IF NOT EXISTS public\.cockpit_manual_payments\([\s\S]*?\n\);/],
  ] as const) {
    await db.exec(definition(manual, pattern));
    void name;
  }
  const people = migration("20260919b_people.sql");
  await db.exec(definition(people, /create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i));
  for (const name of [
    "20260921c_bank_statements.sql",
    "20260921d_cockpit_metrics.sql",
    "20260921e_tap_charges.sql",
    "20260921a_cockpit_settings.sql",
    "20260921f_cockpit_feedback.sql",
    "20260922e_goals_and_people.sql",
    "20260927h_cockpit_ceo_actions.sql",
    "20260927i_cockpit_finance_refresh.sql",
    "20261005b_cockpit_ceo_refresh_worker.sql",
    "20261004z_native_monitor.sql",
  ]) await db.exec(migration(name));

  const today = new Date(Date.now() + 3 * 60 * 60_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const statementId = `smoke-account-${today.slice(0, 7)}`;
  // These readiness values belong to this isolated fixture, not the worker.
  await db.exec(`
    INSERT INTO public.cockpit_manual_payment_state(id,history_ready,revision,totals_revision)
      VALUES(true,true,1,0);
    UPDATE public.cockpit_finance_source_state SET aliases_ready=true,manual_ready=true WHERE id=true;
    INSERT INTO public.cockpit_statements(id,account,account_kind,currency,from_day,to_day,lines,imported_by)
      VALUES('${statementId}','XXXX4348','account','KWD','${monthStart}','${today}',2,'smoke');
    INSERT INTO public.cockpit_bank_lines(statement_id,account,account_kind,hash,day,amount,balance,reference,currency,usd,kind,category)
      VALUES('${statementId}','XXXX4348','account','smoke-client-line','${yesterday}',100,100,'Client A','KWD',326,'client_payment',NULL),
            ('${statementId}','XXXX4348','account','smoke-expense-line','${today}',-10,90,'Software vendor','KWD',-32.60,'expense','software');
    INSERT INTO public.cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,clickup_task_id,rail,kind,added_by)
      VALUES('smoke-manual-payment','${yesterday}',100,'USD',100,1,'Client A','clienta','task-client-a','bank_transfer','payment','smoke');
    INSERT INTO public.cockpit_payer_clients(payer,payer_key,clickup_task_id,client_name,note,mapped_by)
      VALUES('Client A','clienta','task-client-a','Client A','human mapping retained','smoke');
    INSERT INTO public.cockpit_client_billing_days(day,clickup_task_id,client_name,stage,mrr_usd,ltv_usd,payment_plan,captured_at)
      VALUES('${today}','task-client-a','Client A','Active',100,500,'Monthly',now());
  `);
  return db;
}

function localTransport(db: TestDb, options: { failMarker?: string } = {}): Fetcher {
  let queue = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  const withRole = async <T>(role: "service_role" | "supabase_read_only_user", fn: () => Promise<T>) => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role })]);
    await db.exec(`SET ROLE ${role}`);
    try { return await fn(); }
    finally { await db.exec("RESET ROLE"); }
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const calls: Record<string, { sql: string; values: unknown[] }> = {
      cockpit_ceo_refresh_claim: { sql: "SELECT public.cockpit_ceo_refresh_claim($1::uuid,$2::text[]) AS result", values: [args.p_run_id, args.p_sections] },
      cockpit_ceo_worker_begin_finance_refresh: { sql: "SELECT public.cockpit_ceo_worker_begin_finance_refresh() AS result", values: [] },
      cockpit_finance_refresh_input: { sql: "SELECT public.cockpit_finance_refresh_input($1::uuid) AS result", values: [args.p_id] },
      cockpit_ceo_refresh_finance_source_snapshot: { sql: "SELECT public.cockpit_ceo_refresh_finance_source_snapshot() AS result", values: [] },
      cockpit_ceo_refresh_publish: { sql: "SELECT public.cockpit_ceo_refresh_publish($1::uuid,$2::uuid,$3::text,$4::jsonb) AS result", values: [args.p_run_id, args.p_lease_token, args.p_plan_sha, JSON.stringify(args.p_publication)] },
      cockpit_ceo_refresh_fail: { sql: "SELECT public.cockpit_ceo_refresh_fail($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid,$6::text) AS result", values: [args.p_run_id, args.p_lease_token, args.p_error, JSON.stringify(args.p_receipts), args.p_finance_id, args.p_finance_error] },
    };
    const call = calls[name];
    if (!call) throw new Error(`Smoke transport has no canonical RPC route for ${name}`);
    return withRole("service_role", async () => (await db.query<{ result: unknown }>(call.sql, call.values)).rows[0]?.result);
  };
  const fixtureRows = (project: string, query: string): unknown[] => {
    const marker = /\/\*\s*ceo-refresh:([a-z0-9._-]+)\s*\*\//i.exec(query)?.[1];
    if (!marker) throw new Error(`Missing finance transport fixture marker for ${project}`);
    if (options.failMarker === marker) throw new Error(`Fixture provider outage for ${marker}`);
    const now = fixtureNow;
    const day = new Date(now + 3 * 60 * 60_000).toISOString().slice(0, 10);
    const fixtures: Record<string, unknown[]> = {
      "money.cash": [{ day, cash: 100, sync_ms: now, last_paid_ms: now }],
      "money.monthly": [{ month: day.slice(0, 7), cash: 100, refunds: 0, contracted: 500, deals: 1, missing_contracted: 0, voided: 0, voided_contracted: 0 }],
      "money.summary": [{ refunds_mtd: 0, refunds_90: 0, failed_count_30: 0, failed_amount_30: 0, whop_synced_ms: now, whop_last_paid_ms: now, avg_contract_90: 500, deals_synced_ms: now, first_deal_day: day, expense_months: day.slice(0, 7), transfer_months: day.slice(0, 7) }],
      "money.targets": [{ month: day.slice(0, 7), metric: "revenue", projection: 1000, updated_ms: now }],
      "money.attribution.whop": [{ payment_id: "fixture-whop-1", day, net_amount: 100, final_amount: 100, refunded_amount: 0, refund_day: null, email: null, billing: "Client A", username: null, deal_response_id: "fixture-deal-1", billing_reason: "one_time" }],
      "money.attribution.transfers": [],
      "money.attribution.deals": [{ response_id: "fixture-deal-1", day, email: null, business: "Client A", contact: null, closer: "Closer", csm: "CSM", cash_collected: 100, payment_structure: "Monthly" }],
      "money.attribution.logins": [],
      "money.attribution.expenses": [{ id: "fixture-expense-1", day, amount_usd: 32.6, category: "software", vendor: "Software vendor" }],
      "money.client_ads": [{ spend: 50, clients: 1, synced_ms: now }],
      "money.recent_deals": [{ day, business: "Client A", closer: "Closer", contracted: 500, cash: 100, plan: "Monthly" }],
      "money.tap_state": [{ ok: true, rows_seen: 0, run_ms: now, ok_ms: now, note: "Synthetic configured-empty Tap source" }],
      "money.tap_charges": [],
      "expenses.revenue": [{ revenue: 100, synced_ms: now }],
      "expenses.client_ads": [{ spend: 50, clients: 1, own_spend: 0, own_clients: 0, synced_ms: now }],
      "expenses.eods": [{ people: 1 }],
    };
    if (!(marker in fixtures)) throw new Error(`No provider fixture for ${project}/${marker}`);
    return fixtures[marker];
  };
  return (async (input, init = {}) => serialized(async () => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.hostname === "api.supabase.com") {
      assert(method === "POST", "management SQL must use POST");
      const body = JSON.parse(String(init.body ?? "{}"));
      assert(body.read_only === true, "management SQL request omitted read_only:true");
      const project = /^\/v1\/projects\/([^/]+)\/database\/query$/.exec(url.pathname)?.[1];
      if (project === "flwboeijllbtrufxkhts" || project === "bldgtotkfmhoxmlzowdx") {
        return Response.json(fixtureRows(project, String(body.query)));
      }
      return Response.json({ error: "Unapproved project" }, { status: 400 });
    }
    if (url.hostname === "bldgtotkfmhoxmlzowdx.supabase.co" && url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const args = method === "GET" ? {} : JSON.parse(String(init.body ?? "{}"));
      return Response.json(await rpc(name, args));
    }
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fixture-access-token", expires_in: 3600 });
    throw new Error(`Unexpected smoke provider request: ${url.hostname}${url.pathname}`);
  })) as Fetcher;
}

async function counts(db: TestDb): Promise<string> {
  const rows = await db.query<{ snapshot: string }>(`SELECT jsonb_build_object(
    'sections',(SELECT count(*) FROM public.cockpit_sections),
    'definitions',(SELECT count(*) FROM public.cockpit_metric_definitions),
    'values',(SELECT count(*) FROM public.cockpit_metric_values),
    'days',(SELECT count(*) FROM public.cockpit_metric_days),
    'payments',(SELECT count(*) FROM public.cockpit_client_payments),
    'runs',(SELECT count(*) FROM public.cockpit_ceo_refresh_runs),
    'finance',(SELECT count(*) FROM public.cockpit_finance_refreshes),
    'revision',(SELECT revision FROM public.cockpit_manual_payment_state WHERE id)
  )::text AS snapshot`);
  return rows.rows[0].snapshot;
}

async function publishedState(db: TestDb): Promise<string> {
  const result = await db.query<{ snapshot: string }>(`SELECT jsonb_build_object(
    'sections',(SELECT jsonb_agg(jsonb_build_object('key',key,'payload',payload) ORDER BY key) FROM public.cockpit_sections),
    'days',(SELECT jsonb_agg(jsonb_build_object('day',day,'metric',metric,'scope',scope,'value',value) ORDER BY day,metric,scope) FROM public.cockpit_metric_days),
    'values',(SELECT jsonb_agg(jsonb_build_object('day',day,'metric',metric,'scope',scope,'window',"window",'value',value) ORDER BY day,metric,scope,"window") FROM public.cockpit_metric_values),
    'payments',(SELECT count(*) FROM public.cockpit_client_payments),
    'revision',(SELECT revision FROM public.cockpit_manual_payment_state WHERE id)
  )::text AS snapshot`);
  return result.rows[0].snapshot;
}

export async function smoke(): Promise<void> {
  const db = await prepareCanonicalDb();
  try {
    const env = {
      SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-only",
      SUPABASE_ACCESS_TOKEN: "management-token-fixture-only",
    };
    const only = ["money", "expenses"];
    const beforeDryRun = await counts(db);
    const dryRun = await runRefresh({ env, fetcher: localTransport(db), only, apply: false, runId: randomUUID() });
    assert(dryRun.status === "dry-run" && dryRun.ok, `dry run did not compute both finance sections: ${JSON.stringify(dryRun)}`);
    assert(await counts(db) === beforeDryRun, "dry run wrote to canonical tables");

    const applied = await runRefresh({ env, fetcher: localTransport(db), only, apply: true, runId: randomUUID() });
    assert(applied.ok && applied.status === "published", `canonical finance publication failed: ${JSON.stringify(applied)}`);
    const published = await db.query<{ key: string; payload: { attribution?: { transactions?: unknown[] } } }>(
      "SELECT key,payload FROM public.cockpit_sections WHERE key IN ('money','expenses') ORDER BY key",
    );
    assert(published.rows.length === 2, "money and expenses were not committed together");
    assert(Array.isArray(published.rows.find(row => row.key === "money")?.payload?.attribution?.transactions), "money attribution was not read back");
    const confirmed = await db.query<{ confirmed: number; payment_count: number; total: number }>(`SELECT
      (SELECT count(*) FROM public.cockpit_finance_refreshes WHERE status='confirmed')::int AS confirmed,
      (SELECT count(*) FROM public.cockpit_client_payments)::int AS payment_count,
      (SELECT count(*) FROM public.cockpit_metric_days WHERE metric LIKE 'money.%' OR metric LIKE 'expenses.%')::int AS total`);
    assert(confirmed.rows[0].confirmed === 1 && confirmed.rows[0].payment_count > 0 && confirmed.rows[0].total > 0, "finance revisions, billing snapshots, or history were not committed");
    const facts = (await db.query<{metric:string;value:number}>("SELECT metric,value FROM cockpit_metric_days WHERE metric IN ('expenses.total','expenses.spend','expenses.software','expenses.clientAdSpend','expenses.revenue','money.failedCharges.count30d') ORDER BY metric")).rows;
    assert(JSON.stringify(facts) === JSON.stringify([
      {metric:"expenses.clientAdSpend",value:50},{metric:"expenses.revenue",value:100},
      {metric:"expenses.software",value:32.6},{metric:"expenses.spend",value:32.6},
      {metric:"expenses.total",value:32.6},{metric:"money.failedCharges.count30d",value:0},
    ]), "published finance facts differ from independent source amounts");
    const monitor = (await db.query<{snapshot:{checks:{key:string;ok:boolean}[]}}>("SELECT cockpit_native_monitor() snapshot")).rows[0].snapshot;
    assert(monitor.checks.find(check=>check.key==="worker:ceo-refresh")?.ok===true,"native monitor did not read the actual CEO worker ledger");
    assert(monitor.checks.find(check=>check.key==="source:finance-revision")?.ok===true,"native monitor rejected reconciled published finance");
    await db.exec("UPDATE cockpit_manual_payment_state SET history_ready=false WHERE id");
    const unreconciled = (await db.query<{snapshot:{checks:{key:string;ok:boolean}[]}}>("SELECT cockpit_native_monitor() snapshot")).rows[0].snapshot;
    assert(unreconciled.checks.find(check=>check.key==="source:finance-revision")?.ok===false,"matching revisions hid missing historical reconciliation");
    await db.exec("UPDATE cockpit_manual_payment_state SET history_ready=true WHERE id");

    const afterFirst = await publishedState(db);
    const repeated = await runRefresh({ env, fetcher: localTransport(db), only, apply: true, runId: randomUUID() });
    assert(repeated.ok && repeated.status === "published", "repeat finance refresh failed");
    const afterRepeat = await publishedState(db);
    assert(afterRepeat === afterFirst, "repeat refresh duplicated section, history, or payment rows");

    const failed = await runRefresh({ env, fetcher: localTransport(db, { failMarker: "money.cash" }), only, apply: true, runId: randomUUID() });
    assert(!failed.ok, "provider failure was reported as success");
    const afterFailure = await publishedState(db);
    assert(afterFailure === afterRepeat, "failed refresh changed published finance totals or history");

    const claim = await runRefresh({ env, fetcher: localTransport(db), only, apply: false, runId: randomUUID() });
    assert(claim.status === "dry-run", "dry-run changed during fence verification");

    // Regression checks for provider SQL boundary detection and HTTP 400 diagnostics
    await (async function testProviderRegression() {
      const baseEnv = {
        SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-only",
        SUPABASE_ACCESS_TOKEN: "management-token-fixture-only",
      };

      // 1. Semicolons inside line comments and block comments are accepted
      let capturedQuery = "";
      let capturedReadOnly: boolean | undefined = undefined;
      const driver1 = createProviderDriver({
        env: baseEnv,
        apply: false,
        fetcher: (async (input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          capturedQuery = body.query;
          capturedReadOnly = body.read_only;
          return Response.json([{ ok: 1 }]);
        }) as Fetcher,
      });

      const commentQuery = `
        -- comment with semicolon; and another;
        /* block comment; with semicolon; */
        SELECT 1 AS ok
        -- trailing comment;
      `;
      const res1 = await driver1.read("flwboeijllbtrufxkhts", commentQuery);
      assert(Array.isArray(res1) && res1[0]?.ok === 1, "comment query with semicolons failed");
      assert(capturedReadOnly === true, "read_only:true flag was not sent");
      assert(capturedQuery === commentQuery, "original query text was modified or not preserved");

      // 2. Genuine second statements are denied before fetch
      let fetchCalled = false;
      const driver2 = createProviderDriver({
        env: baseEnv,
        apply: false,
        fetcher: (async () => {
          fetchCalled = true;
          return Response.json([{ ok: 1 }]);
        }) as Fetcher,
      });

      let err2: Error | null = null;
      try {
        await driver2.read("flwboeijllbtrufxkhts", "SELECT 1; DROP TABLE users;");
      } catch (e) {
        err2 = e as Error;
      }
      assert(err2 !== null, "genuine second statement was not rejected");
      assert(!fetchCalled, "fetch was called for second statement query");

      // 3. Quoted comment markers do not hide second statements
      fetchCalled = false;
      let err3: Error | null = null;
      try {
        await driver2.read("flwboeijllbtrufxkhts", "SELECT '--' ; DROP TABLE users;");
      } catch (e) {
        err3 = e as Error;
      }
      assert(err3 !== null, "quoted comment marker attack was not rejected");
      assert(!fetchCalled, "fetch was called for quoted comment marker attack query");

      fetchCalled = false;
      let err4: Error | null = null;
      try {
        await driver2.read("flwboeijllbtrufxkhts", "SELECT '/*'; DROP TABLE users;");
      } catch (e) {
        err4 = e as Error;
      }
      assert(err4 !== null, "quoted block comment attack was not rejected");
      assert(!fetchCalled, "fetch was called for quoted block comment attack query");

      // 4. Fixed B2B adapter query reaches the read-only request path
      let b2bCapturedQuery = "";
      let b2bReadOnly: boolean | undefined = undefined;
      const driver3 = createProviderDriver({
        env: baseEnv,
        apply: false,
        fetcher: (async (input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          b2bCapturedQuery = body.query;
          b2bReadOnly = body.read_only;
          return Response.json([{ campaign_name: "test", adset_name: "adset" }]);
        }) as Fetcher,
      });

      // Construct treeSql query resembling b2bAds.js adapter query with comments
      const sampleTreeSql = `with
  ident as (
    select distinct on (ad_id) ad_id, adset_id, campaign_id,
           ad_name, adset_name, campaign_name, campaign_status, effective_status, thumbnail_url
    from public.meta_ad_snapshots
    where date between date '2026-09-01' and date '2026-09-30'
    order by ad_id, date desc),
  w7_leads as (
    -- Leads by the setters' ROAS tags (Aziz, 2026-09-21): qualified plus
    -- unqualified count; unprepared is "not ready" and is shown apart.
    select l.ad_id, count(*) as leads
    from public.leads l
    where l.ad_id is not null
    group by 1)
select ident.* from ident left join w7_leads on w7_leads.ad_id = ident.ad_id;`;

      const b2bRes = await driver3.read("flwboeijllbtrufxkhts", sampleTreeSql);
      assert(Array.isArray(b2bRes) && b2bRes.length === 1, "B2B adapter query failed to execute");
      assert(b2bReadOnly === true, "B2B adapter query did not include read_only:true");
      assert(b2bCapturedQuery === sampleTreeSql, "B2B adapter query text was not preserved");

      // 5. Sanitized HTTP 400 diagnostics in local receipts (actual Supabase wrapper with LINE 1 SQL secret)
      const driver4 = createProviderDriver({
        env: baseEnv,
        apply: false,
        fetcher: (async () => {
          return new Response(JSON.stringify({
            message: "Failed to run sql query: ERROR:  42501: permission denied for function secret_leak\nLINE 1: SELECT secret_token_xyz FROM sensitive_vault WHERE key='sk_live_12345678'\nQUERY:  SELECT secret_token_xyz\nCONTEXT: PL/pgSQL function test() line 1",
            query: "SELECT * FROM leak_all_data;",
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }) as Fetcher,
      });

      let err5: Error | null = null;
      try {
        await driver4.read("flwboeijllbtrufxkhts", "SELECT 1;");
      } catch (e) {
        err5 = e as Error;
      }
      assert(err5 !== null, "HTTP 400 error was not thrown");
      const receipt = driver4.receipts.find(r => r.phase === "failure" && r.http_status === 400);
      assert(!!receipt, "Failure receipt for HTTP 400 missing");
      assert(!receipt.error?.includes("secret_token_xyz"), "Receipt leaked LINE 1 secret");
      assert(!receipt.error?.includes("sensitive_vault"), "Receipt leaked LINE 1 table name");
      assert(!receipt.error?.includes("sk_live_12345678"), "Receipt leaked raw credentials");
      assert(!receipt.error?.includes("leak_all_data"), "Receipt leaked raw query property");
      assert(!receipt.error?.includes("QUERY:"), "Receipt leaked QUERY context");
      assert(!receipt.error?.includes("CONTEXT:"), "Receipt leaked CONTEXT block");
      assert(receipt.error?.includes("42501"), "Receipt omitted validated PostgreSQL error code");
      assert(receipt.error?.includes("permission denied for function"), "Receipt omitted sanitized first error sentence");

      // 6. Unknown error shape falls back to generic HTTP status
      const driver5 = createProviderDriver({
        env: baseEnv,
        apply: false,
        fetcher: (async () => {
          return new Response(JSON.stringify({
            malicious_key: "SELECT secret FROM evil",
            query: "DROP TABLE users;",
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }) as Fetcher,
      });

      let err6: Error | null = null;
      try {
        await driver5.read("flwboeijllbtrufxkhts", "SELECT 1;");
      } catch (e) {
        err6 = e as Error;
      }
      assert(err6 !== null, "HTTP 400 error was not thrown for unknown shape");
      const receipt5 = driver5.receipts.find(r => r.phase === "failure" && r.http_status === 400);
      assert(!!receipt5, "Failure receipt missing for unknown shape");
      assert(receipt5.error === "Supabase read-only SQL returned HTTP 400", "Unknown shape did not return generic HTTP status");
    })();

    console.info("CEO refresh smoke: canonical dry-run, atomic publish/readback, repeat, and failure checks passed.");
  } finally {
    await db.close();
  }
}

if (import.meta.main) await smoke();
