import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { NOT_A_CHECKIN } from "@/components/ClientCalls";
import { Dot } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { kuwaitWeekday } from "@/forms/checkinRail";
import { kuwaitTime } from "@/forms/formTime";
import { BROWSER_CLOCK, type PollClock } from "@/forms/RecapApproval";
import { ACTION_DEADLINE_MS, answerBy, NO_REASON } from "@/lib/clientMessages";
import {
  matchUnmatched,
  readUnmatched,
  type SettleReason,
  settleCandidate,
  type Unmatched,
} from "@/lib/csmCalls";
import { cn } from "@/lib/utils";

/*
 * Impromptu calls on Today (docs/forms/STAGE2B-CONTRACT.md 4.10, 5.2).
 *
 * Design plan (frontend-design, inside the cockpit's own system):
 * - Subject and job: the CSM's Today. Every call she records ends with 1-1
 *   notes or a reason. An impromptu recording (a candidate) has no client
 *   yet, so it cannot have notes; this row lets her answer "whose call was
 *   this?" where she already is.
 * - Tokens: the kit's only. Orange (--warning) is the one colour on the
 *   row: a question waiting for a person. No teal on the row, so the 1-1
 *   notes window keeps the one teal button.
 * - Type: Geist 500 for the row's lead, Geist 400 for the line under it,
 *   Geist Mono 11 tabular for the clock.
 * - Layout: inside "After your calls", one list with the client rows,
 *   newest call first; the actions on the right, wrapping under the row at
 *   390px. The Place sheet is the 1-1 notes window's Change sheet pattern.
 * - Signature: the orange question lamp, the window's "Is this the call?"
 *   moved to Today, where it can be answered; once answered the row becomes
 *   an ordinary client row (the snapshot is read again).
 * - Critique: a second card "Calls with no client" was dropped (a thing is
 *   said once, docs/DESIGN.md); a link to some client's queue was dropped
 *   (she would have to guess which client). The row places the call in place.
 *
 * Dark until the switch-over: the queue is read only once the registry's
 * provider is native (Z17), and only the seat's own impromptu recordings
 * are kept (After your calls is "your calls"; it names no other recorder).
 * Both actions are the existing gated, audited RPCs; no new writer.
 */

/** The queue could not be read: said in the card, never counted as zero. */
export const IMPROMPTU_FAILED =
  "The calls with no client could not be read, so an impromptu call may be missing here. Reload the page; if it stays, tell the tech lead.";
export const PLACE_TITLE = "Whose call was this?";
/** The Place sheet with no client to pick: she still has a call to answer. */
export const NO_CLIENTS =
  "No clients are on your list, so this call cannot be placed here. Ask an admin to place it, or mark it Not a 1-1 call.";
export const PLACE_DESCRIPTION =
  "Pick the client. The call goes on their page, then you can write the 1-1 notes.";
export const SET_ASIDE = "Set aside: not a 1-1 call.";
/** Place or Not a 1-1 call got no answer in time: what is known, what to do next. */
export const CALL_NO_ANSWER =
  "No answer came back, so this may or may not have saved. Reload the page to see where the call stands.";

/**
 * A refusal in the server's words. A dropped connection comes back as the
 * browser's own error, and the call may have landed before the answer was
 * lost, so it says the same as no answer at all.
 */
export function callSaid(e: unknown): string {
  const said = (e as Error)?.message ?? "";
  if (/Failed to fetch|NetworkError|Load failed/i.test(said))
    return CALL_NO_ANSWER;
  return said || NO_REASON;
}

/** The keys that open a menu from its trigger (Radix: Enter, Space, the arrows). */
const MENU_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

const lower = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** The seat's own impromptu recordings, from the whole queue. */
export function impromptuOf(items: Unmatched[], email: string): Unmatched[] {
  const me = lower(email);
  if (!me) return [];
  return items.filter(
    u => u.kind === "call" && u.candidate && lower(u.host) === me,
  );
}

/** "Sun 25 Oct" and "10:34" of a recording, in Kuwait. */
export const callDay = (u: Pick<Unmatched, "at">) => kuwaitWeekday(u.at);
export const callClock = (u: Pick<Unmatched, "at">) => kuwaitTime(u.at);
/** "the impromptu call on Sun 25 Oct, 10:34": what each button is named for. */
export const callName = (u: Pick<Unmatched, "at">) =>
  `the impromptu call on ${callDay(u)}, ${callClock(u)}`;

/** The queue's reads and the two gated, audited writers it already has. */
export interface ImpromptuIO {
  /** The seat's address: only its own recordings are listed. */
  email: string;
  read(): Promise<Unmatched[]>;
  place(id: number, taskId: string): Promise<unknown>;
  settle(id: number, reason: SettleReason): Promise<unknown>;
}

