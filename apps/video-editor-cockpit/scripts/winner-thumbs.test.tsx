/**
 * The picture on a winning ad's card (src/lib/thumbs.ts and
 * src/components/AdPreview.tsx). On 2026-10-22 no card on /editor/winners
 * showed one: every stored `thumb_url` was a Meta CDN link whose signature
 * ran out by 2026-10-08, and Meta answered each with 403. Rendered on the
 * server: nothing here signs in or reaches the network.
 */
import { afterAll, expect, test } from "bun:test";

const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const { createElement: h } = await import("react");
const { renderToString } = await import("react-dom/server");
const { default: AdPreviewFrame } = await import(
  "../src/components/AdPreview"
);
const { isOwnStill, metaExpiry, metaLinkExpired, pickPicture } = await import(
  "../src/lib/thumbs"
);

afterAll(() => {
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
});

// The newest stored link, as production holds it (signature trimmed).
const META =
  "https://scontent-iad3-1.xx.fbcdn.net/v/t15.5256-10/753715861_n.jpg?_nc_cat=101&stp=c0.5000x0.5000f_dst-emg0_p64x64_q75_tt6&oh=00_AQNz&oe=6AC4E6EE";
const STILL =
  "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/0968c806/736c9fb9";
const CONVEX =
  "https://adorable-seahorse-418.convex.cloud/api/storage/81039b44-72e0-4109-8917-fddf3f73ad3f";
const COPY =
  "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/sign/ad-videos/a.mp4?token=t";
const TODAY = new Date("2026-10-22T09:00:00Z");

test("a Meta link's expiry is read from its oe parameter", () => {
  expect(metaExpiry(META)?.toISOString()).toBe("2026-10-06T12:17:50.000Z");
  expect(metaLinkExpired(META, TODAY)).toBe(true);
  expect(metaLinkExpired(META, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  // No expiry, or not a link at all: nothing to say it ran out.
  expect(metaExpiry(STILL)).toBeNull();
  expect(metaLinkExpired("not a link", TODAY)).toBe(false);
});

test("only stills in our own storage count; Convex ones died with Convex", () => {
  expect(isOwnStill(STILL)).toBe(true);
  expect(isOwnStill(CONVEX)).toBe(false);
  expect(isOwnStill(META)).toBe(false);
});

test("a card reaches for pictures that last, best first", () => {
  const now = TODAY;
  expect(pickPicture({ still: STILL, ourCopy: COPY, thumbUrl: META, now })).toEqual({
    kind: "image",
    src: STILL,
  });
  expect(pickPicture({ still: CONVEX, ourCopy: COPY, thumbUrl: META, now })).toEqual({
    kind: "frame",
    src: COPY,
  });
  expect(pickPicture({ copyPending: true, thumbUrl: META, now })).toEqual({
    kind: "wait",
  });
  // An expired Meta link is never drawn: it would be a broken image.
  expect(pickPicture({ thumbUrl: META, now })).toEqual({ kind: "none" });
  expect(pickPicture({ thumbUrl: META, now: new Date("2026-10-01") })).toEqual({
    kind: "image",
    src: META,
  });
});

test("a picture that fails to load falls to the next one", () => {
  const now = TODAY;
  expect(
    pickPicture({ still: STILL, ourCopy: COPY, failed: new Set([STILL]), now }),
  ).toEqual({ kind: "frame", src: COPY });
  expect(
    pickPicture({ still: STILL, ourCopy: COPY, failed: new Set([STILL, COPY]), now }),
  ).toEqual({ kind: "none" });
});

test("the card draws no expired link, and says so when it has no picture", () => {
  const html = renderToString(
    h(AdPreviewFrame, { adId: "1", title: "Ad", thumbUrl: META }),
  );
  expect(html).not.toContain("fbcdn.net");
  expect(html).not.toContain("<img");
  expect(html).toContain("No picture saved");
  expect(html).toContain("lucide-image-off");
  expect(html).toContain("Watch");
});

test("the card draws our own still, with no placeholder", () => {
  const html = renderToString(
    h(AdPreviewFrame, {
      adId: "1",
      title: "Ad",
      thumbUrl: META,
      stillUrl: STILL,
    }),
  );
  expect(html).toContain(`src="${STILL}"`);
  expect(html).not.toContain("No picture saved");
});
