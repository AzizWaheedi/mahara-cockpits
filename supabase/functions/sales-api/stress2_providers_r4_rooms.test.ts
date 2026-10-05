// bun test supabase/functions/sales-api/stress2_providers_r4_rooms.test.ts
//
// Second series, round 4, provider quirks on sales-api's side. Each runs the
// real modules (rooms.ts, roomlogic.ts) on testfakes.ts with the providers'
// own answer shapes, the way index.ts hands them on. A failing test is a
// finding; once fixed it stays as a regression test. Nothing leaves this
// process; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-p4@stress.invalid";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=stress";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * index.ts ghl()'s own error for a HighLevel answer that was not a success:
 * a plain Error carrying the status (never GhlError, never a Refusal). This
 * is what sendTemplate and convoSend throw when their contact read (GET
 * /contacts/{id}), which runs before any message row is written, gets a 502.
 */
const indexGhlError = (status: number, msg: string) => Object.assign(new Error(`HighLevel said ${status}: ${msg}`), { status });

type ContactKnob = "ok" | "gone";
type PreSendKnob = "ok" | "502";

function world() {
  const w = fakeWorld();
  const jobs: Promise<unknown>[] = [];
  const knobs = {
    contact: "ok" as ContactKnob,
    /** HighLevel's answer to the contact read inside the message service, before its message row. */
    templateRead: "ok" as PreSendKnob,
    textRead: "ok" as PreSendKnob,
  };
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
      // HighLevel's answer for a contact merged into another (or deleted):
      // a 400 whose words say the contact is not found (rooms.ts
      // contactGoneAnswer reads it as gone).
      if (knobs.contact === "gone") throw new GhlError("HighLevel said 400: Contact not found", 400);
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
  /** The message service as index.ts runs it: the contact read first (no row yet), then the row, then HighLevel. */
  async function send(lane: "text" | "template" | "email", requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    // index.ts sendTemplate / convoSend: GET /contacts/{id} through ghl(),
    // before takeSlot writes the message row. Found: a 502 here was thrown as
    // it is. Fixed (stress2 round 4): index.ts's beforeRowCertain answers it
    // as a certain "not sent yet" (503, code not_sent_yet, retry), which is
    // what this fake now throws (stress_numbers_sendtemplate.test.ts checks
    // index.ts itself).
    if ((lane === "template" && knobs.templateRead === "502") || (lane === "text" && knobs.textRead === "502"))
      throw new ApiRefusal(
        `Not sent: HighLevel or the database did not answer before anything went (${indexGhlError(502, "Bad Gateway").message}). Try again in a minute.`,
        503,
        { certain: true, retry: true, code: "not_sent_yet" },
      );
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lead: contactId, lane });
    row.ghl_message_id = `msg-${String(row.id).slice(0, 8)}`;
    row.state = lane === "template" ? "delivered" : "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }
  const marks: Row[] = [];
  const audits: { action: string; after: unknown }[] = [];
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async (_who, action, _t, _id, _b, after) => {
      audits.push({ action, after });
    },
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
    sentSince: async () => false,
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
  const lines = (id: string) =>
    w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id)
      .map(e => String(e.text ?? ""));
  return { ...w, rooms, room, addLead, workerOpens, tick, drain, delivered, marks, knobs, audits, lines };
}

async function fallbackRoom(w: ReturnType<typeof world>, lead: string, apptId: string, startMs: number): Promise<string> {
  w.db.seed("cockpit_sales_appointments", [
    { appointment_id: apptId, contact_id: lead, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(startMs).toISOString(), assigned_user_id: "G-setter" },
  ]);
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: lead,
    provider: "zoom",
    call_kind: "intro",
    purpose: "fallback",
    trigger: "no_answer",
    appointment_id: apptId,
  });
  const id = String((out.room as Row).id);
  await w.workerOpens(id);
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  await w.drain();
  return id;
}

