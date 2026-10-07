import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// The creative director's morning checks (20261008a, 20261008b): the browser
// reads them through cockpit_get_daily_checks and ticks them through
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
    await db.exec(migration("20261008b_cockpit_creative_check_noop.sql"));
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

type Tick = { id: number; done: boolean; done_at: Date | null };
async function tick(db: PGlite, who: string | null, day: string, key: string, done: boolean): Promise<Tick> {
  await actor(db, who);
  const r = await db.query<Tick>("SELECT * FROM cockpit_set_creative_check($1::date,$2,$3)", [day, key, done]);
  return r.rows[0]!;
}

async function trail(db: PGlite) {
  await owner(db);
  const audit = (await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cockpit_audit_log WHERE entity_type='cockpit_daily_checks'")).rows[0]!.n;
  const revision = (await db.query<{ r: string }>(
    "SELECT coalesce(max(source_revision),0)::text AS r FROM cockpit_daily_checks")).rows[0]!.r;
  return { audit, revision };
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

    // Ticked earlier in the day, ticked again from another tab: nothing is
    // written, and the time it was first ticked stands.
    const earlier = new Date("2026-01-01T06:00:00Z");
    await db.query("UPDATE cockpit_daily_checks SET done_at=$1", [earlier.toISOString()]);
    const before = await trail(db);
    const again = await tick(db, CREATIVE, day, "whatsapp_sprint", true);
    expect(again.id).toBe(first.id);
    expect(again.done).toBe(true);
    expect(again.done_at?.getTime()).toBe(earlier.getTime());
    expect(await trail(db)).toEqual(before);

    const off = await tick(db, CREATIVE, day, "whatsapp_sprint", false);
    expect(off.done).toBe(false);
    expect(off.done_at).toBeNull();
    const after = await trail(db);
    expect(after.audit).toBe(before.audit + 1);
    expect(Number(after.revision)).toBe(Number(before.revision) + 1);

    // Unticked twice: still a no-op.
    await tick(db, CREATIVE, day, "whatsapp_sprint", false);
    expect(await trail(db)).toEqual(after);

    await actor(db, CREATIVE);
    const read = (await db.query<{ check_key: string; done: boolean }>(
      "SELECT check_key, done FROM cockpit_get_daily_checks('creative',$1::date)", [day])).rows;
    expect(read).toEqual([{ check_key: "whatsapp_sprint", done: false }]);

    await owner(db);
    const audit = (await db.query<{ action: string; actor_email: string; source_app: string }>(
      "SELECT action, actor_email, source_app FROM cockpit_audit_log WHERE entity_type='cockpit_daily_checks'")).rows;
    expect(audit.filter(a => a.action === "INSERT")).toHaveLength(1);
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

test("only the eight known checks, for today or a clock running a little behind", async () => {
  const db = await fixture();
  try {
    const today = await kuwaitDay(db);
    const yesterday = await kuwaitDay(db, 1);
    const older = await kuwaitDay(db, 2);
    const tomorrow = await kuwaitDay(db, -1);
    await actor(db, CREATIVE);
    await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'made_up',true)", [today]))
      .rejects.toThrow(/Unknown creative check/);
    for (const day of [older, tomorrow]) {
      await expect(db.query("SELECT * FROM cockpit_set_creative_check($1::date,'scripts',true)", [day]))
        .rejects.toThrow(/Only today's checklist can change/);
    }
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

// Today shows and ticks DEFAULT_CREATIVE_CHECKS; the older CHECKLIST in
// creativeSourceModels.ts has a ninth item that is never ticked.
test("the server's eight checks match the list Today shows", () => {
  type Check = { key: string; label: string; detail: string; phase: string };
  const sql = migration("20261008b_cockpit_creative_check_noop.sql");
  const server: Check[] = [...sql.matchAll(
    /\('([a-z_]+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'([a-z]+)',\s*\d+\)/g)]
    .map(m => ({ key: m[1]!, label: m[2]!.replace(/''/g, "'"), detail: m[3]!.replace(/''/g, "'"), phase: m[4]! }));
  expect(server).toHaveLength(8);
  const source = (path: string, list: string): Check[] => {
    const file = readFileSync(new URL(`../../creative-director-cockpit/src/lib/${path}`, import.meta.url), "utf8");
    const block = file.slice(file.indexOf(list), file.indexOf("];", file.indexOf(list)));
    return [...block.matchAll(/key: "([a-z_]+)",\s*label:\s*"([^"]*)",\s*detail:\s*"([^"]*)",\s*phase: "([a-z]+)"/g)]
      .map(m => ({ key: m[1]!, label: m[2]!, detail: m[3]!, phase: m[4]! }));
  };
  expect(source("useCreativeSnapshot.ts", "DEFAULT_CREATIVE_CHECKS")).toEqual(server);
});
