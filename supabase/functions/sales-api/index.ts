// sales-api: every change the sales cockpit makes goes through here.
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx) with verify_jwt on.
// The browser sends its own Supabase session; this asks the database who
// that is (cockpit_sales_whoami, the same function the cockpit's shell
// reads), refuses anyone without a seat, and only then writes with the
// service key. Every accepted change leaves a row in cockpit_audit_log.
//
// HighLevel (the sales sub-account) is reached with the function secret
// SALES_GHL_TOKEN. A mark goes to HighLevel only when the crm_writes
// setting says so and the call is recent (lib.ts crmDecision).

import {
  type Appointment,
  applyFills,
  checkCoachReview,
  checkEmail,
  checkGoals,
  checkLink,
  checkOffer,
  checkPay,
  checkReference,
  checkSnippet,
  checkTemplateRoute,
  cleanText,
  FOLLOWUP_SEGMENTS,
  REFERENCE_ASK_STATES,
  renderTemplate,
  type TemplateRoute,
  templateLine,
  cors,
  crmDecision,
  type CrmSettings,
  redact,
  refuseMark,
  trimMessages,
  type Channel,
  dndFor,
  mergeThreads,
  sendBody,
  stateOf,
  type ThreadMessage,
  toThread,
  whatsappWindow,
  EOD_FIELDS,
  EOD_TAB,
  type EodRole,
  eodColumns,
  eodDay,
  eodMessage,
  eodValue,
  type Who,
} from "./lib.ts";
import {
  afterOutcome,
  ANY_OUTCOME_WORDS,
  type AnyOutcome,
  APPOINTMENT_OUTCOMES,
  appointmentEffect,
  type BookingKind,
  type Appt,
  type Candidate,
  type CloserFacts,
  type StageRole,
  stageRole,
  tagsFor,
  targetRoles,
  calendarFor,
  callSummary,
  dayStats,
  ghlTime,
  heat,
  isNoAnswer,
  kuwaitAt,
  kuwaitWords,
  type ItemKind,
  type MaqsamCall,
  matchCall,
  nextMorning,
  OUTCOMES,
  type Outcome,
  parseSlots,
  rankForCloser,
  rankForSetter,
  routePhone,
  slotOffered,
} from "./dialer.ts";

type Row = Record<string, unknown>;

const GHL = "https://services.leadconnectorhq.com";
const LOCATION = "7NI8yyJtwsh2OOWA5Icr";
// HighLevel sits behind Cloudflare, which refuses a request with no
// browser-like agent (error 1010).
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

class Refusal extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const env = (n: string) => (Deno.env.get(n) ?? "").trim();
const enc = encodeURIComponent;

async function svc(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[]> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`database ${res.status}: ${redact(text)}`);
  const out = text ? JSON.parse(text) : [];
  return Array.isArray(out) ? out : [out];
}

/**
 * Every row of a read, a thousand at a time: the API answers at most 1,000
 * rows per request (max_rows), and a queue built on a silently short read
 * would skip leads without saying so.
 */
