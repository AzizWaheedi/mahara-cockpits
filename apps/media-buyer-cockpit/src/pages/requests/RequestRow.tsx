import { StatusChip } from "@/components/ceo/StatusChip";
import {
  dueWord,
  isOpen,
  joinWords,
  type RequestRow,
  stateChip,
  stateWords,
} from "@/lib/requestsCore";
import { cn } from "@/lib/utils";

/**
 * One request in a list (CONTRACT.md 6.4): one line, the whole row opens
 * it. Status chip, type, client, due word, owner; below `sm` only the chip,
 * the type and the due word, so nothing wraps on a phone.
 */
export function RequestRowItem({
  row,
  onOpen,
  today,
}: {
  row: RequestRow;
  onOpen: (id: string) => void;
  /** Kuwait today, YYYY-MM-DD (passed in so a list agrees with itself). */
  today?: string;
}) {
  const chip = stateChip(row);
  const due = dueWord(row.dueOn, isOpen(row), today);
  const owners = joinWords(
    row.parts
      .map(p => p.owner.label)
      .filter((x, i, a) => x && a.indexOf(x) === i),
  );
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        title={stateWords(row)}
        className={cn(
          "grid min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors sm:px-5",
          "grid-cols-[6.75rem_minmax(0,1fr)_auto]",
          "sm:grid-cols-[8.25rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem]",
          "lg:grid-cols-[8.25rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem_minmax(0,1fr)]",
          "hover:bg-accent/60 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent",
        )}
      >
        <span className="min-w-0">
          <StatusChip tone={chip.tone} label={chip.label} />
        </span>
        <span className="min-w-0 truncate font-medium">{row.typeLabel}</span>
        <bdi
          dir="auto"
          className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:block"
        >
          {row.clientName ?? "No client"}
        </bdi>
        <span className="flex items-center justify-end gap-1.5 whitespace-nowrap text-[13px] tabular-nums sm:justify-start">
          {due.tone !== "none" ? (
            <span
              role="img"
              aria-label={due.tone === "late" ? "Late" : "Due today"}
              className="inline-block size-1.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  due.tone === "late" ? "var(--destructive)" : "var(--warning)",
              }}
            />
          ) : null}
          {due.text || (
            <span className="text-muted-foreground">No due day</span>
          )}
        </span>
        <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground lg:block">
          {owners || "Nobody yet"}
        </span>
      </button>
    </li>
  );
}
