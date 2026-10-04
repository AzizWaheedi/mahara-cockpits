// bun test supabase/functions/sales-api/stress2_numbers_count.test.ts
//
// Second series, round 1, numbers and data integrity: the live count's mark
// of a booked intro (rooms.ts countMark) and its undo (undoPlan "unmark"),
// read against what HighLevel holds afterwards. B2B's show rate reads
// HighLevel's appointmentStatus (showed, or confirmed once past, is shown;
// new and noshow are not), never the cockpit's dispositions. So the number
// a count changes is the one in HighLevel, and that is what these tests read.
//
// HighLevel here is stateful: a PUT of appointmentStatus changes what the
// next GET answers. markAppointment is faked as index.ts writes it: the
// cockpit's disposition first, then HighLevel; its crm is "failed" when
// HighLevel refused (writeMarkToCrm catches the error and records it).
//
// A test that fails here is a finding. Everything runs on testfakes.ts: no
// HighLevel, no database, no Zoom.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import { refuseMark, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2n-000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const manager: Who = { signed_in: true, seat: true, manager: true, email: "manager@stress.invalid", name: "Mona Manager", role: "manager" };
const HOUR = 60 * MIN;

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup() {
  const w = fakeWorld();
  const audits: Row[] = [];
  /** HighLevel's own status per appointment: what B2B's show rate reads. */
  const hl = new Map<string, string>();
  const knobs = {
    crmFails: false,
    upcomingFails: 0,
    /** The lead's calls on HighLevel, as index.ts upcoming() reads them. */
    calls: [] as { id: string; start: number; booked_at: number; assigned_user_id: string }[],
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const a = w.db.t("cockpit_sales_appointments").find(x => x.appointment_id === id);
      if (m === "GET")
        return a
          ? { appointment: { id, appointmentStatus: hl.get(id) ?? a.status, startTime: a.start_at, endTime: a.end_at, assignedUserId: a.assigned_user_id } }
          : (null as unknown as Row);
      if (m === "PUT") {
        const st = (body as Row | undefined)?.appointmentStatus;
        if (typeof st === "string") hl.set(id, st);
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-${fakeUuid()}` };
    if (m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  /** index.ts markAppointment, as it writes: the disposition, then HighLevel (crm failed when refused). */
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
    // index.ts markAppointment's own refusal first (lib.ts refuseMark; anyRep marks with a manager's rights).
    const appt = w.db.t("cockpit_sales_appointments").find(a => a.appointment_id === id);
    if (appt) {
      const no = refuseMark(opts.anyRep ? { ...who, manager: true } : who, appt as never, status, w.clock.now);
      if (no) throw new ApiRefusal(no, 403);
    }
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
    if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
    if (current) current.superseded_at = w.db.iso();
    const made: Row = {
      id: fakeUuid(),
      appointment_id: id,
      status,
      marked_by: who.email,
      note: (opts.note as string | undefined) ?? null,
      superseded_at: null,
      marked_at: w.db.iso(),
      crm: "pending",
    };
    w.db.t("cockpit_sales_dispositions").push(made);
    if (knobs.crmFails) made.crm = "failed";
    else {
      hl.set(id, status);
      made.crm = opts.quiet ? "quiet" : "written";
    }
    return { ...made };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts as Row),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    // index.ts upcoming(): the lead's next call of the kind whose start is
    // after now (Date.now(), whenever the count runs), booked before the bound.
    upcoming: async (_c, _kind, opts) => {
      if (knobs.upcomingFails > 0) {
        knobs.upcomingFails -= 1;
        throw new Error("HighLevel said 503");
      }
      // Fixed in fix round 1: index.ts upcoming() keeps calls ahead of the
      // reference time it is given (the join), else of now.
      const bound = opts?.booked_before ?? null;
      const after = opts?.after ?? w.clock.now;
      const ahead = knobs.calls
        .filter(c => c.start > after && (bound === null || c.booked_at < bound))
        .sort((a, b) => a.start - b.start)[0];
      return ahead
        ? { id: ahead.id, start: ahead.start, end: ahead.start + 30 * MIN, assigned_user_id: ahead.assigned_user_id, status: "confirmed", booked_at: ahead.booked_at }
        : null;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  function intro(status: string, startMs: number) {
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-1",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(startMs + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    hl.set("intro-1", status);
  }

  /** The setter's fallback room for the booked intro (the dialer's), opened by the worker, the link opened, Zoom seeing the lead. */
  async function fallbackRoom(
    ask: Row = { purpose: "fallback", trigger: "no_answer", appointment_id: "intro-1" },
    o: { evidence?: boolean } = {},
  ): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      ...ask,
    });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room(id).version) + 1 },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    if (o.evidence !== false) seedLeadZoomJoin(w.db, id);
    return id;
  }
  async function press(id: string, what: "lead_in" | "not_lead" | "host_in") {
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what });
    await w.flush();
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await w.flush();
  }
  /** The lead page's room (LeadPage: purpose manual, never an appointment id). */
  const leadPageRoom = (o: { evidence?: boolean } = {}) => fallbackRoom({ purpose: "manual" }, o);
  const alerts = () => w.db.t("cockpit_sales_alerts");
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, hl, knobs, room, intro, fallbackRoom, leadPageRoom, press, tick, alerts, posts, markAppointment };
}

describe("the count's mark of a booked intro, read in HighLevel", () => {
  test("count-mark-crm-failed-silent: the rep marked the intro a no-show at +10 (the lead was late); the lead joins the fallback room at +12; HighLevel refuses the count's showed write: a person must be told, never 'marked shown' in silence", async () => {
    const w = setup();
    const start = w.clock.now - 12 * MIN;
    w.intro("confirmed", start);
    // +10: the setter gave up on the call and marked it a no-show (HighLevel took it).
    await w.markAppointment(setter, "intro-1", "noshow", { note: "No answer." });
    expect(w.hl.get("intro-1")).toBe("noshow");
    // +11: a last try by video. +12: the lead is in (Zoom saw them).
    const id = await w.fallbackRoom();
    expect(w.room(id).appointment_id).toBe("intro-1");
    w.knobs.crmFails = true; // HighLevel answers 429 for the next minute
    await w.press(id, "lead_in");
    await w.tick([id]);
    // What the count left: the cockpit's own copy says shown (the count's
    // disposition is the active one, its crm "failed")...
    const active = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === "intro-1" && !d.superseded_at) as Row;
    expect(active.status).toBe("showed");
    // ...while HighLevel, which B2B's show rate reads, still says no-show.
    expect(w.hl.get("intro-1")).toBe("noshow");
    // The lead came and is counted a no-show in the show rate. The count must
    // either say it could not mark the call (count_result failed) or tell a
    // person which call to mark, as markShowed does for a live booking
    // (room.count.showed_failed and the room's showed_failed alert).
    const told =
      w.room(id).count_result === "failed" ||
      w.audits.some(a => a.action === "room.count.showed_failed" && a.entityId === id) ||
      w.alerts().some(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`) && !a.resolved_at);
    expect(told).toBe(true);
  });

  test("control: HighLevel takes the count's showed write: shown in HighLevel, nobody told", async () => {
    const w = setup();
    const start = w.clock.now - 12 * MIN;
    w.intro("confirmed", start);
    await w.markAppointment(setter, "intro-1", "noshow", { note: "No answer." });
    const id = await w.fallbackRoom();
    await w.press(id, "lead_in");
    await w.tick([id]);
    expect(w.hl.get("intro-1")).toBe("showed");
    expect(w.room(id).count_appointment_id).toBe("intro-1");
  });
});

