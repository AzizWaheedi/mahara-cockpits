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
 * The client's Messages card and Today's recap rows (src/components/
 * ClientMessages.tsx, src/forms/RecapApproval.tsx, src/lib/
 * clientMessages.ts; docs/forms/STAGE2B-CONTRACT.md 3.7, 4.3 and 5.1):
 * every state of 5.1's table with its chip, its line and its actions, the
 * exact-bytes surface and its edit in place, approve through recap.approve
 * (warnings first, the check's refusal with the edit kept), Skip, reopen,
 * focus to the row's state line and one live region per card, the card
 * dark until the 1-1 notes are native, and the RPC clients' names and
 * arguments. Nothing reaches WhatsApp: the backend is a stand-in in memory.
 *
 * Run: bun test scripts/client-messages.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01?tab=overview",
  width: 1280,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "HTMLAnchorElement",
  "HTMLDetailsElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "InputEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
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

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
    info: (m: string) => toasts.push(m),
    warning: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
  useCockpitAuth: () => ({ client: null, session: null, email: "" }),
}));

const { createRoot } = await import("react-dom/client");
const { act, useState } = await import("react");
const { MemoryRouter } = await import("react-router");
const {
  ClientMessages,
  RecapsWaiting,
  MESSAGES_EMPTY,
  MESSAGES_FAILED,
  RECAPS_FAILED,
  useClientMessages,
} = await import("../src/components/ClientMessages");
const {
  messagesIO,
  RecapApproval,
  RECAP_WORDS,
  stateLine,
  messageLead,
  onItsWay,
} = await import("../src/forms/RecapApproval");
const lib = await import("../src/lib/clientMessages");
const { approveRecap } = await import("../src/forms/checkinClient");
const fx = await import("../src/dev/checkinFixtures");

const roots: ReturnType<typeof createRoot>[] = [];
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 5));
    });
};
async function mount(node: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await settle();
  return host as any;
}
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const page = () => text(win.document.body);
const buttons = (el: any = win.document.body) =>
  Array.from(el.querySelectorAll("button")) as any[];
const named = (name: string, el?: any) =>
  buttons(el).filter(b => text(b) === name);
