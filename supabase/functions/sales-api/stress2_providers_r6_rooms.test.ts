// bun test supabase/functions/sales-api/stress2_providers_r6_rooms.test.ts
//
// Second series, round 6, provider quirks on sales-api's side. Each runs the
// real modules (rooms.ts, roomlogic.ts) on testfakes.ts with the providers'
// own answer shapes, the way index.ts and the door hand them on. A failing
// test is a finding; once fixed it stays as a regression test. Nothing leaves
// this process; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-p6@stress.invalid";
const CLOSER = "closer-p6@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** How one send ends: it went, HighLevel still said "pending" when the read-back ended, or Meta failed it inside the read-back. */
type Outcome = "ok" | "pending" | "unclear" | { meta: string };

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
    if (o === "unclear") {
      // HighLevel answered the send with a 502 after it had taken it (or the
      // call timed out): convoSend stores "unclear" and throws may-have-gone.
      delivered.push({ lead: contactId, lane });
      row.state = "unclear";
      row.error = "HighLevel said 502: Bad Gateway";
      throw new ApiRefusal(`The send may have gone; read the conversation in HighLevel before writing to the lead again (${String(row.error)})`, 502, { unclear: true });
    }
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
// 1. Zoom delivers meeting.started after meeting.ended (out of order).
//
// Zoom does not order its webhooks, and a delivery the door could not store
// (a 503 while the database blipped) is retried 5, 20 and 60 minutes later;
// one the door stored but could not pass on is replayed by the sweep a
// minute later. The setter starts the room's meeting at 10:01 and leaves at
// 10:02, and Zoom ends the empty meeting. The join, the leave and the end
// arrive in time; meeting.started (event_ts 10:01) arrives at 10:03. The
// room had gone back to open (the host's 120 s to come back, meeting_ended_at
// kept), and the late start, older than the meeting's end, puts it back to
// host_in with host_in_at 10:01: the panel says "You are in" while Zoom's
// meeting is over, the host's 120 s never run, and the sweep no longer
// closes the room on host_by.
// ---------------------------------------------------------------------------

describe("providers2 r6: Zoom's meeting.started delivered after meeting.ended", () => {
  const obj = (extra: Row) => ({ id: "81234567890", uuid: "inst-1==", host_id: "Z-setter", topic: "Mahara call K7Q2MX", ...extra });
  const hostP = (extra: Row) => ({ id: "Z-setter", user_id: "16778240", user_name: "Tara Setter", email: SETTER, participant_uuid: "sess-1", ...extra });

  test("HELD (control): in Zoom's own order the room is back to open after the meeting ends", async () => {
    const w = world("zoom");
    const LEAD = "stress-p6-late-start-control";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    const t0 = w.clock.now;
    w.clock.now = t0 + MIN;
    await w.zoom(id, { event: "meeting.started", event_ts: t0 + MIN, payload: { object: obj({}) } }, t0 + MIN);
    await w.zoom(id, { event: "meeting.participant_joined", event_ts: t0 + MIN, payload: { object: obj({ participant: hostP({ join_time: new Date(t0 + MIN).toISOString() }) }) } }, t0 + MIN);
    w.clock.now = t0 + 2 * MIN;
    await w.zoom(id, { event: "meeting.participant_left", event_ts: t0 + 2 * MIN, payload: { object: obj({ participant: hostP({ leave_time: new Date(t0 + 2 * MIN).toISOString() }) }) } }, t0 + 2 * MIN);
    await w.zoom(id, { event: "meeting.ended", event_ts: t0 + 2 * MIN + 2 * S, payload: { object: obj({ end_time: new Date(t0 + 2 * MIN).toISOString() }) } }, t0 + 2 * MIN + 2 * S);
    expect(w.room(id).state).toBe("open");
  });

  test("zoom-late-meeting-started-after-end-says-host-in: the late start is older than the meeting's end", async () => {
    const w = world("zoom");
    const LEAD = "stress-p6-late-start";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    const t0 = w.clock.now;
    // 10:01 the host's join arrives (meeting.started's delivery failed: retried later).
    w.clock.now = t0 + MIN;
    await w.zoom(id, { event: "meeting.participant_joined", event_ts: t0 + MIN, payload: { object: obj({ participant: hostP({ join_time: new Date(t0 + MIN).toISOString() }) }) } }, t0 + MIN);
    expect(w.room(id).state).toBe("host_in");
    // 10:02 the host leaves; Zoom ends the empty meeting.
    w.clock.now = t0 + 2 * MIN;
    await w.zoom(id, { event: "meeting.participant_left", event_ts: t0 + 2 * MIN, payload: { object: obj({ participant: hostP({ leave_time: new Date(t0 + 2 * MIN).toISOString() }) }) } }, t0 + 2 * MIN);
    await w.zoom(id, { event: "meeting.ended", event_ts: t0 + 2 * MIN + 2 * S, payload: { object: obj({ end_time: new Date(t0 + 2 * MIN).toISOString() }) } }, t0 + 2 * MIN + 2 * S);
    const afterEnd = { ...w.room(id) };
    expect(afterEnd.state).toBe("open");
    // 10:03 Zoom's retry of meeting.started (its own event_ts: 10:01).
    w.clock.now = t0 + 3 * MIN;
    await w.zoom(id, { event: "meeting.started", event_ts: t0 + MIN, payload: { object: obj({ start_time: new Date(t0 + MIN).toISOString() }) } }, t0 + MIN);
    const after = { ...w.room(id) };
    expect(
      { state: after.state, hostInBeforeEnd: Date.parse(String(after.host_in_at)) < Date.parse(String(after.meeting_ended_at)) && after.state === "host_in" },
      `Zoom's meeting ended at 10:02 (meeting_ended_at ${String(after.meeting_ended_at)}), and a meeting.started stamped 10:01, ` +
        `delivered at 10:03, moved the room to ${String(after.state)} with host_in_at ${String(after.host_in_at)}: the panel says ` +
        "\"You are in. Waiting for Huda\" while Zoom's meeting is over and nobody is in it",
    ).toEqual({ state: "open", hostInBeforeEnd: false });
  });

  test("zoom-late-host-join-after-end-says-host-in: the host's own join, delivered after the meeting's end", async () => {
    const w = world("zoom");
    const LEAD = "stress-p6-late-join";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR });
    const id = await w.opened(LEAD);
    const t0 = w.clock.now;
    // 10:01 the meeting starts (stored and passed on); the host's join is stored but its forward failed.
    w.clock.now = t0 + MIN;
    await w.zoom(id, { event: "meeting.started", event_ts: t0 + MIN, payload: { object: obj({}) } }, t0 + MIN);
    expect(w.room(id).state).toBe("host_in");
    w.clock.now = t0 + 2 * MIN;
    await w.zoom(id, { event: "meeting.participant_left", event_ts: t0 + 2 * MIN, payload: { object: obj({ participant: hostP({ leave_time: new Date(t0 + 2 * MIN).toISOString() }) }) } }, t0 + 2 * MIN);
    await w.zoom(id, { event: "meeting.ended", event_ts: t0 + 2 * MIN + 2 * S, payload: { object: obj({}) } }, t0 + 2 * MIN + 2 * S);
    expect(w.room(id).state).toBe("open");
    // The sweep's replay of the host's join (its own join_time: 10:01).
    w.clock.now = t0 + 3 * MIN;
    await w.zoom(id, { event: "meeting.participant_joined", event_ts: t0 + MIN, payload: { object: obj({ participant: hostP({ join_time: new Date(t0 + MIN).toISOString() }) }) } }, t0 + MIN);
    expect(
      { state: w.room(id).state },
      `a host join stamped 10:01, replayed after the meeting ended at 10:02, moved the room to ${String(w.room(id).state)}`,
    ).toEqual({ state: "open" });
  });
});

