import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, type FixtureKey } from "../src/practice/fixtures/fixtures";
import { emptyLive } from "../src/present/channel";
import {
  challengeLines,
  cleanAnswer,
  heldReason,
  serviceChips,
} from "../src/present/clean";
import { EXAMPLE, type Lang, O, t } from "../src/present/content";
import { dayMonth, dayShort, when } from "../src/present/dates";
import type { SlideCtx } from "../src/present/deckContext";
import {
  countryFromAreas,
  type DeckData,
  deckData,
  initials,
  roadNowFor,
  rowStatus,
  shownGoals,
} from "../src/present/deckData";
import {
  chosenPatch,
  firstAdsLine,
  firstAppointmentDay,
  leadService,
  nextStatus,
  nextStops,
  onboardingSlides,
  ownLine,
  rowHeight,
  STRIP_LIT,
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
    // The seeded video slots, so the guides render (score round 3).
    videos: f.videos ?? null,
    videosProblem: f.videosProblem ?? null,
    now: NOW,
  });
}

describe("a client with nothing on file", () => {
  const d = data("sparse");

  test("the name stands, initials stand in for the logo, the role for the CSM", () => {
    expect(d.name).toBe("Atlas Design & Build Contracting");
    expect(d.logo).toBeNull();
    expect(d.initials).toBe("AD");
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
    // Slide 4 still offers the five; nothing is pre-highlighted. The
    // example ads read the name: design and build's pictures.
    expect(d.serviceRows.map(r => r.key)).toEqual([
      "design-build",
      "interior",
      "architecture",
      "fitout",
      "construction",
    ]);
    expect(d.service.key).toBeNull();
    expect(d.example.service).toBe("design-build");
    expect(d.next).toEqual({});
    expect(d.goLive).toBeNull();
    expect(d.roadNow).toBe(2);
  });

  test("an unknown service model reads done for you, and the CSM is told", () => {
    expect(d.mode).toEqual({ dwy: false, known: false, from: "none" });
    // Said once, by slide 3's prep line, never twice (the fixer's round).
    const team = onboardingSlides().find(x => x.id === "team");
    expect(team?.missing?.(d)).toEqual([
      "Service model not set. The deck uses done for you. Change it if their team calls.",
    ]);
    expect(d.notes.join(" ")).not.toMatch(/Service mode(l)? not set/);
  });

  test("the Page name falls back to the client's name; today stands in for the call's day", () => {
    expect(d.pageName).toBe(d.name);
    expect(d.pageNameFrom).toBe("client");
    expect(d.onboardingDay).toBe("2026-10-19");
    expect(d.onboardingDayFrom).toBe("today");
  });

  test("first ads: no answer is not approval, and no pack names no service", () => {
    // "can", not "go": the approval itself is the line under it (O7).
    expect(firstAdsLine(d).line.en).toBe(
      "Starter ads can go live first, from our ready templates. Your own ads, made from your content, follow.",
    );
    expect(firstAdsLine(d).line.en).not.toBe(O.next.approvedNoPack.en);
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
      "Villa interiors",
      "Kitchens and wardrobes",
      "Majlis design",
      "Full villa fit-out",
      "Interior design",
    ]);
    expect(d.numberOne).toBe("Villa interiors");
    // The service is the kickoff's main service, never a sub-trade.
    expect(d.serviceFocus).toBe("Interior design");
    expect(d.serviceMid).toBe("interior design");
    expect(d.serviceFocusFrom).toBe("kickoff");
    expect(d.service.key).toBe("interior");
    // Their own words sit under the service they belong to.
    expect(
      d.serviceRows.filter(r => r.own.length).map(r => [r.key, r.own]),
    ).toEqual([
      [
        "interior",
        ["Villa interiors", "Kitchens and wardrobes", "Majlis design"],
      ],
      ["fitout", ["Full villa fit-out"]],
    ]);
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
    // Mid-sentence, in sentence case: "templates for interior design".
    expect(firstAdsLine(d)).toEqual({
      line: expect.anything(),
      service: "interior design",
    });
    expect(nextStops(d)).toBe(3);
  });

  test("the pack is for one service: another choice on slide 4 drops its line and its stop (fixer round 2)", () => {
    const f = FIXTURES.full();
    const withPrep = (onboarding: Record<string, unknown>) =>
      deckData({
        taskId: "fixture-full",
        deck: "onboarding",
        lang: "en",
        sources: f.sources,
        kit: f.kit,
        prep: {
          ...f.prep,
          onboarding: { ...f.prep.onboarding, ...onboarding },
        },
        ads: f.ads,
        publicUrl: (_b, p) => p,
        now: NOW,
      });
    for (const service of ["Architectural design", "Design and build"]) {
      const chose = withPrep({
        service_focus: service,
        service_chosen_at: "2026-10-19T08:50:00Z",
      });
      expect(chose.starterPackFor).toBe("interior");
      expect(chose.starterPack).toBe(false);
      expect(firstAdsLine(chose).service).toBeNull();
      expect(nextStops(chose)).toBe(2);
    }
    // Ticked again for the new service, it is back.
    const again = withPrep({
      service_focus: "Architectural design",
      service_chosen_at: "2026-10-19T08:50:00Z",
      starter_pack: "architecture",
    });
    expect(again.starterPack).toBe(true);
    expect(firstAdsLine(again).service).toBe("architectural design");
    // A yes saved before keys is the kickoff's service (Interior design).
    const legacy = (service: string) =>
      withPrep({
        starter_pack: true,
        service_focus: service,
        service_chosen_at: "2026-10-19T08:50:00Z",
      }).starterPack;
    expect(legacy("Interior design")).toBe(true);
    expect(legacy("Architectural design")).toBe(false);
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
    expect(
      d.notes.some(n => n.includes("counts enquiries or appointments")),
    ).toBe(true);
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
    // Typed in prep before the call, in their words ("بناء الفلل"): read as
    // the main service it belongs to, the proposal, not a choice. The
    // checklist keeps it open until "Launch with this" stamps it.
    expect(d.serviceFocus).toBe("Construction");
    expect(d.service).toMatchObject({ key: "construction", from: "prep" });
    expect(d.serviceFocusFrom).toBe("prep");
    // A word that fits none of the five adds "Other", in their words.
    expect(d.serviceRows.at(-1)).toEqual({
      key: "other",
      own: ["تأجير معدات"],
    });
    expect(d.serviceChosen).toBeNull();
    expect(d.today.service).toBe(false);
    expect(d.redLines).toEqual(["لا تذكرون الأسعار في الإعلان"]);
    expect(d.roadNow).toBe(3);
  });

  test("Launch with this stamps the choice; Undo clears it", () => {
    const f = FIXTURES.dwy();
    const stamped = (at: string | null) =>
      deckData({
        taskId: "fixture-dwy",
        deck: "onboarding",
        lang: "en",
        sources: f.sources,
        kit: f.kit,
        prep: {
          ...f.prep,
          onboarding: { ...f.prep.onboarding, service_chosen_at: at },
        },
        ads: f.ads,
        presenterName: "Sara Al-Harbi",
        publicUrl: (_b, p) => p,
        now: NOW,
      });
    const chosen = stamped("2026-10-19T09:10:00Z");
    expect(chosen.serviceChosen).toBe(chosen.serviceFocus);
    expect(chosen.today.service).toBe(true);
    expect(stamped(null).today.service).toBe(false);
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
    // The count after the noun, and counts in words.
    for (const goal of [
      "Increase leads to 50 a month",
      "Leads: 50 per month",
      "appointments: 20",
      "We want more appointments, at least 15 every month",
      "زيادة الاستفسارات إلى ٥٠ شهرياً",
      "Get thirty leads a month",
      "ثلاثين موعد بالشهر",
    ])
      expect(heldReason(goal)).toBe("count");
    // Plain words that only look like counts stay.
    for (const fine of [
      "No one calls them back, and the good ones go cold",
      "Become the go-to kitchen studio in Riyadh",
      "Fewer wasted meetings with people who can't afford us",
    ])
      expect(heldReason(fine)).toBeNull();
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

  test("the matrix starts on their likely service, then follows the ticks, the #1 breaking a tie", () => {
    const d = data("full");
    // Pre-highlighted from the kickoff's answer.
    expect(leadService(d, {}, null)).toEqual({
      lead: null,
      candidate: "interior",
    });
    const ticks = { fitout: { sell: true }, interior: { sell: true } };
    // A tie: their #1 ("Villa interiors") is an interior design.
    expect(leadService(d, ticks, null).lead).toBe("interior");
    expect(
      leadService(d, { fitout: { sell: true, profit: true } }, null).lead,
    ).toBe("fitout");
    expect(leadService(d, {}, "construction").candidate).toBe("construction");
    // Nothing on file: no row is pre-highlighted.
    expect(leadService(data("sparse"), {}, null).candidate).toBeNull();
  });

  test("Launch with this saves the main service in both languages, and drops a picture chosen for another", () => {
    const d = data("full");
    expect(chosenPatch(d, "interior", {})).toEqual({
      service_focus: "Interior design",
      service_focus_ar: "تصميم داخلي",
      service_chosen_at: true,
    });
    expect(
      chosenPatch(d, "construction", { example_theme: "interior" }),
    ).toMatchObject({ service_focus: "Construction", example_theme: null });
    expect(
      chosenPatch(d, "construction", { example_theme: "majlis" }),
    ).toMatchObject({ example_theme: null });
    expect(
      chosenPatch(d, "fitout", { example_theme: "kitchen" }),
    ).not.toHaveProperty("example_theme");
    const dwy = data("dwy");
    expect(chosenPatch(dwy, "other", {})).toMatchObject({
      service_focus: "تأجير معدات",
      service_focus_ar: "تأجير معدات",
    });
  });
});

