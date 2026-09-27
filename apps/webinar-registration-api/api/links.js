import { createStore } from "../lib/store.js";
import { IntakeError, sameSecret, rawBody, jsonBody, privateResponse, replyError } from "../lib/intake.js";
import { confirmedLinks } from "../lib/links.js";
export const config = { api: { bodyParser: false } };
// For the eventual scoped delivery worker. Does not send a message or write contact fields.
export function linksHandler({ store = createStore(), env = process.env } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (!env.WEBINAR_LINK_ADMIN_SECRET || Buffer.byteLength(env.WEBINAR_LINK_ADMIN_SECRET) < 32) throw new IntakeError("links_not_configured", 503);
      if (!sameSecret(req.headers.authorization, `Bearer ${env.WEBINAR_LINK_ADMIN_SECRET}`)) throw new IntakeError("unauthorized", 401);
      const body = jsonBody(await rawBody(req, 1024));
      if (!/^[a-f0-9-]{36}$/i.test(body.registration_id || "")) throw new IntakeError("invalid_registration");
      const state = await store.rpc("cockpit_webinar_registration_state", { p_registration: body.registration_id });
      if (!state) throw new IntakeError("status_unavailable", 404);
      return res.status(200).json({ ok: true, status: state.status, links: await confirmedLinks(store, state, env) });
    } catch (error) { return replyError(res, error); }
  };
}
export default linksHandler();
