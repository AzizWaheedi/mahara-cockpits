/**
 * Requests: the shapes the database returns and the words the screens use
 * (docs/requests/CONTRACT.md 2.5, 6.6). Import-free and byte-identical in all
 * five apps (scripts/check-shared.sh), so the form on the CSM client page and
 * the portal's /requests say the same thing. Nothing here reads or writes;
 * requestsClient.ts does that.
 *
 * Dates are Kuwait days ("YYYY-MM-DD"); Kuwait has no daylight saving, so a
 * day is the UTC date of the instant plus three hours.
 */

export type Team =
  | "tech"
  | "ads"
  | "call_center"
  | "client_success"
  | "creative"
  | "all_tasks";
export type Priority = "urgent" | "high" | "normal" | "low";
export type FieldKind =
  | "client"
  | "details"
  | "text"
  | "longtext"
  | "url"
  | "number"
  | "select"
  | "deadline"
  | "priority";
export type Option = { id: string; name: string };
export type OwnerRule =
  | "systems_manager"
  | "csm_of_card"
  | "creative_strategist"
  | "media_buyer_of_record"
  | "person";
export type OwnerHow =
  | "named"
  | "card"
  | "rule"
  | "fallback"
  | "none"
  | "import";
export type SopStepsState = "none" | "source" | "draft" | "saved";

/** A question on the form, as every seat reads it (2.5 TypeView.fields). */
export type FieldView = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** A select's choices; [] when ClickUp's field could not be read. */
  options: Option[] | null;
  help: string | null;
};

/** One task a type makes, in words (2.5 TypeView.parts). */
export type TypePartView = {
  part: string;
  listName: string;
  teamLabel: string;
  ruleLabel: string;
  templateName: string | null;
  /** SOP steps added as a checklist when the part has no template. */
  stepCount: number | null;
  stepsDraft: boolean;
};

/** A part as stored (2.2 Target); editors read and save it. */
export type TargetSpec = {
  part: string;
  name_suffix: string;
  list_id: string;
  team: Team;
  template_id: string | null;
  template_name: string | null;
  owner_rule: OwnerRule;
  owner_clickup_id: number | null;
  when: { field_key: string; options: string[] } | null;
};

/** A field as stored (2.2 Field); what an editor saves under `fields`. */
export type FieldSpec = {
  key: string;
  label: string;
  kind: FieldKind;
  clickup_field_id: string | null;
  required: boolean;
  options: Option[] | null;
  help: string | null;
};

/** A ClickUp folder field a type may use (the field catalog). */
export type CatalogField = {
  clickupFieldId: string;
  clickupName: string;
  label: string;
  kind: "text" | "longtext" | "url" | "number" | "select";
  options: Option[] | null;
  state: "ok" | "missing";
};

/** A ClickUp template object the cockpit has seen. */
export type TemplateOption = {
  id: string;
  name: string;
  state?: "ok" | "missing";
};

export type TypeView = {
  key: string;
  label: string;
  team: Team;
  teamLabel: string;
  enabled: boolean;
  dueDays: number;
  dueDefault: string;
  priority: Priority;
  fields: FieldView[];
  parts: TypePartView[];
  sopUrl: string | null;
  // Editors only (2.5):
  version?: number;
  typeIndex?: number;
  clickupOptionName?: string;
  targets?: TargetSpec[];
  sopSteps?: string[] | null;
  sopStepsState?: SopStepsState;
  setRequestType?: boolean;
  updatedByLabel?: string;
  updatedAt?: string;
  /**
   * Editors: the fields as stored, with their ClickUp ids (contract 2.5,
   * I1). A choice kept in a ClickUp field has no options here; its choices
   * are in `fields`, from the field catalog. A database from before I1 sends
   * none, and the type editor then keeps field changes locked rather than
   * drop a ClickUp mapping.
   */
  fieldSpecs?: FieldSpec[];
};

export type WriterMode = "apply" | "apply_limited" | "dry_run" | "unknown";
export type WriterAnswer = {
  canSend: boolean;
  note: string | null;
  /**
   * A send now is saved but held until requests open (a dry run, or off
   * the test card). Absent from an older database: requestsOpen() decides.
   */
  held?: boolean;
};

/** The answer of cockpit_request_types_read (2.5). */
export type TypesRead = {
  asOf: string;
  seat: {
    label: string;
    link: "linked" | "not_linked";
    teams: Team[];
    editor: boolean;
    all: boolean;
  };
  writer: WriterAnswer & { mode: WriterMode };
  types: TypeView[];
  /** Editors: the field catalog and the template cache (contract 2.5, I1). */
  catalog?: CatalogField[];
  templates?: TemplateOption[];
};

export type ClientOption = {
  taskId: string;
  name: string;
  status: string | null;
};
export type ClientsRead = { clients: ClientOption[]; more: boolean };

export type Owner = { label: string; how: OwnerHow; note: string | null };

