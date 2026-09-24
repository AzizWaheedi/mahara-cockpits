type CronRow = { job: string; at: number; everyMin: number };

// These are the schedules registered in crons.ts. Keep the monitoring clock
// and Convex registration on the same definitions, including the night gap.
export const JOB_SCHEDULES = {
  sync: { everyMin: 10, cron: ["*/10 3-18 * * *", "0 19-23,0-2 * * *"] },
  "market plays": { everyMin: 7 * 24 * 60, cron: ["0 2 * * 5"] },
  "assist queue": { everyMin: 10, interval: { minutes: 10 } },
  "outbox drains": { everyMin: 1, interval: { minutes: 1 } },
  "board KPI columns": { everyMin: 60, cron: ["5 3-18 * * *"] },
  "tracking audit": { everyMin: 24 * 60, cron: ["30 2 * * *"] },
  "smoke check": { everyMin: 15, cron: ["7,22,37,52 * * * *"] },
  "report docs": { everyMin: 3, interval: { minutes: 3 } },
  "hermes relay": { everyMin: 1, interval: { seconds: 20 } },
  "client comment watch": { everyMin: 15, interval: { minutes: 15 } },
  "ceo refresh": { everyMin: 15, interval: { minutes: 15 } },
  "hiring intake": { everyMin: 30, interval: { minutes: 30 } },
  "hiring board": { everyMin: 10, interval: { minutes: 10 } },
  "hiring engine": { everyMin: 10, interval: { minutes: 10 } },
} as const;

type JobName = keyof typeof JOB_SCHEDULES;
const GRACE_MS = 45 * 60_000;
const MINUTE_MS = 60_000;

function matchesField(field: string, value: number): boolean {
  return field.split(",").some(part => {
    const [range, stepText] = part.split("/");
    const [startText, endText] = range.split("-");
    const start = startText === "*" ? 0 : Number(startText);
    const end =
      endText === undefined
        ? range === "*"
          ? Infinity
          : start
        : Number(endText);
    return (
      value >= start &&
      value <= end &&
      (value - start) % Number(stepText ?? 1) === 0
    );
  });
}

function scheduledAt(expressions: readonly string[], at: number): boolean {
  const d = new Date(at);
  return expressions.some(expression => {
    const [minute, hour, day, month, weekday] = expression.split(" ");
    return (
      matchesField(minute, d.getUTCMinutes()) &&
      matchesField(hour, d.getUTCHours()) &&
      matchesField(day, d.getUTCDate()) &&
      matchesField(month, d.getUTCMonth() + 1) &&
      matchesField(weekday, d.getUTCDay())
    );
  });
}

/** Last scheduled UTC slot at or before now (weekly jobs need a full week). */
function lastSlot(expressions: readonly string[], now: number): number {
  const end = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  for (let t = end; t >= end - 8 * 24 * 60 * MINUTE_MS; t -= MINUTE_MS) {
    if (scheduledAt(expressions, t)) return t;
  }
  throw new Error(`No scheduled slot for ${expressions.join(", ")}`);
}

function nextSlot(expressions: readonly string[], at: number): number {
  const start = Math.floor(at / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let t = start; t <= start + 8 * 24 * 60 * MINUTE_MS; t += MINUTE_MS) {
    if (scheduledAt(expressions, t)) return t;
  }
  throw new Error(`No next scheduled slot for ${expressions.join(", ")}`);
}

export function scheduledJobHealth(
  stale: { job: string; minutes?: number }[],
): { source: string; ok: boolean; error?: string }[] {
  if (!stale.length) return [{ source: "jobs", ok: true }];
  return [
    {
      source: "jobs",
      ok: false,
      error:
        stale
          .slice(0, 5)
          .map(j =>
            j.minutes === undefined
              ? `"${j.job}" has never run`
              : `"${j.job}" last ran ${j.minutes} min ago`,
          )
          .join("; ") +
        (stale.length > 5 ? `; and ${stale.length - 5} more` : ""),
    },
  ];
}

/** Aggregate smoke health includes expected jobs with no recorded beat. */
export function overdueCronRows<T extends CronRow>(
  rows: T[],
  now: number,
  active: ReadonlySet<string>,
): (
  | (T & { minutes: number })
  | { job: string; at: undefined; minutes: undefined }
)[] {
  const byJob = new Map(rows.map(row => [row.job, row]));
  const overdue: (
    | (T & { minutes: number })
    | { job: string; at: undefined; minutes: undefined }
  )[] = [];
  for (const job of active) {
    const schedule = JOB_SCHEDULES[job as JobName];
    if (!schedule) throw new Error(`No health schedule for ${job}`);
    const row = byJob.get(job);
    const slot =
      "cron" in schedule
        ? row
          ? nextSlot(schedule.cron, row.at)
          : lastSlot(schedule.cron, now)
        : undefined;
    const late = row
      ? slot === undefined
        ? now - row.at > Math.max(3 * row.everyMin, 45) * MINUTE_MS
        : now - slot > GRACE_MS
      : slot === undefined || now - slot > GRACE_MS;
    if (late)
      overdue.push(
        row
          ? { ...row, minutes: Math.round((now - row.at) / MINUTE_MS) }
          : { job, at: undefined, minutes: undefined },
      );
  }
  return overdue;
}
