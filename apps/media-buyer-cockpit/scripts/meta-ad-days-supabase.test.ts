// Meta ad-day store (2026-10-16): supabase/migrations/20261016121700_meta_ad_days.sql
// against PGlite, on top of the cockpit core (members, audit log, CEO gate)
// and the sync-state table, with Supabase's default privileges emulated so a
// missing REVOKE shows. Made-up ad accounts, ads and numbers; no provider is
// called. The rate table is pinned to the two copies the cockpits already use.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import type { ReceiptRow } from "../../../supabase/functions/meta-ad-days/db.ts";
import {
  DESTINATIONS,
  edgeAccount,
  engagementRow,
  imageLeadRow,
  KUWAIT_ACCOUNT,
  NOW as RUN_NOW,
  SAR_ACCOUNT,
  TOKEN,
  videoLeadRow,
  whatsappLeadRow,
} from "../../../supabase/functions/meta-ad-days/fixtures.ts";
import {
  type RunDeps,
  startJob,
} from "../../../supabase/functions/meta-ad-days/run.ts";
import {
  adsetsRoute,
  eachDay,
  fakeFetch,
  graphPath,
  insightsRoute,
  ok,
  type Route,
} from "../../../supabase/functions/meta-ad-days/testkit.ts";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261016121700_meta_ad_days.sql";
/** The corrections after the second-source check of 2026-10-16, on top. */
const CHECKED = "20261016210100_meta_ad_days_checked.sql";
const CEO = "00000000-0000-4000-8000-0000000000c1";
const MEMBER = "00000000-0000-4000-8000-0000000000b1";
const A1 = "1111111111111"; // a USD account, tied to Client One
const A2 = "2222222222222"; // a SAR account, tied to Client One too (two accounts, one client)
const A3 = "3333333333333"; // a USD account tied to no client
const A4 = "4444444444444"; // an EUR account: no fixed rate
const NOW = "2026-10-16T09:00:00+03:00"; // Kuwait 09:00, Friday 16 Oct

let db: PGlite;

const TABLES = [
  "cockpit_meta_ad_days",
  "cockpit_meta_reach",
  "cockpit_meta_ad_day_runs",
  "cockpit_meta_ad_day_tasks",
  "cockpit_meta_ad_day_receipts",
  "cockpit_meta_lead_ids",
  "cockpit_meta_lead_id_cover",
];
const SERVICE = [
  "cockpit_meta_ad_days_inputs(jsonb)",
  "cockpit_meta_ad_days_begin(jsonb)",
  "cockpit_meta_ad_days_claim(jsonb)",
  "cockpit_meta_ad_days_apply(jsonb)",
  "cockpit_meta_reach_apply(jsonb)",
  "cockpit_meta_ad_days_fail(jsonb)",
  "cockpit_meta_ad_days_record(jsonb)",
  "cockpit_meta_ad_days_status()",
  "cockpit_meta_lead_ids_apply(jsonb)",
  "cockpit_meta_leads_not_in_crm(date,date)",
];
const INTERNAL = [
  "cockpit_meta_ad_days_require_service()",
  "cockpit_meta_ad_days_now()",
  "cockpit_meta_ad_days_today()",
  "cockpit_meta_ad_days_usd_per(text)",
  "cockpit_meta_reach_windows(date)",
  "cockpit_meta_reach_windows_json(date)",
  "cockpit_meta_ad_days_ties()",
  "cockpit_meta_ad_days_try_date(text)",
  "cockpit_meta_ad_days_leased(jsonb,text[])",
  "cockpit_meta_reach_rebuild_clients()",
  "cockpit_meta_ad_days_finish(uuid)",
  "cockpit_meta_ad_days_expire()",
  "cockpit_meta_ad_days_kick(text)",
  "cockpit_meta_ad_days_status_label(integer)",
  "cockpit_meta_ad_days_hidden()",
  "cockpit_meta_ad_days_is_hidden(jsonb,text,text)",
];

async function at(iso: string) {
  await owner(db);
  await db.query("SELECT set_config('test.now',$1,false)", [iso]);
}
async function service() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
}
async function svc(fn: string, p: unknown = {}): Promise<any> {
  await service();
  const r = await db.query<{ r: any }>(`SELECT public.${fn}($1::jsonb) AS r`, [
    JSON.stringify(p),
  ]);
  return r.rows[0].r;
}
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(sql, params)).rows;
}
async function refused(
  fn: () => Promise<unknown>,
  code: string,
): Promise<string> {
  let caught: { code?: string; message?: string } | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as { code?: string; message?: string };
  }
  expect(caught?.code).toBe(code);
  return caught?.message ?? "";
}

const account = (
  accountId: string,
  currency: string,
  over: Record<string, unknown> = {},
) => ({
  accountId,
  name: `Account ${accountId.slice(0, 2)}`,
  currency,
  timezone: "Asia/Riyadh",
  status: 1,
  spend: 100,
  edge: "client",
  ...over,
});
const dayTask = (accountId: string, since: string, until: string) => ({
  kind: "days",
  accountId,
  since,
  until,
});

function adRow(
  accountId: string,
  adId: string,
  day: string,
  over: Record<string, unknown> = {},
) {
  return {
    account_id: accountId,
    day,
    campaign_id: "120000000000001",
    campaign_name: "Leads | Riyadh",
    objective: "OUTCOME_LEADS",
    adset_id: "120000000000002",
    adset_name: "Broad",
    ad_id: adId,
    ad_name: `Ad ${adId.slice(-2)}`,
    spend: 10.5,
    impressions: 1000,
    reach: 800,
    frequency: 1.25,
    link_clicks: 12,
    leads: 2,
    lead_actions: 2,
    landing_page_views: null,
    video_plays: 900,
    video_3s: 180,
    video_p25: 120,
    video_p50: 60,
    video_p75: 30,
    video_p100: 10,
    thruplays: 40,
    ...over,
  };
}

/** Begin a run and lease every task it has, in claim order. */
async function startAndClaim(
  job: string,
  accounts: unknown[],
  tasks: unknown[],
  reach: string | null = null,
) {
  const begun = await svc("cockpit_meta_ad_days_begin", {
    job,
    requestedBy: "cron",
    graphVersion: "v25.0",
    window: { since: "2026-10-14", until: "2026-10-17" },
    accounts,
    tasks,
    reach,
  });
  const claimed = await svc("cockpit_meta_ad_days_claim", {
    limit: 5,
    leaseSeconds: 300,
  });
  return { begun, claimed: claimed as any[] };
}

