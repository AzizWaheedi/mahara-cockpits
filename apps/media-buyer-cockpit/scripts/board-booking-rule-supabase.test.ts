/**
 * The board's booking rule of 2026-10-21 (migrations 20261021l_board_booking_rule.sql
 * and 20261021m_board_tree_booking_rule.sql) on an isolated PostgreSQL.
 *
 * It stands on the board's chain exactly as board-api-supabase.test.ts builds it
 * (the dialer's real views from the board facts test's DIALER block, the facts,
 * the Meta store, the board's reads and 20261021a), adds the dialer's inventory
 * of GoHighLevel (mahara_reporting.inventory, as live), then applies the two
 * files twice each. Two invented clients carry one case per booking day, so a
 * day's confirmed bookings say which case counted:
 *   Client H: SAFAD's lone reschedule, a booking the call centre moved, a
 *     reschedule of a cancelled booking, a call back, and bookings GoHighLevel
 *     no longer holds with no mark, a portal no-show and a CRM "showed".
 *   Client K: a booking dropped from GoHighLevel two days after its meeting,
 *     one the inventory never saw, one the sync still sees, one gone before
 *     its meeting, and a moved booking whose new booking was cancelled.
 * Every person, client, booking and id is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

const RULE = "20261021l_board_booking_rule.sql";
const TREE = "20261021m_board_tree_booking_rule.sql";
/** md5 of each file's own body: its guard accepts it, so the file applies twice. */
const RULE_MINE = "9508bf3922c875a27c6052951cb11749";
const TREE_MINE = "0c3652110bc32d89d7884fa14ce0a505";
/** The live bodies on 21 and 22 Oct (20261016210000 and 20261021a): the bodies the files were written against. */
const RULE_LIVE = "3e656689aa3c4c091da04c4ff7cc625e";
const TREE_LIVE = "1e16699defa53bde039deb1e68caf637";

/** The board's chain, as board-api-supabase.test.ts loads it. */
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

const BUYER = "00000000-0000-4000-8000-0000000000b9";
const LOC_H = "locBoardRuleH0000001";
const LOC_K = "locBoardRuleK0000002";
const CAL_H = "calMainRuleH";
const CAL_K = "calMainRuleK";
const AGENT = "agent9@maharamedia.com";

/** Kuwait calendar days: kd(n) is n days before today; kt(n, "HH:MM") a Kuwait wall time on it. */
const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
const kt = (n: number, hhmm: string) =>
  new Date(`${kd(n)}T${hhmm}:00+03:00`).toISOString();
const FROM = kd(9);

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
/** The dialer's inventory of GoHighLevel, with the live columns and key. */
const INVENTORY = `CREATE TABLE mahara_reporting.inventory(namespace text, source text, kind text, external_id text,
  last_seen timestamptz, checked_at timestamptz, present boolean, PRIMARY KEY(namespace, source, kind, external_id));`;
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

const REFRESH = "public.cockpit_board_facts_refresh(date,date)";
const TREE_SIG =
  "public.cockpit_board_tree(text,text[],date,date,jsonb,jsonb,jsonb)";
const GONE_SIG = "public.cockpit_board_gone_booking_ids(text[])";
const REPLACED_SIG = "public.cockpit_board_replaced_booking_ids(text[],text[])";

let db: PGlite;
type Row = Record<string, any>;

async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(text, params)).rows;
}
async function refresh(): Promise<Row> {
  return (
    await q<{ r: Row }>(
      "SELECT public.cockpit_board_facts_refresh($1::date,$2::date) AS r",
      [FROM, today],
    )
  )[0].r;
}
async function dayRow(loc: string, day: string): Promise<Row> {
  return (
    await q(
      "SELECT * FROM public.cockpit_client_days WHERE location_id=$1 AND day=$2",
      [loc, day],
    )
  )[0];
}
/** Confirmed bookings by booking day, kd(9) to kd(1). */
async function booked(loc: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (let n = 9; n >= 1; n--)
    out[`kd${n}`] = (await dayRow(loc, kd(n)))?.confirmed_bookings ?? null;
  return out;
}
async function appointmentsNote(loc: string): Promise<string> {
  const sources = (await dayRow(loc, kd(1))).sources as Record<string, Row>;
  return String(sources.appointments.note ?? "");
}
/** The bookings each ad carries in the client page's campaign tree (no ad account linked, so every ad is "not in the store"). */
async function treeBookings(loc: string): Promise<Record<string, number>> {
  const r = (
    await q<{ r: Row }>(
      `SELECT public.cockpit_board_tree($1, '{}'::text[], $2::date, $3::date, '{}'::jsonb, '[]'::jsonb, '{"state":"none"}'::jsonb) AS r`,
      [loc, FROM, today],
    )
  )[0].r;
  return Object.fromEntries(
    (r.notInStore as Row[]).map(x => [x.adId, Number(x.confirmedBookings)]),
  );
}
async function md5(sig: string): Promise<string> {
  return (
    await q<{ m: string }>(
      "SELECT md5(prosrc) m FROM pg_proc WHERE oid = $1::regprocedure",
      [sig],
    )
  )[0].m;
}
/** A migration that refuses leaves its transaction aborted: roll it back, as a failed apply does. */
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}

