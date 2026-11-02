import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { allOfferLoaded, allOfferModel } from "../src/dev/offer/allFixtures";
import { emptyLive } from "../src/present/channel";
import type { SlideCtx } from "../src/present/deckContext";
import { deckData } from "../src/present/deckData";
import {
  deckOfOffer,
  OFFER_KEYS,
  type OfferKey,
} from "../src/present/offer/kinds";
import { OfferJourney } from "../src/present/offer/OfferJourney";
import { journeyEvidence } from "../src/present/offer/OfferJourneyScene";
import { offerCopy } from "../src/present/offer/useOffer";

function context(key: OfferKey, lang: "en" | "ar"): SlideCtx {
  const loaded = allOfferLoaded(key);
  const deck = deckOfOffer(key);
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
    offer: allOfferModel(key),
  };
}

describe("delivery story keeps the full approved path and labelled evidence", () => {
  for (const key of OFFER_KEYS)
    for (const lang of ["en", "ar"] as const)
      test(`${key}/${lang}: every selected step preserves copy and has one active path node`, () => {
        const ctx = context(key, lang);
        const copy = offerCopy(ctx.offer!, lang)!;
        for (let active = 0; active < copy.steps.length; active++) {
          const html = renderToStaticMarkup(
            <OfferJourney copy={copy} ctx={{ ...ctx, tour: active }} />,
          );
          expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1);
          expect((html.match(/data-current="true"/g) ?? []).length).toBe(1);
          expect((html.match(/class="dko-journey-node"/g) ?? []).length).toBe(
            copy.steps.length,
          );
          expect((html.match(/<button/g) ?? []).length).toBe(copy.steps.length);
          for (const step of copy.steps) {
            const escaped = renderToStaticMarkup(<span>{step.text}</span>);
            expect(html).toContain(escaped);
          }
          expect(html).toContain(`data-service="${key}"`);
          expect(html).not.toContain("<iframe");
          expect(html).not.toContain("<video");
        }
      });

  test("search follows real Google, Business Profile and ChatGPT captures at the relevant steps", () => {
    const ctx = context("seo_geo", "en");
    const copy = offerCopy(ctx.offer!, "en")!;
    expect(journeyEvidence(copy, ctx, 0)).toMatchObject({
      label: "Google",
      example: true,
    });
    const fix = copy.steps.findIndex(step => step.key === "fix");
    expect(journeyEvidence(copy, ctx, fix)).toMatchObject({
      label: "Google Business Profile",
      shape: "screen",
      example: true,
    });
    const write = copy.steps.findIndex(step => step.key === "write");
    expect(journeyEvidence(copy, ctx, write)).toMatchObject({
      label: "ChatGPT",
      example: true,
    });
  });

  test("the user-selected website remains an example in either device shape", () => {
    const ctx = context("website", "ar");
    const copy = offerCopy(ctx.offer!, "ar")!;
    expect(journeyEvidence(copy, ctx, 0)).toMatchObject({
      label: "Joe & Sera",
      shape: "screen",
      example: true,
    });
    const live = copy.steps.findIndex(step => step.key === "live");
    expect(journeyEvidence(copy, ctx, live)).toMatchObject({
      label: "Joe & Sera",
      shape: "portrait",
      example: true,
    });
  });

  test("only reviewed actor thumbnails are used, with no embedded player", () => {
    const ctx = context("ugc", "en");
    const copy = offerCopy(ctx.offer!, "en")!;
    for (let active = 0; active < copy.steps.length; active++) {
      const evidence = journeyEvidence(copy, ctx, active);
      expect(evidence?.src).toStartWith(
        "https://embed-ssl.wistia.com/deliveries/",
      );
      expect(evidence).toMatchObject({ shape: "portrait", example: true });
    }
    expect(
      journeyEvidence(
        {
          ...copy,
          work: [
            {
              key: "untrusted",
              label: "Unknown",
              url: "https://example.com/image.jpg",
            },
          ],
        },
        ctx,
        0,
      ),
    ).toBeNull();
  });

  test("a client's chosen still remains labelled as an illustrative example", () => {
    const ctx = context("cameraman", "en");
    const copy = offerCopy(ctx.offer!, "en")!;
    ctx.offer!.stills = [
      { url: "https://example.com/approved-client.jpg" },
    ] as NonNullable<typeof ctx.offer>["stills"];
    expect(journeyEvidence(copy, ctx, 0)).toMatchObject({
      src: "https://example.com/approved-client.jpg",
      example: true,
    });
  });

  test("the closer path uses a diagram when no approved media exists", () => {
    const ctx = context("closer", "en");
    const copy = offerCopy(ctx.offer!, "en")!;
    expect(journeyEvidence(copy, ctx, 0)).toBeNull();
    const html = renderToStaticMarkup(<OfferJourney copy={copy} ctx={ctx} />);
    expect(html).toContain('data-evidence="diagram"');
    expect(html).not.toContain("<img");
  });
});

test("failed media becomes an unclaimed diagram and each source change gets a fresh attempt", async () => {
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
  const ctx = context("seo_geo", "en");
  const copy = offerCopy(ctx.offer!, "en")!;
  const render = async (tour: number) => {
    await act(async () =>
      root.render(<OfferJourney copy={copy} ctx={{ ...ctx, tour }} />),
    );
  };
  const fail = async () => {
    const image = host.querySelector("img")!;
    await act(async () => image.dispatchEvent(new win.Event("error")));
  };
  const caption = () =>
    host.querySelector(".dko-journey-evidence-caption")!.textContent;
  try {
    await render(0);
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("Google");
    await fail();
    expect(host.querySelector("img")).toBeNull();
    expect(
      host.querySelector('[data-evidence-state="unavailable"]'),
    ).not.toBeNull();
    expect(host.querySelector(".dko-journey-role")).not.toBeNull();
    expect(caption()).toBe("Example");
    expect(host.querySelectorAll(".dko-journey-steps button").length).toBe(
      copy.steps.length,
    );
    await render(copy.steps.findIndex(step => step.key === "write"));
    expect(host.querySelectorAll("img").length).toBe(1);
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("ChatGPT");
    expect(caption()).toContain("ChatGPT");
    await fail();
    expect(caption()).toBe("Example");
    await render(0);
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("Google");
    expect(host.querySelector(".dko-journey-role")).toBeNull();
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
