// bun test supabase/functions/sales-api/m1_numbers_r4.test.ts
//
// Milestone 1, video-link round 4, NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only,
// Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
// auto_on_miss off, live off. What must hold on the video-link path:
//   - nothing books, marks or settles by itself;
//   - every room, send and mark leaves exactly one audit row;
//   - the room's own record (state, result, the join) says what happened.
//
// Round 4's angle: "That was not the lead" on a Meet room, and what the room
// then records when it closes. notLead (roomlogic.ts) moves lead_in back to
// host_in and keeps the taken-back join's time in lead_in_at as evidence
// (taken_back_join_at too); the view shows no join. The timers belong to the
// SQL sweep (cockpit_sales_rooms_close), simulated here word for word. The
// real lead then knocks at the Meet door just after the sweep's close, and
// the host presses "I can't let them in": knockAfterClose records the knock
// (result admit_blocked) only on a row whose lead_in_at is null, so a room
// with a taken-back join keeps "nobody joined" and makes no replacement.
// On Zoom (the worker makes every meeting with the waiting room on for
// people outside the account), the knock of the person let in and then taken
// back stays on the room (lead_waiting_at is set once, never cleared): the
// panel tells the closer the lead is in the waiting room, and the sweep's R4
// later closes the room "the lead knocked but was not let in" (not_admitted,
// admit_blocked; m1_numbers_r4.py case C on the live database).
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts. Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, panelLine, type RoomView } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-m1num4-lead-0001";
const SETTER = "setter-m1num4@stress.invalid";
const CLOSER = "closer-m1num4@stress.invalid";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEETING = "81234567890";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const PILOT_ROOMS = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  count_on_join: false,
  settle: false,
  wrap: false,
  short_link: false,
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
};

function world() {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; to: string; body: string }[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    // The WhatsApp gate shut, as in production today: the link goes by email.
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact: Row = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    return null as unknown as Row;
  });
  const msgRows = new Map<string, Row>();
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lane, requestId, to: String(extra.contact_id ?? ""), body });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room" }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        contact_id: t.contactId,
        source: "room",
      }),
    upcoming: async () => null,
    sentSince: async (_c, _since, text, channel) => {
      if (!text) return null;
      const hit = delivered.find(d => d.body === text && (channel === "email") === (d.lane === "email"));
      return hit ? { id: `ghl-${hit.requestId.slice(0, 8)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  async function workerOpens(id: string, run = "run-1", url = MEET_URL, meeting?: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: run }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.${run}`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: meeting ?? `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  /** A Meet room made from the lead page, opened by the worker, its link sent. */
  async function opened(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
    return id;
  }
  const mark = async (id: string, what: string, who: Who = setter) => {
    await rooms.actions["room.mark"]!(who, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  };
  /** A closer's Zoom room after a missed demo call, opened by the worker, its link sent. */
  async function openedZoom(): Promise<string> {
    const out = await rooms.actions["room.create"]!(closer, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    await workerOpens(id, "run-1", ZOOM_URL, MEETING);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
    return id;
  }
  /** One Zoom webhook for the room's meeting, stored by the door and passed to room.event. */
  async function zoom(id: string, event: string, participant: Row) {
    const eventId = fakeUuid();
    const at = new Date(w.clock.now).toISOString();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eventId,
        room_id: id,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${eventId}`,
        at,
        detail: {
          event,
          event_ts: w.clock.now,
          payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-closer", participant: { join_time: at, date_time: at, ...participant } } },
        },
      },
    ]);
    await rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: eventId, payload: {} });
    await w.flush();
  }
  /**
   * The SQL sweep's R4 close of a room whose lead did not come by lead_by,
   * word for word as cockpit_sales_rooms_close (20261003a) writes it:
   * state expired, end_reason lead_no_show,
   * result = coalesce(result, case when p_result = 'no_join' and contact_id is null then null else p_result end),
   * plus its room.sweep audit row (written in SQL, not through sales-api).
   */
  function sweepCloses(id: string) {
    const r = room(id);
    r.state = "expired";
    r.end_reason = "lead_no_show";
    r.result = r.result ?? (r.contact_id ? "no_join" : null);
    r.ended_at = w.db.iso();
    r.version = Number(r.version) + 1;
  }
  /** The room worker's status row, written again now (it reports at least every 30 s). */
  const heartbeat = () => {
    const r = w.db.t("cockpit_sales_worker_status").find(x => x.job === "rooms") as Row;
    r.at = new Date(w.clock.now - 5 * S).toISOString();
  };
  const ledger = (id: string) => audits.filter(a => a.entityId === id).map(a => String(a.action));
  const numbers = () => ({
    marks: marks.length,
    hl_writes: w.ghlCalls.filter(c => c.method !== "GET").length,
    dispositions: w.db.t("cockpit_sales_dispositions").length,
    appointments: w.db.t("cockpit_sales_appointments").length,
  });
  return { ...w, rooms, audits, delivered, room, opened, openedZoom, zoom, mark, sweepCloses, heartbeat, ledger, numbers };
}

async function answer(p: Promise<Row>): Promise<{ ok: Row | null; refused: ApiRefusal | null }> {
  try {
    return { ok: await p, refused: null };
  } catch (e) {
    if (e instanceof ApiRefusal) return { ok: null, refused: e };
    throw e;
  }
}

// ---------------------------------------------------------------------------

