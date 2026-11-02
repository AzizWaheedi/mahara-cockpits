/**
 * Fathom inside cockpit-forms-api (docs/forms/STAGE2-CONTRACT.md 6.4, 6.5): the
 * light pull on open and its ingest items, the drafts' one summary read (written
 * back through the pull's merge) and transcript read (never stored), and the
 * transcript op. Every Fathom call goes through fathomTools (cockpit-csm-api/
 * tools.ts), so it lands in cockpit_csm_provider_health under its run key.
 *
 * Only exactMatch decides a client here (the same room, the client on the
 * invite, a link in a stored 1-1 form); the hints ride along only on the call
 * row of a candidate nothing places (A7.12). A link pasted in the window is
 * never part of an item.
 */
import { fathomTools, type FathomAnswer, type FathomTools } from "../cockpit-csm-api/tools.ts";
import {
  type Booking,
  type ClientRef,
  type Ctx as MatchCtx,
  exactMatch,
  normalizeRoom,
  placedExactly,
  type Recording,
  suggestionsFor,
} from "../../../hermes/csm-calls/callMatch.ts";
import {
  CS_TEAM,
  callRowBase,
  classifyMeeting,
  type FathomMeeting,
  meetingRow,
  transcriptText,
} from "../../../hermes/csm-calls/fathomRules.ts";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { DoorError, type OpCtx } from "./door.ts";

// ---------------------------------------------------------------- MatchInputs (3.5)

export type StoreItem = {
  recordingId: string;
  startsAt: string;
  endsAt: string | null;
  room: string | null;
  /** The title the window shows (the stored title, which may be the calendar's). */
  title: string | null;
  /** The edited title only, null when Fathom sent none (A7.13); absent from a store that predates it. */
  editedTitle?: string | null;
  meetingTitle: string | null;
  class: "client" | "candidate" | "internal" | "sales";
  recorderEmail: string | null;
  recorderTeam: string | null;
  shareUrl: string | null;
  inviteeEmails: string[];
  onTask: string | null;
  onTaskMethod: string | null;
  /**
   * The call row's match_confidence, which says with onTaskMethod how it was placed on onTask (A7.14 rule 2,
   * A7.17): invitee_email at 0.9 is a known contact's address, at 0.8 a company domain. Absent from a store
   * that predates it, and then read as not exact (callMatch.ts placedExactly), the safe side.
   */
  onTaskConfidence?: number | null;
  callId: number | null;
  linkedCallId: number | null;
  gone: boolean;
  settled: boolean;
  hasSummary: boolean;
  hasTranscript: boolean;
  actionItems: number | null;
  notes: { at: string; source: "cockpit" | "typeform" } | null;
};
export type MatchInputs = {
  from: string;
  to: string;
  bookings: {
    id: number;
    taskId: string;
    clientName: string;
    kind: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    room: string | null;
    emails: string[];
    contactNames: string[];
  }[];
  sales: string[];
  formLinks: { shareUrl: string; taskId: string }[];
  clients: { taskId: string; name: string; aliases: string[] }[];
  csmEmails: string[];
  staff: { name: string; email: string | null; role: string | null }[];
  client: {
    taskId: string;
    name: string;
    lastNoteAt: string | null;
    /** This client's call rows of the last 14 days; `confidence` is the row's match_confidence (absent: not exact). */
    onClient: { recordingId: string; callId: number | null; method: string | null; confidence?: number | null; startsAt: string }[];
  } | null;
  store: StoreItem[];
};

const ms = (s: unknown): number => (typeof s === "string" || typeof s === "number" ? Date.parse(String(s)) : Number.NaN);
const msOrNull = (s: unknown): number | null => {
  const t = ms(s);
  return Number.isFinite(t) ? t : null;
};
const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** A match_confidence as sent (a number, or numeric text), else null: missing is never a guess. */
const confidenceOf = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The read as it came, with every list a list (a missing key is an empty one, never a guess). */
export function asInputs(raw: unknown): MatchInputs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const c = r.client && typeof r.client === "object" ? (r.client as Record<string, unknown>) : null;
  return {
    from: String(r.from ?? ""),
    to: String(r.to ?? ""),
    bookings: list(r.bookings),
    sales: list(r.sales),
    formLinks: list(r.formLinks),
    clients: list(r.clients),
    csmEmails: list<string>(r.csmEmails).map(lower),
    staff: list(r.staff),
    client: c
      ? {
          taskId: String(c.taskId ?? ""),
          name: String(c.name ?? ""),
          lastNoteAt: typeof c.lastNoteAt === "string" ? c.lastNoteAt : null,
          onClient: list(c.onClient),
        }
      : null,
    store: list(r.store),
  };
}

