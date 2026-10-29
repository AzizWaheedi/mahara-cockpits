import { RefreshCw } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Dot, ExtLink, Kicker } from "@/components/kit";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD_FOCUS, FOCUS, PANEL_INK } from "./CheckinFields";
import type { CallView } from "./checkinClient";
import { callOf, confirmed } from "./checkinForm";
import { kuwaitWeekday } from "./checkinRail";
import { kuwaitTime } from "./formTime";
import { blockedOf, type CheckinModel, type Seat } from "./useCheckin";

/**
 * "This call" (docs/forms/STAGE2-CONTRACT.md 8.1, the window's signature):
 * the recording these notes are for and the one plain sentence that says
 * why it was picked. An exact pick is the teal lamp and ring; a guess is
 * orange and asks "Is this the call?" until the person says yes; a booked
 * call with no recording, or no recording at all, is neutral. The real risk
 * in this window is notes on the wrong call or the wrong card, so the call
 * is the headline. The Change sheet lists what else it could be; one that
 * cannot be used for this client is listed disabled with the reason.
 */

const INK = "text-primary-ink";

const KIND_WORD: Record<string, string> = {
  checkin: "check-in",
  onboarding: "onboarding call",
  blueprint: "Brand Blueprint call",
  launch: "launch call",
};
const kindWord = (k?: string | null) => KIND_WORD[k ?? ""] ?? "call";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ASK = /\s*Is this the call\?\s*$/;

/**
 * No Fathom key in the vault (A3, B7): the window cannot read Fathom, but
 * the worker's 15-minute read still fills the call store, which the window
 * reads. The server says so for this seat (the CEO: where to paste the key;
 * anyone else: ask him); this is its first sentence, for an answer without.
 */
export const FATHOM_OFF =
  "Fathom isn't connected, so calls come only from the 15-minute read.";
const offNote = (note: string | null | undefined) => note?.trim() || FATHOM_OFF;

/**
 * Where focus goes when a sheet closes. These sheets have no trigger, and
 * Radix gives focus back only to a trigger, so without this it falls to the
 * page. Back to what had it when the sheet opened, if that is still there
 * and usable, else to the fallback (the call's Change, the title).
 */
export function useReturnFocus(fallback: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      const el = document.activeElement;
      opener.current =
        el instanceof HTMLElement && el !== document.body ? el : null;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      const el = opener.current;
      opener.current = null;
      const usable =
        el?.isConnected && !el.matches(":disabled") && el.tabIndex >= 0;
      (usable ? el : fallback())?.focus();
    },
  };
}

/**
 * Why this call (8.5, This call): the server's own sentence (it knows who
 * recorded it), else the same sentence built here from the view. A
 * recording with no sign for this client (why `picked`) has none (A7.3).
 */
export function whySentence(
  v: CallView,
  seat: Seat,
  clientName: string,
): string {
  if (v.whyText.trim()) return v.whyText.trim();
  const b = v.booking;
  const booked = b
    ? `the ${kindWord(b.kind)} booked for ${kuwaitTime(b.startsAt)}`
    : "the booked call";
  const mine = seat === "csm" && v.recorder === "csm";
  const whose = mine
    ? "Your"
    : `${capital(v.recorderRole?.trim() || "the CSM")}'s`;
  const gap = b
    ? Math.round((Date.parse(v.startsAt) - Date.parse(b.startsAt)) / 60_000)
    : null;
  const client = clientName || "the client";
  switch (v.why) {
    case "same_room":
      return `Same room as ${booked}.`;
    case "invitee_email":
      return "The client was on the invite.";
    case "pasted":
      return "From the Fathom link you pasted.";
    case "matched":
      return `On ${client} in the call store.`;
    case "speaker_name":
      return `${client}'s contact spoke on this call. Is this the call?`;
    case "title":
      return `The call's title names ${client}. Is this the call?`;
    case "domain":
      return `Someone from ${client}'s company was on the invite. Is this the call?`;
    case "near_booking":
      return gap === null
        ? `${whose} recording near ${booked}. Is this the call?`
        : `${whose} recording ${plural(Math.abs(gap), "minute")} ${gap < 0 ? "before" : "after"} ${booked}. Is this the call?`;
    case "hint_window":
      return gap === null
        ? ""
        : `${Math.abs(gap)} min ${gap < 0 ? "before" : "after"} ${client}'s booked call.`;
    case "latest_unlinked":
      return `${whose} newest call that no client has yet (${kuwaitWeekday(v.startsAt)}, ${kuwaitTime(v.startsAt)}). Is this the call?`;
    case "booking":
      return `The ${kindWord(b?.kind ?? "checkin")} booked for ${kuwaitTime(b?.startsAt ?? v.startsAt)}. No recording found for it.`;
    default:
      return v.ask ? "Is this the call?" : "";
  }
}

