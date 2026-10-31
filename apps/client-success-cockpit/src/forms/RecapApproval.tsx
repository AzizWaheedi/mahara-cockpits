import type { SupabaseClient } from "@supabase/supabase-js";
import { Pencil } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Chip, Dot, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  ACTION_DEADLINE_MS,
  answerBy,
  handedBack,
  MAKE_AGAIN,
  MESSAGE_SKIPPED,
  MESSAGES_FAILED,
  MESSAGES_SHAPE,
  MessageError,
  type MessageState,
  type MessagesIO,
  type MessageView,
  NO_ANSWER,
  NO_REASON,
  NO_WHATSAPP_REASON,
  NOT_LIVE,
  notSentLine,
  readClientMessages,
  readMessagesWaiting,
  reopenClientMessage,
  skipClientMessage,
  skipOnly,
  triesSpent,
  whatsappPieces,
} from "@/lib/clientMessages";
import { cn } from "@/lib/utils";
import { FOCUS, NOTES_FONT } from "./CheckinFields";
import {
  approveRecap,
  type FormClient,
  NOTES_NOT_LIVE,
  NOTES_SHAPE,
  OFFLINE,
} from "./checkinClient";
import { kuwaitWeekday } from "./checkinRail";
import { kuwaitTime } from "./formTime";
import type { Clock } from "./useCheckin";

/*
 * The recap approval (docs/forms/STAGE2B-CONTRACT.md 5.1, build 3c): one
 * shared component for the client's Messages card and the 1-1 notes
 * window's recap step.
 *
 * Design plan (frontend-design, inside the cockpit's own system):
 * - Subject and job: the one WhatsApp message a client's group reads after
 *   a 1-1, for the CSM (admins and the CEO too). Its single job: say yes to
 *   that exact text, or skip it.
 * - Tokens: Mahara Teal for the one primary action (Approve and send); the
 *   ink teal for the surface's rule; orange (--warning) for a question
 *   waiting for a person ("Waiting for you"); the kit's Dot tones for every
 *   other state. No second palette.
 * - Type: Geist 600 at 15 for the row's lead, Geist 400 at 14 for the state
 *   line, Geist Mono 11 tabular for clock times, IBM Plex Sans Arabic at
 *   15/1.7 right to left for the message (the window's NOTES_FONT).
 * - Layout: the lead and its chip on one line, the message surface under
 *   them, the state line, then the actions right-aligned with the primary
 *   last; at 390px the actions stack at full width, primary last.
 * - Signature: the exact-bytes surface. The message drawn the way WhatsApp
 *   draws it (a single * is bold), right to left, with a 2px ink-teal rule
 *   on its inline-start edge, the right, where an Arabic line begins. Edit
 *   turns the same surface into a text field in place, so what is previewed
 *   and what is approved can never differ.
 * - Critique: a WhatsApp-green bubble with ticks imitated another product
 *   and brought a second palette: dropped. A side-by-side draft against
 *   edit was dropped: the CSM approves one text, not a diff. One primary
 *   button under the full message, so the text is read before the press.
 */

/**
 * An action's classes: the window's 3:1 focus ring, and while another call
 * runs (`aria-disabled`, still focusable) it dims and the pointer says no,
 * as the other 2b buttons that rest do. ui/button styles only `disabled:`.
 */
const ACTION = cn(
  FOCUS,
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
);

const KIND_WORD: Record<string, string> = {
  recap_checkin: "1-1 recap",
  recap_kickoff: "Kickoff recap",
  recap_blueprint: "Brand Blueprint recap",
  phase5: "Phase 5 message",
};

/** "1-1 recap · call Sun 25 Oct". */
export function messageLead(m: Pick<MessageView, "kind" | "callAt">): string {
  const kind = KIND_WORD[m.kind] ?? "Message";
  const day = kuwaitWeekday(m.callAt);
  return day ? `${kind} · call ${day}` : kind;
}

