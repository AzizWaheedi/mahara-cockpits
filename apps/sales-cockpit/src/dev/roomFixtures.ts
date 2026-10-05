/**
 * Made-up video rooms for the layout harness and the tests: one for every
 * moment in the specs' copy tables, built around "now" so countdowns run.
 * Nothing here is a real lead; "Faisal" is the harness's lead-1 and the
 * hosts are the harness's made-up team.
 *
 * src/dev/harness.tsx reads these knobs (src/dev/liveHarness.ts keeps the
 * room's state between presses):
 *   room   making | ready | sent | not_sent | not_sent_zoom | not_confirmed |
 *          opened | waiting | host_in | joined | joined_marked |
 *          joined_not_lead | still_on_call | expired | failed |
 *          failed_handover | down | pending_zoom | booked
 *   offer  incoming | taken | lost | missed | expired | refresh | standby |
 *          making | standby_failed | away | available | ready | booked |
 *          on_call | down | live_off
 * and answers sales-api's room and live actions with `answerRoomsAction`.
 */
import { clock } from "../lib/format";
import {
  clockSec,
  type Health,
  type LiveStatus,
  type Offer,
  type Presence,
  type ReplyAlert,
  type RoomEvent,
  type RoomFeed,
  type RoomView,
  type StripFlash,
} from "../lib/rooms";

const S = 1000;
const MIN = 60 * S;

const iso = (ms: number) => new Date(ms).toISOString();

export const ROOM_KNOBS = [
  "making",
  "ready",
  "sent",
  "not_sent",
  "not_sent_zoom",
  "not_confirmed",
  "opened",
  "waiting",
  "host_in",
  "joined",
  "joined_marked",
  "joined_not_lead",
  "still_on_call",
  "expired",
  "failed",
  "failed_handover",
  "down",
  "pending_zoom",
  "booked",
] as const;
export type RoomKnob = (typeof ROOM_KNOBS)[number];

export const OFFER_KNOBS = [
  "incoming",
  "taken",
  "lost",
  "missed",
  "expired",
  "refresh",
  "standby",
  "making",
  "standby_failed",
  "away",
  "available",
  "ready",
  "booked",
  "on_call",
  "down",
  "live_off",
] as const;
export type OfferKnob = (typeof OFFER_KNOBS)[number];

export function isRoomKnob(v: unknown): v is RoomKnob {
  return (ROOM_KNOBS as readonly unknown[]).includes(v);
}

export function isOfferKnob(v: unknown): v is OfferKnob {
  return (OFFER_KNOBS as readonly unknown[]).includes(v);
}

/** A fallback room on Meet for lead-1, open, nothing sent yet. */
export function baseRoom(now: number, over: Partial<RoomView> = {}): RoomView {
  return {
    id: "room-k7q2mx",
    code: "K7Q2MX",
    contact_id: "lead-1",
    contact_first_name: "Faisal",
    purpose: "fallback",
    call_kind: "intro",
    provider: "meet",
    host_email: "sara@example.com",
    state: "open",
    version: 3,
    short_url: "https://call.maharamedia.com/K7Q2MX",
    join_url: "https://meet.google.com/abc-defg-hij",
    link_channels: [],
    link_sent_at: null,
    first_open_at: null,
    open_device: null,
    lead_waiting_at: null,
    host_in_at: null,
    lead_in_at: null,
    lead_in_seen_at: null,
    ended_at: null,
    host_by: iso(now + 14 * MIN),
    lead_by: null,
    ends_at: iso(now + 29 * MIN),
    result: null,
    count_result: null,
    error: null,
    refusal: null,
    created_at: iso(now - MIN),
    // Contract v2's six (section 3): served on every room, null when not known.
    link_unconfirmed_at: null,
    starts_at: null,
    trigger: null,
    attempt_id: null,
    appointment_id: null,
    asked_appointment_id: null,
    handover_id: null,
    // stress2 fix round 1: why the sweep closed it, and the lead's latest open.
    end_reason: null,
    last_open_at: null,
    last_link_at: null,
    late_open_at: null,
    ...over,
  };
}

