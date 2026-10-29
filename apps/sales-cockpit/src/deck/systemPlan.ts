/**
 * The drawing on the five-step slide (system.tsx; the CEO, 2026-10-27: "show
 * them this is the client journey and a bit of a preview of each ... show
 * the funnel and then how we scale it"). One funnel the leads pour through:
 * each step's real screen sits inside it, the time-wasters leave through a
 * gap in its floor after the filter, and a loop runs from the portal back to
 * the ads. Every number is a canvas pixel on the 1920 × 1080 slide, written
 * left to right; the slide mirrors them for Arabic.
 */

import type { Lang, PillarKey } from "./content";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a screen sits on the overview: its corner, and its size against the open one. */
export interface Rest {
  x: number;
  y: number;
  /** The overview size over the open size. */
  s: number;
  /** Degrees, for the fanned ads. */
  rot?: number;
}

export interface Screen {
  /** Its box when its step is open. */
  open: Box;
  rest: Rest;
}

/** A crop of a real screenshot, drawn at a box's inner width. */
export interface Cut {
  /** The screenshot's own size. */
  img: { w: number; h: number };
  /** The part shown, in the screenshot's pixels. */
  crop: Box;
}

// ------------------------------------------------------------ the funnel

/** The funnel's middle line: the walls mirror about it. */
export const AXIS = 604;
/** The top wall, mouth to spout: one cubic, then straight to the portal. */
const TOP: [number, number][] = [
  [190, 324],
  [430, 354],
  [840, 494],
  [1110, 504],
];
export const SPOUT_END = 1430;
const mirror = (y: number) => 2 * AXIS - y;
const BOTTOM = TOP.map(([x, y]): [number, number] => [x, mirror(y)]);

const cubic = (p: [number, number][], t: number, i: 0 | 1) =>
  (1 - t) ** 3 * p[0][i] +
  3 * (1 - t) ** 2 * t * p[1][i] +
  3 * (1 - t) * t ** 2 * p[2][i] +
  t ** 3 * p[3][i];

/** The top wall's height at x (its x grows with t, so halving finds it). */
export function topAt(x: number): number {
  if (x >= TOP[3][0]) return TOP[3][1];
  if (x <= TOP[0][0]) return TOP[0][1];
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (cubic(TOP, mid, 0) < x) lo = mid;
    else hi = mid;
  }
  return cubic(TOP, (lo + hi) / 2, 1);
}
export const bottomAt = (x: number) => mirror(topAt(x));

const wall = (p: [number, number][]) =>
  `M${p[0].join(",")} C${p[1].join(",")} ${p[2].join(",")} ${p[3].join(",")} L${SPOUT_END},${p[3][1]}`;
export const WALL_TOP = wall(TOP);
export const WALL_BOTTOM = wall(BOTTOM);
export const BODY = `${WALL_TOP} L${SPOUT_END},${BOTTOM[3][1]} L${BOTTOM[3].join(",")} C${BOTTOM[2].join(",")} ${BOTTOM[1].join(",")} ${BOTTOM[0].join(",")} Z`;
/** Where the gradient runs: the mouth to the spout's end. */
export const GRAD = { from: TOP[0][0], to: SPOUT_END };

/** The gap in the floor right after the filter, where the time-wasters leave. */
export const HOLE = { from: 736, to: 782 };
/** The dashed way down from the gap. */
export const DROP = "M759,772 L763,890";
/** The note beside the gap. */
export const NOTE_OUT = { x: 802, y: 774 };

/** The loop: from under the portal, below the funnel, back into its mouth. */
export const LOOP =
  "M1606,732 V899 Q1606,939 1566,939 H190 Q150,939 150,899 V644 Q150,604 190,604 H198";
export const LOOP_HEAD = "M185,590 L199,604 L185,618";
/** The loop's words sit on its long side, centred here. */
export const LOOP_SAY = { x: 878, y: 939 };

/** The 5 minutes, drawn as an architect's dimension from the filter to the sales team. */
export const SPAN = { from: 646, to: 956, y: 340 };

