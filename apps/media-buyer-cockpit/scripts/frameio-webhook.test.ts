import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { fresh, MAX_AGE_SECONDS, verify, WANTED } from "../api/frameio";

/**
 * The signature check on the Frame.io webhook.
 *
 * This is the only thing standing between a public URL and a write to our
 * notes, so it is the one piece of that endpoint worth testing on its own.
 * Their scheme is HMAC SHA256 over `v0:<timestamp>:<body>`, returned as
 * `v0=<hex>` in `X-Frameio-Signature`.
 */
const SECRET = "shhh";
const NOW = () => String(Math.floor(Date.now() / 1000));

function sign(raw: string, stamp: string, secret = SECRET): string {
  const hex = createHmac("sha256", secret)
    .update(`v0:${stamp}:${raw}`)
    .digest("hex");
  return `t=${stamp},v0=${hex}`;
}

const ok = (raw: string, sig: string | null, fallback: string | null = null) =>
  verify(raw, sig, fallback, SECRET).ok;

describe("verify", () => {
  const body = '{"type":"comment.created","resource":{"id":"c1"}}';

  it("accepts what Frame.io actually sends", () => {
    expect(ok(body, sign(body, NOW()))).toBe(true);
  });

  it("accepts the bare v0= form with the timestamp header", () => {
    // Their header shape has changed once already. Tolerating both means a
    // change on their side does not silently reject every event -- and the
    // fallback timestamp still goes into the signed message, so it buys an
    // attacker nothing.
    const stamp = NOW();
    const hex = createHmac("sha256", SECRET)
      .update(`v0:${stamp}:${body}`)
      .digest("hex");
    expect(ok(body, `v0=${hex}`, stamp)).toBe(true);
  });

  it("refuses a body that was altered in flight", () => {
    const header = sign(body, NOW());
    expect(ok(`${body} `, header)).toBe(false);
    expect(
      ok('{"type":"comment.created","resource":{"id":"c2"}}', header),
    ).toBe(false);
  });

  it("refuses a signature made with the wrong secret", () => {
    expect(ok(body, sign(body, NOW(), "wrong"))).toBe(false);
  });

  it("refuses a captured request replayed later", () => {
    // The whole point of judging freshness on the *signed* timestamp. A
    // valid signature from an hour ago stays valid forever unless the
    // timestamp it covers is the one being checked.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verify(body, sign(body, old), null, SECRET)).toEqual({
      ok: false,
      why: "stale",
    });
  });

  it("refuses a replay dressed up with a fresh unsigned header", () => {
    // The attack the fallback header would otherwise allow: keep the old
    // valid signature, put today's date in the header nobody signed.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(ok(body, sign(body, old), NOW())).toBe(false);
  });

  it("refuses a missing, empty or malformed header rather than throwing", () => {
    for (const header of [null, "", "v0=", "nonsense", "v0=zzzz", "t=1,v0="]) {
      expect(ok(body, header, NOW())).toBe(false);
    }
  });

  it("refuses a signature of the wrong length without comparing", () => {
    // timingSafeEqual throws on a length mismatch; it must not reach it.
    expect(ok(body, `t=${NOW()},v0=ab`)).toBe(false);
  });

  it("refuses when there is no timestamp anywhere", () => {
    const hex = createHmac("sha256", SECRET)
      .update(`v0::${body}`)
      .digest("hex");
    expect(ok(body, `v0=${hex}`, null)).toBe(false);
  });
});

describe("fresh", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("accepts a timestamp from a moment ago", () => {
    expect(fresh(String(now()))).toBe(true);
    expect(fresh(String(now() - MAX_AGE_SECONDS + 10))).toBe(true);
  });

  it("refuses one too old to be anything but a replay", () => {
    expect(fresh(String(now() - MAX_AGE_SECONDS - 10))).toBe(false);
  });

  it("refuses one from the future by more than the window", () => {
    // A clock far ahead is as suspicious as one far behind.
    expect(fresh(String(now() + MAX_AGE_SECONDS + 10))).toBe(false);
  });

  it("refuses rubbish rather than treating it as zero", () => {
    for (const bad of [null, "", "abc", "0", "-1", "NaN"]) {
      expect(fresh(bad)).toBe(false);
    }
  });
});

describe("WANTED", () => {
  it("covers the events the worker knows how to act on", () => {
    for (const t of [
      "comment.created",
      "comment.completed",
      "file.versioned",
      "share.viewed",
    ]) {
      expect(WANTED.has(t)).toBe(true);
    }
  });

  it("does not queue events nothing acts on", () => {
    // Anything queued and then ignored is a row the drain has to chew
    // through for no reason.
    for (const t of ["project.created", "folder.deleted", "file.deleted"]) {
      expect(WANTED.has(t)).toBe(false);
    }
  });
});