/** One task the preview says a send would make. */
export type RoutePart = {
  part: string;
  listName: string;
  teamLabel: string;
  taskName: string;
  templateName: string | null;
  stepCount: number | null;
  stepsDraft: boolean;
  owner: Owner;
};

/** The answer of cockpit_request_preview (2.5). */
export type RoutePreview = {
  parts: RoutePart[];
  note: string | null;
  dueDefault: string;
  writer: WriterAnswer;
};

export type PartState =
  | "queued"
  | "sending"
  | "retry"
  | "unknown"
  | "delivered"
  | "dry_run"
  | "skipped"
  | "failed"
  | "imported";
export type VerifyState = "kept" | "restored" | "removed" | "moved";

export type PartRow = {
  part: string;
  listName: string;
  teamLabel: string;
  taskName: string;
  owner: Owner;
  state: PartState;
  error: string | null;
  url: string | null;
  status: string | null;
  statusType: string | null;
  verifyState: VerifyState | null;
  verifyNote: string | null;
};

export type RequestState =
  | "sending"
  | "dry_run"
  | "delivered"
  | "partial"
  | "failed"
  | "cancelled"
  | "imported"
  | "routed";
export type RequestSource = "requests_page" | "client_page" | "import";

export type RequestRow = {
  id: string;
  typeKey: string;
  typeLabel: string;
  team: Team;
  teamLabel: string;
  clientTaskId: string | null;
  clientName: string | null;
  requesterLabel: string;
  mine: boolean;
  dueOn: string | null;
  priority: Priority;
  state: RequestState;
  done: boolean;
  createdAt: string;
  source: RequestSource;
  canCancel: boolean;
  canRoute: boolean;
  /** Saved but not sent: it goes to ClickUp once requests open. */
  held?: boolean;
  /**
   * The database's sentence for a held request: when requests open, or (review
   * round 3) once a requests writer that stopped reporting runs again.
   */
  heldNote?: string | null;
  /**
   * An old form ticket already moved, closed or deleted in ClickUp (review
   * round 3): it left the queues, and nothing routes it from the cockpit.
   */
  importHandled?: boolean;
  parts: PartRow[];
};

/** The answer of cockpit_request_submit (2.5). */
export type SubmitResult = {
  id: string;
  state: RequestState | "duplicate";
  reused: boolean;
  duplicateOf: string | null;
  note: string | null;
  /** Saved, held until requests open (see WriterAnswer.held). */
  held?: boolean;
  parts: PartRow[];
};

export type RequestView = "mine" | "assigned" | "team" | "all";

/** The answer of cockpit_requests_read (2.5). */
export type RequestsRead = {
  asOf: string;
  view: RequestView;
  /** A count is null where the seat cannot have one (not linked). */
  views: { key: RequestView; label: string; count: number | null }[];
  rows: RequestRow[];
  note: string | null;
};

/** The answer of cockpit_request_get (2.5). */
export type RequestDetail = RequestRow & {
  answers: { key: string; label: string; display: string }[];
  details: string | null;
  replacesTaskId: string | null;
  routedTo: string | null;
  history: { at: string; what: string; byLabel: string }[];
};

/** What the form sends (cockpit_request_submit's arguments). */
export type SubmitInput = {
  requestId: string;
  typeKey: string;
  clientTaskId: string | null;
  answers: Record<string, string | number>;
  dueOn: string | null;
  priority: Priority | null;
  source: "requests_page" | "client_page";
  replacesTaskId?: string | null;
};

/** The tone of a chip, the same names as the cockpit's StatusChip. */
export type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

/**
 * The internal test card: while the writer is "apply_limited", only
 * requests for this card reach ClickUp (CONTRACT.md 2.8, R6).
 */
export const REQUESTS_CANARY_CARD = "86eywg1cq";

/**
 * Whether a request filed now for this client card reaches ClickUp: the
 * writer is "apply", or "apply_limited" and the card is the test card. In a
 * dry run, or while the writer has not reported, requests are not open and
 * a send is only saved.
 */
export function requestsOpen(
  writer: { mode?: WriterMode | string | null } | null | undefined,
  clientTaskId: string | null | undefined,
): boolean {
  if (writer?.mode === "apply") return true;
  if (writer?.mode === "apply_limited")
    return clientTaskId === REQUESTS_CANARY_CARD;
  return false;
}

/** The public ClickUp request form, while the writer is not live (R6). */
export const CLICKUP_FORM_URL =
  "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E";

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "urgent", label: "Urgent" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
];

/** The order the type list groups by (2.5, cockpit_request_types_read). */
export const TEAM_ORDER: Team[] = [
  "client_success",
  "tech",
  "ads",
  "creative",
  "call_center",
];

export const TEAM_LABEL: Record<Team, string> = {
  tech: "Operations / Tech",
  ads: "Marketing / ADs",
  call_center: "Call Center",
  client_success: "Client Success",
  creative: "Media/Creative",
  all_tasks: "All Tasks",
};