export const toBooking = (b: MatchInputs["bookings"][number]): Booking => ({
  id: Number(b.id),
  taskId: String(b.taskId ?? ""),
  clientName: String(b.clientName ?? ""),
  kind: String(b.kind ?? "other"),
  status: String(b.status ?? ""),
  startsAt: ms(b.startsAt),
  endsAt: msOrNull(b.endsAt),
  room: b.room ?? null,
  emails: list<string>(b.emails),
  contactNames: list<string>(b.contactNames),
});

export const toRecording = (s: StoreItem): Recording => ({
  recordingId: String(s.recordingId),
  startsAt: ms(s.startsAt),
  endsAt: msOrNull(s.endsAt),
  room: s.room ?? null,
  // The title signal reads the edited title only (5.2 row 5, A7.13): the store's editedTitle when it sends
  // the key, even when it is null; a store item without the key falls back to its title.
  title: s && "editedTitle" in s ? (s.editedTitle ?? null) : (s.title ?? null),
  meetingTitle: s.meetingTitle ?? null,
  cls: s.class,
  recorderEmail: s.recorderEmail ? lower(s.recorderEmail) : null,
  recorderTeam: s.recorderTeam ?? null,
  inviteeEmails: list<string>(s.inviteeEmails),
  shareUrl: s.shareUrl ?? null,
  gone: !!s.gone,
  settled: !!s.settled,
  onTask: s.onTask ?? null,
  onTaskMethod: s.onTaskMethod ?? null,
  // How the row on onTask was placed (A7.14 rule 2): a store that sends no confidence reads as not exact.
  onTaskConfidence: confidenceOf(s.onTaskConfidence),
});

export const toClient = (c: MatchInputs["clients"][number]): ClientRef => ({
  taskId: String(c.taskId),
  name: String(c.name ?? ""),
  aliases: list<string>(c.aliases),
});

/**
 * The matcher's context: stored 1-1 form links only (never a shadow run, never the pasted link), the staff
 * names and roles, and the clients list's task ids, so the client on the invite names only a listed client
 * unless its booking is within 30 minutes (A7.13), as the worker and the webhook read it.
 */
export function matchCtx(inputs: MatchInputs, now: number, viewerEmail: string | null = null): MatchCtx {
  const roles = new Map(inputs.staff.filter(s => s?.email).map(s => [lower(s.email), s.role ?? null] as const));
  return {
    formLinks: new Map(inputs.formLinks.filter(f => f?.shareUrl && f.taskId).map(f => [f.shareUrl, f.taskId] as const)),
    staffNames: inputs.staff.map(s => s?.name).filter((n): n is string => typeof n === "string" && n.trim() !== ""),
    csmEmails: inputs.csmEmails,
    now,
    viewerEmail,
    roleOf: email => roles.get(lower(email)) ?? null,
    clientIds: inputs.clients.map(c => String(c?.taskId ?? "")).filter(Boolean),
  };
}

// ---------------------------------------------------------------- whose call a recording can be (3.2, A7.3)

export const GONE = "Fathom no longer has that recording. Pick another call.";
export const TEAM_MEETING = "That recording is a team meeting, not a client call.";
/**
 * A recording made outside Customer Success that the tie rule (below) does not let a seat use, whose call row is
 * on no card or that has none (A7.14's sentences). Rule 4 lets an admin, the CEO and the recorder place it
 * themselves, so only a seat that cannot place it itself reads it: the viewer in the listing, and the response's
 * own seat in the save, the attach, the drafts and the transcript, so the CEO asking on the CSM's notes reads it
 * too. "Ask an admin" is that seat's remedy.
 */
export const OUTSIDE_CS = "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
/**
 * The tie rule's second sentence (A7.14's sentences, decided in round 4: A7.18): the same refusal for a recording
 * whose call row is on this client but was put there only by a likely sign (`name`, `invitee_email` under 0.9 or
 * with no confidence), so rule 2 did not settle it. The client's Calls card lists that call on this client, so "is
 * not on this client" would be false, and no admin tool matches a row already on a card. Its remedy is a person's
 * own notes for that call (rule 4: an admin, the CEO or its recorder). In 2a those notes are a shadow run beside
 * the Typeform and no effect runs. From the cut-over x plans that send's `call_match` `skipped` for a call row
 * already on this client (`The recording is already on this client.`), so the row keeps the worker's method and
 * confidence and rule 2 still does not settle it; but the send's `call_form` stores the notes as a check-in form of
 * this client whose answers hold the recording's share link, so rule 3's form-link clause then ties the recording
 * for every seat, the CSM included, and with no seat at all. Her own send on it is then refused as the call's
 * second record (one record per call). checkin-plans-supabase.test.ts pins this on the real v, w and x ("the
 * OUTSIDE_CS_LIKELY remedy"). A call row on no card, or none, keeps OUTSIDE_CS.
 */
