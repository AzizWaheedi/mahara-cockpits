/**
 * The matcher (docs/forms/STAGE2-CONTRACT.md section 5): which Fathom recording
 * is which client's call. Pure and import-free, so the worker (bun), the pull on
 * open and the webhook (Deno) run the same rules, and every rule has a test
 * (callMatch.test.ts). Evidence: notes/stage2/maps/matching-evidence.md.
 *
 * Only exactMatch may lead to a task_id: the same room within 90 minutes of one
 * client's booking, the client on the invite, or the recording's link in a
 * stored 1-1 form. suggestionsFor (one recording, every client: the hints on a
 * candidate's call row) and rankForClient (one client, every recording: the pick
 * in the 1-1 window) only suggest. Times are epoch milliseconds. The why texts
 * read Kuwait time and name clients by business name, never a contact.
 */

export type Booking = { id: number; taskId: string; clientName: string; kind: string; status: string;
  startsAt: number; endsAt: number | null; room: string | null; emails: string[]; contactNames: string[] };
export type Recording = { recordingId: string; startsAt: number; endsAt: number | null; room: string | null;
  title: string | null; meetingTitle: string | null; cls: "client" | "candidate" | "internal" | "sales";
  recorderEmail: string | null; recorderTeam: string | null; inviteeEmails: string[]; shareUrl: string | null;
  speakers?: string[]; gone?: boolean; settled?: boolean; onTask?: string | null; onTaskMethod?: string | null;
  /**
   * The match_confidence of the call row that put it on onTask (the store item's onTaskConfidence). Only
   * invitee_email reads it: 0.9 is a known contact's address, 0.8 a company domain. Missing reads as not
   * exact, the safe side (A7.14 rule 2, A7.17).
   */
  onTaskConfidence?: number | null;
  /** Set by collapseDuplicates on a copy it hides: the recording id of the copy kept (CallView.duplicateOf). */
  duplicateOf?: string | null };
export type ClientRef = { taskId: string; name: string; aliases: string[] };
export type Signal = "same_room" | "invitee_email" | "pasted" | "matched" | "speaker_name" | "title" | "domain"
  | "near_booking" | "latest_unlinked" | "hint_window";
export type Label = "exact" | "likely" | "possible" | "default" | "hint";
export type Suggestion = { recordingId: string; taskId: string; clientName: string; signal: Signal; label: Label;
  why: string; bookingId?: number; minutes?: number; preselect: boolean; ask: boolean };
export type Ctx = { formLinks: Map<string, string>; staffNames: string[]; csmEmails: string[];
  freeMail?: RegExp; now: number;
  viewerEmail?: string | null;            // the seat reading the window (checkin.calls); the why texts say "Your …" only for its own recordings
  roleOf?: (email: string | null) => string | null;   // the MatchInputs.staff role label, for "The CSM's …"
  /**
   * The task ids on the clients list (the worker's roster, MatchInputs.clients). Given, the client on the
   * invite names only a listed client, as the worker's contacts index does (match.ts emailIndex), unless that
   * client's booking with the email starts within 30 minutes: a booking names its client, listed or not
   * (contract A7.13). Left out, every booking's client counts.
   */
  clientIds?: readonly string[] };

/** A room proves the call only this close to the booking (rooms are reused on other days). */
export const SAME_ROOM_WINDOW_MIN = 90;

const MIN = 60_000;
const DUPLICATE_MIN = 10; // one call recorded twice: the same room, starts within 10 minutes
const INVITE_MIN = 30; // the worker's appointment_time window (match.ts:201)
const NEAR_MIN = 20; // possible
const HINT_MIN = 60; // hint: 20 to 60 minutes
const LATEST_MS = 12 * 3_600_000;
const KUWAIT_MS = 3 * 3_600_000;
const CS_TEAM = "customer success";
/** The call row methods an exact sign or a person writes (5.2 row 3b); invitee_email counts only from INVITEE_EXACT. */
const MATCHED_METHODS = new Set(["client_id_field", "appointment_time", "same_room", "form_task_id", "manual"]);
/** A known contact's address (match.ts contacts index); a company domain is 0.8, a client's name 0.6. */
const INVITEE_EXACT = 0.9;
/** Aliases that name no one client (matching-evidence 6), compared letters and digits only. */
const GENERIC_ALIASES = new Set(["city", "smart", "internal", "professional", "ocean", "arch", "العلا"]);
/** As match.ts FREE_MAIL and OUR_DOMAIN (this file imports nothing). */
const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|msn|aol|proton|protonmail)\./i;
const OUR_DOMAIN = /@maharamedia\.com$/i;

