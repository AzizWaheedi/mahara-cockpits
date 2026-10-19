import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, type FixtureKey } from "../src/dev/deck/fixtures";
import { emptyLive } from "../src/present/channel";
import {
  challengeLines,
  cleanAnswer,
  heldReason,
  serviceChips,
} from "../src/present/clean";
import type { Lang } from "../src/present/content";
import { dayMonth, dayShort, when } from "../src/present/dates";
import type { SlideCtx } from "../src/present/deckContext";
import {
  countryFromAreas,
  type DeckData,
  deckData,
  initials,
  roadNowFor,
  shownGoals,
} from "../src/present/deckData";
import {
  firstAdsLine,
  leadService,
  nextStatus,
  onboardingSlides,
} from "../src/present/onboardingDeck";

/**
 * The fallbacks in docs/csm-decks/CONTENT.md's data map and DESIGN.md
 * section 14, on the harness's three clients: missing is never zero, an
 * unknown status reads "Not checked yet", an unbooked call shows no date,
 * no logo gives a monogram, and a form answer that counts appointments
 * stays off the canvas until the CSM edits it. Then every slide and stop is
 * rendered in both languages for each client.
 */

const NOW = new Date("2026-10-19T09:00:00Z");

function data(
  key: FixtureKey,
  lang: Lang = "en",
  deck: "onboarding" | "launch" = "onboarding",
): DeckData {
  const f = FIXTURES[key]();
  return deckData({
    taskId: `fixture-${key}`,
    deck,
    lang,
    sources: f.sources,
    kit: f.kit,
    prep: f.prep,
    ads: f.ads,
    presenterName: key === "sparse" ? null : "Sara Al-Harbi",
    publicUrl: (_b, p) => p,
    now: NOW,
  });
}

describe("a client with nothing on file", () => {
  const d = data("sparse");

  test("the name stands, initials stand in for the logo, the role for the CSM", () => {
    expect(d.name).toBe("Atlas Fit-Out & Renovation Contracting");
    expect(d.logo).toBeNull();
    expect(d.initials).toBe("AF");
    expect(d.csmFirst).toBeNull();
  });

  test("every access row reads Not checked yet, never done and never to do", () => {
    expect(d.kickoffFiled).toBe(false);
    expect(d.access.map(r => r.status)).toEqual([
      "unchecked",
      "unchecked",
      "unchecked",
      "unchecked",
      "unchecked",
    ]);
  });

  test("no goals, no services, no launch service, no dates", () => {
    expect(shownGoals(d)).toEqual([]);
    expect(d.services).toEqual([]);
    expect(d.serviceFocus).toBeNull();
    expect(d.next).toEqual({});
    expect(d.goLive).toBeNull();
    expect(d.roadNow).toBe(2);
  });

  test("an unknown service model reads done for you, and the CSM is told", () => {
    expect(d.mode).toEqual({ dwy: false, known: false, from: "none" });
    expect(d.notes).toContain(
      "Service mode not set on the card. The deck uses done for you.",
    );
  });

  test("the Page name falls back to the client's name; today stands in for the call's day", () => {
    expect(d.pageName).toBe(d.name);
    expect(d.pageNameFrom).toBe("client");
    expect(d.onboardingDay).toBe("2026-10-19");
    expect(d.onboardingDayFrom).toBe("today");
  });

  test("first ads: no answer is not approval, and no pack names no service", () => {
    expect(firstAdsLine(d).line.en).toBe(
      "If you approve them, starter ads can go live first, from our ready templates. Your own ads, made from your content, follow.",
    );
  });
});

