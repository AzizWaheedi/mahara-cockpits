import { ArrowUpRight, Check, Plus, RefreshCw, X } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Dot, Kicker } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { displayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  callOf,
  choicesOf,
  fieldOf,
  labelOf,
  sameValue,
  type TodoItem,
  todosOf,
} from "./checkinForm";
import { kuwaitWhen } from "./checkinRail";
import { kuwaitTime } from "./formTime";
import type { CheckinModel } from "./useCheckin";

/**
 * The answers of the 1-1 notes (docs/forms/STAGE2-CONTRACT.md 8.5, Answers
 * and drafts): DEFCON and Priority as radio groups with their suggestion
 * beside them, never inside them (nothing is ever chosen for the person);
 * We owe and They owe as two lists; Client notes; and Next check-in, which
 * is read only in a shadow run and a rehearsal and books nothing there.
 */

const INK = "text-primary-ink";

/**
 * Focus in the window, 3:1 against the page in both themes (WCAG 1.4.11):
 * the ink teal (#00807B on white, Mahara Teal on Deep Space). button.tsx's
 * own ring is 1px of Mahara Teal, about 1.8:1 on the light page, so every
 * Button here takes FOCUS instead: 2px, set 2px off the button. Fields and
 * the window's own small controls take FIELD_FOCUS: 2px on their edge.
 */
export const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-primary-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export const FIELD_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-ink";

/**
 * Teal words on a tinted panel (bg-muted/40: the This call card, the boxes of
 * Fathom's items). The ink teal is 4.47:1 there in light, under 4.5:1 for
 * 12px text, so it leans 10% toward the text colour: 5.2:1 in light, and a
 * touch lighter on Deep Space (9.3:1). The same token, never a new colour.
 */
export const PANEL_INK =
  "text-[color:color-mix(in_oklab,var(--primary-ink)_90%,var(--foreground))]";

/**
 * The small Add buttons on those boxes: the words keep their 16px line, but
 * the button is a 24px box (4px past the words on every side, taken back by
 * negative margins), so a mouse has a 24px target and two of them never
 * overlap at the boxes' 24px pitch (WCAG 2.5.8).
 */
const PANEL_ADD =
  "-mx-1 -my-1 inline-flex h-6 shrink-0 items-center rounded-sm px-1 text-xs font-medium underline-offset-4 hover:underline";

/**
 * A field hint as it is true here. In a shadow run or a rehearsal nothing
 * reaches the card, so a sentence or clause of the registry's hint that
 * says what the card does ("the card's Client Happiness follows") is left
 * out; the rest is the registry's text as written.
 */
export function hintFor(
  hint: string | null | undefined,
  cardChanges: boolean,
): string {
  const text = hint?.trim() ?? "";
  if (!text || cardChanges) return text;
  const card = /\bthe card\b|\bcard's\b/i;
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s =>
      s
        .split(/;\s*/)
        .filter(c => !card.test(c))
        .join("; ")
        .trim(),
    )
    .filter(Boolean)
    .map(s => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(" ");
}

/** Arabic notes in IBM Plex Sans Arabic; Geist has no Arabic. */
export const NOTES_FONT = {
  fontFamily: '"Geist", "IBM Plex Sans Arabic", ui-sans-serif, sans-serif',
};

/** Seconds into the call as Fathom's clock: "12:41", "1:02:03". */
export function clockOf(at: unknown): string | null {
  if (typeof at === "string") {
    const t = at.trim().replace(/^00:(?=\d{2}:\d{2}$)/, "");
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t) ? t : null;
  }
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return null;
  const s = Math.round(at);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

const locked = (m: CheckinModel) =>
  m.rehearse ||
  m.send.kind === "sending" ||
  !m.response ||
  m.response.state !== "draft";

/** A line that needs a person: the warning dot carries the colour. */
function ErrorLine({ text, id }: { text?: string | null; id?: string }) {
  if (!text) return null;
  return (
    <p className="flex gap-2 text-xs" role="alert">
      <span className="flex h-4 shrink-0 items-center">
        <Dot tone="bad" />
      </span>
      <span id={id} className="min-w-0">
        {text}
      </span>
    </p>
  );
}

