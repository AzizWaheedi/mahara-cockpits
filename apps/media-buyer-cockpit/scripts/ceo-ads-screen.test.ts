/**
 * The CEO, 2026-10-16: "check the rest of the data and make sure it's
 * correct". The audit of the Ads tab found words that misled even where the
 * numbers were right: retargeting ads under "Scale", a Fit hint that
 * described a stage rule the number no longer used, "Lead to intro" with no
 * word on what it counts, an intro-to-demo figure with no formula, a shown
 * hint that left out "invalid", a constraint shown in the seven-day view with
 * no word that it is thirty days, a Launch card whose "winners" had no
 * results, and a Marketing card that counted campaigns that never delivered.
 * These tests hold the screen to the fixed words and filters.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deliveredCampaigns,
  deliveredLine,
} from "../src/components/ceo/frequencyFigure";
import { StatusChip, StatusDot } from "../src/components/ceo/StatusChip";
import {
  CONFIRMED_INTROS_HINT,
  COVERAGE_HINT,
  closerHint,
  constraintText,
  coverageLine,
  Fact,
  FIT_HINT,
  INTROS_HINT,
  introFigures,
  LEAD_TO_INTRO_HINT,
  LEADS_HINT,
  NA_REFRESH,
  NA_ZERO,
  Num,
  People,
  peopleDays,
  RETIRED_STAGES,
  setterHint,
  TONE,
  verdictChips,
  verdictLabel,
} from "../src/pages/ceo/adsFacts";
import {
  hasResults,
  launchWinners,
  noWinnersText,
  resultsLine,
  WINNERS_HEADING,
  winnersPrompt,
} from "../src/pages/ceo/launchWinners";
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bAdWindow,
  B2bVerdict,
} from "../src/types/ceo/payloads";

const APP = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(APP, p), "utf8");
const text = (html: string) =>
  html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

/** Every visible string on the tab is plain: no em dash. */
const plain = (s: string) => expect(s).not.toContain("—");

const WINDOWS: B2bAdsPayload["windows"] = {
  from7: "2026-10-10",
  from30: "2026-09-17",
  to: "2026-10-16",
};

describe("the not judged verdict", () => {
  test("is neutral, labelled in words, and never a scale, fatiguing or kill chip", () => {
    expect(TONE.not_judged).toBe("neutral");
    expect(verdictLabel("not_judged")).toBe("Not judged");
    expect(verdictLabel("no delivery")).toBe("No delivery");
    expect(verdictLabel("scale")).toBe("Scale");

    // The snapshot after the fixes: 17 retargeting ads that were "Scale",
    // the one "Fatiguing" and the 31 "No delivery" are all not judged.
    const chips = verdictChips({
      not_judged: 49,
      hold: 5,
      kill: 1,
      scale: 0,
    });
    expect(chips.map(c => c.key)).toEqual(["not_judged", "hold", "kill"]);
    const nj = chips.find(c => c.key === "not_judged");
    expect(nj).toEqual({
      key: "not_judged",
      label: "not judged",
      tone: "neutral",
      n: 49,
    });
    // Its count is its own, never inside scale, fatiguing or kill.
    expect(chips.find(c => c.key === "scale")).toBeUndefined();
    expect(chips.find(c => c.key === "fatiguing")).toBeUndefined();
    expect(chips.find(c => c.key === "kill")?.n).toBe(1);
    for (const k of ["scale", "fatiguing", "kill"] as const)
      expect(TONE[k]).not.toBe("neutral");
  });

  test("a key the screen does not know reads neutral, never a crash", () => {
    expect(verdictChips({ "something new": 2 })[0].tone).toBe("neutral");
  });

  test("the chip and the dot render the words, not the key", () => {
    const v: B2bVerdict["verdict"] = "not_judged";
    const chip = renderToStaticMarkup(
      createElement(StatusChip, { tone: TONE[v], label: verdictLabel(v) }),
    );
    expect(chip).toContain("Not judged");
    expect(chip).not.toContain("not_judged");
    const [c] = verdictChips({ not_judged: 3 });
    const dot = renderToStaticMarkup(
      createElement(StatusDot, { tone: c.tone, label: `${c.label} verdict` }),
    );
    expect(dot).toContain("not judged verdict");
  });

  test("the tab reads TONE and the labels from adsFacts, so there is one map", () => {
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).not.toContain("const TONE");
    expect(src).not.toContain("capitalize(ad.verdict.verdict)");
    expect(src).not.toContain("capitalize(a.verdict.verdict)");
    expect(src).toContain("label={verdictLabel(ad.verdict.verdict)}");
    expect(src).toContain("label={verdictLabel(a.verdict.verdict)}");
    expect(src).toContain("verdictChips(p.verdicts)");
  });
});

