/**
 * Your tasks, the alerts bell and the focus view, rendered in happy-dom
 * (CONTRACT.md 6.5, 9): at most five rows; the not linked, not read, stale
 * and empty sentences; "See all" opening the list in place; ?focus= opening
 * the view and Escape closing it; a tick going "Saving…" then "Saved"; the
 * bell's unread count, Mark all read and the extra list. The seat is a fake
 * (taskSeat.ts is mocked); the database answers from the harness's invented
 * fixtures (src/dev/tasksHarness.ts). Nothing here reaches a network.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";

// These screens run on real timers (the form's 250 ms debounce, the 3 s and
// 5 s re-reads), in one process with the database suites as ship.sh runs
// them, on a laptop several sessions share. A test that waits longer than
// bun's 5 s default under that load is slow, not wrong: it may take 20 s.
setDefaultTimeout(20_000);

import { Window } from "happy-dom";
import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import type { TasksScenario } from "../src/dev/tasksHarness";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type Call = { name: string; args: Record<string, unknown> };

const win = new Window({ url: "https://cockpit.test/dashboard" });
const globals = globalThis as Record<string, unknown>;
const domKeys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const old = new Map(domKeys.map(k => [k, globals[k]]));
// react-dom reads the DOM once, when it first loads, and the files that run
// after this one in the same process (scripts/ship.sh) share that copy: load
// it with the DOM in place, or their typed input never reaches React.
for (const k of domKeys)
  globals[k] = (win as unknown as Record<string, unknown>)[k];
const { createRoot } = await import("react-dom/client");
const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
const originalFetch = globalThis.fetch;

/** The fake seat every shared component reads through useTaskSeat(). */
const seat = {
  client: null as unknown,
  ready: true,
  signedIn: true,
  seatId: "seat-a" as string | null,
  cockpit: "portal" as const,
  portalHref: (path: string) => path,
  inPortal: true,
  toast: { success: () => {}, error: () => {} },
};
// bun keeps a module mock for the whole run, so once this file is done the
// mock hands back to the real seat: the request screens' tests that run in
// the same process (scripts/ship.sh runs them together) read their own.
const realUseTaskSeat = (await import("@/lib/taskSeat")).useTaskSeat;
let mockSeat = true;
mock.module("@/lib/taskSeat", () => ({
  useTaskSeat: () => (mockSeat ? seat : realUseTaskSeat()),
}));

const harness = await import("../src/dev/tasksHarness");
const { YourTasks } = await import("../src/components/tasks/YourTasks");
const { AlertsBell } = await import("../src/components/tasks/AlertsBell");
const { TaskFocusHost } = await import("../src/components/tasks/TaskFocus");

let calls: Call[] = [];

/**
 * A new client per test, so each test gets its own feed store (the store is
 * kept per client and cockpit). It answers the task RPCs and the detail read
 * from the harness fixtures; anything else fails the test.
 */
function fakeClient(
  scenario: TasksScenario,
  options: {
    settleOnFirstPoll?: boolean;
    /** Subtasks the focus view's detail read carries. */
    subtasks?: { id: string; name: string; status: string; statusType: string }[];
    /** The list the focus view's task sits on (the harness applies the done rule). */
    detailList?: string;
    /** How the writer settles a press: delivered (default) or skipped. */
    settle?: "delivered" | "skipped";
  } = {},
) {
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args });
    if (
      scenario === "error" &&
      (name === "cockpit_my_tasks" || name === "cockpit_task_alerts")
    )
      return {
        data: null,
        error: { message: "canceling statement due to statement timeout" },
      } as Answer;
    if (name === "cockpit_my_tasks")
      return { data: harness.myTasksFixture(scenario), error: null } as Answer;
    if (name === "cockpit_task_alerts")
      return { data: harness.alertsFixture(scenario), error: null } as Answer;
    if (name === "cockpit_task_alerts_seen")
      return {
        data: { ok: true, marked: (args.p_ids as string[]).length },
        error: null,
      } as Answer;
    if (name === "cockpit_task_alert_rules_read")
      return {
        data: {
          canEditOthers:
            scenario === "not_linked_editor" || scenario === "cleared",
        },
        error: null,
      } as Answer;
    if (name === "cockpit_task_act")
      return {
        data: harness.actFixture(
          String(args.p_task_id),
          String(args.p_op),
          args.p_payload as Record<string, unknown>,
          String(args.p_action_id),
          options.settle ?? "delivered",
        ),
        error: null,
      } as Answer;
    throw new Error(`Unexpected RPC call: ${name}`);
  };
  const functions = {
    invoke: async (name: string, opts: { body?: unknown } = {}) => {
      const body = opts.body as {
        op: string;
        taskId: string;
        refresh: boolean;
      };
      calls.push({ name, args: body as unknown as Record<string, unknown> });
      if (name !== "cockpit-tasks" || body.op !== "detail")
        throw new Error(`Unexpected function: ${name}`);
      if (body.refresh && options.settleOnFirstPoll) {
        harness.stepTasksHarness(body.taskId);
        harness.stepTasksHarness(body.taskId);
      }
      const found = harness.detailFixture(body.taskId, {
        listId: options.detailList,
      });
      const detail =
        found && options.subtasks && found.detail
          ? {
              ...found,
              detail: { ...found.detail, subtasks: options.subtasks },
            }
          : found;
      // A refusal comes back as supabase-js gives it: a non-2xx error whose
      // context is the response, with the database's sentence in the body.
      return detail
        ? { data: detail, error: null }
        : {
            data: null,
            error: {
              message: "Edge Function returned a non-2xx status code",
              context: new Response(
                JSON.stringify({
                  error:
                    "This task is not assigned to you. Open it in ClickUp.",
                }),
                { status: 403 },
              ),
            },
          };
    },
  };
  return { rpc, functions };
}

