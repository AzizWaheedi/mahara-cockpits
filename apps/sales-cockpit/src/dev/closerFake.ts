/**
 * The practice cockpit's Demo calendar closers, for bookingFake.ts (the
 * demo's closer picker, 2026-11-07): who is on the Demo calendar's team,
 * each one's free times, and sales-api's refusals in its own sentences
 * (supabase/functions/sales-api/closers.ts), so the practice Dialer can pick
 * a closer and book on them. Pure; every time is made up, and so are the
 * two closers.
 *
 * Two closers with different soonest times: the first closer's times are
 * the calendar's usual ones (today when there is time left, else tomorrow);
 * the second closer's start tomorrow afternoon. The manager seat on the
 * calendar is the practice cockpit's own signed-in seat (fixtures.ts ME, the
 * same name every practice screen shows), has the calendar's times too, and
 * lists after the closers. Booking a demo from the dialer's panel, that
 * seat starts on its own name (closerStart), as "With me" did.
 *
 * Knob `closers` (in the address, or window.harnessBook.closers):
 *   ok      both closers read
 *   none    the second closer has no free time in 14 days
 *   unread  the second closer's calendar does not answer (and picking them
 *           says so, as HighLevel's 500 would)
 *   off     an older server: the answer has no list, so no choices show
 */

export interface FakeSeat {
  user_id: string;
  name: string;
  role: "closer" | "both" | "manager" | "setter";
  active: boolean;
}

/** The Demo calendar's team in HighLevel's order, with each person's made-up seat. */
export const DEMO_TEAM: FakeSeat[] = [
  { user_id: "u-omar", name: "Omar Haddad", role: "closer", active: true },
  { user_id: "u-aziz", name: "Aziz Waheedi", role: "manager", active: true },
  { user_id: "u-hadi", name: "Hadi Saleh", role: "closer", active: true },
];

/** The second closer: their times start tomorrow afternoon. */
export const LATER_CLOSER = "u-hadi";

export interface FakeRefusal {
  message: string;
  status: number;
  code: string;
}

const KW = 3 * 3_600_000;
const first = (name: string | null | undefined) =>
  String(name ?? "").split(/\s+/)[0] || "";
const kindOf = (role: string) =>
  role === "closer" || role === "both"
    ? ("closer" as const)
    : role === "manager"
      ? ("manager" as const)
      : null;

/** The seat a person lists by, or null (no active closer, both or manager seat). */
export function seatOf(
  id: string,
  people: readonly FakeSeat[] = DEMO_TEAM,
): FakeSeat | null {
  return (
    people.find(p => p.user_id === id && p.active && kindOf(p.role)) ?? null
  );
}

/** sales-api's refusal for a picked closer (closers.ts closerRefusal), or null. */
export function closerRefusalFake(o: {
  id: string;
  kind: string;
  userId?: string | null;
  people?: readonly FakeSeat[];
  team?: readonly string[];
}): FakeRefusal | null {
  const people = o.people ?? DEMO_TEAM;
  const team = o.team ?? DEMO_TEAM.map(p => p.user_id);
  if (o.kind !== "demo")
    return {
      message: "Only a demo can go on a picked closer's calendar.",
      status: 400,
      code: "host",
    };
  const who = first(people.find(p => p.user_id === o.id)?.name);
  if (!team.includes(o.id))
    return {
      message: `${who || "That person"} is not on the Demo calendar in HighLevel. Pick another closer, or Anyone free.`,
      status: 409,
      code: "host",
    };
  const seat = seatOf(o.id, people);
  if (!seat)
    return {
      message: `${who || "That person"} has no active closer or manager seat in the cockpit, so the demo can't go on their calendar. Pick another closer, or Anyone free.`,
      status: 409,
      code: "not_closer",
    };
  if (o.userId && o.userId !== o.id) {
    const f = first(seat.name);
    return {
      message: `That time is another closer's. Pick one of ${f.endsWith("s") ? `${f}'` : `${f}'s`} times.`,
      status: 400,
      code: "host",
    };
  }
  return null;
}

/**
 * One person's own free times from the calendar's usual ones: the second
 * closer keeps only those from tomorrow, 1 pm on (Kuwait time).
 */
export function closerDaysOf(
  id: string,
  days: readonly { day: string; slots: string[] }[],
  now: number,
): { day: string; slots: string[] }[] {
  if (id !== LATER_CLOSER) return days.map(d => ({ ...d }));
  const today = new Date(now + KW).toISOString().slice(0, 10);
  return days
    .filter(d => d.day > today)
    .map(d => ({
      day: d.day,
      slots: d.slots.filter(
        s => new Date(Date.parse(s) + KW).getUTCHours() >= 13,
      ),
    }))
    .filter(d => d.slots.length);
}

export interface FakeCloserRow {
  user_id: string;
  name: string | null;
  kind: "closer" | "manager";
  soonest: string | null;
  state: "ok" | "unread";
}

/**
 * The list book.slots answers with `closers: true`: the team's closers,
 * then managers, each with their soonest time; `daysOf` null for a person
 * whose calendar did not answer (unread, never "no free time").
 */
export function closerListFake(
  daysOf: (id: string) => { slots: string[] }[] | null,
  now: number,
  people: readonly FakeSeat[] = DEMO_TEAM,
): FakeCloserRow[] {
  const rows: FakeCloserRow[] = [];
  for (const p of people) {
    const kind = kindOf(p.role);
    if (!p.active || !kind) continue;
    const days = daysOf(p.user_id);
    const soonest =
      days
        ?.flatMap(d => d.slots)
        .filter(s => Date.parse(s) > now)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    rows.push({
      user_id: p.user_id,
      name: p.name,
      kind,
      soonest: days ? soonest : null,
      state: days ? "ok" : "unread",
    });
  }
  const rank = (r: FakeCloserRow) =>
    r.state === "unread" ? 2 : r.soonest ? 0 : 1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        Number(a.r.kind === "manager") - Number(b.r.kind === "manager") ||
        rank(a.r) - rank(b.r) ||
        (a.r.soonest && b.r.soonest
          ? Date.parse(a.r.soonest) - Date.parse(b.r.soonest)
          : 0) ||
        a.i - b.i,
    )
    .map(x => x.r);
}
