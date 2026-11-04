import { presentUrls } from "../src/present/presentUrls";
import { catalogPreviewModel } from "../src/present/offer/CatalogDeckCanvas";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  allOfferLoaded,
  allOfferModel,
  ALL_CATALOG,
} from "../src/dev/offer/allFixtures";
import { emptyLive, channelName } from "../src/present/channel";
import { deckData } from "../src/present/deckData";
import type { SlideCtx } from "../src/present/deckContext";
import { DECKS, TARGET_MINUTES, offerSlides } from "../src/present/decks";
import {
  BUILT_OFFER_DECKS,
  OFFER_KEYS,
  deckOfOffer,
  offerOfDeck,
  isOfferDeck,
} from "../src/present/offer/kinds";
import { wistiaExample, actorPoster } from "../src/present/offer/serviceDeck";
import { confirmOfferPrep } from "../src/present/offer/useOffer";
import {
  OFFER_VIDEO_SLOTS,
  offerVideoItems,
} from "../src/present/offer/videos";
import { OfferPicker } from "../src/present/offer/OfferPicker";
import { offerStatus } from "../src/dev/offer/fixtures";
import { offerIO } from "../src/present/offer/load";
import { fixturePitch } from "../src/dev/offer/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
function ctx(
  key: (typeof OFFER_KEYS)[number],
  lang: "en" | "ar",
  fixture: "full" | "noprice" | "dwy" = "full",
): SlideCtx {
  const f = allOfferLoaded(key, fixture),
    deck = deckOfOffer(key);
  const d = deckData({
    taskId: "fictional",
    deck,
    lang,
    sources: f.sources,
    kit: f.kit,
    prep: f.prep,
    ads: f.ads,
    videos: f.videos,
    now: new Date("2026-10-26"),
  });
  return {
    d,
    lang,
    deck,
    tour: 0,
    setTour: () => {},
    prep: f.prep[deck]!,
    prepOf: () => ({}),
    save: () => {},
    saveTo: () => {},
    live: emptyLive(),
    setLive: () => {},
    still: true,
    presenting: true,
    offer: allOfferModel(key, fixture),
  };
}
describe("every offer has its own presentation", () => {
  test("all seven kinds roundtrip and have separate registries, channels and video slots", () => {
    expect(BUILT_OFFER_DECKS).toHaveLength(7);
    for (const key of OFFER_KEYS) {
      const d = deckOfOffer(key);
      expect(offerOfDeck(d)).toBe(key);
      expect(isOfferDeck(d)).toBe(true);
      expect(DECKS[d]).toBeFunction();
      expect(TARGET_MINUTES[d]).toBeGreaterThan(0);
      expect(OFFER_VIDEO_SLOTS.find(v => v.deck === d)?.key).toBe("demo");
    }
    expect(isOfferDeck("offer_unknown")).toBe(false);
    expect(
      new Set(BUILT_OFFER_DECKS.map(d => channelName("fictional", d))).size,
    ).toBe(7);
  });
  for (const key of OFFER_KEYS)
    for (const lang of ["en", "ar"] as const)
      for (const fixture of ["full", "noprice", "dwy"] as const)
        test(`${key}/${lang}/${fixture}: all stops render current scope without private or other-offer data`, () => {
          const c = ctx(key, lang, fixture);
          const all = offerSlides(
            c.deck as (typeof BUILT_OFFER_DECKS)[number],
            c.offer,
          );
          expect(all.find(s => s.id === "get")).toBeDefined();
          expect(all.find(s => s.id === "investment")).toBeDefined();
          for (const slide of all) {
            for (let tour = 0; tour < (slide.stops?.(c) ?? 1); tour++) {
              const html = renderToStaticMarkup(slide.render({ ...c, tour }));
              expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(
                /upsell|renewal|CPL|guarantee|recruiter_name|opening_reason|Fictional recruiter/,
              );
              expect(html).not.toContain("<iframe");
              if (key !== "website")
                expect(html).not.toContain("Website, in Arabic and English");
            }
          }
          if (fixture === "noprice")
            expect(
              all.find(s => s.id === "investment")!.defaultHidden?.(c.d),
            ).toBe(true);
          if (key !== "website")
            expect(
              renderToStaticMarkup(
                all.find(s => s.id === "matters")!.render(c),
              ),
            ).toContain(ALL_CATALOG[key].copy[lang]!.deckTitle);
        });
  test("picker offers separate prep and proposal actions for every key", () => {
    const html = renderToStaticMarkup(
      <OfferPicker taskId="fictional" status={offerStatus()} client={null} />,
    );
    for (const key of OFFER_KEYS) {
      expect(html).toContain(`/present/offer/${key}?view=prep`);
      expect(html).toContain(`proposals/new?offer=${key}`);
    }
  });
  test("actor examples accept only exact reviewed Wistia shapes", () => {
    expect(
      wistiaExample("https://maharamedia.wistia.com/medias/btp2dokvjr"),
    ).toBe("https://fast.wistia.net/embed/iframe/btp2dokvjr");
    for (const v of [
      "https://evil.wistia.com/medias/btp2dokvjr",
      "https://maharamedia.wistia.com.evil.test/medias/btp2dokvjr",
      "https://x@maharamedia.wistia.com/medias/btp2dokvjr",
      "https://maharamedia.wistia.com:444/medias/btp2dokvjr",
      "https://maharamedia.wistia.com/medias/btp2dokvjr?track=secret",
      "javascript:alert(1)",
    ])
      expect(wistiaExample(v)).toBeNull();
  });
  test("each pitch language save targets and reads back the selected offer before logging", async () => {
    for (const key of OFFER_KEYS) {
      const f = allOfferLoaded(key);
      const writes: unknown[] = [];
      let flushed = false;
      await confirmOfferPrep(
        { language: "en" },
        "ar",
        (deck, patch) => {
          writes.push({ deck, patch });
        },
        async () => {
          flushed = true;
        },
        async () => ({
          ...f.offer!,
          prep: { ...f.offer!.prep!, overrides: { language: "ar" } },
        }),
        deckOfOffer(key),
      );
      expect(flushed).toBe(true);
      expect(writes).toEqual([
        { deck: deckOfOffer(key), patch: { language: "ar" } },
      ]);
    }
  });
  test("pitch IO never writes a nonwebsite pitch under website", async () => {
    for (const key of OFFER_KEYS) {
      const f = allOfferLoaded(key);
      let called: unknown;
      const client = {
        rpc: async (name: string, args: unknown) => {
          called = { name, args };
          return {
            data: fixturePitch(
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              {},
              null,
              f,
            ),
            error: null,
          };
        },
      } as unknown as SupabaseClient;
      await offerIO(client, "fictional", key).savePitch(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        {},
        null,
      );
      expect(called).toMatchObject({
        name: "cockpit_upsell_pitch_save",
        args: { p_offer: key, p_task_id: "fictional" },
      });
    }
  });
  test("video selection cannot bleed between offers", () => {
    const c = ctx("ugc", "en");
    const f = allOfferLoaded("website");
    c.d.videos.videos = f.videos!;
    expect(offerVideoItems(c.d)).toEqual([]);
  });
});

