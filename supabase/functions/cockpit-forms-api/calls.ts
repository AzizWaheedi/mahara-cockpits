/**
 * checkin.calls, the pull on open (docs/forms/STAGE2-CONTRACT.md 6.4): which call
 * these notes are for. The client gate first; then a pasted link, looked up in
 * the whole store; then the light pull when it is due (the 60-second cache is
 * cockpit_fathom_pull_due's); then the matcher over the store since 00:00 Kuwait
 * yesterday, this client's matched calls of the last 14 days and the pasted
 * recording; then the views (3.4). With no Fathom key in the vault only the
 * pull is skipped: the store the worker fills with its own key still answers.
 *
 * No contact name, email or speaker name is ever in a view, and nothing here
 * writes a client onto a recording: the pull's items carry only exact matches,
 * and the pasted link reaches rankForClient alone. A recording made outside
 * Customer Success is listed only when an exact or likely sign names this
 * client (a call row the worker put on this client from a likely sign is one)
 * or the viewer pasted its link, and it can be picked only when the tie
 * rule lets the viewer use it (fathom.ts, the database's
 * cockpit_form_recordings_tied, asked once per open, 50 at a time); another client's
 * recording names that client only to a seat that may see it.
 */
import {
  type Booking,
  type ClientRef,
  collapseDuplicates,
  type Ctx as MatchCtx,
  rankForClient,
  type Recording,
  type Suggestion,
} from "../../../hermes/csm-calls/callMatch.ts";
import { CS_TEAM } from "../../../hermes/csm-calls/fathomRules.ts";
import { DoorError, type OpCtx } from "./door.ts";
import {
  asInputs,
  BUSY_NOTE,
  checksOf,
  clientNameOf,
  elsewhereOf,
  GONE,
  hourOf,
  kuwaitYesterday,
  matchCtx,
  type MatchInputs,
  onOther,
  outsideOf,
  pullFathom,
  seesClient,
  type StoreItem,
  TEAM_MEETING,
  tiedHere,
  tiedIds,
  tieSentence,
  toBooking,
  toClient,
  toRecording,
  withBookings,
} from "./fathom.ts";

export type CallView = {
  ref: string;
  kind: "fathom" | "booking";
  recordingId: string | null;
  callId: number | null;
  title: string | null;
  startsAt: string;
  endsAt: string | null;
  minutes: number | null;
  why: string;
  label: "exact" | "likely" | "possible" | "default" | "hint" | "booking";
  ask: boolean;
  whyText: string;
  booking: { callId: number; startsAt: string; kind: string; status: string } | null;
  shareUrl: string | null;
  recorder: "csm" | "team" | "other" | null;
  recorderRole: string | null;
  actionItems: number | null;
  hasSummary: boolean;
  hasTranscript: boolean;
  onClient: "this" | "other" | "none";
  otherClient: string | null;
  /**
   * Why this recording cannot be picked for this client, else null: listed disabled, never picked. The save's
   * own sentence (A7.3: gone, a team meeting or sales, another client, or the tie rule's OUTSIDE_CS, which the
   * save holds too; OUTSIDE_CS_LIKELY when its call row is on this client by a likely sign, A7.14's sentences).
   */
  blocked: string | null;
  notesAlready: { at: string; source: "cockpit" | "typeform" } | null;
  duplicateOf: string | null;
};
export type CallsAnswer = {
  picked: CallView | null;
  others: CallView[];
  fathom: { state: "ok" | "waiting" | "failed" | "busy" | "off"; checkedAt: string | null; note: string | null };
  now: string;
};

