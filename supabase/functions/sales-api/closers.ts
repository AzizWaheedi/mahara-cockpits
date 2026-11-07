/**
 * The demo's closer picker (2026-11-07). The CEO, verbatim: "He should also
 * be able to pick the specific closer he wants to book the demo on their
 * calendar for."
 *
 * Pure: who a demo can be booked on, in what order, the name a chip and a
 * sentence use, and the one sentence when a pick is refused. index.ts reads
 * the Demo calendar's team from HighLevel (GET /calendars/{id}, teamMembers)
 * and the seats from cockpit_sales_people, and passes them in. Nothing here
 * reads or writes.
 *
 * Who is listed: a person on the Demo calendar's HighLevel team who has an
 * active cockpit seat with that HighLevel user id and the role closer, both
 * or manager. Closers (closer, both) first, then managers; within a group
 * the soonest free time first (closerOrder), else the calendar's own team
 * order. A team member with no such seat (a leaver, a setter) is left out.
 * One HighLevel user on two seats is listed once. Two people with the same
 * first name get a last initial.
 *
 * Adding a closer to the list is a person's job in HighLevel's settings
 * (add them to the Demo calendar's team and link their working hours),
 * never code: a calendar update through the API resets its fields and
 * unlinks the availability schedules.
 */

export type CloserKind = "closer" | "manager";

/** A cockpit_sales_people row as the picker reads it (ghl_user_id, name, role, active). */
export interface CloserSeat {
  ghl_user_id?: unknown;
  name?: unknown;
  role?: unknown;
  active?: unknown;
}

export interface Closer {
  user_id: string;
  name: string | null;
  /** The name a chip or a sentence uses: the first name, with a last initial when two listed share it. */
  first: string;
  kind: CloserKind;
}

/** A listed closer with their soonest free time on the Demo calendar (book.slots with closers: true). */
export interface CloserRead {
  user_id: string;
  name: string | null;
  kind: CloserKind;
  /** Their soonest free start in the 14 days read; null with state ok: no free time. */
  soonest: string | null;
  /** ok: read; unread: HighLevel did not answer for them, never "no free time". */
  state: "ok" | "unread";
}

export interface CloserRefusal {
  code: "host" | "not_closer";
  status: 400 | 409;
  message: string;
}

/** The only call kind that goes on a picked closer's calendar. */
export const NOT_DEMO_LINE = "Only a demo can go on a picked closer's calendar.";

/** The kind a seat's role lists under, or null when the role takes no demo. */
export function closerKind(role: unknown): CloserKind | null {
  const r = String(role ?? "");
  if (r === "closer" || r === "both") return "closer";
  if (r === "manager") return "manager";
  return null;
}

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

const firstOf = (name: string | null): string => (name ?? "").split(/\s+/)[0] ?? "";

/** "Sami" → "Sami's", "Thomas" → "Thomas'". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/**
 * The seat a HighLevel user is listed by: an active seat with a closer,
 * both or manager role, a closer's before a manager's, one with a name
 * before one without. Null: no such seat.
 */
function seatFor(userId: string, seats: readonly CloserSeat[]): { name: string | null; kind: CloserKind } | null {
  const mine = seats
    .map((s, i) => ({ i, name: text(s.name), kind: closerKind(s.role), id: String(s.ghl_user_id ?? ""), active: s.active === true }))
    .filter(s => s.id === userId && s.active && s.kind !== null)
    .sort((a, b) => Number(a.kind === "manager") - Number(b.kind === "manager") || Number(!a.name) - Number(!b.name) || a.i - b.i);
  const s = mine[0];
  return s ? { name: s.name, kind: s.kind as CloserKind } : null;
}

/** Any seat's name for a HighLevel user (an active one first), for a refusal's sentence. */
function anyName(userId: string, seats: readonly CloserSeat[]): string | null {
  const rows = seats
    .filter(s => String(s.ghl_user_id ?? "") === userId && text(s.name))
    .sort((a, b) => Number(b.active === true) - Number(a.active === true));
  return rows[0] ? text(rows[0].name) : null;
}