describe("the funnel's hints", () => {
  test("Fit is the setters' ROAS tags, never the old stage rule", () => {
    expect(FIT_HINT).toBe(
      "The share of leads the setters tagged roas-qualified, out of qualified plus unqualified.",
    );
    expect(LEADS_HINT).toContain(
      "Fit is the share of leads the setters tagged roas-qualified, out of qualified plus unqualified.",
    );
    const src = read("src/pages/ceo/AdsTab.tsx");
    // The ribbon's Fit fact and the table's Fit column both carry it.
    expect(src).toContain(
      '{ label: "Fit", v: w.qualifiedPct, f: pct, hint: FIT_HINT }',
    );
    expect(src).toContain("title: FIT_HINT,");
    for (const s of [FIT_HINT, LEADS_HINT, src])
      expect(s).not.toContain("demo booked, confirmed, closed or hot lead");
  });

  test("intros and confirmed intros count each lead once, and say so (the CEO, 2026-10-18)", () => {
    expect(LEAD_TO_INTRO_HINT).toContain("a rebooked intro counts once");
    expect(INTROS_HINT).toContain(
      "Each lead counts once however often the intro was rebooked",
    );
    expect(INTROS_HINT).toContain("went straight to a demo, is not an intro");
    // An intro marked invalid was held: B2B's show rule counts it, so it is an intro (never a confirmed one).
    expect(INTROS_HINT).toContain(
      "An intro marked invalid was held, so it counts.",
    );
    expect(INTROS_HINT).not.toContain("cancelled or marked invalid");
    expect(CONFIRMED_INTROS_HINT).toContain(
      "showed, or is still marked confirmed after its time",
    );
    expect(CONFIRMED_INTROS_HINT).toContain(
      "No-shows, cancelled and invalid are left out",
    );
    const html = text(
      renderToStaticMarkup(
        createElement(Fact, { label: "Intros", hint: INTROS_HINT }, "9"),
      ),
    );
    expect(html).toContain(`aria-label="Intros: ${INTROS_HINT}"`);
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).toContain("hint: LEAD_TO_INTRO_HINT,");
    expect(src).toContain("hint: INTROS_HINT,");
    expect(src).toContain("hint: CONFIRMED_INTROS_HINT,");
    expect(src).toContain('label: "Confirmed intros",');
    expect(src).toContain('label="Cost per confirmed intro"');
  });

  test("the setter and closer lines say their own days and rule on the screen, not only in a hover title", () => {
    const visible = (html: string) => text(html).replace(/<[^>]+>/g, "");
    const people = {
      setter: { name: "Setter One", shown: 5, due: 6 },
      closer: { name: "Closer Two", closes: 2 },
    };
    const html = renderToStaticMarkup(
      createElement(People, { p: people, windows: WINDOWS }),
    );
    // "Intros 3 · Confirmed 2" sits above it in the seven-day view: the line itself says why it reads more.
    expect(visible(html)).toContain(
      "Setter Setter One: 5 of 6 leads shown · 30 days, every intro booked",
    );
    expect(visible(html)).toContain("Closer Closer Two: 2 signed · 30 days");
    // The hints open on a tap on a phone (Fact's button), and give the dates and the B2B show rule.
    expect(text(html)).toContain(`aria-label="Setter: ${setterHint(WINDOWS)}"`);
    expect(text(html)).toContain(`aria-label="Closer: ${closerHint(WINDOWS)}"`);
    expect(setterHint(WINDOWS)).toContain("from 17 Sep to 16 Oct");
    expect(setterHint(WINDOWS)).toContain(
      "so it can differ from Intros and Confirmed",
    );
    expect(setterHint(WINDOWS)).toContain(
      "showed, or confirmed or invalid once its time passed (the B2B show rule)",
    );
    expect(closerHint(WINDOWS)).toContain("so it can differ from Signed");
    expect(html).not.toContain("title=");
    // A custom range reads the people over its own days, and says so.
    const custom = {
      from7: "2026-10-03",
      from30: "2026-10-03",
      to: "2026-10-16",
    };
    expect(peopleDays(WINDOWS)).toBe(30);
    expect(peopleDays(custom)).toBe(14);
    expect(
      visible(
        renderToStaticMarkup(
          createElement(People, {
            p: { setter: null, closer: people.closer },
            windows: custom,
          }),
        ),
      ),
    ).toBe("Closer Closer Two: 2 signed · 14 days");
    expect(
      renderToStaticMarkup(
        createElement(People, {
          p: { setter: null, closer: null },
          windows: WINDOWS,
        }),
      ),
    ).toBe("");
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).toContain(
      "<People p={ad.people} windows={r.payload.windows} />",
    );
    expect(src).toContain(
      "<People p={c.people} windows={r.payload.windows} />",
    );
    expect(src).not.toContain("function People(");
  });

  test("no demo is left on the Ads tab: ribbon, table, tiles, verdicts or constraint", () => {
    const src = read("src/pages/ceo/AdsTab.tsx");
    for (const gone of [
      "demosBooked",
      "demosShown",
      "demoShowRate",
      "costPerDemo",
      "introToDemo",
      "closeRate",
      '"Demos booked"',
      '"Demos shown"',
      '"$/demo"',
      '"Close rate"',
      "Intros booked",
      "introsBooked",
      "introsShown",
      "costPerIntroShown",
    ])
      expect(src).not.toContain(gone);
    // Old payloads can still carry the retired constraint stages; the screen leaves them out.
    expect(src).toContain("!RETIRED_STAGES.has(c.constraint.stage)");
    expect(RETIRED_STAGES.has("intros shown to demos booked")).toBe(true);
    expect(RETIRED_STAGES.has("demos shown to closes")).toBe(true);
    expect(src).toContain('"intros to confirmed intros": "confirmed",');
    expect(src).toContain('"leads to intros": "intros",');
    expect(TONE["intros do not confirm"]).toBe("serious");
  });

  test("a payload stored before 2026-10-18 shows the intro figures as n/a until the refresh, never 0", () => {
    const old = {
      spend: 100,
      leads: 6,
      leadsToIntro: 4,
      bookRate: 0.6667,
    } as B2bAdWindow;
    const o = introFigures(old);
    expect(o).toMatchObject({
      known: false,
      intros: null,
      confirmed: null,
      leadToIntro: null,
      costPerIntro: null,
      costPerConfirmed: null,
      confirmedShare: null,
      na: NA_REFRESH,
    });
    const html = text(
      renderToStaticMarkup(
        createElement(Num, { v: o.intros, f: String, na: o.na }),
      ),
    );
    expect(html).toContain("n/a");
    expect(html).toContain(NA_REFRESH);
    expect(html).not.toContain(">0<");

    const fresh = {
      spend: 621.39,
      leads: 14,
      leadsToIntro: 9,
      leadsToConfirmedIntro: 2,
      bookRate: 0.6429,
      costPerIntro: 69.04,
      costPerConfirmedIntro: 310.69,
      confirmedIntroRate: 0.2222,
    } as B2bAdWindow;
    expect(introFigures(fresh)).toMatchObject({
      known: true,
      intros: 9,
      confirmed: 2,
      costPerIntro: 69.04,
      costPerConfirmed: 310.69,
      confirmedShare: 0.2222,
      na: NA_ZERO,
    });
    // No leads: zero intros is a count, and the costs are n/a for nothing to divide by.
    const empty = introFigures({
      spend: 0,
      leads: 0,
      leadsToIntro: 0,
      leadsToConfirmedIntro: 0,
      bookRate: null,
      costPerIntro: null,
      costPerConfirmedIntro: null,
      confirmedIntroRate: null,
    } as B2bAdWindow);
    expect(empty).toMatchObject({
      intros: 0,
      confirmed: 0,
      costPerIntro: null,
      na: NA_ZERO,
    });
  });

  test("the constraint says the days it is worked out on", () => {
    const c = { stage: "intros to confirmed intros", mine: 0.25, account: 0.4 };
    expect(constraintText(c, WINDOWS)).toBe(
      "Over thirty days, intros to confirmed intros runs at 25% against 40% across the account.",
    );
    // A custom range judges the chosen days.
    expect(
      constraintText(c, {
        ...WINDOWS,
        from7: "2026-10-01",
        from30: "2026-10-01",
      }),
    ).toBe(
      "Over the chosen days, intros to confirmed intros runs at 25% against 40% across the account.",
    );
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).toContain("constraintText(c.constraint, r.payload.windows)");
    // The label before 2026-10-18 still outlines the intros cell.
    expect(src).toContain('"leads to intros booked": "intros",');
  });

  test("the coverage line says carry an ad from this account, and whose ad a deal is", () => {
    expect(
      coverageLine({
        leads: 20,
        adLeads: 14,
        closes: 4,
        adCloses: 2,
        contracted: 24000,
        adContracted: 12000,
      }),
    ).toBe(
      "14 of 20 leads and 2 of 4 signed deals carry an ad from this account",
    );
    expect(COVERAGE_HINT).toContain("paused ads included");
    expect(COVERAGE_HINT).toContain(
      "Calls and deals are credited to the ad on the contact's lead record when it is one of this account's ads and was already running when the call was booked or the deal signed; otherwise they keep the ad on the call or deal.",
    );
    expect(COVERAGE_HINT).not.toContain(
      "which can differ from the ad on the lead",
    );
    expect(read("src/pages/ceo/AdsTab.tsx")).toContain(
      "<span title={COVERAGE_HINT}>",
    );
  });

  test("every hint is plain", () => {
    for (const s of [
      FIT_HINT,
      LEADS_HINT,
      LEAD_TO_INTRO_HINT,
      INTROS_HINT,
      CONFIRMED_INTROS_HINT,
      NA_REFRESH,
      COVERAGE_HINT,
      setterHint(WINDOWS),
      closerHint(WINDOWS),
      WINNERS_HEADING,
      winnersPrompt("lead_gen"),
      noWinnersText("lead_gen"),
    ])
      plain(s);
  });
});

