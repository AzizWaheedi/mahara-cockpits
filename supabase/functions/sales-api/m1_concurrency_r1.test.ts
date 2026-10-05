// bun test supabase/functions/sales-api/m1_concurrency_r1.test.ts
//
// Milestone 1 (the video link when a call fails), round 1, angle:
// concurrency and idempotency on the video-link path, with the pilot's
// settings (m1-scope.md section 3): rooms on, both providers, the three
// lanes on, test_only with the lead on the test list, count_on_join, settle,
// wrap and auto_on_miss off, short_link off, live handover off. The
// WhatsApp gate is locked (connector_off false) unless a test says it is
// open, so the link goes by email as it will at the pilot's start.
//
// Double and parallel presses of Send a video link, End, I can't let them
// in, The lead is in and the marks; two tabs; the worker, the sweep and
// sales-api on one room; repeated and out-of-order events.
//
// A failing test is a finding. Nothing here reaches HighLevel, Zoom, Google
// or Slack; every lead is invented.
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
const SETTER = "stress-m1c1-setter@stress.invalid";
const CLOSER = "stress-m1c1-closer@stress.invalid";
const LEAD = "stress-m1c1-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await turn();
};

interface Gate {
  wait: Promise<void>;
  open: () => void;
  reached: Promise<void>;
  hit: () => void;
}
function gate(): Gate {
  let open!: () => void;
  let hit!: () => void;
  const wait = new Promise<void>(r => {
    open = r;
  });
  const reached = new Promise<void>(r => {
    hit = r;
  });
  return { wait, open, reached, hit };
}

type Lane = "text" | "template" | "email";

function world(o: { wa?: boolean } = {}) {
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  /** What reached the lead, with the room's state at that moment. */
  const delivered: { lane: Lane; requestId: string; at: number; contact: string; body: string; roomStates: Record<string, string> }[] = [];
  const audits: Row[] = [];
  /** A gate a send waits on, by lane, right before HighLevel takes it (after the cockpit's last check). */
  const sendGates: Partial<Record<Lane, Gate>> = {};
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
    {
      key: "whatsapp_guard",
      value: o.wa
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
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
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  // 11:00 in Kuwait: daytime on the lead's clock.
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  const roomStates = () =>
    Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.code), String(r.state)]));
  async function send(lane: Lane, requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const g = sendGates[lane];
    if (g) {
      delete sendGates[lane];
      g.hit();
      await g.wait;
    }
    delivered.push({ lane, requestId, at: w.clock.now, contact: contactId, body, roomStates: roomStates() });
    row.state = "sent";
    row.provider_status = lane === "text" ? "sent" : lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = `msg-${String(row.id).slice(-6)}`;
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
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, t.contactId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const lines = (id: string, kind?: string) =>
    w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && (!kind || e.kind === kind));
  const audit = (action: string, id?: string) => audits.filter(a => a.action === action && (!id || a.entityId === id));

  /** The worker: claim (requested to creating). */
  async function claim(id: string, run = "run-1") {
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(room(id).version) + 1 },
    });
  }
  /** The worker: store worker.ready, then open the room (its write guarded on creating and its run). */
  async function open(id: string, run = "run-1") {
    const r = room(id);
    const url = r.provider === "zoom" ? ZOOM_URL.replace("85012345678", String(85_000_000_000 + Number(String(id).slice(-4).replace(/\D/g, "") || 1))) : MEET_URL;
    await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: run }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const out = await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.${run}`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: r.provider === "zoom" ? url.split("/j/")[1]?.split("?")[0] : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(r.version) + 1,
      },
      prefer: "return=representation",
    });
    return out.length > 0;
  }
  async function ready(id: string, run = "run-1") {
    return await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: run } });
  }
  async function replay(id: string) {
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${id}`) as Row;
    return await rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [String(ev.id)] } });
  }
  async function tick(...ids: string[]) {
    return await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
  }
  /** Background work (the link) drained, with real turns between. */
  async function drain() {
    for (let i = 0; i < 6; i++) {
      await turns(3);
      await w.flush();
    }
  }
  /** The worker running beside a press: claims and opens the first requested room it sees, then tells sales-api. */
  function workerBeside(o: { ready?: boolean } = {}) {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await claim(id);
        if (await open(id)) {
          if (o.ready !== false) await ready(id);
        }
      }
    })();
    return {
      stop: async () => {
        stop = true;
        await done;
      },
    };
  }
  async function create(who: Who, b: Row) {
    return await rooms.actions["room.create"]!(who, {
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
      request_id: (b.request_id as string | undefined) ?? crypto.randomUUID(),
    });
  }
  return { ...w, io, rows, delivered, audits, sendGates, rooms, room, lines, audit, claim, open, ready, replay, tick, drain, workerBeside, create };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
