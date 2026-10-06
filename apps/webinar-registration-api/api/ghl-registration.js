import { schedule, scheduleIssues } from "../lib/schedule.js";
import { createStore } from "../lib/store.js";
import { IntakeError, sameSecret, rawBody, jsonBody, privateResponse, replyError } from "../lib/intake.js";
export const config = { api: { bodyParser: false } };
export function ghlRegistrationHandler({ store = createStore(), env = process.env, current = schedule, now = Date.now } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (!env.WEBINAR_GHL_HANDOFF_SECRET) throw new IntakeError("handoff_not_configured", 503);
      if (!sameSecret(req.headers.authorization, `Bearer ${env.WEBINAR_GHL_HANDOFF_SECRET}`)) throw new IntakeError("unauthorized", 401);
      if (env.WEBINAR_INTAKE_ENABLED !== "true" || scheduleIssues(env, now(), current).length) throw new IntakeError("registration_closed", 503);
      const body = jsonBody(await rawBody(req, 16384));
      if (body.event_key !== current.event_key || body.revision !== current.revision || body.location_id !== current.providers.ghl_location_id) throw new IntakeError("scope_mismatch");
      if (typeof body.contact_id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.contact_id) || typeof body.receipt_id !== "string" || !/^[A-Za-z0-9_:-]{1,200}$/.test(body.receipt_id)) throw new IntakeError("provider_receipt_required");
      const at = typeof body.submitted_at === "string" && /T.*(Z|[+-]\d{2}:\d{2})$/.test(body.submitted_at) ? Date.parse(body.submitted_at) : NaN;
      if (!Number.isFinite(at) || at > now()+120000 || at < now()-90*86400000) throw new IntakeError("invalid_submission_time");
      await store.rpc("cockpit_accept_webinar_intake", {
        p_source: "ghl", p_source_id: body.receipt_id, p_key: current.event_key, p_revision: current.revision,
        p_location: current.providers.ghl_location_id, p_config: current.config_sha256,
        p_payload: { contact_id: body.contact_id, submitted_at: new Date(at).toISOString() },
      });
      return res.status(202).json({ ok: true, status: "processing" });
    } catch (error) { return replyError(res, error); }
  };
}
export default ghlRegistrationHandler();
