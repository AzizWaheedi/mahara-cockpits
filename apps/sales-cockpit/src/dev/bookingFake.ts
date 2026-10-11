/**
 * sales-api's booking actions for the layout harness (2026-10-11, the
 * plan's section 3.3): book.slots for a booking and for a reschedule,
 * book.create (follow-up calls, "already booked" with the call to
 * reschedule instead), book.move (moved in place, or each refusal and the
 * slow "checking" path by a knob), book.move.check and book.told. The calls
 * live in fixtures.ts APPOINTMENTS, so the lead page, Today and the
 * Calendar read back what was booked or moved.
 *
 * Booking further out (2026-10-11, the far-out plan's section 4): past the
 * calendar's own booking page, book.slots adds the host's free times from
 * their working hours (Sun and Sat 8 am to 5 pm, Mon to Thu 9 am to 6 pm,
 * Friday off, as the recorded schedule has it) up to the reach, a page of
 * 14 days at a time (`from`); book.check answers a custom time; book.create
 * and book.move take `custom`, `outside_hours_ok` and `user_id`, refuse as
 * the plan's 4.3 says, and answer with `placement`.
 *
 * Knobs (in the address, or on window.harnessBook):
 *
 *   move    moved | checking | unverified | not_moved | taken | clash |
 *           busy | refused | late | held | over | not_yours | client | past
 *   slots   ok | none (the host has no free time: Show anyone free) | fail
 *   link    on | off   (the lead's pick-a-time link on intros and Follow up
 *           call; demos never, as HighLevel's allowReschedule says)
 *   far     on | off | none | unread   (off: an answer from before the
 *           far-out build, no new fields; none: the host has no hours past
 *           the booking page; unread: those could not be read just now)
 *   custom  auto | free | busy | outside   (what book.check finds; auto
 *           reads the hours above, the host's calls, and a meeting every
 *           Tuesday 1 pm to 2 pm)
 *   reach   60   (days the cockpit books ahead: booking.reach_days)
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
  far: "on",
  custom: "auto",
  reach: "60",
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
const DAY = 24 * H;

const CAL: Record<
  string,
  {
    id: string;
    name: string;
    minutes: number;
    days: number;
    step: number;
    buffer: number;
    reschedule: boolean;
  }
> = {
  intro: {
    id: "dsqmJ393Dwl9fDSbIVOI",
    name: "Intro (qualified)",
    minutes: 15,
    days: 2,
    step: 20,
    buffer: 5,
    reschedule: true,
  },
  demo: {
    id: "jQqXS1YuFnmGZKLkrE62",
    name: "Demo",
    minutes: 45,
    days: 3,
    step: 60,
    buffer: 10,
    reschedule: false,
  },
  follow_up: {
    id: "JTNg1Wd62qxuT8W8sroh",
    name: "Follow up call",
    minutes: 30,
    days: 3,
    step: 30,
    buffer: 0,
    reschedule: true,
  },
};

const HOSTS: Record<string, { id: string; name: string }> = {
  intro: { id: "u-sara", name: "Sara Khalil" },
  demo: { id: "u-omar", name: "Omar Haddad" },
  follow_up: { id: "u-omar", name: "Omar Haddad" },
};

/** Each calendar's team, in the calendar's order. */
const TEAM: Record<string, string[]> = {
  intro: ["u-sara", "u-noor"],
  demo: ["u-omar", "u-aziz"],
  follow_up: ["u-omar", "u-aziz", "u-sara"],
};

/** The working hours every fake host keeps, by weekday (0 = Sunday), minutes from midnight. */
const HOURS: Record<number, [number, number][]> = {
  0: [[8 * 60, 17 * 60]],
  1: [[9 * 60, 18 * 60]],
  2: [[9 * 60, 18 * 60]],
  3: [[9 * 60, 18 * 60]],
  4: [[9 * 60, 18 * 60]],
  5: [],
  6: [[8 * 60, 17 * 60]],
};
const WD_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WD_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];
/** A meeting that is not a call: every Tuesday, 1 pm to 2 pm. */
const MEETING: [number, number] = [13 * 60, 14 * 60];

