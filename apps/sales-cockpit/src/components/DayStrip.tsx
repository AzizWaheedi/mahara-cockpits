import { ChevronRight, MessageSquare } from "lucide-react";
import { Link } from "react-router";
import { useNow } from "../lib/data";
import type { SpeedToday } from "../lib/dialer";
import { ago, isArabic } from "../lib/format";
import {
  dayLine,
  messagesLine,
  speedGaps,
  speedSegs,
  type WaitingMessages,
  waitClock,
} from "../lib/setterDay";
import { LoadingSkeleton } from "./LoadingSkeleton";

/**
 * The top of the setter's day, in one quiet band of sentences (2026-11-05):
 * today's speed to lead (new leads, called inside five minutes, the median,
 * still not called) with the lead waiting longest on a live clock; the
 * rep's own day; and a line to Messages when someone wrote where only
 * Messages can answer. A number that could not be read says so; nothing
 * missing is drawn as zero.
 */
export function DayStrip({
  loaded,
  error,
  speed,
  messages,
  today,
  ready,
  loadedAt,
  locked,
  onPick,
}: {
  loaded: boolean;
  error: string | null;
  /** undefined: a server older than the strip sent none. null: it could not be read. */
  speed: SpeedToday | null | undefined;
  messages: WaitingMessages | null | undefined;
  today: {
    saved: number;
    calls: number;
    answered: number;
    booked: number;
  } | null;
  ready: number | null;
  /** When the queue this came with was read: the oldest wait counts on from it. */
  loadedAt: number;
  /** A call is open: another lead cannot be opened. */
  locked: boolean;
  onPick: (contactId: string) => void;
}) {
  const now = useNow(1000);
  if (!loaded)
    return error ? (
      <p className="muted text-sm">
        Today's numbers could not be read: {error}
      </p>
    ) : (
      <LoadingSkeleton
        variant="list"
        label="Reading today's numbers"
        rows={1}
      />
    );
  const segs = speedSegs(speed);
  const gaps = speedGaps(speed);
  const oldest = speed?.oldest_waiting ?? null;
  const msgs = messagesLine(messages, now);
  const day = dayLine(today, ready);
  const late = oldest !== null && oldest.minutes >= 5;
  return (
    <section
      aria-label="Today"
      className="panel space-y-2 px-4 py-3 shadow-none"
    >
      {segs ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="min-w-0 text-sm leading-relaxed">
            <span className="muted me-1 font-mono text-[11px]">
              Speed to lead
            </span>{" "}
            {segs.map((s, i) =>
              s.num ? (
                <strong key={i} className="font-semibold tabular-nums">
                  {s.text}
                </strong>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          {oldest ? (
            <button
              type="button"
              disabled={locked}
              onClick={() => onPick(oldest.contact_id)}
              title={
                locked
                  ? "Save or skip the call that is open first"
                  : "Open this lead"
              }
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-[color:var(--secondary)] disabled:opacity-60"
              style={{
                borderColor: `color-mix(in oklch, ${late ? "var(--destructive)" : "var(--now)"} 45%, transparent)`,
              }}
            >
              <span className="muted shrink-0 text-xs">Oldest waiting</span>
              <span
                className={`min-w-0 truncate font-medium ${isArabic(oldest.name) ? "ar" : ""}`}
                dir="auto"
              >
                {oldest.name ?? "A lead"}
              </span>
              <span
                className="shrink-0 font-mono font-semibold tabular-nums"
                style={{
                  color: late ? "var(--destructive)" : "var(--now-ink)",
                }}
              >
                {waitClock(oldest.minutes, loadedAt, now)}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
      {/* On a phone only what could not be read stays; the copy's age goes. */}
      {gaps || speed?.calls_as_of ? (
        <p className={`muted text-xs ${gaps ? "" : "hidden sm:block"}`}>
          {[
            gaps,
            speed?.calls_as_of
              ? `Maqsam's calls as of ${ago(speed.calls_as_of, now)}.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
      {day || msgs ? (
        <div
          className={`flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t hairline pt-2 ${msgs ? "flex" : "hidden sm:flex"}`}
        >
          {/* The rep's own day is the tiles' old line; a phone keeps the call in view instead. */}
          {day ? (
            <p className="muted hidden text-xs sm:block">
              <span className="me-1 font-mono text-[11px]">Your day</span> {day}
            </p>
          ) : null}
          {msgs ? (
            <Link to="/messages" className="min-w-0 text-xs hover:underline">
              <MessageSquare
                className="me-1.5 inline size-3.5 align-[-3px] txt-now"
                aria-hidden
              />
              {msgs}{" "}
              <span className="whitespace-nowrap font-medium">
                Open Messages
                <ChevronRight
                  className="ms-0.5 inline size-3.5 align-[-3px]"
                  aria-hidden
                />
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
