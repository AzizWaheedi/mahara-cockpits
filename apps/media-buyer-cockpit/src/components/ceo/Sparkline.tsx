import { type PointerEvent, useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { isNum } from "./format";
import { useWidth } from "./useWidth";

type Pt = { i: number; x: number; y: number; v: number };

/**
 * A plain SVG trend: 2px emphasis line over a 10% wash, an end dot with a
 * surface ring. Pass `labels` and `format` to get a hover readout with a
 * crosshair; without them it is a quiet glyph for stat tiles.
 */
export function Sparkline({
  values,
  labels,
  format,
  height = 36,
  area = true,
  ariaLabel,
  className,
}: {
  /** Oldest first; null breaks the line. */
  values: (number | null | undefined)[];
  /** One label per value (e.g. formatted dates); enables the hover readout. */
  labels?: string[];
  /** Formats the hovered value. */
  format?: (v: number) => string;
  /** Height in px; the width follows the container. */
  height?: number;
  /** Draw the wash under the line. */
  area?: boolean;
  /** Screen reader summary, e.g. "Cash per day, last 90 days, rising". */
  ariaLabel?: string;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const pad = 5;

  const geo = useMemo(() => {
    const nums = values.filter(isNum);
    if (width <= 0 || nums.length === 0) return null;
    const min = Math.min(0, ...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const n = values.length;
    const innerW = Math.max(1, width - pad * 2);
    const innerH = Math.max(1, height - pad * 2);
    const xAt = (i: number) =>
      pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => pad + innerH - ((v - min) / span) * innerH;
    const segments: Pt[][] = [];
    let cur: Pt[] = [];
    values.forEach((v, i) => {
      if (isNum(v)) cur.push({ i, x: xAt(i), y: yAt(v), v });
      else if (cur.length) {
        segments.push(cur);
        cur = [];
      }
    });
    if (cur.length) segments.push(cur);
    const baseY = yAt(Math.max(min, 0));
    const lines = segments.map(s =>
      s
        .map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(""),
    );
    const areas = segments.map(
      (s, k) =>
        `${lines[k]}L${s[s.length - 1].x.toFixed(1)},${baseY.toFixed(1)}L${s[0].x.toFixed(1)},${baseY.toFixed(1)}Z`,
    );
    const points = segments.flat();
    return { lines, areas, points, last: points[points.length - 1], xAt };
  }, [values, width, height]);

  const interactive = Boolean(labels && format && geo);
  const active =
    hover !== null && geo
      ? (geo.points.find(p => p.i === hover) ?? null)
      : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo || !interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best: Pt | null = null;
    for (const p of geo.points)
      if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    setHover(best ? best.i : null);
  };

  const marker = active ?? geo?.last ?? null;

  return (
    <div
      ref={ref}
      className={cn("relative w-full min-w-0", className)}
      style={{ height }}
    >
      {geo ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block overflow-visible"
          onPointerMove={interactive ? onMove : undefined}
          onPointerLeave={interactive ? () => setHover(null) : undefined}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={width} height={height} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {area
              ? geo.areas.map((d, k) => (
                  <path key={`a${k}`} d={d} fill="var(--ceo-emphasis-wash)" />
                ))
              : null}
            {geo.lines.map((d, k) => (
              <path
                key={`l${k}`}
                d={d}
                fill="none"
                stroke="var(--ceo-emphasis)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
          {active ? (
            <line
              x1={active.x}
              x2={active.x}
              y1={0}
              y2={height}
              stroke="var(--ceo-crosshair)"
              strokeWidth={1}
            />
          ) : null}
          {marker ? (
            <circle
              cx={marker.x}
              cy={marker.y}
              r={4}
              fill="var(--ceo-emphasis)"
              stroke="var(--ceo-surface)"
              strokeWidth={4}
              paintOrder="stroke"
            />
          ) : null}
        </svg>
      ) : null}
      {active && labels && format ? (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-sm dark:shadow-none"
          style={{
            left: Math.min(Math.max(active.x, 48), Math.max(48, width - 48)),
          }}
        >
          <span className="font-semibold tabular-nums text-foreground">
            {format(active.v)}
          </span>
          <span className="ml-1.5 text-muted-foreground">
            {labels[active.i]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
