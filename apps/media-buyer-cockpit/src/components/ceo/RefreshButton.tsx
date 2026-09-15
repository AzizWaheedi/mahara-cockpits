import { LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { type SectionKey, useRefresh } from "./useCeo";

/** Recomputes sections in the background; spins for 20 seconds, shared across the page. */
export function RefreshButton({
  only,
  size = "md",
  label = "Refresh",
  className,
}: {
  /** Limit the recompute to these sections; leave out for everything. */
  only?: SectionKey[];
  /** md for the page header, sm inside cards. */
  size?: "sm" | "md";
  /** Button text when idle. */
  label?: string;
  className?: string;
}) {
  const { refresh, busy } = useRefresh();
  return (
    <button
      type="button"
      onClick={() => void refresh(only)}
      disabled={busy}
      aria-busy={busy}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border bg-card font-medium text-foreground transition-colors hover:bg-[var(--ceo-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80",
        size === "md" ? "h-9 px-3.5 text-sm" : "h-8 px-3 text-xs",
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
      <span>{busy ? "Refreshing" : label}</span>
    </button>
  );
}