const click = async (el: any) => {
  await act(async () => {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
  await settle();
};
const focused = () => win.document.activeElement as any;
async function typeInto(field: any, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      win.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    set?.call(field, value);
    field.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await settle();
}
const chip = (host: any) =>
  text(host.querySelector("[data-message] span.rounded-full"));
const liveRegion = (host: any) =>
  host.querySelector('[role="status"][aria-live="polite"]');

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  toasts.length = 0;
  win.location.hash = "";
});
afterAll(async () => {
  await win.happyDOM.close();
  for (const [k, d] of before) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

const st = fx.messageStates();
const card = (rows: any[], s: any = {}, native = true) => {
  const io = fx.fakeMessages(rows, s);
  return {
    io,
    node: (
      <ClientMessages
        taskId={fx.TASK}
        native={native}
        io={io}
        clock={fx.fixtureClock()}
      />
    ),
  };
};

describe("the card", () => {
  test("titled Messages with its kicker and anchor; newest first; no rows says what comes", async () => {
    const { node } = card([]);
    const host = await mount(node);
    expect(host.querySelector("#messages")).toBeTruthy();
    expect(text(host.querySelector("h2"))).toBe("Messages");
    expect(page()).toContain("To the client's WhatsApp group");
    expect(page()).toContain(MESSAGES_EMPTY);
    expect(MESSAGES_EMPTY).toBe(
      "No messages for this client yet. A recap appears here after you send 1-1 notes for a recorded call.",
    );
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const week = card(fx.messagesWeek());
    const h2 = await mount(week.node);
    const leads = Array.from(h2.querySelectorAll("[data-message] h3")).map(
      (h: any) => text(h),
    );
    expect(leads).toEqual([
      "1-1 recap · call Sun 25 Oct",
      "1-1 recap · call Thu 22 Oct",
    ]);
    expect(page()).toContain(
      "Sent at 14:12. Read back from WhatsApp at 14:13.",
    );
  });

  test("a read that fails is said, never zero", async () => {
    const { node } = card([], { readError: "Failed to fetch" });
    await mount(node);
    expect(page()).toContain(MESSAGES_FAILED);
    expect(MESSAGES_FAILED).toBe(
      "The messages could not be read, so a recap may be missing here. Reload the page; if it stays, tell the tech lead.",
    );
    expect(page()).not.toContain(MESSAGES_EMPTY);
  });

  test("dark until the 1-1 notes are native, unless a row exists", async () => {
    const empty = card([], {}, false);
    const host = await mount(empty.node);
    expect(host.innerHTML).toBe("");
    const failed = card([], { readError: "Failed to fetch" }, false);
    const host2 = await mount(failed.node);
    expect(host2.innerHTML).toBe("");
    // After a switch back, a refused recap still needs its Skip.
    const kept = card([st.refused], {}, false);
    await mount(kept.node);
    expect(page()).toContain("Not sent");
    expect(named("Skip").length).toBe(1);
  });

  test("opened from #messages, the card comes into view", async () => {
    win.location.hash = "#messages";
    let scrolled = 0;
    const proto = (win as any).HTMLElement.prototype;
    const real = proto.scrollIntoView;
    proto.scrollIntoView = function () {
      if (this.id === "messages") scrolled += 1;
    };
    try {
      const { node } = card(fx.messagesWeek());
      await mount(node);
      expect(scrolled).toBe(1);
    } finally {
      proto.scrollIntoView = real;
    }
  });
});

describe("each state of 5.1, with its chip, its line and its actions", () => {
  const cases: [string, string, string, string[]][] = [
    [
      "draft",
      "Waiting for you",
      RECAP_WORDS.draft,
      ["Edit", "Skip", "Approve and send"],
    ],
    [
      "expired",
      "Waiting for you",
      "The approval ran out after 24 hours. Approve it again.",
      ["Edit", "Skip", "Approve and send"],
    ],
    ["approved", "Approved", "Sends within about 3 minutes.", ["Edit again"]],
    ["sending", "Sending", "Sending now.", []],
    ["sent", "Sent", "Sent at 11:26. Read back from WhatsApp at 11:27.", []],
    ["sent-checking", "Sent", "Sent at 11:29. Checking it arrived…", []],
    [
      "unknown",
      "Not confirmed",
      "Not confirmed: WhatsApp did not answer. The cockpit never sends it twice. Look in the group; the tech lead settles it.",
      [],
    ],
    [
      "refused",
      "Not sent",
      "No WhatsApp group on Client Data for this card. Add it to Client Data column F, then try again.",
      ["Skip", "Try again"],
    ],
    [
      "failed",
      "Not sent",
      "WhatsApp answered 400. Check the group on Client Data.",
      ["Skip", "Try again"],
    ],
    ["skipped", "Skipped", "Skipped. Nothing was sent.", []],
    [
      "handed-back",
      "Waiting for you",
      "Make sends 1-1 recaps again, so this one is not sent from here. Skip it.",
      ["Skip"],
    ],
    [
      "tries-used-up",
      "Not sent",
      "This recap was tried three times and did not go. Send it by hand in the group if it is still needed, then skip it here.",
      ["Skip"],
    ],
  ];
  for (const [name, chipText, line, actions] of cases)
    test(`${name}: ${chipText}`, async () => {
      const m = (st as any)[name];
      const { node } = card([m]);
      const host = await mount(node);
      expect(chip(host)).toBe(chipText);
      const status = host.querySelector("[data-message] p[tabindex='-1']");
      expect(text(status)).toBe(line);
      expect(stateLine(m)).toBe(line);
      const row = host.querySelector("[data-message]");
      expect(
        buttons(row)
          .map(b => text(b))
          .filter(t => t !== "Undo my edits"),
      ).toEqual(actions);
      // The surface only while it waits for a person; folded otherwise.
      const surface = row.querySelector('[dir="rtl"][lang="ar"]');
      if (m.state === "draft") {
        expect(surface).toBeTruthy();
        expect(row.querySelector("details")).toBeNull();
      } else {
        expect(text(row.querySelector("details summary"))).toBe(
          "Show the message",
        );
      }
    });

  test("the orange dot is the draft's; Sent is good; Not sent is bad", async () => {
    const { node } = card([
      st.draft,
      { ...st.sent, id: "x-sent" },
      { ...st.failed, id: "x-failed" },
    ]);
    const host = await mount(node);
    const dots = Array.from(
      host.querySelectorAll(
        "[data-message] span.rounded-full span[aria-hidden]",
      ),
    ).map((d: any) => String(d.className));
    expect(dots[0]).toContain("bg-warning");
    expect(dots[1]).toContain("bg-success");
    expect(dots[2]).toContain("bg-destructive");
  });
});

describe("the exact-bytes surface", () => {
  test("the stored text right to left, single-star bold, the ink-teal rule on its inline-start edge", async () => {
    const body = `${"*شكرا* على وقتك"}\n\n${fx.RECAP_BODY.split("\n\n").at(-1)}`;
    const { node } = card([{ ...st.draft, body }]);
    const host = await mount(node);
    const surface = host.querySelector('[data-message] [dir="rtl"][lang="ar"]');
    expect(String(surface.className)).toContain("border-s-2");
    expect(String(surface.className)).toContain("border-primary-ink");
    expect(surface.querySelector("strong")?.textContent).toBe("شكرا");
    // The stars go, as WhatsApp draws them; nothing else changes.
    expect(surface.textContent).toBe(body.replace("*شكرا*", "شكرا"));
    // The booking link stays left to right inside the message.
    const link = surface.querySelector('bdi[dir="ltr"]');
    expect(link?.textContent).toBe(/https?:\/\/\S+/.exec(body)?.[0]);
    expect(String(surface.getAttribute("style"))).toContain(
      "IBM Plex Sans Arabic",
    );
  });

  test("Edit turns the same surface into a text field in place; Undo my edits puts the draft back", async () => {
    const { node } = card([st.draft]);
    const host = await mount(node);
    await click(named("Edit")[0]);
    const field = host.querySelector("[data-message] textarea");
    expect(field).toBeTruthy();
    expect(field.getAttribute("dir")).toBe("rtl");
    expect(field.value).toBe(fx.RECAP_BODY);
    expect(String(field.className)).toContain("border-s-2");
    expect(focused()).toBe(field);
    expect(page()).toContain("The saved text, unchanged.");
    await typeInto(field, `${fx.RECAP_BODY} `);
    expect(page()).toContain(`${[...fx.RECAP_BODY].length + 1} / 4,096`);
    await act(async () => named("Undo my edits")[0].focus());
    await click(named("Undo my edits")[0]);
    expect(host.querySelector("[data-message] textarea").value).toBe(
      fx.RECAP_BODY,
    );
    // The button goes with the edit: focus stays with the text, never the page.
    expect(named("Undo my edits")).toEqual([]);
    expect(focused()).toBe(host.querySelector("[data-message] textarea"));
    await click(named("Done editing")[0]);
    expect(host.querySelector("[data-message] textarea")).toBeNull();
  });
});

describe("approve, skip, reopen", () => {
  test("Approve and send sends the exact text seen, toasts, and moves focus to the state line", async () => {
    const { io, node } = card([st.draft]);
    const host = await mount(node);
    await click(named("Edit")[0]);
    const edited = `${fx.RECAP_BODY.split("\n\n")[0]}.\n\n${fx.RECAP_BODY.split("\n\n").slice(1).join("\n\n")}`;
    await typeInto(host.querySelector("[data-message] textarea"), edited);
    await click(named("Approve and send")[0]);
    const call = io.calls.find(c => c.name === "approve");
    expect(call?.args).toEqual({
      messageId: fx.MESSAGE_ID,
      body: edited,
      acceptWarnings: false,
    });
    expect(toasts).toContain("Approved. It sends within about 3 minutes.");
    expect(chip(host)).toBe("Approved");
    const status = host.querySelector("[data-message] p[tabindex='-1']");
    expect(focused()).toBe(status);
    expect(text(status)).toBe("Sends within about 3 minutes.");
    expect(page()).toContain("Approved by the CSM at 11:31.");
    // One live region per card says it once.
    expect(host.querySelectorAll('[role="status"]').length).toBe(1);
    expect(text(liveRegion(host))).toBe(
      "1-1 recap · call Sun 25 Oct: Sends within about 3 minutes.",
    );
  });

  test("warnings come first: shown under the surface, then Approve anyway or Edit", async () => {
    const warn = "The group already had a team message today.";
    const { io, node } = card([st.draft], { warn: [warn] });
    const host = await mount(node);
    await click(named("Approve and send")[0]);
    expect(io.calls.filter(c => c.name === "approve").length).toBe(1);
    expect(chip(host)).toBe("Waiting for you");
    expect(page()).toContain(`Check these before it goes: ${warn}`);
    expect(
      buttons(host.querySelector("[data-message]")).map(b => text(b)),
    ).toEqual(["Edit", "Approve anyway"]);
    expect(toasts).toEqual([]);
    await click(named("Approve anyway")[0]);
    expect(io.calls.filter(c => c.name === "approve").at(-1)?.args).toEqual({
      messageId: fx.MESSAGE_ID,
      body: fx.RECAP_BODY,
      acceptWarnings: true,
    });
    expect(chip(host)).toBe("Approved");
    // Edit from the warnings goes back to the field, focused.
    const again = card([{ ...st.draft, id: "w2" }], { warn: [warn] });
    const host2 = await mount(again.node);
    await click(named("Approve and send", host2)[0]);
    await click(named("Edit", host2)[0]);
    await settle();
    expect(focused()).toBe(host2.querySelector("textarea"));
    expect(text(host2.querySelector("[data-message]"))).not.toContain(
      "Check these before it goes",
    );
  });

  test("the check's refusal is said in its words, the edit kept, and nothing approved", async () => {
    const refusal =
      "The recap quoted a money figure. Client messages carry no amounts. Edit the text, then approve again.";
    const { node } = card([st.draft], { refuse: refusal });
    const host = await mount(node);
    await click(named("Edit")[0]);
    const field = host.querySelector("textarea");
    await typeInto(field, `${fx.RECAP_BODY}\n`);
    await click(named("Approve and send")[0]);
    const alert = host.querySelector('[role="alert"]');
    expect(text(alert)).toBe(refusal);
    // The alert says it; the card's live region does not say it again.
    expect(text(host.querySelector('[role="status"]'))).not.toContain(refusal);
    expect(host.querySelector("textarea").value).toBe(`${fx.RECAP_BODY}\n`);
    expect(chip(host)).toBe("Waiting for you");
    expect(toasts).toEqual([]);
    // The approve button carries the refusal as its description.
    const approve = named("Approve and send")[0];
    expect(String(approve.getAttribute("aria-describedby"))).toContain(
      alert.id,
    );
  });

  test("Skip: nothing is sent, the toast says so", async () => {
    const { io, node } = card([st.draft]);
    const host = await mount(node);
    await click(named("Skip")[0]);
    expect(io.calls.at(-1)).toEqual({ name: "skip", args: fx.MESSAGE_ID });
    expect(toasts).toContain("Skipped. Nothing was sent.");
    expect(chip(host)).toBe("Skipped");
    expect(focused()).toBe(
      host.querySelector("[data-message] p[tabindex='-1']"),
    );
  });

  test("a refused or failed message: Try again reopens it to edit; Skip closes it (Z55)", async () => {
    const { io, node } = card([st.failed]);
    const host = await mount(node);
    await click(named("Try again")[0]);
    expect(io.calls.at(-1)).toEqual({ name: "reopen", args: st.failed.id });
    expect(toasts).toContain("Reopened. Edit it, then approve it.");
    expect(chip(host)).toBe("Waiting for you");
    expect(host.querySelector("textarea")).toBeTruthy();
    const refused = card([{ ...st.refused, id: "r2" }]);
    const host2 = await mount(refused.node);
    await click(named("Skip", host2)[0]);
    expect(refused.io.calls.at(-1)).toEqual({ name: "skip", args: "r2" });
    expect(text(host2)).toContain("Skipped. Nothing was sent.");
  });

  test("an approved message: Edit again reopens it", async () => {
    const { io, node } = card([st.approved]);
    const host = await mount(node);
    await click(named("Edit again")[0]);
    expect(io.calls.at(-1)?.name).toBe("reopen");
    expect(chip(host)).toBe("Waiting for you");
  });

  test("while a call runs the buttons stay focusable and do nothing more", async () => {
    let release: () => void = () => {};
    const io = {
      ...fx.fakeMessages([st.draft]),
      skip: () =>
        new Promise<any>(r => {
          release = () => r({ ...st.draft, state: "skipped" });
        }),
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        clock={fx.fixtureClock()}
      />,
    );
    const actions = () =>
      Array.from(
        host.querySelectorAll(`[data-message="${st.draft.id}"] button`),
      ).filter((b: any) =>
        ["Edit", "Skip", "Skipping…", "Approve and send"].includes(
          (b.textContent ?? "").trim(),
        ),
      ) as any[];
    // At rest none is marked, so none is dimmed.
    expect(actions().length).toBe(3);
    for (const b of actions())
      expect(b.getAttribute("aria-disabled")).toBeNull();
    await click(named("Skip")[0]);
    const busy = named("Skipping…")[0];
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.disabled).toBe(false);
    expect(named("Approve and send")[0].getAttribute("aria-disabled")).toBe(
      "true",
    );
    // A press on another action while Skip runs is seen to do nothing: each
    // one dims and the pointer says no (ui/button styles only disabled:).
    expect(actions().length).toBe(3);
    for (const b of actions()) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(String(b.className)).toContain("aria-disabled:opacity-60");
      expect(String(b.className)).toContain("aria-disabled:cursor-not-allowed");
    }
    await click(named("Approve and send")[0]);
    expect(io.calls.some(c => c.name === "approve")).toBe(false);
    await act(async () => release());
    await settle();
    expect(chip(host)).toBe("Skipped");
  });

  test("an approved message is read again while it is on its way, until it is read back", async () => {
    let reads = 0;
    const base = fx.fakeMessages([st.approved]);
    const io = {
      ...base,
      read: async (taskId: string) => {
        reads += 1;
        const [m] = await base.read(taskId);
        return [
          reads === 1
            ? m
            : reads === 2
              ? { ...m, state: "sending" }
              : { ...st.sent, id: m.id },
        ];
      },
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        poll={{ every: 10, for: 60_000 }}
        clock={fx.fixtureClock()}
      />,
    );
    for (let i = 0; i < 20 && reads < 3; i++) await settle(2);
    await settle();
    expect(chip(host)).toBe("Sent");
    const after = reads;
    await settle(6);
    // Read back from WhatsApp: nothing left to change by itself.
    expect(reads).toBe(after);
  });
});