describe("each deck asks for the service in its own order (DESIGN 22.14.1)", () => {
  test("the onboarding deck takes slide 4's pick; the launch deck the kickoff's answer first", () => {
    // Slide 4's pick was Architectural design; the kickoff (filed after)
    // advertises Interior design, so the campaign was set up for that.
    const build = (deck: "onboarding" | "launch") => {
      const f = FIXTURES.full(deck);
      return deckData({
        taskId: "fixture-full",
        deck,
        lang: "en",
        sources: f.sources,
        kit: f.kit,
        prep: {
          ...f.prep,
          onboarding: {
            ...(f.prep.onboarding ?? {}),
            service_focus: "Architectural design",
            service_chosen_at: "2026-10-12T10:00:00Z",
          },
        },
        ads: f.ads,
        presenterName: "Sara Al-Harbi",
        publicUrl: (_b, p) => p,
        now: NOW,
      });
    };
    const onboarding = build("onboarding");
    expect(onboarding.service.key).toBe("architecture");
    expect(onboarding.service.from).toBe("chosen");
    const launch = build("launch");
    expect(launch.service).toMatchObject({ key: "interior", from: "kickoff" });
    expect(launch.example.service).toBe("interior");
  });
});

describe("O7 names the launch service in the deck's own script", () => {
  // The fixer's round (2026-10-20): "لخدمة Kitchens" put a Latin name in an
  // Arabic line. The Arabic deck takes the CSM's Arabic name from prep (the
  // field the launch deck reads too), and leaves a Latin-only name unnamed.
  const render = (d: DeckData, tour: number) => {
    const f = FIXTURES.full();
    const s = onboardingSlides().find(x => x.id === "next");
    return renderToStaticMarkup(
      <>
        {s?.render({
          d,
          lang: d.lang,
          deck: "onboarding",
          prep: f.prep.onboarding,
          prepOf: k => f.prep[k],
          save: () => {},
          saveTo: () => {},
          live: emptyLive(),
          setLive: () => {},
          still: true,
          presenting: true,
          tour,
          setTour: () => {},
        })}
      </>,
    );
  };
  const typed = (lang: Lang) => {
    const f = FIXTURES.full();
    return deckData({
      taskId: "fixture-full",
      deck: "onboarding",
      lang,
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        onboarding: {
          ...f.prep.onboarding,
          service_focus: "Swimming pools and spas",
          service_focus_ar: "مسابح وجاكوزي",
          // The pack ticked for the service it names (fixer round 2).
          starter_pack: "design-build",
        },
      },
      ads: f.ads,
      presenterName: "Sara Al-Harbi",
      publicUrl: (_b, p) => p,
      now: NOW,
    });
  };
  test("a main service: both decks say it in their own language, inside the sentence", () => {
    const ar = data("full", "ar");
    expect(ar.serviceFocus).toBe("تصميم داخلي");
    expect(firstAdsLine(ar).service).toBe("التصميم الداخلي");
    for (const tour of [0, 1])
      expect(render(ar, tour)).not.toContain("Interior design");
    expect(render(data("full"), 0)).toContain("templates for interior design");
  });
  test("their own words (it fits no other way): named in each deck's script, mapped where it fits", () => {
    // A pool is a design and build: the main service is named, not the pool.
    const d = typed("ar");
    expect(d.service.key).toBe("design-build");
    expect(firstAdsLine(d).service).toBe("التصميم والتنفيذ");
    const other = (lang: Lang) => {
      const f = FIXTURES.full();
      return deckData({
        taskId: "fixture-full",
        deck: "onboarding",
        lang,
        sources: f.sources,
        kit: f.kit,
        prep: {
          ...f.prep,
          onboarding: {
            ...f.prep.onboarding,
            service_focus: "Equipment rental",
            starter_pack: "other",
          },
        },
        ads: f.ads,
        publicUrl: (_b, p) => p,
        now: NOW,
      });
    };
    // Only a Latin name for "Other": the Arabic deck leaves it unnamed, and
    // prep says how to name it.
    const arOther = other("ar");
    expect(arOther.service.key).toBe("other");
    for (const tour of [0, 1])
      expect(render(arOther, tour)).not.toContain("Equipment rental");
    expect(firstAdsLine(arOther).service).toBeNull();
    const s = onboardingSlides().find(x => x.id === "next");
    expect(
      s
        ?.missing?.(arOther)
        .some(m => m.includes("Type their service in Arabic")),
    ).toBe(true);
    expect(render(other("en"), 0)).toContain("templates for equipment rental");
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
          // With a player (score round 3): without one the video guides
          // never render, so a "{len}" left in one could not be caught.
          playVideo: () => {},
        };
        const seen: Record<string, string> = {};
        for (const s of slides) {
          const stops = s.stops?.({ ...base, tour: 0, setTour: () => {} }) ?? 1;
          for (let tour = 0; tour < stops; tour++) {
            const html = renderToStaticMarkup(
              s.render({ ...base, tour, setTour: () => {} }),
            );
            expect(html.length).toBeGreaterThan(200);
            // No slot is ever left unfilled on the canvas (score round 2:
            // the Arabic guide showed its "{len}").
            expect(html).not.toMatch(/\{[a-zA-Z.]+\}/);
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
        // No unbooked call shows a date on the Blueprint stop.
        const last = Object.keys(seen)
          .filter(k => k.startsWith("next:"))
          .sort()
          .at(-1) as string;
        if (!d.next.blueprint)
          expect(seen[last]).not.toContain("dkc-band-when");
        // The last stop closes the call's checklist, its calendar card at
        // full size whether booked or not (score round 2); stop 1 is what
        // to expect, its strip of example ads under the test's words with
        // their own service's tile lit.
        expect(seen[last]).toContain('data-variant="close"');
        expect(seen[last]).toContain("dkc-cal-grid");
        if (!d.next.blueprint)
          expect(seen[last]).toContain('class="dkc-cal-block" data-open=""');
        expect(seen["next:0"]).toContain('class="dkc-strip"');
        expect(seen["next:0"]).toMatch(
          /<section class="dkc-next-test">[\s\S]*class="dkc-strip"/,
        );
        expect(seen["next:0"]).toMatch(
          /<ul aria-hidden="true"><li data-lit=""/,
        );
        expect(seen["next:0"]).toContain(
          lang === "ar" ? "إعلانات للتوضيح" : "Example ads",
        );
        // The starter stop shows only with a pack and starter ads.
        expect(Object.keys(seen).includes("next:2")).toBe(key === "full");
        // No example ever stands in for a starter. The cover shows the
        // example ad for their service, tagged (the fixer's round, which
        // overturns DESIGN 22.4.6 for the covers), in a Reels phone with
        // the story picture, so O4's feed picture is not shown twice. The
        // tag hangs under the phone's foot (score round 2), never stacked
        // under the presenter's name.
        if (key === "full") expect(seen["next:1"]).not.toContain("examples/");
        expect(seen["welcome:0"]).toContain("examples/");
        expect(seen["welcome:0"]).toContain("-story");
        expect(seen["welcome:0"]).toContain(
          `<span class="dk-tag dkc-figure-tag-below">${t(EXAMPLE.tag, lang)}</span>`,
        );
        expect(seen["welcome:0"]).not.toContain("dkc-figure-head");
        expect(seen["welcome:0"]).not.toContain("dkc-faint");
      });
});

