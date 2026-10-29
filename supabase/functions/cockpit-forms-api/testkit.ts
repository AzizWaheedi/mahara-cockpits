/**
 * Fakes for the cockpit-forms-api tests: the database (service and seat RPCs),
 * Fathom, Typeform, the model providers and storage, with no network. Every
 * person, email, room and link is invented; the recording ids and business names
 * are the contract's own evidence.
 */
import { type Rpc, RpcError } from "../cockpit-hours-sync/db.ts";
import type { Actor, Deps, OpCtx } from "./door.ts";

/** 2026-10-28 12:00 in Kuwait. */
export const NOW = new Date("2026-10-28T09:00:00.000Z");
export const CSM_EMAIL = "csm.seat@maharamedia.com";
export const ADMIN_EMAIL = "admin.seat@maharamedia.com";
export const CEO_EMAIL = "ceo.seat@maharamedia.com";
export const TEAM_EMAIL = "team.seat@maharamedia.com";
/** A closer: a seat outside Customer Success that records sales calls (rule 4 lets the recorder place its own). */
export const CLOSER_EMAIL = "closer.seat@maharamedia.com";
export const SEAT_TOKEN = "Bearer seat-token";
export const SERVICE_KEY = "service-key-for-tests";
export const csmActor: Actor = { actorId: "11111111-1111-4111-8111-111111111111", email: CSM_EMAIL, ceo: false, admin: false, csm: true, roles: ["csm"] };
export const adminActor: Actor = { actorId: "22222222-2222-4222-8222-222222222222", email: ADMIN_EMAIL, ceo: false, admin: true, csm: true, roles: ["csm", "admin"] };
export const ceoActor: Actor = { actorId: "33333333-3333-4333-8333-333333333333", email: CEO_EMAIL, ceo: true, admin: true, csm: true, roles: ["csm", "admin"] };
/** The closer's seat, which the client gate lets read the card in these fakes (the gate is the database's). */
export const closerActor: Actor = { actorId: "55555555-5555-4555-8555-555555555555", email: CLOSER_EMAIL, ceo: false, admin: false, csm: false, roles: ["sales"] };
export const STAFF = [
  { name: "Csm Seat", email: CSM_EMAIL, role: "the CSM" },
  { name: "Team Member", email: TEAM_EMAIL, role: "the creative director" },
  { name: "Ceo Seat", email: CEO_EMAIL, role: "the CEO" },
];

export type Call = { name: string; args: Record<string, any> };
type Handler = unknown | ((args: Record<string, any>, calls: Call[]) => unknown);

/** A database: each RPC answers its handler's value (a copy) or result; an unknown name is "not live". */
export function fakeRpc(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    if (!(name in handlers)) throw new RpcError(`Could not find the function public.${name}`, "PGRST202");
    const h = handlers[name];
    const out = typeof h === "function" ? await (h as (a: Record<string, unknown>, c: Call[]) => unknown)(args, calls) : h;
    return out === undefined ? null : structuredClone(out);
  };
  return { rpc, calls, named: (name: string) => calls.filter(c => c.name === name), handlers };
}

export type Sent = { url: string; method: string; headers: Record<string, string>; body: string | null };
type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | null | undefined;

/** The providers: each route answers a request it knows, else null for the next route; nothing known throws. */
export function fakeFetch(...routes: Route[]) {
  const sent: Sent[] = [];
  const fetchFake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    sent.push({ url: url.toString(), method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : null });
    for (const route of routes) {
      const answer = await route(url, init);
      if (answer) return answer;
    }
    throw new TypeError(`fetch failed: no fake for ${url.host}${url.pathname}`);
  }) as typeof fetch;
  return { fetch: fetchFake, sent };
}

