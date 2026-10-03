// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import { parseSlack, pressFor, safeResponseUrl, stableRequestId } from "./slack.ts";

const FORM = "application/x-www-form-urlencoded";
const RESPONSE_URL = "https://hooks.slack.com/commands/T1DC2JH3J/397700885554/96rGlfmibIGlgcZRskXaIFfN";

const command = (name: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    token: "x",
    team_id: "T1DC2JH3J",
    user_id: "U2CERLKJA",
    command: name,
    text: "",
    response_url: RESPONSE_URL,
    trigger_id: "398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c",
    ...extra,
  }).toString();

const blockActions = (payload: Record<string, unknown>) =>
  new URLSearchParams({ payload: JSON.stringify(payload) }).toString();

const press = {
  type: "block_actions",
  user: { id: "U2CERLKJA", team_id: "T1DC2JH3J" },
  team: { id: "T1DC2JH3J" },
  channel: { id: "D0123" },
  message: { ts: "1696320000.000100" },
  response_url: RESPONSE_URL,
  trigger_id: "111.222.abc",
  actions: [{ action_id: "live.take", block_id: "offer", value: "offer-uuid", type: "button" }],
};

describe("slash commands", () => {
  test("/available, /unavailable and /away", () => {
    const a = parseSlack(FORM, command("/available"));
    expect(a).toMatchObject({ type: "command", command: "available", user_id: "U2CERLKJA", team_id: "T1DC2JH3J" });
    expect(parseSlack(FORM, command("/unavailable"))).toMatchObject({ command: "away" });
    expect(parseSlack(FORM, command("/away"))).toMatchObject({ command: "away" });
    expect(parseSlack(FORM, command("/AVAILABLE"))).toMatchObject({ command: "available" });
  });

  test("Slack's documented example body is a command the app does not know", () => {
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    expect(parseSlack(FORM, body)).toMatchObject({
      type: "command",
      command: null,
      raw_command: "/webhook-collect",
      response_url: RESPONSE_URL,
    });
  });

  test("a reply address that is not Slack's own is dropped", () => {
    const c = parseSlack(FORM, command("/available", { response_url: "https://evil.example/hook" }));
    expect(c).toMatchObject({ type: "command", response_url: undefined });
    expect(safeResponseUrl("http://hooks.slack.com/x")).toBeUndefined();
    expect(safeResponseUrl("https://hooks.slack.com.evil.example/x")).toBeUndefined();
    expect(safeResponseUrl(RESPONSE_URL)).toBe(RESPONSE_URL);
  });

  test("a malformed user id is not trusted", () => {
    expect(parseSlack(FORM, command("/available", { user_id: "nope" }))).toMatchObject({ user_id: undefined });
  });

  test("Slack's SSL check is recognised", () => {
    expect(parseSlack(FORM, "ssl_check=1&token=x")).toEqual({ type: "ssl_check" });
  });
});

describe("interactivity", () => {
  test("block_actions are read with their buttons", () => {
    expect(parseSlack(FORM, blockActions(press))).toEqual({
      type: "block_actions",
      user_id: "U2CERLKJA",
      team_id: "T1DC2JH3J",
      response_url: RESPONSE_URL,
      trigger_id: "111.222.abc",
      channel_id: "D0123",
      message_ts: "1696320000.000100",
      actions: [{ action_id: "live.take", block_id: "offer", value: "offer-uuid" }],
    });
  });

  test("other interactions, broken payloads and empty actions are ignored", () => {
    expect(parseSlack(FORM, blockActions({ ...press, type: "view_submission" })).type).toBe("ignored");
    expect(parseSlack(FORM, "payload=%7Bnot-json").type).toBe("ignored");
    expect(parseSlack(FORM, blockActions({ ...press, actions: [] })).type).toBe("ignored");
    expect(parseSlack(FORM, "hello=world").type).toBe("ignored");
  });

  test("at most five actions are kept", () => {
    const many = { ...press, actions: Array.from({ length: 9 }, (_, i) => ({ action_id: `a${i}` })) };
    const out = parseSlack(FORM, blockActions(many));
    expect(out.type === "block_actions" && out.actions.length).toBe(5);
  });
});

describe("Events API", () => {
  test("url_verification returns the challenge", () => {
    expect(parseSlack("application/json", JSON.stringify({ type: "url_verification", challenge: "3eZbrw1aB" }))).toEqual({
      type: "url_verification",
      challenge: "3eZbrw1aB",
    });
  });

  test("app_home_opened is read; other events are ignored", () => {
    const ev = (type: string) =>
      JSON.stringify({
        type: "event_callback",
        team_id: "T1DC2JH3J",
        event_id: "Ev123",
        event: { type, user: "U2CERLKJA", tab: "home" },
      });
    expect(parseSlack("application/json; charset=utf-8", ev("app_home_opened"))).toEqual({
      type: "event",
      event_type: "app_home_opened",
      user_id: "U2CERLKJA",
      team_id: "T1DC2JH3J",
      event_id: "Ev123",
      tab: "home",
    });
    expect(parseSlack("application/json", ev("message")).type).toBe("ignored");
    expect(parseSlack("application/json", "{broken").type).toBe("ignored");
  });
});

describe("pressFor and request ids", () => {
  const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

  test("a command becomes live.press with the person's Slack id", async () => {
    const p = await pressFor(parseSlack(FORM, command("/available")), NOW);
    expect(p).toMatchObject({
      action: "live.press",
      kind: "command",
      command: "available",
      slack_user_id: "U2CERLKJA",
      slack_team_id: "T1DC2JH3J",
      response_url: RESPONSE_URL,
    });
  });

  test("a button press carries the buttons and where to reply", async () => {
    const p = await pressFor(parseSlack(FORM, blockActions(press)), NOW);
    expect(p).toMatchObject({
      action: "live.press",
      kind: "block_actions",
      slack_user_id: "U2CERLKJA",
      actions: [{ action_id: "live.take", value: "offer-uuid" }],
      response_url: RESPONSE_URL,
    });
  });

  test("app_home_opened becomes its own kind", async () => {
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1DC2JH3J",
      event_id: "Ev1",
      event: { type: "app_home_opened", user: "U2CERLKJA", tab: "home" },
    });
    expect(await pressFor(parseSlack("application/json", body), NOW)).toMatchObject({
      kind: "app_home_opened",
      event_id: "Ev1",
    });
  });

  test("nothing to pass on for an unknown command or a missing user", async () => {
    expect(await pressFor(parseSlack(FORM, command("/other")), NOW)).toBeNull();
    expect(await pressFor(parseSlack(FORM, command("/available", { user_id: "" })), NOW)).toBeNull();
    expect(await pressFor({ type: "ignored", reason: "x" }, NOW)).toBeNull();
  });

  test("a retried request keeps its request id; another request gets another", async () => {
    const a = await pressFor(parseSlack(FORM, blockActions(press)), NOW);
    const b = await pressFor(parseSlack(FORM, blockActions(press)), NOW + 60_000);
    const c = await pressFor(parseSlack(FORM, blockActions({ ...press, trigger_id: "999.1.x" })), NOW);
    expect(a?.request_id).toBe(b?.request_id);
    expect(a?.request_id).not.toBe(c?.request_id);
  });

  test("request ids are UUID-shaped", async () => {
    const id = await stableRequestId("seed");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
