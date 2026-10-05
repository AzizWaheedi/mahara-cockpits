// sales-api's live-call actions (contract v2, 3 October 2026): video rooms,
// availability, the handover take, and room.event, the one way the room
// worker, the door (sales-live) and the SQL sweep reach sales-api.
//
// What each action decides comes from roomlogic.ts; this file reads, writes
// and calls out. Every write to a room is a conditional PATCH built from
// roomlogic's `expect` (guardFilter), read again and tried again at most
// MAX_WRITE_TRIES times, and its effects run only when the write landed.
// Every action leaves an audit row; every outside call has a timeout
// (liveio.ts); nothing here ever reads or returns a host's start link except
// room.open, to the host.
//
// index.ts builds it with makeRooms(deps) and spreads its three lists into
// ACTIONS (seats), DESK_ACTIONS (the service key) and CRON_ACTIONS.
//
//   bun test supabase/functions/sales-api

import { ghlTime } from "./dialer.ts";
import { healthSince, queuedTemplatesQuery, templateMayBeQueued } from "./sendrules.ts";
import { cleanText, greetingName, redact, slackSafe, type Who } from "./lib.ts";
import { ApiRefusal, DbError, GhlError, isUnique, type LiveIO, uuidFrom } from "./liveio.ts";
import {
  adoptRefusal,
  type Applied,
  COUNT_STUCK_S,
  REASK_AFTER_S,
  REASK_WINDOW_S,
  applyRoomEvent,
  type CallKind,
  type Changed,
  channelPlan,
  type CountBefore,
  countClaim,
  countClaimable,
  countInFlight,
  countLive,
  type CountPlan,
  countUndo,
  countUndone,
  type CountInput,
  emailPossible,
  admitBlockedAllowed,
  carriesIntro,
  createRefusal,
  defaultProvider,
  inIntroWindow,
  kuwaitClock,
  clockWithDay,
  type Effect,
  END_REASONS,
  fill,
  guardFilter,
  heldContacts,
  type HostFacts,
  isCallKind,
  isFinal,
  isProvider,
  isPurpose,
  isTestContact,
  isUuid,
  LANE_COPY,
  leadJoined,
  linkDue,
  liveWindow,
  outsideHoursText,
  type LinkChannel,
  markEvent,
  MAX_WRITE_TRIES,
  ms,
  newRoomRow,
  noShowDoubt,
  phoneSince,
  otherProvider,
  type Provider,
  providerName,
  providerRefusal,
  type Purpose,
  REPLAY_MAX_AGE_S,
  type RefusalCode,
  type Refused,
  refuse,
  ROOM_COPY,
  ROOM_MARKS,
  type RoomEvent,
  type RoomRow,
  type RoomsSetting,
  holdUntil,
  roomCtx,
  roomForThisStart,
  roomsHealth,
  roomsSetting,
  type SettleFacts,
  settleWanted,
  shortUrl,
  standbyEmpty,
  standbyToEnd,
  sweepRoom,
  toRoomView,
  TRIGGERS,
  wrapPlan,
  workerDown,
  wrapRoomRow,
  type ZoomEvent,
  zoomCode,
  zoomEffect,
  zoomMeetingId,
} from "./roomlogic.ts";

type Row = Record<string, unknown>;
type Action = (who: Who, b: Row) => Promise<Row>;

/**
 * An event a run works on: by id or dedupe key. `token` is the lease this run
 * holds (rooms.ts lease): a string, null for a lease taken with no token (a
 * database without 20261004a), or absent when the database took the lease as
 * it stored the event (live.claimed).
 */
type EventKey = { id?: string; dedupe_key?: string; token?: string | null };

/** The link's lease as one run holds it (rooms.ts linkLease): when it was last renewed, and whether this run may only resume. */
type LinkHold = EventKey & { dedupe_key: string; renewed: number; resumeOnly: boolean; lost?: true };

/**
 * A send found in the lead's conversation (index.ts whatsappSentSince's hit):
 * HighLevel's message id and its status, so a link confirmed from the
 * conversation can be read again later (stress2 round 3).
 */
export type SeenSend = { id: string | null; status: string | null };

/** How a count run ended: it holds the claim, another count (or the row) took it, or it stopped before claiming. */
type CountRun = "claimed" | "taken" | "skipped";

/** What one channel's send came to (rooms.ts sendOn). */
type SendOutcome =
  | { ok: true; message_id: string | null; unseen: boolean }
  | { ok: false; why: string; status: number; inflight?: true; stopped?: true; unclear?: true; since?: number; text?: string | null; request_id?: string };

/**
 * How long a send may still be running when it is asked for again: HighLevel's
 * answer (25 s at most), the read-back (20 s) and the database writes. A
 * repeat that finds its row still "sending" after this was orphaned.
 */
const SEND_BUDGET_MS = 90_000;

/**
 * How long one step of a room's link cascade holds the link (stress2 round
 * 3, link-lease-runs-out-mid-cascade). The cascade makes up to three sends
 * one after another (the free text, the template, the email or the unseen
 * template's backup), each with its own HighLevel reads, write and
 * read-back, so one lease of a send's budget ran out under it. The lease is
 * taken for SEND_BUDGET_MS (the reads before the first send) and renewed for
 * this before each channel (linkStep): twice a send's budget, so a step whose
 * setup reads crawl never loses it, and a run cut off mid-step keeps the link
 * for at most this long.
 */
const LINK_STEP_S = 180;

/**
 * Columns of cockpit_sales_rooms that only 20261004a adds. sales-api may be
 * deployed before that migration is applied: a write naming one is made again
 * without it (rooms.ts patchRoom), as the other 20261004a columns fall back.
 */
const ROOM_COLUMNS_004A = ["meeting_ended_at"];

/** A room's timeline lines room.status always returns, whatever came after them. */
const KEY_LINES = [
  "link.sent",
  "link.not_sent",
  "link.unconfirmed",
  "link.failed_late",
  "door.open",
  "room.mark.host_in",
  "room.mark.lead_in",
  "room.mark.not_lead",
  "room.end",
];

/**
 * HighLevel's appointment in an answer: under `appointment`, under `event`,
 * or the answer itself; null when nothing in it is an appointment (a
 * gateway's empty 200, an HTML page passed through), never read as one with
 * no link or no status (stress2, round 2).
 */
export function appointmentOf(out: unknown): Row | null {
  const o = obj(out);
  const a = obj(o.appointment ?? o.event ?? o);
  return a.id || a.startTime || a.appointmentStatus || a.calendarId ? a : null;
}

/** "10:00 on Mon 5 Oct" (Kuwait) for a stored time, or the time as given when it does not read. */
function whenKuwait(v: unknown): string {
  const t = Date.parse(String(v ?? ""));
  // Always with its day: "now" a day later, so the day is said.
  return Number.isFinite(t) ? clockWithDay(t, t + 2 * 86_400_000) : String(v ?? "its booked time");
}

/** How long after a free-text link went the tick reads its message again for a late failure. */
const LINK_RECHECK_MS = 15 * 60_000;

/** A lead HighLevel called gone is read once more this long after, and a second "gone" is final. */
const GONE_AGAIN_MS = 60_000;

/**
 * HighLevel's answer says the contact is not there: a 404, or a 400 or 422
 * whose words say so. Any other 4xx (a gateway's "Bad Request", "Version
 * header is not valid" during a deploy) is not an answer about the contact.
 */
export function contactGoneAnswer(status: number, message: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 422) return false;
  return /not\s*found|does\s*not\s*exist|doesn'?t\s*exist|no\s+such\s+contact|deleted|merged|invalid\s+contact\s*id/i.test(String(message ?? ""));
}

/** A room the lead joined within this many hours of another room's join is the same conversation for the count. */
const SIBLING_JOIN_H = 3;

/**
 * How many leased tries the settle gives HighLevel to take its no-show
 * before a person is told (the sweep's own give-up, E0, comes at ten).
 */
const SETTLE_CRM_TRIES = 5;
/** A mark still "pending" this long after it was written was cut off before HighLevel answered (index.ts CRM_PENDING_STUCK_MS). */
const CRM_PENDING_STUCK_MS = 120_000;


/** A call that starts this soon after the join (the lead came a little early) is still the call the join is. */
const CURRENT_CALL_GRACE_MS = 5 * 60_000;

/** A call B2B already counts as held: showed, or invalid (disqualified). The count never marks over either. */
const HELD_STATUSES = ["showed", "invalid"];

/** Fresh request ids a room's link may use on one channel after HighLevel refused a send outright (rooms.ts linkKeys). */
const LINK_RETRIES = 3;

const S = 1000;
const enc = encodeURIComponent;
const ROOMS = "cockpit_sales_rooms";
const EVENTS = "cockpit_sales_room_events";
/** At most this many rooms' links go to one lead in LINK_FLOOD_WINDOW_MS (final review). */
const LINK_FLOOD_MAX = 3;
const LINK_FLOOD_WINDOW_MS = 60 * 60_000;
/** Rooms a seat may ask for (room.create): per lead an hour, per seat in ten minutes and in an hour (stress2, round 1). */
const ROOMS_PER_LEAD_HOUR = 4;
const ROOMS_PER_SEAT_10M = 8;
const ROOMS_PER_SEAT_HOUR = 30;
/** One standby room per seat in each STANDBY_BUCKET_MS, and at most STANDBY_PER_HOUR an hour (final review). */
const STANDBY_BUCKET_MS = 10 * 60_000;

/** How long live.status still lists a lead's room that failed or closed on a knock (the banner's call to act). */
const RECENT_FINAL_MS = 15 * 60_000;
const STANDBY_PER_HOUR = 4;
/** The sources room.event's replay takes (the SQL sweep's own list less slack, whose presses are not built). */
const REPLAY_SOURCES = new Set(["zoom", "worker", "claim"]);
const LIVE_STATES = "requested,creating,open,host_in,lead_in";
/** The sales sub-account in HighLevel (index.ts LOCATION). */
const LOCATION = "7NI8yyJtwsh2OOWA5Icr";

/** live.take, live.decline and live.press while live.enabled is false. */
export const LIVE_OFF = "Live handover is not switched on yet.";
/** finishClaim's mark on an answer whose handover could not be pointed at its room yet (never sent to a browser). */
const UNLINKED = "__unlinked";

/** The offer is gone (taken, ended, never yours): the strip's "gone". */
export const OFFER_GONE = "This offer has ended.";

/** The note on the live count's showed mark of a booked call (its undo and its read-back know it by this). */
export const COUNT_MARK_NOTE = "Joined the video room.";

/** The note on the settle's no-show (index.ts markAppointment keeps it on the disposition). */
export const SETTLE_NOTE = "Nobody joined the video room, so the intro is marked a no-show.";

/** The words room.event and the screens use that roomlogic does not hold. */
export const ROOMS_COPY = {
  room_missing: "That room is not here any more. Reload the page.",
  live_missing: OFFER_GONE,
  claim_busy: "The lead has a booked call open, so no room was made.",
  claim_locked: "Someone is taking this lead right now. Try again in a moment.",
  not_yet: "Demo chats are not built yet, so there is nothing to tick.",
  reply_not_yet: "Reply alerts are not built yet.",
  status_unread: "The room worker's status could not be read. Try again in a minute.",
  contact_unread_send: "HighLevel did not answer, so the link has not gone yet. It is tried again in a minute.",
  /** HighLevel answered that the lead is gone (merged or deleted): never retried. */
  contact_gone_send:
    "This lead is not in HighLevel any more (merged or deleted), so the link did not go. Find them again in the cockpit and send it from there",
  all_failed: "the link did not go on any channel ({why})",
  /** room.create with purpose standby: only I'm available makes one (stress2, round 1). */
  standby_by_availability: "A standby room is made when you press I'm available. Press it on the strip instead.",
  /** room.create past the per-lead cap. */
  room_flood_lead: "This lead has had four video rooms in the last hour, so no new one was made. Call them on the phone instead.",
  /** room.create past the per-seat cap. */
  room_flood_seat: "You have asked for many video rooms in a short time, so no new one was made. Wait a few minutes, or call the lead on the phone.",
  /** One lead is never flooded with call links (final review, room-link-loop-floods-lead). */
  link_flood: "This lead has had three call links this hour, so no new one went. Read the code out on the phone.",
  /** room.create for a lead who has had three call links this hour (stress2, round 2). */
  link_flood_create: "This lead has had three call links this hour, so no new room was made. Call them again later.",
  handover_only_claimed: "Take the live lead first. A handover room is made for the closer who took it.",
  ask_not_yet: "Asking for a live handover is not built yet. Book the call for now.",
  /** A send whose answer was lost: it may have reached the lead, so nothing else goes until a person checks. */
  may_have_gone_whatsapp: "The link may have gone on WhatsApp. Check the conversation before sending it again, or read it out",
  may_have_gone_email: "The link may have gone by email. Check the conversation before sending it again, or read it out",
  /** Also send by email pressed again while the first press's email is still going. */
  email_on_its_way: "The email is still on its way. Check the conversation in a minute before sending it again.",
  /** The timeline line when a seat's empty standby room is ended for a lead's room. */
  standby_for_lead: "Your standby room was closed so you could send a lead a video link. Press Get my room on the strip after the call.",
  /** I can't let them in, while the host cannot use the other provider: the room stays open (stress2, round 1). */
  admit_no_other: "{other} cannot be used from your seat yet, so this room stays open. Keep trying to let them in on {provider}, or call the lead now.",
  /** I can't let them in: the room was closed and its replacement could not be made in this request. */
  replacement_not_made: "The {provider} room could not be made yet. Press Try {provider}.",
  count_unclear_alert:
    "Room {code}: HighLevel may have made the live booking, but its answer was lost and no booking could be found. Check the lead's calendar before anyone books by hand.",
  /** The count's move of the lead's booked call whose answer was lost and could not be read back (stress2, round 2). */
  count_move_unclear_alert:
    "Room {code}: the lead's booked call may have been moved to now, but HighLevel's answer was lost. Check the call in HighLevel; it was booked for {from}.",
  /** "That was not the lead" during an unclear move, and the move could not be put back. */
  count_move_back_alert:
    "Room {code}: That was not the lead was pressed, and the lead's booked call may have been moved to now. Move it back to {from} in HighLevel.",
  mark_intro_alert: "Room {code}: the booked intro was not marked a no-show because {why}. Mark it shown or a no-show.",
  /** The {why} in mark_intro_alert when the settle's no-show was refused for good. */
  settle_refused_why: "the no-show could not be written",
  /** The {why} in mark_intro_alert when HighLevel never took the settle's no-show. */
  settle_crm_why: "HighLevel did not take the no-show, so it still says the intro is booked",
  undo_unknown_alert:
    "Room {code}: That was not the lead was pressed, but the count's record of how the call was before is missing, so nothing was put back. Put the call back by hand in HighLevel.",
  count_confirm_manager: "Only a manager can count a join that was marked by hand.",
  count_confirm_off: "Live calls are not counted at the join yet, so there is nothing to confirm.",
  count_confirm_nothing: "This join is not waiting to be confirmed. Reload the room.",
  count_confirm_taken: "This join was counted a moment ago. Reload the room.",
  standby_too_late: "Live calls end in under {minutes} minutes, so no standby room was made. You can still take a live lead until then.",
  /** Available pressed again soon after Away (final review, standby-flood). */
  /** The sweep closed the standby room: nobody pressed I'm in (live.status). */
  standby_host_not_in:
    "Your last standby room closed at {at} because nobody pressed I'm in. Press Try again, then I'm in once you are in the room.",
  /** The same on Zoom: Zoom did not see the host join, and the strip offers I'm in after 30 s of Zoom silence (stress2, round 2). */
  standby_host_not_in_zoom:
    "Your last standby room closed at {at} because Zoom did not see you join and nobody pressed I'm in. Press Try again, join the room, then press I'm in if the strip still asks you to join.",
  standby_flood: "Your last standby room closed under 10 minutes ago, so no new one was made yet. Try again in a few minutes. You can still take a live lead now.",
  /** The timeline line of a standby room Away closed (stress2 round 3). */
  standby_away: "Your standby room was closed because you set yourself away.",
  /** I'm available inside booked_guard of the seat's own booked call (stress2, round 2). */
  standby_booked_soon: "Your booked call at {at} starts soon, so no standby room was made. Press I'm available again after it.",
  count_confirm_alert:
    "Room {code}: {name} joined, but only a press of The lead is in says so. A manager counts it from the room panel, or leaves it uncounted.",
  undo_stuck_alert: "Room {code}: That was not the lead was pressed, and the live booking could not be taken back in HighLevel. Remove it by hand.",
  showed_failed_alert: "Room {code}: the live call was counted, but HighLevel did not take its showed status. Mark it shown in HighLevel.",
  /** The count marked the lead's booked call shown in the cockpit and HighLevel did not take it. */
  count_mark_crm_alert:
    "Room {code}: the lead joined and the booked call was marked shown in the cockpit, but HighLevel did not take it, so the show rate still counts it as not shown. Mark it shown in HighLevel.",
  /** The count found the room's intro moved in HighLevel since the room was made. */
  count_mark_moved_alert:
    "Room {code}: the lead joined, but their booked intro was moved in HighLevel after this room was made, so it was not marked. Mark the intro shown or move it back.",
  /** The count's mark of the booked call was refused (a join long before its start). */
  count_mark_refused_alert:
    "Room {code}: the lead joined, but their booked intro could not be marked shown yet (a call can be marked shown from 10 minutes before its start). Mark it shown once it starts.",
  /** The count's mark of the booked call whose answer was lost and could not be read back. */
  count_mark_unclear_alert:
    "Room {code}: the lead joined and the booked call may have been marked shown, but the answer was lost. Check the call in the dialer and in HighLevel.",
  count_unread_alert: "Room {code}: the lead joined, and the lead's booked calls could not be read, so nothing was counted yet. Check HighLevel.",
  /** A count claimed over 2 minutes ago with no result, by what it was doing (stress2 round 3). */
  count_stuck_mark:
    "Room {code}: the lead joined their booked intro, and marking it shown has not finished after 2 minutes. Mark the booked intro shown in the dialer.",
  count_stuck_move:
    "Room {code}: the lead joined, and moving their booked call to the join has not finished after 2 minutes. Check the call's time in HighLevel and mark it shown in the dialer.",
  count_stuck_book:
    'Room {code}: the lead joined, and booking the live call has not finished after 2 minutes. Look for a "Live" booking on this lead in HighLevel, and book it by hand if there is none.',
  /** The count's mark of the booked intro wrote nothing (the database or HighLevel blinked) and is asked again each minute. */
  count_mark_retry_alert:
    "Room {code}: the lead joined, and their booked intro could not be marked shown yet. It is tried again each minute; if this stays, mark the intro shown in the dialer.",
  /** The lead's contact could not be read for the count (stress2, round 2). */
  count_contact_unread_alert:
    "Room {code}: the lead joined, and HighLevel could not read the lead's contact, so nothing was counted yet. It is tried again each minute; if this stays, mark the call by hand.",
  /** HighLevel says the lead's contact is gone (merged or deleted). */
  count_contact_gone_alert:
    "Room {code}: the lead joined, but HighLevel says their contact was merged or deleted, so nothing was counted. Find the lead in HighLevel and mark the call by hand.",
  count_other_rep_alert:
    "Room {code}: the lead joined, and their call is booked with another rep, so it was neither moved nor marked here. That rep or a manager marks it.",
} as const;

/** Timeline lines this file writes (room_events.text): plain, no names, no links. */
export const EVENT_TEXT = {
  asked: "A {provider} room was asked for.",
  wrapped: "The booked call's own {provider} link was put in this room.",
  mark_host_in: "Marked by hand: the host is in.",
  mark_lead_in: "Marked by hand: the lead is in.",
  mark_not_lead: "Marked by hand: that was not the lead.",
  mark_still_on: "Marked by hand: still on the call.",
  ended: "Room ended by hand ({reason}).",
  link_sent: "Link sent on WhatsApp.",
  link_sent_email: "Link sent by email.",
  link_unconfirmed: "The WhatsApp template was not seen in time, so the link went by email too.",
  link_unconfirmed_no_email: "WhatsApp did not confirm the template and the email did not go. Read the link out.",
  link_unconfirmed_email_unclear: "WhatsApp did not confirm the template and the email may have gone. Check the conversation, or read the link out.",
  link_failed_late: "WhatsApp failed the link after it was sent, so it went by email.",
  link_failed_late_no_email: "WhatsApp failed the link after it was sent, and no email could go. Read the link out.",
  not_sent: "Not sent: {why}.",
  counted: "Counted in HighLevel: {what}.",
  undone: "The live booking was taken back.",
  settled: "The booked intro was marked a no-show: nobody joined.",
  settle_skipped: "Not settled: {why}.",
} as const;

/** A timeline line for an event stored without one (contract v2, defect 8). */
const KIND_TEXT: Record<string, string> = {
  "worker.ready": "The room was made.",
  "worker.failed": "The room could not be made.",
  "worker.create_sent": "The room worker asked for the meeting.",
  "worker.closing": "The room worker is closing the meeting.",
  "worker.held": "The meeting was kept open: someone was still in it.",
  "report.checked": "Zoom's report was checked against the room.",
  "zoom.meeting.started": "Zoom: the meeting started.",
  "zoom.meeting.ended": "Zoom: the meeting ended.",
  "zoom.meeting.deleted": "Zoom: the meeting was deleted.",
  "zoom.meeting.participant_joined": "Zoom: someone joined.",
  "zoom.meeting.participant_left": "Zoom: someone left.",
  "zoom.meeting.participant_joined_waiting_room": "Zoom: someone is in the waiting room.",
  "zoom.meeting.participant_jbh_waiting": "Zoom: someone is waiting for the host.",
  "zoom.meeting.participant_jbh_joined": "Zoom: someone joined before the host.",
  "live.claimed": "A closer took this lead live.",
  "live.replaced": "Closed: a closer took this lead live in another room.",
  "door.open": "The lead opened the link.",
};

export function eventText(e: { kind?: unknown; text?: unknown; source?: unknown }): string {
  const t = typeof e.text === "string" ? e.text.trim() : "";
  if (t) return redact(t);
  const kind = String(e.kind ?? "");
  if (KIND_TEXT[kind]) return KIND_TEXT[kind];
  if (kind.startsWith("sweep.")) return "The sweep closed or checked this room.";
  if (kind.startsWith("zoom.")) return "Zoom sent an event for this room.";
  return "Something changed in this room.";
}

// ---------------------------------------------------------------------------
// What index.ts hands in
// ---------------------------------------------------------------------------

export interface MarkOpts {
  reason?: string | null;
  note?: string | null;
  anyRep?: boolean;
  /** The mark changes the status in HighLevel without its automations. */
  quiet?: boolean;
  /**
   * A timer's mark: written only where no mark stands, in the same step
   * (insert without superseding; the one-current-mark index refuses a second).
   * A person's mark is never superseded by it: refused with code "marked".
   */
  onlyIfUnmarked?: boolean;
}

export interface SendTextInput {
  contact_id: string;
  channel: "whatsapp" | "email";
  body: string;
  subject?: string | null;
  request_id: string;
}

export interface SendTemplateInput {
  contactId: string;
  key: string;
  line: string;
  requestId: string;
  followupId: string | null;
  source?: "rep" | "followup" | "room" | "thread";
  /** Sign as this seat (the room's host), not the lead's owner. */
  signAs?: string | null;
  /** The URL button's variable, written to the contact field first. */
  buttonVariable?: { join_code: string } | null;
  /** How long the send is read back before it counts as not seen. */
  readBackMs?: number;
  values?: { call_time?: string | null };
}

export interface RoomDeps {
  io: LiveIO;
  audit(
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ): Promise<void>;
  markAppointment(who: Who, id: string, status: string, opts: MarkOpts): Promise<Row>;
  sendText(who: Who, b: SendTextInput, opts: { source: "room"; readBackMs?: number }): Promise<{ message: Row; repeated?: boolean }>;
  sendTemplate(who: Who, o: SendTemplateInput): Promise<{ message: Row; repeated?: boolean }>;
  /**
   * The lead's next intro or demo booked ahead (index.ts upcoming), with its
   * end, rep and status when HighLevel gives them. `booked_before`: only a
   * call booked (HighLevel's dateAdded) before that moment, so a count that
   * runs late reads the calls as they stood at the join (fix round 4).
   */
  upcoming(
    contactId: string,
    kind: CallKind,
    opts?: { booked_before?: number | null; after?: number | null },
  ): Promise<{
    id: string;
    start: number;
    end?: number | null;
    assigned_user_id?: string | null;
    status?: string | null;
    booked_at?: number | null;
  } | null>;
  /**
   * Whether a WhatsApp message with these words reached the lead's
   * conversation since `since` (index.ts whatsappSentSince): true, false,
   * or null when the conversation could not be read. Used after a send whose
   * outcome was lost, before anything else goes.
   */
  sentSince?(contactId: string, since: number, text: string | null): Promise<SeenSend | boolean | null>;
  /**
   * The call's current mark written to HighLevel again, quietly (index.ts
   * resendMark, as mark.retry does): for the settle's own no-show whose
   * HighLevel write failed, or was cut off while "pending". Answers the mark
   * with its crm as it is now.
   */
  resendMark?(who: Who, appointmentId: string): Promise<Row>;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** A short status word, or null when there is none. */
const str20 = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, 20) : null;
};
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const isoAt = (t: number) => new Date(t).toISOString();

/** A roomlogic refusal as the answer: its sentence, status and code (desk callers also read retry and cleanup). */
export function asRefusal(r: Refused): ApiRefusal {
  return new ApiRefusal(r.message, r.status, { code: r.code, retry: r.retry, cleanup: r.cleanup });
}
function no(code: RefusalCode, vars: Record<string, string | number | null | undefined> = {}): ApiRefusal {
  return asRefusal(refuse(code, vars));
}
function plain(message: string, status: number, code: string, extra: Row = {}): ApiRefusal {
  return new ApiRefusal(message, status, { code, retry: false, cleanup: false, ...extra });
}

function requestIdOf(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!isUuid(s)) throw plain("Reload the page and try again.", 400, "bad_input");
  return s;
}
/**
 * A request id a seat sent, kept apart from every id the server makes or
 * derives (final review, handover-request-id-squat): the handover's own id,
 * a replacement room's and a link message's keys are all readable or
 * computable by any seat, so a seat's id is stored as a hash of its email and
 * its id. The same press repeated is the same id; it can never be one of the
 * server's.
 */
export async function seatRequestId(who: { email?: string | null }, v: unknown): Promise<string> {
  return await uuidFrom(`seat/${String(who.email ?? "").trim().toLowerCase()}/${requestIdOf(v)}`);
}
function roomIdOf(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!isUuid(s)) throw no("bad_input");
  return s;
}
function idList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out = [...new Set(list.map(x => String(x ?? "").trim().toLowerCase()).filter(isUuid))];
  if (!out.length || out.length > 50 || out.length !== new Set(list.map(x => String(x ?? "").toLowerCase())).size)
    throw no("bad_input");
  return out;
}

/** Kuwait's midnight that begins the day of `t`, as an instant. */
function kuwaitMidnight(t: number): string {
  const k = new Date(t + 3 * 3_600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3_600_000).toISOString();
}

/** Which language a lead reads (the desk's list of Arabic-speaking countries, ISO codes). */
const ARABIC = new Set(["sa", "kw", "ae", "qa", "bh", "om", "eg", "jo", "iq", "lb", "sy", "ye", "ps", "ly", "tn", "dz", "ma", "sd"]);
export function leadLanguage(contact: Row | null): "ar" | "en" {
  const c = lower(contact?.country);
  return ARABIC.has(c) || /kuwait|saudi|emirates|qatar|bahrain|oman|egypt|jordan|iraq/.test(c) ? "ar" : "en";
}

/** Insert body without the nulls: the database's defaults fill them, and a column a later migration adds is never named early. */
function compact(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
}

// ---------------------------------------------------------------------------
// The lead's messages (English; the Arabic lines come under aziz-kuwaiti-voice)
// ---------------------------------------------------------------------------

