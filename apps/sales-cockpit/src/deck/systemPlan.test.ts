import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PILLARS, SYSTEM, stepLabel } from "./content";
import { deckSlides } from "./slides";
import {
  ADS,
  ALERT,
  type Box,
  bottomAt,
  CLOSING,
  DATA,
  DATA_LABEL_OPEN,
  DATA_LENS,
  DROP_PATH,
  FILTER,
  HOLE,
  LABELS,
  LEAD_COUNT,
  LEAD_WAYS,
  LENSES,
  LOOP_SAY,
  planLeads,
  restBox,
  SALES,
  type Screen,
  SIGNED_PATH,
  SPOUT_END,
  STILL_COUNT,
  STILL_LEADS,
  screenStyle,
  systemCss,
  topAt,
} from "./systemPlan";

/**
 * The five-step slide's drawing (system.tsx): its screens sit inside the
 * funnel, its names over the wall, its crops inside their screenshots, its
 * leads inside their cycle, and nothing on it reads as a rate (results are
 * never promised).
 */

/** A WebP's pixel size, read from its header (VP8, VP8L or VP8X). */
function webpSize(path: string): { w: number; h: number } {
  const b = new Uint8Array(readFileSync(new URL(path, import.meta.url)));
  const tag = (o: number, n: number) =>
    String.fromCharCode(...b.subarray(o, o + n));
  const chunk = tag(12, 4);
  if (chunk === "VP8X")
    return {
      w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  if (chunk === "VP8 ")
    return {
      w: (b[26] | (b[27] << 8)) & 0x3fff,
      h: (b[28] | (b[29] << 8)) & 0x3fff,
    };
  const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
  return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >>> 14) & 0x3fff) };
}

/**
 * Clear of both walls by a margin at the box's two sides (the walls are
 * straight or convex between).
 */
const inFunnel = (b: Box, margin = -0.5) =>
  [b.x, b.x + b.w].every(
    x => b.y >= topAt(x) + margin && b.y + b.h <= bottomAt(x) - margin,
  );

