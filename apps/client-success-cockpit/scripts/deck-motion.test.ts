/**
 * The arrivals (docs/csm-decks/DESIGN.md 22.14.5): each slide builds once
 * on entry and holds still. Pinned here from present.css: nothing loops,
 * the build tokens are long enough to read on a Zoom share, the drift is
 * once, slow, transform only and on example pictures alone, every
 * animation that uses them runs on the motion switch (`--dk-m`, so still=1
 * and reduced motion show the end state), and O2's hero goal still fits
 * the content when it stands larger.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
  join(import.meta.dir, "../src/present/present.css"),
  "utf8",
);
/** The same without its comments, for reading selectors. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A custom property's value on .dk-root, as written. */
function token(name: string): string {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css);
  if (!m) throw new Error(`${name} is not defined`);
  return m[1].trim();
}
const ms = (v: string) =>
  v.endsWith("ms") ? Number.parseFloat(v) : Number.parseFloat(v) * 1000;

describe("the arrivals (DESIGN 22.14.5)", () => {
  test("nothing loops while the presenter talks", () => {
    expect(css).not.toMatch(/\binfinite\b/);
    expect(css).not.toMatch(/animation-iteration-count:\s*(?!1\b)/);
  });

  test("the build's tokens read on a share: arrivals of half a second and more", () => {
    expect(ms(token("--dk-t-arrive"))).toBeGreaterThanOrEqual(500);
    expect(ms(token("--dk-t-sweep"))).toBeGreaterThanOrEqual(800);
    expect(token("--dk-rise-far")).toBe("64px");
    // A beat between parts, never so long the slide waits on its build.
    expect(ms(token("--dk-t-step"))).toBeLessThanOrEqual(160);
  });

  test("the drift: 1.00 to 1.04 over several seconds, transform only, example pictures only", () => {
    expect(token("--dk-drift-scale")).toBe("1.04");
    expect(ms(token("--dk-t-drift"))).toBeGreaterThanOrEqual(6000);
    const frames =
      /@keyframes dk-drift\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(frames).toContain("transform");
    expect(frames).not.toMatch(/opacity|filter|width|height|top|left/);
    // Every rule that runs it is an example picture's.
    const uses = [
      ...bare.matchAll(/([^{}]+)\{[^{}]*\bdk-drift\s+calc[^{}]*\}/g),
    ];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, selector] of uses)
      for (const s of selector.split(","))
        expect(s.trim()).toMatch(/img\[data-example\]$/);
  });

  test("every animation that uses the 22.14 tokens runs on the motion switch", () => {
    const decls = [
      ...css.matchAll(
        /(?:animation|transition)\s*:([^;]*--dk-t-(?:arrive|sweep|drift|line|step)[^;]*);/g,
      ),
    ];
    expect(decls.length).toBeGreaterThan(20);
    for (const [, d] of decls)
      for (const part of d.split(/,(?![^(]*\))/))
        if (/--dk-t-(?:arrive|sweep|drift)/.test(part))
          expect({
            part: part.trim(),
            switch: part.includes("var(--dk-m)"),
          }).toEqual({
            part: part.trim(),
            switch: true,
          });
  });

  test("O2's goal as the hero fits the content: 1400 px at --dk-hero-scale inside 1648", () => {
    const scale = Number.parseFloat(token("--dk-hero-scale"));
    expect(scale).toBeGreaterThan(1);
    // Grown from the hung mark 80 px out: the words' far end lands at
    // 56 + (1536 - 56) x scale, inside the 1784 px content edge.
    expect(56 + (1536 - 56) * scale).toBeLessThanOrEqual(1784);
    expect(css).toMatch(
      /\.dkc-goal-stage:is\(\[data-lift\], \[data-alone\]\) \.dkc-goal-block \{\s*transform: scale\(var\(--dk-hero-scale\)\);/,
    );
  });

  /** A rule's declarations, by its exact selector, comments dropped. */
  const rule = (selector: string) => {
    const at = bare.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return bare.slice(at, bare.indexOf("}", at));
  };

  test("O2's goal hangs and grows from its own direction's mark, in either deck, so the mark's outer edge stays put between stops", () => {
    // The mark hangs 14 px outside the words' start, about 66 px wide: its
    // outer edge is 80 px out, the edge the hero grows from.
    expect(bare).toMatch(
      /\.dkc-goal-text::before \{[^}]*inset-inline-end: calc\(100% \+ 14px\)/,
    );
    const rtl = rule('.dkc-goal-stage .dkc-goal-block[dir="rtl"]');
    expect(rtl).toContain("margin-left: auto");
    expect(rtl).toContain("transform-origin: calc(100% + 80px) 100%");
    const ltr = rule('.dkc-goal-stage .dkc-goal-block[dir="ltr"]');
    expect(ltr).toContain("margin-right: auto");
    expect(ltr).toContain("transform-origin: -80px 100%");
    // The deck's direction no longer decides either (the old rule moved an
    // English goal in the Arabic deck about 230 px between stops).
    expect(bare).not.toMatch(/\[dir="rtl"\] \.dkc-goal-stage \.dkc-goal-block/);
    expect(bare).not.toMatch(/\[dir="rtl"\] \.dkc-goal-text \{/);
    // Arabic words take the Arabic metrics in either deck, balanced.
    const ar = rule('.dkc-goal-text[dir="rtl"]');
    expect(ar).toContain("font-size: 76px");
    expect(ar).toContain("line-height: 1.45");
    expect(ar).toContain("text-wrap: balance");
  });

  test("O2's answers wait for the goal to settle: invisible while the stage moves over them (fixer round 2)", () => {
    // The row's rise starts at 0.8 of the stage's settle, after the goal
    // and its 90 days have passed the answers' labels; until then the
    // rise's first frame (opacity 0, filled backwards) holds.
    const delay = rule(
      ":is(.dkc-goal-stage, .dkc-goal-asking) + .dkc-goal-row",
    );
    expect(delay).toContain(
      "animation-delay: calc(var(--dk-t-stage) * 0.8 * var(--dk-m))",
    );
    const start = 0.8 * ms(token("--dk-t-stage"));
    // At the settle's midpoint (where round 2 saw "Today" over "In 12 to
    // 24 months") the answers have not begun.
    expect(start).toBeGreaterThan(ms(token("--dk-t-stage")) / 2);
    const rise =
      /@keyframes dk-rise \{\s*from \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rise).toContain("opacity: 0");
    expect(bare).toMatch(
      /\.dkc-goal-row \{[^}]*animation: dk-rise [^;]* both;/,
    );
    // One short group holds low with the goal: the same distance for both,
    // the row by the individual translate so its rise still runs.
    expect(rule(".dkc-goal-stage[data-hold]")).toContain(
      "transform: translateY(var(--dk-hold))",
    );
    expect(rule(".dkc-goal-stage + .dkc-goal-row[data-hold]")).toContain(
      "translate: 0 var(--dk-hold)",
    );
    expect(ms(token("--dk-hold"))).toBeLessThanOrEqual(ms(token("--dk-lift")));
  });

  test("O7's stops overlap their fades, so the canvas is never blank between them", () => {
    const out = rule('.dk-swap[data-mode="seq"] > .dk-swap-out[data-swap]');
    const inn = rule(
      '.dk-swap[data-mode="seq"] > [data-swap="in"][data-after]',
    );
    expect(out).toContain("calc(var(--dk-t-stage) * 0.5 * var(--dk-m))");
    // The incoming one starts halfway through the exit, never after it.
    expect(inn).toMatch(
      /dkc-swap calc\(var\(--dk-t-stage\) \* 0\.75 \* var\(--dk-m\)\) var\(--dk-ease\) calc\(var\(--dk-t-stage\) \* 0\.375 \* var\(--dk-m\)\)/,
    );
    // Opacity only: neither is legible over the other.
    for (const k of ["dkc-swap", "dk-swap-out"]) {
      const frames =
        new RegExp(`@keyframes ${k}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ??
        "";
      expect(frames).toContain("opacity");
      expect(frames).not.toContain("transform");
    }
  });

  test("a media play mark never mirrors in Arabic", () => {
    expect(bare).not.toMatch(
      /\[dir="rtl"\][^{}]*(?:setup-play|guide-pic) svg \{[^}]*scaleX\(-1\)/,
    );
  });
});

/**
 * The Brand Blueprint call (docs/brand-blueprint/SPEC.md 5.4, 5.5): the
 * studio wall, tamed. Every build runs once on entry on the motion switch,
 * ends within 1.5 s by its tokens, nothing loops; the felt stays at 4 %,
 * and none of the untamed wall's tells come back (no client face, no pin
 * holes).
 */
describe("the Brand Blueprint's wall (section 24)", () => {
  const block = css.slice(css.indexOf("24 · The Brand Blueprint call"));
  const bareBlock = block.replace(/\/\*[\s\S]*?\*\//g, "");

  test("every animation and transition runs on the motion switch", () => {
    const decls = [
      ...bareBlock.matchAll(/(?:animation|transition)(?:-delay)?\s*:([^;]*);/g),
    ].filter(([, d]) => !/^\s*none\s*$/.test(d));
    expect(decls.length).toBeGreaterThan(10);
    for (const [, d] of decls)
      expect({ d: d.trim(), m: d.includes("var(--dk-m)") }).toEqual({
        d: d.trim(),
        m: true,
      });
  });

  test("every entrance ends within 1.5 s, by the tokens", () => {
    const t = (n: string) => {
      const v = token(n);
      return v === "var(--dk-t-arrive)" ? ms(token("--dk-t-arrive")) : ms(v);
    };
    // The ordinary arrivals: the first piece lands at once, the last has
    // settled by about 900 ms (score round 2 of the design pass: the wall
    // stood empty for 150 ms after a press, and slide 11 took 1.3 s); the
    // signature beats below keep their own, longer timings.
    expect(t("--dkb-t-lead")).toBe(0);
    const last =
      t("--dkb-t-lead") + Number(token("--dkb-i-max")) * t("--dkb-t-step");
    expect(last + t("--dkb-t-pin")).toBeLessThanOrEqual(900);
    expect(last + t("--dkb-t-tape-at") + t("--dkb-t-tape")).toBeLessThanOrEqual(
      900,
    );
    expect(last + t("--dkb-t-hint-at") + t("--dkb-t-tape")).toBeLessThanOrEqual(
      900,
    );
    expect(
      t("--dkb-t-lead") + 4 * t("--dkb-t-fan-step") + t("--dkb-t-fan"),
    ).toBeLessThanOrEqual(1500);
    expect(t("--dkb-t-string-at") + t("--dkb-t-string")).toBeLessThanOrEqual(
      1500,
    );
    expect(t("--dkb-t-stamp")).toBeLessThanOrEqual(300);
    // Slide 4's park (four strips leave, 70 ms apart; the tag's lines land),
    // slide 6's flight into the wall map, the read-back growing out of it
    // (three frames, a step apart): each done within 1.5 s (score round 1).
    expect(4 * t("--dkb-t-fan-step") + t("--dkb-t-park")).toBeLessThanOrEqual(
      1500,
    );
    expect(
      t("--dkb-t-park-at") + 3 * t("--dkb-t-fan-step") + t("--dkb-t-tape"),
    ).toBeLessThanOrEqual(1500);
    expect(t("--dkb-t-fly")).toBeLessThanOrEqual(1500);
    expect(2 * t("--dk-t-step") + t("--dkb-t-assemble")).toBeLessThanOrEqual(
      1500,
    );
  });

  test("the felt is at most 4 %, the tilt capped at 1 degree, the stamp only when fired", () => {
    // The data URI holds a ";", so the line is read whole.
    const felt = /^\s*--dkb-felt:(.*)$/m.exec(css)?.[1] ?? "";
    const alphas = [...felt.matchAll(/0 0 0 \.?(\d*\.?\d+) 0'/g)].map(m =>
      Number.parseFloat(m[1].startsWith(".") ? `0${m[1]}` : `0.${m[1]}`),
    );
    expect(alphas.length).toBe(2);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.04);
    expect(token("--dkb-tilt-max")).toBe("1deg");
    // The stamp's motion belongs to a fresh press only.
    expect(bareBlock).toMatch(
      /\.dkb-stamp\[data-fresh\] \{\s*animation: dkb-stamp/,
    );
    expect(bareBlock).not.toMatch(/\.dkb-stamp \{[^}]*animation/);
  });

  test("live paper is straight and swings in straight", () => {
    expect(bareBlock).toMatch(
      /\.dkb-pin\[data-live\],\s*\[data-live\] \.dkb-pin \{\s*--r: 0deg;\s*--dkb-swing: 0deg;/,
    );
  });

  test("no client face, no pin holes, nothing that loops", () => {
    expect(css).not.toMatch(/Marcellus/);
    expect(bareBlock).not.toMatch(/\.dkb-hole|#holes|\binfinite\b/);
  });
});
