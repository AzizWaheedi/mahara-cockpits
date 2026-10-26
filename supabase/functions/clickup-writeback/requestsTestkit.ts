// Test kit for the requests job (requests.test.ts, taskActions.test.ts, run.test.ts).
//
// FakeClickUp holds tasks, comments, checklists, tags, fields and templates in
// memory and answers the ClickUp v2 paths the writer uses, the way ClickUp
// does where it matters: a date-only due date is stored at 06:00 Kuwait, a
// dropdown reads back as its orderindex, comments page 25 at a time, newest
// first. Failures are injected per call (`fail`), and a write whose answer is
// lost (`lose`) lands in ClickUp and then throws the provider's "unknown".
//
// FakeDb stands in for migrations 20261009f and 20261026r: the requests claim
// (one lane per task), the save (claimed rows only, steps frozen, the eight
// patch keys), the run rows, the requests state row, rt_off, and the part sync
// trigger's two effects the writer relies on (the part follows its queue row,
// and a delivered part queues its two-minute check).
//
// Every person, client and ClickUp id here is invented, except the list ids,
// the folder field id and the Request Type option ids, which are ClickUp's
// own (docs/requests/request-types.json) and no secret.

import type { Provider } from "./queue.ts";
import type { Row } from "./rules.ts";
import { type Deps, runRequests } from "./run.ts";

export const NOW = Date.parse("2026-10-26T09:00:00Z"); // Sunday 26 Oct 2026, 12:00 Kuwait
export const TEAM = "90182518398";
export const SPACE = "901810248115";
export const LISTS = {
  tech: "901816723190",
  ads: "901816723196",
  callCenter: "901816723206",
  cs: "901816723211",
  creative: "901818016338",
  allTasks: "901816723226",
  cards: "901816559981",
  pipeline: "901816720767",
} as const;
export const LIST_NAMES: Record<string, string> = {
  [LISTS.tech]: "Operations / Tech",
  [LISTS.ads]: "Marketing / ADs",
  [LISTS.callCenter]: "Call Center",
  [LISTS.cs]: "Client Success",
  [LISTS.creative]: "Media/Creative",
  [LISTS.allTasks]: "All Tasks",
  [LISTS.cards]: "Clients - Mahara",
  [LISTS.pipeline]: "Video Pipeline",
};
/** Invented ClickUp users, by role. */
export const PEOPLE = { systemsManager: 700001, strategist: 700002, csm: 700003, mediaBuyer: 700004, api: 700009 } as const;
export const CARD = "86card0001";
export const TEST_CARD = "86eywg1cq";
export const RT_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";
export const OPTION = {
  generalTech: "71c628d0-ee1f-4dc6-90ce-b4da84b7b367",
  pause: "196991a9-dac9-4da8-a693-6b6d64372be5",
  whatsapp: "663ffd51-a838-4038-a8c0-a936b86f43b7",
  leadForm: "37d99ca0-e53f-4499-90e8-f1be8a21b207",
} as const;
export const FIELD = {
  leadList: "0f8f9334-69e7-46fc-aad1-d62402387f27",
  scriptType: "5fd89e5e-98c8-4800-a1ce-33f5b739a275",
  scriptQuantity: "833192d1-e11b-4f91-807a-60abad061ff2",
  notes: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
} as const;

/** The folder fields every department list carries (a few of the 24). */
export const FOLDER_FIELDS: Row[] = [
  {
    id: RT_FIELD,
    name: "Request Type",
    type: "drop_down",
    type_config: {
      options: [
        // ClickUp's own name, with its stray spaces (writers map 1.5).
        { id: OPTION.leadForm, name: "Connect a New Lead Form  🆕 ", orderindex: 0 },
        { id: OPTION.whatsapp, name: "Whatsapp Connection Issue 🔁", orderindex: 7 },
        { id: OPTION.pause, name: "Client Pause Request ⏸️", orderindex: 13 },
        { id: OPTION.generalTech, name: "General Tech Request ", orderindex: 27 },
      ],
    },
  },
  { id: FIELD.leadList, name: "Lead List", type: "url", type_config: {} },
  {
    id: FIELD.scriptType,
    name: "Script Type",
    type: "drop_down",
    type_config: { options: [{ id: "st-reel", name: "Paid Ads Reel", orderindex: 0 }, { id: "st-other", name: "Other", orderindex: 8 }] },
  },
  { id: FIELD.scriptQuantity, name: "Script Quantity", type: "number", type_config: {} },
  { id: FIELD.notes, name: "Additional Notes", type: "short_text", type_config: {} },
];