/** The five lists a part may go to (2.1), in TEAM_ORDER. */
export const TARGET_LISTS: { listId: string; team: Team; name: string }[] = [
  { listId: "901816723211", team: "client_success", name: "Client Success" },
  { listId: "901816723190", team: "tech", name: "Operations / Tech" },
  { listId: "901816723196", team: "ads", name: "Marketing / ADs" },
  { listId: "901818016338", team: "creative", name: "Media/Creative" },
  { listId: "901816723206", team: "call_center", name: "Call Center" },
];

/** The text limits of 2.5 step 5, shared by the inputs and the checks. */
export const LIMITS = {
  text: 500,
  longtext: 4000,
  url: 2000,
  number: 1000,
  daysAhead: 365,
} as const;

/** Fields the form draws in its own places, never in the answers. */
const OWN_PLACE: FieldKind[] = ["client", "deadline", "priority"];

/** The sentences the screens use (contract 6.6), in one place. */
export const REQUEST_SENTENCES = {
  sent: "Request sent.",
  saved: "Request saved.",
  /** The sent panel, one line per task, by the task's state. */
  held: (list: string) => `Saved. Goes to ${list} when requests open.`,
  heldInList: (list: string) =>
    `In ${list}, not finished yet. The cockpit finishes it when requests open.`,
  heldRequest: "Saved. It goes to ClickUp when requests open",
  sendingTo: (list: string) => `Sending to ${list}.`,
  checkingIn: (list: string) => `Checking whether it reached ${list}.`,
  inList: (list: string, owner: string) => `In ${list}. Owner: ${owner}.`,
  notSentTo: (list: string, why: string) => `Not sent to ${list}: ${why}.`,
  noType: "Pick what you need first.",
  missingChoice:
    "This choice could not be read from ClickUp. Ask the systems manager.",
  cardOwner: "The CSM named on the client card.",
  notLinked:
    "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it.",
  loadingTypes: "Reading the request types",
  typesFailed: "The request types could not be read. Try again in a minute.",
  previewWaiting: "Working out where it goes",
  previewFailed:
    "Where it goes could not be worked out just now. You can still send it; the cockpit routes it when it arrives.",
  noTypes: "No request types are switched on. Ask the systems manager.",
  noMatch: "Nothing matches. Try another word.",
  noClients: "No client matches. Try another spelling.",
  dueRequired: "Pick today or a later day.",
  dueTooFar: "Pick a day within the next year.",
  verify: {
    restored: "A ClickUp rule removed the owner; the cockpit put them back.",
    removed: "A ClickUp rule keeps removing the owner. Assign it in ClickUp.",
    moved:
      "ClickUp moved this task after its Request Type was set. Request Type is now off for this type.",
  } as Record<VerifyState, string | null>,
  missingFunction:
    "Requests are not on the database yet. Use the ClickUp request form until they are.",
  /**
   * An old form ticket a seat may not make a request of here (canRoute
   * false: requests are not open to the seat yet, or the ticket is not its
   * team's): its own task in ClickUp is the way to route it.
   */
  importedElsewhere:
    "Came in through the old ClickUp form. Route it in ClickUp.",
  /**
   * An old form ticket the team moved, closed or deleted in ClickUp since it
   * came in (importHandled, review round 3): nothing is left to route.
   */
  importHandled:
    "Came in through the old ClickUp form. It was moved or closed in ClickUp, so it needs no routing here.",
  /** The next step on a request where nothing reached ClickUp. */
  againFailed:
    "Nothing reached ClickUp. File it again with the same answers, or use the ClickUp request form.",
  /**
   * The next step on a request whose task was deleted in ClickUp: it did
   * reach ClickUp, so the panel never says nothing did (review round 3).
   */
  againDeleted:
    "The task was deleted in ClickUp. File it again with the same answers, or use the ClickUp request form.",
  /**
   * A task whose create went out and lost its answer, handed back while
   * requests are not open: it may be in ClickUp, and is checked first.
   */
  checkingHeld:
    "ClickUp did not answer. The cockpit checks whether it arrived once requests open",
  /** The sent panel's next step when nothing reached ClickUp. */
  sentFailed:
    "Open the request to file it again, or use the ClickUp request form.",
  /** The server's refusal when the old form ticket a request routes is already routed (contract 2.5, step 8). */
  oldTicketRouted: "That old ticket was already routed.",
  /**
   * A request filed again whose old form ticket was routed meanwhile (by the
   * first request's own last step, or by a teammate): it goes on its own.
   */
  sentAlone:
    "Request sent. Its old ClickUp form ticket was already routed, so this one goes on its own.",
  /**
   * The next step when a routing request made no task because the team moved
   * or closed the old form ticket in ClickUp while it waited: nothing to file
   * again (the work may be done); check the old ticket.
   */
  oldHandledNext:
    "The old ClickUp form ticket was moved or closed in ClickUp while this request waited, so no task was made. Check the old ticket, and ask again only if the work is still needed.",
  /**
   * "Make it a request" or "File it again" when the type it came with is not
   * on the form: turned off, or (on a page with the client fixed) a type that
   * takes no client card. What was asked goes with the type picked instead.
   */
  presetOff: "The request type it came with is turned off. Pick another type.",
  presetNoClient:
    "The request type it came with does not take a client card, so it is not offered here. Pick another type.",
  presetKept: "What was asked is kept.",
  /**
   * An old ticket's or a request's words when the type picked has no details
   * question: shown so they can be carried into its questions, said plainly
   * that they are not sent. Routing an old ticket, the database adds them to
   * the new task's description with a link back (cockpit_request_plan,
   * review round 3), since the old ticket is cancelled once routed.
   */
  keptLabel: "What was asked",
  keptNotSent:
    "This type has no question for these words, so they are not sent with it.",
  keptRouted:
    "This type has no question for these words, so the cockpit adds them to the new task's description, with a link to the old ticket.",
} as const;

