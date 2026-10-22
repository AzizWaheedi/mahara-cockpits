import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import academyShot from "./assets/pcm-academy-masked.webp";
import lessonShot from "./assets/pcm-lesson-masked.webp";
import { digits, type L, LAUNCH, SHARED, t } from "./content";
import type { SlideCtx } from "./deckContext";
import { Node } from "./JourneyLanes";
import { Crop, Tagged } from "./mockups/Cards";

/**
 * The launch deck's expectation slides from Mahara's own Gamma deck
 * (docs/csm-decks/CONTENT.md L7 and L8, DESIGN.md 20.3 to 20.5): the piece
 * of the pie with its two roads, and the sales training. Both are drawn in
 * the journey's line language and the deck's tokens; every word is in
 * content.ts. The SVGs hold no text and mirror in Arabic; every label is
 * HTML set with logical properties.
 */

// ------------------------------------------------------- the stage box

/** The slide's content box (1920 x 1080 less the slide's padding, no rail). */
const W = 1648;
const H = 864;

/** The pie (DESIGN 20.3): centred at canvas (1060, 680), r 260. */
const CX = 924;
const CY = 568;
const R = 260;
/** Each straight edge sits this far back from its radius: 8 px of ground between the 3 px edges. */
const OFF = 5.5;
const RIM = Math.sqrt(R * R - OFF * OFF);
/** How far their piece is pulled out, along its own bisector. */
const PULL = 48;

/** The pie's two pieces, done for you (ours 270°, theirs 90°) and done with you (halves). */
function pieces(dwy: boolean) {
  if (dwy)
    return {
      ours: `M ${CX + OFF} ${CY - RIM} A ${R} ${R} 0 0 1 ${CX + OFF} ${CY + RIM} Z`,
      theirs: `M ${CX - OFF} ${CY + RIM} A ${R} ${R} 0 0 1 ${CX - OFF} ${CY - RIM} Z`,
      // Along the nine o'clock bisector.
      pull: { x: -PULL, y: 0 },
    };
  return {
    ours: `M ${CX + OFF} ${CY - RIM} A ${R} ${R} 0 1 1 ${CX - RIM} ${CY + OFF} L ${CX + OFF} ${CY + OFF} Z`,
    theirs: `M ${CX - OFF} ${CY - OFF} L ${CX - RIM} ${CY - OFF} A ${R} ${R} 0 0 1 ${CX - OFF} ${CY - RIM} Z`,
    // Along the half past ten bisector.
    pull: { x: -PULL / Math.SQRT2, y: -PULL / Math.SQRT2 },
  };
}

/**
 * Where each label's leader ends inside its piece, and the row's height:
 * ours level with the disc's centre, a dot just inside the rim at three
 * o'clock; theirs level with the pulled piece, a dot inside its rim.
 */
const OURS_DOT = { x: CX + R - 26, y: CY };
const THEIRS_DOT = {
  fy: { x: 690, y: 420 },
  wy: { x: 650, y: CY },
};
/** Our names start here, past the rim and a short leader. */
const OURS_NAMES_X = 1264;

function PieLabel({
  side,
  dot,
  names,
  owner,
  lane,
  lang,
  shown,
  quiet = false,
}: {
  side: "start" | "end";
  dot: { x: number; y: number };
  names: readonly L[];
  owner: L;
  lane: "us" | "you";
  lang: SlideCtx["lang"];
  shown: boolean;
  /** Stop 1's quiet twin of their label, in ink-3 (the fixer's round). */
  quiet?: boolean;
}) {
  // A row: the names and one leader into the piece, ending on a dot in the
  // piece's edge colour. Ours: dot, leader, names (end side). Theirs:
  // names, leader, dot (start side). The owner sits over the names, so the
  // leader is level with them, not with the owner.
  const list = (
    <span className="dkc-pie-names">
      <span className="dkc-pie-owner" data-lane={lane}>
        {t(owner, lang)}
      </span>
      {names.map(n => (
        <span key={n.en} className="dkc-pie-name">
          {t(n, lang)}
        </span>
      ))}
    </span>
  );
  const style: CSSProperties =
    side === "end"
      ? { insetInlineStart: dot.x - 5, top: dot.y }
      : { insetInlineStart: 0, width: dot.x + 5, top: dot.y };
  return (
    <div
      className="dkc-pie-label"
      data-side={side}
      data-lane={lane}
      data-shown={shown ? "" : undefined}
      data-quiet={quiet ? "" : undefined}
      aria-hidden={quiet || undefined}
      style={style}
    >
      {side === "end" ? (
        <>
          <i className="dkc-pie-dot" />
          <i
            className="dkc-pie-leader"
            style={{ width: OURS_NAMES_X - 16 - (dot.x + 5) }}
          />
          {list}
        </>
      ) : (
        <>
          {list}
          <i className="dkc-pie-leader" data-grow="" />
          <i className="dkc-pie-dot" />
        </>
      )}
    </div>
  );
}