// ---- the Launch card ---------------------------------------------------------

const w30 = (o: Partial<B2bAdWindow>) =>
  ({
    spend: 0,
    leads: 0,
    leadsToIntro: 0,
    leadsToConfirmedIntro: 0,
    closes: 0,
    ...o,
  }) as B2bAdWindow;

const ad = (
  id: string,
  o: Partial<B2bAdWindow>,
  verdict: B2bVerdict["verdict"] = "hold",
): B2bAdNode =>
  ({
    id,
    name: id,
    status: "ACTIVE",
    running: true,
    thumbnail: null,
    w7: w30({}),
    w30: w30(o),
    verdict: { verdict, reason: "", owner: "ads" },
    people: { setter: null, closer: null },
  }) as B2bAdNode;

function payload(type: string, ads: B2bAdNode[]): B2bAdsPayload {
  return {
    campaigns: [
      {
        id: `c-${type}`,
        name: type,
        type,
        adsets: [{ id: `s-${type}`, name: "set", ads }],
      },
    ],
  } as unknown as B2bAdsPayload;
}

describe("the Launch card's list", () => {
  test("only ads with results in thirty days and no kill verdict, ranked on confirmed intros, never demos", () => {
    const p = payload("lead_gen", [
      ad("spent only", { spend: 22.8 }),
      ad("lead", { spend: 40, leads: 3 }),
      ad("killed", { spend: 90, leads: 2 }, "kill"),
      // Demos shown no longer rank an ad: only its leads do.
      ad("demo", { spend: 10, leads: 1, demosShown: 4 }),
      ad("intros", { spend: 30, leads: 2, leadsToIntro: 2 }),
      ad("confirmed", {
        spend: 30,
        leads: 2,
        leadsToIntro: 1,
        leadsToConfirmedIntro: 1,
      }),
      ad("close", { spend: 0, closes: 1 }, "off"),
    ]);
    const list = launchWinners(p, "lead_gen");
    expect(list.map(a => a.id)).toEqual([
      "close",
      "confirmed",
      "intros",
      "lead",
      "demo",
    ]);
    for (const a of list) {
      expect(a.w30.leads + a.w30.closes).toBeGreaterThan(0);
      expect(a.verdict.verdict).not.toBe("kill");
    }
    expect(hasResults(ad("x", { spend: 500 }))).toBe(false);
    expect(hasResults(ad("x", { spend: 50, demosShown: 2 }))).toBe(false);
  });

  test("never mixes kinds and stops at eight", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ad(`a${i}`, { leads: i + 1 }),
    );
    expect(launchWinners(payload("lead_gen", many), "lead_gen")).toHaveLength(
      8,
    );
    expect(launchWinners(payload("lead_gen", many), "retargeting")).toEqual([]);
    expect(launchWinners(null, "lead_gen")).toEqual([]);
  });

  test("each ad says its leads, intros, confirmed intros and closes, and leaves intros out of an older payload", () => {
    expect(
      resultsLine(
        ad("a", {
          leads: 9,
          leadsToIntro: 5,
          leadsToConfirmedIntro: 2,
          closes: 1,
        }),
      ),
    ).toBe("9 leads · 5 intros · 2 confirmed · 1 close");
    const old = ad("b", { leads: 3, closes: 0 });
    delete (old.w30 as Partial<B2bAdWindow>).leadsToConfirmedIntro;
    expect(resultsLine(old)).toBe("3 leads · 0 closes");
    expect(resultsLine(old)).not.toContain("intro");
    const src = read("src/pages/ceo/LaunchCard.tsx");
    expect(src).toContain("{resultsLine(a)}");
    expect(src).not.toContain("demosShown");
    expect(src).not.toContain('"demo")');
  });

  test("the heading and the empty state", () => {
    expect(WINNERS_HEADING).toBe("Results in the last 30 days");
    expect(winnersPrompt("retargeting")).toBe(
      "Tick the retargeting ads whose creatives the draft should reuse.",
    );
    const empty = noWinnersText("lead_gen");
    expect(empty).toContain(
      "No lead-gen ad has a lead or a close in the last 30 days",
    );
    expect(empty).not.toContain("demo");
    // It says what to do next.
    expect(empty).toContain("Build the draft anyway");
    const src = read("src/pages/ceo/LaunchCard.tsx");
    expect(src).toContain("launchWinners(ads, kind)");
    expect(src).toContain("{WINNERS_HEADING}");
    expect(src).toContain("{noWinnersText(kind)}");
    expect(src).not.toContain(".filter(a => a.w30.spend > 0)");
    expect(src).not.toContain("winners`}");
  });
});

