/**
 * sales-api's booking actions for the layout harness (2026-10-11, the
 * plan's section 3.3): book.slots for a booking and for a reschedule,
 * book.create (follow-up calls, "already booked" with the call to
 * reschedule instead), book.move (moved in place, or each refusal and the
 * slow "checking" path by a knob), book.move.check and book.told. The calls
 * live in fixtures.ts APPOINTMENTS, so the lead page, Today and the
 * Calendar read back what was booked or moved.
 *
 * Knobs (in the address, or on window.harnessBook):
 *
 *   move    moved | checking | unverified | not_moved | taken | clash |
 *           busy | refused | late | held | over | not_yours | client | past
 *   slots   ok | none (the host has no free time: Show anyone free) | fail
 *   link    on | off   (the intro's pick-a-time link, plan D17)
 */
import * as F from "./fixtures";

type Row = Record<string, unknown>;

export class BookRefusal extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status = 400, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bookKnobs = {
  move: "moved",
  slots: "ok",
  link: "on",
};
{
  const params = new URLSearchParams(window.location.search);
  for (const k of Object.keys(bookKnobs) as (keyof typeof bookKnobs)[]) {
    const v = params.get(k);
    if (v !== null) bookKnobs[k] = v;
  }
  (window as unknown as { harnessBook: typeof bookKnobs }).harnessBook =
    bookKnobs;
}

const MIN = 60_000;
const H = 60 * MIN;
const KW = 3 * H;

const CAL: Record<
  string,
  { id: string; name: string; minutes: number; days: number }
> = {
  intro: {
    id: "dsqmJ393Dwl9fDSbIVOI",
    name: "Intro (qualified)",
    minutes: 15,
    days: 2,
  },
  demo: { id: "jQqXS1YuFnmGZKLkrE62", name: "Demo", minutes: 45, days: 3 },
  follow_up: {
    id: "JTNg1Wd62qxuT8W8sroh",
    name: "Follow up call",
    minutes: 30,
    days: 3,
  },
};

const HOSTS: Record<string, { id: string; name: string }> = {
  intro: { id: "u-sara", name: "Sara Khalil" },
  demo: { id: "u-omar", name: "Omar Haddad" },
  follow_up: { id: "u-omar", name: "Omar Haddad" },
};

const kindOf = (t: unknown) =>
  t === "demo"
    ? "demo"
    : t === "follow_up" || t === "callback"
      ? "follow_up"
      : "intro";

