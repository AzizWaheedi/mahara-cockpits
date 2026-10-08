/**
 * The room: what Zoom's join and leave rows say about one webinar session,
 * computed on read from the rows hermes/webinar-pull keeps in Creative
 * Triage (cockpit_webinar_attendance, cockpit_webinar_engagement). This is
 * the tracking brief's stage 3: concurrent attendance minute by minute,
 * average and median watch time, retention at each pitch, the three biggest
 * minute-over-minute drop-offs, stay-to-end, chat, polls and Q&A.
 *
 * Nothing here stores a rate; the brief: "store the timestamps and compute
 * on read, because the definitions will change at least twice".
 *
 * Pure (no Convex, no fetch), so scripts/webinar.test.ts runs it directly.
 */

export type ZoomSession = {
  uuid: string;
  startedAt: number;
  endedAt: number | null;
  /** Pitch times set by hand in the cockpit; null when not set. */
  pitch1At: number | null;
  pitch2At: number | null;
  complete: boolean;
  coverage?: { attendance?: string; chat?: string; poll?: string; qa?: string };
};

export type ZoomAttendance = {
  sessionUuid: string;
  /** reg:, email:, zoom: or name: (a name is only ever used to count). */
  personKey: string;
  email: string | null;
  contactId: string | null;
  internal: boolean;
  joinAt: number;
  leaveAt: number | null;
};

export type ZoomEngagement = {
  sessionUuid: string;
  kind: "chat" | "poll" | "qa" | "cta_click";
  at: number | null;
  personKey: string | null;
  /** A chat line that is only "1" (or ١): the answer to the pitch-1 ask. */
  one: boolean;
  /** A direct message rather than a line to everyone. */
  private: boolean;
};

export type RoomPitch = {
  n: 1 | 2;
  /** Minutes from the start of the room. */
  minute: number;
  /** set: typed in the cockpit; chat: found from the "drop a 1" burst. */
  source: "set" | "chat";
  /** People in the room at the pitch. */
  present: number;
  /** Present over the peak; the brief's target for pitch 1 is 50%. */
  retention: number | null;
};

export type Room = {
  /** The session whose times the pitches are set on (the fullest one). */
  primaryUuid: string;
  sessions: number;
  startAt: number;
  endAt: number;
  complete: boolean;
  /** Distinct people in the room, our own team left out. */
  attendees: number;
  /** Joined within three minutes of the start. */
  onTime: number | null;
  watchAvgMin: number | null;
  watchMedianMin: number | null;
  /** People in the room at the middle of each minute from the start. */
  curve: number[];
  peak: number;
  peakMinute: number;
  pitches: RoomPitch[];
  /** The three biggest minute-over-minute losses, largest first. */
  drops: { minute: number; lost: number }[];
  /** Share of attendees still in the room two minutes before the end. */
  stayToEnd: number | null;
  chat: {
    complete?: boolean;
    messages: number;
    people: number;
    perAttendee: number | null;
    /** "1" lines at the pitch-1 ask; null when pitch 1 is unknown. */
    onesAtPitch1: number | null;
  };
  /** Null when no door can read them (the Zoom app's scopes). */
  polls: { answers: number; people: number } | null;
  qa: number | null;
  /** Missing/incomplete source evidence is displayed alongside the observed curve. */
  quality?: {
    warnings: string[];
    invalidRows: number;
    missingLeaves: number;
    anonymousIdentities: number;
    curveTruncated: boolean;
  };
  checkpoints?: {
    minute: number;
    present: number;
    ofPeak: number | null;
    initialCohortRemaining: number | null;
  }[];
  watchBands?: { percent: number; people: number; share: number | null }[];
  /** Lowercased emails and contact ids Zoom has for attendees. */
  emails: string[];
  contactIds: string[];
};

const MIN = 60_000;
/** The brief's on-time rule: joined within three minutes of the start. */
export const ON_TIME_MS = 3 * MIN;
/** A burst of at least this many "1" lines within three minutes is the pitch-1 ask. */
export const ONES_FOR_PITCH = 3;
const ROOM_CAP_MIN = 300;

const round1 = (x: number) => Math.round(x * 10) / 10;
const share = (a: number, b: number) =>
  b > 0 ? Math.round((a / b) * 1000) / 1000 : null;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Overlapping segments of one person (two devices, a rejoin) merged. */
