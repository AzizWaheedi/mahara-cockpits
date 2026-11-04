// forms-door (docs/forms/STAGE2B-CONTRACT.md 4.8; docs/forms/WAVE12-CONTRACT.md
// 4.4): every route and refusal, the worker's own answer mapping of a signed
// Typeform body, the record call's shape, each outcome forms-door:{form}
// records (3.9), the termination survey and the pause request stored as legacy
// records with their own keys, and no body, answer or hidden value in any log
// line; the sale tie's keys (4.19) from the New Client Form's typed answers only,
// sent to cockpit_sale_tie_open alone, its failure kept off the answer, and the
// raw phone never stored. A fake database and a signer written with
// node:crypto, so the door's check (team-onboarding-intake/signature.ts) is held
// against a second implementation. People, clients, links and values are invented.
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { formsFor } from "../../../apps/client-success-cockpit/src/lib/onboardingCore.ts";
import {
  FORM_KEYS,
  formKeyOf,
  legacyInput,
  MAX_BODY_BYTES,
  makeInput,
  MISSING_SECRET_TTL_MS,
  makeHandler,
  NEW_CLIENT_REF,
  recordInput,
  recordOf,
  tieKeysOf,
  SECRET_TTL_MS,
  UNSIGNED_SEEN_TTL_MS,
} from "./handler.ts";

const BASE = "https://db.test";
const SERVICE_KEY = "sb_service_key_for_tests_only";
/** An invented signing key, put together at run time so this file holds nothing shaped like one. */
const SECRET = ["invented", "kickoff", "signing", "key", "for", "tests"].join(
  "-",
);
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
          {
            id: "f1",
            ref: "goal-ref",
            type: "long_text",
            title: "What is the goal of the launch?",
          },
          {
            id: "g1",
            ref: "group-ref",
            type: "group",
            title: "Links",
            properties: {
              fields: [
                {
                  id: "f2",
                  ref: "call-ref",
                  type: "website",
                  title: "Call recording",
                },
              ],
            },
          },
          {
            id: "f3",
            ref: "budget-ref",
            type: "multiple_choice",
            title: "Monthly budget",
          },
        ],
      },
      answers: [
        {
          type: "text",
          text: NOTE,
          field: { id: "f1", ref: "goal-ref", type: "long_text" },
        },
        {
          type: "url",
          url: LINK,
          field: { id: "f2", ref: "call-ref", type: "website" },
        },
        {
          type: "choice",
          choice: { label: "$1,000 to $2,000" },
          field: { id: "f3", ref: "budget-ref", type: "multiple_choice" },
        },
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
  /** The two client forms (waves 1-2): their registry rows, signing keys and the legacy record's answer. */
  registries?: Record<string, Row[]>;
  secrets?: Record<string, string>;
  legacy?: Row | { status: number; code: string; message: string };
  /** The two Make forms (waves 3-4): the record_make answer. */
  make?: Row | { status: number; code: string; message: string };
  /** Stage 4: cockpit_form_onboarding_typeform's answer once onboarding is native. */
  door?: Row;
  /** The sale tie (4.19): cockpit_sale_tie_open's answer, or a refusal. */
  tie?: Row | { status: number; code: string; message: string };
};

