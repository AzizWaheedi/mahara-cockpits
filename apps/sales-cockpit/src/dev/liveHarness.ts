/**
 * The harness's stand-in for sales-api's room, live and wave actions, with
 * state between presses, so every screen of live calls can be walked
 * without a server: a room asked for is made after 3 s and its link "goes",
 * a mark moves it, an end ends it, and "I can't let them in" swaps it for a
 * Zoom room. Knobs, set in the address (src/dev/harness.tsx):
 *
 *   room    a roomFixtures state to start on, for the lead on screen
 *           (making | ready | sent | not_sent | ... | booked); none by default
 *   offer   the seat's presence and offers (incoming | away | ready | ...)
 *   rooms   on | test | off        the `rooms` switch (on by default here)
 *   live    on | off               live handover (off by default, as it ships)
 *   auto    1                      automatic mode after a missed call
 *   create  ok | refused | failed  what room.create does
 *   waves   running | paused | none | off   the Follow-ups page's waves
 *   reply   1                      P3's reply alert in the banner
 *   handover 1                     a stand-in for P2's handover strip
 *
 * And the failures every screen must survive (src/dev/harness.tsx):
 *   net     down | drop            sales-api unreachable (drop: after 6 s)
 *   answer  garbage                sales-api answers 200 with nonsense
 *   auth    expired | 401          no session, or sales-api says sign in
 *   reads   fail | hang            every table read fails, or never answers
 *
 * Nothing here is a real lead or a real room.
 */
import type { RoomView } from "../lib/rooms";
import {
  healthFixture,
  isOfferKnob,
  isRoomKnob,
  liveFixture,
  type OfferKnob,
  presence,
  type RoomKnob,
  roomEvents,
  roomFixture,
} from "./roomFixtures";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

export interface LiveKnobs {
  room: RoomKnob | null;
  offer: OfferKnob | null;
  rooms: "on" | "test" | "off";
  live: "on" | "off";
  auto: boolean;
  create: "ok" | "refused" | "failed";
  waves: "running" | "paused" | "none" | "off";
  reply: boolean;
  handover: boolean;
  net: "ok" | "down" | "drop";
  answer: "ok" | "garbage";
  auth: "ok" | "expired" | "401";
  reads: "ok" | "fail" | "hang";
}

/** The knobs from the address, with the harness's defaults. */
export function liveKnobs(params: URLSearchParams): LiveKnobs {
  const pick = <T extends string>(k: string, list: readonly T[], d: T): T => {
    const v = params.get(k);
    return v !== null && (list as readonly string[]).includes(v) ? (v as T) : d;
  };
  const room = params.get("room");
  const offer = params.get("offer");
  return {
    room: isRoomKnob(room) ? room : null,
    offer: isOfferKnob(offer) ? offer : null,
    rooms: pick("rooms", ["on", "test", "off"] as const, "on"),
    live: pick("live", ["on", "off"] as const, "off"),
    auto: params.get("auto") === "1",
    create: pick("create", ["ok", "refused", "failed"] as const, "ok"),
    waves: pick(
      "waves",
      ["running", "paused", "none", "off"] as const,
      "running",
    ),
    reply: params.get("reply") === "1",
    handover: params.get("handover") === "1",
    net: pick("net", ["ok", "down", "drop"] as const, "ok"),
    answer: pick("answer", ["ok", "garbage"] as const, "ok"),
    auth: pick("auth", ["ok", "expired", "401"] as const, "ok"),
    reads: pick("reads", ["ok", "fail", "hang"] as const, "ok"),
  };
}

/** The settings rows the screens read for live calls and waves. */
export function liveSettings(k: LiveKnobs, testContact: string): Row[] {
  return [
    {
      key: "rooms",
      value: {
        enabled: k.rooms !== "off",
        test_only: k.rooms === "test",
        test_contacts: [testContact],
        providers: { meet: true, zoom: true },
        default_provider: { setter: "meet", closer: "zoom" },
        send: { whatsapp_text: true, whatsapp_template: false, email: true },
        short_link: true,
        template_route: "call_link",
        fallback: {
          scope: "any",
          auto_on_miss: k.auto,
          pilot_emails: [],
        },
      },
    },
    { key: "live", value: { enabled: k.live === "on" } },
    {
      key: "whatsapp_guard",
      value: {
        templates_per_day: 250,
        pause_fail_share: 0.3,
        pause_min_sends: 10,
        connector_off: true,
        single_copy_ok_at: iso(Date.now() - 86_400_000),
      },
    },
    {
      key: "followups",
      value: {
        enabled: k.waves !== "off",
        autosend: {},
        per_run: 10,
        per_day: 60,
        quiet: { from: 21, to: 9 },
        nurture_every_days: 14,
        first_hours: [9, 18],
        waves: { per_day: 40, holdout_share: 0.1, batch_gap_s: 45 },
      },
    },
  ];
}