/** A field's value in words, to show the CSM what "mine" holds. */
export function valueText(k: string, v: unknown): string {
  if (typeof v === "string")
    return k === "defcon" || k === "priority" ? displayLabel(v) : v.trim();
  if (Array.isArray(v))
    return v
      .map(t => (typeof t?.text === "string" ? t.text.trim() : ""))
      .filter(Boolean)
      .join(" · ");
  return "";
}

/**
 * "Changed in another window": Use mine or Keep theirs. The field shows
 * theirs, so hers is shown under the line, to read before choosing. Either
 * button takes the line, and its buttons, away: `onSettled` gives focus to
 * the field the line was about, so it never falls to the page. Typing in
 * the field settles it too (the field is hers then).
 */
function ConflictLine({
  m,
  k,
  onSettled,
}: {
  m: CheckinModel;
  k: string;
  onSettled: () => void;
}) {
  const c = m.conflicts[k];
  if (!c) return null;
  const yours = valueText(k, c.mine);
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-2" role="alert">
          <Dot tone="warn" />
          Changed in another window
          {c.at ? ` at ${kuwaitTime(c.at)}` : ""}.
        </span>
        <Button
          size="sm"
          variant="outline"
          className={FOCUS}
          onClick={() => {
            m.keepMine(k);
            onSettled();
          }}
        >
          Use mine
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={FOCUS}
          onClick={() => {
            m.keepTheirs(k);
            onSettled();
          }}
        >
          Keep theirs
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-2 text-sm leading-6">
        <span className="text-xs text-muted-foreground">
          {yours ? "Yours: " : "Yours was empty."}
        </span>
        {yours ? (
          <bdi dir="auto" style={NOTES_FONT}>
            {yours}
          </bdi>
        ) : null}
      </p>
    </div>
  );
}

// ------------------------------------------------------------ DEFCON and Priority

/** The call's moment in Fathom, named for a screen reader beyond its clock. */
const momentLabel = (when: string) => `Open the call at ${when} in Fathom`;

/** A suggestion strip shows: a recording is picked, and this is not a rehearsal. */
const suggests = (m: CheckinModel) =>
  !m.rehearse && callOf(m.answers.call)?.kind === "fathom";

