/**
 * Review and referral asks (supabase/migrations/20261029170000_client_asks.sql,
 * docs/client-asks/PLAN.md) on an isolated PGlite with Supabase's default
 * privileges on. It stands on the real client gate, roster and seats of the
 * upsell harness, the real audit trigger, and a cut-down portal_data.workspaces
 * with the live column names (checked 2026-10-29). Every person and client is
 * invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import { SEATS, TASKS, upsellHelpers, upsellTestDb, uuid, type Row } from "./lib/upsellTestDb";

let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;
const FILE = "20261029170000_client_asks.sql";
const READ = "SELECT public.cockpit_csm_client_asks_read($1) r";
const SEND = "SELECT public.cockpit_csm_client_ask_send($1,$2,$3,$4,$5::uuid) r";
const WITHDRAW = "SELECT public.cockpit_csm_client_ask_withdraw($1,$2::uuid) r";
const FOR = "SELECT public.portal_client_ask_for_person($1,$2,$3,$4::uuid) r";
const RECORD = "SELECT public.portal_client_ask_record($1,$2,$3::uuid,$4,$5,$6::jsonb) r";
const CLAIM = "SELECT public.portal_client_asks_push_claim($1) r";
const DONE = "SELECT public.portal_client_ask_push_done($1::uuid,$2,$3,$4::jsonb) r";
const DISPLAY = "SELECT public.portal_client_ask_display($1,$2,$3::uuid,$4) r";
const PREVIEW = "SELECT public.portal_client_ask_preview($1,$2,$3) r";

const send = (kind: string, id: number, opts: { note?: string | null; push?: boolean; seat?: string; task?: string } = {}) =>
  h.one<Row>(opts.seat ?? SEATS.CSM_A, SEND, [opts.task ?? TASKS.A, kind, opts.note ?? null, opts.push ?? true, uuid(id)]);
const forPerson = (person: string, askId: string | null = null, loc = "locA", card: string = TASKS.A) =>
  h.svc<Row>(FOR, [loc, card, person, askId]);
const record = (askId: string, person: string, event: string, detail: Row = {}, loc = "locA", card: string = TASKS.A) =>
  h.svc<Row>(RECORD, [loc, card, askId, person, event, JSON.stringify(detail)]);
/** Moves a person's portal events on an ask back in time, as if days had passed. */
const age = (askId: string, person: string, hours: number) =>
  h.owner("UPDATE public.cockpit_client_ask_events SET at = at - make_interval(hours => $3) WHERE ask_id=$1 AND person=$2", [askId, person, hours]);

