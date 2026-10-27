import { FIXTURES } from "../../practice/fixtures/fixtures";
import { OFFER_KEYS } from "../../present/offer/kinds";
import { openingOf } from "../../present/offer/price";
import type {
  CatalogRow,
  OfferSources,
  OfferStatus,
  Pitch,
} from "../../present/offer/sources";
import type { OfferModel } from "../../present/offer/useOffer";
import {
  offerGoal,
  priceProblem,
  selectedCaptures,
} from "../../present/offer/useOffer";
import type { Loaded } from "../../present/useDeckModel";
import { WEBSITE_COPY } from "./catalogFixture";
export const OFFER_NOW = "2026-10-26T10:00:00Z";
export const OFFER_FIXTURES = [
  "full",
  "sparse",
  "dwy",
  "noprice",
  "saudi",
  "refused",
  "asked",
] as const;
export type OfferFixture = (typeof OFFER_FIXTURES)[number];
export const WEBSITE_ROW: CatalogRow = {
  offerKey: "website",
  sort: 1,
  parts: [
    { key: "build", cadence: "one_time", amount: 2000, hint: 2000 },
    { key: "care", cadence: "monthly", amount: 200, hint: 200 },
  ],
  locked: false,
  splitAllowed: false,
  splitParts: null,
  minMonths: null,
  waitsOn: null,
  copy: WEBSITE_COPY,
  revision: 1,
  updatedAt: OFFER_NOW,
  updatedBy: "fixture@example.test",
};
const captureImage = (title: string, line: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#f0f1f3"/><text x="60" y="80" fill="#24304a" font-size="30" font-family="sans-serif">FICTIONAL CAPTURE · Harness only</text><text x="60" y="180" fill="#34405a" font-size="44" font-family="sans-serif">${title}</text><rect x="60" y="230" width="1000" height="1" fill="#bbc3cc"/><text x="60" y="310" fill="#657080" font-size="28" font-family="sans-serif">${line}</text></svg>`)}`;
const capture = captureImage(
  "Example domain, parked",
  "This address is parked. The firm's website is not available.",
);
const searchCapture = captureImage(
  "Name search: Example design firm",
  "No website address on this fictional search result.",
);
export function offerLoaded(key: OfferFixture = "full"): Loaded {
  const loaded =
    FIXTURES[key === "dwy" ? "dwy" : key === "sparse" ? "sparse" : "full"](
      "offer_website",
    );
  const row = structuredClone(WEBSITE_ROW);
  if (key === "noprice") {
    row.parts.forEach(p => {
      p.amount = null;
    });
  }
  const s: OfferSources = {
    mode:
      key === "refused"
        ? "refused"
        : key === "asked"
          ? "client_asked"
          : "proactive",
    gate: {
      ok: key !== "refused" && key !== "asked",
      taskId: `offer-fixture-${key}`,
      checkedAt: OFFER_NOW,
      reasons:
        key === "refused" || key === "asked"
          ? [
              {
                key: "no_win",
                text: "No recent win is recorded. Ask the client and record what changed.",
                source: null,
                at: null,
              },
              {
                key: "recent_offer",
                text: "An offer was recorded recently. Wait until its next open date.",
                source: "pitch",
                at: OFFER_NOW,
              },
            ]
          : [],
      passed: [],
      win: {
        kind: "quotation",
        on: "2026-10-14",
        text: "A quotation is recorded.",
      },
      renewal: { date: "2027-01-30", from: "plan" },
      lastOffer: null,
    },
    catalog: key === "refused" ? null : row,
    prep: {
      overrides:
        key === "sparse"
          ? {}
          : {
              captures: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  mark: { x: 0.04, y: 0.36, w: 0.9, h: 0.35 },
                },
              ],
              goal_pick: "goal90",
              opening_price: { build: 2000, care: 200 },
              payment_link: "https://whop.com/checkout/fixture_only",
              project_value: {
                amount: key === "saudi" ? 150000 : 18000,
                currency: key === "saudi" ? "SAR" : "KWD",
                from: "onboarding",
                said_on: "2026-09-03",
              },
            },
      revision: 1,
      updatedAt: OFFER_NOW,
      updatedBy: "fixture@example.test",
    },
    files:
      key === "sparse"
        ? []
        : [
            {
              id: "11111111-1111-4111-8111-111111111111",
              kind: "capture",
              mime: "image/png",
              bytes: 1500,
              width: 1200,
              height: 600,
              fileName: "fictional-parked-page.png",
              searchedAs: null,
              capturedOn: "2026-10-26",
              caption: "Fictional parked page",
              createdAt: OFFER_NOW,
              path: "fixture/capture.png",
              url: capture,
            },
          ],
    site: {
      verdict: key === "sparse" ? "not_checked" : "broken",
      urls: [{ url: "https://example-firm.example", from: "card" }],
      checks: [
        { status: "parked", checkedAt: "2026-10-25T08:00:00Z" },
        { status: "parked", checkedAt: OFFER_NOW },
      ],
      disagree: false,
      instagramOnly: false,
      note:
        key === "sparse"
          ? "Site not checked yet"
          : "A parked page was recorded on two checks more than 20 hours apart.",
    },
    project: {
      onboarding: {
        answer: "Our typical project is around 15,000 dollars.",
        answeredOn: "2026-10-10",
      },
      sheet: null,
    },
    goals: {
      goal90: {
        answer: "Present our completed work clearly and look established.",
        answeredOn: "2026-10-10",
      },
      goal12_24: null,
      challenges: null,
      why: null,
    },
    country:
      key === "noprice"
        ? "BH"
        : key === "saudi"
          ? "SA"
          : key === "sparse"
            ? "AE"
            : "KW",
    currency:
      key === "noprice"
        ? "BHD"
        : key === "saudi"
          ? "SAR"
          : key === "sparse"
            ? "AED"
            : "KWD",
    fx: {
      usdPer:
        key === "noprice"
          ? null
          : key === "saudi"
            ? 0.2666
            : key === "sparse"
              ? 0.2723
              : 3.26,
      from: "cockpit_pay_usd_per",
      note:
        key === "noprice"
          ? "No BHD conversion recorded. The total stays in USD."
          : null,
    },
    pitches: [],
    heldFullRecently: false,
    doorLive: false,
    at: OFFER_NOW,
  };
  if (key === "noprice") {
    delete s.prep!.overrides.opening_price;
    delete s.prep!.overrides.project_value;
  }
  if (key === "sparse") {
    s.goals = { goal90: null, goal12_24: null, challenges: null, why: null };
    s.project = { onboarding: null, sheet: null };
  }
  if (key === "saudi") {
    s.prep!.overrides.dialect = "sa";
    s.goals.goal90 = {
      answer: WEBSITE_COPY.ar.get[1].text,
      answeredOn: "2026-09-03",
    };
  }
  if (key === "asked")
    s.prep!.overrides.client_asked = {
      words: "We would like to talk about a website.",
      on: "2026-10-25",
    };
  if (key === "full") {
    const stills = FIXTURES.full("launch")
      .ads.filter(a => a.kind === "custom" && a.mime.startsWith("image/"))
      .slice(0, 3)
      .map((ad, i) => ({
        ...ad,
        id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i + 1}`,
        taskId: s.gate.taskId,
        fileName: `Fictional project ${i + 1}.webp`,
        primaryText: null,
        headline: null,
        cta: null,
      }));
    loaded.ads = stills;
    s.prep!.overrides.example_stills = stills.map(a => a.id);
    s.project.onboarding = {
      answer: "Our typical project is 18,000 KWD.",
      answeredOn: "2026-09-03",
    };
    const ghl = loaded.sources?.ghl;
    if (ghl) {
      ghl.country = "KW";
      ghl.city = "Kuwait City";
    }
    s.files.push({
      ...s.files[0],
      id: "22222222-2222-4222-8222-222222222222",
      fileName: "fictional-search.png",
      caption: "Fictional name-search result",
      searchedAs: "Kuwait City",
      url: searchCapture,
    });
    s.prep!.overrides.captures = [
      ...(s.prep!.overrides.captures as unknown[]),
      { id: s.files[1].id },
    ];
    s.goals.challenges = {
      answer: "Our completed work is hard to find online.",
      answeredOn: "2026-09-03",
    };
  }
  return {
    ...loaded,
    offer: s,
    prep: { ...loaded.prep, offer_website: s.prep!.overrides },
    videos: {
      rows:
        key === "sparse"
          ? []
          : (["en", "ar"] as const).map(lang => ({
              deck: "offer_website" as const,
              slotKey: "demo",
              lang,
              provider: "youtube" as const,
              url: "https://www.youtube.com/watch?v=example0001",
              embedUrl: "https://www.youtube-nocookie.com/embed/example0001",
              posterUrl: null,
              title: WEBSITE_COPY[lang].deckTitle,
              durationSeconds: 60,
              revision: 1,
              updatedBy: "fixture@example.test",
              updatedAt: OFFER_NOW,
            })),
      refused: [],
      slots: ["offer_website:demo"],
    },
    problems: [],
  };
}
export function offerModel(loaded: Loaded): OfferModel {
  const s = loaded.offer!,
    prep = loaded.prep.offer_website ?? {};
  return {
    sources: s,
    row: s.catalog,
    prep,
    stills: loaded.ads.filter(
      a =>
        Array.isArray(prep.example_stills) &&
        prep.example_stills.includes(a.id),
    ),
    refused: s.mode === "refused",
    opening: s.catalog ? openingOf(s.catalog, prep) : null,
    priceProblem: priceProblem(s.catalog, prep),
    captures: selectedCaptures(s, prep),
    goal: offerGoal(s, prep),
    dialect: s.country === "SA" ? "sa" : "kw",
    pitch: null,
    busy: false,
    error: null,
    savePitch: async () => null,
  };
}
export function offerStatus(key: OfferFixture = "full"): OfferStatus {
  const s = offerLoaded(key).offer!;
  const missing: OfferStatus["offers"][number]["ready"]["missing"] = [];
  if (!s.files.length) missing.push("no_capture");
  if (priceProblem(s.catalog, s.prep?.overrides ?? {}))
    missing.push("no_price");
  if (!s.prep?.overrides.payment_link) missing.push("no_payment_link");
  const fit = s.site.verdict === "not_checked" ? null : true;
  const why = s.site.note ?? "No website on file.";
  const thisMonth = s.gate.ok && fit ? "website" : null;
  return {
    gate: { ok: s.gate.ok, reasons: s.gate.reasons },
    thisMonth,
    thisMonthWhy: thisMonth
      ? why
      : !s.gate.ok
        ? (s.gate.reasons[0]?.text ?? null)
        : "No offer fits yet: site not checked yet.",
    offers: OFFER_KEYS.map<OfferStatus["offers"][number]>(offer =>
      offer === "website"
        ? {
            key: offer,
            fit: { ok: fit, why },
            ready: { ok: missing.length === 0, missing },
            waitsOn: null,
            lastPitch: null,
          }
        : {
            key: offer,
            fit: { ok: null, why: "Deck and video follow the website." },
            ready: { ok: false, missing: ["no_price", "no_payment_link"] },
            waitsOn: "Deck and video follow the website.",
            lastPitch: null,
          },
    ),
  };
}
export function fixturePitch(
  requestId: string,
  patch: Record<string, unknown>,
  old: Pitch | null,
  loaded: Loaded,
): Pitch {
  return {
    id: old?.id ?? crypto.randomUUID(),
    requestId,
    taskId: loaded.offer!.gate.taskId,
    offerKey: "website",
    pitchedOn: "2026-10-26",
    csm: "fixture@example.test",
    mode: "proactive",
    clientWords: null,
    clientAskedOn: null,
    gate: loaded.offer!.gate,
    listPrice: { build: 2000, care: 200 },
    openingPrice: { build: 2000, care: 200 },
    openingReason: null,
    heldFull: patch.held_full === true || old?.heldFull === true,
    finalPrice:
      (patch.final_price as Pitch["finalPrice"]) ?? old?.finalPrice ?? null,
    finalReason: (patch.final_reason as string) ?? old?.finalReason ?? null,
    split: false,
    answer: (patch.answer as Pitch["answer"]) ?? old?.answer ?? null,
    followUpOn: (patch.follow_up_on as string) ?? old?.followUpOn ?? null,
    noReason: (patch.no_reason as string) ?? old?.noReason ?? null,
    paymentLink: "https://whop.com/checkout/fixture_only",
    lang: loaded.prep.offer_website?.language === "ar" ? "ar" : "en",
    videoCode: "abcdefghjk",
    revision: (old?.revision ?? 0) + 1,
    createdAt: OFFER_NOW,
    updatedAt: OFFER_NOW,
    updatedBy: "fixture@example.test",
  };
}