/**
 * Each step's name sits over the funnel's top wall, centred on its screen.
 * y is the name's bottom edge, so the taller Arabic line grows upward and
 * never onto the wall.
 */
export const LABELS: Record<PillarKey, { x: number; y: number }> = {
  ads: { x: 364, y: 328 },
  filter: { x: 646, y: 394 },
  sales: { x: 956, y: 456 },
  closing: { x: 1262, y: 488 },
  data: { x: 1606, y: 466 },
};
/** The portal grows on the last stop, and its name rises with it. */
export const DATA_LABEL_OPEN = { x: 1514, y: 404 };

// ------------------------------------------------------------ the screens

/**
 * The three ads at the mouth: fanned on the overview, side by side and
 * narrowing with the funnel when the ads step is open. Front first in the
 * fan's order of drawing is last, so the owner on camera stays on top.
 */
export const ADS: { key: "kitchen" | "reno" | "owner"; screen: Screen }[] = [
  {
    key: "kitchen",
    screen: {
      open: { x: 414, y: 450, w: 180, h: 308 },
      rest: { x: 214, y: 464, s: 176 / 180, rot: -6 },
    },
  },
  {
    key: "reno",
    screen: {
      open: { x: 608, y: 468, w: 160, h: 272 },
      rest: { x: 338, y: 464, s: 176 / 160, rot: 6 },
    },
  },
  {
    key: "owner",
    screen: {
      open: { x: 200, y: 432, w: 200, h: 343 },
      rest: { x: 276, y: 452, s: 176 / 200 },
    },
  },
];

/** The partner's landing page on a phone. */
export const FILTER: Screen = {
  open: { x: 568, y: 446, w: 156, h: 319 },
  rest: { x: 578, y: 466, s: 136 / 156 },
};

/** The new-lead alert, cut to its first four lines (jr-slack). */
export const ALERT: Cut = {
  img: { w: 1600, h: 555 },
  crop: { x: 0, y: 0, w: 600, h: 160 },
};
export const SALES: Screen = {
  open: { x: 716, y: 540, w: 480, h: 128 },
  rest: { x: 770, y: 555, s: 366 / 480 },
};

/** A consultant call with a partner (pcm-call), clear of both walls and inside the spout. */
export const CLOSING: Screen = {
  open: { x: 1088, y: 514, w: 336, h: 181 },
  rest: { x: 1150, y: 544, s: 224 / 336 },
};

/** The portal, its results screen, in a browser frame. */
export const PORTAL_BAR = 30;
export const DATA: Screen = {
  open: { x: 1244, y: 419, w: 540, h: 371 },
  rest: { x: 1428, y: 482, s: 356 / 540 },
};

/** A lens: a second screen a step brings in when it is open, cut so its words read. */
export interface Lens extends Cut {
  /** The frame, padding included. */
  box: Box;
}
export const LENS_PAD = 10;
const lens = (cut: Cut, x: number, y: number, w: number): Lens => ({
  ...cut,
  box: {
    x,
    y,
    w,
    h: ((w - 2 * LENS_PAD) * cut.crop.h) / cut.crop.w + 2 * LENS_PAD,
  },
});

export const LENSES: Partial<Record<PillarKey, Lens>> = {
  // The budget question on the partner's form (jr-form-3), inside the funnel.
  filter: lens(
    { img: { w: 923, h: 2000 }, crop: { x: 40, y: 630, w: 843, h: 160 } },
    748,
    547,
    520,
  ),
  // The booking as it reaches the partner (jr-booked), from its first line to
  // the timeline: no name, phone, email or project address.
  sales: lens(
    { img: { w: 1143, h: 1708 }, crop: { x: 160, y: 190, w: 983, h: 278 } },
    930,
    746,
    500,
  ),
  // The course drawn large (pcm-course, the top of its lesson page): the
  // academy, its lessons and a video lesson. It sits over the funnel, in the
  // corner the header leaves free, clear of the step names under it.
  closing: lens(
    { img: { w: 1444, h: 770 }, crop: { x: 0, y: 0, w: 1444, h: 770 } },
    1224,
    104,
    560,
  ),
};

