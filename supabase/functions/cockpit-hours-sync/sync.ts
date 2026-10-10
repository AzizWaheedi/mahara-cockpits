/**
 * One read of Hubstaff and Timetastic, per mode (design.md 2.2 and 2.3).
 *
 * recent  every hour at :17: Hubstaff members, yesterday and today, last
 *         activities; Timetastic bookings (from the lookback) and this
 *         month's day list.
 * deep    02:40 Kuwait: Hubstaff from the 1st of last month (on Saturdays
 *         the months before as well, back to Hubstaff's earliest records,
 *         175 days, so late edits to approved months show up); Timetastic
 *         users, schedules, payroll ids of unlinked users,
 *         leave types, bookings and last and this month's day lists.
 * month   the CEO's "Load {month}": both providers for that month.
 * doctor  the key checks: one call of each kind, nothing written but state.
 *
 * Complete or nothing: a window is applied only if every page was read; a
 * failed window writes no rows, sweeps nothing and stamps no coverage. The
 * two providers are independent: one failing never stops the other.
 */
import { HoursProviderError, hubstaffGet, timetasticGet } from "../cockpit-ceo-api/tools.ts";
import { type InsertReceipt, type Rpc, runHealth } from "./db.ts";
import { hubstaffAccess, timetasticAccess } from "./keys.ts";
import { finishRun, type Mode, type ProviderSummary, renewLease } from "./lease.ts";
import {
  type AccountRow, addDays, addMonths, bookingLookbackStart, buildHubstaffDays, chunkDays, daysBetween, kuwaitDayOf, kuwaitStartUtc,
  monthEnd, monthStart, normaliseAbsences, normaliseBookings, normaliseContact, normaliseLastActivities, normaliseLeaveTypes,
  normaliseMembers, normaliseTtUsers, type HubstaffDayRow, workDaysOf,
} from "./normalise.ts";

export type SyncDeps = {
  rpc: Rpc;
  insertReceipt: InsertReceipt;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};
export type RunInput = { runId: number; leaseToken: string; mode: Mode; month?: string | null; dryRun?: boolean };
export type RunResult = { state: "ok" | "failed"; hubstaff: ProviderSummary; timetastic: ProviderSummary; crosscheck: Record<string, number> };

export class WindowError extends Error {}
const MAX_HUBSTAFF_PAGES = 50;
const MAX_TIMETASTIC_PAGES = 100;

function noteOf(e: unknown): string {
  if (e instanceof HoursProviderError || e instanceof WindowError) return e.message.slice(0, 200);
  if (e instanceof Error && /lease|newer read|nothing was written/i.test(e.message)) return e.message.slice(0, 200);
  return "The read stopped unexpectedly; nothing from the unfinished window was written.";
}

/** Minimum gaps between Timetastic calls: 4 a second, 1.1 seconds around absences. */
export function makePacer(sleep: (ms: number) => Promise<void>, nowMs: () => number) {
  let last = Number.NEGATIVE_INFINITY;
  return async (gapMs: number) => {
    const wait = last + gapMs - nowMs();
    if (wait > 0) await sleep(wait);
    last = nowMs();
  };
}

/**
 * Hubstaff's 10-minute records start "6 months ago" (its docs for
 * /activities). A window starts no earlier than this many days back, so the
 * day read either side, Kuwait's offset and the shortest reading of "6
 * months" (180 days; six calendar months are 181 to 184) all stay inside
 * it. Days before it are never asked for, so they are never swept and never
 * stamped as covered: their earlier rows stand as they are.
 */
export const HUBSTAFF_RECORD_DAYS = 175;
export function hubstaffEarliest(today: string): string {
  return addDays(today, -HUBSTAFF_RECORD_DAYS);
}

