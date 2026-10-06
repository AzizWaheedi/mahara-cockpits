// bun test supabase/functions/sales-api/m1_time_r4b.test.ts
//
// Milestone 1, video-link round 4 (second run), the TIME angle on sales-api's
// own path. The pilot settings (m1-scope.md section 3): rooms on, both
// providers, every send channel on, test_only with the lead as the test
// contact, short_link off, count_on_join, settle, wrap and auto_on_miss off,
// live.enabled off, followups.agent off, fallback.scope "intro" as shipped
// ("any" where a manager set it, as m1-scope says). The WhatsApp gate is
// shut (the pilot today: the link goes by email) unless a test opens it.
//
// Each test drives sales-api's own actions (room.create, room.event
// worker.ready and tick, room.mark, room.send, room.status) on testfakes.ts
// with a clock only the test moves; the room worker's handshake is written
// as the worker writes it (contract v2 section 7), and the SQL sweep's close
// as cockpit_sales_rooms_close writes it (20261004a R4: state expired, its
// end_reason, result only where the rule gives one; the guard trigger moves
// the version and stamps ended_at). A failing test is a finding. Every lead
// is invented (stress-m1t4b-...), every seat is ...@stress.invalid.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, LANE_COPY } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { hoursRefusal } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t4b@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A Kuwait wall-clock moment (UTC+3) as an instant. */
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The cockpit's own rule for a message that is not a first message: 09:00 to 21:00 on every clock of the lead's. */
const daytime = (country: string, t: number) => hoursRefusal({ segment: "confirm", touch: 2, country, now: t, followups: {} }) === null;

interface WorldOpts {
  country?: string;
  phone?: string;
  gate?: boolean;
  scope?: "intro" | "any";
}

function world(now: number, o: WorldOpts = {}) {
  const w = fakeWorld(now);
  const jobs: Promise<unknown>[] = [];
  const LEAD = `stress-m1t4b-${fakeUuid().slice(-8)}`;
  const phone = o.phone ?? "+96550123456";
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: o.scope ?? "intro", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: iso(now - 5 * S) }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, country: o.country ?? "KW", phone, assigned_to: "G-setter" }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: `c-${LEAD}`, contact_id: LEAD, inbound_whatsapp_at: iso(now - 2 * HOUR) }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: { id: LEAD, firstName: "Sam", name: "Sam Lee", phone, email: `${LEAD}@example.invalid`, tags: ["roas-qualified"], country: o.country ?? "KW" },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
      const id = decodeURIComponent(p.split("/").pop() ?? "");
      return { message: { id, status: "delivered" } };
    }
    return null as unknown as Row;
  });
  /** Every send HighLevel took (the lead has it). */
  const sent: { channel: string; at: number; body: string }[] = [];
  const deps: RoomDeps = {
    io: {
      ...w.io,
      background: p => {
        jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who, b) => {
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sending",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      sent.push({ channel: String(b.channel), at: w.clock.now, body: String(b.body ?? "") });
      row.state = "sent";
      row.provider_status = "sent";
      row.ghl_message_id = `m-${fakeUuid().slice(-8)}`;
      return { message: { ...row } };
    },
    sendTemplate: async (_who, t) => {
      sent.push({ channel: "whatsapp_template", at: w.clock.now, body: "" });
      const row: Row = {
        id: fakeUuid(),
        request_id: t.requestId,
        contact_id: t.contactId,
        channel: "whatsapp",
        via: "workflow",
        template_key: t.key,
        source: "room",
        state: "delivered",
        provider_status: "delivered",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
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
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  let meetings = 0;
  /** The room worker (contract v2 section 7): claims, makes the meeting, stores worker.ready, opens the room. */
  async function workerOpens(id: string, at: number, provider: "meet" | "zoom" = "meet") {
    w.clock.now = at;
    heartbeat(at);
    const r = room(id);
    meetings++;
    const mid = provider === "meet" ? `abc-defg-h${meetings}${fakeUuid().slice(-3)}` : `8${String(100000000 + meetings)}`;
    const url = provider === "meet" ? `https://meet.google.com/${mid}` : `https://us06web.zoom.us/j/${mid}?pwd=Zx${meetings}`;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
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
    await rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider, provider_meeting_id: mid, worker_run: "run-1" },
    });
    await drain();
  }
  /** The lead page's Send a video link (manual), or the dialer's after a missed call that rang at `rang` (fallback). */
  async function create(
    at: number,
    ask: { purpose: "manual" | "fallback"; rang?: number; provider?: "meet" | "zoom" } = { purpose: "manual" },
  ): Promise<{ id: string | null; refused: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    let attempt: string | null = null;
    if (ask.purpose === "fallback" && ask.rang !== undefined) {
      attempt = fakeUuid();
      w.db.seed("cockpit_sales_attempts", [
        {
          id: attempt,
          contact_id: LEAD,
          rep_email: SETTER,
          appointment_id: null,
          item_kind: "lead",
          state: "saved",
          outcome: "no_answer",
          call_state: "no_answer",
          call_duration_s: 0,
          started_at: iso(ask.rang),
          saved_at: iso(ask.rang + 35 * S),
        },
      ]);
    }
    try {
      const out = await rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: ask.purpose,
        provider: ask.provider ?? "meet",
        call_kind: "intro",
        trigger: ask.purpose === "manual" ? "manual" : "no_answer",
        ...(attempt ? { attempt_id: attempt, item_kind: "lead" } : {}),
      });
      return { id: String((out.room as Row).id), refused: null };
    } catch (e) {
      return { id: null, refused: String((e as Error).message) };
    }
  }
  /** A press on the panel (room.mark), with the version the panel last read. */
  async function mark(id: string, what: "host_in" | "lead_in", at: number, version: number): Promise<{ ok: boolean; said: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    try {
      await rooms.actions["room.mark"]!(setter, { room_id: id, what, version });
      await drain();
      return { ok: true, said: null };
    } catch (e) {
      return { ok: false, said: e instanceof ApiRefusal ? e.message : String((e as Error).message) };
    }
  }
  /**
   * The SQL sweep's R4 close, as cockpit_sales_rooms_close writes it: the
   * room moves to expired with its rule as end_reason and the rule's result
   * where the room has none (the guard trigger moves the version and stamps
   * ended_at).
   */
  async function sweepClose(id: string, at: number, rule: string, result: string | null) {
    w.clock.now = at;
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
      method: "PATCH",
      body: { state: "expired", end_reason: rule, result: r.result ?? result, ended_at: w.db.iso() },
    });
  }
  async function status(id: string): Promise<Row> {
    return ((await rooms.actions["room.status"]!(setter, { room_id: id })) as Row).room as Row;
  }
  return { ...w, rooms, room, sent, workerOpens, create, mark, sweepClose, status, drain, LEAD };
}

