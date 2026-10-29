import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowUpRight, ChevronRight, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BookCallButton } from "@/components/ClientCheckIn";
import { Dot, Kicker, LINK_INK } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MessagesIO } from "@/lib/clientMessages";
import { readClientTimeline } from "@/lib/csmCalls";
import { displayLabel, plural, shortDay } from "@/lib/format";
import { openTypeform } from "@/lib/formsRegistry";
import { cn } from "@/lib/utils";
import { CallSheet, CheckinCall, useReturnFocus } from "./CheckinCall";
import {
  type BookSlot,
  ChoiceField,
  FOCUS,
  NextCheckin,
  NOTES_FONT,
  NotesField,
  TodosFields,
} from "./CheckinFields";
import { CheckinRecap } from "./CheckinRecap";
import {
  discardCheckin,
  draftAgain,
  type FormClient,
  moveRecording,
  openCheckin,
  readCalls,
  readResponse,
  readTranscriptLink,
  saveCheckin,
  startDrafts,
  submitCheckin,
} from "./checkinClient";
import { callOf } from "./checkinForm";
import {
  cardHappiness,
  kuwaitWeekday,
  kuwaitWhen,
  type RailFacts,
  railFacts,
} from "./checkinRail";
import {
  type StopTone,
  type TrailStop,
  trailNote,
  trailStops,
} from "./checkinTrail";
import { Seal } from "./FormPanel";
import { kuwaitDay, kuwaitShortDay, kuwaitTime } from "./formTime";
import { announceForm } from "./OpenFormButton";
import { messagesIO } from "./RecapApproval";
import {
  type CheckinIO,
  type CheckinModel,
  type Clock,
  notSavedText,
  type Seat,
  useCheckin,
} from "./useCheckin";

/**
 * The 1-1 notes window, /clients/:key/forms/checkin (docs/forms/STAGE2-
 * CONTRACT.md 8): the CSM's after-call sheet for one client, filled minutes
 * after a check-in from Fathom's own record. Its own window, like the
 * kickoff's: no app shell, nothing else takes focus. The call is the
 * headline (CheckinCall), the answers sit under it, what the cockpit knows
 * sits beside it, and the send bar stays at the bottom. After the send the
 * rail's top becomes the trail and the form column the recap step.
 *
 * Until the cut-over every response is a shadow run: saved, sent, every
 * effect planned and nothing delivered. The seal says so on itself.
 */

/**
 * The teal buttons' focus. button.tsx draws a 1px ring in the fill's own
 * teal, which cannot be seen on a teal button; this one sits 2px off the
 * fill in the ink colour (teal on Deep Space, #00807B on white), so it
 * holds 3:1 against the page in both themes. Every other button in the
 * window takes the same ring (CheckinFields' FOCUS).
 */
export const TEAL_FOCUS = FOCUS;

/** The calls the window makes, through the seat's own client. */
export function checkinIO(
  client: FormClient | null,
  taskId: string,
): CheckinIO {
  return {
    open: a => openCheckin(client, a),
    save: a => saveCheckin(client, a),
    submit: a => submitCheckin(client, a),
    discard: id => discardCheckin(client, id),
    read: id => readResponse(client, id),
    drafts: id => startDrafts(client, id),
    draftAgain: (id, kind) => draftAgain(client, id, kind),
    calls: a => readCalls(client, a),
    transcript: (id, rec) => readTranscriptLink(client, id, rec),
    move: a => moveRecording(client, a),
    timeline: async () => {
      if (!client) throw Error("Sign in to the cockpit first.");
      return readClientTimeline(client as SupabaseClient, taskId);
    },
    announce: announceForm,
  };
}