/** The order of section 5.2; row 3b sits between 3 and 4, and a form link just after a pasted one. */
const RANK: Record<Signal, number> = {
  same_room: 1,
  invitee_email: 2,
  pasted: 3,
  matched: 3.5,
  speaker_name: 4,
  title: 5,
  domain: 6,
  near_booking: 7,
  latest_unlinked: 8,
  hint_window: 9,
};
const FORM_LINK_RANK = 3.1;
const LABEL: Record<Signal, Label> = {
  same_room: "exact",
  invitee_email: "exact",
  pasted: "exact",
  matched: "exact",
  speaker_name: "likely",
  title: "likely",
  domain: "likely",
  near_booking: "possible",
  latest_unlinked: "default",
  hint_window: "hint",
};
/** The labels whose pick the window confirms with "Is this the call?". */
const ASKS = new Set<Label>(["likely", "possible", "default"]);
const KIND_WORD: Record<string, string> = {
  checkin: "check-in",
  onboarding: "onboarding call",
  blueprint: "Brand Blueprint call",
  launch: "launch call",
};

/**
 * The room a meeting link opens, or null: `zoom:<id>` from a zoom.us /j/, /w/ or
 * /s/ link (any subdomain, passcode and query dropped), `meet:<code>` from a
 * Google Meet link. Anything else (Teams, a map, a place name, empty) is null.
 * The database's cockpit_call_room is the same rule; both are tested against
 * every pair in rooms.cases.json.
 */
export function normalizeRoom(url: string | null | undefined): string | null {
  const u = String(url ?? "").toLowerCase();
  const zoom = /zoom\.us\/(?:j|w|s)\/([0-9]{9,12})/.exec(u);
  if (zoom) return `zoom:${zoom[1]}`;
  const meet = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/.exec(u);
  return meet ? `meet:${meet[1]}` : null;
}

/**
 * Whether the call row that put a recording on its client (onTask) was placed by
 * an exact sign or by a person (5.2 row 3b, A7.14 rule 2): the same room, a
 * booking's time, a stored 1-1 form's link, the Client ID answer, a person's
 * match, or the client on the invite at confidence 0.9 or more (a known
 * contact's address). The worker's likely signs (a client's name in the title,
 * the meeting title or an invitee's name, `name` at 0.6; a company domain,
 * `invitee_email` at 0.8) are not, and neither is a row with no confidence,
 * the safe side for a store that sends none. False for a recording on no client.
 */
export function placedExactly(rec: Pick<Recording, "onTask" | "onTaskMethod" | "onTaskConfidence">): boolean {
  if (!rec?.onTask) return false;
  const method = String(rec.onTaskMethod ?? "");
  if (MATCHED_METHODS.has(method)) return true;
  const confidence = rec.onTaskConfidence == null ? Number.NaN : Number(rec.onTaskConfidence);
  return method === "invitee_email" && confidence >= INVITEE_EXACT;
}

/**
 * One entry per call. Copies in the same room that start within 10 minutes of
 * the first are one call: the copy on a client is kept (in the window that is
 * this client's copy), else the Customer Success recorder's; every other copy
 * gets `duplicateOf` and is never offered. The same recording listed twice is
 * kept once (the first). Every other recording comes back with `duplicateOf` null.
 */
export function collapseDuplicates(recs: Recording[]): Recording[] {
  const seen = new Set<string>();
  const list = (recs ?? []).filter(r => {
    if (!r || seen.has(r.recordingId)) return false;
    seen.add(r.recordingId);
    return true;
  });
  const rooms = new Map<string, Recording[]>();
  for (const r of list) if (r.room) rooms.set(r.room, [...(rooms.get(r.room) ?? []), r]);
  const keeper = new Map<string, string>();
  for (const group of rooms.values()) {
    const byStart = [...group].sort((a, b) => a.startsAt - b.startsAt || byId(a.recordingId, b.recordingId));
    for (let i = 0; i < byStart.length; ) {
      let j = i + 1;
      while (j < byStart.length && byStart[j].startsAt - byStart[i].startsAt <= DUPLICATE_MIN * MIN) j++;
      const copies = byStart.slice(i, j);
      const keep = [...copies].sort(keepFirst)[0];
      for (const c of copies) if (c !== keep) keeper.set(c.recordingId, keep.recordingId);
      i = j;
    }
  }
  return list.map(r => ({ ...r, duplicateOf: keeper.get(r.recordingId) ?? null }));
}

