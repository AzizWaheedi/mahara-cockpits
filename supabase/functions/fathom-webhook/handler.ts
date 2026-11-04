// fathom-webhook's one route (docs/forms/STAGE2-CONTRACT.md 4.4; README.md
// here). Fathom posts each finished recording's Meeting, signed with the secret
// it gave at registration (scripts/dev/forms_key.py register-webhook), which
// the vault keeps (cockpit_forms_key_get). Everything that touches the network
// or the clock comes in through Deps, so `bun test` runs it with no network.
//
// One delivery, in order: POST only; the three webhook headers; the body, read
// once, 2,000,000 bytes at most; the timestamp window and a v1 signature, which
// need no secret; the secret; the signature; the delivery seen
// once per webhook-id; Customer Success recordings only; the ingest item built
// with the worker's own rules (fathomRules.ts, callMatch.ts, match.ts); the
// ingest; the outcome. From the first delivery write on, a throw settles the
// delivery failed and answers 500, so Fathom's retry is processed again.
//
// Nothing of a body is kept but what the ingest stores for a Customer Success
// recording (cockpit_fathom_ingest, which re-checks the sales index and keeps
// a matched call's match). Nothing is logged but one line per delivery,
// `fathom-webhook {first 8 of webhook-id} {outcome}`: never a body, a header
// value, a title, a name or a secret.

import { type Booking, type ClientRef, type Ctx, exactMatch, type Recording, suggestionsFor } from "../../../hermes/csm-calls/callMatch.ts";
import { CS_TEAM, callRowBase, classifyMeeting, type FathomMeeting, meetingRow, speakers } from "../../../hermes/csm-calls/fathomRules.ts";
import { hashOf, titleKind } from "../../../hermes/csm-calls/match.ts";
import { type Rpc, restRpc } from "../cockpit-hours-sync/db.ts";
import { headersVerdict, verifyFathom } from "./verify.ts";

export type Deps = {
  env: (name: string) => string;
  fetch: typeof fetch;
  /** Wall-clock time in ms: the signature window, the secret's cache, the rows' updated_at. */
  now: () => number;
  /** The one line per delivery. */
  log: (line: string) => void;
};

/** A delivery larger than this is refused before it is checked (a Meeting with its transcript is far smaller). */
export const MAX_BODY_BYTES = 2_000_000;
/** The webhook secret is read from the vault at most once in this long, per isolate. */
export const SECRET_TTL_MS = 5 * 60_000;
/**
 * While no secret is saved (before registration), it is read again at most once in this long, per isolate:
 * a flood of fresh, v1-shaped requests costs one vault read in 30 seconds, not one each. Each answers 503.
 */
export const MISSING_SECRET_TTL_MS = 30_000;
/** Each database call gives up after this long; Fathom retries a delivery that was not answered. */
const DB_TIMEOUT_MS = 15_000;
/** cockpit_fathom_match_inputs reads the recording's start ± 2 h (and pads its bookings 2 h more). */
const WINDOW_MS = 2 * 3_600_000;
/** The webhook classifies with an empty sales set: the ingest re-checks the sales index (contract 4.2, 4.3). */
const NO_SALES: ReadonlySet<string> = new Set();
/** The ingest's recording id rule (cockpit_fathom_ingest). */
const RECORDING_ID = /^\d{3,20}$/;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

type Outcome =
  | "method"
  | "missing"
  | "too_large"
  | "no_database"
  | "key_unreadable"
  | "no_secret"
  | "stale"
  | "bad_signature"
  | "bad_secret"
  | "duplicate"
  | "ignored"
  | "stored"
  | "failed";
type Row = Record<string, any>;

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

/** The first 8 characters of webhook-id for the log line, letters, digits, _ and - only. */
function tagOf(id: string | null): string {
  return (id ?? "").slice(0, 8).replace(/[^A-Za-z0-9_-]/g, "") || "-";
}

