import { ArrowUpRight, RefreshCw, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dot, ExtLink } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  AfterSend,
  AnswersSheet,
  RailView,
  Seal,
  useJump,
} from "@/forms/FormPanel";
import type { FormContext } from "@/forms/formConfig";
import { kuwaitShortDay } from "@/forms/formTime";
import { KICKOFF } from "@/forms/kickoff";
import { openForm } from "@/forms/OpenFormButton";
import {
  type CreateWidget,
  type FormIO,
  type FormPanelModel,
  useFormPanel,
} from "@/forms/useFormPanel";
import { type FormReads, useLiveForm } from "@/forms/useLiveForm";
import type { FormEntry } from "@/lib/onboardingCore";
import { cn } from "@/lib/utils";
import type { DeckHub } from "./channel";
import { digits, type Lang, O, t, tf } from "./content";
import { clock, dayMonth } from "./dates";
import type { SlideCtx } from "./deckContext";
import type { DeckData } from "./deckData";
import {
  type BookOpts,
  emptyView,
  type KickoffAct,
  type KickoffShown,
  type KickoffView,
  recordRows,
  rowValue,
  stageWords,
} from "./kickoffStop";
import { TodayList } from "./TodayList";

/**
 * O8, the kickoff form (CEO, 2026-10-22; DESIGN 23): the CSM fills the
 * client's kickoff with them before they hang up, and sends it. The start
 * column says what it is and what sending it does; the end column is the
 * form in a frame; the call's checklist is at the foot, its third item
 * (the Blueprint call) the slide's own, ticked by the form's Submit.
 *
 * The form is the kickoff window's own (src/forms): FormPanel's state with
 * the KICKOFF config, its hidden object built from the client's record (the
 * card ID from the record, never from a link), the same guard against a
 * second kickoff and the same trail after a send. It lives in a layer the
 * deck window keeps above the slides (KickoffLayer), mounted on the first
 * arrival and kept, so a language switch, a step back or a look at another
 * slide never reloads a half-filled form or loses its trail. Everything the
 * kickoff window keeps in its side panel is drawn in the notes window
 * (KickoffNotes), never on the shared screen.
 */

/** The deck window's reads and writes for the kickoff. */
export interface KickoffPort {
  reads: FormReads;
  me: FormContext["me"];
  /** Typeform's sandbox: admins and the CEO, with ?rehearse=1. */
  rehearse: boolean;
  /** Typeform's SDK; the harness passes a stand-in. */
  embed?: () => Promise<CreateWidget>;
}

// ------------------------------------------------------------ the frame

function SentMark() {
  // The checklist's done mark, drawn small in the frame's head.
  return (
    <svg className="dkc-kick-mark" viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r="13" />
      <path d="M8.5 14.5l3.8 3.8 7.2-8" pathLength={1} />
    </svg>
  );
}

/**
 * The form's frame: whose form it is, then the form, or what stands in for
 * it. Its head says "Sent at 2:02 pm" once Typeform has the response (the
 * submit's own clock), with the checklist's tick.
 */
export function KickoffFrame({
  d,
  lang,
  sentAt,
  rehearse = false,
  held = false,
  children,
}: {
  d: DeckData;
  lang: Lang;
  sentAt: string | null;
  rehearse?: boolean;
  /** On record already: the panel is as tall as what it reads back. */
  held?: boolean;
  children: ReactNode;
}) {
  const time = sentAt ? clock(sentAt, lang, d.timeZone) : "";
  // The head names whose form it is, and nothing that redraws a window's
  // chrome (score round 1 of the Blueprint deck's design pass: the mono
  // "Kickoff form" prefix); the frame keeps the name for a screen reader.
  return (
    <section
      className="dkc-kick-frame"
      aria-label={t(O.kickoff.frame, lang)}
      data-sent={sentAt ? "" : undefined}
      data-held={held ? "" : undefined}
    >
      <header className="dkc-kick-head">
        <bdi className="dkc-kick-name" dir="auto">
          {d.name}
        </bdi>
        {lang === "ar" ? (
          <span className="dkc-kick-lang">{t(O.kickoff.formLang, lang)}</span>
        ) : null}
        {rehearse ? (
          <span className="dkc-kick-state" data-tone="rehearse">
            <span className="dkc-kick-dot" aria-hidden />
            {t(O.kickoff.rehearsal, lang)}
          </span>
        ) : sentAt && time ? (
          <span className="dkc-kick-state" role="status">
            <SentMark />
            {tf(O.kickoff.sentAt, lang, { time })}
          </span>
        ) : null}
      </header>
      <div className="dkc-kick-body">{children}</div>
    </section>
  );
}

