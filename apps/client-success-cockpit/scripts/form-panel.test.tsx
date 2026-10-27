import {
  afterAll,
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * The form panel (src/forms/FormPanel.tsx, docs/csm-forms/KICKOFF.md 2 and
 * 4) with Typeform's SDK replaced by a stand-in that captures its options:
 * nothing loads and nothing is submitted. It pins the hidden object and the
 * embed options, the one note per response (never the sandbox's), the
 * deliberate second-kickoff click, a kit re-read that never remounts the
 * form, Sharing hiding the side panel, and the ending's booking dialog.
 *
 * Run: bun test scripts/form-panel.test.tsx
 */

// Give async React acts time to settle on shared build hosts.
// Cancelling a live act at five seconds contaminates the following fixtures.
setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86fixture1/forms/kickoff",
  width: 1440,
  height: 900,
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDetailsElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "NodeFilter",
  "HTMLInputElement",
  "FocusEvent",
  "MouseEvent",
  "KeyboardEvent",
  "DocumentFragment",
  "Text",
  "sessionStorage",
  "localStorage",
  "MutationObserver",
  "getComputedStyle",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { FormPanel } = await import("../src/forms/FormPanel");
const { FormWindowView } = await import("../src/forms/FormWindow");
const { KICKOFF } = await import("../src/forms/kickoff");
const { hiddenSha256 } = await import("../src/forms/prefill");
const fx = await import("../src/dev/formFixtures");

type Options = Record<string, any>;
type Mounted = { formId: string; options: Options; unmounted: boolean };

function stand() {
  const mounted: Mounted[] = [];
  const embed = async () => (formId: string, options: Options) => {
    const m: Mounted = { formId, options, unmounted: false };
    mounted.push(m);
    return {
      unmount: () => {
        m.unmounted = true;
      },
    };
  };
  return { mounted, embed };
}

function io(over: Partial<Record<string, any>> = {}) {
  const records: any[] = [];
  const news: any[] = [];
  let checks = 0;
  const value = {
    record: async (input: any) => {
      records.push(input);
      return fx.fixtureSend({ responseId: input.responseId, sentAt: fx.NOW });
    },
    check: async () => {
      checks++;
    },
    recheck: async () => {},
    announce: (n: any) => news.push(n),
    ...over,
  };
  return { io: value, records, news, checks: () => checks };
}

const hosts: { root: ReturnType<typeof createRoot> }[] = [];
function mountHost() {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  hosts.push({ root });
  return { host, root };
}
const flush = () =>
  act(async () => {
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
  });
const buttons = (host: { querySelectorAll: (s: string) => any }) =>
  Array.from(host.querySelectorAll("button")) as any[];
const button = (host: any, text: string) =>
  buttons(host).find(b => (b.textContent ?? "").includes(text));

afterEach(async () => {
  for (const h of hosts.splice(0)) await act(async () => h.root.unmount());
  win.document.body.innerHTML = "";
});
afterAll(async () => {
  await win.happyDOM.close();
});

describe("the embed", () => {
  test("carries the record's hidden object, opens redirects in a new tab, intercepts the ending, and is never the sandbox outside rehearsal", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const ctx = fx.fixtureContext();
    const { io: panelIo } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={ctx}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    expect(mounted.length).toBe(1);
    const { formId, options } = mounted[0];
    expect(formId).toBe("tG7dnxBn");
    expect(options.hidden).toEqual(KICKOFF.hidden(ctx).values);
    expect(options.hidden.onboarding_client_id).toBe(fx.TASK);
    expect(options.redirectTarget).toBe("_blank");
    expect(typeof options.onEndingButtonClick).toBe("function");
    expect(typeof options.onSubmit).toBe("function");
    expect(typeof options.onStarted).toBe("function");
    expect("enableSandbox" in options).toBe(false);
    expect(options.inlineOnMobile).toBe(true);
    expect(options.medium).toBe("mahara-client-success");
    expect(options.iframeProps.title).toBe(`Kickoff form for ${fx.NAME}`);
    expect(options.container).toBeTruthy();
    expect(host.textContent).toContain("Loading the form…");
    await act(async () =>
      options.onReady({ formId: "tG7dnxBn", isClosed: false }),
    );
    expect(host.textContent).not.toContain("Loading the form…");
  });

  test("rehearsal is Typeform's sandbox, says so, and never offers the live form", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo, records } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
          rehearse
        />,
      ),
    );
    await flush();
    expect(mounted[0].options.enableSandbox).toBe(true);
    expect(host.textContent).toContain(
      "Rehearsal in Typeform's sandbox: nothing is saved and Make does not run. Walk the form; do not press Submit.",
    );
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "realLookingId01",
      }),
    );
    await flush();
    expect(records).toEqual([]);
    expect(host.textContent).toContain(
      "Rehearsal finished. Nothing was saved and nothing was noted.",
    );
  });
});

