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
import { digits, type L, type Lang, SERVICES, SHARED, t, tf } from "./content";
import { clock, dayMonth, dayShort } from "./dates";
import type { SlideCtx, SlideDef } from "./deckContext";
import { type DeckData, shownGoals } from "./deckData";
import {
  exampleCreative,
  SCENES,
  sceneAt,
  type Theme,
  tileUrl,
  warmExamples,
} from "./examples";
import { FbFeed, IgFeed, Phone, ReelStory } from "./mockups/Phones";
import { who } from "./onboardingDeck";
import { openNamed } from "./PresentButton";
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
}: {
  box: Box;
  live?: boolean;
  className?: string;
  children: ReactNode;
  label?: string;
  tag?: "div" | "section" | "figure";
  /** In a stack: placed by the stack, its height by its words. */
  flow?: boolean;
}) {
  const Tag = tag;
  return (
    <Tag
      className={`dkb-card dkb-pin${flow ? " dkb-flow" : ""}${className ? ` ${className}` : ""}`}
      data-live={live ? "" : undefined}
      style={at(live ? { ...box, r: 0 } : box)}
      aria-label={label}
    >
      {children}
    </Tag>
  );
}

function Sticky({
  box,
  children,
  flow = false,
}: {
  box: Box;
  children: ReactNode;
  /** In a column: placed by it, its height its words'. */
  flow?: boolean;
}) {
  return (
    <p
      className={`dkb-sticky dkb-pin${flow ? " dkb-flow" : ""}`}
      style={at(box)}
    >
      {children}
    </p>
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
}: {
  ctx: Ctx;
  k?: BpKey;
  size?: "live" | "small" | "feature" | "line" | "side";
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
}) {
  const bp = ctx.bp;
  const value =
    valueIn ??
    (k && typeof bp?.answers[k] === "string" ? (bp.answers[k] as string) : "");
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
  if (!editable)
    return (
      <p
        ref={ref as never}
        className="dkb-ruled"
        data-size={size}
        data-rows={Math.min(shown, 6)}
        data-long={long ?? undefined}
        data-fit={fit ?? undefined}
        dir="auto"
      >
        <bdi>{value}</bdi>
      </p>
    );
  return (
    <textarea
      ref={ref as never}
      className="dkb-ruled"
      data-size={size}
      data-long={long ?? undefined}
      data-fit={fit ?? undefined}
      placeholder={placeholder}
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
}

/**
 * A list of short lines (red lines, the rules): each line as written, and
 * "Add a line" typed live on one more ruled row (no box, score round 2: a
 * boxed web input pulled the wall back toward a form); Enter adds it. The
 * presenter can take a line off with its small cross, shown on hover.
 * `quietAt`: from this many lines the add row is out of sight, its room
 * kept, until the presenter's pointer is over the list or it has focus. `rest`: two more empty rules
 * under the add row, at most (the card's room reads as room for more).
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
  quietAt,
  rest = false,
}: {
  ctx: Ctx;
  list: string[];
  onChange: (next: string[]) => void;
  addLabel: L;
  quietAt?: number;
  rest?: boolean;
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
  const quiet = quietAt != null && list.length >= quietAt;
  const visible = show ? list.slice(0, show) : list;
  const more = list.length - visible.length;
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (!list.some(x => x.toLowerCase() === s.toLowerCase()))
      onChange([...list, s].slice(0, max));
    setDraft("");
  };
  return (
    <div className="dkb-lines" data-kind={kind}>
      <ul aria-label={label}>
        {visible.map(l => (
          // Each line takes its own direction: an English line in the
          // Arabic deck reads left to right, its mark on its left. A plain
          // span, never bdi: dir="auto" skips a bdi's words.
          <li key={l} dir="auto">
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
              ? `و${digits(more, lang)} غيرها`
              : `and ${more} more`}
          </li>
        ) : null}
      </ul>
      {editable && list.length < max ? (
        <input
          className="dkb-add"
          data-quiet={quiet ? "" : undefined}
          // Empty, the placeholder takes the deck's direction (dir="auto"
          // with no words resolves to left to right); typed, its own.
          dir={draft ? "auto" : lang === "ar" ? "rtl" : "ltr"}
          value={draft}
          placeholder={t(addLabel, lang)}
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
      {rest ? <span className="dkb-lines-rest" aria-hidden /> : null}
    </div>
  );
}

/**
 * One of a few cards the client picks from, like a radio: each has its
 * ring at the start, the pick fills it teal and lights the card's edge,
 * and the others step back.
 */
function Pick({
  ctx,
  box,
  lit,
  onPick,
  children,
  className,
  waiting = false,
}: {
  ctx: Ctx;
  box: Box;
  lit: boolean;
  onPick: () => void;
  children: ReactNode;
  className?: string;
  /** Shown ahead of its stop: half strength, not tappable yet. */
  waiting?: boolean;
}) {
  const editable = Boolean(ctx.bp && !ctx.bp.readOnly) && !waiting;
  return (
    <button
      type="button"
      className={`dkb-card dkb-pin dkb-pick${className ? ` ${className}` : ""}`}
      style={at(box)}
      data-lit={lit ? "" : undefined}
      data-wait={waiting ? "" : undefined}
      aria-pressed={lit}
      disabled={!editable}
      onClick={e => {
        onPick();
        letGo(e);
      }}
    >
      <span className="dkb-radio" data-on={lit ? "" : undefined} aria-hidden />
      <span className="dkb-pick-in">{children}</span>
    </button>
  );
}

function Tick() {
  return (
    <span className="dkb-tick" aria-hidden>
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
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
  const placeholder = tf(BP.pricing.eg, lang, {
    amount: moneyText(EXAMPLE_AMOUNT[currency][k], currency, lang),
  });
  if (!editable)
    return (
      <p className="dkb-amount" dir="auto" data-empty={shown ? undefined : ""}>
        {shown || placeholder}
      </p>
    );
  return (
    <input
      className="dkb-amount"
      dir={(draft ?? shown) ? "auto" : lang === "ar" ? "rtl" : "ltr"}
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
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
  );
}

// ------------------------------------------------------------ the frames

type FrameKind = "words" | "look" | "offer";

/**
 * One of the wall's three frames (your words, your look, your offer). Empty
 * (the cover, a read-back still waiting): a pale paper mount with a dashed
 * well, named by its label, its hint in the well, taped where the mount
 * meets the felt. Filled (slides 6, 11 and 13): no mount and no outline;
 * the client's own paper is the frame, the label stuck on its top edge and
 * the tape across its corners (`tape={false}` where the words sit on the
 * wall itself, with no paper to hold).
 */
function Frame({
  ctx,
  kind,
  box,
  children,
  hint = true,
  tape = true,
  assemble,
}: {
  ctx: Ctx;
  kind: FrameKind;
  box: Box;
  children?: ReactNode;
  hint?: boolean;
  tape?: boolean;
  /** The read-back: the frame grows out of the wall's map, in this order. */
  assemble?: number;
}) {
  const f = BP.frames[kind];
  const i = box.i ?? 0;
  const filled = Boolean(children);
  return (
    <section
      className="dkb-frame dkb-at"
      data-kind={kind}
      data-filled={filled ? "" : undefined}
      data-assemble={assemble != null ? "" : undefined}
      style={
        assemble != null
          ? ({
              ...at(box),
              ...fromMap(kind),
              "--k": assemble,
            } as CSSProperties)
          : at(box)
      }
      aria-label={t(f.name, ctx.lang)}
    >
      {filled ? null : (
        <span
          className="dkb-mount dkb-pin"
          aria-hidden
          style={{ "--i": i } as CSSProperties}
        >
          <span className="dkb-mount-well" />
        </span>
      )}
      {/* Empty: across the mount's top-start and bottom-end corners.
          Filled: the label holds the top-start, so the tape takes the
          top-end and bottom-start. */}
      {tape && !filled ? (
        <>
          <Tape x={-30} y={-12} w={110} r={-0.8} i={i} />
          <Tape x={-30} y={-14} w={110} r={0.6} i={i} from="bottom-end" />
        </>
      ) : tape ? (
        <>
          <Tape x={-30} y={-12} w={110} r={0.7} i={i} from="top-end" />
          <Tape x={-30} y={-14} w={110} r={-0.6} i={i} from="bottom-start" />
        </>
      ) : null}
      <Dymo box={filled ? { x: 28, y: -30, i } : { x: 24, y: 24, i }}>
        {t(f.name, ctx.lang)}
      </Dymo>
      {filled ? (
        <div className="dkb-frame-in">{children}</div>
      ) : hint ? (
        <p className="dkb-hint" style={{ "--i": i } as CSSProperties}>
          {t(f.hint, ctx.lang)}
        </p>
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
  // The presenter's first name, when the record has it and the seat is the
  // creative director's (a CSM reading the deck is not the presenter);
  // else the role alone.
  const presenter = ctx.bp && !ctx.bp.readOnly ? d.csmFirst : null;
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
      </div>
      {/* The three frames, waiting: one tight cluster, 60 px gutters
          (words over offer at 1000; look, and the logo under it, at 1500). */}
      <Frame
        ctx={ctx}
        kind="words"
        box={{ x: 1000, y: 140, w: 440, h: 290, i: 0 }}
      />
      <Frame
        ctx={ctx}
        kind="look"
        box={{ x: 1500, y: 140, w: 300, h: logo ? 400 : 620, i: 1 }}
      />
      <Frame
        ctx={ctx}
        kind="offer"
        box={{ x: 1000, y: 490, w: 440, h: 270, i: 2 }}
      />
      {logo ? (
        <figure
          className="dkb-print dkb-pin dkb-cover-logo"
          style={at({ x: 1500, y: 600, w: 300, h: 260, r: 0.8, i: 4 })}
        >
          <img src={logo.url} alt="" draggable={false} />
          <figcaption className="dkb-prov">{t(BP.cover.logo, lang)}</figcaption>
        </figure>
      ) : null}
      <Sticky box={{ x: 1000, y: 820, w: 440, r: -0.9, i: 3 }}>
        {t(BP.cover.sticky, lang)}
      </Sticky>
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
    <Card box={{ x: 1010, y: 280, w: 790, h: 170, i: 2 }} className="dkb-svc">
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
          <span className="dkb-quiet-print">{t(BP.soFar.noService, lang)}</span>
        )}
      </div>
    </Card>
  );
}

function SoFar({ ctx }: { ctx: Ctx }) {
  const { d, lang, bp } = ctx;
  const goal = shownGoals(d).find(g => g.key === "goal90");
  const red = lines(bp?.answers.red_lines);
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
      <Card
        box={{ x: 120, y: 280, w: 790, h: 320, r: -0.6, i: 0 }}
        className="dkb-goal"
      >
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
      <Card
        box={{ x: 120, y: 630, w: 790, h: 336, i: 1 }}
        live
        className="dkb-clients"
      >
        <p className="dkb-card-label">
          {t(BP.soFar.clients, lang)}{" "}
          <Mark bp={bp} k="best_client" lang={lang} />
        </p>
        <Ruled
          ctx={ctx}
          k="best_client"
          size="small"
          minRows={3}
          maxRows={3}
          label={t(BP.soFar.clients, lang)}
        />
      </Card>
      <ServiceChip ctx={ctx} />
      <Card
        box={{ x: 1010, y: 480, w: 790, h: 486, i: 3 }}
        live
        className="dkb-never"
      >
        <p className="dkb-card-label">
          {t(BP.soFar.never, lang)} <Mark bp={bp} k="red_lines" lang={lang} />
        </p>
        <LinesField
          ctx={ctx}
          list={red}
          show={5}
          kind="plain"
          rest
          label={t(BP.soFar.never, lang)}
          addLabel={BP.soFar.addLine}
          onChange={next =>
            bp?.set("red_lines", next.length ? next : null, { now: true })
          }
        />
      </Card>
      {/* Stuck on the service card's end corner, clear of its words. */}
      <Sticky box={{ x: 1540, y: 214, w: 300, r: 0.9, i: 4 }}>
        {t(BP.soFar.sticky, lang)}
      </Sticky>
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
      {/* The rules run from the sheet's first row (y 285) to its foot (y
          990), one ruled third each, so no void sits under the title
          (score round 2). */}
      <Card
        box={{ x: 120, y: 285, w: 580, h: 705, r: 0.8, i: 2 }}
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
        box={{ x: 760, y: 120, w: 1040, h: 870, r: 0.6, i: 0 }}
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
      <Card
        box={{ x: 1120, y: 250, w: 680, r: 0.8, i: 6 }}
        className="dkb-kraft dkb-parked"
        label={t(BP.oneService.parked, lang)}
      >
        <Tape x={270} y={-14} w={140} />
        <p className="dkb-card-label">{t(BP.oneService.parked, lang)}</p>
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
          <p className="dkb-quiet-print">{t(BP.oneService.parkedNone, lang)}</p>
        )}
      </Card>
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
 * as ads, in the three phones the launch deck draws (the feed, Reels, the
 * Facebook feed), with the example pictures of the lit service and its
 * name as the headline, each tagged "Example ad". The real pack (a Drive
 * folder) is never framed on the canvas: the notes window opens it in its
 * own window, and so does "Open the pack" here once there is a link.
 */
function PackPhones({ ctx }: { ctx: Ctx }) {
  const { d, lang } = ctx;
  const service = serviceOf(ctx);
  const scenes = scenesOf(ctx);
  const pick = { scenes };
  // With no selling line of theirs, an example caption of ours (the
  // phones' "Example ad" tag covers it), never the app's empty next-post
  // skeleton, which read as still loading (score round 2).
  const words = {
    primary:
      d.exampleWords.primary ??
      tf(BP.firstAds.caption, lang, {
        service: t(SERVICES[service].name, lang),
      }),
    headline: t(SERVICES[service].name, lang),
  };
  const phones = [
    {
      key: "feed",
      Ad: IgFeed,
      creative: exampleCreative(sceneAt(pick, 0), "feed", words, lang),
      label: SHARED.frame.feed,
      mark: "instagram" as const,
    },
    {
      key: "reels",
      Ad: ReelStory,
      creative: exampleCreative(sceneAt(pick, 1), "story", words, lang),
      label: SHARED.frame.reels,
      mark: "instagram" as const,
    },
    {
      key: "facebook",
      Ad: FbFeed,
      creative: exampleCreative(sceneAt(pick, 2), "feed", words, lang),
      label: SHARED.frame.facebook,
      mark: "facebook" as const,
    },
  ];
  const identity = who(d);
  return (
    <div
      className="dkb-at dkb-ads"
      style={at({ x: 780, y: 196, w: 1020, h: 740 })}
    >
      {phones.map(({ key, Ad, creative, label, mark }, n) => (
        <figure
          key={key}
          className="dkb-ad dkb-arrive"
          style={{ "--i": n + 1 } as CSSProperties}
        >
          <span className="dkb-prov dkb-ad-tag">
            {t(BP.tag.exampleAd, lang)}
          </span>
          <Phone height={600} label={t(label, lang)}>
            <Ad
              creative={creative}
              who={identity}
              pageName={d.pageName}
              app={lang}
              deck={lang}
            />
          </Phone>
          <figcaption className="dkb-ad-foot">
            <Logo mark={mark} size={26} />
            {t(label, lang)}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Stop 1's start column: what the pack is, then "Open the pack" once there is a link. */
function PackWords({ ctx }: { ctx: Ctx }) {
  const { bp, lang } = ctx;
  // The lit service only: until slide 4's pick is on record the line says
  // "your service", so it never names one slide 4 is still asking about
  // (the phones beside keep their example pictures, tagged).
  const lit = bp?.answers.service as BpService | undefined;
  const url =
    str(bp?.answers.pack_url) ?? str(bp?.prefill.values.pack_url?.value);
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
            style={{ "--i": n + 1 } as CSSProperties}
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
      {url ? (
        // The last to arrive, after the three lines it follows.
        <button
          type="button"
          className="dkb-button dkb-arrive"
          style={{ "--i": BP.firstAds.pack.length + 1 } as CSSProperties}
          onClick={e => {
            openNamed(url, `mahara-pack-${ctx.d.taskId}`);
            letGo(e);
          }}
        >
          {t(BP.firstAds.open, lang)}
        </button>
      ) : null}
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
  const src = tileUrl(scene, "a");
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
          <img src={src} alt="" draggable={false} />
        )}
        {n === 0 ? (
          // Talking to camera: someone framed in the viewfinder over the
          // room, never an empty room (score round 2).
          <>
            <svg className="dkb-sitter" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="40" r="14" />
              <path d="M20 100c0-21 13-37 30-37s30 16 30 37z" />
            </svg>
            <i className="dkb-viewfinder" aria-hidden>
              <b />
            </i>
          </>
        ) : null}
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

/** The parts of the form, as the slide lists them: done, now, later. */
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
              {done ? <Tick /> : digits(n, lang)}
            </span>
            <span>
              <b>{t(BP.parts[n], lang)}</b>
              <small>
                {n === 1 && !done
                  ? t(BP.firstAds.partsNow[1], lang)
                  : n === 2 && !done
                    ? t(BP.firstAds.partsNext[2], lang)
                    : t(BP.firstAds.partsDone[n], lang)}
              </small>
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
  const editable = Boolean(bp && !bp.readOnly);
  const starter = a.starter as "yes" | "no" | undefined;
  const red = lines(a.red_lines);
  const n = privateCount(a);
  const fold = foldKey(n);
  const seg = (v: "yes" | "no") => (
    <button
      type="button"
      aria-pressed={starter === v}
      disabled={!editable}
      onClick={e => {
        bp?.set("starter", v, { now: true });
        letGo(e);
      }}
    >
      {t(BP.firstAds[v], lang)}
    </button>
  );
  return (
    // The sheet's height is its words' (at least 820), and the two blank
    // sheets behind follow it; no tabs, since the parts list beside it
    // already names the three parts (score round 2).
    <div
      className="dkb-at dkb-sheet-stack"
      style={at({ x: 760, y: 120, w: 1040 })}
    >
      <span className="dkb-sheet-back" data-n="2" aria-hidden />
      <span className="dkb-sheet-back" data-n="1" aria-hidden />
      <section
        className="dkb-sheet dkb-pin dkb-flow"
        data-live=""
        style={at({ x: 0, y: 0, w: 1040, i: 1 })}
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
              <span className="dkb-quiet-print">
                {t(BP.oneService.none, lang)}
              </span>
            )}
          </span>
        </div>
        <div className="dkb-field">
          <span className="dkb-field-label">
            {t(BP.firstAds.starter, lang)}
          </span>
          <Mark bp={bp} k="starter" lang={lang} />
          <span className="dkb-field-ans">
            <span className="dkb-seg">
              {seg("yes")}
              {seg("no")}
            </span>
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
            {/* One of three, so a segmented control like Yes / No. */}
            <span className="dkb-field-ans">
              <span className="dkb-seg" data-three="">
                {(["on_call", "before", "wants_changes"] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={a.pack_approval === v}
                    disabled={!editable}
                    onClick={e => {
                      bp?.set(
                        "pack_approval",
                        a.pack_approval === v ? null : v,
                        { now: true },
                      );
                      letGo(e);
                    }}
                  >
                    {t(BP.firstAds.approvals[v], lang)}
                  </button>
                ))}
              </span>
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
              <ul className="dkb-redlist">
                {red.slice(0, 4).map(l => (
                  <li key={l} dir="auto">
                    <span>{whole(l)}</span>
                  </li>
                ))}
                {red.length > 4 ? (
                  <li className="dkb-more">
                    {lang === "ar"
                      ? `و${digits(red.length - 4, lang)} غيرها`
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
            <PackPhones ctx={ctx} />
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
  return (
    <Wall ctx={ctx} slide="best-at">
      <Head ctx={ctx} id="best-at" width={1100} />
      <Frame ctx={ctx} kind="words" box={{ x: 120, y: 290, w: 1060, i: 0 }}>
        <Card box={{ x: 0, y: 0, i: 1 }} flow live className="dkb-method">
          <p className="dkb-struck">
            <s dir="auto">
              <bdi>{before ?? t(BP.bestAt.struck, lang)}</bdi>
            </s>
            <span className="dkb-example">
              {t(before ? BP.tag.before : BP.tag.example, lang)}
            </span>
          </p>
          <p className="dkb-card-label">
            {t(BP.bestAt.method, lang)}{" "}
            <Mark bp={ctx.bp} k="method" lang={lang} />
          </p>
          {/* Seven ruled rows from the start: the card's foot meets the
              right column's last card (y 948) on every stop, so no dead
              quarter opens under it (score round 2). */}
          <Ruled
            ctx={ctx}
            k="method"
            minRows={7}
            maxRows={7}
            label={t(BP.bestAt.method, lang)}
            onLeave={leave}
          />
        </Card>
      </Frame>
      {/* A paper copy, 600 wide at 40 px, lifts off the card for its
          first 300 ms (large enough to be seen), then flies small into the
          map (score round 2: a thin strip few noticed). */}
      {fly ? (
        <p
          className="dkb-fly"
          aria-hidden
          dir="auto"
          style={
            {
              ...at({ x: 144, y: 440 }),
              "--tx": px(MAP.x + words.x * MAP.s - 144),
              "--ty": px(MAP.y + words.y * MAP.s - 440),
            } as CSSProperties
          }
        >
          <bdi>{fly}</bdi>
        </p>
      ) : null}
      {/* The stack keeps inside y 290 to 966: each card two rows, then the
          words step down to 26 px (five rows for the clients they want,
          three for the others), then once more if still longer. The
          clients they want sit beside the method from the first stop. */}
      <div
        className="dkb-at dkb-stack"
        style={at({ x: 1220, y: 290, w: 580, h: 676 })}
      >
        <Card box={{ x: 0, y: 0, i: 2 }} flow live className="dkb-side">
          <p className="dkb-card-label">
            {t(BP.bestAt.clients, lang)}{" "}
            <Mark bp={ctx.bp} k="best_client" lang={lang} />
          </p>
          <Ruled
            ctx={ctx}
            k="best_client"
            size="side"
            minRows={1}
            maxRows={2}
            cap={5}
            label={t(BP.bestAt.clients, lang)}
          />
        </Card>
        {/* The next two cards are on the wall from the first stop, at
            half strength until their stop (score round 2: the frames sized
            to the slide's final layout, so no quarter stands empty). */}
        <Card
          box={{ x: 0, y: 0, i: 3 }}
          flow
          live
          className={`dkb-side${tour < 1 ? " dkb-wait" : ""}`}
        >
          <p className="dkb-card-label">{t(BP.bestAt.notFor, lang)}</p>
          <Ruled
            ctx={ctx}
            k="not_for"
            size="side"
            minRows={1}
            maxRows={2}
            cap={3}
            label={t(BP.bestAt.notFor, lang)}
          />
        </Card>
        <Card
          box={{ x: 0, y: 0, i: 4 }}
          flow
          live
          className={`dkb-side${tour < 2 ? " dkb-wait" : ""}`}
        >
          <p className="dkb-card-label">{t(BP.bestAt.cityCant, lang)}</p>
          <Ruled
            ctx={ctx}
            k="city_cant"
            size="side"
            minRows={1}
            maxRows={2}
            cap={3}
            label={t(BP.bestAt.cityCant, lang)}
          />
        </Card>
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 7 pricing

/**
 * Slide 7's steel tape (SPEC 5.3), drawn to the numbers: it runs from
 * nothing at the start to a round number past the highest, the smallest
 * project and where the ads point each a mark at its value with the
 * value on a flag above it, and the range typed for most projects a
 * shaded band with its two numbers. The numbers are typed in the cards
 * under the tape; the tape only draws them.
 */
function PriceTape({ ctx }: { ctx: Ctx }) {
  const { lang, bp, d } = ctx;
  const num = (k: "minimum" | "anchor") => {
    const v = bp?.answers[k] as { amount?: unknown } | undefined;
    return typeof v?.amount === "number" ? v.amount : null;
  };
  const typedMin = num("minimum");
  const typedAnchor = num("anchor");
  const band = bandOf(bp?.answers.pricing);
  // Until a first amount is typed, the tape carries the cards' own example
  // amounts as ghost marks, tagged Example, so the ruler shows what it is
  // for (score round 2: an empty ruler meant nothing).
  const ghost = typedMin == null && typedAnchor == null && !band;
  const ex = EXAMPLE_AMOUNT[currencyFor(d.country)];
  const minimum = ghost ? ex.minimum : typedMin;
  const anchor = ghost ? ex.anchor : typedAnchor;
  const marks = tapeMarks({ minimum, anchor, band });
  const F = BP.pricing.flags;
  const W = 1680;
  const px0 = 24;
  const len = W - px0 * 2;
  const xOf = (share: number) => px0 + share * len;
  // A flag reads toward the tape's middle, so the one near either end
  // never runs off it.
  const side = (share: number) => (share > 0.62 ? "start" : "end");
  // The flags never cross (the shot run's text checks found the smallest
  // project's flag on "Most projects" when the range sat close to it, and
  // the range's two numbers on each other in a narrow band). Widths are
  // estimated from the words, at the flags' sizes.
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
  const mostW = wide(mostText, 24);
  const minAt = marks?.minimum != null ? xOf(marks.minimum) : 0;
  const minW =
    minimum != null
      ? wide(shortAmount(minimum, lang), 32) + 12 + wide(t(F.minimum, lang), 24)
      : 0;
  const clear = (a: [number, number], b: [number, number]) =>
    a[1] + 24 <= b[0] || b[1] + 24 <= a[0];
  const mostSpan: [number, number] = [mostAt - mostW / 2, mostAt + mostW / 2];
  const minSpan = (sd: "start" | "end"): [number, number] =>
    sd === "end"
      ? [minAt + 14, minAt + 14 + minW]
      : [minAt - 14 - minW, minAt - 14];
  let minSide: "start" | "end" =
    marks?.minimum != null ? side(marks.minimum) : "end";
  if (marks?.band && !clear(minSpan(minSide), mostSpan)) {
    const other = minSide === "end" ? "start" : "end";
    const [a, b] = minSpan(other);
    if (a >= 0 && b <= W && clear([a, b], mostSpan)) minSide = other;
  }
  // Still crossing: "Most projects" rises to a second lane above.
  const mostHigh = Boolean(marks?.band) && !clear(minSpan(minSide), mostSpan);
  return (
    <div
      className="dkb-at dkb-tape-wrap"
      data-ghost={ghost ? "" : undefined}
      style={at({ x: 120, y: 220, w: W, h: 230 })}
    >
      {ghost ? (
        <span className="dkb-example dkb-tape-eg">
          {t(BP.tag.example, lang)}
        </span>
      ) : null}
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
                "--b": px(xOf(Math.max(marks.band[1], marks.band[0] + 0.004))),
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
        {marks && minimum != null && marks.minimum != null ? (
          <span
            className="dkb-tape-mark"
            data-kind="minimum"
            style={{ "--m": px(xOf(marks.minimum)) } as CSSProperties}
          />
        ) : null}
        {marks && anchor != null && marks.anchor != null ? (
          <span
            className="dkb-tape-mark"
            data-kind="anchor"
            data-low={marks.band ? "" : undefined}
            style={{ "--m": px(xOf(marks.anchor)) } as CSSProperties}
          />
        ) : null}
      </div>
      {marks && minimum != null && marks.minimum != null ? (
        <p
          className="dkb-flag dkb-arrive"
          data-kind="minimum"
          data-side={minSide}
          style={{ "--m": px(xOf(marks.minimum)), "--i": 1 } as CSSProperties}
        >
          <span>
            <b>{shortAmount(minimum, lang)}</b>
            {t(F.minimum, lang)}
          </span>
        </p>
      ) : null}
      {marks?.band && band ? (
        <p
          className="dkb-flag dkb-arrive"
          data-kind="most"
          data-side="mid"
          data-high={mostHigh ? "" : undefined}
          style={
            {
              "--m": px(mostAt),
              "--i": 2,
            } as CSSProperties
          }
        >
          <span>{mostText}</span>
        </p>
      ) : null}
      {marks && anchor != null && marks.anchor != null ? (
        <p
          className="dkb-flag dkb-arrive"
          data-kind="anchor"
          data-side={side(marks.anchor)}
          data-low={marks.band ? "" : undefined}
          style={{ "--m": px(xOf(marks.anchor)), "--i": 3 } as CSSProperties}
        >
          <span>
            <b>{shortAmount(anchor, lang)}</b>
            {t(F.anchor, lang)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Pricing({ ctx }: { ctx: Ctx }) {
  const { lang, bp, tour } = ctx;
  const minimum = moneyOf(bp?.answers.minimum, lang);
  const M = BP.pricing.marks;
  return (
    <Wall ctx={ctx} slide="pricing">
      <Head ctx={ctx} id="pricing" width={1100} />
      <PriceTape ctx={ctx} />
      {/* Two rows on one grid (score round 2: the cards were off-grid):
          the three top cards share the tallest one's height, the second
          row's two share one top, and nothing is turned. The rows follow
          each other, so a third row of words never runs into the next. */}
      <div
        className="dkb-at dkb-price-rows"
        style={at({ x: 120, y: 490, w: 1680 })}
      >
        <div className="dkb-price-row" data-row="1">
          <div
            className="dkb-card dkb-pin dkb-flow dkb-amount-card"
            data-live=""
            style={{ "--i": 2 } as CSSProperties}
          >
            <p className="dkb-card-label">
              {t(M.minimum, lang)} <Mark bp={bp} k="minimum" lang={lang} />
            </p>
            <Amount ctx={ctx} k="minimum" label={t(M.minimum, lang)} />
          </div>
          <Card box={{ x: 0, y: 0, i: 3 }} flow live className="dkb-most">
            <p className="dkb-card-label">
              {t(BP.pricing.pricing, lang)}{" "}
              <Mark bp={bp} k="pricing" lang={lang} />
            </p>
            <Ruled
              ctx={ctx}
              k="pricing"
              size="side"
              minRows={2}
              maxRows={2}
              cap={3}
              label={t(BP.pricing.pricing, lang)}
            />
          </Card>
          <div
            className="dkb-card dkb-pin dkb-flow dkb-amount-card"
            data-live=""
            style={{ "--i": 4 } as CSSProperties}
          >
            <p className="dkb-card-label">
              {t(M.anchor, lang)} <Mark bp={bp} k="anchor" lang={lang} />
            </p>
            <Amount ctx={ctx} k="anchor" label={t(M.anchor, lang)} />
          </div>
        </div>
        {tour >= 1 ? (
          <div className="dkb-price-row" data-row="2">
            <Card box={{ x: 0, y: 0, i: 0 }} flow live className="dkb-terms">
              <p className="dkb-card-label">
                {t(BP.pricing.terms, lang)}{" "}
                <Mark bp={bp} k="terms" lang={lang} />
              </p>
              <Ruled
                ctx={ctx}
                k="terms"
                size="side"
                minRows={2}
                maxRows={2}
                cap={3}
                label={t(BP.pricing.terms, lang)}
              />
            </Card>
            <Card box={{ x: 0, y: 0, i: 1 }} flow className="dkb-filter">
              <p className="dkb-card-label">{t(BP.pricing.filterHead, lang)}</p>
              <p className="dkb-filter-line">
                {tf(BP.pricing.filter, lang, { minimum: minimum ?? "______" })}
              </p>
              <span className="dkb-example">
                {t(BP.tag.exampleWording, lang)}
              </span>
            </Card>
          </div>
        ) : null}
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 8 competitors

type Name = { name: string; lose: boolean };

function Competitors({ ctx }: { ctx: Ctx }) {
  const { lang, bp, tour } = ctx;
  const names = (
    Array.isArray(bp?.answers.competitors)
      ? (bp.answers.competitors as Name[])
      : []
  ).filter(n => n && typeof n.name === "string");
  const editable = Boolean(bp && !bp.readOnly);
  const [draft, setDraft] = useState("");
  const save = (next: Name[]) =>
    bp?.set("competitors", next.length ? next : null, { now: true });
  const add = () => {
    const s = draft.trim();
    if (!s) return;
    if (!names.some(n => n.name.toLowerCase() === s.toLowerCase()))
      save([...names, { name: s, lose: false }].slice(0, 15));
    setDraft("");
  };
  return (
    <Wall ctx={ctx} slide="competitors">
      <Head
        ctx={ctx}
        id="competitors"
        sub={t(BP.competitors.ask, lang)}
        width={1100}
      />
      <ul
        className="dkb-chips dkb-at"
        style={at({ x: 120, y: 300, w: 1680 })}
        aria-label={t(BP.competitors.head, lang)}
      >
        {names.map((n, i) => (
          // Typed live, so straight and flat like all live paper.
          <li
            key={n.name}
            className="dkb-chip dkb-pin"
            data-live=""
            data-lose={n.lose ? "" : undefined}
            style={{ "--i": Math.min(i, 6) } as CSSProperties}
          >
            {/* Pinned like the wall's other paper: one piece of tape, the
                chip itself straight (score round 2). */}
            <Tape x={18} y={-12} w={64} i={Math.min(i, 6)} />
            {editable ? (
              // A tap on the chip marks the ones they lose to, and back.
              <button
                type="button"
                className="dkb-chip-name"
                aria-pressed={n.lose}
                aria-label={`${n.name}: ${t(BP.competitors.lose, lang)}`}
                onClick={e => {
                  save(
                    names.map(x =>
                      x.name === n.name ? { ...x, lose: !x.lose } : x,
                    ),
                  );
                  letGo(e);
                }}
              >
                <bdi dir="auto">{n.name}</bdi>
                {n.lose ? (
                  <span className="dkb-lose">
                    {t(BP.competitors.lose, lang)}
                  </span>
                ) : null}
              </button>
            ) : (
              <>
                <bdi dir="auto">{n.name}</bdi>
                {n.lose ? (
                  <span className="dkb-lose">
                    {t(BP.competitors.lose, lang)}
                  </span>
                ) : null}
              </>
            )}
            {editable ? (
              <span className="dkb-chip-tools">
                <button
                  type="button"
                  aria-label={`Take off: ${n.name}`}
                  onClick={e => {
                    save(names.filter(x => x.name !== n.name));
                    letGo(e);
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </span>
            ) : null}
          </li>
        ))}
        {editable && names.length < 15 ? (
          // The name is typed on a paper strip, never on the felt.
          <li className="dkb-chip-add dkb-pin" data-live="">
            <input
              dir={draft ? "auto" : lang === "ar" ? "rtl" : "ltr"}
              value={draft}
              placeholder={t(BP.competitors.add, lang)}
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
          </li>
        ) : null}
        {/* Until the first name: three ghost chips, ours, marked Example. */}
        {names.length
          ? null
          : BP.competitors.ghosts.map((g, i) => (
              <li
                key={g.en}
                className="dkb-chip-ghost dkb-arrive"
                style={{ "--i": i + 1 } as CSSProperties}
              >
                {t(g, lang)}
              </li>
            ))}
      </ul>
      {/* On the wall from the first stop (the second only lights it), so
          the names never sit over an empty half (score round 2). */}
      <Card
        box={{ x: 120, y: 660, w: 1680, h: 320, i: 4 }}
        live
        className="dkb-why"
      >
        <span className="dkb-why-in" data-lit={tour >= 1 ? "" : undefined}>
          <p className="dkb-card-label">{t(BP.competitors.whyUs, lang)}</p>
          <Ruled
            ctx={ctx}
            k="why_us"
            minRows={3}
            label={t(BP.competitors.whyUs, lang)}
          />
        </span>
      </Card>
    </Wall>
  );
}

// ------------------------------------------------------------ 9 offer

/**
 * The kraft offer tag: its five ingredients as a checklist, never blank
 * dashes. A line the record already holds (the offer's name and first step
 * from the draft, the price the ads point to from slide 7) is written on
 * the tag with a ticked ring; the rest are said to be in the offer sheet.
 */
function OfferTag({ ctx, box, draft }: { ctx: Ctx; box: Box; draft: boolean }) {
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
    >
      <span className="dkb-tag-hole" aria-hidden />
      <span className="dkb-cord" aria-hidden />
      <p className="dkb-tag-kind">{t(BP.frames.offer.name, lang)}</p>
      <ol className="dkb-tag-lines">
        {BP.offer.lines.map((l, n) => {
          const v = values[n];
          return (
            <li key={l.en} data-set={v ? "" : undefined}>
              <span className="dkb-tag-ring" aria-hidden>
                {v ? (
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
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
  const { lang, tour, d } = ctx;
  return (
    <Wall ctx={ctx} slide="offer">
      <Head ctx={ctx} id="offer" width={760} />
      <p
        className="dkb-lead dkb-at"
        style={at({ x: 120, y: 300, w: 700, i: 0 })}
      >
        {t(BP.offer.lead, lang)}
      </p>
      {/* The tag's height is its words' (760 at least): its foot is never
          cut by its own clip-path (score round 2, Arabic). */}
      <div
        className="dkb-at dkb-offer-tag"
        style={at({ x: 1180, y: 110, w: 560 })}
      >
        <span className="dkb-tack" aria-hidden />
        <OfferTag ctx={ctx} box={{ x: 0, y: 40, w: 560, r: 0.8, i: 1 }} draft />
      </div>
      {/* The offer sheet's card is on the wall from the first stop, at
          half strength; stop 2 lights it as its own window is shared, and
          the tag stays lit. Its height is its words' (score round 2: the
          Arabic name took two lines and pushed the last line off the
          card). */}
      <Card
        box={{ x: 120, y: 560, w: 760, r: -0.5, i: 2 }}
        className={`dkb-sheet-card${tour < 1 ? " dkb-wait" : ""}`}
      >
        <Tape x={320} y={-14} w={130} />
        <p className="dkb-doc">
          <span className="dkb-doc-glyph" aria-hidden />
          <bdi dir="auto">
            {tf(BP.offer.sheetTitle, lang, { name: d.name })}
          </bdi>
        </p>
        <p
          className="dkb-quiet-print"
          data-gone={tour < 1 ? "" : undefined}
          aria-hidden={tour < 1 ? true : undefined}
        >
          {t(BP.offer.sheetOpen, lang)}
        </p>
      </Card>
    </Wall>
  );
}

// ------------------------------------------------------------ 10 how ads work

function HowAds({ ctx }: { ctx: Ctx }) {
  const { lang, tour, bp } = ctx;
  const H = BP.howAds;
  const approval = bp?.answers.approval as string | undefined;
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
          style={at({ x: 1080, y: 0, w: 220, h: 236 })}
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
          box={{ x: 1300, y: 44, w: 380, h: 148, r: 0.5, i: 2 }}
          className="dkb-client-card"
        >
          <Tape x={130} y={-14} w={120} />
          <p className="dkb-client-name">{t(H.client, lang)}</p>
        </Card>
        {/* Aligned with the strips' words (x 160), not centred on the
            canvas (score round 2). */}
        <p
          className="dkb-same dkb-at"
          style={at({ x: 40, y: 262, w: 1640, i: 3 })}
        >
          {t(H.same, lang)}
        </p>
      </div>
      {/* The first weeks and the approval are on the wall from the first
          stop, their words at half strength until their stops light them
          (score round 2: stop 1 left the lower half empty). */}
      <div
        className={`dkb-learn dkb-pin${tour < 1 ? " dkb-wait" : ""}`}
        style={at({ x: 120, y: 586, w: 1680, h: 92, r: -0.4, i: 3 })}
      >
        <span className="dkb-learn-ticks" aria-hidden />
        <span className="dkb-mono">{t(H.learnStart, lang)}</span>
        <b>{t(H.learn, lang)}</b>
        <span className="dkb-mono">{t(H.learnEnd, lang)}</span>
      </div>

      <p
        className="dkb-wall-label dkb-at"
        data-wait={tour < 2 ? "" : undefined}
        style={at({ x: 120, y: 728 })}
      >
        {t(H.approveHead, lang)}
      </p>
      {(["every", "first_batch", "run_then_show"] as const).map((v, n) => (
        <Pick
          key={v}
          ctx={ctx}
          box={{
            x: 120 + n * 570,
            y: 778,
            w: 540,
            h: 172,
            r: [0.5, -0.4, 0.6][n],
            i: n,
          }}
          lit={approval === v}
          className="dkb-approve"
          waiting={tour < 2}
          onPick={() =>
            bp?.set("approval", approval === v ? null : v, { now: true })
          }
        >
          <b>{t(H.approvals[v].title, lang)}</b>
          <span>{t(H.approvals[v].line, lang)}</span>
        </Pick>
      ))}
    </Wall>
  );
}

// ------------------------------------------------------------ 11 brand

/**
 * The material board: their logo on a plate and up to four colour chips
 * read from their Brand DNA doc. With no colours on record it is not drawn
 * at all (four dashed chips read as an unfinished template): the DNA card
 * stands in for it.
 */
function Board({
  ctx,
  box,
  small = false,
  flow = false,
}: {
  ctx: Ctx;
  box: Box;
  small?: boolean;
  flow?: boolean;
}) {
  const { lang, d, bp } = ctx;
  const colours = brandColours(bp?.docs.brandDna);
  const logo = d.logo;
  return (
    <figure
      className={`dkb-board dkb-pin${flow ? " dkb-flow" : ""}`}
      data-small={small ? "" : undefined}
      style={at(box)}
    >
      <div className="dkb-board-logo">
        {logo ? (
          <img src={logo.url} alt="" draggable={false} />
        ) : (
          <span className="dkb-quiet-print">
            {t(BP.brand.logoMissing, lang)}
          </span>
        )}
      </div>
      <ul className="dkb-swatches" aria-label={t(BP.brand.colours, lang)}>
        {colours.map(c => (
          <li
            key={c}
            style={{ "--chip": c } as CSSProperties}
            data-ink={chipInk(c)}
          >
            <span className="dkb-mono">{c.slice(1)}</span>
          </li>
        ))}
      </ul>
      {small ? null : (
        <p className="dkb-board-source">
          <Mark bp={bp} lang={lang} from="dna" />
        </p>
      )}
    </figure>
  );
}

/** No colours on record: one paper card, the Brand DNA doc opened together. */
function DnaCard({
  ctx,
  box,
  small = false,
  flow = false,
}: {
  ctx: Ctx;
  box: Box;
  small?: boolean;
  flow?: boolean;
}) {
  const { lang, d, bp } = ctx;
  const logo = d.logo;
  return (
    <div
      className={`dkb-card dkb-pin dkb-dna${flow ? " dkb-flow" : ""}`}
      data-small={small ? "" : undefined}
      style={at(box)}
    >
      {logo && !small ? (
        <div className="dkb-board-logo">
          <img src={logo.url} alt="" draggable={false} />
        </div>
      ) : null}
      <p className="dkb-dna-head">{t(BP.brand.dnaOpen, lang)}</p>
      {bp?.docs.brandDnaUrl ? (
        <p className="dkb-doc">
          <span className="dkb-doc-glyph" aria-hidden />
          <bdi dir="auto">{tf(BP.brand.dnaTitle, lang, { name: d.name })}</bdi>
        </p>
      ) : null}
      {/* What the doc is opened for, one ruled row each, so the card
          carries the board's weight (score round 2). */}
      {small ? null : (
        <ul className="dkb-dna-look" aria-label={t(BP.brand.dnaLine, lang)}>
          {BP.brand.dnaLook.map(l => (
            <li key={l.en}>
              <span className="dkb-tag-ring" aria-hidden />
              {t(l, lang)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Their look: the board when the DNA doc has colours, else the DNA card. */
function Look({
  ctx,
  box,
  small = false,
  flow = false,
}: {
  ctx: Ctx;
  box: Box;
  small?: boolean;
  flow?: boolean;
}) {
  return brandColours(ctx.bp?.docs.brandDna).length ? (
    <Board ctx={ctx} box={box} small={small} flow={flow} />
  ) : (
    <DnaCard ctx={ctx} box={box} small={small} flow={flow} />
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
  return (
    <Wall ctx={ctx} slide="brand">
      <Head ctx={ctx} id="brand" width={1100} />
      {/* One page: their look (the board, or the DNA card) and its three
          lists, all on the slide from the start. */}
      <Frame ctx={ctx} kind="look" box={{ x: 120, y: 290, w: 580, i: 0 }}>
        <Look ctx={ctx} flow box={{ x: 0, y: 0, i: 1 }} />
      </Frame>
      <div
        className="dkb-at dkb-stack"
        style={at({ x: 760, y: 260, w: 1040, h: 706 })}
      >
        {cols.map((c, n) => (
          <Card
            key={c.k}
            box={{ x: 0, y: 0, i: n + 2 }}
            flow
            live
            className="dkb-rule-card"
          >
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
              show={3}
              quietAt={3}
              kind={c.k}
              label={t(c.l, lang)}
              addLabel={BP.brand.add}
              onChange={next => setRule(c.k, next)}
            />
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
  const drive = bp?.docs.driveUrl ?? null;
  const camera = bp?.answers.camera as string | undefined;
  // One layout on both stops (nothing jumps between them): the four
  // shots, their sticky and the folder on top; the camera row's place kept
  // under them and filled on stop 2.
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
            x: 120 + n * 280,
            y: n % 2 ? 268 : 256,
            w: 250,
            h: 300,
            r: n % 2 ? 0.8 : -0.8,
            i: n,
          }}
        />
      ))}
      {/* The sticky is as tall as its words and the folder button sits
          24 px under it, never on it (score round 2: the button hid "A
          phone is fine."). */}
      <div
        className="dkb-at dkb-due-col"
        style={at({ x: 1300, y: 262, w: 380 })}
      >
        <Sticky flow box={{ x: 0, y: 0, r: 0.9, i: 4 }}>
          <b className="dkb-due">
            {ticked
              ? tf(BP.content.due, lang, { day })
              : t(BP.content.dueLater, lang)}
          </b>
          <span>{t(BP.content.dueHint, lang)}</span>
        </Sticky>
        {drive ? (
          <button
            type="button"
            className="dkb-button dkb-arrive"
            style={{ "--i": 5 } as CSSProperties}
            onClick={e => {
              openNamed(drive, `mahara-drive-${d.taskId}`);
              letGo(e);
            }}
          >
            {t(BP.content.folder, lang)}
          </button>
        ) : null}
      </div>
      {/* The camera row is on the wall from the first stop, at half
          strength and not yet tappable; the second stop lights it, so
          nothing appears from nowhere (score round 2). */}
      <div className="dkb-camera-row" data-wait={tour < 1 ? "" : undefined}>
        <p className="dkb-wall-label dkb-at" style={at({ x: 120, y: 650 })}>
          {t(BP.content.cameraHead, lang)}
        </p>
        {(["yes_studio", "yes_phone", "no", "unsure"] as const).map((v, n) => (
          <Pick
            key={v}
            ctx={ctx}
            box={{
              x: 120 + n * 430,
              y: 706,
              w: 390,
              h: 150,
              r: [0.5, -0.4, 0.4, -0.6][n],
              i: n + 5,
            }}
            lit={camera === v}
            className="dkb-camera"
            waiting={tour < 1}
            onPick={() =>
              bp?.set("camera", camera === v ? null : v, { now: true })
            }
          >
            <b>{t(BP.content.camera[v], lang)}</b>
          </Pick>
        ))}
      </div>
    </Wall>
  );
}

// ------------------------------------------------------------ 13 read-back

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
  return (
    <Wall ctx={ctx} slide="read-back">
      <Head ctx={ctx} id="read-back" width={1100} />
      {/* The wall, full: the cover's three frames, each now the client's
          own paper (the label on its edge, tape only where paper meets
          felt), assembled from the small map that followed the call. */}
      <Frame
        ctx={ctx}
        kind="offer"
        box={{ x: 120, y: 236, w: 960, h: 580, i: 0 }}
        assemble={0}
      >
        <div
          className="dkb-feature dkb-pin"
          data-live=""
          style={at({ x: 0, y: 0, w: 960, h: 580, i: 1 })}
        >
          <Ruled
            ctx={ctx}
            size="feature"
            one
            minRows={1}
            placeholder={t(BP.readBack.namePlaceholder, lang)}
            label={t(BP.readBack.name, lang)}
            value={offer.name ?? ""}
            onChange={v => setOffer("name", v)}
          />
          <dl className="dkb-table">
            <div>
              <dt>{t(T.who, lang)}</dt>
              <dd dir="auto">
                <bdi>{who ?? ""}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t(T.what, lang)}</dt>
              <dd>
                <Ruled
                  ctx={ctx}
                  size="line"
                  one
                  minRows={1}
                  label={t(T.what, lang)}
                  value={offer.what ?? ""}
                  onChange={v => setOffer("what", v)}
                />
              </dd>
            </div>
            <div>
              <dt>{t(T.first, lang)}</dt>
              <dd>
                <Ruled
                  ctx={ctx}
                  size="line"
                  one
                  minRows={1}
                  label={t(T.first, lang)}
                  value={offer.firstStep ?? ""}
                  onChange={v => setOffer("firstStep", v)}
                />
              </dd>
            </div>
          </dl>
        </div>
      </Frame>
      {/* Their words sit on the wall itself, under their label: no paper,
          so no tape. */}
      <Frame
        ctx={ctx}
        kind="words"
        box={{ x: 1140, y: 236, w: 660, h: 260, i: 2 }}
        tape={false}
        assemble={1}
      >
        <p className="dkb-words-line dkb-arrive" dir="auto">
          {method ? (
            <bdi>{method}</bdi>
          ) : (
            <span className="dkb-hint-in">
              {t(BP.readBack.wordsEmpty, lang)}
            </span>
          )}
        </p>
      </Frame>
      <Frame
        ctx={ctx}
        kind="look"
        box={{ x: 1140, y: 556, w: 660, h: 260, i: 3 }}
        assemble={2}
      >
        <Look ctx={ctx} small box={{ x: 0, y: 0, w: 660, h: 260, i: 4 }} />
      </Frame>
      {/* Two short ruled lines: the money, then the ads. */}
      <ul className="dkb-money dkb-at" style={at({ x: 120, y: 860, w: 1180 })}>
        {minimum ? (
          <li className="dkb-arrive" style={{ "--i": 5 } as CSSProperties}>
            {anchor
              ? tf(BP.readBack.money, lang, { minimum, anchor })
              : tf(BP.readBack.moneyMin, lang, { minimum })}
          </li>
        ) : null}
        <li className="dkb-arrive" style={{ "--i": 6 } as CSSProperties}>
          {a.starter === "yes"
            ? t(BP.readBack.starter, lang)
            : t(BP.readBack.own, lang)}
        </li>
      </ul>
      <Sticky box={{ x: 1450, y: 864, w: 350, r: -0.8, i: 6 }}>
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
  const starter = a.starter !== "no";
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
    {
      key: "launch",
      when: dates.launch ? head(dates.launch) : t(N.when.tbd, lang),
      line: N.cards.launch,
    },
  ];
  const w = 300;
  const gap = (1680 - cards.length * w) / (cards.length - 1);
  return (
    <Wall ctx={ctx} slide="next">
      <Head ctx={ctx} id="next" width={1100} />
      <p className="dkb-legend dkb-at" style={at({ x: 120, y: 246 })}>
        <i aria-hidden />
        {t(BP.legend, lang)}
      </p>
      <svg
        className="dkb-line"
        viewBox="0 0 1720 80"
        aria-hidden
        style={at({ x: 100, y: 330, w: 1720, h: 80 })}
      >
        <path d="M0 10 Q 860 70 1720 10" />
      </svg>
      {/* Each card is pegged as the string's draw reaches its peg (the
          string runs from x 100 over 1720 px), never before (score round
          2: the first card hung from nothing). */}
      {cards.map((c, n) => (
        <figure
          key={c.key}
          className="dkb-card dkb-pin dkb-when"
          data-yours={c.yours ? "" : undefined}
          data-lit={tour >= 1 && c.key === "launch" ? "" : undefined}
          style={at(
            {
              x: 120 + n * (w + gap),
              y: 390 + (n % 2 ? 22 : 0),
              w,
              h: 300,
              r: [0.6, -0.5, 0.4, -0.6, 0.5][n],
              i: n,
            },
            {
              "--sx": ((120 + n * (w + gap) + w / 2 - 100) / 1720).toFixed(3),
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
      {tour >= 1 ? (
        <Card
          box={{ x: 560, y: 740, w: 800, h: 240, i: 0 }}
          live
          className="dkb-call-card"
        >
          <Tape x={290} y={-14} w={140} />
          <p className="dkb-card-label">{t(N.callHead, lang)}</p>
          {dates.launch ? (
            <p className="dkb-booked">
              {tf(N.booked, lang, {
                when: `${day(dates.launch)}${lang === "ar" ? "، " : ", "}${clock(dates.launch, lang, tz(d))}`,
              })}
            </p>
          ) : (
            <>
              <p className="dkb-booked">{t(N.book, lang)}</p>
              <p className="dkb-quiet-print">{t(N.bookLine, lang)}</p>
            </>
          )}
        </Card>
      ) : null}
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
    def("one-service", ctx => <OneService ctx={ctx} />),
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
      todo: () => ["Book the launch call, then press Close the call."],
    }),
  ];
}

/** The minutes each slide is given, in the deck's order (they add up to 45). */
export const blueprintMinutes = () =>
  blueprintSlides().map(s => BP_MINUTES[s.id as BpSlideId]);