export class Refused extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status = 409, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * One seat's rooms as sales-api would keep them, for the harness. Rooms the
 * knob seeds stay as they are; a room asked for here is made after 3 s,
 * and its link goes at once (WhatsApp), as the worker and the message
 * service would.
 */
export class RoomStage {
  rooms: RoomView[] = [];
  /**
   * The room the knob put on screen. live.status lists it even once it is
   * final (sales-api lists only rooms that are not), so a closed state such
   * as expired or failed can be opened from the address; rooms made by a
   * press follow sales-api's rule.
   */
  private seeded: string | null = null;
  /** When each room asked for here is made. */
  private readyAt = new Map<string, number>();
  private seq = 0;
  /** The seat's presence after a press, kept over the knob's (as sales-api would). */
  private pressed: ReturnType<typeof presence> | null = null;

  constructor(
    private k: LiveKnobs,
    now: number,
    /** The lead the knob's room is for (the one on screen). */
    contactId: string | null,
  ) {
    if (k.room) {
      const room = roomFixture(k.room, now).feed.room;
      // A standby or handover room keeps its own lead; a fallback room is
      // put on the lead the page shows.
      if (contactId && room.purpose !== "handover") room.contact_id = contactId;
      this.rooms.push(room);
      this.seeded = room.id;
    }
  }

  private tick(now: number) {
    for (const r of this.rooms) {
      const at = this.readyAt.get(r.id);
      if (at === undefined || now < at || r.state !== "creating") continue;
      this.readyAt.delete(r.id);
      if (this.k.create === "failed") {
        Object.assign(r, {
          state: "failed",
          version: r.version + 1,
          error:
            r.provider === "zoom"
              ? "your Zoom account was not found"
              : "Google did not make the Meet link. Try Zoom.",
          result: "failed",
          ended_at: iso(now),
        });
        continue;
      }
      const code = r.code;
      Object.assign(r, {
        state: "open",
        version: r.version + 1,
        short_url: `https://call.maharamedia.com/${code}`,
        join_url:
          r.provider === "zoom"
            ? "https://us06web.zoom.us/j/81234567890"
            : "https://meet.google.com/abc-defg-hij",
        link_channels: ["whatsapp_text"],
        link_sent_at: iso(now),
        lead_by: iso(now + 600 * S),
        host_by: iso(now + 15 * MIN),
        ends_at: iso(now + 30 * MIN),
      });
    }
  }

  private find(id: unknown): RoomView {
    const r = this.rooms.find(x => x.id === id);
    if (!r) throw new Refused("That room is not there any more.", 404);
    return r;
  }

  private newRoom(b: Row, now: number, over: Partial<RoomView> = {}) {
    this.seq += 1;
    const code = `H${String(this.seq).padStart(2, "0")}Q2M`.slice(0, 6);
    const base = roomFixture("making", now).feed.room;
    const room: RoomView = {
      ...base,
      id: `room-h${this.seq}`,
      code,
      contact_id: (b.contact_id as string) ?? null,
      provider: b.provider === "zoom" ? "zoom" : "meet",
      purpose: (b.purpose as RoomView["purpose"]) ?? "manual",
      call_kind: b.call_kind === "demo" ? "demo" : "intro",
      trigger: (b.trigger as string) ?? null,
      attempt_id: (b.attempt_id as string) ?? null,
      appointment_id: (b.appointment_id as string) ?? null,
      created_at: iso(now),
      version: 1,
      ...over,
    };
    this.rooms.unshift(room);
    this.readyAt.set(room.id, now + 3 * S);
    return room;
  }