describe("a send", () => {
  test("onSubmit notes the response once, with the right arguments, and starts the trail", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const ctx = fx.fixtureContext();
    const { io: panelIo, records, news } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={ctx}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    const values = KICKOFF.hidden(ctx).values;
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000001",
      }),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000001",
      }),
    );
    await flush();
    expect(records.length).toBe(1);
    expect(records[0]).toEqual({
      taskId: fx.TASK,
      formKey: "kickoff",
      responseId: "resp0000000001",
      hiddenKeys: Object.keys(values),
      hiddenSha256: await hiddenSha256(values),
      carriedId: fx.TASK,
    });
    expect(news[0]).toEqual({
      type: "sent",
      taskId: fx.TASK,
      form: "kickoff",
      clientName: fx.NAME,
      say: `Kickoff sent for ${fx.NAME}. Make is updating the card. Book the Brand Blueprint call below.`,
    });
    // Once the note lands, the cockpit tab is told to read the sends again
    // (its first read raced the note).
    expect(news.filter(n => n.type === "noted")).toEqual([
      { type: "noted", taskId: fx.TASK, form: "kickoff" },
    ]);
    expect(host.textContent).toContain(
      "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
    );
    // No notice yet, so no channel is known: Slack, never a channel in code.
    expect(host.textContent).toContain(
      "The team hears in Slack once the card is updated.",
    );
    expect(host.textContent).not.toContain("#csm-general");
    // Make books nothing (docs/forms/PLAN.md S10).
    expect(host.textContent).not.toContain("Make is booking");
    expect(host.textContent).toContain("Sent from the cockpit at 13:30.");
    expect(
      host.querySelector('[role="status"][aria-live="polite"]'),
    ).toBeTruthy();
    // The trail replaces Still missing.
    expect(host.textContent).not.toContain("Still missing");
  });

  test('"__sandbox" is never sent, even outside rehearsal', async () => {
    const { mounted, embed } = stand();
    const { root } = mountHost();
    const { io: panelIo, records } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "__sandbox",
      }),
    );
    await flush();
    expect(records).toEqual([]);
  });

  test("a failed note says what still happened and tries again with the same response", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    let fail = true;
    const records: any[] = [];
    const { io: panelIo } = io({
      record: async (input: any) => {
        records.push(input);
        if (fail) throw Error("The cockpit's form record is not live yet.");
        return fx.fixtureSend({ responseId: input.responseId, sentAt: fx.NOW });
      },
    });
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000002",
      }),
    );
    await flush();
    expect(host.textContent).toContain(
      "The kickoff went to Typeform, but the cockpit could not note it. The cockpit's form record is not live yet.",
    );
    // The reason's own full stop is not doubled.
    expect(host.textContent).not.toContain("yet..");
    expect(host.textContent).toContain(
      "Sent at 13:30. Not noted in the cockpit yet.",
    );
    fail = false;
    await act(async () => button(host, "Try again").click());
    await flush();
    expect(records.map(r => r.responseId)).toEqual([
      "resp0000000002",
      "resp0000000002",
    ]);
    expect(host.textContent).not.toContain("could not note it");
    expect(host.textContent).toContain("Sent from the cockpit at 13:30.");
  });

  test("a retried note keeps the submit's clock, so Make's update just after the submit still counts", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    let fail = true;
    const { io: panelIo } = io({
      record: async (input: any) => {
        if (fail) throw Error("The cockpit's form record is not live yet.");
        // The server stamps the retry's own time, 12 minutes on.
        return fx.fixtureSend({
          responseId: input.responseId,
          sentAt: "2026-10-22T10:42:00.000Z",
        });
      },
    });
    const draw = (ctx: any) =>
      act(async () =>
        root.render(
          <FormPanel
            config={KICKOFF}
            ctx={ctx}
            io={panelIo}
            clientName={fx.NAME}
            embed={embed}
          />,
        ),
      );
    await draw(fx.fixtureContext());
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000009",
      }),
    );
    await flush();
    // Make updated the card a minute after the submit; the retry comes later.
    await draw(
      fx.fixtureContext({
        row: fx.fixtureRow({
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: "2026-10-22T10:31:00.000Z",
          forms: {
            onboarding: fx.onboardingEntry(),
            kickoff: {
              form_id: "tG7dnxBn",
              response_id: "resp0000000009",
              submitted_at: "2026-10-22T10:30:00.000Z",
              answers: [],
            },
          },
        }),
        now: "2026-10-22T10:42:00.000Z",
        readAt: Date.now(),
      }),
    );
    fail = false;
    await act(async () => button(host, "Try again").click());
    await flush();
    expect(host.textContent).toContain("Make updated the card at 13:31");
    expect(host.textContent).not.toContain("Make has not updated the card");
  });

  test("the card is checked again on the config's schedule, and on Check now", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo, checks, news } = io();
    const quick = {
      ...KICKOFF,
      after: { ...KICKOFF.after, checksAtSec: [0.005, 0.01] },
    };
    await act(async () =>
      root.render(
        <FormPanel
          config={quick}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000003",
      }),
    );
    await act(async () => {
      await new Promise(r => setTimeout(r, 60));
    });
    expect(checks()).toBe(2);
    await act(async () => button(host, "Check now").click());
    await flush();
    expect(checks()).toBe(3);
    expect(news.filter(n => n.type === "checked").length).toBe(3);
    expect(host.textContent).toContain("Checked ClickUp and Typeform at");
  });

  test("the ending's button opens the cockpit's booking dialog for this client", async () => {
    const { mounted, embed } = stand();
    const { root } = mountHost();
    const { io: panelIo } = io();
    const asked: any[] = [];
    const book = (p: any) => {
      asked.push(p);
      return <button type="button">{p.label}</button>;
    };
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
          book={book}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000004",
      }),
    );
    await flush();
    // The ending's own words, so the booking has one name.
    expect(asked.at(-1)).toMatchObject({
      kind: "blueprint",
      label: "Book the Brand Blueprint call",
      autoOpen: false,
    });
    await act(async () =>
      mounted[0].options.onEndingButtonClick({ formId: "tG7dnxBn" }),
    );
    await flush();
    expect(asked.at(-1).autoOpen).toBe(true);
    await act(async () => asked.at(-1).onAutoOpenConsumed());
    expect(asked.at(-1).autoOpen).toBe(false);
  });
});

