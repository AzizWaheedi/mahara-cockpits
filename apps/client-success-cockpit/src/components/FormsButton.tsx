import { ChevronDown, ClipboardList } from "lucide-react";
import { TypeformMark } from "@/components/AfterCalls";
import { Dot } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openForm } from "@/forms/OpenFormButton";
import { shortDay } from "@/lib/format";
import {
  ENTRY_FAILED,
  entryFailed,
  useCheckinEntry,
  useCheckinNudges,
} from "@/lib/formsRegistry";

/**
 * "Write 1-1 notes", the client header's one form control (docs/forms/
 * STAGE2-CONTRACT.md 8.6, on the Present button's pattern): the main action
 * follows the registry (the Typeform with the card ID until the cut-over,
 * then the cockpit's window), and the menu holds the rest: the call whose
 * notes are missing, the kickoff while it is due, and the cockpit's window
 * as a shadow run for every client-success seat until the cut-over.
 */
export function FormsButton({
  taskId,
  noteMissing,
  lastCall,
  lastCallAt,
  kickoff,
}: {
  taskId: string;
  /** The client's last call has no 1-1 notes yet. */
  noteMissing: boolean;
  /** The last call's Kuwait day ("2026-10-25"). */
  lastCall?: string | null;
  /** Its start, when the call store gave one. */
  lastCallAt?: string | null;
  /** The kickoff is still to fill (the header's old "Fill the kickoff" rule). */
  kickoff: boolean;
}) {
  const entry = useCheckinEntry();
  const call = lastCallAt ?? lastCall ?? null;
  const nudges = useCheckinNudges(
    noteMissing ? [{ taskId, lastCall: call }] : [],
  );
  const nudge = nudges[taskId] ?? { kind: "button" as const };
  const missing = noteMissing && nudge.kind === "button";
  const shadow = entry.mode === "shadow";
  const menu = noteMissing || kickoff || shadow;
  const title = entryFailed(entry)
    ? ENTRY_FAILED
    : entry.provider === "native"
      ? "Opens the 1-1 notes in their own window"
      : "Opens the 1-1 form in Typeform, the record until the switch-over";
  const main = (
    <Button
      size="sm"
      variant="outline"
      className={menu ? "rounded-r-none" : undefined}
      onClick={() => entry.open(taskId, call)}
      title={title}
    >
      <ClipboardList aria-hidden />
      Write 1-1 notes
      {missing ? (
        <Dot tone="warn" label="1-1 notes missing for the last call" />
      ) : null}
      {/* It leaves for Typeform in a new tab until the cut-over. */}
      <TypeformMark entry={entry} />
    </Button>
  );
  if (!menu) return main;
  return (
    <div className="inline-flex items-center">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="rounded-l-none border-l-0 px-2"
            aria-label="More ways to fill this client's forms"
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-80">
          {noteMissing ? (
            nudge.kind === "button" ? (
              <DropdownMenuItem onSelect={() => entry.open(taskId, call)}>
                <Dot tone="warn" />
                {lastCall
                  ? `Missing for the ${shortDay(lastCall)} call`
                  : "Missing for the last call"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuLabel className="text-xs font-normal leading-5 text-muted-foreground">
                {nudge.line}
              </DropdownMenuLabel>
            )
          ) : null}
          {kickoff ? (
            <DropdownMenuItem onSelect={() => void openForm(taskId, "kickoff")}>
              Fill the kickoff
            </DropdownMenuItem>
          ) : null}
          {shadow ? (
            <DropdownMenuItem onSelect={() => entry.openShadow(taskId)}>
              Try the 1-1 notes in the cockpit
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
