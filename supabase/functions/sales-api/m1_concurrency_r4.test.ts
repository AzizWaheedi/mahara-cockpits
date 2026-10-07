// bun test supabase/functions/sales-api/m1_concurrency_r4.test.ts
//
// Milestone 1 (the video link when a call fails), round 4, angle:
// concurrency and idempotency on the video-link path, with the pilot's
// settings (m1-scope.md section 3): rooms on, both providers, the three
// lanes on, test_only with the lead on the test list, count_on_join, settle,
// wrap and auto_on_miss off, short_link off, live handover off. The
// WhatsApp gate is locked (connector_off false), so the link goes by email,
// as it will at the pilot's start.
//
// What is new in this round: "I can't let them in" pressed in the moment the
// sweep's timer closes the room; a host switching Zoom devices whose two
// events Zoom delivers out of order; and the minute's re-ask of a link that
// meets the link's own send finishing.
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
const SETTER = "stress-m1c4-setter@stress.invalid";
const CLOSER = "stress-m1c4-closer@stress.invalid";
const LEAD = "stress-m1c4-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await turn();
};

type Lane = "text" | "template" | "email";

function world(o: { wa?: boolean; scope?: "intro" | "any" } = {}) {
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  const delivered: { lane: Lane; requestId: string; at: number; body: string }[] = [];
  const audits: Row[] = [];
  /** Runs after a send's row is marked sent and before the message service answers (its own audit write). */
  const hooks: { afterSent: (() => Promise<void>) | null } = { afterSent: null };
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
  // 10:00 in Kuwait: daytime on the lead's clock.
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: Lane, requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    delivered.push({ lane, requestId, at: w.clock.now, body });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    row.ghl_message_id = `msg-${String(row.id).slice(-6)}`;
    // index.ts convoSendOnce: the row is saved as sent, then its convo.send
    // audit row is written, then the send answers.
    if (hooks.afterSent) await hooks.afterSent();
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
    sendText: (_who, b, opts) =>
      send(b.channel === "email" ? "email" : "text", b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, t.contactId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
      }, t.beforeSend),
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const lines = (id: string, kind?: string) => w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && (!kind || e.kind === kind));
  const audit = (action: string, id?: string) => audits.filter(a => a.action === action && (!id || a.entityId === id));

  async function claim(id: string, run = "run-1") {
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(room(id).version) + 1 },
    });
  }
  async function open(id: string, run = "run-1") {
    const r = room(id);
    const url = r.provider === "zoom" ? ZOOM_URL : MEET_URL;
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
        provider_meeting_id: r.provider === "zoom" ? "85012345678" : `evt-${id.slice(-4)}`,
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
  async function tick(...ids: string[]) {
    return await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
  }
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turns(3);
      await w.flush();
    }
  }
  function workerBeside(o: { ready?: boolean } = {}) {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await claim(id);
        if ((await open(id)) && o.ready !== false) await ready(id);
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
  async function made(who: Who = setter, b: Row = {}, o: { ready?: boolean } = {}): Promise<string> {
    const worker = workerBeside(o);
    const out = await create(who, b);
    await worker.stop();
    return String((out.room as Row).id);
  }
  /**
   * The SQL sweep's timer close (R3 host_not_in, R4 lead_no_show) as
   * cockpit_sales_rooms_close writes it: state, result, end_reason, ended_at.
   */
  function sweepClose(id: string, reason: "lead_no_show" | "host_not_in" = "lead_no_show") {
    const r = room(id);
    Object.assign(r, {
      state: "expired",
      result: "no_join",
      end_reason: reason,
      ended_at: w.db.iso(),
      version: Number(r.version) + 1,
    });
  }
  /** Runs `fn` right before the next PATCH of the rooms table lands (a writer beside the one patching). */
  function beforeRoomPatch(fn: () => void) {
    const hook = (table: string) => {
      if (table !== "cockpit_sales_rooms") {
        w.db.beforePatch = hook;
        return;
      }
      fn();
    };
    w.db.beforePatch = hook;
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
  return {
    ...w,
    io,
    rows,
    delivered,
    audits,
    hooks,
    rooms,
    room,
    lines,
    audit,
    claim,
    open,
    ready,
    tick,
    drain,
    workerBeside,
    create,
    made,
    sweepClose,
    beforeRoomPatch,
    zoomStored,
    forward,
  };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
const codeOf = (e: unknown) => (e instanceof ApiRefusal ? String(e.extra?.code ?? "") : `thrown:${String((e as Error)?.message ?? e)}`);

/** The closer's own Zoom user in a participant event: one device (participant_uuid) and one join (user_id). */
const host = (t: number, device: string, join: string, leaving = false) => ({
  id: "Z-closer",
  user_id: join,
  participant_uuid: `puuid-host-${device}`,
  user_name: "Omar Closer",
  email: CLOSER,
  ...(leaving ? { leave_time: new Date(t).toISOString() } : { join_time: new Date(t).toISOString() }),
});

// ---------------------------------------------------------------------------
// "I can't let them in" in the moment the sweep closes the room
// ---------------------------------------------------------------------------

describe("m1 concurrency r4: I can't let them in, pressed as the sweep's timer closes the room", () => {
  test("control: the press a moment after the timer's close gets the replacement on Zoom (knockAfterClose)", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const v = Number(w.room(id).version);
    w.clock.now += 10 * MIN;
    w.sweepClose(id);
    const worker = w.workerBeside();
    const out = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })) as Row;
    await worker.stop();
    expect({ replacement: Boolean(out.replacement), refusal: out.replacement_refusal ?? null }).toEqual({ replacement: true, refusal: null });
  });

  test("m1-conc-r4-admit-blocked-raced-by-timer-close-answers-neither: the lead is knocking at the Meet door at the ten-minute mark; the setter presses I can't let them in on the open room, and the sweep's R4 closes it (lead_no_show) while the press makes its checks: the press must still answer with the replacement on Zoom (as a press a second later does) or say why not, never neither", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" });
    await w.drain();
    const v = Number(w.room(id).version);
    w.clock.now += 10 * MIN;
    // The sweep's minute lands between the press's read of the open room and its write.
    w.beforeRoomPatch(() => w.sweepClose(id));
    const worker = w.workerBeside();
    const out = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })) as Row;
    await worker.stop();
    await w.drain();
    const live = w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD && ["requested", "creating", "open", "host_in"].includes(String(r.state)));
    expect({
      replacement: Boolean(out.replacement),
      replacement_refusal: typeof out.replacement_refusal === "string",
      closed_room_state: w.room(id).state,
      a_room_for_the_knocking_lead: live.length,
    }).toEqual({ replacement: true, replacement_refusal: false, closed_room_state: "expired", a_room_for_the_knocking_lead: 1 });
  });

  test("m1-conc-r4-admit-blocked-raced-by-timer-close-answers-neither (the dialer's room): on a missed call's room (fallback, scope any), the panel's next step after the answer with neither, Send a video link for that call, is refused as already sent: the lead knocking at the door gets no room", async () => {
    const w = world({ scope: "any" });
    const attempt = crypto.randomUUID();
    const id = await w.made(setter, { purpose: "fallback", attempt_id: attempt, trigger: "manual" });
    await w.drain();
    expect(w.room(id).link_sent_at).toBeTruthy();
    const v = Number(w.room(id).version);
    w.clock.now += 10 * MIN;
    w.beforeRoomPatch(() => w.sweepClose(id));
    const worker = w.workerBeside();
    const out = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })) as Row;
    // The panel (lib/rooms.ts afterAdmitBlocked) says ADMIT_NO_ANSWER: "Send a new video link if the lead still needs one."
    // Round 4 fix: the press answers with the replacement, so the panel shows
    // that room and never offers Send a video link again; a second press
    // for the same call is refused (the lead has the replacement's link).
    const again = await settle(w.create(setter, { purpose: "fallback", attempt_id: attempt, trigger: "manual" }));
    await worker.stop();
    await w.drain();
    const live = w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD && ["requested", "creating", "open", "host_in"].includes(String(r.state)));
    expect({
      answered_with: out.replacement ? "replacement" : typeof out.replacement_refusal === "string" ? "refusal" : "neither",
      rooms_for_the_knocking_lead: live.map(r => r.id),
      next_press: again.ok ? String((again.value.room as Row).id) : codeOf(again.error),
    }).toEqual({
      answered_with: "replacement",
      rooms_for_the_knocking_lead: [String((out.replacement as Row | undefined)?.id ?? "none")],
      // m1 round 3b (knocked-close-says-send-new-link-create-refuses): a room
      // closed on the lead's knock no longer counts as this call's one link,
      // so the second press meets the replacement itself: lead_has_room.
      next_press: again.ok ? String((out.replacement as Row | undefined)?.id ?? "none") : "lead_has_room",
    });
  });
});

