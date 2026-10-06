// bun test supabase/functions/sales-api/m1_time_r5.test.ts
//
// Milestone 1, video-link round 5, the TIME angle on sales-api's own path:
// the host's wait (host_by, the sweep's R3) against the lead's ten minutes
// a final refusal starts (rooms.ts startLeadWait), one second either side.
//
// The pilot settings (m1-scope.md section 3): rooms on, both providers,
// every send channel on, test_only with the lead as the test contact,
// short_link off, count_on_join, settle, wrap and auto_on_miss off,
// live.enabled off, followups.agent off, fallback.scope "intro" as shipped.
// The WhatsApp gate is shut (the pilot today: the link goes by email).
//
// Each test drives sales-api's own actions (room.create, room.event
// worker.ready and tick, room.status) on testfakes.ts with a clock only the
// test moves; the room worker's handshake is written as the worker writes
// it (contract v2 section 7). The sweep's rules are read through
// roomlogic.ts timers(), sales-api's mirror of 20261004a R3 and R4 (the SQL
// side is supabase/migrations/tests/m1_time_r5.py). A failing test is a
// finding. Every lead is invented (stress-m1t5-...), every seat is
// ...@stress.invalid.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, roomCtx, roomsSetting, timers } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t5@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * The lead page's Zoom room (purpose manual, the pilot's own path for the
 * test contact) pressed at `press`; HighLevel answers 429 to every send
 * until `takesFrom` (a burst limit, a wallet on hold).
 */