function harness(over: Partial<Fake> = {}) {
  const fake: Fake = {
    registry: [{ provider: "typeform", typeform_id: FORM_ID }],
    secret: SECRET,
    record: {
      ok: true,
      id: "11111111-1111-4111-8111-111111111111",
      inserted: true,
      taskId: "86exc1tyw",
      state: "submitted",
    },
    ...over,
  };
  const calls: {
    path: string;
    method: string;
    body: Row | null;
    auth: string | null;
  }[] = [];
  const logs: string[] = [];
  let now = NOW;
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.replace(BASE, "");
    const method = init.method ?? "GET";
    calls.push({
      path,
      method,
      body: init.body ? JSON.parse(String(init.body)) : null,
      auth: new Headers(init.headers).get("Authorization"),
    });
    const other =
      /^\/rest\/v1\/cockpit_forms\?select=provider,typeform_id&key=eq\.(exit_survey|pause_request|onboarding|new_client)$/.exec(
        path,
      );
    if (method === "GET" && other)
      return Response.json(fake.registries?.[other[1]] ?? []);
    if (
      method === "GET" &&
      path ===
        "/rest/v1/cockpit_forms?select=provider,typeform_id&key=eq.kickoff"
    ) {
      if (typeof fake.registry === "number")
        return new Response("{}", { status: fake.registry });
      return Response.json(fake.registry);
    }
    const provider = init.body
      ? JSON.parse(String(init.body)).p_provider
      : null;
    if (
      path === "/rest/v1/rpc/cockpit_forms_key_get" &&
      provider !== "typeform_kickoff"
    )
      return Response.json(
        fake.secrets?.[provider]
          ? { provider, secret: fake.secrets[provider], last4: "0000" }
          : null,
      );
    if (path === "/rest/v1/rpc/cockpit_form_record_legacy") {
      const r = (fake.legacy ?? {
        inserted: true,
        responseId: "22222222-2222-4222-8222-222222222222",
        matched: false,
        noticeQueued: true,
        taskId: "86eyjkdc8",
      }) as Row;
      if (typeof r.status === "number")
        return new Response(
          JSON.stringify({ message: r.message, code: r.code }),
          { status: r.status },
        );
      return Response.json(r);
    }
    if (path === "/rest/v1/rpc/cockpit_form_onboarding_typeform")
      return Response.json(
        fake.door ?? {
          inserted: true,
          responseId: "44444444-4444-4444-8444-444444444444",
          taskId: "86exc1tyw",
          stored: "native",
          effects: 8,
        },
      );
    if (path === "/rest/v1/rpc/cockpit_form_record_make") {
      const r = (fake.make ?? {
        inserted: true,
        responseId: "33333333-3333-4333-8333-333333333333",
        taskId: null,
        readModel: "no_card",
      }) as Row;
      if (typeof r.status === "number")
        return new Response(
          JSON.stringify({ message: r.message, code: r.code }),
          { status: r.status },
        );
      return Response.json(r);
    }
    if (path === "/rest/v1/rpc/cockpit_sale_tie_open") {
      const r = (fake.tie ?? { ok: true, state: "waiting", tieId: 7, repeat: false }) as Row;
      if (typeof r.status === "number")
        return new Response(JSON.stringify({ message: r.message, code: r.code }), { status: r.status });
      return Response.json(r);
    }
    if (path === "/rest/v1/rpc/cockpit_sale_tie_door_failed")
      return Response.json({ ok: true });
    if (path === "/rest/v1/rpc/cockpit_forms_key_get") {
      if (fake.secret === "throw")
        return new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
        });
      return Response.json(
        fake.secret
          ? { provider: "typeform_kickoff", secret: fake.secret, last4: "ests" }
          : null,
      );
    }
    if (path === "/rest/v1/rpc/cockpit_forms_door_seen") {
      if (fake.seenFails)
        return new Response(JSON.stringify({ message: "nope" }), {
          status: 500,
        });
      return Response.json({ ok: true });
    }
    if (path === "/rest/v1/rpc/cockpit_form_record_typeform") {
      const r = fake.record as Row;
      if (typeof r.status === "number")
        return new Response(
          JSON.stringify({ message: r.message, code: r.code }),
          { status: r.status },
        );
      return Response.json(r);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  }) as typeof globalThis.fetch;
  const handler = makeHandler({
    env: n =>
      ({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[n] ?? "",
    fetch,
    now: () => now,
    log: line => logs.push(line),
  });
  const post = (
    body: string,
    headers: Record<string, string> = {},
    path = ROUTE,
  ) =>
    handler(
      new Request(URL_OF(path), {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  const signed = (
    body: Row | string,
    headers: Record<string, string> = {},
    secret = SECRET,
  ) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return post(raw, { "Typeform-Signature": sign(secret, raw), ...headers });
  };
  const rpcs = (name: string) =>
    calls.filter(c => c.path === `/rest/v1/rpc/${name}`).map(c => c.body);
  return {
    fake,
    calls,
    logs,
    handler,
    post,
    signed,
    rpcs,
    tick: (ms: number) => (now += ms),
  };
}

const read = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
});

describe("the route", () => {
  test("only POST /forms-door/typeform/kickoff: other paths 404, other methods 405, every other form 404, before any read", async () => {
    const h = harness();
    for (const path of [
      "/forms-door",
      "/forms-door/x",
      "/forms-door/typeform",
      "/forms-door/typeform/kickoff/extra",
      "/other/typeform/kickoff",
    ])
      expect(await read(await h.post("{}", {}, path))).toEqual({
        status: 404,
        body: { ok: false },
      });
    for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
      const res = await h.handler(
        new Request(URL_OF(ROUTE), {
          method,
          ...(method === "GET" ? {} : { body: "{}" }),
        }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(await res.json()).toEqual({ ok: false });
    }
    // The checkin row also has a typeform_id and provider typeform: the door names kickoff alone (Z58).
    for (const form of [
      "checkin",
      "blueprint",
      "nps",
      "csat",
      "Kickoff",
      "kickoff%20",
      "",
    ])
      expect(
        (await h.post("{}", {}, `/forms-door/typeform/${form}`)).status,
      ).toBe(404);
    expect(FORM_KEYS).toEqual([
      "kickoff",
      "exit_survey",
      "pause_request",
      "onboarding",
      "new_client",
    ]);
    expect(h.calls).toEqual([]);
  });

  test("the path is read with or without the platform's prefix", () => {
    expect(formKeyOf("/forms-door/typeform/kickoff")).toBe("kickoff");
    expect(formKeyOf("/functions/v1/forms-door/typeform/kickoff/")).toBe(
      "kickoff",
    );
    expect(formKeyOf("/forms-door/typeform/%E0%A4")).toBeNull();
    expect(formKeyOf("/forms-door/kickoff")).toBeNull();
  });

  test("a body over 1.5 MB is refused before it is read whole or checked", async () => {
    const h = harness();
    expect(
      (await h.post("x", { "content-length": String(MAX_BODY_BYTES + 1) }))
        .status,
    ).toBe(413);
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect(
      await read(
        await h.handler(
          new Request(URL_OF(ROUTE), {
            method: "POST",
            body: new Blob([big]).stream(),
            duplex: "half",
          } as RequestInit),
        ),
      ),
    ).toEqual({
      status: 413,
      body: { ok: false },
    });
    expect(h.calls).toEqual([]);
  });

  test("the registry row must still carry its Typeform id (a native kickoff keeps it after Stage 4), else 404; an unreadable registry is a 503", async () => {
    for (const registry of [
      [{ provider: "clickup", typeform_id: FORM_ID }],
      [{ provider: "typeform", typeform_id: null }],
      [],
    ]) {
      const h = harness({ registry });
      expect(await read(await h.signed(delivery()))).toEqual({
        status: 404,
        body: { ok: false },
      });
      expect(h.rpcs("cockpit_forms_key_get")).toEqual([]);
    }
    const down = harness({ registry: 500 });
    expect(await read(await down.signed(delivery()))).toEqual({
      status: 503,
      body: { ok: false },
    });
  });
});

describe("the signing key and the signature", () => {
  test("no key saved: 503, recorded failed with its sentence, and read again only after 30 seconds", async () => {
    const h = harness({ secret: null });
    expect(await read(await h.post("{}"))).toEqual({
      status: 503,
      body: { ok: false },
    });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "kickoff",
        p_outcome: "failed",
        p_reason: "No signing key saved",
      },
    ]);
    expect(h.rpcs("cockpit_forms_key_get")).toEqual([
      { p_provider: "typeform_kickoff" },
    ]);
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
    expect(await read(await h.post(body))).toEqual({
      status: 401,
      body: { ok: false },
    });
    expect(
      await read(
        await h.post(body, {
          "Typeform-Signature": sign("another key of the same length!", body),
        }),
      ),
    ).toEqual({ status: 401, body: { ok: false } });
    expect(
      await read(
        await h.post("not json at all", {
          "Typeform-Signature": "sha256=AAAA",
        }),
      ),
    ).toEqual({ status: 401, body: { ok: false } });
    // The body changed after signing.
    expect(
      (
        await h.post(body.replace(NOTE, "Edited"), {
          "Typeform-Signature": sign(SECRET, body),
        })
      ).status,
    ).toBe(401);
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "kickoff",
        p_outcome: "unsigned",
        p_reason: "The signature was missing or did not match.",
      },
    ]);
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    h.tick(UNSIGNED_SEEN_TTL_MS);
    await h.post(body);
    expect(h.rpcs("cockpit_forms_door_seen")).toHaveLength(2);
  });

  test("a rotated key works at once: a signature that fails against a key read 30 seconds ago or more reads it again", async () => {
    const NEW_SECRET = [
      "rotated",
      "kickoff",
      "signing",
      "key",
      "for",
      "tests",
    ].join("-");
    const probe = { event_type: "probe" };
    const h = harness();
    expect((await h.signed(probe, { "x-forms-door-probe": "1" })).status).toBe(
      200,
    );
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(1);
    // forms_key.py typeform-secret saves a new key; register-typeform hands it to Typeform; the cache still holds the old.
    h.fake.secret = NEW_SECRET;
    h.tick(60_000);
    expect(
      await read(
        await h.signed(probe, { "x-forms-door-probe": "1" }, NEW_SECRET),
      ),
    ).toEqual({ status: 200, body: { ok: true, probe: true } });
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
    expect(
      (await p.post(JSON.stringify(probe), { "x-forms-door-probe": "1" }))
        .status,
    ).toBe(401);
    expect(
      (await p.signed(probe, { "x-forms-door-probe": "1" }, NEW_SECRET)).status,
    ).toBe(200);
    expect(p.rpcs("cockpit_forms_key_get")).toHaveLength(2);
    expect(p.rpcs("cockpit_forms_door_seen").map(s => s?.p_outcome)).toEqual([
      "recorded",
      "unsigned",
      "probe",
    ]);
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
    expect(
      h
        .rpcs("cockpit_forms_door_seen")
        .filter(s => s?.p_outcome === "unsigned"),
    ).toHaveLength(2);
    expect(h.rpcs("cockpit_form_record_typeform")).toHaveLength(1);
  });

  test("a fresh read that fails answers 503 and waits 30 seconds; one that finds no key answers 503 with its sentence", async () => {
    const h = harness();
    const body = JSON.stringify(delivery());
    await h.signed(delivery());
    h.fake.secret = "throw";
    h.tick(60_000);
    expect(await read(await h.post(body))).toEqual({
      status: 503,
      body: { ok: false },
    });
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
    expect(await read(await h.post(body))).toEqual({
      status: 503,
      body: { ok: false },
    });
    expect(h.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({
      p_form_key: "kickoff",
      p_outcome: "failed",
      p_reason: "No signing key saved",
    });
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(4);
    expect((await h.signed(delivery())).status).toBe(503);
    expect(h.rpcs("cockpit_forms_key_get")).toHaveLength(4);
    expect(h.logs.slice(-2)).toEqual([
      "forms-door kickoff failed",
      "forms-door kickoff failed",
    ]);
  });

  test("a signed probe answers 200 and stores nothing", async () => {
    const h = harness();
    expect(
      await read(
        await h.signed({ event_type: "probe" }, { "x-forms-door-probe": "1" }),
      ),
    ).toEqual({ status: 200, body: { ok: true, probe: true } });
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "kickoff",
        p_outcome: "probe",
        p_reason: "A signed probe; nothing stored.",
      },
    ]);
    // An unsigned probe is just unsigned.
    expect((await h.post("{}", { "x-forms-door-probe": "1" })).status).toBe(
      401,
    );
  });
});

