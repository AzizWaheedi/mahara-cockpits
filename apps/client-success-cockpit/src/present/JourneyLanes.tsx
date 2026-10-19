import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  journeyName,
  journeyOwners,
  type L,
  LANES,
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

export const LANE_W = 200;
export const LANE_GAP = 12;
export const ROW_H = 92;
export const HEAD_H = 48;
export const LANES_W = LANE_W * 3 + LANE_GAP * 2;
export const LANES_H = HEAD_H + ROW_H * 7;
/** How far row names may run: x 800 on the canvas, 664 from the lanes. */
export const NAME_END = 664;

const laneIndex = (k: LaneKey) => LANES.indexOf(k);
export const laneX = (k: LaneKey) => laneIndex(k) * (LANE_W + LANE_GAP);
export const nodeX = (k: LaneKey) => laneX(k) + 34;
export const rowY = (i: number) => HEAD_H + ROW_H / 2 + i * ROW_H;

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
  if (state === "now")
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={TEAL} />
        <circle cx={x} cy={y} r={Math.max(2, r * 0.29)} fill={DEEP} />
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
  style?: CSSProperties;
}

/** The journey lanes, at full size (624 x 692 at the canvas's 1:1). */
export function JourneyLanes({
  lang,
  current,
  dwy,
  still,
  fork,
  leaderTo,
  onPick,
  style,
}: LanesProps) {
  const owners = journeyOwners(dwy);
  const pts = owners.map((o, i) => ({ x: nodeX(o), y: rowY(i) }));
  const prev = usePrevious(current);
  const drawing = !still && prev !== undefined && current === prev + 1;
  const at = pts[current];
  const leader =
    leaderTo && at
      ? `M ${at.x} ${at.y + 14} L ${at.x} ${at.y + 22} L ${NAME_END} ${at.y + 22} L ${leaderTo.x} ${leaderTo.y}`
      : null;
  const youX = nodeX("you");
  // The fork (DESIGN 6.2): a no-show goes back to our team's lane; done
  // with you, it stays in the client's lane, on the side away from the
  // names, where the follow-up messages start by themselves.
  const forkEnd = dwy
    ? { x: youX - 22, y: rowY(5) + ROW_H / 2 + 6 }
    : { x: nodeX("us"), y: rowY(6) };
  const forkPath = dwy
    ? `M ${youX - 10} ${rowY(5) + 9} C ${youX - 26} ${rowY(5) + 18} ${forkEnd.x - 8} ${forkEnd.y - 24} ${forkEnd.x} ${forkEnd.y - 11}`
    : `M ${youX} ${rowY(5) + 14} C ${youX} ${rowY(5) + 70} ${forkEnd.x + 40} ${forkEnd.y - 30} ${forkEnd.x} ${forkEnd.y - 11}`;
  return (
    <div
      className="dkc-lanes"
      style={{ width: LANES_W, height: LANES_H, ...style }}
    >
      <svg viewBox={`0 0 ${LANES_W} ${LANES_H}`} aria-hidden>
        {LANES.map(k => (
          <rect
            key={k}
            x={laneX(k)}
            y={40}
            width={LANE_W}
            height={LANES_H - 40}
            rx={12}
            fill="var(--dk-lane)"
          />
        ))}
        <rect
          className="dkc-row-band"
          x={-12}
          y={0}
          width={LANES_W + 24}
          height={ROW_H}
          rx={12}
          fill="var(--dk-teal-faint)"
          style={{ transform: `translateY(${rowY(current) - ROW_H / 2}px)` }}
        />
        {pts.slice(0, -1).map((a, i) => {
          const b = pts[i + 1];
          const d = segmentPath(a, b);
          const lit = i < current;
          const handover = a.x !== b.x;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <g key={`seg-${String(i)}`}>
              <path d={d} {...dotted} />
              {lit ? (
                <path
                  key={drawing && i === current - 1 ? `draw-${current}` : "lit"}
                  d={d}
                  {...solid}
                  pathLength={1}
                  className={
                    drawing && i === current - 1 ? "dkc-draw" : undefined
                  }
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
        {fork ? (
          <g>
            <path d={forkPath} {...dotted} stroke={TEAL} />
            <circle
              cx={forkEnd.x}
              cy={forkEnd.y}
              r={10}
              fill={GROUND}
              stroke={TEAL}
              strokeWidth={2}
            />
            <path
              d={`M ${forkEnd.x - 4} ${forkEnd.y - 3} A 4.5 4.5 0 1 1 ${forkEnd.x - 3.5} ${forkEnd.y + 3}`}
              fill="none"
              stroke={TEAL}
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
            <circle cx={leaderTo?.x} cy={leaderTo?.y} r={3} fill={STRONG} />
          </g>
        ) : null}
        {pts.map((p, i) => (
          <Node
            key={`n-${String(i)}`}
            x={p.x}
            y={p.y}
            r={14}
            state={i < current ? "past" : i === current ? "now" : "ahead"}
          />
        ))}
        {at && leader ? (
          <circle cx={at.x} cy={at.y + 22} r={3} fill={TEAL} />
        ) : null}
      </svg>
      {LANES.map(k => (
        <span
          key={k}
          className="dkc-lane-head"
          data-lane={k}
          style={{ insetInlineStart: laneX(k) + 20 }}
        >
          {t(SHARED.lane[k], lang)}
        </span>
      ))}
      {pts.map((p, i) => {
        const name: L = journeyName(i, dwy);
        const left = p.x + 30;
        return (
          <button
            key={`name-${String(i)}`}
            type="button"
            className="dkc-row-name dkc-press"
            data-state={i < current ? "past" : i === current ? "now" : "ahead"}
            aria-current={i === current ? "step" : undefined}
            style={{
              insetInlineStart: left,
              top: p.y,
              maxWidth: NAME_END - left,
            }}
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
 * The lanes drawn large and faint behind a cover (DESIGN 9.1): the bands
 * and the unlit dotted line only, never lit, no nodes, in the end half,
 * running off the foot of the slide. The same drawing opens the launch
 * deck's journey a week later.
 */
export function FaintLanes({ dwy = false }: { dwy?: boolean }) {
  const owners = journeyOwners(dwy);
  const w = 220;
  const gap = 14;
  const lx = (k: LaneKey) => laneIndex(k) * (w + gap) + 38;
  const pts = owners.map((o, i) => ({ x: lx(o), y: 70 + i * 104 }));
  return (
    <div className="dkc-faint" aria-hidden>
      <svg
        viewBox="0 0 688 780"
        preserveAspectRatio="xMinYMin meet"
        aria-hidden
      >
        {LANES.map(k => (
          <rect
            key={k}
            x={laneIndex(k) * (w + gap)}
            y={0}
            width={w}
            height={860}
            rx={14}
            fill="var(--dk-lane)"
          />
        ))}
        {pts.slice(0, -1).map((a, i) => (
          <path
            key={`f-${String(i)}`}
            d={segmentPath(a, pts[i + 1], 52)}
            {...dotted}
          />
        ))}
      </svg>
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
            r={r}
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
        <span
          className="dkc-rail-name"
          style={{ insetInlineStart: at.x + 18, top: at.y }}
        >
          {t(journeyName(current, dwy), lang)}
        </span>
      ) : null}
    </div>
  );
}