/** "Sun 25 Oct 10:34–11:08". */
const span = (v: Pick<CallView, "startsAt" | "endsAt">) =>
  v.startsAt
    ? `${kuwaitWeekday(v.startsAt)} ${kuwaitTime(v.startsAt)}${v.endsAt ? `–${kuwaitTime(v.endsAt)}` : ""}`
    : "";
const length = (v: Pick<CallView, "minutes" | "startsAt" | "endsAt">) => {
  const m =
    v.minutes ??
    (v.endsAt
      ? Math.round((Date.parse(v.endsAt) - Date.parse(v.startsAt)) / 60_000)
      : null);
  return m && Number.isFinite(m) && m > 0 ? `${m} min` : null;
};

type Tone = "exact" | "ask" | "neutral";

function Panel({
  tone,
  lampKey,
  children,
}: {
  tone: Tone;
  lampKey: string;
  children: React.ReactNode;
}) {
  return (
    // Its heading names it; no landmark of its own (the window keeps few).
    <section
      className={cn(
        "relative rounded-xl bg-muted/40 p-4 ring-1 transition-shadow motion-reduce:transition-none",
        tone === "exact"
          ? "glow-teal ring-primary/40"
          : tone === "ask"
            ? "ring-warning/60"
            : "ring-border",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          key={lampKey}
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            tone === "exact"
              ? "bg-primary motion-safe:animate-in motion-safe:fade-in motion-safe:duration-[180ms]"
              : tone === "ask"
                ? "bg-warning"
                : "bg-muted-foreground/50",
          )}
        />
        <Kicker as="h2">This call</Kicker>
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

/** A line under the card that needs reading: the warning dot carries it. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-sm" role="status">
      <span className="flex h-5 shrink-0 items-center">
        <Dot tone="warn" />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function FathomState({
  m,
  onCheck,
}: {
  m: CheckinModel;
  /** Check again was pressed (it may go once the call is found). */
  onCheck: () => void;
}) {
  const f = m.calls.answer?.fathom;
  const failedRead = m.calls.status === "failed" && !m.calls.answer;
  const checkAgain = (
    <Button
      size="sm"
      variant="outline"
      // Still focusable while it runs, so focus stays on it.
      aria-disabled={m.calls.checking || undefined}
      className={cn(FOCUS, "aria-disabled:opacity-50")}
      onClick={() => {
        if (m.calls.checking) return;
        onCheck();
        m.checkAgain();
      }}
    >
      <RefreshCw
        aria-hidden
        className={cn(m.calls.checking && "motion-safe:animate-spin")}
      />
      Check again
    </Button>
  );
  if (failedRead || f?.state === "failed") {
    const reason =
      (failedRead
        ? m.calls.error
        : (f?.note?.match(/\(([^)]+)\)\.?$/)?.[1] ?? f?.note)
      )
        ?.trim()
        .replace(/\.$/, "") || "no answer";
    return (
      <div className="space-y-2">
        <p className="text-sm">
          {`Fathom could not be read just now: ${reason}. Check again, paste the Fathom link, or choose No recording.`}
        </p>
        {checkAgain}
      </div>
    );
  }
  if (f?.state === "busy")
    return (
      <div className="space-y-2">
        <p className="text-sm">Fathom is busy. Check again in a minute.</p>
        {checkAgain}
      </div>
    );
  const checked = (
    <div className="flex flex-wrap items-center gap-3">
      {checkAgain}
      {m.calls.checkedAt ? (
        <span className="font-mono text-[11px] text-muted-foreground">
          Checked at {kuwaitTime(m.calls.checkedAt)}.
        </span>
      ) : null}
    </div>
  );
  // No key: the server's sentence for this seat, and Check again, since the
  // worker's next 15-minute read can bring the recording into the store.
  if (f?.state === "off")
    return (
      <div className="space-y-2">
        <p className="text-sm">{offNote(f.note)}</p>
        {checked}
      </div>
    );
  if (f?.state === "waiting")
    return (
      <div className="space-y-2">
        <p className="text-sm">
          Fathom hasn't sent this call yet. It usually takes a few minutes after
          the call ends.
        </p>
        {checked}
      </div>
    );
  return null;
}

