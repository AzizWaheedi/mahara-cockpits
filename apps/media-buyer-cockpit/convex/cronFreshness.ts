type CronRow = { job: string; at: number; everyMin: number };

/** Next scheduled slot after a successful or failed recorded run. UTC only. */
function nextSlot(job: string, at: number): number {
  const start = Math.floor(at / 60_000) * 60_000 + 60_000;
  // Two days covers the nightly gap in these two mixed-cadence cron schedules.
  for (let t = start; t < start + 2 * 24 * 60 * 60_000; t += 60_000) {
    const d = new Date(t);
    const h = d.getUTCHours(),
      m = d.getUTCMinutes();
    if (job === "board KPI columns" && h >= 3 && h <= 18 && m === 5) return t;
    if (job === "sync" && (h >= 3 && h <= 18 ? m % 10 === 0 : m === 0))
      return t;
  }
  throw new Error(`No next scheduled slot for ${job}`);
}

export function scheduledJobHealth(
  stale: { job: string; minutes: number }[],
): { source: string; ok: boolean; error?: string }[] {
  if (!stale.length) return [{ source: "jobs", ok: true }];
  return [
    {
      source: "jobs",
      ok: false,
      error:
        stale
          .slice(0, 5)
          .map(j => `"${j.job}" last ran ${j.minutes} min ago`)
          .join("; ") +
        (stale.length > 5 ? `; and ${stale.length - 5} more` : ""),
    },
  ];
}

/** Aggregate smoke health should reflect active schedules, not dormant rows. */
export function overdueCronRows<T extends CronRow>(
  rows: T[],
  now: number,
  active: ReadonlySet<string>,
): (T & { minutes: number })[] {
  return rows
    .filter(r => {
      if (!active.has(r.job)) return false;
      if (r.job === "sync" || r.job === "board KPI columns")
        return now - nextSlot(r.job, r.at) > 45 * 60_000;
      return now - r.at > Math.max(3 * r.everyMin, 45) * 60_000;
    })
    .map(r => ({ ...r, minutes: Math.round((now - r.at) / 60_000) }));
}
