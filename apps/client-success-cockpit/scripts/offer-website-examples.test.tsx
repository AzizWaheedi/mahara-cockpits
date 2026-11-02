import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allOfferLoaded, allOfferModel } from "../src/dev/offer/allFixtures";
import { emptyLive } from "../src/present/channel";
import type { SlideCtx } from "../src/present/deckContext";
import { deckData } from "../src/present/deckData";
import {
  WEBSITE_EXAMPLES,
  WebsiteExample,
  WebsiteReferenceImage,
  websiteExampleSlide,
} from "../src/present/offer/WebsiteExample";

function context(lang: "en" | "ar"): SlideCtx {
  const loaded = allOfferLoaded("website");
  const deck = "offer_website";
  return {
    d: deckData({
      taskId: "fictional",
      deck,
      lang,
      sources: loaded.sources,
      kit: loaded.kit,
      prep: loaded.prep,
      ads: loaded.ads,
      videos: loaded.videos,
      now: new Date("2026-10-28"),
    }),
    lang,
    deck,
    tour: 0,
    setTour: () => {},
    prep: loaded.prep[deck]!,
    prepOf: () => ({}),
    save: () => {},
    saveTo: () => {},
    live: emptyLive(),
    setLive: () => {},
    still: true,
    presenting: true,
    offer: allOfferModel("website"),
  };
}

describe("three user-selected public website examples", () => {
  for (const lang of ["en", "ar"] as const)
    test(`${lang}: each stop has the correct real source, date and supported device`, () => {
      const ctx = context(lang);
      const slide = websiteExampleSlide();
      expect(slide.stops?.(ctx)).toBe(3);
      expect(WEBSITE_EXAMPLES.map(site => site.url)).toEqual([
        "https://joeandsera.com/",
        "https://stratum.framer.ai/",
        "https://greystonegcc.com/",
      ]);
      for (const [tour, site] of WEBSITE_EXAMPLES.entries()) {
        const html = renderToStaticMarkup(
          <WebsiteExample ctx={{ ...ctx, tour }} />,
        );
        expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
        expect(html).toContain(site.url);
        expect(html).toContain(site.desktop!.src);
        expect(html).toContain(lang === "en" ? "Example" : "مثال");
        expect(html).toContain(
          lang === "en"
            ? `Captured ${site.captured}`
            : `لقطة بتاريخ ${site.captured.replace(/[0-9]/g, value => "٠١٢٣٤٥٦٧٨٩"[Number(value)])}`,
        );
        expect(slide.stopName?.(tour, ctx)?.[lang]).toBe(site.name);
        expect(html).not.toContain("<iframe");
        expect(html).not.toContain("<video");
        if (site.mobile) {
          expect(html).toContain(site.mobile.src);
          expect(html).toContain('aria-label="390 × 844"');
        } else {
          expect(html).not.toContain('class="dsv-reference-mobile"');
          expect(html).not.toContain('class="dsv-device-picker"');
          expect(html).toContain('data-has-mobile="false"');
          expect(html).toContain("1470 × 662");
        }
      }
    });
  test("quick pitch does not depend on client preparation and stale stop values remain safe", () => {
    const ctx = context("en");
    for (const [tour, site] of [
      [-1, WEBSITE_EXAMPLES[0]],
      [20, WEBSITE_EXAMPLES[2]],
    ] as const) {
      const html = renderToStaticMarkup(
        <WebsiteExample ctx={{ ...ctx, offer: null, prep: {}, tour }} />,
      );
      expect(html).toContain(
        `<h1 dir="ltr">${site.name.replaceAll("&", "&amp;")}</h1>`,
      );
      expect(html).toContain(site.url);
    }
  });
  test("a missing screenshot displays the known source without an invented image", () => {
    const html = renderToStaticMarkup(
      <WebsiteReferenceImage image={null} site={WEBSITE_EXAMPLES[1]} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('class="dsv-reference-fallback"');
    expect(html).toContain('href="https://stratum.framer.ai/"');
  });
});

test("site and device controls keep their state; image failures reset for another source", async () => {
  const { Window } = await import("happy-dom");
  const win = new Window({ url: "https://localhost/client-success/" });
  const names = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
    "DocumentFragment",
    "Text",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const old = new Map(
    names.map(name => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : name === "window"
            ? win
            : (win as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const ctx = context("en");
  function Harness() {
    const [tour, setTour] = useState(0);
    return <WebsiteExample ctx={{ ...ctx, tour, setTour }} />;
  }
  const select = async (index: number) => {
    await act(async () =>
      host
        .querySelectorAll(".dsv-site-picker button")
        [index].dispatchEvent(
          new win.MouseEvent("click", { bubbles: true, detail: 0 }),
        ),
    );
  };
  const selected = () =>
    host.querySelector('.dsv-site-picker [aria-pressed="true"]')?.textContent;
  try {
    await act(async () => root.render(<Harness />));
    await act(async () =>
      host
        .querySelector('[aria-label="390 × 844"]')!
        .dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
    );
    expect(
      host.querySelector(".dsv-real-example")?.getAttribute("data-device"),
    ).toBe("mobile");
    await select(1);
    expect(selected()).toContain("Stratum");
    expect(
      host.querySelectorAll('.dsv-site-picker [aria-pressed="true"]').length,
    ).toBe(1);
    expect(
      host.querySelector(".dsv-real-example")?.getAttribute("data-device"),
    ).toBe("desktop");
    expect(host.querySelector(".dsv-reference-mobile")).toBeNull();
    await act(async () =>
      host
        .querySelector(".dsv-reference-desktop img")!
        .dispatchEvent(new win.Event("error")),
    );
    expect(host.querySelector(".dsv-reference-desktop img")).toBeNull();
    expect(
      host.querySelector(".dsv-reference-fallback")?.getAttribute("href"),
    ).toBe(WEBSITE_EXAMPLES[1].url);
    await select(2);
    expect(
      host.querySelector(".dsv-reference-desktop img")?.getAttribute("src"),
    ).toBe(WEBSITE_EXAMPLES[2].desktop!.src);
    await select(1);
    expect(
      host.querySelector(".dsv-reference-desktop img")?.getAttribute("src"),
    ).toBe(WEBSITE_EXAMPLES[1].desktop!.src);
    expect(host.querySelector(".dsv-reference-fallback")).toBeNull();
    await select(0);
    expect(host.querySelector(".dsv-reference-mobile")).not.toBeNull();
    await act(async () =>
      root.render(<WebsiteExample ctx={{ ...ctx, tour: 2 }} />),
    );
    expect(selected()).toContain("Greystone");
    expect(host.querySelectorAll("iframe,video").length).toBe(0);
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.abort();
    for (const name of names) {
      const descriptor = old.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
