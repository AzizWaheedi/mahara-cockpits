import type { ReactNode } from "react";
import { Node } from "./JourneyLanes";

/**
 * The road to the first appointments (DESIGN 9.5), drawn in the journey's
 * own marks rather than as a web stepper: nodes evenly spaced (this is an
 * order, not a calendar), the lit line in solid teal up to today and the
 * dotted line after it, each label starting at its node's inline-start
 * edge, as a drawing's callout does. The cover's road strip (7.9) is this
 * drawing at 40%, without its words.
 */

/** The slide's content width (1920 less the 136 px margins). */
export const ROAD_W = 1648;
/** A stop's label column, from its node's inline-start edge. */
export const STOP_W = 272;
/** The road's box: the nodes on its top line, the labels under them. */
export const ROAD_H = 260;
const R = 14;

export interface RoadStop {
  name: ReactNode;
  /** Under the name: "Today", a date, a line. */
  under?: ReactNode;
}

export function Road({
  stops,
  now,
  still,
  draw = true,
}: {
  stops: RoadStop[];
  /** The lit stop, from 0. */
  now: number;
  still?: boolean;
  /** Draw the lit line on arrival. */
  draw?: boolean;
}) {
  const n = stops.length;
  // Evenly spaced so the last label's column ends on the content's end
  // edge, never past the margin.
  const gap = (ROAD_W - STOP_W) / Math.max(1, n - 1);
  const x = (i: number) => R + i * gap;
  const y = R + 6;
  const end = x(n - 1);
  const lit = x(now);
  return (
    <div className="dkc-road" style={{ width: ROAD_W, height: ROAD_H }}>
      <svg viewBox={`0 0 ${ROAD_W} ${ROAD_H}`} aria-hidden>
        <path
          d={`M ${lit} ${y} L ${end} ${y}`}
          fill="none"
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {now > 0 ? (
          <path
            d={`M ${x(0)} ${y} L ${lit} ${y}`}
            fill="none"
            stroke="var(--dk-teal)"
            strokeWidth={3}
            strokeLinecap="round"
            pathLength={1}
            className={draw && !still ? "dkc-draw" : undefined}
          />
        ) : null}
        {stops.map((_, i) => (
          <Node
            key={`road-${String(i)}`}
            x={x(i)}
            y={y}
            r={R}
            state={i < now ? "past" : i === now ? "now" : "ahead"}
          />
        ))}
      </svg>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {stops.map((s, i) => (
          <li
            key={`stop-${String(i)}`}
            className="dkc-road-stop"
            data-state={i < now ? "past" : i === now ? "now" : "ahead"}
            aria-current={i === now ? "step" : undefined}
            style={{ insetInlineStart: x(i) - R, width: STOP_W }}
          >
            <span className="dkc-road-name">{s.name}</span>
            {s.under}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The road at 40%, no words: under the launch cover's date (DESIGN 7.9). */
export function RoadStrip({ count = 6, now }: { count?: number; now: number }) {
  const gap = 120;
  const r = 6;
  const x = (i: number) => r + 2 + i * gap;
  const y = r + 2;
  const end = x(count - 1);
  return (
    <svg
      width={end + r + 2}
      height={y * 2}
      viewBox={`0 0 ${end + r + 2} ${y * 2}`}
      aria-hidden
      className="dkc-roadstrip"
    >
      <path
        d={`M ${x(now)} ${y} L ${end} ${y}`}
        fill="none"
        stroke="var(--dk-line-strong)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="2 6"
      />
      <path
        d={`M ${x(0)} ${y} L ${x(now)} ${y}`}
        fill="none"
        stroke="var(--dk-teal)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {Array.from({ length: count }, (_, i) => (
        <Node
          key={`s-${String(i)}`}
          x={x(i)}
          y={y}
          r={r}
          state={i < now ? "past" : i === now ? "now" : "ahead"}
        />
      ))}
    </svg>
  );
}