describe("the undo of a count's mark, read in HighLevel", () => {
  test("undo-overwrites-later-rep-mark: the count marked the intro shown; the setter then marks it a no-show in the dialer (it was a colleague, not the lead) and presses 'That was not the lead': HighLevel must keep the setter's no-show", async () => {
    const w = setup();
    const start = w.clock.now - 3 * MIN;
    w.intro("confirmed", start);
    const id = await w.fallbackRoom();
    // +3: someone the setter did not know joined; the setter pressed The lead is in.
    await w.press(id, "lead_in");
    expect(w.hl.get("intro-1")).toBe("showed");
    expect(w.room(id).count_appointment_id).toBe("intro-1");
    // +4: the setter sees the intro marked shown in the dialer and marks it a
    // no-show there (index.ts mark: supersedes the count's mark, writes HighLevel).
    w.clock.now += 1 * MIN;
    await w.markAppointment(setter, "intro-1", "noshow", { note: "It was a colleague." });
    expect(w.hl.get("intro-1")).toBe("noshow");
    // +5: and presses That was not the lead too (inside its 300 s).
    w.clock.now += 1 * MIN;
    await w.press(id, "not_lead");
    await w.tick([id]);
    const active = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === "intro-1" && !d.superseded_at) as Row;
    // The cockpit keeps the setter's no-show...
    expect(active.status).toBe("noshow");
    // ...and HighLevel, which B2B reads, must too. The undo writes back the
    // status the count found ("confirmed": a show once past, by the B2B rule)
    // over the setter's later mark, and the settle never repairs it (the
    // call is marked, so it is left alone).
    expect(w.hl.get("intro-1")).toBe("noshow");
  });
});