async function closeOpenRuns() {
  await owner(db);
  await db.exec(
    `UPDATE cockpit_meta_ad_day_tasks SET state='failed', lease_token=NULL, lease_until=NULL, error='closed by the test' WHERE state IN ('pending','running')`,
  );
  const runs = await q<{ id: string }>(
    "SELECT id FROM cockpit_meta_ad_day_runs WHERE state='running'",
  );
  for (const r of runs)
    await q("SELECT public.cockpit_meta_ad_days_finish($1::uuid)", [r.id]);
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(migration("20260921e_tap_charges.sql"));
  await db.exec(
    "REVOKE ALL ON public.cockpit_sync_state, public.cockpit_tap_charges FROM anon, authenticated;",
  );
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, MEMBER, "member@tests.invalid", ["media_buyer"]);
  await owner(db);
  await db.exec(migration(FILE));
  await db.exec(migration(CHECKED));
  // The clock seam: the tests stand at a fixed moment.
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS
    $$ SELECT current_setting('test.now')::timestamptz $$;
    REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_now() FROM PUBLIC, anon, authenticated, service_role;`);
  await at(NOW);
});

afterAll(async () => {
  await db?.close();
});

describe("tables and privileges", () => {
  test("every table has row security and nobody but the service role can read it", async () => {
    for (const t of TABLES) {
      const [r] = await q<{ rls: boolean }>(
        "SELECT relrowsecurity rls FROM pg_class WHERE oid = $1::regclass",
        [`public.${t}`],
      );
      expect(r.rls).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const [x] = await q<{ ok: boolean }>(
            "SELECT has_table_privilege($1, $2, $3) ok",
            [role, `public.${t}`, priv],
          );
          expect({ t, role, priv, ok: x.ok }).toEqual({
            t,
            role,
            priv,
            ok: false,
          });
        }
      }
      const [sel] = await q<{ ok: boolean }>(
        "SELECT has_table_privilege('service_role', $1, 'SELECT') ok",
        [`public.${t}`],
      );
      expect(sel.ok).toBe(true);
      for (const priv of ["UPDATE", "DELETE"]) {
        const [x] = await q<{ ok: boolean }>(
          "SELECT has_table_privilege('service_role', $1, $2) ok",
          [`public.${t}`, priv],
        );
        expect({ t, priv, ok: x.ok }).toEqual({ t, priv, ok: false });
      }
      const [ins] = await q<{ ok: boolean }>(
        "SELECT has_table_privilege('service_role', $1, 'INSERT') ok",
        [`public.${t}`],
      );
      expect({ t, ok: ins.ok }).toEqual({
        t,
        ok: t === "cockpit_meta_ad_day_receipts",
      });
    }
  });

  test("service RPCs run for the service role only; internal helpers for nobody", async () => {
    for (const f of SERVICE) {
      for (const role of ["anon", "authenticated"]) {
        const [x] = await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') ok",
          [role, `public.${f}`],
        );
        expect({ f, role, ok: x.ok }).toEqual({ f, role, ok: false });
      }
      const [s] = await q<{ ok: boolean }>(
        "SELECT has_function_privilege('service_role', $1, 'EXECUTE') ok",
        [`public.${f}`],
      );
      expect({ f, ok: s.ok }).toEqual({ f, ok: true });
    }
    for (const f of INTERNAL) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [x] = await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') ok",
          [role, `public.${f}`],
        );
        expect({ f, role, ok: x.ok }).toEqual({ f, role, ok: false });
      }
    }
  });

  test("every definer function pins an empty search_path", async () => {
    const rows = await q<{ name: string; cfg: string[] | null }>(
      `SELECT p.proname name, p.proconfig cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'cockpit_meta_ad_days%' OR p.proname LIKE 'cockpit_meta_reach%')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows)
      expect({ name: r.name, cfg: r.cfg }).toEqual({
        name: r.name,
        cfg: ['search_path=""'],
      });
  });

  test("a signed-in member, even the CEO, cannot start, claim or write", async () => {
    for (const who of [CEO, MEMBER, null]) {
      await actor(db, who);
      await refused(
        () => db.query("SELECT public.cockpit_meta_ad_days_begin('{}'::jsonb)"),
        "42501",
      );
      await actor(db, who);
      await refused(
        () => db.query("SELECT public.cockpit_meta_ad_days_apply('{}'::jsonb)"),
        "42501",
      );
      await actor(db, who);
      await refused(
        () => db.query("SELECT * FROM public.cockpit_meta_ad_days"),
        "42501",
      );
    }
  });

  test("the file applies twice without an error", async () => {
    await owner(db);
    await db.exec(migration(FILE));
    await db.exec(migration(CHECKED));
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS
      $$ SELECT current_setting('test.now')::timestamptz $$;
      REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_now() FROM PUBLIC, anon, authenticated, service_role;`);
    const [n] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_ad_days",
    );
    expect(n.n).toBe(0);
  });
});

describe("rates and windows", () => {
  test("the USD rates are the cockpit's fixed table, pinned to tap.js and calculator.ts", async () => {
    const tap = readFileSync(
      new URL(
        "../../../hermes/ceo-refresh/native/data/tap.js",
        import.meta.url,
      ),
      "utf8",
    );
    const calc = readFileSync(
      new URL("../../../hermes/cockpit-sync/calculator.ts", import.meta.url),
      "utf8",
    );
    const table = (src: string, name: string) => {
      const block =
        src.slice(src.indexOf(name)).match(/\{([^}]*)\}/)?.[1] ?? "";
      return Object.fromEntries(
        [...block.matchAll(/([A-Z]{3}):\s*([0-9.]+)/g)].map(m => [
          m[1],
          Number(m[2]),
        ]),
      );
    };
    const usdPer = table(tap, "USD_PER");
    const fx = table(calc, "const FX");
    expect(Object.keys(usdPer).sort()).toEqual([
      "AED",
      "KWD",
      "QAR",
      "SAR",
      "USD",
    ]);
    expect(fx).toEqual(usdPer);
    for (const [code, rate] of Object.entries(usdPer)) {
      const [r] = await q<{ v: string }>(
        "SELECT public.cockpit_meta_ad_days_usd_per($1)::text v",
        [code],
      );
      expect(Number(r.v)).toBe(rate);
    }
    for (const missing of ["EUR", "", null]) {
      const [r] = await q<{ v: string | null }>(
        "SELECT public.cockpit_meta_ad_days_usd_per($1)::text v",
        [missing],
      );
      expect(r.v).toBeNull();
    }
  });

  test("five windows end today on Kuwait's calendar, two end yesterday", async () => {
    const rows = await q<{ k: string; f: string; t: string }>(
      "SELECT window_key k, to_char(from_day,'YYYY-MM-DD') f, to_char(to_day,'YYYY-MM-DD') t FROM public.cockpit_meta_reach_windows('2026-10-16')",
    );
    expect(rows).toEqual([
      { k: "last_7", f: "2026-10-10", t: "2026-10-16" },
      { k: "last_14", f: "2026-10-03", t: "2026-10-16" },
      { k: "last_30", f: "2026-09-17", t: "2026-10-16" },
      { k: "this_month", f: "2026-10-01", t: "2026-10-16" },
      { k: "last_month", f: "2026-09-01", t: "2026-09-30" },
      // Full days only, for a board whose spend and leads end yesterday.
      { k: "last_7_full", f: "2026-10-09", t: "2026-10-15" },
      { k: "last_30_full", f: "2026-09-16", t: "2026-10-15" },
    ]);
    const [march] = await q<{ f: string; t: string }>(
      "SELECT to_char(from_day,'YYYY-MM-DD') f, to_char(to_day,'YYYY-MM-DD') t FROM public.cockpit_meta_reach_windows('2026-03-02') WHERE window_key='last_month'",
    );
    expect(march).toEqual({ f: "2026-02-01", t: "2026-02-28" });
  });
});

describe("a run, end to end", () => {
  test("without the client spine every account is untied and the note says so", async () => {
    const inputs = await svc("cockpit_meta_ad_days_inputs", {
      accounts: [account(A1, "USD")],
    });
    expect(inputs.ties.source).toBe("missing");
    expect(inputs.notLinked).toEqual([]);
    expect(inputs.today).toBe("2026-10-16");
    const { begun, claimed } = await startAndClaim(
      "hourly",
      [account(A1, "USD")],
      [dayTask(A1, "2026-10-15", "2026-10-16")],
    );
    expect(begun.started).toBe(true);
    expect(begun.tieSource).toBe("missing");
    expect(claimed.length).toBe(1);
    const t = claimed[0];
    const r = await svc("cockpit_meta_ad_days_apply", {
      taskId: t.id,
      leaseToken: t.leaseToken,
      fetchedAt: NOW,
      rows: [adRow(A1, "900000000000001", "2026-10-15")],
      final: true,
    });
    expect(r.run).toBe("ok");
    const [run] = await q<{ note: string; state: string }>(
      "SELECT note, state FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [begun.runId],
    );
    expect(run.state).toBe("ok");
    expect(run.note).toContain(
      "No account is tied to a client yet (cockpit_board_clients is missing)",
    );
  });

  test("with the client spine: ties, the not-linked list, USD, the sync row and one audit row", async () => {
    await owner(db);
    await db.exec(`CREATE TABLE public.cockpit_board_clients (location_id text PRIMARY KEY, clickup_id text, client_name text, status text,
      service_mode text, ad_account_ids text[], tiktok boolean, updated_at timestamptz);
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_ONE','c1','Client One','Active','DFY',ARRAY['act_${A1}','${A2}'],false,now());`);
    const inputs = await svc("cockpit_meta_ad_days_inputs", {
      accounts: [
        account(A1, "USD"),
        account(A3, "USD", { name: "Loose Account" }),
      ],
    });
    expect(inputs.ties.source).toBe("board_clients");
    expect(inputs.ties.linked).toBe(1);
    expect(inputs.notLinked.map((a: any) => a.accountId)).toEqual([A3]);

    const audits0 = (
      await q<{ n: number }>(
        "SELECT count(*)::int n FROM cockpit_audit_log WHERE action='meta_ad_days.run'",
      )
    )[0].n;
    const accounts = [
      account(A1, "USD"),
      account(A2, "SAR"),
      account(A3, "USD", { name: "Loose Account", spend: 12.3 }),
      account(A4, "EUR", { name: "Euro Account" }),
    ];
    const tasks = accounts.map(a =>
      dayTask(a.accountId, "2026-10-15", "2026-10-16"),
    );
    const { begun, claimed } = await startAndClaim("hourly", accounts, tasks);
    expect(begun.tasks).toBe(4);
    expect(begun.notLinked.map((a: any) => a.accountId).sort()).toEqual([
      A3,
      A4,
    ]);
    expect(claimed.length).toBe(4);
    const byAccount = Object.fromEntries(claimed.map(t => [t.accountId, t]));
    for (const id of [A1, A2, A3, A4]) {
      const t = byAccount[id];
      await svc("cockpit_meta_ad_days_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        fetchedAt: NOW,
        final: true,
        rows: [
          adRow(id, `${id.slice(0, 1)}00000000000010`, "2026-10-16", {
            spend: 100,
          }),
        ],
      });
    }
    const rows = await q<{
      account_id: string;
      spend_usd: string | null;
      usd_rate: string | null;
      account_currency: string;
    }>(
      "SELECT account_id, spend_usd::text, usd_rate::text, account_currency FROM cockpit_meta_ad_days WHERE day='2026-10-16' ORDER BY account_id",
    );
    expect(
      rows.map(r => [
        r.account_id,
        r.account_currency,
        r.spend_usd === null ? null : Number(r.spend_usd),
      ]),
    ).toEqual([
      [A1, "USD", 100],
      [A2, "SAR", 26.66],
      [A3, "USD", 100],
      [A4, "EUR", null],
    ]);
    expect(rows[3].usd_rate).toBeNull();
    const [run] = await q<{ note: string; state: string; accounts: any[] }>(
      "SELECT note, state, accounts FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [begun.runId],
    );
    expect(run.state).toBe("ok");
    expect(run.note).toContain(
      "Read 4 of 4 ad accounts: 4 ad-days written, 4 new or changed.",
    );
    expect(run.note).toContain(
      `Not linked to a client: Loose Account (${A3}, USD 12.3), Euro Account (${A4}, EUR 100).`,
    );
    expect(run.note).toContain(
      "No USD rate for EUR on Euro Account, so its spend_usd is empty.",
    );
    expect(run.accounts.find((a: any) => a.accountId === A2)).toMatchObject({
      linked: true,
      locationId: "LOC_ONE",
      clientName: "Client One",
    });
    const [sync] = await q<{ ok: boolean; rows_seen: number; note: string }>(
      "SELECT ok, rows_seen, note FROM cockpit_sync_state WHERE key='meta-ad-days-hourly'",
    );
    expect(sync.ok).toBe(true);
    expect(sync.rows_seen).toBe(4);
    const audits1 = (
      await q<{ n: number }>(
        "SELECT count(*)::int n FROM cockpit_audit_log WHERE action='meta_ad_days.run'",
      )
    )[0].n;
    expect(audits1 - audits0).toBe(1);
  });

  test("upserts by ad and day: a second read changes nothing, a later read replaces, an earlier read does not, and nothing is deleted", async () => {
    const accounts = [account(A1, "USD")];
    const ad = "900000000000777";
    const first = await startAndClaim("nightly", accounts, [
      dayTask(A1, "2026-10-08", "2026-10-14"),
    ]);
    const t1 = first.claimed[0];
    const r1 = await svc("cockpit_meta_ad_days_apply", {
      taskId: t1.id,
      leaseToken: t1.leaseToken,
      fetchedAt: "2026-10-16T08:30:00+03:00",
      final: true,
      rows: [adRow(A1, ad, "2026-10-13"), adRow(A1, ad, "2026-10-14")],
    });
    expect(r1).toMatchObject({ inserted: 2, changed: 0, written: 2 });
    await closeOpenRuns();

    // The same read again: written, nothing new or changed.
    const second = await startAndClaim("nightly", accounts, [
      dayTask(A1, "2026-10-08", "2026-10-14"),
    ]);
    const t2 = second.claimed[0];
    const r2 = await svc("cockpit_meta_ad_days_apply", {
      taskId: t2.id,
      leaseToken: t2.leaseToken,
      fetchedAt: "2026-10-16T08:40:00+03:00",
      final: false,
      rows: [adRow(A1, ad, "2026-10-13"), adRow(A1, ad, "2026-10-14")],
    });
    expect(r2).toMatchObject({ inserted: 0, changed: 0, written: 2 });
    // Attribution settled: a later read with one more lead replaces the row.
    const r3 = await svc("cockpit_meta_ad_days_apply", {
      taskId: t2.id,
      leaseToken: t2.leaseToken,
      fetchedAt: "2026-10-16T08:50:00+03:00",
      final: false,
      rows: [adRow(A1, ad, "2026-10-13", { leads: 3, lead_actions: 3 })],
    });
    expect(r3).toMatchObject({ inserted: 0, changed: 1 });
    // An earlier read arriving late does not undo it.
    const r4 = await svc("cockpit_meta_ad_days_apply", {
      taskId: t2.id,
      leaseToken: t2.leaseToken,
      fetchedAt: "2026-10-16T08:35:00+03:00",
      final: true,
      rows: [adRow(A1, ad, "2026-10-13", { leads: 1, lead_actions: 1 })],
    });
    expect(r4).toMatchObject({ olderThanStored: 1, written: 0 });
    const kept = await q<{ d: string; leads: number }>(
      "SELECT to_char(day,'YYYY-MM-DD') d, leads::int FROM cockpit_meta_ad_days WHERE ad_id=$1 ORDER BY day",
      [ad],
    );
    // 14 Oct was not in the last read (the ad stopped): it is kept.
    expect(kept).toEqual([
      { d: "2026-10-13", leads: 3 },
      { d: "2026-10-14", leads: 2 },
    ]);
    const [n] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_ad_days WHERE ad_id=$1",
      [ad],
    );
    expect(n.n).toBe(2);
  });

  test("NULL stays NULL: an image ad keeps no video numbers and a non-lead campaign no leads", async () => {
    const { claimed } = await startAndClaim(
      "hourly",
      [account(A3, "USD")],
      [dayTask(A3, "2026-10-15", "2026-10-16")],
    );
    const t = claimed[0];
    const image = adRow(A3, "900000000000555", "2026-10-15", {
      objective: "OUTCOME_ENGAGEMENT",
      leads: null,
      lead_actions: 38,
      video_plays: null,
      video_3s: null,
      video_p25: null,
      video_p50: null,
      video_p75: null,
      video_p100: null,
      thruplays: null,
    });
    await svc("cockpit_meta_ad_days_apply", {
      taskId: t.id,
      leaseToken: t.leaseToken,
      fetchedAt: NOW,
      final: true,
      rows: [image],
    });
    const [r] = await q<any>(
      "SELECT leads, lead_actions::int, video_plays, video_3s, video_p25, thruplays FROM cockpit_meta_ad_days WHERE ad_id='900000000000555'",
    );
    expect(r).toEqual({
      leads: null,
      lead_actions: 38,
      video_plays: null,
      video_3s: null,
      video_p25: null,
      thruplays: null,
    });
  });

  test("the store refuses rows outside the task, from another account, twice, negative, or more leads than lead actions", async () => {
    const { claimed } = await startAndClaim(
      "hourly",
      [account(A1, "USD")],
      [dayTask(A1, "2026-10-15", "2026-10-16")],
    );
    const t = claimed[0];
    const send = (rows: unknown[]) =>
      svc("cockpit_meta_ad_days_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        fetchedAt: NOW,
        final: false,
        rows,
      });
    expect(
      await refused(
        () => send([adRow(A1, "900000000000101", "2026-10-12")]),
        "22023",
      ),
    ).toContain("a day outside the task's days");
    expect(
      await refused(
        () => send([adRow(A2, "900000000000101", "2026-10-15")]),
        "22023",
      ),
    ).toContain("another ad account");
    expect(
      await refused(
        () =>
          send([
            adRow(A1, "900000000000101", "2026-10-15"),
            adRow(A1, "900000000000101", "2026-10-15"),
          ]),
        "22023",
      ),
    ).toContain("twice");
    expect(
      await refused(
        () => send([adRow(A1, "900000000000101", "2026-10-15", { spend: -1 })]),
        "22023",
      ),
    ).toContain("negative");
    expect(
      await refused(
        () =>
          send([
            adRow(A1, "900000000000101", "2026-10-15", {
              leads: 5,
              lead_actions: 2,
            }),
          ]),
        "22023",
      ),
    ).toContain("more leads");
    expect(
      await refused(() => send([adRow(A1, "abc", "2026-10-15")]), "22023"),
    ).toContain("valid ad id");
    expect(
      await refused(
        () =>
          send([
            adRow(A1, "900000000000101", "2026-10-15", {
              destination_type: "WHATSAPP",
              leads: 3,
              lead_actions: 3,
            }),
          ]),
        "22023",
      ),
    ).toContain("form leads on a chat ad set");
    expect(
      await refused(
        () =>
          send([
            adRow(A1, "900000000000101", "2026-10-15", {
              destination_type: "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP",
              leads: 0,
            }),
          ]),
        "22023",
      ),
    ).toContain("form leads on a chat ad set");
    expect(
      await refused(
        () =>
          send([
            adRow(A1, "900000000000101", "2026-10-15", {
              destination_type: "on ad",
            }),
          ]),
        "22023",
      ),
    ).toContain("not one of Meta's names");
    // The table holds the rule too, whoever writes.
    await owner(db);
    await refused(
      () =>
        db.query(
          `INSERT INTO cockpit_meta_ad_days(account_id, day, ad_id, leads, destination_type, fetched_at)
           VALUES ('${A1}', '2026-10-15', '900000000000102', 1, 'WHATSAPP', now())`,
        ),
      "23514",
    );
    await refused(
      () =>
        svc("cockpit_meta_ad_days_apply", {
          taskId: t.id,
          leaseToken: t.leaseToken,
          fetchedAt: "2026-10-10T00:00:00Z",
          final: true,
          rows: [],
        }),
      "22023",
    );
    // A token that is not this lease's.
    await refused(
      () =>
        svc("cockpit_meta_ad_days_apply", {
          taskId: t.id,
          leaseToken: "00000000-0000-4000-8000-000000000000",
          fetchedAt: NOW,
          final: true,
          rows: [],
        }),
      "55000",
    );
    const [n] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_ad_days WHERE ad_id='900000000000101'",
    );
    expect(n.n).toBe(0);
    await closeOpenRuns();
  });

  test("begin refuses tasks it cannot trust", async () => {
    const accounts = [account(A1, "USD")];
    const begin = (tasks: unknown[], acc: unknown[] = accounts) =>
      svc("cockpit_meta_ad_days_begin", {
        job: "backfill",
        requestedBy: "aziz@maharamedia.com",
        accounts: acc,
        tasks,
      });
    expect(
      await refused(
        () => begin([dayTask(A2, "2026-10-01", "2026-10-07")]),
        "22023",
      ),
    ).toContain("an account not in the run");
    expect(
      await refused(
        () => begin([dayTask(A1, "2026-09-01", "2026-10-07")]),
        "22023",
      ),
    ).toContain("longer than 31 days");
    expect(
      await refused(
        () => begin([dayTask(A1, "2026-10-20", "2026-10-21")]),
        "22023",
      ),
    ).toContain("outside the last 400 days");
    expect(
      await refused(
        () => begin([dayTask(A1, "2026-10-07", "2026-10-01")]),
        "22023",
      ),
    ).toContain("ends before it starts");
    expect(
      await refused(() => begin([], [account("act_1", "USD")]), "22023"),
    ).toContain("valid id");
    expect(
      await refused(() => begin([], [account(A1, "usd")]), "22023"),
    ).toContain("currency");
    expect(
      await refused(
        () => begin([], [account(A1, "USD"), account(A1, "USD")]),
        "22023",
      ),
    ).toContain("twice");
    await refused(
      () =>
        svc("cockpit_meta_ad_days_begin", {
          job: "weekly",
          accounts: [],
          tasks: [],
        }),
      "22023",
    );
  });

  test("no spending account: the run closes at once and says so", async () => {
    const begun = await svc("cockpit_meta_ad_days_begin", {
      job: "backfill",
      requestedBy: "aziz@maharamedia.com",
      accounts: [],
      tasks: [],
    });
    expect(begun).toMatchObject({ started: true, tasks: 0, state: "ok" });
    const [run] = await q<{ note: string; requested_by: string }>(
      "SELECT note, requested_by FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [begun.runId],
    );
    expect(run.note).toBe(
      "No ad account of the business spent in the window; nothing to read.",
    );
    expect(run.requested_by).toBe("aziz@maharamedia.com");
  });
});

