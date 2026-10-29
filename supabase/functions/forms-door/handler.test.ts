// forms-door (docs/forms/STAGE2B-CONTRACT.md 4.8): every route and refusal, the
// worker's own answer mapping of a signed Typeform body, the record call's
// shape, each outcome forms-door:kickoff records (3.9), and no body, answer or
// hidden value in any log line. A fake database and a signer written with
// node:crypto, so the door's check (team-onboarding-intake/signature.ts) is held
// against a second implementation. People, clients, links and values are invented.
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  FORM_KEYS,
  formKeyOf,
  MAX_BODY_BYTES,
  MISSING_SECRET_TTL_MS,
  makeHandler,
  recordInput,
  SECRET_TTL_MS,
  UNSIGNED_SEEN_TTL_MS,
} from "./handler.ts";

const BASE = "https://db.test";
const SERVICE_KEY = "sb_service_key_for_tests_only";
/** An invented signing key, put together at run time so this file holds nothing shaped like one. */
const SECRET = ["invented", "kickoff", "signing", "key", "for", "tests"].join("-");
const NOW = Date.parse("2026-10-29T09:00:00Z");
const FORM_ID = "tG7dnxBn";
const URL_OF = (path: string) => `https://project.test/functions/v1${path}`;
const ROUTE = "/forms-door/typeform/kickoff";
const EMAIL = "owner@citywood.example";
const PHONE = "+965 0000 0000";
const NOTE = "We want the launch before the sale season";
const LINK = "https://fathom.video/share/TESTkickoff1";

type Row = Record<string, any>;

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;
}

/** A kickoff form_response as Typeform's webhook sends it: definition, hidden fields with contact details, answers. */
function delivery(over: Row = {}, event: Row = {}): Row {
  return {
    event_id: "01JTESTEVENT",
    event_type: "form_response",
    form_response: {
      form_id: FORM_ID,
      token: "abc123def456ghi7",
      submitted_at: "2026-10-29T08:55:00Z",
      landed_at: "2026-10-29T08:40:00Z",
      hidden: { onboarding_client_id: "86exc1tyw", email: EMAIL, phone: PHONE },
      definition: {
        id: FORM_ID,
        title: "Kickoff",
        fields: [
          { id: "f1", ref: "goal-ref", type: "long_text", title: "What is the goal of the launch?" },
          { id: "g1", ref: "group-ref", type: "group", title: "Links", properties: { fields: [{ id: "f2", ref: "call-ref", type: "website", title: "Call recording" }] } },
          { id: "f3", ref: "budget-ref", type: "multiple_choice", title: "Monthly budget" },
        ],
      },
      answers: [
        { type: "text", text: NOTE, field: { id: "f1", ref: "goal-ref", type: "long_text" } },
        { type: "url", url: LINK, field: { id: "f2", ref: "call-ref", type: "website" } },
        { type: "choice", choice: { label: "$1,000 to $2,000" }, field: { id: "f3", ref: "budget-ref", type: "multiple_choice" } },
      ],
      ...over,
    },
    ...event,
  };
}

type Fake = {
  registry: Row[] | number;
  secret: string | null | "throw";
  record: Row | { status: number; code: string; message: string };
  seenFails?: boolean;
};

