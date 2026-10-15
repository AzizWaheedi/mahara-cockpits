/**
 * Pure rules for the CSM calls worker: who a call or form belongs to, what kind
 * of call it is, its status, and which media buyer changes belong on a client.
 * No I/O here, so every rule has a test (match.test.ts).
 */
export type Row = Record<string, any>;

/** A client card. `stopped` is a card whose stage says the work has ended. */
export type Client = { taskId: string; name: string; aliases: string[]; stopped?: boolean };

/** A ClickUp stage that means the client no longer runs with us. */
export const STOPPED_STAGE = /stopped|churn|cancel|paused|lost/i;

export const CALENDAR_KIND: Record<string, Kind> = {
  z1Ne59rohCCj87KhcXoi: "onboarding",
  x84ET6KnA8odlsjYiVLq: "blueprint",
  "5E1EVxLJbGiDM3iYl2kL": "launch",
  SHjlq0UjeR11maltYNyh: "checkin",
};
export type Kind = "onboarding" | "blueprint" | "launch" | "checkin" | "other";
export type Status =
  | "booked"
  | "confirmed"
  | "showed"
  | "no_show"
  | "cancelled"
  | "held"
  | "gone";

export const KUWAIT_MS = 3 * 3_600_000;
export const kuwaitDay = (ms: number) =>
  new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);

/** Letters and digits only, lower case, any script. */
export function tight(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** At most one letter apart (port of convex/changeLog.ts nearlySame). */
export function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 1)
    return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  );
}

/** Whether a name (a campaign's client, an account name) is this client card. */
export function isClientOf(name: unknown, card: Client): boolean {
  const mine = tight(name);
  if (!mine) return false;
  return [card.name, ...card.aliases]
    .map(tight)
    .filter(Boolean)
    .some(n => nearlySame(mine, n));
}

/** The one client whose name or alias appears in a text blob, or none if ambiguous. */
export function byNameIn(blob: string, clients: Client[]): Client | undefined {
  const text = tight(blob);
  if (!text) return undefined;
  const hits: { c: Client; len: number }[] = [];
  for (const c of clients) {
    const best = Math.max(
      0,
      ...[c.name, ...c.aliases]
        .map(tight)
        .filter(n => n.length >= 4 && text.includes(n))
        .map(n => n.length),
    );
    if (best) hits.push({ c, len: best });
  }
  hits.sort((a, b) => b.len - a.len);
  if (hits.length === 1) return hits[0].c;
  if (hits.length > 1 && hits[0].len > hits[1].len) return hits[0].c;
  return undefined;
}

export const FREE_MAIL =
  /@(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|msn|aol|proton|protonmail)\./i;
export const OUR_DOMAIN = /@maharamedia\.com$/i;

/** Email and domain index from GoHighLevel contacts that carry the Client ID field. */
export function emailIndex(
  contacts: { email?: string; clientId?: string }[],
  valid: Set<string>,
) {
  const emails = new Map<string, string>();
  const domains = new Map<string, Set<string>>();
  for (const c of contacts) {
    const email = String(c.email ?? "").trim().toLowerCase();
    const task = String(c.clientId ?? "").trim();
    if (!email || !valid.has(task) || OUR_DOMAIN.test(email)) continue;
    emails.set(email, task);
    if (!FREE_MAIL.test(email)) {
      const d = email.split("@")[1];
      if (d) domains.set(d, (domains.get(d) ?? new Set()).add(task));
    }
  }
  const domain = new Map<string, string>();
  for (const [d, set] of domains) if (set.size === 1) domain.set(d, [...set][0]);
  return { emails, domain };
}

export type Match = {
  taskId?: string;
  method?: string;
  confidence?: number;
  reason?: string;
};

