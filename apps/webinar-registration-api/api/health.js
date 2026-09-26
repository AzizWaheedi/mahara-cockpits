// GET /api/health — shows which settings are present (never the values)
import { CFG } from "../lib/ghl.js";
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    ghlTokenSet: !!CFG.token,
    locationId: CFG.locationId,
    calendarId: CFG.calendarId,
    webinarStart: CFG.webinarStart,
    round: CFG.round,
    typeformSecretSet: !!process.env.TYPEFORM_SECRET,
  });
}
