import { Component, type ErrorInfo, type ReactNode } from "react";
import { clock } from "../lib/format";
import {
  mmss,
  type Part,
  type RoomView,
  roomLeft,
  roomSteps,
  type Sentence,
  type Step,
  sentenceText,
  type Tone,
} from "../lib/rooms";

/**
 * The room line, the one thing a rep reads mid-call: four steps (Link sent,
 * Opened, You're in, Lead in), each with its time in Geist Mono under the
 * word, and the countdown at the right. Done steps are solid ink; the step
 * the room is waiting on carries the teal dot with its one soft pulse, the
 * only animation in the live-call screens, and still under reduced motion.
 * Where the card is narrow (a phone, or the dialer's call column on a
 * laptop) the line wraps to two rows of two steps: it reads the card's own
 * width (a container query), not the window's, so a word is never cut.
 */
export function RoomLine({
  room,
  now,
  className = "",
}: {
  room: RoomView;
  now: number;
  className?: string;
}) {
  const steps = roomSteps(room);
  const left = roomLeft(room, now);
  return (
    <div className={`@container min-w-0 ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        <ol
          aria-label="Room steps"
          className="grid min-w-0 flex-1 grid-cols-2 gap-x-2 gap-y-3 @md:grid-cols-4"
        >
          {steps.map((st, i) => (
            <StepItem
              key={st.key}
              step={st}
              // The hairline to the next step; none after the last, and none
              // at the end of the first row when the line wraps.
              joins={
                i === steps.length - 1 ? null : i === 1 ? "wide-only" : "always"
              }
              nextDone={steps[i + 1]?.done ?? false}
            />
          ))}
        </ol>
        {left !== null ? <Countdown ms={left} /> : null}
      </div>
    </div>
  );
}

function StepItem({
  step,
  joins,
  nextDone,
}: {
  step: Step;
  joins: "always" | "wide-only" | null;
  nextDone: boolean;
}) {
  const state = step.current ? "current" : step.done ? "done" : "todo";
  const time = step.at ? clock(step.at) : null;
  return (
    <li aria-current={step.current ? "step" : undefined} className="min-w-0">
      <div className="flex min-w-0 items-center">
        <StepDot state={state} />
        <span
          className={`ml-2 truncate text-[13px] leading-5 ${
            state === "todo" ? "muted" : "font-medium"
          }`}
        >
          {step.label}
        </span>
        {joins ? (
          <span
            aria-hidden
            className={`ml-2 h-px min-w-3 flex-1 ${joins === "wide-only" ? "@max-md:hidden" : ""}`}
            style={{
              background: nextDone
                ? "color-mix(in oklch, var(--foreground) 45%, transparent)"
                : "var(--border)",
            }}
          />
        ) : null}
      </div>
      <div className="mt-0.5 pl-[18px] text-[12px] leading-4">
        {time ? (
          <span className="font-mono">
            <span className="sr-only">at </span>
            {time}
          </span>
        ) : step.note ? (
          <span className="muted">{step.note}</span>
        ) : step.done ? (
          <span aria-hidden>&nbsp;</span>
        ) : (
          // Not yet: the line keeps its height and says nothing.
          <>
            <span aria-hidden>&nbsp;</span>
            <span className="sr-only">not yet</span>
          </>
        )}
      </div>
    </li>
  );
}

function StepDot({ state }: { state: "done" | "current" | "todo" }) {
  if (state === "current")
    return (
      <span className="relative inline-flex size-2.5 shrink-0">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping"
          style={{ background: "var(--now)", animationDuration: "2.4s" }}
        />
        <span
          aria-hidden
          className="relative inline-flex size-2.5 rounded-full"
          style={{ background: "var(--now)" }}
        />
      </span>
    );
  if (state === "done")
    return (
      <span
        aria-hidden
        className="inline-flex size-2.5 shrink-0 rounded-full"
        style={{ background: "var(--foreground)" }}
      />
    );
  return (
    <span
      aria-hidden
      className="inline-flex size-2.5 shrink-0 rounded-full border"
      style={{
        borderColor: "color-mix(in oklch, var(--foreground) 28%, transparent)",
      }}
    />
  );
}

/**
 * The countdown's ink. Pure teal and the owed orange are under 3:1 on the
 * white card, so in light mode the digits mix them with the foreground
 * (55%, as txt-warn does) to pass 4.5:1; on the dark card they stay pure.
 * The dots keep pure teal in both.
 */
export const COUNTDOWN_INK = {
  now: "text-[color:color-mix(in_oklch,var(--now)_55%,var(--foreground))] dark:text-[color:var(--now)]",
  owed: "text-[color:color-mix(in_oklch,var(--owed)_55%,var(--foreground))] dark:text-[color:var(--owed)]",
} as const;

/** "9:12 left", teal, turning to the owed colour in the last minute. */
export function Countdown({
  ms,
  className = "",
}: {
  ms: number;
  className?: string;
}) {
  const mins = Math.ceil(ms / 60_000);
  return (
    <div
      role="timer"
      aria-label={
        ms < 60_000
          ? "Under a minute left"
          : `${mins} minute${mins === 1 ? "" : "s"} left`
      }
      className={`shrink-0 whitespace-nowrap text-right leading-5 ${className}`}
    >
      <span
        className={`font-mono text-[15px] font-semibold ${
          ms < 60_000 ? COUNTDOWN_INK.owed : COUNTDOWN_INK.now
        }`}
      >
        {mmss(ms)}
      </span>
      <span className="muted ml-1 text-[12px]">left</span>
    </div>
  );
}

/** A sentence from lib/rooms: words in Geist, times, codes and countdowns in Geist Mono. */
export function Say({ s }: { s: Sentence }) {
  return (
    <>
      {s.map((p, i) => (
        <SayPart key={i} p={p} />
      ))}
    </>
  );
}

function SayPart({ p }: { p: Part }) {
  if (typeof p === "string") return <>{p}</>;
  if ("mono" in p)
    return <span className="font-mono text-[0.94em]">{p.mono}</span>;
  return p.form === "paren" ? (
    <>
      {p.lead}(<span className="font-mono text-[0.94em]">{mmss(p.left)}</span>{" "}
      left)
    </>
  ) : (
    <>
      {p.lead}
      <span className="font-mono text-[0.94em]">{mmss(p.left)}</span> left.
    </>
  );
}

const TONE_COLOR: Record<Tone, string> = {
  now: "var(--now)",
  good: "var(--won)",
  owed: "var(--owed)",
  bad: "var(--destructive)",
  quiet: "var(--muted-foreground)",
};

export function toneColor(tone: Tone): string {
  return TONE_COLOR[tone];
}

/**
 * A status sentence: drawn for the eye, and said to a screen reader without
 * the ticking countdown, so it is announced when it changes, not every
 * second. On its own it carries a polite live region (an offer's is
 * assertive). Inside the banner, `live={false}`: the banner keeps one
 * always-mounted live region of its own, because a region that mounts with
 * its words already in it is usually not announced.
 */
export function Spoken({
  s,
  className = "",
  assertive = false,
  live = true,
}: {
  s: Sentence;
  className?: string;
  assertive?: boolean;
  live?: boolean;
}) {
  // Never clamped: a cut sentence loses the part that says what to do.
  return (
    <div className="min-w-0">
      <p aria-hidden className={className}>
        <Say s={s} />
      </p>
      <p
        className="sr-only"
        aria-live={live ? (assertive ? "assertive" : "polite") : undefined}
        aria-atomic={live ? true : undefined}
      >
        {sentenceText(s, true)}
      </p>
    </div>
  );
}

/**
 * A live-call screen that throws while drawing shows `fallback` instead of
 * taking the page (or, above the routes, the whole cockpit) with it, and
 * tries again after `retryMs`: a bad answer is usually followed by a good one.
 */
export class LiveBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; retryMs?: number },
  { failed: boolean }
> {
  state = { failed: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A live-call screen stopped:", error, info.componentStack);
    const ms = this.props.retryMs ?? 30_000;
    this.clear();
    if (ms > 0)
      this.timer = setTimeout(() => this.setState({ failed: false }), ms);
  }

  componentWillUnmount() {
    this.clear();
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