describe("one late join, one number, whichever button sent the link", () => {
  test("control (the dialer's room): the setter marked the intro a no-show at +10; the lead joins the dialer's fallback room at +15: the intro is shown, nothing else is booked", async () => {
    const w = setup();
    const start = w.clock.now - 15 * MIN;
    w.intro("confirmed", start);
    await w.markAppointment(setter, "intro-1", "noshow", { note: "No answer." });
    w.db.t("cockpit_sales_appointments")[0]!.status = "noshow"; // the mirror caught up
    const id = await w.fallbackRoom();
    await w.press(id, "lead_in");
    await w.tick([id]);
    expect(w.hl.get("intro-1")).toBe("showed");
    expect(w.posts()).toHaveLength(0);
  });

  test("late-join-lead-page-books-beside-noshow-intro: the same late join through the lead page's Video call (no appointment id) leaves the intro a no-show in HighLevel and books a separate Live call", async () => {
    const w = setup();
    const start = w.clock.now - 15 * MIN;
    w.intro("confirmed", start);
    await w.markAppointment(setter, "intro-1", "noshow", { note: "No answer." });
    w.db.t("cockpit_sales_appointments")[0]!.status = "noshow"; // the mirror caught up
    // +15: the lead writes "sorry, can we do it now?"; the setter sends the
    // link from the lead page. The lead joins inside the intro's own slot.
    const id = await w.leadPageRoom();
    expect(w.room(id).appointment_id ?? null).toBeNull();
    await w.press(id, "lead_in");
    await w.tick([id]);
    // currentCall leaves out a call marked noshow, so the join is "no call":
    // a Live booking is made and marked shown, and the intro the lead came to
    // stays a no-show in B2B's show rate. The dialer's room for the same
    // minute marks the intro shown instead (the control above).
    expect({ intro: w.hl.get("intro-1"), live_bookings: w.posts().length }).toEqual({ intro: "showed", live_bookings: 0 });
  });
});

