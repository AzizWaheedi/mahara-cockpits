import { ArrowUpRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  IMPROMPTU_FAILED,
  type ImpromptuIO,
  ImpromptuRow,
  PlaceSheet,
  useImpromptuCalls,
  useImpromptuIO,
} from "@/components/ImpromptuCalls";
import { Dot, SectionCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { kuwaitWeekday } from "@/forms/checkinRail";
import type { PollClock } from "@/forms/RecapApproval";
import type { Unmatched } from "@/lib/csmCalls";
import {
  type CheckinEntry,
  type Nudge,
  notesNative,
  useCheckinEntry,
  useCheckinNudges,
} from "@/lib/formsRegistry";
import { cn } from "@/lib/utils";

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
 *
 * Once the 1-1 notes are native (docs/forms/STAGE2B-CONTRACT.md 4.10, 5.2)
 * the seat's impromptu calls with no client join the same list, newest
 * first, counted with the rest: each is placed on its client here, or set
 * aside as not a 1-1 call (src/components/ImpromptuCalls.tsx).
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

/** One row of the card: a client whose call has no notes, or an impromptu call. */
type CardRow =
  | { kind: "client"; key: string; at: number; c: Client }
  | { kind: "impromptu"; key: string; at: number; u: Unmatched };

const timeOf = (v: string | null | undefined) => {
  const ms = Date.parse(String(v ?? ""));
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * Both kinds in one list, newest call first (STAGE2B-CONTRACT.md 5.2): a
 * client row by its last call, an impromptu row by its recording.
 */
export function cardRows(clients: Client[], impromptu: Unmatched[]): CardRow[] {
  return [
    // The sort is stable: equal times keep afterCallRows' order.
    ...clients.map(
      (c): CardRow => ({
        kind: "client",
        key: `c:${String(c.taskId)}`,
        at: timeOf(callOf(c)),
        c,
      }),
    ),
    ...impromptu.map(
      (u): CardRow => ({
        kind: "impromptu",
        key: `u:${u.id}`,
        at: timeOf(u.at),
        u,
      }),
    ),
  ].sort((a, b) => b.at - a.at);
}

export function AfterCalls({
  snap,
  onPlaced,
  impromptuIO,
  clock,
}: {
  snap:
    | { clients?: Client[]; callStoreError?: string | null }
    | null
    | undefined;
  /**
   * An impromptu call was placed on a client: the page reads the snapshot
   * again, so its client row (notes still to write) takes the call's place.
   */
  onPlaced?: () => void;
  /** Stand-ins for the harness: the queue's read and its two writers. */
  impromptuIO?: ImpromptuIO;
  /** The read's and the two actions' deadline; the tests pass their own. */
  clock?: PollClock;
}) {
  const entry = useCheckinEntry();
  const io = useImpromptuIO(impromptuIO);
  const clientRows = useMemo(
    () => afterCallRows(snap?.clients),
    [snap?.clients],
  );
  // Dark until the switch-over (Z17): the queue is read only once the 1-1
  // notes are native, again whenever the snapshot is read again.
  const impromptu = useImpromptuCalls(notesNative(entry), snap, io, clock);
  const rows = useMemo(
    () => cardRows(clientRows, impromptu.items),
    [clientRows, impromptu.items],
  );
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  const listRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  /** The row at this place in the list takes focus, else the card's heading. */
  const focusRow = useCallback((at: number) => {
    const list = Array.from(listRef.current?.children ?? []);
    const row = list[Math.min(at, list.length - 1)];
    const el =
      row?.querySelector<HTMLElement>("a[href], button") ?? headRef.current;
    el?.focus();
  }, []);
  // "See all" takes itself away: focus goes to the first row it showed.
  useEffect(() => {
    if (all) focusRow(5);
  }, [all, focusRow]);
  // A row that leaves (placed, or set aside) takes its buttons with it:
  // focus goes to the row that took its place, else the heading.
  const [refocus, setRefocus] = useState<number | null>(null);
  // A row left in this visit and none is left: the card stays, says so,
  // and takes focus at its heading (the rows' buttons went with them).
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    if (refocus === null) return;
    setRefocus(null);
    if (rows.length) focusRow(refocus);
    else headRef.current?.focus();
  }, [refocus, rows.length, focusRow]);
  const leave = (u: Unmatched) => {
    const at = shown.findIndex(r => r.kind === "impromptu" && r.u.id === u.id);
    impromptu.remove(u.id);
    if (rows.length === 1) setCleared(true);
    setRefocus(Math.max(0, at));
  };
  const [placing, setPlacing] = useState<Unmatched | null>(null);
  // The row whose sheet is open, kept outside render state: closing the
  // sheet clears `placing` before Radix asks where focus goes, so the close
  // reads this instead. Cleared once a pick saves (that row leaves, and
  // `leave` moves focus on).
  const placingRef = useRef<Unmatched | null>(null);
  const place = (u: Unmatched) => {
    placingRef.current = u;
    setPlacing(u);
  };
  const placeClients = useMemo(
    () =>
      (snap?.clients ?? [])
        .filter(c => c?.taskId && c?.name)
        .map(c => ({ taskId: String(c.taskId), name: String(c.name) })),
    [snap?.clients],
  );
  const nudges = useCheckinNudges(
    shown
      .filter(r => r.kind === "client")
      .map(r => ({
        taskId: String((r as { c: Client }).c.taskId),
        lastCall: callOf((r as { c: Client }).c),
      })),
  );
  const failed = Boolean(snap?.callStoreError);
  // Missing is never zero: the card stays while either read failed.
  if (!rows.length && !failed && !impromptu.failed && !cleared) return null;
  // With an impromptu row in the list, every row keeps a lamp column, so the
  // client rows' words line up under the impromptu row's.
  const lamps = shown.some(r => r.kind === "impromptu");
  const lampCol = lamps ? "grid-cols-[10px_minmax(0,1fr)]" : "grid-cols-1";
  return (
    <SectionCard
      title={
        <span
          ref={headRef}
          tabIndex={-1}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-ink"
        >
          After your calls
        </span>
      }
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
      {impromptu.failed ? (
        <p className="flex gap-2 px-4 py-3 text-xs sm:px-6" role="note">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">{IMPROMPTU_FAILED}</span>
        </p>
      ) : null}
      {!rows.length && cleared ? (
        <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">
          Nothing left from your calls.
        </p>
      ) : null}
      {shown.length ? (
        <div ref={listRef} data-rows className="divide-y">
          {shown.map(r =>
            r.kind === "impromptu" ? (
              <ImpromptuRow
                key={r.key}
                item={r.u}
                io={io}
                busy={placing !== null}
                lampCol={lampCol}
                clock={clock}
                onPlace={place}
                onSettled={leave}
              />
            ) : (
              <ClientRow
                key={r.key}
                c={r.c}
                entry={entry}
                nudge={nudges[String(r.c.taskId)] ?? { kind: "button" }}
                lampCol={lampCol}
                lamp={lamps}
              />
            ),
          )}
        </div>
      ) : null}
      {rows.length > 5 && !all ? (
        <div className="px-4 py-3 sm:px-6">
          <button
            type="button"
            className="-my-1 py-1 text-xs text-primary-ink underline-offset-4 hover:underline"
            onClick={() => setAll(true)}
          >
            See all {rows.length}
          </button>
        </div>
      ) : null}
      <PlaceSheet
        item={placing}
        io={io}
        clients={placeClients}
        clock={clock}
        onOpenChange={open => {
          if (!open) setPlacing(null);
        }}
        onPlaced={u => {
          placingRef.current = null;
          setPlacing(null);
          leave(u);
          onPlaced?.();
        }}
        onCloseFocus={() => {
          // Closed without a pick (Escape, the X, a click outside): back to
          // that row's Place it, else the card's heading if the row went
          // while the sheet was open.
          const was = placingRef.current;
          placingRef.current = null;
          if (!was) return;
          const at = shown.findIndex(
            r => r.kind === "impromptu" && r.u.id === was.id,
          );
          if (at >= 0) focusRow(at);
          else headRef.current?.focus();
        }}
      />
    </SectionCard>
  );
}

/** A client whose last call has no 1-1 notes yet: the 2a row. */
function ClientRow({
  c,
  entry,
  nudge,
  lampCol,
  lamp,
}: {
  c: Client;
  entry: CheckinEntry;
  nudge: Nudge;
  lampCol: string;
  lamp: boolean;
}) {
  const id = String(c.taskId);
  const kind = CALL_WORD[String(c.lastCallKind ?? "")] ?? "call";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-6">
      <div className={cn("grid min-w-0 gap-x-2.5", lampCol)}>
        {lamp ? <span aria-hidden /> : null}
        <div className="min-w-0">
          <Link
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
        <span className="max-w-sm text-xs text-muted-foreground" role="status">
          {nudge.line}
        </span>
      )}
    </div>
  );
}
