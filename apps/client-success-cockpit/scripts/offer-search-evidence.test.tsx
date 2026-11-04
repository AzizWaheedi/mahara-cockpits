import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allOfferLoaded, allOfferModel } from "../src/dev/offer/allFixtures";
import { emptyLive } from "../src/present/channel";
import type { SlideCtx } from "../src/present/deckContext";
import { deckData } from "../src/present/deckData";
import { ScopeVisual } from "../src/present/offer/ScopeVisual";
import {
  SEARCH_CAPTURES,
  SEARCH_STAGES,
  SearchExamples,
  searchExampleSlide,
} from "../src/present/offer/SearchExamples";
import { offerCopy } from "../src/present/offer/useOffer";

function context(lang: "en" | "ar"): SlideCtx {
  const loaded = allOfferLoaded("seo_geo");
  const deck = "offer_seo_geo";
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
    offer: allOfferModel("seo_geo"),
  };
}

describe("real search evidence remains a presenter-controlled story", () => {
  for (const lang of ["en", "ar"] as const)
    test(`${lang}: three evidence stops retain two channels and approved profile wording`, () => {
      const ctx = context(lang);
      const slide = searchExampleSlide();
      expect(slide.stops?.(ctx)).toBe(3);
      const copy = offerCopy(ctx.offer!, lang)!;
      for (const [tour, channel] of SEARCH_STAGES.entries()) {
        const html = renderToStaticMarkup(
          <SearchExamples ctx={{ ...ctx, tour }} />,
        );
        expect(html).toContain(
          lang === "en" ? "Two ways clients find you" : "طريقتان ليجدك العملاء",
        );
        expect(html).toContain(`dir="${lang === "ar" ? "rtl" : "ltr"}"`);
        expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
        expect((html.match(/<button/g) ?? []).length).toBe(3);
        expect((html.match(/<img/g) ?? []).length).toBe(1);
        expect(html).toContain(SEARCH_CAPTURES[channel].src);
        expect(html).toContain(
          SEARCH_CAPTURES[channel].url.replaceAll("&", "&amp;"),
        );
        expect(slide.stopName?.(tour, ctx)?.[lang]).toBe(
          SEARCH_CAPTURES[channel].name,
        );
        expect(html).not.toContain("<iframe");
        expect(html).not.toContain("<video");
        if (channel === "profile") {
          expect(html).toContain('data-shape="profile"');
          expect(html).toContain("Decoria");
          expect(html).toContain(
            renderToStaticMarkup(
              <h2>{copy.get.find(item => item.key === "profile")!.text}</h2>,
            ),
          );
          expect(html).not.toContain(
            lang === "en" ? "A real search, in Dubai" : "بحث حقيقي في دبي",
          );
        }
      }
    });

  test("scope follows stable catalog keys, even if the catalog order changes", () => {
    const ctx = context("en");
    const copy = offerCopy(ctx.offer!, "en")!;
    const reordered = { ...copy, get: [...copy.get].reverse() };
    for (const [key, channel] of [
      ["profile", "profile"],
      ["pages", "chatgpt"],
    ] as const) {
      const active = reordered.get.findIndex(item => item.key === key);
      const html = renderToStaticMarkup(
        <ScopeVisual
          kind="seo_geo"
          copy={reordered}
          ctx={ctx}
          active={active}
        />,
      );
      expect(html).toContain(SEARCH_CAPTURES[channel].src);
    }
  });

  test("missing preparation and stale tour positions keep a valid source", () => {
    const ctx = context("ar");
    const profile = renderToStaticMarkup(
      <SearchExamples ctx={{ ...ctx, offer: null, tour: 1 }} />,
    );
    expect(profile).toContain("Google Business Profile</h2>");
    for (const [tour, channel] of [
      [-4, "google"],
      [50, "chatgpt"],
    ] as const) {
      const html = renderToStaticMarkup(
        <SearchExamples ctx={{ ...ctx, tour }} />,
      );
      expect(html).toContain(SEARCH_CAPTURES[channel].src);
    }
  });
});

test("clicks and external step changes share state, failed source recovers after a source change", async () => {
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
    return <SearchExamples ctx={{ ...ctx, tour, setTour }} />;
  }
  const click = async (index: number) => {
    await act(async () =>
      host
        .querySelectorAll("button")
        [index].dispatchEvent(
          new win.MouseEvent("click", { bubbles: true, detail: 0 }),
        ),
    );
  };
  try {
    await act(async () => root.render(<Harness />));
    await click(1);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      SEARCH_CAPTURES.profile.src,
    );
    expect(host.querySelectorAll('[aria-pressed="true"]').length).toBe(1);
    await act(async () =>
      host.querySelector("img")!.dispatchEvent(new win.Event("error")),
    );
    expect(host.querySelector("img")).toBeNull();
    expect(
      host.querySelector('[data-capture-state="unavailable"]'),
    ).not.toBeNull();
    expect(
      host.querySelector(".dse-capture-fallback")?.getAttribute("href"),
    ).toBe(SEARCH_CAPTURES.profile.url);
    await click(2);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      SEARCH_CAPTURES.chatgpt.src,
    );
    await click(1);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      SEARCH_CAPTURES.profile.src,
    );
    expect(host.querySelector(".dse-capture-fallback")).toBeNull();
    await act(async () =>
      root.render(<SearchExamples ctx={{ ...ctx, tour: 2 }} />),
    );
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      SEARCH_CAPTURES.chatgpt.src,
    );
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
