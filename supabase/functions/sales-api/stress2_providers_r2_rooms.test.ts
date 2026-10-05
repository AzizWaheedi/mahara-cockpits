// bun test supabase/functions/sales-api/stress2_providers_r2_rooms.test.ts
//
// Second series, round 2, provider quirks on sales-api's side: HighLevel's
// 400 on a contact it still has, Meta failing a WhatsApp after the 20 s
// read-back, Meta's payment failure (131042) on a paced opener, a Zoom
// meeting the host deleted by hand, and Zoom delivering meeting.ended before
// a late participant_joined. Each runs the real modules (rooms.ts,
// followupAgent.ts, roomlogic.ts) on testfakes.ts with the providers' own
// answer shapes. A failing test is a finding; once fixed it stays as a
// regression test. Nothing leaves this process; every lead is invented.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, zoomEffect } from "./roomlogic.ts";
import { makeRooms, ROOMS_COPY, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";
import { ZOOM_EVENTS } from "../sales-live/zoom.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** How one send ends: it went, Meta failed it inside the read-back, or HighLevel still said "pending" when the read-back ended. */
type Outcome = "ok" | "pending" | "unclear" | { meta: string };

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  text?: Outcome;
  template?: Outcome;
  email?: Outcome;
  /** The next contact reads answer these HighLevel errors, one each, then the contact again. */
  contactErrors?: { status: number; message: string }[];
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
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
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
      const err = l.contactErrors?.shift();
      // HighLevel's error answer, as liveio.ts ghl throws it.
      if (err) throw new GhlError(`HighLevel said ${err.status}: ${err.message}`, err.status);
      return {
        contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: `${id}@example.com`, tags: ["roas-qualified"], country: "KW" },
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
  /** index.ts convoSend / sendTemplate as they store their rows. */
  async function send(lane: "text" | "template" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const l = leads.get(contactId);
    const o: Outcome = (l?.[lane] as Outcome | undefined) ?? "ok";
    if (o === "unclear") {
      // HighLevel answered the workflow enrolment with a 502 (or timed out):
      // sendTemplate's fail(e, true) stores "unclear" and throws may-have-gone.
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
      // A macrotask first, so a press's background job is registered before it is waited for.
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
    });
    return String((out.room as Row).id);
  }
  /** A room made, opened by the worker and its link asked for (worker.ready). */
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
  return { ...w, rooms, room, addLead, make, opened, workerOpens, tick, zoom, drain, delivered, marks };
}

// ---------------------------------------------------------------------------
// 1. HighLevel answers 400 on a contact it still has.
//
// rooms.ts readContactOrGone reads ANY 400 (and 404, 422) on the contact
// read as "merged away or deleted" (stress2, round 1). sendLinkHeld then
// writes ROOMS_COPY.contact_gone_send as the room's refusal, and sendLink's
// first line returns for good on any room whose refusal starts with it:
// the minute's re-ask never reads HighLevel again. A 400 that is not about
// the contact (HighLevel's generic "Bad Request" from its gateway, a
// Version header it refuses for a minute during a deploy) on a lead the
// cockpit read a moment ago, at room.create, leaves the lead with no link
// for the room's whole life, and the panel tells the rep the lead was
// merged or deleted in HighLevel.
// ---------------------------------------------------------------------------

describe("providers2 r2: a 400 on a contact HighLevel still has", () => {
  for (const message of ["Bad Request", "Version header is not valid"]) {
    test(`highlevel-400-read-as-gone-for-good: one 400 "${message}" at the link, then HighLevel answers again`, async () => {
      const w = world();
      // The contact read at room.create answers; the one at the link answers 400 once.
      w.addLead({ id: "stress-p2r2-known-400", inboundAgoMs: 2 * HOUR });
      const id = await w.make("stress-p2r2-known-400");
      const lead = { id: "stress-p2r2-known-400", inboundAgoMs: 2 * HOUR, contactErrors: [{ status: 400, message }] };
      w.addLead(lead);
      await w.workerOpens(id);
      await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
      await w.drain();
      const first = { ...w.room(id) };
      expect(first.link_sent_at ?? null).toBeNull(); // the 400 stopped this first try, as it should
      // HighLevel answers the contact again; the sweep's minute re-asks the claimed link.
      for (let i = 0; i < 3; i++) {
        w.clock.now += 70 * S;
        await w.tick(id);
      }
      const r = w.room(id);
      expect(
        { link_sent_at: Boolean(r.link_sent_at), refusal: r.refusal ?? null },
        `HighLevel's 400 "${message}" on a contact it still has was read as merged or deleted, and no re-ask reads it again: ` +
          `${w.delivered.length} sends in three minutes`,
      ).toEqual({ link_sent_at: true, refusal: null });
    });
  }

  test("HELD (control): a 404 'Contact not found' still stops the link with the merged or deleted sentence", async () => {
    const w = world();
    w.addLead({ id: "stress-p2r2-gone", inboundAgoMs: 2 * HOUR });
    const id = await w.make("stress-p2r2-gone");
    w.addLead({ id: "stress-p2r2-gone", inboundAgoMs: 2 * HOUR, contactErrors: Array.from({ length: 10 }, () => ({ status: 404, message: "Contact not found" })) });
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    expect(String(w.room(id).refusal ?? "")).toContain(ROOMS_COPY.contact_gone_send.slice(0, 40));
  });
});

