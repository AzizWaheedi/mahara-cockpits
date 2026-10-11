/**
 * The CSM calls worker's sources. Each one reads its provider in full, decides
 * what to store with the pure rules in match.ts, and returns its rows and its
 * health line. Nothing is written here unless ctx.apply is true.
 */
import {
  type Row,
  type Client,
  type Change,
  matchAppointment,
  appointmentKind,
  appointmentStatus,
  joinUrl,
  emailIndex,
  matchMeeting,
  titleKind,
  formAnswers,
  fieldTitles,
  recordingIn,
  nearestCheckin,
  changesForClient,
  isClientOf,
  isPersonChange,
  hashOf,
  kuwaitDay,
  tight,
} from "./match";
import { type Db, type Transport, type Health, ProviderError } from "./lib";

export const LOCATION = "wwG426bwruWWv9W3fazQ";
export const CLIENT_ID_FIELD = "Csj6vsVH3wSRseT3OkMU";
export const FORMS: Record<string, string> = {
  fRokTITH: "checkin",
  KFRCXPFx: "onboarding",
  tG7dnxBn: "kickoff",
  BbJy6xg4: "kickoff_old",
  oYZKtogO: "blueprint",
};
const TASK_REF = "c484f390-9695-4ffa-9693-9cc219592713";
const TRANSCRIPT_REF = "0773087f-beda-4e2c-bf50-acdac0dcbe05";
const DAY = 86_400_000;

export type Ctx = {
  db: Db;
  t: Transport;
  apply: boolean;
  now: number;
  clients: Client[];
  /** Reasons an item did not match, by "call:<id>" or "form:<token>". */
  reasons: Map<string, { reason: string; title?: string; at?: string; host?: string; hint?: string }>;
  /** Fathom share link → client, from the check-in form's typed transcript. */
  shareToTask: Map<string, string>;
  stateOf: (key: string) => Row | undefined;
  plan: Row;
};

const iso = (ms: number) => new Date(ms).toISOString();
const errText = (e: unknown) =>
  e instanceof ProviderError ? `${e.provider} ${e.status || "unreachable"}: ${e.message}` : String((e as Error)?.message ?? e).slice(0, 200);

/** The board's clients with every alias the media buyer side knows them by. */
export async function loadClients(db: Db): Promise<Client[]> {
  const rows = await db.all("cockpit_csm_sources", "select=data&table_name=eq.clients");
  const links = await db.all("cockpit_media_sources", "select=data&table_name=eq.clientLinks");
  const aliases = new Map<string, string[]>();
  for (const l of links) {
    const d = l.data ?? {};
    if (d.taskId) aliases.set(String(d.taskId), [...(aliases.get(String(d.taskId)) ?? []), d.name, ...(d.aliases ?? [])].filter(Boolean));
  }
  const out: Client[] = [];
  for (const r of rows) {
    const d = r.data ?? {};
    if (!d.taskId || !d.name) continue;
    out.push({ taskId: String(d.taskId), name: String(d.name), aliases: [...new Set(aliases.get(String(d.taskId)) ?? [])] });
  }
  if (out.length < 10) throw new Error(`Client roster has only ${out.length} rows; refusing to match against it`);
  return out;
}

/** Existing rows keyed by source_id so manual matches survive every rerun. */
async function existing(db: Db, source: string, extra = "") {
  const rows = await db.all("cockpit_csm_calls", `select=id,source_id,task_id,match_method,status,transcript_path&source=eq.${source}${extra}`);
  return new Map(rows.map(r => [String(r.source_id), r]));
}

export function keepManual(row: Row, prior: Row | undefined) {
  if (prior?.match_method === "manual") {
    row.task_id = prior.task_id;
    row.match_method = "manual";
    row.match_confidence = 1;
    // A manual assignment wins over the automatic appointment join too.
    // Otherwise the recording could appear on another client's timeline.
    row.linked_call_id = prior.linked_call_id ?? null;
  }
  return row;
}

// ---------------------------------------------------------------- GoHighLevel

