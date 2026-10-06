// The room's deadlines as the sweep's R4 reads them, shared by the room
// panel (rooms.ts) and the dialer's step under it (dialerUi.ts), so the two
// never disagree about a room that should have closed (m1 round 4,
// overdue-room-step-says-wait-for-them). No imports from rooms.ts or
// dialerUi.ts: both import this.

/** The waits the screens read (`rooms.waits_s`, `live.closer_wait_s`). */
export const WAITS_S = {
  manual_buttons: 30,
  not_lead_undo: 300,
  standby_max: 2100,
  offer: 120,
  /** The lead's 10 minutes, and the 3 minutes an open or a knock holds the room past them (the sweep's R4). */
  lead: 600,
  open_grace: 180,
} as const;

/** How long past its deadline a room may sit before the panel says the sweep is late. */
export const OVERDUE_MS = 120_000;

/** What the deadlines read of a room (RoomView, or the dialer's copy of it). */
export interface DeadlineRoom {
  state: string;
  purpose?: string | null;
  contact_id?: string | null;
  lead_by?: string | null;
  host_by?: string | null;
  ends_at?: string | null;
  created_at?: string | null;
  link_sent_at?: string | null;
  last_link_at?: string | null;
  first_open_at?: string | null;
  last_open_at?: string | null;
  lead_waiting_at?: string | null;
}

function t(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

/**
 * When the lead's wait ends as the sweep's R4 reads it: lead_by, held
 * open_grace past the lead's latest open of the link or knock, never past
 * the cap (the link, or the room's start, plus the lead's 10 minutes and one
 * grace; a booked room's end). The panel's countdown and its "overdue" use
 * it, so a lead at the door is never "should have closed" (stress2, round 1).
 */
export function leadDeadline(room: DeadlineRoom): number | null {
  const lead = t(room.lead_by);
  if (lead === null || !room.contact_id) return lead;
  const grace = WAITS_S.open_grace * 1000;
  // From the latest send of the link (a later channel's email promises its
  // own ten minutes, stress2 round 5), as the sweep's R4 reads it.
  const sent = [t(room.link_sent_at), t(room.last_link_at ?? null)].filter(
    (x): x is number => x !== null,
  );
  const base =
    room.purpose === "booked"
      ? t(room.ends_at)
      : sent.length
        ? Math.max(...sent)
        : t(room.created_at);
  const cap =
    base === null
      ? Number.POSITIVE_INFINITY
      : room.purpose === "booked"
        ? base
        : base + (WAITS_S.lead + WAITS_S.open_grace) * 1000;
  const held = (x: number | null) =>
    x === null ? Number.NEGATIVE_INFINITY : Math.min(x + grace, cap);
  const open = t(room.last_open_at ?? null) ?? t(room.first_open_at);
  return Math.max(lead, held(open), held(t(room.lead_waiting_at)));
}

/** When the room closes if nothing happens: the lead's or the host's deadline. */
export function roomDeadline(room: DeadlineRoom): number | null {
  if (room.state === "open") {
    const lead = leadDeadline(room);
    const host = t(room.host_by);
    if (lead !== null && host !== null) return Math.min(lead, host);
    return lead ?? host;
  }
  if (room.state === "host_in") return leadDeadline(room);
  return null;
}