export const OUTSIDE_CS_LIKELY = "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";
export const NOT_IN_COCKPIT = "That recording is not in the cockpit yet. Check again in a minute.";
/** The window's line for a recording on another client (A7.3); the client is named only for a seat that may see it. */
export const onOther = (name: string | null) => `On ${name ?? "another client"}. If that is wrong, ask an admin to move it.`;
/**
 * The window's line for a recording on another client when an admin or the CEO may move it here (2b build 11,
 * 3.8): the other client and this one, both named, since such a seat sees every client.
 */
export const onOtherMovable = (other: string | null, client: string | null) =>
  `On ${other ?? "another client"}. If this is ${client ? `${client}'s` : "this client's"} call, move it here.`;
/** The same refusal in the save's words (3.2), for the drafts and the transcript. */
export const onOtherClient = (name: string | null) => `That recording is on ${name ?? "another client"}. If that is wrong, ask an admin to move it.`;

/** A Customer Success recording: its recorder's Fathom team says so, or it is one of the CSM's own seats (3.5). */
export function byCustomerSuccess(rec: Recording, ctx: MatchCtx): boolean {
  return lower(rec.recorderTeam) === lower(CS_TEAM) || (!!rec.recorderEmail && ctx.csmEmails.includes(lower(rec.recorderEmail)));
}

/** The client a recording belongs to when it is not this one: stored there, or exact for it and not written yet. */
export function elsewhereOf(rec: Recording, taskId: string, bookings: Booking[], ctx: MatchCtx): string | null {
  if (rec.onTask) return rec.onTask !== taskId ? rec.onTask : null;
  const exact = exactMatch(rec, bookings, ctx);
  return exact && exact.taskId !== taskId ? exact.taskId : null;
}

/**
 * Why a recording cannot stand for this client's call. `outside` and `outsideLikely` are the tie rule's two
 * refusals: `outsideLikely` when its call row is on this client (a likely sign put it there), else `outside`.
 */
export type Refusal = { reason: "gone" | "class" | "other" | "outside" | "outsideLikely"; otherTask: string | null };
export const OUTSIDE: Refusal = { reason: "outside", otherTask: null };
export const OUTSIDE_LIKELY: Refusal = { reason: "outsideLikely", otherTask: null };
/**
 * The tie rule's refusal of this recording for this client (A7.14's sentences, A7.18): its own reason when its call
 * row is on this client (`rec.onTask === taskId`, which only a row rule 2 did not settle reaches, since placedExactly
 * failed), else OUTSIDE (a call row on no card, or none).
 */
export const outsideOf = (rec: Recording, taskId: string): Refusal => (rec.onTask === taskId ? OUTSIDE_LIKELY : OUTSIDE);
/** Whether a refusal is the tie rule's (either sentence). */
export const isTieRefusal = (r: Refusal): boolean => r.reason === "outside" || r.reason === "outsideLikely";
/** The tie rule's sentence for its refusal: OUTSIDE_CS_LIKELY for a call row on this client, else OUTSIDE_CS. */
export const tieSentence = (r: Refusal): string => (r.reason === "outsideLikely" ? OUTSIDE_CS_LIKELY : OUTSIDE_CS);

/**
 * 3.2's checks, in the order the save runs them: Fathom still has it, it is a
 * client or candidate call, it is on no other client. Null when they pass; the
 * tie rule comes after them. A settled recording passes (5.2).
 */
export function checksOf(rec: Recording, taskId: string, bookings: Booking[], ctx: MatchCtx): Refusal | null {
  if (rec.gone) return { reason: "gone", otherTask: null };
  if (rec.cls !== "client" && rec.cls !== "candidate") return { reason: "class", otherTask: null };
  const elsewhere = elsewhereOf(rec, taskId, bookings, ctx);
  return elsewhere ? { reason: "other", otherTask: elsewhere } : null;
}