export function leadText(
  room: Pick<RoomRow, "purpose" | "provider" | "appointment_id">,
  channel: "whatsapp_text" | "email",
  v: { first_name: string; rep: string; link: string },
): { subject: string | null; body: string } {
  const L = ROOM_COPY.lead_en;
  const vars = { first_name: v.first_name || "there", rep: v.rep, link: v.link, provider: room.provider === "zoom" ? "Zoom" : "Meet" };
  if (room.purpose === "fallback") {
    const line = fill(room.appointment_id ? L.fallback_booked : L.fallback_unbooked, vars);
    if (channel === "whatsapp_text") return { subject: null, body: line };
    return { subject: L.fallback_email_subject, body: `${line}\n\n${fill(L.fallback_email_sign, vars)}` };
  }
  if (room.purpose === "handover") {
    const line = fill(room.provider === "zoom" ? L.handover_zoom : L.handover_meet, vars);
    if (channel === "whatsapp_text") return { subject: null, body: line };
    return { subject: fill(L.handover_email_subject, vars), body: `${line}\n\n${L.handover_email_tail}` };
  }
  if (channel === "whatsapp_text") return { subject: null, body: fill(L.manual_whatsapp, vars) };
  return { subject: L.manual_email_subject, body: fill(L.manual_email_body, vars) };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export interface Rooms {
  /** Seat actions (ACTIONS). */
  actions: Record<string, Action>;
  /** Service-key actions (DESK_ACTIONS). */
  desk: Record<string, Action>;
  /** The desk actions the cron secret may also ask for (CRON_ACTIONS). */
  cron: string[];
  /** The contacts the dialer's queue leaves out now (roomlogic heldContacts). */
  held(now: number): Promise<Set<string>>;
}

export function makeRooms(deps: RoomDeps): Rooms {
  const { io } = deps;
  const DESK: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };

  // ------------------------------------------------------------- reading

  async function settingsOf(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await io.db(`cockpit_sales_settings?key=in.(${keys.map(enc).join(",")})&select=key,value`);
    return Object.fromEntries(rows.map(r => [String(r.key), r.value]));
  }
  async function roomsAndLive(): Promise<{ rooms: RoomsSetting; live: Row; raw: Record<string, unknown> }> {
    const raw = await settingsOf(["rooms", "live"]);
    return { rooms: roomsSetting(raw.rooms), live: obj(raw.live), raw };
  }
  const liveOn = (live: Row) => live.enabled === true;

  async function readRoom(id: string): Promise<RoomRow | null> {
    return ((await io.db(`${ROOMS}?id=eq.${enc(id)}&select=*`))[0] as unknown as RoomRow | undefined) ?? null;
  }
  async function mustRoom(id: string): Promise<RoomRow> {
    const r = await readRoom(id);
    if (!r) throw plain(ROOMS_COPY.room_missing, 404, "bad_input");
    return r;
  }
  async function personOf(email: string): Promise<Row | null> {
    if (!email || email === "sales-desk") return null;
    return (await io.db(`cockpit_sales_people?email=eq.${enc(email)}&select=email,name,name_ar,role,ghl_user_id,active`))[0] ?? null;
  }
  /**
   * The host seat as a Who, for marking and sending as them (glossary 1.5:
   * desk handlers act as the host). `strict`: a seat row that could not be
   * read throws, so a decision (the settle, the count) is asked again
   * later; only a row read with no HighLevel user is "no HighLevel user"
   * (stress2, round 2). A send signs as the seat either way.
   */
  async function hostWho(email: string, strict = false): Promise<Who> {
    const p = strict ? await personOf(lower(email)) : await personOf(lower(email)).catch(() => null);
    return {
      signed_in: true,
      seat: true,
      manager: p?.role === "manager",
      email: lower(email),
      name: (p?.name as string | null) ?? null,
      role: (p?.role as string | null) ?? null,
      ghl_user_id: (p?.ghl_user_id as string | null) ?? null,
    };
  }
  async function readContact(contactId: string): Promise<Row | null> {
    const c = await readContactOrGone(contactId);
    return c === "gone" ? null : c;
  }
  /**
   * The contact, null when HighLevel did not answer (an outage, a 5xx, a
   * 429: tried again later), or "gone" when HighLevel answered that it has
   * no such contact: a 404, or a 400 or 422 whose words say the contact is
   * missing, deleted or merged (stress2, round 1). Any other 400 or 422 (a
   * gateway's "Bad Request", "Version header is not valid" during a deploy)
   * says nothing about the contact: unread, asked again (stress2, round 2).
   */
  async function readContactOrGone(contactId: string): Promise<Row | null | "gone"> {
    try {
      const out = await io.ghl("GET", `/contacts/${enc(contactId)}`, undefined, "2021-07-28");
      const c = obj(out.contact);
      return Object.keys(c).length ? c : null;
    } catch (e) {
      if (e instanceof GhlError && contactGoneAnswer(e.status, e.message)) return "gone";
      io.log(`rooms: the contact could not be read: ${redact(String((e as Error)?.message ?? e))}`);
      return null;
    }
  }
  async function hostFacts(email: string, now: number): Promise<{ facts: HostFacts | null; row: Row | null }> {
    const row = (await io.db(`cockpit_sales_room_hosts?email=eq.${enc(email)}&select=*`))[0] ?? null;
    if (!row) return { facts: null, row: null };
    const until = ms(row.zoom_live_until);
    let live = until !== null && until > now;
    const checked = ms(row.checked_at);
    if (live && checked !== null) {
      // The host check read the live meeting while one of the host's own
      // cockpit Zoom rooms was open, and that room has closed since (stress2
      // round 3, host-check-counts-own-room-as-another-meeting): the meeting
      // it saw was most likely that room's own, so it holds nothing now.
      const own = await io
        .db(
          `${ROOMS}?host_email=eq.${enc(email)}&provider=eq.zoom&opened_at=lte.${enc(isoAt(checked))}&ended_at=gte.${enc(isoAt(checked))}&select=id&limit=1`,
        )
        .catch(() => []);
      if (own.length) live = false;
    }
    return {
      row,
      facts: {
        zoom_status: (["licensed", "basic", "pending", "missing"].includes(String(row.zoom_status))
          ? row.zoom_status
          : null) as HostFacts["zoom_status"],
        zoom_live: live,
        google_ok: row.google_ok === true,
        google_checked: typeof row.google_ok === "boolean",
      },
    };
  }
  async function appointment(id: string | null | undefined): Promise<Row | null> {
    if (!id) return null;
    return (await io.db(`cockpit_sales_appointments?appointment_id=eq.${enc(id)}&select=*`))[0] ?? null;
  }
  async function startsOf(rows: RoomRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map(r => r.appointment_id).filter((x): x is string => Boolean(x)))];
    if (!ids.length) return new Map();
    try {
      const appts = await io.db(
        `cockpit_sales_appointments?appointment_id=in.(${ids.map(i => `"${enc(i)}"`).join(",")})&select=appointment_id,start_at`,
      );
      return new Map(appts.map(a => [String(a.appointment_id), String(a.start_at ?? "")]));
    } catch {
      return new Map();
    }
  }
  async function views(rows: RoomRow[], setting: RoomsSetting): Promise<Row[]> {
    const starts = await startsOf(rows);
    return rows.map(r => toRoomView(r, { short_link: setting.short_link, starts_at: r.appointment_id ? starts.get(r.appointment_id) : null }) as unknown as Row);
  }
  async function view(r: RoomRow, setting: RoomsSetting): Promise<Row> {
    return (await views([r], setting))[0] as Row;
  }

  // ------------------------------------------------------------- writing

  /** The conditional write: lands only where the row still holds `expect`. */
  async function patchRoom(id: string, patch: Partial<RoomRow> | Row, expect: Partial<RoomRow> | Row): Promise<RoomRow | null> {
    const guard = guardFilter(expect);
    const write = async (body: Row) =>
      (
        (await io.db(`${ROOMS}?id=eq.${enc(id)}${guard ? `&${guard}` : ""}`, {
          method: "PATCH",
          body,
          prefer: "return=representation",
        }))[0] as unknown as RoomRow | undefined
      ) ?? null;
    try {
      return await write(patch as Row);
    } catch (e) {
      // A column only 20261004a adds, on a database without it yet (stress2
      // round 3, meeting-ended-write-needs-004a): the room is written without
      // it, so the change still lands; only what that column guards waits for
      // the migration.
      const col = e instanceof DbError ? ROOM_COLUMNS_004A.find(c => Object.hasOwn(patch, c) && e.message.includes(c)) : undefined;
      if (!col) throw e;
      io.log(`rooms: the database has no ${col} yet (apply 20261004a), so the room was written without it`);
      const { [col]: _left, ...rest } = patch as Row;
      return await write(rest);
    }
  }

  /**
   * Read, apply, write; a write someone else beat is read again and applied
   * again, at most MAX_WRITE_TRIES times, then "This changed a moment ago."
   * `make` builds the event from the row as read (a person's event carries
   * the version they saw, so a real change in between is refused).
   */
  async function applyLoop(
    id: string,
    make: (room: RoomRow) => RoomEvent | null,
    setting: RoomsSetting,
    first?: RoomRow | null,
  ): Promise<{ room: RoomRow; applied: Changed } | { room: RoomRow | null; refused: Refused }> {
    let room = first ?? (await readRoom(id));
    if (!room) return { room: null, refused: { ...refuse("bad_input"), message: ROOMS_COPY.room_missing, status: 404 } };
    const host = await personOf(lower(room.host_email)).catch(() => null);
    const ctx = { ...roomCtx(setting), host_first_name: greetingName(host?.name, null) || null };
    for (let i = 0; i < MAX_WRITE_TRIES; i++) {
      // make() decides on every try, from the row as it is now: null means
      // there is nothing to do any more (the row changed under the caller).
      const event = make(room);
      if (!event) return { room, applied: unchanged(room) };
      const a: Applied = applyRoomEventSafe(room, event, io.now(), ctx);
      if (!a.ok) return { room, refused: a };
      if (!a.changed) return { room, applied: a };
      let landed: RoomRow | null;
      try {
        landed = await patchRoom(room.id, a.patch, a.expect);
      } catch (e) {
        // The write's answer was lost (stress2 round 3,
        // zoom-join-lost-answer-no-audit): the room read again says whether
        // it landed. It did when the row now holds every value this write
        // set: the change is this run's, with its audit row and its effects,
        // never a replay's "nothing to do".
        if (!(e instanceof DbError && (e.status === 0 || e.status >= 500))) throw e;
        const back = await readRoom(id).catch(() => null);
        if (!back || !holdsPatch(back, a.patch as Row)) throw e;
        landed = back;
      }
      if (landed) return { room: landed, applied: { ...a, room: landed } };
      const again = await readRoom(id);
      if (!again) return { room: null, refused: { ...refuse("bad_input"), message: ROOMS_COPY.room_missing, status: 404 } };
      room = again;
    }
    return { room, refused: refuse("stale") };
  }

  /** The row holds every value of a write (times compared as instants, lists and objects as JSON). */
  function holdsPatch(row: RoomRow, patch: Row): boolean {
    const r = row as unknown as Row;
    return Object.entries(patch).every(([k, v]) => {
      const have = r[k] ?? null;
      const want = v ?? null;
      if (want === null || have === null) return want === have;
      if (typeof want === "object" || typeof have === "object") return JSON.stringify(want) === JSON.stringify(have);
      const a = ms(want);
      const b = ms(have);
      if (typeof want === "string" && a !== null && b !== null && /^\d{4}-\d{2}-\d{2}T/.test(want)) return a === b;
      return String(want) === String(have);
    });
  }

  /** One line on the room's timeline; never fatal. */
  async function note(roomId: string | null, kind: string, text: string, detail: Row = {}, dedupe?: string): Promise<void> {
    try {
      await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: {
          room_id: roomId,
          kind,
          source: "sales-api",
          dedupe_key: (dedupe ?? `${kind}:${roomId ?? "none"}:${io.uuid()}`).slice(0, 300),
          handled_at: isoAt(io.now()),
          text: text.slice(0, 500),
          detail,
        },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    } catch (e) {
      io.log(`rooms: a timeline line was not stored: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  async function alertSet(e: Extract<Effect, { kind: "alert" }>, room: RoomRow, made: string | null = null): Promise<void> {
    const words =
      e.what === "booked_guard"
        ? `Room ${room.code}: the host's booked call is near and this room still has a lead in it or waiting. Tell the setter if cover is needed.`
        : fill(
            made === "count.marking"
              ? ROOMS_COPY.count_stuck_mark
              : made === "count.moving"
                ? ROOMS_COPY.count_stuck_move
                : ROOMS_COPY.count_stuck_book,
            { code: room.code },
          );
    try {
      await io.rpc("cockpit_sales_alert_set", {
        p_key: e.dedupe_key,
        p_on: true,
        p_kind: e.what === "booked_guard" ? "room_booked_guard" : "room_count_stuck",
        p_subject: `Room ${room.code}`,
        p_message: slackSafe(words),
        p_detail: { room_id: room.id, code: room.code },
      });
    } catch (err) {
      io.log(`rooms: an alert was not raised: ${redact(String((err as Error)?.message ?? err))}`);
    }
  }

  async function deleteSecret(roomId: string): Promise<void> {
    try {
      await io.db(`cockpit_sales_room_secrets?room_id=eq.${enc(roomId)}`, { method: "DELETE", prefer: "return=minimal" });
    } catch (e) {
      io.log(`rooms: the host link was not deleted: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  /**
   * What a landed change asks for (roomlogic Effect). The link, the count
   * and the undo run in the background (waitUntil), so a press or an event
   * is answered at once; each is idempotent, so a re-ask never doubles.
   * close_provider is the worker's; recover and refresh_standby are SQL's
   * under owner sql, so both are dropped here. `replace` is room.end's.
   */
  async function carryOut(room: RoomRow, effects: Effect[]): Promise<void> {
    for (const e of effects) {
      if (e.kind === "delete_secret") await deleteSecret(room.id);
      else if (e.kind === "send_link") io.background(sendLink(room.id));
      else if (e.kind === "claim_link") io.background(claimLinkNow(room.id));
      else if (e.kind === "count_live") io.background(runCount(room.id));
      else if (e.kind === "undo_count") io.background(runUndo(room.id));
      else if (e.kind === "alert" && e.what === "count_stuck") await countStuck(e, room);
      else if (e.kind === "alert") await alertSet(e, room);
    }
  }

  /**
   * A count claimed over COUNT_STUCK_S ago with no result (stress2 round 3,
   * count-claim-lost-answer-count-stuck-forever). With no record of a change
   * (count.marking, count.moving or count.creating) since its claim, the run
   * that claimed it stopped before it changed anything: the count is taken
   * up again under the same claim, one run at a time (an event lease); the
   * mark repeats safely, and a booking looks for itself first. With a record,
   * something may have changed: a person is told what to check, in words for
   * what the count was doing.
   */
  async function countStuck(e: Extract<Effect, { kind: "alert" }>, room: RoomRow): Promise<void> {
    const claim = ms(room.count_claimed_at);
    if (claim === null || !countInFlight(room)) return;
    let made: string | null | undefined;
    try {
      const rows = await io.db(
        `${EVENTS}?room_id=eq.${enc(room.id)}&kind=in.(count.moving,count.marking,count.creating)&at=gte.${enc(isoAt(claim - 5 * S))}&select=kind&order=at.desc&limit=1`,
      );
      made = rows[0] ? String(rows[0].kind) : null;
    } catch {
      made = undefined; // not read: a person is told, in the words for the room's own call
    }
    if (made === null) {
      io.background(resumeCount(room.id, String(room.count_claimed_at)));
      return;
    }
    await alertSet(e, room, made ?? (room.appointment_id ? "count.marking" : "count.creating"));
  }

  /** The stranded claim's count, run again under its own claim by one run at a time. */
  async function resumeCount(roomId: string, claimedAt: string): Promise<void> {
    const by: EventKey = { dedupe_key: `count.resume:${roomId}:${claimedAt}`.slice(0, 300) };
    try {
      await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: { room_id: roomId, kind: "count.resume", source: "sales-api", dedupe_key: by.dedupe_key, text: "The count was taken up again." },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      if (!(await lease(by, 150))) return;
    } catch (err) {
      io.log(`rooms: a stranded count was not taken up, the sweep asks again: ${redact(String((err as Error)?.message ?? err))}`);
      return;
    }
    try {
      await runCount(roomId, false, claimedAt);
    } finally {
      await releaseEvent(by);
    }
  }

  /**
   * The sweep's claim of a link that was due and never claimed (worker.ready
   * lost or given up): the same guarded write worker.ready makes (the
   * missing deadlines and link_claimed_at), so two ticks never both send.
   */
  async function claimLinkNow(roomId: string): Promise<void> {
    const { rooms: setting } = await roomsAndLive();
    const out = await applyLoop(roomId, r => (linkDue(r) ? { kind: "ready" } : null), setting);
    if ("applied" in out && out.applied.changed) {
      await deps.audit(DESK, "room.link.claim", ROOMS, out.room.id, { link_claimed_at: null }, {
        link_claimed_at: out.room.link_claimed_at ?? null,
      }, { why: "the link was due and never asked for" });
      await carryOut(out.room, out.applied.effects);
    }
  }

  // ------------------------------------------------------------- creating

  interface CreateAsk {
    who: Who;
    host: string;
    request_id: string;
    purpose: Purpose;
    provider: Provider;
    call_kind: CallKind;
    contact_id: string | null;
    trigger?: string | null;
    attempt_id?: string | null;
    appointment_id?: string | null;
    handover_id?: string | null;
    /**
     * The dialer item the room was asked from: "confirm" is a confirmation
     * call, never the intro's own call, so its room never carries the intro
     * (stress2, round 2); the appointment is still read for the scope check.
     */
    item_kind?: string | null;
    setting: RoomsSetting;
  }

  /** The room create path (room.create, a standby room, an admit_blocked replacement, a handover's room). */
  async function createRoom(a: CreateAsk): Promise<{ room: RoomRow } | { refused: Refused }> {
    const now = io.now();
    const repeat = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
    if (repeat) {
      if (lower(repeat.host_email) !== a.host) return { refused: refuse("bad_input") };
      // The insert landed and its answer was lost: finish its audit row and timeline line now.
      const asked = await io.db(`${EVENTS}?dedupe_key=eq.${enc(`room.asked:${repeat.id}`)}&select=id`).catch(() => [{}]);
      if (!asked.length) await recordCreate(a, repeat);
      return { room: repeat };
    }
    // The room worker is down (the VPS, its cron or its lock): no room can be
    // made, so the rep is told at once what to do instead (fix round 4),
    // never left on "Making your room" for the minute the sweep waits.
    // Read and answered: no row at all is a worker that never ran, and a row
    // that says it makes no rooms is a worker no room will be made by
    // (final review). Not readable: the room goes ahead (the sweep fails it
    // at a minute if no worker claims it), never refused on a blip.
    const status = await io.db("cockpit_sales_worker_status?worker=eq.sales-desk&job=eq.rooms&select=at,ok,detail").catch(() => null);
    if (status && (!status[0] || workerDown(status[0].at ?? null, now, status[0]))) return { refused: refuse("worker_down") };
    const read = a.contact_id ? await readContactOrGone(a.contact_id) : null;
    if (read === "gone") return { refused: refuse("contact_gone") };
    const contact = read;
    const [{ facts }, leadRooms, hostRooms, demos, appt] = await Promise.all([
      hostFacts(a.host, now),
      a.contact_id
        ? io.db(`${ROOMS}?contact_id=eq.${enc(a.contact_id)}&state=in.(${LIVE_STATES})&select=*`)
        : Promise.resolve([]),
      io.db(`${ROOMS}?host_email=eq.${enc(a.host)}&state=in.(${LIVE_STATES})&purpose=neq.booked&select=id`),
      a.contact_id
        ? io.db(
            `cockpit_sales_appointments?contact_id=eq.${enc(a.contact_id)}&call_type=eq.demo&start_at=gt.${enc(isoAt(now))}&status=not.in.(cancelled,invalid,noshow)&select=appointment_id&limit=1`,
          )
        : Promise.resolve([]),
      appointment(a.appointment_id),
    ]);
    const bookedIntro = Boolean(
      appt &&
        appt.call_type === "intro" &&
        String(appt.contact_id ?? "") === String(a.contact_id ?? "") &&
        !["cancelled", "invalid"].includes(String(appt.status ?? "")),
    );
    // The room carries the intro (the settle marks it a no-show, the count
    // marks it shown) only when the call is the host's own, or a manager made
    // the room: the same rule as room.wrap and the dialer's mark. A seat's room
    // for another rep's intro is a plain room for the lead.
    let ownIntro = false;
    // Only a room asked for inside the intro's own window (an hour before
    // its start to start + settle) is the intro's room. A confirmation call's
    // room the evening before is a plain room for the lead: its words never
    // say "your intro call", its silence never settles the intro, and a join
    // there never marks the intro shown.
    const introNow =
      bookedIntro && a.item_kind !== "confirm" && inIntroWindow(now, ms(appt?.start_at) ?? Number.NaN, a.setting.waits_s);
    if (bookedIntro && introNow) {
      const assigned = String(appt?.assigned_user_id ?? "");
      const hostGhl =
        lower(a.who.email) === a.host ? (a.who.ghl_user_id ?? null) : (((await personOf(a.host).catch(() => null))?.ghl_user_id as string | null) ?? null);
      ownIntro = a.who.manager === true || (Boolean(assigned) && Boolean(hostGhl) && assigned === hostGhl);
    }
    // Zoom's daily cap on this host's meeting creates (the room worker stores
    // it, stress2 round 2): refused before a room is asked for.
    const capped = ms((await io.db(`cockpit_sales_room_hosts?email=eq.${enc(a.host)}&select=zoom_capped_until`).catch(() => []))[0]?.zoom_capped_until);
    if (a.provider === "zoom" && capped !== null && capped > now)
      return { refused: refuse("zoom_capped") };
    const no = createRefusal({
      setting: a.setting,
      purpose: a.purpose,
      provider: a.provider,
      call_kind: a.call_kind,
      contact_id: a.contact_id,
      contact,
      host: facts,
      host_email: a.host,
      lead_room_open: leadRooms.length > 0,
      host_room_open: hostRooms.length > 0,
      booked_demo: demos.length > 0,
      booked_intro: bookedIntro,
    });
    if (no) {
      // The same request may have landed between the first read and the
      // lead's check (two tabs, a retry): that room is the answer, not a refusal.
      if (no.code === "lead_has_room" || no.code === "host_has_room") {
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
        if (twin && lower(twin.host_email) === a.host) return { room: twin };
      }
      // Another seat's room holds the lead (the setter's link, and a closer
      // on the lead's page): said whose it is, by role, and when it closes,
      // never "Open it", which only its host can (stress2, round 2).
      const others = no.code === "lead_has_room" ? leadRooms.find(r => lower(r.host_email) !== a.host) : undefined;
      if (others) {
        const p = await personOf(lower(others.host_email)).catch(() => null);
        const role = p?.role === "closer" ? "closer" : p?.role === "manager" ? "manager" : "setter";
        // The lead is in that room now: no closing time, never "Call the lead" (stress2 round 3).
        if (others.state === "lead_in") return { refused: { ...no, message: fill(LANE_COPY.lead_in_others_room, { role }) } };
        // As the sweep holds it: lead_by, kept open past it for an open or a
        // knock in the last open_grace (R4, holdUntil), else host_by.
        const until =
          holdUntil(others as unknown as RoomRow, roomCtx(a.setting)) ??
          ms(others.lead_by) ??
          ms(others.host_by) ??
          (ms(others.requested_at) ?? now) + a.setting.waits_s.fail * S;
        if (until <= now) return { refused: { ...no, message: fill(LANE_COPY.lead_has_others_room_closing, { role }) } };
        return { refused: { ...no, message: fill(LANE_COPY.lead_has_others_room, { role, until: kuwaitClock(until) }) } };
      }
      return { refused: no };
    }
    const row: Row = {
      ...newRoomRow({
        id: io.uuid(),
        request_id: a.request_id,
        code: "",
        contact_id: a.contact_id,
        purpose: a.purpose,
        call_kind: a.call_kind,
        provider: a.provider,
        host_email: a.host,
        made_by: lower(a.who.email),
        now,
        trigger: a.trigger ?? null,
        attempt_id: isUuid(a.attempt_id) ? a.attempt_id : null,
        appointment_id: a.appointment_id && bookedIntro && introNow && ownIntro ? a.appointment_id : null,
        handover_id: a.handover_id ?? null,
      }),
      contact_first_name: greetingName(contact?.firstName, contact?.name) || null,
      // The intro's start as it stands now: a later move of that intro is never settled by this room.
      appointment_start_at: bookedIntro && introNow && ownIntro && appt?.start_at ? String(appt.start_at) : null,
    };
    // The database picks a code no room has (the guard trigger).
    delete row.code;
    let inserted: RoomRow;
    try {
      inserted = (await io.db(ROOMS, { method: "POST", body: compact(row), prefer: "return=representation" }))[0] as unknown as RoomRow;
    } catch (e) {
      if (isUnique(e, "cockpit_sales_rooms_request_id_key")) {
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
        if (twin && lower(twin.host_email) === a.host) return { room: twin };
        return { refused: refuse("bad_input") };
      }
      if (isUnique(e, "cockpit_sales_rooms_one_per_lead") || isUnique(e, "cockpit_sales_rooms_one_per_host")) {
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(a.request_id)}&select=*`))[0] as unknown as RoomRow | undefined;
        if (twin && lower(twin.host_email) === a.host) return { room: twin };
        return {
          refused: isUnique(e, "cockpit_sales_rooms_one_per_lead") ? refuse("lead_has_room", {}, a.purpose) : refuse("host_has_room"),
        };
      }
      throw e;
    }
    await recordCreate(a, inserted);
    return { room: inserted };
  }

  /**
   * A timeline line that is also the claim on its audit row: true when this
   * call stored it (so this call writes the audit row), false when another
   * press or retry already had. A line that could not be stored answers
   * true: an audit row written twice is better than none.
   */
  async function claimLine(roomId: string, kind: string, text: string, detail: Row, dedupe: string): Promise<boolean> {
    try {
      const rows = await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: { room_id: roomId, kind, source: "sales-api", dedupe_key: dedupe.slice(0, 300), handled_at: isoAt(io.now()), text: text.slice(0, 500), detail },
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      return rows.length > 0;
    } catch (e) {
      io.log(`rooms: a timeline line was not stored: ${redact(String((e as Error)?.message ?? e))}`);
      return true;
    }
  }

  /**
   * room.create's timeline line and audit row, once per room: the press (or
   * the retry that finds its room) whose line lands writes the audit row, so
   * twenty twins of one request id leave one row.
   */
  async function recordCreate(a: Pick<CreateAsk, "who" | "purpose" | "provider" | "call_kind" | "contact_id" | "host">, inserted: RoomRow): Promise<void> {
    const first = await claimLine(inserted.id, "room.asked", fill(EVENT_TEXT.asked, { provider: a.provider === "zoom" ? "Zoom" : "Meet" }), {
      purpose: a.purpose,
    }, `room.asked:${inserted.id}`);
    if (!first) return;
    await deps.audit(a.who, "room.create", ROOMS, inserted.id, null, {
      purpose: a.purpose,
      provider: a.provider,
      call_kind: a.call_kind,
      contact_id: a.contact_id,
      host_email: a.host,
      state: inserted.state,
      code: inserted.code,
    });
  }

  /** room.create's wait: the worker has 15 s; the browser polls room.status after that. */
  async function waitForWorker(room: RoomRow, setting: RoomsSetting): Promise<RoomRow> {
    const until = io.now() + setting.waits_s.ready * S;
    let cur = room;
    while ((cur.state === "requested" || cur.state === "creating") && io.now() < until) {
      await io.sleep(500);
      cur = (await readRoom(room.id).catch(() => cur)) ?? cur;
    }
    return cur;
  }

  async function roomCreate(who: Who, b: Row): Promise<Row> {
    const requestId = await seatRequestId(who, b.request_id);
    const host = lower(who.email);
    const { rooms: setting } = await roomsAndLive();
    const purpose = String(b.purpose ?? "");
    const contactId = cleanText(b.contact_id, 80) || null;
    let handoverId: string | null = null;
    if (purpose === "handover") {
      // A seat makes a handover room only for a lead it holds live (Try Zoom after a failed room).
      const held = contactId
        ? (await io.db(
            `cockpit_sales_live?contact_id=eq.${enc(contactId)}&claimed_by=eq.${enc(host)}&state=in.(claimed,room_ready)&select=id&limit=1`,
          ))[0]
        : null;
      if (!held) throw plain(ROOMS_COPY.handover_only_claimed, 409, "bad_input");
      handoverId = String(held.id);
    }
    if (!isPurpose(purpose) || purpose === "booked") throw no("bad_input");
    // A standby room comes only from I'm available (live.availability) and
    // the sweep's refresh, which hold the live switch, the hours, the role
    // and the standby caps; never straight from a seat (stress2, round 1).
    if (purpose === "standby") throw plain(ROOMS_COPY.standby_by_availability, 400, "bad_input");
    if (!isProvider(b.provider) || !isCallKind(b.call_kind)) throw no("bad_input");
    await roomCaps(who, requestId, contactId);
    // A lead who has had three call links this hour gets no fourth room
    // after a missed call (stress2, round 2): its link could not go, and a
    // call nobody answered has no one to read it out to. Refused before a
    // meeting is made; a retry of a room already made is answered by that
    // room. A room from the lead page (manual) may be made on a live call,
    // where the rep still reads the code out (the link cap says so on it).
    if (contactId && purpose === "fallback") {
      const repeat = (await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=id&limit=1`).catch(() => [] as Row[]))[0];
      if (!repeat && (await leadLinksThisHour(contactId)) >= LINK_FLOOD_MAX) {
        await deps.audit(who, "room.create.refused", ROOMS, contactId, null, null, { why: "link_flood", contact_id: contactId });
        throw plain(ROOMS_COPY.link_flood_create, 429, "link_flood");
      }
    }
    const trigger = (TRIGGERS as readonly string[]).includes(String(b.trigger)) ? String(b.trigger) : null;
    const ask = {
      who,
      host,
      request_id: requestId,
      purpose,
      provider: b.provider,
      call_kind: b.call_kind,
      contact_id: contactId,
      trigger,
      attempt_id: cleanText(b.attempt_id, 40) || null,
      appointment_id: cleanText(b.appointment_id, 80) || null,
      handover_id: handoverId,
      item_kind: ["intro", "confirm", "lead"].includes(String(b.item_kind)) ? String(b.item_kind) : null,
      setting,
    } as const;
    let made = await createRoom(ask);
    // The seat's only open room is its own empty standby room (an Available
    // closer sending a lead a video link): it is ended for the lead's room,
    // with its audit row, never "You already have a room open" with no way
    // to end it but Set me away (stress2, round 1).
    if ("refused" in made && made.refused.code === "host_has_room" && contactId && (await endStandbyFor(who, host, setting)))
      made = await createRoom(ask);
    if ("refused" in made) throw asRefusal(made.refused);
    const room = await waitForWorker(made.room, setting);
    return { room: await view(room, setting) };
  }

  /**
   * Ends the seat's empty standby rooms when they are its only open rooms;
   * answers whether any was ended. A room a Take adopted meanwhile stays.
   */
  async function endStandbyFor(who: Who, host: string, setting: RoomsSetting): Promise<boolean> {
    const mine = (await io.db(`${ROOMS}?host_email=eq.${enc(host)}&state=in.(${LIVE_STATES})&purpose=neq.booked&select=*`)) as unknown as RoomRow[];
    const standby = standbyToEnd(mine, host);
    if (!standby.length || standby.length !== mine.length) return false;
    let ended = false;
    for (const r of standby) {
      const out = await applyLoop(r.id, cur => (standbyEmpty(cur) ? { kind: "end", reason: "end" } : null), setting, r);
      if ("applied" in out && out.applied.changed) {
        ended = true;
        await deps.audit(who, "room.end", ROOMS, r.id, { state: out.applied.from }, { state: out.applied.to }, { reason: "lead_room" });
        await note(r.id, "room.end", ROOMS_COPY.standby_for_lead, { reason: "lead_room" }, `room.end:${r.id}`);
        await carryOut(out.room, out.applied.effects);
      }
    }
    return ended;
  }

  /**
   * Every room is a new meeting on the rep's own Zoom (which caps creates per
   * user per day) or a new event on the shared Sales rooms calendar, so a
   * seat's presses are capped (stress2, round 1, room-create-flood): at most
   * ROOMS_PER_LEAD_HOUR rooms for one lead in an hour, and at most
   * ROOMS_PER_SEAT_10M in ten minutes and ROOMS_PER_SEAT_HOUR in an hour from
   * one seat. A repeat of a press already made (its request id) is never
   * refused. Rooms the server makes (a replacement, a handover's) are not
   * counted against a press. Not readable: the room goes ahead.
   */
  async function roomCaps(who: Who, requestId: string, contactId: string | null): Promise<void> {
    const now = io.now();
    const seat = lower(who.email);
    try {
      const repeat = await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=id&limit=1`);
      if (repeat.length) return;
      const [mine, lead] = await Promise.all([
        io.db(
          `${ROOMS}?made_by=eq.${enc(seat)}&requested_at=gte.${enc(isoAt(now - 60 * 60_000))}&state=neq.failed&select=requested_at&limit=${ROOMS_PER_SEAT_HOUR}`,
        ),
        contactId
          ? io.db(
              `${ROOMS}?contact_id=eq.${enc(contactId)}&requested_at=gte.${enc(isoAt(now - 60 * 60_000))}&state=neq.failed&purpose=neq.booked&select=id&limit=${ROOMS_PER_LEAD_HOUR}`,
            )
          : Promise.resolve([] as Row[]),
      ]);
      const last10 = mine.filter(r => (ms(r.requested_at) ?? 0) >= now - 10 * 60_000).length;
      const why =
        lead.length >= ROOMS_PER_LEAD_HOUR
          ? "per_lead"
          : last10 >= ROOMS_PER_SEAT_10M
            ? "per_seat_10m"
            : mine.length >= ROOMS_PER_SEAT_HOUR
              ? "per_seat_hour"
              : null;
      if (!why) return;
      await deps.audit(who, "room.create.refused", ROOMS, contactId, null, null, { why, contact_id: contactId });
      throw plain(why === "per_lead" ? ROOMS_COPY.room_flood_lead : ROOMS_COPY.room_flood_seat, 429, "room_flood");
    } catch (e) {
      if (e instanceof ApiRefusal) throw e;
      io.log(`rooms: the room caps could not be read, the room goes ahead: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  // ------------------------------------------------------------- reading a room

  async function health(now: number): Promise<Row> {
    const since = enc(kuwaitMidnight(now));
    const count = (p: Promise<Row[]>) => p.then(r => r.length).catch(() => null);
    const [status, made, failed, mism] = await Promise.all([
      io.db("cockpit_sales_worker_status?worker=eq.sales-desk&job=eq.rooms&select=at,ok,detail").catch(() => null),
      count(io.db(`${ROOMS}?requested_at=gte.${since}&select=id&limit=5000`)),
      count(io.db(`${ROOMS}?requested_at=gte.${since}&state=eq.failed&select=id&limit=5000`)),
      count(io.db(`cockpit_sales_alerts?kind=eq.room_report&resolved_at=is.null&raised_at=gte.${since}&select=id&limit=500`)),
    ]);
    if (status === null)
      return { worker_ok: false, last_run_at: null, rooms_today: made, failed_today: failed, line: ROOMS_COPY.status_unread };
    return roomsHealth({
      now,
      last_run_at: status[0]?.at ?? null,
      rooms_today: made,
      failed_today: failed,
      mismatched_today: mism,
      status: status[0] ?? null,
    }) as unknown as Row;
  }

  async function roomStatus(_who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const now = io.now();
    const [room, latest, key, { rooms: setting }] = await Promise.all([
      mustRoom(id),
      io.db(`${EVENTS}?room_id=eq.${enc(id)}&select=id,at,kind,source,text&order=at.desc&limit=20`),
      // The room's key lines beside the last 20 (stress2 round 3,
      // zoom-rejoin-flood-unbounded): a flood of Zoom lines never pushes the
      // link, the opens or the hand marks off the panel. Not read: the last 20.
      io
        .db(`${EVENTS}?room_id=eq.${enc(id)}&kind=in.(${KEY_LINES.join(",")})&select=id,at,kind,source,text&order=at.desc&limit=20`)
        .catch(() => [] as Row[]),
      roomsAndLive(),
    ]);
    const seen = new Set<string>();
    const events = [...latest, ...key]
      .filter(e => {
        const k = String(e.id ?? `${String(e.at)}:${String(e.kind)}`);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));
    return {
      room: await view(room, setting),
      events: events.map(e => ({ at: e.at, kind: e.kind, source: e.source, text: eventText(e) })),
      health: await health(now),
      now: isoAt(now),
      // Whether the host can use the other provider for this call now (the
      // panel offers "Try {other}" and "I can't let them in" only then:
      // stress2, round 1). Null when the host's facts could not be read.
      other_ok: await otherProviderOk(room, setting, now),
    };
  }

  /** The host can use the room's other provider for its kind of call now; null when unread. */
  async function otherProviderOk(room: RoomRow, setting: RoomsSetting, now: number): Promise<boolean | null> {
    if (!room.host_email) return null;
    try {
      const { facts } = await hostFacts(lower(room.host_email), now);
      return providerRefusal(setting, facts, otherProvider(room.provider), room.call_kind) === null;
    } catch (e) {
      io.log(`rooms: the host's providers could not be read: ${redact(String((e as Error)?.message ?? e))}`);
      return null;
    }
  }

  async function roomOpen(who: Who, b: Row): Promise<Row> {
    const room = await mustRoom(roomIdOf(b.room_id));
    if (lower(room.host_email) !== lower(who.email)) {
      const host = await personOf(lower(room.host_email)).catch(() => null);
      throw no("not_host", { host: greetingName(host?.name, null) || lower(room.host_email).split("@")[0] });
    }
    if (isFinal(room.state)) throw no("final");
    if (room.state === "requested" || room.state === "creating") throw no("too_early");
    const secret = (await io.db(`cockpit_sales_room_secrets?room_id=eq.${enc(room.id)}&select=start_url,expires_at`))[0];
    const expires = ms(secret?.expires_at);
    const fresh = secret && /^https:\/\//.test(String(secret.start_url ?? "")) && (expires === null || expires > io.now());
    // Meet rooms and booked rooms have no host link: the host opens the meeting
    // they organise. A Zoom room whose start link has gone: the join link, which
    // Zoom opens as the host when they are signed in.
    const url = fresh ? String(secret.start_url) : String(room.join_url ?? "");
    if (!/^https:\/\//.test(url)) throw no("too_early");
    await deps.audit(who, "room.open", ROOMS, room.id, null, { state: room.state, host_link: Boolean(fresh) });
    return { start_url: url };
  }

  // ------------------------------------------------------------- presses

  async function roomMark(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const what = String(b.what ?? "");
    const version = Number(b.version);
    if (!(ROOM_MARKS as readonly string[]).includes(what) || !Number.isInteger(version)) throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const actor = { email: lower(who.email), manager: who.manager === true };
    const out = await applyLoop(id, () => markEvent(what, actor, version) as RoomEvent, setting);
    if ("refused" in out) throw asRefusal(out.refused);
    const { room, applied } = out;
    // The press's timeline line is the claim on its audit row, keyed by the
    // version the press made: a retry after a lost answer (the write landed,
    // the room is where the press wanted it, one version on) finishes the
    // line and the audit row the first press never wrote, once (stress2).
    const key = (v: number) => `room.mark.${what}:${room.id}:v${v}`;
    const text = EVENT_TEXT[`mark_${what}` as "mark_host_in"];
    if (applied.changed) {
      if (await claimLine(room.id, `room.mark.${what}`, text, { by: "person" }, key(Number(room.version))))
        await deps.audit(who, `room.mark.${what}`, ROOMS, room.id, { state: applied.from }, { state: applied.to });
      await carryOut(room, applied.effects);
    } else if ((what === "host_in" || what === "lead_in") && room.state === what && Number(room.version) === version + 1) {
      if (await claimLine(room.id, `room.mark.${what}`, text, { by: "person" }, key(Number(room.version))))
        await deps.audit(who, `room.mark.${what}`, ROOMS, room.id, null, { state: room.state }, { retry: true });
    }
    return { room: await view(room, setting) };
  }

  /**
   * room.count_confirm (managers): a join only a hand press reported
   * (count_result self_reported) is counted as the lead's own, as if Zoom or
   * the short link had seen them. Audited; the room's count alert is resolved.
   */
  async function roomCountConfirm(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    if (!who.manager) throw plain(ROOMS_COPY.count_confirm_manager, 403, "not_manager");
    const { rooms: setting } = await roomsAndLive();
    const room = await readRoom(id);
    if (!room) throw plain(ROOMS_COPY.room_missing, 404, "gone");
    if (!setting.count_on_join) throw plain(ROOMS_COPY.count_confirm_off, 409, "disabled");
    if (room.count_result !== "self_reported" || !leadJoined(room)) {
      // Nothing waits for a manager here: the room's own confirm alert is over (stress2, round 2).
      await resolveAlerts(room.id, ["count_confirm"]);
      throw plain(ROOMS_COPY.count_confirm_nothing, 409, "nothing_to_confirm");
    }
    // The count's claim decides between two presses (two tabs, two
    // managers): only the press whose claim landed confirmed anything, and
    // only it leaves the audit row; the other is told so.
    const run = await runCount(room.id, true);
    if (run === "taken") throw plain(ROOMS_COPY.count_confirm_taken, 409, "nothing_to_confirm");
    await deps.audit(who, "room.count_confirm", ROOMS, room.id, { count_result: room.count_result }, { confirmed: true }, {
      contact_id: room.contact_id,
      counted: run === "claimed",
    });
    const after = (await readRoom(room.id)) ?? room;
    if (after.count_result !== "self_reported") {
      await io
        .rpc("cockpit_sales_alert_set", { p_key: `room:${room.id}:count_confirm`, p_on: false, p_kind: "room_count_confirm", p_subject: null, p_message: null, p_detail: null })
        .catch(() => null);
    }
    return { room: await view(after, setting) };
  }

  async function roomEnd(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    const reason = String(b.reason ?? "");
    const version = Number(b.version);
    if (!(END_REASONS as readonly string[]).includes(reason) || !Number.isInteger(version)) throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const actor = { email: lower(who.email), manager: who.manager === true };
    if (reason === "admit_blocked") {
      // "I can't let them in" closes this room for one on the other
      // provider. When the host cannot use that provider now (a setter's
      // Zoom seat still pending), the lead's room stays as it is and the rep
      // is told the real next step (stress2, round 1): never a closed room
      // and a replacement nobody can make.
      const cur = await mustRoom(id);
      // Only where P1 defines it (stress2, round 2): a Meet room with a lead,
      // fallback or handover. A press again on the room it closed asks for
      // the same replacement (the retry below). Another seat's press goes on
      // to the host check (not_host), as before.
      const retry = cur.state === "cancelled" && cur.result === "admit_blocked";
      const mine = lower(cur.host_email) === actor.email || actor.manager;
      if (mine && !retry && !admitBlockedAllowed(cur)) throw no("bad_input");
      if (mine && !isFinal(cur.state) && cur.contact_id) {
        const other = otherProvider(cur.provider);
        const ok = await otherProviderOk(cur, setting, io.now());
        if (ok === false)
          throw plain(
            fill(ROOMS_COPY.admit_no_other, { other: providerName(other), provider: providerName(cur.provider) }),
            409,
            "other_unusable",
          );
        // The replacement counts against the lead's and the seat's room caps,
        // as room.create does: past them, the lead's room stays open and the
        // rep is told why (room_flood), never a meeting with no cap.
        await roomCaps(who, await uuidFrom(`mahara-room/replace/${cur.id}`), cur.contact_id);
      }
    }
    const out = await applyLoop(
      id,
      () => ({ kind: "end", reason: reason as (typeof END_REASONS)[number], actor, version, confirm: b.confirm === true }),
      setting,
    );
    if ("refused" in out) throw asRefusal(out.refused);
    const { room, applied } = out;
    const answer: Row = {};
    // A room ends once: its line is the claim on its audit row, so a retry
    // after a lost answer (the room closed by a person, one version on)
    // writes the audit row and line the first press never did, once (stress2).
    const endText = fill(EVENT_TEXT.ended, { reason: reason.replaceAll("_", " ") });
    if (applied.changed) {
      if (await claimLine(room.id, "room.end", endText, { reason }, `room.end:${room.id}`))
        await deps.audit(who, "room.end", ROOMS, room.id, { state: applied.from }, { state: applied.to, result: room.result }, { reason });
      await carryOut(room, applied.effects);
    } else if (isFinal(room.state) && room.state !== "failed" && room.state !== "expired" && !room.end_reason && Number(room.version) === version + 1) {
      if (await claimLine(room.id, "room.end", endText, { reason }, `room.end:${room.id}`))
        await deps.audit(who, "room.end", ROOMS, room.id, null, { state: room.state, result: room.result }, { reason, retry: true });
    }
    const replace = applied.effects.find(e => e.kind === "replace");
    // "I can't let them in": the same lead, the other provider. A second press
    // (another tab, or a retry after a lost answer) on the room it closed asks
    // again for the same replacement, by the same request id.
    const again = !applied.changed && reason === "admit_blocked" && room.state === "cancelled" && room.result === "admit_blocked";
    if ((replace && replace.kind === "replace") || again) {
      const provider: Provider = replace && replace.kind === "replace" ? replace.provider : room.provider === "zoom" ? "meet" : "zoom";
      Object.assign(answer, await replacementFor(who, room, provider, setting));
    }
    return { room: await view(room, setting), ...answer };
  }

  /**
   * The admit_blocked replacement room. Its create never fails the press: the
   * Meet room is already cancelled, so a database stall or any other error
   * answers a sentence and the panel offers Try {provider} (the same request
   * id, so a retry finds the room this one may have made).
   */
  async function replacementFor(who: Who, room: RoomRow, provider: Provider, setting: RoomsSetting): Promise<Row> {
    const name = provider === "zoom" ? "Zoom" : "Meet";
    try {
      const made = await createRoom({
        who,
        host: lower(room.host_email),
        request_id: await uuidFrom(`mahara-room/replace/${room.id}`),
        purpose: room.purpose,
        provider,
        call_kind: room.call_kind,
        contact_id: room.contact_id,
        trigger: room.trigger ?? null,
        attempt_id: room.attempt_id ?? null,
        appointment_id: room.appointment_id ?? null,
        handover_id: room.handover_id ?? null,
        setting,
      });
      if ("refused" in made) return { replacement_refusal: made.refused.message };
      return { replacement: await view(await waitForWorker(made.room, setting), setting) };
    } catch (e) {
      io.log(`rooms: the replacement room was not made: ${redact(String((e as Error)?.message ?? e))}`);
      return { replacement_refusal: fill(ROOMS_COPY.replacement_not_made, { provider: name }) };
    }
  }

  async function roomSend(who: Who, b: Row): Promise<Row> {
    const id = roomIdOf(b.room_id);
    requestIdOf(b.request_id);
    if (b.channel !== "email") throw no("bad_input");
    const { rooms: setting } = await roomsAndLive();
    const room = await mustRoom(id);
    if (lower(room.host_email) !== lower(who.email) && who.manager !== true) {
      const host = await personOf(lower(room.host_email)).catch(() => null);
      throw no("not_host", { host: greetingName(host?.name, null) || "another rep" });
    }
    if (!room.contact_id) throw no("no_lead");
    if (isFinal(room.state)) throw no("final");
    if (room.state === "requested" || room.state === "creating") throw no("too_early");
    if (!setting.send.email) throw plain(`Not sent: ${LANE_COPY.why_email_off}.`, 409, "disabled");
    // The lead's three links an hour hold here too: "Send by email" is never
    // a way past the cap (stress2, round 1). Its refusal is written on the
    // room, so the panel stops offering the button.
    if ((await leadLinksThisHour(room.contact_id)) >= LINK_FLOOD_MAX) {
      if (!room.link_sent_at) await recordNotSent(room, ROOMS_COPY.link_flood);
      throw plain(ROOMS_COPY.link_flood, 409, "link_flood");
    }
    // One email with the link per room, whatever the presses (two tabs, a
    // double tap, or the backup that already went): the message service's
    // own key for this room's email, so a repeat answers the email that went.
    const { keys, rows } = await linkRows(room.id);
    const sent = await sendOn(room, "email", currentKey(keys.email, rows), setting, who);
    if (!sent.ok) {
      // It may have gone (HighLevel's answer was lost, or an earlier press's
      // send never finished): never "Not sent", which the rep would read as
      // failed and send the link some other way (stress2, round 1). Said
      // once on the room's timeline, with its audit row.
      if (sent.unclear) {
        const first = await claimLine(room.id, "link.unclear", `${ROOMS_COPY.may_have_gone_email}.`, { channel: "email" }, `link.unclear:${room.id}:email`);
        if (first) await deps.audit(who, "room.link.unclear", ROOMS, room.id, null, { channel: "email", why: sent.why }, { host_email: lower(room.host_email) });
        if (!room.link_sent_at) await recordNotSent(room, ROOMS_COPY.may_have_gone_email);
        throw plain(`${ROOMS_COPY.may_have_gone_email}.`, 502, "may_have_gone");
      }
      if (sent.inflight) throw plain(ROOMS_COPY.email_on_its_way, 409, "inflight", { retry: true });
      throw plain(`Not sent: ${sent.why}.`, sent.status, "send_failed");
    }
    const after = await recordSent(room, "email", sent.message_id, setting);
    await deps.audit(who, "room.send", ROOMS, room.id, null, { channel: "email", message_id: sent.message_id });
    return { room: await view(after, setting) };
  }

  async function roomWrap(who: Who, b: Row): Promise<Row> {
    const requestId = await seatRequestId(who, b.request_id);
    const apptId = cleanText(b.appointment_id, 80);
    if (!apptId) throw no("bad_input");
    const host = lower(who.email);
    const { rooms: setting, raw } = await roomsAndLive();
    const repeat = (await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=*`))[0] as unknown as RoomRow | undefined;
    if (repeat && lower(repeat.host_email) === host) {
      // The insert landed and its answer was lost: its audit row and line are written now, once.
      await recordWrap(who, repeat);
      return { room: await view(repeat, setting) };
    }
    // The booked call's room already open (another tab, another request id):
    // that one, when it is this seat's own room or a manager asks (final
    // review, wrap-request-id-hands-over-room). Anyone else goes on to the
    // check of whose call it is, which refuses another rep's.
    const open = (await io.db(
      `${ROOMS}?appointment_id=eq.${enc(apptId)}&purpose=eq.booked&state=in.(${LIVE_STATES})&select=*&limit=1`,
    ))[0] as unknown as RoomRow | undefined;
    if (open && (lower(open.host_email) === host || who.manager === true)) return { room: await view(open, setting) };
    let ap: Row | null;
    try {
      ap = appointmentOf(await io.ghl("GET", `/calendars/events/appointments/${enc(apptId)}`));
    } catch {
      throw no("contact_unread");
    }
    // A 200 with no appointment in it (a gateway's empty answer) is not an
    // answer: "try again in a minute", never "this call is on the phone"
    // for a call whose link was simply not read (stress2, round 2).
    if (!ap) throw no("contact_unread");
    const mirror = await appointment(apptId).catch(() => null);
    const assigned = String(ap.assignedUserId ?? mirror?.assigned_user_id ?? "");
    if (!who.manager && (!who.ghl_user_id || assigned !== who.ghl_user_id))
      throw plain("This call is booked with another rep. Only they or a manager can open its room.", 403, "not_host");
    const contactId = String(ap.contactId ?? mirror?.contact_id ?? "") || null;
    const calendars = obj(raw.calendars);
    const type = String(mirror?.call_type ?? obj(calendars[String(ap.calendarId ?? "")]).type ?? "");
    const kind: CallKind = type === "demo" ? "demo" : "intro";
    if (type !== "demo" && type !== "intro") throw no("bad_input");
    const contact = contactId ? await readContact(contactId) : null;
    const now = io.now();
    // HighLevel writes the sub-account's wall time with no zone in some
    // answers ("2026-10-08 15:00:00", Kuwait): read through ghlTime, as every
    // other HighLevel time in this file is, never as UTC.
    const asInstant = (v: unknown): string | null => {
      if (v === null || v === undefined || v === "") return null;
      if (typeof v === "number") return Number.isFinite(v) ? isoAt(v) : null;
      const t = ghlTime(v);
      return Number.isFinite(t) ? isoAt(t) : String(v);
    };
    const plan = wrapPlan({
      setting,
      contact_id: contactId,
      contact,
      start: asInstant(ap.startTime) ?? mirror?.start_at,
      end: asInstant(ap.endTime),
      address: ap.address,
      call_kind: kind,
      now,
      ctx: roomCtx(setting),
    });
    if (!plan.ok) throw asRefusal(plan);
    const row: Row = {
      ...wrapRoomRow(
        { id: io.uuid(), request_id: requestId, code: "", contact_id: contactId, call_kind: kind, host_email: host, made_by: host, now, appointment_id: apptId },
        plan,
      ),
      contact_first_name: greetingName(contact?.firstName, contact?.name) || null,
    };
    delete row.code;
    let inserted: RoomRow;
    try {
      inserted = (await io.db(ROOMS, { method: "POST", body: compact(row), prefer: "return=representation" }))[0] as unknown as RoomRow;
    } catch (e) {
      if (isUnique(e, "cockpit_sales_rooms_request_id_key")) {
        // The same press landed a moment ago: this seat's own row only, never
        // another rep's room on the same id (final review), as createRoom.
        const twin = (await io.db(`${ROOMS}?request_id=eq.${enc(requestId)}&select=*`))[0] as unknown as RoomRow | undefined;
        if (!twin || lower(twin.host_email) !== host) throw no("bad_input");
        await recordWrap(who, twin);
        return { room: await view(twin, setting) };
      }
      if (isUnique(e, "cockpit_sales_rooms_one_per_lead")) {
        // Two tabs opened the same booked call at once: the room the other one made is this call's room.
        const twin = (await io.db(
          `${ROOMS}?appointment_id=eq.${enc(apptId)}&purpose=eq.booked&state=in.(${LIVE_STATES})&select=*&limit=1`,
        ))[0] as unknown as RoomRow | undefined;
        if (twin) return { room: await view(twin, setting) };
        throw no("lead_has_room");
      }
      throw e;
    }
    await recordWrap(who, inserted);
    return { room: await view(inserted, setting) };
  }

  /** room.wrap's timeline line and audit row, once per booked room (a retry after a lost answer finishes them). */
  async function recordWrap(who: Who, room: RoomRow): Promise<void> {
    const name = room.provider === "zoom" ? "Zoom" : "Meet";
    const first = await claimLine(room.id, "room.wrapped", fill(EVENT_TEXT.wrapped, { provider: name }), {
      appointment_id: room.appointment_id ?? null,
    }, `room.wrapped:${room.id}`);
    if (first)
      await deps.audit(who, "room.wrap", ROOMS, room.id, null, { appointment_id: room.appointment_id ?? null, provider: room.provider, state: room.state });
  }

  // ------------------------------------------------------------- the message service

  /**
   * One channel, one message, keyed so a retry can never send twice: the
   * rep's own request id for "Also send by email", else an id made from the
   * room and the channel. Answers what went, or why not:
   * - ok: the message service says sent, delivered or read;
   * - inflight: an earlier try of this very send is still running (its row
   *   says sending and is younger than a send's own budget): the link stays
   *   claimed and the next minute's check finishes it;
   * - unclear: it may have gone (an answer lost, a 5xx, a database write
   *   after HighLevel failed, or a send that started long ago and never
   *   finished): nothing else may go until a person checks;
   * - stopped: the room closed while the send was being prepared;
   * - otherwise a refusal that is certain, and the next channel may go.
   * `stillOpen` is asked right before the message goes, so an End pressed
   * meanwhile stops it.
   */
  async function sendOn(
    room: RoomRow,
    channel: LinkChannel,
    requestId: string,
    setting: RoomsSetting,
    by?: Who,
    contact?: Row | null,
    stillOpen?: () => Promise<boolean>,
  ): Promise<SendOutcome> {
    const sender = by ?? (await hostWho(room.host_email));
    const c = contact ?? (room.contact_id ? await readContact(room.contact_id) : null);
    const host = await personOf(lower(room.host_email)).catch(() => null);
    const link = shortUrl(room.code, room.join_url, setting.short_link);
    if (!room.contact_id || !link) return { ok: false, why: LANE_COPY.no_lead, status: 409 };
    const vars = {
      // "Hi there, your call..." when HighLevel has no name.
      first_name: greetingName(c?.firstName, c?.name) || "there",
      rep: greetingName(host?.name, null) || "the sales team",
      link,
    };
    const t = channel === "whatsapp_template" ? null : leadText(room, channel === "email" ? "email" : "whatsapp_text", vars);
    if (stillOpen && !(await stillOpen())) return { ok: false, stopped: true, why: LANE_COPY.final, status: 409 };
    let m: Row;
    try {
      if (channel === "whatsapp_template") {
        const key = `${setting.template_route}_${leadLanguage(c)}`;
        m = (
          await deps.sendTemplate(sender, {
            contactId: room.contact_id,
            key,
            line: "",
            requestId,
            followupId: null,
            source: "room",
            signAs: lower(room.host_email),
            buttonVariable: { join_code: room.code },
            readBackMs: setting.waits_s.unconfirmed * S,
          })
        ).message;
      } else {
        m = (
          await deps.sendText(
            sender,
            {
              contact_id: room.contact_id,
              channel: channel === "email" ? "email" : "whatsapp",
              body: (t as { body: string }).body,
              subject: (t as { subject: string | null }).subject,
              request_id: requestId,
            },
            { source: "room", readBackMs: setting.waits_s.unconfirmed * S },
          )
        ).message;
      }
    } catch (e) {
      const why = (e instanceof ApiRefusal ? e.message : redact(String((e as Error)?.message ?? e))).replace(/\.+$/, "");
      // The words that went, for the conversation check: the free text's own,
      // or the template as the message service rendered it (its row's body).
      if (unclearSend(e))
        return { ok: false, unclear: true, why, status: 502, since: io.now(), text: t?.body ?? (await bodyOf(requestId)), request_id: requestId };
      return { ok: false, why, status: e instanceof ApiRefusal ? e.status : 502 };
    }
    const state = String(m.state ?? "");
    if (state === "sent" || state === "delivered" || state === "read")
      return {
        ok: true,
        message_id: String(m.id ?? "") || null,
        unseen: channel === "whatsapp_template" && String(m.provider_status ?? "") === "enrolled",
      };
    if (state === "failed") return { ok: false, why: String(m.error ?? "the message failed").replace(/\.+$/, ""), status: 502 };
    if (state === "sending") {
      // A repeat of a send that has not finished: still running, or orphaned
      // by a deploy or the wall-clock limit between its row and HighLevel.
      const started = ms(m.created_at);
      if (started !== null && io.now() - started < SEND_BUDGET_MS) return { ok: false, inflight: true, why: "the send is still running", status: 409 };
      await io
        .db(`cockpit_sales_messages?id=eq.${enc(String(m.id ?? ""))}&state=eq.sending`, {
          method: "PATCH",
          body: { state: "unclear", error: "The send started and never finished, so it may or may not have gone." },
          prefer: "return=minimal",
        })
        .catch(e => io.log(`rooms: an orphaned send was not marked unclear: ${redact(String((e as Error)?.message ?? e))}`));
    }
    // sending (orphaned), unclear, or a state this code does not know: it may have gone.
    return {
      ok: false,
      unclear: true,
      why: "the send did not finish",
      status: 502,
      since: ms(m.created_at) ?? io.now(),
      text: t?.body ?? (typeof m.body === "string" && m.body.trim() ? m.body : null),
      request_id: requestId,
    };
  }

  /**
   * A send confirmed from the conversation: its message row is marked sent,
   * with HighLevel's id and status when the conversation gave them. Answers
   * the row's id (null when there is no row or it could not be written).
   */
  async function confirmRow(requestId: string | undefined, hit: SeenSend | null): Promise<string | null> {
    if (!requestId) return null;
    try {
      const rows = await io.db(`cockpit_sales_messages?request_id=eq.${enc(requestId)}&state=in.(unclear,sending)&select=id`, {
        method: "PATCH",
        body: {
          state: "sent",
          ...(hit?.id ? { ghl_message_id: hit.id } : {}),
          provider_status: lower(hit?.status) || "pending",
          updated_at: isoAt(io.now()),
        },
        prefer: "return=representation",
      });
      if (rows[0]?.id) return String(rows[0].id);
      const row = (await io.db(`cockpit_sales_messages?request_id=eq.${enc(requestId)}&select=id`))[0];
      return row?.id ? String(row.id) : null;
    } catch (e) {
      io.log(`rooms: a send confirmed from the conversation was not stored on its row: ${redact(String((e as Error)?.message ?? e))}`);
      return null;
    }
  }

  /**
   * The room.link audit row, written before the send is recorded on the room
   * (stress2 round 3): a run stopped between the record and its audit left a
   * room that says the link went with no audit row, and the re-ask never
   * wrote one. A run stopped between this and the record is resumed by the
   * re-ask, which writes its own (resumed: true).
   */
  async function auditLink(room: RoomRow, channel: LinkChannel, extra: Row): Promise<void> {
    const had = Array.isArray(room.link_channels) ? (room.link_channels as string[]) : [];
    await deps.audit(DESK, "room.link", ROOMS, room.id, { link_sent_at: room.link_sent_at ?? null }, {
      link_sent_at: room.link_sent_at ?? isoAt(io.now()),
      link_channels: [...new Set([...had, channel])],
      ...extra,
    }, { host_email: lower(room.host_email) });
  }

  /** A send's words as the message service stored them (the rendered template), or null. */
  async function bodyOf(requestId: string): Promise<string | null> {
    const row = (await io.db(`cockpit_sales_messages?request_id=eq.${enc(requestId)}&select=body`).catch(() => []))[0];
    return typeof row?.body === "string" && row.body.trim() ? row.body : null;
  }

  /**
   * The request ids one room's link may use on one channel, in order: the
   * room and channel's own, then LINK_RETRIES fresh ones. A send HighLevel
   * refused outright (state failed: certainly not sent) moves the channel on
   * to the next id, so a 429 burst never leaves the room unable to send its
   * link; a send that went, is going or may have gone keeps its id.
   */
  async function linkKeys(roomId: string, channel: LinkChannel): Promise<string[]> {
    const out = [await uuidFrom(`mahara-room/link/${roomId}/${channel}`)];
    for (let n = 1; n <= LINK_RETRIES; n++) out.push(await uuidFrom(`mahara-room/link/${roomId}/${channel}/${n}`));
    return out;
  }

  /** Every message row behind a room's link keys, by request id. Throws when it cannot be read. */
  async function linkRows(roomId: string): Promise<{ keys: Record<LinkChannel, string[]>; rows: Map<string, Row> }> {
    const keys = {} as Record<LinkChannel, string[]>;
    for (const c of ["whatsapp_text", "whatsapp_template", "email"] as LinkChannel[]) keys[c] = await linkKeys(roomId, c);
    const all = Object.values(keys).flat();
    const rows = await io.db(
      `cockpit_sales_messages?request_id=in.(${all.map(enc).join(",")})&select=id,request_id,state,body,created_at,provider_status`,
    );
    return { keys, rows: new Map(rows.map(r => [String(r.request_id), r])) };
  }

  /** The id a channel's next send uses: the first with no row or a row that is not failed; the last one when every try failed. */
  function currentKey(keys: string[], rows: Map<string, Row>): string {
    for (const k of keys) if (rows.get(k)?.state !== "failed") return k;
    return keys[keys.length - 1] as string;
  }

  /**
   * A send that went: the link_sent event (the lead's 10 minutes start), the
   * channel and the message id. `unseen`: a WhatsApp template nobody saw yet,
   * so link_unconfirmed_at lands in the same write as link_sent_at (a run
   * cut off after it never leaves a sure send behind). The channel and id
   * are best effort: a database blip there never skips what follows (the
   * unseen template's email backup), and the room panel reads the link as
   * sent from link_sent_at either way.
   */
  async function recordSent(room: RoomRow, channel: LinkChannel, messageId: string | null, setting: RoomsSetting, unseen = false): Promise<RoomRow> {
    const out = await applyLoop(room.id, () => ({ kind: "link_sent", channel, at: io.now(), unconfirmed: unseen }), setting);
    let fresh = ("refused" in out ? out.room : out.room) ?? room;
    if (unseen && !fresh.link_unconfirmed_at) {
      // link_sent_at was there already (another channel went first): the doubt is still said.
      await io
        .db(`${ROOMS}?id=eq.${enc(room.id)}&link_unconfirmed_at=is.null`, {
          method: "PATCH",
          body: { link_unconfirmed_at: isoAt(io.now()) },
          prefer: "return=minimal",
        })
        .catch(e => io.log(`rooms: the link was not marked unconfirmed: ${redact(String((e as Error)?.message ?? e))}`));
      fresh = { ...fresh, link_unconfirmed_at: fresh.link_unconfirmed_at ?? isoAt(io.now()) };
    }
    // link_channels and link_message_ids never move the version. Two channels
    // can be recorded at once (the link and "Also send by email"), so the
    // write holds only while the channels are as read: a write that misses
    // reads again and adds its own to what the other one wrote.
    try {
      for (let i = 0; i < MAX_WRITE_TRIES; i++) {
        fresh = (await readRoom(room.id)) ?? fresh;
        const had = Array.isArray(fresh.link_channels) ? (fresh.link_channels as string[]) : [];
        const channels = [...new Set([...had, channel])];
        const ids = { ...obj(fresh.link_message_ids), ...(messageId ? { [channel]: messageId } : {}) };
        const rows = await io.db(`${ROOMS}?id=eq.${enc(room.id)}&link_channels=eq.${enc(`{${had.join(",")}}`)}`, {
          method: "PATCH",
          body: { link_channels: channels, link_message_ids: ids, ...(fresh.refusal ? { refusal: null } : {}) },
          prefer: "return=representation",
        });
        if (rows[0]) {
          fresh = rows[0] as unknown as RoomRow;
          break;
        }
      }
    } catch (e) {
      io.log(`rooms: the link's channel was not recorded: ${redact(String((e as Error)?.message ?? e))}`);
    }
    await note(room.id, "link.sent", channel === "email" ? EVENT_TEXT.link_sent_email : EVENT_TEXT.link_sent, { channel }, `link.sent:${room.id}:${channel}`);
    return fresh;
  }

  /**
   * How many call links reached this lead in the last hour, on any channel
   * and from any room (each room's link_channels; a room whose link went with
   * no channel recorded counts one). One lead is never flooded with call
   * links: the room's own link (sendLinkHeld) and "Send by email" (room.send)
   * both stop at LINK_FLOOD_MAX (stress2, round 1, the email bypass). Only an
   * unseen template's email backup is not counted, being the same link.
   * Not readable: 0, so the link goes (the sender's own ceiling still holds),
   * because a lead waiting on a link matters more.
   */
  async function leadLinksThisHour(contactId: string): Promise<number> {
    return await io
      .db(
        `${ROOMS}?contact_id=eq.${enc(contactId)}&link_sent_at=gte.${enc(isoAt(io.now() - LINK_FLOOD_WINDOW_MS))}&select=id,link_channels,link_unconfirmed_at&limit=50`,
      )
      .then(rows =>
        rows.reduce((n, r) => {
          const ch = Array.isArray(r.link_channels) ? (r.link_channels as string[]) : [];
          // The backup email after an unseen template is that same link.
          const backup = r.link_unconfirmed_at && ch.includes("whatsapp_template") && ch.includes("email") ? 1 : 0;
          return n + Math.max(1, ch.length - backup);
        }, 0),
      )
      .catch(e => {
        io.log(`rooms: the lead's recent links could not be read, the link goes: ${redact(String((e as Error)?.message ?? e))}`);
        return 0;
      });
  }

  /**
   * A template nobody saw, whose email backup has not been settled yet: the
   * link went (link_sent_at) as an unconfirmed template only, and no backup
   * line was written. A run cut off between the two leaves this, and the
   * minute's re-ask resumes it (stress2, round 1).
   */
  function backupOwed(room: RoomRow): boolean {
    if (!room.contact_id || !room.link_sent_at || !room.link_unconfirmed_at) return false;
    if (room.state !== "open" && room.state !== "host_in" && room.state !== "lead_in") return false;
    const ch = Array.isArray(room.link_channels) ? (room.link_channels as string[]) : [];
    return !ch.includes("email") && !ch.includes("whatsapp_text");
  }
  /** The link went (link_sent_at) and no channel is on the room: its record never finished (stress2, round 2). */
  function linkUnrecorded(room: RoomRow): boolean {
    if (!room.contact_id || !room.link_sent_at) return false;
    if (room.state !== "open" && room.state !== "host_in" && room.state !== "lead_in") return false;
    return !Array.isArray(room.link_channels) || (room.link_channels as unknown[]).length === 0;
  }
  async function backupSettled(roomId: string): Promise<boolean> {
    const rows = await io.db(`${EVENTS}?dedupe_key=eq.${enc(`link.unconfirmed:${roomId}`)}&select=id`).catch(() => null);
    // Not readable: settled for now (the next minute asks again).
    return rows === null || rows.length > 0;
  }

  /**
   * Why the link did not go, on the room (the panel's "Not sent: ...") with
   * its audit row and timeline line, once: the tick re-asks a claimed link
   * every minute, and a reason already said is not said again (eight copies
   * would push the room's real history off the panel). Answers whether it
   * was written now.
   */
  async function recordNotSent(room: RoomRow, why: string): Promise<boolean> {
    const sentence = why.charAt(0).toUpperCase() + why.slice(1).replace(/\.+$/, "");
    const text = `${sentence}.`.slice(0, 500);
    if ((room.refusal ?? null) === text) return false;
    try {
      const guard = room.refusal ? `refusal=eq.${enc(room.refusal)}` : "refusal=is.null";
      const rows = await io.db(`${ROOMS}?id=eq.${enc(room.id)}&link_sent_at=is.null&${guard}`, {
        method: "PATCH",
        body: { refusal: text },
        prefer: "return=representation",
      });
      // Another run said it a moment ago: said once.
      if (!rows.length) return false;
      await deps.audit(DESK, "room.link.not_sent", ROOMS, room.id, { refusal: room.refusal ?? null }, { refusal: rows[0]?.refusal ?? null });
    } catch (e) {
      io.log(`rooms: the reason the link did not go was not saved: ${redact(String((e as Error)?.message ?? e))}`);
    }
    await note(room.id, "link.not_sent", fill(EVENT_TEXT.not_sent, { why: sentence.charAt(0).toLowerCase() + sentence.slice(1) }), {});
    return true;
  }

  /**
   * The message service (contract v2 section 5, send_link): WhatsApp free
   * text inside the window, then the call_link template, then email; a
   * template not seen in rooms.waits_s.unconfirmed is followed by email and
   * link_unconfirmed_at. Nothing goes to a client or a lead with
   * do-not-disturb everywhere; when nothing can go, `refusal` says why and
   * the rep reads the link out.
   */
  async function sendLink(roomId: string): Promise<void> {
    const first = await readRoom(roomId);
    if (!first?.contact_id || !first.link_claimed_at) return;
    // HighLevel said this lead is gone: asked once more a minute later, and
    // nothing more after a second "gone" (stress2, round 2: one answer is
    // never final, it may be a deploy's or a gateway's).
    if (!first.link_sent_at && String(first.refusal ?? "").startsWith(ROOMS_COPY.contact_gone_send.slice(0, 40)) && (await goneSettled(roomId))) return;
    if (first.link_sent_at) {
      // Sent: only a record that never finished (no channel on the room) or
      // an unseen template's backup that never ran is resumed here.
      if (!linkUnrecorded(first) && (!backupOwed(first) || (await backupSettled(roomId)))) return;
    } else if (first.state !== "open" && first.state !== "host_in") return;
    // One send of a room's link at a time (fix round 4): the minute's re-ask
    // that finds a send still on its way (its next channel's setup reads
    // crawling past the minute) leaves it be, never plans afresh beside it.
    const held = await linkLease(roomId);
    if (!held || held.resumeOnly) {
      // Another send holds the room's link (or the database could not say),
      // or the run whose lease this one took over began its last step only
      // moments ago and may still be sending it: only a send that already
      // went is finished here (recorded, and a template nobody saw backed up
      // on the email's own request id, which the message service never sends
      // twice). Nothing is planned or sent afresh beside a send still on its way.
      try {
        await sendLinkHeld(roomId, null);
      } finally {
        if (held) await releaseEvent(held);
      }
      return;
    }
    try {
      await sendLinkHeld(roomId, held);
    } finally {
      await releaseLink(held);
    }
  }

  /** The link's lease given back by the run that holds it, with no step left in flight. */
  async function releaseLink(held: LinkHold): Promise<void> {
    try {
      const n = await heldWrite(held, `${eventFilter(held)}&handled_at=is.null`, { lease_until: null, detail: {} });
      if (n === 0 && held.token) io.log("rooms: the link's lease had passed to another run, which keeps it");
    } catch (e) {
      io.log(`rooms: the link's lease was not released: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  /** When this room's first (or second) "gone" answer was stored, or null. */
  async function goneAt(roomId: string, which: "link.gone" | "link.gone_again"): Promise<number | null> {
    const row = (await io.db(`${EVENTS}?dedupe_key=eq.${enc(`${which}:${roomId}`)}&select=handled_at`).catch(() => []))[0];
    return row ? (ms(row.handled_at) ?? 0) : null;
  }
  /**
   * A gone lead's link is settled: HighLevel said "gone" twice a minute
   * apart, or the first answer is under a minute old (asked again after it).
   * Not readable: settled for now (the next minute asks again).
   */
  async function goneSettled(roomId: string): Promise<boolean> {
    try {
      if ((await goneAt(roomId, "link.gone_again")) !== null) return true;
      const first = await goneAt(roomId, "link.gone");
      return first !== null && io.now() - first < GONE_AGAIN_MS;
    } catch {
      return true;
    }
  }

  /**
   * The lease behind sendLink: one link.send event per room, taken for a
   * send's budget by cockpit_sales_room_event_lease and renewed for
   * LINK_STEP_S before each channel (linkStep), so it covers the cascade. Null while another send holds it
   * (or the database cannot say): the sweep asks again. `resumeOnly`: the
   * lease was taken over from a run whose last step (detail.step_at) began
   * under a send's budget ago, so that send may still be on its way; this
   * run only finishes a send that went, and plans nothing.
   */
  async function linkLease(roomId: string): Promise<LinkHold | null> {
    const by: EventKey = { dedupe_key: `link.send:${roomId}` };
    try {
      await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: { room_id: roomId, kind: "link.send", source: "sales-api", dedupe_key: by.dedupe_key, text: "The link was asked to go." },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      if (!(await lease(by, SEND_BUDGET_MS / S))) return null;
    } catch (e) {
      io.log(`rooms: the link's send lease was not taken, the sweep asks again: ${redact(String((e as Error)?.message ?? e))}`);
      return null;
    }
    const held: LinkHold = { ...by, dedupe_key: String(by.dedupe_key), renewed: io.now(), resumeOnly: false };
    const last = (await io.db(`${EVENTS}?${eventFilter(by)}&select=detail`).catch(() => null))?.[0];
    const stepAt = ms(obj(last?.detail).step_at);
    // Not read: the step is not known, so this run only resumes.
    if (last === undefined || (stepAt !== null && io.now() - stepAt < SEND_BUDGET_MS)) held.resumeOnly = true;
    return held;
  }

  /**
   * Before each channel of the cascade: the link's lease is renewed for
   * LINK_STEP_S under this run's own token, with the step and its time on
   * the link.send event (detail.step, detail.step_at). False when another
   * run holds the lease now (this run's ran out): nothing more is sent here.
   * A database blip keeps the lease this run already has while enough of it
   * is left for the step.
   */
  async function linkStep(held: LinkHold, step: string): Promise<boolean> {
    try {
      const n = await heldWrite(held, `${eventFilter(held)}&handled_at=is.null`, {
        lease_until: isoAt(io.now() + LINK_STEP_S * S),
        detail: { step, step_at: isoAt(io.now()) },
      });
      if (n === 0) {
        io.log(`rooms: the link's lease passed to another run before the ${step} step; this run sends nothing more`);
        held.lost = true;
        return false;
      }
      held.renewed = io.now();
      return true;
    } catch (e) {
      io.log(`rooms: the link's lease was not renewed before the ${step} step: ${redact(String((e as Error)?.message ?? e))}`);
      if (io.now() - held.renewed < LINK_STEP_S * S - SEND_BUDGET_MS) return true;
      held.lost = true;
      return false;
    }
  }

  /** A send's last check before it goes: the link's lease still this run's (renewed for the step), and the room still open. */
  function stepGuard(held: LinkHold | null, step: string, stillOpen?: () => Promise<boolean>): (() => Promise<boolean>) | undefined {
    if (!held) return stillOpen;
    return async () => (await linkStep(held, step)) && (!stillOpen || (await stillOpen()));
  }

  /**
   * A WhatsApp template HighLevel took and nobody saw (fix round 4): never a
   * sure send. The room says "not confirmed" at once, whatever the email
   * does next; the email backs it up when it can, and when it cannot
   * (refused, its answer lost, or no email) the timeline says to read the
   * link out, so the panel and the settle never read it as sent.
   */
  async function backUpUnseen(
    room: RoomRow,
    link: Awaited<ReturnType<typeof linkRows>>,
    setting: RoomsSetting,
    contact: Row | null,
    canEmail: boolean,
    stillOpen?: () => Promise<boolean>,
    linkAudit?: Row,
  ): Promise<{ room: RoomRow; emailed: boolean }> {
    await io
      .db(`${ROOMS}?id=eq.${enc(room.id)}&link_unconfirmed_at=is.null`, {
        method: "PATCH",
        body: { link_unconfirmed_at: isoAt(io.now()) },
        prefer: "return=minimal",
      })
      .catch(e => io.log(`rooms: the link was not marked unconfirmed: ${redact(String((e as Error)?.message ?? e))}`));
    let after: RoomRow = { ...room, link_unconfirmed_at: room.link_unconfirmed_at ?? isoAt(io.now()) };
    let mail: SendOutcome | null = null;
    if (canEmail) {
      mail = await sendOn(after, "email", currentKey(link.keys.email, link.rows), setting, undefined, contact, stillOpen);
      if (mail.ok) {
        // Audited before it is recorded (stress2 round 3): a run stopped
        // between the two never leaves a link the room says went with no row.
        if (linkAudit) await auditLink(after, "email", linkAudit);
        else
          await deps.audit(DESK, "room.link.unconfirmed", ROOMS, room.id, null, { emailed: true }, { host_email: lower(room.host_email) });
        after = await recordSent(after, "email", mail.message_id, setting);
        // The email went and its channel was not recorded (a write that
        // timed out): the backup is not settled yet, so the minute's re-ask
        // (backupOwed, resumeBackup) records it from its sent row. Never the
        // line "the email did not go" for an email that went (stress2, round 2).
        const ch = Array.isArray(after.link_channels) ? (after.link_channels as string[]) : [];
        if (!ch.includes("email")) return { room: after, emailed: true };
      }
      // The same email still on its way in another run: that run says how it went.
      else if (mail.inflight) return { room: after, emailed: false };
    }
    const text = mail?.ok
      ? EVENT_TEXT.link_unconfirmed
      : mail && !mail.ok && mail.unclear
        ? EVENT_TEXT.link_unconfirmed_email_unclear
        : EVENT_TEXT.link_unconfirmed_no_email;
    await note(room.id, "link.unconfirmed", text, { emailed: Boolean(mail?.ok) }, `link.unconfirmed:${room.id}`);
    if (!mail?.ok)
      await deps.audit(DESK, "room.link.unconfirmed", ROOMS, room.id, null, { emailed: false, why: mail && !mail.ok ? mail.why : "no email" }, {
        host_email: lower(room.host_email),
      });
    return { room: after, emailed: Boolean(mail?.ok) };
  }

  /**
   * The unseen template's email backup, resumed under the link's lease: the
   * email that went (its record lost) is recorded, one still on its way is
   * left to finish, and otherwise the backup goes now on the email's own key.
   */
  async function resumeBackup(room: RoomRow, held: LinkHold): Promise<void> {
    const raw = await settingsOf(["rooms"]);
    const setting = roomsSetting(raw.rooms);
    const contact = await readContact(String(room.contact_id));
    if (!contact) return; // HighLevel did not answer: the next minute asks again
    const link = await linkRows(room.id);
    const mail = link.keys.email.map(k => link.rows.get(k)).find(r => r && r.state !== "failed");
    if (mail && ["sent", "delivered", "read"].includes(String(mail.state))) {
      const after = await recordSent(room, "email", String(mail.id ?? "") || null, setting);
      // Settled only once the channel is on the room (stress2, round 2): a
      // write that missed again is asked again the next minute.
      const ch = Array.isArray(after.link_channels) ? (after.link_channels as string[]) : [];
      if (ch.includes("email")) await note(room.id, "link.unconfirmed", EVENT_TEXT.link_unconfirmed, { emailed: true }, `link.unconfirmed:${room.id}`);
      return;
    }
    if (mail) return; // sending or unclear: its own run (or the conversation check) says how it went
    const stillOpen = async () => {
      const cur = await readRoom(room.id).catch(() => null);
      return Boolean(cur && (cur.state === "open" || cur.state === "host_in" || cur.state === "lead_in"));
    };
    const after = await backUpUnseen(room, link, setting, contact, emailPossible(contact, setting), stepGuard(held, "email_backup", stillOpen));
    await deps.audit(DESK, "room.link", ROOMS, room.id, null, {
      link_sent_at: after.room.link_sent_at ?? null,
      link_channels: after.room.link_channels ?? [],
      link_unconfirmed: true,
      backup_resumed: true,
      emailed: after.emailed,
    }, { host_email: lower(room.host_email) });
  }

  /** sendLink's body: the whole of it under its lease (`held`), or only a send that went without it (null). */
  async function sendLinkHeld(roomId: string, held: LinkHold | null): Promise<void> {
    const room = await readRoom(roomId);
    if (room && held && !linkUnrecorded(room) && backupOwed(room) && !(await backupSettled(roomId))) {
      await resumeBackup(room, held);
      return;
    }
    // A room whose link went and whose record never finished goes on to the
    // "went" path below (it records, never sends anew).
    if (!room?.contact_id || !room.link_claimed_at || (room.link_sent_at && !linkUnrecorded(room))) return;
    // sendLink read the room open (or the host in); the lead may have come in
    // since (a link on its way still goes, as stillOpen allows).
    if (room.state !== "open" && room.state !== "host_in" && room.state !== "lead_in") return;
    const raw = await settingsOf(["rooms", "whatsapp_guard", "messaging"]);
    const setting = roomsSetting(raw.rooms);
    const healthFrom = isoAt(healthSince(raw.whatsapp_guard, io.now()));
    const read = await readContactOrGone(room.contact_id);
    if (read === "gone") {
      // Merged away or deleted in HighLevel: said once. The minute's re-ask
      // reads HighLevel once more a minute on, and a second "gone" stops it
      // for this room (sendLink, goneSettled).
      const firstGone = await goneAt(room.id, "link.gone");
      if (firstGone === null) await note(room.id, "link.gone", "HighLevel answered that this lead is not there.", {}, `link.gone:${room.id}`);
      else if (io.now() - firstGone >= GONE_AGAIN_MS)
        await note(room.id, "link.gone", "HighLevel answered again that this lead is not there.", {}, `link.gone_again:${room.id}`);
      await recordNotSent(room, ROOMS_COPY.contact_gone_send);
      return;
    }
    const contact = read;
    if (!contact) {
      await recordNotSent(room, ROOMS_COPY.contact_unread_send);
      return;
    }
    // A re-ask resumes, never plans afresh: a send that went (its record lost
    // to a database blip, or the function stopped before it wrote it) is
    // recorded; one still running is left to finish; one that may have gone
    // is checked in the conversation. Only a room whose link rows say nothing
    // went (none, or each refused outright) plans its channels now.
    let link: Awaited<ReturnType<typeof linkRows>>;
    try {
      link = await linkRows(room.id);
    } catch (e) {
      io.log(`rooms: the link's earlier sends could not be read, the sweep asks again: ${redact(String((e as Error)?.message ?? e))}`);
      return;
    }
    const earlier = (["whatsapp_text", "whatsapp_template", "email"] as LinkChannel[]).flatMap(c =>
      link.keys[c].map(k => ({ channel: c, row: link.rows.get(k) })).filter((x): x is { channel: LinkChannel; row: Row } => Boolean(x.row)),
    );
    const went = earlier.find(x => ["sent", "delivered", "read"].includes(String(x.row.state)));
    if (went) {
      // A template nobody saw, cut off before its backup: the same backup now.
      const unseen = went.channel === "whatsapp_template" && String(went.row.provider_status ?? "") === "enrolled";
      await auditLink(room, went.channel, { link_unconfirmed: unseen, resumed: true });
      const after = await recordSent(room, went.channel, String(went.row.id ?? "") || null, setting, unseen);
      if (unseen) await backUpUnseen(after, link, setting, contact, emailPossible(contact, setting), stepGuard(held, "email_backup"));
      return;
    }
    // link_sent_at stands and no send of ours is read as gone: never a new send.
    if (!held || room.link_sent_at) return;
    const open = earlier.find(x => x.row.state === "sending" || x.row.state === "unclear");
    if (open) {
      const started = ms(open.row.created_at);
      if (open.row.state === "sending" && started !== null && io.now() - started < SEND_BUDGET_MS) return;
      // Asked again on its own id: an orphaned "sending" row is marked unclear there, and the answer says what it was.
      const again = await sendOn(room, open.channel, String(open.row.request_id), setting, undefined, contact, stepGuard(held, open.channel));
      if (again.stopped) return;
      if (again.ok) {
        const unseen = open.channel === "whatsapp_template" && again.unseen;
        await auditLink(room, open.channel, { link_unconfirmed: unseen, resumed: true });
        const after = await recordSent(room, open.channel, again.message_id, setting, unseen);
        if (unseen) await backUpUnseen(after, link, setting, contact, emailPossible(contact, setting), stepGuard(held, "email_backup"));
      } else if (again.unclear) {
        if (open.channel === "whatsapp_template") await unclearTemplate(room, link, setting, contact, again, emailPossible(contact, setting));
        else await maybeSent(room, open.channel, again, setting);
      }
      return;
    }
    // One lead is never flooded with call links (final review,
    // room-link-loop-floods-lead): a stuck page, a rep pressing Make a room
    // and End in turn, or automatic mode after each missed call would send a
    // new link a room. Three rooms' links to this lead in the last hour, and
    // the fourth room's link does not go; the rep reads the code out. Not
    // readable: the send goes on (the message service's own ceiling of 30 in
    // 10 minutes still holds), because a lead waiting on a link matters more.
    if ((await leadLinksThisHour(room.contact_id)) >= LINK_FLOOD_MAX) {
      // recordNotSent writes the room's refusal, its audit row and its timeline line, once.
      await recordNotSent(room, ROOMS_COPY.link_flood);
      return;
    }
    const lang = leadLanguage(contact);
    const [inbox, route, roomWa, waiting] = await Promise.all([
      io
        .db(`cockpit_sales_inbox?contact_id=eq.${enc(room.contact_id)}&select=inbound_whatsapp_at&order=inbound_whatsapp_at.desc.nullslast&limit=1`)
        .catch(() => []),
      io
        .db(`cockpit_sales_wa_templates?key=eq.${enc(`${setting.template_route}_${lang}`)}&select=key,active,workflow_id`)
        .catch(() => []),
      io
        .db(
          `cockpit_sales_messages?source=eq.room&channel=eq.whatsapp&state=in.(sent,delivered,read,failed)&created_at=gte.${enc(healthFrom)}&select=state,error&order=created_at.desc&limit=20`,
        )
        // Only a failure that speaks for the number or the template counts
        // (stress2, round 1): one lead not on WhatsApp, at Meta's per-person
        // limit, or HighLevel's own 429 says nothing about the next lead.
        .then(rows => rows.filter(r => !(r.state === "failed" && leadSpecificFailure(r.error))).map(r => ({ failed: r.state === "failed" })))
        .catch(() => null),
      // An earlier workflow template to this lead that may still be in
      // HighLevel's queue (taken and not seen, its enrolment's answer lost,
      // or orphaned mid-send): its delayed workflow reads the join field when
      // it runs. Not read, it counts as waiting (the email goes instead).
      io
        .db(queuedTemplatesQuery(room.contact_id, io.now()))
        .then(rows => templateMayBeQueued(rows, io.now()))
        .catch(() => true),
    ]);
    const guard = obj(raw.whatsapp_guard);
    const plan = channelPlan({
      contact,
      last_inbound_at: (inbox[0]?.inbound_whatsapp_at as string | null) ?? null,
      now: io.now(),
      setting,
      whatsapp_on: obj(raw.messaging).whatsapp !== false,
      guard,
      template_live: Boolean(route[0]?.active && route[0]?.workflow_id),
      room_wa: roomWa,
      wa_paused: Boolean(guard.dup_paused_at),
      email_first: room.trigger === "bad_number",
      template_waiting: waiting,
    });
    if (plan.refusal) {
      await recordNotSent(room, plan.refusal === "client" ? ROOM_COPY.refusals.client : ROOM_COPY.refusals.dnd);
      return;
    }
    if (plan.read_out) {
      await recordNotSent(room, plan.not_sent_reason ?? LANE_COPY.why_wa_off);
      return;
    }
    // Every message goes only to a room that is still open: an End pressed
    // while the link was on its way stops what has not gone yet.
    const stillOpen = async () => {
      const cur = await readRoom(room.id).catch(() => null);
      return Boolean(cur && (cur.state === "open" || cur.state === "host_in" || cur.state === "lead_in"));
    };
    const fails: string[] = [];
    for (const channel of plan.order) {
      const requestId = currentKey(link.keys[channel], link.rows);
      const sent = await sendOn(room, channel, requestId, setting, undefined, contact, stepGuard(held, channel, stillOpen));
      if (!sent.ok) {
        if (sent.stopped || sent.inflight) return;
        if (sent.unclear) {
          if (channel === "whatsapp_template") await unclearTemplate(room, link, setting, contact, sent, plan.email_backup, stepGuard(held, "email_backup", stillOpen));
          else await maybeSent(room, channel, sent, setting);
          return;
        }
        fails.push(sent.why);
        continue;
      }
      const unconfirmed = Boolean(sent.unseen && channel === "whatsapp_template");
      await auditLink(room, channel, { link_unconfirmed: unconfirmed });
      const after = await recordSent(room, channel, sent.message_id, setting, unconfirmed);
      if (unconfirmed) await backUpUnseen(after, link, setting, contact, plan.email_backup, stepGuard(held, "email_backup", stillOpen));
      return;
    }
    await recordNotSent(room, fill(ROOMS_COPY.all_failed, { why: fails.join("; ") || "no reason given" }));
  }

  /**
   * The message row behind a room's WhatsApp link on one lane: by the id on
   * the room (link_message_ids), else by the lane's link keys, the row that
   * went or may have gone (stress2 round 3: a link confirmed from the
   * conversation has no id on the room). Null when there is none or it
   * could not be read.
   */
  async function linkMessage(room: RoomRow, channel: LinkChannel): Promise<Row | null> {
    const cols = "id,request_id,state,provider_status,ghl_message_id,error,body,created_at";
    const byId = String(obj(room.link_message_ids)[channel] ?? "");
    try {
      if (byId) return (await io.db(`cockpit_sales_messages?id=eq.${enc(byId)}&select=${cols}`))[0] ?? null;
      const keys = await linkKeys(room.id, channel);
      const rows = await io.db(`cockpit_sales_messages?request_id=in.(${keys.map(enc).join(",")})&select=${cols}`);
      return rows.find(r => r.state !== "failed") ?? null;
    } catch {
      return null;
    }
  }

  /** The room's free-text link was read failed after it went (link.failed_late). */
  async function failedLateNoted(roomId: string): Promise<boolean> {
    const rows = await io.db(`${EVENTS}?dedupe_key=eq.${enc(`link.failed_late:${roomId}`)}&select=id`).catch(() => null);
    return rows === null || rows.length > 0;
  }

  /**
   * A room's free-text link that HighLevel still called pending when its
   * read-back ended (stress2, round 2): Meta decides later (131026, not on
   * WhatsApp; a stuck queue). While the room waits for the lead, the tick
   * reads it again; failed or undelivered, the link did not reach the lead:
   * link_unconfirmed_at, a timeline line the settle reads as a doubt (never a
   * no-show on a link that failed), and the email backup on the email's own
   * request id (the message service never sends one id twice).
   */
  async function recheckLink(roomId: string): Promise<void> {
    const room = await readRoom(roomId).catch(() => null);
    if (!room?.contact_id || !room.link_sent_at || leadJoined(room)) return;
    if (room.state !== "open" && room.state !== "host_in") return;
    const ch = Array.isArray(room.link_channels) ? (room.link_channels as string[]) : [];
    if (ch.includes("email")) return;
    // Either WhatsApp lane (stress2 round 3): the call_link template is the
    // usual lane for a booked intro's room, and Meta fails a template late
    // the same way.
    const channel: LinkChannel | null = ch.includes("whatsapp_text") ? "whatsapp_text" : ch.includes("whatsapp_template") ? "whatsapp_template" : null;
    if (!channel || (await failedLateNoted(room.id))) return;
    const m = await linkMessage(room, channel);
    if (!m) return;
    const messageId = String(m.id ?? "");
    let failed = m.state === "failed";
    let why = String(m.error ?? "");
    const pending = lower(m.provider_status) === "pending" || m.state === "unclear";
    if (!failed && (m.state === "sent" || m.state === "unclear") && pending && m.ghl_message_id) {
      let one: Row;
      try {
        const out = await io.ghl("GET", `/conversations/messages/${enc(String(m.ghl_message_id))}`);
        one = obj(out.message ?? out);
      } catch {
        return; // not read: the next minute asks again
      }
      const status = lower(one.status);
      if (status === "failed" || status === "undelivered") {
        failed = true;
        why = cleanText(obj(one.meta).error ?? one.error ?? one.errorMessage ?? "", 300) || "HighLevel marked it failed";
        await io
          .db(`cockpit_sales_messages?id=eq.${enc(messageId)}&state=in.(sent,unclear)`, {
            method: "PATCH",
            body: { state: "failed", provider_status: status, error: why, updated_at: isoAt(io.now()) },
            prefer: "return=minimal",
          })
          .catch(e => io.log(`rooms: a late failure was not stored on its message: ${redact(String((e as Error)?.message ?? e))}`));
      } else if (status === "delivered" || status === "read") {
        await io
          .db(`cockpit_sales_messages?id=eq.${enc(messageId)}&state=in.(sent,unclear)`, {
            method: "PATCH",
            body: { state: status, provider_status: status, updated_at: isoAt(io.now()) },
            prefer: "return=minimal",
          })
          .catch(() => null);
      }
    } else if (!failed && pending && !m.ghl_message_id && deps.sentSince && typeof m.body === "string" && m.body.trim()) {
      // Confirmed from the conversation with no id to read it by (stress2
      // round 3): the conversation is read again. Its words no longer there
      // as sent (whatsappSentSince skips failed and undelivered): Meta failed it.
      const since = (ms(m.created_at) ?? ms(room.link_sent_at) ?? io.now()) - 5 * S;
      const seen = await deps.sentSince(room.contact_id, since, m.body).catch(() => null);
      if (seen === null) return; // not read: the next minute asks again
      if (seen && typeof seen === "object") {
        if (seen.id)
          await io
            .db(`cockpit_sales_messages?id=eq.${enc(messageId)}&ghl_message_id=is.null`, {
              method: "PATCH",
              body: { ghl_message_id: seen.id, provider_status: lower(seen.status) || "pending", updated_at: isoAt(io.now()) },
              prefer: "return=minimal",
            })
            .catch(() => null);
      } else if (seen === false) {
        failed = true;
        why = "the message is no longer in the lead's conversation as sent";
      }
    }
    if (!failed) return;
    const held = await linkLease(room.id);
    if (!held) return;
    if (held.resumeOnly) {
      // Another run's send of this link may still be on its way: the next minute reads it again.
      await releaseEvent(held);
      return;
    }
    try {
      const fresh = (await readRoom(room.id)) ?? room;
      const contact = await readContact(room.contact_id);
      if (!contact) return; // the next minute asks again
      const { rooms: setting } = await roomsAndLive();
      await io
        .db(`${ROOMS}?id=eq.${enc(room.id)}&link_unconfirmed_at=is.null`, { method: "PATCH", body: { link_unconfirmed_at: isoAt(io.now()) }, prefer: "return=minimal" })
        .catch(e => io.log(`rooms: the link was not marked unconfirmed: ${redact(String((e as Error)?.message ?? e))}`));
      let emailed = false;
      if (emailPossible(contact, setting)) {
        const link = await linkRows(room.id);
        const stillOpen = async () => {
          const cur = await readRoom(room.id).catch(() => null);
          return Boolean(cur && (cur.state === "open" || cur.state === "host_in" || cur.state === "lead_in"));
        };
        const mail = await sendOn(fresh, "email", currentKey(link.keys.email, link.rows), setting, undefined, contact, stepGuard(held, "email_late", stillOpen));
        if (mail.ok) {
          await recordSent(fresh, "email", mail.message_id, setting);
          emailed = true;
        } else if (mail.inflight || held.lost) return;
      }
      await note(
        room.id,
        "link.failed_late",
        emailed ? EVENT_TEXT.link_failed_late : EVENT_TEXT.link_failed_late_no_email,
        { why: why.slice(0, 300), emailed },
        `link.failed_late:${room.id}`,
      );
      await deps.audit(DESK, "room.link.failed_late", ROOMS, room.id, null, { emailed, why: why.slice(0, 300) }, { host_email: lower(room.host_email) });
    } finally {
      await releaseLink(held);
    }
  }

  /**
   * A WhatsApp template whose enrolment answer was lost (unclear): the same
   * doubt as one HighLevel took and nobody saw (stress2, round 2). Seen in
   * the conversation, it went. Otherwise the email backs it up at once on the
   * email's own request id (the same link, never a second one) with
   * link_unconfirmed_at, as backUpUnseen does; with no email possible, the
   * room says it may have gone (maybeSent).
   */
  async function unclearTemplate(
    room: RoomRow,
    link: Awaited<ReturnType<typeof linkRows>>,
    setting: RoomsSetting,
    contact: Row,
    sent: { since?: number; text?: string | null; why: string; request_id?: string },
    canEmail: boolean,
    stillOpen?: () => Promise<boolean>,
  ): Promise<void> {
    let seen: SeenSend | boolean | null = null;
    if (deps.sentSince && room.contact_id && sent.text)
      seen = await deps.sentSince(room.contact_id, (sent.since ?? io.now()) - 5 * S, sent.text).catch(() => null);
    if (seen === true || (seen && typeof seen === "object") || !canEmail) {
      await maybeSent(room, "whatsapp_template", sent, setting);
      return;
    }
    const after = await backUpUnseen(room, link, setting, contact, true, stillOpen, { link_unconfirmed: true, template_unclear: true });
    if (!after.emailed) await maybeSent(room, "whatsapp_template", sent, setting);
  }

  /**
   * A send that may have gone (contract: never two links to one lead): the
   * conversation is read for it first. Found, it counts as sent; not found
   * or not readable, the cascade stops and the panel says to check the
   * conversation before sending again, or to read the link out.
   */
  async function maybeSent(
    room: RoomRow,
    channel: LinkChannel,
    sent: { since?: number; text?: string | null; why: string; request_id?: string },
    setting: RoomsSetting,
  ): Promise<void> {
    let seen: SeenSend | boolean | null = null;
    // Only the send's own words count, on either WhatsApp lane (the free
    // text's, or the template as rendered): any other WhatsApp to the lead,
    // a failed one or a rep's own "Are you free now?", is never this link.
    // With no words known, nothing in the conversation can confirm it.
    if (channel !== "email" && deps.sentSince && room.contact_id && sent.text) {
      seen = await deps.sentSince(room.contact_id, (sent.since ?? io.now()) - 5 * S, sent.text).catch(() => null);
    }
    if (seen === true || (seen && typeof seen === "object")) {
      // The message row takes what the conversation showed (stress2 round 3,
      // unclear-text-link-confirmed-pending-never-rechecked): its id on the
      // room, so a late failure at Meta is read again (recheckLink).
      const messageId = await confirmRow(sent.request_id, typeof seen === "object" ? seen : null);
      await auditLink(room, channel, { confirmed_from_conversation: true });
      await recordSent(room, channel, messageId, setting);
      return;
    }
    // Said once: a re-ask that finds the same send still unclear adds nothing.
    if (await recordNotSent(room, channel === "email" ? ROOMS_COPY.may_have_gone_email : ROOMS_COPY.may_have_gone_whatsapp))
      await deps.audit(DESK, "room.link.unclear", ROOMS, room.id, null, { channel, why: sent.why }, { host_email: lower(room.host_email) });
  }

  // ------------------------------------------------------------- the live booking

  /** One alert per incident (cockpit_sales_alert_set); never fatal. */
  async function raise(key: string, kind: string, room: RoomRow, message: string): Promise<void> {
    try {
      await io.rpc("cockpit_sales_alert_set", {
        p_key: key,
        p_on: true,
        p_kind: kind,
        p_subject: `Room ${room.code}`,
        // Alerts are posted to Slack: a lead's own words (their name) never reach it as markup.
        p_message: slackSafe(message).slice(0, 1000),
        p_detail: { room_id: room.id, code: room.code },
      });
    } catch (err) {
      io.log(`rooms: an alert was not raised: ${redact(String((err as Error)?.message ?? err))}`);
    }
  }

  /** The calendars setting's intro and demo calendars: B2B's own, beside BOOKING_CALENDARS. */
  function officialIds(calendars: unknown): string[] {
    return Object.entries(obj(calendars))
      .filter(([, v]) => ["intro", "demo"].includes(String(obj(v).type)))
      .map(([k]) => k);
  }

  /**
   * Something from the lead says they came, for the live count: Zoom's join
   * of someone outside the team, on the room's own meeting. A Zoom guest
   * whose display name is a team member's is the host on another device.
   *
   * The short link's opens and a knock (lead_waiting_at) are not the lead's
   * alone: the host's panel shows the code and copies the link, so the host
   * can open it on their own phone after it went and then press "The lead
   * is in" (final review, host-open-after-send), and anyone with the code
   * can make a browser open it. They stay evidence against a no-show (the
   * settle reads them), never evidence that upgrades a hand press. So on
   * Meet, where no join is ever seen, every hand-pressed count waits for a
   * manager's confirm (room.count_confirm): a manager decides.
   */
  async function leadEvidence(room: RoomRow): Promise<boolean> {
    if (room.provider !== "zoom" || !room.provider_meeting_id) return false;
    const meeting = String(room.provider_meeting_id);
    const evs = await io.db(
      `${EVENTS}?room_id=eq.${enc(room.id)}&source=eq.zoom&kind=eq.zoom.meeting.participant_joined&select=detail&limit=50`,
    );
    // Only joins of the room's own meeting (final review, zoom-topic-code-beats-meeting-id).
    const leads = evs.filter(e => obj(e.detail).role === "lead" && zoomMeetingId(obj(e.detail) as ZoomEvent) === meeting);
    if (!leads.length) return false;
    const team = await io.db(`cockpit_sales_people?select=name&limit=500`).catch(() => [] as Row[]);
    const names = new Set(team.map(p => lower(p.name)).filter(Boolean));
    return leads.some(e => {
      const p = obj(obj(obj(obj(e.detail).payload).object).participant);
      const shown = lower(p.user_name ?? p.name);
      return !shown || !names.has(shown);
    });
  }

  /**
   * Another room of this lead's already counted this conversation: a live
   * booking or a move that stands, a call marked shown (a mark keeps
   * count_result empty and sets count_appointment_id), or a booking whose
   * answer was lost (unclear: it may stand, and missing is never zero).
   * "in_flight": another room's count was claimed and has written nothing yet
   * (it may have booked, or its function stopped mid-booking): this room
   * waits and the sweep asks again. Siblings are the rooms the lead joined
   * within SIBLING_JOIN_H hours of this room's own join, whatever the day the
   * count runs (a call across midnight, a manager's confirm the next morning).
   */
  async function standingCount(room: RoomRow, mineAt: string | null = null): Promise<boolean | "in_flight"> {
    const joined = ms(room.lead_in_at) ?? io.now();
    const from = enc(isoAt(joined - SIBLING_JOIN_H * 3_600_000));
    const to = enc(isoAt(joined + SIBLING_JOIN_H * 3_600_000));
    const rows = await io.db(
      `${ROOMS}?contact_id=eq.${enc(String(room.contact_id))}&id=neq.${enc(room.id)}&lead_in_at=gte.${from}&lead_in_at=lte.${to}&count_claimed_at=not.is.null&select=id,call_kind,count_claimed_at,count_result,count_appointment_id,count_undo_at&limit=50`,
    );
    // After this room's own claim (claimCount's fallback): of two counts in
    // flight, only the one claimed first (by time, then id) goes on.
    const mine = mineAt === null ? null : (ms(mineAt) ?? 0);
    const before = (r: Row) => {
      if (mine === null) return true;
      const t = ms(r.count_claimed_at) ?? 0;
      return t < mine || (t === mine && String(r.id) < room.id);
    };
    const same = rows.filter(r => !(r.call_kind && room.call_kind && r.call_kind !== room.call_kind));
    const stands = same.some(r => {
      const result = r.count_result ?? null;
      if (result === "unclear") return true;
      if ((result === "booked" || result === "moved") && r.count_appointment_id) return true;
      return result === null && Boolean(r.count_appointment_id) && !r.count_undo_at;
    });
    if (stands) return true;
    return same.some(r => (r.count_result ?? null) === null && !r.count_appointment_id && before(r)) ? "in_flight" : false;
  }

  /**
   * The lead's call of the room's kind that was running at the join: it
   * started before the join (CURRENT_CALL_GRACE_MS early at most) and is
   * still within its length (upcoming() keeps only calls ahead), and is not
   * cancelled. A call marked a no-show while its slot runs is the call the
   * lead came late to: it is marked shown (its prior no-show recorded for the
   * undo), never a Live booking beside it (stress2, round 1). A call that
   * started after the join is never the
   * joined call (fix round 4: a manager's confirm the next morning never
   * marks this morning's call). An invalid call is kept: B2B counts it as
   * held, so the join adds nothing. Null when there is none; undefined when
   * the calls could not be read (never "none").
   */
  async function currentCall(room: RoomRow, host: Who, setting: RoomsSetting): Promise<CountInput["current_call"] | undefined> {
    const joined = ms(room.lead_in_at) ?? io.now();
    const length = (setting.lengths_min[room.call_kind] ?? (room.call_kind === "demo" ? 60 : 30)) * 60 * S;
    const until = Math.min(io.now(), joined + CURRENT_CALL_GRACE_MS);
    let rows: Row[];
    try {
      rows = await io.db(
        `cockpit_sales_appointments?contact_id=eq.${enc(String(room.contact_id))}&call_type=eq.${enc(room.call_kind)}&start_at=gte.${enc(isoAt(joined - length))}&start_at=lte.${enc(isoAt(until))}&status=neq.cancelled&select=*&order=start_at.desc&limit=1`,
      );
    } catch {
      return undefined;
    }
    const a = rows[0];
    const start = ms(a?.start_at);
    if (!a || start === null) return null;
    return { id: String(a.appointment_id), start, status: (a.status as string | null) ?? null, mine: await hostMayMark(room, a, host) };
  }

  /** HighLevel's appointment by id (its own words for the fields); null when it cannot be read. */
  async function ghlAppointment(id: string): Promise<Row | null> {
    try {
      return appointmentOf(await io.ghl("GET", `/calendars/events/appointments/${enc(id)}`));
    } catch {
      return null;
    }
  }

  /**
   * The lead's call ahead, whole: its end, rep and status, from upcoming(),
   * else HighLevel's appointment, else the cockpit's mirror. `unread` when
   * the list itself could not be read: that is never "nothing booked".
   */
  async function upcomingWhole(
    contactId: string,
    kind: CallKind,
    joinedAt: number | null,
  ): Promise<{ value: Parameters<typeof countLive>[0]["upcoming"]; unread: boolean }> {
    let up: Awaited<ReturnType<RoomDeps["upcoming"]>>;
    try {
      // As of the join (fix round 4): a call booked during or after the
      // conversation (the closer books Demo 2 before hanging up) is its
      // outcome, never the call the join was, so it is never moved back.
      // The call ahead at the join, not at the count's run: a manager's
      // confirm after the intro's time still finds the intro the join was
      // (stress2, round 1), never "nothing ahead" and a booking beside it.
      up = await deps.upcoming(contactId, kind, { booked_before: joinedAt, after: joinedAt });
    } catch {
      return { value: null, unread: true };
    }
    if (!up) return { value: null, unread: false };
    const bookedAt = typeof up.booked_at === "number" && Number.isFinite(up.booked_at) ? up.booked_at : null;
    if (joinedAt !== null && bookedAt !== null && bookedAt >= joinedAt) return { value: null, unread: false };
    let end = up.end ?? null;
    let rep = up.assigned_user_id ?? null;
    let status = up.status ?? null;
    if (end === null || !rep) {
      const a = await ghlAppointment(up.id);
      const m = await appointment(up.id).catch(() => null);
      end ??= ghlTime(a?.endTime) || ms(m?.end_at) || null;
      rep ||= String(a?.assignedUserId ?? m?.assigned_user_id ?? "") || null;
      status ||= String(a?.appointmentStatus ?? m?.status ?? "") || null;
    }
    return { value: { ...up, end: Number.isFinite(end) ? end : null, assigned_user_id: rep, status }, unread: false };
  }

  /** The count's own record before it changes the lead's booked call; written first, so its undo can always put the call back. */
  async function recordBefore(
    room: RoomRow,
    kind: "count.moving" | "count.marking" | "count.creating",
    claimedAt: string,
    detail: Row,
    text: string,
  ): Promise<boolean> {
    try {
      await io.db(`${EVENTS}?on_conflict=dedupe_key`, {
        method: "POST",
        body: { room_id: room.id, kind, source: "sales-api", dedupe_key: `${kind}:${room.id}:${claimedAt}`.slice(0, 300), handled_at: isoAt(io.now()), text, detail },
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
      return true;
    } catch (e) {
      io.log(`rooms: the count's record was not stored: ${redact(String((e as Error)?.message ?? e))}`);
      return false;
    }
  }

  /** Gives the count's claim back when nothing was changed, so the sweep's re-ask tries again. */
  async function releaseClaim(room: RoomRow, claimedAt: string): Promise<void> {
    await patchRoom(
      room.id,
      {
        count_claimed_at: room.count_claimed_at ?? null,
        count_result: room.count_result ?? null,
        count_appointment_id: room.count_appointment_id ?? null,
        count_undo_at: room.count_undo_at ?? null,
      },
      { count_claimed_at: claimedAt, count_result: null, count_appointment_id: null },
    ).catch(e => io.log(`rooms: the count's claim was not given back: ${redact(String((e as Error)?.message ?? e))}`));
  }

  /**
   * A booking the count made whose answer was lost: found on the lead's
   * calendar near its start, null when the calendar says there is none, or
   * undefined when it could not be read (never "none").
   */
  async function findBooking(contactId: string, calendarId: string, start: string): Promise<string | null | undefined> {
    try {
      const d = await io.ghl("GET", `/contacts/${enc(contactId)}/appointments`, undefined, "2021-07-28");
      const at = ms(start) ?? 0;
      const hit = ((d.events ?? d.appointments ?? []) as Row[]).find(
        e =>
          !e.deleted &&
          String(e.calendarId ?? "") === calendarId &&
          !["cancelled", "invalid"].includes(String(e.appointmentStatus ?? "")) &&
          Math.abs((ghlTime(e.startTime) || 0) - at) < 60 * S,
      );
      return hit ? String(hit.id ?? "") || null : null;
    } catch {
      return undefined;
    }
  }

  /**
   * The live count for a room whose lead joined. `confirmed`: a manager
   * confirmed a join only a hand press reported (room.count_confirm), so it
   * counts as the lead's own evidence and a self_reported claim is taken again.
   */
  async function runCount(roomId: string, confirmed = false, resume: string | null = null): Promise<CountRun> {
    const read0 = await readRoom(roomId);
    if (!read0?.contact_id) return "skipped";
    const raw = await settingsOf(["rooms", "calendars"]);
    const setting = roomsSetting(raw.rooms);
    if (!setting.count_on_join || !leadJoined(read0)) return "skipped";
    // A stranded claim taken up again (stress2 round 3): the room is read as
    // it was before that claim, and the count goes on under it, never a new one.
    const resuming = resume !== null && countInFlight(read0) && ms(read0.count_claimed_at) === ms(resume);
    if (resume !== null && !resuming) return "taken";
    const room: RoomRow = resuming ? { ...read0, count_claimed_at: null, count_result: null, count_undo_at: null } : read0;
    if (!countClaimable(room, confirmed)) return "taken";
    const [read, host, appt, marks] = await Promise.all([
      readContactOrGone(room.contact_id),
      // Not read: the run stops before its claim and the next minute asks again.
      hostWho(room.host_email, true),
      appointment(room.appointment_id).catch(() => null),
      room.appointment_id
        ? io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(room.appointment_id)}&superseded_at=is.null&select=id,status`)
        : Promise.resolve([] as Row[]),
    ]);
    if (read === "gone") {
      // Merged or deleted in HighLevel: nothing can be counted here, so a
      // person is told (missing is never zero, stress2, round 2).
      await raise(`room:${room.id}:count_unread`, "room_count_stuck", room, fill(ROOMS_COPY.count_contact_gone_alert, { code: room.code }));
      return "skipped";
    }
    const contact = read;
    if (!contact) {
      // Not read: the sweep's re-ask comes back for it, and a person is told
      // when it lasts, as for calls that cannot be read (stress2, round 2).
      if (io.now() - (ms(room.lead_in_at) ?? io.now()) >= COUNT_STUCK_S * S)
        await raise(`room:${room.id}:count_unread`, "room_count_stuck", room, fill(ROOMS_COPY.count_contact_unread_alert, { code: room.code }));
      return "skipped";
    }
    const test = isTestContact(room.contact_id, contact.tags, setting);
    const joined = ms(room.lead_in_at);
    const introStart = ms(appt?.start_at) ?? ms(room.appointment_start_at);
    // The room's own intro counts this join only inside the intro's window;
    // otherwise (a confirmation call's room the day before) it is any join.
    const carries = carriesIntro(room, joined, introStart, setting.waits_s);
    const [up, standing, evidence, current] = await Promise.all([
      test || carries ? Promise.resolve({ value: null, unread: false }) : upcomingWhole(room.contact_id, room.call_kind, joined),
      standingCount(room),
      leadEvidence(room),
      test || carries ? Promise.resolve(null) : currentCall(room, host, setting),
    ]);
    if (up.unread || current === undefined) {
      // Missing is never zero: nothing is booked beside a call that could not
      // be read. The sweep asks again each minute; a person is told when it lasts.
      if (io.now() - (ms(room.lead_in_at) ?? io.now()) >= COUNT_STUCK_S * S)
        await raise(`room:${room.id}:count_unread`, "room_count_stuck", room, fill(ROOMS_COPY.count_unread_alert, { code: room.code }));
      return "skipped";
    }
    // The call ahead is moved to this host only when it is theirs to mark
    // (their own, a manager host, or a manager's room): the mark path's rule.
    const upcomingMine = up.value?.id ? await hostMayMark(room, { assigned_user_id: up.value.assigned_user_id ?? null }, host) : undefined;
    // The call ahead at the join has started since, or was held, by the
    // time this count runs (a manager's confirm the next day): never moved
    // back to the join, nothing booked beside it (stress2, round 2).
    const upcomingPassed = up.value?.id
      ? up.value.start <= io.now() || HELD_STATUSES.includes(lower(up.value.status))
      : undefined;
    const plan: CountPlan = countLive({
      room,
      setting,
      contact,
      upcoming: up.value,
      upcoming_mine: upcomingMine,
      upcoming_passed: upcomingPassed,
      appointment_start: introStart,
      current_call: current,
      appointment_calendar_id: (appt?.calendar_id as string | null) ?? null,
      host_ghl_user_id: host.ghl_user_id ?? null,
      location_id: LOCATION,
      link: shortUrl(room.code, room.join_url, setting.short_link),
      official_calendar_ids: officialIds(raw.calendars),
      standing_count: standing,
      lead_evidence: evidence,
      // Held by B2B's rule already (a rep's showed, or invalid: a
      // disqualified intro is a held call): the count never marks over it.
      appointment_shown:
        marks.some(m => HELD_STATUSES.includes(String(m.status ?? ""))) || HELD_STATUSES.includes(String(appt?.status ?? "")),
      confirmed,
    });
    const claim = countClaim(room, io.now(), plan, confirmed);
    if (!claim) return "skipped";
    // One count per conversation (fix round 4): the claim and the read of the
    // lead's other rooms are one step under the lead's lock, so two counts
    // that overlap never both book.
    // A mark is a count of the conversation too (stress2, round 2): claimed
    // with the siblings read, so a live booking that stands for the same
    // conversation makes it already_counted, and the other way round.
    // Resumed: the claim stands already (its siblings were read when it was taken).
    const got = resuming
      ? plan.action === "none"
        ? { code: "missed" as const, row: null }
        : { code: "claimed" as const, row: read0 }
      : await claimCount(room, claim, plan.action === "move" || plan.action === "create" || plan.action === "mark");
    if (got.code === "missed") return "taken"; // another count holds it, or the row changed (That was not the lead)
    if (got.code === "in_flight") return "skipped"; // another room's count is running: the sweep asks again
    if (got.code === "already_counted") {
      await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: "already_counted", reason: "sibling_counted" });
      return "claimed";
    }
    const claimed = got.row;
    const claimedAt = String(claimed?.count_claimed_at ?? claim.patch.count_claimed_at);
    if (plan.action === "none") {
      await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: plan.count_result, reason: plan.reason });
      // The lead's call is another rep's: never moved to this host, so a
      // person marks it (never counted nowhere without a word).
      if (plan.reason === "booked_other_rep")
        await raise(`room:${room.id}:count_other_rep`, "room_mark_intro", room, fill(ROOMS_COPY.count_other_rep_alert, { code: room.code }));
      // Only a hand press says the lead came: a manager decides, and is told so.
      if (plan.count_result === "self_reported")
        await raise(
          `room:${room.id}:count_confirm`,
          "room_count_confirm",
          room,
          fill(ROOMS_COPY.count_confirm_alert, { code: room.code, name: greetingName(contact.firstName, contact.name) || "The lead" }),
        );
      return "claimed";
    }
    if (plan.action === "mark") {
      if (plan.appointment_id === room.appointment_id) await countMark(room, claimedAt, plan.appointment_id, host, appt, marks);
      else {
        // The lead's call that had started (not the room's own): its row and marks as they are now.
        const [other, otherMarks] = await Promise.all([
          appointment(plan.appointment_id).catch(() => null),
          io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(plan.appointment_id)}&superseded_at=is.null&select=id,status`).catch(() => [] as Row[]),
        ]);
        await countMark(room, claimedAt, plan.appointment_id, host, other, otherMarks);
      }
    } else if (plan.action === "move") await countMove(room, claimedAt, plan);
    else await countCreate(room, claimedAt, plan);
    return "claimed";
  }

  /**
   * The count's claim (fix round 4): cockpit_sales_room_count_claim decides
   * it in one step under the lead's lock (20261003d). While that function is
   * missing (sales-api deployed before the migration), the claim is written
   * first and the lead's other rooms are read after it: a count that stands
   * makes this one already_counted, and of two in flight the later claim
   * (by time, then id) gives its claim back, so two counts never both book.
   */
  async function claimCount(
    room: RoomRow,
    claim: { patch: Partial<RoomRow>; expect: Partial<RoomRow> },
    siblings: boolean,
  ): Promise<{ code: "claimed" | "already_counted" | "in_flight" | "missed"; row: RoomRow | null }> {
    try {
      const out = obj(
        await io.rpc("cockpit_sales_room_count_claim", {
          p_room_id: room.id,
          p_claimed_at: claim.patch.count_claimed_at,
          p_result: claim.patch.count_result ?? null,
          p_expect: claim.expect,
          p_siblings: siblings,
        }),
      );
      const code = String(out.code ?? "");
      if (code === "claimed" || code === "already_counted" || code === "in_flight" || code === "missed")
        return { code, row: out.row && typeof out.row === "object" ? (out.row as unknown as RoomRow) : null };
      throw new Error("the count's claim gave no answer");
    } catch (e) {
      if (e instanceof DbError && (e.code === "PGRST202" || e.status === 404)) {
        // A database without the function: the two-step claim below.
      } else if (e instanceof DbError && (e.status === 0 || e.status >= 500)) {
        // The claim's answer was lost (stress2 round 3,
        // count-claim-lost-answer-count-stuck-forever): the room read again
        // says whether it landed. This run's own claim time on it: it did.
        const back = await readRoom(room.id).catch(() => null);
        if (back && ms(back.count_claimed_at) === ms(claim.patch.count_claimed_at)) {
          if (back.count_result === "already_counted") return { code: "already_counted", row: back };
          if ((back.count_result ?? null) === (claim.patch.count_result ?? null)) return { code: "claimed", row: back };
        }
        throw e;
      } else throw e;
    }
    const landed = await patchRoom(room.id, claim.patch, claim.expect);
    if (!landed) return { code: "missed", row: null };
    if (!siblings) return { code: "claimed", row: landed };
    const mine = String(landed.count_claimed_at ?? claim.patch.count_claimed_at);
    const standing = await standingCount(landed, mine).catch(() => "in_flight" as const);
    if (standing === true) {
      const counted = await patchRoom(
        room.id,
        { count_result: "already_counted" },
        { count_claimed_at: mine, count_result: null, count_appointment_id: null },
      );
      return counted ? { code: "already_counted", row: counted } : { code: "missed", row: null };
    }
    if (standing === "in_flight") {
      await releaseClaim(room, mine);
      return { code: "in_flight", row: null };
    }
    return { code: "claimed", row: landed };
  }

  /**
   * The count's result, written only while its own claim stands and no undo
   * came in while it ran (F7). If that write misses, what the count made is
   * taken back at once and the count is marked undone.
   */
  async function countResult(
    room: RoomRow,
    claimedAt: string,
    done: { count_result: "booked" | "moved" | "failed" | "unclear" | "already_counted" | null; count_appointment_id: string | null },
    what: string,
    meta: Row,
    before: CountBefore | null = null,
  ): Promise<boolean> {
    let landed: RoomRow | null;
    try {
      landed = await patchRoom(room.id, done, {
        count_claimed_at: claimedAt,
        count_result: null,
        count_appointment_id: null,
        count_undo_at: null,
      });
    } catch (e) {
      // The write's answer was lost (stress2, round 2): read back. It landed
      // when the room holds this result for this claim, and what follows (the
      // showed status, the alerts) still runs; otherwise the error stands.
      const back = await readRoom(room.id).catch(() => null);
      const same =
        back &&
        ms(back.count_claimed_at) === ms(claimedAt) &&
        (back.count_result ?? null) === (done.count_result ?? null) &&
        (back.count_appointment_id ?? null) === (done.count_appointment_id ?? null);
      if (!same) throw e;
      landed = back;
    }
    // An unclear move or booking may have changed the lead's calendar with no
    // id to show for it: its own record (count.moving, count.creating) says
    // what to take back (stress2, round 2).
    const mayHaveMade = done.count_result === "unclear" && before !== null;
    if (!landed && (done.count_appointment_id || mayHaveMade)) {
      // "That was not the lead" came in while the count ran: take back what it made, then say so.
      const cur = (await readRoom(room.id)) ?? room;
      try {
        if (!(await undoPlan({ ...cur, ...done, count_claimed_at: claimedAt }, before)))
          throw new Error("what the count made could not be planned back");
        await patchRoom(room.id, { count_result: "undone" }, { count_claimed_at: cur.count_claimed_at ?? null, count_result: cur.count_result ?? null });
        await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: "undone", made: done }, meta);
      } catch (e) {
        io.log(`rooms: what the count made was not taken back: ${redact(String((e as Error)?.message ?? e))}`);
        await patchRoom(room.id, done, { count_claimed_at: claimedAt, count_result: null, count_appointment_id: null }).catch(() => null);
        await deps.audit(DESK, "room.count", ROOMS, room.id, null, { result: "undo_failed", made: done }, meta);
        // A person puts back what the count may have done, in its own words.
        const from = before && typeof before.from_start === "string" ? before.from_start : null;
        if (mayHaveMade)
          await raise(
            `room:${room.id}:undo_stuck`,
            "room_count_stuck",
            room,
            from
              ? fill(ROOMS_COPY.count_move_back_alert, { code: room.code, from: whenKuwait(from) })
              : fill(ROOMS_COPY.undo_stuck_alert, { code: room.code }),
          );
      }
      return false;
    }
    await deps.audit(DESK, "room.count", ROOMS, room.id, null, done, meta);
    await note(room.id, "count.done", fill(EVENT_TEXT.counted, { what }), { result: done.count_result, appointment_id: done.count_appointment_id }, `count.done:${room.id}:${claimedAt}`);
    // The count settled: its earlier "could not count yet" alerts are answered (final review).
    // A mark (count_result null, the call's id set) settles it too (stress2, round 1).
    if (
      landed &&
      (done.count_result === "booked" ||
        done.count_result === "moved" ||
        done.count_result === "already_counted" ||
        (done.count_result === null && done.count_appointment_id))
    )
      await resolveAlerts(room.id, ["count_unread", "count_unclear", "count_confirm"]);
    return Boolean(landed);
  }

  /** Per-room alerts the room itself has answered; never fatal (the watchdog resolves the rest after 3 days). */
  /** The rooms carrying this call: their "mark this intro" alerts are answered once the call is marked (by the settle or the count). */
  async function resolveMarkIntroAlerts(appointmentId: string): Promise<void> {
    const rooms = await io
      .db(`${ROOMS}?appointment_id=eq.${enc(appointmentId)}&select=id&limit=20`)
      .catch(e => {
        io.log(`rooms: the call's rooms were not read for their alerts: ${redact(String((e as Error)?.message ?? e))}`);
        return [] as Row[];
      });
    for (const r of rooms) await resolveAlerts(String(r.id), ["mark_intro"]);
  }

  async function resolveAlerts(roomId: string, whats: string[]): Promise<void> {
    for (const what of whats)
      await io
        .rpc("cockpit_sales_alert_set", { p_key: `room:${roomId}:${what}`, p_on: false, p_kind: "room_count_stuck", p_subject: null, p_message: null, p_detail: null })
        .catch(e => io.log(`rooms: an alert was not resolved: ${redact(String((e as Error)?.message ?? e))}`));
  }

  /** Marks the booked intro shown, recording first what it was, so the undo puts back the status and the rep's own mark. */
  async function countMark(room: RoomRow, claimedAt: string, apptId: string, host: Who, appt: Row | null, marks: Row[]): Promise<void> {
    let mayMark: boolean;
    try {
      mayMark = await hostMayMark(room, appt, host);
    } catch (e) {
      // The maker's seat not read: nothing was written, so the claim goes back.
      io.log(`rooms: whose intro it is could not be read, the count asks again: ${redact(String((e as Error)?.message ?? e))}`);
      await releaseClaim(room, claimedAt);
      return;
    }
    if (!mayMark) {
      // A room carrying another rep's intro (made before room.create checked
      // whose call it is): never marked with a manager's rights.
      await countResult(room, claimedAt, { count_result: "failed", count_appointment_id: null }, "the intro is booked with another rep", {
        plan: "mark",
        appointment_id: apptId,
        reason: "booked_other_rep",
      });
      await raise(`room:${room.id}:count_other_rep`, "room_mark_intro", room, fill(ROOMS_COPY.count_other_rep_alert, { code: room.code }));
      return;
    }
    const prior = marks[0] ?? null;
    // The status the undo puts back: HighLevel's own, else the rep's active
    // mark, else the cockpit's copy (which lags HighLevel by minutes), in the
    // order the calendar view reads them. Nothing readable: no mark now, the
    // claim goes back and the sweep asks again. Never guessed as confirmed.
    const ghl = await ghlAppointment(apptId);
    // The room's own intro, moved in HighLevel since the room was made (the
    // lead rescheduled through HighLevel's link): the join was not for the
    // intro as it is booked now, so it is not marked; a person decides
    // (stress2, round 1, the settle's start check).
    if (apptId === room.appointment_id && ghl) {
      const now = ghl.startTime === undefined || ghl.startTime === null || ghl.startTime === "" ? Number.NaN : ghlTime(ghl.startTime);
      const was = ms(room.appointment_start_at);
      if (Number.isFinite(now) && now > 0 && was !== null && Math.abs(now - was) >= 60 * S) {
        await countResult(room, claimedAt, { count_result: "failed", count_appointment_id: null }, "the intro was moved in HighLevel", {
          plan: "mark",
          appointment_id: apptId,
          moved_to: isoAt(now),
        });
        await raise(`room:${room.id}:mark_intro`, "room_mark_intro", room, fill(ROOMS_COPY.count_mark_moved_alert, { code: room.code }));
        return;
      }
    }
    const status = str20(ghl?.appointmentStatus) ?? str20(prior?.status) ?? str20(appt?.status);
    if (!status) {
      await releaseClaim(room, claimedAt);
      return;
    }
    if (HELD_STATUSES.includes(status.toLowerCase())) {
      // Already held by B2B's rule (a rep's showed, or invalid in HighLevel
      // itself): a disqualified intro is never turned into a show.
      await countResult(room, claimedAt, { count_result: "already_counted", count_appointment_id: null }, "the call was already marked", {
        plan: "mark",
        appointment_id: apptId,
        status,
      });
      return;
    }
    const before: CountBefore = {
      prior_status: status,
      prior_disposition_id: prior?.id ? String(prior.id) : null,
    };
    if (!(await recordBefore(room, "count.marking", claimedAt, { appointment_id: apptId, ...before }, "The booked intro is being marked shown."))) {
      await releaseClaim(room, claimedAt);
      return;
    }
    let made: Row;
    try {
      made = await deps.markAppointment(host, apptId, "showed", { quiet: true, anyRep: true, note: COUNT_MARK_NOTE });
    } catch (e) {
      io.log(`rooms: the booked intro was not marked: ${redact(String((e as Error)?.message ?? e))}`);
      if (e instanceof ApiRefusal && !unclearSend(e)) {
        // Refused for certain (the mark rule: a showed mark more than ten
        // minutes before the start, a call already over): nothing changed,
        // and a person is told which intro to mark (stress2, round 1).
        await countResult(room, claimedAt, { count_result: "failed", count_appointment_id: null }, "the mark was refused", {
          plan: "mark",
          appointment_id: apptId,
          why: redact(e.message).slice(0, 200),
        });
        await raise(`room:${room.id}:mark_intro`, "room_mark_intro", room, fill(ROOMS_COPY.count_mark_refused_alert, { code: room.code }));
        return;
      }
      // Its answer was lost: the cockpit's mark is written first, so it may
      // stand (and HighLevel may have it). Read back, never recorded as
      // failed on a guess, so "That was not the lead" can take it back.
      const back = await io
        .db(`cockpit_sales_dispositions?appointment_id=eq.${enc(apptId)}&superseded_at=is.null&select=id,status,marked_by,note,crm,marked_at&limit=5`)
        .catch(() => null);
      if (back === null) {
        await countResult(room, claimedAt, { count_result: "unclear", count_appointment_id: apptId }, "the mark may have landed", {
          plan: "mark",
          appointment_id: apptId,
        }, before);
        await raise(`room:${room.id}:count_unclear`, "room_count_stuck", room, fill(ROOMS_COPY.count_mark_unclear_alert, { code: room.code }));
        return;
      }
      const mine = back.find(d => d.status === "showed" && lower(d.marked_by) === lower(host.email) && d.note === COUNT_MARK_NOTE);
      if (!mine) {
        // Not a refusal and no mark of ours stands: nothing was written (the
        // mark's first read failed, or its write never landed). Never a final
        // "failed" on a blip (stress2, round 2): the claim goes back so the
        // next minute counts again, and a person is told when it lasts.
        await releaseClaim(room, claimedAt);
        if (io.now() - (ms(room.lead_in_at) ?? io.now()) >= COUNT_STUCK_S * S)
          await raise(`room:${room.id}:count_unread`, "room_count_stuck", room, fill(ROOMS_COPY.count_mark_retry_alert, { code: room.code }));
        return;
      }
      made = mine;
    }
    const own = made.repeated ? null : made.id ? String(made.id) : null;
    if (own)
      await io
        .db(`${EVENTS}?dedupe_key=eq.${enc(`count.marking:${room.id}:${claimedAt}`.slice(0, 300))}`, {
          method: "PATCH",
          body: { detail: { appointment_id: apptId, ...before, own_disposition_id: own } },
          prefer: "return=minimal",
        })
        .catch(() => null);
    const landed = await countResult(
      room,
      claimedAt,
      { count_result: null, count_appointment_id: apptId },
      "the booked intro is marked shown",
      { plan: "mark", appointment_id: apptId },
      { ...before, own_disposition_id: own },
    );
    // The intro is marked: the "mark this intro" alerts of its rooms are answered (stress2, round 1).
    if (landed) await resolveMarkIntroAlerts(apptId);
    // The show counts only once HighLevel has it (B2B's show rate reads
    // HighLevel): tried once more, then a person is told (stress2, round 1).
    if (landed && !(await crmShows(made, apptId))) {
      const again = deps.resendMark ? await deps.resendMark(host, apptId).catch(() => null) : null;
      if (!again || !(await crmShows(again, apptId))) {
        await deps.audit(DESK, "room.count.showed_failed", ROOMS, room.id, null, { appointment_id: apptId }, { crm: String((again ?? made).crm ?? "") });
        await raise(`room:${room.id}:showed_failed`, "room_mark_intro", room, fill(ROOMS_COPY.count_mark_crm_alert, { code: room.code }));
      }
    }
  }

  /** HighLevel has the count's showed mark: its crm says so, or HighLevel's own status (a write whose crm was never recorded). */
  async function crmShows(mark: Row, apptId: string): Promise<boolean> {
    if (crmTook(mark)) return true;
    const hl = await ghlAppointment(apptId);
    return lower(hl?.appointmentStatus ?? hl?.appoinmentStatus) === "showed";
  }

  /** Moves the lead's own booked call to now and marks it shown, recording first its start, end, rep and status. */
  async function countMove(room: RoomRow, claimedAt: string, plan: Extract<CountPlan, { action: "move" }>): Promise<void> {
    const before: CountBefore = {
      from_start: plan.from_start,
      from_end: plan.from_end,
      from_assigned_user_id: plan.from_assigned_user_id,
      from_status: plan.from_status,
    };
    if (!(await recordBefore(room, "count.moving", claimedAt, { appointment_id: plan.appointment_id, ...before, to_start: plan.start }, "The lead's booked call is being moved to now."))) {
      await releaseClaim(room, claimedAt);
      return;
    }
    const path = `/calendars/events/appointments/${enc(plan.appointment_id)}`;
    try {
      await io.ghl("PUT", path, plan.body);
    } catch (e) {
      let moved: boolean | null = false;
      if (unclearSend(e)) {
        const a = await ghlAppointment(plan.appointment_id);
        moved = a ? Math.abs((ghlTime(a.startTime) || 0) - (ms(plan.start) ?? 0)) < 60 * S : null;
      }
      if (moved === false) {
        io.log(`rooms: the booked call was not moved: ${redact(String((e as Error)?.message ?? e))}`);
        await countResult(room, claimedAt, { count_result: "failed", count_appointment_id: null }, "the move failed", { plan: "move", appointment_id: plan.appointment_id });
        return;
      }
      if (moved === null) {
        const landed = await countResult(
          room,
          claimedAt,
          { count_result: "unclear", count_appointment_id: null },
          "the move may have landed",
          { plan: "move", appointment_id: plan.appointment_id },
          { appointment_id: plan.appointment_id, ...before },
        );
        // Taken back already when "That was not the lead" came in meanwhile.
        if (landed)
          await raise(
            `room:${room.id}:count_unclear`,
            "room_count_stuck",
            room,
            fill(ROOMS_COPY.count_move_unclear_alert, { code: room.code, from: whenKuwait(plan.from_start) }),
          );
        return;
      }
    }
    // Moved: it is counted, whatever the showed status does next (confirmed and past counts as shown).
    const landed = await countResult(
      room,
      claimedAt,
      { count_result: "moved", count_appointment_id: plan.appointment_id },
      "the booked call moved to now and marked shown",
      { plan: "move", appointment_id: plan.appointment_id, from_start: plan.from_start },
      before,
    );
    if (landed) await resolveMarkIntroAlerts(plan.appointment_id);
    if (landed) await markShowed(room, plan.appointment_id);
  }

  /** Books the live call on the live (or test) calendar and marks it shown; a lost answer is looked up, never booked again. */
  async function countCreate(room: RoomRow, claimedAt: string, plan: Extract<CountPlan, { action: "create" }>): Promise<void> {
    // Its own record first (fix round 4): a booking whose answer is lost can
    // then be looked for and taken back by "That was not the lead".
    if (!(await recordBefore(room, "count.creating", claimedAt, { calendar_id: plan.calendar_id, start: plan.start }, "A live call is being booked."))) {
      await releaseClaim(room, claimedAt);
      return;
    }
    let id: string | null | undefined = null;
    try {
      const out = await io.ghl("POST", "/calendars/events/appointments", plan.body);
      id = String(out.id ?? obj(out.appointment).id ?? obj(out.event).id ?? "") || null;
      if (!id) throw new GhlError("HighLevel made no booking id", 0);
    } catch (e) {
      if (!unclearSend(e)) {
        io.log(`rooms: the live booking was refused: ${redact(String((e as Error)?.message ?? e))}`);
        await countResult(room, claimedAt, { count_result: "failed", count_appointment_id: null }, "the booking failed", { plan: "create", calendar_id: plan.calendar_id });
        return;
      }
      // HighLevel may have made it: look for it on the lead's calendar before anything else.
      id = await findBooking(String(room.contact_id), plan.calendar_id, plan.start);
      if (!id) {
        const landed = await countResult(
          room,
          claimedAt,
          { count_result: "unclear", count_appointment_id: null },
          "the booking may have been made",
          { plan: "create", calendar_id: plan.calendar_id },
          { calendar_id: plan.calendar_id, start: plan.start },
        );
        if (landed) await raise(`room:${room.id}:count_unclear`, "room_count_stuck", room, fill(ROOMS_COPY.count_unclear_alert, { code: room.code }));
        return;
      }
    }
    const landed = await countResult(
      room,
      claimedAt,
      { count_result: "booked", count_appointment_id: id },
      plan.test ? "booked on the test calendar and marked shown" : "booked as a live call and marked shown",
      { plan: "create", calendar_id: plan.calendar_id, appointment_id: id },
    );
    if (!landed) return;
    const shown = await markShowed(room, id);
    if (!plan.test) await copyLiveBooking(room, id, plan, shown);
  }

  /**
   * The live booking in the cockpit's calendar copy (stress2 round 3,
   * live-intro-missing-from-setter-pay-and-eod): no mirror reads
   * rooms.live_calendar_id, so without this row the setter's pay estimate,
   * the EOD prefill and the calendar pages never see the live intro (D2).
   * Its own calendar id keeps it out of B2B's show-rate targets (D25), which
   * read B2B's calendars only. Origin ghl: made in HighLevel, as bookCreate's
   * row is. Never fatal: the booking stands in HighLevel either way.
   */
  async function copyLiveBooking(room: RoomRow, apptId: string, plan: Extract<CountPlan, { action: "create" }>, shown: boolean): Promise<void> {
    try {
      await io.db("cockpit_sales_appointments?on_conflict=appointment_id", {
        method: "POST",
        body: {
          appointment_id: apptId,
          contact_id: room.contact_id,
          contact_name: cleanText(String(plan.body.title ?? "").replace(/^Live\s*·\s*/, ""), 120) || null,
          calendar_id: plan.calendar_id,
          call_type: room.call_kind === "demo" ? "demo" : "intro",
          start_at: plan.start,
          booked_at: isoAt(io.now()),
          status: shown ? "showed" : "confirmed",
          assigned_user_id: String(plan.body.assignedUserId ?? "") || null,
          origin: "ghl",
          mirrored_at: isoAt(io.now()),
        },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (e) {
      io.log(`rooms: the live booking was not copied to the calendar: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  /**
   * The showed status on a live booking or a moved call, tried twice (a
   * 429 passes in seconds). A call that is still "new" is not held by B2B's
   * rule, so a failure is recorded and a person is told which call to mark.
   */
  async function markShowed(room: RoomRow, apptId: string): Promise<boolean> {
    let last: unknown = null;
    for (let i = 0; i < 2; i++) {
      try {
        await io.ghl("PUT", `/calendars/events/appointments/${enc(apptId)}`, { appointmentStatus: "showed", toNotify: false });
        return true;
      } catch (e) {
        last = e;
        if (i === 0) await io.sleep(2 * S);
      }
    }
    io.log(`rooms: the showed status was not written: ${redact(String((last as Error)?.message ?? last))}`);
    await deps.audit(DESK, "room.count.showed_failed", ROOMS, room.id, null, { appointment_id: apptId }, {
      error: redact(String((last as Error)?.message ?? last)).slice(0, 300),
    });
    await raise(`room:${room.id}:showed_failed`, "room_mark_intro", room, fill(ROOMS_COPY.showed_failed_alert, { code: room.code }));
    return false;
  }

  /**
   * Carries out one undo plan. Never a mark of invalid, which B2B counts as
   * shown. A delete HighLevel answers 404 or 410 to is already gone (a
   * first try whose answer was lost); a move back or a status write whose
   * answer was lost is read back before it counts as failed.
   */
  async function undoPlan(room: RoomRow, before: unknown): Promise<boolean> {
    const plan = countUndo(room, before);
    if (plan.action === "none") {
      if (plan.reason === "moved_from_unknown" || plan.reason === "unmark_unknown" || plan.reason === "unclear_unknown") {
        // The count changed the lead's own call and its record of how the call
        // was before is missing: nothing can be put back by guessing. The
        // count stays as it is (never "undone"), and a person is told.
        await raise(`room:${room.id}:undo_unknown`, "room_count_stuck", room, fill(ROOMS_COPY.undo_unknown_alert, { code: room.code }));
        return false;
      }
      return plan.reason !== "in_flight";
    }
    if (plan.action === "delete" || plan.action === "find_delete") {
      let id: string | null | undefined = plan.action === "delete" ? plan.appointment_id : null;
      if (plan.action === "find_delete") {
        // A booking whose answer was lost: looked for first. Not readable:
        // nothing is called undone (the sweep asks again; a person is told
        // after ten minutes by undo_stuck).
        id = await findBooking(String(room.contact_id), plan.calendar_id, plan.start);
        if (id === undefined) throw new Error("the lead's calendar could not be read");
        if (!id) return true;
      }
      try {
        await io.ghl("DELETE", `/calendars/events/${enc(id as string)}`);
      } catch (e) {
        const status = (e as { status?: unknown })?.status;
        if (status !== 404 && status !== 410) throw e;
      }
      // Its row in the calendar copy goes too (copyLiveBooking), so the pay
      // estimate and the EOD never count a live call that was taken back.
      await io.db(`cockpit_sales_appointments?appointment_id=eq.${enc(id as string)}&origin=eq.ghl`, { method: "DELETE", prefer: "return=minimal" });
      return true;
    }
    if (plan.action === "move_back") {
      const startMs = ms(plan.start) as number;
      const end = plan.end ?? isoAt(startMs + (room.call_kind === "demo" ? 45 : 15) * 60 * S);
      // Every mark of the call made after the count's claim was made on the
      // call as the count had put it (at the join): it is about the join, not
      // about the call that goes back to its own time (stress2 round 3,
      // move-undo-leaves-rep-mark-on-future-intro). The call goes back whole,
      // its status too, and those marks are superseded; the person's own are
      // kept in this undo's audit row. Read first: never undone over marks unread.
      const afterClaim = await marksAfterClaim(room, plan.appointment_id);
      try {
        await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, {
          startTime: plan.start,
          endTime: end,
          ...(plan.assigned_user_id ? { assignedUserId: plan.assigned_user_id } : {}),
          appointmentStatus: plan.status,
          ignoreFreeSlotValidation: true,
          ignoreDateRange: true,
          toNotify: false,
        });
      } catch (e) {
        const a = unclearSend(e) ? await ghlAppointment(plan.appointment_id) : null;
        if (!a || Math.abs((ghlTime(a.startTime) || 0) - startMs) >= 60 * S) throw e;
      }
      await supersedeAfterClaim(room, plan.appointment_id, afterClaim);
      return true;
    }
    // A person marked the call after the count (a no-show in the dialer, say):
    // their status stands in HighLevel, and only the count's own row is
    // taken back below (stress2, round 1, undo-overwrites-later-rep-mark).
    if (!(await markedAfterCount(room, plan.appointment_id, plan)))
      await io.ghl("PUT", `/calendars/events/appointments/${enc(plan.appointment_id)}`, { appointmentStatus: plan.status, toNotify: false });
    // Only the count's own mark is taken back; the mark that was there before comes back.
    const now = isoAt(io.now());
    if (plan.own_disposition_id)
      await io.db(`cockpit_sales_dispositions?id=eq.${enc(plan.own_disposition_id)}&superseded_at=is.null`, {
        method: "PATCH",
        body: { superseded_at: now },
        prefer: "return=minimal",
      });
    else
      await io.db(
        `cockpit_sales_dispositions?appointment_id=eq.${enc(plan.appointment_id)}&status=eq.showed&note=eq.${enc(COUNT_MARK_NOTE)}&superseded_at=is.null${plan.prior_disposition_id ? `&id=neq.${enc(plan.prior_disposition_id)}` : ""}`,
        { method: "PATCH", body: { superseded_at: now }, prefer: "return=minimal" },
      );
    if (plan.prior_disposition_id) {
      const active = await io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(plan.appointment_id)}&superseded_at=is.null&select=id&limit=1`);
      if (!active.length)
        await io.db(`cockpit_sales_dispositions?id=eq.${enc(plan.prior_disposition_id)}`, {
          method: "PATCH",
          body: { superseded_at: null },
          prefer: "return=minimal",
        });
    }
    return true;
  }

  /**
   * The marks of a call made at or after the count's claim, oldest first.
   * Throws when they cannot be read.
   */
  async function marksAfterClaim(room: RoomRow, apptId: string): Promise<Row[]> {
    const claimed = ms(room.count_claimed_at);
    if (claimed === null) return [];
    return await io.db(
      `cockpit_sales_dispositions?appointment_id=eq.${enc(apptId)}&marked_at=gte.${enc(isoAt(claimed))}&select=id,status,note,marked_by,marked_at,superseded_at&order=marked_at.asc&limit=20`,
    );
  }

  /**
   * A moved call put back: every mark made on it since the count's claim is
   * superseded (the count's own and a person's, all about the join), the
   * mark it had before the count is current again, and a person's marks are
   * named in an audit row (stress2 round 3).
   */
  async function supersedeAfterClaim(room: RoomRow, apptId: string, marks: Row[]): Promise<void> {
    const active = marks.filter(d => !d.superseded_at).map(d => String(d.id ?? "")).filter(Boolean);
    if (active.length)
      await io.db(`cockpit_sales_dispositions?id=in.(${active.map(enc).join(",")})&superseded_at=is.null`, {
        method: "PATCH",
        body: { superseded_at: isoAt(io.now()) },
        prefer: "return=minimal",
      });
    const claimed = ms(room.count_claimed_at);
    if (claimed !== null) {
      const current = await io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(apptId)}&superseded_at=is.null&select=id&limit=1`);
      if (!current.length) {
        const prior = (
          await io.db(
            `cockpit_sales_dispositions?appointment_id=eq.${enc(apptId)}&marked_at=lt.${enc(isoAt(claimed))}&select=id&order=marked_at.desc&limit=1`,
          )
        )[0];
        if (prior?.id)
          await io.db(`cockpit_sales_dispositions?id=eq.${enc(String(prior.id))}`, { method: "PATCH", body: { superseded_at: null }, prefer: "return=minimal" });
      }
    }
    const persons = marks.filter(d => !(d.note === COUNT_MARK_NOTE && d.status === "showed"));
    if (persons.length)
      await deps.audit(DESK, "room.count.undo.marks", "cockpit_sales_dispositions", apptId, {
        marks: persons.map(d => ({ id: d.id, status: d.status, marked_by: d.marked_by, marked_at: d.marked_at })),
      }, { superseded: true, why: "the call went back to its own time; these marks were made on the join" }, { room_id: room.id });
  }

  /**
   * A person's mark of the call stands after the count's own: the active
   * disposition is neither the count's mark (its own id, or its note) nor
   * the one that was there before the count. Throws when the marks cannot be
   * read (the undo asks again; never a status written over a mark unread).
   */
  async function markedAfterCount(
    room: RoomRow,
    apptId: string,
    plan: { own_disposition_id: string | null; prior_disposition_id: string | null } | null,
  ): Promise<boolean> {
    const active = await io.db(
      `cockpit_sales_dispositions?appointment_id=eq.${enc(apptId)}&superseded_at=is.null&select=id,status,note,marked_at&limit=5`,
    );
    const claimed = ms(room.count_claimed_at);
    return active.some(d => {
      const id = String(d.id ?? "");
      if (plan?.own_disposition_id && id === plan.own_disposition_id) return false;
      if (plan?.prior_disposition_id && id === plan.prior_disposition_id) return false;
      if (d.note === COUNT_MARK_NOTE && d.status === "showed") return false;
      // A move's undo: only a mark made after the count's claim is a person's answer to it.
      if (!plan) return claimed === null || (ms(d.marked_at) ?? 0) >= claimed;
      return true;
    });
  }

  /** The count's own record of what it changed (count.moving, count.marking, or an older count.moved). */
  /**
   * The count's own record of what it changed (count.moving, count.marking,
   * or an older count.moved). A read that fails throws: "no record" is only
   * ever an answer the database gave, never a read that did not happen.
   */
  async function countBefore(roomId: string): Promise<Row | undefined> {
    const rows = await io.db(
      `${EVENTS}?room_id=eq.${enc(roomId)}&kind=in.(count.moving,count.marking,count.moved,count.creating)&select=kind,detail&order=at.desc&limit=1`,
    );
    return rows[0]?.detail as Row | undefined;
  }

  async function runUndo(roomId: string): Promise<void> {
    const room = await readRoom(roomId);
    if (!room) return;
    try {
      const before =
        room.count_result === "moved" || room.count_result === "unclear" || (!room.count_result && room.count_appointment_id)
          ? await countBefore(roomId)
          : undefined;
      const did = await undoPlan(room, before ?? null);
      if (!did) return;
    } catch (e) {
      io.log(`rooms: the undo failed, the sweep asks again: ${redact(String((e as Error)?.message ?? e))}`);
      const undoAt = ms(room.count_undo_at);
      if (undoAt !== null && io.now() - undoAt >= 10 * 60 * S)
        await raise(`room:${room.id}:undo_stuck`, "room_count_stuck", room, fill(ROOMS_COPY.undo_stuck_alert, { code: room.code }));
      return;
    }
    const w = countUndone(room);
    const landed = await patchRoom(room.id, w.patch, w.expect);
    if (landed) {
      await deps.audit(DESK, "room.count.undo", ROOMS, room.id, { count_result: room.count_result }, {
        count_result: "undone",
        appointment_id: room.count_appointment_id ?? null,
      });
      await note(room.id, "count.undone", EVENT_TEXT.undone, {}, `count.undone:${room.id}:${room.count_claimed_at ?? ""}`);
      // The count is taken back, whatever it was: its "check the calendar",
      // "could not count yet" and "a manager counts it" alerts are over
      // (stress2, round 2: a hand-pressed join's confirm alert stayed open
      // after That was not the lead).
      await resolveAlerts(room.id, ["count_unclear", "count_unread", "count_confirm"]);
      await reopenSiblings(room);
    }
  }

  /**
   * After an undo lands, the lead's other rooms that were told "already
   * counted" (by the count this undo took back) are counted again: their
   * claim goes back to undone, so their own count runs now and the sweep's
   * re-ask covers a run that is cut off. A real join is never left counted
   * nowhere; one that is still covered by another count is told so again.
   */
  async function reopenSiblings(room: RoomRow): Promise<void> {
    const joined = ms(room.lead_in_at);
    if (!room.contact_id || joined === null) return;
    try {
      const rows = (await io.db(
        `${ROOMS}?contact_id=eq.${enc(room.contact_id)}&id=neq.${enc(room.id)}&count_result=eq.already_counted&lead_in_at=gte.${enc(isoAt(joined - SIBLING_JOIN_H * 3_600_000))}&lead_in_at=lte.${enc(isoAt(joined + SIBLING_JOIN_H * 3_600_000))}&select=*&limit=20`,
      )) as unknown as RoomRow[];
      for (const r of rows) {
        if (!leadJoined(r)) continue;
        const open = await patchRoom(r.id, { count_result: "undone" }, { count_result: "already_counted", count_claimed_at: r.count_claimed_at ?? null });
        if (!open) continue;
        await deps.audit(DESK, "room.count.reopen", ROOMS, r.id, { count_result: "already_counted" }, { count_result: "undone" }, {
          because_room_id: room.id,
        });
        io.background(runCount(r.id));
      }
    } catch (e) {
      io.log(`rooms: a sibling room's count was not reopened: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  // ------------------------------------------------------------- availability and presence

  async function presenceOfSeat(email: string, now: number): Promise<Row> {
    const p = (await io.db(`cockpit_sales_presence?email=eq.${enc(email)}&select=*`))[0] ?? null;
    const me: Row = {
      email,
      state: ["on_call", "ready", "available", "away"].includes(String(p?.state)) ? p?.state : "away",
      until: p?.until ?? null,
      room_id: p?.room_id ?? null,
      zoom_status: ["licensed", "basic", "pending", "missing"].includes(String(p?.zoom_status)) ? p?.zoom_status : null,
      default_provider: isProvider(p?.default_provider) ? p?.default_provider : "meet",
      reason: null,
      booked_at: null,
      booked_kind: null,
    };
    // The view is the one source (contract-v2 S5): it carries reason,
    // booked_at and booked_kind itself. The reads below stand in only for a
    // view built before those columns.
    if (p && "reason" in p) {
      const reason = String(p.reason ?? "");
      me.reason = ["missed_offer", "expired", "booked_call_soon"].includes(reason) ? reason : null;
      me.booked_at = me.reason === "booked_call_soon" ? (p.booked_at ?? null) : null;
      me.booked_kind = me.reason === "booked_call_soon" && isCallKind(p.booked_kind) ? p.booked_kind : null;
      return me;
    }
    const why = String(p?.availability_reason ?? "");
    if (me.state === "away" && (why === "missed_offer" || why === "expired")) me.reason = why;
    if (p?.availability === "available") {
      const last = (await io
        .db(`${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&select=end_reason,state&order=requested_at.desc&limit=1`)
        .catch(() => []))[0];
      if (last?.end_reason === "booked_call_soon") {
        me.reason = "booked_call_soon";
        const person = await personOf(email).catch(() => null);
        if (person?.ghl_user_id) {
          const next = (await io
            .db(
              `cockpit_sales_appointments?assigned_user_id=eq.${enc(String(person.ghl_user_id))}&start_at=gte.${enc(isoAt(now - 30 * 60 * S))}&status=in.(new,confirmed)&select=start_at,call_type&order=start_at.asc&limit=1`,
            )
            .catch(() => []))[0];
          if (next) {
            me.booked_at = next.start_at ?? null;
            me.booked_kind = isCallKind(next.call_type) ? next.call_type : null;
          }
        }
      }
    }
    return me;
  }

  async function liveAvailability(who: Who, b: Row): Promise<Row> {
    const state = String(b.state ?? "");
    if (state !== "available" && state !== "away") throw no("bad_input");
    const email = lower(who.email);
    const { rooms: setting, live } = await roomsAndLive();
    if (!setting.enabled && !liveOn(live)) throw no("disabled");
    const now = io.now();
    const before = (await io.db(`cockpit_sales_availability?email=eq.${enc(email)}&select=*`))[0] ?? null;
    // Live calls run in live.hours only (Saturday to Thursday, 10:00 to
    // 20:00 Kuwait, as shipped): outside them a press makes nobody Available
    // and no standby room, and the strip says when live calls run.
    const window = liveWindow(live.hours, now);
    if (state === "available" && !window.open) {
      await deps.audit(who, "live.availability.refused", "cockpit_sales_availability", email, before, null, { why: "outside_hours" });
      const said = outsideHoursText(live.hours);
      await keepStandbyError(email, said, now);
      return { me: await presenceOfSeat(email, now), standby_error: said };
    }
    const until =
      state === "available" ? isoAt(Math.min(now + setting.available_hours * 3_600_000, window.ends_at ?? Number.POSITIVE_INFINITY)) : null;
    // The last press's sentence goes with this press (20261004a's columns;
    // a database without them yet takes the press as before).
    await io
      .db("cockpit_sales_availability?on_conflict=email", {
        method: "POST",
        body: { email, state, until, via: "cockpit", reason: null, standby_error: null, standby_error_at: null },
        prefer: "resolution=merge-duplicates,return=minimal",
      })
      .catch(async e => {
        if (!(e instanceof DbError && /standby_error/.test(e.message))) throw e;
        await io.db("cockpit_sales_availability?on_conflict=email", {
          method: "POST",
          body: { email, state, until, via: "cockpit", reason: null },
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      });
    await deps.audit(who, "live.availability", "cockpit_sales_availability", email, before, { state, until });
    let standbyError: string | null = null;
    const mine = (await io.db(`${ROOMS}?host_email=eq.${enc(email)}&state=in.(${LIVE_STATES})&select=*`)) as unknown as RoomRow[];
    if (state === "away") {
      for (const r of standbyToEnd(mine, email)) {
        // Decided on every try from the row as it is: a Take may adopt the
        // room for a lead between the read and the write, and then it stays.
        const out = await applyLoop(r.id, cur => (standbyEmpty(cur) ? { kind: "end", reason: "end" } : null), setting, r);
        if ("applied" in out && out.applied.changed) {
          await deps.audit(who, "room.end", ROOMS, r.id, { state: out.applied.from }, { state: out.applied.to }, { reason: "away" });
          // Away's own close, told apart from the cockpit's or Zoom's (the
          // ten minutes' fresh try reads it: stress2 round 3).
          await note(r.id, "room.end", ROOMS_COPY.standby_away, { reason: "away" }, `room.end:${r.id}`);
          await carryOut(out.room, out.applied.effects);
        }
      }
    } else if (
      setting.enabled &&
      liveOn(live) &&
      live.standby !== false &&
      !mine.some(r => r.purpose === "standby") &&
      until !== null &&
      (ms(until) as number) - now < setting.waits_s.standby_host * S
    ) {
      // Available for less than a host needs to come into a room (the live
      // window ends soon): no standby room, the same rule as the sweep's
      // fresh room (R5). A meeting nobody comes into is never made.
      standbyError = fill(ROOMS_COPY.standby_too_late, { minutes: Math.round(setting.waits_s.standby_host / 60) });
    } else if (
      setting.enabled &&
      liveOn(live) &&
      live.standby !== false &&
      !mine.some(r => r.purpose === "standby") &&
      (await seatBookedSoon(email, now, setting)) !== null
    ) {
      // The seat's own booked call starts inside booked_guard: the sweep's R6
      // would end a standby room within the minute, so none is made (stress2,
      // round 2); a meeting nobody comes into is never made.
      const soon = (await seatBookedSoon(email, now, setting)) as number;
      standbyError = fill(ROOMS_COPY.standby_booked_soon, { at: kuwaitClock(soon) });
    } else if (setting.enabled && liveOn(live) && live.standby !== false && !mine.some(r => r.purpose === "standby")) {
      const [{ row: hostRow }, person] = await Promise.all([hostFacts(email, now), personOf(email).catch(() => null)]);
      const role = String(person?.role ?? who.role ?? "");
      if (hostRow && (role === "closer" || role === "both" || role === "setter")) {
        const provider = defaultProvider(role, hostRow as never, setting);
        // One standby room per seat in each ten minutes, and at most
        // STANDBY_PER_HOUR in an hour (final review, standby-flood): every
        // room is a new meeting on the rep's own Zoom or Google, and Zoom caps
        // meeting creates per user per day, so pressing Available and Away
        // over and over must not spend the rep's rooms for the rest of the
        // day. A press inside the same ten minutes is the same request: it
        // answers that room, and when Away has closed it, says so.
        const bucket = Math.floor(now / STANDBY_BUCKET_MS);
        const lastHour = await io
          .db(
            `${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&requested_at=gte.${enc(isoAt(now - 60 * 60_000))}&select=id&limit=${STANDBY_PER_HOUR}`,
          )
          .then(rows => rows.length)
          .catch(() => 0);
        const ask = async (rid: string) =>
          await createRoom({
            who,
            host: email,
            request_id: rid,
            purpose: "standby",
            provider,
            call_kind: role === "closer" ? "demo" : "intro",
            contact_id: null,
            setting,
          });
        let made = lastHour >= STANDBY_PER_HOUR ? null : await ask(await uuidFrom(`mahara-room/standby/${email}/${bucket}`));
        // The ten minutes' room failed (the worker could not make it: a
        // provider's blip), or the sweep closed it (nobody pressed I'm in in
        // time): that is not a room Away closed, so one fresh try goes on its
        // own request id (still counted in the hour), and when it fails too
        // the strip says the worker's own sentence (stress2, round 1).
        // A room the cockpit closed for a lead's link, or Zoom ended, is not
        // one Away closed either (stress2 round 3): it gets the fresh try too.
        if (
          made &&
          !("refused" in made) &&
          (made.room.state === "failed" || sweptForNoHost(made.room) || (isFinal(made.room.state) && !(await closedByAway(made.room.id))))
        ) {
          const first = made.room;
          if (lastHour + 1 < STANDBY_PER_HOUR) made = await ask(await uuidFrom(`mahara-room/standby/${email}/${bucket}/after/${first.id}`));
          if (!("refused" in made) && made.room.state === "failed")
            made = { refused: { ...refuse("worker_down"), message: (made.room.error as string | null) ?? LANE_COPY.worker_failed } };
        }
        if (made === null || (!("refused" in made) && isFinal(made.room.state))) {
          // Four rooms this hour already, or the same ten minutes' room was
          // closed by Away: no new meeting yet, and the strip says why.
          standbyError = ROOMS_COPY.standby_flood;
          await deps.audit(who, "live.standby.refused", ROOMS, email, null, null, { why: made === null ? "per_hour" : "same_ten_minutes" });
        } else if ("refused" in made) {
          // Two presses at once (the phone and the laptop): the other one's standby room is this seat's room too.
          const other =
            made.refused.code === "host_has_room"
              ? await io
                  .db(`${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&state=in.(${LIVE_STATES})&select=id&limit=1`)
                  .catch(() => [])
              : [];
          if (!other.length) standbyError = made.refused.message;
        } else {
          // Away pressed on another device while this room was being asked
          // for: the last press wins, so the standby room it would leave
          // behind (the worker would make a meeting nobody is in) ends now.
          const after = (await io.db(`cockpit_sales_availability?email=eq.${enc(email)}&select=state`).catch(() => []))[0];
          if (after && after.state !== "available") {
            const out = await applyLoop(made.room.id, cur => (standbyEmpty(cur) ? { kind: "end", reason: "end" } : null), setting, made.room);
            if ("applied" in out && out.applied.changed) {
              await deps.audit(who, "room.end", ROOMS, made.room.id, { state: out.applied.from }, { state: out.applied.to }, { reason: "away" });
              await carryOut(out.room, out.applied.effects);
            }
          }
        }
      }
    }
    if (standbyError) await keepStandbyError(email, standbyError, now);
    const me = await presenceOfSeat(email, now);
    return standbyError ? { me, standby_error: standbyError } : { me };
  }

  /**
   * Why the press made no standby room, kept on the seat's availability row
   * so every device and every read of live.status says it (stress2, round
   * 1: the browser dropped it, and the strip showed the same button with no
   * reason). Best effort: a database without the columns keeps the answer.
   */
  async function keepStandbyError(email: string, said: string, now: number): Promise<void> {
    await io
      .db("cockpit_sales_availability?on_conflict=email", {
        method: "POST",
        body: { email, standby_error: said.slice(0, 300), standby_error_at: isoAt(now) },
        prefer: "resolution=merge-duplicates,return=minimal",
      })
      .catch(e => io.log(`rooms: the standby sentence was not kept: ${redact(String((e as Error)?.message ?? e))}`));
  }

  /** A standby room the sweep closed because nobody pressed I'm in (R3): no room Away closed. */
  /** A standby room Away closed (its room.end line says so); not readable: read as Away's, so no room is made on a guess. */
  async function closedByAway(roomId: string): Promise<boolean> {
    try {
      const row = (await io.db(`${EVENTS}?dedupe_key=eq.${enc(`room.end:${roomId}`)}&select=detail`))[0];
      return obj(row?.detail).reason === "away";
    } catch {
      return true;
    }
  }

  /** A closed room the banner keeps for a while: it failed, or the lead knocked and was not let in. */
  function bannerKeeps(room: RoomRow): boolean {
    if (room.state === "failed" || (room.state === "cancelled" && room.result === "failed" && room.error)) return true;
    return (room.state === "expired" || room.state === "ended") && Boolean(room.lead_waiting_at || room.result === "admit_blocked");
  }

  function sweptForNoHost(room: RoomRow): boolean {
    return room.state === "expired" && room.end_reason === "host_not_in";
  }

  async function offersFor(email: string, now: number): Promise<Row[]> {
    const rows = await io.db(
      `cockpit_sales_live?state=eq.offered&offer_until=gt.${enc(isoAt(now))}&offered_to=cs.${enc(`{${email}}`)}&select=id,version,kind,contact_id,reason,note,offer_until,declined_by&order=offer_until.asc&limit=5`,
    );
    const open = rows.filter(r => !(Array.isArray(r.declined_by) && (r.declined_by as string[]).includes(email)));
    if (!open.length) return [];
    const leads = await io
      .db(`cockpit_sales_leads?contact_id=in.(${open.map(r => `"${enc(String(r.contact_id))}"`).join(",")})&select=contact_id,name,country`)
      .catch(() => []);
    const by = new Map(leads.map(l => [String(l.contact_id), l]));
    return open.map(r => {
      const l = by.get(String(r.contact_id));
      return {
        id: r.id,
        version: r.version,
        kind: r.kind,
        contact_first_name: greetingName(null, l?.name) || null,
        company: null,
        country: (l?.country as string | null) ?? null,
        reason: r.reason,
        note: r.note ?? null,
        offer_until: r.offer_until,
      };
    });
  }

  async function liveStatus(who: Who, _b: Row): Promise<Row> {
    const email = lower(who.email);
    const { rooms: setting, live } = await roomsAndLive();
    const liveEnabled = liveOn(live);
    if (!setting.enabled && !liveEnabled) throw no("disabled");
    const now = io.now();
    const [me, mine, offers, h, avail, lately] = await Promise.all([
      presenceOfSeat(email, now),
      io.db(`${ROOMS}?host_email=eq.${enc(email)}&state=in.(${LIVE_STATES})&select=*&order=requested_at.desc&limit=10`),
      liveEnabled ? offersFor(email, now) : Promise.resolve([]),
      health(now),
      io.db(`cockpit_sales_availability?email=eq.${enc(email)}&select=*`).catch(() => []),
      // A lead's room of this seat that failed, or closed on a knock nobody
      // let in, in the last 15 minutes (stress2 round 3): the banner keeps it
      // until the rep opens the lead, so a rep who moved on is told the lead
      // got no link, or knocked. Not read: only the live rooms.
      io
        .db(
          `${ROOMS}?host_email=eq.${enc(email)}&contact_id=not.is.null&purpose=neq.standby&state=in.(failed,expired,ended,cancelled)` +
            `&ended_at=gte.${enc(isoAt(now - RECENT_FINAL_MS))}&select=*&order=ended_at.desc&limit=5`,
        )
        .then(rows => rows.filter(r => bannerKeeps(r as unknown as RoomRow)))
        .catch(() => [] as Row[]),
    ]);
    let standbyError: string | null = null;
    const a = avail[0];
    // The press's own sentence (live.availability keeps it): while the seat
    // is Available, and for ten minutes after an Away press was refused.
    const kept = typeof a?.standby_error === "string" && a.standby_error ? String(a.standby_error) : null;
    const keptAt = ms(a?.standby_error_at);
    // "Closed under 10 minutes ago" holds only while its ten minutes last
    // (stress2 round 3): after them Get my room makes a room, so the strip
    // never says it for the rest of the two hours.
    const floodOver =
      kept === ROOMS_COPY.standby_flood && keptAt !== null && Math.floor(keptAt / STANDBY_BUCKET_MS) !== Math.floor(now / STANDBY_BUCKET_MS);
    if (kept && !floodOver && (a?.state === "available" || (keptAt !== null && now - keptAt < 10 * 60_000))) standbyError = kept;
    if (!standbyError && a?.state === "available" && !(mine as Row[]).some(r => r.purpose === "standby")) {
      const last = (await io
        .db(
          `${ROOMS}?host_email=eq.${enc(email)}&purpose=eq.standby&requested_at=gte.${enc(String(a.updated_at))}&select=state,error,end_reason,ended_at,provider&order=requested_at.desc&limit=1`,
        )
        .catch(() => []))[0];
      if (last?.state === "failed") standbyError = (last.error as string | null) ?? LANE_COPY.worker_failed;
      // The sweep closed it because nobody pressed I'm in (a Meet room sends
      // no join signal): said, with the way to a room again (stress2, round 1).
      else if (last && last.end_reason === "host_not_in")
        standbyError = fill(last.provider === "zoom" ? ROOMS_COPY.standby_host_not_in_zoom : ROOMS_COPY.standby_host_not_in, {
          at: kuwaitClock(ms(last.ended_at) ?? now),
        });
    }
    return {
      // The seat's own last press beside the view's state (stress2, round 2):
      // an Away seat with a booked call never had a room to close.
      me: { ...me, availability: a?.state === "available" ? "available" : "away" },
      rooms: await views([...(mine as unknown as RoomRow[]), ...(lately as unknown as RoomRow[])], setting),
      offers,
      health: h,
      live_enabled: liveEnabled,
      // Whether Available makes a standby room at all (the strip offers
      // "Get my room" only then: stress2, round 1).
      standby_on: setting.enabled && liveEnabled && live.standby !== false,
      standby_error: standbyError,
      now: isoAt(now),
    };
  }

  // ------------------------------------------------------------- the handover take

  async function finishClaim(who: Who, l: Row, setting: RoomsSetting): Promise<Row> {
    const via = String(l.claim_room ?? "none");
    if (via === "busy") return { claim_room: via, line: ROOMS_COPY.claim_busy };
    if (via === "lead_room" && l.room_id) {
      const r = await readRoom(String(l.room_id));
      return { claim_room: via, ...(r ? { room: await view(r, setting) } : {}) };
    }
    if ((via === "standby" || via === "own_room") && l.room_id) {
      // The claim RPC adopted the room; the link is due once the taker is in
      // it (send_on). A room still being made sends when the worker opens it.
      const r = await readRoom(String(l.room_id));
      if (!r) return { claim_room: via };
      if (r.state !== "open" && r.state !== "host_in") return { claim_room: via, room: await view(r, setting) };
      const out = await applyLoop(r.id, () => ({ kind: "ready" }), setting, r);
      if ("applied" in out) {
        if (out.applied.changed) {
          await deps.audit(who, "live.room.ready", ROOMS, out.room.id, { state: out.applied.from }, {
            state: out.applied.to,
            link_claimed: Boolean(out.applied.patch.link_claimed_at),
          }, { handover_id: String(l.id), claim_room: via });
          await carryOut(out.room, out.applied.effects);
        }
        return { claim_room: via, room: await view(out.room, setting) };
      }
      return { claim_room: via, room: await view(out.room ?? r, setting) };
    }
    // none: the taker's room for this handover. The claim reserved it in its
    // own transaction (20261003d: a requested row on this request id), so
    // createRoom finds it as a repeat and writes its audit row and line; a
    // claim that could not reserve it (an older database, a race) makes it here.
    const taker = lower(String(l.claimed_by ?? who.email));
    const [{ row: hostRow }, person] = await Promise.all([hostFacts(taker, io.now()), personOf(taker).catch(() => null)]);
    const provider = defaultProvider(person?.role ?? "closer", hostRow as never, setting, isCallKind(l.kind) ? l.kind : "demo");
    const reoffers = Number(l.reoffers ?? 0);
    const made = await createRoom({
      who,
      host: taker,
      request_id: reoffers > 0 ? await uuidFrom(`mahara-live/${l.id}/${reoffers}`) : String(l.id),
      purpose: "handover",
      provider,
      call_kind: isCallKind(l.kind) ? l.kind : "demo",
      contact_id: String(l.contact_id),
      handover_id: String(l.id),
      setting,
    });
    if ("refused" in made) return { claim_room: via, line: made.refused.message };
    // Video rooms switched off: the room the claim reserved is never made, so
    // it is cancelled now and the closer is told (the handover ends in L2).
    if (!setting.enabled && (made.room.state === "requested" || made.room.state === "creating")) {
      const out = await applyLoop(made.room.id, cur => (cur.state === "requested" || cur.state === "creating" ? { kind: "end", reason: "cancel" } : null), setting, made.room);
      if ("applied" in out && out.applied.changed)
        await deps.audit(who, "room.end", ROOMS, made.room.id, { state: out.applied.from }, { state: out.applied.to }, { reason: "rooms_off" });
      return { claim_room: via, line: refuse("disabled").message };
    }
    // A reserved room has no first name yet when the lead had no room: the panel's name, read now (never fatal).
    if (!made.room.contact_first_name && made.room.contact_id) {
      const c = await readContact(made.room.contact_id);
      const name = greetingName(c?.firstName, c?.name);
      if (name)
        made.room =
          (await patchRoom(made.room.id, { contact_first_name: name.slice(0, 80) }, { contact_first_name: null }).catch(() => null)) ?? made.room;
    }
    // The handover points at its room, or the sweep's L2 ends it at claim +
    // 120 s under a live call. A write that fails is not the end: the room is
    // answered, and the live.claimed event stays for the sweep's replay,
    // which links it (the room create is idempotent on this request id).
    let linked = false;
    try {
      const rows = await io.db(`cockpit_sales_live?id=eq.${enc(String(l.id))}&room_id=is.null`, {
        method: "PATCH",
        body: { room_id: made.room.id },
        prefer: "return=representation",
      });
      if (rows.length) await deps.audit(who, "live.room", "cockpit_sales_live", String(l.id), { room_id: null }, { room_id: made.room.id });
      linked = rows.length > 0 || String((await io.db(`cockpit_sales_live?id=eq.${enc(String(l.id))}&select=room_id`))[0]?.room_id ?? "") === made.room.id;
    } catch (e) {
      io.log(`rooms: the handover's room was not linked: ${redact(String((e as Error)?.message ?? e))}`);
    }
    return { claim_room: via, room: await view(made.room, setting), ...(linked ? {} : { [UNLINKED]: true }) };
  }

  /**
   * A closer's answer to an offer that is not a claim (Not now, or a Take
   * that landed after the offer's end): their name goes in declined_by, so
   * the sweep's L1 never makes them Away for a missed offer. Written only
   * while the offer still says offered (the guarded write stops once L1 has
   * moved it), whatever its clock says: the press is the closer's answer.
   * Answers whether the name is there now.
   */
  async function noteAnswer(who: Who, liveId: string, why: "not_now" | "late_take"): Promise<boolean> {
    const email = lower(who.email);
    // Each try that misses lost to another answer that landed, so every
    // closer the offer went to gets through within that many tries.
    let tries = MAX_WRITE_TRIES;
    for (let i = 0; i < tries; i++) {
      const l = (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=id,state,offer_until,offered_to,declined_by`))[0];
      const offered = Array.isArray(l?.offered_to) ? (l.offered_to as string[]) : [];
      tries = Math.min(60, MAX_WRITE_TRIES + offered.length);
      if (l?.state !== "offered" || !offered.includes(email)) return false;
      const declined = Array.isArray(l.declined_by) ? (l.declined_by as string[]) : [];
      if (declined.includes(email)) return true;
      const next = [...declined, email];
      const rows = await io.db(
        `cockpit_sales_live?id=eq.${enc(liveId)}&state=eq.offered&declined_by=eq.${enc(`{${declined.join(",")}}`)}`,
        { method: "PATCH", body: { declined_by: next }, prefer: "return=representation" },
      );
      if (rows.length) {
        await deps.audit(who, "live.decline", "cockpit_sales_live", liveId, { declined_by: declined }, { declined_by: next }, { why });
        return true;
      }
    }
    throw no("stale");
  }

  async function liveTake(who: Who, b: Row): Promise<Row> {
    // The press is judged by when it reached sales-api, not by when the
    // claim runs after HighLevel's contact read (up to its 15 s) and the
    // rooms read: a Take pressed in time is in time (stress2, round 1).
    const pressedAt = io.now();
    const liveId = roomIdOf(b.live_id);
    requestIdOf(b.request_id);
    const { rooms: setting, live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    const l = (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=*`))[0];
    if (!l) throw plain(OFFER_GONE, 409, "gone");
    const email = lower(who.email);
    // Already this seat's (a second press of the same Take): finish it again.
    if (lower(l.claimed_by) === email && ["claimed", "room_ready", "lead_joined"].includes(String(l.state))) {
      const { [UNLINKED]: _unlinked, ...answer } = await finishClaim(who, l, setting);
      return answer;
    }
    const contact = await readContact(String(l.contact_id));
    const r = adoptRefusal({ setting, contact_id: String(l.contact_id), contact });
    if (r) throw asRefusal(r);
    // The taker already hosts a room that is not their empty standby room, a
    // booked call's room, or this lead's own (an offer made while they were
    // Ready, then a dial and a room for another lead): refused before anything
    // moves, so the setter's room with this lead is never closed for a room
    // the taker cannot have. The claim checks the same under its own lock.
    const mine = await io.db(`${ROOMS}?host_email=eq.${enc(email)}&state=in.(${LIVE_STATES})&purpose=neq.booked&select=id,purpose,contact_id&limit=10`);
    if (mine.some(x => !(x.purpose === "standby" && !x.contact_id) && String(x.contact_id ?? "") !== String(l.contact_id)))
      throw asRefusal(refuse("take_host_busy"));
    let rows: Row[];
    try {
      rows = await claimRpc(liveId, email, pressedAt);
    } catch (e) {
      if (isUnique(e, "cockpit_sales_live_one_claim_per_closer")) throw plain(ROOM_COPY.refusals.live_call_open, 409, "live_call_open");
      if (e instanceof DbError && /take_host_busy/.test(e.message)) throw asRefusal(refuse("take_host_busy"));
      if (e instanceof DbError && e.code === "55P03") throw plain(ROOMS_COPY.claim_locked, 503, "busy", { retry: true });
      throw e;
    }
    const claimed = Array.isArray(rows) ? rows[0] : null;
    if (!claimed) {
      // Empty: someone else holds it, this very seat does (a second press
      // from another tab or a retry raced the first), or the offer is over
      // (its time ran out, the sweep ended it, or a re-offer left this seat
      // out). Only another seat's claim is "taken" (stress2, round 1).
      const now = (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=*`))[0];
      const held = ["claimed", "room_ready", "lead_joined"].includes(String(now?.state));
      if (now && held && lower(now.claimed_by) === email) {
        const out = await finishClaim(who, now, setting);
        const { [UNLINKED]: _unlinked, ...answer } = out;
        return answer;
      }
      if (now && held && now.claimed_by && lower(now.claimed_by) !== email) throw plain(ROOM_COPY.refusals.taken, 409, "taken");
      // The press was this closer's answer: never read as a missed offer.
      await noteAnswer(who, liveId, "late_take").catch(e => io.log(`rooms: a late Take was not noted: ${redact(String((e as Error)?.message ?? e))}`));
      throw plain(OFFER_GONE, 409, "gone");
    }
    const key = `live.claimed:${claimed.id}:${Number(claimed.reoffers ?? 0)}`;
    try {
      const out = await finishClaim(who, claimed, setting);
      const { [UNLINKED]: unlinked, ...answer } = out;
      if (unlinked) await releaseEvent({ dedupe_key: key });
      else await finishEvent({ dedupe_key: key }, {});
      await deps.audit(who, "live.take", "cockpit_sales_live", String(claimed.id), { state: "offered" }, { state: claimed.state, claim_room: claimed.claim_room });
      return answer;
    } catch (e) {
      // The sweep replays live.claimed; every branch is idempotent.
      await releaseEvent({ dedupe_key: key });
      throw e;
    }
  }

  /**
   * cockpit_sales_live_claim with the time the press reached sales-api
   * (20261004a p_at): the claim checks the offer against that moment, at
   * most 30 s back. A database without p_at yet (sales-api deployed before
   * the migration) is asked the old way.
   */
  async function claimRpc(liveId: string, email: string, pressedAt: number): Promise<Row[]> {
    try {
      return (await io.rpc("cockpit_sales_live_claim", { p_live_id: liveId, p_email: email, p_version: null, p_at: isoAt(pressedAt) })) as Row[];
    } catch (e) {
      if (!(e instanceof DbError && (e.code === "PGRST202" || e.status === 404))) throw e;
      return (await io.rpc("cockpit_sales_live_claim", { p_live_id: liveId, p_email: email, p_version: null })) as Row[];
    }
  }

  async function liveDecline(who: Who, b: Row): Promise<Row> {
    const liveId = roomIdOf(b.live_id);
    requestIdOf(b.request_id);
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    // Taken while the offer still says offered, even a moment past its clock
    // (the press left with a second to go): the sweep's L1 moves it once a
    // minute, and until then Not now keeps the closer Available (stress2).
    if (!(await noteAnswer(who, liveId, "not_now"))) throw plain(OFFER_GONE, 409, "gone");
    return {};
  }

  // ------------------------------------------------------------- room.event (desk and cron)

  /**
   * Takes an event for this run (cockpit_sales_room_event_lease), with a
   * token of its own (20261004a, stress2 round 3,
   * lease-release-clears-another-runs-lease): `by.token` is set, and every
   * finish or release of this run is guarded on it, so a run whose lease ran
   * out never gives back (or finishes over) the lease another run took since.
   * A database without 20261004a takes the lease the old way, with no token
   * (`by.token = null`), and its release is not guarded.
   */
  async function lease(by: EventKey, seconds: number): Promise<string | null> {
    const args = { p_event_id: by.id ?? null, p_dedupe_key: by.dedupe_key ?? null, p_seconds: seconds };
    const token = crypto.randomUUID();
    let got: unknown;
    let held: string | null = token;
    try {
      got = await io.rpc("cockpit_sales_room_event_lease", { ...args, p_token: token });
    } catch (e) {
      if (!(e instanceof DbError && (e.code === "PGRST202" || e.status === 404))) throw e;
      got = await io.rpc("cockpit_sales_room_event_lease", args);
      held = null;
    }
    if (typeof got !== "string" || !got) return null;
    by.token = held;
    return got;
  }
  function eventFilter(by: EventKey): string {
    return by.id ? `id=eq.${enc(by.id)}` : `dedupe_key=eq.${enc(String(by.dedupe_key))}`;
  }
  /**
   * A write to an event under the lease this run holds; answers how many
   * rows it changed (0: another run holds the event now). A lease this run
   * took has its token; one the database took for it as it stored the event
   * (live.claimed) has none, and is guarded on having none, so a replay that
   * took it over since is left alone. No token column (a database without
   * 20261004a): unguarded, as before.
   */
  async function heldWrite(by: EventKey, filter: string, body: Row): Promise<number> {
    const write = async (guard: string) =>
      (await io.db(`${EVENTS}?${filter}${guard}&select=id`, { method: "PATCH", body, prefer: "return=representation" })).length;
    if (by.token) return await write(`&lease_token=eq.${enc(by.token)}`);
    if (by.token === null) return await write("");
    try {
      return await write("&lease_token=is.null");
    } catch (e) {
      if (!(e instanceof DbError && /lease_token/.test(e.message))) throw e;
      return await write("");
    }
  }
  async function finishEvent(by: EventKey, detail: Row, text?: string): Promise<void> {
    const cur = (await io.db(`${EVENTS}?${eventFilter(by)}&select=id,detail,text`).catch(() => []))[0];
    if (!cur) return;
    const n = await heldWrite(by, `id=eq.${enc(String(cur.id))}`, {
      handled_at: isoAt(io.now()),
      lease_until: null,
      ...(Object.keys(detail).length ? { detail: { ...obj(cur.detail), ...detail } } : {}),
      ...(!cur.text && text ? { text: text.slice(0, 500) } : {}),
    });
    if (n === 0) io.log(`rooms: event ${String(cur.id)} was left to the run that holds its lease now`);
  }
  async function releaseEvent(by: EventKey): Promise<void> {
    try {
      const n = await heldWrite(by, `${eventFilter(by)}&handled_at=is.null`, { lease_until: null });
      if (n === 0 && by.token) io.log(`rooms: an event's lease had passed to another run, which keeps it`);
    } catch (e) {
      io.log(`rooms: an event's lease was not released: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  /**
   * Released while it only waits (stress2, round 2): another room for the
   * call still open, or a settle posted before the intro's time. Nothing was
   * tried, so the try its lease counted is given back, and the sweep's E0
   * (which gives an event up after its tries) never reads a wait as a
   * failure. Guarded on the count it read, under the lease this run holds.
   */
  async function releaseWaiting(by: EventKey): Promise<void> {
    try {
      const cur = (await io.db(`${EVENTS}?${eventFilter(by)}&handled_at=is.null&select=id,tries`))[0];
      if (!cur) return;
      const tries = Number(cur.tries ?? 0);
      await heldWrite(by, `id=eq.${enc(String(cur.id))}&handled_at=is.null&tries=eq.${tries}`, {
        lease_until: null,
        tries: Math.max(0, tries - 1),
      });
    } catch (e) {
      io.log(`rooms: a waiting event was not released with its try given back: ${redact(String((e as Error)?.message ?? e))}`);
      await releaseEvent(by);
    }
  }

  type Outcome = { ok: true; handled: boolean; room?: Row; skipped?: string } | { ok: false; refusal: ApiRefusal };

  /** A refusal for an event: retry ones leave it for the sweep, final ones are handled and recorded. */
  async function settleRefusal(by: EventKey, r: Refused): Promise<Outcome> {
    if (r.retry) await releaseEvent(by);
    else await finishEvent(by, { refused: { code: r.code, message: r.message } });
    return { ok: false, refusal: asRefusal(r) };
  }

  /**
   * Who is the team in a Zoom meeting (contract S7): every room host and
   * every seat (cockpit_sales_people), so a manager listening in, or a seat
   * whose room_hosts row the host check has not written yet, is never read
   * as the lead. A read that fails throws: the event is left for the replay,
   * never judged against an empty team.
   */
  async function staffCtx(room: RoomRow): Promise<Parameters<typeof zoomEffect>[1]> {
    const [hosts, people] = await Promise.all([
      io.db("cockpit_sales_room_hosts?select=email,zoom_user_id&limit=500"),
      io.db("cockpit_sales_people?select=email&limit=1000"),
    ]);
    const host = hosts.find(h => lower(h.email) === lower(room.host_email));
    return {
      host_email: lower(room.host_email),
      host_zoom_user_id: (host?.zoom_user_id as string | null) ?? null,
      staff_emails: [...new Set([...hosts, ...people].map(h => lower(h.email)).filter(Boolean))],
      staff_zoom_user_ids: hosts.map(h => String(h.zoom_user_id ?? "")).filter(Boolean),
    };
  }

  /**
   * Zoom's event is about this room only when it comes from the room's own
   * meeting (final review, zoom-topic-code-beats-meeting-id): anyone with a
   * user on Mahara's Zoom account can title a meeting "Mahara call K7Q2MX",
   * and the worker's own stray meetings carry the same title. A room whose
   * meeting id is not written yet (still being made) takes the code's word.
   */
  function onRoomMeeting(room: RoomRow, detail: ZoomEvent): boolean {
    if (room.provider !== "zoom") return false;
    const mine = room.provider_meeting_id ? String(room.provider_meeting_id) : null;
    return mine === null || mine === zoomMeetingId(detail);
  }

  async function zoomEvent(eventId: string, held: EventKey | null): Promise<Outcome> {
    const by: EventKey = held ?? { id: eventId };
    if (!held) {
      // Only Zoom's own events (final review, zoom-kind-handles-non-zoom-event):
      // a room.event of a zoom.* kind that names a worker's, a claim's or the
      // door's event is left exactly as it stands, never leased, so its
      // tries are not spent and it is never marked handled.
      const head = (await io.db(`${EVENTS}?id=eq.${enc(eventId)}&select=id,source,kind`))[0];
      if (!head) return { ok: true, handled: false };
      if (String(head.source) !== "zoom" || !String(head.kind ?? "").startsWith("zoom."))
        return { ok: true, handled: false, skipped: "not a Zoom event" };
      if (!(await lease(by, 30))) return { ok: true, handled: false };
    }
    const ev = (await io.db(`${EVENTS}?id=eq.${enc(eventId)}&select=*`))[0];
    if (!ev) return { ok: true, handled: false };
    if (String(ev.source) !== "zoom" || !String(ev.kind ?? "").startsWith("zoom.")) {
      await releaseEvent(by);
      return { ok: true, handled: false, skipped: "not a Zoom event" };
    }
    const detail = obj(ev.detail) as ZoomEvent;
    let room: RoomRow | null = ev.room_id ? await readRoom(String(ev.room_id)) : null;
    if (!room) {
      const meeting = zoomMeetingId(detail);
      const code = zoomCode(detail);
      const found = meeting
        ? ((await io.db(`${ROOMS}?provider_meeting_id=eq.${enc(meeting)}&provider=eq.zoom&select=*&order=requested_at.desc&limit=1`))[0] as unknown as RoomRow | undefined)
        : undefined;
      // By the topic's code only for a Zoom room whose meeting id is not written yet.
      room =
        found ??
        (code
          ? ((await io.db(`${ROOMS}?code=eq.${enc(code)}&provider=eq.zoom&provider_meeting_id=is.null&select=*`))[0] as unknown as RoomRow | undefined)
          : undefined) ??
        null;
      if (room)
        await io.db(`${EVENTS}?id=eq.${enc(eventId)}`, { method: "PATCH", body: { room_id: room.id }, prefer: "return=minimal" });
    }
    const foreign = room !== null && !onRoomMeeting(room, detail);
    if (!room || foreign) {
      // A meeting that is no cockpit room (the webinar, a client call, an
      // interview on the same Zoom account), kept by the door only because its
      // room lookup failed, or another meeting that only names a room's code
      // in its title: nothing of the people in it stays in a table every seat
      // can read, it is taken off the room's timeline, and nothing is applied.
      // The event, its meeting id and time stay for the record.
      const kept = obj(obj(detail.payload).object);
      await io.db(`${EVENTS}?id=eq.${enc(eventId)}`, {
        method: "PATCH",
        body: {
          handled_at: isoAt(io.now()),
          lease_until: null,
          ...(foreign ? { room_id: null } : {}),
          text: foreign
            ? "Zoom: an event for another meeting that names a room's code. Nothing was applied."
            : "Zoom: an event for a meeting that is no cockpit room.",
          detail: {
            event: detail.event ?? null,
            event_ts: detail.event_ts ?? null,
            // No participant and no topic: a topic can name a client or a candidate.
            payload: { object: { id: kept.id ?? null, uuid: kept.uuid ?? null } },
            ...(foreign
              ? { ignored: "another meeting", refused: { code: "another_meeting", message: "This event is from another meeting than the room's own." } }
              : { refused: { code: "no_room", message: "No cockpit room has this meeting." } }),
          },
        },
        prefer: "return=minimal",
      });
      if (foreign)
        await deps.audit(DESK, "room.event.ignored", ROOMS, (room as RoomRow).id, null, null, {
          event_id: eventId,
          reason: "another meeting",
          meeting_id: zoomMeetingId(detail),
        });
      return { ok: true, handled: true, skipped: foreign ? "another meeting" : "no room" };
    }
    const effect = zoomEffect(detail, await staffCtx(room));
    if ("ignore" in effect) {
      await finishEvent(by, { ignored: effect.ignore, role: effect.role });
      return { ok: true, handled: true, skipped: effect.ignore };
    }
    const { rooms: setting } = await roomsAndLive();
    const out = await applyLoop(room.id, () => effect.room_event, setting, room);
    if ("refused" in out) return await settleRefusal(by, out.refused);
    // The event is marked handled, with who joined, before its effects run:
    // the live count reads a Zoom join of the lead as the lead's own evidence.
    await finishEvent(by, { role: effect.role }, eventText(ev));
    if (out.applied.changed) {
      await deps.audit(DESK, `room.event.${String(ev.kind).slice(0, 60)}`, ROOMS, out.room.id, { state: out.applied.from }, { state: out.applied.to }, {
        event_id: eventId,
        role: effect.role,
      });
      await carryOut(out.room, out.applied.effects);
    }
    return { ok: true, handled: true, room: await view(out.room, setting) };
  }

  async function workerEvent(kind: "worker.ready" | "worker.failed", roomId: string, held: EventKey | null, payload: Row): Promise<Outcome> {
    const by: EventKey = held ?? { dedupe_key: `${kind}:${roomId}` };
    if (!held && !(await lease(by, 30))) return { ok: true, handled: false };
    const room = await readRoom(roomId);
    if (!room) {
      await finishEvent(by, { refused: { code: "no_room" } });
      return { ok: true, handled: true, skipped: "no room" };
    }
    const runMismatch = payload.worker_run && room.worker_run && String(payload.worker_run) !== String(room.worker_run)
      ? { worker_run_mismatch: { payload: String(payload.worker_run).slice(0, 80), row: String(room.worker_run).slice(0, 80) } }
      : {};
    if (kind === "worker.failed") {
      if (room.state === "requested" || room.state === "creating") {
        // The worker's own fail write is still in flight; the sweep replays this.
        await releaseEvent(by);
        return { ok: true, handled: false };
      }
      // Failed as the worker said, or it went another way first (a rep's
      // Cancel during creating, another run's open): the room's state is the
      // answer, so the event is finished, never left to be given up as lost.
      await finishEvent(
        by,
        { ...runMismatch, ...(room.state === "failed" ? {} : { skipped: `the room was already ${room.state}` }) },
        KIND_TEXT["worker.failed"],
      );
      return { ok: true, handled: true };
    }
    if (room.state === "requested" || room.state === "creating") {
      // The worker's own open is still in flight; the sweep replays this.
      await releaseEvent(by);
      return { ok: true, handled: false };
    }
    if (isFinal(room.state) || room.state === "lead_in") {
      await finishEvent(by, runMismatch, KIND_TEXT["worker.ready"]);
      return { ok: true, handled: true };
    }
    const { rooms: setting } = await roomsAndLive();
    const out = await applyLoop(room.id, () => ({ kind: "ready" }), setting, room);
    if ("refused" in out) return await settleRefusal(by, out.refused);
    if (out.applied.changed) {
      await deps.audit(DESK, "room.event.worker.ready", ROOMS, out.room.id, null, {
        link_claimed: Boolean(out.applied.patch.link_claimed_at),
      });
      await carryOut(out.room, out.applied.effects);
    }
    await finishEvent(by, runMismatch, KIND_TEXT["worker.ready"]);
    return { ok: true, handled: true, room: await view(out.room, setting) };
  }

  async function claimedEvent(eventId: string, held: EventKey): Promise<Outcome> {
    const ev = (await io.db(`${EVENTS}?id=eq.${enc(eventId)}&select=*`))[0];
    if (!ev) return { ok: true, handled: false };
    const liveId = String(obj(ev.detail).handover_id ?? "");
    const l = isUuid(liveId) ? (await io.db(`cockpit_sales_live?id=eq.${enc(liveId)}&select=*`))[0] : null;
    if (!l || !["claimed", "room_ready", "lead_joined"].includes(String(l.state))) {
      await finishEvent(held, { skipped: "the handover is no longer held" });
      return { ok: true, handled: true, skipped: "handover over" };
    }
    const { rooms: setting } = await roomsAndLive();
    let out: Row;
    try {
      out = await finishClaim(await hostWho(String(l.claimed_by)), l, setting);
    } catch (e) {
      await releaseEvent(held);
      throw e;
    }
    if (out[UNLINKED]) {
      await releaseEvent(held);
      return { ok: true, handled: false };
    }
    await finishEvent(held, {});
    return { ok: true, handled: true };
  }

  async function replay(ids: string[]): Promise<Row> {
    const results: Row[] = [];
    for (const id of ids) {
      const ev = (await io.db(`${EVENTS}?id=eq.${enc(id)}&select=id,kind,source,room_id,handled_at,lease_until,detail`))[0];
      if (!ev || ev.handled_at || (ms(ev.lease_until) ?? 0) > io.now()) {
        results.push({ id, handled: false, skipped: ev ? "handled or held" : "missing" });
        continue;
      }
      const kind = String(ev.kind);
      const source = String(ev.source);
      // Only the sources the SQL sweep replays (final review,
      // replay-closes-non-replayable-events): a door's Slack reply, the
      // sweep's own settle and anything else are left exactly as they stand,
      // so a forged replay can never close them.
      if (!REPLAY_SOURCES.has(source)) {
        results.push({ id, handled: false, skipped: "not an event a replay takes" });
        continue;
      }
      const seconds = kind === "live.claimed" ? 60 : 30;
      const by: EventKey = { id };
      if (!(await lease(by, seconds))) {
        results.push({ id, handled: false, skipped: "held" });
        continue;
      }
      try {
        let out: Outcome;
        if (source === "zoom" && kind.startsWith("zoom.")) out = await zoomEvent(id, by);
        else if (source === "worker" && (kind === "worker.ready" || kind === "worker.failed") && ev.room_id)
          out = await workerEvent(kind, String(ev.room_id), by, obj(ev.detail));
        else if (source === "claim" && kind === "live.claimed") out = await claimedEvent(id, by);
        else {
          await finishEvent(by, { skipped: "not a kind room.event replays" });
          out = { ok: true, handled: true, skipped: "kind" };
        }
        results.push(out.ok ? { id, handled: out.handled, ...(out.skipped ? { skipped: out.skipped } : {}) } : { id, handled: false, refused: out.refusal.message });
      } catch (e) {
        await releaseEvent(by);
        results.push({ id, handled: false, error: redact(String((e as Error)?.message ?? e)) });
      }
    }
    return { handled: results.filter(r => r.handled).length, results };
  }

  /**
   * What the settle needs beyond the room row (roomlogic SettleFacts), read
   * fresh: another room for the same intro with a join that stands or still
   * live, a Zoom event not read, and a test contact off the test calendar.
   */
  async function settleFacts(room: RoomRow, appt: Row | null, setting: RoomsSetting, contact: Row | null): Promise<SettleFacts> {
    const start = ms(appt?.start_at);
    const sinceStart = start === null ? null : isoAt(start - 60 * 60 * S);
    const meeting = room.provider === "zoom" && room.provider_meeting_id ? String(room.provider_meeting_id) : null;
    const since = isoAt((ms(room.requested_at) ?? ms(room.created_at) ?? io.now()) - 60 * S);
    const asked = ms(room.requested_at) ?? ms(room.created_at) ?? io.now();
    const phone8 = String(contact?.phone ?? "").replace(/\D/g, "").slice(-8);
    const [byAppt, byLead, placed, unplaced, opens, attempts, dialsById, dialsByPhone] = await Promise.all([
      io.db(`${ROOMS}?appointment_id=eq.${enc(String(room.appointment_id))}&id=neq.${enc(room.id)}&select=*&limit=50`),
      sinceStart && room.contact_id
        ? io.db(`${ROOMS}?contact_id=eq.${enc(room.contact_id)}&id=neq.${enc(room.id)}&requested_at=gte.${enc(sinceStart)}&select=*&limit=50`)
        : Promise.resolve([] as Row[]),
      io.db(`${EVENTS}?room_id=eq.${enc(room.id)}&source=in.(zoom,worker)&select=kind,source,at,handled_at,detail&limit=200`),
      // A Zoom event the door kept with no room (its lookup ran out of time)
      // that sales-api has not placed yet: it belongs to this room by its
      // meeting id, and is read like one placed.
      meeting
        ? io.db(
            `${EVENTS}?room_id=is.null&source=eq.zoom&detail->payload->object->>id=eq.${enc(meeting)}&at=gte.${enc(since)}&select=kind,source,at,handled_at,detail&limit=200`,
          )
        : Promise.resolve([] as Row[]),
      // The door's own record of the lead's open (fix round 4): stored first,
      // so it stands even when its write of the room's open time timed out.
      // And the link's late failure (link.failed_late, stress2, round 2).
      io.db(`${EVENTS}?room_id=eq.${enc(room.id)}&kind=in.(door.open,link.failed_late)&select=kind,detail&limit=20`),
      // The lead on the phone since the room was asked for (stress2, round 2):
      // the dialer's attempts, and Maqsam's calls by contact and by phone.
      room.contact_id
        ? io.db(
            `cockpit_sales_attempts?contact_id=eq.${enc(room.contact_id)}&started_at=gte.${enc(isoAt(asked - 6 * 60 * 60 * S))}&select=state,call_state,call_duration_s,outcome,started_at,saved_at&order=started_at.desc&limit=20`,
          )
        : Promise.resolve([] as Row[]),
      room.contact_id
        ? io.db(`cockpit_sales_dials?contact_id=eq.${enc(room.contact_id)}&occurred_at=gte.${enc(isoAt(asked))}&select=direction,state,duration_s,occurred_at&limit=50`)
        : Promise.resolve([] as Row[]),
      phone8.length === 8
        ? io.db(`cockpit_sales_dials?lead_phone8=eq.${enc(phone8)}&occurred_at=gte.${enc(isoAt(asked))}&select=direction,state,duration_s,occurred_at&limit=50`)
        : Promise.resolve([] as Row[]),
    ]);
    const events = [...placed, ...unplaced];
    const siblings = [...byAppt, ...byLead] as unknown as RoomRow[];
    const zoom = events.filter(e => e.source === "zoom");
    const ended = ms(room.ended_at);
    // Every message the link went on is failed now (the desk's settle_sends,
    // or the tick's late read): the link never reached the lead.
    const linkIds = Object.values(obj(room.link_message_ids)).map(String).filter(Boolean);
    const linkMsgs = linkIds.length
      ? await io.db(`cockpit_sales_messages?id=in.(${linkIds.map(enc).join(",")})&select=id,state`).catch(() => [] as Row[])
      : [];
    return {
      short_link: setting.short_link,
      opened: opens.some(e => e.kind === "door.open" && obj(e.detail).after_end !== true),
      link_failed: opens.some(e => e.kind === "link.failed_late") || (linkMsgs.length > 0 && linkMsgs.every(m => m.state === "failed")),
      // Only a join that stands is "the lead joined another room"; a sibling
      // still open with no join holds this settle until it closes (stress2,
      // round 1: a second try's open room was read as the lead's join, and
      // a person was asked to mark an intro the second room then settled).
      sibling_joined: siblings.some(r => leadJoined(r)),
      sibling_open: siblings.some(r => !isFinal(r.state) && !leadJoined(r)),
      zoom_unclear: zoom.some(e => !e.handled_at || obj(e.detail).gave_up === true),
      zoom_reported: zoom.some(
        e =>
          Boolean(e.handled_at) &&
          obj(e.detail).gave_up !== true &&
          (e.kind === "zoom.meeting.started" ||
            ((e.kind === "zoom.meeting.participant_joined" || e.kind === "zoom.meeting.participant_jbh_joined") && obj(e.detail).role === "host")),
      ),
      late_join: events.some(
        e =>
          e.kind === "worker.held" ||
          (e.kind === "zoom.meeting.participant_joined" &&
            ((ended !== null && (ms(e.at) ?? 0) > ended) || obj(obj(e.detail).refused).code === "final")),
      ),
      test_off_calendar:
        Boolean(room.contact_id) &&
        isTestContact(room.contact_id, contact?.tags, setting) &&
        String(appt?.calendar_id ?? "") !== String(setting.test_calendar_id ?? ""),
      phone: phoneSince(attempts, [...dialsById, ...dialsByPhone], asked, io.now()),
    };
  }

  /**
   * Whether the room's host may mark the room's booked intro: it is booked
   * with them, they are a manager, or a manager made the room for them. The
   * same rule as room.wrap and the dialer's own mark (refuseMark), checked
   * again before a timer or the count marks with anyRep.
   */
  async function hostMayMark(room: RoomRow, appt: Row | null, host: Who): Promise<boolean> {
    if (!appt) return false;
    const assigned = String(appt.assigned_user_id ?? "");
    if (host.manager || (assigned && host.ghl_user_id && assigned === host.ghl_user_id)) return true;
    if (room.made_by && lower(room.made_by) !== lower(room.host_email)) {
      // Not read: thrown, never "another rep's call" (stress2, round 2).
      const maker = await personOf(lower(room.made_by));
      if (maker?.role === "manager") return true;
    }
    return false;
  }

  /** settled_mark none (a person marks the intro), once, with its audit row and timeline line. */
  async function settleNone(room: RoomRow, why: string, alert: string | null): Promise<void> {
    if (!room.settled_mark) {
      const none = await patchRoom(room.id, { settled_mark: "none" }, { settled_mark: null }).catch(() => null);
      if (none)
        await deps.audit(DESK, "room.settle", ROOMS, room.id, { settled_mark: null }, { settled_mark: "none" }, {
          appointment_id: room.appointment_id,
          why,
        });
    }
    if (alert) await raise(`room:${room.id}:mark_intro`, "room_mark_intro", room, fill(ROOMS_COPY.mark_intro_alert, { code: room.code, why: alert }));
    await note(room.id, "room.settle", fill(EVENT_TEXT.settle_skipped, { why }), {}, `room.settle:${room.id}`);
  }

  async function settle(roomIds: string[]): Promise<Row> {
    const results: Row[] = [];
    const { rooms: setting } = await roomsAndLive();
    for (const roomId of roomIds) {
      const by: EventKey = { dedupe_key: `sweep.settle:${roomId}` };
      if (!(await lease(by, 30))) {
        results.push({ room_id: roomId, handled: false });
        continue;
      }
      try {
        const room = await readRoom(roomId);
        if (!room) {
          await finishEvent(by, { skipped: "no room" });
          results.push({ room_id: roomId, handled: true, skipped: "no room" });
          continue;
        }
        const [appt, marks, contact] = await Promise.all([
          appointment(room.appointment_id),
          room.appointment_id
            ? io.db(`cockpit_sales_dispositions?appointment_id=eq.${enc(room.appointment_id)}&superseded_at=is.null&select=status,marked_by,note`)
            : Promise.resolve([]),
          room.contact_id ? readContact(room.contact_id) : Promise.resolve(null),
        ]);
        if (room.contact_id && !contact) {
          // The contact could not be read (a test contact is told by its tag):
          // released, so the sweep posts it again. Each try is counted when
          // room.event leases it; after ten, the sweep gives it up and a
          // person is told which intro to mark.
          await releaseEvent(by);
          results.push({ room_id: roomId, handled: false, skipped: "contact not read" });
          continue;
        }
        // Not read: thrown, so the event is released and the sweep asks again
        // (never "the intro is booked with another rep" on a blip).
        const host = await hostWho(room.host_email, true);
        // The timer's own no-show from an earlier try that stopped before it
        // wrote settled_mark: that try's record is finished once HighLevel has
        // it. One HighLevel never took (crm failed, or "pending" because the
        // try was cut off between the cockpit's row and HighLevel) is written
        // to HighLevel again below; it is never read as a person's mark.
        const own = marks.find(m => m.status === "noshow" && m.note === SETTLE_NOTE && lower(m.marked_by) === lower(host.email));
        const ownOnly = Boolean(own) && marks.length === 1 && !room.settled_mark;
        if (own && ownOnly && crmTook(own)) {
          await settled(room, by, results);
          continue;
        }
        const marked =
          (marks.length > 0 && !ownOnly) || ["showed", "noshow", "cancelled", "invalid"].includes(String(appt?.status ?? ""));
        const start = ms(appt?.start_at);
        if (!marked && appt && start !== null && io.now() < start + setting.waits_s.settle * S) {
          // The intro moved since the room was made (the copy caught up after
          // the sweep posted it): the room was not for the intro as it is
          // booked now. A final answer, with no alert (stress2, round 2).
          const was = ms(room.appointment_start_at);
          if (was !== null && Math.abs(was - start) >= 60 * S) {
            const why = "this room was not for the intro as it is booked now";
            await settleNone(room, why, null);
            await finishEvent(by, { skipped: why, moved_to: isoAt(start) });
            results.push({ room_id: roomId, handled: true, skipped: why });
            continue;
          }
          // Posted early: left for the next sweep, never dropped, and the
          // wait uses none of its tries.
          await releaseWaiting(by);
          results.push({ room_id: roomId, handled: false, skipped: "not due" });
          continue;
        }
        const facts = room.appointment_id ? await settleFacts(room, appt, setting, contact) : {};
        if (!marked && facts.phone === "open") {
          // A call to the lead is under way (the setter rang again after the
          // room): the settle waits for it to be saved, never a no-show while
          // the intro may be going on by phone (stress2, round 2).
          await releaseWaiting(by);
          results.push({ room_id: roomId, handled: false, skipped: "a call to the lead is under way" });
          continue;
        }
        if (!marked && facts.sibling_open) {
          // Another room for this call is still open (a second try): this
          // room's settle waits for it, never "the lead joined another room"
          // and never a no-show while the lead may still come (stress2). The
          // wait uses none of its tries (round 2), so the sweep never gives
          // it up as "could not be written" while the sibling is open.
          await releaseWaiting(by);
          results.push({ room_id: roomId, handled: false, skipped: "another room for this call is still open" });
          continue;
        }
        if (!settleWanted(room, appt?.start_at, marked, io.now(), setting.waits_s, facts)) {
          // A room that was not the intro's (a confirmation call's the day
          // before) says nothing about it, so nobody is asked to mark it here.
          const forIntro = start !== null && roomForThisStart(room, start, setting.waits_s);
          const doubt = !marked && appt && forIntro ? noShowDoubt(room, facts) : null;
          const why = marked
            ? "the call was already marked"
            : !appt
              ? "the booked call is not in the cockpit"
              : doubt ?? "this room was not for the intro as it is booked now";
          // Not evidence that nobody came: a person marks the intro, never the timer.
          await settleNone(room, why, doubt);
          await finishEvent(by, { skipped: why });
          results.push({ room_id: roomId, handled: true, skipped: why });
          continue;
        }
        if (!(await hostMayMark(room, appt, host))) {
          // A room carrying another rep's intro (made before room.create
          // checked whose call it is), or a host with no HighLevel user: the
          // timer marks nothing with a manager's rights, and a person is told
          // which intro to mark (never left "confirmed", a show for B2B).
          const why = "the intro is booked with another rep";
          await settleNone(room, why, why);
          await finishEvent(by, { skipped: why });
          results.push({ room_id: roomId, handled: true, skipped: why });
          continue;
        }
        // HighLevel's own status first (fix round 4): the cockpit's copy is
        // B2B's, mirrored every three minutes, and a rep may have marked the
        // intro in HighLevel itself (shown, or invalid: held by B2B's rule).
        // A timer never writes over a mark. Not readable: released, so the
        // sweep asks again (and after its last try a person is told).
        const hl = await ghlAppointment(String(room.appointment_id));
        if (!hl) {
          await releaseEvent(by);
          results.push({ room_id: roomId, handled: false, skipped: "HighLevel's appointment was not read" });
          continue;
        }
        // HighLevel's own start (stress2, round 1): the cockpit's copy lags it
        // by minutes, and a lead who moved the intro through HighLevel's link
        // (same id, still confirmed) has a call ahead. A room made for the
        // intro as it was says nothing about the intro as it is booked now.
        const hlStart = hl.startTime === undefined || hl.startTime === null || hl.startTime === "" ? Number.NaN : ghlTime(hl.startTime);
        const wasStart = ms(room.appointment_start_at) ?? ms(appt?.start_at);
        if (Number.isFinite(hlStart) && hlStart > 0 && wasStart !== null && Math.abs(hlStart - wasStart) >= 60 * S) {
          const why = "this room was not for the intro as it is booked now";
          await settleNone(room, why, null);
          await finishEvent(by, { skipped: why, moved_to: isoAt(hlStart) });
          results.push({ room_id: roomId, handled: true, skipped: why });
          continue;
        }
        const hlStatus = lower(hl.appointmentStatus ?? hl.appoinmentStatus);
        if (hlStatus && !["new", "confirmed", "booked"].includes(hlStatus)) {
          if (hlStatus === "noshow" && own) {
            // The settle's own no-show from an earlier try: HighLevel has it.
            await settled(room, by, results);
            continue;
          }
          const why = "the call was already marked";
          await settleNone(room, why, null);
          await finishEvent(by, { skipped: why, highlevel: hlStatus });
          results.push({ room_id: roomId, handled: true, skipped: why });
          continue;
        }
        let made: Row;
        try {
          // quiet: a timer never sets off HighLevel's no-show automations at the lead.
          // onlyIfUnmarked: a person's mark that landed while this ran stands.
          made = await deps.markAppointment(host, String(room.appointment_id), "noshow", {
            anyRep: true,
            quiet: true,
            onlyIfUnmarked: true,
            note: SETTLE_NOTE,
          });
        } catch (e) {
          if (e instanceof ApiRefusal) {
            const already = e.extra.code === "marked";
            const why = already ? "the call was already marked" : `the no-show was refused: ${redact(e.message).slice(0, 200)}`;
            // Refused for good: the no-show was not written, so a person marks
            // the intro (never left as confirmed, which B2B counts as shown).
            await settleNone(room, why, already ? null : ROOMS_COPY.settle_refused_why);
            await finishEvent(by, { refused: { message: e.message, status: e.status } });
            results.push({ room_id: roomId, handled: true, refused: e.message });
            continue;
          }
          throw e;
        }
        // The no-show counts only once HighLevel has it: B2B's show rate reads
        // HighLevel, where the intro still says confirmed (a show) until then.
        if (!crmTook(made) && deps.resendMark) made = await deps.resendMark(host, String(room.appointment_id)).catch(() => made);
        if (!crmTook(made)) {
          await crmNotTaken(room, by, made, results);
          continue;
        }
        await settled(room, by, results);
      } catch (e) {
        await releaseEvent(by);
        results.push({ room_id: roomId, handled: false, error: redact(String((e as Error)?.message ?? e)) });
      }
    }
    return { handled: results.filter(r => r.handled).length, results };
  }

  /** HighLevel has the mark, or is not written by the cockpit at all (crm off or skipped by the crm_writes setting). */
  function crmTook(mark: Row): boolean {
    return !["failed", "pending"].includes(String(mark.crm ?? ""));
  }

  /**
   * The settle's no-show is in the cockpit and HighLevel did not take it.
   * A HighLevel refusal (crm failed) is tried again: the event is released
   * and the sweep posts the settle again (its tries are counted, and after
   * the last one the sweep leaves the intro to a person with the "mark this
   * intro" alert). A write cut off mid-way (crm pending) cannot be finished
   * from here, nor can a refusal on the last try: a person is told now.
   */
  async function crmNotTaken(room: RoomRow, by: EventKey, made: Row, results: Row[]): Promise<void> {
    const crm = String(made.crm ?? "");
    const tries = Number((await io.db(`${EVENTS}?${eventFilter(by)}&select=tries`).catch(() => []))[0]?.tries ?? 0);
    // A write still within a write's own time (HighLevel's 25 s and the row's
    // own write) may yet land: asked again later, never a person's job yet.
    const markedAt = ms(made.marked_at);
    const young = crm === "pending" && markedAt !== null && io.now() - markedAt < CRM_PENDING_STUCK_MS;
    if ((crm === "failed" || young) && tries < SETTLE_CRM_TRIES) {
      await releaseEvent(by);
      results.push({ room_id: room.id, handled: false, skipped: "HighLevel did not take the no-show yet" });
      return;
    }
    await settleNone(room, ROOMS_COPY.settle_crm_why, ROOMS_COPY.settle_crm_why);
    await finishEvent(by, { refused: { code: "crm_not_taken", crm } });
    results.push({ room_id: room.id, handled: true, skipped: ROOMS_COPY.settle_crm_why });
  }

  /** The settle's no-show is written: settled_mark, one audit row, the timeline line, the event finished. */
  async function settled(room: RoomRow, by: EventKey, results: Row[]): Promise<void> {
    const landed = await patchRoom(room.id, { settled_mark: "noshow" }, { settled_mark: null });
    if (landed)
      await deps.audit(DESK, "room.settle", ROOMS, room.id, { settled_mark: null }, { settled_mark: "noshow" }, {
        appointment_id: room.appointment_id,
      });
    // The intro is marked now: every room's "mark this intro" alert for it is
    // answered, as a person's mark answers them (stress2, round 1).
    if (room.appointment_id) await resolveMarkIntroAlerts(room.appointment_id);
    await note(room.id, "room.settle", EVENT_TEXT.settled, {}, `room.settle:${room.id}`);
    await finishEvent(by, { settled: "noshow" });
    results.push({ room_id: room.id, handled: true, settled: "noshow" });
  }

  /** The tick (S1): no timers here, only the re-asks and alerts SQL cannot do. */
  async function tick(roomIds: string[]): Promise<Row> {
    const { rooms: setting } = await roomsAndLive();
    const ctx = roomCtx(setting);
    const now = io.now();
    const results: Row[] = [];
    for (const id of roomIds) {
      const room = await readRoom(id).catch(() => null);
      if (!room) {
        results.push({ room_id: id, effects: [] });
        continue;
      }
      const [pending, next, avail] = await Promise.all([
        io
          .db(
            `${EVENTS}?room_id=eq.${enc(id)}&handled_at=is.null&source=in.(zoom,worker,claim)&at=gte.${enc(isoAt(now - REPLAY_MAX_AGE_S * S))}&select=id&limit=50`,
          )
          .then(r => r.length)
          .catch(() => null),
        nextBooked(room, now),
        room.purpose === "standby"
          ? io
              .db(`cockpit_sales_availability?email=eq.${enc(lower(room.host_email))}&select=state,until`)
              .then(r => (r[0]?.state === "available" ? (r[0]?.until as string | null) ?? null : null))
              .catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      const a = sweepRoom(room, now, ctx, next, {
        pending_events: pending,
        ...(avail === undefined ? {} : { available_until: avail }),
        owner: "sql",
      });
      const effects = a.ok ? a.effects : [];
      const asked = effects.filter(
        e => e.kind === "send_link" || e.kind === "claim_link" || e.kind === "count_live" || e.kind === "undo_count" || e.kind === "alert",
      );
      if (asked.length) io.background(carryOut(room, asked));
      // The link went and its record never finished (no channel on the
      // room: the write that set link_sent_at lost its answer, or the run
      // stopped right after it): asked again, so the send that went is
      // recorded with its audit row and line, never sent anew (stress2,
      // round 2). The SQL tick posts every open room with a lead.
      const sentAt = ms(room.link_sent_at);
      if (
        linkUnrecorded(room) &&
        room.purpose !== "booked" &&
        room.purpose !== "standby" &&
        sentAt !== null &&
        now - sentAt >= REASK_AFTER_S * S &&
        now - sentAt <= REASK_WINDOW_S * S &&
        !asked.some(e => e.kind === "send_link")
      )
        io.background(sendLink(room.id));
      // A WhatsApp link (free text or template) HighLevel still called
      // pending: read again while the lead's window runs (stress2, rounds 2
      // and 3, a late Meta failure).
      const ch = Array.isArray(room.link_channels) ? (room.link_channels as string[]) : [];
      if (
        (room.state === "open" || room.state === "host_in") &&
        sentAt !== null &&
        now - sentAt <= LINK_RECHECK_MS &&
        !leadJoined(room) &&
        (ch.includes("whatsapp_text") || ch.includes("whatsapp_template")) &&
        !ch.includes("email")
      )
        io.background(recheckLink(room.id));
      results.push({ room_id: id, effects: asked.map(e => e.kind) });
    }
    return { handled: results.length, results };
  }

  /**
   * The start of the seat's own booked call when it starts within
   * booked_guard from now (the sweep's R6 window), else null. Not readable:
   * null, so the press goes on as before (the sweep still guards the room).
   */
  async function seatBookedSoon(email: string, now: number, setting: RoomsSetting): Promise<number | null> {
    try {
      const person = await personOf(email);
      if (!person?.ghl_user_id) return null;
      const a = (
        await io.db(
          `cockpit_sales_appointments?assigned_user_id=eq.${enc(String(person.ghl_user_id))}&start_at=gt.${enc(isoAt(now))}&start_at=lte.${enc(isoAt(now + setting.waits_s.booked_guard * S))}&status=in.(new,confirmed)&select=start_at&order=start_at.asc&limit=1`,
        )
      )[0];
      return ms(a?.start_at);
    } catch {
      return null;
    }
  }

  /**
   * The host's next booked call after now, for the booked guard: never the
   * room's own intro, nor another call of the room's own lead (stress2,
   * round 1: a fallback room made in the five minutes before its intro was
   * read as running into a different booked call).
   */
  async function nextBooked(room: RoomRow, now: number): Promise<number | null> {
    try {
      const person = await personOf(lower(room.host_email));
      if (!person?.ghl_user_id) return null;
      const a = (
        await io.db(
          `cockpit_sales_appointments?assigned_user_id=eq.${enc(String(person.ghl_user_id))}&start_at=gt.${enc(isoAt(now))}&status=in.(new,confirmed)&select=start_at,appointment_id,contact_id&order=start_at.asc&limit=10`,
        )
      ).find(
        x =>
          !(room.appointment_id && String(x.appointment_id ?? "") === room.appointment_id) &&
          !(room.contact_id && String(x.contact_id ?? "") === room.contact_id),
      );
      return ms(a?.start_at);
    } catch {
      return null;
    }
  }

  async function roomEventAction(_who: Who, b: Row): Promise<Row> {
    const kind = String(b.kind ?? "");
    const payload = obj(b.payload);
    let out: Outcome;
    if (kind === "sweep.replay") return await replay(idList(payload.event_ids));
    if (kind === "sweep.settle") return await settle(idList(payload.room_ids));
    if (kind === "tick") return await tick(idList(payload.room_ids));
    if (kind === "worker.ready" || kind === "worker.failed") out = await workerEvent(kind, roomIdOf(b.room_id), null, payload);
    else if (/^zoom\.[a-z_.]{1,80}$/.test(kind)) out = await zoomEvent(roomIdOf(b.event_id), null);
    else throw no("bad_input");
    if (!out.ok) throw out.refusal;
    const { ok: _ok, ...rest } = out;
    return rest;
  }

  // ------------------------------------------------------------- not built yet (their switches are off)

  async function livePress(_who: Who, _b: Row): Promise<Row> {
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    throw plain("Slack presses are not built yet. Use the cockpit.", 409, "disabled");
  }
  /** live.ask and live.cancel (project 2): a plain sentence, never "Unknown action.", until they are built. */
  async function liveAsk(_who: Who, _b: Row): Promise<Row> {
    const { live } = await roomsAndLive();
    if (!liveOn(live)) throw plain(LIVE_OFF, 409, "disabled");
    throw plain(ROOMS_COPY.ask_not_yet, 409, "disabled");
  }
  async function threadTick(): Promise<Row> {
    return { handled: false, note: ROOMS_COPY.not_yet };
  }
  async function replySeen(): Promise<Row> {
    return { handled: false, note: ROOMS_COPY.reply_not_yet };
  }

  // ------------------------------------------------------------- the dialer's queue hold

  async function held(now: number): Promise<Set<string>> {
    const [raw, rows] = await Promise.all([
      settingsOf(["rooms"]),
      io.db(`${ROOMS}?state=in.(${LIVE_STATES})&contact_id=not.is.null&select=*&limit=2000`),
    ]);
    return heldContacts(rows as unknown as RoomRow[], now, roomCtx(roomsSetting(raw.rooms)));
  }

  return {
    actions: {
      "room.create": roomCreate,
      "room.status": roomStatus,
      "room.open": roomOpen,
      "room.mark": roomMark,
      "room.count_confirm": roomCountConfirm,
      "room.end": roomEnd,
      "room.send": roomSend,
      "room.wrap": roomWrap,
      "live.availability": liveAvailability,
      "live.status": liveStatus,
      "live.take": liveTake,
      "live.decline": liveDecline,
      "live.ask": liveAsk,
      "live.cancel": liveAsk,
    },
    desk: {
      "room.event": roomEventAction,
      "live.press": livePress,
      "thread.tick": threadTick,
      "reply.seen": replySeen,
    },
    // What the shared cron secret may run (final review): only what the cron
    // door passes on. live.press names its Slack user in its body, so it is
    // taken on the service key alone until the door signs presses with a key
    // only it holds; reply.seen is the desk's, on the service key.
    cron: ["room.event", "thread.tick"],
    held,
  };
}

/** No change, for a make() that found nothing left to do. */
function unchanged(room: RoomRow): Changed {
  return { ok: true, changed: false, from: room.state, to: room.state, room, patch: {}, expect: {}, effects: [], reason: null };
}

/**
 * A send whose outcome is not known: HighLevel may have sent it and its
 * answer was lost (a timeout, a 5xx, a dropped connection), or the database
 * write after it failed. Such a send is treated as possibly sent: nothing
 * else goes to the lead until a person checks.
 */
export function unclearSend(e: unknown): boolean {
  if (e instanceof ApiRefusal) {
    if (e.extra?.unclear === true) return true;
    // The message service's own word that HighLevel refused it outright
    // (convoSend and sendTemplate: "HighLevel did not send it"): certain,
    // whatever the answer's status.
    if (e.extra?.certain === true) return false;
    return e.status === 0 || e.status >= 500;
  }
  if (e instanceof GhlError) return e.status === 0 || e.status >= 500;
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number") return status === 0 || status >= 500;
  return true;
}

/**
 * A WhatsApp failure that is about one lead, or a moment, not the number or
 * the template: Meta's per-person codes (131026 undeliverable, 131049 the
 * per-person marketing limit, 131050 the lead stopped marketing messages,
 * 130472 the lead's experiment, 131047 the 24-hour window), and HighLevel's
 * own rate limit (429). The room source's health leaves these out.
 */
export function leadSpecificFailure(error: unknown): boolean {
  return /\b(131026|131049|131050|130472|131047)\b|\b429\b|too many requests/i.test(String(error ?? ""));
}

/** applyRoomEvent that never throws (a damaged row is a refusal, never a crash). */
function applyRoomEventSafe(room: RoomRow, e: RoomEvent, now: number, ctx: ReturnType<typeof roomCtx>): Applied {
  try {
    return applyRoomEvent(room, e, now, ctx);
  } catch {
    return refuse("bad_input");
  }
}
