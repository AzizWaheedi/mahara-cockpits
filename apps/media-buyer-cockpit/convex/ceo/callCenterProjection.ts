import type { CallCenterMetrics, CallCenterReport } from "./callCenterContract";
import type { CallsPayload, CallWindow } from "./payloads";

/** Only additive call counts are projected from daily rows; distinct leads and speed use RPC totals. */
function window(rows: CallCenterMetrics[]): CallWindow {
  const sum = (
    key: "dials" | "providerDials" | "connections" | "talkSeconds",
  ) => rows.reduce((n, row) => n + row[key], 0);
  const providerDials = sum("providerDials");
  const connected = sum("connections");
  const talkSeconds = sum("talkSeconds");
  return {
    dials: sum("dials"),
    providerDials,
    connected,
    connectRate: providerDials ? connected / providerDials : null,
    talkMinutes: talkSeconds / 60,
    avgTalkSec: connected ? talkSeconds / connected : null,
    conversations90s: null,
  };
}
const previous = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function projectCallCenterReports(
  report: CallCenterReport,
  last7: CallCenterReport,
): CallsPayload {
  if (report.to !== last7.to || last7.from !== previous(report.to, -6))
    throw new Error("Call center comparison windows do not match.");
  const today = report.to;
  const from14 = previous(today, -13);
  const since = last7.from;
  const seconds = last7.overall.medianSpeedSeconds;
  return {
    report,
    report7d: last7,
    today: window(report.daily.filter(row => row.day === today)),
    yesterday: window(
      report.daily.filter(row => row.day === previous(today, -1)),
    ),
    last7: window([last7.overall]),
    prevLast7: window(
      report.daily.filter(row => row.day >= from14 && row.day < since),
    ),
    daily: report.daily.map(row => ({
      date: row.day,
      dials: row.dials,
      connected: row.connections,
      conversations90s: null,
    })),
    byAgent: [],
    byHourToday: [],
    perClient7d: last7.clients.map(row => ({
      client: row.name,
      clickupTaskId: null,
      dials: row.dials,
      connected: row.connections,
      leadsCalled: row.leadsDialed,
      // Dial activity and creation-cohort leads are different populations.
      callsPerLead: null,
    })),
    speedToLead: {
      medianMinutes7d: null,
      within5minShare7d: null,
      sample: last7.overall.speedSamples,
      since,
      workingMedianMinutes7d: seconds === null ? null : seconds / 60,
      workingWithin5minShare7d: null,
      withinTwoMinutesRate7d: last7.overall.withinTwoMinutesRate,
    },
    lastCallAt: null,
    notes: [...new Set([...report.warnings, ...last7.warnings])].map(text => ({
      level: "warn",
      text,
    })),
  };
}