// ---------------------------------------------------------------------------
// 1. A lead merged into another contact in HighLevel (or deleted) after the
//    room's link went and nobody joined: the settle of the booked intro.
//
// HighLevel answers the merged-away id with a 400 "Contact not found"
// (contactGoneAnswer reads it as gone, and the link and the count already
// say "merged or deleted" for it). settle() reads the contact with
// readContact, which turns "gone" into null, and null is "the contact could
// not be read": the event is released, the sweep posts it again each
// minute, and after ten tries it gives up with "the no-show could not be
// written (sales-api or HighLevel did not answer)" (20261004a sweep E0) and
// "Not settled: the no-show could not be written after ten tries." HighLevel
// did answer: the lead is merged or deleted. Ten useless tries, and a person
// is told the wrong cause.
// ---------------------------------------------------------------------------

describe("providers2 r4: the settle of a lead HighLevel merged away", () => {
  async function expiredRoom(gone: boolean) {
    const w = world();
    const LEAD = gone ? "stress-p2r4-merged" : "stress-p2r4-merged-control";
    w.addLead(LEAD, 2 * HOUR);
    const START = w.clock.now - 1 * MIN;
    const id = await fallbackRoom(w, LEAD, gone ? "intro-merged" : "intro-merged-control", START);
    expect(Boolean(w.room(id).link_sent_at)).toBe(true);
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(w.clock.now + 2 * MIN).toISOString(), handled_at: new Date(w.clock.now + 2 * MIN).toISOString(), detail: {} },
    ]);
    Object.assign(w.room(id), {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      ended_at: new Date(w.clock.now + 12 * MIN).toISOString(),
      host_in_at: new Date(START + 3 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now = START + 25 * MIN;
    if (gone) w.knobs.contact = "gone";
    return { w, id, LEAD };
  }

  async function settleOnce(w: ReturnType<typeof world>, id: string): Promise<Row> {
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.drain();
    return ((out.results as Row[]) ?? [])[0] ?? {};
  }

  test("HELD (control): the same room for a lead HighLevel still has is settled a no-show", async () => {
    const { w, id } = await expiredRoom(false);
    const r = await settleOnce(w, id);
    expect([r.handled, w.marks.filter(m => m.status === "noshow").length]).toEqual([true, 1]);
  });

  test("settle-merged-contact-retried-as-outage: HighLevel's 'Contact not found' is final, never ten tries and 'did not answer'", async () => {
    const { w, id } = await expiredRoom(true);
    const tries: Row[] = [];
    for (let i = 0; i < 10; i++) {
      tries.push(await settleOnce(w, id));
      w.clock.now += 70 * S;
    }
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `sweep.settle:${id}`) as Row;
    const alerts = w.db.t("cockpit_sales_alerts").filter(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`));
    expect(
      {
        // Final on the first try: handled, with a reason that names the merge (or the intro marked by its appointment).
        firstHandled: tries[0]?.handled,
        stillWaiting: !ev.handled_at,
        releasedAsUnread: tries.filter(t => t.skipped === "contact not read").length,
      },
      `HighLevel answered "Contact not found" for the merged lead; settle() read it as "the contact could not be read" ` +
        `${tries.filter(t => t.skipped === "contact not read").length} times in a row and released the event each time, so the sweep's ` +
        "tenth try gives it up as 'the no-show could not be written (sales-api or HighLevel did not answer)'. " +
        `alerts raised by sales-api: ${alerts.length}; marks: ${w.marks.length}`,
    ).toEqual({ firstHandled: true, stillWaiting: false, releasedAsUnread: 0 });
  });
});

// ---------------------------------------------------------------------------
// 2. HighLevel's 502 on the contact read inside the message service, before
//    any message row is written (index.ts sendTemplate reads GET
//    /contacts/{id} through ghl() and throws its Error(status 502) as it is;
//    convoSend does the same). Nothing was sent: the workflow was never
//    asked, no row exists.
//
// rooms.ts sendOn classifies every thrown status >= 500 as "the send may
// have gone" (unclearSend). On the template lane (the lead's 24-hour window
// is shut, the usual case for a booked intro's fallback room) that is
// unclearTemplate: the email goes as the "backup" of a template that never
// went, link_unconfirmed_at is set, and the timeline says "The WhatsApp
// template was not seen in time, so the link went by email too." The rep
// is told to look for a WhatsApp message that was never sent, the panel
// says the link is not confirmed though the email went, and the template
// itself is never tried again (link_sent_at stands).
// ---------------------------------------------------------------------------

