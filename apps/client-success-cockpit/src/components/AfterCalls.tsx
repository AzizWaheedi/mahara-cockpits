import { ArrowUpRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Dot, SectionCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { kuwaitWeekday } from "@/forms/checkinRail";
import {
  type CheckinEntry,
  useCheckinEntry,
  useCheckinNudges,
} from "@/lib/formsRegistry";

/**
 * Today's "After your calls" (docs/forms/STAGE2-CONTRACT.md 8.6): the
 * clients whose last call has no 1-1 notes yet, newest call first, five at
 * most until "See all". Onboarding and Blueprint calls have their own forms
 * and are left out. Hidden when there is nothing and every read worked; a
 * call store that could not be read says so, because missing is never zero.
 *
 * After the Typeform opens for a client, its row says so for 30 minutes
 * instead of offering the form again, and a form Typeform already holds for
 * that call reads as sent (src/lib/formsRegistry.ts).
 */

/** A snapshot row: untyped by design, like the rest of the CSM screens. */
type Client = any;

const OWN_FORMS = new Set(["onboarding", "blueprint"]);
const CALL_WORD: Record<string, string> = {
  checkin: "check-in call",
  launch: "launch call",
};

/** The call this row is about, as the nudges key it. */
const callOf = (c: Client): string | null =>
  (c.lastCallAt as string | undefined) ??
  (c.lastCall as string | undefined) ??
  null;

/** "Sun 25 Oct" for a Kuwait day or an instant. */
const dayOf = (v: string | null) =>
  v
    ? kuwaitWeekday(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T09:00:00+03:00` : v)
    : "";

/**
 * The external-link mark (docs/DESIGN.md: one trailing ArrowUpRight) on a
 * "Write 1-1 notes" while it leaves the cockpit for Typeform in a new tab;
 * once the registry says native it opens the cockpit's own window, unmarked.
 */
export function TypeformMark({ entry }: { entry: CheckinEntry }) {
  return entry.provider === "native" ? null : (
    <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
  );
}

/** The clients the card lists: notes missing for a call that takes 1-1 notes. */
export function afterCallRows(clients: Client[] | undefined): Client[] {
  return (clients ?? [])
    .filter(
      c =>
        c?.noteMissing &&
        c.lastCall &&
        !OWN_FORMS.has(String(c.lastCallKind ?? "")),
    )
    .sort(
      (a, b) =>
        Date.parse(String(callOf(b))) - Date.parse(String(callOf(a))) ||
        String(a.name).localeCompare(String(b.name)),
    );
}

/**
 * "Write 1-1 notes" for one client, wherever it is offered as a nudge (the
 * Message panel, Loose ends): the button, or the line that says the form is
 * opened or sent.
 */
export function NotesNudge({
  taskId,
  lastCall,
  children,
  className,
  variant = "link",
}: {
  taskId: string;
  lastCall?: string | null;
  children: ReactNode;
  className?: string;
  variant?: "link" | "button";
}) {
  const entry = useCheckinEntry();
  const nudge = useCheckinNudges([{ taskId, lastCall }])[taskId];
  if (nudge && nudge.kind !== "button")
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {nudge.line}
      </span>
    );
  if (variant === "button")
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => entry.open(taskId, lastCall ?? null)}
      >
        {children}
        <TypeformMark entry={entry} />
      </Button>
    );
  return (
    <button
      type="button"
      className={className}
      onClick={() => entry.open(taskId, lastCall ?? null)}
    >
      {children}
      <TypeformMark entry={entry} />
    </button>
  );
}

export function AfterCalls({
  snap,
}: {
  snap:
    | { clients?: Client[]; callStoreError?: string | null }
    | null
    | undefined;
}) {
  const entry = useCheckinEntry();
  const rows = useMemo(() => afterCallRows(snap?.clients), [snap?.clients]);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  // "See all" takes itself away: focus goes to the first row it showed.
  const firstMore = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (all) firstMore.current?.focus();
  }, [all]);
  const nudges = useCheckinNudges(
    shown.map(c => ({ taskId: String(c.taskId), lastCall: callOf(c) })),
  );
  const failed = Boolean(snap?.callStoreError);
  if (!rows.length && !failed) return null;
  return (
    <SectionCard
      title="After your calls"
      count={rows.length || undefined}
      flush
    >
      {failed ? (
        <p className="flex gap-2 px-4 py-3 text-xs sm:px-6" role="note">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">
            The call store could not be read, so missing notes may be
            undercounted.
          </span>
        </p>
      ) : null}
      {shown.map((c, i) => {
        const id = String(c.taskId);
        const nudge = nudges[id] ?? { kind: "button" as const };
        const kind = CALL_WORD[String(c.lastCallKind ?? "")] ?? "call";
        return (
          <div
            key={id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6"
          >
            <div className="min-w-0">
              <Link
                ref={i === 5 ? firstMore : undefined}
                to={`/clients/${encodeURIComponent(id)}`}
                className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink"
                dir="auto"
              >
                {c.name}
              </Link>
              <span className="text-muted-foreground">
                {` · ${kind} on ${dayOf(callOf(c))} · no 1-1 notes`}
              </span>
            </div>
            {nudge.kind === "button" ? (
              <Button
                size="sm"
                variant="outline"
                // Five rows of the same words: the name says whose notes.
                aria-label={`Write 1-1 notes for ${c.name}`}
                onClick={() => entry.open(id, callOf(c))}
              >
                Write 1-1 notes
                <TypeformMark entry={entry} />
              </Button>
            ) : (
              <span
                className="max-w-sm text-xs text-muted-foreground"
                role="status"
              >
                {nudge.line}
              </span>
            )}
          </div>
        );
      })}
      {rows.length > 5 && !all ? (
        <div className="px-4 py-3 sm:px-6">
          <button
            type="button"
            className="text-xs text-primary-ink underline-offset-4 hover:underline"
            onClick={() => setAll(true)}
          >
            See all {rows.length}
          </button>
        </div>
      ) : null}
    </SectionCard>
  );
}