// ---------------------------------------------------------------------------
// Kuwait days

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Kuwait as YYYY-MM-DD. */
export function kuwaitToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + 3 * 3_600_000).toISOString().slice(0, 10);
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

/** A day plus n days, as YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  return new Date(dayMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Wed 28 Oct"; the year only when it is not this year's. */
export function dayLabel(iso: string | null, todayIso?: string): string {
  if (!iso || !ISO_DAY.test(iso)) return "";
  const d = new Date(dayMs(iso));
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const thisYear = (todayIso ?? kuwaitToday()).slice(0, 4);
  return iso.slice(0, 4) === thisYear ? base : `${base} ${iso.slice(0, 4)}`;
}

/** "14:02" in Kuwait for an ISO time. */
export function kuwaitClock(at: string | null): string {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 3 * 3_600_000).toISOString().slice(11, 16);
}

/** "Sun 25 Oct 17:35", the Kuwait day and clock of an ISO time. */
export function stampWords(at: string | null, todayIso?: string): string {
  const ms = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(ms)) return "";
  return `${dayLabel(kuwaitToday(ms), todayIso)} ${kuwaitClock(at)}`;
}

/**
 * The due day a request carries into the form (filed again, or an old form
 * ticket made a request), when the server would take it: today in Kuwait to
 * a year ahead (2.5 step 6). Else null, and the form starts on the type's
 * default.
 */
export function carriedDueOn(
  dueOn: string | null | undefined,
  todayIso: string = kuwaitToday(),
): string | null {
  if (!dueOn || !ISO_DAY.test(dueOn)) return null;
  const ahead = daysBetween(todayIso, dueOn);
  return ahead >= 0 && ahead <= LIMITS.daysAhead ? dueOn : null;
}

/**
 * The due word on a request row: "2 days late", "Today", "Tomorrow",
 * "Thu 30 Oct". Late only while the request is open.
 */
export function dueWord(
  dueOn: string | null,
  open: boolean,
  todayIso: string = kuwaitToday(),
): { text: string; tone: "late" | "today" | "none" } {
  if (!dueOn || !ISO_DAY.test(dueOn)) return { text: "", tone: "none" };
  const d = daysBetween(todayIso, dueOn);
  if (d < 0 && open)
    return {
      text: d === -1 ? "1 day late" : `${-d} days late`,
      tone: "late",
    };
  if (d === 0) return { text: "Today", tone: open ? "today" : "none" };
  if (d === 1) return { text: "Tomorrow", tone: "none" };
  return { text: dayLabel(dueOn, todayIso), tone: "none" };
}

// ---------------------------------------------------------------------------
// The form's checks (2.5 steps 4 to 6), the same sentences as the server

/** The fields the form asks in its body, in order (not client, due, priority). */
export function bodyFields(type: TypeView): FieldView[] {
  return type.fields.filter(f => !OWN_PLACE.includes(f.kind));
}

export const clientField = (type: TypeView) =>
  type.fields.find(f => f.kind === "client") ?? null;
export const dueField = (type: TypeView) =>
  type.fields.find(f => f.kind === "deadline") ?? null;
export const priorityField = (type: TypeView) =>
  type.fields.find(f => f.kind === "priority") ?? null;

const empty = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * What is wrong with one answer, in the words cockpit_request_submit uses
 * (2.5 step 5), or null. The server raises "{label}: {this}." for the first
 * problem; the form shows each under its own field before anyone sends.
 */
export const ANSWER_PROBLEMS = {
  pickClient: "pick a client",
  pickOne: "pick one",
  fillIn: "fill this in",
  noChoices:
    "this choice could not be read from ClickUp. Ask the systems manager",
  text: `keep it under ${LIMITS.text} characters`,
  longtext: `keep it under ${LIMITS.longtext} characters`,
  url: "paste a link that starts with http:// or https://",
  urlLong: "that link is too long",
  number: `enter a whole number from 0 to ${LIMITS.number}`,
  choice: "pick one of the choices",
} as const;

/** Characters as Postgres counts them (code points, not UTF-16 units). */
const chars = (s: string) => [...s].length;

