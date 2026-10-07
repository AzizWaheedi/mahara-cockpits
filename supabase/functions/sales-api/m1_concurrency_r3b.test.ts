// bun test supabase/functions/sales-api/m1_concurrency_r3b.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 3 (second
// pass), angle: concurrency and idempotency, with the pilot's settings
// (m1-scope.md section 3): rooms on, both providers, the three lanes on,
// test_only with the lead on the test list, count_on_join, settle, wrap and
// auto_on_miss off, short_link off, live handover off. The WhatsApp gate is
// locked (connector_off false), so the link goes by email.
//
// What this file adds: two of Zoom's webhooks for one room read by sales-api
// at the same moment, where one lands its write between the other's read of
// the room and its own write (the host switching from the laptop to the
// phone; the host starting the meeting again just as Zoom's end of the
// empty one is read). Each run of sales-api is a separate request, as the
// door forwards each webhook on its own.
//
// A failing test is a finding. Nothing here reaches HighLevel, Zoom, Google
// or Slack; every lead and seat is invented (stress-..., @stress.invalid).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import type { DbInit, LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const CLOSER = "stress-m1c3b-closer@stress.invalid";
const LEAD = "stress-m1c3b-lead";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await turn();
};

/** A hook run before a database call lands (another request's work in between). */
type DbHook = (path: string, init: DbInit) => Promise<void> | void;

function world() {
  const w = fakeWorld();
  const delivered: { requestId: string; at: number; body: string }[] = [];
  const audits: Row[] = [];
  const hooks: DbHook[] = [];
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  const rows = new Map<string, Row>();
  async function send(requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new Error("stopped");
    }
    row.ghl_asked_at = at();
    delivered.push({ requestId, at: w.clock.now, body });
    Object.assign(row, { state: "sent", provider_status: "sent", ghl_message_id: `msg-${String(row.id).slice(-6)}` });
    return { message: { ...row } };
  }
  const io: LiveIO = {
    ...w.io,
    db: async (path, init = {}) => {
      for (const h of hooks.splice(0)) await h(path, init);
      return await w.io.db(path, init);
    },
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
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join here: ${t.buttonVariable?.join_code ?? ""}`, { template_key: t.key, via: "workflow" }, t.beforeSend),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /**
   * Runs `fn` once, right before the next database call that `when` picks
   * lands (and after every call before it): another request's whole work,
   * landing between this request's read and its write.
   */
  function before(when: (path: string, init: DbInit) => boolean, fn: () => Promise<void>) {
    const hook: DbHook = async (path, init) => {
      if (!when(path, init)) {
        hooks.push(hook);
        return;
      }
      await fn();
    };
    hooks.push(hook);
  }

  async function made(): Promise<string> {
    let stop = false;
    const worker = (async () => {
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
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
          method: "PATCH",
          body: {
            state: "open",
            join_url: ZOOM_URL,
            provider_meeting_id: "85012345678",
            opened_at: w.db.iso(),
            host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
            ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
            version: Number(room(id).version) + 1,
          },
        });
        await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
      }
    })();
    const out = await rooms.actions["room.create"]!(closer, {
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      request_id: crypto.randomUUID(),
    });
    stop = true;
    await worker;
    return String((out.room as Row).id);
  }
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turns(3);
      await w.flush();
    }
  }
  /** One Zoom event as the door stores it (source zoom, the trimmed payload), not forwarded yet. */
  function zoomStored(id: string, event: string, o: { at: number; participant?: Row }): string {
    const r = room(id);
    const meeting = String(r.provider_meeting_id);
    const evId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: evId,
        room_id: id,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${meeting}:${o.at}:${evId}`,
        at: new Date(o.at).toISOString(),
        text: `Zoom: ${event}.`,
        detail: {
          event,
          event_ts: o.at,
          payload: {
            object: {
              id: meeting,
              uuid: `uuid-${meeting}`,
              host_id: "Z-closer",
              topic: `Mahara call ${String(r.code)}`,
              ...(o.participant ? { participant: o.participant } : {}),
            },
          },
        },
      },
    ]);
    return evId;
  }
  async function forward(evId: string, event: string) {
    return await rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: evId });
  }
  return { ...w, io, rooms, room, audits, delivered, before, made, drain, zoomStored, forward };
}