describe("the queue", () => {
  test("a run of the same job still working answers busy, until it runs out of time", async () => {
    await at("2026-10-16T10:07:00+03:00");
    const a = await svc("cockpit_meta_ad_days_begin", {
      job: "hourly",
      accounts: [account(A1, "USD")],
      tasks: [dayTask(A1, "2026-10-15", "2026-10-16")],
    });
    expect(a.started).toBe(true);
    const b = await svc("cockpit_meta_ad_days_begin", {
      job: "hourly",
      accounts: [account(A1, "USD")],
      tasks: [dayTask(A1, "2026-10-15", "2026-10-16")],
    });
    expect(b).toMatchObject({ started: false, busy: true, runId: a.runId });
    await at("2026-10-16T11:07:00+03:00");
    const c = await svc("cockpit_meta_ad_days_begin", {
      job: "hourly",
      accounts: [account(A1, "USD")],
      tasks: [dayTask(A1, "2026-10-15", "2026-10-16")],
    });
    expect(c.started).toBe(true);
    const [old] = await q<{ state: string; note: string }>(
      "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [a.runId],
    );
    expect(old.state).toBe("failed");
    expect(old.note).toContain("ran out of time");
    await closeOpenRuns();
    await at(NOW);
  });

  test("leases: two claims never share a task, a lost lease goes back to the queue, four tries at most", async () => {
    const accounts = [account(A1, "USD"), account(A3, "USD")];
    const begun = await svc("cockpit_meta_ad_days_begin", {
      job: "backfill",
      accounts,
      tasks: [
        dayTask(A1, "2026-10-01", "2026-10-07"),
        dayTask(A3, "2026-10-01", "2026-10-07"),
      ],
    });
    const c1 = await svc("cockpit_meta_ad_days_claim", { limit: 1 });
    const c2 = await svc("cockpit_meta_ad_days_claim", { limit: 1 });
    const c3 = await svc("cockpit_meta_ad_days_claim", { limit: 1 });
    expect(c1.length).toBe(1);
    expect(c2.length).toBe(1);
    expect(c1[0].id).not.toBe(c2[0].id);
    expect(c3).toEqual([]);
    // The first lease runs out: the task is claimed again with a new token, and the old token is refused.
    for (let attempt = 2; attempt <= 4; attempt++) {
      await at(new Date(Date.parse(NOW) + attempt * 6 * 60_000).toISOString());
      const again = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
      expect(again.map((t: any) => t.attempt)).toEqual([attempt, attempt]);
    }
    await refused(
      () =>
        svc("cockpit_meta_ad_days_fail", {
          taskId: c1[0].id,
          leaseToken: c1[0].leaseToken,
          error: "x",
          retry: true,
        }),
      "55000",
    );
    await at(new Date(Date.parse(NOW) + 40 * 60_000).toISOString());
    expect(await svc("cockpit_meta_ad_days_claim", { limit: 5 })).toEqual([]);
    const tasks = await q<{ state: string; error: string }>(
      "SELECT state, error FROM cockpit_meta_ad_day_tasks WHERE run_id=$1",
      [begun.runId],
    );
    expect(tasks.map(t => t.state)).toEqual(["failed", "failed"]);
    expect(tasks[0].error).toContain("Not finished after 4 tries.");
    const [run] = await q<{ state: string }>(
      "SELECT state FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [begun.runId],
    );
    expect(run.state).toBe("failed");
    await at(NOW);
  });

  test("a failure with tries left goes back to the queue; one without them is failed and named in the note", async () => {
    const accounts = [
      account(A1, "USD"),
      account(A3, "USD", { name: "Loose Account" }),
    ];
    const begun = await svc("cockpit_meta_ad_days_begin", {
      job: "backfill",
      accounts,
      tasks: [
        dayTask(A1, "2026-10-01", "2026-10-07"),
        dayTask(A3, "2026-10-01", "2026-10-07"),
      ],
    });
    const claimed = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
    const a1 = claimed.find((t: any) => t.accountId === A1);
    const a3 = claimed.find((t: any) => t.accountId === A3);
    const retry = await svc("cockpit_meta_ad_days_fail", {
      taskId: a1.id,
      leaseToken: a1.leaseToken,
      error: "Meta's rate limit",
      retry: true,
    });
    expect(retry.state).toBe("pending");
    const fail = await svc("cockpit_meta_ad_days_fail", {
      taskId: a3.id,
      leaseToken: a3.leaseToken,
      retry: false,
      error:
        "Meta refused act_3333333333333/insights (code 100/33). The ad account is not shared with Mahara's business.",
    });
    expect(fail.state).toBe("failed");
    // A rate-limited read waits 3 minutes per try before it can be claimed again.
    expect(await svc("cockpit_meta_ad_days_claim", { limit: 5 })).toEqual([]);
    const [wait] = await q<{ s: number }>(
      "SELECT extract(epoch FROM retry_at - $2::timestamptz)::int s FROM cockpit_meta_ad_day_tasks WHERE id = $1",
      [a1.id, NOW],
    );
    expect(wait.s).toBe(180);
    const later = new Date(Date.parse(NOW) + 4 * 60_000).toISOString();
    await at(later);
    const [again] = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
    expect(again.accountId).toBe(A1);
    expect(again.attempt).toBe(2);
    await svc("cockpit_meta_ad_days_apply", {
      taskId: again.id,
      leaseToken: again.leaseToken,
      fetchedAt: later,
      final: true,
      rows: [],
    });
    await at(NOW);
    const [run] = await q<{ state: string; note: string }>(
      "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [begun.runId],
    );
    expect(run.state).toBe("partial");
    expect(run.note).toContain("Read 1 of 2 ad accounts");
    expect(run.note).toContain(
      `Could not read Loose Account (${A3}): Meta refused act_${A3}/insights (code 100/33).`,
    );
    const [sync] = await q<{ ok: boolean }>(
      "SELECT ok FROM cockpit_sync_state WHERE key='meta-ad-days-backfill'",
    );
    expect(sync.ok).toBe(false);
  });
});