/** A part of a description, ended as a sentence so the parts never run on. */
const sentence = (text: string) => {
  const t = text.trim();
  return !t || /[.!?…"]$/.test(t) ? t : `${t}.`;
};

function Suggestion({
  m,
  k,
  id,
  onTaken,
}: {
  m: CheckinModel;
  k: "defcon" | "priority";
  /** The strip's text, which describes the choice group. */
  id: string;
  /** "Use it" goes once used: focus moves to the choice it checked. */
  onTaken: (value: string) => void;
}) {
  if (!suggests(m)) return null;
  const d = m.drafts.defcon_priority;
  let text: ReactNode;
  // What the choice group is read with: the strip's words as plain text.
  // The strip itself holds a link named "Open the call at 12:41 in
  // Fathom", which a description would read in place of its "12:41".
  let plain = "";
  let use = false;
  let suggested: string | null = null;
  if (!d || d.state === "drafting") text = "Reading the call…";
  else if (d.state === "off")
    text = "AI drafts are off: no Anthropic key. Pick it yourself.";
  else if (d.state === "failed")
    text = "The suggestion failed. Pick it yourself.";
  else if (d.state === "skipped")
    // The server's own sentence: a wait for the summary or for the
    // transcript says which, so the card's "Summary" never contradicts it.
    text = d.reason?.trim() || "No clear quote. Pick it yourself.";
  else {
    const s = d.output?.[k] as
      | {
          value?: unknown;
          quote?: unknown;
          at?: unknown;
          href?: unknown;
          why?: unknown;
        }
      | null
      | undefined;
    const value = typeof s?.value === "string" ? s.value : null;
    if (!value) text = "No clear quote. Pick it yourself.";
    else {
      const quote = typeof s?.quote === "string" ? s.quote.trim() : "";
      const when = clockOf(s?.at);
      const href =
        typeof s?.href === "string" && /^https:\/\//.test(s.href)
          ? s.href
          : null;
      const why =
        k === "priority" && typeof s?.why === "string" && s.why.trim()
          ? ` (${s.why.trim().replace(/\.$/, "")})`
          : "";
      use = m.answers[k] !== value;
      suggested = value;
      plain = [
        `Suggested: ${displayLabel(value)}${why}.`,
        quote ? `"${quote}"` : "",
        when ? `at ${when}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      text = (
        <>
          Suggested: {displayLabel(value)}
          {why}.
          {quote ? (
            <>
              {" "}
              <bdi dir="auto" style={NOTES_FONT}>
                "{quote}"
              </bdi>
            </>
          ) : null}
          {when ? (
            <>
              {" at "}
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={momentLabel(when)}
                  className={cn(
                    INK,
                    FIELD_FOCUS,
                    "inline-flex items-center gap-0.5 rounded-sm font-mono underline-offset-4 hover:underline",
                  )}
                >
                  {when}
                  <ArrowUpRight aria-hidden className="size-3" />
                </a>
              ) : (
                <span className="font-mono">{when}</span>
              )}
            </>
          ) : null}
        </>
      );
    }
  }
  if (!plain && typeof text === "string") plain = text;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0">{text}</span>
      {/* Read only through the group's aria-describedby: hidden, so a
          screen reader browsing the page reads the strip once. */}
      <span id={id} hidden>
        {sentence(plain)}
      </span>
      {use ? (
        <button
          type="button"
          disabled={locked(m)}
          // Two strips each have "Use it": the name says which value, where.
          aria-label={`Use it: ${displayLabel(suggested)} for ${labelOf(k, m.schema)}`}
          onClick={() => {
            m.takeSuggestion(k);
            if (suggested) onTaken(suggested);
          }}
          className={cn(
            INK,
            FIELD_FOCUS,
            "shrink-0 rounded-sm font-medium underline-offset-4 hover:underline disabled:opacity-50",
          )}
        >
          Use it
        </button>
      ) : null}
    </div>
  );
}

export function ChoiceField({
  m,
  k,
  aside,
}: {
  m: CheckinModel;
  k: "defcon" | "priority";
  /** The line beside the label (DEFCON: what the card says now). */
  aside?: string;
}) {
  const id = useId();
  const choices = choicesOf(k, m.schema);
  const value = typeof m.answers[k] === "string" ? m.answers[k] : null;
  const off = locked(m);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, choices.indexOf(value as string));
  // In a shadow run or a rehearsal nothing reaches the card, so the hint
  // never says the card follows.
  const hint = hintFor(fieldOf(k, m.schema)?.hint, !(m.shadow || m.rehearse));
  // What the group's choice is read with: the card's value, the suggestion
  // and the hint, each where it is shown.
  const describedBy =
    [
      aside ? `${id}-aside` : null,
      suggests(m) ? `${id}-suggest` : null,
      hint ? `${id}-hint` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const move = (i: number) => {
    const n = (i + choices.length) % choices.length;
    refs.current[n]?.focus();
    m.choose(k, choices[n]);
  };
  // A conflict settled (Use mine, Keep theirs): focus goes to the choice
  // the field now holds, once it is drawn.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!settled) return;
    setSettled(false);
    refs.current[at]?.focus();
  }, [settled, at]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Kicker as="h2">
          <span id={`${id}-label`}>{labelOf(k, m.schema)}</span>
        </Kicker>
        {aside ? (
          <span className="text-xs font-medium text-muted-foreground">
            {aside}
            {/* The same words, ended as a sentence, for the group's
                description: "On the card: Happy." */}
            <span id={`${id}-aside`} hidden>
              {sentence(aside)}
            </span>
          </span>
        ) : null}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-required="true"
        className="flex flex-wrap gap-1.5"
      >
        {choices.map((c, i) => {
          const on = value === c;
          return (
            <button
              key={c}
              ref={el => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={i === at ? 0 : -1}
              disabled={off}
              onClick={() => m.choose(k, c)}
              onKeyDown={e => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i - 1);
                }
              }}
              // The choice is marked three ways, never by colour alone: a
              // check, heavier words, and a 2px ink ring inside the pill
              // (4.6:1 on the light page, teal on Deep Space). Focus is a
              // second ring outside it, so the two never look alike.
              className={cn(
                FOCUS,
                "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs transition-colors focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:scale-100",
                on
                  ? "bg-primary/15 pl-2 font-semibold text-foreground inset-ring-2 inset-ring-primary-ink"
                  : "font-medium text-muted-foreground inset-ring inset-ring-border hover:bg-muted hover:text-foreground",
              )}
            >
              {on ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
              {displayLabel(c)}
            </button>
          );
        })}
      </div>
      <Suggestion
        m={m}
        k={k}
        id={`${id}-suggest`}
        onTaken={v =>
          (refs.current[choices.indexOf(v)] ?? refs.current[at])?.focus()
        }
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <ErrorLine text={m.fieldErrors[k]} />
      <ConflictLine m={m} k={k} onSettled={() => setSettled(true)} />
    </div>
  );
}

// ------------------------------------------------------------ We owe and They owe

/** The lines as typed (a trailing space stays while the CSM types). */
const linesOf = (v: unknown): TodoItem[] =>
  Array.isArray(v)
    ? (v as TodoItem[]).filter(t => t && typeof t.text === "string")
    : [];

function Line({
  item,
  k,
  other,
  off,
  onText,
  onMove,
  onRemove,
}: {
  item: TodoItem;
  k: string;
  other: string;
  off: boolean;
  onText: (text: string) => void;
  onMove: () => void;
  /** `button`: the remove button, so focus moves on to the next line. */
  onRemove: (how: "button" | "emptied") => void;
}) {
  const id = useId();
  const when = clockOf(item.at);
  return (
    <li className="flex items-start gap-2 py-2">
      {/* The line's words, read with its buttons (they are named per list). */}
      <span id={`${id}-text`} hidden>
        {item.text}
      </span>
      <span className="flex h-8 shrink-0 items-center">
        <Dot tone={item.unsure ? "warn" : "neutral"} />
      </span>
      <div className="min-w-0 flex-1">
        <textarea
          aria-label={`A line of ${k}`}
          value={item.text}
          rows={Math.min(4, Math.max(1, Math.ceil(item.text.length / 60)))}
          disabled={off}
          onChange={e => onText(e.target.value)}
          onBlur={e => {
            if (!e.target.value.trim()) onRemove("emptied");
          }}
          dir="auto"
          style={NOTES_FONT}
          className={cn(
            FIELD_FOCUS,
            "block w-full resize-none rounded-md bg-transparent px-1 py-1 text-sm leading-6 [field-sizing:content] focus-visible:bg-background disabled:opacity-70",
          )}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          {item.unsure ? <span>Who owes this?</span> : null}
          {item.owner ? <span>{item.owner}</span> : null}
          {when ? (
            item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                aria-label={momentLabel(when)}
                className={cn(
                  FIELD_FOCUS,
                  "inline-flex items-center gap-0.5 rounded-sm font-mono hover:text-foreground",
                )}
              >
                {when}
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            ) : (
              <span className="font-mono">{when}</span>
            )
          ) : null}
          <button
            type="button"
            data-move=""
            disabled={off}
            onClick={onMove}
            aria-describedby={`${id}-text`}
            className={cn(
              FIELD_FOCUS,
              "rounded-sm underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50",
            )}
          >
            Move to {other}
          </button>
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        data-remove=""
        className={cn(FOCUS, "mt-0.5 size-8 shrink-0")}
        aria-label={`Remove this line from ${k}`}
        aria-describedby={`${id}-text`}
        disabled={off}
        onClick={() => onRemove("button")}
      >
        <X aria-hidden />
      </Button>
    </li>
  );
}

function AddLine({
  label,
  off,
  onAdd,
  inputRef,
}: {
  label: string;
  off: boolean;
  onAdd: (text: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const box = inputRef ?? own;
  const [text, setText] = useState("");
  // Added with the button or with Enter, focus stays in the box for the
  // next line: the button never takes itself away from under focus.
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
    box.current?.focus();
  };
  return (
    <form
      className="flex items-center gap-2 pt-1"
      onSubmit={e => {
        e.preventDefault();
        add();
      }}
    >
      <input
        ref={box}
        aria-label={`Add a line to ${label}`}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Add to ${label}`}
        disabled={off}
        dir="auto"
        maxLength={300}
        className={cn(
          FIELD_FOCUS,
          "h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm disabled:opacity-60",
        )}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className={cn(FOCUS, "h-9 aria-disabled:opacity-50")}
        disabled={off}
        // An empty box: said unavailable, still focusable, does nothing.
        aria-disabled={!text.trim() || undefined}
      >
        <Plus aria-hidden />
        Add
      </Button>
    </form>
  );
}

function TodoList({
  m,
  k,
  focusLast = 0,
}: {
  m: CheckinModel;
  k: "we_owe" | "they_owe";
  /** Counts lines added from outside (Fathom's next steps): each one takes focus. */
  focusLast?: number;
}) {
  const id = useId();
  const other = k === "we_owe" ? "they_owe" : "we_owe";
  const label = labelOf(k, m.schema);
  const otherLabel = labelOf(other, m.schema);
  const items = linesOf(m.answers[k]);
  const theirs = linesOf(m.answers[other]);
  const off = locked(m);
  const set = (list: TodoItem[]) => m.setTodos(k, list);
  // Each line keeps its own key while lines above it go, so focus never
  // lands on a line that only moved up (a second Enter would remove it).
  const keys = useRef<number[]>([]);
  const seq = useRef(0);
  while (keys.current.length < items.length) keys.current.push(seq.current++);
  if (keys.current.length > items.length) keys.current.length = items.length;
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // Fathom's items added here from the offer below: the last one takes focus.
  const [took, setTook] = useState(0);
  // After a remove or a move, focus goes to the same button on the next
  // line, else the one before, else the Add box.
  const [refocus, setRefocus] = useState<{
    at: number;
    what: "remove" | "move";
  } | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const list = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        refocus.what === "remove" ? "[data-remove]" : "[data-move]",
      ) ?? [],
    );
    const next = list[Math.min(refocus.at, list.length - 1)];
    (next && !next.disabled ? next : addRef.current)?.focus();
    setRefocus(null);
  }, [refocus]);
  useEffect(() => {
    if (!focusLast && !took) return;
    const lines = listRef.current?.querySelectorAll("textarea");
    lines?.[lines.length - 1]?.focus();
  }, [focusLast, took]);
  const drop = (i: number) => {
    keys.current.splice(i, 1);
    return items.filter((_, j) => j !== i);
  };
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Kicker as="h2">
          <span id={`${id}-label`}>
            {label}
            {items.length ? ` · ${items.length}` : ""}
          </span>
        </Kicker>
        {m.origin[k] ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            Draft · Fathom's action items
          </span>
        ) : null}
      </div>
      {items.length ? (
        <ul ref={listRef} className="divide-y">
          {items.map((item, i) => (
            <Line
              key={keys.current[i]}
              item={item}
              k={label}
              other={otherLabel}
              off={off}
              onText={text =>
                set(items.map((x, j) => (j === i ? { ...x, text } : x)))
              }
              onRemove={how => {
                set(drop(i));
                if (how === "button") setRefocus({ at: i, what: "remove" });
              }}
              onMove={() => {
                set(drop(i));
                m.setTodos(other, [...theirs, { ...item, unsure: false }]);
                setRefocus({ at: i, what: "move" });
              }}
            />
          ))}
        </ul>
      ) : null}
      <AddLine
        label={label}
        off={off}
        inputRef={addRef}
        onAdd={text =>
          set([
            ...items,
            {
              text,
              owner: null,
              at: null,
              href: null,
              from: "csm",
              unsure: false,
            },
          ])
        }
      />
      <DraftedLeft
        m={m}
        k={k}
        label={label}
        onAdd={more => {
          set([...items, ...more]);
          setTook(n => n + 1);
        }}
      />
      <ErrorLine text={m.fieldErrors[k]} />
      <ConflictLine m={m} k={k} onSettled={() => addRef.current?.focus()} />
    </div>
  );
}