// ---------------------------------------------------------------------------
// The host switches Zoom devices; Zoom delivers the old device's leave first
// ---------------------------------------------------------------------------

describe("m1 concurrency r4: the host moves from laptop to phone, and Zoom's two events come out of order", () => {
  test("control: the phone's join read before the laptop's leave: the room keeps the host in", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    const j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
    w.clock.now = t0 + 5 * MIN + S;
    await w.forward(j2, "meeting.participant_joined");
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + 3 * S, participant: host(t0 + 5 * MIN + 3 * S, "laptop", "16771", true) });
    w.clock.now = t0 + 5 * MIN + 4 * S;
    await w.forward(l1, "meeting.participant_left");
    await w.drain();
    expect(w.room(id).state).toBe("host_in");
  });

  test("m1-conc-r4-zoom-second-device-join-read-after-first-device-leave-ignored: the closer joins on the phone at 10:05:00 and closes the laptop at 10:05:03; Zoom delivers the laptop's leave first and the phone's join a second later: the room must say the host is in (the phone's session never left), not wait for a host who is there", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    // 10:05:04: the laptop's leave (10:05:03) arrives and is stored and forwarded first.
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + 3 * S, participant: host(t0 + 5 * MIN + 3 * S, "laptop", "16771", true) });
    w.clock.now = t0 + 5 * MIN + 4 * S;
    await w.forward(l1, "meeting.participant_left");
    // 10:05:05: the phone's join (10:05:00) arrives a second later.
    const j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
    w.clock.now = t0 + 5 * MIN + 5 * S;
    await w.forward(j2, "meeting.participant_joined");
    await w.drain();
    const status = (await w.rooms.actions["room.status"]!(closer, { room_id: id })) as Row;
    expect({ state: w.room(id).state, panel: (status.room as Row).state }).toEqual({ state: "host_in", panel: "host_in" });
  });

  test("m1-conc-r4-zoom-second-device-join-read-after-first-device-leave-ignored (the record): with the lead never coming, the room is closed by the sweep's R3 as the host who never joined (host_not_in), though the closer sat in the meeting on the phone", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const j1 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(j1, "meeting.participant_joined");
    const l1 = w.zoomStored(id, "meeting.participant_left", { at: t0 + 5 * MIN + 3 * S, participant: host(t0 + 5 * MIN + 3 * S, "laptop", "16771", true) });
    w.clock.now = t0 + 5 * MIN + 4 * S;
    await w.forward(l1, "meeting.participant_left");
    const j2 = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 5 * MIN, participant: host(t0 + 5 * MIN, "phone", "16772") });
    w.clock.now = t0 + 5 * MIN + 5 * S;
    await w.forward(j2, "meeting.participant_joined");
    await w.drain();
    // The rule the SQL sweep runs first on such a room: R3 (open: the host did
    // not come in) before R4 (open or host_in: the lead did not come in).
    const r = w.room(id);
    const ruleThatCloses = r.state === "open" ? "host_not_in" : r.state === "host_in" ? "lead_no_show" : String(r.state);
    expect(ruleThatCloses).toBe("lead_no_show");
  });
});

