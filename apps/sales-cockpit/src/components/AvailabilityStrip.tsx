import { Loader2 } from "lucide-react";
import type { ApiFailure } from "../lib/apiErrors";
import { clock } from "../lib/format";
import {
  offerFraction,
  offerLeft,
  type PresenceState,
  type StripAction,
  type StripActionKey,
  type StripLine,
  type Tone,
} from "../lib/rooms";
import { button, buttonPrimary } from "./kit";
import { Countdown, Spoken, toneColor } from "./RoomLine";

/**
 * The seat's live state in the banner: a presence dot, one sentence and
 * its button. Away, Available, Ready (in the room), On a call; an offer
 * turns the strip into a card with a teal outline and a two-minute bar
 * that drains from left to right, with Take it beside a quieter Not now.
 * The words and buttons are the foundation's strip table; lib/rooms.ts
 * decides which line shows.
 */

const PRESENCE_WORDS: Record<PresenceState, string> = {
  away: "Away",
  available: "Available",
  ready: "Ready",
  on_call: "On a call",
};

/**
 * Away is muted, Available a teal ring, Ready teal, On a call the won
 * colour. A line that needs the rep (rooms down, a missed lead) passes its
 * `tone`, and the dot takes that colour instead.
 */
export function PresenceDot({
  state,
  stale = false,
  tone = null,
}: {
  state: PresenceState | null;
  stale?: boolean;
  tone?: Tone | null;
}) {
  const style =
    tone === "bad" || tone === "owed"
      ? { background: toneColor(tone) }
      : state === "ready"
        ? { background: "var(--now)" }
        : state === "on_call"
          ? { background: "var(--won)" }
          : state === "available"
            ? { boxShadow: "inset 0 0 0 2px var(--now)" }
            : {
                background:
                  "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
              };
  return (
    <span
      role="img"
      aria-label={
        state
          ? `${PRESENCE_WORDS[state]}${stale ? ", not up to date" : ""}`
          : "Live calls"
      }
      className="relative inline-flex size-2.5 shrink-0 rounded-full"
      style={{
        ...style,
        outline: stale ? "2px solid var(--owed)" : undefined,
        outlineOffset: stale ? "2px" : undefined,
      }}
    />
  );
}

/**
 * What to do about reads that keep failing: the connection, unless the
 * server answered and was in trouble, when it is the server's to fix.
 */
export function staleNext(kind: ApiFailure | null | undefined): string {
  return kind === "server"
    ? "The server is having trouble; the cockpit tries again by itself. Call the lead if you need to."
    : "Check the connection.";
}

/**
 * Reads have failed for a while: what shows may be old (ours). The same
 * words on the strip and the room panel; `never` is said instead when no
 * read has landed at all. With `onRetry`, a quiet "Read again".
 */
export function StaleNote({
  since,
  kind = null,
  never = "Live calls could not be read. Check the connection.",
  onRetry,
  className = "",
}: {
  since: number | null;
  kind?: ApiFailure | null;
  never?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <p className={`txt-warn text-[12px] leading-4 ${className}`}>
      {since === null ? (
        kind === "server" ? (
          staleNext(kind)
        ) : (
          never
        )
      ) : (
        <>
          Not updated since{" "}
          <span className="font-mono">
            {clock(new Date(since).toISOString())}
          </span>
          . {staleNext(kind)}
        </>
      )}
      {onRetry ? (
        <>
          {" "}
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-6 items-center font-medium underline underline-offset-2 pointer-coarse:min-h-11!"
          >
            Read again
          </button>
        </>
      ) : null}
    </p>
  );
}

const BTN = "h-8 pointer-coarse:h-11 shrink-0 whitespace-nowrap";

/** A touch screen (a phone or a tablet), where a page out of sight is stopped. */
function touchScreen(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches === true
    );
  } catch {
    return false;
  }
}

