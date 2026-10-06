// bun test supabase/functions/sales-api/m1_concurrency_r4c.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 4 (third
// pass), angle: concurrency and idempotency, sales-api's half of the room
// panel's "Use Meet" / "Try {other}": one press made of two calls in turn
// (apps/sales-cockpit/src/components/RoomPanel.tsx retry): room.end
// (cancel) on the room on show, then room.create on the other provider.
// "I can't let them in" checks its replacement before it closes the room
// (rooms.ts roomEnd, createCheck, m1 round 1); this press does not, so a
// refusal of the second call finds the lead's room already closed.
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
const HOUR = 60 * MIN;
const SETTER = "stress-m1c4c-setter@stress.invalid";
const CLOSER = "stress-m1c4c-closer@stress.invalid";
const LEAD = "stress-m1c4c-lead";
const ZOOM_URL = "https://us06web.zoom.us/j/85012340404?pwd=stress";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const LIVE = ["requested", "creating", "open", "host_in", "lead_in"];

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));

function world(o: { googleOk?: boolean; scope?: "intro" | "any" } = {}) {
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: o.scope ?? "any", auto_on_miss: false },
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
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: o.googleOk ?? true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: o.googleOk ?? true },
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
  /** The room worker beside a press: claims the requested room, opens it, tells sales-api. */
  function workerBeside() {
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
            provider_meeting_id: cur.provider === "zoom" ? "85012340404" : `evt-${id.slice(-4)}`,
            opened_at: w.db.iso(),
            host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
            ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
            version: Number(cur.version) + 1,
          },
        });
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
  async function made(who: Who, b: Row): Promise<string> {
    const worker = workerBeside();
    const out = await rooms.actions["room.create"]!(who, { contact_id: LEAD, request_id: crypto.randomUUID(), ...b });
    await worker.stop();
    await drain();
    return String((out.room as Row).id);
  }
  return { ...w, io, rooms, audits, delivered, room, workerBeside, drain, made };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * The press as RoomPanel.retry makes it since the fix: one room.create on the
 * other provider naming the room it replaces (replaces, replaces_version);
 * sales-api checks the new room before it cancels the old one. (Before the
 * fix the panel sent room.end cancel, then room.create.)
 */
async function useOther(w: ReturnType<typeof world>, who: Who, id: string, provider: "meet" | "zoom") {
  const r = w.room(id);
  const worker = w.workerBeside();
  const ask: Row = {
    contact_id: r.contact_id,
    provider,
    call_kind: r.call_kind,
    purpose: r.purpose,
    request_id: crypto.randomUUID(),
    replaces: id,
    replaces_version: Number(r.version),
  };
  if (r.trigger) ask.trigger = r.trigger;
  if (r.attempt_id) ask.attempt_id = r.attempt_id;
  const created = await settle(w.rooms.actions["room.create"]!(who, ask));
  await worker.stop();
  await w.drain();
  const state = String(w.room(id).state);
  const ended = { ok: ["cancelled", "ended", "expired", "failed"].includes(state) };
  return { ended, created };
}

describe("m1 concurrency r4c: Use Meet / Try Zoom, two calls in turn", () => {
  test("control: Meet usable: Use Meet on the closer's Zoom room ends it and makes the Meet room (one live room, its link goes)", async () => {
    const w = world({ googleOk: true });
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" });
    expect(w.delivered.length).toBe(1);
    const out = await useOther(w, closer, id, "meet");
    expect({ ended: out.ended.ok, created: out.created.ok, live: w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state))).length }).toEqual({
      ended: true,
      created: true,
      live: 1,
    });
  });

  test("m1-conc-r4c-use-meet-cancel-then-create-refused-loses-room: the closer's Zoom link went to the lead by email; Meet is down for the seat (the worker's Google sign-in: room.status says other_ok false, and the panel still offers Use Meet); the press cancels the Zoom room, then sales-api refuses the Meet room: the lead holds a link to a room that is gone, and no room is in its place", async () => {
    const w = world({ googleOk: false });
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" });
    // HighLevel still held the email 90 s on, so sales-api doubted it
    // (rooms.ts pendingEmail: link_unconfirmed_at): the panel's moment is
    // not_confirmed, where it offers Use Meet (lib/rooms.ts momentActions).
    Object.assign(w.room(id), { link_unconfirmed_at: w.db.iso() });
    const status = (await w.rooms.actions["room.status"]!(closer, { room_id: id })) as Row;
    expect({ link_went: w.delivered.some(d => d.body.includes(ZOOM_URL)), other_ok: status.other_ok }).toEqual({ link_went: true, other_ok: false });
    const out = await useOther(w, closer, id, "meet");
    const refusal = out.created.ok ? null : out.created.error instanceof ApiRefusal ? out.created.error.message : String(out.created.error);
    const live = w.db.t("cockpit_sales_rooms").filter(r => LIVE.includes(String(r.state)));
    // What should hold: a room on the other provider that would be refused
    // leaves the lead's room open (as "I can't let them in" does), so the
    // link the lead holds still leads somewhere.
    expect({ meet_refused: Boolean(refusal), zoom_room: w.room(id).state, lead_rooms_open: live.length }).toEqual({
      meet_refused: true,
      zoom_room: "open",
      lead_rooms_open: 1,
    });
  });

  test("m1-conc-r4c-use-meet-cancel-then-create-refused-loses-room (the lead's rooms this hour): the closer's Zoom link went by email and HighLevel still holds it (not_confirmed, so the panel offers Use Meet, Meet usable); the lead had three earlier rooms this hour: the press cancels the Zoom room, then the Meet room is refused by the lead's room cap", async () => {
    const w = world({ googleOk: true });
    // Three earlier rooms for this lead in the hour (closed by the rep, their links never went).
    for (let i = 0; i < 3; i++)
      w.db.seed("cockpit_sales_rooms", [
        {
          request_id: crypto.randomUUID(),
          contact_id: LEAD,
          purpose: "manual",
          call_kind: "demo",
          provider: "zoom",
          host_email: CLOSER,
          made_by: CLOSER,
          state: "cancelled",
          result: "cancelled",
          requested_at: new Date(w.clock.now - (50 - i * 10) * MIN).toISOString(),
          ended_at: new Date(w.clock.now - (49 - i * 10) * MIN).toISOString(),
        },
      ]);
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo", purpose: "manual" });
    expect(w.delivered.some(d => d.body.includes(ZOOM_URL))).toBe(true);
    Object.assign(w.room(id), { link_unconfirmed_at: w.db.iso() });
    const out = await useOther(w, closer, id, "meet");
    const refusal = out.created.ok ? null : out.created.error instanceof ApiRefusal ? out.created.error.message : String(out.created.error);
    expect({ meet_refused: refusal, zoom_room: w.room(id).state }).toEqual({ meet_refused: expect.any(String), zoom_room: "open" });
  });
});

void HOUR;