/** Sent 48 s ago as free WhatsApp text: 9:12 left for the lead. */
function sent(now: number, over: Partial<RoomView> = {}): RoomView {
  const at = now - 48 * S;
  return baseRoom(now, {
    version: 4,
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(at),
    lead_by: iso(at + 600 * S),
    ...over,
  });
}

const ZOOM = {
  provider: "zoom" as const,
  join_url: "https://us06web.zoom.us/j/81234567890",
};

export function healthFixture(now: number, down = false): Health {
  if (down)
    return {
      worker_ok: false,
      last_run_at: iso(now - 11 * MIN),
      rooms_today: 6,
      failed_today: 1,
      line: `Video rooms are not being made (last check ${clock(iso(now - 11 * MIN))}). Call the lead on the phone, or send your own Zoom or Meet link.`,
    };
  return {
    worker_ok: true,
    last_run_at: iso(now - 2 * S),
    rooms_today: 6,
    failed_today: 0,
    line: `Rooms: working. Last run ${clockSec(iso(now - 2 * S))}. 6 rooms today, 0 failed.`,
  };
}

/** The room's timeline as room.status sends it, from its own times. */
export function roomEvents(now: number, room: RoomView): RoomEvent[] {
  const made = room.created_at ?? iso(now - MIN);
  const out: RoomEvent[] = [
    {
      at: made,
      kind: "room.requested",
      source: "cockpit",
      text: "The setter asked for a room.",
    },
  ];
  if (
    room.join_url &&
    !["requested", "creating", "failed"].includes(room.state)
  )
    out.push({
      at: iso(Date.parse(made) + 6 * S),
      kind: "worker.ready",
      source: "worker",
      text: `Room made on ${room.provider === "zoom" ? "Zoom" : "Meet"}.`,
    });
  if (room.link_sent_at)
    out.push({
      at: room.link_sent_at,
      kind: "link_sent",
      source: "sales-api",
      text: "Link sent.",
    });
  if (room.first_open_at)
    out.push({
      at: room.first_open_at,
      kind: "door.open",
      source: "short link",
      text: "The lead opened the link.",
    });
  if (room.host_in_at)
    out.push({
      at: room.host_in_at,
      kind: "host_in",
      source: room.provider === "zoom" ? "zoom" : "rep",
      text: "The host joined.",
    });
  if (room.lead_in_at)
    out.push({
      at: room.lead_in_at,
      kind: "lead_in",
      source: room.provider === "zoom" ? "zoom" : "rep",
      text: "The lead joined.",
    });
  if (room.state === "failed")
    out.push({
      at: iso(now - 5 * S),
      kind: "worker.failed",
      source: "worker",
      text: room.error ?? "The room could not be made.",
    });
  return out;
}

