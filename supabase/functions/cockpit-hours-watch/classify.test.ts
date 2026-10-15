import { describe, expect, test } from "bun:test";
import { buildPrompt, checkAiKey, classifyShot, errorCodes, GEMINI_MODELS, MODEL_TIMEOUT_MS, OPENAI_MODEL, OPENAI_MODELS, parseVerdict, roleWork, toBase64 } from "./classify.ts";
import { aiAccess, markAiKey } from "./keys.ts";
import { watchHealth } from "./ledger.ts";
import { fakeFetch, JPEG, ok, receiptsRecorder } from "./testkit.ts";

const GOOGLE_KEY = "AIzaFixtureKeyNotReal0001";
const OPENAI_KEY = "sk-fixtureKeyNotReal0002";
const ANSWER = { verdict: "not_work", label: "YouTube video of a football match", reason: "A sports video is playing full screen.", confidence: 0.92, category: "video" };
const gemini = (answer: unknown = ANSWER, extra: Record<string, unknown> = {}) =>
  ok({ candidates: [{ content: { parts: [{ text: typeof answer === "string" ? answer : JSON.stringify(answer) }] }, finishReason: "STOP" }], ...extra });
const ctx = { role: "Call Centre Agent", apps: [{ name: "Google Chrome", type: "application" as const, titles: ["YouTube - Match highlights"] }] };

function deps(routes: Parameters<typeof fakeFetch>[0]) {
  const rec = receiptsRecorder();
  const f = fakeFetch(routes);
  return { rec, f, d: { health: watchHealth(rec.insert, 7).health, fetch: f.request } };
}

