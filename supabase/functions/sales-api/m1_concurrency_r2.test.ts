// bun test supabase/functions/sales-api/m1_concurrency_r2.test.ts
//
// Milestone 1 (the video link when a call fails), round 2, angle:
// concurrency and idempotency on the video-link path, with the pilot's
// settings (m1-scope.md section 3): rooms on, both providers, the three
// lanes on, test_only with the lead on the test list, count_on_join, settle,
// wrap and auto_on_miss off, short_link off, live handover off. The
// WhatsApp gate is locked (connector_off false) unless a test opens it, so
// the link goes by email, as it will at the pilot's start.
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
const SETTER = "stress-m1c2-setter@stress.invalid";
const CLOSER = "stress-m1c2-closer@stress.invalid";
const LEAD = "stress-m1c2-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85012345678?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
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

/**
 * The pilot's world. `readBack`: a gate a send waits on after HighLevel took
 * it and the lead has it, while the message service reads it back (the 2 to
 * 20 s HighLevel's status read takes), before it answers the caller.
 */
function world(o: { wa?: boolean; start?: number } = {}) {
  const w = fakeWorld(o.start);
  const rows = new Map<string, Row>();
  /** What reached the lead, with the room states at that moment. */
  const delivered: { lane: Lane; requestId: string; at: number; contact: string; body: string; roomStates: Record<string, string> }[] = [];
  const audits: Row[] = [];
  const readBack: Partial<Record<Lane, Gate>> = {};
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
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  const roomStates = () => Object.fromEntries(w.db.t("cockpit_sales_rooms").map(r => [String(r.code), String(r.state)]));
  async function send(lane: Lane, requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    // The message service's last check, right before HighLevel is asked.
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    delivered.push({ lane, requestId, at: w.clock.now, contact: contactId, body, roomStates: roomStates() });
    // HighLevel took it and the lead has it; the service reads its status back.
    const g = readBack[lane];
    if (g) {
      delete readBack[lane];
      g.hit();
      await g.wait;
    }
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
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
    const url = r.provider === "zoom" ? ZOOM_URL.replace("85012345678", String(85_000_000_000 + w.db.t("cockpit_sales_rooms").indexOf(r) + 1)) : MEET_URL.replace("hij", `h${w.db.t("cockpit_sales_rooms").indexOf(r)}j`);
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
  async function tick(...ids: string[]) {
    return await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
  }
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turns(3);
      await w.flush();
    }
  }
  /** The worker beside a press: claims and opens the first requested room it sees, then tells sales-api. */
  function workerBeside() {
    let stop = false;
    const done = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await claim(id);
        if (await open(id)) await ready(id);
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
  /** A room made by a press, opened by the worker beside it; background work not drained. */
  async function made(who: Who = setter, b: Row = {}): Promise<string> {
    const worker = workerBeside();
    const out = await create(who, b);
    await worker.stop();
    return String((out.room as Row).id);
  }
  return { ...w, io, rows, delivered, audits, readBack, rooms, room, lines, audit, claim, open, ready, tick, drain, workerBeside, create, made };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
const codeOf = (e: unknown) => (e instanceof ApiRefusal ? String(e.extra?.code ?? "") : `thrown:${String((e as Error)?.message ?? e)}`);

// ---------------------------------------------------------------------------
// A link that went while the room was open, recorded after a press closed it
// ---------------------------------------------------------------------------

describe("m1 concurrency r2: We are on the phone while the link's send is being read back", () => {
  test("control: the link that went with no press beside it is on the room (link_sent_at) and counts as one of the lead's links", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    expect(w.delivered.length).toBe(1);
    expect(w.room(id).link_sent_at).toBeTruthy();
  });

  test("link-went-room-closed-in-readback-unrecorded: HighLevel took the email and the lead has it; the lead calls back and the setter presses We are on the phone while the message service reads the email's status back: the room must still say its link went", async () => {
    const w = world();
    const g = gate();
    w.readBack.email = g;
    const id = await w.made();
    await g.reached; // the email is with the lead now
    const end = await settle(w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "on_phone" }));
    g.open();
    await w.drain();
    const r = w.room(id);
    expect({
      end: end.ok ? "landed" : codeOf((end as { error: unknown }).error),
      links_to_lead: w.delivered.length,
      room_link_sent_at: r.link_sent_at ? "set" : null,
      room_link_channels: r.link_channels,
      link_audit_rows: w.audit("room.link", id).length,
    }).toEqual({ end: "landed", links_to_lead: 1, room_link_sent_at: "set", room_link_channels: ["email"], link_audit_rows: 1 });
  });

  test("link-went-room-closed-in-readback-unrecorded (the lead's cap): Make a room and End in turn, each End landing while the link's email is read back: the lead must get three call links this hour, never a fourth", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) {
      const g = gate();
      w.readBack.email = g;
      const id = await w.made();
      // Either the link reaches the lead (and the press lands in its read-back)
      // or the room's own cap stops it (no send at all).
      const first = await Promise.race([g.reached.then(() => "sent" as const), (async () => {
        await w.drain();
        return "held" as const;
      })()]);
      await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "on_phone" });
      g.open();
      await w.drain();
      if (first === "held") break;
      w.clock.now += 4 * MIN;
    }
    const counted = w.db
      .t("cockpit_sales_rooms")
      .filter(r => r.link_sent_at)
      .length;
    expect({ links_this_hour: w.delivered.length, rooms_that_say_their_link_went: counted }).toEqual({
      links_this_hour: 3,
      rooms_that_say_their_link_went: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// I can't let them in, on a room another press or the sweep closed a moment ago
// ---------------------------------------------------------------------------

/**
 * The panel's own step after room.end admit_blocked (RoomPanel.tsx, the held
 * "admit_blocked" press, afterAdmitBlocked in lib/rooms.ts): an answer with
 * neither `replacement` nor `replacement_refusal` makes the panel cancel the
 * room (a no-op on a closed one) and make a Zoom room itself through
 * room.create with retryRequest's fields and a fresh request id.
 */
async function panelAfterAdmitBlocked(w: ReturnType<typeof world>, answer: Row, closed: Row): Promise<"show" | "refused" | Row> {
  if (answer.replacement) return "show";
  if (answer.replacement_refusal) return "refused";
  await settle(w.rooms.actions["room.end"]!(setter, { room_id: String(closed.id), version: Number(closed.version), reason: "cancel" }));
  const worker = w.workerBeside();
  const out = await settle(
    w.create(setter, {
      provider: "zoom",
      call_kind: String(closed.call_kind),
      purpose: String(closed.purpose),
      ...(closed.trigger ? { trigger: closed.trigger } : {}),
      ...(closed.attempt_id ? { attempt_id: closed.attempt_id } : {}),
    }),
  );
  await worker.stop();
  return out.ok ? (out.value.room as Row) : { refused: codeOf((out as { error: unknown }).error) };
}

describe("m1 concurrency r2: I can't let them in pressed on a room that just closed", () => {
  test("admit-blocked-on-closed-room-answers-neither (two tabs): the lead page's tab presses We are on the phone (the lead called back) as the dialer's tab presses I can't let them in on the same Meet room: no Zoom link may go to the lead who is on the phone", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    expect(w.delivered.length).toBe(1);
    const seen = { ...w.room(id) };
    // The lead page's tab: We are on the phone.
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(seen.version), reason: "on_phone" });
    expect(w.room(id).state).toBe("cancelled");
    // The dialer's tab, its 5-second Undo run out: I can't let them in, with the version it saw.
    const answer = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(seen.version), reason: "admit_blocked" })) as Row;
    const next = await panelAfterAdmitBlocked(w, answer, seen);
    await w.drain();
    expect({
      answer_says: answer.replacement ? "replacement" : answer.replacement_refusal ? "replacement_refusal" : "neither",
      zoom_rooms_made: w.db.t("cockpit_sales_rooms").filter(r => r.provider === "zoom").length,
      links_after_on_phone: w.delivered.length - 1,
      panel: typeof next === "string" ? next : "made a room itself",
    }).toEqual({ answer_says: "replacement_refusal", zoom_rooms_made: 0, links_after_on_phone: 0, panel: "refused" });
  });

  test("admit-blocked-on-closed-room-answers-neither (the sweep): the lead knocks on the Meet room at 21:01:50 on their clock and nobody can let them in; the sweep closes the room at its ten minutes (21:02) as the setter's press lands: the Zoom room in its place must reach the lead, as it does when the press is a second earlier", async () => {
    // Thursday 8 October 2026, 20:52 in Kuwait (17:52 UTC): a manual room
    // from the lead page (the pilot's path for the test contact), by day.
    const run = async (sweepFirst: boolean) => {
      const w = world({ start: Date.parse("2026-10-08T17:52:00Z") });
      const id = await w.made();
      await w.drain();
      expect(w.delivered.length).toBe(1);
      const seen = { ...w.room(id) };
      // 21:02:05: the lead knocked at 21:01:50; the setter pressed I can't let
      // them in at 21:02:00 and its 5-second Undo has run out.
      w.clock.now = Date.parse("2026-10-08T18:02:05Z");
      if (sweepFirst) {
        // R4 (lead_no_show) at 21:02:04: the sweep's cockpit_sales_rooms_close.
        const r = w.room(id);
        Object.assign(r, { state: "expired", end_reason: "lead_no_show", result: "no_join", ended_at: new Date(w.clock.now - S).toISOString(), version: Number(r.version) + 1 });
      }
      const answer = (await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(seen.version), reason: "admit_blocked" })) as Row;
      let zoomRoom: Row | null = null;
      if (answer.replacement) {
        await w.drain();
        // The worker opens the replacement and tells sales-api.
        const rep = w.db.t("cockpit_sales_rooms").find(r => r.provider === "zoom") as Row;
        if (rep.state === "requested") {
          await w.claim(String(rep.id));
          await w.open(String(rep.id));
          await w.ready(String(rep.id));
        }
        zoomRoom = rep;
      } else {
        const next = await panelAfterAdmitBlocked(w, answer, seen);
        zoomRoom = typeof next === "string" ? null : next;
      }
      await w.drain();
      const zoomLinks = w.delivered.filter(d => /zoom\.us/.test(d.body)).length;
      return {
        answer_says: answer.replacement ? "replacement" : answer.replacement_refusal ? "replacement_refusal" : "neither",
        zoom_room: zoomRoom && !("refused" in zoomRoom) ? "made" : zoomRoom ? `refused: ${String(zoomRoom.refused)}` : "none",
        zoom_link_reached_lead: zoomLinks > 0,
        refusal_on_zoom_room: zoomRoom && zoomRoom.id ? (w.room(String(zoomRoom.id)).refusal ?? null) : null,
      };
    };
    const pressFirst = await run(false);
    expect(pressFirst.zoom_link_reached_lead).toBe(true);
    const sweepFirst = await run(true);
    expect(sweepFirst).toEqual({ ...pressFirst, answer_says: sweepFirst.answer_says === "neither" ? "replacement" : sweepFirst.answer_says });
  });
});

