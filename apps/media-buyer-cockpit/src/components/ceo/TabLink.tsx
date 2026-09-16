import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The quiet link in a card header that opens the tab holding the detail behind
 * the number. Every rollup card uses this one, so the way a reader gets from a
 * headline to its department looks the same everywhere.
 *
 * Generic over the tab key so the shared kit does not have to know the tab
 * list; the page passes its own `goTab`.
 */
export function TabLink<K extends string>({
  tab,
  label,
  goTab,
  className,
}: {
  /** The tab to open, e.g. "marketing". */
  tab: K;
  /** The tab's name as the reader sees it in the tab bar. */
  label: string;
  goTab: (tab: K) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => goTab(tab)}
      aria-label={`Open the ${label} tab`}
      className={cn(
        "-my-1 inline-flex h-6 items-center gap-0.5 rounded-md pl-1.5 pr-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--ceo-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {label}
      <ChevronRight className="size-3.5" aria-hidden />
    </button>
  );
}
