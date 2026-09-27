import { LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SectionKey, useRefresh } from "./useCeo";

/** Recomputes sections in the background; spins for 20 seconds, shared across the page. */
export function RefreshButton({
  only,
  size = "md",
  label = "Refresh",
  compact = false,
  className,
}: {
  /** Limit the recompute to these sections; leave out for everything. */
  only?: SectionKey[];
  /** md for the page header, sm inside cards. */
  size?: "sm" | "md";
  /** Button text when idle. */
  label?: string;
  /** Icon only on a phone, the label from the small tablet size up. */
  compact?: boolean;
  className?: string;
}) {
  const { refresh, busy } = useRefresh();
  return (
    <button
      type="button"
      onClick={() => void refresh(only)}
      disabled={busy}
      aria-busy={busy}
      aria-label={busy ? "Refreshing" : label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border bg-card font-medium text-foreground transition-colors hover:bg-[var(--ceo-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80",
        size === "md" ? "h-9 px-3.5 text-sm" : "h-8 px-3 text-xs",
        compact && "size-10 px-0 sm:h-9 sm:w-auto sm:px-3.5",
        className,
      )}
    >
      {busy ? (
        <LoaderCircle
          className="ceo-spin size-4 animate-spin text-[color:var(--ceo-emphasis)]"
          aria-hidden
        />
      ) : (
        <RefreshCw
          className="size-4 text-[color:var(--ceo-emphasis)]"
          aria-hidden
        />
      )}
      <span className={compact ? "hidden sm:inline" : undefined}>
        {busy ? "Refreshing" : label}
      </span>
    </button>
  );
}
