/**
 * Fakes for the fathom-webhook tests: a database that answers the five service
 * RPCs the handler calls (and records each call with the key it carried), a
 * signer written with node:crypto, so verify.ts is held against a second
 * implementation, and invented Meetings, people, clients and rooms (Zoom ids
 * like 12345678901, passcode TEST, Meet codes from the contract's allow-list).
 * Nothing here touches a network. Test-only: index.ts never imports it.
 */
import { createHmac } from "node:crypto";
import { makeHandler } from "./handler.ts";

export const NOW = Date.parse("2026-10-28T08:30:00Z"); // 11:30 in Kuwait
export const BASE = "https://db.test";
export const SERVICE_KEY = "sb_service_key_for_tests_only";
/** An invented webhook secret, put together at run time so this file holds nothing shaped like one. */
export const SECRET = ["whsec", btoa("an invented webhook key for tests")].join("_");
export const CS = "Customer Success";

export const CSM = { name: "Test CSM", email: "csm@maharamedia.com", email_domain: "maharamedia.com", team: CS };
export const CLOSER = { name: "Test Closer", email: "closer@maharamedia.com", email_domain: "maharamedia.com", team: "Sales" };
export const CLIENT = { taskId: "86extest1", name: "Cedar Bakery" };
export const OTHER = { taskId: "86extest2", name: "Harbour Optics" };
export const CONTACT = { name: "Client Contact", email: "owner@client.example" };
export const ROOM_URL = "https://us05web.zoom.us/j/12345678901?pwd=TEST";
export const ROOM = "zoom:12345678901";

type Row = Record<string, any>;

/** "v1,<base64 HMAC-SHA256>" over `${id}.${timestamp}.${body}`, keyed with the base64 after "whsec_". */
export function sign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** An impromptu Customer Success recording with no client on the invite: a candidate. */
export function meeting(over: Row = {}): Row {
  return {
    title: "Impromptu Zoom Meeting",
    meeting_title: "Impromptu Zoom Meeting",
    recording_id: 196100001,
    url: "https://fathom.video/calls/500000001",
    share_url: "https://fathom.video/share/TESTshare196100001",
    created_at: "2026-10-28T08:06:00Z",
    scheduled_start_time: "2026-10-28T07:30:00Z",
    scheduled_end_time: "2026-10-28T08:00:00Z",
    recording_start_time: "2026-10-28T07:31:00Z",
    recording_end_time: "2026-10-28T08:05:00Z",
    meeting_url: ROOM_URL,
    calendar_invitees_domains_type: "one_or_more_external",
    shared_with: "all_teams",
    transcript_language: "en",
    calendar_invitees: [{ name: CSM.name, email: CSM.email, email_domain: CSM.email_domain, is_external: false }],
    recorded_by: CSM,
    default_summary: { template_name: "general", markdown_formatted: "## An invented summary\nNothing here is real." },
    action_items: [
      {
        description: "Send the invented report",
        user_generated: false,
        completed: false,
        recording_timestamp: "00:12:03",
        recording_playback_url: "https://fathom.video/share/TESTshare196100001?timestamp=723",
        assignee: { name: CSM.name, email: CSM.email, team: CS },
      },
    ],
    highlights: [{ text: "An invented highlight" }],
    transcript: [
      { speaker: { display_name: CSM.name, matched_calendar_invitee_email: CSM.email }, text: "An invented first line.", timestamp: "00:00:04" },
      { speaker: { display_name: CONTACT.name, matched_calendar_invitee_email: null }, text: "An invented reply.", timestamp: "00:00:09" },
    ],
    crm_matches: null,
    ...over,
  };
}

/** A GoHighLevel booking as cockpit_fathom_match_inputs lists it (contract 3.5). */
export function booking(over: Row = {}): Row {
  return {
    id: 54001,
    taskId: CLIENT.taskId,
    clientName: CLIENT.name,
    kind: "checkin",
    status: "confirmed",
    startsAt: "2026-10-28T07:30:00Z",
    endsAt: "2026-10-28T08:00:00Z",
    room: null,
    emails: [CONTACT.email],
    contactNames: [CONTACT.name],
    ...over,
  };
}

/** MatchInputs with the two invented clients and the CSM, no booking and no form link. */
export function inputs(over: Row = {}): Row {
  return {
    from: "2026-10-28T05:31:00Z",
    to: "2026-10-28T09:31:00Z",
    bookings: [],
    sales: [],
    formLinks: [],
    clients: [
      { taskId: CLIENT.taskId, name: CLIENT.name, aliases: [] },
      { taskId: OTHER.taskId, name: OTHER.name, aliases: [] },
    ],
    csmEmails: [CSM.email],
    staff: [{ name: CSM.name, email: CSM.email, role: "the CSM" }],
    client: null,
    store: [],
    ...over,
  };
}

export type RpcCall = { name: string; args: Row; apikey: string | null; authorization: string | null };
type Delivery = { outcome: string; lastAt: number; receipts: number; recordingId: string | null; reason: string | null };

const reply = (body: unknown, status = 200) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * The database: the five RPCs, with cockpit_fathom_webhook_seen's rule as the
 * migration writes it (a new id, a failed one, or one received more than 5
 * minutes ago and never settled is processed; anything else is a duplicate).
 */