// ---- the Marketing tab's reach and frequency card -------------------------

describe("the reach and frequency card counts campaigns that delivered", () => {
  test("reads the delivered count, beside the totals", () => {
    // The Edge Function sends the delivered count as campaigns, every one as listed.
    expect(deliveredCampaigns({ campaigns: 4, listed: 10 })).toBe(4);
    expect(deliveredCampaigns({})).toBe(0);
    expect(deliveredLine({ campaigns: 4, listed: 10 })).toBe(
      "4 of 10 campaigns delivered",
    );
    expect(deliveredLine({ campaigns: 1 })).toBe("1 campaign delivered");
    expect(deliveredLine({ campaigns: 0, listed: 2 })).toBe(
      "0 of 2 campaigns delivered",
    );
    const fn = read("../../supabase/functions/cockpit-ceo-api/frequency.ts");
    expect(fn).toContain("listed: ids.length");
    const src = read("src/pages/ceo/MarketingTab.tsx");
    expect(src).toContain("sub={figure ? deliveredLine(figure) : undefined}");
    expect(src).not.toContain('plural(figure.campaigns ?? 0, "campaign")');
  });
});

describe("SOURCES.md says the new rules", () => {
  test("rows for every changed definition", () => {
    const md = read("src/pages/ceo/SOURCES.md");
    for (const s of [
      "**Which ads are on the tab**",
      "**Per ad: intros and confirmed intros**",
      "**Coverage line**",
      "**Campaign constraint**",
      "**Launch card: results in the last 30 days**",
      '"not judged"',
      "the setters tagged `roas-qualified`, out of qualified plus unqualified",
      "the campaigns that delivered (impressions above 0)",
      "credited to the ad on the contact's lead",
      "had already delivered by the day the call was booked or the deal signed",
      "otherwise the ad on the call or deal row itself",
    ])
      expect(md).toContain(s);
  });
});

describe("small display fixes after the live check (2026-10-16)", () => {
  const src = (f: string) =>
    readFileSync(join(import.meta.dir, "..", "src/pages/ceo", f), "utf8");
  test("the Launch card says 1 close, not 1 closes", () => {
    expect(src("launchWinners.ts")).toContain('plural(w.closes, "close")');
    expect(src("LaunchCard.tsx")).not.toContain("w30.closes} closes");
  });
  test("ROAS rounds half up: 19.45 reads 19.5x", () => {
    expect(src("AdsTab.tsx")).toContain("(Math.round(v * 10) / 10).toFixed(1)");
    expect((Math.round(19.45 * 10) / 10).toFixed(1)).toBe("19.5");
  });
});
