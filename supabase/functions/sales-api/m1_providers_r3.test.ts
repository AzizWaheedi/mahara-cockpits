// bun test supabase/functions/sales-api/m1_providers_r3.test.ts
//
// Milestone 1, video-link round 3, provider quirks on sales-api's side of
// the video link. Settings are the pilot's (m1-scope.md section 3): rooms
// on, both providers, every send lane on, test_only with the test leads
// listed, count_on_join, settle, wrap and auto_on_miss off, short_link off
// (so the call_link template lane is never used), live off. The WhatsApp
// gate is open unless a test closes it (production's state today: the link
// then goes by email only).
//
// The message service is faked the way index.ts convoSend stores its rows.
// The lead's conversation is read the way index.ts's sentSince reads it
// (whatsappSentSince: the conversation search by contact id, toThread,
// matchSent), so a contact HighLevel merged away (its conversations moved
// to the surviving contact) answers as index.ts would. HighLevel's
// GET /contacts/{id} answers what each test sets: the contact, a 404
// "Contact not found" (deleted, or merged away), or a 429.
// A failing test is a finding; tests marked HELD pass. Nothing leaves this
// process; every lead is invented.
import { describe, expect, test } from "bun:test";
import { toThread } from "./lib.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { matchSent } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1p3-setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * How one send ends, as convoSend stores it:
 * - "sent": HighLevel read it "sent" through the read-back;
 * - "pending": HighLevel still said "pending" (its own queue) when the read-back ended;
 * - "delivered": delivered inside the read-back.
 */
type Outcome = "sent" | "pending" | "delivered";

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  email?: string | null;
  text?: Outcome[];
  email_out?: Outcome[];
  /** How HighLevel answers GET /contacts/{id} now. */
  contact?: "ok" | "gone" | "throttled";
  /** HighLevel merged this contact into another: its conversations moved there. */
  mergedAway?: boolean;
}

