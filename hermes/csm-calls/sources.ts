/**
 * The CSM calls worker's sources. Each one reads its provider in full, decides
 * what to store with the pure rules in match.ts, fathomRules.ts and callMatch.ts,
 * and returns its rows and its health line. Nothing is written here unless
 * ctx.apply is true.
 */
import {
  type Booking,
  type ClientRef,
  type Ctx as MatchCtx,
  type Recording,
  exactMatch,
  normalizeRoom,
  suggestionsFor,
} from "./callMatch.ts";
import {
  CS_TEAM,
  type FathomMeeting,
  type MeetingClass,
  callRowBase,
  classifyMeeting,
  meetingRow,
  speakers,
  transcriptText,
} from "./fathomRules.ts";
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
  checkinClient,
  recordingIn,
  nearestCheckin,
  changesForClient,
  isClientOf,
  isPersonChange,
  STOPPED_STAGE,
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
const TRANSCRIPT_REF = "0773087f-beda-4e2c-bf50-acdac0dcbe05";
/** A Fathom share link as the 1-1 form carries it. */
const SHARE = /https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]+/;
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
    out.push({
      taskId: String(d.taskId),
      name: String(d.name),
      aliases: [...new Set(aliases.get(String(d.taskId)) ?? [])],
      stopped: STOPPED_STAGE.test(String(d.stage ?? "")),
    });
  }
  if (out.length < 10) throw new Error(`Client roster has only ${out.length} rows; refusing to match against it`);
  return out;
}

/** Existing rows keyed by source_id so manual matches survive every rerun (with the name a person placed). */
async function existing(db: Db, source: string, extra = "", columns = "") {
  const rows = await db.all("cockpit_csm_calls", `select=id,source_id,task_id,client_name,match_method,status,transcript_path${columns}&source=eq.${source}${extra}`);
  return new Map(rows.map(r => [String(r.source_id), r]));
}

/** A select over an in.() list, in slices so no URL grows past a few kilobytes. */
async function allIn(db: Db, table: string, select: string, column: string, values: string[], extra = ""): Promise<Row[]> {
  const out: Row[] = [];
  const list = [...new Set(values)];
  for (let i = 0; i < list.length; i += 100)
    out.push(...(await db.all(table, `select=${select}&${column}=in.(${list.slice(i, i + 100).join(",")})${extra}`)));
  return out;
}

/**
 * A person's match survives the rerun: its client, its name, its method and its booking link. The name is
 * the clients list's for that client, else the one stored with the match (a client that has left the list),
 * never the automatic match's, so the worker never blanks the name a person placed or gives it another
 * client's (contract A7.13).
 */
export function keepManual(row: Row, prior: Row | undefined, clients: readonly Client[] = []) {
  if (prior?.match_method === "manual") {
    row.task_id = prior.task_id;
    row.client_name = clients.find(c => c.taskId === String(prior.task_id))?.name || prior.client_name || null;
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
        // The room its link opens: a recording in the same room near the booking is its call.
        room: normalizeRoom(joinUrl(e.address)),
        external_invitees: contact?.email ? [{ email: contact.email, name: contact.name }] : [],
        updated_at: iso(ctx.now),
        raw_hash: hashOf([e, contact?.clientId]),
      },
      prior.get(String(e.id)),
      ctx.clients,
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

/** The stored Fathom call row (not gone) of each share link, through cockpit_fathom_meetings.share_url. */
async function recordingsByLink(db: Db, links: string[]) {
  const out = new Map<string, { id: number; taskId: string | null; linkedCallId: number | null }>();
  const list = [...new Set(links)];
  const meetings: Row[] = [];
  for (let i = 0; i < list.length; i += 50) {
    const quoted = list.slice(i, i + 50).map(l => `%22${encodeURIComponent(l)}%22`).join(",");
    meetings.push(...(await db.all("cockpit_fathom_meetings", `select=recording_id,share_url&share_url=in.(${quoted})`)));
  }
  const linkOf = new Map(meetings.map(m => [String(m.recording_id), String(m.share_url)]));
  for (const r of await allIn(db, "cockpit_csm_calls", "id,source_id,task_id,linked_call_id", "source_id", [...linkOf.keys()], "&source=eq.fathom&status=neq.gone")) {
    const link = linkOf.get(String(r.source_id));
    if (link) out.set(link, { id: Number(r.id), taskId: r.task_id ?? null, linkedCallId: r.linked_call_id == null ? null : Number(r.linked_call_id) });
  }
  return out;
}

/** A 1-1 form as read, waiting to be linked to its call. */
type Checkin = { row: Row; transcript: string | null; reason?: string; link?: string };
/** Every Typeform response read and matched to a client, before the 1-1 forms are linked to their calls. */
export type FormsRead = { formRows: Row[]; checkins: Checkin[]; counts: Record<string, Row> };

/**
 * Reads every response of every form and matches it to a client. The 1-1 forms' Fathom links go into
 * ctx.shareToTask, which the Fathom source places recordings by. Nothing is written here: linkTypeforms
 * links the 1-1 forms to their calls and writes them.
 */
export async function readTypeforms(ctx: Ctx): Promise<FormsRead> {
  const { t, db } = ctx;
  const valid = new Set(ctx.clients.map(c => c.taskId));
  const priorForms = new Map(
    (await db.all("cockpit_csm_call_forms", "select=token,task_id,matched_by,linked_call_id")).map(r => [String(r.token), r]),
  );
  const formRows: Row[] = [];
  const counts: Record<string, Row> = {};
  const checkins: Checkin[] = [];
  for (const [form, kind] of Object.entries(FORMS)) {
    const definition = await t.typeform(`forms/${form}`);
    const titles = fieldTitles(definition);
    const { items, total } = await allResponses(t, form);
    let matched = 0;
    const bad: string[] = [];
    const byMethod: Record<string, number> = {};
    let disagree = 0;
    let newest = "";
    for (const item of items) {
      if (!item?.token || !Number.isFinite(Date.parse(item.submitted_at))) continue;
      const answers = formAnswers(item, titles);
      let task: string | null = null,
        by: string | null = null,
        typed: string | null = null,
        reason: string | undefined;
      if (form === "fRokTITH") {
        // The client page's link carries the card id (hidden task_id); the typed Client ID is the fallback.
        const who = checkinClient(item, valid);
        ({ taskId: task, by, typed, reason } = who);
        if (who.disagree) disagree++;
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
      if (task) {
        matched++;
        if (by) byMethod[by] = (byMethod[by] ?? 0) + 1;
      } else if (form === "fRokTITH") bad.push(typed ?? "(blank)");
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
        const share = /https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]+/.exec(String(transcript ?? ""))?.[0];
        // The form's Fathom link: the one in the transcript answer, else the first in any answer.
        checkins.push({ row, transcript: transcript ? String(transcript) : null, reason, link: share ?? SHARE.exec(JSON.stringify(answers))?.[0] });
        if (share && task) ctx.shareToTask.set(share, task);
      }
    }
    counts[form] = {
      total,
      stored: items.length,
      matched,
      unmatched: items.length - matched,
      newest,
      bad: bad.slice(0, 10),
      ...(form === "fRokTITH" ? { byMethod, disagree } : {}),
    };
  }
  ctx.plan.typeform = counts;
  return { formRows, checkins, counts };
}

