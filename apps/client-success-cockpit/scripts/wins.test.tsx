import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * The wins ledger's screens (docs/forms/WAVE56-CONTRACT.md 5.0 to 5.4, 5.6,
 * 5.11, 5.12, 5.14, section 8 cockpit-screens row): Log a win's proof field
 * per kind and the SQL sentences word for word; one request id per open
 * sheet through a retry and the duplicate warning; the ribbon's words for
 * every stage and pay state; Mark as offered disabled on a draft; the tie
 * dialog's chips; the door lines and no call behind a closed door; Client is
 * back only with a confirmed departure; the Today bands; Checks waiting's
 * receipt lines; the retire list's words. Every send and read is a stand-in.
 *
 * Run: bun test scripts/wins.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86ewvnqj5",
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
const core = await import("../src/lib/winsCore");
const staff = await import("../src/forms/staff/formSheetCore");
const defs = await import("../src/forms/staff/formDefs");
const wins = await import("../src/lib/wins");
const ui = await import("../src/components/ClientWins");
const checks = await import("../src/components/billing/ChecksWaiting");
const settings = await import("../src/pages/SettingsPage");
const fx = await import("../src/dev/winsFixtures");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
async function draw(el: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(el));
  await flush();
  return { host: host as any, root };
}
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  });
const body = () => win.document.body as any;
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string, root: any = body()) =>
  [...root.querySelectorAll("button")].find(
    (b: any) => text(b) === label,
  ) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush();
}
async function type(el: any, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new (win as any).Event("input", { bubbles: true }));
  });
  await flush();
}
async function pick(label: string) {
  const l = [...body().querySelectorAll("label")].find(
    (x: any) => text(x) === label,
  ) as any;
  expect(l).toBeTruthy();
  await click(l.querySelector("input"));
}
const clear = async (root: any) => {
  await act(async () => root.unmount());
  const i = roots.indexOf(root);
  if (i >= 0) roots.splice(i, 1);
  await flush();
  body().innerHTML = "";
  // FormSheet keeps a draft per form and client; each test starts clean.
  win.localStorage.clear();
};

const OPEN = { open: true, why: null } as const;
const OFF = { open: false, why: "off" } as const;
const MISSING = { open: false, why: "missing" } as const;
const TODAY = core.kuwaitToday();

// --- Words and rules ------------------------------------------------------------

