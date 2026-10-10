// team-onboarding-intake: the new-hire onboarding Typeform (Cef2QGBh) into
// public.cockpit_team_onboarding (Creative Triage bldgtotkfmhoxmlzowdx), and
// from there onto the person's file in the CEO cockpit.
//
// Public (verify_jwt false): Typeform cannot send a Supabase key. So:
// - every delivery must carry Typeform's signature over the exact body,
//   made with TYPEFORM_ONBOARDING_SECRET (the same secret is on the form's
//   "cockpit" webhook); anything unsigned is refused and stored nowhere;
// - only form_response events of the onboarding form are kept;
// - a delivery that cannot be stored answers 500 so Typeform tries again,
//   and is counted in cockpit_team_onboarding_state, which the person page
//   reads to say the last delivery failed;
// - a signed request with "x-onboarding-dry-run: 1" is parsed and matched
//   but nothing is written: the doctor for this route.
//
// Nothing personal is logged: only the response id and the outcome. The
// service role key is the one Supabase gives every function.

import { parseSubmission } from "./parse.ts";
import { signedByTypeform } from "./signature.ts";

const FORM_ID = Deno.env.get("TYPEFORM_ONBOARDING_FORM_ID") ?? "Cef2QGBh";
const MAX_BODY = 1_500_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function rpc(name: string, args: unknown): Promise<Response> {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

async function failed(why: string) {
  try {
    await rpc("cockpit_team_onboarding_failed", { p_error: why });
  } catch (_) {
    // The 500 Typeform gets is the record of last resort.
  }
}

Deno.serve(async req => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "Too large" });
  const secret = Deno.env.get("TYPEFORM_ONBOARDING_SECRET");
  if (!secret) {
    await failed("TYPEFORM_ONBOARDING_SECRET is not set on the function");
    return json(503, { error: "Not configured" });
  }
  if (!(await signedByTypeform(secret, raw, req.headers.get("typeform-signature"))))
    return json(401, { error: "Signature does not match" });

  let payload: { event_type?: string; form_response?: { form_id?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "Not JSON" });
  }
  if (payload.event_type !== "form_response" || payload.form_response?.form_id !== FORM_ID)
    return json(202, { ignored: true });

  let record;
  try {
    record = parseSubmission(payload);
  } catch (e) {
    await failed(`Unreadable submission: ${String((e as Error).message).slice(0, 200)}`);
    return json(400, { error: "Unreadable submission" });
  }

  if (req.headers.get("x-onboarding-dry-run") === "1") {
    const { raw: _raw, answers, ...rest } = record;
    return json(200, { dryRun: true, record: { ...rest, answerCount: answers.length } });
  }

  const res = await rpc("cockpit_team_onboarding_record", { p: record });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error(`onboarding ${record.responseToken} not stored: ${res.status}`);
    await failed(`Storing a submission failed (${res.status}): ${detail}`);
    return json(500, { error: "Not stored" });
  }
  const out = await res.json();
  console.log(`onboarding ${record.responseToken} stored as ${out?.id} (${out?.matched_by ?? "unmatched"})`);
  return json(200, { ok: true, id: out?.id ?? null, matched: out?.matched_by ?? null, duplicate: out?.duplicate ?? false });
});
