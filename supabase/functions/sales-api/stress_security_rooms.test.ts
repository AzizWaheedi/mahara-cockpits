// bun test supabase/functions/sales-api/stress_security_rooms.test.ts
//
// Security and abuse stress of sales-api's live-call actions, round 1,
// 3 October 2026: one seat reading or acting on another rep's room, the host
// link (start_url, zak) reaching anyone but its host, forged room.event
// calls, injection through every free-text field, and floods a seat can
// start. Each `test` held when written; each `test.failing` pins a confirmed
// finding (its key is in its name) and goes red when the fix lands, so the
// fix flips it to `test`. Against testfakes.ts; no network.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, meetingFromAddress, ROOM_VIEW_KEYS } from "./roomlogic.ts";
import { eventText, makeRooms, ROOMS_COPY, type RoomDeps, seatRequestId } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOST = "stress-host@stress.invalid";
const OTHER = "stress-other@stress.invalid";
const LEAD = "stress-lead-1";
const LEAD2 = "stress-lead-2";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const START_URL = "https://us06web.zoom.us/s/81234567890?zak=eyJhbGciOiJIUzI1NiJ9.stresshost.sig";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host" };
const other: Who = { signed_in: true, seat: true, manager: false, email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup(o: { rooms?: Row; live?: Row; tags?: string[] } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const texts: Row[] = [];
  const templates: Row[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host", active: true },
    { email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  w.routes.push((m, p) =>
    m === "GET" && (p === `/contacts/${LEAD}` || p === `/contacts/${LEAD2}`)
      ? { contact: { id: p.split("/")[2], firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: o.tags ?? [], country: "KW" } }
      : (null as unknown as Row),
  );
  const seen = new Map<string, Row>();
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: async (who, b, opts) => {
      const again = seen.get(b.request_id);
      if (again) return { message: again, repeated: true };
      texts.push({ who: who.email, ...b, ...opts });
      const m = { id: fakeUuid(), state: "sent", provider_status: "sent" };
      seen.set(b.request_id, m);
      return { message: m };
    },
    sendTemplate: async (who, t) => {
      const again = seen.get(t.requestId);
      if (again) return { message: again, repeated: true };
      templates.push({ who: who.email, ...t });
      const m = { id: fakeUuid(), state: "sent", provider_status: "sent" };
      seen.set(t.requestId, m);
      return { message: m };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** A room of HOST's, opened as the worker opens one, with its host link stored. */
  function seedOpen(over: Row = {}): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "manual",
        call_kind: "demo",
        provider: "zoom",
        host_email: HOST,
        made_by: HOST,
        state: "open",
        join_url: ZOOM_URL,
        provider_meeting_id: "81234567890",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
        version: 3,
        ...over,
      },
    ]);
    w.db.seed("cockpit_sales_room_secrets", [{ room_id: id, start_url: START_URL, expires_at: new Date(w.clock.now + 2 * 3_600_000).toISOString() }]);
    return id;
  }
  return { ...w, rooms, audits, texts, templates, marks, room, seedOpen };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

/** Every place a host link could leak to: rows seats can read, audit rows, logs. */
function seatVisible(w: ReturnType<typeof setup>): string {
  return JSON.stringify([w.db.t("cockpit_sales_rooms"), w.db.t("cockpit_sales_room_events"), w.audits, w.logs, w.texts, w.templates]);
}

// ---------------------------------------------------------------------------

describe("security: another rep's room", () => {
  test("room.open by any seat but the host is refused with no link at all, and leaves no trace of the host link", async () => {
    const w = setup();
    const id = w.seedOpen();
    const r = await refused(w.rooms.actions["room.open"]!(other, { room_id: id }));
    expect([r.status, r.extra.code]).toEqual([403, "not_host"]);
    expect(JSON.stringify({ message: r.message, extra: r.extra })).not.toMatch(/zoom\.us|zak=|https?:/);
    // A manager is not the host either: the host link is the host's own login.
    const boss = { ...other, manager: true };
    expect((await refused(w.rooms.actions["room.open"]!(boss, { room_id: id }))).extra.code).toBe("not_host");
    expect(seatVisible(w)).not.toContain("zak=");
  });

  test("the host gets the start link; it is never written to a row a seat can read, an audit row or a log", async () => {
    const w = setup();
    const id = w.seedOpen();
    const out = await w.rooms.actions["room.open"]!(host, { room_id: id });
    expect(out.start_url).toBe(START_URL);
    expect(seatVisible(w)).not.toContain("zak=");
    expect(seatVisible(w)).not.toContain("/s/81234567890");
  });

  test("room.mark, room.end and room.send by another non-manager seat are refused and change nothing", async () => {
    const w = setup();
    const id = w.seedOpen();
    const before = JSON.stringify(w.room(id));
    const v = Number(w.room(id).version);
    for (const what of ["host_in", "lead_in", "not_lead"])
      expect((await refused(w.rooms.actions["room.mark"]!(other, { room_id: id, version: v, what }))).extra.code).toBe("not_host");
    for (const reason of ["end", "on_phone", "finished", "cancel", "admit_blocked"])
      expect((await refused(w.rooms.actions["room.end"]!(other, { room_id: id, version: v, reason, confirm: true }))).extra.code).toBe("not_host");
    expect((await refused(w.rooms.actions["room.send"]!(other, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }))).extra.code).toBe("not_host");
    await w.flush();
    expect(JSON.stringify(w.room(id))).toBe(before);
    expect(w.texts.length + w.templates.length).toBe(0);
  });

  test("room.status of any room carries no host link, even with the secret stored and a link in an event's text", async () => {
    const w = setup();
    const id = w.seedOpen({ error: `Zoom said: start at ${START_URL} failed`, refusal: `see ${START_URL}` });
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "worker.held", source: "worker", dedupe_key: `x:${id}`, handled_at: w.db.iso(), text: `Host link ${START_URL} kept`, detail: {} },
    ]);
    const out = await w.rooms.actions["room.status"]!(other, { room_id: id });
    const s = JSON.stringify(out);
    expect(s).not.toContain("zak=eyJ");
    expect(s).not.toContain("stresshost");
    expect(Object.keys(out.room as Row).sort()).toEqual([...ROOM_VIEW_KEYS].sort());
  });

  test("a request id another rep used never hands their room over (room.create and room.wrap)", async () => {
    // A seat's request id is stored hashed with its email (final review), so
    // the same id from another seat is that seat's own press: its own room,
    // never the first rep's, whether the first room's id was stored raw (a
    // server-made id) or as the first rep's own.
    for (const stored of ["raw", "seat"] as const) {
      const w = setup();
      const rid = crypto.randomUUID();
      const id = w.seedOpen({ request_id: stored === "raw" ? rid : await seatRequestId(host, rid) });
      const out = await w.rooms.actions["room.create"]!(other, { request_id: rid, contact_id: LEAD2, provider: "meet", call_kind: "intro", purpose: "manual" });
      const r = out.room as Row;
      expect(r.id).not.toBe(id);
      expect(r.host_email).toBe(OTHER);
      expect(r.contact_id).toBe(LEAD2);
    }
  });

  test("a handover room needs a handover this seat holds; another seat's claim does not count", async () => {
    const w = setup({ live: { enabled: true } });
    w.db.seed("cockpit_sales_live", [
      { id: fakeUuid(), request_id: fakeUuid(), contact_id: LEAD, asked_by: OTHER, kind: "demo", reason: "on_call", state: "claimed", claimed_by: HOST, offered_to: [HOST], offer_until: new Date(w.clock.now + MIN).toISOString() },
    ]);
    const r = await refused(w.rooms.actions["room.create"]!(other, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "demo", purpose: "handover" }));
    expect(r.status).toBe(409);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
  });

  test("an offer that was never made to this seat cannot be taken", async () => {
    const w = setup({ live: { enabled: true } });
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id, request_id: fakeUuid(), contact_id: LEAD, asked_by: OTHER, kind: "demo", reason: "on_call", state: "offered", offered_to: ["stress-third@stress.invalid"], offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    const r = await refused(w.rooms.actions["live.take"]!(host, { live_id: id, request_id: crypto.randomUUID() }));
    expect(r.status).toBe(409);
    expect((w.db.t("cockpit_sales_live")[0] as Row).state).toBe("offered");
  });

  test("the desk's actions are not in the seat list: a seat cannot post room.event, live.press, thread.tick or reply.seen", () => {
    const w = setup();
    for (const a of ["room.event", "live.press", "thread.tick", "reply.seen", "followup.send_due"]) expect(w.rooms.actions[a]).toBeUndefined();
    expect(Object.keys(w.rooms.desk).sort()).toEqual(["live.press", "reply.seen", "room.event", "thread.tick"]);
  });
});

