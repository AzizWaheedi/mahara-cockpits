/**
 * Pure shaping of Hubstaff and Timetastic responses (design.md 2.3 to 2.5).
 * Only allowlisted fields survive: no pay, profile, birthday, address, phone,
 * emergency contact, reason or decline reason ever leaves this file. Day
 * totals come from Hubstaff's 10-minute records sorted into Kuwait days here,
 * so Hubstaff's organisation time zone (which the API can't report) never
 * decides which day time lands on; Hubstaff's own daily totals are the
 * second source on every read.
 */

export type Ymd = string;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export const KUWAIT_OFFSET_MS = 3 * 3600_000;

/** The Kuwait calendar day of a UTC instant. */
export function kuwaitDayOf(iso: string | number | Date): Ymd {
  const t = iso instanceof Date ? iso.getTime() : typeof iso === "number" ? iso : Date.parse(iso);
  return new Date(t + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}
export function addDays(day: Ymd, n: number): Ymd {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
/** 00:00 Kuwait on a day, as a UTC ISO instant. */
export function kuwaitStartUtc(day: Ymd): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - KUWAIT_OFFSET_MS).toISOString().replace(".000Z", "Z");
}
export function daysBetween(from: Ymd, to: Ymd): Ymd[] {
  const out: Ymd[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
/** Windows of at most `size` days covering [from, to]. */
export function chunkDays(from: Ymd, to: Ymd, size: number): { from: Ymd; to: Ymd }[] {
  const out: { from: Ymd; to: Ymd }[] = [];
  for (let d = from; d <= to; d = addDays(d, size)) {
    const end = addDays(d, size - 1);
    out.push({ from: d, to: end < to ? end : to });
  }
  return out;
}
export function monthStart(day: Ymd): Ymd {
  return `${day.slice(0, 7)}-01`;
}
export function monthEnd(day: Ymd): Ymd {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function addMonths(day: Ymd, n: number): Ymd {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}
/**
 * Timetastic's Start filter means "starts on or after", so a booking that
 * began earlier would be missed: every bookings read starts at the earlier
 * of 1 January this year and the window start less 120 days (70 days of
 * Kuwaiti maternity leave fit inside), and overlaps are worked out after.
 */
export function bookingLookbackStart(windowFrom: Ymd, today: Ymd): Ymd {
  const jan1 = `${today.slice(0, 4)}-01-01`;
  const back = addDays(windowFrom, -120);
  return back < jan1 ? back : jan1;
}

// ---------------------------------------------------------------------------
// Hubstaff

export type AccountRow = {
  externalId: string;
  email: string | null;
  name: string | null;
  status: string | null;
  membershipRole?: string | null;
  trackable?: boolean | null;
  memberSince?: Ymd | null;
  removedOn?: Ymd | null;
  timeZone?: string | null;
  extra?: Obj;
  payrollId?: string | null;
  jobTitle?: string | null;
  online?: boolean | null;
  lastActivityAt?: string | null;
  lastClientActivityOn?: Ymd | null;
};

/** Members (with sideloaded or nested users), allowlisted. Pay, profile and addresses are never read. */
export function normaliseMembers(pages: unknown[]): AccountRow[] {
  const users = new Map<string, Obj>();
  const members: Obj[] = [];
  for (const page of pages) {
    if (!isObj(page)) continue;
    for (const u of Array.isArray(page.users) ? page.users : []) if (isObj(u) && u.id !== undefined) users.set(String(u.id), u);
    for (const m of Array.isArray(page.members) ? page.members : []) if (isObj(m)) members.push(m);
  }
  const out: AccountRow[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const id = str(m.user_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const u = isObj(m.user) ? m.user : users.get(id) ?? {};
    const status = str(m.membership_status);
    const removedAt = str(m.removed_at) ?? (status === "removed" ? str(m.updated_at) : null);
    out.push({
      externalId: id,
      email: str(u.email),
      name: str(u.name),
      status,
      membershipRole: str(m.membership_role),
      trackable: typeof m.trackable === "boolean" ? m.trackable : null,
      memberSince: str(m.created_at) ? kuwaitDayOf(String(m.created_at)) : null,
      removedOn: removedAt ? kuwaitDayOf(removedAt) : null,
      timeZone: str(u.time_zone),
      lastClientActivityOn: str(m.last_client_activity) ? kuwaitDayOf(String(m.last_client_activity)) : null,
      extra: {},
    });
  }
  return out;
}

/** Online state and the last activity, per member. */
export function normaliseLastActivities(pages: unknown[]): Map<string, { online: boolean | null; lastActivityAt: string | null; lastClientActivityOn: Ymd | null }> {
  const out = new Map<string, { online: boolean | null; lastActivityAt: string | null; lastClientActivityOn: Ymd | null }>();
  for (const page of pages) {
    if (!isObj(page)) continue;
    for (const a of Array.isArray(page.last_activities) ? page.last_activities : []) {
      if (!isObj(a) || a.user_id === undefined) continue;
      const at = str(a.last_client_activity);
      out.set(String(a.user_id), { online: typeof a.online === "boolean" ? a.online : null, lastActivityAt: at, lastClientActivityOn: at ? kuwaitDayOf(at) : null });
    }
  }
  return out;
}

export type HubstaffDayRow = {
  hubstaffUserId: string;
  day: Ymd;
  trackedS: number;
  manualS: number;
  idleS: number;
  breakS: number;
  overallS: number;
  inputTrackedS: number;
  dailyTrackedS: number | null;
  zoneShifted: boolean;
  verified: boolean;
  slots: number;
  sourceUpdatedAt: string | null;
};

type Daily = { tracked: number; manual: number; idle: number; work_break: number; overall: number; input_tracked: number; updatedAt: string | null };
const DAILY_FIELDS = ["tracked", "manual", "idle", "work_break", "overall", "input_tracked"] as const;

/** Share `total` across keys by weight, largest remainder first, so the parts sum exactly. */
function shareOut(total: number, weights: Map<Ymd, number>): Map<Ymd, number> {
  const out = new Map<Ymd, number>();
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) {
    for (const k of weights.keys()) out.set(k, 0);
    return out;
  }
  const raw = [...weights.entries()].map(([k, w]) => ({ k, x: (total * w) / sum }));
  let left = total;
  for (const r of raw) { out.set(r.k, Math.floor(r.x)); left -= Math.floor(r.x); }
  raw.sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)) || a.k.localeCompare(b.k));
  for (let i = 0; left > 0 && i < raw.length; i++, left--) out.set(raw[i].k, (out.get(raw[i].k) ?? 0) + 1);
  return out;
}

