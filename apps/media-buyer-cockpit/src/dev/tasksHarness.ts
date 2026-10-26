/**
 * Your tasks, the alerts bell and the focus view in the layout harness
 * (docs/requests/CONTRACT.md 6.5, 9): cockpit_my_tasks, cockpit_task_alerts,
 * cockpit_task_alerts_seen, cockpit_task_act and the cockpit-tasks detail
 * read answer from invented tasks, so every state can be looked at signed
 * out at 390, 820 and 1440. Open, for example:
 *
 *   /harness.html?path=/dashboard
 *   /harness.html?path=%2Fdashboard%3Ffocus%3D86fxtk001
 *   /harness.html?path=/team&tasks=not_linked
 *
 * `tasks=` picks the answer: default (eight tasks, three alerts unread),
 * few, empty, not_linked, not_linked_editor (the seat may link seats),
 * stale (the mirror last read 25 minutes ago), never (it never read),
 * error (the read fails), loading (it never answers). `act=` picks how a
 * tick, comment or Mark done settles: delivered (after two reads, the
 * default), skipped, slow (never settles). `detail=fail` makes the live
 * ClickUp read fail, so the focus view shows the cached task and its note.
 * `can=none` turns the focus view's controls off with the server's reason.
 * `delay=` sets the wait in ms (400 by default).
 *
 * Every client, task, person and id here is invented. Never imported by the
 * production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AlertRow,
  MyTasks,
  TaskActionRow,
  TaskAlerts,
  TaskComment,
  TaskDetail,
  TaskRow,
} from "@/lib/tasksCore";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

export type TasksScenario =
  | "default"
  | "few"
  | "empty"
  | "not_linked"
  | "not_linked_editor"
  | "stale"
  | "never"
  | "error"
  | "loading";

const KUWAIT_MS = 3 * 3600e3;
const DAY_MS = 86400e3;

/** The Kuwait day `n` days from now, YYYY-MM-DD. */
function dayFrom(nowMs: number, n: number): string {
  return new Date(nowMs + KUWAIT_MS + n * DAY_MS).toISOString().slice(0, 10);
}

/** 12:00 Kuwait on a day, as ClickUp keeps a date-only due (09:00 UTC). */
const noonOf = (day: string) => `${day}T09:00:00.000Z`;

const LISTS = {
  tech: { id: "901816723190", name: "Operations / Tech" },
  ads: { id: "901816723196", name: "Marketing / ADs" },
  cs: { id: "901816723211", name: "Client Success" },
  creative: { id: "901818016338", name: "Media/Creative" },
  all: { id: "901816723226", name: "All Tasks" },
};

type Seed = {
  id: string;
  title: string;
  client: string | null;
  list: keyof typeof LISTS;
  status: string;
  statusType: string;
  /** Days from today; null for no due date. */
  due: number | null;
  /** A due time on the Kuwait clock, HH:MM, when the task has one. */
  at?: string;
  priority: TaskRow["priority"];
  createdDaysAgo: number;
  checklist?: [number, number];
  request?: { id: string; label: string };
};

const SEEDS: Seed[] = [
  {
    id: "86fxtk001",
    title: "Harbor Interiors - Client pause (Tech)",
    client: "Harbor Interiors",
    list: "tech",
    status: "in progress",
    statusType: "custom",
    due: -3,
    priority: "high",
    createdDaysAgo: 6,
    checklist: [2, 6],
    request: {
      id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e01",
      label: "Client pause",
    },
  },
  {
    id: "86fxtk002",
    title: "Missing leads on the lead form",
    client: "Dune Build Co",
    list: "tech",
    status: "to do",
    statusType: "open",
    due: -1,
    priority: "high",
    createdDaysAgo: 2,
    checklist: [0, 4],
    request: {
      id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e02",
      label: "Missing leads",
    },
  },
  {
    id: "86fxtk003",
    title: "New script request: villa walkthrough, second hook",
    client: "مكتب الريان للتصميم",
    list: "creative",
    status: "to do",
    statusType: "open",
    due: 0,
    at: "15:00",
    priority: "normal",
    createdDaysAgo: 1,
    request: {
      id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e03",
      label: "New script",
    },
  },
  {
    id: "86fxtk004",
    title: "Connect the new lead form to the sub-account",
    client: "Cedar Fit-Out",
    list: "tech",
    status: "to do",
    statusType: "open",
    due: 0,
    priority: "normal",
    createdDaysAgo: 3,
    checklist: [1, 5],
  },
  {
    id: "86fxtk005",
    title:
      "General tech request: the booking calendar shows the wrong timezone for the Saturday slots",
    client: null,
    list: "tech",
    status: "to do",
    statusType: "open",
    due: 2,
    priority: "normal",
    createdDaysAgo: 0,
  },
  {
    id: "86fxtk006",
    title: "Create a landing page for the spring offer",
    client: "Harbor Interiors",
    list: "tech",
    status: "review required",
    statusType: "custom",
    due: 9,
    priority: "low",
    createdDaysAgo: 4,
  },
  {
    id: "86fxtk007",
    title: "Change the company name in the sub-account",
    client: "Northline Builders",
    list: "tech",
    status: "to do",
    statusType: "open",
    due: null,
    priority: null,
    createdDaysAgo: 5,
  },
  {
    id: "86fxtk008",
    title: "Form Submission - #14:20",
    client: null,
    list: "all",
    status: "to do",
    statusType: "open",
    due: null,
    priority: null,
    createdDaysAgo: 8,
  },
];