// ---------------------------------------------------------------------------
// 2. Meta fails the room's free-text link after the 20 s read-back.
//
// convoSend reads a WhatsApp back for rooms.waits_s.unconfirmed (20 s) and
// stores a message still "pending" at the end of it as sent. Meta answers a
// number that is not on WhatsApp (131026) or an undeliverable message by
// its status webhook, often later than 20 s. The room's link is recorded
// sent (link_sent_at, link_channels [whatsapp_text]), so: no email backup,
// the panel says the link went, the lead's 10 minutes run against a lead who
// never had it, and nothing ever reads the message again (the desk's
// settle_sends reads follow-ups' messages only). The settle then marks the
// booked intro a no-show although HighLevel now says the link failed: the
// very case noShowDoubt keeps for a person ("the link never reached the lead").
// ---------------------------------------------------------------------------

describe("providers2 r2: Meta fails the link after the read-back", () => {
  test("late-meta-failure-link-counted-as-reached: the room says sent, no email follows, and the settle marks the intro a no-show", async () => {
    const w = world("zoom");
    const LEAD = "stress-p2r2-late-131026";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "pending" });
    const START = w.clock.now - 1 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-late", contact_id: LEAD, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(START).toISOString(), assigned_user_id: "G-setter" },
    ]);
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      appointment_id: "intro-late",
    });
    const id = String((out.room as Row).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.state, msg.provider_status]).toEqual([["whatsapp_text"], "sent", "pending"]);
    // A minute later Meta's status for that message comes in: failed, 131026.
    w.routes.unshift(async (m, p) =>
      m === "GET" && p === `/conversations/messages/${String(msg.ghl_message_id)}`
        ? { message: { id: msg.ghl_message_id, status: "failed", direction: "outbound", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } } }
        : (null as unknown as Row),
    );
    // The host started the meeting (Zoom reported it); nobody else came.
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(w.clock.now + 2 * MIN).toISOString(), handled_at: new Date(w.clock.now + 2 * MIN).toISOString(), detail: {} },
    ]);
    // Every minute's tick in the lead's 10 minutes: nothing re-reads the link or backs it up.
    for (let i = 0; i < 10; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const sentBefore = w.delivered.filter(d => d.lead === LEAD).map(d => d.lane);
    // The sweep closed it as nobody came (R4), as SQL does.
    Object.assign(w.room(id), { state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: new Date(w.clock.now).toISOString(), host_in_at: new Date(START + 3 * MIN).toISOString(), version: Number(w.room(id).version) + 1 });
    w.clock.now = START + 25 * MIN;
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.drain();
    expect(
      { noShows: w.marks.filter(m => m.status === "noshow").length, emailBackup: sentBefore.includes("email") || sentBefore.length > 1 },
      "the link Meta failed after the 20 s read-back was counted as reached: no backup went, and the booked intro was marked a no-show " +
        `(room ${String(w.room(id).settled_mark ?? "")}, message still ${String(msg.state)}/${String(msg.provider_status)})`,
    ).toEqual({ noShows: 0, emailBackup: true });
  });
});

// ---------------------------------------------------------------------------
// 2b. HighLevel answers the call_link template's workflow enrolment with a
//     5xx (or the call times out): the template may or may not go.
//
// A template HighLevel took and nobody saw (a 200 enrolment, provider_status
// "enrolled") is backed up by email at once on the email's own key, with
// link_unconfirmed_at: the same link, never a second one. A template whose
// enrolment answer was a 5xx is the same doubt from the lead's side, yet
// sendLinkHeld hands it to maybeSent, which only looks for the template's
// words in the conversation and, not finding them, writes "The link may have
// gone on WhatsApp ... read it out". The email backup never goes, on that
// minute or any later re-ask (each finds the row unclear and asks the
// conversation again). When the enrolment really did not land, the lead
// never has the link and the room waits out the lead's 10 minutes.
// ---------------------------------------------------------------------------