describe("providers2 r4: HighLevel's 502 on the contact read before the template", () => {
  test("HELD (control): with HighLevel answering, the template goes and nothing is unconfirmed", async () => {
    const w = world();
    const LEAD = "stress-p2r4-presend-control";
    w.addLead(LEAD, 3 * 24 * HOUR);
    const id = await fallbackRoom(w, LEAD, "intro-presend-control", w.clock.now + 2 * MIN);
    expect([w.room(id).link_channels, Boolean(w.room(id).link_unconfirmed_at)]).toEqual([["whatsapp_template"], false]);
  });

  test("pre-send-highlevel-502-read-as-unseen-template: a template never sent is never said as 'not seen in time'", async () => {
    const w = world();
    const LEAD = "stress-p2r4-presend";
    w.addLead(LEAD, 3 * 24 * HOUR); // window shut: the template lane, then email
    w.knobs.templateRead = "502";
    const id = await fallbackRoom(w, LEAD, "intro-presend", w.clock.now + 2 * MIN);
    const templateRows = w.db.t("cockpit_sales_messages").filter(m => m.contact_id === LEAD && m.via === "workflow");
    const said = w.lines(id).filter(t => /template was not seen|did not confirm the template/i.test(t));
    const unclearAudit = w.audits.some(a => (a.after as Row | null)?.template_unclear === true);
    // HighLevel answers again a minute later: nothing ever tries the template.
    w.knobs.templateRead = "ok";
    for (let i = 0; i < 3; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const lanes = w.delivered.filter(d => d.lead === LEAD).map(d => d.lane);
    expect(
      {
        unconfirmed: Boolean(w.room(id).link_unconfirmed_at),
        saidNotSeen: said.length,
        auditedAsUnclearTemplate: unclearAudit,
      },
      `the template was never sent (no message row: ${templateRows.length}; the 502 came from the contact read before it), yet the room ` +
        `went ${JSON.stringify(w.room(id).link_channels)} with link_unconfirmed_at set, the timeline said ${JSON.stringify(said)}, and the ` +
        `template was never tried again once HighLevel answered (lanes after: ${JSON.stringify(lanes)})`,
    ).toEqual({ unconfirmed: false, saidNotSeen: 0, auditedAsUnclearTemplate: false });
  });

  test("pre-send-highlevel-502-read-as-may-have-gone: the free text that never left is not said as 'may have gone'", async () => {
    const w = world();
    const LEAD = "stress-p2r4-presend-text";
    w.addLead(LEAD, 2 * HOUR); // window open: the free text first
    w.knobs.textRead = "502";
    const id = await fallbackRoom(w, LEAD, "intro-presend-text", w.clock.now + 2 * MIN);
    const textRows = w.db.t("cockpit_sales_messages").filter(m => m.contact_id === LEAD && m.channel === "whatsapp");
    const first = { refusal: String(w.room(id).refusal ?? ""), sent: Boolean(w.room(id).link_sent_at) };
    // HighLevel answers again: the minute's re-ask plans afresh (no row says anything went).
    w.knobs.textRead = "ok";
    w.clock.now += 70 * S;
    await w.tick(id);
    const later = { sent: Boolean(w.room(id).link_sent_at), channels: w.room(id).link_channels };
    // Fixed (stress2 round 4): nothing is said to have gone, the channel
    // waits for the minute's re-ask (never passed over for the next one),
    // and the re-ask sends the free text once HighLevel answers.
    expect(
      { first, later },
      `no free text was sent (rows: ${textRows.length}); the room's refusal tells the rep it may have gone and to check the conversation, ` +
        `and the cascade stopped (no template, no email) until the minute's re-ask, which then sent it: ${JSON.stringify(later)}`,
    ).toEqual({ first: { refusal: expect.not.stringMatching(/may have gone/i), sent: false }, later: { sent: true, channels: ["whatsapp_text"] } });
  });
});

// Keep ApiRefusal referenced: index.ts's certain refusal is the other shape a pre-send failure could take.
void ApiRefusal;
