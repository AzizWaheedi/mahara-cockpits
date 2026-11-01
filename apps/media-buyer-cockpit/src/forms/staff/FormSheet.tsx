/**
 * FormSheet: the one sheet every staff form opens in
 * (docs/forms/WAVE12-CONTRACT.md 4.12 and 5.1). It renders a form of
 * formDefs.ts, shows where each prefilled value came from, checks the
 * answers the way the database will, sends once per open sheet, and then
 * folds to one line and the after-send trail: saved, the card, the Slack
 * notice, the ticket. The trail is the sheet's one memorable thing; the CSM
 * watches the decision reach the card. Everything else stays quiet.
 *
 * FormBody is the same form inline, for the billing sheet's tabs.
 *
 * Shared byte for byte by the client success and CEO cockpits
 * (scripts/check-shared.sh). It imports only React, lucide, the app's Sheet,
 * ./formSheetCore and ./formSheet.css: no Button, no toast, no router, so the
 * two copies build the same.
 *
 * Behaviour: one request id per open sheet, reused on a retry; drafts in
 * localStorage (never required) cleared on success; the trail read every
 * 5 s for 2 minutes after a send, then once a minute while open; Escape
 * closes and focus goes back to the opener (Radix).
 */

import {
  CalendarDays,
  Check,
  Clock3,
  LoaderCircle,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  type Answers,
  type CallPick,
  draftKey,
  type FieldDef,
  type FormDef,
  type FormTrailRow,
  kuwaitDay,
  kuwaitIso,
  type Prefill,
  prefillLine,
  required,
  type SubmitRef,
  seedAnswers,
  sendError,
  shown,
  stepTone,
  type TrailStep,
  trailFrom,
  validate,
} from "./formSheetCore";
import "./formSheet.css";

export type FormSheetSubmit = (
  a: Answers,
  requestId: string,
) => Promise<{ message: string; ref: SubmitRef }>;

export type FormSheetProps = {
  open: boolean;
  onOpenChange(o: boolean): void;
  def: FormDef;
  client: { taskId: string; name: string };
  prefill: Prefill[];
  submit: FormSheetSubmit;
  trail(ref: SubmitRef): Promise<FormTrailRow>;
  /** The calls a decision can point to, from the prefill read. */
  calls?: CallPick[];
  /** Lines worth knowing before deciding (an extension mentioned on a 1-1). */
  hints?: Prefill[];
  /** The card's state in a few words: "Active · due 2 Nov". */
  status?: string;
  /** True while the prefill is being read. */
  loading?: boolean;
  /** The prefill read failed: said, and the form still works by hand. */
  prefillError?: string | null;
  /** Opens the prefilled request form for a ticket type (W5). */
  onTicket?: (type: string) => void;
  /** The request form's address for a ticket type, when there is no onTicket. */
  ticketHref?: (type: string) => string;
  /** Called once a send is confirmed, with its message (the page may refresh). */
  onSent?: (message: string) => void;
  /** Above the fields: a line and a choice the form's answers do not hold (the survey tick). */
  aside?: ReactNode;
};

type BodyProps = Omit<FormSheetProps, "open" | "onOpenChange"> & {
  /** Inside the sheet: its title is the dialog's title. */
  inSheet?: boolean;
  onClose?: () => void;
};

const POLL_FAST_MS = 5_000;
const POLL_FAST_FOR_MS = 120_000;
const POLL_SLOW_MS = 60_000;

/** True on a desktop-wide window: the sheet comes from the right, else from the bottom. */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return wide;
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  // Old browsers only: a v4-shaped id from Math.random.
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, ch => {
    const n = Number(ch);
    return (n ^ ((Math.random() * 16) >> (n / 4))).toString(16);
  });
}