export const STATUSES: Row[] = [
  { status: "to do", type: "open", orderindex: 0 },
  { status: "in progress", type: "custom", orderindex: 1 },
  { status: "review required", type: "custom", orderindex: 2 },
  { status: "pending", type: "custom", orderindex: 3 },
  { status: "complete", type: "done", orderindex: 4 },
  { status: "cancelled", type: "closed", orderindex: 5 },
];

export type TemplateObject = { name: string; markdown: string; checklists: { name: string; items: string[] }[] };
export const TEMPLATES: Record<string, TemplateObject> = {
  "t-86ex63qk5": {
    name: "Client Pause ⏸️ (Tech)",
    markdown: "**Pause the client's tech**\nTurn off what sends leads to the client.",
    checklists: [{ name: "Tech pause steps", items: ["Pause the GHL workflows", "Turn off the lead form", "Note it on the card", "Tell the CSM"] }],
  },
  "t-86ex63qm7": {
    name: "Client Pause ⏸️ (Media)",
    markdown: "**Pause the client's ads**",
    checklists: [{ name: "Media pause checklist", items: ["Pause every campaign", "Check spend stopped", "Tell the CSM"] }],
  },
  // The snapshot ClickUp keeps has the name but no checklist (CT F1.5).
  "t-86ex62m1b": { name: "Whatsapp Connection Issue📲❌", markdown: "", checklists: [] },
};

export const REQUEST_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const REF_HEX = "1a2b3c4d5e";
export const ACTION_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const GENERAL_TECH_STEPS = [
  "Read the request; ask the requester the same day for anything missing.",
  "Move the task to in progress and write the plan in a comment.",
  "Make the change and test it end to end.",
  "Write what changed and where in the task.",
  "Tell the requester and mark the task complete.",
];
export const WHATSAPP_STEPS = [
  "Open Agency View and find the client's account.",
  "Confirm the connection shows disconnected.",
  "Send the client the QR code link to rescan.",
  "Confirm WhatsApp shows active.",
  "Tell the requester in Slack that it is resolved.",
  "Mark the task complete.",
];

/** A frozen `request` payload (contract 2.6): General tech request on Operations / Tech, no template. */
export function requestPayload(over: Row = {}): Row {
  const part = String(over.part ?? "main");
  const client = over.clientName === undefined ? "Acme Interiors" : over.clientName;
  const card = over.clientTaskId === undefined ? CARD : over.clientTaskId;
  const label = String(over.typeLabel ?? "General tech request");
  const url = `https://cockpit.maharamedia.com/requests?id=${REQUEST_ID}`;
  return {
    requestId: REQUEST_ID,
    part,
    ref: `R-${REF_HEX}-${part}`,
    typeKey: "general_tech",
    typeLabel: label,
    typeVersion: 1,
    requestTypeOptionId: OPTION.generalTech,
    requestTypeOptionName: "General Tech Request",
    setRequestType: false,
    listId: LISTS.tech,
    listName: "Operations / Tech",
    templateId: null,
    templateName: null,
    taskName: client ? `${client} - ${label}` : `${label} - from the CSM`,
    descriptionMarkdown: [
      `**${label}** for ${client ?? "no client"}\nRequested by the CSM in the cockpit on Sun 26 Oct. Due Tue 28 Oct. Priority normal.`,
      "The lead form stopped sending leads.",
      "SOP steps are a draft until the systems manager checks them.",
      [card ? `Client card: https://app.clickup.com/t/${card}` : "", `Request in the cockpit: ${url}`].filter(Boolean).join("\n"),
    ].join("\n\n"),
    sopSteps: GENERAL_TECH_STEPS,
    sopChecklistName: "SOP steps (draft)",
    sopStepsWhen: "always",
    clientTaskId: card,
    clientName: client,
    clientTag: client ? String(client).toLowerCase() : null,
    ownerClickupId: PEOPLE.systemsManager,
    ownerLabel: "the systems manager",
    dueOn: "2026-10-28",
    dueMs: Date.parse("2026-10-28T09:00:00Z"),
    priority: "normal",
    priorityValue: 3,
    fields: [],
    replacesTaskId: null,
    requesterLabel: "the CSM",
    requestUrl: url,
    ...over,
  };
}