describe("Log a win's words (3.1, 4.2, 5.1)", () => {
  test("every kind's word, the upsells apart, and the stage words", () => {
    expect(core.WIN_KINDS.map(k => k.label)).toEqual([
      "Google review",
      "Video testimonial",
      "Podcast case study",
      "Referral",
      "Renewal",
      "Reactivation",
      "Website",
      "Social media management",
      "Back-end programme",
      "SEO and AI search",
      "Second campaign",
    ]);
    expect(defs.WIN_KIND_OPTIONS.map(o => o.label)).toEqual(
      core.WIN_KINDS.map(k => k.label),
    );
    expect(core.STAGE_WORDS).toEqual({
      logged: "Logged",
      quote_given: "Offered",
      signed: "Accepted",
      paid: "Paid",
      void: "Voided",
    });
  });

  test("the proof field per kind, with the database's sentence", () => {
    const def = defs.winDef({ client: fx.CLIENT, ...fx.CONTEXT });
    const shownFor = (kind: string) =>
      def.fields
        .filter(f => staff.shown(f, { kind }) && f.type !== "heading")
        .map(f => f.label);
    expect(shownFor("review")).toContain("Review link or screenshot link");
    expect(shownFor("video_testimonial")).toContain("Video link");
    expect(shownFor("podcast")).toContain("Episode link");
    expect(shownFor("referral")).toContain("Referred client");
    expect(shownFor("renewal")).toContain(
      "Agreement link (optional now, needed for pay)",
    );
    expect(shownFor("reactivation")).toContain(
      "Agreement link (optional now, needed for pay)",
    );
    for (const k of ["upsell_website", "upsell_smm"]) {
      expect(shownFor(k)).toEqual(
        expect.arrayContaining([
          "Proposal",
          "Proof link",
          "Quoted price (USD)",
          "Monthly",
        ]),
      );
    }
    expect(shownFor("review")).not.toContain("Quoted price (USD)");
    const say = (a: Record<string, unknown>) =>
      Object.values(staff.validate(def, { wonOn: TODAY, ...a }, TODAY));
    expect(say({ kind: "review" })).toEqual([
      "Add the review link or a screenshot link.",
    ]);
    expect(say({ kind: "video_testimonial" })).toEqual(["Add the video link."]);
    expect(say({ kind: "podcast" })).toEqual(["Add the episode link."]);
    expect(say({ kind: "referral" })).toEqual([
      "Pick the referred client's signed deal.",
    ]);
    // Renewal and reactivation log without proof, then wait for pay.
    expect(say({ kind: "renewal" })).toEqual([]);
    expect(say({ kind: "upsell_website" })).toEqual(
      expect.arrayContaining(["Add the quoted price."]),
    );
    expect(
      say({
        kind: "upsell_website",
        proposalId: fx.CONTEXT.proposals[0].id,
        quotedUsd: "1200",
      }),
    ).toEqual(["Say why the price is below the list price."]);
    expect(
      say({
        kind: "review",
        proofReview: "https://x.test/r",
        wonOn: "2026-01-01",
      }),
    ).toEqual(["The win date is today or within the last 30 days."]);
    expect(core.SAY.draft).toBe(
      "Send the proposal first. A draft is not a win.",
    );
  });

  test("the warnings and refusals the database says, word for word", () => {
    expect(core.reviewWarning(fx.CLIENT, "1 Nov")).toBe(
      "A Google review was logged for Ardon Interiors on 1 Nov. Log this one too?",
    );
    expect(core.renewalWarning(fx.CLIENT, "1 Nov")).toBe(
      "A renewal was logged for Ardon Interiors on 1 Nov. Log this one too?",
    );
    expect(core.referralRefused("22 Oct")).toBe(
      "That deal is already logged as a referral win on 22 Oct.",
    );
    expect(core.reactivationRefused(fx.CLIENT, "1 Nov")).toBe(
      "Ardon Interiors was reopened on 1 Nov and that return already has its win.",
    );
    expect(core.SAY.network).toBe(
      "Not saved. Check your connection and press Log the win again.",
    );
  });

  test("a sent proposal makes it Mark as offered; the args carry its price", () => {
    const def = defs.winDef({ client: fx.CLIENT, ...fx.CONTEXT });
    expect(def.title).toBe("Log a win for Ardon Interiors");
    expect(def.submitLabel({ kind: "review" })).toBe("Log the win");
    expect(def.submitLabel({ kind: "upsell_website", proposalId: "p" })).toBe(
      "Mark as offered",
    );
    const args = wins.winLogArgs(
      fx.TASK,
      {
        kind: "upsell_website",
        wonOn: TODAY,
        proposalId: fx.CONTEXT.proposals[0].id,
        quotedUsd: "1500",
        proofReview: "https://ignored.test",
      },
      "req-1",
      fx.CONTEXT,
    );
    expect(args).toMatchObject({
      requestId: "req-1",
      taskId: fx.TASK,
      kind: "upsell_website",
      proposalId: fx.CONTEXT.proposals[0].id,
      quotedUsd: 1500,
      listUsd: 1800,
      proofUrl: null,
    });
    expect(
      wins.winLogArgs(
        fx.TASK,
        {
          kind: "review",
          proofReview: "https://r.test",
          confirmDuplicate: true,
        },
        "r",
      ),
    ).toMatchObject({ proofUrl: "https://r.test", confirmDuplicate: true });
  });
});

describe("the win ribbon (5.0)", () => {
  const stops = (w: (typeof fx.WINS)[number]) =>
    core
      .ribbonOf(w)
      .stops.map(
        s => `${s.label}:${s.state}${s.sentence ? `:${s.sentence}` : ""}`,
      );

  test("every stage and pay state in 5.0's words", () => {
    const [review, offered, accepted, paid, referral, voided] = fx.WINS;
    expect(stops(review)).toEqual([
      "Logged:done",
      "Pay:waiting:Waiting for the CEO to confirm",
    ]);
    expect(stops(offered)).toEqual([
      "Offered:done",
      "Accepted:todo",
      "Paid:todo",
      "Pay:todo",
    ]);
    expect(stops(accepted)).toEqual([
      "Offered:done",
      "Accepted:done",
      "Paid:waiting:$600 waiting for the CEO to confirm",
      "Pay:waiting:Cash not checked yet",
    ]);
    expect(stops(paid)).toEqual([
      "Offered:done",
      "Accepted:done",
      "Paid:done",
      "Pay:waiting:Waiting for the CEO to confirm",
    ]);
    expect(stops(referral)).toEqual([
      "Logged:done",
      "Pay:waiting:The referred client has not paid yet",
    ]);
    expect(core.ribbonOf(voided).voided).toEqual({
      reason: "The client chose another agency",
    });
    expect(
      stops({
        ...review,
        pay: { state: "confirmed", why: null, amountUsd: 75 },
      }),
    ).toEqual(["Logged:done", "Pay:done"]);
    expect(
      stops({
        ...review,
        pay: {
          state: "declined",
          why: "Not a 5-star review.",
          amountUsd: null,
        },
      }),
    ).toEqual(["Logged:done", "Pay:declined:Declined: Not a 5-star review"]);
    // Done stops carry their day.
    expect(core.ribbonOf(paid).stops.map(s => s.date)).toEqual([
      "5 Oct",
      "8 Oct",
      "12 Oct",
      "",
    ]);
  });

  test("money at the right end; a missing amount is not known, never $0", () => {
    expect(core.ribbonOf(fx.WINS[3]).money).toBe("$1,500 tied · $150 proposed");
    expect(core.ribbonOf(fx.WINS[1]).money).toBe("$1,500 quoted");
    expect(core.ribbonOf(fx.WINS[0]).money).toBe("$75 proposed");
    expect(
      core.ribbonOf({
        ...fx.WINS[3],
        tiedUsd: null,
        pay: { state: "proposed", why: null, amountUsd: null },
      }).money,
    ).toBe("not known tied · not known proposed");
    expect(core.money(null)).toBe("not known");
  });

  test("the actions per stage (5.2) and the MRR prompt of a paid recurring win", () => {
    expect(core.actionsOf(fx.WINS[1])).toEqual(["accept", "void"]);
    expect(core.actionsOf(fx.WINS[2])).toEqual(["invoice", "tie", "void"]);
    expect(core.actionsOf(fx.WINS[3])).toEqual(["mrr"]);
    expect(core.mrrPrompt(fx.WINS[3])).toBe("Add $500 to MRR?");
    expect(core.mrrPrompt(fx.WINS[2])).toBeNull();
  });
});