/** The meta line: what Fathom holds for this call, and a way into it. */
function Meta({ m, v }: { m: CheckinModel; v: CallView }) {
  if (v.kind !== "fathom") return null;
  const parts: React.ReactNode[] = [];
  if (v.actionItems != null)
    parts.push(<span key="a">{plural(v.actionItems, "action item")}</span>);
  if (v.hasSummary) parts.push(<span key="s">Summary</span>);
  if (!m.rehearse && m.response)
    parts.push(
      <button
        key="t"
        type="button"
        // Still focusable while it reads, so focus stays on it and the
        // transcript sheet gives it back here when it closes.
        aria-disabled={m.transcript.busy || undefined}
        onClick={() => {
          if (!m.transcript.busy) m.openTranscript();
        }}
        className={cn(
          PANEL_INK,
          FIELD_FOCUS,
          "rounded-sm underline-offset-4 hover:underline aria-disabled:cursor-default aria-disabled:opacity-60",
        )}
      >
        View transcript
      </button>,
    );
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i}>
          {i ? " · " : null}
          {p}
        </span>
      ))}
      {v.shareUrl ? (
        <>
          {/* The same separator as the parts: a margin here would indent
              the link when it wraps to its own line on a phone. */}
          {parts.length ? " · " : null}
          <ExtLink
            href={v.shareUrl}
            className={cn(PANEL_INK, FIELD_FOCUS, "rounded-sm")}
          >
            Open in Fathom
          </ExtLink>
        </>
      ) : null}
    </p>
  );
}