/**
 * The match that may write a task_id (5.2 rows 1 to 3), or null. Never for an
 * internal, sales or gone recording.
 * - same_room: the recording starts within SAME_ROOM_WINDOW_MIN of a booking with
 *   its room, and every booking with that room inside the window is one client's;
 *   bookingId is the closest of them. A room on two clients' bookings, or a
 *   booking further away, proves nothing and the chain goes on.
 * - invitee_email: an external invitee's email is on that client's bookings
 *   (an email on two clients' bookings counts only through a booking within
 *   30 minutes); bookingId only for that client's booking with the email that
 *   starts within ±30 minutes. With ctx.clientIds, a client missing from the
 *   clients list counts only through such a booking (A7.13).
 * - pasted: the recording's share link is in a stored 1-1 form (ctx.formLinks),
 *   never with a bookingId.
 */
export function exactMatch(rec: Recording, bookings: Booking[], ctx: Ctx):
  { taskId: string; signal: "same_room" | "invitee_email" | "pasted"; bookingId?: number } | null {
  const e = exactOf(rec, bookings, ctx);
  if (!e) return null;
  return e.booking ? { taskId: e.taskId, signal: e.signal, bookingId: e.booking.id } : { taskId: e.taskId, signal: e.signal };
}

/**
 * What one recording says about every client, best signal per client, best
 * first, at most 3 (the hints on a candidate's call row, business names only).
 * It sees one recording, so the rules that need the others (a booking already
 * claimed by another recording, the closest recording wins a booking, the
 * newest unlinked call) are rankForClient's.
 */
export function suggestionsFor(rec: Recording, bookings: Booking[], clients: ClientRef[], ctx: Ctx): Suggestion[] {
  if (!offerable(rec)) return [];
  const ix = indexOf(bookings, clients, ctx);
  const cands = direct(rec, bookings, ix, ctx);
  if (isCs(rec))
    for (const b of ix.live) {
      const gap = Math.abs(rec.startsAt - b.startsAt);
      if (gap <= NEAR_MIN * MIN) {
        if (!otherClientNear(rec, b.taskId, ix.live)) cands.push(timed(rec, b, "near_booking", ix));
      } else if (gap <= HINT_MIN * MIN) cands.push(timed(rec, b, "hint_window", ix));
    }
  const best = bestPer(cands, c => c.taskId);
  const strong = best.filter(c => c.rank <= RANK.near_booking).length;
  for (const c of best)
    c.preselect = !rec.settled && (c.label === "exact" || c.label === "likely" || (c.label === "possible" && strong === 1));
  return best.slice(0, 3).map(strip);
}

/**
 * The 1-1 window's pick for one client (5.2): `picked` is the first suggestion
 * in the order that is preselected, else null; `others` are the rest, best first.
 * A recording is offered once (duplicates collapsed first) with its best signal.
 * Never offered: internal, sales and gone recordings, and recordings on another
 * client (stored there, or exact for another client). A recording with no signal
 * for this client is not in the answer. A settled recording, or one that started
 * before this client's last notes (lastNoteAt), is never preselected, unless it
 * is the link pasted in this window. The default (row 8) may be a CSM's call
 * stored on this client by a likely sign: such a row is no store match (3b).
 */