export function merge(segs: [number, number][]): [number, number][] {
  const s = segs
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * The pitch-1 ask found from the chat: the three-minute window holding the
 * most "1" lines, when it holds at least ONES_FOR_PITCH. Returns the time of
 * the window's first line.
 */
export function onesBurst(times: number[]): number | null {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  let at: number | null = null;
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[i] - t[j] > 3 * MIN) j++;
    const n = i - j + 1;
    if (n > best) {
      best = n;
      at = t[j];
    }
  }
  return best >= ONES_FOR_PITCH ? at : null;
}

export function roomOf(
  sessions: ZoomSession[],
  attendance: ZoomAttendance[],
  engagement: ZoomEngagement[],
  opts: { scheduledAt: number | null; pollsReadable: boolean },
): Room | null {
  if (!sessions.length) return null;
  const ids = new Set(sessions.map(s => s.uuid));
  const rows = attendance.filter(r => ids.has(r.sessionUuid));
  const internal = new Set(
    rows.filter(r => r.internal).map(r => `${r.sessionUuid}:${r.personKey}`),
  );
  const outside = rows.filter(
    r => !r.internal && !internal.has(`${r.sessionUuid}:${r.personKey}`),
  );

  // A false start (the host alone for a minute) must not stretch the room.
  const withPeople = new Set(outside.map(r => r.sessionUuid));
  const used = sessions.filter(s => withPeople.has(s.uuid));
  const live = used.length ? used : sessions;
  const liveIds = new Set(live.map(s => s.uuid));
  const candidates = outside.filter(r => liveIds.has(r.sessionUuid));
  const bounds = new Map(live.map(s => [s.uuid, s]));
  const people = candidates.filter(r => {
    const b = bounds.get(r.sessionUuid)!;
    return (
      Number.isFinite(r.joinAt) &&
      r.personKey &&
      (r.leaveAt === null ||
        (Number.isFinite(r.leaveAt) && r.leaveAt > r.joinAt)) &&
      (b.endedAt === null || r.joinAt < b.endedAt) &&
      (r.leaveAt === null || r.leaveAt > b.startedAt)
    );
  });
  const invalidRows = candidates.length - people.length;
  const missingLeaves = people.filter(r => r.leaveAt === null).length;
  const warnings: string[] = [];
  if (live.some(s => s.endedAt === null))
    warnings.push(
      "The session end is not verified. Completion and retention rates are unavailable.",
    );
  if (invalidRows)
    warnings.push(`${invalidRows} invalid attendance rows excluded.`);
  if (missingLeaves)
    warnings.push(
      `${missingLeaves} missing leave times. Watch and retention rates are unavailable until reconciled.`,
    );

  const startAt = Math.min(...live.map(s => s.startedAt));
  const lastLeave = Math.max(
    0,
    ...people.map(r => r.leaveAt ?? r.joinAt),
    ...live.map(s => s.endedAt ?? 0),
  );
  const endAt = Math.max(startAt + MIN, lastLeave);

  // Only verified email/contact identities can bridge Zoom instances. Guest and
  // legacy display-name keys remain scoped to one instance.
  const identity = (r: ZoomAttendance) =>
    r.contactId
      ? `contact:${r.contactId}`
      : r.email
        ? `email:${r.email.trim().toLowerCase()}`
        : `${r.sessionUuid}:${r.personKey}`;
  const observed = new Set(people.map(identity));
  const anonymousIdentities = new Set(
    people.filter(r => /^(name:|unknown:)/.test(r.personKey)).map(identity),
  ).size;
  if (anonymousIdentities)
    warnings.push(
      `${anonymousIdentities} identities have only a display name or an unknown guest key; unique-person totals are provisional.`,
    );
  const byPerson = new Map<string, [number, number][]>();
  for (const r of people) {
    if (r.leaveAt === null) continue; // A missing leave is not evidence of staying to the end.
    const bound = bounds.get(r.sessionUuid)!;
    const seg: [number, number] = [
      Math.max(r.joinAt, bound.startedAt),
      Math.min(r.leaveAt, bound.endedAt ?? endAt),
    ];
    const key = identity(r);
    byPerson.set(key, [...(byPerson.get(key) ?? []), seg]);
  }
  const merged = new Map(
    [...byPerson.entries()].map(([k, v]) => [k, merge(v)] as const),
  );
  const attendees = observed.size;
  const timingReliable =
    missingLeaves === 0 &&
    invalidRows === 0 &&
    live.every(
      s =>
        (s.coverage ? s.coverage.attendance === "complete" : s.complete) &&
        s.endedAt !== null,
    );
  const watch = [...merged.values()].map(
    segs => segs.reduce((t, [a, b]) => t + (b - a), 0) / MIN,
  );

  const firstJoin = new Map<string, number>();
  for (const r of people)
    firstJoin.set(
      identity(r),
      Math.min(
        firstJoin.get(identity(r)) ?? Number.POSITIVE_INFINITY,
        r.joinAt,
      ),
    );
  const reference = opts.scheduledAt ?? startAt;
  const onTime = attendees
    ? share(
        [...firstJoin.values()].filter(t => t <= reference + ON_TIME_MS).length,
        attendees,
      )
    : null;

  const minutes = Math.min(
    ROOM_CAP_MIN,
    Math.max(1, Math.ceil((endAt - startAt) / MIN)),
  );
  const presentAt = (t: number) => {
    let n = 0;
    for (const segs of merged.values())
      if (segs.some(([a, b]) => a <= t && t < b)) n++;
    return n;
  };
  const full = Array.from({ length: minutes }, (_, m) =>
    presentAt(startAt + m * MIN + MIN / 2),
  );
  // The minutes after the last person left (the host closing up) are not
  // the room; the curve ends with the last minute anybody was in it.
  let last = full.length;
  while (last > 1 && full[last - 1] === 0) last--;
  const curve = full.slice(0, last);
  // Exact sweep, not midpoint samples: a 10-second overlap still contributes
  // to the peak. Half-open intervals process simultaneous joins/leaves together.
  const changes = new Map<number, number>();
  for (const segs of merged.values())
    for (const [a, b] of segs) {
      changes.set(a, (changes.get(a) ?? 0) + 1);
      changes.set(b, (changes.get(b) ?? 0) - 1);
    }
  let peak = 0,
    concurrent = 0,
    peakMinute = 0;
  for (const [at, delta] of [...changes].sort((a, b) => a[0] - b[0])) {
    concurrent += delta;
    if (concurrent > peak) {
      peak = concurrent;
      peakMinute = Math.floor((at - startAt) / MIN);
    }
  }
  const curveTruncated = (endAt - startAt) / MIN > ROOM_CAP_MIN;
  if (curveTruncated)
    warnings.push(
      `The chart shows the first ${ROOM_CAP_MIN} minutes; summary calculations use the full session.`,
    );
  if (!live.every(s => s.complete))
    warnings.push(
      "Source collection is incomplete; observed counts can still change.",
    );
  for (const kind of ["chat", "poll", "qa"] as const)
    if (live.some(s => s.coverage && s.coverage[kind] !== "complete"))
      warnings.push(
        `${kind === "qa" ? "Q&A" : kind} data is incomplete or unavailable. Missing answers are not counted as zero.`,
      );

  const chat = engagement.filter(
    e =>
      e.kind === "chat" &&
      liveIds.has(e.sessionUuid) &&
      !e.private &&
      !(e.personKey && internal.has(`${e.sessionUuid}:${e.personKey}`)),
  );
  const ones = chat
    .filter(e => e.one && e.at !== null)
    .map(e => e.at as number);

  // Pitch times: the fullest session's hand-set times win; else pitch 1 is
  // the "drop a 1" burst in the chat.
  const fullest = [...live].sort(
    (a, b) =>
      people.filter(r => r.sessionUuid === b.uuid).length -
      people.filter(r => r.sessionUuid === a.uuid).length,
  )[0];
  const minuteOf = (t: number) => Math.floor((t - startAt) / MIN);
  const pitchAt = (n: 1 | 2): { at: number; source: "set" | "chat" } | null => {
    const set = n === 1 ? fullest.pitch1At : fullest.pitch2At;
    if (set !== null) {
      if (set < fullest.startedAt || set >= (fullest.endedAt ?? endAt))
        return null;
      return { at: set, source: "set" };
    }
    if (n === 1) {
      const burst = onesBurst(ones);
      if (burst !== null && burst >= startAt && burst < endAt)
        return { at: burst, source: "chat" };
    }
    return null;
  };
  const pitches: RoomPitch[] = [];
  for (const n of [1, 2] as const) {
    const p = pitchAt(n);
    if (!p) continue;
    const minute = minuteOf(p.at);
    pitches.push({
      n,
      minute,
      source: p.source,
      present: presentAt(p.at),
      retention: timingReliable ? share(presentAt(p.at), peak) : null,
    });
  }
  const p1 = pitchAt(1);
  const onesAtPitch1 = p1
    ? ones.filter(t => t >= p1.at - MIN && t <= p1.at + 5 * MIN).length
    : null;

  // Drop-offs: minute-over-minute losses, leaving out the last two minutes,
  // when everybody leaves because the session ended.
  const drops: { minute: number; lost: number }[] = [];
  for (let m = 1; m < curve.length - 2; m++) {
    const lost = curve[m - 1] - curve[m];
    if (lost > 0) drops.push({ minute: m, lost });
  }
  drops.sort((a, b) => b.lost - a.lost || a.minute - b.minute);

  const endProbe = endAt - 2 * MIN;
  const stayToEnd =
    timingReliable && attendees && endAt - startAt >= 5 * MIN
      ? share(
          [...merged.values()].filter(segs =>
            segs.some(([a, b]) => a <= endProbe && endProbe < b),
          ).length,
          attendees,
        )
      : null;

  const polls = engagement.filter(
    e =>
      e.kind === "poll" &&
      liveIds.has(e.sessionUuid) &&
      !e.private &&
      !(e.personKey && internal.has(`${e.sessionUuid}:${e.personKey}`)),
  );
  const qa = engagement.filter(
    e =>
      e.kind === "qa" &&
      liveIds.has(e.sessionUuid) &&
      !e.private &&
      !(e.personKey && internal.has(`${e.sessionUuid}:${e.personKey}`)),
  );

  return {
    primaryUuid: fullest.uuid,
    sessions: live.length,
    startAt,
    endAt,
    complete: timingReliable && live.every(s => s.complete),
    quality: {
      warnings,
      invalidRows,
      missingLeaves,
      anonymousIdentities,
      curveTruncated,
    },
    checkpoints: [5, 15, 30, 45, 60, 90, 120]
      .filter(m => startAt + m * MIN < endAt)
      .map(minute => {
        const t = startAt + minute * MIN;
        const cohort = [...merged].filter(
          ([key]) => (firstJoin.get(key) ?? Infinity) <= reference + ON_TIME_MS,
        );
        return {
          minute,
          present: presentAt(t),
          ofPeak: timingReliable ? share(presentAt(t), peak) : null,
          initialCohortRemaining: timingReliable
            ? share(
                cohort.filter(([, segs]) =>
                  segs.some(([a, b]) => a <= t && t < b),
                ).length,
                cohort.length,
              )
            : null,
        };
      }),
    watchBands: timingReliable
      ? [25, 50, 75, 90].map(percent => {
          const n = watch.filter(
            w => w * MIN >= ((endAt - startAt) * percent) / 100,
          ).length;
          return { percent, people: n, share: share(n, attendees) };
        })
      : [],
    attendees,
    onTime,
    watchAvgMin:
      timingReliable && watch.length
        ? round1(watch.reduce((a, b) => a + b, 0) / watch.length)
        : null,
    watchMedianMin:
      timingReliable && watch.length ? round1(median(watch) ?? 0) : null,
    curve,
    peak,
    peakMinute,
    pitches,
    drops: drops.slice(0, 3),
    stayToEnd,
    chat: {
      complete: live.every(s =>
        s.coverage ? s.coverage.chat === "complete" : s.complete,
      ),
      messages: chat.length,
      people: new Set(chat.map(e => e.personKey).filter(Boolean)).size,
      perAttendee: attendees ? round1(chat.length / attendees) : null,
      onesAtPitch1,
    },
    polls: live.every(s =>
      s.coverage ? s.coverage.poll === "complete" : opts.pollsReadable,
    )
      ? {
          answers: polls.length,
          people: new Set(polls.map(e => e.personKey).filter(Boolean)).size,
        }
      : null,
    qa: live.every(s =>
      s.coverage ? s.coverage.qa === "complete" : opts.pollsReadable,
    )
      ? qa.length
      : null,
    emails: [
      ...new Set(
        people.map(r => r.email).filter((x): x is string => Boolean(x)),
      ),
    ],
    contactIds: [
      ...new Set(
        people.map(r => r.contactId).filter((x): x is string => Boolean(x)),
      ),
    ],
  };
}

/** The survey's profit threshold for a qualified firm: the call funnel's target, businesses above $100K profit. */
export const QUALIFIED_PROFIT = 100_000;

/** Full international number only. Do not collapse different country codes or guess a country. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = String(p ?? "")
    .replace(/\D/g, "")
    .replace(/^00/, "");
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