function words(iso: string): string {
  const d = new Date(Date.parse(iso) + KW);
  const day = d.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const h = d.getUTCHours();
  return `${day.replace(",", "")}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Free times from today for the calendar's own window, every 20 minutes from 10:00 to 18:40, some taken. */
function freeDays(kind: string, now: number, salt = 0) {
  const cal = CAL[kind] ?? CAL.intro;
  const out: { day: string; slots: string[] }[] = [];
  for (let d = 0; d <= cal.days; d++) {
    const day = new Date(now + d * 86_400_000 + KW).toISOString().slice(0, 10);
    const slots: string[] = [];
    for (let m = 600; m <= 1120; m += 20) {
      if ((m / 20 + d + salt) % 3 === 0) continue;
      const iso = new Date(
        Date.parse(`${day}T00:00:00Z`) - KW + m * MIN,
      ).toISOString();
      // HighLevel's notice: two hours ahead at least.
      if (Date.parse(iso) < now + 2 * H) continue;
      slots.push(iso);
    }
    if (slots.length) out.push({ day, slots });
  }
  return out;
}

const OVER = ["cancelled", "noshow", "showed", "invalid"];
const live = (a: Row, now: number) =>
  !OVER.includes(String(a.marked_status ?? a.status ?? "")) &&
  Date.parse(String(a.start_at)) > now - 20 * MIN;

function apptOut(a: Row): Row {
  return {
    id: a.appointment_id,
    kind: kindOf(a.call_type),
    start: a.start_at,
    host_user_id: a.assigned_user_id ?? null,
    host_name: a.assigned_user_name ?? null,
    meet_url: a.meet_url ?? null,
  };
}

const isClientLead = (contactId: string) => {
  const l = F.LEADS.find(x => x.contact_id === contactId);
  const tags = (l?.tags ?? []) as string[];
  const tagged = Array.isArray(tags) && tags.includes("client");
  const signed = F.DEALS.some(d => d.contact_id === contactId && !d.voided);
  return tagged || signed;
};

const CLIENT =
  "This is an active client: client success looks after them, so no call is booked or rescheduled from sales.";

/** Why this call cannot be rescheduled, before any HighLevel read (plan 3.3). */
function guard(a: Row, now: number) {
  if (isClientLead(String(a.contact_id)))
    throw new BookRefusal(CLIENT, 409, "client");
  const status = String(a.marked_status ?? a.status ?? "");
  if (OVER.includes(status))
    throw new BookRefusal(
      "This call is already marked, so it can't be rescheduled. Book a new one instead.",
      409,
      "over",
    );
  const t = Date.parse(String(a.start_at));
  if (now - t > 20 * MIN)
    throw new BookRefusal(
      "This call started more than 20 minutes ago. Mark it, then book it again.",
      409,
      "late",
    );
}

const moves = new Map<string, Row>();
const checks = new Map<
  string,
  {
    polls: number;
    row: Row;
    start: string;
    userId: string | null;
    from: string;
  }
>();
let seq = 0;

function landMove(a: Row, start: string, userId: string | null, now: number) {
  const from = String(a.start_at);
  a.start_at = new Date(Date.parse(start)).toISOString();
  a.rescheduled_at = new Date(now).toISOString();
  a.rescheduled_from = from;
  a.rescheduled_by = F.ME.email;
  a.needs_mark = false;
  let changed = false;
  if (userId && userId !== a.assigned_user_id) {
    const p = F.PEOPLE.find(x => x.ghl_user_id === userId);
    a.assigned_user_id = userId;
    a.assigned_user_name = p?.name ?? "Omar Haddad";
    changed = true;
  }
  return { from, changed };
}

/** The booking actions, or null for any other action. */
export function bookAnswer(action: string, b: Row, now: number): Row | null {
  switch (action) {
    case "book.slots":
      return slots(b, now);
    case "book.create":
      return create(b, now);
    case "book.move":
      return move(b, now);
    case "book.move.check":
      return check(b, now);
    case "book.told":
      return { told: true };
    default:
      return null;
  }
}

function slots(b: Row, now: number): Row {
  if (bookKnobs.slots === "fail")
    throw new BookRefusal(
      "HighLevel said 503: the calendar service is busy",
      502,
    );
  if (b.appointment_id) {
    const a = F.APPOINTMENTS.find(x => x.appointment_id === b.appointment_id);
    if (!a) throw new BookRefusal("That call is not on the calendar.", 404);
    guard(a, now);
    const kind = kindOf(a.call_type);
    const cal = CAL[kind];
    const anyone = b.with === "anyone";
    const none = bookKnobs.slots === "none" && !anyone;
    const days = none ? [] : freeDays(kind, now, anyone ? 1 : 0);
    const slotHosts: Record<string, { user_id: string; name: string }> = {};
    if (anyone)
      for (const d of days)
        d.slots.forEach((s, i) => {
          slotHosts[s] =
            i % 2
              ? { user_id: "u-noor", name: "Noor Ali" }
              : { user_id: "u-omar", name: "Omar Haddad" };
        });
    const start = String(a.start_at);
    return {
      kind,
      calendar_id: a.calendar_id ?? cal.id,
      calendar: cal.name,
      minutes: cal.minutes,
      with: anyone ? "anyone" : "same",
      fallback: false,
      on_team: true,
      host: {
        user_id: a.assigned_user_id ?? null,
        name: a.assigned_user_name ?? null,
      },
      notice: `${cal.name} opens up to ${cal.days} days ahead, from 2 hours ahead.`,
      until: new Date(now + cal.days * 86_400_000 + KW)
        .toISOString()
        .slice(0, 10),
      days,
      ...(anyone ? { slot_hosts: slotHosts } : {}),
      existing: null,
      moving: {
        id: a.appointment_id,
        start,
        words: words(start),
        kind,
        host_name: a.assigned_user_name ?? null,
        after_start: Date.parse(start) < now,
      },
      booking_url: null,
      reschedule_link:
        kind === "intro" && bookKnobs.link !== "off"
          ? `https://api.leadconnectorhq.com/widget/booking/${cal.id}?event_id=${a.appointment_id}`
          : null,
    };
  }
  const contact = String(b.contact_id ?? "");
  if (isClientLead(contact)) throw new BookRefusal(CLIENT, 409, "client");
  const kind = kindOf(b.kind);
  const cal = CAL[kind];
  const had = F.APPOINTMENTS.filter(
    a =>
      a.contact_id === contact &&
      kindOf(a.call_type) === kind &&
      a.call_type !== "callback" &&
      live(a, now),
  ).sort(
    (x, y) => Date.parse(String(x.start_at)) - Date.parse(String(y.start_at)),
  )[0];
  const none = bookKnobs.slots === "none" && b.with === "me";
  return {
    kind,
    calendar_id: cal.id,
    calendar: cal.name,
    minutes: cal.minutes,
    with: b.with ?? "me",
    fallback: false,
    on_team: true,
    host:
      b.with === "me" ? { user_id: F.ME.ghl_user_id, name: F.ME.name } : null,
    notice: `${cal.name} opens up to ${cal.days} days ahead, from 2 hours ahead.`,
    until: new Date(now + cal.days * 86_400_000 + KW)
      .toISOString()
      .slice(0, 10),
    days: none ? [] : freeDays(kind, now, b.with === "anyone" ? 1 : 0),
    existing: had
      ? {
          id: had.appointment_id,
          start: had.start_at,
          words: words(String(had.start_at)),
          kind,
        }
      : null,
    booking_url: `https://api.leadconnectorhq.com/widget/booking/${cal.id}`,
    reschedule_link: null,
  };
}

