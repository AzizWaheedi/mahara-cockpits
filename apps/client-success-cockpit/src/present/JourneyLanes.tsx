import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  journeyName,
  journeyOwners,
  type L,
  LANES,
  LAUNCH,
  type LaneKey,
  type Lang,
  SHARED,
  t,
} from "./content";

/**
 * The signature (DESIGN 6): one enquiry's path from the ad to the answer,
 * drawn as a responsibility matrix. Rows are the seven steps, three lanes
 * say who does each (your customer, our team, you), and one line passes
 * between them like a baton, lit as the presenter walks it.
 *
 * One line language for every path in both decks: a node (a ring ahead, a
 * ring with a check when passed, a solid fill when current), a line (solid
 * teal when lit, dotted when not) and a leader. No glow, no gradient. The
 * SVG holds no text and mirrors with scaleX(-1) in Arabic; every word is
 * HTML set with logical properties.
 */

/**
 * Each lane is as wide as its longest name needs, so every name stays
 * inside its own lane (on two balanced lines at most) and the matrix holds
 * its own entries: the customer's lane, ours ("Booked, confirmed," is the
 * widest line in either language) and the client's. Done with you, our
 * team holds no step: its lane narrows to its head (quiet, not lit) and
 * the client's lane, where every step after the form sits, takes the room.
 * The matrix is 840 wide either way, so the stage never moves.
 */
const LANE_WS: Record<LaneKey, number> = {
  customer: 244,
  us: 312,
  you: 260,
};
const LANE_WS_DWY: Record<LaneKey, number> = {
  customer: 244,
  us: 148,
  you: 424,
};
const widths = (dwy: boolean) => (dwy ? LANE_WS_DWY : LANE_WS);
export const LANE_GAP = 12;
export const ROW_H = 92;
export const HEAD_H = 48;
export const LANES_W =
  LANE_WS.customer + LANE_WS.us + LANE_WS.you + LANE_GAP * 2;
export const LANES_H = HEAD_H + ROW_H * 7;
/** The node's centre from its lane's start edge, and the name's start. */
const NODE_IN = 30;
const NAME_IN = 56;

const laneIndex = (k: LaneKey) => LANES.indexOf(k);
export const laneX = (k: LaneKey, dwy = false) =>
  LANES.slice(0, laneIndex(k)).reduce(
    (x, l) => x + widths(dwy)[l] + LANE_GAP,
    0,
  );
export const nodeX = (k: LaneKey, dwy = false) => laneX(k, dwy) + NODE_IN;
export const rowY = (i: number) => HEAD_H + ROW_H / 2 + i * ROW_H;
/** How wide a lane's names may run before they wrap. */
const nameW = (k: LaneKey, dwy: boolean) => widths(dwy)[k] - NAME_IN - 12;

/** The rail's path between two steps (left to right): straight in a lane, an S across. */
export function railPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bend: number,
): string {
  if (a.y === b.y) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y} ${b.x - bend} ${b.y} ${b.x} ${b.y}`;
}

/** The path between two steps: straight in a lane, an S across lanes. */
export function segmentPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  bend = ROW_H / 2,
): string {
  if (a.x === b.x) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + bend} ${b.x} ${b.y - bend} ${b.x} ${b.y}`;
}

const TEAL = "var(--dk-teal)";
const STRONG = "var(--dk-line-strong)";
const GROUND = "var(--dk-space)";
const INK2 = "var(--dk-ink-2)";
const DEEP = "var(--dk-deep)";