/**
 * The tie rule (A7.14): which recordings may stand for this client's call. A
 * Customer Success recording may (rule 1), and so may one whose call row is on
 * this client and was placed by an exact sign or a person (rule 2: same_room,
 * appointment_time, form_task_id, manual, client_id_field, or invitee_email at
 * 0.9 or more; callMatch.ts placedExactly): both are read here from the rows
 * the database reads. A row on this client that the worker's matchMeeting
 * wrote from a likely sign (a client's name in the title, the meeting title or
 * an invitee's name, `name` 0.6; a company domain, `invitee_email` 0.8)
 * settles nothing, so a closer's prospect call whose title names a client is
 * held to rules 1, 3 and 4 like one on no client (round 3, A7.17); a row on
 * another client ties nothing here. For every other recording made outside
 * Customer Success (the CEO's, the closer's) the answer is the database's,
 * cockpit_form_recordings_tied, the one SQL rule the save holds too
 * (cockpit_form_checkin_value and the call_match attach, which read rule 2 the
 * same way), because the window saves through PostgREST, past this
 * door: an exact sign of 5.2 that names this client, each clause checked on
 * its own for this client, over every live booking of it at any date (rule 3:
 * the same room within 90 minutes, which no other client's booking there may
 * share; an external invitee on a booking of this client, with no other-client
 * condition, so an address on two clients' bookings ties the recording for
 * each; its link in a stored 1-1 form of this client), or a seat that passes
 * this client's gate and may place the recording itself, as the queue lets it
 * (rule 4: an admin, the CEO, its recorder). A likely sign (the title, the
 * company domain) never ties a recording made outside Customer Success on its
 * own, and neither does a pasted link: it only finds the recording. The
 * door's own reading of "on another client" (elsewhereOf, before this rule)
 * stays the matcher's exact rule. A sales call reads `client` until
 * the sales desk indexes it, a day or more later, so without this rule a
 * prospect's call could be listed on any client's notes, picked, drafted on
 * DeepSeek and transcribed.
 */
export const TIED_RPC = "cockpit_form_recordings_tied";

/** Rules 1 and 2 of the tie rule, which need no question to the database: rule 2 only for a row an exact sign or a person placed. */
export const tiedHere = (rec: Recording, taskId: string, ctx: MatchCtx): boolean =>
  byCustomerSuccess(rec, ctx) || (rec.onTask === taskId && placedExactly(rec));

/** The database answers about this many recordings at a time. */
export const TIED_MAX = 50;

/**
 * The recordings of `ids` the database says the tie rule lets the seat use for
 * this client: the viewer (`actor`, checkin.calls) or the seat of a response
 * (`responseId`, the drafts and the transcript of its saved call, so rule 4
 * reads the response's own seat, never the one asking). Only ids that were
 * asked count, and an answer that names none ties none: missing is never a tie.
 */
export async function tiedIds(op: OpCtx, taskId: string, ids: string[], seat: { actor: string } | { responseId: string }): Promise<Set<string>> {
  const asked = [...new Set(ids.map(String))];
  const tied = new Set<string>();
  for (let i = 0; i < asked.length; i += TIED_MAX) {
    const part = asked.slice(i, i + TIED_MAX);
    const raw = await op.deps.rpc(TIED_RPC, {
      p_task_id: taskId,
      p_recording_ids: part,
      p_actor: "actor" in seat ? seat.actor : null,
      p_response_id: "responseId" in seat ? seat.responseId : null,
    });
    for (const id of tiedOf(raw)) if (part.includes(id)) tied.add(id);
  }
  return tied;
}

/** The ids an answer of cockpit_form_recordings_tied (text[]) names; any other answer names none. */
const tiedOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter(x => typeof x === "string" || typeof x === "number").map(String) : []);

/**
 * Why a response's saved call cannot be read for this client (the drafts and
 * the transcript), null when it can: 3.2's checks, then the tie rule for the
 * response's own seat. The database is asked only when 3.2's checks pass and
 * rules 1 and 2 do not settle it.
 */
export async function savedCallRefusal(op: OpCtx, rec: Recording, taskId: string, bookings: Booking[], ctx: MatchCtx, responseId: string): Promise<Refusal | null> {
  const checks = checksOf(rec, taskId, bookings, ctx);
  if (checks) return checks;
  if (tiedHere(rec, taskId, ctx)) return null;
  return (await tiedIds(op, taskId, [rec.recordingId], { responseId })).has(rec.recordingId) ? null : outsideOf(rec, taskId);
}

/** A client's business name from the inputs (the board's list, else a booking's), or null. */
export const clientNameOf = (inputs: MatchInputs, taskId: string): string | null =>
  inputs.clients.find(c => c.taskId === taskId)?.name || inputs.bookings.find(b => b.taskId === taskId)?.clientName || null;

/**
 * Whether this seat may see a client: admins and the CEO see every client;
 * any other seat passes the client gate (its client list). A refusal of the
 * gate is a no, never an error.
 */
export async function seesClient(op: OpCtx, taskId: string): Promise<boolean> {
  if (op.actor.admin || op.actor.ceo) return true;
  try {
    await op.deps.rpc("cockpit_csm_client_gate_for_actor", { p_actor: op.actor.actorId, p_task_id: taskId });
    return true;
  } catch (e) {
    if (e instanceof RpcError) return false;
    throw e;
  }
}

