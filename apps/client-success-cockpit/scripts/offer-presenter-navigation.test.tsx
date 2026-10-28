import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  offerSlideDirection,
  offerSlideFrom,
} from "../src/present/offer/navigation";
import { OfferVideoPreview } from "../src/present/offer/OfferVideoPreview";
import {
  SEARCH_CAPTURES,
  SearchCapture,
} from "../src/present/offer/SearchExamples";
import { catalogDeckVideos } from "../src/present/offer/videos";

test("Space and clicker page keys move a whole slide, independently of its reveal count", () => {
  for (const key of [" ", "Spacebar", "PageDown"]) {
    expect(offerSlideDirection(key)).toBe(1);
    expect(
      offerSlideFrom({ index: 1, tour: 5 }, offerSlideDirection(key)!, 7),
    ).toEqual({ index: 2, tour: 0 });
  }
  expect(offerSlideDirection(" ", true)).toBe(-1);
  expect(offerSlideDirection("PageUp")).toBe(-1);
  expect(offerSlideDirection("ArrowRight")).toBeNull();
  expect(offerSlideFrom({ index: 0, tour: 3 }, -1, 7)).toBeNull();
  expect(offerSlideFrom({ index: 6, tour: 0 }, 1, 7)).toBeNull();
  expect(offerSlideFrom({ index: 3, tour: 2 }, -1, 7)).toEqual({
    index: 2,
    tour: 0,
  });
});

const row = {
  deck: "offer_seo_geo",
  slotKey: "demo",
  lang: "en",
  provider: "wistia",
  url: "https://fast.wistia.net/embed/iframe/qlwysqfu2g",
  embedUrl: "https://fast.wistia.net/embed/iframe/qlwysqfu2g",
  title: "Fixture only",
  durationSeconds: 54,
  revision: 1,
};
test("catalog recordings retain URL validation without inventing missing edit metadata", () => {
  const result = catalogDeckVideos([row]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].updatedAt).toBe("");
  expect(
    catalogDeckVideos([{ ...row, embedUrl: "https://evil.example/embed" }])
      .rows,
  ).toHaveLength(0);
  expect(
    catalogDeckVideos([{ ...row, provider: "youtube" }]).rows,
  ).toHaveLength(0);
  expect(
    catalogDeckVideos([{ ...row, url: "javascript:alert(1)" }]).rows,
  ).toHaveLength(0);
});
test("the library does not load or autoplay a video before the presenter chooses it", () => {
  const html = renderToStaticMarkup(
    <OfferVideoPreview row={catalogDeckVideos([row]).rows[0]} />,
  );
  expect(html).toContain("Play video");
  expect(html).not.toContain("iframe");
});
test("both languages use the same authentic source pixels, not invented localized results", () => {
  for (const lang of ["en", "ar"] as const)
    for (const channel of ["google", "chatgpt"] as const) {
      const html = renderToStaticMarkup(
        <SearchCapture channel={channel} lang={lang} />,
      );
      expect(html).toContain(SEARCH_CAPTURES[channel].src);
      expect(html).toContain(SEARCH_CAPTURES[channel].name);
    }
});
