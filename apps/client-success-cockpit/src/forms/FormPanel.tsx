import { Check, ChevronRight, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dot, ExtLink, Kicker } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import { cn } from "@/lib/utils";
import type {
  Already,
  FormConfig,
  FormContext,
  FormSend,
  RailPart,
  RailRow,
} from "./formConfig";
import {
  afterLines,
  type Trail,
  trailAllDone,
  trailSummary,
} from "./formStatus";
import { kuwaitShortDay, kuwaitTime } from "./formTime";
import {
  type CreateWidget,
  type FormIO,
  type FormPhase,
  message,
  useFormPanel,
} from "./useFormPanel";

export {
  type CreateWidget,
  type FormIO,
  type FormPhase,
  loadTypeform,
  serverNow,
  type Widget,
} from "./useFormPanel";

/**
 * The reusable form panel (docs/csm-forms/KICKOFF.md 2): Typeform's own
 * form, embedded with its hidden fields built from the client's record,
 * beside what the cockpit knows for each question. It never names a form:
 * the form ID, the hidden fields, the side panel, the duplicate guard, the
 * ending and the after-submit trail are all the config's. Layout-free: it
 * fills whatever frame holds it (the kickoff's own window here; a large
 * sheet in another cockpit). Its state is useFormPanel's, so the
 * onboarding deck's last slide draws the same form on its canvas and the
 * side panel's parts (RailView, AfterSend, AnswersSheet, exported here) in
 * the notes window.
 *
 * The hidden object is built once when the form loads and never rebuilt
 * under a form being filled; a kit re-read never remounts the widget.
 */

export interface BookProps {
  /** The call the form's ending books. */
  kind: NonNullable<FormConfig["ending"]>["book"];
  label: string;
  variant: "default" | "outline";
  autoOpen: boolean;
  onAutoOpenConsumed: () => void;
}

export interface FormPanelProps {
  config: FormConfig;
  ctx: FormContext;
  io: FormIO;
  clientName: string;
  rehearse?: boolean;
  /** Screen-sharing: the side panel is hidden, whole. */
  sharing?: boolean;
  /** Typeform's SDK; the harness and the tests pass a stand-in. */
  embed?: () => Promise<CreateWidget>;
  /** The cockpit's booking dialog, for the ending's button. */
  book?: (p: BookProps) => ReactNode;
  onPhase?: (phase: FormPhase) => void;
  /** This form's own window, in full, for the trail's copy button. */
  windowLink?: string;
}

/** A reason inside a sentence: its own last full stop goes, the sentence adds one. */
const clause = (s: string) => s.replace(/\.\s*$/, "");

/** Teal text that passes contrast in light mode (--primary-ink). */
const INK = "text-primary-ink";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const STEPS = ["", "one", "two", "three", "four", "five", "six"];

/** Every stop but the Slack notice is done: the card is ready for the next step. */
const cardSteps = (trail: Trail) =>
  trail.stops.every(s => s.key === "slack" || s.done);
const http = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
    return true;
  } catch {
    toast.error("The browser would not copy. Select the text instead.");
    return false;
  }
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
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    m.addEventListener?.("change", h);
    return () => m.removeEventListener?.("change", h);
  }, [query]);
  return on;
}