describe("a signed delivery", () => {
  test("anything but a form_response of the registry's form is 202 ignored", async () => {
    for (const body of [
      {
        event_type: "form_partial_response",
        form_response: delivery().form_response,
      },
      delivery({ form_id: "fRokTITH" }),
      { event_type: "form_response" },
      "[1,2]",
      "not json",
    ]) {
      const h = harness();
      expect(await read(await h.signed(body))).toEqual({
        status: 202,
        body: { ignored: true },
      });
      expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
      expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
        {
          p_form_key: "kickoff",
          p_outcome: "ignored",
          p_reason: "Not a form response of tG7dnxBn.",
        },
      ]);
    }
  });

  test("a kickoff response is recorded with the worker's own answer mapping and only 3.9's keys", async () => {
    const h = harness();
    expect(await read(await h.signed(delivery()))).toEqual({
      status: 200,
      body: { ok: true, inserted: true },
    });
    const [call] = h.rpcs("cockpit_form_record_typeform");
    expect(Object.keys(call as Row)).toEqual(["p"]);
    const p = (call as Row).p;
    expect(Object.keys(p).sort()).toEqual([
      "answers",
      "formKey",
      "hidden",
      "recordingUrl",
      "submittedAt",
      "token",
      "via",
    ]);
    expect(p).toEqual({
      formKey: "kickoff",
      token: "abc123def456ghi7",
      submittedAt: "2026-10-29T08:55:00Z",
      hidden: { onboarding_client_id: "86exc1tyw", email: EMAIL, phone: PHONE },
      answers: [
        {
          ref: "goal-ref",
          type: "long_text",
          title: "What is the goal of the launch?",
          value: NOTE,
        },
        {
          ref: "call-ref",
          type: "website",
          title: "Call recording",
          value: LINK,
        },
        {
          ref: "budget-ref",
          type: "multiple_choice",
          title: "Monthly budget",
          value: "$1,000 to $2,000",
        },
      ],
      recordingUrl: LINK,
      via: "typeform_webhook",
    });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      { p_form_key: "kickoff", p_outcome: "recorded", p_reason: null },
    ]);
    // The service key goes to the database and nowhere else.
    expect(h.calls.every(c => c.auth === `Bearer ${SERVICE_KEY}`)).toBe(true);
  });

  test("the record input has no recording when no answer holds one, and an empty hidden object when none came", () => {
    const r = delivery({
      answers: [
        {
          type: "text",
          text: NOTE,
          field: { ref: "goal-ref", type: "long_text" },
        },
      ],
      hidden: undefined,
    }).form_response;
    expect(recordInput("kickoff", r)).toMatchObject({
      hidden: {},
      recordingUrl: null,
      answers: [{ ref: "goal-ref", value: NOTE }],
    });
  });

  test("a repeat answers 200 with inserted false and is recorded as a repeat", async () => {
    const h = harness({
      record: {
        ok: true,
        id: "11111111-1111-4111-8111-111111111111",
        inserted: false,
        taskId: "86exc1tyw",
        state: "submitted",
      },
    });
    expect(await read(await h.signed(delivery()))).toEqual({
      status: 200,
      body: { ok: true, inserted: false },
    });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      { p_form_key: "kickoff", p_outcome: "repeat", p_reason: null },
    ]);
  });

  test("a refusal from the store answers 500, so Typeform retries, and records the code only", async () => {
    const h = harness({
      record: {
        status: 400,
        code: "22023",
        message: `A token must be 8 to 64 letters or digits, not ${EMAIL}.`,
      },
    });
    expect(await read(await h.signed(delivery()))).toEqual({
      status: 500,
      body: { ok: false },
    });
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "kickoff",
        p_outcome: "failed",
        p_reason: "The store refused the response (22023).",
      },
    ]);
    const odd = harness({ record: { ok: true } });
    expect((await odd.signed(delivery())).status).toBe(500);
  });

  test("a failed write of the last delivery never changes the answer", async () => {
    const h = harness({ seenFails: true });
    expect(await read(await h.signed(delivery()))).toEqual({
      status: 200,
      body: { ok: true, inserted: true },
    });
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
    await harness({
      record: { status: 400, code: "22023", message: EMAIL },
    }).signed(delivery());
    expect(h.logs).toEqual([
      "forms-door kickoff recorded",
      "forms-door kickoff unsigned",
      "forms-door kickoff probe",
      "forms-door kickoff ignored",
      "forms-door - form",
    ]);
    for (const line of h.logs)
      for (const secretish of [
        EMAIL,
        PHONE,
        NOTE,
        LINK,
        "abc123def456ghi7",
        "86exc1tyw",
        SECRET,
        SERVICE_KEY,
        "$1,000",
      ])
        expect(line).not.toContain(secretish);
  });
});

