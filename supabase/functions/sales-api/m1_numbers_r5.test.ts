// bun test supabase/functions/sales-api/m1_numbers_r5.test.ts
//
// Milestone 1, video-link round 5, NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3), the WhatsApp gate open (the link goes by
// WhatsApp free text inside the lead's window, then email). What must hold:
// every send leaves exactly one audit row, and the row says who sent it.
//
// This round's angle: "Send by email" pressed while the room's own link is
// still on its way. The panel offers it then (lib/rooms.ts: a lead, not
// retrying, no email yet, no refusal), and room.send takes it (the room's
// own link in flight counts one of the lead's links this hour, nothing
// more). The rep's email goes on the room's email key 0 with its room.send
// row. When the room's own WhatsApp then fails, the cascade (sendLinkHeld)
// moves to the email lane, whose current key is that same key 0: the
// message service answers the rep's email as a repeat, and the cascade
// treats the repeat as its own send (auditLink: a room.link row naming
// email, written by the desk), so one email has two audit rows.
// lateSend already reads a repeat as "nothing new went"; the first
// cascade does not.
//
// And a link HighLevel turns away for a passing reason (it did not answer,
// a 429) is re-asked every minute: recordNotSent says a reason only when it
// differs from the one on the room, and its "Not sent" line has no dedupe
// key, so two reasons that take turns write a room.link.not_sent audit row
// and a timeline line every minute for one link that then goes.
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts. Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
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
const LEAD = "stress-m1num5-lead-0001";
const SETTER = "setter-m1num5@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
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

/** Meta's refusal for a number that is not on WhatsApp: certain, final for this lead. */
const NOT_ON_WHATSAPP = "WhatsApp refused it: this number is not on WhatsApp (131026)";

function world(o: { gate?: boolean } = {}) {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; body: string }[] = [];
  /**
   * onText: runs once when the room's WhatsApp text is asked for, before
   * HighLevel answers. emails: how each next email send ends ("not_yet":
   * HighLevel's contact read did not answer, nothing written, index.ts
   * notSentYet; "busy": HighLevel answered 429, the row failed; "ok").
   */
  const hooks: { onText: (() => Promise<void>) | null; textFails: string | null; emails: ("not_yet" | "busy" | "ok")[] } = {
    onText: null,
    textFails: null,
    emails: [],
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    // The gate open (a manager confirmed the WA Connector is off and the
    // single-copy test passed), or shut as production has it today (the link
    // goes by email).
    {
      key: "whatsapp_guard",
      value:
        o.gate === false
          ? { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 }
          : { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [
    { worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() },
  ]);
  // The lead wrote an hour ago: WhatsApp free text is open.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
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
  // The message service's one rule (one request id, one message), as index.ts keeps it.
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    if (lane === "text" && hooks.onText) {
      const run = hooks.onText;
      hooks.onText = null;
      await run();
    }
    if (lane === "email" && hooks.emails.length) {
      const how = hooks.emails.shift();
      if (how === "not_yet")
        throw new ApiRefusal(
          "Not sent: HighLevel or the database did not answer before anything went (HighLevel timed out after 25 s). Try again in a minute.",
          503,
          { certain: true, retry: true, code: "not_sent_yet" },
        );
      if (how === "busy") {
        const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "failed", error: "HighLevel said 429: Too many requests", created_at: at(), ...extra };
        msgRows.set(requestId, row);
        w.db.t("cockpit_sales_messages").push(row);
        // index.ts convoSend: HighLevel answered and refused it (certain, never "may have gone").
        throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
      }
    }
    if (lane === "text" && hooks.textFails) {
      const why = hooks.textFails;
      const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "failed", error: why, created_at: at(), ...extra };
      msgRows.set(requestId, row);
      w.db.t("cockpit_sales_messages").push(row);
      throw new ApiRefusal(`Not sent: ${why}.`, 422);
    }
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lane, requestId, body });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) =>
      send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room", subject: b.subject ?? null }),
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
  async function make(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    return String((out.room as Row).id);
  }
  /** The worker opens the room and says ready: the link's cascade runs (WhatsApp text first). */
  async function ready(id: string) {
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
  }
  /** Audit rows that record an email of the link going to the lead: room.send, or room.link naming email. */
  const emailRows = (id: string) =>
    audits
      .filter(
        a =>
          a.entityId === id &&
          (a.action === "room.send" ||
            (a.action === "room.link" && Array.isArray((a.after as Row | undefined)?.link_channels) &&
              ((a.after as Row).link_channels as string[]).includes("email") &&
              !((a.before as Row | undefined)?.link_channels as string[] | undefined)?.includes?.("email"))),
      )
      .map(a => `${String(a.action)} by ${String(a.who)}`);
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  const count = (id: string, action: string) => audits.filter(a => a.entityId === id && a.action === action).length;
  const lines = (id: string, kind: string) => w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === kind).length;
  return { ...w, rooms, audits, delivered, hooks, room, make, ready, emailRows, tick, count, lines };
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

