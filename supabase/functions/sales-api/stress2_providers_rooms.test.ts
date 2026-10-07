// bun test supabase/functions/sales-api/stress2_providers_rooms.test.ts
//
// Second series, round 1, provider quirks on sales-api's side (rooms.ts):
// what HighLevel and Meta really answer, run through the real room module on
// testfakes.ts. The message service is modelled as index.ts convoSend and
// sendTemplate store their rows (source "room", the row first, then the
// outcome): a send Meta failed after HighLevel took it comes back as a
// "failed" row with Meta's words (the read-back saw it failed); a send
// HighLevel refused with a 429 is a "failed" row and a certain refusal
// ("HighLevel did not send it"). HighLevel's contact read of a contact it
// merged away or deleted throws GhlError("HighLevel said 400: ...", 400), as
// liveio.ts ghl does.
//
// A test that fails here is a finding; once fixed it stays as a regression
// test. Nothing leaves this process. Every lead and line is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, LANE_COPY } from "./roomlogic.ts";
import { makeRooms, ROOMS_COPY, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** Meta's own words for per-lead failures, as HighLevel shows them on the failed message. */
const META_NOT_ON_WHATSAPP = "Message Undeliverable. (131026)";
const META_PER_USER_LIMIT = "This message was not delivered to maintain healthy ecosystem engagement. (131049)";

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** What one send does: goes, fails at Meta (a 200 whose message failed), or is refused by HighLevel with a 429. */
type Outcome = "ok" | { meta: string } | "429";

interface Lead {
  id: string;
  /** The lead's last WhatsApp to us, this long ago (null: never: the 24-hour window is shut). */
  inboundAgoMs: number | null;
  text?: Outcome;
  template?: Outcome;
  email?: Outcome;
  /** HighLevel no longer has this contact (merged or deleted): its contact read answers this status. */
  gone?: number;
}

function world() {
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
      // HighLevel's answer for a contact it merged away or deleted.
      if (l.gone) throw new GhlError(`HighLevel said ${l.gone}: Contact not found`, l.gone);
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
    if (o === "429") {
      // HighLevel's API rate limit on POST /conversations/messages (or the
      // workflow enrolment): certainly not sent, the row is failed.
      row.state = "failed";
      row.error = "HighLevel said 429: Too many requests";
      throw new ApiRefusal(`HighLevel did not send it: ${row.error}`, 502, { certain: true });
    }
    if (typeof o === "object") {
      // HighLevel took it; the read-back saw Meta fail it for this lead.
      row.state = "failed";
      row.provider_status = "failed";
      row.error = o.meta;
      return { message: { ...row } };
    }
    delivered.push({ lead: contactId, lane });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
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
    markAppointment: async () => {
      throw new Error("no mark in these tests");
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
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
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
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
    });
    return String((out.room as Row).id);
  }
  /** A room for the lead, made, opened by the worker and its link sent; then ended, so the setter can make the next. */
  async function call(contactId: string): Promise<Row> {
    const id = await make(contactId);
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await drain();
    const after = { ...room(id) };
    await rooms.actions["room.end"]!(setter, { room_id: id, version: Number(room(id).version), reason: "end" }).catch(() => null);
    w.clock.now += 10 * MIN;
    return after;
  }
  return { ...w, rooms, room, addLead, make, workerOpens, call, drain, delivered };
}

async function outcome(p: Promise<Row>): Promise<{ ok: true; value: Row } | { ok: false; status: number; message: string; extra: Row }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    if (e instanceof ApiRefusal) return { ok: false, status: e.status, message: e.message, extra: e.extra };
    return { ok: false, status: 500, message: String((e as Error)?.message ?? e), extra: {} };
  }
}

// ---------------------------------------------------------------------------
// 1. One lead whose number is not on WhatsApp (Meta 131026) and one HighLevel
//    rate limit (429) switch WhatsApp off for every lead's room link.
//
// The room source's WhatsApp health (roomWhatsappHealth, C27) counts every
// "failed" room row of the last day: Meta's per-lead answers (131026 not on
// WhatsApp, 131049 the per-person limit) and HighLevel's own 429 alike, though
// neither says anything about the number or the template. With the defaults
// (20 sends, 30%, at least 5), 2 failures in the day's first 5 room sends put
// the share at 40%, and channelPlan skips both WhatsApp lanes for every lead
// ("WhatsApp video links are failing"): links go by email, or are read out
// for a lead with no email. Nothing then goes on WhatsApp, so no new send
// dilutes the share: it stays shut until the two failures are a day old.
// ---------------------------------------------------------------------------

