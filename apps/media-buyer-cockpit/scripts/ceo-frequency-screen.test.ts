/**
 * The CEO, 2026-10-16: the Ads tab's frequency did not match Ads Manager
 * (the short-form retargeting campaign read 1.86 here against Meta's 8.42 for
 * 10 to 16 Oct). The worker now reads Meta's own frequency per level for the
 * window; these tests hold the screen to showing it the way Ads Manager does
 * (two decimals) with a hint that names the days and Meta's time zone, and
 * that names no dates on an older payload without `metaUntil`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Fact,
  frequency,
  frequencyFact,
  frequencyHint,
  Num,
} from "../src/pages/ceo/adsFacts";
import type { B2bAdsPayload, B2bAdWindow } from "../src/types/ceo/payloads";

const APP = join(import.meta.dir, "..");

const WINDOWS: B2bAdsPayload["windows"] = {
  from7: "2026-10-10",
  from30: "2026-09-17",
  to: "2026-10-16",
  metaUntil: "2026-10-16",
  metaTimeZone: "America/Los_Angeles",
};

/** Only the field the frequency fact reads; the rest of a window is not involved. */
const win = (frequency: number | null) => ({ frequency }) as B2bAdWindow;

/** The ribbon's own markup for a list of facts: a Fact per fact, its value through Num. */
function render(w: B2bAdWindow, hint: string): string {
  return renderToStaticMarkup(
    createElement(
      "span",
      null,
      ...frequencyFact(w, hint).map(f =>
        createElement(
          Fact,
          { key: f.label, label: f.label, hint: f.hint },
          createElement(Num, { v: f.v, f: f.f }),
        ),
      ),
    ),
  );
}

/** The text a screen reader and the static markup carry, with entities read back. */
const text = (html: string) =>
  html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

describe("frequency on the Ads tab", () => {
  test("shows two decimals, as Ads Manager does", () => {
    expect(frequency(8.42)).toBe("8.42");
    expect(frequency(2)).toBe("2.00");
    expect(frequency(10.834)).toBe("10.83");
    const html = render(win(8.42), frequencyHint(WINDOWS, "w7"));
    expect(html).toContain(">Freq</button>");
    expect(html).toContain("8.42");
    expect(html).not.toContain(">8.4<");
  });

  test("the hint names the window's days and Meta's time zone", () => {
    const seven = frequencyHint(WINDOWS, "w7");
    expect(seven).toBe(
      "Meta's own frequency for 10 to 16 Oct (Meta's days, Los Angeles): impressions divided by people reached. Ads Manager shows the same number for those dates.",
    );
    expect(frequencyHint(WINDOWS, "w30")).toContain(
      "for 17 Sep to 16 Oct (Meta's days, Los Angeles)",
    );
    // Before Meta's day starts, the figures stop at Meta's today, and the hint says so.
    expect(
      frequencyHint({ ...WINDOWS, metaUntil: "2026-10-15" }, "w7"),
    ).toContain("for 10 to 15 Oct");
    // The hint rides the label, where a tap opens it on a touch screen.
    const html = text(render(win(8.42), seven));
    expect(html).toContain(`aria-label="Freq: ${seven}"`);
    expect(html).toContain("no-touch");
    expect(seven).not.toContain("—");
  });

  test("the account row's hint says it matches the lead-gen campaigns, not the whole account", () => {
    // Ads Manager's account total also counts retargeting (2.39 against 2.03 on 16 Oct).
    expect(frequencyHint(WINDOWS, "w7", "lead gen")).toBe(
      "Meta's own frequency for 10 to 16 Oct (Meta's days, Los Angeles): impressions divided by people reached. Ads Manager shows the same number for the lead-gen campaigns for those dates.",
    );
  });

  test("an older payload without metaUntil gets a hint with no dates", () => {
    const old: B2bAdsPayload["windows"] = {
      from7: "2026-10-10",
      from30: "2026-09-17",
      to: "2026-10-16",
    };
    const hint = frequencyHint(old, "w7");
    expect(hint).toBe(
      "Meta's own frequency: impressions divided by people reached. Ads Manager shows the same number for the window.",
    );
    expect(hint).not.toMatch(/Oct|Sep|Meta's days/);
    expect(text(render(win(1.32), hint))).toContain(
      `aria-label="Freq: ${hint}"`,
    );
  });

  test("no frequency from Meta means no Freq fact, never a zero", () => {
    expect(frequencyFact(win(null), "x")).toEqual([]);
    expect(render(win(null), "x")).not.toContain("Freq");
  });

  test("the funnel ribbon uses this fact and passes the window's hint", () => {
    const src = readFileSync(join(APP, "src/pages/ceo/AdsTab.tsx"), "utf8");
    expect(src).toContain("...frequencyFact(w, freqHint),");
    expect(src).toContain("<Fact key={f.label} label={f.label} hint={f.hint}>");
    expect(src).toContain("freqHint={frequencyHint(r.payload.windows, r.win)}");
    // The account row is lead gen only, and its hint says so.
    expect(src).toContain('freqHint={frequencyHint(p.windows, win, "lead gen")}');
    expect(src).not.toContain("(n: number) => n.toFixed(1)");
  });
});