/** Appointment: the contact's Client ID field, then its email, then the name rule. */
export function matchAppointment(
  appt: Row,
  contact: Row | undefined,
  clients: Client[],
  emails: Map<string, string>,
): Match {
  const valid = new Set(clients.map(c => c.taskId));
  const id = String(contact?.clientId ?? "").trim();
  if (id && valid.has(id))
    return { taskId: id, method: "client_id_field", confidence: 1 };
  const email = String(contact?.email ?? "").trim().toLowerCase();
  if (email && emails.has(email))
    return { taskId: emails.get(email), method: "invitee_email", confidence: 0.9 };
  const hit = byNameIn(
    [appt.title, contact?.companyName, contact?.name, appt.notes].join(" "),
    clients,
  );
  if (hit) return { taskId: hit.taskId, method: "name", confidence: 0.6 };
  return {
    reason: id
      ? `Client ID "${id.slice(0, 20)}" is not a client on the board`
      : "No Client ID on the contact, no known email, no client name in the title",
  };
}

export function appointmentKind(calendarId: string, calendarName = ""): Kind {
  if (CALENDAR_KIND[calendarId]) return CALENDAR_KIND[calendarId];
  const n = calendarName.toLowerCase();
  if (n.includes("blueprint")) return "blueprint";
  if (n.includes("launch")) return "launch";
  if (n.includes("onboarding")) return "onboarding";
  if (/check.?in|sucess|success/.test(n)) return "checkin";
  return "other";
}

/** GoHighLevel statuses (confirmed, showed, noshow, cancelled, new, invalid). */
export function appointmentStatus(raw: unknown): Status {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("cancel") || s === "invalid") return "cancelled";
  if (s === "showed" || s === "show") return "showed";
  if (s === "noshow") return "no_show";
  if (s === "confirmed") return "confirmed";
  return "booked";
}