describe("doors (3.10)", () => {
  test("missing reads Opens after the next cockpit update.; off reads Not switched on yet.", () => {
    expect(core.doorLine(MISSING)).toBe("Opens after the next cockpit update.");
    expect(core.doorLine(OFF)).toBe("Not switched on yet.");
    expect(core.doorLine(OPEN)).toBeNull();
    expect(core.doorLine(null)).toBe("Opens after the next cockpit update.");
  });
  test("both shapes of why, and an older function's false flag reads missing", () => {
    expect(
      core.readDoorsW56({ wins: false, why: { wins: "off" } }).wins,
    ).toEqual(OFF);
    expect(core.readDoorsW56({ ltv: false, ltvWhy: "off" }).ltv).toEqual(OFF);
    expect(core.readDoorsW56({ wins: true }).wins).toEqual(OPEN);
    expect(core.readDoorsW56({ checks: true })).toEqual(core.ALL_CLOSED);
    expect(core.readDoorsW56(null).kickoff).toEqual(MISSING);
  });
});

describe("Today bands (5.12)", () => {
  test("each band's words and action; the CEO's count only for the CEO", () => {
    const bands = core.todayBands(fx.BAND_ROWS, {
      ceo: true,
      today: "2026-11-02",
    });
    expect(bands.map(b => [b.text, b.action])).toEqual([
      [
        "Client accepted: send the agreement for the Website (Ardon Interiors)",
        "Open the proposal",
      ],
      [
        "Invoice paid: tie it to the Social media management (Ardon Interiors)",
        "Tie the payment",
      ],
      ["Upsell payments to confirm: 2", "Open Money"],
      ["Receipt in: شركة العلا للتصميم", "Open Checks waiting"],
      ["Back: Dusk Arch", "Open the relaunch ticket"],
      [
        "Receipt checked: confirm the part paid (Ardon Interiors)",
        "Open Pending payments",
      ],
      [
        "Payment due 30 Oct, no money in: ask for the receipt (Imperium Studio)",
        "Ask for the receipt",
      ],
    ]);
    const csm = core.todayBands(fx.BAND_ROWS, {
      ceo: false,
      today: "2026-11-02",
    });
    expect(csm.some(b => b.kind === "tie_waiting")).toBe(false);
    // 20261102h gives one row per open proposal: they count into one band.
    const perProposal = core.todayBands(
      [
        { kind: "tie_waiting", proposalId: "11", client: "Acme" },
        { kind: "tie_waiting", proposalId: "12", client: "Beta" },
        { kind: "tie_waiting", proposalId: "13", client: "Gamma" },
      ],
      { ceo: true, today: "2026-11-02" },
    );
    expect(perProposal.map(b => b.text)).toEqual([
      "Upsell payments to confirm: 3",
    ]);
  });
  test("Back for 7 days only; due, no money skips Paused and Stopped cards; empty hides", () => {
    const later = core.todayBands(fx.BAND_ROWS, {
      ceo: false,
      today: "2026-11-08",
    });
    expect(later.some(b => b.kind === "back")).toBe(false);
    const sixth = core.todayBands(fx.BAND_ROWS, {
      ceo: false,
      today: "2026-11-07",
    });
    expect(sixth.some(b => b.kind === "back")).toBe(true);
    const skip = core.todayBands(fx.BAND_ROWS, {
      ceo: false,
      today: "2026-11-02",
      pausedOrStopped: t => t === "86eydue001",
    });
    expect(skip.some(b => b.kind === "due_no_money")).toBe(false);
    expect(core.todayBands([], { ceo: true, today: "2026-11-02" })).toEqual([]);
    const due = core
      .todayBands(fx.BAND_ROWS, { ceo: false, today: "2026-11-02" })
      .find(b => b.kind === "due_no_money");
    expect(due?.ref).toMatchObject({
      part: "later",
      partNo: 1,
      expectedAmount: 1500,
      currency: "USD",
      dueOn: "2026-10-30",
    });
  });
});