/** The room as room.status returns it, for a knob. */
export function roomFixture(
  knob: RoomKnob,
  now: number = Date.now(),
): { feed: RoomFeed; canMarkIntro: boolean } {
  let room: RoomView;
  let down = false;
  let canMarkIntro = false;
  switch (knob) {
    case "making":
      room = baseRoom(now, {
        state: "creating",
        version: 2,
        short_url: null,
        join_url: null,
        host_by: null,
        ends_at: null,
        created_at: iso(now - 4 * S),
      });
      break;
    case "down":
      down = true;
      // Past the sweep's minute for a claim: only then does the panel say a
      // room will not be made (m1 round 1, worker-red-but-create-accepted).
      room = baseRoom(now, {
        state: "requested",
        version: 1,
        short_url: null,
        join_url: null,
        host_by: null,
        ends_at: null,
        created_at: iso(now - 70 * S),
      });
      break;
    case "ready":
      room = baseRoom(now);
      break;
    case "sent":
      room = sent(now);
      break;
    case "not_sent":
      room = baseRoom(now, {
        refusal: "No message can reach this lead.",
      });
      break;
    case "not_sent_zoom": {
      // Before the short link exists: a Zoom link nobody can read out.
      const url =
        "https://us06web.zoom.us/j/81234567890?pwd=aBcD3fGhIjKlMnOpQrStUvWxYz012345.1";
      room = baseRoom(now, {
        provider: "zoom",
        short_url: url,
        join_url: url,
        refusal: "No message can reach this lead.",
      });
      break;
    }
    case "not_confirmed":
      // The template went, was not seen within 20 s, and email went too.
      room = sent(now, {
        link_channels: ["whatsapp_template", "email"],
        link_unconfirmed_at: iso(now - 28 * S),
      });
      break;
    case "opened":
      room = sent(now, {
        version: 5,
        first_open_at: iso(now - 20 * S),
        open_device: "phone",
      });
      break;
    case "waiting":
      room = sent(now, {
        ...ZOOM,
        version: 6,
        first_open_at: iso(now - 30 * S),
        open_device: "phone",
        lead_waiting_at: iso(now - 12 * S),
      });
      break;
    case "host_in":
      room = sent(now, {
        state: "host_in",
        version: 5,
        host_in_at: iso(now - 30 * S),
      });
      break;
    case "joined":
    case "joined_marked":
    case "joined_not_lead":
      room = sent(now, {
        ...ZOOM,
        state: "lead_in",
        version: 8,
        first_open_at: iso(now - 40 * S),
        open_device: "phone",
        host_in_at: iso(now - 45 * S),
        lead_waiting_at: iso(now - 35 * S),
        lead_in_at: iso(now - 25 * S),
        // A booked intro moved to now is marked, not booked again.
        count_result:
          knob === "joined"
            ? "booked"
            : knob === "joined_marked"
              ? "moved"
              : "not_a_lead",
      });
      break;
    case "still_on_call":
      room = sent(now, {
        ...ZOOM,
        state: "lead_in",
        version: 9,
        first_open_at: iso(now - 31 * MIN),
        host_in_at: iso(now - 31 * MIN),
        lead_in_at: iso(now - 30 * MIN),
        ends_at: iso(now - 10 * S),
        count_result: "booked",
      });
      break;
    case "expired":
      canMarkIntro = true;
      room = baseRoom(now, {
        state: "expired",
        version: 7,
        link_channels: ["whatsapp_text"],
        link_sent_at: iso(now - 11 * MIN),
        lead_by: iso(now - MIN),
        ended_at: iso(now - MIN),
        result: "no_join",
        created_at: iso(now - 12 * MIN),
      });
      break;
    case "failed":
      room = baseRoom(now, {
        ...ZOOM,
        state: "failed",
        version: 3,
        short_url: null,
        join_url: null,
        error: "your Zoom account was not found",
        result: "failed",
      });
      break;
    case "failed_handover":
      room = baseRoom(now, {
        ...ZOOM,
        purpose: "handover",
        handover_id: "live-1",
        call_kind: "demo",
        contact_first_name: "Mona",
        host_email: "omar@example.com",
        state: "failed",
        version: 3,
        short_url: null,
        join_url: null,
        error: "the host was not found",
        result: "failed",
      });
      break;
    case "booked": {
      // P4's booked demo, wrapped 15 minutes before the call.
      const start = now + 15 * MIN;
      room = sent(now, {
        ...ZOOM,
        purpose: "booked",
        call_kind: "demo",
        appointment_id: "appt-demo-1",
        starts_at: iso(start),
        host_email: "omar@example.com",
        host_by: iso(start + 15 * MIN),
        lead_by: iso(start + 20 * MIN),
        ends_at: iso(start + 45 * MIN),
      });
      break;
    }
    case "pending_zoom":
      room = baseRoom(now, {
        ...ZOOM,
        state: "failed",
        version: 3,
        short_url: null,
        join_url: null,
        error:
          "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
        result: "failed",
      });
      break;
  }
  return {
    feed: {
      room,
      events: roomEvents(now, room),
      health: healthFixture(now, down),
    },
    canMarkIntro,
  };
}

