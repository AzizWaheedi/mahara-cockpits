import type { ReactNode } from "react";
import { Node } from "./JourneyLanes";

/**
 * The road to the first appointments (DESIGN 9.5), drawn in the journey's
 * own marks and the journey's own direction: down the page, one row per
 * step, the nodes on one line (solid teal up to today, dotted after it),
 * today's row on the journey's row band. Each row reads across as a line
 * of an itinerary: the step, then its date (or "Today", or "After
 * go-live") in its own column, and a step's note under its name, never in
 * the date's column. The road is as wide as its words, so today's band
 * lights the row and no empty ground. Rows are evenly spaced (a row with a
 * note is taller by the note): this is an order, not a calendar. The
 * cover's road strip (7.9) is the same order, drawn small and across.
 */

/** One row's height, and a noted row's extra. */
export const ROAD_ROW = 96;
const NOTE_H = 58;
const R = 14;

export interface RoadStop {
  name: ReactNode;
  /** Its date, "Today" or "After go-live". */
  when?: ReactNode;
  /** A note under its name (the launch call's). */
  line?: ReactNode;
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
  const hs = stops.map(s => ROAD_ROW + (s.line ? NOTE_H : 0));
  const tops = hs.map((_, i) => hs.slice(0, i).reduce((a, b) => a + b, 0));
  const H = hs.reduce((a, b) => a + b, 0);
  const x = R + 2;
  // Each node on its step's name line, the first line of its row.
  const y = (i: number) => tops[i] + ROAD_ROW / 2;
  return (
    <div className="dkc-road" style={{ height: H }}>
      <i
        className="dkc-road-band"
        aria-hidden
        style={{ top: tops[now], height: hs[now] }}
      />
      <svg width={x * 2} height={H} viewBox={`0 0 ${x * 2} ${H}`} aria-hidden>
        <path
          d={`M ${x} ${y(now)} L ${x} ${y(n - 1)}`}
          fill="none"
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {now > 0 ? (
          <path
            d={`M ${x} ${y(0)} L ${x} ${y(now)}`}
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
            x={x}
            y={y(i)}
            r={R}
            state={i < now ? "past" : i === now ? "now" : "ahead"}
          />
        ))}
      </svg>
      <ol className="dkc-road-stops">
        {stops.map((s, i) => (
          <li
            key={`stop-${String(i)}`}
            className="dkc-road-stop"
            data-state={i < now ? "past" : i === now ? "now" : "ahead"}
            aria-current={i === now ? "step" : undefined}
            style={{ height: hs[i] }}
          >
            <span className="dkc-road-name">{s.name}</span>
            <span className="dkc-road-when">{s.when ?? null}</span>
            {s.line ? <span className="dkc-road-line">{s.line}</span> : null}
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