/** The calls through the signed-in seat's own client. */
export function useImpromptuIO(given?: ImpromptuIO | null): ImpromptuIO | null {
  const auth = useCockpitAuth();
  const client = auth.client as SupabaseClient | null;
  const email = auth.email ?? "";
  return useMemo(() => {
    if (given) return given;
    if (!client) return null;
    return {
      email,
      read: () => readUnmatched(client),
      place: (id, taskId) => matchUnmatched(client, id, taskId),
      settle: (id, reason) => settleCandidate(client, id, reason),
    };
  }, [given, client, email]);
}

export interface ImpromptuCalls {
  /** The seat's impromptu recordings with no client, newest first. */
  items: Unmatched[];
  /** The queue was asked and refused, or gave no answer in time. */
  failed: boolean;
  /** A row that was placed or set aside leaves the list. */
  remove(id: number): void;
}

/**
 * The seat's impromptu calls with no client. Read only when `enabled` (the
 * 1-1 notes are native), on mount and whenever `readKey` changes (the
 * snapshot is read again, after a refetch or a place).
 */
export function useImpromptuCalls(
  enabled: boolean,
  readKey?: unknown,
  given?: ImpromptuIO | null,
  clock: PollClock = BROWSER_CLOCK,
): ImpromptuCalls {
  const io = useImpromptuIO(given);
  const [items, setItems] = useState<Unmatched[]>([]);
  const [failed, setFailed] = useState(false);
  const timer = useRef(clock);
  timer.current = clock;
  // biome-ignore lint/correctness/useExhaustiveDependencies: readKey marks a new snapshot
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setFailed(false);
      return;
    }
    if (!io) {
      setFailed(true);
      return;
    }
    let live = true;
    // A read with no answer is a failed read: said, never zero.
    answerBy(
      io.read(),
      ACTION_DEADLINE_MS,
      timer.current,
      IMPROMPTU_FAILED,
    ).then(
      all => {
        if (!live) return;
        setItems(
          impromptuOf(all, io.email).sort(
            (a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)),
          ),
        );
        setFailed(false);
      },
      () => {
        if (!live) return;
        // Missing is never zero: the rows already read stay, and the card
        // says the read failed.
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, io, readKey]);
  const remove = useCallback(
    (id: number) => setItems(list => list.filter(u => u.id !== id)),
    [],
  );
  return { items, failed, remove };
}

// ------------------------------------------------------------ the row

/**
 * One impromptu call with no client. `onPlace` opens the Place sheet;
 * `onSettled` runs once the row is set aside (focus moves on from there).
 */