// ---------------------------------------------------------------------------
// 2. Meta fails the free-text link late, and HighLevel answers the backup
//    email with a 502 after it took it.
//
// recheckLink (the tick) reads the free text failed (131026) and sends the
// email backup on the email's own key. HighLevel's gateway answers that send
// with a 502 after the email went: the message service stores the row
// "unclear" and says it may have gone. recheckLink treats that like no email
// at all: its timeline line says "and no email could go. Read the link out.",
// link.failed_late is written (so nothing ever reads the email again), and
// no "may have gone" line or check follows. backUpUnseen, the same backup on
// the other path, says "the email may have gone. Check the conversation".
// ---------------------------------------------------------------------------

describe("providers2 r6: a 502 after the late-failure email backup landed", () => {
  test("late-failure-email-unclear-says-no-email-could-go", async () => {
    const w = world("zoom");
    const LEAD = "stress-p6-late-email-502";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "pending", email_out: "unclear" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.state, msg.provider_status]).toEqual([["whatsapp_text"], "sent", "pending"]);
    // Meta's status for the free text comes in a minute later: failed, 131026.
    w.routes.unshift(async (m, p) =>
      m === "GET" && p === `/conversations/messages/${String(msg.ghl_message_id)}`
        ? { message: { id: msg.ghl_message_id, status: "failed", direction: "outbound", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } } }
        : (null as unknown as Row),
    );
    w.clock.now += 70 * S;
    await w.tick(id);
    const emailRow = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD && m.channel === "email") as Row | undefined;
    const lines = w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && typeof e.text === "string")
      .map(e => String(e.text));
    const said = lines.find(t => /WhatsApp failed the link after it was sent/.test(t)) ?? null;
    expect(
      { emailState: emailRow?.state ?? null, lastWord: said, emailWent: w.delivered.some(d => d.lead === LEAD && d.lane === "email") },
      `the email backup's answer was lost (row ${String(emailRow?.state)}), and the room's timeline says: ${JSON.stringify(said)}`,
    ).toEqual({
      emailState: "unclear",
      lastWord: expect.not.stringMatching(/no email could go/) as unknown as string,
      emailWent: true,
    });
  });
});
