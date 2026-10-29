import { describe, expect, test } from "bun:test";
import { CLICKUP_BUSY, CLICKUP_BUSY_LANDED } from "../_shared/clickupRetry";
import type { Row } from "./core";
import { providerTools } from "./tools";

// One more try after ClickUp's 429, only when a caller a person is waiting on
// asks for it (docs/requests/CLICKUP-DOWNGRADE.md 2.1-2.2). Meta, Slack and
// GoHighLevel never retry; every try has its own intent and response rows.

const NOW = Date.parse("2026-10-29T09:00:00Z");
const ENV: Record<string, string> = {
  CLICKUP_API_TOKEN: "pk_fixture_never_printed",
  META_SYSTEM_TOKEN: "meta-fixture",
  SLACK_BOT_TOKEN: "xoxb-fixture",
  GHL_MAHARA_PIT: "ghl-fixture",
};
type Sent = { url: string; method: string; body: unknown };
const limited = (headers: Record<string, string> = { "Retry-After": "2" }) =>
  new Response(
    JSON.stringify({ err: "Rate limit reached", ECODE: "APP_002" }),
    {
      status: 429,
      headers,
    },
  );
const ok = (body: Row) => new Response(JSON.stringify(body), { status: 200 });

/** A fetch that answers from a script, one answer per call, and records what was sent. */
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
    name => ENV[name],
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
    const r = rig([() => limited(), () => ok({ id: "c-1" })], { retry: true });
    const body = { comment_text: "Budget raised", notify_all: false };
    await expect(
      r.tools.call("clickup", "POST", "task/abc/comment", body),
    ).resolves.toEqual({ id: "c-1" });
    expect(r.slept).toEqual([2_000]);
    expect(r.sent.length).toBe(2);
    expect(r.sent[0]).toEqual(r.sent[1]);
    expect(r.sent[0]).toMatchObject({
      url: "https://api.clickup.com/api/v2/task/abc/comment",
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(r.rows.map(x => [x.phase, x.http_status ?? null])).toEqual([
      ["intent", null],
      ["response", 429],
      ["intent", null],
      ["response", 200],
    ]);
    expect(r.rows.every(x => x.resource === "task/abc/comment")).toBe(true);
    expect(JSON.stringify(r.rows)).not.toContain(ENV.CLICKUP_API_TOKEN);
  });

  test("the wait follows X-RateLimit-Reset when there is no Retry-After", async () => {
    const r = rig(
      [
        () => limited({ "X-RateLimit-Reset": String(NOW / 1000 + 3) }),
        () => ok({ tasks: [] }),
      ],
      { retry: true },
    );
    await r.tools.call("clickup", "GET", "list/1/task?page=0");
    expect(r.slept).toEqual([3_000]);
  });

  test("429 twice throws the old sentence with CLICKUP_BUSY after exactly two calls", async () => {
    const r = rig([() => limited(), () => limited()], { retry: true });
    const error = await r.tools
      .call("clickup", "POST", "task/abc/comment", { comment_text: "x" })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("clickup rejected the request (429)");
    expect(message).toContain("Rate limit reached");
    expect(message.endsWith(CLICKUP_BUSY)).toBe(true);
    expect(/rejected the request \((\d{3})\)/.exec(message)?.[1]).toBe("429");
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
    const r = rig(
      [() => new Response('{"err":"Server error"}', { status: 500 })],
      { retry: true },
    );
    await expect(r.tools.call("clickup", "GET", "task/abc")).rejects.toThrow(
      "clickup rejected the request (500): Server error",
    );
    expect(r.sent.length).toBe(1);
    expect(r.slept).toEqual([]);
  });

  test("a timeout and an unreadable 429 behave as before: no retry", async () => {
    const lost = rig([], { retry: true });
    await expect(lost.tools.call("clickup", "GET", "task/abc")).rejects.toThrow(
      "Provider response is unknown. Reconcile before retrying.",
    );
    expect(lost.rows.map(x => x.phase)).toEqual(["intent", "unknown"]);
    const garbled = rig([() => new Response("<html>", { status: 429 })], {
      retry: true,
    });
    await expect(
      garbled.tools.call("clickup", "GET", "task/abc"),
    ).rejects.toThrow("Provider returned an unreadable response.");
    expect(garbled.sent.length).toBe(1);
  });
});