export function ImpromptuRow({
  item,
  io,
  busy,
  onPlace,
  onSettled,
  lampCol,
  clock = BROWSER_CLOCK,
}: {
  item: Unmatched;
  io: ImpromptuIO | null;
  /** Another row's call is running: this row's buttons rest. */
  busy: boolean;
  onPlace: (u: Unmatched) => void;
  onSettled: (u: Unmatched) => void;
  /** The list's lamp column, so client rows below line up with this one. */
  lampCol: string;
  /** The action's deadline; the tests pass their own. */
  clock?: PollClock;
}) {
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const name = callName(item);
  const rest = busy || settling;
  async function settle(reason: SettleReason) {
    if (!io || rest) return;
    setSettling(true);
    setError(null);
    try {
      await answerBy(
        io.settle(item.id, reason),
        ACTION_DEADLINE_MS,
        clock,
        CALL_NO_ANSWER,
      );
      toast.success(SET_ASIDE);
      onSettled(item);
    } catch (e) {
      // A refusal keeps the row, with the server's sentence under it.
      setError(callSaid(e));
    } finally {
      setSettling(false);
    }
  }
  return (
    <div className="px-4 py-3 text-sm sm:px-6" data-impromptu={item.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className={cn("grid min-w-0 items-start gap-x-2.5", lampCol)}>
          {/* The orange question lamp: a call waiting for a person's answer. */}
          <span className="flex h-5 items-center" aria-hidden>
            <span className="size-2.5 shrink-0 rounded-full bg-warning" />
          </span>
          <div className="min-w-0">
            <p className="font-medium">
              Impromptu call on {callDay(item)}, no client yet
            </p>
            <p className="text-xs text-muted-foreground" dir="auto">
              <span className="font-mono text-[11px] tabular-nums">
                {callClock(item)}
              </span>
              {item.hint ? ` · ${item.hint}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="aria-disabled:opacity-50"
            aria-label={`Place ${name}`}
            aria-disabled={rest || undefined}
            aria-describedby={error ? errorId : undefined}
            onClick={() => {
              if (!rest) onPlace(item);
            }}
          >
            Place it
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="aria-disabled:opacity-50"
                aria-label={`Not a 1-1 call: ${name}`}
                aria-disabled={rest || undefined}
                // While a call runs the menu does not open; the button keeps
                // focus. Only the keys that open the menu are held, so Tab
                // and Shift+Tab still move on.
                onPointerDown={e => {
                  if (rest) e.preventDefault();
                }}
                onKeyDown={e => {
                  if (rest && MENU_KEYS.has(e.key)) e.preventDefault();
                }}
              >
                Not a 1-1 call
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NOT_A_CHECKIN.map(r => (
                <DropdownMenuItem
                  key={r.reason}
                  onSelect={() => void settle(r.reason)}
                >
                  {r.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className={cn("mt-2 grid gap-x-2.5 text-xs", lampCol)}
        >
          <span className="flex h-4 items-center justify-center">
            <Dot tone="bad" />
          </span>
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the Place sheet

/**
 * Letters as a search compares them: case, accents, the Arabic alef and
 * yaa forms, taa marbuta and tatweel folded, so "شركه" finds "شركة" and
 * "city" finds "City Wood".
 */
export function searchable(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type PlaceClient = { taskId: string; name: string };

/** The clients the search lists, names matched letter for letter after folding. */
export function placeMatches(
  clients: PlaceClient[],
  query: string,
): PlaceClient[] {
  const q = searchable(query);
  const list = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  return q ? list.filter(c => searchable(c.name).includes(q)) : list;
}

export function PlaceSheet({
  item,
  io,
  clients,
  onOpenChange,
  onPlaced,
  onCloseFocus,
  clock = BROWSER_CLOCK,
}: {
  /** The call being placed; null closes the sheet. */
  item: Unmatched | null;
  io: ImpromptuIO | null;
  clients: PlaceClient[];
  onOpenChange: (open: boolean) => void;
  /** Saved on a client: the sheet closes after this. */
  onPlaced: (u: Unmatched, c: PlaceClient) => void;
  /** Where focus goes when the sheet closes. */
  onCloseFocus: () => void;
  /** The pick's deadline; the tests pass their own. */
  clock?: PollClock;
}) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A new call to place starts a fresh search.
  const itemId = item?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new item is a new search
  useEffect(() => {
    setQuery("");
    setError(null);
    setSaving(null);
  }, [itemId]);
  const shown = useMemo(() => placeMatches(clients, query), [clients, query]);
  async function pick(c: PlaceClient) {
    if (!item || !io || saving) return;
    setSaving(c.taskId);
    setError(null);
    try {
      await answerBy(
        io.place(item.id, c.taskId),
        ACTION_DEADLINE_MS,
        clock,
        CALL_NO_ANSWER,
      );
      toast.success(`Saved on ${c.name}.`);
      onPlaced(item, c);
    } catch (e) {
      setError(callSaid(e));
    } finally {
      setSaving(null);
    }
  }
  return (
    <Sheet
      open={Boolean(item)}
      onOpenChange={open => {
        // While a pick saves, the sheet stays: its answer comes here, and it
        // always comes (the deadline above).
        if (!open && saving) return;
        onOpenChange(open);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={e => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
        onCloseAutoFocus={e => {
          e.preventDefault();
          onCloseFocus();
        }}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg">{PLACE_TITLE}</SheetTitle>
          <SheetDescription>{PLACE_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        {item ? (
          <div className="mt-5 space-y-4">
            <p className="flex gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
              <span className="flex h-5 items-center" aria-hidden>
                <span className="size-2.5 shrink-0 rounded-full bg-warning" />
              </span>
              <span className="min-w-0">
                Impromptu call on {callDay(item)},{" "}
                <span className="font-mono text-[11px] tabular-nums">
                  {callClock(item)}
                </span>
                {item.hint ? (
                  // A hint only: never chosen for her.
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Fathom's hint: <bdi dir="auto">{item.hint}</bdi>
                  </span>
                ) : null}
              </span>
            </p>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-find`} className="text-sm font-medium">
                Find a client
              </label>
              <input
                ref={searchRef}
                id={`${id}-find`}
                type="search"
                autoComplete="off"
                spellCheck={false}
                dir="auto"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-controls={shown.length ? `${id}-list` : undefined}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {/* The region is always here and empty while the list shows, so
                a search that empties the list is read out (a region that
                arrives holding its text is often not). Empty, it takes no
                height inside this plain wrapper. */}
            <div>
              {shown.length ? (
                <ul
                  id={`${id}-list`}
                  aria-label="Clients"
                  className="-mx-2 max-h-[55dvh] space-y-0.5 overflow-y-auto"
                >
                  {shown.map(c => (
                    <li key={c.taskId}>
                      <button
                        type="button"
                        onClick={() => void pick(c)}
                        aria-disabled={saving !== null || undefined}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                      >
                        <bdi dir="auto">{c.name}</bdi>
                        {saving === c.taskId ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Saving…
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p
                className="text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {shown.length
                  ? ""
                  : query.trim()
                    ? `No client matches "${query.trim()}".`
                    : NO_CLIENTS}
              </p>
            </div>
            {error ? (
              <p className="flex gap-2 text-sm" role="alert">
                <span className="flex h-5 shrink-0 items-center">
                  <Dot tone="bad" />
                </span>
                <span className="min-w-0">{error}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