// ----------------------------------------------------------------- waves 1-2: the two client forms (4.4)

const EXIT_ID = "knIe4eF3";
const PAUSE_ID = "CTUjv6l3";
/** Each form's own invented key, never kickoff's. */
const EXIT_SECRET = ["invented", "termination", "signing", "key"].join("-");
const PAUSE_SECRET = ["invented", "pause", "signing", "key"].join("-");
const CLIENT_EMAIL = "manager@atlantis.example";
const CLIENT_PHONE = "+965 1111 2222";
const COMMENT = "The leads were not the quality we hoped for";

/** A termination survey as Typeform sends it: the contact group's answers, the ratings, the hidden card id. */
function exitDelivery(over: Row = {}): Row {
  return {
    event_id: "01JTESTEXIT",
    event_type: "form_response",
    form_response: {
      form_id: EXIT_ID,
      token: "exit0000token001",
      submitted_at: "2026-10-31T22:30:00Z",
      hidden: {
        client_name: "Atlantis Interiors",
        onboarding_client_id: "86eyjkdc8",
        utm: "x",
      },
      definition: {
        id: EXIT_ID,
        title: "Contract Termination Survey",
        fields: [
          {
            id: "c1",
            ref: "first-ref",
            type: "short_text",
            title: "First name",
          },
          { id: "c2", ref: "email-ref", type: "email", title: "Email" },
          { id: "c3", ref: "phone-ref", type: "phone_number", title: "Phone" },
          {
            id: "r1",
            ref: "eafeb9cf-70b5-46c0-9432-4db2998d5bf1",
            type: "multiple_choice",
            title: "Reason",
          },
          {
            id: "r2",
            ref: "62edbc75-ca88-4f1f-875d-5e79939a7edf",
            type: "opinion_scale",
            title: "Ad performance",
          },
          {
            id: "r3",
            ref: "9209b2ae-6214-4ffd-b41f-74facda83726",
            type: "yes_no",
            title: "Would you recommend us?",
          },
          {
            id: "r4",
            ref: "b2d88140-720d-4dfa-bcaf-a953d6b28b5e",
            type: "long_text",
            title: "Final comments",
          },
        ],
      },
      answers: [
        {
          type: "text",
          text: "Dana",
          field: { id: "c1", ref: "first-ref", type: "short_text" },
        },
        {
          type: "email",
          email: CLIENT_EMAIL,
          field: { id: "c2", ref: "email-ref", type: "email" },
        },
        {
          type: "phone_number",
          phone_number: CLIENT_PHONE,
          field: { id: "c3", ref: "phone-ref", type: "phone_number" },
        },
        {
          type: "choices",
          choices: { labels: ["Results"] },
          field: {
            id: "r1",
            ref: "eafeb9cf-70b5-46c0-9432-4db2998d5bf1",
            type: "multiple_choice",
          },
        },
        {
          type: "number",
          number: 4,
          field: {
            id: "r2",
            ref: "62edbc75-ca88-4f1f-875d-5e79939a7edf",
            type: "opinion_scale",
          },
        },
        {
          type: "boolean",
          boolean: false,
          field: {
            id: "r3",
            ref: "9209b2ae-6214-4ffd-b41f-74facda83726",
            type: "yes_no",
          },
        },
        {
          type: "text",
          text: COMMENT,
          field: {
            id: "r4",
            ref: "b2d88140-720d-4dfa-bcaf-a953d6b28b5e",
            type: "long_text",
          },
        },
      ],
      ...over,
    },
  };
}

function clientHarness(over: Partial<Fake> = {}) {
  return harness({
    registries: {
      exit_survey: [{ provider: "typeform", typeform_id: EXIT_ID }],
      pause_request: [{ provider: "typeform", typeform_id: PAUSE_ID }],
    },
    secrets: {
      typeform_exit_survey: EXIT_SECRET,
      typeform_pause_request: PAUSE_SECRET,
    },
    ...over,
  });
}
const EXIT_ROUTE = "/forms-door/typeform/exit_survey";
const PAUSE_ROUTE = "/forms-door/typeform/pause_request";