function rowOf(seed: Seed, nowMs: number): TaskRow {
  const today = dayFrom(nowMs, 0);
  const dueOn = seed.due === null ? null : dayFrom(nowMs, seed.due);
  const dueAt = dueOn
    ? seed.at
      ? new Date(
          Date.parse(`${dueOn}T${seed.at}:00.000Z`) - KUWAIT_MS,
        ).toISOString()
      : noonOf(dueOn)
    : null;
  const late =
    !!dueOn &&
    (dueOn < today ||
      (dueOn === today && !!seed.at && Date.parse(dueAt ?? "") < nowMs));
  return {
    taskId: seed.id,
    title: seed.title,
    clientName: seed.client,
    clientTaskId: seed.client ? `86fxcard${seed.id.slice(-2)}` : null,
    listId: LISTS[seed.list].id,
    listName: LISTS[seed.list].name,
    status: seed.status,
    statusType: seed.statusType,
    dueOn,
    dueAt,
    dueHasTime: seed.at ? true : null,
    overdue: late,
    dueToday: dueOn === today && !late,
    priority: seed.priority,
    url: `https://app.clickup.com/t/${seed.id}`,
    createdAt: new Date(nowMs - seed.createdDaysAgo * DAY_MS).toISOString(),
    parentId: null,
    checklist: seed.checklist
      ? { done: seed.checklist[0], total: seed.checklist[1] }
      : null,
    requestId: seed.request?.id ?? null,
    requestTypeLabel: seed.request?.label ?? null,
  };
}

/** The server's order: late (oldest due first), due today, then newest. */
function serverOrder(rows: TaskRow[]): TaskRow[] {
  const rank = (r: TaskRow) => (r.overdue ? 0 : r.dueToday ? 1 : 2);
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    if (rank(a) < 2)
      return Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? "");
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

const NOT_LINKED =
  "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.";

/** cockpit_my_tasks for a scenario. */
export function myTasksFixture(
  scenario: TasksScenario,
  nowMs: number = Date.now(),
): MyTasks {
  const asOf = new Date(nowMs).toISOString();
  const fresh = new Date(nowMs - 70_000).toISOString();
  const seeds =
    scenario === "few" ? SEEDS.slice(1, 4) : scenario === "empty" ? [] : SEEDS;
  const tasks = serverOrder(seeds.map(s => rowOf(s, nowMs)));
  const notLinked =
    scenario === "not_linked" || scenario === "not_linked_editor";
  const shown = notLinked ? [] : tasks;
  return {
    asOf,
    sourceAt:
      scenario === "never"
        ? null
        : scenario === "stale"
          ? new Date(nowMs - 25 * 60_000).toISOString()
          : fresh,
    ready: scenario !== "stale" && scenario !== "never",
    link: notLinked ? "not_linked" : "linked",
    note: notLinked ? NOT_LINKED : null,
    counts: {
      overdue: shown.filter(t => t.overdue).length,
      today: shown.filter(t => t.dueToday).length,
      total: shown.length,
    },
    tasks: shown,
    more: 0,
  };
}

