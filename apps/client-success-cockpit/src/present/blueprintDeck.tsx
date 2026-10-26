import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import maharaLogo from "@/assets/mahara-logo-dark.png";
import {
  BP,
  BP_MINUTES,
  BP_NOTES,
  BP_STOPS,
  BP_TITLES,
  type BpSlideId,
} from "./blueprintContent";
import {
  bandOf,
  brandColours,
  brandPalette,
  brandType,
  callDates,
  chipInk,
  currencyFor,
  firstClause,
  firstLine,
  foldKey,
  hhmm,
  lines,
  moneyOf,
  moneyText,
  parseAmount,
  privateCount,
  shortAmount,
  tapeMarks,
  wallFilled,
} from "./blueprintData";
import {
  type Answers,
  BP_SERVICES,
  type BpKey,
  type BpService,
  type Currency,
  sameValue,
} from "./blueprintForm";
import { coverPhoto, EXAMPLE_PALETTE, swatchesFor } from "./blueprintLook";
import { digits, type L, type Lang, SERVICES, SHARED, t, tf } from "./content";
import { clock, dayMonth, dayShort } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import { type DeckData, shownGoals } from "./deckData";
import {
  exampleAlt,
  exampleCreative,
  feedUrl,
  SCENES,
  sceneAt,
  storyUrl,
  type Theme,
  warmExamples,
} from "./examples";
import { Logo } from "./platforms";
import { type MainKey, serviceOfText } from "./services";
import type { BpModel } from "./useBlueprint";

/**
 * The Brand Blueprint call (docs/brand-blueprint/SPEC.md 5): 14 slides,
 * 45 minutes, presented by the creative director. The look is the studio
 * wall, tamed (5.4): Mahara's Deep Space as a felt wall; the client's brand
 * arrives on it as flat paper, tape, prints and a kraft tag. Teal is ours
 * (tape, the stamp, a lit choice), amber is the client's to do, and the
 * client's own words are typed live on straight, ruled paper.
 *
 * One drawing runs through the call: the three empty frames on the cover
 * (your words, your look, your offer) fill as the call goes (slides 6, 11
 * and 13), so the read-back is the wall the client watched being built.
 * Every word is in blueprintContent.ts; this file places them.
 */

type Ctx = SlideCtx;
const px = (n: number) => `${n}px`;

/** A thing on the wall: where it is, its tilt (at most 1 degree) and its turn. */
interface Box {
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  i?: number;
}
function at(
  b: Box,
  extra: Record<string, string | number> = {},
): CSSProperties {
  // A size or turn left out is the class's own (auto, none: present.css),
  // never its parent's by inheritance.
  return {
    "--x": px(b.x),
    "--y": px(b.y),
    ...(b.w != null ? { "--w": px(b.w) } : {}),
    ...(b.h != null ? { "--h": px(b.h) } : {}),
    ...(b.r ? { "--r": `${b.r}deg` } : {}),
    ...(b.i != null ? { "--i": b.i } : {}),
    ...extra,
  } as CSSProperties;
}

/** A canvas control lets go of the keyboard after a click, so Space moves the deck. */
const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const tz = (d: DeckData) => d.timeZone;

/** The call's dates, from the record and the booking. */
function datesOf(ctx: Ctx) {
  const { d, bp } = ctx;
  return callDates(bp?.answers ?? {}, d, bp?.now() ?? new Date());
}

// ------------------------------------------------------------ the wall

/**
 * The wall's map: the read-back's three frames drawn small in the foot,
 * beside the slide count, on every slide between the cover and the
 * read-back (the cover is the empty wall, the read-back the full one). A
 * frame fills as its part of the call is said: your words (slide 6), your
 * look (slide 11), your offer (slide 13). Slide 6's typed method flies
 * into it, and the read-back's frames grow out of it.
 */
const MAP = { x: 1540, y: 1022, s: 0.06 } as const;
/** The read-back's frames, from its top-start corner (x 120, y 236). */
const WALL_FRAMES = {
  offer: { x: 0, y: 0, w: 960, h: 580 },
  words: { x: 1020, y: 0, w: 660, h: 260 },
  look: { x: 1020, y: 320, w: 660, h: 260 },
} as const;
const WALL_ORIGIN = { x: 120, y: 236 } as const;

/** Where a read-back frame starts its growth: the map's copy of it. */
function fromMap(kind: FrameKind): CSSProperties {
  const f = WALL_FRAMES[kind];
  return {
    "--fx": px(MAP.x + f.x * MAP.s - (WALL_ORIGIN.x + f.x)),
    "--fy": px(MAP.y + f.y * MAP.s - (WALL_ORIGIN.y + f.y)),
    "--fs": MAP.s,
  } as CSSProperties;
}

function WallMap({ ctx, named = false }: { ctx: Ctx; named?: boolean }) {
  const a: Answers = ctx.bp?.answers ?? {};
  const filled = wallFilled(a);
  return (
    <>
      {/* Named once, where it first appears (slide 2), so it never reads
          as an unexplained layout icon (score round 2). */}
      {named ? (
        <span
          className="dkb-map-name"
          style={at({ x: MAP.x - 24, y: MAP.y + (580 * MAP.s) / 2 })}
        >
          {t(BP.mapName, ctx.lang)}
        </span>
      ) : null}
      <svg
        className="dkb-map"
        viewBox="0 0 1680 580"
        aria-hidden
        style={at({ x: MAP.x, y: MAP.y, w: 1680 * MAP.s, h: 580 * MAP.s })}
      >
        {(["offer", "words", "look"] as const).map(k => {
          const f = WALL_FRAMES[k];
          return (
            <rect
              key={k}
              data-kind={k}
              data-filled={filled[k] ? "" : undefined}
              x={f.x + 14}
              y={f.y + 14}
              width={f.w - 28}
              height={f.h - 28}
              rx={10}
            />
          );
        })}
      </svg>
    </>
  );
}

function Wall({
  ctx,
  children,
  slide,
}: {
  ctx: Ctx;
  children: ReactNode;
  slide: BpSlideId;
}) {
  return (
    <div className="dkb-wall" data-bp={slide} data-lang={ctx.lang}>
      {children}
      {slide === "cover" || slide === "read-back" ? null : (
        <WallMap ctx={ctx} named={slide === "so-far"} />
      )}
      <img
        className="dkb-logo"
        src={maharaLogo}
        alt="Mahara Media"
        draggable={false}
      />
    </div>
  );
}

function Head({
  ctx,
  id,
  sub,
  width = 1100,
  title,
}: {
  ctx: Ctx;
  id: BpSlideId;
  sub?: ReactNode;
  width?: number;
  /** The slide's title when its answers change what it is about. */
  title?: L;
}) {
  return (
    <header className="dkb-head" style={{ "--w": px(width) } as CSSProperties}>
      <h2 className="dkb-title">{t(title ?? BP_TITLES[id], ctx.lang)}</h2>
      {sub ? <p className="dkb-sub">{sub}</p> : null}
    </header>
  );
}

/**
 * Masking tape, torn at both ends: ours, so it is teal. It holds paper to
 * the felt, so it sits across a paper's edge, never on bare felt. `from`:
 * the paper's corner its x and y count from (top-start by default; the
 * others for paper whose size is its words').
 */
function Tape({
  x,
  y,
  w = 110,
  r = 0,
  i = 0,
  vertical = false,
  from,
}: {
  x: number;
  y: number;
  w?: number;
  r?: number;
  i?: number;
  vertical?: boolean;
  from?: "top-end" | "bottom-start" | "bottom-end";
}) {
  return (
    <span
      aria-hidden
      className="dkb-tape"
      data-v={vertical ? "" : undefined}
      data-from={from}
      style={at(
        vertical ? { x, y, w: 26, h: w, i } : { x, y, w, h: 26, i },
        r ? { "--tr": `${r}deg` } : {},
      )}
    />
  );
}

/** A label-maker strip: the wall's own name for a thing. */
function Dymo({ children, box }: { children: ReactNode; box: Box }) {
  return (
    <span className="dkb-dymo dkb-pin" style={at(box)}>
      {children}
    </span>
  );
}

/** Paper pinned to the wall. `live`: typed on, so straight and flat. */
function Card({
  box,
  live,
  className,
  children,
  label,
  tag = "div",
  flow = false,
  look,
  attrs,
}: {
  box: Box;
  live?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
  tag?: "div" | "section" | "figure";
  /** In a stack: placed by the stack, its height by its words. */
  flow?: boolean;
  /** The stop's focus: lifted, or stepped back. */
  look?: Look;
  attrs?: Record<string, string | undefined>;
}) {
  const Tag = tag;
  return (
    <Tag
      className={`dkb-card dkb-pin${flow ? " dkb-flow" : ""}${className ? ` ${className}` : ""}`}
      data-live={live ? "" : undefined}
      style={at(live ? { ...box, r: 0 } : box)}
      aria-label={label}
      {...lookOf(look)}
      {...attrs}
    >
      {children}
    </Tag>
  );
}

function Sticky({
  box,
  children,
  flow = false,
  big = false,
  look,
  tag = "p",
}: {
  box: Box;
  children: ReactNode;
  /** In a column: placed by it, its height its words'. */
  flow?: boolean;
  /** Set large, across the room an unfilled part would leave. */
  big?: boolean;
  look?: Look;
  tag?: "p" | "div";
}) {
  const Tag = tag;
  return (
    <Tag
      className={`dkb-sticky dkb-pin${flow ? " dkb-flow" : ""}${big ? " dkb-sticky-big" : ""}`}
      style={at(box)}
      {...lookOf(look)}
    >
      {children}
    </Tag>
  );
}

/**
 * Where an answer came from, in mono beside it ("From your kickoff form"):
 * one style everywhere, a teal dot and teal ink (amber while it is being
 * typed and not saved yet). `from` names a fixed source (the goal's).
 */
function Mark({
  bp,
  k,
  lang,
  from,
}: {
  bp: BpModel | null | undefined;
  k?: BpKey;
  lang: Lang;
  from?: keyof typeof BP.source;
}) {
  const m = from ?? (k ? bp?.mark(k) : null);
  if (!m) return null;
  const l = BP.source[m];
  return (
    <span className="dkb-mark" data-now={m === "now" ? "" : undefined}>
      {t(l, lang)}
    </span>
  );
}

/** The client's line as drawn: a hyphen never breaks it ("limited-offer" stays whole). */
const whole = (s: string) => s.replace(/-/g, "‑");

/** Part 1 went to media (the record's part 1, or this call's press): the call is under way. */
const underway = (bp: BpModel | null | undefined) =>
  Boolean(bp?.stamp || bp?.parts["1"]?.status === "done");

/**
 * The call is closed (part 2 done, or the offer locked after it): the wall
 * shows what was said, never a slot for more (score round 1 of the design
 * pass: "Add a line" and empty "known for" lines after the call).
 */
const afterCall = (bp: BpModel | null | undefined) =>
  Boolean(
    bp?.parts["2"]?.status === "done" || bp?.parts["3"]?.status === "done",
  );

/**
 * A stop's focus (score round 1 of the design pass: a label turning from
 * grey to dark was a change nobody on the call saw): the card the stop asks
 * about lifts off the wall, the others step back to 0.55. Transform and
 * opacity only, on attributes a pin's arrival never holds.
 */
type Look = "active" | "dim" | undefined;
const lookOf = (look: Look) =>
  look === "active"
    ? { "data-active": "" }
    : look === "dim"
      ? { "data-dim": "" }
      : {};

/**
 * A loop drawn in pen round a chosen word (the CD's pen: teal ink, like the
 * stamp), never a box or a filled ring. Sized to its word, measured, so the
 * stroke keeps its weight on "Yes" and on "Approved before the call"; a
 * little uneven, and it runs past its start, as a hand does.
 */
function loopPath(w: number, h: number, seed: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 3;
  const ry = h / 2 - 3;
  const n = 18;
  const start = -0.42;
  const sweep = Math.PI * 2 + 0.62;
  const pts: [number, number][] = [];
  // The hand's unevenness in pixels, not in proportion, so a long word's
  // loop never closes in across its last letter.
  for (let i = 0; i <= n; i++) {
    const a = start - (sweep * i) / n;
    const dx = 3 * Math.sin(i * 1.9 + seed) - (i / n) * 5;
    const dy = 2 * Math.sin(i * 1.3 + seed) - (i / n) * 3;
    pts.push([cx + Math.cos(a) * (rx + dx), cy + Math.sin(a) * (ry + dy)]);
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const end = pts[pts.length - 1];
  return `${d} L${f(end[0])} ${f(end[1])}`;
}

function PenRing({
  fresh = false,
  seed = 0,
}: {
  fresh?: boolean;
  seed?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<[number, number]>([160, 64]);
  // Its word's size, measured after every render (no deps: a new word or
  // a font arriving changes it).
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const w = Math.round(host.offsetWidth + 40);
    const h = Math.round(host.offsetHeight + 24);
    setBox(b => (b[0] === w && b[1] === h ? b : [w, h]));
  });
  const [w, h] = box;
  return (
    <svg
      ref={ref}
      className="dkb-ring"
      data-fresh={fresh ? "" : undefined}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      <path d={loopPath(w, h, seed)} pathLength={1} />
    </svg>
  );
}

/** A tick in the same pen: a part sent, a line on the offer tag the record holds. */
function PenTick({ fresh = false }: { fresh?: boolean }) {
  return (
    <svg
      className="dkb-pen-tick"
      data-fresh={fresh ? "" : undefined}
      viewBox="0 0 36 36"
      aria-hidden
    >
      <path
        d="M6 19.5c3.2 2.4 5.6 5.4 7.6 9.1C17.8 18.6 23.4 10.8 31 5.5"
        pathLength={1}
      />
    </svg>
  );
}

/**
 * What is not answered yet, said the one way the wall says it (score round
 * 2 of the design pass: bare underlines, grey options and placeholder
 * sentences read as a web form): a pencil note in the presenter's hand on
 * blank paper, led by a pencilled caret, the editor's mark for "this goes
 * here" (a tick would read as done). Never a placeholder in grey, never a
 * rule waiting for words. `eg`: what it says is ours, so tagged Example.
 */
function Prompt({
  children,
  lang,
  eg = false,
}: {
  children: ReactNode;
  lang: Lang;
  eg?: boolean;
}) {
  return (
    <span className="dkb-prompt">
      <svg className="dkb-prompt-tick" viewBox="0 0 30 30" aria-hidden>
        <path d="M4.6 24.4c2.9-5.2 5.6-10.3 8.9-16.6 1.1-.4 1.5.1 2.1 1.3 2.5 5.1 5.3 10.2 8.2 15.4" />
        <path d="M11.2 12.6c.9-1.8 1.7-3.3 2.6-4.9" />
      </svg>
      <span className="dkb-prompt-words">{children}</span>
      {eg ? (
        <span className="dkb-example">{t(BP.tag.example, lang)}</span>
      ) : null}
    </span>
  );
}

/**
 * A question answered on paper (score round 1 of the design pass: Yes / No
 * and a three-way control read as a web form): each answer a word in
 * pencil, the one they gave in ink with a pen loop round it. A tap on a
 * word picks it (again, takes it back where `toggle`); a CSM seat reads.
 * `chips`: each answer a small paper chip in ink (score round 2 of the
 * design pass: grey words in a row read as a form's options), theirs
 * circled in pen.
 */
function PenChoice<V extends string>({
  ctx,
  value,
  options,
  onPick,
  label,
  toggle = true,
  waiting = false,
  chips = false,
  className,
}: {
  ctx: Ctx;
  value: V | undefined;
  options: readonly { v: V; label: ReactNode }[];
  onPick: (v: V | null) => void;
  label: string;
  toggle?: boolean;
  /** Ahead of its stop: on the wall, not tappable yet. */
  waiting?: boolean;
  chips?: boolean;
  className?: string;
}) {
  const editable = Boolean(ctx.bp && !ctx.bp.readOnly) && !waiting;
  // A loop drawn because of a tap on this call draws at once; one already
  // on the record draws with its paper's arrival.
  const first = useRef(value);
  const fresh = value !== first.current;
  return (
    <span
      className={`dkb-pen${className ? ` ${className}` : ""}`}
      data-chips={chips ? "" : undefined}
      data-open={value ? undefined : ""}
      role="group"
      aria-label={label}
    >
      {options.map((o, n) => {
        const on = value === o.v;
        const inner = (
          <>
            <span className="dkb-pen-word">{o.label}</span>
            {on ? <PenRing fresh={fresh} seed={n} /> : null}
          </>
        );
        return editable || ctx.bp ? (
          <button
            key={o.v}
            type="button"
            className="dkb-pen-opt"
            data-picked={on ? "" : undefined}
            aria-pressed={on}
            disabled={!editable}
            onClick={e => {
              onPick(on && toggle ? null : o.v);
              letGo(e);
            }}
          >
            {inner}
          </button>
        ) : (
          <span
            key={o.v}
            className="dkb-pen-opt"
            data-picked={on ? "" : undefined}
          >
            {inner}
          </span>
        );
      })}
    </span>
  );
}

// ------------------------------------------------------------ live fields

/**
 * The client's words, typed live on ruled paper (SPEC 5.3): 48 px on 64 px
 * rules, a teal caret, the text's own direction. Enter commits a one-line
 * field; Esc lets go. A CSM seat reads it, never types.
 */
/** The read-back's headline sizes, largest first: two rows each, three at the last. */
const FEATURE_FIT = ["88", "72", "60", "52"] as const;