describe("the termination survey and the pause request (waves 1-2, 4.4)", () => {
  test("a bad signature is 401 before any parse, with the form's own key; kickoff's key does not open it", async () => {
    const h = clientHarness();
    const raw = JSON.stringify(exitDelivery());
    expect((await h.post(raw, {}, EXIT_ROUTE)).status).toBe(401);
    expect(
      (
        await h.post(
          raw,
          { "Typeform-Signature": sign(SECRET, raw) },
          EXIT_ROUTE,
        )
      ).status,
    ).toBe(401);
    expect(h.rpcs("cockpit_form_record_legacy")).toEqual([]);
    expect(h.rpcs("cockpit_forms_key_get")).toEqual([
      { p_provider: "typeform_exit_survey" },
    ]);
    expect(h.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "exit_survey",
        p_outcome: "unsigned",
        p_reason: "The signature was missing or did not match.",
      },
    ]);
  });

  test("a signed survey is stored as a legacy record: no email or phone, the two hidden fields, the card from the hidden id", async () => {
    const h = clientHarness();
    const raw = JSON.stringify(exitDelivery());
    expect(
      await read(
        await h.post(
          raw,
          { "Typeform-Signature": sign(EXIT_SECRET, raw) },
          EXIT_ROUTE,
        ),
      ),
    ).toEqual({
      status: 200,
      body: { ok: true, inserted: true },
    });
    const [call] = h.rpcs("cockpit_form_record_legacy");
    expect(call).toEqual({
      p: {
        formKey: "exit_survey",
        externalId: "exit0000token001",
        submittedAt: "2026-10-31T22:30:00Z",
        answers: {
          fields: [
            {
              ref: "first-ref",
              type: "short_text",
              title: "First name",
              value: "Dana",
            },
            {
              ref: "eafeb9cf-70b5-46c0-9432-4db2998d5bf1",
              type: "multiple_choice",
              title: "Reason",
              value: ["Results"],
            },
            {
              ref: "62edbc75-ca88-4f1f-875d-5e79939a7edf",
              type: "opinion_scale",
              title: "Ad performance",
              value: 4,
            },
            {
              ref: "9209b2ae-6214-4ffd-b41f-74facda83726",
              type: "yes_no",
              title: "Would you recommend us?",
              value: false,
            },
            {
              ref: "b2d88140-720d-4dfa-bcaf-a953d6b28b5e",
              type: "long_text",
              title: "Final comments",
              value: COMMENT,
            },
          ],
        },
        hidden: {
          client_name: "Atlantis Interiors",
          onboarding_client_id: "86eyjkdc8",
        },
        taskId: "86eyjkdc8",
        clientName: "Atlantis Interiors",
        backfill: false,
      },
    });
    expect(JSON.stringify(call)).not.toContain(CLIENT_EMAIL);
    expect(JSON.stringify(call)).not.toContain(CLIENT_PHONE);
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    expect(h.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({
      p_form_key: "exit_survey",
      p_outcome: "recorded",
      p_reason: null,
    });
    expect(h.logs).toEqual(["forms-door exit_survey recorded"]);
  });

  test("a survey with no card id is stored unmatched; a pause request takes the same path; a repeat is a repeat", async () => {
    const h = clientHarness({
      legacy: {
        inserted: false,
        responseId: "x",
        matched: false,
        noticeQueued: false,
        taskId: null,
      },
    });
    const bare = exitDelivery({ hidden: { client_name: "Atlantis" } });
    const raw = JSON.stringify(bare);
    expect(
      (
        await read(
          await h.post(
            raw,
            { "Typeform-Signature": sign(EXIT_SECRET, raw) },
            EXIT_ROUTE,
          ),
        )
      ).body,
    ).toEqual({
      ok: true,
      inserted: false,
    });
    expect(h.rpcs("cockpit_form_record_legacy")[0].p).toMatchObject({
      taskId: null,
      clientName: "Atlantis",
      hidden: { client_name: "Atlantis" },
    });
    const pause = exitDelivery({
      form_id: PAUSE_ID,
      token: "pause000token001",
    });
    const praw = JSON.stringify(pause);
    expect(
      (
        await h.post(
          praw,
          { "Typeform-Signature": sign(PAUSE_SECRET, praw) },
          PAUSE_ROUTE,
        )
      ).status,
    ).toBe(200);
    expect(h.rpcs("cockpit_form_record_legacy")[1].p).toMatchObject({
      formKey: "pause_request",
      externalId: "pause000token001",
    });
    expect(h.logs).toEqual([
      "forms-door exit_survey repeat",
      "forms-door pause_request repeat",
    ]);
  });

  test("each form reads its own registry row and key, once in five minutes; another form's response is ignored", async () => {
    const h = clientHarness();
    const raw = JSON.stringify(exitDelivery());
    const headers = { "Typeform-Signature": sign(EXIT_SECRET, raw) };
    await h.post(raw, headers, EXIT_ROUTE);
    await h.post(raw, headers, EXIT_ROUTE);
    const praw = JSON.stringify(exitDelivery());
    // A termination response sent to the pause door, signed with the pause key: not that form's response.
    expect(
      (
        await h.post(
          praw,
          { "Typeform-Signature": sign(PAUSE_SECRET, praw) },
          PAUSE_ROUTE,
        )
      ).status,
    ).toBe(202);
    expect(
      h.calls
        .filter(c => c.path.startsWith("/rest/v1/cockpit_forms?"))
        .map(c => c.path.split("key=eq.")[1]),
    ).toEqual(["exit_survey", "pause_request"]);
    expect(h.rpcs("cockpit_forms_key_get")).toEqual([
      { p_provider: "typeform_exit_survey" },
      { p_provider: "typeform_pause_request" },
    ]);
  });

  test("a form with no Typeform id, or not filled there, is 404; no key saved is 503 with its sentence; a store refusal is 500 with the code only", async () => {
    for (const row of [
      { provider: "native", typeform_id: null },
      { provider: "clickup", typeform_id: EXIT_ID },
    ]) {
      const moved = clientHarness({ registries: { exit_survey: [row] } });
      expect((await moved.post("{}", {}, EXIT_ROUTE)).status).toBe(404);
    }
    const nokey = clientHarness({ secrets: {} });
    expect((await nokey.post("{}", {}, PAUSE_ROUTE)).status).toBe(503);
    expect(nokey.rpcs("cockpit_forms_door_seen")).toEqual([
      {
        p_form_key: "pause_request",
        p_outcome: "failed",
        p_reason: "No signing key saved",
      },
    ]);
    const refused = clientHarness({
      legacy: { status: 400, code: "22023", message: CLIENT_EMAIL },
    });
    const raw = JSON.stringify(exitDelivery());
    expect(
      (
        await refused.post(
          raw,
          { "Typeform-Signature": sign(EXIT_SECRET, raw) },
          EXIT_ROUTE,
        )
      ).status,
    ).toBe(500);
    expect(refused.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({
      p_form_key: "exit_survey",
      p_outcome: "failed",
      p_reason: "The store refused the response (22023).",
    });
  });

  test("the log holds no body, answer, hidden value or key of either form", async () => {
    const h = clientHarness();
    const raw = JSON.stringify(exitDelivery());
    await h.post(
      raw,
      { "Typeform-Signature": sign(EXIT_SECRET, raw) },
      EXIT_ROUTE,
    );
    await h.post(raw, {}, EXIT_ROUTE);
    for (const line of h.logs)
      for (const secretish of [
        CLIENT_EMAIL,
        CLIENT_PHONE,
        COMMENT,
        "Atlantis",
        "86eyjkdc8",
        "exit0000token001",
        EXIT_SECRET,
        SERVICE_KEY,
        "Dana",
      ])
        expect(line).not.toContain(secretish);
    expect(h.logs).toEqual([
      "forms-door exit_survey recorded",
      "forms-door exit_survey unsigned",
    ]);
  });

  test("legacyInput keeps only short trimmed hidden strings and refuses a card id that is not shaped like one", () => {
    const p = legacyInput(
      "pause_request",
      {
        token: "t",
        submitted_at: "s",
        hidden: {
          onboarding_client_id: " bad id! ",
          client_name: "  ",
          email: CLIENT_EMAIL,
        },
        answers: [],
      },
      true,
    );
    expect(p).toEqual({
      formKey: "pause_request",
      externalId: "t",
      submittedAt: "s",
      answers: { fields: [] },
      hidden: { onboarding_client_id: "bad id!" },
      taskId: null,
      clientName: null,
      backfill: true,
    });
  });
});