test("catalog previews use only passed rows and expose no persistence IO", async () => {
  for (const row of Object.values(ALL_CATALOG)) {
    const m = catalogPreviewModel(row);
    expect(m.io).toBeUndefined();
    expect(m.sources.gate.taskId).toBe("catalog-preview");
    expect(m.captures).toEqual([]);
    expect(m.goal).toBeNull();
    expect(m.pitch).toBeNull();
    expect(await m.savePitch({ answer: "yes_paid" })).toBeNull();
    expect(m.row).toBe(row);
  }
});

test("casting uses the provider-verified full portrait files only", () => {
  expect(actorPoster("https://maharamedia.wistia.com/medias/qlwysqfu2g")).toBe(
    "https://embed-ssl.wistia.com/deliveries/ee0de9394a4d688f85de81165e1ceb13870c55d2.jpg",
  );
  expect(
    actorPoster("https://maharamedia.wistia.com/medias/abcdefghij"),
  ).toBeNull();
  expect(actorPoster("https://evil.test/medias/qlwysqfu2g")).toBeNull();
});

test("every offer keeps its own present, notes, prep and return URLs", () => {
  for (const key of OFFER_KEYS) {
    const u = presentUrls("task/with spaces", deckOfOffer(key), "ar");
    const base = `/client-success/clients/task%2Fwith%20spaces/present/offer/${key}`;
    expect(u).toEqual({
      deck: `${base}?lang=ar`,
      notes: `${base}/notes?lang=ar`,
      prep: `${base}?view=prep`,
      other: `${base}?view=prep`,
      client: "/client-success/clients/task%2Fwith%20spaces?tab=money",
    });
  }
  expect(presentUrls("task", "blueprint", "ar", true).deck).toBe(
    "/client-success/clients/task/present/blueprint?lang=ar&rehearse=1",
  );
  expect(presentUrls("task", "onboarding").other).toBe(
    "/client-success/clients/task/present/launch?view=prep",
  );
});
