import type { WidgetOptions } from "@typeform/embed";
import { Check, ChevronRight, Copy, RefreshCw, RotateCcw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Dot, ExtLink, Kicker } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FormEntry } from "@/lib/onboardingCore";
import { cn } from "@/lib/utils";
import type { SendInput } from "./formClient";
import type {
  Already,
  FormConfig,
  FormContext,
  FormSend,
  RailPart,
  RailRow,
} from "./formConfig";
import { trailFor } from "./formStatus";
import { kuwaitShortDay, kuwaitTime } from "./formTime";
import type { FormNews } from "./OpenFormButton";
import { formLink, hiddenSha256, type Prefill, sameHidden } from "./prefill";

/**
 * The reusable form panel (docs/csm-forms/KICKOFF.md 2): Typeform's own
 * form, embedded with its hidden fields built from the client's record,
 * beside what the cockpit knows for each question. It never names a form:
 * the form ID, the hidden fields, the side panel, the duplicate guard, the
 * ending and the after-submit trail are all the config's. Layout-free: it
 * fills whatever frame holds it (the kickoff's own window here; a large
 * sheet in another cockpit).
 *
 * The hidden object is built once when the form loads and never rebuilt
 * under a form being filled; a kit re-read never remounts the widget.
 */

export type Widget = { unmount: () => void };
export type CreateWidget = (formId: string, options: WidgetOptions) => Widget;

/** Typeform's SDK and its stylesheet, loaded only when a form opens. */
export async function loadTypeform(): Promise<CreateWidget> {
  const [sdk] = await Promise.all([
    import("@typeform/embed"),
    import("@typeform/embed/build/css/widget.css"),
  ]);
  return sdk.createWidget;
}

export interface FormIO {
  /** Notes one response (cockpit_csm_form_sent). Safe to repeat. */
  record(input: SendInput): Promise<FormSend>;
  /** Re-reads the card (the one-card refresh), the call store and the sends. */
  check(): Promise<void>;
  /** Re-reads the call store only (the recording). */
  recheck(): Promise<void>;
  /** Tells the cockpit's own tab. */
  announce?(news: FormNews): void;
}

export type FormPhase = "held" | "open" | "started" | "sent";

export interface BookProps {
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
}

/** The server's clock now, from its clock at the last read. */
export const serverNow = (ctx: Pick<FormContext, "now" | "readAt">) =>
  Date.parse(ctx.now) + Math.max(0, Date.now() - ctx.readAt);