export function rankForClient(taskId: string, recs: Recording[], bookings: Booking[], clients: ClientRef[],
  ctx: Ctx & { lastNoteAt: number | null; pastedShareUrl?: string | null }):
  { picked: Suggestion | null; others: Suggestion[] } {
  const ix = indexOf(bookings, clients, ctx);
  const pool = collapseDuplicates(recs).filter(r => !r.duplicateOf && offerable(r));
  const exact = new Map(pool.map(r => [r.recordingId, exactOf(r, bookings, ctx)]));
  const elsewhere = (r: Recording) =>
    r.onTask ? r.onTask !== taskId : (exact.get(r.recordingId)?.taskId ?? taskId) !== taskId;
  const mine = pool.filter(r => !elsewhere(r));
  const pasted = shareKey(ctx.pastedShareUrl);
  const pastedHere = (r: Recording) => !!pasted && shareKey(r.shareUrl) === pasted;
  const cands = new Map<string, Cand[]>();
  for (const r of mine) {
    const list = direct(r, bookings, ix, ctx).filter(c => c.taskId === taskId);
    if (pastedHere(r)) list.push(cand(r, taskId, "pasted", "From the Fathom link you pasted.", ix));
    cands.set(r.recordingId, list);
  }
  const isExact = (r: Recording) => (cands.get(r.recordingId) ?? []).some(c => c.label === "exact");

  // A booking the call is known for is claimed: by the booking an exact match
  // names, or this client's booking an exact recording of this client starts
  // within ±20 minutes of. A claimed booking gives no one a possible or a hint.
  const own = ix.live.filter(b => b.taskId === taskId);
  const claimed = new Set<number>();
  for (const r of pool) {
    const e = exact.get(r.recordingId);
    if (e?.booking) claimed.add(e.booking.id);
  }
  for (const r of mine) {
    if (!isExact(r)) continue;
    const b = closest(own.filter(o => within(o.startsAt, r.startsAt, NEAR_MIN)), r.startsAt);
    if (b) claimed.add(b.id);
  }
  // Time alone: Customer Success recordings near this client's open bookings.
  // The closest recording within ±20 minutes wins a booking (and is preselected
  // only when no other recording was that close); 20 to 60 minutes is a hint.
  const timedPool = mine.filter(r => isCs(r) && !isExact(r));
  const contested = new Set<string>();
  for (const b of own) {
    if (claimed.has(b.id)) continue;
    const near = timedPool.filter(r => within(r.startsAt, b.startsAt, NEAR_MIN));
    const winner = closest(near, b.startsAt);
    if (winner && !otherClientNear(winner, taskId, ix.live)) {
      cands.get(winner.recordingId)?.push(timed(winner, b, "near_booking", ix));
      if (near.length > 1) contested.add(winner.recordingId);
    }
    for (const r of timedPool) {
      const gap = Math.abs(r.startsAt - b.startsAt);
      if (gap > NEAR_MIN * MIN && gap <= HINT_MIN * MIN) cands.get(r.recordingId)?.push(timed(r, b, "hint_window", ix));
    }
  }
  // The default: the CSM's newest call since this client's last notes that no
  // client has yet (her own seats only, never the CEO's or an admin's). 5.2
  // row 8 asks only "not on another client, not settled", and `mine` already
  // holds out another client's: so a call on no client, or on this one through
  // a call row a likely sign placed (the worker's company domain at 0.8 or a
  // name at 0.6, which settles nothing: 3b, A7.14 rule 2), may be the default,
  // as it would be unplaced. Only a row an exact sign or a person placed is
  // held out, because 3b already offers it as `matched`. Her own seats are
  // Customer Success (rule 1 ties them for every seat), so no untied
  // recording can take this pick.
  const csm = new Set((ctx.csmEmails ?? []).map(email).filter(Boolean));
  const latest = mine
    .filter(r =>
      !placedExactly(r) && !r.settled && csm.has(email(r.recorderEmail)) &&
      r.startsAt <= ctx.now && ctx.now - r.startsAt <= LATEST_MS &&
      (ctx.lastNoteAt == null || r.startsAt > ctx.lastNoteAt))
    .sort((a, b) => b.startsAt - a.startsAt || byId(a.recordingId, b.recordingId))[0];
  if (latest) cands.get(latest.recordingId)?.push(cand(latest, taskId, "latest_unlinked", latestWhy(latest, ctx), ix));

  const best: Cand[] = [];
  for (const r of mine) {
    const top = [...(cands.get(r.recordingId) ?? [])].sort(order)[0];
    if (!top) continue;
    top.pastedHere = pastedHere(r);
    top.settled = !!r.settled;
    top.noted = ctx.lastNoteAt != null && r.startsAt <= ctx.lastNoteAt;
    best.push(top);
  }
  const pickable = (c: Cand) => !!c.pastedHere || (!c.settled && !c.noted);
  const strong = best.filter(c => c.rank <= RANK.near_booking && pickable(c));
  for (const c of best) {
    if (!pickable(c)) c.preselect = false;
    else if (c.label === "exact" || c.label === "likely") c.preselect = true;
    else if (c.label === "possible")
      c.preselect = !contested.has(c.recordingId) && strong.every(o => o.recordingId === c.recordingId);
    else if (c.label === "default") c.preselect = strong.length === 0;
    else c.preselect = false;
  }
  const sorted = best.sort(order);
  const picked = sorted.find(c => c.preselect) ?? null;
  return { picked: picked ? strip(picked) : null, others: sorted.filter(c => c !== picked).map(strip) };
}