/** The closer's own Zoom user in a participant event: one device (participant_uuid) and one join (user_id). */
const host = (t: number, device: string, join: string, leaving = false) => ({
  id: "Z-closer",
  user_id: join,
  participant_uuid: `puuid-host-${device}`,
  user_name: "Omar Closer",
  email: CLOSER,
  ...(leaving ? { leave_time: new Date(t).toISOString() } : { join_time: new Date(t).toISOString() }),
});

const isRoomPatch = (path: string, init: DbInit) => init.method === "PATCH" && path.startsWith("cockpit_sales_rooms?");

// ---------------------------------------------------------------------------
// The host moves from the laptop to the phone; Zoom's two webhooks are read
// by sales-api at the same moment
// ---------------------------------------------------------------------------

describe("m1 concurrency r3b: the closer moves from the laptop to the phone, both webhooks read at once", () => {
  test("control: the phone's join read and written before the laptop's leave is read: the room keeps the host in", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    // 10:05:00 the phone joins, 10:05:01 the laptop leaves (Zoom's "move to phone").
    const j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + S, participant: host(t0 + 5 * MIN + S, "laptop", "16771", true) });
    w.clock.now = t0 + 5 * MIN + 2 * S;
    await w.forward(j2, "meeting.participant_joined");
    await w.forward(l1, "meeting.participant_left");
    await w.drain();
    expect(w.room(id).state).toBe("host_in");
  });

  test("m1-conc-r3b-host-left-write-ignores-host-rejoin-landed-between: the closer moves the call from the laptop to the phone (Zoom's phone join at 10:05:00, the laptop's leave at 10:05:01, both webhooks forwarded together); the laptop's leave reads the room and the host's other sessions before the phone's join is stored, and the phone's join is read and written in the moment before the leave's own write: the room must still say the host is in (the phone's session never left), not go back to waiting for a host who is in the meeting", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    w.clock.now = t0 + 5 * MIN + 2 * S;
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + S, participant: host(t0 + 5 * MIN + S, "laptop", "16771", true) });
    // The phone's join is stored and handled by its own request in the
    // moment between the leave's reads and the leave's write to the room.
    let j2 = "";
    w.before(isRoomPatch, async () => {
      j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
      await w.forward(j2, "meeting.participant_joined");
    });
    await w.forward(l1, "meeting.participant_left");
    await w.drain();
    const ev2 = w.db.t("cockpit_sales_room_events").find(e => e.id === j2) as Row;
    const status = (await w.rooms.actions["room.status"]!(closer, { room_id: id })) as Row;
    expect({
      phone_join_read: Boolean(ev2?.handled_at),
      state: w.room(id).state,
      panel: (status.room as Row).state,
    }).toEqual({ phone_join_read: true, state: "host_in", panel: "host_in" });
  });
});

// ---------------------------------------------------------------------------
// Zoom ends the empty meeting as the closer starts it again
// ---------------------------------------------------------------------------