function Ruled({
  ctx,
  k,
  size = "live",
  one = false,
  minRows = 2,
  maxRows = 6,
  cap,
  label,
  value: valueIn,
  onChange,
  onLeave,
  placeholder,
  draft,
  prompt,
}: {
  ctx: Ctx;
  k?: BpKey;
  size?: "live" | "small" | "feature" | "line" | "side" | "clip";
  one?: boolean;
  minRows?: number;
  /** Past this many rows the words step down a size. */
  maxRows?: number;
  /** At most this many rows show (the stack keeps inside the canvas). */
  cap?: number;
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  /** The field let go of (Esc, Enter on a one-line field, a click away). */
  onLeave?: (v: string) => void;
  /** Shown while empty: the field's own name, never the client's words. */
  placeholder?: string;
  /**
   * Their own earlier words for this field (a form answer not yet taken
   * into the record): shown on the paper in a lighter ink, so they correct
   * it rather than recite it; the first edit keeps it as typed.
   */
  draft?: string | null;
  /**
   * Nothing typed yet: the pencil note on the blank paper (`Prompt`), in
   * place of rules waiting for words (score round 2 of the design pass).
   * It steps aside while the field has the presenter's caret.
   */
  prompt?: ReactNode;
}) {
  const bp = ctx.bp;
  const saved =
    valueIn ??
    (k && typeof bp?.answers[k] === "string" ? (bp.answers[k] as string) : "");
  const drafted = !saved.trim() && draft?.trim() ? draft.trim() : null;
  const value = drafted ?? saved;
  const ref = useRef<HTMLElement>(null);
  const [rows, setRows] = useState(minRows);
  const [long, setLong] = useState<"" | "more" | null>(null);
  const [fit, setFit] = useState<(typeof FEATURE_FIT)[number] | null>(null);
  // Grows with the words; past maxRows the text steps down a size and is
  // measured again there, so no spare rule is left under it. The read-back's
  // headline steps 88, 72, 60, 52 px until it fits two rows (three at 52).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the words, so a new value measures again
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.height = "0px";
      const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 64;
      const n = Math.max(minRows, Math.round(el.scrollHeight / line));
      el.style.height = "";
      return n;
    };
    if (size === "feature") {
      for (const f of FEATURE_FIT) {
        el.setAttribute("data-fit", f);
        const n = measure();
        if (n <= 2 || f === "52") {
          setFit(f);
          setRows(Math.min(n, f === "52" ? 3 : 2));
          return;
        }
      }
      return;
    }
    el.removeAttribute("data-long");
    const n = measure();
    if (n <= maxRows) {
      setLong(null);
      setRows(n);
      return;
    }
    el.setAttribute("data-long", "");
    const m = measure();
    // Still past the field's room: one more step down, so nothing is cut.
    if (cap && m > cap) {
      el.setAttribute("data-long", "more");
      setLong("more");
      setRows(measure());
    } else {
      setLong("");
      setRows(m);
    }
  }, [value, minRows, maxRows, size, cap]);
  const shown = Math.min(rows, cap ?? (size === "feature" ? 3 : 8));
  const editable = Boolean(bp && !bp.readOnly);
  // Nothing typed yet: its rules are pencil guides, light and uneven, so
  // the paper waits for words rather than asking for them (score round 3).
  const empty = !value.trim() ? "" : undefined;
  const change = (v: string) => {
    if (onChange) onChange(v);
    else if (k) bp?.set(k, v);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") e.currentTarget.blur();
    if (one && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };
  const field = !editable ? (
    <p
      ref={ref as never}
      className="dkb-ruled"
      data-size={size}
      data-rows={Math.min(shown, 6)}
      data-long={long ?? undefined}
      data-fit={fit ?? undefined}
      data-empty={empty}
      data-draft={drafted ? "" : undefined}
      data-prompted={prompt != null ? "" : undefined}
      dir="auto"
    >
      <bdi>{value}</bdi>
    </p>
  ) : (
    <textarea
      ref={ref as never}
      className="dkb-ruled"
      data-size={size}
      data-long={long ?? undefined}
      data-fit={fit ?? undefined}
      data-empty={empty}
      data-draft={drafted ? "" : undefined}
      data-prompted={prompt != null ? "" : undefined}
      placeholder={prompt != null ? undefined : placeholder}
      rows={shown}
      // Empty, its placeholder takes the deck's direction; typed, its own.
      dir={value ? "auto" : ctx.lang === "ar" ? "rtl" : "ltr"}
      value={value}
      aria-label={label}
      spellCheck={false}
      onChange={e =>
        change(one ? e.target.value.replace(/\n/g, " ") : e.target.value)
      }
      onKeyDown={onKey}
      onBlur={e => onLeave?.(e.currentTarget.value)}
    />
  );
  if (prompt == null) return field;
  // The wrapper stays for the field's life (the caret is never lost when
  // the first word is typed); the pencil note sits on the blank paper
  // until then.
  // On a seat that types, the wrapper is the field's label, so a click on
  // the note puts the caret in the field.
  const Wrap = editable ? "label" : "span";
  return (
    <Wrap className="dkb-ruled-wrap" data-size={size}>
      {field}
      {empty !== undefined ? (
        <span className="dkb-ruled-prompt" aria-hidden>
          {prompt}
        </span>
      ) : null}
    </Wrap>
  );
}

/**
 * A list of short lines (red lines, the rules): each line as written, and
 * a slot for the next one, typed live on the paper under them; Enter adds
 * it. The slot is out of sight at rest (score round 1 of the design pass:
 * "Add a line" in grey read as a web input, on the client's screen), its
 * room kept, and shows as a faint pencilled "+" only while the
 * presenter's pointer is over the card or it has focus; after the call it
 * is gone. The presenter can take a line off with its small cross, shown
 * on hover. `fold`: lines agreed earlier, said once as one line (slide
 * 11's never list holds the red lines from the start of the call); they
 * open on hover or focus, so the presenter can still take one off.
 * `chips`: the lines as chips (slide 11's lists, as the Studio mockup had
 * them), else ruled lines.
 */
function LinesField({
  ctx,
  list,
  onChange,
  addLabel,
  kind = "plain",
  max = 12,
  show,
  label,
  fold,
  chips = false,
  empty,
}: {
  ctx: Ctx;
  list: string[];
  onChange: (next: string[]) => void;
  addLabel: L;
  /**
   * No line yet: what the list says instead, the wall's pencil note (or,
   * as chips, one dashed chip), never an empty box (score round 2 of the
   * design pass).
   */
  empty?: ReactNode;
  fold?: { lines: string[]; label: string };
  chips?: boolean;
  /**
   * What leads each line: a tick for what is always in their ads, a cross
   * for what never is (the line itself is never struck: a struck "No
   * discounts" reads as a rule taken back), a dash for what is never
   * shown, and a plain dash for their red lines.
   */
  kind?: "always" | "never" | "neverShow" | "plain";
  max?: number;
  /** How many lines the slide shows (the rest are counted). */
  show?: number;
  label: string;
}) {
  const { lang, bp } = ctx;
  const [draft, setDraft] = useState("");
  const editable = Boolean(bp && !bp.readOnly);
  const folded = new Set((fold?.lines ?? []).map(x => x.trim().toLowerCase()));
  const isFolded = (l: string) => folded.has(l.trim().toLowerCase());
  const foldCount = list.filter(isFolded).length;
  const own = list.filter(l => !isFolded(l));
  const visible = show ? own.slice(0, show) : own;
  const more = own.length - visible.length;
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (!list.some(x => x.toLowerCase() === s.toLowerCase()))
      onChange([...list, s].slice(0, max));
    setDraft("");
  };
  return (
    <div
      className="dkb-lines"
      data-kind={kind}
      data-fold={foldCount ? "" : undefined}
      data-chips={chips ? "" : undefined}
    >
      <ul aria-label={label}>
        {!list.length && empty ? (
          <li className="dkb-lines-empty">{empty}</li>
        ) : null}
        {fold && foldCount ? (
          <li className="dkb-fold-line">
            <span>{fold.label}</span>
          </li>
        ) : null}
        {[...list.filter(isFolded), ...visible].map(l => (
          // Each line takes its own direction: an English line in the
          // Arabic deck reads left to right, its mark on its left. A plain
          // span, never bdi: dir="auto" skips a bdi's words.
          <li key={l} dir="auto" data-folded={isFolded(l) ? "" : undefined}>
            <span>{whole(l)}</span>
            {editable ? (
              <button
                type="button"
                className="dkb-x"
                aria-label={`Take off: ${l}`}
                onClick={e => {
                  onChange(list.filter(x => x !== l));
                  letGo(e);
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            ) : null}
          </li>
        ))}
        {more > 0 ? (
          <li className="dkb-more">
            {lang === "ar"
              ? `وغيرها (${digits(more, lang)})`
              : `and ${more} more`}
          </li>
        ) : null}
      </ul>
      {editable && !afterCall(bp) && list.length < max ? (
        <input
          className="dkb-add"
          data-quiet=""
          // Empty, the placeholder takes the deck's direction (dir="auto"
          // with no words resolves to left to right); typed, its own.
          dir={draft ? "auto" : lang === "ar" ? "rtl" : "ltr"}
          value={draft}
          placeholder={`+ ${t(addLabel, lang)}`}
          aria-label={t(addLabel, lang)}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            } else if (e.key === "Escape") e.currentTarget.blur();
          }}
          onBlur={add}
        />
      ) : null}
    </div>
  );
}

/**
 * An empty amount's placeholder, by currency (about the same project in
 * each): the smallest project, then where the ads point. Marked "e.g.".
 */
const EXAMPLE_AMOUNT: Record<Currency, { minimum: number; anchor: number }> = {
  SAR: { minimum: 60_000, anchor: 220_000 },
  AED: { minimum: 60_000, anchor: 220_000 },
  QAR: { minimum: 60_000, anchor: 220_000 },
  KWD: { minimum: 5_000, anchor: 18_000 },
  BHD: { minimum: 6_000, anchor: 22_000 },
  OMR: { minimum: 6_000, anchor: 22_000 },
  USD: { minimum: 16_000, anchor: 60_000 },
};

/** An amount typed in its card: shown in words, typed as digits. */
function Amount({
  ctx,
  k,
  label,
}: {
  ctx: Ctx;
  k: "minimum" | "anchor";
  label: string;
}) {
  const { bp, lang, d } = ctx;
  const v = bp?.answers[k] as
    | { amount?: number; currency?: Currency }
    | undefined;
  const currency = v?.currency ?? currencyFor(d.country);
  const [draft, setDraft] = useState<string | null>(null);
  const editable = Boolean(bp && !bp.readOnly);
  const shown =
    typeof v?.amount === "number" ? moneyText(v.amount, currency, lang) : "";
  const eg = tf(BP.pricing.eg, lang, {
    amount: moneyText(EXAMPLE_AMOUNT[currency][k], currency, lang),
  });
  // Not typed yet: the example in pencil on the tag, never an input's grey
  // placeholder (score round 2 of the design pass); it steps aside while
  // the presenter types.
  const prompt =
    !shown && draft === null ? (
      <span className="dkb-amount-eg" aria-hidden={editable || undefined}>
        <Prompt lang={lang}>{eg}</Prompt>
      </span>
    ) : null;
  if (!editable)
    return (
      <p className="dkb-amount" dir="auto" data-empty={shown ? undefined : ""}>
        {shown || prompt}
      </p>
    );
  // The field's label, so a click on the pencilled example reaches it.
  return (
    <label className="dkb-amount-wrap">
      {prompt}
      <input
        className="dkb-amount"
        dir={(draft ?? shown) ? "auto" : lang === "ar" ? "rtl" : "ltr"}
        inputMode="numeric"
        aria-label={label}
        data-empty={shown || draft !== null ? undefined : ""}
        value={draft ?? shown}
        onFocus={() =>
          setDraft(typeof v?.amount === "number" ? String(v.amount) : "")
        }
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) {
            const n = parseAmount(draft);
            bp?.set(k, n ? { amount: n, currency } : null, { now: true });
          }
          setDraft(null);
        }}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

// ------------------------------------------------------------ the frames

type FrameKind = "words" | "look" | "offer";

/**
 * One of the wall's three frames (your words, your look, your offer).
 * Empty (the cover; a read-back part not built yet): an open frame of teal
 * tape on the felt, four strips crossing at the corners, the wall showing
 * through it, its label stuck inside the top edge and its hint on the felt
 * under it, as the Studio Wall mockup had it (score round 2 of the design
 * pass: solid paper mats with crop marks read as empty upload fields).
 * `holds`: something pinned in an empty frame (the cover's logo, the
 * read-back's note), which takes the hint's place. Filled (slides 6, 11
 * and 13, the cover once part 1 went): no outline; the client's own paper
 * is the frame, the label stuck on its top edge and the tape across its
 * corners (`tape={false}` where the words sit on the wall itself, with no
 * paper to hold).
 */