/**
 * The closing step's second lens: a partner's signed contract (pcm-contract,
 * the client's details blurred), beside the call, past the spout's end where
 * a signed lead pours out. The portal under it has stepped back by then.
 */
export const CONTRACT: Lens = lens(
  { img: { w: 1600, h: 913 }, crop: { x: 0, y: 0, w: 1600, h: 913 } },
  1444,
  503,
  340,
);

/**
 * The portal's lens: the "Projects won" tile of its results screen, the
 * figure the tour says to judge us on. The Arabic screen is laid out the
 * other way round, so each language has its own cut of the same tile.
 */
const RESULTS_IMG = { w: 2384, h: 1504 };
export const DATA_LENS: Record<Lang, Lens> = {
  en: lens(
    { img: RESULTS_IMG, crop: { x: 1764, y: 364, w: 420, h: 146 } },
    880,
    754,
    340,
  ),
  ar: lens(
    { img: RESULTS_IMG, crop: { x: 201, y: 322, w: 420, h: 146 } },
    880,
    754,
    340,
  ),
};

/** The lens a step brings in, in the language on screen. */
export function lensFor(key: PillarKey, lang: Lang): Lens | undefined {
  return key === "data" ? DATA_LENS[lang] : LENSES[key];
}

/** A screen's place on the overview, as a move from its open box. */
export function restMove(screen: Screen, flip: 1 | -1): string {
  const { open, rest } = screen;
  return `translate(${(rest.x - open.x) * flip}px, ${rest.y - open.y}px) scale(${rest.s})`;
}

/**
 * A screen's style: laid out at its open size, so it is drawn from full size
 * and stays sharp, and moved to its overview place from its starting corner
 * (the left in English, the right in Arabic).
 */
export function screenStyle(screen: Screen, open: boolean, rtl: boolean) {
  return {
    insetInlineStart: screen.open.x,
    top: screen.open.y,
    width: screen.open.w,
    height: screen.open.h,
    transform: open ? "none" : restMove(screen, rtl ? -1 : 1),
    transformOrigin: rtl ? "100% 0" : "0 0",
  };
}

/** A box's overview footprint (for the checks: the screens stay in the funnel). */
export function restBox(screen: Screen): Box {
  return {
    x: screen.rest.x,
    y: screen.rest.y,
    w: screen.open.w * screen.rest.s,
    h: screen.open.h * screen.rest.s,
  };
}

// ------------------------------------------------------------ the leads

/**
 * The leads, moving left to right at one slow pace: many come in at the
 * mouth, over, under and behind the ads; behind the filter some drop out
 * through the floor, some go on to the sales team or to closing, and now and
 * then one comes out signed and slows into the portal. The stream is
 * irregular on purpose: it shows the shape of the journey, never a rate.
 */
type State = "w" | "t" | "s" | "f" | "x";
type Pt = [number, number, State?, number?];
type Way = "drop" | "sales" | "closing" | "signed";

export const CYCLE = 18;
const SPEED = 82;

const IN: Record<"t1" | "t2" | "b1" | "b2" | "m1" | "m2", Pt[]> = {
  t1: [
    [196, 372],
    [300, 380],
    [420, 404],
    [520, 436],
    [578, 494],
  ],
  t2: [
    [196, 412],
    [300, 418],
    [420, 432],
    [520, 452],
    [578, 524],
  ],
  b1: [
    [196, 842],
    [300, 834],
    [420, 816],
    [520, 794],
    [578, 724],
  ],
  b2: [
    [196, 802],
    [300, 796],
    [420, 788],
    [520, 774],
    [578, 692],
  ],
  m1: [
    [380, 584],
    [520, 590],
    [578, 599],
  ],
  m2: [
    [380, 634],
    [520, 624],
    [578, 614],
  ],
};