/** The store and the bookings of one recording's own hour (bookings within two hours of it, 3.5). */
export async function hourOf(op: OpCtx, at: number): Promise<MatchInputs> {
  return asInputs(
    await op.deps.rpc("cockpit_fathom_match_inputs", { p_from: new Date(at - 60_000).toISOString(), p_to: new Date(at + 60_000).toISOString(), p_task_id: null }),
  );
}

/** The inputs with more bookings, each booking once. */
export function withBookings(inputs: MatchInputs, more: MatchInputs["bookings"]): MatchInputs {
  const known = new Set(inputs.bookings.map(b => Number(b.id)));
  return { ...inputs, bookings: [...inputs.bookings, ...more.filter(b => !known.has(Number(b.id)))] };
}

/**
 * One recording as the window reads it for this client: the window's own
 * inputs (since 00:00 Kuwait yesterday, so its signs read as they did when it
 * was listed), and, for an older recording (a pasted link, a resumed draft),
 * its item and the bookings of its own hour.
 */
export async function recordingFor(op: OpCtx, taskId: string, recordingId: string, startsAt: string | null): Promise<{ item: StoreItem | null; inputs: MatchInputs }> {
  const now = op.deps.now();
  const inputs = asInputs(
    await op.deps.rpc("cockpit_fathom_match_inputs", { p_from: kuwaitYesterday(now).toISOString(), p_to: now.toISOString(), p_task_id: taskId }),
  );
  const here = inputs.store.find(s => String(s?.recordingId) === recordingId) ?? null;
  const at = ms(startsAt);
  if (here || !Number.isFinite(at)) return { item: here, inputs };
  const own = await hourOf(op, at);
  return { item: own.store.find(s => String(s?.recordingId) === recordingId) ?? null, inputs: withBookings(inputs, own.bookings) };
}

// ---------------------------------------------------------------- the pull (6.4 step 3)

/** 00:00 yesterday in Kuwait (UTC+3, no daylight saving), as an instant. */
export function kuwaitYesterday(now: Date): Date {
  const day = 86_400_000;
  const kuwait = 3 * 3_600_000;
  return new Date(Math.floor((now.getTime() + kuwait) / day) * day - kuwait - day);
}

const MEETING_KEYS = [
  "recording_id", "title", "starts_at", "ends_at", "recorded_by_email", "recorded_by_name", "external", "invitees",
  "url", "share_url", "summary", "raw", "class", "room", "recorder_team",
] as const;
const CALL_KEYS = [
  "source_id", "task_id", "client_name", "match_method", "match_confidence", "kind", "title", "starts_at", "ends_at",
  "host_email", "host_name", "recording_url", "summary", "external_invitees", "linked_call_id", "candidate", "room", "hints",
] as const;
const pick = (row: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]));

/** The meeting as the matcher sees it. */
export function recordingOf(m: FathomMeeting, cls: Recording["cls"]): Recording {
  const by = m?.recorded_by ?? {};
  return {
    recordingId: String(m?.recording_id ?? ""),
    startsAt: ms(m?.recording_start_time ?? m?.scheduled_start_time ?? m?.created_at),
    endsAt: msOrNull(m?.recording_end_time),
    room: normalizeRoom(m?.meeting_url),
    // The edited title only, never the calendar's meeting_title (5.2 row 5, A7.12), as the webhook reads it.
    title: typeof m?.title === "string" ? m.title : null,
    meetingTitle: typeof m?.meeting_title === "string" ? m.meeting_title : null,
    cls,
    recorderEmail: by.email ? lower(by.email) : null,
    recorderTeam: by.team ?? null,
    // Every calendar invitee's email, lower-cased, once (A7.2), as the worker, the webhook and the store item read them.
    inviteeEmails: [...new Set(list<Record<string, unknown>>(m?.calendar_invitees).map(i => lower(i?.email)).filter(Boolean))],
    shareUrl: m?.share_url ?? null,
  };
}

/**
 * One ingest item (3.6). The class comes from classifyMeeting with an empty sales
 * set (the ingest checks the sales index itself, 4.3). A client or candidate
 * meeting gets its call: an exact match names the client, and when it names a
 * booking also links it and takes its kind; with no exact match the call has no
 * client. Only that unplaced candidate carries hints (A7.12); every other call,
 * a client-class one included, carries []. What the store knows and the meeting
 * does not (a person's match, a row set aside as not a 1-1 call) is the ingest's
 * to apply (4.3, A7.12): it keeps a stored match block and a settled row's
 * hints, and a row that ends with a task_id keeps no hints.
 */