describe("control: a Meet room nobody joined, closed by the sweep, records no join", () => {
  test("control: I'm in, then the lead never came: the sweep's close leaves result no_join and the view no join", async () => {
    const w = world();
    const id = await w.opened();
    await w.mark(id, "host_in");
    w.clock.now += 12 * MIN;
    w.sweepCloses(id);
    expect(w.room(id).result).toBe("no_join");
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const view = st.room as Row;
    expect({ state: view.state, result: view.result, lead_in_at: view.lead_in_at }).toEqual({ state: "expired", result: "no_join", lead_in_at: null });
    expect(w.numbers()).toEqual({ marks: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });

  test("control: the lead knocked in Meet just after that close; I can't let them in records the knock and makes the Zoom replacement", async () => {
    const w = world();
    const id = await w.opened();
    await w.mark(id, "host_in");
    w.clock.now += 12 * MIN;
    w.sweepCloses(id);
    w.clock.now += 30 * S;
    w.heartbeat();
    const out = await answer(w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" }));
    expect(out.refused).toBeNull();
    expect(w.room(id).result).toBe("admit_blocked");
    expect({ replacement: Boolean(out.ok?.replacement), why: out.ok?.replacement_refusal ?? null }).toEqual({ replacement: true, why: null });
  });
});

describe("a join taken back by That was not the lead is no join: the knock after the close is still recorded", () => {
  test("the real lead never came and the sweep closed the room at lead_by: the closed room says nobody joined, not joined", async () => {
    const w = world();
    const id = await w.opened();
    await w.mark(id, "host_in");
    w.clock.now += 2 * MIN;
    await w.mark(id, "lead_in");
    w.clock.now += 1 * MIN;
    await w.mark(id, "not_lead");
    w.clock.now += 12 * MIN;
    w.sweepCloses(id);
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const view = st.room as Row;
    // The record and the panel's view: expired, nobody joined.
    expect({ state: view.state, result: view.result, lead_in_at: view.lead_in_at }).toEqual({ state: "expired", result: "no_join", lead_in_at: null });
    // Nothing booked or marked whatever the record says (count and settle are off).
    expect(w.numbers()).toEqual({ marks: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });

  test("the real lead knocked in Meet just after that close: I can't let them in records the knock and makes the replacement, as it does with no taken-back join", async () => {
    const w = world();
    const id = await w.opened();
    await w.mark(id, "host_in");
    w.clock.now += 2 * MIN;
    await w.mark(id, "lead_in");
    w.clock.now += 1 * MIN;
    await w.mark(id, "not_lead");
    w.clock.now += 12 * MIN;
    w.sweepCloses(id);
    w.clock.now += 30 * S;
    w.heartbeat();
    const out = await answer(w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" }));
    const said = String(out.ok?.replacement_refusal ?? out.refused?.message ?? "");
    expect({ replacement: Boolean(out.ok?.replacement), said, result: w.room(id).result }).toEqual({
      replacement: true,
      said: "",
      result: "admit_blocked",
    });
  });
});

describe("a knock Zoom's waiting room reported is over once that person was let in", () => {
  test("control: the lead knocked, the closer let them in, the call ran: the room is lead_in and the panel says the lead joined", async () => {
    const w = world();
    const id = await w.openedZoom();
    await w.zoom(id, "meeting.participant_joined", { id: "Z-closer", user_id: "1", user_name: "Sami Closer", email: CLOSER, participant_uuid: "pu-host" });
    expect(w.room(id).state).toBe("host_in");
    w.clock.now += 1 * MIN;
    await w.zoom(id, "meeting.participant_joined_waiting_room", { id: "", user_id: "", user_name: "Huda", participant_uuid: "pu-a" });
    expect(w.room(id).lead_waiting_at).toBeTruthy();
    w.clock.now += 20 * S;
    await w.zoom(id, "meeting.participant_joined", { id: "", user_id: "16778240", user_name: "Huda", participant_uuid: "pu-a" });
    expect(w.room(id).state).toBe("lead_in");
  });

  test("the one let in was not the lead (That was not the lead): the panel does not say the lead is in the waiting room, and nobody is recorded as knocking", async () => {
    const w = world();
    const id = await w.openedZoom();
    await w.zoom(id, "meeting.participant_joined", { id: "Z-closer", user_id: "1", user_name: "Sami Closer", email: CLOSER, participant_uuid: "pu-host" });
    w.clock.now += 1 * MIN;
    // The lead's assistant knocks, is let in, and is not the lead.
    await w.zoom(id, "meeting.participant_joined_waiting_room", { id: "", user_id: "", user_name: "Office", participant_uuid: "pu-a" });
    w.clock.now += 20 * S;
    await w.zoom(id, "meeting.participant_joined", { id: "", user_id: "16778240", user_name: "Office", participant_uuid: "pu-a" });
    w.clock.now += 1 * MIN;
    await w.mark(id, "not_lead", closer);
    expect(w.room(id).state).toBe("host_in");
    const st = await w.rooms.actions["room.status"]!(closer, { room_id: id });
    const line = panelLine(st.room as unknown as RoomView, { now: w.clock.now });
    // Nobody is waiting: the one who knocked was let in and taken back.
    expect({ moment: line.moment, knock_on_record: Boolean(w.room(id).lead_waiting_at) }).toEqual({ moment: "host_in", knock_on_record: false });
  });
});