// ---------------------------------------------------------------------------
// Still on the call, said twice
// ---------------------------------------------------------------------------

describe("m1 concurrency r2: Still on the call, pressed again ten minutes later", () => {
  test("still-on-repeat-press-no-audit-row: the first Still on it moves the room's end and leaves its row and line; the panel asks again ten minutes later and the second press moves the end again: it must leave its own row and line too", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    expect(w.room(id).state).toBe("lead_in");
    w.clock.now += 28 * MIN;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "still_on" });
    const firstEnd = String(w.room(id).ends_at);
    w.clock.now += 10 * MIN;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "still_on" });
    const secondEnd = String(w.room(id).ends_at);
    expect(Date.parse(secondEnd)).toBeGreaterThan(Date.parse(firstEnd));
    expect({
      ends_moved: 2,
      audit_rows: w.audit("room.mark.still_on", id).length,
      timeline_lines: w.lines(id, "room.mark.still_on").length,
    }).toEqual({ ends_moved: 2, audit_rows: 2, timeline_lines: 2 });
  });
});

// ---------------------------------------------------------------------------
// A retry of Send a video link after the room it made was ended
// ---------------------------------------------------------------------------

describe("m1 concurrency r2: Send a video link again, carrying the first press's request id", () => {
  test("HELD (control, the server half of create-retry-id-returns-ended-room): a press carrying a request id whose room was made and then ended by a person is answered with that ended room; nothing new is made and nothing goes (the server's repeat rule; apps/sales-cockpit lib/m1_concurrency_r2_ui.test.ts shows the panel sending such an id)", async () => {
    const w = world();
    const requestId = crypto.randomUUID();
    const id = await w.made(setter, { request_id: requestId });
    await w.drain();
    expect(w.delivered.length).toBe(1);
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "on_phone" });
    w.clock.now += 60 * S;
    const worker = w.workerBeside();
    const again = (await w.create(setter, { request_id: requestId })) as Row;
    await worker.stop();
    await w.drain();
    expect({
      answered_room: String((again.room as Row).state),
      rooms_made: w.db.t("cockpit_sales_rooms").length,
      links_to_lead: w.delivered.length,
    }).toEqual({ answered_room: "cancelled", rooms_made: 1, links_to_lead: 1 });
  });
});