describe("score round 2: the onboarding deck's placeholders, designed", () => {
  const one = (d: DeckData, id: string, tour = 0) => {
    const f = FIXTURES.full();
    const s = onboardingSlides().find(x => x.id === id);
    return renderToStaticMarkup(
      <>
        {s?.render({
          d,
          lang: d.lang,
          deck: "onboarding",
          prep: f.prep.onboarding,
          prepOf: k => f.prep[k],
          save: () => {},
          saveTo: () => {},
          live: emptyLive(),
          setLive: () => {},
          still: true,
          presenting: true,
          tour,
          setTour: () => {},
        })}
      </>,
    );
  };
  test("score round 4: Arabic words side by side take the Arabic comma, in the English deck too", () => {
    const h = one(data("dwy"), "one-service");
    expect(h).not.toMatch(
      /[\u0600-\u06ff]<\/bdi><\/span><span>, <bdi>[\u0600-\u06ff]/,
    );
    expect(h).toMatch(
      /[\u0600-\u06ff]<\/bdi><\/span><span>، <bdi>[\u0600-\u06ff]/,
    );
  });

  test("score round 4: a card with some steps done and the rest not checked reads To do", () => {
    expect(rowStatus(["done", "done", "unchecked"])).toBe("todo");
    expect(rowStatus(["unchecked", "unchecked"])).toBe("unchecked");
    expect(rowStatus(["done", "done"])).toBe("done");
    expect(rowStatus(["done", "todo"])).toBe("todo");
  });

  test("score round 4: the goal's answers sit in the deck's direction, their words isolated", () => {
    const h = one(data("full", "ar"), "goals", 1);
    expect(h).toMatch(/<li class="dkc-theirs"><bdi>/);
    expect(h).not.toMatch(/<li class="dkc-theirs" dir="auto">/);
    // An English goal in the Arabic deck keeps its own direction and hang.
    expect(h).toMatch(/class="dkc-goal-block" dir="ltr"/);
  });

  test("score round 1: no goal but other answers to come, the question stands low on stop 1 and settles up with them", () => {
    const d = data("full");
    const noGoal = { ...d, goals: d.goals.filter(g => g.key !== "goal90") };
    const asking = (h: string) =>
      /<div class="dkc-goal-asking"[^>]*>/.exec(h)?.[0] ?? "";
    expect(asking(one(noGoal, "goals", 0))).toContain('data-lift=""');
    expect(asking(one(noGoal, "goals", 1))).not.toContain("data-lift");
    // Alone (no other answers), it stays on the slide's middle, unlifted.
    const alone = asking(one(data("sparse"), "goals", 0));
    expect(alone).toContain('data-alone=""');
    expect(alone).not.toContain("data-lift");
    // Alone, 90 days is said by the question and the track only (score
    // round 2 of the five services: four times on one slide): the field
    // asks for their words, with no label over it.
    for (const lang of ["en", "ar"] as const) {
      const h = one(data("sparse", lang), "goals", 0);
      expect(h).toContain(
        `placeholder="${lang === "en" ? "In your words" : "بكلامكم"}"`,
      );
      expect(h).not.toContain("dkc-goal-label");
      expect(h).toContain("dkc-goal-track");
    }
    // With answers to come (no track under the field), the label stays.
    expect(one(noGoal, "goals", 0)).toContain("dkc-goal-label");
  });

  test("O4: the five main services always, Other only when their words fit none", () => {
    expect([5, 6].map(rowHeight)).toEqual([92, 84]);
    const names = (html: string) =>
      [...html.matchAll(/class="dkc-service-label">([^<]+)</g)].map(m => m[1]);
    const five = [
      "Design and build",
      "Interior design",
      "Architectural design",
      "Fit-out and renovation",
      "Construction",
    ];
    expect(names(one(data("sparse"), "one-service"))).toEqual(five);
    const full = one(data("full"), "one-service");
    expect(names(full)).toEqual(five);
    // Their own words, quiet under the service they belong to; whole
    // items only, the rest counted.
    expect(full).toContain("dkc-service-own");
    expect(full).not.toMatch(/dkc-service-label">Kitchens/);
    expect(
      ownLine(["Villa interiors", "Kitchens and wardrobes", "Majlis design"]),
    ).toEqual({
      shown: ["Villa interiors"],
      more: 2,
    });
    expect(names(one(data("dwy", "ar"), "one-service")).at(-1)).toBe(
      "خدمة أخرى",
    );
    // The count is isolated left to right: +٢ after their words in Arabic,
    // never ٢+ in front of a Latin line.
    expect(full).toContain('<bdi dir="ltr" class="dkc-service-more">+2</bdi>');
    expect(one(data("full", "ar"), "one-service")).toContain(
      '<bdi dir="ltr" class="dkc-service-more">+٢</bdi>',
    );
    // The likely pick on the band, its name in the column.
    expect(full).toMatch(/data-lead=""[^>]*>[\s\S]*?Interior design/);
    expect(full).toContain("dkc-matrix-band");
  });
  test("O5: the road ends at an example confirmation in their name, dated after go-live", () => {
    const d = data("full");
    const html = one(d, "road");
    expect(html).toContain("dkc-road-card");
    expect(html).toContain(">Example wording<");
    expect(html).toContain(`Your appointment with ${d.nameEn} is confirmed.`);
    // The launch call's line stays in its own column.
    expect(html).not.toMatch(/grid-column:5 \/ -1/);
    // The day: go-live, else a week after the booked launch call, else
    // three weeks after this call; never before the launch call.
    expect(firstAppointmentDay({ ...d, goLive: "2026-11-02" })).toBe(
      "2026-11-02",
    );
    expect(
      firstAppointmentDay({
        ...d,
        goLive: null,
        next: { launch: "2026-10-27T13:00:00Z" },
      }),
    ).toBe("2026-11-03");
    expect(
      firstAppointmentDay({
        ...d,
        goLive: null,
        next: {},
        onboardingDay: "2026-10-19",
      }),
    ).toBe("2026-11-09");
  });
  test("O7: their own service's tile stays lit, and the strip sits with the test's words", () => {
    expect(STRIP_LIT.has(0)).toBe(true);
    expect(STRIP_LIT.size).toBe(2);
    const html = one(data("full"), "next", 0);
    const test =
      html.match(/<section class="dkc-next-test">[\s\S]*?<\/section>/)?.[0] ??
      "";
    expect(test).toContain("dkc-strip");
    expect(test).not.toContain("dkc-redlines");
    expect(html).toMatch(/<section>[\s\S]*dkc-redlines[\s\S]*?<\/section>/);
  });
  test("O6: the video guide's poster on a two-card board, the text guide on three; its length filled in both languages", () => {
    const board = (key: FixtureKey, lang: Lang) => {
      const f = FIXTURES[key]();
      const d = deckData({
        taskId: `fixture-${key}`,
        deck: "onboarding",
        lang,
        sources: f.sources,
        kit: f.kit,
        prep: f.prep,
        ads: f.ads,
        presenterName: "Sara Al-Harbi",
        publicUrl: (_b, p) => p,
        videos: f.videos,
        now: NOW,
      });
      const s = onboardingSlides().find(x => x.id === "this-week");
      return renderToStaticMarkup(
        <>
          {s?.render({
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
            tour: 0,
            setTour: () => {},
            playVideo: () => {},
          })}
        </>,
      );
    };
    for (const lang of ["en", "ar"] as Lang[]) {
      const html = board("full", lang);
      // The slide's picture (22.14): each setup card's guide as its poster.
      expect((html.match(/class="dkc-setup-poster/g) ?? []).length).toBe(2);
      expect(html).toContain(
        lang === "en" ? "Video guide · 1:34" : "فيديو شرح، ",
      );
      expect(html).not.toContain('class="dkc-guide ');
      expect(html).not.toMatch(/\{[a-zA-Z.]+\}/);
      // Done steps tick in order as the slide arrives.
      expect(html).toContain('data-arrive="" style="--k:0"');
      // Three cards to a row: no room for a poster, the text guide on the
      // card's head line, before its status.
      const dwy = board("dwy", lang);
      expect(dwy).not.toContain("dkc-setup-poster");
      expect(dwy).toMatch(
        /<header class="dkc-setup-head">[\s\S]*?dkc-guide[\s\S]*?dkc-status/,
      );
      // The play mark and the length alone (score round 2 of the five
      // services: a small picture there read as a blank button).
      expect(dwy).not.toContain("dkc-guide-pic");
      expect(dwy).not.toMatch(/\{[a-zA-Z.]+\}/);
      // No guide recorded (the starter client): the Mahara OS card shows the
      // app's first screen on a phone, tagged as the demo workspace.
      const starter = board("starter", lang);
      expect(starter).not.toContain("dkc-setup-poster");
      expect(starter).toMatch(
        /class="dkc-setup-phone"[\s\S]*?portal-phone-(en|ar)/,
      );
      expect(starter).toContain(
        lang === "en" ? "Demo workspace" : "حساب تجريبي",
      );
      expect((starter.match(/class="dkc-setup-phone"/g) ?? []).length).toBe(1);
    }
  });
  test("O7, not booked: the full calendar card as an empty day, no time made up", () => {
    const d = data("sparse");
    expect(d.next.blueprint).toBeUndefined();
    const html = one(d, "next", 1);
    expect(html).toContain('class="dkc-cal-block" data-open=""');
    expect(html).toContain("We book it before we hang up");
    expect(html).not.toMatch(/\d{1,2} (am|pm)/);
  });
  test("O7, opened after the Blueprint: the checklist ticks it and the card says Done, as O5's road does (final score round 1)", () => {
    // The starter client at Ready For Launch: O5 lights the launch call.
    const d = data("starter");
    expect(d.roadNow).toBe(4);
    expect(d.next.blueprint).toBeUndefined();
    expect(d.today.blueprint).toBe(true);
    const html = one(d, "next", nextStops(d) - 1);
    expect(html).toContain('data-done=""');
    expect(html).toContain(">Done<");
    expect(html).not.toContain("We book it before we hang up");
    // The harness's starter, opened for its onboarding call, is at that
    // call's stage.
    const f = FIXTURES.starter("onboarding");
    expect(roadNowFor(f.sources?.client?.stage)).toBe(2);
    // The call's name never breaks in the close's title.
    expect(one(data("full"), "next", 2)).toContain(
      "Next: your Brand\u00a0Blueprint\u00a0call",
    );
  });
  test("O2 and O4: the client's words in the other script keep their own direction (final score round 1)", () => {
    // O2, one group of Arabic challenges in the English deck: the row
    // spans the content from the words' own start.
    const dwy = one(data("dwy"), "goals", 1);
    expect(dwy).toContain('class="dkc-goal-col" data-cross=""');
    // O2, a single English answer in the Arabic deck: its own direction.
    expect(one(data("full", "ar"), "goals", 1)).toMatch(
      /<p class="dkc-theirs" data-hug="" dir="ltr">/,
    );
    // O4, Arabic words in the English deck: right to left, «،» in place.
    expect(one(data("dwy"), "one-service")).toContain(
      '<span class="dkc-service-own" dir="rtl">',
    );
    // O4, a Latin line in the Arabic deck: left to right, Western digits.
    const f = FIXTURES.starter("onboarding");
    const latin = deckData({
      taskId: "fixture-starter",
      deck: "onboarding",
      lang: "ar",
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        onboarding: { ...f.prep.onboarding, services_ar: null },
      },
      ads: f.ads,
      publicUrl: (_b, p) => p,
      now: NOW,
    });
    const own = one(latin, "one-service");
    expect(own).toContain('<span class="dkc-service-own" dir="ltr">');
    expect(own).toContain('class="dkc-service-more">+2</bdi>');
    expect(own).not.toContain("+٢");
  });
});