describe("the trail's last stops (docs/forms/STAGE1-CONTRACT.md 6.1)", () => {
  const nf = () => import("../src/dev/noticesFixtures");
  // Make has done its part: Brand Blueprint Booked after the send, and the
  // card's Brand Blueprint link.
  const doneRow = () =>
    fx.fixtureRow({
      client_status: "Brand Blueprint Booked♠️",
      card_updated_at: "2026-10-22T10:31:00Z",
      links: {
        clickup: `https://app.clickup.com/t/${fx.TASK}`,
        blueprint_form: `https://maharamedia.typeform.com/to/oYZKtogO#onboarding_client_id=${fx.TASK}`,
      },
    });
  async function sendWith(
    ctx: ReturnType<typeof fx.fixtureContext>,
    responseId: string,
    extra: { windowLink?: string; io?: Record<string, any> } = {},
  ) {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io(extra.io ?? {});
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={ctx}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
          windowLink={extra.windowLink}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({ formId: "tG7dnxBn", responseId }),
    );
    await flush();
    return host;
  }

  test("posted: the Slack stop says where and when, and opens the post", async () => {
    const { kickoffNotice, noticeRead } = await nf();
    const host = await sendWith(
      fx.fixtureContext({
        row: doneRow(),
        notices: noticeRead(fx.TASK, [
          kickoffNotice("posted", "resp0000000101", fx.NOW),
        ]),
      }),
      "resp0000000101",
    );
    expect(host.textContent).toContain("Posted in #csm-general at 13:31");
    const slack = Array.from(host.querySelectorAll("a")).find((a: any) =>
      (a.textContent ?? "").includes("Open in Slack"),
    ) as any;
    expect(slack?.getAttribute("href")).toBe(
      "https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1792872070187739",
    );
    expect(host.textContent).toContain("All five steps are done.");
    // The headline says what happened, and no "once the card is updated" line stays.
    expect(host.textContent).toContain(
      "Kickoff sent. The card is updated. Book the Brand Blueprint call below.",
    );
    expect(host.textContent).not.toContain("Make is updating the card");
    expect(host.textContent).not.toContain("once the card is updated");
  });

  test("the Blueprint button opens the cockpit's own Blueprint, never the old Typeform", async () => {
    const host = await sendWith(
      fx.fixtureContext({ row: doneRow(), notices: null }),
      "resp0000000102",
    );
    expect(host.textContent).toContain("The card has the Brand Blueprint link");
    const open = Array.from(host.querySelectorAll("a")).find((a: any) =>
      (a.textContent ?? "").includes("Open the Brand Blueprint"),
    ) as any;
    expect(open?.getAttribute("href")).toBe(
      `/client-success/clients/${fx.TASK}/present/blueprint?view=prep`,
    );
    expect(host.innerHTML).not.toContain("oYZKtogO");
    expect(host.textContent).not.toContain("Open the Brand Blueprint form");
  });

  test("waiting: the config's words, and the booking is not held up by Slack", async () => {
    const { noticeRead } = await nf();
    const asked: any[] = [];
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext({
            row: doneRow(),
            notices: noticeRead(fx.TASK, []),
          })}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
          book={p => {
            asked.push(p);
            return <button type="button">{p.label}</button>;
          }}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000103",
      }),
    );
    await flush();
    expect(host.textContent).toContain("The team hears in Slack");
    expect(host.textContent).toContain(
      "Once Make has updated the card, usually within a few minutes.",
    );
    expect(host.textContent).not.toContain("#csm-general");
    expect(asked.at(-1)?.variant).toBe("default");
  });

  test("failed or not confirmed: said with its reason, for the tech lead", async () => {
    const { kickoffNotice, noticeRead } = await nf();
    const failed = await sendWith(
      fx.fixtureContext({
        row: doneRow(),
        notices: noticeRead(fx.TASK, [
          kickoffNotice("failed", "resp0000000104", fx.NOW),
        ]),
      }),
      "resp0000000104",
    );
    expect(failed.textContent).toContain(
      "Not posted. Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
    );
    // The lead carries the warning; the reason is a plain sentence.
    const lead = Array.from(failed.querySelectorAll(".txt-warn")).find(
      (e: any) => e.textContent === "Not posted.",
    );
    expect(lead).toBeTruthy();
    expect(failed.textContent).toContain(", needs a person");
    expect(failed.textContent).not.toContain("All five steps are done.");
  });

  test("on a phone the fold opens on a notice that needs a person, with the warning dot", async () => {
    const { kickoffNotice, noticeRead } = await nf();
    const real = (win as any).matchMedia;
    (win as any).matchMedia = (q: string) => ({
      matches: !/min-width/.test(q),
      addEventListener() {},
      removeEventListener() {},
    });
    (globalThis as any).matchMedia = (win as any).matchMedia;
    try {
      const host = await sendWith(
        fx.fixtureContext({
          row: doneRow(),
          notices: noticeRead(fx.TASK, [
            kickoffNotice("failed", "resp0000000111", fx.NOW),
          ]),
        }),
        "resp0000000111",
      );
      const fold = host.querySelector("details.group\\/fold") as any;
      expect(fold).toBeTruthy();
      expect(fold.open).toBe(true);
      const summary = fold.querySelector("summary") as any;
      expect(summary.textContent).toContain(
        "Not posted in Slack · tell the tech lead",
      );
      expect(summary.querySelector(".bg-warning")).toBeTruthy();
      // The instruction is never cut off on a phone: this line wraps.
      expect(summary.querySelector(".truncate")).toBeNull();
    } finally {
      (win as any).matchMedia = real;
      (globalThis as any).matchMedia = real;
    }
  });

  test("muted and a failed read each say so", async () => {
    const { kickoffNotice, noticeRead } = await nf();
    const muted = await sendWith(
      fx.fixtureContext({
        row: doneRow(),
        notices: noticeRead(fx.TASK, [
          kickoffNotice("muted", "resp0000000105", fx.NOW),
        ]),
      }),
      "resp0000000105",
    );
    expect(muted.textContent).toContain(
      "Not posted: the kickoff notice is off in Settings.",
    );
    // Off is not a success: the footer never says every step is done.
    expect(muted.textContent).not.toContain("All five steps are done.");
    expect(muted.textContent).toContain(
      "The card's steps are done. The Slack notice was not posted.",
    );
    expect(muted.textContent).not.toContain("once the card is updated");
    const unread = await sendWith(
      fx.fixtureContext({
        row: doneRow(),
        notices: null,
        failed: { notices: "Failed to fetch" },
      }),
      "resp0000000106",
    );
    expect(unread.textContent).toContain(
      "The cockpit could not read the Slack notice just now. Check now reads it again.",
    );
    expect(unread.textContent).not.toContain("All five steps are done.");
  });

  test("a posted Kickoff complete reads the card once, so the trail never says Make is late beside it", async () => {
    const { kickoffNotice, noticeRead } = await nf();
    let checks = 0;
    const counting = { check: async () => void checks++ };
    // The window's copy of the card is from before Make's update.
    await sendWith(
      fx.fixtureContext({
        notices: noticeRead(fx.TASK, [
          kickoffNotice("posted", "resp0000000121", fx.NOW),
        ]),
      }),
      "resp0000000121",
      { io: counting },
    );
    expect(checks).toBe(1);
    // A late notice says the card is not done: nothing to catch up on.
    checks = 0;
    await sendWith(
      fx.fixtureContext({
        notices: noticeRead(fx.TASK, [
          kickoffNotice("late", "resp0000000122", fx.NOW),
        ]),
      }),
      "resp0000000122",
      { io: counting },
    );
    expect(checks).toBe(0);
    // A card already shown done needs no read.
    checks = 0;
    await sendWith(
      fx.fixtureContext({
        row: doneRow(),
        notices: noticeRead(fx.TASK, [
          kickoffNotice("posted", "resp0000000123", fx.NOW),
        ]),
      }),
      "resp0000000123",
      { io: counting },
    );
    expect(checks).toBe(0);
  });

  test("while the Slack stop waits, the notices are read again every minute; not when the screen does not read them", async () => {
    const { noticeRead } = await nf();
    const delays: number[] = [];
    const real = win.setInterval.bind(win);
    (win as any).setInterval = (fn: any, ms: number, ...rest: any[]) => {
      delays.push(ms);
      return real(fn, ms, ...rest);
    };
    try {
      await sendWith(
        fx.fixtureContext({ row: doneRow(), notices: noticeRead(fx.TASK, []) }),
        "resp0000000107",
        { io: { notices: async () => {} } },
      );
      expect(delays).toContain(60_000);
      // One failed read never ends the watch: it keeps reading.
      delays.length = 0;
      await sendWith(
        fx.fixtureContext({
          row: doneRow(),
          notices: null,
          failed: { notices: "Failed to fetch" },
        }),
        "resp0000000110",
        { io: { notices: async () => {} } },
      );
      expect(delays).toContain(60_000);
      delays.length = 0;
      await sendWith(
        fx.fixtureContext({ row: doneRow(), notices: noticeRead(fx.TASK, []) }),
        "resp0000000108",
      );
      expect(delays).not.toContain(60_000);
    } finally {
      (win as any).setInterval = real;
    }
  });

  test("the trail offers this kickoff's window to copy", async () => {
    const written: string[] = [];
    Object.defineProperty(win.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    const link = `https://cockpit.maharamedia.com/client-success/clients/${fx.TASK}/forms/kickoff`;
    const host = await sendWith(fx.fixtureContext(), "resp0000000109", {
      windowLink: link,
    });
    expect(host.textContent).toContain("This kickoff's window");
    await act(async () => button(host, "Copy the link").click());
    await flush();
    expect(written).toEqual([link]);
    // The browser will not copy: the link appears to select by hand, as the toast says.
    Object.defineProperty(win.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("denied")) },
    });
    expect(host.querySelector("input[readonly]")).toBeNull();
    await act(async () => button(host, "Copy the link").click());
    await flush();
    const shown = host.querySelector("input[readonly]") as any;
    expect(shown?.value).toBe(link);
  });

  test("the window builds its own link from where it is", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const written: string[] = [];
    Object.defineProperty(win.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    await act(async () =>
      root.render(
        <FormWindowView
          cfg={KICKOFF}
          taskId={fx.TASK}
          state={{ kind: "ready", ctx: fx.fixtureContext() }}
          io={panelIo}
          embed={embed}
          onRetry={() => {}}
          onRefresh={() => {}}
          initialSharing={false}
        />,
      ),
    );
    await flush();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000110",
      }),
    );
    await flush();
    await act(async () => button(host, "Copy the link").click());
    await flush();
    expect(written).toEqual([
      `https://localhost/client-success/clients/${fx.TASK}/forms/kickoff`,
    ]);
  });
});

