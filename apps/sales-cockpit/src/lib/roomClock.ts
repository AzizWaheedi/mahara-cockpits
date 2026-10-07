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
  /** The room's open, the host's join and the link's claim and refusal: R4's own clock when lead_by is unset (m1 round 5). */
  opened_at?: string | null;
  host_in_at?: string | null;
  link_claimed_at?: string | null;
  refusal?: string | null;
}

/** A link still tried again holds the lead's ten minutes this long after its claim (sales-api LINK_RETRY_HOLD_S). */
const LINK_RETRY_HOLD_MS = (600 + 120) * 1000;
/** The host's wait for a room with a lead when host_by is unset (rooms.waits_s.fallback_host). */
const HOST_WAIT_MS = 900 * 1000;

function t(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

const videoLink = (room: DeadlineRoom) =>
  room.purpose === "manual" || room.purpose === "fallback";

/**
 * The cap on the grace an open or a knock adds (the sweep's R4 cross join
 * c): the latest send of the link, else the room's open, plus the lead's 10
 * minutes and one grace, and never before the lead's ten minutes as they
 * started plus one grace (m1 round 5: a link left to the rep starts them at
 * the refusal); a booked room's end.
 */
function graceCap(room: DeadlineRoom): number {
  if (room.purpose === "booked")
    return t(room.ends_at) ?? Number.POSITIVE_INFINITY;
  const sent = [t(room.link_sent_at), t(room.last_link_at ?? null)].filter(
    (x): x is number => x !== null,
  );
  const base = sent.length
    ? Math.max(...sent)
    : (t(room.opened_at ?? null) ?? t(room.created_at));
  const fromLink =
    base === null
      ? Number.POSITIVE_INFINITY
      : base + (WAITS_S.lead + WAITS_S.open_grace) * 1000;
  // Only a link left to the rep (none went): a link that went keeps its own
  // cap, so a lead_by moved by opens never pushes it on.
  const lead = videoLink(room) && !sent.length ? t(room.lead_by) : null;
  return lead === null
    ? fromLink
    : Math.max(fromLink, lead + WAITS_S.open_grace * 1000);
}

/**
 * When the lead's wait ends as the sweep's R4 reads it (roomlogic.ts
 * timers()): lead_by, else the link, the host's join or the room's open
 * plus the lead's 10 minutes (m1 round 5,
 * m1-time-r5-unsent-room-deadline-said-as-host-by: a link read out sets no
 * lead_by, and R4 closes at the open + 10), raised to the hold of a link
 * still tried again, and held open_grace past the lead's latest open of the
 * link or knock, never past the cap. The panel's countdown and its
 * "overdue" use it, so a lead at the door is never "should have closed"
 * (stress2, round 1).
 */
export function leadDeadline(room: DeadlineRoom): number | null {
  if (!room.contact_id) return t(room.lead_by);
  const opened = t(room.opened_at ?? null) ?? t(room.created_at);
  const from =
    t(room.link_sent_at) ??
    (room.state === "host_in" ? t(room.host_in_at ?? null) : null) ??
    opened;
  let lead =
    t(room.lead_by) ?? (from === null ? null : from + WAITS_S.lead * 1000);
  if (lead === null) return null;
  const claimed = t(room.link_claimed_at ?? null);
  if (
    !room.link_sent_at &&
    claimed !== null &&
    /tried again in a minute\.?$/i.test(String(room.refusal ?? "").trim())
  )
    lead = Math.max(lead, claimed + LINK_RETRY_HOLD_MS);
  const grace = WAITS_S.open_grace * 1000;
  const cap = graceCap(room);
  const held = (x: number | null) =>
    x === null ? Number.NEGATIVE_INFINITY : Math.min(x + grace, cap);
  const open = t(room.last_open_at ?? null) ?? t(room.first_open_at);
  return Math.max(lead, held(open), held(t(room.lead_waiting_at)));
}

/**
 * The host's wait as the sweep's R3 reads it: host_by (else the open plus
 * the host's wait), and for a video-link room with a lead never before the
 * lead's ten minutes and their grace once they started (m1 round 5).
 */
function hostDeadline(room: DeadlineRoom): number | null {
  const opened = t(room.opened_at ?? null) ?? t(room.created_at);
  const host =
    t(room.host_by) ?? (opened === null ? null : opened + HOST_WAIT_MS);
  const lead = t(room.lead_by);
  if (host === null || lead === null || !room.contact_id || !videoLink(room))
    return host;
  return Math.max(host, lead + WAITS_S.open_grace * 1000);
}

/** When the room closes if nothing happens: the lead's or the host's deadline, whichever the sweep reaches first. */
export function roomDeadline(room: DeadlineRoom): number | null {
  if (room.state === "open") {
    const lead = leadDeadline(room);
    const host = hostDeadline(room);
    if (lead !== null && host !== null) return Math.min(lead, host);
    return lead ?? host;
  }
  if (room.state === "host_in") return leadDeadline(room);
  return null;
}
