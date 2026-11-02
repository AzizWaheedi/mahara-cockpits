import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { type HealthRow, MAX_BODY, makeAgentDoor, readCall, SEND, sha256Hex, UNKNOWN_PER_MINUTE } from "./door";

// The billing agent's door (docs/forms/WAVE56-CONTRACT.md 3.4). The database is a stand-in that
// answers the way cockpit_billing_agent_write and _read do (money-rails-w5-supabase.test.ts proves
// those); every key here is invented.
const KEY = `mak_${"Q".repeat(21)}-_${"z".repeat(20)}`;
const RID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const URL = "https://example.functions.test/billing-agent";

function kit(answer: (name: string, args: Record<string, unknown>) => unknown = () => ({ ok: true, outcome: "ok", status: 200, result: { eventId: 7 } })) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const health: HealthRow[] = [];
  const door = makeAgentDoor({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return answer(name, args);
    },
    insertHealth: async row => {
      health.push(row);
    },
    sha256Hex,
    uuid: () => "00000000-0000-4000-8000-000000000001",
  });
  return { door, calls, health };
}
const post = (body: unknown, auth: string | null = `Bearer ${KEY}`, init: RequestInit = {}) =>
  new Request(URL, { method: "POST", headers: { ...(auth ? { Authorization: auth } : {}), "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init });

describe("the key", () => {
  test("no key, a bearer that is not mak_, a short or padded key: 401 with no detail, no database call", async () => {
    for (const auth of [null, "Bearer ", `Bearer ${KEY.slice(0, -1)}`, `Bearer ${KEY}x`, `Bearer eyJhbGciOiJIUzI1NiJ9.e30.x`, KEY, `bearer ${KEY}`, `Bearer ${KEY.replace("mak_", "mak-")}`]) {
      const k = kit();
      const res = await k.door(post({ op: "chase", body: { taskId: "t1" } }, auth));
      expect(res.status).toBe(401);
      const body = await res.text();
      expect(body).toBe('{"ok":false}');
      expect(k.calls).toHaveLength(0);
      expect(k.health).toHaveLength(0);
    }
  });

  test("the database gets the key's sha256 hex, never the key; the answer never echoes either", async () => {
    const k = kit();
    const res = await k.door(post({ op: "chase", body: { taskId: "t1", step: "D+3" }, requestId: RID }));
    expect(res.status).toBe(200);
    const want = createHash("sha256").update(KEY).digest("hex");
    expect(k.calls).toEqual([{ name: "cockpit_billing_agent_write", args: { p_key_sha256: want, p_op: "chase", p_body: { taskId: "t1", step: "D+3" }, p_request_id: RID } }]);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(want);
    expect(JSON.parse(text)).toEqual({ ok: true, outcome: "ok", result: { eventId: 7 }, requestId: RID });
    expect(JSON.stringify(k.health)).not.toContain(want);
  });

  test("an unknown or revoked key is the database's sentence, with 401", async () => {
    const k = kit(() => ({ ok: false, outcome: "refused", status: 401, error: "This key was revoked." }));
    const res = await k.door(post({ what: "ladder" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, outcome: "refused", error: "This key was revoked.", requestId: "00000000-0000-4000-8000-000000000001" });
  });
});

describe("unknown keys cost little (the door is public)", () => {
  const UNKNOWN = { ok: false, outcome: "refused", status: 401, error: "This key is not known." };
  const keyN = (n: number) => `mak_${String(n).padStart(43, "k")}`;

  test("an unknown key gets the database's sentence and writes no receipt; asked again within a minute, no database call", async () => {
    const k = kit(() => UNKNOWN);
    const res = await k.door(post({ what: "ladder" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("This key is not known.");
    expect(k.calls).toHaveLength(1);
    expect(k.health).toHaveLength(0);
    const again = await k.door(post({ what: "ladder" }));
    expect(again.status).toBe(401);
    expect(k.calls).toHaveLength(1);
    expect(k.health).toHaveLength(0);
  });

  test("a flood of new unknown keys is answered 429 before the database; a key seen working still gets in", async () => {
    let t = 1_000_000;
    const calls: string[] = [];
    const health: HealthRow[] = [];
    const good = `Bearer ${KEY}`;
    const door = makeAgentDoor({
      rpc: async (_name, args) => {
        calls.push(String(args.p_key_sha256));
        return args.p_key_sha256 === createHash("sha256").update(KEY).digest("hex")
          ? { ok: true, outcome: "ok", status: 200, result: {} }
          : UNKNOWN;
      },
      insertHealth: async row => {
        health.push(row);
      },
      sha256Hex,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      now: () => t,
    });
    expect((await door(post({ what: "ladder" }, good))).status).toBe(200);
    for (let i = 0; i < UNKNOWN_PER_MINUTE; i++) expect((await door(post({ what: "ladder" }, `Bearer ${keyN(i)}`))).status).toBe(401);
    const before = calls.length;
    const flooded = await door(post({ what: "ladder" }, `Bearer ${keyN(999)}`));
    expect(flooded.status).toBe(429);
    expect(calls.length).toBe(before);
    expect((await door(post({ what: "ladder" }, good))).status).toBe(200);
    expect(health.map(h => h.http_status)).toEqual([200, 200]);
    t += 61_000;
    expect((await door(post({ what: "ladder" }, `Bearer ${keyN(999)}`))).status).toBe(401);
  });

  test("a body over 32 KB with no Content-Length is refused without reading it all", async () => {
    const k = kit();
    const big = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const req = new Request(URL, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: big, duplex: "half" } as RequestInit);
    const res = await k.door(req);
    expect(res.status).toBe(413);
    expect(k.calls).toHaveLength(0);
  });
});

describe("the body", () => {
  test("a write and a read, strictly; a request id is a UUID or one is made", () => {
    const id = () => "00000000-0000-4000-8000-000000000009";
    expect(readCall({ op: "payment", body: { taskId: "t1" }, requestId: RID.toUpperCase() }, id)).toEqual({ kind: "write", op: "payment", body: { taskId: "t1" }, requestId: RID });
    expect(readCall({ what: "chases" }, id)).toEqual({ kind: "read", what: "chases", args: {}, requestId: "00000000-0000-4000-8000-000000000009" });
    expect(readCall({ op: "chase", what: "ladder" }, id)).toBe(SEND);
    expect(readCall({ op: "chase", agent: "someone" }, id)).toBe(SEND);
    expect(readCall({ op: "Chase!" }, id)).toBe(SEND);
    expect(readCall({ op: "chase", body: [] }, id)).toBe("Send the body as an object.");
    expect(readCall({ what: "ladder", requestId: "not-a-uuid" }, id)).toBe("Send requestId as a UUID, or leave it out.");
    expect(readCall([], id)).toBe(SEND);
  });

  test("a read carries its request id to the database inside args", async () => {
    const k = kit(() => ({ ok: true, outcome: "ok", status: 200, result: { pauseReviewDay: 4, cancelReviewDay: 15 } }));
    await k.door(post({ what: "ladder", requestId: RID }));
    expect(k.calls[0]).toMatchObject({ name: "cockpit_billing_agent_read", args: { p_what: "ladder", p_args: { requestId: RID } } });
  });

  test("not POST is 405; over 32 KB is 413; not JSON or neither op nor read is 400 with the sentence", async () => {
    const k = kit();
    expect((await k.door(new Request(URL, { method: "GET", headers: { Authorization: `Bearer ${KEY}` } }))).status).toBe(405);
    const big = await k.door(post({ op: "note", body: { taskId: "t1", text: "x".repeat(MAX_BODY) } }));
    expect(big.status).toBe(413);
    const bad = await k.door(post("{not json"));
    expect([bad.status, (await bad.json()).error]).toEqual([400, SEND]);
    expect((await k.door(post({ hello: 1 }))).status).toBe(400);
    expect(k.calls).toHaveLength(0);
  });
});

describe("answers and receipts", () => {
  test("refused 422, limited 429, a duplicate with its first call; one receipt per call as billing-agent:<op>", async () => {
    const answers = [
      { ok: false, outcome: "refused", status: 422, error: "A bank transfer needs its receipt link and the bank reference. Without them it counts as unpaid." },
      { ok: false, outcome: "limited", status: 429, error: "That is 60 calls in a minute. Wait a minute and try again." },
      { ok: true, outcome: "duplicate", status: 200, result: { eventId: 7 }, firstCallId: 41 },
    ];
    const k = kit(() => answers.shift());
    const r1 = await k.door(post({ op: "payment", body: { taskId: "t1" }, requestId: RID }));
    expect([r1.status, (await r1.json()).error]).toEqual([422, "A bank transfer needs its receipt link and the bank reference. Without them it counts as unpaid."]);
    const r2 = await k.door(post({ what: "inbox" }));
    expect(r2.status).toBe(429);
    const r3 = await k.door(post({ op: "chase", body: { taskId: "t1" }, requestId: RID }));
    expect(await r3.json()).toEqual({ ok: true, outcome: "duplicate", result: { eventId: 7 }, firstCallId: 41, requestId: RID });
    expect(k.health.map(h => [h.resource, h.http_status, h.provider, h.run_key])).toEqual([
      ["billing-agent:payment", 422, "billing-agent", RID],
      ["billing-agent:read:inbox", 429, "billing-agent", "00000000-0000-4000-8000-000000000001"],
      ["billing-agent:chase", 200, "billing-agent", RID],
    ]);
  });

  test("a database failure is 502 with a plain sentence, never the database's own words", async () => {
    const k = kit(() => {
      throw new Error("permission denied for function cockpit_billing_agent_write; key=service_role_secret");
    });
    const res = await k.door(post({ op: "chase", body: { taskId: "t1" } }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("service_role_secret");
    expect(JSON.parse(text).error).toBe("The cockpit did not answer. Try again later with the same requestId.");
    expect(k.health[0].http_status).toBe(502);
  });

  test("a lost receipt never hides the answer", async () => {
    const door = makeAgentDoor({
      rpc: async () => ({ ok: true, outcome: "ok", status: 200, result: { eventId: 1 } }),
      insertHealth: async () => {
        throw new Error("ledger down");
      },
      sha256Hex,
      uuid: () => RID,
    });
    expect((await door(post({ op: "note", body: { taskId: "t1", text: "hi" } }))).status).toBe(200);
  });

  test("the function logs nothing: no console call in the door or the entry", () => {
    for (const f of ["./door.ts", "./index.ts"]) {
      const src = readFileSync(new globalThis.URL(f, import.meta.url), "utf8");
      expect(/console\.(log|info|warn|error|debug)/.test(src)).toBe(false);
    }
  });
});
