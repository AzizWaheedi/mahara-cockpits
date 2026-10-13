// Hubstaff watch (docs/hours-watch/SPEC.md): supabase/migrations/20261013d_cockpit_hours_watch.sql
// against PGlite. Made-up people, ids and figures only; no provider is called.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import { ADMIN, actor, call, CEO, hoursTestDb, MEMBER, owner, service } from "./lib/hoursTestDb";

let db: PGlite;
const ids: Record<string, number> = {};
// Wednesday 14 October 2026, 11:00 in Kuwait.
const NOW = "2026-10-14T08:00:00Z";
const DAY = "2026-10-14";

const TABLES = ["cockpit_hours_watch_runs", "cockpit_hours_watch_status", "cockpit_hours_watch_slots", "cockpit_hours_watch_shots",
  "cockpit_hours_watch_incidents", "cockpit_hours_watch_keys"];
const CEO_RPCS = ["cockpit_ceo_hours_watch_board()", "cockpit_ceo_hours_watch_set('{\"on\":false}'::jsonb)",
  "cockpit_ceo_hours_watch_review('{\"incidentId\":1}'::jsonb)"];
const SERVICE_RPCS = ["cockpit_hours_watch_inputs(now())", "cockpit_hours_watch_key_get('google_ai')", "cockpit_hours_watch_prune()",
  ...["lease_claim", "apply", "slack_claim", "slack_result", "finish", "key_put", "key_mark"].map(n => `cockpit_hours_watch_${n}('{}'::jsonb)`)];
const INTERNAL = ["cockpit_hours_watch_defaults()", "cockpit_hours_watch_settings()", "cockpit_hours_watch_setting_problem(text,jsonb)",
  "cockpit_hours_watch_default_schedule()", "cockpit_hours_watch_window(bigint,date)", "cockpit_hours_watch_today(bigint,timestamptz)",
  "cockpit_hours_watch_roster(timestamptz)", "cockpit_hours_watch_leave(bigint,date,text,timestamptz,timestamptz)",
  "cockpit_hours_watch_cron_on()", "cockpit_hours_watch_kick()",
  "cockpit_hours_watch_incident_json(cockpit_hours_watch_incidents)"];

type Person = { personId: number; name: string; role: string; hubstaffUserId: string | null; accountStatus: string; timezone: string;
  day: string; shift: { start: string; end: string } | null; offReason: string | null; screenshotsOn: boolean | null;
  leave: { start: string; end: string }[] };
type Inputs = { settings: Record<string, unknown>; now: string; people: Person[]; open: Record<string, unknown>[];
  knownShots: { shotId: number; verdict: string; attempts: number }[]; rules: { breakMinutes: number; breakWhenLongerThanHours: number };
  lastOkRunAt: string | null; lastPruneOn: string | null; replies: Record<string, any>[] };

const week = (opts: { tz?: string; off?: string[]; start?: string; end?: string; exceptions?: unknown[] } = {}) => ({
  timezone: opts.tz ?? "Asia/Kuwait",
  exceptions: opts.exceptions ?? [],
  week: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(k =>
    [k, { on: !(opts.off ?? ["fri"]).includes(k), start: opts.start ?? "10:00", end: opts.end ?? "18:00" }])),
});