const OUT: Record<Way, Pt[]> = {
  // The signed lead slows for its last stretch: the arrival is the moment to see.
  signed: [
    [714, 604, "t"],
    [806, 604],
    [1102, 604],
    [1146, 604],
    [1370, 604, "s"],
    [1424, 604, "s", 0.35],
    [1442, 604, "x", 0.35],
  ],
  closing: [
    [714, 604, "t"],
    [806, 604],
    [1102, 604],
    [1146, 604],
    [1262, 604, "x"],
  ],
  sales: [
    [714, 604, "t"],
    [806, 604],
    [956, 604, "x"],
  ],
  drop: [
    [714, 622, "w"],
    [742, 660],
    [756, 724],
    [759, 766],
    [761, 824, "f"],
    [763, 896, "x"],
  ],
};

/** [way in, way out, where in the cycle it starts (0 to 1), its pace]. */
const LEADS: [keyof typeof IN, Way, number, number][] = [
  ["t1", "drop", 0, 1],
  ["b2", "sales", 0.05, 0.92],
  ["m1", "drop", 0.13, 1.08],
  ["t2", "closing", 0.17, 0.96],
  ["m1", "signed", 0.26, 1],
  ["m2", "drop", 0.31, 1.05],
  ["b1", "drop", 0.36, 0.9],
  ["t1", "sales", 0.44, 1.02],
  ["m2", "drop", 0.49, 0.95],
  ["t2", "closing", 0.55, 1.1],
  ["t1", "drop", 0.61, 0.98],
  ["b1", "drop", 0.64, 0.93],
  ["b2", "sales", 0.72, 1.04],
  ["m2", "signed", 0.77, 1],
  ["t2", "drop", 0.83, 0.97],
  ["b2", "closing", 0.88, 1.06],
  ["m1", "sales", 0.93, 0.94],
  ["b1", "drop", 0.97, 1.03],
];

/**
 * Where each lead rests when motion is reduced, so the still tells the same
 * story: a crowd at the mouth, some of it further back, serious leads
 * through the filter, three falling out of the floor, and the portal lit as
 * projects arrive. The signed lead is held under the portal's frame: a lone
 * signed dot in a still you can count would read as a rate.
 * [x, y, scale, opacity, teal]
 */
const STILL: [number, number, number, number, 0 | 1][] = [
  [300, 380, 1, 1, 0],
  [470, 420, 1, 1, 0],
  [362, 425, 1, 1, 0],
  [258, 838, 1, 1, 0],
  [452, 810, 1, 1, 0],
  [372, 792, 1, 1, 0],
  [548, 546, 1, 1, 0],
  [552, 664, 1, 1, 0],
  [750, 604, 1, 1, 1],
  [757, 744, 1, 0.95, 0],
  [760, 808, 1, 0.6, 0],
  [762, 870, 1, 0.28, 0],
  [1262, 684, 1, 1, 1],
  [1442, 604, 1, 0, 1],
  [236, 404, 1, 0.4, 0],
  [418, 394, 1, 0.45, 0],
  [318, 822, 1, 0.4, 0],
  [512, 792, 1, 0.45, 0],
];

const WHITE = "rgba(242,246,250,.85)";
const GREY = "rgba(242,246,250,.6)";
const TEAL = "#00cfc8";

export interface LeadPlan {
  /** The keyframes: one block per lead, and one per signed lead's glow. */
  frames: string[];
  /** Each lead's animation shorthand, in order. */
  runs: string[];
  /** The signed leads' glows: [lead, animation shorthand]. */
  glows: [number, string][];
  /** When a signed lead reaches the portal, as a share of the portal's cycle. */
  arrivals: number[];
  /** The same, for the portal grown on the last stop: its door is further up. */
  arrivalsOpen: number[];
  /** The largest keyframe offset used (a check: never past 100%). */
  last: number;
}