/**
 * Links each 1-1 form to its call and writes every form read (contract 4.1). A run calls it after the
 * Fathom source (worker.ts), so a form whose Fathom link places an impromptu recording in that run goes
 * under the recording at once, never first under a booked check-in or a held call of its own.
 */
export async function linkTypeforms(ctx: Ctx, read: FormsRead): Promise<Health[]> {
  const { db } = ctx;
  const { formRows, checkins, counts } = read;
  const out: Health[] = [];
  // Link each 1-1 form to its call. A form whose Fathom link is a stored recording of the same client
  // belongs under that recording: its booking when the booking is on the card and not gone, else the
  // recording's own row (contract 4.1), so an impromptu check-in shows once when its candidate row
  // takes the form's client. Else the client's check-in appointment within 48 h, else a held call of its own.
  const calls = (await db.all("cockpit_csm_calls", "select=id,task_id,kind,starts_at,status&source=eq.ghl_appointment&task_id=not.is.null"))
    .map(c => ({ id: Number(c.id), taskId: c.task_id, kind: c.kind, startsAt: Date.parse(c.starts_at), status: c.status }));
  const recorded = await recordingsByLink(db, checkins.filter(c => c.row.task_id && c.link).map(c => String(c.link)));
  const priorFormCalls = await existing(db, "checkin_form");
  const own: Row[] = [];
  let linked = 0,
    toRecording = 0;
  for (const { row, transcript, link } of checkins) {
    if (!row.task_id) continue;
    const rec = link ? recorded.get(link) : undefined;
    if (rec && rec.taskId === row.task_id) {
      const parent = rec.linkedCallId == null ? undefined : calls.find(c => c.id === rec.linkedCallId);
      row.linked_call_id = parent && parent.taskId === row.task_id && parent.status !== "gone" ? parent.id : rec.id;
      toRecording++;
      continue;
    }
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
        ctx.clients,
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
    for (const { row: r, reason } of checkins)
      if (!r.task_id)
        ctx.reasons.set(`form:${r.token}`, {
          reason: reason ?? "No client on the board",
          title: "1-1 call notes form",
          at: r.submitted_at,
        });
  }
  const ck = counts.fRokTITH;
  out.push({
    key: "csm-checkin-form",
    ok: true,
    rows: ck.stored,
    note: `${ck.stored} of ${ck.total} 1-1 forms stored, ${ck.matched} matched to a client (${ck.byMethod.hidden_field ?? 0} by the client page's link, ${ck.byMethod.typed_task_id ?? 0} by the typed ID${ck.byMethod.manual ? `, ${ck.byMethod.manual} by hand` : ""}; ${toRecording} linked to their recording, ${linked} to a booked check-in, ${own.length} on their own), ${ck.unmatched} with no client link and no typed ID on the board${ck.disagree ? `, ${ck.disagree} where the link and the typed ID differ` : ""}. Newest ${String(ck.newest).slice(0, 10)}.`,
    detail: { ...ck, linked, toRecording, ownCalls: own.length },
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

/** Read and link in one go, for a run of the Typeform source alone (worker.ts runs the Fathom source in between). */
export async function typeformSource(ctx: Ctx): Promise<Health[]> {
  return linkTypeforms(ctx, await readTypeforms(ctx));
}

// ---------------------------------------------------------------- Fathom

/**
 * The queue's sentence for an impromptu recording with no client, by the registry's provider for the
 * 1-1 notes (contract 4.1): before the cut-over a pick in the window is a shadow run and places
 * nothing, so the link in the 1-1 form is the way; from the cut-over the window places it.
 */
const CANDIDATE_REASON = {
  typeform: "Impromptu recording with no client yet. Put it on its client here, or paste its Fathom link in the 1-1 form.",
  native: "Impromptu recording with no client yet. Pick the client in the 1-1 notes or here.",
};
/** A recording Fathom stops returning is gone only when it is still missing this long after the first miss. */
const GONE_AFTER_MS = 60 * 60_000;
/** More missing recordings than this in one window read, or more than GONE_SHARE of it, marks none. */
const GONE_CAP = 3;
const GONE_SHARE = 0.1;
/** Transcript objects the store pass removes in one run; the rest wait for the next. */
const STORE_PASS_OBJECTS = 20;
/** What the raw of an internal, sales or gone meeting never keeps. */
const CONTENT_KEYS = ["default_summary", "action_items", "highlights", "transcript"];
const CLASSES = new Set(["client", "candidate", "internal", "sales"]);

const without = (raw: Row | null | undefined, keys: string[]) => Object.fromEntries(Object.entries(raw ?? {}).filter(([k]) => !keys.includes(k)));
/** JSON with its keys sorted: jsonb hands keys back in its own order. */
const canonical = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
const chunks = <T>(list: T[], size = 100) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Every page of Fathom's meetings list for these parameters. */
async function fathomMeetings(t: Transport, params: Record<string, string>): Promise<Row[]> {
  const meetings: Row[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 200) throw new Error("Fathom pagination incomplete");
    const p = new URLSearchParams(params);
    if (cursor) p.set("cursor", cursor);
    const body = await t.fathom(p);
    if (!Array.isArray(body.items)) throw new Error("Fathom meeting collection missing");
    meetings.push(...body.items);
    if (!body.next_cursor) return meetings;
    if (body.next_cursor === cursor) throw new Error("Fathom pagination did not advance");
    cursor = body.next_cursor;
  }
}

/** The sales desk's index without the rows it marked client service: the recordings classifyMeeting may call sales (4.2). */
async function salesIndex(db: Db): Promise<Set<string>> {
  const rows = await db.all("cockpit_sales_recordings", "select=recording_id,hidden_reason");
  return new Set(rows.filter(r => (r.hidden_reason ?? "") !== "client service").map(r => String(r.recording_id)));
}

/** Every booking with a client: as matchMeeting's Appt (a gone booking's room proves nothing) and as the matcher's Booking. */
async function bookingsOf(ctx: Ctx) {
  const rows = await ctx.db.all(
    "cockpit_csm_calls",
    "select=id,task_id,client_name,starts_at,ends_at,external_invitees,kind,status,room&source=eq.ghl_appointment&task_id=not.is.null",
  );
  const names = new Map(ctx.clients.map(c => [c.taskId, c.name]));
  const bookings: Booking[] = rows.map(a => {
    const invitees: Row[] = a.external_invitees ?? [];
    const ends = Date.parse(a.ends_at ?? "");
    return {
      id: Number(a.id),
      taskId: String(a.task_id),
      clientName: names.get(String(a.task_id)) ?? String(a.client_name ?? ""),
      kind: String(a.kind ?? "other"),
      status: String(a.status ?? ""),
      startsAt: Date.parse(a.starts_at),
      endsAt: Number.isFinite(ends) ? ends : null,
      room: a.room ?? null,
      emails: invitees.map(i => String(i.email ?? "").toLowerCase()).filter(Boolean),
      contactNames: invitees.map(i => String(i.name ?? "").trim()).filter(Boolean),
    };
  });
  const appts = bookings.map(b => ({ id: b.id, taskId: b.taskId, startsAt: b.startsAt, emails: b.emails, kind: b.kind, room: b.status === "gone" ? null : b.room }));
  const contactsIndex = emailIndex(
    rows.flatMap(a => (a.external_invitees ?? []).map((i: Row) => ({ email: i.email, clientId: a.task_id }))),
    new Set(ctx.clients.map(c => c.taskId)),
  );
  return { bookings, appts, contactsIndex, byId: new Map(bookings.map(b => [b.id, b])) };
}

/** Fathom share link to client from the stored 1-1 forms, for a run in which the Typeform source did not read them. */
async function storedFormLinks(db: Db): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  for (const f of await db.all("cockpit_csm_call_forms", "select=task_id,answers&form_id=eq.fRokTITH&task_id=not.is.null")) {
    const transcript = (f.answers ?? []).find((a: Row) => a.ref === TRANSCRIPT_REF)?.value;
    const share = SHARE.exec(String(transcript ?? ""))?.[0];
    if (share) links.set(share, String(f.task_id));
  }
  return links;
}

/** Who spoke on the stored transcripts of these call rows, by recording id. */
async function storedSpeakers(db: Db, rows: Row[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = rows.filter(r => r.transcript_path).map(r => String(r.id));
  for (const r of await allIn(db, "cockpit_csm_calls", "id,source_id,transcript_text", "id", ids)) out.set(String(r.source_id), speakersIn(r.transcript_text));
  return out;
}

/** The speakers of a transcript stored as text: one "[timestamp] Name: text" line per entry (transcriptText). */
function speakersIn(text: unknown): string[] {
  const names = String(text ?? "")
    .split("\n")
    .map(l => /^\[[^\]\n]*\] ([^:\n]+):/.exec(l)?.[1]);
  return speakers(names.filter(Boolean).map(name => ({ speaker: { display_name: name } })));
}

/** A stored meeting as Fathom's item: its raw with its share link, or undefined. */
async function storedMeeting(db: Db, rid: string): Promise<Row | undefined> {
  const s = (await db.all("cockpit_fathom_meetings", `select=recording_id,raw,share_url&recording_id=eq.${rid}`))[0];
  return s ? { ...s.raw, recording_id: s.raw?.recording_id ?? rid, share_url: s.share_url } : undefined;
}

/**
 * The matcher's view of a meeting (callMatch Recording), from Fathom's item or a stored row's raw. The
 * worker asks only about rows with no client, so it is on no client here (onTask null). inviteeEmails are
 * every calendar invitee's, lower-cased, as the webhook and the pull build them (contract A7 item 2). The
 * title is the edited one only, never the calendar's meeting_title (5.2 row 5, A7 item 12): the call row's
 * title column and its kind still fall back to meeting_title (callRowBase).
 */
export function recordingOf(m: FathomMeeting, cls: MeetingClass, prior: Row | undefined, said: string[] = []): Recording {
  const end = Date.parse(m.recording_end_time ?? m.scheduled_end_time ?? "");
  const invitees: Row[] = Array.isArray(m.calendar_invitees) ? m.calendar_invitees : [];
  return {
    recordingId: String(m.recording_id),
    startsAt: Date.parse(m.recording_start_time ?? m.scheduled_start_time ?? m.created_at),
    endsAt: Number.isFinite(end) ? end : null,
    room: normalizeRoom(m.meeting_url),
    title: typeof m.title === "string" ? m.title : null,
    meetingTitle: m.meeting_title ?? null,
    cls,
    recorderEmail: String(m.recorded_by?.email ?? "").toLowerCase() || null,
    recorderTeam: m.recorded_by?.team ?? null,
    inviteeEmails: [...new Set(invitees.map(i => String(i?.email ?? "").trim().toLowerCase()).filter(Boolean))],
    shareUrl: m.share_url ?? null,
    speakers: said,
    settled: !!prior?.settled_reason,
    onTask: null,
    onTaskMethod: null,
  };
}

/**
 * The client's name on a matched row: the clients list's, else the name of the booking the match names
 * (a client that has left the list keeps the name its booking was stored with), else null. The webhook
 * and the pull fall back the same way (contract A7 item 12).
 */
function clientNameOf(ctx: Ctx, taskId: string | null | undefined, booking: Booking | undefined): string | null {
  if (!taskId) return null;
  return ctx.clients.find(c => c.taskId === taskId)?.name || booking?.clientName || null;
}

/**
 * The match block an exact match writes (contract 3.6, A7 items 2 and 12), the same as the webhook's and the
 * pull's: the client, and the booking it names with that booking's kind; else the title's kind (`titled`)
 * and no link.
 */
function exactBlock(ex: ReturnType<typeof exactMatch>, ctx: Ctx, byId: Map<number, Booking>, titled: unknown): Row {
  if (!ex) return {};
  const booking = ex.bookingId === undefined ? undefined : byId.get(ex.bookingId);
  // The worker's own names for the same evidence: an invitee at a booked time is appointment_time.
  const [method, confidence]: [string, number] =
    ex.signal === "same_room" ? ["same_room", 1] : ex.signal === "pasted" ? ["form_task_id", 0.95] : booking ? ["appointment_time", 1] : ["invitee_email", 0.9];
  return {
    task_id: ex.taskId,
    client_name: clientNameOf(ctx, ex.taskId, booking),
    match_method: method,
    match_confidence: confidence,
    linked_call_id: booking?.id ?? null,
    kind: booking?.kind ?? titled,
  };
}

export async function fathomSource(ctx: Ctx, since: string, transcriptsPerRun = 8): Promise<Health> {
  const { t, db } = ctx;
  const now = iso(ctx.now);
  const meetings = await fathomMeetings(t, { created_after: since, include_summary: "true", include_action_items: "true" });
  const salesIds = await salesIndex(db);
  // The registry's provider for the 1-1 notes, read once per run, picks the queue's sentence.
  const provider = (await db.all("cockpit_forms", "select=provider&key=eq.checkin"))[0]?.provider;
  const reasonText = provider === "native" ? CANDIDATE_REASON.native : CANDIDATE_REASON.typeform;
  const { bookings, appts, contactsIndex, byId } = await bookingsOf(ctx);
  const formLinks = ctx.shareToTask.size ? ctx.shareToTask : await storedFormLinks(db);
  const prior = await existing(db, "fathom", "", ",linked_call_id,candidate,settled_reason,hints");
  const said = await storedSpeakers(db, [...prior.values()].filter(p => p.candidate === true));
  const matcher: MatchCtx = {
    formLinks,
    staffNames: (await db.all("cockpit_people", "select=name&active=is.true")).map(p => String(p.name ?? "")).filter(Boolean),
    csmEmails: [],
    now: ctx.now,
    // The client on the invite names only a listed client, as the contacts index (A7.13).
    clientIds: ctx.clients.map(c => c.taskId),
  };
  const refs: ClientRef[] = ctx.clients.map(c => ({ taskId: c.taskId, name: c.name, aliases: c.aliases }));
  const hintsFor = (rec: Recording) => suggestionsFor(rec, bookings, refs, matcher);
  const raw: Row[] = [];
  const calls: Row[] = [];
  const classOf = new Map<string, MeetingClass>();
  const byRecorder: Record<string, number> = {};
  let external = 0,
    candidates = 0,
    internal = 0,
    sales = 0,
    matched = 0;
  for (const m of meetings) {
    if (!m?.recording_id) continue;
    const rid = String(m.recording_id);
    const cls = classifyMeeting(m, salesIds);
    classOf.set(rid, cls);
    const email = String(m.recorded_by?.email ?? "").toLowerCase();
    byRecorder[email || "?"] = (byRecorder[email || "?"] ?? 0) + 1;
    // A recording returned again is no longer missing or gone, and its content comes back with the row.
    raw.push({ ...meetingRow(m, cls, now), missing_since: null, gone_at: null });
    // Internal and sales meetings keep metadata only and get no call row.
    if (cls === "internal") internal++;
    if (cls === "sales") sales++;
    if (cls === "internal" || cls === "sales") continue;
    if (cls === "client") external++;
    else candidates++;
    const p = prior.get(rid);
    // A row a person set aside as not a 1-1 call is never matched again and gets no queue entry.
    const settled = !!p?.settled_reason;
    const rec = recordingOf(m, cls, p, said.get(rid));
    const base = callRowBase(m, cls, now);
    const row: Row = { ...base, raw_hash: hashOf([rid, m.default_summary?.markdown_formatted ?? ""]) };
    let reason: string | undefined;
    if (!settled && cls === "client") {
      const mt = matchMeeting(m, appts, ctx.clients, contactsIndex, formLinks);
      Object.assign(row, {
        task_id: mt.taskId ?? null,
        client_name: clientNameOf(ctx, mt.taskId, mt.apptId === undefined ? undefined : byId.get(mt.apptId)),
        match_method: mt.method ?? null,
        match_confidence: mt.confidence ?? null,
        linked_call_id: mt.apptId ?? null,
      });
      reason = mt.reason ?? "No match";
    } else if (!settled) Object.assign(row, exactBlock(exactMatch(rec, bookings, matcher), ctx, byId, base.kind));
    keepManual(row, p, ctx.clients);
    // The kind follows the booking the row is linked to, else the title (contract 3.6).
    row.kind = (row.linked_call_id == null ? undefined : byId.get(Number(row.linked_call_id)))?.kind ?? base.kind;
    row.candidate = cls === "candidate" && !row.task_id && !settled;
    // Hints only while the row is an unplaced, unsettled candidate; a matched, client-class, manual or
    // settled row carries none (contract A7 item 12), as the webhook and the pull write it.
    row.hints = row.candidate ? hintsFor(rec) : [];
    if (row.task_id) matched++;
    calls.push(row);
    if (row.task_id || settled) continue;
    ctx.reasons.set(
      `fathom:${rid}`,
      row.candidate
        ? { reason: reasonText, title: m.title, at: row.starts_at, host: email, hint: row.hints[0]?.why }
        : { reason: reason ?? "No match", title: m.title, at: row.starts_at, host: email },
    );
  }
  // Re-match the stored rows still without a client that this run did not produce: the booking or the
  // form may have arrived since. A candidate takes an exact match only, never a client named in its
  // title (match.ts byNameIn). A sales or internal recording, a settled row and a gone one are never re-matched.
  const produced = new Set(calls.map(c => String(c.source_id)));
  const open = [...prior.values()].filter(
    p => !p.task_id && p.match_method !== "manual" && !p.settled_reason && p.status !== "gone" && !produced.has(String(p.source_id)),
  );
  const repatch: { id: number; values: Row }[] = [];
  let rematched = 0;
  for (const s of await allIn(db, "cockpit_fathom_meetings", "recording_id,raw,share_url,class", "recording_id", open.map(o => String(o.source_id)))) {
    const rid = String(s.recording_id);
    const p = prior.get(rid)!;
    const m = { ...s.raw, recording_id: s.raw?.recording_id ?? rid, share_url: s.share_url };
    // The sales desk may have indexed it since its last write, at any age.
    const ruled = classifyMeeting(m, salesIds);
    const cls: MeetingClass = classOf.get(rid) ?? (ruled === "sales" || !CLASSES.has(s.class) ? ruled : s.class);
    if (cls === "sales" || cls === "internal") continue;
    if (cls === "candidate") {
      const rec = recordingOf(m, cls, p, said.get(rid));
      const block = exactBlock(exactMatch(rec, bookings, matcher), ctx, byId, titleKind(m.title ?? m.meeting_title));
      if (block.task_id) {
        rematched++;
        repatch.push({ id: Number(p.id), values: { ...block, candidate: false, hints: [], updated_at: now } });
        continue;
      }
      const hints = hintsFor(rec);
      if (canonical(hints) !== canonical(p.hints ?? [])) repatch.push({ id: Number(p.id), values: { hints, updated_at: now } });
      ctx.reasons.set(`fathom:${rid}`, { reason: reasonText, title: m.title, at: m.recording_start_time ?? m.scheduled_start_time ?? m.created_at, host: rec.recorderEmail ?? undefined, hint: hints[0]?.why });
      continue;
    }
    const mt = matchMeeting(m, appts, ctx.clients, contactsIndex, formLinks);
    if (mt.taskId) {
      rematched++;
      const link = mt.apptId === undefined ? undefined : byId.get(mt.apptId);
      repatch.push({
        id: Number(p.id),
        values: {
          task_id: mt.taskId,
          client_name: clientNameOf(ctx, mt.taskId, link),
          match_method: mt.method,
          match_confidence: mt.confidence,
          linked_call_id: mt.apptId ?? null,
          ...(link ? { kind: link.kind } : {}),
          // A placed row is no candidate and carries no hints (contract A7 item 12).
          candidate: false,
          hints: [],
          updated_at: now,
        },
      });
    } else {
      // A client-class row on no client is no candidate either: any hints stored on it are cleared (A7 item 12).
      if (Array.isArray(p.hints) && p.hints.length) repatch.push({ id: Number(p.id), values: { hints: [], updated_at: now } });
      ctx.reasons.set(`fathom:${s.recording_id}`, { reason: mt.reason ?? "No match", title: m.title, at: m.recording_start_time, host: m.recorded_by?.email });
    }
  }
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
          updated_at: now,
        });
    for (const r of repatch) await db.patch("cockpit_csm_calls", `id=eq.${r.id}`, r.values);
  }
  const gone = await gonePass(ctx, since, new Set(classOf.keys()), prior);
  const { reclassed, stripped, removed, waiting } = await storePass(ctx, salesIds);
  const store = { reclassed, stripped, removed, waiting };
  let transcripts = 0,
    unavailable = 0;
  if (ctx.apply) {
    // Transcripts once per recording, newest first, bounded per run, and only for client and candidate
    // recordings: a call row carries no class, and a stripped internal or sales row would be fetched
    // again. A row whose meeting is missing or of another class takes no slot.
    const missing = await db.all(
      "cockpit_csm_calls",
      "select=id,source_id,starts_at,task_id,candidate,settled_reason&source=eq.fathom&transcript_path=is.null&status=neq.gone&order=starts_at.desc",
    );
    const classes = new Map(
      (await allIn(db, "cockpit_fathom_meetings", "recording_id,class", "recording_id", missing.map(r => String(r.source_id)))).map(r => [String(r.recording_id), String(r.class)]),
    );
    const fetched = new Map(meetings.filter(m => m?.recording_id).map(m => [String(m.recording_id), m]));
    for (const mrow of missing.filter(r => ["client", "candidate"].includes(classes.get(String(r.source_id)) ?? "")).slice(0, transcriptsPerRun)) {
      const rid = String(mrow.source_id);
      let body: Row;
      try {
        body = await t.fathomRecording(rid, "transcript");
      } catch (e) {
        // Fathom no longer has it: the gone pass decides what that means.
        if (e instanceof ProviderError && e.status === 404) {
          unavailable++;
          continue;
        }
        throw e;
      }
      const text = transcriptText(body?.transcript);
      if (!text) continue;
      const path = `fathom/${rid}.txt`;
      await db.storage(path, text);
      await db.patch("cockpit_fathom_meetings", `recording_id=eq.${rid}`, { transcript_path: path });
      const values: Row = { transcript_path: path, transcript_text: text.slice(0, 200_000) };
      if (mrow.candidate === true && !mrow.task_id && !mrow.settled_reason) {
        // A candidate's hints learn who spoke.
        const m = fetched.get(rid) ?? (await storedMeeting(db, rid));
        if (m) {
          values.hints = hintsFor(recordingOf(m, "candidate", mrow, speakers(body.transcript)));
          values.updated_at = now;
          const queued = ctx.reasons.get(`call:${mrow.id}`);
          if (queued) queued.hint = values.hints[0]?.why;
        }
      }
      await db.patch("cockpit_csm_calls", `id=eq.${mrow.id}`, values);
      transcripts++;
    }
  }
  ctx.plan.fathom = { read: meetings.length, external, candidates, internal, sales, matched, rematched, byRecorder, since, gone, store };
  const note =
    `${meetings.length} Fathom meetings read since ${since.slice(0, 10)} (${Object.entries(byRecorder).map(([k, v]) => `${k.split("@")[0]} ${v}`).join(", ")}), ` +
    `${external} with a client-side invitee outside sales, ${candidates} candidates, ${matched} matched, ${rematched} matched on a later run, ` +
    `${transcripts} transcripts stored, ${gone.marked} gone, ${store.stripped} stripped, ${store.removed} transcript objects removed. ` +
    "Private recordings remain invisible unless shared with this key.";
  return {
    key: "csm-fathom",
    ok: !gone.capped,
    rows: meetings.length,
    note: gone.capped ? `Fathom returned ${gone.missing} fewer recordings than stored; nothing was marked gone. ${note}` : note,
    detail: {
      read: meetings.length,
      external,
      candidates,
      internal,
      sales,
      matched,
      rematched,
      transcripts,
      transcriptsUnavailable: unavailable,
      gone: gone.marked,
      missing: { inWindow: gone.window, count: gone.missing, firstMissed: gone.firstMissed, capped: gone.capped },
      store,
      byRecorder,
      since,
    },
  };
}

