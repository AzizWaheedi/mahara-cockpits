import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURES, type FixtureKey } from "../src/dev/deck/fixtures";
import {
  bandFor,
  bookedSlot,
  closingHour,
  dialectFor,
  familyOf,
  handleOf,
  plain,
  placesOf,
  TURNS,
  turnsFor,
} from "../src/present/callScript";
import { emptyLive } from "../src/present/channel";
import { journeyOwners, type Lang } from "../src/present/content";
import type { SlideCtx } from "../src/present/deckContext";
import { type DeckData, deckData } from "../src/present/deckData";
import { shownSlides } from "../src/present/decks";
import {
  formStops,
  launchSlides,
  placesLine,
  portalStops,
} from "../src/present/launchDeck";
import { defaultPhones, PROOF_ID } from "../src/present/launchData";
import { CALL_STAGES, callRun, stageRange } from "../src/present/Transcript";

/**
 * The launch deck (docs/csm-decks/CONTENT.md L1 to L10, DESIGN.md section
 * 8): its order and stops, the journey's lanes done for you and done with
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

const ORDER = [
  "cover",
  "journey",
  "ads",
  "creative-freedom",
  "form",
  "call",
  "portal",
  "your-part",
  "first-90-days",
  "green-light",
];

describe("the launch deck's order and stops", () => {
  test("ten slides, in CONTENT.md's order", () => {
    expect(launchSlides().map(s => s.id)).toEqual(ORDER);
  });

  test("ids are what the server takes as slide ids, and every slide has notes", () => {
    for (const s of launchSlides()) {
      expect(s.id).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(s.notes.say.length).toBeGreaterThan(0);
      expect(s.notes.sayAr.length).toBeGreaterThan(0);
    }
    expect(launchSlides().filter(s => s.cover).map(s => s.id)).toEqual([
      "cover",
    ]);
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
      "creative-freedom": 3,
      // Opening, their three questions, the thank-you.
      form: 5,
      call: 8,
      portal: 4,
      "your-part": 1,
      "first-90-days": 1,
      "green-light": 2,
    });
  });

  test("the mini rail opens one journey step on slides 3 to 7 only", () => {
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
    expect(rail("portal")).toBe(6);
    expect(rail("your-part")).toBeNull();
    expect(rail("first-90-days")).toBeNull();
    expect(rail("green-light")).toBeNull();
  });

  test("the optional proof stop shows only when prep asks for it", () => {
    const f = FIXTURES.full("launch");
    const d = deckData({
      taskId: "x",
      deck: "launch",
      lang: "en",
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        launch: { ...f.prep.launch, shown_slides: [PROOF_ID] },
      },
      ads: f.ads,
      now: NOW,
    });
    const s = launchSlides().find(x => x.id === "creative-freedom");
    expect(s?.stops?.(ctx(d))).toBe(4);
  });

  test("the form slide hides itself until a form is confirmed or typed", () => {
    const sparse = data("sparse");
    expect(sparse.launch.formHidden).toBe(true);
    expect(shownSlides(launchSlides(), sparse, {}).map(s => s.id)).not.toContain(
      "form",
    );
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
      <>{launchSlides().find(s => s.id === "portal")?.render(ctx(d))}</>,
    );
    expect(html).toContain("Your CRM");
    expect(html).toContain("keep every stage true");
    expect(html).not.toContain("portal-overview");
  });

  test("every DWY slide speaks of their team", () => {
    const d = data("dwy");
    const render = (id: string, tour = 0) =>
      renderToStaticMarkup(
        <>{launchSlides().find(s => s.id === id)?.render(ctx(d, tour))}</>,
      );
    expect(render("journey", 2)).toContain("Your team calls");
    expect(render("journey", 2)).toContain("Your team: call now");
    expect(render("journey", 2)).not.toContain("Top of the list");
    expect(render("journey", 5)).toContain("The follow-up messages start by themselves.");
    expect(render("call", 0)).toContain("How your team should call");
    expect(render("call", 0)).toContain("Our script, for your team");
    expect(render("call", CALL_STAGES)).toContain("Before the meeting");
    expect(render("call", CALL_STAGES)).toContain("Provisional bookings");
    expect(render("call", CALL_STAGES + 1)).toContain("Your caller&#x27;s notes, in your CRM.");
    expect(render("your-part")).toContain("Call fast, note every try, keep every stage true");
  });

  test("done for you keeps our team's words", () => {
    const d = data("full");
    const call = renderToStaticMarkup(
      <>{launchSlides().find(s => s.id === "call")?.render(ctx(d, CALL_STAGES))}</>,
    );
    expect(call).toContain("What we do before the meeting");
    expect(call).toContain("A confirmation call");
    expect(call).not.toContain("Provisional bookings");
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
    expect(html).toContain("Everything your customers see, and what happens next.");
  });

  test("the cover never uses a starter creative", () => {
    expect(data("full").launch.cover?.id).toBe("custom-site");
    expect(data("starter").launch.cover).toBeNull();
  });

  test("the hours card shows only when the onboarding deck was never presented", () => {
    expect(data("full").launch.hoursCard).toBe(true);
    expect(data("dwy").launch.hoursCard).toBe(false);
    expect(data("starter").launch.hoursCard).toBe(false);
  });

  test("red lines: what they told us first, then the card's DO and DON'T, never NOTES", () => {
    const R = data("full").launch.redLines;
    expect(R.told).toEqual(["No photos of the owner"]);
    expect(R.never).toContain("Never show prices in an ad");
    expect(R.always).toContain("Show finished kitchens in daylight");
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
    expect(placesLine([], "en")).toBe("at your office, at their home, or online");
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
    expect(new Set(TURNS.map(t => t.stage))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
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
    expect(c.slot.templateDate).toBe("October 21, 2026");
    expect(c.slots.engineer.en.text).toBe("Eng. Khalid");
    expect(c.slots.engineer.ar.text).toBe("المهندس خالد");
    expect(c.slots.free.en.text).toBe("a free consultation");
    expect(c.missing).toEqual([]);
    const line = c.turns.find(t => t.at === "3:25");
    expect(plain(line?.line.en ?? "", "en", c.slots)).toBe(
      "At Noor Studio Interiors, we draw your kitchen in 3D before any work starts.",
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
    expect(c.band.band.en).toBe("under 50 thousand, between 50 and 100, or more");
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
    expect(bandFor("KW", "works", "kw").note.en).toBe("5 to 10 thousand dinars");
    expect(bandFor("AE", "build", "kw").band.en).toContain("dirhams");
    expect(dialectFor(undefined, "SA", null).dialect).toBe("sa");
    expect(dialectFor(undefined, null, "Riyadh").dialect).toBe("sa");
    expect(dialectFor("kw", "SA", null).dialect).toBe("kw");
    expect(handleOf("https://instagram.com/noorstudio.sa")).toBe("@noorstudio.sa");
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