// ---------------------------------------------------------------------------
// The minute's re-ask meets the link's own send as it finishes
// ---------------------------------------------------------------------------

describe("m1 concurrency r4: the tick's re-ask of a link whose own send is just finishing", () => {
  test("m1-conc-r4-reask-beside-finishing-send-second-link-row: the link's email was claimed at 10:00:00 and HighLevel took it at 10:01:00.9; the tick's re-ask lands in the moment between the message row going sent and the send's own record: one room.link audit row for the one email", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" }, { ready: false });
    let reask: Promise<unknown> | null = null;
    w.hooks.afterSent = async () => {
      w.hooks.afterSent = null;
      // The minute's tick, a second past the claim's minute.
      w.clock.now += 61 * S;
      reask = w.tick(id).then(() => w.drain());
      await turns(40);
      await w.flush();
    };
    await w.ready(id);
    await w.drain();
    if (reask) await reask;
    await w.drain();
    expect({
      emails: w.delivered.length,
      link_rows: w.audit("room.link", id).length,
      sent_lines: w.lines(id, "link.sent").length,
    }).toEqual({ emails: 1, link_rows: 1, sent_lines: 1 });
  });
});

// ---------------------------------------------------------------------------
// More presses at once (these held in round 4; kept as regression tests)
// ---------------------------------------------------------------------------