function Pie({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour } = ctx;
  const P = LAUNCH.partner;
  const dwy = d.mode.dwy;
  const out = tour >= 1;
  const shape = pieces(dwy);
  return (
    <div className="dkc-pie" data-out={out ? "" : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        <path
          className="dkc-pie-ours"
          d={shape.ours}
          fill="var(--dk-teal-soft)"
          stroke="var(--dk-teal)"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <g
          className="dkc-pie-theirs"
          style={
            out
              ? {
                  transform: `translate(${shape.pull.x}px, ${shape.pull.y}px)`,
                }
              : undefined
          }
        >
          {/* Ahead: the lanes' unlit line, dotted and unfilled. */}
          <path
            className="dkc-pie-ahead"
            d={shape.theirs}
            fill="none"
            stroke="var(--dk-ink-3)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="2 7"
          />
          {/* Lit: the client's ink. */}
          <path
            className="dkc-pie-lit"
            d={shape.theirs}
            fill="var(--dk-panel-2)"
            stroke="var(--dk-ink)"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <PieLabel
        side="end"
        dot={OURS_DOT}
        names={dwy ? P.oursDwy : P.ours}
        owner={P.owner.us}
        lane="us"
        lang={lang}
        shown
      />
      {/* Their label is there from stop 1, quiet (ink-3) over the slot
          that is theirs, so the start side never opens empty; on stop 2 its
          ink twin fades in over it as the piece is pulled. */}
      <PieLabel
        side="start"
        dot={dwy ? THEIRS_DOT.wy : THEIRS_DOT.fy}
        names={dwy ? P.theirsDwy : P.theirs}
        owner={dwy ? P.owner.youDwy : P.owner.you}
        lane="you"
        lang={lang}
        shown={!out}
        quiet
      />
      <PieLabel
        side="start"
        dot={dwy ? THEIRS_DOT.wy : THEIRS_DOT.fy}
        names={dwy ? P.theirsDwy : P.theirs}
        owner={dwy ? P.owner.youDwy : P.owner.you}
        lane="you"
        lang={lang}
        shown={out}
      />
    </div>
  );
}

// ------------------------------------------------------------ the roads

/** The roads (DESIGN 20.4), in the stage box: both start at x 424 (canvas 560). */
const ROAD_X = 424;
const MEET = { x: 1256, y: 590 };
const SIGNED = { x: 1476, y: 590 };
const AD_Y = 372;
/**
 * The ad road's meander: hairpin switchbacks of different depths, each turn
 * a half circle (60 px corners on 120 px runs), so it reads as a road
 * winding the long way, never as a square signal. Then it drops into the
 * meeting from above.
 */
const AD_POINTS: [number, number][] = [
  [ROAD_X, AD_Y],
  [530, AD_Y],
  [530, 476],
  [650, 476],
  [650, 334],
  [770, 334],
  [770, 452],
  [890, 452],
  [890, 350],
  [1010, 350],
  [1010, 486],
  [1130, 486],
  [1130, 404],
  [MEET.x, 404],
  [MEET.x, MEET.y],
];
/** The ad road's turns: wide enough to round each 120 px run into a hairpin. */
const AD_TURN = 60;
/**
 * Why the ad road is longer, written on it (the fixer's round): the first
 * words over its first crest (x 650 to 770, y 334), the second over its
 * last crest (x 1130 to 1256, y 404), each centred on its bend. Under the
 * third dip the second sat nearer the referral road than its own bend, so
 * it read as that road's label (score round 2).
 */
const BENDS = [
  { x: 710, y: 334, side: "over" },
  { x: 1193, y: 404, side: "over" },
] as const;
const REF_POINTS: [number, number][] = [
  [ROAD_X, MEET.y],
  [MEET.x, MEET.y],
];

/** An orthogonal polyline with its corners rounded (24 px), in the journey's line language. */
function rounded(points: [number, number][], r = 24): string {
  const [x0, y0] = points[0];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1];
    const [px, py] = points[i];
    const [bx, by] = points[i + 1];
    const la = Math.hypot(px - ax, py - ay);
    const lb = Math.hypot(bx - px, by - py);
    const k = Math.min(r, la / 2, lb / 2);
    const sx = px - ((px - ax) / la) * k;
    const sy = py - ((py - ay) / la) * k;
    const ex = px + ((bx - px) / lb) * k;
    const ey = py + ((by - py) / lb) * k;
    d += ` L ${sx} ${sy} Q ${px} ${py} ${ex} ${ey}`;
  }
  const [xn, yn] = points[points.length - 1];
  return `${d} L ${xn} ${yn}`;
}

