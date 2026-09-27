import { LOCATION_ID, PipelineError } from "./pipeline.js";
export const WEBINAR_FORM = "5wC0SkFcgCfFzbpOUBWk";
export function validateFormBindings(bindings) {
  if (!Array.isArray(bindings))
    throw new PipelineError("form_bindings_invalid");
  for (const b of bindings) {
    if (
      b.location_id !== LOCATION_ID ||
      b.form_id !== WEBINAR_FORM ||
      typeof b.event_key !== "string" ||
      !b.event_key ||
      !Number.isInteger(b.revision) ||
      b.revision < 1 ||
      !/^[a-f0-9]{64}$/.test(b.config_sha256) ||
      !Number.isFinite(Date.parse(b.opens_at)) ||
      !Number.isFinite(Date.parse(b.closes_at)) ||
      Date.parse(b.opens_at) >= Date.parse(b.closes_at)
    )
      throw new PipelineError("form_bindings_invalid");
  }
  for (let i = 0; i < bindings.length; i++)
    for (let j = i + 1; j < bindings.length; j++)
      if (
        Date.parse(bindings[i].opens_at) < Date.parse(bindings[j].closes_at) &&
        Date.parse(bindings[j].opens_at) < Date.parse(bindings[i].closes_at)
      )
        throw new PipelineError("form_windows_overlap");
  return bindings;
}
export async function readFormSubmissions(provider, binding, now = Date.now()) {
  const rows = [],
    seen = new Set();
  let total;
  // GHL filters by date, with provider-local timezone semantics. Read a padded
  // UTC range, then accept only receipts inside the precise timestamp window.
  const day = 86400000;
  const params = {
    locationId: LOCATION_ID,
    formId: WEBINAR_FORM,
    limit: "100",
    startAt: new Date(Date.parse(binding.opens_at) - day)
      .toISOString()
      .slice(0, 10),
    endAt: new Date(Math.min(now, Date.parse(binding.closes_at)) + day)
      .toISOString()
      .slice(0, 10),
  };
  for (let page = 1; page <= 100; page++) {
    const d = await provider.request(
      "/forms/submissions?" +
        new URLSearchParams({ ...params, page: String(page) }),
    );
    if (
      !Array.isArray(d.submissions) ||
      !Number.isInteger(d.meta?.total) ||
      d.meta.total < 0 ||
      (total !== undefined && total !== d.meta.total)
    )
      throw new PipelineError("form_read_incomplete");
    total = d.meta.total;
    for (const s of d.submissions) {
      if (typeof s.id !== "string" || seen.has(s.id))
        throw new PipelineError("form_read_incomplete");
      seen.add(s.id);
      rows.push(s);
    }
    if (rows.length === total) return rows;
    if (!d.submissions.length || rows.length > total)
      throw new PipelineError("form_read_incomplete");
  }
  throw new PipelineError("form_read_incomplete");
}
export async function ingestNativeForms({
  provider,
  store,
  bindings,
  current,
  apply = false,
  now = Date.now(),
}) {
  validateFormBindings(bindings);
  const active = bindings.filter(
    (b) => Date.parse(b.opens_at) <= now && Date.parse(b.closes_at) > now,
  );
  if (!active.length)
    return { status: "held", code: "no_form_window", accepted: 0 };
  const b = active[0];
  if (
    current.status !== "scheduled" ||
    b.event_key !== current.event_key ||
    b.revision !== current.revision ||
    b.config_sha256 !== current.config_sha256 ||
    Date.parse(current.starts_at) <= now
  )
    throw new PipelineError("form_schedule_mismatch");
  const rows = await readFormSubmissions(provider, b, now),
    receipts = [];
  // Validate the whole provider page set before accepting anything. Unknown row shapes stay visible.
  for (const s of rows) {
    const at = Date.parse(s.createdAt);
    if (
      s.formId !== WEBINAR_FORM ||
      typeof s.contactId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(s.contactId) ||
      typeof s.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(s.id) ||
      typeof s.createdAt !== "string" ||
      !/T.*(Z|[+-]\d{2}:\d{2})$/.test(s.createdAt) ||
      !Number.isFinite(at) ||
      at > now + 120000
    )
      throw new PipelineError("form_receipt_shape_unverified");
    if (at < Date.parse(b.opens_at) || at >= Date.parse(b.closes_at)) continue;
    receipts.push({
      p_source: "ghl",
      p_source_id: `${LOCATION_ID}:${WEBINAR_FORM}:${s.id}`,
      p_key: b.event_key,
      p_revision: b.revision,
      p_location: LOCATION_ID,
      p_config: b.config_sha256,
      p_payload: {
        contact_id: s.contactId,
        submitted_at: new Date(at).toISOString(),
      },
    });
  }
  if (!apply)
    return {
      status: "dry_run",
      source_total: rows.length,
      eligible: receipts.length,
      accepted: 0,
    };
  for (const r of receipts) await store.rpc("cockpit_accept_webinar_intake", r);
  return {
    status: "succeeded",
    source_total: rows.length,
    accepted: receipts.length,
  };
}
