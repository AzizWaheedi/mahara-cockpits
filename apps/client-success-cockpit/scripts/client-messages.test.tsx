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
const { act } = await import("react");
const { MemoryRouter } = await import("react-router");
const {
  ClientMessages,
  RecapsWaiting,
  MESSAGES_EMPTY,
  MESSAGES_FAILED,
  RECAPS_FAILED,
  useClientMessages,
} = await import("../src/components/ClientMessages");
const { RecapApproval, RECAP_WORDS, stateLine, messageLead } = await import(
  "../src/forms/RecapApproval"
);
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
    node: <ClientMessages taskId={fx.TASK} native={native} io={io} />,
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
    await click(named("Undo my edits")[0]);
    expect(host.querySelector("[data-message] textarea").value).toBe(
      fx.RECAP_BODY,
    );
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
      <ClientMessages taskId={fx.TASK} native io={io as any} />,
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