const lengthOf = (points: [number, number][]) =>
  points
    .slice(1)
    .reduce(
      (n, [x, y], i) => n + Math.hypot(x - points[i][0], y - points[i][1]),
      0,
    );

/** The referral road draws in 520 ms; the ad road at the same speed, so it takes longer. */
const REF_MS = 520;
const AD_MS = Math.round((REF_MS * lengthOf(AD_POINTS)) / lengthOf(REF_POINTS));

function Roads({ ctx }: { ctx: SlideCtx }) {
  const { lang, tour } = ctx;
  const R = LAUNCH.partner.road;
  const close = tour >= 3;
  const ends = [
    { at: MEET, name: R.meeting },
    { at: SIGNED, name: R.signed },
  ];
  return (
    <div className="dkc-routes" data-close={close ? "" : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        <path
          className="dkc-route dkc-route-draw"
          d={rounded(AD_POINTS, AD_TURN)}
          pathLength={1}
          style={{ animationDuration: `calc(${AD_MS}ms * var(--dk-m))` }}
        />
        <path
          className="dkc-route dkc-route-draw"
          d={rounded(REF_POINTS)}
          pathLength={1}
          style={{ animationDuration: `calc(${REF_MS}ms * var(--dk-m))` }}
        />
        {/* The client's end of the road: the meeting to the signature. Its
            ink is a second layer fading in over the line-strong one (a
            colour change is never a paint transition, DESIGN 22.3.4). */}
        <path
          className="dkc-route dkc-route-close"
          d={`M ${MEET.x} ${MEET.y} L ${SIGNED.x} ${SIGNED.y}`}
        />
        <path
          className="dkc-route dkc-route-close dkc-route-ink"
          d={`M ${MEET.x} ${MEET.y} L ${SIGNED.x} ${SIGNED.y}`}
        />
        <Node x={ROAD_X} y={AD_Y} r={14} state="ahead" />
        <Node x={ROAD_X} y={MEET.y} r={14} state="ahead" />
        {ends.map(e => (
          <g key={e.name.en}>
            <circle className="dkc-route-end" cx={e.at.x} cy={e.at.y} r={13} />
            <circle
              className="dkc-route-end dkc-route-ink"
              cx={e.at.x}
              cy={e.at.y}
              r={13}
            />
          </g>
        ))}
      </svg>
      {/* Each road's name at its start, level with its own ring; the ad
          road's reasons on its own bends, read along it. */}
      <div className="dkc-route-words" style={{ top: AD_Y }}>
        <b>{t(R.ad, lang)}</b>
      </div>
      {BENDS.map((b, i) => (
        <span
          key={b.x}
          className="dkc-route-bend"
          data-side={b.side}
          style={{ insetInlineStart: b.x, top: b.y }}
        >
          <span>{t(R.bends[i], lang)}</span>
        </span>
      ))}
      <div className="dkc-route-words" style={{ top: MEET.y }}>
        <b>{t(R.referral, lang)}</b>
        <span>{t(R.referralLine, lang)}</span>
      </div>
      {ends.map(e => (
        <span
          key={e.name.en}
          className="dkc-route-node"
          style={{ insetInlineStart: e.at.x, top: e.at.y + 26 }}
        >
          <span>{t(e.name, lang)}</span>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------- L7 partnership

export const PARTNER_STOPS = 4;

/** The four stops' names, for the notes window. */
export function partnerStop(i: number, dwy: boolean): L | null {
  const P = LAUNCH.partner;
  return (
    [
      dwy ? P.line1Dwy : P.line1,
      dwy ? P.line2Dwy : P.line2,
      P.road.caption,
      P.close,
    ][i] ?? null
  );
}

export function Partnership({ ctx }: { ctx: SlideCtx }) {
  const { d, lang, tour, still } = ctx;
  const P = LAUNCH.partner;
  const dwy = d.mode.dwy;
  const roads = tour >= 2;
  return (
    <div
      className="dkc-partner"
      data-out={tour >= 1 ? "" : undefined}
      data-still={still ? "" : undefined}
    >
      <header className="dkc-partner-head">
        {/* Ours in teal, theirs in ink: the one title in the deck that
            splits its colour, because it says what the pie draws. Each
            line stays one line (the shots check it). */}
        <h2 className="dk-h1 dkc-partner-title">
          <span className="dk-teal" data-one-line="">
            {t(dwy ? P.line1Dwy : P.line1, lang)}
          </span>
          <span className="dkc-partner-l2" data-one-line="">
            {t(dwy ? P.line2Dwy : P.line2, lang)}
          </span>
        </h2>
        {roads ? (
          <p className="dk-lead dkc-partner-caption" key={`cap-${lang}`}>
            {t(P.road.caption, lang)}
          </p>
        ) : null}
      </header>
      <div className="dkc-partner-stage" key={roads ? "roads" : "pie"}>
        {roads ? <Roads ctx={ctx} /> : <Pie ctx={ctx} />}
      </div>
      {tour >= 3 ? (
        <p className="dk-h3 dkc-partner-foot" key={`close-${lang}`}>
          {t(P.close, lang)}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------- L8 training

/**
 * The training's three stops (DESIGN 20.5): the Academy's classroom, a
 * Project Closing Mastery lesson (both the sales deck's screenshots,
 * masked: copy rule 11), then the two statements. The list stays put.
 */
export const TRAINING_STOPS: L[] = [
  LAUNCH.training.shots.classroom,
  LAUNCH.training.shots.lesson,
  LAUNCH.training.statements[0].name,
];

/** The masked copies: 1456 x 1029 and 1444 x 990 (the copy test pins them). */
const SHOTS = [
  { src: academyShot, alt: LAUNCH.training.shots.classroom, w: 1456, h: 1029 },
  { src: lessonShot, alt: LAUNCH.training.shots.lesson, w: 1444, h: 990 },
];
/** The screenshots' column, as wide as the grid's end column. */
const SHOT_W = 704;
/**
 * Stop 1: Project Closing Mastery's tile in the classroom (x 482 to 895,
 * y 557 to 975 of 1456 x 1029), ringed in teal.
 */
const PCM_TILE = {
  x0: 482 / 1456,
  y0: 557 / 1029,
  x1: 895 / 1456,
  y1: 975 / 1029,
};
/**
 * Stop 2: the lesson, cut only across (DESIGN 22.6.5): under the top bar,
 * and at the foot under the outline's "04: Uncertainty Objections". The
 * player's whole width and 16 px of the page past it are kept (its end at
 * x 1383 of 1444), so no edge of the player is cut; it is scaled to the
 * column's 704 px, whatever that gives.
 */
const LESSON_CROP = {
  box: [0.03, 0.01, 0.969, 0.975] as [number, number, number, number],
  ratio: 1444 / 990,
};

export function Training({ ctx }: { ctx: SlideCtx }) {
  const { lang, tour } = ctx;
  const T = LAUNCH.training;
  const shot = SHOTS[tour];
  const bodyRef = useRef<HTMLDivElement>(null);
  const [leader, setLeader] = useState<{
    d: string;
    x: number;
    y: number;
  } | null>(null);
  // Stop 1: a short leader from the lit course, level with its name, to
  // the screenshot's edge; the teal ring alone marks the course's tile
  // (score round 2: run on along the gap between the tiles' rows, it lay
  // on the neighbouring tile's top edge, so the wrong course looked
  // ringed). Measured in the canvas's own pixels.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const row = body?.querySelector<HTMLElement>(".dkc-courses > li[data-lit]");
    const name = row?.querySelector<HTMLElement>(".dkc-course-name");
    const img = body?.querySelector<HTMLElement>(".dkc-train-frame");
    if (tour !== 0 || !body || !row || !name || !img) {
      setLeader(l => (l ? null : l));
      return;
    }
    const b = body.getBoundingClientRect();
    const k = b.width / body.offsetWidth || 1;
    const x = (v: number) => (v - b.left) / k;
    const y = (v: number) => (v - b.top) / k;
    const r = row.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    const f = img.getBoundingClientRect();
    const rtl = lang === "ar";
    const ax = x(rtl ? r.left : r.right);
    const ay = y((n.top + n.bottom) / 2);
    const fx = x(rtl ? f.right : f.left);
    const d = `M ${ax} ${ay} H ${fx}`;
    setLeader(l => (l?.d === d ? l : { d, x: ax, y: ay }));
  });
  return (
    <div className="dkc-train">
      <header className="dkc-train-head">
        <h2 className="dk-h2">{t(T.title, lang)}</h2>
        <p className="dk-lead">{t(T.lead, lang)}</p>
      </header>
      <div className="dkc-train-body" ref={bodyRef}>
        {/* The Academy's own order and numbers, under its name; the one
            course for their meetings lit, opening into what it teaches. */}
        <div className="dkc-train-list">
          <span className="dk-label dkc-train-academy">
            {t(T.academy, lang)}
          </span>
          <ol className="dkc-courses">
            {T.courses.map((c, i) => {
              const lit = i === T.lit;
              return (
                <li
                  key={c.en}
                  data-lit={lit ? "" : undefined}
                  aria-current={lit ? "true" : undefined}
                >
                  <span className="dkc-course-n">{digits(i + 1, lang)}</span>
                  <span className="dkc-course-mark" aria-hidden>
                    {lit ? (
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 32 32"
                        aria-hidden
                      >
                        <Node x={16} y={16} r={14} state="now" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="dkc-course-body">
                    <span className="dkc-course-name">{t(c, lang)}</span>
                    {lit && lang === "ar" ? (
                      // The name the Academy and its screenshot show, so the
                      // client finds the course by it.
                      <span className="dkc-course-latin" dir="ltr" lang="en">
                        {c.en}
                      </span>
                    ) : null}
                    {lit ? (
                      <>
                        <span className="dk-label dkc-teaches-label">
                          {t(T.teaches, lang)}
                        </span>
                        <ol className="dkc-teaches">
                          {T.parts.map((p, k) => (
                            <li
                              key={p.en}
                              data-close={
                                k === T.parts.length - 1 ? "" : undefined
                              }
                            >
                              <i aria-hidden />
                              <span>{t(p, lang)}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        {shot ? (
          // The Academy's own screen, as the portal's are set: no browser
          // bar, no shadow, a step down in brightness, tagged as what it is.
          // Stop 1 rings the course on its tile; stop 2 is the lesson's
          // outline, cropped and drawn larger.
          <Tagged
            key={tour}
            tag={t(SHARED.tag.academy, lang)}
            className="dkc-train-shot"
          >
            {tour === 0 ? (
              <span className="dkc-train-frame">
                <img
                  src={shot.src}
                  alt={t(shot.alt, lang)}
                  width={shot.w}
                  height={shot.h}
                  decoding="async"
                />
                <i
                  className="dkc-train-ring"
                  aria-hidden
                  style={{
                    left: `calc(${PCM_TILE.x0 * 100}% - 7px)`,
                    top: `calc(${PCM_TILE.y0 * 100}% - 7px)`,
                    width: `calc(${(PCM_TILE.x1 - PCM_TILE.x0) * 100}% + 14px)`,
                    height: `calc(${(PCM_TILE.y1 - PCM_TILE.y0) * 100}% + 14px)`,
                  }}
                />
              </span>
            ) : (
              <span className="dkc-train-frame">
                <Crop
                  src={shot.src}
                  crop={LESSON_CROP}
                  width={SHOT_W}
                  alt={t(shot.alt, lang)}
                  radius={16}
                />
              </span>
            )}
          </Tagged>
        ) : (
          <div key={tour} className="dkc-train-side">
            {T.statements.map(s => (
              <section key={s.name.en} className="dkc-train-say">
                <h3>{t(s.name, lang)}</h3>
                <p>{t(s.line, lang)}</p>
              </section>
            ))}
            <p className="dk-small dk-ink2 dkc-train-link">{t(T.foot, lang)}</p>
          </div>
        )}
        {leader ? (
          <svg className="dkc-train-leader" aria-hidden>
            <path d={leader.d} />
            <circle r={5} cx={leader.x} cy={leader.y} />
          </svg>
        ) : null}
      </div>
    </div>
  );
}