/** The Hubstaff windows a mode reads, in Kuwait days, never past today and never before Hubstaff's earliest records. */
export function hubstaffWindows(mode: Mode, today: string, month?: string | null): { from: string; to: string }[] {
  const earliest = hubstaffEarliest(today);
  const clamp = (w: { from: string; to: string }) => ({ from: w.from < earliest ? earliest : w.from, to: w.to > today ? today : w.to });
  const keep = (ws: { from: string; to: string }[]) => ws.map(clamp).filter(w => w.from <= w.to);
  if (mode === "recent") return keep([{ from: addDays(today, -1), to: today }]);
  if (mode === "month" && month) return keep([{ from: `${month}-01`, to: monthEnd(`${month}-01`) }]);
  if (mode !== "deep") return [];
  const out: { from: string; to: string }[] = [];
  const saturday = new Date(`${today}T00:00:00Z`).getUTCDay() === 6;
  const back = saturday ? 7 : 1;
  for (let i = back; i >= 0; i--) {
    const start = addMonths(monthStart(today), -i);
    out.push({ from: start, to: monthEnd(start) });
  }
  return keep(out);
}

export async function runSync(deps: SyncDeps, run: RunInput): Promise<RunResult> {
  const { health, count } = runHealth(deps.insertReceipt, run.runId);
  const today = kuwaitDayOf(deps.now());
  const crosscheck: Record<string, number> = { hubstaffDays: 0, unverifiedDays: 0, zoneShiftedDays: 0 };
  const dry = run.dryRun === true;
  const renew = async () => {
    if (!(await renewLease(deps.rpc, run.runId, run.leaseToken))) throw new WindowError("This read lost its lease; it stops here.");
  };

  // ------------------------------------------------------------------ Hubstaff
  const hubstaff: ProviderSummary = { state: "ok", calls: 0, rows: 0, accounts: 0, note: null };
  const hsStart = count();
  // The key version this read used: a verdict on it never lands on a key pasted meanwhile.
  let hsVersion: { version: number } | Record<string, never> = {};
  try {
    const access = await hubstaffAccess(deps.rpc, health, deps.fetch, deps.now);
    if (!access.ok) {
      hubstaff.state = access.state;
      hubstaff.note = access.note;
    } else {
      hsVersion = { version: access.version };
      const get = (path: string, params: Record<string, string | number>) => hubstaffGet(access.token, health, deps.fetch, path, params, { sleep: deps.sleep });
      const org = `organizations/${access.accountId}`;
      const pages = async (path: string, params: Record<string, string | number>) => {
        const out: unknown[] = [];
        let start: string | null = null;
        for (let i = 0; i < MAX_HUBSTAFF_PAGES; i++) {
          const page = await get(path, { ...params, page_limit: 500, ...(start ? { page_start_id: start } : {}) });
          out.push(page);
          const next = (page.pagination as Record<string, unknown> | undefined)?.next_page_start_id;
          if (next === undefined || next === null || next === "") return out;
          start = String(next);
        }
        throw new WindowError("Hubstaff had more than 50 pages for one read; nothing from it was written.");
      };
      if (run.mode === "doctor") {
        await get("organizations", {});
        const members = normaliseMembers(await pages(`${org}/members`, { include: "users", include_removed: "true" }));
        // The token holder's role: only an owner or a manager can read everyone's time.
        // An organisation token belongs to the organisation, not to a person: when
        // users/me doesn't name a member (or isn't answered for it), its role is
        // unknown, never "not a manager". It has just read the organisation and its
        // members, so it is not refused for that; the activities read below decides.
        let role: string | null | undefined;
        try {
          const me = await get("users/me", {});
          const myId = String(((me.user ?? me) as Record<string, unknown> | null)?.id ?? "");
          const holder = members.find(m => m.externalId === myId);
          role = holder ? (holder.membershipRole ?? null) : access.kind === "hubstaff_org" ? undefined : null;
        } catch (e) {
          if (access.kind !== "hubstaff_org" || (e instanceof HoursProviderError && e.kind === "firewall_blocked")) throw e;
          role = undefined;
        }
        hubstaff.accounts = members.filter(m => m.status === "active").length;
        if (role !== undefined && role !== "owner" && role !== "manager") {
          hubstaff.state = "refused";
          hubstaff.note = "This Hubstaff key belongs to an account that can't read everyone's time.";
          if (!dry) await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "refused", note: "role_not_manager", version: access.version } });
        } else {
          const y = addDays(today, -1);
          await get(`${org}/activities`, { "time_slot[start]": kuwaitStartUtc(y), "time_slot[stop]": kuwaitStartUtc(today), page_limit: 1 });
          hubstaff.note = role === undefined
            ? `Hubstaff answered: ${hubstaff.accounts} active members; the organisation token can read their time.`
            : `Hubstaff answered: ${hubstaff.accounts} active members; the key is the ${role}'s and can read their time.`;
          if (!dry) await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "connected", accountId: access.accountId, version: access.version } });
        }
      } else {
        const members = normaliseMembers(await pages(`${org}/members`, { include: "users", include_removed: "true" }));
        if (run.mode === "recent") {
          const last = normaliseLastActivities(await pages(`${org}/last_activities`, {}));
          for (const m of members) {
            const l = last.get(m.externalId);
            if (l) Object.assign(m, { online: l.online, lastActivityAt: l.lastActivityAt, lastClientActivityOn: l.lastClientActivityOn ?? m.lastClientActivityOn });
          }
        }
        const activeIds = members.filter(m => m.status === "active").map(m => m.externalId);
        hubstaff.accounts = activeIds.length;
        const failures: string[] = [];
        let accountsSent = false;
        for (const w of hubstaffWindows(run.mode, today, run.month)) {
          const readStartedAt = deps.now().toISOString();
          try {
            const days = await readHubstaffWindow(pages, org, w.from, w.to, today, deps.now());
            crosscheck.hubstaffDays += days.length;
            crosscheck.unverifiedDays += days.filter(d => !d.verified).length;
            crosscheck.zoneShiftedDays += days.filter(d => d.zoneShifted).length;
            hubstaff.rows += days.length;
            if (!dry) {
              await deps.rpc("cockpit_hours_sync_apply", { p: {
                runId: run.runId, leaseToken: run.leaseToken, provider: "hubstaff", readStartedAt, window: w,
                accounts: accountsSent ? [] : members, activeAccountIds: activeIds, hubstaffDays: days, coverageDays: daysBetween(w.from, w.to),
              } });
              accountsSent = true;
              await renew();
            }
          } catch (e) {
            if (e instanceof HoursProviderError && (e.kind === "refused" || e.kind === "plan_blocked" || e.kind === "firewall_blocked")) throw e;
            failures.push(`${w.from} to ${w.to}: ${noteOf(e)}`);
          }
        }
        if (!accountsSent && !dry && members.length && failures.length === 0) {
          await deps.rpc("cockpit_hours_sync_apply", { p: { runId: run.runId, leaseToken: run.leaseToken, provider: "hubstaff",
            readStartedAt: deps.now().toISOString(), window: { from: today, to: today }, accounts: members, activeAccountIds: [], hubstaffDays: [], coverageDays: [] } });
        }
        if (failures.length) {
          hubstaff.state = "failed";
          hubstaff.note = failures.slice(0, 3).join(" · ").slice(0, 240);
        } else if (!dry && access.state !== "connected") {
          // A key saved unchecked, or stopped by the firewall, is connected once a read goes through.
          await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "connected", version: access.version } }).catch(() => undefined);
        }
      }
    }
  } catch (e) {
    // The firewall (Cloudflare, 403 error 1010) is not the key's fault: its own state, never "refused".
    if (e instanceof HoursProviderError && (e.kind === "refused" || e.kind === "plan_blocked" || e.kind === "firewall_blocked")) {
      hubstaff.state = e.kind;
      if (!dry) await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: e.kind, note: e.message, ...hsVersion } }).catch(() => undefined);
    } else hubstaff.state = "failed";
    hubstaff.note = noteOf(e);
  }
  hubstaff.calls = Math.floor((count() - hsStart) / 2);

  // ---------------------------------------------------------------- Timetastic
  const timetastic: ProviderSummary = { state: "ok", calls: 0, rows: 0, accounts: 0, note: null };
  const ttStart = count();
  let ttVersion: { version: number } | Record<string, never> = {};
  try {
    const access = await timetasticAccess(deps.rpc);
    if (!access.ok) {
      timetastic.state = access.state;
      timetastic.note = access.note;
    } else {
      ttVersion = { version: access.version };
      const pace = makePacer(deps.sleep, () => deps.now().getTime());
      const tt = async (path: string, params: Record<string, string | number | boolean> = {}, gap = 250) => {
        await pace(gap);
        return timetasticGet(access.token, health, deps.fetch, path, params, { sleep: deps.sleep });
      };
      if (run.mode === "doctor") {
        const users = normaliseTtUsers(await tt("users"));
        timetastic.accounts = users.filter(u => u.status === "active").length;
        timetastic.note = `Timetastic answered: ${timetastic.accounts} people.`;
        if (!dry) await deps.rpc("cockpit_hours_key_state", { p: { provider: "timetastic", state: "connected", version: access.version } });
      } else {
        const months = run.mode === "month" && run.month ? [`${run.month}-01`]
          : run.mode === "deep" ? [addMonths(monthStart(today), -1), monthStart(today)] : [monthStart(today)];
        const readStartedAt = deps.now().toISOString();
        let accounts: AccountRow[] = [];
        let archived: string[] | null = null;
        let leaveTypes: ReturnType<typeof normaliseLeaveTypes> = [];
        if (run.mode === "deep") {
          accounts = normaliseTtUsers(await tt("users", { includeArchivedUsers: true }));
          archived = accounts.filter(a => a.status === "archived").map(a => a.externalId);
          const links = (await deps.rpc("cockpit_hours_account_links", { p_provider: "timetastic" })) as { externalId: string; linked: boolean }[] | null;
          const linked = new Set((links ?? []).filter(l => l.linked).map(l => l.externalId));
          for (const a of accounts.filter(x => x.status === "active")) {
            const detail = await tt(`users/${a.externalId}`);
            const workDays = workDaysOf(detail, today);
            if (workDays) a.extra = { ...(a.extra ?? {}), workDays };
            if (!linked.has(a.externalId)) {
              const c = normaliseContact(await tt(`users/contact/${a.externalId}`));
              a.payrollId = c.payrollId;
              a.jobTitle = c.jobTitle;
            }
          }
          leaveTypes = normaliseLeaveTypes(await tt("leavetypes", { includeInactive: true }));
        }
        const firstMonth = months[0];
        const lastMonthEnd = monthEnd(months[months.length - 1]);
        const lookback = bookingLookbackStart(firstMonth, today);
        const bookings: ReturnType<typeof normaliseBookings>["rows"] = [];
        let total: number | null = null;
        let link = "holidays";
        let params: Record<string, string | number | boolean> = { Start: lookback, End: lastMonthEnd, Status: "Any" };
        let complete = false;
        for (let i = 0; i < MAX_TIMETASTIC_PAGES; i++) {
          const page = normaliseBookings(await tt(link, params));
          if (total === null) total = page.totalRecords;
          bookings.push(...page.rows);
          if (!page.nextPageLink) { complete = true; break; }
          link = page.nextPageLink;
          params = {};
        }
        if (!complete) throw new WindowError("Timetastic had more pages of bookings than the safe limit; nothing was written.");
        if (total === null || bookings.length !== total || new Set(bookings.map(b => b.bookingId)).size !== bookings.length)
          throw new WindowError(`Timetastic listed ${total ?? "an unknown number of"} bookings but sent ${bookings.length}; nothing was written.`);
        const ttDays: ReturnType<typeof normaliseAbsences> = [];
        const coverage: string[] = [];
        for (const m of months) {
          const end = monthEnd(m);
          ttDays.push(...normaliseAbsences(await tt("absences", { Start: m, End: end, AbsenceQueryType: 1 }, 1100)));
          coverage.push(...daysBetween(m, end));
          await pace(1100);
        }
        timetastic.rows = bookings.length + ttDays.length;
        timetastic.accounts = accounts.filter(a => a.status === "active").length;
        if (!dry) {
          await deps.rpc("cockpit_hours_sync_apply", { p: {
            runId: run.runId, leaseToken: run.leaseToken, provider: "timetastic", readStartedAt, window: { from: firstMonth, to: lastMonthEnd },
            accounts, leaveTypes, bookings, bookingsRange: { from: lookback, to: lastMonthEnd }, archivedUserIds: archived ?? [],
            ttDays, ttDaysRange: { from: firstMonth, to: lastMonthEnd }, coverageDays: coverage,
          } });
          await renew();
          if (access.state !== "connected")
            await deps.rpc("cockpit_hours_key_state", { p: { provider: "timetastic", state: "connected", version: access.version } }).catch(() => undefined);
        }
      }
    }
  } catch (e) {
    if (e instanceof HoursProviderError && e.kind === "refused") {
      timetastic.state = "refused";
      if (!dry) await deps.rpc("cockpit_hours_key_state", { p: { provider: "timetastic", state: "refused", note: e.message, ...ttVersion } }).catch(() => undefined);
    } else timetastic.state = "failed";
    timetastic.note = noteOf(e);
  }
  timetastic.calls = Math.floor((count() - ttStart) / 2);

  if (run.mode === "deep" && !dry) await deps.rpc("cockpit_hours_prune", {}).catch(() => undefined);
  const failed = [hubstaff.state, timetastic.state].some(s => s === "failed");
  const state = failed ? "failed" : "ok";
  await finishRun(deps.rpc, run.runId, run.leaseToken, {
    state, hubstaff, timetastic, crosscheck,
    error: failed ? [hubstaff.state === "failed" ? `Hubstaff: ${hubstaff.note}` : null, timetastic.state === "failed" ? `Timetastic: ${timetastic.note}` : null].filter(Boolean).join(" ") : null,
  });
  return { state, hubstaff, timetastic, crosscheck };
}