/** A line's words as the lists compare them. */
const lineKey = (t: { text?: unknown }) =>
  typeof t?.text === "string" ? t.text.trim().toLowerCase() : "";

/**
 * Fathom's action items for one list that the list does not hold. The
 * draft fills a list only while it is empty and untouched (8.2), so a line
 * typed while Fathom was still sending the call (or kept from a resumed
 * draft) leaves the list without them: they are offered here instead.
 * A list the draft filled offers nothing, so a line she removed stays gone:
 * filled here (its origin), or saved from the draft earlier (its `from`).
 */
export function draftedLeft(
  m: CheckinModel,
  k: "we_owe" | "they_owe",
): TodoItem[] {
  const d = m.drafts.todos;
  const call = callOf(m.answers.call);
  if (
    m.rehearse ||
    m.origin[k] ||
    m.meta[k]?.from?.startsWith("fathom") ||
    d?.state !== "ready" ||
    call?.kind !== "fathom" ||
    m.draftsFor !== call.recordingId
  )
    return [];
  const side = k === "we_owe" ? "we" : "they";
  const raw = Array.isArray(d.output?.items)
    ? (d.output.items as Record<string, unknown>[])
    : [];
  const have = new Set(
    [...linesOf(m.answers.we_owe), ...linesOf(m.answers.they_owe)].map(lineKey),
  );
  return todosOf(
    raw.filter(i => i?.side === side).map(i => ({ ...i, from: "fathom" })),
  ).filter(t => {
    const key = lineKey(t);
    if (!key || have.has(key)) return false;
    have.add(key);
    return true;
  });
}

