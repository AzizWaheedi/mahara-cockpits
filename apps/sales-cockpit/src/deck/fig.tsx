import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Lang } from "./content";
import {
  AR_DIGITS,
  isDigit,
  type Part,
  parse,
  type Tally,
  tally,
} from "./figure";

/**
 * Every figure in the deck, set one way in both languages (CEO, 2026-10-08:
 * "make the numbers look better"). `f` is the English figure size in canvas
 * px; the Arabic digits follow from it (Plex 700 at 1.17x stands as tall as
 * Geist 600), so a figure and its translation stand at the same height.
 * Units are half the figure, on the baseline, in teal; signs (+ × ~) are
 * smaller and centred on the digits. With `count`, the numbers run up once
 * from the smallest number with the same digits, each digit held in the
 * slot of its final glyph so nothing beside it moves.
 */

export type Tone = "ink" | "teal" | "leak";

/** How long one figure takes to count up, in ms (ease-out quart). */
const COUNT_MS = 1500;
/** The share of the count over which the figure fades in. */
const FADE = 0.2;

const still = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** An Arabic letter (not ٪ or a digit): a unit with one is a word. */
const ARABIC_LETTER = /[\u0621-\u064A]/;

export function Fig(props: {
  /** The English figure size, in canvas px. */
  f: number;
  text: string;
  lang: Lang;
  tone?: Tone;
  /** Count up once, `delay` ms after the figure mounts. */
  count?: { delay: number };
  className?: string;
  style?: CSSProperties;
}) {
  // A new text (the language switched) is a new figure, counted afresh.
  return <Figure key={props.text} {...props} />;
}

