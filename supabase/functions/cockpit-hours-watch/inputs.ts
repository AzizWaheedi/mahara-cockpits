/**
 * The shapes Hubstaff watch reads from the database
 * (cockpit_hours_watch_inputs, SPEC.md "Service RPCs"), checked before any
 * decision is made. Pure. Field names are read in camelCase or snake_case,
 * so the incident rows can come straight from the table. A settings value
 * that is missing or out of its bounds falls back to the default, never to
 * zero; a person, incident or screenshot that cannot be read is left out.
 */

export type Kind = "not_tracking" | "not_work" | "idle" | "source";
export const KINDS: Kind[] = ["not_tracking", "not_work", "idle", "source"];
/** Why someone is not on shift today. no_schedule: paid by the hour with no schedule at all (Hours and pay expect nothing of them). */
export type OffReason = "day_off" | "holiday" | "leave" | "not_employed" | "paused" | "no_schedule";
export type Verdict = "pending" | "work" | "not_work" | "unclear" | "error" | "skipped";
export const VERDICTS: Verdict[] = ["pending", "work", "not_work", "unclear", "error", "skipped"];

export type WatchSettings = {
  on: boolean;
  shots: boolean;
  channel: string;
  channelName: string;
  notTrackingMinutes: number;
  graceMinutes: number;
  idleMinutes: number;
  idleFloorPct: number;
  windowMinutes: number;
  nonWorkShots: number;
  minConfidence: number;
  /** Start each opening post (never a thread reply) with a mention of mentionUser, so their phone gets a push. */
  mention: boolean;
  /** The Slack user an opening post mentions (the CEO). */
  mentionUser: string;
};

/** The CEO's Slack user id: the default the opening posts mention. */
export const CEO_SLACK_USER = "U09305KE2KS";
export const SLACK_USER_RE = /^[UW][A-Z0-9]{8,12}$/;

export const DEFAULT_SETTINGS: WatchSettings = {
  on: true, shots: true, channel: "C0B5TL9H370", channelName: "team-management",
  notTrackingMinutes: 30, graceMinutes: 15, idleMinutes: 30, idleFloorPct: 10,
  windowMinutes: 30, nonWorkShots: 2, minConfidence: 0.75, mention: true, mentionUser: CEO_SLACK_USER,
};