beforeAll(async () => {
  db = await upsellTestDb({ through: "base" });
  h = upsellHelpers(db);
  await h.asOwner();
  await db.exec(
    migration("20260926m_cockpit_csm_state.sql").match(/CREATE OR REPLACE FUNCTION public\.cockpit_audit_csm_state\(\)[\s\S]*?END \$\$;/)![0],
  );
  await db.exec(`
    CREATE SCHEMA portal_data;
    CREATE TABLE portal_data.workspaces(location_id text PRIMARY KEY, clickup_id text, name text, status text, language text);
    ALTER TABLE portal_data.workspaces ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON portal_data.workspaces FROM PUBLIC, anon, authenticated;
    INSERT INTO portal_data.workspaces VALUES ('locA','taskA1','Acme Interiors','Active',NULL), ('locB','taskB1','Beta Build','Cancelled',NULL);`);
  // Applied twice, as production may see it.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("the cockpit side", () => {
  test("only a seat with the client can read or send, and a client with no workspace says so", async () => {
    expect((await h.failure(SEATS.CSM_B, READ, [TASKS.A])).code).toBe("42501");
    expect((await h.failure(SEATS.BUYER, SEND, [TASKS.A, "review", null, true, uuid(1)])).code).toBe("42501");
    expect((await h.failure(null, READ, [TASKS.A])).code).toBe("42501");
    const cedar = await h.one<Row>(SEATS.CSM_ALL, READ, [TASKS.C]);
    expect(cedar.workspace).toBeNull();
    expect(cedar.problem).toBe("no_workspace");
    expect((await h.failure(SEATS.CSM_ALL, SEND, [TASKS.C, "review", null, true, uuid(2)])).message).toContain("no Mahara OS workspace");
    const beta = await h.one<Row>(SEATS.CSM_B, READ, [TASKS.B]);
    expect(beta.problem).toBe("workspace_closed");
    expect((await h.failure(SEATS.CSM_B, SEND, [TASKS.B, "referral", null, true, uuid(3)])).message).toContain("has left (Cancelled)");
  });

  test("a send names the seat, keeps the note, is idempotent and allows one open ask per kind", async () => {
    const v = await send("review", 10, { note: "  Thanks for a great   month!  " });
    expect(v.problem).toBeNull();
    expect(v.workspace.locationId).toBe("locA");
    const a = v.asks[0];
    expect(a).toMatchObject({ kind: "review", state: "open", note: "Thanks for a great month!", push: true, pushState: "waiting", askedBy: "Noura Al-Sabah" });
    expect(a.link).toBe("https://g.page/r/CeRMcUwFPpe7EAI/review");
    expect(a.events.map((e: Row) => e.event)).toEqual(["asked"]);
    // A retry of the same request returns the same ask, never a second one.
    expect((await send("review", 10)).asks.length).toBe(1);
    expect((await h.failure(SEATS.CSM_A, SEND, [TASKS.A, "referral", null, true, uuid(10)])).message).toContain("another ask");
    expect((await h.failure(SEATS.CSM_A2, SEND, [TASKS.A, "review", null, true, uuid(11)])).message).toContain("already waiting");
    expect((await h.failure(SEATS.CSM_A, SEND, [TASKS.A, "review", "x".repeat(281), true, uuid(12)])).code).toBe("22023");
    expect((await h.failure(SEATS.CSM_A, SEND, [TASKS.A, "upsell", null, true, uuid(13)])).code).toBe("22023");
    const both = await send("referral", 14, { push: false });
    expect(both.asks.map((x: Row) => [x.kind, x.pushState])).toEqual([["referral", "off"], ["review", "waiting"]]);
    const audits = await h.audits("cockpit_client_asks");
    expect(audits.filter(r => r.action === "INSERT").length).toBe(2);
    expect(audits[0].actor_email).toBe("csm-a@tests.invalid");
  });

  test("nobody but the server key reaches the tables or the portal functions", async () => {
    for (const seat of [SEATS.CSM_A, null]) {
      expect((await h.failure(seat, "SELECT * FROM public.cockpit_client_asks")).code).toBe("42501");
      expect((await h.failure(seat, FOR, ["locA", TASKS.A, "owner@acme.example", null])).code).toBe("42501");
      expect((await h.failure(seat, CLAIM, [5])).code).toBe("42501");
    }
    expect((await h.failure("service", READ, [TASKS.A])).code).toBe("42501");
    expect((await h.failure("service", "SELECT public.cockpit_client_ask_link('review')")).code).toBe("42501");
  });
});

