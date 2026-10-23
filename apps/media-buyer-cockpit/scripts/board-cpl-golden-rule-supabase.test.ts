/**
 * The golden rule on the Client Performance board (migration
 * 20261022y_board_cpl_golden_rule.sql, cost per booking build 2, contract 2.6, audit
 * R5) on an isolated PostgreSQL.
 *
 * It stands on the board's chain exactly as board-booking-rule-supabase.test.ts builds
 * it (the dialer's real views from the board facts test's DIALER block, the facts, the
 * Meta store, the board's reads and 20261021a), checks that the board's rows are the
 * live body the file was written against, reads the board, applies the file twice and
 * reads it again. The clients' days and ad-days are written by hand, one case each,
 * over the same seven days:
 *   Client A: Atlantis's shape. Cost per lead $35 (off), cost per booking $43.75
 *     (good), ROAS off: the cost per lead becomes a watch line with the note, and the
 *     first step off is ROAS.
 *   Client B: the same numbers, done with you: unchanged.
 *   Client C: no booking on $175 (a floor, "at least"): unchanged.
 *   Client D: cost per booking $70 (watch): unchanged.
 *   Client E: cost per lead $19.44 (already a watch line): unchanged, no note.
 *   Client G: its own lines ($50 a booking, $12.50 a lead): the note says them.
 * Then done with you (20261023r, the CEO's decisions of 23 Oct 2026, 2), on the booking
 * rule and the tree's (20261021l, 20261021m) and the number meanings (20261021e) it is
 * written against: Client B keeps its cost per lead's own status (the golden rule still
 * never applies to it), and its cost per booking and booking rate read done with you.
 * Every client, ad and number is invented.
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

const FILE = "20261022y_board_cpl_golden_rule.sql";
const SIG = "public.cockpit_board_rows(date,date,text,jsonb)";
/** The live body on 22 Oct (20261021a): the body the file was written against. */
const LIVE = "a57b69e6ce597aa531d445ace118f008";
const NOTE =
  "Cost per booking is within the $60 gate, so a cost per lead over $15 is a watch line, not off (the golden rule).";

/** The board's chain, as board-booking-rule-supabase.test.ts loads it. */
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

/** Kuwait calendar days: kd(n) is n days before today. */
const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
const FROM = kd(7);
const TO = kd(1);

/** The dialer's views and tables, exactly as the board facts test builds them. */
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
/** The compromise list's table, as 20261010a makes it. */
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
/** cockpit_is_team_only and its grants, as 20261017b makes them. */
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
async function md5(): Promise<string | null> {
  return (
    await q<{ m: string | null }>(
      "SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m",
      [SIG],
    )
  )[0].m;
}
async function acl(): Promise<string> {
  return (
    await q<{ a: string }>(
      "SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  )[0].a;
}
async function apply() {
  await owner(db);
  await db.exec(migration(FILE));
}
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
/** The board's rows as the owner reads them, by client. */
async function rows(): Promise<Record<string, Row>> {
  const r = (
    await q<{ r: Row[] }>(
      "SELECT public.cockpit_board_rows($1::date,$2::date,NULL,public.cockpit_meta_ad_days_status()) r",
      [FROM, TO],
    )
  )[0].r;
  return Object.fromEntries(r.map(x => [x.clientName, x]));
}
/** The board as the CEO reads it. */
async function board(): Promise<Record<string, Row>> {
  await actor(db, CEO);
  try {
    const r = (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_board_read($1::date,$2::date) r",
        [FROM, TO],
      )
    ).rows[0].r;
    return Object.fromEntries((r.clients as Row[]).map(x => [x.clientName, x]));
  } finally {
    await owner(db);
  }
}
/** The first step off, else to watch, in the board's funnel order (boardColumns.ts FUNNEL_ORDER). */
function firstBreak(row: Row): string {
  const steps = [
    "cpl",
    "leadToBooking",
    "costPerBooking",
    "showRate",
    "quotationRate",
    "closeRate",
    "roas",
  ].filter(k => row.serviceMode !== "DWY" || k !== "costPerBooking");
  for (const kind of ["off", "watch"]) {
    const hit = steps.find(k => row.values[k]?.status === kind);
    if (hit) return `${kind} at ${hit}`;
  }
  return "none";
}

let n = 0;
/**
 * One client over the seven days: a lead campaign spending `spend` a day on its own
 * account, `leads` form leads in all, `booked` confirmed bookings in all, closes known
 * and none (so ROAS is 0, off).
 */
async function client(
  name: string,
  mode: "DFY" | "DWY",
  r: { spend: number; leads: number; booked: number },
) {
  n += 1;
  const loc = `locGolden${n}`;
  const account = String(1_100_000_000 + n);
  await q(
    "INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$2,$3,'Active',$4,$5)",
    [loc, `cu${n}`, name, mode, [account]],
  );
  for (let d = 7; d >= 1; d--) {
    const i = 7 - d;
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,confirmed_bookings,closes,closes_with_value,revenue_usd)
       VALUES($1,$2,$3,0,0,0)`,
      [loc, kd(d), i < r.booked ? 1 : 0],
    );
    await q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,account_timezone,day,campaign_id,campaign_name,objective,
         ad_id,spend,spend_usd,usd_rate,impressions,link_clicks,leads,lead_actions,destination_type,fetched_at)
       VALUES($1,'USD','Asia/Kuwait',$2,$3,'Leads','OUTCOME_LEADS',$4,$5,$5,1,1000,10,$6,$6,'ON_AD',now())`,
      [
        account,
        kd(d),
        String(5_100_000_000 + n),
        String(5_200_000_000 + n),
        r.spend,
        i < r.leads ? 1 : 0,
      ],
    );
  }
  return `cu${n}`;
}