let root: Root | undefined;
let where = "";

function Probe() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

async function render(node: ReactNode, url = "/dashboard") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(Probe),
        node,
      ),
    );
  });
  await settle();
  return host;
}

/** Lets the reads answer and React draw them. */
async function settle(ms = 0) {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, ms));
    });
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const dialog = () => document.querySelector('[role="dialog"]');

async function press(el: Element | null | undefined) {
  if (!el) throw new Error("Nothing to press");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function button(words: string | RegExp, within: ParentNode = document) {
  return [...within.querySelectorAll("button, a")].find(b =>
    typeof words === "string"
      ? (b.textContent ?? "").replace(/\s+/g, " ").trim() === words ||
        b.getAttribute("aria-label") === words
      : words.test(
          `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`,
        ),
  );
}

beforeAll(() => {
  for (const k of domKeys)
    globals[k] = (win as unknown as Record<string, unknown>)[k];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (() => {
    throw new Error("This UI test cannot call a provider.");
  }) as typeof fetch;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  calls = [];
  where = "";
  seat.seatId = "seat-a";
  harness.resetTasksHarness();
});
afterAll(() => {
  mockSeat = false;
  for (const k of domKeys) globals[k] = old.get(k);
  globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
  globalThis.fetch = originalFetch;
  win.happyDOM.abort();
});

test("Your tasks shows five rows at most, late first, and See all opens the rest in place", async () => {
  seat.client = fakeClient("default");
  const host = await render(createElement(YourTasks, { id: "tasks" }));
  const rows = host.querySelectorAll(".tk-row");
  expect(rows).toHaveLength(5);
  expect(host.querySelector("#tasks")).not.toBeNull();
  // The count beside the title, and the first row is the oldest late task.
  expect(host.querySelector(".tk-count")?.textContent).toBe("8");
  expect(rows[0].textContent).toContain("Client pause (Tech)");
  expect(rows[0].textContent).toContain("3 days late");
  expect(rows[0].querySelector(".tk-spine-late")).not.toBeNull();
  expect(host.querySelectorAll(".tk-spine-today").length).toBeGreaterThan(0);
  // One read of each feed, not one per component.
  expect(calls.filter(c => c.name === "cockpit_my_tasks")).toHaveLength(1);
  expect(calls[0].args).toEqual({ p_cockpit: "portal" });

  await press(button("See all 8"));
  await settle();
  const panel = dialog();
  expect(panel).not.toBeNull();
  expect(panel?.getAttribute("aria-modal")).toBe("true");
  expect(panel?.querySelectorAll(".tk-row")).toHaveLength(8);
  // In place: the address did not change.
  expect(where).toBe("/dashboard");
  // Escape closes it.
  await act(async () => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(dialog()).toBeNull();
});

test("five tasks or fewer: no See all", async () => {
  seat.client = fakeClient("few");
  const host = await render(createElement(YourTasks));
  expect(host.querySelectorAll(".tk-row")).toHaveLength(3);
  expect(button(/See all/)).toBeUndefined();
});

test("a seat with no ClickUp link is told so, never shown zero", async () => {
  seat.client = fakeClient("not_linked");
  const host = await render(createElement(YourTasks));
  expect(text()).toContain(
    "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.",
  );
  expect(host.querySelectorAll(".tk-row")).toHaveLength(0);
  expect(host.querySelector(".tk-count")).toBeNull();
  expect(text()).not.toContain("Link it in Requests settings");
});

test("an editor's not-linked card links to Requests settings", async () => {
  seat.client = fakeClient("not_linked_editor");
  await render(createElement(YourTasks));
  const link = button("Link it in Requests settings");
  expect(link?.getAttribute("href")).toBe("/requests/settings?tab=people");
});

test("a seat an editor cleared is told it has no ClickUp user and is never sent to link it, on the card or the bell (review round 3)", async () => {
  // The seat may link seats (an editor), but its own link was cleared on purpose.
  seat.client = fakeClient("cleared");
  const host = await render(
    createElement(
      "div",
      null,
      createElement(YourTasks),
      createElement(AlertsBell, { variant: "row" }),
    ),
  );
  expect(text()).toContain(
    "Your seat has no ClickUp user, so no ClickUp tasks show here. Requests you raise show under My requests.",
  );
  expect(text()).not.toContain("Ask the systems manager to link it");
  expect(host.querySelectorAll(".tk-row")).toHaveLength(0);
  await settle();
  expect(button("Link it in Requests settings")).toBeUndefined();
  expect(calls.some(c => c.name === "cockpit_task_alert_rules_read")).toBe(
    false,
  );
  await press(button(/^\s*Alerts/));
  await settle();
  expect(text()).toContain(
    "Your seat has no ClickUp user, so only request alerts show here.",
  );
  expect(text()).not.toContain("Ask the systems manager to link it");
});

test("a failed read says so and offers Try again", async () => {
  seat.client = fakeClient("error");
  await render(createElement(YourTasks));
  expect(text()).toContain(
    "Your tasks could not be read just now. They are still in ClickUp. Try again in a minute.",
  );
  expect(button("Try again")).toBeDefined();
});

test("a mirror that never read is not read, not empty", async () => {
  seat.client = fakeClient("never");
  await render(createElement(YourTasks));
  expect(text()).toContain("Your tasks could not be read just now.");
  expect(text()).not.toContain("Nothing is assigned to you");
});

test("a late mirror keeps its rows and says when it last read, in mono", async () => {
  seat.client = fakeClient("stale");
  const host = await render(createElement(YourTasks));
  expect(host.querySelectorAll(".tk-row")).toHaveLength(5);
  const late = host.querySelector(".tk-late");
  expect(late?.textContent).toMatch(
    /^Task updates are late\. Last read at \d{2}:\d{2}\. Open ClickUp for anything urgent\.$/,
  );
  expect(late?.querySelector("time.tk-mono")).not.toBeNull();
});

test("nothing assigned says what this cockpit leaves out and where new tasks will show", async () => {
  seat.client = fakeClient("empty");
  await render(createElement(YourTasks));
  expect(text()).toContain(
    "Nothing open is assigned to you outside the client cards. New ClickUp tasks show here within two minutes.",
  );
  // Never the false "nothing in ClickUp" (D3).
  expect(text()).not.toContain("Nothing is assigned to you in ClickUp");
});

test("the editor cockpit's empty card says Jobs holds the Video Pipeline", async () => {
  seat.client = fakeClient("empty");
  (seat as { cockpit: string }).cockpit = "editor";
  try {
    await render(createElement(YourTasks));
    expect(text()).toContain(
      "Nothing open is assigned to you outside Jobs and the client cards.",
    );
  } finally {
    (seat as { cockpit: string }).cockpit = "portal";
  }
});

test("a row opens the focus view with ?focus=, and Escape closes it", async () => {
  seat.client = fakeClient("default");
  const host = await render(
    createElement(
      "div",
      null,
      createElement(YourTasks),
      createElement(TaskFocusHost),
    ),
  );
  await press(host.querySelector(".tk-row"));
  await settle();
  expect(where).toBe("/dashboard?focus=86fxtk001");
  const panel = dialog();
  expect(panel?.textContent).toContain(
    "Harbor Interiors - Client pause (Tech)",
  );
  expect(panel?.textContent).toContain("Request from the CSM");
  expect(panel?.textContent).toContain("2 of 6 done");
  expect(button("Mark done", panel ?? document)).toBeDefined();
  expect(
    button(/Open in ClickUp/, panel ?? document)?.getAttribute("href"),
  ).toBe("https://app.clickup.com/t/86fxtk001");
  // The newest three comments, the rest behind one button; markers hidden.
  expect(panel?.querySelectorAll(".tk-comment")).toHaveLength(3);
  expect(button("Show the other 1", panel ?? document)).toBeDefined();
  expect(panel?.textContent).not.toContain("Cockpit ref");
  // The detail read goes through cockpit-tasks with the task id.
  expect(calls.find(c => c.name === "cockpit-tasks")?.args).toEqual({
    op: "detail",
    taskId: "86fxtk001",
    refresh: false,
  });
  await act(async () => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
  });
  await settle();
  expect(where).toBe("/dashboard");
  expect(dialog()).toBeNull();
});

test("a tick goes Saving… then Saved once ClickUp has it", async () => {
  seat.client = fakeClient("default", { settleOnFirstPoll: true });
  await render(createElement(TaskFocusHost), "/dashboard?focus=86fxtk001");
  const panel = dialog();
  const item = [...(panel?.querySelectorAll('[role="checkbox"]') ?? [])].find(
    b => (b.textContent ?? "").includes("Pause the reminder workflows"),
  );
  expect(item?.getAttribute("aria-checked")).toBe("false");
  await press(item);
  await settle();
  const sent = calls.find(c => c.name === "cockpit_task_act");
  expect(sent?.args.p_op).toBe("tick");
  expect(sent?.args.p_task_id).toBe("86fxtk001");
  expect(sent?.args.p_payload).toEqual({
    checklistId: "86fxtk001-c0",
    itemId: "86fxtk001-c0-i2",
    itemName: "Pause the reminder workflows",
    from: false,
  });
  expect(String(sent?.args.p_action_id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(dialog()?.textContent).toContain("Saving…");
  // The view reads the task again after three seconds; the read-back settles it.
  await settle(1000);
  await new Promise(r => setTimeout(r, 2600));
  await settle();
  const after = [
    ...(dialog()?.querySelectorAll('[role="checkbox"]') ?? []),
  ].find(b => (b.textContent ?? "").includes("Pause the reminder workflows"));
  expect(after?.getAttribute("aria-checked")).toBe("true");
  expect(after?.textContent).toContain("Saved");
  expect(dialog()?.textContent).toContain("3 of 6 done");
  expect(
    calls.filter(c => c.name === "cockpit-tasks" && c.args.refresh === true)
      .length,
  ).toBeGreaterThan(0);
}, 15_000);

test("a Mark done that comes back skipped says why on its own line above both buttons", async () => {
  seat.client = fakeClient("default", {
    settleOnFirstPoll: true,
    settle: "skipped",
  });
  await render(createElement(TaskFocusHost), "/dashboard?focus=86fxtk001");
  await press(button("Mark done", dialog() ?? document));
  await settle();
  expect(dialog()?.textContent).toContain("Saving…");
  // The view reads the task again after three seconds; the read-back settles it.
  await settle(1000);
  await new Promise(r => setTimeout(r, 2600));
  await settle();
  const foot = dialog()?.querySelector(".tk-foot-actions");
  const sentence = "Someone moved this task in ClickUp. Open it there.";
  // First in the footer, a line of its own: the sentence, then Mark done and
  // Open in ClickUp on one row under it. Never inside Mark done's group,
  // where it pushed Open in ClickUp to a third row.
  const first = foot?.firstElementChild;
  expect(first?.classList.contains("tk-foot-note")).toBe(true);
  expect(first?.textContent).toBe(sentence);
  expect(first?.getAttribute("role")).toBe("alert");
  expect(foot?.querySelector(".tk-foot-done")?.textContent).toBe("Mark done");
  expect(
    [...(foot?.children ?? [])].map(c =>
      c.classList.contains("tk-foot-note")
        ? "note"
        : c.classList.contains("tk-foot-done")
          ? "done"
          : (c.textContent ?? "").trim(),
    ),
  ).toEqual(["note", "done", "Open in ClickUp"]);
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(
    new URL("../src/components/tasks/tasks.css", import.meta.url),
    "utf8",
  );
  // Its own full line, ahead of the buttons, and not taken back by the
  // .tk-phase rules that come later in the sheet.
  expect(css).toMatch(
    /\.tk-foot-actions > \.tk-foot-note \{\s*flex: 1 1 100%;\s*order: -1;/,
  );
}, 15_000);

test("on Video Pipeline a task takes a tick and a comment but no Mark done, said once (review round 2)", async () => {
  seat.client = fakeClient("default", { detailList: "901816720767" });
  await render(createElement(TaskFocusHost), "/dashboard?focus=86fxtk001");
  const panel = dialog();
  expect(button("Mark done", panel ?? document)).toBeUndefined();
  const why =
    "Mark done is not offered on Video Pipeline, where done means the video is live. Move it in ClickUp.";
  expect(panel?.textContent?.split(why).length).toBe(2);
  // The steps and the comment box stay.
  expect(panel?.querySelectorAll('[role="checkbox"]').length).toBeGreaterThan(0);
  expect(button("Comment", panel ?? document)).toBeDefined();
  expect(button(/Open in ClickUp/, panel ?? document)).toBeDefined();
});

test("a task the seat may not open says why and offers only ClickUp", async () => {
  seat.client = fakeClient("default");
  await render(createElement(TaskFocusHost), "/dashboard?focus=86fxnotmine");
  const panel = dialog();
  expect(panel?.textContent).toContain(
    "This task is not assigned to you. Open it in ClickUp.",
  );
  expect(button("Mark done", panel ?? document)).toBeUndefined();
  expect(button(/Open in ClickUp/, panel ?? document)).toBeDefined();
});

test("the bell counts unread alerts, opens the list and marks all read", async () => {
  seat.client = fakeClient("default");
  await render(createElement(AlertsBell, { variant: "icon" }));
  const bell = button("Alerts, 3 unread");
  expect(bell).toBeDefined();
  await press(bell);
  await settle();
  const panel = dialog();
  expect(panel?.querySelectorAll(".tk-alert")).toHaveLength(5);
  expect(panel?.querySelectorAll(".tk-dot:not(.tk-dot-read)")).toHaveLength(3);
  // Each alert says when it came (D9), from its own time.
  const times = [...(panel?.querySelectorAll(".tk-alert time") ?? [])];
  expect(times).toHaveLength(5);
  expect(times[0]?.textContent).toBe("6 min ago");
  for (const t of times) {
    expect(t.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.textContent).toMatch(
      /^(Just now|\d+ min ago|\d+ h ago|Yesterday \d{2}:\d{2}|\w{3} \d{1,2} \w{3} \d{2}:\d{2})$/,
    );
  }
  expect(panel?.textContent).toContain(
    "Checked every 2 minutes while this cockpit is open.",
  );
  expect(
    button(/Alert settings/, panel ?? document)?.getAttribute("href"),
  ).toBe("/requests/settings?tab=alerts");
  await press(button(/Mark all read/, panel ?? document));
  await settle();
  const seen = calls.find(c => c.name === "cockpit_task_alerts_seen");
  expect(
    [...((seen?.args.p_ids as string[] | undefined) ?? [])].sort(),
  ).toEqual([
    "a1f00000-0000-4000-8000-000000000001",
    "a1f00000-0000-4000-8000-000000000002",
    "a1f00000-0000-4000-8000-000000000003",
  ]);
  expect(button("Alerts, 0 unread")).toBeDefined();
  expect(dialog()?.querySelectorAll(".tk-dot:not(.tk-dot-read)")).toHaveLength(
    0,
  );
});

test("pressing a task alert opens its task and marks only it read", async () => {
  seat.client = fakeClient("default");
  await render(
    createElement(
      "div",
      null,
      createElement(AlertsBell, { variant: "row" }),
      createElement(TaskFocusHost),
    ),
  );
  await press(button("Alerts, 3 unread"));
  await settle();
  await press(dialog()?.querySelector(".tk-alert"));
  await settle();
  expect(where).toBe("/dashboard?focus=86fxtk005");
  const seen = calls.find(c => c.name === "cockpit_task_alerts_seen");
  expect(seen?.args.p_ids).toEqual(["a1f00000-0000-4000-8000-000000000001"]);
});

test("the bell carries the portal's launch notices as its own list", async () => {
  seat.client = fakeClient("empty");
  const marked: string[] = [];
  const extra = {
    label: "Client alerts",
    ready: true,
    note: null,
    items: [
      {
        id: "n1",
        version: "v1",
        title: "Relaunch check due",
        body: "Harbor Interiors restarts tomorrow",
        href: "/clients",
        external: false,
        read: false,
      },
      {
        id: "n2",
        version: "v1",
        title: "Review the new ads",
        body: "Two ads wait for a look",
        href: "https://app.clickup.com/t/86fxnote2",
        external: true,
        read: true,
      },
    ],
    markRead: async (items: { id: string }[]) => {
      marked.push(...items.map(i => i.id));
    },
  };
  await render(createElement(AlertsBell, { variant: "row", extra }));
  await press(button("Alerts, 1 unread"));
  await settle();
  const panel = dialog();
  expect(panel?.textContent).toContain("No alerts in the last 14 days.");
  expect(panel?.textContent).toContain("Client alerts");
  expect(panel?.textContent).toContain("Relaunch check due");
  const away = [...(panel?.querySelectorAll("a.tk-alert") ?? [])].find(a =>
    (a.textContent ?? "").includes("Review the new ads"),
  );
  expect(away?.getAttribute("target")).toBe("_blank");
  await press(button(/Mark all read/, panel ?? document));
  await settle();
  expect(marked).toEqual(["n1"]);
  // No task alert was unread, so the task feed was not asked to mark any.
  expect(
    calls.find(c => c.name === "cockpit_task_alerts_seen"),
  ).toBeUndefined();
});

test("a signed-out seat sees no card, no bell and no focus view", async () => {
  seat.client = fakeClient("default");
  seat.signedIn = false;
  try {
    const host = await render(
      createElement(
        "div",
        null,
        createElement(YourTasks),
        createElement(AlertsBell, { variant: "icon" }),
        createElement(TaskFocusHost),
      ),
      "/dashboard?focus=86fxtk001",
    );
    expect(host.innerHTML).toBe("<div></div>");
    expect(dialog()).toBeNull();
    expect(calls).toHaveLength(0);
  } finally {
    seat.signedIn = true;
  }
});

// --- The shared stylesheet (D6, D7, D8) -------------------------------------
test("the shared stylesheets: teal text that reads on white, one Details chevron, a client column by the card's width", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(
    new URL("../src/components/tasks/tasks.css", import.meta.url),
    "utf8",
  );
  const rq = readFileSync(
    new URL("../src/components/tasks/requests.css", import.meta.url),
    "utf8",
  );
  for (const sheet of [css, rq]) {
    // Teal words go through --tk-ink: --primary-ink where a cockpit has
    // one, else the teal mixed with the ink in light mode (D6).
    expect(sheet).not.toContain("color: var(--primary-ink, var(--primary))");
    expect(sheet).toContain(
      "color-mix(in oklab, var(--primary) 55%, var(--foreground))",
    );
    expect(sheet).toMatch(
      /:root\.dark,\s*\.dark\s*\{\s*--tk-ink: var\(--primary-ink, var\(--primary\)\);/,
    );
  }
  // The client column shows by the list's own width, not the screen's (D8).
  expect(css).toMatch(/\.tk-list \{[^}]*container-type: inline-size;/);
  expect(css).toMatch(
    /@container \(min-width: 520px\) \{\s*\.tk-row-client \{\s*display: block;/,
  );
  expect(css).not.toMatch(
    /@media \(min-width: 640px\) \{\s*\.tk-row-client/,
  );
  // The focus view's Details draws its own chevron, in every cockpit (D7).
  expect(css).toContain(".tk-details > summary::before");
  expect(css).toContain(".tk-details[open] > summary::before");
  const focus = readFileSync(
    new URL("../src/components/tasks/TaskFocus.tsx", import.meta.url),
    "utf8",
  );
  expect(focus).toContain('<summary className="no-marker">Details</summary>');
});

test("the CEO's landing page carries Your tasks high, as every Today does (F13, round 2)", async () => {
  const { readFileSync } = await import("node:fs");
  const today = readFileSync(
    new URL("../src/pages/ceo/TodayTab.tsx", import.meta.url),
    "utf8",
  );
  expect(today).toContain(
    'import { YourTasks } from "@/components/tasks/YourTasks";',
  );
  // Once, right under the KPI row and before the funnels, so on a phone it
  // is the fourth block, not the tenth (under the team, three screens down).
  expect(today.match(/<YourTasks \/>/g)).toHaveLength(1);
  expect(today).toMatch(
    /<KpiRow[^>]*\/>\s*\{\/\*[\s\S]*?\*\/\}\s*<YourTasks \/>/,
  );
  const at = (s: string) => today.indexOf(s);
  expect(at("<YourTasks />")).toBeLessThan(at("<DeliveryFunnelCard"));
  expect(at("<YourTasks />")).toBeLessThan(at("<ClientsCard"));
  expect(at("<YourTasks />")).toBeLessThan(at("<TeamTodayCard"));
});

// --- One tab, two seats (review R2: the feed is the seat's own) -------------

/**
 * One client for the whole tab, as every cockpit keeps one: it answers for
 * whoever is signed in when the call is made, as auth.uid() does. `hold()`
 * makes the next reads wait until `release()`, so a first paint or a read
 * still on its way at a sign-out can be seen.
 */
function tabClient(scenarios: Record<string, TasksScenario>) {
  let who = Object.keys(scenarios)[0];
  let holding = false;
  let waiting: (() => void)[] = [];
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const scenario = scenarios[who];
    calls.push({ name, args: { ...args, who } });
    if (holding) await new Promise<void>(r => waiting.push(r));
    if (name === "cockpit_my_tasks")
      return { data: harness.myTasksFixture(scenario), error: null } as Answer;
    if (name === "cockpit_task_alerts")
      return { data: harness.alertsFixture(scenario), error: null } as Answer;
    if (name === "cockpit_task_alert_rules_read")
      return {
        data: { canEditOthers: scenario === "not_linked_editor" },
        error: null,
      } as Answer;
    throw new Error(`Unexpected RPC call: ${name}`);
  };
  return {
    client: { rpc, functions: { invoke: async () => ({ data: null }) } },
    as(next: string) {
      who = next;
    },
    hold(on = true) {
      holding = on;
    },
    release() {
      const go = waiting;
      waiting = [];
      for (const r of go) r();
    },
  };
}

/** A seat signs out: every card and bell unmounts, the page stays loaded. */
async function signOut() {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
}

const reads = () => calls.filter(c => c.name === "cockpit_my_tasks");
const cardAndBell = () =>
  createElement(
    "div",
    null,
    createElement(YourTasks),
    createElement(AlertsBell, { variant: "icon" }),
  );

test("the next seat on the same tab never sees the last seat's tasks or alerts", async () => {
  const tab = tabClient({ ceo: "default", agent: "empty" });
  seat.client = tab.client;
  seat.seatId = "auth-ceo";
  await render(cardAndBell());
  expect(document.querySelectorAll(".tk-row")).toHaveLength(5);
  expect(text()).toContain("Harbor Interiors - Client pause (Tech)");
  expect(button("Alerts, 3 unread")).toBeDefined();
  await signOut();
  // Ten seconds later a call centre agent signs in on the same tab.
  tab.as("agent");
  seat.seatId = "auth-agent";
  tab.hold();
  await render(cardAndBell());
  // Its first paint: nothing of the last seat's, and its own read at once.
  expect(document.querySelectorAll(".tk-row")).toHaveLength(0);
  expect(text()).not.toContain("Harbor Interiors");
  expect(text()).toContain("Reading your tasks…");
  expect(button("Alerts, 0 unread")).toBeDefined();
  expect(reads().map(c => c.args.who)).toEqual(["ceo", "agent"]);
  tab.release();
  await settle();
  expect(text()).toContain(
    "Nothing open is assigned to you outside the client cards.",
  );
  expect(text()).not.toContain("Client pause (Tech)");
  await press(button("Alerts, 0 unread"));
  await settle();
  expect(dialog()?.textContent).toContain("No alerts in the last 14 days.");
});

test("a read still out when the seat signed out never lands on the next seat", async () => {
  // A seat with no id falls back to one store per client: the generation
  // rule alone must drop the late answer and let the new read start.
  const tab = tabClient({ ceo: "default", agent: "empty" });
  seat.client = tab.client;
  seat.seatId = null;
  tab.hold();
  await render(cardAndBell());
  expect(text()).toContain("Reading your tasks…");
  await signOut();
  tab.as("agent");
  tab.hold(false);
  await render(cardAndBell());
  // The new seat's read went at once, though the old one is still out.
  expect(reads().map(c => c.args.who)).toEqual(["ceo", "agent"]);
  expect(text()).toContain(
    "Nothing open is assigned to you outside the client cards.",
  );
  // The old answer arrives late: dropped.
  tab.release();
  await settle();
  expect(document.querySelectorAll(".tk-row")).toHaveLength(0);
  expect(text()).not.toContain("Harbor Interiors");
  expect(button("Alerts, 0 unread")).toBeDefined();
});

test("the same seat signing in again reads afresh, never the copy from before", async () => {
  const tab = tabClient({ csm: "default" });
  seat.client = tab.client;
  seat.seatId = "auth-csm";
  await render(cardAndBell());
  expect(reads()).toHaveLength(1);
  await signOut();
  await render(cardAndBell());
  // Within 30 seconds, but a new mount after a sign-out reads again.
  expect(reads()).toHaveLength(2);
  expect(document.querySelectorAll(".tk-row")).toHaveLength(5);
});

test("whether a seat may link seats is asked for each seat, not kept for the tab", async () => {
  const tab = tabClient({ editor: "not_linked_editor", sales: "not_linked" });
  seat.client = tab.client;
  seat.seatId = "auth-editor";
  await render(createElement(YourTasks));
  expect(button("Link it in Requests settings")).toBeDefined();
  await signOut();
  tab.as("sales");
  seat.seatId = "auth-sales";
  await render(createElement(YourTasks));
  expect(text()).toContain("Your seat is not linked to a ClickUp user");
  expect(button("Link it in Requests settings")).toBeUndefined();
  expect(
    calls
      .filter(c => c.name === "cockpit_task_alert_rules_read")
      .map(c => c.args.who),
  ).toEqual(["editor", "sales"]);
});

// --- The bell's rows (review R2) ---------------------------------------------

test("a request alert names its client once; unread rows read heavier and say Unread", async () => {
  seat.client = fakeClient("default");
  await render(createElement(AlertsBell, { variant: "row" }));
  await press(button("Alerts, 3 unread"));
  await settle();
  const rows = [...(dialog()?.querySelectorAll(".tk-alert") ?? [])];
  const done = rows.find(r =>
    (r.textContent ?? "").includes("New script: Cedar Fit-Out"),
  );
  expect(done?.querySelector(".tk-alert-body")?.textContent).toBe(
    "Done in ClickUp.",
  );
  // Another alert: the body, then the client.
  const mention = rows.find(r =>
    (r.textContent ?? "").includes("The CSM mentioned you"),
  );
  expect(mention?.querySelector(".tk-alert-body")?.textContent).toBe(
    "The CSM mentioned you · Dune Build Co",
  );
  // Unread: a heavier title and the screen reader's word, not a dot alone.
  expect(dialog()?.querySelectorAll(".tk-alert.tk-alert-unread")).toHaveLength(
    3,
  );
  for (const r of rows.filter(x => x.classList.contains("tk-alert-unread")))
    expect(r.querySelector(".tk-sr")?.textContent).toBe("Unread");
});

test("a launch notice that is unread says so to a screen reader too", async () => {
  seat.client = fakeClient("empty");
  const extra = {
    label: "Client alerts",
    ready: true,
    note: null,
    items: [
      {
        id: "n1",
        version: "v1",
        title: "Relaunch check due",
        body: "Harbor Interiors restarts tomorrow",
        href: "/clients",
        external: false,
        read: false,
      },
    ],
    markRead: async () => {},
  };
  await render(createElement(AlertsBell, { variant: "row", extra }));
  await press(button("Alerts, 1 unread"));
  await settle();
  const notice = dialog()?.querySelector("a.tk-alert");
  expect(notice?.classList.contains("tk-alert-unread")).toBe(true);
  expect(notice?.querySelector(".tk-sr")?.textContent).toBe("Unread");
});

test("the focus view says a status in sentence case, as the request panel does", async () => {
  seat.client = fakeClient("default", {
    subtasks: [
      {
        id: "86fxsub01",
        name: "Brief the editor",
        status: "review required",
        statusType: "custom",
      },
    ],
  });
  await render(createElement(TaskFocusHost), "/dashboard?focus=86fxtk001");
  const panel = dialog();
  expect(panel?.querySelector(".tk-chip")?.textContent).toBe("In progress");
  expect(panel?.querySelector(".tk-list-inset .tk-row-due")?.textContent).toBe(
    "Review required",
  );
});

test("the unread dot reads on white, and the sales menu bar's bell matches its controls", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(
    new URL("../src/components/tasks/tasks.css", import.meta.url),
    "utf8",
  );
  // The teal ink (about 5:1 on white), never the brand teal (1.95:1).
  expect(css).toMatch(/\.tk-dot \{[^}]*background: var\(--tk-ink\);/);
  expect(css).not.toMatch(/\.tk-dot \{[^}]*background: var\(--primary\);/);
  expect(css).toMatch(
    /\.tk-alert-unread \.tk-alert-title \{\s*font-weight: 600;/,
  );
  // A 28px bell with a 16px icon inside .tk-bell-compact, the bar's size.
  expect(css).toMatch(
    /\.tk-bell-compact \.tk-bell-icon \{\s*width: 28px;\s*height: 28px;/,
  );
  expect(css).toMatch(
    /\.tk-bell-compact \.tk-bell-icon svg \{\s*width: 16px;\s*height: 16px;/,
  );
  const bar = readFileSync(
    new URL(
      "../../sales-cockpit/src/components/MacOSMenuBar.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  expect(bar).toMatch(
    /<span className="tk-bell-compact">\s*<AlertsBell variant="icon" \/>\s*<\/span>/,
  );
});