describe("the guard and the frozen form", () => {
  test("a second kickoff needs a deliberate click before the form loads", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const ctx = fx.fixtureContext({
      row: fx.fixtureRow({
        forms: {
          onboarding: fx.onboardingEntry(),
          kickoff: {
            form_id: "tG7dnxBn",
            response_id: "old0000000001",
            submitted_at: "2026-10-15T09:00:00Z",
            answers: [{ ref: "q", title: "Contract status", value: "Signed" }],
          },
        },
      }),
    });
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={ctx}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    expect(mounted.length).toBe(0);
    expect(host.textContent).toContain(
      `A kickoff for ${fx.NAME} went in on 15 Oct. Sending another runs Make again: a second Kickoff Handoff comment, a second Technical and Creative task and a second WhatsApp to the client's group. Fix a wrong answer in Typeform's results instead.`,
    );
    expect(button(host, "Read what was filled")).toBeTruthy();
    expect(host.textContent).toContain("Already sent");
    expect(host.textContent).toContain(
      "Only if the first one cannot be fixed:",
    );
    const second = button(host, "Open a second kickoff anyway");
    expect(second.getAttribute("data-variant") ?? second.className).toContain(
      "outline",
    );
    // The answers sheet names the form first, and links a link.
    await act(async () => button(host, "Read what was filled").click());
    await flush();
    expect(win.document.body.textContent).toContain(`Kickoff for ${fx.NAME}`);
    await act(async () => second.click());
    await flush();
    expect(mounted.length).toBe(1);
  });

  test("a failed read of the cockpit's own sends is said, since the guard may miss one", async () => {
    const { embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext({
            failed: { sends: "The network dropped." },
          })}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    expect(host.textContent).toContain(
      "The cockpit could not check for a kickoff already sent from here: The network dropped. Look at the client's Onboarding panel before you send.",
    );
    // A clean read says nothing.
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={fx.fixtureContext()}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    expect(host.textContent).not.toContain("could not check for a kickoff");
  });

  test("a kit re-read never remounts the form; changed answers are said and wait for Reload", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const draw = (ctx: any) =>
      act(async () =>
        root.render(
          <FormPanel
            config={KICKOFF}
            ctx={ctx}
            io={panelIo}
            clientName={fx.NAME}
            embed={embed}
          />,
        ),
      );
    await draw(fx.fixtureContext());
    await flush();
    // The same data read again (a new object, a new clock).
    await draw(
      fx.fixtureContext({
        readAt: Date.now() + 1000,
        now: "2026-10-22T10:31:00.000Z",
      }),
    );
    await flush();
    expect(mounted.length).toBe(1);
    expect(mounted[0].unmounted).toBe(false);
    expect(host.textContent).not.toContain("Their onboarding answers changed");
    // Newer onboarding answers arrive under a form being filled.
    await act(async () =>
      mounted[0].options.onStarted({ formId: "tG7dnxBn", responseId: "x" }),
    );
    const newer = fx.fixtureContext({
      row: fx.fixtureRow({
        forms: {
          onboarding: fx.onboardingEntry({
            ...fx.FULL_ANSWERS,
            hours: "Every day, 8 to 8",
          }),
        },
      }),
    });
    await draw(newer);
    await flush();
    expect(mounted.length).toBe(1);
    expect(mounted[0].options.hidden.hours).toBe(fx.FULL_ANSWERS.hours);
    expect(host.textContent).toContain(
      "Their onboarding answers changed after this form opened. Reload the form to use them.",
    );
    const confirm = win.confirm;
    (win as any).confirm = () => true;
    try {
      await act(async () => button(host, "Reload the form").click());
      await flush();
    } finally {
      (win as any).confirm = confirm;
    }
    expect(mounted.length).toBe(2);
    expect(mounted[0].unmounted).toBe(true);
    expect(mounted[1].options.hidden.hours).toBe("Every day, 8 to 8");
  });
});