describe("a lead who joins the intro's room early", () => {
  test("early-join-mark-refused-silent: the setter's confirmation call 40 minutes before the intro is missed, the video link goes, and the lead joins at once: the intro (still new) is neither counted nor sent to a person", async () => {
    const w = setup();
    const start = w.clock.now + 40 * MIN;
    // The intro is unconfirmed (status new): not a show for B2B even once past.
    w.intro("new", start);
    // Since stress2 round 2 a room asked for 40 minutes before the intro is
    // not the intro's room (its window opens five minutes before the start,
    // as the dialer's intro item does): the join is any join of the lead.
    const id = await w.fallbackRoom();
    expect(w.room(id).appointment_id ?? null).toBeNull();
    // The intro is the lead's call ahead in HighLevel (index.ts upcoming()).
    w.knobs.calls.push({ id: "intro-1", start, booked_at: start - 3 * 24 * HOUR, assigned_user_id: "G-setter" });
    await w.press(id, "lead_in");
    await w.tick([id]);
    // countLive plans "mark" (the join is inside the intro's window, from an
    // hour before), and markAppointment refuses a showed mark more than ten
    // minutes before the start (lib.ts refuseMark): count_result failed, no
    // alert, no move. The lead had the conversation; the intro stays "new"
    // at its time (no settle: the lead joined), so B2B never counts it shown.
    const counted = w.hl.get("intro-1") === "showed";
    const told = w.alerts().some(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`) && !a.resolved_at);
    expect({ result: w.room(id).count_result ?? null, counted_or_told: counted || told }).toEqual({
      result: w.room(id).count_result ?? null,
      counted_or_told: true,
    });
  });
});

describe("the count's alerts after it counts", () => {
  test("count-unread-alert-left-open-after-mark: HighLevel's calls cannot be read for three minutes after the join, then the count marks the running intro shown: the 'nothing was counted yet' alert must be answered", async () => {
    const w = setup();
    // The intro started five minutes ago (confirmed, the setter's own). The
    // setter sends the link from the lead page; the lead joins at once.
    w.intro("confirmed", w.clock.now - 5 * MIN);
    w.knobs.upcomingFails = 2; // the join's own count and the first re-ask
    const id = await w.leadPageRoom();
    await w.press(id, "lead_in");
    expect(w.room(id).count_claimed_at ?? null).toBeNull();
    // +3 minutes: the sweep's re-ask, HighLevel still down: a person is told.
    w.clock.now += 3 * MIN;
    await w.tick([id]);
    const key = `room:${id}:count_unread`;
    expect(w.alerts().some(a => a.dedupe_key === key && !a.resolved_at)).toBe(true);
    // +4 minutes: HighLevel answers; the count marks the running intro shown.
    w.clock.now += 1 * MIN;
    await w.tick([id]);
    expect(w.room(id).count_appointment_id).toBe("intro-1");
    expect(w.hl.get("intro-1")).toBe("showed");
    // countResult answers count_unread only for booked, moved and
    // already_counted (432fa0e): a mark (count_result null) leaves "the lead's
    // booked calls could not be read, so nothing was counted yet. Check
    // HighLevel." open, posted to Slack, for the watchdog's three days.
    expect(w.alerts().some(a => a.dedupe_key === key && !a.resolved_at)).toBe(false);
  });
});

describe("a count a manager confirms later reads the calls as they stood at the join", () => {
  test("confirm-after-intro-passed-books-beside-it: Sunday the lead joins the setter's Meet room (hand press only) ahead of Monday's intro; the manager confirms Monday after the intro's time: a Live call is booked on top of the intro the join was", async () => {
    const w = setup();
    const sunday = w.clock.now;
    // Monday 09:00 Kuwait, booked last week: the lead's intro, ahead at the join.
    const monday = sunday + 23 * HOUR;
    w.knobs.calls.push({ id: "intro-1", start: monday, booked_at: sunday - 5 * 24 * HOUR, assigned_user_id: "G-setter" });
    w.intro("confirmed", monday);
    // The setter's Meet room from the lead page (no Zoom, short link off as
    // shipped): only the press says the lead came, so a manager confirms it.
    const id = await w.leadPageRoom({ evidence: false });
    await w.press(id, "lead_in");
    expect(w.room(id).count_result).toBe("self_reported");
    // Monday 11:00: the manager reads the alert and confirms. The intro's
    // 09:00 has passed; nobody marked it (the lead had talked on Sunday), so
    // it stays confirmed: a show for B2B once past.
    w.clock.now = monday + 2 * HOUR;
    await w.rooms.actions["room.count_confirm"]!(manager, { room_id: id });
    await w.flush();
    // At the join, the intro was the lead's call ahead: the count moves it to
    // the join's minute and marks it shown (one call). Read at the confirm,
    // upcoming() keeps only calls after now, so the intro is "nothing ahead",
    // and a Live call is booked beside the intro that is still a show:
    // one conversation, two shows.
    // Either outcome that counts it once passes: the intro moved to the join,
    // or left as it is (still a show) with nothing booked beside it.
    expect(w.posts()).toHaveLength(0);
  });
});