/**
 * Hubstaff day rows for Kuwait days in [from, to].
 * - `tracked` sums the 10-minute records whose time_slot falls on the Kuwait day.
 * - manual, idle, break, overall and input_tracked exist only in the daily
 *   totals: taken as they are when the record dates agree with Kuwait dates,
 *   shared out by each organisation day's records otherwise.
 * - The second source: the daily tracked total must match the 10-minute sum
 *   within 60 seconds for every organisation day behind a Kuwait day, or
 *   the day is unverified.
 * Records and totals should cover a day either side of the window, so the
 * edges of a shifted zone are complete.
 */
export function buildHubstaffDays(records: unknown[], dailies: unknown[], from: Ymd, to: Ymd): HubstaffDayRow[] {
  type UserAgg = {
    byKw: Map<Ymd, { tracked: number; slots: number; updatedAt: string | null }>;
    byOrg: Map<Ymd, number>;
    byOrgKw: Map<Ymd, Map<Ymd, number>>;
    slotsByOrgKw: Map<Ymd, Map<Ymd, number>>;
    daily: Map<Ymd, Daily>;
    shifted: boolean;
  };
  const users = new Map<string, UserAgg>();
  const agg = (id: string): UserAgg => {
    let u = users.get(id);
    if (!u) { u = { byKw: new Map(), byOrg: new Map(), byOrgKw: new Map(), slotsByOrgKw: new Map(), daily: new Map(), shifted: false }; users.set(id, u); }
    return u;
  };
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const r of records) {
    if (!isObj(r)) continue;
    const id = str(r.user_id);
    const slot = str(r.time_slot);
    if (!id || !slot || Number.isNaN(Date.parse(slot))) continue;
    const kw = kuwaitDayOf(slot);
    const org = (str(r.date) ?? kw).slice(0, 10);
    const tracked = Math.max(0, Math.round(num(r.tracked)));
    const u = agg(id);
    if (org !== kw) u.shifted = true;
    const k = u.byKw.get(kw) ?? { tracked: 0, slots: 0, updatedAt: null };
    k.tracked += tracked;
    k.slots += 1;
    k.updatedAt = later(k.updatedAt, str(r.updated_at));
    u.byKw.set(kw, k);
    u.byOrg.set(org, (u.byOrg.get(org) ?? 0) + tracked);
    const m = u.byOrgKw.get(org) ?? new Map<Ymd, number>();
    m.set(kw, (m.get(kw) ?? 0) + tracked);
    u.byOrgKw.set(org, m);
    const sm = u.slotsByOrgKw.get(org) ?? new Map<Ymd, number>();
    sm.set(kw, (sm.get(kw) ?? 0) + 1);
    u.slotsByOrgKw.set(org, sm);
  }
  for (const d of dailies) {
    if (!isObj(d)) continue;
    const id = str(d.user_id);
    const date = str(d.date)?.slice(0, 10);
    if (!id || !date) continue;
    const u = agg(id);
    const cur = u.daily.get(date) ?? { tracked: 0, manual: 0, idle: 0, work_break: 0, overall: 0, input_tracked: 0, updatedAt: null };
    for (const f of DAILY_FIELDS) cur[f] += Math.max(0, Math.round(num(d[f])));
    cur.updatedAt = later(cur.updatedAt, str(d.updated_at));
    u.daily.set(date, cur);
  }

  const out: HubstaffDayRow[] = [];
  for (const [id, u] of users) {
    const orgVerified = (org: Ymd) => Math.abs((u.daily.get(org)?.tracked ?? 0) - (u.byOrg.get(org) ?? 0)) <= 60;
    // Where each organisation day's daily totals land, in Kuwait days.
    const landing = new Map<Ymd, Map<Ymd, number>>();
    for (const org of new Set([...u.daily.keys(), ...u.byOrg.keys()])) {
      if (!u.shifted) { landing.set(org, new Map([[org, 1]])); continue; }
      const byTracked = u.byOrgKw.get(org);
      const weights = byTracked && [...byTracked.values()].some(v => v > 0) ? byTracked : u.slotsByOrgKw.get(org) ?? new Map([[org, 1]]);
      landing.set(org, weights);
    }
    const shares = new Map<Ymd, Map<Ymd, Daily>>(); // kw -> org -> shared fields
    for (const [org, daily] of u.daily) {
      const weights = landing.get(org) ?? new Map([[org, 1]]);
      const parts: Partial<Record<(typeof DAILY_FIELDS)[number], Map<Ymd, number>>> = {};
      for (const f of DAILY_FIELDS) parts[f] = shareOut(daily[f], weights);
      for (const kw of weights.keys()) {
        const m = shares.get(kw) ?? new Map<Ymd, Daily>();
        m.set(org, {
          tracked: parts.tracked?.get(kw) ?? 0, manual: parts.manual?.get(kw) ?? 0, idle: parts.idle?.get(kw) ?? 0,
          work_break: parts.work_break?.get(kw) ?? 0, overall: parts.overall?.get(kw) ?? 0, input_tracked: parts.input_tracked?.get(kw) ?? 0,
          updatedAt: daily.updatedAt,
        });
        shares.set(kw, m);
      }
    }
    const kwDays = new Set<Ymd>([...u.byKw.keys(), ...shares.keys()]);
    for (const kw of [...kwDays].sort()) {
      if (kw < from || kw > to) continue;
      const rec = u.byKw.get(kw) ?? { tracked: 0, slots: 0, updatedAt: null };
      const fromOrgs = shares.get(kw) ?? new Map<Ymd, Daily>();
      const sum = (f: (typeof DAILY_FIELDS)[number]) => [...fromOrgs.values()].reduce((a, x) => a + x[f], 0);
      const behind = new Set<Ymd>([...fromOrgs.keys()]);
      for (const [org, m] of u.byOrgKw) if (m.has(kw)) behind.add(org);
      const verified = [...behind].every(orgVerified);
      const dailyTracked = fromOrgs.size ? sum("tracked") : null;
      const row: HubstaffDayRow = {
        hubstaffUserId: id,
        day: kw,
        trackedS: rec.tracked,
        manualS: sum("manual"),
        idleS: sum("idle"),
        breakS: sum("work_break"),
        overallS: sum("overall"),
        inputTrackedS: sum("input_tracked"),
        dailyTrackedS: dailyTracked,
        zoneShifted: u.shifted,
        verified,
        slots: rec.slots,
        sourceUpdatedAt: [...fromOrgs.values()].map(x => x.updatedAt).reduce(later, rec.updatedAt),
      };
      if (row.trackedS > 0 || (row.dailyTrackedS ?? 0) > 0 || row.manualS > 0 || !row.verified) out.push(row);
    }
  }
  return out.sort((a, b) => a.hubstaffUserId.localeCompare(b.hubstaffUserId) || a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------------------
// Timetastic

const DAY_KEY: Record<string, string> = { Sunday: "sun", Monday: "mon", Tuesday: "tue", Wednesday: "wed", Thursday: "thu", Friday: "fri", Saturday: "sat" };

/** Users, allowlisted: never birthday, gravatar, addresses or phones. */
export function normaliseTtUsers(list: unknown): AccountRow[] {
  if (!Array.isArray(list)) throw new Error("Timetastic users were not a list");
  const out: AccountRow[] = [];
  for (const u of list) {
    if (!isObj(u) || u.id === undefined) continue;
    const name = [str(u.firstname), str(u.surname)].filter(Boolean).join(" ") || null;
    out.push({
      externalId: String(u.id),
      email: str(u.email),
      name,
      status: u.isArchived === true ? "archived" : "active",
      removedOn: str(u.endDate)?.slice(0, 10) ?? null,
      extra: {
        departmentName: str(u.departmentName),
        countryCode: str(u.countryCode),
        hasPublicHolidays: typeof u.hasPublicHolidays === "boolean" ? u.hasPublicHolidays : null,
        startDate: str(u.startDate)?.slice(0, 10) ?? null,
        endDate: str(u.endDate)?.slice(0, 10) ?? null,
        allowanceUnit: u.allowanceUnit === "Hours" ? "Hours" : "Days",
        allowanceRemaining: typeof u.allowanceRemaining === "number" ? u.allowanceRemaining : null,
        currentYearAllowance: typeof u.currentYearAllowance === "number" ? u.currentYearAllowance : null,
      },
    });
  }
  return out;
}

/** From users/{id}: the working days of the schedule in force on `today`, as day keys. */
export function workDaysOf(detail: unknown, today: Ymd): string[] | null {
  if (!isObj(detail)) return null;
  const schedules = (Array.isArray(detail.workSchedules) ? detail.workSchedules : []).filter(isObj)
    .map(s => ({ start: (str(s.start) ?? "1900-01-01").slice(0, 10), days: Array.isArray(s.days) ? s.days : [] }))
    .filter(s => s.start <= today)
    .sort((a, b) => a.start.localeCompare(b.start));
  const days = schedules.length ? schedules[schedules.length - 1].days : Array.isArray(detail.workingDays) ? detail.workingDays : [];
  if (!days.length) return null;
  return days.filter(isObj).filter(d => d.workingAm === true || d.workingPm === true).map(d => DAY_KEY[String(d.dayOfWeek)]).filter(Boolean);
}

/** From users/contact/{id}, only the payroll id and job title. */
export function normaliseContact(contact: unknown): { payrollId: string | null; jobTitle: string | null } {
  if (!isObj(contact)) return { payrollId: null, jobTitle: null };
  return { payrollId: str(contact.payrollId), jobTitle: str(contact.jobTitle) };
}

export type LeaveTypeRow = { externalId: string; name: string; active: boolean; deducted: boolean | null; requiresApproval: boolean | null };
export function normaliseLeaveTypes(list: unknown): LeaveTypeRow[] {
  if (!Array.isArray(list)) throw new Error("Timetastic leave types were not a list");
  return list.filter(isObj).filter(t => t.id !== undefined).map(t => ({
    externalId: String(t.id), name: str(t.name) ?? "Leave", active: t.active !== false,
    deducted: typeof t.deducted === "boolean" ? t.deducted : null,
    requiresApproval: typeof t.requiresApproval === "boolean" ? t.requiresApproval : null,
  }));
}

export type BookingRow = {
  bookingId: string; ttUserId: string; leaveTypeId: string; leaveTypeName: string | null; status: string;
  startAt: string; startType: string; endAt: string; endType: string; bookingUnit: string;
  duration: number | null; deduction: number | null; requestedById: string | null; actionerId: string | null;
  autoApproved: boolean; updatedAt: string | null;
};
const STATUSES = new Set(["Pending", "Approved", "Cancelled", "Declined"]);
const PARTS = new Set(["Morning", "Afternoon", "Hours"]);
/** Bookings from the holidays endpoint. `reason` and `declineReason` are never read: they can carry medical detail. */
export function normaliseBookings(page: unknown): { rows: BookingRow[]; totalRecords: number | null; nextPageLink: string | null } {
  if (!isObj(page) || !Array.isArray(page.holidays)) throw new Error("Timetastic bookings page was unreadable");
  const rows: BookingRow[] = [];
  for (const h of page.holidays) {
    if (!isObj(h) || h.id === undefined || h.userId === undefined) throw new Error("A Timetastic booking was unreadable");
    const status = String(h.status);
    if (!STATUSES.has(status)) throw new Error("A Timetastic booking had an unknown status");
    const local = (v: unknown) => (str(v) ?? "").slice(0, 19);
    rows.push({
      bookingId: String(h.id), ttUserId: String(h.userId), leaveTypeId: String(h.leaveTypeId), leaveTypeName: str(h.leaveType), status,
      startAt: local(h.startDate), startType: PARTS.has(String(h.startType)) ? String(h.startType) : "Morning",
      endAt: local(h.endDate), endType: PARTS.has(String(h.endType)) ? String(h.endType) : "Afternoon",
      bookingUnit: h.bookingUnit === "Hours" ? "Hours" : "Days",
      duration: typeof h.duration === "number" ? h.duration : null, deduction: typeof h.deduction === "number" ? h.deduction : null,
      requestedById: h.requestedById === undefined || h.requestedById === null ? null : String(h.requestedById),
      actionerId: h.actionerId === undefined || h.actionerId === null ? null : String(h.actionerId),
      autoApproved: h.autoApproved === true, updatedAt: str(h.updatedAt),
    });
  }
  return { rows, totalRecords: typeof page.totalRecords === "number" ? page.totalRecords : null, nextPageLink: str(page.nextPageLink) };
}

export type TtDayRow = { ttUserId: string; day: Ymd; kind: "booking" | "public_holiday" | "non_working"; entityKey: string; detail: string | null; startLocal: string | null; endLocal: string | null };
/**
 * absences type 1: per user and day, bookings, public holidays and
 * non-working days. A booking's detail is never kept (it can be the reason);
 * a public holiday keeps its name. Birthdays, anniversaries and locked
 * dates are dropped.
 */
export function normaliseAbsences(list: unknown): TtDayRow[] {
  if (!Array.isArray(list)) throw new Error("Timetastic absences were not a list");
  const out: TtDayRow[] = [];
  for (const d of list) {
    if (!isObj(d)) continue;
    const day = (str(d.date) ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    for (const a of Array.isArray(d.absences) ? d.absences : []) {
      if (!isObj(a) || a.userId === undefined || a.userId === null) continue;
      const type = String(a.absenceType);
      const kind = type === "Booking" ? "booking" : type === "PublicHoliday" ? "public_holiday" : type === "NonWorkingDay" ? "non_working" : null;
      if (!kind) continue;
      out.push({
        ttUserId: String(a.userId), day, kind,
        entityKey: kind === "non_working" ? "nwd" : String(a.entityId ?? (kind === "public_holiday" ? str(a.detail) ?? "ph" : "")),
        detail: kind === "public_holiday" ? (str(a.detail) ?? "Public holiday").slice(0, 120) : null,
        startLocal: kind === "booking" ? (str(a.start) ?? null) : null,
        endLocal: kind === "booking" ? (str(a.end) ?? null) : null,
      });
    }
  }
  return out;
}