/** The raw body as text, or null when it is larger than `max` bytes (read a chunk at a time, never whole). */
async function readBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The Meeting in a signed body, or null when the body is not one (no JSON object, no recording id). */
function meetingOf(raw: string): FathomMeeting | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const m = body as FathomMeeting;
  return RECORDING_ID.test(String(m.recording_id ?? "")) ? m : null;
}

const list = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(e => e && typeof e === "object" && !Array.isArray(e)) : []);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const msOf = (v: unknown): number | null => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
};

/** cockpit_fathom_match_inputs (MatchInputs, contract 3.5) in the matcher's shapes. */
function matcherInputs(v: unknown, now: number): { bookings: Booking[]; clients: ClientRef[]; ctx: Ctx } {
  const m: Row = v && typeof v === "object" ? (v as Row) : {};
  const bookings: Booking[] = [];
  for (const b of list(m.bookings)) {
    const id = Number(b.id);
    const startsAt = msOf(b.startsAt);
    if (!Number.isFinite(id) || startsAt === null || !b.taskId) continue;
    bookings.push({
      id,
      taskId: String(b.taskId),
      clientName: String(b.clientName ?? ""),
      kind: String(b.kind ?? "other"),
      status: String(b.status ?? ""),
      startsAt,
      endsAt: msOf(b.endsAt),
      room: typeof b.room === "string" && b.room ? b.room : null,
      emails: texts(b.emails),
      contactNames: texts(b.contactNames),
    });
  }
  const clients: ClientRef[] = list(m.clients)
    .filter(c => c.taskId && typeof c.name === "string" && c.name)
    .map(c => ({ taskId: String(c.taskId), name: c.name, aliases: texts(c.aliases) }));
  const formLinks = new Map<string, string>();
  for (const f of list(m.formLinks)) if (typeof f.shareUrl === "string" && f.taskId) formLinks.set(f.shareUrl, String(f.taskId));
  const staff = list(m.staff);
  const roles = new Map<string, string | null>();
  for (const s of staff) if (typeof s.email === "string") roles.set(s.email.toLowerCase(), typeof s.role === "string" ? s.role : null);
  const ctx: Ctx = {
    formLinks,
    staffNames: staff.map(s => s.name).filter((n): n is string => typeof n === "string" && !!n.trim()),
    csmEmails: texts(m.csmEmails).map(e => e.toLowerCase()),
    now,
    viewerEmail: null,
    roleOf: email => roles.get(String(email ?? "").toLowerCase()) ?? null,
    // The client on the invite names only a listed client, as the worker's contacts index (contract A7.13).
    clientIds: clients.map(c => c.taskId),
  };
  return { bookings, clients, ctx };
}

/**
 * The recording as the matcher reads it, from the Meeting and its stored row. inviteeEmails are every calendar
 * invitee's, lower-cased, as the worker and the pull build them (contract A7 item 2). The title is the edited one
 * only, never the calendar's meeting_title (5.2 row 5, A7 item 12).
 */
export function recordingOf(m: FathomMeeting, row: Row, cls: "client" | "candidate"): Recording {
  const emails = new Set<string>();
  for (const i of list(m.calendar_invitees)) {
    const e = String(i.email ?? "").trim().toLowerCase();
    if (e) emails.add(e);
  }
  return {
    recordingId: String(row.recording_id),
    startsAt: msOf(row.starts_at) ?? Number.NaN,
    endsAt: msOf(row.ends_at),
    room: typeof row.room === "string" ? row.room : null,
    title: typeof m.title === "string" ? m.title : null,
    meetingTitle: typeof m.meeting_title === "string" ? m.meeting_title : null,
    cls,
    recorderEmail: typeof row.recorded_by_email === "string" ? row.recorded_by_email : null,
    recorderTeam: typeof m.recorded_by?.team === "string" ? m.recorded_by.team : null,
    inviteeEmails: [...emails],
    shareUrl: typeof m.share_url === "string" ? m.share_url : null,
    speakers: speakers(m.transcript),
  };
}

