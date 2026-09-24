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
  checkEmail,
  checkGoals,
  checkLink,
  checkOffer,
  checkPay,
  cleanText,
  cors,
  crmDecision,
  type CrmSettings,
  redact,
  refuseMark,
  trimMessages,
  type Who,
} from "./lib.ts";
import {
  afterOutcome,
  type Candidate,
  type CloserFacts,
  OUTCOME_WORDS,
  OUTCOMES,
  type Outcome,
  rankForCloser,
  rankForSetter,
  routePhone,
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
      msg = String(j.message ?? j.msg ?? j.error ?? text);
    } catch {
      // not JSON
    }
    throw new Error(`HighLevel said ${res.status}: ${redact(msg)}`);
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
  const status = cleanText(b.status, 20);
  if (!id) throw new Refusal("Which appointment?");
  const appt = (await svc(
    `cockpit_sales_appointments?appointment_id=eq.${enc(id)}&select=*`,
  ))[0] as unknown as Appointment | undefined;
  if (!appt)
    throw new Refusal(
      "That appointment is not in the cockpit. It may have been deleted in HighLevel.",
      404,
    );
  const now = Date.now();
  const no = refuseMark(who, appt, status, now);
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
      reason: cleanText(b.reason, 300) || null,
      note: cleanText(b.note, 4000) || null,
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
  });
  return { mark: result };
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
  const was = ((first?.params ?? {}) as Row) ?? {};
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

/** The rep's Maqsam seat, which must be free to take an outgoing call. */
async function maqsamReady(email: string): Promise<void> {
  for (let page = 1; page <= 5; page++) {
    const d = await maqsam(`/v1/agents/page/${page}`);
    const list = (Array.isArray(d.message) ? d.message : []) as Row[];
    const a = list.find(x => String(x.email ?? "").toLowerCase() === email.toLowerCase());
    if (a) {
      if (!a.active || !a.outgoingEnabled)
        throw new Refusal("Your Maqsam seat is switched off or cannot call out. Ask Aziz to turn it on.", 409);
      if (a.state !== "available")
        throw new Refusal("Open the Maqsam softphone and set yourself Available, then call again.", 409);
      return;
    }
    if (!list.length) break;
  }
  throw new Refusal(`No Maqsam seat has the address ${email}. Ask Aziz to add it on the Team page or in Maqsam.`, 409);
}