const codeOf = (e: unknown) => (e instanceof ApiRefusal ? String(e.extra?.code ?? "") : `thrown:${String((e as Error)?.message ?? e)}`);
const msgOf = (e: unknown) => (e instanceof ApiRefusal ? e.message : String((e as Error)?.message ?? e));

/** A room made, opened by the worker, its link sent (email in the pilot). */
async function openRoom(w: ReturnType<typeof world>, who: Who = setter, b: Row = {}) {
  const worker = w.workerBeside();
  const out = await w.create(who, b);
  await worker.stop();
  await w.drain();
  return String((out.room as Row).id);
}

// ---------------------------------------------------------------------------
// Send a video link: double presses, two tabs
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: Send a video link pressed twice", () => {
  test("the same press five times at once (one request id): one room, one audit row, one link", async () => {
    const w = world();
    const id = crypto.randomUUID();
    const worker = w.workerBeside();
    const outs = await Promise.all([0, 1, 2, 3, 4].map(() => settle(w.create(setter, { request_id: id }))));
    await worker.stop();
    await w.drain();
    const made = w.db.t("cockpit_sales_rooms");
    expect(made.length).toBe(1);
    expect(outs.every(o => o.ok && String((o.value.room as Row).id) === String(made[0]!.id))).toBe(true);
    expect(w.audit("room.create").length).toBe(1);
    expect(w.delivered.length).toBe(1);
  });

  test("two tabs press at once (two request ids): one room, the other tab told plainly, one link", async () => {
    const w = world();
    const worker = w.workerBeside();
    const outs = await Promise.all([settle(w.create(setter, {})), settle(w.create(setter, {}))]);
    await worker.stop();
    await w.drain();
    expect(w.db.t("cockpit_sales_rooms").length).toBe(1);
    const refused = outs.filter(o => !o.ok);
    expect(refused.length).toBe(1);
    const e = (refused[0] as { error: unknown }).error;
    // Never a 500, never someone else's room.
    expect(e instanceof ApiRefusal).toBe(true);
    expect(["lead_has_room", "host_has_room"]).toContain(codeOf(e));
    expect(w.delivered.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The worker, its replay and the tick on one room
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: worker.ready, its replay and the tick at once", () => {
  test("worker.ready twice, the replay and the tick's claim in the same moment: one claim, one link", async () => {
    const w = world();
    const out = await settle(
      (async () => {
        const worker = w.workerBeside({ ready: false });
        const r = await w.create(setter, {});
        await worker.stop();
        return r;
      })(),
    );
    expect(out.ok).toBe(true);
    const id = String(w.db.t("cockpit_sales_rooms")[0]!.id);
    w.clock.now += 61 * S;
    await Promise.all([settle(w.ready(id)), settle(w.ready(id)), settle(w.replay(id)), settle(w.tick(id))]);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.delivered.length).toBe(1);
    expect(w.audit("room.link", id).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End, while the worker opens the room
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: Cancel pressed while the room is being made", () => {
  test("cancel-refused-when-worker-opens-between: the panel read the room creating (v2); the worker opens it (v3) as Cancel is pressed; the room must not stay open with its link going to the lead", async () => {
    const w = world();
    // The worker claims, then is slow (Meet took 16 s): room.create answers the room still creating.
    const p = w.create(setter, {});
    for (let i = 0; i < 50 && !w.db.t("cockpit_sales_rooms").length; i++) await turn();
    const id = String(w.db.t("cockpit_sales_rooms")[0]!.id);
    await w.claim(id);
    const answered = await p;
    expect((answered.room as Row).state).toBe("creating");
    const seen = Number((answered.room as Row).version);
    // The worker's open lands, then the rep's Cancel with the version the panel showed.
    await w.open(id);
    const end = await settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: seen, reason: "cancel" }));
    await w.ready(id);
    await w.drain();
    const r = w.room(id);
    expect({
      cancel_answer: end.ok ? "landed" : `${codeOf((end as { error: unknown }).error)}: ${msgOf((end as { error: unknown }).error)}`,
      state: r.state,
      links_to_lead: w.delivered.length,
    }).toEqual({ cancel_answer: "landed", state: "cancelled", links_to_lead: 0 });
  });

  test("end-refused-after-host-join: the panel read the room open; Zoom's host join moves it to host_in as End is pressed: End must still end it", async () => {
    const w = world();
    const id = await openRoom(w, closer, { provider: "zoom", call_kind: "demo" });
    const seen = Number(w.room(id).version);
    // The host's join (I'm in the room from the other tab, or Zoom's webhook) lands first.
    await w.rooms.actions["room.mark"]!(closer, { room_id: id, version: seen, what: "host_in" });
    const end = await settle(w.rooms.actions["room.end"]!(closer, { room_id: id, version: seen, reason: "end" }));
    expect({
      end_answer: end.ok ? "landed" : `${codeOf((end as { error: unknown }).error)}: ${msgOf((end as { error: unknown }).error)}`,
      state: w.room(id).state,
    }).toEqual({ end_answer: "landed", state: "ended" });
  });
});

