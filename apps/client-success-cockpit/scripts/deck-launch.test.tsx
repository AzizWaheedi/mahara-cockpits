import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, type FixtureKey } from "../src/practice/fixtures/fixtures";
import {
  bandFor,
  bookedSlot,
  closingHour,
  dialectFor,
  familyOf,
  handleOf,
  placesOf,
  plain,
  TURNS,
  turnsFor,
} from "../src/present/callScript";
import { emptyLive } from "../src/present/channel";
import {
  journeyOwners,
  L_NOTES,
  L_TITLES,
  type Lang,
} from "../src/present/content";

const L_TITLES_GREEN = () => L_TITLES["green-light"].en;

import type { Creative } from "../src/present/creative";
import { type SlideCtx, titleFor } from "../src/present/deckContext";
import { type DeckData, deckData } from "../src/present/deckData";
import { shownSlides } from "../src/present/decks";
import {
  goalAsk,
  goalAskParts,
  LaunchControls,
  partText,
  pushbackVariant,
  replyText,
} from "../src/present/launchControls";
import {
  APPROVAL_SAID,
  defaultPhones,
  launchBlueprintOf,
  starterTag,
} from "../src/present/launchData";
import {
  formStops,
  launchSlides,
  partTiles,
  placesLine,
  portalStops,
  redLineGroups,
  underHead,
} from "../src/present/launchDeck";
import { onboardingSlides } from "../src/present/onboardingDeck";
import { CALL_STAGES, callRun, stageRange } from "../src/present/Transcript";
import type { DeckModel } from "../src/present/useDeckModel";

/**
 * The launch deck (docs/csm-decks/CONTENT.md L1 to L13, DESIGN.md sections
 * 8 and 20): its order and stops, the journey's lanes done for you and done with
 * you, the fallbacks on the harness's four clients, the example call's
 * script and slots, and every slide and stop rendered in both languages.
 */

const NOW = new Date("2026-10-19T09:00:00Z");

function data(key: FixtureKey, lang: Lang = "en"): DeckData {
  const f = FIXTURES[key]("launch");
  return deckData({
    taskId: `fixture-${key}`,
    deck: "launch",
    lang,
    sources: f.sources,
    kit: f.kit,
    prep: f.prep,
    ads: f.ads,
    presenterName: key === "sparse" ? null : "Sara Al-Harbi",
    publicUrl: (_b, p) => p,
    videos: f.videos,
    videosProblem: f.videosProblem,
    now: NOW,
  });
}

function ctx(d: DeckData, tour = 0, still = true): SlideCtx {
  return {
    d,
    lang: d.lang,
    deck: "launch",
    tour,
    setTour: () => {},
    prep: {},
    prepOf: () => ({}),
    save: () => {},
    saveTo: () => {},
    live: emptyLive(),
    setLive: () => {},
    still,
    presenting: true,
  };
}

// Creative flexibility before the ads (the fixer's round, 2026-10-20): the
// guard rails are agreed before the client sees an ad.
const ORDER = [
  "cover",
  "journey",
  "creative-freedom",
  "ads",
  "form",
  "call",
  "partnership",
  "training",
  "portal",
  "your-part",
  "first-90-days",
  "good-to-know",
  "green-light",
];

describe("the launch deck's order and stops", () => {
  test("thirteen slides, in CONTENT.md's order", () => {
    expect(launchSlides().map(s => s.id)).toEqual(ORDER);
  });

  test("ids are what the server takes as slide ids, and every slide has notes", () => {
    for (const s of launchSlides()) {
      expect(s.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(s.notes.say.length).toBeGreaterThan(0);
      expect(s.notes.sayAr.length).toBeGreaterThan(0);
    }
    expect(
      launchSlides()
        .filter(s => s.cover)
        .map(s => s.id),
    ).toEqual(["cover"]);
  });

  test("the stops a client walks", () => {
    const d = data("full");
    const by = Object.fromEntries(
      launchSlides().map(s => [s.id, s.stops?.(ctx(d)) ?? 1]),
    );
    expect(by).toEqual({
      cover: 1,
      journey: 7,
      ads: 4,
      // The ads' job, the volume, input first, the quick check, the content.
      "creative-freedom": 5,
      // Opening, their three questions, the thank-you.
      form: 5,
      call: 8,
      // The pie, their piece out, the two roads, the one line.
      partnership: 4,
      // The classroom, a lesson, then the two statements.
      training: 3,
      portal: 4,
      "your-part": 1,
      "first-90-days": 1,
      "good-to-know": 1,
      // The question alone: the housekeeping is the slide before.
      "green-light": 1,
    });
  });

  test("the mini rail opens one journey step on slides 3 to 6, 8 and 9 only", () => {
    const d = data("full");
    const rail = (id: string, tour = 0) =>
      launchSlides()
        .find(s => s.id === id)
        ?.rail?.(ctx(d, tour)) ?? null;
    expect(rail("cover")).toBeNull();
    expect(rail("journey")).toBeNull();
    expect(rail("ads")).toBe(0);
    expect(rail("creative-freedom")).toBe(0);
    expect(rail("form")).toBe(1);
    expect(rail("call", 0)).toBe(2);
    expect(rail("call", CALL_STAGES)).toBe(3);
    expect(rail("call", CALL_STAGES + 1)).toBe(4);
    // The pie is the whole split, not a zoom into one stop.
    expect(rail("partnership")).toBeNull();
    // The training lights the meeting it is for.
    expect(rail("training")).toBe(5);
    expect(rail("portal")).toBe(6);
    expect(rail("your-part")).toBeNull();
    expect(rail("first-90-days")).toBeNull();
    expect(rail("good-to-know")).toBeNull();
    expect(rail("green-light")).toBeNull();
  });

  test("creative freedom's five stops are core: a saved test-proof is ignored", () => {
    const f = FIXTURES.full("launch");
    const d = deckData({
      taskId: "x",
      deck: "launch",
      lang: "en",
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        launch: { ...f.prep.launch, shown_slides: ["test-proof"] },
      },
      ads: f.ads,
      now: NOW,
    });
    const s = launchSlides().find(x => x.id === "creative-freedom");
    expect(s?.stops?.(ctx(d))).toBe(5);
    expect([0, 1, 2, 3, 4].map(i => s?.stopName?.(i, ctx(d))?.en)).toEqual([
      "Your ads have one job",
      "We test a lot, fast",
      "Your input comes first",
      "Then a quick check, not a redesign",
      "Keep the content coming",
    ]);
  });

  test("the form slide hides itself until a form is confirmed or typed", () => {
    const sparse = data("sparse");
    expect(sparse.launch.formHidden).toBe(true);
    expect(
      shownSlides(launchSlides(), sparse, {}).map(s => s.id),
    ).not.toContain("form");
    const full = data("full");
    expect(full.launch.form.source).toBe("confirmed");
    expect(shownSlides(launchSlides(), full, {}).map(s => s.id)).toContain(
      "form",
    );
    // A WhatsApp destination is one stop: the chat.
    expect(formStops(data("starter"))).toBe(1);
    expect(data("starter").launch.form.kind).toBe("whatsapp");
  });
});