describe("Client is back (4.12, 5.11, X30)", () => {
  test("shown with a confirmed departure; disabled on a Stopped card without one; hidden otherwise", () => {
    expect(
      core.reactivateState({
        status: "Stopped",
        departureId: 6,
        churnConfirmedAt: "2026-10-31T10:00:00Z",
      }),
    ).toEqual({ show: true, enabled: true, departureId: 6 });
    expect(
      core.reactivateState({ status: "Stopped", departureId: null }),
    ).toEqual({
      show: true,
      enabled: false,
      why: "Confirm the churn first with Client is leaving, then reopen.",
    });
    expect(
      core.reactivateState({ status: "Active", departureId: null }),
    ).toEqual({ show: false });
    expect(
      core.reactivateState({
        status: "Stopped",
        departureId: 6,
        churnConfirmedAt: "x",
        returnedOn: "2026-11-01",
      }),
    ).toEqual({ show: true, enabled: false, why: core.CONFIRM_CHURN_FIRST });
    expect(core.noConfirmedChurn(fx.CLIENT)).toBe(
      "Ardon Interiors has no confirmed churn. Confirm the churn first with Client is leaving, then reopen.",
    );
  });
  test("the sheet's words and its checks are the database's", () => {
    const def = defs.reactivateDef(fx.CLIENT, {
      id: 6,
      leftOn: "2026-10-18",
      reason: "Cancelled",
      churnType: "mid_programme",
    });
    expect(def.title).toBe("Ardon Interiors is back");
    expect(def.lede).toBe("Left on 18 Oct · Cancelled · Mid-programme loss");
    expect(def.submitLabel({})).toBe("Reopen the client");
    expect(def.fields.map(f => f.label)).toEqual([
      "Back from",
      "Back as",
      "Next payment date (optional)",
      "MRR (USD, optional)",
      "Agreement link (optional, needed for pay)",
      "Why did they come back?",
      "Call (optional)",
    ]);
    const say = (a: Record<string, unknown>) =>
      Object.values(staff.validate(def, a, "2026-11-02"));
    expect(
      say({ returnOn: "2026-11-02", status: "Active", why: "short" }),
    ).toEqual(["Say why they came back in 10 to 500 characters."]);
    expect(
      say({
        returnOn: "2026-10-01",
        status: "Active",
        why: "They missed the leads coming in.",
      }),
    ).toEqual([
      "The return date is on or after the day they left, and within 14 days from now.",
    ]);
    expect(
      say({
        returnOn: "2026-11-30",
        status: "Active",
        why: "They missed the leads coming in.",
      }),
    ).toEqual([
      "The return date is on or after the day they left, and within 14 days from now.",
    ]);
    const trail = staff.trailFrom(
      {
        stored: { state: "done" },
        card: { state: "queued" },
        notice: { state: "posted", channelName: "csm-announcements" },
      },
      def,
    );
    expect(trail.map(s => s.label)).toEqual([
      "Stored",
      "Card queued",
      "Posted in #csm-announcements",
    ]);
    expect(
      staff.trailFrom(
        { stored: { state: "done" }, card: { state: "held" } },
        def,
      )[1].label,
    ).toBe("Waits for the switch-on");
  });
});

describe("the retire list (5.14)", () => {
  test("state words", () => {
    const w = fx.RETIRE.map(i => core.retireState(i, "2026-11-16"));
    expect(w[0]).toBe("Still on");
    expect(w[1]).toBe("Switched off 1 Nov · Archive from 15 Nov (ready)");
    expect(w[2]).toBe("Closed 2 Nov · Archive from 16 Nov (ready)");
    expect(w[3]).toBe("Archived 2 Nov");
    expect(w[4]).toBe("Kept: stays (D14)");
    expect(core.retireState(fx.RETIRE[1], "2026-11-10")).toBe(
      "Switched off 1 Nov · Archive from 15 Nov",
    );
  });
});