export const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** Fathom's API: the meetings pages in order, summaries and transcripts by recording, users. */
export function fathomApi(opts: {
  pages?: Record<string, unknown>[][];
  status?: number;
  retryAfter?: string;
  summaries?: Record<string, string>;
  transcripts?: Record<string, unknown[]>;
  users?: number;
  usersStatus?: number;
} = {}): Route {
  let page = 0;
  return url => {
    if (url.host !== "api.fathom.ai") return null;
    const limits = { "ratelimit-limit": "60", "ratelimit-remaining": "55", "ratelimit-reset": "40" };
    if (url.pathname === "/external/v1/users") {
      if (opts.usersStatus && opts.usersStatus !== 200) return answer({}, opts.usersStatus, limits);
      return answer({ items: Array.from({ length: opts.users ?? 4 }, (_, i) => ({ name: `Person ${i + 1}` })) }, 200, limits);
    }
    if (opts.status && opts.status !== 200) return answer({}, opts.status, opts.retryAfter ? { ...limits, "retry-after": opts.retryAfter } : limits);
    if (url.pathname === "/external/v1/meetings") {
      const pages = opts.pages ?? [[]];
      const items = pages[Math.min(page, pages.length - 1)] ?? [];
      const next = page < pages.length - 1 ? `cursor-${page + 1}` : null;
      page += 1;
      return answer({ items, limit: 10, next_cursor: next }, 200, limits);
    }
    const rec = /^\/external\/v1\/recordings\/(\d+)\/(summary|transcript)$/.exec(url.pathname);
    if (rec && rec[2] === "summary") {
      const text = opts.summaries?.[rec[1]];
      return answer(text ? { summary: { template_name: "Enhanced", markdown_formatted: text } } : { summary: null });
    }
    if (rec && rec[2] === "transcript") return answer({ transcript: opts.transcripts?.[rec[1]] ?? [] });
    return answer({}, 404);
  };
}

/** A Fathom meeting as the list returns it, invented, recorded by the CSM. */
export function meeting(over: Record<string, any> = {}): Record<string, any> {
  const start = over.recording_start_time ?? "2026-10-28T07:00:00Z";
  const end = over.recording_end_time ?? "2026-10-28T07:30:00Z";
  return {
    recording_id: 194756343,
    title: "Impromptu Google Meet Meeting",
    meeting_title: "Impromptu Google Meet Meeting",
    url: "https://fathom.video/calls/500000001",
    share_url: "https://fathom.video/share/TESTshareAAA1",
    created_at: end,
    scheduled_start_time: start,
    scheduled_end_time: end,
    recording_start_time: start,
    recording_end_time: end,
    calendar_invitees_domains_type: "one_or_more_external",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    shared_with: "all_teams",
    recorded_by: { name: "Csm Seat", email: CSM_EMAIL, email_domain: "maharamedia.com", team: "Customer Success" },
    calendar_invitees: [{ name: "Csm Seat", email: CSM_EMAIL, is_external: false }],
    action_items: [],
    default_summary: null,
    transcript: null,
    ...over,
  };
}

/** One MatchInputs.store item, invented. */
export function storeItem(over: Record<string, any> = {}): Record<string, any> {
  return {
    recordingId: "194756343",
    startsAt: "2026-10-28T07:00:00.000Z",
    endsAt: "2026-10-28T07:30:00.000Z",
    room: null,
    title: "Impromptu Google Meet Meeting",
    meetingTitle: "Impromptu Google Meet Meeting",
    class: "candidate",
    recorderEmail: CSM_EMAIL,
    recorderTeam: "Customer Success",
    shareUrl: "https://fathom.video/share/TESTshareAAA1",
    inviteeEmails: [CSM_EMAIL],
    onTask: null,
    onTaskMethod: null,
    callId: 9001,
    linkedCallId: null,
    gone: false,
    settled: false,
    hasSummary: true,
    hasTranscript: false,
    actionItems: 3,
    notes: null,
    ...over,
  };
}

export function booking(over: Record<string, any> = {}): Record<string, any> {
  return {
    id: 54460,
    taskId: "86exCITYW",
    clientName: "City Wood",
    kind: "checkin",
    status: "confirmed",
    startsAt: "2026-10-28T07:00:00.000Z",
    endsAt: "2026-10-28T07:30:00.000Z",
    room: null,
    emails: ["owner@citywood.example"],
    contactNames: ["Omar Testcontact"],
    ...over,
  };
}

