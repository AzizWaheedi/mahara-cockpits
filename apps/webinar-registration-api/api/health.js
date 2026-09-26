// GET /api/health — shows which settings are present (never the values)
import { CFG } from "../lib/ghl.js";
import { schedule, scheduleIssues } from "../lib/schedule.js";
export default function handler(req, res) {
  const issues = scheduleIssues();
  res.status(200).json({
    ok: true,
    ghlTokenSet: !!CFG.token,
    locationId: CFG.locationId,
    calendarId: CFG.calendarId,
    webinarStart: CFG.webinarStart,
    round: CFG.round,
    eventKey: schedule.event_key,
    scheduleRevision: schedule.revision,
    configSha256: schedule.config_sha256,
    durationMinutes: schedule.duration_minutes,
    timezone: schedule.timezone,
    scheduleReady: issues.length === 0,
    scheduleIssues: issues,
    typeformSecretSet: !!process.env.TYPEFORM_SECRET,
  });
}