// ----------------------------------------------------------------- waves 3-4: the two Make forms and the old exit link

const fixture = (name: string): Row =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const ONBOARDING_ID = "KFRCXPFx";
const NEW_CLIENT_ID = "BTzMwXiw";
const ONB_SECRET = ["invented", "onboarding", "signing", "key"].join("-");
const NCF_SECRET = ["invented", "new", "client", "signing", "key"].join("-");
const ONB_ROUTE = "/forms-door/typeform/onboarding";
const NCF_ROUTE = "/forms-door/typeform/new_client";

function makeHarness(over: Partial<Fake> = {}) {
  return harness({
    registries: {
      onboarding: [{ provider: "typeform", typeform_id: ONBOARDING_ID }],
      new_client: [{ provider: "typeform", typeform_id: NEW_CLIENT_ID }],
      exit_survey: [{ provider: "native", typeform_id: EXIT_ID }],
    },
    secrets: {
      typeform_onboarding: ONB_SECRET,
      typeform_new_client: NCF_SECRET,
      typeform_exit_survey: EXIT_SECRET,
    },
    ...over,
  });
}

describe("client onboarding and the New Client Form (waves 3-4, 4.7 and 4.8)", () => {
  test("a bad signature is 401 before anything is parsed or stored, each form with its own key", async () => {
    const h = makeHarness();
    for (const [route, other] of [
      [ONB_ROUTE, NCF_SECRET],
      [NCF_ROUTE, ONB_SECRET],
    ] as const) {
      const raw = "{not json";
      expect((await h.post(raw, {}, route)).status).toBe(401);
      expect(
        (await h.post(raw, { "Typeform-Signature": sign(other, raw) }, route))
          .status,
      ).toBe(401);
    }
    expect(h.rpcs("cockpit_form_record_make")).toEqual([]);
    expect(h.rpcs("cockpit_forms_key_get")).toEqual([
      { p_provider: "typeform_onboarding" },
      { p_provider: "typeform_new_client" },
    ]);
  });

  test("an onboarding answer is recorded through cockpit_form_record_make with formsFor's own entry, and no Typeform call", async () => {
    const h = makeHarness({
      make: {
        inserted: true,
        responseId: "33333333-3333-4333-8333-333333333333",
        taskId: "86exc1tyw",
        readModel: "written",
      },
    });
    const body = fixture("onboarding-response.json");
    const raw = JSON.stringify(body);
    expect(
      await read(
        await h.post(
          raw,
          { "Typeform-Signature": sign(ONB_SECRET, raw) },
          ONB_ROUTE,
        ),
      ),
    ).toEqual({ status: 200, body: { ok: true, inserted: true } });
    const [call] = h.rpcs("cockpit_form_record_make");
    // The onboarding sync's own mapping on the same response: the read model gets exactly this entry.
    const expected = formsFor("86exc1tyw", {
      definitions: { onboarding: body.form_response.definition },
      responses: { onboarding: [body.form_response] },
    }).onboarding;
    expect(expected).toBeDefined();
    expect(call).toEqual({
      p: {
        formKey: "onboarding",
        externalId: "onb0000token0001",
        submittedAt: "2026-10-30T07:15:00Z",
        backfill: false,
        answers: { fields: expected!.answers },
        hidden: { client_name: "City Wood", onboarding_client_id: "86exc1tyw" },
        taskId: "86exc1tyw",
      },
    });
    // Titles cleaned as the sync cleans them: the English half, recalled hidden values, no markdown leftovers.
    expect(expected!.answers.map(a => a.title)).toEqual([
      "Company name",
      "Your email for City Wood",
      "WhatsApp number",
      "Main services",
      "Monthly budget (KWD)",
      "Website",
      "Showroom opening date",
    ]);
    expect(h.calls.every(c => c.path.startsWith("/rest/v1/"))).toBe(true);
    expect(h.rpcs("cockpit_form_record_legacy")).toEqual([]);
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    expect(h.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({
      p_form_key: "onboarding",
      p_outcome: "recorded",
      p_reason: null,
    });
    expect(h.logs).toEqual(["forms-door onboarding recorded"]);
  });

  test("an onboarding answer with no card id keeps the same mapping and no card", () => {
    const body = fixture("onboarding-response.json").form_response;
    const p = makeInput("onboarding", {
      ...body,
      hidden: { client_name: "City Wood" },
    });
    expect(p.taskId).toBeNull();
    expect(p.hidden).toEqual({ client_name: "City Wood" });
    expect(p.answers.fields).toEqual(makeInput("onboarding", body).answers.fields);
    expect(
      makeInput("onboarding", {
        ...body,
        hidden: { onboarding_client_id: "not a card!" },
      }).taskId,
    ).toBeNull();
  });

  test("a New Client Form answer is recorded only: no email or phone, its three hidden ids, no card", async () => {
    const h = makeHarness();
    const raw = JSON.stringify(fixture("new-client-response.json"));
    expect(
      (
        await h.post(
          raw,
          { "Typeform-Signature": sign(NCF_SECRET, raw) },
          NCF_ROUTE,
        )
      ).status,
    ).toBe(200);
    const [call] = h.rpcs("cockpit_form_record_make");
    expect(call.p).toMatchObject({
      formKey: "new_client",
      externalId: "ncf0000token0001",
      submittedAt: "2026-10-30T11:00:00Z",
      hidden: {
        contact_id: "ghlContact0001",
        closer: "Closer Test",
        setter: "Setter Test",
      },
      taskId: null,
      backfill: false,
    });
    expect(call.p.answers.fields.map((f: Row) => f.ref)).toEqual([
      "business-ref",
      "plan-ref",
      "amount-ref",
    ]);
    const text = JSON.stringify(call);
    // No email, no phone, and no raw phone (f322053a, a short_text, dropped by its ref).
    for (const secretish of ["owner@harbour.example", "+965 0000 0002", "96500000002", NEW_CLIENT_REF.rawPhone, "kept-out", "tieKeys"])
      expect(text).not.toContain(secretish);
    // The sale tie gets the two typed keys, after the record and its outcome.
    expect(h.rpcs("cockpit_sale_tie_open")).toEqual([
      {
        p: {
          externalId: "ncf0000token0001",
          submittedAt: "2026-10-30T11:00:00Z",
          tieKeys: { phone: "+965 0000 0002", email: "owner@harbour.example" },
        },
      },
    ]);
    const order = h.calls.map(c => c.path.replace("/rest/v1/rpc/", "")).filter(p => !p.startsWith("/"));
    expect(order.slice(-3)).toEqual(["cockpit_form_record_make", "cockpit_forms_door_seen", "cockpit_sale_tie_open"]);
    expect(h.rpcs("cockpit_sale_tie_door_failed")).toEqual([]);
    expect(h.logs).toEqual(["forms-door new_client recorded"]);
  });

  test("the sale tie's keys come from the form's typed phone and email answers only", () => {
    const body = fixture("new-client-response.json").form_response;
    expect(tieKeysOf(body)).toEqual({ phone: "+965 0000 0002", email: "owner@harbour.example" });
    // A phone in a hidden field, the raw-phone short_text, or a typed answer under another ref is never a key.
    const only = (answers: Row[], hidden: Row = {}) => tieKeysOf({ ...body, answers, hidden });
    expect(only([], { phone: "+96500000003", email: "hidden@harbour.example" })).toEqual({ phone: null, email: null });
    expect(only([{ type: "text", text: "96500000004", field: { ref: NEW_CLIENT_REF.rawPhone, type: "short_text" } }]))
      .toEqual({ phone: null, email: null });
    expect(only([
      { type: "phone_number", phone_number: "+96500000005", field: { ref: "other-phone", type: "phone_number" } },
      { type: "email", email: "other@harbour.example", field: { ref: "other-email", type: "email" } },
      { type: "text", text: "+96500000006", field: { ref: NEW_CLIENT_REF.phone, type: "phone_number" } },
    ])).toEqual({ phone: null, email: null });
    expect(only([{ type: "email", email: "   ", field: { ref: NEW_CLIENT_REF.email, type: "email" } }])).toEqual({ phone: null, email: null });
    // The record's input never carries them; the termination survey's mapping is unchanged by the raw-phone rule.
    expect(recordOf(makeInput("new_client", body))).not.toHaveProperty("tieKeys");
    expect(makeInput("onboarding", fixture("onboarding-response.json").form_response)).not.toHaveProperty("tieKeys");
  });

  test("a failed sale tie still answers 200, marks the door's health and logs no key; a repeat delivery opens the tie again", async () => {
    const h = makeHarness({ tie: { status: 500, code: "XX000", message: "owner@harbour.example +965 0000 0002" } });
    const raw = JSON.stringify(fixture("new-client-response.json"));
    const headers = { "Typeform-Signature": sign(NCF_SECRET, raw) };
    expect(await read(await h.post(raw, headers, NCF_ROUTE))).toEqual({ status: 200, body: { ok: true, inserted: true } });
    expect(h.rpcs("cockpit_sale_tie_door_failed")).toEqual([{}]);
    expect(h.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({ p_form_key: "new_client", p_outcome: "recorded", p_reason: null });
    expect(h.logs).toEqual(["forms-door new_client recorded"]);
    for (const line of h.logs)
      for (const secretish of ["owner@harbour.example", "+965 0000 0002", "96500000002", "ncf0000token0001"])
        expect(line).not.toContain(secretish);
    const repeat = makeHarness({ make: { inserted: false, responseId: "x", taskId: null, readModel: "not_onboarding" },
      tie: { ok: true, state: "tied", tieId: 3, repeat: true } });
    expect(await read(await repeat.post(raw, headers, NCF_ROUTE))).toEqual({ status: 200, body: { ok: true, inserted: false } });
    expect(repeat.rpcs("cockpit_sale_tie_open")).toHaveLength(1);
    // A store refusal never reaches the tie.
    const refused = makeHarness({ make: { status: 400, code: "22023", message: "x" } });
    expect((await refused.post(raw, headers, NCF_ROUTE)).status).toBe(500);
    expect(refused.rpcs("cockpit_sale_tie_open")).toEqual([]);
    // The client onboarding form never opens a tie.
    const onb = makeHarness();
    const onbRaw = JSON.stringify(fixture("onboarding-response.json"));
    expect((await onb.post(onbRaw, { "Typeform-Signature": sign(ONB_SECRET, onbRaw) }, ONB_ROUTE)).status).toBe(200);
    expect(onb.rpcs("cockpit_sale_tie_open")).toEqual([]);
  });

  test("a repeat is a repeat, a store refusal is 500 with the code only, and no log line holds a value", async () => {
    const repeat = makeHarness({
      make: { inserted: false, responseId: "x", taskId: null, readModel: "no_card" },
    });
    const raw = JSON.stringify(fixture("onboarding-response.json"));
    const headers = { "Typeform-Signature": sign(ONB_SECRET, raw) };
    expect((await repeat.post(raw, headers, ONB_ROUTE)).status).toBe(200);
    expect(repeat.rpcs("cockpit_forms_door_seen").at(-1)?.p_outcome).toBe("repeat");
    const refused = makeHarness({
      make: { status: 400, code: "22023", message: "owner@citywood.example" },
    });
    expect((await refused.post(raw, headers, ONB_ROUTE)).status).toBe(500);
    expect(refused.rpcs("cockpit_forms_door_seen").at(-1)).toEqual({
      p_form_key: "onboarding",
      p_outcome: "failed",
      p_reason: "The store refused the response (22023).",
    });
    for (const line of [...repeat.logs, ...refused.logs])
      for (const secretish of ["owner@citywood.example", "City Wood", "86exc1tyw", "onb0000token0001", ONB_SECRET])
        expect(line).not.toContain(secretish);
  });

  test("a termination survey through the old link after the exit survey turned native is still stored as legacy (V16)", async () => {
    const h = makeHarness();
    const raw = JSON.stringify(exitDelivery());
    expect(
      (
        await h.post(
          raw,
          { "Typeform-Signature": sign(EXIT_SECRET, raw) },
          EXIT_ROUTE,
        )
      ).status,
    ).toBe(200);
    expect(h.rpcs("cockpit_form_record_legacy")[0].p.formKey).toBe("exit_survey");
    expect(h.rpcs("cockpit_form_record_make")).toEqual([]);
  });

  test("a native kickoff row with no Typeform id is 404", async () => {
    const h = harness({ registry: [{ provider: "native", typeform_id: null }] });
    expect((await h.post("{}")).status).toBe(404);
  });
});

describe("Stage 4: the old links once kickoff and onboarding are native (4.15.3, X26)", () => {
  test("a kickoff through the old link is kept as a legacy record: no email or phone, the two hidden fields only", async () => {
    const h = harness({ registry: [{ provider: "native", typeform_id: FORM_ID }] });
    const res = await read(await h.signed(delivery()));
    expect(res).toEqual({ status: 200, body: { ok: true, inserted: true } });
    expect(h.rpcs("cockpit_form_record_typeform")).toEqual([]);
    const p = h.rpcs("cockpit_form_record_legacy")[0].p;
    expect(p.formKey).toBe("kickoff");
    expect(p.hidden).toEqual({ onboarding_client_id: "86exc1tyw" });
    expect(p.taskId).toBe("86exc1tyw");
    expect(JSON.stringify(p)).not.toContain(EMAIL);
    expect(JSON.stringify(p)).not.toContain(PHONE);
    for (const line of h.logs) expect(line).toBe("forms-door kickoff recorded");
  });

  test("an onboarding answer goes to the native planner with onboardingAnswers' entry; a repeat is a repeat", async () => {
    const native = { onboarding: [{ provider: "native", typeform_id: ONBOARDING_ID }] };
    const h = makeHarness({ registries: { ...native, new_client: [{ provider: "typeform", typeform_id: NEW_CLIENT_ID }] } });
    const raw = JSON.stringify(fixture("onboarding-response.json"));
    const res = await read(await h.post(raw, { "Typeform-Signature": sign(ONB_SECRET, raw) }, ONB_ROUTE));
    expect(res).toEqual({ status: 200, body: { ok: true, inserted: true } });
    expect(h.rpcs("cockpit_form_record_make")).toEqual([]);
    const sent = h.rpcs("cockpit_form_onboarding_typeform")[0].p_payload;
    expect(sent).toEqual(makeInput("onboarding", fixture("onboarding-response.json").form_response));
    const again = makeHarness({ registries: { ...native }, door: { inserted: false, responseId: "x", stored: "native" } });
    const r2 = await read(await again.post(raw, { "Typeform-Signature": sign(ONB_SECRET, raw) }, ONB_ROUTE));
    expect(r2).toEqual({ status: 200, body: { ok: true, inserted: false } });
    expect(again.logs).toEqual(["forms-door onboarding repeat"]);
  });

  test("before the go-live both keep their Typeform stores", async () => {
    const k = harness();
    await k.signed(delivery());
    expect(k.rpcs("cockpit_form_record_typeform")).toHaveLength(1);
    expect(k.rpcs("cockpit_form_record_legacy")).toEqual([]);
    const o = makeHarness();
    const raw = JSON.stringify(fixture("onboarding-response.json"));
    await o.post(raw, { "Typeform-Signature": sign(ONB_SECRET, raw) }, ONB_ROUTE);
    expect(o.rpcs("cockpit_form_record_make")).toHaveLength(1);
    expect(o.rpcs("cockpit_form_onboarding_typeform")).toEqual([]);
  });
});

describe("the golden inputs the backfill matches (scripts/dev/test_forms_legacy_backfill.py reads the same files)", () => {
  test("makeInput on each recorded payload equals its golden file", () => {
    for (const [payload, form, golden] of [
      ["onboarding-response.json", "onboarding", "onboarding-expected.json"],
      ["new-client-response.json", "new_client", "new-client-expected.json"],
    ] as const) {
      const input = makeInput(form, fixture(payload).form_response, true);
      expect(recordOf(input)).toEqual(fixture(golden).p);
      // The sale tie's keys ride beside the record, never in it (4.19).
      expect(input.tieKeys).toEqual(fixture(golden).tieKeys);
    }
  });
});
