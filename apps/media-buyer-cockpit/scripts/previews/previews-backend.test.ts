/**
 * Tests for the media buyer preview backend's pure helpers
 * (apps/media-buyer-cockpit/convex/metaMedia.ts), plus a parity check
 * against the frontend copy (src/lib/metaMedia.ts).
 *
 * Run: bun test <this file>
 */
import { describe, expect, test } from "bun:test";
import * as back from "../../convex/metaMedia.ts";
import * as front from "../../src/lib/metaMedia.ts";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0); // 2026-09-16 12:00 UTC
const hex = (ms: number) => Math.floor(ms / 1000).toString(16);
const cdn = (oe?: string, host = "scontent.fkwi8-1.fna.fbcdn.net") =>
  `https://${host}/v/t45.1600-4/123_n.jpg?stp=dst-jpg&_nc_cat=1${oe === undefined ? "" : `&oe=${oe}`}&oh=00_abc`;

describe("metaImageExpiry", () => {
  test("reads oe as hex seconds on fbcdn", () => {
    const exp = NOW + 3 * 24 * HOUR;
    expect(back.metaImageExpiry(cdn(hex(exp)))).toBe(
      Math.floor(exp / 1000) * 1000,
    );
  });
  test("known literal value", () => {
    // 0x68C9A000 = 1758044160 s
    expect(back.metaImageExpiry(cdn("68C9A000"))).toBe(1758044160 * 1000);
    expect(back.metaImageExpiry(cdn("68c9a000"))).toBe(1758044160 * 1000);
  });
  test("works on cdninstagram and sub-hosts", () => {
    expect(
      back.metaImageExpiry(cdn("68c9a000", "scontent-ams2-1.cdninstagram.com")),
    ).toBe(1758044160 * 1000);
    expect(back.metaImageExpiry(cdn("68c9a000", "external.xx.fbcdn.net"))).toBe(
      1758044160 * 1000,
    );
  });
  test("ignores other hosts, even with an oe", () => {
    expect(
      back.metaImageExpiry(cdn("68c9a000", "example.com")),
    ).toBeUndefined();
    expect(
      back.metaImageExpiry(cdn("68c9a000", "fbcdn.net.evil.com")),
    ).toBeUndefined();
    expect(
      back.metaImageExpiry(cdn("68c9a000", "notfbcdn.net")),
    ).toBeUndefined();
    expect(
      back.metaImageExpiry(
        "https://adorable-seahorse-418.convex.cloud/api/storage/abc?oe=68c9a000",
      ),
    ).toBeUndefined();
  });
  test("bad or missing oe", () => {
    expect(back.metaImageExpiry(cdn())).toBeUndefined();
    expect(back.metaImageExpiry(cdn(""))).toBeUndefined();
    expect(back.metaImageExpiry(cdn("zzzzzzzz"))).toBeUndefined();
    expect(back.metaImageExpiry(cdn("12345"))).toBeUndefined(); // too short
    expect(back.metaImageExpiry(cdn("12345678901"))).toBeUndefined(); // too long
  });
  test("empty and broken input", () => {
    expect(back.metaImageExpiry(undefined)).toBeUndefined();
    expect(back.metaImageExpiry(null)).toBeUndefined();
    expect(back.metaImageExpiry("")).toBeUndefined();
    expect(back.metaImageExpiry("not a url")).toBeUndefined();
    expect(back.metaImageExpiry("/relative/path?oe=68c9a000")).toBeUndefined();
  });
});

describe("metaImageUsable", () => {
  test("future oe beyond the margin is usable", () => {
    expect(back.metaImageUsable(cdn(hex(NOW + 2 * HOUR)), NOW)).toBe(true);
  });
  test("expired oe is not usable", () => {
    expect(back.metaImageUsable(cdn(hex(NOW - HOUR)), NOW)).toBe(false);
  });
  test("inside the 10 minute margin is not usable", () => {
    expect(back.metaImageUsable(cdn(hex(NOW + 5 * 60_000)), NOW)).toBe(false);
    expect(back.metaImageUsable(cdn(hex(NOW + 11 * 60_000)), NOW)).toBe(true);
  });
  test("custom margin", () => {
    expect(back.metaImageUsable(cdn(hex(NOW + 5 * 60_000)), NOW, 0)).toBe(true);
  });
  test("no oe, or not a Meta host: allowed (onError still guards it)", () => {
    expect(back.metaImageUsable(cdn(), NOW)).toBe(true);
    expect(
      back.metaImageUsable("https://example.com/pic.jpg?oe=00000001", NOW),
    ).toBe(true);
  });
  test("nothing is not usable", () => {
    expect(back.metaImageUsable(undefined, NOW)).toBe(false);
    expect(back.metaImageUsable("", NOW)).toBe(false);
  });
});

