import { describe, expect, test } from "bun:test";
import {
  allowedOfferOrigin,
  doorRoute,
  embedOk,
  LIVE_OFFER_SITE,
  missingFor,
  missingSentence,
  normalizeOfferCode,
  offerSite,
  PREVIEW_TOKEN,
  PROPOSAL_CODE,
  pictureRefs,
  posterOk,
  publicUrl,
  refOk,
  VIDEO_CODE,
  videoPageOk,
  withLinks,
} from "./door.ts";

// The door's pure rules. handler.test.ts drives the routes end to end.

describe("routes", () => {
  test("with or without the function's name in front", () => {
    expect(doorRoute("/offer-door/p/k7q2mxab3cde")).toEqual({ name: "p", code: "k7q2mxab3cde" });
    expect(doorRoute("/functions/v1/offer-door/p/k7q2mxab3cde/event")).toEqual({ name: "event", code: "k7q2mxab3cde" });
    expect(doorRoute("/v/k7q2mxab3c")).toEqual({ name: "v", code: "k7q2mxab3c" });
    expect(doorRoute("/offer-door/health")).toEqual({ name: "health" });
    expect(doorRoute("/offer-door/HEALTH")).toEqual({ name: "health" });
  });

  test("anything else is no route", () => {
    for (const path of ["/", "/offer-door", "/offer-door/p", "/offer-door/p/a/b", "/offer-door/p/a/events", "/offer-door/health/x", "/offer-door/open/abc", "/offer-door/v"]) {
      expect([path, doorRoute(path).name]).toEqual([path, null]);
    }
  });

  test("a broken escape is an unknown code, and a code is cut at 40 characters", () => {
    expect(doorRoute("/offer-door/p/%E0%A4%A").code).toBe("%E0%A4%A");
    expect(doorRoute(`/offer-door/p/${"a".repeat(80)}`).code?.length).toBe(40);
  });
});

describe("codes", () => {
  test("the alphabet has no i, l, o, 0 or 1", () => {
    expect(PROPOSAL_CODE.test("k7q2mxab3cde")).toBe(true);
    for (const bad of ["k7q2mxab3cdi", "k7q2mxab3cdl", "k7q2mxab3cdo", "k7q2mxab3cd0", "k7q2mxab3cd1", "k7q2mxab3cd", "k7q2mxab3cdef"]) expect([bad, PROPOSAL_CODE.test(bad)]).toEqual([bad, false]);
    expect(VIDEO_CODE.test("k7q2mxab3c")).toBe(true);
    expect(PREVIEW_TOKEN.test("k7q2mxab3cdek7q2mxab3cde")).toBe(true);
  });

  test("as it may arrive from a message: case, invisible marks, punctuation glued on", () => {
    expect(normalizeOfferCode("K7Q2MXAB3CDE", PROPOSAL_CODE)).toBe("k7q2mxab3cde");
    expect(normalizeOfferCode("\u200fk7q2mxab3cde\u200e", PROPOSAL_CODE)).toBe("k7q2mxab3cde");
    expect(normalizeOfferCode("k7q2mxab3cde.", PROPOSAL_CODE)).toBe("k7q2mxab3cde");
    expect(normalizeOfferCode("k7q2mxab3cde\u060c", PROPOSAL_CODE)).toBe("k7q2mxab3cde");
    expect(normalizeOfferCode("k7q2mxab3cdex", PROPOSAL_CODE)).toBeNull();
    expect(normalizeOfferCode("k7q2mxab3c", PROPOSAL_CODE)).toBeNull();
    expect(normalizeOfferCode(42, PROPOSAL_CODE)).toBeNull();
  });
});

describe("the page's origin", () => {
  test("only the offer site, or a local run", () => {
    const site = offerSite("");
    expect(site).toBe(LIVE_OFFER_SITE);
    expect(allowedOfferOrigin("https://offer.maharamedia.com", site)).toBe("https://offer.maharamedia.com");
    expect(allowedOfferOrigin("http://localhost:5421", site)).toBe("http://localhost:5421");
    expect(allowedOfferOrigin("http://127.0.0.1:5312", site)).toBe("http://127.0.0.1:5312");
    for (const bad of [null, "", "null", "https://evil.com", "http://offer.maharamedia.com", "https://offer.maharamedia.com.evil.com", "https://offer.maharamedia.com/", "https://localhost:5421", "http://localhost.evil.com"]) {
      expect([bad, allowedOfferOrigin(bad, site)]).toEqual([bad, null]);
    }
  });

  test("OFFER_SITE_URL is used only when it is a bare https origin", () => {
    expect(offerSite("https://offer-preview.maharamedia.com/")).toBe("https://offer-preview.maharamedia.com");
    for (const bad of ["http://offer.maharamedia.com", "https://offer.maharamedia.com/path", "javascript:alert(1)", "offer.maharamedia.com"]) expect(offerSite(bad)).toBe(LIVE_OFFER_SITE);
  });
});

