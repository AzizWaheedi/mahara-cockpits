import crypto from "node:crypto";
import { IntakeError, referenceHash } from "./intake.js";

export function publicOrigin(env) {
  let url;
  try { url = new URL(env.WEBINAR_PUBLIC_ORIGIN); } catch { throw new IntakeError("links_not_configured", 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new IntakeError("links_not_configured", 503);
  return url.origin;
}
export function linkToken(registration, revision, purpose, env) {
  if (!env.WEBINAR_LINK_SECRET || Buffer.byteLength(env.WEBINAR_LINK_SECRET) < 32) throw new IntakeError("links_not_configured", 503);
  return crypto.createHmac("sha256", env.WEBINAR_LINK_SECRET).update(JSON.stringify(["webinar-link-v1", registration, revision, purpose])).digest("base64url");
}
export async function confirmedLinks(store, state, env) {
  if (state?.status !== "confirmed") return {};
  const origin = publicOrigin(env);
  const links = {};
  // Only these two purposes have accepted destinations. Pitch booking is not wired yet.
  for (const purpose of ["join", "survey"]) {
    const token = linkToken(state.registration_id, state.revision, purpose, env);
    await store.rpc("cockpit_issue_webinar_link", {
      p_registration: state.registration_id, p_revision: state.revision, p_purpose: purpose,
      p_hash: referenceHash(token), p_request: crypto.randomUUID(), p_by: "registration-api",
    });
    links[purpose] = `${origin}/access.html#${purpose}=${token}`;
  }
  return links;
}