const kindOf = (t: unknown) =>
  t === "demo"
    ? "demo"
    : t === "follow_up" || t === "callback"
      ? "follow_up"
      : "intro";

const kwDay = (ms: number) => new Date(ms + KW).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const wdOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const atMin = (day: string, m: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - KW + m * MIN).toISOString();
const minOf = (ms: number) => {
  const d = new Date(ms + KW);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

function clock(m: number): string {
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 || h === 24 ? "am" : "pm"}`;
}

function dateWords(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d
    .toLocaleDateString("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(",", "");
}

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

function person(id: string | null | undefined) {
  if (!id) return null;
  const p = F.PEOPLE.find(x => x.ghl_user_id === id);
  return p ? { user_id: id, name: String(p.name) } : null;
}
const first = (name: string | null | undefined) =>
  String(name ?? "").split(/\s+/)[0] || "The host";

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

/** The last day the calendar's own booking page offers. */
const windowUntil = (kind: string, now: number) =>
  kwDay(now + (CAL[kind] ?? CAL.intro).days * DAY);
const reachUntil = (now: number) =>
  addDays(kwDay(now), Math.max(15, Number(bookKnobs.reach) || 60) - 1);

/** A host's far-out times on the calendar's grid inside their hours, a few taken. */
function farDays(
  kind: string,
  from: string,
  to: string,
  userId: string,
  now: number,
) {
  const cal = CAL[kind] ?? CAL.intro;
  const out: { day: string; slots: string[]; far: true }[] = [];
  const salt = userId.length;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wd = wdOf(day);
    const slots: string[] = [];
    let i = 0;
    for (const [a, b] of HOURS[wd]) {
      for (let m = a; m + cal.minutes <= b; m += cal.step) {
        i += 1;
        if ((i + Number(day.slice(8)) + salt) % 4 === 0) continue;
        if (wd === 2 && m < MEETING[1] && MEETING[0] < m + cal.minutes)
          continue;
        const iso = atMin(day, m);
        if (Date.parse(iso) > now) slots.push(iso);
      }
    }
    if (slots.length) out.push({ day, slots, far: true });
  }
  return out;
}

/**
 * The lead's own link to pick another time (sales-api reschedule.ts
 * rescheduleLink, verified 2026-10-11): the calendar's booking page with the
 * call's id, on the sub-account's own domain; only where HighLevel lets the
 * lead reschedule (intros and Follow up call), and never with link=off.
 */
function linkOf(a: Row): string | null {
  const cal = CAL[kindOf(a.call_type)];
  if (!cal?.reschedule || bookKnobs.link === "off") return null;
  return `https://link.maharamedia.com/widget/booking/${a.calendar_id ?? cal.id}?event_id=${a.appointment_id}`;
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
    case "book.check":
      return timeCheck(b, now) as unknown as Row;
    case "book.create":
      return create(b, now);
    case "book.move":
      return move(b, now);
    case "book.move.check":
      return check(b, now);
    case "book.told":
      return { told: true };
    case "book.links":
      return links(b, now);
    default:
      return null;
  }
}