async function person(name: string, role: string, extra: { schedule?: unknown; endedOn?: string; pausedOn?: string; engagement?: string } = {}) {
  await owner(db);
  const r = await db.query<{ id: number }>(
    "insert into cockpit_people(name,role,engagement,started_on,ended_on,paused_on,schedule,added_by) values($1,$2,$3,'2026-01-01',$4,$5,$6,'tests') returning id",
    [name, role, extra.engagement ?? "staff", extra.endedOn ?? null, extra.pausedOn ?? null, extra.schedule ? JSON.stringify(extra.schedule) : null]);
  ids[name] = Number(r.rows[0].id);
  return ids[name];
}
async function link(personId: number, provider: "hubstaff" | "timetastic", externalId: string, status = "active") {
  await owner(db);
  await db.query("insert into cockpit_time_accounts(provider,external_id,status,person_id,link_method) values($1,$2,$3,$4,'manual')",
    [provider, externalId, status, personId]);
}
async function svc(fn: string, p: unknown) {
  await service(db);
  return call(db, fn, p);
}
async function inputs(now = NOW): Promise<Inputs> {
  await service(db);
  return (await db.query<{ r: Inputs }>("select public.cockpit_hours_watch_inputs($1::timestamptz) r", [now])).rows[0].r;
}
const find = (i: Inputs, name: string) => i.people.find(p => p.personId === ids[name]);
async function board() {
  await actor(db, CEO);
  return (await db.query<{ r: Record<string, any> }>("select public.cockpit_ceo_hours_watch_board() r")).rows[0].r;
}
async function keyGet(provider: string) {
  await service(db);
  return (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_watch_key_get($1) r", [provider])).rows[0].r;
}
async function ceoSet(p: unknown) {
  await actor(db, CEO);
  return call(db, "cockpit_ceo_hours_watch_set", p);
}
async function auditRows(action: string) {
  await owner(db);
  return (await db.query<{ actor_email: string; before: unknown; after: Record<string, unknown> }>(
    "select actor_email, \"before\", \"after\" from cockpit_audit_log where action=$1 order by created_at", [action])).rows;
}
async function incident(id: number) {
  await owner(db);
  return (await db.query<Record<string, any>>("select * from cockpit_hours_watch_incidents where id=$1", [id])).rows[0];
}
/** Today in Kuwait, as the database writes a day. */
const kuwaitToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
async function lease() {
  const r = await svc("cockpit_hours_watch_lease_claim", { requestedBy: "cron" });
  expect(r.ok).toBe(true);
  return { runId: r.runId as number, leaseToken: r.leaseToken as string };
}
async function finish(run: { runId: number; leaseToken: string }, state = "ok", result: unknown = { note: "Watched", watched: 1 }) {
  return svc("cockpit_hours_watch_finish", { ...run, state, result });
}
/** One apply under a fresh lease, finished at once. */
async function applyOnce(body: Record<string, unknown>) {
  const run = await lease();
  const r = await svc("cockpit_hours_watch_apply", { ...run, ...body });
  await finish(run);
  return r as { ok: boolean; opened: number[]; closed: number[]; slackUnknown: number[] };
}

beforeAll(async () => {
  db = await hoursTestDb();
  // Required to track by role: call centre agents and media buyers.
  await link(await person("Agent On", "Call centre agent", { schedule: week() }), "hubstaff", "hs-on");
  await person("Agent Day Off", "Call centre agent", { schedule: week({ off: ["wed", "fri"] }) });
  await person("Agent Holiday", "Call centre agent", { schedule: week() });
  await person("Agent Leave", "Call centre agent", { schedule: week() });
  await person("Agent Ended", "Call centre agent", { schedule: week(), endedOn: "2026-10-10" });
  await person("Agent Paused", "Call centre agent", { schedule: week(), pausedOn: "2026-10-01" });
  await person("Buyer No Account", "Media buyer", { schedule: week() });
  await person("Agent Optional", "Call centre agent", { schedule: week() });
  await person("Agent Exception", "Call centre agent", { schedule: week({ exceptions: [{ date: DAY, start: "12:00", end: "16:00" }, { date: "2026-10-15", off: true }] }) });
  await person("Buyer Default", "Media buyer");
  await person("Agent Dubai", "Call centre agent", { schedule: week({ tz: "Asia/Dubai", start: "09:00", end: "17:00" }) });
  await person("Video Editor", "Video editor", { schedule: week() });
  await person("Agent Bot", "Call centre agent", { engagement: "bot" }).catch(() => undefined);
  await owner(db);
  await db.query("insert into cockpit_hours_terms(person_id,tracking) values($1,'optional')", [ids["Agent Optional"]]);
  await db.query(`insert into cockpit_hours_holiday_overrides(day,action,name,scope,scope_value,reason,set_by)
    values($1,'add','Test holiday','person',$2,'A made-up holiday','tests')`, [DAY, String(ids["Agent Holiday"])]);
  await link(ids["Agent Leave"], "timetastic", "tt-leave");
  await db.query(`insert into cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,status,start_at,start_type,end_at,end_type,booking_unit)
    values('b-1','tt-leave','lt-1','Approved','2026-10-13T00:00:00','Morning','2026-10-15T00:00:00','Afternoon','Days')`);
  // No schedule at all: pay by the hour (the role default for agents and buyers, or terms) is not watched; fixed pay keeps the standard.
  await person("Buyer Fixed", "Media buyer");
  await person("Ops Hourly", "Operations lead");
  await person("Agent History", "Call centre agent");
  await person("Agent Paused No Schedule", "Call centre agent", { pausedOn: "2026-10-01" });
  await owner(db);
  await db.query("insert into cockpit_hours_terms(person_id,pay_basis) values($1,'fixed')", [ids["Buyer Fixed"]]);
  await db.query("insert into cockpit_hours_terms(person_id,tracking,pay_basis) values($1,'required','hours')", [ids["Ops Hourly"]]);
  await db.query("insert into cockpit_schedule_history(person_id,effective_from,schedule,source,recorded_by) values($1,'2026-10-01',$2,'dated','tests')",
    [ids["Agent History"], JSON.stringify(week())]);
  // Part-day leave (Timetastic): Morning, Afternoon and Hours bookings, each clipped to the shift.
  const book = async (name: string, tt: string, rows: [string, string, string, string, string, string, string][], schedule: unknown = week()) => {
    await link(await person(name, "Call centre agent", { schedule }), "timetastic", tt);
    await owner(db);
    for (const [id, status, startAt, startType, endAt, endType, unit] of rows)
      await db.query(`insert into cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,status,start_at,start_type,end_at,end_type,booking_unit)
        values($1,$2,'lt-1',$3,$4,$5,$6,$7,$8)`, [id, tt, status, startAt, startType, endAt, endType, unit]);
  };
  await book("Leave Morning", "tt-am", [["am-1", "Approved", `${DAY} 00:00`, "Morning", `${DAY} 00:00`, "Morning", "Days"]]);
  await book("Leave Afternoon", "tt-pm", [["pm-1", "Pending", `${DAY} 00:00`, "Afternoon", "2026-10-15 00:00", "Afternoon", "Days"]]);
  await book("Leave Last Morning", "tt-lam", [["lam-1", "Approved", "2026-10-12 00:00", "Morning", `${DAY} 00:00`, "Morning", "Days"]]);
  await book("Leave Halves", "tt-halves", [["h-am", "Approved", `${DAY} 00:00`, "Morning", `${DAY} 00:00`, "Morning", "Days"],
    ["h-pm", "Pending", `${DAY} 00:00`, "Afternoon", `${DAY} 00:00`, "Afternoon", "Days"]]);
  await book("Leave Hours", "tt-hours", [
    ["hr-1", "Approved", `${DAY} 12:00`, "Hours", `${DAY} 13:30`, "Hours", "Hours"],
    ["hr-2", "Pending", `${DAY} 13:00`, "Hours", `${DAY} 14:00`, "Hours", "Hours"],      // overlaps hr-1: one window
    ["hr-3", "Approved", `${DAY} 08:00`, "Hours", `${DAY} 09:30`, "Hours", "Hours"],     // before the shift: dropped
    ["hr-4", "Approved", `${DAY} 17:30`, "Hours", `${DAY} 19:00`, "Hours", "Hours"],     // runs past the end: clipped
    ["hr-5", "Cancelled", `${DAY} 15:00`, "Hours", `${DAY} 16:00`, "Hours", "Hours"],
    ["hr-6", "Approved", `${DAY} 16:00`, "Hours", `${DAY} 16:30`, "Hours", "Hours"]]);   // marked not taken below
  await db.query(`insert into cockpit_time_adjustments(person_id,month,kind,booking_id,reason,set_by)
    values($1,'2026-10-01','not_booked','hr-6','Came in after all','tests')`, [ids["Leave Hours"]]);
  await book("Leave Hours Dubai", "tt-dxb", [["dxb-1", "Approved", `${DAY} 10:00`, "Hours", `${DAY} 11:00`, "Hours", "Hours"]],
    week({ tz: "Asia/Dubai", start: "09:00", end: "17:00" }));
  await book("Leave Hours All", "tt-all", [["all-1", "Approved", `${DAY} 09:00`, "Hours", `${DAY} 19:00`, "Hours", "Hours"]]);
}, 60000);
afterAll(async () => { await db.close(); });

describe("access", () => {
  test("anon, a signed-in member and the CEO cannot read any watch table", async () => {
    for (const who of [null, MEMBER, ADMIN, CEO]) {
      await actor(db, who);
      for (const t of TABLES) await expect(db.query(`select * from public.${t} limit 1`)).rejects.toMatchObject({ code: "42501" });
    }
  });
  test("service_role reads the watch tables but never the keys table", async () => {
    await service(db);
    for (const t of TABLES.filter(t => t !== "cockpit_hours_watch_keys")) await expect(db.query(`select * from public.${t} limit 1`)).resolves.toBeTruthy();
    await expect(db.query("select * from public.cockpit_hours_watch_keys")).rejects.toMatchObject({ code: "42501" });
  });
  test("CEO RPCs refuse anon, a member and an admin who is not the CEO with 42501", async () => {
    for (const who of [null, MEMBER, ADMIN]) {
      await actor(db, who);
      for (const sql of CEO_RPCS) await expect(db.query(`select public.${sql}`)).rejects.toMatchObject({ code: "42501" });
    }
  });
  test("service RPCs refuse anon, a member and the CEO", async () => {
    for (const who of [null, MEMBER, CEO]) {
      await actor(db, who);
      for (const sql of SERVICE_RPCS) await expect(db.query(`select public.${sql}`)).rejects.toMatchObject({ code: "42501" });
    }
  });
  test("internal helpers are granted to nobody; each RPC to exactly one role", async () => {
    await owner(db);
    const can = async (role: string, fn: string) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${fn}', 'EXECUTE') ok`, [role])).rows[0].ok;
    for (const fn of INTERNAL) for (const role of ["anon", "authenticated", "service_role"]) expect(await can(role, fn)).toBe(false);
    for (const fn of ["cockpit_ceo_hours_watch_board()", "cockpit_ceo_hours_watch_set(jsonb)", "cockpit_ceo_hours_watch_review(jsonb)",
      "cockpit_hours_watch_object_allowed(text)"]) {
      expect([await can("anon", fn), await can("authenticated", fn), await can("service_role", fn)]).toEqual([false, true, false]);
    }
    for (const fn of ["cockpit_hours_watch_apply(jsonb)", "cockpit_hours_watch_inputs(timestamptz)", "cockpit_hours_watch_prune()",
      "cockpit_hours_watch_key_mark(jsonb)"]) {
      expect([await can("anon", fn), await can("authenticated", fn), await can("service_role", fn)]).toEqual([false, false, true]);
    }
  });
  test("a service RPC called with the service grant but no service claim is refused", async () => {
    await service(db);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "authenticated" })]);
    await expect(db.query("select public.cockpit_hours_watch_prune()")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("settings", () => {
  test("seeded with the spec's defaults", async () => {
    const b = await board();
    expect(b.settings).toEqual({ on: true, shots: true, channel: "C0B5TL9H370", channelName: "team-management", notTrackingMinutes: 30,
      graceMinutes: 15, idleMinutes: 30, idleFloorPct: 10, windowMinutes: 30, nonWorkShots: 2, minConfidence: 0.75,
      mention: true, mentionUser: "U09305KE2KS" });
  });
  test("a partial patch saves, with one audit row carrying before and after", async () => {
    const r = await ceoSet({ notTrackingMinutes: 45, minConfidence: 0.8 });
    expect(r.settings).toMatchObject({ notTrackingMinutes: 45, minConfidence: 0.8, on: true, graceMinutes: 15 });
    const rows = await auditRows("hours.watch.set");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_email).toBe("aziz@maharamedia.com");
    expect(rows[0].before).toMatchObject({ notTrackingMinutes: 30 });
    expect(rows[0].after).toMatchObject({ notTrackingMinutes: 45 });
    await ceoSet({ notTrackingMinutes: 45 });
    expect(await auditRows("hours.watch.set")).toHaveLength(1);      // nothing changed, nothing written
  });
  test("every bound is enforced with a plain sentence", async () => {
    const bad: Record<string, unknown>[] = [
      { notTrackingMinutes: 9 }, { notTrackingMinutes: 241 }, { notTrackingMinutes: 30.5 }, { notTrackingMinutes: "30" },
      { graceMinutes: -1 }, { graceMinutes: 121 }, { idleMinutes: 19 }, { idleMinutes: 241 }, { idleFloorPct: 0 }, { idleFloorPct: 51 },
      { windowMinutes: 19 }, { windowMinutes: 121 }, { nonWorkShots: 0 }, { nonWorkShots: 7 }, { minConfidence: 0.49 }, { minConfidence: 1 },
      { channel: "c0b5tl9h370" }, { channel: "D0B5TL9H370" }, { channel: "C0B5" }, { channelName: "#team-management" },
      { on: "yes" }, { shots: 1 }, { surprise: true }, {}];
    for (const p of bad) await expect(ceoSet(p)).rejects.toMatchObject({ code: "22023" });
    await expect(ceoSet({ notTrackingMinutes: 9 })).rejects.toThrow("Alert after Hubstaff is off for: choose a whole number from 10 to 240");
    for (const p of [{ notTrackingMinutes: 10 }, { notTrackingMinutes: 240 }, { graceMinutes: 0 }, { minConfidence: 0.99 }, { channel: "G0123456789" }])
      await expect(ceoSet(p)).resolves.toMatchObject({ ok: true });
    await ceoSet({ notTrackingMinutes: 30, graceMinutes: 15, minConfidence: 0.75, channel: "C0B5TL9H370" });
  });
  test("a bad value written to the row by hand reads as the default, never as itself", async () => {
    await owner(db);
    await db.query("update cockpit_settings set value=value||'{\"idleFloorPct\":500,\"nonWorkShots\":\"two\"}'::jsonb where key='hours.watch'");
    const i = await inputs();
    expect(i.settings).toMatchObject({ idleFloorPct: 10, nonWorkShots: 2 });
    await ceoSet({ idleFloorPct: 10, nonWorkShots: 2 });
  });
  test("the Slack mention: on by default for the CEO's user id; the set RPC takes a switch and a user id, checked", async () => {
    // A row seeded before the mention existed still reads it from the defaults.
    await owner(db);
    await db.query("update cockpit_settings set value=value-'mention'-'mentionUser' where key='hours.watch'");
    expect((await inputs()).settings).toMatchObject({ mention: true, mentionUser: "U09305KE2KS" });
    for (const p of [{ mention: "yes" }, { mention: 1 }, { mention: null }, { mentionUser: "u09305ke2ks" }, { mentionUser: "C09305KE2KS" },
      { mentionUser: "U0930" }, { mentionUser: "U09305KE2KS1234" }, { mentionUser: 9305 }, { mentionUser: "<@U09305KE2KS>" }])
      await expect(ceoSet(p)).rejects.toMatchObject({ code: "22023" });
    await expect(ceoSet({ mentionUser: "C09305KE2KS" })).rejects.toThrow("A Slack user id starts with U or W, then 8 to 12 capital letters or digits");
    expect((await ceoSet({ mention: false, mentionUser: "W0123456789" })).settings).toMatchObject({ mention: false, mentionUser: "W0123456789" });
    expect((await auditRows("hours.watch.set")).at(-1)?.after).toMatchObject({ mention: false, mentionUser: "W0123456789" });
    expect((await inputs()).settings).toMatchObject({ mention: false, mentionUser: "W0123456789" });
    // A bad id written by hand reads as the default, never as itself.
    await owner(db);
    await db.query(`update cockpit_settings set value=value||'{"mentionUser":"<!channel>"}'::jsonb where key='hours.watch'`);
    expect((await inputs()).settings).toMatchObject({ mentionUser: "U09305KE2KS" });
    await ceoSet({ mention: true, mentionUser: "U09305KE2KS" });
  });
});

describe("inputs: who is on shift", () => {
  let i: Inputs;
  beforeAll(async () => { i = await inputs(); });

  test("only people required to track are watched: optional terms, an exempt role and bots are not", async () => {
    const names = i.people.map(p => p.name);
    expect(names).toContain("Agent On");
    expect(names).toContain("Buyer No Account");
    expect(names).not.toContain("Agent Optional");
    expect(names).not.toContain("Video Editor");
    expect(names).not.toContain("Agent Bot");
  });
  test("a required person on shift: the shift in UTC from the Kuwait wall clock, with the Hubstaff account", () => {
    const p = find(i, "Agent On")!;
    expect(p.offReason).toBeNull();
    expect(p.hubstaffUserId).toBe("hs-on");
    expect(p.accountStatus).toBe("active");
    expect(p.timezone).toBe("Asia/Kuwait");
    expect(p.day).toBe(DAY);
    expect(new Date(p.shift!.start).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(new Date(p.shift!.end).toISOString()).toBe("2026-10-14T15:00:00.000Z");
  });
  test("day off, holiday, leave, ended and paused are not on shift, each with its reason", () => {
    expect([find(i, "Agent Day Off"), find(i, "Agent Holiday"), find(i, "Agent Leave"), find(i, "Agent Ended"), find(i, "Agent Paused")]
      .map(p => [p!.offReason, p!.shift])).toEqual([["day_off", null], ["holiday", null], ["leave", null], ["not_employed", null], ["paused", null]]);
  });
  test("no linked Hubstaff account: still watched, with no id", () => {
    const p = find(i, "Buyer No Account")!;
    expect(p.hubstaffUserId).toBeNull();
    expect(p.accountStatus).toBe("none");
    expect(p.offReason).toBeNull();
  });
  test("the date's exception wins over the weekday, both ways", async () => {
    const p = find(i, "Agent Exception")!;
    expect(new Date(p.shift!.start).toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(new Date(p.shift!.end).toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(find(await inputs("2026-10-15T08:00:00Z"), "Agent Exception")!.offReason).toBe("day_off");
  });
  test("no schedule and fixed pay: Saturday to Thursday 10:00 to 18:00 Kuwait", async () => {
    const p = find(i, "Buyer Fixed")!;
    expect(p.timezone).toBe("Asia/Kuwait");
    expect(new Date(p.shift!.start).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(find(await inputs("2026-10-16T08:00:00Z"), "Buyer Fixed")!.offReason).toBe("day_off");          // Friday
    expect(find(await inputs("2026-10-17T08:00:00Z"), "Buyer Fixed")!.offReason).toBeNull();               // Saturday
  });
  test("no schedule and paid by the hour (role default or terms): no_schedule, never the made-up 10:00 to 18:00", async () => {
    // recheck_3 finding 4: the nudge expects nothing of them; the watch alerted on a default shift.
    for (const name of ["Buyer Default", "Ops Hourly"]) {
      const p = find(i, name)!;
      expect([p.offReason, p.shift, p.leave]).toEqual(["no_schedule", null, []]);
      expect(find(await inputs("2026-10-17T08:00:00Z"), name)!.offReason).toBe("no_schedule");
    }
    // A schedule in the history alone is a schedule.
    expect(find(i, "Agent History")!.offReason).toBeNull();
    expect(new Date(find(i, "Agent History")!.shift!.start).toISOString()).toBe("2026-10-14T07:00:00.000Z");
    // Ended or paused still read as such before no_schedule.
    expect(find(i, "Agent Paused No Schedule")!.offReason).toBe("paused");
    // The board shows them off today with the reason, never as working or cant_tell.
    const row = (await board()).people.find((x: { personId: number }) => x.personId === ids["Buyer Default"]);
    expect(row).toMatchObject({ state: "off_shift", offReason: "no_schedule", shiftStart: null, leave: [] });
  });
  test("part-day leave: Morning is the shift's first half, Afternoon its second, both on the right day only", async () => {
    const iso = (p: Person | undefined) => p!.leave.map(l => [new Date(l.start).toISOString(), new Date(l.end).toISOString()]);
    // Shift 07:00 to 15:00 UTC (10:00 to 18:00 Kuwait), midpoint 11:00 UTC.
    expect(find(i, "Leave Morning")!.offReason).toBeNull();
    expect(iso(find(i, "Leave Morning"))).toEqual([["2026-10-14T07:00:00.000Z", "2026-10-14T11:00:00.000Z"]]);
    expect(iso(find(i, "Leave Afternoon"))).toEqual([["2026-10-14T11:00:00.000Z", "2026-10-14T15:00:00.000Z"]]);   // pending counts
    expect(iso(find(i, "Leave Last Morning"))).toEqual([["2026-10-14T07:00:00.000Z", "2026-10-14T11:00:00.000Z"]]);
    expect(find(i, "Leave Morning")!.shift).not.toBeNull();
    // The next day of an Afternoon start is the whole shift: off for the day.
    expect(find(await inputs("2026-10-15T08:00:00Z"), "Leave Afternoon")).toMatchObject({ offReason: "leave", shift: null, leave: [] });
    expect(find(await inputs("2026-10-15T08:00:00Z"), "Leave Last Morning")).toMatchObject({ offReason: null, leave: [] });
    // A morning and an afternoon together cover the shift: whole-shift leave.
    expect(find(i, "Leave Halves")).toMatchObject({ offReason: "leave", shift: null, leave: [] });
  });
  test("part-day leave: Hours bookings are wall clock in the schedule's zone, merged, clipped to the shift; cancelled and not-taken ignored", () => {
    const iso = (p: Person | undefined) => p!.leave.map(l => [new Date(l.start).toISOString(), new Date(l.end).toISOString()]);
    expect(find(i, "Leave Hours")!.offReason).toBeNull();
    expect(iso(find(i, "Leave Hours"))).toEqual([
      ["2026-10-14T09:00:00.000Z", "2026-10-14T11:00:00.000Z"],      // 12:00-13:30 and 13:00-14:00 Kuwait
      ["2026-10-14T14:30:00.000Z", "2026-10-14T15:00:00.000Z"]]);    // 17:30 to the 18:00 shift end
    expect(iso(find(i, "Leave Hours Dubai"))).toEqual([["2026-10-14T06:00:00.000Z", "2026-10-14T07:00:00.000Z"]]);
    expect(find(i, "Leave Hours All")).toMatchObject({ offReason: "leave", shift: null, leave: [] });
    // Nobody else carries a window; someone off for another reason carries none either.
    expect(find(i, "Agent On")!.leave).toEqual([]);
    expect(find(i, "Agent Day Off")!.leave).toEqual([]);
  });
  test("the schedule's own time zone sets the wall clock", () => {
    const p = find(i, "Agent Dubai")!;
    expect(p.timezone).toBe("Asia/Dubai");
    expect(new Date(p.shift!.start).toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });
  test("leave that the CEO marked not taken no longer keeps someone off", async () => {
    await owner(db);
    await db.query(`insert into cockpit_time_adjustments(person_id,month,kind,booking_id,reason,set_by)
      values($1,'2026-10-01','not_booked','b-1','Came in after all','tests')`, [ids["Agent Leave"]]);
    expect(find(await inputs(), "Agent Leave")).toMatchObject({ offReason: null, leave: [] });
  });
  test("settings, open alerts and known screenshots ride along", () => {
    expect(i.settings).toMatchObject({ on: true, channel: "C0B5TL9H370" });
    expect(new Date(i.now).toISOString()).toBe("2026-10-14T08:00:00.000Z");
    expect(Array.isArray(i.open)).toBe(true);
    expect(Array.isArray(i.knownShots)).toBe(true);
    // Before any run, prune or reply: nothing to go on, never a made-up time.
    expect([i.lastOkRunAt, i.lastPruneOn, i.replies]).toEqual([null, null, []]);
  });
  test("the lunch break comes from the Hours rules in force for the Kuwait month, else 60 minutes past 6 hours", async () => {
    expect(i.rules).toEqual({ breakMinutes: 60, breakWhenLongerThanHours: 6 });
    await owner(db);
    await db.query("insert into cockpit_hours_rules(from_month,settings,saved_by) values('2026-09-01',$1,'tests'),('2026-11-01',$2,'tests')",
      [JSON.stringify({ breakMinutes: 45, breakWhenLongerThanHours: 7.5, graceShare: 0.1 }), JSON.stringify({ breakMinutes: 90 })]);
    expect((await inputs()).rules).toEqual({ breakMinutes: 45, breakWhenLongerThanHours: 7.5 });
    expect((await inputs("2026-11-02T08:00:00Z")).rules).toEqual({ breakMinutes: 90, breakWhenLongerThanHours: 6 });
    expect((await inputs("2026-10-31T22:00:00Z")).rules.breakMinutes).toBe(90);      // already 1 November in Kuwait
    await owner(db);
    await db.query("update cockpit_hours_rules set settings=$1 where from_month='2026-09-01'",
      [JSON.stringify({ breakMinutes: "an hour", breakWhenLongerThanHours: 30 })]);
    expect((await inputs()).rules).toEqual({ breakMinutes: 60, breakWhenLongerThanHours: 6 });
    await owner(db);
    await db.query("delete from cockpit_hours_rules");
  });
});

describe("lease", () => {
  test("one run at a time; a lapsed lease is abandoned and the next run claims", async () => {
    const run = await lease();
    const busy = await svc("cockpit_hours_watch_lease_claim", {});
    expect(busy).toMatchObject({ ok: false, busy: true, runId: run.runId });
    await owner(db);
    await db.query("update cockpit_hours_watch_runs set lease_until=now()-interval '1 minute' where id=$1", [run.runId]);
    const next = await lease();
    await owner(db);
    expect((await db.query<{ state: string }>("select state from cockpit_hours_watch_runs where id=$1", [run.runId])).rows[0].state).toBe("abandoned");
    expect(await finish(run)).toMatchObject({ ok: false, state: "abandoned" });
    await finish(next);
  });
  test("apply refuses without the lease: a wrong token, a lapsed lease, a finished run, a dry run", async () => {
    const run = await lease();
    const body = { statuses: [{ personId: ids["Agent On"], state: "tracking" }] };
    await expect(svc("cockpit_hours_watch_apply", { ...body, runId: run.runId, leaseToken: crypto.randomUUID() })).rejects.toMatchObject({ code: "40001" });
    await expect(svc("cockpit_hours_watch_apply", { ...body, runId: run.runId })).rejects.toMatchObject({ code: "22023" });
    await owner(db);
    await db.query("update cockpit_hours_watch_runs set lease_until=now()-interval '1 second' where id=$1", [run.runId]);
    await expect(svc("cockpit_hours_watch_apply", { ...body, ...run })).rejects.toMatchObject({ code: "40001" });
    await owner(db);
    await db.query("update cockpit_hours_watch_runs set lease_until=now()+interval '6 minutes' where id=$1", [run.runId]);
    await finish(run);
    await expect(svc("cockpit_hours_watch_apply", { ...body, ...run })).rejects.toMatchObject({ code: "40001" });
    const dry = await svc("cockpit_hours_watch_lease_claim", { dryRun: true });
    await expect(svc("cockpit_hours_watch_apply", { ...body, runId: dry.runId, leaseToken: dry.leaseToken })).rejects.toMatchObject({ code: "22023" });
    await finish({ runId: dry.runId as number, leaseToken: dry.leaseToken as string });
    await expect(svc("cockpit_hours_watch_finish", { ...run, state: "ok", leaseToken: crypto.randomUUID() })).rejects.toMatchObject({ code: "42501" });
  });
  test("the lease is 6 minutes, so a worst-case run still applies inside it", async () => {
    const run = await lease();
    await owner(db);
    expect((await db.query<{ s: number }>("select extract(epoch from lease_until-started_at)::int s from cockpit_hours_watch_runs where id=$1",
      [run.runId])).rows[0].s).toBe(360);
    await finish(run);
  });
  test("lastOkRunAt is when the newest run that finished ok started; failed, abandoned and dry runs never count", async () => {
    const ok = await lease();
    await finish(ok);
    await owner(db);
    const started = (await db.query<{ started_at: Date }>("select started_at from cockpit_hours_watch_runs where id=$1", [ok.runId])).rows[0].started_at;
    const failed = await lease();
    await finish(failed, "failed", { note: "Hubstaff cannot be read" });
    const dry = await svc("cockpit_hours_watch_lease_claim", { dryRun: true });
    await finish({ runId: dry.runId as number, leaseToken: dry.leaseToken as string });
    const running = await lease();                                      // the run asking is still running: not counted either
    const i = await inputs();
    expect(new Date(i.lastOkRunAt!).getTime()).toBe(new Date(started).getTime());
    await finish(running);
  });
  test("Check now is audited as the CEO's; the schedule is not", async () => {
    const before = (await auditRows("hours.watch.runNow")).length;
    const cron = await lease();
    await finish(cron);
    expect((await auditRows("hours.watch.runNow")).length).toBe(before);
    const asked = await svc("cockpit_hours_watch_lease_claim", { requestedBy: "ceo@example.com" });
    expect(asked.ok).toBe(true);
    await finish({ runId: asked.runId as number, leaseToken: asked.leaseToken as string });
    const rows = await auditRows("hours.watch.runNow");
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ actor_email: "ceo@example.com", after: { dryRun: false } });
  });
  test("a payload over 1 MB is refused before anything is written", async () => {
    const run = await lease();
    const big = { ...run, statuses: [{ personId: ids["Agent On"], state: "tracking", detail: { pad: "x".repeat(1_100_000) } }] };
    await expect(svc("cockpit_hours_watch_apply", big)).rejects.toMatchObject({ code: "54000" });
    await finish(run);
  });
  test("finish keeps the guardian's row; a dry run leaves it alone", async () => {
    await owner(db);
    const row = async () => (await db.query<{ ok: boolean; note: string; rows_seen: number }>(
      "select ok, note, rows_seen from cockpit_sync_state where key='hours-watch'")).rows[0];
    const run = await lease();
    await finish(run, "ok", { note: "Nobody on shift", watched: 3 });
    await owner(db);
    expect(await row()).toEqual({ ok: true, note: "Nobody on shift", rows_seen: 3 });
    const dry = await svc("cockpit_hours_watch_lease_claim", { dryRun: true });
    await finish({ runId: dry.runId as number, leaseToken: dry.leaseToken as string }, "failed", { note: "dry" });
    await owner(db);
    expect(await row()).toEqual({ ok: true, note: "Nobody on shift", rows_seen: 3 });
    const failed = await lease();
    await svc("cockpit_hours_watch_finish", { ...failed, state: "failed", error: "Hubstaff refused the key" });
    await owner(db);
    expect(await row()).toMatchObject({ ok: false, note: "Hubstaff refused the key" });
  });
});

describe("apply: alerts open, are seen again and close", () => {
  let first: number;
  test("an open becomes one pending alert on the channel", async () => {
    const r = await applyOnce({ open: [{ personId: ids["Agent On"], kind: "not_tracking", detail: { since: "2026-10-14T07:12:00Z" } }] });
    expect(r.opened).toHaveLength(1);
    first = r.opened[0];
    expect(await incident(first)).toMatchObject({ kind: "not_tracking", slack_state: "pending", slack_channel: "C0B5TL9H370", resolve_state: "none",
      closed_at: null, detail: { since: "2026-10-14T07:12:00Z" } });
    expect((await auditRows("hours.watch.alerts")).at(-1)?.after).toMatchObject({ opened: [first], closed: [] });
  });
  test("a second open of the same person and kind touches the first instead", async () => {
    const before = (await incident(first)).last_seen_at;
    const r = await applyOnce({ open: [{ personId: ids["Agent On"], kind: "not_tracking" }] });
    expect(r.opened).toEqual([]);
    expect((await incident(first)).last_seen_at >= before).toBe(true);
    await owner(db);
    await expect(db.query("insert into cockpit_hours_watch_incidents(person_id,kind) values($1,'not_tracking')", [ids["Agent On"]]))
      .rejects.toMatchObject({ code: "23505" });
  });
  test("update merges detail; source has no person and the others need one", async () => {
    await applyOnce({ update: [{ id: first, detail: { minutes: 35 } }] });
    expect((await incident(first)).detail).toEqual({ since: "2026-10-14T07:12:00Z", minutes: 35 });
    for (const bad of [{ kind: "source", personId: ids["Agent On"] }, { kind: "not_work" }, { kind: "asleep", personId: ids["Agent On"] }]) {
      const run = await lease();
      await expect(svc("cockpit_hours_watch_apply", { ...run, open: [bad] })).rejects.toMatchObject({ code: "22023" });
      await finish(run);
    }
  });
  test("close: an alert that never went out closes with no reply due; it never reopens", async () => {
    const r = await applyOnce({ close: [{ id: first, reason: "shift_ended", detail: { offUntil: "18:00" } }] });
    expect(r.closed).toEqual([first]);
    const row = await incident(first);
    expect(row).toMatchObject({ close_reason: "shift_ended", slack_state: "muted", resolve_state: "none", detail: { offUntil: "18:00" } });
    expect((await applyOnce({ close: [{ id: first }], update: [{ id: first, detail: { late: true } }] })).closed).toEqual([]);
    expect((await incident(first)).detail).not.toHaveProperty("late");
    await owner(db);
    await expect(db.query("update cockpit_hours_watch_incidents set closed_at=null where id=$1", [first])).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("update cockpit_hours_watch_incidents set kind='idle' where id=$1", [first])).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("delete from cockpit_hours_watch_incidents where id=$1", [first])).rejects.toMatchObject({ code: "42501" });
    const again = await applyOnce({ open: [{ personId: ids["Agent On"], kind: "not_tracking" }] });
    expect(again.opened).toHaveLength(1);
    expect(again.opened[0]).not.toBe(first);
    await applyOnce({ close: [{ id: again.opened[0], reason: "cleared" }] });
  });
  test("with alerts off an alert is recorded muted, and so is its close", async () => {
    await ceoSet({ on: false });
    const r = await applyOnce({ open: [{ personId: ids["Agent On"], kind: "idle" }] });
    expect((await incident(r.opened[0])).slack_state).toBe("muted");
    await applyOnce({ close: [{ id: r.opened[0], reason: "cleared" }] });
    expect((await incident(r.opened[0])).resolve_state).toBe("muted");
    await ceoSet({ on: true });
  });
  test("statuses and slots upsert; since stays while the state stays", async () => {
    const p = ids["Agent On"];
    await applyOnce({ statuses: [{ personId: p, state: "tracking", online: true, trackedTodayS: 3600.4, activePct30m: 55.555 }],
      slots: [{ personId: p, slotStart: "2026-10-14T07:00:00Z", trackedS: 600, overallS: 300, idle: false }] });
    await owner(db);
    const one = (await db.query<Record<string, any>>("select * from cockpit_hours_watch_status where person_id=$1", [p])).rows[0];
    // Two decimals, cut: the card rounds down, so a figure is never pushed up across a whole percent.
    expect(one).toMatchObject({ state: "tracking", online: true, tracked_today_s: 3600, active_pct_30m: "55.55" });
    await applyOnce({ statuses: [{ personId: p, state: "tracking", online: true }],
      slots: [{ personId: p, slotStart: "2026-10-14T07:00:00Z", trackedS: 600, overallS: 20, idle: true }] });
    await owner(db);
    const two = (await db.query<Record<string, any>>("select * from cockpit_hours_watch_status where person_id=$1", [p])).rows[0];
    expect(two.since).toEqual(one.since);
    // A run that read no figures (nobody on shift) keeps the ones already stored.
    expect(two.tracked_today_s).toBe(3600);
    await applyOnce({ statuses: [{ personId: p, state: "off_shift", since: null, shiftStart: null, shiftEnd: null, detail: {} }] });
    await owner(db);
    const three = (await db.query<Record<string, any>>("select * from cockpit_hours_watch_status where person_id=$1", [p])).rows[0];
    expect([three.state, three.tracked_today_s, three.online, three.active_pct_30m]).toEqual(["off_shift", 3600, true, "55.55"]);
    expect((await db.query("select tracked_s, overall_s, idle from cockpit_hours_watch_slots where person_id=$1", [p])).rows)
      .toEqual([{ tracked_s: 600, overall_s: 20, idle: true }]);
    const run = await lease();
    await expect(svc("cockpit_hours_watch_apply", { ...run, statuses: [{ personId: p, state: "asleep" }] })).rejects.toMatchObject({ code: "23514" });
    await finish(run);
  });
  test("activePct30m keeps two decimals and never rounds up: 9.996 under a 10% floor stays 9.99", async () => {
    // recheck_3 nit 4: Slack said 9% while the card, reading a rounded figure, said 10%.
    const p = ids["Agent On"];
    const pct = async (v: number) => {
      await applyOnce({ statuses: [{ personId: p, state: "tracking", activePct30m: v }] });
      await owner(db);
      return (await db.query<{ v: string }>("select active_pct_30m::text v from cockpit_hours_watch_status where person_id=$1", [p])).rows[0].v;
    };
    expect([await pct(9.996), await pct(9.999999), await pct(0.004), await pct(100), await pct(33.3333)]).toEqual(["9.99", "9.99", "0.00", "100.00", "33.33"]);
  });
  test("a state of on_break is stored (stopped inside the allowed lunch wait); anything unknown is refused", async () => {
    const p = ids["Agent On"];
    await applyOnce({ statuses: [{ personId: p, state: "on_break", since: "2026-10-14T10:00:00Z" }] });
    await owner(db);
    expect((await db.query<Record<string, any>>("select state, since from cockpit_hours_watch_status where person_id=$1", [p])).rows[0])
      .toEqual({ state: "on_break", since: new Date("2026-10-14T10:00:00Z") });
    await applyOnce({ statuses: [{ personId: p, state: "tracking" }] });
  });
  test("slots keep the block's computer time (inputTrackedS) when sent, and keep it when a later run sends none", async () => {
    const p = ids["Agent On"];
    const rows = async () => {
      await owner(db);
      return (await db.query("select slot_start, tracked_s, overall_s, input_tracked_s from cockpit_hours_watch_slots where person_id=$1 and slot_start>='2026-10-14T09:00:00Z' order by slot_start", [p])).rows;
    };
    await applyOnce({ slots: [{ personId: p, slotStart: "2026-10-14T09:00:00Z", trackedS: 600, overallS: 120, inputTrackedS: 240.4, idle: false },
      { personId: p, slotStart: "2026-10-14T09:10:00Z", trackedS: 600, overallS: 0, idle: false }] });
    expect(await rows()).toEqual([
      { slot_start: new Date("2026-10-14T09:00:00Z"), tracked_s: 600, overall_s: 120, input_tracked_s: 240 },
      { slot_start: new Date("2026-10-14T09:10:00Z"), tracked_s: 600, overall_s: 0, input_tracked_s: null }]);       // phone time only: unknown, never 0
    await applyOnce({ slots: [{ personId: p, slotStart: "2026-10-14T09:00:00Z", trackedS: 600, overallS: 150, idle: false },
      { personId: p, slotStart: "2026-10-14T09:10:00Z", trackedS: 600, overallS: 30, inputTrackedS: 60, idle: false }] });
    expect((await rows()).map(r => (r as { input_tracked_s: number | null }).input_tracked_s)).toEqual([240, 60]);
    for (const bad of [4000, -1]) {
      const run = await lease();
      await expect(svc("cockpit_hours_watch_apply", { ...run, slots: [{ personId: p, slotStart: "2026-10-14T09:20:00Z", trackedS: 600, overallS: 0, inputTrackedS: bad }] }))
        .rejects.toMatchObject({ code: "23514" });
      await finish(run);
    }
    // A string is not a number of seconds: stored as unknown.
    await applyOnce({ slots: [{ personId: p, slotStart: "2026-10-14T09:20:00Z", trackedS: 600, overallS: 0, inputTrackedS: "600" }] });
    expect((await rows()).at(-1)).toMatchObject({ input_tracked_s: null });
    await owner(db);
    await db.query("delete from cockpit_hours_watch_slots where person_id=$1 and slot_start>='2026-10-14T09:00:00Z'", [p]);
  });
  test("shots: text is cut to its bound, a judged verdict is never undone, unsafe paths are refused", async () => {
    const p = ids["Agent On"];
    const shot = { shotId: 9001, personId: p, hubstaffUserId: "hs-on", recordedAt: "2026-10-14T07:55:00Z", slotStart: "2026-10-14T07:50:00Z" };
    await applyOnce({ shots: [{ ...shot, verdict: "not_work", label: "L".repeat(500), reason: "R".repeat(500), category: "C".repeat(90),
      confidence: 1.7, model: "gemini-flash-latest", apps: [{ name: "YouTube", tracked: 400 }], attempts: 1 }] });
    await applyOnce({ shots: [{ ...shot, verdict: "error", error: "timeout", attempts: 2, thumbPath: "2026-10-14/9001-thumb.jpg", fullPath: "2026-10-14/9001.jpg" }] });
    await owner(db);
    const row = (await db.query<Record<string, any>>("select * from cockpit_hours_watch_shots where shot_id=9001")).rows[0];
    expect([row.verdict, row.label.length, row.reason.length, row.category.length, row.confidence]).toEqual(["not_work", 120, 240, 40, "1.000"]);
    expect([row.thumb_path, row.full_path]).toEqual(["2026-10-14/9001-thumb.jpg", "2026-10-14/9001.jpg"]);
    for (const path of ["../secret.jpg", "/abs.jpg", "a b.jpg"]) {
      const run = await lease();
      await expect(svc("cockpit_hours_watch_apply", { ...run, shots: [{ ...shot, shotId: 9002, thumbPath: path }] })).rejects.toMatchObject({ code: "22023" });
      await finish(run);
    }
    const known = (await inputs("2026-10-14T08:00:00Z")).knownShots;
    // The not-work rule counts screenshots judged in earlier runs, so each carries its person, time, confidence and label.
    expect(known.find(s => s.shotId === 9001)).toMatchObject({ shotId: 9001, verdict: "not_work", attempts: 1, personId: expect.any(Number), confidence: 1 });
    expect(Object.keys(known.find(s => s.shotId === 9001) ?? {}).sort()).toEqual(["attempts", "confidence", "label", "personId", "recordedAt", "shotId", "verdict"]);
    expect((await inputs("2026-10-14T12:00:00Z")).knownShots.map(s => s.shotId)).not.toContain(9001);
  });
});

describe("Slack: a post goes out at most once", () => {
  let id: number;
  test("claim moves pending to sending once; a second claim gets nothing", async () => {
    id = (await applyOnce({ open: [{ personId: ids["Agent On"], kind: "not_work", detail: { count: 3 } }] })).opened[0];
    const claim = await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "open" });
    expect(claim).toMatchObject({ id, kind: "not_work", slackState: "sending", slackChannel: "C0B5TL9H370", name: "Agent On", role: "Call centre agent" });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "open" })).toBeNull();
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "resolve" })).toBeNull();
  });
  test("posted needs its ts; the answer lands once", async () => {
    await expect(svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "open", state: "posted" })).rejects.toMatchObject({ code: "22023" });
    await expect(svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "open", state: "posted", ts: "not a ts" })).rejects.toMatchObject({ code: "22023" });
    expect(await svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "open", state: "posted", ts: "1760425200.123456" })).toEqual({ ok: true });
    expect(await svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "open", state: "failed", error: "late" })).toMatchObject({ ok: false });
    expect(await incident(id)).toMatchObject({ slack_state: "posted", slack_ts: "1760425200.123456", slack_error: null });
  });
  test("closing a posted alert makes one reply due, claimed and answered once", async () => {
    await applyOnce({ close: [{ id, reason: "cleared" }] });
    expect((await incident(id)).resolve_state).toBe("pending");
    const claim = await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "resolve" });
    expect(claim).toMatchObject({ id, slackTs: "1760425200.123456", resolveState: "sending", closeReason: "cleared" });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "resolve" })).toBeNull();
    expect(await svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "resolve", state: "posted" })).toEqual({ ok: true });
    expect((await incident(id)).resolve_state).toBe("posted");
  });
  test("an unknown answer is final: never pending again, never claimed again", async () => {
    const other = (await applyOnce({ open: [{ personId: ids["Buyer No Account"], kind: "not_tracking", detail: { reason: "no_account" } }] })).opened[0];
    await svc("cockpit_hours_watch_slack_claim", { incidentId: other, which: "open" });
    await svc("cockpit_hours_watch_slack_result", { incidentId: other, which: "open", state: "unknown" });
    expect(await incident(other)).toMatchObject({ slack_state: "unknown", slack_error: "No answer from Slack" });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: other, which: "open" })).toBeNull();
    await owner(db);
    await expect(db.query("update cockpit_hours_watch_incidents set slack_state='pending' where id=$1", [other])).rejects.toMatchObject({ code: "55000" });
    await applyOnce({ close: [{ id: other, reason: "cleared" }] });
    expect((await incident(other)).resolve_state).toBe("none");       // no thread to reply in
  });
  test("with alerts switched off between open and post, the claim mutes the post", async () => {
    const third = (await applyOnce({ open: [{ personId: ids["Agent Dubai"], kind: "not_tracking" }] })).opened[0];
    await ceoSet({ on: false });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: third, which: "open" })).toBeNull();
    expect((await incident(third)).slack_state).toBe("muted");
    await ceoSet({ on: true });
    await applyOnce({ close: [{ id: third, reason: "cleared" }] });
  });
  test("a claim never answered (the worker stopped mid-post) becomes unknown after 10 minutes and is never sent again", async () => {
    const lost = (await applyOnce({ open: [{ personId: ids["Agent Dubai"], kind: "idle" }] })).opened[0];
    const fresh = (await applyOnce({ open: [{ personId: ids["Agent Exception"], kind: "not_work" }] })).opened[0];
    // review_5 probe1: the claim lands, then the receipt insert throws and nothing answers.
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: lost, which: "open" })).toMatchObject({ slackState: "sending" });
    await svc("cockpit_hours_watch_slack_claim", { incidentId: fresh, which: "open" });
    expect((await incident(lost)).slack_claimed_at).toBeInstanceOf(Date);
    expect((await applyOnce({})).slackUnknown).toEqual([]);           // inside the 10 minutes: left alone
    await owner(db);
    await db.query("update cockpit_hours_watch_incidents set slack_claimed_at=now()-interval '11 minutes' where id=$1", [lost]);
    const swept = await applyOnce({});
    expect(swept.slackUnknown).toEqual([lost]);
    expect(await incident(lost)).toMatchObject({ slack_state: "unknown", slack_error: "No answer from Slack within 10 minutes; the post may have gone out" });
    expect((await incident(fresh)).slack_state).toBe("sending");
    expect((await auditRows("hours.watch.alerts")).at(-1)?.after).toMatchObject({ slackUnknown: [lost], opened: [], closed: [] });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: lost, which: "open" })).toBeNull();
    expect(await svc("cockpit_hours_watch_slack_result", { incidentId: lost, which: "open", state: "posted", ts: "1760425200.000001" })).toMatchObject({ ok: false });
    expect((await board()).open.find((o: { id: number }) => o.id === lost)).toMatchObject({ slackState: "unknown" });
    await svc("cockpit_hours_watch_slack_result", { incidentId: fresh, which: "open", state: "posted", ts: "1760425200.000002" });
    await applyOnce({ close: [{ id: lost, reason: "cleared" }, { id: fresh, reason: "cleared" }] });
    expect((await incident(lost)).resolve_state).toBe("none");           // no thread to reply in
    expect((await incident(fresh)).resolve_state).toBe("pending");
    ids.freshReply = fresh;
  });
  test("a reply still due rides in the inputs for 24 hours; claimed and never answered, it becomes unknown", async () => {
    const id = ids.freshReply;
    const now = new Date().toISOString();
    const due = (await inputs(now)).replies;
    expect(due.map(r => r.id)).toContain(id);
    expect(due.find(r => r.id === id)).toMatchObject({ kind: "not_work", slackTs: "1760425200.000002", resolveState: "pending",
      closeReason: "cleared", name: "Agent Exception", personId: ids["Agent Exception"] });
    expect((await inputs(now)).open.map(r => r.id)).not.toContain(id);
    expect((await inputs(new Date(Date.now() + 25 * 3600_000).toISOString())).replies.map(r => r.id)).not.toContain(id);
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "resolve" })).toMatchObject({ resolveState: "sending" });
    expect((await incident(id)).resolve_claimed_at).toBeInstanceOf(Date);
    expect((await inputs(now)).replies.map(r => r.id)).not.toContain(id);
    await owner(db);
    await db.query("update cockpit_hours_watch_incidents set resolve_claimed_at=now()-interval '11 minutes' where id=$1", [id]);
    expect((await applyOnce({})).slackUnknown).toEqual([id]);
    expect(await incident(id)).toMatchObject({ resolve_state: "unknown", slack_state: "posted",
      slack_error: "No answer from Slack within 10 minutes; the reply may have gone out" });
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "resolve" })).toBeNull();
  });
  test("a failed post is recorded on the alert and shown on the board", async () => {
    const fourth = (await applyOnce({ open: [{ personId: ids["Agent Exception"], kind: "idle" }] })).opened[0];
    await svc("cockpit_hours_watch_slack_claim", { incidentId: fourth, which: "open" });
    await svc("cockpit_hours_watch_slack_result", { incidentId: fourth, which: "open", state: "failed", error: "not_in_channel" });
    const b = await board();
    expect(b.sources.slack).toEqual({ state: "failing", note: "not_in_channel" });
    expect(b.open.find((o: { id: number }) => o.id === fourth)).toMatchObject({ slackState: "failed", slackError: "not_in_channel" });
    await applyOnce({ close: [{ id: fourth, reason: "cleared" }] });
  });
});