describe("reach", () => {
  async function reachRun(accounts: any[], reach: "account" | "all") {
    const begun = await svc("cockpit_meta_ad_days_begin", {
      job: "nightly",
      accounts,
      tasks: [],
      reach,
    });
    const claimed = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
    return { begun, claimed: claimed as any[] };
  }
  const windows = [
    "last_7",
    "last_14",
    "last_30",
    "this_month",
    "last_month",
    "last_7_full",
    "last_30_full",
  ];

  test("account rows per window, the client row from its two accounts, and a failed account makes the client's reach unknown", async () => {
    await closeOpenRuns();
    const { begun, claimed } = await reachRun(
      [account(A1, "USD"), account(A2, "SAR"), account(A3, "USD")],
      "all",
    );
    expect(claimed.length).toBe(3);
    expect(claimed[0].windows.map((w: any) => w.key)).toEqual(windows);
    expect(claimed[0].windows[0]).toEqual({
      key: "last_7",
      from: "2026-10-10",
      to: "2026-10-16",
    });
    for (const t of claimed) {
      const n = t.accountId === A1 ? 100 : t.accountId === A2 ? 50 : 7;
      await svc("cockpit_meta_reach_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        level: "account",
        computedAt: NOW,
        final: false,
        rows: windows.map((w, i) => ({
          key: t.accountId,
          window_key: w,
          reach: n * (i + 1),
          impressions: n * (i + 1) * 2,
        })),
      });
      await svc("cockpit_meta_reach_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        level: "ad",
        computedAt: NOW,
        final: true,
        rows: [
          {
            key: `${t.accountId.slice(0, 1)}00000000000099`,
            window_key: "last_7",
            reach: 10,
            impressions: 15,
          },
        ],
      });
    }
    const [run] = await q<{ state: string; note: string }>(
      "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [begun.runId],
    );
    expect(run.state).toBe("ok");
    expect(run.note).toContain("Reach read for 3 accounts.");
    const client = await q<any>(
      "SELECT window_key, reach::int, impressions::int, note FROM cockpit_meta_reach WHERE level='client' AND key='LOC_ONE' ORDER BY reach",
    );
    expect(client.length).toBe(7);
    expect(client[0]).toEqual({
      window_key: "last_7",
      reach: 150,
      impressions: 300,
      note: "The sum of 2 ad accounts: a person reached by two of them counts twice.",
    });
    const [ad] = await q<any>(
      "SELECT level, account_id, to_char(from_day,'YYYY-MM-DD') f FROM cockpit_meta_reach WHERE key='100000000000099'",
    );
    expect(ad).toEqual({ level: "ad", account_id: A1, f: "2026-10-10" });

    // Next hour, account level only: A2 cannot be read, so Client One's reach is unknown.
    const next = await reachRun(
      [account(A1, "USD"), account(A2, "SAR")],
      "account",
    );
    const busy = next.begun.started === false;
    expect(busy).toBe(false);
    for (const t of next.claimed) {
      if (t.accountId === A2) {
        await svc("cockpit_meta_ad_days_fail", {
          taskId: t.id,
          leaseToken: t.leaseToken,
          error: "Meta refused act_2222222222222/insights (code 10).",
          retry: false,
        });
      } else {
        await refused(
          () =>
            svc("cockpit_meta_reach_apply", {
              taskId: t.id,
              leaseToken: t.leaseToken,
              level: "ad",
              computedAt: NOW,
              final: true,
              rows: [],
            }),
          "22023",
        );
        await svc("cockpit_meta_reach_apply", {
          taskId: t.id,
          leaseToken: t.leaseToken,
          level: "account",
          computedAt: NOW,
          final: true,
          rows: windows.map(w => ({
            key: A1,
            window_key: w,
            reach: 1,
            impressions: 2,
          })),
        });
      }
    }
    const [unknown] = await q<any>(
      "SELECT reach, impressions, note FROM cockpit_meta_reach WHERE level='client' AND key='LOC_ONE' AND window_key='last_7'",
    );
    expect(unknown).toEqual({
      reach: null,
      impressions: null,
      note: `Could not read ad account ${A2}, so this client's reach is unknown.`,
    });
    // The ad rows of the nightly pass were not touched by an account-level pass.
    const [adKept] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_reach WHERE level='ad'",
    );
    expect(adKept.n).toBe(3);
  });

  test("reach rows are checked: another account, a window not asked for, two rows for one ad", async () => {
    await closeOpenRuns();
    const { claimed } = await reachRun([account(A3, "USD")], "all");
    const t = claimed[0];
    const send = (level: string, rows: unknown[]) =>
      svc("cockpit_meta_reach_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        level,
        computedAt: NOW,
        final: false,
        rows,
      });
    expect(
      await refused(
        () =>
          send("account", [
            { key: A1, window_key: "last_7", reach: 1, impressions: 1 },
          ]),
        "22023",
      ),
    ).toContain("another ad account");
    expect(
      await refused(
        () =>
          send("ad", [
            {
              key: "900000000000001",
              window_key: "last_90",
              reach: 1,
              impressions: 1,
            },
          ]),
        "22023",
      ),
    ).toContain("did not ask for");
    expect(
      await refused(
        () =>
          send("ad", [
            {
              key: "900000000000001",
              window_key: "last_7",
              reach: 1,
              impressions: 1,
            },
            {
              key: "900000000000001",
              window_key: "last_7",
              reach: 2,
              impressions: 2,
            },
          ]),
        "22023",
      ),
    ).toContain("twice");
    await closeOpenRuns();
  });
});

