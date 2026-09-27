import { schedule, scheduleIssues } from "../lib/schedule.js";
import { createStore } from "../lib/store.js";
import { IntakeError, rawBody, jsonBody, registrationInput, privateResponse, replyError } from "../lib/intake.js";
export const config = { api: { bodyParser: false } };
export function registerHandler({ store = createStore(), env = process.env, current = schedule, now = Date.now } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (env.WEBINAR_INTAKE_ENABLED !== "true" || scheduleIssues(env, now(), current).length) throw new IntakeError("registration_closed", 503);
      if (!env.WEBINAR_PUBLIC_ORIGIN || req.headers.origin !== env.WEBINAR_PUBLIC_ORIGIN) throw new IntakeError("origin_not_allowed", 403);
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new IntakeError("json_required", 415);
      const body = jsonBody(await rawBody(req, 16384));
      const payload = registrationInput(body);
      await store.rpc("cockpit_accept_webinar_intake", {
        p_source: "web", p_source_id: body.request_id, p_key: current.event_key, p_revision: current.revision,
        p_location: current.providers.ghl_location_id, p_config: current.config_sha256, p_payload: payload,
      });
      // Durable intake, not a completed booking or a sent confirmation.
      return res.status(202).json({ ok: true, status: "processing" });
    } catch (error) { return replyError(res, error); }
  };
}
export default registerHandler();
