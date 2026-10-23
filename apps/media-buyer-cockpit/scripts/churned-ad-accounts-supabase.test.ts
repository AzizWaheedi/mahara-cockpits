/**
 * Churned clients' ad accounts (migrations 20261023q_churned_ad_accounts.sql,
 * 20261023t_board_read_churned.sql and 20261023u_meta_ad_days_churned.sql; the CEO's cost
 * per booking decisions of 23 Oct 2026, 5: "triple edge is a old churned client"; contract
 * docs/client-performance/CPB-DECISIONS-20261023.md 1.5, 3.2, 3.5 and 3.6) on an isolated
 * PostgreSQL.
 *
 * It stands on the board's chain as board-cpl-golden-rule-supabase.test.ts builds it (the
 * Meta ad-days store and its notes come with it). It checks that the board read and the
 * three Meta ad-days functions are the live bodies the files were written against, that t
 * and u refuse before the table exists, then applies q twice (row security, no policy, the
 * service role's SELECT alone, Triple Edge's row and one audit row once), then t and u twice
 * each, and reads:
 *   - the board's "Not in these totals": the listed account reads "churned" with the list's
 *     client name; a listed account a cancelled client still carries reads "cancelled" (a
 *     live tie wins); an untied account stays "not_tied"; limited seats still get nothing;
 *     totals and rows are unchanged;
 *   - the Meta ad-days notes: the run note names the listed account as "Triple Edge Building
 *     Construction is Churned" under "Spent for a cancelled, stopped or churned client",
 *     never under "Not linked"; inputs and status leave it out of notLinked; status names it
 *     with clientStatus Churned and lists it in cancelledDelivering; a listed account tied to
 *     an Active client stays that client's.
 * The listed account id and name are Triple Edge's; every other client, account and number
 * is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const Q = "20261023q_churned_ad_accounts.sql";
const T = "20261023t_board_read_churned.sql";
const U = "20261023u_meta_ad_days_churned.sql";
const SIGS = {
  read: "public.cockpit_board_read(date,date)",
  finish: "public.cockpit_meta_ad_days_finish(uuid)",
  inputs: "public.cockpit_meta_ad_days_inputs(jsonb)",
  status: "public.cockpit_meta_ad_days_status()",
} as const;
type Fn = keyof typeof SIGS;
/** The live bodies and grants on 23 Oct (20261021a; 20261017100000 for the three Meta ones). */
const LIVE: Record<Fn, string> = {
  read: "b526537e282839af372d2c1f75c9e291",
  finish: "4eaec242a7c5f6eef2b648679cfeacdb",
  inputs: "41434eea3236bf3c00450bdca0574b69",
  status: "83f802620ce19710e8f73bd9d8747cc1",
};
const ACL: Record<Fn, string> = {
  read: "{postgres=X/postgres,authenticated=X/postgres}",
  finish: "{postgres=X/postgres}",
  inputs: "{postgres=X/postgres,service_role=X/postgres}",
  status: "{postgres=X/postgres,service_role=X/postgres}",
};

const CHAIN_FIRST = [
  "20261013180000_cockpit_client_calls.sql",
  "20261015200000_cockpit_client_calls_whatsapp_chats.sql",
  "20261013180200_cockpit_client_callers.sql",
  "20261016111157_board_facts.sql",
  "20261016121700_meta_ad_days.sql",
];
const CHAIN_BOARD = [
  "20261016133300_board_api.sql",
  "20261016210000_board_facts_checked.sql",
  "20261016210100_meta_ad_days_checked.sql",
  "20261017100000_meta_budgets.sql",
  "20261016220000_board_read_checked.sql",
  "20261016220100_board_read_notes.sql",
  "20261017090000_board_active_only.sql",
  "20261017100100_board_budgets.sql",
  "20261017120000_board_budget_issue_scope.sql",
  "20261021a_board_skip_excluded_ads.sql",
];

const CEO = "00000000-0000-4000-8000-0000000000a9";
const LIMITED = "00000000-0000-4000-8000-0000000000d3";

/** Triple Edge Building Construction, as the list seeds it. */
const TE = "2002793296961811";
const TE_NAME = "Triple Edge Building Construction";
/** Invented: an Active client's account, a cancelled client's (also listed), and an untied one. */
const LIVE_ACCT = "1500000001";
const GONE = "1500000002";
const LOOSE = "1500000003";
/** Invented: an account on the list that an Active client carries (a live tie wins). */
const TIED_LISTED = "1500000004";

const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
const FROM = kd(7);
const TO = kd(1);

