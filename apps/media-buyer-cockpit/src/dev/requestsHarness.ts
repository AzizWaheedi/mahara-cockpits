/**
 * Requests in the layout harness and the screen tests: every browser
 * function of docs/requests/CONTRACT.md 2.5 and the two alert-rule
 * functions of 3.3, answered from a made-up store that follows the
 * contract's rules (who may send by the writer's mode, the owner rules, the
 * "runs when" choices, idempotent sends, the lifecycle duplicate, versions).
 * Open, for example:
 *
 *   /harness.html?path=%2Frequests
 *   /harness.html?path=%2Frequests%3Fview%3Dmine
 *   /harness.html?path=%2Frequests%2Fsettings
 *
 * `requests=` picks the answer: default, empty (no requests yet), error,
 * missing (the functions are not on the database yet), loading, partial (a
 * task refused while the other landed), old (a routing request whose old
 * form ticket was closed in ClickUp while it waited). `seat=`
 * picks who is signed in: ceo (an editor, the default), csm, sales (not
 * linked to ClickUp). `writer=` sets the writer's mode: apply (default),
 * apply_limited, dry_run, unknown. An editor's read carries the stored
 * fields (TypeView.fieldSpecs), the field catalog and the templates, as
 * cockpit_request_types_read sends them (contract 2.5, I1); `specs=0` leaves
 * them out, the shape of a database from before I1, where the type editor
 * keeps its questions locked. `delay=` sets the wait in ms (350 by default).
 * Every seat reads when each part runs and the SOP steps it adds (the parts'
 * `when` and `steps`, migration 20261028a); `routes=0` leaves them out, the
 * shape of a database from before it, where the form draws no routing marks.
 * `send=refuse` makes the writer's run after a send refuse its tasks,
 * `send=partial` lands the first task and refuses the rest, so the sent
 * view's refusals can be seen, and `send=note` lands every task with the
 * first one's owner step refused (a delivered task with a note, CL-01).
 * With `writer=unknown`, `lastMode=apply` (or apply_limited, dry_run) is the
 * mode of the writer's last report, so a writer gone quiet after requests
 * opened can be seen (review CL-04).
 *
 * The layout harness serves all 31 types of docs/requests/request-types.json
 * (ALL_TYPES_SEED, read from the binding file itself); `types=12` serves the
 * twelve the screen tests use (HARNESS_SEED at the end of this file, copied
 * as they are). People, clients and ClickUp task ids are invented. Never
 * imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  type CatalogField,
  daysBetween,
  type FieldSpec,
  kuwaitToday,
  type OwnerHow,
  type PartRow,
  type PartState,
  type Priority,
  type RequestDetail,
  type RequestRow,
  type RequestState,
  type RequestView,
  type SopStepsState,
  TARGET_LISTS,
  type TargetSpec,
  TEAM_LABEL,
  TEAM_ORDER,
  type Team,
  type TypeView,
  validateAnswers,
  type WriterMode,
} from "@/lib/requestsCore";
import requestTypesJson from "../../../../docs/requests/request-types.json";

// --- The seed's shape (docs/requests/request-types.json) --------------------

export type SeedCatalogField = {
  clickup_field_id: string;
  clickup_name: string;
  kind: "text" | "longtext" | "url" | "number" | "select";
  label: string;
  options: { id: string; name: string }[] | null;
};

export type SeedType = {
  type_index: number;
  key: string;
  label: string;
  clickup_option_name: string;
  request_type_option_id: string;
  team: Team;
  targets: TargetSpec[];
  fields: FieldSpec[];
  sop_steps: string[] | null;
  sop_steps_state: SopStepsState;
  sop_url: string | null;
  due_days: number;
  priority: Priority;
  set_request_type: boolean;
  enabled: boolean;
};

export type Seed = { field_catalog: SeedCatalogField[]; types: SeedType[] };

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

type Args = Record<string, unknown>;

// --- Words the database uses (migration r) ----------------------------------

const RULE_LABEL: Record<TargetSpec["owner_rule"], string> = {
  systems_manager: "the systems manager",
  csm_of_card: "the client's CSM",
  creative_strategist: "the creative strategist",
  media_buyer_of_record: "the media buyer of record",
  person: "a ClickUp member",
};

/** Invented ClickUp members; the three role holders keep the seed's ids. */
export const HARNESS_PEOPLE: {
  clickupUserId: number;
  username: string;
  role: string;
  seat: { memberId: string; label: string } | null;
}[] = [
  {
    clickupUserId: 113459516,
    username: "Omar",
    role: "the systems manager",
    seat: { memberId: "m-sysman", label: "Omar, systems manager" },
  },
  {
    clickupUserId: 113520400,
    username: "Lina",
    role: "the creative strategist",
    seat: { memberId: "m-creative", label: "Lina, creative strategist" },
  },
  {
    clickupUserId: 113688800,
    username: "Sara",
    role: "the CSM",
    seat: { memberId: "m-csm", label: "Sara, CSM" },
  },
  {
    clickupUserId: 120000001,
    username: "Yousef",
    role: "the media buyer",
    seat: { memberId: "m-buyer", label: "Yousef, media buyer" },
  },
  {
    clickupUserId: 120000002,
    username: "Huda",
    role: "a video editor",
    seat: null,
  },
  {
    clickupUserId: 284616470,
    username: "The CEO",
    role: "the CEO",
    seat: { memberId: "m-ceo", label: "Aziz, CEO" },
  },
];

const ownerLabel = (id: number | null | undefined) =>
  HARNESS_PEOPLE.find(p => p.clickupUserId === id)?.role ?? "a ClickUp member";

export const HARNESS_CLIENTS: {
  taskId: string;
  name: string;
  status: string;
  csm: number | null;
}[] = [
  {
    taskId: "86harb001",
    name: "Harbour Interiors",
    status: "Active",
    csm: 113688800,
  },
  {
    taskId: "86harb002",
    name: "Dune Build Co",
    status: "Active",
    csm: 113688800,
  },
  {
    taskId: "86harb003",
    name: "Palm Fit Out",
    status: "Ready For Launch",
    csm: null,
  },
  {
    taskId: "86harb004",
    name: "مجموعة الواحة للمقاولات",
    status: "Active",
    csm: 113688800,
  },
  {
    taskId: "86harb005",
    name: "Nour Design Studio",
    status: "Brand Blueprint Booked",
    csm: null,
  },
  {
    taskId: "86harb006",
    name: "Cedar Renovations",
    status: "Stopped",
    csm: null,
  },
  {
    taskId: "86harb007",
    name: "Gulf Arch Atelier",
    status: "GHOSTED",
    csm: null,
  },
  {
    taskId: "86eywg1cq",
    name: "[TEST] Internal test card",
    status: "Active",
    csm: 113688800,
  },
];

export type HarnessSeat = {
  memberId: string;
  label: string;
  link: "linked" | "not_linked";
  teams: Team[];
  editor: boolean;
  admin: boolean;
  ceo: boolean;
  clickupUserId: number | null;
};

export const HARNESS_SEATS: Record<"ceo" | "csm" | "sales", HarnessSeat> = {
  ceo: {
    memberId: "m-ceo",
    label: "the CEO",
    link: "linked",
    teams: ["client_success", "tech", "ads", "creative", "call_center"],
    editor: true,
    admin: true,
    ceo: true,
    clickupUserId: 284616470,
  },
  csm: {
    memberId: "m-csm",
    label: "the CSM",
    link: "linked",
    teams: ["client_success", "call_center"],
    editor: false,
    admin: false,
    ceo: false,
    clickupUserId: 113688800,
  },
  sales: {
    memberId: "m-sales",
    label: "the closer",
    link: "not_linked",
    teams: [],
    editor: false,
    admin: false,
    ceo: false,
    clickupUserId: null,
  },
};

// --- Days ------------------------------------------------------------------

/** Today in Kuwait plus n Sunday-to-Thursday days (0 is today). */
export function workingDaysAhead(today: string, n: number): string {
  let day = today;
  let left = Math.max(0, n);
  while (left > 0) {
    day = addDays(day, 1);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow !== 5 && dow !== 6) left--;
  }
  return day;
}

// --- Types as the browser reads them ---------------------------------------

function fieldOptions(f: FieldSpec, catalog: SeedCatalogField[]) {
  if (f.kind !== "select") return null;
  if (!f.clickup_field_id) return f.options ?? [];
  return (
    catalog.find(c => c.clickup_field_id === f.clickup_field_id)?.options ?? []
  );
}

/**
 * cockpit_request_type_view (2.5), for the seed's shape. An editor's view
 * carries the stored fields as fieldSpecs, as the server always sends them
 * (a choice kept in a ClickUp field keeps no options there: its choices are
 * in `fields`, from the catalog); `specs` false leaves them out.
 */
export function typeViewOf(
  t: SeedType & { version?: number; updated_by?: string; updated_at?: string },
  catalog: SeedCatalogField[],
  editor: boolean,
  today: string,
  specs = true,
  routes = true,
): TypeView {
  const view: TypeView = {
    key: t.key,
    label: t.label,
    team: t.team,
    teamLabel: TEAM_LABEL[t.team],
    enabled: t.enabled,
    dueDays: t.due_days,
    dueDefault: workingDaysAhead(today, t.due_days),
    priority: t.priority,
    fields: t.fields.map(f => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      required: f.required,
      options: fieldOptions(f, catalog),
      help: f.help,
    })),
    parts: t.targets.map(g => ({
      part: g.part,
      listName: TEAM_LABEL[g.team],
      teamLabel: TEAM_LABEL[g.team],
      ruleLabel:
        g.owner_rule === "person"
          ? ownerLabel(g.owner_clickup_id)
          : RULE_LABEL[g.owner_rule],
      templateName: g.template_id ? g.template_name : null,
      stepCount: g.template_id ? null : (t.sop_steps?.length ?? 0),
      stepsDraft:
        !g.template_id && Boolean(t.sop_steps) && t.sop_steps_state === "draft",
      // Migration 20261028a, every seat: the choices that make the part run,
      // in the question's own order and names, and the steps it adds.
      ...(routes
        ? {
            when: g.when ? whenOf(t, g.when, catalog) : null,
            steps: g.template_id ? null : [...(t.sop_steps ?? [])],
          }
        : {}),
    })),
    sopUrl: t.sop_url,
  };
  if (!editor) return view;
  Object.assign(view, {
    version: t.version ?? 1,
    typeIndex: t.type_index,
    clickupOptionName: t.clickup_option_name,
    targets: JSON.parse(JSON.stringify(t.targets)),
    sopSteps: t.sop_steps,
    sopStepsState: t.sop_steps_state,
    setRequestType: t.set_request_type,
    updatedByLabel:
      t.updated_by === "migration" || !t.updated_by
        ? "the migration"
        : "the CEO",
    updatedAt: t.updated_at ?? "2026-10-26T12:00:00Z",
  });
  if (specs) view.fieldSpecs = JSON.parse(JSON.stringify(t.fields));
  return view;
}