/** MatchInputs (3.5), invented: City Wood and Marble 10-12 on the list, the CSM alone in csmEmails. */
export function matchInputs(over: Record<string, any> = {}): Record<string, any> {
  return {
    from: "2026-10-26T21:00:00.000Z",
    to: NOW.toISOString(),
    bookings: [],
    sales: [],
    formLinks: [],
    clients: [
      { taskId: "86exCITYW", name: "City Wood", aliases: [] },
      { taskId: "86exMARBL", name: "Marble 10-12", aliases: [] },
    ],
    csmEmails: [CSM_EMAIL],
    staff: STAFF,
    client: { taskId: "86exCITYW", name: "City Wood", lastNoteAt: null, onClient: [] },
    store: [],
    ...over,
  };
}

/** The seats by actor id, as the database's cockpit_form_seat reads them. */
const SEATS: Record<string, Actor> = Object.fromEntries([csmActor, adminActor, ceoActor, closerActor].map(a => [a.actorId, a]));
/** Rule 2's methods: a call row an exact sign or a person placed (5.2 row 3b); invitee_email counts from 0.9. */
const EXACT_METHODS = new Set(["same_room", "appointment_time", "form_task_id", "manual", "client_id_field"]);
const WITHIN = (a: string, b: string, minutes: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= minutes * 60_000;

/**
 * cockpit_form_recordings_tied (20261027f, A7.14) as the database answers it over these rows: the ids, in the
 * order asked, that the tie rule lets the seat use for p_task_id; at most 50 asked. The seat is p_actor's, or
 * the seat of the response p_response_id (`responses`, by response id). On another card: never here. Rule 2:
 * its call row is on this card and an exact sign or a person placed it (`onTaskMethod` same_room,
 * appointment_time, form_task_id, manual or client_id_field, or invitee_email with `onTaskConfidence` 0.9 or
 * more); a row on this card that a likely sign placed (the worker's `name` at 0.6, `invitee_email` at 0.8),
 * or one with no confidence, settles nothing and goes on to rules 1, 3 and 4 like a row on no card (A7.14
 * rule 2 as decided in round 3, A7.17). Rule 1: a Customer Success recorder (team, or a csmEmails seat).
 * Rule 3 checks each of its clauses on its own for p_task_id, as cockpit_form_recording_tied does, over every
 * live booking given (the database sees bookings the window's MatchInputs leaves out): the same room, when
 * every live booking in that room within 90 minutes is this card's (and one is); an external invitee on any
 * live booking of this card (at any time
 * when the card is listed, else within 30 minutes), with no other-card condition, so an address on two cards'
 * bookings ties the recording for each (A7.14 rule 3); its link in a stored 1-1 form of this card. A room
 * that another card's booking shares fails the room clause only: the invitee and form clauses are still read.
 * Rule 4: the seat passes the card's gate (`gate`) and is an admin, the CEO or the recorder.
 *
 * What this model leaves to the SQL (cockpit_form_recording_tied in 20261027f): its rule 4 also needs the
 * card's client gate (cockpit_csm_client_gate_for_actor; no seat, a switched-off seat or a seat the gate
 * refuses ties nothing), which `gate` stands for here and defaults to open; and it ties nothing for an
 * unknown id (in neither the store nor the call table, even for the CEO) or a recording whose call row is
 * on another card, whatever the seat: here an id outside `store` and a store item on another card.
 */
export function tiedRpc(db: {
  store: Record<string, any>[];
  bookings?: Record<string, any>[];
  formLinks?: { shareUrl: string; taskId: string }[];
  listed?: string[];
  csmEmails?: string[];
  responses?: Record<string, Actor>;
  gate?: (seat: Actor, taskId: string) => boolean;
}) {
  return (a: Record<string, any>) => {
    const task = String(a.p_task_id);
    if ((a.p_recording_ids ?? []).length > 50) throw new RpcError("Ask about 50 recordings at most.", "22023");
    const seat = a.p_response_id ? (db.responses?.[a.p_response_id] ?? null) : (SEATS[a.p_actor] ?? null);
    const live = (db.bookings ?? []).filter(b => b.status !== "gone" && b.taskId);
    const listed = (db.listed ?? ["86exCITYW", "86exMARBL"]).includes(task);
    const exactHere = (s: Record<string, any>): boolean => {
      const inRoom = s.room ? live.filter(b => b.room === s.room && WITHIN(b.startsAt, s.startsAt, 90)) : [];
      if (inRoom.length > 0 && inRoom.every(b => b.taskId === task)) return true;
      const external = (s.inviteeEmails ?? []).map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.includes("@") && !e.endsWith("@maharamedia.com"));
      const invited = live.some(
        b => b.taskId === task && (b.emails ?? []).some((e: string) => external.includes(e.trim().toLowerCase())) && (listed || WITHIN(b.startsAt, s.startsAt, 30)),
      );
      if (invited) return true;
      return !!s.shareUrl && (db.formLinks ?? []).some(f => f.taskId === task && f.shareUrl === s.shareUrl);
    };
    const placedExactly = (s: Record<string, any>) =>
      EXACT_METHODS.has(String(s.onTaskMethod ?? "")) ||
      (s.onTaskMethod === "invitee_email" && s.onTaskConfidence != null && Number(s.onTaskConfidence) >= 0.9);
    const tied = (s: Record<string, any>) => {
      // A recording on another card stands for none here; on this card, rule 2 only for an exact or person-placed row.
      if (s.onTask && s.onTask !== task) return false;
      if (s.onTask === task && placedExactly(s)) return true;
      const recorder = String(s.recorderEmail ?? "").toLowerCase();
      if (String(s.recorderTeam ?? "").toLowerCase() === "customer success" || (db.csmEmails ?? [CSM_EMAIL]).includes(recorder)) return true;
      if (exactHere(s)) return true;
      if (!seat || !(db.gate ?? (() => true))(seat, task)) return false;
      return seat.admin || seat.ceo || (recorder !== "" && seat.email.toLowerCase() === recorder);
    };
    return [...new Set((a.p_recording_ids as string[]).map(String))].filter(id => {
      const s = db.store.find(x => String(x.recordingId) === id);
      return !!s && tied(s);
    });
  };
}

