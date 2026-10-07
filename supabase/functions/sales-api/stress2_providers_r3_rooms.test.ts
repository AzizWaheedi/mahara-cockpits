// bun test supabase/functions/sales-api/stress2_providers_r3_rooms.test.ts
//
// Second series, round 3, provider quirks on sales-api's side. Each runs the
// real modules (rooms.ts, followupAgent.ts, roomlogic.ts) on testfakes.ts
// with the providers' own answer shapes. A failing test is a finding; once
// fixed it stays as a regression test. Nothing leaves this process; every
// lead is invented.
import { describe, expect, test } from "bun:test";
import { AGENT_COPY, holdsEverything, makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The rooms world: index.ts's message service as it stores its rows, and
// HighLevel's conversation read (whatsappSentSince) as a knob.
// ---------------------------------------------------------------------------

type TextOutcome = "ok" | "unclear_went_pending";
type TemplateOutcome = "ok" | "pending";

function world() {
  const w = fakeWorld();
  const jobs: Promise<unknown>[] = [];
  const knobs = { text: "ok" as TextOutcome, template: "ok" as TemplateOutcome, conversationShows: false };
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
  const leads = new Set<string>();
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      if (!leads.has(id)) return null as unknown as Row;
      return {
        contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: `${id}@example.com`, tags: ["roas-qualified"], country: "KW" },
      };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  function addLead(id: string, inboundAgoMs: number): void {
    leads.add(id);
    w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${id}`, contact_id: id, inbound_whatsapp_at: new Date(w.clock.now - inboundAgoMs).toISOString() }]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  const delivered: { lead: string; lane: string }[] = [];
  async function send(lane: "text" | "template" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (lane === "text" && knobs.text === "unclear_went_pending") {
      // HighLevel took the message (it is in the conversation, pending at
      // Meta) and its answer to POST /conversations/messages was a 502 or
      // the 25 s timeout: convoSend stores "unclear" and throws may-have-gone.
      delivered.push({ lead: contactId, lane });
      knobs.conversationShows = true;
      row.state = "unclear";
      row.error = "HighLevel said 502: Bad Gateway";
      throw new ApiRefusal(`The send may have gone; read the conversation in HighLevel before writing to the lead again (${String(row.error)})`, 502, {
        unclear: true,
      });
    }
    delivered.push({ lead: contactId, lane });
    row.ghl_message_id = `msg-${String(row.id).slice(0, 8)}`;
    if (lane === "template" && knobs.template === "pending") {
      // sendTemplate's read-back found the template's words in the
      // conversation still "pending" at Meta after the room's 20 s: stored as
      // sent (stateOf("sent")) with provider_status "pending", seen, so not
      // "enrolled" (never the unseen backup).
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
    // index.ts whatsappSentSince({went: true}): a message with the link's
    // words, not failed or undelivered, is in the lead's conversation.
    sentSince: async () => knobs.conversationShows,
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
        join_url: ZOOM_URL,
        provider_meeting_id: "81234567890",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  return { ...w, rooms, room, addLead, workerOpens, tick, drain, delivered, marks, knobs };
}

// ---------------------------------------------------------------------------
// 1. A free-text link whose send answer was lost (HighLevel 5xx or timeout
//    after it took the message), confirmed from the conversation while Meta
//    still says pending, then failed by Meta (131026 not on WhatsApp, 131047
//    the window shut a moment before).
//
// maybeSent finds the link's words in the conversation (sentSince, went:
// only failed and undelivered are skipped, so "pending" counts) and records
// the link with recordSent(room, channel, null): no message id. The fix for
// late-meta-failure-link-counted-as-reached (recheckLink on the tick) reads
// the message by room.link_message_ids.whatsapp_text, which is empty here,
// and the message row itself stays "unclear" with no ghl_message_id, so
// nothing ever reads Meta's answer: no email backup, no doubt for the
// settle, which marks the booked intro a no-show for a lead who never had
// the link.
// ---------------------------------------------------------------------------

describe("providers2 r3: a lost send answer, confirmed pending, then failed at Meta", () => {
  test("unclear-text-link-confirmed-pending-never-rechecked", async () => {
    const w = world();
    const LEAD = "stress-p2r3-unclear-pending";
    w.addLead(LEAD, 2 * HOUR);
    w.knobs.text = "unclear_went_pending";
    const START = w.clock.now - 1 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-unclear", contact_id: LEAD, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(START).toISOString(), assigned_user_id: "G-setter" },
    ]);
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      appointment_id: "intro-unclear",
    });
    const id = String((out.room as Row).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    // Confirmed from the conversation: the link counts as sent on WhatsApp.
    // (Fix round 3: the row is marked sent from the conversation; it stayed
    // "unclear" when this was found.)
    expect([w.room(id).link_channels, Boolean(w.room(id).link_sent_at), ["unclear", "sent"].includes(String(msg.state))]).toEqual([
      ["whatsapp_text"],
      true,
      true,
    ]);
    // A minute later Meta's answer for that message is failed (131026).
    // HighLevel would answer it on /conversations/messages/{id} for whoever asks.
    let asked = 0;
    w.routes.unshift(async (m, p) => {
      if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
        asked++;
        return { message: { id: "ghl-msg-unclear", status: "failed", direction: "outbound", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } } };
      }
      return null as unknown as Row;
    });
    w.knobs.conversationShows = false;
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(w.clock.now + 2 * MIN).toISOString(), handled_at: new Date(w.clock.now + 2 * MIN).toISOString(), detail: {} },
    ]);
    for (let i = 0; i < 10; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const lanes = w.delivered.filter(d => d.lead === LEAD).map(d => d.lane);
    Object.assign(w.room(id), {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      ended_at: new Date(w.clock.now).toISOString(),
      host_in_at: new Date(START + 3 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now = START + 25 * MIN;
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.drain();
    expect(
      { noShows: w.marks.filter(m => m.status === "noshow").length, emailBackup: lanes.includes("email"), unconfirmed: Boolean(w.room(id).link_unconfirmed_at) },
      "a link whose send answer was lost and that the conversation showed still pending was never read again: Meta failed it, " +
        `no email backup went, nothing doubted it, and the intro was marked a no-show (Meta's status read ${asked} times; message ${String(msg.state)})`,
    ).toEqual({ noShows: 0, emailBackup: true, unconfirmed: true });
  });
});