/** cockpit_task_alerts for a scenario. */
export function alertsFixture(
  scenario: TasksScenario,
  nowMs: number = Date.now(),
): TaskAlerts {
  const minutes = (n: number) => new Date(nowMs - n * 60_000).toISOString();
  const notLinked =
    scenario === "not_linked" || scenario === "not_linked_editor";
  const all: AlertRow[] = [
    {
      id: "a1f00000-0000-4000-8000-000000000001",
      kind: "assigned",
      taskId: "86fxtk005",
      requestId: null,
      title: SEEDS[4].title,
      body: "Assigned to you",
      clientName: null,
      at: minutes(6),
      read: false,
    },
    {
      id: "a1f00000-0000-4000-8000-000000000002",
      kind: "mention",
      taskId: "86fxtk002",
      requestId: null,
      title: SEEDS[1].title,
      body: "The CSM mentioned you",
      clientName: "Dune Build Co",
      at: minutes(40),
      read: false,
    },
    {
      id: "a1f00000-0000-4000-8000-000000000003",
      kind: "due_today",
      taskId: null,
      requestId: null,
      title: "2 tasks are due today",
      body: "Open Your tasks to see them.",
      clientName: null,
      at: minutes(180),
      read: false,
    },
    {
      id: "a1f00000-0000-4000-8000-000000000004",
      kind: "request_done",
      taskId: null,
      requestId: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e09",
      title: "New script: Cedar Fit-Out",
      body: "Done in ClickUp.",
      clientName: "Cedar Fit-Out",
      at: minutes(60 * 26),
      read: true,
    },
    {
      id: "a1f00000-0000-4000-8000-000000000005",
      kind: "status",
      taskId: "86fxtk006",
      requestId: null,
      title: SEEDS[5].title,
      body: "Moved to review required",
      clientName: "Harbor Interiors",
      at: minutes(60 * 30),
      read: true,
    },
  ];
  // Request alerts reach the requester's seat linked or not (3.3).
  const alerts =
    scenario === "empty"
      ? []
      : notLinked
        ? all.filter(a => a.kind.startsWith("request_"))
        : all;
  return {
    asOf: new Date(nowMs).toISOString(),
    sourceAt:
      scenario === "never"
        ? null
        : new Date(
            nowMs - (scenario === "stale" ? 25 * 60_000 : 70_000),
          ).toISOString(),
    ready: scenario !== "stale" && scenario !== "never",
    link: notLinked ? "not_linked" : "linked",
    note: notLinked ? NOT_LINKED : null,
    unread: alerts.filter(a => !a.read).length,
    alerts,
  };
}

const CHECKLISTS: Record<
  string,
  { name: string; items: [string, boolean][] }[]
> = {
  "86fxtk001": [
    {
      name: "Client Pause ⏸️ (Tech)",
      items: [
        ["Turn off the lead form's automations in the sub-account", true],
        ["Pause the call centre's calling list for this client", true],
        ["Pause the reminder workflows", false],
        ["Note the pause date on the client card", false],
        ["Tell the CSM it is done", false],
        ["Set a check for the relaunch date", false],
      ],
    },
  ],
  "86fxtk002": [
    {
      name: "SOP steps",
      items: [
        ["Check the form's last submissions in Meta", false],
        ["Check the webhook into the sub-account", false],
        ["Send one test lead and watch it land", false],
        ["Tell the CSM what was wrong", false],
      ],
    },
  ],
  "86fxtk004": [
    {
      name: "Connecting a new lead form",
      items: [
        ["Find the new form in the ad account", true],
        ["Map its questions to the sub-account fields", false],
        ["Add it to the lead form workflow", false],
        ["Send a test lead", false],
        ["Tell the media buyer it is live", false],
      ],
    },
  ],
};

type Settle = "delivered" | "skipped" | "slow";

type LiveAction = TaskActionRow & {
  reads: number;
  settle: Settle;
  apply: () => void;
};

type Live = {
  status: string;
  statusType: string;
  resolved: Map<string, boolean>;
  comments: TaskComment[];
  actions: LiveAction[];
};

const live = new Map<string, Live>();

function liveOf(seed: Seed, nowMs: number): Live {
  let state = live.get(seed.id);
  if (!state) {
    const resolved = new Map<string, boolean>();
    for (const [ci, list] of (CHECKLISTS[seed.id] ?? []).entries())
      for (const [ii, [, on]] of list.items.entries())
        resolved.set(`${seed.id}-c${ci}-i${ii}`, on);
    state = {
      status: seed.status,
      statusType: seed.statusType,
      resolved,
      comments: [
        {
          id: `${seed.id}-m1`,
          authorLabel: "the CSM",
          mine: false,
          at: new Date(nowMs - 3 * 3600e3).toISOString(),
          text: "The client asked for this before the weekend if it can be done.",
        },
        {
          id: `${seed.id}-m2`,
          authorLabel: "the cockpit",
          mine: false,
          at: new Date(nowMs - 26 * 3600e3).toISOString(),
          text: "Cockpit · The CSM asked Operations / Tech: the request is linked on the client card.",
        },
        {
          id: `${seed.id}-m3`,
          authorLabel: "You",
          mine: true,
          at: new Date(nowMs - 28 * 3600e3).toISOString(),
          text: "Seen. I will pick it up after the morning calls.",
        },
        {
          id: `${seed.id}-m4`,
          authorLabel: "the media buyer",
          mine: false,
          at: new Date(nowMs - 50 * 3600e3).toISOString(),
          text: "Campaigns for this client are already paused on the Meta side.",
        },
      ],
      actions: [],
    };
    live.set(seed.id, state);
  }
  return state;
}