describe("security: forged room.event calls (the desk key or the cron secret)", () => {
  test("a Zoom kind with an event id that was never stored, or one already handled, changes nothing: the stored row is the only truth", async () => {
    const w = setup();
    const id = w.seedOpen();
    const handled = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: handled,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: "zoom:handled",
        handled_at: w.db.iso(),
        detail: { event: "meeting.participant_joined", payload: { object: { id: "81234567890", participant: { user_name: "x", join_time: w.db.iso() } } } },
      },
    ]);
    for (const event_id of [fakeUuid(), handled]) {
      const out = await w.rooms.desk["room.event"]!(desk, {
        kind: "zoom.meeting.participant_joined",
        event_id,
        room_id: id,
        // A forged body: room.event must never read the Zoom payload from the caller.
        payload: { event: "meeting.participant_joined", payload: { object: { id: "81234567890", participant: { user_name: "Lead", join_time: w.db.iso() } } } },
      });
      expect(out.handled).toBe(false);
    }
    expect(w.room(id).state).toBe("open");
  });

  test("worker.ready for a room with no stored worker.ready event sends nothing", async () => {
    const w = setup();
    const id = w.seedOpen();
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "forged" } });
    await w.flush();
    expect(out.handled).toBe(false);
    expect(w.texts.length + w.templates.length).toBe(0);
    expect(w.room(id).link_claimed_at ?? null).toBeNull();
  });

  test("ids that are not UUIDs (or filter syntax) are refused before any read", async () => {
    const w = setup();
    for (const b of [
      { kind: "tick", payload: { room_ids: ["x&state=eq.open"] } },
      { kind: "sweep.settle", payload: { room_ids: [`${fakeUuid()},id.neq.0`] } },
      { kind: "sweep.replay", payload: { event_ids: Array.from({ length: 51 }, () => fakeUuid()) } },
      { kind: "zoom.meeting.participant_joined", event_id: "1 or 1=1" },
      { kind: "worker.ready", room_id: "../../rooms" },
      { kind: "anything.else" },
    ]) {
      const r = await refused(w.rooms.desk["room.event"]!(desk, b));
      expect(r.status).toBe(400);
    }
  });
});