export function ingestItem(m: FathomMeeting, inputs: MatchInputs, now: Date): { meeting: Record<string, unknown>; call: Record<string, unknown> | null } {
  const nowIso = now.toISOString();
  const cls = classifyMeeting(m, new Set());
  const meeting = pick(meetingRow(m, cls, nowIso), MEETING_KEYS);
  if (cls !== "client" && cls !== "candidate") return { meeting, call: null };
  const base = callRowBase(m, cls, nowIso);
  const rec = recordingOf(m, cls);
  const bookings = inputs.bookings.map(toBooking);
  const ctx = matchCtx(inputs, now.getTime());
  const exact = exactMatch(rec, bookings, ctx);
  if (!exact) {
    const hints = cls === "candidate" ? suggestionsFor(rec, bookings, inputs.clients.map(toClient), ctx) : [];
    return { meeting, call: pick({ ...base, hints }, CALL_KEYS) };
  }
  const booking = exact.bookingId === undefined ? undefined : bookings.find(b => b.id === exact.bookingId);
  // A client missing from the clients list (or listed with no name) takes the named booking's name (A7.12).
  const named = inputs.clients.find(c => c.taskId === exact.taskId)?.name || booking?.clientName || null;
  // The one mapping the worker, the webhook and the pull write (A7.2): the same room at 1; the client on
  // the invite of a booking within 30 minutes as appointment_time at 1, else invitee_email at 0.9; a
  // stored 1-1 form's link as form_task_id at 0.95. The named booking gives the link and the kind.
  const [method, confidence] =
    exact.signal === "same_room"
      ? ["same_room", 1]
      : exact.signal === "invitee_email"
        ? exact.bookingId === undefined
          ? ["invitee_email", 0.9]
          : ["appointment_time", 1]
        : ["form_task_id", 0.95];
  return {
    meeting,
    call: pick(
      {
        ...base,
        task_id: exact.taskId,
        client_name: named,
        match_method: method,
        match_confidence: confidence,
        linked_call_id: booking ? booking.id : null,
        kind: booking ? booking.kind : base.kind,
        candidate: false,
        hints: [],
      },
      CALL_KEYS,
    ),
  };
}

export type PullResult = { state: "ok" | "busy" | "failed"; note: string | null; items: number };
export const BUSY_NOTE = "Fathom is busy. Check again in a minute.";
const failedNote = (status: number | null) => `Fathom could not be read just now (${status ?? "no answer"}).`;
const MAX_PAGES = 3;

/** The light list since 00:00 Kuwait yesterday (Customer Success, with action items), ingested, and the pull marked. */
export async function pullFathom(op: OpCtx, key: string, inputs: MatchInputs): Promise<PullResult> {
  const runKey = `pull:${op.deps.uuid()}`;
  const tools = fathomTools(key, row => op.deps.health({ ...row, run_key: runKey, action_id: null }), op.deps.fetch);
  const now = op.deps.now();
  const meetings: FathomMeeting[] = [];
  let cursor: string | undefined;
  let failure: PullResult | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const answer: FathomAnswer = await tools.meetings({
        teams: [CS_TEAM],
        createdAfter: kuwaitYesterday(now).toISOString(),
        includeActionItems: true,
        cursor,
      });
      if (answer.kind !== "ok") {
        failure =
          answer.kind === "refused" && answer.status === 429
            ? { state: "busy", note: BUSY_NOTE, items: 0 }
            : { state: "failed", note: failedNote(answer.kind === "refused" ? answer.status : null), items: 0 };
        break;
      }
      meetings.push(...list<FathomMeeting>(answer.body.items));
      cursor = typeof answer.body.next_cursor === "string" && answer.body.next_cursor ? answer.body.next_cursor : undefined;
      if (!cursor) break;
    }
  } catch {
    // A receipt that could not be saved stopped the read: the store still answers.
    failure = { state: "failed", note: failedNote(null), items: 0 };
  }
  const usable = meetings.filter(m => /^\d{3,20}$/.test(String(m?.recording_id ?? "")));
  let stored = 0;
  try {
    for (let i = 0; i < usable.length; i += 50) {
      const items = usable.slice(i, i + 50).map(m => ingestItem(m, inputs, now));
      await op.deps.rpc("cockpit_fathom_ingest", { p_items: items, p_via: "pull" });
      stored += items.length;
    }
  } catch {
    failure = { state: "failed", note: "Fathom's list could not be saved just now.", items: stored };
  }
  const result: PullResult = failure ? { ...failure, items: stored } : { state: "ok", note: null, items: stored };
  await op.deps.rpc("cockpit_fathom_pull_mark", {
    p_ok: result.state === "ok",
    p_items: stored,
    p_note: result.note ?? `${stored} Customer Success recordings since 00:00 yesterday.`,
  });
  return result;
}

