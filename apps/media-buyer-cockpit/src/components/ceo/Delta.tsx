import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  direction,
  isNum,
  signedCount,
  signedMoney,
  signedPct,
  signedPoints,
} from "./format";

export type DeltaKind = "pct" | "money" | "count" | "points";
export type GoodWhen = "up" | "down" | "neither";

const SIGNED: Record<DeltaKind, (v: number) => string> = {
  pct: signedPct,
  money: signedMoney,
  count: signedCount,
  points: signedPoints,
};

/**
 * A signed change with an arrow, colored by direction and by whether that
 * direction is good news. Renders nothing when there is nothing to compare.
 */
export function Delta({
  value,
  kind = "pct",
  goodWhen = "up",
  vs,
  size = "sm",
  className,
}: {
  /** The change: a fraction for pct (0.12 is +12%), an amount for money and count, a fraction difference for points. */
  value: number | null | undefined;
  /** How to print the change. */
  kind?: DeltaKind;
  /** Which direction is good news; "neither" keeps it neutral. */
  goodWhen?: GoodWhen;
  /** The named comparison period, e.g. "vs last month". */
  vs?: string;
  /** sm for tiles and tables, md next to the hero figure. */
  size?: "sm" | "md";
  className?: string;
}) {
  if (!isNum(value)) return null;
  const dir = direction(
    value,
    kind === "pct" || kind === "points" ? 0.0005 : 0,
  );
  const good =
    dir === "flat" || goodWhen === "neither"
      ? null
      : (dir === "up") === (goodWhen === "up");
  const color =
    good === null
      ? "var(--ceo-delta-neutral)"
      : good
        ? "var(--ceo-delta-good)"
        : "var(--ceo-delta-bad)";
  const Arrow =
    dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  const text = SIGNED[kind](value);
  const spoken = `${dir === "flat" ? "flat" : dir === "up" ? "up" : "down"} ${text.replace(/^[+−]/, "")}${vs ? ` ${vs}` : ""}${good === null ? "" : good ? ", good" : ", needs attention"}`;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      <span
        className="inline-flex items-center gap-0.5 font-medium tabular-nums"
        style={{ color }}
        aria-hidden
      >
        <Arrow className={size === "sm" ? "size-3.5" : "size-4"} />
        {text}
      </span>
      {vs ? (
        <span className="text-muted-foreground" aria-hidden>
          {vs}
        </span>
      ) : null}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