function world(o: { waGate?: boolean; emailIdUnreadable?: boolean } = {}) {
  const w = fakeWorld();
  const leads = new Map<string, Lead>();
  const jobs: Promise<unknown>[] = [];
  const roomsJson: Row = {
    ...DEFAULT_ROOMS_JSON,
    enabled: true,
    test_only: true,
    test_contacts: [] as string[],
    providers: { zoom: true, meet: true },
    send: { whatsapp_text: true, whatsapp_template: true, email: true },
    count_on_join: false,
    settle: false,
    wrap: false,
    short_link: false,
    fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: roomsJson },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: o.waGate === false ? { connector_off: false, single_copy_ok_at: null } : { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf-call-link" }, { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" }]);
  /** HighLevel's message status as GET /conversations/messages/{id} reads it now, by HighLevel message id. */
  const later = new Map<string, Row>();
  const emailIds = new Set<string>();
  /** The lead's conversation as HighLevel keeps it: every message we sent, with its status now. */
  const conversation: { lead: string; body: string; status: string; at: number; id: string; channel: "whatsapp" | "email" }[] = [];
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l || l.contact === "gone") throw new GhlError("HighLevel said 400: Contact not found", 400, true);
      if (l.contact === "throttled") throw new GhlError("HighLevel said 429: Too Many Requests", 429, true);
      const email = l.email === undefined ? `${id}@example.com` : l.email;
      return { contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", ...(email ? { email } : {}), tags: ["roas-qualified"], country: "KW" } };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    const msg = /^\/conversations\/messages\/([^/?]+)$/.exec(p);
    if (m === "GET" && msg) {
      const id = decodeURIComponent(msg[1] as string);
      // The message service's own note: "an email's id is not always readable this way".
      if (o.emailIdUnreadable && emailIds.has(id)) throw new GhlError("HighLevel said 404: Message not found", 404, true);
      const now = later.get(id);
      if (now) return { message: { id, direction: "outbound", ...now } };
    }
    return null as unknown as Row;
  });
  function addLead(l: Lead): void {
    leads.set(l.id, l);
    (roomsJson.test_contacts as string[]).push(l.id);
    if (l.inboundAgoMs !== null)
      w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${l.id}`, contact_id: l.id, inbound_whatsapp_at: new Date(w.clock.now - l.inboundAgoMs).toISOString() }]);
  }
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  const delivered: { lead: string; lane: string; at: number; request_id: string }[] = [];
  const used = new Map<string, number>();
  function next(contactId: string, lane: "text" | "email"): Outcome {
    const l = leads.get(contactId);
    const list = (lane === "email" ? l?.email_out : l?.text) ?? ["sent"];
    const k = `${contactId}:${lane}`;
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return list[Math.min(n, list.length - 1)] as Outcome;
  }
  /** index.ts convoSend as it stores its rows (request id written first, read back, stored). */
  async function send(lane: "text" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string) {
    const again = rows.get(requestId);
    if (again) {
      if (String(again.body).trim() !== body.trim() || again.channel !== channel)
        throw new ApiRefusal("That send was already used for other words. Press Send again.", 409);
      return { message: { ...again }, repeated: true };
    }
    // convoSend reads the contact first (GET /contacts/{id}); gone or throttled, nothing is written.
    const l = leads.get(contactId);
    if (l?.contact === "gone" || l?.contact === "throttled")
      throw new ApiRefusal("Not sent: HighLevel or the database did not answer before anything went. Try again in a minute.", 503, { certain: true, retry: true, code: "not_sent_yet" });
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at() };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const out = next(contactId, lane);
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    if (channel === "email") emailIds.add(ghlId);
    delivered.push({ lead: contactId, lane, at: w.clock.now, request_id: requestId });
    conversation.push({ lead: contactId, body, status: out, at: w.clock.now, id: ghlId, channel });
    row.ghl_message_id = ghlId;
    // HighLevel's send answer names the conversation it filed the message in (index.ts stores it).
    row.ghl_conversation_id = `c-${contactId}`;
    row.state = out === "delivered" ? "delivered" : "sent";
    row.provider_status = out;
    later.set(ghlId, { status: out, messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP" });
    return { message: { ...row } };
  }
  /**
   * index.ts sentSince over whatsappSentSince: the contact's conversations
   * (HighLevel's search by contact id: none for a contact merged away, its
   * conversation moved to the surviving contact), each page through toThread,
   * then matchSent for the hit, the failed copy and any other send on the lane.
   */
  async function sentSince(contactId: string, since: number, text: string | null | undefined, channel?: "whatsapp" | "email") {
    if (!text) return null;
    const ch = channel ?? "whatsapp";
    const l = leads.get(contactId);
    const convs = l?.mergedAway ? [] : [{ id: `c-${contactId}` }];
    // index.ts (m1 round 3): an empty search for a lead known to have a
    // conversation (the inbox, or a message HighLevel filed in one) is no
    // read, so whatsappSentSince throws and sentSince answers null.
    const known =
      w.db.t("cockpit_sales_inbox").some(r => r.contact_id === contactId) ||
      w.db.t("cockpit_sales_messages").some(r => r.contact_id === contactId && r.ghl_conversation_id);
    if (!convs.length && known) return null;
    let failed: ReturnType<typeof toThread>[number] | null = null;
    let others = false;
    for (const cv of convs) {
      const raw = conversation
        .filter(c => c.lead === contactId)
        .map(c => ({
          id: c.id,
          direction: "outbound",
          messageType: c.channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
          status: c.status,
          dateAdded: new Date(c.at).toISOString(),
          body: c.body,
        }))
        .reverse();
      const list = toThread(raw, cv.id);
      const hit = matchSent(list, since, text, { went: true, channel: ch });
      if (hit) return { id: hit.id, status: hit.status };
      if (!failed) failed = matchSent(list, since, text, { channel: ch });
      if (!others) others = Boolean(matchSent(list, since, null, { channel: ch }));
    }
    if (failed) return { id: failed.id, status: failed.status ?? "failed", failed: true, error: failed.error ?? null };
    if (ch === "email" && others) return null;
    return false;
  }
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body),
    sendTemplate: async () => {
      throw new Error("the template lane is off for the pilot (short_link off): no template is ever sent");
    },
    upcoming: async () => null,
    sentSince,
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
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  /** The lead page's Send a video link (purpose manual), as the pilot runs it. */
  async function opened(contactId: string): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    return id;
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  /** HighLevel's status for a message changes (Meta's status webhook, or the mail server's bounce). */
  function becomes(ghlId: string, status: Row) {
    later.set(ghlId, status);
    const c = conversation.find(x => x.id === ghlId);
    if (c) c.status = String(status.status);
  }
  function lines(id: string): string[] {
    return w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && typeof e.text === "string")
      .map(e => String(e.text));
  }
  function msgs(lead: string, channel?: string): Row[] {
    return w.db.t("cockpit_sales_messages").filter(m => m.contact_id === lead && (!channel || m.channel === channel));
  }
  return { ...w, rooms, room, addLead, opened, tick, drain, delivered, becomes, lines, later, msgs, conversation, leads };
}

// ---------------------------------------------------------------------------
// 1. Meta fails the free text after it went (131026), and by then HighLevel
//    no longer has the contact the room was made for: a teammate merged the
//    lead's duplicate into the other card (or deleted it), so
//    GET /contacts/{id} answers "Contact not found".
//
// recheckLink reads the failure by the message's own id (HighLevel still
// answers for the message) and calls whatsappFailedLate, which reads the
// contact before it says anything: `if (!contact) return; // the next minute
// asks again`. readContact turns "gone" into null, so every minute ends
// there, before link_unconfirmed_at and before the line. The room says "Link
// sent on WhatsApp" for the lead's whole ten minutes while Meta failed it;
// emailBounced, on the same contact, still says its line.
// The same silence holds while HighLevel's contacts endpoint answers 429.
// ---------------------------------------------------------------------------

describe("m1 providers r3: a late WhatsApp failure for a contact HighLevel no longer reads", () => {
  test("HELD (control): the late 131026 is said and backed up by email while the contact reads", async () => {
    const w = world();
    const LEAD = "stress-m1p3-late-control";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    w.clock.now += MIN;
    await w.tick(id);
    expect(w.lines(id).some(t => /WhatsApp failed the link/.test(t))).toBe(true);
    expect(Boolean(w.room(id).link_unconfirmed_at)).toBe(true);
  });

  test("late-failure-silent-when-contact-gone: Meta fails the free text after a merge took the contact away, and the room never says so", async () => {
    const w = world();
    const LEAD = "stress-m1p3-late-merged";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    // A teammate merges this card into the lead's other card: HighLevel answers "Contact not found" for it.
    (w.leads.get(LEAD) as Lead).contact = "gone";
    // Meta fails the free text 90 s after it went (the lead is not on WhatsApp).
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    for (let i = 0; i < 8; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    const said = w.lines(id);
    expect(
      { doubt: Boolean(r.link_unconfirmed_at), failureSaid: said.some(t => /WhatsApp failed|did not arrive|did not reach|Read the link out/i.test(t)) },
      `Meta failed the only copy of the link (the message row is ${JSON.stringify(w.msgs(LEAD, "whatsapp")[0]?.state)}); eight minutes on the room still ` +
        `says ${JSON.stringify(said.filter(t => /link|WhatsApp/i.test(t)))} with link_unconfirmed_at ${JSON.stringify(r.link_unconfirmed_at ?? null)}`,
    ).toEqual({ doubt: true, failureSaid: true });
  });

  test("late-failure-silent-while-contacts-throttled: five minutes of 429s on HighLevel's contacts read keep a late 131026 unsaid", async () => {
    const w = world();
    const LEAD = "stress-m1p3-late-429";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["sent"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    (w.leads.get(LEAD) as Lead).contact = "throttled";
    w.clock.now += 90 * S;
    w.becomes(String(text.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    for (let i = 0; i < 5; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      { doubt: Boolean(r.link_unconfirmed_at), failureSaid: w.lines(id).some(t => /WhatsApp failed|did not arrive|Read the link out/i.test(t)) },
      `HighLevel's message read says the link failed, and only its contact read is throttled; five minutes (half the lead's wait) on, the room ` +
        `still says ${JSON.stringify(w.lines(id).filter(t => /link|WhatsApp/i.test(t)))}`,
    ).toEqual({ doubt: true, failureSaid: true });
  });

  test("pending-free-text-silent-when-contact-gone: a free text stuck pending is never doubted once the contact is merged away", async () => {
    const w = world();
    const LEAD = "stress-m1p3-pending-merged";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: ["pending"], email_out: ["sent"] });
    const id = await w.opened(LEAD);
    (w.leads.get(LEAD) as Lead).contact = "gone";
    for (let i = 0; i < 8; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      { doubt: Boolean(r.link_unconfirmed_at) || w.lines(id).some(t => /not confirm|still waiting|not sent it|has not/i.test(t)) },
      `HighLevel holds the free text "pending" for eight minutes (the round 2 rule doubts it at 90 s); with the contact merged away the room still ` +
        `says ${JSON.stringify(w.lines(id).filter(t => /link|WhatsApp/i.test(t)))}`,
    ).toEqual({ doubt: true });
  });
});

// ---------------------------------------------------------------------------
// 2. The pilot's email link (the WhatsApp gate shut, as production has it)
//    went, HighLevel will not read an email by its id (index.ts's own note),
//    and the contact is merged into the lead's other card: its conversation
//    moved there, so the search by the room's contact id finds nothing.
//
// recheckLink falls back on statusInConversation, whose sentSince answers
// "not there" (false: no conversation, so no other email either), and 90 s
// on it calls that "the message is not in the lead's conversation, so it
// never arrived": the message row is marked failed and emailBounced says
// "The email bounced. Read the link out." for an email the lead has.
// ---------------------------------------------------------------------------

describe("m1 providers r3: an email link that went, read after a merge moved the conversation", () => {
  test("HELD (control): without the merge the email that went stays sent", async () => {
    const w = world({ waGate: false, emailIdUnreadable: true });
    const LEAD = "stress-m1p3-email-control";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["sent"] });
    const id = await w.opened(LEAD);
    for (let i = 0; i < 4; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    expect(w.msgs(LEAD, "email")[0]?.state).toBe("sent");
    expect(w.lines(id).some(t => /bounced/.test(t))).toBe(false);
  });

  test("merged-contact-email-read-as-bounced: an email the lead has is called bounced once the conversation moved with a merge", async () => {
    const w = world({ waGate: false, emailIdUnreadable: true });
    const LEAD = "stress-m1p3-email-merged";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["sent"] });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    // The email reached the lead (HighLevel: delivered).
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), { status: "delivered", messageType: "TYPE_EMAIL" });
    // A teammate merges this card into the lead's other one: the conversation moves there.
    const l = w.leads.get(LEAD) as Lead;
    l.mergedAway = true;
    l.contact = "gone";
    for (let i = 0; i < 4; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const said = w.lines(id).filter(t => /bounced|did not arrive|never arrived/i.test(t));
    expect(
      { row: w.msgs(LEAD, "email")[0]?.state, said },
      `the email was delivered (HighLevel's own status), the contact was merged and its conversation moved; the room now says ${JSON.stringify(said)} ` +
        "and the message row reads failed, so the rep reads the link out or sends it again to a lead who has it",
    ).toEqual({ row: "sent", said: [] });
  });
});

