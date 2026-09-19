import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./Hint";

export type StatusTone = "good" | "warning" | "serious" | "neutral";

const ICON: Record<StatusTone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  neutral: CircleDashed,
};

/** The CSS color of a tone (for icons and dots only, never body text). */
export const STATUS_COLOR: Record<StatusTone, string> = {
  good: "var(--mc-good)",
  warning: "var(--mc-warning)",
  serious: "var(--mc-serious)",
  neutral: "var(--muted-foreground)",
};

/**
 * A row of small dots showing the last few calls to one system, oldest on the
 * left. A dot is a call: green answered, red failed. The row is what makes a
 * flaky integration visible before it becomes a gap in the memory.
 */
export function HealthDots({
  recent,
  label,
}: {
  recent: { ok: boolean; at: number; detail: string | null }[];
  /** What these calls belong to, read by screen readers. */
  label: string;
}) {
  if (!recent.length) return null;
  const ordered = [...recent].reverse();
  return (
    <span
      role="img"
      aria-label={`${label}: ${ordered.filter(r => r.ok).length} of ${ordered.length} recent calls answered`}
      className="inline-flex items-center gap-1"
    >
      {ordered.map((row, index) => (
        <span
          key={`${row.at}-${index}`}
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: row.ok ? STATUS_COLOR.good : STATUS_COLOR.serious,
          }}
          title={row.ok ? "Answered" : (row.detail ?? "Failed")}
        />
      ))}
    </span>
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
  tone: StatusTone;
  /** Sentence-case label, e.g. "Connected". */
  label: string;
  /** sm for rows and tiles, md for headers. */
  size?: "sm" | "md";
  /** Optional tooltip explaining the status. */
  hint?: string;
  className?: string;
}) {
  const Icon = ICON[tone];
  const cls = cn(
    "inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background/60 font-medium text-foreground",
    size === "sm"
      ? "h-5 px-1.5 text-[11px] leading-none"
      : "h-6 px-2 text-xs leading-none",
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
  return (
    <Hint content={hint}>
      <button
        type="button"
        className={cn(
          cls,
          "cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {inner}
      </button>
    </Hint>
  );
}
