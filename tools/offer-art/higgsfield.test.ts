import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Ctx,
  call,
  counted,
  draw,
  extOf,
  type Job,
  type LedgerRow,
  NoCredits,
  plan,
  Refused,
  readEnvValue,
  readKey,
  refusal,
  USER_AGENT,
} from "./higgsfield";
import { loadPrompts } from "./set";

const SECRET = "id-123:secret-456";
const key = { value: SECRET, from: "HF_KEY" };

type Seen = { url: string; init: RequestInit };
function ctxWith(
  answers: Array<(url: string) => Response>,
  opts: { ledgerFails?: boolean } = {},
) {
  const seen: Seen[] = [];
  const rows: LedgerRow[] = [];
  let t = 0;
  const ctx: Ctx = {
    key,
    fetch: async (url, init) => {
      seen.push({ url, init: init ?? {} });
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      return next(url);
    },
    ledger: row => {
      if (opts.ledgerFails) throw new Error("disk full");
      rows.push(row);
    },
    sleep: async () => {
      t += 4000;
    },
    now: () => 1_000_000 + t,
  };
  return { ctx, seen, rows };
}
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const png = () => {
  const b = new Uint8Array(20_000);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  return new Response(b, { status: 200, headers: { "content-type": "image/png" } });
};

describe("keys, by name only", () => {
  const dir = mkdtempSync(join(tmpdir(), "offer-art-"));
  const hf = join(dir, "hf.env");
  const pair = join(dir, "pair.env");
  writeFileSync(hf, "OTHER=1\nHF_KEY='abc:def'\n");
  writeFileSync(pair, "HIGGSFIELD_ID=the-id\nHIGGSFIELD_SECRET=\"the-secret\"\n");

  test("reads HF_KEY from the environment first, then its file", () => {
    expect(readKey("hf", { HF_KEY: " env:key " }, { hf, pair })).toEqual({
      value: "env:key",
      from: "HF_KEY",
    });
    expect(readKey("hf", {}, { hf, pair })).toEqual({
      value: "abc:def",
      from: "HF_KEY",
    });
  });

  test("joins the id and secret pair, and names both", () => {
    const k = readKey("pair", {}, { hf, pair });
    expect(k?.value).toBe("the-id:the-secret");
    expect(k?.from).toBe("HIGGSFIELD_ID and HIGGSFIELD_SECRET");
  });

  test("a missing file or name is no key, not a crash", () => {
    expect(readKey("hf", {}, { hf: join(dir, "nope"), pair })).toBeNull();
    expect(readEnvValue(join(dir, "nope"), "HF_KEY")).toBe("");
    expect(readKey("pair", { HIGGSFIELD_ID: "x" }, { hf, pair: join(dir, "nope") })).toBeNull();
  });
});

describe("every call", () => {
  test("writes an intent row before it leaves, then the response, host only", async () => {
    const { ctx, rows, seen } = ctxWith([() => jsonRes(200, { ok: 1 })]);
    await call(ctx, "models", "GET", "https://api.higgsfield.ai/models?size=1");
    expect(rows.map(r => r.phase)).toEqual(["intent", "response"]);
    expect(rows[0].resource).toBe("models:api.higgsfield.ai");
    expect(rows[1].http_status).toBe(200);
    expect(JSON.stringify(rows)).not.toContain("size=1");
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(seen).toHaveLength(1);
  });

  test("a ledger that cannot be written stops the call before it leaves", async () => {
    const { ctx, seen } = ctxWith([() => jsonRes(200, {})], { ledgerFails: true });
    await expect(
      call(ctx, "models", "GET", "https://api.higgsfield.ai/models"),
    ).rejects.toThrow("disk full");
    expect(seen).toHaveLength(0);
  });

  test("a network failure is written as unknown", async () => {
    const { ctx, rows } = ctxWith([]);
    await expect(
      call(ctx, "models", "GET", "https://api.higgsfield.ai/models"),
    ).rejects.toThrow();
    expect(rows.map(r => r.phase)).toEqual(["intent", "unknown"]);
  });

  test("the key goes to Higgsfield only, never to the picture's host", async () => {
    const { ctx, seen } = ctxWith([
      () => jsonRes(200, {}),
      () => png(),
    ]);
    await call(ctx, "status", "GET", "https://platform.higgsfield.ai/requests/x/status");
    await call(ctx, "download", "GET", "https://cdn.example.net/x.png");
    const h0 = seen[0].init.headers as Record<string, string>;
    const h1 = seen[1].init.headers as Record<string, string>;
    expect(h0.Authorization).toBe(`Key ${SECRET}`);
    expect(h0["User-Agent"]).toBe(USER_AGENT);
    expect(h1.Authorization).toBeUndefined();
  });

  test("plain https only, and only downloads may leave Higgsfield", async () => {
    const { ctx, seen } = ctxWith([]);
    await expect(call(ctx, "draw", "POST", "http://api.higgsfield.ai/x")).rejects.toBeInstanceOf(Refused);
    await expect(call(ctx, "draw", "POST", "https://api.higgsfield.ai:8443/x")).rejects.toBeInstanceOf(Refused);
    await expect(call(ctx, "draw", "POST", "https://evil.example/x")).rejects.toBeInstanceOf(Refused);
    await expect(call(ctx, "status", "GET", "https://higgsfield.ai.evil.example/x")).rejects.toBeInstanceOf(Refused);
    expect(seen).toHaveLength(0);
  });
});