/**
 * A part's "when" as every seat reads it (20261028a): the deciding question's
 * key and the choices that make the part run, with that question's own ids,
 * names and order; a choice it no longer offers is left out.
 */
function whenOf(
  t: SeedType,
  when: NonNullable<TargetSpec["when"]>,
  catalog: SeedCatalogField[],
) {
  const field = t.fields.find(f => f.key === when.field_key);
  const choices = field ? (fieldOptions(field, catalog) ?? []) : [];
  return {
    fieldKey: when.field_key,
    options: choices
      .filter(o => when.options.includes(o.id))
      .map(o => ({ id: o.id, name: o.name })),
  };
}

const catalogView = (c: SeedCatalogField[]): CatalogField[] =>
  c.map(x => ({
    clickupFieldId: x.clickup_field_id,
    clickupName: x.clickup_name,
    label: x.label,
    kind: x.kind,
    options: x.options,
    state: "ok",
  }));

// --- The store -------------------------------------------------------------

type StoredPart = PartRow & {
  ownerId: number | null;
  team: Team;
  /**
   * The create went out and its answer was lost: a create on record, no task
   * id (review round 3). Such a part is never cancelled, and a hand back
   * keeps it unknown (cockpit_clickup_writeback_release).
   */
  createSent?: boolean;
};
type StoredRequest = {
  id: string;
  typeKey: string;
  typeLabel: string;
  team: Team;
  clientTaskId: string | null;
  clientName: string | null;
  requesterId: string | null;
  requesterLabel: string;
  dueOn: string | null;
  priority: Priority;
  state: RequestState;
  done: boolean;
  createdAt: string;
  source: RequestRow["source"];
  answers: Record<string, string | number>;
  hash: string;
  importedTaskId: string | null;
  replacesTaskId: string | null;
  routedTo: string | null;
  /**
   * An old form ticket moved, closed or deleted in ClickUp since it came in
   * (cockpit_request_import_handled, review round 3).
   */
  importHandled?: boolean;
  parts: StoredPart[];
  history: { at: string; what: string; byLabel: string }[];
};

export type FakeOptions = {
  seat?: keyof typeof HARNESS_SEATS;
  mode?: WriterMode;
  onlyCards?: string[];
  seed?: Seed;
  today?: string;
  now?: () => number;
  /**
   * The stored fields, the catalog and the templates in an editor's read, as
   * the contract has them (default true); false is a database from before I1.
   */
  specs?: boolean;
  /** Start with no requests. */
  empty?: boolean;
  /**
   * The parts' `when` and `steps` in every read (default true); false is a
   * database from before migration 20261028a.
   */
  routes?: boolean;
  /**
   * While the mode is unknown (the writer has not reported in 15 minutes),
   * the mode of its last report: it picks the held note a seat outside the
   * editors, admins and the CEO is given (cockpit_request_send_gate as
   * 20261029p has it; review round 3, CL-04).
   */
  lastMode?: WriterMode;
};

export type RequestsFake = {
  handles(name: string): boolean;
  call(name: string, args?: Args): Answer;
  /** Moves every part still on its way one step on (the writer's run). */
  advance(): void;
  readonly calls: { name: string; args: Args }[];
  readonly requests: StoredRequest[];
  readonly types: (SeedType & {
    version: number;
    updated_by: string;
    updated_at: string;
  })[];
  seat: HarnessSeat;
  mode: WriterMode;
  alertKinds: Record<string, string[]>;
};

const OURS =
  /^cockpit_(request_|requests_read$|member_clickup_|task_alert_rules_)/;

const LIFECYCLE = ["client_offboarding", "client_pause", "client_relaunch"];

const ALL_KINDS = [
  "assigned",
  "due_today",
  "overdue",
  "comment",
  "mention",
  "status",
  "request_done",
  "request_failed",
];

function fail(message: string, code = "22023"): Answer {
  return { data: null, error: { message, code } };
}
const ok = (data: unknown): Answer => ({ data, error: null });

let idCount = 0;
function fakeUuid(): string {
  idCount++;
  const hex = idCount.toString(16).padStart(12, "0");
  return `0000a11e-0000-4000-8000-${hex}`;
}

