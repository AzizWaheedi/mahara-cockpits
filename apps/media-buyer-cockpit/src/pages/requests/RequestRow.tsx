import { StatusChip } from "@/components/ceo/StatusChip";
import {
  dueWord,
  isOpen,
  joinWords,
  type RequestRow,
  stateChip,
  stateHint,
  unfinishedNote,
} from "@/lib/requestsCore";
import { cn } from "@/lib/utils";

/**
 * One request in a list (CONTRACT.md 6.4): the whole row opens it. From
 * `sm` one line: status chip, type, client, due word, owner (from `lg`).
 * Below `sm` the type and the due word share the first line, and the chip
 * and the client the second, so a phone shows the whole type and the whole
 * ClickUp status ("Review required") instead of cutting both, and two
 * requests of one type read apart. A task in ClickUp the cockpit could not
 * finish puts its chip in the warning tone and its note in the row's hint
 * and name, so the row never reads as a clean one.
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
  const unfinished = unfinishedNote(row);
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
        title={stateHint(row)}
        className={cn(
          "grid min-h-11 w-full items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-sm transition-colors sm:px-5",
          "grid-cols-[minmax(0,1fr)_auto]",
          "sm:grid-cols-[8.25rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem]",
          "lg:grid-cols-[8.25rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem_minmax(0,1fr)]",
          "hover:bg-accent/60 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent",
        )}
      >
        <span
          data-cell="state"
          className="relative col-start-1 row-start-2 flex min-w-0 items-center gap-2 sm:row-start-1"
        >
          <StatusChip tone={chip.tone} label={chip.label} />
          {/* On a phone the client follows the chip, so two requests of
              one type read apart; from sm it has its own column. */}
          <bdi
            dir="auto"
            className="min-w-0 truncate text-[13px] text-muted-foreground sm:hidden"
          >
            {row.clientName ?? "No client"}
          </bdi>
          {unfinished ? (
            <span className="sr-only">Not finished: {unfinished}</span>
          ) : null}
        </span>
        <span
          data-cell="type"
          className="col-start-1 row-start-1 min-w-0 break-words font-medium sm:col-start-2 sm:truncate"
        >
          {row.typeLabel}
        </span>
        <bdi
          dir="auto"
          className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:col-start-3 sm:row-start-1 sm:block"
        >
          {row.clientName ?? "No client"}
        </bdi>
        <span
          data-cell="due"
          className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 self-start whitespace-nowrap text-[13px] leading-5 tabular-nums sm:col-start-4 sm:self-center sm:justify-start"
        >
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
        <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground lg:col-start-5 lg:row-start-1 lg:block">
          {owners || "Nobody yet"}
        </span>
      </button>
    </li>
  );
}