async function appt(id: string, loc: string, extra: Row) {
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,ad_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      extra.contact,
      loc,
      loc === LOC_H ? CAL_H : CAL_K,
      extra.booked,
      extra.start,
      extra.status ?? "confirmed",
      loc === LOC_H ? "AD_H" : "AD_K",
    ],
  );
}
/** GoHighLevel no longer holds it: the inventory last saw it at `lastSeen`; the sync last wrote it at `synced`. */
async function gone(loc: string, id: string, lastSeen: string, synced: string) {
  await q(
    "UPDATE public.appointments SET updated_at=$2 WHERE ghl_appointment_id=$1",
    [id, synced],
  );
  await q(
    "INSERT INTO mahara_reporting.inventory VALUES('production','ghl','appointment',$1,$2,now(),false)",
    [`${loc}:${id}`, lastSeen],
  );
}
async function held(loc: string, id: string) {
  await q(
    "INSERT INTO mahara_reporting.inventory VALUES('production','ghl','appointment',$1,now(),now(),true)",
    [`${loc}:${id}`],
  );
}
async function attempt(id: string, loc: string, contact: string, data: Row) {
  const at = Date.parse(kt(1, "09:00"));
  await q(
    "INSERT INTO mahara_console.attempts VALUES('production',$1,$2,$3,'closed',$4::jsonb,$5)",
    [
      id,
      `${loc}:${contact}`,
      AGENT,
      JSON.stringify({
        locationId: loc,
        contactId: contact,
        mode: "outcome",
        dispositionSavedAt: at,
        ...data,
      }),
      at,
    ],
  );
}