describe("keys and links", () => {
  test("stillKeyFor prefers the creative", () => {
    expect(back.stillKeyFor("111", "222")).toBe("c:111");
    expect(back.stillKeyFor(undefined, "222")).toBe("a:222");
    expect(back.stillKeyFor(null, null)).toBeUndefined();
    expect(back.stillKeyFor("", "")).toBeUndefined();
  });
  test("adsManagerUrl strips act_", () => {
    expect(back.adsManagerUrl("123", "act_456")).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=456&selected_ad_ids=123",
    );
    expect(back.adsManagerUrl("123")).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=123",
    );
  });
  test("isMetaId", () => {
    expect(back.isMetaId("120211234567890123")).toBe(true);
    expect(back.isMetaId("1234")).toBe(false);
    expect(back.isMetaId("12345")).toBe(true);
    expect(back.isMetaId("123/previews")).toBe(false);
    expect(back.isMetaId("act_123456")).toBe(false);
    expect(back.isMetaId(123456)).toBe(false);
    expect(back.isMetaId("1".repeat(26))).toBe(false);
  });
  test("previewFormat keeps known formats only", () => {
    expect(back.previewFormat()).toBe("MOBILE_FEED_STANDARD");
    expect(back.previewFormat("INSTAGRAM_STANDARD")).toBe("INSTAGRAM_STANDARD");
    expect(back.previewFormat("DROP_TABLE")).toBe("MOBILE_FEED_STANDARD");
  });
});

describe("Meta error mapping", () => {
  const err = (t: string) => new Error(t);
  test("previews: reasons", () => {
    expect(
      back.metaErrorReason(
        err(
          "Meta 100/33: Unsupported get request. Object with ID '1' does not exist",
        ),
      ),
    ).toBe("gone");
    expect(back.metaErrorReason(err("Meta 100: Object does not exist"))).toBe(
      "gone",
    );
    expect(
      back.metaErrorReason(
        err("Meta 10: Application does not have permission"),
      ),
    ).toBe("no_meta_access");
    expect(back.metaErrorReason(err("Meta 200: Requires ads_read"))).toBe(
      "no_meta_access",
    );
    expect(
      back.metaErrorReason(err("Meta 294: Managing advertisements requires")),
    ).toBe("no_meta_access");
    for (const c of [4, 17, 32, 613, 80004])
      expect(
        back.metaErrorReason(err(`Meta ${c}: User request limit reached`)),
      ).toBe("rate_limited");
    expect(
      back.metaErrorReason(err("Meta 190: Error validating access token")),
    ).toBe("error");
    expect(back.metaErrorReason(err("Meta did not answer in time"))).toBe(
      "error",
    );
    expect(back.metaErrorReason("Meta 100: Invalid parameter")).toBe("error");
  });
  test("a rate limit is never read as gone, even if the text says so", () => {
    expect(
      back.metaErrorReason(err("Meta 17: object does not exist (rate)")),
    ).toBe("rate_limited");
  });
  test("codes are parsed", () => {
    expect(back.metaErrorCodes(err("Meta 100/33: x"))).toMatchObject({
      code: 100,
      subcode: 33,
    });
    expect(back.metaErrorCodes(err("HTTP 403"))).toMatchObject({
      code: undefined,
    });
  });
  test("stills: gone is final, rate limits are free, the rest count", () => {
    expect(back.stillFailure(err("Meta 100/33: does not exist"))).toEqual({
      status: "gone",
      countAttempt: false,
    });
    expect(back.stillFailure(err("Meta 10: permission"))).toEqual({
      status: "gone",
      countAttempt: false,
    });
    expect(back.stillFailure(err("Meta 200: permission"))).toEqual({
      status: "gone",
      countAttempt: false,
    });
    expect(back.stillFailure(err("Meta 613: slow down"))).toEqual({
      status: "failed",
      countAttempt: false,
    });
    expect(back.stillFailure(err("picture: HTTP 403"))).toEqual({
      status: "failed",
      countAttempt: true,
    });
    expect(back.stillFailure(err("Meta 100: Invalid parameter"))).toEqual({
      status: "failed",
      countAttempt: true,
    });
    // A download error that mentions "does not exist" is not a Meta verdict.
    expect(back.stillFailure(err("picture: file does not exist"))).toEqual({
      status: "failed",
      countAttempt: true,
    });
  });
  test("unsupported format detection", () => {
    expect(
      back.formatUnsupported(
        err("Meta 100: The ad_format INSTAGRAM_STORY is not supported"),
      ),
    ).toBe(true);
    expect(back.formatUnsupported(err("Meta 100/33: does not exist"))).toBe(
      false,
    );
    expect(back.formatUnsupported(err("Meta 190: token"))).toBe(false);
  });
});