/** First names, with a last initial for each first name two or more listed people share ("Sami K."). */
function withFirsts(list: { user_id: string; name: string | null; kind: CloserKind }[]): Closer[] {
  const count = new Map<string, number>();
  for (const c of list) {
    const f = firstOf(c.name).toLowerCase();
    if (f) count.set(f, (count.get(f) ?? 0) + 1);
  }
  return list.map(c => {
    const f = firstOf(c.name);
    if (!f) return { ...c, first: "Name not set" };
    const words = (c.name ?? "").split(/\s+/).filter(Boolean);
    const last = words.length > 1 ? (words[words.length - 1] as string).charAt(0).toUpperCase() : "";
    return { ...c, first: (count.get(f.toLowerCase()) ?? 0) > 1 && last ? `${f} ${last}.` : f };
  });
}

/**
 * Who a demo can be booked on: the calendar team's people with an active
 * closer, both or manager seat, closers first, then managers, each group in
 * the team's own order; a user listed once.
 */
export function closersOn(team: readonly string[], seats: readonly CloserSeat[]): Closer[] {
  const seen = new Set<string>();
  const out: { user_id: string; name: string | null; kind: CloserKind }[] = [];
  for (const raw of team) {
    const id = String(raw ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const s = seatFor(id, seats);
    if (s) out.push({ user_id: id, name: s.name, kind: s.kind });
  }
  return withFirsts([...out.filter(c => c.kind === "closer"), ...out.filter(c => c.kind === "manager")]);
}

/**
 * The listed closers in the order the chips show: closers before managers;
 * within a group a free time before none, the soonest first, and a read that
 * failed last; otherwise as given.
 */
export function closerOrder<T extends { kind: CloserKind; soonest: string | null; state: "ok" | "unread" }>(list: readonly T[]): T[] {
  const rank = (c: T) => (c.state === "unread" ? 2 : c.soonest ? 0 : 1);
  const at = (c: T) => {
    const t = c.soonest ? Date.parse(c.soonest) : Number.NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return list
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        Number(a.c.kind === "manager") - Number(b.c.kind === "manager") ||
        rank(a.c) - rank(b.c) ||
        at(a.c) - at(b.c) ||
        a.i - b.i,
    )
    .map(x => x.c);
}

/** The soonest free start still ahead across HighLevel's days, as HighLevel wrote it; null when none. */
export function soonestOf(days: readonly { slots: readonly string[] }[], now: number): string | null {
  let best: string | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const d of days)
    for (const s of d.slots) {
      const t = Date.parse(s);
      if (Number.isFinite(t) && t > now && t < bestAt) {
        best = s;
        bestAt = t;
      }
    }
  return best;
}

/**
 * Why a picked closer cannot take this demo, or null when they can: only a
 * demo (400 host); someone on the Demo calendar's team in HighLevel (409
 * host); an active closer, both or manager seat (409 not_closer); and a
 * press that names another host than the closer (400 host).
 */
export function closerRefusal(o: {
  id: string;
  kind: string;
  team: readonly string[];
  seats: readonly CloserSeat[];
  /** The host a press named (user_id), when it named one. */
  userId?: string | null;
}): CloserRefusal | null {
  if (o.kind !== "demo") return { code: "host", status: 400, message: NOT_DEMO_LINE };
  const name = anyName(o.id, o.seats);
  const who = firstOf(name);
  if (!o.team.includes(o.id))
    return { code: "host", status: 409, message: `${who || "That person"} is not on the Demo calendar in HighLevel. Pick another closer, or Anyone free.` };
  const seat = seatFor(o.id, o.seats);
  if (!seat)
    return {
      code: "not_closer",
      status: 409,
      message: `${who || "That person"} has no active closer or manager seat in the cockpit, so the demo can't go on their calendar. Pick another closer, or Anyone free.`,
    };
  if (o.userId && o.userId !== o.id) {
    const first = firstOf(seat.name);
    return {
      code: "host",
      status: 400,
      message: `That time is another closer's. Pick one of ${first ? possessive(first) : "the closer's"} times.`,
    };
  }
  return null;
}
