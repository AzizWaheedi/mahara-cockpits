// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  hmacHex,
  plainTokenOk,
  SLACK_WINDOW_S,
  slackSignatureOk,
  timingSafeEqual,
  v0Signature,
  zoomSignatureOk,
  zoomValidationAnswer,
} from "./sign.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

// Slack's own worked example, docs.slack.dev/authentication/verifying-requests-from-slack
const SLACK_DOC = {
  secret: "8f742231b10e8888abcd99yyyzzz85a5",
  timestamp: "1531420618",
  body:
    "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c",
  signature: "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
};

describe("Slack's documented example", () => {
  test("the signature is reproduced byte for byte", async () => {
    expect(await v0Signature(SLACK_DOC.secret, SLACK_DOC.timestamp, bytes(SLACK_DOC.body))).toBe(
      SLACK_DOC.signature,
    );
  });

  test("it verifies at the example's own time", async () => {
    const now = Number(SLACK_DOC.timestamp);
    expect(
      await slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, bytes(SLACK_DOC.body), SLACK_DOC.signature, now),
    ).toBe("ok");
  });

  test("the 300 s window is inclusive, and one second more is stale", async () => {
    const ts = Number(SLACK_DOC.timestamp);
    const check = (now: number) =>
      slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, bytes(SLACK_DOC.body), SLACK_DOC.signature, now);
    expect(await check(ts + SLACK_WINDOW_S)).toBe("ok");
    expect(await check(ts - SLACK_WINDOW_S)).toBe("ok");
    expect(await check(ts + SLACK_WINDOW_S + 1)).toBe("stale");
    expect(await check(ts - SLACK_WINDOW_S - 1)).toBe("stale");
  });

  test("a changed body, secret or timestamp is refused", async () => {
    const now = Number(SLACK_DOC.timestamp);
    const tampered = SLACK_DOC.body.replace("roadrunner", "coyote");
    expect(await slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, bytes(tampered), SLACK_DOC.signature, now)).toBe(
      "bad",
    );
    expect(
      await slackSignatureOk("another-secret", SLACK_DOC.timestamp, bytes(SLACK_DOC.body), SLACK_DOC.signature, now),
    ).toBe("bad");
    expect(
      await slackSignatureOk(SLACK_DOC.secret, String(now + 1), bytes(SLACK_DOC.body), SLACK_DOC.signature, now),
    ).toBe("bad");
  });

  test("missing or malformed headers are refused, upper-case hex is read", async () => {
    const now = Number(SLACK_DOC.timestamp);
    const b = bytes(SLACK_DOC.body);
    expect(await slackSignatureOk(SLACK_DOC.secret, null, b, SLACK_DOC.signature, now)).toBe("bad");
    expect(await slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, b, null, now)).toBe("bad");
    expect(await slackSignatureOk(SLACK_DOC.secret, "12ab", b, SLACK_DOC.signature, now)).toBe("bad");
    expect(await slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, b, "v1=abc", now)).toBe("bad");
    expect(await slackSignatureOk("", SLACK_DOC.timestamp, b, SLACK_DOC.signature, now)).toBe("bad");
    expect(
      await slackSignatureOk(SLACK_DOC.secret, SLACK_DOC.timestamp, b, `v0=${SLACK_DOC.signature.slice(3).toUpperCase()}`, now),
    ).toBe("ok");
  });
});

// Zoom documents the format (developers.zoom.us/docs/api/webhooks) but gives
// no secret for its example values, so the reference here is an independent
// HMAC from node:crypto over exactly the documented message.
const ZOOM_SECRET = "zoom-test-secret-token";
const zoomReference = (ts: string, body: string) =>
  `v0=${createHmac("sha256", ZOOM_SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;

describe("Zoom's x-zm-signature", () => {
  const body = JSON.stringify({
    event: "meeting.participant_joined",
    event_ts: 1696320000000,
    payload: { account_id: "acc", object: { id: "85023456789", participant: { user_name: "سارة" } } },
  });
  const ts = "1696320000";

  test("matches the documented v0:{ts}:{body} HMAC, Arabic included", async () => {
    expect(await zoomSignatureOk(ZOOM_SECRET, ts, bytes(body), zoomReference(ts, body))).toBe(true);
  });

  test("has no time window: a retry an hour later still verifies", async () => {
    const old = "1000000000"; // 2001
    expect(await zoomSignatureOk(ZOOM_SECRET, old, bytes(body), zoomReference(old, body))).toBe(true);
  });

  test("refuses a changed body, a different timestamp, a wrong secret", async () => {
    const sig = zoomReference(ts, body);
    expect(await zoomSignatureOk(ZOOM_SECRET, ts, bytes(`${body} `), sig)).toBe(false);
    expect(await zoomSignatureOk(ZOOM_SECRET, "1696320001", bytes(body), sig)).toBe(false);
    expect(await zoomSignatureOk("other", ts, bytes(body), sig)).toBe(false);
  });

  test("refuses missing and malformed headers, and an empty secret", async () => {
    const sig = zoomReference(ts, body);
    expect(await zoomSignatureOk(ZOOM_SECRET, null, bytes(body), sig)).toBe(false);
    expect(await zoomSignatureOk(ZOOM_SECRET, ts, bytes(body), null)).toBe(false);
    expect(await zoomSignatureOk(ZOOM_SECRET, ts, bytes(body), sig.slice(3))).toBe(false);
    expect(await zoomSignatureOk(ZOOM_SECRET, ts, bytes(body), `${sig}00`)).toBe(false);
    expect(await zoomSignatureOk(ZOOM_SECRET, "abc", bytes(body), sig)).toBe(false);
    expect(await zoomSignatureOk("", ts, bytes(body), sig)).toBe(false);
  });
});

describe("Zoom's endpoint.url_validation", () => {
  test("answers HMAC-SHA256(secret, plainToken) in hex, with Zoom's example token", async () => {
    const plainToken = "qgg8vlvZRS6UYooatFL8Aw"; // the token in Zoom's documented example
    const answer = await zoomValidationAnswer(ZOOM_SECRET, plainToken);
    expect(answer).toEqual({
      plainToken,
      encryptedToken: createHmac("sha256", ZOOM_SECRET).update(plainToken).digest("hex"),
    });
    expect(Object.keys(answer)).toEqual(["plainToken", "encryptedToken"]);
  });

  test("a plainToken must look like Zoom's", () => {
    expect(plainTokenOk("qgg8vlvZRS6UYooatFL8Aw")).toBe(true);
    expect(plainTokenOk("")).toBe(false);
    expect(plainTokenOk("v0:1:{}")).toBe(false);
    expect(plainTokenOk("x".repeat(129))).toBe(false);
    expect(plainTokenOk(42)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  test("equal, unequal and different lengths", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("", "a")).toBe(false);
  });

  test("hmacHex agrees with node:crypto", async () => {
    expect(await hmacHex("k", "message")).toBe(createHmac("sha256", "k").update("message").digest("hex"));
  });
});
