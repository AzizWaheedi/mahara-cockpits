// bun test supabase/functions/sales-api/stress2_providers_r5_rooms.test.ts
//
// Second series, round 5, provider quirks on sales-api's side. Each runs the
// real modules (rooms.ts, roomlogic.ts) on testfakes.ts with the providers'
// own answer shapes, the way index.ts and the door hand them on. A failing
// test is a finding; once fixed it stays as a regression test. Nothing leaves
// this process; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, roomCtx, roomsSetting, sweepRoom, type RoomRow } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-p5@stress.invalid";
const CLOSER = "closer-p5@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** How one send ends: it went, HighLevel still said "pending" when the read-back ended, or Meta failed it inside the read-back. */
type Outcome = "ok" | "pending" | { meta: string };

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  /** The contact's email in HighLevel; null when HighLevel has none. */
  email?: string | null;
  text?: Outcome;
  template?: Outcome;
  email_out?: Outcome;
}

function world(provider: "meet" | "zoom" = "meet") {
  const w = fakeWorld();
  const leads = new Map<string, Lead>();
  const jobs: Promise<unknown>[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l) return null as unknown as Row;
      const email = l.email === undefined ? `${id}@example.com` : l.email;
      return {
        contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", ...(email ? { email } : {}), tags: ["roas-qualified"], country: "KW" },
      };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  function addLead(l: Lead): void {
    leads.set(l.id, l);
    if (l.inboundAgoMs !== null)
      w.db.seed("cockpit_sales_inbox", [
        { conversation_id: `c-${l.id}`, contact_id: l.id, inbound_whatsapp_at: new Date(w.clock.now - l.inboundAgoMs).toISOString() },
      ]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  const delivered: { lead: string; lane: string }[] = [];
  const asked: { lead: string; lane: string }[] = [];
  /** index.ts convoSend / sendTemplate as they store their rows. */
  async function send(lane: "text" | "template" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    asked.push({ lead: contactId, lane });
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const l = leads.get(contactId);
    const o: Outcome = ((lane === "email" ? l?.email_out : l?.[lane]) as Outcome | undefined) ?? "ok";
    if (typeof o === "object") {
      row.state = "failed";
      row.provider_status = "failed";
      row.error = o.meta;
      return { message: { ...row } };
    }
    delivered.push({ lead: contactId, lane });
    row.ghl_message_id = `msg-${String(row.id).slice(0, 8)}`;
    if (o === "pending") {
      // convoSend: HighLevel answered "pending" on every read inside the
      // read-back, so the row is stored as sent (stateOf("sent")) with
      // provider_status "pending"; Meta decides afterwards.
      row.state = "sent";
      row.provider_status = "pending";
      return { message: { ...row } };
    }
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }
  const marks: Row[] = [];
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status });
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "written", note: null });
      return { crm: "written" };
    },
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, {}),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, t.contactId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  async function workerOpens(id: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: provider === "zoom" ? ZOOM_URL : MEET_URL,
        provider_meeting_id: provider === "zoom" ? "81234567890" : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function make(contactId: string): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider,
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    return String((out.room as Row).id);
  }
  async function opened(contactId: string): Promise<string> {
    const id = await make(contactId);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    return id;
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  /** The door's stored Zoom event (kept shape), then sales-api's room.event for it. */
  async function zoom(id: string, detail: Row, at: number) {
    const eventId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eventId,
        room_id: id,
        kind: `zoom.${String(detail.event)}`,
        source: "zoom",
        dedupe_key: `zoom:${String(detail.event)}:${eventId}`,
        at: new Date(at).toISOString(),
        text: `Zoom: ${String(detail.event)}.`,
        detail,
      },
    ]);
    await rooms.desk["room.event"]!(desk, { kind: `zoom.${String(detail.event)}`, event_id: eventId, payload: {} });
    await drain();
  }
  return { ...w, rooms, room, addLead, make, opened, workerOpens, tick, zoom, drain, delivered, asked, marks };
}

// ---------------------------------------------------------------------------
// 1. Meta's 131047 ("Re-engagement message": more than 24 hours since the
//    lead last wrote) on the room's free-text link, after the read-back.
//
// channelPlan picks the free text when the inbox copy says the lead wrote
// less than 24 hours ago (lib.ts whatsappWindow: open until exactly 24 h,
// no margin), and HighLevel takes a WhatsApp text as "pending"; Meta
// decides after. A lead who last wrote 23 h 59 m ago gets the text, Meta
// refuses it a few seconds later with 131047, and HighLevel's message reads
// "failed". The tick's recheckLink reads it failed and backs it up by email
// only. The call_link template, the one WhatsApp message Meta takes outside
// the window, is never tried: a lead with no email gets nothing, and the
// panel tells the rep to read the link out to a lead who just missed their
// call (this is a fallback room: nobody is on the phone).
// ---------------------------------------------------------------------------