/**
 * The gone pass (contract 4.1), only after a complete read of the window: a stored meeting created in
 * the window that Fathom did not return is missing, and gone when it is still missing an hour after the
 * first miss. A gone meeting loses its summary and content, its call row turns gone without its summary
 * and transcript, and the transcript object is removed. More missing than GONE_CAP, or more than
 * GONE_SHARE of the stored meetings in the window, marks none: a visibility, plan or API change would
 * otherwise wipe a whole window and roll back many clients' last call.
 */
async function gonePass(ctx: Ctx, since: string, seen: Set<string>, prior: Map<string, Row>) {
  const { db } = ctx;
  const now = iso(ctx.now);
  const from = Date.parse(since);
  // Fathom filters on created_at; the select reads a day more and the times decide.
  const inWindow = (
    await db.all(
      "cockpit_fathom_meetings",
      `select=recording_id,missing_since,gone_at,transcript_path,created:raw->>created_at&raw->>created_at=gte.${iso(from - DAY)}`,
    )
  ).filter(r => {
    const created = Date.parse(r.created ?? "");
    return Number.isFinite(created) && created >= from && created <= ctx.now;
  });
  const missing = inWindow.filter(r => !r.gone_at && !seen.has(String(r.recording_id)));
  const capped = missing.length > GONE_CAP || missing.length > GONE_SHARE * inWindow.length;
  const first = capped ? [] : missing.filter(r => !r.missing_since);
  const due = capped ? [] : missing.filter(r => r.missing_since && Date.parse(r.missing_since) <= ctx.now - GONE_AFTER_MS);
  if (ctx.apply) {
    if (first.length) await db.patch("cockpit_fathom_meetings", `recording_id=in.(${first.map(r => r.recording_id).join(",")})`, { missing_since: now });
    for (const r of due) {
      const rid = String(r.recording_id);
      const stored = (await db.all("cockpit_fathom_meetings", `select=raw&recording_id=eq.${rid}`))[0];
      if (!stored) continue;
      // The object first: a failed removal leaves both pointers for the next run.
      for (const path of new Set([r.transcript_path, prior.get(rid)?.transcript_path].filter(Boolean))) await db.storageRemove(String(path));
      await db.patch("cockpit_fathom_meetings", `recording_id=eq.${rid}`, {
        gone_at: now,
        summary: null,
        raw: without(stored.raw, CONTENT_KEYS),
        transcript_path: null,
        updated_at: now,
      });
      await db.patch("cockpit_csm_calls", `source=eq.fathom&source_id=eq.${rid}`, {
        status: "gone",
        summary: null,
        transcript_text: null,
        transcript_path: null,
        updated_at: now,
      });
    }
  }
  return { window: inWindow.length, missing: missing.length, firstMissed: first.length, marked: due.length, capped };
}