/** The words of 5.1's table, kept here so the card, the window and the tests share them. */
export const RECAP_WORDS = {
  draft: "This is exactly what the group gets. Edit it if you need to.",
  approvedToast: "Approved. It sends within about 3 minutes.",
  approved: "Sends within about 3 minutes.",
  /** Approved over 15 minutes ago and the sender has not taken it (Z decision). */
  approvedLate: (at: string) =>
    `Approved at ${at} and not sent yet. Tell the tech lead if it stays.`,
  sending: "Sending now.",
  checking: "Checking it arrived…",
  /** The worker stopped looking for WhatsApp's copy, 24 hours after the send. */
  notFound: (at: string) =>
    `Sent at ${at}. WhatsApp's copy was not found. Look in the group if it matters.`,
  /** The page stopped asking while the row could still move by itself. */
  stoppedChecking:
    "This page stopped checking. Reload it to see where the recap stands.",
  unknown:
    "Not confirmed: WhatsApp did not answer. The cockpit never sends it twice. Look in the group; the tech lead settles it.",
  skipped: MESSAGE_SKIPPED,
  reopened: "Reopened. Edit it, then approve it.",
  noReason: NO_WHATSAPP_REASON,
  warnings: "Check these before it goes:",
} as const;

const CHIP: Record<MessageState, { tone: Tone; text: string }> = {
  draft: { tone: "warn", text: "Waiting for you" },
  approved: { tone: "accent", text: "Approved" },
  claimed: { tone: "accent", text: "Sending" },
  sending: { tone: "accent", text: "Sending" },
  sent: { tone: "good", text: "Sent" },
  unknown: { tone: "warn", text: "Not confirmed" },
  refused: { tone: "bad", text: "Not sent" },
  failed: { tone: "bad", text: "Not sent" },
  skipped: { tone: "neutral", text: "Skipped" },
};