export function FormPanel({
  config,
  ctx,
  io,
  clientName,
  rehearse = false,
  sharing = false,
  embed,
  book,
  onPhase,
  windowLink,
}: FormPanelProps) {
  const m = useFormPanel({
    config,
    ctx,
    io,
    clientName,
    rehearse,
    embed,
    onPhase,
  });
  const {
    already,
    held,
    prefill,
    changed,
    ready,
    slow,
    rehearsed,
    sent,
    trail,
    parts,
    fallback,
    box,
  } = m;
  const [reading, setReading] = useState<FormEntry | null>(null);
  const missingCount = parts.find(p => p.id === "missing")?.rows.length ?? 0;
  const desk = useMinWidth(1024);

  // Below 1024 px the panel is a fold; it opens on its own when a step is
  // late or needs a person (a notice not posted), and then shows a warning dot.
  const [foldOpen, setFoldOpen] = useState(false);
  const late = trail?.late ?? null;
  const needsPerson = Boolean(trail?.stops.some(s => s.problem));
  useEffect(() => {
    if (late || needsPerson) setFoldOpen(true);
  }, [late, needsPerson]);

  const { jumped, jump } = useJump();

  const rail = (
    <RailView
      config={config}
      parts={parts}
      notes={prefill.notes}
      failedSends={
        ctx.failed.sends && !already && !sent ? ctx.failed.sends : null
      }
      jumped={jumped}
      onJump={jump}
      onRecheck={io.recheck}
      after={
        sent && trail ? (
          <AfterSend
            config={config}
            taskId={ctx.taskId}
            links={ctx.row.links}
            windowLink={windowLink}
            sent={sent}
            trail={trail}
            checking={m.checking}
            checkedAt={m.checkedAt}
            checkError={m.checkError}
            onCheck={() => void m.runCheck()}
            onRetry={m.retry}
            book={
              book && config.ending
                ? book({
                    kind: config.ending.book,
                    label: config.ending.label,
                    // The Slack notice does not hold the booking up.
                    variant: cardSteps(trail) ? "default" : "outline",
                    autoOpen: m.autoBook,
                    onAutoOpenConsumed: m.bookConsumed,
                  })
                : null
            }
          />
        ) : null
      }
    />
  );

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-cols-1",
        // Narrow: the cockpit's fold on top, the form below; wide: side by
        // side. Sharing: the form alone.
        sharing
          ? "grid-rows-[minmax(0,1fr)]"
          : "grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_460px]",
      )}
    >
      <section
        className="relative flex min-h-[70dvh] flex-col lg:min-h-0"
        aria-label={`${config.title} form`}
      >
        {rehearse ? (
          <p className="callout-warn border-b px-4 py-2 text-sm" role="note">
            Rehearsal in Typeform's sandbox: nothing is saved and Make does not
            run. Walk the form; do not press Submit.
          </p>
        ) : null}
        {rehearsed ? (
          <p
            className="border-b px-4 py-2 text-sm text-muted-foreground"
            role="status"
          >
            Rehearsal finished. Nothing was saved and nothing was noted.
          </p>
        ) : null}
        {/* About the form on this side, so it sits over the form. Not on a
            shared screen: the CSM flips back to Just me to see it. */}
        {changed && !sharing ? (
          <div
            className="callout-warn flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm"
            role="status"
          >
            <span className="min-w-0 flex-1">
              Their onboarding answers changed after this form opened. Reload
              the form to use them.
            </span>
            <Button size="sm" variant="outline" onClick={() => m.reload()}>
              <RotateCcw aria-hidden />
              Reload the form
            </Button>
          </div>
        ) : null}
        {held && already ? (
          <Hold
            config={config}
            clientName={clientName}
            already={already}
            onRead={already.entry ? () => setReading(already.entry) : null}
            onOpen={m.release}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={box} className="min-h-0 flex-1" data-form-frame />
            {!ready ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <p className="pointer-events-auto max-w-sm text-balance text-center text-sm text-muted-foreground">
                  {slow ? (
                    rehearse ? (
                      "The form has not loaded here. Reload this window to try again."
                    ) : (
                      <>
                        The form has not loaded here.{" "}
                        <a
                          href={fallback}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            INK,
                            "underline-offset-4 hover:underline",
                          )}
                        >
                          Open it in Typeform
                        </a>
                        : it carries the same client and answers.
                      </>
                    )
                  ) : (
                    "Loading the form…"
                  )}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <aside
        hidden={sharing}
        aria-label="What the cockpit knows"
        data-rail-scroll={desk ? "" : undefined}
        className="order-first min-h-0 overflow-y-auto border-b bg-card lg:order-none lg:border-b-0 lg:border-l"
      >
        {desk ? (
          rail
        ) : (
          <details
            className="group/fold"
            open={foldOpen}
            onToggle={e => setFoldOpen(e.currentTarget.open)}
          >
            <summary className="no-marker flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/fold:rotate-90"
              />
              {trail ? (
                // A line a person must act on wraps rather than lose its
                // instruction; a wait may cut short.
                <span
                  className={cn(
                    "min-w-0",
                    needsPerson ? "text-pretty" : "truncate",
                  )}
                >
                  {late || needsPerson ? (
                    <span className="mr-1.5 inline-flex align-middle">
                      <Dot tone="warn" />
                    </span>
                  ) : null}
                  {trailSummary(config, trail)}
                </span>
              ) : (
                <>
                  What the cockpit knows
                  {missingCount ? (
                    <span className="text-muted-foreground">
                      · {missingCount} missing
                    </span>
                  ) : null}
                </>
              )}
            </summary>
            <div
              data-rail-scroll=""
              className="max-h-[55dvh] overflow-y-auto border-t"
            >
              {rail}
            </div>
          </details>
        )}
      </aside>

      <AnswersSheet
        title={config.title}
        clientName={clientName}
        entry={reading}
        onClose={() => setReading(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------ what was filled

/** A response's answers, read only: "Kickoff for <client>". */
export function AnswersSheet({
  title,
  clientName,
  entry,
  onClose,
}: {
  title: string;
  clientName: string;
  entry: FormEntry | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(entry)} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {entry ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="text-lg">
                {title} for <bdi>{clientName}</bdi>
              </SheetTitle>
              <SheetDescription>
                Filled {kuwaitShortDay(entry.submitted_at)},{" "}
                {entry.answers.length} answers. Fix a wrong answer in Typeform's
                results.
              </SheetDescription>
            </SheetHeader>
            <dl className="mt-4 divide-y">
              {entry.answers.map(a => (
                <div key={a.ref} className="py-3">
                  <dt className="text-xs text-muted-foreground">{a.title}</dt>
                  <dd
                    className="mt-1 whitespace-pre-line break-words text-sm"
                    dir="auto"
                  >
                    {http(a.value) ? (
                      <ExtLink
                        href={a.value.trim()}
                        className={cn(INK, "break-all")}
                      >
                        {a.value.trim()}
                      </ExtLink>
                    ) : (
                      a.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ------------------------------------------------------------ the side panel's parts

/**
 * "Still missing" points at its row: scroll the panel's own scroll there
 * and mark the row a moment.
 */
export function useJump() {
  const [jumped, setJumped] = useState<string | null>(null);
  const jump = useCallback((id: string) => {
    const el = document.getElementById(`rail-${id}`);
    if (!el) return;
    // Only the panel's own scroll moves: scrollIntoView would also move the
    // window under the header.
    const box = el.closest<HTMLElement>("[data-rail-scroll]");
    if (box) {
      const top =
        el.getBoundingClientRect().top -
        box.getBoundingClientRect().top +
        box.scrollTop -
        (box.clientHeight - el.clientHeight) / 2;
      box.scrollTo?.({
        top: Math.max(0, top),
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    }
    // A page that scrolls as a whole (the deck's notes window).
    else
      el.scrollIntoView?.({
        block: "center",
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    el.focus?.({ preventScroll: true });
    setJumped(id);
  }, []);
  useEffect(() => {
    if (!jumped) return;
    const t = window.setTimeout(() => setJumped(null), 1600);
    return () => window.clearTimeout(t);
  }, [jumped]);
  return { jumped, jump };
}

/**
 * What the cockpit knows, in the form's order: the trail after a send (in
 * Still missing's place), then the parts. The kickoff window draws it in
 * its side panel; the onboarding deck draws it in the notes window.
 */
export function RailView({
  config,
  parts,
  notes,
  failedSends,
  after,
  jumped,
  onJump,
  onRecheck,
}: {
  config: Pick<FormConfig, "title">;
  parts: RailPart[];
  notes: string[];
  /** The cockpit's own sends could not be read (only before a send, with no guard). */
  failedSends: string | null | undefined;
  /** The trail, once sent: it takes Still missing's place. */
  after: ReactNode;
  jumped: string | null;
  onJump: (id: string) => void;
  onRecheck: () => Promise<void>;
}) {
  return (
    <div className="space-y-6 p-4 sm:p-5">
      {after}
      {/* The guard reads the cockpit's own sends too: when that read
          failed, a send from here in the last minutes may be missed, so
          the window says so instead of looking sure. */}
      {failedSends ? (
        <p className="txt-warn flex gap-2 text-xs" role="note">
          <span className="mt-1.5">
            <Dot tone="warn" />
          </span>
          <span className="min-w-0">
            {`The cockpit could not check for a ${config.title.toLowerCase()} already sent from here: ${clause(failedSends)}. Look at the client's Onboarding panel before you send.`}
          </span>
        </p>
      ) : null}
      {/* Still missing first (the trail takes its place after a send),
          then what the form opened with, then the rest. */}
      {after
        ? null
        : parts
            .filter(p => p.id === "missing")
            .map(p => (
              <Part
                key={p.id}
                part={p}
                jumped={jumped}
                onJump={onJump}
                onRecheck={onRecheck}
              />
            ))}
      <Notes notes={notes} />
      {parts
        .filter(p => p.id !== "missing")
        .map(p => (
          <Part
            key={p.id}
            part={p}
            jumped={jumped}
            onJump={onJump}
            onRecheck={onRecheck}
          />
        ))}
    </div>
  );
}

// ------------------------------------------------------------ the seal

/**
 * "Sends to <client> <card ID>": the join key, the window's one bold thing
 * (KICKOFF.md 6). In rehearsal it says nothing reaches the card.
 */
export function Seal({
  clientName,
  taskId,
  glow,
  rehearse,
  kicker,
  why: said,
  whyLabel = "Why this form goes to this card",
  wrapName = false,
}: {
  clientName: string;
  taskId: string;
  glow: boolean;
  /** The orange ring: nothing reaches the card from this window. */
  rehearse: boolean;
  /** The mono words before the name ("Notes for"); the kickoff's by default. */
  kicker?: string;
  /** What the popover says; the kickoff's by default. */
  why?: string;
  /**
   * The popover's name: it opens as a dialog and takes focus, so a screen
   * reader says what it is before the sentence.
   */
  whyLabel?: string;
  /**
   * Below sm the seal wraps instead of cutting the name: the kicker on the
   * first line, then the whole name with the card ID after it. Off by
   * default, so the kickoff's one-line pill is unchanged.
   */
  wrapName?: boolean;
}) {
  const why =
    said ??
    (rehearse
      ? "A rehearsal in Typeform's sandbox: nothing is saved, nothing reaches this card, and Make does not run."
      : "From the client record. Make writes everything from this form to this card.");
  const kickerText = kicker ?? (rehearse ? "Rehearsal ·" : "Sends to");
  const kickerClass =
    "shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground";
  const idClass = "shrink-0 font-mono text-[13px] text-foreground/80";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // The 1-1 window's focus (CheckinFields.tsx FOCUS): 2px of the
            // ink teal set 2px off the pill, 3:1 on both pages, so it never
            // reads as the pill's own ring (ring-ring is Mahara Teal, about
            // 1.8:1 on the light page). Written out here: FormPanel is shared
            // with the kickoff and does not import the window's files.
            "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            wrapName &&
              "max-sm:items-start max-sm:rounded-2xl max-sm:py-1.5 max-sm:text-left",
            rehearse
              ? "bg-warning/10 ring-warning/60"
              : "bg-primary/10 ring-primary/40",
            glow && !rehearse && "glow-teal",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              wrapName && "max-sm:mt-1.5",
              rehearse ? "bg-warning" : "bg-primary",
            )}
          />
          {wrapName ? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 max-sm:flex-1 sm:flex-nowrap sm:items-center">
              <span className={cn(kickerClass, "max-sm:basis-full")}>
                {kickerText}
              </span>
              <bdi className="min-w-0 font-medium max-sm:break-words sm:truncate">
                {clientName}
              </bdi>
              <span className={idClass}>{taskId}</span>
            </span>
          ) : (
            <>
              <span className={kickerClass}>{kickerText}</span>
              <bdi className="min-w-0 truncate font-medium">{clientName}</bdi>
              <span className={idClass}>{taskId}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={whyLabel} className="w-72 text-sm">
        {why}
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------ the guard

function Hold({
  config,
  clientName,
  already,
  onRead,
  onOpen,
}: {
  config: FormConfig;
  clientName: string;
  already: Already;
  onRead: (() => void) | null;
  onOpen: () => void;
}) {
  const day = already.at ? kuwaitShortDay(already.at) : null;
  const name = config.title.toLowerCase();
  return (
    <div className="m-auto w-full max-w-xl space-y-4 p-6 sm:p-10" role="note">
      <div className="txt-warn flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em]">
        <Dot tone="warn" />
        Already sent
      </div>
      <p className="text-[15px] leading-6">
        A {name} for <bdi>{clientName}</bdi> went in
        {day ? ` on ${day}` : ""}
        {already.by ? (
          <>
            {" "}
            from <bdi>{already.by}</bdi>
          </>
        ) : null}
        . Sending another runs Make again: {config.again}. Fix a wrong answer in
        Typeform's results instead.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onRead ? (
          <Button size="sm" onClick={onRead}>
            Read what was filled
          </Button>
        ) : null}
        <ExtLink href={config.resultsUrl} className={cn(INK, "text-sm")}>
          Open Typeform's results
        </ExtLink>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4">
        <span className="text-xs text-muted-foreground">
          Only if the first one cannot be fixed:
        </span>
        <Button size="sm" variant="outline" onClick={onOpen}>
          Open a second {name} anyway
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ notes

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {notes.map(n => (
        <p key={n} className="flex gap-2">
          <span className="mt-1.5">
            <Dot tone="neutral" />
          </span>
          <span className="min-w-0">{n}</span>
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ the side panel

function Part({
  part,
  jumped,
  onJump,
  onRecheck,
}: {
  part: RailPart;
  jumped: string | null;
  onJump: (id: string) => void;
  onRecheck: () => Promise<void>;
}) {
  const rows = (
    <ul className="divide-y">
      {part.rows.map(r => (
        <Row
          key={r.id}
          row={r}
          warn={part.tone === "warn"}
          jumped={jumped === r.id}
          onJump={onJump}
          onRecheck={onRecheck}
        />
      ))}
    </ul>
  );
  const head = (
    <Kicker className="flex items-center gap-1.5">
      {part.tone === "warn" ? <Dot tone="warn" /> : null}
      {part.title}
      {part.tone === "warn" ? ` · ${part.rows.length}` : ""}
    </Kicker>
  );
  if (part.fold)
    return (
      <details className="group/part">
        <summary className="no-marker flex cursor-pointer items-center gap-1">
          <ChevronRight
            aria-hidden
            className="size-3.5 text-muted-foreground transition-transform group-open/part:rotate-90"
          />
          {head}
        </summary>
        <div className="mt-1">{rows}</div>
      </details>
    );
  return (
    <section aria-label={part.title} className="space-y-1">
      {head}
      {part.problem ? <p className="txt-warn text-xs">{part.problem}</p> : null}
      {rows}
    </section>
  );
}

function SourceTag({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 font-mono text-[11px] leading-4 text-muted-foreground">
      {children}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 shrink-0"
      aria-label={`Copy the ${label.toLowerCase()}`}
      title="Copy"
      onClick={() =>
        void copyText(value, label).then(ok => ok && setDone(true))
      }
    >
      {done ? <Check aria-hidden className="txt-good" /> : <Copy aria-hidden />}
    </Button>
  );
}

function Row({
  row,
  warn,
  jumped,
  onJump,
  onRecheck,
}: {
  row: RailRow;
  warn: boolean;
  jumped: boolean;
  onJump: (id: string) => void;
  onRecheck: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const label = (
    <div className="text-xs font-medium text-muted-foreground">
      {row.label}
      {row.required ? (
        <>
          <span aria-hidden title="Required in the form">
            {" "}
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </div>
  );

  // "Still missing": a pointer to its row, or a row that is its own answer.
  if (warn) {
    const body = (
      <>
        <span className="mt-1.5">
          <Dot tone="warn" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{row.label}</span>
          <span className="block text-xs text-muted-foreground">
            {row.missing}
          </span>
        </span>
      </>
    );
    return (
      <li className="py-1">
        {row.anchor ? (
          <button
            type="button"
            onClick={() => onJump(row.anchor as string)}
            className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
            <ChevronRight
              aria-hidden
              className="mt-1 ml-auto size-3.5 shrink-0 text-muted-foreground"
            />
          </button>
        ) : (
          <div className="flex gap-2 py-1">{body}</div>
        )}
        {row.action ? (
          <ActionCopy action={row.action} className="mt-1 ml-3.5" />
        ) : null}
      </li>
    );
  }

  // Marked a moment when Still missing points here. Rounded only then: a
  // rounded row would bend the hairline between rows.
  const mark = cn(
    "outline-none transition-colors duration-500",
    jumped && "-mx-2 rounded-md bg-primary/10 px-2",
  );

  if (row.empties)
    return (
      <li className="py-2.5 text-sm text-muted-foreground">
        {row.label}: {row.empties.join(", ")}.
      </li>
    );

  if (row.carries) {
    const shown = row.carries.filter(c => c.value !== null);
    const blank = row.carries.filter(c => c.value === null);
    return (
      <li id={`rail-${row.id}`} tabIndex={-1} className={cn("py-2", mark)}>
        <details className="group/carries">
          <summary className="no-marker flex cursor-pointer items-start gap-1 text-sm font-medium">
            <ChevronRight
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/carries:rotate-90"
            />
            {row.label}
          </summary>
          <dl className="mt-2 space-y-2 border-l pl-3">
            {shown.map(c => (
              <div key={c.key}>
                <dt className="text-xs text-muted-foreground">{c.label}</dt>
                <dd
                  className="line-clamp-3 whitespace-pre-line break-words text-sm"
                  dir="auto"
                  title={c.value ?? undefined}
                >
                  <bdi>{c.value}</bdi>
                </dd>
                {c.source && c.source !== row.carriesFrom ? (
                  <SourceTag>{c.source}</SourceTag>
                ) : null}
              </div>
            ))}
            {blank.length ? (
              <p className="text-xs text-muted-foreground">
                {row.blank ?? "Left blank"}:{" "}
                {blank.map(c => c.label).join(", ")}.
              </p>
            ) : null}
          </dl>
        </details>
      </li>
    );
  }

  const linkOnly = row.value !== null && row.value === row.href;
  return (
    <li id={`rail-${row.id}`} tabIndex={-1} className={cn("py-2.5", mark)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {label}
          {row.choices ? (
            <Choices choices={row.choices} />
          ) : row.value !== null && !linkOnly ? (
            <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-sm">
              {row.suggest ? (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Suggest
                </span>
              ) : null}
              <bdi
                dir="auto"
                className="min-w-0 whitespace-pre-line break-words"
              >
                {row.value}
              </bdi>
            </div>
          ) : null}
          {row.value === null ? (
            <div className="mt-0.5 text-sm text-muted-foreground">
              {row.missing ?? "Not on record."}
            </div>
          ) : null}
          {row.href ? (
            <div
              className={cn("mt-0.5 min-w-0", linkOnly ? "text-sm" : "text-xs")}
            >
              <ExtLink href={row.href} className={cn(INK, "max-w-full")}>
                <span className="truncate">{row.linkLabel ?? "Open"}</span>
              </ExtLink>
            </div>
          ) : null}
          {row.hint ? (
            <div className="mt-0.5 text-xs text-muted-foreground" dir="auto">
              {row.hint}
            </div>
          ) : null}
          {row.source && row.value !== null ? (
            <SourceTag>{row.source}</SourceTag>
          ) : null}
        </div>
        {row.copy && row.value !== null ? (
          <CopyButton value={row.copyValue ?? row.value} label={row.label} />
        ) : null}
        {/* Once the value is here, there is nothing to check again. */}
        {row.recheck && row.value === null ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onRecheck()
                .catch(e =>
                  toast.error(
                    `The call store could not be read. ${clause(message(e))}.`,
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <RefreshCw
              aria-hidden
              className={cn(busy && "motion-safe:animate-spin")}
            />
            Check again
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ActionCopy({
  action,
  className,
}: {
  action: NonNullable<RailRow["action"]>;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        INK,
        "inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline",
        className,
      )}
      onClick={() =>
        navigator.clipboard.writeText(action.value).then(
          () => toast.success(action.done),
          () =>
            toast.error("The browser would not copy. Select the text instead."),
        )
      }
    >
      <Copy aria-hidden className="size-3.5" />
      {action.label}
    </button>
  );
}

function Choices({ choices }: { choices: NonNullable<RailRow["choices"]> }) {
  const said = choices.options.filter(o => o.own.length);
  return (
    <div className="mt-1.5 space-y-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="The form's choices">
        {choices.options.map(o => {
          const on = o.label === choices.picked;
          return (
            <li
              key={o.label}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs",
                on
                  ? "bg-primary/10 font-medium text-foreground ring-1 ring-primary"
                  : "text-muted-foreground ring-1 ring-border",
              )}
            >
              {o.label}
              {on ? <span className="sr-only"> (suggested)</span> : null}
            </li>
          );
        })}
      </ul>
      {said.length ? (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {said.map(o => (
            <div key={o.label} dir="auto">
              <span className="text-foreground/80">{o.label}</span>:{" "}
              {o.own.map((w, i) => (
                <span key={w}>
                  {i ? ", " : ""}
                  <bdi>{w}</bdi>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ after submit

export function AfterSend({
  config,
  taskId,
  links,
  windowLink,
  sent,
  trail,
  checking,
  checkedAt,
  checkError,
  onCheck,
  onRetry,
  book,
}: {
  config: Pick<FormConfig, "title" | "after" | "makeDoes" | "resultsUrl">;
  /** The card the form sent to: the link-back button's target is built from it. */
  taskId: string;
  /** The card's links: the ClickUp card, and the one Make writes back. */
  links: OnboardingRow["links"] | undefined;
  /** This form's own window, in full: a quiet line copies it. */
  windowLink?: string | null;
  sent: { error: string | null; busy: boolean; send: FormSend | null };
  trail: Trail;
  checking: boolean;
  checkedAt: string | null;
  checkError: string | null;
  onCheck: () => void;
  onRetry: () => void;
  book: ReactNode;
}) {
  const back = config.after.linkBack;
  const link = back ? links?.[back.key] : undefined;
  // The stop reads the card's link; the button goes where the config says.
  const linked = trail.stops.some(s => s.key === "link" && s.done);
  const linkHref = back?.href ? back.href(taskId) : link;
  const name = config.title.toLowerCase();
  const late = trail.late;
  // A notice that was off or skipped is done but not a success: the footer
  // never counts it as one.
  const allDone = trailAllDone(trail);
  const quietSlack = trail.stops.every(s => s.done) && !allDone;
  const head = afterLines(config, trail);
  const [showLink, setShowLink] = useState(false);
  // The late sentence: its first sentence in bold, the rest as it is.
  const lateFirst = trail.lateLine?.match(/^.*?\.(?=\s|$)/)?.[0] ?? "";
  const lateRest = trail.lateLine?.slice(lateFirst.length).trim() ?? "";
  const steps = STEPS[trail.stops.length] ?? String(trail.stops.length);
  return (
    <section
      className={cn(
        "space-y-4 rounded-xl p-4 ring-1",
        late ? "bg-card ring-border" : "bg-primary/5 ring-primary/40",
      )}
      aria-label="After the send"
    >
      <div>
        <p className="text-[15px] font-semibold leading-6">{head.say}</p>
        {head.sub ? (
          <p className="text-xs text-muted-foreground">{head.sub}</p>
        ) : null}
      </div>

      {sent.error ? (
        <div className="callout-warn flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {`The ${name} went to Typeform, but the cockpit could not note it. ${clause(sent.error)}.`}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={sent.busy}
            onClick={onRetry}
          >
            {sent.busy ? "Noting it…" : "Try again"}
          </Button>
        </div>
      ) : null}

      <ol role="status" aria-live="polite" className="relative space-y-3">
        {trail.stops.map((s, i) => {
          const now = trail.current === s.key;
          // A pending stop's line is context for the next step only, and
          // not once that step is late ("Usually within a minute").
          const line = s.done || (now && !late) ? s.line : null;
          return (
            <li key={s.key} className="relative flex gap-3">
              {i < trail.stops.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute top-4 bottom-[-12px] left-[5px] w-px bg-border"
                />
              ) : null}
              <span
                aria-hidden
                key={`${s.key}-${s.done}`}
                className={cn(
                  "relative mt-1 size-[11px] shrink-0 rounded-full",
                  s.problem
                    ? "bg-warning"
                    : s.done
                      ? cn(
                          s.quiet ? "bg-muted-foreground/60" : "bg-success",
                          "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-[180ms] motion-safe:ease-out",
                        )
                      : now
                        ? late
                          ? "bg-warning"
                          : "glow-teal bg-primary"
                        : "bg-muted-foreground/30",
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-sm",
                    s.problem
                      ? "text-foreground"
                      : s.done || now
                        ? "font-medium"
                        : "text-muted-foreground",
                  )}
                >
                  {s.problem && s.lead && s.label.startsWith(s.lead) ? (
                    // "Not posted." carries the warning; the reason reads
                    // as a plain sentence after it.
                    <>
                      <span className="txt-warn font-medium">{s.lead}</span>
                      {s.label.slice(s.lead.length)}
                    </>
                  ) : (
                    s.label
                  )}
                  <span className="sr-only">
                    {s.problem
                      ? ", needs a person"
                      : s.unread
                        ? ", not read"
                        : s.done
                          ? ", done"
                          : now
                            ? late
                              ? ", late"
                              : ", next"
                            : ", waiting"}
                  </span>
                </div>
                {line && line.replace(/\.$/, "") !== s.label ? (
                  <div className="text-xs text-muted-foreground">{line}</div>
                ) : null}
                {s.link ? (
                  <ExtLink href={s.link.href} className={cn(INK, "text-xs")}>
                    {s.link.label}
                  </ExtLink>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {trail.lateLine ? (
        <div className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-xs text-foreground">
          <p className="flex gap-2 leading-5">
            <span className="mt-[7px]">
              <Dot tone="warn" />
            </span>
            <span className="min-w-0">
              <strong className="font-semibold">{lateFirst}</strong>
              {lateRest ? ` ${lateRest}` : ""}
            </span>
          </p>
          <div className="pl-3.5">
            {late === "make" && links?.clickup ? (
              <ExtLink href={links.clickup} className={INK}>
                Open the ClickUp card
              </ExtLink>
            ) : late === "typeform" ? (
              <ExtLink href={config.resultsUrl} className={INK}>
                Open Typeform's results
              </ExtLink>
            ) : null}
          </div>
        </div>
      ) : null}

      {book || (linked && linkHref) ? (
        <div className="flex flex-wrap items-center gap-3">
          {book}
          {linked && linkHref && back ? (
            <ExtLink href={linkHref} className={cn(INK, "text-sm")}>
              {back.open}
            </ExtLink>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {checkError
            ? null
            : allDone
              ? `All ${steps} steps are done.`
              : quietSlack
                ? "The card's steps are done. The Slack notice was not posted."
                : checkedAt
                  ? `Checked ClickUp and Typeform at ${kuwaitTime(checkedAt)}.`
                  : late
                    ? "The 10-minute sync carries on."
                    : `The cockpit checks the card at ${config.after.checksAtSec
                        .map(s => (s < 60 ? `${s} s` : `${s / 60} min`))
                        .join(", ")}.`}
        </span>
        <Button size="sm" variant="ghost" onClick={onCheck} disabled={checking}>
          <RefreshCw
            aria-hidden
            className={cn(checking && "motion-safe:animate-spin")}
          />
          Check now
        </Button>
      </div>
      {checkError ? (
        <p className="txt-warn text-xs">
          {`The cockpit could not read ClickUp and Typeform just now: ${clause(checkError)}. The ${name} is safe in Typeform; the 10-minute sync will catch up.`}
        </p>
      ) : null}

      {windowLink ? (
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>This {name}'s window</span>
            <button
              type="button"
              className={cn(
                INK,
                "inline-flex items-center gap-1 underline-offset-4 hover:underline",
              )}
              onClick={() =>
                navigator.clipboard.writeText(windowLink).then(
                  () =>
                    toast.success(
                      `Link copied. It opens this client's ${name} window.`,
                    ),
                  () => {
                    // The link is shown to select by hand, so the words
                    // point at something on the screen.
                    setShowLink(true);
                    toast.error(
                      "The browser would not copy. Select the link below instead.",
                    );
                  },
                )
              }
            >
              <Copy aria-hidden className="size-3.5" />
              Copy the link
            </button>
          </div>
          {showLink ? (
            <input
              readOnly
              aria-label={`This ${name}'s window link`}
              value={windowLink}
              onFocus={e => e.currentTarget.select()}
              className="block w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
            />
          ) : null}
        </div>
      ) : null}

      <details className="group/make text-xs">
        <summary className="no-marker flex cursor-pointer items-center gap-1 text-muted-foreground">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-open/make:rotate-90"
          />
          What Make does now
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {config.makeDoes.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </details>

      {sent.send ? null : sent.busy ? (
        <p className="text-xs text-muted-foreground">
          Noting it on the client…
        </p>
      ) : null}
    </section>
  );
}