function harness(over: Partial<Fake> = {}) {
  const fake: Fake = {
    registry: [{ provider: "typeform", typeform_id: FORM_ID }],
    secret: SECRET,
    record: { ok: true, id: "11111111-1111-4111-8111-111111111111", inserted: true, taskId: "86exc1tyw", state: "submitted" },
    ...over,
  };
  const calls: { path: string; method: string; body: Row | null; auth: string | null }[] = [];
  const logs: string[] = [];
  let now = NOW;
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.replace(BASE, "");
    const method = init.method ?? "GET";
    calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get("Authorization") });
    if (method === "GET" && path === "/rest/v1/cockpit_forms?select=provider,typeform_id&key=eq.kickoff") {
      if (typeof fake.registry === "number") return new Response("{}", { status: fake.registry });
      return Response.json(fake.registry);
    }
    if (path === "/rest/v1/rpc/cockpit_forms_key_get") {
      if (fake.secret === "throw") return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
      return Response.json(fake.secret ? { provider: "typeform_kickoff", secret: fake.secret, last4: "ests" } : null);
    }
    if (path === "/rest/v1/rpc/cockpit_forms_door_seen") {
      if (fake.seenFails) return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
      return Response.json({ ok: true });
    }
    if (path === "/rest/v1/rpc/cockpit_form_record_typeform") {
      const r = fake.record as Row;
      if (typeof r.status === "number") return new Response(JSON.stringify({ message: r.message, code: r.code }), { status: r.status });
      return Response.json(r);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  }) as typeof globalThis.fetch;
  const handler = makeHandler({
    env: n => ({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[n] ?? "",
    fetch,
    now: () => now,
    log: line => logs.push(line),
  });
  const post = (body: string, headers: Record<string, string> = {}, path = ROUTE) =>
    handler(new Request(URL_OF(path), { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
  const signed = (body: Row | string, headers: Record<string, string> = {}, secret = SECRET) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return post(raw, { "Typeform-Signature": sign(secret, raw), ...headers });
  };
  const rpcs = (name: string) => calls.filter(c => c.path === `/rest/v1/rpc/${name}`).map(c => c.body);
  return { fake, calls, logs, handler, post, signed, rpcs, tick: (ms: number) => (now += ms) };
}

const read = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("the route", () => {
  test("only POST /forms-door/typeform/kickoff: other paths 404, other methods 405, every other form 404, before any read", async () => {
    const h = harness();
    for (const path of ["/forms-door", "/forms-door/x", "/forms-door/typeform", "/forms-door/typeform/kickoff/extra", "/other/typeform/kickoff"])
      expect(await read(await h.post("{}", {}, path))).toEqual({ status: 404, body: { ok: false } });
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const res = await h.handler(new Request(URL_OF(ROUTE), { method, ...(method === "GET" ? {} : { body: "{}" }) }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(await res.json()).toEqual({ ok: false });
    }
    // The checkin row also has a typeform_id and provider typeform: the door names kickoff alone (Z58).
    for (const form of ["checkin", "blueprint", "onboarding", "Kickoff", "kickoff%20", ""])
      expect((await h.post("{}", {}, `/forms-door/typeform/${form}`)).status).toBe(404);
    expect(FORM_KEYS).toEqual(["kickoff"]);
    expect(h.calls).toEqual([]);
  });

  test("the path is read with or without the platform's prefix", () => {
    expect(formKeyOf("/forms-door/typeform/kickoff")).toBe("kickoff");
    expect(formKeyOf("/functions/v1/forms-door/typeform/kickoff/")).toBe("kickoff");
    expect(formKeyOf("/forms-door/typeform/%E0%A4")).toBeNull();
    expect(formKeyOf("/forms-door/kickoff")).toBeNull();
  });

  test("a body over 1.5 MB is refused before it is read whole or checked", async () => {
    const h = harness();
    expect((await h.post("x", { "content-length": String(MAX_BODY_BYTES + 1) })).status).toBe(413);
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect(await read(await h.handler(new Request(URL_OF(ROUTE), { method: "POST", body: new Blob([big]).stream(), duplex: "half" } as RequestInit)))).toEqual({
      status: 413,
      body: { ok: false },
    });
    expect(h.calls).toEqual([]);
  });

  test("the registry row must still be a Typeform form with its id, else 404; an unreadable registry is a 503", async () => {
    for (const registry of [[{ provider: "native", typeform_id: FORM_ID }], [{ provider: "typeform", typeform_id: null }], []]) {
      const h = harness({ registry });
      expect(await read(await h.signed(delivery()))).toEqual({ status: 404, body: { ok: false } });
      expect(h.rpcs("cockpit_forms_key_get")).toEqual([]);
    }
    const down = harness({ registry: 500 });
    expect(await read(await down.signed(delivery()))).toEqual({ status: 503, body: { ok: false } });
  });
});

describe("the signing key and the signature", () => {
  test("no key saved: 503, recorded failed with its sentence, and read again only after 30 seconds", async () => {
    const h = harness({ secret: null });
    expect(await read(await h.post("{}"))).toEqual({ status: 503, body: { ok: false } });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "failed", p_reason: "No signing key saved" }]);
    expect(h.rpcs("cockpit_forms_key_get")).toEqual([{ p_provider: "typeform_kickoff" }]);
    await h.post("{}");
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(1);
    // A flood before registration costs one key read and one write in 30 seconds.
    expect(h.rpcs("cockpit_forms_door_seen")).toHaveLength(1);
    h.tick(MISSING_SECRET_TTL_MS);
    await h.post("{}");
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    expect(h.rpcs("cockpit_forms_door_seen")).toHaveLength(2);
    expect((await harness({ secret: "throw" }).post("{}")).status).toBe(503);
  });

  test("a saved key is read once in five minutes", async () => {
    const h = harness();
    await h.signed(delivery());
    await h.signed(delivery());
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(1);
    h.tick(SECRET_TTL_MS);
    await h.signed(delivery());
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
  });

  test("a missing or wrong signature is 401 before anything of the body is parsed, and is recorded once in 30 seconds", async () => {
    const h = harness();
    const body = JSON.stringify(delivery());
    expect(await read(await h.post(body))).toEqual({ status: 401, body: { ok: false } });
    expect(await read(await h.post(body, { "Typeform-Signature": sign("another key of the same length!", body) }))).toEqual({ status: 401, body: { ok: false } });
    expect(await read(await h.post("not json at all", { "Typeform-Signature": "sha256=AAAA" }))).toEqual({ status: 401, body: { ok: false } });
    // The body changed after signing.
    expect((await h.post(body.replace(NOTE, "Edited"), { "Typeform-Signature": sign(SECRET, body) })).status).toBe(401);
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      { p_form_key: "kickoff", p_outcome: "unsigned", p_reason: "The signature was missing or did not match." },
    ]);
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    h.tick(UNSIGNED_SEEN_TTL_MS);
    await h.post(body);
    expect(h.rpcs("cockpit_forms_door_seen")).toHaveLength(2);
  });

  test("a rotated key works at once: a signature that fails against a key read 30 seconds ago or more reads it again", async () => {
    const NEW_SECRET = ["rotated", "kickoff", "signing", "key", "for", "tests"].join("-");
    const probe = { event_type: "probe" };
    const h = harness();
    expect((await h.signed(probe, { "x-forms-door-probe": "1" })).status).toBe(200);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(1);
    // forms_key.py typeform-secret saves a new key; register-typeform hands it to Typeform; the cache still holds the old.
    h.fake.secret = NEW_SECRET;
    h.tick(60_000);
    expect(await read(await h.signed(probe, { "x-forms-door-probe": "1" }, NEW_SECRET))).toEqual({ status: 200, body: { ok: true, probe: true } });
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    // The new key is the cached one now: deliveries signed with it read nothing more, and the old key is refused.
    expect((await h.signed(delivery(), {}, NEW_SECRET)).status).toBe(200);
    expect((await h.signed(delivery())).status).toBe(401);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);

    // probe-typeform's own order: the unsigned probe reads the new key on its way to the 401, then the signed one passes.
    const p = harness();
    await p.signed(delivery());
    p.fake.secret = NEW_SECRET;
    p.tick(SECRET_TTL_MS - 1);
    expect((await p.post(JSON.stringify(probe), { "x-forms-door-probe": "1" })).status).toBe(401);
    expect((await p.signed(probe, { "x-forms-door-probe": "1" }, NEW_SECRET)).status).toBe(200);
    expect(p.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    expect(p.rpcs("cockpit_forms_door_seen").map(s => s?.p_outcome)).toEqual(["recorded", "unsigned", "probe"]);
  });

  test("a failed signature reads the key again at most once in 30 seconds, so a flood without the key costs one read", async () => {
    const h = harness();
    const body = JSON.stringify(delivery());
    await h.signed(delivery());
    h.tick(10_000);
    for (let i = 0; i < 3; i++) expect((await h.post(body)).status).toBe(401);
    // The key was read 10 seconds ago: nothing is read again.
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(1);
    h.tick(MISSING_SECRET_TTL_MS - 10_000);
    for (let i = 0; i < 3; i++) expect((await h.post(body)).status).toBe(401);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    h.tick(MISSING_SECRET_TTL_MS - 1);
    expect((await h.post(body)).status).toBe(401);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    h.tick(1);
    expect((await h.post(body)).status).toBe(401);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(3);
    // The unsigned outcome is still written at most once in 30 seconds: at 10 s and at 60 s less a millisecond.
    expect(h.rpcs("cockpit_forms_door_seen").filter(s => s?.p_outcome === "unsigned")).toHaveLength(2);
    expect(h.rpcs("cockpit_form_record_typeform")).toHaveLength(1);
  });

  test("a fresh read that fails answers 503 and waits 30 seconds; one that finds no key answers 503 with its sentence", async () => {
    const h = harness();
    const body = JSON.stringify(delivery());
    await h.signed(delivery());
    h.fake.secret = "throw";
    h.tick(60_000);
    expect(await read(await h.post(body))).toEqual({ status: 503, body: { ok: false } });
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    // A read that threw still counts: the next failed signature in 30 seconds answers 401 from the cached key.
    expect((await h.post(body)).status).toBe(401);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    h.tick(MISSING_SECRET_TTL_MS);
    expect((await h.post(body)).status).toBe(503);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(3);
    // The key was removed (unregister-typeform, before a new one is saved).
    h.fake.secret = null;
    h.tick(MISSING_SECRET_TTL_MS);
    expect(await read(await h.post(body))).toEqual({ status: 503, body: { ok: false } });
    expect(h.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({ p_form_key: "kickoff", p_outcome: "failed", p_reason: "No signing key saved" });
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(4);
    expect((await h.signed(delivery())).status).toBe(503);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(4);
    expect(h.logs.slice(-2)).toEqual(["forms-door kickoff failed", "forms-door kickoff failed"]);
  });

  test("a signed probe answers 200 and stores nothing", async () => {
    const h = harness();
    expect(await read(await h.signed({ event_type: "probe" }, { "x-forms-door-probe": "1" }))).toEqual({ status: 200, body: { ok: true, probe: true } });
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "probe", p_reason: "A signed probe; nothing stored." }]);
    // An unsigned probe is just unsigned.
    expect((await h.post("{}", { "x-forms-door-probe": "1" })).status).toBe(401);
  });
});

