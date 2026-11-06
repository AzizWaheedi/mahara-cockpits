import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";

/**
 * Kickoff items as requests (CEO item 7; docs/forms/WAVE56-CONTRACT.md 4.20
 * and 5.16; kickoff-requests.md 5): every state of a row in words, the
 * aria-labels, focus after a press, one request id per item's Yes kept
 * through a retry, No recorded, "Raise it after all", "Count it", the type
 * turned off, the form-only type, a card the requests cannot reach, "Change
 * it first" opening the ticket form and counting what it sends, no "Change
 * it first" in the sheet, the Today band, and one plain line while the
 * functions are not applied. Every RPC is a stand-in (src/dev/
 * kickoffItemsFixtures.ts): nothing reaches the database or ClickUp.
 *
 * Run: bun test scripts/kickoff-items.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86eywg1cq?tab=onboarding",
  width: 1280,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLFormElement",
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
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "InputEvent",
  "ResizeObserver",
  "DOMRect",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
];
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

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { MemoryRouter } = await import("react-router");
const words = await import("../src/lib/kickoffItems");
const { KickoffItems, KickoffItemsBand } = await import(
  "../src/components/KickoffItems"
);
const fx = await import("../src/dev/kickoffItemsFixtures");
const { RequestError } = await import("../src/lib/requestsClient");
const { itemsMissing } = await import("../src/lib/kickoffItemsClient");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  });
async function draw(el: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(createElement(MemoryRouter, null, el)));
  await flush();
  return root;
}
async function clear(root: any) {
  await act(async () => root.unmount());
  roots.splice(roots.indexOf(root), 1);
  await flush();
  win.document.body.innerHTML = "";
  toasts.length = 0;
}
const body = () => win.document.body as any;
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string, within: any = body()) =>
  [...within.querySelectorAll("button")].find(
    (b: any) => text(b) === label || b.getAttribute("aria-label") === label,
  ) as any;
const item = (key: string) =>
  body().querySelector(`[data-item="${key}"]`) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => el.click());
  await flush();
}

const T = fx.ITEMS_TASK;
const C = fx.ITEMS_CLIENT;

describe("the words (kickoff-requests.md 5)", () => {
  test("rows are read leniently: an unknown state or a row with no item is left out", () => {
    expect(words.readItemRow({ item: "x", state: "surprise" })).toBeNull();
    expect(words.readItemRow({ state: "open" })).toBeNull();
    const r = words.readItemRow(fx.rawItem());
    expect(r).toMatchObject({
      item: "funded_card",
      state: "open",
      oneTap: true,
      actions: { raise: true, decline: true, link: true },
    });
    const read = words.readItems(
      fx.rawRead([], { reason: "no_answers", note: "x" }),
      T,
    );
    expect(read.reason).toBe("no_answers");
    expect(read.kickoff?.inOnboarding).toBe(true);
    expect(words.readItems({ reason: "surprise" }, T).reason).toBeNull();
  });

  test("the route line: team, owner by role, due day, priority only when not normal", () => {
    const funded = words.readItemRow(fx.rawItem()) as any;
    expect(words.routeLine(funded.route)).toBe(
      "Client Success · the CSM · due Wed 4 Nov · high",
    );
    const os = words.readItemRow(fx.rawMaharaOs()) as any;
    expect(words.routeLine(os.route)).toBe(
      "Operations / Tech · the systems manager · due Thu 5 Nov",
    );
    expect(words.routeLine(null)).toBeNull();
    expect(
      words.routeLine({ ...funded.route, teamLabel: null, note: "No route." }),
    ).toBe("No route.");
  });

  test("receipts: raised, counted, declined, by you or by a role, in Kuwait time", () => {
    const up = words.readItemRow(fx.raised(fx.rawItem())) as any;
    expect(words.receiptWords(up)).toEqual({
      head: "Raised: Card missing for ads",
      sub: "due Wed 4 Nov · high · by you · Tue 3 Nov 10:42",
    });
    const linked = words.readItemRow(
      fx.raised(fx.rawItem(), {
        decision: {
          answer: "raised",
          how: "linked",
          byLabel: "the CSM lead",
          at: "2026-11-03T07:42:00Z",
          mine: false,
        },
      }),
    ) as any;
    expect(words.receiptWords(linked)?.head).toBe(
      "Counted: Card missing for ads",
    );
    expect(words.receiptWords(linked)?.sub).toContain("by the CSM lead");
    const no = words.readItemRow(fx.declined(fx.rawItem())) as any;
    expect(words.receiptWords(no)?.head).toBe(
      "Not raised. You said No on Tue 3 Nov at 10:45.",
    );
    const theirs = words.readItemRow(
      fx.declined(fx.rawItem(), {
        decision: {
          answer: "declined",
          byLabel: "the CSM",
          at: "2026-11-03T07:45:00Z",
          mine: false,
          note: "They linked it after the call.",
        },
      }),
    ) as any;
    expect(words.receiptWords(theirs)).toEqual({
      head: "Not raised. The CSM said No on Tue 3 Nov at 10:45.",
      sub: "They linked it after the call.",
    });
    expect(words.receiptWords(words.readItemRow(fx.rawItem()) as any)).toBe(
      null,
    );
  });

  test("a raised request in words: in ClickUp, held, failed, cancelled, another seat's", () => {
    const req = (over: Record<string, unknown>) =>
      (words.readItemRow(fx.raised(fx.rawItem(), {})) as any).request &&
      words.requestWords({
        ...(words.readItemRow(fx.raised(fx.rawItem())) as any).request,
        ...over,
      });
    expect(req({})).toEqual({
      text: "In ClickUp",
      tone: "good",
      url: "https://app.clickup.com/t/86fxkick1",
    });
    expect(req({ held: true, heldNote: null, url: null }).text).toBe(
      "Saved, not sent yet. It goes to ClickUp once requests open.",
    );
    expect(req({ held: true, heldNote: "Requests are paused." }).text).toBe(
      "Requests are paused.",
    );
    expect(req({ state: "failed" })).toMatchObject({
      text: "Did not reach ClickUp. Raise it again.",
      tone: "critical",
    });
    expect(req({ state: "cancelled" }).text).toBe(
      "The request was cancelled. Raise it again if it is still needed.",
    );
    expect(req({ mayOpen: false, raisedBy: "the systems manager" }).text).toBe(
      "Raised by the systems manager.",
    );
    expect(req({ url: null, state: "queued", partState: "queued" }).text).toBe(
      "Sending to ClickUp",
    );
    const queued = words.readItemRow(
      fx.raised(fx.rawItem(), {
        request: {
          state: "queued",
          partState: "queued",
          mayOpen: true,
          url: null,
        },
      }),
    ) as any;
    expect(words.stillSending(queued)).toBe(true);
    expect(
      words.stillSending(words.readItemRow(fx.raised(fx.rawItem())) as any),
    ).toBe(false);
  });

  test("the sentences of 4.20, word for word", () => {
    const funded = words.readItemRow(fx.rawItem()) as any;
    const os = words.readItemRow(fx.rawMaharaOs()) as any;
    expect(words.kickerWords(3)).toBe("Still open from the kickoff · 3");
    expect(words.askWords(funded)).toBe("Raise Card missing for ads?");
    expect(words.yesLabel(funded, C)).toBe(
      "Yes, raise Card missing for ads for Cedar Interiors",
    );
    expect(words.NO_LABEL).toBe("No, do not raise it");
    expect(words.typeOffWords(funded)).toBe(
      "Card missing for ads is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.",
    );
    expect(words.formOnlyWords(os)).toBe(
      "General tech request needs answers the kickoff does not have.",
    );
    const open = (row: any) =>
      words.existingWords({
        ...row,
        existing: {
          requestId: "r1",
          typeLabel: row.typeLabel,
          createdAt: "2026-11-02T09:00:00Z",
          requesterLabel: "the CSM",
          imported: false,
          mayOpen: true,
        },
      });
    expect(open(funded)).toBe(
      "A Card missing for ads request is already open for this client, raised Mon 2 Nov by the CSM.",
    );
    expect(open(os)).toBe(
      "A General tech request is already open for this client, raised Mon 2 Nov by the CSM.",
    );
    expect(words.ITEMS_MISSING).toBe(
      "Kickoff items open after the next cockpit update.",
    );
    expect(words.TOAST.declined).toBe("Saved: not raised.");
    expect(words.TOAST.raised(funded)).toBe("Raised: Card missing for ads.");
    expect(words.TOAST.counted(os)).toBe("Counted: General tech request.");
    // The rings take the trail's tones.
    expect(words.itemTone(funded)).toEqual({ tone: "warning", mark: "open" });
    expect(
      words.itemTone(words.readItemRow(fx.raised(fx.rawItem())) as any),
    ).toEqual({ tone: "good", mark: "check" });
    expect(
      words.itemTone(words.readItemRow(fx.declined(fx.rawItem())) as any),
    ).toEqual({ tone: "neutral", mark: "dash" });
    expect(itemsMissing(new RequestError("x", "PGRST202"))).toBe(true);
    expect(itemsMissing(new RequestError("x", "42501"))).toBe(false);
  });
});

const onPage = (api: any, onTicket?: (t: any) => void) =>
  createElement(KickoffItems, {
    api,
    taskId: T,
    clientName: C,
    variant: "page",
    onTicket,
  });

describe("the client page's card (variant page)", () => {
  test("returning A to B to A waits for a fresh A read", async () => {
    const { api } = fx.fakeItemsApi({
      "test-client-a": fx.rawRead([fx.rawItem()]),
    });
    const original = api.read;
    let aReads = 0;
    let finishA: (v: any) => void = () => {};
    api.read = taskId => {
      if (taskId === "test-client-a" && ++aReads === 1) return original(taskId);
      if (taskId === "test-client-a")
        return new Promise(resolve => {
          finishA = resolve;
        });
      return new Promise(() => {});
    };
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page("test-client-a"));
    expect(item("funded_card")).toBeTruthy();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-client-b"))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-client-a"))),
    );
    await flush();
    expect(item("funded_card")).toBeNull();
    expect(body().querySelector('[data-kickoff-items="loading"]')).toBeTruthy();
    await act(async () =>
      finishA(words.readItems(fx.rawRead([fx.rawMaharaOs()]), "test-client-a")),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    await clear(root);
  });

  test("disconnecting and reconnecting the same API requires a fresh read", async () => {
    const { api } = fx.fakeItemsApi({ [T]: fx.rawRead([fx.rawItem()]) });
    const original = api.read;
    let reads = 0;
    let finish: (v: any) => void = () => {};
    api.read = taskId =>
      ++reads === 1
        ? original(taskId)
        : new Promise(resolve => {
            finish = resolve;
          });
    const page = (value: any) =>
      createElement(KickoffItems, {
        api: value,
        taskId: T,
        clientName: C,
        variant: "page",
      });
    const root = await draw(page(api));
    expect(item("funded_card")).toBeTruthy();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(null))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(api))),
    );
    await flush();
    expect(item("funded_card")).toBeNull();
    expect(body().querySelector('[data-kickoff-items="loading"]')).toBeTruthy();
    await act(async () =>
      finish(words.readItems(fx.rawRead([fx.rawMaharaOs()]), T)),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    await clear(root);
  });

  test("switching API instances and back cannot resurrect a previous read", async () => {
    const { api: first } = fx.fakeItemsApi({ [T]: fx.rawRead([fx.rawItem()]) });
    const { api: second } = fx.fakeItemsApi({});
    const original = first.read;
    let reads = 0;
    let finish: (v: any) => void = () => {};
    first.read = taskId =>
      ++reads === 1
        ? original(taskId)
        : new Promise(resolve => {
            finish = resolve;
          });
    second.read = () => new Promise(() => {});
    const page = (api: any) =>
      createElement(KickoffItems, {
        api,
        taskId: T,
        clientName: C,
        variant: "page",
      });
    const root = await draw(page(first));
    expect(item("funded_card")).toBeTruthy();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(second))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(first))),
    );
    await flush();
    expect(item("funded_card")).toBeNull();
    expect(body().querySelector('[data-kickoff-items="loading"]')).toBeTruthy();
    await act(async () =>
      finish(words.readItems(fx.rawRead([fx.rawMaharaOs()]), T)),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    await clear(root);
  });

  test("a fresh API session never inherits another session's pending request ID", async () => {
    const task = "test-separate-sessions";
    const { api: first } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const { api: second, cards: secondCards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    first.raise = async (_task, _item, id) => {
      ids.push(id);
      throw new Error("Result unknown");
    };
    second.raise = async (_task, _item, id) => {
      ids.push(id);
      secondCards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
      return {
        raised: true,
        alreadyOpen: false,
        reused: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
        submit: null,
      };
    };
    const page = (api: any) =>
      createElement(KickoffItems, {
        api,
        taskId: task,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(first));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(second))),
    );
    await flush();
    await click(button("Yes, raise Card missing for ads for Example client"));
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
    await clear(root);
  });

  test("reloading during Yes joins the same in-flight operation", async () => {
    const task = "test-reload-inflight";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    let resolveRaise: (v: any) => void = () => {};
    api.raise = (_task, _item, id) => {
      ids.push(id);
      return new Promise(resolve => {
        resolveRaise = resolve;
      });
    };
    const page = (reloadKey: number) =>
      createElement(KickoffItems, {
        api,
        taskId: task,
        clientName: "Example client",
        variant: "page",
        reloadKey,
      });
    const root = await draw(page(0));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(1))),
    );
    await flush();
    await click(button("Yes, raise Card missing for ads for Example client"));
    expect(ids).toHaveLength(1);
    cards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
    await act(async () =>
      resolveRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    expect(toasts).toEqual(["Raised: Card missing for ads."]);
    await clear(root);
  });

  test("two mounted views share one pending Yes and both receive its result", async () => {
    const task = "test-two-views";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    let finish: (v: any) => void = () => {};
    api.raise = (_task, _item, id) => {
      ids.push(id);
      return new Promise(resolve => {
        finish = resolve;
      });
    };
    const view = () =>
      createElement(KickoffItems, {
        api,
        taskId: task,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(createElement("div", null, view(), view()));
    const rows = [
      ...body().querySelectorAll('[data-item="funded_card"]'),
    ] as any[];
    expect(rows).toHaveLength(2);
    await click(
      button("Yes, raise Card missing for ads for Example client", rows[0]),
    );
    await click(
      button("Yes, raise Card missing for ads for Example client", rows[1]),
    );
    expect(ids).toHaveLength(1);
    cards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
    await act(async () =>
      finish({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    expect([
      ...body().querySelectorAll('[data-receipt="raised"]'),
    ]).toHaveLength(2);
    await clear(root);
  });

  test("a delayed Yes after navigation cannot show a success toast on another client", async () => {
    const task = "test-delayed-toast";
    const { api } = fx.fakeItemsApi({ [task]: fx.rawRead([fx.rawItem()]) });
    let resolveRaise: (v: any) => void = () => {};
    api.raise = () =>
      new Promise(resolve => {
        resolveRaise = resolve;
      });
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () =>
      resolveRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    expect(toasts).toEqual([]);
    await clear(root);
  });

  test("returning while Yes is in flight joins the same request and shows its receipt once", async () => {
    const task = "test-inflight";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    let resolveRaise: (v: any) => void = () => {};
    api.raise = (_task, _item, id) => {
      ids.push(id);
      return new Promise(resolve => {
        resolveRaise = resolve;
      });
    };
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(task))),
    );
    await flush();
    await click(button("Yes, raise Card missing for ads for Example client"));
    expect(ids).toHaveLength(1);
    cards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
    await act(async () =>
      resolveRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    expect(toasts).toEqual(["Raised: Card missing for ads."]);
    await clear(root);
  });

  test("a returned client sees the confirmed receipt when an earlier Yes finishes", async () => {
    const task = "test-returned-before-completion";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    let resolveRaise: (v: any) => void = () => {};
    api.raise = (_task, _item, id) => {
      ids.push(id);
      return new Promise(resolve => {
        resolveRaise = resolve;
      });
    };
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(task))),
    );
    await flush();
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeNull();
    cards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
    await act(async () =>
      resolveRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    expect(ids).toHaveLength(1);
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    expect(toasts).toEqual([]);
    await clear(root);
  });

  test("a Yes finishing during the returned client's read is not lost", async () => {
    const task = "test-completion-during-read";
    const { api } = fx.fakeItemsApi({ [task]: fx.rawRead([fx.rawItem()]) });
    const originalRead = api.read;
    let count = 0;
    let finishRead: (v: any) => void = () => {};
    let finishRaise: (v: any) => void = () => {};
    api.read = id => {
      if (id !== task) return originalRead(id);
      count++;
      if (count === 1) return originalRead(id);
      if (count === 2)
        return new Promise(resolve => {
          finishRead = resolve;
        });
      return Promise.resolve(
        words.readItems(fx.rawRead([fx.raised(fx.rawItem())]), task),
      );
    };
    api.raise = () =>
      new Promise(resolve => {
        finishRaise = resolve;
      });
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(task))),
    );
    await flush();
    await act(async () =>
      finishRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      }),
    );
    await flush();
    await act(async () =>
      finishRead(words.readItems(fx.rawRead([fx.rawItem()]), task)),
    );
    await flush();
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    expect(count).toBe(3);
    expect(toasts).toEqual([]);
    await clear(root);
  });

  test("a read resolving immediately before Yes still refreshes from the server", async () => {
    const task = "test-read-completion-gap";
    const { api } = fx.fakeItemsApi({ [task]: fx.rawRead([fx.rawItem()]) });
    const originalRead = api.read;
    let count = 0;
    let finishRead: (v: any) => void = () => {};
    let finishRaise: (v: any) => void = () => {};
    api.read = id => {
      if (id !== task) return originalRead(id);
      count++;
      if (count === 1) return originalRead(id);
      if (count === 2)
        return new Promise(resolve => {
          finishRead = resolve;
        });
      return Promise.resolve(
        words.readItems(fx.rawRead([fx.raised(fx.rawItem())]), task),
      );
    };
    api.raise = () =>
      new Promise(resolve => {
        finishRaise = resolve;
      });
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(task))),
    );
    await flush();
    await act(async () => {
      finishRead(words.readItems(fx.rawRead([fx.rawItem()]), task));
      finishRaise({
        raised: true,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      });
    });
    await flush();
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    expect(count).toBe(3);
    expect(toasts).toEqual([]);
    await clear(root);
  });

  test("a newer teammate decision is read from the server after Yes", async () => {
    const task = "test-teammate-update";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    api.raise = async () => {
      cards[task] = fx.rawRead([fx.declined(fx.rawItem())]);
      return {
        raised: true,
        alreadyOpen: false,
        reused: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
        submit: null,
      };
    };
    const root = await draw(
      createElement(KickoffItems, {
        api,
        taskId: task,
        clientName: "Example client",
        variant: "page",
      }),
    );
    await click(button("Yes, raise Card missing for ads for Example client"));
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeNull();
    expect(
      item("funded_card").querySelector('[data-receipt="declined"]'),
    ).toBeTruthy();
    await clear(root);
  });

  test("an uncertain Yes retry after navigation keeps its original request ID", async () => {
    const task = "test-uncertain";
    const { api, cards } = fx.fakeItemsApi({
      [task]: fx.rawRead([fx.rawItem()]),
    });
    const ids: string[] = [];
    let rejectRaise: (e: Error) => void = () => {};
    api.raise = (_task, _item, id) => {
      ids.push(id);
      if (ids.length === 1)
        return new Promise((_resolve, reject) => {
          rejectRaise = reject;
        });
      cards[task] = fx.rawRead([fx.raised(fx.rawItem())]);
      return Promise.resolve({
        raised: true,
        alreadyOpen: false,
        reused: true,
        item: words.readItemRow(fx.raised(fx.rawItem())),
      } as any);
    };
    const page = (taskId: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: "Example client",
        variant: "page",
      });
    const root = await draw(page(task));
    await click(button("Yes, raise Card missing for ads for Example client"));
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page("test-other"))),
    );
    await flush();
    await act(async () => rejectRaise(new Error("Network result unknown")));
    await flush();
    expect(toasts).toEqual([]);
    await act(async () =>
      root.render(createElement(MemoryRouter, null, page(task))),
    );
    await flush();
    await click(button("Yes, raise Card missing for ads for Example client"));
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(
      item("funded_card").querySelector('[data-receipt="raised"]'),
    ).toBeTruthy();
    await clear(root);
  });

  test("a late read for another client cannot replace this client's kickoff items", async () => {
    const nextTask = "test-client-b";
    const { api } = fx.fakeItemsApi({});
    const pending: Record<string, (v: any) => void> = {};
    api.read = taskId =>
      new Promise(resolve => {
        pending[taskId] = resolve;
      });
    const page = (taskId: string, name: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: name,
        variant: "page",
      });
    const root = await draw(page("test-client-a", "Client A"));
    await act(async () =>
      root.render(
        createElement(MemoryRouter, null, page(nextTask, "Client B")),
      ),
    );
    await flush();
    await act(async () =>
      pending[nextTask](
        words.readItems(fx.rawRead([fx.rawMaharaOs()]), nextTask),
      ),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    await act(async () =>
      pending["test-client-a"](
        words.readItems(fx.rawRead([fx.rawItem()]), "test-client-a"),
      ),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    expect(item("funded_card")).toBeNull();
    await clear(root);
  });

  test("changing client hides previously loaded items while the new read is pending", async () => {
    const { api } = fx.fakeItemsApi({
      "test-client-a": fx.rawRead([fx.rawItem()]),
    });
    const originalRead = api.read;
    let finishNext: (v: any) => void = () => {};
    api.read = taskId =>
      taskId === "test-client-b"
        ? new Promise(resolve => {
            finishNext = resolve;
          })
        : originalRead(taskId);
    const page = (taskId: string, name: string) =>
      createElement(KickoffItems, {
        api,
        taskId,
        clientName: name,
        variant: "page",
      });
    const root = await draw(page("test-client-a", "Client A"));
    expect(item("funded_card")).toBeTruthy();
    await act(async () =>
      root.render(
        createElement(MemoryRouter, null, page("test-client-b", "Client B")),
      ),
    );
    await flush();
    expect(item("funded_card")).toBeNull();
    await act(async () =>
      finishNext(
        words.readItems(fx.rawRead([fx.rawMaharaOs()]), "test-client-b"),
      ),
    );
    await flush();
    expect(item("mahara_os")).toBeTruthy();
    await clear(root);
  });

  test("retry reloads kickoff items without resending a decision", async () => {
    const { api, calls } = fx.fakeItemsApi({ [T]: fx.rawRead([fx.rawItem()]) });
    const originalRead = api.read;
    let attempts = 0;
    api.read = async taskId => {
      if (++attempts === 1)
        throw new RequestError("Try again shortly.", "P0001");
      return originalRead(taskId);
    };
    const root = await draw(onPage(api));
    expect(text(body().querySelector('[role="alert"]'))).toContain(
      "Try again shortly.",
    );
    await click(button("Try again"));
    expect(item("funded_card")).toBeTruthy();
    expect(attempts).toBe(2);
    expect(calls.every(c => c.name === "read")).toBe(true);
    await clear(root);
  });

  test("open items ask Raise …? with equal Yes and No, the route line and Change it first", async () => {
    const { api } = fx.fakeItemsApi({
      [T]: fx.rawRead([fx.rawItem(), fx.rawMaharaOs()]),
    });
    const root = await draw(onPage(api, () => {}));
    expect(text(body())).toContain("Kickoff items");
    expect(text(body())).toContain(
      "From the kickoff on Tue 3 Nov. Yes raises the request; No records it.",
    );
    expect(text(body().querySelector(".ki-kicker"))).toBe(
      "Still open from the kickoff · 2",
    );
    const funded = item("funded_card");
    expect(text(funded)).toContain(
      "The card with funds is not linked to the ad account.",
    );
    expect(text(funded)).toContain("Raise Card missing for ads?");
    expect(text(funded.querySelector(".ki-route"))).toBe(
      "Client Success · the CSM · due Wed 4 Nov · high",
    );
    // Equal pills, never a filled Yes; the names a screen reader hears.
    const yes = button(
      "Yes, raise Card missing for ads for Cedar Interiors",
      funded,
    );
    const no = button("No, do not raise it", funded);
    expect(yes.className).toBe(no.className);
    expect(text(yes)).toBe("Yes");
    expect(text(no)).toBe("No");
    expect(button("Change it first", funded)).toBeTruthy();
    // The open ring is the trail's warning ring.
    expect(funded.querySelector(".fs-ring").getAttribute("data-tone")).toBe(
      "warning",
    );
    await clear(root);
  });

  test("Yes raises in one tap: the server's row folds into its receipt, focus moves to it, the ring turns teal", async () => {
    const { api, calls } = fx.fakeItemsApi({
      [T]: fx.rawRead([fx.rawItem(), fx.rawMaharaOs()]),
    });
    const root = await draw(onPage(api, () => {}));
    await click(button("Yes, raise Card missing for ads for Cedar Interiors"));
    const raise = calls.find(c => c.name === "raise");
    expect(raise?.args.slice(0, 2)).toEqual([T, "funded_card"]);
    expect(String(raise?.args[2])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const funded = item("funded_card");
    expect(text(funded.querySelector("[data-receipt]"))).toBe(
      "Raised: Card missing for ads · In ClickUp",
    );
    expect(funded.querySelector("a").getAttribute("href")).toBe(
      "https://app.clickup.com/t/86fxkick1",
    );
    expect(text(funded.querySelector(".ki-sub"))).toBe(
      "due Wed 4 Nov · high · by you · Tue 3 Nov 10:42",
    );
    expect(funded.querySelector(".fs-ring").getAttribute("data-tone")).toBe(
      "good",
    );
    expect(win.document.activeElement?.getAttribute("data-receipt")).toBe(
      "raised",
    );
    expect(button("Yes, raise Card missing for ads for Cedar Interiors")).toBe(
      undefined,
    );
    expect(toasts).toContain("Raised: Card missing for ads.");
    // One left to decide; the decided item moves under it.
    expect(text(body().querySelector(".ki-kicker"))).toBe(
      "Still open from the kickoff · 1",
    );
    const order = [...body().querySelectorAll("[data-item]")].map((x: any) =>
      x.getAttribute("data-item"),
    );
    expect(order).toEqual(["mahara_os", "funded_card"]);
    await clear(root);
  });

  test("a refused Yes says the server's sentence and keeps its request id for the next press", async () => {
    const { api, calls } = fx.fakeItemsApi(
      { [T]: fx.rawRead([fx.rawItem()]) },
      {
        failRaise:
          "Card missing for ads is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.",
      },
    );
    const root = await draw(onPage(api));
    await click(button("Yes, raise Card missing for ads for Cedar Interiors"));
    await click(button("Yes, raise Card missing for ads for Cedar Interiors"));
    const ids = calls.filter(c => c.name === "raise").map(c => c.args[2]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(text(body().querySelector('[role="alert"]'))).toBe(
      "Card missing for ads is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.",
    );
    await clear(root);
  });

  test("No is recorded with nothing asked; Raise it after all raises it", async () => {
    const { api, calls } = fx.fakeItemsApi({
      [T]: fx.rawRead([fx.rawMaharaOs()]),
    });
    const root = await draw(onPage(api));
    await click(button("No, do not raise it"));
    expect(calls.find(c => c.name === "decline")?.args).toEqual([
      T,
      "mahara_os",
      null,
    ]);
    const os = item("mahara_os");
    expect(text(os.querySelector("[data-receipt]"))).toBe(
      "Not raised. You said No on Tue 3 Nov at 10:45.",
    );
    expect(os.querySelector(".fs-ring").getAttribute("data-tone")).toBe(
      "neutral",
    );
    expect(toasts).toContain("Saved: not raised.");
    expect(win.document.activeElement?.getAttribute("data-receipt")).toBe(
      "declined",
    );
    // The keyboard is on "Raise it after all"; the button unmounts and focus lands on the new receipt.
    const again = button("Raise it after all");
    await act(async () => again.focus());
    expect(win.document.activeElement).toBe(again);
    await click(again);
    expect(calls.filter(c => c.name === "raise")).toHaveLength(1);
    expect(text(item("mahara_os").querySelector("[data-receipt]"))).toBe(
      "Raised: General tech request · In ClickUp",
    );
    expect(win.document.activeElement?.getAttribute("data-receipt")).toBe(
      "raised",
    );
    await clear(root);
  });

  test("Change it first opens the prefilled ticket form and counts what it sends", async () => {
    const { api, calls } = fx.fakeItemsApi({
      [T]: fx.rawRead([fx.rawMaharaOs()]),
    });
    const asked: any[] = [];
    const root = await draw(onPage(api, t => asked.push(t)));
    await click(button("Change it first"));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      type: "general_tech",
      item: "mahara_os",
      details:
        "Raised from the kickoff on Tue 3 Nov: Mahara OS access is Tech Issue. Get the client logged in to Mahara OS, then tell their CSM.",
    });
    // The ticket form sent its request: it is counted for the item.
    await act(async () => asked[0].onSent({ id: "req-from-form" }));
    await flush();
    expect(calls.find(c => c.name === "link")?.args).toEqual([
      T,
      "mahara_os",
      "req-from-form",
    ]);
    expect(text(item("mahara_os").querySelector("[data-receipt]"))).toBe(
      "Counted: General tech request · In ClickUp",
    );
    expect(toasts).toContain("Counted: General tech request.");
    await clear(root);
  });

  test("an open request of the type already on the card: Count it or No, nothing raised twice", async () => {
    const { api, calls } = fx.fakeItemsApi({
      [T]: fx.rawRead([
        fx.rawItem({
          state: "already_open",
          actions: { raise: false, decline: true, link: true },
          existing: {
            requestId: "req-open-1",
            typeLabel: "Card missing for ads",
            createdAt: "2026-11-02T09:00:00Z",
            requesterLabel: "the CSM",
            imported: false,
            mayOpen: true,
          },
        }),
      ]),
    });
    const root = await draw(onPage(api));
    expect(text(item("funded_card"))).toContain(
      "A Card missing for ads request is already open for this client, raised Mon 2 Nov by the CSM.",
    );
    expect(button("Yes, raise Card missing for ads for Cedar Interiors")).toBe(
      undefined,
    );
    await click(button("Count it"));
    expect(calls.find(c => c.name === "link")?.args).toEqual([
      T,
      "funded_card",
      "req-open-1",
    ]);
    await clear(root);
  });

  test("a type turned off, a type that needs the form, a card the requests cannot reach", async () => {
    const { api } = fx.fakeItemsApi({
      [T]: fx.rawRead([
        fx.rawItem({
          state: "type_off",
          typeEnabled: false,
          offered: false,
          actions: { raise: false, decline: false, link: true },
        }),
        fx.rawMaharaOs({
          oneTap: false,
          actions: { raise: false, decline: true, link: true },
        }),
        fx.rawItem({
          item: "whatsapp_sync",
          short: "WhatsApp sync",
          typeKey: "whatsapp_connection",
          typeLabel: "WhatsApp connection issue",
          line: "WhatsApp is not synced to Mahara OS: Needs Integrating.",
          blocked:
            "This client is not on the cockpit's client list yet, so a request cannot be raised for it here. Raise it in ClickUp.",
          actions: { raise: false, decline: true, link: false },
        }),
      ]),
    });
    const asked: any[] = [];
    const root = await draw(onPage(api, t => asked.push(t)));
    const off = item("funded_card");
    expect(text(off)).toContain(
      "Card missing for ads is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.",
    );
    expect(off.querySelectorAll("button")).toHaveLength(0);
    const form = item("mahara_os");
    expect(text(form)).toContain(
      "General tech request needs answers the kickoff does not have.",
    );
    await click(button("Raise it with the form", form));
    expect(asked[0]?.type).toBe("general_tech");
    expect(button("No, do not raise it", form)).toBeTruthy();
    const blocked = item("whatsapp_sync");
    expect(text(blocked)).toContain(
      "This client is not on the cockpit's client list yet, so a request cannot be raised for it here. Raise it in ClickUp.",
    );
    expect([...blocked.querySelectorAll("button")].map(text)).toEqual(["No"]);
    await clear(root);
  });

  test("a held writer says the server's note under the ask", async () => {
    const { api } = fx.fakeItemsApi({
      [T]: fx.rawRead([
        fx.rawItem({
          route: {
            ...(fx.rawItem().route as any),
            writer: {
              canSend: false,
              held: true,
              note: "Saved, not sent yet. It goes to ClickUp once requests open.",
            },
          },
        }),
      ]),
    });
    const root = await draw(onPage(api));
    expect(text(item("funded_card"))).toContain(
      "Saved, not sent yet. It goes to ClickUp once requests open.",
    );
    await clear(root);
  });

  test("missing functions say one line; no stored answers say where they are; nothing open draws nothing", async () => {
    let root = await draw(onPage(fx.fakeItemsApi({}, { missing: true }).api));
    expect(text(body())).toBe(
      "Kickoff items open after the next cockpit update.",
    );
    await clear(root);
    root = await draw(
      onPage(
        fx.fakeItemsApi({
          [T]: fx.rawRead([], { reason: "no_answers" }),
        }).api,
      ),
    );
    expect(text(body())).toContain(
      "The kickoff's answers are not in the cockpit, so its open items cannot show here. They are in the card's Kickoff Handoff comment.",
    );
    await clear(root);
    root = await draw(
      onPage(
        fx.fakeItemsApi({
          [T]: fx.rawRead([], {
            reason: "no_answers",
            kickoff: { at: null, answered: false, inOnboarding: false },
          }),
        }).api,
      ),
    );
    expect(text(body())).toBe("");
    await clear(root);
    root = await draw(
      onPage(fx.fakeItemsApi({ [T]: fx.rawRead([], { reason: "none" }) }).api),
    );
    expect(text(body())).toBe("");
    await clear(root);
    // A seat the read refuses (an admin seat without the csm role) sees nothing, never an alert.
    for (const variant of ["page", "sheet"] as const) {
      const refused = fx.fakeItemsApi({}).api;
      refused.read = async () => {
        throw new RequestError(
          "Only the CEO or the client's CSM decides kickoff items.",
          "42501",
        );
      };
      root = await draw(
        createElement(KickoffItems, {
          api: refused,
          taskId: T,
          clientName: C,
          variant,
        }),
      );
      expect([variant, text(body())]).toEqual([variant, ""]);
      expect(body().querySelector('[role="alert"]')).toBeNull();
      await clear(root);
    }
    // Any other refusal still says it could not be read.
    const down = fx.fakeItemsApi({}).api;
    down.read = async () => {
      throw new RequestError(
        "The database could not answer just now.",
        "P0001",
      );
    };
    root = await draw(onPage(down));
    expect(text(body().querySelector('[role="alert"]'))).toBe(
      "Kickoff items could not be read: The database could not answer just now.",
    );
    await clear(root);
  });

  test("a route note in Postgres's own words is never shown; the preview's own sentence is", async () => {
    const raw = fx.rawItem();
    const rawRoute = {
      ...(raw.route as Record<string, unknown>),
      teamLabel: null,
      note: "permission denied for function cockpit_request_preview",
    };
    let root = await draw(
      onPage(
        fx.fakeItemsApi({ [T]: fx.rawRead([{ ...raw, route: rawRoute }]) }).api,
      ),
    );
    expect(text(body())).not.toContain("permission denied");
    expect(text(item("funded_card").querySelector(".ki-route"))).toBe(
      "The database could not answer just now. Try again in a minute; if it keeps happening, tell the systems manager.",
    );
    await clear(root);
    root = await draw(
      onPage(
        fx.fakeItemsApi({
          [T]: fx.rawRead([
            {
              ...raw,
              route: { ...rawRoute, note: "This request type is turned off." },
            },
          ]),
        }).api,
      ),
    );
    expect(text(item("funded_card").querySelector(".ki-route"))).toBe(
      "This request type is turned off.",
    );
    await clear(root);
  });
});

describe("the kickoff sheet's trail (variant sheet)", () => {
  test("the items carry on the trail; no Change it first and no form button in the sheet", async () => {
    const { api } = fx.fakeItemsApi({
      [T]: fx.rawRead([
        fx.rawItem(),
        fx.rawMaharaOs({
          oneTap: false,
          actions: { raise: false, decline: true, link: true },
        }),
      ]),
    });
    const root = await draw(
      createElement(KickoffItems, {
        api,
        taskId: T,
        clientName: C,
        variant: "sheet",
        // A sheet never opens a second sheet, even when one is handed in.
        onTicket: () => {},
      } as any),
    );
    expect(body().querySelector("ol.fs-trail")).toBeTruthy();
    expect(body().querySelectorAll("ol.fs-trail > li.fs-step")).toHaveLength(2);
    expect(button("Change it first")).toBe(undefined);
    expect(button("Raise it with the form")).toBe(undefined);
    expect(text(item("mahara_os"))).toContain(
      "Raise it with the form from the client page.",
    );
    await clear(root);
  });
});

describe("Today, Kickoff items to decide (variant band)", () => {
  const due = {
    asOf: "2026-11-03T08:00:00Z",
    rows: [
      {
        taskId: T,
        clientName: C,
        kickoffAt: "2026-11-01T09:00:00Z",
        kickoffDay: "Sun 1 Nov",
        due: 2,
        items: [fx.rawItem({ route: null }), fx.rawMaharaOs({ route: null })],
      },
      {
        taskId: "86eyfake02",
        clientName: "Juniper Fit-Out",
        kickoffAt: "2026-11-02T09:00:00Z",
        kickoffDay: "Mon 2 Nov",
        due: 1,
        items: [fx.rawItem({ route: null })],
      },
    ],
    more: false,
    note: null,
  };

  test("one row per card, the kickoff's day in mono, its items inline; a Yes raises on that card", async () => {
    const { api, calls } = fx.fakeItemsApi(
      {
        [T]: fx.rawRead([fx.rawItem(), fx.rawMaharaOs()]),
        "86eyfake02": fx.rawRead([fx.rawItem()], { taskId: "86eyfake02" }),
      },
      { due },
    );
    const asked: any[] = [];
    const root = await draw(
      createElement(KickoffItemsBand, { api, onTicket: t => asked.push(t) }),
    );
    const h2 = body().querySelector("h2");
    expect(text(h2.firstChild)).toBe("Kickoff items to decide");
    expect(text(h2.querySelector("span"))).toBe("3");
    const rows = [...body().querySelectorAll("[data-kickoff-band-row]")];
    expect(
      rows.map((r: any) => r.getAttribute("data-kickoff-band-row")),
    ).toEqual([T, "86eyfake02"]);
    expect(text(rows[0])).toContain("Cedar Interiors kickoff Sun 1 Nov");
    expect(rows[0].querySelector("a").getAttribute("href")).toBe(
      "/clients/86eywg1cq?tab=onboarding",
    );
    const second = rows[1] as any;
    await click(
      button("Yes, raise Card missing for ads for Juniper Fit-Out", second),
    );
    expect(calls.find(c => c.name === "raise")?.args.slice(0, 2)).toEqual([
      "86eyfake02",
      "funded_card",
    ]);
    // Change it first names the card it is for.
    await click(button("Change it first", rows[0]));
    expect(asked[0]).toMatchObject({
      taskId: T,
      name: C,
      type: "card_missing",
    });
    await clear(root);
  });

  test("the band keeps a newer teammate decision from the authoritative read", async () => {
    const { api, cards } = fx.fakeItemsApi(
      { [T]: fx.rawRead([fx.rawItem()]) },
      { due },
    );
    api.raise = async () => {
      cards[T] = fx.rawRead([fx.declined(fx.rawItem())]);
      return {
        raised: true,
        reused: false,
        alreadyOpen: false,
        item: words.readItemRow(fx.raised(fx.rawItem())),
        submit: null,
      };
    };
    const root = await draw(createElement(KickoffItemsBand, { api }));
    const row = body().querySelector(`[data-kickoff-band-row="${T}"]`);
    await click(button(`Yes, raise Card missing for ads for ${C}`, row));
    expect(row.querySelector('[data-receipt="declined"]')).toBeTruthy();
    expect(row.querySelector('[data-receipt="raised"]')).toBeNull();
    await clear(root);
  });

  test("overlapping band refreshes cannot replace a newer result with an older one", async () => {
    const { api } = fx.fakeItemsApi(
      { [T]: fx.rawRead([fx.rawItem(), fx.rawMaharaOs()]) },
      { due },
    );
    const reads: Array<(v: any) => void> = [];
    api.read = () =>
      new Promise(resolve => {
        reads.push(resolve);
      });
    api.raise = async (_task, item) => ({
      raised: true,
      reused: false,
      alreadyOpen: false,
      item: words.readItemRow(
        fx.raised(item === "funded_card" ? fx.rawItem() : fx.rawMaharaOs()),
      ),
      submit: null,
    });
    const root = await draw(createElement(KickoffItemsBand, { api }));
    const row = body().querySelector(`[data-kickoff-band-row="${T}"]`);
    await click(button(`Yes, raise Card missing for ads for ${C}`, row));
    await click(button(`Yes, raise General tech request for ${C}`, row));
    expect(reads).toHaveLength(2);
    await act(async () =>
      reads[1](
        words.readItems(
          fx.rawRead([fx.declined(fx.rawItem()), fx.rawMaharaOs()]),
          T,
        ),
      ),
    );
    await flush();
    await act(async () =>
      reads[0](
        words.readItems(
          fx.rawRead([fx.raised(fx.rawItem()), fx.rawMaharaOs()]),
          T,
        ),
      ),
    );
    await flush();
    expect(
      Boolean(
        row.querySelector(
          '[data-item="funded_card"] [data-receipt="declined"]',
        ),
      ),
    ).toBe(true);
    expect(
      Boolean(
        row.querySelector('[data-item="funded_card"] [data-receipt="raised"]'),
      ),
    ).toBe(false);
    await clear(root);
  });

  test("the band explains when the confirmed Yes cannot be refreshed", async () => {
    const { api } = fx.fakeItemsApi(
      { [T]: fx.rawRead([fx.rawItem()]) },
      { due },
    );
    api.read = async () => {
      throw new Error("Network unavailable");
    };
    api.raise = async () => ({
      raised: true,
      reused: false,
      alreadyOpen: false,
      item: words.readItemRow(fx.raised(fx.rawItem())),
      submit: null,
    });
    const root = await draw(createElement(KickoffItemsBand, { api }));
    const row = body().querySelector(`[data-kickoff-band-row="${T}"]`);
    await click(button(`Yes, raise Card missing for ads for ${C}`, row));
    expect(text(row)).toContain(
      "Saved, but the latest status could not be read. Reload the page.",
    );
    await clear(root);
  });

  test("nothing to decide draws nothing; a seat outside client success sees nothing; missing says one line", async () => {
    let root = await draw(
      createElement(KickoffItemsBand, {
        api: fx.fakeItemsApi({}, { due: { rows: [] } }).api,
      }),
    );
    expect(text(body())).toBe("");
    await clear(root);
    const refused = fx.fakeItemsApi({}).api;
    refused.due = async () => {
      throw new RequestError(
        "Kickoff items are for the client success team.",
        "42501",
      );
    };
    root = await draw(createElement(KickoffItemsBand, { api: refused }));
    expect(text(body())).toBe("");
    await clear(root);
    root = await draw(
      createElement(KickoffItemsBand, {
        api: fx.fakeItemsApi({}, { missing: true }).api,
      }),
    );
    expect(text(body())).toBe(
      "Kickoff items open after the next cockpit update.",
    );
    await clear(root);
  });
});

describe("the look (5.16)", () => {
  const css = readFileSync(
    resolve(import.meta.dir, "../src/components/kickoffItems.css"),
    "utf8",
  );
  test("tokens only, the 44px pills on two columns at phone width, no motion when reduced", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(/);
    const phone = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(phone).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(phone).toContain("min-height: 44px");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // The rings are the shared trail's, used and not changed.
    const shared = readFileSync(
      resolve(import.meta.dir, "../src/forms/staff/formSheet.css"),
      "utf8",
    );
    expect(shared).toContain('.fs-ring[data-tone="good"]');
    expect(css).not.toMatch(/^\.fs-ring\b/m);
  });
});