/**
 * The sweep's R4 due time for an open or host_in room with a lead and no
 * open, knock or retry (20261004a): coalesce(lead_by, link_sent_at + lead,
 * host_in_at + lead, opened_at + lead), and which rule closes it.
 */
function r4(r: Row): { due: number; rule: "link_not_sent" | "lead_no_show" } {
  const t = (v: unknown) => (v ? Date.parse(String(v)) : null);
  const due =
    t(r.lead_by) ??
    (t(r.link_sent_at) !== null ? (t(r.link_sent_at) as number) + 10 * MIN : null) ??
    (t(r.host_in_at) !== null ? (t(r.host_in_at) as number) + 10 * MIN : null) ??
    (t(r.opened_at) as number) + 10 * MIN;
  const unstarted = !r.link_sent_at && !r.lead_by && Boolean(r.link_claimed_at) && ["manual", "fallback"].includes(String(r.purpose));
  return { due, rule: unstarted ? "link_not_sent" : "lead_no_show" };
}

// ---------------------------------------------------------------------------
// 1. Night on the lead's clock: the lead page's room stands for a read-out.
//    The rep reads the link out, the lead comes in near the lead's ten
//    minutes, and the rep's "The lead is in" lands a second after the
//    sweep's minute closed the room.
// ---------------------------------------------------------------------------

