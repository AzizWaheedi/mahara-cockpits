/**
 * The CEO's "Connections for 1-1 notes" card (src/pages/ceo/
 * FormsConnections.tsx; docs/forms/STAGE2-CONTRACT.md 8.7): every key's
 * state in its own words, the webhook as status only, a failed read with
 * the way to read again, and a pasted key checked by the server, with
 * "Checking…" and then the server's text. The paste box never echoes the
 * key: it is in no attribute, no text and no state the page keeps, and the
 * box is empty again after the answer. Supabase is a stand-in passed to the
 * card; nothing leaves the test. Every key here is made up.
 */
import {
  afterAll,
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";

setDefaultTimeout(30_000);

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks, and every global is put back.
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=client-success" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "sessionStorage",
  "localStorage",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "InputEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
const globalsBefore = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : k === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
            ? (win as any)[k].bind(win)
            : (win as any)[k],
  });

// The card fades in with framer-motion, whose animations happy-dom cancels
// between tests; skip them here, and put the setting back after.
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { FormsConnections } = await import("../src/pages/ceo/FormsConnections");

/** An invented key: the test fails if any of it shows on the page. */
const KEY = "sk-ant-invented0000aaaa1111bbbb2222cccc9z9z";

type Row = Record<string, unknown>;
const key = (provider: string, label: string, over: Row = {}): Row => ({
  provider,
  label,
  connected: false,
  state: "missing",
  last4: null,
  savedAt: null,
  savedBy: null,
  checkedAt: null,
  sentence: "Not connected.",
  ...over,
});

/** 27 Oct 2026, 14:20 in Kuwait. */
const NOW = "2026-10-27T11:20:00Z";

function status(over: Row = {}, keys: Row[] | null = null) {
  return {
    keys: keys ?? [
      key("fathom", "Fathom", {
        connected: true,
        state: "connected",
        last4: "7f3a",
        savedAt: "2026-10-27T08:00:00Z",
        savedBy: "the server",
        checkedAt: "2026-10-27T08:00:05Z",
        sentence: "Connected.",
      }),
      key("fathom_webhook", "Fathom webhook", {
        connected: true,
        state: "connected",
        last4: "c0de",
        sentence: "Connected.",
      }),
      key("deepseek", "DeepSeek", {
        state: "unchecked",
        last4: "d33p",
        savedAt: "2026-10-26T09:00:00Z",
        savedBy: "the CEO",
        sentence: "Saved, not checked yet.",
      }),
      key("anthropic", "Anthropic", {
        sentence:
          "Not connected: DEFCON and priority suggestions, the call grade and the recap drafts are off.",
      }),
    ],
    webhook: {
      registered: true,
      triggeredFor: ["shared_team_recordings"],
      lastDeliveryAt: "2026-10-27T11:03:00Z",
      stored24h: 4,
      ignored24h: 1,
      failed24h: 0,
    },
    pull: { lastRunAt: NOW, ok: true, note: null },
    now: NOW,
    ...over,
  };
}

let answer: () => { data: unknown; error: unknown } = () => ({
  data: status(),
  error: null,
});
let saveAnswer: (body: any) => Promise<{ data: unknown; error: unknown }> =
  async () => ({
    data: {
      ok: true,
      state: "connected",
      text: "Connected.",
      last4: "9z9z",
    },
    error: null,
  });
const reads: number[] = [];
const saves: any[] = [];

const client: any = {
  auth: {
    getUser: async () => ({ data: { user: { id: "ceo-seat" } }, error: null }),
    getSession: async () => ({
      data: { session: { user: { id: "ceo-seat" } } },
      error: null,
    }),
  },
  rpc: async (name: string) => {
    if (name !== "cockpit_forms_keys_status")
      throw new Error(`Unexpected RPC ${name}`);
    reads.push(Date.now());
    return answer();
  },
  functions: {
    invoke: async (_fn: string, { body }: { body: any }) => {
      saves.push(body);
      return saveAnswer(body);
    },
  },
};

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();
const buttons = () => Array.from(host.querySelectorAll("button")) as any[];
const button = (name: string) =>
  buttons().find(b => (b.textContent ?? "").trim() === name);
const rowOf = (label: string) =>
  (Array.from(host.querySelectorAll(".divide-y > div")) as any[]).find(d =>
    (d.textContent ?? "").startsWith(label),
  );

async function mount() {
  await act(async () => {
    root.render(createElement(FormsConnections, { client, order: 1 }));
  });
  await flush();
}

