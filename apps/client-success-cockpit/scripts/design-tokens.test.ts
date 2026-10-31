import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtLink, LINK_INK } from "../src/components/kit";
import { buttonVariants } from "../src/components/ui/button";
import { PANEL_INK } from "../src/forms/CheckinFields";

/**
 * The CEO's design follow-ups (docs/forms/STAGE2B-CONTRACT.md 4.14 and 5.5,
 * O1): the focus ring is the ink teal on the light page, 2px set 2px off;
 * outside links use one measured mix; overlays stop animating under
 * reduced motion. The contrast is computed from index.css itself (oklch and
 * hex to sRGB, WCAG relative luminance), so a token change that breaks a
 * ratio fails here.
 *
 * Run: bun test scripts/design-tokens.test.ts
 */

const app = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(app, p), "utf8");
const css = read("src/index.css");

// ------------------------------------------------------------ the tokens

/** The custom properties of the first top-level block with this selector. */
function block(selector: string): Record<string, string> {
  const at = css.search(
    new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"),
  );
  if (at < 0) throw Error(`no ${selector} block`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    out[m[1]] = m[2].trim();
  return out;
}
const ROOT = block(":root");
const DARK = { ...ROOT, ...block(".dark") };

/** A value with its var() references resolved against a theme. */
function token(theme: Record<string, string>, name: string): string {
  let v = theme[name];
  if (v === undefined) throw Error(`no ${name}`);
  for (let i = 0; i < 8 && /var\(--/.test(v); i++)
    v = v.replace(/var\((--[\w-]+)\)/g, (_, n) => theme[n] ?? "");
  return v;
}

// ------------------------------------------------------------ colour maths

type RGB = [number, number, number];
type RGBA = { rgb: RGB; a: number };

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const clamp = (c: number) => Math.min(1, Math.max(0, c));

function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map(clamp) as RGB;
}

function rgbToOklab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** #rrggbb, oklch(L C h [/ a%]) or color-mix(in oklab|oklch, x p%, y|transparent). */
function parse(raw: string): RGBA {
  const v = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(v);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return {
      rgb: [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255],
      a: 1,
    };
  }
  const ok =
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%)?\s*\)$/.exec(
      v,
    );
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), Number(ok[3])];
    const rad = (h * Math.PI) / 180;
    return {
      rgb: oklabToRgb([L, C * Math.cos(rad), C * Math.sin(rad)]),
      a: ok[4] === undefined ? 1 : Number(ok[4]) / 100,
    };
  }
  const mix =
    /^color-mix\(in (oklab|oklch),\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const p = Number(mix[3]) / 100;
    const x = parse(mix[2]);
    // Mixed with transparent: the colour itself, at p alpha.
    if (mix[4].trim() === "transparent") return { rgb: x.rgb, a: x.a * p };
    const y = parse(mix[4]);
    const [la, lb] = [rgbToOklab(x.rgb), rgbToOklab(y.rgb)];
    return {
      rgb: oklabToRgb(la.map((c, i) => c * p + lb[i] * (1 - p)) as RGB),
      a: 1,
    };
  }
  throw Error(`cannot read the colour ${raw}`);
}

/** A colour laid on a surface, composited in sRGB as the browser does. */
const over = (top: RGBA, under: RGB): RGB =>
  top.rgb.map((c, i) => c * top.a + under[i] * (1 - top.a)) as RGB;

const luminance = (rgb: RGB) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Every surface a ring or a link sits on, opaque, per theme. */
function surfaces(theme: Record<string, string>): Record<string, RGB> {
  const page = parse(token(theme, "--background")).rgb;
  const card = parse(token(theme, "--card")).rgb;
  const muted = parse(token(theme, "--muted"));
  const accent = parse(token(theme, "--accent"));
  const muted40 = { rgb: muted.rgb, a: muted.a * 0.4 };
  return {
    page,
    card,
    "muted on card": over(muted, card),
    "muted on page": over(muted, page),
    "muted/40 on card": over(muted40, card),
    "muted/40 on page": over(muted40, page),
    "accent (hover) on card": over(accent, card),
    "accent (hover) on page": over(accent, page),
  };
}

/** LINK_INK's colour as index.css resolves it in a theme. */
const linkInk = (theme: Record<string, string>) => {
  const mix = /color:(color-mix\(.+\))\]$/.exec(LINK_INK)?.[1];
  if (!mix) throw Error("LINK_INK is not a colour-mix class");
  const v = mix
    .replace(/_/g, " ")
    .replace(/var\((--[\w-]+)\)/g, (_, n) => token(theme, n));
  return parse(v).rgb;
};

const THEMES = { light: ROOT, dark: DARK } as const;

// ------------------------------------------------------------ tests