// ---------------------------------------------------------------------------
// 1b. The same late failure on the template lane: the lead's 24-hour window
//     is shut (the common case for a fallback room on a booked intro), the
//     call_link template goes, sendTemplate's 20 s read-back sees it still
//     "pending", and Meta fails it after (131026, a paused template). The
//     tick's recheckLink only reads a whatsapp_text link, so a template that
//     failed late is counted as reached for good.
// ---------------------------------------------------------------------------

describe("providers2 r3: the call_link template failed at Meta after its read-back", () => {
  test("late-meta-failure-template-never-rechecked", async () => {
    const w = world();
    const LEAD = "stress-p2r3-template-late";
    w.addLead(LEAD, 3 * 24 * HOUR); // window shut: the template lane
    w.knobs.template = "pending";
    const START = w.clock.now - 1 * MIN;
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: "intro-tpl", contact_id: LEAD, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(START).toISOString(), assigned_user_id: "G-setter" },
    ]);
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      appointment_id: "intro-tpl",
    });
    const id = String((out.room as Row).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.state, msg.provider_status, Boolean(w.room(id).link_unconfirmed_at)]).toEqual([["whatsapp_template"], "sent", "pending", false]);
    let asked = 0;
    w.routes.unshift(async (m, p) => {
      if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
        asked++;
        return { message: { id: msg.ghl_message_id, status: "failed", direction: "outbound", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } } };
      }
      return null as unknown as Row;
    });
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(w.clock.now + 2 * MIN).toISOString(), handled_at: new Date(w.clock.now + 2 * MIN).toISOString(), detail: {} },
    ]);
    for (let i = 0; i < 10; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const lanes = w.delivered.filter(d => d.lead === LEAD).map(d => d.lane);
    Object.assign(w.room(id), {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      ended_at: new Date(w.clock.now).toISOString(),
      host_in_at: new Date(START + 3 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now = START + 25 * MIN;
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.drain();
    expect(
      { noShows: w.marks.filter(m => m.status === "noshow").length, emailBackup: lanes.includes("email"), unconfirmed: Boolean(w.room(id).link_unconfirmed_at) },
      "the call_link template Meta failed after the 20 s read-back was counted as reached: nothing read it again, no email " +
        `backup went, and the intro was marked a no-show (Meta's status read ${asked} times)`,
    ).toEqual({ noShows: 0, emailBackup: true, unconfirmed: true });
  });
});