describe("security: injection through free text", () => {
  test("a contact id, appointment id or attempt id full of PostgREST and URL syntax is always sent encoded", async () => {
    const w = setup();
    const evil = "stress-x&state=eq.ended,id.neq.0)/../contacts?y=\"'";
    await refused(
      w.rooms.actions["room.create"]!(host, {
        request_id: crypto.randomUUID(),
        contact_id: evil,
        provider: "zoom",
        call_kind: "demo",
        purpose: "manual",
        appointment_id: evil,
        attempt_id: evil,
        trigger: "manual&x=1",
      }),
    ).catch(() => null);
    for (const c of w.db.calls) {
      const q = c.path.indexOf("?");
      if (q < 0) continue;
      for (const part of c.path.slice(q + 1).split("&")) expect([c.path, part.includes("state=eq.ended")]).toEqual([c.path, false]);
    }
    for (const g of w.ghlCalls) expect(g.path).not.toContain("/../");
  });

  test("a booked call's address never gives the room a host link, a lookalike host or a script", () => {
    for (const address of [
      START_URL,
      "https://us06web.zoom.us/j/81234567890?pwd=x&zak=eyJstress",
      "https://us06web.zoom.us/j/81234567890?ZAK=eyJstress",
      "https://us06web.zoom.us/wc/81234567890/start?zak=x",
      "https://zoom.us.evil.example/j/81234567890",
      "https://evilzoom.us/j/81234567890",
      "javascript:alert(1)//https://zoom.us/j/1",
      "https://meet.google.com.evil.example/abc-defg-hij",
    ]) {
      const m = meetingFromAddress(address);
      const host = m ? new URL(m.join_url).hostname : null;
      expect([address, m === null || /zoom\.us$|^meet\.google\.com$/.test(String(host))]).toEqual([address, true]);
      expect([address, String(m?.join_url ?? "")]).not.toEqual([address, expect.stringMatching(/zak=|\/s\/|\/start/i)]);
    }
  });

  test("a timeline line is cleaned of keys and host links before any seat reads it", () => {
    const t = eventText({ text: `Zoom said ${START_URL} and Bearer abc.def.ghi token=xyz` });
    expect(t).not.toContain("eyJhbGciOiJIUzI1NiJ9.stresshost.sig");
    expect(t).not.toContain("token=xyz");
  });
});

