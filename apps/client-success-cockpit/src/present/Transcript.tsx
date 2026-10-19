import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CALL_END,
  type Dialect,
  gapAfter,
  pauseBefore,
  pieces,
  type Slots,
  TO_GIVE,
  type turnsFor,
} from "./callScript";
import { LAUNCH, type Lang, t } from "./content";
import { useHug } from "./hug";

/**
 * The example call as a call record (DESIGN 11): speaker, then words; no
 * bubbles, no typing dots. One → per stage, and the stage's turns then
 * play on their own; → in the middle of a stage finishes it; P plays the
 * whole call through and pauses it. The cursor lives here, at window
 * level, so a language switch (which remounts the slide) keeps its place,
 * and the deck's stops follow it, so P and → never disagree.
 */

export type CallTurn = ReturnType<typeof turnsFor>[number];

/** The stops of the call slide: six stages, then the after-call two. */
export const CALL_STAGES = 6;

type Listener = () => void;

interface RunState {
  /** The stop the cursor belongs to (-1: the slide is not up). */
  tour: number;
  /** How many turns of the call are on screen. */
  shown: number;
  /** Playing on its own (a stage, or the whole call with P). */
  playing: boolean;
  /** Through the whole call (P): the stage's end moves the deck on. */
  through: boolean;
  paused: boolean;
  /** When the slide last went away: a remount within a moment keeps the place. */
  leftAt: number;
}

/** The first turn of a stage (1 to 6) and the one after its last. */
export function stageRange(turns: CallTurn[], stage: number): [number, number] {
  const first = turns.findIndex(x => x.stage === stage);
  if (first < 0) return [turns.length, turns.length];
  let end = first;
  while (end < turns.length && turns[end].stage === stage) end++;
  return [first, end];
}

