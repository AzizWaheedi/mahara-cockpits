// bun test supabase/functions/sales-api/m1_providers_r1.test.ts
//
// Milestone 1, video-link round 1, provider quirks on sales-api's side of
// the video link: a setter presses Send a video link from the lead page,
// the worker opens the room, sales-api sends the link (WhatsApp free text
// inside the window, else email: the call_link template needs the short
// link, which is off for the pilot), and the tick reads the link again.
//
// Settings are the pilot's (m1-scope.md section 3): rooms on, both
// providers, every send lane on, test_only with the test leads listed,
// count_on_join, settle, wrap and auto_on_miss off, short_link off,
// live off. Each test runs the real modules (rooms.ts, roomlogic.ts) on
// testfakes.ts, with the message service faked the way index.ts convoSend
// stores its rows (state from HighLevel's last read inside the read-back,
// provider_status as HighLevel said it). A failing test is a finding;
// tests marked HELD pass. Nothing leaves this process; every lead is invented.
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
const SETTER = "stress-m1p-setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * How one send ends, as convoSend stores it:
 * - "sent": HighLevel read the message "sent" (Meta took it, one grey tick) on every read of the read-back;
 * - "pending": HighLevel still said "pending" when the read-back ended;
 * - "delivered": delivered inside the read-back;
 * - "unclear": HighLevel answered 502 after it took the send;
 * - "unclear_failed": the same, and Meta had already failed it when the conversation is read (HighLevel's answer took its 25 s);
 * - { meta }: failed inside the read-back with Meta's words.
 */
type Outcome = "sent" | "pending" | "delivered" | "unclear" | "unclear_failed" | { meta: string };

interface Lead {
  id: string;
  inboundAgoMs: number | null;
  email?: string | null;
  text?: Outcome;
  email_out?: Outcome;
}

function world(provider: "meet" | "zoom" = "meet", o: { waGate?: boolean } = {}) {
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
      // The gate open (a manager confirmed the WA Connector is off), or as production has it today (closed).
      value: o.waGate === false ? { connector_off: false, single_copy_ok_at: null } : { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf-call-link" }, { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" }]);
  /** HighLevel's message status as GET /conversations/messages/{id} reads it now, by HighLevel message id. */
  const later = new Map<string, Row>();
  w.routes.push(async (m, p) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l) return null as unknown as Row;
      const email = l.email === undefined ? `${id}@example.com` : l.email;
      return { contact: { id, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", ...(email ? { email } : {}), tags: ["roas-qualified"], country: "KW" } };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    const msg = /^\/conversations\/messages\/([^/?]+)$/.exec(p);
    if (m === "GET" && msg) {
      const id = decodeURIComponent(msg[1] as string);
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
  /** Sends that reached HighLevel (and may reach the lead), and every ask. */
  const delivered: { lead: string; lane: string; at: number }[] = [];
  const asked: { lead: string; lane: string }[] = [];
  /** The lead's conversation as HighLevel shows it: our own sends, with the status HighLevel has for them. */
  const conversation: { lead: string; body: string; status: string; at: number; id: string }[] = [];
  /** index.ts convoSend as it stores its rows (request id written first, read back, stored). */
  async function send(lane: "text" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    asked.push({ lead: contactId, lane });
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at() };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const l = leads.get(contactId);
    const out: Outcome = ((lane === "email" ? l?.email_out : l?.text) as Outcome | undefined) ?? "sent";
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    if (out === "unclear" || out === "unclear_failed") {
      delivered.push({ lead: contactId, lane, at: w.clock.now });
      conversation.push({ lead: contactId, body, status: out === "unclear" ? "pending" : "failed", at: w.clock.now, id: ghlId });
      row.state = "unclear";
      row.error = "HighLevel said 502: Bad Gateway";
      throw new ApiRefusal(`The send may have gone; read the conversation in HighLevel before writing to the lead again (${String(row.error)})`, 502, { unclear: true });
    }
    if (typeof out === "object") {
      row.state = "failed";
      row.provider_status = "failed";
      row.error = out.meta;
      row.ghl_message_id = ghlId;
      return { message: { ...row } };
    }
    delivered.push({ lead: contactId, lane, at: w.clock.now });
    conversation.push({ lead: contactId, body, status: out, at: w.clock.now, id: ghlId });
    row.ghl_message_id = ghlId;
    // convoSend: stateOf(status === "pending" ? "sent" : status), provider_status as HighLevel said it.
    row.state = out === "delivered" ? "delivered" : "sent";
    row.provider_status = out;
    later.set(ghlId, { status: out, messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP" });
    return { message: { ...row } };
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
    // index.ts sentSince: whatsappSentSince(..., {went: true}) skips a failed or undelivered copy.
    sentSince: async (contactId, since, text) => {
      if (!text) return null;
      const hit = conversation.find(
        c => c.lead === contactId && c.at >= since - 15 * S && c.body.trim() === text.trim() && !["failed", "undelivered"].includes(c.status),
      );
      return hit ? { id: hit.id, status: hit.status } : false;
    },
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
  /** The lead page's Send a video link (purpose manual), as the pilot runs it. */
  async function opened(contactId: string): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider,
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
  return { ...w, rooms, room, addLead, opened, tick, drain, delivered, asked, becomes, lines, later };
}

// ---------------------------------------------------------------------------
// 1. Meta takes the free text ("sent", one grey tick) and fails it a minute
//    and a half later: 131026, the lead's number is not on WhatsApp.
//
// HighLevel's WhatsApp statuses run pending (HighLevel's own queue), sent
// (Meta took it), then delivered, read or failed. Meta's per-person
// failures (131026 not on WhatsApp, 131049 the per-person limit, 131047
// the window) come as a status after Meta took the message. convoSend's
// read-back stops only on delivered, read, failed or undelivered, so a
// failure that comes after its 20 s leaves the row "sent" with
// provider_status "sent". The tick's recheckLink reads a free-text link
// again only while provider_status is "pending" (or the row is unclear),
// so this link is never read again: no email backup, no doubt line, and the
// panel says "Link sent on WhatsApp" while the lead has nothing.
// ---------------------------------------------------------------------------

describe("m1 providers r1: Meta fails a free-text link after HighLevel read it sent", () => {
  test("HELD (control): the same failure on a link HighLevel still called pending is read again and backed up by email", async () => {
    const w = world("meet");
    const LEAD = "stress-m1p-late-pending";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "pending" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.provider_status]).toEqual([["whatsapp_text"], "pending"]);
    w.clock.now += 90 * S;
    w.becomes(String(msg.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    await w.tick(id);
    expect(w.delivered.filter(d => d.lead === LEAD).map(d => d.lane)).toEqual(["text", "email"]);
    expect(w.lines(id).some(t => /WhatsApp failed the link after it was sent, so it went by email/.test(t))).toBe(true);
  });

  test("link-sent-status-never-rechecked: a free text HighLevel read as sent, failed by Meta 90 s later, is never read again", async () => {
    const w = world("meet");
    const LEAD = "stress-m1p-late-sent";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "sent" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.state, msg.provider_status]).toEqual([["whatsapp_text"], "sent", "sent"]);
    // Meta's failed status comes 90 s after the send (after the 20 s read-back).
    w.clock.now += 90 * S;
    w.becomes(String(msg.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "Message Undeliverable. (131026)" } });
    // The sweep ticks the room every minute while the lead's ten minutes run.
    for (let i = 0; i < 8; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(msg.ghl_message_id)}`).length;
    const r = w.room(id);
    expect(
      {
        statusReadAgain: reads > 0,
        emailBackup: w.delivered.some(d => d.lead === LEAD && d.lane === "email"),
        doubtSaid: Boolean(r.link_unconfirmed_at) || w.lines(id).some(t => /failed the link/.test(t)),
      },
      `Meta failed the link 90 s after it went (131026), and over eight ticks HighLevel was asked for its status ${reads} times; ` +
        `the room still says ${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))} with link_channels ${JSON.stringify(r.link_channels)}, ` +
        "no email went (the lead has one), and the panel never says the WhatsApp did not arrive",
    ).toEqual({ statusReadAgain: true, emailBackup: true, doubtSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 2. The pilot's link goes by email (the WhatsApp gate is still closed in
//    production), and the lead's mail server bounces it two minutes later.
//
// m1-scope.md: until a manager confirms the WA Connector is off, the link
// goes by email. convoSend reads an email back for 20 s at most (and often
// cannot read an email's status that way at all), so a bounce that comes
// after it is not seen. The tick reads a link again only while it went on a
// WhatsApp lane and not by email (rooms.ts tick: `!ch.includes("email")`),
// so an email link is never read again: the room says "Link sent by email"
// and the lead_by countdown runs for a lead who has nothing.
// ---------------------------------------------------------------------------

describe("m1 providers r1: the pilot's email link bounces after it went", () => {
  test("email-link-bounce-never-seen: a bounced email link still reads as sent on the panel", async () => {
    const w = world("meet", { waGate: false });
    const LEAD = "stress-m1p-email-bounce";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, email: "huda@typo-domain.invalid", email_out: "sent" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([w.room(id).link_channels, msg.channel, msg.state]).toEqual([["email"], "email", "sent"]);
    w.clock.now += 2 * MIN;
    w.becomes(String(msg.ghl_message_id), { status: "failed", messageType: "TYPE_EMAIL", meta: { error: "550 5.1.1 The email account that you tried to reach does not exist" } });
    for (let i = 0; i < 6; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const reads = w.ghlCalls.filter(c => c.method === "GET" && c.path === `/conversations/messages/${String(msg.ghl_message_id)}`).length;
    const r = w.room(id);
    expect(
      { statusReadAgain: reads > 0, doubtSaid: Boolean(r.link_unconfirmed_at) || Boolean(r.refusal) || w.lines(id).some(t => /bounc|did not arrive|failed/i.test(t)) },
      `the email link bounced two minutes after it went; over six ticks its status was read ${reads} times, and the room says ` +
        `${JSON.stringify(w.lines(id).filter(t => /Link sent/.test(t)))} with nothing about the bounce`,
    ).toEqual({ statusReadAgain: true, doubtSaid: true });
  });
});

// ---------------------------------------------------------------------------
// 3. HighLevel answers the free text with a 502 after it took it, and Meta
//    then fails it (131026). The conversation shows the link's own words as
//    failed; the lead has an email address.
//
// maybeSent reads the conversation for the link's words; index.ts's
// sentSince skips a failed copy (went: true) and answers "not found", the
// same answer as "not in the conversation yet". The room says "The link may
// have gone on WhatsApp", and every minute's re-ask asks the same question
// and gets the same answer: the email never goes, though the one copy the
// lead could have had is shown failed.
// ---------------------------------------------------------------------------

describe("m1 providers r1: a 502 after the free text landed, and Meta fails it", () => {
  test("HELD (control): the copy still pending when the conversation is read is confirmed, and its late failure is backed up by email", async () => {
    const w = world("meet");
    const LEAD = "stress-m1p-unclear-pending";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "unclear" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect([msg.state, w.room(id).link_channels]).toEqual(["sent", ["whatsapp_text"]]);
    w.clock.now += 20 * S;
    w.becomes(String(msg.ghl_message_id), { status: "failed", messageType: "TYPE_WHATSAPP", meta: { error: "(131026)" } });
    w.clock.now += MIN;
    await w.tick(id);
    expect(w.delivered.filter(d => d.lead === LEAD).map(d => d.lane)).toEqual(["text", "email"]);
  });

  test("unclear-text-failed-in-conversation-never-falls-to-email", async () => {
    const w = world("meet");
    const LEAD = "stress-m1p-unclear-failed";
    w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: "unclear_failed" });
    const id = await w.opened(LEAD);
    const msg = w.db.t("cockpit_sales_messages").find(m => m.contact_id === LEAD) as Row;
    expect(msg.state).toBe("unclear");
    for (let i = 0; i < 8; i++) {
      w.clock.now += MIN;
      await w.tick(id);
    }
    const r = w.room(id);
    expect(
      {
        emailWent: w.delivered.some(d => d.lead === LEAD && d.lane === "email"),
        panel: String(r.refusal ?? ""),
      },
      `the free text's only copy in the conversation is failed (Meta 131026), yet after eight minutes the room says ${JSON.stringify(r.refusal)} ` +
        "and no email went to a lead who has one",
    ).toEqual({ emailWent: true, panel: expect.not.stringMatching(/may have gone on WhatsApp/) as unknown as string });
  });
});

