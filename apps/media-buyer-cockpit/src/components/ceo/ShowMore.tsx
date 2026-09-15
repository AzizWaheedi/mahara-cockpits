import { count } from "./format";

/** "Show all 14" and back, under a list that starts short. */
export function ShowMore({
  total,
  expanded,
  onToggle,
}: {
  /** Every item in the list, shown in the button text. */
  total: number;
  /** Whether the whole list is showing. */
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="mt-3 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {expanded ? "Show fewer" : `Show all ${count(total)}`}
    </button>
  );
}