const ms = (v: unknown) => {
  const t = v ? Date.parse(String(v)) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

/** Everything the queue needs, read in a handful of queries, no huge id lists. */
async function candidates(now: number): Promise<{
  list: (Candidate & CloserFacts & { demo_rep: string | null; phone8: string | null })[];
}> {
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since60 = new Date(now - 60 * 86_400_000).toISOString();
  const [states, inbox, attempts] = await Promise.all([
    svcAll("cockpit_sales_queue_state?select=*&order=contact_id"),
    svc(`cockpit_sales_inbox?select=contact_id,last_message_at,last_direction&last_direction=eq.inbound&last_message_at=gte.${enc(new Date(now - 86_400_000).toISOString())}`),
    svc("cockpit_sales_attempts?select=contact_id,rep_email&state=in.(dialing,placed)"),
  ]);
  const extra = new Set<string>([
    ...states.filter(s => !s.closed || s.callback_at).map(s => String(s.contact_id)),
    ...inbox.map(i => String(i.contact_id ?? "")).filter(Boolean),
  ]);
  const leads = await svcAll(
    `cockpit_sales_leads?select=contact_id,name,phone,phone8,lead_created_at,stage_name,lead_class,dnd&lead_created_at=gte.${enc(since30)}&order=contact_id`,
  );
  const have = new Set(leads.map(l => String(l.contact_id)));
  const missing = [...extra].filter(id => !have.has(id)).slice(0, 150);
  if (missing.length)
    leads.push(
      ...(await svc(
        `cockpit_sales_leads?select=contact_id,name,phone,phone8,lead_created_at,stage_name,lead_class,dnd&contact_id=in.(${missing.map(enc).join(",")})`,
      )),
    );
  const [appts, dials, deals] = await Promise.all([
    svcAll(`cockpit_sales_calendar?select=contact_id,call_type,start_at,status,assigned_user_id&start_at=gte.${enc(since60)}&order=appointment_id`),
    svcAll(`cockpit_sales_dials?select=lead_phone8,occurred_at,state,direction&direction=eq.outbound&occurred_at=gte.${enc(since60)}&order=call_id`),
    svcAll("cockpit_sales_deals?select=contact_id&voided=eq.false&order=response_id"),
  ]);
  const stateBy = new Map(states.map(s => [String(s.contact_id), s]));
  const inboxBy = new Map<string, number>();
  for (const i of inbox) {
    const t = ms(i.last_message_at);
    const k = String(i.contact_id ?? "");
    if (k && t && (!inboxBy.has(k) || (inboxBy.get(k) ?? 0) < t)) inboxBy.set(k, t);
  }
  const claimBy = new Map(attempts.map(a => [String(a.contact_id), String(a.rep_email)]));
  const signed = new Set(deals.map(d => String(d.contact_id ?? "")).filter(Boolean));
  const apptBy = new Map<string, Row[]>();
  for (const a of appts) {
    const k = String(a.contact_id ?? "");
    if (!k) continue;
    apptBy.set(k, [...(apptBy.get(k) ?? []), a]);
  }
  const dialBy = new Map<string, { last: number; reached: boolean }>();
  for (const d of dials) {
    const k = String(d.lead_phone8 ?? "");
    const t = ms(d.occurred_at);
    if (!k || !t) continue;
    const cur = dialBy.get(k) ?? { last: 0, reached: false };
    dialBy.set(k, { last: Math.max(cur.last, t), reached: cur.reached || d.state === "completed" });
  }
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
    const dial = dialBy.get(String(l.phone8 ?? "")) ?? null;
    const inboundAt = inboxBy.get(id) ?? null;
    const closedAt = ms(st.closed_at);
    // A reply after the lead was closed opens them up again.
    const closed = st.closed && !(inboundAt && closedAt && inboundAt > closedAt) ? String(st.closed) : null;
    return {
      contact_id: id,
      name: (l.name as string) ?? null,
      phone: (l.phone as string) ?? null,
      phone8: (l.phone8 as string) ?? null,
      created_at: ms(l.lead_created_at),
      stage: (l.stage_name as string) ?? null,
      lead_class: (l.lead_class as string) ?? null,
      dnd: Boolean(l.dnd),
      last_dial_at: dial?.last || null,
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
    };
  });
  return { list };
}