describe("a client with everything on file", () => {
  const d = data("full");

  test("the four goals, cleaned, with the challenges as lines", () => {
    expect(shownGoals(d).map(g => g.key)).toEqual([
      "goal90",
      "goal12_24",
      "challenges",
      "why",
    ]);
    expect(d.goals.find(g => g.key === "challenges")?.lines).toEqual([
      "Most enquiries come from people who only want a price.",
      "Referrals dried up after summer.",
      "We lose time on site visits that go nowhere.",
    ]);
  });

  test("services from the form, prices and notes taken out, the #1 tagged", () => {
    expect(d.services).toEqual([
      "Kitchens",
      "Bathrooms",
      "Full villa fit-out",
      "Interior design",
    ]);
    expect(d.numberOne).toBe("Kitchens");
    expect(d.serviceFocus).toBe("Kitchens");
    expect(d.serviceFocusFrom).toBe("kickoff");
  });

  test("access read from the kickoff: done, to do, and the content row unticked", () => {
    const by = Object.fromEntries(d.access.map(r => [r.key, r.status]));
    expect(by).toEqual({
      meta: "done",
      os: "todo",
      content: "unchecked",
      past: "done",
      academy: "unchecked",
    });
  });

  test("the Page name from the kickoff, the Blueprint booked, the logo verified", () => {
    expect(d.pageName).toBe("Noor Studio");
    expect(d.next.blueprint).toBe("2026-10-22T13:00:00Z");
    expect(d.logo?.from).toBe("verified");
    expect(d.csmFirst).toBe("Sara");
  });

  test("the Arabic deck uses the Arabic name from HighLevel", () => {
    expect(data("full", "ar").name).toBe("استوديو نور للتصميم الداخلي");
  });

  test("Do's & Don'ts read as do and don't; notes never show", () => {
    expect(d.dosDonts.dont).toEqual([
      "Never show prices in an ad",
      "No before-and-after of client homes",
    ]);
    expect(JSON.stringify(d.dosDonts)).not.toContain("Owner prefers");
  });

  test("a starter pack with starter ads: the first ads line names the service", () => {
    expect(d.starterPack).toBe(true);
    expect(d.starterAds).toHaveLength(2);
    expect(firstAdsLine(d)).toEqual({
      line: expect.anything(),
      service: "Kitchens",
    });
  });
});

describe("a done-with-you client in the UAE", () => {
  const d = data("dwy");

  test("the service model, the zone and the CRM rows", () => {
    expect(d.mode.dwy).toBe(true);
    expect(d.uae).toBe(true);
    expect(d.timeZone).toBe("Asia/Dubai");
    expect(d.access.map(r => r.key)).toEqual([
      "meta",
      "crm",
      "content",
      "past",
      "academy",
      "phones",
    ]);
  });

  test("a goal that counts appointments is held back, and the CSM is told why", () => {
    const g = d.goals.find(x => x.key === "goal12_24");
    expect(g?.held).toBe("count");
    expect(shownGoals(d).map(x => x.key)).toEqual(["goal90", "challenges"]);
    expect(d.notes.some(n => n.includes("counts leads or appointments"))).toBe(
      true,
    );
  });

  test("a kickoff No is an answer (to do), and prep's tick wins", () => {
    const meta = d.access.find(r => r.key === "meta");
    expect(meta?.ticks.map(t => [t.key, t.status, t.from])).toEqual([
      ["meta_access", "done", "prep"],
      ["meta_card", "todo", "kickoff"],
    ]);
    expect(meta?.status).toBe("todo");
  });

  test("declined templates: their own ads first; the launch service and red lines from prep", () => {
    expect(firstAdsLine(d).line.en).toBe(
      "Your own ads, made from your content, go live first.",
    );
    expect(d.serviceChosen).toBe("مطابخ حسب الطلب");
    expect(d.redLines).toEqual(["لا تذكرون الأسعار في الإعلان"]);
    expect(d.roadNow).toBe(3);
  });
});

