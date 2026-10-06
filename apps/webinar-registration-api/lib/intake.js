import crypto from "node:crypto";

export class IntakeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function sameSecret(actual, expected) {
  if (typeof actual !== "string" || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function verifyTypeform(raw, signature, secret) {
  if (!secret) throw new IntakeError("webhook_not_configured", 503);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("base64");
  if (!sameSecret(signature, expected)) throw new IntakeError("invalid_signature", 401);
}
export async function rawBody(req, limit = 262144) {
  const chunks = []; let size = 0;
  if (Number(req.headers?.["content-length"]) > limit) throw new IntakeError("body_too_large", 413);
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new IntakeError("body_too_large", 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export function jsonBody(raw) {
  let value;
  try { value = JSON.parse(raw.toString("utf8")); } catch { throw new IntakeError("invalid_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntakeError("invalid_body");
  return value;
}
const text = (value, max) => typeof value === "string" && value.trim().length <= max ? value.trim() : "";
export function registrationInput(body) {
  if (body.contact_id || body.contactId || body.location_id || body.locationId) throw new IntakeError("untrusted_contact_identity");
  const first_name = text(body.first_name, 100), last_name = text(body.last_name || "", 100);
  const email = text(body.email, 254).toLowerCase();
  let phone = text(body.phone, 30).replace(/[\s()-]/g, "");
  if (/^\d{8}$/.test(phone)) phone = "+965" + phone;
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (!first_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+[1-9]\d{7,14}$/.test(phone)) throw new IntakeError("invalid_registration");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.request_id || "")) throw new IntakeError("request_id_required");
  const attribution = {};
  for (const key of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ad_id","adset_id","campaign_id","visit_id"]) {
    const value = text(body.attribution?.[key], 200);
    if (value) attribution[key] = value;
  }
  const status_hash = referenceHash(body.status_token);
  if (!status_hash) throw new IntakeError("status_token_required");
  return { first_name, last_name, email, phone, attribution, status_hash };
}
export function referenceHash(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? crypto.createHash("sha256").update(value).digest("hex") : null;
}
export function surveyInput(payload, now = Date.now()) {
  const fr = payload.form_response;
  if (payload.event_type !== "form_response" || fr?.form_id !== "P1xP4r24") throw new IntakeError("wrong_form");
  if (typeof fr.token !== "string" || !/^[\w-]{1,200}$/.test(fr.token)) throw new IntakeError("response_id_required");
  if (typeof fr.submitted_at !== "string" || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(fr.submitted_at) || !Number.isFinite(Date.parse(fr.submitted_at)) || Date.parse(fr.submitted_at) > now + 120000) throw new IntakeError("invalid_submission_time");
  if (!Array.isArray(fr.answers)) throw new IntakeError("invalid_answers");
  // Delivery envelopes can change on replay. The form response is the immutable receipt.
  return { p_form: fr.form_id, p_response: fr.token, p_at: fr.submitted_at, p_payload: fr,
    p_ref_hash: referenceHash(fr.hidden?.webinar_ref) };
}
export function replyError(res, error) {
  const known = error instanceof IntakeError, status = known ? error.status : 503;
  if (status >= 500) res.setHeader("Retry-After", "30");
  return res.status(status).json({ ok: false, error: known ? error.code : "temporarily_unavailable" });
}
export function privateResponse(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}
