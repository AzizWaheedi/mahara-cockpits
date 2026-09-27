// One bounded job per invocation. External mutations require durable intent first.
// Adapters must return complete reads, not a first page or a failed lookup as [].
export class WorkError extends Error {
  constructor(code, blocked = false) { super(code); this.code = code; this.blocked = blocked; }
}
export const emailKey = x => typeof x === "string" ? x.trim().toLowerCase() : "";
export const phoneKey = x => typeof x === "string" ? x.replace(/\D/g, "") : "";
export function exactContact(rows, input, location) {
  if (!Array.isArray(rows) || rows.some(c=>!c.id || c.locationId!==location)) throw new WorkError("contact_scope_mismatch",true);
  const candidates = [...new Map(rows.filter(c => c.locationId === location &&
    (emailKey(c.email) === emailKey(input.email) || phoneKey(c.phone) === phoneKey(input.phone))).map(c=>[c.id,c])).values()];
  if (!candidates.length) return null;
  if (candidates.length !== 1 || emailKey(candidates[0].email) !== emailKey(input.email) || phoneKey(candidates[0].phone) !== phoneKey(input.phone)) throw new WorkError("ambiguous_contact", true);
  return candidates[0];
}
export function matchingAppointment(events, config, contact) {
  if (!Array.isArray(events)) throw new WorkError("appointment_lookup_incomplete");
  const matches = events.filter(e => e.contactId === contact && e.calendarId === config.calendar_id &&
    e.locationId === config.location_id && Date.parse(e.startTime) === Date.parse(config.starts_at) && !["cancelled","canceled","invalid"].includes(e.appointmentStatus));
  if (matches.length > 1) throw new WorkError("ambiguous_appointment", true);
  return matches[0] || null;
}
export function safeJoinUrl(value, meeting) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "zoom.us" || /^[a-z0-9-]+\.zoom\.us$/.test(url.hostname)) &&
      [ `/w/${meeting}`, `/j/${meeting}` ].includes(url.pathname) && !!url.searchParams.get("tk") && !url.username && !url.password;
  } catch { return false; }
}