describe("m1 concurrency r4: presses at once that held", () => {
  test("I can't let them in from two tabs at once: one replacement, both tabs shown it, one room.end row", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" });
    await w.drain();
    const v = Number(w.room(id).version);
    const worker = w.workerBeside();
    const both = await Promise.all([
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })),
      settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "admit_blocked" })),
    ]);
    await worker.stop();
    await w.drain();
    const repl = both.map(b => (b.ok ? String(((b.value as Row).replacement as Row | undefined)?.id ?? "none") : codeOf(b.error)));
    const made = w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD && r.id !== id);
    expect({ rooms: made.length, same: repl[0] === repl[1] && repl[0] !== "none", end_rows: w.audit("room.end", id).length, links: w.delivered.length }).toEqual({
      rooms: 1,
      same: true,
      end_rows: 1,
      links: 2,
    });
  });

  test("Send a video link from two tabs at once (each its own request id): one room, one room.create row, one link", async () => {
    const w = world({ scope: "any" });
    const attempt = crypto.randomUUID();
    const worker = w.workerBeside();
    const both = await Promise.all([
      settle(w.create(setter, { purpose: "fallback", attempt_id: attempt, trigger: "manual" })),
      settle(w.create(setter, { purpose: "fallback", attempt_id: attempt, trigger: "manual" })),
    ]);
    await worker.stop();
    await w.drain();
    expect({
      rooms: w.db.t("cockpit_sales_rooms").length,
      answers: both.map(b => (b.ok ? "room" : codeOf(b.error))).sort(),
      create_rows: w.audit("room.create").length,
      links: w.delivered.length,
    }).toEqual({ rooms: 1, answers: ["lead_has_room", "room"], create_rows: 1, links: 1 });
  });

  test("Also send by email from two tabs while the link's own email is on its way: one email, no second row", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" }, { ready: false });
    let presses: Promise<unknown>[] = [];
    w.hooks.afterSent = async () => {
      w.hooks.afterSent = null;
      presses = [
        settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() })),
        settle(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() })),
      ];
      await turns(10);
    };
    await w.ready(id);
    await w.drain();
    await Promise.all(presses);
    await w.drain();
    expect({ emails: w.delivered.length, send_rows: w.audit("room.send", id).length, link_rows: w.audit("room.link", id).length }).toEqual({
      emails: 1,
      send_rows: 0,
      link_rows: 1,
    });
  });

  test("worker.ready, its replay and three overlapping ticks at once: one email, one room.link row", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" }, { ready: false });
    w.clock.now += 61 * S;
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${id}`) as Row;
    await Promise.all([
      settle(w.ready(id)),
      settle(w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [String(ev.id)] } })),
      settle(w.tick(id)),
      settle(w.tick(id)),
      settle(w.tick(id)),
    ]);
    await w.drain();
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect({ emails: w.delivered.length, link_rows: w.audit("room.link", id).length, claims: w.audit("room.link.claim", id).length + w.audit("room.event.worker.ready", id).length }).toEqual({
      emails: 1,
      link_rows: 1,
      claims: 1,
    });
  });

  test("The lead is in pressed as the sweep closes the Meet room at the ten-minute mark: the join is kept on the closed room", async () => {
    const w = world();
    const id = await w.made(setter, { purpose: "manual" });
    await w.drain();
    const v = Number(w.room(id).version);
    w.clock.now += 10 * MIN;
    w.beforeRoomPatch(() => w.sweepClose(id));
    const out = await settle(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" }));
    await w.drain();
    const r = w.room(id);
    expect({ answered: out.ok ? "room" : codeOf(out.error), result: r.result, joined: Boolean(r.lead_in_at) }).toEqual({ answered: "room", result: "joined", joined: true });
  });
});

// ---------------------------------------------------------------------------
// End pressed in the moment the lead joins the Zoom meeting
// ---------------------------------------------------------------------------

/** The lead in a Zoom participant event (nobody on the team). */
const leadIn = (t: number) => ({
  id: "",
  user_id: "16790",
  participant_uuid: "puuid-lead-1",
  user_name: "Huda Ali",
  join_time: new Date(t).toISOString(),
});

describe("m1 concurrency r4: End pressed as the lead joins the Zoom meeting", () => {
  test("control: the lead's join read before the End: the room is lead_in, and End then asks to confirm", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const h = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(h, "meeting.participant_joined");
    const j = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 3 * MIN, participant: leadIn(t0 + 3 * MIN) });
    w.clock.now = t0 + 3 * MIN + 2 * S;
    await w.forward(j, "meeting.participant_joined");
    expect(w.room(id).state).toBe("lead_in");
  });

  test("m1-conc-r4-end-press-drops-zoom-lead-join-from-before-it: the lead joins the closer's Zoom at 10:03:00, the closer presses End at 10:03:01 (the panel still said nobody came), and Zoom's webhook for the join is read at 10:03:03: the room must keep the lead's join (result joined, lead_in_at 10:03:00), as it does for a timer's close or the meeting's end, never no_join", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const h = w.zoomStored(id, "meeting.participant_joined", { at: t0 + MIN, participant: host(t0 + MIN, "laptop", "16771") });
    w.clock.now = t0 + MIN + S;
    await w.forward(h, "meeting.participant_joined");
    expect(w.room(id).state).toBe("host_in");
    const v = Number(w.room(id).version);
    // 10:03:01: End, from the panel that still says the lead has not come.
    w.clock.now = t0 + 3 * MIN + S;
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" });
    // 10:03:03: Zoom's webhook for the lead's join at 10:03:00 is stored and read.
    const j = w.zoomStored(id, "meeting.participant_joined", { at: t0 + 3 * MIN, participant: leadIn(t0 + 3 * MIN) });
    w.clock.now = t0 + 3 * MIN + 3 * S;
    await settle(w.forward(j, "meeting.participant_joined"));
    await w.drain();
    const r = w.room(id);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === j) as Row;
    expect({
      result: r.result,
      lead_in_at: r.lead_in_at ? new Date(String(r.lead_in_at)).toISOString() : null,
      join_refused: Boolean((ev.detail as Row)?.refused),
    }).toEqual({ result: "joined", lead_in_at: new Date(t0 + 3 * MIN).toISOString(), join_refused: false });
  });
});

describe("m1 concurrency r4: End pressed as the lead knocks at the Zoom waiting room", () => {
  test("control: the knock read before the End: the closed room keeps it and the banner still shows it", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const k = w.zoomStored(id, "meeting.participant_joined_waiting_room", { at: t0 + 3 * MIN, participant: { ...leadIn(t0 + 3 * MIN), join_time: undefined, date_time: new Date(t0 + 3 * MIN).toISOString() } });
    w.clock.now = t0 + 3 * MIN + S;
    await w.forward(k, "meeting.participant_joined_waiting_room");
    const v = Number(w.room(id).version);
    w.clock.now = t0 + 3 * MIN + 3 * S;
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" });
    await w.drain();
    const live = (await w.rooms.actions["live.status"]!(closer, {})) as Row;
    expect({ knock_kept: Boolean(w.room(id).lead_waiting_at), banner_keeps_it: JSON.stringify(live).includes(id) }).toEqual({ knock_kept: true, banner_keeps_it: true });
  });

  test("m1-conc-r4-end-press-drops-zoom-knock-from-before-it: the lead lands in the waiting room at 10:03:00, the closer presses End at 10:03:01 and leaves, Zoom's webhook is read at 10:03:03: the knock must stay on the room so the banner keeps it (call them now), never dropped as an event on a closed room", async () => {
    const w = world();
    const id = await w.made(closer, { provider: "zoom", call_kind: "demo" });
    await w.drain();
    const t0 = w.clock.now;
    const v = Number(w.room(id).version);
    w.clock.now = t0 + 3 * MIN + S;
    await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "end" });
    const k = w.zoomStored(id, "meeting.participant_joined_waiting_room", { at: t0 + 3 * MIN, participant: { ...leadIn(t0 + 3 * MIN), join_time: undefined, date_time: new Date(t0 + 3 * MIN).toISOString() } });
    w.clock.now = t0 + 3 * MIN + 3 * S;
    await settle(w.forward(k, "meeting.participant_joined_waiting_room"));
    await w.drain();
    const live = (await w.rooms.actions["live.status"]!(closer, {})) as Row;
    const shown = JSON.stringify(live).includes(id);
    expect({ knock_kept: Boolean(w.room(id).lead_waiting_at), banner_keeps_it: shown }).toEqual({ knock_kept: true, banner_keeps_it: true });
  });
});