/** The closer's standby room on Zoom: open, or with the closer in it. */
export function standbyFixture(
  now: number,
  over: Partial<RoomView> = {},
): RoomView {
  return baseRoom(now, {
    ...ZOOM,
    id: "room-standby",
    code: "P4W8NC",
    contact_id: null,
    contact_first_name: null,
    purpose: "standby",
    call_kind: "demo",
    host_email: "omar@example.com",
    short_url: "https://call.maharamedia.com/P4W8NC",
    host_by: iso(now + 4 * MIN),
    ends_at: null,
    created_at: iso(now - MIN),
    ...over,
  });
}

export function presence(over: Partial<Presence> = {}): Presence {
  return {
    email: "omar@example.com",
    state: "away",
    until: null,
    room_id: null,
    zoom_status: "licensed",
    default_provider: "zoom",
    ...over,
  };
}

export function offerFixture(now: number, over: Partial<Offer> = {}): Offer {
  return {
    id: "live-1",
    version: 1,
    kind: "demo",
    contact_first_name: "Mona",
    company: "Harbi Interiors",
    country: "Saudi Arabia",
    reason: "on_call",
    note: "Runs 3 fit-out crews and wants more villa projects",
    offer_until: iso(now + 107 * S),
    ...over,
  };
}

/** live.status for an offer knob, with a room of the seat's own when asked. */
export function liveFixture(
  knob: OfferKnob,
  now: number = Date.now(),
  roomKnob: RoomKnob | null = null,
): { live: LiveStatus; flash: StripFlash | null } {
  const until = iso(now + 2 * 3600 * S - 23 * MIN);
  const inRoom = standbyFixture(now, {
    state: "host_in",
    version: 4,
    host_in_at: iso(now - 6 * MIN),
    created_at: iso(now - 7 * MIN),
  });
  let me = presence();
  let rooms: RoomView[] = [];
  let offers: Offer[] = [];
  let flash: StripFlash | null = null;
  let down = false;
  let standbyError: string | null = null;
  let liveOff = false;
  switch (knob) {
    case "away":
      break;
    case "available":
    case "standby":
      me = presence({ state: "available", until, room_id: "room-standby" });
      rooms = [standbyFixture(now)];
      break;
    case "down":
      down = true;
      me = presence({ state: "available", until });
      rooms = [
        standbyFixture(now, {
          state: "requested",
          version: 1,
          short_url: null,
          join_url: null,
        }),
      ];
      break;
    case "making":
      me = presence({ state: "available", until });
      rooms = [
        standbyFixture(now, {
          state: "creating",
          version: 2,
          short_url: null,
          join_url: null,
        }),
      ];
      break;
    case "standby_failed":
      me = presence({ state: "available", until });
      standbyError = "your Zoom account was not found";
      break;
    case "live_off":
      liveOff = true;
      break;
    case "ready":
      me = presence({ state: "ready", until, room_id: inRoom.id });
      rooms = [inRoom];
      break;
    case "incoming":
      me = presence({ state: "ready", until, room_id: inRoom.id });
      rooms = [inRoom];
      offers = [offerFixture(now)];
      break;
    case "taken":
      me = presence({ state: "ready", until, room_id: inRoom.id });
      rooms = [inRoom];
      flash = { kind: "taken", at: now - 2 * S };
      break;
    case "lost":
      me = presence({ state: "ready", until, room_id: inRoom.id });
      rooms = [inRoom];
      flash = { kind: "lost", at: now - 2 * S, by: "Omar", text: null };
      break;
    case "missed":
    case "expired":
      flash = {
        kind: "missed",
        at: now - 2 * MIN,
        missedAt: iso(now - 2 * MIN),
      };
      break;
    case "refresh": {
      const long = standbyFixture(now, {
        state: "host_in",
        version: 9,
        host_in_at: iso(now - 31 * MIN),
        created_at: iso(now - 32 * MIN),
      });
      me = presence({ state: "ready", until, room_id: long.id });
      rooms = [long];
      break;
    }
    case "booked":
      me = presence({
        reason: "booked_call_soon",
        booked_at: iso(now + 38 * MIN),
        booked_kind: "demo",
      });
      break;
    case "on_call":
      me = presence({ state: "on_call" });
      break;
  }
  if (roomKnob) {
    const own = roomFixture(roomKnob, now).feed.room;
    if (!["ended", "expired", "failed", "cancelled"].includes(own.state))
      rooms = [own, ...rooms];
  }
  const live: LiveStatus = {
    me,
    rooms,
    offers,
    health: healthFixture(now, down),
  };
  if (standbyError) live.standby_error = standbyError;
  if (liveOff) live.live_enabled = false;
  return { live, flash };
}