/** A screen's overview footprint, its tilt included. */
function footprint(sc: Screen): Box {
  const b = restBox(sc);
  const r = ((sc.rest.rot ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const hw = (b.w / 2) * cos + (b.h / 2) * sin;
  const hh = (b.w / 2) * sin + (b.h / 2) * cos;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh };
}

/** How far a point is from a box (0 inside it). */
const away = (x: number, y: number, b: Box) =>
  Math.hypot(
    Math.max(b.x - x, 0, x - (b.x + b.w)),
    Math.max(b.y - y, 0, y - (b.y + b.h)),
  );

/** A screen's box on the canvas, worked out from the style the slide gives it. */
function placed(style: ReturnType<typeof screenStyle>, rtl: boolean): Box {
  const left = rtl
    ? 1920 - style.insetInlineStart - style.width
    : style.insetInlineStart;
  const m = style.transform.match(
    /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/,
  );
  const [tx, ty, s] = m ? [m[1], m[2], m[3]].map(Number) : [0, 0, 1];
  // Scaled about its origin: the left corner, or the right one.
  const ox = style.transformOrigin.startsWith("100%") ? style.width : 0;
  return {
    x: left + ox + tx - s * ox,
    y: style.top + ty,
    w: style.width * s,
    h: style.height * s,
  };
}

const IN_FUNNEL: [string, Screen][] = [
  ...ADS.map((a): [string, Screen] => [`ad ${a.key}`, a.screen]),
  ["landing page", FILTER],
  ["alert", SALES],
  ["call", CLOSING],
];
const SCREENS: [string, Screen][] = [...IN_FUNNEL, ["portal", DATA]];

describe("the funnel's screens", () => {
  test("every open screen sits inside the funnel's walls", () => {
    for (const [name, s] of IN_FUNNEL)
      expect({ name, inside: inFunnel(s.open) }).toEqual({
        name,
        inside: true,
      });
  });

  test("the alert and the call open clear of both walls, the call inside the spout", () => {
    // The phones' boxes may meet a wall at a corner their rounded frames cut.
    expect(inFunnel(SALES.open, 6)).toBe(true);
    expect(inFunnel(CLOSING.open, 6)).toBe(true);
    expect(CLOSING.open.x + CLOSING.open.w).toBeLessThanOrEqual(SPOUT_END);
  });

  test("on the overview too, but for the fanned ads, whose tilt the box ignores", () => {
    for (const [name, s] of IN_FUNNEL.filter(([, s]) => !s.rest.rot))
      expect({ name, inside: inFunnel(restBox(s)) }).toEqual({
        name,
        inside: true,
      });
  });

  test("the portal is where the funnel pours, at the spout's end", () => {
    expect(restBox(DATA).x).toBeGreaterThanOrEqual(1428);
    expect(DATA.open.x + DATA.open.w).toBeLessThanOrEqual(1784);
  });

  test("in Arabic each screen sits where the English one does, mirrored", () => {
    for (const [name, sc] of SCREENS) {
      const en = placed(screenStyle(sc, false, false), false);
      const ar = placed(screenStyle(sc, false, true), true);
      const rest = restBox(sc);
      for (const [a, b] of [
        [en.x, rest.x],
        [en.y, rest.y],
        [en.w, rest.w],
        [ar.x, 1920 - en.x - en.w],
        [ar.y, en.y],
        [ar.w, en.w],
        [ar.h, en.h],
      ])
        expect(Math.abs(a - b) < 1e-6 ? name : `${name}: ${a} ≠ ${b}`).toBe(
          name,
        );
      const open = placed(screenStyle(sc, true, true), true);
      expect(open.x).toBeCloseTo(1920 - sc.open.x - sc.open.w, 6);
    }
  });

  test("the lenses under the funnel stay clear of its floor and of the loop's words", () => {
    const under = [LENSES.sales!, LENSES.closing!, DATA_LENS.en, DATA_LENS.ar];
    for (const { box: b } of under) {
      expect(b.y).toBeGreaterThan(bottomAt(b.x));
      expect(b.y + b.h).toBeLessThan(LOOP_SAY.y - 18);
      expect(b.x).toBeGreaterThanOrEqual(136);
      expect(b.x + b.w).toBeLessThanOrEqual(1784);
    }
    expect(inFunnel(LENSES.filter!.box)).toBe(true);
  });

  test("the portal's lens sits beside the grown portal, clear of the time-wasters' way down", () => {
    for (const { box: b } of [DATA_LENS.en, DATA_LENS.ar]) {
      expect(b.x + b.w).toBeLessThanOrEqual(DATA.open.x - 24);
      expect(b.x).toBeGreaterThan(Math.max(...DROP_PATH.map(p => p[0])) + 24);
    }
  });
});

describe("the step names", () => {
  // Half each name's widest line (English or Arabic) and its match ring:
  // the wall is highest under a name's upstream end.
  const HALF = { ads: 68, filter: 65, sales: 103, closing: 106, data: 62 };

  test("each sits over the wall with room for its match ring", () => {
    for (const p of PILLARS) {
      const { x, y } = LABELS[p.key];
      expect({ key: p.key, room: topAt(x - HALF[p.key]) - y >= 13 }).toEqual({
        key: p.key,
        room: true,
      });
    }
  });

  test("the portal's name, and its ring, stay over the portal, small or grown", () => {
    expect(LABELS.data.y + 6).toBeLessThan(DATA.rest.y);
    expect(DATA_LABEL_OPEN.y + 6).toBeLessThan(DATA.open.y);
  });
});

describe("the crops", () => {
  const cuts = [
    ["./assets/proof/jr-slack.webp", ALERT],
    ["./assets/proof/jr-form-3.webp", LENSES.filter!],
    ["./assets/proof/jr-booked.webp", LENSES.sales!],
    ["./assets/proof/pcm-lesson.webp", LENSES.closing!],
    ["./assets/portal-results-en.webp", DATA_LENS.en],
    ["./assets/portal-results-ar.webp", DATA_LENS.ar],
  ] as const;

  test("each names its screenshot's real size, so a replaced picture fails here", () => {
    for (const [path, cut] of cuts) expect(webpSize(path)).toEqual(cut.img);
  });

  test("each crop lies inside its screenshot", () => {
    for (const [, { img, crop }] of cuts) {
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.w).toBeLessThanOrEqual(img.w);
      expect(crop.y + crop.h).toBeLessThanOrEqual(img.h);
    }
  });

  test("the booking stops at the timeline: no name, phone, email or address", () => {
    // jr-booked: the project details start just below 470, the name row at 668.
    const { crop } = LENSES.sales!;
    expect(crop.y).toBeGreaterThanOrEqual(150);
    expect(crop.y + crop.h).toBeLessThanOrEqual(470);
  });

  test("the alert stops before the lead's name", () => {
    // jr-slack: "Name Of Lead" starts at 170.
    expect(ALERT.crop.y + ALERT.crop.h).toBeLessThanOrEqual(166);
  });

  test("the objections start below the course's misspelt first title", () => {
    // pcm-lesson: that title ends at 926, "05: Closing Deposits" starts at 1150.
    const { crop } = LENSES.closing!;
    expect(crop.y).toBeGreaterThan(926);
    expect(crop.y + crop.h).toBeLessThan(1150);
  });
});