describe("status, record and the kicks", () => {
  test("status: the last run of each job, the accounts with their last day and failure, and the not-linked list", async () => {
    await service();
    const s = (
      await db.query<{ r: any }>(
        "SELECT public.cockpit_meta_ad_days_status() r",
      )
    ).rows[0].r;
    expect(s.today).toBe("2026-10-16");
    expect(s.tieSource).toBe("board_clients");
    expect(Object.keys(s.jobs).sort()).toEqual([
      "backfill",
      "hourly",
      "nightly",
    ]);
    expect(s.store.rows).toBeGreaterThan(0);
    const a1 = s.accounts.find((a: any) => a.accountId === A1);
    expect(a1).toMatchObject({
      linked: true,
      locationId: "LOC_ONE",
      currency: "USD",
    });
    const a3 = s.accounts.find((a: any) => a.accountId === A3);
    expect(a3.linked).toBe(false);
    expect(s.reach.client.rows).toBe(7);
    // The board's definer functions call it as the owner.
    await owner(db);
    const [own] = await q<{ r: any }>(
      "SELECT public.cockpit_meta_ad_days_status() r",
    );
    expect(own.r.today).toBe("2026-10-16");
  });

  test("record writes the job's sync row and an audit row", async () => {
    await svc("cockpit_meta_ad_days_record", {
      job: "hourly",
      ok: false,
      note: "The ad accounts could not be listed: META_SYSTEM_TOKEN is not set on meta-ad-days.",
      requestedBy: "cron",
    });
    const [sync] = await q<{ ok: boolean; note: string }>(
      "SELECT ok, note FROM cockpit_sync_state WHERE key='meta-ad-days-hourly'",
    );
    expect(sync).toEqual({
      ok: false,
      note: "The ad accounts could not be listed: META_SYSTEM_TOKEN is not set on meta-ad-days.",
    });
    const [audit] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_audit_log WHERE action='meta_ad_days.not_run'",
    );
    expect(audit.n).toBe(1);
    await refused(
      () => svc("cockpit_meta_ad_days_record", { job: "weekly", ok: true }),
      "22023",
    );
  });

  test("the kick posts nothing while the queue is idle, and names a missing vault secret", async () => {
    await closeOpenRuns();
    await owner(db);
    await db.exec(
      "DELETE FROM cockpit_sync_state WHERE key='meta-ad-days-kick'",
    );
    const [idle] = await q<{ r: string | null }>(
      "SELECT public.cockpit_meta_ad_days_kick('continue')::text r",
    );
    expect(idle.r).toBeNull();
    expect(
      (
        await q(
          "SELECT 1 FROM cockpit_sync_state WHERE key='meta-ad-days-kick'",
        )
      ).length,
    ).toBe(0);
    const [hourly] = await q<{ r: string | null }>(
      "SELECT public.cockpit_meta_ad_days_kick('hourly')::text r",
    );
    expect(hourly.r).toBeNull();
    const [sync] = await q<{ ok: boolean; note: string }>(
      "SELECT ok, note FROM cockpit_sync_state WHERE key='meta-ad-days-kick'",
    );
    expect(sync).toEqual({
      ok: false,
      note: "The vault has no cockpit_sync_secret, so meta-ad-days was not started. Add it to the vault.",
    });
    await refused(
      () => db.query("SELECT public.cockpit_meta_ad_days_kick('backfill')"),
      "22023",
    );
  });

  test("the cron jobs sit inside the cron markers and name the kick", () => {
    const sql = migration(FILE);
    const block = sql.slice(
      sql.indexOf("-- cron:begin"),
      sql.indexOf("-- cron:end"),
    );
    expect(block).toContain("'mahara-meta-ad-days-hourly','7 * * * *'");
    expect(block).toContain("'mahara-meta-ad-days-nightly','20 0 * * *'");
    expect(block).toContain("'mahara-meta-ad-days-drain','*/2 * * * *'");
    expect(sql.split("cron.schedule(").length - 1).toBe(3);
    expect(sql.indexOf("cron.schedule(")).toBeGreaterThan(
      sql.indexOf("-- cron:begin"),
    );
  });
});