describe("the card's live region", () => {
  test("after an action it says the new line; once a read moves the row on, it says that line, never the old one", async () => {
    let sentNow = false;
    const base = fx.fakeMessages([st.draft]);
    const asSent = (m: any) => ({
      ...m,
      state: "sent",
      sentAt: st.sent.sentAt,
      readBack: st.sent.readBack,
      effectState: "delivered",
    });
    const io = {
      ...base,
      read: async (taskId: string) => {
        const rows = await base.read(taskId);
        return sentNow ? rows.map(asSent) : rows;
      },
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        poll={{ every: 10, for: 60_000 }}
        clock={fx.fixtureClock()}
      />,
    );
    await click(named("Approve and send")[0]);
    // Reads that find the row as the action left it keep the action's line.
    await settle(4);
    expect(chip(host)).toBe("Approved");
    expect(text(liveRegion(host))).toBe(
      "1-1 recap · call Sun 25 Oct: Sends within about 3 minutes.",
    );
    sentNow = true;
    for (let i = 0; i < 20 && chip(host) !== "Sent"; i++) await settle(2);
    expect(chip(host)).toBe("Sent");
    expect(text(liveRegion(host))).toBe(
      `1-1 recap · call Sun 25 Oct: ${stateLine(asSent(st.draft))}`,
    );
    expect(text(liveRegion(host))).not.toContain("Sends within");
    expect(host.querySelectorAll('[role="status"]').length).toBe(1);
  });
});