describe("review", () => {
  test("the CEO marks an alert reviewed, with an audit row", async () => {
    await owner(db);
    const id = Number((await db.query<{ id: number }>("select id from cockpit_hours_watch_incidents order by id limit 1")).rows[0].id);
    await actor(db, CEO);
    const r = await call(db, "cockpit_ceo_hours_watch_review", { incidentId: id, note: "Spoke to them" });
    expect(r).toMatchObject({ ok: true, id });
    expect(await incident(id)).toMatchObject({ reviewed_by: "aziz@maharamedia.com", review_note: "Spoke to them" });
    // review_2 finding 2: admins can read the audit log, so it records only that a note exists.
    const audit = (await auditRows("hours.watch.review")).at(-1)!;
    expect(audit).toMatchObject({ actor_email: "aziz@maharamedia.com", after: { incidentId: id, hasNote: true } });
    expect(audit.after).not.toHaveProperty("note");
    expect(JSON.stringify(await auditRows("hours.watch.review"))).not.toContain("Spoke to them");
    await actor(db, CEO);
    await call(db, "cockpit_ceo_hours_watch_review", { incidentId: id, note: "   " });
    expect((await auditRows("hours.watch.review")).at(-1)?.after).toEqual({ incidentId: id, personId: expect.anything(), kind: expect.any(String), hasNote: false });
    await actor(db, CEO);
    await expect(call(db, "cockpit_ceo_hours_watch_review", { incidentId: id, note: "n".repeat(301) })).rejects.toMatchObject({ code: "22023" });
    await expect(call(db, "cockpit_ceo_hours_watch_review", { incidentId: 999999 })).rejects.toMatchObject({ code: "22023" });
    await actor(db, MEMBER);
    await expect(call(db, "cockpit_ceo_hours_watch_review", { incidentId: id })).rejects.toMatchObject({ code: "42501" });
  });
});