// --- Screens --------------------------------------------------------------------

type Calls = { name: string; args: any }[];
function stubApi(
  over: Partial<import("../src/components/ClientWins").WinsApi> = {},
) {
  const calls: Calls = [];
  const api: import("../src/components/ClientWins").WinsApi = {
    read: async t => {
      calls.push({ name: "read", args: t });
      return {
        wins: fx.WINS,
        acceptedProposals: [],
        doorOpen: true,
        context: fx.CONTEXT,
      };
    },
    list: async (f, t) => {
      calls.push({ name: "list", args: [f, t] });
      return {
        wins: fx.WINS,
        totals: {
          upsellsOffered: 3,
          upsellsAccepted: 2,
          upsellCashChecked: 1500,
          reviewsAndTestimonials: null,
        },
      };
    },
    log: async (taskId, a, requestId) => {
      calls.push({ name: "log", args: { taskId, a, requestId } });
      return {
        ok: true,
        winId: "w1",
        stage: "logged",
        sentence: "Logged.",
        ref: { winId: "w1" },
      };
    },
    stage: async p => {
      calls.push({ name: "stage", args: p });
      return p.act === "void" ? "Voided." : "Marked as accepted.";
    },
    candidates: async w => {
      calls.push({ name: "candidates", args: w });
      return fx.CANDIDATES;
    },
    propose: async p => {
      calls.push({ name: "propose", args: p });
      return "Sent to the CEO to confirm.";
    },
    trail: async () => ({ stored: { state: "done" }, card: { state: "held" } }),
    offered: async a => {
      calls.push({ name: "offered", args: a });
      return {
        ok: true,
        winId: "w2",
        stage: "quote_given",
        sentence: "Marked as offered.",
      };
    },
    linkInvoice: async () => {},
    ...over,
  };
  return { api, calls };
}

describe("Log a win sheet (5.1)", () => {
  test("proof per kind on screen, then the SQL sentence on a press without it", async () => {
    const { api, calls } = stubApi();
    const { root } = await draw(
      createElement(ui.LogWinSheet, {
        open: true,
        onOpenChange: () => {},
        api,
        taskId: fx.TASK,
        client: fx.CLIENT,
        context: fx.CONTEXT,
      }),
    );
    expect(text(body().querySelector(".fs-title"))).toBe(
      "Log a win for Ardon Interiors",
    );
    expect(text(body())).toContain("Upsells");
    await pick("Google review");
    expect(text(body())).toContain("Review link or screenshot link");
    await click(button("Log the win"));
    expect(text(body())).toContain("Add the review link or a screenshot link.");
    expect(calls.filter(c => c.name === "log")).toHaveLength(0);
    await pick("Video testimonial");
    expect(text(body())).toContain("Video link");
    expect(text(body())).not.toContain("Review link or screenshot link");
    await pick("Referral");
    expect(text(body())).toContain("Referred client");
    expect(text(body())).toContain("Liwan Fit-out · signed 22 Oct");
    await clear(root);
  });

  test("one request id per open sheet, kept through a lost connection; Logged.", async () => {
    let n = 0;
    const ids: string[] = [];
    const { api } = stubApi({
      log: async (_t, _a, requestId) => {
        ids.push(requestId);
        n += 1;
        if (n === 1) throw new Error("Failed to fetch");
        return {
          ok: true,
          winId: "w1",
          stage: "logged",
          sentence: "Logged.",
          ref: { winId: "w1" },
        };
      },
    });
    const { root } = await draw(
      createElement(ui.LogWinSheet, {
        open: true,
        onOpenChange: () => {},
        api,
        taskId: fx.TASK,
        client: fx.CLIENT,
        context: fx.CONTEXT,
        preset: [{ key: "kind", value: "review", source: "the review ask" }],
      }),
    );
    const proof = body().querySelector("input[placeholder='https://']");
    await type(proof, "https://g.page/r/abc/review");
    await click(button("Log the win"));
    expect(text(body())).toContain(
      "Not saved. Check your connection and press Log the win again.",
    );
    await click(button("Log the win"));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(toasts).toContain("Logged.");
    expect(text(body())).toContain("Win stored");
    expect(text(body())).toContain("Waits for the switch-on");
    await clear(root);
  });

  test("a duplicate warns and stores nothing; Log it anyway sends again with confirmDuplicate", async () => {
    const seen: any[] = [];
    const { api } = stubApi({
      log: async (_t, a, requestId) => {
        seen.push({ a, requestId });
        if (!a.confirmDuplicate)
          return {
            ok: false,
            warning: core.reviewWarning(fx.CLIENT, "28 Oct"),
            ref: {},
          } as any;
        return {
          ok: true,
          winId: "w9",
          stage: "logged",
          sentence: "Logged.",
          ref: { winId: "w9" },
        };
      },
    });
    const { root } = await draw(
      createElement(ui.LogWinSheet, {
        open: true,
        onOpenChange: () => {},
        api,
        taskId: fx.TASK,
        client: fx.CLIENT,
        context: fx.CONTEXT,
        preset: [{ key: "kind", value: "review", source: "the review ask" }],
      }),
    );
    await type(
      body().querySelector("input[placeholder='https://']"),
      "https://g.page/r/abc/review",
    );
    await click(button("Log the win"));
    expect(text(body().querySelector("[data-warning]"))).toContain(
      "A Google review was logged for Ardon Interiors on 28 Oct. Log this one too?",
    );
    expect(button("Cancel")).toBeTruthy();
    await click(button("Log it anyway"));
    expect(seen).toHaveLength(2);
    expect(seen[1].a.confirmDuplicate).toBe(true);
    expect(seen[1].requestId).toBe(seen[0].requestId);
    expect(text(body())).toContain("Win stored");
    await clear(root);
  });

  test("a refusal reads the database's sentence unchanged", async () => {
    const { api } = stubApi({
      log: async () => {
        throw new Error(core.referralRefused("22 Oct"));
      },
    });
    const { root } = await draw(
      createElement(ui.LogWinSheet, {
        open: true,
        onOpenChange: () => {},
        api,
        taskId: fx.TASK,
        client: fx.CLIENT,
        context: fx.CONTEXT,
        preset: [
          { key: "kind", value: "referral", source: "x" },
          { key: "referralDealResponseId", value: "resp_ref_1", source: "x" },
        ],
      }),
    );
    await click(button("Log the win"));
    expect(text(body())).toContain(
      "That deal is already logged as a referral win on 22 Oct.",
    );
    await clear(root);
  });
});