function Figure({
  f,
  text,
  lang,
  tone = "ink",
  count,
  className,
  style,
}: Parameters<typeof Fig>[0]) {
  const parts = useMemo(() => parse(text), [text]);
  const counts = useMemo(
    () =>
      Boolean(count) &&
      !still() &&
      parts.some(p => p.kind === "num" && tally(p.text).moves),
    [count, parts],
  );
  const [done, setDone] = useState(!counts);
  const draw = useRef<HTMLSpanElement>(null);
  const delay = count?.delay ?? 0;

  useLayoutEffect(() => {
    const el = draw.current;
    if (!counts || !el) return;
    const startAt = performance.now() + delay;
    let raf = 0;
    let wait = 0;
    let gone = false;
    const run = () => {
      if (gone) return;
      const nums = [...el.querySelectorAll<HTMLElement>(".dk-fig-n")]
        .map(slots)
        .filter((s): s is Slots => s != null);
      wait = window.setTimeout(
        () => {
          let t0 = 0;
          const tick = (now: number) => {
            t0 ||= now;
            const p = Math.min(1, (now - t0) / COUNT_MS);
            if (p >= 1) {
              el.style.opacity = "";
              setDone(true);
              return;
            }
            el.style.opacity = String(Math.min(1, p / FADE));
            const share = 1 - (1 - p) ** 4;
            for (const s of nums) frame(s, share);
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        },
        Math.max(0, startAt - performance.now()),
      );
    };
    // Slots are measured in the figure's own font, so wait for it.
    if (document.fonts?.ready) document.fonts.ready.then(run, run);
    else run();
    return () => {
      gone = true;
      window.clearTimeout(wait);
      cancelAnimationFrame(raf);
    };
  }, [counts, delay]);

  const counting = counts && !done;
  return (
    <span
      className={`dk-fig${className ? ` ${className}` : ""}`}
      data-tone={tone}
      data-big={f >= 100 ? "" : undefined}
      lang={lang}
      style={{ ...style, ["--f" as string]: f } as CSSProperties}
    >
      <span className="sr-only">{text}</span>
      <span
        ref={draw}
        className="dk-fig-draw"
        aria-hidden
        style={counting ? { opacity: 0 } : undefined}
      >
        {parts.map((p, i) => (
          <PartOf
            key={i}
            p={p}
            prev={parts[i - 1]}
            next={parts[i + 1]}
            slotted={counting}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * The room between a unit and the number beside it: tight when they touch
 * in the source (M, K, %), wide when spaced and for every Arabic word. It
 * is the unit's margin on the number's side, so it falls on the right side
 * in either direction (the number itself is always set left to right).
 * Signs and links carry their own margins.
 */
function gapTo(unit: Part, other: Part | undefined, spaced: boolean) {
  if (other?.kind !== "num") return undefined;
  return spaced || ARABIC_LETTER.test(unit.text) ? "w" : "t";
}

/** A unit's text with the ٢ of م٢ raised. */
function unitText(text: string): ReactNode {
  const m = /^(.*[ء-ي])([٠-٩]+)(.*)$/.exec(text);
  if (!m) return text;
  return (
    <>
      {m[1]}
      <span className="dk-fig-sup">{m[2]}</span>
      {m[3]}
    </>
  );
}

function PartOf({
  p,
  prev,
  next,
  slotted,
}: {
  p: Part;
  prev: Part | undefined;
  next: Part | undefined;
  slotted: boolean;
}) {
  switch (p.kind) {
    case "num":
      return (
        <bdi className="dk-fig-n" data-final={slotted ? p.text : undefined}>
          {slotted ? [...p.text].map((c, k) => <i key={k}>{c}</i>) : p.text}
        </bdi>
      );
    case "sign":
      return <span className="dk-fig-s">{p.text}</span>;
    case "link":
      return <span className="dk-fig-l">{p.text}</span>;
    case "unit":
      return (
        <span
          className="dk-fig-u"
          data-start={gapTo(p, prev, p.space)}
          data-end={gapTo(p, next, next?.space ?? false)}
        >
          {unitText(p.text)}
        </span>
      );
    default:
      return <span className="dk-fig-w">{p.text}</span>;
  }
}

// ------------------------------------------------------------ the count

interface Slots {
  tally: Tally;
  spans: HTMLElement[];
  /** Each slot's width, in canvas px. */
  widths: number[];
  /** The number's font size, in canvas px. */
  em: number;
  /** Each digit's own width (0 to 9) in this font, in canvas px. */
  digit: number[];
  arabic: boolean;
}

/**
 * Freezes a number's slots: every character keeps the width of its final
 * glyph, so the number and what stands beside it never move while the
 * digits run. Widths are read in canvas px (the canvas is scaled to the
 * screen), from the figure's laid-out width against its drawn one.
 */
function slots(n: HTMLElement): Slots | null {
  const final = n.dataset.final ?? "";
  const spans = [...n.querySelectorAll<HTMLElement>(":scope > i")];
  if (!final || spans.length !== [...final].length) return null;
  const fig = n.closest<HTMLElement>(".dk-fig");
  const laid = fig ? Number.parseFloat(getComputedStyle(fig).width) : 0;
  const drawn = fig?.getBoundingClientRect().width ?? 0;
  const scale = laid > 0 && drawn > 0 ? drawn / laid : 1;
  const widths = spans.map(s => s.getBoundingClientRect().width / scale);
  const arabic = /[٠-٩]/.test(final);
  const probe = document.createElement("i");
  probe.style.cssText =
    "position:absolute;visibility:hidden;display:inline-block;white-space:pre";
  n.append(probe);
  const digit: number[] = [];
  for (let d = 0; d < 10; d++) {
    probe.textContent = arabic ? AR_DIGITS[d] : String(d);
    digit.push(probe.getBoundingClientRect().width / scale);
  }
  probe.remove();
  spans.forEach((s, k) => {
    s.style.display = "inline-block";
    s.style.width = `${widths[k]}px`;
    s.style.textAlign = "center";
  });
  return {
    tally: tally(final),
    spans,
    widths,
    em: Number.parseFloat(getComputedStyle(n).fontSize),
    digit,
    arabic,
  };
}

/** The number at `share` of its count, written into its frozen slots. */
function frame(s: Slots, share: number) {
  const text = [...s.tally.at(share)];
  if (text.length !== s.spans.length) return;
  text.forEach((ch, k) => {
    const slot = s.spans[k];
    const node = slot.firstChild;
    if (node && node.nodeValue !== ch) node.nodeValue = ch;
    if (!isDigit(ch)) return;
    // A passing digit wider than its slot overhangs by up to 0.06 em a
    // side; only past that is it narrowed to fit.
    const d = s.arabic ? AR_DIGITS.indexOf(ch) : Number(ch);
    const fit = Math.min(1, (s.widths[k] + 0.12 * s.em) / s.digit[d]);
    slot.style.transform = fit < 1 ? `scaleX(${fit.toFixed(3)})` : "";
  });
}