/** A store of requests and types answering the contract's functions. */
export function createRequestsFake(opts: FakeOptions = {}): RequestsFake {
  const seed = opts.seed ?? HARNESS_SEED;
  // An editor's read in the contract's shape unless asked otherwise (I1).
  const specs = opts.specs ?? true;
  const now = opts.now ?? (() => Date.now());
  const today = () => opts.today ?? kuwaitToday(now());
  const iso = (minutesAgo = 0) =>
    new Date(now() - minutesAgo * 60_000).toISOString();
  const types = seed.types.map(t => ({
    ...JSON.parse(JSON.stringify(t)),
    version: 1,
    updated_by: "migration",
    updated_at: "2026-10-26T12:00:00Z",
  })) as RequestsFake["types"];
  const versions: Record<
    string,
    {
      version: number;
      savedAt: string;
      savedByLabel: string;
      note: string;
      row: SeedType;
    }[]
  > = {};
  for (const t of types)
    versions[t.key] = [
      {
        version: 1,
        savedAt: "2026-10-26T12:00:00Z",
        savedByLabel: "the migration",
        note: "Seeded 2026-10-26 from docs/requests/request-types.json",
        row: JSON.parse(JSON.stringify(t)),
      },
    ];
  const links: Record<
    string,
    {
      state: string;
      clickupUserId: number | null;
      matchedBy: "email" | "editor";
      note: string | null;
      checkedAt: string;
    } | null
  > = {
    "m-ceo": {
      state: "ok",
      clickupUserId: 284616470,
      matchedBy: "email",
      note: null,
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-sysman": {
      state: "ok",
      clickupUserId: 113459516,
      matchedBy: "email",
      note: null,
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-creative": {
      state: "ok",
      clickupUserId: 113520400,
      matchedBy: "email",
      note: null,
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-csm": {
      state: "ok",
      clickupUserId: 113688800,
      matchedBy: "email",
      note: null,
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-buyer": {
      state: "manual",
      clickupUserId: 120000001,
      matchedBy: "editor",
      note: "Set by an editor.",
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-sales": {
      state: "not_found",
      clickupUserId: null,
      matchedBy: "email",
      note: "No ClickUp member has this seat's email.",
      checkedAt: "2026-10-26T12:11:00Z",
    },
    "m-callers": {
      state: "ambiguous",
      clickupUserId: null,
      matchedBy: "email",
      note: "Two ClickUp members have this seat's email.",
      checkedAt: "2026-10-26T12:11:00Z",
    },
  };
  const seatList = [
    { memberId: "m-ceo", label: "Aziz, CEO", roles: ["admin"] },
    { memberId: "m-sysman", label: "Omar, systems manager", roles: ["admin"] },
    {
      memberId: "m-creative",
      label: "Lina, creative strategist",
      roles: ["creative"],
    },
    { memberId: "m-csm", label: "Sara, CSM", roles: ["csm"] },
    {
      memberId: "m-buyer",
      label: "Yousef, media buyer",
      roles: ["media_buyer"],
    },
    { memberId: "m-sales", label: "Faris, closer", roles: ["sales"] },
    {
      memberId: "m-callers",
      label: "Call centre, call centre agent",
      roles: ["call_center"],
    },
  ];
  const alertKinds: Record<string, string[]> = {};
  const shifts: Record<string, { start: string | null; end: string | null }> =
    {};
  const calls: { name: string; args: Args }[] = [];
  const requests: StoredRequest[] = [];

  const fake: RequestsFake = {
    handles: name => OURS.test(name),
    call,
    advance,
    calls,
    requests,
    types,
    seat: HARNESS_SEATS[opts.seat ?? "ceo"],
    mode: opts.mode ?? "apply",
    alertKinds,
  };

  const editorOf = (s: HarnessSeat) => s.editor;
  const allOf = (s: HarnessSeat) => s.editor || s.admin || s.ceo;

  /**
   * Whether a send goes now or is held (cockpit_request_send_gate as
   * 20261029p has it, docs/requests/CLICKUP-DOWNGRADE.md 4.2): every seat
   * may file; apply sends at once, as apply_limited does for the test card;
   * otherwise the request is saved and goes to ClickUp by itself once the
   * writer takes its card. No note names a ClickUp form.
   */
  function gate(clientTaskId: string | null): {
    allowed: boolean;
    held: boolean;
    note: string | null;
  } {
    const s = fake.seat;
    const lead = s.editor || s.admin || s.ceo;
    const hold = (note: string) => ({ allowed: true, held: true, note });
    const tested =
      "Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp by itself once they open to everyone.";
    const notOpen =
      "Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are.";
    switch (fake.mode) {
      case "apply":
        return { allowed: true, held: false, note: null };
      case "apply_limited":
        if (takes(clientTaskId))
          return { allowed: true, held: false, note: null };
        return hold(tested);
      case "dry_run":
        return hold(notOpen);
      default:
        if (lead)
          return hold(
            "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself once it runs with requests open. Check it on the Machine tab.",
          );
        if (opts.lastMode === "apply")
          return hold(
            "The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back.",
          );
        if (opts.lastMode === "apply_limited") return hold(tested);
        return hold(notOpen);
    }
  }

  /** Whether the writer takes a row for this card now (apply, or the canary). */
  function takes(clientTaskId: string | null): boolean {
    if (fake.mode === "apply") return true;
    return (
      fake.mode === "apply_limited" &&
      Boolean(clientTaskId) &&
      (opts.onlyCards ?? ["86eywg1cq"]).includes(String(clientTaskId))
    );
  }

  /** The writer's note on a row it handed back to the queue (run.ts WAITING). */
  const waitingNote = () =>
    fake.mode === "apply_limited"
      ? "Waiting in the queue: requests are being tested on the canary card only, so this goes when they open to every card."
      : "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.";

  /** Saved, not sent: every part still waits untried and the writer would not take it. */
  const heldOf = (r: StoredRequest) =>
    r.state === "sending" &&
    r.parts.length > 0 &&
    r.parts.every(p => p.state === "queued") &&
    !takes(r.clientTaskId);

  const typeOf = (key: unknown) => types.find(t => t.key === key) ?? null;
  const clientOf = (id: unknown) =>
    id ? (HARNESS_CLIENTS.find(c => c.taskId === id) ?? null) : null;

  function ownerFor(
    g: TargetSpec,
    clientTaskId: string | null,
  ): {
    clickupId: number | null;
    how: OwnerHow;
    label: string;
    note: string | null;
  } {
    const sysman = { clickupId: 113459516, label: "the systems manager" };
    if (g.owner_rule === "csm_of_card") {
      const csm = clientOf(clientTaskId)?.csm;
      if (csm)
        return {
          clickupId: csm,
          how: "card",
          label: ownerLabel(csm),
          note: "The CSM named on the client card.",
        };
    }
    if (g.owner_clickup_id)
      return {
        clickupId: g.owner_clickup_id,
        how: "named",
        label: ownerLabel(g.owner_clickup_id),
        note: null,
      };
    if (g.owner_rule === "media_buyer_of_record")
      return {
        ...sysman,
        how: "fallback",
        note: "No media buyer of record is named on this request type, so the systems manager gets it. Set one in Requests settings.",
      };
    if (g.owner_rule === "systems_manager")
      return { ...sysman, how: "rule", note: null };
    if (g.owner_rule === "creative_strategist")
      return {
        clickupId: 113520400,
        how: "rule",
        label: "the creative strategist",
        note: null,
      };
    if (g.owner_rule === "csm_of_card")
      return {
        clickupId: 113688800,
        how: "rule",
        label: "the CSM",
        note: null,
      };
    return {
      ...sysman,
      how: "fallback",
      note: "Nobody matched this rule, so the systems manager gets it.",
    };
  }

  function plan(
    t: SeedType,
    clientTaskId: string | null,
    answers: Record<string, unknown>,
  ) {
    const client = clientOf(clientTaskId);
    return t.targets
      .filter(
        g =>
          !g.when ||
          g.when.options.includes(String(answers[g.when.field_key] ?? "")),
      )
      .map(g => {
        const owner = ownerFor(g, clientTaskId);
        const base = `${t.label}${g.name_suffix}`;
        const taskName = (
          client
            ? `${client.name} - ${base}`
            : `${base} - from ${fake.seat.label}`
        ).slice(0, 200);
        return {
          part: g.part,
          team: g.team,
          listName: TEAM_LABEL[g.team],
          teamLabel: TEAM_LABEL[g.team],
          taskName,
          templateName: g.template_id ? g.template_name : null,
          stepCount: g.template_id ? null : (t.sop_steps?.length ?? 0),
          stepsDraft:
            !g.template_id &&
            Boolean(t.sop_steps) &&
            t.sop_steps_state === "draft",
          owner,
        };
      });
  }

  function whenLabel(t: SeedType): string | null {
    const g = t.targets.find(x => x.when);
    if (!g?.when) return null;
    return t.fields.find(f => f.key === g.when?.field_key)?.label ?? null;
  }

  /**
   * An owner note as the reading seat sees it (cockpit_request_owner_note,
   * review round 2): the "Set one in Requests settings" line is an editor's;
   * anyone else reads that no media buyer is named yet.
   */
  function noteFor(note: string | null): string | null {
    return note?.includes("Set one in Requests settings.") && !fake.seat.editor
      ? "No media buyer is named for this request type yet."
      : note;
  }

  /**
   * cockpit_request_cancellable: never once a part is being sent, delivered
   * or in doubt, holds a ClickUp task (a retry after the task was made too),
   * or may hold one (a create whose answer was lost, review round 3).
   */
  function cancellable(r: StoredRequest): boolean {
    const s = fake.seat;
    return (
      (r.requesterId === s.memberId || s.editor || s.admin || s.ceo) &&
      !["cancelled", "imported", "routed"].includes(r.state) &&
      !r.parts.some(
        p =>
          ["sending", "delivered", "unknown"].includes(p.state) ||
          Boolean(p.url) ||
          p.createSent === true,
      )
    );
  }

  function rowOf(r: StoredRequest): RequestRow {
    const s = fake.seat;
    return {
      id: r.id,
      typeKey: r.typeKey,
      typeLabel: r.typeLabel,
      team: r.team,
      teamLabel: TEAM_LABEL[r.team],
      clientTaskId: r.clientTaskId,
      clientName: r.clientName,
      requesterLabel: r.requesterLabel,
      mine: r.requesterId === s.memberId,
      dueOn: r.dueOn,
      priority: r.priority,
      state: r.state,
      done: r.done,
      createdAt: r.createdAt,
      source: r.source,
      canCancel: cancellable(r),
      canRoute:
        r.state === "imported" &&
        !r.importHandled &&
        (allOf(s) || s.teams.includes(r.team)) &&
        gate(r.clientTaskId).allowed,
      importHandled: r.importHandled === true,
      held: heldOf(r),
      heldNote: heldOf(r)
        ? "Saved, not sent yet. It goes to ClickUp once requests open."
        : null,
      parts: r.parts.map(({ ownerId: _o, team: _t, createSent: _c, ...p }) => ({
        ...p,
        owner: { ...p.owner, note: noteFor(p.owner.note) },
      })),
    };
  }

  function refresh(r: StoredRequest) {
    if (["cancelled", "imported", "routed"].includes(r.state)) return;
    const st = r.parts.map(p => p.state);
    if (st.every(x => x === "delivered")) r.state = "delivered";
    else if (
      st.some(x => ["queued", "sending", "retry", "unknown"].includes(x))
    )
      r.state = "sending";
    else if (st.every(x => x === "dry_run")) r.state = "dry_run";
    else if (st.some(x => x === "delivered")) r.state = "partial";
    else r.state = "failed";
    const delivered = r.parts.filter(p => p.state === "delivered");
    r.done =
      delivered.length > 0 &&
      delivered.every(
        p => p.statusType === "done" || p.statusType === "closed",
      );
  }

  function inView(r: StoredRequest, view: RequestView): boolean {
    const s = fake.seat;
    // An old form ticket handled in ClickUp waits for nobody (review round 3).
    const open =
      !r.done && !["cancelled", "routed"].includes(r.state) && !r.importHandled;
    if (view === "mine") return r.requesterId === s.memberId;
    if (view === "assigned")
      return (
        s.clickupUserId !== null &&
        open &&
        r.parts.some(p => p.ownerId === s.clickupUserId)
      );
    if (view === "team")
      return (
        open &&
        (s.teams.includes(r.team) ||
          r.parts.some(p => s.teams.includes(p.team)))
      );
    return true;
  }

  function addRequest(
    over: Partial<StoredRequest> & { typeKey: string },
  ): StoredRequest {
    const t = typeOf(over.typeKey);
    if (!t) throw new Error(`No type ${over.typeKey}`);
    const client = clientOf(over.clientTaskId);
    const r: StoredRequest = {
      id: over.id ?? fakeUuid(),
      typeKey: t.key,
      typeLabel: t.label,
      team: t.team,
      clientTaskId: client?.taskId ?? null,
      clientName: client?.name ?? null,
      requesterId: "m-csm",
      requesterLabel: "the CSM",
      dueOn: addDays(today(), 2),
      priority: t.priority,
      state: "sending",
      done: false,
      createdAt: iso(90),
      source: "requests_page",
      answers: {},
      hash: "",
      importedTaskId: null,
      replacesTaskId: null,
      routedTo: null,
      parts: [],
      history: [],
      ...over,
    };
    if (!over.parts)
      r.parts = plan(t, r.clientTaskId, r.answers).map(p => ({
        part: p.part,
        listName: p.listName,
        teamLabel: p.teamLabel,
        taskName: p.taskName,
        owner: { label: p.owner.label, how: p.owner.how, note: p.owner.note },
        ownerId: p.owner.clickupId,
        team: p.team,
        state: "queued" as PartState,
        error: null,
        url: null,
        status: null,
        statusType: null,
        verifyState: null,
        verifyNote: null,
      }));
    if (!r.history.length)
      r.history.push({
        at: r.createdAt,
        what: "Sent from the cockpit",
        byLabel: r.requesterLabel,
      });
    requests.push(r);
    return r;
  }

  const deliver = (
    p: StoredPart,
    n: number,
    status = "to do",
    type = "open",
  ) => {
    p.state = "delivered";
    p.url = `https://app.clickup.com/t/86harn${String(n).padStart(3, "0")}`;
    p.status = status;
    p.statusType = type;
  };

  if (!opts.empty) {
    // A two-task pause, both in ClickUp; the Media task's owner fell back.
    const pause = addRequest({
      typeKey: "client_pause",
      clientTaskId: "86harb001",
      requesterId: fake.seat.memberId,
      requesterLabel: fake.seat.label,
      dueOn: today(),
      createdAt: iso(60 * 26),
    });
    deliver(pause.parts[0], 1, "in progress", "custom");
    deliver(pause.parts[1], 2);
    pause.parts[0].verifyState = "restored";
    pause.parts[1].verifyState = "kept";
    refresh(pause);
    // Sent a moment ago, on its way.
    addRequest({
      typeKey: "general_tech",
      clientTaskId: null,
      requesterId: fake.seat.memberId,
      requesterLabel: fake.seat.label,
      answers: {
        details:
          "The landing page form stopped sending leads to the CRM after this morning's change.",
      },
      dueOn: addDays(today(), 1),
      priority: "high",
      createdAt: iso(2),
    });
    // Held: saved while requests were not open, the writer's note on it.
    const script = addRequest({
      typeKey: "new_script",
      clientTaskId: "86harb004",
      requesterId: fake.seat.memberId,
      requesterLabel: fake.seat.label,
      dueOn: addDays(today(), 6),
      createdAt: iso(60 * 5),
    });
    script.parts[0].error =
      "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.";
    refresh(script);
    // Did not reach ClickUp.
    const card = addRequest({
      typeKey: "card_missing",
      clientTaskId: "86harb002",
      dueOn: addDays(today(), -2),
      priority: "high",
      createdAt: iso(60 * 50),
    });
    card.parts[0].state = "failed";
    card.parts[0].error = "ClickUp refused the task: the list is full";
    refresh(card);
    // Assigned to the CEO's seat by name, late.
    const lp = addRequest({
      typeKey: "landing_page",
      clientTaskId: "86harb003",
      dueOn: addDays(today(), -3),
      createdAt: iso(60 * 24 * 6),
    });
    deliver(lp.parts[0], 3, "review required", "custom");
    // In ClickUp, but a step was refused (requests.ts STEP_REFUSED).
    lp.parts[0].error =
      "The SOP steps did not save as a checklist in ClickUp. Add them on the task there.";
    lp.parts[0].ownerId = fake.seat.clickupUserId;
    lp.parts[0].owner = { label: fake.seat.label, how: "named", note: null };
    refresh(lp);
    // Done in ClickUp.
    const done = addRequest({
      typeKey: "whatsapp_connection",
      clientTaskId: "86harb001",
      requesterId: fake.seat.memberId,
      requesterLabel: fake.seat.label,
      dueOn: addDays(today(), -5),
      createdAt: iso(60 * 24 * 8),
    });
    deliver(done.parts[0], 4, "complete", "done");
    refresh(done);
    // A ticket from the old ClickUp form, waiting to be routed.
    addRequest({
      typeKey: "general_csm",
      clientTaskId: "86harb005",
      requesterId: null,
      requesterLabel: "the old ClickUp form",
      source: "import",
      state: "imported",
      importedTaskId: "z8xharn01",
      dueOn: null,
      answers: {
        details:
          "Client asked for a call about their invoice and the new campaign start date.",
      },
      createdAt: iso(60 * 24 * 12),
      parts: [
        {
          part: "main",
          listName: "All Tasks",
          teamLabel: "All Tasks",
          taskName: "Form Submission - #2026-10-14 09:12",
          owner: { label: "Nobody yet", how: "import", note: null },
          ownerId: null,
          team: "all_tasks",
          state: "imported",
          error: null,
          url: "https://app.clickup.com/t/z8xharn01",
          status: "to do",
          statusType: "open",
          verifyState: null,
          verifyNote: null,
        },
      ],
      history: [
        {
          at: iso(60 * 24 * 12),
          what: "Came in through the old ClickUp form",
          byLabel: "the cockpit",
        },
      ],
    });
  }

  function advance() {
    let n = 10 + requests.length;
    for (const r of requests) {
      if (["cancelled", "imported", "routed"].includes(r.state)) continue;
      let moved = false;
      for (const p of r.parts)
        if (p.state === "queued" || p.state === "sending") {
          if (!takes(r.clientTaskId)) {
            // The writer hands the row back to the queue with its note
            // (run.ts hold): nothing goes to ClickUp, nothing is a try. A
            // create whose answer was lost stays unknown (review round 3).
            p.state = p.createSent && !p.url ? "unknown" : "queued";
            p.error = waitingNote();
            continue;
          }
          p.error = null;
          deliver(p, n++);
          moved = true;
        }
      if (moved) {
        refresh(r);
        r.history.push({
          at: iso(),
          what:
            r.state === "dry_run"
              ? `${TEAM_LABEL[r.team]}: held as a test run, not sent to ClickUp`
              : `${TEAM_LABEL[r.team]}: made in ClickUp`,
          byLabel: "the cockpit",
        });
      }
    }
  }

  function typesRead(): Answer {
    const s = fake.seat;
    const editor = editorOf(s);
    const g = gate(null);
    const list = types
      .filter(t => t.enabled || editor)
      .sort(
        (a, b) =>
          TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) ||
          a.type_index - b.type_index,
      )
      .map(t =>
        typeViewOf(
          t,
          seed.field_catalog,
          editor,
          today(),
          specs,
          opts.routes ?? true,
        ),
      );
    const data: Record<string, unknown> = {
      asOf: iso(),
      seat: {
        label: s.label,
        link: s.link,
        teams: s.teams,
        editor,
        all: allOf(s),
      },
      writer: {
        mode: fake.mode,
        canSend: g.allowed,
        held: g.held,
        note: g.note,
      },
      types: list,
    };
    if (editor && specs) {
      data.catalog = catalogView(seed.field_catalog);
      const seen = new Map<string, string>();
      for (const t of types)
        for (const g of t.targets)
          if (g.template_id && g.template_name)
            seen.set(g.template_id, g.template_name);
      data.templates = [...seen].map(([id, name]) => ({
        id,
        name,
        state: "ok",
      }));
    }
    return ok(data);
  }

  function submit(a: Args): Answer {
    const g = gate((a.p_client_task_id as string) ?? null);
    if (!g.allowed) return fail(g.note ?? "Requests are not open.", "55000");
    if (!["requests_page", "client_page"].includes(String(a.p_source)))
      return fail("Send requests from the Requests page or a client page.");
    const t = typeOf(a.p_type_key);
    if (!t) return fail("That request type does not exist. Reload the form.");
    if (!t.enabled)
      return fail(
        "This request type is turned off. Pick another or ask the systems manager.",
      );
    const answers = (a.p_answers ?? {}) as Record<string, string | number>;
    const clientTaskId = (a.p_client_task_id as string | null) ?? null;
    const due =
      (a.p_due_on as string | null) ?? workingDaysAhead(today(), t.due_days);
    const priority = ((a.p_priority as Priority | null) ??
      t.priority) as Priority;
    const replaces = (a.p_replaces_task_id as string | null) ?? null;
    const hash = JSON.stringify([
      t.key,
      clientTaskId,
      answers,
      due,
      priority,
      replaces,
    ]);
    const existing = requests.find(r => r.id === a.p_request_id);
    if (existing) {
      if (existing.hash === hash && existing.requesterId === fake.seat.memberId)
        return ok({
          id: existing.id,
          state: existing.state,
          reused: true,
          duplicateOf: null,
          note: heldOf(existing) ? g.note : null,
          held: heldOf(existing),
          parts: rowOf(existing).parts,
        });
      return fail(
        "This request was already sent with other answers. Reload the form and send again.",
      );
    }
    const view = typeViewOf(t, seed.field_catalog, false, today());
    const problems = validateAnswers(view, answers, clientTaskId, due, today());
    const first = Object.values(problems)[0];
    if (first) return fail(first);
    const client = clientOf(clientTaskId);
    if (clientTaskId && !client)
      return fail("You cannot raise a request for this client.", "42501");
    if (!plan(t, clientTaskId, answers).length)
      return fail(`Pick ${whenLabel(t) ?? "what you need"} first.`);
    if (daysBetween(today(), due) < 0)
      return fail("Pick today or a later day.");
    if (daysBetween(today(), due) > 365)
      return fail("Pick a day within the next year.");
    let old: StoredRequest | undefined;
    if (replaces) {
      old = requests.find(r => r.importedTaskId === replaces);
      if (!old)
        return fail("That old ticket is not in the cockpit. Reload the queue.");
      // Routed already, here or in ClickUp (moved, closed or deleted there).
      if (old.state !== "imported" || old.importHandled)
        return fail("That old ticket was already routed.", "55000");
      if (!takes(old.clientTaskId) && takes(clientTaskId))
        return fail(
          "This old ticket has no client card, so it cannot go out on the internal test card. Route it for its own client, or with none; it waits until requests open to everyone.",
          "55000",
        );
    }
    if (LIFECYCLE.includes(t.key) && clientTaskId) {
      const dup = requests.find(
        r =>
          r.typeKey === t.key &&
          r.clientTaskId === clientTaskId &&
          !["cancelled", "failed", "routed"].includes(r.state) &&
          !r.done &&
          !r.importHandled,
      );
      if (dup) {
        const opens =
          dup.requesterId === fake.seat.memberId ||
          allOf(fake.seat) ||
          fake.seat.teams.includes(dup.team) ||
          dup.parts.some(p => fake.seat.teams.includes(p.team));
        const named = `An open ${t.label.toLowerCase()} request for ${client?.name ?? "this client"} already exists`;
        return ok({
          id: null,
          state: "duplicate",
          reused: false,
          duplicateOf: opens ? dup.id : null,
          note: opens
            ? `${named}. Open it instead.`
            : dup.source === "import"
              ? `${named}. It came in through the old ClickUp form and waits in the ${TEAM_LABEL[dup.team]} queue.`
              : `${named}, raised by ${dup.requesterLabel}. Ask them about it.`,
          held: false,
          parts: [],
        });
      }
    }
    const r = addRequest({
      id: String(a.p_request_id),
      typeKey: t.key,
      clientTaskId,
      requesterId: fake.seat.memberId,
      requesterLabel: fake.seat.label,
      dueOn: due,
      priority,
      answers,
      hash,
      replacesTaskId: replaces,
      source: a.p_source as RequestRow["source"],
      createdAt: iso(),
    });
    if (old) {
      old.state = "routed";
      old.routedTo = r.id;
      old.history.push({
        at: iso(),
        what: "Routed as a new request",
        byLabel: fake.seat.label,
      });
    }
    return ok({
      id: r.id,
      state: r.state,
      reused: false,
      duplicateOf: null,
      note: g.held ? g.note : null,
      held: g.held,
      parts: rowOf(r).parts,
    });
  }

  function detail(r: StoredRequest): RequestDetail {
    const t = typeOf(r.typeKey);
    const view = t ? typeViewOf(t, seed.field_catalog, false, today()) : null;
    const answers = (view?.fields ?? [])
      .filter(
        f => !["client", "details", "deadline", "priority"].includes(f.kind),
      )
      .filter(f => r.answers[f.key] !== undefined && r.answers[f.key] !== "")
      .map(f => ({
        key: f.key,
        label: f.label,
        display:
          f.kind === "select"
            ? ((f.options ?? []).find(o => o.id === String(r.answers[f.key]))
                ?.name ?? String(r.answers[f.key]))
            : String(r.answers[f.key]),
      }));
    const detailsKey =
      view?.fields.find(f => f.kind === "details")?.key ?? "details";
    const details = r.answers[detailsKey];
    return {
      ...rowOf(r),
      answers,
      details: details === undefined ? null : String(details),
      replacesTaskId: r.replacesTaskId,
      routedTo: r.routedTo,
      history: r.history,
    };
  }

  function views() {
    const s = fake.seat;
    const count = (v: RequestView) => requests.filter(r => inView(r, v)).length;
    const out: { key: RequestView; label: string; count: number | null }[] = [
      { key: "mine", label: "My requests", count: count("mine") },
      {
        key: "assigned",
        label: "Assigned to me",
        count: s.link === "linked" ? count("assigned") : null,
      },
    ];
    if (s.teams.length)
      out.push({
        key: "team",
        label:
          s.teams.length === 1
            ? `${TEAM_LABEL[s.teams[0]]} queue`
            : "Team queue",
        count: count("team"),
      });
    if (allOf(s))
      out.push({ key: "all", label: "All requests", count: requests.length });
    return out;
  }

  function saveType(a: Args, restoreFrom?: number): Answer {
    const s = fake.seat;
    if (!s.editor)
      return fail(
        "Only the systems manager, the CEO or a seat given the right can change requests settings.",
        "42501",
      );
    const t = typeOf(a.p_key);
    if (!t) return fail("That request type does not exist. Reload the page.");
    if (a.p_expected_version !== t.version)
      return fail(
        "Someone saved this type since you opened it. Reload to see their change.",
        "40001",
      );
    let patch = (a.p_patch ?? {}) as Record<string, unknown>;
    // Going back a version never turns Request Type on (review round 2).
    let keptOff = false;
    if (restoreFrom !== undefined) {
      const v = versions[t.key].find(x => x.version === restoreFrom);
      if (!v) return fail("That version does not exist. Reload the versions.");
      keptOff = v.row.set_request_type && !t.set_request_type;
      patch = {
        label: v.row.label,
        targets: v.row.targets,
        fields: v.row.fields,
        sop_steps: v.row.sop_steps,
        sop_url: v.row.sop_url,
        due_days: v.row.due_days,
        priority: v.row.priority,
        set_request_type: v.row.set_request_type && t.set_request_type,
        enabled: v.row.enabled,
      };
    } else {
      if (!Object.keys(patch).length) return fail("There is nothing to save.");
      for (const k of Object.keys(patch))
        if (
          ![
            "label",
            "targets",
            "fields",
            "sop_steps",
            "sop_url",
            "due_days",
            "priority",
            "set_request_type",
            "enabled",
          ].includes(k)
        )
          return fail(`That change is not allowed here: ${k}.`);
    }
    if (typeof patch.label === "string") {
      const label = patch.label.trim();
      if (label.length < 3 || label.length > 80)
        return fail("The name must be 3 to 80 characters.");
      t.label = label;
    }
    if (Array.isArray(patch.targets)) {
      // The guard's part rules (cockpit_request_type_problem): 1 to 3
      // parts, each a unique short name on one of the five boards, with a
      // name ending under 40 characters.
      const parts = patch.targets as TargetSpec[];
      if (parts.length < 1 || parts.length > 3)
        return fail("Pick between 1 and 3 parts.");
      const seen: string[] = [];
      for (const g of parts) {
        if (!/^[a-z_]{2,20}$/.test(String(g.part)))
          return fail(
            "Each part needs a short name of 2 to 20 lower case letters.",
          );
        if (seen.includes(g.part))
          return fail(`Two parts share the name ${g.part}.`);
        seen.push(g.part);
        const board = TARGET_LISTS.find(l => l.listId === g.list_id);
        if (!board)
          return fail(`The ${g.part} part needs one of the five team boards.`);
        if (board.team !== g.team)
          return fail(
            `The ${board.name} part has the wrong team for its board.`,
          );
        if (typeof g.name_suffix !== "string" || g.name_suffix.length > 40)
          return fail(
            `The ${board.name} part's name ending must be text under 40 characters.`,
          );
      }
      for (const g of parts)
        if (
          g.owner_rule === "person" &&
          !HARNESS_PEOPLE.some(p => p.clickupUserId === g.owner_clickup_id)
        )
          return fail(
            "That person is not in the ClickUp workspace. Pick someone from the list.",
          );
      t.targets = JSON.parse(JSON.stringify(patch.targets));
      t.team = t.targets[0]?.team ?? t.team;
    }
    if (Array.isArray(patch.fields))
      t.fields = JSON.parse(JSON.stringify(patch.fields));
    if ("sop_steps" in patch) {
      const steps = patch.sop_steps as string[] | null;
      t.sop_steps = steps?.length ? steps : null;
      t.sop_steps_state =
        restoreFrom !== undefined
          ? (versions[t.key].find(x => x.version === restoreFrom)?.row
              .sop_steps_state ?? "none")
          : t.sop_steps
            ? "saved"
            : "none";
    }
    if ("sop_url" in patch)
      t.sop_url = (patch.sop_url as string | null) || null;
    if (typeof patch.due_days === "number") t.due_days = patch.due_days;
    if (typeof patch.priority === "string")
      t.priority = patch.priority as Priority;
    if (typeof patch.set_request_type === "boolean")
      t.set_request_type = patch.set_request_type;
    if (typeof patch.enabled === "boolean") t.enabled = patch.enabled;
    t.version += 1;
    t.updated_by = "ceo@example.test";
    t.updated_at = iso();
    versions[t.key].unshift({
      version: t.version,
      savedAt: t.updated_at,
      savedByLabel: "the CEO",
      note:
        restoreFrom !== undefined
          ? `Back to version ${restoreFrom}${keptOff ? ". Request Type stays off." : ""}`
          : "Saved",
      row: JSON.parse(JSON.stringify(t)),
    });
    // As cockpit_request_type_view answers a save or a restore: neither
    // `when` nor `steps` (20261028a leaves that view as it was; review S5).
    const view = typeViewOf(t, seed.field_catalog, true, today(), specs, false);
    return ok(
      restoreFrom === undefined
        ? view
        : {
            ...view,
            restoreNote: keptOff
              ? `Request Type stays off. Version ${restoreFrom} had it on, but it is off now; turn it on with its switch once the rehearsal ticket shows ClickUp keeps the task where it is.`
              : null,
          },
    );
  }

  function seatRow(memberId: string) {
    const s = seatList.find(x => x.memberId === memberId);
    if (!s) return null;
    const l = links[memberId];
    return {
      memberId: s.memberId,
      label: s.label,
      roles: s.roles,
      link: l
        ? {
            ...l,
            username:
              HARNESS_PEOPLE.find(p => p.clickupUserId === l.clickupUserId)
                ?.username ?? null,
          }
        : null,
    };
  }

  function rulesRead(memberId: string | null): Answer {
    const s = fake.seat;
    const who = memberId ?? s.memberId;
    if (who !== s.memberId && !s.editor)
      return fail("Only an editor can change another seat's alerts.", "42501");
    const label =
      who === s.memberId
        ? s.label
        : (seatList.find(x => x.memberId === who)?.label ?? "That seat");
    const shift = shifts[who];
    return ok({
      member: { id: who, label },
      rules: {
        kinds: alertKinds[who] ?? ALL_KINDS,
        shiftStart: shift?.start ?? null,
        shiftEnd: shift?.end ?? null,
        slackDm: false,
      },
      shift: shift?.start
        ? {
            source: "rules",
            start: shift.start,
            end: shift.end,
            days: ["sun", "mon", "tue", "wed", "thu"],
          }
        : who === "m-csm"
          ? {
              source: "schedule",
              start: "09:00",
              end: "17:00",
              days: ["sun", "mon", "tue", "wed", "thu"],
            }
          : {
              source: "default",
              start: "10:00",
              end: "18:00",
              days: ["sun", "mon", "tue", "wed", "thu"],
            },
      seats: s.editor
        ? seatList.map(x => ({ memberId: x.memberId, label: x.label }))
        : undefined,
      canEditOthers: s.editor,
    });
  }

  function call(name: string, args: Args = {}): Answer {
    calls.push({ name, args });
    const s = fake.seat;
    switch (name) {
      case "cockpit_request_types_read":
        return typesRead();
      case "cockpit_request_clients": {
        const q = String(args.p_search ?? "")
          .trim()
          .toLowerCase();
        const hits = HARNESS_CLIENTS.filter(
          c =>
            (args.p_include_stopped ||
              !["Stopped", "GHOSTED"].includes(c.status)) &&
            (!q || c.name.toLowerCase().includes(q)),
        ).sort((x, y) => x.name.localeCompare(y.name));
        return ok({
          clients: hits
            .slice(0, 30)
            .map(c => ({ taskId: c.taskId, name: c.name, status: c.status })),
          more: hits.length > 30,
        });
      }
      case "cockpit_request_preview": {
        const t = typeOf(args.p_type_key);
        if (!t)
          return fail("That request type does not exist. Reload the form.");
        const clientTaskId = (args.p_client_task_id as string | null) ?? null;
        if (clientTaskId && !clientOf(clientTaskId))
          return fail("You cannot raise a request for this client.", "42501");
        const parts = plan(t, clientTaskId, (args.p_answers ?? {}) as Args).map(
          ({ team: _t, owner, ...p }) => ({
            ...p,
            owner: {
              label: owner.label,
              how: owner.how,
              note: noteFor(owner.note),
            },
          }),
        );
        const g = gate(clientTaskId);
        return ok({
          parts,
          note: parts.length
            ? null
            : `Pick ${whenLabel(t) ?? "the choices above"} to see where it goes.`,
          dueDefault: workingDaysAhead(today(), t.due_days),
          // cockpit_request_writer_view: the mode too, as the server sends it.
          writer: {
            mode: fake.mode,
            canSend: g.allowed,
            held: g.held,
            note: g.note,
          },
        });
      }
      case "cockpit_request_submit":
        return submit(args);
      case "cockpit_request_cancel": {
        const r = requests.find(x => x.id === args.p_request_id);
        if (!r)
          return fail("That request is not in the cockpit. Reload the list.");
        if (
          r.parts.some(p =>
            ["sending", "delivered", "unknown"].includes(p.state),
          )
        )
          return fail(
            "Part of this request is already in ClickUp. Close it there.",
            "55000",
          );
        if (!cancellable(r))
          return fail(
            "Only the person who raised it, an editor, an admin or the CEO can cancel it.",
            "42501",
          );
        const reason = String(args.p_reason ?? "").trim();
        if (!reason) return fail("Say why it is cancelled, in a few words.");
        for (const p of r.parts) {
          p.state = "skipped";
          p.error = "Cancelled in the cockpit.";
        }
        r.state = "cancelled";
        r.history.push({
          at: iso(),
          what: `Cancelled: ${reason}`,
          byLabel: s.label,
        });
        // The old form ticket it routed goes back to its queue (review round 2).
        const routed = r.replacesTaskId
          ? requests.find(
              x =>
                x.importedTaskId === r.replacesTaskId &&
                x.state === "routed" &&
                x.routedTo === r.id,
            )
          : undefined;
        if (routed) {
          routed.state = "imported";
          routed.routedTo = null;
          routed.history.push({
            at: iso(),
            what: "Back in the queue: the request that routed it was cancelled",
            byLabel: s.label,
          });
        }
        return ok(rowOf(r));
      }
      case "cockpit_requests_read": {
        const view = String(args.p_view) as RequestView;
        if (!["mine", "assigned", "team", "all"].includes(view))
          return fail(
            "Pick My requests, Assigned to me, a team queue or All requests.",
          );
        if (view === "all" && !allOf(s))
          return fail(
            "Only an editor, an admin or the CEO can see all requests.",
            "42501",
          );
        const limit = Math.max(1, Math.min(200, Number(args.p_limit ?? 50)));
        // p_since: only the requests made at or after it (contract F3).
        const since = args.p_since ? Date.parse(String(args.p_since)) : null;
        const open = (r: StoredRequest) =>
          !r.done &&
          !["cancelled", "routed"].includes(r.state) &&
          !r.importHandled;
        const rows = requests
          .filter(r => inView(r, view))
          .filter(r => since === null || Date.parse(r.createdAt) >= since)
          .sort(
            (x, y) =>
              Number(open(y)) - Number(open(x)) ||
              (x.dueOn ?? "9999").localeCompare(y.dueOn ?? "9999") ||
              y.createdAt.localeCompare(x.createdAt),
          )
          .slice(0, limit)
          .map(rowOf);
        return ok({
          asOf: iso(),
          view,
          views: views(),
          rows,
          note:
            view === "assigned" && s.link !== "linked"
              ? "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it."
              : view === "team" && !s.teams.length
                ? "Your seat has no team queue. Use My requests to see what you asked for."
                : null,
        });
      }
      case "cockpit_request_get": {
        const r = requests.find(x => x.id === args.p_request_id);
        if (!r)
          return fail("That request is not in the cockpit. Reload the list.");
        const reqd = detail(r) as RequestDetail & {
          importedTaskId?: string | null;
        };
        return ok(reqd);
      }
      case "cockpit_request_type_save":
        return saveType(args);
      case "cockpit_request_type_restore":
        return saveType(args, Number(args.p_version));
      case "cockpit_request_type_versions": {
        if (!s.editor) return fail("Only an editor can see versions.", "42501");
        const v = versions[String(args.p_key)];
        if (!v)
          return fail("That request type does not exist. Reload the page.");
        return ok({ versions: v.map(({ row: _r, ...x }) => x) });
      }
      case "cockpit_request_people":
        if (!s.editor)
          return fail("Only an editor can see the ClickUp people.", "42501");
        return ok({
          people: HARNESS_PEOPLE.map(p => ({
            clickupUserId: p.clickupUserId,
            label: p.username,
            seat: p.seat,
          })),
        });
      case "cockpit_member_clickup_read":
        if (!s.editor)
          return fail("Only an editor can link seats to ClickUp.", "42501");
        return ok({
          readAt: "2026-10-26T12:11:00Z",
          seats: seatList.map(x => seatRow(x.memberId)),
          members: HARNESS_PEOPLE.map(p => ({
            clickupUserId: p.clickupUserId,
            username: p.username,
            linkedTo:
              Object.entries(links).find(
                ([, l]) =>
                  l?.clickupUserId === p.clickupUserId &&
                  ["ok", "manual"].includes(l.state),
              )?.[0] ?? null,
          })),
        });
      case "cockpit_member_clickup_set": {
        if (!s.editor)
          return fail("Only an editor can link seats to ClickUp.", "42501");
        const id = String(args.p_member_id);
        if (!seatList.some(x => x.memberId === id))
          return fail("Choose an active seat.");
        const cu = args.p_clickup_user_id as number | null;
        if (cu === null)
          links[id] = {
            state: "cleared",
            clickupUserId: null,
            matchedBy: "editor",
            note: "An editor said this seat has no ClickUp user.",
            checkedAt: iso(),
          };
        else {
          if (!HARNESS_PEOPLE.some(p => p.clickupUserId === cu))
            return fail(
              "That person is not in the ClickUp workspace. Pick someone from the list.",
            );
          // One seat a ClickUp person (the review of 2026-10-26).
          const taken = Object.entries(links).find(
            ([m, l]) =>
              m !== id &&
              l?.clickupUserId === cu &&
              ["ok", "manual"].includes(l.state),
          );
          if (taken)
            return fail(
              "That ClickUp user is already linked to another seat. Clear that link first.",
              "23505",
            );
          if (id === s.memberId && !s.ceo)
            return fail(
              "You cannot link your own seat. Ask the CEO or another editor to do it.",
              "42501",
            );
          links[id] = {
            state: "manual",
            clickupUserId: cu,
            matchedBy: "editor",
            note: "Set by an editor.",
            checkedAt: iso(),
          };
        }
        return ok(seatRow(id));
      }
      case "cockpit_task_alert_rules_read":
        return rulesRead((args.p_member_id as string | null) ?? null);
      case "cockpit_task_alert_rules_set": {
        const who = String(args.p_member_id);
        if (who !== s.memberId && !s.editor)
          return fail(
            "Only an editor can change another seat's alerts.",
            "42501",
          );
        const patch = (args.p_patch ?? {}) as Record<string, unknown>;
        if (patch.slackDm === true)
          return fail(
            "Slack messages for alerts are not switched on yet. New assignments already post in your team's Slack channel.",
          );
        if (Array.isArray(patch.kinds)) {
          if (!patch.kinds.includes("request_failed"))
            return fail("A failed request always alerts. Keep it on.");
          alertKinds[who] = patch.kinds as string[];
        }
        if ("shiftStart" in patch || "shiftEnd" in patch) {
          const start = (patch.shiftStart as string | null) ?? null;
          const end = (patch.shiftEnd as string | null) ?? null;
          if ((start === null) !== (end === null))
            return fail(
              "Set both the start and the end of the shift, or neither.",
            );
          shifts[who] = { start, end };
        }
        return rulesRead(who);
      }
    }
    return fail(`The harness has no answer for ${name}.`);
  }

  return fake;
}