describe("the Edge Function's run against this database", () => {
  /** The function's RPC door played against PGlite, as the service role. */
  const pgRpc = async (name: string, args: Record<string, unknown>) => {
    await service();
    const r =
      "p" in args
        ? await db.query<{ r: unknown }>(
            `SELECT public.${name}($1::jsonb) AS r`,
            [JSON.stringify((args as any).p)],
          )
        : await db.query<{ r: unknown }>(`SELECT public.${name}() AS r`);
    return r.rows[0]?.r ?? null;
  };
  const pgReceipt = async (row: ReceiptRow) => {
    await service();
    await db.query(
      "INSERT INTO public.cockpit_meta_ad_day_receipts(provider,method,resource,phase,http_status,error,run_id,receipt_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        row.provider,
        row.method,
        row.resource,
        row.phase,
        row.http_status ?? null,
        row.error ?? null,
        row.run_id,
        row.receipt_index,
      ],
    );
  };
  const edges: Route = c => {
    const path = graphPath(c);
    if (path === "767701513092162/owned_ad_accounts") return ok({ data: [] });
    if (path === "767701513092162/client_ad_accounts") {
      return ok({
        data: [
          edgeAccount(
            KUWAIT_ACCOUNT,
            "Kuwait Client",
            "USD",
            "Asia/Kuwait",
            300,
          ),
          edgeAccount(SAR_ACCOUNT, "Riyadh Client", "SAR", "Asia/Riyadh", 1200),
        ],
      });
    }
    return null;
  };
  const reachRoute: Route = c => {
    if (
      c.url.searchParams.get("time_increment") ||
      !c.url.searchParams.get("time_ranges")
    )
      return null;
    const id = graphPath(c).split("/")[0].replace("act_", "");
    const ranges = JSON.parse(c.url.searchParams.get("time_ranges") ?? "[]");
    return ok({
      data: ranges.map((r: any, i: number) => ({
        account_id: id,
        impressions: String(1000 * (i + 1)),
        reach: String(700 * (i + 1)),
        date_start: r.since,
        date_stop: r.until,
      })),
    });
  };
  function harness(spendKuwait: string) {
    const f = fakeFetch([
      edges,
      insightsRoute(KUWAIT_ACCOUNT, (since, until) =>
        eachDay(since, until).flatMap(d => [
          videoLeadRow(d, { spend: spendKuwait }),
          imageLeadRow(d),
        ]),
      ),
      insightsRoute(SAR_ACCOUNT, (since, until) =>
        eachDay(since, until).flatMap(d => [
          engagementRow(d),
          whatsappLeadRow(d),
        ]),
      ),
      adsetsRoute(DESTINATIONS),
      reachRoute,
    ]);
    const deps: RunDeps = {
      rpc: pgRpc,
      insertReceipt: pgReceipt,
      fetch: f.request,
      token: () => TOKEN,
      now: () => RUN_NOW,
      sleep: async () => undefined,
    };
    return { deps, calls: f.calls };
  }

  test("an hourly run lands every ad-day, converts SAR, keeps messaging leads out of leads, and reads account reach", async () => {
    await closeOpenRuns();
    await at(new Date(RUN_NOW).toISOString());
    await owner(db);
    await db.exec(
      "DELETE FROM cockpit_meta_ad_days; DELETE FROM cockpit_meta_ad_day_receipts;",
    );
    const h = harness("6.87");
    const r = await startJob(h.deps, {
      job: "hourly",
      dryRun: false,
      requestedBy: "cron",
    });
    expect(r).toMatchObject({ ok: true, started: true, done: 4, failed: 0 });
    const rows = await q<any>(
      "SELECT account_id, to_char(day,'YYYY-MM-DD') d, ad_id, spend::text, spend_usd::text, leads, lead_actions::int, video_3s, account_timezone, destination_type FROM cockpit_meta_ad_days ORDER BY account_id, day, ad_id",
    );
    expect(rows.length).toBe(8);
    const sar = rows.filter(x => x.account_id === SAR_ACCOUNT);
    expect(
      sar.map(x => [
        x.d,
        x.ad_id,
        Number(x.spend),
        Number(x.spend_usd),
        x.leads,
        x.lead_actions,
        x.destination_type,
      ]),
    ).toEqual([
      ["2026-10-15", "120000000000203", 14, 3.7324, null, 4, null],
      ["2026-10-15", "120000000000403", 50.58, 13.484628, null, 3, "WHATSAPP"],
      ["2026-10-16", "120000000000203", 14, 3.7324, null, 4, null],
      ["2026-10-16", "120000000000403", 50.58, 13.484628, null, 3, "WHATSAPP"],
    ]);
    // Form leads and the spend behind them: the instant form's only; the WhatsApp lead ad set's spend stays out.
    const [cpl] = await q<{ leads: number; spend: string }>(
      "SELECT sum(leads)::int leads, sum(spend) FILTER (WHERE leads IS NOT NULL)::text spend FROM cockpit_meta_ad_days",
    );
    expect(cpl.leads).toBe(2 * (2 + 1));
    expect(Number(cpl.spend)).toBeCloseTo(2 * (6.87 + 12.1), 6);
    expect(
      rows
        .filter(x => x.account_id === KUWAIT_ACCOUNT)
        .every(x => x.destination_type === "ON_AD"),
    ).toBe(true);
    const image = rows.find(x => x.ad_id === "120000000000104");
    expect(image.video_3s).toBeNull();
    // The second source inside the test: what Meta sent is what was stored.
    const [sum] = await q<{ s: string }>(
      "SELECT sum(spend)::text s FROM cockpit_meta_ad_days WHERE account_id = $1",
      [KUWAIT_ACCOUNT],
    );
    expect(Number(sum.s)).toBeCloseTo(2 * (6.87 + 12.1), 6);
    const reach = await q<any>(
      "SELECT key, window_key, reach::int FROM cockpit_meta_reach WHERE level='account' AND key=$1 ORDER BY reach",
      [KUWAIT_ACCOUNT],
    );
    // Seven windows: five ending today, two ending yesterday.
    expect(reach.map(x => x.reach)).toEqual([
      700, 1400, 2100, 2800, 3500, 4200, 4900,
    ]);
    const [run] = await q<{ state: string; note: string }>(
      "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [r.runId],
    );
    expect(run.state).toBe("ok");
    expect(run.note).toContain(
      "Read 2 of 2 ad accounts: 8 ad-days written, 8 new or changed. Reach read for 2 accounts.",
    );
    // Both accounts are Client One's (the spine ties them), so nothing is listed as not linked,
    // and the client's reach is the sum of its two accounts.
    expect(run.note).not.toContain("Not linked");
    const [client] = await q<any>(
      "SELECT reach::int, note FROM cockpit_meta_reach WHERE level='client' AND key='LOC_ONE' AND window_key='last_7'",
    );
    expect(client).toEqual({
      reach: 1400,
      note: "The sum of 2 ad accounts: a person reached by two of them counts twice.",
    });
    const [receipts] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_ad_day_receipts",
    );
    expect(receipts.n).toBe(h.calls.length * 2);
  });

  test("run again: nothing new, one changed spend replaces its row, nothing deleted", async () => {
    await at(new Date(RUN_NOW + 3600_000).toISOString());
    const later = harness("7.10");
    const deps = { ...later.deps, now: () => RUN_NOW + 3600_000 };
    const r = await startJob(deps, {
      job: "hourly",
      dryRun: false,
      requestedBy: "cron",
    });
    expect(r).toMatchObject({ started: true, failed: 0 });
    const [run] = await q<{ note: string }>(
      "SELECT note FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [r.runId],
    );
    expect(run.note).toContain("8 ad-days written, 2 new or changed.");
    const [n] = await q<{ n: number; s: string }>(
      "SELECT count(*)::int n, sum(spend)::text s FROM cockpit_meta_ad_days WHERE account_id = $1",
      [KUWAIT_ACCOUNT],
    );
    expect(n.n).toBe(4);
    expect(Number(n.s)).toBeCloseTo(2 * (7.1 + 12.1), 6);
    await at(NOW);
  });
});

describe("client reach after Kuwait midnight", () => {
  const W = ["last_7", "last_14", "last_30", "this_month", "last_month"];
  const A5 = "5555555555555"; // Client Two's second account: it delivered in September only
  /** One reach run of `job` at `iso`: each account's account-level rows (one reach for every window, or per window). */
  async function reachPass(
    iso: string,
    job: "hourly" | "nightly",
    reach: Record<string, number | Record<string, number>>,
  ) {
    await at(iso);
    await closeOpenRuns();
    const begun = await svc("cockpit_meta_ad_days_begin", {
      job,
      accounts: Object.keys(reach).map(id => account(id, "USD")),
      tasks: [],
      reach: job === "hourly" ? "account" : "all",
    });
    expect(begun.started).toBe(true);
    const claimed = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
    for (const t of claimed) {
      const r = reach[t.accountId];
      const of = (w: string) => (typeof r === "number" ? r : (r[w] ?? 0));
      await svc("cockpit_meta_reach_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        level: "account",
        computedAt: iso,
        final: true,
        rows: W.map(w => ({
          key: t.accountId,
          window_key: w,
          reach: of(w),
          impressions: of(w) * 2,
        })),
      });
    }
    const [run] = await q<{ state: string }>(
      "SELECT state FROM cockpit_meta_ad_day_runs WHERE id=$1",
      [begun.runId],
    );
    expect(run.state).toBe("ok");
  }
  const client = async (loc: string, window = "last_7") =>
    (
      await q<any>(
        "SELECT reach::int, impressions::int, note, to_char(to_day,'YYYY-MM-DD') to_day FROM cockpit_meta_reach WHERE level='client' AND key=$1 AND window_key=$2",
        [loc, window],
      )
    )[0];

  test("an account the hourly run did not re-read makes the client's reach wait, never shrink to the other account", async () => {
    await owner(db);
    // The client spine as the board's facts migration shapes it (also when this test runs alone).
    await db.exec(`DELETE FROM cockpit_meta_reach;
      CREATE TABLE IF NOT EXISTS public.cockpit_board_clients (location_id text PRIMARY KEY, clickup_id text, client_name text, status text,
        service_mode text, ad_account_ids text[], tiktok boolean, updated_at timestamptz);
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_ONE','c1','Client One','Active','DFY',ARRAY['act_${A1}','${A2}'],false,now())
        ON CONFLICT (location_id) DO NOTHING;
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_TWO','c2','Client Two','Active','DFY',ARRAY['${A3}','${A5}'],false,now());`);
    // Day D (31 Oct), the nightly run at 03:20 Kuwait: A1 and A2 for Client One; A3 and A5 for Client Two.
    await reachPass("2026-10-31T03:20:00+03:00", "nightly", {
      [A1]: 1000,
      [A2]: 400,
      [A3]: 300,
      [A5]: { last_month: 50 },
    });
    expect(await client("LOC_ONE")).toEqual({
      reach: 1400,
      impressions: 2800,
      note: "The sum of 2 ad accounts: a person reached by two of them counts twice.",
      to_day: "2026-10-31",
    });
    expect((await client("LOC_TWO", "last_month")).reach).toBe(350);

    // D+1 00:07 Kuwait, the hourly run: only A1 and A3 spent in the last two days, so only they are re-read.
    // Before this fix Client One showed A1's 1,100 alone, with no note.
    await reachPass("2026-11-01T00:07:00+03:00", "hourly", {
      [A1]: 1100,
      [A3]: 320,
    });
    expect(await client("LOC_ONE")).toEqual({
      reach: null,
      impressions: null,
      note: `Ad account ${A2} not re-read since 2026-10-31; this client's reach waits for the nightly run.`,
      to_day: "2026-11-01",
    });
    expect(await client("LOC_TWO", "last_month")).toEqual({
      reach: null,
      impressions: null,
      note: `Ad account ${A5} not re-read since 2026-09-30; this client's reach waits for the nightly run.`,
      to_day: "2026-10-31",
    });
    // A2's own row is kept, on its own days, for the board to read as stale.
    const [a2] = await q<any>(
      "SELECT reach::int, to_char(to_day,'YYYY-MM-DD') to_day FROM cockpit_meta_reach WHERE level='account' AND key=$1 AND window_key='last_7'",
      [A2],
    );
    expect(a2).toEqual({ reach: 400, to_day: "2026-10-31" });

    // D+1 03:20, the nightly run re-reads every account that delivered in any of today's windows: Client One is
    // whole again. A5 delivered in none (September only), so it is not re-read, and its old rows go before the
    // client rows are built: Client Two is A3 alone, which is the whole of it.
    await reachPass("2026-11-01T03:20:00+03:00", "nightly", {
      [A1]: 1150,
      [A2]: 450,
      [A3]: 330,
    });
    expect(await client("LOC_ONE")).toEqual({
      reach: 1600,
      impressions: 3200,
      note: "The sum of 2 ad accounts: a person reached by two of them counts twice.",
      to_day: "2026-11-01",
    });
    expect(await client("LOC_TWO", "last_month")).toEqual({
      reach: 330,
      impressions: 660,
      note: null,
      to_day: "2026-10-31",
    });
    const [left] = await q<{ n: number }>(
      "SELECT count(*)::int n FROM cockpit_meta_reach WHERE key=$1",
      [A5],
    );
    expect(left.n).toBe(0);
    await owner(db);
    await db.exec(
      "DELETE FROM public.cockpit_board_clients WHERE location_id='LOC_TWO'",
    );
    await at(NOW);
  });
});