/**
 * The store pass (contract 4.1), every run and at the end of the light backfill: the strip is a rule
 * the store keeps. The sales desk indexes late, so a stored meeting it has indexed since (not Customer
 * Success, not client service) becomes sales at any age, and the privacy trigger strips it in the same
 * write. The call rows of internal and sales recordings lose their summary and transcript text at once,
 * and their transcript objects are removed, at most maxObjects a run (the rest wait). `also` holds
 * recordings the caller is turning internal or sales in this run. It creates no call row and changes no match.
 */
export async function storePass(ctx: Ctx, salesIds: ReadonlySet<string>, maxObjects = STORE_PASS_OBJECTS, also: ReadonlySet<string> = new Set()) {
  const { db } = ctx;
  const now = iso(ctx.now);
  const meetings = await db.all("cockpit_fathom_meetings", "select=recording_id,class,recorder_team,team:raw->recorded_by->>team,transcript_path");
  const reclass = meetings
    .filter(m => m.class !== "sales" && salesIds.has(String(m.recording_id)) && (m.recorder_team ?? m.team ?? null) !== CS_TEAM)
    .map(m => String(m.recording_id));
  const quiet = new Set([...meetings.filter(m => m.class === "internal" || m.class === "sales").map(m => String(m.recording_id)), ...reclass, ...also]);
  const content = (await db.all("cockpit_csm_calls", "select=id,source_id&source=eq.fathom&or=(summary.not.is.null,transcript_text.not.is.null)")).filter(c =>
    quiet.has(String(c.source_id)),
  );
  // Each recording's transcript objects: the meeting's pointer and its call rows'.
  const objects = new Map<string, Set<string>>();
  const hold = (rid: string, path: unknown) => path && objects.set(rid, (objects.get(rid) ?? new Set<string>()).add(String(path)));
  for (const m of meetings) if (quiet.has(String(m.recording_id))) hold(String(m.recording_id), m.transcript_path);
  for (const c of await db.all("cockpit_csm_calls", "select=source_id,transcript_path&source=eq.fathom&transcript_path=not.is.null"))
    if (quiet.has(String(c.source_id))) hold(String(c.source_id), c.transcript_path);
  const take: [string, Set<string>][] = [];
  let removed = 0;
  for (const [rid, paths] of objects) {
    if (removed + paths.size > maxObjects) break;
    take.push([rid, paths]);
    removed += paths.size;
  }
  if (ctx.apply) {
    for (const part of chunks(reclass)) await db.patch("cockpit_fathom_meetings", `recording_id=in.(${part.join(",")})`, { class: "sales", updated_at: now });
    for (const part of chunks(content.map(c => String(c.id))))
      await db.patch("cockpit_csm_calls", `id=in.(${part.join(",")})`, { summary: null, transcript_text: null, updated_at: now });
    for (const [rid, paths] of take) {
      for (const path of paths) await db.storageRemove(path);
      await db.patch("cockpit_fathom_meetings", `recording_id=eq.${rid}`, { transcript_path: null });
      await db.patch("cockpit_csm_calls", `source=eq.fathom&source_id=eq.${rid}`, { transcript_path: null });
    }
  }
  const ids = [...new Set([...reclass, ...content.map(c => String(c.source_id))])];
  const total = [...objects.values()].reduce((n, s) => n + s.size, 0);
  return { reclassed: reclass.length, stripped: ids.length, removed, waiting: total - removed, ids };
}

