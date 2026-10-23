/**
 * Done with you on the Client Performance board (migration
 * 20261023r_board_done_with_you.sql; the CEO's cost per booking decisions of 23 Oct 2026,
 * 2: "No keep the CPL but ignore CPB"; contract docs/client-performance/
 * CPB-DECISIONS-20261023.md 1.2 and 3.3) on an isolated PostgreSQL.
 *
 * It stands on the board's chain as board-cpl-golden-rule-supabase.test.ts builds it, then
 * the booking rule and the tree's (20261021l, 20261021m, with the dialer's inventory as
 * board-booking-rule-supabase.test.ts makes it), the golden rule (20261022y) and the
 * number meanings (20261021e), so the three bodies the file replaces are the live ones. It
 * reads the board, applies the file twice and reads it again. Clients over the same seven
 * days, $25 a day ($175), seven CRM leads:
 *   DWY none: done with you, 5 form leads, no booking.
 *   DWY three: done with you, 5 form leads, 3 bookings GoHighLevel holds.
 *   DFY three: the same numbers, done for you: unchanged.
 *   DFY golden: done for you, cost per lead $35 (off) and cost per booking $43.75 (good):
 *     the golden rule makes the cost per lead a watch line, before and after.
 *   DWY golden: the same numbers, done with you: its cost per lead keeps "off".
 * A lever filed on a done-with-you client's cost per booking or lead to booking says "done with
 * you" in its ClickUp evidence (cockpit_board_lever_context, the body of 20261017b, which the
 * test puts in place as live), never "not measured".
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

const FILE = "20261023r_board_done_with_you.sql";
const SIGS = {
  rows: "public.cockpit_board_rows(date,date,text,jsonb)",
  tree: "public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb)",
  dict: "public.cockpit_dictionary_definitions()",
  lever: "public.cockpit_board_lever_context(jsonb)",
} as const;
type Fn = keyof typeof SIGS;
/** The live bodies on 23 Oct (20261022y, 20261021m, 20261021e): the bodies the file was written against. */
const LIVE: Record<Fn, string> = {
  rows: "48b398196dbdd9eb9737239882d73fb5",
  tree: "0c3652110bc32d89d7884fa14ce0a505",
  dict: "307d4a6df3bfbc5e1380ee5abdeeb5e4",
  lever: "d05e1b3839d17715ff6b31643eb4925e",
};
/** The live grants on 23 Oct. */
const ACL: Record<Fn, string> = {
  rows: "{postgres=X/postgres}",
  tree: "{postgres=X/postgres}",
  dict: "{postgres=X/postgres,service_role=X/postgres}",
  lever: "{postgres=X/postgres,authenticated=X/postgres}",
};
const BOOKS = {
  v: null,
  status: "not_measured",
  note: "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.",
  clientBooks: true,
};
const OLD_NOTE = "Done With You: the client calls its own leads.";
const NEW_NOTE =
  "Done With You: the client calls its own leads and books its own meetings.";
const GOLDEN =
  "Cost per booking is within the $60 gate, so a cost per lead over $15 is a watch line, not off (the golden rule).";

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
  // The booking rule and the tree's (21 Oct), the golden rule (22 Oct), the number meanings.
  "20261021l_board_booking_rule.sql",
  "20261021m_board_tree_booking_rule.sql",
  "20261022y_board_cpl_golden_rule.sql",
  "20261021e_number_meanings.sql",
];