/**
 * Over the form once it is sent (Typeform's own ending is never what the
 * client reads): the tick, the next action, and what our team does now.
 * The frame's head keeps the time.
 */
function SentCard({ lang }: { lang: Lang }) {
  return (
    <div className="dkc-kick-cover" data-kind="sent" role="status">
      <SentMark />
      <p className="dkc-kick-cover-head">{t(O.kickoff.next, lang)}</p>
      <p>{t(O.kickoff.doneThen, lang)}</p>
    </div>
  );
}

/**
 * A plain line in the frame, where the form will be or could not be.
 * `veil`: over the form while it opens, on the panel's own ground, so the
 * two never show at once; `gone` once the form is ready, when the line
 * fades out first and the form fades in after it (score round 2 of the
 * Blueprint deck's design pass: the line crossfaded over the form's first
 * question).
 */
function FrameLine({
  children,
  veil = false,
  gone = false,
}: {
  children: ReactNode;
  veil?: boolean;
  gone?: boolean;
}) {
  return (
    <div
      className="dkc-kick-line"
      data-veil={veil ? "" : undefined}
      data-gone={gone ? "" : undefined}
      aria-hidden={gone || undefined}
    >
      <p>{children}</p>
    </div>
  );
}

/**
 * "Kickoff on record": what was filled, never a fresh form. The canvas
 * reads back the client's own answers about their ads (recordRows); the
 * rest is in the notes window's "Read what was filled".
 */
