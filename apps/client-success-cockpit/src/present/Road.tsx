import type { CSSProperties, ReactNode } from "react";
import { Node } from "./JourneyLanes";

/**
 * The route to the first appointments (DESIGN 9.5, 22.2.5): one straight
 * line in the journey's own marks, six stops evenly spaced, lit from the
 * first stop to today. No bends: a crest near today read as a road running
 * downhill to the launch. Every label sits below its stop, from the stop's
 * start edge, as a drawing's callout does; the last stop keeps a column's
 * room after it, so its label starts at its node too (an end-aligned last
 * label collided with the launch call's). Nodes are evenly spaced: this is
 * an order, not a calendar.
 *
 * On arrival the lit line draws to today on --dk-ease-move, the token
 * riding its head; each passed stop's check draws as the line reaches it,
 * today fills as the token arrives, then "Today" fades in. Then nothing
 * moves. Under --dk-m 0 every state is set at once.
 */

const R = 16;

export interface RouteStop {
  name: ReactNode;
  /** Its date, "Today", "After go-live", or the launch call's length. */
  when?: ReactNode;
  /** A note under its caption, in its own column (the launch call's). */
  line?: ReactNode;
  /**
   * The stop hangs what follows it (the road's payoff, O5's confirmation):
   * a dotted line drops from its caption to the card under it (22.14).
   */
  drop?: boolean;
}

/** The easing --dk-ease-move, so a check's delay meets the line's head. */
const EASE = [0.65, 0, 0.35, 1] as const;

/** The time share at which an eased move reaches a share of its length. */
export function timeAt(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = EASE;
  const bez = (s: number, a: number, b: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, y1, y2) < progress) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, x1, x2);
}

/**
 * The draw's length in ms for today at index k: min(1400, 600 + 240 k)
 * since 22.14 (the stops light one by one, slowly enough to be seen on a
 * share; 400 + 160 k read as a flicker).
 */
export const routeMs = (k: number) => Math.min(1400, 600 + 240 * k);

export function Route({
  stops,
  now,
  still,
  width = 1648,
}: {
  stops: RouteStop[];
  /** Today's stop, from 0. */
  now: number;
  still?: boolean;
  /** The route's width (the content's, on the slide). */
  width?: number;
}) {
  const n = stops.length;
  const last = 300;
  const gap = (width - last) / (n - 1);
  const x = (i: number) => R + 2 + i * gap;
  const y = R + 6;
  const H = y * 2;
  const cols = `repeat(${n - 1}, ${gap}px) ${last}px`;
  const state = (i: number) => (i < now ? "past" : i === now ? "now" : "ahead");
  const ms = routeMs(now);
  const len = x(now) - x(0);
  // Every timing is written against --dk-m, so the still frame and reduced
  // motion are the end state.
  const at = (share: number) =>
    `calc(${Math.round(timeAt(share) * ms)}ms * var(--dk-m))`;
  const draw = `calc(${ms}ms * var(--dk-m))`;
  return (
    <div
      className="dkc-way"
      style={{ width }}
      data-still={still ? "" : undefined}
    >
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden>
        {now < n - 1 ? (
          <path
            className="dkc-way-ahead"
            d={`M ${x(now)} ${y} L ${x(n - 1)} ${y}`}
          />
        ) : null}
        {now > 0 ? (
          <path
            className="dkc-way-lit"
            d={`M ${x(0)} ${y} L ${x(now)} ${y}`}
            pathLength={1}
            style={{ animationDuration: draw }}
          />
        ) : null}
        {stops.map((_, i) => {
          const st = state(i);
          const key = `route-${String(i)}`;
          if (st === "ahead")
            // The stops ahead appear one by one along the road (22.14).
            return (
              <g
                key={key}
                className="dkc-way-next"
                style={{ "--i": i } as CSSProperties}
              >
                <Node x={x(i)} y={y} r={R} state="ahead" />
              </g>
            );
          if (st === "now")
            // Today: an open ring the token fills as it arrives.
            return (
              <g key={key} className="dkc-way-today">
                <Node x={x(i)} y={y} r={R} state="ahead" />
                <g
                  className="dkc-way-fill"
                  style={{ animationDelay: now > 0 ? draw : "0s" }}
                >
                  <Node x={x(i)} y={y} r={R} state="now" />
                </g>
              </g>
            );
          // Passed: its check draws as the line reaches it.
          const share = len > 0 ? (x(i) - x(0)) / len : 0;
          return (
            <g key={key} className="dkc-way-past">
              <Node x={x(i)} y={y} r={R} state="ahead" />
              <g
                className="dkc-way-pass"
                style={
                  {
                    "--way-at": at(share),
                  } as CSSProperties
                }
              >
                <Node x={x(i)} y={y} r={R} state="past" />
              </g>
            </g>
          );
        })}
        {now > 0 ? (
          // The token rides the line's head, one duration and one easing
          // with it, and is absorbed as today fills.
          <g
            className="dkc-way-token"
            style={
              {
                "--way-from": `${x(0)}px`,
                "--way-to": `${x(now)}px`,
                animationDuration: `${draw}, calc(var(--dk-t-tick) * var(--dk-m))`,
                animationDelay: `0s, ${draw}`,
              } as CSSProperties
            }
          >
            <circle cx={0} cy={y} r={9} />
          </g>
        ) : null}
      </svg>
      <ol className="dkc-road-stops" style={{ gridTemplateColumns: cols }}>
        {stops.map((s, i) => (
          <li
            key={`stop-${String(i)}`}
            className="dkc-road-stop"
            data-state={state(i)}
            aria-current={i === now ? "step" : undefined}
            style={{ "--i": i } as CSSProperties}
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
                style={{
                  gridColumn: i + 1,
                  gridRow: 2,
                  ...(i === now && now > 0
                    ? { animationDelay: draw }
                    : undefined),
                }}
              >
                {s.when}
              </span>
            ) : null}
            {s.line ? (
              // In its own column (score round 2): run on to the content's
              // end, it read as the next stop's line.
              <span
                className="dkc-road-line"
                style={{ gridColumn: i + 1, gridRow: 3 }}
              >
                {s.line}
              </span>
            ) : s.drop ? (
              <i
                className="dkc-road-drop"
                aria-hidden
                style={{ gridColumn: i + 1, gridRow: 3 }}
              />
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
          Arabic, so the inline start is the node's side either way); under
          the last node, ending at it, so the label stays under the rail. */}
      <span
        className="dkc-roadstrip-label"
        style={
          now >= count - 1
            ? { alignSelf: "flex-end" }
            : { marginInlineStart: x(now) - r }
        }
      >
        {label}
      </span>
    </div>
  );
}
