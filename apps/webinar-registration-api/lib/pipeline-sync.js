import { PipelineError, LOCATION_ID, verifyPipeline } from "./pipeline.js";
export const SALES_CALENDARS = [
  "cFeDl0FY8iaXll61lus8",
  "dsqmJ393Dwl9fDSbIVOI",
  "NDBNz6Og4yfpdpWmHrue",
  "jQqXS1YuFnmGZKLkrE62",
];
export const SALES_PIPELINES = ["eU5KW4TRt3haofQSnWC1", "96oywOezX39jQzXP3Mg0"];
const enc = encodeURIComponent;
export function desiredStage(
  evidence,
  calls = [],
  sales = [],
  now = Date.now(),
) {
  if (evidence.registration_status !== "confirmed") return null;
  if (sales.some((s) => s.status === "won")) return "client_won";
  if (calls.some((c) => c.appointmentStatus === "showed"))
    return "call_attended";
  if (
    calls.some(
      (c) =>
        ["new", "confirmed"].includes(c.appointmentStatus) &&
        Date.parse(c.startTime) > now,
    )
  )
    return "call_booked";
  if (calls.length) return "call_follow_up";
  if (evidence.survey_completed) return "survey_completed";
  if (evidence.attended) return "attended";
  if (evidence.attendance_final) return "webinar_missed";
  return "registered";
}
function checkOpportunity(o, evidence, pipeline, name) {
  if (
    !o?.id ||
    o.locationId !== evidence.location_id ||
    o.contactId !== evidence.contact_id ||
    o.pipelineId !== pipeline ||
    o.name !== name
  )
    throw new PipelineError("opportunity_scope_mismatch");
  if (o.status !== "open" || Number(o.monetaryValue) !== 0)
    throw new PipelineError("opportunity_manually_changed");
  return o;
}
export function pipelineAdapters(provider) {
  return {
    list: provider.list,
    contact: async (id) =>
      (await provider.request(`/contacts/${enc(id)}`)).contact,
    appointment: async (id) => {
      const x = await provider.request(
        `/calendars/events/appointments/${enc(id)}`,
      );
      return x.appointment || x;
    },
    opportunity: async (id) =>
      (await provider.request(`/opportunities/${enc(id)}`)).opportunity,
    opportunities: async (contact, pipeline) => {
      const rows = [],
        seen = new Set();
      let total;
      for (let page = 1; page <= 100; page++) {
        const data = await provider.request(
          "/opportunities/search?" +
            new URLSearchParams({
              locationId: LOCATION_ID,
              contactId: contact,
              pipelineId: pipeline,
              status: "all",
              page: String(page),
              limit: "100",
            }),
        );
        if (
          !Array.isArray(data.opportunities) ||
          !Number.isInteger(data.meta?.total) ||
          (total !== undefined && total !== data.meta.total)
        )
          throw new PipelineError("opportunity_lookup_incomplete");
        total = data.meta.total;
        for (const o of data.opportunities) {
          if (!o.id || seen.has(o.id))
            throw new PipelineError("opportunity_lookup_incomplete");
          seen.add(o.id);
          rows.push(o);
        }
        if (rows.length === total) return rows;
        if (!data.opportunities.length || rows.length > total)
          throw new PipelineError("opportunity_lookup_incomplete");
      }
      throw new PipelineError("opportunity_lookup_incomplete");
    },
    create: (body) => provider.request("/opportunities/", "POST", body),
    move: (id, stage) =>
      provider.request(`/opportunities/${enc(id)}`, "PUT", {
        pipelineStageId: stage,
      }),
  };
}
export async function syncPipelineCard({
  store,
  provider,
  registration,
  enabled = false,
  now = Date.now,
}) {
  if (!enabled) return { status: "held" };
  if (!/^[a-f0-9-]{36}$/.test(registration))
    throw new PipelineError("invalid_registration");
  const [e] = await store.read(
    `cockpit_webinar_pipeline_evidence?registration_id=eq.${registration}&select=*`,
  );
  if (!e || e.location_id !== LOCATION_ID || e.registration_id !== registration)
    throw new PipelineError("registration_scope_mismatch");
  if (e.registration_status !== "confirmed")
    return { status: "held", code: "registration_not_confirmed" };
  const card = await store.rpc("cockpit_claim_webinar_pipeline", {
    p_registration: registration,
  });
  if (!card) return { status: "held", code: "pipeline_disabled_or_claimed" };
  const args = { p_registration: registration, p_lease: card.lease_token };
  let mutated = false;
  try {
    const live = (await provider.list()).find((p) => p.id === card.pipeline_id);
    const mapping = verifyPipeline(live);
    if (
      mapping.pipeline_id !== card.config.pipeline_id ||
      Object.entries(mapping.stages).some(
        ([k, v]) => card.config.stage_ids[k] !== v,
      )
    )
      throw new PipelineError("pipeline_mapping_changed");
    const contact = await provider.contact(e.contact_id);
    if (contact?.id !== e.contact_id || contact.locationId !== LOCATION_ID)
      throw new PipelineError("contact_scope_mismatch");
    const bindings = await store.read(
      `cockpit_webinar_sales_bindings?registration_id=eq.${registration}&select=*`,
    );
    const calls = [],
      sales = [];
    for (const binding of bindings) {
      const a = await provider.appointment(binding.appointment_id);
      if (
        a?.id !== binding.appointment_id ||
        a.contactId !== e.contact_id ||
        a.locationId !== LOCATION_ID ||
        !SALES_CALENDARS.includes(a.calendarId) ||
        !Number.isFinite(Date.parse(a.startTime)) ||
        ![
          "new",
          "confirmed",
          "showed",
          "noshow",
          "cancelled",
          "canceled",
          "invalid",
        ].includes(a.appointmentStatus)
      )
        throw new PipelineError("sales_appointment_scope_mismatch");
      calls.push(a);
      if (binding.sales_opportunity_id) {
        const s = await provider.opportunity(binding.sales_opportunity_id);
        if (
          s?.id !== binding.sales_opportunity_id ||
          s.contactId !== e.contact_id ||
          s.locationId !== LOCATION_ID ||
          !SALES_PIPELINES.includes(s.pipelineId)
        )
          throw new PipelineError("sales_opportunity_scope_mismatch");
        sales.push(s);
      }
    }
    const stage = desiredStage(e, calls, sales, now());
    // Full registration UUID is the immutable external marker. Never upsert by contact alone.
    const name = `WEBBY | ${e.event_key} | ${registration}`;
    let o;
    if (card.opportunity_id) {
      o = checkOpportunity(
        await provider.opportunity(card.opportunity_id),
        e,
        card.pipeline_id,
        name,
      );
      if (
        o.pipelineStageId !== mapping.stages[card.stage_key] &&
        o.pipelineStageId !== mapping.stages[stage]
      )
        throw new PipelineError("opportunity_manually_changed");
    } else {
      const rows = await provider.opportunities(e.contact_id, card.pipeline_id);
      if (
        rows.some(
          (x) =>
            x.contactId !== e.contact_id ||
            x.locationId !== LOCATION_ID ||
            x.pipelineId !== card.pipeline_id,
        )
      )
        throw new PipelineError("opportunity_lookup_scope");
      const matches = rows.filter((x) => x.name === name);
      if (matches.length > 1)
        throw new PipelineError("duplicate_registration_cards");
      if (matches.length === 1)
        o = checkOpportunity(matches[0], e, card.pipeline_id, name);
      // Other rounds may exist. A 400/409 from the provider is held, never worked around by moving one.
    }
    if (!o || o.pipelineStageId !== mapping.stages[stage]) {
      await store.rpc("cockpit_mark_webinar_pipeline_mutation", args);
      mutated = true;
      if (!o) {
        const created = await provider.create({
          locationId: LOCATION_ID,
          pipelineId: card.pipeline_id,
          pipelineStageId: mapping.stages[stage],
          contactId: e.contact_id,
          name,
          status: "open",
          monetaryValue: 0,
        });
        if (!created.opportunity?.id)
          throw new PipelineError("opportunity_receipt_missing");
        o = checkOpportunity(
          await provider.opportunity(created.opportunity.id),
          e,
          card.pipeline_id,
          name,
        );
      } else {
        await provider.move(o.id, mapping.stages[stage]);
        o = checkOpportunity(
          await provider.opportunity(o.id),
          e,
          card.pipeline_id,
          name,
        );
      }
    }
    if (o.pipelineStageId !== mapping.stages[stage])
      throw new PipelineError("opportunity_stage_readback_mismatch");
    await store.rpc("cockpit_finish_webinar_pipeline", {
      ...args,
      p_state: "synced",
      p_code: "provider_verified",
      p_opportunity: o.id,
      p_stage: stage,
    });
    return { status: "synced", stage };
  } catch (error) {
    const state = mutated ? "uncertain" : "blocked",
      code =
        error instanceof PipelineError
          ? error.code
          : "pipeline_dependency_unavailable";
    await store.rpc("cockpit_finish_webinar_pipeline", {
      ...args,
      p_state: state,
      p_code: code,
    });
    return { status: state, code };
  }
}