/**
 * Patches the cockpit client's rpc so the requests functions answer from a
 * made-up store (the layout harness only). Everything else goes to whatever
 * answered before.
 */
export function installRequestsHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  const pick = params.get("requests") ?? "default";
  const after = params.get("send");
  const delay = Number(params.get("delay") ?? 350);
  const seat = params.get("seat");
  const writer = params.get("writer") as WriterMode | null;
  const last = params.get("lastMode") as WriterMode | null;
  const fake = createRequestsFake({
    seat: seat === "csm" || seat === "sales" ? seat : "ceo",
    mode:
      writer &&
      ["apply", "apply_limited", "dry_run", "unknown"].includes(writer)
        ? writer
        : "apply",
    lastMode:
      last && ["apply", "apply_limited", "dry_run"].includes(last)
        ? last
        : undefined,
    specs: params.get("specs") !== "0",
    empty: pick === "empty",
    routes: params.get("routes") !== "0",
    seed: params.get("types") === "12" ? HARNESS_SEED : ALL_TYPES_SEED,
  });
  // ?requests=partial: the pause's Media task refused for good at create
  // while its Tech task landed, so the panel names the missing task.
  if (pick === "partial") {
    const pause = fake.requests.find(r => r.typeKey === "client_pause");
    const media = pause?.parts.find(p => p.part === "media");
    if (pause && media) {
      media.state = "failed";
      media.error =
        "ClickUp refused the task: the template is not in ClickUp any more.";
      media.url = null;
      media.status = null;
      media.statusType = null;
      media.verifyState = null;
      pause.state = "partial";
    }
  }
  // ?requests=old: the request that did not reach ClickUp routed an old form
  // ticket, and the writer's old-ticket check made nothing because the team
  // closed that ticket in ClickUp while it waited (review round 2).
  if (pick === "old") {
    const card = fake.requests.find(r => r.typeKey === "card_missing");
    if (card) {
      card.replacesTaskId = "z8xharn01";
      card.parts[0].state = "skipped";
      card.parts[0].error =
        "The old ticket was already moved or closed in ClickUp, so no new task was made. Check it there.";
    }
  }
  const c = client as unknown as {
    rpc: (name: string, args?: Args) => Promise<Answer>;
  };
  const previous = c.rpc.bind(c);
  const wait = () => new Promise(r => setTimeout(r, delay));
  c.rpc = async (name, args = {}) => {
    if (!fake.handles(name)) return previous(name, args);
    if (pick === "loading") return new Promise<Answer>(() => {});
    await wait();
    if (pick === "error")
      return fail("canceling statement due to statement timeout", "57014");
    if (pick === "missing")
      return fail("Could not find the function", "PGRST202");
    const answer = fake.call(name, args);
    // The writer's next run, a few seconds after a send.
    if (name === "cockpit_request_submit" && !answer.error)
      setTimeout(() => {
        const sent = fake.requests.find(
          r => r.id === (answer.data as { id?: string } | null)?.id,
        );
        if (sent && (after === "refuse" || after === "partial")) {
          if (after === "partial") fake.advance();
          sent.parts.forEach((p, i) => {
            if (after === "partial" && i === 0) return;
            p.state = "failed";
            p.error =
              "ClickUp refused the task: the template is not in ClickUp any more.";
            p.url = null;
            p.status = null;
            p.statusType = null;
          });
          sent.state = after === "partial" ? "partial" : "failed";
          return;
        }
        fake.advance();
        // In ClickUp, but a later step refused (requests.ts STEP_REFUSED).
        if (sent && after === "note" && sent.parts[0]?.state === "delivered")
          sent.parts[0].error =
            "ClickUp refused the owner, due day or priority. Set them on the task in ClickUp.";
      }, 4000);
    return answer;
  };
}