/** P3's reply alert, three minutes old, with a closer free. */
export function replyFixture(now: number = Date.now()): ReplyAlert {
  return {
    contact_id: "lead-4",
    name: "Mona",
    at: iso(now - 3 * MIN),
    closer_free: true,
  };
}

/**
 * The harness's answer to a room or live action, or null when the action
 * is not one of these. Stateless: each answer comes from the knobs, with
 * the obvious change for a press (a mark moves the state, an end ends it),
 * so every screen can be walked without a server.
 */
export function answerRoomsAction(
  action: string,
  body: Record<string, unknown>,
  knobs: { room?: RoomKnob | null; offer?: OfferKnob | null },
  now: number = Date.now(),
): Record<string, unknown> | null {
  const room = roomFixture(knobs.room ?? "making", now).feed;
  const bump = (over: Partial<RoomView>) => ({
    ok: true,
    room: { ...room.room, version: room.room.version + 1, ...over },
  });
  switch (action) {
    case "room.create":
    case "room.wrap":
      return { ok: true, room: room.room };
    case "room.status":
      return { ok: true, ...room };
    case "room.open":
      return {
        ok: true,
        start_url:
          typeof location === "undefined"
            ? "about:blank"
            : `${location.origin}${location.pathname}#host-room`,
      };
    case "room.mark": {
      const what = String(body.what ?? "");
      if (what === "host_in")
        return bump({ state: "host_in", host_in_at: iso(now) });
      if (what === "lead_in")
        return bump({ state: "lead_in", lead_in_at: iso(now) });
      if (what === "not_lead")
        return bump({
          state: "host_in",
          lead_in_at: null,
          count_result: "undone",
        });
      return { ok: false, error: "That mark is not known." };
    }
    case "room.end": {
      const reason = String(body.reason ?? "end");
      const ended = bump({
        state:
          reason === "cancel" ||
          reason === "on_phone" ||
          reason === "admit_blocked"
            ? "cancelled"
            : "ended",
        ended_at: iso(now),
        result:
          reason === "on_phone"
            ? "moved_to_phone"
            : reason === "admit_blocked"
              ? "admit_blocked"
              : null,
      });
      // "I can't let them in": sales-api makes the Zoom room that replaces it.
      if (reason === "admit_blocked")
        return {
          ...ended,
          replacement: {
            ...room.room,
            provider: "zoom",
            id: "room-z9r3tq",
            code: "Z9R3TQ",
            short_url: null,
            join_url: null,
            state: "creating",
            version: 1,
            link_channels: [],
            link_sent_at: null,
            created_at: iso(now),
          },
        };
      return ended;
    }
    case "room.send":
      return bump({
        link_channels: [...room.room.link_channels, "email"],
        link_sent_at: room.room.link_sent_at ?? iso(now),
      });
    case "live.status":
      return {
        ok: true,
        ...liveFixture(knobs.offer ?? "away", now, knobs.room ?? null).live,
      };
    case "live.availability": {
      const state = body.state === "available" ? "available" : "away";
      return {
        ok: true,
        me: presence({
          state,
          until: state === "available" ? iso(now + 2 * 3600 * S) : null,
        }),
      };
    }
    case "live.take":
    case "live.decline":
      return { ok: true };
    default:
      return null;
  }
}
