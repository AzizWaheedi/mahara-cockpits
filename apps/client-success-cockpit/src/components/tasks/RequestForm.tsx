import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CornerDownRight,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  errorWords,
  newRequestId,
  previewRequest,
  readRequest,
  readRequestClients,
  readRequestTypes,
  submitRequest,
} from "@/lib/requestsClient";
import {
  CLICKUP_FORM_URL,
  type ClientOption,
  cleanAnswers,
  clientField,
  dayLabel,
  deliveredNote,
  dueField,
  type FieldView,
  fieldOfSentence,
  groupTypes,
  kuwaitToday,
  LIMITS,
  ownerNote,
  PRIORITIES,
  type Priority,
  partHeld,
  partMoving,
  priorityField,
  REQUEST_SENTENCES,
  type RoutePart,
  type RoutePreview,
  requestsOpen,
  type SubmitResult,
  sentLines,
  type TypesRead,
  type TypeView,
  validateAnswers,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";
import "./requests.css";

/*
 * Hallmark · component: request form · genre: modern-minimal (the cockpits')
 * · theme: each app's own tokens (docs/DESIGN.md is the locked system)
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H5 E4 S5 R4 V4
 *
 * Design plan (CONTRACT.md 6.1, 6.4; frontend-design and Hallmark, component
 * scope, no macrostructure):
 * - Subject: someone on a thirteen-person agency team asking another team
 *   for work. The job: pick the right request, answer only its questions,
 *   and know before pressing Send exactly where it lands.
 * - Tokens: the app's own. --primary (Mahara teal) for the one action and
 *   the chosen row, var(--tk-ink) (requests.css) for teal marks in
 *   light mode, --destructive for a refusal, --success for sent. No new
 *   colour, no gradient, no glow.
 * - Type: Geist; 14px inputs and rows, 13px route and help lines; Geist Mono
 *   only for the small group and route kickers. Client and task names sit in
 *   <bdi dir="auto"> so Arabic names keep their order.
 * - Layout: one column, no card of its own (the page or the client page
 *   gives it one). Pick, answer, due and priority, the route, Send.
 * - Signature: the route line. Under the questions, before Send, one line per
 *   task: Goes to Operations / Tech as "Acme - Client pause (Tech)". Owner:
 *   the systems manager. Uses the ClickUp template ... Due Wed 28 Oct. A
 *   CornerDownRight mark in teal starts each line, the way a routing slip
 *   points onward.
 * - Copy: plain and active. "Send request" becomes "Request sent." An error
 *   is the server's own sentence, under the field it names.
 */

export type RequestFormProps = {
  /** Where the request is raised: the portal's /requests or a client page. */
  source: "requests_page" | "client_page";
  /** The client, fixed (the CSM client page, or a routed old ticket). */
  presetClient?: { taskId: string; name: string };
  /** A type key to start on; the person can still change it. */
  presetType?: string;
  /** Text for the type's details question (a routed old ticket). */
  presetDetails?: string;
  /**
   * Answers to start from, by field key, as words (a request filed again
   * after it did not reach ClickUp). A choice matches by its name or id.
   */
  presetAnswers?: Record<string, string>;
  /** The old ClickUp form ticket this request routes (2.10). */
  replacesTaskId?: string;
  /** Tighter spacing and a shorter type list, inside another card. */
  compact?: boolean;
  /** Called once a request is sent (not for a duplicate). */
  onSent?: (result: SubmitResult) => void;
};

type Load<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

type Answers = Record<string, string>;

/**
 * Ask a team: the request form (CONTRACT.md 6.4). Shared byte for byte by
 * the five cockpits; it reads the seat through each app's own taskSeat.ts.
 */
export function RequestForm({
  source,
  presetClient,
  presetType,
  presetDetails,
  presetAnswers,
  replacesTaskId,
  compact = false,
  onSent,
}: RequestFormProps) {
  const seat = useTaskSeat();
  const client = seat.client;
  const [types, setTypes] = useState<Load<TypesRead>>({ status: "loading" });
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [picked, setPicked] = useState<{ taskId: string; name: string } | null>(
    presetClient ?? null,
  );
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SubmitResult | null>(null);
  // Whether requests were open for the sent request: its words say "Saved"
  // until they are, never "Sending" or "In {list}".
  const [sentOpen, setSentOpen] = useState(true);
  const [duplicate, setDuplicate] = useState<SubmitResult | null>(null);
  const [preview, setPreview] = useState<Load<RoutePreview> | null>(null);
  // True while a new preview is being read over the last one.
  const [previewBusy, setPreviewBusy] = useState(false);
  // One id per request: a retry of the same press reuses it (2.5 step 3).
  const requestId = useRef(newRequestId());
  const inFlight = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const loadTypes = useCallback(async () => {
    if (!client) return;
    setTypes({ status: "loading" });
    try {
      setTypes({ status: "ready", data: await readRequestTypes(client) });
    } catch (e) {
      setTypes({ status: "error", error: errorWords(e) });
    }
  }, [client]);

  useEffect(() => {
    if (seat.ready && client) void loadTypes();
  }, [seat.ready, client, loadTypes]);

  // On a client page only the types that take a client make sense.
  const offered = useMemo(() => {
    if (types.status !== "ready") return [];
    const all = types.data.types.filter(t => t.enabled);
    return source === "client_page" || presetClient
      ? all.filter(t => clientField(t))
      : all;
  }, [types, source, presetClient]);
  const type = offered.find(t => t.key === typeKey) ?? null;

  const choose = useCallback(
    (
      next: TypeView | null,
      details?: string,
      start?: Record<string, string>,
    ) => {
      setTypeKey(next?.key ?? null);
      setErrors({});
      setFormError(null);
      setAttempted(false);
      setPreview(null);
      if (!next) return;
      setDueOn(next.dueDefault);
      setPriority(next.priority);
      setAnswers(startAnswers(next, details, start));
    },
    [],
  );

  // The preset type, once the types are read.
  const presetDone = useRef(false);
  useEffect(() => {
    if (presetDone.current || types.status !== "ready") return;
    presetDone.current = true;
    const hit = offered.find(t => t.key === presetType);
    if (hit) choose(hit, presetDetails, presetAnswers);
  }, [types.status, offered, presetType, presetDetails, presetAnswers, choose]);

  // Re-check a field once the person has pressed Send and then fixes it.
  useEffect(() => {
    if (!attempted || !type) return;
    setErrors(validateAnswers(type, answers, picked?.taskId ?? null, dueOn));
  }, [attempted, type, answers, picked, dueOn]);

  // The route line: re-read when the type, the client or a choice changes
  // (a choice is the only kind of answer a part's "runs when" reads).
  // Only the choices decide which tasks run and where they go, so the
  // preview is read again when one of them changes, not on every key press.
  const choiceKey = useMemo(() => {
    if (!type) return "{}";
    const picks: Record<string, string> = {};
    for (const f of type.fields)
      if (f.kind === "select" && answers[f.key]) picks[f.key] = answers[f.key];
    return JSON.stringify(picks);
  }, [type, answers]);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!client || !type) return;
    const seq = ++previewSeq.current;
    const choices = JSON.parse(choiceKey) as Record<string, string>;
    setPreview(p => (p?.status === "ready" ? p : { status: "loading" }));
    setPreviewBusy(true);
    const timer = setTimeout(async () => {
      try {
        const data = await previewRequest(
          client,
          type.key,
          picked?.taskId ?? null,
          choices,
        );
        if (seq === previewSeq.current) setPreview({ status: "ready", data });
      } catch (e) {
        if (seq === previewSeq.current)
          setPreview({ status: "error", error: errorWords(e) });
      } finally {
        if (seq === previewSeq.current) setPreviewBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [client, type, picked?.taskId, choiceKey]);

  const writer =
    preview?.status === "ready"
      ? preview.data.writer
      : types.status === "ready"
        ? types.data.writer
        : null;
  // Whether a send now reaches ClickUp, or is only saved until requests
  // open (a dry run, or off the test card): the server's answer for this
  // card (writer.held) when it gives one, else the writer's mode.
  const open =
    typeof writer?.held === "boolean"
      ? !writer.held
      : requestsOpen(
          types.status === "ready" ? types.data.writer : null,
          picked?.taskId ?? null,
        );

  // After a send, read the request again while a task is on its way, so the
  // panel says "In {list}" only once ClickUp has it. Every 5 seconds for two
  // minutes at most; a failed read keeps the last answer.
  const sentId = sent?.id ?? null;
  const moving = Boolean(sent?.parts.some(p => partMoving(p, sentOpen)));
  useEffect(() => {
    if (!client || !sentId || !moving) return;
    let reads = 0;
    let live = true;
    const timer = setInterval(async () => {
      reads += 1;
      if (reads > 24) {
        clearInterval(timer);
        return;
      }
      try {
        const next = await readRequest(client, sentId);
        if (!live) return;
        setSent(s => (s && s.id === sentId ? { ...s, parts: next.parts } : s));
        if (typeof next.held === "boolean") setSentOpen(!next.held);
      } catch {
        // The panel keeps what it last knew.
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, sentId, moving]);

  const setAnswer = (key: string, value: string) =>
    setAnswers(a => ({ ...a, [key]: value }));

  const focusField = (key: string) => {
    const el = formRef.current?.querySelector<HTMLElement>(
      `[data-field="${key}"]`,
    );
    el?.focus();
  };

  async function send() {
    if (inFlight.current || !client) return;
    if (!type) {
      setFormError(REQUEST_SENTENCES.noType);
      return;
    }
    setAttempted(true);
    setFormError(null);
    const problems = validateAnswers(
      type,
      answers,
      picked?.taskId ?? null,
      dueOn,
    );
    setErrors(problems);
    const first = Object.keys(problems)[0];
    if (first) {
      focusField(first);
      return;
    }
    if (
      preview?.status === "ready" &&
      preview.data.parts.length === 0 &&
      preview.data.note
    ) {
      setFormError(preview.data.note);
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const result = await submitRequest(client, {
        requestId: requestId.current,
        typeKey: type.key,
        clientTaskId: picked?.taskId ?? null,
        answers: cleanAnswers(type, answers),
        dueOn: dueOn || null,
        priority,
        source,
        replacesTaskId: replacesTaskId ?? null,
      });
      if (result.state === "duplicate") {
        setDuplicate(result);
      } else {
        const reached = typeof result.held === "boolean" ? !result.held : open;
        setSentOpen(reached);
        setSent(result);
        seat.toast.success(
          result.parts.length && result.parts.every(p => partHeld(p, reached))
            ? REQUEST_SENTENCES.saved
            : REQUEST_SENTENCES.sent,
        );
        onSent?.(result);
      }
    } catch (e) {
      const words = errorWords(e);
      const key = fieldOfSentence(type, words);
      if (key) {
        setErrors(x => ({ ...x, [key]: words }));
        focusField(key);
      } else setFormError(words);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function again() {
    requestId.current = newRequestId();
    setSent(null);
    setDuplicate(null);
    setPicked(presetClient ?? null);
    choose(null);
    setAnswers({});
  }

  const root = `rq-form${compact ? " rq-compact" : ""}`;

  if (!seat.ready)
    return (
      <div className={root}>
        <Waiting text="Checking your seat" />
      </div>
    );
  if (!seat.signedIn || !client)
    return (
      <div className={root}>
        <p className="rq-note">Sign in with your cockpit seat to ask a team.</p>
      </div>
    );
  if (types.status === "loading")
    return (
      <div className={root}>
        <Waiting text={REQUEST_SENTENCES.loadingTypes} />
      </div>
    );
  if (types.status === "error")
    return (
      <div className={root}>
        <div className="rq-alert" role="alert">
          <CircleAlert aria-hidden className="rq-alert-icon" />
          <div>
            <p>{types.error}</p>
            <button
              type="button"
              className="rq-btn rq-btn-outline rq-btn-sm"
              onClick={() => void loadTypes()}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );

  if (sent)
    return (
      <div className={root}>
        <div className="rq-sent" role="status">
          <CircleCheck aria-hidden className="rq-sent-icon" />
          <div className="rq-sent-body">
            {sentLines(sent.parts, sentOpen).map((line, i) => {
              const note = deliveredNote(sent.parts[i]);
              return (
                <div key={sent.parts[i]?.part ?? line}>
                  <p className="rq-sent-line">{line}</p>
                  {note ? (
                    <p className="rq-muted rq-warn-note">{note}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="rq-actions">
          <button
            type="button"
            className="rq-btn rq-btn-outline"
            onClick={again}
          >
            Ask for something else
          </button>
          <PortalLink to="/requests?view=mine" className="rq-btn rq-btn-ghost">
            See it in My requests
          </PortalLink>
        </div>
      </div>
    );

  if (duplicate)
    return (
      <div className={root}>
        <div className="rq-alert" role="status">
          <CircleAlert aria-hidden className="rq-alert-icon rq-warn" />
          <p>{duplicate.note}</p>
        </div>
        <div className="rq-actions">
          {duplicate.duplicateOf ? (
            <PortalLink
              to={`/requests?id=${encodeURIComponent(duplicate.duplicateOf)}`}
              className="rq-btn rq-btn-primary"
            >
              Open it
            </PortalLink>
          ) : null}
          <button
            type="button"
            className="rq-btn rq-btn-outline"
            onClick={again}
          >
            Ask for something else
          </button>
        </div>
      </div>
    );

  const due = type ? dueField(type) : null;
  const prio = type ? priorityField(type) : null;
  const today = kuwaitToday();

  // The writer's answer before anyone types (2.8): said once at the top
  // until a type is picked, then in place of Send.
  const writerOff = writer && !writer.canSend ? writer : null;
  // A seat that may file while requests are not open (editors, admins, the
  // CEO in a dry run) is told the request is saved, not sent.
  const writerNote =
    writer?.canSend && writer.note?.trim() ? writer.note.trim() : null;

  return (
    <div className={root} ref={formRef}>
      {writerOff && !type ? <WriterOff note={writerOff.note} /> : null}
      {/* A held request's note (saved until requests open): said before
          anything is picked, then above Send. */}
      {writerNote && !type ? (
        <p className="rq-off rq-off-note" role="status">
          {writerNote}
        </p>
      ) : null}
      <TypePicker
        types={offered}
        chosen={type}
        compact={compact}
        onChoose={t => choose(t)}
        error={formError === REQUEST_SENTENCES.noType ? formError : null}
      />

      {type ? (
        <>
          {type.fields.map(f => {
            if (f.kind === "deadline" || f.kind === "priority") return null;
            if (f.kind === "client")
              return (
                <ClientPicker
                  key={f.key}
                  field={f}
                  baseId={baseId}
                  locked={presetClient ?? null}
                  picked={picked}
                  onPick={setPicked}
                  error={errors[f.key] ?? null}
                />
              );
            return (
              <FieldInput
                key={f.key}
                field={f}
                baseId={baseId}
                value={answers[f.key] ?? ""}
                onChange={v => setAnswer(f.key, v)}
                error={errors[f.key] ?? null}
              />
            );
          })}

          <div className="rq-pair">
            {due ? (
              <Labelled
                id={`${baseId}-due`}
                label={due.label}
                help={
                  dueOn
                    ? `${dayLabel(dueOn, today)}, Kuwait time.`
                    : "The day it should be done."
                }
                error={errors[due.key] ?? null}
              >
                <input
                  id={`${baseId}-due`}
                  data-field={due.key}
                  type="date"
                  className="rq-input"
                  value={dueOn}
                  min={today}
                  required={due.required}
                  aria-invalid={errors[due.key] ? true : undefined}
                  aria-describedby={`${baseId}-due-note`}
                  onChange={e => setDueOn(e.target.value)}
                />
              </Labelled>
            ) : null}
            {prio ? (
              <Labelled id={`${baseId}-priority`} label={prio.label}>
                <select
                  id={`${baseId}-priority`}
                  data-field={prio.key}
                  className="rq-input rq-select"
                  value={priority}
                  onChange={e => setPriority(e.target.value as Priority)}
                >
                  {PRIORITIES.map(p => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Labelled>
            ) : null}
          </div>

          <RouteLines preview={preview} busy={previewBusy} dueOn={dueOn} />

          {formError && formError !== REQUEST_SENTENCES.noType ? (
            <div className="rq-alert" role="alert">
              <CircleAlert aria-hidden className="rq-alert-icon" />
              <p>{formError}</p>
            </div>
          ) : null}

          {writerOff ? (
            <WriterOff note={writerOff.note} />
          ) : (
            <div className="rq-actions">
              {writerNote ? (
                <p className="rq-off rq-off-note" role="status">
                  {writerNote}
                </p>
              ) : null}
              <button
                type="button"
                className="rq-btn rq-btn-primary"
                data-state={sending ? "loading" : undefined}
                aria-busy={sending || undefined}
                disabled={sending}
                onClick={() => void send()}
              >
                {sending ? (
                  <>
                    <LoaderCircle aria-hidden className="rq-spin" />
                    Sending
                  </>
                ) : (
                  "Send request"
                )}
              </button>
            </div>
          )}
        </>
      ) : formError && formError !== REQUEST_SENTENCES.noType ? (
        <p className="rq-error">{formError}</p>
      ) : null}
    </div>
  );
}

/**
 * A type's first answers: the routed ticket's details, or a request's own
 * answers as words when it is filed again (a choice by its name or id).
 */
export function startAnswers(
  type: TypeView,
  details?: string,
  start?: Record<string, string>,
): Answers {
  const out: Answers = {};
  for (const f of type.fields) {
    const raw = start?.[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === "")
      continue;
    const text = String(raw).trim();
    if (f.kind === "select") {
      const hit = (f.options ?? []).find(o => o.id === text || o.name === text);
      if (hit) out[f.key] = hit.id;
    } else if (!["client", "deadline", "priority"].includes(f.kind))
      out[f.key] = text;
  }
  const detailsField = type.fields.find(f => f.kind === "details");
  if (details && detailsField) out[detailsField.key] = details;
  return out;
}

/** A link into the portal: in place inside it, a plain link from elsewhere. */
function PortalLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const seat = useTaskSeat();
  if (seat.inPortal)
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={seat.portalHref(to)} className={className}>
      {children}
    </a>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="rq-note" role="status">
      <LoaderCircle aria-hidden className="rq-spin" />
      {text}
    </p>
  );
}

function Labelled({
  id,
  label,
  optional,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  help?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="rq-field">
      <label className="rq-label" htmlFor={id}>
        {label}
        {optional ? <span className="rq-optional"> (optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-note`} className="rq-error" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-note`} className="rq-help">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** "What do you need?": the types, grouped by team, searchable. */
function TypePicker({
  types,
  chosen,
  compact,
  onChoose,
  error,
}: {
  types: TypeView[];
  chosen: TypeView | null;
  compact: boolean;
  onChoose: (t: TypeView | null) => void;
  error: string | null;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const groups = useMemo(() => groupTypes(types, search), [types, search]);

  if (chosen)
    return (
      <div className="rq-field">
        <p className="rq-label">What do you need?</p>
        <div className="rq-chosen">
          <div className="rq-chosen-text">
            <span className="rq-chosen-name">{chosen.label}</span>
            <span className="rq-muted">{joinTeams(chosen)}</span>
          </div>
          <button
            type="button"
            className="rq-btn rq-btn-ghost rq-btn-sm"
            onClick={() => onChoose(null)}
          >
            Change
          </button>
        </div>
      </div>
    );

  if (!types.length)
    return <p className="rq-note">{REQUEST_SENTENCES.noTypes}</p>;

  return (
    <div className="rq-field">
      <label className="rq-label" htmlFor={searchId}>
        What do you need?
      </label>
      <div className="rq-search">
        <Search aria-hidden className="rq-search-icon" />
        <input
          id={searchId}
          type="search"
          className="rq-input rq-search-input"
          placeholder="Search, for example pause or script"
          value={search}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rq-error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className={`rq-types${compact ? " rq-types-short" : ""}`}
        role="group"
        aria-label="Request types"
      >
        {groups.length ? (
          groups.map(g => (
            <div key={g.team} className="rq-group">
              <p className="rq-group-label">{g.teamLabel}</p>
              {g.types.map(t => {
                const also = t.parts
                  .map(p => p.teamLabel)
                  .filter((x, i, a) => x !== t.teamLabel && a.indexOf(x) === i);
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="rq-type"
                    onClick={() => onChoose(t)}
                  >
                    <span className="rq-type-name">{t.label}</span>
                    {also.length ? (
                      <span className="rq-type-also">
                        and {also.join(", ")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <p className="rq-note rq-pad">{REQUEST_SENTENCES.noMatch}</p>
        )}
      </div>
    </div>
  );
}

const joinTeams = (t: TypeView) => {
  const teams = t.parts
    .map(p => p.teamLabel)
    .filter((x, i, a) => a.indexOf(x) === i);
  return teams.length ? teams.join(" and ") : t.teamLabel;
};

/** The client: picked from the cards this seat may raise a request for. */
function ClientPicker({
  field,
  baseId,
  locked,
  picked,
  onPick,
  error,
}: {
  field: FieldView;
  baseId: string;
  locked: { taskId: string; name: string } | null;
  picked: { taskId: string; name: string } | null;
  onPick: (c: { taskId: string; name: string } | null) => void;
  error: string | null;
}) {
  const seat = useTaskSeat();
  const id = `${baseId}-client`;
  const [search, setSearch] = useState("");
  const [stopped, setStopped] = useState(false);
  // An optional client opens its list once the search is used, so a
  // request that needs no client stays short.
  const [browsing, setBrowsing] = useState(field.required);
  const [found, setFound] = useState<Load<{
    clients: ClientOption[];
    more: boolean;
  }> | null>(null);
  const seq = useRef(0);
  const open = !locked && !picked && browsing;

  useEffect(() => {
    if (!open || !seat.client) return;
    const n = ++seq.current;
    const client = seat.client;
    setFound(f => (f?.status === "ready" ? f : { status: "loading" }));
    const timer = setTimeout(async () => {
      try {
        const data = await readRequestClients(client, search, stopped);
        if (n === seq.current) setFound({ status: "ready", data });
      } catch (e) {
        if (n === seq.current)
          setFound({ status: "error", error: errorWords(e) });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, seat.client, search, stopped]);

  if (locked)
    return (
      <div className="rq-field">
        <p className="rq-label">{field.label}</p>
        <div className="rq-chosen">
          <bdi dir="auto" className="rq-chosen-name">
            {locked.name || `Client card ${locked.taskId}`}
          </bdi>
        </div>
      </div>
    );

  if (picked)
    return (
      <div className="rq-field">
        <p className="rq-label">{field.label}</p>
        <div className="rq-chosen">
          <bdi dir="auto" className="rq-chosen-name">
            {picked.name}
          </bdi>
          <button
            type="button"
            className="rq-btn rq-btn-ghost rq-btn-sm"
            onClick={() => onPick(null)}
          >
            Change
          </button>
        </div>
      </div>
    );

  return (
    <Labelled
      id={id}
      label={field.label}
      optional={!field.required}
      help={field.help}
      error={error}
    >
      <div className="rq-search">
        <Search aria-hidden className="rq-search-icon" />
        <input
          id={id}
          data-field={field.key}
          type="search"
          className="rq-input rq-search-input"
          placeholder="Search the client cards"
          value={search}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-required={field.required || undefined}
          aria-describedby={error || field.help ? `${id}-note` : undefined}
          onFocus={() => setBrowsing(true)}
          onChange={e => {
            setBrowsing(true);
            setSearch(e.target.value);
          }}
        />
      </div>
      {browsing ? (
        <>
          <label className="rq-check">
            <input
              type="checkbox"
              checked={stopped}
              onChange={e => setStopped(e.target.checked)}
            />
            Show stopped clients
          </label>
          <div className="rq-clients" aria-live="polite">
            {!found || found.status === "loading" ? (
              <Waiting text="Reading the client cards" />
            ) : found.status === "error" ? (
              <p className="rq-error">{found.error}</p>
            ) : found.data.clients.length ? (
              <>
                {found.data.clients.map(c => (
                  <button
                    key={c.taskId}
                    type="button"
                    className="rq-type"
                    onClick={() => onPick({ taskId: c.taskId, name: c.name })}
                  >
                    <bdi dir="auto" className="rq-type-name">
                      {c.name}
                    </bdi>
                    {c.status ? (
                      <span className="rq-type-also">{c.status}</span>
                    ) : null}
                  </button>
                ))}
                {found.data.more ? (
                  <p className="rq-note rq-pad">
                    More clients match. Type more of the name.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="rq-note rq-pad">{REQUEST_SENTENCES.noClients}</p>
            )}
          </div>
        </>
      ) : null}
    </Labelled>
  );
}

/** One question of the chosen type. */
function FieldInput({
  field,
  baseId,
  value,
  onChange,
  error,
}: {
  field: FieldView;
  baseId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  const id = `${baseId}-${field.key}`;
  const common = {
    id,
    "data-field": field.key,
    "aria-invalid": error ? true : undefined,
    "aria-required": field.required || undefined,
    "aria-describedby": error || field.help ? `${id}-note` : undefined,
  } as const;
  const missingChoice =
    field.kind === "select" && (field.options?.length ?? 0) === 0;
  let input: ReactNode;
  if (field.kind === "longtext" || field.kind === "details")
    input = (
      <textarea
        {...common}
        className="rq-input rq-textarea"
        dir="auto"
        rows={3}
        maxLength={LIMITS.longtext}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  else if (field.kind === "select")
    input = (
      <select
        {...common}
        className="rq-input rq-select"
        value={value}
        disabled={missingChoice}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{missingChoice ? "Not available" : "Pick one"}</option>
        {(field.options ?? []).map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  else
    input = (
      <input
        {...common}
        className="rq-input"
        dir={field.kind === "text" ? "auto" : undefined}
        type={
          field.kind === "url"
            ? "url"
            : field.kind === "number"
              ? "number"
              : "text"
        }
        inputMode={field.kind === "number" ? "numeric" : undefined}
        min={field.kind === "number" ? 0 : undefined}
        max={field.kind === "number" ? LIMITS.number : undefined}
        step={field.kind === "number" ? 1 : undefined}
        maxLength={field.kind === "text" ? LIMITS.text : undefined}
        placeholder={field.kind === "url" ? "https://" : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  return (
    <Labelled
      id={id}
      label={field.label}
      optional={!field.required}
      help={missingChoice ? REQUEST_SENTENCES.missingChoice : field.help}
      error={error}
    >
      {input}
    </Labelled>
  );
}

/** The route line, one per task, before Send (6.1's signature). */
function RouteLines({
  preview,
  busy,
  dueOn,
}: {
  preview: Load<RoutePreview> | null;
  busy: boolean;
  dueOn: string;
}) {
  if (!preview) return null;
  if (preview.status === "loading")
    return (
      <div className="rq-route">
        <p className="rq-kicker">Where it goes</p>
        <Waiting text={REQUEST_SENTENCES.previewWaiting} />
      </div>
    );
  if (preview.status === "error")
    return (
      <div className="rq-route">
        <p className="rq-kicker">Where it goes</p>
        <p className="rq-note">{preview.error}</p>
      </div>
    );
  const { parts, note } = preview.data;
  return (
    <div
      className="rq-route"
      aria-live="polite"
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
    >
      <p className="rq-kicker">Where it goes</p>
      {parts.length ? (
        <ul className="rq-route-list">
          {parts.map(p => (
            <RouteItem key={p.part} part={p} dueOn={dueOn || null} />
          ))}
        </ul>
      ) : (
        <p className="rq-note">{note ?? REQUEST_SENTENCES.previewFailed}</p>
      )}
    </div>
  );
}

function RouteItem({ part, dueOn }: { part: RoutePart; dueOn: string | null }) {
  const note = ownerNote(part.owner);
  const owner =
    part.owner.how === "none" || !part.owner.label
      ? "Owner: nobody yet."
      : `Owner: ${part.owner.label}.`;
  return (
    <li className="rq-route-line">
      <CornerDownRight aria-hidden className="rq-route-mark" />
      <div className="rq-route-text">
        <p>
          Goes to <strong>{part.listName}</strong> as "
          <bdi dir="auto">{part.taskName}</bdi>". {owner}
          {part.templateName ? (
            <>
              {" "}
              Uses the ClickUp template{" "}
              <bdi dir="auto">{part.templateName}</bdi>.
            </>
          ) : part.stepCount ? (
            ` Adds ${part.stepCount} ${part.stepsDraft ? "draft " : ""}SOP step${part.stepCount === 1 ? "" : "s"}.`
          ) : null}
          {dueOn ? ` Due ${dayLabel(dueOn)}.` : null}
        </p>
        {note ? <p className="rq-muted">{note}</p> : null}
      </div>
    </li>
  );
}

/** In place of Send while the writer is not open to this seat (2.8, R6). */
function WriterOff({ note }: { note: string | null }) {
  const words =
    note ??
    "Requests are not switched on yet. Use the ClickUp request form until then.";
  return (
    <div className="rq-off" role="status">
      <p>{words}</p>
      {/ClickUp request form/.test(words) ? (
        <a
          className="rq-link"
          href={CLICKUP_FORM_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open the ClickUp request form
          <ArrowUpRight aria-hidden className="rq-link-icon" />
        </a>
      ) : null}
    </div>
  );
}
