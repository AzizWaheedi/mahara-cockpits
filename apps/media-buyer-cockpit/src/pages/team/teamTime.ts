import {
  addDays,
  addMinutes,
  DAY_NAMES,
  dayLabel,
  hhmm,
  nextOn,
  rruleParts,
  utcToZoned,
  zonedToUtc,
  zoneOffset,
} from "../../../convex/teamCore";

/**
 * Meeting times in the viewer's own zone (the CEO, 2026-09-30: "make sure
 * the team meetings match my time zone now"). A meeting keeps its own zone
 * (Kuwait) on the calendar and on the server; each person sees it on their
 * own clock, like Google Calendar, with the meeting's time beside it when
 * the two clocks differ.
 */

const KUWAIT = "Asia/Kuwait";

/** The browser's zone ("Europe/London"). */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || KUWAIT;
  } catch {
    return KUWAIT;
  }
}

/** "London" from "Europe/London". */
export function zoneName(tz: string): string {
  return tz.replace(/^.*\//, "").replace(/_/g, " ");
}

/** True when two zones show the same wall clock at that moment. */
export function sameClock(a: string, b: string, atMs = Date.now()): boolean {
  return zoneOffset(a, atMs) === zoneOffset(b, atMs);
}

/** Today's date in the viewer's zone. */
export function localToday(tz = viewerZone()): string {
  return utcToZoned(Date.now(), tz).day;
}

/** "Kuwait is 2 hours ahead of London." */
export function offsetLine(meetingTz: string, tz = viewerZone()): string {
  const now = Date.now();
  const diff = zoneOffset(meetingTz, now) - zoneOffset(tz, now);
  if (!diff) return "";
  const h = Math.abs(diff) / 60;
  const amount = Number.isInteger(h)
    ? `${h} ${h === 1 ? "hour" : "hours"}`
    : `${Math.floor(h)}h ${Math.abs(diff) % 60}m`;
  return `${zoneName(meetingTz)} is ${amount} ${diff > 0 ? "ahead of" : "behind"} ${zoneName(tz)}`;
}

/** An instant as the viewer's day and time. */
export function inViewer(
  iso: string | null | undefined,
  tz = viewerZone(),
): { day: string; time: string; weekday: number } | null {
  return iso ? utcToZoned(iso, tz) : null;
}

/** "13:00 to 13:30" in the viewer's zone. */
export function rangeIn(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  tz = viewerZone(),
): string {
  const a = inViewer(startsAt, tz);
  if (!a) return "";
  const b = inViewer(endsAt, tz);
  return b ? `${a.time} to ${b.time}` : a.time;
}

function dayList(days: number[]): string {
  const names = [...days].sort((a, b) => a - b).map(d => DAY_NAMES[d]);
  if (names.length === 5 && days.every(d => d <= 4)) return "Sun to Thu";
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : (names[0] ?? "");
}

export type SeriesIn = {
  /** "Mon, Tue and Wed, 13:00 to 13:30, London time". */
  line: string;
  /** The meeting's own clock when it differs: "15:00 Kuwait time". */
  theirs: string | null;
};

/**
 * A meeting's series on the viewer's clock. Each meeting day is placed on
 * its next date, so a day that crosses midnight lands on the viewer's day
 * and a clock change is taken at the date it happens.
 */
export function seriesIn(
  s: {
    weekdays: number[] | null;
    startTime: string | null;
    minutes: number | null;
    tz?: string | null;
    rrule?: string | null;
    onDay?: string | null;
  },
  today: string,
  opts: { tz?: string; zone?: boolean } = {},
): SeriesIn {
  const view = opts.tz ?? viewerZone();
  const home = s.tz || KUWAIT;
  const withZone = opts.zone !== false;
  if (!s.startTime || !s.minutes)
    return { line: "No time set yet", theirs: null };
  const monthly = rruleParts(s.rrule ?? null).FREQ === "MONTHLY";
  const days = s.weekdays?.length && !monthly ? s.weekdays : null;
  const first = days ? nextOn(days, today) : (s.onDay ?? today);
  const at = zonedToUtc(first, s.startTime, home);
  const mine = utcToZoned(at, view);
  const end = addMinutes(mine.time, s.minutes);
  const zone = withZone ? `, ${zoneName(view)} time` : "";
  const same = sameClock(home, view, at.getTime());
  const theirs = same
    ? null
    : `${hhmm(s.startTime)} to ${addMinutes(s.startTime, s.minutes)} ${zoneName(home)} time`;
  const time = `${mine.time} to ${end}${zone}`;
  if (monthly) return { line: `Monthly, ${time}`, theirs };
  if (days) {
    const local = days.map(d => {
      const day = nextOn([d], today);
      return utcToZoned(zonedToUtc(day, s.startTime as string, home), view)
        .weekday;
    });
    const every =
      rruleParts(s.rrule ?? null).INTERVAL === "2" ? "Every other " : "";
    return { line: `${every}${dayList(local)}, ${time}`, theirs };
  }
  if (s.onDay) return { line: `Once, ${dayLabel(mine.day)}, ${time}`, theirs };
  return { line: `Once, ${time}`, theirs };
}

/**
 * A meeting made of a series a day whose days do not all start together
 * (CSM Daily: Monday to Wednesday at 15:00, the Thursday wrap at 16:30):
 * one line per time, the zone said once at the end.
 */
export function seriesInDays(
  parts: {
    weekday: number | null;
    startTime: string | null;
    minutes: number | null;
  }[],
  tz: string,
  today: string,
  opts: { tz?: string } = {},
): SeriesIn | null {
  const groups = new Map<
    string,
    { days: number[]; start: string; minutes: number }
  >();
  for (const p of parts) {
    if (p.weekday === null || !p.startTime || !p.minutes) continue;
    const k = `${p.startTime.slice(0, 5)}|${p.minutes}`;
    const g = groups.get(k) ?? {
      days: [],
      start: p.startTime,
      minutes: p.minutes,
    };
    if (!g.days.includes(p.weekday)) g.days.push(p.weekday);
    groups.set(k, g);
  }
  if (groups.size < 2) return null;
  const all = [...groups.values()].sort(
    (a, b) => Math.min(...a.days) - Math.min(...b.days),
  );
  const lines = all.map((g, i) =>
    seriesIn(
      { weekdays: g.days, startTime: g.start, minutes: g.minutes, tz },
      today,
      { tz: opts.tz, zone: i === all.length - 1 },
    ),
  );
  const home = ` ${zoneName(tz)} time`;
  const theirs = lines.every(l => l.theirs)
    ? `${all
        .map(
          (g, i) =>
            `${dayList(g.days)} ${(lines[i].theirs as string).replace(home, "")}`,
        )
        .join("; ")}${home}`
    : null;
  return { line: lines.map(l => l.line).join("; "), theirs };
}

/** The days of the week view, re-read on the viewer's calendar. */
export function daysFrom(from: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}