// ---------------------------------------------------------------------------
// 4. HighLevel's wallet runs dry for ten minutes: every free-text link fails
//    with "insufficient balance" (no lead's fault, so it counts against the
//    room source's WhatsApp health), and the CEO tops the wallet up.
//
// channelPlan gates the free text on the room source's health (30% of its
// last 20 WhatsApp sends from the last day failed), and says the template
// still goes so its sends show the number is fine again and the share
// recovers (stress2, round 1). In the pilot the template lane needs the
// short link, which is off, so no room WhatsApp goes at all once the
// health trips: the share never moves, and every lead's link goes by email
// (or is read out) for the rest of the day after the wallet is full again.
// The Follow-ups page shows "Clear the pause" only for the follow-ups'
// own pause (FollowupsPage.tsx sourcePause(..., "followup")), so no manager
// is shown the rooms' pause or a way to clear it.
// ---------------------------------------------------------------------------

describe("m1 providers r1: an empty wallet trips the rooms' WhatsApp health", () => {
  test("room-wa-health-never-recovers-with-template-off: free-text links stay off for the day after the wallet is topped up", async () => {
    const w = world("meet");
    const dry = { meta: "WhatsApp message failed: insufficient balance in the wallet. Recharge to continue sending." } as const;
    // Ten minutes of an empty wallet: five test sends, each a free text that fails (the email then goes).
    for (let i = 0; i < 5; i++) {
      const LEAD = `stress-m1p-wallet-${i}`;
      w.addLead({ id: LEAD, inboundAgoMs: 2 * HOUR, text: dry, email_out: "sent" });
      const id = await w.opened(LEAD);
      expect(w.room(id).link_channels).toEqual(["email"]);
      await w.rooms.actions["room.end"]!(setter, { room_id: id, reason: "cancel", version: Number(w.room(id).version) });
      w.clock.now += 2 * MIN;
    }
    // The wallet is topped up. Two hours later a lead with an open window gets a link.
    w.clock.now += 2 * HOUR;
    const LEAD = "stress-m1p-wallet-after";
    w.addLead({ id: LEAD, inboundAgoMs: 30 * MIN, text: "delivered", email_out: "sent" });
    const id = await w.opened(LEAD);
    const r = w.room(id);
    // Six hours after it ran dry (16:10 on the lead's clock), still the same.
    await w.rooms.actions["room.end"]!(setter, { room_id: id, reason: "cancel", version: Number(w.room(id).version) });
    w.clock.now += 4 * HOUR;
    const LATER = "stress-m1p-wallet-later";
    w.addLead({ id: LATER, inboundAgoMs: 30 * MIN, text: "delivered", email_out: "sent" });
    const id2 = await w.opened(LATER);
    const r2 = w.room(id2);
    expect(
      { twoHoursLater: r.link_channels, sixHoursLater: r2.link_channels },
      "the wallet was topped up, and two hours and six hours later a lead inside their WhatsApp window still gets the link " +
        `by ${JSON.stringify(r.link_channels)} / ${JSON.stringify(r2.link_channels)}: with the template lane off nothing can show WhatsApp is ` +
        "fine again, and no manager is shown the rooms' pause or a way to clear it",
    ).toEqual({ twoHoursLater: ["whatsapp_text"], sixHoursLater: ["whatsapp_text"] });
  });
});
