import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isNum, money } from "./format";
import { Hint } from "./Hint";

export type StatusTone =
  | "good"
  | "warning"
  | "serious"
  | "critical"
  | "neutral";

const ICON: Record<StatusTone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: OctagonAlert,
  neutral: CircleDashed,
};

/** The CSS color of a status tone (for icons and dots only, never text). */
export const STATUS_COLOR: Record<StatusTone, string> = {
  good: "var(--ceo-good)",
  warning: "var(--ceo-warning)",
  serious: "var(--ceo-serious)",
  critical: "var(--ceo-critical)",
  neutral: "var(--muted-foreground)",
};

/**
 * Tone of a cost against its gate (cost per lead vs $15, cost per booking vs
 * $60): at or under the gate is good, up to 25% over is a warning, beyond is
 * serious. Pass higherIsBetter for rates that must stay above a floor.
 */
export function gateTone(
  value: number | null | undefined,
  gate: number,
  opts: { higherIsBetter?: boolean; warnBand?: number } = {},
): StatusTone {
  if (!isNum(value) || !gate) return "neutral";
  const band = opts.warnBand ?? 0.25;
  const ratio = opts.higherIsBetter
    ? gate / Math.max(value, 1e-9)
    : value / gate;
  if (ratio <= 1) return "good";
  if (ratio <= 1 + band) return "warning";
  return "serious";
}

/** The chip words for a cost against its gate, the same on every tab: "Over $15 gate". */
export function gateLabel(tone: StatusTone, gate: number): string {
  const amount = money(gate);
  if (tone === "good") return `Within ${amount} gate`;
  if (tone === "warning") return `Over ${amount} gate`;
  if (tone === "serious") return `Well over ${amount} gate`;
  return `Gate ${amount}`;
}

/** A 6px status dot beside a value; the value itself stays in text tokens. */
export function StatusDot({
  tone,
  label,
}: {
  tone: StatusTone;
  /** What the dot means, read by screen readers. */
  label: string;
}) {
  // A labelled img, not an sr-only span: DataTable's scroller is not positioned,
  // so an absolute sr-only span in a scrolled-off cell widens the whole page.
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{
        backgroundColor:
          tone === "neutral" ? "var(--ceo-deemphasis)" : STATUS_COLOR[tone],
      }}
    />
  );
}

/** Icon plus label; the color sits on the icon, the text stays in text tokens. */
export function StatusChip({
  tone,
  label,
  size = "sm",
  hint,
  className,
}: {
  /** good, warning, serious, critical or neutral. */
  tone: StatusTone;
  /** Sentence-case label, e.g. "Over gate". */
  label: string;
  /** sm for tables and tiles, md for headers. */
  size?: "sm" | "md";
  /** Optional tooltip explaining the status. */
  hint?: string;
  className?: string;
}) {
  const Icon = ICON[tone];
  const cls = cn(
    "inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border bg-background/60 text-xs font-medium leading-none text-foreground",
    size === "sm" ? "h-5 gap-1 px-1.5" : "h-6 gap-1.5 px-2",
    className,
  );
  const inner = (
    <>
      <Icon
        className={size === "sm" ? "size-3" : "size-3.5"}
        style={{ color: STATUS_COLOR[tone] }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </>
  );
  if (!hint) return <span className={cls}>{inner}</span>;
  // A chip that explains itself stays chip-sized on a phone (no-touch) and
  // takes its tap through an invisible margin around it instead.
  return (
    <Hint content={hint}>
      <button
        type="button"
        className={cn(
          cls,
          "no-touch relative cursor-help after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {inner}
      </button>
    </Hint>
  );
}