/** Join links worth showing: Zoom, Meet, Teams or another https link (not a map). */
export function joinUrl(address: unknown): string | undefined {
  const a = String(address ?? "").trim();
  if (!/^https:\/\//i.test(a)) return undefined;
  if (/maps\.app\.goo\.gl|google\.com\/maps|goo\.gl\/maps/i.test(a)) return undefined;
  return a;
}

export type Appt = {
  id: number;
  taskId?: string | null;
  startsAt: number;
  emails: string[];
};

/** Fathom meeting: appointment time with an invitee's email, then email/domain, then name. */
export function matchMeeting(
  meeting: Row,
  appts: Appt[],
  clients: Client[],
  index: { emails: Map<string, string>; domain: Map<string, string> },
  shareToTask: Map<string, string> = new Map(),
): Match & { apptId?: number } {
  const invitees: Row[] = meeting.calendar_invitees ?? [];
  const external = invitees.filter(i => i.is_external);
  const mails = external
    .map(i => String(i.email ?? "").trim().toLowerCase())
    .filter(Boolean);
  const start = Date.parse(
    meeting.recording_start_time ?? meeting.scheduled_start_time ?? meeting.created_at,
  );
  if (Number.isFinite(start)) {
    const near = appts
      .filter(
        a =>
          a.taskId &&
          Math.abs(a.startsAt - start) <= 30 * 60_000 &&
          a.emails.some(e => mails.includes(e)),
      )
      .sort((a, b) => Math.abs(a.startsAt - start) - Math.abs(b.startsAt - start));
    if (near[0])
      return {
        taskId: near[0].taskId!,
        method: "appointment_time",
        confidence: 1,
        apptId: near[0].id,
      };
  }
  const share = String(meeting.share_url ?? "");
  if (share && shareToTask.has(share))
    return { taskId: shareToTask.get(share), method: "form_task_id", confidence: 0.95 };
  for (const m of mails)
    if (index.emails.has(m))
      return { taskId: index.emails.get(m), method: "invitee_email", confidence: 0.9 };
  for (const m of mails) {
    const d = m.split("@")[1];
    if (d && index.domain.has(d))
      return { taskId: index.domain.get(d), method: "invitee_email", confidence: 0.8 };
  }
  const hit = byNameIn(
    [meeting.title, meeting.meeting_title, ...external.map(i => i.name)].join(" "),
    clients,
  );
  if (hit) return { taskId: hit.taskId, method: "name", confidence: 0.6 };
  return {
    reason: external.length
      ? "No booked call at this time, no known invitee email, no client name in the title"
      : "Internal meeting",
  };
}

/** Check-in kind for a recorded call from its title, else other. */
export function titleKind(title: unknown): Kind {
  const t = String(title ?? "").toLowerCase();
  if (/blueprint/.test(t)) return "blueprint";
  if (/launch/.test(t)) return "launch";
  if (/onboarding|kick.?off/.test(t)) return "onboarding";
  if (/check.?in|1-1|1:1|success/.test(t)) return "checkin";
  return "other";
}

/** A recording, video or call URL anywhere in a form's answers. */
export function recordingIn(answers: Row[]): string | undefined {
  for (const a of answers) {
    const v = JSON.stringify(a.value ?? "");
    const m = /https?:\/\/[^\s"\\]*(fathom\.video|zoom\.us\/rec|loom\.com|drive\.google\.com\/file)[^\s"\\]*/i.exec(v);
    if (m) return m[0];
  }
  return undefined;
}

/** Typeform answer value in one shape: text, choice label(s), number, url, date, boolean. */
export function answerValue(a: Row): unknown {
  switch (a.type) {
    case "text":
      return a.text;
    case "choice":
      return a.choice?.label ?? a.choice?.other;
    case "choices":
      return [...(a.choices?.labels ?? []), ...(a.choices?.other ? [a.choices.other] : [])];
    case "number":
      return a.number;
    case "boolean":
      return a.boolean;
    case "email":
      return a.email;
    case "url":
      return a.url;
    case "date":
      return a.date;
    case "phone_number":
      return a.phone_number;
    case "file_url":
      return a.file_url;
    case "payment":
      return a.payment;
    default:
      return a[a.type] ?? a.text ?? null;
  }
}

/** Every answer with its raw ref and type, titled from the definition when the ref is still there. */
export function formAnswers(item: Row, titles: Map<string, string>): Row[] {
  return (item.answers ?? []).map((a: Row) => ({
    ref: a.field?.ref ?? a.field?.id,
    type: a.field?.type ?? a.type,
    title: titles.get(a.field?.ref) ?? titles.get(a.field?.id) ?? null,
    value: answerValue(a),
  }));
}

/** The 1-1 check-in form's typed "Client ID" question. */
export const CHECKIN_TASK_REF = "c484f390-9695-4ffa-9693-9cc219592713";

/**
 * Who a 1-1 check-in form (fRokTITH) belongs to. The client page opens it with
 * the card id in the hidden field task_id, so that wins when it is a client on
 * the board; else the Client ID typed into the form; else no one. The typed
 * answer is always kept, and a link and a typed id that differ are flagged.
 */
export function checkinClient(
  item: Row,
  valid: Set<string>,
): {
  taskId: string | null;
  by: "hidden_field" | "typed_task_id" | null;
  typed: string | null;
  hidden: string | null;
  disagree: boolean;
  reason?: string;
} {
  const typed =
    String((item.answers ?? []).find((a: Row) => a.field?.ref === CHECKIN_TASK_REF)?.text ?? "").trim() || null;
  const hidden = String(item.hidden?.task_id ?? "").trim() || null;
  const disagree = !!hidden && !!typed && hidden !== typed;
  if (hidden && valid.has(hidden)) return { taskId: hidden, by: "hidden_field", typed, hidden, disagree };
  if (typed && valid.has(typed)) return { taskId: typed, by: "typed_task_id", typed, hidden, disagree };
  const q = (s: string) => `"${s.slice(0, 30)}"`;
  return {
    taskId: null,
    by: null,
    typed,
    hidden,
    disagree,
    reason:
      hidden && typed
        ? `Neither the link's client ID ${q(hidden)} nor the typed ${q(typed)} is a client on the board`
        : hidden
          ? `The link's client ID ${q(hidden)} is not a client on the board and no Client ID typed`
          : typed
            ? `Typed client ID ${q(typed)} is not a client on the board`
            : "Opened without the client's link and no Client ID typed",
  };
}

/** Field titles by ref and id, including fields nested in groups. */
export function fieldTitles(definition: Row): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (fields: Row[]) => {
    for (const f of fields ?? []) {
      if (f.ref) out.set(f.ref, String(f.title ?? ""));
      if (f.id) out.set(f.id, String(f.title ?? ""));
      if (f.properties?.fields) walk(f.properties.fields);
    }
  };
  walk(definition?.fields ?? []);
  return out;
}