describe("providers2: per-lead WhatsApp failures and the room source's health", () => {
  test("room-wa-health-counts-lead-failures: a lead not on WhatsApp and one 429 do not take WhatsApp away from every other lead", async () => {
    const w = world();
    // The day's first room links.
    w.addLead({ id: "stress-prov-l1", inboundAgoMs: null, template: { meta: META_NOT_ON_WHATSAPP } }); // a landline: the template fails at Meta, email goes
    w.addLead({ id: "stress-prov-l2", inboundAgoMs: HOUR });
    w.addLead({ id: "stress-prov-l3", inboundAgoMs: HOUR, text: "429" }); // HighLevel's rate limit for a second: the template goes instead
    w.addLead({ id: "stress-prov-l4", inboundAgoMs: HOUR });
    for (const l of ["stress-prov-l1", "stress-prov-l2", "stress-prov-l3", "stress-prov-l4"]) await w.call(l);
    // Every one of those leads got the link: l2 and l4 on WhatsApp in their window.
    expect(new Set(w.delivered.map(d => d.lead)).size).toBe(4);
    expect(w.delivered.filter(d => d.lead === "stress-prov-l2").map(d => d.lane)).toEqual(["text"]);
    expect(w.delivered.filter(d => d.lead === "stress-prov-l4").map(d => d.lane)).toEqual(["text"]);
    const failed = w.db.t("cockpit_sales_messages").filter(m => m.source === "room" && m.channel === "whatsapp" && m.state === "failed");
    expect(failed.map(m => m.error)).toEqual([META_NOT_ON_WHATSAPP, "HighLevel said 429: Too many requests"]);

    // The next lead wrote to us on WhatsApp ten minutes ago and is waiting for the link there.
    w.addLead({ id: "stress-prov-l5", inboundAgoMs: 10 * MIN });
    const r5 = await w.call("stress-prov-l5");
    // Hours later, another lead in their window.
    w.clock.now += 5 * HOUR;
    w.addLead({ id: "stress-prov-l6", inboundAgoMs: 5 * MIN });
    const r6 = await w.call("stress-prov-l6");
    const lanes = (lead: string) => w.delivered.filter(d => d.lead === lead).map(d => d.lane);
    const why = `l5 went by ${JSON.stringify(lanes("stress-prov-l5"))} (channels ${JSON.stringify(r5.link_channels)}), l6 by ${JSON.stringify(lanes("stress-prov-l6"))}`;
    expect(lanes("stress-prov-l5"), why).toContain("text");
    expect(lanes("stress-prov-l6"), why).toContain("text");
  });

  test("HELD (control): with no per-lead failure the same day's fifth lead gets WhatsApp", async () => {
    const w = world();
    for (const l of ["stress-prov-c1", "stress-prov-c2", "stress-prov-c3", "stress-prov-c4"]) {
      w.addLead({ id: l, inboundAgoMs: HOUR });
      await w.call(l);
    }
    w.addLead({ id: "stress-prov-c5", inboundAgoMs: 10 * MIN });
    await w.call("stress-prov-c5");
    expect(w.delivered.filter(d => d.lead === "stress-prov-c5").map(d => d.lane)).toEqual(["text"]);
  });

  test("room-wa-health-counts-lead-failures: two leads at Meta's per-person limit (131049) the same morning", async () => {
    const w = world();
    w.addLead({ id: "stress-prov-m1", inboundAgoMs: null, template: { meta: META_PER_USER_LIMIT } });
    w.addLead({ id: "stress-prov-m2", inboundAgoMs: null, template: { meta: META_PER_USER_LIMIT } });
    w.addLead({ id: "stress-prov-m3", inboundAgoMs: HOUR });
    w.addLead({ id: "stress-prov-m4", inboundAgoMs: HOUR });
    w.addLead({ id: "stress-prov-m5", inboundAgoMs: HOUR });
    for (const l of ["stress-prov-m1", "stress-prov-m2", "stress-prov-m3", "stress-prov-m4", "stress-prov-m5"]) await w.call(l);
    w.addLead({ id: "stress-prov-m6", inboundAgoMs: 10 * MIN });
    const r6 = await w.call("stress-prov-m6");
    const lanes = w.delivered.filter(d => d.lead === "stress-prov-m6").map(d => d.lane);
    expect(lanes, `m6 went by ${JSON.stringify(lanes)}; the room said ${JSON.stringify(r6.refusal ?? null)}`).toContain("text");
  });
});