export async function ghlSource(ctx: Ctx, from: number, to: number): Promise<Health> {
  const { t, db } = ctx;
  const cal = await t.ghl("calendars/", { locationId: LOCATION }, "2021-04-15");
  if (!Array.isArray(cal.calendars)) throw new Error("GoHighLevel calendar collection missing");
  const events = new Map<string, Row>();
  const perCalendar: Record<string, number> = {};
  for (const c of cal.calendars) {
    if (!c?.id) continue;
    for (let s = from; s < to; s += 7 * DAY) {
      const page = await t.ghl(
        "calendars/events",
        { locationId: LOCATION, calendarId: String(c.id), startTime: String(s), endTime: String(Math.min(s + 7 * DAY, to)) },
        "2021-04-15",
      );
      if (!Array.isArray(page.events)) throw new Error("GoHighLevel calendar window missing");
      for (const e of page.events) {
        if (!e?.id || !Number.isFinite(Date.parse(e.startTime))) throw new Error("GoHighLevel appointment identity or time missing");
        const at = Date.parse(e.startTime);
        // GHL sometimes returns an adjacent Kuwait day for a UTC window.
        if (at < from || at >= to) continue;
        events.set(String(e.id), { ...e, _calId: String(c.id), _calName: String(c.name ?? "") });
      }
    }
  }
  const contacts = new Map<string, Row>();
  for (const e of events.values()) {
    const id = String(e.contactId ?? "");
    if (!id || contacts.has(id)) continue;
    const r = await t.ghl(`contacts/${encodeURIComponent(id)}`, {}, "2021-07-28");
    const c = r?.contact;
    if (!c?.id) throw new Error("GoHighLevel appointment contact missing");
    contacts.set(id, {
      clientId: (c.customFields ?? []).find((f: Row) => f.id === CLIENT_ID_FIELD)?.value,
      email: String(c.email ?? "").toLowerCase(),
      name: String(c.contactName ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`).trim(),
      companyName: c.companyName,
    });
  }
  const valid = new Set(ctx.clients.map(c => c.taskId));
  const { emails } = emailIndex([...contacts.values()], valid);
  const prior = await existing(db, "ghl_appointment", `&starts_at=gte.${iso(from)}&starts_at=lt.${iso(to)}`);
  const rows: Row[] = [];
  let matched = 0;
  const byMethod: Record<string, number> = {};
  for (const e of events.values()) {
    const contact = contacts.get(String(e.contactId ?? ""));
    const m = matchAppointment(e, contact, ctx.clients, emails);
    const kind = appointmentKind(e._calId, e._calName);
    perCalendar[kind] = (perCalendar[kind] ?? 0) + 1;
    const row = keepManual(
      {
        source: "ghl_appointment",
        source_id: String(e.id),
        task_id: m.taskId ?? null,
        client_name: ctx.clients.find(c => c.taskId === m.taskId)?.name ?? null,
        match_method: m.method ?? null,
        match_confidence: m.confidence ?? null,
        kind,
        title: String(e.title ?? e._calName).slice(0, 300),
        starts_at: e.startTime,
        ends_at: Number.isFinite(Date.parse(e.endTime)) ? e.endTime : null,
        status: appointmentStatus(e.appointmentStatus ?? e.appoinmentStatus),
        provider_status: String(e.appointmentStatus ?? e.appoinmentStatus ?? "") || null,
        host_email: null,
        join_url: joinUrl(e.address) ?? null,
        external_invitees: contact?.email ? [{ email: contact.email, name: contact.name }] : [],
        updated_at: iso(ctx.now),
        raw_hash: hashOf([e, contact?.clientId]),
      },
      prior.get(String(e.id)),
    );
    if (row.task_id) {
      matched++;
      byMethod[row.match_method] = (byMethod[row.match_method] ?? 0) + 1;
    }
    rows.push(row);
  }
  // Read in full: anything stored in this window that GoHighLevel no longer returns is gone.
  const gone = [...prior.values()].filter(p => !events.has(String(p.source_id)) && p.status !== "gone");
  ctx.plan.ghl = { events: events.size, matched, byMethod, gone: gone.length, perCalendar };
  if (ctx.apply) {
    const back = await db.insertReturning("cockpit_csm_calls", rows, "source,source_id");
    const ids = new Map(back.map(b => [String(b.source_id), Number(b.id)]));
    for (const r of rows)
      if (!r.task_id) {
        const contact = contacts.get(String(events.get(r.source_id)?.contactId ?? ""));
        ctx.reasons.set(`call:${ids.get(r.source_id)}`, {
          reason: matchAppointment(events.get(r.source_id)!, contact, ctx.clients, emails).reason ?? "No match",
          title: r.title,
          at: r.starts_at,
          hint: contact?.companyName || contact?.name,
        });
      }
    for (const g of gone) await db.patch("cockpit_csm_calls", `id=eq.${g.id}`, { status: "gone", updated_at: iso(ctx.now) });
  }
  return {
    key: "csm-ghl-calls",
    ok: true,
    rows: events.size,
    note: `${events.size} appointments read (${Object.entries(perCalendar).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}) from ${kuwaitDay(from)} to ${kuwaitDay(to)}, ${matched} matched (${Object.entries(byMethod).map(([k, v]) => `${v} by ${k.replace(/_/g, " ")}`).join(", ") || "none"}), ${events.size - matched} unmatched, ${gone.length} gone.`,
    detail: { read: events.size, matched, unmatched: events.size - matched, upserted: rows.length, gone: gone.length, perCalendar, byMethod, window: [iso(from), iso(to)] },
  };
}

// ---------------------------------------------------------------- Typeform

async function allResponses(t: Transport, form: string) {
  const items: Row[] = [];
  let before: string | undefined;
  let total = 0;
  for (let page = 0; page < 50; page++) {
    const r = await t.typeform(`forms/${form}/responses`, { page_size: "1000", ...(before ? { before } : {}) });
    if (!Array.isArray(r.items) || !Number.isFinite(Number(r.total_items))) throw new Error(`Typeform ${form} collection incomplete`);
    if (page === 0) total = Number(r.total_items);
    items.push(...r.items);
    if (r.items.length < 1000) {
      if (items.length !== total) throw new Error(`Typeform ${form} returned ${items.length} of ${total} responses`);
      return { items, total };
    }
    const next = r.items.at(-1)?.token;
    if (!next || next === before) throw new Error(`Typeform ${form} pagination did not advance`);
    before = next;
  }
  throw new Error(`Typeform ${form} pagination incomplete`);
}

export async function typeformSource(ctx: Ctx): Promise<Health[]> {
  const { t, db } = ctx;
  const valid = new Set(ctx.clients.map(c => c.taskId));
  const priorForms = new Map(
    (await db.all("cockpit_csm_call_forms", "select=token,task_id,matched_by,linked_call_id")).map(r => [String(r.token), r]),
  );
  const out: Health[] = [];
  const formRows: Row[] = [];
  const counts: Record<string, Row> = {};
  const checkins: Row[] = [];
  for (const [form, kind] of Object.entries(FORMS)) {
    const definition = await t.typeform(`forms/${form}`);
    const titles = fieldTitles(definition);
    const { items, total } = await allResponses(t, form);
    let matched = 0;
    const bad: string[] = [];
    let newest = "";
    for (const item of items) {
      if (!item?.token || !Number.isFinite(Date.parse(item.submitted_at))) continue;
      const answers = formAnswers(item, titles);
      let task: string | null = null,
        by: string | null = null,
        typed: string | null = null;
      if (form === "fRokTITH") {
        typed = String((item.answers ?? []).find((a: Row) => a.field?.ref === TASK_REF)?.text ?? "").trim() || null;
        if (typed && valid.has(typed)) {
          task = typed;
          by = "typed_task_id";
        }
      } else {
        const hid = String(item.hidden?.onboarding_client_id ?? "").trim();
        if (hid && valid.has(hid)) {
          task = hid;
          by = "hidden_field";
        } else typed = hid || null;
      }
      const prior = priorForms.get(String(item.token));
      if (prior?.matched_by === "manual") {
        task = prior.task_id;
        by = "manual";
      }
      if (task) matched++;
      else if (form === "fRokTITH") bad.push(typed ?? "(blank)");
      if (item.submitted_at > newest) newest = item.submitted_at;
      const row: Row = {
        token: String(item.token),
        form_id: form,
        form_kind: kind,
        task_id: task,
        typed_client: typed,
        matched_by: by,
        submitted_at: item.submitted_at,
        answers,
        hidden: item.hidden ?? {},
        recording_url: recordingIn(answers) ?? null,
        updated_at: iso(ctx.now),
      };
      formRows.push(row);
      if (form === "fRokTITH") {
        const transcript = (item.answers ?? []).find((a: Row) => a.field?.ref === TRANSCRIPT_REF)?.text;
        checkins.push({ row, transcript: transcript ? String(transcript) : null });
        const share = /https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]+/.exec(String(transcript ?? ""))?.[0];
        if (share && task) ctx.shareToTask.set(share, task);
      }
    }
    counts[form] = { total, stored: items.length, matched, unmatched: items.length - matched, newest, bad: bad.slice(0, 10) };
  }
  ctx.plan.typeform = counts;

  // Link each 1-1 form to the client's check-in appointment within 48 h, else it is a held call of its own.
  const calls = (await db.all("cockpit_csm_calls", "select=id,task_id,kind,starts_at,status&source=eq.ghl_appointment&task_id=not.is.null"))
    .map(c => ({ id: Number(c.id), taskId: c.task_id, kind: c.kind, startsAt: Date.parse(c.starts_at), status: c.status }));
  const priorFormCalls = await existing(db, "checkin_form");
  const own: Row[] = [];
  let linked = 0;
  for (const { row, transcript } of checkins) {
    if (!row.task_id) continue;
    const appt = nearestCheckin(row.task_id, Date.parse(row.submitted_at), calls);
    if (appt) {
      row.linked_call_id = appt;
      linked++;
      continue;
    }
    own.push(
      keepManual(
        {
          source: "checkin_form",
          source_id: row.token,
          task_id: row.task_id,
          client_name: ctx.clients.find(c => c.taskId === row.task_id)?.name ?? null,
          match_method: row.matched_by === "manual" ? "manual" : "form_task_id",
          match_confidence: 1,
          kind: "checkin",
          title: "Check-in call (1-1 notes form)",
          starts_at: row.submitted_at,
          status: "held",
          provider_status: "form submitted",
          recording_url: /https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]+/.exec(transcript ?? "")?.[0] ?? row.recording_url,
          transcript_text: transcript,
          updated_at: iso(ctx.now),
          raw_hash: hashOf(row.answers),
        },
        priorFormCalls.get(row.token),
      ),
    );
  }
  if (ctx.apply) {
    await db.upsert("cockpit_csm_call_forms", formRows.map(({ linked_call_id, ...r }) => r), "token");
    if (own.length) {
      const back = await db.insertReturning("cockpit_csm_calls", own, "source,source_id");
      for (const b of back) await db.patch("cockpit_csm_call_forms", `token=eq.${encodeURIComponent(b.source_id)}`, { linked_call_id: b.id });
    }
    for (const { row } of checkins)
      if (row.linked_call_id) {
        await db.patch("cockpit_csm_call_forms", `token=eq.${encodeURIComponent(row.token)}`, { linked_call_id: row.linked_call_id });
        const stale = priorFormCalls.get(row.token);
        if (stale && stale.status !== "gone")
          await db.patch("cockpit_csm_calls", `id=eq.${stale.id}`, { status: "gone", linked_call_id: row.linked_call_id, updated_at: iso(ctx.now) });
      }
    for (const r of formRows)
      if (!r.task_id && r.form_id === "fRokTITH")
        ctx.reasons.set(`form:${r.token}`, {
          reason: r.typed_client ? `Typed client ID "${String(r.typed_client).slice(0, 30)}" is not a client on the board` : "No client ID typed",
          title: "1-1 call notes form",
          at: r.submitted_at,
        });
  }
  const ck = counts.fRokTITH;
  out.push({
    key: "csm-checkin-form",
    ok: true,
    rows: ck.stored,
    note: `${ck.stored} of ${ck.total} 1-1 forms stored, ${ck.matched} matched to a client (${linked} linked to a booked check-in, ${own.length} on their own), ${ck.unmatched} with a typed ID that is not a client. Newest ${String(ck.newest).slice(0, 10)}.`,
    detail: { ...ck, linked, ownCalls: own.length },
  });
  const others = Object.entries(counts).filter(([f]) => f !== "fRokTITH");
  out.push({
    key: "csm-forms-history",
    ok: true,
    rows: others.reduce((n, [, c]) => n + c.stored, 0),
    note: others.map(([f, c]) => `${FORMS[f]} ${c.stored}/${c.total} (${c.matched} matched)`).join(", ") + ".",
    detail: Object.fromEntries(others),
  });
  return out;
}

// ---------------------------------------------------------------- Fathom

function transcriptText(lines: unknown): string | undefined {
  if (!Array.isArray(lines) || !lines.length) return undefined;
  return lines
    .map((l: Row) => `[${l.timestamp ?? ""}] ${l.speaker?.display_name ?? "Speaker"}: ${l.text ?? ""}`)
    .join("\n");
}

export async function fathomSource(ctx: Ctx, since: string, transcriptsPerRun = 8): Promise<Health> {
  const { t, db } = ctx;
  const meetings: Row[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 200) throw new Error("Fathom pagination incomplete");
    const p = new URLSearchParams({ created_after: since, include_summary: "true" });
    if (cursor) p.set("cursor", cursor);
    const body = await t.fathom(p);
    if (!Array.isArray(body.items)) throw new Error("Fathom meeting collection missing");
    meetings.push(...body.items);
    if (!body.next_cursor) break;
    if (body.next_cursor === cursor) throw new Error("Fathom pagination did not advance");
    cursor = body.next_cursor;
  }
  const sales = new Set((await db.all("cockpit_sales_recordings", "select=recording_id")).map(r => String(r.recording_id)));
  const apptRows = await db.all("cockpit_csm_calls", "select=id,task_id,starts_at,external_invitees,kind&source=eq.ghl_appointment&task_id=not.is.null");
  const appts = apptRows.map(a => ({
    id: Number(a.id),
    taskId: a.task_id,
    startsAt: Date.parse(a.starts_at),
    emails: (a.external_invitees ?? []).map((i: Row) => String(i.email ?? "").toLowerCase()).filter(Boolean),
    kind: a.kind,
  }));
  const contactsIndex = emailIndex(
    apptRows.flatMap(a => (a.external_invitees ?? []).map((i: Row) => ({ email: i.email, clientId: a.task_id }))),
    new Set(ctx.clients.map(c => c.taskId)),
  );
  const raw: Row[] = [];
  const calls: Row[] = [];
  const prior = await existing(db, "fathom");
  const byRecorder: Record<string, number> = {};
  let external = 0,
    matched = 0,
    internal = 0;
  const handle = (m: Row) => {
    const ext = (m.calendar_invitees ?? []).some((i: Row) => i.is_external);
    const rid = String(m.recording_id);
    const start = m.recording_start_time ?? m.scheduled_start_time ?? m.created_at;
    const { transcript, ...rest } = m;
    return { ext, rid, start, rest };
  };
  for (const m of meetings) {
    if (!m?.recording_id) continue;
    const { ext, rid, start, rest } = handle(m);
    const email = String(m.recorded_by?.email ?? "").toLowerCase();
    byRecorder[email || "?"] = (byRecorder[email || "?"] ?? 0) + 1;
    raw.push({
      recording_id: rid,
      title: m.title ?? m.meeting_title ?? null,
      starts_at: start ?? null,
      ends_at: m.recording_end_time ?? m.scheduled_end_time ?? null,
      recorded_by_email: email || null,
      recorded_by_name: m.recorded_by?.name ?? null,
      external: ext,
      invitees: m.calendar_invitees ?? [],
      url: m.url ?? null,
      share_url: m.share_url ?? null,
      summary: ext ? (m.default_summary?.markdown_formatted ?? null) : null,
      raw: ext ? rest : { ...rest, default_summary: null, action_items: null, highlights: null },
      updated_at: iso(ctx.now),
    });
    if (!ext) {
      internal++;
      continue;
    }
    if (sales.has(rid)) continue;
    external++;
    const mt = matchMeeting(m, appts, ctx.clients, contactsIndex, ctx.shareToTask);
    if (mt.taskId) matched++;
    const appt = appts.find(a => a.id === mt.apptId);
    calls.push(
      keepManual(
        {
          source: "fathom",
          source_id: rid,
          task_id: mt.taskId ?? null,
          client_name: ctx.clients.find(c => c.taskId === mt.taskId)?.name ?? null,
          match_method: mt.method ?? null,
          match_confidence: mt.confidence ?? null,
          kind: appt?.kind ?? titleKind(m.title ?? m.meeting_title),
          title: String(m.title ?? m.meeting_title ?? "Recorded call").slice(0, 300),
          starts_at: start,
          ends_at: m.recording_end_time ?? null,
          status: "held",
          provider_status: "recorded",
          host_email: email || null,
          host_name: m.recorded_by?.name ?? null,
          recording_url: m.url ?? m.share_url ?? null,
          summary: m.default_summary?.markdown_formatted ?? null,
          external_invitees: (m.calendar_invitees ?? []).filter((i: Row) => i.is_external).map((i: Row) => ({ email: i.email, name: i.name })),
          linked_call_id: mt.apptId ?? null,
          updated_at: iso(ctx.now),
          raw_hash: hashOf([rid, m.default_summary?.markdown_formatted ?? ""]),
        },
        prior.get(rid),
      ),
    );
    if (!mt.taskId) ctx.reasons.set(`fathom:${rid}`, { reason: mt.reason ?? "No match", title: m.title, at: start, host: email });
  }
  // Re-match every stored meeting still without a client (the appointment or form may have arrived since).
  const open = [...prior.values()].filter(p => !p.task_id && p.match_method !== "manual" && !calls.some(c => c.source_id === p.source_id));
  let rematched = 0;
  if (open.length) {
    const stored = await db.all("cockpit_fathom_meetings", `select=recording_id,raw,share_url&recording_id=in.(${open.map(o => o.source_id).join(",")})`);
    for (const s of stored) {
      const m = { ...s.raw, share_url: s.share_url };
      const mt = matchMeeting(m, appts, ctx.clients, contactsIndex, ctx.shareToTask);
      const p = prior.get(String(s.recording_id))!;
      if (mt.taskId) {
        rematched++;
        if (ctx.apply)
          await db.patch("cockpit_csm_calls", `id=eq.${p.id}`, {
            task_id: mt.taskId,
            client_name: ctx.clients.find(c => c.taskId === mt.taskId)?.name ?? null,
            match_method: mt.method,
            match_confidence: mt.confidence,
            linked_call_id: mt.apptId ?? null,
            updated_at: iso(ctx.now),
          });
      } else ctx.reasons.set(`fathom:${s.recording_id}`, { reason: mt.reason ?? "No match", title: m.title, at: m.recording_start_time, host: m.recorded_by?.email });
    }
  }
  ctx.plan.fathom = { read: meetings.length, external, internal, matched, rematched, byRecorder, since };
  let transcripts = 0;
  if (ctx.apply) {
    await db.upsert("cockpit_fathom_meetings", raw, "recording_id");
    const back = calls.length ? await db.insertReturning("cockpit_csm_calls", calls, "source,source_id") : [];
    const ids = new Map(back.map(b => [String(b.source_id), Number(b.id)]));
    for (const [k, v] of [...ctx.reasons]) {
      if (!k.startsWith("fathom:")) continue;
      const rid = k.slice(7);
      const id = ids.get(rid) ?? prior.get(rid)?.id;
      ctx.reasons.delete(k);
      if (id) ctx.reasons.set(`call:${id}`, v);
    }
    // An imported legacy row for the same recording now belongs under the Fathom row.
    for (const c of calls)
      if (c.recording_url && ids.get(c.source_id))
        await db.patch("cockpit_csm_calls", `source=eq.imported&recording_url=eq.${encodeURIComponent(c.recording_url)}&status=neq.gone`, {
          status: "gone",
          linked_call_id: ids.get(c.source_id),
          updated_at: iso(ctx.now),
        });
    // Transcripts once per recording, for client calls only, bounded per run.
    const missing = await db.all("cockpit_csm_calls", "select=id,source_id,starts_at&source=eq.fathom&transcript_path=is.null&status=neq.gone&order=starts_at.desc");
    for (const mrow of missing.slice(0, transcriptsPerRun)) {
      const stored = (await db.all("cockpit_fathom_meetings", `select=raw&recording_id=eq.${mrow.source_id}`))[0];
      const created = Date.parse(stored?.raw?.created_at ?? "");
      if (!Number.isFinite(created)) continue;
      const p = new URLSearchParams({ created_after: iso(created - 1000), created_before: iso(created + 1000), include_transcript: "true" });
      const body = await t.fathom(p);
      const hit = (body.items ?? []).find((x: Row) => String(x.recording_id) === String(mrow.source_id));
      const text = transcriptText(hit?.transcript);
      if (!text) continue;
      const path = `fathom/${mrow.source_id}.txt`;
      await db.storage(path, text);
      await db.patch("cockpit_fathom_meetings", `recording_id=eq.${mrow.source_id}`, { transcript_path: path });
      await db.patch("cockpit_csm_calls", `id=eq.${mrow.id}`, { transcript_path: path, transcript_text: text.slice(0, 200_000) });
      transcripts++;
    }
  }
  return {
    key: "csm-fathom",
    ok: true,
    rows: meetings.length,
    note: `${meetings.length} Fathom meetings read since ${since.slice(0, 10)} (${Object.entries(byRecorder).map(([k, v]) => `${k.split("@")[0]} ${v}`).join(", ")}), ${external} with a client-side invitee outside sales, ${matched} matched, ${rematched} matched on a later run, ${transcripts} transcripts stored. Private recordings remain invisible unless shared with this key.`,
    detail: { read: meetings.length, external, internal, matched, rematched, transcripts, byRecorder, since },
  };
}

// ---------------------------------------------------------------- Meta activities

export async function metaSource(ctx: Ctx, sinceMs: number): Promise<Health> {
  const { t, db } = ctx;
  const accounts = new Map<string, string>(); // account id → task id
  for (const c of await db.all("clients", "select=name,meta_ad_account_id&is_active=eq.true&meta_ad_account_id=not.is.null")) {
    const card = ctx.clients.find(k => isClientOf(c.name, k));
    if (card) accounts.set(String(c.meta_ad_account_id).replace(/^act_/, ""), card.taskId);
  }
  for (const c of await db.all("cockpit_campaigns", "select=client_name,meta_account_id&source_deleted=is.false")) {
    const card = ctx.clients.find(k => isClientOf(c.client_name, k));
    if (card && c.meta_account_id) accounts.set(String(c.meta_account_id).replace(/^act_/, ""), card.taskId);
  }
  const rows: Row[] = [];
  const failed: string[] = [];
  let read = 0;
  for (const [acct, task] of accounts) {
    try {
      let page = await t.meta(`act_${acct}/activities`, {
        fields: "event_time,event_type,translated_event_type,actor_name,object_id,object_name,object_type,extra_data",
        since: String(Math.floor(sinceMs / 1000)),
        limit: "200",
      });
      for (let n = 0; ; n++) {
        if (!Array.isArray(page.data)) throw new Error("Meta activity collection missing");
        for (const e of page.data) {
          read++;
          if (!isPersonChange(e)) continue;
          rows.push({
            account_id: acct,
            event_time: e.event_time,
            object_id: String(e.object_id ?? ""),
            event_type: String(e.event_type),
            actor_name: e.actor_name ?? null,
            object_name: e.object_name ?? null,
            object_type: e.object_type ?? null,
            translated_event_type: e.translated_event_type ?? null,
            extra_data: typeof e.extra_data === "string" ? (() => { try { return JSON.parse(e.extra_data); } catch { return { text: e.extra_data }; } })() : (e.extra_data ?? null),
            task_id: task,
          });
        }
        if (!page.paging?.next) break;
        // Never call a capped read complete: rows read so far are kept, the account fails and the window is retried.
        if (n >= 30) throw new Error("Meta activity cursor unfinished after 31 pages");
        page = await t.metaNext(page.paging.next);
      }
    } catch (e) {
      failed.push(`${acct.slice(-4)}: ${errText(e).slice(0, 80)}`);
    }
  }
  const seen = new Set<string>();
  const unique = rows.filter(r => {
    const k = [r.account_id, r.event_time, r.object_id, r.event_type].join("|");
    return seen.has(k) ? false : (seen.add(k), true);
  });
  ctx.plan.meta = { accounts: accounts.size, read, personChanges: unique.length, failed };
  if (ctx.apply && unique.length) await db.upsert("cockpit_csm_meta_activities", unique, "account_id,event_time,object_id,event_type");
  const allFailed = accounts.size > 0 && failed.length === accounts.size;
  return {
    key: "csm-meta-activities",
    // One refused account means the source is partial. Keep successful rows, but alert.
    ok: accounts.size > 0 && failed.length === 0,
    rows: unique.length,
    note: allFailed
      ? `Meta refused the activity read on all ${accounts.size} ad accounts: ${failed[0]}`
      : `${accounts.size} ad accounts read since ${kuwaitDay(sinceMs)}, ${read} events, ${unique.length} changes made by a person.${failed.length ? ` ${failed.length} accounts failed: ${failed.slice(0, 3).join("; ")}` : ""}`,
    detail: { accounts: accounts.size, read, personChanges: unique.length, failed },
  };
}

// ---------------------------------------------------------------- Media buyer changes

export async function changesSource(ctx: Ctx): Promise<Health> {
  const { db } = ctx;
  const since = iso(ctx.now - 90 * DAY);
  const campaignsOf = new Map<string, Set<string>>();
  const add = (client: unknown, campaign: unknown) => {
    if (!campaign) return;
    const card = ctx.clients.find(k => isClientOf(client, k));
    if (card) campaignsOf.set(card.taskId, (campaignsOf.get(card.taskId) ?? new Set()).add(String(campaign)));
  };
  for (const c of await db.all("cockpit_campaigns", "select=client_name,raw_data")) add(c.client_name, c.raw_data?.campaignName ?? c.raw_data?.name);
  for (const c of await db.all("cockpit_media_sources", "select=data&table_name=in.(offBoardCampaigns,boardCards)"))
    add(c.data?.clientName ?? c.data?.tag, c.data?.campaignName ?? c.data?.name);
  const all: Change[] = [];
  const newest: Record<string, string> = {};
  const note = (src: string, at: number) => {
    if (Number.isFinite(at) && (!newest[src] || iso(at) > newest[src])) newest[src] = iso(at);
  };
  for (const d of await db.all("cockpit_decisions", `select=id,subject,action,kind,evidence,day,created_at,clickup_task_url&role=eq.media_buyer&created_at=gte.${since}`)) {
    const at = Date.parse(d.created_at);
    note("decision", at);
    all.push({ key: `decision:${d.id}`, subject: d.subject, action: d.action, kind: d.kind ?? "decision", evidence: d.evidence, source: "decision", at, link: d.clickup_task_url ?? undefined });
  }
  for (const a of await db.all("cockpit_media_actions", `select=id,operation,campaign_name,request,state,created_at&operation=not.like.ceo.*&created_at=gte.${since}`)) {
    if (a.state && !/confirm|done|applied|ok/i.test(a.state)) continue;
    const at = Date.parse(a.created_at);
    note("media_action", at);
    const what = String(a.request?.summary ?? a.request?.what ?? a.operation).replace(/[._]/g, " ");
    all.push({ key: `action:${a.id}`, subject: a.campaign_name ?? "", action: what, kind: a.operation, source: "media_action", at });
  }
  for (const m of await db.all("cockpit_campaign_action_messages", `select=id,campaign_name,text,at&at=gte.${since}`)) {
    const at = Date.parse(m.at);
    note("campaign_message", at);
    all.push({ key: `msg:${m.id}`, subject: m.campaign_name, action: m.text, kind: "note", source: "campaign_message", at });
  }
  for (const r of await db.all("cockpit_media_native_records", `select=id,kind,client_name,campaign_name,data,created_at&kind=eq.manual&created_at=gte.${since}`)) {
    const at = Date.parse(r.created_at);
    note("native_manual", at);
    all.push({ key: `native:${r.id}`, subject: r.campaign_name ?? r.client_name ?? "", action: String(r.data?.what ?? r.data?.text ?? "Manual change"), kind: "manual", source: "native_manual", at });
  }
  for (const m of await db.all("cockpit_media_sources", "select=data&table_name=eq.manualChanges")) {
    const d = m.data ?? {};
    const at = Number(d.at);
    if (!Number.isFinite(at) || at < ctx.now - 90 * DAY) continue;
    note("legacy_manual", at);
    all.push({ key: `legacy:${d._id}`, subject: d.campaignName ?? "", action: String(d.what ?? ""), kind: "manual", evidence: d.adName, actor: d.by === "cockpit" ? "the media buyer" : d.by, source: "legacy_manual", at });
  }
  for (const e of await db.all("cockpit_csm_meta_activities", `select=account_id,event_time,object_id,event_type,translated_event_type,actor_name,object_name,task_id&event_time=gte.${since}`)) {
    const at = Date.parse(e.event_time);
    note("meta_activity", at);
    all.push({
      key: `meta:${e.account_id}:${e.event_time}:${e.object_id}:${e.event_type}`,
      subject: e.object_name ?? "",
      action: e.translated_event_type ?? String(e.event_type).replace(/_/g, " "),
      kind: e.event_type,
      evidence: e.object_name,
      actor: e.actor_name,
      source: "meta_activity",
      at,
      taskId: e.task_id,
    });
  }
  const rows: Row[] = [];
  let clientsWith = 0;
  for (const client of ctx.clients) {
    const list = changesForClient(all, client, [...(campaignsOf.get(client.taskId) ?? [])], ctx.now);
    if (list.length) clientsWith++;
    for (const c of list)
      rows.push({ task_id: client.taskId, change_key: c.key, day: c.day, at: iso(c.at), kind: String(c.kind).slice(0, 80), action: String(c.action).slice(0, 500), evidence: c.evidence ? String(c.evidence).slice(0, 300) : null, actor: c.actor ?? null, source: c.source, subject: c.subject ? String(c.subject).slice(0, 200) : null, link: c.link ?? null });
  }
  ctx.plan.changes = { items: all.length, rows: rows.length, clientsWith, newest };
  if (ctx.apply && rows.length) await db.upsert("cockpit_csm_changes", rows, "task_id,change_key");
  const metaState = ctx.stateOf("csm-meta-activities");
  const stale = !newest.meta_activity || Date.parse(newest.meta_activity) < ctx.now - 3 * DAY;
  return {
    key: "csm-media-changes",
    ok: true,
    rows: rows.length,
    note:
      `${all.length} changes in 90 days, ${rows.length} placed on ${clientsWith} clients. Newest: ${Object.entries(newest).map(([k, v]) => `${k.replace(/_/g, " ")} ${v.slice(0, 10)}`).join(", ") || "none"}.` +
      (stale ? ` Meta activity is stale${metaState?.ok === false ? `: ${String(metaState.note ?? "").slice(0, 120)}` : ""}.` : ""),
    detail: { items: all.length, rows: rows.length, clientsWith, newest, metaStale: stale },
  };
}

// ---------------------------------------------------------------- Unmatched queue

export async function unmatchedQueue(ctx: Ctx) {
  const { db } = ctx;
  const open = await db.all("cockpit_csm_unmatched", "select=id,item_kind,item_ref&resolved_at=is.null");
  const rows: Row[] = [];
  for (const [k, v] of ctx.reasons) {
    const [kind, ref] = [k.split(":")[0], k.slice(k.indexOf(":") + 1)];
    if (kind !== "call" && kind !== "form") continue;
    rows.push({ item_kind: kind, item_ref: ref, title: v.title ?? null, at: v.at ?? null, reason: v.reason, hint: v.hint ?? null, host_email: v.host ?? null, updated_at: iso(ctx.now) });
  }
  // Anything open that now has a client is resolved by the worker.
  const matchedCalls = new Set(
    (await db.all("cockpit_csm_calls", "select=id&task_id=not.is.null")).map(r => String(r.id)),
  );
  const matchedForms = new Set((await db.all("cockpit_csm_call_forms", "select=token&task_id=not.is.null")).map(r => String(r.token)));
  const resolved = open.filter(o => (o.item_kind === "call" ? matchedCalls.has(String(o.item_ref)) : matchedForms.has(String(o.item_ref))));
  if (ctx.apply) {
    if (rows.length) await db.upsert("cockpit_csm_unmatched", rows, "item_kind,item_ref");
    for (const r of resolved)
      await db.patch("cockpit_csm_unmatched", `id=eq.${r.id}`, { resolved_by: "worker re-match", resolved_at: iso(ctx.now), updated_at: iso(ctx.now) });
  }
  return { open: rows.length, resolved: resolved.length };
}

// ---------------------------------------------------------------- Seed (one-off)

export async function seed(ctx: Ctx) {
  const { db } = ctx;
  const profiles = await db.all("cockpit_csm_sources", "select=data&table_name=eq.clientProfiles");
  const rows: Row[] = [];
  for (const p of profiles)
    for (const c of p.data?.calls ?? []) {
      if (c.kind && c.kind !== "client") continue; // team meetings that mention a client are not client calls
      const card = ctx.clients.find(k => tight(k.name) === tight(p.data?.clientName));
      if (!card || !c.at) continue;
      rows.push({
        source: "imported",
        source_id: `url:${c.url ?? hashOf([c.title, c.at])}`.slice(0, 200),
        task_id: card.taskId,
        client_name: card.name,
        match_method: "imported",
        match_confidence: 0.8,
        kind: titleKind(c.title),
        title: String(c.title ?? "Recorded call").slice(0, 300),
        starts_at: c.at,
        status: "held",
        provider_status: "imported from the cutover",
        host_name: c.host ?? null,
        recording_url: c.url ?? null,
        summary: c.summary ?? null,
        updated_at: iso(ctx.now),
      });
    }
  const d28 = (await db.all("cockpit_decisions", "select=id,day,created_at,evidence&id=eq.28"))[0];
  if (d28)
    rows.push({
      source: "manual",
      source_id: "decision:28",
      task_id: "86ey2em6q",
      client_name: ctx.clients.find(k => k.taskId === "86ey2em6q")?.name ?? null,
      match_method: "manual",
      match_confidence: 1,
      kind: "checkin",
      title: "Held a call (logged in the cockpit)",
      starts_at: d28.created_at,
      status: "held",
      provider_status: "logged",
      summary: d28.evidence ?? null,
      updated_at: iso(ctx.now),
    });
  ctx.plan.seed = { rows: rows.length };
  if (ctx.apply && rows.length) await db.upsert("cockpit_csm_calls", rows, "source,source_id");
  return rows.length;
}

// ---------------------------------------------------------------- Daily reconciliation

export async function reconcile(ctx: Ctx): Promise<Health> {
  const { t, db } = ctx;
  const day = kuwaitDay(ctx.now - DAY);
  const from = Date.parse(`${day}T00:00:00+03:00`),
    to = from + DAY;
  const issues: string[] = [];
  const out: Row = { day };
  // GoHighLevel appointments per calendar vs stored.
  const cal = await t.ghl("calendars/", { locationId: LOCATION }, "2021-04-15");
  const ids: string[] = [];
  for (const c of cal.calendars ?? []) {
    const page = await t.ghl("calendars/events", { locationId: LOCATION, calendarId: String(c.id), startTime: String(from), endTime: String(to) }, "2021-04-15");
    for (const e of page.events ?? []) {
      const at = Date.parse(e.startTime);
      if (!Number.isFinite(at)) throw new Error(`GoHighLevel ${c.id} returned a call without a valid start time`);
      if (at >= from && at < to) ids.push(String(e.id));
    }
  }
  const stored = new Set((await db.all("cockpit_csm_calls", `select=source_id&source=eq.ghl_appointment&starts_at=gte.${iso(from)}&starts_at=lt.${iso(to)}`)).map(r => String(r.source_id)));
  const missingGhl = ids.filter(i => !stored.has(i));
  out.ghl = { source: ids.length, stored: stored.size, missing: missingGhl };
  if (missingGhl.length) issues.push(`GoHighLevel: ${missingGhl.length} appointments not stored (${missingGhl.slice(0, 5).join(", ")})`);
  // Fathom meetings created yesterday vs stored.
  const fm: string[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 50; n++) {
    const p = new URLSearchParams({ created_after: iso(from), created_before: iso(to) });
    if (cursor) p.set("cursor", cursor);
    const b = await t.fathom(p);
    for (const m of b.items ?? []) fm.push(String(m.recording_id));
    if (!b.next_cursor || b.next_cursor === cursor) break;
    cursor = b.next_cursor;
  }
  const fs = fm.length ? new Set((await db.all("cockpit_fathom_meetings", `select=recording_id&recording_id=in.(${fm.join(",")})`)).map(r => String(r.recording_id))) : new Set<string>();
  const missingF = fm.filter(i => !fs.has(i));
  out.fathom = { source: fm.length, stored: fs.size, missing: missingF };
  if (missingF.length) issues.push(`Fathom: ${missingF.length} meetings not stored (${missingF.slice(0, 5).join(", ")})`);
  // Form totals vs stored.
  out.forms = {};
  for (const form of Object.keys(FORMS)) {
    const r = await t.typeform(`forms/${form}/responses`, { page_size: "1" });
    const total = Number(r.total_items);
    const have = (await db.all("cockpit_csm_call_forms", `select=token&form_id=eq.${form}`)).length;
    out.forms[form] = { source: total, stored: have };
    if (Number.isFinite(total) && have < total) issues.push(`Typeform ${form}: ${total - have} responses not stored`);
  }
  // Meta: independent source-against-store check for yesterday, per account.
  // An account returning 403 or an unfinished cursor is a mismatch, not zero.
  const accountRows = await db.all("cockpit_csm_meta_activities", "select=account_id");
  const accountIds = [...new Set(accountRows.map(r => String(r.account_id)).filter(Boolean))];
  const storedMeta = await db.all("cockpit_csm_meta_activities", `select=account_id,event_time,object_id,event_type&event_time=gte.${iso(from)}&event_time=lt.${iso(to)}`);
  const storedMetaKeys = new Set(storedMeta.map(r => [r.account_id, String(Date.parse(r.event_time)), r.object_id, r.event_type].join("|")));
  const missingMeta: string[] = [];
  const failedMeta: string[] = [];
  let sourceMeta = 0;
  for (const accountId of accountIds) {
    try {
      let page = await t.meta(`act_${accountId}/activities`, {
        fields: "event_time,event_type,actor_name,object_id,object_name,object_type,extra_data",
        since: String(Math.floor(from / 1000)),
        until: String(Math.floor(to / 1000)),
        limit: "200",
      });
      for (let n = 0; ; n++) {
        if (!Array.isArray(page.data)) throw Error("activity collection missing");
        for (const e of page.data) {
          const at = Date.parse(e.event_time);
          if (!Number.isFinite(at) || at < from || at >= to || !isPersonChange(e)) continue;
          sourceMeta++;
          const k = [accountId, String(at), String(e.object_id ?? ""), String(e.event_type)].join("|");
          if (!storedMetaKeys.has(k)) missingMeta.push(k);
        }
        if (!page.paging?.next) break;
        if (n >= 30) throw Error("activity pagination incomplete");
        page = await t.metaNext(page.paging.next);
      }
    } catch (e) {
      failedMeta.push(`${accountId.slice(-4)}: ${errText(e).slice(0, 60)}`);
    }
  }
  out.meta = { accounts: accountIds.length, source: sourceMeta, stored: storedMeta.length, missing: missingMeta, failed: failedMeta };
  if (missingMeta.length || failedMeta.length)
    issues.push(`Meta: ${missingMeta.length} events not stored, ${failedMeta.length} accounts unreadable (${[...missingMeta.slice(0, 3), ...failedMeta.slice(0, 3)].join(", ")})`);

  const unmatched = (await db.all("cockpit_csm_unmatched", "select=id&resolved_at=is.null")).length;
  const yCalls = (await db.all("cockpit_csm_calls", `select=id&starts_at=gte.${iso(from)}&starts_at=lt.${iso(to)}&status=neq.gone`)).length;
  out.summary = { callsYesterday: yCalls, unmatched };
  return {
    key: "csm-reconcile",
    ok: issues.length === 0,
    rows: yCalls,
    note: issues.length
      ? `${day}: ${issues.join("; ")}`.slice(0, 500)
      : `${day}: ${yCalls} calls stored, sources match (GoHighLevel ${ids.length}, Fathom ${fm.length}, forms complete). ${unmatched} items wait in the unmatched queue.`,
    detail: out,
  };
}