describe("drawing one picture", () => {
  const body = { prompt: "p", resolution: "2k" };

  test("submits, waits, downloads, and reports the request id at once", async () => {
    const accepted: string[] = [];
    const { ctx, seen } = ctxWith([
      () => jsonRes(200, { request_id: "r1", status_url: "https://platform.higgsfield.ai/requests/r1/status" }),
      () => jsonRes(200, { status: "in_progress" }),
      () => jsonRes(200, { status: "completed", images: [{ url: "https://cdn.example.net/r1.png" }] }),
      () => png(),
    ]);
    const got = await draw(ctx, "marketing-studio/image/sunburst", body, id => accepted.push(id));
    expect(accepted).toEqual(["r1"]);
    expect(got.requestId).toBe("r1");
    expect(got.bytes.length).toBe(20_000);
    expect(seen[0].url).toBe("https://api.higgsfield.ai/marketing-studio/image/sunburst");
    expect(JSON.parse(String(seen[0].init.body))).toEqual(body);
  });

  test("an empty wallet at submit is a NoCredits with a plain sentence", async () => {
    const { ctx } = ctxWith([() => jsonRes(403, { detail: "not_enough_credits" })]);
    const e = await draw(ctx, "m", body, () => {}).catch(x => x);
    expect(e).toBeInstanceOf(NoCredits);
    expect(e.message).toContain("open.higgsfield.ai/billing");
    expect(e.message).toContain("HF_KEY");
    expect(e.message).not.toContain(SECRET);
  });

  test("an empty wallet after submit (the failed status) is a NoCredits too", async () => {
    const { ctx } = ctxWith([
      () => jsonRes(200, { request_id: "r2" }),
      () => jsonRes(200, { status: "failed", error: "Your credit balance is too low to complete this request." }),
    ]);
    await expect(draw(ctx, "m", body, () => {})).rejects.toBeInstanceOf(NoCredits);
  });

  test("a refused key and the safety check say what to do", async () => {
    const a = ctxWith([() => jsonRes(401, { detail: "Unauthorized" })]);
    await expect(draw(a.ctx, "m", body, () => {})).rejects.toThrow("open.higgsfield.ai/api-keys");
    const b = ctxWith([() => jsonRes(200, { request_id: "r3" }), () => jsonRes(200, { status: "nsfw" })]);
    await expect(draw(b.ctx, "m", body, () => {})).rejects.toThrow("safety check");
  });

  test("a tiny file is refused as empty", async () => {
    const { ctx } = ctxWith([
      () => jsonRes(200, { request_id: "r4" }),
      () => jsonRes(200, { status: "completed", images: [{ url: "https://cdn.example.net/r4.png" }] }),
      () => new Response(new Uint8Array(500)),
    ]);
    await expect(draw(ctx, "m", body, () => {})).rejects.toThrow("empty file");
  });

  test("a wait past eight minutes cancels and says so", async () => {
    const answers = [() => jsonRes(200, { request_id: "r5", cancel_url: "https://api.higgsfield.ai/requests/r5/cancel" })];
    for (let i = 0; i < 200; i++) answers.push(() => jsonRes(200, { status: "queued" }));
    const { ctx, seen } = ctxWith(answers);
    await expect(draw(ctx, "m", body, () => {})).rejects.toThrow("longer than 8 minutes");
    expect(seen.at(-1)?.url).toBe("https://api.higgsfield.ai/requests/r5/cancel");
  });

  test("refusal() reads both shapes of Higgsfield's no", () => {
    expect(refusal(key, 403, { detail: "not_enough_credits" })).toBeInstanceOf(NoCredits);
    expect(refusal(key, 422, { detail: "bad prompt" }).message).toContain("bad prompt");
  });
});

describe("the cap", () => {
  const set = loadPrompts();
  const job = (variant: string, status: Job["status"], requestId: string | null = "r"): Job => ({
    variant,
    slot: "hero",
    model: "m",
    key: "HF_KEY",
    promptSha: "x",
    requestId,
    status,
    at: "2026-10-26T00:00:00Z",
  });

  test("counts every accepted request, not those refused for an empty wallet", () => {
    expect(
      counted([
        job("hero-a", "completed"),
        job("hero-b", "failed"),
        job("hero-c", "no_credits"),
        job("stone-a", "submitting", null),
      ]),
    ).toBe(2);
  });

  test("skips what is drawn, and refuses a run past the cap", () => {
    const p = plan(set, [job("hero-a", "completed")], ["hero-a", "hero-b"], false);
    expect(p).toEqual({ run: ["hero-b"] });
    const many = Array.from({ length: 11 }, (_, i) => job(`x-${i}`, "failed"));
    const q = plan(set, many, ["hero-a", "hero-b"], false);
    expect("refuse" in q && q.refuse).toContain("cap of 12");
    expect(plan(set, [], ["nope-a"], false)).toEqual({ refuse: "No such variant: nope-a." });
  });
});

test("extOf reads the bytes before the header", () => {
  expect(extOf(new Uint8Array([0x89, 0x50, 0, 0]))).toBe("png");
  expect(extOf(new Uint8Array([0xff, 0xd8, 0, 0]))).toBe("jpg");
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  expect(extOf(webp)).toBe("webp");
  expect(extOf(new Uint8Array([1, 2]), "image/jpeg")).toBe("jpg");
});