/** The focus view's answer for one invented task. */
export function detailFixture(
  taskId: string,
  options: {
    nowMs?: number;
    can?: "all" | "none";
    detailFails?: boolean;
  } = {},
): TaskDetail | null {
  const nowMs = options.nowMs ?? Date.now();
  const seed = SEEDS.find(s => s.id === taskId);
  if (!seed) return null;
  const state = liveOf(seed, nowMs);
  const row = rowOf(seed, nowMs);
  const lists = (CHECKLISTS[seed.id] ?? []).map((list, ci) => ({
    id: `${seed.id}-c${ci}`,
    name: list.name,
    items: list.items.map(([name], ii) => ({
      id: `${seed.id}-c${ci}-i${ii}`,
      name,
      resolved: state.resolved.get(`${seed.id}-c${ci}-i${ii}`) ?? false,
    })),
  }));
  const done = lists.flatMap(l => l.items).filter(i => i.resolved).length;
  const total = lists.flatMap(l => l.items).length;
  const at = new Date(nowMs - (options.detailFails ? 9 * 60_000 : 0));
  const none = options.can === "none";
  return {
    asOf: new Date(nowMs).toISOString(),
    task: {
      ...row,
      status: state.status,
      statusType: state.statusType,
      checklist: total ? { done, total } : null,
      description: null,
    },
    request: seed.request
      ? {
          id: seed.request.id,
          typeLabel: seed.request.label,
          requesterLabel: "the CSM",
          part: seed.list === "creative" ? "main" : "tech",
        }
      : null,
    sopUrl: seed.request
      ? "https://app.clickup.com/9018/docs/sop-example"
      : null,
    detail: {
      at: at.toISOString(),
      dueHasTime: seed.at ? true : false,
      description: `**${seed.request?.label ?? "Task"}** for ${seed.client ?? "no client"}\nRequested by the CSM in the cockpit. Priority ${seed.priority ?? "normal"}.\n\n- What is needed: as written in the title.\n\nCockpit ref R-4b1f6a0e2c-tech`,
      checklists: lists,
      subtasks: [],
      comments: [...state.comments],
    },
    detailNote: options.detailFails
      ? `This task could not be read from ClickUp just now. What you see was read at ${new Date(at.getTime() + KUWAIT_MS).toISOString().slice(11, 16)}.`
      : null,
    actions: state.actions.map(
      ({ reads: _r, settle: _s, apply: _a, ...a }) => a,
    ),
    can: none
      ? {
          tick: false,
          comment: false,
          done: false,
          why: "Changes from the cockpit are not switched on yet. Open the task in ClickUp.",
        }
      : { tick: true, comment: true, done: true, why: null },
    writer: none
      ? { mode: "dry_run", live: false }
      : { mode: "apply", live: true },
  };
}

/** A tick, comment or Mark done, kept in memory until the next reads. */
export function actFixture(
  taskId: string,
  op: string,
  payload: Record<string, unknown>,
  actionId: string,
  settle: Settle,
  nowMs: number = Date.now(),
): { id: string; state: string; reused: boolean } | null {
  const seed = SEEDS.find(s => s.id === taskId);
  if (!seed) return null;
  const state = liveOf(seed, nowMs);
  const id = `q-${actionId}`;
  const itemId = typeof payload.itemId === "string" ? payload.itemId : null;
  state.actions.unshift({
    id,
    op: op as TaskActionRow["op"],
    state: "queued",
    error: null,
    at: new Date(nowMs).toISOString(),
    itemId,
    reads: 0,
    settle,
    apply: () => {
      if ((op === "tick" || op === "untick") && itemId)
        state.resolved.set(itemId, op === "tick");
      if (op === "comment")
        state.comments.unshift({
          id: `${taskId}-c${state.comments.length + 1}`,
          authorLabel: "You",
          mine: true,
          at: new Date().toISOString(),
          text: `The systems manager wrote in the cockpit: ${String(payload.text ?? "")}\n\nCockpit ref T-${actionId.replace(/-/g, "").slice(0, 10)}`,
        });
      if (op === "done") {
        state.status = "complete";
        state.statusType = "done";
      }
    },
  });
  // The next reads settle it, as the queue and its read-back would.
  return { id, state: "queued", reused: false };
}

