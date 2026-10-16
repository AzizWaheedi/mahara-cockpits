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
  COVERAGE_HINT,
  constraintText,
  coverageLine,
  DEMOS_BOOKED_HINT,
  DEMOS_SHOWN_HINT,
  Fact,
  FIT_HINT,
  INTRO_TO_DEMO_HINT,
  INTROS_SHOWN_HINT,
  LEAD_TO_INTRO_HINT,
  LEADS_HINT,
  TONE,
  verdictChips,
  verdictLabel,
} from "../src/pages/ceo/adsFacts";
import {
  hasResults,
  launchWinners,
  noWinnersText,
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

  test("Lead to intro is per lead, and intro to demo names its formula", () => {
    expect(LEAD_TO_INTRO_HINT).toContain("over those leads");
    expect(LEAD_TO_INTRO_HINT).toContain("a rebooked intro counts once");
    expect(INTRO_TO_DEMO_HINT).toBe(
      "Intros shown that went on to a demo booked for the same contact, over intros shown.",
    );
    expect(DEMOS_BOOKED_HINT).toContain(
      "Intro to demo is intros shown that went on to a demo booked for the same contact, over intros shown.",
    );
    const html = text(
      renderToStaticMarkup(
        createElement(
          Fact,
          { label: "Intro to demo", hint: INTRO_TO_DEMO_HINT },
          "0%",
        ),
      ),
    );
    expect(html).toContain(`aria-label="Intro to demo: ${INTRO_TO_DEMO_HINT}"`);
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).toContain("hint: LEAD_TO_INTRO_HINT,");
    expect(src).toContain("hint: INTRO_TO_DEMO_HINT,");
  });

  test("shown counts confirmed, showed or invalid, the B2B rule", () => {
    expect(INTROS_SHOWN_HINT).toContain(
      "Confirmed, showed or invalid counts as shown",
    );
    expect(DEMOS_SHOWN_HINT).toContain(
      "Confirmed, showed or invalid counts as shown",
    );
  });

  test("the constraint says the days it is worked out on", () => {
    const c = { stage: "demos shown to closes", mine: 0.25, account: 0.4 };
    expect(constraintText(c, WINDOWS)).toBe(
      "Over thirty days, demos shown to closes runs at 25% against 40% across the account.",
    );
    // A custom range judges the chosen days.
    expect(
      constraintText(c, {
        ...WINDOWS,
        from7: "2026-10-01",
        from30: "2026-10-01",
      }),
    ).toBe(
      "Over the chosen days, demos shown to closes runs at 25% against 40% across the account.",
    );
    const src = read("src/pages/ceo/AdsTab.tsx");
    expect(src).toContain("constraintText(c.constraint, r.payload.windows)");
    // The worker's renamed stage still outlines the shown cell.
    expect(src).toContain('"intros due to shown": "shown",');
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
      "Calls and deals are credited to the ad on the call or deal record, which can differ from the ad on the lead.",
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
      INTRO_TO_DEMO_HINT,
      DEMOS_BOOKED_HINT,
      INTROS_SHOWN_HINT,
      DEMOS_SHOWN_HINT,
      COVERAGE_HINT,
      WINNERS_HEADING,
      winnersPrompt("lead_gen"),
      noWinnersText("lead_gen"),
    ])
      plain(s);
  });
});

// ---- the Launch card ---------------------------------------------------------

const w30 = (o: Partial<B2bAdWindow>) =>
  ({ spend: 0, leads: 0, demosShown: 0, closes: 0, ...o }) as B2bAdWindow;

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
  test("only ads with results in thirty days and no kill verdict", () => {
    const p = payload("lead_gen", [
      ad("spent only", { spend: 22.8 }),
      ad("lead", { spend: 40, leads: 3 }),
      ad("killed", { spend: 90, leads: 2 }, "kill"),
      ad("demo", { spend: 10, demosShown: 1 }),
      ad("close", { spend: 0, closes: 1 }, "off"),
    ]);
    const list = launchWinners(p, "lead_gen");
    expect(list.map(a => a.id)).toEqual(["close", "demo", "lead"]);
    for (const a of list) {
      expect(a.w30.leads + a.w30.demosShown + a.w30.closes).toBeGreaterThan(0);
      expect(a.verdict.verdict).not.toBe("kill");
    }
    expect(hasResults(ad("x", { spend: 500 }))).toBe(false);
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

  test("the heading and the empty state", () => {
    expect(WINNERS_HEADING).toBe("Results in the last 30 days");
    expect(winnersPrompt("retargeting")).toBe(
      "Tick the retargeting ads whose creatives the draft should reuse.",
    );
    const empty = noWinnersText("lead_gen");
    expect(empty).toContain(
      "No lead-gen ad has a lead, a demo shown or a close in the last 30 days",
    );
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
      "**Lead to intro, lead to demo**",
      "**Intro to demo**",
      "**Coverage line**",
      "**Campaign constraint**",
      "**Launch card: results in the last 30 days**",
      '"not judged"',
      "the setters tagged `roas-qualified`, out of qualified plus unqualified",
      "the campaigns that delivered (impressions above 0)",
      "credited to the ad on the call or deal row",
    ])
      expect(md).toContain(s);
  });
});

describe("small display fixes after the live check (2026-10-16)", () => {
  const src = (f: string) => readFileSync(join(import.meta.dir, "..", "src/pages/ceo", f), "utf8");
  test("the Launch card says 1 close, not 1 closes", () => {
    expect(src("LaunchCard.tsx")).toContain('plural(a.w30.closes, "close")');
    expect(src("LaunchCard.tsx")).not.toContain("${a.w30.closes} closes");
  });
  test("ROAS rounds half up: 19.45 reads 19.5x", () => {
    expect(src("AdsTab.tsx")).toContain("(Math.round(v * 10) / 10).toFixed(1)");
    expect((Math.round(19.45 * 10) / 10).toFixed(1)).toBe("19.5");
  });
});
