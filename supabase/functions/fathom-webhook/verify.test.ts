import { describe, expect, test } from "bun:test";
import { SECRET, sign } from "./testkit.ts";
import { headersVerdict, TOLERANCE_SEC, verifyFathom } from "./verify.ts";

// The signature rule of docs/forms/STAGE2-CONTRACT.md 4.4, against the
// testkit's node:crypto signer and the Standard Webhooks spec's own example.

const T = 1_761_640_200; // 2026-10-28 08:30 UTC, in seconds
const ID = "msg_invented0001";
const TS = String(T);
const BODY = JSON.stringify({ recording_id: 196100001, title: "Impromptu Zoom Meeting" });
const GOOD = sign(SECRET, ID, TS, BODY);
const OTHER_SECRET = ["whsec", btoa("another invented webhook key")].join("_");

describe("verifyFathom", () => {
  test("a good signature passes", async () => {
    expect(await verifyFathom(SECRET, ID, TS, BODY, GOOD, T)).toEqual({ ok: true });
  });

  test("the Standard Webhooks example passes: a second implementation agrees", async () => {
    const secret = ["whsec", "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"].join("_");
    const v = await verifyFathom(
      secret,
      "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "1614265330",
      '{"test": 2432232314}',
      "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
      1614265330,
    );
    expect(v).toEqual({ ok: true });
  });

  test("any one of two signatures is enough, in either order", async () => {
    const wrong = sign(OTHER_SECRET, ID, TS, BODY);
    expect(await verifyFathom(SECRET, ID, TS, BODY, `${wrong} ${GOOD}`, T)).toEqual({ ok: true });
    expect(await verifyFathom(SECRET, ID, TS, BODY, `${GOOD} ${wrong}`, T)).toEqual({ ok: true });
    expect(await verifyFathom(SECRET, ID, TS, BODY, `v1a,${GOOD.slice(3)}  ${GOOD}`, T)).toEqual({ ok: true });
  });

  test("a wrong signature fails", async () => {
    const bad = { ok: false, reason: "bad_signature" };
    expect(await verifyFathom(SECRET, ID, TS, BODY, sign(OTHER_SECRET, ID, TS, BODY), T)).toEqual(bad);
    // The body, the id and the time are all signed.
    expect(await verifyFathom(SECRET, ID, TS, `${BODY} `, GOOD, T)).toEqual(bad);
    expect(await verifyFathom(SECRET, "msg_invented0002", TS, BODY, GOOD, T)).toEqual(bad);
    expect(await verifyFathom(SECRET, ID, String(T + 1), BODY, GOOD, T)).toEqual(bad);
    // Only v1 signatures count.
    expect(await verifyFathom(SECRET, ID, TS, BODY, `v2,${GOOD.slice(3)}`, T)).toEqual(bad);
    expect(await verifyFathom(SECRET, ID, TS, BODY, GOOD.slice(3), T)).toEqual(bad);
  });

  test("a signature of another length fails without throwing", async () => {
    const bad = { ok: false, reason: "bad_signature" };
    expect(await verifyFathom(SECRET, ID, TS, BODY, "v1,abc", T)).toEqual(bad);
    expect(await verifyFathom(SECRET, ID, TS, BODY, `${GOOD}A`, T)).toEqual(bad);
    expect(await verifyFathom(SECRET, ID, TS, BODY, "v1,", T)).toEqual(bad);
  });

  test("a timestamp more than 5 minutes away fails, either way", async () => {
    expect(TOLERANCE_SEC).toBe(300);
    for (const at of [T - 301, T + 301, T - 86_400]) {
      const ts = String(at);
      expect(await verifyFathom(SECRET, ID, ts, BODY, sign(SECRET, ID, ts, BODY), T)).toEqual({ ok: false, reason: "stale" });
    }
    for (const at of [T - 300, T + 300]) {
      const ts = String(at);
      expect(await verifyFathom(SECRET, ID, ts, BODY, sign(SECRET, ID, ts, BODY), T)).toEqual({ ok: true });
    }
    for (const ts of ["", "soon", "1761640200.5", "-1761640200", "17616402000000"])
      expect((await verifyFathom(SECRET, ID, ts, BODY, sign(SECRET, ID, ts, BODY), T)).ok).toBe(false);
  });

  test("a missing header fails before anything else", async () => {
    const missing = { ok: false, reason: "missing" };
    expect(await verifyFathom(SECRET, null, TS, BODY, GOOD, T)).toEqual(missing);
    expect(await verifyFathom(SECRET, "", TS, BODY, GOOD, T)).toEqual(missing);
    expect(await verifyFathom(SECRET, ID, null, BODY, GOOD, T)).toEqual(missing);
    expect(await verifyFathom(SECRET, ID, TS, BODY, null, T)).toEqual(missing);
    expect(await verifyFathom("", null, null, BODY, null, T)).toEqual(missing);
  });

  test("a secret that holds no key fails as bad_secret, never as the sender's fault", async () => {
    const badSecret = { ok: false, reason: "bad_secret" };
    // No secret, no prefix, nothing after it, not base64, a broken last group, a 6-byte key.
    for (const secret of ["", SECRET.slice("whsec_".length), "whsec_", "whsec_!!!!!!!!!!!!!!!!", `whsec_${"A".repeat(21)}`, "whsec_YWJjZGVm"])
      expect(await verifyFathom(secret, ID, TS, BODY, GOOD, T)).toEqual(badSecret);
  });

  test("headersVerdict refuses what needs no secret, as verifyFathom does, and nothing else", async () => {
    expect(headersVerdict(ID, TS, GOOD, T)).toEqual({ ok: true });
    // A wrong signature of the right shape passes here: only the secret can refuse it.
    expect(headersVerdict(ID, TS, sign(OTHER_SECRET, ID, TS, BODY), T)).toEqual({ ok: true });
    expect(headersVerdict(null, TS, GOOD, T)).toEqual({ ok: false, reason: "missing" });
    expect(headersVerdict(ID, TS, null, T)).toEqual({ ok: false, reason: "missing" });
    expect(headersVerdict(ID, String(T - 301), GOOD, T)).toEqual({ ok: false, reason: "stale" });
    expect(headersVerdict(ID, "soon", GOOD, T)).toEqual({ ok: false, reason: "stale" });
    for (const header of [`v2,${GOOD.slice(3)}`, GOOD.slice(3), "v1a,abc"]) {
      expect(headersVerdict(ID, TS, header, T)).toEqual({ ok: false, reason: "bad_signature" });
      expect(await verifyFathom(SECRET, ID, TS, BODY, header, T)).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  test("a URL-safe secret holds the same key as the standard one", async () => {
    // 0xfb 0xff 0xbf repeated encodes as "+/+/" in standard base64 and "-_-_" URL-safe.
    const bytes = String.fromCharCode(...Array.from({ length: 24 }, (_, i) => [0xfb, 0xff, 0xbf][i % 3]));
    const standard = `whsec_${btoa(bytes)}`;
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
    expect(urlSafe).not.toBe(standard);
    const sig = sign(standard, ID, TS, BODY);
    expect(await verifyFathom(urlSafe, ID, TS, BODY, sig, T)).toEqual({ ok: true });
    expect(await verifyFathom(standard, ID, TS, BODY, sig, T)).toEqual({ ok: true });
  });
});
