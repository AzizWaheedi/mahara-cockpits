import { describe, expect, test } from "bun:test";
import { CLICKUP_BUSY, CLICKUP_BUSY_LANDED } from "../_shared/clickupRetry";
import { executeCsm } from "./core";
import { providerTools } from "./tools";

// One more try after ClickUp's 429, only when a caller a person is waiting on
// asks for it (docs/requests/CLICKUP-DOWNGRADE.md 2.1-2.2). Every try has its
// own intent and response rows.

const NOW = Date.parse("2026-10-29T09:00:00Z");
const TOKEN = "pk_fixture_never_printed";
const OLD = "ClickUp rejected the request (429); inspect its receipt.";
type Row = Record<string, unknown>;
type Sent = { url: string; method: string; body: unknown };
const limited = (headers: Record<string, string> = { "Retry-After": "2" }) =>
  new Response(
    JSON.stringify({ err: "Rate limit reached", ECODE: "APP_002" }),
    {
      status: 429,
      headers,
    },
  );

function rig(answers: (() => Response)[], opts: { retry?: boolean } = {}) {
  const sent: Sent[] = [];
  const rows: Row[] = [];
  const slept: number[] = [];
  let clock = NOW;
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    sent.push({
      url: String(input),
      method: String(init?.method),
      body: init?.body,
    });
    const next = answers[sent.length - 1];
    if (!next) throw new Error("No scripted answer left");
    return next();
  }) as typeof fetch;
  const tools = providerTools(
    TOKEN,
    async row => {
      rows.push(row);
    },
    request,
    opts.retry
      ? {
          retry429: true,
          now: () => clock,
          sleep: async ms => {
            slept.push(ms);
            clock += ms;
          },
        }
      : undefined,
  );
  return { tools, sent, rows, slept };
}