const DIALER = (() => {
  const text = readFileSync(
    new URL("./board-facts-supabase.test.ts", import.meta.url),
    "utf8",
  );
  const hit = text.match(/const DIALER = String\.raw`([\s\S]*?)`;\n/);
  if (!hit || hit[1].includes("${"))
    throw new Error("The board facts test's DIALER block moved");
  return hit[1];
})();
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
const TEAM_ONLY = (() => {
  const sql = migration("20261017b_team_only_seats.sql");
  const fn = sql.match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_is_team_only\(\)[\s\S]*?\n\$\$;/,
  );
  const revoke = sql.match(
    /REVOKE ALL ON FUNCTION public\.cockpit_is_team_only\(\) FROM [^;]*;/,
  );
  const grant = sql.match(
    /GRANT EXECUTE ON FUNCTION public\.cockpit_is_team_only\(\) TO [^;]*;/,
  );
  if (!fn || !revoke || !grant)
    throw new Error("cockpit_is_team_only moved in 20261017b");
  return `${fn[0]}\n${revoke[0]}\n${grant[0]}`;
})();

let db: PGlite;
type Row = Record<string, any>;
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(text, params)).rows;
}
async function fn(
  f: Fn,
): Promise<{ md5: string; acl: string; definer: boolean }> {
  return (
    await q<{ md5: string; acl: string; definer: boolean }>(
      "SELECT md5(prosrc) md5, coalesce(proacl::text, '') acl, prosecdef definer FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIGS[f]],
    )
  )[0];
}
async function apply(file: string) {
  await owner(db);
  await db.exec(migration(file));
}
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
async function service() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
}
async function svc(name: string, p?: unknown): Promise<any> {
  await service();
  try {
    const r =
      p === undefined
        ? await db.query<{ r: any }>(`SELECT public.${name}() AS r`)
        : await db.query<{ r: any }>(`SELECT public.${name}($1::jsonb) AS r`, [
            JSON.stringify(p),
          ]);
    return r.rows[0].r;
  } finally {
    await owner(db);
  }
}
async function board(who: string): Promise<Row> {
  await actor(db, who);
  try {
    return (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_board_read($1::date,$2::date) r",
        [FROM, TO],
      )
    ).rows[0].r;
  } finally {
    await owner(db);
  }
}
async function adDay(
  account: string,
  name: string,
  day: string,
  spend: number,
) {
  await q(
    `INSERT INTO public.cockpit_meta_ad_days(account_id,account_name,account_currency,account_timezone,day,campaign_id,campaign_name,objective,
       adset_id,ad_id,spend,spend_usd,usd_rate,impressions,link_clicks,leads,lead_actions,destination_type,fetched_at)
     VALUES($1,$2,'USD','Asia/Kuwait',$3,$4,'Promote','OUTCOME_ENGAGEMENT',$5,$6,$7,$7,1,100,1,NULL,0,'ON_POST',now())`,
    [account, name, day, `7${account}`, `8${account}`, `9${account}`, spend],
  );
}
const acct = (accountId: string, name: string, spend: number) => ({
  accountId,
  name,
  currency: "USD",
  timezone: "Asia/Kuwait",
  status: 1,
  spend,
  edge: "client",
});
const ACCOUNTS = [
  acct(LIVE_ACCT, "Live Ads", 50),
  acct(GONE, "Gone Ads", 30.5),
  acct(LOOSE, "Loose Ads", 12.3),
  acct(TIED_LISTED, "Tied Listed Ads", 4),
  acct(TE, TE_NAME, 2.09),
];
/** A Meta run with no task: begin finishes it at once and writes its note. */
async function runNote(): Promise<{ note: string; begun: Row }> {
  const begun = await svc("cockpit_meta_ad_days_begin", {
    job: "hourly",
    requestedBy: "cron",
    graphVersion: "v25.0",
    window: { since: kd(3), until: TO },
    accounts: ACCOUNTS,
    tasks: [],
    reach: null,
  });
  const [r] = await q<{ note: string }>(
    "SELECT note FROM public.cockpit_meta_ad_day_runs WHERE id = $1",
    [begun.runId],
  );
  return { note: r.note, begun };
}
const offBoardOf = (b: Row) =>
  Object.fromEntries(
    ((b.offBoard?.accounts ?? []) as Row[]).map(a => [a.accountId, a]),
  );

