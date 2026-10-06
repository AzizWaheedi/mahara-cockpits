import { IntakeError } from "./intake.js";

export function createStore(env = process.env, fetcher = fetch) {
  const base = env.WEBINAR_SUPABASE_URL, key = env.WEBINAR_SUPABASE_SERVICE_KEY;
  async function request(path, body) {
    if (!base || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base) || !key) throw new IntakeError("storage_not_configured", 503);
    let response;
    try {
      response = await fetcher(base + "/rest/v1/" + path, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
    } catch { throw new IntakeError("storage_unavailable", 503); }
    if (!response.ok) {
      let error; try { error = await response.json(); } catch {}
      if (["Intake receipt reused", "Survey receipt reused"].includes(error?.message)) throw new IntakeError("receipt_conflict", 409);
      if (["Link unavailable", "Registration not confirmed"].includes(error?.message)) throw new IntakeError("link_unavailable", 409);
      if (error?.message === "Registration closed or configuration changed") throw new IntakeError("registration_closed", 503);
      throw new IntakeError("storage_unavailable", 503);
    }
    const content = await response.text();
    return content ? JSON.parse(content) : null;
  }
  return { rpc: (name, args) => request("rpc/" + name, args), read: path => request(path) };
}