// ---------------------------------------------------------------- internals

type Cand = Suggestion & { rank: number; at: number; gap: number; pastedHere?: boolean; settled?: boolean; noted?: boolean };
type Exact = { taskId: string; signal: "same_room" | "invitee_email" | "pasted"; booking?: Booking };
type Index = {
  live: Booking[];
  name: (taskId: string) => string;
  contacts: Map<string, Set<string>>; // a contact's full name, letters and digits only, to client task ids
  domains: Map<string, Set<string>>; // a company email domain to client task ids
  staff: Set<string>; // staff names, letters and digits only (full, and the first two words)
  titles: { taskId: string; keys: string[] }[];
  free: RegExp;
};

/** Letters and digits only, lower case, any script (as match.ts tight). */
function tight(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const words = (s: unknown) => String(s ?? "").trim().split(/\s+/).filter(w => tight(w) !== "");
const email = (s: unknown) => String(s ?? "").trim().toLowerCase();
const within = (a: number, b: number, minutes: number) => Math.abs(a - b) <= minutes * MIN;
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const offerable = (r: Recording) => !!r && (r.cls === "client" || r.cls === "candidate") && !r.gone;
const isCs = (r: Recording) => String(r.recorderTeam ?? "").trim().toLowerCase() === CS_TEAM;
const hhmm = (ms: number) => new Date(ms + KUWAIT_MS).toISOString().slice(11, 16);
const kindWord = (kind: string) => KIND_WORD[kind] ?? "call";

function closest<T extends { startsAt: number }>(list: T[], at: number): T | undefined {
  return [...list].sort((a, b) => Math.abs(a.startsAt - at) - Math.abs(b.startsAt - at) || a.startsAt - b.startsAt)[0];
}

/** Keep a live copy, then one on a client, then the Customer Success recorder's, then an offerable one, then the first. */
function keepFirst(a: Recording, b: Recording): number {
  const score = (r: Recording) => [r.gone ? 1 : 0, r.onTask ? 0 : 1, isCs(r) ? 0 : 1, offerable(r) ? 0 : 1];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
  return a.startsAt - b.startsAt || byId(a.recordingId, b.recordingId);
}

/** Best first: the 5.2 order, then the newer call, then the closer booking. */
function order(a: Cand, b: Cand): number {
  return a.rank - b.rank || b.at - a.at || a.gap - b.gap || byId(a.recordingId, b.recordingId) || byId(a.taskId, b.taskId);
}

function bestPer(cands: Cand[], key: (c: Cand) => string): Cand[] {
  const best = new Map<string, Cand>();
  for (const c of [...cands].sort(order)) if (!best.has(key(c))) best.set(key(c), c);
  return [...best.values()].sort(order);
}

/** A Fathom link without its query, fragment or trailing slash, or null for anything else. */
function shareKey(url: string | null | undefined): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?fathom\.video(\/[^?#\s]*)/i.exec(String(url ?? "").trim());
  const path = m ? m[1].replace(/\/+$/, "") : "";
  return path ? `fathom.video${path}` : null;
}

function formTask(shareUrl: string | null, formLinks: Map<string, string> | undefined): string | null {
  const key = shareKey(shareUrl);
  if (!key) return null;
  for (const [url, task] of formLinks ?? new Map<string, string>()) if (task && shareKey(url) === key) return task;
  return null;
}

/** The recording's invitee emails outside Mahara. */
const externalEmails = (rec: Recording) =>
  (rec.inviteeEmails ?? []).map(email).filter(e => e.includes("@") && !OUR_DOMAIN.test(e));

function liveBookings(bookings: Booking[]): Booking[] {
  return (bookings ?? []).filter(b => b && b.taskId && b.status !== "gone");
}

function otherClientNear(rec: Recording, taskId: string, live: Booking[]): boolean {
  return live.some(b => b.taskId !== taskId && within(b.startsAt, rec.startsAt, NEAR_MIN));
}

function exactOf(rec: Recording, bookings: Booking[], ctx: Ctx): Exact | null {
  if (!offerable(rec)) return null;
  const live = liveBookings(bookings);
  if (rec.room) {
    const same = live.filter(b => b.room === rec.room && within(b.startsAt, rec.startsAt, SAME_ROOM_WINDOW_MIN));
    const booking = closest(same, rec.startsAt);
    if (booking && new Set(same.map(b => b.taskId)).size === 1) return { taskId: booking.taskId, signal: "same_room", booking };
  }
  const mails = new Set(externalEmails(rec));
  if (mails.size) {
    // The email names a client through the clients list only (the worker's contacts index), unless that
    // client's booking with it starts within 30 minutes (appointment_time): a booking names its client,
    // listed or not, and the writers then take the booking's name (A7.12, A7.13).
    const listed = ctx.clientIds ? new Set(ctx.clientIds) : null;
    const hit = live.filter(
      b => (b.emails ?? []).some(e => mails.has(email(e))) && (!listed || listed.has(b.taskId) || within(b.startsAt, rec.startsAt, INVITE_MIN)),
    );
    const near = hit.filter(b => within(b.startsAt, rec.startsAt, INVITE_MIN));
    const tasks = new Set(hit.map(b => b.taskId));
    const nearTasks = new Set(near.map(b => b.taskId));
    const taskId = tasks.size === 1 ? [...tasks][0] : nearTasks.size === 1 ? [...nearTasks][0] : null;
    if (taskId) {
      const booking = closest(near.filter(b => b.taskId === taskId), rec.startsAt);
      return booking ? { taskId, signal: "invitee_email", booking } : { taskId, signal: "invitee_email" };
    }
  }
  const form = formTask(rec.shareUrl, ctx.formLinks);
  return form ? { taskId: form, signal: "pasted" } : null;
}

function indexOf(bookings: Booking[], clients: ClientRef[], ctx: Ctx): Index {
  const live = liveBookings(bookings);
  const names = new Map<string, string>();
  for (const b of live) if (b.clientName && !names.has(b.taskId)) names.set(b.taskId, b.clientName);
  for (const c of clients ?? []) if (c?.taskId && c.name) names.set(c.taskId, c.name);
  const free = ctx.freeMail ? new RegExp(ctx.freeMail.source, ctx.freeMail.flags.replace(/[gy]/g, "")) : FREE_MAIL;
  const add = (m: Map<string, Set<string>>, k: string, taskId: string) => m.set(k, (m.get(k) ?? new Set<string>()).add(taskId));
  const contacts = new Map<string, Set<string>>();
  const domains = new Map<string, Set<string>>();
  for (const b of live) {
    for (const n of b.contactNames ?? []) if (words(n).length >= 2) add(contacts, tight(n), b.taskId);
    for (const e of (b.emails ?? []).map(email))
      if (e.includes("@") && !OUR_DOMAIN.test(e) && !free.test(e)) add(domains, e.slice(e.lastIndexOf("@") + 1), b.taskId);
  }
  const staff = new Set<string>();
  for (const n of ctx.staffNames ?? []) {
    const w = words(n);
    if (!w.length) continue;
    staff.add(tight(n));
    if (w.length > 2) staff.add(tight(w.slice(0, 2).join(" ")));
  }
  const titles = (clients ?? [])
    .filter(c => c?.taskId)
    .map(c => ({
      taskId: c.taskId,
      keys: [
        ...[tight(c.name)].filter(k => k.length >= 4),
        ...(c.aliases ?? []).map(tight).filter(a => a.length >= 5 && !GENERIC_ALIASES.has(a)),
      ],
    }));
  return { live, name: t => names.get(t) ?? t, contacts, domains, staff, titles, free };
}

function cand(rec: Recording, taskId: string, signal: Signal, why: string, ix: Index,
  extra: { booking?: Booking; minutes?: number; rank?: number } = {}): Cand {
  const c: Cand = {
    recordingId: rec.recordingId,
    taskId,
    clientName: ix.name(taskId),
    signal,
    label: LABEL[signal],
    why,
    preselect: false,
    ask: ASKS.has(LABEL[signal]),
    rank: extra.rank ?? RANK[signal],
    at: rec.startsAt,
    gap: extra.booking ? Math.abs(rec.startsAt - extra.booking.startsAt) : Number.POSITIVE_INFINITY,
  };
  if (extra.booking) c.bookingId = extra.booking.id;
  if (extra.minutes !== undefined) c.minutes = extra.minutes;
  return c;
}

/** A possible or a hint from one booking, with its minutes and its side of the booking. */
function timed(rec: Recording, b: Booking, signal: "near_booking" | "hint_window", ix: Index): Cand {
  const n = Math.round(Math.abs(rec.startsAt - b.startsAt) / MIN);
  const side = rec.startsAt < b.startsAt ? "before" : "after";
  const client = ix.name(b.taskId);
  const why = signal === "near_booking"
    ? `Started ${n} min ${side} ${client}'s booked call at ${hhmm(b.startsAt)}.`
    : `${n} min ${side} ${client}'s booked call.`;
  return cand(rec, b.taskId, signal, why, ix, { booking: b, minutes: n });
}

function latestWhy(rec: Recording, ctx: Ctx): string {
  const mine = !!ctx.viewerEmail && email(ctx.viewerEmail) === email(rec.recorderEmail);
  if (mine) return "Your newest call that no client has yet.";
  const role = (ctx.roleOf?.(rec.recorderEmail) ?? "").trim() || "the CSM";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}'s newest call that no client has yet.`;
}

/** Every signal of one recording that needs no other recording: rows 1 to 6 and 3b. */
function direct(rec: Recording, bookings: Booking[], ix: Index, ctx: Ctx): Cand[] {
  const out: Cand[] = [];
  const e = exactOf(rec, bookings, ctx);
  if (e?.signal === "same_room" && e.booking)
    out.push(cand(rec, e.taskId, "same_room", `Same room as the ${kindWord(e.booking.kind)} booked for ${hhmm(e.booking.startsAt)}.`, ix, { booking: e.booking }));
  else if (e?.signal === "invitee_email")
    out.push(cand(rec, e.taskId, "invitee_email", "The client was on the invite.", ix, { booking: e.booking }));
  else if (e?.signal === "pasted")
    out.push(cand(rec, e.taskId, "pasted", "From the link in an earlier 1-1 form.", ix, { rank: FORM_LINK_RANK }));
  // Row 3b: stored on a client by an exact sign or a person; a likely sign's row (a name, a company domain) is not.
  if (rec.onTask && placedExactly(rec))
    out.push(cand(rec, rec.onTask, "matched", `On ${ix.name(rec.onTask)} in the call store.`, ix));
  // A speaker's full name (never a first name alone) that is one client's contact and no staff member's.
  for (const s of rec.speakers ?? []) {
    if (words(s).length < 2) continue;
    const key = tight(s);
    if (ix.staff.has(key)) continue;
    const owners = ix.contacts.get(key);
    if (owners?.size === 1) {
      const taskId = [...owners][0];
      out.push(cand(rec, taskId, "speaker_name", `${ix.name(taskId)}'s contact spoke on this call.`, ix));
    }
  }
  // The edited title only (never Fathom's meeting title): a full name or a distinctive alias.
  const title = tight(rec.title);
  if (title)
    for (const t of ix.titles)
      if (t.keys.some(k => title.includes(k))) out.push(cand(rec, t.taskId, "title", `The title names ${ix.name(t.taskId)}.`, ix));
  for (const m of externalEmails(rec)) {
    if (ix.free.test(m)) continue;
    const owners = ix.domains.get(m.slice(m.lastIndexOf("@") + 1));
    if (owners?.size === 1) out.push(cand(rec, [...owners][0], "domain", "Same company email domain.", ix));
  }
  return out;
}

function strip(c: Cand): Suggestion {
  const s: Suggestion = {
    recordingId: c.recordingId,
    taskId: c.taskId,
    clientName: c.clientName,
    signal: c.signal,
    label: c.label,
    why: c.why,
    preselect: c.preselect,
    ask: c.ask,
  };
  if (c.bookingId !== undefined) s.bookingId = c.bookingId;
  if (c.minutes !== undefined) s.minutes = c.minutes;
  return s;
}
