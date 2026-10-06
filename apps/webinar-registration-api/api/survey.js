import { createStore } from "../lib/store.js";
import { rawBody, verifyTypeform, jsonBody, surveyInput, privateResponse, replyError } from "../lib/intake.js";
export const config = { api: { bodyParser: false } };
export function surveyHandler({ store = createStore(), env = process.env, now = Date.now } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      const raw = await rawBody(req);
      verifyTypeform(raw, req.headers["typeform-signature"], env.TYPEFORM_SECRET);
      await store.rpc("cockpit_accept_webinar_survey", surveyInput(jsonBody(raw), now()));
      return res.status(200).json({ ok: true });
    } catch (error) { return replyError(res, error); }
  };
}
export default surveyHandler();