/** One read of the detail moves each queued action a step. */
function advance(taskId: string) {
  const state = live.get(taskId);
  if (!state) return;
  for (const a of state.actions) {
    if (a.state !== "queued" && a.state !== "sending") continue;
    if (a.settle === "slow") continue;
    a.reads += 1;
    if (a.reads === 1) a.state = "sending";
    else if (a.settle === "skipped") {
      a.state = "skipped";
      a.error =
        a.op === "done"
          ? "Someone moved this task in ClickUp. Open it there."
          : "ClickUp changed this step. Open the task there.";
    } else {
      a.state = "delivered";
      a.apply();
    }
  }
}

/** Moves a task's queued actions one step, as one detail read does. */
export function stepTasksHarness(taskId: string): void {
  advance(taskId);
}

/** Forgets every in-memory change (tests start clean). */
export function resetTasksHarness(): void {
  live.clear();
}

const SCENARIOS: TasksScenario[] = [
  "default",
  "few",
  "empty",
  "not_linked",
  "not_linked_editor",
  "stale",
  "never",
  "error",
  "loading",
];

export function installTasksHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("tasks") as TasksScenario | null;
  const scenario: TasksScenario =
    asked && SCENARIOS.includes(asked) ? asked : "default";
  const settle = (["delivered", "skipped", "slow"] as const).find(
    s => s === params.get("act"),
  );
  const detailFails = params.get("detail") === "fail";
  const can = params.get("can") === "none" ? "none" : "all";
  const delay = Number(params.get("delay") ?? 400);
  const wait = () => new Promise(r => setTimeout(r, delay));
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    functions: {
      invoke: (name: string, opts?: { body?: unknown }) => Promise<Answer>;
    };
  };
  const previousRpc = c.rpc.bind(c);
  // supabase-js builds a new `functions` client on every read of the
  // property, so one is kept on the client, or the patch would be lost.
  const functions = c.functions;
  if (!Object.getOwnPropertyDescriptor(client, "functions"))
    Object.defineProperty(client, "functions", {
      configurable: true,
      value: functions,
    });
  const previousInvoke = functions.invoke.bind(functions);
  const feeds = ["cockpit_my_tasks", "cockpit_task_alerts"];

  c.rpc = async (name, args = {}) => {
    if (feeds.includes(name)) {
      if (scenario === "loading") return new Promise<Answer>(() => {});
      await wait();
      if (scenario === "error")
        return {
          data: null,
          error: {
            code: "57014",
            message: "canceling statement due to statement timeout",
          },
        };
      return {
        data:
          name === "cockpit_my_tasks"
            ? myTasksFixture(scenario)
            : alertsFixture(scenario),
        error: null,
      };
    }
    if (name === "cockpit_task_alerts_seen") {
      await wait();
      const ids = Array.isArray(args.p_ids) ? args.p_ids : [];
      return { data: { ok: true, marked: ids.length }, error: null };
    }
    if (name === "cockpit_task_act") {
      await wait();
      const answer = actFixture(
        String(args.p_task_id),
        String(args.p_op),
        (args.p_payload ?? {}) as Record<string, unknown>,
        String(args.p_action_id),
        settle ?? "delivered",
      );
      return answer
        ? { data: answer, error: null }
        : {
            data: null,
            error: {
              code: "55000",
              message: "This task is not assigned to you. Open it in ClickUp.",
            },
          };
    }
    // Only the "not linked, may link" scenario answers the rules read; the
    // requests harness answers it everywhere else.
    if (
      name === "cockpit_task_alert_rules_read" &&
      scenario === "not_linked_editor"
    ) {
      await wait();
      return { data: { canEditOthers: true }, error: null };
    }
    return previousRpc(name, args);
  };

  functions.invoke = async (name, opts = {}) => {
    if (name !== "cockpit-tasks") return previousInvoke(name, opts);
    const body = (opts.body ?? {}) as { taskId?: string; refresh?: boolean };
    await wait();
    if (body.refresh) advance(String(body.taskId));
    const detail = detailFixture(String(body.taskId), { can, detailFails });
    if (!detail)
      return {
        data: null,
        error: {
          message: "This task is not assigned to you. Open it in ClickUp.",
        },
      };
    return { data: detail, error: null };
  };
}
