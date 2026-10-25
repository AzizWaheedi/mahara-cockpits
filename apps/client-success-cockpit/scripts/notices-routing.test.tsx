import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
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
const { NoticeError, readNoticeSettings, setNoticeSetting, readNotices } =
  await import("../src/lib/notices");

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
    expect(noticeSentence(by("blueprint.close"))).toBe(
      "Posts in #csm-general and tags the CSM and Rana, Project manager (no Slack account found, so named in plain text).",
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
    expect(text(row(host, "blueprint.close"))).toContain(
      "Last: not posted in #csm-general: Slack refused it: mahara-club-bot is not in #csm-general. Invite it there, then ask the tech lead to requeue this notice.",
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
    expect(text(failed)).toContain(
      "The notice settings could not be read: Failed to fetch. Refresh the page; if it stays, tell the tech lead.",
    );
    expect(buttonIn(failed, "Read them again")).toBeTruthy();
  });
});

describe("as an editor", () => {
  test("the switch turns a notice off at once, and says the next notice uses it", async () => {
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
    expect(toasts).toContain("Saved. The next notice uses it.");
    expect(text(row(host, "kickoff"))).toContain("Off.");
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
    await click(buttonIn(r, "#media-general"));
    await click(buttonIn(r, "The CSM"));
    expect(save().disabled).toBe(false);
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
    const io = fakeNoticesIO(read, { settleAfterReads: 1 });
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
    // The card reads again on its own and finds the test posted.
    await wait(80);
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
    const io = fakeNoticesIO(read, { settleAfterReads: 1 });
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
    await wait(80);
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