/** The far-out half of a book.slots answer (plan 4.1), for one page. */
function farPart(o: {
  kind: string;
  from: unknown;
  now: number;
  hostId: string | null;
  team: boolean;
  windowDays: { day: string; slots: string[] }[];
}) {
  const today = kwDay(o.now);
  const w = windowUntil(o.kind, o.now);
  const reach = reachUntil(o.now);
  const ok = bookKnobs.far === "on";
  const end = ok ? reach : w;
  const asked =
    typeof o.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.from)
      ? o.from
      : today;
  const from = min(max(asked, today), end);
  const to = min(addDays(from, 13), end);
  const days: { day: string; slots: string[]; far?: true }[] =
    o.windowDays.filter(d => d.day >= from && d.day <= to);
  const slotHosts: Record<string, { user_id: string; name: string }> = {};
  if (ok) {
    const farFrom = max(from, addDays(w, 1));
    const ids = o.team || !o.hostId ? TEAM[o.kind] : [o.hostId];
    const merged = new Map<string, Set<string>>();
    for (const id of ids)
      for (const d of farDays(o.kind, farFrom, to, id, o.now)) {
        const set = merged.get(d.day) ?? new Set<string>();
        for (const s of d.slots) {
          if (!set.has(s) && ids.length > 1) {
            const p = person(id);
            if (p) slotHosts[s] = p;
          }
          set.add(s);
        }
        merged.set(d.day, set);
      }
    for (const [day, set] of [...merged].sort((a, b) =>
      a[0].localeCompare(b[0]),
    ))
      days.push({ day, slots: [...set].sort(), far: true });
  }
  const host = person(o.hostId);
  const hostFirst = first(host?.name);
  return {
    until: ok ? reach : w,
    window_until: w,
    reach_until: reach,
    page: {
      from,
      to,
      prev: from > today ? max(today, addDays(from, -14)) : null,
      next: to < end ? addDays(to, 1) : null,
    },
    days,
    slotHosts,
    far: {
      state: bookKnobs.far === "on" ? "ok" : bookKnobs.far,
      agreed: ok ? true : null,
      note:
        bookKnobs.far === "none"
          ? `${hostFirst} has no working hours on this calendar in HighLevel, so only the booking page's days are offered.`
          : bookKnobs.far === "unread"
            ? `Times past ${dateWords(w)} could not be checked just now: ${hostFirst}'s calendar did not answer. The booking page's days are below.`
            : null,
    },
    host_hours: host
      ? {
          user_id: host.user_id,
          name: host.name,
          week: Object.fromEntries(
            WD_KEYS.map((k, i) => [
              k,
              HOURS[i].map(([a, b]) => [
                `${String(a / 60).padStart(2, "0")}:00`,
                `${String(b / 60).padStart(2, "0")}:00`,
              ]),
            ]),
          ),
        }
      : null,
  };
}

function slots(b: Row, now: number): Row {
  if (bookKnobs.slots === "fail")
    throw new BookRefusal(
      "HighLevel said 503: the calendar service is busy",
      502,
    );
  const old = bookKnobs.far === "off";
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
    const hostId = (a.assigned_user_id as string | null) ?? null;
    const far = old
      ? null
      : farPart({
          kind,
          from: b.from,
          now,
          hostId,
          team: anyone,
          windowDays: days,
        });
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
      until: far ? far.until : windowUntil(kind, now),
      days: far ? far.days : days,
      ...(anyone || (far && Object.keys(far.slotHosts).length)
        ? { slot_hosts: { ...slotHosts, ...(far?.slotHosts ?? {}) } }
        : {}),
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
      reschedule_link: linkOf(a),
      ...(far
        ? {
            window_until: far.window_until,
            reach_until: far.reach_until,
            page: far.page,
            far: far.far,
            host_hours: far.host_hours,
            custom: {
              host: person(hostId),
              hosts: TEAM[kind].map(person).filter(Boolean),
              step_min: 5,
            },
          }
        : {}),
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
  // As sales-api's bookingPlan: "with me" only when I am on the calendar's
  // team; otherwise the team's times (and Custom time asks who takes it).
  const onTeam = TEAM[kind].includes(String(F.ME.ghl_user_id));
  const mine = onTeam && b.with !== "anyone";
  const none = bookKnobs.slots === "none" && mine;
  const days = none ? [] : freeDays(kind, now, mine ? 0 : 1);
  const far = old
    ? null
    : farPart({
        kind,
        from: b.from,
        now,
        hostId: mine ? String(F.ME.ghl_user_id) : null,
        team: !mine,
        windowDays: days,
      });
  return {
    kind,
    calendar_id: cal.id,
    calendar: cal.name,
    minutes: cal.minutes,
    with: mine ? "me" : "anyone",
    fallback: false,
    on_team: onTeam,
    host: mine ? { user_id: F.ME.ghl_user_id, name: F.ME.name } : null,
    notice: `${cal.name} opens up to ${cal.days} days ahead, from 2 hours ahead.`,
    until: far ? far.until : windowUntil(kind, now),
    days: far ? far.days : days,
    ...(far && Object.keys(far.slotHosts).length
      ? { slot_hosts: far.slotHosts }
      : {}),
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
    ...(far
      ? {
          window_until: far.window_until,
          reach_until: far.reach_until,
          page: far.page,
          far: far.far,
          host_hours: onTeam ? far.host_hours : null,
          custom: {
            host: onTeam ? person(String(F.ME.ghl_user_id)) : null,
            hosts: TEAM[kind].map(person).filter(Boolean),
            step_min: 5,
          },
        }
      : {}),
  };
}