describe("the small rules", () => {
  test("form answers lose phones, emails and links; long ones are cut at a word", () => {
    expect(cleanAnswer("Call me on +965 9999 8888 or a@b.com — thanks!")).toBe(
      "Call me on or, thanks.",
    );
    expect(challengeLines("1. One\n2. Two\n3. Three\n4. Four")).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  test("lines that count enquiries or promise a refund are held", () => {
    expect(heldReason("20 appointments a month")).toBe("count");
    expect(heldReason("نبي ٣٠ موعد بالشهر")).toBe("count");
    expect(heldReason("We want a money-back guarantee")).toBe("guarantee");
    expect(heldReason("Two kitchen projects a month")).toBeNull();
  });

  test("service chips: prices and notes out, sentences dropped", () => {
    expect(
      serviceChips(
        "Kitchens - from 25,000 SAR, Bathrooms (from 9,000)\nVilla fit-out",
      ),
    ).toEqual(["Kitchens", "Bathrooms", "Villa fit-out"]);
    expect(
      serviceChips(
        "We do everything from design to handover for villas and offices across Riyadh.",
      ),
    ).toEqual([]);
  });

  test("initials skip the generic words, in both scripts", () => {
    expect(initials("The Noor Design Group")).toBe("ND");
    expect(initials("شركة الرواد للمقاولات")).toBe("ر");
  });

  test("country from the service areas; the road from the stage", () => {
    expect(countryFromAreas("Jeddah and Makkah")).toBe("SA");
    expect(countryFromAreas("Dubai Marina")).toBe("AE");
    expect(roadNowFor("Brand Blueprint Booked♠️")).toBe(3);
    expect(roadNowFor("LAUNCH BOOKED")).toBe(4);
    expect(roadNowFor("Onboarding Booked")).toBe(2);
  });

  test("dates are Gregorian in Arabic, with the Gulf's month names", () => {
    expect(dayMonth("2026-10-19", "ar", "Asia/Riyadh")).toBe("١٩ أكتوبر");
    expect(dayShort("2026-10-22T13:00:00Z", "en", "Asia/Riyadh")).toBe(
      "Thu 22 October",
    );
    expect(when("2026-10-22T13:00:00Z", "en", "Asia/Riyadh")).toBe(
      "Thursday 22 October, 4 pm",
    );
    expect(when("2026-10-22T13:00:00Z", "ar", "Asia/Riyadh")).toBe(
      "الخميس ٢٢ أكتوبر، ٤ مساءً",
    );
  });

  test("a status flips to done, then between done and to do", () => {
    expect(nextStatus("unchecked")).toBe("done");
    expect(nextStatus("done")).toBe("todo");
    expect(nextStatus("todo")).toBe("done");
  });

  test("the matrix points at the most ticks, the #1 breaking a tie", () => {
    const d = data("full");
    expect(leadService(d, {}, null)).toEqual({
      lead: null,
      candidate: "Kitchens",
    });
    const ticks = { Bathrooms: { sell: true }, Kitchens: { sell: true } };
    expect(leadService(d, ticks, null).lead).toBe("Kitchens");
    expect(
      leadService(d, { Bathrooms: { sell: true, profit: true } }, null).lead,
    ).toBe("Bathrooms");
    expect(leadService(d, {}, "Full villa fit-out").candidate).toBe(
      "Full villa fit-out",
    );
  });
});

describe("every slide and stop renders, for every client, in both languages", () => {
  const slides = onboardingSlides();
  for (const key of ["full", "sparse", "dwy"] as FixtureKey[])
    for (const lang of ["en", "ar"] as Lang[])
      test(`${key}, ${lang}`, () => {
        const f = FIXTURES[key]();
        const d = data(key, lang);
        const base: Omit<SlideCtx, "tour" | "setTour"> = {
          d,
          lang,
          deck: "onboarding",
          prep: f.prep.onboarding,
          prepOf: k => f.prep[k],
          save: () => {},
          saveTo: () => {},
          live: emptyLive(),
          setLive: () => {},
          still: true,
          presenting: true,
        };
        const seen: Record<string, string> = {};
        for (const s of slides) {
          const stops = s.stops?.({ ...base, tour: 0, setTour: () => {} }) ?? 1;
          for (let tour = 0; tour < stops; tour++) {
            const html = renderToStaticMarkup(
              s.render({ ...base, tour, setTour: () => {} }),
            );
            expect(html.length).toBeGreaterThan(200);
            seen[`${s.id}:${tour}`] = html;
          }
        }
        // The presenting CSM is named on the cover only (copy rule 8).
        if (d.csmFirst)
          for (const [at, html] of Object.entries(seen))
            if (!at.startsWith("welcome"))
              expect(html).not.toContain(d.csmFirst);
        // Before the kickoff, nothing reads as done or to do.
        if (!d.kickoffFiled) {
          const week = seen["this-week:0"];
          expect(week).not.toContain('data-status="done"');
          expect(week).not.toContain('data-status="todo"');
        }
        // No unbooked call shows a date on the next-step band.
        if (!d.next.blueprint)
          expect(seen["next:0"]).not.toContain("dkc-band-when");
        // The starter stop shows only with a pack and starter ads.
        expect(Object.keys(seen).includes("next:1")).toBe(key === "full");
      });
});