/** When a run reaches x, in seconds from its start (its pace holds within a stretch). */
function timeAt(pts: Pt[], at: number[], x: number): number {
  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i - 1][0];
    const x1 = pts[i][0];
    if (x0 < x1 && x0 <= x && x <= x1)
      return at[i - 1] + ((x - x0) / (x1 - x0)) * (at[i] - at[i - 1]);
  }
  return at[at.length - 1];
}

/**
 * The leads' keyframes and timings: plain data, so the checks can read them.
 * Only transform, opacity and background colour move, each named in every
 * block, so the browser runs them all off the main thread; a signed lead's
 * glow is its own layer that fades in.
 */
export function planLeads(): LeadPlan {
  const frames: string[] = [];
  const runs: string[] = [];
  const glows: [number, string][] = [];
  const arrivals: number[] = [];
  const arrivalsOpen: number[] = [];
  let last = 0;
  LEADS.forEach(([way, out, start, pace], k) => {
    const inn = IN[way];
    const pts = [...inn, ...OUT[out]];
    const at = [0];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(
        pts[i][0] - pts[i - 1][0],
        pts[i][1] - pts[i - 1][1],
      );
      at.push(at[i - 1] + d / (SPEED * pace * (pts[i][3] ?? 1)));
    }
    let state: State = "w";
    let bg = WHITE;
    const glow: string[] = [];
    const steps = pts.map((p, i) => {
      if (p[2]) state = p[2];
      const pct = `${((at[i] / CYCLE) * 100).toFixed(2)}%`;
      last = Math.max(last, (at[i] / CYCLE) * 100);
      const opacity = i === 0 ? 0 : state === "x" ? 0 : state === "f" ? 0.5 : 1;
      const teal =
        state === "t" || state === "s" || (state === "x" && out !== "drop");
      bg = teal ? TEAL : out === "drop" && i >= inn.length ? GREY : WHITE;
      const scale = state === "s" ? 1.75 : 1;
      glow.push(`${pct}{opacity:${state === "s" ? 1 : 0}}`);
      return `${pct}{transform:translate(${p[0]}px,${p[1]}px) scale(${scale});opacity:${opacity};background-color:${bg}}`;
    });
    // The tail holds the last place out of sight to the cycle's end.
    const end = (at[at.length - 1] / CYCLE) * 100;
    const tail = pts[pts.length - 1];
    const hold = `${Math.min(100, end + 0.01).toFixed(2)}%,100%`;
    steps.push(
      `${hold}{transform:translate(${tail[0]}px,${tail[1]}px) scale(1);opacity:0;background-color:${bg}}`,
    );
    frames.push(`@keyframes dk-sys-lead-${k}{${steps.join("")}}`);
    const delay = -start * CYCLE;
    const timing = `${CYCLE}s linear ${delay.toFixed(2)}s infinite`;
    runs.push(`dk-sys-lead-${k} ${timing}`);
    if (out === "signed") {
      glow.push(`${hold}{opacity:0}`);
      frames.push(`@keyframes dk-sys-glow-${k}{${glow.join("")}}`);
      glows.push([k, `dk-sys-glow-${k} ${timing}`]);
      // At the portal's door, in the portal's own clock (it starts at 0).
      const share = (door: number) =>
        ((((timeAt(pts, at, door) + delay) % CYCLE) + CYCLE) % CYCLE) / CYCLE;
      arrivals.push(share(DATA.rest.x - 4));
      arrivalsOpen.push(share(DATA.open.x - 4));
    }
  });
  return { frames, runs, glows, arrivals, arrivalsOpen, last };
}

/** The ride: a light that runs the loop, one lap every RIDE seconds once the loop is drawn. */
export const RIDE = 13;
const RIDE_DELAY = 1.6;
/** How far before its end the ride fades out, over the last bend into the mouth. */
const RIDE_FADE = 70;
const RIDE_PTS: [number, number][] = [
  [1606, 732],
  [1606, 899],
  [1594.3, 927.3],
  [1566, 939],
  [190, 939],
  [161.7, 927.3],
  [150, 899],
  [150, 644],
  [161.7, 615.7],
  [190, 604],
  [198, 604],
];

