import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CsmState,
  csmPreferences,
  readCsmState,
  visibleLooseEnds,
} from "./csmStateClient";
import { newestPublish } from "./freshness";

type Row = Record<string, any>;
const norm = (x: unknown) =>
  String(x ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const TABLES = [
  "clients",
  "csTasks",
  "kpi",
  "appointments",
  "rosterDays",
  "churnEvents",
  "syncRuns",
  "clientProfiles",
  "decisions",
  "reportDocs",
  "outbox",
];
export type CsmSource = { tables: Record<string, Row[]>; source: Row };
export async function readCsmSources(
  client: SupabaseClient,
): Promise<CsmSource> {
  const { data, error } = await client.rpc("cockpit_csm_source_read");
  if (error) throw Error(error.message);
  if (
    !data?.tables ||
    TABLES.some(k => !Array.isArray(data.tables[k])) ||
    !data.source?.snapshotAt
  )
    throw Error("Client-success source coverage was not confirmed");
  return data;
}
export function currentCsmProfiles(rows: Row[]) {
  const best = new Map<string, Row>();
  const pushed = (p: Row) => {
    const ms = Number(
      String(p.syncId ?? "")
        .split("-")
        .at(-1),
    );
    return Number.isFinite(ms) && ms > 0 ? ms : (p.syncedAt ?? 0);
  };
  for (const p of rows) {
    const key = norm(p.clientName),
      old = best.get(key);
    if (
      !old ||
      pushed(p) > pushed(old) ||
      (pushed(p) === pushed(old) &&
        (Boolean(p.links?.sheet) !== Boolean(old.links?.sheet)
          ? Boolean(p.links?.sheet)
          : p._creationTime > old._creationTime))
    )
      best.set(key, p);
  }
  return [...best.values()];
}
export function csmChurn(tables: Record<string, Row[]>, month: string) {
  const days = tables.rosterDays
    .filter(d => d.month === month)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length) return null;
  const first = days[0],
    latest = days.at(-1)!,
    baseline = first.clients.filter((c: Row) => c.paying),
    now = new Map<string, Row>(latest.clients.map((c: Row) => [c.key, c])),
    events = tables.churnEvents.filter(e => e.month === month),
    lost: Row[] = [],
    stillPaused: Row[] = [];
  for (const b of baseline) {
    const current = now.get(b.key),
      event = events
        .filter(e => e.key === b.key && e.kind === "lost")
        .sort((a, b) => b.day.localeCompare(a.day))[0];
    if (!current) {
      lost.push({
        key: b.key,
        name: b.name,
        reason: "removed from the board",
        day: event?.day,
      });
      continue;
    }
    if (!current.paying) {
      const c = tables.clients.find(
          c => c.name === b.name || c.taskId === b.key,
        ),
        paused =
          !/stop|cancel|churn|lost|offboard/i.test(current.status) &&
          /pause|freeze|hold/i.test(current.status),
        rawAge = c?.pausedDays ?? c?.pauseDays,
        age =
          typeof rawAge === "number" && Number.isFinite(rawAge) ? rawAge : null;
      if (paused && (age === undefined || age === null || age < 14)) {
        stillPaused.push({ name: b.name, days: age ?? null });
        continue;
      }
      lost.push({
        key: b.key,
        name: b.name,
        reason: paused
          ? `paused ${age}d, past the 14-day line`
          : current.status,
        day: event?.day,
      });
    }
  }
  for (const e of events.filter(e => e.kind === "offboarded"))
    if (!lost.some(l => l.key === e.key || norm(l.name) === norm(e.name)))
      lost.push({
        key: e.key,
        name: e.name,
        reason: "offboarded (your EOD)",
        day: e.day,
      });
  const count = (kinds: string[]) =>
    new Set(events.filter(e => kinds.includes(e.kind)).map(e => e.key)).size;
  return {
    month,
    pct: baseline.length
      ? Math.round((lost.length / baseline.length) * 1000) / 10
      : null,
    baselineDay: first.day,
    baseline: baseline.length,
    lost: lost.length,
    lostClients: lost,
    latestDay: latest.day,
    daysTracked: days.length,
    partial: !first.day.endsWith("-01"),
    extensions: count(["extension"]),
    pausedThisMonth: count(["paused", "paused_by_csm"]),
    stillPaused,
  };
}
export function buildCsmReadModel(
  source: CsmSource,
  state: CsmState,
  local: {
    checks: Row[];
    decisions: Row[];
    plan: Row[];
    eod: any;
    eodOwner: string;
    eodDay: string;
  },
) {
  const t = source.tables,
    day = state.day,
    month = state.month;
  const sourceDecisions = t.decisions.filter(d => d.role === "csm");
  const seen = new Set(local.decisions.map(d => String(d.source_id ?? d._id)));
  const decisions = [
    ...sourceDecisions.filter(d => d.day === day && !seen.has(String(d._id))),
    ...local.decisions,
  ];
  const hotUsed = new Set(
    [...sourceDecisions, ...(t.liveDecisions ?? []), ...local.decisions]
      .filter(
        d =>
          String(d.day ?? day).startsWith(month) &&
          d.kind !== "left" &&
          /upsell|referral|review/i.test(d.action),
      )
      .map(d => norm(d.subject)),
  );
  const clientProfiles = currentCsmProfiles(t.clientProfiles);
  const clients = t.clients
    .map(c => {
      if (
        typeof c.name !== "string" ||
        typeof c.stage !== "string" ||
        typeof c.rank !== "number" ||
        !Array.isArray(c.hot) ||
        !Array.isArray(c.loose)
      )
        throw Error(
          "A client source row is incomplete; refresh the source projection",
        );
      const edits = state.profiles.find(
        p => norm(p.client_name) === norm(c.name),
      );
      const confirmed = (t.clientOverrides ?? []).find(
        o => o.task_id === c.taskId,
      );
      const patch =
        confirmed && Date.parse(confirmed.confirmed_at) > (c.syncedAt ?? 0)
          ? confirmed.data
          : {};
      return {
        ...c,
        ...patch,
        profile:
          clientProfiles.find(p => norm(p.clientName) === norm(c.name)) ?? null,
        staffProfile: edits ?? null,
        hotBlocked: hotUsed.has(norm(c.name)),
        loose: visibleLooseEnds(state, c.name, c.loose),
      };
    })
    .sort((a, b) => a.rank - b.rank);
  const appointments = [...t.appointments].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  const runs = [...t.syncRuns].sort((a, b) => b.at - a.at),
    lastRun = runs.find(r => r.role === "csm"),
    health = runs.find(r => r.kind === "health");
  // The native worker publishes the live tables and writes no syncRuns row.
  const published = newestPublish(source.source);
  const nativeNewer =
    published !== null && published > (health?.at ?? lastRun?.at ?? 0);
  const syncHealth = nativeNewer
    ? {
        at: published,
        ok: true,
        profiles: health?.profiles ?? null,
        errors: [],
      }
    : health
      ? {
          at: health.at,
          ok: health.ok,
          profiles: health.profiles ?? null,
          errors: health.errors ?? [],
        }
      : null;
  return {
    day,
    month,
    appointments,
    todaysCalls: appointments.filter(
      a => a.day === day && a.status !== "cancelled",
    ),
    prefs: csmPreferences(state),
    hotRows: state.hotRows,
    kpis: t.kpi,
    churn: csmChurn(t, month),
    money: state.money,
    clients,
    tasks: t.csTasks,
    checks: local.checks,
    decisions,
    plan: local.plan,
    eod: local.eod,
    eodOwner: local.eodOwner,
    eodDay: local.eodDay,
    lastSyncAt: nativeNewer ? published : (lastRun?.at ?? null),
    syncHealth,
    source: source.source,
    totals: {
      clients: clients.length,
      dueToday: clients.filter(c => c.rank < 40 && c.level !== "green").length,
      newSignups: clients.filter(c => c.newSignup).length,
      pauses: clients.filter(c => c.pauseRequired).length,
      onboarding: clients.filter(c => c.bucket === "onboarding").length,
      managed: clients.filter(c => c.bucket === "management").length,
      pastDue: clients.filter(c => c.paymentDue != null && c.paymentDue >= 1)
        .length,
      hot: clients.filter(c => c.hot.length && !c.hotBlocked).length,
      loose: clients.reduce((sum, c) => sum + c.loose.length, 0),
      healthy: clients.filter(c => c.level === "green").length,
    },
  };
}
export async function readCsmClientProfile(
  client: SupabaseClient,
  args: { clientName: string },
) {
  const [source, state] = await Promise.all([
    readCsmSources(client),
    readCsmState(client),
  ]);
  const tables = source.tables;
  const p = currentCsmProfiles(tables.clientProfiles).find(
    p => norm(p.clientName) === norm(args.clientName),
  );
  if (!p) return null;
  const original = tables.clients.find(
    c => norm(c.name) === norm(args.clientName),
  );
  const confirmed = (tables.clientOverrides ?? []).find(
    o => o.task_id === original?.taskId,
  );
  const patch =
    confirmed && Date.parse(confirmed.confirmed_at) > (original?.syncedAt ?? 0)
      ? confirmed.data
      : {};
  const c = { ...original, ...patch };
  const { data: nativeReports, error: reportError } = await client.rpc(
    "cockpit_csm_report_history",
    { p_client_name: args.clientName },
  );
  if (reportError) throw Error(reportError.message);
  if (!Array.isArray(nativeReports))
    throw Error("Native report history is unavailable");
  return {
    ...p,
    stage: patch.stage ?? p.stage ?? c?.stage,
    happiness: patch.happiness ?? p.happiness ?? c?.happiness,
    language:
      state.prefs.find(p => norm(p.clientName) === norm(args.clientName))
        ?.language ?? "en",
    liveDays: p.liveDays ?? c?.liveDays,
    pocDays: c?.silentDays,
    callDays: c?.callDays,
    reportDays: c?.reportDays,
    reportTracked: c?.reportTracked,
    csmAssigned: c?.csmAssigned,
    reports: [...tables.reportDocs, ...nativeReports]
      .filter(r => norm(r.clientName) === norm(args.clientName))
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, 5),
  };
}