const sentence = (s: string) =>
  /[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`;

/** After this the 3-minute promise is no longer true: the worker is held or down. */
const APPROVED_LATE_MS = 15 * 60_000;
/** The read-back is retried for 24 hours after the send (20261029v, the worker). */
const READ_BACK_MS = 24 * 60 * 60_000;

const olderThan = (at: string | null, ms: number, now: number | undefined) => {
  const t = Date.parse(at ?? "");
  return now !== undefined && Number.isFinite(t) && now - t > ms;
};
const approvedLate = (m: MessageView, now?: number) =>
  m.state === "approved" && olderThan(m.approvedAt, APPROVED_LATE_MS, now);
const readBackOver = (m: MessageView, now?: number) =>
  m.state === "sent" &&
  !m.readBack?.at &&
  olderThan(m.sentAt, READ_BACK_MS, now);

/**
 * A message whose state can still change by itself (the sender, the
 * read-back), so a page keeps asking. A send the worker stopped reading back
 * after 24 hours will not change, so it is not on its way.
 */
export function onItsWay(m: MessageView, now?: number): boolean {
  return (
    m.state === "approved" ||
    m.state === "claimed" ||
    m.state === "sending" ||
    (m.state === "sent" && !m.readBack?.at && !readBackOver(m, now))
  );
}

/**
 * The state line of 5.1's table for a message as it stands. `now` adds its
 * age: an approval the sender has not taken in 15 minutes, a send no longer
 * being read back. Left out, the line is the table's own words.
 */
export function stateLine(m: MessageView, now?: number): string {
  switch (m.state) {
    case "draft":
      // Approving it can only be refused: said before the button is looked for.
      if (handedBack(m)) return MAKE_AGAIN;
      if (triesSpent(m)) return notSentLine(m);
      // After expiry, or an approver who lost the client: the server's
      // sentence, which ends "Approve it again."
      return m.reason?.trim() ? sentence(m.reason) : RECAP_WORDS.draft;
    case "approved":
      return approvedLate(m, now)
        ? RECAP_WORDS.approvedLate(kuwaitTime(m.approvedAt))
        : RECAP_WORDS.approved;
    case "claimed":
    case "sending":
      return RECAP_WORDS.sending;
    case "sent": {
      if (readBackOver(m, now))
        return RECAP_WORDS.notFound(
          `${kuwaitWeekday(m.sentAt)} ${kuwaitTime(m.sentAt)}`,
        );
      const sent = m.sentAt ? `Sent at ${kuwaitTime(m.sentAt)}.` : "Sent.";
      const back = m.readBack?.at
        ? m.readBack.by === "person"
          ? `Seen in the group by a person at ${kuwaitTime(m.readBack.at)}.`
          : `Read back from WhatsApp at ${kuwaitTime(m.readBack.at)}.`
        : RECAP_WORDS.checking;
      return `${sent} ${back}`;
    }
    case "unknown":
      return RECAP_WORDS.unknown;
    case "refused":
    case "failed":
      return notSentLine(m);
    case "skipped":
      return RECAP_WORDS.skipped;
  }
}

/**
 * A message as its state line reads it: an action's announcement stays
 * true while this is unchanged, and goes stale once a read moves the row
 * on (approved to sent, read back, expired).
 */
export function messageKey(m: MessageView, now?: number): string {
  return `${m.id}|${m.state}|${stateLine(m, now)}`;
}

/**
 * A failed approval in the recap's words. It goes through the window's door,
 * whose sentences are about the 1-1 notes; the card and the step show them
 * beside a recap. A dropped connection may have lost the answer after the
 * approval landed, so it says what is known and what to do next.
 */
export function approvalSaid(e: unknown): unknown {
  const said = (e as Error)?.message;
  if (said === OFFLINE) return new MessageError(NO_ANSWER.approve);
  if (said === NOTES_NOT_LIVE) return new MessageError(NOT_LIVE);
  if (said === NOTES_SHAPE) return new MessageError(MESSAGES_SHAPE);
  return e;
}

/** The calls the approval makes, through the signed-in seat's own client. */
export function messagesIO(
  client: FormClient | SupabaseClient | null,
): MessagesIO {
  const need = () => {
    if (!client) throw Error("Sign in to the cockpit, then try again.");
    return client as SupabaseClient;
  };
  return {
    read: taskId => readClientMessages(need(), taskId),
    waiting: () => readMessagesWaiting(need()),
    approve: a =>
      approveRecap(
        need() as unknown as FormClient,
        a.messageId,
        a.body,
        a.acceptWarnings,
      ).catch(e => {
        throw approvalSaid(e);
      }),
    skip: id => skipClientMessage(need(), id),
    reopen: id => reopenClientMessage(need(), id),
  };
}

const URL_RE = /(https?:\/\/\S+)/g;

/** One run of text: links kept left to right inside the right-to-left message. */
function Run({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr" className="break-all">
            {p}
          </bdi>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** The surface's look, shared by the drawn message and its text field. */
const SURFACE =
  "w-full whitespace-pre-wrap break-words rounded-xl rounded-s-none border-s-2 border-primary-ink bg-muted/40 px-4 py-3 text-[15px] leading-[1.7]";

/** The message as WhatsApp draws it: right to left, single-star bold, nothing else changed. */
export function MessageSurface({ body, id }: { body: string; id?: string }) {
  return (
    <div id={id} dir="rtl" lang="ar" style={NOTES_FONT} className={SURFACE}>
      {whatsappPieces(body).map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold">
            <Run text={p.text} />
          </strong>
        ) : (
          <Run key={i} text={p.text} />
        ),
      )}
    </div>
  );
}

const CLOCK_TIME = /(\b\d{1,2}:\d{2}\b)/;

/** A line with each clock time in the plan's Geist Mono 11 tabular. */
function Clocked({ text }: { text: string }) {
  return (
    <>
      {text.split(CLOCK_TIME).map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono text-[11px] tabular-nums">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

type Busy = null | "approve" | "skip" | "reopen";

/** The timer the page's reads and actions run on; the tests pass their own. */
export type PollClock = Pick<Clock, "now" | "set" | "clear">;

export const BROWSER_CLOCK: PollClock = {
  now: () => Date.now(),
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: h => window.clearTimeout(h as number),
};

/**
 * One message: its lead and chip, the exact-bytes surface while it waits
 * for a person, the state line, and the actions of its state. After an
 * action focus goes to the state line, and `announce` gives the parent's
 * one live region the new line.
 */
export function RecapApproval({
  message,
  io,
  onChange,
  announce,
  lead = true,
  extra,
  stopped = false,
  clock,
}: {
  message: MessageView;
  io: MessagesIO;
  /** The stored row after an action: the parent keeps its list in step. */
  onChange: (next: MessageView) => void;
  /** The parent's one live region (one per card, one per window step). */
  announce?: (text: string) => void;
  /** The lead line with its chip; the window's step draws its own heading. */
  lead?: boolean;
  /** Under the actions: the window's "Open the Messages card". */
  extra?: ReactNode;
  /** The parent stopped asking while this row could still move by itself. */
  stopped?: boolean;
  /** The row's age and the actions' deadline; left out, the browser's and no age. */
  clock?: PollClock;
}) {
  const id = useId();
  const now = clock?.now();
  // No call rests every button for ever: the wait ends and says what is known.
  const timed = <T,>(call: Promise<T>, said: string) =>
    answerBy(call, ACTION_DEADLINE_MS, clock ?? BROWSER_CLOCK, said);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(message.body);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusNext, setFocusNext] = useState(false);
  // A new stored text (reopened, or another seat's edit) is the text again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored body and state are the trigger
  useEffect(() => {
    if (busy) return;
    setText(message.body);
    setWarnings(null);
    if (message.state !== "draft") setEditing(false);
  }, [message.id, message.body, message.state]);
  // An action's error is about the state it was pressed in. Once the row has
  // moved on, the state line speaks; a new body alone keeps the error.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the row and its state are the trigger
  useEffect(() => {
    setError(null);
  }, [message.id, message.state]);
  useEffect(() => {
    if (!focusNext) return;
    setFocusNext(false);
    statusRef.current?.focus();
  }, [focusNext]);

  const line = stateLine(message, now);
  const chip = CHIP[message.state];
  const edited = text !== message.body;
  const settle = useCallback(
    (next: MessageView, toastText: string | null) => {
      onChange(next);
      if (toastText) toast.success(toastText);
      announce?.(`${messageLead(next)}: ${stateLine(next, now)}`);
      setFocusNext(true);
    },
    [onChange, announce, now],
  );

  async function approve(acceptWarnings: boolean) {
    if (busy) return;
    setBusy("approve");
    setError(null);
    try {
      const out = await timed(
        io.approve({
          messageId: message.id,
          body: text,
          acceptWarnings,
        }),
        NO_ANSWER.approve,
      );
      if ("needsConfirm" in out) {
        setWarnings(out.warnings);
        announce?.(`${RECAP_WORDS.warnings} ${out.warnings.join(" ")}`);
        setFocusNext(true);
        return;
      }
      setWarnings(null);
      setEditing(false);
      settle(out.message, RECAP_WORDS.approvedToast);
    } catch (e) {
      // The check's own sentence ("…Edit the text, then approve again."),
      // or the gate's; the edit is kept. Its role=alert line says it, so
      // the parent's live region does not say it a second time.
      setError((e as Error).message || NO_REASON);
      setFocusNext(true);
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    if (busy) return;
    setBusy("skip");
    setError(null);
    try {
      settle(
        await timed(io.skip(message.id), NO_ANSWER.skip),
        RECAP_WORDS.skipped,
      );
    } catch (e) {
      setError((e as Error).message || NO_REASON);
      setFocusNext(true);
    } finally {
      setBusy(null);
    }
  }

  async function reopen() {
    if (busy) return;
    setBusy("reopen");
    setError(null);
    try {
      const next = await timed(io.reopen(message.id), NO_ANSWER.reopen);
      setEditing(true);
      settle(next, RECAP_WORDS.reopened);
    } catch (e) {
      setError((e as Error).message || NO_REASON);
      setFocusNext(true);
    } finally {
      setBusy(null);
    }
  }

  const draft = message.state === "draft";
  // After a rollback, or with its three tries spent: Skip is all that is left.
  const closing = skipOnly(message);
  const describedBy = [`${id}-status`, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  // Still focusable while a call runs, so focus stays where it was; every
  // action rests dimmed with a not-allowed pointer (ACTION) meanwhile.
  const press = (run: () => void) => ({
    "aria-disabled": busy !== null || undefined,
    onClick: () => {
      if (busy === null) run();
    },
  });
  const editNow = () => {
    setWarnings(null);
    setEditing(true);
    setTimeout(() => fieldRef.current?.focus(), 0);
  };

  let actions: ReactNode = null;
  if (closing)
    actions = (
      <Button
        key="skip"
        size="sm"
        variant="outline"
        className={cn(ACTION, "w-full sm:w-auto")}
        {...press(() => void skip())}
      >
        {busy === "skip" ? "Skipping…" : "Skip"}
      </Button>
    );
  else if (draft && warnings)
    actions = (
      <>
        <Button
          key="edit"
          size="sm"
          variant="outline"
          className={cn(ACTION, "w-full sm:mr-auto sm:w-auto")}
          {...press(editNow)}
        >
          <Pencil aria-hidden />
          Edit
        </Button>
        <Button
          key="approve-anyway"
          size="sm"
          className={cn(ACTION, "w-full sm:w-auto")}
          aria-describedby={describedBy}
          {...press(() => void approve(true))}
        >
          {busy === "approve" ? "Approving…" : "Approve anyway"}
        </Button>
      </>
    );
  else if (draft)
    actions = (
      <>
        <Button
          key="edit"
          size="sm"
          variant="outline"
          className={cn(ACTION, "w-full sm:mr-auto sm:w-auto")}
          {...press(() => (editing ? setEditing(false) : editNow()))}
        >
          <Pencil aria-hidden />
          {editing ? "Done editing" : "Edit"}
        </Button>
        <Button
          key="skip"
          size="sm"
          variant="outline"
          className={cn(ACTION, "w-full sm:w-auto")}
          {...press(() => void skip())}
        >
          {busy === "skip" ? "Skipping…" : "Skip"}
        </Button>
        <Button
          key="approve"
          size="sm"
          className={cn(ACTION, "w-full sm:w-auto")}
          aria-describedby={describedBy}
          {...press(() => void approve(false))}
        >
          {busy === "approve" ? "Approving…" : "Approve and send"}
        </Button>
      </>
    );
  else if (message.state === "approved")
    actions = (
      <Button
        key="edit-again"
        size="sm"
        variant="outline"
        className={cn(ACTION, "w-full sm:w-auto")}
        {...press(() => void reopen())}
      >
        {busy === "reopen" ? "Reopening…" : "Edit again"}
      </Button>
    );
  else if (message.state === "refused" || message.state === "failed")
    actions = (
      <>
        <Button
          key="skip"
          size="sm"
          variant="outline"
          className={cn(ACTION, "w-full sm:w-auto")}
          {...press(() => void skip())}
        >
          {busy === "skip" ? "Skipping…" : "Skip"}
        </Button>
        <Button
          key="try-again"
          size="sm"
          variant="outline"
          className={cn(ACTION, "w-full sm:w-auto")}
          {...press(() => void reopen())}
        >
          {busy === "reopen" ? "Reopening…" : "Try again"}
        </Button>
      </>
    );

  const rows = Math.min(18, Math.max(6, text.split("\n").length + 1));
  return (
    <div className="space-y-3" data-message={message.id}>
      {lead ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <h3 className="text-[15px] font-semibold leading-snug">
            {messageLead(message)}
          </h3>
          <Chip tone={chip.tone}>{chip.text}</Chip>
        </div>
      ) : null}

      {draft ? (
        editing && !closing ? (
          <div className="space-y-1">
            <label htmlFor={`${id}-text`} className="sr-only">
              The message to the client's group
            </label>
            <textarea
              ref={fieldRef}
              id={`${id}-text`}
              dir="rtl"
              lang="ar"
              style={NOTES_FONT}
              value={text}
              rows={rows}
              // While a call runs the field rests, so the text it answers
              // about is the text on the screen. Focus stays in the field.
              readOnly={busy !== null}
              onChange={e => {
                if (busy !== null) return;
                setText(e.target.value);
                setWarnings(null);
              }}
              className={cn(
                SURFACE,
                "resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink",
              )}
            />
            <p className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
              <span>
                {edited ? (
                  <button
                    type="button"
                    aria-disabled={busy !== null || undefined}
                    className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                    onClick={() => {
                      if (busy !== null) return;
                      setText(message.body);
                      setWarnings(null);
                      setError(null);
                      // This button goes with the edit, so focus stays with
                      // the text instead of falling to the page.
                      fieldRef.current?.focus();
                    }}
                  >
                    Undo my edits
                  </button>
                ) : (
                  "The saved text, unchanged."
                )}
              </span>
              <span className="font-mono text-[11px] tabular-nums">
                {[...text].length.toLocaleString("en-US")} / 4,096
              </span>
            </p>
          </div>
        ) : (
          <MessageSurface body={closing ? message.body : text} />
        )
      ) : (
        <details className="group/message text-sm">
          <summary className="w-fit rounded-sm text-xs text-muted-foreground hover:text-foreground">
            Show the message
          </summary>
          <div className="mt-2">
            <MessageSurface body={message.body} />
          </div>
        </details>
      )}

      <p
        ref={statusRef}
        id={`${id}-status`}
        tabIndex={-1}
        className={cn(
          // The side padding keeps the ring off the first letter; the margin
          // keeps the line where it was.
          "-mx-1.5 flex gap-2 rounded-sm px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary-ink",
          draft && !message.reason && !closing ? "text-muted-foreground" : "",
        )}
      >
        {!lead ? (
          <span className="flex h-5 shrink-0 items-center">
            <Dot tone={chip.tone} label={chip.text} />
          </span>
        ) : null}
        <span className="min-w-0">
          <Clocked text={line} />
        </span>
      </p>
      {message.state === "approved" && approvedLate(message, now) ? (
        // The line above already says when; who is all this one adds.
        message.approvedBy ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            {`Approved by ${message.approvedBy}.`}
          </p>
        ) : null
      ) : message.state === "approved" && message.approvedAt ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          {`Approved${message.approvedBy ? ` by ${message.approvedBy}` : ""} at `}
          <span className="font-mono text-[11px] tabular-nums">
            {kuwaitTime(message.approvedAt)}
          </span>
          .
        </p>
      ) : null}
      {stopped ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          {RECAP_WORDS.stoppedChecking}
        </p>
      ) : null}

      {draft && !closing && warnings?.length ? (
        <div className="space-y-1.5 rounded-xl px-1 text-sm">
          <p className="font-medium">{RECAP_WORDS.warnings}</p>
          <ul className="space-y-1">
            {warnings.map(w => (
              <li key={w} className="flex gap-2">
                <span className="flex h-5 shrink-0 items-center">
                  <Dot tone="warn" />
                </span>
                <span className="min-w-0">{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p id={`${id}-error`} className="flex gap-2 text-sm" role="alert">
          <span className="flex h-5 shrink-0 items-center">
            <Dot tone="bad" />
          </span>
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}

      {actions ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {actions}
        </div>
      ) : null}
      {extra}
    </div>
  );
}

// ------------------------------------------------------------ the window's row

/**
 * The message the cockpit made for one sent response, for the 1-1 notes
 * window's recap step (STAGE2B-CONTRACT.md 4.15 item 1, Z46): read by task
 * and picked by response ID; asked again every 15 s while it has not
 * appeared (the dispatch makes it when the recap draft turns ready, tens of
 * seconds after the send), then every 20 s while it is on its way. The
 * wait runs 15 minutes from when approving turned on, again from each
 * action, and again from each change of `kick` (the step passes its recap
 * draft, so Draft again, or a draft that turns ready late, is followed by a
 * read at once and a new 15 minutes). Each read schedules the next once it
 * comes back, answered or refused, so a read that changes nothing never
 * stops the asking.
 */
export function useRecapMessage(
  io: MessagesIO | null | undefined,
  taskId: string,
  responseId: string | null,
  enabled: boolean,
  opts: {
    waitEvery?: number;
    moveEvery?: number;
    for?: number;
    clock?: PollClock;
    /** A change reads again at once and restarts the 15 minutes. */
    kick?: string;
  } = {},
): {
  message: MessageView | null;
  failed: string | null;
  /** The 15 minutes ran out with the row missing or still moving, and asking stopped. */
  stopped: boolean;
  put: (m: MessageView) => void;
} {
  const waitEvery = opts.waitEvery ?? 15_000;
  const moveEvery = opts.moveEvery ?? 20_000;
  const span = opts.for ?? 15 * 60_000;
  const clock = useRef(opts.clock ?? BROWSER_CLOCK);
  clock.current = opts.clock ?? BROWSER_CLOCK;
  const [message, setMessage] = useState<MessageView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [tick, setTick] = useState(0);
  // Counts every read that came back; the next timer waits for it.
  const [reads, setReads] = useState(0);
  const since = useRef<number | null>(null);
  // A read sent before an action and answered after it is older than the
  // action's own answer: dropped, so the row never steps back.
  const gen = useRef(0);
  const on = Boolean(enabled && io && responseId);
  useEffect(() => {
    since.current = on ? clock.current.now() : null;
  }, [on]);
  const kick = opts.kick ?? "";
  const kicked = useRef(kick);
  useEffect(() => {
    if (kicked.current === kick) return;
    kicked.current = kick;
    if (!on) return;
    since.current = clock.current.now();
    setTick(x => x + 1);
  }, [kick, on]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads again
  useEffect(() => {
    if (!on || !io || !responseId) return;
    let live = true;
    const asked = gen.current;
    // A read with no answer ends like a read refused, so the next one is
    // scheduled and the step says it, instead of waiting for ever.
    answerBy(
      io.read(taskId),
      ACTION_DEADLINE_MS,
      clock.current,
      MESSAGES_FAILED,
    ).then(
      list => {
        if (!live) return;
        if (asked === gen.current) {
          setMessage(list.find(m => m.responseId === responseId) ?? null);
          setFailed(null);
        }
        setReads(n => n + 1);
      },
      e => {
        if (!live) return;
        if (asked === gen.current) setFailed((e as Error).message || NO_REASON);
        setReads(n => n + 1);
      },
    );
    return () => {
      live = false;
    };
  }, [on, io, taskId, responseId, tick]);
  const wait = !message
    ? waitEvery
    : onItsWay(message, clock.current.now())
      ? moveEvery
      : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each read that comes back, and each action, schedules the next
  useEffect(() => {
    if (!on || wait === null) {
      setStopped(false);
      return;
    }
    const c = clock.current;
    if (since.current !== null && c.now() - since.current > span) {
      setStopped(true);
      return;
    }
    setStopped(false);
    const t = c.set(() => setTick(x => x + 1), wait);
    return () => c.clear(t);
  }, [on, wait, span, reads, message]);
  const put = useCallback((m: MessageView) => {
    since.current = clock.current.now();
    gen.current += 1;
    setMessage(m);
  }, []);
  return { message, failed, stopped, put };
}
