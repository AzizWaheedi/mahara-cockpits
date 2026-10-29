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

/**
 * When a part runs (cockpit_request_types_read, migration 20261028a): the
 * choice question that decides it and the choices that make it run, named as
 * the form shows them.
 */
export type PartWhen = { fieldKey: string; options: Option[] };

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
  /**
   * 20261028a, every seat: null when the part always runs, else the choices
   * that make it run. A database from before it sends no key, and the form
   * then draws no routing marks.
   */
  when?: PartWhen | null;
  /**
   * 20261028a, every seat: the SOP steps the writer adds as the checklist,
   * in order (drafts included; stepsDraft says so); null with a ClickUp
   * template. Absent from an older database: the form shows the count only.
   */
  steps?: string[] | null;
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
  /** The writer's mode (cockpit_request_writer_view sends it too). */
  mode?: WriterMode;
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
  /**
   * Above Send while a required choice has no option ClickUp gives: the
   * request cannot be sent here, so the way out is the ClickUp request form
   * (review T3-design-clarity-05).
   */
  lostBlocked: (question: string) =>
    `This request cannot be sent here until ClickUp's choices for "${question}" are back. Use the ClickUp request form for now, or ask the systems manager.`,
  /** The error summary's lead when every answer in it is a lost choice. */
  lostLead: "This request cannot be sent here yet:",
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
  /**
   * Under the writer's sentence once a type is picked while requests are not
   * open to the seat. Worded for every refusal, a writer gone quiet after
   * requests opened included, never "once requests are switched on" (review
   * CL-04, BT-7); with answers already given, they stay on screen to copy.
   */
  offAsked:
    "This request is made on the ClickUp request form for now, so the cockpit asks you nothing here. The same questions open here once the cockpit can send requests for you.",
  offKept:
    "This request is made on the ClickUp request form for now. Your answers stay here, to copy into it.",
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
export function partialNext(row: {
  parts: Pick<PartRow, "state" | "listName">[];
}): string {
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

/**
 * Types grouped by team: in the server's order, or with a search applied, in
 * the order searchTypes ranks them (the form's own search).
 */
export function groupTypes(
  types: TypeView[],
  search = "",
): { team: Team; teamLabel: string; types: TypeView[] }[] {
  const hits = search.trim()
    ? searchTypes(types, search).hits.map(h => h.type)
    : types;
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

// ---------------------------------------------------------------------------
// The department map (tickets-look-1028; the CEO's ask of 2026-10-28: "easy
// for the team to understand what is for which department and what happens
// exactly"). How each team and each request looks, the search that forgives,
// and the route before and after Send, as plain data and pure functions: the
// form only draws them, and the tests read them without a DOM. Icons are
// lucide names as strings, since this file imports nothing; the form maps
// each name to its component and falls back to the neutral Ticket.

/** The neutral mark, the cockpit's own requests icon. */
export const NEUTRAL_ICON = "Ticket";

/**
 * A department on the map: its mark, one plain line, its featured requests,
 * and a pointer to requests filed under another team that people often look
 * for here (review CL-09): a question and type keys, shown only for the keys
 * on offer and filed elsewhere, each with the team it is under.
 */
export type TeamLook = {
  icon: string;
  line: string;
  examples: string[];
  related?: { ask: string; keys: string[] };
};

/**
 * The five departments, keyed by team. The five ClickUp lists are constants
 * on the server, so editors cannot add one. The examples are type keys, and
 * the form shows only those on offer whose own team is this one.
 */
export const TEAM_LOOK: Partial<Record<Team, TeamLook>> = {
  client_success: {
    icon: "HeartHandshake",
    line: "Billing, payment cards, licences, WhatsApp and service changes for a client",
    examples: ["card_missing", "whatsapp_connection", "ad_spend_invoice"],
  },
  tech: {
    icon: "Wrench",
    line: "Lead forms, missing leads, pages, client set-up changes and team access",
    examples: ["missing_leads", "connect_lead_form", "client_pause"],
  },
  ads: {
    icon: "Megaphone",
    line: "Ad accounts and campaigns, and the ads side of a pause, relaunch or exit",
    examples: ["create_ad_account", "edit_campaign", "ads_request"],
    related: {
      ask: "Ads stopped because a payment card failed?",
      keys: ["card_missing"],
    },
  },
  creative: {
    icon: "Palette",
    line: "Scripts, social media posts and WhatsApp campaigns",
    examples: ["new_script", "social_media", "whatsapp_reactivation"],
  },
  call_center: {
    icon: "Headset",
    line: "Leads who do not book a call, or book one and do not show up",
    examples: ["low_show_rate", "low_schedule_rate"],
    related: {
      ask: "Changing who calls a client's leads?",
      keys: ["dfy_to_dwy", "dwy_to_dfy"],
    },
  },
};

/** The general requests, offered when nothing else fits. */
export const GENERAL_KEYS = [
  "general_tech",
  "general_csm",
  "general_marketing",
];

/** A request's own look, keyed by type.key (stable; editors cannot change it). */
export type TypeLook = {
  icon: string;
  /** What it is for, in the asker's words: one line, no full stop. */
  line: string;
  /** Hidden search words; a phrase of two or more words outranks single words. */
  words: string[];
  /**
   * Short headings over a long set of questions, each over the question keys
   * it holds. Used only while each heading's questions still sit together in
   * the order the server sends.
   */
  groups?: { title: string; keys: string[] }[];
  /** How a deciding question's condition starts, by its key: "If the problem is". */
  when?: Record<string, string>;
  /**
   * The request that does the opposite, and the phrases that say which way
   * ("to dwy"): while both are found, Return opens this one only when the
   * search holds one of these and none of the opposite's, since "our call
   * centre" is said both to ask for it and to drop it (review T2-clarity-02).
   */
  opposite?: { key: string; toward: string[] };
};

export const TYPE_LOOK: Record<string, TypeLook> = {
  ad_spend_invoice: {
    icon: "ReceiptText",
    line: "A client needs an invoice for their ad spend over a period",
    words: [
      "bill",
      "billing",
      "receipt",
      "spend",
      "ad spend",
      "invoice for ads",
    ],
  },
  whatsapp_connection: {
    icon: "MessageCircleWarning",
    line: "A client's WhatsApp is disconnected from the CRM and needs a new QR scan",
    words: [
      "qr",
      "qr code",
      "disconnected",
      "reconnect",
      "logged out",
      "whats app",
      "not connected",
    ],
  },
  dfy_to_dwy: {
    icon: "PhoneForwarded",
    line: "Done for you to done with you: the client's own team calls their leads from now on",
    // Where it goes to, never where it comes from: "to dwy", not "dfy".
    words: [
      "done with you",
      "to done with you",
      "to dwy",
      "dwy",
      "handover",
      "hand over",
      "hand over calls",
      "own callers",
      "own team",
      "sales team",
      "client takes over",
      "client calls",
      "client will call",
      "calls their own leads",
      "call leads themselves",
      "client handles",
      "handle calls",
      "do the calls",
      "do the calling",
      "stop calling",
      "stop call centre",
      "stop call center",
    ],
    opposite: { key: "dwy_to_dfy", toward: ["to dwy", "done with you"] },
  },
  dwy_to_dfy: {
    icon: "PhoneIncoming",
    line: "Done with you to done for you: our call centre calls the client's leads again",
    words: [
      "done for you",
      "to done for you",
      "to dfy",
      "dfy",
      "take back calls",
      "take back the calls",
      "calls back",
      "our team",
      "we take over",
      "we take back",
      "we call",
      "us to call",
      "call the leads again",
      "our callers",
      "our call centre",
      "our call center",
    ],
    opposite: { key: "dfy_to_dwy", toward: ["to dfy", "done for you"] },
  },
  csm_request: {
    icon: "Contact",
    line: "Ask the client's CSM to handle something for one client, such as a call",
    words: ["account manager", "client call", "follow up", "check in", "csm"],
  },
  business_licence: {
    icon: "FileExclamationPoint",
    line: "A platform needs the client's commercial licence, for example for Meta verification",
    words: [
      "license",
      "trade licence",
      "trade license",
      "commercial registration",
      "verification",
      "documents",
    ],
  },
  card_missing: {
    icon: "CreditCard",
    line: "A client's ads stopped because their payment card is missing or failed",
    words: [
      "payment",
      "card declined",
      "declined",
      "rejected",
      "visa",
      "billing",
      "ads stopped",
      "failed payment",
      "payment failed",
      "credit card",
      "card expired",
      "expired",
      "payment method",
      "add card",
      "new card",
      "update card",
      "no card",
      "card on the ad account",
      "billing issue",
      "billing problem",
      "payment issue",
      "payment problem",
      "card problem",
      "card not working",
      "ads not running",
    ],
  },
  general_csm: {
    icon: "HeartHandshake",
    line: "Client success work that fits no other request, with or without a client",
    words: ["other", "question", "help", "anything", "csm"],
  },
  connect_lead_form: {
    icon: "Cable",
    line: "Connect a client's new Meta, TikTok or Snapchat lead form to the CRM",
    words: [
      "instant form",
      "lead ads",
      "crm",
      "integration",
      "tiktok",
      "snapchat",
      "meta",
      "facebook",
    ],
  },
  missing_leads: {
    icon: "Inbox",
    line: "New leads are not reaching the client's CRM or the dialer",
    words: [
      "no leads",
      "no new leads",
      "lost leads",
      "zero leads",
      "leads not",
      "leads missing",
      "leads stopped",
      "stopped coming",
      "disappeared",
      "not arriving",
      "not coming",
      "not reaching",
      "not getting",
      "not receiving",
      "not syncing",
      "not showing",
      "dialer",
      "lead form",
      "ghl",
      "gohighlevel",
    ],
  },
  employee_onboarding: {
    icon: "UserRoundPlus",
    line: "A new team member starts and needs Slack, ClickUp and CRM access",
    words: [
      "new hire",
      "hire",
      "hired someone",
      "recruit",
      "joiner",
      "new joiner",
      "joining the team",
      "someone new",
      "new person",
      "colleague",
      "new colleague",
      "new team member",
      "starter",
      "new starter",
      "new staff",
      "new employee",
      "onboard",
      "access",
      "set up accounts",
      // A start, so "first day" is never only an offboarding's "last day"
      // (review T2-clarity-01).
      "first day",
      "start date",
      "starting",
      "starts",
    ],
  },
  employee_offboarding: {
    icon: "UserRoundMinus",
    line: "A team member leaves, and their access and seats must be removed",
    words: [
      "leaver",
      "leaving",
      "remove access",
      "resign",
      "resigned",
      "quit",
      "last day",
    ],
  },
  privacy_policy: {
    icon: "FileLock",
    line: "A lead form, landing page, app or website needs a privacy policy page",
    words: ["policy", "legal", "terms", "gdpr"],
  },
  qualification_questions: {
    icon: "ListChecks",
    line: "Add the client's own qualifying questions to their ad lead form",
    words: ["survey", "screening", "qualify", "lead form questions"],
  },
  client_offboarding: {
    icon: "LogOut",
    line: "A client is leaving Mahara: wind down their systems and their ads",
    words: [
      "churn",
      "cancel",
      "terminate",
      "exit",
      "end contract",
      "lost client",
      // A client who quits or leaves, never only an employee's offboarding
      // (review T2-clarity-01).
      "quit",
      "leave",
      "leaving",
      "client leaving",
      "client quit",
    ],
  },
  client_pause: {
    icon: "Pause",
    line: "Stop a client's ads and systems for a short break",
    words: [
      "hold",
      "on hold",
      "freeze",
      "freeze account",
      "stop ads",
      "stop running ads",
      "stop campaign",
      "stop everything",
      "break",
      "taking a break",
      "turn off ads",
      "switch off ads",
      "ads off",
    ],
  },
  client_relaunch: {
    icon: "Play",
    line: "Bring a client's ads and systems back after a break",
    words: [
      "restart",
      "resume",
      "back live",
      "turn back on",
      "unpause",
      "start ads again",
    ],
  },
  company_name: {
    icon: "PenLine",
    line: "A client's company name changed and must be updated everywhere",
    words: ["rename", "rebrand", "new name", "brand name"],
  },
  company_address: {
    icon: "MapPin",
    line: "A client's company address changed and must be updated",
    words: ["move", "moved", "new address", "location", "office"],
  },
  funnel_intent: {
    icon: "Funnel",
    line: "Switch a client's funnel to high, mid or low intent",
    words: [
      "intent",
      "lead quality",
      "high intent",
      "low intent",
      "funnel swap",
    ],
  },
  landing_page: {
    icon: "PanelsTopLeft",
    line: "Build a new landing page for a client's campaign",
    words: ["page", "website", "web page", "funnel page", "lp"],
  },
  general_tech: {
    icon: "Wrench",
    line: "Tech or systems work that fits no other request, with or without a client",
    words: [
      "other",
      "systems",
      "automation",
      "make",
      "zapier",
      "bug",
      "broken",
      "help",
    ],
  },
  create_ad_account: {
    icon: "SquarePlus",
    line: "A client needs a new ad account on Meta, TikTok or Snapchat",
    words: [
      "new account",
      "ad account",
      "business manager",
      "tiktok",
      "snapchat",
      "meta",
      "facebook",
    ],
    when: { ads_platform: "If the platform is" },
  },
  ads_request: {
    icon: "Target",
    line: "Ads work for one client that fits no other request",
    words: ["campaign", "ads change", "media buyer"],
  },
  edit_campaign: {
    icon: "SlidersHorizontal",
    line: "Change a live campaign's budget, audience, creative or form",
    words: [
      "budget",
      "audience",
      "targeting",
      "change campaign",
      "creative swap",
      "edit ads",
    ],
  },
  general_marketing: {
    icon: "Megaphone",
    line: "Marketing work that fits no other request, with or without a client",
    words: ["other", "marketing", "help"],
  },
  whatsapp_reactivation: {
    icon: "MessagesSquare",
    line: "Win back a client's old leads with a WhatsApp message campaign",
    words: [
      "broadcast",
      "old leads",
      "reengage",
      "re engage",
      "win back",
      "whats app",
      "reactivate",
    ],
  },
  new_script: {
    icon: "ScrollText",
    line: "A script for an ad, a reel, a video sales letter, a webinar or a message sequence",
    words: ["copy", "copywriting", "reel", "vsl", "ugc", "video", "writing"],
    groups: [
      {
        title: "The script",
        keys: ["script_type", "script_style", "orientation", "script_quantity"],
      },
      {
        title: "Filming and language",
        keys: ["who_films", "script_language", "arabic_dialect"],
      },
    ],
  },
  social_media: {
    icon: "Share2",
    line: "A month of social media posts for a client with the social media upsell",
    words: ["instagram", "facebook", "posts", "content", "smm", "social"],
  },
  low_show_rate: {
    icon: "CalendarX",
    line: "Leads book a call but do not show up for it",
    words: [
      "no show",
      "no shows",
      "show up",
      "missed calls",
      "appointments",
      "show rate",
    ],
  },
  low_schedule_rate: {
    icon: "CalendarClock",
    line: "Too few leads book a call, because of the ads, the calls or both",
    words: ["booking rate", "bookings", "not booking", "booked", "schedule"],
    when: { schedule_rate_issue: "If the problem is" },
  },
};

const unique = <T>(xs: T[]) => xs.filter((x, i) => xs.indexOf(x) === i);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A team's look, or the neutral one for a team the map does not know. */
export function teamLook(team: string | null | undefined): TeamLook {
  return (
    (team ? TEAM_LOOK[team as Team] : undefined) ?? {
      icon: NEUTRAL_ICON,
      line: "",
      examples: [],
    }
  );
}

/**
 * The owner rule no seat holds while no media buyer is named (facts 1.4):
 * its tasks go to the systems manager, so it is never named as an owner
 * (judge 0, mustFix 1; review CL-12, BT-12).
 */
const UNHELD_RULE = "the media buyer of record";

/**
 * A request's look by its key. A key the map does not know (a type a
 * migration adds later) takes its team's mark, else the neutral one, and a
 * line built from its own data: "Goes to {reach words}. Owner: {rule}", in
 * the plate's and the row's own reach words, so it is true for every answer
 * and never names a team no offered choice reaches (review BT-6, S4); the
 * owner left out while its rule is one nobody holds. `ahead`: requests are
 * not open to the seat, so the words name the deciding question, as the
 * plate and the row do (reachPieces).
 */
export function typeLook(
  t: Pick<TypeView, "key" | "team" | "teamLabel" | "fields" | "parts">,
  ahead = false,
): TypeLook {
  const own = TYPE_LOOK[t.key];
  if (own) return own;
  const parts = reachableParts(t.parts);
  const rules = unique(parts.map(p => p.ruleLabel).filter(Boolean));
  if (rules.includes(UNHELD_RULE)) rules.length = 0;
  return {
    icon: TEAM_LOOK[t.team]?.icon ?? NEUTRAL_ICON,
    line: parts.length
      ? `Goes to ${reachText(t, ahead)}${rules.length ? `. Owner: ${joinWords(rules)}` : ""}`
      : "",
    words: [],
  };
}

/** The team a ClickUp list name belongs to (one of the five lists), else null. */
export const teamOfList = (name: string): Team | null =>
  TARGET_LISTS.find(l => l.name === name)?.team ?? null;

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** "one" to "ten", then digits. */
export const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** "One task", "Two tasks", "Three tasks", for every number. */
export const countWords = (n: number, one: string, many = `${one}s`) =>
  capital(`${numberWord(n)} ${n === 1 ? one : many}`);

/** "a", "a or b", "a, b or c". */
export function joinOr(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`;
}

/** Whole days, Sunday to Thursday, Kuwait time. */
const weekdayOf = (iso: string) => new Date(dayMs(iso)).getUTCDay();

/** The first working day (Sunday to Thursday) after a Kuwait day. */
export function nextWorkingDay(iso: string): string {
  let day = addDays(iso, 1);
  while (weekdayOf(day) === 5 || weekdayOf(day) === 6) day = addDays(day, 1);
  return day;
}

export type DueChoice = { iso: string; tag: "usual" | "sooner" | "later" };

/**
 * The due day's two quick choices: the type's usual day (TypeView.dueDefault,
 * which the server counts) and the next working day; when those are the same
 * day, the working day after it. "Pick a day" holds the native date input.
 */
export function dueChoices(
  usual: string,
  todayIso: string = kuwaitToday(),
): DueChoice[] {
  let other = nextWorkingDay(todayIso);
  if (other === usual) other = nextWorkingDay(usual);
  // In date order, the usual one tagged wherever it falls (review D16, CL-11).
  return other < usual
    ? [
        { iso: other, tag: "sooner" },
        { iso: usual, tag: "usual" },
      ]
    : [
        { iso: usual, tag: "usual" },
        { iso: other, tag: "later" },
      ];
}

export type ChoiceControl = "pills" | "radios" | "select";

/**
 * The control a choice question gets, by its number of choices (research
 * 2.6): pills for up to five short choices, a list of radios up to ten, and
 * the native select beyond ten, or when ClickUp's choices could not be read.
 */
export function choiceControl(
  field: Pick<FieldView, "options">,
): ChoiceControl {
  const options = field.options ?? [];
  if (!options.length || options.length > 10) return "select";
  if (options.length <= 5 && options.every(o => [...o.name].length <= 22))
    return "pills";
  return "radios";
}

/**
 * Whether some answer the form can give makes the part run: always (when
 * null or unknown), or for a choice still offered. A part whose `when` keeps
 * no choice (ClickUp dropped every one it runs on, or lost the question;
 * 20261028a sends options []) never runs, so no routing word or lane names
 * its team (review BT-6, S4).
 */
export const partReachable = (p: Pick<TypePartView, "when">) =>
  !p.when || p.when.options.length > 0;

/** The parts some answer can make run (partReachable). */
const reachableParts = <P extends Pick<TypePartView, "when">>(parts: P[]) =>
  parts.filter(partReachable);

/** The questions whose answer decides which tasks run, in the server's order. */
export function routingFields(
  type: Pick<TypeView, "fields" | "parts">,
): FieldView[] {
  const keys = new Set(
    reachableParts(type.parts)
      .map(p => p.when?.fieldKey ?? "")
      .filter(Boolean),
  );
  return type.fields.filter(f => keys.has(f.key));
}

/** Whether the database says when every part runs (20261028a sends `when`). */
export const routesKnown = (type: Pick<TypeView, "parts">) =>
  type.parts.length > 0 && type.parts.every(p => p.when !== undefined);

/** What each answer of a deciding question makes: its tasks and their lists. */
export function answerRoutes(
  type: Pick<TypeView, "parts">,
  field: Pick<FieldView, "key" | "options">,
): { option: Option; parts: TypePartView[]; lists: string[] }[] {
  return (field.options ?? []).map(option => {
    const parts = type.parts.filter(p =>
      p.when === null
        ? true
        : p.when?.fieldKey === field.key &&
          p.when.options.some(o => o.id === option.id),
    );
    return { option, parts, lists: unique(parts.map(p => p.listName)) };
  });
}

/**
 * The team each answer of a deciding question reaches, for the second line of
 * its choice ("Ads issue / Marketing / ADs", "Both / Both teams"), by option
 * id; null when every answer reaches the same teams.
 */
export function answerTeamLines(
  type: Pick<TypeView, "parts">,
  field: Pick<FieldView, "key" | "options">,
): Record<string, string> | null {
  const routes = answerRoutes(type, field);
  if (unique(routes.map(r => r.lists.join("|"))).length < 2) return null;
  const out: Record<string, string> = {};
  for (const r of routes)
    out[r.option.id] =
      r.lists.length === 0
        ? "No task"
        : r.lists.length === 1
          ? r.lists[0]
          : r.lists.length === 2
            ? "Both teams"
            : `All ${numberWord(r.lists.length)} teams`;
  return out;
}

/** A condition in words: "If the problem is Call Center Issue or Both". */
export function conditionWords(
  type: Pick<TypeView, "key" | "fields">,
  when: PartWhen,
): string {
  const names = when.options.map(o => o.name);
  if (!names.length) return "For a choice that could not be read from ClickUp";
  const lead = TYPE_LOOK[type.key]?.when?.[when.fieldKey];
  if (lead) return `${lead} ${joinOr(names)}`;
  const label = type.fields.find(f => f.key === when.fieldKey)?.label;
  return `If "${label ?? when.fieldKey}" is ${joinOr(names)}`;
}

/** Where a request goes, as text and team names (the form puts a mark on each name). */
export type ReachPiece =
  | { team: Team | null; label: string }
  | { text: string };

/**
 * Where a request goes, in words true for every answer (judge 0, mustFix 1):
 * "Operations / Tech and Marketing / ADs"; "Call Center, Marketing / ADs or
 * both, by your answer"; "Operations / Tech, and Marketing / ADs for Ads
 * issue or Both". A database from before 20261028a does not say which tasks
 * depend on an answer, so the teams are joined with "and", as before.
 * `ahead`: requests are not open to the seat, so no answer is asked here and
 * the words name the deciding question as the route does ('or both,
 * depending on the answer to "Where is the problem?"'; review T2-clarity-04).
 */
export function reachPieces(
  type: Pick<TypeView, "teamLabel" | "fields" | "parts">,
  ahead = false,
): ReachPiece[] {
  const parts = reachableParts(type.parts);
  const lists = unique(parts.map(p => p.listName));
  const team = (label: string): ReachPiece => ({
    team: teamOfList(label),
    label,
  });
  const joined = (labels: string[], word: "and" | "or"): ReachPiece[] =>
    labels.flatMap((label, i) => [
      ...(i === 0
        ? []
        : [{ text: i === labels.length - 1 ? ` ${word} ` : ", " }]),
      team(label),
    ]);
  if (lists.length <= 1 || !routesKnown(type))
    return joined(lists.length ? lists : [type.teamLabel], "and");
  const always = unique(
    parts.filter(p => p.when === null).map(p => p.listName),
  );
  const sometimes = lists.filter(l => !always.includes(l));
  if (!sometimes.length) return joined(always, "and");
  if (!always.length) {
    const fields = routingFields(type);
    const by = !ahead
      ? "by your answer"
      : fields.length === 1
        ? ROUTE_WORDS.dependsOn(fields[0].label)
        : "depending on the answers";
    const routes = fields.length === 1 ? answerRoutes(type, fields[0]) : [];
    if (fields.length !== 1 || !routes.some(r => r.lists.length > 1))
      return [...joined(sometimes, "or"), { text: `, ${by}` }];
    if (sometimes.length === 2)
      return [
        team(sometimes[0]),
        { text: ", " },
        team(sometimes[1]),
        { text: ` or both, ${by}` },
      ];
    return [
      { text: "One or more of " },
      ...joined(sometimes, "and"),
      { text: `, ${by}` },
    ];
  }
  const out = joined(always, "and");
  for (const label of sometimes) {
    const names = unique(
      parts
        .filter(p => p.listName === label)
        .flatMap(p => p.when?.options.map(o => o.name) ?? []),
    );
    out.push({ text: ", and " }, team(label), {
      text: names.length ? ` for ${joinOr(names)}` : " for some answers",
    });
  }
  return out;
}

/** reachPieces as one line of text. */
export const reachText = (
  type: Pick<TypeView, "teamLabel" | "fields" | "parts">,
  ahead = false,
) =>
  reachPieces(type, ahead)
    .map(p => ("text" in p ? p.text : p.label))
    .join("");

/** One fact on a request's row; `pieces` carries team names for their marks. */
export type TypeFact = {
  kind: "days" | "priority" | "home" | "also" | "reach" | "client";
  text: string;
  team?: Team | null;
  pieces?: ReachPiece[];
};

/** "Due in 2 working days", "Due in 1 working day", "Due today". */
export const workingDaysWords = (n: number) =>
  n <= 0 ? "Due today" : `Due in ${n} working day${n === 1 ? "" : "s"}`;

/**
 * A request's own facts on its row: its team when the list is not one team's
 * (`named`), its usual working days, a priority other than normal, its home
 * team when it is listed under another team, where else it goes (true for
 * every answer), and its client rule. `ahead`: requests are not open to the
 * seat, so the reach words name the deciding question (reachPieces).
 */
export function typeFacts(
  type: TypeView,
  viewTeam: Team | null = null,
  named = false,
  ahead = false,
): TypeFact[] {
  const out: TypeFact[] = [];
  const parts = reachableParts(type.parts);
  const lists = unique(parts.map(p => p.listName));
  const conditional =
    routesKnown(type) &&
    lists.length > 1 &&
    parts.some(p => p.when) &&
    lists.some(l => !parts.some(p => p.listName === l && p.when === null));
  const pieces = conditional ? reachPieces(type, ahead) : null;
  // The reach words already name the home team: said once (review D16).
  const homeSaid = Boolean(
    pieces?.some(p => "label" in p && p.label === type.teamLabel),
  );
  if (named && !homeSaid)
    out.push({ kind: "home", text: type.teamLabel, team: type.team });
  out.push({ kind: "days", text: workingDaysWords(type.dueDays) });
  if (type.priority !== "normal")
    out.push({
      kind: "priority",
      text:
        type.priority === "urgent"
          ? "Urgent"
          : `${capital(type.priority)} priority`,
    });
  if (viewTeam && viewTeam !== type.team && !homeSaid)
    out.push({
      kind: "home",
      text: `Filed under ${type.teamLabel}`,
      team: type.team,
    });
  if (pieces) {
    out.push({
      kind: "reach",
      text: pieces.map(p => ("text" in p ? p.text : p.label)).join(""),
      pieces,
    });
  } else
    for (const label of lists)
      if (label !== type.teamLabel && teamOfList(label) !== viewTeam)
        out.push({
          kind: "also",
          text: `Also ${label}`,
          team: teamOfList(label),
        });
  const client = clientField(type);
  if (!client) out.push({ kind: "client", text: "No client" });
  else if (!client.required)
    out.push({ kind: "client", text: "Client optional" });
  return out;
}

/**
 * The requests a team takes (graft 9): its own first, then every other
 * request with a task for it (named with its home team on the row), each in
 * the server's order.
 */
export function teamTypes(types: TypeView[], team: Team): TypeView[] {
  const label = TEAM_LABEL[team];
  return [
    ...types.filter(t => t.team === team),
    ...types.filter(
      t =>
        t.team !== team &&
        reachableParts(t.parts).some(
          p => p.listName === label || p.teamLabel === label,
        ),
    ),
  ];
}

/**
 * The requests filed under another team that give this team a task only for
 * some answers (Low schedule rate's Marketing / ADs task runs on "Ads issue"
 * or "Both"), so a team's page never says every one of them "also gives it a
 * task" (review T3-design-clarity-02). Only a database that says when each
 * task runs (routesKnown) can tell; an older one counts none.
 */
export function teamByAnswer(types: TypeView[], team: Team): TypeView[] {
  const label = TEAM_LABEL[team];
  return teamTypes(types, team).filter(t => {
    if (t.team === team || !routesKnown(t)) return false;
    const here = reachableParts(t.parts).filter(
      p => p.listName === label || p.teamLabel === label,
    );
    if (!here.length || here.some(p => !p.when)) return false;
    // Every task here runs on one question: it always makes one when its
    // answers cover every choice of that question (one task per answer).
    const keys = unique(here.map(p => p.when?.fieldKey ?? ""));
    const field =
      keys.length === 1 ? t.fields.find(f => f.key === keys[0]) : undefined;
    const covered = new Set(
      here.flatMap(p => (p.when?.options ?? []).map(o => o.id)),
    );
    return !(
      field?.required &&
      (field.options ?? []).length > 0 &&
      (field.options ?? []).every(o => covered.has(o.id))
    );
  });
}

/**
 * A team's pointer to requests filed under another team that people often
 * look for there (TeamLook.related, review CL-09): those on offer, filed
 * elsewhere and not in the team's own list, with the team each is under.
 */
export function teamRelated(
  types: TypeView[],
  team: Team,
): { ask: string; types: TypeView[] } | null {
  const related = teamLook(team).related;
  if (!related) return null;
  const listed = teamTypes(types, team);
  const hits = related.keys
    .map(k => types.find(t => t.key === k))
    .filter(
      (t): t is TypeView =>
        Boolean(t) && t?.team !== team && !listed.includes(t as TypeView),
    );
  return hits.length ? { ask: related.ask, types: hits } : null;
}

/**
 * A department tile's shortcuts: its featured requests on offer, then its
 * other own requests, up to n. The general requests have their own tile.
 */
export function teamExamples(types: TypeView[], team: Team, n = 3): TypeView[] {
  const own = types.filter(
    t => t.team === team && !GENERAL_KEYS.includes(t.key),
  );
  const featured = teamLook(team)
    .examples.map(k => own.find(t => t.key === k))
    .filter((t): t is TypeView => Boolean(t));
  return [...featured, ...own.filter(t => !featured.includes(t))].slice(0, n);
}

/** Every request on offer, A to Z: the flat list one click from the map. */
export const everyType = (types: TypeView[]) =>
  [...types].sort((a, b) => a.label.localeCompare(b.label, "en"));

// --- Search that forgives (graft 8) ----------------------------------------

/** Words a search ignores: they say nothing about which request it is. */
const FILLER = new Set(
  "a an the for on from will their them they to of in is are was it its my our we and or with at by be has have had this that these those you your me us his her he she please need needs want wants can could would should do does did get got some any so but if when then again also just too very all more not no what where which who how why there here about into after before up out off".split(
    " ",
  ),
);

/** Lower-case words: letters and digits, two or more of them. */
const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 1);

/**
 * Everyday words that say little about which request it is ("client",
 * "issue", "new"): they add a little to the score but never count as a
 * matched word, unless the search holds nothing else.
 */
const WEAK = new Set(
  "client clients issue issues problem problems request requests new change changes someone person people today now".split(
    " ",
  ),
);

/**
 * A word's root, so "calls", "calling" and "callers" meet, and "joining"
 * meets "joiner": one ending taken off, never below three letters, then a
 * doubled last letter ("stopped", "getting") and a last e ("receive").
 */
function stem(word: string): string {
  let s = word;
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else
    for (const end of ["ings", "ing", "ers", "er", "ed", "es", "s"]) {
      if (s.length - end.length < 3 || !s.endsWith(end)) continue;
      if (end === "s" && /(ss|us|is)$/.test(s)) break;
      s = s.slice(0, -end.length);
      break;
    }
  if (s.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

/**
 * A searched word finds a word that starts with it, a word of four letters
 * or more that it starts with and ends at most three letters after, or a
 * word with the same root: "stop" finds "stopped", "leads" finds "lead",
 * "calls" finds "calling", but "whatsapp" never finds "what".
 */
const wordFinds = (q: string, w: string) =>
  w.startsWith(q) ||
  (w.length >= 4 && q.length - w.length <= 3 && q.startsWith(w)) ||
  (q.length >= 3 && w.length >= 3 && stem(q) === stem(w));

const samePhraseWord = (a: string, b: string) => a === b || stem(a) === stem(b);

/**
 * Whether the words searched hold a phrase in its order. Between two of its
 * words may sit filler and everyday words ("stop the client's ads" holds
 * "stop ads") and at most one other word ("handles the calls" holds "handle
 * calls"); "dfy to dwy" holds "to dwy" but never "to dfy".
 */
function holdsPhrase(said: string[], phrase: string[]): boolean {
  const next = (from: number, word: string) => {
    let other = 0;
    for (let j = from; j < said.length && j < from + 4; j++) {
      if (samePhraseWord(said[j], word)) return j;
      if (FILLER.has(said[j]) || WEAK.has(said[j])) continue;
      if (++other > 1) return -1;
    }
    return -1;
  };
  for (let start = 0; start < said.length; start++) {
    if (!samePhraseWord(said[start], phrase[0])) continue;
    let at = start;
    for (const word of phrase.slice(1)) {
      at = next(at + 1, word);
      if (at < 0) break;
    }
    if (at >= 0) return true;
  }
  return false;
}

/** One letter wrong, missing, extra, or two swapped. */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  return a.length < b.length
    ? a.slice(i) === b.slice(i + 1)
    : a.slice(i + 1) === b.slice(i);
}

/** A searched word of four letters or more, one letter off a word or its start. */
const nearlyFinds = (q: string, w: string) =>
  q.length >= 4 &&
  (oneEdit(q, w) ||
    (w.length > q.length &&
      (oneEdit(q, w.slice(0, q.length)) ||
        oneEdit(q, w.slice(0, q.length + 1)))));

type Hay = {
  label: string[];
  words: string[];
  line: string[];
  questions: string[];
  teams: string[];
  phrases: string[][];
};
const FIELDS = ["label", "words", "line", "questions", "teams"] as const;
const WEIGHT: Record<(typeof FIELDS)[number], number> = {
  label: 8,
  words: 5,
  line: 3,
  questions: 2,
  teams: 1,
};

function hayOf(t: TypeView): Hay {
  const look = typeLook(t);
  const label = tokens(t.label);
  return {
    label,
    words: look.words.flatMap(tokens),
    line: tokens(look.line),
    questions: bodyFields(t).flatMap(f => tokens(f.label)),
    // A team no offered choice reaches finds nothing (review BT-6, S4).
    teams: unique([
      t.teamLabel,
      ...reachableParts(t.parts).map(p => p.teamLabel),
    ]).flatMap(tokens),
    phrases: look.words.map(tokens).filter(p => p.length > 1),
  };
}

/**
 * The most words of a request's own name the search holds in their order,
 * when two or more ("client offboarding", "new lead form"); else 0.
 */
function nameRun(said: string[], label: string[]): number {
  for (let k = label.length; k > 1; k--)
    for (let i = 0; i + k <= label.length; i++)
      if (holdsPhrase(said, label.slice(i, i + k))) return k;
  return 0;
}

/**
 * How rare a word is across the requests on offer, from 0 (every request
 * has it) to 1 (one request): a word most requests share ("ads", "lead")
 * weighs little.
 */
function rarity(q: string, hays: Hay[]): number {
  const n = hays.length;
  if (n < 2) return 1;
  const df = hays.filter(h =>
    [h.label, h.words, h.line, h.questions].some(f =>
      f.some(w => wordFinds(q, w)),
    ),
  ).length;
  const r = Math.log((n + 1) / (df + 0.5)) / Math.log((n + 1) / 1.5);
  return Math.min(1, Math.max(0, r));
}

export type SearchHit = {
  type: TypeView;
  /**
   * How many of the searched words it matched (the first sort). An everyday
   * word ("client", "issue", "new") counts only when the search has nothing
   * else.
   */
  count: number;
  /** How many words of its hidden phrases the search holds ("stop ads"). */
  phrases: number;
  /** The search says this request's way ("to dwy"; TypeLook.opposite). */
  toward: boolean;
  score: number;
  /** What found it when its name and line show none of the words. */
  via: string | null;
};

export type TypeSearch = {
  /** The words searched, after filler is dropped and any fix is made. */
  words: string[];
  hits: SearchHit[];
  /** Nothing matched as typed, and one wrong letter did: what was read. */
  fixed: { from: string; to: string } | null;
};

/** The words a search looks for: no filler, no single letters. */
export const searchTerms = (query: string) =>
  tokens(query).filter(w => !FILLER.has(w));

function rankTypes(
  types: TypeView[],
  terms: string[],
  said: string[],
): SearchHit[] {
  const hits: (SearchHit & { at: number })[] = [];
  const hays = types.map(hayOf);
  const strong = terms.filter(q => !WEAK.has(q));
  const counted = new Set(strong.length ? strong : terms);
  const rare = new Map(terms.map(q => [q, rarity(q, hays)]));
  types.forEach((type, at) => {
    const hay = hays[at];
    let count = 0;
    let score = 0;
    let seen = false;
    let hidden: string | null = null;
    for (const q of terms) {
      const field = FIELDS.find(f => hay[f].some(w => wordFinds(q, w)));
      if (!field) continue;
      // The field's weight, more for the word as typed than for its root,
      // more for a rare word, little for an everyday one; and one more for
      // each other field that holds it too (the name and the hidden words).
      const exact = hay[field].includes(q) ? 1 : 0.85;
      const also = (["label", "words", "line"] as const).filter(
        f => f !== field && hay[f].some(w => wordFinds(q, w)),
      ).length;
      score +=
        (WEIGHT[field] * exact * (0.5 + 0.5 * (rare.get(q) ?? 1)) + also) *
        (WEAK.has(q) ? 0.3 : 1);
      // A team name alone counts only for a one-word search ("tech").
      if (counted.has(q) && (field !== "teams" || terms.length === 1))
        count += 1;
      if (field === "label" || hay.line.some(w => wordFinds(q, w))) seen = true;
      else if (!hidden)
        hidden =
          field === "words"
            ? (typeLook(type).words.find(w =>
                tokens(w).some(x => wordFinds(q, x)),
              ) ?? null)
            : field === "questions"
              ? (bodyFields(type).find(f =>
                  tokens(f.label).some(x => wordFinds(q, x)),
                )?.label ?? null)
              : null;
    }
    if (!count) return;
    const phrases =
      hay.phrases
        .filter(p => holdsPhrase(said, p))
        .reduce((n, p) => n + p.length, 0) + nameRun(said, hay.label);
    hits.push({
      type,
      count,
      phrases,
      toward: Boolean(
        TYPE_LOOK[type.key]?.opposite?.toward.some(p =>
          holdsPhrase(said, tokens(p)),
        ),
      ),
      score: score + phrases * 3,
      via: seen ? null : hidden,
      at,
    });
  });
  hits.sort(
    (a, b) =>
      b.count - a.count ||
      b.phrases - a.phrases ||
      b.score - a.score ||
      a.at - b.at,
  );
  // Two words: only what matches both. A sentence: one word fewer than the best.
  const best = hits[0]?.count ?? 0;
  const floor = Math.max(1, best >= 3 ? best - 1 : best);
  return hits.filter(h => h.count >= floor).map(({ at: _at, ...h }) => h);
}

/**
 * The form's search: filler words ignored; a request's name, hidden words,
 * line, question labels and team names, in that weight; a word finds its
 * own root ("calls" finds "calling"); ranked by how many of the words it
 * matches (an everyday word such as "client" or "issue" not counted), then
 * by the hidden phrases the search holds in their order ("stop ads" puts
 * Client pause first, "dfy to dwy" puts Change from DFY to DWY first), then
 * by weight, a rare word weighing more, then the server's order. For two
 * words only what matches both stays, and for a sentence what matches one
 * word fewer than the best. One wrong letter is allowed only when nothing
 * matches as typed.
 */
export function searchTypes(types: TypeView[], query: string): TypeSearch {
  const said = tokens(query);
  const terms = said.filter(w => !FILLER.has(w));
  if (!terms.length) return { words: [], hits: [], fixed: null };
  const hits = rankTypes(types, terms, said);
  if (hits.length) return { words: terms, hits, fixed: null };
  const vocab = unique(
    types.flatMap(t => {
      const h = hayOf(t);
      return [...h.label, ...h.words, ...h.line, ...h.questions, ...h.teams];
    }),
  );
  let changed = false;
  const fixedTerms = terms.map(q => {
    const near = vocab.find(w => nearlyFinds(q, w));
    if (!near || near === q) return q;
    changed = true;
    return near;
  });
  if (!changed) return { words: terms, hits: [], fixed: null };
  const again = rankTypes(types, fixedTerms, fixedTerms);
  if (!again.length) return { words: terms, hits: [], fixed: null };
  return {
    words: fixedTerms,
    hits: again,
    fixed: { from: query.trim(), to: fixedTerms.join(" ") },
  };
}

/**
 * Whether the first hit stands ahead of the next on the words it matched or
 * the phrases it holds, so Return may open it. A lead only by weight or by
 * the server's order is no lead: the list is shown for the person to pick.
 * Nor is one of two opposite requests (the DFY and DWY switches) while the
 * other is found too, unless the search says its way and not the other's:
 * "client no longer wants our call centre" holds the opposite's "our call
 * centre" (review T2-clarity-02).
 */
export function searchLeads(found: TypeSearch): boolean {
  const [first, next] = found.hits;
  if (!first) return false;
  const opposite = TYPE_LOOK[first.type.key]?.opposite;
  const other = opposite
    ? found.hits.find(h => h.type.key === opposite.key)
    : undefined;
  if (other && (!first.toward || other.toward)) return false;
  return !next || first.count > next.count || first.phrases > next.phrases;
}

/** The search's line: what matched, and what was read when a letter was off. */
export function searchCountWords(query: string, found: TypeSearch): string {
  const n = found.hits.length;
  const match = (k: number) =>
    `${k} request${k === 1 ? " matches" : "s match"}`;
  if (found.fixed)
    return `No match for "${found.fixed.from}". ${match(n)} "${found.fixed.to}".`;
  if (!n) return `No request matches "${query.trim()}".`;
  return `${match(n)} "${query.trim()}".`;
}

/** A text in runs, the words a search found marked (the form makes them bold). */
export function markWords(
  text: string,
  terms: string[],
): { text: string; hit: boolean }[] {
  if (!terms.length || !text) return [{ text, hit: false }];
  return text
    .split(/([^\p{L}\p{N}]+)/u)
    .filter(Boolean)
    .map(part => {
      const word = part.toLowerCase();
      return {
        text: part,
        hit:
          word.length > 1 &&
          /[\p{L}\p{N}]/u.test(word) &&
          terms.some(q => wordFinds(q, word)),
      };
    });
}

// --- The questions ----------------------------------------------------------

export type QuestionGroup = { title: string | null; fields: FieldView[] };

/**
 * The type's own questions in the order the form asks them: the question
 * that decides where it goes first (research 1.8), then the rest in the
 * server's order. A long set gets its look's short headings (graft 7, by
 * `type.key`, never by how many questions there are), only while each
 * heading's questions still sit together in that order and two headings
 * still hold questions. A
 * question an editor added goes with the heading before it; any after the
 * last heading's questions go last, without a heading.
 */
export function questionGroups(type: TypeView): QuestionGroup[] {
  const deciding = new Set(routingFields(type).map(f => f.key));
  const body = bodyFields(type);
  const ordered = [
    ...body.filter(f => deciding.has(f.key)),
    ...body.filter(f => !deciding.has(f.key)),
  ];
  const plan = TYPE_LOOK[type.key]?.groups;
  const flat = [{ title: null, fields: ordered }];
  if (!plan?.length) return flat;
  const own = ordered.map(f => plan.findIndex(g => g.keys.includes(f.key)));
  const last = own.reduce((at, g, i) => (g >= 0 ? i : at), -1);
  const resolved: number[] = [];
  own.forEach((g, i) => {
    resolved.push(g >= 0 ? g : i > last ? -1 : (resolved[i - 1] ?? -1));
  });
  const runs: { index: number; fields: FieldView[] }[] = [];
  ordered.forEach((f, i) => {
    const run = runs.at(-1);
    if (run && run.index === resolved[i]) run.fields.push(f);
    else runs.push({ index: resolved[i], fields: [f] });
  });
  const titled = runs.filter(r => r.index >= 0).map(r => r.index);
  if (titled.length < 2 || unique(titled).length !== titled.length) return flat;
  return runs.map(r => ({
    title: r.index >= 0 ? plan[r.index].title : null,
    fields: r.fields,
  }));
}

// --- The route before Send (the signature) ----------------------------------

/** A ClickUp template's name without its emoji ("Low Schedule Rate (Ads)"). */
export function plainTemplateName(name: string): string {
  const plain = name
    .replace(
      /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}|\u{23CE}|[\u{1F3FB}-\u{1F3FF}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .trim();
  return plain || name.trim();
}

/**
 * A task name with its client prefix apart, so only the client sits in its
 * own direction (an Arabic name keeps its order and the rest reads in the
 * page's); null when the name does not start with "{client} - ".
 */
export function taskNameParts(
  taskName: string,
  clientName: string | null | undefined,
): { client: string; rest: string } | null {
  if (!clientName || !taskName.startsWith(`${clientName} - `)) return null;
  return { client: clientName, rest: taskName.slice(clientName.length) };
}

/** What the owner works from: the ClickUp template, or the SOP steps. */
export type LaneWorks =
  | { kind: "template"; name: string }
  | { kind: "steps"; count: number; steps: string[] | null; draft: boolean };

export type RouteLane = {
  part: string;
  listName: string;
  team: Team | null;
  /** "plan": it runs; "may": it runs only for some answers, not given yet. */
  kind: "plan" | "may";
  /** For a lane that may run: "If the problem is Call Center Issue or Both". */
  condition: string | null;
  /** The task's name, or null until the client it is named for is picked. */
  taskName: string | null;
  owner: { label: string; note: string | null } | null;
  works: LaneWorks | null;
  /**
   * Tasks that may run on one list for one owner, one per answer, drawn as
   * one lane (review D7): what each answer's task works from, by the
   * answer's name. `works` is then null.
   */
  byAnswer?: { answer: string; works: LaneWorks | null }[];
};

export type RouteModel = {
  /** One short line, the route's polite status. */
  summary: string;
  lanes: RouteLane[];
  /** Side by side only for exactly two lanes; stacked on the trunk otherwise. */
  layout: "pair" | "stack";
  /** The deciding question and its answer, marked at the fork. */
  decision: { question: string; answer: string } | null;
  /** The server's sentence when no lane can be drawn. */
  note: string | null;
};

/** The route's own words (CONTRACT.md 6.6, the department map). */
export const ROUTE_WORDS = {
  soon: "Usually in a minute or two",
  whenOpen: "When requests open",
  may: "May go to",
  /** A lane's kicker while requests are not open to the seat: no timing. */
  goesTo: "Goes to",
  /** The route's heading then: true in every writer state (review CL-04). */
  whereItGoes: "Where it goes",
  /** The fork's note then, for a pair that may run. */
  dependsOnAnswer: "Depends on the answer",
  dependsOn: (question: string) => `depending on the answer to "${question}"`,
  /**
   * In place of the server's "Pick ... to see where it goes." while requests
   * are not open to the seat: the question is not on the page (review
   * T2-clarity-03), and its name is never read out of that sentence.
   */
  dependsAhead: "Where it goes depends on the answer to one of its questions.",
  /**
   * In place of the server's "Pick ... to see where it goes." when every
   * task an answer decides rests on a choice ClickUp no longer gives
   * (20261028a sends when.options []): nothing can be picked, so the form
   * says why, as the question's own help does (review BT-6, S4).
   */
  routeLost:
    "Where it goes rests on a choice that could not be read from ClickUp. Ask the systems manager.",
  pickClient: "Pick the client to see its name.",
  /** The task's name while requests are not open: no client is asked here. */
  namedForClient: "Named after the client it is for.",
  now: "You send it. The cockpit checks it and saves it.",
  nowHeld: "You save it. The cockpit checks it and keeps it here.",
  heldTitle: "Saved, not sent",
  heldText: "Waits in the cockpit.",
  /** Under a held request's Saved stop after Save: what happened to it. */
  keptHere: "The cockpit checked it and keeps it here.",
  sopLink: "Read the SOP for this request",
  bell: "You hear in the bell when it is done, or if it fails, while a cockpit tab is open.",
  bellAfter: "My requests shows its ClickUp status until then.",
  /**
   * While a request is held, My requests shows the chip "Saved", not a
   * ClickUp status, until it reaches ClickUp (facts 2.6; review
   * T3-design-clarity-08).
   */
  bellAfterHeld:
    "My requests shows it as Saved until it reaches ClickUp, then its ClickUp status.",
  byRule: "The owner is chosen by rule, not picked here.",
  noClient: "Nothing is sent to the client.",
  cancel: "You can cancel it from the request until it reaches ClickUp.",
  changeInClickUp: "To change it now, use the task in ClickUp.",
  draft: "A draft until the systems manager checks them.",
  stepsAdded: (n: number) =>
    `${countWords(n, "SOP step")}, added as a checklist`,
  template: (name: string) => `the ClickUp template ${name}`,
  savedTitle: "Saved",
  goesByItself: "It goes to ClickUp by itself once requests open.",
  /**
   * While the writer has not reported (mode unknown), held words follow the
   * server's own hedge, "once it runs with requests open": its last mode may
   * have been apply, so never "once requests open" (review CL-04).
   */
  goesByItselfQuiet:
    "It goes to ClickUp by itself once the requests writer runs with requests open.",
  /**
   * A held task's own sentence after Send while the writer is quiet, in
   * place of sentLines()' "when requests open"; sentLines() itself stays as
   * pinned (review CL-04).
   */
  heldQuiet: (list: string) =>
    `Saved. Goes to ${list} once the writer runs with requests open.`,
  heldInListQuiet: (list: string) =>
    `In ${list}, not finished yet. The cockpit finishes it once the writer runs with requests open.`,
  whenQuiet: "Waits for the writer",
  savedUntil: (quiet: boolean) =>
    quiet ? "until the writer runs with requests open" : "until requests open",
  /**
   * A held request keeps its due day (the queue keeps the whole plan; CL-13),
   * said under the Due stop, which names the day: the day is said once
   * (review T3-design-clarity-04).
   */
  heldDue: "The due day stays, even if it reaches ClickUp later.",
  /** After that, once nothing reached ClickUp and nothing moves (CL-05). */
  endedBell: "Nothing more happens with it by itself.",
  endedBellNote: "The bell keeps the failure.",
  /** The fork after Send: "Sent together" only while no task failed. */
  sentTogether: "Sent together",
  checkingSub: "The cockpit is checking whether it reached ClickUp.",
  sentAt: (clock: string) => `Sent at ${clock}, Kuwait time.`,
  savedAt: (clock: string) => `Saved at ${clock}, Kuwait time.`,
  checked: (clock: string) => `Checked ${clock}, Kuwait time`,
  stopped: (clock: string) =>
    `Stopped checking at ${clock}, Kuwait time. My requests shows where it stands.`,
  stillOnItsWay:
    "Still on its way. This page has stopped checking; My requests shows where it is.",
  checksFor: "This page checks every few seconds for two minutes.",
} as const;

/**
 * The server's sentence for a preview that names no task, unless every task
 * an answer decides rests on a choice ClickUp no longer gives: then "Pick
 * ... to see where it goes." would ask for what cannot be picked, and the
 * form says why instead (ROUTE_WORDS.routeLost; review BT-6, S4).
 */
export function routeNote(
  type: Pick<TypeView, "parts">,
  note: string | null | undefined,
): string | null {
  if (!note) return null;
  const decided = type.parts.filter(p => p.when);
  return decided.length && !decided.some(partReachable)
    ? ROUTE_WORDS.routeLost
    : note;
}

const ownerOf = (o: Owner) => ({
  label: o.how === "none" || !o.label ? "nobody yet" : o.label,
  note: ownerNote(o),
});

function worksOf(
  templateName: string | null,
  stepCount: number | null,
  draft: boolean,
  steps: string[] | null | undefined,
): LaneWorks | null {
  if (templateName)
    return { kind: "template", name: plainTemplateName(templateName) };
  const list = Array.isArray(steps) && steps.length ? steps : null;
  const count = list?.length ?? stepCount ?? 0;
  return count ? { kind: "steps", count, steps: list, draft } : null;
}

/**
 * The route before Send, from the preview and the type (graft 2, 3): a lane
 * per task the preview says will run; before the deciding answer, a lane per
 * task that may run, with its condition (from parts[].when, never from the
 * preview's sentence) and its owner as the preview of that answer names it;
 * after the answer, the question and the answer at the fork.
 */
export function routeModel(input: {
  type: TypeView;
  preview: Pick<RoutePreview, "parts" | "note"> | null;
  /** The previews of each choice of the unanswered deciding question, by option id. */
  choicePreviews?: Record<string, RoutePart[]> | null;
  answers: Record<string, string | number | null | undefined>;
  clientPicked: boolean;
  /**
   * Requests are not open to the seat: the route says where it would go,
   * and the deciding question is named, never "your answer".
   */
  ahead?: boolean;
}): RouteModel {
  const { type, preview, answers } = input;
  const needsClient =
    Boolean(clientField(type)?.required) && !input.clientPicked;
  const deciding = routesKnown(type) ? routingFields(type) : [];
  const open = deciding.filter(f => empty(answers[f.key]));
  const shown = preview?.parts ?? [];
  const seenFor = (part: string) => {
    for (const parts of Object.values(input.choicePreviews ?? {})) {
      const hit = parts.find(p => p.part === part);
      if (hit) return hit;
    }
    return null;
  };
  const lanes: RouteLane[] = [];
  // The condition each lane that may run was drawn from, by its part.
  const mayWhen = new Map<string, PartWhen>();
  const plan = (p: RoutePart, steps?: string[] | null): RouteLane => ({
    part: p.part,
    listName: p.listName,
    team: teamOfList(p.listName),
    kind: "plan",
    condition: null,
    taskName: needsClient ? null : p.taskName,
    owner: ownerOf(p.owner),
    works: worksOf(p.templateName, p.stepCount, p.stepsDraft, steps),
  });
  for (const tp of type.parts) {
    const hit = shown.find(p => p.part === tp.part);
    if (hit) {
      lanes.push(plan(hit, tp.steps));
      continue;
    }
    const when = tp.when;
    // A part no offered choice runs is never drawn (review BT-6, S4).
    if (!when?.options.length || !open.some(f => f.key === when.fieldKey))
      continue;
    const seen = seenFor(tp.part);
    mayWhen.set(tp.part, when);
    lanes.push({
      part: tp.part,
      listName: tp.listName,
      team: teamOfList(tp.listName),
      kind: "may",
      condition: conditionWords(type, when),
      taskName: seen && !needsClient ? seen.taskName : null,
      owner: seen ? ownerOf(seen.owner) : null,
      works: worksOf(
        seen?.templateName ?? tp.templateName,
        seen?.stepCount ?? tp.stepCount,
        seen?.stepsDraft ?? tp.stepsDraft,
        tp.steps,
      ),
    });
  }
  for (const p of shown)
    if (!type.parts.some(tp => tp.part === p.part)) lanes.push(plan(p));
  mergeMayLanes(type, lanes, mayWhen);
  const lists = unique(lanes.map(l => l.listName));
  // With no lane to draw, the server's sentence is said once, on the route's
  // own stop (`note`), never again as the summary (review CL-07).
  let summary = "";
  if (lanes.some(l => l.kind === "may")) {
    const counts = open[0]
      ? answerRoutes(type, open[0])
          .map(r => r.parts.length)
          .filter(n => n > 0)
      : [];
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    const tasks = !counts.length
      ? "Tasks"
      : lo === hi
        ? countWords(lo, "task")
        : `${capital(numberWord(lo))} ${hi - lo === 1 ? "or" : "to"} ${numberWord(hi)} tasks`;
    summary = `${tasks}${lists.length === 1 ? ` for ${lists[0]}` : ""}, ${
      input.ahead && open[0]
        ? ROUTE_WORDS.dependsOn(open[0].label)
        : "by your answer"
    }`;
  } else if (lanes.length)
    summary = `${countWords(lanes.length, "task")}, for ${joinWords(lists)}`;
  const answered = deciding.find(f => !empty(answers[f.key]));
  return {
    summary,
    lanes,
    layout: lanes.length === 2 ? "pair" : "stack",
    decision:
      answered && lanes.length && lanes.every(l => l.kind === "plan")
        ? {
            question: answered.label,
            answer: display(answered, answers[answered.key]),
          }
        : null,
    note: lanes.length
      ? null
      : preview?.note
        ? input.ahead
          ? ROUTE_WORDS.dependsAhead
          : routeNote(type, preview.note)
        : null,
  };
}

/**
 * Tasks that may run on the same list, for the same owner, under the same
 * name and on the same question, one per answer (Create an ad account: Meta,
 * TikTok, Snapchat), become one lane (review D7): the answers joined in the
 * question's own order, the task and owner said once, and what each answer's
 * task works from. In place, keeping the first one's place.
 */
function mergeMayLanes(
  type: Pick<TypeView, "key" | "fields">,
  lanes: RouteLane[],
  mayWhen: Map<string, PartWhen>,
): void {
  const keyOf = (l: RouteLane) =>
    JSON.stringify([
      l.listName,
      l.owner?.label ?? null,
      l.owner?.note ?? null,
      l.taskName,
      mayWhen.get(l.part)?.fieldKey ?? null,
    ]);
  const groups = new Map<string, RouteLane[]>();
  for (const l of lanes)
    if (l.kind === "may" && mayWhen.has(l.part))
      groups.set(keyOf(l), [...(groups.get(keyOf(l)) ?? []), l]);
  const out: RouteLane[] = [];
  for (const l of lanes) {
    const group = l.kind === "may" ? groups.get(keyOf(l)) : undefined;
    if (!group || group.length < 2) {
      out.push(l);
      continue;
    }
    if (group[0] !== l) continue;
    const fieldKey = mayWhen.get(l.part)?.fieldKey ?? "";
    const order = (
      type.fields.find(f => f.key === fieldKey)?.options ?? []
    ).map(o => o.id);
    const place = (id: string) => {
      const at = order.indexOf(id);
      return at < 0 ? order.length : at;
    };
    const options = group
      .flatMap(g => mayWhen.get(g.part)?.options ?? [])
      .filter((o, i, all) => all.findIndex(x => x.id === o.id) === i)
      .sort((a, b) => place(a.id) - place(b.id));
    const first = (g: RouteLane) =>
      Math.min(...(mayWhen.get(g.part)?.options ?? []).map(o => place(o.id)));
    const sameWorks = group.every(
      g => JSON.stringify(g.works) === JSON.stringify(l.works),
    );
    out.push({
      ...l,
      part: group.map(g => g.part).join("+"),
      condition: conditionWords(type, { fieldKey, options }),
      works: sameWorks ? l.works : null,
      ...(sameWorks
        ? {}
        : {
            byAnswer: [...group]
              .sort((a, b) => first(a) - first(b))
              .map(g => ({
                answer: joinOr(
                  (mayWhen.get(g.part)?.options ?? []).map(o => o.name),
                ),
                works: g.works,
              })),
          }),
    });
  }
  lanes.splice(0, lanes.length, ...out);
}

// --- The tracker after Send --------------------------------------------------

export type SentLaneState = "done" | "moving" | "held" | "failed" | "checking";

export type SentLane = {
  part: string;
  listName: string;
  team: Team | null;
  /** sentLines' sentence for the task, whole: never split, never repeated. */
  line: string;
  state: SentLaneState;
  taskName: string;
  /** "Open in ClickUp": only a delivered task's own link. */
  url: string | null;
  /** A delivered task the cockpit could not finish: what to check. */
  note: string | null;
};

export type SentModel = {
  tone: "failed" | "moving" | "held" | "done";
  heading: "Sent" | "Saved" | "Not sent" | "Partly sent";
  /** The line under the heading, by where the tasks are. */
  sub: string;
  lanes: SentLane[];
  layout: "pair" | "stack";
  /** Once nothing moves after a refusal: what to do next. */
  next: string | null;
  /** Some task is in ClickUp. */
  delivered: boolean;
  /** Some task did not reach ClickUp. */
  refused: boolean;
  /**
   * Nothing reached ClickUp and nothing moves: no task will be done, so the
   * tracker says nothing more happens by itself (review CL-05).
   */
  ended: boolean;
};

/**
 * The sent view (graft 5): the heading, a line that follows the tasks, and a
 * lane per task with the core's own sentence (sentLines), its mark's state
 * and its ClickUp link once delivered. A held request reads "Saved", with no
 * success mark anywhere.
 */
export function sentModel(
  parts: Pick<
    PartRow,
    "part" | "listName" | "owner" | "state" | "error" | "url" | "taskName"
  >[],
  open: boolean,
  opts: {
    /** The page stopped reading the request (two minutes): no estimate. */
    stopped?: boolean;
    /** The writer has not reported (mode unknown): the server's hedge. */
    quiet?: boolean;
  } = {},
): SentModel {
  const tone = sentTone(parts, open);
  const lines = sentLines(parts, open);
  // While the writer has not reported, a held task's sentence follows its
  // hedge as the line above it does, never "when requests open" (CL-04).
  const lineOf = (p: (typeof parts)[number], i: number) =>
    opts.quiet && partHeld(p, open)
      ? p.url
        ? ROUTE_WORDS.heldInListQuiet(p.listName)
        : ROUTE_WORDS.heldQuiet(p.listName)
      : lines[i];
  const lanes: SentLane[] = parts.map((p, i) => ({
    part: p.part,
    listName: p.listName,
    team: teamOfList(p.listName),
    line: lineOf(p, i),
    state: partHeld(p, open)
      ? "held"
      : p.state === "delivered"
        ? "done"
        : p.state === "failed" || p.state === "skipped"
          ? "failed"
          : p.state === "unknown"
            ? "checking"
            : "moving",
    taskName: p.taskName,
    url: p.state === "delivered" ? p.url : null,
    note: deliveredNote(p),
  }));
  const n = lanes.length;
  const done = lanes.filter(l => l.state === "done").length;
  const failed = lanes.filter(l => l.state === "failed").length;
  const checking = lanes.filter(l => l.state === "checking").length;
  const moving = lanes.filter(l => l.state === "moving").length + checking;
  const every = n === 2 ? "Both tasks" : `All ${numberWord(n)} tasks`;
  const others = (k: number) =>
    k === 1 ? "the other is on its way" : "the others are on their way";
  // "Usually within a minute or two" only while every task on its way is
  // queued or sending and the page still reads it: never beside a create in
  // doubt, nor once the page stopped checking (review BT-5, CL-08).
  const estimate =
    checking || opts.stopped ? "" : ", usually within a minute or two";
  let sub: string;
  if (tone === "held")
    sub = opts.quiet ? ROUTE_WORDS.goesByItselfQuiet : ROUTE_WORDS.goesByItself;
  else if (failed && !moving)
    sub = done
      ? "Part of it reached ClickUp."
      : n === 1
        ? "It did not reach ClickUp."
        : n === 2
          ? "Neither task reached ClickUp."
          : `None of the ${numberWord(n)} tasks reached ClickUp.`;
  else if (failed)
    sub = `${countWords(failed, "task")} did not reach ClickUp; ${others(moving)}.`;
  else if (moving && !done)
    sub =
      checking && n === 1
        ? ROUTE_WORDS.checkingSub
        : checking
          ? `${every} are on their way to ClickUp; the cockpit is checking whether ${
              checking === 1 ? "one" : "some"
            } reached it.`
          : n === 1
            ? `It is on its way to ClickUp${estimate}.`
            : `${every} are on their way to ClickUp${estimate}.`;
  else if (moving)
    sub = `${countWords(done, "task")} ${done === 1 ? "is" : "are"} in ClickUp; ${others(moving)}.`;
  else sub = n === 1 ? "It is in ClickUp." : `${every} are in ClickUp.`;
  // A task in ClickUp that the cockpit could not finish: its note says what
  // to check there, so the line points at it and never says "nothing else
  // to do" (research 3.5).
  // While another task is not in ClickUp, the sentence says which: the one
  // in ClickUp (review T2-clarity-06).
  const noted = lanes.filter(l => l.note).length;
  const which =
    done === n
      ? noted === 1
        ? "One is"
        : `${capital(numberWord(noted))} are`
      : noted === 1
        ? done === 1
          ? "The one in ClickUp is"
          : "One of those in ClickUp is"
        : noted === done
          ? `The ${numberWord(noted)} in ClickUp are`
          : `${capital(numberWord(noted))} of those in ClickUp are`;
  if (noted)
    sub =
      n === 1
        ? "It is in ClickUp, but not finished. The note under the task says what to check there."
        : `${sub} ${which} not finished: the ${
            noted === 1 ? "note under it says" : "notes under them say"
          } what to check there.`;
  // The quiet writer's own note asks an editor to check the Machine tab, so
  // a held request then never says "Nothing else to do now" (review CL-04).
  else if (tone !== "failed" && !(tone === "held" && opts.quiet))
    sub = `Nothing else to do now. ${sub}`;
  return {
    tone,
    // "Partly sent" as soon as a task is refused while another goes on
    // (review CL-05); "Not sent" once nothing reached ClickUp and nothing
    // moves.
    heading:
      tone === "held"
        ? "Saved"
        : failed && !moving && !done
          ? "Not sent"
          : failed
            ? "Partly sent"
            : "Sent",
    sub,
    lanes,
    layout: n === 2 ? "pair" : "stack",
    next:
      tone === "failed" && !moving
        ? done
          ? partialNext({ parts })
          : REQUEST_SENTENCES.sentFailed
        : null,
    delivered: done > 0,
    refused: failed > 0,
    ended: failed > 0 && !moving && !done,
  };
}