describe("O1a: the focus ring", () => {
  test("--ring is the ink teal on the light page and Mahara Teal on dark", () => {
    expect(ROOT["--ring"]).toBe("var(--primary-ink)");
    expect(ROOT["--sidebar-ring"]).toBe("var(--primary-ink)");
    expect(token(ROOT, "--ring").toLowerCase()).toBe("#00807b");
    expect(token(DARK, "--ring").toLowerCase()).toBe("#00cfc8");
    expect(token(DARK, "--sidebar-ring").toLowerCase()).toBe("#00cfc8");
    // .dark keeps its own --primary-ink, which is teal.
    expect(block(".dark")["--primary-ink"]).toBe("var(--mahara-teal)");
  });

  test("the base outline is the full ring, and one zero-specificity rule draws 2px set 2px off", () => {
    expect(css).not.toContain("outline-ring/50");
    expect(css).toContain("@apply border-border outline-ring;");
    const rule = css.replace(/\s+/g, " ");
    expect(rule).toContain(
      ':where(a[href], button, summary, [role="button"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }',
    );
  });

  test("buttonVariants draws a 2px ring set 2px off on the page colour, never 1px", () => {
    for (const variant of [
      "default",
      "outline",
      "ghost",
      "secondary",
      "destructive",
      "link",
    ] as const) {
      const c = buttonVariants({ variant }).split(/\s+/);
      for (const cls of [
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
        "focus-visible:ring-offset-2",
        "focus-visible:ring-offset-background",
      ])
        expect([variant, c.includes(cls)]).toEqual([variant, true]);
      expect(c).not.toContain("focus-visible:ring-1");
    }
  });

  test("the ring holds 3:1 or more on every named surface in both themes", () => {
    // Teal on the light page measured 1.87:1: why the ring moved.
    const page = surfaces(ROOT).page;
    expect(contrast(parse("#00cfc8").rgb, page)).toBeLessThan(2);
    for (const [name, theme] of Object.entries(THEMES)) {
      const ring = parse(token(theme, "--ring")).rgb;
      for (const [where, rgb] of Object.entries(surfaces(theme))) {
        const r = Math.round(contrast(ring, rgb) * 100) / 100;
        expect([name, where, r >= 3]).toEqual([name, where, true]);
      }
    }
    // The contract's measured values, to a hundredth's tolerance.
    const ink = parse("#00807b").rgb;
    expect(contrast(ink, surfaces(ROOT).page)).toBeCloseTo(4.6, 1);
    expect(contrast(ink, surfaces(ROOT).card)).toBeCloseTo(4.8, 1);
    expect(contrast(ink, parse(token(ROOT, "--accent")).rgb)).toBeCloseTo(
      4.18,
      1,
    );
  });
});

describe("what the 2b screens' first look found (2026-10-30)", () => {
  test("the warning callout's words are 4.5:1 or more on its own tint, on the page and on a card, in both themes", () => {
    const rule = /\.callout-warn \{([^}]+)\}/.exec(css)?.[1] ?? "";
    const value = (prop: string, theme: Record<string, string>) => {
      const raw = new RegExp(`(?:^|\\s)${prop}:\\s*([^;]+);`).exec(rule)?.[1];
      if (!raw) throw Error(`.callout-warn has no ${prop}`);
      return raw.replace(/var\((--[\w-]+)\)/g, (_, n) => token(theme, n));
    };
    // --warning is Tailwind's orange, which index.css does not hold.
    const ORANGE = {
      "--color-orange-500": "oklch(0.705 0.213 47.604)",
      "--color-orange-400": "oklch(0.75 0.183 55.934)",
    };
    for (const [name, base] of Object.entries(THEMES)) {
      const theme = { ...base, ...ORANGE };
      const tint = parse(value("background-color", theme));
      const ink = parse(value("color", theme)).rgb;
      for (const where of ["page", "card"] as const) {
        const r = contrast(ink, over(tint, surfaces(theme)[where]));
        expect([name, where, r >= 4.5]).toEqual([name, where, true]);
      }
    }
  });

  test("a sheet's close control is a 40 px target around its icon; a full-width sheet has no overlay left to tap", () => {
    expect(read("src/components/ui/sheet.tsx")).toContain(
      "before:absolute before:-inset-3",
    );
  });

  test("the recap's state line takes focus with its ring off the first letter", () => {
    expect(read("src/forms/RecapApproval.tsx")).toContain(
      "-mx-1.5 flex gap-2 rounded-sm px-1.5 text-sm outline-none",
    );
  });
});