describe("abuse: what one seat can make happen many times", () => {
  test("standby-flood: pressing Available and Away over and over does not make a new Zoom meeting every time", async () => {
    // Every Available asks for a standby room with request id
    // mahara-room/standby/{email}/{until}, and `until` moves with the clock,
    // so each press is a new room, a new Zoom meeting on the host's own user
    // (Zoom caps meeting creates per user per day). Away ends it; Available
    // makes the next one. Twenty presses a few seconds apart:
    const w = setup({ live: { enabled: true } });
    for (let i = 0; i < 20; i++) {
      await w.rooms.actions["live.availability"]!(host, { state: "available" });
      w.clock.now += 3_000;
      await w.rooms.actions["live.availability"]!(host, { state: "away" });
      w.clock.now += 3_000;
    }
    const made = w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby").length;
    expect(made).toBeLessThanOrEqual(3);
  });

  test("standby-flood (the strip): Available right after Away says why no room was made, and ten minutes on a new one is made", async () => {
    const w = setup({ live: { enabled: true } });
    await w.rooms.actions["live.availability"]!(host, { state: "available" });
    await w.rooms.actions["live.availability"]!(host, { state: "away" });
    w.clock.now += 60_000;
    const again = await w.rooms.actions["live.availability"]!(host, { state: "available" });
    expect(again.standby_error).toBe(ROOMS_COPY.standby_flood);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby")).toHaveLength(1);
    await w.rooms.actions["live.availability"]!(host, { state: "away" });
    w.clock.now += 10 * 60_000;
    const later = await w.rooms.actions["live.availability"]!(host, { state: "available" });
    expect(later.standby_error ?? null).toBeNull();
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby")).toHaveLength(2);
  });

  test("email-resend-unbounded: Also send by email goes at most once or twice per room, whatever the presses", async () => {
    // room.send keys the email on the rep's own request id, and a new press
    // is a new id: nothing caps how often the lead is emailed the link.
    const w = setup();
    const id = w.seedOpen({ link_sent_at: new Date().toISOString(), link_channels: ["whatsapp_text"] });
    for (let i = 0; i < 15; i++)
      await w.rooms.actions["room.send"]!(host, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }).catch(() => null);
    expect(w.texts.filter(t => t.channel === "email").length).toBeLessThanOrEqual(2);
  });

  test("manual-lead-in-books-shows: a hand-pressed 'The lead is in' on a room the lead never opened does not book and mark a show", async () => {
    // With count_on_join on, "The lead is in" runs the same count as a Zoom
    // join: a Live booking marked showed in HighLevel (a show for the
    // rep's numbers and pay). On Meet nothing can check it (no join
    // events, no participant report). A rep can press it on a room whose
    // link the lead never opened (first_open_at null, no knock):
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL" }, tags: ["roas-qualified"] });
    w.routes.push((m, p) => {
      if (m === "POST" && p === "/calendars/events/appointments") return { id: "stress-live-appt" };
      if (m === "PUT") return { ok: true };
      return null as unknown as Row;
    });
    const id = w.seedOpen({ provider: "meet", join_url: MEET_URL, provider_meeting_id: "stress-evt", state: "host_in", host_in_at: w.db.iso(), first_open_at: null });
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    const showed = w.ghlCalls.filter(c => c.method === "PUT" && JSON.stringify(c.body).includes("showed"));
    expect(showed).toHaveLength(0);
  });
});
