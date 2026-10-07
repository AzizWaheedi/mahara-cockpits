import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// The creative director's morning checks (20261008a): the browser reads them
// through cockpit_get_daily_checks and ticks them through
// cockpit_set_creative_check, never the table itself.
const CEO = "00000000-0000-4000-8000-000000000001";
const CREATIVE = "00000000-0000-4000-8000-000000000002";
const BUYER = "00000000-0000-4000-8000-000000000003";
const UNCONFIRMED = "00000000-0000-4000-8000-000000000004";

async function fixture() {
  const db = await cockpitTestDb();
  try {
    const core = migration("20260919_cockpit_core.sql");
    await db.exec(core.match(/create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i)![0]);
    await db.exec(migration("20260923e_cockpit_daily_checks.sql"));
    await db.exec(migration("20260923f_cockpit_daily_check_shadow.sql").match(
      /ALTER TABLE public\.cockpit_daily_checks[\s\S]*?;/)![0]);
    await db.exec(migration("20260923l_cockpit_daily_checks_direct.sql"));
    await db.exec(migration("20261008a_cockpit_creative_check.sql"));
    await member(db, CEO, "aziz@maharamedia.com", []);
    await member(db, CREATIVE, "creative@tests.invalid", ["creative"]);
    await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
    await member(db, UNCONFIRMED, "unconfirmed@tests.invalid", ["creative"], true, false);
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function kuwaitDay(db: PGlite, back = 0): Promise<string> {
  await owner(db);
  const r = await db.query<{ d: string }>(
    "SELECT (((now() AT TIME ZONE 'Asia/Kuwait')::date) - $1::int)::text AS d", [back]);
  return r.rows[0]!.d;
}

type Tick = { id: number; done: boolean; done_at: string | null };
async function tick(db: PGlite, who: string | null, day: string, key: string, done: boolean): Promise<Tick> {
  await actor(db, who);
  const r = await db.query<Tick>("SELECT * FROM cockpit_set_creative_check($1::date,$2,$3)", [day, key, done]);
  return r.rows[0]!;
}

test("a creative director ticks and unticks a check, and every change is audited", async () => {
  const db = await fixture();
  try {
    const day = await kuwaitDay(db);
    const first = await tick(db, CREATIVE, day, "whatsapp_sprint", true);
    expect(first.done).toBe(true);
    expect(first.done_at).not.toBeNull();

    await owner(db);
    const row = (await db.query<Record<string, unknown>>(
      "SELECT role, owner_app, label, changed_by, source_system, source_id FROM cockpit_daily_checks")).rows;
    expect(row).toEqual([{
      role: "creative", owner_app: "creative-director", label: "WhatsApp sprint",
      changed_by: "creative@tests.invalid", source_system: "supabase",
      source_id: `creative:${day}:whatsapp_sprint`,
    }]);

    // Ticked again: still done, and keeps the time it was first ticked.
    const again = await tick(db, CREATIVE, day, "whatsapp_sprint", true);
    expect(again.id).toBe(first.id);
    expect(String(again.done_at)).toBe(String(first.done_at));

    const off = await tick(db, CREATIVE, day, "whatsapp_sprint", false);
    expect(off.done).toBe(false);
    expect(off.done_at).toBeNull();

    await actor(db, CREATIVE);
    const read = (await db.query<{ check_key: string; done: boolean }>(
      "SELECT check_key, done FROM cockpit_get_daily_checks('creative',$1::date)", [day])).rows;
    expect(read).toEqual([{ check_key: "whatsapp_sprint", done: false }]);

    await owner(db);
    const audit = (await db.query<{ action: string; actor_email: string; source_app: string }>(
      "SELECT action, actor_email, source_app FROM cockpit_audit_log WHERE entity_type='cockpit_daily_checks' ORDER BY created_at, action DESC")).rows;
    expect(audit.map(a => a.action)).toEqual(["INSERT", "UPDATE", "UPDATE"]);
    expect(audit.every(a => a.actor_email === "creative@tests.invalid" && a.source_app === "creative-director")).toBe(true);
  } finally { await db.close(); }
});

test("the CEO may tick; a buyer, an unconfirmed seat and a signed-out visitor may not", async () => {
  const db = await fixture();
  try {
    const day = await kuwaitDay(db);
    expect((await tick(db, CEO, day, "scripts", true)).done).toBe(true);
    for (const who of [BUYER, UNCONFIRMED]) {
      await actor(db, who);
      await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'scripts',false)", [day]))
        .rejects.toThrow(/Checklist access denied/);
    }
    await actor(db, null);
    await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'scripts',false)", [day]))
      .rejects.toThrow(/permission denied/);
    await owner(db);
    const left = (await db.query<{ done: boolean; changed_by: string }>(
      "SELECT done, changed_by FROM cockpit_daily_checks")).rows;
    expect(left).toEqual([{ done: true, changed_by: "aziz@maharamedia.com" }]);
  } finally { await db.close(); }
});

test("only the eight known checks, for today or a page left open since yesterday", async () => {
  const db = await fixture();
  try {
    const today = await kuwaitDay(db);
    const yesterday = await kuwaitDay(db, 1);
    const older = await kuwaitDay(db, 2);
    await actor(db, CREATIVE);
    await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'made_up',true)", [today]))
      .rejects.toThrow(/Unknown creative check/);
    await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'scripts',true)", [older]))
      .rejects.toThrow(/Only today's checklist can change/);
    expect((await tick(db, CREATIVE, yesterday, "scripts", true)).done).toBe(true);
  } finally { await db.close(); }
});

test("the browser still has no direct access to the table", async () => {
  const db = await fixture();
  try {
    const day = await kuwaitDay(db);
    await actor(db, CREATIVE);
    await expect(db.query("SELECT * FROM cockpit_daily_checks")).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "INSERT INTO cockpit_daily_checks(role,owner_app,day,check_key,label,done,source_deployment,source_id,source_snapshot_ts,source_row,changed_by) VALUES('creative','creative-director',$1::date,'scripts','x',true,'x','x','x','{}','x')",
      [day])).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
});
