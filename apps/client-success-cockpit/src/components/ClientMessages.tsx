import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Dot, Kicker, SectionCard, type Tone } from "@/components/kit";
import {
  BROWSER_CLOCK,
  messageKey,
  messageLead,
  messagesIO,
  onItsWay,
  type PollClock,
  RECAP_WORDS,
  RecapApproval,
  stateLine,
} from "@/forms/RecapApproval";
import {
  ACTION_DEADLINE_MS,
  answerBy,
  MESSAGES_FAILED,
  type MessagesIO,
  type MessageView,
  messagesPath,
  notLive,
  todayLine,
} from "@/lib/clientMessages";
import { cn } from "@/lib/utils";

/**
 * The client's Messages card and Today's recap rows (docs/forms/STAGE2B-
 * CONTRACT.md 5.1, build 3c). The card sits on the client page's overview
 * tab with `id="messages"`, the one anchor the recap reminder, Today's rows
 * and the 1-1 notes window link to (Z45); each message is the shared
 * RecapApproval. Today lists what waits on a person.
 *
 * Dark at deploy: no message row can exist while the registry keeps the
 * recap away from the cockpit, so the card and Today's rows stay out of the
 * way until the 1-1 notes are native, unless a row exists (after a switch
 * back, a refused recap still needs its Skip). Once native, a read that
 * fails is said, never counted as zero.
 */

export const MESSAGES_EMPTY =
  "No messages for this client yet. A recap appears here after you send 1-1 notes for a recorded call.";
export { MESSAGES_FAILED };
export const MESSAGES_KICKER = "To the client's WhatsApp group";
export const RECAPS_FAILED =
  "The recaps waiting on you could not be read, so one may be missing here. Reload the page; if it stays, tell the tech lead.";

/** How often the card reads again while a message is on its way, and for how long. */
export const MESSAGES_POLL = { every: 20_000, for: 15 * 60_000 } as const;

export type MessagesRead =
  | { status: "loading"; messages: MessageView[] }
  | { status: "ready"; messages: MessageView[] }
  | { status: "failed"; messages: MessageView[]; notLive: boolean };

/**
 * One client's messages, newest first: read on mount, then every 20 s for
 * 15 minutes while one is on its way (approved, sending, or sent and not
 * yet read back). `put` keeps a row in step after an action. `stopped` says
 * the 15 minutes ran out with a row still on its way: nothing reads it again.
 */
export function useClientMessages(
  io: MessagesIO | null,
  taskId: string,
  opts: { every?: number; for?: number; clock?: PollClock } = {},
): MessagesRead & {
  put: (m: MessageView) => void;
  reload: () => void;
  stopped: boolean;
} {
  const every = opts.every ?? MESSAGES_POLL.every;
  const span = opts.for ?? MESSAGES_POLL.for;
  const [read, setRead] = useState<MessagesRead>({
    status: "loading",
    messages: [],
  });
  const [tick, setTick] = useState(0);
  const [stopped, setStopped] = useState(false);
  const clock = useRef(opts.clock ?? BROWSER_CLOCK);
  clock.current = opts.clock ?? BROWSER_CLOCK;
  const since = useRef(clock.current.now());
  // A read sent before an action and answered after it is older than the
  // action's own answer: dropped, so the row never steps back.
  const gen = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads again
  useEffect(() => {
    if (!io) {
      setRead({ status: "failed", messages: [], notLive: false });
      return;
    }
    let live = true;
    const asked = gen.current;
    // A read with no answer lands in `failed`, like one refused: never
    // "Reading the messages…" for ever, and the next poll still runs.
    answerBy(
      io.read(taskId),
      ACTION_DEADLINE_MS,
      clock.current,
      MESSAGES_FAILED,
    ).then(
      messages => {
        if (live && asked === gen.current)
          setRead({ status: "ready", messages });
      },
      e => {
        if (!live || asked !== gen.current) return;
        // Missing is never zero: rows already read stay on screen.
        setRead(r => ({
          status: "failed",
          messages: r.messages,
          notLive: notLive(e),
        }));
      },
    );
    return () => {
      live = false;
    };
  }, [io, taskId, tick]);
  const anyMoving = read.messages.some(m => onItsWay(m, clock.current.now()));
  // biome-ignore lint/correctness/useExhaustiveDependencies: each read schedules the next
  useEffect(() => {
    if (!anyMoving) {
      setStopped(false);
      return;
    }
    const c = clock.current;
    if (c.now() - since.current > span) {
      setStopped(true);
      return;
    }
    setStopped(false);
    const t = c.set(() => setTick(x => x + 1), every);
    return () => c.clear(t);
  }, [anyMoving, every, span, read]);
  const put = useCallback((m: MessageView) => {
    since.current = clock.current.now();
    gen.current += 1;
    setRead(r => ({
      ...r,
      messages: r.messages.some(x => x.id === m.id)
        ? r.messages.map(x => (x.id === m.id ? m : x))
        : [m, ...r.messages],
    }));
  }, []);
  const reload = useCallback(() => setTick(x => x + 1), []);
  return { ...read, put, reload, stopped };
}