/**
 * book.links (the lead page's rows): the lead's own link for each call
 * still ahead that can be rescheduled, on calendars that allow it; a client
 * gets none.
 */
function links(b: Row, now: number): Row {
  const contact = String(b.contact_id ?? "");
  if (isClientLead(contact)) return { links: {}, client: true };
  const out: Record<string, string> = {};
  for (const a of F.APPOINTMENTS) {
    if (a.contact_id !== contact || !live(a, now)) continue;
    const l = linkOf(a);
    if (l) out[String(a.appointment_id)] = l;
  }
  return { links: out };
}

/** book.check (plan 4.2): a custom time against the host's hours and calendar. */
function timeCheck(b: Row, now: number) {
  let kind: string;
  let hostId: string | null;
  let movingId: string | null = null;
  if (b.appointment_id) {
    const a = F.APPOINTMENTS.find(x => x.appointment_id === b.appointment_id);
    if (!a) throw new BookRefusal("That call is not on the calendar.", 404);
    guard(a, now);
    kind = kindOf(a.call_type);
    hostId = (a.assigned_user_id as string | null) ?? null;
    movingId = String(a.appointment_id);
  } else {
    if (isClientLead(String(b.contact_id ?? "")))
      throw new BookRefusal(CLIENT, 409, "client");
    kind = kindOf(b.kind);
    // As sales-api: me when I am on the calendar's team, else whoever is picked.
    hostId = TEAM[kind].includes(String(F.ME.ghl_user_id))
      ? String(F.ME.ghl_user_id)
      : null;
  }
  if (b.user_id) hostId = String(b.user_id);
  const host = person(hostId);
  const cal = CAL[kind] ?? CAL.intro;
  const t = Date.parse(String(b.start ?? ""));
  if (!Number.isFinite(t))
    throw new BookRefusal("Pick a day and a time.", 400, "time");
  const start = new Date(t).toISOString();
  const day = kwDay(t);
  const wd = wdOf(day);
  const m = minOf(t);
  const reach = reachUntil(now);
  const past = t <= now + 5 * MIN;
  const beyond = day > reach;
  const step = m % 5 !== 0;
  // Nobody named to take it: sales-api answers with no host and asks who.
  if (!host)
    return {
      start,
      words: words(start),
      host: null,
      placement: "custom",
      clash: null,
      outside_hours: false,
      hours_words: null,
      beyond_reach: beyond,
      past,
      step,
      line: past
        ? "That time has passed or starts in under 5 minutes. Pick a later one."
        : step
          ? "Pick a time on the 5-minute mark."
          : beyond
            ? `Pick a day up to ${dateWords(reach)}.`
            : "Pick who takes the call.",
    };
  const hours = HOURS[wd];
  let outside = !hours.some(([a, e]) => m >= a && m + cal.minutes <= e);
  let clash: { start: string; end: string; what: "call" | "busy" } | null =
    null;
  if (wd === 2 && m < MEETING[1] && MEETING[0] < m + cal.minutes + cal.buffer)
    clash = {
      start: atMin(day, MEETING[0]),
      end: atMin(day, MEETING[1]),
      what: "busy",
    };
  for (const a of F.APPOINTMENTS) {
    if (clash || a.appointment_id === movingId) continue;
    if (a.assigned_user_id !== hostId || !live(a, now)) continue;
    const s = Date.parse(String(a.start_at));
    const e = s + (CAL[kindOf(a.call_type)]?.minutes ?? 30) * MIN;
    if (t < e + cal.buffer * MIN && s < t + (cal.minutes + cal.buffer) * MIN)
      clash = {
        start: new Date(s).toISOString(),
        end: new Date(e).toISOString(),
        what: "call",
      };
  }
  if (bookKnobs.custom === "free") {
    clash = null;
    outside = false;
  } else if (bookKnobs.custom === "busy" && !clash)
    clash = {
      start,
      end: new Date(t + 30 * MIN).toISOString(),
      what: "call",
    };
  else if (bookKnobs.custom === "outside") outside = true;
  const name = first(host.name);
  const hoursWords = hours.length
    ? `${hours.map(([a, e]) => `${clock(a)} to ${clock(e)}`).join(", ")} on ${WD_PLURAL[wd]}`
    : `no working hours on ${WD_PLURAL[wd]}`;
  const inWindow =
    day <= windowUntil(kind, now) &&
    freeDays(kind, now).some(d => d.slots.includes(start));
  const line = past
    ? "That time has passed or starts in under 5 minutes. Pick a later one."
    : beyond
      ? `Pick a day up to ${dateWords(reach)}.`
      : step
        ? "Pick a time on the 5-minute mark."
        : clash
          ? clash.what === "call"
            ? `${name} has another call from ${clock(minOf(Date.parse(clash.start)))} to ${clock(minOf(Date.parse(clash.end)))} (Kuwait time). Pick another time.`
            : `${name}'s calendar is busy from ${clock(minOf(Date.parse(clash.start)))} to ${clock(minOf(Date.parse(clash.end)))} (Kuwait time). Pick another time.`
          : outside
            ? `That's outside ${name}'s working hours (${hoursWords}). Press Book anyway to keep it, or pick another time.`
            : `Free for ${name}, inside working hours.`;
  return {
    start,
    words: words(start),
    host,
    placement: inWindow ? "window" : "custom",
    clash,
    outside_hours: outside,
    hours_words: hoursWords,
    beyond_reach: beyond,
    past,
    step,
    line,
  };
}