/** Everything a door or an op needs, faked, with what they wrote kept for the asserts. */
export function fakeDeps(opts: { rpc?: Record<string, Handler>; seat?: Record<string, Handler>; routes?: Route[]; env?: Record<string, string>; storage?: Record<string, string>; signed?: boolean; now?: Date } = {}) {
  const service = fakeRpc(opts.rpc ?? {});
  const seat = fakeRpc(opts.seat ?? {});
  const net = fakeFetch(...(opts.routes ?? []));
  const health: Record<string, unknown>[] = [];
  const keyChecks: Record<string, unknown>[] = [];
  const background: Promise<unknown>[] = [];
  const signedPaths: string[] = [];
  let n = 0;
  const deps: Deps = {
    serviceKey: SERVICE_KEY,
    getUser: async authorization => (authorization === SEAT_TOKEN ? { id: csmActor.actorId, email: CSM_EMAIL } : null),
    rpc: service.rpc,
    userRpc: () => seat.rpc,
    health: async row => {
      health.push(row);
    },
    keyChecks: async row => {
      keyChecks.push(row);
    },
    storage: {
      read: async path => opts.storage?.[path] ?? null,
      sign: async (path, seconds) => {
        signedPaths.push(`${path}:${seconds}`);
        return opts.signed === false ? null : `https://storage.example/signed/${path}?expires=${seconds}`;
      },
    },
    fetch: net.fetch,
    env: name => opts.env?.[name],
    now: () => opts.now ?? NOW,
    waitUntil: work => {
      background.push(work);
    },
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
  return { deps, service, seat, sent: net.sent, health, keyChecks, background, signedPaths, drain: () => Promise.all(background) };
}

export const opOf = (deps: Deps, actor: Actor = csmActor): OpCtx => ({ deps, actor, userRpc: deps.userRpc(SEAT_TOKEN) });

/** A JWT-shaped token with this payload (unsigned: the gateway checks signatures, the door only reads the role). */
export function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

/** The fathom key row as cockpit_forms_key_get returns it (the secret is invented). */
export const keyRow = (provider: string, secret = `test-${provider}-key-0123456789abcdef`) => ({
  provider,
  secret,
  last4: secret.slice(-4),
  state: "connected",
  savedAt: "2026-10-27T10:00:00Z",
  meta: {},
});