describe("ClickUp's 429 with retry429", () => {
  test("429 then 200: one wait as ClickUp asks, the same POST twice, a pair of rows per try", async () => {
    const r = rig(
      [
        () => limited(),
        () => new Response(JSON.stringify({ id: "t-9" }), { status: 200 }),
      ],
      { retry: true },
    );
    const body = { name: "Pause the ads", description: "From the cockpit" };
    await expect(
      r.tools.call("POST", "list/901816723196/task", body),
    ).resolves.toEqual({ id: "t-9" });
    expect(r.slept).toEqual([2_000]);
    expect(r.sent.length).toBe(2);
    expect(r.sent[0]).toEqual(r.sent[1]);
    expect(r.sent[0]).toMatchObject({
      url: "https://api.clickup.com/api/v2/list/901816723196/task",
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(r.rows.map(x => [x.phase, x.http_status ?? null])).toEqual([
      ["intent", null],
      ["response", 429],
      ["intent", null],
      ["response", 200],
    ]);
    expect(r.rows.at(-1)?.object_id).toBe("t-9");
    expect(JSON.stringify(r.rows)).not.toContain(TOKEN);
  });

  test("429 twice throws the old sentence with CLICKUP_BUSY after exactly two calls", async () => {
    const r = rig([() => limited(), () => limited()], { retry: true });
    const error = await r.tools
      .call("POST", "task/abc/comment", { comment_text: "x" })
      .catch((e: Error) => e);
    expect((error as Error).message).toBe(`${OLD} ${CLICKUP_BUSY}`);
    expect(
      /rejected the request \((\d{3})\)/.exec((error as Error).message)?.[1],
    ).toBe("429");
    expect(r.sent.length).toBe(2);
    expect(r.slept.length).toBe(1);
    expect(r.rows.map(x => x.phase)).toEqual([
      "intent",
      "response",
      "intent",
      "response",
    ]);
  });

  test("a 500 is not retried", async () => {
    const r = rig([() => new Response('{"err":"x"}', { status: 500 })], {
      retry: true,
    });
    await expect(r.tools.call("GET", "task/abc")).rejects.toThrow(
      new Error("ClickUp rejected the request (500); inspect its receipt."),
    );
    expect(r.sent.length).toBe(1);
    expect(r.slept).toEqual([]);
  });

  test("a timeout and an unreadable 429 behave as before: no retry", async () => {
    const lost = rig([], { retry: true });
    await expect(lost.tools.call("GET", "task/abc")).rejects.toThrow(
      "ClickUp response is unknown. Reconcile this action before retrying.",
    );
    expect(lost.rows.map(x => x.phase)).toEqual(["intent", "unknown"]);
    const garbled = rig([() => new Response("<html>", { status: 429 })], {
      retry: true,
    });
    await expect(garbled.tools.call("GET", "task/abc")).rejects.toThrow(
      "ClickUp response could not be read. Reconcile before retrying.",
    );
    expect(garbled.sent.length).toBe(1);
  });
});

describe("without retry429", () => {
  test("a 429 throws today's exact sentence after one call", async () => {
    const r = rig([() => limited(), () => new Response("{}")]);
    await expect(
      r.tools.call("POST", "task/abc/comment", { comment_text: "x" }),
    ).rejects.toThrow(new Error(OLD));
    expect(r.sent.length).toBe(1);
    expect(r.slept).toEqual([]);
  });
});

describe("a second 429 speaks for its own step (one press makes several calls)", () => {
  const ok = (body: Row) => () =>
    new Response(JSON.stringify(body), { status: 200 });

  test("the press's first write refused twice: the step is named, no claim about the rest, no promise", async () => {
    const r = rig([() => limited(), () => limited()], { retry: true });
    const message = await r.tools
      .call("POST", "task/86abc/field/f-1", { value: "x" })
      .catch((e: Error) => e.message);
    expect(message).toBe(`${OLD} ${CLICKUP_BUSY}`);
    expect(message).not.toContain(CLICKUP_BUSY_LANDED);
    expect(message).not.toMatch(/nothing was changed/i);
  });

  test("a write that went through, then a later write refused twice: it says to check what changed", async () => {
    const r = rig(
      [
        ok({ id: "86abc" }),
        ok({ id: "86abc" }),
        () => limited(),
        () => limited(),
      ],
      { retry: true },
    );
    await r.tools.call("POST", "task/86abc/field/f-1", { value: "x" });
    await r.tools.call("GET", "task/86abc");
    const message = await r.tools
      .call("POST", "task/86abc/comment", { comment_text: "y" })
      .catch((e: Error) => e.message);
    expect(message).toBe(`${OLD} ${CLICKUP_BUSY} ${CLICKUP_BUSY_LANDED}`);
    expect(message).not.toMatch(/nothing was changed/i);
  });

  test("reads alone never count as a change", async () => {
    const r = rig([ok({ id: "86abc" }), () => limited(), () => limited()], {
      retry: true,
    });
    await r.tools.call("GET", "task/86abc");
    const message = await r.tools
      .call("GET", "task/86abc/comment")
      .catch((e: Error) => e.message);
    expect(message).toBe(`${OLD} ${CLICKUP_BUSY}`);
  });

  test("executeCsm: the client field lands, the comment is refused twice, and the press never hears nothing changed", async () => {
    const FIELD = "e183f2ce-8b7a-491a-b160-2287a247758b";
    const r = rig(
      [
        ok({}),
        ok({
          id: "86abc",
          custom_fields: [{ id: FIELD, value: "2026-11-02" }],
        }),
        () => limited(),
        () => limited(),
      ],
      { retry: true },
    );
    const plan = {
      operation: "act",
      context: {
        taskId: "86abc",
        clientName: "Test Client",
        evidence: "No touchpoint in 14 days",
      },
      updates: [{ field: FIELD, value: "2026-11-02" }],
      ticket: null,
      args: { kind: "touchpoint" },
      patch: {},
    } as unknown as Parameters<typeof executeCsm>[0];
    const message = await executeCsm(plan, r.tools).catch(
      (e: Error) => e.message,
    );
    expect(
      r.sent.map(
        x =>
          `${x.method} ${x.url.replace("https://api.clickup.com/api/v2/", "")}`,
      ),
    ).toEqual([
      `POST task/86abc/field/${FIELD}`,
      "GET task/86abc",
      "POST task/86abc/comment",
      "POST task/86abc/comment",
    ]);
    expect(message).toContain("(429)");
    expect(message).toContain(CLICKUP_BUSY_LANDED);
    expect(message).not.toMatch(/nothing was changed/i);
    expect(message).not.toContain("Try again in a minute");
  });
});