describe("Send by email pressed while the room's own link is on its way", () => {
  test("control: the room's WhatsApp text goes, then Also send by email: one WhatsApp, one email, one room.send row for the email", async () => {
    const w = world();
    const id = await w.make();
    await w.ready(id);
    const out = await answer(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
    await w.flush();
    expect(out.refused).toBeNull();
    expect({
      whatsapp: w.delivered.filter(d => d.lane === "text").length,
      emails: w.delivered.filter(d => d.lane === "email").length,
      email_rows: w.emailRows(id),
    }).toEqual({ whatsapp: 1, emails: 1, email_rows: [`room.send by ${SETTER}`] });
  });

  test("the rep's email goes while the WhatsApp text is with HighLevel, then WhatsApp refuses the number: one email, and one audit row for it", async () => {
    const w = world();
    const id = await w.make();
    let pressed: { ok: Row | null; refused: ApiRefusal | null } | null = null;
    // The panel shows the link on its way and offers Send by email; the rep
    // presses it while the room's WhatsApp text is still with HighLevel.
    w.hooks.onText = async () => {
      pressed = await answer(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
    };
    w.hooks.textFails = NOT_ON_WHATSAPP;
    await w.ready(id);
    await w.flush();
    // The rep's press went through and the email reached the lead once.
    expect(pressed).not.toBeNull();
    expect((pressed as unknown as { refused: ApiRefusal | null }).refused).toBeNull();
    expect(w.delivered.filter(d => d.lane === "email").length).toBe(1);
    // Found: two rows for the one email, the rep's room.send and the desk's
    // room.link (the cascade read the message service's repeat of the rep's
    // email as its own send).
    expect(w.emailRows(id)).toEqual([`room.send by ${SETTER}`]);
  });
});

describe("a link HighLevel keeps turning away for a passing reason is said once per reason", () => {
  test("control: HighLevel does not answer for three minutes in a row, then takes the email: one not-sent row, one line, one link row", async () => {
    const w = world({ gate: false });
    w.hooks.emails = ["not_yet", "not_yet", "not_yet"];
    const id = await w.make();
    await w.ready(id);
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      await w.tick(id);
      await w.flush();
    }
    expect({
      emails: w.delivered.filter(d => d.lane === "email").length,
      not_sent_rows: w.count(id, "room.link.not_sent"),
      not_sent_lines: w.lines(id, "link.not_sent"),
      link_rows: w.count(id, "room.link"),
    }).toEqual({ emails: 1, not_sent_rows: 1, not_sent_lines: 1, link_rows: 1 });
  });

  test("HighLevel alternates between not answering and 429 for six minutes, then takes the email: the two reasons are said once each, not once a minute", async () => {
    const w = world({ gate: false });
    w.hooks.emails = ["not_yet", "busy", "not_yet", "busy", "not_yet", "busy"];
    const id = await w.make();
    await w.ready(id);
    for (let i = 0; i < 6; i++) {
      w.clock.now += MIN;
      await w.tick(id);
      await w.flush();
    }
    // Found: a room.link.not_sent audit row and a "Not sent" timeline line
    // every minute (recordNotSent says a reason again whenever it differs
    // from the one just before, and its line has no dedupe key), so one link
    // that went leaves six "not sent" rows in the ledger.
    expect({
      emails: w.delivered.filter(d => d.lane === "email").length,
      not_sent_rows: w.count(id, "room.link.not_sent"),
      not_sent_lines: w.lines(id, "link.not_sent"),
      link_rows: w.count(id, "room.link"),
    }).toEqual({ emails: 1, not_sent_rows: 2, not_sent_lines: 2, link_rows: 1 });
  });
});