/** No Fathom key in the vault: the window cannot read Fathom, but the worker's 15-minute read still fills the store (A3). */
export const OFF_NOTE = "Fathom isn't connected, so calls come only from the 15-minute read.";
/** What the CEO does about it; any other seat asks him. */
export const OFF_PASTE = "Paste the Fathom key in CEO > Client success > Connections for 1-1 notes.";
export const OFF_ASK = "Ask the CEO to connect it.";
export const WAITING_NOTE = "Fathom hasn't sent this call yet. It usually takes a few minutes after the call ends.";
export const NOT_FATHOM = "That is not a Fathom link.";
const RECENT_PULL_MS = 10_000;
const WAITING_MS = 3 * 3_600_000;
const KUWAIT_MS = 3 * 3_600_000;
const KIND_WORD: Record<string, string> = { checkin: "check-in", onboarding: "onboarding call", blueprint: "Brand Blueprint call", launch: "launch call" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const kindWord = (kind: string) => KIND_WORD[kind] ?? "call";
const kuwait = (ms: number) => new Date(ms + KUWAIT_MS);
const hhmm = (ms: number) => kuwait(ms).toISOString().slice(11, 16);
const dayOf = (ms: number) => {
  const d = kuwait(ms);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const iso = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());
const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** A client or candidate recording Fathom still has (5.2: the others are never offered). */
const offerable = (r: Recording) => (r.cls === "client" || r.cls === "candidate") && !r.gone;
export const offNote = (ceo: boolean) => `${OFF_NOTE} ${ceo ? OFF_PASTE : OFF_ASK}`;

type Body = { taskId: string; responseId: string | null; shareUrl: string | null; refresh: boolean };
type Shown = Pick<CallView, "why" | "label" | "ask" | "whyText">;
/** A recording with no sign for this client: listed with no why line (A7.3). */
const NO_SIGN: Shown = { why: "picked", label: "hint", ask: false, whyText: "" };
/** The recording a pasted link found (8.5, Pasted). */
const PASTED: Shown = { why: "pasted", label: "exact", ask: false, whyText: "From the Fathom link you pasted." };

function parse(body: Record<string, unknown>): Body {
  const taskId = String(body.taskId ?? "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) throw new DoorError("Open the notes from the client page.", 400);
  const responseId = body.responseId == null ? null : String(body.responseId);
  if (responseId !== null && !/^[0-9a-f-]{36}$/i.test(responseId)) throw new DoorError("Open the notes from the client page.", 400);
  const link = typeof body.shareUrl === "string" ? body.shareUrl.trim().slice(0, 2000) : "";
  return { taskId, responseId, shareUrl: link || null, refresh: body.refresh === true };
}

export async function checkinCalls(op: OpCtx, raw: Record<string, unknown>): Promise<CallsAnswer> {
  const body = parse(raw);
  const { deps, actor } = op;
  await deps.rpc("cockpit_csm_client_gate_for_actor", { p_actor: actor.actorId, p_task_id: body.taskId });
  const now = deps.now();
  const nowIso = now.toISOString();
  const from = kuwaitYesterday(now);
  const read = async () =>
    asInputs(await deps.rpc("cockpit_fathom_match_inputs", { p_from: from.toISOString(), p_to: nowIso, p_task_id: body.taskId }));
  let inputs = await read();
  const key = (await deps.rpc("cockpit_forms_key_get", { p_provider: "fathom" })) as { secret?: string } | null;

  // A pasted link first: found anywhere in the store, whatever its date (a database read: no key needed).
  const find = async (url: string) => (await deps.rpc("cockpit_fathom_find_link", { p_url: url })) as { found?: boolean; fathom?: boolean; store?: StoreItem };
  let pasted: StoreItem | null = null;
  let lookup: { found?: boolean; fathom?: boolean; store?: StoreItem } | null = null;
  if (body.shareUrl) {
    lookup = await find(body.shareUrl);
    if (!lookup?.found && !lookup?.fathom) throw new DoorError(NOT_FATHOM, 400);
    if (lookup.found && lookup.store) pasted = lookup.store;
  }

  let fathom: CallsAnswer["fathom"];
  if (!key?.secret) {
    // No key in the vault: no pull and no second lookup, but the store still answers (A3).
    fathom = { state: "off", checkedAt: null, note: offNote(actor.ceo) };
  } else {
    // The pull: when due, or when a pasted link or Check again needs a read the last pull (over 10 s ago) could not give.
    const due = ((await deps.rpc("cockpit_fathom_pull_due", {})) ?? {}) as { due?: boolean; lastRunAt?: string | null; ok?: boolean; note?: string | null };
    const age = due.lastRunAt ? now.getTime() - Date.parse(due.lastRunAt) : Number.POSITIVE_INFINITY;
    const stale = !(age <= RECENT_PULL_MS);
    fathom =
      due.ok === false
        ? { state: due.note === BUSY_NOTE ? "busy" : "failed", checkedAt: due.lastRunAt ?? null, note: due.note ?? null }
        : { state: "ok", checkedAt: due.lastRunAt ?? null, note: null };
    if (due.due === true || (stale && (body.refresh || (body.shareUrl && !pasted)))) {
      const pulled = await pullFathom(op, key.secret, inputs);
      fathom = { state: pulled.state, checkedAt: nowIso, note: pulled.note };
      if (pulled.items > 0) inputs = await read();
      if (body.shareUrl && !pasted) {
        lookup = await find(body.shareUrl);
        if (lookup?.found && lookup.store) pasted = lookup.store;
      }
    }
  }
  // A pasted recording older than the window is read with the bookings of its own hour, so its signs
  // (and a booking of another client in its room) read as they did then.
  const pastedAt = pasted ? Date.parse(String(pasted.startsAt)) : Number.NaN;
  if (Number.isFinite(pastedAt) && pastedAt < from.getTime()) inputs = withBookings(inputs, (await hourOf(op, pastedAt)).bookings);

  // The tie rule for this viewer (A7.14), asked once, only for the recordings made outside Customer Success
  // that would be listed (a sign names this client) or that were pasted.
  const asks = tieAsks(inputs, body.taskId, now.getTime(), pasted);
  const tied = asks.length ? await tiedIds(op, body.taskId, asks, { actor: actor.actorId }) : new Set<string>();
  const { picked, others, waitingBookings, otherTasks } = viewsFor(inputs, body.taskId, now.getTime(), actor, pasted, tied);
  // Another client's recording names that client, its title and its link only to a seat that may see that client.
  const hidden = new Set<string>();
  for (const t of new Set(otherTasks.values())) if (!(await seesClient(op, t))) hidden.add(t);
  const shown = others.map(v => (hidden.has(otherTasks.get(v.ref) ?? "") ? unnamed(v) : v));
  if (fathom.state === "ok" && !picked && waitingBookings) fathom = { ...fathom, state: "waiting", note: WAITING_NOTE };
  return { picked, others: shown, fathom, now: nowIso };
}

/** A view of a recording on a client this seat may not see: when and how long, and the sentence, nothing of the client's call. */
function unnamed(v: CallView): CallView {
  return {
    ...v,
    title: null,
    shareUrl: v.why === "pasted" ? v.shareUrl : null,
    booking: null,
    actionItems: null,
    hasSummary: false,
    hasTranscript: false,
    otherClient: null,
    blocked: v.blocked === GONE || v.blocked === TEAM_MEETING ? v.blocked : onOther(null),
    notesAlready: null,
  };
}

/** The seat reading the window: its email words the why lines ("Your …"). */
export type Viewer = { email: string | null };

/** What one window works from: every recording it may show (the store, this client's older calls, the pasted one) and the matcher's inputs. */
function sceneOf(inputs: MatchInputs, taskId: string, now: number, viewerEmail: string | null, pasted: StoreItem | null) {
  const items = new Map<string, StoreItem>();
  for (const s of inputs.store) if (s?.recordingId && !items.has(String(s.recordingId))) items.set(String(s.recordingId), s);
  const recs: Recording[] = inputs.store.map(toRecording);
  for (const o of inputs.client?.onClient ?? []) {
    const id = String(o.recordingId);
    if (items.has(id)) continue;
    const item = onClientItem(o, taskId);
    items.set(id, item);
    recs.push(toRecording(item));
  }
  if (pasted && !items.has(String(pasted.recordingId))) {
    items.set(String(pasted.recordingId), pasted);
    recs.push(toRecording(pasted));
  }
  return {
    items,
    recs,
    pastedRaw: pasted ? String(pasted.recordingId) : null,
    bookings: inputs.bookings.map(toBooking),
    clients: inputs.clients.map(toClient),
    ctx: matchCtx(inputs, now, viewerEmail),
  };
}

/**
 * The best sign a recording gives this client, as the window's ranking reads
 * it for this one recording (every sign counted, not only the best three
 * clients a candidate's hints keep): "exact", "likely", or null.
 */
function signOf(rec: Recording, taskId: string, bookings: Booking[], clients: ClientRef[], ctx: MatchCtx): "exact" | "likely" | null {
  const own = rankForClient(taskId, [rec], bookings, clients, { ...ctx, lastNoteAt: null, pastedShareUrl: null });
  const labels = [own.picked, ...own.others].filter(g => g?.taskId === taskId).map(g => g?.label);
  return labels.includes("exact") ? "exact" : labels.includes("likely") ? "likely" : null;
}

/**
 * A recording the tie rule needs the database for: a client or candidate call made outside Customer Success
 * that is on no other client, either on no client yet or on this one through a row a likely sign placed (the
 * worker's `name` at 0.6 or `invitee_email` at 0.8, or a row with no confidence: A7.14 rule 2 as decided in
 * round 3). Rules 1 and 2 settle the rest, and a recording on another client ties nothing here.
 */
const needsTie = (r: Recording, taskId: string, bookings: Booking[], ctx: MatchCtx) =>
  offerable(r) && !tiedHere(r, taskId, ctx) && !elsewhereOf(r, taskId, bookings, ctx);

/** The best sign a recording that needs the tie rule gives this client: its row on this client, placed by a likely sign, is one. */
const tieSignOf = (r: Recording, taskId: string, bookings: Booking[], clients: ClientRef[], ctx: MatchCtx): "exact" | "likely" | null =>
  signOf(r, taskId, bookings, clients, ctx) ?? (r.onTask === taskId ? "likely" : null);

/**
 * The recordings checkin.calls asks the tie rule about (A7.14): each one made
 * outside Customer Success and on no other client that the window would list,
 * because an exact or likely sign names this client, its call row is on this
 * client by a likely sign (rule 2 does not settle it, round 3), or its link
 * was pasted. Any other one made outside Customer Success is never listed, so
 * it needs no answer.
 */
export function tieAsks(inputs: MatchInputs, taskId: string, now: number, pasted: StoreItem | null): string[] {
  const { recs, pastedRaw, bookings, clients, ctx } = sceneOf(inputs, taskId, now, null, pasted);
  const asks = recs.filter(r => needsTie(r, taskId, bookings, ctx) && (r.recordingId === pastedRaw || tieSignOf(r, taskId, bookings, clients, ctx) !== null));
  return [...new Set(asks.map(r => r.recordingId))];
}

/**
 * The views for one client. `picked` is the matcher's pick; `others` are, in
 * order: the recording a pasted link found (when it is not the pick, whether
 * or not it can be picked), every other suggestion (best first), the
 * recordings with no sign for this client (newest first), the ones that cannot
 * be picked here, each listed with its `blocked` sentence and never picked
 * (from outside Customer Success with a sign for this client but untied for
 * this viewer, exact signs first, then on another client), and the started,
 * not cancelled bookings that no pickable recording stands for. The view a
 * pasted link found reads as pasted. A copy collapsed into another recording
 * of the same call is never listed: its call is.
 *
 * `tied` is the database's answer for this viewer (tieAsks, rules 1 to 4): a
 * recording made outside Customer Success that it does not name is untied.
 * An untied recording is ranked out like a gone or another client's one, so
 * it never takes the pick a recording the viewer may use would get, and it is
 * listed only when an exact or likely sign names this client or it was
 * pasted, disabled with OUTSIDE_CS, or OUTSIDE_CS_LIKELY when its call row is
 * on this client (a likely sign put it there, so "is not on this client" would
 * be false: A7.14's sentences, A7.18) (why 'picked', or 'pasted'; label 'hint';
 * no why line; no link unless pasted). So the CSM sees the CEO's unmatched
 * call whose title names this client, with the sentence, and the CEO, whom
 * rule 4 lets place it, picks it. `otherTasks` names the other client of each
 * view that is on one.
 */
export function viewsFor(
  inputs: MatchInputs,
  taskId: string,
  now: number,
  viewer: Viewer,
  pasted: StoreItem | null,
  tied: ReadonlySet<string>,
): { picked: CallView | null; others: CallView[]; waitingBookings: boolean; otherTasks: Map<string, string> } {
  const viewerEmail = viewer.email;
  const { items, recs, pastedRaw, bookings, clients, ctx } = sceneOf(inputs, taskId, now, viewerEmail, pasted);
  const byBooking = new Map(inputs.bookings.map(b => [Number(b.id), b] as const));
  const untied = new Set(recs.filter(r => needsTie(r, taskId, bookings, ctx) && !tied.has(r.recordingId)).map(r => r.recordingId));
  const usable = recs.filter(r => !untied.has(r.recordingId));
  const collapsed = collapseDuplicates(usable);
  const kept = collapsed.filter(r => !r.duplicateOf);
  const keptOf = new Map(collapsed.map(r => [r.recordingId, r.duplicateOf ?? null] as const));
  // One call recorded twice (the same room, minutes apart) is one call: an untied copy is never listed beside the copy kept.
  const copyOf = (r: Recording, among: Recording[]) => among.find(k => k.recordingId !== r.recordingId && collapseDuplicates([k, r]).some(x => x.duplicateOf))?.recordingId ?? null;
  const untiedKept = collapseDuplicates(recs.filter(r => untied.has(r.recordingId)));
  const untiedKeeper = new Map(untiedKept.map(r => [r.recordingId, r.duplicateOf ?? null] as const));
  // A pasted copy of a call stands for the copy that is kept.
  const pastedRec = pastedRaw ? recs.find(r => r.recordingId === pastedRaw) : undefined;
  const pastedId = !pastedRec
    ? null
    : !untied.has(pastedRec.recordingId)
      ? (keptOf.get(pastedRec.recordingId) ?? pastedRec.recordingId)
      : (copyOf(pastedRec, kept) ?? untiedKeeper.get(pastedRec.recordingId) ?? pastedRec.recordingId);
  const pastedShareUrl = pastedId ? (items.get(pastedId)?.shareUrl ?? pasted?.shareUrl ?? null) : null;

  const roles = new Map(inputs.staff.filter(s => s?.email).map(s => [lower(s.email), s.role ?? null] as const));
  const csm = new Set(inputs.csmEmails.map(lower));
  const name = (t: string) => clientNameOf(inputs, t);
  const lastNoteAt = inputs.client?.lastNoteAt ? Date.parse(inputs.client.lastNoteAt) : null;
  const ranked = rankForClient(taskId, usable, bookings, clients, { ...ctx, lastNoteAt: Number.isFinite(lastNoteAt) ? lastNoteAt : null, pastedShareUrl });

  // Why a recording cannot be picked for this client, in the order the save checks them (3.2), then the tie rule. A settled one can be.
  const refusal = (rec: Recording): string | null => {
    const r = checksOf(rec, taskId, bookings, ctx) ?? (untied.has(rec.recordingId) ? outsideOf(rec, taskId) : null);
    if (!r) return null;
    return r.reason === "gone" ? GONE : r.reason === "class" ? TEAM_MEETING : r.reason === "other" ? onOther(name(r.otherTask as string)) : tieSentence(r);
  };
  const covered = new Set<number>();
  const otherTasks = new Map<string, string>();
  const view = (s: StoreItem, as: Shown & { bookingId?: number }): CallView => {
    const rec = toRecording(s);
    const elsewhere = elsewhereOf(rec, taskId, bookings, ctx);
    const blocked = refusal(rec);
    const isPasted = rec.recordingId === pastedId;
    if (elsewhere) otherTasks.set(`fathom:${s.recordingId}`, elsewhere);
    // The pasted call reads as pasted whatever else the matcher found for it (A7.3). A refused one has no why
    // line and no label of its own; a refused pasted one keeps why 'pasted', so the window still finds it.
    const shown: Shown = blocked ? { ...NO_SIGN, why: isPasted ? "pasted" : "picked" } : isPasted ? PASTED : as;
    const bookingId = as.bookingId ?? (s.linkedCallId != null ? Number(s.linkedCallId) : undefined);
    const b = bookingId === undefined ? undefined : byBooking.get(bookingId);
    const email = lower(s.recorderEmail);
    return {
      ref: `fathom:${s.recordingId}`,
      kind: "fathom",
      recordingId: String(s.recordingId),
      callId: s.callId ?? null,
      title: s.title ?? s.meetingTitle ?? null,
      startsAt: iso(rec.startsAt) ?? String(s.startsAt ?? ""),
      endsAt: iso(rec.endsAt),
      minutes: rec.endsAt !== null && Number.isFinite(rec.startsAt) ? Math.max(0, Math.round((rec.endsAt - rec.startsAt) / 60_000)) : null,
      why: shown.why,
      label: shown.label,
      ask: shown.ask,
      whyText: shown.whyText,
      booking: b ? { callId: Number(b.id), startsAt: iso(Date.parse(b.startsAt)) ?? String(b.startsAt), kind: String(b.kind), status: String(b.status) } : null,
      // A row that cannot be picked needs only its sentence; the link stays on the one the person pasted.
      shareUrl: blocked && !isPasted ? null : (s.shareUrl ?? null),
      recorder: !email ? "other" : csm.has(email) ? "csm" : lower(s.recorderTeam) === lower(CS_TEAM) ? "team" : "other",
      recorderRole: email ? (roles.get(email) ?? null) : null,
      actionItems: typeof s.actionItems === "number" ? s.actionItems : null,
      hasSummary: !!s.hasSummary,
      hasTranscript: !!s.hasTranscript,
      onClient: elsewhere ? "other" : s.onTask === taskId ? "this" : "none",
      otherClient: elsewhere ? (name(elsewhere) ?? null) : null,
      blocked,
      notesAlready: s.notes ?? null,
      duplicateOf: null,
    };
  };
  // A recording that can be picked stands for its booking, which then gets no booking view of its own.
  const cover = (v: CallView, s: StoreItem, bookingId?: number) => {
    if (v.blocked) return;
    if (bookingId !== undefined && (v.label === "exact" || v.label === "possible")) covered.add(bookingId);
    if (s.linkedCallId != null) covered.add(Number(s.linkedCallId));
  };
  const fromSuggestion = (g: Suggestion): CallView | null => {
    const s = items.get(g.recordingId);
    if (!s) return null;
    const v = view(s, { why: g.signal, label: g.label, ask: g.ask, whyText: cardText(g, s, byBooking, viewerEmail, roles), bookingId: g.bookingId });
    cover(v, s, g.bookingId);
    return v;
  };

  const first = ranked.picked ? fromSuggestion(ranked.picked) : null;
  // A refused view is listed, never picked (A7.3). The matcher offers none, so this only holds the rule.
  const picked = first?.blocked ? null : first;
  // The window finds the view a pasted link found by its why, which a stored 1-1 form's link shares, so
  // that view leads the list when it is not the pick; then the pickable views, then the refused ones.
  const lead: CallView[] = [];
  const plain: CallView[] = [];
  const disabled: CallView[] = [];
  const place = (v: CallView) => (v.recordingId === pastedId ? lead : v.blocked ? disabled : plain).push(v);
  const listed = new Set<string>();
  for (const v of [first, ...ranked.others.map(fromSuggestion)]) {
    if (!v?.recordingId || listed.has(v.recordingId)) continue;
    listed.add(v.recordingId);
    if (v !== picked) place(v);
  }
  const newest = (a: Recording, b: Recording) => b.startsAt - a.startsAt;
  // Untied for this viewer: listed only when a sign names this client or it was pasted, exact signs first.
  const signed = untiedKept
    .filter(r => !r.duplicateOf && !copyOf(r, kept))
    .map(r => ({ r, sign: r.recordingId === pastedId ? "exact" : tieSignOf(r, taskId, bookings, clients, ctx) }))
    .filter(x => x.sign !== null)
    .sort((a, b) => (a.sign === b.sign ? newest(a.r, b.r) : a.sign === "exact" ? -1 : 1));
  for (const { r } of signed) {
    listed.add(r.recordingId);
    place(view(items.get(r.recordingId) as StoreItem, NO_SIGN));
  }
  for (const r of kept.filter(r => !listed.has(r.recordingId)).sort(newest)) {
    // A team meeting, a sales call or a gone recording is offered to no one, and one made outside Customer
    // Success that is not on this client and has no sign for it (a prospect's call reads client until the
    // sales desk indexes it), or that is on another client, is not listed: either only when it was pasted,
    // to say why. A Customer Success recording on another client is listed with that client's sentence. One
    // the database tied for this viewer is listed (a closer's call on this client by a likely sign, which
    // the CEO, an admin or its recorder may use: rule 4).
    if (r.recordingId !== pastedId && (!offerable(r) || !(tiedHere(r, taskId, ctx) || tied.has(r.recordingId)))) continue;
    const s = items.get(r.recordingId) as StoreItem;
    const v = view(s, NO_SIGN);
    cover(v, s);
    place(v);
  }
  const others = [...lead, ...plain, ...disabled, ...bookingViews(inputs, taskId, now, covered)];
  const waitingBookings = inputs.bookings.some(
    b => b.taskId === taskId && b.status !== "cancelled" && Date.parse(b.startsAt) <= now && now - Date.parse(b.startsAt) <= WAITING_MS,
  );
  return { picked, others, waitingBookings, otherTasks };
}

/** An older call of this client known only from its call row (MatchInputs.client.onClient). */
function onClientItem(o: NonNullable<MatchInputs["client"]>["onClient"][number], taskId: string): StoreItem {
  return {
    recordingId: String(o.recordingId),
    startsAt: o.startsAt,
    endsAt: null,
    room: null,
    title: null,
    meetingTitle: null,
    class: "client",
    recorderEmail: null,
    recorderTeam: null,
    shareUrl: null,
    inviteeEmails: [],
    onTask: taskId,
    onTaskMethod: o.method ?? null,
    // With the method, how the row was placed (A7.14 rule 2); none sent reads as not exact.
    onTaskConfidence: o.confidence ?? null,
    callId: o.callId ?? null,
    linkedCallId: null,
    gone: false,
    settled: false,
    hasSummary: false,
    hasTranscript: false,
    actionItems: null,
    notes: null,
  };
}

/** The window's sentence for a pick (8.5, This call), from the matcher's own words and the booking it names. */
function cardText(
  g: Suggestion,
  s: StoreItem,
  byBooking: Map<number, MatchInputs["bookings"][number]>,
  viewerEmail: string | null,
  roles: Map<string, string | null>,
): string {
  const mine = !!viewerEmail && lower(viewerEmail) === lower(s.recorderEmail);
  const whose = mine ? "Your" : `${capital((roles.get(lower(s.recorderEmail)) ?? "").trim() || "the CSM")}'s`;
  const start = Date.parse(String(s.startsAt));
  switch (g.label) {
    case "likely":
      return `${g.why} Is this the call?`;
    case "possible": {
      const b = g.bookingId === undefined ? undefined : byBooking.get(g.bookingId);
      if (!b) return `${g.why} Is this the call?`;
      const n = g.minutes ?? Math.round(Math.abs(start - Date.parse(b.startsAt)) / 60_000);
      const side = start < Date.parse(b.startsAt) ? "before" : "after";
      return `${whose} recording ${n} ${n === 1 ? "minute" : "minutes"} ${side} the ${kindWord(b.kind)} booked for ${hhmm(Date.parse(b.startsAt))}. Is this the call?`;
    }
    case "default":
      return `${g.why.replace(/\.$/, "")} (${dayOf(start)}, ${hhmm(start)}). Is this the call?`;
    default:
      return g.why;
  }
}

/** This client's bookings that have started, were not cancelled and that no recording stands for, newest first. */
function bookingViews(inputs: MatchInputs, taskId: string, now: number, covered: Set<number>): CallView[] {
  return inputs.bookings
    .filter(b => b.taskId === taskId && b.status !== "cancelled" && b.status !== "gone" && Date.parse(b.startsAt) <= now && !covered.has(Number(b.id)))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .map(b => {
      const start = Date.parse(b.startsAt);
      const end = b.endsAt ? Date.parse(b.endsAt) : Number.NaN;
      return {
        ref: `booking:${b.id}`,
        kind: "booking",
        recordingId: null,
        callId: Number(b.id),
        title: null,
        startsAt: new Date(start).toISOString(),
        endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
        minutes: Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 60_000)) : null,
        why: "booking",
        label: "booking",
        ask: false,
        whyText: `The ${kindWord(b.kind)} booked for ${hhmm(start)}. No recording found for it.`,
        booking: { callId: Number(b.id), startsAt: new Date(start).toISOString(), kind: String(b.kind), status: String(b.status) },
        shareUrl: null,
        recorder: null,
        recorderRole: null,
        actionItems: null,
        hasSummary: false,
        hasTranscript: false,
        onClient: "this",
        otherClient: null,
        blocked: null,
        notesAlready: null,
        duplicateOf: null,
      } satisfies CallView;
    });
}