function readDraft(key: string): Answers | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v &&
      typeof v === "object" &&
      v.answers &&
      typeof v.answers === "object"
      ? (v.answers as Answers)
      : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, a: Answers): boolean {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ answers: a, at: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

function dropDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

/** The sheet: from the right on a desk, from the bottom on a phone. */
export function FormSheet(p: FormSheetProps) {
  const wide = useWide();
  const { open, onOpenChange, ...body } = p;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? "right" : "bottom"}
        className="fs-sheet"
        data-side={wide ? "right" : "bottom"}
      >
        <FormBody {...body} inSheet onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

/** The form itself; inline on the billing sheet, inside FormSheet everywhere else. */
export function FormBody(p: BodyProps) {
  const { def, client, prefill } = p;
  const uid = useId();
  const today = useMemo(() => kuwaitIso(), []);
  const key = draftKey(def, client.taskId);
  // One request id per open sheet: a retry and a double press send the same one.
  const requestId = useRef(newRequestId());
  // A restored draft counts as typed: a prefill that lands later never overwrites it.
  const draft = useRef<Answers | null | undefined>(undefined);
  if (draft.current === undefined) draft.current = readDraft(key);
  const touched = useRef(new Set<string>(Object.keys(draft.current ?? {})));
  const [answers, setAnswers] = useState<Answers>(() => ({
    ...seedAnswers(def, prefill, today),
    ...(draft.current ?? {}),
  }));
  const [draftSaved, setDraftSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"editing" | "sending" | "sent">("editing");
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; ref: SubmitRef } | null>(
    null,
  );
  const [steps, setSteps] = useState<TrailStep[]>([]);
  const [trailNote, setTrailNote] = useState<string | null>(null);

  // A prefill that lands after the sheet opened fills only what nobody typed.
  // Keyed by its content, so a caller passing a fresh [] each render is harmless.
  const prefillKey = JSON.stringify(prefill);
  // biome-ignore lint/correctness/useExhaustiveDependencies: prefillKey stands for prefill
  useEffect(() => {
    const seeded = seedAnswers(def, prefill, today);
    setAnswers(a => {
      let changed = false;
      const next = { ...a };
      for (const [k, v] of Object.entries(seeded)) {
        const field = k.replace(/^_from(.)/, (_, c: string) => c.toLowerCase());
        if (touched.current.has(field) || Object.is(next[k], v)) continue;
        next[k] = v;
        changed = true;
      }
      return changed ? next : a;
    });
  }, [def.key, def.title, prefillKey, today]);

  const set = useCallback(
    (k: string, v: unknown) => {
      touched.current.add(k);
      setAnswers(a => {
        const next = { ...a, [k]: v };
        setDraftSaved(writeDraft(key, next));
        return next;
      });
      setErrors(e => {
        if (!e[k]) return e;
        const { [k]: _gone, ...rest } = e;
        return rest;
      });
    },
    [key],
  );

  const label = def.submitLabel(answers);

  const send = async () => {
    if (phase === "sending") return;
    const found = validate(def, answers, today);
    setErrors(found);
    const first = def.fields.find(f => found[f.key]);
    if (first) {
      document.getElementById(`${uid}-${first.key}`)?.focus();
      return;
    }
    setFailure(null);
    setPhase("sending");
    try {
      const out = await p.submit(answers, requestId.current);
      dropDraft(key);
      setDone(out);
      setSteps(
        trailFrom(
          { stored: { state: "done", at: new Date().toISOString() } },
          def,
          p.ticketHref,
        ),
      );
      setPhase("sent");
      p.onSent?.(out.message);
    } catch (e) {
      setFailure(sendError(e, label));
      setPhase("editing");
    }
  };

  // The trail: every 5 s for 2 minutes after the send, then once a minute.
  useEffect(() => {
    if (phase !== "sent" || !done) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const read = async () => {
      try {
        const row = await p.trail(done.ref);
        if (stopped) return;
        setSteps(trailFrom(row, def, p.ticketHref));
        setTrailNote(null);
      } catch (e) {
        if (stopped) return;
        const fast = Date.now() - started < POLL_FAST_FOR_MS;
        setTrailNote(
          `The trail could not be read (${e instanceof Error ? e.message : String(e)}). It reads again in ${fast ? "a few seconds" : "a minute"}.`,
        );
      }
      if (stopped) return;
      timer = setTimeout(
        read,
        Date.now() - started < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS,
      );
    };
    void read();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, done, def, p.trail, p.ticketHref]);

  const another = () => {
    requestId.current = newRequestId();
    touched.current.clear();
    setAnswers(seedAnswers(def, prefill, today));
    setDone(null);
    setSteps([]);
    setErrors({});
    setPhase("editing");
  };

  const fieldPrefill = new Map(prefill.map(x => [x.key, x]));
  /** "from the ClickUp card" under a field still holding its prefilled value. */
  const fromOf = (k: string): string | undefined => {
    const hit = fieldPrefill.get(k);
    if (!hit || hit.value === null || hit.value === undefined) return undefined;
    return touched.current.has(k) ? undefined : hit.source;
  };
  const fieldKeys = new Set(def.fields.map(f => f.key));
  const facts = [
    ...prefill.filter(x => !fieldKeys.has(x.key)),
    ...(p.hints ?? []),
  ];
  const errorCount = Object.keys(errors).length;
  const Title = p.inSheet ? SheetTitle : "h2";
  const destructive = def.tone === "destructive";

  return (
    <div className="fs-root" data-in-sheet={p.inSheet || undefined}>
      <header className="fs-head">
        <Title className="fs-title">{def.title}</Title>
        <div className="fs-client">
          <bdi className="fs-client-name">{client.name}</bdi>
          {/* The card as it was read; after a send the trail says what changed. */}
          {p.status && phase !== "sent" ? (
            <span className="fs-status">{p.status}</span>
          ) : null}
        </div>
        {phase === "sent" ? (
          p.inSheet ? (
            <SheetDescription className="fs-lede">
              Where it has reached
            </SheetDescription>
          ) : null
        ) : p.inSheet ? (
          <SheetDescription className="fs-lede">
            {def.lede ?? "The ClickUp card updates itself after you send."}
          </SheetDescription>
        ) : def.lede ? (
          <p className="fs-lede">{def.lede}</p>
        ) : null}
      </header>

      <div className="fs-scroll">
        {phase === "sent" && done ? (
          <section className="fs-after" aria-live="polite">
            <p className="fs-done">
              <span className="fs-done-word">{def.doneLabel}:</span>{" "}
              {done.message}
            </p>
            <Trail steps={steps} onTicket={p.onTicket} />
            {trailNote ? <p className="fs-note">{trailNote}</p> : null}
          </section>
        ) : (
          <form
            className="fs-form"
            noValidate
            onSubmit={e => {
              e.preventDefault();
              void send();
            }}
          >
            {p.loading ? (
              <p className="fs-note" role="status">
                Reading the card and the last calls…
              </p>
            ) : null}
            {p.prefillError ? (
              <p className="fs-note fs-note-warn" role="status">
                {p.prefillError} Fill the form by hand; nothing is guessed.
              </p>
            ) : null}
            {facts.length ? (
              <ul
                className="fs-facts"
                aria-label="What the cockpit already knows"
              >
                {facts.map(x => (
                  <li
                    key={`${x.key}:${x.source}`}
                    className="fs-fact"
                    dir="auto"
                  >
                    {prefillLine(x)}
                  </li>
                ))}
              </ul>
            ) : null}
            {p.aside ?? null}
            {def.fields
              .filter(f => shown(f, answers))
              .map(f => (
                <Field
                  key={f.key}
                  id={`${uid}-${f.key}`}
                  f={f}
                  value={answers[f.key]}
                  answers={answers}
                  today={today}
                  error={errors[f.key]}
                  calls={p.calls ?? []}
                  from={fromOf(f.key)}
                  onChange={v => set(f.key, v)}
                />
              ))}
            {/* Enter in a text box sends, like any form. */}
            <button type="submit" hidden tabIndex={-1} aria-hidden />
          </form>
        )}
      </div>

      <footer className="fs-foot">
        {phase === "sent" ? (
          <>
            <span className="fs-foot-note">
              Saved. The trail above updates itself.
            </span>
            {p.inSheet ? (
              <button
                type="button"
                className="fs-btn fs-btn-quiet"
                onClick={p.onClose}
              >
                Close
              </button>
            ) : (
              <button
                type="button"
                className="fs-btn fs-btn-quiet"
                onClick={another}
              >
                Start another
              </button>
            )}
          </>
        ) : (
          <>
            <div className="fs-foot-note" aria-live="polite">
              {failure ? (
                <span className="fs-fail" role="alert">
                  {failure}
                </span>
              ) : errorCount ? (
                <span className="fs-fail" role="alert">
                  {errorCount === 1
                    ? "One answer needs a fix above."
                    : `${errorCount} answers need a fix above.`}
                </span>
              ) : draftSaved ? (
                "Draft saved"
              ) : null}
            </div>
            <button
              type="button"
              className="fs-btn"
              data-tone={destructive ? "destructive" : "primary"}
              data-busy={phase === "sending" || undefined}
              disabled={phase === "sending"}
              onClick={() => void send()}
            >
              {phase === "sending" ? (
                <>
                  <LoaderCircle aria-hidden className="fs-spin" />
                  Saving…
                </>
              ) : (
                label
              )}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

const STEP_ICON = {
  done: Check,
  waiting: Clock3,
  held: Clock3,
  failed: X,
  skipped: Minus,
  none: null,
} as const;

/** The after-send trail: four rings in order, each with its sentence. */
export function Trail({
  steps,
  onTicket,
}: {
  steps: TrailStep[];
  onTicket?: (type: string) => void;
}) {
  return (
    <ol className="fs-trail" aria-label="Where this decision has reached">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.state];
        return (
          <li
            key={s.key}
            className="fs-step"
            data-state={s.state}
            style={{ "--i": i } as CSSProperties}
          >
            <span className="fs-ring" data-tone={stepTone(s.state)} aria-hidden>
              {Icon ? <Icon className="fs-ring-icon" /> : null}
            </span>
            <span className="fs-step-text">
              <span className="fs-step-label">{s.label}</span>
              {s.key === "ticket" && s.action && !onTicket && !s.action.href ? (
                <span className="fs-hint">
                  {s.action.label} from the client page.
                </span>
              ) : null}
              {s.action && (onTicket || s.action.href) ? (
                s.key === "ticket" && onTicket && s.action.type ? (
                  <button
                    type="button"
                    className="fs-link"
                    onClick={() => onTicket(String(s.action?.type))}
                  >
                    {s.action.label}
                  </button>
                ) : s.action.href && s.key !== "ticket" ? (
                  <a
                    className="fs-link"
                    href={s.action.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.action.label}
                  </a>
                ) : s.action.href ? (
                  <a className="fs-link" href={s.action.href}>
                    {s.action.label}
                  </a>
                ) : null
              ) : null}
            </span>
            {s.detail ? <span className="fs-step-time">{s.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function FieldShell({
  id,
  f,
  answers,
  error,
  from,
  children,
  group = false,
}: {
  id: string;
  f: FieldDef;
  answers: Answers;
  error?: string;
  from?: string;
  children: ReactNode;
  group?: boolean;
}) {
  // A requirement that hangs on another answer (a Non-payment pause's restart) is read for these answers.
  const optional = !required(f, answers);
  const head = (
    <>
      {f.label}
      {optional ? <span className="fs-optional"> (optional)</span> : null}
    </>
  );
  const foot = (
    <>
      {from ? <span className="fs-from">from {from}</span> : null}
      {/* A general hint gives way to the value's own source. */}
      {f.hint && !from ? (
        <span className="fs-hint" id={`${id}-hint`}>
          {f.hint}
        </span>
      ) : null}
      {error ? (
        <span className="fs-error" id={`${id}-error`}>
          <TriangleAlert aria-hidden className="fs-error-icon" />
          {error}
        </span>
      ) : null}
    </>
  );
  if (group)
    return (
      <fieldset className="fs-field" data-invalid={error ? true : undefined}>
        <legend className="fs-label">{head}</legend>
        {children}
        {foot}
      </fieldset>
    );
  return (
    <div className="fs-field" data-invalid={error ? true : undefined}>
      <label className="fs-label" htmlFor={id}>
        {head}
      </label>
      {children}
      {foot}
    </div>
  );
}

function describedBy(
  id: string,
  f: FieldDef,
  error?: string,
  from?: string,
): string | undefined {
  const ids = [
    f.hint && !from ? `${id}-hint` : "",
    error ? `${id}-error` : "",
  ].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function Field({
  id,
  f,
  value,
  answers,
  today,
  error,
  calls,
  from,
  onChange,
}: {
  id: string;
  f: FieldDef;
  value: unknown;
  answers: Answers;
  today: string;
  error?: string;
  calls: CallPick[];
  from?: string;
  onChange: (v: unknown) => void;
}) {
  const aria = {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(id, f, error, from),
  } as const;
  const str = value === null || value === undefined ? "" : String(value);

  if (f.type === "choice" || f.type === "yesno") {
    const options = f.options ?? [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];
    return (
      <FieldShell
        id={id}
        f={f}
        answers={answers}
        error={error}
        from={from}
        group
      >
        <div className="fs-pills">
          {options.map((o, i) => (
            <label key={o.value} className="fs-pill">
              <input
                type="radio"
                name={id}
                id={i === 0 ? id : undefined}
                value={o.value}
                checked={str === o.value}
                onChange={() => onChange(o.value)}
                {...aria}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </FieldShell>
    );
  }

  if (f.type === "multi") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <FieldShell
        id={id}
        f={f}
        answers={answers}
        error={error}
        from={from}
        group
      >
        <div className="fs-pills">
          {(f.options ?? []).map((o, i) => {
            const on = picked.includes(o.value);
            return (
              <label key={o.value} className="fs-pill">
                <input
                  type="checkbox"
                  id={i === 0 ? id : undefined}
                  checked={on}
                  onChange={() => {
                    if (on) onChange(picked.filter(v => v !== o.value));
                    else if (f.exclusive && o.value === f.exclusive)
                      onChange([o.value]);
                    else
                      onChange([
                        ...picked.filter(v => v !== f.exclusive),
                        o.value,
                      ]);
                  }}
                  {...aria}
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      </FieldShell>
    );
  }

  if (f.type === "tick") {
    const strong = f.emphasis ? f.emphasis(answers, today) : false;
    return (
      <div className="fs-field fs-tick" data-invalid={error ? true : undefined}>
        <label className="fs-tick-row" data-strong={strong || undefined}>
          <input
            type="checkbox"
            id={id}
            checked={value === true}
            onChange={e => onChange(e.target.checked)}
            {...aria}
          />
          <span>{f.label}</span>
        </label>
        {error ? (
          <span className="fs-error" id={`${id}-error`}>
            <TriangleAlert aria-hidden className="fs-error-icon" />
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  if (f.type === "call") {
    return (
      <FieldShell
        id={id}
        f={f}
        answers={answers}
        error={error}
        from={from}
        group
      >
        {calls.length ? (
          <div className="fs-calls">
            {/* An optional pick can go back to none: the latest call is not the exit call by default. */}
            {f.noneLabel && !required(f, answers) ? (
              <label className="fs-call" data-none>
                <input
                  type="radio"
                  name={id}
                  value=""
                  checked={str === ""}
                  onChange={() => onChange(null)}
                  {...aria}
                />
                <span className="fs-call-body">
                  <span className="fs-call-kind">{f.noneLabel}</span>
                </span>
              </label>
            ) : null}
            {calls.map((c, i) => (
              <label key={c.id} className="fs-call">
                <input
                  type="radio"
                  name={id}
                  id={i === 0 ? id : undefined}
                  value={c.id}
                  checked={str === c.id}
                  onChange={() => onChange(c.id)}
                  {...aria}
                />
                <span className="fs-call-body">
                  <span className="fs-call-day">
                    <CalendarDays aria-hidden className="fs-call-icon" />
                    {kuwaitDay(c.at) || "No date"}
                  </span>
                  <span className="fs-call-kind">{c.kind}</span>
                  {c.source ? (
                    <span className="fs-call-from">from {c.source}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="fs-note" id={id} tabIndex={-1}>
            No call with this client in the last 30 days.
          </p>
        )}
      </FieldShell>
    );
  }

  if (f.type === "readonly")
    return (
      <div className="fs-field">
        <span className="fs-label">{f.label}</span>
        <p className="fs-readonly" dir="auto">
          {str || "Nobody holds this yet"}
        </p>
      </div>
    );

  if (f.type === "longtext")
    return (
      <FieldShell id={id} f={f} answers={answers} error={error} from={from}>
        <textarea
          id={id}
          className="fs-input fs-textarea"
          rows={3}
          dir="auto"
          value={str}
          placeholder={f.placeholder}
          onChange={e => onChange(e.target.value)}
          {...aria}
        />
      </FieldShell>
    );

  return (
    <FieldShell id={id} f={f} answers={answers} error={error} from={from}>
      <input
        id={id}
        className="fs-input"
        type={f.type === "date" ? "date" : "text"}
        inputMode={f.type === "number" ? "decimal" : undefined}
        dir={f.type === "text" ? "auto" : undefined}
        value={str}
        placeholder={f.placeholder}
        onChange={e => onChange(e.target.value)}
        {...aria}
      />
    </FieldShell>
  );
}
