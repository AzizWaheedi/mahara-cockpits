import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The brand's small label as classes, for places a component cannot go (a table cell, a summary). */
export const KICKER =
  "font-mono text-[11px] font-normal uppercase leading-4 tracking-[0.08em] text-muted-foreground";

/**
 * The small label above a title, a number or a group: Geist Mono, 11px,
 * uppercase, muted. Three words at most ("This month", "Last 7 days", "Right
 * now"); a sentence goes in a card's description or behind a disclosure,
 * never in a kicker.
 */
export function Kicker({
  children,
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  /** The element to render; a paragraph by default. */
  as?: "p" | "span" | "div" | "h2" | "h3";
  className?: string;
}) {
  return <Tag className={cn(KICKER, className)}>{children}</Tag>;
}