describe("keys", () => {
  test("put saves, get returns it to the service only, the audit row never carries the key", async () => {
    await expect(svc("cockpit_hours_watch_key_put", { provider: "anthropic", secret: "k".repeat(20), savedBy: "aziz@maharamedia.com" })).rejects.toMatchObject({ code: "22023" });
    await expect(svc("cockpit_hours_watch_key_put", { provider: "google_ai", secret: "short", savedBy: "aziz@maharamedia.com" })).rejects.toMatchObject({ code: "22023" });
    await expect(svc("cockpit_hours_watch_key_put", { provider: "google_ai", secret: "AIza-made-up-key-0001", savedBy: "cron" })).rejects.toMatchObject({ code: "22023" });
    expect(await svc("cockpit_hours_watch_key_put", { provider: "google_ai", secret: "AIza-made-up-key-0001", savedBy: "aziz@maharamedia.com", state: "connected" }))
      .toEqual({ ok: true, last4: "0001", state: "connected" });
    await service(db);
    const got = (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_watch_key_get('google_ai') r")).rows[0].r;
    expect(got).toMatchObject({ provider: "google_ai", secret: "AIza-made-up-key-0001", last4: "0001", state: "connected" });
    expect((await db.query<{ r: unknown }>("select public.cockpit_hours_watch_key_get('openai') r")).rows[0].r).toBeNull();
    const audit = await auditRows("hours.watch.keySaved");
    expect(JSON.stringify(audit)).not.toContain("AIza-made-up-key-0001");
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "google_ai", note: null });
  });
  test("key_get returns savedAt, the key's version for the compare-and-swap", async () => {
    await owner(db);
    const saved = (await db.query<{ saved_at: Date }>("select saved_at from cockpit_hours_watch_keys where provider='google_ai'")).rows[0].saved_at;
    const got = await keyGet("google_ai");
    expect(typeof got.savedAt).toBe("string");
    expect(new Date(got.savedAt as string).getTime()).toBe(saved.getTime());
  });
  test("key_mark: the watch marks a saved key refused or connected again; never the key; one audit row per change", async () => {
    const savedAt = (await keyGet("google_ai")).savedAt as string;
    for (const bad of [{ provider: "anthropic", state: "refused", savedAt }, { provider: "google_ai", state: "unchecked", savedAt }, { provider: "google_ai", savedAt },
      { provider: "google_ai", state: "refused", note: 401, savedAt },
      // savedAt is required, and is the time key_get gave.
      { provider: "google_ai", state: "refused" }, { provider: "google_ai", state: "refused", savedAt: null },
      { provider: "google_ai", state: "refused", savedAt: 1760425200 }, { provider: "google_ai", state: "refused", savedAt: "yesterday" },
      { provider: "google_ai", state: "refused", savedAt: "2026-13-45T99:00:00Z" }])
      await expect(svc("cockpit_hours_watch_key_mark", bad)).rejects.toMatchObject({ code: "22023" });
    expect(await svc("cockpit_hours_watch_key_mark", { provider: "openai", state: "refused", note: "x", savedAt }))
      .toEqual({ ok: false, note: "No key is saved for that provider" });
    const note = "Google AI refused the key (API_KEY_INVALID)";
    expect(await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "refused", note, savedAt })).toEqual({ ok: true, provider: "google_ai", state: "refused" });
    await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "refused", note, savedAt });   // the next screenshot: no new audit row
    expect((await board()).sources.ai).toEqual({ state: "refused", provider: "google_ai", note });
    expect(await keyGet("google_ai")).toMatchObject({ secret: "AIza-made-up-key-0001", last4: "0001", state: "refused", stateNote: note,
      checkedAt: expect.any(String), savedAt });
    await expect(svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "refused", note: "bad key AIza-made-up-key-0001", savedAt }))
      .rejects.toMatchObject({ code: "22023" });
    // A savedAt that went through a JavaScript Date (milliseconds) still names the same key.
    await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "connected", savedAt: new Date(savedAt).toISOString() });
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "google_ai", note: null });
    const rows = await auditRows("hours.watch.keyState");
    expect(rows.map(r => r.after)).toEqual([{ provider: "google_ai", from: "connected", state: "refused", note },
      { provider: "google_ai", from: "refused", state: "connected", note: null }]);
    expect(rows.every(r => r.actor_email === "sync")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("AIza-made-up-key-0001");
  });
  test("key_mark is compare-and-swap: a key pasted during the run is never marked by the old key's failure", async () => {
    // recheck_4 defect C: the in-flight run's 401 for the old key marked the new key refused.
    const old = (await keyGet("google_ai")).savedAt as string;
    await svc("cockpit_hours_watch_key_put", { provider: "google_ai", secret: "AIza-made-up-key-0003", savedBy: "aziz@maharamedia.com", state: "connected" });
    const fresh = (await keyGet("google_ai")).savedAt as string;
    expect(new Date(fresh).getTime()).toBeGreaterThan(new Date(old).getTime());
    const audits = (await auditRows("hours.watch.keyState")).length;
    expect(await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "refused", note: "Google AI refused the key (401)", savedAt: old }))
      .toEqual({ ok: false, note: "The key changed during the run" });
    expect(await keyGet("google_ai")).toMatchObject({ secret: "AIza-made-up-key-0003", state: "connected", stateNote: null });
    expect((await auditRows("hours.watch.keyState")).length).toBe(audits);           // nothing written, no audit row
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "google_ai", note: null });
    // The run that read the new key can still mark it.
    expect(await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "refused", note: "Google AI refused the key (401)", savedAt: fresh }))
      .toMatchObject({ ok: true, state: "refused" });
    await svc("cockpit_hours_watch_key_mark", { provider: "google_ai", state: "connected", savedAt: fresh });
  });
  test("with an OpenAI key saved the board names OpenAI, the run's first choice", async () => {
    await svc("cockpit_hours_watch_key_put", { provider: "openai", secret: "sk-made-up-key-0002", savedBy: "aziz@maharamedia.com", state: "connected" });
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "openai", note: null });
  });
  test("a refused OpenAI key is skipped on the board as the run skips it: Google AI is named", async () => {
    // final check defect 1: the card said the OpenAI key was refused while the run checked screenshots with Google AI.
    const savedAt = (await keyGet("openai")).savedAt as string;
    await svc("cockpit_hours_watch_key_mark", { provider: "openai", state: "refused", note: "OpenAI answered 401.", savedAt });
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "google_ai", note: null });
    await svc("cockpit_hours_watch_key_mark", { provider: "openai", state: "connected", savedAt });
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "openai", note: null });
  });
});