export function KickoffRecord({
  d,
  lang,
  entry,
  at,
}: {
  d: DeckData;
  lang: Lang;
  entry: FormEntry | null;
  at: string | null;
}) {
  const rows = recordRows(entry);
  const date = at ? dayMonth(at, lang, d.timeZone) : "";
  return (
    <div className="dkc-kick-record">
      <div className="dkc-kick-record-head">
        <SentMark />
        <div>
          <h3 className="dk-h3">{t(O.kickoff.recordHead, lang)}</h3>
          {date ? (
            <p className="dk-dateline">
              {tf(O.kickoff.filledOn, lang, { date })}
            </p>
          ) : null}
        </div>
      </div>
      {rows.length ? (
        <dl className="dkc-kick-rows">
          {rows.map(r => (
            <div key={r.key}>
              <dt>{t(r.label, lang)}</dt>
              <dd>
                {r.own ? <bdi dir="auto">{r.value}</bdi> : rowValue(r, lang)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the slide

export function KickoffSlide({ ctx }: { ctx: SlideCtx }) {
  const { d, lang } = ctx;
  const shown = ctx.kickoff;
  // On record already: from the live guard on the call, else the record.
  const held = shown?.live ? shown.held : d.kickoff.from === "record";
  // Sent on this call: the words turn to what happens now.
  const sent = !held && d.kickoff.from === "call";
  const state = held ? "held" : sent ? "sent" : "open";
  return (
    <>
      {/* What it is at the top, beside the form's head; what sending it
          does at the foot, level with the frame's foot and over the
          checklist it ticks. */}
      <div className="dkc-kick-words">
        <div className="dkc-kick-top">
          <h2 className="dk-h2">{t(O.kickoff.head, lang)}</h2>
          <p key={state} className="dk-body dkc-kick-say">
            {t(
              held
                ? O.kickoff.have
                : sent
                  ? O.kickoff.done
                  : d.kickoff.prefilled
                    ? O.kickoff.prefilled
                    : O.kickoff.together,
              lang,
            )}
          </p>
        </div>
        {/* Under the line (score round 1 of the Blueprint deck: pinned to
            the foot it left a 400 px gap): what sending it does, as three
            numbered steps (score round 3: one sentence left the column's
            lower half empty). Once sent, the frame's card says what
            happens, so the column does not say it again. On record
            already, the same three steps, each ticked, then how to change
            an answer (score round 1 of the design pass: the column stood
            empty under one line). */}
        {sent ? null : (
          <div
            key={state}
            className="dkc-kick-then dkc-kick-steps"
            data-done={held ? "" : undefined}
          >
            {/* On record, the steps are already under way: said in the
                past (score round 2 of the design pass: "Once it's sent"
                headed steps that were done). */}
            <p className="dkc-kick-steps-head">
              {t(held ? O.kickoff.stepsHeadDone : O.kickoff.stepsHead, lang)}
            </p>
            <ol>
              {O.kickoff.steps.map((s, n) => (
                <li key={s.en} style={{ "--k": n } as CSSProperties}>
                  <span className="dkc-kick-step-n" aria-hidden>
                    {held ? <SentMark /> : digits(n + 1, lang)}
                  </span>
                  <span>{t(s, lang)}</span>
                </li>
              ))}
            </ol>
            {held ? (
              <p className="dkc-next-small dkc-kick-change">
                {t(O.kickoff.change, lang)}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {/* On the call the live layer draws the frame over this spot; outside
          it (prep's preview, the tests) the slide draws it, still. */}
      {shown?.live ? null : (
        <KickoffFrame
          d={d}
          lang={lang}
          sentAt={d.kickoff.from === "call" ? d.kickoff.sentAt : null}
          held={held}
        >
          {held ? (
            <KickoffRecord
              d={d}
              lang={lang}
              entry={d.kickoff.entry}
              at={d.kickoff.sentAt}
            />
          ) : sent ? (
            <SentCard lang={lang} />
          ) : (
            <FrameLine>{t(O.kickoff.here, lang)}</FrameLine>
          )}
        </KickoffFrame>
      )}
      <div className="dkc-today-foot">
        <TodayList d={d} lang={lang} variant="foot" own={2} />
      </div>
    </>
  );
}

// ------------------------------------------------------------ the layer

/**
 * The live form, above the slides (DeckShell's layer): mounted on the
 * first arrival at the slide, then kept and only hidden, so the form a
 * client is half way through survives L, a step back and the overview.
 * It reads the client as the kickoff window does, tells the notes window
 * what the side panel would show, and runs the presses sent back from it.
 */
export function KickoffLayer({
  on,
  ctx,
  port,
  hub,
  onSent,
  onShown,
}: {
  /** The deck is on the kickoff slide. */
  on: boolean;
  ctx: Pick<SlideCtx, "d" | "lang">;
  port: KickoffPort;
  hub: DeckHub;
  /** The form's Submit (Typeform has the response). */
  onSent: (at: string) => void;
  onShown: (s: KickoffShown) => void;
}) {
  const [opened, setOpened] = useState(on);
  useEffect(() => {
    if (on) setOpened(true);
  }, [on]);

  // The last view, for a notes window that opens or reloads; the presses
  // it sends go to whichever part is drawing now.
  const last = useRef<string | null>(null);
  const actRef = useRef<((a: KickoffAct) => void) | null>(null);
  const publish = useCallback(
    (view: KickoffView) => {
      const json = JSON.stringify(view);
      if (json === last.current) return;
      last.current = json;
      hub.post({ type: "kickoff", view });
    },
    [hub],
  );
  useEffect(
    () =>
      hub.on(m => {
        if (m.type === "kickoff-act") actRef.current?.(m.act);
        else if (m.type === "hello" && m.from === "notes" && last.current)
          hub.post({
            type: "kickoff",
            view: JSON.parse(last.current) as KickoffView,
          });
      }),
    [hub],
  );

  // Drawn from the first render on the slide, not one effect later.
  if (!opened && !on) return null;
  return (
    <div
      className="dkc-kick-layer"
      data-on={on ? "" : undefined}
      inert={on ? undefined : true}
      aria-hidden={on ? undefined : true}
    >
      <KickoffLive
        ctx={ctx}
        port={port}
        publish={publish}
        actRef={actRef}
        onSent={onSent}
        onShown={onShown}
      />
    </div>
  );
}

type LiveProps = {
  ctx: Pick<SlideCtx, "d" | "lang">;
  port: KickoffPort;
  publish: (v: KickoffView) => void;
  actRef: { current: ((a: KickoffAct) => void) | null };
  onSent: (at: string) => void;
  onShown: (s: KickoffShown) => void;
};

function KickoffLive({
  ctx,
  port,
  publish,
  actRef,
  onSent,
  onShown,
}: LiveProps) {
  const { d, lang } = ctx;
  const live = useLiveForm({
    cfg: KICKOFF,
    taskId: d.taskId,
    reads: port.reads,
    me: port.me,
  });
  const { state } = live;
  const base = useMemo(
    () => ({
      taskId: d.taskId,
      clientName: d.nameEn,
      stage: stageWords(d.stage),
      rehearse: port.rehearse,
    }),
    [d.taskId, d.nameEn, d.stage, port.rehearse],
  );

  const ready = state.kind === "ready";
  useEffect(() => {
    if (ready) return;
    // Until the guard has read the client, the record says what is filled.
    onShown({ live: true, held: d.kickoff.from === "record" });
    actRef.current = a => {
      if (a.act === "load") live.retry();
      else if (a.act === "refresh") void live.refresh();
    };
    publish({
      ...emptyView(base),
      status: state.kind,
      blocked:
        state.kind === "blocked"
          ? { text: state.text, retry: state.retry, plain: state.plain }
          : null,
      refreshing: live.refreshing,
    });
  });

  if (state.kind !== "ready")
    return (
      <KickoffFrame d={d} lang={lang} sentAt={null} rehearse={port.rehearse}>
        <FrameLine>
          {t(
            state.kind === "loading" ? O.kickoff.opening : O.kickoff.away,
            lang,
          )}
        </FrameLine>
      </KickoffFrame>
    );
  return (
    <KickoffReady
      ctx={ctx}
      port={port}
      form={state.ctx}
      io={live.io}
      base={base}
      publish={publish}
      actRef={actRef}
      onSent={onSent}
      onShown={onShown}
    />
  );
}

/** The panel's state as the notes window draws it. */
function viewOf(
  base: Pick<KickoffView, "taskId" | "clientName" | "stage" | "rehearse">,
  form: FormContext,
  m: FormPanelModel,
): KickoffView {
  return {
    ...emptyView(base),
    status: "ready",
    phase: m.phase,
    already: m.already,
    parts: m.parts,
    notes: m.prefill.notes,
    failedSends:
      form.failed.sends && !m.already && !m.sent ? form.failed.sends : null,
    changed: m.changed,
    formReady: m.ready,
    slow: m.slow,
    started: m.started,
    rehearsed: m.rehearsed,
    fallback: base.rehearse ? null : m.fallback,
    sent: m.sent,
    trail: m.trail,
    checking: m.checking,
    checkedAt: m.checkedAt,
    checkError: m.checkError,
    autoBook: m.autoBook,
    links: form.row.links ?? null,
  };
}

function KickoffReady({
  ctx,
  port,
  form,
  io,
  base,
  publish,
  actRef,
  onSent,
  onShown,
}: LiveProps & {
  form: FormContext;
  /** The live form's io: a note or a check updates the record it reads. */
  io: FormIO;
  base: Pick<KickoffView, "taskId" | "clientName" | "stage" | "rehearse">;
}) {
  const { d, lang } = ctx;
  const m = useFormPanel({
    config: KICKOFF,
    ctx: form,
    io,
    clientName: form.row.client_name,
    rehearse: port.rehearse,
    embed: port.embed,
    onSent,
  });
  // The notes window's "Cover the form": a paper card over the form on the
  // canvas while the CSM fills the internal answers. The form stays live
  // under it (the card lets every key and click through).
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    onShown({ live: true, held: m.held });
  }, [m.held, onShown]);
  useEffect(() => {
    actRef.current = a => {
      if (a.act === "check") void m.runCheck();
      else if (a.act === "retry") m.retry();
      else if (a.act === "reload") m.reload(a.confirmed);
      else if (a.act === "booked-open") m.bookConsumed();
      else if (a.act === "recheck") void io.recheck().catch(() => {});
      else if (a.act === "cover") setCovered(a.on);
    };
    publish({ ...viewOf(base, form, m), covered });
  });

  const already = m.already;
  return (
    <KickoffFrame
      d={d}
      lang={lang}
      sentAt={m.sent?.at ?? null}
      rehearse={port.rehearse}
      held={Boolean(m.held && already)}
    >
      {m.held && already ? (
        <KickoffRecord
          d={d}
          lang={lang}
          entry={already.entry}
          at={already.at}
        />
      ) : (
        <>
          {/* Typeform's form is English: its frame keeps its own direction.
              It shows only once ready, after the opening line has gone. */}
          <div
            ref={m.box}
            className="dkc-kick-form"
            dir="ltr"
            data-form-frame
            data-ready={m.ready ? "" : undefined}
          />
          <FrameLine veil gone={m.ready}>
            {t(m.slow ? O.kickoff.away : O.kickoff.opening, lang)}
          </FrameLine>
          {/* Typeform's own ending ("The client will receive their summary
              shortly.") is never what the client reads: the deck's sent
              card covers it. */}
          {/* Sent: the head keeps "Sent at" and the time; the card says
              the next action, not "sent" a third time. */}
          {m.sent ? (
            <SentCard lang={lang} />
          ) : m.rehearsed ? (
            <div className="dkc-kick-cover" data-kind="sent" role="status">
              <p className="dkc-kick-cover-head">
                {t(O.kickoff.rehearsal, lang)}
              </p>
            </div>
          ) : covered ? (
            <div className="dkc-kick-cover" aria-hidden>
              <p>{t(O.kickoff.cover, lang)}</p>
            </div>
          ) : null}
        </>
      )}
    </KickoffFrame>
  );
}

// ------------------------------------------------------------ the notes window

/**
 * The kickoff's side panel, in the notes window (never on the canvas): the
 * "Sends to" seal, the call sheet's facts in the form's order, the trail
 * after the send with the booking, or the record's answers. Every press is
 * run by the deck window, which owns the form.
 */
export function KickoffNotes({
  view,
  post,
  book,
}: {
  view: KickoffView | null;
  post: (a: KickoffAct) => void;
  /** The cockpit's booking dialog for the Brand Blueprint call. */
  book?: (opts: BookOpts) => ReactNode;
}) {
  const [reading, setReading] = useState<FormEntry | null>(null);
  const { jumped, jump } = useJump();
  if (!view)
    return (
      <p className="text-muted-foreground">
        Reading the client's record for the kickoff…
      </p>
    );
  const name = KICKOFF.title.toLowerCase();
  const head = (
    <div className="flex flex-wrap items-center gap-2">
      <Seal
        clientName={view.clientName}
        taskId={view.taskId}
        glow={view.phase !== "sent" && view.status === "ready"}
        rehearse={view.rehearse}
      />
      {view.stage ? (
        <span className="text-xs text-muted-foreground">{view.stage}</span>
      ) : null}
    </div>
  );

  if (view.status !== "ready")
    return (
      <div className="space-y-3">
        {head}
        <p role="status">
          {view.status === "loading"
            ? "Reading the client's record for the kickoff…"
            : view.status === "unread"
              ? "This card has not been read yet. Refresh reads ClickUp and Typeform now."
              : view.blocked?.text}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {view.status === "unread" ? (
            <Button
              size="sm"
              onClick={() => post({ act: "refresh" })}
              disabled={view.refreshing}
            >
              <RefreshCw
                aria-hidden
                className={cn(view.refreshing && "motion-safe:animate-spin")}
              />
              {view.refreshing ? "Refreshing" : "Refresh"}
            </Button>
          ) : null}
          {view.status === "blocked" && view.blocked?.retry ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => post({ act: "load" })}
            >
              Try again
            </Button>
          ) : null}
          {view.status !== "loading" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openForm(view.taskId, "kickoff")}
            >
              Open the kickoff window
            </Button>
          ) : null}
          {view.blocked?.plain && !view.rehearse ? (
            <ExtLink href={view.blocked.plain}>
              Open the plain kickoff (card ID only)
            </ExtLink>
          ) : null}
        </div>
      </div>
    );

  const already = view.already;
  if (view.phase === "held" && already) {
    const day = already.at ? kuwaitShortDay(already.at) : null;
    return (
      <div className="space-y-3" role="note">
        {head}
        <div className="txt-warn flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em]">
          <Dot tone="warn" />
          Already sent
        </div>
        <p>
          A {name} for <bdi>{view.clientName}</bdi> went in
          {day ? ` on ${day}` : ""}
          {already.by ? (
            <>
              {" "}
              from <bdi>{already.by}</bdi>
            </>
          ) : null}
          . The slide shows Kickoff on record, never a fresh form. Sending
          another runs Make again: {KICKOFF.again}. Fix a wrong answer in
          Typeform's results instead.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {already.entry ? (
            <Button size="sm" onClick={() => setReading(already.entry)}>
              Read what was filled
            </Button>
          ) : null}
          <ExtLink href={KICKOFF.resultsUrl}>Open Typeform's results</ExtLink>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Only if the first one cannot be fixed:
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openForm(view.taskId, "kickoff")}
          >
            Open the kickoff window
          </Button>
        </div>
        <AnswersSheet
          title={KICKOFF.title}
          clientName={view.clientName}
          entry={reading}
          onClose={() => setReading(null)}
        />
      </div>
    );
  }

  const sent = view.sent;
  const trail = view.trail;
  return (
    <div className="space-y-3">
      {head}
      {view.rehearse ? (
        <p className="callout-warn rounded-lg border px-3 py-2 text-xs">
          Rehearsal in Typeform's sandbox: nothing is saved and Make does not
          run. Walk the form; do not press Submit.
        </p>
      ) : null}
      {view.rehearsed ? (
        <p className="text-xs text-muted-foreground" role="status">
          Rehearsal finished. Nothing was saved and nothing was noted.
        </p>
      ) : null}
      {view.slow && !view.formReady ? (
        <p className="txt-warn text-xs" role="status">
          The form has not loaded on the deck.{" "}
          {view.fallback ? (
            <>
              <ExtLink href={view.fallback}>Open it in Typeform</ExtLink>: it
              carries the same client and answers.
            </>
          ) : (
            "Reload the deck window to try again."
          )}
        </p>
      ) : null}
      {view.changed ? (
        <div className="callout-warn flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            Their onboarding answers changed after the form opened. Reload the
            form to use them.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (
                view.started &&
                !window.confirm("Reload the form? What was typed is lost.")
              )
                return;
              post({ act: "reload", confirmed: true });
            }}
          >
            <RotateCcw aria-hidden />
            Reload the form
          </Button>
        </div>
      ) : null}
      {sent || view.rehearsed ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-xs">
          <Button
            size="sm"
            variant={view.covered ? "default" : "outline"}
            aria-pressed={Boolean(view.covered)}
            onClick={() => post({ act: "cover", on: !view.covered })}
          >
            {view.covered ? "Uncover the form" : "Cover the form"}
          </Button>
          <span className="min-w-0 flex-1 text-muted-foreground">
            {view.covered
              ? "The client sees a paper card over the form. It still takes your typing: answer, press Enter, then uncover to check."
              : "Cover it before the internal answers (the ad money, the payment, the recording link), so the client never sees those questions."}
          </span>
        </div>
      )}
      {/* -mx: the panel's own padding lines up with the notes' column. */}
      <div className="-mx-4 sm:-mx-5">
        <RailView
          config={KICKOFF}
          parts={view.parts}
          notes={view.notes}
          failedSends={view.failedSends}
          jumped={jumped}
          onJump={jump}
          onRecheck={async () => post({ act: "recheck" })}
          after={
            sent && trail ? (
              <AfterSend
                config={KICKOFF}
                taskId={view.taskId}
                links={view.links ?? undefined}
                sent={sent}
                trail={trail}
                checking={view.checking}
                checkedAt={view.checkedAt}
                checkError={view.checkError}
                onCheck={() => post({ act: "check" })}
                onRetry={() => post({ act: "retry" })}
                book={
                  book
                    ? book({
                        variant: trail.current === null ? "default" : "outline",
                        autoOpen: view.autoBook,
                        onAutoOpenConsumed: () => post({ act: "booked-open" }),
                      })
                    : null
                }
              />
            ) : null
          }
        />
      </div>
      {sent ? null : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowUpRight aria-hidden className="size-3.5" />
          The form's own Submit sends it. Nothing here sends anything.
        </p>
      )}
    </div>
  );
}
