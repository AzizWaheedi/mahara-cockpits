// bun test supabase/functions/sales-api/m1_concurrency_r5.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 5, angle:
// concurrency and idempotency. Round 4c made "Use Meet" / "Try Zoom" one
// server step (room.create naming the room it replaces: replaces,
// replaces_version). This file presses it beside the other things that
// touch the same room in the same seconds: "We are on the phone" and "End
// room" from the other tab (the lead page and the dialer both show the
// panel), the sweep's minute that claims a link nobody asked for and sends
// it, and the same press twice.
//
// The pilot's settings (m1-scope.md section 3): rooms on, both providers,
// the three lanes on, test_only with the lead on the test list,
// count_on_join, settle, wrap and auto_on_miss off, short_link off, live
// handover off; the WhatsApp gate locked, so the link goes by email.
//
// A failing test is a finding. Nothing here reaches HighLevel, Zoom, Google
// or Slack; every lead and seat is invented (stress-..., @stress.invalid).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "stress-m1c5-setter@stress.invalid";
const CLOSER = "stress-m1c5-closer@stress.invalid";
const LEAD = "stress-m1c5-lead";
const ZOOM_URL = "https://us06web.zoom.us/j/85012340505?pwd=stress";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));

function world() {
  const w = fakeWorld();
  const audits: Row[] = [];
  const delivered: { requestId: string; body: string; at: number }[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
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
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const sent = new Map<string, Row>();
  async function send(requestId: string, contactId: string, channel: string, body: string, beforeSend?: () => Promise<boolean>) {
    const again = sent.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: w.db.iso() };
    sent.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend())) {
      sent.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    Object.assign(row, { ghl_asked_at: w.db.iso(), state: "sent", provider_status: "sent", ghl_message_id: `msg-${requestId.slice(-6)}` });
    delivered.push({ requestId, body, at: w.clock.now });
    return { message: { ...row } };
  }
  const io: LiveIO = {
    ...w.io,
    sleep: async ms => {
      w.clock.now += ms;
      await turn();
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, opts?.beforeSend),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join: ${t.buttonVariable?.join_code ?? ""}`, t.beforeSend),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /**
   * The room worker beside a press: claims the requested room and opens it.
   * `ready: false` is a worker.ready that never reached sales-api (the
   * worker's one 4 s call timed out), so nobody claims the link until the
   * sweep's minute does (roomlogic reaskPlan claim_link).
   */
  function workerBeside(o: { ready?: boolean } = {}) {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
          method: "PATCH",
          body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
        });
        await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
          method: "POST",
          body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
          prefer: "resolution=ignore-duplicates",
        });
        const cur = room(id);
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
          method: "PATCH",
          body: {
            state: "open",
            join_url: cur.provider === "zoom" ? ZOOM_URL : MEET_URL,
            provider_meeting_id: cur.provider === "zoom" ? "85012340505" : `evt-${id.slice(-4)}`,
            opened_at: w.db.iso(),
            host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
            ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
            version: Number(cur.version) + 1,
          },
        });
        if (o.ready === false) {
          // The worker's call never landed: the stored event stays unhandled
          // and the sweep gives it up later; nothing claims the link now.
          await w.db.db(`cockpit_sales_room_events?dedupe_key=eq.worker.ready:${id}`, {
            method: "PATCH",
            body: { handled_at: w.db.iso(), detail: { worker_run: "run-1", gave_up: true } },
          });
          continue;
        }
        await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
      }
    })();
    return {
      stop: async () => {
        stop = true;
        await done;
      },
    };
  }
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turn();
      await w.flush();
    }
  }
  async function made(who: Who, b: Row, o: { ready?: boolean } = {}): Promise<string> {
    const worker = workerBeside(o);
    const out = await rooms.actions["room.create"]!(who, { contact_id: LEAD, request_id: crypto.randomUUID(), ...b });
    await worker.stop();
    await drain();
    return String((out.room as Row).id);
  }
  /** The panel's own read of the room (what a tab shows between its 4-second polls). */
  async function panel(who: Who, id: string): Promise<Row> {
    const out = (await rooms.actions["room.status"]!(who, { room_id: id })) as Row;
    return out.room as Row;
  }
  /** The SQL sweep's minute for this room: room.event kind tick, as the cron door posts it. */
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await drain();
  }
  const toLead = (url: string) => delivered.filter(d => d.body.includes(url));
  return { ...w, io, rooms, audits, delivered, room, workerBeside, drain, made, panel, tick, toLead };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * "Use Meet" as RoomPanel.retry sends it since round 4c (lib/rooms.ts
 * retryAsk): one room.create on the other provider naming the room on show
 * and the version the panel read (replaces, replaces_version).
 */
function useMeetAsk(seen: Row, requestId: string = crypto.randomUUID()): Row {
  const ask: Row = {
    contact_id: seen.contact_id,
    provider: "meet",
    call_kind: seen.call_kind,
    purpose: seen.purpose,
    request_id: requestId,
    replaces: seen.id,
    replaces_version: Number(seen.version),
  };
  if (seen.trigger) ask.trigger = seen.trigger;
  if (seen.attempt_id) ask.attempt_id = seen.attempt_id;
  return ask;
}

describe("m1 concurrency r5: Use Meet beside We are on the phone in the other tab", () => {
  test("control: Use Meet alone on the closer's Zoom room whose link has not gone (link_late): the Zoom room is cancelled, the Meet room is made and its link goes once", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    const seen = await w.panel(closer, id);
    expect({ state: seen.state, sent: seen.link_sent_at ?? null, toLead: w.delivered.length }).toEqual({ state: "open", sent: null, toLead: 0 });
    const worker = w.workerBeside();
    const out = await settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen)));
    await worker.stop();
    await w.drain();
    expect({
      created: out.ok,
      zoom: w.room(id).state,
      live: w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state))).length,
      meetLinks: w.toLead(MEET_URL).length,
      zoomLinks: w.toLead(ZOOM_URL).length,
    }).toEqual({ created: true, zoom: "cancelled", live: 1, meetLinks: 1, zoomLinks: 0 });
  });

  test("m1-conc-r5-use-meet-on-room-closed-by-other-tab-sends-new-link: the closer's Zoom room shows 'Not sent: the link was late' with Use Meet on both tabs (lead page and dialer); the lead rings back and the closer presses We are on the phone on the lead page; the dialer's tab, still showing the panel it read two seconds before, takes the press of Use Meet: no new room may be made and no link may reach the lead who is on the phone", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    // The sweep's minute claims the link it finds never asked for; a Zoom
    // link nobody can say, asked for 95 s after the open, is left to the
    // closer (the panel: "Not sent: the link was late ...", with Send by
    // email and Use Meet).
    await w.tick(id);
    expect({ refusal: w.room(id).refusal, sent: w.room(id).link_sent_at ?? null, toLead: w.delivered.length }).toEqual({
      refusal: "The link was late, so the cockpit left it to you.",
      sent: null,
      toLead: 0,
    });
    // Both tabs read the panel at the same poll.
    const dialerView = await w.panel(closer, id);
    const leadPageView = await w.panel(closer, id);
    // The lead page: We are on the phone (room.end on_phone, the version it read).
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: Number(leadPageView.version), reason: "on_phone" });
    await w.drain();
    expect({ state: w.room(id).state, result: w.room(id).result }).toEqual({ state: "cancelled", result: "moved_to_phone" });
    w.clock.now += 2 * S;
    // The dialer's tab, from its view two seconds old: Use Meet.
    const worker = w.workerBeside();
    const out = await settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(dialerView)));
    await worker.stop();
    await w.drain();
    const fresh = w.db.t("cockpit_sales_rooms").filter(r => r.id !== id);
    expect({
      refused: !out.ok,
      new_rooms: fresh.map(r => `${r.provider}:${r.state}`),
      links_to_lead_on_the_phone: w.delivered.map(d => (d.body.includes(MEET_URL) ? "meet" : d.body.includes(ZOOM_URL) ? "zoom" : "other")),
    }).toEqual({ refused: true, new_rooms: [], links_to_lead_on_the_phone: [] });
  });

  test("m1-conc-r5-use-meet-on-room-closed-by-other-tab-sends-new-link (both presses at once): We are on the phone and Use Meet land in the same moment from the two tabs: the lead on the phone gets no Meet link", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    const seen = await w.panel(closer, id);
    const worker = w.workerBeside();
    const [phone, meet] = await Promise.all([
      settle(w.rooms.actions["room.end"]!(closer, { room_id: id, version: Number(seen.version), reason: "on_phone" })),
      settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen))),
    ]);
    await worker.stop();
    await w.drain();
    const old = w.room(id);
    const fresh = w.db.t("cockpit_sales_rooms").filter(r => r.id !== id && LIVE.includes(String(r.state)));
    // Either order is a rep's honest race; what must hold is that a room
    // closed because the lead is on the phone never gets a video link sent
    // in its place.
    const onPhone = old.result === "moved_to_phone";
    expect({
      phone_ok: phone.ok,
      zoom_result: old.result,
      meet_link_to_lead_on_phone: onPhone ? w.toLead(MEET_URL).length : 0,
      live_rooms_beside_phone_call: onPhone ? fresh.length : 0,
    }).toEqual({ phone_ok: true, zoom_result: "moved_to_phone", meet_link_to_lead_on_phone: 0, live_rooms_beside_phone_call: 0 });
    void meet;
  });

  test("m1-conc-r5-use-meet-on-room-closed-by-other-tab-sends-new-link (End room): the closer ends the Zoom room on the lead page (no video call after all); the dialer's tab's Use Meet from its view a moment before makes a new room and emails the lead its link", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    const dialerView = await w.panel(closer, id);
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: Number(dialerView.version), reason: "end" });
    await w.drain();
    w.clock.now += 2 * S;
    const worker = w.workerBeside();
    const out = await settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(dialerView)));
    await worker.stop();
    await w.drain();
    expect({
      refused: !out.ok,
      new_rooms: w.db.t("cockpit_sales_rooms").filter(r => r.id !== id).length,
      meet_links: w.toLead(MEET_URL).length,
    }).toEqual({ refused: true, new_rooms: 0, meet_links: 0 });
  });
});

describe("m1 concurrency r5: Use Meet pressed twice", () => {
  test("HELD: the same press twice (a double tap, one request id): one Meet room, one cancel row, one Meet link", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    const seen = await w.panel(closer, id);
    const rid = crypto.randomUUID();
    const worker = w.workerBeside();
    const out = await Promise.all([
      settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen, rid))),
      settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen, rid))),
    ]);
    await worker.stop();
    await w.drain();
    expect({
      both_ok: out.every(o => o.ok),
      meet_rooms: w.db.t("cockpit_sales_rooms").filter(r => r.provider === "meet").length,
      cancel_rows: w.audits.filter(a => a.action === "room.end" && a.entityId === id).length,
      meet_links: w.toLead(MEET_URL).length,
    }).toEqual({ both_ok: true, meet_rooms: 1, cancel_rows: 1, meet_links: 1 });
  });

  test("HELD: two tabs press Use Meet at once (two request ids): one Meet room, one cancel row, one Meet link", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" }, { ready: false });
    w.clock.now += 95 * S;
    const seen = await w.panel(closer, id);
    const worker = w.workerBeside();
    await Promise.all([
      settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen))),
      settle(w.rooms.actions["room.create"]!(closer, useMeetAsk(seen))),
    ]);
    await worker.stop();
    await w.drain();
    expect({
      meet_rooms: w.db.t("cockpit_sales_rooms").filter(r => r.provider === "meet").length,
      cancel_rows: w.audits.filter(a => a.action === "room.end" && a.entityId === id).length,
      meet_links: w.toLead(MEET_URL).length,
    }).toEqual({ meet_rooms: 1, cancel_rows: 1, meet_links: 1 });
  });
});