let before: {
  h: Record<string, unknown>;
  k: Record<string, unknown>;
  treeH: Record<string, number>;
  treeK: Record<string, number>;
  refreshMd5: string;
  treeMd5: string;
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
  // The live appointments table also carries the ad and the contact's name.
  await db.exec(`ALTER TABLE public.appointments ADD COLUMN ad_id text, ADD COLUMN adset_id text, ADD COLUMN campaign_id text,
    ADD COLUMN contact_name text;`);
  await member(db, BUYER, "buyer9@tests.invalid", ["media_buyer"]);
  await owner(db);
  await db.exec(`
    INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,country,service_mode) VALUES
     ('${LOC_H}','Client H','Active','CU_H9','KW','DFY'), ('${LOC_K}','Client K','Active','CU_K9','KW','DFY');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
     ('${LOC_H}','${CAL_H}','Main Appointment Calendar'), ('${LOC_K}','${CAL_K}','Main Appointment Calendar');
    INSERT INTO public.lead_sync_state VALUES ('${LOC_H}',now(),'success',NULL), ('${LOC_K}',now(),'success',NULL);
    INSERT INTO public.appointment_sync_state VALUES ('${LOC_H}',now(),'success'), ('${LOC_K}',now(),'success');
    INSERT INTO mahara_reporting.sync_jobs VALUES
     ('production','jH9','ghl','${LOC_H}','appointments_recent',now(),NULL),
     ('production','jK9','ghl','${LOC_K}','appointments_recent',now(),NULL);
  `);

  // Client H, one case per booking day.
  // kd9, SAFAD's shape: the call centre moved a booking GoHighLevel and the sync never held; the new one is the lead's only booking.
  await appt("H_a", LOC_H, {
    contact: "HA",
    booked: kt(9, "10:00"),
    start: kt(-3, "10:00"),
  });
  await held(LOC_H, "H_a");
  await attempt("HRA", LOC_H, "HA", {
    disposition: { outcome: "RESCHEDULE", note: "Moved" },
    appointmentId: "H_a",
    originalAppointmentId: "H_never_held",
    bookingVerification: { id: "H_a" },
  });
  // kd8 and kd7: the call centre moved H_b0 to H_b1; GoHighLevel deleted H_b0. H_b0 counts on its own day.
  await appt("H_b0", LOC_H, {
    contact: "HB",
    booked: kt(8, "10:00"),
    start: kt(-4, "10:00"),
  });
  await appt("H_b1", LOC_H, {
    contact: "HB",
    booked: kt(7, "10:00"),
    start: kt(-5, "10:00"),
  });
  await gone(LOC_H, "H_b0", kt(7, "10:05"), kt(7, "09:20"));
  await attempt("HRB", LOC_H, "HB", {
    disposition: { outcome: "RESCHEDULE", note: "Moved" },
    appointmentId: "H_b1",
    originalAppointmentId: "H_b0",
    bookingVerification: { id: "H_b1" },
  });
  // kd6 and kd5: the first booking was cancelled, so the reschedule is the lead's booking.
  await appt("H_c0", LOC_H, {
    contact: "HC",
    booked: kt(6, "10:00"),
    start: kt(-6, "10:00"),
    status: "cancelled",
  });
  await appt("H_c1", LOC_H, {
    contact: "HC",
    booked: kt(5, "10:00"),
    start: kt(-7, "10:00"),
  });
  await attempt("HRC", LOC_H, "HC", {
    disposition: { outcome: "RESCHEDULE", note: "Moved" },
    appointmentId: "H_c1",
    originalAppointmentId: "H_c0",
    bookingVerification: { id: "H_c1" },
  });
  // kd4: a call back booked on the main calendar.
  await appt("H_d", LOC_H, {
    contact: "HD",
    booked: kt(4, "10:00"),
    start: kt(-8, "10:00"),
  });
  await attempt("HCD", LOC_H, "HD", {
    disposition: { outcome: "CALLBACK", note: "Later" },
    bookingVerification: { id: "H_d" },
  });
  // kd3: gone before its meeting, no mark anywhere.
  await appt("H_e", LOC_H, {
    contact: "HE",
    booked: kt(3, "10:00"),
    start: kt(2, "12:00"),
  });
  await gone(LOC_H, "H_e", kt(3, "10:30"), kt(3, "10:20"));
  // kd2: gone, but the CRM says it showed: the meeting proves the booking.
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,booked_at,start_at,status,ad_id)
     VALUES('H_g',$1,$2,$3,$4,$5,'showed','AD_H')`,
    ["HG", LOC_H, CAL_H, kt(2, "09:00"), kt(1, "15:00")],
  );
  await gone(LOC_H, "H_g", kt(1, "15:30"), kt(1, "15:20"));
  // kd1: gone after a no-show the portal records.
  await appt("H_f", LOC_H, {
    contact: "HF",
    booked: kt(1, "09:00"),
    start: kt(1, "12:00"),
  });
  await gone(LOC_H, "H_f", kt(1, "12:30"), kt(1, "12:20"));
  await q(
    "INSERT INTO portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,source) VALUES($1,'H_f',1,'no_show','portal')",
    [LOC_H],
  );

  // Client K.
  // kd8: dropped from GoHighLevel two days after its meeting: a client tidying up, so it counts.
  await appt("K_h", LOC_K, {
    contact: "KH",
    booked: kt(8, "10:00"),
    start: kt(7, "10:00"),
  });
  await gone(LOC_K, "K_h", kt(5, "10:00"), kt(5, "09:50"));
  // kd6: the inventory never saw it.
  await appt("K_i", LOC_K, {
    contact: "KI",
    booked: kt(6, "10:00"),
    start: kt(-2, "10:00"),
  });
  // kd5 and kd3: the call centre moved K_o to K_n, then the lead cancelled K_n. K_o is gone, so neither counts.
  await appt("K_o", LOC_K, {
    contact: "KO",
    booked: kt(5, "10:00"),
    start: kt(-6, "10:00"),
  });
  await appt("K_n", LOC_K, {
    contact: "KO",
    booked: kt(3, "12:00"),
    start: kt(-9, "10:00"),
    status: "cancelled",
  });
  await gone(LOC_K, "K_o", kt(3, "12:05"), kt(3, "12:00"));
  await attempt("KRO", LOC_K, "KO", {
    disposition: { outcome: "RESCHEDULE", note: "Moved" },
    appointmentId: "K_n",
    originalAppointmentId: "K_o",
    bookingVerification: { id: "K_n" },
  });
  // kd4: the inventory lost it, but the sync has written it since: the two sources disagree, so it counts.
  await appt("K_j", LOC_K, {
    contact: "KJ",
    booked: kt(4, "10:00"),
    start: kt(3, "10:00"),
  });
  await gone(LOC_K, "K_j", kt(4, "11:00"), kt(2, "10:00"));
  // kd2: gone before its meeting.
  await appt("K_k", LOC_K, {
    contact: "KK",
    booked: kt(2, "10:00"),
    start: kt(-3, "10:00"),
  });
  await gone(LOC_K, "K_k", kt(2, "12:00"), kt(2, "11:00"));

  await db.exec(EXCLUDED_ADS);
  await db.exec(TEAM_ONLY);
  for (const f of CHAIN_FIRST) await db.exec(migration(f));
  for (const f of CHAIN_BOARD) await db.exec(migration(f));

  // Before the two files: the board as live on 21 Oct.
  await owner(db);
  expect((await refresh()).ok).toBe(true);
  before = {
    h: await booked(LOC_H),
    k: await booked(LOC_K),
    treeH: (await treeBookings(LOC_H)) as Record<string, number>,
    treeK: (await treeBookings(LOC_K)) as Record<string, number>,
    refreshMd5: await md5(REFRESH),
    treeMd5: await md5(TREE_SIG),
  };

  // Twice each: the files are safe to apply again.
  await db.exec(migration(RULE));
  await db.exec(migration(RULE));
  await db.exec(migration(TREE));
  await db.exec(migration(TREE));
  expect((await refresh()).ok).toBe(true);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the booking rule (R4, decision D0b)", () => {
  test("before: the literal rule dropped SAFAD's lone reschedule and a reschedule of a cancelled booking, and counted gone bookings", () => {
    expect(before.h).toEqual({
      kd9: 0,
      kd8: 1,
      kd7: 0,
      kd6: 0,
      kd5: 0,
      kd4: 0,
      kd3: 1,
      kd2: 1,
      kd1: 1,
    });
    expect(before.k).toEqual({
      kd9: 0,
      kd8: 1,
      kd7: 0,
      kd6: 1,
      kd5: 1,
      kd4: 1,
      kd3: 0,
      kd2: 1,
      kd1: 0,
    });
  });

  test("after: a reschedule counts unless the booking it moved still counts; a call back never does", async () => {
    expect(await booked(LOC_H)).toEqual({
      kd9: 1, // SAFAD's shape: the first booking was never held
      kd8: 1, // moved by the call centre, so gone by design: counts on its own day
      kd7: 0, // the new booking while the first counts
      kd6: 0, // cancelled
      kd5: 1, // the reschedule of the cancelled booking
      kd4: 0, // a call back
      kd3: 0, // gone before its meeting, no mark
      kd2: 1, // gone, but the CRM says it showed
      kd1: 0, // gone after a no-show
    });
    const note = await appointmentsNote(LOC_H);
    expect(note).toContain(
      "2 bookings GoHighLevel stopped holding no later than a day after their meeting, not marked as showed, are left out of confirmed bookings.",
    );
    expect(note).toContain(
      "2 bookings the call centre made as a call back, or moved from a booking that still counts, are left out of confirmed bookings.",
    );
    expect(note).not.toContain("Could not check");
  });

  test("a booking is gone only when GoHighLevel dropped it no later than a day after its meeting and the sync agrees", async () => {
    expect(await booked(LOC_K)).toEqual({
      kd9: 0,
      kd8: 1, // dropped two days after its meeting: a real booking
      kd7: 0,
      kd6: 1, // no inventory row
      kd5: 0, // moved by the call centre to a booking the lead cancelled: gone
      kd4: 1, // the sync wrote it after the inventory lost it
      kd3: 0, // the cancelled new booking
      kd2: 0, // gone before its meeting
      kd1: 0,
    });
    const ids = (
      await q<{ id: string }>(
        "SELECT id FROM public.cockpit_board_gone_booking_ids($1) ORDER BY id",
        [[LOC_H, LOC_K]],
      )
    ).map(r => r.id);
    expect(ids).toEqual(["H_e", "H_f", "K_k", "K_o"]);
    expect(await appointmentsNote(LOC_K)).toContain(
      "2 bookings GoHighLevel stopped holding no later than a day after their meeting, not marked as showed, are left out of confirmed bookings.",
    );
  });

  test("meetings due, shows and no-shows are as before: a gone booking with no mark is still a meeting with no outcome", async () => {
    const d2 = await dayRow(LOC_H, kd(2));
    expect([d2.meetings_due, d2.no_outcome]).toEqual([1, 1]);
    const d1 = await dayRow(LOC_H, kd(1));
    expect([d1.meetings_due, d1.shows, d1.no_shows]).toEqual([2, 1, 1]);
    const k7 = await dayRow(LOC_K, kd(7));
    expect([k7.meetings_due, k7.no_outcome]).toEqual([1, 1]);
  });

  test("the campaign tree carries the same bookings as the client row", async () => {
    // Before: every main or online booking with an ad id, the call back, the moved and the gone ones included.
    expect(before.treeH).toEqual({ AD_H: 8 });
    expect(before.treeK).toEqual({ AD_K: 5 });
    const h = await booked(LOC_H);
    const k = await booked(LOC_K);
    const sum = (x: Record<string, unknown>) =>
      Object.values(x).reduce<number>((s, v) => s + Number(v ?? 0), 0);
    expect(await treeBookings(LOC_H)).toEqual({ AD_H: sum(h) });
    expect(await treeBookings(LOC_K)).toEqual({ AD_K: sum(k) });
    expect(sum(h)).toBe(4);
    expect(sum(k)).toBe(3);
  });
});

describe("a read that fails never stops the bookings", () => {
  test("the inventory cannot be read: the bookings count as before, the source says so, and the tree still answers", async () => {
    await owner(db);
    await db.exec(
      "ALTER TABLE mahara_reporting.inventory RENAME TO inventory_off",
    );
    try {
      const r = await refresh();
      expect(r.ok).toBe(true);
      expect(await booked(LOC_H)).toEqual({
        kd9: 1,
        kd8: 1,
        kd7: 0,
        kd6: 0,
        kd5: 1,
        kd4: 0,
        kd3: 1,
        kd2: 1,
        kd1: 1,
      });
      const d1 = await dayRow(LOC_H, kd(1));
      expect(d1.sources.appointments.state).toBe("ok");
      expect(await appointmentsNote(LOC_H)).toContain(
        "Could not check which bookings GoHighLevel no longer holds, so they count as before:",
      );
      expect(await treeBookings(LOC_H)).toEqual({ AD_H: 6 });
    } finally {
      await owner(db);
      await db.exec(
        "ALTER TABLE mahara_reporting.inventory_off RENAME TO inventory",
      );
    }
    expect((await refresh()).ok).toBe(true);
    expect((await booked(LOC_H)).kd3).toBe(0);
    expect(await treeBookings(LOC_H)).toEqual({ AD_H: 4 });
  }, 120_000);

  test("the portal cannot be read: its figures fail as before, and confirmed bookings still land", async () => {
    await owner(db);
    await db.exec(
      "ALTER TABLE portal_data.appointment_outcomes RENAME TO appointment_outcomes_off",
    );
    try {
      const r = await refresh();
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r.failures)).toContain("outcomes");
      expect(JSON.stringify(r.failures)).not.toContain('"appointments"');
      // The gone check needs the portal's "showed": without it, gone bookings count as before.
      expect(await booked(LOC_H)).toEqual({
        kd9: 1,
        kd8: 1,
        kd7: 0,
        kd6: 0,
        kd5: 1,
        kd4: 0,
        kd3: 1,
        kd2: 1,
        kd1: 1,
      });
      expect(await appointmentsNote(LOC_H)).toContain(
        "Could not check which bookings GoHighLevel no longer holds, so they count as before:",
      );
    } finally {
      await owner(db);
      await db.exec(
        "ALTER TABLE portal_data.appointment_outcomes_off RENAME TO appointment_outcomes",
      );
    }
    expect((await refresh()).ok).toBe(true);
    expect((await booked(LOC_H)).kd1).toBe(0);
  }, 120_000);

  test("the rule cannot be worked out: the rule before 21 Oct stands and the source says so; the tree drops only gone bookings", async () => {
    await owner(db);
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_board_replaced_booking_ids(p_locations text[], p_gone text[])
      RETURNS TABLE(id text) LANGUAGE plpgsql STABLE SET search_path = '' AS $$
      BEGIN RAISE EXCEPTION 'the rule is broken for this test'; END $$;`);
    try {
      expect((await refresh()).ok).toBe(true);
      // Every RESCHEDULE and CALLBACK booking left out, as before 21 Oct; gone bookings still out.
      expect(await booked(LOC_H)).toEqual({
        kd9: 0,
        kd8: 1,
        kd7: 0,
        kd6: 0,
        kd5: 0,
        kd4: 0,
        kd3: 0,
        kd2: 1,
        kd1: 0,
      });
      const note = await appointmentsNote(LOC_H);
      expect(note).toContain(
        "Could not check whether each booking the call centre moved still has its first booking counted, so every booking it moved or booked as a call back is left out, as before 21 Oct: the rule is broken for this test",
      );
      expect(note).toContain(
        "4 bookings the call centre made as a call back or moved are left out of confirmed bookings.",
      );
      expect(await treeBookings(LOC_H)).toEqual({ AD_H: 6 });
    } finally {
      await db.exec(migration(RULE));
    }
    expect((await refresh()).ok).toBe(true);
    expect((await booked(LOC_H)).kd9).toBe(1);
  }, 120_000);
});