/** One Hubstaff window: 10-minute records in 7-day chunks, daily totals in 31-day chunks, a day either side. */
async function readHubstaffWindow(
  pages: (path: string, params: Record<string, string | number>) => Promise<unknown[]>,
  org: string, from: string, to: string, today: string, now: Date,
): Promise<HubstaffDayRow[]> {
  const readFrom = addDays(from, -1);
  const readTo = addDays(to, 1) > today ? today : addDays(to, 1);
  const records: unknown[] = [];
  const dailies: unknown[] = [];
  const nowIso = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString().replace(".000Z", "Z");
  for (const c of chunkDays(readFrom, readTo, 7)) {
    const stop = kuwaitStartUtc(addDays(c.to, 1));
    for (const page of await pages(`${org}/activities`, { "time_slot[start]": kuwaitStartUtc(c.from), "time_slot[stop]": stop < nowIso ? stop : nowIso }))
      records.push(...((page as Record<string, unknown>).activities as unknown[] ?? []));
  }
  for (const c of chunkDays(readFrom, readTo, 31))
    for (const page of await pages(`${org}/activities/daily`, { "date[start]": c.from, "date[stop]": c.to }))
      dailies.push(...((page as Record<string, unknown>).daily_activities as unknown[] ?? []));
  return buildHubstaffDays(records, dailies, from, to);
}
