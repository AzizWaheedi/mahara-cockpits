// POST /api/register  — registration form handler
// Body (JSON or form-encoded): first_name, last_name?, email, phone
// 1. Upsert the contact in GHL with tag webby-registered (+ round fields)  → fires WEBBY - W1
// 2. Book the contact on the WEBBY · Live Training calendar at WEBINAR_START → fires WEBBY - W2
// 3. Reply JSON {ok:true, redirect} (fetch) or 303-redirect to the thank-you page (plain form post)
import { CFG, ghl, normalizePhone, readBody, isEmail } from "../lib/ghl.js";
import { scheduleIssues } from "../lib/schedule.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (scheduleIssues().length) return res.status(503).json({ ok: false, error: "Training registration is not open. Please check back when the date is confirmed." });

  const b = readBody(req);
  const firstName = String(b.first_name || b.firstName || b.name || "").trim();
  const lastName  = String(b.last_name || b.lastName || "").trim();
  const email     = String(b.email || "").trim().toLowerCase();
  const phone     = normalizePhone(b.phone);
  const wantsJson = (req.headers["content-type"] || "").includes("application/json") || (req.headers.accept || "").includes("application/json");

  if (!firstName || !isEmail(email) || !phone) {
    return res.status(400).json({ ok: false, error: "first_name, email and phone are required" });
  }

  const start = new Date(CFG.webinarStart);
  if (isNaN(start)) return res.status(500).json({ ok: false, error: "WEBINAR_START is not a valid ISO datetime" });
  const end = new Date(start.getTime() + CFG.webinarMinutes * 60000);
  const dateOnly = CFG.webinarStart.slice(0, 10);

  try {
    // 1. contact
    const up = await ghl("POST", "/contacts/upsert", {
      locationId: CFG.locationId,
      firstName, lastName: lastName || undefined, email, phone,
      source: "webinar-" + CFG.round,
      tags: ["webby-registered", "webby-" + CFG.round],
      customFields: [
        { id: CFG.fields.webinarDatetime, field_value: dateOnly },
        { id: CFG.fields.webinarRound,    field_value: CFG.round },
      ],
    });
    const contactId = up?.contact?.id;
    if (!contactId) throw new Error("upsert returned no contact id");

    // 2. appointment (skip if this contact already has one on the training calendar at this time)
    let appointmentId = null, appointmentSkipped = false;
    try {
      const existing = await ghl("GET", `/contacts/${contactId}/appointments`, null, "2021-07-28");
      const dup = (existing?.events || []).find(e => e.calendarId === CFG.calendarId && Math.abs(new Date(e.startTime) - start) < 60000 && e.appointmentStatus !== "cancelled");
      if (dup) { appointmentId = dup.id; appointmentSkipped = true; }
    } catch { /* non-fatal */ }
    if (!appointmentId) {
      const ap = await ghl("POST", "/calendars/events/appointments", {
        calendarId: CFG.calendarId,
        locationId: CFG.locationId,
        contactId,
        startTime: CFG.webinarStart,
        endTime: end.toISOString(),
        title: `${firstName} ${lastName}`.trim() + " — التدريب المباشر",
        appointmentStatus: "confirmed",
        ignoreDateRange: true,
        ignoreFreeSlotValidation: true,
        toNotify: false,
      }, "2021-04-15");
      appointmentId = ap?.id || null;
    }

    const redirect = CFG.thanksUrl;
    if (wantsJson) return res.status(200).json({ ok: true, contactId, appointmentId, appointmentSkipped, redirect });
    res.statusCode = 303; res.setHeader("Location", redirect); return res.end();
  } catch (e) {
    console.error("register failed", e);
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