describe("a signed delivery", () => {
  test("anything but a form_response of the registry's form is 202 ignored", async () => {
    for (const body of [{ event_type: "form_partial_response", form_response: delivery().form_response }, delivery({ form_id: "fRokTITH" }), { event_type: "form_response" }, "[1,2]", "not json"]) {
      const h = harness();
      expect(await read(await h.signed(body))).toEqual({ status: 202, body: { ignored: true } });
      expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
      expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "ignored", p_reason: "Not a form response of tG7dnxBn." }]);
    }
  });

  test("a kickoff response is recorded with the worker's own answer mapping and only 3.9's keys", async () => {
    const h = harness();
    expect(await read(await h.signed(delivery()))).toEqual({ status: 200, body: { ok: true, inserted: true } });
    const [call] = h.rpcs("cockpit_form_record_typeform");
    expect(Object.keys(call as Row)).toEqual(["p"]);
    const p = (call as Row).p;
    expect(Object.keys(p).sort()).toEqual(["answers", "formKey", "hidden", "recordingUrl", "submittedAt", "token", "via"]);
    expect(p).toEqual({
      formKey: "kickoff",
      token: "abc123def456ghi7",
      submittedAt: "2026-10-29T08:55:00Z",
      hidden: { onboarding_client_id: "86exc1tyw", email: EMAIL, phone: PHONE },
      answers: [
        { ref: "goal-ref", type: "long_text", title: "What is the goal of the launch?", value: NOTE },
        { ref: "call-ref", type: "website", title: "Call recording", value: LINK },
        { ref: "budget-ref", type: "multiple_choice", title: "Monthly budget", value: "$1,000 to $2,000" },
      ],
      recordingUrl: LINK,
      via: "typeform_webhook",
    });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "recorded", p_reason: null }]);
    // The service key goes to the database and nowhere else.
    expect(h.calls.every(c => c.auth === `Bearer ${SERVICE_KEY}`)).toBe(true);
  });

  test("the record input has no recording when no answer holds one, and an empty hidden object when none came", () => {
    const r = delivery({ answers: [{ type: "text", text: NOTE, field: { ref: "goal-ref", type: "long_text" } }], hidden: undefined }).form_response;
    expect(recordInput("kickoff", r)).toMatchObject({ hidden: {}, recordingUrl: null, answers: [{ ref: "goal-ref", value: NOTE }] });
  });

  test("a repeat answers 200 with inserted false and is recorded as a repeat", async () => {
    const h = harness({ record: { ok: true, id: "11111111-1111-4111-8111-111111111111", inserted: false, taskId: "86exc1tyw", state: "submitted" } });
    expect(await read(await h.signed(delivery()))).toEqual({ status: 200, body: { ok: true, inserted: false } });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "repeat", p_reason: null }]);
  });

  test("a refusal from the store answers 500, so Typeform retries, and records the code only", async () => {
    const h = harness({ record: { status: 400, code: "22023", message: `A token must be 8 to 64 letters or digits, not ${EMAIL}.` } });
    expect(await read(await h.signed(delivery()))).toEqual({ status: 500, body: { ok: false } });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([{ p_form_key: "kickoff", p_outcome: "failed", p_reason: "The store refused the response (22023)." }]);
    const odd = harness({ record: { ok: true } });
    expect((await odd.signed(delivery())).status).toBe(500);
  });

  test("a failed write of the last delivery never changes the answer", async () => {
    const h = harness({ seenFails: true });
    expect(await read(await h.signed(delivery()))).toEqual({ status: 200, body: { ok: true, inserted: true } });
  });
});

describe("the log", () => {
  test("one line per delivery, naming the form and the outcome, never a body, an answer, a hidden value, a token or a key", async () => {
    const h = harness();
    const body = JSON.stringify(delivery());
    await h.signed(delivery());
    await h.post(body);
    await h.signed({ event_type: "probe" }, { "x-forms-door-probe": "1" });
    await h.signed(delivery({ form_id: "other" }));
    await h.post("{}", {}, "/forms-door/typeform/checkin");
    await harness({ record: { status: 400, code: "22023", message: EMAIL } }).signed(delivery());
    expect(h.logs).toEqual([
      "forms-door kickoff recorded",
      "forms-door kickoff unsigned",
      "forms-door kickoff probe",
      "forms-door kickoff ignored",
      "forms-door - form",
    ]);
    for (const line of h.logs)
      for (const secretish of [EMAIL, PHONE, NOTE, LINK, "abc123def456ghi7", "86exc1tyw", SECRET, SERVICE_KEY, "$1,000"]) expect(line).not.toContain(secretish);
  });
});