export function csmPerformance(
  tables: Record<string, Row[]>,
  now = Date.now(),
) {
  const rows = currentCsmProfiles(tables.clientProfiles);
  // The media buyer sync already sorts every card into management,
  // onboarding or inactive from its ClickUp stage; that is the one place
  // the rule lives. The stage regex below is only the fallback for a
  // profile with no client row.
  const byName = new Map<string, { bucket?: string; stage?: string }>();
  for (const c of tables.clients)
    byName.set(String(c.name ?? "").toLowerCase(), {
      bucket: (c as Row).bucket,
      stage: (c as Row).stage,
    });
  // Active, onboarding, paused or churned: the same rule for the table and
  // the charts, so a tab filters both. [Aziz, 2026-09-14]
  const groupOf = (r: Row): string => {
    const cl = byName.get(String(r.clientName).toLowerCase());
    const stage = String(r.stage ?? cl?.stage ?? "");
    return cl?.bucket === "onboarding"
      ? "onboarding"
      : cl?.bucket === "management"
        ? "active"
        : cl?.bucket === "inactive"
          ? /pause|freeze|hold/i.test(stage)
            ? "paused"
            : "churned"
          : /contact|booked|ready for launch|ghosted|delay|blueprint/i.test(
                stage,
              )
            ? "onboarding"
            : /pause|freeze|hold/i.test(stage)
              ? "paused"
              : /stop|cancel|churn|offboard|lost/i.test(stage)
                ? "churned"
                : "active";
  };
  // Trends across the book: leads and spend per day from the ads, booked
  // and show rate per week from the sheets, last 90 days.
  const since = new Date(now - 90 * 86400_000).toISOString().slice(0, 10);
  const byDate = new Map<string, { leads: number; spend: number }>();
  const byWeek = new Map<
    string,
    { booked: number; shows: number; noshows: number }
  >();
  const weekOf = (d: string) => {
    const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  const byDateG = new Map<string, typeof byDate>();
  const byWeekG = new Map<string, typeof byWeek>();
  for (const r of rows) {
    const g = groupOf(r);
    const dates = byDateG.get(g) ?? new Map();
    byDateG.set(g, dates);
    const weeks = byWeekG.get(g) ?? new Map();
    byWeekG.set(g, weeks);
    for (const d of ((r.adLeads as Row)?.daily ?? []) as Row[]) {
      if (d.date < since) continue;
      for (const m of [byDate, dates]) {
        const row = m.get(d.date) ?? { leads: 0, spend: 0 };
        row.leads += Number(d.leads ?? 0);
        row.spend += Number(d.spend ?? 0);
        m.set(d.date, row);
      }
    }
    for (const a of ((r.performance as Row)?.appointments ?? []) as Row[]) {
      const day = a.added ? String(a.added).slice(0, 10) : "";
      if (!day || day < since) continue;
      for (const m of [byWeek, weeks]) {
        const w = m.get(weekOf(day)) ?? {
          booked: 0,
          shows: 0,
          noshows: 0,
        };
        if (a.booked) w.booked++;
        if (a.show === "y") w.shows++;
        if (a.show === "n") w.noshows++;
        m.set(weekOf(day), w);
      }
    }
  }
  const toTrend = (m: typeof byDate) =>
    [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, r]) => ({
        date,
        leads: r.leads,
        spend: Math.round(r.spend * 100) / 100,
        cpl: r.leads ? Math.round((r.spend / r.leads) * 100) / 100 : null,
      }));
  const trend = toTrend(byDate);
  const toWeekly = (m: typeof byWeek) =>
    [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([week, w]) => ({
        week,
        booked: w.booked,
        showRate:
          w.shows + w.noshows
            ? Math.round((100 * w.shows) / (w.shows + w.noshows))
            : null,
      }));
  const weeklyOutcomes = toWeekly(byWeek);
  const groups = ["active", "onboarding", "paused"];
  return {
    trend,
    weeklyOutcomes,
    trendByGroup: Object.fromEntries(
      groups.map(g => [g, toTrend(byDateG.get(g) ?? new Map())]),
    ),
    weeklyByGroup: Object.fromEntries(
      groups.map(g => [g, toWeekly(byWeekG.get(g) ?? new Map())]),
    ),
    syncedAt: rows.length ? Math.max(...rows.map(r => r.syncedAt)) : null,
    clients: rows
      .map(r => {
        const cl = byName.get(String(r.clientName).toLowerCase());
        const group = groupOf(r);
        const perf = r.performance as
          | {
              month?: Record<string, number>;
              lastMonth?: Record<string, number>;
              staleCount?: number;
              error?: string;
              source?: string;
            }
          | undefined;
        return {
          clientName: r.clientName,
          stage: r.stage ?? cl?.stage,
          group,
          happiness: r.happiness,
          liveDays: r.liveDays,
          service: r.service,
          hasSheet: Boolean((r.links as Record<string, string>)?.sheet),
          month: perf?.month ?? null,
          lastMonth: perf?.lastMonth ?? null,
          staleCount: perf?.staleCount ?? null,
          sheetError: perf?.error,
          live: r.live ?? null,
          adsAccess: r.adsAccess ?? null,
          // Whose weekly report reminder is still sitting unapproved in #csm-general.
          reportNudge: r.reportNudge ?? null,
          links: r.links ?? {},
        };
      })
      .sort((a, b) => (b.staleCount ?? 0) - (a.staleCount ?? 0)),
  };
}

export async function readCsmPerformance(client: SupabaseClient) {
  return csmPerformance((await readCsmSources(client)).tables);
}