function answerProblem(f: FieldView, raw: unknown): string | null {
  const choices = f.options ?? [];
  if (empty(raw)) {
    if (!f.required) return null;
    if (f.kind === "select")
      return choices.length
        ? ANSWER_PROBLEMS.pickOne
        : ANSWER_PROBLEMS.noChoices;
    return ANSWER_PROBLEMS.fillIn;
  }
  const text = String(raw).trim();
  switch (f.kind) {
    case "text":
      return chars(text) > LIMITS.text ? ANSWER_PROBLEMS.text : null;
    case "longtext":
    case "details":
      return chars(text) > LIMITS.longtext ? ANSWER_PROBLEMS.longtext : null;
    case "url":
      if (!/^https?:\/\//i.test(text)) return ANSWER_PROBLEMS.url;
      return chars(text) > LIMITS.url ? ANSWER_PROBLEMS.urlLong : null;
    case "number":
      return /^\d{1,4}$/.test(text) && Number(text) <= LIMITS.number
        ? null
        : ANSWER_PROBLEMS.number;
    case "select":
      if (choices.some(o => o.id === text)) return null;
      return choices.length
        ? ANSWER_PROBLEMS.choice
        : ANSWER_PROBLEMS.noChoices;
  }
  return null;
}

/**
 * Field key to its sentence, for every problem the server would refuse:
 * "{label}: {what is wrong}." An empty object means the form may send.
 */
export function validateAnswers(
  type: TypeView,
  answers: Record<string, string | number | null | undefined>,
  clientTaskId: string | null,
  dueOn: string | null,
  todayIso: string = kuwaitToday(),
): Record<string, string> {
  const out: Record<string, string> = {};
  const client = clientField(type);
  if (client?.required && empty(clientTaskId))
    out[client.key] = `${client.label}: ${ANSWER_PROBLEMS.pickClient}.`;
  for (const f of bodyFields(type)) {
    const problem = answerProblem(f, answers[f.key]);
    if (problem) out[f.key] = `${f.label}: ${problem}.`;
  }
  const due = dueField(type);
  if (due && dueOn) {
    if (!ISO_DAY.test(dueOn) || daysBetween(todayIso, dueOn) < 0)
      out[due.key] = REQUEST_SENTENCES.dueRequired;
    else if (daysBetween(todayIso, dueOn) > LIMITS.daysAhead)
      out[due.key] = REQUEST_SENTENCES.dueTooFar;
  } else if (due?.required && !dueOn)
    out[due.key] = REQUEST_SENTENCES.dueRequired;
  return out;
}

/**
 * The answers the server takes: trimmed, empty ones left out, numbers as
 * numbers; never the client, due or priority (2.5 step 4).
 */
export function cleanAnswers(
  type: TypeView,
  answers: Record<string, string | number | null | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of bodyFields(type)) {
    const raw = answers[f.key];
    if (empty(raw)) continue;
    const text = String(raw).trim();
    out[f.key] =
      f.kind === "number" && /^\d+$/.test(text) ? Number(text) : text;
  }
  return out;
}

/** Which field a server sentence names ("{label}: ..."), if any. */
export function fieldOfSentence(
  type: TypeView,
  sentence: string,
): string | null {
  for (const f of type.fields)
    if (sentence.startsWith(`${f.label}:`)) return f.key;
  if (
    sentence === REQUEST_SENTENCES.dueRequired ||
    sentence === REQUEST_SENTENCES.dueTooFar
  )
    return dueField(type)?.key ?? null;
  return null;
}

/** An answer in words: a select's choice name, a number, the text. */
export function display(
  field: Pick<FieldView, "kind" | "options">,
  value: string | number | null | undefined,
): string {
  if (empty(value)) return "";
  const text = String(value).trim();
  if (field.kind === "select")
    return (field.options ?? []).find(o => o.id === text)?.name ?? text;
  if (field.kind === "priority")
    return PRIORITIES.find(p => p.key === text)?.label ?? text;
  return text;
}

// ---------------------------------------------------------------------------
// States in words (6.6)

const reason = (e: string | null | undefined) =>
  (e ?? "").trim().replace(/\.$/, "") || "the writer gave no reason";

const firstError = (row: Pick<RequestRow, "parts">) =>
  row.parts.find(p => p.state === "failed" || p.state === "skipped")?.error ??
  row.parts.find(p => p.error && p.state !== "delivered" && !partWaiting(p))
    ?.error ??
  null;

/** The ClickUp statuses of the delivered tasks, each once. */
function deliveredStatuses(row: Pick<RequestRow, "parts">): string[] {
  return [
    ...new Set(
      row.parts
        .filter(p => p.state === "delivered" && p.status)
        .map(p => String(p.status)),
    ),
  ];
}

/** "to do", or "to do and in progress" for a two-task request. */
const statuses = (row: Pick<RequestRow, "parts">) =>
  joinWords(deliveredStatuses(row));

/**
 * The request's state as one sentence (the panel and the row's hint). An
 * old form ticket says how to route it: "Make it a request" only where the
 * seat may (canRoute), else in ClickUp, so no seat is told to press a
 * button it does not have.
 */