/**
 * backfill --source fathom-actions (contract 4.1): one light read of Fathom's meetings with their
 * action items, no summaries and no transcripts. Each stored meeting gets its class, room and recorder
 * team, and a client or candidate meeting its action items. One that is now internal or sales loses its
 * summary and content here, and its call row's summary and transcript text and its transcript object in
 * the store pass that follows, which runs with no cap and also covers the rows Fathom no longer returns.
 * It creates no call row and changes no match.
 */
export async function fathomActionsBackfill(ctx: Ctx, since: string): Promise<Health> {
  const { t, db } = ctx;
  const now = iso(ctx.now);
  const meetings = (await fathomMeetings(t, { created_after: since, include_action_items: "true" })).filter(m => m?.recording_id);
  const salesIds = await salesIndex(db);
  const stored = new Map(
    (await allIn(db, "cockpit_fathom_meetings", "recording_id,summary,raw,gone_at", "recording_id", meetings.map(m => String(m.recording_id)))).map(s => [
      String(s.recording_id),
      s,
    ]),
  );
  const updates: { rid: string; values: Row }[] = [];
  const quiet = new Set<string>();
  const held = new Set<string>();
  const byClass: Record<string, number> = {};
  let withItems = 0;
  for (const m of meetings) {
    const rid = String(m.recording_id);
    const s = stored.get(rid);
    if (!s) continue; // not stored yet: the regular run stores it
    // The light list carries no summary, so the stored one decides a short call (4.2).
    const summary = s.raw?.default_summary ?? (s.summary ? { markdown_formatted: s.summary } : null);
    const cls = classifyMeeting({ ...m, default_summary: summary }, salesIds);
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    const values: Row = { class: cls, room: normalizeRoom(m.meeting_url), recorder_team: m.recorded_by?.team ?? null, updated_at: now };
    if (cls === "client" || cls === "candidate") {
      // A gone meeting stays without content until the regular run sees it again.
      if (!s.gone_at) {
        values.raw = { ...s.raw, action_items: Array.isArray(m.action_items) ? m.action_items : null };
        if (Array.isArray(m.action_items)) withItems++;
      }
    } else {
      values.summary = null;
      values.raw = without(s.raw, CONTENT_KEYS);
      quiet.add(rid);
      if (s.summary != null || CONTENT_KEYS.some(k => s.raw?.[k] != null)) held.add(rid);
    }
    updates.push({ rid, values });
  }
  if (ctx.apply) for (const u of updates) await db.patch("cockpit_fathom_meetings", `recording_id=eq.${u.rid}`, u.values);
  // A one-off run: every object goes now.
  const { ids, ...store } = await storePass(ctx, salesIds, Number.POSITIVE_INFINITY, quiet);
  const stripped = new Set([...held, ...ids]).size;
  ctx.plan.fathomActions = { read: meetings.length, updated: updates.length, byClass, withItems, stripped, store, since };
  return {
    key: "csm-fathom-actions",
    ok: true,
    rows: meetings.length,
    note:
      `${meetings.length} Fathom meetings read since ${since.slice(0, 10)} with their action items, ${updates.length} stored meetings updated ` +
      `(${Object.entries(byClass).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}), action items stored for ${withItems}; ` +
      `${stripped} stripped, ${store.removed} transcript objects removed.`,
    detail: { read: meetings.length, updated: updates.length, byClass, withItems, stripped, store, since },
  };
}