let before: {
  rows: Record<string, Row>;
  board: Record<string, Row>;
  acl: string;
  md5: string | null;
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
  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of CHAIN_FIRST) await db.exec(migration(f));
  for (const f of CHAIN_BOARD) await db.exec(migration(f));

  // $25 a day for seven days = $175.
  await client("Client A", "DFY", { spend: 25, leads: 5, booked: 4 }); // CPL $35, CPB $43.75
  await client("Client B", "DWY", { spend: 25, leads: 5, booked: 4 });
  await client("Client C", "DFY", { spend: 25, leads: 5, booked: 0 }); // no booking on $175
  await client("Client D", "DFY", { spend: 10, leads: 2, booked: 1 }); // CPL $35, CPB $70
  await client("Client E", "DFY", { spend: 25, leads: 7, booked: 4 }); // CPL $25 is off; see below
  const g = await client("Client G", "DFY", { spend: 25, leads: 5, booked: 4 });
  // Client E: nine leads, $19.44 a lead (a watch line already).
  await q(
    "UPDATE public.cockpit_meta_ad_days SET leads = 2, lead_actions = 2 WHERE campaign_id = $1 AND day IN ($2, $3)",
    ["5100000005", kd(7), kd(6)],
  );
  // Client G's own lines: $50 a booking, $12.50 a lead.
  await q(
    `INSERT INTO public.cockpit_board_targets(scope_key,metric,good,watch,direction,updated_by) VALUES
     ($1,'cost_per_booking',50,70,'lower','ceo'), ($1,'cpl',12.5,20,'lower','ceo')`,
    [`client:${g}`],
  );

  before = {
    rows: await rows(),
    board: await board(),
    acl: await acl(),
    md5: await md5(),
  };
  await apply();
  await apply();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("is written against the live body, which the repository chain reproduces", () => {
    expect(before.md5).toBe(LIVE);
    expect(migration(FILE)).toContain(`'${LIVE}'`);
    expect(migration(FILE)).not.toContain(String.fromCodePoint(0x2014));
  });

  test("applies twice; keeps owner, definer, search path and grants (the owner's alone)", async () => {
    const mine = await md5();
    expect(mine).not.toBe(LIVE);
    expect(migration(FILE)).toContain(`'${mine}'`);
    expect(await acl()).toBe(before.acl);
    const [f] = await q<{ definer: boolean; cfg: string; owner: string }>(
      "SELECT prosecdef definer, proconfig::text cfg, pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    expect(f.definer).toBe(true);
    expect(f.cfg).toContain("search_path");
    expect(before.acl).not.toContain("authenticated=X");
    expect(before.acl).not.toContain("anon=X");
  });

  test("a body changed since refuses and changes nothing", async () => {
    const def = (
      await q<{ d: string }>(
        "SELECT pg_get_functiondef(to_regprocedure($1)) d",
        [SIG],
      )
    )[0].d;
    const mine = await md5();
    await q(
      def.replace(
        "v_calls_note constant text := 'The client calls: Done With You.';",
        "v_calls_note constant text := 'Changed since.';",
      ),
    );
    const changed = await md5();
    expect(changed).not.toBe(mine);
    await refuses(
      migration(FILE),
      /cockpit_board_rows is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect(await md5()).toBe(changed);
    await q(def);
    expect(await md5()).toBe(mine);
  });
});