export function rideFrames(): string {
  const at = [0];
  for (let i = 1; i < RIDE_PTS.length; i++)
    at.push(
      at[i - 1] +
        Math.hypot(
          RIDE_PTS[i][0] - RIDE_PTS[i - 1][0],
          RIDE_PTS[i][1] - RIDE_PTS[i - 1][1],
        ),
    );
  const total = at[at.length - 1];
  const steps = RIDE_PTS.map(([x, y], i) => {
    const pct = (at[i] / total) * 100;
    // In over the first stretch, under the portal; out over the last bend.
    const opacity = Math.min(1, at[i] / at[1], (total - at[i]) / RIDE_FADE);
    return `${pct.toFixed(2)}%{transform:translate(${x}px,${y}px);opacity:${opacity.toFixed(2)}}`;
  });
  return `@keyframes dk-sys-ride{${steps.join("")}}`;
}

/** The portal's ring lights as a signed lead pours in (its opacity only). */
export function arriveFrames(name: string, arrivals: number[]): string {
  const marks = [...arrivals]
    .sort((a, b) => a - b)
    .map(f => {
      const p = f * 100;
      const a = Math.max(0, p - 0.4);
      const b = Math.min(99.8, p + 0.6);
      const c = Math.min(99.9, p + 5);
      return `${a.toFixed(2)}%{opacity:0}${b.toFixed(2)}%{opacity:1}${c.toFixed(2)}%{opacity:0}`;
    });
  return `@keyframes ${name}{0%,100%{opacity:0}${marks.join("")}}`;
}

/** Reduced motion: each lead held where STILL puts it, the glows still. */
export function stillRules(): string {
  return STILL.map(
    ([x, y, s, o, teal], k) =>
      `.dk-sys-lead:nth-child(${k + 1}){animation:none;transform:translate(${x}px,${y}px) scale(${s});opacity:${o};background-color:${teal ? TEAL : WHITE}}.dk-sys-lead:nth-child(${k + 1})::after{animation:none;opacity:${s > 1 ? 1 : 0}}`,
  ).join("");
}

/**
 * The slide's generated styles: the leads and their glows, the ride, the
 * portal's ring, each run from the timings above so none drifts from the
 * others. Each run is a rule, not an inline style, so reduced motion can
 * hold it; the ring then stays lit.
 */
export function systemCss(): string {
  const plan = planLeads();
  const ring = (k: string, name: string) =>
    `.dk-slide[data-active] .dk-sys-glow[data-k="${k}"]{animation:${name} ${CYCLE}s linear infinite}`;
  return [
    ...plan.frames,
    plan.runs
      .map((run, k) => `.dk-sys-lead:nth-child(${k + 1}){animation:${run}}`)
      .join(""),
    plan.glows
      .map(
        ([k, run]) =>
          `.dk-sys-lead:nth-child(${k + 1})::after{animation:${run}}`,
      )
      .join(""),
    rideFrames(),
    `.dk-sys-ride{animation:dk-sys-ride ${RIDE}s linear ${RIDE_DELAY}s infinite}`,
    arriveFrames("dk-sys-arrive", plan.arrivals),
    arriveFrames("dk-sys-arrive-open", plan.arrivalsOpen),
    ring("rest", "dk-sys-arrive"),
    ring("open", "dk-sys-arrive-open"),
    `@media (prefers-reduced-motion:reduce){${stillRules()}.dk-slide[data-active] .dk-sys-glow[data-k]{animation:none;opacity:1}}`,
  ].join("\n");
}

export const LEAD_COUNT = LEADS.length;
export const STILL_COUNT = STILL.length;
/** The still, for the checks: [x, y, scale, opacity, teal]. */
export const STILL_LEADS = STILL;
export const LEAD_WAYS = LEADS.map(l => l[1]);
export const DROP_PATH = OUT.drop;
export const SIGNED_PATH = OUT.signed;