const CEO = "00000000-0000-4000-8000-0000000000a9";

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
/** The dialer's inventory of GoHighLevel, as board-booking-rule-supabase.test.ts makes it. */
const INVENTORY = (() => {
  const text = readFileSync(
    new URL("./board-booking-rule-supabase.test.ts", import.meta.url),
    "utf8",
  );
  const hit = text.match(/const INVENTORY = `([\s\S]*?)`;\n/);
  if (!hit || hit[1].includes("${"))
    throw new Error("The booking rule test's INVENTORY block moved");
  return hit[1];
})();
const EXCLUDED_ADS = (() => {
  const hit = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);\nalter table public\.cockpit_excluded_ads enable row level security;\nrevoke all on public\.cockpit_excluded_ads from anon, authenticated;/,
  );
  if (!hit) throw new Error("The compromise list's table moved in 20261010a");
  return hit[0];
})();
/** The live lever gate: 20261017b's body (the chain above holds 20261016133300's). */
const LEVER_LIVE = (() => {
  const hit = migration("20261017b_team_only_seats.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_board_lever_context\(p_args jsonb\)[\s\S]*?END \$function\$;/,
  );
  if (!hit) throw new Error("cockpit_board_lever_context moved in 20261017b");
  return hit[0];
})();
const DONE_WITH_YOU =
  /: done with you \(the client books its own meetings\), so not judged\.$/;
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
async function rows(): Promise<Record<string, Row>> {
  const r = (
    await q<{ r: Row[] }>(
      "SELECT public.cockpit_board_rows($1::date,$2::date,NULL,public.cockpit_meta_ad_days_status()) r",
      [FROM, TO],
    )
  )[0].r;
  return Object.fromEntries(r.map(x => [x.clientName, x]));
}
async function asCeo<T>(sql: string, params: unknown[]): Promise<T> {
  await actor(db, CEO);
  try {
    return (await db.query<{ r: T }>(sql, params)).rows[0].r;
  } finally {
    await owner(db);
  }
}
async function board(): Promise<Record<string, Row>> {
  const r = await asCeo<Row>(
    "SELECT public.cockpit_board_read($1::date,$2::date) r",
    [FROM, TO],
  );
  return Object.fromEntries((r.clients as Row[]).map(x => [x.clientName, x]));
}
async function page(name: string): Promise<Row> {
  return asCeo<Row>(
    "SELECT public.cockpit_board_client($1,$2::date,$3::date) r",
    [locs[name], FROM, TO],
  );
}
/** The lever gate's context for a client and a metric, as the CEO files it. */
async function lever(name: string, metric: string): Promise<Row> {
  return asCeo<Row>("SELECT public.cockpit_board_lever_context($1::jsonb) r", [
    JSON.stringify({
      locationId: locs[name],
      metric,
      lever: "Ask the client for its booking sheet",
      department: "client_success",
      from: FROM,
      to: TO,
    }),
  ]);
}
const LEVERS: [string, string][] = [
  ["DWY three", "cost_per_booking"],
  ["DWY three", "lead_to_booking"],
  ["DWY none", "cost_per_booking"],
  ["DFY three", "cost_per_booking"],
  ["DFY three", "lead_to_booking"],
  ["DWY three", "cpl"],
];
async function levers(): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {};
  for (const [name, metric] of LEVERS)
    out[`${name} ${metric}`] = await lever(name, metric);
  return out;
}
async function costPerBookingDef(): Promise<Row> {
  return (
    await q<Row>(
      "SELECT * FROM public.cockpit_dictionary_definitions() WHERE metric = 'cost_per_booking'",
    )
  )[0];
}
/** Every costPerBooking cell of a client's tree: campaign, ad set and ad. */
function treeCells(p: Row): Row[] {
  return (p.campaigns as Row[]).flatMap(c => [
    c.metrics.costPerBooking,
    ...(c.adsets as Row[]).flatMap(s => [
      s.metrics.costPerBooking,
      ...(s.ads as Row[]).map(a => a.metrics.costPerBooking),
    ]),
  ]);
}
function treeBookings(p: Row): number[] {
  return (p.campaigns as Row[]).flatMap(c => [
    c.metrics.confirmedBookings.v,
    ...(c.adsets as Row[]).flatMap(s => [
      s.metrics.confirmedBookings.v,
      ...(s.ads as Row[]).map(a => a.metrics.confirmedBookings.v),
    ]),
  ]);
}