// ---------------------------------------------------------------------------
// 2. HighLevel's rate limit (429) on an approved opener's template, as
//    followup.send_due answers it.
//
// index.ts sendTemplate answers a 429 on the contact-field write or the
// workflow enrolment with Refusal("HighLevel did not send it: HighLevel said
// 429: Too Many Requests", 502, {certain: true}); sendFollowup has closed the
// draft as failed by then. holdsEverything reads status 429 only from
// sales-api's own ceiling, never HighLevel's 429 inside a 502, so send_due
// answers it as one opener's outage: no hold_all, and the desk's waves.sync
// then counts it against the lead (tests/test_stress2_providers_r3.py).
// ---------------------------------------------------------------------------

describe("providers2 r3: HighLevel's 429 on an opener", () => {
  test("highlevel-429-on-opener-counted-as-lead-failure: send_due's answer holds every send", async () => {
    const w = fakeWorld(Date.parse("2026-10-04T08:00:00Z"));
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
      { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
      { key: "messaging", value: { whatsapp: true } },
    ]);
    w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-p2r3-429", country: "KW" }]);
    const agent = makeFollowupAgent({
      io: w.io,
      audit: async () => {},
      sendFollowup: async () => {
        throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too Many Requests", 502, { certain: true });
      },
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    const id = fakeUuid();
    w.db.seed("cockpit_sales_followups", [
      { id, contact_id: "stress-p2r3-429", segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso() },
    ]);
    w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, send_after: new Date(w.clock.now - 1000).toISOString(), approved_by: "boss@stress.invalid" }]);
    let r: ApiRefusal | null = null;
    try {
      await agent.desk["followup.send_due"]!(desk, { id });
    } catch (e) {
      if (e instanceof ApiRefusal) r = e;
      else throw e;
    }
    expect(r).not.toBeNull();
    expect(
      { hold_all: r?.extra.hold_all === true, holds: holdsEverything(r?.message ?? "", r?.status ?? 0) },
      "HighLevel's 429 on an opener is answered as that one lead's failure, not a hold on every send",
    ).toEqual({ hold_all: true, holds: true });
    expect(AGENT_COPY.contact_refused.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. HighLevel answers an approved opener's contact read with a 400 that is
//    not about the contact (its gateway's "Bad Request", a Version header it
//    refuses for a minute during a deploy), on a lead it answers a minute later.
//
// rooms.ts (contactGoneAnswer) and waves.py (contact_gone) read a 400 as
// "gone" only when its words say the contact is missing (stress2, round 2).
// followupAgent.ts contactRefused still reads ANY 400, 404 or 422 as
// "HighLevel will not take this lead's contact": sendTemplate's first
// HighLevel call (GET /contacts/{id}, a plain error with status 400) comes
// back through sendFollowup (draft back to draft, nothing went), and
// send_due sets the approved opener aside for a person with "HighLevel would
// not take this lead's contact (HighLevel said 400: Bad Request)". The
// manager's approval is spent on a blip: a rep must find the held opener
// and release it, and a 400 on every contact for a minute sets aside every
// opener the batch reaches in that minute.
// ---------------------------------------------------------------------------

describe("providers2 r3: a 400 that is not about the contact, on an approved opener", () => {
  test("highlevel-400-sets-approved-opener-aside", async () => {
    for (const message of ["Bad Request", "Version header is not valid"]) {
      const w = fakeWorld(Date.parse("2026-10-04T08:00:00Z"));
      w.db.seed("cockpit_sales_settings", [
        { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
        { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
        { key: "messaging", value: { whatsapp: true } },
      ]);
      w.db.seed("cockpit_sales_leads", [{ contact_id: "stress-p2r3-400", country: "KW" }]);
      const agent = makeFollowupAgent({
        io: w.io,
        audit: async () => {},
        // index.ts ghl(): Object.assign(new Error(`HighLevel said 400: ...`), { status: 400 }),
        // thrown by sendTemplate's contact read before any message row.
        sendFollowup: async () => {
          throw Object.assign(new Error(`HighLevel said 400: ${message}`), { status: 400 });
        },
        whatsappHealth: async () => ({ paused: false, why: "" }),
      });
      const id = fakeUuid();
      w.db.seed("cockpit_sales_followups", [
        { id, contact_id: "stress-p2r3-400", segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi Huda", created_at: w.db.iso() },
      ]);
      w.db.seed("cockpit_sales_followup_meta", [{ followup_id: id, send_after: new Date(w.clock.now - 1000).toISOString(), approved_by: "boss@stress.invalid" }]);
      try {
        await agent.desk["followup.send_due"]!(desk, { id });
      } catch {
        // the answer is the desk's to read
      }
      const meta = w.db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row;
      expect(
        { held_by: meta.held_by ?? null },
        `one HighLevel 400 ${JSON.stringify(message)} on a lead HighLevel still has set the approved opener aside for a person: ${String(meta.hold_reason ?? "")}`,
      ).toEqual({ held_by: null });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The host check stored the setter's own cockpit room as "a live Zoom
//    meeting" (tests/test_stress2_providers_r3.py, the worker's half): the
//    room has ended and its meeting is closed, and the setter's next Zoom
//    room is refused as "in another meeting".
// ---------------------------------------------------------------------------

describe("providers2 r3: the host's own ended room read as another Zoom meeting", () => {
  test("host-check-counts-own-room-as-another-meeting: the next Zoom room is not refused zoom_busy", async () => {
    const w = world();
    const LEAD = "stress-p2r3-next-lead";
    w.addLead(LEAD, 2 * HOUR);
    // What the ten-minute host check wrote while the setter sat in their own
    // fallback room (start 10 minutes ago, Zoom duration 30): live until +20.
    const host = w.db.t("cockpit_sales_room_hosts").find(h => h.email === SETTER) as Row;
    host.zoom_live_until = new Date(w.clock.now + 20 * MIN).toISOString();
    host.checked_at = new Date(w.clock.now - 7 * MIN).toISOString();
    // That room expired a minute ago (nobody came) and the worker closed its meeting.
    w.db.seed("cockpit_sales_rooms", [
      {
        id: fakeUuid(), code: "K7Q2MB", state: "expired", result: "no_join", end_reason: "lead_no_show", provider: "zoom", purpose: "fallback",
        call_kind: "intro", host_email: SETTER, contact_id: "stress-p2r3-earlier-lead", provider_meeting_id: "81000000777",
        requested_at: new Date(w.clock.now - 12 * MIN).toISOString(), opened_at: new Date(w.clock.now - 11 * MIN).toISOString(),
        ended_at: new Date(w.clock.now - 1 * MIN).toISOString(), version: 6,
      },
    ]);
    let refusal: ApiRefusal | null = null;
    try {
      await w.rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "intro",
        purpose: "fallback",
        trigger: "no_answer",
      });
    } catch (e) {
      if (e instanceof ApiRefusal) refusal = e;
      else throw e;
    }
    expect(
      refusal ? { code: refusal.extra.code ?? null, message: refusal.message } : null,
      "the setter's next Zoom room was refused as 'in another meeting' because the host check had read their own cockpit room's meeting as one",
    ).toBeNull();
  });
});