// ---------------------------------------------------------------------------
// 3. The pilot's email link, accepted by HighLevel and never handed to its
//    mail service: the email sits at "pending" for the lead's ten minutes.
//
// convoSend stores an email HighLevel still calls pending as state "sent"
// (provider_status "pending"). recheckLink reads it again every minute
// (an email is read until opened), and only a free text has a rule for
// "still pending" (PENDING_STUCK_MS, m1 round 2): with the WhatsApp gate
// shut, the pilot's only lane is email, and its link is never doubted.
// ---------------------------------------------------------------------------

describe("m1 providers r3: an email link HighLevel never hands on", () => {
  test("email-link-stuck-pending-never-doubted: nine minutes of 'pending' on the pilot's email link, and the room says it went", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p3-email-pending";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["pending"] });
    const id = await w.opened(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect([w.room(id).link_channels, mail.state, mail.provider_status]).toEqual([["email"], "sent", "pending"]);
    for (let i = 0; i < 9; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(mail.ghl_message_id)}`).length;
    const r = w.room(id);
    expect(
      { doubt: Boolean(r.link_unconfirmed_at) || w.lines(id).some(t => /not confirm|still waiting|has not sent|not left/i.test(t)) },
      `HighLevel read the email "pending" ${reads} times over nine minutes (never handed to its mail service); the room still says ` +
        `${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))} with link_unconfirmed_at ${JSON.stringify(r.link_unconfirmed_at ?? null)}`,
    ).toEqual({ doubt: true });
  });
});

// ---------------------------------------------------------------------------
// 4. The host deletes the room's Zoom meeting in Zoom after its link went
//    (it sits in the host's Zoom meeting list as "Mahara call K7Q2MX").
//
// Zoom's meeting.deleted cancels the room ("The Zoom meeting was deleted in
// Zoom, so its link no longer works. Make a new room."). The rep's new room
// (the panel's Try Meet, or the lead page's Send a video link again) sends
// the lead the same opening as the first message with a second link, and
// nothing tells the lead the first link is dead: a lead who taps the first
// message (the one they read first) meets Zoom's "Invalid meeting ID".
// "I can't let them in" has its own words for exactly this
// (LANE_COPY.moved_provider: "{old} would not let you in... Let's use
// {provider} instead"); a deleted meeting's replacement has none.
// ---------------------------------------------------------------------------

describe("m1 providers r3: the Zoom meeting deleted by its host after the link went", () => {
  test("zoom-deleted-replacement-words-never-say-first-link-dead: the new room's link repeats the first message and never says the first link is dead", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p3-zoom-deleted";
    w.addLead({ id: LEAD, inboundAgoMs: null, email_out: ["sent"] });
    // A Zoom room from the lead page, made and opened by the worker.
    const made = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((made.room as Row).id);
    const meeting = "86012345678";
    const r0 = w.room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r0.version) + 1 },
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
        join_url: `https://us06web.zoom.us/j/${meeting}?pwd=stress`,
        provider_meeting_id: meeting,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(w.room(id).version) + 1,
      },
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    expect(w.room(id).link_channels).toEqual(["email"]);
    // Two minutes on, the host deletes the meeting in Zoom; the door stores Zoom's event and passes it on.
    w.clock.now += 2 * MIN;
    const code = String(w.room(id).code);
    w.db.seed("cockpit_sales_room_events", [
      {
        id: "11111111-2222-4333-8444-555555555555",
        room_id: id,
        kind: "zoom.meeting.deleted",
        source: "zoom",
        at: w.db.iso(),
        dedupe_key: `zoom:meeting.deleted:uuid-${meeting}`,
        detail: { event: "meeting.deleted", event_ts: w.clock.now, payload: { object: { id: meeting, uuid: `uuid-${meeting}`, topic: `Mahara call ${code}` } } },
      },
    ]);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.deleted", event_id: "11111111-2222-4333-8444-555555555555", payload: {} });
    await w.drain();
    expect([w.room(id).state, w.room(id).end_reason]).toEqual(["cancelled", "meeting_deleted"]);
    // The rep makes the new room on Meet, as the panel says.
    const again = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id2 = String((again.room as Row).id);
    const r2 = w.room(id2);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id2}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r2.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id2, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id2}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id2}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: "abc-defg-hij",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(w.room(id2).version) + 1,
      },
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id2, payload: {} });
    await w.drain();
    const mails = w.msgs(LEAD, "email").map(m => String(m.body));
    expect(mails.length).toBe(2);
    const second = mails[1] as string;
    expect(
      /did not work|no longer works|instead|new link|ignore|replaces|moved/i.test(second),
      `the first email's Zoom link is dead (the host deleted the meeting); the second email reads ${JSON.stringify(second.split("\n")[0])}, ` +
        `the same opening as the first (${JSON.stringify((mails[0] as string).split("\n")[0])}), with no word that the first link no longer works`,
    ).toBe(true);
  });
});