afterEach(async () => {
  await act(async () => root.render(createElement("div")));
  answer = () => ({ data: status(), error: null });
  saveAnswer = async () => ({
    data: { ok: true, state: "connected", text: "Connected.", last4: "9z9z" },
    error: null,
  });
  reads.length = 0;
  saves.length = 0;
});
afterAll(async () => {
  await act(async () => root.unmount());
  MotionGlobalConfig.skipAnimations = skipBefore;
  await win.happyDOM.close();
  for (const [k, d] of globalsBefore) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

describe("each state in its own words", () => {
  test("the title, the intro, and the four rows", async () => {
    await mount();
    expect(text()).toContain("Connections for 1-1 notes");
    expect(text()).toContain(
      "The keys the 1-1 notes use: Fathom for the calls, DeepSeek and Anthropic for the drafts. A key is checked before it replaces the old one, and only its last four characters come back.",
    );
    const fathom = rowOf("Fathom")?.textContent ?? "";
    expect(fathom).toContain("Connected");
    expect(fathom).toContain(
      "Key ending ····7f3a, saved by the server on 27 Oct.",
    );
    expect(fathom).toContain("Replace key");
    expect(text()).toContain("Calls arrive by webhook. Last one 14:03.");
    const deepseek = rowOf("DeepSeek")?.textContent ?? "";
    expect(deepseek).toContain("Saved, not checked");
    expect(deepseek).toContain(
      "Drafts the client notes. Saved, not checked yet.",
    );
    expect(deepseek).toContain(
      "Key ending ····d33p, saved by the CEO on 26 Oct.",
    );
    const anthropic = rowOf("Anthropic")?.textContent ?? "";
    expect(anthropic).toContain("Not connected");
    expect(anthropic).toContain(
      "Suggests DEFCON and priority, grades the call and drafts the client's recap. Not connected: these drafts are off until a key is pasted here.",
    );
    expect(anthropic).toContain("Add key");
  });

  test("a refused key, a webhook with nothing in a day, and one not registered", async () => {
    answer = () => ({
      data: status(
        {
          webhook: {
            registered: true,
            triggeredFor: ["shared_team_recordings"],
            lastDeliveryAt: "2026-10-25T08:00:00Z",
            stored24h: 0,
            ignored24h: 0,
            failed24h: 0,
          },
        },
        [
          key("fathom", "Fathom", {
            state: "refused",
            last4: "7f3a",
            savedAt: "2026-10-27T08:00:00Z",
            savedBy: "the CEO",
            sentence: "Fathom refused this key. Paste a new one.",
          }),
          key("fathom_webhook", "Fathom webhook"),
          key("deepseek", "DeepSeek", {
            sentence: "Not connected: client notes drafts are off.",
          }),
          key("anthropic", "Anthropic"),
        ],
      ),
      error: null,
    });
    await mount();
    expect(text()).toContain("Refused");
    expect(text()).toContain("Fathom refused this key. Paste a new one.");
    expect(text()).toContain("Registered. Nothing delivered in the last day.");
    expect(text()).toContain(
      "Drafts the client notes. Not connected: client notes drafts are off.",
    );
    await act(async () => root.render(createElement("div")));
    answer = () => ({
      data: status({
        webhook: {
          registered: false,
          triggeredFor: null,
          lastDeliveryAt: null,
          stored24h: 0,
          ignored24h: 0,
          failed24h: 0,
        },
      }),
      error: null,
    });
    await mount();
    expect(text()).toContain(
      "Not registered: calls arrive by the 15-minute read and when the notes open.",
    );
    // No Fathom key either (B7 open): the notes read the store and pull
    // nothing, so the webhook row says only what the Fathom row says.
    await act(async () => root.render(createElement("div")));
    answer = () => ({
      data: status(
        {
          webhook: {
            registered: false,
            triggeredFor: null,
            lastDeliveryAt: null,
            stored24h: 0,
            ignored24h: 0,
            failed24h: 0,
          },
        },
        [
          key("fathom", "Fathom", {
            sentence: "Not connected: calls come only from the 15-minute read.",
          }),
          key("fathom_webhook", "Fathom webhook"),
          key("deepseek", "DeepSeek"),
          key("anthropic", "Anthropic"),
        ],
      ),
      error: null,
    });
    await mount();
    expect(rowOf("Fathom")?.textContent ?? "").toContain(
      "Not connected: calls come only from the 15-minute read.",
    );
    const webhook = rowOf("Fathom webhook")?.textContent ?? "";
    expect(webhook).toContain(
      "Not registered: calls arrive by the 15-minute read.",
    );
    expect(webhook).not.toContain("when the notes open");
  });

  test("a read that fails says so, and Read them again reads", async () => {
    answer = () => ({
      data: null,
      error: {
        message: "Only the CEO can see the 1-1 notes connections.",
        code: "42501",
      },
    });
    await mount();
    expect(text()).toContain(
      "The connections could not be read: Only the CEO can see the 1-1 notes connections.",
    );
    answer = () => ({ data: status(), error: null });
    await act(async () => button("Read them again")?.click());
    await flush();
    expect(reads.length).toBe(2);
    expect(text()).toContain("Key ending ····7f3a");
  });
});

describe("a pasted key", () => {
  test("is checked by the server: Checking…, then its text; the box never echoes it", async () => {
    let release: () => void = () => {};
    saveAnswer = async () => {
      await new Promise<void>(r => (release = r));
      return {
        data: {
          ok: true,
          state: "connected",
          text: "Connected.",
          last4: "9z9z",
        },
        error: null,
      };
    };
    await mount();
    const anthropic = rowOf("Anthropic");
    await act(async () =>
      (Array.from(anthropic.querySelectorAll("button")) as any[])
        .find(b => (b.textContent ?? "").trim() === "Add key")
        ?.click(),
    );
    await flush();
    const input = host.querySelector('input[type="password"]') as any;
    expect(input).toBeTruthy();
    expect(input.getAttribute("autocomplete")).toBe("off");
    await act(async () => {
      input.value = KEY;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await flush();
    // In the field's value only: no attribute, no text.
    expect(host.innerHTML).not.toContain(KEY);
    expect(host.innerHTML).not.toContain(KEY.slice(4, 20));
    await act(async () => button("Save key")?.click());
    await flush();
    expect(text()).toContain("Checking…");
    expect(saves).toEqual([
      { op: "keys.save", provider: "anthropic", key: KEY },
    ]);
    await act(async () => release());
    await flush();
    expect(text()).toContain("Connected.");
    expect(host.innerHTML).not.toContain(KEY);
    // The card read the connections again.
    expect(reads.length).toBe(2);
  });

  test("a key the provider refuses: the server's text, nothing kept in the box", async () => {
    saveAnswer = async () => ({
      data: { error: "Fathom refused this key. Nothing was changed." },
      error: null,
    });
    await mount();
    const fathom = rowOf("Fathom");
    await act(async () =>
      (Array.from(fathom.querySelectorAll("button")) as any[])
        .find(b => (b.textContent ?? "").trim() === "Replace key")
        ?.click(),
    );
    await flush();
    const input = host.querySelector('input[type="password"]') as any;
    await act(async () => {
      input.value = "invented-fathom-key-0000111122223333";
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await flush();
    await act(async () => button("Save key")?.click());
    await flush();
    expect(text()).toContain("Fathom refused this key. Nothing was changed.");
    const still = host.querySelector('input[type="password"]') as any;
    expect(still?.value ?? "").toBe("");
    expect(host.innerHTML).not.toContain("invented-fathom-key");
  });
});

describe("focus follows the paste box", () => {
  const inRow = (label: string, name: string) =>
    (Array.from(rowOf(label).querySelectorAll("button")) as any[]).find(
      b => (b.textContent ?? "").trim() === name,
    );

  test("Add key opens the box at its field; Cancel gives focus back to Add key", async () => {
    await mount();
    await act(async () => inRow("Anthropic", "Add key")?.focus());
    await act(async () => inRow("Anthropic", "Add key")?.click());
    await flush();
    const input = host.querySelector('input[type="password"]') as any;
    expect(win.document.activeElement).toBe(input);
    await act(async () => button("Cancel")?.click());
    await flush();
    expect(win.document.activeElement).toBe(inRow("Anthropic", "Add key"));
  });

  test("Save key stays focusable while it checks, then a saved key hands focus to Replace key", async () => {
    let release: () => void = () => {};
    saveAnswer = async () => {
      await new Promise<void>(r => (release = r));
      return {
        data: {
          ok: true,
          state: "connected",
          text: "Connected.",
          last4: "9z9z",
        },
        error: null,
      };
    };
    await mount();
    await act(async () => inRow("Anthropic", "Add key")?.click());
    await flush();
    const input = host.querySelector('input[type="password"]') as any;
    await act(async () => {
      input.value = KEY;
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await flush();
    const save = button("Save key");
    await act(async () => save?.focus());
    await act(async () => save?.click());
    await flush();
    const checking = buttons().find(b =>
      (b.textContent ?? "").includes("Checking…"),
    );
    expect(checking?.getAttribute("aria-disabled")).toBe("true");
    expect(checking?.disabled).toBe(false);
    expect(win.document.activeElement).toBe(checking);
    await act(async () => release());
    await flush();
    expect(text()).toContain("Connected.");
    const now = win.document.activeElement as any;
    expect(now?.tagName).toBe("BUTTON");
    expect(rowOf("Anthropic").contains(now)).toBe(true);
    expect(["Add key", "Replace key"]).toContain(
      (now?.textContent ?? "").trim(),
    );
  });

  test("a refused key keeps focus in the field for another paste", async () => {
    saveAnswer = async () => ({
      data: { error: "Fathom refused this key. Nothing was changed." },
      error: null,
    });
    await mount();
    await act(async () => inRow("Fathom", "Replace key")?.click());
    await flush();
    const input = host.querySelector('input[type="password"]') as any;
    await act(async () => {
      input.value = "invented-fathom-key-0000111122223333";
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await flush();
    await act(async () => button("Save key")?.click());
    await flush();
    expect(text()).toContain("Fathom refused this key. Nothing was changed.");
    expect(win.document.activeElement).toBe(
      host.querySelector('input[type="password"]'),
    );
  });
});