/** Client pause: two parts, each from its template (Tech owned by the systems manager, Media with no owner found). */
export function pausePayloads(): [Row, Row] {
  const base = {
    typeKey: "client_pause",
    typeLabel: "Client pause",
    requestTypeOptionId: OPTION.pause,
    requestTypeOptionName: "Client Pause Request ⏸️",
    sopSteps: null,
    sopChecklistName: null,
    sopStepsWhen: null,
    descriptionMarkdown:
      "**Client pause** for Acme Interiors\nRequested by the CSM in the cockpit on Sun 26 Oct. Due Tue 28 Oct. Priority normal.\n\nSOP: https://docs.example.com/pause\nClient card: https://app.clickup.com/t/86card0001",
  };
  return [
    requestPayload({ ...base, part: "tech", listId: LISTS.tech, listName: "Operations / Tech", templateId: "t-86ex63qk5", templateName: "Client Pause ⏸️ (Tech)", taskName: "Acme Interiors - Client pause (Tech)" }),
    requestPayload({
      ...base,
      part: "media",
      listId: LISTS.ads,
      listName: "Marketing / ADs",
      templateId: "t-86ex63qm7",
      templateName: "Client Pause ⏸️ (Media)",
      taskName: "Acme Interiors - Client pause (Media)",
      ownerClickupId: null,
      ownerLabel: "Nobody yet",
    }),
  ];
}

/** WhatsApp connection: a template whose snapshot carries no checklist, plus its six source steps. */
export function whatsappPayload(over: Row = {}): Row {
  return requestPayload({
    typeKey: "whatsapp_connection",
    typeLabel: "WhatsApp connection issue",
    requestTypeOptionId: OPTION.whatsapp,
    requestTypeOptionName: "Whatsapp Connection Issue 🔁",
    listId: LISTS.cs,
    listName: "Client Success",
    templateId: "t-86ex62m1b",
    templateName: "Whatsapp Connection Issue📲❌",
    taskName: "Acme Interiors - WhatsApp connection issue",
    sopSteps: WHATSAPP_STEPS,
    sopChecklistName: "SOP steps",
    sopStepsWhen: "if_template_empty",
    ownerClickupId: PEOPLE.csm,
    ownerLabel: "the CSM",
    priority: "high",
    priorityValue: 2,
    ...over,
  });
}

/** A frozen `task_action` payload (contract 3.4). */
export function actionPayload(op: string, over: Row = {}): Row {
  return {
    actionId: ACTION_ID,
    ref: "T-9f8e7d6c5b",
    op,
    taskId: "86work0001",
    listId: LISTS.tech,
    clientTaskId: CARD,
    checklistId: null,
    itemId: null,
    itemName: null,
    from: null,
    to: null,
    text: null,
    statusSeen: null,
    actor: { memberId: "5b1c0d2e-3f4a-4b5c-8d6e-7f8091a2b3c4", clickupUserId: PEOPLE.systemsManager, label: "the systems manager", isAdmin: false },
    requesterOfTask: false,
    ...over,
  };
}

// --- The fake ClickUp ------------------------------------------------------------------

export type Call = { actionId: string; provider: string; method: string; path: string; body?: Row };
export const unknownError = () => new Error("Provider response is unknown. Reconcile before retrying.");
export const rejected = (status: number, detail = "") =>
  new Error(`clickup rejected the request (${status})${detail ? `: ${detail}` : ". Inspect the provider receipt."}`);

const PRIORITY_NAME: Record<number, string> = { 1: "urgent", 2: "high", 3: "normal", 4: "low" };
/** ClickUp keeps a date-only value at its own hour: 06:00 Kuwait (03:00 UTC) of the Kuwait day sent. */
export const clickupStoredDue = (ms: number) => Date.parse(`${new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10)}T03:00:00Z`);

export class FakeClickUp {
  tasks = new Map<string, Row>();
  comments = new Map<string, Row[]>();
  templates: Record<string, TemplateObject> = structuredClone(TEMPLATES);
  spaceTags = ["acme interiors", "test client", "حول العمران"];
  members = [
    { id: PEOPLE.systemsManager, username: "Sam", email: "sam@example.com" },
    { id: PEOPLE.strategist, username: "Rania", email: "rania@example.com" },
    { id: PEOPLE.csm, username: "Lina", email: "lina@example.com" },
    { id: PEOPLE.mediaBuyer, username: "Omar", email: "omar@example.com" },
    { id: PEOPLE.api, username: "Cockpit", email: "api@example.com" },
  ];
  fields: Row[] = structuredClone(FOLDER_FIELDS);
  statuses = new Map<string, Row[]>();
  calls: Call[] = [];
  /** Throw this error for the call, before ClickUp does anything. */
  fail?: (c: Call) => Error | undefined;
  /** The call lands in ClickUp, and then its answer is lost. */
  lose?: (c: Call) => boolean;
  /** Fields ClickUp refuses with a 400, and fields it answers 200 for but never keeps. */
  refuse = new Set<string>();
  drop = new Set<string>();
  /** Where the id of a task made from a template sits in the answer (not documented by ClickUp). */
  templateAnswer: "top" | "task" = "task";
  /** List rules: run after ClickUp makes a task (assign, remove, move, rename). */
  onCreate?: (task: Row) => void;
  private seq = 0;