const BOUNDS: Record<string, [number, number, boolean]> = {
  notTrackingMinutes: [10, 240, true], graceMinutes: [0, 120, true], idleMinutes: [20, 240, true], idleFloorPct: [1, 50, false],
  windowMinutes: [20, 120, true], nonWorkShots: [1, 6, true], minConfidence: [0.5, 0.99, false],
};

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const snake = (k: string) => k.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
/** A field by its camelCase name, or the snake_case one. */
export const field = (o: Obj, k: string): unknown => (o[k] !== undefined ? o[k] : o[snake(k)]);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const instant = (v: unknown): string | null => {
  const s = text(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(Date.parse(s)).toISOString() : null;
};
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseSettings(value: unknown): WatchSettings {
  const v = isObj(value) ? value : {};
  const out: WatchSettings = { ...DEFAULT_SETTINGS };
  if (typeof v.on === "boolean") out.on = v.on;
  if (typeof v.shots === "boolean") out.shots = v.shots;
  if (typeof v.channel === "string" && /^[CG][A-Z0-9]{8,12}$/.test(v.channel)) out.channel = v.channel;
  if (typeof v.channelName === "string" && /^[a-z0-9_-]{1,80}$/.test(v.channelName)) out.channelName = v.channelName;
  if (typeof v.mention === "boolean") out.mention = v.mention;
  if (typeof v.mentionUser === "string" && SLACK_USER_RE.test(v.mentionUser)) out.mentionUser = v.mentionUser;
  for (const [k, [lo, hi, whole]] of Object.entries(BOUNDS)) {
    const n = num(v[k]);
    if (n !== null && n >= lo && n <= hi && (!whole || Number.isInteger(n))) (out as unknown as Record<string, number>)[k] = n;
  }
  return out;
}

export type WatchPerson = {
  personId: number;
  name: string;
  role: string | null;
  hubstaffUserId: string | null;
  accountStatus: string | null;
  shift: { start: string; end: string } | null;
  offReason: OffReason | null;
  screenshotsOn: boolean | null;
  /** Leave covering part of today's shift (ISO instants, sorted): time inside a window is off. Whole-shift leave is offReason 'leave'. */
  leave: LeaveWindow[];
};

export type LeaveWindow = { start: string; end: string };

export type OpenIncident = {
  id: number;
  personId: number | null;
  kind: Kind;
  openedAt: string;
  detail: Obj;
  slackState: string | null;
};

export type KnownShot = {
  shotId: number;
  personId: number | null;
  recordedAt: string | null;
  verdict: Verdict;
  confidence: number | null;
  label: string | null;
  attempts: number;
};

/** The Hours rules the watch borrows: one unpaid break a day on a shift longer than this many hours. */
export type BreakRules = { breakMinutes: number; breakWhenLongerThanHours: number };
export const DEFAULT_BREAK_RULES: BreakRules = { breakMinutes: 60, breakWhenLongerThanHours: 6 };

export type WatchInputs = {
  settings: WatchSettings;
  now: string | null;
  people: WatchPerson[];
  open: OpenIncident[];
  knownShots: KnownShot[];
  /** The Kuwait day the last prune ran, when the database says. */
  lastPruneOn: string | null;
  /** Hours' break rule (cockpit_hours_rules), else 60 minutes past 6 hours. */
  rules: BreakRules;
  /** When the newest non-dry run finished ok; null when there is none (long ago). */
  lastOkRunAt: string | null;
  /** Incidents closed in the last 24 hours whose thread reply is still pending. */
  replies: OpenIncident[];
};

const OFF: OffReason[] = ["day_off", "holiday", "leave", "not_employed", "paused", "no_schedule"];

/** Part-day leave windows: each with a start before its end, oldest first; anything else is left out. */
export function parseLeave(raw: unknown): LeaveWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: LeaveWindow[] = [];
  for (const w of raw) {
    if (!isObj(w)) continue;
    const start = instant(w.start);
    const end = instant(w.end);
    if (start && end && Date.parse(start) < Date.parse(end)) out.push({ start, end });
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function parsePerson(raw: unknown): WatchPerson | null {
  if (!isObj(raw)) return null;
  const personId = posInt(field(raw, "personId"));
  if (personId === null) return null;
  const s = field(raw, "shift");
  const start = isObj(s) ? instant(s.start) : null;
  const end = isObj(s) ? instant(s.end) : null;
  const off = field(raw, "offReason");
  const shots = field(raw, "screenshotsOn");
  return {
    personId,
    name: text(field(raw, "name")) ?? `Person ${personId}`,
    role: text(field(raw, "role")),
    hubstaffUserId: text(field(raw, "hubstaffUserId")),
    accountStatus: text(field(raw, "accountStatus")),
    shift: start && end && start < end ? { start, end } : null,
    offReason: OFF.includes(off as OffReason) ? (off as OffReason) : null,
    screenshotsOn: typeof shots === "boolean" ? shots : null,
    leave: parseLeave(field(raw, "leave")),
  };
}

export function parseIncident(raw: unknown): OpenIncident | null {
  if (!isObj(raw)) return null;
  const id = posInt(field(raw, "id"));
  const kind = field(raw, "kind");
  if (id === null || !KINDS.includes(kind as Kind)) return null;
  const personId = field(raw, "personId") === null || field(raw, "personId") === undefined ? null : posInt(field(raw, "personId"));
  if ((kind === "source") !== (personId === null)) return null;
  const detail = field(raw, "detail");
  return {
    id,
    personId,
    kind: kind as Kind,
    openedAt: instant(field(raw, "openedAt")) ?? new Date(0).toISOString(),
    detail: isObj(detail) ? detail : {},
    slackState: text(field(raw, "slackState")),
  };
}

export function parseKnownShot(raw: unknown): KnownShot | null {
  if (!isObj(raw)) return null;
  const shotId = posInt(field(raw, "shotId") ?? field(raw, "id"));
  const verdict = field(raw, "verdict");
  if (shotId === null || !VERDICTS.includes(verdict as Verdict)) return null;
  const pid = field(raw, "personId");
  const confidence = num(field(raw, "confidence"));
  return {
    shotId,
    personId: pid === null || pid === undefined ? null : posInt(pid),
    recordedAt: instant(field(raw, "recordedAt")),
    verdict: verdict as Verdict,
    confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    label: text(field(raw, "label")),
    attempts: Math.max(0, Math.trunc(num(field(raw, "attempts")) ?? 0)),
  };
}

/** The break rule, each value within the database's bounds (break 0 to 600 minutes, longer than more than 0 and at most 24 hours) or the default. */
export function parseBreakRules(value: unknown): BreakRules {
  const v = isObj(value) ? value : {};
  const minutes = num(field(v, "breakMinutes"));
  const hours = num(field(v, "breakWhenLongerThanHours"));
  return {
    breakMinutes: minutes !== null && minutes >= 0 && minutes <= 600 ? minutes : DEFAULT_BREAK_RULES.breakMinutes,
    breakWhenLongerThanHours: hours !== null && hours > 0 && hours <= 24 ? hours : DEFAULT_BREAK_RULES.breakWhenLongerThanHours,
  };
}

/** The whole inputs payload. Throws when the shape itself is not one this reads. */
export function parseInputs(value: unknown): WatchInputs {
  if (!isObj(value) || !Array.isArray(value.people)) throw new Error("The watch inputs came back in a shape this does not read; nothing was decided.");
  const open: OpenIncident[] = [];
  const seen = new Set<string>();
  // At most one open incident per (person, kind): the oldest wins, as the database's unique index would keep it.
  const incidents = (Array.isArray(value.open) ? value.open : []).map(parseIncident).filter((x): x is OpenIncident => !!x)
    .sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : a.id - b.id));
  for (const inc of incidents) {
    const key = `${inc.personId ?? 0}:${inc.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    open.push(inc);
  }
  const lastPrune = text(field(value, "lastPruneOn"));
  const replies = new Map<number, OpenIncident>();
  for (const inc of (Array.isArray(field(value, "replies")) ? field(value, "replies") as unknown[] : []).map(parseIncident))
    if (inc && !replies.has(inc.id)) replies.set(inc.id, inc);
  return {
    settings: parseSettings(value.settings),
    now: instant(value.now),
    people: value.people.map(parsePerson).filter((x): x is WatchPerson => !!x),
    open,
    knownShots: (Array.isArray(field(value, "knownShots")) ? field(value, "knownShots") as unknown[] : []).map(parseKnownShot).filter((x): x is KnownShot => !!x),
    lastPruneOn: lastPrune && /^\d{4}-\d{2}-\d{2}$/.test(lastPrune) ? lastPrune : null,
    rules: parseBreakRules(field(value, "rules")),
    lastOkRunAt: instant(field(value, "lastOkRunAt")),
    replies: [...replies.values()],
  };
}

/** The part-day leave window now falls in, if any. */
export function leaveAt(p: Pick<WatchPerson, "leave">, ms: number): LeaveWindow | null {
  return (p.leave ?? []).find(w => Date.parse(w.start) <= ms && ms < Date.parse(w.end)) ?? null;
}

/** On shift right now: a shift today, no reason to be off, and now inside it (part-day leave still counts as on shift; the rules treat it as off). */
export function onShift(p: WatchPerson, now: Date): boolean {
  if (!p.shift || p.offReason) return false;
  const t = now.getTime();
  return Date.parse(p.shift.start) <= t && t < Date.parse(p.shift.end);
}