export async function runOne({ store, providers, enabled = false, allow = {}, now = Date.now }) {
  if (!enabled) return { status: "held" };
  const job = await store.rpc("cockpit_claim_webinar_job", { p_kinds: ["resolve_registration","zoom_registrant","training_appointment"] });
  if (!job) return { status: "idle" };
  let mutated = false;
  const args = {p_job:job.id,p_lease:job.lease_token};
  async function mutation() {
    await store.rpc("cockpit_mark_webinar_mutation", args);
    mutated = true;
  }
  try {
    const [intake] = await store.read(`cockpit_webinar_intakes?id=eq.${job.intake_id}&select=*`);
    if (!intake) throw new WorkError("intake_missing",true);
    const [config] = await store.read(`cockpit_webinar_event_configs?event_id=eq.${intake.event_id}&revision=eq.${intake.event_revision}&select=*`);
    const [latest] = await store.read(`cockpit_webinar_event_versions?event_id=eq.${intake.event_id}&order=revision.desc&limit=1&select=revision,scheduled_at`);
    if (!config || !latest || latest.revision !== intake.event_revision || !config.registration_open || !(Date.parse(latest.scheduled_at)>now())) throw new WorkError("schedule_changed",true);
    const scope = {...config,starts_at:latest.scheduled_at};
    if (job.kind === "resolve_registration") {
      let contact, method;
      if (intake.source === "ghl") {
        contact = await providers.getContact(intake.payload.contact_id);
        method = "scoped_contact_read";
      } else {
        const rows = await providers.findContacts(intake.payload,scope.location_id);
        contact = exactContact(rows,intake.payload,scope.location_id);
        method = "exact_email_and_phone";
        if (!contact) {
          if (!allow.contactCreation) throw new WorkError("contact_creation_held",true);
          await mutation();
          contact = await providers.createContact(intake.payload,scope.location_id);
          method = "created_contact";
          if (emailKey(contact?.email)!==emailKey(intake.payload.email) || phoneKey(contact?.phone)!==phoneKey(intake.payload.phone)) throw new WorkError("contact_receipt_mismatch",true);
        }
      }
      if (!contact?.id || contact.locationId !== scope.location_id || (intake.source==='ghl' && contact.id!==intake.payload.contact_id)) throw new WorkError("contact_scope_mismatch",true);
      const registration = await store.rpc("cockpit_bind_webinar_intake",{...args,p_contact:contact.id,p_evidence:{location_id:scope.location_id,contact_id:contact.id,method}});
      return {status:"succeeded",kind:job.kind,registration};
    }
    const [registration] = await store.read(`cockpit_webinar_registrations?id=eq.${job.registration_id}&select=*`);
    if (!registration || registration.event_id!==intake.event_id || registration.location_id!==scope.location_id) throw new WorkError("registration_scope_mismatch",true);
    let receipt;
    if (job.kind === "training_appointment") {
      // A failed lookup throws BEFORE mutation intent. It never means no booking exists.
      const events = await providers.appointments(registration.contact_id);
      let appointment = matchingAppointment(events,scope,registration.contact_id);
      if (!appointment) {
        if (!allow.trainingBooking) throw new WorkError("training_booking_held",true);
        await mutation();
        appointment = await providers.createAppointment(scope,registration.contact_id);
        appointment = matchingAppointment([appointment],scope,registration.contact_id);
      }
      if (!appointment?.id) throw new WorkError("appointment_receipt_missing");
      receipt = {provider:"ghl",scope:scope.calendar_id,resource_id:appointment.id};
    } else if (job.kind === "zoom_registrant") {
      const contact = await providers.getContact(registration.contact_id);
      if (contact?.id!==registration.contact_id || contact.locationId!==scope.location_id || !emailKey(contact.email)) throw new WorkError("contact_scope_mismatch",true);
      const meeting = await providers.meeting(scope.meeting_id);
      // Recurring instances need an explicit occurrence binding before support is enabled.
      if (String(meeting.id)!==scope.meeting_id || meeting.type!==2 || Date.parse(meeting.start_time)!==Date.parse(scope.starts_at) || meeting.settings?.approval_type!==0) throw new WorkError("zoom_settings_unverified",true);
      const matches = (await providers.registrants(scope.meeting_id)).filter(r=>emailKey(r.email)===emailKey(contact.email));
      if (matches.length>1) throw new WorkError("ambiguous_zoom_registrant",true);
      let registrant = matches[0];
      if (!registrant) {
        if (!allow.zoomRegistration || meeting.settings?.registrants_confirmation_email!==false) throw new WorkError("zoom_registration_held",true);
        await mutation();
        registrant = await providers.createRegistrant(scope.meeting_id,contact);
      }
      if (!registrant?.id || !safeJoinUrl(registrant.join_url,scope.meeting_id)) throw new WorkError("zoom_receipt_missing");
      receipt = {provider:"zoom",scope:scope.meeting_id,resource_id:registrant.id,join_url:registrant.join_url};
    } else throw new WorkError("unknown_job",true);
    await store.rpc("cockpit_finish_webinar_job",{...args,p_state:"succeeded",p_code:"provider_verified",p_receipt:receipt});
    return {status:"succeeded",kind:job.kind};
  } catch(error) {
    const state = mutated ? "uncertain" : error instanceof WorkError && error.blocked ? "blocked" : "retry";
    const code = error instanceof WorkError ? error.code : "dependency_unavailable";
    // If this write also fails, lease expiry preserves uncertain mutation state.
    await store.rpc("cockpit_finish_webinar_job",{...args,p_state:state,p_code:code,p_receipt:null});
    return {status:state,kind:job.kind,code};
  }
}