describe("Today's recap rows", () => {
  const waiting = [
    st.draft,
    {
      ...st.refused,
      id: "t2",
      taskId: "86exfix02",
      clientName: "Harbor Glassworks",
    },
    {
      ...st.unknown,
      id: "t3",
      taskId: "86exfix03",
      clientName: "Juniper Kitchens",
    },
  ];

  test("each sentence of 5.1, each opening the client's Messages card", async () => {
    const io = fx.fakeMessages([], { waiting });
    const host = await mount(<RecapsWaiting io={io} native />);
    expect(text(host.querySelector("h2"))).toBe("Client recaps3");
    const links = Array.from(host.querySelectorAll("a")) as any[];
    expect(links.map(a => text(a))).toEqual([
      "Recap waiting: Cedar & Stone Interiors. Read it, then approve or skip it.",
      "Recap not sent: Harbor Glassworks. No WhatsApp group on Client Data for this card. Add it to Client Data column F, then try again.",
      "Recap not confirmed: Juniper Kitchens. Look in the group before anything else.",
    ]);
    expect(links.map(a => a.getAttribute("href"))).toEqual([
      "/clients/86exfix01?tab=overview#messages",
      "/clients/86exfix02?tab=overview#messages",
      "/clients/86exfix03?tab=overview#messages",
    ]);
    // The name is isolated, so an Arabic name stays whole in the sentence.
    expect(links[0].querySelector("bdi")?.textContent).toBe(
      "Cedar & Stone Interiors",
    );
  });

  test("hidden when nothing waits and the read worked; a failed read is said once native", async () => {
    const none = await mount(
      <RecapsWaiting io={fx.fakeMessages([], { waiting: [] })} native />,
    );
    expect(none.innerHTML).toBe("");
    const failed = await mount(
      <RecapsWaiting
        io={fx.fakeMessages([], { readError: "Failed to fetch" })}
        native
      />,
    );
    expect(text(failed)).toContain(RECAPS_FAILED);
    const dark = await mount(
      <RecapsWaiting
        io={fx.fakeMessages([], { readError: "Failed to fetch" })}
        native={false}
      />,
    );
    expect(dark.innerHTML).toBe("");
  });
});

describe("the words and the shapes", () => {
  test("todayLine, messageLead and messagesPath", () => {
    expect(lib.todayLine({ ...st.failed, clientName: "City Wood" })).toBe(
      "Recap not sent: City Wood. WhatsApp answered 400. Check the group on Client Data.",
    );
    expect(
      lib.todayLine({ ...st.failed, reason: null, clientName: null }),
    ).toBe(
      "Recap not sent: this client. WhatsApp gave no reason. Try again, or skip it.",
    );
    expect(messageLead({ kind: "recap_checkin", callAt: null })).toBe(
      "1-1 recap",
    );
    expect(lib.messagesPath("86ex fix")).toBe(
      "/clients/86ex%20fix?tab=overview#messages",
    );
    expect(lib.messagesHref("86exfix01")).toBe(
      "/client-success/clients/86exfix01?tab=overview#messages",
    );
  });

  test("whatsappPieces: a single star around words is bold; a lone star or a spaced one is text", () => {
    expect(lib.whatsappPieces("*مرحبا* يا أخي")).toEqual([
      { text: "مرحبا", bold: true },
      { text: " يا أخي", bold: false },
    ]);
    expect(lib.whatsappPieces("2 * 3 = 6")).toEqual([
      { text: "2 * 3 = 6", bold: false },
    ]);
    expect(lib.whatsappPieces("a *b c* d")).toEqual([
      { text: "a ", bold: false },
      { text: "b c", bold: true },
      { text: " d", bold: false },
    ]);
    // Arabic punctuation on either side, the same as its Latin twin.
    expect(lib.whatsappPieces("*شلونك*؟ و *تمام*؛ و *زين*، ")).toEqual([
      { text: "شلونك", bold: true },
      { text: "؟ و ", bold: false },
      { text: "تمام", bold: true },
      { text: "؛ و ", bold: false },
      { text: "زين", bold: true },
      { text: "، ", bold: false },
    ]);
    expect(lib.whatsappPieces("؟*زين*")).toEqual([
      { text: "؟", bold: false },
      { text: "زين", bold: true },
    ]);
    expect(lib.whatsappPieces("؛*زين*")).toEqual([
      { text: "؛", bold: false },
      { text: "زين", bold: true },
    ]);
    // Rejoined, the pieces are the text without its bold stars.
    const body = fx.RECAP_BODY;
    expect(
      lib
        .whatsappPieces(body)
        .map(p => p.text)
        .join(""),
    ).toBe(body);
  });

  test("MessageView parses 3.7 and never needs the claim token or the provider's id", () => {
    const parsed = lib.messageView.parse({
      ...st.sent,
      claimToken: "never-shown",
    });
    expect(parsed).not.toHaveProperty("claimToken");
    expect(parsed).not.toHaveProperty("providerId");
    expect(() =>
      lib.messageView.parse({ ...st.sent, state: "posted" }),
    ).toThrow();
  });

  test("each RPC names its function and arguments; a list comes bare or under messages; not live is plain", async () => {
    const asked: any[] = [];
    let answer: any = [st.draft];
    const client = {
      rpc: async (fn: string, args?: any) => {
        asked.push([fn, args]);
        if (fn === "cockpit_client_message_skip")
          return {
            data: { message: { ...st.draft, state: "skipped" } },
            error: null,
          };
        if (
          fn === "cockpit_client_message_reopen" ||
          fn === "cockpit_client_message_read"
        )
          return { data: st.draft, error: null };
        return { data: answer, error: null };
      },
    } as any;
    expect((await lib.readClientMessages(client, "86exfix01")).length).toBe(1);
    answer = { messages: [st.draft, st.sent], now: fx.NOW };
    expect((await lib.readMessagesWaiting(client)).length).toBe(2);
    expect((await lib.skipClientMessage(client, "m1")).state).toBe("skipped");
    await lib.reopenClientMessage(client, "m1");
    await lib.readClientMessage(client, "m1");
    expect(asked).toEqual([
      ["cockpit_client_messages_read", { p_task_id: "86exfix01" }],
      ["cockpit_client_messages_waiting", undefined],
      ["cockpit_client_message_skip", { p_id: "m1", p_reason: null }],
      ["cockpit_client_message_reopen", { p_id: "m1" }],
      ["cockpit_client_message_read", { p_id: "m1" }],
    ]);
    const missing = {
      rpc: async () => ({
        data: null,
        error: {
          message:
            "Could not find the function public.cockpit_client_messages_read",
          code: "PGRST202",
        },
      }),
    } as any;
    await expect(lib.readClientMessages(missing, "86exfix01")).rejects.toThrow(
      lib.NOT_LIVE,
    );
    await expect(
      lib.readClientMessages(
        { rpc: async () => ({ data: { nope: 1 }, error: null }) } as any,
        "86exfix01",
      ),
    ).rejects.toThrow("came back in a shape this page does not read");
  });

  test("approveRecap posts op recap.approve with the text, and acceptWarnings only when asked", async () => {
    const bodies: any[] = [];
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { id: "seat-1" } },
          error: null,
        }),
        getSession: async () => ({
          data: { session: { user: { id: "seat-1" } } },
          error: null,
        }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
      rpc: async () => ({ data: null, error: null }),
      functions: {
        invoke: async (fn: string, { body }: any) => {
          bodies.push([fn, body]);
          return bodies.length === 1
            ? { data: { needsConfirm: true, warnings: ["W."] }, error: null }
            : { data: { message: st.approved, warnings: [] }, error: null };
        },
      },
    } as any;
    const first = await approveRecap(client, fx.MESSAGE_ID, "نص", false);
    expect(first).toEqual({ needsConfirm: true, warnings: ["W."] });
    const second = await approveRecap(client, fx.MESSAGE_ID, "نص", true);
    expect("message" in second && second.message.state).toBe("approved");
    expect(bodies).toEqual([
      [
        "cockpit-forms-api",
        { op: "recap.approve", messageId: fx.MESSAGE_ID, body: "نص" },
      ],
      [
        "cockpit-forms-api",
        {
          op: "recap.approve",
          messageId: fx.MESSAGE_ID,
          body: "نص",
          acceptWarnings: true,
        },
      ],
    ]);
    // Never a seat ID from the browser: the door takes the verified actor.
    expect(JSON.stringify(bodies)).not.toMatch(/actor|p_actor|seat-1/);
  });

  test("useClientMessages is exported for the window and keeps the shape of a read", () => {
    expect(typeof useClientMessages).toBe("function");
    expect(typeof RecapApproval).toBe("function");
  });
});