export default function CheckinWindow({
  taskId,
  rehearse,
}: {
  taskId: string;
  rehearse: boolean;
}) {
  const auth = useCockpitAuth();
  const client = auth.client as FormClient | null;
  const io = useMemo(() => checkinIO(client, taskId), [client, taskId]);
  const messages = useMemo(() => messagesIO(client), [client]);
  const seat: Seat = auth.isAdmin || auth.isCeo ? "admin" : "csm";
  const m = useCheckin({ taskId, rehearse, seat, io });
  return (
    <CheckinWindowView
      m={m}
      messages={messages}
      onTypeform={lastCall => openTypeform(client, taskId, lastCall)}
      book={p => (
        <BookCallButton
          taskId={taskId}
          clientName={m.client?.name ?? ""}
          stage={m.client?.stage ?? undefined}
          kind="checkin"
          onBooked={receipt => p.onBooked(receipt.startTime)}
        >
          Book the next check-in
        </BookCallButton>
      )}
    />
  );
}

function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`;
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia(query);
    const h = () => setOn(q.matches);
    q.addEventListener?.("change", h);
    return () => q.removeEventListener?.("change", h);
  }, [query]);
  return on;
}

export interface CheckinWindowViewProps {
  m: CheckinModel;
  /** Opens the client's 1-1 form in Typeform (the record until the cut-over). */
  onTypeform: (lastCall: string | null) => void;
  /** The cockpit's booking button; a live response only. */
  book?: (p: BookSlot) => ReactNode;
  /**
   * The polls' clock, for the rail's "now" and the recap step's message
   * reads; the tests pass their own. Left out, the browser's.
   */
  clock?: Pick<Clock, "now" | "set" | "clear">;
  /** The harness opens on the Change sheet. */
  initialSheet?: boolean;
  /**
   * The client's messages, for a live response's recap step
   * (docs/forms/STAGE2B-CONTRACT.md 4.15 item 1); the harness passes its own.
   */
  messages?: MessagesIO | null;
}

/** The window as drawn: header, banners, the form column, the rail, the send bar. */
export function CheckinWindowView({
  m,
  onTypeform,
  book,
  clock,
  initialSheet = false,
  messages = null,
}: CheckinWindowViewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState(initialSheet);
  const transcriptFocus = useReturnFocus(() => titleRef.current);
  const desk = useMinWidth(1024);
  const name = m.client?.name ?? "";
  const call = callOf(m.answers.call);
  const lastCall =
    (call && call.kind !== "none" ? call.startsAt : null) ?? null;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  // The page changes under focus when the notes open, reopen or start
  // again: the title takes it unless something else has it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new phase is a new page
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body)
      titleRef.current?.focus();
  }, [m.phase.kind]);
  useEffect(() => {
    document.title = name
      ? `1-1 notes · ${name}`
      : "1-1 notes · Client Success";
  }, [name]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new read is a new now
  const now = useMemo(
    () => clock?.now() ?? Date.now(),
    [clock, m.rail.timeline],
  );
  const facts = useMemo(
    () =>
      m.client
        ? railFacts({
            timeline: m.rail.timeline,
            client: {
              name: m.client.name,
              stage: m.client.stage,
              happiness: m.client.happiness,
            },
            now,
          })
        : null,
    [m.client, m.rail.timeline, now],
  );

  const header = (
    <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="order-1 text-lg font-semibold tracking-tight outline-none sm:order-none"
      >
        1-1 notes
      </h1>
      {/* On a phone the title and Close keep the first row; the seal and
          the save line take the next. */}
      <div className="order-3 flex min-w-0 max-w-full basis-full flex-wrap items-center gap-x-3 gap-y-1 sm:order-none sm:basis-auto">
        {m.client ? (
          <Seal
            clientName={m.client.name}
            taskId={m.taskId}
            // The name is the check that these are the right notes for the
            // right card: on a phone it wraps instead of being cut.
            wrapName
            glow={!m.shadow && !m.rehearse && !m.sent}
            rehearse={m.shadow || m.rehearse}
            kicker={
              m.rehearse
                ? "Rehearsal · notes for"
                : m.shadow
                  ? "Shadow · notes for"
                  : "Notes for"
            }
            why={
              m.rehearse
                ? "A rehearsal: nothing is saved, nothing reaches this card, and nothing is sent."
                : m.shadow
                  ? "From the client record. In a shadow run nothing reaches this card: every effect is written down as a plan."
                  : "From the client record. Your notes go to this card when you send them."
            }
            whyLabel="Why these notes go to this card"
          />
        ) : (
          <span className="font-mono text-[13px] text-muted-foreground">
            {m.taskId}
          </span>
        )}
        {m.phase.kind === "ready" && !m.rehearse && !m.sent ? (
          <SaveLine m={m} />
        ) : null}
      </div>
      <div className="order-2 ml-auto sm:order-none">
        <Button
          size="icon"
          variant="ghost"
          className={cn(FOCUS, "size-8")}
          aria-label="Close this window"
          onClick={() => window.close()}
        >
          <X aria-hidden />
        </Button>
      </div>
    </header>
  );

  if (m.phase.kind !== "ready")
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {header}
        <main className="flex min-h-0 flex-1 flex-col">
          {m.phase.kind === "loading" ? (
            <Plain>Loading the notes…</Plain>
          ) : (
            <Plain
              actions={
                m.phase.reason === "list" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={FOCUS}
                    onClick={() => window.close()}
                  >
                    Close this window
                  </Button>
                ) : m.phase.reason === "live" ? (
                  <Button
                    size="sm"
                    className={TEAL_FOCUS}
                    onClick={() => onTypeform(null)}
                  >
                    Open the 1-1 form
                    <ArrowUpRight aria-hidden />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className={FOCUS}
                    onClick={m.retry}
                  >
                    Try again
                  </Button>
                )
              }
            >
              {m.phase.text}
            </Plain>
          )}
        </main>
      </div>
    );

  const stops = m.sent
    ? trailStops(m.sent.effects, {
        taskId: m.taskId,
        clientName: name,
        answers: m.sent.response.answers,
        submittedAt: m.sent.response.submittedAt,
        // The card writer's 15-minute line reads the browser's clock (Z47).
        now: clock?.now() ?? Date.now(),
      })
    : null;
  const rail = <Rail m={m} facts={facts} stops={stops} />;

  // From lg the window is one screen tall and each column scrolls on its
  // own (8.1). Every scroller is positioned, so a screen-reader line (sr-only
  // is position:absolute) belongs to the column it sits in and is clipped
  // there; unpositioned, its containing block is the page, and the page
  // grows and scrolls the header and the seal away. The root is positioned
  // and clips at lg too, so nothing can make the page scroll there.
  // Below lg the page scrolls under the sticky send bar, so while the window
  // is open the page keeps 8rem clear at its bottom edge: a control that
  // takes focus, a text field's caret included, stops above the bar, never
  // under it (WCAG 2.4.11).
  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh lg:overflow-hidden max-lg:[html:has(&)]:scroll-pb-32">
      {header}
      {m.save.kind === "error" && !m.sent ? (
        <p className="callout-warn border-b px-4 py-2 text-sm" role="alert">
          {notSavedText(m.save.message)}
        </p>
      ) : null}
      {/* Below lg the fold takes its own height and the form the rest, so a
          short sent screen leaves no empty band under the fold. */}
      <main className="grid min-h-0 flex-1 grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* <main> is the landmark; the column needs none of its own. */}
        <section className="flex min-w-0 flex-col lg:min-h-0">
          <div
            data-checkin-column
            className="relative flex-1 lg:min-h-0 lg:overflow-y-auto"
          >
            <div className="mx-auto w-full max-w-4xl space-y-7 px-4 py-5 sm:px-6 sm:py-6">
              <Banners
                m={m}
                onTypeform={() => onTypeform(lastCall)}
                onPickAnother={() => setSheet(true)}
                onFinished={() => changeRef.current?.focus()}
              />
              {m.sent ? (
                <CheckinRecap
                  recap={m.recap}
                  call={callOf(m.sent.response.answers.call)}
                  effect={m.sent.effects.find(e => e.key === "recap") ?? null}
                  onDraftAgain={m.rehearse ? undefined : m.recapAgain}
                  asking={m.recapAsking}
                  error={m.recapError}
                  refused={m.recapRefused}
                  live={m.sent.response.mode === "live"}
                  messages={m.rehearse ? null : messages}
                  taskId={m.taskId}
                  responseId={m.sent.response.id}
                  sentAt={m.sent.response.submittedAt}
                  clock={clock}
                />
              ) : (
                <>
                  <CheckinCall
                    m={m}
                    onChange={() => setSheet(true)}
                    changeRef={changeRef}
                  />
                  <ChoiceField
                    m={m}
                    k="defcon"
                    aside={cardHappiness(m.client?.happiness)}
                  />
                  <ChoiceField m={m} k="priority" />
                  <TodosFields m={m} />
                  <NotesField m={m} />
                  <NextCheckin
                    m={m}
                    next={facts?.nextCheckin ?? null}
                    book={book}
                  />
                </>
              )}
            </div>
          </div>
          <SendBar m={m} onTypeform={() => onTypeform(lastCall)} />
        </section>
        <aside
          aria-label="What the cockpit knows"
          data-checkin-rail
          className="relative order-first border-b bg-card lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-l"
        >
          {desk ? (
            rail
          ) : (
            <details className="group/fold">
              <summary className="no-marker flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ink">
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open/fold:rotate-90 motion-reduce:transition-none"
                />
                <span className="min-w-0 truncate">
                  {stops
                    ? `After the send · ${plural(stops.length, "step")}`
                    : `What the cockpit knows${
                        facts?.last
                          ? ` · last 1-1 ${shortDay(facts.last.day)}`
                          : ""
                      }`}
                </span>
              </summary>
              <div className="relative max-h-[55dvh] overflow-y-auto border-t">
                {rail}
              </div>
            </details>
          )}
        </aside>
      </main>
      <CallSheet
        m={m}
        open={sheet}
        onOpenChange={setSheet}
        returnFocus={() => changeRef.current ?? titleRef.current}
      />
      <Sheet
        open={Boolean(m.transcript.text)}
        onOpenChange={o => !o && m.closeTranscript()}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
          onOpenAutoFocus={transcriptFocus.onOpenAutoFocus}
          onCloseAutoFocus={transcriptFocus.onCloseAutoFocus}
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-lg">The call's transcript</SheetTitle>
            <SheetDescription>
              Read from Fathom for this window; the cockpit does not keep it.
            </SheetDescription>
          </SheetHeader>
          <pre
            dir="auto"
            style={NOTES_FONT}
            className="mt-4 whitespace-pre-wrap break-words text-sm leading-6"
          >
            {m.transcript.text}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Plain({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="m-auto w-full max-w-md space-y-4 p-8 text-center">
      <p className="text-balance text-[15px] leading-6" role="status">
        {children}
      </p>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function SaveLine({ m }: { m: CheckinModel }) {
  const s = m.save;
  // A screen reader hears the save only when it matters: the first save in
  // this window, and a save that works again after one failed (the failure
  // itself is said by its alert). "Saving…" and every later "Saved" stay on
  // screen only, so a pause in typing is not read out twice each time.
  const [said, setSaid] = useState("");
  const first = useRef(true);
  const failed = useRef(false);
  useEffect(() => {
    if (s.kind === "error") {
      failed.current = true;
      return;
    }
    if (s.kind !== "saved" || !(first.current || failed.current)) return;
    first.current = false;
    failed.current = false;
    setSaid(`Saved ${kuwaitTime(s.at)}`);
  }, [s]);
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {s.kind === "saving"
          ? "Saving…"
          : s.kind === "saved"
            ? `Saved ${kuwaitTime(s.at)}`
            : s.kind === "error"
              ? "Not saved"
              : "Changes save as you type."}
      </span>
      <span className="sr-only" role="status">
        {said}
      </span>
    </>
  );
}

// ------------------------------------------------------------ banners

function Banner({
  tone = "warn",
  children,
  extra,
  actions,
}: {
  tone?: "warn" | "neutral";
  children: ReactNode;
  /** A second, quieter line under the first (a fact folded in, not its own banner). */
  extra?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted/40 px-4 py-3 text-sm ring-1",
        tone === "warn" ? "ring-warning/40" : "ring-border",
      )}
      role="note"
    >
      <p className="flex min-w-0 flex-1 basis-72 gap-2.5 leading-6">
        <span className="flex h-6 shrink-0 items-center">
          <Dot tone={tone} />
        </span>
        <span className="min-w-0">
          {children}
          {extra ? (
            <span className="mt-0.5 block text-muted-foreground">{extra}</span>
          ) : null}
        </span>
      </p>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * The banners above the card: at most two, so a phone still shows the call.
 * The first is the run's (a shadow run, a rehearsal, notes started as a
 * shadow run), with "You started these notes at…" folded into it. The
 * second is about the call: unsent notes for an older call, else notes that
 * call already has.
 */
function Banners({
  m,
  onTypeform,
  onPickAnother,
  onFinished,
}: {
  m: CheckinModel;
  onTypeform: () => void;
  onPickAnother: () => void;
  /** "Finish them" takes its banner away: focus goes to the call. */
  onFinished: () => void;
}) {
  if (m.sent) return null;
  const out: ReactNode[] = [];
  const resumed = m.resumed
    ? `You started these notes at ${kuwaitTime(m.resumed.at)} on ${kuwaitWeekday(m.resumed.at)}. Everything you typed is here.`
    : null;
  // The Typeform already holds this call's 1-1 form: nothing more to fill
  // there, and no button that would open a second one.
  const inTypeform = m.already?.source === "typeform";
  let run: ReactNode = null;
  if (m.startedShadow)
    run = (
      <Banner
        key="started"
        extra={resumed}
        actions={
          <Button
            size="sm"
            variant="outline"
            className={FOCUS}
            onClick={() => void m.discardRestart()}
          >
            Discard and start again
          </Button>
        }
      >
        These notes were started as a shadow run. Discard them and start again.
      </Banner>
    );
  else if (m.rehearse)
    run = (
      <Banner key="rehearse">
        Rehearsal. Nothing is saved, nothing reaches the card, and nothing is
        sent.
      </Banner>
    );
  else if (m.shadow)
    run =
      m.seat === "csm" ? (
        inTypeform ? (
          <Banner key="shadow" extra={resumed}>
            Shadow run. The Typeform is still the record, and there is nothing
            more to fill there for this call.
          </Banner>
        ) : (
          <Banner
            key="shadow"
            extra={resumed}
            actions={
              <Button
                size="sm"
                variant="outline"
                className={FOCUS}
                onClick={onTypeform}
              >
                Open the 1-1 form
                <ArrowUpRight aria-hidden />
              </Button>
            }
          >
            Shadow run. The Typeform is still the record. Fill it as usual so
            Make updates the card, grades the call and drafts the recap.
          </Banner>
        )
      ) : (
        <Banner key="shadow" extra={resumed}>
          Shadow run. Your notes are saved in the cockpit and every effect is
          written down as a plan. Nothing reaches the card, Slack or the client;
          Make still does all of it from the Typeform.
        </Banner>
      );
  if (run) out.push(run);
  else if (resumed)
    out.push(
      <Banner key="resumed" tone="neutral">
        {resumed}
      </Banner>,
    );
  const sentAt = m.already ? kuwaitTime(m.already.at) : "";
  if (m.other) {
    // Each call by its day, or by its time when both are on the same day.
    const sameDay = kuwaitDay(m.other.day) === kuwaitDay(m.other.newest);
    const older = sameDay
      ? kuwaitTime(m.other.day)
      : kuwaitShortDay(m.other.day);
    const newer = sameDay
      ? kuwaitTime(m.other.newest)
      : kuwaitShortDay(m.other.newest);
    out.push(
      <Banner
        key="other"
        extra={
          <>
            {/* Starting new notes discards these (one draft per seat and client). */}
            {`Starting notes for the ${newer} call discards these.`}
            {m.already
              ? ` The ${older} call already has 1-1 notes${inTypeform ? " in the Typeform" : ""}, sent at ${sentAt}.`
              : null}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className={FOCUS}
              onClick={() => {
                m.finishOther();
                onFinished();
              }}
            >
              Finish them
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={FOCUS}
              onClick={() => void m.startForThisCall()}
            >
              {`Start notes for the ${newer} call`}
            </Button>
          </>
        }
      >
        {/* The button names the newest call: the card above still shows the
            older call these notes were for, so "this call" would mislead. */}
        {`You have unsent notes for the ${older} call. The newest call is ${kuwaitWhen(m.other.newest)}.`}
      </Banner>,
    );
  } else if (m.already)
    out.push(
      <Banner
        key="already"
        actions={
          <Button
            size="sm"
            variant="outline"
            className={FOCUS}
            onClick={onPickAnother}
          >
            Pick another call
          </Button>
        }
      >
        {inTypeform
          ? `This call already has 1-1 notes in the Typeform, sent at ${sentAt}.`
          : `This call already has 1-1 notes, sent at ${sentAt}.`}
      </Banner>,
    );
  if (!out.length) return null;
  return <div className="space-y-2">{out}</div>;
}

// ------------------------------------------------------------ the send bar

function SendBar({
  m,
  onTypeform,
}: {
  m: CheckinModel;
  onTypeform: () => void;
}) {
  const sending = m.send.kind === "sending";
  const shadow = m.shadow;
  const sentRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  // Refused because another window saved these notes since they were read:
  // Send waits until they are read again, and focus goes to the button that
  // does it, then back to Send.
  const stale = m.send.kind === "refused" && Boolean(m.send.stale);
  const wasStale = useRef(false);
  useEffect(() => {
    if (stale) againRef.current?.focus();
    else if (wasStale.current) sendRef.current?.focus();
    wasStale.current = stale;
  }, [stale]);
  const inTypeform = m.already?.source === "typeform";
  // One live region from the start, so the send is said as it happens
  // (a region that arrives holding its text is often not read).
  const [said, setSaid] = useState("");
  const sentText = m.sent
    ? m.sent.response.mode === "shadow"
      ? `Sent in shadow at ${kuwaitTime(m.sent.response.submittedAt)}. Nothing reached the card, Slack or the client.`
      : "Notes sent."
    : "";
  // After the send the button is gone: focus moves to the sent line, which
  // is read as it takes focus; the region says it only if focus could not.
  const was = useRef(m.send.kind);
  useEffect(() => {
    const before = was.current;
    was.current = m.send.kind;
    if (m.send.kind === "sending")
      setSaid(shadow ? "Sending in shadow…" : "Sending the notes…");
    else if (m.send.kind === "sent" && before === "sending") {
      sentRef.current?.focus();
      setSaid(document.activeElement === sentRef.current ? "" : sentText);
    } else setSaid("");
  }, [m.send.kind, shadow, sentText]);
  let body: ReactNode;
  if (m.sent) {
    body =
      m.sent.response.mode === "shadow" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div
            ref={sentRef}
            tabIndex={-1}
            className="mr-auto min-w-0 space-y-0.5 rounded-md outline-none"
          >
            <p className="text-sm font-medium">{sentText}</p>
            {m.seat === "csm" ? (
              <p className="text-sm text-muted-foreground">
                {inTypeform && m.already
                  ? `The Typeform already has this call's 1-1 notes, sent at ${kuwaitTime(m.already.at)}, so there is nothing more to send.`
                  : "Now send the 1-1 form in Typeform: it is still the record."}
              </p>
            ) : null}
          </div>
          {m.seat === "csm" && !inTypeform ? (
            <Button size="sm" className={TEAL_FOCUS} onClick={onTypeform}>
              Open the 1-1 form
              <ArrowUpRight aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : (
        <div ref={sentRef} tabIndex={-1} className="rounded-md outline-none">
          <p className="text-sm font-medium">{sentText}</p>
        </div>
      );
  } else {
    const reason = m.rehearse
      ? "Rehearsal: nothing is sent."
      : m.startedShadow
        ? "Discard these notes and start again to send."
        : sending || stale
          ? null
          : m.block;
    body = (
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <p
          className="mr-auto min-w-0 text-sm text-muted-foreground"
          aria-live="polite"
        >
          {reason}
        </p>
        <Button
          ref={sendRef}
          className={cn(TEAL_FOCUS, "aria-disabled:opacity-50")}
          onClick={() => {
            if (!sending) void m.sendNotes();
          }}
          // While it sends it stays focusable (and does nothing), so focus
          // stays on it until the sent line takes it, or a refusal shows.
          aria-disabled={sending || undefined}
          disabled={
            m.rehearse ||
            m.startedShadow ||
            stale ||
            (!sending && Boolean(m.block)) ||
            !m.response
          }
        >
          {/* A rehearsal is not a shadow run: its button sends nothing. */}
          {m.rehearse
            ? "Send"
            : sending
              ? shadow
                ? "Sending in shadow…"
                : "Sending the notes…"
              : shadow
                ? "Send in shadow"
                : "Send the notes"}
        </Button>
      </div>
    );
  }
  return (
    <div
      className="sticky bottom-0 z-10 border-t bg-background/95 pt-3 backdrop-blur"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6">
        {body}
        {m.send.kind === "refused" ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="flex min-w-0 gap-2 text-sm" role="alert">
              <span className="flex h-5 shrink-0 items-center">
                <Dot tone="bad" />
              </span>
              <span className="min-w-0">{m.send.text}</span>
            </p>
            {stale ? (
              <Button
                ref={againRef}
                size="sm"
                variant="outline"
                className={cn(FOCUS, "aria-disabled:opacity-50")}
                // Still focusable while it reads, so focus stays on it.
                aria-disabled={m.rereading || undefined}
                onClick={() => {
                  if (!m.rereading) void m.readAgain();
                }}
              >
                <RefreshCw
                  aria-hidden
                  className={cn(m.rereading && "motion-safe:animate-spin")}
                />
                Read them again
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ the rail

const DEFCON_TONE = (v: string | null) =>
  !v
    ? "neutral"
    : /risk|churn|paused/i.test(v)
      ? "warn"
      : /happy/i.test(v)
        ? "good"
        : "neutral";

const STOP_DOT: Record<StopTone, string> = {
  plan: "bg-muted-foreground/60",
  wait: "glow-teal bg-primary",
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  quiet: "bg-muted-foreground/30",
};

function Trail({ m, stops }: { m: CheckinModel; stops: TrailStop[] }) {
  const note = trailNote(m.sent?.effects ?? []);
  return (
    <section className="space-y-3">
      <Kicker as="h2">After the send</Kicker>
      {/* The live region wraps the list, so the stops keep their list
          semantics (8.1: the trail is role="status" aria-live="polite"),
          and a stop that changes is said alone, not all eight again. */}
      <div role="status" aria-live="polite" aria-atomic="false">
        <ol className="space-y-3">
          {stops.map((s, i) => (
            <li key={s.key} className="relative flex gap-3">
              {i < stops.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute top-4 bottom-[-12px] left-[4.5px] w-px bg-border"
                />
              ) : null}
              <span
                aria-hidden
                key={`${s.key}-${s.tone}`}
                className={cn(
                  "relative mt-1.5 size-2.5 shrink-0 rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-[180ms]",
                  STOP_DOT[s.tone],
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-sm",
                    s.quiet ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {s.label}
                  <span className="sr-only">
                    {s.problem
                      ? ", needs a person"
                      : s.done
                        ? ", done"
                        : s.quiet
                          ? ", not needed"
                          : s.tone === "plan"
                            ? ", planned only"
                            : ", waiting"}
                  </span>
                </div>
                <div className="text-xs leading-5 text-muted-foreground">
                  {s.line}
                </div>
                {s.sub ? (
                  <div className="text-xs leading-5 text-muted-foreground">
                    {s.sub}
                  </div>
                ) : null}
                {s.link ? (
                  <a
                    href={s.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      LINK_INK,
                      "inline-flex items-center gap-1 rounded-sm text-xs underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink",
                    )}
                  >
                    {s.link.label}
                    {s.link.internal ? (
                      // Another page of the cockpit: the in-app mark, and
                      // the new tab said, as the recap step's same link.
                      <>
                        <ChevronRight aria-hidden className="size-3.5" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </>
                    ) : (
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    )}
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function Rail({
  m,
  facts,
  stops,
}: {
  m: CheckinModel;
  facts: RailFacts | null;
  stops: TrailStop[] | null;
}) {
  const last = facts?.last ?? null;
  const ours = facts?.promises.filter(p => p.side === "ours") ?? [];
  const theirs = facts?.promises.filter(p => p.side === "theirs") ?? [];
  return (
    <div className="space-y-7 p-4 sm:p-5">
      {stops ? <Trail m={m} stops={stops} /> : null}
      {m.rail.error ? (
        <p className="flex gap-2 text-xs" role="note">
          <span className="flex h-4 shrink-0 items-center">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">
            {`The call history could not be read: ${m.rail.error.replace(/\.$/, "")}.`}
          </span>
        </p>
      ) : m.rail.loading ? (
        <p className="text-xs text-muted-foreground">
          Reading the call history…
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <Kicker as="h2">
              {last ? `Last 1-1 · ${shortDay(last.day)}` : "Last 1-1"}
            </Kicker>
            {last ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <Dot tone={DEFCON_TONE(last.defcon)} />
                    {last.defcon ? displayLabel(last.defcon) : "No DEFCON"}
                  </span>
                  {last.priority ? (
                    <span className="text-muted-foreground">
                      · {last.priority}
                    </span>
                  ) : null}
                </div>
                {last.weOwed ? (
                  <p className="text-xs text-muted-foreground">
                    We owed {plural(last.weOwed, "thing")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No 1-1 notes on record yet.
              </p>
            )}
          </section>
          {ours.length || theirs.length ? (
            <section className="space-y-2">
              <Kicker as="h2">Open promises</Kicker>
              <ul className="space-y-2">
                {[...ours.slice(0, 5), ...theirs.slice(0, 5)].map((p, i) => (
                  <li key={`${p.side}-${i}`} className="flex gap-2 text-sm">
                    <span className="flex h-5 shrink-0 items-center">
                      <Dot tone="neutral" />
                    </span>
                    <span className="min-w-0">
                      <span className="text-muted-foreground">
                        {p.side === "ours" ? "We owe: " : "They owe: "}
                      </span>
                      <bdi dir="auto" style={NOTES_FONT}>
                        {p.text}
                      </bdi>
                    </span>
                  </li>
                ))}
              </ul>
              {facts?.promisesFrom ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {facts.promisesFrom}
                </p>
              ) : null}
            </section>
          ) : null}
          <section className="space-y-1">
            <Kicker as="h2">Next call</Kicker>
            <p className="text-sm">
              {/* One date format on the screen: Next check-in's "Sun 2 Nov, 10:30". */}
              {facts?.next
                ? `${facts.next.label}, ${kuwaitWhen(facts.next.at)}`
                : "Nothing booked."}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
