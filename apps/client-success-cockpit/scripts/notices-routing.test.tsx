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
 * Settings, Notices and routing (src/components/NoticesRouting.tsx;
 * docs/forms/STAGE1-CONTRACT.md 6.3, PLAN.md D17): every notice as one
 * sentence, read only for a viewer and editable for an editor (the switch,
 * the channel, who is tagged, Save, Send a test to me), the channels with
 * their checks, who may change these, and every refusal under the control
 * that caused it, in the server's words. The RPCs are a stand-in in memory
 * that refuses the way the database does; nothing reaches Slack.
 *
 * Run: bun test scripts/notices-routing.test.tsx
 */

// Let async React acts settle before the shared fixture is torn down.
// A five-second cancellation can contaminate every following UI test.
setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/settings",
  width: 1280,
  height: 900,
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLDetailsElement",
  "HTMLInputElement",
  "HTMLFormElement",
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
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { NoticesRouting, noticeSentence, joinWords } = await import(
  "../src/components/NoticesRouting"
);
const { fakeNoticesIO, settingsReadFixture } = await import(
  "../src/dev/noticesFixtures"
);
const {
  NoticeError,
  readNoticeSettings,
  setNoticeSetting,
  readNotices,
  readProblem,
  noticeStop,
} = await import("../src/lib/notices");

const hosts: { root: ReturnType<typeof createRoot> }[] = [];
async function draw(el: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  hosts.push({ root });
  await act(async () => root.render(el));
  await flush();
  return host as any;
}
const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  });
const wait = (ms: number) =>
  act(async () => {
    await new Promise(r => setTimeout(r, ms));
  });
// The card reads again on its own timer: wait for what that read shows, up
// to two seconds, not a fixed time a busy machine can overrun.
const waitFor = async (shown: () => boolean, ms = 2000) => {
  for (const end = Date.now() + ms; !shown() && Date.now() < end; )
    await wait(20);
};
// The sender's minute, held by the test: until release(), the card's own
// re-reads (every 20 ms here) find what the last change left, so a busy
// machine cannot post a test or finish a channel check between two steps.
function heldIO(start: ReturnType<typeof settingsReadFixture>) {
  const io = fakeNoticesIO(start, { settleAfterReads: 1 });
  const { read, set, addChannel, removeChannel } = io;
  let held = true;
  let last = start;
  const keep =
    <A extends unknown[]>(f: (...a: A) => Promise<typeof start>) =>
    async (...a: A) => {
      last = await f(...a);
      return last;
    };
  return Object.assign(io, {
    read: () => (held ? Promise.resolve(last) : read()),
    set: keep(set),
    addChannel: keep(addChannel),
    removeChannel: keep(removeChannel),
    release: () => {
      held = false;
    },
  });
}
const text = (el: any) => String(el?.textContent ?? "").replace(/\s+/g, " ");
const row = (host: any, kind: string) =>
  host.querySelector(`li[data-kind="${kind}"]`);
const buttonIn = (el: any, words: string) =>
  Array.from(el.querySelectorAll("button")).find((b: any) =>
    String(b.textContent ?? "").includes(words),
  ) as any;