// ---------------------------------------------------------------- Meta activities

/** The ad accounts whose activity is read, each with its client's task id. */
export async function metaAccounts(db: Db, clients: Client[]): Promise<Map<string, string>> {
  const accounts = new Map<string, string>(); // account id → task id
  // A stopped client's account is often no longer shared with us; Meta then
  // refuses it and the whole source reads as failing. Skip their cards.
  for (const c of await db.all("clients", "select=name,meta_ad_account_id&is_active=eq.true&meta_ad_account_id=not.is.null")) {
    const card = clients.find(k => isClientOf(c.name, k));
    if (card && !card.stopped) accounts.set(String(c.meta_ad_account_id).replace(/^act_/, ""), card.taskId);
  }
  for (const c of await db.all("cockpit_campaigns", "select=client_name,meta_account_id&source_deleted=is.false")) {
    const card = clients.find(k => isClientOf(c.client_name, k));
    if (card && c.meta_account_id) accounts.set(String(c.meta_account_id).replace(/^act_/, ""), card.taskId);
  }
  // `clients.name` is the Meta account's own name, so a name match misses an
  // account named unlike its client. Safad's "Safad Consulting" dropped out on
  // 22 Oct 2026 when its only campaign row was deleted. The ad billing watch
  // holds each enrolled client's verified account by task id, so it wins.
  for (const b of await db.all("cockpit_ad_billing_bindings", "select=client_task_id,account_id&enabled=eq.true")) {
    const card = clients.find(k => k.taskId === String(b.client_task_id));
    if (card && !card.stopped && b.account_id) accounts.set(String(b.account_id).replace(/^act_/, ""), card.taskId);
  }
  return accounts;
}

export async function metaSource(ctx: Ctx, sinceMs: number): Promise<Health> {
  const { t, db } = ctx;
  const accounts = await metaAccounts(db, ctx.clients);
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
