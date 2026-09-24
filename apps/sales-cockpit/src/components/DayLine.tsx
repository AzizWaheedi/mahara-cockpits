import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  callMinutes,
  callType,
  clock,
  kuwaitMinutes,
  statusLabel,
} from "../lib/format";
import type { CalendarRow } from "../lib/types";

/**
 * The rep's day in Kuwait time: one band, every call a block the length of
 * the call, the current minute a teal hairline, the past shaded, and the
 * calls still owed a mark hatched in the warning colour. It is the first
 * thing on Today because it answers the two questions a rep has all day:
 * where am I, and what have I left undone.
 *
 * The band runs from 10:00 to midnight unless a call sits outside that, in
 * which case it stretches to hold it. A fifteen-minute intro is only a few
 * pixels wide at that scale, so every block is at least wide enough to read
 * its time, and blocks that would then touch are stacked into rows instead
 * of hiding each other. The rows are worked out in pixels, from the band's
 * measured width.
 */

type State = "coming" | "owed" | "done" | "missed" | "past";

const MIN_BLOCK = 54;
const GAP = 3;
const ROW = 36;

function stateOf(r: CalendarRow, now: number): State {
  const start = r.start_at ? Date.parse(r.start_at) : 0;
  if (r.needs_mark) return "owed";
  const s = r.status ?? "";
  if (s === "showed") return "done";
  if (s === "noshow" || s === "cancelled" || s === "invalid") return "missed";
  // A past follow-up or callback with no outcome: nothing to mark for the
  // show rate, so it is drawn as past rather than owed.
  return start > now ? "coming" : "past";
}

function firstName(s: string | null | undefined): string {
  return (
    String(s ?? "")
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

export function DayLine({ rows, now }: { rows: CalendarRow[]; now: number }) {
  const navigate = useNavigate();
  const band = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = band.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = rows
    .filter(r => r.start_at)
    .map(r => {
      const start = kuwaitMinutes(Date.parse(String(r.start_at)));
      return { r, start, end: start + callMinutes(r.call_type) };
    })
    .sort((a, b) => a.start - b.start);

  let from = 10 * 60;
  let to = 24 * 60;
  for (const p of placed) {
    from = Math.min(from, Math.floor(p.start / 60) * 60);
    to = Math.max(to, Math.min(24 * 60, Math.ceil(p.end / 60) * 60));
  }
  const span = to - from;
  const hours = span / 60;
  const w = width || 1;

  // Each block in pixels, at least wide enough to read, then the first row
  // that is free where it starts.
  const rowEnds: number[] = [];
  const blocks = placed.map(p => {
    const natural = ((p.end - p.start) / span) * w;
    const bw = Math.min(w, Math.max(natural, MIN_BLOCK));
    let left = ((p.start - from) / span) * w;
    if (left + bw > w) left = Math.max(0, w - bw);
    let row = rowEnds.findIndex(end => end + GAP <= left);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(left + bw);
    } else rowEnds[row] = left + bw;
    return { ...p, left, bw, row };
  });
  const rowsUsed = Math.max(1, Math.min(4, rowEnds.length));

  const nowMin = kuwaitMinutes(now);
  const nowPct = Math.max(0, Math.min(100, ((nowMin - from) / span) * 100));
  const hourMarks = Array.from({ length: hours }, (_, i) => from / 60 + i);

  return (
    <div>
      <div
        ref={band}
        className="dayline"
        style={
          {
            "--hours": hours,
            height: `${16 + rowsUsed * ROW}px`,
          } as CSSProperties
        }
        role="group"
        aria-label="Today's calls"
      >
        <div className="dayline-past" style={{ width: `${nowPct}%` }} />
        {width
          ? blocks.map(({ r, left, bw, row }) => {
              const state = stateOf(r, now);
              const who = firstName(r.contact_name);
              return (
                <button
                  key={r.appointment_id}
                  type="button"
                  data-state={state}
                  className="dayline-call"
                  onClick={() =>
                    r.contact_id && navigate(`/lead/${r.contact_id}`)
                  }
                  title={`${clock(r.start_at)} ${callType(r.call_type)} with ${r.contact_name ?? "a lead"}: ${
                    state === "owed" ? "not marked yet" : statusLabel(r.status)
                  }`}
                  style={{
                    left: `${left}px`,
                    width: `${bw}px`,
                    top: `${8 + Math.min(row, rowsUsed - 1) * ROW}px`,
                    bottom: "auto",
                    height: `${ROW - 4}px`,
                  }}
                >
                  <span className="tabular-nums font-medium">
                    {clock(r.start_at)}
                  </span>
                  {bw >= 64 && who ? (
                    <span className="truncate" dir="auto">
                      {who}
                    </span>
                  ) : null}
                </button>
              );
            })
          : null}
        <div
          className="dayline-now"
          style={{ left: `${nowPct}%` }}
          aria-hidden
        />
      </div>
      <div
        className="dayline-hours"
        style={{ "--hours": hours } as CSSProperties}
        aria-hidden
      >
        {hourMarks.map(h => (
          <span key={h}>{String(h % 24).padStart(2, "0")}</span>
        ))}
      </div>
      <div className="muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Legend state="coming" label="Coming up" />
        <Legend state="owed" label="Owed a mark" />
        <Legend state="done" label="Showed" />
        <Legend state="missed" label="No-show, cancelled or disqualified" />
        <span className="tabular-nums ml-auto" style={{ color: "var(--now)" }}>
          Now {clock(new Date(now).toISOString())}
        </span>
      </div>
    </div>
  );
}

function Legend({ state, label }: { state: State; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        data-state={state}
        className="dayline-call"
        style={{
          position: "static",
          width: "0.9rem",
          height: "0.6rem",
          minWidth: 0,
          padding: 0,
        }}
      />
      {label}
    </span>
  );
}