describe("m1 concurrency r3b: Zoom's end of the empty meeting read as the closer starts it again", () => {
  test("control: the end read and written before the new start is read: the room is back to host_in", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const s1 = w.zoomStored(id, "meeting.started", { at: t0 + MIN });
    w.clock.now = t0 + MIN + S;
    await w.forward(s1, "meeting.started");
    expect(w.room(id).state).toBe("host_in");
    // 10:04:00 the closer's laptop drops and Zoom ends the empty meeting;
    // 10:04:20 the closer starts it again from the panel.
    const e1 = w.zoomStored(id, "meeting.ended", { at: t0 + 4 * MIN });
    const s2 = w.zoomStored(id, "meeting.started", { at: t0 + 4 * MIN + 20 * S });
    w.clock.now = t0 + 4 * MIN + 21 * S;
    await w.forward(e1, "meeting.ended");
    await w.forward(s2, "meeting.started");
    await w.drain();
    expect(w.room(id).state).toBe("host_in");
  });

  test("m1-conc-r3b-meeting-ended-write-ignores-restart-landed-between: Zoom ends the closer's empty meeting at 10:04:00 (the laptop dropped) and the closer starts it again at 10:04:20; the end's webhook was held back and both are read together: the restart is read and written in the moment between the end's read of the room and its write: the room must say the host is in the meeting that runs now, never go back to waiting for the host", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const s1 = w.zoomStored(id, "meeting.started", { at: t0 + MIN });
    w.clock.now = t0 + MIN + S;
    await w.forward(s1, "meeting.started");
    expect(w.room(id).state).toBe("host_in");
    w.clock.now = t0 + 4 * MIN + 21 * S;
    const e1 = w.zoomStored(id, "meeting.ended", { at: t0 + 4 * MIN });
    let s2 = "";
    w.before(isRoomPatch, async () => {
      s2 = w.zoomStored(id, "meeting.started", { at: t0 + 4 * MIN + 20 * S });
      await w.forward(s2, "meeting.started");
    });
    await w.forward(e1, "meeting.ended");
    await w.drain();
    const ev2 = w.db.t("cockpit_sales_room_events").find(e => e.id === s2) as Row;
    expect({ restart_read: Boolean(ev2?.handled_at), state: w.room(id).state }).toEqual({ restart_read: true, state: "host_in" });
  });
});