describe("Wins on the client page (5.2)", () => {
  test("a door missing or off makes no call and says why", async () => {
    for (const [door, line] of [
      [MISSING, "Opens after the next cockpit update."],
      [OFF, "Not switched on yet."],
    ] as const) {
      const { api, calls } = stubApi();
      const { root } = await draw(
        createElement(ui.ClientWins, {
          api,
          door,
          taskId: fx.TASK,
          client: fx.CLIENT,
        }),
      );
      expect(text(body().querySelector("[data-door-closed]"))).toBe(line);
      expect(calls).toHaveLength(0);
      await clear(root);
      const btn = await draw(
        createElement(ui.LogWinButton, { door, onClick: () => {} }),
      );
      expect(text(body())).toBe(`Log a win: ${line}`);
      await clear(btn.root);
    }
  });

  test("ribbons, actions per stage, the void and the empty line", async () => {
    const { api, calls } = stubApi();
    const { root } = await draw(
      createElement(ui.ClientWins, {
        api,
        door: OPEN,
        taskId: fx.TASK,
        client: fx.CLIENT,
        onSetMrr: () => {},
      }),
    );
    expect(body().querySelectorAll("[data-win]").length).toBe(fx.WINS.length);
    expect(text(body())).toContain("Mark accepted");
    expect(text(body())).toContain("Tie a payment");
    expect(text(body())).toContain("Add $500 to MRR?");
    expect(text(body().querySelector("[data-cut]"))).toBe(
      "Voided: The client chose another agency",
    );
    const voids = [...body().querySelectorAll("button")].filter(
      (b: any) => text(b) === "Void",
    );
    await click(voids[0]);
    expect(text(body())).toContain("Why are you voiding it?");
    await click(button("Void", body().querySelector("[role='dialog']")));
    expect(text(body())).toContain("Say why in 3 to 300 characters.");
    await clear(root);
    expect(calls[0]).toEqual({ name: "read", args: fx.TASK });
    const empty = stubApi({
      read: async () => ({
        wins: [],
        acceptedProposals: [],
        doorOpen: true,
        context: fx.CONTEXT,
      }),
    });
    const e = await draw(
      createElement(ui.ClientWins, {
        api: empty.api,
        door: OPEN,
        taskId: fx.TASK,
        client: fx.CLIENT,
      }),
    );
    expect(text(body())).toContain("No wins yet. Log one with Log a win.");
    await clear(e.root);
  });

  test("the tie dialog lists candidates with the not-checked and closer chips, then sends", async () => {
    const { api, calls } = stubApi();
    const { root } = await draw(
      createElement(ui.TieDialog, {
        api,
        win: fx.WINS[2],
        onClose: () => {},
        onDone: (s: string) => toasts.push(s),
      }),
    );
    const rows = [...body().querySelectorAll("[data-candidate]")].map(text);
    expect(rows[0]).toBe("Whop · $600 · 1 Nov");
    expect(rows[1]).toBe("Transfer · $600 · 31 OctNot checked yet");
    expect(rows[2]).toBe("Tap · $1,500 · 30 OctCounts for the closer now");
    await click(
      body().querySelector("[data-candidate='whop:pay_upsell_1'] input"),
    );
    await click(button("Send to the CEO"));
    expect(calls.find(c => c.name === "propose")?.args).toMatchObject({
      winId: fx.WINS[2].id,
      paymentId: "whop:pay_upsell_1",
    });
    expect(toasts).toContain("Sent to the CEO to confirm.");
    await clear(root);
  });
});