function world(press: number, takesFrom: number) {
  const w = fakeWorld(press);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t5-${fakeUuid().slice(-8)}`;
  const phone = "+96550123456";
  const roomsValue = {
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
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: roomsValue },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(press - 5 * S) }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: "KW", phone, assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(press - 30 * HOUR) }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone, email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) return { message: { status: "delivered" } };
    return null as unknown as Row;
  });
  const went: { channel: string; at: number }[] = [];
  const rows = new Map<string, Row>();
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    // The message service (index.ts convoSend): one row per request id, a
    // repeat answers that row; HighLevel's 429 is a refusal it is sure of.
    sendText: async (_who, b) => {
      const rid = String(b.request_id);
      const had = rows.get(rid);
      if (had) return { message: { ...had }, repeated: true };
      const row: Row = {
        id: fakeUuid(),
        request_id: rid,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sending",
        created_at: iso(w.clock.now),
      };
      rows.set(rid, row);
      w.db.t("cockpit_sales_messages").push(row);
      if (w.clock.now < takesFrom) {
        row.state = "failed";
        row.error = "HighLevel said 429: Too Many Requests";
        throw new ApiRefusal(`HighLevel did not send it: ${String(row.error)}`, 502, { certain: true });
      }
      row.state = "sent";
      row.provider_status = "delivered";
      row.ghl_message_id = `m-${fakeUuid().slice(-8)}`;
      went.push({ channel: String(b.channel), at: w.clock.now });
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  function beat() {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(w.clock.now - 5 * S);
  }
  const setting = () => roomsSetting((w.db.t("cockpit_sales_settings").find(s => s.key === "rooms") as Row).value);
  /** The press, the worker's make (6 s later), its worker.ready and the first send. */
  async function opened(provider: "zoom" | "meet" = "zoom"): Promise<string> {
    w.clock.now = press;
    beat();
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "manual",
      provider,
      call_kind: "intro",
      trigger: "manual",
    });
    const id = String((out.room as Row).id);
    w.clock.now = press + 6 * S;
    beat();
    const mid = provider === "zoom" ? "81234567890" : "abc-defg-hjk";
    const url = provider === "zoom" ? "https://us06web.zoom.us/j/81234567890?pwd=stressm1t5" : "https://meet.google.com/abc-defg-hjk";
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room(id).version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made in 4.0 s." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: mid,
        opened_at: w.db.iso(),
        host_by: iso(w.clock.now + 15 * MIN),
        ends_at: iso(w.clock.now + 30 * MIN),
        version: Number(room(id).version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { provider, provider_meeting_id: mid, worker_run: "run-1" } });
    await drain();
    return id;
  }
  /**
   * The sweep's minute at `at`: R3 then R4 as roomlogic.ts timers() (the
   * mirror of 20261004a) read the room (a rule closes a room at the first
   * minute past its due time), then the tick (T) re-asks the link.
   */
  async function sweepMinute(id: string, at: number): Promise<string | null> {
    w.clock.now = at;
    beat();
    const r = room(id);
    let closed: string | null = null;
    if (r.state === "open" || r.state === "host_in") {
      const due = timers(r as never, roomCtx(setting()));
      const hit = due.filter(d => d.at < at).sort((a, b) => a.at - b.at)[0];
      if (hit?.reason === "host_by") {
        // cockpit_sales_rooms_close(..., 'expired', 'host_not_in', 'Closed: the host did not join in time.', 'no_join')
        Object.assign(r, { state: "expired", end_reason: "host_not_in", result: "no_join", ended_at: iso(at), version: Number(r.version) + 1 });
        closed = "host_not_in";
      } else if (hit?.reason === "lead_by") {
        const unsent = !r.link_sent_at && !r.lead_by && Boolean(r.link_claimed_at);
        Object.assign(r, {
          state: "expired",
          end_reason: unsent ? "link_not_sent" : "lead_no_show",
          result: unsent ? null : "no_join",
          ended_at: iso(at),
          version: Number(r.version) + 1,
        });
        closed = String(r.end_reason);
      }
    }
    if (!closed) {
      await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await drain();
    }
    return closed;
  }
  return { ...w, rooms, room, went, opened, sweepMinute, setting, LEAD };
}

// ---------------------------------------------------------------------------
// HighLevel takes no send for more than the link's ten minutes of re-asks.
// The re-ask at 15:12:00 says the link did not go (final): "Copy the link and
// send it another way", and sales-api starts the lead's ten minutes for the
// rep's own delivery (lead_by 15:22:00). The rep sends the Zoom link from
// their own WhatsApp and has not opened Zoom yet (the room stays `open`).
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, the lead page's Zoom room pressed at 15:01:00 (open at 15:01:06); HighLevel answers 429 to every send until 15:30", () => {
  const press = kw("2026-10-06T15:01:00");
  const never = kw("2026-10-06T15:30:00");

  async function untilFinal() {
    const w = world(press, never);
    const id = await w.opened("zoom");
    let finalAt: number | null = null;
    let closed: string | null = null;
    for (let m = 2; m <= 30 && !closed; m++) {
      const at = kw(`2026-10-06T15:${String(m).padStart(2, "0")}:00`);
      closed = await w.sweepMinute(id, at);
      if (finalAt === null && w.room(id).lead_by) finalAt = at;
      if (closed) return { w, id, finalAt, closedAt: at, closed };
    }
    return { w, id, finalAt, closedAt: null, closed };
  }

  test("setup: the link is tried each minute, then said final at 15:12:00; nothing went; the rep's ten minutes run to 15:22:00; host_by is the open + 15 minutes (15:16:06)", async () => {
    const w = world(press, never);
    const id = await w.opened("zoom");
    for (let m = 2; m <= 12; m++) await w.sweepMinute(id, kw(`2026-10-06T15:${String(m).padStart(2, "0")}:00`));
    const r = w.room(id);
    expect(w.went).toEqual([]);
    expect(String(r.refusal)).toMatch(/^HighLevel did not take the link in 10 minutes/);
    expect({ state: r.state, link_sent_at: r.link_sent_at ?? null, lead_by: r.lead_by, host_by: r.host_by }).toEqual({
      state: "open",
      link_sent_at: null,
      lead_by: iso(kw("2026-10-06T15:22:00")),
      host_by: iso(kw("2026-10-06T15:16:06")),
    });
  });

  test("control (a link that went late moves the host's wait): HighLevel takes the 15:11:00 re-ask, lead_by 15:21:00 and host_by 15:24:00, so the room waits the lead's ten minutes", async () => {
    const w = world(press, kw("2026-10-06T15:10:30"));
    const id = await w.opened("zoom");
    for (let m = 2; m <= 11; m++) await w.sweepMinute(id, kw(`2026-10-06T15:${String(m).padStart(2, "0")}:00`));
    const r = w.room(id);
    expect(w.went.map(x => x.channel)).toEqual(["email"]);
    expect({ lead_by: r.lead_by, host_by: r.host_by }).toEqual({
      lead_by: iso(kw("2026-10-06T15:21:00")),
      host_by: iso(kw("2026-10-06T15:24:00")),
    });
  });

  test("the room the rep was told to deliver by hand waits the ten minutes sales-api started for it (15:22:00), never closed at the host's 15:16:06 under a link the rep just sent", async () => {
    const out = await untilFinal();
    expect(out.finalAt).toBe(kw("2026-10-06T15:12:00"));
    const r = out.w.room(out.id);
    // Found when it fails: startLeadWait (rooms.ts) sets lead_by = now + 10
    // minutes for the link left to the rep, but never moves host_by as
    // keepHostWait (roomlogic.ts) does for a link that went, and the sweep's
    // R3 extends the host's wait only for a room whose link_sent_at is set.
    // So R3 closes the room at the 15:17:00 run as host_not_in, result
    // no_join, five minutes into the rep's ten; the room worker then deletes
    // the Zoom meeting nobody joined (desk rooms.py _scan_finals /
    // close_meeting: status "waiting"), and the link the rep sent from their
    // own WhatsApp at 15:12 is dead when the lead taps it.
    expect({
      closed_at: out.closedAt === null ? null : iso(out.closedAt),
      end_reason: r.end_reason ?? null,
      result: r.result ?? null,
    }).toEqual({
      closed_at: iso(kw("2026-10-06T15:23:00")),
      end_reason: "lead_no_show",
      result: "no_join",
    });
  });

  test("the panel's room.status at 15:12:30 says when the room closes: never a close earlier than the lead's ten minutes the same answer just started", async () => {
    const w = world(press, never);
    const id = await w.opened("zoom");
    for (let m = 2; m <= 12; m++) await w.sweepMinute(id, kw(`2026-10-06T15:${String(m).padStart(2, "0")}:00`));
    w.clock.now = kw("2026-10-06T15:12:30");
    const st = ((await w.rooms.actions["room.status"]!(setter, { room_id: id })) as Row).room as Row;
    const close = Math.min(...timers(w.room(id) as never, roomCtx(w.setting())).map(t => t.at));
    expect({ lead_by: st.lead_by, server_close: iso(close) }).toEqual({
      lead_by: iso(kw("2026-10-06T15:22:00")),
      server_close: iso(kw("2026-10-06T15:22:00")),
    });
  });
});