// ---------------------------------------------------------------------------
// End and the marks from two tabs
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: two tabs press the same thing", () => {
  test("End in two tabs at once (same version, different reasons): one end, one audit row, one line", async () => {
    const w = world();
    const id = await openRoom(w);
    const v = Number(w.room(id).version);
    const outs = await Promise.all([
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" })),
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "on_phone" })),
    ]);
    expect(outs.every(o => o.ok)).toBe(true);
    expect(w.audit("room.end", id).length).toBe(1);
    expect(w.lines(id, "room.end").length).toBe(1);
  });

  test("The lead is in, in two tabs at once: one move, one audit row, nothing booked", async () => {
    const w = world();
    const id = await openRoom(w);
    const v = Number(w.room(id).version);
    const outs = await Promise.all([
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" })),
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" })),
    ]);
    await w.drain();
    expect(outs.every(o => o.ok)).toBe(true);
    expect(w.room(id).state).toBe("lead_in");
    expect(w.audit("room.mark.lead_in", id).length).toBe(1);
    expect(w.room(id).count_claimed_at ?? null).toBe(null);
  });

  test("That was not the lead, in two tabs at once: one move back, one audit row", async () => {
    const w = world();
    const id = await openRoom(w);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    const v = Number(w.room(id).version);
    const outs = await Promise.all([
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "not_lead" })),
      settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "not_lead" })),
    ]);
    expect(outs.map(o => (o.ok ? "ok" : codeOf((o as { error: unknown }).error)))).toEqual(["ok", "ok"]);
    expect(w.room(id).state).toBe("host_in");
    expect(w.audit("room.mark.not_lead", id).length).toBe(1);
  });

  test("Also send by email in two tabs while the room's own email is on its way: one email", async () => {
    const w = world();
    const g = gate();
    w.sendGates.email = g;
    const worker = w.workerBeside();
    await w.create(setter, {});
    await worker.stop();
    const id = String(w.db.t("cockpit_sales_rooms")[0]!.id);
    await g.reached;
    const presses = [
      settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() })),
      settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() })),
    ];
    await turns(30);
    g.open();
    await Promise.all(presses);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.delivered.filter(d => d.lane === "email").length).toBe(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// I can't let them in
// ---------------------------------------------------------------------------

/** Huda's booked intro, `fromNow` ms ahead, assigned to `ghl` (the setter's own by default). */
function bookIntro(w: ReturnType<typeof world>, fromNow: number, ghl = "G-setter"): string {
  const id = `stress-m1c1-intro-${Math.round(fromNow / MIN)}`;
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: id,
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: new Date(w.clock.now + fromNow).toISOString(),
      end_at: new Date(w.clock.now + fromNow + 30 * MIN).toISOString(),
      assigned_user_id: ghl,
      calendar_id: "cal-intro",
    },
  ]);
  return id;
}