const click = (el: any) =>
  act(async () => {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
async function type(input: any, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    set?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  for (const h of hosts.splice(0)) await act(async () => h.root.unmount());
  win.document.body.innerHTML = "";
  toasts.length = 0;
});
afterAll(async () => {
  await win.happyDOM.close();
});

describe("each notice reads as one sentence", () => {
  test("posts, replies, variants, tags, a seat with nobody in it, off", () => {
    const read = settingsReadFixture();
    const by = (k: string) => read.notices.find(n => n.kind === k) as any;
    expect(noticeSentence(by("kickoff"))).toBe(
      "Posts in #csm-general and tags the creative director.",
    );
    expect(noticeSentence(by("kickoff.late"))).toBe(
      "Tags the CSM and the systems manager.",
    );
    expect(noticeSentence(by("kickoff.updated"))).toBe(
      "Replies in the first notice's thread and tags nobody.",
    );
    expect(noticeSentence(by("blueprint.media"))).toBe(
      "Posts in #media-general and tags nobody.",
    );
    expect(noticeSentence(by("blueprint.updated"))).toBe("Off.");
    expect(noticeSentence(by("blueprint.offer"))).toBe(
      "Replies in the first notice's thread and tags the systems manager (nobody is in that seat).",
    );
    // A named person reads as their role, as the Slack text names them,
    // with what the sender's check says (X4); never a first name here.
    expect(noticeSentence(by("blueprint.close"))).toBe(
      "Posts in #csm-general and tags the CSM and the project manager (checking Slack).",
    );
    const close = by("blueprint.close");
    const person = (slack: string, slackKnown = false) =>
      noticeSentence({
        ...close,
        mentionRule: [],
        mentionPeople: [{ ...close.mentionPeople[0], slack, slackKnown }],
      });
    expect(person("ok", true)).toBe(
      "Posts in #csm-general and tags the project manager.",
    );
    expect(person("not_found")).toBe(
      "Posts in #csm-general and tags the project manager (not found in Slack, so written as plain text).",
    );
    expect(person("unchecked")).toBe(
      "Posts in #csm-general and tags the project manager (looked up in Slack when it posts).",
    );
    const seat = (t: Record<string, boolean>) =>
      noticeSentence({
        ...close,
        mentionPeople: [],
        tags: [
          {
            rule: "seat:csm",
            found: true,
            slackKnown: false,
            checking: false,
            ...t,
          },
        ],
      });
    expect(seat({ checking: true })).toBe(
      "Posts in #csm-general and tags the CSM (checking Slack).",
    );
    expect(seat({})).toBe(
      "Posts in #csm-general and tags the CSM (looked up in Slack when it posts).",
    );
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("read only", () => {
  test("a viewer sees the eight sentences, their last stops, and who may change them", async () => {
    const read = settingsReadFixture({ edit: false });
    const host = await draw(
      <NoticesRouting io={fakeNoticesIO(read)} initial={read} />,
    );
    const t = text(host);
    expect(t).toContain("Notices and routing");
    expect(t).toContain(
      "Where the cockpit posts in Slack when a kickoff or a Brand Blueprint is done, and who it tags. A change applies to the next notice.",
    );
    const labels = Array.from(host.querySelectorAll("li[data-kind] h3")).map(
      (h: any) => h.textContent,
    );
    expect(labels).toEqual([
      "Kickoff complete",
      "Kickoff late",
      "Second kickoff",
      "Kickoff card updated",
      "Brand Blueprint closed",
      "Brand Blueprint completed, for media",
      "Blueprint card confirmed",
      "Offer locked",
    ]);
    expect(text(row(host, "kickoff"))).toContain(
      "Posts in #csm-general and tags the creative director.",
    );
    expect(text(row(host, "kickoff"))).toContain(
      "Posts when Make has updated the card.",
    );
    expect(text(row(host, "kickoff"))).toContain(
      "Last: posted in #csm-general on",
    );
    expect(text(row(host, "kickoff"))).toContain(
      "Changed by the systems manager",
    );
    // One label, the stop's own; the lead in the warning tone, the reason plain.
    expect(text(row(host, "blueprint.close"))).toContain(
      "Last: not posted in #csm-general. Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
    );
    expect(
      row(host, "blueprint.close").querySelector(".txt-warn")?.textContent,
    ).toBe("not posted in #csm-general.");
    // Staff by role for a viewer: no first name anywhere on the card.
    expect(text(host)).not.toContain("Rana");
    expect(text(row(host, "blueprint.close"))).toContain(
      "the project manager (checking Slack)",
    );
    expect(text(row(host, "kickoff.updated"))).toContain(
      "No notice of this kind has gone out yet.",
    );
    expect(text(row(host, "kickoff.late"))).toContain("Always on");
    expect(t).toContain(
      "Only the CEO, an admin or someone they add can change these.",
    );
    // No control to change anything, no channel list, no editors.
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect(buttonIn(host, "Save")).toBeUndefined();
    expect(buttonIn(host, "Send a test to me")).toBeUndefined();
    expect(t).not.toContain("Channels");
    expect(t).not.toContain("Who can change these");
    // Never the Slack text, an email or a raw ID for a person.
    expect(host.innerHTML).not.toMatch(/@maharamedia|U0[A-Z0-9]{8}/);
  });

  test("a seat without the right to see notices sees nothing; a failed read says what to do", async () => {
    const hidden = await draw(
      <NoticesRouting
        io={{
          ...fakeNoticesIO(settingsReadFixture()),
          read: async () => {
            throw new NoticeError(
              "Current confirmed client-success or creative access is required",
              "42501",
            );
          },
        }}
      />,
    );
    expect(hidden.innerHTML).toBe("");
    // On its own page (/notices, open to any seat) the refusal is said.
    const page = await draw(
      <NoticesRouting
        standalone
        io={{
          ...fakeNoticesIO(settingsReadFixture()),
          read: async () => {
            throw new NoticeError(
              "Current confirmed client-success or creative access is required",
              "42501",
            );
          },
        }}
      />,
    );
    expect(text(page)).toContain(
      "This page is for the client success and creative seats, and for anyone the CEO or an admin lets change notices. Ask the CEO if you need it.",
    );
    const failed = await draw(
      <NoticesRouting
        io={{
          ...fakeNoticesIO(settingsReadFixture()),
          read: async () => {
            throw new Error("Failed to fetch");
          },
        }}
      />,
    );
    // One thing to do, and a cause in plain words, never the browser's.
    expect(text(failed)).toContain(
      "The notice settings could not be read: the cockpit could not reach the server. Read them again; if it stays, tell the tech lead.",
    );
    expect(text(failed)).not.toMatch(
      /Failed to fetch|Refresh the page|Nothing was changed/,
    );
    expect(buttonIn(failed, "Read them again")).toBeTruthy();
    // The cockpit's own reasons lose their advice here too.
    expect(
      readProblem(
        new NoticeError(
          "No connection. Nothing was changed; try again when you are back online.",
        ),
      ),
    ).toBe("the cockpit could not reach the server");
    expect(
      readProblem(
        new NoticeError(
          "The Slack notices are not live in the cockpit yet. Tell the tech lead.",
        ),
      ),
    ).toBe("the Slack notices are not live in the cockpit yet");
    expect(
      readProblem(
        new NoticeError(
          "The notice settings came back in a shape this page does not read. Refresh the page; if it stays, tell the tech lead.",
        ),
      ),
    ).toBe("the server answered in a shape this page does not read");
    expect(
      readProblem(new Error("permission denied for function x. Ask.")),
    ).toBe("permission denied for function x");
  });
});

describe("as an editor", () => {
  test("the switch turns a notice off at once, and says what the next one does", async () => {
    const read = settingsReadFixture();
    const io = fakeNoticesIO(read);
    const host = await draw(<NoticesRouting io={io} initial={read} />);
    const sw = row(host, "kickoff").querySelector('[role="switch"]');
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    await click(sw);
    await flush();
    expect(io.calls.at(-1)).toEqual({
      fn: "set",
      args: ["kickoff", { on: false }],
    });
    expect(toasts).toContain(
      'Turned off. The "Kickoff complete" notice does not post until it is on again.',
    );
    expect(text(row(host, "kickoff"))).toContain("Off.");
    await click(row(host, "kickoff").querySelector('[role="switch"]'));
    await flush();
    expect(toasts).toContain(
      'Turned on. The next "Kickoff complete" notice posts.',
    );
    // A label with a comma of its own still reads as one name.
    await click(row(host, "blueprint.media").querySelector('[role="switch"]'));
    await flush();
    expect(toasts).toContain(
      'Turned off. The "Brand Blueprint completed, for media" notice does not post until it is on again.',
    );
    // Only a post row has a channel to change: the others' folds say who only.
    const fold = (kind: string) =>
      text(row(host, kind).querySelector("summary"));
    expect(fold("kickoff")).toBe("Change where and who");
    expect(fold("blueprint.media")).toBe("Change where and who");
    for (const kind of [
      "kickoff.late",
      "kickoff.second",
      "kickoff.updated",
      "blueprint.updated",
      "blueprint.offer",
    ])
      expect(fold(kind)).toBe("Change who");
    // The variant rows have no switch, and no test of their own.
    expect(
      row(host, "kickoff.late").querySelector('[role="switch"]'),
    ).toBeNull();
    expect(
      buttonIn(row(host, "kickoff.late"), "Send a test to me"),
    ).toBeUndefined();
  });

  test("channel and tags are one Save; a refusal shows under the control, in the server's words", async () => {
    const read = settingsReadFixture();
    const io = fakeNoticesIO(read);
    const host = await draw(<NoticesRouting io={io} initial={read} />);
    const r = row(host, "kickoff");
    const save = () => buttonIn(r, "Save");
    expect(save().disabled).toBe(true);
    expect(buttonIn(r, "Send a test to me").disabled).toBe(false);
    expect(text(r)).not.toContain("Save first.");
    await click(buttonIn(r, "#media-general"));
    await click(buttonIn(r, "The CSM"));
    expect(save().disabled).toBe(false);
    // The test is built from the saved row: with a change not saved, it
    // waits, and says why.
    expect(buttonIn(r, "Send a test to me").disabled).toBe(true);
    expect(text(r)).toContain("Save first. The test uses the saved settings.");
    await click(save());
    await flush();
    expect(io.calls.at(-1)).toEqual({
      fn: "set",
      args: [
        "kickoff",
        { channel: "C0AE8G5MT7Y", mentionRule: ["seat:creative", "seat:csm"] },
      ],
    });
    expect(text(r)).toContain(
      "Posts in #media-general and tags the creative director and the CSM.",
    );
    expect(toasts).toContain("Saved. The next notice uses it.");

    // Tag a person by name, and refuse: the sentence is the server's.
    const refusing = {
      ...io,
      set: async () => {
        throw new NoticeError("Choose people from the team list.", "22023");
      },
    };
    const host2 = await draw(<NoticesRouting io={refusing} initial={read} />);
    const r2 = row(host2, "blueprint.media");
    await click(buttonIn(r2, "Omar, Creative strategist"));
    await click(buttonIn(r2, "Save"));
    await flush();
    expect(text(r2)).toContain("Choose people from the team list.");
    expect(r2.querySelector('[role="alert"]')).toBeTruthy();
  });

  test("Send a test to me: on its way, then sent to your direct messages, or not sent and why", async () => {
    const read = settingsReadFixture();
    const io = heldIO(read);
    const host = await draw(
      <NoticesRouting io={io} initial={read} watchEveryMs={20} />,
    );
    const r = row(host, "kickoff");
    await click(buttonIn(r, "Send a test to me"));
    await flush();
    expect(io.calls.at(-1)).toEqual({ fn: "rehearse", args: ["kickoff"] });
    expect(text(r)).toContain(
      "Test on its way. It reaches your Slack direct messages within a minute.",
    );
    // A second press while the first is on its way: the server's refusal.
    await click(buttonIn(r, "Send a test to me"));
    await flush();
    expect(text(r)).toContain(
      "A test is already on its way. Wait for it, then send another.",
    );
    // The sender's minute comes: the card reads again on its own and finds
    // the test posted.
    io.release();
    await waitFor(() =>
      /Sent to your direct messages at \d\d:\d\d\./.test(text(r)),
    );
    expect(text(r)).toMatch(/Sent to your direct messages at \d\d:\d\d\./);

    const notSent = await draw(
      <NoticesRouting
        io={fakeNoticesIO(read)}
        initial={{
          ...read,
          test: {
            id: "22222222-0000-4000-8000-000000000009",
            kind: "blueprint.close",
            state: "failed",
            at: read.now,
            reason:
              "No Slack account was found for you. Ask the tech lead to add your address to the team list.",
          },
        }}
      />,
    );
    expect(text(row(notSent, "blueprint.close"))).toContain(
      "Not sent: No Slack account was found for you. Ask the tech lead to add your address to the team list.",
    );
  });

  test("channels: their checks, Add with the bot check, Remove refused while in use", async () => {
    const read = settingsReadFixture();
    const io = heldIO(read);
    const host = await draw(
      <NoticesRouting io={io} initial={read} watchEveryMs={20} />,
    );
    const t = text(host);
    expect(t).toContain("Channels");
    expect(t).toContain("#csm-general");
    expect(t).toContain("Ready");
    expect(t).toContain(
      "Refused: Invite @mahara-club-bot to #client-call-feedback, then add it again.",
    );
    expect(t).toContain("Used by Kickoff complete and Brand Blueprint closed.");

    const id = host.querySelector("#notice-channel-id");
    const name = host.querySelector("#notice-channel-name");
    await type(id, "not-an-id");
    await click(buttonIn(host, "Add"));
    expect(text(host)).toContain(
      "Paste the channel's ID from Slack (it starts with C or G).",
    );
    expect(io.calls.some(c => c.fn === "addChannel")).toBe(false);

    await type(id, "c0opsteam01");
    await type(name, "#ops-team");
    await click(buttonIn(host, "Add"));
    await flush();
    expect(io.calls.find(c => c.fn === "addChannel")?.args).toEqual([
      "C0OPSTEAM01",
      "ops-team",
    ]);
    expect(text(host)).toContain(
      "Checking #ops-team: the cockpit makes sure mahara-club-bot is in it, within a minute.",
    );
    // The sender checks it on its next run.
    io.release();
    await waitFor(() =>
      text(host).includes("Added. #ops-team is ready for a notice."),
    );
    expect(text(host)).toContain("Added. #ops-team is ready for a notice.");

    const csm = Array.from(host.querySelectorAll("button")).find(
      (b: any) => b.getAttribute("aria-label") === "Remove #csm-general",
    );
    await click(csm);
    await flush();
    expect(text(host)).toContain(
      "The kickoff notice posts there. Choose another channel for it first.",
    );
  });

  test("who can change these: the CEO and admins, and the seats they add", async () => {
    const read = settingsReadFixture();
    const io = fakeNoticesIO(read);
    const host = await draw(<NoticesRouting io={io} initial={read} />);
    expect(text(host)).toContain("Who can change these");
    expect(text(host)).toContain("The CEO, admins, and these seats:");
    expect(text(host)).toContain("Hala, Systems manager");
    await click(buttonIn(host, "Lina, CSM"));
    await flush();
    expect(io.calls.at(-1)).toEqual({
      fn: "setEditor",
      args: ["11111111-0000-4000-8000-000000000002", true],
    });
    // What they can do now, and where: the page any seat opens.
    expect(toasts).toContain(
      "Added. They change these on the Notices and routing page.",
    );
    const page = Array.from(host.querySelectorAll("a")).find(
      (a: any) => a.textContent === "Notices and routing page",
    ) as any;
    expect(page?.getAttribute("href")).toBe("/client-success/notices");
    const remove = Array.from(host.querySelectorAll("button")).find(
      (b: any) =>
        b.getAttribute("aria-label") === "Remove Hala, Systems manager",
    );
    await click(remove);
    await flush();
    expect(io.calls.at(-1)).toEqual({
      fn: "setEditor",
      args: ["11111111-0000-4000-8000-000000000001", false],
    });
    // An editor who is not the CEO or an admin edits, but does not choose editors.
    const plain = settingsReadFixture({ edit: true, editors: false });
    const host2 = await draw(
      <NoticesRouting io={fakeNoticesIO(plain)} initial={plain} />,
    );
    expect(text(host2)).not.toContain("Who can change these");
    expect(buttonIn(host2, "Send a test to me")).toBeTruthy();
  });
});

describe("where it lives", () => {
  test("Notices and routing has a page every signed-in seat may open; the server decides what it shows", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = readFileSync(
      new URL(
        "../src/auth/authenticated/AuthenticatedAppRoutes.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    // The wrappers around the /notices route, line by line (the file opens a
    // wrapper as `<Route element={<X ...>}>` and closes it as `</Route>`).
    const stack: string[] = [];
    let around: string[] | null = null;
    for (const line of routes.split("\n")) {
      const open = line.match(/^\s*<Route element=\{<(\w+)[\s\S]*\}>\s*$/);
      if (open) stack.push(open[1]);
      else if (/^\s*<\/Route>\s*$/.test(line)) stack.pop();
      if (line.includes('path="/notices"')) around = [...stack];
    }
    // Signed in, in the shared shell, and no role gate: a forms editor may hold any role.
    expect(around).toEqual(["ProtectedRoute", "BillingReviewLayout"]);
    // The CSM pages keep theirs.
    expect(routes).toMatch(
      /<RoleRoute role="csm" \/>\}>\s*\{\/\*[\s\S]*?path="\/settings"/,
    );
    expect(routes).toContain("<NoticesPage />");
    const page = readFileSync(
      new URL("../src/pages/NoticesPage.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain("<NoticesRouting standalone />");
    // The page has its own h1, as every page in the shell does; the card
    // under it does not repeat the title.
    const { NoticesPage } = await import("../src/pages/NoticesPage");
    const shell = await draw(<NoticesPage />);
    expect(shell.querySelectorAll("h1").length).toBe(1);
    expect(text(shell.querySelector("h1"))).toBe("Notices and routing");
    const alone = await draw(
      <NoticesRouting
        standalone
        io={fakeNoticesIO(settingsReadFixture())}
        initial={settingsReadFixture()}
      />,
    );
    expect(alone.querySelector("h2#notices-title")).toBeNull();
    expect(
      alone.querySelector("section")?.getAttribute("aria-labelledby"),
    ).toBe("notices-page-title");
    const onSettings = await draw(
      <NoticesRouting
        io={fakeNoticesIO(settingsReadFixture())}
        initial={settingsReadFixture()}
      />,
    );
    expect(text(onSettings.querySelector("h2#notices-title"))).toBe(
      "Notices and routing",
    );
  });
});

describe("the RPC clients", () => {
  test("each call names its function and arguments; a refusal keeps the server's words", async () => {
    const asked: any[] = [];
    const client = {
      rpc: async (fn: string, args?: any) => {
        asked.push([fn, args]);
        if (fn === "cockpit_slack_notice_settings_set")
          return {
            data: null,
            error: {
              message: "Choose who to tag from the list.",
              code: "22023",
            },
          };
        if (fn === "cockpit_slack_notice_read")
          return {
            data: {
              taskId: "86fixture1",
              now: "2026-10-22T10:30:00Z",
              notices: [],
            },
            error: null,
          };
        return { data: settingsReadFixture(), error: null };
      },
    };
    const read = await readNoticeSettings(client as never);
    expect(read.notices).toHaveLength(8);
    expect(asked[0]).toEqual(["cockpit_slack_notice_settings_read", undefined]);
    await expect(
      setNoticeSetting(client as never, "kickoff", { mentionRule: [] }),
    ).rejects.toThrow("Choose who to tag from the list.");
    expect(asked[1]).toEqual([
      "cockpit_slack_notice_settings_set",
      { p_kind: "kickoff", p_patch: { mentionRule: [] } },
    ]);
    expect((await readNotices(client as never, "86fixture1")).notices).toEqual(
      [],
    );
    expect(asked[2]).toEqual([
      "cockpit_slack_notice_read",
      { p_task_id: "86fixture1" },
    ]);
    // Not live yet: a plain sentence, never a raw PostgREST code.
    await expect(
      readNotices(
        {
          rpc: async () => ({
            data: null,
            error: {
              message:
                "Could not find the function public.cockpit_slack_notice_read",
              code: "PGRST202",
            },
          }),
        } as never,
        "86fixture1",
      ),
    ).rejects.toThrow(
      "The Slack notices are not live in the cockpit yet. Tell the tech lead.",
    );
    // A shape this page does not read says so.
    await expect(
      readNotices(
        { rpc: async () => ({ data: { nope: true }, error: null }) } as never,
        "86fixture1",
      ),
    ).rejects.toThrow("came back in a shape this page does not read");
  });
});

describe("the reply label", () => {
  test("a reply says Reply posted only when it went in a thread; one whose first notice did not post says Posted", () => {
    const now = "2026-10-25T11:30:00.000Z";
    const base = {
      id: "33333333-0000-4000-8000-000000000001",
      kind: "blueprint.offer",
      state: "posted",
      responseId: null,
      outboxId: null,
      parentKind: "blueprint.close",
      channel: { id: "C09RZ0GS0V9", name: "csm-general" },
      at: "2026-10-25T11:03:00.000Z",
      dueAt: null,
      permalink: "https://example-team.slack.com/archives/C09RZ0GS0V9/p1",
      reason: null,
    } as const;
    expect(noticeStop({ ...base, variant: "thread" } as any, now).text).toBe(
      "Reply posted in #csm-general at 14:03",
    );
    expect(noticeStop({ ...base, variant: "top" } as any, now).text).toBe(
      "Posted in #csm-general at 14:03",
    );
    expect(
      noticeStop(
        { ...base, kind: "kickoff.updated", variant: "top" } as any,
        now,
      ).text,
    ).toBe("Posted in #csm-general at 14:03");
  });
});
