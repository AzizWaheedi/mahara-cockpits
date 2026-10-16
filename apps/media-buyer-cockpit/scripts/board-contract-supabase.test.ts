/**
 * The Client Performance screen against the database's real reads: the
 * board migration (20261016133300_board_api.sql) runs on PGlite over the
 * facts and Meta migrations and the dialer's real views (taken from the
 * board facts test, as the board API test takes them), with three invented
 * clients written straight into the facts and the Meta store. Then:
 *   - the screen's own parser (src/lib/boardClient.ts) reads both reads;
 *   - the harness and screen-test fixture (src/dev/boardFixture.ts) carries
 *     the same keys as the real reads at every level, and the same official
 *     targets, so the screen tests cannot drift from the database;
 *   - the grid, rendered from the real read, shows no 0 where the database
 *     says NULL ("n/a", "Not filled in", "Client calls" instead).
 * Every client, person, ad and number here is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const { parseBoard, parseClientPage, kuwaitToday, shiftDay } = await import(
  "../src/lib/boardClient"
);
const { COLUMNS } = await import("../src/lib/boardColumns");
const { BoardGrid } = await import("../src/pages/performance/BoardGrid");
const { boardFixture, clientFixture } = await import("../src/dev/boardFixture");

const VIEWER = "00000000-0000-4000-8000-0000000000e1";
const CEO = "00000000-0000-4000-8000-0000000000e2";
const A = "locContractA0001";
const B = "locContractB0002";
const C = "locContractC0003";
const ACCT = "3333333333";
const AGENT = "agent.contract@maharamedia.com";

const today = kuwaitToday();
const kd = (n: number) => shiftDay(today, -n);
const kt = (n: number, hhmm: string) =>
  new Date(`${kd(n)}T${hhmm}:00+03:00`).toISOString();
const FROM = kd(9);
const TO = today;

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

let db: PGlite;
async function q(text: string, params: unknown[] = []) {
  return (await db.query(text, params)).rows as Record<string, any>[];
}
async function as<T = any>(
  who: string,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return ((await db.query<{ r: T }>(text, params)).rows[0] as { r: T }).r;
  } finally {
    await owner(db);
  }
}

let read: any;
let page: any;
let pageC: any;

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  const seat = migration("20261007d_cockpit_team_rpc_restore.sql").match(
    /create or replace function public\.cockpit_has_active_seat\(\)[\s\S]*?\$\$;/,
  );
  if (!allowed || !seat) throw new Error("The seat gates moved");
  await db.exec(allowed[0]);
  await db.exec(seat[0]);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.cockpit_has_active_seat(), public.cockpit_client_allowed(text) TO authenticated, service_role;`);
  await db.exec(DIALER);
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, VIEWER, "viewer@tests.invalid", ["creative"]);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await owner(db);
  await db.exec(`
    INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,meta_ad_account,country,service_mode,tiktok_ad_account) VALUES
     ('${A}','Contract A','Active','CU_CA',NULL,'KW','DFY',NULL),
     ('${B}','Contract B','Active','CU_CB',NULL,'KW','DWY',NULL),
     ('${C}','Contract C','Launching',NULL,NULL,'KW','DFY',NULL);
    INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id,hidden_from_dashboard) VALUES ('Contract A ads','act_${ACCT}','${A}',false);
    INSERT INTO public.cockpit_people(name,email,role,active,schedule) VALUES ('Agent Contract','${AGENT}','Call centre agent',true,NULL);
    INSERT INTO mahara_console.metadata VALUES
     ('production','access:agent:${AGENT}','{"email":"${AGENT}","active":true,"locationIds":["${A}"]}'),
     ('production','identity:account:${AGENT}','{"email":"${AGENT}","role":"agent","enabled":true}');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES ('${A}','calMainContract','Main Appointment Calendar');
  `);
  await db.exec(migration("20261013180000_cockpit_client_calls.sql"));
  await db.exec(
    migration("20261015200000_cockpit_client_calls_whatsapp_chats.sql"),
  );
  await db.exec(migration("20261013180200_cockpit_client_callers.sql"));
  await db.exec(migration("20261016111157_board_facts.sql"));
  await db.exec(migration("20261016121700_meta_ad_days.sql"));
  // The 16 October corrections, in production's order.
  await db.exec(migration("20261016210000_board_facts_checked.sql"));
  await db.exec(migration("20261016210100_meta_ad_days_checked.sql"));

  // The client spine and ten days of facts, written by hand.
  await q(
    `INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids,tiktok) VALUES
     ($1,'CU_CA','Contract A','Active','DFY',ARRAY[$4],false),
     ($2,'CU_CB','Contract B','Active','DWY','{}',false),
     ($3,NULL,'Contract C','Launching','DFY','{}',false)`,
    [A, B, C, ACCT],
  );
  const ok = JSON.stringify({
    leads: { ok: true, state: "ok" },
    appointments: { ok: true, state: "ok" },
    sheet: { ok: true, state: "ok" },
  });
  for (let i = 0; i <= 9; i++) {
    const day = kd(i);
    // A: every column known; one meeting a day due, most marked.
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,crm_ad_leads,confirmed_bookings,provisional_bookings,meetings_due,
         shows,no_shows,no_outcome,quotations,quotation_answers,closes,closes_with_value,revenue_usd,lead_quality_sum,lead_quality_count,
         dials,leads_called,sources)
       VALUES($1,$2,4,3,1,0,1,$3,$4,$5,$6,NULL,$7,$7,$8,$9,$10,12,4,$11::jsonb)`,
      [
        A,
        day,
        i < 6 ? 1 : 0,
        i >= 6 && i < 8 ? 1 : 0,
        i >= 8 ? 1 : 0,
        i < 3 ? 1 : 0,
        i < 2 ? 1 : 0,
        i === 0 ? 12000 : i === 1 ? 8000 : 0,
        i < 3 ? 6 : 0,
        i < 3 ? 1 : 0,
        ok,
      ],
    );
    // B (Done With You): no sheet outcomes, no dials.
    await q(
      `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,crm_ad_leads,confirmed_bookings,provisional_bookings,meetings_due,
         shows,no_shows,no_outcome,quotations,quotation_answers,closes,closes_with_value,revenue_usd,lead_quality_sum,lead_quality_count,
         dials,leads_called,sources)
       VALUES($1,$2,2,2,1,0,1,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$3::jsonb)`,
      [B, day, ok],
    );
  }
  // C: only its leads are known so far.
  await q(
    `INSERT INTO public.cockpit_client_days(location_id,day,crm_leads,crm_ad_leads,confirmed_bookings,meetings_due,no_outcome,sources)
     VALUES($1,$2,3,3,0,0,0,'{}'::jsonb)`,
    [C, kd(1)],
  );
  // A's won, pending and lost deals, and its Instagram or Messenger chats.
  await q(
    `UPDATE public.cockpit_client_days SET crm_dm_contacts = CASE WHEN day = $2::date THEN 1 ELSE 0 END,
       closes_pending = CASE WHEN day = $3::date THEN 1 ELSE 0 END, closes_lost = CASE WHEN day = $4::date THEN 1 ELSE 0 END
     WHERE location_id = $1`,
    [A, kd(1), kd(2), kd(3)],
  );
  await q(
    `INSERT INTO public.cockpit_client_now(location_id,untouched_leads,oldest_untouched_at,touched_share_30d,callable_30d,touched_30d,
       first_call_median_work_seconds_30d,note,verified_called_30d,outcome_only_30d)
     VALUES($1,2,now() - interval '3 hours',0.95,40,38,900,NULL,35,3)`,
    [A],
  );
  await q(
    `INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note) VALUES('board-facts',now(),now(),true,NULL)
     ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true`,
  );
  // A's ads: a video lead ad, an image lead ad and a chat ad, on a Kuwait account.
  for (let i = 1; i <= 9; i++) {
    for (const ad of [
      { id: "77001", name: "Video", set: "76001", leads: 2, video: true },
      { id: "77002", name: "Image", set: "76001", leads: 0, video: false },
      { id: "77003", name: "Chat", set: "76002", leads: null, video: false },
    ])
      await q(
        `INSERT INTO public.cockpit_meta_ad_days(account_id,account_name,account_timezone,account_currency,day,campaign_id,campaign_name,objective,
           adset_id,adset_name,ad_id,ad_name,spend,spend_usd,usd_rate,impressions,reach,frequency,link_clicks,leads,lead_actions,
           video_plays,video_3s,video_p25,video_p50,video_p75,video_p100,thruplays,destination_type,fetched_at)
         VALUES($1,'Contract ads','Asia/Kuwait','USD',$2,'75001','Contract leads','OUTCOME_LEADS',$3,'Set',$4,$5,20,20,1,2000,1500,1.3,25,$6,$7,
           $8,$9,$10,$11,$12,$13,$14,'ON_AD',now())`,
        [
          ACCT,
          kd(i),
          ad.set,
          ad.id,
          ad.name,
          ad.leads,
          ad.leads ?? 1,
          ad.video ? 1200 : null,
          ad.video ? 500 : null,
          ad.video ? 600 : null,
          ad.video ? 300 : null,
          ad.video ? 150 : null,
          ad.video ? 60 : null,
          ad.video ? 160 : null,
        ],
      );
  }
  // One of A's meetings, due two days ago, with no outcome yet.
  await q(
    `INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_name,contact_phone,deleted)
     VALUES('cContract1',$1,$2,'Meta','77001','75001','Mariam Test','+96550000999',false)`,
    [A, kt(4, "10:00")],
  );
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,ghl_source,ad_id,contact_name)
     VALUES('apContract1','cContract1',$1,'calMainContract',$2,$3,'confirmed','booking_widget','77001','Mariam Test')`,
    [A, kt(3, "11:00"), kt(2, "12:00")],
  );

  await db.exec(migration("20261016133300_board_api.sql"));
  await db.exec(migration("20261016220000_board_read_checked.sql"));
  await db.exec(migration("20261016220100_board_read_notes.sql"));
  read = await as(
    VIEWER,
    "SELECT public.cockpit_board_read($1::date,$2::date) AS r",
    [FROM, TO],
  );
  page = await as(
    VIEWER,
    "SELECT public.cockpit_board_client($1,$2::date,$3::date) AS r",
    [A, FROM, TO],
  );
  pageC = await as(
    VIEWER,
    "SELECT public.cockpit_board_client($1,$2::date,$3::date) AS r",
    [C, FROM, TO],
  );
}, 240_000);

afterAll(async () => {
  await db?.close();
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
});

const keys = (o: Record<string, unknown> | null | undefined) =>
  Object.keys(o ?? {}).sort();
/** The keys a cell may carry, over every cell given. */
const cellKeys = (cells: Record<string, any>[]) =>
  [...new Set(cells.flatMap(c => Object.keys(c)))].sort();