// ---------------------------------------------------------------------------
// Two minutes' ticks reading one bounced email at once
// ---------------------------------------------------------------------------

describe("m1 concurrency r2: two ticks read the same bounced link", () => {
  test("recheck-overlap-doubles-failed-late-row: the minute's tick reads the email link bounced while the last minute's read of it is still on its way (HighLevel slow): one bounce, one room.link.failed_late row and one line", async () => {
    const w = world();
    const id = await w.made();
    await w.drain();
    expect(w.delivered.length).toBe(1);
    // HighLevel: the email bounced. The first read answers at once; the
    // second (the other tick's) answers only after the first run is done.
    const slow = gate();
    let reads = 0;
    w.routes.unshift(async (m, p) => {
      if (m !== "GET" || !p.startsWith("/conversations/messages/msg-")) return null as unknown as Row;
      reads += 1;
      if (reads === 2) {
        slow.hit();
        await slow.wait;
      }
      return { message: { status: "bounced", error: "550 mailbox unavailable" } };
    });
    w.clock.now += 2 * MIN;
    // Two ticks for the room at once (an overrun minute and the next one).
    await Promise.all([w.tick(id), w.tick(id)]);
    await slow.reached;
    // The first run finishes (its line, its row, the lease given back)...
    for (let i = 0; i < 6; i++) {
      await turns(3);
      const done = w.audit("room.link.failed_late", id).length > 0;
      if (done) break;
    }
    await turns(10);
    // ...then the second read answers.
    slow.open();
    await w.drain();
    expect({
      failed_late_rows: w.audit("room.link.failed_late", id).length,
      failed_late_lines: w.lines(id, "link.failed_late").length,
      links_to_lead: w.delivered.length,
    }).toEqual({ failed_late_rows: 1, failed_late_lines: 1, links_to_lead: 1 });
  });
});