describe("preview cache", () => {
  test("ttl by outcome", () => {
    expect(back.previewTtlMs()).toBe(20 * HOUR);
    expect(back.previewTtlMs("gone")).toBe(24 * HOUR);
    expect(back.previewTtlMs("no_meta_access")).toBe(24 * HOUR);
    expect(back.previewTtlMs("rate_limited")).toBe(5 * 60_000);
    expect(back.previewTtlMs("error")).toBe(10 * 60_000);
  });
  test("a link needs five minutes left", () => {
    expect(
      back.cachedPreviewUsable({ src: "x", expiresAt: NOW + 6 * 60_000 }, NOW),
    ).toBe(true);
    expect(
      back.cachedPreviewUsable({ src: "x", expiresAt: NOW + 4 * 60_000 }, NOW),
    ).toBe(false);
    expect(
      back.cachedPreviewUsable({ src: "x", expiresAt: NOW - 1 }, NOW),
    ).toBe(false);
  });
  test("a refusal is reused until it runs out", () => {
    expect(back.cachedPreviewUsable({ expiresAt: NOW + 1000 }, NOW)).toBe(true);
    expect(back.cachedPreviewUsable({ expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(back.cachedPreviewUsable(null, NOW)).toBe(false);
  });
  test("parsePreviewBody", () => {
    const body =
      '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&amp;t=AQ" width="320" height="560" scrolling="yes" style="border: none;"></iframe>';
    expect(back.parsePreviewBody(body)).toEqual({
      src: "https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&t=AQ",
      width: 320,
      height: 560,
    });
    expect(back.parsePreviewBody("")).toEqual({});
    expect(back.parsePreviewBody('<iframe src="javascript:alert(1)">')).toEqual(
      {},
    );
    // Review change: only hosts the cockpits will frame count as a preview.
    expect(back.parsePreviewBody('<iframe src="https://x.test/p" >')).toEqual(
      {},
    );
    expect(
      back.parsePreviewBody('<iframe src="https://www.facebook.com/p" >'),
    ).toEqual({
      src: "https://www.facebook.com/p",
      width: undefined,
      height: undefined,
    });
    expect(
      back.parsePreviewBody('<iframe src="https://facebook.com.evil.test/p" >'),
    ).toEqual({});
  });
});

describe("preview answer (backend fallback decision)", () => {
  const base = {
    ok: false,
    adId: "120211234567890123",
    stillUrl: "https://dep.convex.cloud/api/storage/s1",
    stillTinyUrl: "https://dep.convex.cloud/api/storage/s2",
    thumbUrl: cdn(hex(NOW + 2 * 24 * HOUR)),
    thumbExpiresAt: Math.floor((NOW + 2 * 24 * HOUR) / 1000) * 1000,
    accountId: "456",
  };
  test("a live link is handed over with its expiry and the stills", () => {
    const r = back.previewAnswer(
      base,
      {
        src: "https://business.facebook.com/p",
        width: 320,
        height: 560,
        fetchedAt: NOW,
        expiresAt: NOW + 20 * HOUR,
      },
      NOW,
    );
    expect(r).toMatchObject({
      ok: true,
      src: "https://business.facebook.com/p",
      expiresAt: NOW + 20 * HOUR,
      stillUrl: base.stillUrl,
      stillTinyUrl: base.stillTinyUrl,
      accountId: "456",
    });
    expect(r.reason).toBeUndefined();
    expect(r.message).toBeUndefined();
  });
  test("an expired link is never handed over", () => {
    const r = back.previewAnswer(
      base,
      {
        src: "https://business.facebook.com/p",
        fetchedAt: NOW - 25 * HOUR,
        expiresAt: NOW - HOUR,
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.src).toBeUndefined();
    expect(r.reason).toBe("error");
    expect(r.stillUrl).toBe(base.stillUrl);
  });
  test("a refusal carries its reason, message and the saved picture", () => {
    const r = back.previewAnswer(
      base,
      { fetchedAt: NOW, expiresAt: NOW + 24 * HOUR, reason: "gone" },
      NOW,
    );
    expect(r).toMatchObject({
      ok: false,
      reason: "gone",
      message: back.PREVIEW_MESSAGES.gone,
      stillUrl: base.stillUrl,
    });
    expect(r.message).not.toContain("—");
  });
  test("an unknown stored reason becomes error", () => {
    const r = back.previewAnswer(
      base,
      { fetchedAt: NOW, expiresAt: NOW + 1000, reason: "weird" },
      NOW,
    );
    expect(r.reason).toBe("error");
    expect(r.message).toBe(back.PREVIEW_MESSAGES.error);
  });
  test("a fresh Meta still from the answer wins only while it is good", () => {
    const fresh = cdn(hex(NOW + 3 * 24 * HOUR));
    const good = back.previewAnswer(
      base,
      {
        fetchedAt: NOW,
        expiresAt: NOW + 1000,
        reason: "error",
        thumbUrl: fresh,
        thumbExpiresAt: NOW + 3 * 24 * HOUR,
      },
      NOW,
    );
    expect(good.thumbUrl).toBe(fresh);
    const stale = back.previewAnswer(
      base,
      {
        fetchedAt: NOW,
        expiresAt: NOW + 1000,
        reason: "error",
        thumbUrl: fresh,
        thumbExpiresAt: NOW - 1,
      },
      NOW,
    );
    expect(stale.thumbUrl).toBe(base.thumbUrl);
    expect(stale.thumbExpiresAt).toBe(base.thumbExpiresAt);
  });
  test("no nulls or undefined fields leak into the answer", () => {
    const r = back.previewAnswer(
      { ok: false, adId: "12345" },
      { fetchedAt: NOW, expiresAt: NOW + 1000, reason: "rate_limited" },
      NOW,
    );
    for (const v of Object.values(r))
      expect(v === undefined || v === null).toBe(false);
    expect(Object.keys(r).sort()).toEqual(["adId", "message", "ok", "reason"]);
  });
  test("no message has an em dash", () => {
    for (const m of Object.values(back.PREVIEW_MESSAGES))
      expect(m).not.toContain("—");
  });
});

describe("saved still retries", () => {
  test("nothing on record: capture", () => {
    expect(back.stillCaptureDue(null, NOW)).toBe(true);
    expect(back.stillCaptureDue(undefined, NOW)).toBe(true);
  });
  test("saved and gone are final", () => {
    expect(
      back.stillCaptureDue(
        { status: "saved", attempts: 0, lastTriedAt: 0 },
        NOW,
      ),
    ).toBe(false);
    expect(
      back.stillCaptureDue(
        { status: "gone", attempts: 1, lastTriedAt: 0 },
        NOW,
      ),
    ).toBe(false);
  });
  test("a key tried in the last 15 minutes is left alone", () => {
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 0, lastTriedAt: NOW - 60_000 },
        NOW,
      ),
    ).toBe(false);
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 0, lastTriedAt: NOW - 16 * 60_000 },
        NOW,
      ),
    ).toBe(true);
  });
  test("five attempts, then once a week", () => {
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 4, lastTriedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(true);
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 5, lastTriedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(false);
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 5, lastTriedAt: NOW - 6 * 24 * HOUR },
        NOW,
      ),
    ).toBe(false);
    expect(
      back.stillCaptureDue(
        { status: "failed", attempts: 9, lastTriedAt: NOW - 7 * 24 * HOUR },
        NOW,
      ),
    ).toBe(true);
  });
  test("stillGap classifies missing winner pictures", () => {
    expect(back.stillGap(null, NOW)).toBe("never_tried");
    expect(
      back.stillGap({ status: "saved", attempts: 0, lastTriedAt: 0 }, NOW),
    ).toBe("saved");
    expect(
      back.stillGap({ status: "gone", attempts: 0, lastTriedAt: 0 }, NOW),
    ).toBe("gone");
    expect(
      back.stillGap({ status: "failed", attempts: 2, lastTriedAt: NOW }, NOW),
    ).toBe("failed_eligible");
    expect(
      back.stillGap(
        { status: "failed", attempts: 5, lastTriedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe("failed_waiting");
    expect(
      back.stillGap(
        { status: "failed", attempts: 5, lastTriedAt: NOW - 8 * 24 * HOUR },
        NOW,
      ),
    ).toBe("failed_eligible");
  });
  test("capture on open", () => {
    const due = { hasSaved: false, still: null, msLeft: 10_000, now: NOW };
    expect(back.captureOnOpen(due)).toBe(true);
    expect(back.captureOnOpen({ ...due, hasSaved: true })).toBe(false);
    expect(back.captureOnOpen({ ...due, reason: "rate_limited" })).toBe(false);
    expect(back.captureOnOpen({ ...due, reason: "no_meta_access" })).toBe(
      false,
    );
    expect(back.captureOnOpen({ ...due, reason: "gone" })).toBe(true);
    expect(back.captureOnOpen({ ...due, reason: "error" })).toBe(true);
    expect(back.captureOnOpen({ ...due, msLeft: 3_000 })).toBe(false);
    expect(
      back.captureOnOpen({
        ...due,
        still: { status: "gone", attempts: 0, lastTriedAt: 0 },
      }),
    ).toBe(false);
  });
});

describe("pictures and downloads", () => {
  test("hasPicture: saved still, or a Meta link that has not expired", () => {
    expect(back.hasPicture({ stillUrl: "https://x/s" }, NOW)).toBe(true);
    expect(back.hasPicture({ thumbUrl: cdn(hex(NOW + HOUR)) }, NOW)).toBe(true);
    expect(back.hasPicture({ thumbUrl: cdn(hex(NOW - HOUR)) }, NOW)).toBe(
      false,
    );
    expect(back.hasPicture({}, NOW)).toBe(false);
    expect(
      back.hasPicture(
        { stillUrl: "https://x/s", thumbUrl: cdn(hex(NOW - HOUR)) },
        NOW,
      ),
    ).toBe(true);
  });
  test("image candidates, best first, https only", () => {
    expect(
      back.creativeImageCandidates({
        image_url: "https://a/img.jpg",
        object_story_spec: {
          video_data: { image_url: "https://a/cover.jpg" },
          link_data: { picture: "http://insecure/pic.jpg" },
        },
      }),
    ).toEqual([
      { url: "https://a/img.jpg", source: "image" },
      { url: "https://a/cover.jpg", source: "video_picture" },
    ]);
    expect(back.creativeImageCandidates(undefined)).toEqual([]);
    expect(back.creativeImageCandidates({})).toEqual([]);
  });
  test("download checks", () => {
    expect(
      back.stillProblem(200, "image/jpeg", 25_000, back.STILL_FULL_MAX_BYTES),
    ).toBe("");
    expect(
      back.stillProblem(403, "text/html", 100, back.STILL_FULL_MAX_BYTES),
    ).toBe("HTTP 403");
    expect(
      back.stillProblem(200, "text/html", 5_000, back.STILL_FULL_MAX_BYTES),
    ).toContain("not an image");
    expect(
      back.stillProblem(200, null, 5_000, back.STILL_FULL_MAX_BYTES),
    ).toContain("not an image");
    expect(
      back.stillProblem(200, "image/png", 100, back.STILL_FULL_MAX_BYTES),
    ).toContain("too small");
    expect(
      back.stillProblem(200, "image/png", 250_001, back.STILL_FULL_MAX_BYTES),
    ).toContain("too big");
    expect(
      back.stillProblem(200, "image/png", 60_001, back.STILL_TINY_MAX_BYTES),
    ).toContain("too big");
  });
});

describe("winners", () => {
  test("isSavedWinner", () => {
    expect(back.isSavedWinner({})).toBe(false);
    expect(back.isSavedWinner({ savedAt: 10 })).toBe(true);
    expect(back.isSavedWinner({ savedAt: 10, unsavedAt: 5 })).toBe(true);
    expect(back.isSavedWinner({ savedAt: 10, unsavedAt: 10 })).toBe(false);
    expect(back.isSavedWinner({ savedAt: 10, unsavedAt: 11 })).toBe(false);
  });
  test("isAutoWinner", () => {
    expect(back.isAutoWinner({})).toBe(true);
    expect(back.isAutoWinner({ origin: "auto" })).toBe(true);
    expect(back.isAutoWinner({ origin: "manual" })).toBe(false);
    expect(back.isAutoWinner({ origin: "manual", autoFirstAt: 1 })).toBe(true);
  });
});

describe("creative copy", () => {
  test("video creative", () => {
    const long = "word ".repeat(200).trim();
    const r = back.readCreativeCopy({
      object_story_spec: {
        video_data: {
          video_id: "999",
          message: long,
          title: "A headline",
          call_to_action: { type: "LEARN_MORE" },
        },
      },
    });
    expect(r.format).toBe("video");
    expect(r.cta).toBe("Learn more");
    expect(r.headline).toBe("A headline");
    expect(r.videoId).toBe("999");
    expect(Array.from(r.body ?? "").length).toBe(300);
    expect(back.creativeCopyParts({ video_data: { message: long } }).body).toBe(
      long,
    );
  });
  test("carousel, image, unknown", () => {
    expect(
      back.readCreativeCopy({
        object_story_spec: { link_data: { child_attachments: [] } },
      }).format,
    ).toBe("carousel");
    expect(
      back.readCreativeCopy({
        object_story_spec: {
          link_data: { name: "N", call_to_action: { type: "ODD" } },
        },
      }),
    ).toMatchObject({ format: "image", headline: "N", cta: "ODD" });
    expect(back.readCreativeCopy({}).format).toBe("unknown");
    expect(back.readCreativeCopy(undefined).format).toBe("unknown");
  });
  test("clip never splits an emoji", () => {
    expect(back.clip("ab😀cd", 3)).toBe("ab😀");
    expect(back.clip(undefined, 3)).toBeUndefined();
  });
});

describe("sync write diff", () => {
  test("ignores bookkeeping fields and missing vs undefined", () => {
    expect(
      back.sameStoredRow(
        {
          _id: "1",
          _creationTime: 1,
          syncedAt: 1,
          name: "a",
          thumbUrl: undefined,
        },
        { syncedAt: 2, name: "a" },
      ),
    ).toBe(true);
  });
  test("spots a real change, a dropped field and an added field", () => {
    expect(back.sameStoredRow({ name: "a" }, { name: "b" })).toBe(false);
    expect(
      back.sameStoredRow({ name: "a", previewSrc: "x" }, { name: "a" }),
    ).toBe(false);
    expect(
      back.sameStoredRow({ name: "a" }, { name: "a", stillUrl: "u" }),
    ).toBe(false);
    expect(back.sameStoredRow({ n: 1 }, { n: 1 })).toBe(true);
    expect(back.sameStoredRow({ tags: ["a"] }, { tags: ["a"] })).toBe(true);
  });
});

describe("frontend copy matches the backend", () => {
  const urls = [
    undefined,
    "",
    "junk",
    cdn(),
    cdn("68c9a000"),
    cdn(hex(NOW + 5 * 60_000)),
    cdn(hex(NOW + 11 * 60_000)),
    cdn(hex(NOW - HOUR)),
    cdn("68c9a000", "example.com"),
    cdn("68c9a000", "scontent.cdninstagram.com"),
  ];
  test("metaImageExpiry and metaImageUsable agree", () => {
    for (const u of urls) {
      expect(front.metaImageExpiry(u)).toBe(back.metaImageExpiry(u));
      expect(front.metaImageUsable(u, NOW)).toBe(back.metaImageUsable(u, NOW));
    }
  });
  test("keys, links and the preview age agree", () => {
    expect(front.PREVIEW_MAX_AGE_MS).toBe(back.PREVIEW_MAX_AGE_MS);
    for (const [c, a] of [
      ["1", "2"],
      [undefined, "2"],
      [null, null],
    ] as const)
      expect(front.stillKeyFor(c, a)).toBe(back.stillKeyFor(c, a));
    expect(front.adsManagerUrl("123", "act_9")).toBe(
      back.adsManagerUrl("123", "act_9"),
    );
    expect(front.adsManagerUrl("123")).toBe(back.adsManagerUrl("123"));
  });
});