// ---------------------------------------------------------------------------
// 2. A contact HighLevel merged away or deleted. HighLevel answers its
//    contact read with a 400 ("Contact not found"; 404 on some routes), an
//    answer, not an outage. readContact turns every failure into null, so
//    room.create refuses with contact_unread ("HighLevel did not answer, so
//    we cannot check this lead yet. Try again in a minute.", 503, retry) and
//    a room whose lead was merged after it was made says "HighLevel did not
//    answer, so the link has not gone yet. It is tried again in a minute."
//    and is asked again every minute until it closes. The rep retries a
//    lead that no longer exists, and is never told to find the lead again.
// ---------------------------------------------------------------------------

describe("providers2: a contact HighLevel merged or deleted", () => {
  for (const status of [400, 404]) {
    test(`deleted-contact-read-as-highlevel-down: room.create for a contact HighLevel answers ${status} for`, async () => {
      const w = world();
      w.addLead({ id: "stress-prov-gone", inboundAgoMs: HOUR, gone: status });
      const out = await outcome(w.make("stress-prov-gone"));
      expect(out.ok).toBe(false);
      if (out.ok) return;
      const said = `${out.status} ${JSON.stringify(out.message)} retry=${String(out.extra.retry)}`;
      expect(out.message, said).not.toBe(LANE_COPY.contact_unread);
      expect(out.extra.retry === true && out.status === 503, said).toBe(false);
    });
  }

  test("deleted-contact-read-as-highlevel-down: the lead is merged away after the room was made", async () => {
    const w = world();
    const lead: Lead = { id: "stress-prov-merged", inboundAgoMs: HOUR };
    w.addLead(lead);
    const id = await w.make(lead.id);
    await w.workerOpens(id);
    // HighLevel merges the duplicate (the lead filled a form again) while the worker makes the room.
    lead.gone = 400;
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.drain();
    for (let i = 0; i < 3; i++) {
      w.clock.now += 61 * S;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.drain();
    }
    const r = w.room(id);
    expect(r.link_sent_at ?? null).toBeNull();
    expect(String(r.refusal ?? ""), `the panel says ${JSON.stringify(r.refusal)}`).not.toBe(ROOMS_COPY.contact_unread_send);
  });
});

// ---------------------------------------------------------------------------
// 3. A closer whose other Zoom meeting ended right after the host check.
//    rooms.py zoom_seat stores zoom_live_until as at least the next check plus
//    five minutes (check + 900 s), whatever the meeting's own end (see
//    hermes/sales-desk/tests/test_stress2_providers.py, section 6). The row
//    below is what it wrote at 10:00 for a call that ended at 10:01; at 10:05
//    createRefusal reads it as "in another meeting" and refuses the Zoom room
//    the worker would make (it reads Zoom's live list itself at the create).
// ---------------------------------------------------------------------------

describe("providers2: a host whose other Zoom meeting has ended", () => {
  test("zoom-live-floor-refuses-free-host: a Zoom room five minutes after the other meeting ended", async () => {
    const w = world();
    const CLOSER = "closer@stress.invalid";
    const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Cara Closer", role: "closer", ghl_user_id: "G-closer" };
    const checkedAt = w.clock.now - 5 * MIN;
    w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Cara Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
    w.db.seed("cockpit_sales_room_hosts", [
      {
        email: CLOSER,
        zoom_user_id: "Z-closer",
        zoom_status: "licensed",
        google_ok: true,
        checked_at: new Date(checkedAt).toISOString(),
        // Fixed in fix round 1: rooms.py stores the meeting's own end when it
        // is still ahead (10:01), and the floor (10:15) only for a meeting
        // already past its slot; the presence view holds the floor for
        // presence from checked_at.
        zoom_live_until: new Date(checkedAt + 1 * MIN).toISOString(),
      },
    ]);
    w.addLead({ id: "stress-prov-z1", inboundAgoMs: HOUR });
    const out = await outcome(
      w.rooms.actions["room.create"]!(closer, {
        request_id: crypto.randomUUID(),
        contact_id: "stress-prov-z1",
        provider: "zoom",
        call_kind: "demo",
        purpose: "manual",
      }),
    );
    expect(out.ok, out.ok ? "" : `refused ${out.status}: ${JSON.stringify(out.message)} (the other meeting ended four minutes ago)`).toBe(true);
  });
});