/**
 * What an exact match writes, in the worker's words (match.ts matchMeeting):
 * the same room, the client's email on a booking within 30 minutes
 * (appointment_time) or, for a client on the clients list, anywhere on that
 * client's bookings (invitee_email, contract A7.13),
 * and the recording's link in a stored 1-1 form (form_task_id). The worker's
 * candidate rows and the pull map it the same way (contract A7 item 2).
 */
function methodOf(exact: NonNullable<ReturnType<typeof exactMatch>>): { method: string; confidence: number } {
  if (exact.signal === "same_room") return { method: "same_room", confidence: 1 };
  if (exact.signal === "invitee_email")
    return exact.bookingId === undefined ? { method: "invitee_email", confidence: 0.9 } : { method: "appointment_time", confidence: 1 };
  return { method: "form_task_id", confidence: 0.95 };
}

export function makeHandler(deps: Deps): (req: Request) => Promise<Response> {
  const env = (n: string) => (deps.env(n) ?? "").trim();
  let cached: { secret: string; at: number } | null = null;
  let missingAt: number | null = null;
  let door: Rpc | null = null;

  function rpc(): Rpc | null {
    if (door) return door;
    const url = env("SUPABASE_URL").replace(/\/+$/, "");
    const key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;
    const timed = ((input: RequestInfo | URL, init?: RequestInit) =>
      deps.fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) })) as typeof fetch;
    door = restRpc(url, key, timed);
    return door;
  }

  /** The webhook secret, from the vault through the service RPC; a found one is kept 5 minutes, a missing one 30 seconds. */
  async function secretOf(db: Rpc): Promise<string | null> {
    const now = deps.now();
    if (cached && now - cached.at < SECRET_TTL_MS) return cached.secret;
    if (missingAt !== null && now - missingAt < MISSING_SECRET_TTL_MS) return null;
    const key = (await db("cockpit_forms_key_get", { p_provider: "fathom_webhook" })) as Row | null;
    const secret = typeof key?.secret === "string" && key.secret ? key.secret : null;
    cached = secret ? { secret, at: now } : null;
    missingAt = secret ? null : now;
    return secret;
  }

  /** The ingest item (contract 3.6): the meeting always, the call for a client or candidate recording. */
  async function itemOf(db: Rpc, m: FathomMeeting): Promise<{ meeting: Row; call: Row | null }> {
    const cls = classifyMeeting(m, NO_SALES);
    const now = deps.now();
    const nowIso = new Date(now).toISOString();
    const { updated_at: _meetingAt, ...meeting } = meetingRow(m, cls, nowIso);
    if (cls !== "client" && cls !== "candidate") return { meeting, call: null };
    const start = msOf(meeting.starts_at) ?? now;
    const inputs = await db("cockpit_fathom_match_inputs", {
      p_from: new Date(start - WINDOW_MS).toISOString(),
      p_to: new Date(start + WINDOW_MS).toISOString(),
    });
    const { bookings, clients, ctx } = matcherInputs(inputs, now);
    const rec = recordingOf(m, meeting, cls);
    // Only an exact match writes a client; the time signals stay hints (contract 5.2).
    const exact = exactMatch(rec, bookings, ctx);
    const booking = exact?.bookingId === undefined ? undefined : bookings.find(b => b.id === exact.bookingId);
    const how = exact ? methodOf(exact) : null;
    const base = callRowBase(m, cls, nowIso);
    // A candidate while no exact rule places it; a client-class recording never is one (contract 4.1, 4.3).
    const candidate = cls === "candidate" && !exact;
    const call: Row = {
      source_id: base.source_id,
      task_id: exact?.taskId ?? null,
      client_name: exact ? clients.find(c => c.taskId === exact.taskId)?.name || booking?.clientName || null : null,
      match_method: how?.method ?? null,
      match_confidence: how?.confidence ?? null,
      kind: booking?.kind ?? titleKind(m.title ?? m.meeting_title),
      title: base.title,
      starts_at: base.starts_at,
      ends_at: base.ends_at,
      host_email: base.host_email,
      host_name: base.host_name,
      recording_url: base.recording_url,
      summary: base.summary,
      external_invitees: base.external_invitees,
      linked_call_id: booking?.id ?? null,
      candidate,
      room: base.room,
      // Hints only on an unplaced candidate: a matched call and a client-class one carry none, as the worker and
      // the pull write them (contract A7 item 12). The ingest, not this item, decides the hints of a row the store
      // already holds placed or settled (4.3).
      hints: candidate ? suggestionsFor(rec, bookings, clients, ctx).slice(0, 3) : [],
      // The worker's hash of the same recording (sources.ts), so its next run changes nothing.
      raw_hash: hashOf([String(m.recording_id), m.default_summary?.markdown_formatted ?? ""]),
    };
    return { meeting, call };
  }

  return async req => {
    const id = req.headers.get("webhook-id");
    const answer = (outcome: Outcome, status: number, body: Row, extra: Record<string, string> = {}): Response => {
      deps.log(`fathom-webhook ${tagOf(id)} ${outcome}`);
      return json(body, status, extra);
    };
    if (req.method !== "POST") return answer("method", 405, { ok: false }, { allow: "POST" });
    const timestamp = req.headers.get("webhook-timestamp");
    const signature = req.headers.get("webhook-signature");
    if (!id || !timestamp || !signature) return answer("missing", 401, { ok: false });
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return answer("too_large", 413, { ok: false });
    // What needs no secret is refused before the secret is read: a stale timestamp or no v1 signature costs no vault read.
    const shape = headersVerdict(id, timestamp, signature, Math.floor(deps.now() / 1000));
    if (!shape.ok) return answer(shape.reason, 401, { ok: false });

    // Nothing is written before the signature holds: no secret, or a database that cannot be read, is a 503 Fathom retries.
    const db = rpc();
    if (!db) return answer("no_database", 503, { ok: false });
    let secret: string | null;
    try {
      secret = await secretOf(db);
    } catch {
      return answer("key_unreadable", 503, { ok: false });
    }
    if (!secret) return answer("no_secret", 503, { ok: false });
    const verdict = await verifyFathom(secret, id, timestamp, raw, signature, Math.floor(deps.now() / 1000));
    if (!verdict.ok) return answer(verdict.reason, 401, { ok: false });

    const settle = (outcome: "stored" | "ignored" | "failed", recordingId: string | null, reason: string | null) =>
      db("cockpit_fathom_webhook_settle", { p_webhook_id: id, p_outcome: outcome, p_recording_id: recordingId, p_reason: reason });
    let step = "seen";
    let recordingId: string | null = null;
    try {
      const seen = (await db("cockpit_fathom_webhook_seen", {
        p_webhook_id: id,
        p_timestamp: new Date(Number(timestamp) * 1000).toISOString(),
      })) as Row | null;
      if (typeof seen?.first !== "boolean") throw new Error("cockpit_fathom_webhook_seen answered without first");
      if (!seen.first) return answer("duplicate", 200, { ok: true, duplicate: true });
      step = "settle";
      const m = meetingOf(raw);
      if (!m) {
        await settle("ignored", null, "Not a meeting.");
        return answer("ignored", 200, { ok: true });
      }
      recordingId = String(m.recording_id);
      // The closer's sales calls and the CEO's recordings stop here: nothing of them is stored.
      if (m.recorded_by?.team !== CS_TEAM || m.shared_with === "no_teams") {
        await settle("ignored", recordingId, "Not a Customer Success recording.");
        return answer("ignored", 200, { ok: true });
      }
      step = "match";
      const item = await itemOf(db, m);
      step = "ingest";
      await db("cockpit_fathom_ingest", { p_items: [item], p_via: "webhook" });
      step = "settle";
      await settle("stored", recordingId, null);
      return answer("stored", 200, { ok: true });
    } catch (e) {
      // The step and the database's error code only: an error's text can carry a value from the body.
      const code = typeof (e as { code?: unknown })?.code === "string" ? ` (${(e as { code: string }).code})` : "";
      await settle("failed", recordingId, `Failed at the ${step} step${code}.`).catch(() => {});
      return answer("failed", 500, { ok: false });
    }
  };
}