/**
 * All 31 types, read from the binding file itself (docs/requests/request-types.json,
 * the seed migration 20261026s prints), so the layout harness shows every
 * request as the database holds it after the seed.
 */
export const ALL_TYPES_SEED: Seed = requestTypesJson as unknown as Seed;

// --- Twelve of the 31 seeded types, as docs/requests/request-types.json holds them

export const HARNESS_SEED: Seed = {
  field_catalog: [
    {
      clickup_field_id: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
      clickup_name: "ADs Platform",
      kind: "select",
      label: "Ad platform",
      options: [
        {
          id: "88d55b4b-f296-4a0b-abc6-3b228889444a",
          name: "Facebook/Meta",
        },
        {
          id: "c115bdfe-661f-4855-a86b-69a54b2e616a",
          name: "Tiktok",
        },
        {
          id: "97b22a7b-c18b-4be9-bd03-ff271bacfd77",
          name: "Snapchat",
        },
      ],
    },
    {
      clickup_field_id: "fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0",
      clickup_name: "Employee",
      kind: "text",
      label: "Employee's full name",
      options: null,
    },
    {
      clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
      clickup_name: "Additional Notes",
      kind: "text",
      label: "Notes",
      options: null,
    },
    {
      clickup_field_id: "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4",
      clickup_name: "Schedule Rate Issue",
      kind: "select",
      label: "Where is the problem?",
      options: [
        {
          id: "a2343b36-5d92-428d-9f73-ce47711480c2",
          name: "Ads issue",
        },
        {
          id: "cf9d1709-8d52-489b-9600-21e6a0d6ac12",
          name: "Call Center Issue",
        },
        {
          id: "0014e47b-560a-4109-830c-77d6d60d985c",
          name: "Both",
        },
      ],
    },
    {
      clickup_field_id: "0f8f9334-69e7-46fc-aad1-d62402387f27",
      clickup_name: "Lead List",
      kind: "url",
      label: "Lead list link",
      options: null,
    },
    {
      clickup_field_id: "5fd89e5e-98c8-4800-a1ce-33f5b739a275",
      clickup_name: "Script Type",
      kind: "select",
      label: "What are we writing?",
      options: [
        {
          id: "ba39a410-0698-4bff-9cc9-b2a3eacddb9d",
          name: "Paid Ads Reel",
        },
        {
          id: "464556b1-f7b9-44b8-9291-b7add20f731a",
          name: "Organic Reel",
        },
        {
          id: "b1108fa3-d59d-41dc-9366-d83ae7c6aad3",
          name: "UGC / Talking Head",
        },
        {
          id: "58fdcaad-4497-448d-afd6-bb5ee962a684",
          name: "Video Sales Letter (VSL)",
        },
        {
          id: "d7b94a22-254d-4bb1-8b6a-4f52d80f1711",
          name: "Thank You / Post-Booking Video",
        },
        {
          id: "8809d9c5-29ed-42c8-851a-aba39d98a3a3",
          name: "Landing Page Copy",
        },
        {
          id: "0649cb57-28e2-4073-b9ea-9e1af77291f7",
          name: "Webinar / Presentation",
        },
        {
          id: "b152be7e-d5a8-479d-bbbf-32b9751633d6",
          name: "Email or WhatsApp Sequence",
        },
        {
          id: "944139ef-05dc-4933-80ad-5bc77f1fa6ca",
          name: "Other (see notes)",
        },
      ],
    },
    {
      clickup_field_id: "846f445e-ab13-4be2-84c5-2b5210dbca35",
      clickup_name: "Script Style",
      kind: "select",
      label: "How is it shot?",
      options: [
        {
          id: "05b0dbf6-ed17-4366-a458-28428d40ff5c",
          name: "UGC / Talking Head",
        },
        {
          id: "00b7a6f2-af93-4263-a99d-0231baec4279",
          name: "Voiceover (VO)",
        },
        {
          id: "58187607-f84a-479a-9707-bf7690ec1d80",
          name: "POV",
        },
        {
          id: "e6bfb0a0-54e6-4cf2-b041-312d500486f8",
          name: "VO + POV",
        },
        {
          id: "6d486525-7e18-4082-8ee9-8aaa77516a73",
          name: "AI Avatar",
        },
      ],
    },
    {
      clickup_field_id: "7cbff577-4a7b-491f-ab60-5937b3bda4a3",
      clickup_name: "Orientation",
      kind: "select",
      label: "Orientation",
      options: [
        {
          id: "1dbd6ae4-6590-44e2-bc4e-eb1107e72c56",
          name: "Vertical 9:16",
        },
        {
          id: "2ded3907-6baf-4212-83b1-9de7028d200d",
          name: "Horizontal 16:9",
        },
        {
          id: "1f275885-78e4-44c2-9faf-3be78cd0e2ef",
          name: "Square 1:1",
        },
      ],
    },
    {
      clickup_field_id: "833192d1-e11b-4f91-807a-60abad061ff2",
      clickup_name: "Script Quantity",
      kind: "number",
      label: "How many scripts?",
      options: null,
    },
    {
      clickup_field_id: "fb0e7743-9076-473b-9238-72ec729df120",
      clickup_name: "Who Films It",
      kind: "select",
      label: "Who films it?",
      options: [
        {
          id: "1bbc46a6-bc2f-4fc7-8ecd-c85433c8a12d",
          name: "Us",
        },
        {
          id: "984160c0-0142-43a8-a2c6-c8a6ccbb152d",
          name: "Them",
        },
      ],
    },
    {
      clickup_field_id: "0d6140e8-f145-4415-a82e-1d348904924a",
      clickup_name: "Script Language",
      kind: "select",
      label: "Script language",
      options: [
        {
          id: "c3036bbc-b018-481e-930c-cf5d455fb8ba",
          name: "Arabic",
        },
        {
          id: "a7c25514-4947-4a73-b2e2-965a84685838",
          name: "English",
        },
        {
          id: "5ee795d2-959e-488f-9ec6-6e3af614ea25",
          name: "Both",
        },
      ],
    },
    {
      clickup_field_id: "673028fc-8cf7-4e56-815b-bd454c8d604a",
      clickup_name: "Arabic Dialect",
      kind: "select",
      label: "Arabic dialect",
      options: [
        {
          id: "d0ef015b-fc0d-45b7-a817-26ab5ea45a05",
          name: "Kuwaiti",
        },
        {
          id: "07a87cdb-aba4-4650-b6fa-8f1087db2838",
          name: "Bahraini",
        },
        {
          id: "18e715c4-1c55-4d4c-a6b9-26d2e327d823",
          name: "Qatari",
        },
        {
          id: "ced15044-acdf-4757-976d-d30a9cf269ae",
          name: "Emirati",
        },
        {
          id: "737f5e82-52cf-444f-9194-1979486cf267",
          name: "Omani",
        },
        {
          id: "ca26f478-b956-419d-8118-9185443edcf8",
          name: "Saudi - Najdi (Riyadh/central)",
        },
        {
          id: "3f2a3026-571b-45e9-b4d8-5a919f2f6467",
          name: "Saudi - Hejazi (Jeddah/west)",
        },
        {
          id: "dce1503c-38b1-4fd8-a436-b39273af93fd",
          name: "Saudi - Eastern",
        },
        {
          id: "f6082a08-8fa0-4c0c-98a2-ace005910ccf",
          name: "Standard Arabic (Fusha)",
        },
        {
          id: "b855466d-5063-42bd-bcb9-75e1debc13d2",
          name: "English only",
        },
      ],
    },
    {
      clickup_field_id: "4b9c5187-430f-4534-99cf-db3fa2741dda",
      clickup_name: "Video for Page (optional)",
      kind: "url",
      label: "Video for the page",
      options: null,
    },
    {
      clickup_field_id: "41b41285-1152-48b8-85f2-ccb080ea7662",
      clickup_name: "Copy Doc or Link",
      kind: "longtext",
      label: "Copy doc or link",
      options: null,
    },
    {
      clickup_field_id: "dfe24578-f27a-43ea-970f-4dd9e1825b47",
      clickup_name: "Page Goal",
      kind: "select",
      label: "Page goal",
      options: [
        {
          id: "33d8bef7-9176-4190-bc2d-d92bfa338232",
          name: "Book a call",
        },
        {
          id: "7d746cc8-5ee3-4ce5-a1fc-f84b2c244a3e",
          name: "Lead form submit",
        },
        {
          id: "33c19c2c-dedd-4eab-80b6-38ff08270006",
          name: "WhatsApp chat",
        },
        {
          id: "c3831a22-c5f3-4d64-9473-80fcb888e245",
          name: "Webinar registration",
        },
        {
          id: "0cb21102-bac7-408b-a75f-f43be1347a13",
          name: "Other (see notes)",
        },
      ],
    },
    {
      clickup_field_id: "bcba69d7-9941-486d-84f5-6d6dcdefe4d3",
      clickup_name: "Requested Questions (optional)",
      kind: "longtext",
      label: "Any questions to add?",
      options: null,
    },
  ],
  types: [
    {
      type_index: 1,
      key: "create_ad_account",
      label: "Create an ad account",
      clickup_option_name: "Create Ad Account",
      request_type_option_id: "fd4d330d-2bda-4872-b195-11e694b29231",
      team: "ads",
      targets: [
        {
          part: "meta",
          name_suffix: "",
          list_id: "901816723196",
          team: "ads",
          template_id: "t-86ex6f3q7",
          template_name: "Create Meta Ad Account 🛜",
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: {
            field_key: "ads_platform",
            options: ["88d55b4b-f296-4a0b-abc6-3b228889444a"],
          },
        },
        {
          part: "tiktok",
          name_suffix: "",
          list_id: "901816723196",
          team: "ads",
          template_id: "t-86ex6ee7a",
          template_name: "Create TikTok Ad Account 🎵",
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: {
            field_key: "ads_platform",
            options: ["c115bdfe-661f-4855-a86b-69a54b2e616a"],
          },
        },
        {
          part: "snapchat",
          name_suffix: "",
          list_id: "901816723196",
          team: "ads",
          template_id: "t-86ex6ehwe",
          template_name: "Create Snapchat Ad Account 👻",
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: {
            field_key: "ads_platform",
            options: ["97b22a7b-c18b-4be9-bd03-ff271bacfd77"],
          },
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "ads_platform",
          label: "Ad platform",
          kind: "select",
          clickup_field_id: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/1H1jozw8G544KlDTH_4bIqD-52TOF4wXtL5zF9zoSwPE/edit",
      due_days: 3,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 3,
      key: "employee_onboarding",
      label: "New employee onboarding",
      clickup_option_name: "New Employee Onboarding 🤵",
      request_type_option_id: "88ab0389-7e36-4714-8b65-6d966ce9aed1",
      team: "tech",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723190",
          team: "tech",
          template_id: "t-86ex09ytj",
          template_name: "New Employee Onboarding 🙋‍♂️",
          owner_rule: "systems_manager",
          owner_clickup_id: 113459516,
          when: null,
        },
      ],
      fields: [
        {
          key: "employee_name",
          label: "Employee's full name",
          kind: "text",
          clickup_field_id: "fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url: null,
      due_days: 3,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 7,
      key: "whatsapp_connection",
      label: "WhatsApp connection issue",
      clickup_option_name: "Whatsapp Connection Issue 🔁",
      request_type_option_id: "663ffd51-a838-4038-a8c0-a936b86f43b7",
      team: "client_success",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723211",
          team: "client_success",
          template_id: "t-86ex62m1b",
          template_name: "Whatsapp Connection Issue📲❌",
          owner_rule: "csm_of_card",
          owner_clickup_id: 113688800,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: [
        "Open Agency View in MaharaOS, then WhatsApp, and find the client's account.",
        "Confirm the connection shows disconnected or an error.",
        "Send the client the QR code link to rescan.",
        "Confirm WhatsApp shows active (green).",
        "Tell the requester in Slack that it is resolved.",
        "Mark the task complete.",
      ],
      sop_steps_state: "source",
      sop_url:
        "https://docs.google.com/document/d/1uQpWkwse7X3a0H9QcdTo57kayY0f4lO9tFB56_N3nr4/edit",
      due_days: 1,
      priority: "high",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 8,
      key: "whatsapp_reactivation",
      label: "WhatsApp reactivation campaign",
      clickup_option_name: "Whatsapp Reactivation Campaign 📬",
      request_type_option_id: "862f83da-8980-4ebe-9477-7501ccbf23d3",
      team: "creative",
      targets: [
        {
          part: "message",
          name_suffix: " (Media)",
          list_id: "901818016338",
          team: "creative",
          template_id: "t-86exj3g1a",
          template_name: "Client Reactivation Campaign (Media)📣",
          owner_rule: "creative_strategist",
          owner_clickup_id: 113520400,
          when: null,
        },
        {
          part: "send",
          name_suffix: " (Tech)",
          list_id: "901816723190",
          team: "tech",
          template_id: "t-86exj3h8f",
          template_name: "Client Reactivation Campaign📣 (Tech)",
          owner_rule: "systems_manager",
          owner_clickup_id: 113459516,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "lead_list",
          label: "Lead list link",
          kind: "url",
          clickup_field_id: "0f8f9334-69e7-46fc-aad1-d62402387f27",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "additional_notes",
          label: "Notes",
          kind: "text",
          clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/1VRjaZCVVOD26NCar6sCtWbxgoPGgj7vGtPI4vDrxZY8/edit",
      due_days: 5,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 13,
      key: "client_pause",
      label: "Client pause",
      clickup_option_name: "Client Pause Request ⏸️",
      request_type_option_id: "196991a9-dac9-4da8-a693-6b6d64372be5",
      team: "tech",
      targets: [
        {
          part: "tech",
          name_suffix: " (Tech)",
          list_id: "901816723190",
          team: "tech",
          template_id: "t-86ex63qk5",
          template_name: "Client Pause ⏸️ (Tech)",
          owner_rule: "systems_manager",
          owner_clickup_id: 113459516,
          when: null,
        },
        {
          part: "media",
          name_suffix: " (Media)",
          list_id: "901816723196",
          team: "ads",
          template_id: "t-86ex63qm7",
          template_name: "Client Pause ⏸️ (Media)",
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/1qctuHLsH6TJl_E9UFIfTzy-ZzkcGuHhCbHspc7SabX4/edit",
      due_days: 2,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 18,
      key: "landing_page",
      label: "Create a landing page",
      clickup_option_name: "Create Landing Page📊",
      request_type_option_id: "a2d9483c-2dde-486d-969e-78679e5d27a6",
      team: "tech",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723190",
          team: "tech",
          template_id: "t-86exer2gv",
          template_name: "Create Landing Page📊",
          owner_rule: "systems_manager",
          owner_clickup_id: 113459516,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "additional_notes",
          label: "Notes",
          kind: "text",
          clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "requested_questions",
          label: "Any questions to add?",
          kind: "longtext",
          clickup_field_id: "bcba69d7-9941-486d-84f5-6d6dcdefe4d3",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "page_goal",
          label: "Page goal",
          kind: "select",
          clickup_field_id: "dfe24578-f27a-43ea-970f-4dd9e1825b47",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "copy_link",
          label: "Copy doc or link",
          kind: "longtext",
          clickup_field_id: "41b41285-1152-48b8-85f2-ccb080ea7662",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "video_for_page",
          label: "Video for the page",
          kind: "url",
          clickup_field_id: "4b9c5187-430f-4534-99cf-db3fa2741dda",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/1jjyMvWbmV3tZDfV3yD2isqQA9E3cGEv_3AZ2JSrJcic/edit",
      due_days: 10,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 21,
      key: "card_missing",
      label: "Card missing for ads",
      clickup_option_name: "Client Card Missing for ADs ❗❗",
      request_type_option_id: "7e7ae553-abde-4cd2-af26-a1cca7be668c",
      team: "client_success",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723211",
          team: "client_success",
          template_id: null,
          template_name: null,
          owner_rule: "csm_of_card",
          owner_clickup_id: 113688800,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: [
        "Confirm the ad account is stopped by a missing or failed payment method.",
        "Ask the client to add the card themselves on the platform's billing page, or on a short call while they type it; never collect card numbers in chat or a form.",
        "Check in the ad account that the payment method shows active and any unpaid balance is cleared.",
        "Confirm with the media buyer that ads are running again.",
        "Log it on the client card and mark the task complete.",
      ],
      sop_steps_state: "draft",
      sop_url: null,
      due_days: 1,
      priority: "high",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 22,
      key: "new_script",
      label: "New script",
      clickup_option_name: "New Script Request 📗",
      request_type_option_id: "a79b08d7-8e4f-469d-b70f-cba8514a06c3",
      team: "creative",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901818016338",
          team: "creative",
          template_id: "t-86ex63j6n",
          template_name: "New Script Request✍️",
          owner_rule: "creative_strategist",
          owner_clickup_id: 113520400,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "script_type",
          label: "What are we writing?",
          kind: "select",
          clickup_field_id: "5fd89e5e-98c8-4800-a1ce-33f5b739a275",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "script_style",
          label: "How is it shot?",
          kind: "select",
          clickup_field_id: "846f445e-ab13-4be2-84c5-2b5210dbca35",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "orientation",
          label: "Orientation",
          kind: "select",
          clickup_field_id: "7cbff577-4a7b-491f-ab60-5937b3bda4a3",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "script_quantity",
          label: "How many scripts?",
          kind: "number",
          clickup_field_id: "833192d1-e11b-4f91-807a-60abad061ff2",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "who_films",
          label: "Who films it?",
          kind: "select",
          clickup_field_id: "fb0e7743-9076-473b-9238-72ec729df120",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "script_language",
          label: "Script language",
          kind: "select",
          clickup_field_id: "0d6140e8-f145-4415-a82e-1d348904924a",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "arabic_dialect",
          label: "Arabic dialect",
          kind: "select",
          clickup_field_id: "673028fc-8cf7-4e56-815b-bd454c8d604a",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "additional_notes",
          label: "Notes",
          kind: "text",
          clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/1B961T9tc5Dgu4qTHvecojnjIBxxzQpP7U5dgx_C5Imk/edit",
      due_days: 7,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 26,
      key: "low_schedule_rate",
      label: "Low schedule rate",
      clickup_option_name: "Low Schedule Rate📉",
      request_type_option_id: "36ea1d39-4115-4a46-9f18-34664e7adac3",
      team: "call_center",
      targets: [
        {
          part: "call_center",
          name_suffix: " (Call Center)",
          list_id: "901816723206",
          team: "call_center",
          template_id: "t-86exj3d37",
          template_name: "Low Schedule Rate📉 (Call Center)",
          owner_rule: "csm_of_card",
          owner_clickup_id: 113688800,
          when: {
            field_key: "schedule_rate_issue",
            options: [
              "cf9d1709-8d52-489b-9600-21e6a0d6ac12",
              "0014e47b-560a-4109-830c-77d6d60d985c",
            ],
          },
        },
        {
          part: "ads",
          name_suffix: " (Ads)",
          list_id: "901816723196",
          team: "ads",
          template_id: "t-86exj3cvt",
          template_name: "Low Schedule Rate📉 (Ads)",
          owner_rule: "media_buyer_of_record",
          owner_clickup_id: null,
          when: {
            field_key: "schedule_rate_issue",
            options: [
              "a2343b36-5d92-428d-9f73-ce47711480c2",
              "0014e47b-560a-4109-830c-77d6d60d985c",
            ],
          },
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "schedule_rate_issue",
          label: "Where is the problem?",
          kind: "select",
          clickup_field_id: "e58f563a-63c7-4f3a-b5cd-07cbb4a420d4",
          required: true,
          options: null,
          help: null,
        },
        {
          key: "additional_notes",
          label: "Notes",
          kind: "text",
          clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: null,
      sop_steps_state: "none",
      sop_url:
        "https://docs.google.com/document/d/15RCQBTfIKpJCLxDbH4ojzb-0t3lFs0uJHcXz3xRKndo/edit",
      due_days: 3,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 27,
      key: "general_tech",
      label: "General tech request",
      clickup_option_name: "General Tech Request",
      request_type_option_id: "71c628d0-ee1f-4dc6-90ce-b4da84b7b367",
      team: "tech",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723190",
          team: "tech",
          template_id: null,
          template_name: null,
          owner_rule: "systems_manager",
          owner_clickup_id: 113459516,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
        {
          key: "details",
          label: "What is needed?",
          kind: "details",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
      ],
      sop_steps: [
        "Read the request; ask the requester the same day for anything missing (client, link, deadline).",
        "Move the task to in progress and write the plan in a comment.",
        "Make the change and test it end to end.",
        "Write what changed and where in the task.",
        "Tell the requester and mark the task complete.",
      ],
      sop_steps_state: "draft",
      sop_url: null,
      due_days: 2,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 29,
      key: "general_csm",
      label: "General CSM ticket",
      clickup_option_name: "General CSM Ticket",
      request_type_option_id: "5db37a3e-f3cd-4513-8e38-750fecfa34c6",
      team: "client_success",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901816723211",
          team: "client_success",
          template_id: null,
          template_name: null,
          owner_rule: "csm_of_card",
          owner_clickup_id: 113688800,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
        {
          key: "details",
          label: "What is needed?",
          kind: "details",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
      ],
      sop_steps: [
        "Read the request and open the client's card if one is named.",
        "Ask the requester for anything missing the same day.",
        "Do the work, or book the client call it needs.",
        "Log the outcome on the client card.",
        "Tell the requester and mark the task complete.",
      ],
      sop_steps_state: "draft",
      sop_url: null,
      due_days: 2,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
    {
      type_index: 30,
      key: "social_media",
      label: "Social media management",
      clickup_option_name: "Social Media Management Request",
      request_type_option_id: "108eef9b-55f7-45c5-9af0-0c9462925902",
      team: "creative",
      targets: [
        {
          part: "main",
          name_suffix: "",
          list_id: "901818016338",
          team: "creative",
          template_id: null,
          template_name: null,
          owner_rule: "creative_strategist",
          owner_clickup_id: 113520400,
          when: null,
        },
      ],
      fields: [
        {
          key: "client",
          label: "Client",
          kind: "client",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "details",
          label: "Details",
          kind: "details",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          clickup_field_id: null,
          required: true,
          options: null,
          help: null,
        },
        {
          key: "priority",
          label: "Priority",
          kind: "priority",
          clickup_field_id: null,
          required: false,
          options: null,
          help: null,
        },
      ],
      sop_steps: [
        "Confirm the client is Active and the upsell is on the client card.",
        "Check the client's GoHighLevel Social Planner has Instagram and Facebook connected as business accounts; test one private draft.",
        "Collect the brand guide, logo and at least 5 real photos from the client's Drive; ask the CSM for anything missing.",
        "Pick the pillar mix and cadence from the SOP's table.",
        "Build the content bank: 10 to 15 real audience questions for the niche.",
        "Write the month's plan (topic and slide count per post) and approve it before any image.",
        "Generate the approved posts in Higgsfield with the client's colours and real photos, and self-check each set.",
        "Have a second person review before the client sees anything.",
        "Push the batch to Social Planner's review queue with the client as approver and send the approval link.",
        "Watch the queue and carry rejected reasons into next month's content bank.",
      ],
      sop_steps_state: "draft",
      sop_url:
        "https://docs.google.com/document/d/1eSsQiHj3b6QM3tqY7tmXHA-ryYdDjO_Ee2P2FYehjRM/edit",
      due_days: 10,
      priority: "normal",
      set_request_type: false,
      enabled: true,
    },
  ],
};