function DraftedLeft({
  m,
  k,
  label,
  onAdd,
}: {
  m: CheckinModel;
  k: "we_owe" | "they_owe";
  label: string;
  onAdd: (items: TodoItem[]) => void;
}) {
  const left = draftedLeft(m, k);
  if (!left.length || locked(m)) return null;
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {`Also in Fathom's action items · ${left.length}`}
        </p>
        {left.length > 1 ? (
          <button
            type="button"
            className={cn(PANEL_INK, FIELD_FOCUS, PANEL_ADD)}
            aria-label={`Add all ${left.length} to ${label}`}
            onClick={() => onAdd(left)}
          >
            Add all
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {left.map(t => (
          <li key={lineKey(t)} className="flex items-start gap-2 text-sm">
            <span className="min-w-0 flex-1" dir="auto" style={NOTES_FONT}>
              {t.text.trim()}
            </span>
            <button
              type="button"
              className={cn(PANEL_INK, FIELD_FOCUS, PANEL_ADD)}
              aria-label={`Add to ${label}: ${t.text.trim()}`}
              onClick={() => onAdd([t])}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fathom's Next Steps that are in neither list yet. */
function NextSteps({ m, onAdded }: { m: CheckinModel; onAdded: () => void }) {
  const d = m.drafts.todos;
  const steps = Array.isArray(d?.output?.nextSteps)
    ? (d?.output?.nextSteps as {
        text?: unknown;
        at?: unknown;
        href?: unknown;
      }[])
    : [];
  const have = new Set(
    [...linesOf(m.answers.we_owe), ...linesOf(m.answers.they_owe)].map(t =>
      t.text.trim().toLowerCase(),
    ),
  );
  // Each step once: its words are its key.
  const left = steps.filter(s => {
    const t = typeof s?.text === "string" ? s.text.trim().toLowerCase() : "";
    if (!t || have.has(t)) return false;
    have.add(t);
    return true;
  });
  if (!left.length || locked(m)) return null;
  const ours = linesOf(m.answers.we_owe);
  return (
    <div className="space-y-1 rounded-xl bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Also in Fathom's next steps
      </p>
      <ul className="space-y-1">
        {left.map(s => (
          <li
            key={String(s.text).trim()}
            className="flex items-start gap-2 text-sm"
          >
            <span className="min-w-0 flex-1" dir="auto" style={NOTES_FONT}>
              {String(s.text).trim()}
            </span>
            <button
              type="button"
              className={cn(PANEL_INK, FIELD_FOCUS, PANEL_ADD)}
              aria-label={`Add to ${labelOf("we_owe", m.schema)}: ${String(s.text).trim()}`}
              onClick={() => {
                m.setTodos("we_owe", [
                  ...ours,
                  {
                    text: String(s.text).trim(),
                    owner: null,
                    at: typeof s.at === "number" ? s.at : null,
                    href:
                      typeof s.href === "string" && /^https:\/\//.test(s.href)
                        ? s.href
                        : null,
                    from: "fathom",
                    unsure: false,
                  },
                ]);
                // The step leaves this list: focus follows it to We owe.
                onAdded();
              }}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TodosFields({ m }: { m: CheckinModel }) {
  const d = m.drafts.todos;
  const [added, setAdded] = useState(0);
  const none =
    d?.state === "ready" &&
    Array.isArray(d.output?.items) &&
    (d.output.items as unknown[]).length === 0 &&
    !linesOf(m.answers.we_owe).length &&
    !linesOf(m.answers.they_owe).length;
  return (
    <div className="space-y-3">
      {none ? (
        <p className="text-sm text-muted-foreground">
          Fathom found no action items. Add them yourself.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <TodoList m={m} k="we_owe" focusLast={added} />
        <TodoList m={m} k="they_owe" />
      </div>
      <NextSteps m={m} onAdded={() => setAdded(n => n + 1)} />
    </div>
  );
}

// ------------------------------------------------------------ Client notes

export const NEW_DRAFT_READY =
  "A new draft is ready. Your notes stay as they are unless you replace them.";
export const NEW_DRAFT_WRITING =
  "Writing a new draft. Your notes stay as they are until you choose.";
export const NEW_DRAFT_REPLACED = "The new draft replaced your notes.";

export function NotesField({ m }: { m: CheckinModel }) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const offerRef = useRef<HTMLDivElement>(null);
  const value =
    typeof m.answers.client_notes === "string" ? m.answers.client_notes : "";
  const o = m.origin.client_notes;
  const edited = Boolean(
    o && value.trim() && !sameValue(o.value, value.trim()),
  );
  const d = m.drafts.client_notes;
  const call = callOf(m.answers.call);
  const fathom = call?.kind === "fathom" && !m.rehearse;
  const again = fathom ? m.notesAgain : null;
  const writing = again?.kind === "writing" || d?.state === "drafting";
  // A wait says which of Fathom's records it waits for (the summary or the
  // transcript), in the server's words.
  const state =
    !fathom || !d
      ? null
      : again?.kind === "writing" && again.mine
        ? NEW_DRAFT_WRITING
        : d.state === "off"
          ? "AI drafts are off: no DeepSeek key. Fill this by hand."
          : d.state === "drafting"
            ? "Reading the call…"
            : d.state === "failed"
              ? d.reason?.trim() || "The draft failed. Draft again."
              : d.state === "skipped"
                ? d.reason?.trim() || null
                : null;
  const off = locked(m);
  // The registry's hint stays in view under the label (a placeholder goes
  // as soon as the draft fills the field). The label already says
  // "(internal)", so a leading "Internal:" is not said twice.
  const hint = (() => {
    const h = hintFor(
      fieldOf("client_notes", m.schema)?.hint,
      !(m.shadow || m.rehearse),
    ).replace(/^internal:\s*/i, "");
    return h ? h.charAt(0).toUpperCase() + h.slice(1) : "";
  })();
  // A new draft can be asked for once one could be made: not while the
  // key is off, while Fathom writes the summary, or while one waits here.
  const canAsk =
    fathom && d && !off && d.state !== "off" && d.state !== "skipped";
  // Refused for this call (five drafts): it stays where focus is, said
  // unavailable, with the refusal as its description, until the call changes.
  const rested = fathom && m.notesAgainRefused;
  const offer = again?.kind === "ready" ? again : null;
  const replaced = fathom && m.notesReplaced && !offer;
  // The buttons below the field go once used: focus goes back to the field.
  const back = () => area.current?.focus();
  // The new draft takes Draft again's place. When focus went with that
  // button (she pressed it and waited), it moves to the new draft, which is
  // read by its first line as it takes focus; the region says it only when
  // focus is elsewhere (she is typing). Replace says itself the same way.
  const hasOffer = Boolean(offer);
  const hadOffer = useRef(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const before = hadOffer.current;
    hadOffer.current = hasOffer;
    if (hasOffer) {
      if (before) return;
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected)
        offerRef.current?.focus();
      setSaid(
        document.activeElement === offerRef.current ? "" : NEW_DRAFT_READY,
      );
    } else setSaid(replaced ? NEW_DRAFT_REPLACED : "");
  }, [hasOffer, replaced]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Kicker as="h2">
          <label id={`${id}-label`} htmlFor={`${id}-notes`}>
            {labelOf("client_notes", m.schema)}{" "}
            <span className="normal-case tracking-normal">(internal)</span>
          </label>
        </Kicker>
        <span className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
          {o && value.trim() ? (
            <span>{edited ? "Edited" : "Draft · Fathom summary"}</span>
          ) : null}
          {canAsk && !offer ? (
            <button
              type="button"
              // Still focusable while the draft is written, and after a
              // refusal, so focus stays.
              aria-disabled={writing || rested || undefined}
              aria-describedby={
                rested && m.notesAgainError ? `${id}-again-error` : undefined
              }
              onClick={() => {
                if (!writing && !rested) m.draftAgain("client_notes");
              }}
              className={cn(
                INK,
                FIELD_FOCUS,
                "inline-flex items-center gap-1 rounded-sm font-sans text-xs font-medium underline-offset-4 hover:underline aria-disabled:cursor-default aria-disabled:no-underline aria-disabled:opacity-50",
              )}
            >
              <RefreshCw
                aria-hidden
                className={cn(
                  "size-3.5",
                  writing && "motion-safe:animate-spin",
                )}
              />
              Draft again
            </button>
          ) : null}
        </span>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="-mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <textarea
        ref={area}
        id={`${id}-notes`}
        value={value}
        onChange={e => m.setNotes(e.target.value)}
        disabled={off}
        rows={6}
        dir="auto"
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={NOTES_FONT}
        className={cn(
          FIELD_FOCUS,
          "block w-full resize-y rounded-xl border bg-background px-3 py-2.5 text-[15px] leading-[1.7] placeholder:text-muted-foreground disabled:opacity-70",
        )}
      />
      {state ? <p className="text-xs text-muted-foreground">{state}</p> : null}
      {offer ? (
        <div
          ref={offerRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-offer`}
          className="space-y-2 rounded-xl bg-muted/40 p-3 outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary-ink"
        >
          <p
            id={`${id}-offer`}
            className="text-xs font-medium text-muted-foreground"
          >
            {NEW_DRAFT_READY}
          </p>
          {/* The whole draft (1,200 characters at most), to read before choosing. */}
          <p
            dir="auto"
            style={NOTES_FONT}
            className="whitespace-pre-wrap text-[15px] leading-[1.7]"
          >
            {offer.text}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className={FOCUS}
              disabled={off}
              onClick={() => {
                m.takeNewNotes();
                back();
              }}
            >
              Replace my notes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={FOCUS}
              disabled={off}
              onClick={() => {
                m.keepNotes();
                back();
              }}
            >
              Keep my notes
            </Button>
          </div>
        </div>
      ) : replaced ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="flex items-center gap-2">
            <Dot tone="neutral" />
            {NEW_DRAFT_REPLACED}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className={FOCUS}
            disabled={off}
            onClick={() => {
              m.undoNotes();
              back();
            }}
          >
            Undo
          </Button>
        </div>
      ) : null}
      {/* One region from the start, so what happens is said as it happens. */}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {fathom ? (
        <ErrorLine text={m.notesAgainError} id={`${id}-again-error`} />
      ) : null}
      <ErrorLine text={m.fieldErrors.client_notes} />
      <ConflictLine m={m} k="client_notes" onSettled={back} />
    </div>
  );
}

// ------------------------------------------------------------ Next check-in

export interface BookSlot {
  /** HighLevel confirmed the booking (its start). */
  onBooked: (startTime: string) => void;
}

export function NextCheckin({
  m,
  next,
  book,
}: {
  m: CheckinModel;
  /** The next booked check-in on the client's timeline. */
  next: { at: string } | null;
  /** The cockpit's booking button; mounted only for a live response. */
  book?: (p: BookSlot) => ReactNode;
}) {
  const [booked, setBooked] = useState<string | null>(null);
  const at = booked ?? next?.at ?? null;
  // A shadow run and a rehearsal book nothing: booking creates a real
  // GoHighLevel appointment and writes the card.
  const live = !m.rehearse && m.response?.mode === "live";
  return (
    <div className="space-y-2">
      <Kicker as="h2">Next check-in</Kicker>
      {at ? (
        <p className="text-sm">Booked: {kuwaitWhen(at)}.</p>
      ) : live ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">Not booked.</p>
            {book ? book({ onBooked: setBooked }) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            7 to 14 days out for onboarding and early live clients, up to 30 for
            stable ones.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Booking is off in a shadow run. Book the next check-in from the client
          page as usual.
        </p>
      )}
    </div>
  );
}