describe("Wednesday 7 October, 21:30 Kuwait (night on the lead's clock): the setter is on the phone with a Kuwait lead and makes a Meet room from the lead page", () => {
  const press = kw("2026-10-07T21:30:00");

  test("setup: night on the lead's clock; the room is made, no message goes, the room says to read the link out, and the lead's ten minutes never start", async () => {
    expect(daytime("KW", press)).toBe(false);
    const w = world(press);
    const out = await w.create(press);
    expect(out.refused).toBeNull();
    const id = String(out.id);
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    const r = w.room(id);
    expect({ sent: w.sent.length, refusal: r.refusal, lead_by: r.lead_by ?? null, claimed: Boolean(r.link_claimed_at) }).toEqual({
      sent: 0,
      refusal: LANE_COPY.lead_night_read_out,
      lead_by: null,
      claimed: true,
    });
    // The sweep's R4 then closes it at the host's own press + 10 minutes as
    // link_not_sent (20261004a, "unstarted": claimed, never sent, no lead_by).
    expect(r4(r).rule).toBe("link_not_sent");
  });

  test("control (by day, 14:30): the link goes by email, R4 closes the room as the lead's no-show at the minute, and the rep's The lead is in landing 2 s after the close is kept as the join", async () => {
    const at = kw("2026-10-07T14:30:00");
    const w = world(at);
    const id = String((await w.create(at)).id);
    await w.workerOpens(id, kw("2026-10-07T14:30:06"));
    expect(w.sent.map(s => s.channel)).toEqual(["email"]);
    const inAt = kw("2026-10-07T14:30:20");
    expect((await w.mark(id, "host_in", inAt, Number(w.room(id).version))).ok).toBe(true);
    const seen = Number(w.room(id).version);
    const { due, rule } = r4(w.room(id));
    expect(rule).toBe("lead_no_show");
    // The pg_cron minute after the due time.
    const sweepAt = Math.ceil((due + 1) / MIN) * MIN;
    await w.sweepClose(id, sweepAt, rule, "no_join");
    const late = await w.mark(id, "lead_in", sweepAt + 2 * S, seen);
    const r = w.room(id);
    expect({ ok: late.ok, said: late.said, result: r.result, lead_in: Boolean(r.lead_in_at) }).toEqual({ ok: true, said: null, result: "joined", lead_in: true });
  });

  test("the rep read the link out as the room told them; the lead came in and the rep's The lead is in lands 2 s after the sweep's close: the join is kept, never 'This changed a moment ago' on a room that says the link never reached the lead", async () => {
    const w = world(press);
    const id = String((await w.create(press)).id);
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    expect(w.room(id).refusal).toBe(LANE_COPY.lead_night_read_out);
    const inAt = kw("2026-10-07T21:30:20");
    expect((await w.mark(id, "host_in", inAt, Number(w.room(id).version))).ok).toBe(true);
    const seen = Number(w.room(id).version);
    const { due, rule } = r4(w.room(id));
    expect(rule).toBe("link_not_sent");
    // host_in at 21:30:20 + 10 minutes = 21:40:20: the sweep's 21:41:00 run closes it.
    const sweepAt = Math.ceil((due + 1) / MIN) * MIN;
    expect(iso(sweepAt)).toBe(iso(kw("2026-10-07T21:41:00")));
    await w.sweepClose(id, sweepAt, rule, null);
    // The rep pressed The lead is in at 21:40:57 on the panel (the room was
    // host_in there); its 5 s Undo sends it at 21:41:02.
    const late = await w.mark(id, "lead_in", sweepAt + 2 * S, seen);
    const r = w.room(id);
    const st = await w.status(id);
    // Found when it fails: lateLeadIn (roomlogic.ts) keeps a late join only
    // on a room a timer closed with an end_reason in TIMER_END_REASONS
    // (lead_no_show, not_admitted, host_not_in, no_deadline). A room whose
    // link night stopped closes as link_not_sent (20261004a R4, the m1 round
    // 3b "unstarted" rule), so the rep's press is refused as stale ("This
    // changed a moment ago."), the room keeps no join, and the panel says
    // "The room closed and its link never reached the lead. Call them, or
    // send a new video link." about a lead who is in the Meet with the rep.
    expect({
      ok: late.ok,
      said: late.said,
      result: r.result ?? null,
      lead_in: Boolean(r.lead_in_at),
      panel_end_reason: st.end_reason ?? null,
    }).toEqual({ ok: true, said: null, result: "joined", lead_in: true, panel_end_reason: "link_not_sent" });
  });
});

describe("Wednesday 7 October, 21:30 Kuwait: the same night read-out Meet room; the lead knocks at the Meet door and the setter cannot let them in; the press (5 s Undo) lands 2 s after the sweep's close", () => {
  async function knockedAfterClose(at: number) {
    const w = world(at);
    const id = String((await w.create(at)).id);
    await w.workerOpens(id, at + 6 * S);
    expect((await w.mark(id, "host_in", at + 20 * S, Number(w.room(id).version))).ok).toBe(true);
    const seen = Number(w.room(id).version);
    const { due, rule } = r4(w.room(id));
    const sweepAt = Math.ceil((due + 1) / MIN) * MIN;
    await w.sweepClose(id, sweepAt, rule, rule === "lead_no_show" ? "no_join" : null);
    w.clock.now = sweepAt + 2 * S;
    for (const r of w.db.t("cockpit_sales_worker_status")) if (r.job === "rooms") r.at = iso(w.clock.now - 5 * S);
    const out = (await w.rooms.actions["room.end"]!(setter, { room_id: id, reason: "admit_blocked", version: seen })) as Row;
    const made = w.db.t("cockpit_sales_rooms").filter(r => r.id !== id && r.contact_id === w.LEAD);
    return { rule, replacement: made.length, said: (out.replacement_refusal as string | undefined) ?? null };
  }

  test("control (by day, 14:30): the replacement on Zoom is made for the lead at the door", async () => {
    const got = await knockedAfterClose(kw("2026-10-07T14:30:00"));
    expect({ rule: got.rule, replacement: got.replacement }).toEqual({ rule: "lead_no_show", replacement: 1 });
  });

  test("at night (the link read out): the replacement on Zoom is made for the lead at the door, as by day", async () => {
    const got = await knockedAfterClose(kw("2026-10-07T21:30:00"));
    // Found when it fails: knockAfterClose (rooms.ts) takes a press after the
    // close only on a room a timer closed as lead_no_show, not_admitted or
    // host_not_in (TIMER_CLOSES); the night read-out room closed as
    // link_not_sent, so the lead at the Meet's door gets no replacement and
    // the rep is told "This room closed at 21:41, so no new room was made.
    // Send a new video link if the lead still needs one."
    expect({ rule: got.rule, replacement: got.replacement, said: got.said }).toEqual({ rule: "link_not_sent", replacement: 1, said: null });
  });
});
