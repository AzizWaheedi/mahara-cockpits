import type { ReactNode } from "react";
import { Node } from "./JourneyLanes";

/**
 * The road to the first appointments (DESIGN 9.5), drawn in the journey's
 * own marks across the content's whole width: six nodes evenly spaced on
 * one line (solid teal up to today, dotted after it), as the cover's road
 * strip draws it small. Each step's name starts at its node's start edge,
 * as a drawing's callout does, with what is known under it: its date,
 * "Today", "After go-live", or how long the launch call takes. A step's
 * note (the launch call's) sits under its caption and may run on to the
 * content's end, under the steps after it, which carry one line. Nodes are
 * evenly spaced: this is an order, not a calendar.
 */

const R = 16;

export interface RoadStop {
  name: ReactNode;
  /** Its date, "Today", "After go-live", or the launch call's length. */
  when?: ReactNode;
  /** A note under its caption (the launch call's). */
  line?: ReactNode;
}

export function Road({
  stops,
  now,
  still,
  width = 1648,
  draw = true,
}: {
  stops: RoadStop[];
  /** The lit stop, from 0. */
  now: number;
  still?: boolean;
  /** The road's width (the content's, on the slide). */
  width?: number;
  /** Draw the lit line on arrival. */
  draw?: boolean;
}) {
  const n = stops.length;
  // Evenly spaced nodes; the last step's words keep a column's room after
  // its node ("First appointments" on one line).
  const last = 300;
  const gap = (width - last) / (n - 1);
  const x = (i: number) => R + 2 + i * gap;
  const y = R + 2;
  const H = y * 2;
  const cols = `repeat(${n - 1}, ${gap}px) ${last}px`;
  const state = (i: number) => (i < now ? "past" : i === now ? "now" : "ahead");
  // One grid for the words: the names on one row, what is known under them
  // on the next, and a step's note on a third, from its own column to the
  // content's end, so a wrapped name never pushes a caption into a note.
  return (
    <div className="dkc-road" style={{ width }}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden>
        <path
          d={`M ${x(now)} ${y} L ${x(n - 1)} ${y}`}
          fill="none"
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {now > 0 ? (
          <path
            d={`M ${x(0)} ${y} L ${x(now)} ${y}`}
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
            state={state(i)}
          />
        ))}
      </svg>
      <ol className="dkc-road-stops" style={{ gridTemplateColumns: cols }}>
        {stops.map((s, i) => (
          <li
            key={`stop-${String(i)}`}
            className="dkc-road-stop"
            data-state={state(i)}
            aria-current={i === now ? "step" : undefined}
          >
            <span
              className="dkc-road-name"
              style={{ gridColumn: i + 1, gridRow: 1 }}
            >
              {s.name}
            </span>
            {s.when ? (
              <span
                className="dkc-road-when"
                style={{ gridColumn: i + 1, gridRow: 2 }}
              >
                {s.when}
              </span>
            ) : null}
            {s.line ? (
              <span
                className="dkc-road-line"
                style={{ gridColumn: `${i + 1} / -1`, gridRow: 3 }}
              >
                {s.line}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The road at 40%, under the launch cover's date (DESIGN 7.9): the lit
 * node's name under that node, starting at it, and no other words. The
 * strip's end is the road's own (first appointments), left unnamed, so it
 * never reads as today or as go-live.
 */
export function RoadStrip({
  count = 6,
  now,
  label,
}: {
  count?: number;
  now: number;
  /** The lit node's name ("Launch call · Today"). */
  label?: ReactNode;
}) {
  const gap = 120;
  const r = 6;
  const x = (i: number) => r + 2 + i * gap;
  const y = r + 2;
  const end = x(count - 1);
  const svg = (
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
  if (!label) return svg;
  return (
    <div className="dkc-roadstrip-fig">
      {svg}
      {/* Under the lit node, from its start edge (the strip mirrors in
          Arabic, so the inline start is the node's side either way). */}
      <span
        className="dkc-roadstrip-label"
        style={{ marginInlineStart: x(now) - r }}
      >
        {label}
      </span>
    </div>
  );
}
