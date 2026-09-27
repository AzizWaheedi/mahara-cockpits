import { createStore } from "../lib/store.js";
import { LOCATION_ID } from "../lib/pipeline.js";
import {
  IntakeError,
  sameSecret,
  rawBody,
  jsonBody,
  privateResponse,
  replyError,
} from "../lib/intake.js";
export const config = { api: { bodyParser: false } };
export function pipelineSignalHandler({
  store = createStore(),
  env = process.env,
} = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (
        !env.WEBINAR_PIPELINE_SIGNAL_SECRET ||
        env.WEBINAR_PIPELINE_SIGNAL_SECRET.length < 32
      )
        throw new IntakeError("pipeline_not_configured", 503);
      if (
        !sameSecret(
          req.headers.authorization,
          `Bearer ${env.WEBINAR_PIPELINE_SIGNAL_SECRET}`,
        )
      )
        throw new IntakeError("unauthorized", 401);
      const body = jsonBody(await rawBody(req, 4096));
      if (
        body.location_id !== LOCATION_ID ||
        typeof body.contact_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(body.contact_id)
      )
        throw new IntakeError("scope_mismatch");
      await store.rpc("cockpit_signal_webinar_pipeline", {
        p_location: LOCATION_ID,
        p_contact: body.contact_id,
      });
      // Never trust body.stage, appointment status, mutable tags or month as evidence.
      return res.status(202).json({ ok: true, status: "queued" });
    } catch (error) {
      return replyError(res, error);
    }
  };
}
export default pipelineSignalHandler();