export function stateWords(
  row: Pick<RequestRow, "state" | "done" | "parts" | "held"> & {
    canRoute?: boolean;
    heldNote?: string | null;
    importHandled?: boolean;
  },
): string {
  if (row.done && row.state !== "cancelled") return "Done";
  // The database's own sentence when it sends one (a writer that stopped
  // reporting is said as such, review round 3), else the screens' words.
  if (requestHeld(row))
    return (
      row.heldNote?.trim().replace(/\.$/, "") || REQUEST_SENTENCES.heldRequest
    );
  switch (row.state) {
    case "sending":
      return "Sending to ClickUp";
    case "dry_run":
      // Before 2026-10-26 a held request settled here; kept as a fallback.
      return REQUEST_SENTENCES.heldRequest;
    case "delivered": {
      const s = statuses(row);
      return s ? `In ClickUp: ${s}` : "In ClickUp";
    }
    case "partial":
      return `Part of it did not reach ClickUp: ${reason(firstError(row))}`;
    case "failed":
      return `Not in ClickUp: ${reason(firstError(row))}`;
    case "cancelled":
      return "Cancelled";
    case "imported":
      if (row.importHandled) return REQUEST_SENTENCES.importHandled;
      return row.canRoute === false
        ? REQUEST_SENTENCES.importedElsewhere
        : "Came in through the old ClickUp form. Make it a request to route it.";
    case "routed":
      return "Routed as a new request";
  }
  return "Sending to ClickUp";
}

/**
 * The note of a task that reached ClickUp but that the cockpit could not
 * finish (a refused step: the owner, the due day, the SOP steps, a field,
 * the card comment), while the request is open; else null. Lists show it
 * beside the row's state, so such a row never reads as a clean one.
 */
export function unfinishedNote(
  row: Pick<RequestRow, "done" | "parts">,
): string | null {
  if (row.done) return null;
  for (const p of row.parts) {
    const note = deliveredNote(p);
    if (note) return note;
  }
  return null;
}

/**
 * A row's state in full, for a list's hint and the CSM's line: the state's
 * sentence, then what to check on a task the cockpit could not finish.
 */
export function stateHint(
  row: Pick<RequestRow, "state" | "done" | "parts" | "held"> & {
    canRoute?: boolean;
    heldNote?: string | null;
    importHandled?: boolean;
  },
): string {
  const words = stateWords(row);
  const note = unfinishedNote(row);
  return note ? `${words}. ${note}` : words;
}

/**
 * What to do about a request part of which reached ClickUp: name the
 * task that did not, keep the ones that did (filing the whole request again
 * would make them twice), and raise the missing one another way.
 */
export function partialNext(row: Pick<RequestRow, "parts">): string {
  const missing = [
    ...new Set(
      row.parts
        .filter(p => p.state === "failed" || p.state === "skipped")
        .map(p => p.listName),
    ),
  ];
  const tasks = row.parts.filter(
    p => p.state === "failed" || p.state === "skipped",
  ).length;
  const landed = row.parts.filter(p => p.state === "delivered").length;
  const kept =
    landed === 1
      ? "the one that did stays there"
      : "the ones that did stay there";
  const many = tasks > 1;
  const what = missing.length
    ? `The ${joinWords(missing)} ${many ? "tasks" : "task"} did not reach ClickUp`
    : "Part of this request did not reach ClickUp";
  return `${what}; ${kept}. Raise the missing ${many ? "tasks" : "task"} with the ClickUp request form, or ask the systems manager to make ${many ? "them" : "it"}.`;
}

/**
 * Where a sent request stands, for the sent panel's mark: a task refused
 * (failed), one still on its way (moving), only saved until requests open
 * (held), or every task in ClickUp (done).
 */
export function sentTone(
  parts: Pick<PartRow, "state" | "error">[],
  open: boolean,
): "failed" | "moving" | "held" | "done" {
  if (parts.some(p => p.state === "failed" || p.state === "skipped"))
    return "failed";
  if (parts.some(p => partMoving(p, open))) return "moving";
  if (parts.some(p => partHeld(p, open))) return "held";
  return "done";
}

