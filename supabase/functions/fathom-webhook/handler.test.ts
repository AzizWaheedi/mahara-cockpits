import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { meetingRow } from "../../../hermes/csm-calls/fathomRules.ts";
import { MAX_BODY_BYTES, MISSING_SECRET_TTL_MS, recordingOf, SECRET_TTL_MS } from "./handler.ts";
import {
  BASE,
  booking,
  CLIENT,
  CLOSER,
  CONTACT,
  CSM,
  delivery,
  harness,
  inputs,
  meeting,
  NOW,
  OTHER,
  ROOM,
  SECRET,
  SERVICE_KEY,
  sign,
} from "./testkit.ts";

// One delivery of docs/forms/STAGE2-CONTRACT.md 4.4, end to end against the
// testkit's fake database: no network. Every person, client, room and link is
// invented.

const MIN = 60_000;
const LINE = /^fathom-webhook [A-Za-z0-9_-]{1,8} [a-z_]+$/;
const MEETING_KEYS = [
  "recording_id", "title", "starts_at", "ends_at", "recorded_by_email", "recorded_by_name", "external", "invitees",
  "url", "share_url", "summary", "raw", "class", "room", "recorder_team",
];
const CALL_KEYS = [
  "source_id", "task_id", "client_name", "match_method", "match_confidence", "kind", "title", "starts_at", "ends_at",
  "host_email", "host_name", "recording_url", "summary", "external_invitees", "linked_call_id", "candidate", "room",
  "hints", "raw_hash",
];

const bodyOf = async (res: Response) => JSON.parse(await res.text());

/** A client recording: the client's contact is on the invite. */
const clientMeeting = (over = {}) =>
  meeting({
    title: "Cedar Bakery check-in",
    meeting_title: "Cedar Bakery check-in",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    calendar_invitees: [
      { name: CSM.name, email: CSM.email, email_domain: CSM.email_domain, is_external: false },
      { name: CONTACT.name, email: CONTACT.email, email_domain: "client.example", is_external: true },
    ],
    ...over,
  });