class CallRun {
  state: RunState = {
    tour: -1,
    shown: 0,
    playing: false,
    through: false,
    paused: false,
    leftAt: 0,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<Listener>();
  /** What the mounted slide gives: the turns, pacing and the deck's stop. */
  turns: CallTurn[] = [];
  lang: Lang = "en";
  subtitles = true;
  still = false;
  setTour: ((n: number) => void) | null = null;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;

  private set(patch: Partial<RunState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The slide arrived at a stop (or remounted on one). */
  arrive(tour: number) {
    const s = this.state;
    const remount = s.tour === tour && Date.now() - s.leftAt < 600;
    if (remount) {
      if (s.playing && !s.paused) this.next(false);
      return;
    }
    this.stop();
    if (tour >= CALL_STAGES) {
      this.set({
        tour,
        shown: this.turns.length,
        playing: false,
        through: false,
        paused: false,
      });
      return;
    }
    const [first, end] = stageRange(this.turns, tour + 1);
    // Forward into a stage plays it; back into one shows it whole.
    const forward = s.tour === tour - 1 || (tour === 0 && s.tour !== 0);
    if (!forward || this.still) {
      this.set({
        tour,
        shown: end,
        playing: false,
        through: false,
        paused: false,
      });
      return;
    }
    const auto = s.through && s.tour === tour - 1;
    this.set({
      tour,
      shown: first,
      playing: true,
      paused: false,
      through: auto,
    });
    this.next(auto);
  }

  /** The slide went away. */
  leave() {
    this.stop();
    this.set({ leftAt: Date.now() });
  }

  /** Reveal the next turn after its pause (and the gap after the last). */
  private next(afterGap: boolean) {
    this.stop();
    const s = this.state;
    if (s.paused) return;
    const [, end] = stageRange(this.turns, s.tour + 1);
    if (s.shown >= end) {
      this.set({ playing: false });
      if (s.through && s.tour < CALL_STAGES - 1) this.setTour?.(s.tour + 1);
      else this.set({ through: false });
      return;
    }
    const turn = this.turns[s.shown];
    const prev = this.turns[s.shown - 1];
    const [first] = stageRange(this.turns, s.tour + 1);
    const gap =
      prev && (s.shown > first || afterGap)
        ? gapAfter(prev, this.lang, this.subtitles)
        : 0;
    this.timer = setTimeout(() => {
      this.set({ shown: this.state.shown + 1 });
      this.next(false);
    }, gap + pauseBefore(turn.who));
  }

  /** → in the middle of a stage: finish it. True when the press was taken. */
  finish(): boolean {
    const s = this.state;
    if (s.tour < 0 || s.tour >= CALL_STAGES) return false;
    const [, end] = stageRange(this.turns, s.tour + 1);
    if (s.shown >= end) return false;
    this.stop();
    this.set({ shown: end, playing: false, through: false, paused: false });
    return true;
  }

  /** P: play the call through from here, or pause it, or go on. */
  toggle() {
    const s = this.state;
    if (s.tour < 0) return;
    if (s.playing && !s.paused) {
      this.stop();
      this.set({ paused: true });
      return;
    }
    if (s.paused) {
      this.set({ paused: false, through: true });
      this.next(false);
      return;
    }
    if (s.tour >= CALL_STAGES) {
      // After the call: play it again from the start.
      this.set({ through: true, tour: -1, shown: 0 });
      this.setTour?.(0);
      return;
    }
    const [, end] = stageRange(this.turns, s.tour + 1);
    if (s.shown >= end) {
      this.set({ through: true });
      if (s.tour < CALL_STAGES - 1) this.setTour?.(s.tour + 1);
      return;
    }
    this.set({ playing: true, through: true, paused: false });
    this.next(false);
  }

  /** Play this stage again from its first turn. */
  replay() {
    const s = this.state;
    if (s.tour < 0 || s.tour >= CALL_STAGES) return;
    const [first] = stageRange(this.turns, s.tour + 1);
    this.stop();
    this.set({ shown: first, playing: true, paused: false, through: false });
    this.next(false);
  }
}

/** This window's call (one deck per window). */
export const callRun = new CallRun();

export function useCallRun(): RunState {
  return useSyncExternalStore(
    callRun.subscribe,
    callRun.snapshot,
    callRun.snapshot,
  );
}

/** Keep the run in step with the slide: its turns, its stop, its pacing. */
export function useCallCursor({
  turns,
  tour,
  lang,
  subtitles,
  still,
  setTour,
}: {
  turns: CallTurn[];
  tour: number;
  lang: Lang;
  subtitles: boolean;
  still: boolean;
  setTour: (n: number) => void;
}) {
  callRun.turns = turns;
  callRun.lang = lang;
  callRun.subtitles = subtitles;
  callRun.still = still;
  callRun.setTour = setTour;
  useEffect(() => {
    callRun.arrive(tour);
  }, [tour]);
  useEffect(() => () => callRun.leave(), []);
  return useCallRun();
}

// ------------------------------------------------------------- drawing

/** A line with its slots: filled in teal, missing as a dashed chip. */
export function Line({
  line,
  lang,
  slots,
}: {
  line: string;
  lang: Lang;
  slots: Slots;
}) {
  const out: ReactNode[] = [];
  pieces(line, lang).forEach((p, i) => {
    if ("text" in p) {
      out.push(<span key={`t${String(i)}`}>{p.text}</span>);
      return;
    }
    const v = slots[p.slot][lang];
    if (v.text)
      out.push(
        <span
          key={`s${String(i)}`}
          className={v.given ? "dkc-slot" : undefined}
          dir="auto"
        >
          {v.text}
        </span>,
      );
    if (v.ask)
      out.push(
        <span key={`a${String(i)}`} className="dkc-ask">
          {v.text ? " " : null}
          <span>
            {t(TO_GIVE, lang)}: {v.ask[lang]}
          </span>
        </span>,
      );
  });
  return <>{out}</>;
}

/**
 * A line in the other script than the deck's (the Arabic line in the
 * English deck, a subtitle in the Arabic one), shrunk to its longest line
 * (useHug) so it sits on the turn's start edge as one block: its last
 * words end where its subtitle begins.
 */
function Hugged({
  className,
  dir,
  lang,
  hug,
  text,
  children,
}: {
  className: string;
  dir: "rtl" | "ltr";
  lang: Lang;
  hug: boolean;
  text: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useHug(ref, hug ? text : null);
  return (
    <span
      ref={hug ? ref : undefined}
      className={className}
      dir={dir}
      lang={lang}
      data-hug={hug ? "" : undefined}
    >
      {children}
    </span>
  );
}

export function Transcript({
  turns,
  shown,
  slots,
  dialect,
  lang,
  subtitles,
  dwy,
  only,
  still,
}: {
  turns: CallTurn[];
  shown: number;
  slots: Slots;
  dialect: Dialect;
  lang: Lang;
  subtitles: boolean;
  dwy: boolean;
  /** Show only this turn (after the call: the line that promises the WhatsApp). */
  only?: number | null;
  still?: boolean;
}) {
  const C = LAUNCH.call;
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [lift, setLift] = useState(0);
  const visible = turns
    .map((turn, i) => ({ turn, i }))
    .filter(x => (only != null ? x.i === only : x.i < shown));
  useLayoutEffect(() => {
    const box = boxRef.current;
    const list = listRef.current;
    if (!box || !list) return;
    // One turn on its own (after the call) is shown whole, never lifted.
    const next =
      only != null ? 0 : Math.max(0, list.scrollHeight - box.clientHeight);
    setLift(next);
    // A turn the window cuts at its top is left out whole: half a line
    // reads as a mistake on a shared screen.
    for (const li of Array.from(list.children) as HTMLElement[]) {
      if (li.offsetTop < next - 2) li.dataset.gone = "";
      else delete li.dataset.gone;
    }
  });
  const last = visible.at(-1)?.i ?? -1;
  return (
    <div
      className="dkc-transcript"
      ref={boxRef}
      data-still={still ? "" : undefined}
    >
      <ol
        ref={listRef}
        style={{ transform: `translateY(${-lift}px)` } as CSSProperties}
      >
        {visible.map(({ turn, i }) => {
          const age = last - i;
          return (
            <li
              key={`${turn.at}-${String(i)}`}
              className="dkc-turn"
              data-who={turn.who}
              data-new={age === 0 && only == null ? "" : undefined}
              style={{
                opacity:
                  only != null ? 1 : age === 0 ? 1 : age === 1 ? 0.72 : 0.35,
              }}
            >
              <span className="dkc-turn-who">
                {t(
                  turn.who === "agent" ? (dwy ? C.agentDwy : C.agent) : C.lead,
                  lang,
                )}
              </span>
              <Hugged
                className="dkc-turn-ar"
                dir="rtl"
                lang="ar"
                hug={lang !== "ar"}
                text={turn.line[dialect]}
              >
                <Line line={turn.line[dialect]} lang="ar" slots={slots} />
              </Hugged>
              {subtitles ? (
                <Hugged
                  className="dkc-turn-en"
                  dir="ltr"
                  lang="en"
                  hug={lang === "ar"}
                  text={turn.line.en}
                >
                  <Line line={turn.line.en} lang="en" slots={slots} />
                </Hugged>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The call clock's reading: the last turn's time, then "Call ended" at 4:51. */
export function clockAt(
  turns: CallTurn[],
  shown: number,
): { at: string; ended: boolean } {
  if (shown >= turns.length && turns.length)
    return { at: CALL_END, ended: true };
  return { at: turns[shown - 1]?.at ?? "0:00", ended: false };
}