describe("without retry429, and for other providers", () => {
  test("a ClickUp 429 throws today's exact sentence after one call", async () => {
    const r = rig([() => limited(), () => ok({})]);
    await expect(
      r.tools.call("clickup", "POST", "task/abc/comment", {
        comment_text: "x",
      }),
    ).rejects.toThrow(
      new Error("clickup rejected the request (429): Rate limit reached"),
    );
    expect(r.sent.length).toBe(1);
  });

  test("a Meta, Slack or GoHighLevel 429 is never retried, even with the option", async () => {
    const meta = rig(
      [
        () =>
          new Response(
            JSON.stringify({ error: { message: "Too many calls", code: 4 } }),
            { status: 429 },
          ),
      ],
      { retry: true },
    );
    await expect(
      meta.tools.call("meta", "POST", "act_1/campaigns", { name: "x" }),
    ).rejects.toThrow("meta rejected the request (429 code 4): Too many calls");
    expect(meta.sent.length).toBe(1);
    const slack = rig(
      [
        () =>
          new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
            status: 429,
          }),
      ],
      { retry: true },
    );
    await expect(
      slack.tools.call("slack", "POST", "chat.postMessage", { text: "x" }),
    ).rejects.toThrow("slack rejected the request (429)");
    expect(slack.sent.length).toBe(1);
    const ghl = rig([() => new Response("{}", { status: 429 })], {
      retry: true,
    });
    await expect(
      ghl.tools.call("ghl", "POST", "conversations/messages", { message: "x" }),
    ).rejects.toThrow(
      "The custom WhatsApp provider rejected the request (429).",
    );
    expect(ghl.sent.length).toBe(1);
    for (const x of [meta, slack, ghl]) {
      expect(x.slept).toEqual([]);
      expect(String(x.rows.at(-1)?.phase)).toBe("response");
    }
  });
});

describe("a second 429 speaks for its own step (one action makes several calls)", () => {
  test("the action's first write refused twice: the step is named, with no claim about the rest", async () => {
    const r = rig([() => limited(), () => limited()], { retry: true });
    const message = await r.tools
      .call("clickup", "POST", "list/901816723196/task", { name: "Launch" })
      .catch((e: Error) => e.message);
    expect(message.endsWith(CLICKUP_BUSY)).toBe(true);
    expect(message).not.toContain(CLICKUP_BUSY_LANDED);
    expect(message).not.toMatch(/nothing was changed/i);
  });

  test("a write that went through on any provider, then a ClickUp step refused twice: it says to check what changed", async () => {
    const r = rig(
      [
        () => ok({ id: "120000001" }),
        () => ok({ id: "86abc" }),
        () => limited(),
        () => limited(),
      ],
      { retry: true },
    );
    await r.tools.call("meta", "POST", "act_1/campaigns", { name: "Villas" });
    await r.tools.call("clickup", "GET", "task/86abc");
    const message = await r.tools
      .call("clickup", "POST", "task/86abc/comment", {
        comment_text: "Launched",
      })
      .catch((e: Error) => e.message);
    expect(message.endsWith(`${CLICKUP_BUSY} ${CLICKUP_BUSY_LANDED}`)).toBe(
      true,
    );
    expect(message).not.toMatch(/nothing was changed/i);
    expect(message).not.toContain("Try again in a minute");
  });

  test("a ClickUp read refused twice after reads only adds nothing about earlier steps", async () => {
    const r = rig(
      [() => ok({ id: "86abc" }), () => limited(), () => limited()],
      { retry: true },
    );
    await r.tools.call("clickup", "GET", "task/86abc");
    const message = await r.tools
      .call("clickup", "GET", "task/86abc/comment")
      .catch((e: Error) => e.message);
    expect(message.endsWith(CLICKUP_BUSY)).toBe(true);
  });
});