describe("m1 concurrency r1: I can't let them in", () => {
  test("pressed in two tabs at once: one Zoom room in its place, both tabs shown it, one end audit row, the new link once", async () => {
    const w = world();
    const appt = bookIntro(w, 2 * MIN);
    const id = await openRoom(w, setter, { purpose: "fallback", trigger: "no_answer", appointment_id: appt, item_kind: "intro" });
    expect(w.room(id).appointment_id).toBe(appt);
    const v = Number(w.room(id).version);
    const worker = w.workerBeside();
    const outs = await Promise.all([
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })),
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })),
    ]);
    await worker.stop();
    await w.drain();
    const others = w.db.t("cockpit_sales_rooms").filter(r => r.id !== id);
    const replacements = outs.map(o =>
      o.ok
        ? String(((o.value as Row).replacement as Row | undefined)?.id ?? `none: ${String((o.value as Row).replacement_refusal ?? "")}`)
        : `refused:${codeOf((o as { error: unknown }).error)}`,
    );
    expect({
      rooms_made: others.length,
      answers: replacements.map(r => (r === String(others[0]?.id) ? "the replacement" : r)),
      end_audits: w.audit("room.end", id).length,
      links: w.delivered.length,
    }).toEqual({ rooms_made: 1, answers: ["the replacement", "the replacement"], end_audits: 1, links: 2 });
  });

  test("admit-blocked-replacement-refused-by-scope: a missed confirmation call the day before the booked intro (the room carries no intro); the lead knocks on Meet and nobody can let them in: the Zoom room in its place must be made, never refused as 'only for booked intros' after the Meet room was closed", async () => {
    const w = world();
    const appt = bookIntro(w, 22 * HOUR);
    const id = await openRoom(w, setter, { purpose: "fallback", trigger: "no_answer", appointment_id: appt, item_kind: "confirm" });
    // The room went ahead (the lead has a booked intro), and carries no intro (a confirmation call's room).
    expect(w.room(id).state).toBe("open");
    expect(w.room(id).appointment_id ?? null).toBe(null);
    const worker = w.workerBeside();
    const out = await settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" }));
    await worker.stop();
    await w.drain();
    const value = out.ok ? (out.value as Row) : {};
    expect({
      meet_room: w.room(id).state,
      replacement: value.replacement ? "made" : null,
      replacement_refusal: value.replacement_refusal ?? null,
    }).toEqual({ meet_room: "cancelled", replacement: "made", replacement_refusal: null });
  });

  test("admit-blocked-replacement-refused-by-scope (inside the window, another rep's intro): the setter covers a colleague's intro and the lead knocks: the Zoom room in its place must be made", async () => {
    const w = world();
    const appt = bookIntro(w, 2 * MIN, "G-someone-else");
    const id = await openRoom(w, setter, { purpose: "fallback", trigger: "no_answer", appointment_id: appt, item_kind: "intro" });
    expect(w.room(id).state).toBe("open");
    expect(w.room(id).appointment_id ?? null).toBe(null);
    const worker = w.workerBeside();
    const out = await settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" }));
    await worker.stop();
    await w.drain();
    const value = out.ok ? (out.value as Row) : {};
    expect({
      meet_room: w.room(id).state,
      replacement: value.replacement ? "made" : null,
      replacement_refusal: value.replacement_refusal ?? null,
    }).toEqual({ meet_room: "cancelled", replacement: "made", replacement_refusal: null });
  });
});