  constructor(readonly now: () => number) {
    for (const id of Object.values(LISTS)) this.statuses.set(id, structuredClone(STATUSES));
    // The two client cards on Clients - Mahara the payloads name.
    this.addTask({ id: CARD, name: "Acme Interiors", listId: LISTS.cards, date_created: String(now() - 86_400_000 * 90) });
    this.addTask({ id: TEST_CARD, name: "Test client", listId: LISTS.cards, date_created: String(now() - 86_400_000 * 90) });
  }

  provider(actionId: string): Provider {
    return { call: (provider, method, path, body) => this.handle({ actionId, provider, method, path, body }) };
  }

  writes() {
    return this.calls.filter(c => c.method !== "GET");
  }

  /** Seed a task (the new task's defaults, then `over`). */
  addTask(over: Row = {}): Row {
    const listId = String(over.listId ?? over.list?.id ?? LISTS.tech);
    const t = this.blank(listId, String(over.name ?? "A task"), over.id ? String(over.id) : undefined);
    const { listId: _l, ...rest } = over;
    Object.assign(t, rest);
    this.tasks.set(String(t.id), t);
    return t;
  }

  /** Seed `n` comments on a task, oldest first, the newest at `endMs`. */
  addComments(taskId: string, n: number, endMs: number) {
    const list = this.comments.get(taskId) ?? [];
    for (let i = n - 1; i >= 0; i--) list.push({ id: `c${++this.seq}`, comment_text: `Older note ${i}`, date: String(endMs - i * 1000), user: { id: PEOPLE.csm } });
    this.comments.set(taskId, list);
  }

  task(id: string) {
    return this.tasks.get(id);
  }