function create(b: Row, now: number): Row {
  const contact = String(b.contact_id ?? "");
  if (isClientLead(contact)) throw new BookRefusal(CLIENT, 409, "client");
  const note = String(b.note ?? "").trim();
  if (note.length < 3)
    throw new BookRefusal(
      "Write a line on the call, so whoever takes it knows what was said.",
    );
  const kind = kindOf(b.kind);
  const had = F.APPOINTMENTS.find(
    a =>
      a.contact_id === contact &&
      kindOf(a.call_type) === kind &&
      a.call_type !== "callback" &&
      live(a, now),
  );
  if (had)
    throw new BookRefusal(
      `They already have ${kind === "intro" ? "an intro" : `a ${kind === "demo" ? "demo" : "follow-up call"}`} on ${words(String(had.start_at))} (Kuwait time). Reschedule that one instead of booking a second.`,
      409,
      "already_booked",
    );
  if (bookKnobs.move === "taken")
    throw new BookRefusal(
      "That time was just taken. Pick another.",
      409,
      "taken",
    );
  const host =
    b.with === "me"
      ? { id: String(F.ME.ghl_user_id), name: String(F.ME.name) }
      : HOSTS[kind];
  const lead = F.LEADS.find(l => l.contact_id === contact);
  const start = new Date(Date.parse(String(b.start))).toISOString();
  const row: Row = {
    appointment_id: `bk-${++seq}-${now}`,
    contact_id: contact,
    contact_name: lead?.name ?? null,
    calendar_id: CAL[kind].id,
    call_type: kind,
    start_at: start,
    booked_at: new Date(now).toISOString(),
    crm_status: "confirmed",
    assigned_user_id: host.id,
    assigned_user_name: host.name,
    ad_id: null,
    origin: "ghl",
    mirrored_at: new Date(now).toISOString(),
    mark_id: null,
    marked_status: null,
    mark_reason: null,
    mark_note: null,
    marked_by: null,
    marked_at: null,
    mark_crm: null,
    mark_crm_error: null,
    status: "confirmed",
    needs_mark: false,
    meet_url: kind === "demo" ? "https://us06web.zoom.us/j/89900112233" : null,
  };
  F.APPOINTMENTS.push(row);
  const label =
    kind === "demo" ? "Demo" : kind === "intro" ? "Intro" : "Follow-up call";
  return {
    verified: true,
    words: `${label} booked for ${words(start)} (Kuwait time)`,
    appointment: apptOut(row),
  };
}