async function dialQueue(who: Who, b: Row) {
  const now = Date.now();
  const { list } = await candidates(now);
  const as = String(b.as ?? (who.role === "closer" ? "closer" : "setter"));
  const me = String(who.email);
  const ranked =
    as === "closer"
      ? rankForCloser(
          list.filter(c => who.manager && !who.ghl_user_id ? true : c.demo_rep === who.ghl_user_id),
          me,
          now,
        )
      : rankForSetter(list, me, now);
  const counts = [0, 1, 2, 3].map(t => ranked.filter(r => r.tier === t).length);
  const open = (await svc(
    `cockpit_sales_attempts?select=*&rep_email=eq.${enc(me)}&state=in.(dialing,placed)&order=started_at.desc&limit=1`,
  ))[0] ?? null;
  return {
    as,
    counts,
    open,
    queue: ranked.slice(0, Math.min(50, Number(b.limit ?? 25))).map(r => ({
      contact_id: r.contact_id,
      name: r.name,
      phone: r.phone,
      stage: r.stage,
      lead_class: r.lead_class,
      tier: r.tier,
      why: r.why,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      last_dial_at: r.last_dial_at ? new Date(r.last_dial_at).toISOString() : null,
      due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
    })),
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
    `cockpit_sales_attempts?rep_email=eq.${enc(me)}&select=started_at&order=started_at.desc&limit=1`,
  ))[0];
  if (recent && Date.now() - Date.parse(String(recent.started_at)) < 12_000)
    throw new Refusal("Give it a few seconds between calls, then call again.", 429);

  await maqsamReady(maqsamEmail);

  let attempt: Row;
  try {
    attempt = (await svc("cockpit_sales_attempts", {
      method: "POST",
      body: { contact_id: contact, rep_email: me, maqsam_email: maqsamEmail, phone: r.route.digits, caller: r.route.caller },
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

async function dialSave(who: Who, b: Row) {
  const id = cleanText(b.attempt_id, 40);
  const outcome = String(b.outcome) as Outcome;
  if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new Refusal("Choose how the call went.");
  const note = cleanText(b.note, 4000);
  if (outcome !== "no_answer" && note.length < 3)
    throw new Refusal("Write a line on what happened, so the next person knows.");
  const a = (await svc(`cockpit_sales_attempts?id=eq.${enc(id)}&select=*`))[0];
  if (!a) throw new Refusal("That call is not there any more.", 404);
  if (!who.manager && a.rep_email !== who.email) throw new Refusal("That is another rep's call.", 403);
  if (!["dialing", "placed", "failed"].includes(String(a.state)))
    throw new Refusal("This call was already saved.", 409);
  let callbackAt: number | null = null;
  if (outcome === "callback") {
    callbackAt = b.callback_at ? Date.parse(String(b.callback_at)) : Number.NaN;
    if (!Number.isFinite(callbackAt) || callbackAt < Date.now() - 60_000 || callbackAt > Date.now() + 30 * 86_400_000)
      throw new Refusal("Pick when to call back, within the next 30 days.");
  }
  const now = Date.now();
  const st = (await svc(`cockpit_sales_queue_state?contact_id=eq.${enc(String(a.contact_id))}&select=*`))[0];
  const next = afterOutcome(outcome, Number(st?.step ?? 0), now, callbackAt);
  const saved = (await svc(`cockpit_sales_attempts?id=eq.${enc(id)}`, {
    method: "PATCH",
    body: {
      state: "saved",
      outcome,
      reason: cleanText(b.reason, 200) || null,
      note: note || null,
      callback_at: callbackAt ? new Date(callbackAt).toISOString() : null,
      saved_at: new Date(now).toISOString(),
    },
    prefer: "return=representation",
  }))[0];
  const state = {
    contact_id: a.contact_id,
    step: next.step,
    due_at: next.due ? new Date(next.due).toISOString() : null,
    callback_at: next.callback ? new Date(next.callback).toISOString() : null,
    callback_by: next.callback ? who.email : null,
    closed: next.closed,
    closed_at: next.closed ? new Date(now).toISOString() : null,
    last_outcome: outcome,
    last_outcome_at: new Date(now).toISOString(),
    last_rep: who.email,
    updated_at: new Date(now).toISOString(),
  };
  await svc("cockpit_sales_queue_state?on_conflict=contact_id", {
    method: "POST",
    body: state,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  // The dialer's rule: every outcome leaves a note in the CRM. Best effort.
  let crmNote = "skipped";
  if (outcome !== "no_answer" || note) {
    try {
      await ghl(
        "POST",
        `/contacts/${enc(String(a.contact_id))}/notes`,
        {
          body: `${OUTCOME_WORDS[outcome]} (call from the sales cockpit by ${String(who.name ?? who.email)})${note ? `: ${note}` : ""}${
            callbackAt ? `\nCall back ${new Date(callbackAt).toISOString()}` : ""
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
  await audit(who, "dial.save", "cockpit_sales_attempts", id, a, { ...saved, crm_note: crmNote }, { state });
  return { attempt: { ...saved, crm_note: crmNote }, state };
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
  "dial.queue": dialQueue,
  "dial.call": dialCall,
  "dial.save": dialSave,
  "dial.release": dialRelease,
};

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
  if (!handler) return reply({ ok: false, error: "Unknown action." }, 400);

  let who: Who;
  try {
    who = await whoami(jwt);
  } catch (e) {
    return reply({ ok: false, error: `The seat check failed: ${redact(String(e))}` }, 502);
  }
  if (!who.signed_in) return reply({ ok: false, error: "Sign in again." }, 401);
  if (!who.seat)
    return reply({ ok: false, error: "The sales cockpit is not on your access. Ask Aziz." }, 403);

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
