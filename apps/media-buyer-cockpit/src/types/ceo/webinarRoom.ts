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
    messages: number;
    people: number;
    perAttendee: number | null;
    /** "1" lines at the pitch-1 ask; null when pitch 1 is unknown. */
    onesAtPitch1: number | null;
  };
  /** Null when no door can read them (the Zoom app's scopes). */
  polls: { answers: number; people: number } | null;
  qa: number | null;
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
  const s = segs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
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
  const internal = new Set(rows.filter(r => r.internal).map(r => r.personKey));
  const outside = rows.filter(r => !r.internal && !internal.has(r.personKey));

  // A false start (the host alone for a minute) must not stretch the room.
  const withPeople = new Set(outside.map(r => r.sessionUuid));
  const used = sessions.filter(s => withPeople.has(s.uuid));
  const live = used.length ? used : sessions;
  const liveIds = new Set(live.map(s => s.uuid));
  const people = outside.filter(r => liveIds.has(r.sessionUuid));

  const startAt = Math.min(...live.map(s => s.startedAt));
  const lastLeave = Math.max(
    0,
    ...people.map(r => r.leaveAt ?? r.joinAt),
    ...live.map(s => s.endedAt ?? 0),
  );
  const endAt = Math.max(startAt + MIN, lastLeave);

  const byPerson = new Map<string, [number, number][]>();
  for (const r of people) {
    const seg: [number, number] = [
      Math.max(r.joinAt, startAt),
      Math.min(r.leaveAt ?? endAt, endAt),
    ];
    byPerson.set(r.personKey, [...(byPerson.get(r.personKey) ?? []), seg]);
  }
  const merged = new Map(
    [...byPerson.entries()].map(([k, v]) => [k, merge(v)] as const),
  );
  const attendees = merged.size;
  const watch = [...merged.values()].map(
    segs => segs.reduce((t, [a, b]) => t + (b - a), 0) / MIN,
  );

  const firstJoin = new Map<string, number>();
  for (const r of people)
    firstJoin.set(
      r.personKey,
      Math.min(
        firstJoin.get(r.personKey) ?? Number.POSITIVE_INFINITY,
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
  const peak = Math.max(0, ...curve);
  const peakMinute = Math.max(0, curve.indexOf(peak));

  const chat = engagement.filter(
    e =>
      e.kind === "chat" &&
      liveIds.has(e.sessionUuid) &&
      !e.private &&
      !(e.personKey && internal.has(e.personKey)),
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
  const minuteOf = (t: number) =>
    Math.max(0, Math.min(curve.length - 1, Math.floor((t - startAt) / MIN)));
  const pitchAt = (n: 1 | 2): { at: number; source: "set" | "chat" } | null => {
    const set = n === 1 ? fullest.pitch1At : fullest.pitch2At;
    if (set) return { at: set, source: "set" };
    if (n === 1) {
      const burst = onesBurst(ones);
      if (burst) return { at: burst, source: "chat" };
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
      present: curve[minute] ?? 0,
      retention: share(curve[minute] ?? 0, peak),
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
    attendees && endAt - startAt >= 5 * MIN
      ? share(
          [...merged.values()].filter(segs =>
            segs.some(([a, b]) => a <= endProbe && endProbe < b),
          ).length,
          attendees,
        )
      : null;

  const polls = engagement.filter(
    e => e.kind === "poll" && liveIds.has(e.sessionUuid),
  );
  const qa = engagement.filter(
    e => e.kind === "qa" && liveIds.has(e.sessionUuid),
  );

  return {
    primaryUuid: fullest.uuid,
    sessions: live.length,
    startAt,
    endAt,
    complete: live.every(s => s.complete),
    attendees,
    onTime,
    watchAvgMin: watch.length
      ? round1(watch.reduce((a, b) => a + b, 0) / watch.length)
      : null,
    watchMedianMin: watch.length ? round1(median(watch) ?? 0) : null,
    curve,
    peak,
    peakMinute,
    pitches,
    drops: drops.slice(0, 3),
    stayToEnd,
    chat: {
      messages: chat.length,
      people: new Set(chat.map(e => e.personKey ?? "")).size,
      perAttendee: attendees ? round1(chat.length / attendees) : null,
      onesAtPitch1,
    },
    polls:
      opts.pollsReadable || polls.length
        ? {
            answers: polls.length,
            people: new Set(polls.map(e => e.personKey ?? "")).size,
          }
        : null,
    qa: opts.pollsReadable || qa.length ? qa.length : null,
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

/** Phone numbers compared on their last eight digits, the length of a Kuwaiti number. */
export function phoneKey(p: string | null | undefined): string | null {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
}