describe("Offer Studio (5.3)", () => {
  const facts = {
    id: "11111111-1111-4111-8111-111111111111",
    taskId: fx.TASK,
    status: "draft",
    kind: "upsell_website",
    totalUsd: 1500,
    listUsd: 1800,
  };
  test("Mark as offered is disabled on a draft with its hint", async () => {
    const { api, calls } = stubApi();
    const { root } = await draw(
      createElement(ui.MarkOffered, {
        api,
        door: OPEN,
        proposal: facts,
        win: null,
      }),
    );
    const b = button("Mark as offered");
    expect(b.disabled).toBe(true);
    expect(text(body())).toContain(
      "Send the proposal first. A draft is not a win.",
    );
    await click(b);
    expect(calls).toHaveLength(0);
    await clear(root);
  });
  test("a sent proposal marks as offered with its price; accepted shows the banner; once offered the ribbon", async () => {
    const { api, calls } = stubApi();
    const sent = await draw(
      createElement(ui.MarkOffered, {
        api,
        door: OPEN,
        proposal: { ...facts, status: "sent" },
        win: null,
      }),
    );
    await click(button("Mark as offered"));
    expect(calls[0].args).toMatchObject({
      proposalId: facts.id,
      kind: "upsell_website",
      quotedUsd: 1500,
      listUsd: 1800,
    });
    expect(text(body())).toContain("Marked as offered.");
    await clear(sent.root);
    const acc = await draw(
      createElement(ui.MarkOffered, {
        api,
        door: OPEN,
        proposal: { ...facts, status: "accepted" },
        win: fx.WINS[1],
      }),
    );
    expect(text(body())).toContain(
      "The client accepted. Send the agreement, then mark it accepted with the agreement link.",
    );
    expect(body().querySelector("[data-win]")).toBeTruthy();
    await clear(acc.root);
    const off = await draw(
      createElement(ui.MarkOffered, {
        api,
        door: OFF,
        proposal: facts,
        win: null,
      }),
    );
    expect(text(body())).toBe("Not switched on yet.");
    await clear(off.root);
  });
});

describe("Money tab wins (5.2)", () => {
  test("filters and the four tiles; a missing total is not known", async () => {
    const { api, calls } = stubApi();
    const { root } = await draw(
      createElement(ui.MoneyWins, { api, door: OPEN }),
    );
    for (const w of ["This month", "Last month", "Pick dates"])
      expect(button(w)).toBeTruthy();
    const t = text(body());
    expect(t).toContain("Upsells offered3");
    expect(t).toContain("Accepted2");
    expect(t).toContain("Upsell cash (checked)$1,500");
    expect(t).toContain("Reviews and testimonialsnot known");
    await click(button("Last month"));
    expect(calls.filter(c => c.name === "list")).toHaveLength(2);
    await clear(root);
  });
});

describe("Client is back on the client page (5.11)", () => {
  test("enabled only with a confirmed departure; a Stopped card without one shows it disabled", async () => {
    const a = await draw(
      createElement(ui.ReactivateAction, {
        state: core.reactivateState({ status: "Stopped", departureId: null }),
        door: OPEN,
        onOpen: () => {},
      }),
    );
    expect(button("Client is back").disabled).toBe(true);
    expect(text(body())).toContain(
      "Confirm the churn first with Client is leaving, then reopen.",
    );
    await clear(a.root);
    let opened = 0;
    const b = await draw(
      createElement(ui.ReactivateAction, {
        state: core.reactivateState({
          status: "Stopped",
          departureId: 6,
          churnConfirmedAt: "2026-10-31T10:00:00Z",
        }),
        door: OPEN,
        onOpen: () => {
          opened += 1;
        },
      }),
    );
    await click(button("Client is back"));
    expect(opened).toBe(1);
    await clear(b.root);
    const c = await draw(
      createElement(ui.ReactivateAction, {
        state: core.reactivateState({ status: "Active", departureId: null }),
        door: OPEN,
        onOpen: () => {},
      }),
    );
    expect(text(body())).toBe("");
    await clear(c.root);
  });
});