describe("the corrections after the 2026-10-16 check", () => {
  const A6 = "6666666666661"; // read for reach
  const A7 = "7777777777771"; // delivered in September, never read for reach
  const A8 = "8888888888881"; // the only account of a client, never read for reach
  const A9 = "9999999999991"; // hidden on purpose by a clients row
  const A10 = "1010101010101"; // Mahara's own Mass Design account
  const A11 = "1111111111119"; // still spending for a cancelled client
  const adDay = (
    accountId: string,
    day: string,
    impressions: number,
    spend = 1,
  ) =>
    q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id, account_name, account_currency, day, ad_id, spend, spend_usd, usd_rate, impressions, fetched_at)
       VALUES ($1, 'Account', 'USD', $2::date, $3, $4, $4, 1, $5, $6::timestamptz)`,
      [
        accountId,
        day,
        `${accountId.slice(0, 6)}${day.replaceAll("-", "")}`,
        spend,
        impressions,
        NOW,
      ],
    );

  test("a client's reach waits while an account that delivered in the window has not been read for it; a client with no account row still gets one", async () => {
    await at(NOW);
    await closeOpenRuns();
    await owner(db);
    await db.exec(`DELETE FROM cockpit_meta_reach;
      CREATE TABLE IF NOT EXISTS public.cockpit_board_clients (location_id text PRIMARY KEY, clickup_id text, client_name text, status text,
        service_mode text, ad_account_ids text[], tiktok boolean, updated_at timestamptz);
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_THREE','c3','Client Three','Active','DFY',ARRAY['${A6}','${A7}'],false,now()),
        ('LOC_FOUR','c4','Client Four','Active','DFY',ARRAY['${A8}'],false,now());`);
    await adDay(A7, "2026-09-20", 500);
    await adDay(A8, "2026-10-09", 300);
    try {
      const begun = await svc("cockpit_meta_ad_days_begin", {
        job: "hourly",
        accounts: [account(A6, "USD")],
        tasks: [],
        reach: "account",
      });
      const [t] = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
      await svc("cockpit_meta_reach_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        level: "account",
        computedAt: NOW,
        final: true,
        rows: t.windows.map((w: any) => ({
          key: A6,
          window_key: w.key,
          reach: 100,
          impressions: 150,
        })),
      });
      const [run] = await q<{ state: string }>(
        "SELECT state FROM cockpit_meta_ad_day_runs WHERE id=$1",
        [begun.runId],
      );
      expect(run.state).toBe("ok");
      const row = async (loc: string, w: string) =>
        (
          await q<any>(
            "SELECT reach::int, impressions::int, note FROM cockpit_meta_reach WHERE level='client' AND key=$1 AND window_key=$2",
            [loc, w],
          )
        )[0];
      // A7 delivered on 20 Sep, inside the last 30 days, and was never read:
      // the client's 30-day reach is unknown, not A6 alone (Marble and more).
      expect(await row("LOC_THREE", "last_30")).toEqual({
        reach: null,
        impressions: null,
        note: `Ad account ${A7} has not been read for this window yet; this client's reach waits for the nightly run.`,
      });
      // In the last 7 days only A6 delivered: its reach is the client's.
      expect(await row("LOC_THREE", "last_7")).toEqual({
        reach: 100,
        impressions: 150,
        note: null,
      });
      // A client whose only account was never read still has a row that says
      // so (ARCWANI, Liwan before the first nightly run).
      expect(await row("LOC_FOUR", "last_30")).toMatchObject({
        reach: null,
        note: expect.stringContaining(A8),
      });
      expect(await row("LOC_FOUR", "last_7_full")).toMatchObject({
        reach: null,
      });
      expect(await row("LOC_FOUR", "last_7")).toBeUndefined();
    } finally {
      await owner(db);
      await db.exec(`DELETE FROM public.cockpit_board_clients WHERE location_id IN ('LOC_THREE','LOC_FOUR');
        DELETE FROM public.cockpit_meta_ad_days WHERE account_id IN ('${A7}','${A8}');`);
    }
  });

  test("hidden accounts are named apart, a cancelled client's spend and an account Meta stops are named, and inputs takes ids alone", async () => {
    // After every other run in this file (the midnight test stands on 1 Nov),
    // so this run is the latest the status reads.
    await at("2026-11-02T09:05:00+03:00");
    await closeOpenRuns();
    await owner(db);
    await db.exec(`CREATE TABLE IF NOT EXISTS public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, meta_ad_account_id text,
        ghl_location_id text, hidden_from_dashboard boolean);
      INSERT INTO public.clients(name, meta_ad_account_id, hidden_from_dashboard) VALUES ('ORB', 'act_${A9}', true);
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_GONE','cg','Gone Client','Cancelled','DFY',ARRAY['${A11}'],false,now());`);
    await adDay(A11, "2026-11-01", 900, 20);
    try {
      const accounts = [
        account(A3, "USD", { name: "Loose Account" }),
        account(A9, "USD", { name: "ORB" }),
        account(A10, "USD", { name: "Mahara Mass Design" }),
        account(A11, "USD", { name: "Gone Ads" }),
        account(A2, "SAR", { name: "Riyadh Client", status: 3 }),
      ];
      const inputs = await svc("cockpit_meta_ad_days_inputs", { accounts });
      expect(inputs.notLinked.map((a: any) => a.accountId)).toEqual([A3]);
      expect(inputs.hidden.map((a: any) => a.accountId).sort()).toEqual(
        [A10, A9].sort(),
      );
      expect(inputs.cancelled).toEqual([
        {
          accountId: A11,
          name: "Gone Ads",
          clientName: "Gone Client",
          status: "Cancelled",
        },
      ]);
      // Ids alone (the doctor's and the dry run's call before this fix).
      const ids = await svc("cockpit_meta_ad_days_inputs", {
        accountIds: [A3, A1],
      });
      expect(ids.ties.linked).toBe(1);
      expect(ids.notLinked).toEqual([
        { accountId: A3, name: null, currency: null, spend: null },
      ]);

      const begun = await svc("cockpit_meta_ad_days_begin", {
        job: "hourly",
        accounts,
        tasks: [],
        reach: null,
      });
      expect(begun.state).toBe("ok");
      expect(begun.notLinked).toEqual([
        { accountId: A3, name: "Loose Account" },
      ]);
      const [run] = await q<{ note: string }>(
        "SELECT note FROM cockpit_meta_ad_day_runs WHERE id=$1",
        [begun.runId],
      );
      expect(run.note).toContain(
        `Not linked to a client: Loose Account (${A3}, USD 100).`,
      );
      expect(run.note).toContain("Hidden on purpose: ");
      expect(run.note).toContain(`ORB (${A9}, USD 100)`);
      expect(run.note).toContain(
        `Spent for a cancelled or stopped client: Gone Ads (${A11}, Gone Client is Cancelled, USD 100).`,
      );

      await service();
      const s = (
        await db.query<{ r: any }>(
          "SELECT public.cockpit_meta_ad_days_status() r",
        )
      ).rows[0].r;
      expect(s.notLinked.map((a: any) => a.accountId)).toEqual([A3]);
      expect(s.hidden.map((a: any) => a.accountId).sort()).toEqual(
        [A10, A9].sort(),
      );
      expect(s.cancelledDelivering).toEqual([
        {
          accountId: A11,
          name: "Account",
          clientName: "Gone Client",
          clientStatus: "Cancelled",
          currency: "USD",
          spend2d: 20,
        },
      ]);
      // Riyadh Client is tied to Client One and Meta says its billing is unsettled.
      expect(s.billingStopped).toEqual([
        {
          accountId: A2,
          name: expect.any(String),
          locationId: "LOC_ONE",
          clientName: "Client One",
          status: 3,
          statusLabel: "unsettled",
          lastSpendDay: expect.anything(),
        },
      ]);
      const a2 = s.accounts.find((a: any) => a.accountId === A2);
      expect(a2).toMatchObject({
        status: 3,
        statusLabel: "unsettled",
        clientStatus: "Active",
      });
      // A hand row kept out of its client's figures (Alkhalil's own boost
      // account) is hidden on purpose, not "not linked".
      await owner(db);
      await db.exec(`CREATE TABLE public.cockpit_board_account_ties (account_id text PRIMARY KEY, location_id text, evidence text,
          added_by text, added_at timestamptz DEFAULT now(), kept_out boolean NOT NULL DEFAULT false);
        INSERT INTO public.cockpit_board_account_ties(account_id, location_id, evidence, added_by, kept_out)
          VALUES ('${A3}', 'LOC_ONE', 'The client''s own boosts', 'test', true);`);
      const kept = await svc("cockpit_meta_ad_days_inputs", { accounts });
      expect(kept.notLinked).toEqual([]);
      expect(kept.hidden.map((a: any) => a.accountId).sort()).toEqual(
        [A10, A3, A9].sort(),
      );
    } finally {
      await owner(db);
      await db.exec(`DROP TABLE IF EXISTS public.cockpit_board_account_ties;
        DELETE FROM public.clients WHERE meta_ad_account_id = 'act_${A9}';
        DELETE FROM public.cockpit_board_clients WHERE location_id = 'LOC_GONE';
        DELETE FROM public.cockpit_meta_ad_days WHERE account_id = '${A11}';`);
      await at(NOW);
    }
  });

  test("a nightly run plans one lead-ids task per account with form leads; the leads land by id and are matched to the CRM one to one by ad", async () => {
    const A13 = "1313131313131";
    const A14 = "1414141414141";
    const [AD1, AD2, AD3] = [
      "131300000000001",
      "131300000000002",
      "131300000000003",
    ];
    await at("2026-11-03T03:20:00+03:00");
    await closeOpenRuns();
    await owner(db);
    await db.exec(`CREATE TABLE IF NOT EXISTS public.client_leads (ghl_contact_id text PRIMARY KEY, location_id text, created_at timestamptz,
        ad_id text, deleted boolean);
      INSERT INTO public.cockpit_board_clients VALUES ('LOC_LEAD','cl','Lead Client','Active','DFY',ARRAY['${A13}'],false,now()),
        ('LOC_NOREAD','cl2','Unread Client','Active','DFY',ARRAY['${A14}'],false,now());
      INSERT INTO public.client_leads VALUES ('c1','LOC_LEAD','2026-11-01T10:01:00+03:00','${AD1}',false),
        ('c2','LOC_LEAD','2026-11-01T10:06:00+03:00','${AD1}',false),
        ('c3','LOC_LEAD','2026-11-01T10:07:00+03:00','${AD1}',true),
        ('c4','LOC_LEAD','2026-11-02T12:00:00+03:00','${AD1}',false),
        ('c5','LOC_LEAD','2026-11-03T01:02:00+03:00','${AD1}',false);
      -- A lead older than 180 days: the final call deletes it.
      INSERT INTO public.cockpit_meta_lead_ids VALUES ('990000000000099','${AD1}','${A13}','2026-04-01T00:00:00Z','2026-04-02T00:00:00Z');`);
    const leadDay = (ad: string, leads: number) =>
      q(
        `INSERT INTO public.cockpit_meta_ad_days(account_id, day, ad_id, leads, lead_actions, impressions, fetched_at)
         VALUES ($1, '2026-11-01', $2, $3, $3, 100, $4::timestamptz)`,
        [A13, ad, leads, NOW],
      );
    await leadDay(AD1, 3);
    await leadDay(AD2, 1);
    await leadDay(AD3, 0);
    // A client with form leads on an account no nightly run has read.
    await q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id, day, ad_id, leads, lead_actions, impressions, fetched_at)
       VALUES ($1, '2026-11-01', '141400000000001', 2, 2, 100, $2::timestamptz)`,
      [A14, NOW],
    );
    try {
      const begun = await svc("cockpit_meta_ad_days_begin", {
        job: "nightly",
        accounts: [account(A13, "USD", { name: "Lead Account" })],
        tasks: [],
        reach: null,
        leadIds: true,
      });
      expect(begun.tasks).toBe(1);
      const [t] = await svc("cockpit_meta_ad_days_claim", { limit: 5 });
      expect(t.kind).toBe("lead_ids");
      // Only the ads with form leads in the last 31 days.
      expect([...t.adIds].sort()).toEqual([AD1, AD2]);
      const msg = await refused(
        () =>
          svc("cockpit_meta_lead_ids_apply", {
            taskId: t.id,
            leaseToken: t.leaseToken,
            fetchedAt: "2026-11-03T03:20:00+03:00",
            rows: [
              {
                lead_id: "990000000000009",
                ad_id: AD3,
                created_time: "2026-11-01T08:00:00Z",
              },
            ],
            final: false,
          }),
        "22023",
      );
      expect(msg).toContain("an ad the task did not ask for");
      await svc("cockpit_meta_lead_ids_apply", {
        taskId: t.id,
        leaseToken: t.leaseToken,
        fetchedAt: "2026-11-03T03:20:00+03:00",
        rows: [
          {
            lead_id: "990000000000001",
            ad_id: AD1,
            created_time: "2026-11-01T07:00:00Z",
          },
          {
            lead_id: "990000000000002",
            ad_id: AD1,
            created_time: "2026-11-01T07:05:00Z",
          },
          {
            lead_id: "990000000000003",
            ad_id: AD1,
            created_time: "2026-11-02T06:00:00Z",
          },
          {
            lead_id: "990000000000004",
            ad_id: AD2,
            created_time: "2026-11-01T08:00:00Z",
          },
          // 23:00 Kuwait on the window's last day: never reached the CRM.
          {
            lead_id: "990000000000005",
            ad_id: AD1,
            created_time: "2026-11-02T20:00:00Z",
          },
          // 01:00 Kuwait the day after the window: its contact (c5) came at 01:02.
          {
            lead_id: "990000000000006",
            ad_id: AD1,
            created_time: "2026-11-02T22:00:00Z",
          },
        ],
        final: true,
        note: "Meta gives no lead access for 1 of 3 ads (the Page has not given Mahara lead access).",
        adsUnread: 0,
      });
      const [run] = await q<{ state: string; note: string }>(
        "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id=$1",
        [begun.runId],
      );
      expect(run.state).toBe("ok");
      expect(run.note).toContain(
        "Lead ids read for 1 account (Lead Account: Meta gives no lead access for 1 of 3 ads",
      );
      // AD1 in the window: 10:00 and 10:05 pair with c1 and c2 within minutes
      // (the deleted c3 does not count); 2 Nov 09:00 pairs with c4, three hours
      // late; 2 Nov 23:00 has no contact. c5 at 01:02 the next day is the 01:00
      // lead's own contact, so it does not cover the 23:00 lead (a count of
      // contacts up to a day after the window said 1 missing). AD2: 1 lead, no
      // contact.
      await service();
      const notInCrm = async (from: string, to: string) =>
        (
          await db.query<{ r: any }>(
            "SELECT public.cockpit_meta_leads_not_in_crm($1::date, $2::date) r",
            [from, to],
          )
        ).rows[0].r;
      const covered = {
        coveredFrom: "2026-10-03T00:20:00+00:00",
        readTo: "2026-11-03T00:20:00+00:00",
      };
      expect(await notInCrm("2026-11-01", "2026-11-02")).toEqual([
        { locationId: "LOC_LEAD", metaLeads: 5, inCrm: 3, notInCrm: 2, ...covered, note: null },
        {
          locationId: "LOC_NOREAD",
          metaLeads: null,
          inCrm: null,
          notInCrm: null,
          coveredFrom: null,
          readTo: null,
          note: `Meta's lead ids for act_${A14} have not been read yet (the nightly run reads them), so leads not in the CRM are not known.`,
        },
      ]);
      // A window that starts before the ids held is unknown, never 0.
      const [early] = await notInCrm("2026-10-01", "2026-11-02");
      expect(early).toMatchObject({ locationId: "LOC_LEAD", metaLeads: null, notInCrm: null });
      expect(early.note).toBe(
        "Meta's lead ids are held from 2026-10-03 03:20 Kuwait time; this window starts earlier, so leads not in the CRM are not known for it.",
      );
      // A window past the last read says so.
      const [late] = await notInCrm("2026-11-01", "2026-11-03");
      expect(late).toMatchObject({ locationId: "LOC_LEAD", metaLeads: 6, inCrm: 4, notInCrm: 2 });
      expect(late.note).toBe(
        "Meta's leads are read to 2026-11-03 03:20 Kuwait time; later leads wait for the next nightly run.",
      );
      const s = (
        await db.query<{ r: any }>(
          "SELECT public.cockpit_meta_ad_days_status() r",
        )
      ).rows[0].r;
      // The 180-day-old lead is gone.
      expect(s.leadIds.rows).toBe(6);
      expect(s.leadIds).toMatchObject({ accounts: 1, noLeadAccess: [] });
      // Every lead ad of a client unread (no lead access on the Page): unknown.
      await owner(db);
      await db.exec(`INSERT INTO public.cockpit_meta_lead_id_cover(account_id, covered_from, read_to, ads, ads_unread)
        VALUES ('${A14}', '2026-10-03T00:20:00Z', '2026-11-03T00:20:00Z', 1, 1)`);
      await service();
      const [, noAccess] = await notInCrm("2026-11-01", "2026-11-02");
      expect(noAccess).toMatchObject({ locationId: "LOC_NOREAD", metaLeads: null, notInCrm: null });
      expect(noAccess.note).toContain("the Page has not given Mahara's business lead access");
      await owner(db);
      await expect(
        q(
          "SELECT public.cockpit_meta_leads_not_in_crm('2026-08-01','2026-11-02')",
        ),
      ).rejects.toThrow("Choose up to 93 days");
    } finally {
      await owner(db);
      await db.exec(`DELETE FROM public.cockpit_board_clients WHERE location_id IN ('LOC_LEAD', 'LOC_NOREAD');
        DELETE FROM public.cockpit_meta_ad_days WHERE account_id IN ('${A13}', '${A14}');
        DELETE FROM public.cockpit_meta_lead_ids;
        DELETE FROM public.cockpit_meta_lead_id_cover;`);
      await at(NOW);
    }
  });
});