  /** The value a field holds on a task (a dropdown as its orderindex, as ClickUp answers). */
  value(taskId: string, fieldId: string) {
    return this.tasks.get(taskId)?.custom_fields?.find((f: Row) => f.id === fieldId)?.value;
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(4, "0")}`;
  }

  private blank(listId: string, name: string, id = this.nextId("86new")): Row {
    return {
      id,
      name,
      url: `https://app.clickup.com/t/${id}`,
      list: { id: listId, name: LIST_NAMES[listId] ?? "Another list" },
      status: { status: "to do", type: "open" },
      assignees: [],
      watchers: [{ id: PEOPLE.api }],
      creator: { id: PEOPLE.api },
      tags: [],
      priority: null,
      due_date: null,
      custom_fields: this.fields.map(f => ({ ...structuredClone(f), value: undefined })),
      checklists: [],
      markdown_description: "",
      text_content: "",
      description: "",
      date_created: String(this.now()),
    };
  }

  private setDescription(t: Row, md: string) {
    t.markdown_description = md;
    t.text_content = md.replace(/\*\*/g, "");
    t.description = t.text_content;
  }

  private setDue(t: Row, ms: unknown, withTime: unknown) {
    if (ms === null) t.due_date = null;
    else if (ms !== undefined) t.due_date = String(withTime === true ? Number(ms) : clickupStoredDue(Number(ms)));
  }

  private setPriority(t: Row, n: unknown) {
    if (n !== undefined) t.priority = n === null ? null : { id: String(n), priority: PRIORITY_NAME[Number(n)] };
  }

  private mustTask(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw rejected(404, "Task not found, deleted");
    return t;
  }

  private checklist(cid: string): [Row, Row] {
    for (const t of this.tasks.values()) {
      const c = (t.checklists as Row[]).find(x => x.id === cid);
      if (c) return [t, c];
    }
    throw rejected(404, "Checklist not found");
  }

  private created(t: Row) {
    this.tasks.set(String(t.id), t);
    this.onCreate?.(t);
    return t;
  }

  async handle(c: Call): Promise<Row> {
    this.calls.push(structuredClone(c));
    const failure = this.fail?.(c);
    if (failure) throw failure;
    const out = this.route(c);
    if (c.method !== "GET" && this.lose?.(c)) throw unknownError();
    return structuredClone(out);
  }

  private route(c: Call): Row {
    const [base, qs = ""] = c.path.split("?");
    const q = new URLSearchParams(qs);
    const parts = base.split("/");
    const body = c.body ?? {};
    const is = (method: string, re: RegExp) => c.method === method && re.test(base);

    if (is("GET", /^team$/)) return { teams: [{ id: TEAM, members: this.members.map(m => ({ user: m })) }] };
    if (is("GET", /^team\/\d+\/taskTemplate$/)) {
      const page = Number(q.get("page") ?? 0);
      return { templates: page === 0 ? Object.entries(this.templates).map(([id, t]) => ({ id, name: t.name })) : [] };
    }
    if (is("GET", /^space\/\d+\/tag$/)) return { tags: this.spaceTags.map(name => ({ name, tag_fg: "#fff", tag_bg: "#000" })) };
    if (is("GET", /^list\/\d+\/field$/)) return { fields: structuredClone(this.fields) };
    if (is("GET", /^list\/\d+$/)) return { id: parts[1], name: LIST_NAMES[parts[1]], statuses: this.statuses.get(parts[1]) ?? [] };
    if (is("GET", /^list\/\d+\/task$/)) {
      const gt = Number(q.get("date_created_gt") ?? 0);
      const tasks = [...this.tasks.values()]
        .filter(t => t.list.id === parts[1] && Number(t.date_created) > gt)
        .sort((a, b) => Number(b.date_created) - Number(a.date_created))
        // The list endpoint sends no markdown unless asked.
        .map(t => ({ ...t, markdown_description: q.get("include_markdown_description") === "true" ? t.markdown_description : undefined }));
      return { tasks, last_page: true };
    }
    if (is("POST", /^list\/\d+\/task$/)) {
      const t = this.blank(parts[1], String(body.name));
      this.setDescription(t, String(body.markdown_description ?? body.markdown_content ?? body.description ?? ""));
      if (Array.isArray(body.assignees)) t.assignees = body.assignees.map((id: number) => ({ id }));
      if (body.status) t.status = this.statusOf(parts[1], String(body.status));
      this.setDue(t, body.due_date, body.due_date_time);
      this.setPriority(t, body.priority);
      if (Array.isArray(body.tags)) t.tags = body.tags.map((name: string) => ({ name }));
      if (Array.isArray(body.custom_fields)) t.createdWithFields = body.custom_fields;
      this.created(t);
      return structuredClone(t);
    }
    if (is("POST", /^list\/\d+\/taskTemplate\/t-[a-z0-9]+$/)) {
      const tpl = this.templates[parts[3]];
      if (!tpl) throw rejected(404, "Template not found");
      const t = this.blank(parts[1], String(body.name ?? tpl.name));
      this.setDescription(t, tpl.markdown);
      t.checklists = tpl.checklists.map(cl => ({
        id: this.nextId("cl"),
        name: cl.name,
        date_created: String(this.now()),
        items: cl.items.map((name, i) => ({ id: this.nextId("it"), name, resolved: false, orderindex: i })),
      }));
      this.created(t);
      return this.templateAnswer === "top" ? { id: t.id } : { task: { id: t.id } };
    }
    if (is("GET", /^task\/[^/]+$/)) return structuredClone(this.mustTask(parts[1]));
    if (is("PUT", /^task\/[^/]+$/)) {
      const t = this.mustTask(parts[1]);
      if (body.markdown_content !== undefined) this.setDescription(t, String(body.markdown_content));
      if (body.name !== undefined) t.name = body.name;
      if (body.status !== undefined) t.status = this.statusOf(t.list.id, String(body.status));
      if (body.assignees) {
        const add: number[] = body.assignees.add ?? [];
        const rem: number[] = body.assignees.rem ?? [];
        const keep = (t.assignees as Row[]).filter(a => !rem.includes(a.id));
        for (const id of add) if (!keep.some(a => a.id === id)) keep.push({ id });
        t.assignees = keep;
      }
      this.setDue(t, body.due_date, body.due_date_time);
      this.setPriority(t, body.priority);
      return structuredClone(t);
    }
    if (is("POST", /^task\/[^/]+\/checklist$/)) {
      const t = this.mustTask(parts[1]);
      const cl = { id: this.nextId("cl"), name: String(body.name), date_created: String(this.now()), items: [] as Row[] };
      t.checklists.push(cl);
      return { checklist: structuredClone(cl) };
    }
    if (is("POST", /^checklist\/[^/]+\/checklist_item$/)) {
      const [, cl] = this.checklist(parts[1]);
      cl.items.push({ id: this.nextId("it"), name: String(body.name), resolved: false, orderindex: cl.items.length });
      return { checklist: structuredClone(cl) };
    }
    if (is("PUT", /^checklist\/[^/]+\/checklist_item\/[^/]+$/)) {
      const [, cl] = this.checklist(parts[1]);
      const item = (cl.items as Row[]).find(i => i.id === parts[3]);
      if (!item) throw rejected(404, "Checklist item not found");
      if (body.resolved !== undefined) item.resolved = body.resolved;
      return { checklist: structuredClone(cl) };
    }
    if (is("POST", /^task\/[^/]+\/tag\/.+$/)) {
      const t = this.mustTask(parts[1]);
      const name = decodeURIComponent(parts.slice(3).join("/"));
      if (!t.tags.some((g: Row) => g.name === name)) t.tags.push({ name });
      return {};
    }
    if (is("POST", /^task\/[^/]+\/field\/[^/]+$/)) {
      const t = this.mustTask(parts[1]);
      const f = (t.custom_fields as Row[]).find(x => x.id === parts[3]);
      if (!f || this.refuse.has(parts[3])) throw rejected(400, "Value is not valid for this field");
      if (this.drop.has(parts[3])) return {};
      if (f.type === "drop_down") {
        const opt = (f.type_config.options as Row[]).find(o => o.id === body.value);
        if (!opt) throw rejected(400, "Value is not a valid option");
        f.value = opt.orderindex;
      } else f.value = String(body.value);
      return {};
    }
    if (is("POST", /^task\/[^/]+\/comment$/)) {
      this.mustTask(parts[1]);
      const list = this.comments.get(parts[1]) ?? [];
      const at = Math.max(this.now(), ...list.map(x => Number(x.date) + 1));
      const cm = { id: this.nextId("90cm"), comment_text: String(body.comment_text), date: String(at), user: { id: PEOPLE.api } };
      list.push(cm);
      this.comments.set(parts[1], list);
      return { id: cm.id, hist_id: `h-${cm.id}`, date: Number(cm.date) };
    }
    if (is("GET", /^task\/[^/]+\/comment$/)) {
      this.mustTask(parts[1]);
      const newestFirst = [...(this.comments.get(parts[1]) ?? [])].sort((a, b) => Number(b.date) - Number(a.date));
      const startId = q.get("start_id");
      const from = startId ? newestFirst.findIndex(x => x.id === startId) + 1 : 0;
      return { comments: structuredClone(newestFirst.slice(from, from + 25)) };
    }
    throw rejected(404, `No fake route for ${c.method} ${base}`);
  }

  private statusOf(listId: string, name: string): Row {
    const s = (this.statuses.get(listId) ?? []).find(x => x.status === name);
    if (!s) throw rejected(400, "Status does not exist");
    return { status: s.status, type: s.type };
  }
}