const REFUSALS: Record<string, [string, number]> = {
  taken: ["That time was just taken. The free times are read again.", 409],
  clash: ["They have another call at that time. Pick another time.", 409],
  busy: [
    "Someone is rescheduling this call right now. Wait a moment and look again.",
    409,
  ],
  refused: [
    "HighLevel did not reschedule it: the calendar is closed that day. It is still at its old time.",
    409,
  ],
  not_moved: [
    "HighLevel did not answer, and the call is still at its old time. Press the time again.",
    409,
  ],
  late: [
    "This call started more than 20 minutes ago. Mark it, then book it again.",
    409,
  ],
  held: [
    "They joined the video call for this one, so it happened. Mark it instead.",
    409,
  ],
  over: [
    "This call is already marked, so it can't be rescheduled. Book a new one instead.",
    409,
  ],
  not_yours: [
    "This call is Omar's. Ask Omar or a manager to reschedule it.",
    403,
  ],
  client: [CLIENT, 409],
  past: ["That time has already passed. Pick a time ahead.", 400],
};

function move(b: Row, now: number): Row {
  const rid = String(b.request_id ?? "");
  const seen = moves.get(rid);
  if (seen) return seen;
  const a = F.APPOINTMENTS.find(x => x.appointment_id === b.appointment_id);
  if (!a) throw new BookRefusal("That call is not on the calendar.", 404);
  guard(a, now);
  if (b.reason === "other" && String(b.note ?? "").trim().length < 3)
    throw new BookRefusal("Say why in a few words.", 400, "note_needed");
  const r = REFUSALS[bookKnobs.move];
  if (r) throw new BookRefusal(r[0], r[1], bookKnobs.move);
  const start = String(b.start);
  const userId = b.user_id ? String(b.user_id) : null;
  const id = `rs-${++seq}`;
  if (bookKnobs.move === "checking" || bookKnobs.move === "unverified") {
    checks.set(rid, {
      polls: 0,
      row: a,
      start,
      userId,
      from: String(a.start_at),
    });
    checks.set(id, checks.get(rid) as never);
    return {
      result: "checking",
      reschedule_id: id,
      from_start: a.start_at,
      start,
      host_changed: false,
      appointment: null,
      words: words(start),
    };
  }
  const { from, changed } = landMove(a, start, userId, now);
  const out = {
    result: "moved",
    reschedule_id: id,
    from_start: from,
    start: a.start_at,
    host_changed: changed,
    appointment: apptOut(a),
    words: words(start),
  };
  moves.set(rid, out);
  return out;
}

function check(b: Row, now: number): Row {
  const c =
    checks.get(String(b.reschedule_id ?? "")) ??
    checks.get(String(b.request_id ?? ""));
  if (!c) return { result: "not_moved", start: null, appointment: null };
  c.polls += 1;
  if (c.polls < 2)
    return { result: "checking", start: null, appointment: null };
  if (bookKnobs.move === "unverified")
    return { result: "unverified", start: null, appointment: apptOut(c.row) };
  if (c.row.start_at !== new Date(Date.parse(c.start)).toISOString())
    landMove(c.row, c.start, c.userId, now);
  return {
    result: "moved",
    start: c.row.start_at,
    appointment: apptOut(c.row),
  };
}