describe("where a video link may send a person", () => {
  test("the saved video's own page on one of the five providers", () => {
    for (const ok of [
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://vimeo.com/123456789",
      "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      "https://fast.wistia.net/embed/iframe/abc123defg",
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view",
    ]) expect([ok, videoPageOk(ok)]).toEqual([ok, ok]);
    for (const bad of [
      "http://www.youtube.com/watch?v=abcdefghijk",
      "https://evil.com/watch",
      "https://www.youtube.com.evil.com/",
      "https://user@www.youtube.com/",
      "https://www.youtube.com:8443/",
      "javascript:alert(1)",
      "//evil.com",
      null,
      42,
    ]) expect([bad, videoPageOk(bad)]).toEqual([bad, null]);
  });

  test("players and posters the page may load", () => {
    expect(embedOk("https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0")).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0");
    expect(embedOk("https://www.youtube.com/embed/abcdefghijk")).toBeNull();
    expect(posterOk("https://i.ytimg.com/vi/x/hqdefault.jpg")).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(posterOk("https://lh3.googleusercontent.com/x")).toBeNull();
  });
});

describe("pictures", () => {
  const proposal = {
    lang: "en",
    title: "Your website",
    clientName: "Acme Interiors",
    logo: { bucket: "cockpit-launch-ads", path: "taskA1/3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b.png", alt: "Acme Interiors" },
    found: [
      { bucket: "cockpit-upsell-files", path: "taskA1/11111111-2222-4333-8444-555555555555.png", caption: "Your site today", capturedOn: "2026-10-26", searchedAs: null },
      { bucket: "cockpit-upsell-files", path: "taskA1/../../secrets.png", caption: "x", capturedOn: "2026-10-26", searchedAs: null },
      { bucket: "some-other-bucket", path: "a/b.png", caption: "x", capturedOn: "2026-10-26", searchedAs: null },
    ],
    video: { provider: "youtube", embedUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0", posterUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", title: "Demo" },
  };

  test("only known buckets and plain paths are signed", () => {
    expect(pictureRefs(proposal)).toEqual([
      { bucket: "cockpit-launch-ads", path: "taskA1/3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b.png" },
      { bucket: "cockpit-upsell-files", path: "taskA1/11111111-2222-4333-8444-555555555555.png" },
    ]);
    expect(refOk({ bucket: "cockpit-client-logos", path: "acme-logo.png" })).toEqual({ bucket: "cockpit-client-logos", path: "acme-logo.png" });
    expect(refOk({ bucket: "cockpit-client-logos", path: "/etc/passwd" })).toBeNull();
    expect(pictureRefs(null)).toEqual([]);
  });

  test("each picture becomes a link; one with no link is left out; bucket and path never leave", () => {
    const links = new Map([["cockpit-upsell-files/taskA1/11111111-2222-4333-8444-555555555555.png", "https://db.test/storage/v1/object/sign/cockpit-upsell-files/x?token=t"]]);
    const out = withLinks(proposal, links) as Record<string, unknown>;
    expect(out.logo).toBeNull();
    expect(out.found).toEqual([{ url: "https://db.test/storage/v1/object/sign/cockpit-upsell-files/x?token=t", caption: "Your site today", capturedOn: "2026-10-26", searchedAs: null }]);
    expect(JSON.stringify(out)).not.toMatch(/"bucket"|"path"|taskA1/);
    expect(out.video).toEqual(proposal.video);
    expect((withLinks({ ...proposal, video: { ...proposal.video, embedUrl: "https://evil.com/x" } }, links) as Record<string, unknown>).video).toBeNull();
    expect(publicUrl("https://db.test", { bucket: "cockpit-client-logos", path: "acme/logo one.png" })).toBe("https://db.test/storage/v1/object/public/cockpit-client-logos/acme/logo%20one.png");
  });
});

describe("missing secrets", () => {
  test("named, never their values", () => {
    const env = (n: string) => ({ SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_value" })[n] ?? "";
    expect(missingFor("p", env)).toEqual(["OFFER_IP_SALT"]);
    expect(missingSentence("p", ["OFFER_IP_SALT"])).toBe("Proposal pages cannot open: OFFER_IP_SALT is missing on offer-door. Add it to the function's secrets.");
    expect(missingSentence("v", ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OFFER_IP_SALT"])).toBe(
      "Video links cannot open: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OFFER_IP_SALT are missing on offer-door. Add them to the function's secrets.",
    );
  });
});