// --- The fake queue (migrations 20261009f and 20261026r) -----------------------------------------

export type QueueRow = {
  id: string;
  dedupe_key: string;
  kind: string;
  source_table: string;
  source_id: string;
  payload: Row;
  state: string;
  attempts: number;
  next_attempt_at: number;
  claim_token: string | null;
  claimed_at: number | null;
  task_id: string | null;
  steps: unknown[] | null;
  progress: Row | null;
  planned: unknown[] | null;
  error: string | null;
  delivered_at: string | null;
  created_at: number;
};

const SAVE_KEYS = new Set(["state", "steps", "progress", "planned", "task_id", "error", "next_attempt_at", "delivered_at"]);
const SAVE_STATES = new Set(["sending", "retry", "unknown", "delivered", "dry_run", "skipped", "failed"]);

export class FakeDb {
  rows: QueueRow[] = [];
  rpcs: { name: string; params: Row }[] = [];
  /** The requests state row as cockpit_clickup_requests_state left it, and every call to it. */
  states: Row[] = [];
  finished: Row[] = [];
  begun: Row[] = [];
  rtOff: { key: string; note: string }[] = [];
  syncState = new Map<string, Row>();
  /** What cockpit_request_parts would hold, by "requestId:part" (the sync trigger's effect). */
  parts = new Map<string, Row>();
  cancelled = new Set<string>();
  doctorInputs: Row = { types: [], templates: [], lists: {} };
  /** Make one RPC throw (bookkeeping failure). */
  fail?: (name: string, params: Row) => Error | undefined;
  /**
   * The two RPCs the review asked migration r for (RT-1 release, RT-3 task owners). Off: the database
   * answers them as PostgREST does for a function that is not there, and the writer's fallbacks run.
   */
  withRelease = true;
  withTaskOwners = true;
  private seq = 0;

  constructor(readonly now: () => number) {}

  enqueue(kind: "request" | "task_action", payload: Row, over: Partial<QueueRow> = {}): QueueRow {
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
    const row: QueueRow = {
      id,
      dedupe_key: kind === "request" ? `request:${payload.requestId}:${payload.part}` : `task:${payload.actionId ?? id}`,
      kind,
      source_table: kind === "request" ? "cockpit_requests" : "cockpit_task_mirror",
      source_id: String(kind === "request" ? payload.requestId : payload.taskId),
      payload: structuredClone(payload),
      state: "queued",
      attempts: 0,
      next_attempt_at: this.now() - 1,
      claim_token: null,
      claimed_at: null,
      task_id: kind === "task_action" ? String(payload.taskId) : null,
      steps: null,
      progress: null,
      planned: null,
      error: null,
      delivered_at: null,
      created_at: this.now() - 1000 + this.seq,
      ...over,
    };
    this.rows.push(row);
    if (kind === "request") this.parts.set(`${payload.requestId}:${payload.part}`, { state: "queued", queueId: id });
    return row;
  }