// ---------------------------------------------------------------------------
// Zoom's events out of order
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: Zoom's events out of order", () => {
  function zoomEvent(w: ReturnType<typeof world>, id: string, event: string, o: { at: number; participant?: Row }): string {
    const r = w.room(id);
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
          payload: { object: { id: meeting, uuid: `uuid-${meeting}`, host_id: "Z-closer", topic: `Mahara call ${String(r.code)}`, ...(o.participant ? { participant: o.participant } : {}) } },
        },
      },
    ]);
    return evId;
  }

  test("zoom-lead-join-after-meeting-end-lost: Huda joins at minute 9 and the call ends at minute 11; Zoom's meeting.ended is read before her join (the join's first forward failed, its replay comes 20 s later): the room must keep her join, never 'nobody joined'", async () => {
    const w = world();
    const id = await openRoom(w, closer, { provider: "zoom", call_kind: "demo" });
    const t0 = w.clock.now;
    const started = zoomEvent(w, id, "meeting.started", { at: t0 + 30 * S });
    w.clock.now = t0 + 31 * S;
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.started", event_id: started });
    expect(w.room(id).state).toBe("host_in");
    // Huda's join at minute 9: stored by the door, its forward to sales-api failed.
    const joined = zoomEvent(w, id, "meeting.participant_joined", {
      at: t0 + 9 * MIN,
      participant: { id: "p-huda", user_id: "16778240", user_name: "Huda Ali", email: "", join_time: new Date(t0 + 9 * MIN).toISOString() },
    });
    // The call ends at minute 11; the door forwards it at once.
    w.clock.now = t0 + 11 * MIN;
    const ended = zoomEvent(w, id, "meeting.ended", { at: t0 + 11 * MIN });
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.ended", event_id: ended });
    // The sweep's replay of her join, 20 s later.
    w.clock.now = t0 + 11 * MIN + 20 * S;
    await settle(w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [joined] } }));
    await w.drain();
    const r = w.room(id);
    expect({ state: r.state, result: r.result ?? null, lead_in_at: r.lead_in_at ? "kept" : null }).toEqual({
      state: "ended",
      result: "joined",
      lead_in_at: "kept",
    });
  });
});

// ---------------------------------------------------------------------------
// The lead's three links an hour, under a press beside the room's own link
// ---------------------------------------------------------------------------

describe("m1 concurrency r1: three call links an hour", () => {
  test("link-cap-passed-by-press-beside-own-link: two rooms' links went this hour; the third room's WhatsApp link is on its way when Also send by email is pressed: the lead gets three links this hour, never four", async () => {
    const w = world({ wa: true });
    for (let i = 0; i < 2; i++) {
      const id = await openRoom(w);
      await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "end" });
      w.clock.now += 5 * MIN;
    }
    expect(w.delivered.length).toBe(2);
    const g = gate();
    w.sendGates.text = g;
    const worker = w.workerBeside();
    await w.create(setter, {});
    await worker.stop();
    const id = String(w.db.t("cockpit_sales_rooms").find(r => r.state === "open")!.id);
    await g.reached;
    const press = settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
    await turns(40);
    g.open();
    const out = await press;
    await w.drain();
    expect({ links_this_hour: w.delivered.length, press: out.ok ? "sent" : codeOf((out as { error: unknown }).error) }).toEqual({
      links_this_hour: 3,
      press: "link_flood",
    });
  });
});