const message = (e: unknown) =>
  String((e as Error)?.message ?? e ?? "").trim() || "No reason was given.";

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
  embed = loadTypeform,
  book,
  onPhase,
}: FormPanelProps) {
  // The guard is decided once, when the window opens: after this window's
  // own send, the record will show a kickoff, and that is not a reason to
  // hold the form again.
  const [already] = useState<Already | null>(() => config.already(ctx));
  const [released, setReleased] = useState(false);
  const held = Boolean(already) && !released;

  const [prefill, setPrefill] = useState<Prefill>(() => config.hidden(ctx));
  const [mount, setMount] = useState(0);
  const prefillRef = useRef(prefill);
  prefillRef.current = prefill;
  const current = useMemo(() => config.hidden(ctx), [config, ctx]);

  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [started, setStarted] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  const [sent, setSent] = useState<{
    responseId: string;
    at: string;
    send: FormSend | null;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [autoBook, setAutoBook] = useState(false);
  const [reading, setReading] = useState<FormEntry | null>(null);
  const [, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const noted = useRef(new Set<string>());

  const changed = !sent && !held && !sameHidden(current.values, prefill.values);
  const phase: FormPhase = held
    ? "held"
    : sent
      ? "sent"
      : started
        ? "started"
        : "open";
  const phaseRef = useRef(onPhase);
  phaseRef.current = onPhase;
  useEffect(() => {
    phaseRef.current?.(phase);
  }, [phase]);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      await io.check();
      setCheckedAt(new Date(serverNow(ctxRef.current)).toISOString());
      setCheckError(null);
      io.announce?.({
        type: "checked",
        taskId: ctxRef.current.taskId,
        form: config.key,
      });
    } catch (e) {
      setCheckError(message(e));
    } finally {
      setChecking(false);
    }
  }, [io, config.key]);

  const note = useCallback(
    async (responseId: string, at: string) => {
      setSent({ responseId, at, send: null, error: null, busy: true });
      try {
        const p = prefillRef.current;
        const send = await io.record({
          taskId: ctxRef.current.taskId,
          formKey: config.key,
          responseId,
          hiddenKeys: Object.keys(p.values),
          hiddenSha256: await hiddenSha256(p.values),
          carriedId: p.values[config.idField] ?? "",
        });
        setSent({
          responseId,
          at: send.sentAt,
          send,
          error: null,
          busy: false,
        });
      } catch (e) {
        setSent({ responseId, at, send: null, error: message(e), busy: false });
      }
    },
    [io, config.key, config.idField],
  );

  const handlers = useRef({
    started: () => {},
    submit: (_responseId: string) => {},
    ending: () => {},
  });
  handlers.current = {
    started: () => setStarted(true),
    submit: responseId => {
      setStarted(false);
      // A rehearsal is Typeform's sandbox: nothing to note, nothing ran.
      if (rehearse || responseId === "__sandbox" || !responseId) {
        setRehearsed(true);
        return;
      }
      // Typeform says it once; a repeat never notes or schedules twice.
      if (noted.current.has(responseId)) return;
      noted.current.add(responseId);
      const at = new Date(serverNow(ctxRef.current)).toISOString();
      void note(responseId, at);
      io.announce?.({
        type: "sent",
        taskId: ctxRef.current.taskId,
        form: config.key,
        clientName,
        say: `${config.title} sent for ${clientName}. ${config.after.say.replace(/^[^.]*\.\s*/, "")}`,
      });
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = config.after.checksAtSec.map(sec =>
        window.setTimeout(() => void runCheck(), sec * 1000),
      );
    },
    ending: () => {
      // In Typeform's sandbox nothing was sent, so nothing is booked from it.
      if (rehearse) {
        toast("Rehearsal: the booking stays closed.");
        return;
      }
      if (config.ending === "book-blueprint") setAutoBook(true);
    },
  };

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );

  // A half-filled form asks before the window closes.
  useEffect(() => {
    if (!started) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [started]);

  // The trail's clock moves on its own after a send.
  useEffect(() => {
    if (!sent) return;
    const t = window.setInterval(() => setTick(n => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [sent]);

  // The widget: mounted when the form is let open, and again only on Reload.
  const titleRef = useRef(`${config.title} form for ${clientName}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the widget mounts once per Reload; reads and callbacks go through refs
  useEffect(() => {
    if (held || !box.current) return;
    let live = true;
    let w: Widget | null = null;
    setReady(false);
    setSlow(false);
    const slowTimer = window.setTimeout(() => live && setSlow(true), 20_000);
    embed()
      .then(create => {
        if (!live || !box.current) return;
        const options: WidgetOptions = {
          container: box.current,
          hidden: prefillRef.current.values,
          inlineOnMobile: true,
          medium: "mahara-client-success",
          // The ending's redirect would otherwise take the whole window away.
          redirectTarget: "_blank",
          iframeProps: { title: titleRef.current },
          onReady: () => {
            if (live) setReady(true);
          },
          onStarted: () => handlers.current.started(),
          onSubmit: e => handlers.current.submit(e.responseId),
        };
        if (rehearse) options.enableSandbox = true;
        if (config.ending !== "none")
          options.onEndingButtonClick = () => handlers.current.ending();
        w = create(config.formId, options);
      })
      .catch(() => {
        if (live) setSlow(true);
      });
    return () => {
      live = false;
      window.clearTimeout(slowTimer);
      w?.unmount();
    };
  }, [held, mount, config.formId, rehearse]);

  const reload = () => {
    if (started && !window.confirm("Reload the form? What was typed is lost."))
      return;
    setPrefill(config.hidden(ctxRef.current));
    setStarted(false);
    setMount(m => m + 1);
  };

  const fallback = formLink(config.formId, prefill.values);
  const parts = useMemo(
    () => config.rail(ctx, prefill),
    [config, ctx, prefill],
  );
  const missingCount = parts.find(p => p.id === "missing")?.rows.length ?? 0;
  // A desk monitor (1920): the wider panel opens "What the form carries".
  const wide = useMinWidth(1536);
  const desk = useMinWidth(1024);

  const trail = sent
    ? trailFor(
        config,
        ctx,
        { responseId: sent.responseId, sentAt: sent.at },
        serverNow(ctx),
      )
    : null;

  const rail = (
    <div className="space-y-6 p-4 sm:p-5">
      {sent && trail ? (
        <AfterSend
          config={config}
          ctx={ctx}
          sent={sent}
          trail={trail}
          checking={checking}
          checkedAt={checkedAt}
          checkError={checkError}
          onCheck={() => void runCheck()}
          onRetry={() => void note(sent.responseId, sent.at)}
          book={
            book && config.ending === "book-blueprint"
              ? book({
                  label: "Book the Blueprint call",
                  variant: trail.current === null ? "default" : "outline",
                  autoOpen: autoBook,
                  onAutoOpenConsumed: () => setAutoBook(false),
                })
              : null
          }
        />
      ) : null}
      {/* Still missing first (the trail takes its place after a send),
          then what the form opened with, then the rest. */}
      {parts
        .filter(p => p.id === "missing" && !sent)
        .map(p => (
          <Part key={p.id} part={p} wide={wide} onRecheck={io.recheck} />
        ))}
      <Notes
        prefill={prefill}
        changed={changed}
        onReload={reload}
        sent={Boolean(sent)}
      />
      {parts
        .filter(p => p.id !== "missing")
        .map(p => (
          <Part key={p.id} part={p} wide={wide} onRecheck={io.recheck} />
        ))}
    </div>
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
        {held && already ? (
          <Hold
            config={config}
            clientName={clientName}
            already={already}
            onRead={already.entry ? () => setReading(already.entry) : null}
            onOpen={() => setReleased(true)}
          />
        ) : (
          <>
            <div ref={box} className="min-h-0 flex-1" data-form-frame />
            {!ready ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <p className="pointer-events-auto max-w-sm text-center text-sm text-muted-foreground">
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
                          className="text-primary underline-offset-4 hover:underline"
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
          </>
        )}
      </section>

      <aside
        hidden={sharing}
        aria-label="What the cockpit knows"
        className="order-first min-h-0 overflow-y-auto border-b bg-card lg:order-none lg:border-b-0 lg:border-l"
      >
        {desk ? (
          rail
        ) : (
          <details className="group">
            <summary className="no-marker flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
              />
              What the cockpit knows
              {missingCount && !sent ? (
                <span className="text-muted-foreground">
                  · {missingCount} missing
                </span>
              ) : null}
            </summary>
            <div className="max-h-[55dvh] overflow-y-auto border-t">{rail}</div>
          </details>
        )}
      </aside>

      <Sheet open={Boolean(reading)} onOpenChange={o => !o && setReading(null)}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          {reading ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-lg">
                  {clientName}, {config.title.toLowerCase()}
                </SheetTitle>
                <SheetDescription>
                  Filled {kuwaitShortDay(reading.submitted_at)},{" "}
                  {reading.answers.length} answers. Fix a wrong answer in
                  Typeform's results.
                </SheetDescription>
              </SheetHeader>
              <dl className="mt-4 divide-y">
                {reading.answers.map(a => (
                  <div key={a.ref} className="py-3">
                    <dt className="text-xs text-muted-foreground">{a.title}</dt>
                    <dd
                      className="mt-1 whitespace-pre-line break-words text-sm"
                      dir="auto"
                    >
                      {a.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
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
  return (
    <div className="m-auto w-full max-w-xl space-y-4 p-6 sm:p-10" role="note">
      <Kicker>Already sent</Kicker>
      <p className="text-[15px] leading-6">
        A {config.title.toLowerCase()} for <bdi>{clientName}</bdi> went in
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
        <ExtLink href={config.resultsUrl} className="text-sm">
          Open Typeform's results
        </ExtLink>
        <Button size="sm" variant="outline" onClick={onOpen}>
          Open a second {config.title.toLowerCase()} anyway
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ notes

function Notes({
  prefill,
  changed,
  onReload,
  sent,
}: {
  prefill: Prefill;
  changed: boolean;
  onReload: () => void;
  sent: boolean;
}) {
  if (!prefill.notes.length && !changed && !prefill.copy) return null;
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      {changed ? (
        <div className="callout-warn flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="min-w-0 flex-1">
            Their onboarding answers changed after this form opened. Reload the
            form to use them.
          </span>
          <Button size="sm" variant="outline" onClick={onReload}>
            <RotateCcw aria-hidden />
            Reload the form
          </Button>
        </div>
      ) : null}
      {prefill.notes.map(n => (
        <p key={n} className="flex gap-2">
          <span className="mt-1.5">
            <Dot tone="neutral" />
          </span>
          <span className="min-w-0">{n}</span>
        </p>
      ))}
      {prefill.copy && !sent ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          onClick={() => {
            const c = prefill.copy;
            if (c)
              navigator.clipboard.writeText(c.value).then(
                () => toast.success(c.done),
                () =>
                  toast.error(
                    "The browser would not copy. Select the text instead.",
                  ),
              );
          }}
        >
          <Copy aria-hidden className="size-3.5" />
          {prefill.copy.label}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the side panel

function Part({
  part,
  wide,
  onRecheck,
}: {
  part: RailPart;
  wide: boolean;
  onRecheck: () => Promise<void>;
}) {
  const rows = (
    <ul className="divide-y">
      {part.rows.map(r => (
        <Row
          key={r.id}
          row={r}
          warn={part.tone === "warn"}
          wide={wide}
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
      <details className="group">
        <summary className="no-marker flex cursor-pointer items-center gap-1">
          <ChevronRight
            aria-hidden
            className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
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
  wide,
  onRecheck,
}: {
  row: RailRow;
  warn: boolean;
  wide: boolean;
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

  if (warn)
    return (
      <li className="flex gap-2 py-2">
        <span className="mt-1.5">
          <Dot tone="warn" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{row.label}</div>
          <div className="text-xs text-muted-foreground">{row.missing}</div>
        </div>
      </li>
    );

  if (row.carries)
    return (
      <li className="py-2">
        <details className="group" open={wide}>
          <summary className="no-marker flex cursor-pointer items-center gap-1 text-sm font-medium">
            <ChevronRight
              aria-hidden
              className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
            />
            {row.label}
          </summary>
          <dl className="mt-2 space-y-2 border-l pl-3">
            {row.carries.map(c => (
              <div key={c.key}>
                <dt className="text-xs text-muted-foreground">{c.label}</dt>
                {c.value !== null ? (
                  <>
                    <dd
                      className="line-clamp-3 whitespace-pre-line break-words text-sm"
                      dir="auto"
                      title={c.value}
                    >
                      <bdi>{c.value}</bdi>
                    </dd>
                    {c.source ? <SourceTag>{c.source}</SourceTag> : null}
                  </>
                ) : (
                  <dd className="text-xs text-muted-foreground">
                    {row.missing}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      </li>
    );

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {label}
          {row.choices ? (
            <Choices choices={row.choices} />
          ) : row.value !== null && row.value !== row.href ? (
            <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-sm">
              {row.pick ? (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Pick
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
            <div className="mt-0.5 text-xs">
              <ExtLink href={row.href}>{row.linkLabel ?? "Open"}</ExtLink>
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
          <CopyButton value={row.value} label={row.label} />
        ) : null}
        {row.recheck ? (
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
                    `The call store could not be read: ${message(e)}`,
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

function AfterSend({
  config,
  ctx,
  sent,
  trail,
  checking,
  checkedAt,
  checkError,
  onCheck,
  onRetry,
  book,
}: {
  config: FormConfig;
  ctx: FormContext;
  sent: { error: string | null; busy: boolean; send: FormSend | null };
  trail: NonNullable<ReturnType<typeof trailFor>>;
  checking: boolean;
  checkedAt: string | null;
  checkError: string | null;
  onCheck: () => void;
  onRetry: () => void;
  book: ReactNode;
}) {
  const back = config.after.linkBack;
  const link = back ? ctx.row.links?.[back.key] : undefined;
  const name = config.title.toLowerCase();
  return (
    <section
      className="space-y-4 rounded-xl bg-primary/5 p-4 ring-1 ring-primary/40"
      aria-label="After the send"
    >
      <div>
        <p className="text-[15px] font-semibold leading-6">
          {config.after.say}
        </p>
        <p className="text-xs text-muted-foreground">{config.after.sub}</p>
      </div>

      {sent.error ? (
        <div className="callout-warn flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            Typeform has the {name} and Make has started, but the cockpit could
            not note it: {sent.error}
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
                  s.done
                    ? "bg-success motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-[180ms] motion-safe:ease-out"
                    : now
                      ? "glow-teal bg-primary"
                      : "bg-muted-foreground/30",
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-sm",
                    s.done || now ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                  <span className="sr-only">
                    {s.done ? ", done" : now ? ", next" : ", waiting"}
                  </span>
                </div>
                {s.line.replace(/\.$/, "") !== s.label ? (
                  <div className="text-xs text-muted-foreground">{s.line}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {trail.lateLine ? (
        <div className="callout-warn space-y-2 rounded-lg border px-3 py-2 text-xs">
          <p>{trail.lateLine}</p>
          {trail.late === "make" && ctx.row.links?.clickup ? (
            <ExtLink href={ctx.row.links.clickup}>
              Open the ClickUp card
            </ExtLink>
          ) : trail.late === "typeform" ? (
            <ExtLink href={config.resultsUrl}>Open Typeform's results</ExtLink>
          ) : null}
        </div>
      ) : null}

      {book || link ? (
        <div className="flex flex-wrap items-center gap-3">
          {book}
          {link && trail.current === null ? (
            <ExtLink href={link} className="text-sm">
              Open the Brand Blueprint form
            </ExtLink>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {checkError
            ? null
            : checkedAt
              ? `Checked ClickUp and Typeform at ${kuwaitTime(checkedAt)}.`
              : trail.late || trail.current === null
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
          The cockpit could not read ClickUp and Typeform just now: {checkError}
          . The {name} is safe in Typeform; the 10-minute sync will catch up.
        </p>
      ) : null}

      <details className="group text-xs">
        <summary className="no-marker flex cursor-pointer items-center gap-1 text-muted-foreground">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-90"
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
