import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * The queue of calls and forms that matched no client (src/components/
 * ClientCalls.tsx, UnmatchedQueue; docs/forms/STAGE2-CONTRACT.md 8.3 and
 * 2.2): "Not a 1-1 call" shows on an impromptu recording (a candidate) and
 * nowhere else; each of its four reasons calls cockpit_csm_candidate_settle
 * and the item leaves the queue; a refusal shows the server's sentence and
 * keeps the item; "This is {client}" still calls cockpit_csm_manual_match.
 * The RPCs are answered here.
 *
 * Run: bun test scripts/client-calls.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01",
  width: 1440,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLDetailsElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "ResizeObserver",
  "DOMRect",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const before = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const toasts: { kind: string; text: string }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push({ kind: "info", text: m }), {
    success: (m: string) => toasts.push({ kind: "success", text: m }),
    error: (m: string) => toasts.push({ kind: "error", text: m }),
    info: (m: string) => toasts.push({ kind: "info", text: m }),
    warning: (m: string) => toasts.push({ kind: "warning", text: m }),
  }),
  Toaster: () => null,
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { UnmatchedQueue, NOT_A_CHECKIN } = await import(
  "../src/components/ClientCalls"
);

const CLIENT = "Cedar & Stone Interiors";
const TASK = "86exfix01";

const QUEUE = [
  {
    id: 701,
    kind: "call",
    title: "Impromptu Google Meet Meeting",
    at: "2026-10-24T13:00:00Z",
    reason: "No booking, invitee or name matched",
    host: "csm@example.test",
    candidate: true,
  },
  {
    id: 702,
    kind: "call",
    title: "Booked check-in",
    at: "2026-10-23T07:30:00Z",
    reason: "No client matched the booking",
    candidate: false,
  },
  {
    id: 703,
    kind: "form",
    title: "1-1 call notes form",
    at: "2026-10-22T10:00:00Z",
    reason: "The Client ID matched no card",
  },
];

let refuse: string | null = null;
const rpcs: { name: string; args: any }[] = [];
const client = {
  rpc: async (name: string, args: any) => {
    rpcs.push({ name, args });
    if (name === "cockpit_csm_unmatched_list")
      return { data: QUEUE, error: null };
    if (name === "cockpit_csm_candidate_settle") {
      if (refuse) return { data: null, error: { message: refuse } };
      return {
        data: { ok: true, callId: 9001, reason: args.p_reason },
        error: null,
      };
    }
    if (name === "cockpit_csm_manual_match")
      return { data: { ok: true, clientName: CLIENT }, error: null };
    throw Error(`Unexpected RPC ${name}`);
  },
} as any;

const roots: ReturnType<typeof createRoot>[] = [];
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};
const page = () =>
  (win.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
const buttons = () =>
  Array.from(win.document.body.querySelectorAll("button")) as any[];
const named = (name: string) =>
  buttons().filter(b => (b.textContent ?? "").trim() === name);
const menuItem = (name: string) =>
  (
    Array.from(win.document.body.querySelectorAll('[role="menuitem"]')) as any[]
  ).find(i => (i.textContent ?? "").trim() === name);

let matched = 0;
async function mount() {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <UnmatchedQueue
        client={client}
        taskId={TASK}
        clientName={CLIENT}
        onMatched={() => {
          matched += 1;
        }}
      />,
    ),
  );
  await settle();
  return host;
}