describe("the leads", () => {
  const plan = planLeads();
  const signed = LEAD_WAYS.filter(w => w === "signed").length;
  const blocks = (frames: string) =>
    [...frames.matchAll(/%\{([^{}]*)\}/g)].map(m =>
      m[1]
        .split(";")
        .map(d => d.split(":")[0])
        .sort()
        .join(" "),
    );

  test("every lead's run ends inside its cycle", () => {
    expect(plan.last).toBeLessThanOrEqual(100);
    const offsets = [...systemCss().matchAll(/([\d.]+)%[{,]/g)].map(m =>
      Number(m[1]),
    );
    expect(offsets.length).toBeGreaterThan(100);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(100);
  });

  test("they move only what runs off the main thread, named in every frame", () => {
    const leads = plan.frames.filter(f => f.includes("dk-sys-lead-"));
    const glows = plan.frames.filter(f => f.includes("dk-sys-glow-"));
    expect(leads.length).toBe(LEAD_COUNT);
    expect(glows.length).toBe(signed);
    for (const f of leads)
      for (const b of blocks(f))
        expect(b).toBe("background-color opacity transform");
    for (const f of glows) for (const b of blocks(f)) expect(b).toBe("opacity");
    expect(systemCss()).not.toMatch(/box-shadow|background:/);
  });

  test("the time-wasters leave through the gap in the floor", () => {
    let crossed = 0;
    for (let i = 1; i < DROP_PATH.length; i++) {
      const [x0, y0] = DROP_PATH[i - 1];
      const [x1, y1] = DROP_PATH[i];
      if ((y0 - bottomAt(x0)) * (y1 - bottomAt(x1)) <= 0) {
        crossed++;
        expect(x0).toBeGreaterThanOrEqual(HOLE.from);
        expect(x1).toBeLessThanOrEqual(HOLE.to);
      }
    }
    expect(crossed).toBe(1);
  });

  test("a signed lead pours into the portal", () => {
    const [x, y] = SIGNED_PATH[SIGNED_PATH.length - 1];
    const portal = restBox(DATA);
    expect(x).toBeGreaterThanOrEqual(portal.x);
    expect(y).toBeGreaterThan(portal.y);
    expect(y).toBeLessThan(portal.y + portal.h);
  });

  test("the portal's rings light once per signed lead, each inside the cycle", () => {
    for (const marks of [plan.arrivals, plan.arrivalsOpen]) {
      expect(marks.length).toBe(signed);
      for (const f of marks) {
        expect(f * 100 - 0.4).toBeGreaterThanOrEqual(0);
        expect(f * 100 + 5).toBeLessThanOrEqual(99.9);
      }
    }
  });

  test("the still frame holds every lead, and fewer go on at each step", () => {
    expect(STILL_COUNT).toBe(LEAD_COUNT);
    const n = (w: string) => LEAD_WAYS.filter(x => x === w).length;
    expect(n("drop")).toBeGreaterThan(n("sales"));
    expect(n("sales")).toBeGreaterThan(n("closing"));
    expect(n("closing")).toBeGreaterThan(n("signed"));
  });

  test("no lead in the still is cut by a screen, and none waits signed in sight", () => {
    const screens = SCREENS.map(([name, sc]) => [name, footprint(sc)] as const);
    for (const [x, y, s, o] of STILL_LEADS) {
      if (o === 0) continue;
      expect(s).toBeLessThanOrEqual(1);
      for (const [name, b] of screens)
        expect({ name, x, y, clear: away(x, y, b) >= 8 * s }).toEqual({
          name,
          x,
          y,
          clear: true,
        });
      // In the mouth, inside the walls.
      if (x < HOLE.from) {
        expect(y - 8).toBeGreaterThan(topAt(x));
        expect(y + 8).toBeLessThan(bottomAt(x));
      }
    }
  });
});

describe("the slide", () => {
  const slide = deckSlides().find(s => s.id === "system");

  test("walks the overview and then each of the five steps, with the funnel for its rail", () => {
    expect(slide?.stops).toBe(PILLARS.length + 1);
    expect(slide?.noRail).toBe(true);
    expect(slide?.railAll).toBeUndefined();
  });

  test("its own words keep the copy rules", () => {
    for (const l of Object.values(SYSTEM)) {
      for (const s of [l.en, l.ar]) expect(s).not.toMatch(/[—–]/);
      expect(l.ar).not.toMatch(/[0-9]/);
      expect(l.ar).not.toMatch(/(^|[^٠-٩])٠[٠-٩]/);
      expect(l.en).not.toMatch(/contractor/i);
    }
    // The one figure on the drawing is the approved five minutes.
    const figures = Object.values(SYSTEM).flatMap(l =>
      `${l.en} ${l.ar}`.match(/[0-9٠-٩]+/g),
    );
    expect(figures.filter(Boolean)).toEqual(["5", "٥"]);
  });

  test("a stop's label never sets a dot beside an Arabic digit (٥ · would read as ٥ ٠)", () => {
    for (const p of PILLARS) {
      expect(stepLabel(p.key, "ar")).not.toMatch(/[٠-٩]\s*[·.]/);
      expect(stepLabel(p.key, "en")).toContain(" · ");
    }
  });
});