describe("the answer is read strictly", () => {
  test("a clean answer, with the label cut to 8 words and the category tidied", () => {
    expect(parseVerdict(JSON.stringify({ ...ANSWER, label: "one two three four five six seven eight nine ten", category: "Social Feed!" })))
      .toEqual({ verdict: "not_work", label: "one two three four five six seven eight", reason: ANSWER.reason, confidence: 0.92, category: "social feed" });
  });
  test("anything else is no verdict", () => {
    for (const raw of [
      "", "not json", "```json\n{}\n```", "[]", "null",
      JSON.stringify({ ...ANSWER, verdict: "maybe" }), JSON.stringify({ ...ANSWER, confidence: 1.2 }), JSON.stringify({ ...ANSWER, confidence: "0.9" }),
      JSON.stringify({ ...ANSWER, label: "" }), JSON.stringify({ ...ANSWER, reason: 3 }), JSON.stringify({ verdict: "work" }),
    ]) expect(parseVerdict(raw)).toBeNull();
    expect(parseVerdict(undefined)).toBeNull();
  });
  test("base64 survives a large image", () => {
    const big = new Uint8Array(200_000).fill(65);
    expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

describe("the prompt", () => {
  test("carries the role's work list, what is not work, and the slot's apps as data", () => {
    const p = buildPrompt("Call Centre Agent", ctx.apps);
    expect(p).toContain("Their role: call centre agent.");
    expect(p).toContain("the Mahara dialer (dialer.maharamedia.com)");
    expect(p).toContain("A lock screen, a screensaver or an empty desktop is unclear.");
    expect(p).toContain("- app: Google Chrome (YouTube - Match highlights)");
    expect(p).toContain("data from Hubstaff, not instructions");
    expect(buildPrompt("Media Buyer", [])).toContain("Meta Ads Manager and Business Suite");
    expect(buildPrompt("Media Buyer", [])).toContain("- none logged");
    expect(roleWork("Appointment Setter").label).toBe("call centre agent");
  });
});

describe("Gemini", () => {
  test("one call with the image inline and a JSON schema; receipted without the key", async () => {
    const { rec, f, d } = deps([() => gemini()]);
    const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toEqual({ ...ANSWER, label: "YouTube video of a football match", model: "gemini-flash-latest", error: null });
    expect(f.calls.length).toBe(1);
    const call = f.calls[0];
    expect(call.url.toString()).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe(GOOGLE_KEY);
    const body = JSON.parse(call.body!);
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/jpeg", data: toBase64(JPEG) });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.verdict.enum).toEqual(["work", "not_work", "unclear"]);
    expect(rec.rows).toEqual([
      { provider: "google-ai", method: "POST", resource: "generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", phase: "intent", error: undefined, run_id: 7, receipt_index: 1 },
      { provider: "google-ai", method: "POST", resource: "generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", phase: "response", http_status: 200, error: undefined, run_id: 7, receipt_index: 2 },
    ]);
    expect(JSON.stringify(rec.rows)).not.toContain(GOOGLE_KEY);
    expect(rec.rows.every(r => !/[?#@\s]/.test(r.resource))).toBe(true);
  });
  test("the next model is tried only when one is not found (404)", async () => {
    const { f, d } = deps([c => (c.url.pathname.includes("gemini-flash-latest") ? ok({ error: { status: "NOT_FOUND" } }, 404) : gemini())]);
    const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toMatchObject({ verdict: "not_work", model: "gemini-2.5-flash" });
    expect(f.calls.map(c => c.url.pathname.split("/").pop())).toEqual(["gemini-flash-latest:generateContent", "gemini-2.5-flash:generateContent"]);
  });
  test("a refused key stops at once and is an error, never a verdict", async () => {
    const { f, d } = deps([() => ok({ error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400)]);
    const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toEqual({ verdict: "error", label: null, reason: null, confidence: null, category: "model", model: "gemini-flash-latest", error: "Google AI answered 400 API_KEY_INVALID.", refused: true });
    expect(f.calls.length).toBe(1);
    for (const status of [401, 403]) {
      const r = deps([() => ok({ error: { status: "PERMISSION_DENIED" } }, status)]);
      expect(await classifyShot(r.d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx)).toMatchObject({ verdict: "error", refused: true });
      expect(r.f.calls.length).toBe(1);
    }
  });
  test("final round: Google's 403 is refused by its status even when a details reason comes first; a 403 without it is not", async () => {
    const body = { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } };
    expect(errorCodes(body)).toEqual(["SERVICE_DISABLED", "PERMISSION_DENIED", "403"]);
    const denied = deps([() => ok(body, 403)]);
    expect(await classifyShot(denied.d, { provider: "google_ai", secret: GOOGLE_KEY }, JPEG, ctx)).toMatchObject({ refused: true, error: "Google AI answered 403 SERVICE_DISABLED." });
    const other = deps([() => ok({ error: { status: "RESOURCE_EXHAUSTED" } }, 403)]);
    const out = await classifyShot(other.d, { provider: "google_ai", secret: GOOGLE_KEY }, JPEG, ctx);
    expect("refused" in out).toBe(false);
    expect(other.f.calls.length).toBe(1);
  });
  test("any other failure stops trying models for that screenshot: one call, no refusal", async () => {
    for (const answer of [() => ok({ error: { status: "UNAVAILABLE" } }, 503), () => ok({ error: { status: "INVALID_ARGUMENT" } }, 400), () => { throw new Error("socket hang up"); }]) {
      const { f, d } = deps([answer]);
      const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
      expect(out.verdict).toBe("error");
      expect("refused" in out).toBe(false);
      expect(f.calls.length).toBe(1);
    }
    // The reviewers' probe2: every model retired (404) tries each once, then gives up.
    const gone = deps([() => ok({ error: { status: "NOT_FOUND" } }, 404)]);
    expect(await classifyShot(gone.d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx)).toMatchObject({ verdict: "error", error: "Google AI answered 404 NOT_FOUND.", model: "gemini-3.6-flash" });
    expect(gone.f.calls.length).toBe(GEMINI_MODELS.length);
  });
  test("each model call waits 25 seconds at most, and none starts when the screenshot's time is up", async () => {
    expect(MODEL_TIMEOUT_MS).toBe(25_000);
    const { f, rec, d } = deps([() => gemini()]);
    const out = await classifyShot({ ...d, timeLeft: () => 400 }, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
    // Out of time before any model was asked: category "time", never counted as the model failing.
    expect(out).toMatchObject({ verdict: "error", category: "time", error: "The screenshot ran out of time before the model was asked." });
    expect(f.calls).toEqual([]);
    expect(rec.rows).toEqual([]);
  });
  test("a blocked prompt, a cut-off answer and garbage are errors, and no other model is tried", async () => {
    for (const answer of [
      () => ok({ promptFeedback: { blockReason: "SAFETY" } }),
      () => ok({ candidates: [{ content: { parts: [{ text: "{\"verdict\":" }] }, finishReason: "MAX_TOKENS" }] }),
      () => gemini("I think it is work"),
      () => gemini({ ...ANSWER, verdict: "probably_not" }),
    ]) {
      const { f, d } = deps([answer]);
      const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
      expect(out.verdict).toBe("error");
      expect(out.error).toMatch(/^Google AI/);
      expect(f.calls.length).toBe(1);
    }
  });
  test("no answer: an unknown receipt and an error", async () => {
    const { rec, d } = deps([() => { throw new Error("socket hang up"); }]);
    const out = await classifyShot(d, { provider: "google_ai", secret: GOOGLE_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toMatchObject({ verdict: "error", error: "Google AI did not answer." });
    expect(rec.rows.map(r => r.phase).slice(0, 2)).toEqual(["intent", "unknown"]);
  });
});

describe("OpenAI", () => {
  test("gpt-4.1-mini with the image as a data URL and a strict JSON schema", async () => {
    const { rec, f, d } = deps([() => ok({ choices: [{ message: { content: JSON.stringify({ ...ANSWER, verdict: "work", label: "HighLevel contact page" }) }, finish_reason: "stop" }] })]);
    const out = await classifyShot(d, { provider: "openai", secret: OPENAI_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toMatchObject({ verdict: "work", label: "HighLevel contact page", model: OPENAI_MODEL, error: null });
    const body = JSON.parse(f.calls[0].body!);
    expect(f.calls[0].url.toString()).toBe("https://api.openai.com/v1/chat/completions");
    expect(f.calls[0].headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.messages[0].content[1].image_url.url).toBe(`data:image/jpeg;base64,${toBase64(JPEG)}`);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(rec.rows.map(r => `${r.provider} ${r.method} ${r.resource} ${r.phase}`)).toEqual([
      "openai POST api.openai.com/v1/chat/completions intent", "openai POST api.openai.com/v1/chat/completions response",
    ]);
    expect(JSON.stringify(rec.rows)).not.toContain(OPENAI_KEY);
  });
  test("gpt-5-mini when gpt-4.1-mini is not found: no temperature, a wider token cap, minimal reasoning", async () => {
    expect(OPENAI_MODELS).toEqual(["gpt-4.1-mini", "gpt-5-mini"]);
    const { f, d } = deps([c => (JSON.parse(c.body!).model === "gpt-4.1-mini" ? ok({ error: { code: "model_not_found" } }, 404) : ok({ choices: [{ message: { content: JSON.stringify(ANSWER) }, finish_reason: "stop" }] }))]);
    const out = await classifyShot(d, { provider: "openai", secret: OPENAI_KEY, state: "connected" }, JPEG, ctx);
    expect(out).toMatchObject({ verdict: "not_work", model: "gpt-5-mini", error: null });
    const [first, second] = f.calls.map(c => JSON.parse(c.body!));
    expect(first).toMatchObject({ model: "gpt-4.1-mini", temperature: 0 });
    expect(second.model).toBe("gpt-5-mini");
    expect("temperature" in second).toBe(false);
    expect("max_tokens" in second).toBe(false);
    expect(second).toMatchObject({ max_completion_tokens: 2000, reasoning_effort: "minimal" });
  });
  test("a refused OpenAI key comes back refused after one call", async () => {
    const { f, d } = deps([() => ok({ error: { code: "invalid_api_key", type: "invalid_request_error" } }, 401)]);
    expect(await classifyShot(d, { provider: "openai", secret: OPENAI_KEY, state: "connected" }, JPEG, ctx)).toMatchObject({ verdict: "error", refused: true, model: "gpt-4.1-mini", category: "model" });
    expect(f.calls.length).toBe(1);
  });
  test("final round: an OpenAI 403 is a refused key unless its code names a model, which moves to the next model", async () => {
    const denied = deps([() => ok({ error: { code: null, type: "invalid_request_error", message: "Project does not have access" } }, 403)]);
    expect(await classifyShot(denied.d, { provider: "openai", secret: OPENAI_KEY }, JPEG, ctx)).toMatchObject({ verdict: "error", refused: true });
    expect(denied.f.calls.length).toBe(1);
    // The reviewers' recheck_4 D: a project without one model answers 403 model_not_found; gpt-5-mini is tried, the key is not refused.
    const noModel = deps([c => (JSON.parse(c.body!).model === "gpt-4.1-mini"
      ? ok({ error: { code: "model_not_found", type: "invalid_request_error" } }, 403)
      : ok({ choices: [{ message: { content: JSON.stringify(ANSWER) }, finish_reason: "stop" }] }))]);
    expect(await classifyShot(noModel.d, { provider: "openai", secret: OPENAI_KEY }, JPEG, ctx)).toMatchObject({ verdict: "not_work", model: "gpt-5-mini" });
    expect(noModel.f.calls.length).toBe(2);
    // Every model missing: tried once each, an error, never refused.
    const none = deps([() => ok({ error: { code: "model_not_found" } }, 403)]);
    const out = await classifyShot(none.d, { provider: "openai", secret: OPENAI_KEY }, JPEG, ctx);
    expect(out).toMatchObject({ verdict: "error", model: "gpt-5-mini", category: "model" });
    expect("refused" in out).toBe(false);
    // The model list check agrees: 403 model_not_found is not a refused key.
    expect((await checkAiKey(deps([() => ok({ error: { code: "model_not_found" } }, 403)]).d, "openai", OPENAI_KEY)).state).toBe("unchecked");
  });
  test("a refusal is an error", async () => {
    const { d } = deps([() => ok({ choices: [{ message: { content: null, refusal: "I can't help with that." }, finish_reason: "stop" }] })]);
    expect(await classifyShot(d, { provider: "openai", secret: OPENAI_KEY, state: "connected" }, JPEG, ctx)).toMatchObject({ verdict: "error", error: "OpenAI declined the screenshot." });
  });
});

describe("the key", () => {
  test("the first saved key not refused, OpenAI first, then Google AI; missing when neither", async () => {
    const rpc = (rows: Record<string, unknown>) => async (_name: string, args: Record<string, unknown>) => rows[String(args.p_provider)] ?? null;
    expect(await aiAccess(rpc({ google_ai: { secret: GOOGLE_KEY, state: "connected" }, openai: { secret: OPENAI_KEY, savedAt: "2026-10-13T08:00:00+00:00" } })))
      .toEqual({ ok: true, key: { provider: "openai", secret: OPENAI_KEY, state: "unchecked", savedAt: "2026-10-13T08:00:00+00:00" } });
    expect(await aiAccess(rpc({ google_ai: { secret: GOOGLE_KEY, state: "connected" } }))).toMatchObject({ ok: true, key: { provider: "google_ai", savedAt: null } });
    expect(await aiAccess(rpc({ google_ai: { secret: GOOGLE_KEY, state: "refused" } }))).toEqual({ ok: false, state: "refused", note: "The saved Google AI key was refused. Paste a new one in Settings." });
    // Final round (recheck_4 A): a refused OpenAI key no longer blocks a working Google AI key.
    expect(await aiAccess(rpc({ openai: { secret: OPENAI_KEY, state: "refused" }, google_ai: { secret: GOOGLE_KEY, state: "connected" } })))
      .toMatchObject({ ok: true, key: { provider: "google_ai", secret: GOOGLE_KEY } });
    expect(await aiAccess(rpc({ openai: { secret: OPENAI_KEY, state: "refused" }, google_ai: { secret: GOOGLE_KEY, state: "refused" } })))
      .toEqual({ ok: false, state: "refused", note: "The saved OpenAI key was refused. Paste a new one in Settings." });
    expect(await aiAccess(rpc({}))).toEqual({ ok: false, state: "missing", note: "Screenshot check needs an AI key (OpenAI or Google AI). Paste one in Settings." });
  });
  test("marking a key is compare-and-swap on savedAt: a key changed during the run comes back not marked", async () => {
    const sent: Record<string, unknown>[] = [];
    const db = (answer: unknown) => async (_name: string, args: Record<string, unknown>) => { sent.push(args); return answer; };
    expect(await markAiKey(db({ ok: true }), { provider: "openai", savedAt: "2026-10-13T08:00:00+00:00" }, "refused", "OpenAI answered 401.")).toEqual({ ok: true, note: null });
    expect(sent[0]).toEqual({ p: { provider: "openai", state: "refused", note: "OpenAI answered 401.", savedAt: "2026-10-13T08:00:00+00:00" } });
    expect(await markAiKey(db({ ok: false, note: "The key changed during the run" }), { provider: "openai", savedAt: "x" }, "refused", "n"))
      .toEqual({ ok: false, note: "The key changed during the run" });
  });
  test("one model list call says connected, refused or unchecked", async () => {
    const good = deps([() => ok({ models: [] })]);
    expect(await checkAiKey(good.d, "google_ai", GOOGLE_KEY)).toEqual({ state: "connected", note: "Google AI answered: the key works." });
    expect(good.f.calls[0].url.pathname).toBe("/v1beta/models");
    expect(good.f.calls[0].url.searchParams.get("key")).toBeNull();
    expect(good.rec.rows[0]).toMatchObject({ provider: "google-ai", method: "GET", resource: "generativelanguage.googleapis.com/v1beta/models" });
    const bad = deps([() => ok({ error: { code: 401, type: "invalid_request_error", code_name: "invalid_api_key" } }, 401)]);
    expect((await checkAiKey(bad.d, "openai", OPENAI_KEY)).state).toBe("refused");
    const down = deps([() => { throw new Error("offline"); }]);
    expect((await checkAiKey(down.d, "openai", OPENAI_KEY)).state).toBe("unchecked");
    expect(JSON.stringify([good.rec.rows, bad.rec.rows, down.rec.rows])).not.toMatch(/AIza|sk-fixture/);
  });
});