/** One node in the line language. */
export function Node({
  x,
  y,
  r,
  state,
}: {
  x: number;
  y: number;
  r: number;
  state: "past" | "now" | "ahead";
}) {
  // The current node is a solid fill. Small (the rail, the cover's strip),
  // a centre dot would leave a thin ring that reads as the nodes ahead, so
  // only a node large enough to show a dot inside a fill carries one.
  if (state === "now")
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={TEAL} />
        {r >= 9 ? (
          <circle cx={x} cy={y} r={Math.max(2, r * 0.29)} fill={DEEP} />
        ) : null}
      </g>
    );
  const k = r / 14;
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={r - 1}
        fill={GROUND}
        stroke={state === "past" ? TEAL : STRONG}
        strokeWidth={2}
      />
      {state === "past" ? (
        <path
          className="dkc-check"
          d={`M ${x - 5.5 * k} ${y + 0.5 * k} L ${x - 1.5 * k} ${y + 4.5 * k} L ${x + 6 * k} ${y - 4 * k}`}
          fill="none"
          stroke={TEAL}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}

/** The unlit line: 2 px, round-capped dots. */
const dotted = {
  fill: "none",
  stroke: STRONG,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeDasharray: "2 8",
};
/** The lit line: 3 px solid teal, round-capped. */
const solid = {
  fill: "none",
  stroke: TEAL,
  strokeWidth: 3,
  strokeLinecap: "round" as const,
};

/** Remembers the last value, so the segment just reached draws once. */
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  const [prev, setPrev] = useState<T | undefined>(undefined);
  useEffect(() => {
    setPrev(ref.current);
    ref.current = value;
  }, [value]);
  return prev;
}

export interface LanesProps {
  lang: Lang;
  /** The lit step, from 0. */
  current: number;
  dwy: boolean;
  /** Reduced motion: every state set at once. */
  still?: boolean;
  /** Draw the fork from "You meet" (stop 6 on). */
  fork?: boolean;
  /** The leader's end: the nearest edge of the stage picture, in lanes px. */
  leaderTo?: { x: number; y: number } | null;
  /** A row was clicked: jump there. */
  onPick?: (i: number) => void;
  /**
   * Nothing lit and nothing to press: the whole journey drawn quietly, as
   * the covers show it before anyone has walked it.
   */
  idle?: boolean;
  style?: CSSProperties;
}