export function CheckinCall({
  m,
  onChange,
  changeRef,
}: {
  m: CheckinModel;
  /** Opens the Change sheet. */
  onChange: () => void;
  /** The Change button, where focus goes when a button beside it goes. */
  changeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const call = callOf(m.answers.call);
  const v = m.view;
  const name = m.client?.name ?? "";
  const own = useRef<HTMLButtonElement | null>(null);
  const ref = changeRef ?? own;
  // A check that found the call takes its button away: focus goes to Change.
  const checked = useRef(false);
  useEffect(() => {
    if (m.calls.checking || !checked.current) return;
    checked.current = false;
    if (!document.activeElement || document.activeElement === document.body)
      ref.current?.focus();
  }, [m.calls.checking, ref]);
  const onCheck = () => {
    checked.current = true;
  };
  // A saved call that can no longer be used (gone, moved) says why.
  const blocked = v ? blockedOf(v) : null;
  const change = (
    <Button
      ref={ref}
      size="sm"
      variant="outline"
      className={FOCUS}
      onClick={onChange}
      disabled={m.rehearse || m.send.kind === "sending"}
    >
      {call || v ? "Change" : "Pick the call"}
    </Button>
  );

  let body: React.ReactNode;
  let tone: Tone = "neutral";
  if (call?.kind === "none") {
    body = (
      <>
        <p className="text-sm">
          {/* In a shadow run or a rehearsal nothing goes on the card. */}
          {m.shadow || m.rehearse
            ? "No recording. The call is not graded and no recap is drafted."
            : "No recording. The notes go on the card without one; the call is not graded and no recap is drafted."}
        </p>
        <div className="flex flex-wrap gap-2">{change}</div>
      </>
    );
  } else if (v) {
    const sure = call ? confirmed(call) : false;
    const question = !sure && !blocked && v.kind === "fathom";
    tone =
      v.kind === "booking" || blocked ? "neutral" : question ? "ask" : "exact";
    // A view that reads as pasted says which link it was: the one pasted
    // here, or one in an earlier 1-1 form (the server's own sentence).
    const why =
      call?.kind === "fathom" && call.why === "picked"
        ? "You picked it."
        : call?.kind === "fathom" && call.why === "pasted" && v.why !== "pasted"
          ? "From the Fathom link you pasted."
          : whySentence(v, m.seat, name);
    const sentence = sure || blocked ? why.replace(ASK, "") : why;
    const ask = question && !/Is this the call\?/.test(sentence);
    body = (
      <>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="min-w-0 font-medium" dir="auto">
            {v.kind === "booking"
              ? `Booked ${kindWord(v.booking?.kind ?? "checkin")}`
              : v.title || "Fathom recording"}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {span(v)}
          </span>
          {length(v) ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {length(v)}
            </span>
          ) : null}
        </div>
        {sentence || ask ? (
          <p className="text-sm leading-6">
            {sentence}
            {ask ? " Is this the call?" : ""}
          </p>
        ) : null}
        <Meta m={m} v={v} />
        <div className="flex flex-wrap gap-2 pt-1">
          {question ? (
            <Button
              size="sm"
              variant="outline"
              className={cn(FOCUS, INK, "border-primary/50")}
              onClick={() => {
                m.confirmCall();
                // Yes goes once the call is confirmed: focus stays on the card.
                ref.current?.focus();
              }}
              disabled={m.rehearse || m.send.kind === "sending"}
            >
              Yes, this call
            </Button>
          ) : null}
          {change}
        </div>
      </>
    );
  } else if (m.calls.status === "loading") {
    body = (
      <p className="text-sm text-muted-foreground">
        Looking for this call in Fathom…
      </p>
    );
  } else {
    const state = <FathomState m={m} onCheck={onCheck} />;
    body = (
      <>
        {/* The send bar says what to do (8.5); the card only says where it stands. */}
        {m.calls.answer?.fathom.state === "ok" && m.calls.status === "ready" ? (
          <p className="text-sm">No call picked yet.</p>
        ) : (
          state
        )}
        <div className="flex flex-wrap gap-2">{change}</div>
      </>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        tone={tone}
        lampKey={`${callOf(m.answers.call)?.kind ?? "none"}:${confirmed(call)}`}
      >
        {body}
        {/* The rest still fills while Fathom has not sent the recording. */}
        {v && call?.kind !== "fathom" ? (
          <FathomState m={m} onCheck={onCheck} />
        ) : null}
      </Panel>
      {m.callError ? (
        <Note>{m.callError}</Note>
      ) : blocked ? (
        <Note>{blocked}</Note>
      ) : null}
      {m.transcript.error ? <Note>{m.transcript.error}</Note> : null}
      {m.repicked ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Note>
            The drafts were for the {kuwaitTime(m.repicked.at)} recording.
          </Note>
          <Button
            size="sm"
            variant="outline"
            className={FOCUS}
            onClick={() => {
              m.redraft();
              ref.current?.focus();
            }}
          >
            Draft again from this call
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the Change sheet

/**
 * Move it here (docs/forms/STAGE2B-CONTRACT.md 4.11, 5.3): beside a
 * recording on another client, for an admin or the CEO while the switch is
 * on (the door's `movable`), a sibling of the disabled row (a disabled
 * button cannot hold a button) and an explicit confirm.
 */
export function canMove(v: CallView, m: CheckinModel): boolean {
  return (
    v.movable &&
    m.seat === "admin" &&
    !m.rehearse &&
    m.send.kind !== "sending" &&
    v.kind === "fathom" &&
    Boolean(v.recordingId)
  );
}

function MoveHere({
  v,
  m,
  onMoved,
  describedBy,
}: {
  v: CallView;
  m: CheckinModel;
  /** Moved and picked: the sheet closes on the call card, now teal. */
  onMoved: () => void;
  /**
   * The ids of the row's title, time and sentence. The row is a disabled
   * button, which Tab skips, so this is how a screen reader hears which
   * recording this button moves when two say "Move it here".
   */
  describedBy: string;
}) {
  const [open, setOpen] = useState(false);
  const client = m.client?.name || "this client";
  const other = v.otherClient || "another client";
  const busy = m.move.busy && m.move.ref === v.ref;
  const error = !m.move.busy && m.move.ref === v.ref ? m.move.error : null;
  const errorId = useId();
  // The confirm's safe answer takes focus when it opens. Radix's alert
  // dialog focuses only an AlertDialogCancel, and Keep is a plain button
  // (it must stay while a move runs), so without this focus stays on the
  // trigger behind the modal, where a screen reader never hears the dialog.
  const keepRef = useRef<HTMLButtonElement>(null);
  async function go() {
    if (m.move.busy) return;
    const moved = await m.moveHere(v);
    setOpen(false);
    if (moved) {
      toast.success(`Moved to ${client}.`);
      onMoved();
    }
  }
  return (
    <div className="space-y-1.5 px-3 pb-2.5">
      <div className="flex justify-end">
        <AlertDialog
          open={open}
          onOpenChange={o => {
            // While it moves, the dialog stays: the answer comes to it.
            if (!busy) setOpen(o);
            if (o) m.clearMove();
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className={FOCUS}
              aria-describedby={
                [describedBy, error ? errorId : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              Move it here
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            className="motion-reduce:animate-none!"
            onOpenAutoFocus={e => {
              e.preventDefault();
              keepRef.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Move this recording to <bdi>{client}</bdi>?
              </AlertDialogTitle>
              <AlertDialogDescription>
                It leaves <bdi>{other}</bdi>'s Calls card and goes on{" "}
                <bdi>{client}</bdi>'s. The move is recorded with your name.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                ref={keepRef}
                variant="outline"
                // Rests while the move runs: dimmed, the pointer says no.
                className={cn(
                  FOCUS,
                  "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
                )}
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) setOpen(false);
                }}
              >
                {/* One flex item, so the button's gap never splits the words. */}
                <span>
                  Keep it on <bdi>{other}</bdi>
                </span>
              </Button>
              <Button
                className={cn(FOCUS, "aria-disabled:opacity-70")}
                aria-disabled={busy || undefined}
                onClick={() => void go()}
              >
                {busy ? "Moving…" : "Move it here"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error ? (
        <p id={errorId} className="flex gap-2 text-xs" role="alert">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="bad" />
          </span>
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function Row({
  v,
  m,
  current,
  onPick,
  onMoved,
}: {
  v: CallView;
  m: CheckinModel;
  current: boolean;
  onPick: (v: CallView) => void;
  onMoved: () => void;
}) {
  const blocked = blockedOf(v);
  // One that cannot be picked says why instead of its why line; a
  // recording with no sign for this client has no why line.
  const said =
    blocked ?? whySentence(v, m.seat, m.client?.name ?? "").replace(ASK, "");
  // Who recorded it, unless the why line already says so ("The sales
  // closer's recording ..."). A disabled row always keeps it: a refusal
  // sentence never names the recorder, and every one says "ask an admin",
  // which would hide "By an admin". A recording on a client this seat may
  // not see shows only its time, its length and this (8.5, A7.3, A7.17).
  // A booked call has no recorder.
  const role =
    v.kind === "fathom" &&
    v.recorder &&
    v.recorder !== "csm" &&
    v.recorderRole &&
    (blocked || !said.toLowerCase().includes(v.recorderRole.toLowerCase()))
      ? `By ${v.recorderRole}`
      : null;
  const line = [role, said].filter(Boolean).join(" · ");
  // Move it here is described by this row's title, time and sentence.
  const id = useId();
  return (
    <li>
      <button
        type="button"
        disabled={Boolean(blocked) || m.rehearse || m.send.kind === "sending"}
        aria-current={current || undefined}
        onClick={() => onPick(v)}
        className={cn(
          FIELD_FOCUS,
          "w-full rounded-lg px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
          current
            ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
            : "hover:bg-muted/60 active:bg-muted",
          blocked && "opacity-70",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            id={`${id}-title`}
            className="min-w-0 text-sm font-medium"
            dir="auto"
          >
            {v.kind === "booking"
              ? `Booked ${kindWord(v.booking?.kind ?? "checkin")}`
              : v.title || "Fathom recording"}
          </span>
          <span
            id={`${id}-time`}
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
          >
            {span(v)}
            {length(v) ? ` · ${length(v)}` : ""}
          </span>
          {v.notesAlready ? (
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[11px] text-muted-foreground">
              <Dot tone="neutral" />
              Has notes
            </span>
          ) : null}
        </span>
        {line ? (
          <span
            id={`${id}-line`}
            className="mt-0.5 block text-xs text-muted-foreground"
          >
            {line}
          </span>
        ) : null}
      </button>
      {blocked && canMove(v, m) ? (
        <MoveHere
          v={v}
          m={m}
          onMoved={onMoved}
          describedBy={[`${id}-title`, `${id}-time`, line ? `${id}-line` : null]
            .filter(Boolean)
            .join(" ")}
        />
      ) : null}
    </li>
  );
}

export function CallSheet({
  m,
  open,
  onOpenChange,
  returnFocus,
}: {
  m: CheckinModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close when what opened the sheet is gone. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const id = useId();
  const focus = useReturnFocus(() => returnFocus?.());
  const [link, setLink] = useState("");
  const call = callOf(m.answers.call);
  const current = m.view?.ref ?? null;
  const all = [
    ...(m.calls.answer?.picked ? [m.calls.answer.picked] : []),
    ...(m.calls.answer?.others ?? []),
  ].filter((v, i, list) => list.findIndex(x => x.ref === v.ref) === i);
  const recordings = all.filter(v => v.kind === "fathom");
  const bookings = all.filter(v => v.kind === "booking");
  const off = m.calls.answer?.fathom.state === "off";
  const pickAndClose = (v: CallView) => {
    m.pick(v);
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg">Pick the call</SheetTitle>
          <SheetDescription>
            The notes, DEFCON and the to-dos go with the call you pick.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-6">
          {/* Headings under the sheet's title, not landmarks of their own. */}
          <section className="space-y-1.5">
            <Kicker as="h3">Recordings since yesterday</Kicker>
            {recordings.length ? (
              <ul className="-mx-3 space-y-0.5">
                {recordings.map(v => (
                  <Row
                    key={v.ref}
                    v={v}
                    m={m}
                    current={v.ref === current}
                    onPick={pickAndClose}
                    onMoved={() => onOpenChange(false)}
                  />
                ))}
              </ul>
            ) : off ? null : (
              <p className="text-sm text-muted-foreground">
                No recording since yesterday yet.
              </p>
            )}
            {/* No key: only the store's recordings are listed, and more can
                come with the next 15-minute read. */}
            {off ? (
              <p className="text-sm text-muted-foreground">
                {offNote(m.calls.answer?.fathom.note)}
              </p>
            ) : null}
          </section>
          {bookings.length ? (
            <section className="space-y-1.5">
              <Kicker as="h3">Booked calls</Kicker>
              <ul className="-mx-3 space-y-0.5">
                {bookings.map(v => (
                  <Row
                    key={v.ref}
                    v={v}
                    m={m}
                    current={v.ref === current}
                    onPick={pickAndClose}
                    onMoved={() => onOpenChange(false)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          <form
            className="space-y-2"
            onSubmit={e => {
              e.preventDefault();
              if (m.paste.busy) return;
              void m.pasteLink(link).then(ok => {
                if (ok) {
                  setLink("");
                  onOpenChange(false);
                }
              });
            }}
          >
            <label htmlFor={`${id}-link`} className="block">
              <Kicker>Paste a Fathom link</Kicker>
            </label>
            <div className="flex gap-2">
              <input
                id={`${id}-link`}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder="https://fathom.video/share/…"
                disabled={m.rehearse}
                className={cn(
                  FIELD_FOCUS,
                  "h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-xs",
                )}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className={cn(FOCUS, "h-9 aria-disabled:opacity-50")}
                disabled={m.rehearse || !link.trim()}
                // Still focusable while it looks, so focus stays on it.
                aria-disabled={m.paste.busy || undefined}
              >
                {m.paste.busy ? "Finding it…" : "Find it"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A share link or a call page link, with or without a timestamp; any
              date.
            </p>
            {m.paste.unknown ? (
              <Note>
                That link is not in the cockpit yet. Fathom sends recordings a
                few minutes after a call ends. Check again in a minute.
              </Note>
            ) : m.paste.error ? (
              <Note>{m.paste.error}</Note>
            ) : null}
          </form>
          <div className="border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              className={FOCUS}
              aria-pressed={call?.kind === "none"}
              disabled={m.rehearse || m.send.kind === "sending"}
              onClick={() => {
                m.pickNone();
                onOpenChange(false);
              }}
            >
              No recording
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