describe("board", () => {
  test("the payload has every field the card reads", async () => {
    const b = await board();
    expect(Object.keys(b).sort()).toEqual(["cronOn", "lastRun", "now", "open", "people", "recent", "settings", "sources"]);
    expect(Object.keys(b.sources).sort()).toEqual(["ai", "hubstaff", "slack"]);
    expect(b.sources.hubstaff).toEqual({ state: "missing_key", note: "Hubstaff is not connected" });
    expect(b.cronOn).toBe(false);
    expect(b.lastRun).toMatchObject({ ok: true });
    expect(b.recent.length).toBeGreaterThan(0);
    expect(Object.keys(b.recent[0]).sort()).toEqual(["closeReason", "closedAt", "detail", "id", "kind", "name", "openedAt", "personId", "reviewedAt"]);
    const p = b.people.find((x: { personId: number }) => x.personId === ids["Agent On"]);
    expect(Object.keys(p).sort()).toEqual(["activePct30m", "lastActivityAt", "leave", "name", "offReason", "onBreak", "online", "personId", "readAt", "role",
      "screenshotsOn", "shiftEnd", "shiftStart", "shots", "since", "slots", "state", "trackedTodayS"]);
    expect([p.onBreak, p.leave]).toEqual([false, []]);
    expect(Object.keys(b.open[0] ?? { id: 0, personId: 0, name: 0, kind: 0, openedAt: 0, lastSeenAt: 0, detail: 0, slackState: 0, slackError: 0, reviewedAt: 0 }).sort())
      .toEqual(["detail", "id", "kind", "lastSeenAt", "name", "openedAt", "personId", "reviewedAt", "slackError", "slackState"]);
    expect(b.people.map((x: { name: string }) => x.name)).not.toContain("Agent Optional");
  });
  test("a fresh status shows; a stale one is never shown as working", async () => {
    const p = await person("Agent Always", "Call centre agent", { schedule: week({ off: [], start: "00:00", end: "23:59" }) });
    await link(p, "hubstaff", "hs-always");
    const at = new Date().toISOString();
    await applyOnce({
      statuses: [{ personId: p, state: "tracking", online: true, trackedTodayS: 1200, activePct30m: 40, screenshotsOn: true }],
      slots: [{ personId: p, slotStart: at, trackedS: 600, overallS: 240, inputTrackedS: 480, idle: false }],
      shots: [{ shotId: 7001, personId: p, hubstaffUserId: "hs-always", recordedAt: at, verdict: "not_work", label: "YouTube video", confidence: 0.9,
        thumbPath: "always/7001-thumb.jpg", fullPath: "always/7001.jpg" },
      { shotId: 7002, personId: p, hubstaffUserId: "hs-always", recordedAt: at, verdict: "work", label: "Dialer" }],
    });
    let row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect(row).toMatchObject({ state: "tracking", online: true, trackedTodayS: 1200, activePct30m: 40, screenshotsOn: true, offReason: null });
    expect(row.slots).toHaveLength(1);
    expect(Object.keys(row.slots[0]).sort()).toEqual(["idle", "inputTrackedS", "overallS", "start", "trackedS"]);
    expect(row.slots[0]).toMatchObject({ trackedS: 600, overallS: 240, inputTrackedS: 480 });
    expect(row.shots).toEqual([expect.objectContaining({ id: 7001, verdict: "not_work", label: "YouTube video", thumbPath: "always/7001-thumb.jpg" })]);
    await owner(db);
    await db.query("update cockpit_hours_watch_status set updated_at=now()-interval '20 minutes' where person_id=$1", [p]);
    row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect(row.state).toBe("cant_tell");
    expect(row.activePct30m).toBeNull();
  });
  test("on a break: the board passes onBreak with the time they stopped; a stale break is never shown", async () => {
    // recheck_3 finding 1 / recheck_4 defect B: an allowed lunch read "needs a look" on the card.
    const p = ids["Agent Always"];
    const stopped = new Date(Date.now() - 25 * 60_000).toISOString();
    await applyOnce({ statuses: [{ personId: p, state: "on_break", since: stopped, online: false }] });
    let row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect(row).toMatchObject({ state: "on_break", onBreak: true, offReason: null });
    expect(new Date(row.since).getTime()).toBe(new Date(stopped).getTime());
    await owner(db);
    await db.query("update cockpit_hours_watch_status set updated_at=now()-interval '20 minutes' where person_id=$1", [p]);
    row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect([row.state, row.onBreak]).toEqual(["cant_tell", false]);
    await applyOnce({ statuses: [{ personId: p, state: "tracking", online: true }] });
    expect((await board()).people.find((x: { personId: number }) => x.personId === p).onBreak).toBe(false);
  });
  test("part-day leave on the board: the windows ride along, and inside one the person is on leave whatever the last run said", async () => {
    const p = await person("Agent Always Leave", "Call centre agent", { schedule: week({ off: [], start: "00:00", end: "23:59" }) });
    await link(p, "hubstaff", "hs-always-leave");
    await link(p, "timetastic", "tt-always-leave");
    // Kuwait wall clock, half an hour either side of now.
    const kw = (ms: number) => new Date(Date.now() + 3 * 3600_000 + ms).toISOString().slice(0, 19).replace("T", " ");
    await owner(db);
    await db.query(`insert into cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,status,start_at,start_type,end_at,end_type,booking_unit)
      values('now-1','tt-always-leave','lt-1','Approved',$1,'Hours',$2,'Hours','Hours')`, [kw(-30 * 60_000), kw(30 * 60_000)]);
    await applyOnce({ statuses: [{ personId: p, state: "tracking", online: true }] });
    let row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect(row).toMatchObject({ state: "on_leave", offReason: null, onBreak: false });
    expect(row.leave).toHaveLength(1);
    expect(new Date(row.leave[0].end).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(row.leave[0].start).getTime()).toBeLessThanOrEqual(Date.now());
    // Marked not taken: back to the run's state, no window.
    await owner(db);
    await db.query(`insert into cockpit_time_adjustments(person_id,month,kind,booking_id,reason,set_by)
      values($1,date_trunc('month',now())::date,'not_booked','now-1','Came in after all','tests')`, [p]);
    row = (await board()).people.find((x: { personId: number }) => x.personId === p);
    expect([row.state, row.leave]).toEqual(["tracking", []]);
  });
  test("each person carries readAt from the status detail; a run that read nothing keeps it", async () => {
    const p = ids["Agent On"];
    const readAt = new Date().toISOString();
    const row = async () => (await board()).people.find((x: { personId: number }) => x.personId === p);
    await applyOnce({ statuses: [{ personId: p, state: "tracking", online: true, detail: { readAt } }] });
    expect((await row()).readAt).toBe(readAt);
    await applyOnce({ statuses: [{ personId: p, state: "off_shift", detail: { offReason: null } }] });
    expect((await row()).readAt).toBe(readAt);
    await owner(db);
    expect((await db.query<{ detail: unknown }>("select detail from cockpit_hours_watch_status where person_id=$1", [p])).rows[0].detail)
      .toEqual({ offReason: null, readAt });
    await applyOnce({ statuses: [{ personId: p, state: "tracking", detail: { readAt: "not a time" } }] });
    expect((await row()).readAt).toBeNull();
  });
  test("open and recent alerts keep the person's name, even for someone no longer watched", async () => {
    const p = ids["Video Editor"];
    const id = (await applyOnce({ open: [{ personId: p, kind: "not_tracking" }] })).opened[0];
    let b = await board();
    expect(b.people.map((x: { personId: number }) => x.personId)).not.toContain(p);
    expect(b.open.find((o: { id: number }) => o.id === id)).toMatchObject({ personId: p, name: "Video Editor" });
    await applyOnce({ close: [{ id, reason: "not_watched" }] });
    b = await board();
    expect(b.recent.find((o: { id: number }) => o.id === id)).toMatchObject({ personId: p, name: "Video Editor", closeReason: "not_watched" });
  });
  test("the screenshot check reads failing when the last 3 checked in the last hour all ended in error", async () => {
    // review_5 finding 2: a revoked key or retired models leave every screenshot in error while the key still reads connected.
    const p = ids["Agent On"];
    const base = Date.now();
    const shot = (shotId: number, verdict: string, ms: number, error?: string, category?: string) => ({ shotId, personId: p, hubstaffUserId: "hs-on",
      recordedAt: new Date(base + ms).toISOString(), verdict, attempts: 1, classifiedAt: new Date(base + ms).toISOString(), error,
      category: category ?? (verdict === "error" ? "model" : undefined) });
    await applyOnce({ shots: [shot(6001, "error", 1000, "Google AI answered 400"), shot(6002, "error", 2000, "Google AI answered 400")] });
    expect((await board()).sources.ai.state).toBe("connected");                       // 2 errors after a judged one: not yet
    // recheck_4 defect G: a failed download or an expired link says nothing about the key, so it neither counts nor breaks the run of model errors.
    await applyOnce({ shots: [shot(6010, "error", 2500, "The screenshot link expired", "download")] });
    expect((await board()).sources.ai.state).toBe("connected");
    await applyOnce({ shots: [shot(6003, "error", 3000, "OpenAI answered 404 for every model"), shot(6004, "skipped", 3500),
      shot(6011, "error", 3600, "Hubstaff answered 403 for the image", "download")] });
    expect((await board()).sources.ai).toEqual({ state: "failing", provider: "openai", note: "OpenAI answered 404 for every model" });
    await ceoSet({ shots: false });
    expect((await board()).sources.ai).toEqual({ state: "connected", provider: "openai", note: "The screenshot check is off" });
    await ceoSet({ shots: true });
    await applyOnce({ shots: [shot(6005, "work", 4000)] });
    expect((await board()).sources.ai.state).toBe("connected");
    await owner(db);
    await db.query("update cockpit_hours_watch_shots set verdict='error', error='old', classified_at=now()-interval '2 hours' where shot_id=6005");
    await db.query("update cockpit_hours_watch_shots set classified_at=now()-interval '61 minutes' where shot_id between 6001 and 6003");
    expect((await board()).sources.ai.state).toBe("connected");                       // errors older than an hour do not count
    await owner(db);
    await db.query("delete from cockpit_hours_watch_shots where shot_id between 6001 and 6011");
  });
  test("download errors alone, or model errors with no category, never read as the AI failing", async () => {
    const p = ids["Agent On"];
    const base = Date.now();
    const shot = (shotId: number, ms: number, category: string | null) => ({ shotId, personId: p, hubstaffUserId: "hs-on",
      recordedAt: new Date(base + ms).toISOString(), verdict: "error", attempts: 1, classifiedAt: new Date(base + ms).toISOString(),
      error: "Could not download the screenshot", category });
    await applyOnce({ shots: [shot(6101, 1000, "download"), shot(6102, 2000, "download"), shot(6103, 3000, "download"), shot(6104, 4000, null)] });
    expect((await board()).sources.ai.state).toBe("connected");
    await owner(db);
    await db.query("delete from cockpit_hours_watch_shots where shot_id between 6101 and 6104");
  });
  test("an open source alert says Hubstaff cannot be read, with its note", async () => {
    const r = await applyOnce({ open: [{ kind: "source", detail: { note: "Hubstaff refused the key (401)" } }] });
    expect((await board()).sources.hubstaff).toEqual({ state: "failing", note: "Hubstaff refused the key (401)" });
    await applyOnce({ close: [{ id: r.opened[0], reason: "cleared" }] });
  });
});