describe("Checks waiting receipts (5.6)", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "mp_1",
    day: "2026-10-30",
    clientName: fx.CLIENT,
    taskId: fx.TASK,
    amount: 450,
    currency: "KWD" as const,
    amountUsd: 1467,
    rail: "transfer",
    kind: "payment" as const,
    reference: null,
    evidenceUrl: null,
    addedBy: "The client",
    addedAt: "2026-10-30T10:00:00Z",
    daysWaiting: 2,
    ...over,
  });
  const api = (rows: any[]) => ({
    door: async () => true,
    list: async () => rows,
    check: async () =>
      ({ id: "mp_1", state: "checked" as const, sentence: "Checked." }) as any,
    ticketType: async () => false,
    receiptUrl: async () => "https://storage.test/signed",
  });
  test("View the receipt, Download to view for HEIC, the near-match line", async () => {
    const { root } = await draw(
      createElement(checks.ChecksWaitingView, {
        api: api([
          row({
            receipt: {
              responseId: "r1",
              field: "receipt",
              mime: "application/pdf",
              at: "2026-10-31T09:00:00Z",
            },
          }),
          row({
            id: "mp_2",
            receipt: {
              responseId: "r2",
              field: "receipt",
              mime: "image/heic",
              at: "2026-10-31T09:00:00Z",
            },
          }),
          row({
            id: "mp_3",
            nearMatch: { day: "2026-10-29", amount: 450, currency: "KWD" },
          }),
        ]),
        canCheck: true,
      }),
    );
    const receipts = [...body().querySelectorAll("[data-client-receipt]")].map(
      text,
    );
    expect(receipts[0]).toContain("Receipt from the client ·");
    expect(receipts[0]).toContain("View the receipt");
    expect(receipts[1]).toContain("Download to view");
    expect(text(body().querySelector("[data-near-match]"))).toBe(
      "May be the same transfer as 29 Oct 450.000 KWD",
    );
    await clear(root);
  });
  test("Ask the client for the receipt on a logged transfer without one", async () => {
    const asked: any[] = [];
    const { root } = await draw(
      createElement(checks.ChecksWaitingView, {
        api: api([
          row({ askable: true }),
          row({
            id: "mp_9",
            askable: true,
            receipt: {
              responseId: "r",
              field: "receipt",
              mime: "image/png",
              at: null,
            },
          }),
        ]),
        canCheck: true,
        onAskReceipt: (r: any) => asked.push(r.id),
      }),
    );
    const asks = body().querySelectorAll("[data-ask-receipt]");
    expect(asks.length).toBe(1);
    await click(asks[0]);
    expect(asked).toEqual(["mp_1"]);
    await clear(root);
    expect(checks.isHeic("image/heif")).toBe(true);
    expect(
      checks.toCheckRow({
        ...row(),
        receipt: { responseId: "x" },
        askable: true,
      }).receipt,
    ).toEqual({
      responseId: "x",
      field: "receipt",
      mime: null,
      at: null,
    });
  });
});

describe("Today's bands and the retire list on screen", () => {
  test("WinBands draws each band with its action; nothing when empty", async () => {
    const seen: string[] = [];
    const bands = core.todayBands(fx.BAND_ROWS, {
      ceo: true,
      today: "2026-11-02",
    });
    const { root } = await draw(
      createElement(ui.WinBands, {
        bands,
        onAction: (b: any) => seen.push(b.kind),
      }),
    );
    expect(body().querySelectorAll("[data-band]").length).toBe(7);
    await click(button("Ask for the receipt"));
    expect(seen).toEqual(["due_no_money"]);
    await clear(root);
    const none = await draw(
      createElement(ui.WinBands, { bands: [], onAction: () => {} }),
    );
    expect(body().querySelector("[data-win-bands]")).toBeNull();
    await clear(none.root);
  });
  test("Old forms and scenarios lists every item with its words", async () => {
    const { root } = await draw(
      createElement(settings.RetiredForms, {
        read: async () => fx.RETIRE,
        now: Date.parse("2026-11-10T08:00:00Z"),
      }),
    );
    const t = text(body());
    expect(t).toContain("Old forms and scenarios");
    expect(t).toContain(
      "Four Rs: client review to sheet · Make scenarioStill on",
    );
    expect(t).toContain("Replaced by Log a win · owner: the systems manager");
    expect(t).toContain("Kept: stays (D14)");
    expect(body().querySelectorAll("[data-retire]").length).toBe(
      fx.RETIRE.length,
    );
    await clear(root);
  });
});