function Frame({
  ctx,
  kind,
  box,
  children,
  holds,
  hint = true,
  tape = true,
  assemble,
  flow = false,
  look,
}: {
  ctx: Ctx;
  kind: FrameKind;
  box: Box;
  children?: ReactNode;
  holds?: ReactNode;
  hint?: boolean;
  tape?: boolean;
  /** The read-back: the frame grows out of the wall's map, in this order. */
  assemble?: number;
  /** In a row: placed by it, its size its paper's. */
  flow?: boolean;
  /** The stop's focus: the frame, its label and its tape lift together. */
  look?: Look;
}) {
  const f = BP.frames[kind];
  const i = box.i ?? 0;
  const filled = Boolean(children);
  return (
    <section
      className={`dkb-frame dkb-at${flow ? " dkb-frame-flow" : ""}`}
      data-kind={kind}
      data-filled={filled ? "" : undefined}
      data-holds={!filled && holds ? "" : undefined}
      data-assemble={assemble != null ? "" : undefined}
      {...lookOf(look)}
      // Its --i is its outline's and hint's arrival too (they inherit it).
      style={
        {
          ...at(box),
          ...(assemble != null ? { ...fromMap(kind), "--k": assemble } : {}),
        } as CSSProperties
      }
      aria-label={t(f.name, ctx.lang)}
    >
      {filled ? null : (
        // The open frame: four strips of tape, each torn at its ends,
        // laid as the label lands (the label, the strips and the hint
        // share one arrival, so no label floats alone on the felt).
        <span className="dkb-outline" aria-hidden>
          <i data-edge="top" />
          <i data-edge="end" />
          <i data-edge="bottom" />
          <i data-edge="start" />
        </span>
      )}
      {/* Filled: the label holds the top-start, so the tape takes the
          top-end and bottom-start, where paper meets felt. */}
      {tape && filled ? (
        <>
          <Tape x={-30} y={-12} w={110} r={0.7} i={i} from="top-end" />
          <Tape x={-30} y={-14} w={110} r={-0.6} i={i} from="bottom-start" />
        </>
      ) : null}
      <Dymo box={filled ? { x: 28, y: -30, i } : { x: 30, y: 34, i }}>
        {t(f.name, ctx.lang)}
      </Dymo>
      {filled ? (
        <div className="dkb-frame-in">{children}</div>
      ) : holds ? (
        <div className="dkb-frame-holds">{holds}</div>
      ) : hint ? (
        <p className="dkb-hint">{t(f.hint, ctx.lang)}</p>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ 1 cover

function Cover({ ctx }: { ctx: Ctx }) {
  const { d, lang } = ctx;
  const dates = datesOf(ctx);
  const date = `${dayMonth(dates.call, lang, tz(d))} ${digits(new Date(dates.call).getUTCFullYear(), lang)}`;
  const other =
    lang === "en" ? d.nameAr : d.name !== d.nameEn ? d.nameEn : null;
  // A hyphen never breaks the name ("Fit-out" stays whole); a name too long,
  // or with a word too wide for the line, steps down to 104 px.
  const shownName = d.name.replace(/-/g, "\u2011");
  const tooLong = d.name.trim().length > (lang === "ar" ? 18 : 22);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const [wide, setWide] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again for each name
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el || tooLong) return;
    el.removeAttribute("data-long");
    setWide(el.scrollWidth > el.clientWidth + 1);
  }, [shownName, tooLong]);
  const long = tooLong || wide;
  const logo = d.logo?.from === "verified" ? d.logo : null;
  const photo = coverPhoto(d, scenesOf(ctx));
  // The presenter's first name, when the record has it and the seat is the
  // creative director's (a CSM reading the deck is not the presenter);
  // else the role alone.
  const presenter = ctx.bp && !ctx.bp.readOnly ? d.csmFirst : null;
  // Once part 1 went (sent, closed, locked), the cover shows the wall as
  // far as it got (score round 1 of the design pass: the frames stayed
  // empty after the wall was filled): their method's first line pinned in
  // "Your words", the offer's name in "Your offer". Before that, the
  // frames wait, as the call's promise.
  const a: Answers = ctx.bp?.answers ?? {};
  const filled = underway(ctx.bp);
  const line = filled ? firstLine(a.method, 92) : null;
  const offerName = filled
    ? str((a.offer as Record<string, unknown> | undefined)?.name)
    : null;
  return (
    <Wall ctx={ctx} slide="cover">
      <div className="dkb-cover-text">
        <p className="dkb-dateline">{tf(BP.cover.dateline, lang, { date })}</p>
        <h1
          ref={nameRef}
          className="dkb-display"
          data-long={long ? "" : undefined}
          dir="auto"
        >
          <bdi>{shownName}</bdi>
        </h1>
        {other ? (
          <p className="dkb-other-name" dir="auto">
            <bdi>{other}</bdi>
          </p>
        ) : null}
        <p className="dkb-lead">{t(BP.cover.lead, lang)}</p>
        <p className="dkb-byline">
          {presenter
            ? tf(BP.cover.bylineNamed, lang, { name: presenter })
            : t(BP.cover.byline, lang)}
        </p>
        {/* The amber note under the byline, so the title column runs to the
            wall's foot as the frames do (score round 1 of the design pass:
            the column stood empty under the byline). */}
        <Sticky flow box={{ x: 0, y: 0, r: -0.9, i: 4 }}>
          {t(BP.cover.sticky, lang)}
        </Sticky>
      </div>
      {/* The three frames, waiting: one tight cluster, 60 px gutters
          (words over offer at 1000; look at 1500, its first paper already
          on it: their logo, pinned across its foot). Under the look, the
          photo print the Studio mockup carried (score round 3): their own
          photo when the record has one, else their service's example. */}
      <Frame
        ctx={ctx}
        kind="words"
        box={{ x: 1000, y: 140, w: 440, h: 290, i: 0 }}
      >
        {line ? (
          <div
            className="dkb-card dkb-pin dkb-cover-paper"
            style={at({ x: 0, y: 0, w: 440, h: 290, i: 0 })}
          >
            <p className="dkb-cover-words" dir="auto">
              <bdi>{line}</bdi>
            </p>
          </div>
        ) : null}
      </Frame>
      {/* Their logo, when verified, is the first thing pinned in "Your
          look", in place of its hint (score round 2 of the design pass:
          the hint stayed printed over it and the crop marks poked out
          beside it). */}
      <Frame
        ctx={ctx}
        kind="look"
        box={{ x: 1500, y: 140, w: 300, h: 400, i: 1 }}
        holds={
          logo ? (
            <figure
              className="dkb-print dkb-pin dkb-cover-logo"
              style={at({ x: 40, y: 150, w: 220, h: 150, r: 0.8, i: 1 })}
            >
              <img
                src={logo.url}
                alt={t(BP.cover.logo, lang)}
                draggable={false}
              />
            </figure>
          ) : undefined
        }
      />
      <Frame
        ctx={ctx}
        kind="offer"
        box={{ x: 1000, y: 490, w: 440, h: 330, i: 2 }}
      >
        {offerName ? (
          <div
            className="dkb-card dkb-pin dkb-cover-paper"
            style={at({ x: 0, y: 0, w: 440, h: 330, i: 2 })}
          >
            <p className="dkb-cover-offer" dir="auto">
              <bdi>{whole(offerName)}</bdi>
            </p>
          </div>
        ) : null}
      </Frame>
      <figure
        className="dkb-print dkb-pin dkb-cover-photo"
        style={at({ x: 1492, y: 604, w: 316, h: 300, r: -0.7, i: 3 })}
      >
        <Tape x={104} y={-16} w={108} r={0.6} i={3} />
        <img src={photo.url} alt="" draggable={false} />
        <figcaption className="dkb-prov">
          {t(photo.own ? BP.cover.photoOwn : BP.cover.photoExample, lang)}
        </figcaption>
      </figure>
    </Wall>
  );
}

// ------------------------------------------------------------ 2 so far

/**
 * The five services as a paint fan: the pick lit teal, two asked in amber.
 * `parked`: the others slide off to the parked tag (slide 4's second stop),
 * leaving the pick alone on the bolt.
 */
function Fan({
  ctx,
  size,
  tappable,
  parked = false,
}: {
  ctx: Ctx;
  size: "small" | "large";
  tappable: boolean;
  parked?: boolean;
}) {
  const { bp, lang } = ctx;
  const service = bp?.answers.service as BpService | undefined;
  const two = !service ? (bp?.prefill.twoServices ?? null) : null;
  const lit = (k: BpService) => k === service;
  const ask = (k: BpService) => Boolean(two?.includes(k));
  // The lit (or asked) strips lie at the front, the rest fan up behind
  // them in the kickoff's order: the fan opens by meaning.
  const front = BP_SERVICES.filter(k => lit(k) || ask(k));
  const back = BP_SERVICES.filter(k => !lit(k) && !ask(k));
  const order = [...back, ...front];
  const step = size === "large" ? 9.5 : 11;
  const editable = Boolean(tappable && bp && !bp.readOnly);
  // Nothing to park until a service is lit (or two are asked).
  const parks = parked && front.length > 0;
  return (
    <div
      className="dkb-fan"
      role="group"
      data-size={size}
      data-parked={parks ? "" : undefined}
      aria-label={t(BP.firstAds.service, lang)}
    >
      {order.map((k, n) => {
        const angle = -(order.length - 1 - n) * step;
        const name = t(SERVICES[k].name, lang);
        // Parked: it has left for the tag (the tag names it now).
        const gone = parks && !lit(k) && !ask(k);
        const props = {
          className: "dkb-strip",
          "data-lit": lit(k) ? "" : undefined,
          "data-ask": ask(k) ? "" : undefined,
          "data-gone": gone ? "" : undefined,
          "aria-hidden": gone ? true : undefined,
          style: { "--a": `${angle}deg`, "--i": n } as CSSProperties,
        };
        return editable && !gone ? (
          <button
            key={k}
            type="button"
            {...props}
            aria-pressed={lit(k)}
            onClick={e => {
              bp?.set("service", lit(k) ? null : k, { now: true });
              letGo(e);
            }}
          >
            <span>{name}</span>
          </button>
        ) : (
          <span key={k} {...props}>
            <span>{name}</span>
          </span>
        );
      })}
      {/* Parked: the fan folded under the lit strip, two blades' edges
          showing at its far end with the stubs of their labels, so the
          rivet still holds a fan (score round 3: a lone strip read as a
          toggle; round 1 of the design pass: one grey slab read as a
          button's shadow). */}
      {parks
        ? ([2, 1] as const).map(n => (
            <span key={n} className="dkb-fan-edge" data-n={n} aria-hidden>
              <i />
            </span>
          ))
        : null}
      <span className="dkb-bolt" aria-hidden />
    </div>
  );
}

/** Slide 2's service: the lit one as one teal chip (the fan is slide 4's moment). */
function ServiceChip({ ctx }: { ctx: Ctx }) {
  const { lang, bp } = ctx;
  const service = bp?.answers.service as BpService | undefined;
  const two = !service ? (bp?.prefill.twoServices ?? []) : [];
  return (
    <Card box={{ x: 0, y: 0, r: 0.5, i: 2 }} flow className="dkb-svc">
      <Tape x={300} y={-14} w={130} r={-0.6} />
      {/* Two asked: the question is the card's label, the two chips under it. */}
      <p className="dkb-card-label">
        {t(two.length > 1 ? BP.oneService.two : BP.soFar.service, lang)}{" "}
        <Mark bp={bp} k="service" lang={lang} />
      </p>
      <div className="dkb-svc-row" data-two={two.length > 1 ? "" : undefined}>
        {service ? (
          <span className="dkb-chip-lit">
            {t(SERVICES[service].name, lang)}
          </span>
        ) : two.length > 1 ? (
          two.map(k => (
            <span key={k} className="dkb-chip-lit" data-ask="">
              {t(SERVICES[k as BpService].name, lang)}
            </span>
          ))
        ) : (
          // Not picked yet: the presenter's pencil note (score round 2 of
          // the design pass), picked on slide 4.
          <Prompt lang={lang}>{t(BP.soFar.noService, lang)}</Prompt>
        )}
      </div>
    </Card>
  );
}

function SoFar({ ctx }: { ctx: Ctx }) {
  const { d, lang, bp } = ctx;
  const goal = shownGoals(d).find(g => g.key === "goal90");
  const red = lines(bp?.answers.red_lines);
  const clients = str(bp?.answers.best_client);
  // Nothing of theirs yet for a card (score round 1 of the design pass: an
  // empty underlined field in the sparse case): no blank card on the wall.
  // Both blank, one amber sticky says they are filled in together now; the
  // first word typed in the notes window pins its card here, live.
  // A card shown once stays for the slide's visit, so clearing it to type
  // again never takes the paper from under the caret.
  const seen = useRef({ clients: false, red: false });
  if (clients) seen.current.clients = true;
  if (red.length) seen.current.red = true;
  const showClients = seen.current.clients;
  const showRed = seen.current.red;
  const together = !showClients && !showRed;
  return (
    <Wall ctx={ctx} slide="so-far">
      <Head
        ctx={ctx}
        id="so-far"
        sub={t(
          bp?.prefill.kickoff === false ? BP.soFar.subForm : BP.soFar.sub,
          lang,
        )}
        width={880}
      />
      {/* Two columns, the pair centred between the title and the foot, so
          a short (sparse) wall never leaves its bottom fifth bare. */}
      <div
        className="dkb-at dkb-sofar"
        style={at({ x: 120, y: 250, w: 1680, h: 706 })}
      >
        <div className="dkb-stack dkb-sofar-col">
          <Card box={{ x: 0, y: 0, r: -0.6, i: 0 }} flow className="dkb-goal">
            <Tape x={330} y={-14} w={140} />
            <p className="dkb-card-label">
              {t(BP.soFar.goal, lang)}{" "}
              <Mark bp={bp} lang={lang} from="onboarding" />
            </p>
            {goal ? (
              <p
                className="dkb-words"
                data-size={goal.lines.join(" ").length > 90 ? undefined : "xl"}
                dir="auto"
              >
                <bdi>{goal.lines.join(" ")}</bdi>
              </p>
            ) : (
              <p className="dkb-words dkb-quiet">{t(BP.soFar.noGoal, lang)}</p>
            )}
          </Card>
          {showClients ? (
            <Card box={{ x: 0, y: 0, i: 1 }} flow live className="dkb-clients">
              <Tape x={300} y={-14} w={120} />
              <p className="dkb-card-label">
                {t(BP.soFar.clients, lang)}{" "}
                <Mark bp={bp} k="best_client" lang={lang} />
              </p>
              <Ruled
                ctx={ctx}
                k="best_client"
                size="small"
                minRows={1}
                maxRows={3}
                label={t(BP.soFar.clients, lang)}
              />
            </Card>
          ) : together ? (
            <Sticky flow big box={{ x: 0, y: 0, r: -0.8, i: 1 }}>
              {t(BP.soFar.together, lang)}
            </Sticky>
          ) : null}
        </div>
        {/* No red lines on file: the column's sticky is set larger and
            dropped to the foot, so the right column ends with the left
            (score round 2 of the design pass: 800 x 330 of bare wall). */}
        <div
          className="dkb-stack dkb-sofar-col"
          data-drop={showRed ? undefined : ""}
        >
          <ServiceChip ctx={ctx} />
          {/* The red lines' card is as tall as its lines (score round 3: two
              spare rules read as a form); the sticky pinned under it. */}
          {showRed ? (
            <Card box={{ x: 0, y: 0, i: 3 }} flow live className="dkb-never">
              <Tape x={300} y={-14} w={120} r={0.6} />
              <p className="dkb-card-label">
                {t(BP.soFar.never, lang)}{" "}
                <Mark bp={bp} k="red_lines" lang={lang} />
              </p>
              <LinesField
                ctx={ctx}
                list={red}
                show={5}
                kind="plain"
                label={t(BP.soFar.never, lang)}
                addLabel={BP.soFar.addLine}
                empty={<Prompt lang={lang}>{t(BP.prompt.now, lang)}</Prompt>}
                onChange={next =>
                  bp?.set("red_lines", next.length ? next : null, { now: true })
                }
              />
            </Card>
          ) : null}
          <Sticky flow box={{ x: 0, y: 0, r: 0.9, i: 4 }}>
            {t(BP.soFar.sticky, lang)}
          </Sticky>
        </div>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 3 run sheet

function RunSheet({ ctx }: { ctx: Ctx }) {
  const { d, lang } = ctx;
  const dates = datesOf(ctx);
  const date = dayShort(dates.call, lang, tz(d));
  const rows = BP.today.rows;
  return (
    <Wall ctx={ctx} slide="today">
      <Head ctx={ctx} id="today" width={600} />
      {/* The rules card is as tall as its three rules (score round 2 of
          the design pass: 150 px of blank paper between them), its top on
          the run sheet's first row. */}
      <Card
        box={{ x: 120, y: 272, w: 580, r: 0.8, i: 1 }}
        className="dkb-rules3"
      >
        <Tape x={220} y={-14} w={130} />
        <p className="dkb-card-label">{t(BP.today.rulesHead, lang)}</p>
        <ol>
          {BP.today.rules.map((r, n) => (
            <li key={r.en}>
              <span className="dkb-n">{digits(n + 1, lang)}</span>
              {t(r, lang)}
            </li>
          ))}
        </ol>
      </Card>
      <Card
        box={{ x: 760, y: 120, w: 1040, h: 832, r: 0.6, i: 0 }}
        className="dkb-runsheet"
      >
        <Tape x={460} y={-14} w={150} />
        <header className="dkb-runsheet-head">
          <span>{tf(BP.today.sheet, lang, { date })}</span>
          <bdi dir="auto">{d.name}</bdi>
        </header>
        <div className="dkb-runsheet-grid">
          <span className="dkb-runsheet-min">{t(BP.today.min, lang)}</span>
          <span />
          <ol className="dkb-runsheet-rows">
            {rows.map((r, n) => (
              <li key={r.en} style={{ "--i": n } as CSSProperties}>
                <span className="dkb-mono">
                  {r.at === 0 ? t(BP.today.start, lang) : digits(r.at, lang)}
                </span>
                <span>{t(r, lang)}</span>
              </li>
            ))}
            {/* After the call: part 3, the offer locked with them. */}
            <li data-after="">
              <span className="dkb-mono">{t(BP.today.afterMin, lang)}</span>
              <span>{t(BP.today.after, lang)}</span>
            </li>
          </ol>
          {/* Each part its own bracket, none inside another: part 1 the
              first two rows, part 2 the rest of the call, part 3 (dashed)
              the row after it. */}
          <div className="dkb-brackets" aria-hidden>
            {(
              [
                [1, 0, 2],
                [2, 2, rows.length],
                [3, rows.length, rows.length + 1],
              ] as const
            ).map(([part, from, to]) => {
              const [head, ...rest] = t(BP.today.brackets[part], lang).split(
                /\s·\s|،\s/,
              );
              return (
                <span
                  key={part}
                  className="dkb-bracket"
                  data-part={part}
                  style={{ "--from": from, "--to": to } as CSSProperties}
                >
                  <i />
                  <b>
                    <strong>{head}</strong>
                    {rest.map(r => (
                      <span key={r}>{r}</span>
                    ))}
                  </b>
                </span>
              );
            })}
          </div>
        </div>
      </Card>
    </Wall>
  );
}

// ------------------------------------------------------------ 4 one service

/**
 * The other services they offer, in their own words (any that is the lit
 * service is on the fan, so it is left out).
 */
function theirOthers(d: DeckData, chosen: readonly string[]): string[] {
  const kept: string[] = [];
  for (const s of d.services) {
    const k = serviceOfText(s);
    if (k && chosen.includes(k)) continue;
    if (!kept.some(x => x.toLowerCase() === s.toLowerCase())) kept.push(s);
  }
  return kept.slice(0, 4);
}

/**
 * Slide 4, the fan's moment (it is not on slide 2). Stop 1: the five
 * strips open, the pick lit (tap one to set it), and the kraft "Parked for
 * later" tag holds the other services they offer, in their words. Stop 2:
 * the other strips slide off the fan into the tag, named there, over
 * their words; the pick stays alone on the bolt. The tag hangs level with
 * the fan's top strip.
 */
function OneService({ ctx }: { ctx: Ctx }) {
  const { d, lang, bp, tour } = ctx;
  const service = bp?.answers.service as BpService | undefined;
  const asked = !service ? (bp?.prefill.twoServices ?? []) : [];
  const two = asked.length > 1;
  const chosen: readonly string[] = service ? [service] : asked;
  const parks = tour >= 1 && chosen.length > 0;
  const mains = parks ? BP_SERVICES.filter(k => !chosen.includes(k)) : [];
  const theirs = theirOthers(d, chosen);
  // The next slide's example ads, fetched while this one is up.
  const next = serviceOf(ctx);
  useEffect(() => {
    const scenes = SCENES[next];
    warmExamples(
      [0, 1, 2].map(
        n =>
          exampleCreative(
            sceneAt({ scenes }, n),
            n === 1 ? "story" : "feed",
            { primary: null, headline: null },
            "en",
          ).url ?? "",
      ),
    );
  }, [next]);
  return (
    <Wall ctx={ctx} slide="one-service">
      <Head ctx={ctx} id="one-service" width={900} />
      {/* Stop 2: once the others leave, the lit strip rises to the fan's
          middle (y 470) at 1.1, its line under it, so the slide never
          ends on a lone strip in a corner (score round 2). */}
      <div
        className="dkb-at dkb-fan-wrap"
        data-parked={parks ? "" : undefined}
        style={at({ x: 180, y: 760 })}
      >
        <Fan ctx={ctx} size="large" tappable parked={tour >= 1} />
      </div>
      <p
        className="dkb-lead dkb-at dkb-fan-line"
        data-parked={parks ? "" : undefined}
        style={at({ x: 120, y: 860, w: 1000, i: 6 })}
      >
        {two
          ? t(BP.oneService.two, lang)
          : service
            ? t(BP.oneService.line, lang)
            : t(BP.oneService.none, lang)}
      </p>
      {/* Nothing lit yet: nothing is parked, so the tag only lists what
          else they offer (score round 3: "Parked for later" over a
          service list nobody had set aside). Its middle sits on the fan's
          middle (y 500) on both stops, so the slide's two halves carry
          the same weight (score round 1 of the design pass); on the park
          it is pinned again at its full height as the strips reach it. */}
      <div
        className="dkb-at dkb-parked-at"
        style={at({ x: 1120, y: 560, w: 680 })}
      >
        <Card
          box={{ x: 0, y: 0, r: 0.8, i: 6 }}
          flow
          className="dkb-kraft dkb-parked"
          attrs={{ "data-grown": parks ? "" : undefined }}
          label={t(
            chosen.length ? BP.oneService.parked : BP.oneService.theirs,
            lang,
          )}
        >
          <Tape x={270} y={-14} w={140} />
          <p className="dkb-card-label">
            {t(
              chosen.length ? BP.oneService.parked : BP.oneService.theirs,
              lang,
            )}
          </p>
          {mains.length || theirs.length ? (
            <ul>
              {mains.map((k, n) => (
                <li key={k} data-main="" style={{ "--k": n } as CSSProperties}>
                  {t(SERVICES[k].name, lang)}
                </li>
              ))}
              {mains.length && theirs.length ? (
                <li className="dkb-parked-sub">
                  {t(BP.oneService.theirs, lang)}
                </li>
              ) : null}
              {theirs.map(s => (
                <li key={s} dir="auto">
                  <span>{whole(s)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dkb-quiet-print">
              {t(BP.oneService.parkedNone, lang)}
            </p>
          )}
        </Card>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 5 first ads

/** The service the call is about: the lit one, else the deck's own pick. */
function serviceOf(ctx: Ctx): MainKey {
  const s = ctx.bp?.answers.service as BpService | undefined;
  return s ?? ctx.d.example.service;
}

/** That service's example pictures (Mahara's own: no client's work, no landmark). */
const scenesOf = (ctx: Ctx): readonly Theme[] => SCENES[serviceOf(ctx)];

/**
 * Slide 5's first stop (the CEO's first ask): what a starter ad is, shown
 * as three ads pinned to the wall as prints (score round 2 of the design
 * pass: hand-drawn phones, with a notch, a status bar and a tab bar, were
 * re-drawn app chrome, Hallmark gate 47, and read as app UI): each a photo
 * from the lit service's example scenes, the client's name on the ad's
 * strip with its one line, tagged "Example ad", and the place it runs
 * under it. The real pack (a Drive folder) is never framed on the canvas:
 * the notes window opens it in its own window.
 */
function AdPrints({ ctx }: { ctx: Ctx }) {
  const { d, lang } = ctx;
  const service = serviceOf(ctx);
  const pick = { scenes: scenesOf(ctx) };
  // Their selling line, else our example caption (the "Example ad" tag
  // covers it), never an empty strip (score round 2).
  const line =
    d.exampleWords.primary ??
    tf(BP.firstAds.caption, lang, { service: t(SERVICES[service].name, lang) });
  const prints = [
    {
      key: "feed",
      scene: sceneAt(pick, 0),
      shape: "feed",
      place: SHARED.frame.feed,
      mark: "instagram",
    },
    {
      key: "reels",
      scene: sceneAt(pick, 1),
      shape: "story",
      // Short, on one line (score round 1 of the design pass).
      place: BP.firstAds.reels,
      mark: "instagram",
    },
    {
      key: "facebook",
      scene: sceneAt(pick, 2),
      shape: "feed",
      place: SHARED.frame.facebook,
      mark: "facebook",
    },
  ] as const;
  return (
    <div
      className="dkb-at dkb-ads"
      style={at({ x: 780, y: 176, w: 1020, h: 760 })}
    >
      {prints.map((p, n) => (
        // The print is paper; its tag and its place hang under it on the
        // felt, each on its own.
        <div
          key={p.key}
          className="dkb-at dkb-adprint-at"
          style={at({ x: n * 360, y: [40, 68, 50][n], w: 300 })}
        >
          <figure
            className="dkb-adprint dkb-pin dkb-flow"
            style={
              { "--r": `${[-0.7, 0.6, -0.4][n]}deg`, "--i": n } as CSSProperties
            }
          >
            <Tape x={96} y={-14} w={108} r={[0.5, -0.6, 0.4][n]} i={n} />
            <span className="dkb-adprint-photo">
              <img
                src={p.shape === "story" ? storyUrl(p.scene) : feedUrl(p.scene)}
                alt={exampleAlt(p.scene, lang)}
                draggable={false}
              />
            </span>
            <figcaption className="dkb-adprint-strip">
              <span className="dkb-adprint-name" dir="auto">
                <bdi>{d.pageName}</bdi>
              </span>
              <b className="dkb-adprint-line" dir="auto">
                <bdi>{line}</bdi>
              </b>
            </figcaption>
          </figure>
          <span
            className="dkb-prov dkb-ad-tag dkb-arrive"
            style={{ "--i": n } as CSSProperties}
          >
            {t(BP.tag.exampleAd, lang)}
          </span>
          <p
            className="dkb-ad-foot dkb-arrive"
            style={{ "--i": n } as CSSProperties}
          >
            <Logo mark={p.mark} size={26} />
            {t(p.place, lang)}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Stop 1's start column: what the pack is, in three lines. The real pack
 * opens from the notes window, in its own window (score round 1 of the
 * design pass: a white "Open the pack" pill was a web button on the
 * client's screen).
 */
function PackWords({ ctx }: { ctx: Ctx }) {
  const { bp, lang } = ctx;
  // The lit service only: until slide 4's pick is on record the line says
  // "your service", so it never names one slide 4 is still asking about
  // (the phones beside keep their example pictures, tagged).
  const lit = bp?.answers.service as BpService | undefined;
  const service = lit
    ? lang === "ar"
      ? SERVICES[lit].name.ar
      : SERVICES[lit].mid.en
    : null;
  return (
    <div
      className="dkb-at dkb-pack-words"
      style={at({ x: 120, y: 330, w: 580 })}
    >
      <ol>
        {BP.firstAds.pack.map((l, n) => (
          <li
            key={l.en}
            className="dkb-arrive"
            style={{ "--i": n } as CSSProperties}
          >
            <span className="dkb-n">{digits(n + 1, lang)}</span>
            <span>
              {n === 0
                ? service
                  ? tf(l, lang, { service })
                  : t(BP.firstAds.packAny, lang)
                : t(l, lang)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The four shots we ask for, each a polaroid holding an example still of
 * their service (tagged Example): talking to camera framed in a
 * viewfinder, a site, a finished project, and a before and after split.
 */
function shotScenes(ctx: Ctx): Theme[] {
  const s = serviceOf(ctx);
  const own = SCENES[s];
  return [
    own[0],
    s === "construction" ? "construction2" : "construction3",
    s === "construction" ? "villa" : (own[1] ?? own[0]),
    s === "construction" ? "facade" : (own[2] ?? own[0]),
  ];
}

function Shot({
  ctx,
  n,
  box,
  small = false,
  wait = false,
}: {
  ctx: Ctx;
  n: number;
  box: Box;
  small?: boolean;
  wait?: boolean;
}) {
  const s = BP.content.shots[n];
  const scene = shotScenes(ctx)[n];
  // The full render, cut to the polaroid by object-fit (score round 2 of
  // the design pass: the 216 px tiles were soft at 354 px).
  const src = feedUrl(scene);
  return (
    <figure
      className="dkb-polaroid dkb-pin"
      data-small={small ? "" : undefined}
      data-shot={n}
      data-wait={wait ? "" : undefined}
      style={at(box)}
    >
      <span className="dkb-polaroid-well">
        {n === 3 ? (
          // Before and after: the same still, its start half dimmed.
          <>
            <img src={src} alt="" draggable={false} />
            <img src={src} alt="" draggable={false} data-before="" />
            <i className="dkb-split" aria-hidden />
          </>
        ) : (
          // A plain example still on every polaroid, its caption saying the
          // shot (score round 1 of the design pass: a tripod drawn over the
          // first read as clip art).
          <img src={src} alt="" draggable={false} />
        )}
        <span className="dkb-example dkb-polaroid-tag">
          {t(BP.tag.example, ctx.lang)}
        </span>
      </span>
      <figcaption>{t(s, ctx.lang)}</figcaption>
    </figure>
  );
}

/** The four shots, small: slide 5's first stop when they start with their own ads. */
function ShotsPreview({ ctx, box }: { ctx: Ctx; box: Box }) {
  return (
    <div className="dkb-at dkb-shots-mini" style={at(box)}>
      {BP.content.shots.map((s, n) => (
        <Shot
          key={s.en}
          ctx={ctx}
          n={n}
          small
          box={{
            x: n * 270,
            y: n % 2 ? 24 : 0,
            w: 240,
            h: 290,
            r: n % 2 ? 0.7 : -0.6,
            i: n + 1,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The parts of the form, as the slide lists them: done, now, later. Drawn
 * as the run sheet draws them (score round 1 of the design pass: numbered
 * circles, one filled teal, read as a checkout's steps): each part a rail
 * in the run sheet's teal, its name in mono, a pen tick once it is sent.
 */
function PartsList({ ctx }: { ctx: Ctx }) {
  const { lang, bp } = ctx;
  return (
    <ol className="dkb-parts dkb-at" style={at({ x: 120, y: 560, w: 560 })}>
      {([1, 2, 3] as const).map(n => {
        // Part 1 ticks with the stamp, from the same press (never before
        // the stamp lands on the sheet beside it).
        const done =
          n === 1 ? Boolean(bp?.stamp) : Boolean(bp?.parts[String(n) as "2"]);
        // A fresh press: the tick lands as the stamp does (its 240 ms), the
        // number held until then (score round 2: it ticked first).
        const fresh = n === 1 && Boolean(bp?.stamp?.fresh);
        return (
          <li
            key={n}
            data-done={done ? "" : undefined}
            data-now={n === 1 && !done ? "" : undefined}
            data-fresh={fresh ? "" : undefined}
          >
            <span
              className="dkb-part-n"
              data-was={fresh ? digits(n, lang) : undefined}
            >
              {t(BP.today.brackets[n], lang).split(/\s·\s|،\s/)[0]}
              {done ? <PenTick fresh={fresh} /> : null}
            </span>
            <span>
              <b>{t(BP.parts[n], lang)}</b>
              {fresh ? (
                // A fresh press: the line under part 1 turns as the stamp
                // lands and the tick shows, never before (score round 3:
                // it said sent about 400 ms early).
                <small className="dkb-swap">
                  <span data-was="">{t(BP.firstAds.partsNow[1], lang)}</span>
                  <span data-now="">{t(BP.firstAds.partsDone[1], lang)}</span>
                </small>
              ) : (
                <small>
                  {n === 1 && !done
                    ? t(BP.firstAds.partsNow[1], lang)
                    : n === 2 && !done
                      ? t(BP.firstAds.partsNext[2], lang)
                      : t(BP.firstAds.partsDone[n], lang)}
                </small>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Stamp({ ctx }: { ctx: Ctx }) {
  const { bp, d, lang } = ctx;
  const s = bp?.stamp;
  if (!s) return null;
  const time = hhmm(s.at, tz(d));
  return (
    <div
      className="dkb-stamp"
      data-fresh={s.fresh ? "" : undefined}
      role="status"
    >
      <b>{t(BP.firstAds.stamp.title, lang)}</b>
      <span>{tf(BP.firstAds.stamp.line, lang, { time })}</span>
    </div>
  );
}

function Sheet({ ctx }: { ctx: Ctx }) {
  const { lang, bp, d } = ctx;
  const a: Answers = bp?.answers ?? {};
  const service = a.service as BpService | undefined;
  const starter = a.starter as "yes" | "no" | undefined;
  const red = lines(a.red_lines);
  const n = privateCount(a);
  const fold = foldKey(n);
  const approval = a.pack_approval as
    | "on_call"
    | "before"
    | "wants_changes"
    | undefined;
  return (
    // The sheet's height is its words' (at least 820), and the two blank
    // sheets behind follow it; no tabs, since the parts list beside it
    // already names the three parts (score round 2).
    <div
      className="dkb-at dkb-sheet-area"
      style={at({ x: 760, y: 104, w: 1040, h: 856 })}
    >
      <div className="dkb-sheet-stack">
        <span className="dkb-sheet-back" data-n="2" aria-hidden />
        <span className="dkb-sheet-back" data-n="1" aria-hidden />
        <section
          className="dkb-sheet dkb-pin dkb-flow"
          data-live=""
          style={at({ x: 0, y: 0, w: 1040, i: 0 })}
        >
          <header className="dkb-sheet-head">
            <span>
              {t(BP.deckName, lang)}
              {lang === "ar" ? "، " : " · "}
              <bdi dir="auto">{d.name}</bdi>
            </span>
            <span className="dkb-mono">
              {tf(BP.partOf, lang, { n: digits(1, lang) })}
            </span>
          </header>
          <h3 className="dkb-sheet-title">{t(BP.parts[1], lang)}</h3>
          <div className="dkb-field">
            <span className="dkb-field-label">
              {t(BP.firstAds.service, lang)}
            </span>
            <Mark bp={bp} k="service" lang={lang} />
            <span className="dkb-field-ans">
              {service ? (
                <>
                  <span className="dkb-chip-lit">
                    {t(SERVICES[service].name, lang)}
                  </span>
                  <span className="dkb-quiet-print">
                    {t(BP.firstAds.serviceRest, lang)}
                  </span>
                </>
              ) : (
                // Not picked yet: a pencil note, never a grey question
                // (score round 2 of the design pass).
                <Prompt lang={lang}>{t(BP.prompt.pick, lang)}</Prompt>
              )}
            </span>
          </div>
          <div className="dkb-field">
            <span className="dkb-field-label">
              {t(BP.firstAds.starter, lang)}
            </span>
            <Mark bp={bp} k="starter" lang={lang} />
            <span className="dkb-field-ans">
              <PenChoice
                ctx={ctx}
                value={starter}
                toggle={false}
                chips
                label={t(BP.firstAds.starter, lang)}
                options={(["yes", "no"] as const).map(v => ({
                  v,
                  label: t(BP.firstAds[v], lang),
                }))}
                onPick={v => {
                  if (v) bp?.set("starter", v, { now: true });
                }}
              />
              <span className="dkb-quiet-print">
                {t(BP.firstAds.starterNote, lang)}
              </span>
            </span>
          </div>
          {starter === "yes" ? (
            <div className="dkb-field">
              <span className="dkb-field-label">
                {t(BP.firstAds.approval, lang)}
              </span>
              <Mark bp={bp} k="pack_approval" lang={lang} />
              {/* One of three, answered as Yes / No is: in pen on the paper. */}
              <span className="dkb-field-ans">
                <PenChoice
                  ctx={ctx}
                  value={approval}
                  chips
                  label={t(BP.firstAds.approval, lang)}
                  options={(
                    ["on_call", "before", "wants_changes"] as const
                  ).map(v => ({ v, label: t(BP.firstAds.approvals[v], lang) }))}
                  onPick={v => bp?.set("pack_approval", v, { now: true })}
                />
              </span>
            </div>
          ) : null}
          <div className="dkb-field dkb-field-last">
            <span className="dkb-field-label">
              {t(BP.firstAds.redLines, lang)}
            </span>
            <Mark bp={bp} k="red_lines" lang={lang} />
            <div className="dkb-field-split">
              <div className="dkb-redcol">
                {/* None yet: a pencil note on the blank paper, never two
                    rules waiting for words (score round 2 of the design
                    pass). */}
                {red.length ? null : (
                  <Prompt lang={lang}>{t(BP.prompt.now, lang)}</Prompt>
                )}
                <ul className="dkb-redlist">
                  {red.slice(0, 4).map(l => (
                    <li key={l} dir="auto">
                      <span>{whole(l)}</span>
                    </li>
                  ))}
                  {red.length > 4 ? (
                    <li className="dkb-more">
                      {lang === "ar"
                        ? `وغيرها (${digits(red.length - 4, lang)})`
                        : `and ${red.length - 4} more`}
                    </li>
                  ) : null}
                </ul>
                {/* One grey helper line, until the stamp says it went; its
                  room is kept after, so the sheet never moves. */}
                <p
                  className="dkb-helper"
                  data-gone={bp?.stamp ? "" : undefined}
                  aria-hidden={bp?.stamp ? true : undefined}
                >
                  {t(BP.firstAds.signoff, lang)}
                </p>
              </div>
              <div
                className="dkb-signoff"
                data-fired={bp?.stamp ? "" : undefined}
              >
                <Stamp ctx={ctx} />
              </div>
            </div>
          </div>
          {fold ? (
            <footer className="dkb-fold">
              {tf(BP.firstAds.fold[fold], lang, { n: digits(n, lang) })}
            </footer>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function FirstAds({ ctx }: { ctx: Ctx }) {
  const { lang, bp, tour } = ctx;
  const starter = bp?.answers.starter;
  return (
    <Wall ctx={ctx} slide="first-ads">
      <Head
        ctx={ctx}
        id="first-ads"
        width={600}
        title={starter === "no" ? BP.firstAds.titleOwn : undefined}
      />
      {tour === 0 ? (
        starter === "no" ? (
          <>
            <p
              className="dkb-lead dkb-at"
              style={at({ x: 120, y: 420, w: 540, i: 0 })}
            >
              {t(BP.firstAds.ownFirstLine, lang)}
            </p>
            {/* The label is stuck on the shots' top edge, as a frame's is
                on its paper, never floating on the felt (score round 2). */}
            <ShotsPreview ctx={ctx} box={{ x: 760, y: 360 }} />
            <Dymo box={{ x: 784, y: 332, i: 5 }}>
              {t(BP.firstAds.ownFirst, lang)}
            </Dymo>
          </>
        ) : (
          <>
            <PackWords ctx={ctx} />
            <AdPrints ctx={ctx} />
          </>
        )
      ) : (
        <>
          <p
            className="dkb-lead dkb-at"
            data-size="s"
            style={at({ x: 120, y: 330, w: 560, i: 0 })}
          >
            {t(
              bp?.prefill.kickoff === false
                ? BP.firstAds.sheetLeadNew
                : BP.firstAds.sheetLead,
              lang,
            )}
          </p>
          <PartsList ctx={ctx} />
          <Sheet ctx={ctx} />
        </>
      )}
    </Wall>
  );
}

// ------------------------------------------------------------ 6 best at

/**
 * Slide 6's moment: the first time their method is let go of on this
 * slide (it opened empty), a copy of its first line flies down into the
 * wall's map, into "Your words". Typing-driven, once, under 1 s; nothing
 * under reduced motion or in a still shot.
 */
function useFlight(value: string) {
  const openedEmpty = useRef(!value.trim());
  const [fly, setFly] = useState<string | null>(null);
  const leave = (v: string) => {
    if (!openedEmpty.current || !v.trim()) return;
    openedEmpty.current = false;
    setFly(firstLine(v, 40));
  };
  return { fly, leave };
}

function BestAt({ ctx }: { ctx: Ctx }) {
  const { lang, tour, d, bp } = ctx;
  // The struck line: their own earlier line when the record has one (the
  // selling line typed in prep), else what everyone says, as an example.
  const before = str(d.exampleWords.primary);
  const method =
    typeof bp?.answers.method === "string" ? bp.answers.method : "";
  const { fly, leave } = useFlight(method);
  const words = WALL_FRAMES.words;
  // Each stop's question lifts its paper; the rest step back (score round
  // 1 of the design pass). Stop 1 the method; stop 2 who they want and
  // who they don't; stop 3 what others in their city can't do.
  const look = (at: number | readonly number[]): Look =>
    (typeof at === "number" ? at === tour : at.includes(tour))
      ? "active"
      : "dim";
  return (
    <Wall ctx={ctx} slide="best-at">
      <Head ctx={ctx} id="best-at" width={1100} />
      {/* One row: their method on its paper, the three notes pinned
          beside it, each paper as tall as its words (score round 2 of the
          design pass: 200 px of blank paper under the method); the row in
          the middle of its room. Nothing answered yet is a pencil note on
          blank paper, never rules or a grey example waiting for words. */}
      <div
        className="dkb-at dkb-bestat"
        style={at({ x: 120, y: 268, w: 1680, h: 672 })}
      >
        {/* The label and the tape come with the paper (score round 1 of
            the design pass: the label landed alone on the empty wall). */}
        <Frame
          ctx={ctx}
          kind="words"
          box={{ x: 0, y: 0, i: 0 }}
          flow
          look={look(0)}
        >
          <Card box={{ x: 0, y: 0, i: 0 }} flow live className="dkb-method">
            <p className="dkb-card-label">
              {t(BP.bestAt.method, lang)}{" "}
              <Mark bp={ctx.bp} k="method" lang={lang} />
            </p>
            <div className="dkb-method-field">
              {/* Growing with the words; past four rows they step down,
                  so the row ends by y 940. */}
              <Ruled
                ctx={ctx}
                k="method"
                minRows={1}
                maxRows={4}
                cap={5}
                label={t(BP.bestAt.method, lang)}
                onLeave={leave}
                prompt={
                  <Prompt lang={lang}>{t(BP.prompt.together, lang)}</Prompt>
                }
              />
            </div>
          </Card>
          {/* What everyone says, struck, on its own small note pinned to
              the paper's corner (score round 2 of the design pass: printed
              on the card it read as a placeholder): their own earlier
              line when the record has one, else the example. */}
          <p
            className="dkb-eg-note dkb-pin"
            style={{ "--i": 1, "--r": "0.9deg" } as CSSProperties}
          >
            <Tape x={110} y={-14} w={104} r={-0.5} i={1} />
            <s dir="auto">
              <bdi>{before ?? t(BP.bestAt.struck, lang)}</bdi>
            </s>
            <span className="dkb-example">
              {t(before ? BP.tag.before : BP.tag.example, lang)}
            </span>
          </p>
        </Frame>
        <div className="dkb-stack dkb-notes">
          {(
            [
              {
                k: "best_client",
                l: BP.bestAt.clients,
                mark: true,
                at: [1],
                cap: 5,
              },
              {
                k: "not_for",
                l: BP.bestAt.notFor,
                mark: false,
                at: [1],
                cap: 3,
              },
              {
                k: "city_cant",
                l: BP.bestAt.cityCant,
                mark: false,
                at: [2],
                cap: 3,
              },
            ] as const
          ).map((n, j) => (
            // The next two notes are on the wall from the first stop,
            // sunk until their stop (score round 2: no quarter stands
            // empty).
            <Card
              key={n.k}
              box={{ x: 0, y: 0, i: j + 1 }}
              flow
              live
              className="dkb-side"
              look={look(n.at)}
            >
              <Tape x={232} y={-14} w={112} />
              <p className="dkb-card-label">
                {t(n.l, lang)}{" "}
                {n.mark ? <Mark bp={ctx.bp} k={n.k} lang={lang} /> : null}
              </p>
              <Ruled
                ctx={ctx}
                k={n.k}
                size="side"
                minRows={1}
                maxRows={2}
                cap={n.cap}
                label={t(n.l, lang)}
                prompt={
                  <Prompt lang={lang}>{t(BP.prompt.together, lang)}</Prompt>
                }
              />
            </Card>
          ))}
        </div>
      </div>
      {/* A paper copy, 600 wide at 40 px, lifts off the card above its
          words (score round 3: it sat over the typed words for 500 ms),
          then flies small into the map. */}
      {fly ? (
        <p
          className="dkb-fly"
          aria-hidden
          dir="auto"
          style={
            {
              ...at({ x: 144, y: 340 }),
              "--tx": px(MAP.x + words.x * MAP.s - 144),
              "--ty": px(MAP.y + words.y * MAP.s - 340),
            } as CSSProperties
          }
        >
          <bdi>{fly}</bdi>
        </p>
      ) : null}
    </Wall>
  );
}

// ------------------------------------------------------------ 7 pricing

/**
 * Slide 7's steel tape (SPEC 5.3), drawn to the numbers: it runs from
 * nothing at the start to a round number past the highest, the smallest
 * project and where the ads point each a mark at its value, and the range
 * for most projects a shaded band with its two numbers and its flag. The
 * two amounts hang under the tape on swing tags, each tied by its string
 * from the tag's hole to its own mark (score round 1 of the design pass:
 * the strings dropped at fixed places and reached no number), so the tag
 * is the mark's flag. An amount not typed yet hangs at its example value,
 * a dashed mark, its tag saying "e.g."; with no example that fits the
 * range they gave, its string is tied to the tape straight above the tag.
 */
const TAPE = { x: 120, y: 186, w: 1680 } as const;
/** The tags' row, under the tape; a tag's hole, from its top-start corner. */
const TAG_ROW_Y = 428;
const TAG_W = 440;
const HOLE = { x: 36, y: 50 } as const;

/**
 * Round values for the tape's scale: the step (1, 2, 2.5 or 5 of a power
 * of ten) that prints closest to four numbers short of its end.
 */
function tapeScale(end: number): number[] {
  const p = 10 ** Math.floor(Math.log10(end));
  let best: number[] = [];
  for (const base of [p / 10, p])
    for (const m of [1, 2, 2.5, 5]) {
      const step = base * m;
      const n = Math.floor((end * 0.999) / step);
      if (n < 2 || n > 5) continue;
      if (!best.length || Math.abs(n - 4) < Math.abs(best.length - 4))
        best = Array.from({ length: n }, (_, i) => step * (i + 1));
    }
  return best;
}

type TapeAmounts = {
  minimum: number | null;
  anchor: number | null;
  ghost: { minimum: boolean; anchor: boolean };
  band: [number, number] | null;
};

function tapeAmounts(ctx: Ctx): TapeAmounts {
  const { bp, d } = ctx;
  const num = (k: "minimum" | "anchor") => {
    const v = bp?.answers[k] as { amount?: unknown } | undefined;
    return typeof v?.amount === "number" ? v.amount : null;
  };
  const typedMin = num("minimum");
  const typedAnchor = num("anchor");
  // The range for most projects: typed on this call, else their own words
  // on the onboarding form (the card under the tape says which).
  const band = bandOf(bp?.answers.pricing ?? formDraft(bp, "pricing"));
  const ex = EXAMPLE_AMOUNT[currencyFor(d.country)];
  // An example hangs only where it makes sense against their range.
  const minFits = !band || ex.minimum < band[0];
  const anchorFits = !band || (ex.anchor >= band[0] && ex.anchor <= band[1]);
  const minimum = typedMin ?? (minFits ? ex.minimum : null);
  const anchor = typedAnchor ?? (anchorFits ? ex.anchor : null);
  return {
    minimum,
    anchor,
    band,
    ghost: {
      minimum: typedMin == null && minimum != null,
      anchor: typedAnchor == null && anchor != null,
    },
  };
}

function PriceTape({ ctx }: { ctx: Ctx }) {
  const { lang } = ctx;
  const { minimum, anchor, band, ghost } = tapeAmounts(ctx);
  const marks = tapeMarks({ minimum, anchor, band });
  const F = BP.pricing.flags;
  const W = TAPE.w;
  const px0 = 24;
  const len = W - px0 * 2;
  const xOf = (share: number) => px0 + share * len;
  // The flags never cross (the shot run's text checks found the range's
  // two numbers on each other in a narrow band). Widths are estimated
  // from the words, at the flags' sizes.
  const wide = (s: string, size: number) => s.length * size * 0.56;
  const bandPx = marks?.band ? (marks.band[1] - marks.band[0]) * len : 0;
  const lo = band ? shortAmount(band[0], lang) : "";
  const hi = band ? shortAmount(band[1], lang) : "";
  // A band too narrow for its two numbers says them on its flag instead.
  const bandNumbers =
    Boolean(band) && bandPx >= wide(lo, 22) + wide(hi, 22) + 48;
  const mostText = !band
    ? ""
    : bandNumbers || band[0] === band[1]
      ? t(F.most, lang)
      : tf(F.mostRange, lang, { lo, hi });
  const mostAt = marks?.band ? xOf((marks.band[0] + marks.band[1]) / 2) : 0;
  // Where each string is tied: its mark's foot, else the tape straight
  // above its tag's hole.
  const hole = {
    minimum: HOLE.x,
    anchor: W - TAG_W + HOLE.x,
  } as const;
  const tie = (k: "minimum" | "anchor") => {
    const share = marks?.[k];
    return share != null && (k === "minimum" ? minimum : anchor) != null
      ? { x: xOf(share), y: 210, mark: true }
      : { x: hole[k], y: 198, mark: false };
  };
  const holeY = TAG_ROW_Y - TAPE.y + HOLE.y;
  // A few round values printed along the tape, each on its own tick, so
  // a mark reads against a scale (score round 2 of the design pass: past
  // the band's ends the ruler had no numbers, and 60,000 floated); none so
  // near a mark that the two would read as one.
  // None inside a band that prints its own two numbers.
  const nums = marks
    ? tapeScale(marks.end).filter(
        v =>
          (["minimum", "anchor"] as const).every(k => {
            const share = marks[k];
            return (
              share == null ||
              (k === "minimum" ? minimum : anchor) == null ||
              Math.abs(xOf(share) - xOf(v / marks.end)) > 72
            );
          }) &&
          !(
            bandNumbers &&
            marks.band &&
            xOf(v / marks.end) > xOf(marks.band[0]) - 60 &&
            xOf(v / marks.end) < xOf(marks.band[1]) + 60
          ),
      )
    : [];
  return (
    <>
      <div
        className="dkb-at dkb-tape-wrap"
        data-ghost={ghost.minimum && ghost.anchor ? "" : undefined}
        style={at({ x: TAPE.x, y: TAPE.y, w: W, h: 230 })}
      >
        <div
          className="dkb-tape-rule dkb-pin"
          style={at({ x: 0, y: 96, w: W, h: 96, i: 0 })}
        >
          <span className="dkb-tape-ticks" aria-hidden />
          {marks?.band ? (
            <span
              className="dkb-tape-band"
              style={
                {
                  "--a": px(xOf(marks.band[0])),
                  "--b": px(
                    xOf(Math.max(marks.band[1], marks.band[0] + 0.004)),
                  ),
                } as CSSProperties
              }
            >
              {bandNumbers ? (
                <span className="dkb-tape-band-n" data-at="lo">
                  {lo}
                </span>
              ) : null}
              {bandNumbers && band && band[1] !== band[0] ? (
                <span className="dkb-tape-band-n" data-at="hi">
                  {hi}
                </span>
              ) : null}
            </span>
          ) : null}
          {/* Over the band, which is translucent: the scale reads through. */}
          {marks
            ? nums.map(v => (
                <span
                  key={v}
                  className="dkb-tape-num"
                  style={{ "--m": px(xOf(v / marks.end)) } as CSSProperties}
                >
                  {shortAmount(v, lang)}
                </span>
              ))
            : null}
          {(["minimum", "anchor"] as const).map(k =>
            marks?.[k] != null &&
            (k === "minimum" ? minimum : anchor) != null ? (
              <span
                key={k}
                className="dkb-tape-mark"
                data-kind={k}
                data-ghost={ghost[k] ? "" : undefined}
                data-low={k === "anchor" && marks.band ? "" : undefined}
                style={{ "--m": px(xOf(marks[k] as number)) } as CSSProperties}
              />
            ) : null,
          )}
        </div>
        {marks?.band && band ? (
          <p
            className="dkb-flag dkb-arrive"
            data-kind="most"
            data-side="mid"
            style={{ "--m": px(mostAt), "--i": 2 } as CSSProperties}
          >
            <span>{mostText}</span>
          </p>
        ) : null}
      </div>
      {/* The strings, drawn from each hole up to its tie once the tags
          have landed; mirrored in Arabic with the wall. */}
      <svg
        className="dkb-strings"
        viewBox={`0 0 ${W} ${holeY + 20}`}
        aria-hidden
        style={at({ x: TAPE.x, y: TAPE.y, w: W, h: holeY + 20 })}
      >
        {(["minimum", "anchor"] as const).map((k, n) => {
          const to = tie(k);
          const from = { x: hole[k], y: holeY };
          // A little slack: the string bows toward the floor.
          const mx = (from.x + to.x) / 2;
          const my =
            (from.y + to.y) / 2 + Math.min(14, Math.abs(to.x - from.x) * 0.04);
          return (
            <g
              key={k}
              data-kind={k}
              data-ghost={ghost[k] ? "" : undefined}
              style={{ "--i": n ? 4 : 2 } as CSSProperties}
            >
              <path
                d={`M${from.x} ${from.y} Q${mx} ${my} ${to.x} ${to.y}`}
                pathLength={1}
              />
              <circle cx={to.x} cy={to.y} r={10} />
            </g>
          );
        })}
      </svg>
    </>
  );
}

/**
 * An amount on a swing tag (score round 3: pricing read as a web form):
 * manila card, pointed at its start, a reinforced hole there, its string
 * tied to its mark on the tape; the amount typed live on it, so it hangs
 * straight. Its label starts under the hole, so the string never crosses
 * its words.
 */
function PriceTag({
  ctx,
  k,
  i,
}: {
  ctx: Ctx;
  k: "minimum" | "anchor";
  i: number;
}) {
  const { lang, bp } = ctx;
  const label = t(BP.pricing.marks[k], lang);
  return (
    <div
      className="dkb-pricetag dkb-pin dkb-flow"
      data-live=""
      data-kind={k}
      style={{ "--i": i } as CSSProperties}
    >
      <div className="dkb-pricetag-card">
        <span className="dkb-pricetag-hole" aria-hidden />
        <p className="dkb-card-label">
          {label} <Mark bp={bp} k={k} lang={lang} />
        </p>
        <Amount ctx={ctx} k={k} label={label} />
      </div>
    </div>
  );
}

/**
 * A form answer offered for a key and not yet in the record: their own
 * earlier words, whole (the summary notes show cuts mid-sentence).
 */
function formDraft(bp: BpModel | null | undefined, k: BpKey): string | null {
  if (!bp || (typeof bp.answers[k] === "string" && bp.answers[k])) return null;
  const p = bp.prefill?.values[k];
  const v = typeof p?.full === "string" && p.full.trim() ? p.full : p?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function Pricing({ ctx }: { ctx: Ctx }) {
  const { lang, bp, tour, d } = ctx;
  const minimum = moneyOf(bp?.answers.minimum, lang);
  const pricingDraft = formDraft(bp, "pricing");
  const termsDraft = formDraft(bp, "terms");
  return (
    <Wall ctx={ctx} slide="pricing">
      <Head ctx={ctx} id="pricing" width={1100} />
      <PriceTape ctx={ctx} />
      {/* Two rows on one grid: the two amounts as tags at either end, how
          they price between them (their onboarding form's words until
          they are corrected here, marked so); stop 2 the terms and the
          callers' line. Nothing is turned: the amounts are typed live. */}
      <div
        className="dkb-at dkb-price-rows"
        style={at({ x: TAPE.x, y: TAG_ROW_Y, w: TAPE.w })}
      >
        <div className="dkb-price-row" data-row="1">
          <PriceTag ctx={ctx} k="minimum" i={2} />
          <Card box={{ x: 0, y: 0, i: 3 }} flow live className="dkb-most">
            <p className="dkb-card-label">
              {t(BP.pricing.pricing, lang)}{" "}
              {pricingDraft ? (
                <Mark bp={bp} lang={lang} from="onboarding" />
              ) : (
                <Mark bp={bp} k="pricing" lang={lang} />
              )}
            </p>
            <Ruled
              ctx={ctx}
              k="pricing"
              size="side"
              minRows={2}
              maxRows={3}
              cap={4}
              draft={pricingDraft}
              label={t(BP.pricing.pricing, lang)}
              prompt={
                <Prompt lang={lang}>{t(BP.prompt.together, lang)}</Prompt>
              }
            />
          </Card>
          <PriceTag ctx={ctx} k="anchor" i={4} />
        </div>
        {/* How they are paid and the callers' line are on the wall from
            the first stop, stepped back until the second (score round 1 of
            the design pass: the bottom third stood empty). */}
        <div
          className="dkb-price-row"
          data-row="2"
          {...lookOf(tour >= 1 ? undefined : "dim")}
        >
          <Card box={{ x: 0, y: 0, i: 5 }} flow live className="dkb-terms">
            <p className="dkb-card-label">
              {t(BP.pricing.terms, lang)}{" "}
              {termsDraft ? (
                <Mark bp={bp} lang={lang} from="onboarding" />
              ) : (
                <Mark bp={bp} k="terms" lang={lang} />
              )}
            </p>
            <Ruled
              ctx={ctx}
              k="terms"
              size="side"
              minRows={2}
              maxRows={2}
              cap={3}
              draft={termsDraft}
              label={t(BP.pricing.terms, lang)}
              prompt={
                <Prompt lang={lang} eg>
                  {t(BP.pricing.termsEg, lang)}
                </Prompt>
              }
            />
          </Card>
          <Card box={{ x: 0, y: 0, i: 6 }} flow className="dkb-filter">
            <p className="dkb-card-label">{t(BP.pricing.filterHead, lang)}</p>
            {/* Example wording, so an amount not typed yet is the tag's
                example, never a blank to fill (score round 2 of the design
                pass). */}
            <p className="dkb-filter-line">
              {tf(BP.pricing.filter, lang, {
                minimum:
                  minimum ??
                  moneyText(
                    EXAMPLE_AMOUNT[currencyFor(d.country)].minimum,
                    currencyFor(d.country),
                    lang,
                  ),
              })}
            </p>
            <span className="dkb-example">
              {t(BP.tag.exampleWording, lang)}
            </span>
          </Card>
        </div>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 8 competitors

type Name = { name: string; lose: boolean; note?: string };

/** The wall's room for clippings: two rows of five; past it, the rest are counted. */
const CLIPPINGS = 10;
/** A row of clippings: five across the wall's width. */
const CLIP_COLS = 5;

/**
 * A long name steps down a size, then another, and runs to three lines;
 * it is never cut (score round 1 of the design pass: "The furniture
 * showrooms' free…" showed the client their own answer truncated).
 */
const nameSize = (name: string) =>
  name.length > 46 ? "more" : name.length > 28 ? "" : undefined;

/**
 * One competitor as a clipping pinned to the wall (score round 3: chips and
 * an input box read as a web form): the name as its headline, an amber
 * "We lose to them" label when they do, and under it what they are known
 * for, typed live on a pencilled line. A tap on the name marks the ones
 * they lose to, and back; the cross takes it off (hover only).
 */
function Clipping({
  ctx,
  n,
  i,
  names,
  save,
  look,
}: {
  ctx: Ctx;
  n: Name;
  i: number;
  names: Name[];
  /** `now`: a mark or a removal saves at once; a typed note after a pause. */
  save: (next: Name[], now: boolean) => void;
  look?: Look;
}) {
  const { lang, bp } = ctx;
  const editable = Boolean(bp && !bp.readOnly);
  const set = (patch: Partial<Name>, now: boolean) =>
    save(
      names.map(x => (x.name === n.name ? { ...x, ...patch } : x)),
      now,
    );
  // After the call an empty "known for" is said by nothing at all.
  const note = n.note?.trim() ?? "";
  const noteShown = Boolean(note) || !afterCall(bp);
  return (
    <li
      className="dkb-clip dkb-pin"
      data-live=""
      data-lose={n.lose ? "" : undefined}
      {...lookOf(look)}
      style={{ "--i": Math.min(i, 6) } as CSSProperties}
    >
      <Tape x={150} y={-14} w={96} i={Math.min(i, 6)} />
      <div className="dkb-clip-paper">
        {editable ? (
          <button
            type="button"
            className="dkb-clip-name"
            data-long={nameSize(n.name)}
            aria-pressed={n.lose}
            aria-label={`${n.name}: ${t(BP.competitors.lose, lang)}`}
            onClick={e => {
              set({ lose: !n.lose }, true);
              letGo(e);
            }}
          >
            <bdi dir="auto">{whole(n.name)}</bdi>
          </button>
        ) : (
          <p className="dkb-clip-name" data-long={nameSize(n.name)}>
            <bdi dir="auto">{whole(n.name)}</bdi>
          </p>
        )}
        {n.lose ? (
          <span className="dkb-lose">{t(BP.competitors.lose, lang)}</span>
        ) : null}
        {noteShown ? (
          <>
            <span className="dkb-clip-kicker">
              {t(BP.competitors.note, lang)}
            </span>
            <Ruled
              ctx={ctx}
              size="clip"
              one
              minRows={1}
              maxRows={2}
              cap={2}
              label={`${n.name}: ${t(BP.competitors.note, lang)}`}
              value={n.note ?? ""}
              onChange={v => set({ note: v }, false)}
              prompt={
                <Prompt lang={lang}>{t(BP.prompt.together, lang)}</Prompt>
              }
            />
          </>
        ) : null}
        {editable ? (
          <span className="dkb-chip-tools">
            <button
              type="button"
              aria-label={`Take off: ${n.name}`}
              onClick={e => {
                save(
                  names.filter(x => x.name !== n.name),
                  true,
                );
                letGo(e);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function Competitors({ ctx }: { ctx: Ctx }) {
  const { lang, bp, tour } = ctx;
  const names = (
    Array.isArray(bp?.answers.competitors)
      ? (bp.answers.competitors as Name[])
      : []
  ).filter(n => n && typeof n.name === "string");
  const editable = Boolean(bp && !bp.readOnly);
  const after = afterCall(bp);
  const [draft, setDraft] = useState("");
  // A note typed on a clipping saves after a pause, as typed fields do; a
  // name added, marked or taken off saves at once.
  const save = (next: Name[], now: boolean) =>
    bp?.set("competitors", next.length ? next : null, now ? { now } : {});
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (!names.some(n => n.name.toLowerCase() === s.toLowerCase()))
      save([...names, { name: s, lose: false }].slice(0, 15), true);
    setDraft("");
  };
  const adding = editable && !after && names.length < 15;
  const room = CLIPPINGS - (adding ? 1 : 0);
  const shown = names.length > room ? names.slice(0, room - 1) : names;
  const more = names.length - shown.length;
  const used = shown.length + (more ? 1 : 0) + (adding ? 1 : 0);
  // The next name is typed straight over an example clipping, its example
  // struck through as slide 6's is (score round 2 of the design pass: a
  // blank clipping with two rules read as an input).
  const ghosts = BP.competitors.ghosts;
  const next = ghosts[0];
  // Five across the wall while the call is on (score round 1 of the design
  // pass: four notes left a 340 px hole): example clippings, ours and
  // tagged, fill the row's free places. After the call only theirs, as
  // wide as the row allows.
  const examples = after
    ? []
    : (adding ? ghosts.slice(1) : ghosts).slice(
        0,
        Math.max(0, CLIP_COLS - used),
      );
  const cols = after ? Math.min(CLIP_COLS, Math.max(3, used)) : CLIP_COLS;
  // A second row of clippings: "why people pick you" takes two rows at a
  // smaller size, so the wall still ends above the foot.
  const twoRows = used + examples.length > CLIP_COLS;
  // Stop 2 lifts "why people pick you"; the clippings step back.
  const clipLook: Look = tour >= 1 ? "dim" : undefined;
  return (
    <Wall ctx={ctx} slide="competitors">
      <Head
        ctx={ctx}
        id="competitors"
        sub={t(BP.competitors.ask, lang)}
        width={1100}
      />
      {/* The clippings, then why people pick them instead under them,
          one column: the card follows the clippings' rows (score round 3:
          a 190 px empty band between them). */}
      <div
        className="dkb-at dkb-rivals"
        style={at({ x: 120, y: 268, w: 1680, h: 692 })}
      >
        <ul
          className="dkb-clips"
          aria-label={t(BP.competitors.head, lang)}
          style={{ "--cols": cols } as CSSProperties}
        >
          {shown.map((n, i) => (
            <Clipping
              key={n.name}
              ctx={ctx}
              n={n}
              i={i}
              names={names}
              save={save}
              look={clipLook}
            />
          ))}
          {adding ? (
            // The next name is typed on a blank clipping waiting to be
            // pinned: a pencilled line, no box.
            <li
              className="dkb-clip dkb-clip-add dkb-pin"
              data-live=""
              data-typing={draft ? "" : undefined}
              {...lookOf(clipLook)}
              style={{ "--i": Math.min(shown.length, 6) } as CSSProperties}
            >
              <Tape x={150} y={-14} w={96} i={Math.min(shown.length, 6)} />
              {draft ? null : (
                <span className="dkb-example dkb-clip-eg">
                  {t(BP.tag.example, lang)}
                </span>
              )}
              <div className="dkb-clip-paper">
                {/* The field's label: a click on the struck example puts
                    the caret in the field under it. */}
                <label className="dkb-clip-type">
                  {draft ? null : (
                    <s className="dkb-clip-name" aria-hidden>
                      {t(next.name, lang)}
                    </s>
                  )}
                  <input
                    dir={draft ? "auto" : lang === "ar" ? "rtl" : "ltr"}
                    value={draft}
                    aria-label={t(BP.competitors.add, lang)}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        add();
                      } else if (e.key === "Escape") e.currentTarget.blur();
                    }}
                    onBlur={add}
                  />
                </label>
                <span className="dkb-clip-kicker">
                  {t(BP.competitors.note, lang)}
                </span>
                {draft ? null : (
                  <s className="dkb-clip-note" aria-hidden>
                    {t(next.note, lang)}
                  </s>
                )}
              </div>
            </li>
          ) : null}
          {/* Example clippings, ours, in full ink, each labelled Example
              (score round 1 of the design pass: faded, they read as
              disabled). */}
          {examples.map((g, i) => (
            <li
              key={g.name.en}
              className="dkb-clip dkb-clip-ghost dkb-pin"
              {...lookOf(clipLook)}
              style={
                {
                  "--i": Math.min(used + i, 6),
                  "--r": `${[-0.6, 0.5, -0.4, 0.6, -0.5][i]}deg`,
                } as CSSProperties
              }
              aria-hidden
            >
              <Tape x={56} y={-14} w={96} i={Math.min(used + i, 6)} />
              <span className="dkb-example dkb-clip-eg">
                {t(BP.tag.example, lang)}
              </span>
              <div className="dkb-clip-paper">
                <p className="dkb-clip-name">{t(g.name, lang)}</p>
                <span className="dkb-clip-kicker">
                  {t(BP.competitors.note, lang)}
                </span>
                <p className="dkb-clip-note">{t(g.note, lang)}</p>
              </div>
            </li>
          ))}
          {more > 0 ? (
            <li className="dkb-clip-more">
              {tf(BP.competitors.more, lang, { n: digits(more, lang) })}
            </li>
          ) : null}
        </ul>
        {/* On the wall from the first stop, stepped back; the second stop
            lifts it: what they do differently, in their words. */}
        <Card
          box={{ x: 0, y: 0, i: 4 }}
          flow
          live
          className="dkb-why"
          look={tour >= 1 ? "active" : "dim"}
        >
          <Tape x={300} y={-14} w={130} />
          <p className="dkb-card-label">{t(BP.competitors.whyUs, lang)}</p>
          <Ruled
            ctx={ctx}
            k="why_us"
            size={twoRows ? "side" : "live"}
            minRows={1}
            maxRows={twoRows ? 2 : 3}
            cap={twoRows ? 3 : undefined}
            label={t(BP.competitors.whyUs, lang)}
            prompt={<Prompt lang={lang}>{t(BP.prompt.together, lang)}</Prompt>}
          />
        </Card>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 9 offer

/**
 * The kraft offer tag: its five ingredients as a checklist, never blank
 * dashes. Each line has a hole punched in the tag (score round 1 of the
 * design pass: radio circles read as a form); a line the record already
 * holds (the offer's name and first step from the draft, the price the ads
 * point to from slide 7) is written on the tag, its hole ticked in pen;
 * the rest are said to be in the offer sheet.
 */
function OfferTag({
  ctx,
  box,
  draft,
  look,
}: {
  ctx: Ctx;
  box: Box;
  draft: boolean;
  look?: Look;
}) {
  const { lang, bp } = ctx;
  const a: Answers = bp?.answers ?? {};
  const offer = (a.offer ?? {}) as Record<string, unknown>;
  // In the tag's order: the pattern, its name, the bonuses, the price, the first step.
  const values: (string | null)[] = [
    null,
    str(offer.name),
    null,
    moneyOf(a.anchor, lang),
    str(offer.firstStep),
  ];
  return (
    <figure
      className="dkb-tag dkb-pin"
      data-draft={draft ? "" : undefined}
      style={at(box)}
      {...lookOf(look)}
    >
      <span className="dkb-tag-hole" aria-hidden />
      <span className="dkb-cord" aria-hidden />
      <p className="dkb-tag-kind">{t(BP.frames.offer.name, lang)}</p>
      <ol className="dkb-tag-lines">
        {BP.offer.lines.map((l, n) => {
          const v = values[n];
          return (
            <li key={l.en} data-set={v ? "" : undefined}>
              {/* A line the record holds: the pen tick in place of its hole
                  (score round 2 of the design pass: the hole showed
                  through the tick); else the hole, the wall through it. */}
              <span
                className="dkb-punch"
                data-set={v ? "" : undefined}
                aria-hidden
              >
                {v ? <PenTick /> : null}
              </span>
              <span className="dkb-tag-name">{t(l, lang)}</span>
              {/* An open ring is the ingredient's name alone; the foot says
                  once where the rest is (score round 2). */}
              {v ? (
                <span className="dkb-tag-value" dir="auto">
                  <bdi>{v}</bdi>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <figcaption className="dkb-tag-foot">
        {values.some(v => !v) ? (
          <span className="dkb-tag-rest">{t(BP.offer.restInSheet, lang)}</span>
        ) : null}
        <span>{t(BP.offer.foot, lang)}</span>
      </figcaption>
    </figure>
  );
}

function Offer({ ctx }: { ctx: Ctx }) {
  const { lang, tour } = ctx;
  return (
    <Wall ctx={ctx} slide="offer">
      <Head ctx={ctx} id="offer" width={760} />
      {/* The lead, its middle on the tag's (score round 1 of the design
          pass: a card for the offer sheet, empty but for ruled lines, sat
          under it); stop 2 says the sheet is opened now, while its own
          window is shared, and the tag lifts. */}
      <div
        className="dkb-at dkb-offer-lede"
        style={at({ x: 120, y: 500, w: 740 })}
      >
        <p key={tour >= 1 ? "sheet" : "draft"} className="dkb-lead dkb-arrive">
          {t(tour >= 1 ? BP.offer.sheetLead : BP.offer.lead, lang)}
        </p>
      </div>
      {/* The tag's height is its words' (760 at least): its foot is never
          cut by its own clip-path (score round 2, Arabic). */}
      {/* A quarter larger and toward the wall's middle (score round 2 of
          the design pass: the left half stood empty beside a small tag). */}
      <div
        className="dkb-at dkb-offer-tag"
        style={at({ x: 960, y: 40, w: 720 })}
      >
        <span className="dkb-tack" aria-hidden />
        <OfferTag
          ctx={ctx}
          box={{ x: 0, y: 40, w: 720, r: 0.8, i: 0 }}
          draft
          look={tour >= 1 ? "active" : undefined}
        />
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 10 how ads work

function HowAds({ ctx }: { ctx: Ctx }) {
  const { lang, tour, bp } = ctx;
  const H = BP.howAds;
  const approval = bp?.answers.approval as
    | "every"
    | "first_batch"
    | "run_then_show"
    | undefined;
  const editable = Boolean(bp && !bp.readOnly) && tour >= 2;
  const first = useRef(approval);
  const fresh = approval !== first.current;
  // The roll of tape comes on only for the unroll itself, the step from
  // the first stop to the second (score round 2 of the design pass: parked
  // at the strip's start from the first stop it meant nothing yet, Hallmark
  // gate 45, and a fast second step left it over "Day 60"). A step back to
  // the second stop finds the tape already unrolled, with no roll.
  const last = useRef({ tour, unroll: false });
  if (last.current.tour !== tour)
    last.current = { tour, unroll: last.current.tour === 0 && tour === 1 };
  const unroll = last.current.unroll;
  // The argument lands in its order (score round 1 of the design pass: the
  // curves drew into empty space, the conclusion came before its premises):
  // the referral, the ad, the curves, the client, the conclusion, the tape,
  // then the choices.
  return (
    <Wall ctx={ctx} slide="how-ads-work">
      <Head ctx={ctx} id="how-ads-work" width={1100} />
      {/* The launch deck's two roads, as paper strips on the wall: a
          referral and an ad, each with its trust line, both ending at the
          same client. */}
      <div
        className="dkb-at dkb-roads"
        data-step={tour}
        style={at({ x: 120, y: 236, w: 1680, h: 300 })}
      >
        <svg
          className="dkb-road-join"
          viewBox="0 0 220 236"
          aria-hidden
          style={at({ x: 1080, y: 0, w: 220, h: 236, i: 2 })}
        >
          <path d="M0 52 C 120 52, 110 118, 220 118" />
          <path d="M0 184 C 120 184, 110 118, 220 118" />
        </svg>
        <div
          className="dkb-road dkb-pin"
          style={at({ x: 0, y: 0, w: 1080, h: 104, r: -0.3, i: 0 })}
        >
          <b>{t(H.friend, lang)}</b>
          <span>{t(H.friendWhy, lang)}</span>
        </div>
        <div
          className="dkb-road dkb-pin"
          style={at({ x: 0, y: 132, w: 1080, h: 104, r: 0.3, i: 1 })}
        >
          <b>{t(H.ad, lang)}</b>
          <span>{t(H.adWhy, lang)}</span>
        </div>
        <Card
          box={{ x: 1300, y: 44, w: 380, h: 148, r: 0.5, i: 3 }}
          className="dkb-client-card"
        >
          <Tape x={130} y={-14} w={120} />
          <p className="dkb-client-name">{t(H.client, lang)}</p>
        </Card>
        {/* On the strips' edge (x 120), as the wall's other lines are
            (score round 2 of the design pass: 40 px in, it lined up with
            nothing). */}
        <p className="dkb-same dkb-at" style={at({ x: 0, y: 262, w: 1680 })}>
          <span className="dkb-arrive" style={{ "--i": 4 } as CSSProperties}>
            {t(H.same, lang)}
          </span>
        </p>
      </div>
      {/* The first weeks: a strip of kraft tape unrolled along its line
          on the second stop, its roll travelling ahead of it and gone at
          its end (transform and opacity only). A second step before it
          ends lands it at once. */}
      {unroll ? (
        <span
          className="dkb-learn-roll dkb-at"
          aria-hidden
          style={at({ x: 120, y: 586, w: 96, h: 96 })}
        />
      ) : null}
      <div
        className="dkb-learn dkb-pin"
        data-rolled={tour < 1 ? "" : undefined}
        data-landed={tour >= 2 ? "" : undefined}
        style={at({ x: 120, y: 586, w: 1680, h: 92, r: -0.4, i: 5 })}
      >
        <span className="dkb-learn-ticks" aria-hidden />
        <span className="dkb-mono">{t(H.learnStart, lang)}</span>
        <b>{t(H.learn, lang)}</b>
        <span className="dkb-mono">{t(H.learnEnd, lang)}</span>
      </div>
      {/* How they approve their own ads: three paper tabs held in one clip
          (score round 1 of the design pass: radio cards with a teal ring
          read as a web form). Their pick is pulled up out of the clip and
          its name circled in pen; on the wall from the first stop,
          stepped back until the third. */}
      <div
        className="dkb-at dkb-tabs"
        {...lookOf(tour < 2 ? "dim" : undefined)}
        style={at({ x: 120, y: 716, w: 1680, h: 244 })}
      >
        <p
          className="dkb-wall-label dkb-arrive"
          style={{ "--i": 6 } as CSSProperties}
        >
          {t(H.approveHead, lang)}
        </p>
        {(["every", "first_batch", "run_then_show"] as const).map((v, n) => {
          const on = approval === v;
          const body = (
            <>
              <b className="dkb-pen-opt" data-picked={on ? "" : undefined}>
                <span className="dkb-pen-word">
                  {t(H.approvals[v].title, lang)}
                </span>
                {on ? <PenRing fresh={fresh} seed={n} /> : null}
              </b>
              <span>{t(H.approvals[v].line, lang)}</span>
            </>
          );
          const box = at({ x: n * 570, y: 50, w: 540, h: 192, i: 6 });
          return ctx.bp ? (
            <button
              key={v}
              type="button"
              className="dkb-card dkb-pin dkb-tab dkb-approve"
              data-picked={on ? "" : undefined}
              aria-pressed={on}
              disabled={!editable}
              style={box}
              onClick={e => {
                bp?.set("approval", on ? null : v, { now: true });
                letGo(e);
              }}
            >
              {body}
            </button>
          ) : (
            <div
              key={v}
              className="dkb-card dkb-pin dkb-tab dkb-approve"
              data-picked={on ? "" : undefined}
              style={box}
            >
              {body}
            </div>
          );
        })}
        <span
          className="dkb-clip-bar dkb-arrive"
          aria-hidden
          style={{ "--i": 6 } as CSSProperties}
        >
          <i />
          <i />
        </span>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 11 brand

/**
 * The material board (the Studio Wall's, score round 3): four swatches cut
 * close from their own project photos, else from the example renders of
 * their service, each named by the material it shows and the board
 * labelled Example.
 */
function MaterialBoard({ ctx, box }: { ctx: Ctx; box: Box }) {
  const { d, lang } = ctx;
  const { own, swatches } = swatchesFor(d, serviceOf(ctx));
  return (
    <figure className="dkb-board dkb-materials dkb-pin" style={at(box)}>
      <figcaption className="dkb-board-head">
        {t(own ? BP.brand.materials : BP.brand.materialsExample, lang)}
      </figcaption>
      <ul className="dkb-swatch-grid">
        {swatches.map((sw, n) => (
          <li key={`${sw.url}${sw.at}`} data-n={n}>
            <span
              className="dkb-swatch-img"
              style={{
                backgroundImage: `url("${sw.url}")`,
                backgroundSize: sw.size,
                backgroundPosition: sw.at,
              }}
            />
            {sw.name ? (
              <span className="dkb-swatch-name">{t(sw.name, lang)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * A type specimen: "Aa", their name in Latin and in Arabic, set in the
 * deck's own faces (never a client face), so always an example pairing;
 * what their Brand DNA doc says about type, under it, when it says.
 */
function Specimen({
  ctx,
  box,
  small = false,
}: {
  ctx: Ctx;
  box: Box;
  small?: boolean;
}) {
  const { d, lang, bp } = ctx;
  // Their doc names a serif for the wordmark: "Aa" and their name are set
  // in a serif, the rest in the deck's Geist, and it is said to follow
  // the doc (score round 2 of the design pass: an example grotesque beside
  // a doc naming a serif contradicted it). Else the deck's own pairing,
  // an example.
  const serif = wordmarkSerif(brandType(bp?.docs.brandDna));
  return (
    <div
      className="dkb-card dkb-specimen dkb-pin"
      data-small={small ? "" : undefined}
      data-serif={serif ? "" : undefined}
      style={at(box)}
    >
      {small ? null : <Tape x={84} y={-14} w={100} r={0.6} />}
      <span className="dkb-aa" aria-hidden dir="ltr">
        Aa
      </span>
      <span className="dkb-spec-en" dir="ltr">
        {d.nameEn}
      </span>
      {d.nameAr ? (
        <span className="dkb-spec-ar" lang="ar" dir="rtl">
          {d.nameAr}
        </span>
      ) : null}
      <span className="dkb-spec-foot">
        {t(serif ? BP.brand.pairingDoc : BP.brand.pairing, lang)}
      </span>
    </div>
  );
}

/** Their Brand DNA doc's type line names a serif (not a sans serif) for their wordmark or display. */
function wordmarkSerif(type: string | null): boolean {
  if (!type) return false;
  return /(?<!sans[- ]?)\bserif\b|سيريف|خط مذيل/i.test(type);
}

/** Their colours as named paint chips, with their codes; an example set until their doc has some. */
function paletteOf(ctx: Ctx): {
  theirs: boolean;
  chips: { hex: string; name: string | null }[];
} {
  const theirs = brandPalette(ctx.bp?.docs.brandDna);
  return theirs.length
    ? { theirs: true, chips: theirs }
    : {
        theirs: false,
        chips: EXAMPLE_PALETTE.map(c => ({
          hex: c.hex,
          name: t(c.name, ctx.lang),
        })),
      };
}

function Palette({ ctx, box }: { ctx: Ctx; box: Box }) {
  const { lang, bp } = ctx;
  const { theirs, chips } = paletteOf(ctx);
  return (
    <figure className="dkb-card dkb-palette dkb-pin" style={at(box)}>
      <Tape x={86} y={-14} w={100} r={-0.5} />
      <ul aria-label={t(BP.brand.colours, lang)}>
        {chips.map(c => (
          <li
            key={c.hex}
            style={{ "--chip": c.hex } as CSSProperties}
            data-ink={chipInk(c.hex)}
          >
            <b dir="auto">{c.name ?? ""}</b>
            <span className="dkb-mono">{c.hex.slice(1)}</span>
          </li>
        ))}
      </ul>
      <figcaption className="dkb-palette-foot">
        {theirs ? (
          <Mark bp={bp} lang={lang} from="dna" />
        ) : (
          t(BP.brand.paletteExample, lang)
        )}
      </figcaption>
    </figure>
  );
}

/** Their logo as a print; with none verified, a blank print waiting for it. */
function LogoPrint({ ctx, box }: { ctx: Ctx; box: Box }) {
  const { d, lang } = ctx;
  const logo = d.logo;
  return logo ? (
    <figure className="dkb-print dkb-pin dkb-logo-print" style={at(box)}>
      <img src={logo.url} alt="" draggable={false} />
      <figcaption className="dkb-prov">{t(BP.cover.logo, lang)}</figcaption>
    </figure>
  ) : (
    <figure
      className="dkb-print dkb-pin dkb-logo-print"
      data-empty=""
      style={at(box)}
    >
      <span className="dkb-crop" aria-hidden />
      <figcaption className="dkb-logo-wait">
        {t(BP.brand.logoMissing, lang)}
      </figcaption>
    </figure>
  );
}

/** Their Brand DNA doc, as a page pinned beside the look: where the rest is kept. */
function DnaNote({ ctx, box }: { ctx: Ctx; box: Box }) {
  const { lang, bp } = ctx;
  const has = brandColours(bp?.docs.brandDna).length > 0;
  // What the doc says about type, as written, under its title.
  const type = brandType(bp?.docs.brandDna);
  return (
    <div className="dkb-card dkb-dna-note dkb-pin" style={at(box)}>
      <Tape x={86} y={-14} w={96} r={0.5} />
      <p className="dkb-doc">
        <span className="dkb-doc-glyph" aria-hidden />
        {t(BP.brand.dnaDoc, lang)}
      </p>
      {type ? (
        // The label alone, in the deck's language; their doc's own words
        // on their own line, in their own direction (score round 1 of the
        // design pass: one Arabic sentence with an English clause in it
        // broke the reading order).
        <p className="dkb-dna-type">
          <span className="dkb-dna-type-head">
            {t(BP.brand.typeHead, lang)}
          </span>
          <span className="dkb-dna-type-own" dir="auto">
            {type}
          </span>
        </p>
      ) : null}
      <p className="dkb-quiet-print">
        {t(has ? BP.brand.dnaLine : BP.brand.dnaOpen, lang)}
      </p>
    </div>
  );
}

/**
 * The read-back's look, small: the specimen, their colours named (an
 * example set until their doc has some, so labelled) and two swatches.
 */
function LookMini({ ctx, box }: { ctx: Ctx; box: Box }) {
  const { d, lang } = ctx;
  const { theirs, chips } = paletteOf(ctx);
  const { own, swatches } = swatchesFor(d, serviceOf(ctx));
  return (
    <div className="dkb-look-mini dkb-pin" style={at(box)}>
      {d.logo ? (
        <span className="dkb-mini-aa" data-logo="">
          <img
            src={d.logo.url}
            alt={t(BP.cover.logo, lang)}
            draggable={false}
          />
        </span>
      ) : (
        <span className="dkb-mini-aa" aria-hidden dir="ltr">
          Aa
        </span>
      )}
      <ul className="dkb-mini-chips" aria-label={t(BP.brand.colours, lang)}>
        {chips.map(c => (
          <li
            key={c.hex}
            style={{ "--chip": c.hex } as CSSProperties}
            data-ink={chipInk(c.hex)}
          >
            <b dir="auto">{c.name ?? c.hex.slice(1)}</b>
          </li>
        ))}
      </ul>
      <span className="dkb-mini-swatches" aria-hidden>
        {swatches.slice(0, 2).map(sw => (
          <span
            key={`${sw.url}${sw.at}`}
            style={{
              backgroundImage: `url("${sw.url}")`,
              backgroundSize: sw.size,
              backgroundPosition: sw.at,
            }}
          />
        ))}
      </span>
      {/* What is not theirs is labelled where it sits (their logo, else
          the deck's own "Aa"; the colours; the swatches); all three
          examples, one label for the board. */}
      {!d.logo && !theirs && !own ? (
        <span
          className="dkb-example dkb-mini-eg"
          style={{ "--at": "500px" } as CSSProperties}
        >
          {t(BP.tag.example, lang)}
        </span>
      ) : (
        (
          [
            [Boolean(d.logo), "84px"],
            [theirs, "204px"],
            [own, "500px"],
          ] as const
        ).map(([mine, x]) =>
          mine ? null : (
            <span
              key={x}
              className="dkb-example dkb-mini-eg"
              style={{ "--at": x } as CSSProperties}
            >
              {t(BP.tag.example, lang)}
            </span>
          ),
        )
      )}
    </div>
  );
}

function Brand({ ctx }: { ctx: Ctx }) {
  const { lang, bp } = ctx;
  const rules = (bp?.answers.rules ?? {}) as Record<string, unknown>;
  // Never starts from the red lines they agreed on slide 2, so they are not
  // asked twice; the first change here keeps them as this list.
  const red = lines(bp?.answers.red_lines);
  const seeded = !lines(rules.never).length && red.length > 0;
  // Still the onboarding call's lines (seeded, or copied over unchanged):
  // their source stays that call until a line is changed here.
  const fromRed =
    red.length > 0 && (seeded || sameValue(lines(rules.never), red));
  const list = (k: "always" | "never" | "neverShow") =>
    k === "never" && seeded ? red : lines(rules[k]);
  const setRule = (k: "always" | "never" | "neverShow", next: string[]) => {
    const out: Record<string, string[]> = {
      always: list("always"),
      never: list("never"),
      neverShow: list("neverShow"),
      [k]: next,
    };
    for (const key of Object.keys(out)) if (!out[key].length) delete out[key];
    bp?.set("rules", Object.keys(out).length ? out : null, { now: true });
  };
  const cols = [
    { k: "always" as const, l: BP.brand.always },
    { k: "never" as const, l: BP.brand.never },
    { k: "neverShow" as const, l: BP.brand.neverShow },
  ];
  const none = cols.every(c => !list(c.k).length) && !afterCall(bp);
  const redCount = list("never").filter(l =>
    red.some(r => r.trim().toLowerCase() === l.trim().toLowerCase()),
  ).length;
  const redLabel =
    redCount === 1
      ? t(BP.brand.redFrom.one, lang)
      : tf(BP.brand.redFrom.many, lang, { n: digits(redCount, lang) });
  return (
    <Wall ctx={ctx} slide="brand">
      <Head ctx={ctx} id="brand" width={1100} />
      {/* The cover's promise kept (score round 3): their look as the
          Studio Wall had it, materials, type and named colours, their
          logo and the doc that keeps the rest; beside it the three short
          lists, the red lines said once. */}
      {/* The frame is the board's height, so its corner tape holds the
          board (score round 1 of the design pass: it hung 50 px under it,
          on the felt); its label lands with the board. */}
      <Frame
        ctx={ctx}
        kind="look"
        box={{ x: 120, y: 290, w: 1060, h: 620, i: 0 }}
      >
        <MaterialBoard
          ctx={ctx}
          box={{ x: 0, y: 0, w: 430, h: 620, r: 0.4, i: 0 }}
        />
        <Specimen ctx={ctx} box={{ x: 470, y: 8, w: 290, r: -0.8, i: 1 }} />
        <Palette ctx={ctx} box={{ x: 476, y: 356, w: 284, i: 2, r: 0.6 }} />
        <LogoPrint
          ctx={ctx}
          box={{ x: 798, y: 6, w: 262, h: 190, r: 0.8, i: 3 }}
        />
        <DnaNote ctx={ctx} box={{ x: 798, y: 286, w: 262, r: -0.5, i: 4 }} />
      </Frame>
      {/* The three lists, as chips. Nothing on any of them yet: one card,
          each list a dashed chip saying they are added together (score
          round 2 of the design pass: three empty boxes read as
          textareas). After the call, only the lists that hold lines. */}
      <div
        className="dkb-at dkb-stack dkb-rules"
        style={at({ x: 1220, y: 246, w: 580 })}
      >
        {(none
          ? [cols]
          : (afterCall(bp) ? cols.filter(c => list(c.k).length) : cols).map(
              c => [c],
            )
        ).map((group, n) => (
          <Card
            key={group.map(c => c.k).join()}
            box={{ x: 0, y: 0, i: n + 3 }}
            flow
            live
            className="dkb-rule-card"
            attrs={{ "data-fold": none ? "" : undefined }}
          >
            {group.map(c => (
              <div key={c.k} className="dkb-rule-list">
                <p className="dkb-card-label">
                  {t(c.l, lang)}
                  {c.k === "never" ? (
                    fromRed ? (
                      <Mark bp={bp} k="red_lines" lang={lang} />
                    ) : (
                      <Mark bp={bp} k="rules" lang={lang} />
                    )
                  ) : null}
                </p>
                <LinesField
                  ctx={ctx}
                  list={list(c.k)}
                  show={4}
                  chips
                  kind={c.k}
                  label={t(c.l, lang)}
                  addLabel={BP.brand.add}
                  empty={
                    <span className="dkb-chip-wait">
                      {t(BP.prompt.add, lang)}
                    </span>
                  }
                  fold={
                    c.k === "never" && redCount
                      ? { lines: red, label: redLabel }
                      : undefined
                  }
                  onChange={next => setRule(c.k, next)}
                />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 12 content

function Content({ ctx }: { ctx: Ctx }) {
  const { lang, bp, d, tour } = ctx;
  const dates = datesOf(ctx);
  const ticked = bp?.answers.shot_list === true;
  const day = dayShort(dates.shots, lang, tz(d));
  const camera = bp?.answers.camera as
    | "yes_studio"
    | "yes_phone"
    | "no"
    | "unsure"
    | undefined;
  // One layout on both stops (nothing jumps between them): the four shots
  // across the top; under them the camera question and the due sticky.
  // Their Drive folder opens from the notes window, in its own window
  // (score round 1 of the design pass: a white button on the canvas).
  return (
    <Wall ctx={ctx} slide="content">
      <Head ctx={ctx} id="content" width={1100} />
      {BP.content.shots.map((s, n) => (
        <Shot
          key={s.en}
          ctx={ctx}
          n={n}
          small
          box={{
            x: 120 + n * 430,
            y: n % 2 ? 262 : 250,
            w: 390,
            h: 336,
            r: n % 2 ? 0.8 : -0.8,
            i: n,
          }}
        />
      ))}
      {/* Will they be on camera: a paper card, its four answers small
          paper chips in a row, theirs circled in pen (score round 2 of the
          design pass: four options on an amber card read as a radio
          question, and amber is the client's to-do alone). On the wall
          from the first stop, sunk until the second. */}
      <Card
        box={{ x: 120, y: 676, w: 1040, i: 4 }}
        className="dkb-camera-card"
        look={tour < 1 ? "dim" : "active"}
      >
        <Tape x={140} y={-14} w={120} r={-0.4} />
        <p className="dkb-card-label dkb-camera-head">
          {t(BP.content.cameraHead, lang)}
        </p>
        <PenChoice
          ctx={ctx}
          value={camera}
          waiting={tour < 1}
          chips
          className="dkb-camera"
          label={t(BP.content.cameraHead, lang)}
          options={(["yes_studio", "yes_phone", "no", "unsure"] as const).map(
            v => ({ v, label: t(BP.content.camera[v], lang) }),
          )}
          onPick={v => bp?.set("camera", v, { now: true })}
        />
      </Card>
      <Sticky box={{ x: 1240, y: 684, w: 560, r: 0.9, i: 5 }}>
        <b className="dkb-due">
          {ticked
            ? tf(BP.content.due, lang, { day })
            : t(BP.content.dueLater, lang)}
        </b>
        <span>{t(BP.content.dueHint, lang)}</span>
      </Sticky>
    </Wall>
  );
}

// ------------------------------------------------------------ 13 read-back

/** Starter ads are on unless they were declined: one answer for slides 13 and 14. */
const starterOn = (a: Answers) => a.starter !== "no";

function ReadBack({ ctx }: { ctx: Ctx }) {
  const { lang, bp, d } = ctx;
  const a: Answers = bp?.answers ?? {};
  const offer = (a.offer ?? {}) as Record<string, string | undefined>;
  const setOffer = (k: "name" | "what" | "firstStep", v: string) => {
    const next = { ...offer, [k]: v };
    bp?.set("offer", next);
  };
  const method = firstLine(a.method, 110);
  const who = firstClause(a.best_client, 64);
  const minimum = moneyOf(a.minimum, lang);
  const anchor = moneyOf(a.anchor, lang);
  const dates = datesOf(ctx);
  const day = dayShort(dates.shots, lang, tz(d));
  const T = BP.readBack.table;
  const editable = Boolean(bp && !bp.readOnly) && !afterCall(bp);
  // Nothing of the offer typed yet (score round 1 of the design pass: an
  // unfilled form of placeholders and empty rows): the paper shows only
  // what exists, and a large amber note says where it is finished. Its
  // first words are typed in the notes window (3.1); the headline and the
  // rows then come onto the paper, live.
  const blank = !(
    offer.name?.trim() ||
    offer.what?.trim() ||
    offer.firstStep?.trim()
  );
  // A row shows when it holds words, or while the offer is being typed on
  // a seat that can type it.
  const row = (v: string | null | undefined) =>
    Boolean(v?.trim()) || (editable && !blank);
  const rows = (
    [
      ["who", T.who, who],
      ["what", T.what, offer.what],
      ["first", T.first, offer.firstStep],
    ] as const
  ).filter(([, , v]) => row(v));
  return (
    <Wall ctx={ctx} slide="read-back">
      <Head ctx={ctx} id="read-back" width={1100} />
      {/* The wall, full: the cover's three frames, each now the client's
          own paper (the label on its edge, tape only where paper meets
          felt), assembled from the small map that followed the call. The
          offer's paper is as tall as its rows, the money under it. */}
      <div
        className="dkb-at dkb-stack dkb-rb-col"
        style={at({ x: 120, y: 236, w: 960 })}
      >
        {/* Nothing of the offer yet, not even who it is for: the open
            frame and its note, no paper (score round 2 of the design
            pass: a 960 x 580 white card holding one sticky). */}
        <Frame
          ctx={ctx}
          kind="offer"
          box={{ x: 0, y: 0, i: 0 }}
          assemble={0}
          flow
          holds={
            blank && !rows.length ? (
              <Sticky big box={{ x: 0, y: 0, r: -0.8, i: 2 }} flow>
                {t(BP.readBack.finish, lang)}
              </Sticky>
            ) : undefined
          }
        >
          {blank && !rows.length ? null : (
            <div
              className="dkb-feature dkb-pin dkb-flow"
              data-live=""
              data-blank={blank ? "" : undefined}
              style={at({ x: 0, y: 0, i: 1 })}
            >
              {!blank ? (
                <Ruled
                  ctx={ctx}
                  size="feature"
                  one
                  minRows={1}
                  label={t(BP.readBack.name, lang)}
                  value={offer.name ?? ""}
                  onChange={v => setOffer("name", v)}
                />
              ) : null}
              {rows.length ? (
                <dl className="dkb-table">
                  {rows.map(([k, label, v]) => (
                    <div key={k}>
                      <dt>{t(label, lang)}</dt>
                      {k === "who" ? (
                        <dd dir="auto">
                          <bdi>{v ?? ""}</bdi>
                        </dd>
                      ) : (
                        <dd>
                          <Ruled
                            ctx={ctx}
                            size="line"
                            one
                            minRows={1}
                            label={t(label, lang)}
                            value={v ?? ""}
                            onChange={x =>
                              setOffer(k === "what" ? "what" : "firstStep", x)
                            }
                            prompt={
                              <Prompt lang={lang}>
                                {t(BP.prompt.now, lang)}
                              </Prompt>
                            }
                          />
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              ) : null}
              {blank ? (
                <Sticky big box={{ x: 0, y: 0, r: -0.8, i: 2 }} flow>
                  {t(BP.readBack.finish, lang)}
                </Sticky>
              ) : null}
            </div>
          )}
        </Frame>
        {/* Two short ruled lines: the money, then the ads. */}
        <ul className="dkb-money">
          {minimum ? (
            <li className="dkb-arrive" style={{ "--i": 5 } as CSSProperties}>
              {anchor
                ? tf(BP.readBack.money, lang, { minimum, anchor })
                : tf(BP.readBack.moneyMin, lang, { minimum })}
            </li>
          ) : null}
          {/* One answer for the read-back and slide 14 (score round 3:
              unset, one said "your own ads" and the next "starter ads go
              live"): starter ads unless they declined them. */}
          <li className="dkb-arrive" style={{ "--i": 6 } as CSSProperties}>
            {starterOn(a)
              ? t(BP.readBack.starter, lang)
              : t(BP.readBack.own, lang)}
          </li>
        </ul>
      </div>
      {/* Their words on their own paper, as slide 6 pinned them; still
          blank, the open frame holds an amber note saying where it is
          written, never a grey placeholder or a blank card (score round 2
          of the design pass). */}
      <Frame
        ctx={ctx}
        kind="words"
        box={{ x: 1140, y: 236, w: 660, h: 260, i: 2 }}
        assemble={1}
        holds={
          method ? undefined : (
            <Sticky flow box={{ x: 0, y: 0, r: 0.8, i: 4 }}>
              {t(BP.readBack.wordsSoon, lang)}
            </Sticky>
          )
        }
      >
        {method ? (
          <div
            className="dkb-card dkb-pin dkb-words-card"
            style={at({ x: 0, y: 0, w: 660, h: 260, i: 3 })}
          >
            <p className="dkb-words-line" dir="auto">
              <bdi>{method}</bdi>
            </p>
          </div>
        ) : null}
      </Frame>
      <Frame
        ctx={ctx}
        kind="look"
        box={{ x: 1140, y: 556, w: 660, h: 260, i: 3 }}
        assemble={2}
      >
        <LookMini ctx={ctx} box={{ x: 0, y: 0, w: 660, h: 260, i: 4 }} />
      </Frame>
      <Sticky box={{ x: 1440, y: 822, w: 360, r: -0.8, i: 6 }}>
        {a.shot_list === true
          ? tf(BP.readBack.shots, lang, { day })
          : t(BP.readBack.shotsSoon, lang)}
      </Sticky>
    </Wall>
  );
}

// ------------------------------------------------------------ 14 next

function Next({ ctx }: { ctx: Ctx }) {
  const { lang, bp, d, tour } = ctx;
  const a: Answers = bp?.answers ?? {};
  const dates = datesOf(ctx);
  const day = (v: string) => dayShort(v, lang, tz(d));
  // On a card's head the month is short in English ("Sun 25 Oct").
  const head = (v: string) =>
    lang === "en" ? day(v).replace(/(\d+) (\w{3})\w*$/, "$1 $2") : day(v);
  const starter = starterOn(a);
  // Part 1 is said to be sent only once Send to media went (the record's
  // part 1, done, or this call's press): never from the slide's order.
  const p1 = bp?.parts["1"];
  const sent = Boolean(
    bp?.stamp || (p1 && p1.status === "done" && (p1.firstAt || p1.lastAt)),
  );
  const N = BP.next;
  const cards: {
    key: string;
    when: string;
    line: L;
    yours?: boolean;
    now?: boolean;
  }[] = [
    {
      key: "sent",
      when: `${t(N.today, lang)}${lang === "ar" ? "، " : " · "}${head(dates.call).replace(/^\S+ /, "")}`,
      line: !sent
        ? N.cards.unsent
        : starter
          ? N.cards.sent
          : N.cards.sentNoStarter,
      now: true,
    },
    { key: "offer", when: head(dates.offer), line: N.cards.offer },
    { key: "shots", when: head(dates.shots), line: N.cards.shots, yours: true },
    ...(starter
      ? [{ key: "live", when: t(N.when.ready, lang), line: N.cards.live }]
      : []),
    // Not booked yet: headed "Launch call", its line what the call is for
    // (score round 2 of the design pass: "To book" said what the booking
    // card under it says).
    {
      key: "launch",
      when: dates.launch ? head(dates.launch) : t(N.when.launch, lang),
      line: dates.launch ? N.cards.launch : N.cards.launchOpen,
    },
  ];
  const w = 300;
  const gap = (1680 - cards.length * w) / (cards.length - 1);
  return (
    <Wall ctx={ctx} slide="next">
      <Head ctx={ctx} id="next" width={1100} />
      <p className="dkb-legend dkb-at" style={at({ x: 120, y: 262 })}>
        <i aria-hidden />
        {t(BP.legend, lang)}
      </p>
      {/* The line hangs lower (score round 1 of the design pass: the lower
          third stood empty), from the wall's margin to its margin (score
          round 2: it started at x 98), and the launch call's frame waits
          under it from the first stop. */}
      <svg
        className="dkb-line"
        viewBox="0 0 1680 80"
        aria-hidden
        style={at({ x: 120, y: 366, w: 1680, h: 80 })}
      >
        <path d="M0 10 Q 840 70 1680 10" />
      </svg>
      {/* Each card is pegged as the string's draw reaches its peg (the
          string runs from x 120 over 1680 px), never before (score round
          2: the first card hung from nothing). */}
      {/* Stop 2: the launch card is lifted off its peg (straight, 8 px
          up), never ringed like a focused control (score round 1 of the
          design pass). */}
      {cards.map((c, n) => (
        <figure
          key={c.key}
          className="dkb-card dkb-pin dkb-when"
          data-yours={c.yours ? "" : undefined}
          data-lifted={tour >= 1 && c.key === "launch" ? "" : undefined}
          style={at(
            {
              x: 120 + n * (w + gap),
              y: 426 + (n % 2 ? 22 : 0),
              w,
              h: 270,
              r: [0.6, -0.5, 0.4, -0.6, 0.5][n],
              i: n,
            },
            {
              "--sx": ((n * (w + gap) + w / 2) / 1680).toFixed(3),
            },
          )}
        >
          <span className="dkb-peg" aria-hidden />
          <p className="dkb-when-d" data-now={c.now ? "" : undefined}>
            {c.when}
          </p>
          <p className="dkb-when-l">{t(c.line, lang)}</p>
        </figure>
      ))}
      {/* The launch call: on the first stop an open frame waits under the
          line with its name (score round 2 of the design pass: a sunk card
          with big bold words read as a disabled control); its stop pins
          the card into it. */}
      {tour >= 1 ? (
        <Card
          box={{ x: 560, y: 772, w: 800, h: 180, i: 0 }}
          live
          className="dkb-call-card"
          look="active"
        >
          <Tape x={290} y={-14} w={140} />
          <p className="dkb-card-label">{t(N.callHead, lang)}</p>
          {/* Not booked yet: said as what we do now, together, never as a
              button's label (score round 1 of the design pass). */}
          <p className="dkb-booked">
            {dates.launch
              ? tf(N.booked, lang, {
                  when: `${day(dates.launch)}${lang === "ar" ? "، " : ", "}${clock(dates.launch, lang, tz(d))}`,
                })
              : t(N.book, lang)}
          </p>
        </Card>
      ) : (
        <div
          className="dkb-at dkb-call-wait"
          style={at({ x: 560, y: 772, w: 800, h: 180, i: 0 })}
        >
          <span className="dkb-outline" aria-hidden>
            <i data-edge="top" />
            <i data-edge="end" />
            <i data-edge="bottom" />
            <i data-edge="start" />
          </span>
          <p className="dkb-call-wait-name">{t(N.callHead, lang)}</p>
        </div>
      )}
    </Wall>
  );
}

// ------------------------------------------------------------ the deck

const stops = (id: BpSlideId) => () =>
  (BP_STOPS as Partial<Record<BpSlideId, readonly L[]>>)[id]?.length ?? 1;
const stopName = (id: BpSlideId) => (i: number) =>
  (BP_STOPS as Partial<Record<BpSlideId, readonly L[]>>)[id]?.[i] ?? null;

function def(
  id: BpSlideId,
  render: (ctx: Ctx) => ReactNode,
  extra: Partial<SlideDef> = {},
): SlideDef {
  return {
    id,
    title: BP_TITLES[id],
    notes: BP_NOTES[id],
    stops: stops(id),
    stopName: stopName(id),
    render,
    ...extra,
  };
}

/** The 14 slides (SPEC 5.2), in the run sheet's order. */
export function blueprintSlides(): SlideDef[] {
  return [
    def("cover", ctx => <Cover ctx={ctx} />, {
      cover: true,
      titleOf: d => ({ en: d.nameEn, ar: d.nameAr ?? d.nameEn }),
    }),
    def("so-far", ctx => <SoFar ctx={ctx} />, {
      missing: d =>
        shownGoals(d).some(g => g.key === "goal90")
          ? []
          : ["No 90-day goal on the onboarding form: the card asks for it."],
    }),
    def("today", ctx => <RunSheet ctx={ctx} />),
    // Nothing lit and no two asked: the park has nothing to move, so the
    // slide is one stop until a strip is tapped (score round 3: a dead
    // click). Unread (prep, the overview), it has its two.
    def("one-service", ctx => <OneService ctx={ctx} />, {
      stops: ctx =>
        !ctx?.bp ||
        ctx.bp.answers.service ||
        (ctx.bp.prefill?.twoServices?.length ?? 0) > 1
          ? 2
          : 1,
    }),
    def("first-ads", ctx => <FirstAds ctx={ctx} />, {
      todo: () => ["Press Send to media before you leave this slide."],
    }),
    def("best-at", ctx => <BestAt ctx={ctx} />),
    def("pricing", ctx => <Pricing ctx={ctx} />),
    def("competitors", ctx => <Competitors ctx={ctx} />),
    def("offer", ctx => <Offer ctx={ctx} />, {
      todo: () => [
        "Open the offer sheet in its own window and write your draft in it before the call.",
      ],
    }),
    def("how-ads-work", ctx => <HowAds ctx={ctx} />),
    def("brand", ctx => <Brand ctx={ctx} />),
    def("content", ctx => <Content ctx={ctx} />),
    def("read-back", ctx => <ReadBack ctx={ctx} />),
    def("next", ctx => <Next ctx={ctx} />, {
      todo: () => [
        "Book the launch call. After you hang up, press Close the call in the wrap-up.",
      ],
    }),
  ];
}

/** The minutes each slide is given, in the deck's order (they add up to 45). */
export const blueprintMinutes = () =>
  blueprintSlides().map(s => BP_MINUTES[s.id as BpSlideId]);