describe("prune", () => {
  test("old slots, shots and runs go; flagged images stay 90 days; the stored paths come back", async () => {
    const p = ids["Agent On"];
    await owner(db);
    await db.query(`insert into cockpit_hours_watch_slots(person_id,slot_start,tracked_s,overall_s) values($1,now()-interval '15 days',600,300),($1,now()-interval '13 days',600,300)`, [p]);
    await db.query(`insert into cockpit_hours_watch_shots(shot_id,person_id,hubstaff_user_id,recorded_at,verdict,thumb_path,full_path) values
      (8001,$1,'hs-on',now()-interval '31 days','work',null,null),
      (8002,$1,'hs-on',now()-interval '40 days','not_work','old/8002-thumb.jpg','old/8002.jpg'),
      (8003,$1,'hs-on',now()-interval '91 days','not_work','old/8003-thumb.jpg','old/8003.jpg')`, [p]);
    await db.query(`insert into cockpit_hours_watch_runs(started_at,finished_at,state,holder,lease_until) values(now()-interval '31 days',now()-interval '31 days','ok',gen_random_uuid(),now()-interval '31 days')`);
    // review_5 finding 8: the watch's own receipts go after 30 days; the hours read's Hubstaff and Slack receipts stay.
    await db.query(`insert into cockpit_hours_provider_health(provider,method,resource,phase,created_at) values
      ('google-ai','POST','v1beta/models/gemini-flash-latest','intent',now()-interval '31 days'),
      ('openai','POST','v1/responses','response',now()-interval '31 days'),
      ('storage','DELETE','object/cockpit-hours-watch','intent',now()-interval '31 days'),
      ('google-ai','POST','v1beta/models/gemini-flash-latest','intent',now()-interval '29 days'),
      ('hubstaff','GET','v2/organizations/1/activities','intent',now()-interval '31 days'),
      ('slack','POST','chat.postMessage','intent',now()-interval '31 days')`);
    await service(db);
    const r = (await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_watch_prune() r")).rows[0].r;
    expect(r).toMatchObject({ ok: true, slots: 1, shots: 2, runs: 1, receipts: 3, paths: ["old/8003-thumb.jpg", "old/8003.jpg"] });
    await owner(db);
    expect((await db.query("select shot_id from cockpit_hours_watch_shots where shot_id between 8001 and 8003")).rows).toEqual([{ shot_id: 8002 }]);
    expect(Number((await db.query<{ n: number }>("select count(*)::int n from cockpit_hours_watch_incidents")).rows[0].n)).toBeGreaterThan(0);
    expect((await auditRows("hours.watch.prune")).at(-1)?.after).toMatchObject({ slots: 1, shots: 2, runs: 1, receipts: 3, paths: 2 });
    await owner(db);
    expect((await db.query("select provider from cockpit_hours_provider_health order by created_at, provider")).rows.map(x => (x as { provider: string }).provider))
      .toEqual(["hubstaff", "slack", "google-ai"]);
  });
  test("the prune leaves its day in cockpit_sync_state, so the next run knows it is done today", async () => {
    await owner(db);
    expect((await db.query<{ ok: boolean; note: string; rows_seen: number }>(
      "select ok, note, rows_seen from cockpit_sync_state where key='hours-watch-prune'")).rows[0])
      .toEqual({ ok: true, note: "Removed old rows: blocks 1, screenshots 2, runs 1, receipts 3", rows_seen: 7 });
    expect((await inputs(new Date().toISOString())).lastPruneOn).toBe(kuwaitToday());
    await service(db);
    expect((await db.query<{ r: Record<string, unknown> }>("select public.cockpit_hours_watch_prune() r")).rows[0].r)
      .toMatchObject({ slots: 0, shots: 0, runs: 0, receipts: 0, paths: [] });
    await owner(db);
    expect((await db.query<{ note: string }>("select note from cockpit_sync_state where key='hours-watch-prune'")).rows[0].note)
      .toBe("Removed old rows: blocks 0, screenshots 0, runs 0, receipts 0");
  });
});

describe("storage: the private bucket and its CEO read policy", () => {
  test("object_allowed: the CEO and a recorded path only", async () => {
    const allowed = async (who: string | null, path: string) => {
      await actor(db, who);
      return (await db.query<{ ok: boolean }>("select public.cockpit_hours_watch_object_allowed($1) ok", [path])).rows[0].ok;
    };
    expect(await allowed(CEO, "2026-10-14/9001-thumb.jpg")).toBe(true);
    expect(await allowed(CEO, "2026-10-14/9001.jpg")).toBe(true);
    expect(await allowed(CEO, "2026-10-14/other.jpg")).toBe(false);
    expect(await allowed(MEMBER, "2026-10-14/9001-thumb.jpg")).toBe(false);
    expect(await allowed(ADMIN, "2026-10-14/9001-thumb.jpg")).toBe(false);
    await actor(db, null);
    await expect(db.query("select public.cockpit_hours_watch_object_allowed('2026-10-14/9001.jpg')")).rejects.toMatchObject({ code: "42501" });
  });
  test("with storage present, the bucket is private with its limits and objects read through the policy", async () => {
    await owner(db);
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT ON storage.objects TO anon, authenticated;`);
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    expect((await db.query("select id, public, file_size_limit, allowed_mime_types from storage.buckets")).rows).toEqual([
      { id: "cockpit-hours-watch", public: false, file_size_limit: 3145728, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }]);
    await db.query(`insert into storage.objects(bucket_id,name) values('cockpit-hours-watch','2026-10-14/9001-thumb.jpg'),('cockpit-hours-watch','stray/unknown.jpg')`);
    const seen = async (who: string | null) => {
      await actor(db, who);
      return (await db.query<{ name: string }>("select name from storage.objects order by name")).rows.map(r => r.name);
    };
    expect(await seen(CEO)).toEqual(["2026-10-14/9001-thumb.jpg"]);
    expect(await seen(MEMBER)).toEqual([]);
    expect(await seen(null)).toEqual([]);
  });
});

describe("migration and the 5-minute kick", () => {
  test("applies twice without touching the CEO's settings or the alerts", async () => {
    await ceoSet({ graceMinutes: 20 });
    await owner(db);
    const before = (await db.query<{ n: number }>("select count(*)::int n from cockpit_hours_watch_incidents")).rows[0].n;
    // A database that applied the file before the final round: the old state list and no input_tracked_s.
    await db.exec(`
      ALTER TABLE cockpit_hours_watch_status DROP CONSTRAINT cockpit_hours_watch_status_state_check;
      ALTER TABLE cockpit_hours_watch_status ADD CONSTRAINT cockpit_hours_watch_status_state_check
        CHECK (state IN ('tracking','not_tracking','idle','not_work','off_shift','on_leave','holiday','no_account','cant_tell'));
      ALTER TABLE cockpit_hours_watch_slots DROP COLUMN input_tracked_s;`);
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_constraint where conname='cockpit_hours_watch_status_state_check'")).rows[0].n).toBe(1);
    await applyOnce({ statuses: [{ personId: ids["Agent On"], state: "on_break" }],
      slots: [{ personId: ids["Agent On"], slotStart: "2026-10-14T12:00:00Z", trackedS: 600, overallS: 60, inputTrackedS: 300 }] });
    await owner(db);
    expect((await db.query("select input_tracked_s from cockpit_hours_watch_slots where person_id=$1 and slot_start='2026-10-14T12:00:00Z'",
      [ids["Agent On"]])).rows).toEqual([{ input_tracked_s: 300 }]);
    await applyOnce({ statuses: [{ personId: ids["Agent On"], state: "tracking" }] });
    await owner(db);
    expect((await db.query<{ n: number }>("select count(*)::int n from cockpit_hours_watch_incidents")).rows[0].n).toBe(before);
    expect((await board()).settings).toMatchObject({ graceMinutes: 20, mention: true, mentionUser: "U09305KE2KS" });
    await owner(db);
    const check = (await db.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conname='cockpit_hours_provider_health_provider_check'")).rows[0].def;
    for (const p of ["hubstaff", "hubstaff-auth", "timetastic", "slack", "google-ai", "openai", "storage"]) expect(check).toContain(`'${p}'`);
    expect((await db.query<{ column_name: string }>(`select column_name from information_schema.columns
      where table_name='cockpit_hours_watch_incidents' and column_name like '%claimed_at' order by 1`)).rows.map(r => r.column_name))
      .toEqual(["resolve_claimed_at", "slack_claimed_at"]);
  });
  test("against stub vault, net and cron: one job, a plain note without the secret, then the post", async () => {
    await owner(db);
    await db.exec(`
      CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
      CREATE SCHEMA net; CREATE TABLE net.calls(id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
      CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
        RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url,body,headers,timeout_milliseconds) VALUES(url,body,headers,timeout_milliseconds) RETURNING id $$;
      CREATE SCHEMA cron; CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
        $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command) RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=job_id RETURNING true $$;`);
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    await db.exec(migration("20261013d_cockpit_hours_watch.sql"));
    expect((await db.query("select jobname, schedule, command from cron.job")).rows).toEqual([
      { jobname: "mahara-hours-watch", schedule: "*/5 * * * *", command: "SELECT public.cockpit_hours_watch_kick();" }]);
    expect((await board()).cronOn).toBe(true);
    await owner(db);
    expect((await db.query<{ r: number | null }>("select public.cockpit_hours_watch_kick() r")).rows[0].r).toBeNull();
    expect((await db.query("select * from net.calls")).rows).toEqual([]);
    expect((await db.query<{ ok: boolean; note: string }>("select ok, note from cockpit_sync_state where key='hours-watch-kick'")).rows[0])
      .toEqual({ ok: false, note: "The vault has no cockpit_sync_secret, so the Hubstaff watch was not started. Add it to the vault." });
    await db.query("insert into vault.decrypted_secrets values ('cockpit_sync_secret','cron-secret-fixture')");
    await db.query("select public.cockpit_hours_watch_kick()");
    expect((await db.query("select url, body, headers, timeout_milliseconds from net.calls")).rows).toEqual([{
      url: "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-hours-watch", body: { job: "watch" },
      headers: { "Content-Type": "application/json", "x-cron-secret": "cron-secret-fixture" }, timeout_milliseconds: 5000 }]);
    expect((await db.query<{ ok: boolean }>("select ok from cockpit_sync_state where key='hours-watch-kick'")).rows[0].ok).toBe(true);
  });
});

describe("board: Slack status", () => {
  test("posts opened in one run are told apart by their claim time: a later post that went out wins over an earlier refusal", async () => {
    // final check defect 2: every alert opened in one apply shares opened_at, so the card picked one at random.
    await ceoSet({ on: true });
    const people = [await person("Slack One", "Call centre agent"), await person("Slack Two", "Call centre agent"), await person("Slack Three", "Media buyer")];
    const r = await applyOnce({ open: people.map(personId => ({ personId, kind: "not_tracking", detail: {} })) });
    expect(r.opened.length).toBe(3);
    const [first, ...rest] = [...r.opened].sort((a, b) => a - b);
    expect(await svc("cockpit_hours_watch_slack_claim", { incidentId: first, which: "open" })).not.toBeNull();
    await svc("cockpit_hours_watch_slack_result", { incidentId: first, which: "open", state: "failed", error: "not_in_channel" });
    let ts = 1760425200;
    for (const id of rest) {
      await svc("cockpit_hours_watch_slack_claim", { incidentId: id, which: "open" });
      await svc("cockpit_hours_watch_slack_result", { incidentId: id, which: "open", state: "posted", ts: `${ts++}.000100` });
    }
    expect((await board()).sources.slack).toEqual({ state: "ok", note: null });
  });
});