/** The Messages card on the client page's overview tab. */
export function ClientMessages({
  taskId,
  native,
  io: given,
  poll,
  clock = BROWSER_CLOCK,
}: {
  taskId: string;
  /** The 1-1 notes are filled in the cockpit (the registry's provider). */
  native: boolean;
  /** Stand-ins for the harness and the tests. */
  io?: MessagesIO;
  poll?: { every?: number; for?: number };
  /** The rows' age, the reads' 15 minutes and the actions' deadline. */
  clock?: PollClock;
}) {
  const auth = useCockpitAuth();
  const io = useMemo(
    () => given ?? (auth.client ? messagesIO(auth.client) : null),
    [given, auth.client],
  );
  const read = useClientMessages(io, taskId, { ...poll, clock });
  const now = clock.now();
  const stopped = (m: MessageView) => read.stopped && onItsWay(m, now);
  // The last action's sentence and the row it was about, as the action
  // left it. While that row reads the same, the region keeps the sentence;
  // once a read moves it on (approved to sent, read back), the region says
  // the row's new line instead of the old one.
  const [said, setSaid] = useState<{
    id: string;
    text: string;
    key: string;
  } | null>(null);
  const acted = useRef<MessageView | null>(null);
  const saidRow = said ? read.messages.find(x => x.id === said.id) : undefined;
  const region = [
    !said || !saidRow
      ? ""
      : messageKey(saidRow, now) === said.key
        ? said.text
        : `${messageLead(saidRow)}: ${stateLine(saidRow, now)}`,
    read.messages.some(stopped) ? RECAP_WORDS.stoppedChecking : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cardRef = useRef<HTMLDivElement>(null);
  // Opened from a link to #messages (the reminder, Today, the window): the
  // card comes into view once it has something to show.
  const shown = read.status !== "loading";
  useEffect(() => {
    if (!shown || typeof window === "undefined") return;
    if (window.location.hash === "#messages")
      cardRef.current?.scrollIntoView?.({ block: "start" });
  }, [shown]);
  if (!native && read.messages.length === 0) return null;
  return (
    <div id="messages" ref={cardRef} className="scroll-mt-20">
      <SectionCard
        title="Messages"
        action={<Kicker className="pt-1">{MESSAGES_KICKER}</Kicker>}
        flush
      >
        {/* One live region per card: an action's new state is said once. */}
        <p className="sr-only" role="status" aria-live="polite">
          {region}
        </p>
        {read.status === "failed" ? (
          <p className="flex gap-2 px-4 py-3 text-sm sm:px-6" role="note">
            <span className="flex h-5 shrink-0 items-center">
              <Dot tone="warn" />
            </span>
            <span className="min-w-0">{MESSAGES_FAILED}</span>
          </p>
        ) : null}
        {read.status === "loading" ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
            Reading the messages…
          </p>
        ) : read.messages.length ? (
          read.messages.map(m => (
            <div key={m.id} className="px-4 py-4 sm:px-6">
              <RecapApproval
                message={m}
                io={io as MessagesIO}
                stopped={stopped(m)}
                clock={clock}
                onChange={next => {
                  acted.current = next;
                  read.put(next);
                }}
                announce={text => {
                  // Its answer, or the row as it stands when the action
                  // changed nothing (warnings to confirm).
                  const row = acted.current?.id === m.id ? acted.current : m;
                  acted.current = null;
                  setSaid({
                    id: m.id,
                    text,
                    key: messageKey(row, clock.now()),
                  });
                }}
              />
            </div>
          ))
        ) : read.status === "ready" ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
            {MESSAGES_EMPTY}
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}

const ROW_TONE: Record<string, Tone> = {
  draft: "warn",
  refused: "bad",
  failed: "bad",
  unknown: "warn",
};

/**
 * Today's recap rows (cockpit_client_messages_waiting): drafts waiting on
 * the seat, recaps WhatsApp refused, and for the CEO or an admin recaps
 * WhatsApp never confirmed. Each opens the client's Messages card. Hidden
 * when nothing waits and the read worked; a read that failed is said.
 */
export function RecapsWaiting({
  io: given,
  readKey,
  native,
  clock = BROWSER_CLOCK,
}: {
  io?: MessagesIO;
  /** Read again when this changes (the page read its snapshot again). */
  readKey?: unknown;
  /** The 1-1 notes are filled in the cockpit; until then only rows are shown. */
  native: boolean;
  /** The read's deadline; the tests pass their own. */
  clock?: PollClock;
}) {
  const auth = useCockpitAuth();
  const io = useMemo(
    () => given ?? (auth.client ? messagesIO(auth.client) : null),
    [given, auth.client],
  );
  const [rows, setRows] = useState<MessageView[]>([]);
  const [failed, setFailed] = useState(false);
  const timer = useRef(clock);
  timer.current = clock;
  // biome-ignore lint/correctness/useExhaustiveDependencies: readKey reads again
  useEffect(() => {
    if (!io) return;
    let live = true;
    // A read with no answer is a failed read: said, never zero.
    answerBy(
      io.waiting(),
      ACTION_DEADLINE_MS,
      timer.current,
      RECAPS_FAILED,
    ).then(
      list => {
        if (!live) return;
        setRows(list);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [io, readKey]);
  if (!rows.length && !(failed && native)) return null;
  return (
    <SectionCard title="Client recaps" count={rows.length || undefined} flush>
      {failed && native ? (
        <p className="flex gap-2 px-4 py-3 text-xs sm:px-6" role="note">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">{RECAPS_FAILED}</span>
        </p>
      ) : null}
      {rows.map(m => (
        <Link
          key={m.id}
          to={messagesPath(m.taskId)}
          className={cn(
            "group flex items-start gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-muted/40 sm:px-6",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ink",
          )}
        >
          <span className="flex h-5 shrink-0 items-center">
            <Dot tone={ROW_TONE[m.state] ?? "neutral"} />
          </span>
          <span className="min-w-0 flex-1">
            <TodayLine m={m} />
          </span>
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </Link>
      ))}
    </SectionCard>
  );
}

/** A Today row's sentence with the client's name isolated (an Arabic name stays whole). */
function TodayLine({ m }: { m: MessageView }) {
  const line = todayLine(m);
  const name = m.clientName?.trim() ?? "";
  const at = name ? line.indexOf(name) : -1;
  if (at < 0) return <>{line}</>;
  return (
    <>
      {line.slice(0, at)}
      <bdi className="font-medium">{name}</bdi>
      {line.slice(at + name.length)}
    </>
  );
}