describe("the portal side", () => {
  test("the oldest open ask shows once a day, a deep link opens it anyway, and a reload is not a second showing", async () => {
    const first = await forPerson("Owner@Acme.example");
    expect(first.ask).toMatchObject({ kind: "review", from: "Noura", note: "Thanks for a great month!", stage: "ask" });
    const review = first.ask.id;
    expect((await record(review, "owner@acme.example", "shown")).recorded).toBe(true);
    expect((await record(review, "OWNER@acme.example", "shown")).recorded).toBe(false);
    expect((await forPerson("owner@acme.example")).reason).toBe("shown_today");
    expect((await forPerson("owner@acme.example", review)).ask.id).toBe(review);
    // Another person in the same workspace keeps their own count.
    expect((await forPerson("partner@acme.example")).ask.id).toBe(review);
  });

  test("a review opened on Google comes back as one question, and a yes closes it for everyone", async () => {
    const review = (await h.owner<Row>("SELECT id FROM public.cockpit_client_asks WHERE kind='review'"))[0].id;
    await record(review, "owner@acme.example", "opened", { target: "google", via: "push", extra: "dropped" });
    await age(review, "owner@acme.example", 21);
    const again = await forPerson("owner@acme.example");
    expect(again.ask).toMatchObject({ id: review, stage: "confirm" });
    expect((await record(review, "owner@acme.example", "done")).state).toBe("done");
    expect((await forPerson("partner@acme.example")).ask?.kind).toBe("referral");
    const v = await h.one<Row>(SEATS.CSM_A, READ, [TASKS.A]);
    const closed = v.asks.find((x: Row) => x.kind === "review");
    expect(closed.state).toBe("done");
    expect(closed.closedBy).toBe("owner@acme.example");
    expect(closed.events.find((e: Row) => e.event === "opened").detail).toEqual({ target: "google", via: "push" });
    expect((await h.failure(SEATS.CSM_A, SEND, [TASKS.A, "review", null, true, uuid(20)])).message).toContain("posted a Google review already");
  });

  test("not now waits seven days, two showings is the most, and opening the programme answers a referral", async () => {
    const referral = (await h.owner<Row>("SELECT id FROM public.cockpit_client_asks WHERE kind='referral'"))[0].id;
    const p = "partner@acme.example";
    expect((await forPerson(p)).ask.id).toBe(referral);
    await record(referral, p, "shown");
    await record(referral, p, "later");
    await age(referral, p, 21);
    expect((await forPerson(p)).reason).toBe("nothing_waiting");
    await age(referral, p, 24 * 7);
    expect((await forPerson(p)).ask.id).toBe(referral);
    await record(referral, p, "shown");
    await age(referral, p, 21);
    expect((await forPerson(p)).reason).toBe("nothing_waiting");
    // A third person opens WhatsApp from it: answered for them, still open for the rest.
    const q = "site@acme.example";
    expect((await forPerson(q)).ask.id).toBe(referral);
    await record(referral, q, "opened", { target: "whatsapp" });
    expect((await forPerson(q, referral)).reason).toBe("nothing_waiting");
    expect((await h.svc<boolean>(DISPLAY, ["locA", TASKS.A, referral, "fourth@acme.example"]))).toBe(true);
    expect((await h.svc<Row>(PREVIEW, ["locA", TASKS.A, "referral"])).ask.id).toBe(referral);
    expect((await h.svc<Row>(PREVIEW, ["locA", TASKS.A, "review"])).ask).toBeNull();
  });

  test("answers stay in their workspace, and a withdrawn ask goes quiet", async () => {
    const referral = (await h.owner<Row>("SELECT id FROM public.cockpit_client_asks WHERE kind='referral'"))[0].id;
    expect((await h.failure("service", RECORD, ["locB", TASKS.B, referral, "x@beta.example", "shown", "{}"])).code).toBe("42501");
    expect((await h.failure("service", RECORD, ["locA", TASKS.A, referral, "x@beta.example", "done", "{}"])).code).toBe("22023");
    expect((await h.failure("service", RECORD, ["locA", TASKS.A, referral, "not an email", "shown", "{}"])).code).toBe("22023");
    const v = await h.one<Row>(SEATS.CSM_A2, WITHDRAW, [TASKS.A, referral]);
    expect(v.asks.find((x: Row) => x.id === referral)).toMatchObject({ state: "withdrawn", closedBy: "csm-a2@tests.invalid" });
    expect((await forPerson("fourth@acme.example", referral)).reason).toBe("nothing_waiting");
    expect((await record(referral, "fourth@acme.example", "opened")).recorded).toBe(false);
    expect(await h.svc<boolean>(DISPLAY, ["locA", TASKS.A, referral, "fourth@acme.example"])).toBe(false);
    // A fresh referral may go out once the old one is withdrawn.
    expect((await send("referral", 30)).asks[0]).toMatchObject({ kind: "referral", state: "open" });
  });

  test("phone alerts are claimed under a lease, reported as counts, and never sent a day late", async () => {
    const claimed = await h.svc<Row[]>(CLAIM, [10]);
    expect(claimed.map(c => [c.kind, c.locationId, c.clickupId, c.from])).toEqual([["referral", "locA", TASKS.A, "Noura"]]);
    expect(await h.svc<Row[]>(CLAIM, [10])).toEqual([]);
    const done = await h.svc<Row>(DONE, [claimed[0].id, "locA", "no_device", JSON.stringify({ devices: 0, accepted: 0.4, reason: "no_task_alerts", email: "leak@x" })]);
    expect(done).toMatchObject({ pushState: "no_device", recorded: true });
    expect((await h.svc<Row>(DONE, [claimed[0].id, "locA", "sent", "{}"])).recorded).toBe(false);
    const v = await h.one<Row>(SEATS.CSM_A, READ, [TASKS.A]);
    expect(v.asks[0].pushResult).toEqual({ devices: 0, accepted: 0, reason: "no_task_alerts" });
    // An alert still waiting after a day is marked failed, not sent.
    await h.owner("UPDATE public.cockpit_client_asks SET push_state='waiting', asked_at = now() - interval '25 hours' WHERE id=$1", [claimed[0].id]);
    expect(await h.svc<Row[]>(CLAIM, [10])).toEqual([]);
    expect((await h.owner<Row>("SELECT push_state, push_result FROM public.cockpit_client_asks WHERE id=$1", [claimed[0].id]))[0])
      .toEqual({ push_state: "failed", push_result: { reason: "not_sent_within_a_day" } });
  });

  test("an ask closes itself after 30 days and a new one may follow", async () => {
    await h.owner("UPDATE public.cockpit_client_asks SET asked_at = now() - interval '31 days' WHERE kind='referral' AND state='open'");
    expect((await forPerson("new@acme.example")).reason).toBe("nothing_waiting");
    const v = await h.one<Row>(SEATS.CSM_A, READ, [TASKS.A]);
    expect(v.asks.filter((x: Row) => x.kind === "referral").map((x: Row) => x.state)).toContain("expired");
    expect((await send("referral", 40)).asks[0]).toMatchObject({ kind: "referral", state: "open" });
  });
});