/** The journey lanes, at full size (840 x 692 at the canvas's 1:1). */
export function JourneyLanes({
  lang,
  current,
  dwy,
  still,
  fork,
  leaderTo,
  onPick,
  idle = false,
  style,
}: LanesProps) {
  const owners = journeyOwners(dwy);
  const W = widths(dwy);
  const pts = owners.map((o, i) => ({ x: nodeX(o, dwy), y: rowY(i) }));
  const prev = usePrevious(current);
  const now = idle ? -1 : current;
  const drawing = !still && prev !== undefined && now === prev + 1;
  const at = pts[now];
  // The leader leaves the lit row's band at the matrix's end edge, on the
  // row's own centre line, and runs straight to the stage picture: it never
  // crosses a name, and the band itself says which row it belongs to.
  const bandEnd = LANES_W + 12;
  const leader =
    leaderTo && at
      ? `M ${bandEnd} ${at.y} L ${bandEnd + 14} ${at.y} L ${leaderTo.x} ${leaderTo.y}`
      : null;
  const youX = nodeX("you", dwy);
  // The fork (DESIGN 6.2): a no-show goes back to our team's lane; done
  // with you, it stays in the client's lane, between "You meet" and "You
  // mark it", out past the names, its own name beside it in that lane.
  const forkEnd = dwy
    ? { x: youX + 196, y: rowY(5) + ROW_H / 2 + 4 }
    : { x: nodeX("us"), y: rowY(6) };
  const forkPath = dwy
    ? `M ${youX} ${rowY(5) + 14} C ${youX} ${forkEnd.y} ${forkEnd.x - 120} ${forkEnd.y} ${forkEnd.x - 11} ${forkEnd.y}`
    : `M ${youX} ${rowY(5) + 14} C ${youX} ${rowY(5) + 70} ${forkEnd.x + 60} ${forkEnd.y - 30} ${forkEnd.x} ${forkEnd.y - 11}`;
  return (
    <div
      className="dkc-lanes"
      data-idle={idle ? "" : undefined}
      data-dwy={dwy ? "" : undefined}
      style={{ width: LANES_W, height: LANES_H, ...style }}
    >
      <svg viewBox={`0 0 ${LANES_W} ${LANES_H}`} aria-hidden>
        {LANES.map(k => (
          <rect
            key={k}
            x={laneX(k, dwy)}
            y={40}
            width={W[k]}
            height={LANES_H - 40}
            rx={12}
            fill="var(--dk-lane)"
          />
        ))}
        {/* The current row's band runs the matrix's whole width, so every
            name, wrapped or not, sits inside it. */}
        {at ? (
          <rect
            className="dkc-row-band"
            x={-12}
            y={0}
            width={bandEnd + 12}
            height={ROW_H}
            rx={12}
            fill="var(--dk-teal-faint)"
            style={{ transform: `translateY(${rowY(now) - ROW_H / 2}px)` }}
          />
        ) : null}
        {pts.slice(0, -1).map((a, i) => {
          const b = pts[i + 1];
          const d = segmentPath(a, b);
          const lit = i < now;
          const handover = a.x !== b.x;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <g key={`seg-${String(i)}`}>
              <path d={d} {...dotted} />
              {lit ? (
                <path
                  key={drawing && i === now - 1 ? `draw-${now}` : "lit"}
                  d={d}
                  {...solid}
                  pathLength={1}
                  className={drawing && i === now - 1 ? "dkc-draw" : undefined}
                />
              ) : null}
              {handover ? (
                <path
                  d={`M ${mx - 3} ${my - 5} L ${mx + 3} ${my} L ${mx - 3} ${my + 5}`}
                  fill="none"
                  stroke={lit ? TEAL : STRONG}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          );
        })}
        {fork && !idle ? (
          // Teal only when the no-show comes back to us: done with you the
          // follow-up is their own (their lane's ink), never ours.
          <g>
            <path d={forkPath} {...dotted} stroke={dwy ? INK2 : TEAL} />
            <circle
              cx={forkEnd.x}
              cy={forkEnd.y}
              r={10}
              fill={GROUND}
              stroke={dwy ? INK2 : TEAL}
              strokeWidth={2}
            />
            <path
              d={`M ${forkEnd.x - 4} ${forkEnd.y - 3} A 4.5 4.5 0 1 1 ${forkEnd.x - 3.5} ${forkEnd.y + 3}`}
              fill="none"
              stroke={dwy ? INK2 : TEAL}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
        ) : null}
        {leader ? (
          <g>
            <path
              className="dkc-leader"
              d={leader}
              fill="none"
              stroke={STRONG}
              strokeWidth={2}
            />
            <circle cx={bandEnd} cy={at?.y} r={4} fill={TEAL} />
            <circle cx={leaderTo?.x} cy={leaderTo?.y} r={3} fill={STRONG} />
          </g>
        ) : null}
        {pts.map((p, i) => (
          <Node
            key={`n-${String(i)}`}
            x={p.x}
            y={p.y}
            r={14}
            state={i < now ? "past" : i === now ? "now" : "ahead"}
          />
        ))}
      </svg>
      {LANES.map(k => (
        <span
          key={k}
          className="dkc-lane-head"
          data-lane={k}
          style={{ insetInlineStart: laneX(k, dwy) + 20 }}
        >
          {t(SHARED.lane[k], lang)}
        </span>
      ))}
      {fork && !idle ? (
        // The rebook node says what it is: the stage's "Didn't show?" card,
        // named to the node's end side, inside the lane it is drawn in.
        <span
          className="dkc-fork-name"
          style={{ insetInlineStart: forkEnd.x + 20, top: forkEnd.y }}
        >
          {t(LAUNCH.journey.fork.noShow, lang)}
        </span>
      ) : null}
      {pts.map((p, i) => {
        const name: L = journeyName(i, dwy);
        const state = i < now ? "past" : i === now ? "now" : "ahead";
        const place = {
          insetInlineStart: p.x + NAME_IN - NODE_IN,
          top: p.y,
          maxWidth: nameW(owners[i], dwy),
        };
        if (idle)
          return (
            <span
              key={`name-${String(i)}`}
              className="dkc-row-name"
              data-lane={owners[i]}
              data-state={state}
              style={place}
            >
              {t(name, lang)}
            </span>
          );
        return (
          <button
            key={`name-${String(i)}`}
            type="button"
            className="dkc-row-name dkc-press"
            data-lane={owners[i]}
            data-state={state}
            aria-current={i === now ? "step" : undefined}
            style={place}
            onClick={onPick ? () => onPick(i) : undefined}
            onPointerUp={e => e.currentTarget.blur()}
            tabIndex={onPick ? 0 : -1}
          >
            {t(name, lang)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The journey drawn whole and quiet behind a cover (DESIGN 9.1): the lanes,
 * the seven steps and the unlit line, nothing lit, at 80% in the end half.
 * The same drawing opens the launch deck's journey a week later, where the
 * presenter walks it.
 */
export function FaintLanes({
  dwy = false,
  lang,
}: {
  dwy?: boolean;
  lang: Lang;
}) {
  return (
    <div className="dkc-faint" aria-hidden>
      <JourneyLanes lang={lang} current={-1} dwy={dwy} idle />
    </div>
  );
}

/**
 * The journey in miniature (DESIGN 6.7): at the foot of the launch slides
 * that open one stop, and large and fully lit on the green light.
 */
export function MiniRail({
  lang,
  current,
  dwy,
  all = false,
  scale = 1,
  col: colIn,
  rowGap: rowGapIn,
  end = 400,
  className = "dkc-rail",
  style,
}: {
  lang: Lang;
  current: number;
  dwy: boolean;
  /** Every node and the line lit (the green light). */
  all?: boolean;
  scale?: number;
  /** The step's width and the lanes' gap, when not the scale's. */
  col?: number;
  rowGap?: number;
  /** Room after the last node (for the lit step's name). */
  end?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const owners = journeyOwners(dwy);
  const col = colIn ?? 182 * scale;
  const rowGap = rowGapIn ?? 14 * scale;
  const r = 5 * Math.max(1, scale * 0.8);
  const pts = owners.map((o, i) => ({
    x: 8 + i * col,
    y: 10 * scale + laneIndex(o) * rowGap,
  }));
  const at = pts[current];
  const width = 8 + 6 * col + end;
  const height = 20 * scale + rowGap * 2;
  return (
    <div className={className} style={{ width, height, ...style }} aria-hidden>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {pts.slice(0, -1).map((a, i) => {
          const d = railPath(a, pts[i + 1], col / 2);
          return all ? (
            <path
              key={`r-${String(i)}`}
              d={d}
              {...solid}
              strokeWidth={3 * Math.max(1, scale * 0.7)}
            />
          ) : (
            <path key={`r-${String(i)}`} d={d} {...dotted} />
          );
        })}
        {pts.map((p, i) => (
          <Node
            key={`rn-${String(i)}`}
            x={p.x}
            y={p.y}
            // "You are here" a touch larger than the steps around it.
            r={i === current && !all ? r * 1.3 : r}
            state={
              all
                ? i === pts.length - 1
                  ? "now"
                  : "past"
                : i === current
                  ? "now"
                  : "ahead"
            }
          />
        ))}
      </svg>
      {!all && at ? (
        // Above the line, from the lit node's start edge: it never sits on
        // the rail, so no node or dot after it is covered.
        <span
          className="dkc-rail-name"
          style={{ insetInlineStart: at.x - r, top: at.y - r - 6 }}
        >
          {t(journeyName(current, dwy), lang)}
        </span>
      ) : null}
    </div>
  );
}
