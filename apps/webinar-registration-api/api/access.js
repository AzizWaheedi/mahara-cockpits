import { createStore } from "../lib/store.js";
import { IntakeError, rawBody, jsonBody, referenceHash, privateResponse, replyError } from "../lib/intake.js";
import { publicOrigin } from "../lib/links.js";
import { safeJoinUrl } from "../lib/worker.js";
export const config = { api: { bodyParser: false } };
export function accessHandler({ store = createStore(), env = process.env } = {}) {
  return async (req, res) => {
    privateResponse(res);
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "post_only" });
    try {
      if (req.headers.origin !== publicOrigin(env)) throw new IntakeError("origin_not_allowed", 403);
      const body = jsonBody(await rawBody(req, 1024));
      const hash = referenceHash(body.token);
      if (!hash || !["survey", "join"].includes(body.purpose)) throw new IntakeError("link_unavailable", 404);
      const target = await store.rpc("cockpit_resolve_webinar_link", { p_hash: hash, p_purpose: body.purpose });
      if (!target) throw new IntakeError("link_unavailable", 404);
      let destination;
      if (body.purpose === "join" && safeJoinUrl(target.join_url, target.meeting_id)) destination = target.join_url;
      if (body.purpose === "survey" && target.form_id === "P1xP4r24") destination = `https://maharamedia.typeform.com/to/P1xP4r24#webinar_ref=${body.token}`;
      if (!destination) throw new IntakeError("link_unavailable", 404);
      // Resolution is not attendance, a human click or verified recipient identity.
      return res.status(200).json({ ok: true, destination });
    } catch (error) { return replyError(res, error); }
  };
}
export default accessHandler();