/** The nearest check-in appointment for a client within 48 hours of a form. */
export function nearestCheckin(
  taskId: string,
  submittedAt: number,
  calls: { id: number; taskId?: string | null; kind: string; startsAt: number; status: string }[],
): number | undefined {
  const near = calls
    .filter(
      c =>
        c.taskId === taskId &&
        c.kind === "checkin" &&
        c.status !== "cancelled" &&
        c.status !== "gone" &&
        Math.abs(c.startsAt - submittedAt) <= 48 * 3_600_000,
    )
    .sort(
      (a, b) =>
        Math.abs(a.startsAt - submittedAt) - Math.abs(b.startsAt - submittedAt),
    );
  return near[0]?.id;
}

/**
 * Next and last call (port of the legacy apply_next_call), the same rules as the
 * cockpit_csm_calls_summary read so a test pins them down.
 */
export function nextAndLast(
  calls: { kind: string; status: string; startsAt: number; endsAt?: number; source: string }[],
  forms: number[],
  clickupLastCall: string | undefined,
  now: number,
) {
  const next = calls
    .filter(
      c =>
        c.source === "ghl_appointment" &&
        c.startsAt > now &&
        (c.status === "booked" || c.status === "confirmed"),
    )
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  const past = calls
    .filter(
      c =>
        c.startsAt <= now &&
        (c.status === "held" ||
          c.status === "showed" ||
          (c.status === "confirmed" && (c.endsAt ?? c.startsAt) <= now)),
    )
    .map(c => ({ at: c.startsAt, kind: c.kind, source: c.source }));
  for (const f of forms) past.push({ at: f, kind: "checkin", source: "checkin_form" });
  if (clickupLastCall && /^\d{4}-\d{2}-\d{2}$/.test(clickupLastCall))
    past.push({ at: Date.parse(`${clickupLastCall}T09:00:00+03:00`), kind: "checkin", source: "clickup" });
  const last = past.sort((a, b) => b.at - a.at)[0];
  return {
    nextCallAt: next?.startsAt,
    nextCallKind: next?.kind,
    lastCall: last?.at,
    lastCallSource: last?.source,
  };
}

/** Notes that are not changes: a question to Aziz, anything asked. */
const QUIET = [/^Asked\b/i, /[?؟]\s*$/];
export function isChange(what: unknown): boolean {
  const text = String(what ?? "").trim();
  return text.length > 0 && !QUIET.some(q => q.test(text));
}

export type Change = {
  key: string;
  subject: string;
  action: string;
  kind: string;
  evidence?: string;
  actor?: string;
  source: string;
  at: number;
  link?: string;
  taskId?: string;
};

/**
 * Port of convex/changeLog.ts changesForCard: the changes on any of the client's
 * campaigns or filed under the client's own name, newest first, 90 days, 40 max,
 * each with its Kuwait day.
 */
export function changesForClient(
  all: Change[],
  client: Client,
  campaigns: string[],
  now: number,
  { days = 90, max = 40 } = {},
) {
  const names = new Set(campaigns);
  const since = now - days * 86_400_000;
  return all
    .filter(
      c =>
        c.at >= since &&
        isChange(c.action) &&
        (c.taskId === client.taskId ||
          names.has(c.subject) ||
          isClientOf(c.subject, client)),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map(c => ({ ...c, day: kuwaitDay(c.at) }));
}

/** Meta activity events that are a change made by a person, not Meta's own delivery or billing. */
const META_NOISE =
  /billing|funding|first_delivery|delivered|payment|spend_limit_reached|to_be_set_after_review|ad_review|receive_audience/i;
export function isPersonChange(e: Row): boolean {
  const actor = String(e.actor_name ?? "").trim();
  if (!actor || actor === "Meta") return false;
  return !META_NOISE.test(String(e.event_type ?? ""));
}

/** A stable short hash for raw rows (no crypto dependency in tests). */
export function hashOf(v: unknown): string {
  const s = JSON.stringify(v);
  let h1 = 0x811c9dc5,
    h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