// ---------------------------------------------------------------- the drafts' reads (6.5)

export type DraftInputs = {
  recordingId: string;
  class: string | null;
  gone: boolean;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  summary: string | null;
  actionItems: unknown[] | null;
  transcriptPath: string | null;
  shareUrl: string | null;
  recorderEmail: string | null;
  recorderName: string | null;
  staff: { name: string; email: string | null; role: string | null }[];
  client: { taskId: string; name: string | null; stage: string | null; happiness: string | null };
  lastForm: { defcon: string | null; priority: string | null; notes: string | null; at: string | null } | null;
};

const readTools = (op: OpCtx, key: string, runKey: string): FathomTools =>
  fathomTools(key, row => op.deps.health({ ...row, run_key: runKey, action_id: null }), op.deps.fetch);

/**
 * The summary the store does not hold yet: one heavy read, then written back
 * through the pull's merge (4.3: the stored summary is kept when the new one is
 * empty). The merge sets every other column from the item, so the write-back
 * needs the meeting itself: one light read around its end finds it. When that
 * read misses, the draft still uses the summary and the write-back waits for
 * the worker. `text` is null while Fathom has none. When the fresh meeting no
 * longer reads as a client call (unshared since the store saw it), the
 * summary is dropped and `internal` is true: nothing is drafted from it, and
 * the worker's next run strips the store.
 */
export async function readSummary(op: OpCtx, key: string, d: DraftInputs, runKey: string): Promise<{ text: string | null; internal: boolean }> {
  const tools = readTools(op, key, runKey);
  const answer = await tools.recording(d.recordingId, "summary");
  if (answer.kind !== "ok") return { text: null, internal: false };
  const summary = answer.body.summary && typeof answer.body.summary === "object" ? (answer.body.summary as Record<string, unknown>) : null;
  const text = typeof summary?.markdown_formatted === "string" && summary.markdown_formatted.trim() ? summary.markdown_formatted : null;
  if (!text || !d.recorderEmail) return { text, internal: false };
  try {
    const end = ms(d.endsAt ?? d.startsAt);
    if (!Number.isFinite(end)) return { text, internal: false };
    const page = await tools.meetings({
      createdAfter: new Date(end - 5 * 60_000).toISOString(),
      createdBefore: new Date(end + 30 * 60_000).toISOString(),
      recordedBy: [d.recorderEmail],
      includeActionItems: true,
    });
    const m = page.kind === "ok" ? list<FathomMeeting>(page.body.items).find(x => String(x?.recording_id) === d.recordingId) : undefined;
    if (!m) return { text, internal: false };
    const full = { ...m, default_summary: summary };
    const cls = classifyMeeting(full, new Set());
    if (cls !== "client" && cls !== "candidate") return { text: null, internal: true };
    await op.deps.rpc("cockpit_fathom_ingest", { p_items: [{ meeting: pick(meetingRow(full, cls, op.deps.now().toISOString()), MEETING_KEYS), call: null }], p_via: "pull" });
  } catch {
    // The draft still has the summary; the next worker run stores it.
  }
  return { text, internal: false };
}

/** Transcripts read from Fathom are kept for ten minutes in this isolate only, so polling does not re-read them. */
const transcriptCache = new Map<string, { text: string; at: number }>();
const CACHE_MS = 10 * 60_000;
/**
 * A transcript read that gave no text (refused, a 429 included; a 5xx or a
 * timeout; or none yet) is not repeated for that recording until this instant,
 * so the window's 60-second polls do not each spend a heavy read on a key
 * whose heavy reads are limited to 10 a minute and shared with three other
 * services. Kept in this isolate only, like the texts.
 */
const transcriptMiss = new Map<string, number>();
export const MISS_MS = 2 * 60_000;
const MISS_MAX_MS = 10 * 60_000;
const CACHE_SIZE = 20;

/** How long to leave a recording's transcript alone after a read with no text: Fathom's retry-after, else its rate reset on a 429, else two minutes. */
export function missWait(answer: FathomAnswer, now: number): number {
  let wait = MISS_MS;
  if (answer.kind === "refused") {
    const reset = answer.limit?.reset ?? null;
    if (answer.retryAfter !== null && answer.retryAfter > 0) wait = answer.retryAfter * 1000;
    // ratelimit-reset is seconds until the window resets; a value that reads as epoch seconds is taken as such.
    else if (answer.status === 429 && reset !== null && reset > 0) wait = reset > 1e9 ? reset * 1000 - now : reset * 1000;
  }
  return Math.min(Math.max(wait, 1000), MISS_MAX_MS);
}