describe("O1b: outside links", () => {
  test("LINK_INK is the ink teal mixed 90% with the text colour, and PANEL_INK is the same string", () => {
    expect(LINK_INK).toBe(
      "text-[color:color-mix(in_oklab,var(--primary-ink)_90%,var(--foreground))]",
    );
    expect(PANEL_INK).toBe(LINK_INK);
  });

  test("LINK_INK holds 4.5:1 or more on page, card, muted, muted/40 and accent in both themes", () => {
    let lowest = Number.POSITIVE_INFINITY;
    for (const [name, theme] of Object.entries(THEMES)) {
      const ink = linkInk(theme);
      for (const [where, rgb] of Object.entries(surfaces(theme))) {
        const r = contrast(ink, rgb);
        lowest = Math.min(lowest, r);
        expect([name, where, r >= 4.5]).toEqual([name, where, true]);
      }
    }
    expect(lowest).toBeGreaterThanOrEqual(4.8);
    // Why not plain --primary-ink: it falls under 4.5 on accent in light.
    expect(
      contrast(parse("#00807b").rgb, parse(token(ROOT, "--accent")).rgb),
    ).toBeLessThan(4.5);
  });

  test("ExtLink draws LINK_INK with a rounded focus box by default", () => {
    const html = renderToStaticMarkup(
      createElement(ExtLink, { href: "https://example.com" }, "Open"),
    );
    expect(html).toContain(LINK_INK);
    expect(html).toContain("rounded-sm");
    expect(html).not.toMatch(/class="[^"]*\btext-primary\b(?!-)/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  test("a caller's text-primary-ink replaces LINK_INK, so no caller passes it", () => {
    // Why the scan below exists: cn() keeps the last text colour.
    const html = renderToStaticMarkup(
      createElement(
        ExtLink,
        { href: "https://example.com", className: "text-primary-ink" },
        "Open",
      ),
    );
    expect(html).not.toContain(LINK_INK);
    const source = resolve(app, "src");
    const files = readdirSync(source, { recursive: true, encoding: "utf8" })
      .filter(f => f.endsWith(".tsx"))
      .map(f => resolve(source, f));
    const drops =
      /<ExtLink\b[^>]*?className=(?:"[^"]*text-primary-ink|\{[^}]*\bINK\b)/g;
    const found = files
      .filter(f => readFileSync(f, "utf8").match(drops))
      .map(f => relative(app, f))
      .sort();
    // Outside the files 2b may change; it moves on its owner's next pass.
    // Nothing else may join it.
    const later = ["src/forms/FormPanel.tsx"];
    expect(found.filter(f => !later.includes(f))).toEqual([]);
  });
});

describe("O1c: reduced motion", () => {
  test("every overlay stops animating under reduced motion", () => {
    const has = (file: string, needle: string, times = 1) => {
      const s = read(file);
      expect([file, needle, s.split(needle).length - 1]).toEqual([
        file,
        needle,
        times,
      ]);
    };
    has("src/components/ui/popover.tsx", "motion-reduce:animate-none!");
    // The overlay and the sheet's own base.
    has("src/components/ui/sheet.tsx", "motion-reduce:animate-none!", 2);
    has("src/components/ui/sheet.tsx", "motion-reduce:transition-none");
    // Content and SubContent.
    has(
      "src/components/ui/dropdown-menu.tsx",
      "motion-reduce:animate-none!",
      2,
    );
    has("src/components/ui/tooltip.tsx", "motion-reduce:animate-none!");
    // Its overlay and its content, in the one place both are built, so the
    // Move confirm needs no class of its own.
    has("src/components/ui/alert-dialog.tsx", "motion-reduce:animate-none!", 2);
    has("src/forms/CheckinCall.tsx", "motion-reduce:animate-none!", 0);
  });
});

describe("O1d: docs/DESIGN.md", () => {
  test("the three bullets follow the Controls rule, word for word", () => {
    const md = readFileSync(resolve(app, "../../docs/DESIGN.md"), "utf8");
    for (const line of [
      "- Required radio pills in a form (the 1-1 notes window's DEFCON and Priority) depart from the filter pill on purpose: the chosen pill carries a Check icon, semibold text and a 2px inset --primary-ink ring on bg-primary/15 (4.6:1 on the light page); an unchosen one a 1px inset --border ring; focus is a separate 2px ring set 2px outside the pill, so a focused pill never reads as chosen. Filters and tabs keep the rule above.",
      "- Focus: every control shows a 2px --ring ring set 2px off it on the page colour. --ring is the ink teal #00807B on the light page and Mahara Teal on dark, 3:1 or more on every surface; never a 1px teal ring. Client success follows this now; the other cockpits move to it on their next pass.",
      "- External links (ExtLink) are the ink teal mixed 90% with the text colour, 4.5:1 or more on cards, panels and hover in both themes. Overlays (popover, sheet, menus, tooltips) do not animate under reduced motion.",
    ])
      expect(md).toContain(line);
    const controls = md.indexOf("## Controls");
    expect(controls).toBeGreaterThan(-1);
    expect(md.indexOf("- Required radio pills")).toBeGreaterThan(controls);
    expect(md.indexOf("- Required radio pills")).toBeLessThan(
      md.indexOf("- Buttons: ui/button"),
    );
  });
});