/** The fixtures' clock moved on by this long, on real timers. */
const later = (ms: number) => {
  const c = fx.fixtureClock();
  return { ...c, now: () => c.now() + ms };
};
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("a row that outlives its promise (5.1's added lines)", () => {
  const line = (host: any) =>
    text(host.querySelector("[data-message] p[tabindex='-1']"));

  test("the reads stop while a row can still move: the row stays and says so", async () => {
    let reads = 0;
    const base = fx.fakeMessages([st.approved]);
    const io = {
      ...base,
      read: async (taskId: string) => {
        reads += 1;
        return reads > 2
          ? [{ ...st.sent, id: st.approved.id }]
          : base.read(taskId);
      },
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        poll={{ every: 10, for: 0 }}
        clock={fx.fixtureClock()}
      />,
    );
    for (let i = 0; i < 10 && !page().includes("stopped checking"); i++)
      await settle(2);
    expect(chip(host)).toBe("Approved");
    expect(page()).toContain(
      "This page stopped checking. Reload it to see where the recap stands.",
    );
    // One live region says it too.
    expect(text(liveRegion(host))).toBe(RECAP_WORDS.stoppedChecking);
    const stopped = reads;
    await settle(6);
    expect(reads).toBe(stopped);
  });

  test("the stop line is only for a row that can still move, and an action reads again", async () => {
    const io = fx.fakeMessages([st.draft, st.approved]);
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io}
        poll={{ every: 10, for: 0 }}
        clock={fx.fixtureClock()}
      />,
    );
    for (let i = 0; i < 10 && !page().includes("stopped checking"); i++)
      await settle(2);
    expect(page().split("stopped checking").length - 1).toBe(2); // Row, region.
    const rows = host.querySelectorAll("[data-message]");
    expect(text(rows[0])).not.toContain("stopped checking");
    expect(text(rows[1])).toContain("stopped checking");
  });

  test("approved over 15 minutes ago: the 3-minute promise goes, the time and the next step come", async () => {
    const { node } = card([st.approved]);
    await mount(node);
    expect(page()).toContain(RECAP_WORDS.approved);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={fx.fakeMessages([st.approved])}
        clock={later(20 * MIN)}
      />,
    );
    expect(line(host)).toBe(
      "Approved at 11:29 and not sent yet. Tell the tech lead if it stays.",
    );
    expect(page()).not.toContain("Sends within");
    // Who approved it stays; the time is said once.
    expect(page()).toContain("Approved by the CSM.");
    // Its Edit again is still there.
    expect(named("Edit again").length).toBe(1);
    // The table's own line when no clock is given.
    expect(stateLine(st.approved)).toBe(RECAP_WORDS.approved);
  });

  test("sent and not read back for over 24 hours: nothing is checking any more, and nothing reads it again", async () => {
    const m = st["sent-checking"];
    const clock = later(25 * HOUR);
    expect(stateLine(m, clock.now())).toBe(
      "Sent at Sun 25 Oct 11:29. WhatsApp's copy was not found. Look in the group if it matters.",
    );
    expect(onItsWay(m, clock.now())).toBe(false);
    // Under the 24 hours it is still being looked for.
    expect(onItsWay(m, later(23 * HOUR).now())).toBe(true);
    expect(stateLine(m, later(23 * HOUR).now())).toBe(
      "Sent at 11:29. Checking it arrived…",
    );
    // A send read back is never this line.
    expect(stateLine(st.sent, clock.now())).toContain(
      "Read back from WhatsApp",
    );
    const io = fx.fakeMessages([m]);
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io}
        poll={{ every: 5, for: 60_000 }}
        clock={clock}
      />,
    );
    expect(line(host)).toContain("WhatsApp's copy was not found");
    await settle(6);
    expect(io.calls.filter(c => c.name === "read").length).toBe(1);
    expect(page()).not.toContain("stopped checking");
  });

  test("a recap a person saw in the group never claims WhatsApp's copy was read back", async () => {
    const m = {
      ...st.sent,
      readBack: { by: "person", at: "2026-10-25T10:02:00Z" },
    };
    const words = stateLine(m, later(25 * HOUR).now());
    expect(words).toBe(
      "Sent at 11:26. Seen in the group by a person at 13:02.",
    );
    expect(words).not.toContain("WhatsApp");
    expect(onItsWay(m, later(25 * HOUR).now())).toBe(false);
    // The sender's own read keeps its own words.
    expect(stateLine(st.sent)).toContain("Read back from WhatsApp at");
    const io = fx.fakeMessages([m]);
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io}
        poll={{ every: 5, for: 60_000 }}
        clock={later(25 * HOUR)}
      />,
    );
    expect(line(host)).toContain("Seen in the group by a person at 13:02.");
    await settle(6);
    expect(io.calls.filter(c => c.name === "read").length).toBe(1);
  });

  test("a read sent before an action and answered after it never steps the row back", async () => {
    const base = fx.fakeMessages([st.draft, st.sending]);
    const held: (() => void)[] = [];
    let holding = false;
    const io = {
      ...base,
      read: async (taskId: string) => {
        const rows = await base.read(taskId);
        if (holding) await new Promise<void>(r => held.push(r));
        return rows;
      },
    };
    // Once a read is held no further read goes out, so only the held one can
    // land after the approve.
    let frozen = false;
    const c = fx.fixtureClock();
    const clock = {
      ...c,
      set: (fn: () => void, ms: number) => (frozen ? 0 : c.set(fn, ms)),
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        poll={{ every: 5, for: 60_000 }}
        clock={clock}
      />,
    );
    expect(named("Approve and send").length).toBe(1);
    // The next poll's read goes out with the row still a draft, and holds.
    holding = true;
    for (let i = 0; i < 20 && !held.length; i++) await settle(1);
    expect(held.length).toBe(1);
    frozen = true;
    holding = false;
    await click(named("Approve and send")[0]);
    expect(chip(host)).toBe("Approved");
    await act(async () => {
      for (const r of held.splice(0)) r();
    });
    await settle(2);
    // The older read's draft is dropped: the approve's row stands.
    expect(chip(host)).toBe("Approved");
    expect(named("Approve and send")).toEqual([]);
  });
});