let before: {
  fns: Record<Fn, { md5: string; acl: string; definer: boolean }>;
  board: Row;
  inputs: Row;
  status: Row;
  note: string;
};

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  const seat = migration("20261007d_cockpit_team_rpc_restore.sql").match(
    /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
  );
  if (!allowed || !seat) throw new Error("The seat checks moved");
  await db.exec(allowed[0]);
  await db.exec(seat[0]);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) TO authenticated, service_role;`);
  await db.exec(DIALER);
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, LIMITED, "limited@tests.invalid", ["csm"]);
  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of CHAIN_FIRST) await db.exec(migration(f));
  for (const f of CHAIN_BOARD) await db.exec(migration(f));
  await q(
    "UPDATE public.cockpit_members SET clients = ARRAY['Live Client'] WHERE auth_user_id = $1",
    [LIMITED],
  );

  await q(`INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES
    ('locChurnLive','cuLive','Live Client','Active','DFY',ARRAY['${LIVE_ACCT}','${TIED_LISTED}']),
    ('locChurnGone','cuGone','Gone Client','Cancelled','DFY',ARRAY['${GONE}'])`);
  for (const [a, name, spend] of [
    [LIVE_ACCT, "Live Ads", 50],
    [GONE, "Gone Ads", 30.5],
    [LOOSE, "Loose Ads", 12.3],
    [TIED_LISTED, "Tied Listed Ads", 4],
    [TE, TE_NAME, 2.09],
  ] as const)
    await adDay(a, name, kd(1), spend);
  // TE's earlier days in the window.
  await adDay(TE, TE_NAME, kd(5), 7.65);

  const fns = {
    read: await fn("read"),
    finish: await fn("finish"),
    inputs: await fn("inputs"),
    status: await fn("status"),
  };
  // t and u read the table, so they refuse until q has made it.
  await refuses(migration(T), /Apply 20261023q_churned_ad_accounts\.sql first/);
  await refuses(migration(U), /Apply 20261023q_churned_ad_accounts\.sql first/);
  // The run first: the status and the board read the newest run's accounts.
  const note = (await runNote()).note;
  before = {
    fns,
    board: await board(CEO),
    inputs: await svc("cockpit_meta_ad_days_inputs", { accounts: ACCOUNTS }),
    status: await svc("cockpit_meta_ad_days_status"),
    note,
  };
  await apply(Q);
  await apply(Q);
  // The list's second row (invented) shows a live tie winning over the list.
  await q(
    `INSERT INTO public.cockpit_churned_ad_accounts(account_id,client_name,evidence,added_by) VALUES
     ($1,'Gone Client, listed by mistake','A test row: the cancelled client still carries this account.','tests'),
     ($2,'Live Client, listed by mistake','A test row: an Active client carries this account.','tests')`,
    [GONE, TIED_LISTED],
  );
  await apply(T);
  await apply(T);
  await apply(U);
  await apply(U);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the table (20261023q)", () => {
  test("row security on, no policy; only the service role reads it and nobody but the owner writes it", async () => {
    const [t] = await q<{ rls: boolean; acl: string; policies: number }>(
      `SELECT c.relrowsecurity rls, c.relacl::text acl,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) policies
       FROM pg_class c WHERE c.oid = 'public.cockpit_churned_ad_accounts'::regclass`,
    );
    expect(t.rls).toBe(true);
    expect(t.policies).toBe(0);
    expect(t.acl).toBe("{postgres=arwdDxtm/postgres,service_role=r/postgres}");
    for (const role of ["anon", "authenticated", "service_role"])
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const [x] = await q<{ ok: boolean }>(
          "SELECT has_table_privilege($1, 'public.cockpit_churned_ad_accounts', $2) ok",
          [role, priv],
        );
        expect([role, priv, x.ok]).toEqual([role, priv, false]);
      }
    for (const role of ["anon", "authenticated"]) {
      const [x] = await q<{ ok: boolean }>(
        "SELECT has_table_privilege($1, 'public.cockpit_churned_ad_accounts', 'SELECT') ok",
        [role],
      );
      expect([role, x.ok]).toEqual([role, false]);
    }
  });

  test("Triple Edge's row is seeded once, with its evidence, and one audit row with no amount in after", async () => {
    const [te] = await q<Row>(
      "SELECT * FROM public.cockpit_churned_ad_accounts WHERE account_id = $1",
      [TE],
    );
    expect(te).toMatchObject({
      account_id: TE,
      client_name: TE_NAME,
      status: "Churned",
      added_by: "aziz@maharamedia.com, decision 5, 23 Oct 2026",
    });
    expect(te.evidence).toContain('"triple edge is a old churned client"');
    expect(te.evidence).toContain("86ex3n15w");
    const audit = await q<Row>(
      "SELECT * FROM public.cockpit_audit_log WHERE entity_id = 'migration 20261023q'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "clients.churned_account.add",
      entity_type: "cockpit_churned_ad_accounts",
      actor_email: "aziz@maharamedia.com",
      source_system: "migration",
      before: null,
      after: { account_id: TE, client_name: TE_NAME, status: "Churned" },
    });
  });

  test("the checks hold: digits only, the status Churned, evidence required", async () => {
    for (const [sql, why] of [
      [
        "INSERT INTO public.cockpit_churned_ad_accounts(account_id,client_name,evidence,added_by) VALUES('act_123456','X','e','t')",
        /check constraint/,
      ],
      [
        "INSERT INTO public.cockpit_churned_ad_accounts(account_id,client_name,status,evidence,added_by) VALUES('123456','X','Cancelled','e','t')",
        /check constraint/,
      ],
      [
        "INSERT INTO public.cockpit_churned_ad_accounts(account_id,client_name,evidence,added_by) VALUES('123456','X',' ','t')",
        /check constraint/,
      ],
    ] as const) {
      await owner(db);
      await expect(db.query(sql)).rejects.toThrow(why);
    }
  });

  test("a rerun of q changes nothing", async () => {
    const n = (
      await q<{ n: number }>(
        "SELECT count(*)::int n FROM public.cockpit_audit_log WHERE entity_id = 'migration 20261023q'",
      )
    )[0].n;
    await apply(Q);
    expect(
      (
        await q<{ n: number }>(
          "SELECT count(*)::int n FROM public.cockpit_audit_log WHERE entity_id = 'migration 20261023q'",
        )
      )[0].n,
    ).toBe(n);
    expect(
      (
        await q<{ n: number }>(
          "SELECT count(*)::int n FROM public.cockpit_churned_ad_accounts",
        )
      )[0].n,
    ).toBe(3);
  });
});

describe("the files t and u", () => {
  test("are written against the live bodies, which the repository chain reproduces", () => {
    for (const f of Object.keys(SIGS) as Fn[]) {
      expect([f, before.fns[f].md5]).toEqual([f, LIVE[f]]);
      expect([f, before.fns[f].acl]).toEqual([f, ACL[f]]);
      expect(migration(f === "read" ? T : U)).toContain(`'${LIVE[f]}'`);
    }
    for (const file of [Q, T, U])
      expect(migration(file)).not.toContain(String.fromCodePoint(0x2014));
  });

  test("apply twice; keep definer, search path and grants", async () => {
    for (const f of Object.keys(SIGS) as Fn[]) {
      const now = await fn(f);
      expect(now.md5).not.toBe(LIVE[f]);
      expect(migration(f === "read" ? T : U)).toContain(`'${now.md5}'`);
      expect([f, now.acl]).toEqual([f, ACL[f]]);
      expect([f, now.definer]).toEqual([f, true]);
    }
  });

  test("a body changed since refuses and changes nothing", async () => {
    const mine = await fn("status");
    const def = (
      await q<{ d: string }>(
        "SELECT pg_get_functiondef(to_regprocedure($1)) d",
        [SIGS.status],
      )
    )[0].d;
    await q(
      def.replace(
        "'tieSource', v_ties->>'source',",
        "'tieSource', v_ties->>'source', 'changed', true,",
      ),
    );
    const changed = await fn("status");
    expect(changed.md5).not.toBe(mine.md5);
    await refuses(
      migration(U),
      /cockpit_meta_ad_days_status is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect((await fn("status")).md5).toBe(changed.md5);
    await q(def);
    expect((await fn("status")).md5).toBe(mine.md5);
  });
});

describe("the board's Not in these totals (20261023t)", () => {
  test("before: the listed account was not tied to a client", () => {
    expect(offBoardOf(before.board)[TE]).toEqual({
      accountId: TE,
      name: TE_NAME,
      spend: 9.74,
      reason: "not_tied",
    });
  });

  test("after: it reads churned with the list's client name; a live tie wins; the untied one stays", async () => {
    const b = await board(CEO);
    const off = offBoardOf(b);
    expect(off[TE]).toEqual({
      accountId: TE,
      name: TE_NAME,
      spend: 9.74,
      client: TE_NAME,
      reason: "churned",
    });
    // A cancelled client still carries it: cancelled, by that client's name.
    expect(off[GONE]).toEqual({
      accountId: GONE,
      name: "Gone Ads",
      spend: 30.5,
      client: "Gone Client",
      reason: "cancelled",
    });
    expect(off[LOOSE]).toEqual({
      accountId: LOOSE,
      name: "Loose Ads",
      spend: 12.3,
      reason: "not_tied",
    });
    // An Active client carries the other listed account: it stays on the board.
    expect(off[TIED_LISTED]).toBeUndefined();
    expect(off[LIVE_ACCT]).toBeUndefined();
    expect(b.offBoard.spend).toBe(before.board.offBoard.spend);
    expect(b.offBoard.spend).toBe(52.54);
    expect(b.clients).toEqual(before.board.clients);
    const strip = (x: Row) => ({
      ...x,
      offBoard: null,
      generatedAt: null,
      notLinked: null,
    });
    expect(strip(b)).toEqual(strip(before.board));
  });

  test("limited seats still get nothing", async () => {
    const b = await board(LIMITED);
    expect(b.offBoard).toBeNull();
    expect(JSON.stringify(b)).not.toContain(TE_NAME);
  });
});

describe("the Meta ad-days notes (20261023u)", () => {
  test("before: the run note and the status called it not linked", () => {
    expect(before.note).toContain(
      `Not linked to a client: Loose Ads (${LOOSE}, USD 12.3), ${TE_NAME} (${TE}, USD 2.09).`,
    );
    expect(before.note).toContain(
      `Spent for a cancelled or stopped client: Gone Ads (${GONE}, Gone Client is Cancelled, USD 30.5).`,
    );
    expect(before.inputs.notLinked.map((a: Row) => a.accountId)).toEqual([
      LOOSE,
      TE,
    ]);
  });

  test("the run note names it as a churned client's, never as not linked", async () => {
    const { note, begun } = await runNote();
    expect(begun.state).toBe("ok");
    expect(note).toContain(
      `Spent for a cancelled, stopped or churned client: Gone Ads (${GONE}, Gone Client is Cancelled, USD 30.5), ${TE_NAME} (${TE}, ${TE_NAME} is Churned, USD 2.09).`,
    );
    expect(note).toContain(
      `Not linked to a client: Loose Ads (${LOOSE}, USD 12.3).`,
    );
    expect(note).not.toContain("cancelled or stopped client:");
    // The live tie wins: the Active client's listed account is named nowhere.
    expect(note).not.toContain(TIED_LISTED);
  });

  test("inputs leave it out of notLinked; nothing else moves", async () => {
    const i = await svc("cockpit_meta_ad_days_inputs", { accounts: ACCOUNTS });
    expect(i.notLinked).toEqual([
      { accountId: LOOSE, name: "Loose Ads", currency: "USD", spend: 12.3 },
    ]);
    expect({ ...i, notLinked: null }).toEqual({
      ...before.inputs,
      notLinked: null,
    });
  });

  test("status names it Churned, out of notLinked and in cancelledDelivering; a live tie wins", async () => {
    const s = await svc("cockpit_meta_ad_days_status");
    const te = (s.accounts as Row[]).find(a => a.accountId === TE);
    expect(te).toMatchObject({
      linked: false,
      clientName: TE_NAME,
      clientStatus: "Churned",
      spend2d: 2.09,
    });
    const tied = (s.accounts as Row[]).find(a => a.accountId === TIED_LISTED);
    expect(tied).toMatchObject({
      linked: true,
      clientName: "Live Client",
      clientStatus: "Active",
    });
    expect(s.notLinked.map((a: Row) => a.accountId)).toEqual([LOOSE]);
    expect(before.status.notLinked.map((a: Row) => a.accountId)).toEqual([
      LOOSE,
      TE,
    ]);
    expect(s.cancelledDelivering).toEqual([
      {
        accountId: GONE,
        name: "Gone Ads",
        clientName: "Gone Client",
        clientStatus: "Cancelled",
        currency: "USD",
        spend2d: 30.5,
      },
      {
        accountId: TE,
        name: TE_NAME,
        clientName: TE_NAME,
        clientStatus: "Churned",
        currency: "USD",
        spend2d: 2.09,
      },
    ]);
    expect(s.billingStopped).toEqual(before.status.billingStopped);
    // Every other account reads as before.
    // (statusAt is the newest run's time: a later run moves it.)
    const others = (x: Row) =>
      (x.accounts as Row[])
        .filter(a => a.accountId !== TE)
        .map(a => ({ ...a, statusAt: null }));
    expect(others(s)).toEqual(others(before.status));
  });

  test("the board's Not linked line goes with it", async () => {
    const b = await board(CEO);
    expect((b.notLinked as Row[]).map(a => a.accountId)).toEqual([LOOSE]);
    expect((before.board.notLinked as Row[]).map(a => a.accountId)).toEqual([
      LOOSE,
      TE,
    ]);
  });
});