describe("the files", () => {
  test("each was written against the live body and names its own, so it applies twice", async () => {
    expect(before.refreshMd5).toBe(RULE_LIVE);
    expect(before.treeMd5).toBe(TREE_LIVE);
    expect(await md5(REFRESH)).toBe(RULE_MINE);
    expect(await md5(TREE_SIG)).toBe(TREE_MINE);
    for (const [file, live, mine] of [
      [RULE, RULE_LIVE, RULE_MINE],
      [TREE, TREE_LIVE, TREE_MINE],
    ]) {
      expect(migration(file)).toContain(`'${live}', '${mine}'`);
    }
  });

  test("each refuses a body it was not written against, and changes nothing", async () => {
    for (const [file, sig, mine, foreign] of [
      [
        RULE,
        REFRESH,
        RULE_MINE,
        `CREATE OR REPLACE FUNCTION public.cockpit_board_facts_refresh(p_from date, p_to date) RETURNS jsonb
          LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$;`,
      ],
      [
        TREE,
        TREE_SIG,
        TREE_MINE,
        `CREATE OR REPLACE FUNCTION public.cockpit_board_tree(p_location text, p_accounts text[], p_from date, p_to date,
          p_targets jsonb, p_marks jsonb, p_cover jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
          SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$;`,
      ],
    ]) {
      const saved = (
        await q<{ d: string }>(
          "SELECT pg_get_functiondef($1::regprocedure) d",
          [sig],
        )
      )[0].d;
      await owner(db);
      await db.exec(foreign);
      await refuses(
        migration(file),
        /is not the definition this file was written against/,
      );
      expect(await md5(sig)).not.toBe(mine);
      await db.exec(saved);
      expect(await md5(sig)).toBe(mine);
    }
  }, 60_000);

  test("no browser role and not the service key may run the rule's functions, the refresh or the tree", async () => {
    for (const sig of [GONE_SIG, REPLACED_SIG, REFRESH, TREE_SIG]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [x] = await q<{ ok: boolean }>(
          "SELECT has_function_privilege($1, $2, 'EXECUTE') ok",
          [role, sig],
        );
        expect({ sig, role, ok: x.ok }).toEqual({ sig, role, ok: false });
      }
      const [p] = await q<{ open: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure AND a.grantee = 0) open",
        [sig],
      );
      expect({ sig, open: p.open }).toEqual({ sig, open: false });
    }
    // The tree reads the rule through its owner; the client page reads the tree through cockpit_board_client.
    const [{ definer }] = await q<{ definer: boolean }>(
      "SELECT prosecdef definer FROM pg_proc WHERE oid = $1::regprocedure",
      [TREE_SIG],
    );
    expect(definer).toBe(true);
  });
});