describe("an action that never answers (no button rests for ever)", () => {
  /** Real timers, with the deadline shortened and recorded. */
  const short = (waited: number[]) => {
    const c = fx.fixtureClock();
    return {
      ...c,
      set: (fn: () => void, ms: number) => {
        waited.push(ms);
        return c.set(fn, ms === lib.ACTION_DEADLINE_MS ? 10 : ms);
      },
    };
  };
  const never = () => new Promise<never>(() => {});
  const cases: [string, string, string, any, string][] = [
    [
      "Approve and send",
      "approve",
      "Approving…",
      st.draft,
      lib.NO_ANSWER.approve,
    ],
    ["Skip", "skip", "Skipping…", st.draft, lib.NO_ANSWER.skip],
    ["Edit again", "reopen", "Reopening…", st.approved, lib.NO_ANSWER.reopen],
  ];
  for (const [press, op, busy, row, said] of cases)
    test(`${press}: the wait ends and says what is known, and nothing is pressed again`, async () => {
      expect(lib.ACTION_DEADLINE_MS).toBe(30_000);
      let calls = 0;
      const io = {
        ...fx.fakeMessages([row]),
        [op]: () => {
          calls += 1;
          return never();
        },
      };
      const waited: number[] = [];
      const host = await mount(
        <ClientMessages
          taskId={fx.TASK}
          native
          io={io as any}
          poll={{ every: 60_000, for: 60_000 }}
          clock={short(waited)}
        />,
      );
      await act(async () => {
        named(press)[0].dispatchEvent(
          new win.MouseEvent("click", { bubbles: true }),
        );
      });
      // Busy at first, in its own word; then the deadline ends it.
      expect(page()).toContain(busy);
      for (let i = 0; i < 10 && !page().includes(said); i++) await settle(1);
      expect(waited).toContain(lib.ACTION_DEADLINE_MS);
      expect(text(host.querySelector('[role="alert"]'))).toBe(said);
      expect(page()).not.toContain(busy);
      expect(named(press).length).toBe(1);
      expect(named(press)[0].getAttribute("aria-disabled")).toBeNull();
      // Never retried by itself.
      expect(calls).toBe(1);
    });

  test("a first read that never answers: the card leaves its loading line and says what to do next", async () => {
    const waited: number[] = [];
    const io = { ...fx.fakeMessages([]), read: never };
    await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        clock={short(waited)}
      />,
    );
    for (let i = 0; i < 10 && !page().includes(MESSAGES_FAILED); i++)
      await settle(1);
    expect(waited).toContain(lib.ACTION_DEADLINE_MS);
    expect(page()).toContain(MESSAGES_FAILED);
    expect(page()).not.toContain("Reading the messages");
    // A read with no answer is not an empty list.
    expect(page()).not.toContain(MESSAGES_EMPTY);
  });

  test("a later read that never answers: the rows stay, the sentence comes, and the next read still goes", async () => {
    let reads = 0;
    const base = fx.fakeMessages([st.approved]);
    const io = {
      ...base,
      read: (taskId: string) => {
        reads += 1;
        return reads === 2 ? never() : base.read(taskId);
      },
    };
    const host = await mount(
      <ClientMessages
        taskId={fx.TASK}
        native
        io={io as any}
        poll={{ every: 10, for: 60_000 }}
        clock={short([])}
      />,
    );
    for (let i = 0; i < 40 && reads < 3; i++) await settle(1);
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(chip(host)).toBe("Approved");
  });

  test("Today's recaps that never answer: said once native, never a card that looks empty", async () => {
    const io = { ...fx.fakeMessages([]), waiting: never };
    const host = await mount(
      <RecapsWaiting io={io as any} native clock={short([])} />,
    );
    for (let i = 0; i < 10 && !page().includes(RECAPS_FAILED); i++)
      await settle(1);
    expect(text(host)).toContain(RECAPS_FAILED);
    const dark = await mount(
      <RecapsWaiting io={io as any} native={false} clock={short([])} />,
    );
    await settle(4);
    expect(dark.innerHTML).toBe("");
  });

  test("answerBy: the answer or the refusal comes first, whichever it is, and clears its timer", async () => {
    const timers = new Set<number>();
    let n = 0;
    const timer = {
      set: (fn: () => void, _ms: number) => {
        n += 1;
        timers.add(n);
        if (_ms === 1) fn();
        return n;
      },
      clear: (h: unknown) => {
        timers.delete(h as number);
      },
    };
    expect(await lib.answerBy(Promise.resolve(7), 30_000, timer, "late")).toBe(
      7,
    );
    expect(timers.size).toBe(0);
    await expect(
      lib.answerBy(Promise.reject(Error("refused")), 30_000, timer, "late"),
    ).rejects.toThrow("refused");
    expect(timers.size).toBe(0);
    await expect(
      lib.answerBy(never(), 1, timer, "No answer came back."),
    ).rejects.toThrow("No answer came back.");
  });

  test("a failed fetch never claims nothing changed: the answer may have been lost after it landed", async () => {
    const client: any = {
      rpc: async () => ({ data: null, error: { message: "Failed to fetch" } }),
    };
    const said =
      "The connection dropped, so this may not have saved. Reload the page to see where it stands.";
    await expect(lib.skipClientMessage(client, "x")).rejects.toThrow(said);
    await expect(lib.reopenClientMessage(client, "x")).rejects.toThrow(said);
  });

  describe("an approval through the window's door speaks about the recap", () => {
    const seat = {
      getUser: async () => ({ data: { user: { id: "seat-1" } }, error: null }),
      getSession: async () => ({
        data: { session: { user: { id: "seat-1" } } },
        error: null,
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    };
    const approveWith = (invoke: () => Promise<any>) =>
      messagesIO({
        auth: seat,
        rpc: async () => ({ data: null, error: null }),
        functions: { invoke },
      } as any).approve({
        messageId: fx.MESSAGE_ID,
        body: "نص",
        acceptWarnings: false,
      });

    test("a dropped connection: the approval may have landed, and where to look", async () => {
      await expect(
        approveWith(async () => ({
          data: null,
          error: Object.assign(Error("Failed to send a request"), {
            name: "FunctionsFetchError",
          }),
        })),
      ).rejects.toThrow(lib.NO_ANSWER.approve);
    });

    test("a door that is not there yet: approving is not live, never the 1-1 notes", async () => {
      const out = approveWith(async () => ({
        data: null,
        error: Object.assign(Error("Function not found"), {
          name: "FunctionsHttpError",
          context: new Response("{}", { status: 404 }),
        }),
      }));
      await expect(out).rejects.toThrow(lib.NOT_LIVE);
      // The card and the window read this as "not live" by its exact words.
      expect(lib.notLive(await out.catch(e => e))).toBe(true);
    });

    test("an answer it cannot read: the messages' own sentence", async () => {
      await expect(
        approveWith(async () => ({ data: { nothing: true }, error: null })),
      ).rejects.toThrow(lib.MESSAGES_SHAPE);
    });

    test("the check's own sentence passes through unchanged", async () => {
      const said =
        "The recap names a cost per lead. Edit the text, then approve again.";
      await expect(
        approveWith(async () => ({
          data: null,
          error: Object.assign(Error("Edge Function returned non-2xx"), {
            name: "FunctionsHttpError",
            context: new Response(JSON.stringify({ error: said }), {
              status: 400,
            }),
          }),
        })),
      ).rejects.toThrow(said);
    });
  });
});

describe("the state line", () => {
  /** A row whose props a test can change after it is on the page. */
  async function swappable(start: any, io: any) {
    let swap: (m: any) => void = () => {};
    function Row() {
      const [m, setM] = useState(start);
      swap = setM;
      return (
        <RecapApproval
          message={m}
          io={io}
          onChange={() => {}}
          clock={fx.fixtureClock()}
        />
      );
    }
    const host = await mount(<Row />);
    return { host, swap: (m: any) => act(async () => swap(m)) };
  }
  const SAID = "This recap is being sent now, so it cannot be reopened.";
  const refusing = () => ({
    ...fx.fakeMessages([st.approved]),
    reopen: async () => {
      throw new lib.MessageError(SAID);
    },
  });

  test("an action's error goes once the row has moved on, and the row's own line speaks alone", async () => {
    const { host, swap } = await swappable(st.approved, refusing());
    await click(named("Edit again")[0]);
    expect(text(host.querySelector('[role="alert"]'))).toBe(SAID);
    await swap({
      ...st.sent,
      id: st.approved.id,
      sentAt: "2026-10-25T10:01:00Z",
      readBack: { by: "message_id", at: "2026-10-25T10:02:00Z" },
    });
    await settle(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(page()).not.toContain(SAID);
    expect(page()).toContain("Sent at 13:01.");
  });

  test("a new text with the state unchanged keeps the error", async () => {
    const { host, swap } = await swappable(st.approved, refusing());
    await click(named("Edit again")[0]);
    await swap({ ...st.approved, body: `${st.approved.body} ` });
    await settle(2);
    expect(text(host.querySelector('[role="alert"]'))).toBe(SAID);
  });

  test("clock times are Geist Mono 11 tabular; the words and what the region says do not change", async () => {
    const sent = {
      ...st.sent,
      sentAt: "2026-10-25T10:01:00Z",
      readBack: { by: "message_id", at: "2026-10-25T10:02:00Z" },
    };
    const { host } = await swappable(sent, fx.fakeMessages([sent]));
    const line = host.querySelector("[data-message] p[tabindex='-1']");
    const clocks = Array.from(line.querySelectorAll("span.font-mono")) as any[];
    expect(clocks.map(c => c.textContent)).toEqual(["13:01", "13:02"]);
    for (const c of clocks) {
      expect(String(c.className)).toContain("text-[11px]");
      expect(String(c.className)).toContain("tabular-nums");
    }
    expect(text(line)).toBe(stateLine(sent));
    expect(stateLine(sent)).toBe(
      "Sent at 13:01. Read back from WhatsApp at 13:02.",
    );
  });

  test("the late-approval line draws its clock the same way", async () => {
    const m = { ...st.approved, approvedAt: "2026-10-25T08:29:00Z" };
    const clock = later(20 * MIN);
    const host = await mount(
      <RecapApproval
        message={m}
        io={fx.fakeMessages([m])}
        onChange={() => {}}
        clock={clock}
      />,
    );
    const line = host.querySelector("[data-message] p[tabindex='-1']");
    expect(text(line)).toBe(stateLine(m, clock.now()));
    expect(line.querySelector("span.font-mono")?.textContent).toBe("11:29");
  });
});

describe("a row where Skip is all that is left", () => {
  const SPENT = lib.TRIES_USED_UP;

  test("tries spent: no Try again, whatever the reason says, and Skip closes it", async () => {
    const refused = {
      ...st.refused,
      reason: "WhatsApp answered 400.",
      triesUsedUp: true,
    };
    expect(stateLine(refused)).toBe(`WhatsApp answered 400. ${SPENT}`);
    expect(stateLine({ ...refused, reason: null })).toBe(SPENT);
    // The sender's own sentence already says it: not said twice.
    expect(stateLine(st["tries-used-up"])).toBe(SPENT);
    expect(lib.todayLine({ ...refused, clientName: "City Wood" })).toBe(
      `Recap not sent: City Wood. WhatsApp answered 400. ${SPENT}`,
    );
    const { io, node } = card([refused]);
    const host = await mount(node);
    expect(named("Try again", host).length).toBe(0);
    await click(named("Skip", host)[0]);
    expect(io.calls.at(-1)).toEqual({ name: "skip", args: refused.id });
    expect(chip(host)).toBe("Skipped");
  });

  test("a draft reopened before the tries ran out reads the same, with no field and no approval", async () => {
    const draft = { ...st.draft, triesUsedUp: true };
    expect(lib.todayLine({ ...draft, clientName: "City Wood" })).toBe(
      `Recap not sent: City Wood. ${SPENT}`,
    );
    const { node } = card([draft]);
    const host = await mount(node);
    const row = host.querySelector("[data-message]");
    expect(buttons(row).map(b => text(b))).toEqual(["Skip"]);
    expect(Boolean(row.querySelector("textarea"))).toBe(false);
    expect(Boolean(row.querySelector('[dir="rtl"][lang="ar"]'))).toBe(true);
  });

  test("a row still on its tries keeps Try again, and a row with the flag missing too", async () => {
    for (const triesUsedUp of [false, null]) {
      const { node } = card([{ ...st.failed, triesUsedUp }]);
      const host = await mount(node);
      expect(named("Try again", host).length).toBe(1);
    }
    expect(
      lib.messageView.parse({ ...st.failed, triesUsedUp: undefined })
        .triesUsedUp,
    ).toBeNull();
    expect(
      lib.messageView.parse({ ...st.failed, triesUsedUp: true }).triesUsedUp,
    ).toBe(true);
  });

  test("a draft Make owns again: its line, Skip alone, the chip as it was, and Today says the same", async () => {
    const back = st["handed-back"];
    expect(lib.handedBack(back)).toBe(true);
    expect(lib.handedBack(st.draft)).toBe(false);
    // No owner read: nothing is claimed about who sends it.
    expect(lib.handedBack({ ...back, owner: null })).toBe(false);
    expect(lib.todayLine({ ...back, clientName: "City Wood" })).toBe(
      `Recap waiting: City Wood. ${lib.MAKE_AGAIN}`,
    );
    const { io, node } = card([back]);
    const host = await mount(node);
    const row = host.querySelector("[data-message]");
    expect(chip(host)).toBe("Waiting for you");
    expect(buttons(row).map(b => text(b))).toEqual(["Skip"]);
    expect(Boolean(row.querySelector("textarea"))).toBe(false);
    const line = row.querySelector("p[tabindex='-1']");
    expect(String(line.className)).not.toContain("text-muted-foreground");
    await click(named("Skip", host)[0]);
    expect(io.calls.at(-1)).toEqual({ name: "skip", args: back.id });
    expect(io.calls.some(c => c.name === "approve")).toBe(false);
  });

  test("the rollback lands while she is editing: the field goes, the stored text is what shows", async () => {
    const io = fx.fakeMessages([st.draft]);
    const clock = fx.fixtureClock();
    let row = st.draft;
    const put: { set: (m: any) => void } = { set: () => {} };
    function Host() {
      const [m, set] = useState(row);
      put.set = set;
      return (
        <RecapApproval
          message={m}
          io={io}
          onChange={next => {
            row = next;
          }}
          clock={clock}
        />
      );
    }
    const host = await mount(<Host />);
    await click(named("Edit", host)[0]);
    await typeInto(host.querySelector("textarea"), "my own words");
    await act(async () => put.set(st["handed-back"]));
    await settle();
    expect(Boolean(host.querySelector("textarea"))).toBe(false);
    expect(text(host)).not.toContain("my own words");
    expect(buttons(host).map(b => text(b))).toEqual(["Skip"]);
  });
});

describe("the text rests while its approval runs (5.1's signature)", () => {
  /** An approval the test answers when it wants to. */
  function held(answer: () => any) {
    const posted: any[] = [];
    let release = () => {};
    const io = {
      ...fx.fakeMessages([st.draft]),
      approve: (a: any) =>
        new Promise<any>(r => {
          posted.push(a);
          release = () => r(answer());
        }),
    };
    return { io, posted, release: () => release() };
  }

  test("typing does nothing while Approve runs, so Approve anyway posts what the warnings were about", async () => {
    const warn = "The group already had a team message today.";
    const h = held(() => ({ needsConfirm: true, warnings: [warn] }));
    const host = await mount(
      <RecapApproval
        message={st.draft}
        io={h.io as any}
        onChange={() => {}}
        clock={fx.fixtureClock()}
      />,
    );
    await click(named("Edit", host)[0]);
    const field = () => host.querySelector("textarea");
    await typeInto(field(), "the words she read");
    expect(field().readOnly).toBe(false);
    await click(named("Approve and send", host)[0]);
    expect(h.posted[0].body).toBe("the words she read");
    // Focus stays in the field: it rests, it is not disabled.
    expect(field().readOnly).toBe(true);
    expect(field().disabled).toBe(false);
    await typeInto(field(), "a later word about a warranty");
    expect(field().value).toBe("the words she read");
    await act(async () => h.release());
    await settle();
    expect(page()).toContain(warn);
    await click(named("Approve anyway", host)[0]);
    expect(h.posted[1]).toMatchObject({
      body: "the words she read",
      acceptWarnings: true,
    });
  });

  test("Undo my edits rests too, and stays where focus is", async () => {
    const h = held(() => ({ message: { ...st.draft, state: "approved" } }));
    const host = await mount(
      <RecapApproval
        message={st.draft}
        io={h.io as any}
        onChange={() => {}}
        clock={fx.fixtureClock()}
      />,
    );
    await click(named("Edit", host)[0]);
    await typeInto(host.querySelector("textarea"), "the words she read");
    const undo = () => named("Undo my edits", host)[0];
    expect(undo().getAttribute("aria-disabled")).toBeNull();
    await click(named("Approve and send", host)[0]);
    expect(undo().getAttribute("aria-disabled")).toBe("true");
    expect(undo().disabled).toBe(false);
    await click(undo());
    expect(host.querySelector("textarea").value).toBe("the words she read");
    await act(async () => h.release());
    await settle();
    expect(h.posted[0].body).toBe("the words she read");
  });
});