describe("the golden rule", () => {
  test("before: Client A's cost per lead is off beside a good cost per booking, and names the break", () => {
    const a = before.rows["Client A"];
    expect(a.values.cpl).toMatchObject({ v: 35, status: "off" });
    expect(a.values.costPerBooking).toMatchObject({ v: 43.75, status: "good" });
    expect(a.values.roas.status).toBe("off");
    expect(firstBreak(a)).toBe("off at cpl");
  });

  test("after: the cost per lead is a watch line with the note; the first step off is ROAS", async () => {
    const a = (await rows())["Client A"];
    expect(a.values.cpl).toEqual({
      ...before.rows["Client A"].values.cpl,
      status: "watch",
      note: NOTE,
    });
    expect(a.values.costPerBooking).toEqual(
      before.rows["Client A"].values.costPerBooking,
    );
    expect(firstBreak(a)).toBe("off at roas");
  });

  test("nothing else changes: every other cell of every client, and every other row key", async () => {
    const after = await rows();
    expect(Object.keys(after).sort()).toEqual(Object.keys(before.rows).sort());
    for (const [name, row] of Object.entries(after)) {
      const was = before.rows[name];
      const { values, ...rest } = row;
      const { values: wasValues, ...wasRest } = was;
      expect(rest).toEqual(wasRest);
      const changed = Object.keys(values).filter(
        k => JSON.stringify(values[k]) !== JSON.stringify(wasValues[k]),
      );
      expect([name, changed]).toEqual([
        name,
        name === "Client A" || name === "Client G" ? ["cpl"] : [],
      ]);
    }
  });

  test("done with you, a floor, a cost per booking to watch and a cost per lead already watched keep their status", async () => {
    const after = await rows();
    expect(after["Client B"].values.cpl).toMatchObject({
      v: 35,
      status: "off",
    });
    expect(after["Client B"].values.costPerBooking.status).toBe("good");
    expect(after["Client C"].values.cpl).toMatchObject({
      v: 35,
      status: "off",
    });
    expect(after["Client C"].values.costPerBooking).toMatchObject({
      v: null,
      status: "off",
      atLeast: 175,
    });
    expect(after["Client D"].values.cpl).toMatchObject({
      v: 35,
      status: "off",
    });
    expect(after["Client D"].values.costPerBooking).toMatchObject({
      v: 70,
      status: "watch",
    });
    expect(after["Client E"].values.cpl).toMatchObject({
      v: 19.44,
      status: "watch",
    });
    expect(after["Client E"].values.cpl.note ?? "").not.toContain(
      "golden rule",
    );
    expect(after["Client E"].values.costPerBooking.status).toBe("good");
  });

  test("a client with its own lines: the note says them", async () => {
    const gc = (await rows())["Client G"].values;
    expect(gc.costPerBooking).toMatchObject({ v: 43.75, status: "good" });
    expect(gc.cpl.status).toBe("watch");
    expect(gc.cpl.note).toBe(
      "Cost per booking is within the $50 gate, so a cost per lead over $12.50 is a watch line, not off (the golden rule).",
    );
  });

  test("the CEO's board read carries it; nothing else on the read moves", async () => {
    const after = await board();
    expect(after["Client A"].values.cpl.status).toBe("watch");
    expect(after["Client A"].values.cpl.note).toBe(NOTE);
    for (const [name, row] of Object.entries(after)) {
      const was = before.board[name];
      const strip = (r: Row) => ({ ...r, values: { ...r.values, cpl: null } });
      expect(strip(row)).toEqual(strip(was));
    }
  });
});

describe("done with you (20261023r): the golden rule still never applies", () => {
  const BOOKS = {
    v: null,
    status: "not_measured",
    note: "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.",
    clientBooks: true,
  };
  let golden: Record<string, Row>;
  beforeAll(async () => {
    golden = await rows();
    await owner(db);
    // The dialer's inventory of GoHighLevel, as board-booking-rule-supabase.test.ts makes it.
    const text = readFileSync(
      new URL("./board-booking-rule-supabase.test.ts", import.meta.url),
      "utf8",
    );
    const inventory = text.match(/const INVENTORY = `([\s\S]*?)`;\n/);
    if (!inventory || inventory[1].includes("${"))
      throw new Error("The booking rule test's INVENTORY block moved");
    await db.exec(inventory[1]);
    // The lever gate as live: 20261017b's body (20261023r is written against it).
    const lever = migration("20261017b_team_only_seats.sql").match(
      /CREATE OR REPLACE FUNCTION public\.cockpit_board_lever_context\(p_args jsonb\)[\s\S]*?END \$function\$;/,
    );
    if (!lever)
      throw new Error("cockpit_board_lever_context moved in 20261017b");
    await db.exec(lever[0]);
    for (const f of [
      "20261021l_board_booking_rule.sql",
      "20261021m_board_tree_booking_rule.sql",
      "20261021e_number_meanings.sql",
      "20261023r_board_done_with_you.sql",
    ])
      await db.exec(migration(f));
  }, 120_000);

  test("Client B keeps its cost per lead's own status; its cost per booking carries clientBooks", async () => {
    const after = await rows();
    expect(after["Client B"].values.cpl).toEqual(golden["Client B"].values.cpl);
    expect(after["Client B"].values.cpl).toMatchObject({
      v: 35,
      status: "off",
    });
    expect(after["Client B"].values.cpl.note ?? "").not.toContain(
      "golden rule",
    );
    expect(after["Client B"].values.costPerBooking).toEqual(BOOKS);
    expect(after["Client B"].values.leadToBooking).toEqual(BOOKS);
    expect(
      golden["Client B"].values.costPerBooking.clientBooks,
    ).toBeUndefined();
  });

  test("the done-for-you clients keep the golden rule exactly as before", async () => {
    const after = await rows();
    for (const name of [
      "Client A",
      "Client C",
      "Client D",
      "Client E",
      "Client G",
    ])
      expect([name, after[name].values]).toEqual([name, golden[name].values]);
    expect(after["Client A"].values.cpl).toMatchObject({
      status: "watch",
      note: NOTE,
    });
  });
});