describe("the door", () => {
  test("only POST: 405, nothing read", async () => {
    const h = harness();
    const res = await h.handler(delivery(meeting(), { method: "GET", id: "msg_get" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await bodyOf(res)).toEqual({ ok: false });
    expect(h.db.calls).toEqual([]);
    expect(h.logs).toEqual(["fathom-webhook msg_get method"]);
  });

  test("a missing webhook header: 401 before anything else is read", async () => {
    for (const header of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const h = harness();
      const res = await h.handler(delivery(meeting(), { omit: [header] }));
      expect(res.status).toBe(401);
      expect(await bodyOf(res)).toEqual({ ok: false });
      expect(h.db.calls).toEqual([]);
      expect(h.logs).toHaveLength(1);
      expect(h.logs[0]).toEndWith(" missing");
    }
  });

  test("over 2,000,000 bytes: 413, nothing read; at the limit, the delivery goes on", async () => {
    expect(MAX_BODY_BYTES).toBe(2_000_000);
    const h = harness();
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    let res = await h.handler(delivery(big, { id: "msg_big" }));
    expect(res.status).toBe(413);
    expect(h.db.calls).toEqual([]);
    expect(h.logs).toEqual(["fathom-webhook msg_big too_large"]);
    // Bytes, not characters: 1,000,001 two-byte letters are over the limit too.
    res = await h.handler(delivery("ي".repeat(1_000_001)));
    expect(res.status).toBe(413);
    // A declared length over the limit is refused without reading the body.
    const declared = new Request("https://fn.test/functions/v1/fathom-webhook", {
      method: "POST",
      headers: { "webhook-id": "msg_len", "webhook-timestamp": String(NOW / 1000), "webhook-signature": "v1,x", "content-length": "2000001" },
      body: "{}",
    });
    expect((await h.handler(declared)).status).toBe(413);
    expect(h.db.calls).toEqual([]);
    // Exactly at the limit: signed, read, and settled as not a meeting.
    res = await h.handler(delivery("y".repeat(MAX_BODY_BYTES)));
    expect(res.status).toBe(200);
    expect(h.db.deliveries.size).toBe(1);
    expect([...h.db.deliveries.values()][0]).toMatchObject({ outcome: "ignored", reason: "Not a meeting." });
  });

  test("no secret saved: 503 and nothing written; a missing secret is read again after 30 seconds, not on every request", async () => {
    expect(MISSING_SECRET_TTL_MS).toBe(30_000);
    const h = harness();
    h.db.key = null;
    const keyReads = () => h.db.names().filter(n => n === "cockpit_forms_key_get").length;
    let res = await h.handler(delivery(meeting()));
    expect(res.status).toBe(503);
    expect(await bodyOf(res)).toEqual({ ok: false });
    expect(h.db.names()).toEqual(["cockpit_forms_key_get"]);
    expect(h.logs[0]).toEndWith(" no_secret");
    // A flood of fresh, v1-shaped requests while none is saved: one vault read in 30 seconds, each answered 503.
    for (let i = 0; i < 20; i++) expect((await h.handler(delivery(meeting(), { now: h.clock.now }))).status).toBe(503);
    expect(keyReads()).toBe(1);
    // A secret saved now is read on the first request 30 seconds after the miss.
    h.db.key = { provider: "fathom_webhook", secret: SECRET, last4: "0000", state: "unchecked", savedAt: "2026-10-28T08:29:00Z", meta: {} };
    h.clock.now += 29_000;
    expect((await h.handler(delivery(meeting(), { now: h.clock.now }))).status).toBe(503);
    h.clock.now += 1_000;
    res = await h.handler(delivery(meeting(), { now: h.clock.now }));
    expect(res.status).toBe(200);
    expect(keyReads()).toBe(2);
    expect(h.db.writes().length).toBeGreaterThan(0);
  });

  test("a stale timestamp or no v1 signature is refused before the secret is read: 401, no database call", async () => {
    const h = harness();
    h.db.key = null;
    const cases: [Request, string][] = [
      [delivery(meeting(), { now: NOW - 6 * MIN }), "stale"],
      [delivery(meeting(), { timestamp: "soon" }), "stale"],
      [delivery(meeting(), { signature: "v2,abc" }), "bad_signature"],
      [delivery(meeting(), { signature: "abc" }), "bad_signature"],
    ];
    for (const [req, outcome] of cases) {
      const res = await h.handler(req);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('{"ok":false}');
      expect(h.logs.at(-1)).toEndWith(` ${outcome}`);
    }
    expect(h.db.calls).toEqual([]);
  });

  test("the secret cannot be read, or the database settings are missing: 503, nothing written", async () => {
    const h = harness();
    h.db.fail("cockpit_forms_key_get", 1, 0);
    let res = await h.handler(delivery(meeting()));
    expect(res.status).toBe(503);
    expect(h.logs[0]).toEndWith(" key_unreadable");
    h.db.fail("cockpit_forms_key_get", 1, 500);
    res = await h.handler(delivery(meeting()));
    expect(res.status).toBe(503);
    expect(h.db.writes()).toEqual([]);
    const missing: Record<string, string>[] = [{ SUPABASE_URL: "" }, { SUPABASE_SERVICE_ROLE_KEY: " " }];
    for (const env of missing) {
      const bare = harness({ env });
      res = await bare.handler(delivery(meeting()));
      expect(res.status).toBe(503);
      expect(bare.db.calls).toEqual([]);
      expect(bare.logs[0]).toEndWith(" no_database");
    }
  });

  test("a wrong or stale signature: 401, nothing written, nothing echoed", async () => {
    const h = harness();
    const other = ["whsec", btoa("not the saved webhook key")].join("_");
    let res = await h.handler(delivery(meeting(), { secret: other }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"ok":false}');
    expect(h.logs.at(-1)).toEndWith(" bad_signature");
    const reads = h.db.names().length;
    res = await h.handler(delivery(meeting(), { now: NOW - 6 * MIN }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"ok":false}');
    expect(h.logs.at(-1)).toEndWith(" stale");
    expect(h.db.names()).toHaveLength(reads);
    res = await h.handler(delivery(meeting(), { signature: "v1,abc" }));
    expect(res.status).toBe(401);
    expect(h.db.writes()).toEqual([]);
    expect(h.db.names().every(n => n === "cockpit_forms_key_get")).toBe(true);
  });

  test("a stored secret that holds no key: 401 bad_secret, so the log names it", async () => {
    const h = harness();
    h.db.key = { ...h.db.key, secret: "whsec_YWJjZGVm" };
    const res = await h.handler(delivery(meeting()));
    expect(res.status).toBe(401);
    expect(h.logs).toEqual([expect.stringMatching(/ bad_secret$/)]);
    expect(h.db.writes()).toEqual([]);
  });

  test("the secret is read once in 5 minutes per isolate", async () => {
    expect(SECRET_TTL_MS).toBe(5 * MIN);
    const h = harness();
    const keyReads = () => h.db.names().filter(n => n === "cockpit_forms_key_get").length;
    await h.handler(delivery(meeting(), { now: h.clock.now }));
    h.clock.now += 4 * MIN;
    await h.handler(delivery(meeting(), { now: h.clock.now }));
    expect(keyReads()).toBe(1);
    h.clock.now += 1 * MIN;
    await h.handler(delivery(meeting(), { now: h.clock.now }));
    expect(keyReads()).toBe(2);
  });

  test("every database call is a named service RPC with the service key", async () => {
    const h = harness();
    h.db.matchInputs = inputs({ bookings: [booking({ room: ROOM })] });
    await h.handler(delivery(meeting()));
    expect(h.db.names()).toEqual([
      "cockpit_forms_key_get",
      "cockpit_fathom_webhook_seen",
      "cockpit_fathom_match_inputs",
      "cockpit_fathom_ingest",
      "cockpit_fathom_webhook_settle",
    ]);
    for (const c of h.db.calls) {
      expect(c.apikey).toBe(SERVICE_KEY);
      expect(c.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    }
  });
});

describe("one delivery", () => {
  test("a duplicate: 200 duplicate, stored once", async () => {
    const h = harness();
    const m = meeting();
    const first = await h.handler(delivery(m, { id: "msg_twice" }));
    expect(await bodyOf(first)).toEqual({ ok: true });
    const again = await h.handler(delivery(m, { id: "msg_twice" }));
    expect(again.status).toBe(200);
    expect(await bodyOf(again)).toEqual({ ok: true, duplicate: true });
    expect(h.db.items()).toHaveLength(1);
    expect(h.logs).toEqual(["fathom-webhook msg_twic stored", "fathom-webhook msg_twic duplicate"]);
    // The seen call carries the id and the header's time.
    const seen = h.db.calls.find(c => c.name === "cockpit_fathom_webhook_seen");
    expect(seen?.args).toEqual({ p_webhook_id: "msg_twice", p_timestamp: new Date(Math.floor(NOW / 1000) * 1000).toISOString() });
  });

  test("a delivery received over 5 minutes ago and never settled is processed again; a recent one is a duplicate", async () => {
    const h = harness();
    h.db.deliveries.set("msg_lost", { outcome: "received", lastAt: NOW - 6 * MIN, receipts: 1, recordingId: null, reason: null });
    h.db.deliveries.set("msg_busy", { outcome: "received", lastAt: NOW - 1 * MIN, receipts: 1, recordingId: null, reason: null });
    expect(await bodyOf(await h.handler(delivery(meeting(), { id: "msg_lost" })))).toEqual({ ok: true });
    expect(await bodyOf(await h.handler(delivery(meeting(), { id: "msg_busy" })))).toEqual({ ok: true, duplicate: true });
    expect(h.db.items()).toHaveLength(1);
  });

  test("another team, or a recording shared with no team: ignored, and nothing of it is stored", async () => {
    const h = harness();
    const cases: [Record<string, unknown>, string][] = [
      [meeting({ recorded_by: CLOSER, title: "Sales call with an invented lead" }), "msg_sales"],
      [meeting({ recorded_by: { name: "Test CEO", email: "ceo@maharamedia.com", team: "Sales" } }), "msg_ceo1"],
      [meeting({ recorded_by: { ...CSM, team: "Probe" } }), "msg_probe"],
      [meeting({ recorded_by: { name: "Test Admin", email: "admin@maharamedia.com" } }), "msg_noteam"],
      [meeting({ shared_with: "no_teams" }), "msg_private"],
    ];
    for (const [m, id] of cases) {
      const res = await h.handler(delivery(m, { id }));
      expect(res.status).toBe(200);
      expect(await bodyOf(res)).toEqual({ ok: true });
      expect(h.db.deliveries.get(id)).toMatchObject({
        outcome: "ignored",
        recordingId: "196100001",
        reason: "Not a Customer Success recording.",
      });
    }
    expect(h.db.items()).toEqual([]);
    expect(h.db.names()).not.toContain("cockpit_fathom_match_inputs");
    expect(h.logs.every(l => l.endsWith(" ignored"))).toBe(true);
  });

  test("not a meeting: ignored with the sentence", async () => {
    const h = harness();
    for (const [body, id] of [
      ['{"event":"ping"}', "msg_ping"],
      ["not json at all", "msg_text"],
      ["[1,2]", "msg_list"],
      ['{"recording_id":"12"}', "msg_short"],
      ['{"recording_id":"19610abc"}', "msg_letters"],
    ]) {
      const res = await h.handler(delivery(body, { id }));
      expect(res.status).toBe(200);
      expect(h.db.deliveries.get(id)).toMatchObject({ outcome: "ignored", recordingId: null, reason: "Not a meeting." });
    }
    expect(h.db.items()).toEqual([]);
  });

  test("a candidate: stored with its hints and no client, the meeting as meetingRow writes it", async () => {
    const h = harness();
    // A booking 9 minutes from the recording in another room: a time signal, never a client.
    h.db.matchInputs = inputs({ bookings: [booking({ startsAt: "2026-10-28T07:40:00Z", room: "meet:kln-opqr-stu", contactNames: [] })] });
    const m = meeting();
    const res = await h.handler(delivery(m, { id: "msg_cand" }));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
    const [item] = h.db.items();
    const { updated_at: _at, ...row } = meetingRow(m, "candidate", new Date(NOW).toISOString());
    expect(item.meeting).toEqual(row);
    expect(Object.keys(item.meeting).sort()).toEqual([...MEETING_KEYS].sort());
    expect(Object.keys(item.call).sort()).toEqual([...CALL_KEYS].sort());
    expect(item.call).toMatchObject({
      source_id: "196100001",
      task_id: null,
      client_name: null,
      match_method: null,
      match_confidence: null,
      linked_call_id: null,
      kind: "other",
      candidate: true,
      host_email: CSM.email,
      room: ROOM,
      summary: m.default_summary.markdown_formatted,
    });
    expect(item.call.hints).toHaveLength(1);
    expect(item.call.hints[0]).toMatchObject({ taskId: CLIENT.taskId, clientName: CLIENT.name, signal: "near_booking", label: "possible" });
    expect(item.call.raw_hash).toMatch(/^[0-9a-f]{16}$/);
    const ingest = h.db.calls.find(c => c.name === "cockpit_fathom_ingest");
    expect(ingest?.args.p_via).toBe("webhook");
    expect(ingest?.args.p_items).toHaveLength(1);
    // The matcher reads the recording's start ± 2 hours.
    expect(h.db.calls.find(c => c.name === "cockpit_fathom_match_inputs")?.args).toEqual({
      p_from: "2026-10-28T05:31:00.000Z",
      p_to: "2026-10-28T09:31:00.000Z",
    });
    expect(h.db.deliveries.get("msg_cand")).toMatchObject({ outcome: "stored", recordingId: "196100001", reason: null });
  });

  test("the item never carries the transcript, and its hints name no contact", async () => {
    const h = harness();
    // The contact's full name on a booking of one client, and the same name spoke: a speaker hint, not a client.
    h.db.matchInputs = inputs({ bookings: [booking({ startsAt: "2026-10-28T10:00:00Z" })] });
    await h.handler(delivery(meeting()));
    const [item] = h.db.items();
    expect(item.call.task_id).toBeNull();
    expect(item.call.hints.map((s: { signal: string }) => s.signal)).toContain("speaker_name");
    const text = JSON.stringify(item);
    expect(text).not.toContain("An invented reply.");
    expect(text).not.toContain("An invented first line.");
    expect("transcript" in item.meeting.raw).toBe(false);
    const hints = JSON.stringify(item.call.hints);
    expect(hints).not.toContain(CONTACT.name);
    expect(hints).not.toContain(CONTACT.email);
  });

  test("the same room within 90 minutes of one client's booking: that client, the booking's link and kind, no hints", async () => {
    const h = harness();
    h.db.matchInputs = inputs({ bookings: [booking({ room: ROOM, kind: "checkin" }), booking({ id: 54002, taskId: OTHER.taskId, clientName: OTHER.name, startsAt: "2026-10-29T07:30:00Z", room: ROOM })] });
    await h.handler(delivery(meeting()));
    expect(h.db.items()[0].call).toMatchObject({
      task_id: CLIENT.taskId,
      client_name: CLIENT.name,
      match_method: "same_room",
      match_confidence: 1,
      linked_call_id: 54001,
      kind: "checkin",
      candidate: false,
      hints: [],
    });
  });

  test("one room on two clients' bookings proves nothing: a candidate with hints", async () => {
    const h = harness();
    h.db.matchInputs = inputs({
      bookings: [booking({ room: ROOM }), booking({ id: 54002, taskId: OTHER.taskId, clientName: OTHER.name, startsAt: "2026-10-28T08:15:00Z", room: ROOM })],
    });
    await h.handler(delivery(meeting()));
    const { call } = h.db.items()[0];
    expect(call).toMatchObject({ task_id: null, match_method: null, linked_call_id: null, candidate: true });
  });

  test("the client on the invite: the booking within 30 minutes is appointment_time; with none that near, invitee_email", async () => {
    let h = harness();
    h.db.matchInputs = inputs({ bookings: [booking({ startsAt: "2026-10-28T07:45:00Z", kind: "onboarding" })] });
    await h.handler(delivery(clientMeeting()));
    expect(h.db.items()[0].meeting.class).toBe("client");
    expect(h.db.items()[0].call).toMatchObject({
      task_id: CLIENT.taskId,
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 54001,
      kind: "onboarding",
      candidate: false,
      hints: [],
    });
    h = harness();
    h.db.matchInputs = inputs({ bookings: [booking({ startsAt: "2026-10-28T10:30:00Z" })] });
    await h.handler(delivery(clientMeeting()));
    expect(h.db.items()[0].call).toMatchObject({
      task_id: CLIENT.taskId,
      match_method: "invitee_email",
      match_confidence: 0.9,
      linked_call_id: null,
      kind: "checkin",
      hints: [],
    });
  });

  test("the client on the invite names only a client on the clients list; its booking within 30 minutes names it, listed or not (contract A7.13)", async () => {
    // Cedar Bakery has left the clients list; its contact is on the invite and on its booking.
    const unlisted = { clients: [{ taskId: OTHER.taskId, name: OTHER.name, aliases: [] }] };
    let h = harness();
    h.db.matchInputs = inputs({ ...unlisted, bookings: [booking({ startsAt: "2026-10-28T10:30:00Z" })] });
    await h.handler(delivery(clientMeeting()));
    expect(h.db.items()[0].call).toMatchObject({ task_id: null, client_name: null, match_method: null, linked_call_id: null, candidate: false, hints: [] });
    h = harness();
    h.db.matchInputs = inputs({ ...unlisted, bookings: [booking({ startsAt: "2026-10-28T07:45:00Z", kind: "onboarding" })] });
    await h.handler(delivery(clientMeeting()));
    expect(h.db.items()[0].call).toMatchObject({
      task_id: CLIENT.taskId,
      client_name: CLIENT.name,
      match_method: "appointment_time",
      match_confidence: 1,
      linked_call_id: 54001,
      kind: "onboarding",
    });
  });

  test("a link in a stored 1-1 form: form_task_id and no booking link", async () => {
    const h = harness();
    const m = meeting();
    h.db.matchInputs = inputs({ formLinks: [{ shareUrl: m.share_url, taskId: OTHER.taskId }], bookings: [booking({ startsAt: "2026-10-28T07:40:00Z" })] });
    await h.handler(delivery(m));
    expect(h.db.items()[0].call).toMatchObject({
      task_id: OTHER.taskId,
      client_name: OTHER.name,
      match_method: "form_task_id",
      match_confidence: 0.95,
      linked_call_id: null,
      kind: "other",
      candidate: false,
      hints: [],
    });
  });

  test("one match block from exactMatch (contract A7 item 2), as the worker and the pull write it, with no hints; every invitee email counts, lower-cased", async () => {
    // The client's email is on the invite without Fathom's external flag (flagged, it would be a client call).
    const unflagged = { name: CONTACT.name, email: "Owner@Client.Example", email_domain: "client.example", is_external: false };
    const csm = { name: CSM.name, email: CSM.email, email_domain: CSM.email_domain, is_external: false };
    // The title's kind (launch) is told apart from the bookings' (blueprint, onboarding).
    const titled = { title: "Launch review", meeting_title: "Launch review" };
    const invited = meeting({ ...titled, meeting_url: null, calendar_invitees: [csm, unflagged] });
    const linked = meeting({ ...titled, meeting_url: null });
    const cases: [string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][] = [
      ["the booked room", meeting(titled), inputs({ bookings: [booking({ room: ROOM, kind: "blueprint" })] }),
        { task_id: CLIENT.taskId, client_name: CLIENT.name, match_method: "same_room", match_confidence: 1, linked_call_id: 54001, kind: "blueprint" }],
      ["the invitee at a booked time", invited, inputs({ bookings: [booking({ startsAt: "2026-10-28T07:45:00Z", kind: "onboarding" })] }),
        { task_id: CLIENT.taskId, client_name: CLIENT.name, match_method: "appointment_time", match_confidence: 1, linked_call_id: 54001, kind: "onboarding" }],
      ["the invitee, no booking near", invited, inputs({ bookings: [booking({ startsAt: "2026-10-28T10:30:00Z", kind: "onboarding" })] }),
        { task_id: CLIENT.taskId, client_name: CLIENT.name, match_method: "invitee_email", match_confidence: 0.9, linked_call_id: null, kind: "launch" }],
      ["a stored 1-1 form's link", linked,
        inputs({ formLinks: [{ shareUrl: linked.share_url, taskId: OTHER.taskId }], bookings: [booking({ startsAt: "2026-10-28T07:40:00Z", kind: "onboarding" })] }),
        { task_id: OTHER.taskId, client_name: OTHER.name, match_method: "form_task_id", match_confidence: 0.95, linked_call_id: null, kind: "launch" }],
    ];
    for (const [signal, m, matchInputs, block] of cases) {
      const h = harness();
      h.db.matchInputs = matchInputs;
      expect((await h.handler(delivery(m))).status).toBe(200);
      const [item] = h.db.items();
      expect({ signal, class: item.meeting.class, ...item.call }).toMatchObject({ signal, class: "candidate", ...block, candidate: false, hints: [] });
    }
    // The matcher reads every calendar invitee's email, lower-cased: the CSM's own and the client's.
    const { updated_at: _at, ...row } = meetingRow(invited, "candidate", new Date(NOW).toISOString());
    expect(recordingOf(invited, row, "candidate").inviteeEmails).toEqual(["csm@maharamedia.com", "owner@client.example"]);
  });

  test("a title that names a client is a hint, never a client", async () => {
    const h = harness();
    await h.handler(delivery(meeting({ title: "Cedar Bakery check-in" })));
    const { call } = h.db.items()[0];
    expect(call).toMatchObject({ task_id: null, kind: "checkin", candidate: true });
    expect(call.hints[0]).toMatchObject({ taskId: CLIENT.taskId, signal: "title" });
  });

  test("hints only on an unplaced candidate: a client-class recording no exact rule places carries none (contract A7 item 12)", async () => {
    // The contact is on the invite but on no booking, the title names Cedar Bakery, and Harbour Optics is booked 6 minutes before.
    const nearby = inputs({
      bookings: [booking({ id: 54003, taskId: OTHER.taskId, clientName: OTHER.name, startsAt: "2026-10-28T07:25:00Z", emails: ["frontdesk@harbour.example"], contactNames: [] })],
    });
    let h = harness();
    h.db.matchInputs = nearby;
    await h.handler(delivery(clientMeeting()));
    const [item] = h.db.items();
    expect(item.meeting.class).toBe("client");
    expect(item.call).toMatchObject({ task_id: null, client_name: null, match_method: null, linked_call_id: null, kind: "checkin", candidate: false, hints: [] });
    // The same call as an impromptu candidate (the CSM its one invitee) carries the hints the client-class one does not.
    h = harness();
    h.db.matchInputs = nearby;
    const csmOnly = [{ name: CSM.name, email: CSM.email, email_domain: CSM.email_domain, is_external: false }];
    await h.handler(delivery(clientMeeting({ calendar_invitees: csmOnly })));
    const { call } = h.db.items()[0];
    expect(call).toMatchObject({ task_id: null, candidate: true });
    expect(call.hints.map((s: { signal: string; taskId: string }) => [s.signal, s.taskId])).toEqual([
      ["title", CLIENT.taskId],
      ["near_booking", OTHER.taskId],
    ]);
  });

  test("the matcher reads the edited title only: a calendar title that names a client is no title hint (contract A7 item 12)", async () => {
    const h = harness();
    // Fathom sent no edited title; the calendar's names Cedar Bakery. The row still shows it and takes its kind.
    const m = meeting({ title: null, meeting_title: "Cedar Bakery check-in" });
    await h.handler(delivery(m));
    expect(h.db.items()[0].call).toMatchObject({ task_id: null, candidate: true, title: "Cedar Bakery check-in", kind: "checkin", hints: [] });
    const { updated_at: _at, ...row } = meetingRow(m, "candidate", new Date(NOW).toISOString());
    expect(recordingOf(m, row, "candidate")).toMatchObject({ title: null, meetingTitle: "Cedar Bakery check-in" });
  });

  test("a client that has left the clients list keeps its booking's name; a form link names no booking, so no name (contract A7 item 12)", async () => {
    let h = harness();
    h.db.matchInputs = inputs({ clients: [{ taskId: OTHER.taskId, name: OTHER.name, aliases: [] }], bookings: [booking({ room: ROOM, kind: "onboarding" })] });
    await h.handler(delivery(meeting()));
    expect(h.db.items()[0].call).toMatchObject({
      task_id: CLIENT.taskId,
      client_name: CLIENT.name,
      match_method: "same_room",
      linked_call_id: 54001,
      kind: "onboarding",
      candidate: false,
      hints: [],
    });
    h = harness();
    const m = meeting();
    h.db.matchInputs = inputs({ clients: [], formLinks: [{ shareUrl: m.share_url, taskId: CLIENT.taskId }] });
    await h.handler(delivery(m));
    expect(h.db.items()[0].call).toMatchObject({ task_id: CLIENT.taskId, client_name: null, match_method: "form_task_id", linked_call_id: null, candidate: false, hints: [] });
  });

  test("a Customer Success team meeting: metadata only and no call row", async () => {
    const h = harness();
    const m = meeting({ calendar_invitees_domains_type: "only_internal", title: "Team stand-up" });
    await h.handler(delivery(m, { id: "msg_team" }));
    const [item] = h.db.items();
    expect(item.meeting.class).toBe("internal");
    expect(item.meeting.summary).toBeNull();
    for (const k of ["default_summary", "action_items", "highlights", "transcript"]) expect(k in item.meeting.raw).toBe(false);
    expect(item.call).toBeNull();
    expect(h.db.names()).not.toContain("cockpit_fathom_match_inputs");
    expect(h.db.deliveries.get("msg_team")?.outcome).toBe("stored");
    // Two minutes and no summary is internal too.
    await h.handler(delivery(meeting({ recording_start_time: "2026-10-28T07:31:00Z", recording_end_time: "2026-10-28T07:33:00Z", default_summary: null })));
    expect(h.db.items()[1].call).toBeNull();
  });

  test("failed, then retried: the retry is processed and stored", async () => {
    const h = harness();
    h.db.fail("cockpit_fathom_ingest", 1, 400, "22023");
    const m = meeting();
    const res = await h.handler(delivery(m, { id: "msg_retry" }));
    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({ ok: false });
    expect(h.db.deliveries.get("msg_retry")).toMatchObject({ outcome: "failed", recordingId: "196100001", reason: "Failed at the ingest step (22023)." });
    const again = await h.handler(delivery(m, { id: "msg_retry" }));
    expect(again.status).toBe(200);
    expect(await bodyOf(again)).toEqual({ ok: true });
    expect(h.db.deliveries.get("msg_retry")).toMatchObject({ outcome: "stored", reason: null });
    expect(h.db.items()).toHaveLength(1);
    expect(h.logs).toEqual(["fathom-webhook msg_retr failed", "fathom-webhook msg_retr stored"]);
  });

  test("a throw at any step after the seen call is settled failed and answers 500", async () => {
    for (const [name, step] of [
      ["cockpit_fathom_webhook_seen", "seen"],
      ["cockpit_fathom_match_inputs", "match"],
      ["cockpit_fathom_webhook_settle", "settle"],
    ]) {
      const h = harness();
      h.db.fail(name, 1, 0);
      const res = await h.handler(delivery(meeting(), { id: `msg_${step}` }));
      expect(res.status).toBe(500);
      expect(h.db.deliveries.get(`msg_${step}`)).toMatchObject({ outcome: "failed", reason: `Failed at the ${step} step.` });
    }
    // The settle of the failure itself fails too: still 500, and nothing else is tried.
    const h = harness();
    h.db.fail("cockpit_fathom_ingest", 1, 500);
    h.db.fail("cockpit_fathom_webhook_settle", 1, 0);
    expect((await h.handler(delivery(meeting()))).status).toBe(500);
    expect(h.logs).toEqual([expect.stringMatching(/ failed$/)]);
  });
});

describe("the log", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  beforeEach(() => {
    for (const k of ["log", "error", "warn", "info", "debug"] as const) spies.push(spyOn(console, k));
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  test("nothing is logged but one line per delivery, with no body, header value, title, name or secret", async () => {
    const h = harness();
    const m = clientMeeting();
    const send = async (req: Request) => {
      const before = h.logs.length;
      await h.handler(req);
      expect(h.logs.length).toBe(before + 1);
    };
    await send(delivery(m, { method: "GET" }));
    await send(delivery(m, { omit: ["webhook-signature"] }));
    await send(delivery("z".repeat(MAX_BODY_BYTES + 5)));
    await send(delivery(m, { secret: ["whsec", btoa("a different invented key")].join("_") }));
    await send(delivery(m, { id: "msg_logged" }));
    await send(delivery(m, { id: "msg_logged" }));
    await send(delivery(meeting({ recorded_by: CLOSER }), { id: "msg_closer" }));
    h.db.fail("cockpit_fathom_ingest", 1, 400, "22023");
    await send(delivery(m, { id: "msg_broken" }));
    // The secret is kept for 5 minutes, so it is gone only after that.
    h.db.key = null;
    h.clock.now += 6 * MIN;
    await send(delivery(m, { now: h.clock.now }));
    await send(delivery(m, { id: "m s<g>!_abcdef", now: h.clock.now }));
    for (const line of h.logs) {
      expect(line).toMatch(LINE);
      for (const secretOrContent of [SECRET, SERVICE_KEY, m.title, CSM.name, CSM.email, CONTACT.name, CONTACT.email, "Nothing here is real", BASE])
        expect(line).not.toContain(secretOrContent);
    }
    expect(h.logs.map(l => l.split(" ")[2])).toEqual([
      "method",
      "missing",
      "too_large",
      "bad_signature",
      "stored",
      "duplicate",
      "ignored",
      "failed",
      "no_secret",
      "no_secret",
    ]);
    expect(h.logs.at(-1)).toBe("fathom-webhook msg_ no_secret");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  test("the signer and the door agree on the header the probe sends", async () => {
    // scripts/dev/forms_key.py probe-webhook signs the same way: a Probe team delivery is ignored.
    const h = harness();
    const body = JSON.stringify({ recording_id: "000000001", title: "Webhook probe", recorded_by: { name: "Probe", email: "probe@tests.invalid", team: "Probe" } });
    const ts = String(Math.floor(NOW / 1000));
    const req = new Request("https://fn.test/functions/v1/fathom-webhook", {
      method: "POST",
      headers: { "webhook-id": "probe_0123456789abcdef", "webhook-timestamp": ts, "webhook-signature": sign(SECRET, "probe_0123456789abcdef", ts, body) },
      body,
    });
    const res = await h.handler(req);
    expect(res.status).toBe(200);
    expect(h.db.deliveries.get("probe_0123456789abcdef")).toMatchObject({ outcome: "ignored", reason: "Not a Customer Success recording." });
    expect(h.logs).toEqual(["fathom-webhook probe_01 ignored"]);
  });
});