/** What book.create and book.move do with a custom or far-out time (plan 3.3 and 4.3). */
function placeOf(b: Row, kind: string, now: number): string {
  const t = Date.parse(String(b.start ?? ""));
  const day = Number.isFinite(t) ? kwDay(t) : "";
  if (b.custom) {
    const c = timeCheck(b, now);
    if (c.past) throw new BookRefusal(c.line, 400, "past");
    if (!c.host)
      throw new BookRefusal("Pick who takes the call.", 400, "host_needed");
    if (c.beyond_reach) throw new BookRefusal(c.line, 400, "beyond_reach");
    if (c.step) throw new BookRefusal(c.line, 400, "step");
    if (c.clash) throw new BookRefusal(c.line, 409, "host_busy");
    if (c.outside_hours && !b.outside_hours_ok)
      throw new BookRefusal(c.line, 409, "outside_hours");
    return c.placement;
  }
  if (bookKnobs.far === "off") return "window";
  if (day > reachUntil(now))
    throw new BookRefusal(
      `Pick a day up to ${dateWords(reachUntil(now))}.`,
      400,
      "beyond_reach",
    );
  return day > windowUntil(kind, now) ? "far_out" : "window";
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
  const placement = placeOf(b, kind, now);
  const named = person(b.user_id ? String(b.user_id) : null);
  const host = named
    ? { id: named.user_id, name: named.name }
    : b.with === "me"
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
    placement,
    reschedule_link: linkOf(row),
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
  const placement = placeOf(b, kindOf(a.call_type), now);
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
      placement,
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
    placement,
    reschedule_link: linkOf(a),
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
    reschedule_link: linkOf(c.row),
  };
}