async function openNotACheckin() {
  const trigger = named("Not a 1-1 call")[0];
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger.dispatchEvent(
      new win.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
  await settle();
}

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  rpcs.length = 0;
  toasts.length = 0;
  refuse = null;
  matched = 0;
});
afterAll(async () => {
  await win.happyDOM.close();
  for (const [k, d] of before) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

describe("Not a 1-1 call", () => {
  test("only an impromptu recording (a candidate) offers it; every item keeps This is {client}", async () => {
    await mount();
    expect(page()).toContain("3 calls and forms matched no client");
    expect(named("Not a 1-1 call").length).toBe(1);
    expect(named(`This is ${CLIENT}`).length).toBe(3);
  });

  test("the four reasons, in order", () => {
    expect(NOT_A_CHECKIN).toEqual([
      { reason: "part_of_call", label: "Part of another call" },
      { reason: "onboarding", label: "An onboarding call" },
      { reason: "blueprint", label: "A Blueprint call" },
      { reason: "not_client", label: "Not a client" },
    ]);
  });

  for (const { reason, label } of [
    { reason: "part_of_call", label: "Part of another call" },
    { reason: "onboarding", label: "An onboarding call" },
    { reason: "blueprint", label: "A Blueprint call" },
    { reason: "not_client", label: "Not a client" },
  ])
    test(`"${label}" sets the recording aside and it leaves the queue`, async () => {
      await mount();
      await openNotACheckin();
      await act(async () => menuItem(label)?.click());
      await settle();
      const settle_ = rpcs.find(r => r.name === "cockpit_csm_candidate_settle");
      expect(settle_?.args).toEqual({
        p_unmatched_id: 701,
        p_reason: reason,
        p_same_as: null,
      });
      expect(toasts).toContainEqual({
        kind: "success",
        text: "Set aside: not a 1-1 call.",
      });
      expect(page()).not.toContain("Impromptu Google Meet Meeting");
      expect(named(`This is ${CLIENT}`).length).toBe(2);
      // Setting aside puts nothing on this client.
      expect(matched).toBe(0);
    });

  test("a refusal shows the server's sentence and keeps the item", async () => {
    refuse =
      "Only an impromptu recording with no client can be set aside here.";
    await mount();
    await openNotACheckin();
    await act(async () => menuItem("Not a client")?.click());
    await settle();
    expect(toasts).toContainEqual({ kind: "error", text: refuse });
    expect(page()).toContain("Impromptu Google Meet Meeting");
  });

  test("This is {client} still matches through cockpit_csm_manual_match", async () => {
    await mount();
    await act(async () => named(`This is ${CLIENT}`)[0]?.click());
    await settle();
    expect(rpcs.find(r => r.name === "cockpit_csm_manual_match")?.args).toEqual(
      { p_unmatched_id: 701, p_task_id: TASK },
    );
    expect(toasts).toContainEqual({
      kind: "success",
      text: `Saved on ${CLIENT}`,
    });
    expect(matched).toBe(1);
    expect(named("Not a 1-1 call").length).toBe(0);
  });
});

describe("focus when a row leaves", () => {
  test("setting a recording aside hands focus to the next row's first button", async () => {
    await mount();
    await openNotACheckin();
    await act(async () => menuItem("Not a client")?.click());
    await settle();
    expect(page()).not.toContain("Impromptu Google Meet Meeting");
    // Not the page: the row that took the first one's place.
    const active = win.document.activeElement as any;
    expect(active?.tagName).toBe("BUTTON");
    expect((active?.textContent ?? "").trim()).toBe(`This is ${CLIENT}`);
    expect(active?.closest("li")?.textContent).toContain("Booked check-in");
  });

  test("This is {client} hands focus on the same way; the last row leaves a line that takes it", async () => {
    await mount();
    for (let left = 3; left > 0; left--) {
      const first = named(`This is ${CLIENT}`)[0];
      await act(async () => first.focus());
      await act(async () => first.click());
      await settle();
      const active = win.document.activeElement as any;
      if (left > 1)
        expect((active?.textContent ?? "").trim()).toBe(`This is ${CLIENT}`);
      else {
        expect(page()).toContain("No calls or forms left to place.");
        expect((active?.textContent ?? "").trim()).toBe(
          "No calls or forms left to place.",
        );
      }
    }
    expect(matched).toBe(3);
  });

  test("while a row's call runs its buttons stay focusable and do nothing more", async () => {
    let release: () => void = () => {};
    let asked = 0;
    const slow = client.rpc;
    client.rpc = async (name: string, args: any) => {
      if (name === "cockpit_csm_manual_match") {
        asked += 1;
        await new Promise<void>(r => (release = r));
      }
      return slow(name, args);
    };
    try {
      await mount();
      const first = named(`This is ${CLIENT}`)[0];
      await act(async () => first.focus());
      await act(async () => first.click());
      await settle();
      expect(first.getAttribute("aria-disabled")).toBe("true");
      expect(first.disabled).toBe(false);
      expect(win.document.activeElement).toBe(first);
      await act(async () => first.click());
      await settle();
      expect(asked).toBe(1);
      await act(async () => release());
      await settle();
      expect(matched).toBe(1);
    } finally {
      client.rpc = slow;
    }
  });
});