describe("providers2 r2: a 5xx on the template's workflow enrolment", () => {
  test("unclear-template-enrolment-never-backed-up-by-email", async () => {
    const w = world();
    // The window is shut (the lead never wrote on WhatsApp): the template first, then email.
    w.addLead({ id: "stress-p2r2-tpl-502", inboundAgoMs: null, template: "unclear" });
    const id = await w.opened("stress-p2r2-tpl-502");
    for (let i = 0; i < 4; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const r = w.room(id);
    const lanes = w.delivered.filter(d => d.lead === "stress-p2r2-tpl-502").map(d => d.lane);
    expect(
      { emailed: lanes.includes("email") },
      `the template's enrolment answered 502 and its words never showed in the conversation; four minutes on the room says ${JSON.stringify(r.refusal)} ` +
        `and the email backup a 200-but-unseen template gets never went (sends: ${JSON.stringify(lanes)})`,
    ).toEqual({ emailed: true });
  });
});

// ---------------------------------------------------------------------------
// 3. Meta's payment failure on a paced opener (an empty prepaid balance or a
//    refused card: Meta 131042 "Business eligibility payment issue").
//
// followup.send_due holds every send only when the failed message's words
// say wallet, funds, insufficient or balance (HighLevel's own wallet). Meta's
// 131042 carries none of them, so the desk reads it as this one lead's
// failure and sends the batch's next opener into the same failure, lead by
// lead, until the follow-up source's health share trips (6 of the last 20).
// Each of those leads is failed and redrafted 20 hours later; a lead already
// failed once (a 131049 the week before) is taken out of the wave for good.
// ---------------------------------------------------------------------------

describe("providers2 r2: Meta's payment failure on an opener", () => {
  const SUN_11 = Date.parse("2026-10-04T08:00:00Z");
  function agentWorld(error: string) {
    const w = fakeWorld(SUN_11);
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
      { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
      { key: "messaging", value: { whatsapp: true } },
    ]);
    w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-p2r2-c1", country: "KW", assigned_to: "G-setter" }]);
    const agent = makeFollowupAgent({
      io: w.io,
      audit: async () => {},
      sendFollowup: async () => ({ followup: { status: "failed" }, message: { state: "failed", provider_status: "failed", error } }),
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      { id, contact_id: "stress-p2r2-c1", owner_email: SETTER, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso() },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, send_after: new Date(SUN_11 - 1000).toISOString(), approved_by: SETTER }]);
    return { agent, id };
  }
  for (const error of [
    "Business eligibility payment issue (131042)",
    "(#131042) Message failed to send because there were one or more errors related to your payment method.",
  ]) {
    test(`meta-payment-131042-read-as-one-leads-failure: "${error.slice(0, 48)}..."`, async () => {
      const { agent, id } = agentWorld(error);
      const out = await agent.desk["followup.send_due"]!(desk, { id });
      expect(out.hold_all, "Meta's payment failure was answered as this lead's own failure, so the batch sends on into it").toBe(true);
    });
  }
  test("HELD (control): HighLevel's own wallet words hold every send", async () => {
    const { agent, id } = agentWorld("Insufficient funds in the wallet");
    expect((await agent.desk["followup.send_due"]!(desk, { id })).hold_all).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The host deletes the room's Zoom meeting by hand (from the Zoom app's
//    meeting list, where it sits as "Mahara call K7Q2MX").
//
// Zoom posts meeting.deleted; the door is not subscribed to it (ZOOM_EVENTS)
// and answers {ignored}, and zoomEffect reads it as "not a room event"
// anyway. Nothing else ever reads an open room's meeting. The room stays
// open with a join link Zoom now answers "This meeting link is invalid
// (3,001)" to: the lead taps it and cannot join, the rep's Open my room
// fails in Zoom, the panel keeps saying the link went and waits the lead's
// 10 minutes, and the rep is never told to make a new room.
// ---------------------------------------------------------------------------

describe("providers2 r2: a Zoom meeting the host deleted", () => {
  test("zoom-meeting-deleted-room-stays-open: the door hears nothing and the room keeps a dead link", async () => {
    expect([...ZOOM_EVENTS], "the door's Zoom subscription has no meeting.deleted, so it is answered {ignored} and kept nowhere").toContain("meeting.deleted");
  });

  test("zoom-meeting-deleted-room-stays-open: a stored meeting.deleted leaves the room open on its dead link", async () => {
    const w = world("zoom");
    w.addLead({ id: "stress-p2r2-deleted", inboundAgoMs: 2 * HOUR });
    const id = await w.opened("stress-p2r2-deleted");
    expect(w.room(id).link_sent_at).toBeTruthy();
    const effect = zoomEffect(
      { event: "meeting.deleted", event_ts: w.clock.now, payload: { object: { id: "81234567890", uuid: "u1==", host_id: "Z-setter", topic: `Mahara call ${String(w.room(id).code)}` } } } as never,
      { host_email: SETTER, host_zoom_user_id: "Z-setter", staff_emails: [SETTER], staff_zoom_user_ids: ["Z-setter"] },
    );
    await w.zoom(id, { event: "meeting.deleted", event_ts: w.clock.now, payload: { object: { id: "81234567890", uuid: "u1==", host_id: "Z-setter" } } }, w.clock.now);
    const r = w.room(id);
    expect(
      { state: r.state, told: Boolean(r.error || r.refusal) },
      `Zoom said the meeting was deleted (zoomEffect: ${JSON.stringify(effect)}); the room is still ${String(r.state)} on ${String(r.join_url)} and nobody is told`,
    ).not.toEqual({ state: "open", told: false });
  });
});

// ---------------------------------------------------------------------------
// 5. Zoom delivers meeting.ended before a lead's participant_joined that
//    happened earlier (Zoom does not order its webhooks, and a join whose
//    forward failed is replayed 20 s or more later).
//
// meeting_ended on a room whose lead has not been seen, inside the lead's
// 10 minutes, is read as "the host left" (F9): the room goes back to open
// with 120 s for the host, and the meeting's end is not kept. The late join
// then lands on that open room as a fresh lead_in: the room shows the lead
// in a call that has ended, the setter reads as on a call, and the dialer
// holds the lead, until R7's no-end-signal close at the join + the call's
// length + 30 minutes (an hour for an intro, an hour and a half for a demo).
// ---------------------------------------------------------------------------

describe("providers2 r2: meeting.ended delivered before an earlier join", () => {
  test("meeting-ended-before-late-join-leaves-room-lead-in", async () => {
    const w = world("zoom");
    w.addLead({ id: "stress-p2r2-reorder", inboundAgoMs: 2 * HOUR });
    const id = await w.opened("stress-p2r2-reorder");
    const t0 = w.clock.now;
    // 10:02 the host starts the meeting (delivered on time).
    await w.zoom(id, { event: "meeting.started", event_ts: t0 + 1 * MIN, payload: { object: { id: "81234567890", uuid: "u1==", host_id: "Z-setter" } } }, t0 + 1 * MIN);
    expect(w.room(id).state).toBe("host_in");
    // The lead joined at 10:03 and the host ended the call at 10:06; Zoom delivers the end first.
    w.clock.now = t0 + 5 * MIN;
    await w.zoom(id, { event: "meeting.ended", event_ts: t0 + 5 * MIN, payload: { object: { id: "81234567890", uuid: "u1==", host_id: "Z-setter" } } }, t0 + 5 * MIN);
    const afterEnd = String(w.room(id).state);
    w.clock.now = t0 + 6 * MIN;
    const joinAt = new Date(t0 + 2 * MIN).toISOString();
    await w.zoom(
      id,
      {
        event: "meeting.participant_joined",
        event_ts: t0 + 2 * MIN,
        payload: { object: { id: "81234567890", uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: "Huda Ali", join_time: joinAt, participant_uuid: "p-lead" } } },
      },
      t0 + 2 * MIN,
    );
    const r = w.room(id);
    expect(
      { state: r.state },
      `meeting.ended (10:06) delivered before the lead's join (10:03): the end turned the room back to ${afterEnd}, then the late join made it ${String(r.state)} ` +
        `with the meeting over; it stays so until ${String(r.ends_at)} + 30 minutes`,
    ).toEqual({ state: "ended" });
  });
});

// ---------------------------------------------------------------------------
// Fix round 2: Zoom's daily create cap, stored by the room worker on the
// host's row (cockpit_sales_room_hosts.zoom_capped_until), refuses a Zoom
// room before it is asked for; Meet still works.
// ---------------------------------------------------------------------------

describe("providers2 r2: a host whose Zoom creates are capped for today", () => {
  test("a Zoom room is refused with the cap's sentence before it is asked for; a Meet room is made", async () => {
    const w = world("zoom");
    w.addLead({ id: "stress-p2r2-capped", inboundAgoMs: 2 * HOUR });
    const host = w.db.t("cockpit_sales_room_hosts").find(h => h.email === SETTER) as Row;
    host.zoom_capped_until = new Date(w.clock.now + 3 * HOUR).toISOString();
    let refusal: ApiRefusal | null = null;
    try {
      await w.make("stress-p2r2-capped");
    } catch (e) {
      refusal = e as ApiRefusal;
    }
    expect(refusal?.extra.code).toBe("zoom_capped");
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === "stress-p2r2-capped")).toHaveLength(0);
    const meet = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: "stress-p2r2-capped",
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
    });
    expect((meet.room as Row).provider).toBe("meet");
  });
});