async function svcAll(path: string, cap = 50_000): Promise<Row[]> {
  const out: Row[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let offset = 0; offset < cap; offset += 1000) {
    const page = await svc(`${path}${sep}limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

async function whoami(jwt: string): Promise<Who> {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/cockpit_sales_whoami`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (res.status === 401) return { signed_in: false };
  if (!res.ok) throw new Error(`the seat check answered ${res.status}`);
  return (await res.json()) as Who;
}

async function audit(
  who: Who,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
  metadata: Row = {},
): Promise<void> {
  try {
    await svc("cockpit_audit_log", {
      method: "POST",
      body: {
        action,
        entity_type: entityType,
        entity_id: entityId,
        actor_email: who.email ?? null,
        source_app: "sales",
        source_system: "supabase-edge",
        before: before ?? null,
        after: after ?? null,
        metadata,
      },
      prefer: "return=minimal",
    });
  } catch (e) {
    // The change stands; a missing audit row is reported, never silent.
    console.error("audit failed", redact(String(e)));
  }
}

async function ghl(
  method: string,
  path: string,
  body?: unknown,
  version = "2021-04-15",
): Promise<Row> {
  const token = env("SALES_GHL_TOKEN");
  if (!token) throw new Error("HighLevel is not connected (SALES_GHL_TOKEN is missing)");
  const res = await fetch(`${GHL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
      "User-Agent": UA,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      // HighLevel's message is sometimes an object: {error, status}.
      const m = j.message ?? j.msg ?? j.error ?? text;
      msg = typeof m === "string" ? m : String((m as Row)?.error ?? (m as Row)?.message ?? JSON.stringify(m));
    } catch {
      // not JSON
    }
    throw Object.assign(new Error(`HighLevel said ${res.status}: ${redact(msg)}`), { status: res.status });
  }
  return text ? (JSON.parse(text) as Row) : {};
}

async function setting<T>(key: string): Promise<T | null> {
  const rows = await svc(`cockpit_sales_settings?key=eq.${enc(key)}&select=value`);
  return (rows[0]?.value as T) ?? null;
}

function needManager(who: Who) {
  if (!who.manager) throw new Refusal("Only a sales manager can change this.", 403);
}

// ---------------------------------------------------------------------------
// Marking calls
// ---------------------------------------------------------------------------

async function writeMarkToCrm(id: number, appointmentId: string, status: string) {
  let crm = "written";
  let crmError: string | null = null;
  try {
    await ghl("PUT", `/calendars/events/appointments/${enc(appointmentId)}`, {
      appointmentStatus: status,
      toNotify: true,
    });
  } catch (e) {
    crm = "failed";
    crmError = redact(String((e as Error).message ?? e));
  }
  await svc(`cockpit_sales_dispositions?id=eq.${id}`, {
    method: "PATCH",
    body: { crm, crm_error: crmError, crm_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
  return { crm, crm_error: crmError };
}

async function mark(who: Who, b: Row) {
  const id = cleanText(b.appointment_id, 80);
  if (!id) throw new Refusal("Which appointment?");
  const result = await markAppointment(who, id, cleanText(b.status, 20), {
    reason: cleanText(b.reason, 300) || null,
    note: cleanText(b.note, 4000) || null,
  });
  return { mark: result };
}

/**
 * Mark an appointment showed, no-show, cancelled or disqualified: in the
 * cockpit, and in HighLevel when the crm_writes setting and the call's age
 * allow. `anyRep` lets the rep who just spoke to the lead cancel a call
 * booked with someone else (a lead asking a setter to cancel their demo).
 */
async function markAppointment(
  who: Who,
  id: string,
  status: string,
  opts: { reason?: string | null; note?: string | null; anyRep?: boolean } = {},
): Promise<Row> {
  const appt = (await svc(
    `cockpit_sales_appointments?appointment_id=eq.${enc(id)}&select=*`,
  ))[0] as unknown as Appointment | undefined;
  if (!appt)
    throw new Refusal(
      "That appointment is not in the cockpit. It may have been deleted in HighLevel.",
      404,
    );
  const now = Date.now();
  const no = refuseMark(opts.anyRep ? { ...who, manager: true } : who, appt, status, now);
  if (no) throw new Refusal(no, 403);

  const decision = crmDecision(await setting<CrmSettings>("crm_writes"), appt, now);
  const current = (await svc(
    `cockpit_sales_dispositions?appointment_id=eq.${enc(id)}&superseded_at=is.null&select=*`,
  ))[0];
  if (current)
    await svc(`cockpit_sales_dispositions?id=eq.${current.id}`, {
      method: "PATCH",
      body: { superseded_at: new Date(now).toISOString() },
      prefer: "return=minimal",
    });
  const row = (await svc("cockpit_sales_dispositions", {
    method: "POST",
    body: {
      appointment_id: id,
      contact_id: appt.contact_id,
      call_type: appt.call_type,
      start_at: appt.start_at,
      status,
      reason: opts.reason ?? null,
      note: opts.note ?? null,
      marked_by: who.email,
      crm: decision === "write" ? "pending" : decision,
    },
    prefer: "return=representation",
  }))[0];
  let result: Row = { ...row };
  if (decision === "write")
    result = { ...result, ...(await writeMarkToCrm(Number(row.id), id, status)) };
  await audit(who, "mark", "cockpit_sales_dispositions", id, current ?? null, result, {
    crm_status_before: appt.status,
    ...(opts.anyRep ? { by_other_rep: true } : {}),
  });
  return result;
}

async function markRetry(who: Who, b: Row) {
  const id = cleanText(b.appointment_id, 80);
  const current = (await svc(
    `cockpit_sales_dispositions?appointment_id=eq.${enc(id)}&superseded_at=is.null&select=*`,
  ))[0];
  if (!current) throw new Refusal("That call has no mark to send.", 404);
  if (current.crm !== "failed")
    throw new Refusal("That mark is not waiting to be sent to HighLevel.");
  if (!who.manager && current.marked_by !== who.email)
    throw new Refusal("Only the rep who marked it or a manager can send it again.", 403);
  const out = await writeMarkToCrm(Number(current.id), id, String(current.status));
  await audit(who, "mark.retry", "cockpit_sales_dispositions", id, current, out);
  return { mark: { ...current, ...out } };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

async function noteAdd(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  const body = cleanText(b.body, 20000);
  if (!contact) throw new Refusal("Which lead?");
  if (!body) throw new Refusal("Write the note first.");
  const kind = ["note", "call", "script", "handoff"].includes(String(b.kind))
    ? String(b.kind)
    : "note";
  const fields =
    b.fields && typeof b.fields === "object" && !Array.isArray(b.fields) ? b.fields : {};
  const row = (await svc("cockpit_sales_notes", {
    method: "POST",
    body: {
      contact_id: contact,
      appointment_id: cleanText(b.appointment_id, 80) || null,
      kind,
      body,
      fields,
      author: who.email,
    },
    prefer: "return=representation",
  }))[0];
  await audit(who, "note.add", "cockpit_sales_notes", String(row.id), null, row);
  return { note: row };
}

async function noteDelete(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const note = (await svc(`cockpit_sales_notes?id=eq.${enc(id)}&select=*`))[0];
  if (!note) throw new Refusal("That note is not there any more.", 404);
  if (!who.manager && note.author !== who.email)
    throw new Refusal("Only the person who wrote a note or a manager can delete it.", 403);
  await svc(`cockpit_sales_notes?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
  await audit(who, "note.delete", "cockpit_sales_notes", id, note, null);
  return {};
}

// ---------------------------------------------------------------------------
// Proposals and the worker's queue
// ---------------------------------------------------------------------------

async function proposalDraft(who: Who, b: Row) {
  if (!who.manager && !["closer", "both"].includes(String(who.role)))
    throw new Refusal("Proposals are drafted by closers.", 403);
  const contact = cleanText(b.contact_id, 80);
  const lead = (await svc(
    `cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=contact_id`,
  ))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const open = await svc(
    `cockpit_sales_requests?kind=eq.proposal&contact_id=eq.${enc(contact)}&status=in.(queued,running)&select=id`,
  );
  if (open.length)
    throw new Refusal("A proposal for this lead is already being drafted. It takes about ten minutes.");
  const offer = checkOffer(b.offer);
  if (!offer.ok) throw new Refusal(offer.error);
  const lang = b.lang === "en" ? "en" : "ar";
  const requestId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const recording = cleanText(b.recording_id, 40) || null;
  const appointment = cleanText(b.appointment_id, 80) || null;
  await svc("cockpit_sales_requests", {
    method: "POST",
    body: {
      id: requestId,
      kind: "proposal",
      contact_id: contact,
      appointment_id: appointment,
      params: { lang, recording_id: recording, proposal_id: proposalId, offer: offer.offer },
      requested_by: who.email,
    },
    prefer: "return=minimal",
  });
  const row = (await svc("cockpit_sales_proposals", {
    method: "POST",
    body: {
      id: proposalId,
      request_id: requestId,
      contact_id: contact,
      appointment_id: appointment,
      recording_id: recording,
      lang,
      status: "drafting",
      created_by: who.email,
    },
    prefer: "return=representation",
  }))[0];
  await audit(who, "proposal.draft", "cockpit_sales_proposals", proposalId, null, row, {
    offer: offer.offer,
  });
  return { proposal: row };
}

async function proposalSet(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const status = String(b.status);
  if (!["sent", "archived"].includes(status)) throw new Refusal("Mark it sent or archive it.");
  const p = (await svc(`cockpit_sales_proposals?id=eq.${enc(id)}&select=*`))[0];
  if (!p) throw new Refusal("That proposal is not there any more.", 404);
  if (!who.manager && p.created_by !== who.email)
    throw new Refusal("Only the closer who drafted it or a manager can change it.", 403);
  if (status === "sent" && p.status !== "ready")
    throw new Refusal(
      p.status === "needs_input"
        ? "Fill in the missing figures first. The proposal still has blanks."
        : "Only a finished proposal can be marked sent.",
    );
  const patch: Row = { status, updated_at: new Date().toISOString() };
  if (status === "sent") {
    patch.sent_at = patch.updated_at;
    patch.sent_by = who.email;
  }
  await svc(`cockpit_sales_proposals?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
  });
  await audit(who, `proposal.${status}`, "cockpit_sales_proposals", id, p, { ...p, ...patch });
  return { proposal: { ...p, ...patch } };
}

/**
 * The closer fills the blanks the draft left (FILL), and the worker rebuilds
 * the document from the corrected data: validated again, no model call.
 */
async function proposalFill(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const p = (await svc(`cockpit_sales_proposals?id=eq.${enc(id)}&select=*`))[0];
  if (!p) throw new Refusal("That proposal is not there any more.", 404);
  if (!who.manager && p.created_by !== who.email)
    throw new Refusal("Only the closer who drafted it or a manager can fill it in.", 403);
  if (!["needs_input", "ready", "failed"].includes(String(p.status)) || !p.deal)
    throw new Refusal("Only a finished draft can be filled in. Wait for the draft first.");
  const fills = (b.fills && typeof b.fills === "object" ? b.fills : {}) as Row;
  const out = applyFills(p.deal, fills);
  if (!out.ok) throw new Refusal(out.error);
  if (!out.changed.length) throw new Refusal("Type at least one figure first.");
  const requestId = crypto.randomUUID();
  await svc("cockpit_sales_requests", {
    method: "POST",
    body: {
      id: requestId,
      kind: "proposal",
      contact_id: p.contact_id,
      appointment_id: p.appointment_id,
      params: { proposal_id: id, rebuild: true, lang: p.lang },
      requested_by: who.email,
    },
    prefer: "return=minimal",
  });
  const patch = {
    deal: out.deal,
    status: "drafting",
    request_id: requestId,
    error: null,
    updated_at: new Date().toISOString(),
  };
  await svc(`cockpit_sales_proposals?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
  });
  await audit(who, "proposal.fill", "cockpit_sales_proposals", id, { deal: p.deal }, { deal: out.deal }, {
    changed: out.changed,
  });
  return { proposal: { ...p, ...patch }, changed: out.changed };
}

/**
 * Draft a proposal again with the same choices (language, recording,
 * offer). The worker closes a request as done even when its draft fails the
 * checker, so a retry is a new request on the same proposal, never a replay
 * of the old one.
 */
async function proposalRetry(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const p = (await svc(`cockpit_sales_proposals?id=eq.${enc(id)}&select=*`))[0];
  if (!p) throw new Refusal("That proposal is not there any more.", 404);
  if (!who.manager && p.created_by !== who.email)
    throw new Refusal("Only the closer who drafted it or a manager can try it again.", 403);
  if (!["failed", "needs_input", "ready"].includes(String(p.status)))
    throw new Refusal("This proposal is already being written.");
  const open = await svc(
    `cockpit_sales_requests?kind=eq.proposal&params->>proposal_id=eq.${enc(id)}&status=in.(queued,running)&select=id`,
  );
  if (open.length) throw new Refusal("This proposal is already being written.");
  const first = (await svc(
    `cockpit_sales_requests?kind=eq.proposal&params->>proposal_id=eq.${enc(id)}&select=params&order=requested_at.asc&limit=1`,
  ))[0];
  const was = (first?.params ?? {}) as Row;
  const requestId = crypto.randomUUID();
  await svc("cockpit_sales_requests", {
    method: "POST",
    body: {
      id: requestId,
      kind: "proposal",
      contact_id: p.contact_id,
      appointment_id: p.appointment_id,
      params: {
        lang: p.lang,
        recording_id: p.recording_id ?? was.recording_id ?? null,
        proposal_id: id,
        offer: was.offer ?? { guarantee: false, payment: "pif" },
      },
      requested_by: who.email,
    },
    prefer: "return=minimal",
  });
  const patch = { status: "drafting", request_id: requestId, error: null, updated_at: new Date().toISOString() };
  await svc(`cockpit_sales_proposals?id=eq.${enc(id)}`, { method: "PATCH", body: patch, prefer: "return=minimal" });
  await audit(who, "proposal.retry", "cockpit_sales_proposals", id, { status: p.status }, patch);
  return { proposal: { ...p, ...patch } };
}

async function requestSet(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const to = String(b.to);
  const r = (await svc(`cockpit_sales_requests?id=eq.${enc(id)}&select=*`))[0];
  if (!r) throw new Refusal("That request is not there any more.", 404);
  if (!who.manager && r.requested_by !== who.email)
    throw new Refusal("Only the person who asked or a manager can change it.", 403);
  let patch: Row;
  if (to === "cancelled") {
    if (r.status !== "queued") throw new Refusal("Only a request that has not started can be cancelled.");
    patch = { status: "cancelled", finished_at: new Date().toISOString() };
  } else if (to === "queued") {
    if (r.status !== "failed") throw new Refusal("Only a failed request can be tried again.");
    patch = { status: "queued", attempts: 0, error: null, claimed_at: null, finished_at: null };
  } else throw new Refusal("Cancel it or try it again.");
  // Conditional on the status read above, so a worker that claimed it in
  // the meantime wins.
  const out = await svc(`cockpit_sales_requests?id=eq.${enc(id)}&status=eq.${enc(String(r.status))}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=representation",
  });
  if (!out.length) throw new Refusal("It changed while you were looking. Refresh and try again.", 409);
  const pid = (r.params as Row | null)?.proposal_id;
  if (r.kind === "proposal" && pid)
    await svc(`cockpit_sales_proposals?id=eq.${enc(String(pid))}`, {
      method: "PATCH",
      body:
        to === "cancelled"
          ? { status: "archived", updated_at: new Date().toISOString() }
          : { status: "drafting", error: null, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
  await audit(who, `request.${to}`, "cockpit_sales_requests", id, r, out[0]);
  return { request: out[0] };
}

// ---------------------------------------------------------------------------
// Seats, links and settings (managers)
// ---------------------------------------------------------------------------

async function personSave(who: Who, b: Row) {
  needManager(who);
  const email = checkEmail(b.email);
  if (!email) throw new Refusal("That is not an email address.");
  const before = (await svc(`cockpit_sales_people?email=eq.${enc(email)}&select=*`))[0];
  if (!before)
    throw new Refusal("Give them the Sales cockpit on the portal's Admin page first; the seat appears here after that.", 404);
  const patch: Row = { updated_at: new Date().toISOString(), updated_by: who.email };
  for (const k of ["ghl_user_id", "slack_user_id"] as const)
    if (k in b) patch[k] = cleanText(b[k], 60) || null;
  for (const k of ["maqsam_email", "fathom_email"] as const)
    if (k in b) {
      const v = cleanText(b[k], 200);
      if (v && !checkEmail(v)) throw new Refusal(`The ${k.split("_")[0]} address is not an email.`);
      patch[k] = v ? v.toLowerCase() : null;
    }
  if ("b2b_rep_id" in b) {
    const v = cleanText(b.b2b_rep_id, 40);
    if (v && !/^[0-9a-f-]{36}$/.test(v)) throw new Refusal("That is not a B2B rep.");
    patch.b2b_rep_id = v || null;
  }
  // Linking the HighLevel user links the B2B rep too, which is how the
  // scorecard knows whose numbers are whose.
  // Changing or clearing the HighLevel user moves the B2B link with it, so a
  // seat's numbers never keep following the rep it used to be linked to.
  if ("ghl_user_id" in patch && !("b2b_rep_id" in b)) {
    const rep = patch.ghl_user_id
      ? (await svc(
          `cockpit_sales_reps?ghl_user_id=eq.${enc(String(patch.ghl_user_id))}&select=id`,
        ))[0]
      : undefined;
    patch.b2b_rep_id = rep ? rep.id : null;
  }
  if ("name" in b) patch.name = cleanText(b.name, 120) || null;
  if ("name_ar" in b) {
    const v = cleanText(b.name_ar, 60);
    if (v && !/[\u0600-\u06ff]/.test(v)) throw new Refusal("Write the name in Arabic letters, the way it reads in a message.");
    patch.name_ar = v || null;
  }
  if ("active" in b) patch.active = Boolean(b.active);
  if ("pay" in b) {
    const p = checkPay(b.pay);
    if (!p.ok) throw new Refusal(p.error);
    patch.pay = p.pay;
  }
  if ("goals" in b) {
    const g = checkGoals(b.goals);
    if (!g.ok) throw new Refusal(g.error);
    patch.goals = g.goals;
  }
  const out = await svc(`cockpit_sales_people?email=eq.${enc(email)}`, {
    method: "PATCH",
    body: patch,
    prefer: "return=representation",
  });
  await audit(who, "person.save", "cockpit_sales_people", email, before, out[0]);
  return { person: out[0] };
}

async function linkSave(who: Who, b: Row) {
  needManager(who);
  const c = checkLink(b);
  if (!c.ok) throw new Refusal(c.error);
  const id = cleanText(b.id, 40);
  const row = { ...c.row, updated_by: who.email, updated_at: new Date().toISOString() };
  let out: Row[];
  let before: Row | null = null;
  if (id) {
    before = (await svc(`cockpit_sales_links?id=eq.${enc(id)}&select=*`))[0] ?? null;
    if (!before) throw new Refusal("That link is not there any more.", 404);
    out = await svc(`cockpit_sales_links?id=eq.${enc(id)}`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    });
  } else {
    out = await svc("cockpit_sales_links", {
      method: "POST",
      body: row,
      prefer: "return=representation",
    });
  }
  await audit(who, "link.save", "cockpit_sales_links", String(out[0]?.id ?? id), before, out[0]);
  return { link: out[0] };
}

async function settingSave(who: Who, b: Row) {
  needManager(who);
  const key = String(b.key);
  if (key !== "crm_writes") throw new Refusal("That setting cannot be changed here.");
  const v = (b.value ?? {}) as Row;
  const days = Number(v.backlog_days ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 60)
    throw new Refusal("Old calls are counted in whole days, 1 to 60.");
  const value = { dispositions: Boolean(v.dispositions), backlog_days: days };
  const before = await setting<Row>(key);
  await svc("cockpit_sales_settings?on_conflict=key", {
    method: "POST",
    body: { key, value, updated_by: who.email, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  await audit(who, "setting.save", "cockpit_sales_settings", key, before, value);
  return { setting: { key, value } };
}

// ---------------------------------------------------------------------------
// Talking to a lead: HighLevel conversations on the sales sub-account
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_CHARS: Record<Channel, number> = { whatsapp: 4096, sms: 1600, email: 10000 };
const CHANNEL_WORD: Record<Channel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "email" };

function agoWords(iso: string | null): string {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 48) return `${Math.max(1, Math.round(h))} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The newest inbound WhatsApp message across the lead's conversations. */
function lastWhatsappIn(convs: Row[], thread: ThreadMessage[]): string | null {
  const times = [
    ...convs.map(c => c.lastInboundWhatsappMessageDate ?? c.lastInboundWhatsAppMessageDate),
    ...thread.filter(m => m.direction === "inbound" && m.channel === "whatsapp").map(m => m.at),
  ]
    .map(v => (v ? Date.parse(String(typeof v === "number" ? new Date(v).toISOString() : v)) : Number.NaN))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function messagingSwitch(): Promise<Record<Channel, boolean>> {
  const v = (await setting<Row>("messaging")) ?? {};
  return { whatsapp: v.whatsapp !== false, email: v.email !== false, sms: v.sms === true };
}

/**
 * A lead's conversation as one thread: every HighLevel conversation the
 * contact has, merged, newest first, 40 at a time each (`older` with the
 * cursors reads further back), with what each channel allows right now.
 */
async function convoRead(_who: Who, b: Row) {
  const id = cleanText(b.contact_id, 80);
  if (!id) throw new Refusal("Which lead?");
  const now = Date.now();
  const [contactOut, convsOut, sends, switches] = await Promise.all([
    ghl("GET", `/contacts/${enc(id)}`, undefined, "2021-07-28"),
    ghl("GET", `/conversations/search?locationId=${LOCATION}&contactId=${enc(id)}&limit=20`),
    svc(
      `cockpit_sales_messages?contact_id=eq.${enc(id)}&select=id,request_id,channel,state,sent_by,source,ghl_message_id,error,created_at&order=created_at.desc&limit=50`,
    ),
    messagingSwitch(),
  ]);
  const c = ((contactOut as Row).contact ?? {}) as Row;
  const convs = (((convsOut as Row).conversations ?? []) as Row[]).slice(0, 6);
  const older = Boolean(b.older);
  const cursors = (b.cursors ?? {}) as Record<string, string>;
  const pages = await Promise.all(
    convs.map(async cv => {
      const cid = String(cv.id);
      if (older && !cursors[cid]) return { cid, list: [] as ThreadMessage[], next: null as string | null };
      const q = `limit=40${older && cursors[cid] ? `&lastMessageId=${enc(cursors[cid])}` : ""}`;
      const m = await ghl("GET", `/conversations/${enc(cid)}/messages?${q}`);
      const inner = ((m as Row).messages ?? {}) as Row;
      const list = toThread(Array.isArray(inner.messages) ? inner.messages : (m as Row).messages, cid);
      const next = inner.nextPage ? String(inner.lastMessageId ?? list.at(-1)?.id ?? "") || null : null;
      return { cid, list, next };
    }),
  );
  const thread = mergeThreads(pages.map(p => p.list), 160);
  const window = whatsappWindow(lastWhatsappIn(convs, thread), now);
  return {
    contact: {
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      tags: c.tags ?? [],
      dnd: c.dnd ?? null,
      assigned_to: c.assignedTo ?? null,
      source: c.source ?? null,
    },
    channels: {
      whatsapp: { on: switches.whatsapp, dnd: dndFor(c, "whatsapp"), reachable: Boolean(c.phone), window },
      email: { on: switches.email, dnd: dndFor(c, "email"), reachable: Boolean(c.email) },
      sms: { on: switches.sms, dnd: dndFor(c, "sms"), reachable: Boolean(c.phone) },
    },
    thread,
    cursors: Object.fromEntries(pages.filter(p => p.next).map(p => [p.cid, p.next])),
    sends,
    read_at: new Date(now).toISOString(),
  };
}

/**
 * Send one message to a lead now. Written first (request_id is unique, so a
 * retry returns the first send and never sends twice), then sent, then read
 * back from HighLevel for up to ten seconds, because a WhatsApp send
 * HighLevel accepts can still fail at Meta.
 */
async function convoSend(who: Who, b: Row) {
  const contactId = cleanText(b.contact_id, 80);
  const channel = String(b.channel ?? "") as Channel;
  const requestId = String(b.request_id ?? "");
  const text = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!contactId) throw new Refusal("Which lead?");
  if (!(channel in MAX_CHARS)) throw new Refusal("Send on WhatsApp or by email.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new Refusal("Reload the page and send again.");
  if (!text) throw new Refusal("Write the message first.");
  if (text.length > MAX_CHARS[channel])
    throw new Refusal(`That is too long for ${CHANNEL_WORD[channel]} (${MAX_CHARS[channel]} characters at most).`);
  const subject = channel === "email" ? cleanText(b.subject, 300) : null;
  if (channel === "email" && !subject) throw new Refusal("An email needs a subject.");
  const followupId = b.followup_id ? cleanText(b.followup_id, 40) : null;
  const assetId = await assetFor(b.asset_id);

  const already = (await svc(`cockpit_sales_messages?request_id=eq.${enc(requestId)}&select=*`))[0];
  if (already) {
    if (already.contact_id === contactId && already.body === text && already.channel === channel)
      return { message: already, repeated: true };
    throw new Refusal("That send was already used for another message. Reload and send again.", 409);
  }
  if (!(await messagingSwitch())[channel])
    throw new Refusal(`Sending by ${CHANNEL_WORD[channel]} is switched off in the cockpit.`, 409);
  await senderCeiling(who);
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);

  const contact = (((await ghl("GET", `/contacts/${enc(contactId)}`, undefined, "2021-07-28")) as Row).contact ??
    {}) as Row;
  if (dndFor(contact, channel))
    throw new Refusal(`This lead asked not to be contacted by ${CHANNEL_WORD[channel]} (do not disturb is on in HighLevel).`, 409);
  if (channel === "email" && !contact.email) throw new Refusal("This lead has no email address in HighLevel.", 409);
  if (channel !== "email" && !contact.phone) throw new Refusal("This lead has no phone number in HighLevel.", 409);
  if (channel === "whatsapp") {
    const convs = (((await ghl("GET", `/conversations/search?locationId=${LOCATION}&contactId=${enc(contactId)}&limit=20`)) as Row)
      .conversations ?? []) as Row[];
    const w = whatsappWindow(lastWhatsappIn(convs, []), Date.now());
    if (!w.open)
      throw new Refusal(
        `WhatsApp only takes a free message within 24 hours of the lead's own last message; they last wrote ${agoWords(w.last_inbound_at)}. Email them instead, or wait for them to write.`,
        409,
      );
  }

  let row: Row;
  try {
    row = (await svc("cockpit_sales_messages", {
      method: "POST",
      body: {
        request_id: requestId,
        contact_id: contactId,
        channel,
        subject,
        body: text,
        source: followupId ? "followup" : "rep",
        followup_id: followupId,
        sent_by: who.email,
        state: "sending",
      },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    if (/23505|duplicate/.test(String((e as Error).message ?? e))) {
      const twin = (await svc(`cockpit_sales_messages?request_id=eq.${enc(requestId)}&select=*`))[0];
      return { message: twin, repeated: true };
    }
    throw e;
  }

  let out: Row;
  try {
    out = await ghl("POST", "/conversations/messages", sendBody(channel, contactId, text, subject));
  } catch (e) {
    const err = redact(String((e as Error).message ?? e));
    await svc(`cockpit_sales_messages?id=eq.${row.id}`, {
      method: "PATCH",
      body: { state: "failed", error: err, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    await audit(who, "convo.send", "cockpit_sales_messages", String(row.id), null, { channel, state: "failed", error: err });
    throw new Refusal(`HighLevel did not send it: ${err}`, 502);
  }
  const messageId = String(out.messageId ?? "");
  let status = String(out.status ?? "pending");
  let error: string | null = null;
  // Read it back: HighLevel answers "pending" and Meta decides afterwards.
  for (let i = 0; i < 5 && messageId; i++) {
    await sleep(2000);
    try {
      const m = (await ghl("GET", `/conversations/messages/${enc(messageId)}`)) as Row;
      const one = (m.message ?? m) as Row;
      status = String(one.status ?? status);
      const [shaped] = toThread([{ ...one, id: one.id ?? messageId }], String(out.conversationId ?? ""));
      error = shaped?.error ?? null;
      if (["delivered", "read", "failed", "undelivered", "opened"].includes(status)) break;
    } catch {
      break; // an email's id is not always readable this way; keep what we have
    }
  }
  const state = stateOf(status === "pending" && !error ? "sent" : status);
  const saved = (await svc(`cockpit_sales_messages?id=eq.${row.id}`, {
    method: "PATCH",
    body: {
      state,
      provider_status: status,
      error: state === "failed" ? (error ?? "HighLevel marked it failed without a reason") : null,
      ghl_message_id: messageId || null,
      ghl_conversation_id: out.conversationId ?? null,
      updated_at: new Date().toISOString(),
    },
    prefer: "return=representation",
  }))[0];
  await audit(who, "convo.send", "cockpit_sales_messages", String(row.id), null,
    { channel, state, provider_status: status, followup_id: followupId, asset_id: assetId }, { lead: lead.name ?? null });
  if (assetId && state !== "failed") await assetSent(who, assetId, contactId, channel === "email" ? "email" : "whatsapp", String(row.id));
  return { message: saved };
}

// ---------------------------------------------------------------------------
// WhatsApp templates: the only way to reach a lead whose window is closed
// ---------------------------------------------------------------------------

/** Kuwait's midnight (UTC+3, no daylight saving) that begins the day of `ms`, as an instant. */
function kuwaitMidnightIso(ms: number): string {
  const k = new Date(ms + 3 * 3_600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3_600_000).toISOString();
}

interface WhatsappGuard {
  templates_per_day: number;
  /** Automatic sends pause when this share of the last day's WhatsApp sends failed. */
  pause_fail_share: number;
  /** ...counted only once at least this many were sent. */
  pause_min_sends: number;
}

async function whatsappGuard(): Promise<WhatsappGuard> {
  const v = ((await setting<Row>("whatsapp_guard")) ?? {}) as Row;
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : d);
  return {
    templates_per_day: Math.round(n(v.templates_per_day, 250)),
    pause_fail_share: Math.min(1, n(v.pause_fail_share, 0.3)),
    pause_min_sends: Math.round(n(v.pause_min_sends, 5)),
  };
}

/**
 * Whether WhatsApp is healthy enough to send without a person: the share of
 * the last day's WhatsApp sends that failed (Meta's spam and engagement
 * limits, an empty wallet, a paused template). While it is high, drafts wait
 * for a person, who sees the reasons on the Follow-ups page.
 */
async function whatsappHealth(): Promise<{ paused: boolean; why: string; sent: number; failed: number }> {
  const guard = await whatsappGuard();
  const rows = await svc(
    `cockpit_sales_messages?channel=eq.whatsapp&state=in.(sent,delivered,read,failed)&created_at=gte.${enc(new Date(Date.now() - 86_400_000).toISOString())}&select=state,error&limit=2000`,
  );
  const failed = rows.filter(r => r.state === "failed");
  const paused = rows.length >= guard.pause_min_sends && failed.length / rows.length >= guard.pause_fail_share;
  const reason = failed.map(r => String(r.error ?? "")).find(Boolean) ?? "no reason given";
  return {
    paused,
    sent: rows.length,
    failed: failed.length,
    why: paused
      ? `Automatic WhatsApp sends are paused: ${failed.length} of the last day's ${rows.length} failed (${redact(reason).slice(0, 160)}). A person sends until that clears.`
      : "",
  };
}

/**
 * No sender sends more than 30 messages in ten minutes: far above a person's
 * pace, it stops a stuck page, a runaway script or a leaked session from
 * flooding leads (and the number's standing with Meta).
 */
async function senderCeiling(who: Who) {
  const recent = await svc(
    `cockpit_sales_messages?sent_by=eq.${enc(String(who.email ?? ""))}&created_at=gte.${enc(new Date(Date.now() - 600_000).toISOString())}&select=id&limit=31`,
  );
  if (recent.length >= 30)
    throw new Refusal("That is 30 messages in ten minutes from you. Wait a few minutes; the ceiling keeps a stuck page or a script from flooding leads.", 429);
}

/** The sales asset a message carries, if it names one the cockpit has. */
async function assetFor(v: unknown): Promise<string | null> {
  const id = cleanText(v, 40);
  if (!id) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Refusal("That is not one of the sales assets.");
  const a = (await svc(`cockpit_sales_assets?id=eq.${enc(id)}&select=id,slug,sendable`))[0];
  if (!a) throw new Refusal("That asset is not in the library any more.", 404);
  if (!a.sendable) throw new Refusal("That asset may not be sent (its link, its claims or its age).", 409);
  const hidden = (((await setting<Row>("assets")) ?? {}).hidden ?? {}) as Record<string, unknown>;
  if (a.slug && hidden[String(a.slug)]) throw new Refusal("A manager stopped offering that asset.", 409);
  return id;
}

/** A sales asset went to a lead: logged for the library's counts, never fatal to the send. */
async function assetSent(who: Who, assetId: string, contactId: string, channel: "whatsapp" | "email", messageId: string) {
  try {
    await svc("cockpit_sales_asset_sends", {
      method: "POST",
      body: { asset_id: assetId, contact_id: contactId, channel, message_id: messageId, sent_by: who.email },
      prefer: "return=minimal",
    });
  } catch (e) {
    console.error("asset send log", redact(String(e)));
  }
}

async function templateRoute(key: string): Promise<TemplateRoute> {
  const r = (await svc(`cockpit_sales_wa_templates?key=eq.${enc(key)}&select=*`))[0] as unknown as TemplateRoute | undefined;
  if (!r) throw new Refusal("That WhatsApp template is not in the cockpit.", 404);
  if (!r.active || !r.workflow_id)
    throw new Refusal(
      `The ${r.name} template is not set up yet. A manager picks the HighLevel workflow that sends it, under Follow-ups, WhatsApp library.`,
      409,
    );
  return r;
}

/** The newest WhatsApp that went to this lead since `since`, read back from their conversations. */
async function whatsappSentSince(contactId: string, since: number): Promise<ThreadMessage | null> {
  const convs = (((await ghl("GET", `/conversations/search?locationId=${LOCATION}&contactId=${enc(contactId)}&limit=5`)) as Row)
    .conversations ?? []) as Row[];
  for (const cv of convs.slice(0, 3)) {
    const m = await ghl("GET", `/conversations/${enc(String(cv.id))}/messages?limit=10`);
    const inner = ((m as Row).messages ?? {}) as Row;
    const list = toThread(Array.isArray(inner.messages) ? inner.messages : (m as Row).messages, String(cv.id));
    const hit = list.find(
      x => x.direction === "outbound" && x.channel === "whatsapp" && x.at !== null && Date.parse(x.at) >= since - 15_000,
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Who a template says it is from: the lead's own rep, else the rep sending
 * it; in an Arabic template only by their name in Arabic letters, else the
 * sales team.
 */
async function signatureFor(contactId: string, who: Who, language: "ar" | "en"): Promise<string> {
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=assigned_to`))[0];
  const owner = lead?.assigned_to
    ? (await svc(`cockpit_sales_people?ghl_user_id=eq.${enc(String(lead.assigned_to))}&active=eq.true&select=name,name_ar`))[0]
    : null;
  const sender = who.email && who.email !== "sales-desk"
    ? (await svc(`cockpit_sales_people?email=eq.${enc(who.email)}&select=name,name_ar`))[0]
    : null;
  const person = owner ?? sender ?? null;
  const first = (v: unknown) => String(v ?? "").trim().split(/\s+/)[0] ?? "";
  if (language === "ar") return first(person?.name_ar) || "فريق المبيعات";
  return first(person?.name ?? (sender ? who.name : null)) || "the sales team";
}

/**
 * Send an approved WhatsApp template to a lead. HighLevel's API cannot send
 * a template itself, so the line and the signature go into the contact's
 * two cockpit fields and the lead is enrolled in the one-step workflow that
 * sends the template with them. Written first (request_id is unique, so a
 * retry never sends twice), then read back from the conversation, because a
 * template HighLevel accepts can still fail at Meta.
 */
async function sendTemplate(
  who: Who,
  o: { contactId: string; key: string; line: string; requestId: string; followupId: string | null; assetId?: string | null },
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(o.requestId))
    throw new Refusal("Reload the page and send again.");
  const route = await templateRoute(o.key);
  const needsLine = route.variables.includes("line");
  const line = needsLine ? templateLine(o.line) : "";
  if (needsLine && line.length < 2) throw new Refusal("Write the line that goes in the message.");

  const already = (await svc(`cockpit_sales_messages?request_id=eq.${enc(o.requestId)}&select=*`))[0];
  if (already) {
    if (already.contact_id === o.contactId && already.template_key === o.key) return { message: already, repeated: true };
    throw new Refusal("That send was already used for another message. Reload and send again.", 409);
  }
  if (!(await messagingSwitch()).whatsapp) throw new Refusal("Sending by WhatsApp is switched off in the cockpit.", 409);
  await senderCeiling(who);
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(o.contactId)}&select=contact_id,name`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  // The line rides in a contact field until the workflow reads it: a second
  // template within two minutes could overwrite the first one's line.
  const recent = await svc(
    `cockpit_sales_messages?contact_id=eq.${enc(o.contactId)}&via=eq.workflow&state=neq.failed&created_at=gte.${enc(new Date(Date.now() - 120_000).toISOString())}&select=id&limit=1`,
  );
  if (recent.length) throw new Refusal("A template went to this lead a moment ago. Wait two minutes before sending another.", 409);
  // A daily ceiling on templates: too many at once, or too many ignored, and
  // Meta lowers the number's quality and then limits it.
  const guard = await whatsappGuard();
  const sentToday = await svc(
    `cockpit_sales_messages?via=eq.workflow&state=neq.failed&created_at=gte.${enc(kuwaitMidnightIso(Date.now()))}&select=id&limit=${guard.templates_per_day + 1}`,
  );
  if (sentToday.length >= guard.templates_per_day)
    throw new Refusal(
      `Today's ${guard.templates_per_day} WhatsApp templates have gone out. The ceiling protects the number's standing with Meta; more tomorrow, or a manager raises it under Follow-ups, How it works.`,
      409,
    );
  const contact = (((await ghl("GET", `/contacts/${enc(o.contactId)}`, undefined, "2021-07-28")) as Row).contact ?? {}) as Row;
  if (dndFor(contact, "whatsapp"))
    throw new Refusal("This lead asked not to be contacted on WhatsApp (do not disturb is on in HighLevel).", 409);
  if (!contact.phone) throw new Refusal("This lead has no phone number in HighLevel.", 409);
  const firstName = cleanText(contact.firstName, 60).split(/\s+/)[0] ?? "";
  if (route.variables.includes("first_name") && !firstName)
    throw new Refusal("This lead has no first name in HighLevel, and the template greets them by it. Add it there first.", 409);
  const signature = route.variables.includes("rep_name") ? await signatureFor(o.contactId, who, route.language) : "";
  const text = renderTemplate(route.preview, route.variables, { first_name: firstName, rep_name: signature, line });
  const fields = (await setting<{ line?: { id: string }; rep?: { id: string } }>("wa_fields")) ?? {};
  if ((needsLine && !fields.line?.id) || (route.variables.includes("rep_name") && !fields.rep?.id))
    throw new Refusal("The cockpit's two HighLevel contact fields are not set (setting wa_fields).", 409);

  let row: Row;
  try {
    row = (await svc("cockpit_sales_messages", {
      method: "POST",
      body: {
        request_id: o.requestId,
        contact_id: o.contactId,
        channel: "whatsapp",
        via: "workflow",
        template_key: route.key,
        workflow_id: route.workflow_id,
        body: text,
        source: o.followupId ? "followup" : "rep",
        followup_id: o.followupId,
        sent_by: who.email,
        state: "sending",
      },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    if (/23505|duplicate/.test(String((e as Error).message ?? e))) {
      const twin = (await svc(`cockpit_sales_messages?request_id=eq.${enc(o.requestId)}&select=*`))[0];
      return { message: twin, repeated: true };
    }
    throw e;
  }

  const fail = async (err: string) => {
    await svc(`cockpit_sales_messages?id=eq.${row.id}`, {
      method: "PATCH",
      body: { state: "failed", error: err, updated_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    await audit(who, "wa.template", "cockpit_sales_messages", String(row.id), null, { template: route.key, state: "failed", error: err });
    throw new Refusal(`HighLevel did not send it: ${err}`, 502);
  };
  const customFields = [
    ...(needsLine ? [{ id: fields.line?.id, field_value: line }] : []),
    ...(route.variables.includes("rep_name") ? [{ id: fields.rep?.id, field_value: signature }] : []),
  ];
  const startedAt = Date.now();
  try {
    if (customFields.length) await ghl("PUT", `/contacts/${enc(o.contactId)}`, { customFields }, "2021-07-28");
    await ghl("POST", `/contacts/${enc(o.contactId)}/workflow/${enc(String(route.workflow_id))}`,
      { eventStartTime: new Date(startedAt).toISOString() }, "2021-07-28");
  } catch (e) {
    return await fail(redact(String((e as Error).message ?? e)));
  }
  // Read it back: the workflow sends within seconds, and Meta decides after.
  let seen: ThreadMessage | null = null;
  for (let i = 0; i < 6; i++) {
    await sleep(2000);
    try {
      seen = await whatsappSentSince(o.contactId, startedAt);
    } catch {
      seen = null;
    }
    if (seen && seen.status && !["pending", "queued"].includes(seen.status)) break;
  }
  const state = seen ? stateOf(seen.status === "pending" && !seen.error ? "sent" : seen.status) : "sent";
  const saved = (await svc(`cockpit_sales_messages?id=eq.${row.id}`, {
    method: "PATCH",
    body: {
      state,
      provider_status: seen ? seen.status : "enrolled",
      error: state === "failed" ? (seen?.error ?? "HighLevel marked it failed without a reason") : null,
      ghl_message_id: seen?.id ?? null,
      ghl_conversation_id: seen?.conversation_id ?? null,
      updated_at: new Date().toISOString(),
    },
    prefer: "return=representation",
  }))[0];
  await audit(who, "wa.template", "cockpit_sales_messages", String(row.id), null,
    { template: route.key, workflow: route.workflow_id, state, seen: Boolean(seen), followup_id: o.followupId,
      asset_id: o.assetId ?? null },
    { lead: lead.name ?? null });
  if (o.assetId && state !== "failed") await assetSent(who, o.assetId, o.contactId, "whatsapp", String(row.id));
  return { message: saved };
}

/** A rep sends an approved template from the lead's conversation. */
async function waTemplateSend(who: Who, b: Row) {
  const contactId = cleanText(b.contact_id, 80);
  if (!contactId) throw new Refusal("Which lead?");
  return await sendTemplate(who, {
    contactId,
    key: cleanText(b.template_key, 40),
    line: String(b.line ?? ""),
    requestId: String(b.request_id ?? ""),
    followupId: null,
    assetId: await assetFor(b.asset_id),
  });
}

/** A manager sets up a template: its approved text, what goes in it, and the workflow that sends it. */
async function waTemplateSave(who: Who, b: Row) {
  needManager(who);
  const c = checkTemplateRoute(b);
  if (!c.ok) throw new Refusal(c.error);
  const before = (await svc(`cockpit_sales_wa_templates?key=eq.${enc(c.value.key)}&select=*`))[0] ?? null;
  if (c.value.workflow_id) {
    const flows = await workflowsList();
    const flow = flows.find(w => w.id === c.value.workflow_id);
    if (!flow) throw new Refusal("That workflow is not in the sales sub-account.", 404);
    if (c.value.active && flow.status !== "published")
      throw new Refusal(`"${flow.name}" is a draft in HighLevel. Publish it there, then switch the template on.`, 409);
  }
  const out = await svc("cockpit_sales_wa_templates?on_conflict=key", {
    method: "POST",
    body: { ...c.value, updated_by: who.email, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=representation",
  });
  await audit(who, "wa.template.save", "cockpit_sales_wa_templates", c.value.key, before, out[0]);
  return { template: out[0] };
}

let workflowsCache: { at: number; list: { id: string; name: string; status: string }[] } | null = null;

async function workflowsList() {
  if (workflowsCache && Date.now() - workflowsCache.at < 60_000) return workflowsCache.list;
  const out = await ghl("GET", `/workflows/?locationId=${LOCATION}`, undefined, "2021-07-28");
  const list = ((out.workflows ?? []) as Row[])
    .map(w => ({ id: String(w.id), name: String(w.name ?? ""), status: String(w.status ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  workflowsCache = { at: Date.now(), list };
  return list;
}

/** The sub-account's workflows, for a manager choosing which one sends a template. */
async function ghlWorkflows(who: Who) {
  needManager(who);
  return { workflows: await workflowsList() };
}

/**
 * Stop, or start again, offering an asset in Proof to send: for an asset
 * whose claims no longer match what Mahara says (the library is Muhammed's,
 * in B2B, and stays as it is there).
 */
async function assetHide(who: Who, b: Row) {
  needManager(who);
  const slug = cleanText(b.slug, 160).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Refusal("Which asset?");
  const known = (await svc(`cockpit_sales_assets?slug=eq.${enc(slug)}&select=slug`))[0];
  if (!known) throw new Refusal("That asset is not in the library any more.", 404);
  const before = ((await setting<Row>("assets")) ?? {}) as Row;
  const hidden = { ...((before.hidden ?? {}) as Record<string, Row>) };
  if (b.hidden === true)
    hidden[slug] = { by: who.email, at: new Date().toISOString(), why: cleanText(b.why, 300) || null };
  else delete hidden[slug];
  const value = { ...before, hidden };
  await svc("cockpit_sales_settings?on_conflict=key", {
    method: "POST",
    body: { key: "assets", value, updated_by: who.email, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  await audit(who, "asset.hide", "cockpit_sales_settings", "assets", before, value, { slug, hidden: b.hidden === true });
  return { setting: { key: "assets", value } };
}

async function snippetSave(who: Who, b: Row) {
  needManager(who);
  const c = checkSnippet(b);
  if (!c.ok) throw new Refusal(c.error);
  const id = cleanText(b.id, 40);
  const at = new Date().toISOString();
  let out: Row[];
  let before: Row | null = null;
  if (id) {
    before = (await svc(`cockpit_sales_snippets?id=eq.${enc(id)}&deleted_at=is.null&select=*`))[0] ?? null;
    if (!before) throw new Refusal("That message is not in the library any more.", 404);
    out = await svc(`cockpit_sales_snippets?id=eq.${enc(id)}`, {
      method: "PATCH",
      body: { ...c.row, updated_at: at },
      prefer: "return=representation",
    });
  } else {
    out = await svc("cockpit_sales_snippets", {
      method: "POST",
      body: { ...c.row, created_by: who.email },
      prefer: "return=representation",
    });
  }
  await audit(who, "snippet.save", "cockpit_sales_snippets", String(out[0]?.id ?? id), before, out[0]);
  return { snippet: out[0] };
}

async function snippetDelete(who: Who, b: Row) {
  needManager(who);
  const id = cleanText(b.id, 40);
  const out = await svc(`cockpit_sales_snippets?id=eq.${enc(id)}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  if (!out.length) throw new Refusal("That message is not in the library any more.", 404);
  await audit(who, "snippet.delete", "cockpit_sales_snippets", id, out[0], null);
  return { snippet: out[0] };
}

// ---------------------------------------------------------------------------
// Client references
// ---------------------------------------------------------------------------

/** A manager records a client reference: who, what they may say, and whether they agreed. */
async function referenceSave(who: Who, b: Row) {
  needManager(who);
  const c = checkReference(b);
  if (!c.ok) throw new Refusal(c.error);
  const id = cleanText(b.id, 40);
  const at = new Date().toISOString();
  const before = id ? ((await svc(`cockpit_sales_references?id=eq.${enc(id)}&select=*`))[0] ?? null) : null;
  if (id && !before) throw new Refusal("That reference is not here any more.", 404);
  const consentChanged = !before || before.consent !== c.row.consent;
  const row = {
    ...c.row,
    ...(consentChanged && c.row.consent !== "unknown" ? { consent_by: who.email, consent_at: at } : {}),
    ...(consentChanged && c.row.consent === "unknown" ? { consent_by: null, consent_at: null } : {}),
    updated_by: who.email,
    updated_at: at,
  };
  const out = id
    ? await svc(`cockpit_sales_references?id=eq.${enc(id)}`, { method: "PATCH", body: row, prefer: "return=representation" })
    : await svc("cockpit_sales_references", { method: "POST", body: row, prefer: "return=representation" });
  await audit(who, "reference.save", "cockpit_sales_references", String(out[0]?.id ?? id), before, out[0]);
  return { reference: out[0] };
}

/** A rep asks for a reference call for their lead; a manager arranges it. */
async function referenceAsk(who: Who, b: Row) {
  const contactId = cleanText(b.contact_id, 80);
  if (!contactId) throw new Refusal("For which lead?");
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const refId = cleanText(b.reference_id, 40) || null;
  if (refId) {
    const r = (await svc(`cockpit_sales_references?id=eq.${enc(refId)}&select=id,consent`))[0];
    if (!r) throw new Refusal("That reference is not here any more.", 404);
    if (r.consent === "no") throw new Refusal("That client said no to reference calls. Pick another, or leave it to the manager.", 409);
  }
  const open = await svc(`cockpit_sales_reference_asks?contact_id=eq.${enc(contactId)}&state=eq.asked&select=id`);
  if (open.length) throw new Refusal("A reference call is already asked for this lead.", 409);
  const note = cleanText(b.note, 1000) || null;
  const out = await svc("cockpit_sales_reference_asks", {
    method: "POST",
    body: { contact_id: contactId, reference_id: refId, note, asked_by: who.email },
    prefer: "return=representation",
  });
  await audit(who, "reference.ask", "cockpit_sales_reference_asks", String(out[0]?.id), null, out[0], { lead: lead.name ?? null });
  return { ask: out[0] };
}

async function referenceAnswer(who: Who, b: Row) {
  needManager(who);
  const id = cleanText(b.id, 40);
  const state = String(b.state ?? "");
  if (!(REFERENCE_ASK_STATES as readonly string[]).includes(state)) throw new Refusal("Arranged, done or declined?");
  const before = (await svc(`cockpit_sales_reference_asks?id=eq.${enc(id)}&select=*`))[0];
  if (!before) throw new Refusal("That ask is not here any more.", 404);
  const at = new Date().toISOString();
  const refId = cleanText(b.reference_id, 40) || (before.reference_id as string | null) || null;
  const out = await svc(`cockpit_sales_reference_asks?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: { state, answer: cleanText(b.answer, 1000) || null, reference_id: refId, decided_by: who.email, decided_at: at },
    prefer: "return=representation",
  });
  if (state === "done" && refId)
    await svc(`cockpit_sales_references?id=eq.${enc(refId)}`, {
      method: "PATCH",
      body: { last_used_at: at },
      prefer: "return=minimal",
    });
  await audit(who, "reference.answer", "cockpit_sales_reference_asks", id, before, out[0]);
  return { ask: out[0] };
}

/** A manager sets the WhatsApp ceilings. */
async function whatsappGuardSave(who: Who, b: Row) {
  needManager(who);
  const v = (b.value ?? {}) as Row;
  const perDay = Number(v.templates_per_day);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 5000)
    throw new Refusal("Templates a day is a whole number from 1 to 5,000.");
  const share = Number(v.pause_fail_share ?? 0.3);
  if (!Number.isFinite(share) || share <= 0 || share > 1) throw new Refusal("The pause share is between 0 and 1.");
  const before = await setting<Row>("whatsapp_guard");
  const value = { templates_per_day: perDay, pause_fail_share: share, pause_min_sends: Math.max(1, Math.round(Number(v.pause_min_sends ?? 5))) };
  await svc("cockpit_sales_settings?on_conflict=key", {
    method: "POST",
    body: { key: "whatsapp_guard", value, updated_by: who.email, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  await audit(who, "whatsapp.guard", "cockpit_sales_settings", "whatsapp_guard", before, value);
  return { setting: { key: "whatsapp_guard", value } };
}

/**
 * Take a lead the cockpit has just followed up out of the HighLevel
 * automations that kind of follow-up replaces, when a manager has switched
 * that on, so the lead never gets the old sequence and the new one. Each
 * workflow's answer is kept on the follow-up.
 */
async function takeOver(who: Who, f: Row): Promise<Record<string, string> | null> {
  const s = ((await setting<Row>("followups")) ?? {}) as Row;
  const seg = String(f.segment);
  if (((s.takeover ?? {}) as Row)[seg] !== true) return null;
  const flows = (((s.replaces ?? {}) as Row)[seg] ?? []) as string[];
  if (!flows.length) return null;
  const out: Record<string, string> = {};
  for (const w of flows) {
    try {
      await ghl("DELETE", `/contacts/${enc(String(f.contact_id))}/workflow/${enc(w)}`, undefined, "2021-07-28");
      out[w] = "taken out";
    } catch (e) {
      out[w] = redact(String((e as Error).message ?? e)).slice(0, 200);
    }
  }
  await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}`, {
    method: "PATCH",
    body: { took_over: out },
    prefer: "return=minimal",
  });
  await audit(who, "followup.takeover", "cockpit_sales_followups", String(f.id), null, out, { segment: seg });
  return out;
}

// ---------------------------------------------------------------------------
// End of day
// ---------------------------------------------------------------------------

/** #eods-salesreps, where the Typeform EODs were posted (Make scenarios 9327584/9327485). */
const EOD_CHANNEL = "C0AF5PJEAUX";
const HOUR = 3_600_000;

function eodRoleFor(who: Who, asked: unknown): EodRole {
  const role = String(who.role ?? "");
  if (role === "setter") return "setter";
  if (role === "closer") return "closer";
  return asked === "closer" ? "closer" : "setter";
}

function eodDayOk(day: unknown): string {
  const today = eodDay(Date.now());
  const d = String(day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return today;
  const back = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000;
  if (back < 0) throw new Refusal("An end of day cannot be filed ahead of the day.");
  if (back > 7) throw new Refusal("An end of day can be filed for the last seven days only.");
  return d;
}

interface EodCounted {
  values: Record<string, number | null>;
  /** Where each number came from and what it leaves out, shown beside it. */
  notes: Record<string, string>;
  /** Numbers that mean what the question means, so the form starts with them. */
  prefill: string[];
}

/**
 * What the cockpit already knows about this rep's day. Checked against the
 * Typeform EODs (Tahrir, 30 Aug and 5 Sept): Maqsam's outbound calls include
 * the intro calls and miss calls made outside Maqsam (17 against the 9 she
 * reported; 5 against 8), so a setter's call counts are shown as reference
 * beside the question, never typed in for her. A closer's calendar and
 * deals mean what the questions mean, so those start filled in.
 */
async function eodCount(who: Who, role: EodRole, day: string): Promise<EodCounted> {
  const notes: Record<string, string> = {};
  const prefill: string[] = [];
  const from = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * HOUR).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00Z`) + 21 * HOUR).toISOString();
  const between = (col: string) => `${col}=gte.${enc(from)}&${col}=lt.${enc(to)}`;
  const ghlUser = String(who.ghl_user_id ?? "");
  const out: Record<string, number | null> = {};
  const person = (await svc(`cockpit_sales_people?email=eq.${enc(String(who.email))}&select=b2b_rep_id,name`))[0];
  const rep = person?.b2b_rep_id
    ? (await svc(`cockpit_sales_reps?id=eq.${enc(String(person.b2b_rep_id))}&select=display_name,closer_aliases`))[0]
    : null;
  const names = [rep?.display_name, ...((rep?.closer_aliases as string[] | null) ?? [])]
    .map(x => String(x ?? "").trim().toLowerCase())
    .filter(Boolean);
  const deals = names.length
    ? (await svc(`cockpit_sales_deals?${between("submitted_at")}&select=closer,setter,cash_collected,contracted_revenue,voided`))
        .filter(d => !d.voided)
    : [];
  const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  // The show rule used everywhere: showed, or confirmed or invalid once past.
  const shown = (r: Row) =>
    r.status === "showed" || ((r.status === "confirmed" || r.status === "invalid") && Date.parse(String(r.start_at)) < Date.now());

  if (role === "setter") {
    const maqsam = String(who.maqsam_email ?? "").toLowerCase();
    if (maqsam) {
      const dials = await svc(
        `cockpit_sales_dials?agent_email=eq.${enc(maqsam)}&direction=eq.outbound&${between("occurred_at")}&select=state,duration_s&limit=2000`,
      );
      const done = dials.filter(d => d.state === "completed");
      out.dials = dials.length;
      out.contact_made = done.length;
      out.conversations = done.filter(d => Number(d.duration_s ?? 0) >= 60).length;
      out.quality_conversations = done.filter(d => Number(d.duration_s ?? 0) >= 180).length;
      const minutes = Math.round(sum(done, "duration_s") / 60);
      out.talk_time = minutes;
      notes.dials = "Outbound calls from your Maqsam line, intro calls included; calls made outside Maqsam are not counted.";
      notes.contact_made = "Of those, the ones someone answered.";
      notes.conversations = "Answered, and a minute or longer.";
      notes.quality_conversations = "Answered, and three minutes or longer.";
      notes.talk_time = done.length
        ? `${minutes} min in all over ${done.length} answered calls, about ${Math.round(minutes / done.length)} min each.`
        : "No answered calls from your Maqsam line.";
    } else {
      notes.dials = "Your seat has no Maqsam address, so the cockpit cannot count your calls.";
    }
    if (ghlUser) {
      const held = await svc(
        `cockpit_sales_calendar?call_type=eq.intro&assigned_user_id=eq.${enc(ghlUser)}&${between("start_at")}&select=status,start_at`,
      );
      out.intros_scheduled = held.length;
      out.intro_shows = held.filter(shown).length;
      out.intros_booked = (await svc(
        `cockpit_sales_calendar?call_type=eq.intro&assigned_user_id=eq.${enc(ghlUser)}&${between("booked_at")}&select=appointment_id`,
      )).length;
      // Demos booked today for leads whose intro was theirs in the last 60 days.
      const demos = await svc(`cockpit_sales_calendar?call_type=eq.demo&${between("booked_at")}&select=contact_id`);
      const ids = [...new Set(demos.map(d => String(d.contact_id ?? "")).filter(Boolean))];
      if (ids.length) {
        const since = new Date(Date.parse(from) - 60 * 24 * HOUR).toISOString();
        const mine = await svc(
          `cockpit_sales_calendar?call_type=eq.intro&assigned_user_id=eq.${enc(ghlUser)}&start_at=gte.${enc(since)}&contact_id=in.(${ids.map(i => `"${i}"`).join(",")})&select=contact_id`,
        );
        const theirs = new Set(mine.map(m => String(m.contact_id)));
        out.demos_booked = demos.filter(d => theirs.has(String(d.contact_id))).length;
      } else out.demos_booked = 0;
      notes.intros_scheduled = "Intro calls on your calendar that day.";
      notes.intros_booked = "Intro calls booked that day onto your calendar.";
      notes.intro_shows = "Intros that day marked showed (a confirmed call that has passed counts as shown).";
      notes.demos_booked = "Demos booked that day for leads whose intro was yours in the last 60 days.";
    }
    const sets = deals.filter(d => names.includes(String(d.setter ?? "").trim().toLowerCase()));
    out.deals_closed = sets.length;
    out.cash = sum(sets, "cash_collected");
    out.contracted = sum(sets, "contracted_revenue");
    for (const k of ["deals_closed", "cash", "contracted"])
      notes[k] = "New Client Forms that day naming you as the setter (the form asks since 24 September), voided ones out.";
    prefill.push("deals_closed", "cash", "contracted");
  } else {
    if (ghlUser) {
      const demos = await svc(
        `cockpit_sales_calendar?call_type=eq.demo&assigned_user_id=eq.${enc(ghlUser)}&${between("start_at")}&select=status,start_at`,
      );
      out.demos_scheduled = demos.length;
      out.demos_showed = demos.filter(shown).length;
      out.no_shows = demos.filter(d => d.status === "noshow").length;
      out.cancels = demos.filter(d => d.status === "cancelled").length;
      notes.demos_scheduled = "Demos on your calendar that day.";
      notes.demos_showed = "Of those, marked showed (a confirmed call that has passed counts as shown).";
      notes.no_shows = "Of those, marked no-show.";
      notes.cancels = "Of those, cancelled.";
      prefill.push("demos_scheduled", "demos_showed", "no_shows", "cancels");
    }
    const closed = deals.filter(d => names.includes(String(d.closer ?? "").trim().toLowerCase()));
    out.closed = closed.length;
    out.cash = sum(closed, "cash_collected");
    out.contracted = sum(closed, "contracted_revenue");
    for (const k of ["closed", "cash", "contracted"]) notes[k] = "New Client Forms that day naming you as the closer, voided ones out.";
    prefill.push("closed", "cash", "contracted");
  }
  return { values: out, notes, prefill };
}

async function eodPrefill(who: Who, b: Row) {
  const role = eodRoleFor(who, b.role);
  const day = eodDayOk(b.day);
  const [counted, saved, person] = await Promise.all([
    eodCount(who, role, day),
    svc(`cockpit_sales_eods?email=eq.${enc(String(who.email))}&day=eq.${day}&role=eq.${role}&select=*`),
    svc(`cockpit_sales_people?email=eq.${enc(String(who.email))}&select=name,slack_user_id`),
  ]);
  const eod = saved[0] ?? null;
  const outbox = eod?.outbox_id
    ? (await svc(`eod_outbox?id=eq.${eod.outbox_id}&select=status,slack_ts,sent_at,sheet_at,error,sheet_error,attempts`))[0] ?? null
    : null;
  const role_choice = ["setter", "closer"].includes(String(who.role)) ? [String(who.role)] : ["setter", "closer"];
  return {
    day,
    today: eodDay(Date.now()),
    role,
    roles: role_choice,
    name: person[0]?.name ?? who.name ?? String(who.email).split("@")[0],
    has_slack_id: Boolean(person[0]?.slack_user_id),
    has_maqsam: Boolean(who.maqsam_email),
    has_ghl: Boolean(who.ghl_user_id),
    fields: EOD_FIELDS[role],
    computed: counted.values,
    notes: counted.notes,
    prefill: counted.prefill,
    eod,
    outbox,
  };
}

async function eodSubmit(who: Who, b: Row) {
  const role = eodRoleFor(who, b.role);
  const day = eodDayOk(b.day);
  const raw = (b.answers ?? {}) as Row;
  const answers: Record<string, number | string | null> = {};
  const missing: string[] = [];
  for (const f of EOD_FIELDS[role]) {
    const v = eodValue(f.kind, raw[f.key]);
    if (!v.ok) throw new Refusal(`"${f.label}" has to be ${f.kind === "count" ? "a whole number" : "a number"} of 0 or more.`);
    answers[f.key] = v.value;
    if (f.required && (v.value === null || v.value === "")) missing.push(f.label);
  }
  if (missing.length) throw new Refusal(`Fill in ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " and the rest" : ""} first.`);

  const email = String(who.email);
  const existing = (await svc(`cockpit_sales_eods?email=eq.${enc(email)}&day=eq.${day}&role=eq.${role}&select=*`))[0];
  if (existing?.submitted_at)
    throw new Refusal("This day's end of day is already in. If a number was wrong, tell your manager.", 409);
  const person = (await svc(`cockpit_sales_people?email=eq.${enc(email)}&select=name,slack_user_id`))[0];
  const name = String(person?.name ?? who.name ?? email.split("@")[0]);
  const slackId = person?.slack_user_id ? String(person.slack_user_id) : null;
  const computed = (await eodCount(who, role, day)).values;
  const now = Date.now();
  const responseId = `cockpit-${crypto.randomUUID().slice(0, 8)}`;

  let outbox: Row;
  try {
    outbox = (await svc("eod_outbox", {
      method: "POST",
      body: {
        role: `sales_${role}`,
        day,
        person: name,
        slack_id: slackId,
        channel: EOD_CHANNEL,
        tab: EOD_TAB[role],
        body: eodMessage(role, name, slackId, day, answers),
        row_values: eodColumns(role, name, day, now, responseId, answers),
      },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    if (/23505|duplicate/.test(String((e as Error).message ?? e)))
      throw new Refusal("An end of day for this day and name is already on its way out.", 409);
    throw e;
  }
  const saved = (await svc("cockpit_sales_eods?on_conflict=email,day,role", {
    method: "POST",
    body: {
      email,
      name,
      role,
      day,
      answers,
      computed,
      submitted_at: new Date(now).toISOString(),
      outbox_id: outbox.id,
      updated_at: new Date(now).toISOString(),
    },
    prefer: "resolution=merge-duplicates,return=representation",
  }))[0];
  await audit(who, "eod.submit", "cockpit_sales_eods", String(saved.id), existing ?? null, { role, day, outbox_id: outbox.id });
  return { eod: saved, outbox: { status: outbox.status } };
}

/** Put a stalled EOD back in the queue (the bot was invited after it gave up, say). */
async function eodRetry(who: Who, b: Row) {
  const id = cleanText(b.id, 40);
  const eod = (await svc(`cockpit_sales_eods?id=eq.${enc(id)}&select=*`))[0];
  if (!eod) throw new Refusal("That end of day is not here.", 404);
  if (!who.manager && eod.email !== who.email) throw new Refusal("That is someone else's end of day.", 403);
  if (!eod.outbox_id) throw new Refusal("That end of day was never sent.", 409);
  const out = (await svc(`eod_outbox?id=eq.${eod.outbox_id}&select=status`))[0];
  if (out?.status === "sent") return { status: "sent" };
  await svc(`eod_outbox?id=eq.${eod.outbox_id}`, {
    method: "PATCH",
    body: { status: "queued", attempts: 0, error: null },
    prefer: "return=minimal",
  });
  await audit(who, "eod.retry", "eod_outbox", String(eod.outbox_id), out ?? null, { status: "queued" });
  return { status: "queued" };
}

// ---------------------------------------------------------------------------
// The agents: research briefs and follow-up drafts
// ---------------------------------------------------------------------------

/** Ask the desk to research a lead: once at a time, and not again within six hours unless a manager asks. */
async function researchRequest(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=contact_id,name`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const open = await svc(`cockpit_sales_research?contact_id=eq.${enc(contact)}&status=in.(queued,running)&select=id`);
  if (open.length) throw new Refusal("This lead is already being researched. It takes a minute or two.", 409);
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const fresh = await svc(
    `cockpit_sales_research?contact_id=eq.${enc(contact)}&status=eq.ready&requested_at=gte.${enc(since)}&select=id`,
  );
  if (fresh.length && !who.manager)
    throw new Refusal("This lead was researched in the last six hours; the brief is below.", 409);
  const req = (await svc("cockpit_sales_requests", {
    method: "POST",
    body: { kind: "research", contact_id: contact, params: { contact_id: contact }, requested_by: who.email },
    prefer: "return=representation",
  }))[0];
  const row = (await svc("cockpit_sales_research", {
    method: "POST",
    body: { request_id: req.id, contact_id: contact, status: "queued", requested_by: who.email },
    prefer: "return=representation",
  }))[0];
  await audit(who, "research.request", "cockpit_sales_research", String(row.id), null, { contact_id: contact });
  return { research: row };
}

async function followupRow(id: string): Promise<Row> {
  const f = (await svc(`cockpit_sales_followups?id=eq.${enc(id)}&select=*`))[0];
  if (!f) throw new Refusal("That draft is not here any more.", 404);
  return f;
}

/**
 * Send a follow-up draft, as written or as the rep edited it. The draft is
 * claimed first (draft -> sending), so two taps or two reps cannot both
 * send it, and its own id is the send's request id, so a retry returns the
 * first send. The words go out through convo.send's checks: do-not-disturb,
 * the WhatsApp window, the read-back.
 */
async function sendFollowup(who: Who, f: Row, b: Row, auto: boolean) {
  if (f.status !== "draft") throw new Refusal(`This draft was already ${f.status}.`, 409);
  if (f.expires_at && Date.parse(String(f.expires_at)) < Date.now()) {
    await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}&status=eq.draft`, {
      method: "PATCH",
      body: { status: "expired", decided_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    throw new Refusal(
      f.channel === "whatsapp"
        ? "This draft went stale: the lead's WhatsApp window has closed. The agent writes a new one if it is still due."
        : "This draft went stale. The agent writes a new one if it is still due.",
      409,
    );
  }
  // The conversation may have moved on since the draft was made: a rep wrote
  // in HighLevel or from the cockpit, or the lead wrote again. Either way the
  // draft answers an older conversation; the agent writes a fresh one.
  const madeAt = String(f.created_at);
  const [inbox, ours] = await Promise.all([
    svc(`cockpit_sales_inbox?contact_id=eq.${enc(String(f.contact_id))}&last_message_at=gt.${enc(madeAt)}&select=last_message_at&limit=1`),
    svc(`cockpit_sales_messages?contact_id=eq.${enc(String(f.contact_id))}&created_at=gt.${enc(madeAt)}&state=neq.failed&select=created_at&limit=1`),
  ]);
  const since = inbox[0]?.last_message_at ?? ours[0]?.created_at;
  if (since) {
    await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}&status=eq.draft`, {
      method: "PATCH",
      body: { status: "expired", decided_at: new Date().toISOString(), error: `The conversation moved on at ${String(since)}, after this draft was made.` },
      prefer: "return=minimal",
    });
    throw new Refusal("The conversation has moved on since this draft was made, so it was not sent. Read it first; the agent writes a fresh draft if one is still due.", 409);
  }
  const template = f.channel === "whatsapp_template";
  const body = template ? templateLine(b.body ?? f.body) : String(b.body ?? f.body).replace(/\r\n/g, "\n").trim();
  if (!body) throw new Refusal("Write the message first.");
  const subject = f.channel === "email" ? cleanText(b.subject ?? f.subject, 300) : null;
  const claimed = await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}&status=eq.draft`, {
    method: "PATCH",
    body: { status: "sending", decided_by: who.email, decided_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  if (!claimed.length) throw new Refusal("Someone else has just dealt with this draft.", 409);
  const edited = body !== String(f.body).trim() || (f.channel === "email" && subject !== (f.subject ?? null));
  try {
    const out = template
      ? await sendTemplate(who, {
          contactId: String(f.contact_id),
          key: String(f.template_key ?? ""),
          line: body,
          requestId: String(f.id),
          followupId: String(f.id),
        })
      : await convoSend(who, {
          contact_id: f.contact_id,
          channel: f.channel,
          body,
          subject,
          request_id: f.id,
          followup_id: f.id,
        });
    const m = out.message as Row;
    const saved = (await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}`, {
      method: "PATCH",
      body: {
        status: m.state === "failed" ? "failed" : "sent",
        final_body: body,
        final_subject: subject,
        edited,
        message_id: m.id ?? null,
        error: m.state === "failed" ? (m.error ?? "HighLevel marked it failed") : null,
        auto,
      },
      prefer: "return=representation",
    }))[0];
    await audit(who, auto ? "followup.autosend" : "followup.approve", "cockpit_sales_followups", String(f.id), f,
      { status: saved.status, edited, segment: f.segment, channel: f.channel });
    if (saved.status === "sent") {
      // A confirmation message counts as a try: the dialer's confirmation
      // call waits for the lead to answer it first.
      if (f.segment === "confirm" && f.appointment_id) await confirmationSent(who, f);
      saved.took_over = await takeOver(who, f).catch(e => ({ error: redact(String((e as Error).message ?? e)) }));
    }
    return { followup: saved, message: m };
  } catch (e) {
    const err = e instanceof Refusal ? e.message : redact(String((e as Error).message ?? e));
    await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}`, {
      method: "PATCH",
      body: { status: "failed", error: err, final_body: body, final_subject: subject, edited },
      prefer: "return=minimal",
    });
    await audit(who, auto ? "followup.autosend" : "followup.approve", "cockpit_sales_followups", String(f.id), f,
      { status: "failed", error: err });
    throw e;
  }
}

/** A confirmation message went out for this call: recorded the way the dialer records a try. */
async function confirmationSent(who: Who, f: Row) {
  try {
    const a = (await svc(`cockpit_sales_appointments?appointment_id=eq.${enc(String(f.appointment_id))}&select=call_type,start_at`))[0];
    await svc("cockpit_sales_confirmations", {
      method: "POST",
      body: {
        appointment_id: f.appointment_id,
        contact_id: f.contact_id,
        call_type: a?.call_type === "intro" || a?.call_type === "demo" ? a.call_type : null,
        start_at: a?.start_at ?? null,
        result: "message_sent",
        via: f.channel === "email" ? "email" : "whatsapp",
        note: "Follow-up message",
        by_email: who.email ?? "sales-desk",
      },
      prefer: "return=minimal",
    });
  } catch (e) {
    console.error("confirmation row", redact(String(e)));
  }
}

async function followupApprove(who: Who, b: Row) {
  const f = await followupRow(cleanText(b.id, 40));
  if (!who.manager && f.owner_email && f.owner_email !== who.email) throw new Refusal("That is another rep's lead.", 403);
  return await sendFollowup(who, f, b, false);
}

/** The desk sends a draft by itself, only for a kind of message a manager trusts. */
async function followupAutosend(who: Who, b: Row) {
  const f = await followupRow(cleanText(b.id, 40));
  const settings = (await setting<Row>("followups")) ?? {};
  const auto = ((settings.autosend ?? {}) as Row)[String(f.segment)] === true;
  if (!auto) throw new Refusal(`${String(f.segment)} drafts wait for a person; a manager has not switched them to send by themselves.`, 403);
  if (f.channel !== "email") {
    const health = await whatsappHealth();
    if (health.paused) throw new Refusal(health.why, 409);
  }
  return await sendFollowup(who, f, {}, true);
}

async function followupSkip(who: Who, b: Row) {
  const f = await followupRow(cleanText(b.id, 40));
  if (!who.manager && f.owner_email && f.owner_email !== who.email) throw new Refusal("That is another rep's lead.", 403);
  if (f.status !== "draft") throw new Refusal(`This draft was already ${f.status}.`, 409);
  const reason = cleanText(b.reason, 200) || null;
  const saved = (await svc(`cockpit_sales_followups?id=eq.${enc(String(f.id))}&status=eq.draft`, {
    method: "PATCH",
    body: { status: "skipped", skip_reason: reason, decided_by: who.email, decided_at: new Date().toISOString() },
    prefer: "return=representation",
  }))[0];
  if (!saved) throw new Refusal("Someone else has just dealt with this draft.", 409);
  await audit(who, "followup.skip", "cockpit_sales_followups", String(f.id), f, { reason, segment: f.segment });
  return { followup: saved };
}

async function followupSettings(who: Who, b: Row) {
  needManager(who);
  const v = (b.value ?? {}) as Row;
  const auto = (v.autosend ?? {}) as Row;
  const int = (x: unknown, lo: number, hi: number, name: string) => {
    const n = Number(x);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Refusal(`${name} has to be a whole number from ${lo} to ${hi}.`);
    return n;
  };
  const quietFrom = int((v.quiet as Row | undefined)?.from ?? 21, 0, 23, "The quiet hours' start");
  const quietTo = int((v.quiet as Row | undefined)?.to ?? 9, 0, 23, "The quiet hours' end");
  const before = await setting<Row>("followups");
  const takeover = (v.takeover ?? {}) as Row;
  const fallback = (v.email_fallback ?? {}) as Row;
  const replaces = ((before?.replaces ?? {}) as Row);
  const value = {
    enabled: v.enabled !== false,
    autosend: Object.fromEntries(FOLLOWUP_SEGMENTS.map(s => [s, auto[s] === true])),
    // Only kinds that replace a HighLevel automation can take a lead out of it.
    takeover: Object.fromEntries(Object.keys(replaces).map(s => [s, takeover[s] === true])),
    replaces,
    email_fallback: Object.fromEntries(FOLLOWUP_SEGMENTS.map(s => [s, fallback[s] !== false])),
    cadence: before?.cadence ?? {},
    automation_gap_hours: int(v.automation_gap_hours ?? 20, 0, 72, "Hours to wait after an automation's message"),
    per_run: int(v.per_run ?? 12, 1, 50, "Drafts per run"),
    per_day: int(v.per_day ?? 60, 1, 400, "Drafts per day"),
    quiet: { from: quietFrom, to: quietTo },
    nurture_every_days: int(v.nurture_every_days ?? 7, 2, 60, "Days between nurture messages"),
    nurture_per_day: int(v.nurture_per_day ?? 20, 0, 200, "Long-term messages a day"),
  };
  await svc("cockpit_sales_settings?on_conflict=key", {
    method: "POST",
    body: { key: "followups", value, updated_by: who.email, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  await audit(who, "followup.settings", "cockpit_sales_settings", "followups", before, value);
  return { setting: { key: "followups", value } };
}

// ---------------------------------------------------------------------------
// Goals by the month
// ---------------------------------------------------------------------------

const GOAL_METRICS = ["booked", "shown", "closes", "cash", "dials"] as const;

/**
 * One month's goal or forecast for one measure, for one B2B rep (the same
 * person_key the scorecards use, so goals can be set before a rep has a
 * seat). A manager sets goals; the rep themself, or a manager, puts the
 * forecast beside it. A blank value clears it, and a row left with neither
 * is removed.
 */
async function goalSet(who: Who, b: Row) {
  const rep = cleanText(b.rep, 60);
  const month = String(b.month ?? "");
  const metric = String(b.metric ?? "");
  const field = String(b.field ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Refusal("Which month? Give it as 2026-09.");
  if (!(GOAL_METRICS as readonly string[]).includes(metric)) throw new Refusal("That measure has no goal.");
  if (field !== "goal" && field !== "forecast") throw new Refusal("Set a goal or a forecast.");
  if (field === "goal") needManager(who);
  else if (!who.manager && rep !== String(who.b2b_rep_id ?? ""))
    throw new Refusal("You can put a forecast for yourself only.", 403);
  const first = `${month}-01`;
  const t = Date.parse(`${first}T00:00:00Z`);
  const now = Date.now();
  if (t < now - 740 * 86_400_000 || t > now + 100 * 86_400_000)
    throw new Refusal("Goals go from two years back to three months ahead.");
  if (!/^[0-9a-f-]{36}$/.test(rep)) throw new Refusal("Whose goal?");
  const known = (await svc(`cockpit_sales_reps?id=eq.${enc(rep)}&select=id,display_name`))[0];
  if (!known) throw new Refusal("That rep is not in B2B's rep list.", 404);

  let value: number | null = null;
  const raw = b.value;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    value = Number(String(raw).replace(/,/g, "").trim());
    if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new Refusal("Type a number of 0 or more.");
    if (metric !== "cash" && !Number.isInteger(value)) throw new Refusal("Counts are whole numbers.");
  }

  const key = `person_key=eq.${enc(rep)}&month=eq.${first}&metric=eq.${metric}`;
  const before = (await svc(`cockpit_sales_goals?${key}&select=*`))[0] ?? null;
  const at = new Date().toISOString();
  const patch =
    field === "goal"
      ? { goal: value, goal_by: who.email, goal_at: at }
      : { forecast: value, forecast_by: who.email, forecast_at: at };
  // PostgREST updates only the columns sent, so the other field is kept.
  let row: Row | null = (await svc("cockpit_sales_goals?on_conflict=person_key,month,metric", {
    method: "POST",
    body: { person_key: rep, month: first, metric, ...patch },
    prefer: "resolution=merge-duplicates,return=representation",
  }))[0] ?? null;
  if (row && row.goal === null && row.forecast === null) {
    await svc(`cockpit_sales_goals?${key}`, { method: "DELETE", prefer: "return=minimal" });
    row = null;
  }
  await audit(who, "goal.set", "cockpit_sales_goals", `${rep}|${month}|${metric}`, before, row, {
    field,
    rep_name: known.display_name ?? null,
  });
  return { goal: row };
}

// ---------------------------------------------------------------------------
// Live reads from HighLevel
// ---------------------------------------------------------------------------

async function leadLive(_who: Who, b: Row) {
  const id = cleanText(b.contact_id, 80);
  if (!id) throw new Refusal("Which lead?");
  const [contact, convs] = await Promise.all([
    ghl("GET", `/contacts/${enc(id)}`, undefined, "2021-07-28").catch(e => ({ error: String(e.message) })),
    ghl("GET", `/conversations/search?locationId=${LOCATION}&contactId=${enc(id)}&limit=5`).catch(
      e => ({ error: String(e.message) }),
    ),
  ]);
  const c = ((contact as Row).contact ?? {}) as Row;
  const conversations = (((convs as Row).conversations ?? []) as Row[]).map(x => ({
    id: x.id,
    type: x.type ?? null,
    last_message_type: x.lastMessageType ?? null,
    last_message_at: x.lastMessageDate ?? null,
    unread: x.unreadCount ?? 0,
    inbound_whatsapp_at: x.lastInboundWhatsappMessageDate ?? null,
  }));
  let messages: Row[] = [];
  let messagesError: string | null = null;
  if (conversations[0]?.id) {
    try {
      const m = await ghl("GET", `/conversations/${enc(String(conversations[0].id))}/messages?limit=40`);
      messages = trimMessages(((m.messages ?? {}) as Row).messages ?? m.messages);
    } catch (e) {
      messagesError = redact(String((e as Error).message ?? e));
    }
  }
  return {
    live: {
      contact: {
        tags: c.tags ?? [],
        dnd: c.dnd ?? null,
        dnd_settings: c.dndSettings ?? null,
        assigned_to: c.assignedTo ?? null,
        source: c.source ?? null,
        date_added: c.dateAdded ?? null,
        date_updated: c.dateUpdated ?? null,
      },
      contact_error: (contact as Row).error ?? null,
      conversations,
      conversations_error: (convs as Row).error ?? null,
      messages,
      messages_error: messagesError,
      read_at: new Date().toISOString(),
    },
  };
}

async function ghlUsers(who: Who) {
  needManager(who);
  const out = await ghl("GET", `/users/?locationId=${LOCATION}`);
  const users = ((out.users ?? []) as Row[]).map(u => ({
    id: u.id,
    name: u.name ?? [u.firstName, u.lastName].filter(Boolean).join(" "),
    email: u.email ?? null,
  }));
  return { users };
}

// ---------------------------------------------------------------------------
// The power dialer
// ---------------------------------------------------------------------------

const MAQSAM = "https://api.mq.maqsam.com";

async function maqsam(path: string, method = "GET", values: Record<string, string> = {}): Promise<Row> {
  const key = env("SALES_MAQSAM_ACCESS_KEY");
  const secret = env("SALES_MAQSAM_SECRET");
  if (!key || !secret) throw new Refusal("Maqsam is not connected to the cockpit yet.", 503);
  const qs = method === "GET" && Object.keys(values).length ? `?${new URLSearchParams(values)}` : "";
  const res = await fetch(`${MAQSAM}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : new URLSearchParams(values),
  });
  const text = await res.text();
  if (res.status === 429) throw new Refusal("Maqsam asked us to slow down. Wait a minute, then call again.", 429);
  let d: Row = {};
  try {
    d = JSON.parse(text) as Row;
  } catch {
    // not JSON
  }
  if (!res.ok) throw new Error(`Maqsam said ${res.status}: ${redact(String(d.message ?? text))}`);
  return d;
}

/** The Maqsam agent with this address, or null when Maqsam has none. */
async function findAgent(email: string): Promise<Row | null> {
  for (let page = 1; page <= 5; page++) {
    const d = await maqsam(`/v1/agents/page/${page}`);
    const list = (Array.isArray(d.message) ? d.message : []) as Row[];
    const a = list.find(x => String(x.email ?? "").toLowerCase() === email.toLowerCase());
    if (a) return a;
    if (!list.length) break;
  }
  return null;
}

/** The rep's Maqsam seat, which must be free to take an outgoing call. */
async function maqsamReady(email: string): Promise<void> {
  const a = await findAgent(email);
  if (!a)
    throw new Refusal(`No Maqsam seat has the address ${email}. Ask Aziz to add it on the Team page or in Maqsam.`, 409);
  if (!a.active || !a.outgoingEnabled)
    throw new Refusal("Your Maqsam seat is switched off or cannot call out. Ask Aziz to turn it on.", 409);
  if (a.state !== "available")
    throw new Refusal("Open the Maqsam softphone and set yourself Available, then call again.", 409);
}

/**
 * The caller's Maqsam seat as the dialer shows it before anyone presses
 * Call. Read-only; a state that stops calls is an answer, not an error.
 */
async function dialAgent(who: Who) {
  const email = String(who.maqsam_email ?? "").trim();
  if (!email) return { email: null, from: null, ready: false, state: "no_address" };
  const a = await findAgent(email);
  const from = who.maqsam_from ?? null;
  if (!a) return { email, from, ready: false, state: "not_found" };
  const state = !a.active ? "switched_off" : !a.outgoingEnabled ? "no_outgoing" : String(a.state ?? "unknown");
  return { email, from, ready: state === "available", state };
}

const ms = (v: unknown) => {
  const t = v ? Date.parse(String(v)) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * The slow, slowly changing half of the queue (the leads of the last 30
 * days, the calendar, Maqsam's calls and the deals: most of the queue's
 * reading time), kept for 20 seconds in this function instance. The dialer's
 * own state, the open calls and the replies are read fresh on every request,
 * so an outcome someone saves moves the lead at once.
 */
let heavy: { at: number; leads: Row[]; appts: Row[]; dials: Row[]; deals: Row[] } | null = null;
const HEAVY_FOR = 20_000;
const LEAD_COLS =
  "contact_id,name,phone,phone8,lead_created_at,stage_id,stage_name,pipeline_id,lead_class,dnd,contact_type,revenue,readiness";

async function heavyReads(now: number) {
  if (heavy && now - heavy.at < HEAVY_FOR) return heavy;
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since60 = new Date(now - 60 * 86_400_000).toISOString();
  const [leads, appts, dials, deals] = await Promise.all([
    svcAll(`cockpit_sales_leads?select=${LEAD_COLS}&lead_created_at=gte.${enc(since30)}&order=contact_id`),
    svcAll(
      `cockpit_sales_calendar?select=appointment_id,contact_id,call_type,start_at,booked_at,status,assigned_user_id&start_at=gte.${enc(since60)}&order=appointment_id`,
    ),
    svcAll(`cockpit_sales_dials?select=lead_phone8,occurred_at,state,direction&direction=eq.outbound&occurred_at=gte.${enc(since60)}&order=call_id`),
    svcAll("cockpit_sales_deals?select=contact_id&voided=eq.false&order=response_id"),
  ]);
  heavy = { at: now, leads, appts, dials, deals };
  return heavy;
}

/** Stage id → what it means to the dialer: the settings' word first, else the stage's name. */
async function stageRoles(): Promise<Record<string, StageRole>> {
  const v = await setting<{ roles?: Record<string, StageRole> }>("pipeline");
  return v?.roles ?? {};
}

type QueueCandidate = Candidate &
  CloserFacts & { demo_rep: string | null; phone8: string | null; step: number; last_outcome: string | null };

/** Everything the queue needs, read in a handful of queries, no huge id lists. */
async function candidates(now: number): Promise<{ list: QueueCandidate[] }> {
  const soon = enc(new Date(now - 3_600_000).toISOString());
  const [states, inbox, attempts, h, confirmations, hotRows, roles] = await Promise.all([
    svcAll("cockpit_sales_queue_state?select=*&order=contact_id"),
    svc(`cockpit_sales_inbox?select=contact_id,last_message_at,last_direction&last_direction=eq.inbound&last_message_at=gte.${enc(new Date(now - 86_400_000).toISOString())}`),
    svc("cockpit_sales_attempts?select=contact_id,rep_email&state=in.(dialing,placed)"),
    heavyReads(now),
    svc(`cockpit_sales_confirmations?select=appointment_id,result,at&start_at=gte.${soon}&order=at.desc&limit=2000`),
    svc("cockpit_sales_hot?select=contact_id,owner_email,next_at&removed_at=is.null&limit=2000"),
    stageRoles(),
  ]);
  const leads = [...h.leads];
  const extra = new Set<string>([
    ...states.filter(s => !s.closed || s.callback_at).map(s => String(s.contact_id)),
    ...inbox.map(i => String(i.contact_id ?? "")).filter(Boolean),
  ]);
  const have = new Set(leads.map(l => String(l.contact_id)));
  const missing = [...extra].filter(id => !have.has(id)).slice(0, 150);
  if (missing.length)
    leads.push(...(await svc(`cockpit_sales_leads?select=${LEAD_COLS}&contact_id=in.(${missing.map(enc).join(",")})`)));
  const stateBy = new Map(states.map(s => [String(s.contact_id), s]));
  const inboxBy = new Map<string, number>();
  for (const i of inbox) {
    const t = ms(i.last_message_at);
    const k = String(i.contact_id ?? "");
    if (k && t && (!inboxBy.has(k) || (inboxBy.get(k) ?? 0) < t)) inboxBy.set(k, t);
  }
  const claimBy = new Map(attempts.map(a => [String(a.contact_id), String(a.rep_email)]));
  const signed = new Set(h.deals.map(d => String(d.contact_id ?? "")).filter(Boolean));
  const apptBy = new Map<string, Row[]>();
  for (const a of h.appts) {
    const k = String(a.contact_id ?? "");
    if (!k) continue;
    apptBy.set(k, [...(apptBy.get(k) ?? []), a]);
  }
  const dialBy = new Map<string, { last: number; reached: boolean; tries: number[] }>();
  for (const d of h.dials) {
    const k = String(d.lead_phone8 ?? "");
    const t = ms(d.occurred_at);
    if (!k || !t) continue;
    const cur = dialBy.get(k) ?? { last: 0, reached: false, tries: [] };
    const answered = d.state === "completed";
    dialBy.set(k, {
      last: Math.max(cur.last, t),
      reached: cur.reached || answered,
      tries: answered ? cur.tries : [...cur.tries, t],
    });
  }
  // A lead's own confirmation, and the last try that reached no one, per appointment.
  const confirmedAppt = new Set<string>();
  const lastTry = new Map<string, number>();
  for (const c of confirmations) {
    const id = String(c.appointment_id);
    if (c.result === "confirmed" || c.result === "reschedule") confirmedAppt.add(id);
    const t = ms(c.at);
    if ((c.result === "no_answer" || c.result === "message_sent") && t && (lastTry.get(id) ?? 0) < t) lastTry.set(id, t);
  }
  const hotBy = new Map(hotRows.map(r => [String(r.contact_id), r]));
  const list = leads.map(l => {
    const id = String(l.contact_id);
    const st = stateBy.get(id) ?? {};
    const mine = apptBy.get(id) ?? [];
    const future = mine
      .filter(a => (ms(a.start_at) ?? 0) > now && a.status !== "cancelled" && (a.call_type === "intro" || a.call_type === "demo"))
      .sort((a, b) => (ms(a.start_at) ?? 0) - (ms(b.start_at) ?? 0))[0];
    const past = mine
      .filter(a => (ms(a.start_at) ?? 0) <= now && (a.call_type === "intro" || a.call_type === "demo"))
      .sort((a, b) => (ms(b.start_at) ?? 0) - (ms(a.start_at) ?? 0))[0];
    const demo = mine
      .filter(a => a.call_type === "demo")
      .sort((a, b) => (ms(b.start_at) ?? 0) - (ms(a.start_at) ?? 0))[0];
    // The appointment the dialer works: the next intro or demo, from twenty
    // minutes ago on (an intro that just started is still the setter's call).
    const current = mine
      .filter(
        a =>
          (a.call_type === "intro" || a.call_type === "demo") &&
          (ms(a.start_at) ?? 0) >= now - 20 * 60_000 &&
          !["cancelled", "noshow", "invalid", "showed"].includes(String(a.status ?? "")),
      )
      .sort((a, b) => (ms(a.start_at) ?? 0) - (ms(b.start_at) ?? 0))[0];
    const dial = dialBy.get(String(l.phone8 ?? "")) ?? null;
    const created = ms(l.lead_created_at);
    const misses = dial ? dial.tries.filter(t => created === null || t >= created).length : 0;
    const hot = hotBy.get(id);
    const role = (roles[String(l.stage_id ?? "")] as StageRole | undefined) ?? stageRole(l.stage_name as string | null);
    const client = l.contact_type === "customer" || signed.has(id);
    const inboundAt = inboxBy.get(id) ?? null;
    const closedAt = ms(st.closed_at);
    // A reply after the lead was closed opens them up again.
    const closed = st.closed && !(inboundAt && closedAt && inboundAt > closedAt) ? String(st.closed) : null;
    // The dialer's own outcomes count as calls before Maqsam's copy arrives.
    const lastOutcomeAt = ms(st.last_outcome_at);
    const lastDial = Math.max(dial?.last ?? 0, lastOutcomeAt ?? 0) || null;
    return {
      contact_id: id,
      name: (l.name as string) ?? null,
      phone: (l.phone as string) ?? null,
      phone8: (l.phone8 as string) ?? null,
      created_at: ms(l.lead_created_at),
      stage: (l.stage_name as string) ?? null,
      lead_class: (l.lead_class as string) ?? null,
      dnd: Boolean(l.dnd),
      last_dial_at: lastDial,
      reached: Boolean(dial?.reached),
      inbound_at: inboundAt,
      booked_at: future ? ms(future.start_at) : null,
      last_call_status: past ? String(past.status ?? "") : null,
      last_call_type: past ? String(past.call_type ?? "") : null,
      last_call_at: past ? ms(past.start_at) : null,
      due_at: ms(st.due_at),
      callback_at: ms(st.callback_at),
      closed,
      claimed_by: claimBy.get(id) ?? null,
      demo_at: demo ? ms(demo.start_at) : null,
      demo_status: demo ? String(demo.status ?? "") : null,
      demo_rep: demo ? String(demo.assigned_user_id ?? "") : null,
      signed: signed.has(id),
      step: Number(st.step ?? 0),
      last_outcome: (st.last_outcome as string) ?? null,
      sales_lead: !client && (Boolean(l.pipeline_id) || Boolean(l.lead_class)),
      stage_role: role,
      revenue: (l.revenue as string) ?? null,
      readiness: (l.readiness as string) ?? null,
      misses,
      hot: Boolean(hot),
      hot_owner: hot ? String(hot.owner_email ?? "") || null : null,
      hot_next_at: hot ? ms(hot.next_at) : null,
      appt: current
        ? {
            id: String(current.appointment_id),
            type: (current.call_type === "demo" ? "demo" : "intro") as Appt["type"],
            start: ms(current.start_at) ?? 0,
            booked: ms(current.booked_at),
            status: (current.status as string) ?? null,
            assigned: (current.assigned_user_id as string) ?? null,
            confirmed: confirmedAppt.has(String(current.appointment_id)),
            last_try: lastTry.get(String(current.appointment_id)) ?? null,
          }
        : null,
    };
  });
  return { list };
}

/**
 * The rep's day: the dialer's own attempts (saved outcomes, calls, what
 * Maqsam's record says of each) and, beside them, every outbound call on
 * their Maqsam line, softphone included, as B2B copies it.
 */
async function today(who: Who, now: number) {
  const dayStart = kuwaitAt(now, 0);
  const iso = new Date(dayStart).toISOString();
  const since = enc(iso);
  const me = enc(String(who.email));
  const maqsamEmail = String(who.maqsam_email ?? "").toLowerCase();
  const [attempts, line] = await Promise.all([
    svc(
      `cockpit_sales_attempts?rep_email=eq.${me}&or=${enc(`(started_at.gte."${iso}",saved_at.gte."${iso}")`)}&select=state,manual,started_at,saved_at,outcome,auto_saved,call_state,call_duration_s,maqsam_call_id&limit=2000`,
    ),
    maqsamEmail
      ? svc(
          `cockpit_sales_dials?agent_email=eq.${enc(maqsamEmail)}&direction=eq.outbound&occurred_at=gte.${since}&select=state,duration_s,occurred_at&limit=2000`,
        )
      : Promise.resolve(null),
  ]);
  const answered = line?.filter(d => d.state === "completed" && Number(d.duration_s ?? 0) > 0) ?? [];
  return {
    ...dayStats(attempts, dayStart),
    line: line
      ? {
          calls: line.length,
          answered: answered.length,
          talk_s: answered.reduce((s, d) => s + Number(d.duration_s ?? 0), 0),
          last_at: line.reduce<string | null>((m, d) => (!m || String(d.occurred_at) > m ? String(d.occurred_at) : m), null),
        }
      : null,
  };
}

async function dialQueue(who: Who, b: Row) {
  const now = Date.now();
  const as = String(b.as ?? (who.role === "closer" ? "closer" : "setter"));
  const me = String(who.email);
  const [{ list }, day, open] = await Promise.all([
    candidates(now),
    today(who, now),
    svc(`cockpit_sales_attempts?select=*&rep_email=eq.${enc(me)}&state=in.(dialing,placed)&order=started_at.desc&limit=1`),
  ]);
  const meGhl = (who.ghl_user_id as string) || null;
  const ranked =
    as === "closer"
      ? rankForCloser(
          list.filter(
            c =>
              (who.manager && !who.ghl_user_id) ||
              c.demo_rep === who.ghl_user_id ||
              c.appt?.assigned === who.ghl_user_id ||
              c.hot_owner === me,
          ),
          me,
          now,
          meGhl,
          Boolean(who.manager),
        )
      : rankForSetter(list, me, now, meGhl, Boolean(who.manager));
  const counts = [0, 1, 2, 3].map(t => ranked.filter(r => r.tier === t).length);
  const iso = (v: number | null) => (v ? new Date(v).toISOString() : null);
  return {
    as,
    counts,
    open: open[0] ?? null,
    today: day,
    queue: ranked.slice(0, Math.min(80, Number(b.limit ?? 25))).map(r => {
      // rankFor* keep every field of the lead they were given.
      const c = r as typeof r & Partial<CloserFacts> & { step: number; last_outcome: string | null };
      return {
        contact_id: r.contact_id,
        name: r.name,
        phone: r.phone,
        stage: r.stage,
        lead_class: r.lead_class,
        tier: r.tier,
        why: r.why,
        created_at: iso(r.created_at),
        last_dial_at: iso(r.last_dial_at),
        due_at: iso(r.due_at),
        inbound_at: iso(r.inbound_at),
        callback_at: iso(r.callback_at),
        demo_at: iso(c.demo_at ?? null),
        step: c.step,
        last_outcome: c.last_outcome,
        kind: r.kind,
        heat: r.heat,
        hot_reasons: r.hot_reasons,
        hot: r.hot,
        misses: r.misses,
        stage_role: r.stage_role,
        appointment: r.appt
          ? {
              id: r.appt.id,
              type: r.appt.type,
              start_at: iso(r.appt.start),
              booked_at: iso(r.appt.booked),
              assigned_user_id: r.appt.assigned,
              confirmed: r.appt.confirmed,
            }
          : null,
      };
    }),
  };
}

async function dialCall(who: Who, b: Row) {
  const me = String(who.email);
  const maqsamEmail = String(who.maqsam_email ?? "").trim();
  if (!maqsamEmail)
    throw new Refusal("Your seat has no Maqsam address yet. Ask Aziz to add it on the Team page.", 409);
  const contact = cleanText(b.contact_id, 80);
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=contact_id,phone,dnd,name`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  if (lead.dnd) throw new Refusal("This lead asked not to be contacted (do not disturb is on in HighLevel).", 409);
  const r = routePhone(lead.phone);
  if (!r.ok) throw new Refusal(r.error, 409);

  // A call left open for more than 15 minutes was never saved: let it go.
  await svc(
    `cockpit_sales_attempts?rep_email=eq.${enc(me)}&state=in.(dialing,placed)&started_at=lt.${enc(new Date(Date.now() - 15 * 60_000).toISOString())}`,
    { method: "PATCH", body: { state: "released" }, prefer: "return=minimal" },
  );
  const recent = (await svc(
    `cockpit_sales_attempts?rep_email=eq.${enc(me)}&manual=eq.false&select=started_at&order=started_at.desc&limit=1`,
  ))[0];
  if (recent && Date.now() - Date.parse(String(recent.started_at)) < 12_000)
    throw new Refusal("Give it a few seconds between calls, then call again.", 429);

  await maqsamReady(maqsamEmail);

  let attempt: Row;
  try {
    attempt = (await svc("cockpit_sales_attempts", {
      method: "POST",
      body: {
        contact_id: contact,
        rep_email: me,
        maqsam_email: maqsamEmail,
        phone: r.route.digits,
        caller: r.route.caller,
        as_role: b.as === "closer" ? "closer" : "setter",
      },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/23505|duplicate/.test(msg)) {
      const mine = await svc(`cockpit_sales_attempts?rep_email=eq.${enc(me)}&state=in.(dialing,placed)&select=id`);
      throw new Refusal(
        mine.length
          ? "You already have a call open. Save how it went, or skip it, first."
          : "Someone else is calling this lead right now.",
        409,
      );
    }
    throw e;
  }
  try {
    const d = await maqsam("/v3/calls", "POST", { email: maqsamEmail, phone: r.route.digits, caller: r.route.caller });
    const ref = String(((d.call ?? {}) as Row).referenceId ?? d.referenceId ?? "");
    const accepted = d.message === "success" || d.result === "success";
    if (!accepted) throw new Error(`Maqsam did not accept the call: ${redact(JSON.stringify(d))}`);
    attempt = (await svc(`cockpit_sales_attempts?id=eq.${attempt.id}`, {
      method: "PATCH",
      body: { state: "placed", maqsam_ref: ref || null },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    const err = e instanceof Refusal ? e.message : redact(String((e as Error).message ?? e));
    await svc(`cockpit_sales_attempts?id=eq.${attempt.id}`, {
      method: "PATCH",
      body: { state: "failed", error: err },
      prefer: "return=minimal",
    });
    throw new Refusal(`The call did not go through: ${err}`, 502);
  }
  await audit(who, "dial.call", "cockpit_sales_attempts", String(attempt.id), null, attempt, { country: r.route.flag });
  return { attempt, route: { country: r.route.country, caller: r.route.caller } };
}

/** Maqsam's history of the rep's calls since a moment (newest pages first, at most three). */
async function maqsamCalls(email: string, fromMs: number): Promise<MaqsamCall[]> {
  const all: MaqsamCall[] = [];
  for (let page = 1; page <= 3; page++) {
    const d = await maqsam("/v3/calls", "GET", {
      email,
      start_time: String(Math.floor(fromMs / 1000)),
      page: String(page),
    });
    const list = Array.isArray(d.message) ? (d.message as MaqsamCall[]) : [];
    all.push(...list);
    if (!list.length) break;
  }
  return all;
}

/**
 * Save how a call went: the attempt that is open (or failed), or, with no
 * attempt, a manual one for a call made outside the dialer. The update only
 * lands on an attempt still open, so an outcome the rep saves and the one
 * Maqsam's record saves by itself can never both stand.
 */
async function saveOutcome(
  who: Who,
  a: Row | null,
  contactId: string,
  outcome: AnyOutcome,
  note: string,
  callbackAt: number | null,
  extra: {
    auto?: boolean;
    appointmentId?: string | null;
    reason?: string | null;
    asRole?: string | null;
    kind?: ItemKind;
  } = {},
): Promise<{ attempt: Row; state: Row; stage_move?: Row | null } | null> {
  const now = Date.now();
  const kind: ItemKind = extra.kind ?? "lead";
  const effect = appointmentEffect(kind, outcome);
  if (!effect) throw new Refusal("That outcome does not fit this call.");
  if ((effect.mark || effect.confirmation) && !extra.appointmentId) throw new Refusal("Which appointment?");
  const appt = extra.appointmentId
    ? ((await svc(`cockpit_sales_appointments?appointment_id=eq.${enc(extra.appointmentId)}&select=*`))[0] ?? null)
    : null;
  if (extra.appointmentId && (!appt || String(appt.contact_id) !== contactId))
    throw new Refusal("That appointment is not this lead's.", 409);
  // The mark goes first: if it is refused, nothing is saved.
  let marked: Row | null = null;
  if (effect.mark && appt)
    marked = await markAppointment(who, String(appt.appointment_id), effect.mark, {
      note: note || null,
      anyRep: effect.mark === "cancelled",
    });
  const st = (await svc(`cockpit_sales_queue_state?contact_id=eq.${enc(contactId)}&select=*`))[0];
  const next = effect.ladder
    ? afterOutcome(outcome as Outcome, Number(st?.step ?? 0), now, callbackAt, {
        due: ms(st?.due_at),
        callback: ms(st?.callback_at),
      })
    : null;
  const fields = {
    state: "saved",
    outcome,
    reason: extra.reason || null,
    note: note || null,
    callback_at: callbackAt ? new Date(callbackAt).toISOString() : null,
    saved_at: new Date(now).toISOString(),
    auto_saved: Boolean(extra.auto),
    appointment_id: extra.appointmentId ?? null,
    item_kind: kind,
  };
  let saved: Row | undefined;
  if (a) {
    saved = (await svc(`cockpit_sales_attempts?id=eq.${enc(String(a.id))}&state=in.(dialing,placed,failed)`, {
      method: "PATCH",
      body: fields,
      prefer: "return=representation",
    }))[0];
    if (!saved) {
      if (extra.auto) return null;
      throw new Refusal("This call was already saved.", 409);
    }
  } else {
    const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=phone`))[0];
    const r = routePhone(lead?.phone);
    saved = (await svc("cockpit_sales_attempts", {
      method: "POST",
      body: {
        contact_id: contactId,
        rep_email: who.email,
        phone: r.ok ? r.route.digits : null,
        manual: true,
        as_role: extra.asRole === "closer" ? "closer" : extra.asRole === "setter" ? "setter" : null,
        started_at: new Date(now).toISOString(),
        ...fields,
      },
      prefer: "return=representation",
    }))[0];
  }
  const id = String(saved.id);
  const stamp = new Date(now).toISOString();
  // Appointment work leaves the lead's ladder where it was; a cancelled call
  // comes back the next working morning to be rebooked.
  const state: Row = next
    ? {
        contact_id: contactId,
        step: next.step,
        due_at: next.due ? new Date(next.due).toISOString() : null,
        callback_at: next.callback ? new Date(next.callback).toISOString() : null,
        callback_by: next.callback ? who.email : null,
        closed: next.closed,
        closed_at: next.closed ? stamp : null,
        last_outcome: outcome,
        last_outcome_at: stamp,
        last_rep: who.email,
        updated_at: stamp,
      }
    : {
        contact_id: contactId,
        last_outcome: outcome,
        last_outcome_at: stamp,
        last_rep: who.email,
        updated_at: stamp,
        ...(effect.rebook ? { due_at: new Date(nextMorning(now)).toISOString(), closed: null, closed_at: null } : {}),
      };
  if (effect.confirmation && appt)
    await svc("cockpit_sales_confirmations", {
      method: "POST",
      body: {
        appointment_id: String(appt.appointment_id),
        contact_id: contactId,
        call_type: appt.call_type === "demo" ? "demo" : "intro",
        start_at: appt.start_at,
        result: effect.confirmation,
        via: a && !a.manual ? "call" : "cockpit",
        note: note || null,
        by_email: who.email,
        attempt_id: id,
      },
      prefer: "return=minimal",
    });
  await svc("cockpit_sales_queue_state?on_conflict=contact_id", {
    method: "POST",
    body: state,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  // The pipeline follows the outcome (a booking moves when book.create saves it).
  const call = appt ? (appt.call_type === "demo" ? "demo" : "intro") : null;
  const moved =
    extra.auto || outcome === "booked"
      ? null
      : await autoMove(
          who,
          contactId,
          current => targetRoles(kind, outcome, next?.closed ?? null, null, call, current),
          { source: "dialer", outcome, attemptId: String(saved.id) },
        );
  const tagged = extra.auto ? null : await tagOutcome(contactId, outcome);
  // The dialer's rule: every outcome a person saves leaves a note in the CRM.
  // An unanswered call with nothing written does not. Best effort.
  let crmNote = "skipped";
  if (!extra.auto && (outcome !== "no_answer" || note)) {
    try {
      await ghl(
        "POST",
        `/contacts/${enc(contactId)}/notes`,
        {
          body: `${ANY_OUTCOME_WORDS[outcome]}${
            appt ? ` (the ${appt.call_type === "demo" ? "demo" : "intro"} on ${kuwaitWords(Date.parse(String(appt.start_at)))})` : ""
          } (${a ? "call" : "saved"} from the sales cockpit by ${String(who.name ?? who.email)})${note ? `: ${note}` : ""}${
            callbackAt ? `\nCall back ${kuwaitWords(callbackAt)} (Kuwait time)` : ""
          }`,
          ...(who.ghl_user_id ? { userId: who.ghl_user_id } : {}),
        },
        "2021-07-28",
      );
      crmNote = "written";
    } catch {
      crmNote = "failed";
    }
    await svc(`cockpit_sales_attempts?id=eq.${enc(id)}`, {
      method: "PATCH",
      body: { crm_note: crmNote },
      prefer: "return=minimal",
    });
  }
  await audit(
    who,
    extra.auto ? "dial.auto_save" : a ? "dial.save" : "dial.save_manual",
    "cockpit_sales_attempts",
    id,
    a,
    { ...saved, crm_note: crmNote },
    {
      state,
      kind,
      ...(marked ? { mark: marked.status, mark_crm: marked.crm } : {}),
      ...(moved ? { stage_move: moved.state } : {}),
      ...(tagged ? { tags: tagged } : {}),
    },
  );
  return { attempt: { ...saved, crm_note: crmNote }, state, stage_move: moved };
}

/** Outcomes whose story the next person needs in a line of notes. */
const NEEDS_NOTE: readonly string[] = ["callback", "not_interested", "disqualified", "wrong_number", "handled", "showed", "cancelled", "booked"];

function outcomeInput(b: Row): { outcome: AnyOutcome; note: string; callbackAt: number | null } {
  const outcome = String(b.outcome) as AnyOutcome;
  if (![...OUTCOMES, ...APPOINTMENT_OUTCOMES].includes(outcome as never)) throw new Refusal("Choose how the call went.");
  const note = cleanText(b.note, 4000);
  if (NEEDS_NOTE.includes(outcome) && note.length < 3)
    throw new Refusal("Write a line on what happened, so the next person knows.");
  let callbackAt: number | null = null;
  if (outcome === "callback") {
    callbackAt = b.callback_at ? Date.parse(String(b.callback_at)) : Number.NaN;
    if (!Number.isFinite(callbackAt) || callbackAt < Date.now() - 60_000 || callbackAt > Date.now() + 30 * 86_400_000)
      throw new Refusal("Pick when to call back, within the next 30 days.");
  }
  return { outcome, note, callbackAt };
}

async function dialSave(who: Who, b: Row) {
  const { outcome, note, callbackAt } = outcomeInput(b);
  let a: Row | null = null;
  let contactId = cleanText(b.contact_id, 80);
  if (b.attempt_id) {
    a = (await svc(`cockpit_sales_attempts?id=eq.${enc(cleanText(b.attempt_id, 40))}&select=*`))[0] ?? null;
    if (!a) throw new Refusal("That call is not there any more.", 404);
    if (!who.manager && a.rep_email !== who.email) throw new Refusal("That is another rep's call.", 403);
    if (!["dialing", "placed", "failed"].includes(String(a.state))) throw new Refusal("This call was already saved.", 409);
    contactId = String(a.contact_id);
  } else {
    // Saved without a call through the dialer: the lead must be free, and
    // the rep's own open call, if it is this lead's, is the one saved.
    if (!contactId) throw new Refusal("Which lead?");
    const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id`))[0];
    if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
    const open = await svc(
      `cockpit_sales_attempts?select=*&state=in.(dialing,placed)&or=${enc(`(contact_id.eq."${contactId}",rep_email.eq."${String(who.email)}")`)}`,
    );
    const mineHere = open.find(o => o.contact_id === contactId && o.rep_email === who.email);
    if (mineHere) a = mineHere;
    else if (open.some(o => o.contact_id === contactId)) throw new Refusal("Someone else is calling this lead right now.", 409);
    else if (open.some(o => o.rep_email === who.email))
      throw new Refusal("You have a call open with another lead. Save or skip it first.", 409);
  }
  // Booked means on the calendar: through Book a time, or already there
  // (the lead booked from the page, or someone booked in HighLevel).
  if (outcome === "booked" && String(b.item_kind ?? "lead") === "lead") {
    const [intro, demo] = await Promise.all([upcoming(contactId, "intro"), upcoming(contactId, "demo")]);
    if (!intro && !demo)
      throw new Refusal("Nothing is booked for this lead in HighLevel yet. Use Book a time, so the call goes on the calendar.", 409);
  }
  const kind = (["intro", "confirm"].includes(String(b.item_kind)) ? String(b.item_kind) : "lead") as ItemKind;
  const out = await saveOutcome(who, a, contactId, outcome, note, callbackAt, {
    reason: cleanText(b.reason, 200) || null,
    asRole: cleanText(b.as, 10) || null,
    kind,
    appointmentId: cleanText(b.appointment_id, 80) || null,
  });
  return out ?? {};
}

/**
 * While a call is open: Maqsam's record of it, once there is one. A call
 * Maqsam records as not answered, with no second spoken, is saved as No
 * answer by itself and the retry ladder moves on (the call centre's rule:
 * only that explicit result saves itself; busy, failed and a zero-second
 * answered call wait for the rep).
 */
async function dialStatus(who: Who, b: Row) {
  const id = cleanText(b.attempt_id, 40);
  let a = (await svc(`cockpit_sales_attempts?id=eq.${enc(id)}&select=*`))[0];
  if (!a) throw new Refusal("That call is not there any more.", 404);
  if (!who.manager && a.rep_email !== who.email) throw new Refusal("That is another rep's call.", 403);
  const summary = () =>
    a.call_state
      ? callSummary({ state: String(a.call_state), duration: Number(a.call_duration_s ?? 0) })
      : null;
  if (a.state !== "placed" || !a.maqsam_email) return { attempt: a, call: summary(), auto_saved: false };
  // Two tabs, or a quick poll: Maqsam is asked at most every three seconds.
  if (a.call_checked_at && Date.now() - Date.parse(String(a.call_checked_at)) < 3_000)
    return { attempt: a, call: summary(), auto_saved: false };
  const started = Date.parse(String(a.started_at));
  const calls = await maqsamCalls(String(a.maqsam_email), started - 5_000);
  const c = matchCall(
    {
      phone: String(a.phone ?? ""),
      started_at: started,
      maqsam_email: String(a.maqsam_email),
      maqsam_ref: (a.maqsam_ref as string) ?? null,
      maqsam_call_id: (a.maqsam_call_id as string) ?? null,
    },
    calls,
  );
  a = (await svc(`cockpit_sales_attempts?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: {
      call_checked_at: new Date().toISOString(),
      ...(c
        ? { maqsam_call_id: String(c.id), call_state: String(c.state ?? ""), call_duration_s: Math.round(Number(c.duration) || 0) }
        : {}),
    },
    prefer: "return=representation",
  }))[0] ?? a;
  if (c && isNoAnswer(c)) {
    const out = await saveOutcome(
      who,
      a,
      String(a.contact_id),
      "no_answer",
      `No answer: Maqsam's record of the call (${String(c.id)}) shows nobody picked up.`,
      null,
      { auto: true },
    );
    if (out) return { attempt: out.attempt, state: out.state, call: callSummary(c), auto_saved: true };
  }
  return { attempt: a, call: callSummary(c), auto_saved: false };
}

async function dialRelease(who: Who, b: Row) {
  const id = cleanText(b.attempt_id, 40);
  const a = (await svc(`cockpit_sales_attempts?id=eq.${enc(id)}&select=*`))[0];
  if (!a) throw new Refusal("That call is not there any more.", 404);
  if (!who.manager && a.rep_email !== who.email) throw new Refusal("That is another rep's call.", 403);
  await svc(`cockpit_sales_attempts?id=eq.${enc(id)}&state=in.(dialing,placed,failed)`, {
    method: "PATCH",
    body: { state: "released" },
    prefer: "return=minimal",
  });
  await audit(who, "dial.release", "cockpit_sales_attempts", id, a, { state: "released" });
  return {};
}

// ---------------------------------------------------------------------------
// Booking from the dialer (mahara-power-dialer's booking path: slots from the
// calendar, the booking written down first, created with HighLevel's own
// free-slot check on, read back before the outcome is saved)
// ---------------------------------------------------------------------------

const calendarCache = new Map<string, { at: number; cal: Row }>();

async function calendarInfo(id: string): Promise<Row> {
  const hit = calendarCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.cal;
  const d = await ghl("GET", `/calendars/${enc(id)}`);
  const cal = ((d.calendar ?? d) as Row) ?? {};
  calendarCache.set(id, { at: Date.now(), cal });
  return cal;
}

function slotMinutes(cal: Row): number {
  const n = Number(cal.slotDuration);
  const minutes = String(cal.slotDurationUnit ?? "mins").startsWith("hour") ? n * 60 : n;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Refusal("The calendar has no call length set in HighLevel.", 409);
  return minutes;
}

function noticeWords(kind: BookingKind, cal: Row): string {
  const after = Number(cal.allowBookingAfter);
  const afterUnit = String(cal.allowBookingAfterUnit ?? "hours");
  const ahead = Number(cal.allowBookingFor);
  const aheadUnit = String(cal.allowBookingForUnit ?? "days");
  const what = kind === "intro" ? "An intro" : "A demo";
  const parts = [
    after > 0 ? `from ${after} ${after === 1 ? afterUnit.replace(/s$/, "") : afterUnit} ahead` : null,
    ahead > 0 ? `up to ${ahead} ${ahead === 1 ? aheadUnit.replace(/s$/, "") : aheadUnit} out` : null,
  ].filter(Boolean);
  return parts.length ? `${what} can be booked ${parts.join(", ")}, as the HighLevel calendar allows.` : "";
}

async function bookingPlan(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  if (!contact) throw new Refusal("Which lead?");
  const kind: BookingKind = b.kind === "demo" ? "demo" : "intro";
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=contact_id,name,lead_class`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const calendarId = calendarFor(kind, (lead.lead_class as string) ?? null);
  const cal = await calendarInfo(calendarId);
  if (cal.isActive === false) throw new Refusal("That calendar is switched off in HighLevel. Ask Aziz.", 409);
  const team = ((cal.teamMembers ?? []) as Row[]).map(t => String(t.userId ?? "")).filter(Boolean);
  const onTeam = Boolean(who.ghl_user_id && team.includes(String(who.ghl_user_id)));
  const withMe = onTeam && b.with !== "anyone";
  return {
    contact,
    kind,
    lead,
    calendarId,
    cal,
    minutes: slotMinutes(cal),
    onTeam,
    withMe,
    userId: withMe ? String(who.ghl_user_id) : null,
  };
}

async function freeSlots(calendarId: string, from: number, to: number, userId: string | null) {
  const q = new URLSearchParams({ startDate: String(from), endDate: String(to), timezone: "Asia/Kuwait" });
  if (userId) q.set("userId", userId);
  return parseSlots(await ghl("GET", `/calendars/${enc(calendarId)}/free-slots?${q}`), Date.now());
}

/** The lead's next intro or demo on HighLevel's calendar, if one is booked. */
async function upcoming(contactId: string, kind: BookingKind): Promise<{ id: string; start: number } | null> {
  const [d, types] = await Promise.all([
    ghl("GET", `/contacts/${enc(contactId)}/appointments`, undefined, "2021-07-28"),
    setting<Record<string, { type: string }>>("calendars"),
  ]);
  const events = ((d.events ?? d.appointments ?? []) as Row[])
    .filter(e => !e.deleted && !["cancelled", "invalid", "noshow"].includes(String(e.appointmentStatus ?? e.appoinmentStatus ?? "")))
    .filter(e => types?.[String(e.calendarId ?? "")]?.type === kind)
    .map(e => ({ id: String(e.id ?? ""), start: ghlTime(e.startTime) }))
    .filter(e => e.id && Number.isFinite(e.start) && e.start > Date.now())
    .sort((x, y) => x.start - y.start);
  return events[0] ?? null;
}

/** The plan for moving an existing appointment: its own calendar, and the person it is with. */
async function movePlan(b: Row) {
  const id = cleanText(b.appointment_id, 80);
  const appt = (await svc(`cockpit_sales_appointments?appointment_id=eq.${enc(id)}&select=*`))[0];
  if (!appt) throw new Refusal("That appointment is not in the cockpit. It may have been deleted in HighLevel.", 404);
  if (["cancelled", "noshow", "showed", "invalid"].includes(String(appt.status ?? "")))
    throw new Refusal("This call is already over or cancelled. Book a new one instead.", 409);
  const calendarId = String(appt.calendar_id ?? "");
  if (!calendarId) throw new Refusal("This appointment has no calendar in the cockpit.", 409);
  const cal = await calendarInfo(calendarId);
  const kind: BookingKind = appt.call_type === "demo" ? "demo" : "intro";
  return { appt, calendarId, cal, kind, minutes: slotMinutes(cal), userId: (appt.assigned_user_id as string) || null };
}

async function bookSlots(who: Who, b: Row) {
  if (b.appointment_id) {
    const m = await movePlan(b);
    const now = Date.now();
    const days = await freeSlots(m.calendarId, now, now + 4 * 86_400_000, m.userId);
    return {
      kind: m.kind,
      calendar_id: m.calendarId,
      calendar: String(m.cal.name ?? ""),
      minutes: m.minutes,
      with: m.userId ? "me" : "anyone",
      fallback: false,
      on_team: false,
      moving: { id: String(m.appt.appointment_id), start: m.appt.start_at, words: kuwaitWords(Date.parse(String(m.appt.start_at))) },
      notice: noticeWords(m.kind, m.cal),
      existing: null,
      days,
    };
  }
  const p = await bookingPlan(who, b);
  const now = Date.now();
  const [mine, existing] = await Promise.all([
    freeSlots(p.calendarId, now, now + 4 * 86_400_000, p.userId),
    upcoming(p.contact, p.kind),
  ]);
  // A rep on the calendar with no free time of their own sees the team's
  // times; the calendar's round robin then picks who takes the call.
  const fallback = p.withMe && !mine.length;
  const days = fallback ? await freeSlots(p.calendarId, now, now + 4 * 86_400_000, null) : mine;
  return {
    kind: p.kind,
    calendar_id: p.calendarId,
    calendar: String(p.cal.name ?? ""),
    minutes: p.minutes,
    with: p.withMe && !fallback ? "me" : "anyone",
    fallback,
    on_team: p.onTeam,
    notice: noticeWords(p.kind, p.cal),
    existing: existing ? { id: existing.id, start: new Date(existing.start).toISOString(), words: kuwaitWords(existing.start) } : null,
    days,
  };
}

async function bookCreate(who: Who, b: Row) {
  const p = await bookingPlan(who, b);
  const start = Date.parse(String(b.start ?? ""));
  if (!Number.isFinite(start)) throw new Refusal("Pick a time from the list.");
  if (start <= Date.now()) throw new Refusal("That time has passed. Pick another.");
  const note = cleanText(b.note, 4000);
  if (note.length < 3) throw new Refusal("Write a line on the call, so whoever takes it knows what was said.");

  // The rep's open call with this lead, if there is one, is the call saved as booked.
  let attempt: Row | null = null;
  if (b.attempt_id) {
    attempt = (await svc(`cockpit_sales_attempts?id=eq.${enc(cleanText(b.attempt_id, 40))}&select=*`))[0] ?? null;
    if (attempt && !who.manager && attempt.rep_email !== who.email) throw new Refusal("That is another rep's call.", 403);
    if (attempt && (attempt.contact_id !== p.contact || !["dialing", "placed", "failed"].includes(String(attempt.state))))
      attempt = null;
  }
  if (!attempt) {
    const open = await svc(`cockpit_sales_attempts?select=*&state=in.(dialing,placed)&contact_id=eq.${enc(p.contact)}`);
    if (open.some(o => o.rep_email !== who.email)) throw new Refusal("Someone else is calling this lead right now.", 409);
    attempt = open[0] ?? null;
  }

  const existing = await upcoming(p.contact, p.kind);
  if (existing)
    throw new Refusal(
      `They already have ${p.kind === "intro" ? "an intro" : "a demo"} on ${kuwaitWords(existing.start)} (Kuwait time). Move that one in HighLevel instead of booking a second.`,
      409,
    );
  const dayStart = kuwaitAt(start, 0);
  const days = await freeSlots(p.calendarId, Math.max(Date.now(), dayStart), dayStart + 86_400_000, p.userId);
  if (!slotOffered(new Date(start).toISOString(), days)) throw new Refusal("That time was just taken. Pick another.", 409);

  const end = start + p.minutes * 60_000;
  let booking: Row;
  try {
    booking = (await svc("cockpit_sales_bookings", {
      method: "POST",
      body: {
        contact_id: p.contact,
        attempt_id: attempt?.id ?? null,
        kind: p.kind,
        calendar_id: p.calendarId,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        assigned_user_id: p.userId,
        rep_email: who.email,
        note,
      },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    if (/23505|duplicate/.test(String((e as Error).message ?? e)))
      throw new Refusal("This lead is being booked right now. Give it a few seconds.", 409);
    throw e;
  }
  const finish = (body: Row) =>
    svc(`cockpit_sales_bookings?id=eq.${enc(String(booking.id))}`, {
      method: "PATCH",
      body: { ...body, finished_at: new Date().toISOString() },
      prefer: "return=representation",
    }).then(r => r[0] ?? { ...booking, ...body });

  let apptId = "";
  try {
    const d = await ghl("POST", "/calendars/events/appointments", {
      calendarId: p.calendarId,
      locationId: LOCATION,
      contactId: p.contact,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      title: String(p.lead.name ?? "Sales call").slice(0, 120),
      appointmentStatus: "confirmed",
      ...(p.userId ? { assignedUserId: p.userId } : {}),
      ignoreFreeSlotValidation: false,
      ignoreDateRange: false,
    });
    apptId = String(d.id ?? (d.event as Row | undefined)?.id ?? (d.appointment as Row | undefined)?.id ?? "");
    if (!apptId) throw new Error("HighLevel answered without the booking's id");
  } catch (e) {
    const err = redact(String((e as Error).message ?? e));
    // HighLevel refused (an HTTP answer): nothing was booked. No answer at
    // all: it may have been, so it is left for a person to check.
    const refused = typeof (e as { status?: number }).status === "number";
    const row = await finish({ state: refused ? "failed" : "unverified", error: err });
    await audit(who, "book.create", "cockpit_sales_bookings", String(booking.id), null, row);
    throw new Refusal(
      refused
        ? `HighLevel did not book it: ${err}`
        : "HighLevel did not answer. Open the lead in HighLevel and check the calendar before booking again.",
      502,
    );
  }

  // Read it back before anything says "booked".
  let back: Row | null = null;
  try {
    const r = await ghl("GET", `/calendars/events/appointments/${enc(apptId)}`);
    back = ((r.appointment ?? r.event ?? r) as Row) ?? null;
  } catch {
    back = null;
  }
  const verified = Boolean(
    back &&
      String(back.contactId ?? "") === p.contact &&
      String(back.calendarId ?? "") === p.calendarId &&
      ghlTime(back.startTime) === start,
  );
  const assigned = back?.assignedUserId ? String(back.assignedUserId) : p.userId;
  const row = await finish({
    state: verified ? "booked" : "unverified",
    appointment_id: apptId,
    assigned_user_id: assigned,
    error: verified ? null : "HighLevel took the booking, but reading it back did not match.",
  });
  if (verified) {
    // On the calendar pages at once; B2B's copy replaces this row when it arrives.
    await svc("cockpit_sales_appointments?on_conflict=appointment_id", {
      method: "POST",
      body: {
        appointment_id: apptId,
        contact_id: p.contact,
        contact_name: (p.lead.name as string) ?? null,
        calendar_id: p.calendarId,
        call_type: p.kind,
        start_at: new Date(start).toISOString(),
        booked_at: new Date().toISOString(),
        status: String(back?.appointmentStatus ?? "confirmed"),
        assigned_user_id: assigned,
        origin: "ghl",
        mirrored_at: new Date().toISOString(),
      },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
  }
  heavy = null;
  const words = `${p.kind === "intro" ? "Intro" : "Demo"} booked for ${kuwaitWords(start)} (Kuwait time)`;
  const out = await saveOutcome(who, attempt, p.contact, "booked", `${words}. ${note}`, null, {
    appointmentId: apptId,
    asRole: cleanText(b.as, 10) || null,
  });
  const moved = await autoMove(who, p.contact, () => targetRoles("lead", "booked", "booked", p.kind), {
    source: "booking",
    outcome: "booked",
    attemptId: out?.attempt ? String(out.attempt.id) : null,
  });
  await audit(who, "book.create", "cockpit_sales_bookings", String(booking.id), null, row, {
    verified,
    stage_move: moved?.state ?? null,
  });
  return { booking: row, verified, words, stage_move: moved, ...(out ?? {}) };
}

/**
 * Move an intro or demo to another free time with the same person: checked
 * against HighLevel's free slots, moved, read back. The lead agreed the new
 * time with the rep, so it counts as their confirmation.
 */
async function bookMove(who: Who, b: Row) {
  const m = await movePlan(b);
  const contact = String(m.appt.contact_id ?? "");
  const start = Date.parse(String(b.start ?? ""));
  if (!Number.isFinite(start)) throw new Refusal("Pick a time from the list.");
  if (start <= Date.now()) throw new Refusal("That time has passed. Pick another.");
  const note = cleanText(b.note, 4000);
  if (note.length < 3) throw new Refusal("Write a line on why it moved, so whoever takes it knows.");
  const dayStart = kuwaitAt(start, 0);
  const days = await freeSlots(m.calendarId, Math.max(Date.now(), dayStart), dayStart + 86_400_000, m.userId);
  if (!slotOffered(new Date(start).toISOString(), days)) throw new Refusal("That time was just taken. Pick another.", 409);
  const end = start + m.minutes * 60_000;
  const before = m.appt;
  try {
    await ghl("PUT", `/calendars/events/appointments/${enc(String(m.appt.appointment_id))}`, {
      calendarId: m.calendarId,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      ...(m.userId ? { assignedUserId: m.userId } : {}),
      ignoreFreeSlotValidation: false,
      toNotify: true,
    });
  } catch (e) {
    throw new Refusal(`HighLevel did not move it: ${redact(String((e as Error).message ?? e))}`, 502);
  }
  let back: Row | null = null;
  try {
    const r = await ghl("GET", `/calendars/events/appointments/${enc(String(m.appt.appointment_id))}`);
    back = ((r.appointment ?? r.event ?? r) as Row) ?? null;
  } catch {
    back = null;
  }
  const verified = Boolean(back && ghlTime(back.startTime) === start);
  if (verified)
    await svc(`cockpit_sales_appointments?appointment_id=eq.${enc(String(m.appt.appointment_id))}`, {
      method: "PATCH",
      body: { start_at: new Date(start).toISOString(), mirrored_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
  const words = `${m.kind === "intro" ? "Intro" : "Demo"} moved to ${kuwaitWords(start)} (Kuwait time)`;
  await svc("cockpit_sales_confirmations", {
    method: "POST",
    body: {
      appointment_id: String(m.appt.appointment_id),
      contact_id: contact,
      call_type: m.kind,
      start_at: new Date(start).toISOString(),
      result: "reschedule",
      via: "call",
      note,
      by_email: who.email,
    },
    prefer: "return=minimal",
  });
  let attempt: Row | null = null;
  if (b.attempt_id) {
    attempt = (await svc(`cockpit_sales_attempts?id=eq.${enc(cleanText(b.attempt_id, 40))}&select=*`))[0] ?? null;
    if (attempt && (attempt.contact_id !== contact || !["dialing", "placed", "failed"].includes(String(attempt.state))))
      attempt = null;
  }
  const kind = (["intro", "confirm"].includes(String(b.item_kind)) ? String(b.item_kind) : "confirm") as ItemKind;
  const out = await saveOutcome(who, attempt, contact, "rescheduled", `${words}. ${note}`, null, {
    kind,
    appointmentId: String(m.appt.appointment_id),
    asRole: cleanText(b.as, 10) || null,
  });
  await audit(who, "book.move", "cockpit_sales_appointments", String(m.appt.appointment_id), before, {
    start_at: new Date(start).toISOString(),
    verified,
  });
  return { verified, words, ...(out ?? {}) };
}

// ---------------------------------------------------------------------------
// The pipeline: stages from HighLevel, moves by the board and the dialer
// ---------------------------------------------------------------------------

interface PipeStage {
  id: string;
  name: string;
  position: number;
  role: StageRole | null;
}
interface Pipe {
  id: string;
  name: string;
  stages: PipeStage[];
}

let pipeCache: { at: number; pipes: Pipe[] } | null = null;

/** The sub-account's pipelines and stages in order, each stage with its role (ten minutes cached). */
async function pipelines(fresh = false): Promise<Pipe[]> {
  if (!fresh && pipeCache && Date.now() - pipeCache.at < 10 * 60_000) return pipeCache.pipes;
  const [d, roles] = await Promise.all([
    ghl("GET", `/opportunities/pipelines?locationId=${LOCATION}`, undefined, "2021-07-28"),
    stageRoles(),
  ]);
  const pipes = ((d.pipelines ?? []) as Row[]).map(p => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    stages: ((p.stages ?? []) as Row[])
      .map(st => ({
        id: String(st.id),
        name: String(st.name ?? ""),
        position: Number(st.position ?? 0),
        role: (roles[String(st.id)] as StageRole | undefined) ?? stageRole(String(st.name ?? "")),
      }))
      .sort((a, b) => a.position - b.position),
  }));
  pipeCache = { at: Date.now(), pipes };
  return pipes;
}

async function pipelineStages(_who: Who, b: Row) {
  return { pipelines: await pipelines(Boolean(b.fresh)) };
}

/**
 * Move a lead's opportunity to a stage in HighLevel: written down first,
 * carried out, and the cockpit's copy of the lead updated when HighLevel
 * takes it. A lead with no opportunity gets one in the pipeline asked for.
 */
async function moveStage(
  who: Who,
  contactId: string,
  target: { stageId?: string; roles?: StageRole[]; pipelineId?: string },
  ctx: { source: "board" | "dialer" | "booking"; outcome?: string | null; attemptId?: string | null },
): Promise<Row> {
  const lead = (await svc(
    `cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name,opportunity_id,pipeline_id,stage_id`,
  ))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const pipes = await pipelines();
  const pipe =
    pipes.find(p => p.id === (target.pipelineId ?? lead.pipeline_id)) ??
    pipes.find(p => p.stages.some(st => st.id === target.stageId)) ??
    pipes.find(p => /2.?call/i.test(p.name)) ??
    pipes[0];
  const stage = target.stageId
    ? pipe?.stages.find(st => st.id === target.stageId)
    : (target.roles ?? []).map(r => pipe?.stages.find(st => st.role === r)).find(Boolean);
  const base = {
    contact_id: contactId,
    opportunity_id: (lead.opportunity_id as string) ?? null,
    pipeline_id: pipe?.id ?? null,
    from_stage_id: (lead.stage_id as string) ?? null,
    source: ctx.source,
    outcome: ctx.outcome ?? null,
    by_email: who.email,
    attempt_id: ctx.attemptId ?? null,
  };
  if (!pipe || !stage) {
    if (target.stageId) throw new Refusal("That stage is not in the sales pipelines any more. Reload the board.", 409);
    return { state: "skipped", why: "no stage for this outcome in the lead's pipeline" };
  }
  if (lead.stage_id === stage.id && lead.opportunity_id)
    return { state: "skipped", why: "already in that stage", to_stage_id: stage.id };
  const row = (await svc("cockpit_sales_stage_moves", {
    method: "POST",
    body: { ...base, to_stage_id: stage.id },
    prefer: "return=representation",
  }))[0];
  let opp = (lead.opportunity_id as string) || "";
  try {
    if (opp) {
      await ghl(
        "PUT",
        `/opportunities/${enc(opp)}`,
        { pipelineId: pipe.id, pipelineStageId: stage.id, status: "open" },
        "2021-07-28",
      );
    } else {
      const d = await ghl(
        "POST",
        "/opportunities/",
        {
          pipelineId: pipe.id,
          locationId: LOCATION,
          pipelineStageId: stage.id,
          contactId,
          name: String(lead.name ?? "Sales lead").slice(0, 120),
          status: "open",
        },
        "2021-07-28",
      );
      opp = String(((d.opportunity ?? d) as Row).id ?? "");
    }
    await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}`, {
      method: "PATCH",
      body: {
        opportunity_id: opp || null,
        pipeline_id: pipe.id,
        pipeline_name: pipe.name,
        stage_id: stage.id,
        stage_name: stage.name,
        opp_status: "open",
      },
      prefer: "return=minimal",
    });
    const done = (await svc(`cockpit_sales_stage_moves?id=eq.${enc(String(row.id))}`, {
      method: "PATCH",
      body: { state: "done", opportunity_id: opp || null },
      prefer: "return=representation",
    }))[0];
    await audit(who, "pipeline.move", "cockpit_sales_stage_moves", String(row.id), { stage_id: lead.stage_id }, done);
    return { ...done, to_stage_name: stage.name };
  } catch (e) {
    const err = redact(String((e as Error).message ?? e));
    const failed = (await svc(`cockpit_sales_stage_moves?id=eq.${enc(String(row.id))}`, {
      method: "PATCH",
      body: { state: "failed", error: err },
      prefer: "return=representation",
    }))[0];
    await audit(who, "pipeline.move", "cockpit_sales_stage_moves", String(row.id), { stage_id: lead.stage_id }, failed);
    if (ctx.source === "board") throw new Refusal(`HighLevel did not move it: ${err}`, 502);
    return failed;
  }
}

/**
 * The board: one pipeline's stages in order, and a card per open lead in it
 * (plus the sales leads that have no opportunity yet), each with its heat
 * and reasons, when it was last touched, its next step and its owner. A lead
 * with nothing in the last 60 days, no next step and not on the hot list is
 * quiet: counted per stage, and shown only when asked for.
 */
async function pipelineBoard(who: Who, b: Row) {
  const pipes = await pipelines();
  const pipe =
    pipes.find(p => p.id === cleanText(b.pipeline_id, 80)) ?? pipes.find(p => /2.?call/i.test(p.name)) ?? pipes[0];
  if (!pipe) throw new Refusal("HighLevel has no sales pipeline to show.", 404);
  const now = Date.now();
  const since = now - 60 * 86_400_000;
  const cols =
    "contact_id,name,lead_class,stage_id,stage_name,opp_status,pipeline_id,assigned_to,revenue,readiness,lead_created_at,opp_updated_at,dnd";
  const [inPipe, loose, inbox, hotRows, states, appts, people] = await Promise.all([
    svcAll(`cockpit_sales_leads?pipeline_id=eq.${enc(pipe.id)}&select=${cols}&order=contact_id`),
    svc(
      `cockpit_sales_leads?pipeline_id=is.null&lead_class=not.is.null&lead_created_at=gte.${enc(new Date(since).toISOString())}&select=${cols}&limit=1000`,
    ),
    svcAll("cockpit_sales_inbox?select=contact_id,last_message_at,last_direction&order=conversation_id"),
    svc("cockpit_sales_hot?removed_at=is.null&select=*&limit=2000"),
    svcAll("cockpit_sales_queue_state?select=contact_id,callback_at,due_at,last_outcome,last_outcome_at,closed&order=contact_id"),
    svc(
      `cockpit_sales_calendar?select=contact_id,call_type,start_at,status&start_at=gte.${enc(new Date(now).toISOString())}&order=start_at&limit=2000`,
    ),
    svc("cockpit_sales_people?select=email,name,ghl_user_id"),
  ]);
  const inboundBy = new Map<string, number>();
  for (const i of inbox)
    if (i.last_direction === "inbound") inboundBy.set(String(i.contact_id), ms(i.last_message_at) ?? 0);
  const hotBy = new Map(hotRows.map(r => [String(r.contact_id), r]));
  const stateBy = new Map(states.map(r => [String(r.contact_id), r]));
  const apptBy = new Map<string, Row>();
  for (const a of appts)
    if (!["cancelled", "noshow", "invalid"].includes(String(a.status ?? "")) && !apptBy.has(String(a.contact_id)))
      apptBy.set(String(a.contact_id), a);
  const ownerOf = new Map(people.filter(p => p.ghl_user_id).map(p => [String(p.ghl_user_id), String(p.name ?? p.email)]));
  const mineOnly = b.scope === "mine";
  const showAll = Boolean(b.all);
  const quiet: Record<string, number> = {};
  const cards: Row[] = [];
  for (const l of [...inPipe, ...loose]) {
    if (l.opp_status && l.opp_status !== "open") continue;
    const id = String(l.contact_id);
    const hot = hotBy.get(id);
    const st = stateBy.get(id);
    const appt = apptBy.get(id);
    if (mineOnly && l.assigned_to !== who.ghl_user_id && hot?.owner_email !== who.email) continue;
    const inbound = inboundBy.get(id) ?? null;
    const touches = [inbound, ms(l.opp_updated_at), ms(st?.last_outcome_at), ms(l.lead_created_at)].filter(
      (x): x is number => x !== null && x > 0,
    );
    const lastTouch = touches.length ? Math.max(...touches) : null;
    const next = [
      hot?.next_at ? { at: ms(hot.next_at), what: "Hot follow-up" } : null,
      st?.callback_at ? { at: ms(st.callback_at), what: "Call back" } : null,
      appt ? { at: ms(appt.start_at), what: appt.call_type === "demo" ? "Demo" : "Intro" } : null,
      st?.due_at && !st?.closed ? { at: ms(st.due_at), what: "Next try" } : null,
    ]
      .filter((x): x is { at: number; what: string } => Boolean(x && x.at))
      .sort((x, y) => x.at - y.at)[0];
    const stageKey = String(l.stage_id ?? "none");
    const active = Boolean(hot) || Boolean(next) || (lastTouch !== null && lastTouch >= since);
    if (!active && !showAll) {
      quiet[stageKey] = (quiet[stageKey] ?? 0) + 1;
      continue;
    }
    const role = stageRole(String(l.stage_name ?? ""));
    const h = heat(
      {
        lead_class: (l.lead_class as string) ?? null,
        revenue: (l.revenue as string) ?? null,
        readiness: (l.readiness as string) ?? null,
        inbound_at: inbound,
        created_at: ms(l.lead_created_at),
        stage_role: role,
        misses: 0,
        hot: Boolean(hot),
      } as Candidate,
      now,
    );
    cards.push({
      contact_id: id,
      name: l.name ?? null,
      lead_class: l.lead_class ?? null,
      stage_id: l.stage_id ?? null,
      heat: h.score,
      reasons: h.reasons,
      hot: Boolean(hot),
      last_objection: hot?.last_objection ?? null,
      last_touch_at: lastTouch ? new Date(lastTouch).toISOString() : null,
      wrote_at: inbound ? new Date(inbound).toISOString() : null,
      next_at: next ? new Date(next.at).toISOString() : null,
      next_what: next?.what ?? null,
      owner: l.assigned_to ? (ownerOf.get(String(l.assigned_to)) ?? null) : null,
      dnd: Boolean(l.dnd),
      quiet: !active,
    });
  }
  return {
    pipeline: pipe,
    pipelines: pipes.map(p => ({ id: p.id, name: p.name })),
    cards,
    quiet,
    loose: loose.length,
  };
}

/** A rep moves a lead on the board. */
async function pipelineMove(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  const stageId = cleanText(b.stage_id, 80);
  if (!contact || !stageId) throw new Refusal("Which lead, and which stage?");
  const out = await moveStage(who, contact, { stageId, pipelineId: cleanText(b.pipeline_id, 80) || undefined }, {
    source: "board",
  });
  return { move: out };
}

/**
 * The dialer's own move after an outcome, when the settings allow (on unless
 * a manager turned it off). `rolesFor` gets the lead's current stage role, so
 * a rule can depend on where the lead sits now.
 */
async function autoMove(
  who: Who,
  contactId: string,
  rolesFor: (current: StageRole | null) => StageRole[],
  ctx: { source: "dialer" | "booking"; outcome: string; attemptId: string | null },
): Promise<Row | null> {
  const v = await setting<{ auto_moves?: boolean; roles?: Record<string, StageRole> }>("pipeline");
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=stage_id,stage_name`))[0];
  const current = lead
    ? ((v?.roles?.[String(lead.stage_id ?? "")] as StageRole | undefined) ?? stageRole(lead.stage_name as string | null))
    : null;
  const roles = rolesFor(current);
  if (!roles.length) return null;
  if (v?.auto_moves === false) return { state: "skipped", why: "automatic moves are off" };
  try {
    return await moveStage(who, contactId, { roles }, ctx);
  } catch (e) {
    return { state: "failed", error: redact(String((e as Error).message ?? e)) };
  }
}

/** The sub-account's own tags for an outcome (best effort; the outcome stands either way). */
async function tagOutcome(contactId: string, outcome: AnyOutcome): Promise<string | null> {
  const tags = tagsFor(outcome);
  if (!tags.length) return null;
  try {
    await ghl("POST", `/contacts/${enc(contactId)}/tags`, { tags }, "2021-07-28");
    return "tagged";
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// The hot list
// ---------------------------------------------------------------------------

const HOW = ["call", "whatsapp", "email", "meeting"] as const;

/** Put a lead on the hot list, or change when and how to follow up. */
async function hotSave(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=contact_id`))[0];
  if (!lead) throw new Refusal("That lead is not in the cockpit.", 404);
  const before = (await svc(`cockpit_sales_hot?contact_id=eq.${enc(contact)}&select=*`))[0] ?? null;
  if (before && !before.removed_at && !who.manager && before.owner_email !== who.email)
    throw new Refusal(`This lead is on ${String(before.owner_email).split("@")[0]}'s hot list. Ask them or a manager.`, 403);
  let nextAt: string | null = null;
  if (b.next_at) {
    const t = Date.parse(String(b.next_at));
    if (!Number.isFinite(t) || t < Date.now() - 86_400_000 || t > Date.now() + 90 * 86_400_000)
      throw new Refusal("Pick when to follow up, within the next 90 days.");
    nextAt = new Date(t).toISOString();
  }
  const how = cleanText(b.next_how, 10);
  if (how && !(HOW as readonly string[]).includes(how)) throw new Refusal("Follow up by call, WhatsApp, email or a meeting.");
  const owner = who.manager && b.owner_email ? cleanText(b.owner_email, 200).toLowerCase() : String(who.email);
  const row = {
    contact_id: contact,
    owner_email: owner,
    next_at: nextAt,
    next_how: how || null,
    last_objection: cleanText(b.last_objection, 500) || null,
    note: cleanText(b.note, 4000) || null,
    updated_at: new Date().toISOString(),
    removed_at: null,
    removed_why: null,
    ...(before && !before.removed_at ? {} : { added_by: who.email, added_at: new Date().toISOString() }),
  };
  const out = (await svc("cockpit_sales_hot?on_conflict=contact_id", {
    method: "POST",
    body: row,
    prefer: "resolution=merge-duplicates,return=representation",
  }))[0];
  await audit(who, "hot.save", "cockpit_sales_hot", contact, before, out);
  return { hot: out };
}

async function hotRemove(who: Who, b: Row) {
  const contact = cleanText(b.contact_id, 80);
  const before = (await svc(`cockpit_sales_hot?contact_id=eq.${enc(contact)}&removed_at=is.null&select=*`))[0];
  if (!before) throw new Refusal("This lead is not on the hot list.", 404);
  if (!who.manager && before.owner_email !== who.email)
    throw new Refusal("Only its owner or a manager can take it off the hot list.", 403);
  await svc(`cockpit_sales_hot?contact_id=eq.${enc(contact)}`, {
    method: "PATCH",
    body: { removed_at: new Date().toISOString(), removed_why: cleanText(b.why, 200) || null },
    prefer: "return=minimal",
  });
  await audit(who, "hot.remove", "cockpit_sales_hot", contact, before, null);
  return {};
}

// ---------------------------------------------------------------------------
// Reviews a rep asks for, and Aziz's own reviews
// ---------------------------------------------------------------------------

/** Ask the AI reviewer for a review of one call. The desk picks it up within minutes. */
async function reviewAsk(who: Who, b: Row) {
  const id = cleanText(b.recording_id, 200);
  const rec = (await svc(
    `cockpit_sales_recordings?recording_id=eq.${enc(id)}&select=recording_id,title,transcript_path,transcript_chars`,
  ))[0];
  if (!rec) throw new Refusal("That call is not in the cockpit.", 404);
  if (!rec.transcript_path)
    throw new Refusal("This call has no transcript yet, so there is nothing to review.", 409);
  const done = await svc(`cockpit_sales_reviews?recording_id=eq.${enc(id)}&select=id&limit=1`);
  if (done.length && !who.manager) throw new Refusal("This call is already reviewed; the review is on the call's page.", 409);
  let ask: Row;
  try {
    ask = (await svc("cockpit_sales_review_asks", {
      method: "POST",
      body: { recording_id: id, requested_by: who.email },
      prefer: "return=representation",
    }))[0];
  } catch (e) {
    if (/23505|duplicate/.test(String((e as Error).message ?? e)))
      throw new Refusal("A review of this call is already on its way; it takes a few minutes.", 409);
    throw e;
  }
  await audit(who, "review.ask", "cockpit_sales_review_asks", String(ask.id), null, ask);
  return { ask };
}

/** Save one of Aziz's reviews (Skool or elsewhere) for the team. Managers only. */
async function coachSave(who: Who, b: Row) {
  needManager(who);
  const c = checkCoachReview(b);
  if (!c.ok) throw new Refusal(c.error);
  const id = cleanText(b.id, 40);
  const row = { ...c.row, updated_at: new Date().toISOString() };
  let out: Row[];
  let before: Row | null = null;
  if (id) {
    before = (await svc(`cockpit_sales_coach_reviews?id=eq.${enc(id)}&deleted_at=is.null&select=*`))[0] ?? null;
    if (!before) throw new Refusal("That review is not there any more.", 404);
    out = await svc(`cockpit_sales_coach_reviews?id=eq.${enc(id)}`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    });
  } else {
    out = await svc("cockpit_sales_coach_reviews", {
      method: "POST",
      body: { ...row, created_by: who.email },
      prefer: "return=representation",
    });
  }
  await audit(who, "coach.save", "cockpit_sales_coach_reviews", String(out[0]?.id ?? id), before, out[0]);
  return { review: out[0] };
}

async function coachDelete(who: Who, b: Row) {
  needManager(who);
  const id = cleanText(b.id, 40);
  const before = (await svc(`cockpit_sales_coach_reviews?id=eq.${enc(id)}&deleted_at=is.null&select=*`))[0];
  if (!before) throw new Refusal("That review is not there any more.", 404);
  await svc(`cockpit_sales_coach_reviews?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
  await audit(who, "coach.delete", "cockpit_sales_coach_reviews", id, before, null);
  return {};
}

const ACTIONS: Record<string, (who: Who, b: Row) => Promise<Row>> = {
  mark,
  "mark.retry": markRetry,
  "note.add": noteAdd,
  "note.delete": noteDelete,
  "proposal.draft": proposalDraft,
  "proposal.set": proposalSet,
  "proposal.fill": proposalFill,
  "proposal.retry": proposalRetry,
  "request.set": requestSet,
  "person.save": personSave,
  "link.save": linkSave,
  "setting.save": settingSave,
  "lead.live": leadLive,
  "ghl.users": ghlUsers,
  "research.request": researchRequest,
  "followup.approve": followupApprove,
  "followup.skip": followupSkip,
  "followup.settings": followupSettings,
  "eod.prefill": eodPrefill,
  "eod.submit": eodSubmit,
  "eod.retry": eodRetry,
  "convo.read": convoRead,
  "convo.send": convoSend,
  "goal.set": goalSet,
  "dial.agent": dialAgent,
  "dial.queue": dialQueue,
  "dial.call": dialCall,
  "dial.save": dialSave,
  "dial.status": dialStatus,
  "dial.release": dialRelease,
  "book.slots": bookSlots,
  "book.create": bookCreate,
  "book.move": bookMove,
  "pipeline.stages": pipelineStages,
  "pipeline.board": pipelineBoard,
  "pipeline.move": pipelineMove,
  "hot.save": hotSave,
  "hot.remove": hotRemove,
  "review.ask": reviewAsk,
  "coach.save": coachSave,
  "coach.delete": coachDelete,
  "wa.template.send": waTemplateSend,
  "wa.template.save": waTemplateSave,
  "ghl.workflows": ghlWorkflows,
  "snippet.save": snippetSave,
  "snippet.delete": snippetDelete,
  "asset.hide": assetHide,
  "whatsapp.guard": whatsappGuardSave,
  "reference.save": referenceSave,
  "reference.ask": referenceAsk,
  "reference.answer": referenceAnswer,
};

/** What the desk's service key may do: nothing but a trusted follow-up. */
const DESK_ACTIONS: Record<string, (who: Who, b: Row) => Promise<Row>> = {
  "followup.autosend": followupAutosend,
};

/** The role claim of a token the gateway has already verified. */
function jwtRole(jwt: string): string | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims?.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { ...cors(origin), "Cache-Control": "no-store" };
  const reply = (body: Row, status = 200) => Response.json(body, { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ ok: false, error: "Send a POST." }, 405);
  if (origin && headers["Access-Control-Allow-Origin"] === "null")
    return reply({ ok: false, error: "Not an allowed origin." }, 403);

  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!jwt) return reply({ ok: false, error: "Sign in again." }, 401);

  let body: Row;
  try {
    body = (await req.json()) as Row;
  } catch {
    return reply({ ok: false, error: "Send a JSON body." }, 400);
  }
  const handler = ACTIONS[String(body?.action ?? "")];
  if (!handler && !DESK_ACTIONS[String(body?.action ?? "")])
    return reply({ ok: false, error: "Unknown action." }, 400);

  // The sales desk on the VPS calls with the service key, for the one thing
  // it may do by itself: send a follow-up a manager trusts to go alone. The
  // gateway has already checked the token's signature (this function is
  // deployed with verify_jwt), so its role claim can be read as it stands;
  // comparing the key's text failed because the desk and the function hold
  // two different, equally valid service keys (2026-09-24).
  if (jwtRole(jwt) === "service_role") {
    const deskHandler = DESK_ACTIONS[String(body?.action ?? "")];
    if (!deskHandler) return reply({ ok: false, error: "Not an action the desk may take." }, 403);
    const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };
    try {
      return reply({ ok: true, ...(await deskHandler(desk, body)) });
    } catch (e) {
      if (e instanceof Refusal) return reply({ ok: false, error: e.message }, e.status);
      return reply({ ok: false, error: `That did not work: ${redact(String((e as Error).message ?? e))}` }, 500);
    }
  }

  let who: Who;
  try {
    who = await whoami(jwt);
  } catch (e) {
    return reply({ ok: false, error: `The seat check failed: ${redact(String(e))}` }, 502);
  }
  if (!who.signed_in) return reply({ ok: false, error: "Sign in again." }, 401);
  if (!who.seat)
    return reply({ ok: false, error: "The sales cockpit is not on your access. Ask Aziz." }, 403);

  // The desk's own action is not a person's to take.
  if (!handler) return reply({ ok: false, error: "Unknown action." }, 400);
  try {
    return reply({ ok: true, ...(await handler(who, body)) });
  } catch (e) {
    if (e instanceof Refusal) return reply({ ok: false, error: e.message }, e.status);
    console.error(String(body.action), redact(String(e)));
    return reply(
      { ok: false, error: `That did not work: ${redact(String((e as Error).message ?? e))}` },
      500,
    );
  }
});
