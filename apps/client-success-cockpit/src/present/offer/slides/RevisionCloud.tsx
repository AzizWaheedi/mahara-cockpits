import { cloudPath } from "../art/icons";
import type { CaptureMark } from "../useOffer";
export function RevisionCloud({
  mark = { x: 0.05, y: 0.08, w: 0.9, h: 0.8 },
  revision = "A",
  on = true,
}: {
  mark?: CaptureMark;
  revision?: "A" | "B";
  on?: boolean;
}) {
  const path = cloudPath(
    mark.x * 1000,
    mark.y * 600,
    (mark.x + mark.w) * 1000,
    (mark.y + mark.h) * 600,
    28,
  );
  return (
    <svg
      className={`dko-cloud dko-cloud-${revision}`}
      viewBox="0 0 1000 600"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-on={on}
    >
      <path className="dko-cloud-under" d={path} pathLength="1" />
      <path d={path} pathLength="1" />
      <g
        transform={`translate(${Math.min(950, (mark.x + mark.w) * 1000)},${Math.min(550, (mark.y + mark.h) * 600)})`}
      >
        <path className="dko-cloud-under" d="M0 0L30 48H-30Z" />
        <path className="dko-cloud-tag" d="M0 0L30 48H-30Z" />
        <text x="0" y="35" textAnchor="middle">
          {revision}
        </text>
      </g>
    </svg>
  );
}