describe("providers2 r5: Meta's 131047 on the free-text link", () => {
  test("window-shut-131047-never-falls-back-to-template", async () => {
    const w = world("zoom");
    const LEAD = "stress-p5-window-edge";
    // The lead wrote 23 h 40 m ago: the inbox copy says the window is open
    // (past the link's 15-minute margin, channelPlan), and Meta still refuses
    // the free text by the time it is delivered.
    w.addLead({ id: LEAD, inboundAgoMs: 24 * HOUR - 20 * 60 * S, email: null, text: "pending" });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels, "the plan chose the free text (the window read open)").toEqual(["whatsapp_text"]);
    // Meta's answer arrives after the read-back: 131047, the window shut.
    w.routes.unshift(async (m, p) => {
      if (m === "GET" && /^\/conversations\/messages\//.test(p))
        return {
          message: {
            id: "ghl-msg-131047",
            status: "failed",
            direction: "outbound",
            messageType: "TYPE_WHATSAPP",
            meta: { error: "Re-engagement message. Message failed to send because more than 24 hours have passed since the customer last replied to this number. (131047)" },
          },
        };
      return null as unknown as Row;
    });
    for (let i = 0; i < 3; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const lanes = w.asked.filter(d => d.lead === LEAD).map(d => d.lane);
    const lines = w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && e.kind === "link.failed_late")
      .map(e => String(e.text));
    expect(
      { templateTried: lanes.includes("template") },
      `Meta failed the free-text link with 131047 (the 24-hour window shut); the room's lanes after it: ${JSON.stringify(lanes)}, ` +
        `its line: ${JSON.stringify(lines)}. The call_link template, which Meta takes outside the window, was never tried, ` +
        "and the lead (no email in HighLevel) never got the link to the room made for their missed call",
    ).toEqual({ templateTried: true });
  });

  test("HELD (control): a lead with an email still gets the backup by email", async () => {
    const w = world("zoom");
    const LEAD = "stress-p5-window-edge-email";
    w.addLead({ id: LEAD, inboundAgoMs: 24 * HOUR - 20 * 60 * S, text: "pending" });
    const id = await w.opened(LEAD);
    w.routes.unshift(async (m, p) => {
      if (m === "GET" && /^\/conversations\/messages\//.test(p))
        return { message: { id: "ghl-msg-131047b", status: "failed", direction: "outbound", messageType: "TYPE_WHATSAPP", meta: { error: "(131047)" } } };
      return null as unknown as Row;
    });
    w.clock.now += 70 * S;
    await w.tick(id);
    expect(w.asked.filter(d => d.lead === LEAD).map(d => d.lane)).toContain("email");
  });
});

// ---------------------------------------------------------------------------
// 2. The host on two devices, or a Zoom reconnect.
//
// Zoom's participant events are per device and per session
// (participant_uuid), never per person: a host who joins on the laptop and
// then on the phone (or whose laptop drops and rejoins, Zoom's new session
// joining before it times the old one out) gets a participant_left for the
// first session AFTER the second joined, with a leave_time after the
// second's join_time. zoomEffect reads any host leave as host_left, and
// applyRoomEvent's only guard is "left before they last came in": this leave
// is after, so the room goes back to open while the host is in the meeting.
// No further join comes (the host never left in Zoom's eyes). A booked room
// carries host_by = start + 15 and lead_by = start + 20: the SQL sweep's R3
// closes the open room at host_by ("Closed: the host did not join in
// time.", result no_join) and the worker ends the started meeting, which has
// only the host in it, five minutes before the lead's own wait is over.
// ---------------------------------------------------------------------------

describe("providers2 r5: the host's second Zoom session leaves", () => {
  test("zoom-host-second-session-leave-reopens-room-and-closes-it-under-host", async () => {
    const w = world("zoom");
    const LEAD = "stress-p5-two-devices";
    w.addLead({ id: LEAD, inboundAgoMs: 3 * 24 * HOUR });
    const start = w.clock.now;
    const id = fakeUuid();
    // The closer's booked demo room (room.wrap's row: open, its own link, the booked deadlines).
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        code: "K7Q2MX",
        request_id: fakeUuid(),
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "booked",
        call_kind: "demo",
        provider: "zoom",
        host_email: CLOSER,
        made_by: CLOSER,
        state: "open",
        version: 1,
        join_url: ZOOM_URL,
        provider_meeting_id: "81234567890",
        requested_at: new Date(start - 2 * MIN).toISOString(),
        opened_at: new Date(start - 2 * MIN).toISOString(),
        host_by: new Date(start + 15 * MIN).toISOString(),
        lead_by: new Date(start + 20 * MIN).toISOString(),
        ends_at: new Date(start + 60 * MIN).toISOString(),
        link_sent_at: new Date(start - 60 * MIN).toISOString(),
        link_claimed_at: new Date(start - 60 * MIN).toISOString(),
        link_channels: ["whatsapp_template"],
        appointment_id: "demo-two-devices",
      },
    ]);
    const obj = (extra: Row) => ({ id: "81234567890", uuid: "inst-1==", host_id: "Z-closer", topic: "Mahara call K7Q2MX", ...extra });
    // 10:00:30 the closer starts the meeting on the laptop.
    w.clock.now = start + 30 * S;
    await w.zoom(id, { event: "meeting.started", event_ts: w.clock.now, payload: { object: obj({}) } }, w.clock.now);
    await w.zoom(
      id,
      {
        event: "meeting.participant_joined",
        event_ts: w.clock.now,
        payload: { object: obj({ participant: { id: "Z-closer", user_id: "16778240", user_name: "Omar Closer", email: CLOSER, participant_uuid: "sess-laptop", join_time: new Date(w.clock.now).toISOString() } }) },
      },
      w.clock.now,
    );
    expect(w.room(id).state).toBe("host_in");
    // 10:03:00 the laptop's network drops; Zoom rejoins the closer as a new
    // session at 10:03:05, and times the old one out at 10:03:40.
    w.clock.now = start + 3 * MIN + 5 * S;
    await w.zoom(
      id,
      {
        event: "meeting.participant_joined",
        event_ts: w.clock.now,
        payload: { object: obj({ participant: { id: "Z-closer", user_id: "16779264", user_name: "Omar Closer", email: CLOSER, participant_uuid: "sess-rejoin", join_time: new Date(w.clock.now).toISOString() } }) },
      },
      w.clock.now,
    );
    w.clock.now = start + 3 * MIN + 40 * S;
    await w.zoom(
      id,
      {
        event: "meeting.participant_left",
        event_ts: w.clock.now,
        payload: {
          object: obj({
            participant: { id: "Z-closer", user_id: "16778240", user_name: "Omar Closer", email: CLOSER, participant_uuid: "sess-laptop", leave_time: new Date(w.clock.now).toISOString(), leave_reason: "left the meeting. Reason : Network connection error. " },
          }),
        },
      },
      w.clock.now,
    );
    const after = { ...w.room(id) };
    // What the SQL sweep (the timers' one owner) does to that row at host_by + 1 minute; roomlogic's timers are its reference.
    const setting = roomsSetting((w.db.t("cockpit_sales_settings").find(s => s.key === "rooms") as Row).value);
    const swept = sweepRoom(after as unknown as RoomRow, start + 16 * MIN, roomCtx(setting));
    const closed = swept.ok && swept.changed ? { to: swept.to, result: (swept.patch as Row).result ?? null } : null;
    expect(
      { state: after.state, closedAt16: closed },
      `the closer is still in the meeting on the rejoined session (sess-rejoin, 10:03:05); the old session's leave (10:03:40) turned the ` +
        `room to ${String(after.state)} with host_by ${String(after.host_by)}, and at 10:16 the sweep closes it as ${JSON.stringify(closed)}: ` +
        "the worker then ends the started meeting (only the closer is in it) four minutes before the lead's own wait (lead_by 10:20) is over",
    ).toEqual({ state: "host_in", closedAt16: null });
  });

  test("HELD (control): the host's only session leaving still reopens the room", async () => {
    const w = world("zoom");
    const LEAD = "stress-p5-one-device";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    const t0 = w.clock.now;
    const obj = (extra: Row) => ({ id: "81234567890", uuid: "u1==", host_id: "Z-setter", ...extra });
    await w.zoom(
      id,
      { event: "meeting.participant_joined", event_ts: t0 + MIN, payload: { object: obj({ participant: { id: "Z-setter", email: SETTER, participant_uuid: "s1", join_time: new Date(t0 + MIN).toISOString() } }) } },
      t0 + MIN,
    );
    expect(w.room(id).state).toBe("host_in");
    w.clock.now = t0 + 2 * MIN;
    await w.zoom(
      id,
      { event: "meeting.participant_left", event_ts: t0 + 2 * MIN, payload: { object: obj({ participant: { id: "Z-setter", email: SETTER, participant_uuid: "s1", leave_time: new Date(t0 + 2 * MIN).toISOString() } }) } },
      t0 + 2 * MIN,
    );
    expect(w.room(id).state).toBe("open");
  });
});

// Keep the imports the file names in use when a test above is trimmed.
void ApiRefusal;