const remember = <V>(m: Map<string, V>, k: string, v: V) => {
  m.delete(k);
  m.set(k, v);
  if (m.size > CACHE_SIZE) m.delete(m.keys().next().value as string);
};

/**
 * The transcript Fathom holds, flattened as the worker stores it; never
 * stored. Null without a call while an earlier read of this recording gave no
 * text and its wait (missWait) has not run out; the drafts then answer
 * TRANSCRIPT_WAIT and the transcript op its 404, as for a refused read.
 */
export async function readTranscript(op: OpCtx, key: string, recordingId: string, runKey: string): Promise<string | null> {
  const hit = transcriptCache.get(recordingId);
  const now = op.deps.now().getTime();
  if (hit && now - hit.at < CACHE_MS) return hit.text;
  const until = transcriptMiss.get(recordingId);
  if (until !== undefined && now < until) return null;
  const answer = await readTools(op, key, runKey).recording(recordingId, "transcript");
  const text = answer.kind === "ok" ? (transcriptText(answer.body.transcript) ?? null) : null;
  if (text) {
    transcriptMiss.delete(recordingId);
    remember(transcriptCache, recordingId, { text, at: now });
  } else remember(transcriptMiss, recordingId, now + missWait(answer, now));
  return text;
}

/** Forget the isolate's transcripts and its waits (tests). */
export function clearTranscriptCache(): void {
  transcriptCache.clear();
  transcriptMiss.clear();
}

// ---------------------------------------------------------------- checkin.transcript (6.2)

export const NO_TRANSCRIPT = "No transcript yet. Open the call in Fathom.";

/**
 * A 60-second link to the stored transcript, else the text Fathom holds. The
 * recording is checked again before anything is read, the response's saved
 * call included, because a recording can change after the save (the sales
 * desk indexes it as a sales call, its recorder unshares it, it is moved to
 * another client): a client or candidate recording Fathom still has, on no
 * other client, and one the tie rule lets the response's own seat use (rule 4
 * reads the seat whose response saved it, never the seat asking: the CEO who
 * opens the CSM's notes reads only what she may). One that is not the saved
 * call must also be a Customer Success recording (6.2). Only this recording's
 * own stored file is ever signed.
 */
export async function transcriptOp(op: OpCtx, body: Record<string, unknown>): Promise<{ url: string } | { text: string }> {
  const responseId = String(body.responseId ?? "");
  const recordingId = String(body.recordingId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(responseId) || !/^\d{3,20}$/.test(recordingId)) throw new DoorError("Pick the call first.", 400);
  const read = (await op.userRpc("cockpit_form_responses_read", { p_response_id: responseId })) as Record<string, any>;
  const response = read?.response ?? {};
  const taskId = String(response.taskId ?? "");
  const saved = response.answers?.call;
  const isSaved = saved?.kind === "fathom" && String(saved.recordingId) === recordingId;
  const d = (await op.deps.rpc("cockpit_form_draft_inputs", { p_task_id: taskId, p_recording_id: recordingId })) as DraftInputs;
  if (d.class !== "client" && d.class !== "candidate") throw new DoorError(TEAM_MEETING, 400);
  if (d.gone) throw new DoorError(GONE, 400);
  const { item, inputs } = await recordingFor(op, taskId, recordingId, d.startsAt);
  if (!item) throw new DoorError(NOT_IN_COCKPIT, 400);
  const rec = toRecording(item);
  const ctx = matchCtx(inputs, op.deps.now().getTime());
  if (!isSaved && !byCustomerSuccess(rec, ctx)) throw new DoorError(TEAM_MEETING, 400);
  const refusal = await savedCallRefusal(op, rec, taskId, inputs.bookings.map(toBooking), ctx, responseId);
  if (refusal?.reason === "other") {
    const other = refusal.otherTask as string;
    throw new DoorError(onOtherClient((await seesClient(op, other)) ? clientNameOf(inputs, other) : null), 403);
  }
  if (refusal) throw new DoorError(refusal.reason === "gone" ? GONE : refusal.reason === "class" ? TEAM_MEETING : tieSentence(refusal), 400);
  if (d.transcriptPath === `fathom/${recordingId}.txt`) {
    const url = await op.deps.storage.sign(d.transcriptPath, 60);
    if (url) return { url };
  }
  const key = (await op.deps.rpc("cockpit_forms_key_get", { p_provider: "fathom" })) as { secret?: string } | null;
  const text = key?.secret ? await readTranscript(op, key.secret, recordingId, `transcript:${responseId}`) : null;
  if (text) return { text };
  throw new DoorError(NO_TRANSCRIPT, 404);
}