let n = 0;
const locs: Record<string, string> = {};
async function client(
  name: string,
  mode: "DFY" | "DWY",
  r: { spend: number; leads: number; booked: number },
) {
  n += 1;
  const loc = `locDwy${n}`;
  locs[name] = loc;
  const account = String(1_400_000_000 + n);
  await q(
    "INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$2,$3,'Active',$4,$5)",
    [loc, `cuDwy${n}`, name, mode, [account]],
  );
  for (let d = 7; d >= 1; d--) {
    const i = 7 - d;
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,confirmed_bookings,closes,closes_with_value,revenue_usd)
       VALUES($1,$2,1,$3,0,0,0)`,
      [loc, kd(d), i < r.booked ? 1 : 0],
    );
    await q(
      `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,account_timezone,day,campaign_id,campaign_name,objective,
         adset_id,ad_id,spend,spend_usd,usd_rate,impressions,link_clicks,leads,lead_actions,destination_type,fetched_at)
       VALUES($1,'USD','Asia/Kuwait',$2,$3,'Leads','OUTCOME_LEADS',$4,$5,$6,$6,1,1000,10,$7,$7,'ON_AD',now())`,
      [
        account,
        kd(d),
        String(6_100_000_000 + n),
        String(6_200_000_000 + n),
        String(6_300_000_000 + n),
        r.spend,
        i < r.leads ? 1 : 0,
      ],
    );
  }
}

const NAMES = [
  "DWY none",
  "DWY three",
  "DFY three",
  "DFY golden",
  "DWY golden",
];
let before: {
  rows: Record<string, Row>;
  board: Record<string, Row>;
  pages: Record<string, Row>;
  fns: Record<Fn, { md5: string; acl: string; definer: boolean }>;
  def: Row;
  levers: Record<string, Row>;
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
  await db.exec(INVENTORY);
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of CHAIN_FIRST) await db.exec(migration(f));
  for (const f of CHAIN_BOARD) await db.exec(migration(f));
  // The lever gate as live (20261017b), with the grants the chain gave it.
  await db.exec(LEVER_LIVE);

  await client("DWY none", "DWY", { spend: 25, leads: 5, booked: 0 });
  await client("DWY three", "DWY", { spend: 25, leads: 5, booked: 3 });
  await client("DFY three", "DFY", { spend: 25, leads: 5, booked: 3 });
  await client("DFY golden", "DFY", { spend: 25, leads: 5, booked: 4 });
  await client("DWY golden", "DWY", { spend: 25, leads: 5, booked: 4 });

  const pages: Record<string, Row> = {};
  for (const name of NAMES) pages[name] = await page(name);
  before = {
    rows: await rows(),
    board: await board(),
    pages,
    fns: {
      rows: await fn("rows"),
      tree: await fn("tree"),
      dict: await fn("dict"),
      lever: await fn("lever"),
    },
    def: await costPerBookingDef(),
    levers: await levers(),
  };
  await apply();
  await apply();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("is written against the live bodies, which the repository chain reproduces", () => {
    for (const f of Object.keys(SIGS) as Fn[]) {
      expect([f, before.fns[f].md5]).toEqual([f, LIVE[f]]);
      expect(migration(FILE)).toContain(`'${LIVE[f]}'`);
    }
    expect(migration(FILE)).not.toContain(String.fromCodePoint(0x2014));
  });

  test("applies twice; keeps security and grants as live", async () => {
    for (const f of Object.keys(SIGS) as Fn[]) {
      const now = await fn(f);
      expect(now.md5).not.toBe(LIVE[f]);
      expect(migration(FILE)).toContain(`'${now.md5}'`);
      expect([f, now.acl]).toEqual([f, ACL[f]]);
      expect([f, before.fns[f].acl]).toEqual([f, ACL[f]]);
      expect([f, now.definer]).toEqual([f, f !== "dict"]);
    }
  });

  test("a body changed since refuses and changes nothing, whichever of the four it is", async () => {
    const mine = await fn("tree");
    const def = (
      await q<{ d: string }>(
        "SELECT pg_get_functiondef(to_regprocedure($1)) d",
        [SIGS.tree],
      )
    )[0].d;
    await q(def.replace("'No spend in these days.'", "'Changed since.'"));
    const changed = await fn("tree");
    expect(changed.md5).not.toBe(mine.md5);
    const rowsBefore = await fn("rows");
    await refuses(
      migration(FILE),
      /cockpit_board_tree is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect((await fn("tree")).md5).toBe(changed.md5);
    expect((await fn("rows")).md5).toBe(rowsBefore.md5);
    await q(def);
    expect((await fn("tree")).md5).toBe(mine.md5);
  });
});

describe("a done-with-you client's own figures", () => {
  test("before: judged on bookings like any client", () => {
    const none = before.rows["DWY none"].values;
    expect(none.costPerBooking).toMatchObject({ status: "off", atLeast: 175 });
    expect(none.leadToBooking).toMatchObject({ v: 0, num: 0, den: 7 });
    const three = before.rows["DWY three"].values;
    expect(three.costPerBooking).toMatchObject({ v: 58.33, status: "good" });
    expect(three.leadToBooking).toMatchObject({ v: 42.86 });
    expect(before.rows["DWY none"].notes).toContain(OLD_NOTE);
  });

  test("after: cost per booking and booking rate read done with you, whatever GoHighLevel holds", async () => {
    const after = await rows();
    for (const name of ["DWY none", "DWY three", "DWY golden"]) {
      const v = after[name].values;
      expect([name, v.costPerBooking]).toEqual([name, BOOKS]);
      expect([name, v.leadToBooking]).toEqual([name, BOOKS]);
      expect(after[name].notes).toContain(NEW_NOTE);
      expect(after[name].notes).not.toContain(OLD_NOTE);
    }
  });

  test("its bookings stay on screen as facts, and nothing else moves", async () => {
    const after = await rows();
    expect(after["DWY three"].values.confirmedBookings).toEqual(
      before.rows["DWY three"].values.confirmedBookings,
    );
    expect(after["DWY three"].values.confirmedBookings.v).toBe(3);
    for (const name of NAMES) {
      const { values, notes, ...rest } = after[name];
      const { values: was, notes: wasNotes, ...wasRest } = before.rows[name];
      expect(rest).toEqual(wasRest);
      const changed = Object.keys(values).filter(
        k => JSON.stringify(values[k]) !== JSON.stringify(was[k]),
      );
      const dwy = name.startsWith("DWY");
      expect([name, changed.sort()]).toEqual([
        name,
        dwy ? ["costPerBooking", "leadToBooking"] : [],
      ]);
      expect([name, notes]).toEqual([
        name,
        dwy
          ? wasNotes.map((x: string) => (x === OLD_NOTE ? NEW_NOTE : x))
          : wasNotes,
      ]);
    }
  });

  test("the golden rule is unchanged: a done-with-you cost per lead keeps its own status", async () => {
    const after = await rows();
    expect(before.rows["DFY golden"].values.cpl).toMatchObject({
      v: 35,
      status: "watch",
      note: GOLDEN,
    });
    expect(after["DFY golden"].values.cpl).toEqual(
      before.rows["DFY golden"].values.cpl,
    );
    expect(after["DWY golden"].values.cpl).toMatchObject({
      v: 35,
      status: "off",
    });
    expect(after["DWY golden"].values.cpl).toEqual(
      before.rows["DWY golden"].values.cpl,
    );
  });

  test("the CEO's board read carries the cells; done-for-you rows are unchanged", async () => {
    const after = await board();
    expect(after["DWY three"].values.costPerBooking).toEqual(BOOKS);
    expect(after["DWY three"].values.leadToBooking).toEqual(BOOKS);
    expect(after["DWY three"].serviceMode).toBe("DWY");
    expect(after["DWY three"].clientCalls).toBe(true);
    for (const name of ["DFY three", "DFY golden"])
      expect(after[name]).toEqual(before.board[name]);
  });
});

describe("the client page's tree", () => {
  test("every campaign, ad set and ad of a done-with-you client reads done with you; booking counts stay", async () => {
    for (const name of ["DWY none", "DWY three"]) {
      const p = await page(name);
      const cells = treeCells(p);
      expect(cells.length).toBe(3);
      for (const c of cells) expect([name, c]).toEqual([name, BOOKS]);
      expect(
        treeCells(before.pages[name]).every(c => c.clientBooks === undefined),
      ).toBe(true);
      expect(treeBookings(p)).toEqual(treeBookings(before.pages[name]));
      expect(p.client.values.costPerBooking).toEqual(BOOKS);
      // Every other cell of the tree is as it was.
      const strip = (x: Row) =>
        JSON.parse(JSON.stringify(x.campaigns), (k, v) =>
          k === "costPerBooking" ? null : v,
        );
      expect(strip(p)).toEqual(strip(before.pages[name]));
    }
  });

  test("a done-for-you client's tree is unchanged", async () => {
    for (const name of ["DFY three", "DFY golden"]) {
      const p = await page(name);
      expect(p.campaigns).toEqual(before.pages[name].campaigns);
      expect(p.client).toEqual(before.pages[name].client);
    }
  });
});

describe("a lever's ClickUp evidence (cockpit_board_lever_context)", () => {
  test("before: a done-with-you client's cost per booking was judged like any client's", () => {
    expect(before.levers["DWY three cost_per_booking"].evidence).toMatch(
      /: \$58\.33 against a good line of \$60\.00 \(good\)\.$/,
    );
  });

  test("a done-with-you client's cost per booking and lead to booking read done with you, never not measured", async () => {
    const after = await levers();
    for (const key of [
      "DWY three cost_per_booking",
      "DWY three lead_to_booking",
      "DWY none cost_per_booking",
    ]) {
      const e = after[key].evidence as string;
      expect([key, e]).toEqual([key, expect.stringMatching(DONE_WITH_YOU)]);
      expect(e).not.toContain("not measured");
      // Nothing but the evidence moves.
      expect({ ...after[key], evidence: null }).toEqual({
        ...before.levers[key],
        evidence: null,
      });
    }
    expect(after["DWY three cost_per_booking"].evidence).toMatch(
      /^DWY three Cost per booking, \d{2} [A-Z][a-z]{2} to \d{2} [A-Z][a-z]{2}: done with you/,
    );
  });

  test("a done-for-you client's evidence, and a done-with-you cost per lead, are unchanged", async () => {
    const after = await levers();
    for (const key of [
      "DFY three cost_per_booking",
      "DFY three lead_to_booking",
      "DWY three cpl",
    ])
      expect([key, after[key]]).toEqual([key, before.levers[key]]);
    expect(after["DFY three cost_per_booking"].evidence).toMatch(
      /: \$58\.33 against a good line of \$60\.00 \(good\)\.$/,
    );
  });
});

describe("the number meanings", () => {
  test("cost per booking leaves out a done-with-you client", async () => {
    const def = await costPerBookingDef();
    expect(def.leaves_out).toBe(
      "Provisional bookings (not-confirmed calendar), shown beside it and never counted. Days with no ad numbers. A done-with-you client (it books its own meetings): no cost per booking, and its spend is out of every portfolio cost per booking.",
    );
    expect({ ...def, leaves_out: null }).toEqual({
      ...before.def,
      leaves_out: null,
    });
    const all = await q<Row>(
      "SELECT * FROM public.cockpit_dictionary_definitions()",
    );
    expect(all.length).toBe(9);
  });
});