describe("the screen reads what the database returns", () => {
  test("both reads parse with the screen's own parser", () => {
    const board = parseBoard(read);
    expect(board.clients.map(c => c.clientName)).toEqual([
      "Contract A",
      "Contract B",
      "Contract C",
    ]);
    expect(board.canEditTargets).toBe(false);
    const p = parseClientPage(page);
    expect(p.campaigns.length).toBe(1);
    expect(p.noOutcomeAppointments.map(a => a.firstName)).toEqual(["Mariam"]);
    expect(parseClientPage(pageC).campaigns).toEqual([]);
  });

  test("the fixture has the real read's keys at every level", () => {
    const fx = boardFixture(FROM, TO, today);
    expect(keys(fx)).toEqual(keys(read));
    expect(keys(fx.freshness)).toEqual(keys(read.freshness));
    expect(keys(fx.adWindow)).toEqual(keys(read.adWindow));
    const realRow = read.clients[0];
    const fxRow = fx.clients[0];
    expect(keys(fxRow)).toEqual(keys(realRow));
    expect(keys(fxRow.values)).toEqual(keys(realRow.values));
    for (const t of Object.keys(read.targets))
      expect([t, keys(fx.targets[t])]).toEqual([t, keys(read.targets[t])]);
    // Every column the screen draws is a key the read sends.
    for (const c of COLUMNS)
      if (!c.special)
        expect([
          c.key,
          c.key in realRow.values || c.key === "noOutcome",
        ]).toEqual([c.key, true]);
    expect("retention50" in realRow.values).toBe(true);
  });

  test("the fixture's official targets are the database's (and so kpi.ts's)", () => {
    const fx = boardFixture(FROM, TO, today);
    for (const [metric, t] of Object.entries<any>(read.targets)) {
      expect([metric, fx.targets[metric].official]).toEqual([
        metric,
        t.official,
      ]);
      expect([
        metric,
        fx.targets[metric].direction,
        fx.targets[metric].minSample ?? null,
      ]).toEqual([metric, t.direction, t.minSample ?? null]);
    }
  });

  test("the client page's fixture has the real page's keys, down to an ad and an appointment", () => {
    const fxPage = clientFixture("locFixHarbor01", FROM, TO, today) as any;
    expect(keys(fxPage)).toEqual(keys(page));
    const camp = page.campaigns[0];
    const fxCamp = fxPage.campaigns[0];
    expect(keys(fxCamp)).toEqual(keys(camp));
    expect(keys(fxCamp.adsets[0])).toEqual(keys(camp.adsets[0]));
    expect(keys(fxCamp.adsets[0].ads[0])).toEqual(keys(camp.adsets[0].ads[0]));
    expect(keys(fxCamp.metrics)).toEqual(keys(camp.metrics));
    expect(keys(fxPage.noOutcomeAppointments[0])).toEqual(
      keys(page.noOutcomeAppointments[0]),
    );
    expect(keys(fxPage.noOutcomeCheck)).toEqual(keys(page.noOutcomeCheck));
    expect(keys(fxPage.noAd)).toEqual(keys(page.noAd));
    // The cell keys the screen reads appear in the fixture's cells too.
    const realCells = cellKeys(Object.values(read.clients[0].values));
    const fxCells = cellKeys(
      Object.values(boardFixture(FROM, TO, today).clients[0].values),
    );
    for (const k of realCells)
      expect([k, fxCells.includes(k)]).toEqual([k, true]);
  });

  test("the grid drawn from the real read shows no 0 where the database says NULL", () => {
    const board = parseBoard(read);
    const html = renderToStaticMarkup(
      createElement(BoardGrid, {
        rows: board.clients,
        columns: COLUMNS,
        targets: board.targets,
        sort: { key: "client", dir: "asc" },
        onSort: () => {},
        onOpen: () => {},
        selected: null,
        meeting: false,
      }),
    );
    const cellText = (loc: string, col: string) => {
      const row =
        html.split(`data-location="${loc}"`)[1]?.split("</tr>")[0] ?? "";
      const td = row.split(`data-col="${col}"`)[1]?.split("</td>")[0] ?? "";
      return td
        .replace(/^[^>]*>/, "")
        .replace(/<[^>]+>/g, "")
        .trim();
    };
    let checked = 0;
    for (const row of read.clients) {
      for (const c of COLUMNS) {
        if (c.special) continue;
        const cell =
          c.key === "noOutcome" ? { v: row.noOutcome } : row.values[c.key];
        if (cell && (cell.v !== null || typeof cell.atLeast === "number"))
          continue;
        expect([
          row.clientName,
          c.key,
          cellText(row.locationId, c.key),
        ]).toEqual([
          row.clientName,
          c.key,
          expect.stringMatching(
            /^(n\/a|Not filled in|Not a video|Client calls|Too few)$/,
          ),
        ]);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(cellText(B, "dials")).toBe("Client calls");
    expect(cellText(B, "closes")).toBe("Not filled in");
    expect(cellText(C, "spend")).toBe("n/a");
    expect(cellText(A, "hookRate")).toMatch(/^\d/);
    expect(cellText(A, "caller")).toBe("Agent Contract");
    expect(cellText(C, "caller")).toBe("No caller assigned");
    // A's one meeting with no outcome is on the row and on its page.
    expect(cellText(A, "noOutcome")).toBe(String(read.clients[0].noOutcome));
  });
});