export class FakeDb {
  calls: RpcCall[] = [];
  /** The items of every ingest that succeeded, in order. */
  ingested: Row[] = [];
  deliveries = new Map<string, Delivery>();
  key: Row | null = {
    provider: "fathom_webhook",
    secret: SECRET,
    last4: SECRET.slice(-4),
    state: "connected",
    savedAt: "2026-10-27T09:00:00.123456+00:00",
    meta: { webhookId: "wh_invented_1234", triggeredFor: ["shared_team_recordings"] },
  };
  matchInputs: unknown = inputs();
  /** An RPC that fails its next `times` calls, with a database error (status) or no answer at all (status 0). */
  failures = new Map<string, { times: number; status: number; code?: string }>();

  constructor(private readonly clock: () => number = () => NOW) {}

  fail(name: string, times = 1, status = 500, code = "XX000") {
    this.failures.set(name, { times, status, code });
  }

  fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const prefix = `${BASE}/rest/v1/rpc/`;
    if (!url.startsWith(prefix)) throw new Error(`The fake database has no ${url}`);
    const name = url.slice(prefix.length);
    const headers = new Headers(init?.headers);
    const args: Row = init?.body ? JSON.parse(String(init.body)) : {};
    this.calls.push({ name, args, apikey: headers.get("apikey"), authorization: headers.get("authorization") });
    const failure = this.failures.get(name);
    if (failure && failure.times > 0) {
      failure.times -= 1;
      if (failure.status === 0) throw new TypeError("fetch failed");
      return reply({ message: "An invented database error", code: failure.code }, failure.status);
    }
    if (name === "cockpit_forms_key_get") return reply(this.key);
    if (name === "cockpit_fathom_webhook_seen") return reply(this.seen(String(args.p_webhook_id)));
    if (name === "cockpit_fathom_webhook_settle") {
      const d = this.deliveries.get(String(args.p_webhook_id));
      const next = { outcome: args.p_outcome, recordingId: args.p_recording_id, reason: args.p_reason };
      this.deliveries.set(String(args.p_webhook_id), d ? { ...d, ...next } : { lastAt: this.clock(), receipts: 1, ...next });
      return reply({ ok: true, webhookId: args.p_webhook_id, outcome: args.p_outcome });
    }
    if (name === "cockpit_fathom_match_inputs") return reply(this.matchInputs);
    if (name === "cockpit_fathom_ingest") {
      const items: Row[] = args.p_items;
      this.ingested.push(...items);
      return reply({ ok: true, meetings: items.length, calls: items.filter(i => i.call).map((i, n) => ({ recordingId: i.meeting.recording_id, callId: 9000 + n, taskId: i.call.task_id })) });
    }
    return reply({ message: "Could not find the function" }, 404);
  }) as typeof fetch;

  private seen(id: string): Row {
    const now = this.clock();
    const d = this.deliveries.get(id);
    if (!d) {
      this.deliveries.set(id, { outcome: "received", lastAt: now, receipts: 1, recordingId: null, reason: null });
      return { first: true, prior: null };
    }
    const prior = d.outcome;
    d.receipts += 1;
    if (d.outcome === "failed" || (d.outcome === "received" && d.lastAt < now - 5 * 60_000)) {
      d.outcome = "received";
      d.lastAt = now;
      return { first: true, prior };
    }
    d.lastAt = now;
    return { first: false, prior };
  }

  names(): string[] {
    return this.calls.map(c => c.name);
  }

  /** Every item cockpit_fathom_ingest stored, in order. */
  items(): Row[] {
    return this.ingested;
  }

  /** Every write: the delivery's seen and settle, and the ingest. */
  writes(): RpcCall[] {
    return this.calls.filter(c => c.name !== "cockpit_forms_key_get" && c.name !== "cockpit_fathom_match_inputs");
  }
}

/** The handler against a fake database and a clock the test moves. */
export function harness(o: { env?: Record<string, string>; db?: FakeDb; now?: number } = {}) {
  const clock = { now: o.now ?? NOW };
  const db = o.db ?? new FakeDb(() => clock.now);
  const logs: string[] = [];
  const env: Record<string, string> = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...o.env };
  const handler = makeHandler({ env: n => env[n] ?? "", fetch: db.fetch, now: () => clock.now, log: line => logs.push(line) });
  return { handler, db, logs, clock };
}

let serial = 0;

/** A delivery as Fathom sends it: signed with SECRET at `now`, unless the test says otherwise. */
export function delivery(
  body: unknown,
  o: { id?: string; timestamp?: string; signature?: string; secret?: string; method?: string; omit?: string[]; now?: number } = {},
): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const id = o.id ?? `msg_test${String(++serial).padStart(4, "0")}invented`;
  const timestamp = o.timestamp ?? String(Math.floor((o.now ?? NOW) / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": o.signature ?? sign(o.secret ?? SECRET, id, timestamp, raw),
  };
  for (const h of o.omit ?? []) delete headers[h];
  const method = o.method ?? "POST";
  return new Request("https://fn.test/functions/v1/fathom-webhook", { method, headers, body: method === "GET" ? undefined : raw });
}