describe("m1 concurrency r3b: the phone's join reads the room before the laptop's leave lands", () => {
  test("m1-conc-r3b-host-join-retry-drops-second-device-check: the phone's join (10:05:00) reads the room while the host is in; the laptop's leave (10:05:01), whose own check of the host's other sessions ran before the phone's join was stored, lands first and moves the room back to open; the phone's join is then written again on the room as it is now: it must still say the host is in (its own session never left), as the same join read a moment later does", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    w.clock.now = t0 + 5 * MIN + 2 * S;
    // The laptop's leave was read (its check of the host's other sessions
    // ran before the phone's join was stored); its write lands in the moment
    // between the phone's join's read of the room and the join's own write.
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + S, participant: host(t0 + 5 * MIN + S, "laptop", "16771", true) });
    const r = w.room(id);
    const j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
    w.before(isRoomPatch, async () => {
      // The leave's own write, as its request makes it (roomlogic host_left on host_in).
      await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.host_in&version=eq.${Number(r.version)}`, {
        method: "PATCH",
        body: { state: "open", host_left_at: new Date(t0 + 5 * MIN + S).toISOString(), version: Number(r.version) + 1 },
      });
      const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === l1) as Row;
      ev.handled_at = w.db.iso();
    });
    await w.forward(j2, "meeting.participant_joined");
    await w.drain();
    expect({ leave_landed: Boolean(w.room(id).host_left_at), state: w.room(id).state }).toEqual({ leave_landed: true, state: "host_in" });
  });
});

describe("m1 concurrency r3b: the lead's join and Zoom's end of the meeting read at once on a room waiting for the host", () => {
  test("control: the end read and written first, then the lead's join from before it: the room ends joined", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    // The host came in and left; the room waits for the host again.
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 3 * MIN, participant: host(t0 + 3 * MIN, "laptop", "16771", true) });
    w.clock.now = t0 + 3 * MIN + S;
    await w.forward(l1, "meeting.participant_left");
    expect(w.room(id).state).toBe("open");
    const lead = { id: "", user_id: "16790", participant_uuid: "puuid-lead-1", user_name: "Huda Ali", join_time: new Date(t0 + 2 * MIN + 50 * S).toISOString() };
    const e1 = w.zoomStored(id, "meeting.ended", { at: t0 + 4 * MIN });
    const lj = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 2 * MIN + 50 * S, participant: lead });
    w.clock.now = t0 + 4 * MIN + 5 * S;
    await w.forward(e1, "meeting.ended");
    await w.forward(lj, "meeting.participant_joined");
    await w.drain();
    expect({ state: w.room(id).state, result: w.room(id).result }).toEqual({ state: "ended", result: "joined" });
  });

  test("m1-conc-r3b-lead-join-write-ignores-meeting-end-landed-between: the closer stepped out of the Zoom room (the room waits for the host again); the lead had joined at 10:02:50 (its webhook late) and Zoom ended the meeting at 10:04:00; the end's write lands in the moment between the join's read of the room and its write: the room must end joined (the meeting is over), as it does when the two are read one after the other, never stay lead_in on a meeting that has ended", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 3 * MIN, participant: host(t0 + 3 * MIN, "laptop", "16771", true) });
    w.clock.now = t0 + 3 * MIN + S;
    await w.forward(l1, "meeting.participant_left");
    expect(w.room(id).state).toBe("open");
    const lead = { id: "", user_id: "16790", participant_uuid: "puuid-lead-1", user_name: "Huda Ali", join_time: new Date(t0 + 2 * MIN + 50 * S).toISOString() };
    w.clock.now = t0 + 4 * MIN + 5 * S;
    const lj = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 2 * MIN + 50 * S, participant: lead });
    let e1 = "";
    w.before(isRoomPatch, async () => {
      e1 = w.zoomStored(id, "meeting.ended", { at: t0 + 4 * MIN });
      await w.forward(e1, "meeting.ended");
    });
    await w.forward(lj, "meeting.participant_joined");
    await w.drain();
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === e1) as Row;
    expect({ end_read: Boolean(ev?.handled_at), state: w.room(id).state, result: w.room(id).result ?? null }).toEqual({
      end_read: true,
      state: "ended",
      result: "joined",
    });
  });
});

// ---------------------------------------------------------------------------
// The sweep's replay of a call's Zoom events after sales-api did not answer
// ---------------------------------------------------------------------------

describe("m1 concurrency r3b: the sweep replays a call's Zoom events in the order of their ids", () => {
  /**
   * The door stored Zoom's events while sales-api did not answer (a deploy,
   * a cold start): the closer's join at 10:01:04, the lead's join at
   * 10:02:47 (let in from the waiting room), and Zoom's end of the meeting at
   * 10:03:13 (a short call: the lead asked to talk tomorrow). The sweep's E1
   * picks them and the tick posts them as one sweep.replay whose event_ids
   * are ordered by id (20261004a: jsonb_agg(b.id::text order by b.id)), and
   * sales-api's replay reads them one after another in that order.
   */
  async function replayed(order: ("host" | "lead" | "end")[]) {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const ids: Record<string, string> = {};
    const hostJoin = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN + 4 * S, participant: host(t0 + MIN + 4 * S, "laptop", "16771") });
    const leadJoin = w.zoomStored(id, "meeting.participant_joined", {
      at: t0 + 2 * MIN + 47 * S,
      participant: { id: "", user_id: "16790", participant_uuid: "puuid-lead-1", user_name: "Huda Ali", join_time: new Date(t0 + 2 * MIN + 47 * S).toISOString() },
    });
    const end = w.zoomStored(id, "meeting.ended", { at: t0 + 3 * MIN + 13 * S });
    ids.host = hostJoin;
    ids.lead = leadJoin;
    ids.end = end;
    // The ids as the database made them sort in this order.
    const sorted = order.map(k => ids[k] as string);
    w.clock.now = t0 + 3 * MIN + 40 * S;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: sorted } });
    await w.drain();
    const r = w.room(id);
    const handled = [hostJoin, leadJoin, end].every(e => Boolean((w.db.t("cockpit_sales_room_events").find(x => x.id === e) as Row).handled_at));
    return { all_read: handled, state: r.state, result: r.result ?? null, end_reason: r.end_reason ?? null };
  }

  test("control: the replay's ids happen to sort in Zoom's order (host, lead, end): the room ends joined at the meeting's end", async () => {
    expect(await replayed(["host", "lead", "end"])).toEqual({ all_read: true, state: "ended", result: "joined", end_reason: "meeting_ended" });
  });

  test("control: the ids sort end, host, lead: the room ends joined at the meeting's end", async () => {
    expect(await replayed(["end", "host", "lead"])).toEqual({ all_read: true, state: "ended", result: "joined", end_reason: "meeting_ended" });
  });

  test("m1-conc-r3b-replay-order-lead-join-stamps-host-in-hides-meeting-end: the ids sort lead, host, end: the lead's join is read on the room still waiting for the host, so host_in_at is stamped at the moment of that write (10:03:40, after the meeting's end); the closer's join changes nothing and Zoom's end (10:03:13) is then read as an earlier instance and dropped: the room stays lead_in after the call ended, holding the closer's seat and the lead for an hour and a half (R7), instead of ending joined at 10:03:13", async () => {
    expect(await replayed(["lead", "host", "end"])).toEqual({ all_read: true, state: "ended", result: "joined", end_reason: "meeting_ended" });
  });

  test("m1-conc-r3b-replay-order-lead-join-stamps-host-in-hides-meeting-end (lead, end, host): the same with the end's id between", async () => {
    expect(await replayed(["lead", "end", "host"])).toEqual({ all_read: true, state: "ended", result: "joined", end_reason: "meeting_ended" });
  });

  test("m1-conc-r3b-replay-order-lead-join-stamps-host-in-hides-meeting-end (the closer's seat): after that replay the closer cannot send the next lead a video link: the seat still holds the room the call ended in", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    const t0 = w.clock.now;
    const hostJoin = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN + 4 * S, participant: host(t0 + MIN + 4 * S, "laptop", "16771") });
    const leadJoin = w.zoomStored(id, "meeting.participant_joined", {
      at: t0 + 2 * MIN + 47 * S,
      participant: { id: "", user_id: "16790", participant_uuid: "puuid-lead-1", user_name: "Huda Ali", join_time: new Date(t0 + 2 * MIN + 47 * S).toISOString() },
    });
    const end = w.zoomStored(id, "meeting.ended", { at: t0 + 3 * MIN + 13 * S });
    w.clock.now = t0 + 3 * MIN + 40 * S;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [leadJoin, hostJoin, end] } });
    await w.drain();
    // Five minutes later the closer sends the next lead a video link.
    w.clock.now += 5 * MIN;
    const NEXT = "stress-m1c3b-lead-2";
    w.db.seed("cockpit_sales_leads", [{ contact_id: NEXT, name: "Sara Noor", country: "KW" }]);
    // The pilot's test list holds both test leads.
    const rs = w.db.t("cockpit_sales_settings").find(x => x.key === "rooms") as Row;
    rs.value = { ...(rs.value as Row), test_contacts: [LEAD, NEXT] };
    w.routes.unshift((m, p) => (m === "GET" && p === `/contacts/${NEXT}` ? { contact: { id: NEXT, firstName: "Sara", name: "Sara Noor", phone: "+96550000001", email: "sara@example.com", country: "KW" } } : (null as unknown as Row)));
    let code = "made";
    try {
      await w.rooms.actions["room.create"]!(closer, { contact_id: NEXT, provider: "zoom", call_kind: "demo", purpose: "manual", request_id: crypto.randomUUID() });
    } catch (e) {
      code = String((e as { extra?: Row }).extra?.code ?? (e as Error).message);
    }
    expect({ first_room: w.room(id).state, next_link: code }).toEqual({ first_room: "ended", next_link: "made" });
  });
});