describe("the window", () => {
  test("Sharing hides the whole side panel and the seal; Just me shows them", async () => {
    const { embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const state = { kind: "ready" as const, ctx: fx.fixtureContext() };
    await act(async () =>
      root.render(
        <FormWindowView
          cfg={KICKOFF}
          taskId={fx.TASK}
          state={state}
          io={panelIo}
          embed={embed}
          onRetry={() => {}}
          onRefresh={() => {}}
          initialSharing={false}
        />,
      ),
    );
    await flush();
    const aside = host.querySelector(
      'aside[aria-label="What the cockpit knows"]',
    );
    expect(aside?.hasAttribute("hidden")).toBe(false);
    expect(host.textContent).toContain("Sends to");
    expect(host.textContent).toContain(fx.TASK);
    expect(host.textContent).toContain("The client");
    await act(async () => button(host, "Sharing").click());
    expect(
      host
        .querySelector('aside[aria-label="What the cockpit knows"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(host.textContent).not.toContain("Sends to");
    expect(host.querySelector("h1")?.textContent).toBe(`Kickoff · ${fx.NAME}`);
    expect(button(host, "Sharing").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button(host, "Just me").click());
    expect(
      host
        .querySelector('aside[aria-label="What the cockpit knows"]')
        ?.hasAttribute("hidden"),
    ).toBe(false);
  });

  test("after a send, the header no longer offers a fresh form in Typeform", async () => {
    const { mounted, embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const state = { kind: "ready" as const, ctx: fx.fixtureContext() };
    await act(async () =>
      root.render(
        <FormWindowView
          cfg={KICKOFF}
          taskId={fx.TASK}
          state={state}
          io={panelIo}
          embed={embed}
          onRetry={() => {}}
          onRefresh={() => {}}
          initialSharing={false}
        />,
      ),
    );
    await flush();
    const typeformLink = () =>
      Array.from(host.querySelectorAll("header a")).find((a: any) =>
        (a.textContent ?? "").includes("Open in Typeform"),
      );
    expect(typeformLink()).toBeTruthy();
    await act(async () =>
      mounted[0].options.onSubmit({
        formId: "tG7dnxBn",
        responseId: "resp0000000010",
      }),
    );
    await flush();
    expect(typeformLink()).toBeUndefined();
  });

  test("in rehearsal the seal says so, and sends to no one", async () => {
    const { embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    await act(async () =>
      root.render(
        <FormWindowView
          cfg={KICKOFF}
          taskId={fx.TASK}
          state={{ kind: "ready", ctx: fx.fixtureContext() }}
          io={panelIo}
          embed={embed}
          rehearse
          onRetry={() => {}}
          onRefresh={() => {}}
          initialSharing={false}
        />,
      ),
    );
    await flush();
    const header = host.querySelector("header")?.textContent ?? "";
    expect(header).toContain("Rehearsal ·");
    expect(header).not.toContain("Sends to");
  });

  test("Still missing points at its row", async () => {
    const { embed } = stand();
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const ctx = fx.fixtureContext({
      row: fx.fixtureRow({ forms: {}, handover: {} }),
      deck: fx.fixtureDeck({}),
      timeline: fx.fixtureTimeline([]),
    });
    await act(async () =>
      root.render(
        <FormPanel
          config={KICKOFF}
          ctx={ctx}
          io={panelIo}
          clientName={fx.NAME}
          embed={embed}
        />,
      ),
    );
    await flush();
    const target = host.querySelector("#rail-contract") as any;
    expect(target).toBeTruthy();
    // Only the panel scrolls, never the window under the header.
    const aside = host.querySelector("[data-rail-scroll]") as any;
    expect(aside?.tagName).toBe("ASIDE");
    let scrolled = false;
    aside.scrollTo = () => {
      scrolled = true;
    };
    const pointer = buttons(host).find(b =>
      (b.textContent ?? "").startsWith("Contract status"),
    );
    await act(async () => pointer.click());
    expect(scrolled).toBe(true);
    // The onboarding link to send sits in its own missing row.
    expect(button(host, "Copy their onboarding link")).toBeTruthy();
    // The empty rows in a row are one line.
    expect(host.textContent).toContain(
      "Not on record: Daily budget, Facebook access, Calendar, Content.",
    );
  });

  test("the plain states say what is wrong and what still works", async () => {
    const { host, root } = mountHost();
    const { io: panelIo } = io();
    const { blockedFor } = await import("../src/forms/FormWindow");
    const draw = (state: any) =>
      act(async () =>
        root.render(
          <FormWindowView
            cfg={KICKOFF}
            taskId={fx.TASK}
            state={state}
            io={panelIo}
            onRetry={() => {}}
            onRefresh={() => {}}
            initialSharing={false}
          />,
        ),
      );
    await draw(
      blockedFor(
        Error("That client is not on your access list"),
        KICKOFF,
        fx.TASK,
      ),
    );
    expect(host.textContent).toContain(
      "This client is not on your list, so the kickoff cannot open here. Ask your lead to add this client, then try again.",
    );
    expect(button(host, "Try again")).toBeUndefined();
    expect(button(host, "Close this window")).toBeTruthy();
    // Nothing to hide on a plain state, so no Just me / Sharing switch.
    expect(button(host, "Sharing")).toBeUndefined();
    await draw(
      blockedFor(
        Error("The client roster is incomplete. Refresh its native source"),
        KICKOFF,
        fx.TASK,
      ),
    );
    expect(host.textContent).toContain(
      "The client list is refreshing. Try again in a minute.",
    );
    expect(button(host, "Try again")).toBeTruthy();
    await draw(
      blockedFor(
        Error("Client card identity changed. Refresh the client roster"),
        KICKOFF,
        fx.TASK,
      ),
    );
    expect(host.textContent).toContain(
      "The card's name and the client list disagree, so the kickoff stays closed.",
    );
    await draw(blockedFor(Error("Failed to fetch"), KICKOFF, fx.TASK));
    expect(host.textContent).toContain(
      "The client's record could not be read, so the kickoff stays closed: a form without the right card ID reaches no client.",
    );
    const plain = Array.from(host.querySelectorAll("a")).find((a: any) =>
      a.textContent.includes("Open the plain kickoff"),
    ) as any;
    expect(plain.getAttribute("href")).toBe(
      `https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=${fx.TASK}`,
    );
    await draw({ kind: "unread" });
    expect(host.textContent).toContain(
      "This card has not been read yet. Refresh reads ClickUp and Typeform now.",
    );
  });
});

describe("the app's frame rule", () => {
  test("vercel.json lets the Typeform frame in", () => {
    const vercel = JSON.parse(
      readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
    );
    const csp: string = vercel.headers[0].headers.find(
      (h: any) => h.key === "Content-Security-Policy",
    ).value;
    const frame = csp
      .split(";")
      .map(s => s.trim())
      .find(s => s.startsWith("frame-src"));
    expect(frame?.split(/\s+/)).toContain("https://form.typeform.com");
    // Only the cockpit's own pages may frame it.
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