  row(id: string) {
    const r = this.rows.find(x => x.id === id);
    if (!r) throw new Error(`no queue row ${id}`);
    return r;
  }

  byKey(key: string) {
    return this.rows.find(x => x.dedupe_key === key);
  }

  saves(id?: string) {
    return this.rpcs.filter(r => r.name === "cockpit_clickup_writeback_save" && (!id || r.params.p_id === id)).map(r => r.params.p_patch as Row);
  }

  lastState() {
    return this.states.at(-1);
  }

  rpc = async (name: string, params: Row = {}): Promise<any> => {
    this.rpcs.push({ name, params: structuredClone(params) });
    const failure = this.fail?.(name, params);
    if (failure) throw failure;
    switch (name) {
      case "cockpit_request_sweep":
        return 0;
      case "cockpit_clickup_writeback_claim_requests":
        return this.claim(String(params.p_token), Number(params.p_limit ?? 6));
      case "cockpit_clickup_writeback_save":
        return this.save(String(params.p_id), String(params.p_token), params.p_patch);
      case "cockpit_clickup_writeback_begin":
        this.begun.push(params);
        if (!["kpi", "log", "dosdonts", "requests"].includes(String(params.p_job))) throw new Error("Supabase 400: Unsupported writeback run");
        return { id: `run-${this.begun.length}` };
      case "cockpit_clickup_writeback_finish":
        this.finished.push(params);
        return null;
      case "cockpit_clickup_requests_state":
        if (!["dry_run", "apply", "apply_limited"].includes(String(params.p_mode))) throw new Error("Supabase 400: Unsupported requests mode");
        this.states.push(params);
        return null;
      case "cockpit_request_doctor_inputs":
        return structuredClone(this.doctorInputs);
      case "cockpit_request_type_rt_off":
        this.rtOff.push({ key: String(params.p_key), note: String(params.p_note) });
        return null;
      case "cockpit_clickup_writeback_idle":
        return null;
      case "cockpit_clickup_writeback_release":
        if (!this.withRelease) throw new Error("Supabase 404: Could not find the function public.cockpit_clickup_writeback_release");
        return this.release(params);
      case "cockpit_clickup_writeback_task_owners":
        if (!this.withTaskOwners) throw new Error("Supabase 404: Could not find the function public.cockpit_clickup_writeback_task_owners");
        return this.rows
          .filter(q => q.kind === "request" && q.task_id && (params.p_task_ids as string[]).includes(q.task_id))
          .map(q => ({ taskId: q.task_id, queueId: q.id }));
      default:
        throw new Error(`Supabase 404: no fake RPC ${name}`);
    }
  };

  private claim(token: string, limit: number) {
    const now = this.now();
    const open = new Set(["queued", "sending", "retry", "unknown"]);
    const due = this.rows
      .filter(q => ["request", "task_action"].includes(q.kind))
      .filter(q => (["queued", "retry", "unknown"].includes(q.state) && q.next_attempt_at <= now) || (q.state === "sending" && (q.claimed_at ?? now) < now - 600_000))
      // One lane per task: an older open row on the same task goes first.
      .filter(q => !q.task_id || !this.rows.some(o => o.id !== q.id && o.task_id === q.task_id && open.has(o.state) && o.created_at < q.created_at))
      .sort((a, b) => a.created_at - b.created_at)
      .slice(0, Math.max(1, Math.min(limit, 10)));
    return due.map(q => {
      Object.assign(q, { state: "sending", claim_token: token, claimed_at: now, attempts: q.attempts + 1 });
      const sourceExists = q.kind === "request" ? !this.cancelled.has(String(q.source_id)) : true;
      return { ...structuredClone(q), created_at: new Date(q.created_at).toISOString(), next_attempt_at: new Date(q.next_attempt_at).toISOString(), source_exists: sourceExists };
    });
  }

  /** The release the writer asks for: back to the queue as it was, the claim's attempt taken off. */
  private release(params: Row) {
    const q = this.rows.find(x => x.id === params.p_id);
    if (!q || q.state !== "sending" || q.claim_token !== params.p_token) throw new Error("Supabase 400: This queue item is no longer claimed by this run");
    const before = { state: q.state, task_id: q.task_id, progress: q.progress };
    const progressed = Boolean(q.progress && (q.progress.task || Object.keys((q.progress.steps as Row | undefined) ?? {}).length));
    Object.assign(q, {
      state: progressed ? "retry" : "queued",
      attempts: Math.max(0, q.attempts - 1),
      claim_token: null,
      claimed_at: null,
      planned: Array.isArray(params.p_planned) ? structuredClone(params.p_planned) : q.planned,
      error: params.p_note === null || params.p_note === undefined ? q.error : String(params.p_note).slice(0, 500),
      next_attempt_at: params.p_next_attempt_at ? Date.parse(String(params.p_next_attempt_at)) : this.now(),
    });
    this.sync(q, before);
    return { id: q.id, state: q.state };
  }