/** The row's chip: a short label and its tone. */
export function stateChip(
  row: Pick<RequestRow, "state" | "done" | "parts" | "held"> & {
    importHandled?: boolean;
  },
): {
  label: string;
  tone: Tone;
} {
  if (row.done && row.state !== "cancelled")
    return { label: "Done", tone: "good" };
  if (requestHeld(row)) return { label: "Saved", tone: "warning" };
  switch (row.state) {
    case "sending":
      return { label: "Sending", tone: "neutral" };
    case "dry_run":
      return { label: "Saved", tone: "warning" };
    case "delivered": {
      // Two tasks at different statuses read "In ClickUp"; the panel and
      // the row's hint name each one. A task the cockpit could not finish
      // keeps its status, in the warning tone: something to check.
      const seen = deliveredStatuses(row);
      return {
        label:
          seen.length === 1
            ? seen[0].charAt(0).toUpperCase() + seen[0].slice(1)
            : "In ClickUp",
        tone: unfinishedNote(row) ? "warning" : "neutral",
      };
    }
    case "partial":
      return { label: "Part not sent", tone: "serious" };
    case "failed":
      return { label: "Not sent", tone: "critical" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "imported":
      // Handled in ClickUp already: nothing left to do here.
      return {
        label: "Old form",
        tone: row.importHandled ? "neutral" : "warning",
      };
    case "routed":
      return { label: "Routed", tone: "neutral" };
  }
  return { label: "Sending", tone: "neutral" };
}

const DONE_TYPES = ["done", "closed"];

/** One task of a request, in words. */
export function partWords(part: PartRow, held = false): string {
  if (partHeld(part, !held))
    return part.url
      ? "In ClickUp, not finished yet. The cockpit finishes it when requests open"
      : REQUEST_SENTENCES.heldRequest;
  switch (part.state) {
    case "queued":
    case "sending":
      return "Sending to ClickUp";
    case "retry":
      return "Sending to ClickUp, trying again in a few minutes";
    case "unknown": {
      // The writer's note names what a person must do when it stays in
      // doubt (two tasks match, every match cancelled, a search refused;
      // review round 3). A note naming the switch is never shown: a create
      // handed back while requests are not open is checked once they are.
      const said = (part.error ?? "").trim();
      if (WAITING_NOTE.test(said)) return REQUEST_SENTENCES.checkingHeld;
      return said
        ? `Checking whether it reached ClickUp. ${reason(said)}`
        : "Checking whether it reached ClickUp";
    }
    case "delivered":
      if (part.statusType && DONE_TYPES.includes(part.statusType))
        return part.statusType === "closed"
          ? "Closed in ClickUp"
          : "Done in ClickUp";
      return part.status ? `In ClickUp: ${part.status}` : "In ClickUp";
    case "dry_run":
      return REQUEST_SENTENCES.heldRequest;
    case "skipped":
      return `Not sent: ${reason(part.error)}`;
    case "failed":
      return `Not in ClickUp: ${reason(part.error)}`;
    case "imported":
      return part.status
        ? `On All Tasks in ClickUp: ${part.status}`
        : "On All Tasks in ClickUp";
  }
  return "Sending to ClickUp";
}

/** A part's chip. */
export function partChip(
  part: PartRow,
  held = false,
): { label: string; tone: Tone } {
  if (partHeld(part, !held)) return { label: "Saved", tone: "warning" };
  switch (part.state) {
    case "delivered":
      if (part.statusType && DONE_TYPES.includes(part.statusType))
        return { label: "Done", tone: "good" };
      return {
        label: part.status
          ? part.status.charAt(0).toUpperCase() + part.status.slice(1)
          : "In ClickUp",
        tone: "neutral",
      };
    case "dry_run":
      return { label: "Saved", tone: "warning" };
    case "skipped":
      return { label: "Not sent", tone: "serious" };
    case "failed":
      return { label: "Not sent", tone: "critical" };
    case "unknown":
      return { label: "Checking", tone: "warning" };
    case "imported":
      return { label: "Old form", tone: "warning" };
  }
  return { label: "Sending", tone: "neutral" };
}

/** The note under an owner: why this person, when it is not the plain rule. */
export function ownerNote(owner: Owner): string | null {
  // The server words the note for the reader (an editor also gets where to
  // fix it), so what comes back is shown as it is.
  const said = owner.note?.trim() || null;
  if (owner.how === "card") return said ?? REQUEST_SENTENCES.cardOwner;
  if (owner.how === "fallback" || owner.how === "none") return said;
  return null;
}

/** The 2-minute check's note, when it has something to say. */
export function verifyWords(
  part: Pick<PartRow, "verifyState" | "verifyNote">,
): string | null {
  const base = part.verifyState
    ? REQUEST_SENTENCES.verify[part.verifyState]
    : null;
  const extra = part.verifyNote?.trim() || null;
  if (base && extra && !base.includes(extra)) return `${base} ${extra}`;
  return base ?? (part.verifyState === "kept" ? extra : null);
}

/**
 * The route line (6.1's signature): exactly where the ticket lands, before
 * Send. "Goes to Operations / Tech as "Acme - Client pause (Tech)". Owner:
 * the systems manager. Uses the ClickUp template Client Pause ⏸️ (Tech).
 * Due Wed 28 Oct."
 */
export function routeLine(
  part: Pick<
    RoutePart,
    | "listName"
    | "taskName"
    | "owner"
    | "templateName"
    | "stepCount"
    | "stepsDraft"
  >,
  dueOn: string | null,
  todayIso?: string,
): string {
  const owner =
    part.owner.how === "none" || !part.owner.label
      ? "Owner: nobody yet."
      : `Owner: ${part.owner.label}.`;
  const sop = part.templateName
    ? ` Uses the ClickUp template ${part.templateName}.`
    : part.stepCount
      ? ` Adds ${part.stepCount} ${part.stepsDraft ? "draft " : ""}SOP step${part.stepCount === 1 ? "" : "s"}.`
      : "";
  const due = dueOn ? ` Due ${dayLabel(dueOn, todayIso)}.` : "";
  return `Goes to ${part.listName} as "${part.taskName}". ${owner}${sop}${due}`;
}

/** "a", "a and b", "a, b and c". */
export function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/**
 * The writer's note on a task it handed back to the queue because requests
 * are not open (a dry run, or off the test card): "Waiting in the queue:
 * ...". Its wording names the writer's switch, so the screens say the held
 * sentence instead of showing it.
 */
const WAITING_NOTE = /^\s*Waiting in the queue\b/i;

/** Whether the writer held this task back (its note, or the old state). */
export const partWaiting = (part: Pick<PartRow, "state" | "error">) =>
  part.state === "dry_run" ||
  (["queued", "sending", "retry"].includes(part.state) &&
    WAITING_NOTE.test(part.error ?? ""));

/**
 * Whether a task of a request is only saved, not on its way: the writer
 * held it back, or requests are not open (`open` false) and it has not
 * reached a settled state. A delivered task is never held.
 */
export function partHeld(
  part: Pick<PartRow, "state" | "error">,
  open: boolean,
): boolean {
  if (partWaiting(part)) return true;
  return !open && ["queued", "sending", "retry"].includes(part.state);
}

/** Whether a task of a sent request is still on its way to ClickUp. */
export function partMoving(
  part: Pick<PartRow, "state" | "error">,
  open: boolean,
): boolean {
  return (
    !partHeld(part, open) &&
    ["queued", "sending", "retry", "unknown"].includes(part.state)
  );
}

/**
 * A request saved but not sent: the server says so (held), or every task
 * not yet in ClickUp was held back by the writer.
 */
export function requestHeld(
  row: Pick<RequestRow, "state" | "done" | "parts" | "held">,
): boolean {
  if (row.done) return false;
  if (row.held === true) return true;
  if (row.state === "dry_run") return false; // stateWords' own fallback
  const waiting = row.parts.filter(p => partWaiting(p));
  return (
    row.state === "sending" &&
    waiting.length > 0 &&
    row.parts.every(p => partWaiting(p) || p.state === "delivered")
  );
}

/**
 * A task in ClickUp that the cockpit could not finish (a refused step):
 * it is delivered, and its note says what to check. A quiet warning under
 * the task, never a failure.
 */
export function deliveredNote(
  part: Pick<PartRow, "state" | "error">,
): string | null {
  return part.state === "delivered" ? part.error?.trim() || null : null;
}

/**
 * The sent panel's lines, one per task, said by where the task really is:
 * "Saved. Goes to {list} when requests open." while requests are not open,
 * "Sending to {list}." on its way, "In {list}. Owner: {owner}." once it is
 * on the list. Never "in" a list before ClickUp has it. `open` is
 * requestsOpen() for the request's card.
 */
export function sentLines(
  parts: Pick<PartRow, "listName" | "owner" | "state" | "error" | "url">[],
  open: boolean,
): string[] {
  return parts.map(p => {
    if (partHeld(p, open))
      return p.url
        ? REQUEST_SENTENCES.heldInList(p.listName)
        : REQUEST_SENTENCES.held(p.listName);
    switch (p.state) {
      case "delivered":
        return REQUEST_SENTENCES.inList(
          p.listName,
          p.owner.how === "none" || !p.owner.label
            ? "nobody yet"
            : p.owner.label,
        );
      case "unknown":
        return REQUEST_SENTENCES.checkingIn(p.listName);
      case "failed":
      case "skipped":
        return REQUEST_SENTENCES.notSentTo(p.listName, reason(p.error));
      case "imported":
        return "On All Tasks in ClickUp.";
    }
    return REQUEST_SENTENCES.sendingTo(p.listName);
  });
}

/** Types grouped by team, in the server's order, with a search applied. */
export function groupTypes(
  types: TypeView[],
  search = "",
): { team: Team; teamLabel: string; types: TypeView[] }[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = types.filter(t => {
    if (!words.length) return true;
    const hay = [t.label, t.teamLabel, ...t.parts.map(p => p.teamLabel)]
      .join(" ")
      .toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const groups: { team: Team; teamLabel: string; types: TypeView[] }[] = [];
  for (const t of hits) {
    let g = groups.find(x => x.team === t.team);
    if (!g) {
      g = { team: t.team, teamLabel: t.teamLabel, types: [] };
      groups.push(g);
    }
    g.types.push(t);
  }
  return groups;
}

/**
 * Whether a request is still open: not done, cancelled or routed, and not an
 * old form ticket already handled in ClickUp (the database sorts those as
 * not open, review round 3).
 */
export const isOpen = (
  row: Pick<RequestRow, "state" | "done"> & { importHandled?: boolean },
) =>
  !row.done &&
  !["cancelled", "routed"].includes(row.state) &&
  !row.importHandled;
