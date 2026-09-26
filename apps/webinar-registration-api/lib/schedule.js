import schedule from "./schedule.generated.js";
export { schedule };

// Old Vercel settings may still exist. They cannot silently override the repo.
export function scheduleIssues(env = process.env, now = Date.now(), value = schedule) {
  const issues = [];
  if (value.status !== "scheduled" || !value.starts_at || !Number.isFinite(Date.parse(value.starts_at)) || Date.parse(value.starts_at) <= now) issues.push("training_date_not_ready");
  const expected = {
    WEBINAR_START: value.starts_at,
    WEBINAR_MINUTES: String(value.duration_minutes),
    WEBINAR_ROUND: value.legacy_round,
    GHL_LOCATION_ID: value.providers.ghl_location_id,
    WEBBY_CALENDAR_ID: value.providers.ghl_calendar_id,
  };
  for (const [key, wanted] of Object.entries(expected)) {
    if (env[key] !== undefined && env[key] !== wanted) issues.push(`conflicting_${key.toLowerCase()}`);
  }
  return issues;
}