  private save(id: string, token: string, patch: Row) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Supabase 400: A queue change is required");
    const q = this.rows.find(x => x.id === id);
    if (!q || q.state !== "sending" || q.claim_token !== token) throw new Error("Supabase 400: This queue item is no longer claimed by this run");
    for (const k of Object.keys(patch)) if (!SAVE_KEYS.has(k)) throw new Error("Supabase 400: Unsupported queue change");
    const next = String(patch.state ?? "sending");
    if (!SAVE_STATES.has(next)) throw new Error("Supabase 400: Unsupported queue state");
    if ("steps" in patch && q.steps !== null && JSON.stringify(q.steps) !== JSON.stringify(patch.steps)) throw new Error("Supabase 400: Planned steps are frozen");
    const before = { state: q.state, task_id: q.task_id, progress: q.progress };
    q.state = next;
    if (next !== "sending") {
      q.claim_token = null;
      q.claimed_at = null;
    }
    if (Array.isArray(patch.steps)) q.steps = structuredClone(patch.steps);
    if (patch.progress && typeof patch.progress === "object") q.progress = structuredClone(patch.progress);
    if (Array.isArray(patch.planned)) q.planned = structuredClone(patch.planned);
    if ("task_id" in patch) q.task_id = patch.task_id === null ? null : String(patch.task_id);
    if ("error" in patch) q.error = patch.error === null ? null : String(patch.error).slice(0, 500);
    if (patch.next_attempt_at) q.next_attempt_at = Date.parse(String(patch.next_attempt_at));
    if (patch.delivered_at) q.delivered_at = String(patch.delivered_at);
    this.sync(q, before);
    return { id: q.id, state: q.state };
  }

  /** The two effects of migration 20261026r's cockpit_request_queue_sync the writer relies on. */
  private sync(q: QueueRow, before: { state: string; task_id: string | null; progress: Row | null }) {
    const p = q.payload;
    const key = `${p.requestId}:${p.part}`;
    if (q.kind === "request") {
      const part = this.parts.get(key) ?? {};
      Object.assign(part, {
        state: q.state,
        error: q.error,
        clickupTaskId: q.task_id ?? part.clickupTaskId ?? null,
        clickupUrl: (q.progress?.task as Row | undefined)?.url ?? part.clickupUrl ?? null,
      });
      this.parts.set(key, part);
      if (q.state === "delivered" && before.state !== "delivered" && part.clickupTaskId)
        if (!this.byKey(`verify:${key}`))
          this.enqueue(
            "task_action",
            {
              op: "verify",
              requestId: p.requestId,
              part: p.part,
              taskId: part.clickupTaskId,
              listId: p.listId,
              taskName: p.taskName,
              ownerClickupId: p.ownerClickupId ?? null,
              typeKey: p.typeKey,
              setRequestType: p.setRequestType === true,
              clientTaskId: p.clientTaskId ?? null,
            },
            { dedupe_key: `verify:${key}`, source_table: "cockpit_requests", source_id: String(p.requestId), next_attempt_at: this.now() + 120_000 },
          );
    } else if (p.op === "verify" && ["delivered", "failed", "skipped"].includes(q.state)) {
      const part = this.parts.get(key) ?? {};
      const v = q.progress?.verify;
      if (["kept", "restored", "removed", "moved"].includes(String(v))) part.verifyState = v;
      part.verifyNote = (q.progress?.verifyNote as string | undefined) ?? q.error ?? null;
      this.parts.set(key, part);
    }
  }
}

// --- One harness for the job ------------------------------------------------------------------

export function harness(env: Record<string, string | undefined> = {}) {
  const clock = { t: NOW };
  const now = () => clock.t;
  const clickup = new FakeClickUp(now);
  const db = new FakeDb(now);
  let n = 0;
  const deps: Deps = {
    env: k => env[k],
    rpc: db.rpc,
    providerFor: id => clickup.provider(id),
    now,
    uuid: () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    syncState: async (key, row) => {
      db.syncState.set(key, structuredClone(row));
    },
  };
  return {
    clock,
    clickup,
    db,
    deps,
    run: (limit?: number) => runRequests(deps, limit),
    /** Move the clock on (the retry ladder and the two-minute check wait on it). */
    advance(ms: number) {
      clock.t += ms;
    },
  };
}

export const LIVE = { CLICKUP_API_TOKEN: "pk_test_never_printed", CLICKUP_WRITEBACK_APPLY_REQUESTS: "true" } as const;