  /** sales-api's answer to a room or live action, or null when it is not one. */
  answer(action: string, b: Row, now: number): Row | null {
    this.tick(now);
    switch (action) {
      case "room.create": {
        if (this.k.create === "refused")
          throw new Refused(
            "You already have a room open. End it first.",
            409,
            "host_has_room",
          );
        const open = this.rooms.find(
          r =>
            r.contact_id === b.contact_id &&
            !["ended", "expired", "failed", "cancelled"].includes(r.state),
        );
        if (open)
          throw new Refused(
            "A video room is already open for this lead. Use that one.",
            409,
            "lead_has_room",
          );
        return { room: { ...this.newRoom(b, now) } };
      }
      case "room.status": {
        const r = this.find(b.room_id);
        return {
          room: { ...r },
          events: roomEvents(now, r),
          health: healthFixture(now, this.k.room === "down"),
          now: iso(now),
        };
      }
      case "room.open":
        return {
          start_url:
            typeof location === "undefined"
              ? "about:blank"
              : `${location.origin}${location.pathname}#host-room`,
        };
      case "room.mark": {
        const r = this.find(b.room_id);
        if (typeof b.version === "number" && b.version !== r.version)
          throw new Refused("This changed a moment ago.", 409, "stale");
        const what = String(b.what ?? "");
        if (what === "host_in")
          Object.assign(r, { state: "host_in", host_in_at: iso(now) });
        else if (what === "lead_in")
          // rooms.count_on_join is off here, as shipped and as this stage's
          // own settings say (liveSettings): a join books nothing, so the
          // panel never shows a booking the real system does not make
          // (stress2 round 6).
          Object.assign(r, {
            state: "lead_in",
            lead_in_at: iso(now),
            count_result: null,
          });
        else if (what === "not_lead")
          Object.assign(r, {
            state: "host_in",
            lead_in_at: null,
            count_result: "undone",
          });
        else if (what === "still_on")
          // "Still on it": the room's end moves ten minutes on.
          Object.assign(r, { ends_at: iso(now + 10 * MIN) });
        else throw new Refused("That mark is not known.", 400, "bad_input");
        r.version += 1;
        return { room: { ...r } };
      }
      case "room.end": {
        const r = this.find(b.room_id);
        if (typeof b.version === "number" && b.version !== r.version)
          throw new Refused("This changed a moment ago.", 409, "stale");
        const reason = String(b.reason ?? "end");
        if (r.state === "lead_in" && reason !== "finished" && !b.confirm)
          throw new Refused(
            "The lead is still in this room. End it anyway?",
            409,
            "confirm_end",
          );
        Object.assign(r, {
          state: ["cancel", "on_phone", "admit_blocked"].includes(reason)
            ? "cancelled"
            : "ended",
          ended_at: iso(now),
          result:
            reason === "on_phone"
              ? "moved_to_phone"
              : reason === "admit_blocked"
                ? "admit_blocked"
                : r.lead_in_at
                  ? "joined"
                  : "no_join",
          version: r.version + 1,
        });
        const out: Row = { room: { ...r } };
        if (reason === "admit_blocked")
          out.replacement = {
            ...this.newRoom(
              { ...r, provider: "zoom", contact_id: r.contact_id },
              now,
            ),
          };
        return out;
      }
      case "room.send": {
        const r = this.find(b.room_id);
        if (!r.link_channels.includes("email"))
          r.link_channels = [...r.link_channels, "email"];
        r.link_sent_at ??= iso(now);
        r.version += 1;
        return { room: { ...r } };
      }
      case "live.status": {
        if (this.k.rooms === "off" && this.k.live === "off")
          throw new Refused(
            "Video rooms are off for now. Call or message the lead instead.",
            409,
            "disabled",
          );
        const base = liveFixture(this.k.offer ?? "away", now, null).live;
        const mine = this.rooms.filter(
          r =>
            r.id === this.seeded ||
            !["ended", "expired", "failed", "cancelled"].includes(r.state),
        );
        const me = this.pressed ?? base.me;
        return {
          ...base,
          // room=down is the worker down: live.status says so too.
          health:
            this.k.room === "down" ? healthFixture(now, true) : base.health,
          // The harness's seat is a setter's: Meet first, unless the offer
          // knob shows a closer's strip (standby rooms on Zoom).
          me: this.k.offer ? me : { ...me, default_provider: "meet" },
          rooms: [...mine.map(r => ({ ...r })), ...base.rooms],
          live_enabled: this.k.live === "on",
          now: iso(now),
        };
      }
      case "live.availability": {
        const state = b.state === "available" ? "available" : "away";
        this.pressed = presence({
          state,
          until: state === "available" ? iso(now + 2 * 3600 * S) : null,
        });
        return { me: this.pressed };
      }
      case "live.take":
      case "live.decline":
        return {};
      case "live.ask":
        if (this.k.live !== "on")
          throw new Refused(
            "Live handover is not switched on yet.",
            409,
            "disabled",
          );
        return { live: { id: "live-h1", state: "offered" } };
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Waves: two waves, their members, and today's batch of openers
// ---------------------------------------------------------------------------

/** The waves tables and today's openers for the `waves` knob. */
export function waveTables(
  knob: LiveKnobs["waves"],
  now: number,
  leads: readonly { contact_id: string }[],
): {
  waves: Row[];
  members: Row[];
  meta: Row[];
  openers: Row[];
} {
  if (knob === "none") return { waves: [], members: [], meta: [], openers: [] };
  const running = {
    id: "wave-1",
    pool: "no_show_cancelled",
    segment: "reactivate",
    per_day: 40,
    holdout_share: 0.1,
    state: knob === "paused" ? "paused" : "running",
    made_by: "aziz@maharamedia.com",
    created_at: iso(now - 3 * 86_400_000),
    started_at: iso(now - 3 * 86_400_000),
    enrolled_at: iso(now - 3 * 86_400_000 + 5 * MIN),
    ended_at: null,
    done_reason: null,
  };
  const ended = {
    id: "wave-0",
    pool: "never_booked",
    segment: "reactivate",
    per_day: 40,
    holdout_share: 0.1,
    state: "done",
    made_by: "aziz@maharamedia.com",
    created_at: iso(now - 20 * 86_400_000),
    started_at: iso(now - 20 * 86_400_000),
    enrolled_at: iso(now - 20 * 86_400_000),
    ended_at: iso(now - 6 * 86_400_000),
    done_reason: "Stopped by a manager.",
  };
  const members: Row[] = [];
  const add = (wave: string, n: number, arm: string, state: string) => {
    for (let i = 0; i < n; i++)
      members.push({
        wave_id: wave,
        contact_id: `${wave}-${arm}-${state}-${i}`,
        arm,
        state,
      });
  };
  add("wave-1", 52, "wave", "sent");
  add("wave-1", 9, "wave", "replied");
  add("wave-1", 4, "wave", "booked");
  add("wave-1", 6, "wave", "drafted");
  add("wave-1", 330, "wave", "waiting");
  add("wave-1", 11, "wave", "excluded");
  add("wave-1", 44, "holdout", "held_out");
  add("wave-1", 1, "holdout", "booked");
  add("wave-0", 120, "wave", "closed");
  add("wave-0", 7, "wave", "booked");
  add("wave-0", 14, "holdout", "closed");
  add("wave-0", 0, "holdout", "booked");
  // Today's batch: six openers for leads the harness has, one held, one
  // set aside by the desk after a refusal.
  const openers: Row[] = [];
  const meta: Row[] = [];
  leads.slice(8, 14).forEach((l, i) => {
    const id = `fu-open-${i + 1}`;
    openers.push({
      id,
      contact_id: l.contact_id,
      owner_email: null,
      segment: "reactivate",
      channel: "whatsapp_template",
      template_key: i % 2 ? "opener_en" : "opener_ar",
      touch: 1,
      heat: 0,
      appointment_id: null,
      subject: null,
      body:
        i % 2
          ? "Hi there, it's Sara from Mahara Media. How are you?"
          : "السلام عليكم، معاك سارة. كيف حالك؟",
      why: "Backlog wave, no-shows and cancellations: the CEO's opener, no AI text.",
      context: { wave_id: "wave-1" },
      model: null,
      status: "draft",
      created_at: iso(now - (60 - i) * MIN),
      expires_at: iso(now + 40 * 3_600_000),
      decided_by: null,
      decided_at: null,
      final_body: null,
      edited: null,
      skip_reason: null,
      error: null,
      auto: false,
      replied_at: null,
    });
    meta.push({
      followup_id: id,
      wave_id: "wave-1",
      kind_key: "reactivate",
      send_after: null,
      held_by: i === 4 ? "aziz@maharamedia.com" : i === 5 ? "sales-desk" : null,
      hold_reason:
        i === 5 ? "Do not disturb is on for WhatsApp in HighLevel." : null,
    });
  });
  return {
    waves: knob === "off" ? [running] : [running, ended],
    members,
    meta,
    openers,
  };
}

/** followup.wave, followup.batch and followup.hold, as the harness keeps them. */
export function answerWaves(
  action: string,
  b: Row,
  t: ReturnType<typeof waveTables>,
  now: number,
): Row | null {
  switch (action) {
    case "followup.wave": {
      const op = String(b.op ?? "");
      if (op === "start") {
        if (
          t.waves.some(
            w =>
              w.pool === b.pool &&
              ["running", "paused"].includes(String(w.state)),
          )
        )
          throw new Refused("A wave is already running on that pool.", 409);
        t.waves.unshift({
          id: `wave-${t.waves.length + 2}`,
          pool: b.pool,
          segment: "reactivate",
          per_day: Number(b.per_day ?? 40),
          holdout_share: 0.1,
          state: "running",
          made_by: "aziz@maharamedia.com",
          created_at: iso(now),
          started_at: iso(now),
          enrolled_at: null,
          ended_at: null,
          done_reason: null,
        });
        return { ok: true };
      }
      const w = t.waves.find(x => x.id === b.wave_id);
      if (!w) throw new Refused("That wave is not there any more.", 404);
      if (op === "pause") w.state = "paused";
      else if (op === "resume") w.state = "running";
      else if (op === "stop")
        Object.assign(w, {
          state: "done",
          ended_at: iso(now),
          done_reason: "Stopped by a manager.",
        });
      return { wave: w };
    }
    case "followup.batch": {
      const ids = Array.isArray(b.ids) ? (b.ids as string[]) : [];
      if (ids.length > 40)
        throw new Refused("Approve at most 40 at a time.", 400);
      let n = 0;
      for (const id of ids) {
        const m = t.meta.find(x => x.followup_id === id);
        if (!m || m.send_after || m.held_by) continue;
        m.send_after = iso(now + n * 45 * S);
        m.approved_by = "aziz@maharamedia.com";
        n += 1;
      }
      return {
        count: n,
        first_at: iso(now),
        last_at: iso(now + Math.max(0, n - 1) * 45 * S),
      };
    }
    case "followup.hold": {
      const m = t.meta.find(x => x.followup_id === b.id);
      if (!m) throw new Refused("That opener is not there any more.", 404);
      if (b.on) {
        m.held_by = "aziz@maharamedia.com";
      } else {
        m.held_by = null;
        m.hold_reason = null;
      }
      return { ok: true };
    }
    default:
      return null;
  }
}

/** The seat's Zoom and Meet rows for the Team page. */
export function hostRows(now: number, emails: readonly string[]): Row[] {
  return emails.map((email, i) => ({
    email,
    zoom_status: ["licensed", "pending", "basic", null][i % 4],
    zoom_live_until: i === 0 ? iso(now + 20 * MIN) : null,
    google_ok: i % 3 !== 2,
    default_provider: i % 2 ? "zoom" : "meet",
    checked_at: i === 3 ? null : iso(now - 4 * MIN),
  }));
}

/** Status rows for the room jobs, so the Team page has something to say. */
export function roomStatusRows(now: number): Row[] {
  return [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      detail: "Watched rooms for 57 s; 0 to make.",
      at: iso(now - 20 * S),
    },
    {
      worker: "sales-desk",
      job: "room-hosts",
      ok: true,
      detail: "Checked 3 hosts.",
      at: iso(now - 4 * MIN),
    },
    {
      worker: "sales-live",
      job: "go",
      ok: true,
      detail: "Redirected K7Q2MX.",
      at: iso(now - 9 * MIN),
    },
    {
      worker: "sales-live",
      job: "zoom",
      ok: false,
      detail: "The webhook secret is not set, so Zoom's events are refused",
      at: iso(now - 30 * MIN),
    },
  ];
}
