import { createStore } from "../lib/store.js";
import { IntakeError, rawBody, jsonBody, referenceHash, privateResponse, replyError } from "../lib/intake.js";
import { confirmedLinks, publicOrigin } from "../lib/links.js";
export const config = { api: { bodyParser: false } };
export function statusHandler({ store = createStore(), env = process.env } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (req.headers.origin !== publicOrigin(env)) throw new IntakeError("origin_not_allowed", 403);
      const body = jsonBody(await rawBody(req, 1024));
      const hash = referenceHash(body.token);
      if (!hash) throw new IntakeError("status_unavailable", 404);
      const state = await store.rpc("cockpit_webinar_intake_status", { p_hash: hash });
      if (!state) throw new IntakeError("status_unavailable", 404);
      const output = { ok: true, status: state.status };
      if (state.status === "confirmed") {
        output.schedule = { starts_at: state.starts_at, timezone: state.timezone };
        output.links = await confirmedLinks(store, state, env);
      }
      // Never return contact, registration, intake or appointment IDs, or raw provider URLs.
      return res.status(200).json(output);
    } catch (error) { return replyError(res, error); }
  };
}
export default statusHandler();