describe("done with you", () => {
  test("the call and the booking move into the client's lane", () => {
    expect(journeyOwners(false)).toEqual([
      "customer",
      "customer",
      "us",
      "us",
      "you",
      "you",
      "you",
    ]);
    expect(journeyOwners(true).slice(2, 4)).toEqual(["you", "you"]);
  });

  test("the portal shows their CRM until Mahara OS is approved", () => {
    const d = data("dwy");
    expect(d.mode.dwy).toBe(true);
    expect(d.launch.dwyOs).toBe(false);
    expect(portalStops(d).map(s => s.key)).toEqual(["outcome"]);
    const html = renderToStaticMarkup(
      <>
        {launchSlides()
          .find(s => s.id === "portal")
          ?.render(ctx(d))}
      </>,
    );
    expect(html).toContain("Your CRM");
    expect(html).toContain("keep every stage true");
    expect(html).not.toContain("portal-overview");
  });

  test("every DWY slide speaks of their team", () => {
    const d = data("dwy");
    const render = (id: string, tour = 0) =>
      renderToStaticMarkup(
        <>
          {launchSlides()
            .find(s => s.id === id)
            ?.render(ctx(d, tour))}
        </>,
      );
    expect(render("journey", 2)).toContain("Your team calls");
    // The new row's one chip says who calls; the stop's words say how fast.
    expect(render("journey", 2)).toContain('data-lane="you">Your team</span>');
    expect(render("journey", 2)).not.toContain("call now");
    expect(render("journey", 2)).not.toContain("Top of the list");
    expect(render("journey", 5)).toContain(
      "The follow-up messages start by themselves.",
    );
    expect(render("call", 0)).toContain("How your team should call");
    expect(render("call", 0)).toContain("Our script, for your team");
    expect(render("call", CALL_STAGES)).toContain("Before the meeting");
    expect(render("call", CALL_STAGES)).toContain("Provisional bookings");
    expect(render("call", CALL_STAGES + 1)).toContain(
      "Your caller&#x27;s notes",
    );
    expect(render("call", CALL_STAGES + 1)).toContain("It lands in your CRM.");
    // A number keeps its word on the canvas (a no-break space after it).
    expect(render("your-part")).toContain(
      "Call new enquiries within 5\u00a0minutes, and note every try",
    );
    // One sentence per job on the slide (score round 1); the day off is
    // the week drawn under it, said in the notes and sent in the recap.
    expect(render("your-part")).toContain("Your team books into them.");
    expect(render("your-part")).not.toContain("On a day off");
    expect(render("your-part")).toContain(
      "Move each meeting to the right stage the same day",
    );
  });

  /**
   * Done with you, the client's own team calls and books, so no line on
   * either deck may say that we do: no "our call centre", no "our callers",
   * no "we call". Every slide and stop of both decks is rendered, in both
   * languages, for the done-with-you client and for the full client switched
   * to done with you (a confirmed form, uploads and every optional row), and
   * each text run on the canvas is read, the example call's own turns aside.
   */
  test("no line on either deck says our team calls, done with you", () => {
    const EN = [
      /\bour call(?:ing)? cent(?:re|er)\b/i,
      /\bour callers?\b/i,
      /\bwe call\b(?! you\b)/i,
      /\bwe(?:'ll| will)? (?:book|rebook|ring|phone)\b/i,
      /\bour team (?:does this|calls|books)\b/i,
      /\bcalls we make\b/i,
    ];
    const AR = [
      /فريقنا (?:يتصل|بيتصل|يحجز|يسويها)/,
      /يسويه فريقنا/,
      // "نتصل عليكم" is the CSM calling the client, and stays.
      /(?<![\u0600-\u06ff])نتصل (?:عليه|عليهم|خلال|باسم)/,
      /قبل لا نتصل/,
      /مكالماتنا|سكربت مكالماتنا/,
      /اللي نسويها لكم/,
      // The calling team named in a sentence is theirs: "فريق الاتصال
      // عندكم". Alone, as the transcript's speaker, it is their caller.
      /فريق الاتصال(?!\s*عندكم)(?=\S|\s+\S)/,
    ];
    // The transcript is the caller speaking as the client's own business
    // ("Shall we book you in?"), so its turns are theirs and are not read.
    // So is the thank-you screen: the client's own page speaking to their
    // customer ("Our team will call you", فريقنا بيتصل عليك), its "our
    // team" is theirs.
    const runs = (html: string) =>
      html
        .replace(/<div class="dkc-transcript"[^>]*>[\s\S]*?<\/ol><\/div>/g, "")
        .replace(
          /(<div class="dkc-form-intro dkc-form-thanks">[\s\S]*?)<p dir="auto">[^<]*<\/p>/g,
          "$1",
        )
        .replace(/<[^>]+>/g, "\n")
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/[\u2066-\u2069]/g, "")
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);
    const found: string[] = [];
    let seen = 0;
    for (const key of ["dwy", "full"] as FixtureKey[])
      for (const deck of ["onboarding", "launch"] as const)
        for (const lang of ["en", "ar"] as Lang[]) {
          const f = FIXTURES[key](deck);
          const prep = {
            ...f.prep,
            onboarding: { ...f.prep.onboarding, service_model: "DWY" },
          };
          const d = deckData({
            taskId: `fixture-${key}`,
            deck,
            lang,
            sources: f.sources,
            kit: f.kit,
            prep,
            ads: f.ads,
            presenterName: "Sara Al-Harbi",
            publicUrl: (_b, p) => p,
            now: NOW,
          });
          expect(d.mode.dwy).toBe(true);
          const base: SlideCtx = {
            ...ctx(d),
            deck,
            prep: prep[deck],
            prepOf: k => prep[k],
          };
          const slides =
            deck === "launch" ? launchSlides() : onboardingSlides();
          for (const s of slides) {
            const stops = s.stops?.(base) ?? 1;
            for (let tour = 0; tour < stops; tour++) {
              const html = renderToStaticMarkup(
                <>{s.render({ ...base, tour })}</>,
              );
              for (const run of runs(html)) {
                seen++;
                for (const re of lang === "ar" ? [...AR, ...EN] : EN)
                  if (re.test(run))
                    found.push(
                      `${key} ${deck} ${lang} ${s.id}:${tour}: ${run}`,
                    );
              }
            }
          }
        }
    expect(seen).toBeGreaterThan(2000);
    expect([...new Set(found)]).toEqual([]);
  });

  test("done for you keeps our team's words", () => {
    const d = data("full");
    const call = renderToStaticMarkup(
      <>
        {launchSlides()
          .find(s => s.id === "call")
          ?.render(ctx(d, CALL_STAGES))}
      </>,
    );
    expect(call).toContain("What we do before the meeting");
    // Every row leads with its when; the meeting ends the list, bold.
    expect(call).toContain(
      '<span class="dkc-rem-when">Before the meeting</span> · <span>a call to confirm</span>',
    );
    expect(call).toContain('<span class="dkc-rem-end">The meeting</span>');
    expect(call).not.toContain("Provisional bookings");
  });

  test("the clock: Latin digits while it runs, the deck's digits once it is a length", () => {
    const clock = (lang: "en" | "ar", tour: number) =>
      renderToStaticMarkup(
        <>
          {launchSlides()
            .find(s => s.id === "call")
            ?.render(ctx(data("full", lang), tour))}
        </>,
      ).match(/<b class="dk-ltr">([^<]*)<\/b>/)?.[1];
    // 0:00 in Arabic-Indic reads as dots at 72 px (DESIGN 13.4).
    expect(clock("ar", 0)).toMatch(/^[0-9]:[0-9]{2}$/);
    expect(clock("ar", CALL_STAGES + 1)).toBe("٤:٥١");
    expect(clock("en", CALL_STAGES + 1)).toBe("4:51");
  });
});

/**
 * The CEO's answers of 2026-10-20, as drawn: we call new enquiries within
 * 5 minutes during working hours (the night rule beside it), someone who
 * came and is thinking it over is followed up by both of us (done for
 * you), and check-ins are weekly or every two weeks.
 */
describe("the CEO's answers, drawn", () => {
  const render = (d: DeckData, id: string, tour = 0) =>
    renderToStaticMarkup(
      <>
        {launchSlides()
          .find(s => s.id === id)
          ?.render(ctx(d, tour))}
      </>,
    )
      .replace(/&#x27;/g, "'")
      .replace(/[\u2066-\u2069]/g, "")
      // A number keeps its word on the canvas (a no-break space after it).
      .replace(/\u00a0/g, " ");

  test("stop 3 says within 5 minutes, with the hours and the night rule", () => {
    const d = data("full");
    const html = render(d, "journey", 2);
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning.",
    );
    // "5 minutes" underlined in teal, as the form's thank-you band marks it.
    expect(html).toContain('<span class="dkc-thanks-mark">5 minutes</span>');
    expect(render({ ...d, uae: true }, "journey", 2)).toContain(
      "10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday.",
    );
    expect(html).toContain("Up to 4 tries over 3 working days");
    // Each row its own words, never the first one three times: the
    // advertised main service first, then the client's own words for that
    // same service (DESIGN 22.14). Never a sub-trade or another service's
    // words (CEO, 2026-10-21: "These are not kitchens"): the client's
    // "Kitchens and wardrobes" and "Full villa fit-out" stay off an
    // interior design campaign's queue.
    expect(html).toContain("New enquiry · Interior design");
    expect(html).toContain("Try 2 of 4 · Villa interiors · 5 pm");
    expect(html).toContain("Callback · Majlis design · 10 am");
    expect(html).not.toMatch(/Kitchens|fit-out/);
    const ar = render(data("full", "ar"), "journey", 2);
    // The Arabic separator is the Arabic comma: a dot beside Arabic-Indic
    // digits reads as ٠ (score round 3).
    expect(ar).toContain("استفسار جديد، تصميم داخلي");
    expect(ar).toContain("المحاولة ٢ من ٤، تصميم داخلي للفلل، ٥ مساءً");
    expect(ar).toContain("معاودة اتصال، تصميم المجالس، ١٠ صباحاً");
    expect(ar).not.toMatch(/المطابخ|تشطيب/);
    expect(ar).not.toMatch(/[٠-٩] · |· [٠-٩]/);
    // A row past the list leaves its service out rather than repeat one.
    const one = { ...d, services: [] };
    const solo = render(
      {
        ...one,
        launch: { ...one.launch, service: { en: "Construction", ar: null } },
      },
      "journey",
      2,
    );
    expect(solo).toContain("New enquiry · Construction");
    expect(solo).toContain("Try 2 of 4 · 5 pm");
    expect(solo).toContain("Callback · 10 am");
    expect(ar.replace(/<[^>]+>/g, "")).toContain(
      "خلال ٥ دقايق في أوقات الدوام",
    );
    expect(render(data("dwy"), "journey", 2).replace(/<[^>]+>/g, "")).toContain(
      "Call within 5 minutes. Up to 4 tries over 3 working days.",
    );
  });

  test("came and thinking it over: both of us done for you, theirs done with you", () => {
    const html = render(data("full"), "journey", 5);
    // The line stays in the client's ink; its first sentence is ours and
    // theirs together, in teal.
    expect(html).toContain('<span class="dkc-fork-both">Both of us.</span>');
    expect(html).toContain(
      "We call to follow up, and so do you: you know them best. Then mark it.",
    );
    expect(html).toContain("Ours. We call to rebook.");
    const ar = render(data("full", "ar"), "journey", 5);
    expect(ar).toContain('<span class="dkc-fork-both">علينا وعليكم.</span>');
    const dwy = render(data("dwy"), "journey", 5);
    expect(dwy).not.toContain("dkc-fork-both");
    expect(dwy).toContain("Follow up, then move it to the right stage.");
  });

  test("first 90 days: weekly or every two weeks, why, and both marks drawn", () => {
    const html = render(data("full"), "first-90-days");
    expect(html).toContain("Then weekly or every two weeks");
    expect(html).toContain(
      "Depending on your plan and how long you've been with us.",
    );
    // One glyph for the rhythm, whichever it is (small and open), the
    // look back ringed, the first open at full size: no solid diamond
    // without a ring, so the key's two lines name every mark drawn.
    const weekly = html.match(/data-weekly=""/g) ?? [];
    const rings = html.match(/class="dkc-prog-diamond" data-ring=""/g) ?? [];
    const solid =
      html.match(
        /class="dkc-prog-diamond"(?! data-open)(?! data-ring)[^>]*>/g,
      ) ?? [];
    expect(weekly.length).toBeGreaterThanOrEqual(7);
    expect(rings.length).toBe(3);
    expect(solid.length).toBe(0);
    expect(html.match(/class="dkc-prog-key"/g)?.length).toBe(2);
  });
});

