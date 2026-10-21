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
import { EXAMPLE, type Lang, O, t } from "../src/present/content";
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
  firstAppointmentDay,
  ghostRows,
  leadService,
  nextStatus,
  onboardingSlides,
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
    // Mid-sentence, in sentence case: "templates for kitchens".
    expect(firstAdsLine(d)).toEqual({
      line: expect.anything(),
      service: "kitchens",
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
    // Typed in prep before the call: the proposal, not a choice. The
    // checklist keeps it open until "Launch with this" stamps it.
    expect(d.serviceFocus).toBe("مطابخ حسب الطلب");
    expect(d.serviceFocusFrom).toBe("prep");
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
          service_focus: "Kitchens",
          service_focus_ar: "المطابخ",
        },
      },
      ads: f.ads,
      presenterName: "Sara Al-Harbi",
      publicUrl: (_b, p) => p,
      now: NOW,
    });
  };
  test("typed in Arabic: both stops name it in Arabic, never the Latin name", () => {
    const d = typed("ar");
    for (const tour of [0, 1]) {
      const html = render(d, tour);
      expect(html).toContain("المطابخ");
      expect(html).not.toContain("Kitchens");
    }
    expect(firstAdsLine(d).service).toBe("المطابخ");
  });
  test("only a Latin name on file: the Arabic deck leaves it unnamed, and prep says so", () => {
    const d = data("full", "ar");
    expect(d.serviceFocus).toBe("Kitchens");
    for (const tour of [0, 1])
      expect(render(d, tour)).not.toContain("Kitchens");
    expect(firstAdsLine(d).service).toBeNull();
    const s = onboardingSlides().find(x => x.id === "next");
    expect(s?.missing?.(d).some(m => m.includes("Type its Arabic name"))).toBe(
      true,
    );
    // The English deck still names it, in sentence case mid-sentence.
    expect(render(data("full"), 0)).toContain("templates for kitchens");
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
          lang === "ar" ? "إعلانات مثال" : "Example ads",
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
  test("O4: three rows always show while fewer than three services are typed, roomier when few", () => {
    expect([0, 1, 2, 3, 5].map(ghostRows)).toEqual([3, 2, 1, 0, 0]);
    expect([0, 3, 4].map(rowHeight)).toEqual([96, 96, 72]);
    const sparse = one(data("sparse"), "one-service");
    expect((sparse.match(/dkc-matrix-ghost/g) ?? []).length).toBe(3);
    // "Add a service" sits in the first ghost's name slot, not its own row.
    expect(sparse).toMatch(
      /dkc-matrix-ghost"[^>]*role="row"[\s\S]*?Add a service/,
    );
    expect(sparse).not.toContain("dkc-matrix-add");
    const full = one(data("full"), "one-service");
    expect(full).not.toContain("dkc-matrix-ghost");
    expect(full).toContain("dkc-matrix-add");
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
  test("O6: the video guide on the card's head, its length filled in both languages", () => {
    for (const lang of ["en", "ar"] as Lang[]) {
      const f = FIXTURES.full();
      const d = deckData({
        taskId: "fixture-full",
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
      const html = renderToStaticMarkup(
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
      expect(html).toContain("dkc-guide-word");
      expect(html).toMatch(
        /<header class="dkc-setup-head">[\s\S]*?dkc-guide[\s\S]*?dkc-status/,
      );
      expect(html).not.toMatch(/\{[a-zA-Z.]+\}/);
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
});