function StripButton({
  a,
  primary,
  busy,
  onAction,
}: {
  a: StripAction;
  primary: boolean;
  busy: StripActionKey | null;
  onAction: (k: StripActionKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAction(a.key)}
      disabled={busy !== null || a.disabled}
      aria-busy={busy === a.key}
      data-key={a.key}
      className={`${primary ? buttonPrimary : button} ${BTN}`}
    >
      {busy === a.key ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : null}
      {a.label}
    </button>
  );
}

export function AvailabilityStrip({
  line,
  presence,
  now,
  busy = null,
  staleSince = null,
  onAction,
}: {
  line: StripLine;
  presence: PresenceState | null;
  now: number;
  busy?: StripActionKey | null;
  /** The last good read, when the reads since have failed (ms). */
  staleSince?: number | null;
  onAction: (k: StripActionKey) => void;
}) {
  const stale = staleSince !== null ? <StaleNote since={staleSince} /> : null;
  // A phone stops a page it is not showing: an offer would not be heard.
  const keepInFront =
    (line.moment === "ready" || line.moment === "available") && touchScreen();
  const buttons = (
    <>
      {line.quiet.map(a => (
        <StripButton
          key={a.key}
          a={a}
          primary={false}
          busy={busy}
          onAction={onAction}
        />
      ))}
      {line.primary ? (
        <StripButton a={line.primary} primary busy={busy} onAction={onAction} />
      ) : null}
    </>
  );

  if (line.moment === "offer" && line.offer) {
    const fraction = offerFraction(line.offer, now);
    return (
      <div
        className="glow-teal relative overflow-hidden rounded-[var(--radius-lg)] border bg-[color:var(--card)]"
        style={{ borderColor: "var(--now)" }}
      >
        <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="mt-[5px]">
              <PresenceDot state={presence} stale={staleSince !== null} />
            </span>
            <div className="min-w-0 flex-1">
              <Spoken
                s={line.sentence}
                live={false}
                className="text-[14px] font-semibold leading-5 [overflow-wrap:anywhere]"
              />
              {line.detail ? (
                <p
                  className="muted mt-0.5 text-[13px] leading-5 [overflow-wrap:anywhere]"
                  dir="auto"
                >
                  {line.detail}
                </p>
              ) : null}
              {line.note ? (
                <p className="txt-bad mt-1 text-[12px] leading-4 [overflow-wrap:anywhere]">
                  {line.note}
                </p>
              ) : null}
              {stale}
            </div>
          </div>
          {/* The two minutes, in the room line's own face, beside the buttons. */}
          {/* On a phone, Take it first on the left and the time on the right. */}
          <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-3 sm:flex-row sm:justify-end">
            <Countdown ms={offerLeft(line.offer, now)} />
            <div className="flex flex-row-reverse gap-2 sm:flex-row">
              {buttons}
            </div>
          </div>
        </div>
        <div
          aria-hidden
          className="flex h-1 w-full justify-end"
          style={{ background: "var(--muted)" }}
        >
          <div
            className="h-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${fraction * 100}%`, background: "var(--now)" }}
          />
        </div>
      </div>
    );
  }

  // One button sits at the end of the row at every width. Two (Keep me
  // available, Stop) move under the words on a phone, so the question
  // they answer is never cut short.
  const two = Boolean(line.primary) && line.quiet.length > 0;
  return (
    <div
      className={`flex min-h-11 min-w-0 gap-x-3 ${two ? "flex-wrap items-center gap-y-1.5 py-1.5 sm:flex-nowrap sm:py-0" : "items-center"}`}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <PresenceDot
          state={presence}
          stale={staleSince !== null}
          tone={line.tone}
        />
        <div className="min-w-0 flex-1 py-1">
          <Spoken
            s={line.sentence}
            live={false}
            className="text-[13px] leading-5"
          />
          {keepInFront ? (
            <p className="muted text-[12px] leading-4">
              Keep this page open in front, or you may miss a lead.
            </p>
          ) : null}
          {stale}
        </div>
      </div>
      {line.primary || line.quiet.length ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {buttons}
        </div>
      ) : null}
    </div>
  );
}