/**
 * The Gamma pass (CEO, 2026-10-20), as drawn: the piece of the pie and its
 * two roads, the sales training, what to tell us on the portal, the six
 * jobs, the slower first weeks, the money and replies, and the green light
 * alone. Each in both service models where they differ, and in Arabic.
 */
describe("the Gamma pass, drawn", () => {
  const html = (d: DeckData, id: string, tour = 0) =>
    renderToStaticMarkup(
      <>
        {launchSlides()
          .find(s => s.id === id)
          ?.render(ctx(d, tour))}
      </>,
    )
      .replace(/&#x27;/g, "'")
      .replace(/[\u2066-\u2069]/g, "")
      .replace(/\u00a0/g, " ");
  const text = (h: string) => h.replace(/<[^>]+>/g, "\n");

  test("the pie: ours whole at stop 1, theirs pulled out and named at stop 2", () => {
    const d = data("full");
    const one = html(d, "partnership", 0);
    expect(one).toContain("We bring them to your door.");
    // Our one piece, named three ways, with one leader; theirs drawn ahead.
    for (const n of [
      "Ads and enquiries",
      "Calls and bookings",
      "Reminders and rebooking",
    ])
      expect(one).toContain(n);
    // Ours, then theirs twice: stop 1's quiet twin (ink-3, shown over the
    // dotted slot, the fixer's round) and the ink one stop 2 fades in.
    expect((one.match(/class="dkc-pie-leader"/g) ?? []).length).toBe(3);
    expect(one).toMatch(
      /class="dkc-pie-label" data-side="start" data-lane="you" data-shown="" data-quiet="" aria-hidden="true"/,
    );
    expect(one).not.toContain('class="dkc-pie" data-out');
    expect(one).not.toMatch(/dkc-pie-theirs" style/);
    // Two pieces in the SVG: ours, and theirs (ahead and lit, one shape).
    expect(
      (one.match(/class="dkc-pie-(?:ours|ahead|lit)"/g) ?? []).length,
    ).toBe(3);
    const two = html(d, "partnership", 1);
    expect(two).toContain('class="dkc-pie" data-out=""');
    expect(two).toMatch(
      /dkc-pie-theirs" style="transform:translate\(-33\.9\d*px, -33\.9\d*px\)"/,
    );
    expect(two).toContain("You win the project.");
    // Theirs is a two-name stack under "You", like ours (DESIGN 22.6.4).
    expect(two).toContain("The meeting");
    expect(two).toContain("The close");
    // No number on the pie: no percentage, no fraction.
    expect(text(two)).not.toMatch(/%|٪|quarter/i);
  });

  test("done with you, the pie splits by owner in halves, theirs pulled out together", () => {
    const d = data("dwy");
    const two = html(d, "partnership", 1);
    expect(two).toContain("We bring you the enquiries.");
    expect(two).toContain("Your team books them and wins the project.");
    expect(two).toContain('style="transform:translate(-48px, 0px)"');
    expect(two).toContain("Your team");
    for (const n of [
      "Ads and enquiries",
      "Confirmations and reminders",
      "Calls and bookings",
      "The meeting and the close",
    ])
      expect(two).toContain(n);
    expect(two).not.toContain("Reminders and rebooking");
  });

  test("the two roads, then the one line at the foot", () => {
    const d = data("full");
    const three = html(d, "partnership", 2);
    expect(three).toContain("The enquiries we bring take the longer road.");
    expect(three).toContain("An enquiry from your ad");
    // Why the ad road is longer, written on its bends, not under its name.
    expect(three).toMatch(
      /class="dkc-route-bend" data-side="over"[^>]*><span>Meeting you for the first time<\/span>/,
    );
    expect(three).toMatch(
      /class="dkc-route-bend" data-side="over"[^>]*><span>Comparing you with others<\/span>/,
    );
    expect(three).not.toContain("and comparing you with others.");
    expect(three).toContain("A referral");
    expect(three).toContain("Already trusts you.");
    expect(three).toContain("Your meeting");
    expect(three).toContain("Signed project");
    expect(three).not.toMatch(/longer road<|shorter road/i);
    expect(three).not.toContain("dkc-partner-foot");
    expect(three).not.toContain("data-close");
    // The ad road takes longer at the same speed: its draw runs longer.
    // Both durations ride --dk-m, so the still frame and reduced motion
    // are the end state (DESIGN 22.3.1).
    const ms = [
      ...three.matchAll(/animation-duration:calc\((\d+)ms \* var\(--dk-m\)\)/g),
    ].map(m => Number(m[1]));
    expect(ms.length).toBe(2);
    expect(ms[0]).toBeGreaterThan(ms[1] * 1.6);
    const four = html(d, "partnership", 3);
    expect(four).toContain('class="dkc-routes" data-close=""');
    expect(four).toContain(
      "We can't close for you. We can help you get better at it.",
    );
    expect(four).not.toContain("Marketing without sales");
    const ar = html(data("full", "ar"), "partnership", 3);
    expect(ar).toContain(
      "ما نقدر نوقّع المشروع عنكم، بس نقدر نساعدكم تصيرون أشطر فيه.",
    );
  });

  test("the training: the Academy's two screens, masked and tagged, then the statements", () => {
    const one = html(data("full"), "training", 0);
    expect(one).toContain("pcm-academy-masked");
    expect(one).toContain('alt="The Academy\'s six courses"');
    expect(one).toContain("Academy screenshot");
    expect(one).not.toContain("dkc-train-say");
    // The course being sold, ringed on its own tile (the fixer's round).
    expect((one.match(/class="dkc-train-ring"/g) ?? []).length).toBe(1);
    // Why it matters, said on the slide; the Academy named over its list.
    expect(one).toContain(
      "Enquiries from ads are meeting you for the first time. This course shows you how to win them.",
    );
    expect(one).toContain("Premium Projects Academy");
    const two = html(data("full"), "training", 1);
    expect(two).toContain("pcm-lesson-masked");
    // The lesson cropped to its outline and drawn larger: a crop, named.
    expect(two).toContain(
      'role="img" aria-label="A lesson inside Project Closing Mastery"',
    );
    expect(two).not.toContain("dkc-train-ring");
    const ar = html(data("full", "ar"), "training", 1);
    expect(ar).toContain("لقطة من الأكاديمية");
    expect(ar).toContain('aria-label="درس من كورس إتقان توقيع المشاريع"');
    // The list stays put on all three stops.
    for (const i of [0, 1, 2])
      expect(
        (html(data("full"), "training", i).match(/class="dkc-course-n"/g) ?? [])
          .length,
      ).toBe(6);
  });

  test("the training: six courses, the one lit, what it teaches, two statements, no cadence", () => {
    for (const key of ["full", "dwy"] as FixtureKey[]) {
      const h = html(data(key), "training", 2);
      const lit =
        h.match(/<li data-lit=""[^>]*>[\s\S]*?<\/ol><\/span><\/li>/)?.[0] ?? "";
      expect(lit).toContain("Project Closing Mastery");
      expect(lit).toContain("What it teaches");
      for (const p of [
        "The consultation",
        "The proposal",
        "The objections",
        "The close",
      ])
        expect(lit).toContain(p);
      expect((h.match(/class="dkc-course-n"/g) ?? []).length).toBe(6);
      // The quiet rows carry no ring: only the lit row draws a node.
      expect((h.match(/<svg/g) ?? []).length).toBe(1);
      expect((h.match(/class="dkc-train-say"/g) ?? []).length).toBe(2);
      expect(h).toContain("starting with the sales crash course");
      expect(h).toContain("The link is in your WhatsApp group.");
      expect(text(h)).not.toMatch(/weekly|every two weeks/i);
    }
    const ar = html(data("full", "ar"), "training", 2);
    expect(ar).toContain("إتقان توقيع المشاريع");
    expect(ar).toContain("اللي بتتعلمونه");
    // The Academy's own numbers, in Arabic-Indic digits, never ٠١.
    expect(ar).toContain('<span class="dkc-course-n">٥</span>');
  });

  test("the portal's number-one job: three taps with their lines, and what to tell us", () => {
    const full = html(data("full"), "portal", 3);
    expect(full).toContain("Your number-one job: mark every meeting");
    for (const l of [
      "Running late isn't a no-show.",
      "Sent it later? Update it then.",
      "Add the value, or a line on why.",
    ])
      expect(full).toContain(l);
    expect(full).toContain(
      "Cancelled or moved with you directly? Tell us in the group: we change the reminders or call to rebook.",
    );
    // The three taps are numbered, in order, and the rebook mark has its
    // arrowhead (a ring and an arc read as a copyright sign).
    expect(full).toMatch(
      /<li><i aria-hidden="true">1<\/i><span>Did they come\?/,
    );
    expect(full).toContain('class="dkc-rebook"');
    expect(full).not.toContain("so we can call to rebook");
    // Done with you their own team rebooks: no moved row, the late check under the stages.
    const dwy = html(data("dwy"), "portal", 0);
    expect(dwy).not.toContain("Cancelled or moved");
    expect(dwy).toContain(
      "Not there? Check they're not just running late before you move it.",
    );
  });

  test("the six jobs: three heads, two jobs each, the calendar week with ten or more open slots", () => {
    const h = html(data("full"), "your-part");
    expect(h).toContain("Your six jobs, in one place");
    expect(h).not.toContain("Your part");
    for (const head of [
      "Before your meetings",
      "After each meeting",
      "Week to week",
    ])
      expect(h).toContain(head);
    expect((h.match(/class="dkc-part-cell"/g) ?? []).length).toBe(6);
    expect(h).toContain("Keep at least 10 open slots, at different times");
    expect(h).toContain("Add each booking to your own system");
    expect(h).toContain(
      "Mark every meeting the same day, with the value when you win",
    );
    // One sentence per job on the slide (score round 1: six jobs at two
    // sentences each read as a document); the second goes to the notes
    // and the recap.
    // The follow-up keeps its second sentence on the slide (score round 2
    // of the five services): followed up by both of us, done for you.
    expect(h).toContain(
      "You send the quote and set the second meeting. Our caller checks in too.",
    );
    expect(html(data("dwy"), "your-part")).not.toContain(
      "Our caller checks in too.",
    );
    expect(h).not.toContain("On a day off");
    expect(h).toContain(
      "Pausing early ends the test before it tells us anything.",
    );
    // The week: open slots at different hours, a day off blocked hour by
    // hour (never one block), and the dark cells named once, in a key.
    const open = (h.match(/class="dkc-wk-slot"><\/i>/g) ?? []).length;
    expect(open).toBeGreaterThanOrEqual(10);
    const off =
      h.match(
        /<span class="dkc-wk-day" data-off="">[\s\S]*?<\/i><\/span>/,
      )?.[0] ?? "";
    expect(off).toContain("Day off");
    expect((off.match(/data-busy=""/g) ?? []).length).toBe(3);
    expect((h.match(/>Busy</g) ?? []).length).toBe(0);
    expect(h).toMatch(
      /class="dkc-wk-key"><i class="dkc-wk-slot" data-busy=""><\/i>Blocked<\/span>/,
    );
    // Their project pictures sit with the Drive folder they feed.
    const cell = (job: string) =>
      h.match(
        new RegExp(
          `data-job="${job}">[\\s\\S]*?</p><p class="dkc-part-why">[^<]*</p>(<span class="dkc-part-pic dkc-part-tray")?`,
        ),
      )?.[1] ?? "";
    expect(cell("drive")).toContain("dkc-part-tray");
    expect(cell("ads")).toBe("");
    // Each head holds its own two jobs, in order.
    const col = (head: string) =>
      h.match(new RegExp(`data-head="${head}">[\\s\\S]*?</section>`))?.[0] ??
      "";
    expect(col("before")).toMatch(/data-job="slots"[\s\S]*data-job="system"/);
    expect(col("after")).toMatch(/data-job="mark"[\s\S]*data-job="follow"/);
    expect(col("weeks")).toMatch(/data-job="ads"[\s\S]*data-job="drive"/);
    // Done with you, no calling job under "After each meeting".
    const dwy = html(data("dwy"), "your-part");
    const dwyAfter =
      dwy.match(/data-head="after">[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(dwyAfter).not.toMatch(/\bCall\b|within 5 minutes/);
    const dwyBefore =
      dwy.match(/data-head="before">[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(dwyBefore).toContain(
      "Call new enquiries within 5 minutes, and note every try",
    );
    expect(dwy).not.toContain("Add each booking to your own system");
  });

  test("the group's recap: the six jobs, how we test, the course and its link, then the videos", () => {
    const recap = partText(data("starter"));
    expect(recap.split("\n")[0]).toBe("Your six jobs, in one place");
    expect(recap).toContain("Before your meetings:");
    expect(recap.match(/^- /gm)?.length).toBe(6);
    // The recap keeps every job's second sentence, pasted alone in the group.
    expect(recap.replace(/\u00a0/g, " ")).toContain(
      "- Keep at least 10 open slots, at different times. Our callers book into them. On a day off, block each hour, not one all-day event.",
    );
    expect(recap).toContain(
      "You send the quote and set the second meeting. Our caller checks in too.",
    );
    expect(partText(data("dwy"))).not.toContain("Our caller checks in too.");
    expect(recap).toContain(
      "How we test your ads: your red lines stay fixed, your ideas go in the group before the next round, you check the facts, prices and claims before an ad goes live, and small style changes go into the next round so your launch doesn't wait.",
    );
    // The money and the first weeks, every time, after how we test.
    expect(recap).toContain(
      "Keep your ad card funded. Your payments to us are on the dates in your agreement.\nThe first weeks are usually slower while the ads find your audience. Leave them running.",
    );
    expect(recap.indexOf("Keep your ad card")).toBeGreaterThan(
      recap.indexOf("How we test your ads"),
    );
    // No video recorded: the course is the last line.
    expect(recap.trimEnd().split("\n").at(-1)).toBe(
      "Before your first meetings: Project Closing Mastery in the Academy: https://www.skool.com/premium-projects-academy-3669",
    );
    // With videos, they close the recap.
    const full = partText(data("full"));
    expect(full).toContain("Missed something on the call? Watch:");
    expect(full.indexOf("Watch:")).toBeGreaterThan(full.indexOf("skool.com"));
    const ar = partText(data("full", "ar"));
    expect(ar).toContain(
      "قبل أول مواعيدكم: كورس إتقان توقيع المشاريع في الأكاديمية: https://www.skool.com/",
    );
  });

  test("the first two weeks: usually slower, under the bar's label", () => {
    const h = html(data("full"), "first-90-days");
    expect(h).toContain("Usually slower, while the ads find your audience.");
    expect(html(data("full", "ar"), "first-90-days")).toContain(
      "عادةً تكون أهدأ",
    );
  });

  test("the call's stop 7: one voice before the meeting, done for you only", () => {
    const line =
      "Before the meeting, the messages come from us, so your customer hears one voice.";
    expect(html(data("full"), "call", CALL_STAGES)).toContain(line);
    expect(html(data("dwy"), "call", CALL_STAGES)).not.toContain(line);
  });

  test("good to know: the money rows, then the messages, the replies only without the onboarding deck", () => {
    const full = html(data("full"), "good-to-know");
    // Not "before we go live": comments and replies run on after it.
    expect(full).toContain("Good to know");
    expect(full).not.toContain("Before we go live");
    expect(full).toMatch(
      /data-group="money"><h3[^>]*>Money<\/h3>[\s\S]*data-row="charges"[\s\S]*data-row="card"[\s\S]*data-row="pay"[\s\S]*data-group="messages"><h3[^>]*>Messages<\/h3>[\s\S]*data-row="comments"[\s\S]*data-row="replies"/,
    );
    for (const k of ["charges", "card", "pay", "comments", "replies"])
      expect(full).toContain(`data-row="${k}"`);
    expect(full.replace(/<[^>]+>/g, "")).toContain(
      "On the dates in your agreement. If one fails, the ads, our calls and Mahara OS pause until it's sorted.",
    );
    // Each money row's do-this in ink inside its line.
    for (const act of [
      "Tell your bank",
      "Tell us first",
      "On the dates in your agreement.",
    ])
      expect(full).toContain(`<span class="dkc-know-act">${act}</span>`);
    expect(full).toContain(
      "In the group within 2 working hours, 10 to 6, Saturday to Thursday.",
    );
    expect(html({ ...data("full"), uae: true }, "good-to-know")).toContain(
      "In the group within 2 working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday.",
    );
    // A client who saw the onboarding deck heard the reply time on O3.
    const dwy = html(data("dwy"), "good-to-know");
    expect(dwy).not.toContain('data-row="replies"');
    expect(dwy).toContain("the ads and the systems we run for you pause");
    expect(dwy).not.toContain("our calls");
  });

  test("the green light is the question alone, with the road behind it", () => {
    const h = html(data("full"), "green-light");
    expect(h).toContain("Happy for us to go live?");
    expect(h).not.toContain("Meta's first charges");
    expect(L_TITLES_GREEN()).toBe("Happy for us to go live?");
  });

  test("prep and the notes name what the slide shows: a client already live is live, and the ask is to carry on (score round 2 of the five services)", () => {
    const slide = (id: string) => {
      const s = launchSlides().find(x => x.id === id);
      if (!s) throw new Error(id);
      return s;
    };
    const live = data("starter");
    expect(live.launch.live).toBe(true);
    expect(titleFor(slide("cover"), live).en).toBe("{name} is live");
    expect(titleFor(slide("green-light"), live).en).toBe(
      "Happy for us to carry on?",
    );
    const ahead = data("full");
    expect(ahead.launch.live).toBe(false);
    expect(titleFor(slide("cover"), ahead).en).toBe("{name} goes live");
    expect(titleFor(slide("green-light"), ahead).en).toBe(
      "Happy for us to go live?",
    );
  });

  test("a WhatsApp ad's chat: the starter's picture said in the tag, the ad over the waiting message, our call as the band (score round 2 of the five services)", () => {
    for (const lang of ["en", "ar"] as const) {
      const d = data("starter", lang);
      const form = html(d, "form");
      expect(form).toContain(
        lang === "en"
          ? "Example wording, starter ad"
          : "صياغة للتوضيح، إعلان بداية",
      );
      // Two steps under the line, then our call as the band, its 5
      // minutes underlined.
      expect((form.match(/<li data-band=""/g) ?? []).length).toBe(1);
      expect(form).toMatch(
        /<li data-band=""><span class="dkc-q-n">[^<]*<\/span><span class="dk-body">[^<]*<span class="dkc-thanks-mark">/,
      );
      // Journey stop 2: the chat waiting to send, the ad it came from over
      // the field.
      const journey = html(d, "journey", 1);
      expect(journey).toContain('class="dkc-wa-body" data-ref=""');
      expect(journey).toContain("dkc-wa-ref");
    }
  });
});

/**
 * Creative flexibility (the CEO, 2026-10-20; CONTENT L3, DESIGN 21.1): five
 * stops beside one drawing, the field of ad tiles, and the pushback handle
 * tied to the client's own 90-day goal.
 */
describe("creative flexibility, drawn", () => {
  const html = (d: DeckData, tour = 0) =>
    renderToStaticMarkup(
      <>
        {launchSlides()
          .find(s => s.id === "creative-freedom")
          ?.render(ctx(d, tour))}
      </>,
    )
      .replace(/&#x27;/g, "'")
      .replace(/[\u2066-\u2069]/g, "")
      .replace(/\u00a0/g, " ");
  const field = (h: string) =>
    h.match(/<div class="dkf-field"[\s\S]*$/)?.[0] ?? "";
  const lit = (h: string) => (field(h).match(/data-lit=""/g) ?? []).length;

  test("stop 1: the ads' job, beside the field all lit, tagged, with no phone", () => {
    const h = html(data("full"), 0);
    expect(h).toContain("Your ads have one job");
    expect(h).toContain(
      "Your page shows your brand. Your ads are there to bring in business: enquiries from people who don't know you yet.",
    );
    // Never an absolute a client can test against their own Page.
    expect(h).toContain(
      "They show in people's feeds, marked Sponsored, not as posts on your page.",
    );
    expect((field(h).match(/class="dkf-tile"/g) ?? []).length).toBe(18);
    expect(lit(h)).toBe(18);
    // Example ads in every tile, tagged as such (DESIGN 22.4.4); the note
    // tells the CSM so, and both are pinned together.
    expect(h).not.toContain("Illustration");
    expect(h).toContain("Example ads");
    // Eighteen tiles and the next round's six (shown at stop 5).
    expect((field(h).match(/class="dkf-photo"/g) ?? []).length).toBe(24);
    expect(L_NOTES["creative-freedom"].say.join(" ")).toContain(
      "the tiles are example ads, not theirs",
    );
    expect(h).not.toContain("dkc-phone");
    expect(field(h)).toContain('data-stop="0"');
    // The next round waits, unseen.
    expect(field(h)).not.toContain("data-shown");
  });

  test("stop 2: most switch off, three stay lit, and their pick runs too", () => {
    const h = html(data("full"), 1);
    expect(h).toContain("We test a lot, fast");
    expect(h).toContain(
      "We make many versions and switch most of them off. That's how we find the few that work.",
    );
    expect(lit(h)).toBe(3);
    expect(h).toContain("Your pick runs too, beside the ones you'd skip.");
    expect(html(data("starter"), 1)).toContain(
      "The ones you'd pick run too, beside the ones you'd skip.",
    );
  });

  test("stop 3: their red lines on the amber panel, then the smooth way to ask, and the offer", () => {
    const h = html(data("full"), 2);
    expect(h).toContain("Your input comes first");
    // The panel, lighter (DESIGN 22.6.2): no head, no foot, no per-line tag.
    expect(h).not.toContain("Fixed: your red lines");
    expect(h).not.toContain("We never cross these.");
    expect(h).not.toContain("dkc-told");
    // Input first, in fact as well as in the name: the input line, the
    // offer, then the red lines.
    expect(
      h.indexOf("Ideas, a new offer, a new price, something to change?"),
    ).toBeLessThan(h.indexOf('class="dkc-fixed"'));
    // What they told us leads.
    expect(h.indexOf("Photos of the owner")).toBeLessThan(
      h.indexOf("Show our real projects, never stock photos"),
    );
    const heads = [...h.matchAll(/class="dkc-fixed-lead">([^<]*)</g)].map(
      m => m[1],
    );
    expect(heads).toEqual(["Never", "Always"]);
    // "Never" said once: a line drops a leading word its head says.
    expect(h).toMatch(/>Show prices in an ad<\/span><\/li>/);
    expect(h).not.toContain("Never show prices in an ad");
    expect(underHead("Never show prices in an ad", "never")).toBe(
      "Show prices in an ad",
    );
    expect(underHead("No photos", "never")).toBe("No photos");
    expect(underHead("Always show our real projects", "always")).toBe(
      "Show our real projects",
    );
    expect(underHead("أبد ما نعرض الأسعار", "never")).toBe("ما نعرض الأسعار");
    // One source line under the panel.
    expect(h).toContain(
      "From your card, and what you told us on the onboarding call.",
    );
    // A typed line copied to the card shows once, as theirs.
    const copied = redLineGroups(
      {
        told: ["No photos of the owner"],
        never: ["No photos of the owner", "Never show prices in an ad"],
        always: [],
      },
      "en",
    );
    expect(copied.never).toEqual([
      { text: "No photos of the owner", told: true },
      { text: "Never show prices in an ad", told: false },
    ]);
    // In Arabic, the English deck's two columns (score round 2: the panel
    // stacked its groups, then a third head with run-in heads): أبداً and
    // دايماً, each with its Arabic lines first, then the card's English
    // lines with no Arabic typed, quoted as one left-to-right block, never
    // mixed into the Arabic lines. Each quoted block carries its tag
    // (score round 2 of the five services: once, the English line under
    // دايماً read as untagged).
    const ar = html(data("full", "ar"), 2);
    const arHeads = [...ar.matchAll(/class="dkc-fixed-lead">([^<]*)</g)].map(
      m => m[1],
    );
    expect(arHeads).toEqual(["أبداً", "دايماً"]);
    expect(ar).toContain('class="dkc-fixed-pair" data-side=""');
    expect(ar.match(/بملفكم، بالإنجليزي/g)).toHaveLength(2);
    const never = ar.slice(
      ar.indexOf('data-group="never"'),
      ar.indexOf('data-group="always"'),
    );
    const always = ar.slice(ar.indexOf('data-group="always"'));
    expect(never.indexOf("لا تحطون صور المالك")).toBeLessThan(
      never.indexOf("بملفكم، بالإنجليزي"),
    );
    expect(never.indexOf("بملفكم، بالإنجليزي")).toBeLessThan(
      never.indexOf(">Show prices in an ad<"),
    );
    expect(never).toMatch(
      /<div class="dkc-fixed-quoted"><span class="dkc-fixed-sublead">[^<]*<\/span><ul dir="ltr">/,
    );
    expect(always).toMatch(
      /<div class="dkc-fixed-quoted"><span class="dkc-fixed-sublead">[^<]*<\/span><ul dir="ltr">/,
    );
    expect(always).toContain("Show our real projects, never stock photos");
    expect(ar).toContain("لا تحطون صور المالك");
    // A card line with its Arabic typed in prep takes its own group.
    const typed = redLineGroups(
      { told: [], never: ["Never show prices in an ad"], always: [] },
      "ar",
      { "Never show prices in an ad": "ما نعرض الأسعار بالإعلان" },
    );
    expect(typed.never).toEqual([
      { text: "ما نعرض الأسعار بالإعلان", told: false },
    ]);
    expect(typed.fromCard).toEqual([]);
    expect(h).not.toContain("You approve every fact");
    expect(h).toContain(
      "Ideas, a new offer, a new price, something to change? Send it in the group before we make the next round.",
    );
    expect(h).toContain(
      "Keep your offer steady while a test runs. A new offer starts the test again.",
    );
    expect(field(h)).toContain("data-shown");
    expect(field(h)).toContain("Next round");
    // No red lines yet: the panel asks for them.
    expect(html(data("starter"), 2)).toContain(
      "No red lines written yet. Tell us now and we'll add them to your card.",
    );
  });

  test("stop 4: the check is one line, small style changes go into the next round", () => {
    const h = html(data("full"), 3);
    expect(h).toContain("Then a quick check, not a redesign");
    const check = h.match(/<p class="dkc-cf-checks">[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(check.replace(/<[^>]+>/g, "")).toBe("Facts · Prices · Claims");
    // One small line, not two saying the same thing.
    expect(h).toContain("You check these in the group before an ad goes live.");
    expect(h).toContain(
      "Small style changes go into the next round, so your launch doesn't wait.",
    );
    expect(h).not.toContain("You approve your ads in the group.");
    expect(field(h)).toContain("Your style change");
    expect(field(h)).toContain('data-stop="3"');
    const ar = html(data("full", "ar"), 3);
    const checkAr =
      ar.match(/<p class="dkc-cf-checks">[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(checkAr.replace(/<[^>]+>/g, "")).toBe("المعلومات، الأسعار، الوعود");
  });

  test("stop 5: keep the content coming, with the why, and where the folder is", () => {
    const h = html(data("full"), 4);
    expect(h).toContain("Keep the content coming");
    expect(h).toContain(
      "Send new photos and videos of your projects whenever you can. More content means more ads to test.",
    );
    expect(h).toContain("Your folder link is pinned in your WhatsApp group.");
    expect(h).not.toContain("drive.google.com");
    expect(field(h)).toContain('data-stop="4"');
  });

  test("the field never carries a count, and of the client's creatives only their pick, on a tile that stays lit", () => {
    for (const tour of [0, 1, 2, 3, 4]) {
      const f = field(html(data("full"), tour));
      expect(f.replace(/<[^>]+>/g, " ")).not.toMatch(/[0-9٠-٩]/);
      // Example pictures in every tile and the next round; of the client's
      // own creatives, only their pick, from the switch-off on, on one lit
      // tile with its star, never a dimmed one.
      const own = f.match(/<span class="dkf-pick"/g) ?? [];
      expect(own.length).toBe(tour === 0 ? 0 : 1);
      if (tour > 0)
        expect(f).toMatch(
          /<span class="dkf-tile" data-lit="" data-pick=""[^>]*><span class="dkf-pick" aria-hidden="true"><img/,
        );
      // Every picture but their pick is one of Mahara's examples.
      for (const m of f.matchAll(/<img src="([^"]+)"/g))
        if (!m[0].includes("custom-site"))
          expect(m[1]).toContain("/assets/examples/tile/");
    }
    // No pick marked: no picture of theirs at all, and the tag never says
    // "your pick".
    for (const tour of [1, 4]) {
      const h = html(data("starter"), tour);
      expect(field(h)).not.toContain("dkf-pick");
      expect(h).toContain("Example ads");
      expect(h).not.toContain("and your pick");
    }
    expect(html(data("full"), 1)).toContain("Example ads, and your pick");
  });

  test("the stamp, once their yes is recorded, on any stop; none before", () => {
    for (const tour of [0, 2, 4])
      expect(html(data("full"), tour)).toContain(
        "Agreed to test this way · 19 Oct",
      );
    // On the title row, off the words column (the visual review).
    expect(html(data("full"), 2)).toMatch(
      /class="dkc-cf-head"><h2[^>]*>[^<]*<\/h2><span class="dk-tag dkc-stamp">/,
    );
    expect(html(data("starter"), 3)).not.toContain("Agreed to test this way");
  });

  test("done with you: the same slide", () => {
    const words = (h: string) =>
      h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const tour of [0, 1, 3, 4])
      expect(words(html(data("dwy"), tour))).toContain(
        words(html(data("full"), tour)).match(
          /Your ads have one job|We test a lot, fast|Then a quick check, not a redesign|Keep the content coming/,
        )?.[0] ?? "x",
      );
    const n = launchSlides().find(s => s.id === "creative-freedom")?.notes;
    expect(n?.dwy?.[0]).toContain(
      "Your team runs the calls, but the ads work the same way",
    );
  });

  test("prep warns when more than five red lines would push the panel past the content box", () => {
    const s = launchSlides().find(x => x.id === "creative-freedom");
    expect(s?.missing?.(data("full"))).toEqual([]);
    const d = data("full");
    const six = {
      ...d,
      launch: {
        ...d.launch,
        redLines: {
          ...d.launch.redLines,
          told: [...d.launch.redLines.told, "One more"],
        },
      },
    };
    expect(s?.missing?.(six)).toEqual([
      "More than five red lines show on slide 3. Hide some in prep so the panel fits.",
    ]);
  });

  test("the pushback is picked by their own 90-day goal: shown, held back, or none", () => {
    const full = data("full");
    expect(pushbackVariant(full)).toBe("shown");
    expect(goalAsk(full, "en")).toBe(
      'You told us your goal is "Two to three villa interior projects signed every month, mostly in north Riyadh". What matters more: this one change, or getting the ads live so we can get there?',
    );
    // The notes window sets the goal on its own line, between the halves.
    expect(goalAskParts(full, "en")).toEqual({
      before: "You told us your goal is",
      goal: "Two to three villa interior projects signed every month, mostly in north Riyadh",
      after:
        "What matters more: this one change, or getting the ads live so we can get there?",
    });
    expect(goalAskParts(full, "ar")).toEqual({
      before: "قلتوا لنا إن هدفكم:",
      goal: "Two to three villa interior projects signed every month, mostly in north Riyadh",
      after: "أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل عشان نوصل له؟",
    });
    const held = {
      ...full,
      launch: { ...full.launch, goal90: null, goal90Held: true },
    };
    expect(pushbackVariant(held)).toBe("held");
    expect(goalAskParts(held, "ar")).toBeNull();
    expect(goalAsk(held, "en")).toBe(
      "You told us what you want from your first 90 days. What matters more: this one change, or getting the ads live so we can work towards it?",
    );
    expect(pushbackVariant(data("sparse"))).toBe("none");
    expect(goalAsk(data("sparse"), "ar")).toBe(
      "أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل؟",
    );
    // Copy reply: one line, in the deck's language, never isolated.
    expect(replyText(full)).toStartWith(
      'Thanks, noted. You told us your goal is "Two to three villa interior projects signed every month, mostly in north Riyadh", so',
    );
    // A goal written in the first person still reads: it is quoted, not spliced.
    const we = {
      ...full,
      launch: { ...full.launch, goal90: "We want two kitchens a month." },
    };
    expect(replyText(we)).toStartWith(
      'Thanks, noted. You told us your goal is "We want two kitchens a month", so',
    );
    expect(replyText(held)).not.toMatch(/\{goal\}|Two to three/);
    const ar = data("dwy", "ar");
    expect(replyText(ar)).toContain("قلتوا لنا إن هدفكم: نبي نوقع عقدين");
    expect(replyText(ar)).not.toMatch(/[\u2066-\u2069]/);
  });
});

describe("the launch deck's fallbacks", () => {
  test("the cover says 'is live' once the go-live date has passed", () => {
    expect(data("full").launch.live).toBe(false);
    expect(data("starter").launch.live).toBe(true);
    const html = renderToStaticMarkup(
      <>{launchSlides()[0].render(ctx(data("starter")))}</>,
    );
    expect(html).toContain("is live");
    expect(html).toContain(
      "Everything your customers see, and what happens next.",
    );
  });

  test("the cover never uses a starter creative", () => {
    expect(data("full").launch.cover?.id).toBe("custom-site");
    expect(data("starter").launch.cover).toBeNull();
  });

  // The ad pictures a slide draws: the fixture's files and the examples.
  const pictures = (h: string) =>
    [...h.matchAll(/<img[^>]*?src="([^"]+)"/g)]
      .map(m => m[1])
      .filter(u => /custom-|dwy-|starter-|\/examples\//.test(u));

  test("the cover and journey stop 1 never show one picture (DESIGN 22.15)", () => {
    for (const key of ["full", "starter", "sparse"] as FixtureKey[])
      for (const lang of ["en", "ar"] as Lang[]) {
        const d = data(key, lang);
        const cover = pictures(
          renderToStaticMarkup(<>{launchSlides()[0].render(ctx(d))}</>),
        );
        const journey = pictures(
          renderToStaticMarkup(<>{launchSlides()[1].render(ctx(d, 0))}</>),
        );
        expect({ key, lang, cover: cover.length > 0 }).toEqual({
          key,
          lang,
          cover: true,
        });
        expect(journey.length).toBeGreaterThan(0);
        for (const u of cover)
          expect({ key, lang, u, again: journey.includes(u) }).toEqual({
            key,
            lang,
            u,
            again: false,
          });
      }
  });

  test("a client with ads of their own and no cover pick shows their first ad, never the faint lanes", () => {
    for (const lang of ["en", "ar"] as Lang[]) {
      const d = data("dwy", lang);
      expect(d.launch.cover).toBeNull();
      const h = renderToStaticMarkup(<>{launchSlides()[0].render(ctx(d))}</>);
      expect(h).not.toContain("dkc-faint");
      expect(pictures(h).some(u => /dwy-villa/.test(u))).toBe(true);
    }
  });

  test("prep's cover controls say what the cover shows, and switch the example when there is no ad of their own", () => {
    const controls = (key: FixtureKey) => {
      const d = data(key);
      const model = {
        prep: { onboarding: {}, launch: {} },
        setPrep: () => {},
        live: emptyLive(),
        setLive: () => {},
      } as unknown as DeckModel;
      return renderToStaticMarkup(
        <LaunchControls slideId="cover" d={d} model={model} tour={0} full />,
      );
    };
    const starter = controls("starter");
    expect(starter).toContain(
      "No ads of their own yet: the cover shows the example ad, labelled Example ad.",
    );
    expect(starter).toContain("The example ad");
    expect(starter.toLowerCase()).not.toContain("faint lanes");
    // The example's switch, by service then by scene.
    expect(starter).toContain("Fit-out and renovation");
    const dwy = controls("dwy");
    expect(dwy).toContain(
      "No cover picked: it shows their first ad. Pick another here.",
    );
    expect(dwy).toContain("Their first ad");
    expect(dwy.toLowerCase()).not.toContain("faint lanes");
    // The prep check speaks only when there is an ad of theirs to pick.
    const cover = launchSlides()[0];
    expect(cover.missing?.(data("starter")).join(" ")).not.toContain("Cover:");
    expect(cover.missing?.(data("dwy")).join(" ")).toContain(
      "Cover: no ad picked, so it shows their first ad.",
    );
  });

  test("the hours card shows only when the onboarding deck was never presented", () => {
    expect(data("full").launch.hoursCard).toBe(true);
    expect(data("dwy").launch.hoursCard).toBe(false);
    expect(data("starter").launch.hoursCard).toBe(false);
  });

  test("red lines: what they told us first, then the card's DO and DON'T, never NOTES", () => {
    const R = data("full").launch.redLines;
    expect(R.told).toEqual(["No photos of the owner", "No music with lyrics"]);
    expect(R.never).toContain("Never show prices in an ad");
    expect(R.always).toContain("Show our real projects, never stock photos");
    expect(JSON.stringify(R)).not.toContain("calls after 4");
    expect(data("starter").launch.redLines).toEqual({
      told: [],
      always: [],
      never: [],
    });
  });

  test("the phones start from prep, else the creatives' own shapes", () => {
    const d = data("full");
    const all = [...d.launch.creatives, ...d.launch.metaCreatives];
    const phones = defaultPhones(all, d.launch.phonesPrep);
    expect(phones.reels).toBe("custom-tall");
    expect(phones.feed).not.toBe(phones.facebook);
    expect(defaultPhones([], {})).toEqual({});
  });

  test("the meeting places join as the client says them", () => {
    expect(placesLine([], "en")).toBe(
      "at your office, at their home, or online",
    );
    expect(placesLine(["office", "online"], "ar")).toBe("في مكتبكم أو أونلاين");
    expect(placesOf("At our showroom, At the client's home")).toEqual([
      "office",
      "home",
    ]);
  });

  test("every slide and stop renders for every client, in both languages", () => {
    for (const key of ["full", "sparse", "dwy", "starter"] as FixtureKey[])
      for (const lang of ["en", "ar"] as Lang[]) {
        const d = data(key, lang);
        for (const s of launchSlides()) {
          const n = s.stops?.(ctx(d)) ?? 1;
          for (let i = 0; i < n; i++) {
            const html = renderToStaticMarkup(<>{s.render(ctx(d, i))}</>);
            expect(html.length).toBeGreaterThan(50);
            // No leads and no cost per lead in any word a client sees.
            const words = html.replace(/<[^>]+>/g, " ");
            expect(words).not.toMatch(/\bleads?\b|cost per lead|ليد/i);
          }
        }
      }
  });
});

describe("the example call", () => {
  test("the script runs 0:00 to 4:46 in order, stages 1 to 6, both dialects and English", () => {
    let last = -1;
    let stage = 1;
    for (const t of TURNS) {
      const [m, s] = t.at.split(":").map(Number);
      const at = m * 60 + s;
      expect(at).toBeGreaterThan(last);
      last = at;
      expect(t.stage).toBeGreaterThanOrEqual(stage);
      stage = t.stage;
      expect(t.kw && t.sa && t.en).toBeTruthy();
    }
    expect(TURNS[0].at).toBe("0:00");
    expect(TURNS.at(-1)?.at).toBe("4:46");
    expect(new Set(TURNS.map(t => t.stage))).toEqual(
      new Set([1, 2, 3, 4, 5, 6]),
    );
  });

  test("the pain variants change four lines, and a missing handle drops one turn", () => {
    const delays = turnsFor("delays", true);
    const design = turnsFor("design", true);
    const changed = delays.filter((t, i) => t.line.en !== design[i].line.en);
    expect(changed.map(t => t.at)).toEqual(["1:46", "2:05", "2:17", "3:16"]);
    expect(turnsFor("cost", false).length).toBe(delays.length - 1);
    expect(turnsFor("cost", false).some(t => t.at === "4:35")).toBe(false);
  });

  test("the full client's call: Saudi, design story, riyals, Wednesday at 4", () => {
    const c = data("full").launch.call;
    expect(c.dialect).toBe("sa");
    expect(c.pain).toBe("design");
    expect(c.band.note.en).toBe("50 to 100 thousand riyals");
    expect(c.slot.day.en).toBe("Wednesday");
    expect(c.slot.spoken.en).toBe("4 pm");
    // Counted from go-live (Monday 26 October), still ahead: never a
    // booking before the ads run (final score round 1).
    expect(c.slot.templateDate).toBe("October 28, 2026");
    expect(c.slots.engineer.en.text).toBe("Eng. Khalid");
    expect(c.slots.engineer.ar.text).toBe("المهندس خالد");
    expect(c.slots.free.en.text).toBe("a free consultation");
    expect(c.missing).toEqual([]);
    const line = c.turns.find(t => t.at === "3:25");
    expect(plain(line?.line.en ?? "", "en", c.slots)).toBe(
      "At Noor Studio Interiors, we design every room in 3D before any work starts.",
    );
  });

  test("a client with nothing on file: chips where we need their words, Kuwaiti, no currency", () => {
    const c = data("sparse").launch.call;
    expect(c.dialect).toBe("kw");
    expect(c.dialectFrom).toBe("default");
    expect(c.slots.service.en.ask?.en).toBe("the service we're advertising");
    expect(c.slots.engineer.en.text).toBe("our engineer");
    expect(c.slots.engineer.en.ask).not.toBeNull();
    expect(c.slots.selling.ar.ask?.ar).toBe("اللي يميزكم، بسطر واحد");
    expect(c.band.band.en).toBe(
      "under 50 thousand, between 50 and 100, or more",
    );
    expect(c.missing.length).toBeGreaterThan(3);
  });

  test("the slots worked out (day, time, band) are never drawn as the client's own words", () => {
    const c = data("full").launch.call;
    expect(c.slots.day.en.given).toBe(false);
    expect(c.slots.band.en.given).toBe(false);
    expect(c.slots.company.en.given).toBe(true);
    expect(c.slots.selling.en.given).toBe(true);
  });

  test("the call's helpers", () => {
    expect(closingHour("9am to 2pm")).toBe(14);
    expect(closingHour("Saturday to Thursday, 10am to 8pm")).toBe(20);
    expect(closingHour("")).toBeNull();
    // Two days ahead of a Thursday is a Saturday: the slot moves to Sunday.
    expect(bookedSlot("2026-10-22").day.en).toBe("Sunday");
    expect(bookedSlot("2026-10-19", "9am to 2pm").spoken.en).toBe("1 pm");
    expect(bandFor("KW", "works", "kw").note.en).toBe(
      "5 to 10 thousand dinars",
    );
    expect(bandFor("AE", "build", "kw").band.en).toContain("dirhams");
    expect(dialectFor(undefined, "SA", null).dialect).toBe("sa");
    expect(dialectFor(undefined, null, "Riyadh").dialect).toBe("sa");
    expect(dialectFor("kw", "SA", null).dialect).toBe("kw");
    expect(handleOf("https://instagram.com/noorstudio.sa")).toBe(
      "@noorstudio.sa",
    );
    expect(handleOf("")).toBeNull();
    expect(familyOf("Kitchens")?.key).toBe("kitchens");
    expect(familyOf("Villa construction")?.scale).toBe("build");
  });
});

describe("the call's cursor", () => {
  afterEach(() => callRun.leave());

  test("→ into a stage plays it; → in the middle finishes it; then the deck moves", () => {
    const turns = turnsFor("delays", true);
    callRun.turns = turns;
    callRun.still = false;
    callRun.setTour = () => {};
    callRun.state = { ...callRun.state, tour: -1, leftAt: 0 };
    callRun.arrive(0);
    const [first, end] = stageRange(turns, 1);
    expect(callRun.state.shown).toBe(first);
    expect(callRun.state.playing).toBe(true);
    expect(callRun.finish()).toBe(true);
    expect(callRun.state.shown).toBe(end);
    // A finished stage gives the press back to the deck.
    expect(callRun.finish()).toBe(false);
  });

  test("back into a stage shows it whole; reduced motion shows every stage whole", () => {
    const turns = turnsFor("delays", true);
    callRun.turns = turns;
    callRun.still = false;
    callRun.state = { ...callRun.state, tour: 4, leftAt: 0 };
    callRun.arrive(3);
    expect(callRun.state.shown).toBe(stageRange(turns, 4)[1]);
    callRun.still = true;
    callRun.state = { ...callRun.state, tour: 0, leftAt: 0 };
    callRun.arrive(1);
    expect(callRun.state.shown).toBe(stageRange(turns, 2)[1]);
    expect(callRun.state.playing).toBe(false);
  });
});

describe("the ads slide with motion reduced (DESIGN 15.4)", () => {
  const withVideo = (): DeckData => {
    const f = FIXTURES.full("launch");
    const ads = f.ads.map(a =>
      a.id === "custom-tall"
        ? {
            ...a,
            mime: "video/mp4",
            path: "fixture/custom-tall.mp4",
            posterPath: "fixture/custom-tall-poster.webp",
            posterMime: "image/webp",
            posterUrl: a.url,
            seconds: 24,
          }
        : a,
    );
    return deckData({
      taskId: "fixture-full",
      deck: "launch",
      lang: "en",
      sources: f.sources,
      kit: f.kit,
      prep: f.prep,
      ads,
      presenterName: "Sara Al-Harbi",
      publicUrl: (_b, p) => p,
      now: NOW,
    });
  };
  const ads = launchSlides().find(s => s.id === "ads")!;
  const reels = (live = emptyLive()) =>
    renderToStaticMarkup(
      <>
        {ads.render({
          ...ctx(withVideo(), 2, true),
          live: { ...live, phones: { reels: "custom-tall" } },
        })}
      </>,
    );

  test("a video waits on its poster with a play button; pressed, it plays", () => {
    const waiting = reels();
    expect(waiting).toContain("dkc-play");
    expect(waiting).not.toContain("<video");
    const playing = reels({
      ...emptyLive(),
      playing: { reels: "custom-tall" },
    });
    expect(playing).not.toContain("dkc-play");
    expect(playing).toContain("<video");
  });
});

describe("score round 2: the Drive folder's pictures", () => {
  const c = (
    id: string,
    ratio: number,
    starter = false,
    url: string | null = `/${id}.webp`,
  ): Creative => ({
    id,
    from: "upload",
    name: id,
    url,
    poster: url,
    video: false,
    ratio,
    primaryText: null,
    headline: null,
    cta: null,
    language: null,
    placement: null,
    starter,
    seconds: null,
  });
  test("their own, each picture once: a feed post's Reels crop is never its twin", () => {
    // The full client: a feed post, its Reels crop, a square, two starters.
    const tiles = partTiles([
      c("site", 0.8),
      c("site-tall", 0.5625),
      c("square", 1),
      c("starter-feed", 0.8, true),
      c("starter-reel", 0.5625, true),
    ]);
    expect(tiles).toEqual(["/site.webp", "/square.webp"]);
    // Three different feed-shaped ones: three tiles.
    expect(
      partTiles([c("a", 0.8), c("b", 1), c("c", 0.8), c("d", 0.5625)]),
    ).toEqual(["/a.webp", "/b.webp", "/c.webp"]);
    // Only tall ones: they fill in.
    expect(partTiles([c("a", 0.5625), c("b", 0.5625)])).toEqual([
      "/a.webp",
      "/b.webp",
    ]);
    // One picture, or starters only: no strip.
    expect(partTiles([c("a", 0.8)])).toEqual([]);
    expect(partTiles([c("s", 0.8, true), c("t", 1, true)])).toEqual([]);
    // The same file twice is one tile.
    expect(
      partTiles([
        c("a", 0.8),
        { ...c("b", 1), url: "/a.webp", poster: "/a.webp" },
      ]),
    ).toEqual([]);
  });
});

describe("what the launch deck reads from the Brand Blueprint (SPEC 6.2)", () => {
  const BP = {
    answers: {
      starter: "yes",
      pack_url:
        "https://drive.google.com/drive/folders/1ExamplePackInterior0001",
      approval: "first_batch",
      offer: {
        name: "The whole-floor refresh (example)",
        what: "Design and fit-out for one floor",
        firstStep: "A free site visit",
      },
      rules: {
        always: [
          "Our real projects",
          "Show our real projects, never stock photos",
        ],
        never: ["No prices on screen", "No photos of the owner"],
        neverShow: ["The Salmiya villa"],
      },
    },
    parts: {
      "1": { firstAt: "2026-10-15T07:12:00Z" },
      "2": { firstAt: "2026-10-15T07:44:00Z" },
    },
  };
  function withBlueprint(key: FixtureKey, row: unknown, lang: Lang = "en") {
    const f = FIXTURES[key]("launch");
    return deckData({
      taskId: `fixture-${key}`,
      deck: "launch",
      lang,
      sources: f.sources,
      kit: f.kit,
      prep: f.prep,
      ads: f.ads,
      presenterName: "Sara Al-Harbi",
      publicUrl: (_b, p) => p,
      videos: f.videos,
      videosProblem: f.videosProblem,
      blueprint: launchBlueprintOf(row as never),
      now: NOW,
    });
  }

  test("the offer becomes the selling point only when prep has none", () => {
    const sparse = withBlueprint("sparse", BP);
    expect(sparse.launch.call.slots.selling.en.text).toBe(
      "The whole-floor refresh (example): Design and fit-out for one floor. First step: A free site visit.",
    );
    expect(sparse.launch.call.slots.selling.en.given).toBe(true);
    const full = data("full");
    expect(withBlueprint("full", BP).launch.call.slots.selling).toEqual(
      full.launch.call.slots.selling,
    );
  });

  test("how they approve is a notes line, never a slide line", () => {
    const d = withBlueprint("full", BP);
    expect(d.launch.blueprint?.approval).toBe("first_batch");
    expect(APPROVAL_SAID.first_batch).toBe(
      "You chose to approve the first batch, then we run.",
    );
    for (const s of launchSlides()) {
      const n = s.stops?.(ctx(d)) ?? 1;
      for (let i = 0; i < n; i++)
        expect(renderToStaticMarkup(<>{s.render(ctx(d, i))}</>)).not.toContain(
          "You chose to approve",
        );
    }
  });

  test("the pack: the notes open it, and a starter's tag names the service's pack", () => {
    const d = withBlueprint("full", BP);
    expect(d.launch.blueprint?.packUrl).toBe(
      "https://drive.google.com/drive/folders/1ExamplePackInterior0001",
    );
    expect(starterTag(d.launch, "en")).toBe(
      `From our ${d.launch.serviceMid.en} pack`,
    );
    expect(starterTag(withBlueprint("full", BP, "ar").launch, "ar")).toContain(
      "عندنا",
    );
    // Starter no: no pack, the usual tag.
    const no = withBlueprint("full", {
      ...BP,
      answers: { ...BP.answers, starter: "no" },
    });
    expect(no.launch.blueprint?.packUrl).toBeNull();
    expect(starterTag(no.launch, "en")).toBe("Starter, from our templates");
  });

  test("the rules join the red lines, each once", () => {
    const R = withBlueprint("full", BP).launch.redLines;
    expect(R.told).toEqual([
      "No photos of the owner",
      "No music with lyrics",
      "No prices on screen",
      "The Salmiya villa",
    ]);
    expect(R.always).toContain("Our real projects");
    expect(
      R.always.filter(x => x === "Show our real projects, never stock photos"),
    ).toHaveLength(1);
  });

  test("with no Blueprint the launch deck is unchanged", () => {
    for (const key of ["full", "sparse", "dwy", "starter"] as FixtureKey[]) {
      const plain = data(key);
      const none = withBlueprint(key, null);
      expect(none.launch.blueprint).toBeNull();
      expect({ ...none.launch, blueprint: undefined }).toEqual({
        ...plain.launch,
        blueprint: undefined,
      });
      expect(none.exampleWords).toEqual(plain.exampleWords);
    }
  });
});
