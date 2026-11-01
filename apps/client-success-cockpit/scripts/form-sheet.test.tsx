import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

/**
 * FormSheet, the staff forms' one sheet (docs/forms/WAVE12-CONTRACT.md 4.12,
 * 5.1, section 8 formsheet row): the five forms' keys as the contract lists
 * them; the CSS holds no colour of its own; the date and money words match
 * the CEO kit's format.ts and the client success format.ts on a fixed table,
 * and a missing amount is never "$0"; the check before a send says what the
 * database says, word for word; one request id per open sheet, kept through a
 * retry; every cockpit_form_trail state reads as 5.1's sentence; and the
 * sheet comes from the bottom at 375 px and from the right at 1280 px.
 * Nothing leaves the test: the sends and the trail are stand-ins.
 *
 * Run: bun test scripts/form-sheet.test.tsx
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

mock.module("sonner", () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: () => {} }),
  Toaster: () => null,
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const core = await import("../src/forms/staff/formSheetCore");
const defs = await import("../src/forms/staff/formDefs");
const { FormSheet, FormBody } = await import("../src/forms/staff/FormSheet");
const fx = await import("../src/dev/formSheetFixtures");
const csFormat = await import("../src/lib/format");
const ceoFormat = await import(
  "../../media-buyer-cockpit/src/components/ceo/format"
);
const churnCore = await import("../src/lib/churnCore");

const APP = join(import.meta.dir, "..");
const MB = join(APP, "..", "media-buyer-cockpit");
const read = (p: string) => readFileSync(p, "utf8");

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
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
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

describe("the five forms are the contract's (3.7)", () => {
  test("field keys, in order, equal the table (the registry records the same keys, W19)", () => {
    const expected: Record<string, string[]> = {
      extension: [
        "weeks",
        "reason",
        "ours",
        "limitations",
        "atRisk",
        "callId",
        "noCall",
        "noCallReason",
        "prevent",
      ],
      pause: [
        "pauseKind",
        "restart",
        "reasonCat",
        "reason",
        "callId",
        "consentTerm",
        "consentOver14",
      ],
      resume: ["on", "nextDate"],
      churn_confirm: [
        "leftOn",
        "noticeOn",
        "reason",
        "churnType",
        "whyDetail",
        "howToStop",
        "mrrLostUsd",
        "exitCallId",
        "surveyState",
      ],
      mrr: ["mrrUsd", "reasonCat", "reason", "effective"],
    };
    expect(Object.keys(defs.FORM_DEFS).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, keys] of Object.entries(expected))
      expect(defs.formKeys(key as any)).toEqual(keys);
  });

  test("titles, sends and done words", () => {
    const d = defs.FORM_DEFS;
    expect([
      d.extension.title,
      d.pause.title,
      d.resume.title,
      d.churn_confirm.title,
      d.mrr.title,
    ]).toEqual([
      "Give more time",
      "Pause this client",
      "Resume this client",
      "Client is leaving",
      "Set MRR",
    ]);
    expect(d.extension.submitLabel({ weeks: "2" })).toBe("Give 2 weeks");
    expect(d.extension.submitLabel({ weeks: "1" })).toBe("Give 1 week");
    expect(d.pause.submitLabel({})).toBe("Pause this client");
    expect(d.resume.submitLabel({})).toBe("Resume this client");
    expect(d.churn_confirm.submitLabel({})).toBe("Confirm churn");
    expect(d.mrr.submitLabel({ mrrUsd: "1500" })).toBe("Set MRR to $1,500");
    expect([
      d.extension.doneLabel,
      d.pause.doneLabel,
      d.resume.doneLabel,
      d.churn_confirm.doneLabel,
      d.mrr.doneLabel,
    ]).toEqual(["Given", "Paused", "Resumed", "Churn confirmed", "MRR set"]);
    // Red only for Pause and Confirm churn (5's shared plan).
    expect(
      Object.values(d)
        .filter(f => f.tone === "destructive")
        .map(f => f.key)
        .sort(),
    ).toEqual(["churn_confirm", "pause"]);
  });

  test("the eight limitations in order, the eight register reasons, the two churn types", () => {
    expect([...defs.LIMITATIONS]).toEqual([
      "No limitations",
      "Budget",
      "Launch slipped on their side",
      "Ad account or page issue",
      "Content not ready",
      "Team or owner change",
      "Season or holiday",
      "Other",
    ]);
    expect([...defs.CHURN_REASONS]).toEqual([...churnCore.REASONS]);
    expect(defs.CHURN_TYPES.map(t => t.value)).toEqual([
      "mid_programme",
      "completed",
    ]);
  });

  test("Give more time while a grant runs reads Add to the extension, with its date", () => {
    const live = defs.extensionDef("2026-11-16");
    expect(live.title).toBe("Add to the extension");
    expect(live.lede).toBe(
      "An extension runs to 16 Nov; these weeks add from that date.",
    );
    expect(defs.extensionDef(null).title).toBe("Give more time");
  });

  test("no send label cuts a first name: none carries the client's name at all", () => {
    for (const d of Object.values(defs.FORM_DEFS))
      for (const a of [{}, { weeks: "2", mrrUsd: "900" }]) {
        const label = d.submitLabel(a);
        for (const name of [fx.CLIENT.name, fx.CLIENT_ARABIC.name])
          for (const part of name.split(" "))
            expect(label.includes(part)).toBe(false);
      }
  });
});

describe("the files", () => {
  test("formSheet.css holds no literal colour, only the apps' tokens", () => {
    const css = read(join(APP, "src/forms/staff/formSheet.css"));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
    expect(css).not.toMatch(/\boklch\(/);
    for (const token of [
      "--mahara-teal",
      "--deep-space",
      "--card",
      "--warning",
      "--destructive",
      "--font-mono",
    ])
      expect(css).toContain(`var(${token}`);
    // The right sheet's width and the bottom sheet's height (5's plan).
    expect(css).toContain("min(560px, 100vw)");
    expect(css).toContain("92dvh");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  test("the five files are byte for byte the same in both apps", () => {
    for (const f of [
      "FormSheet.tsx",
      "formSheet.css",
      "formSheetCore.ts",
      "formDefs.ts",
      "lifecycleClient.ts",
    ])
      expect(read(join(MB, "src/forms/staff", f))).toBe(
        read(join(APP, "src/forms/staff", f)),
      );
  });

  test("formSheetCore imports nothing; FormSheet only what 4.12 allows", () => {
    expect(read(join(APP, "src/forms/staff/formSheetCore.ts"))).not.toMatch(
      /^(import |export .* from )/m,
    );
    const sheet = read(join(APP, "src/forms/staff/FormSheet.tsx"));
    const from = [...sheet.matchAll(/(?:from|import) +"([^"]+)"/g)].map(
      m => m[1],
    );
    for (const f of from)
      expect([
        "react",
        "lucide-react",
        "@/components/ui/sheet",
        "./formSheetCore",
        "./formSheet.css",
      ]).toContain(f);
  });
});

describe("dates and money read as format.ts reads them", () => {
  const DAYS = [
    "2026-11-16",
    "2026-01-01",
    "2026-12-31",
    "2026-02-28",
    "2026-10-08",
  ];
  test("kuwaitDay equals the client success shortDay and the CEO kit's shortDate", () => {
    for (const d of DAYS) {
      expect(core.kuwaitDay(d)).toBe(csFormat.shortDay(d));
      expect(core.kuwaitDay(d)).toBe(ceoFormat.shortDate(d));
    }
    // A timestamp is its Kuwait day: 22:30 UTC on 1 Nov is 2 Nov in Kuwait.
    const late = Date.parse("2026-11-01T22:30:00Z");
    expect(core.kuwaitDay("2026-11-01T22:30:00Z")).toBe(
      ceoFormat.shortDate(ceoFormat.kuwaitDay(late)),
    );
    expect(core.kuwaitIso(late)).toBe(ceoFormat.kuwaitDay(late));
    expect(core.kuwaitTime("2026-11-01T07:42:00Z")).toBe(
      ceoFormat.time(Date.parse("2026-11-01T07:42:00Z")),
    );
    expect(core.kuwaitDay(null)).toBe("");
  });

  test("usd equals the CEO kit's money; the client success format.ts has no money helper", () => {
    expect("money" in csFormat).toBe(false);
    for (const n of [
      0, 5, 84.5, 99.99, 100, 1234.5, 11333, 21239.16, -250, -84.5, 0.004,
      1_000_000,
    ])
      expect(core.usd(n)).toBe(ceoFormat.money(n));
  });

  test("a missing amount is said, never $0", () => {
    for (const v of [null, Number.NaN, Number.POSITIVE_INFINITY] as (
      | number
      | null
    )[]) {
      expect(core.usd(v)).toBe("missing");
      expect(core.usd(v)).not.toBe("$0");
    }
    expect(core.kwdWithUsd(null, null)).toBe("missing");
  });

  test("kwdWithUsd: the amount as paid, then its dollars by format.ts", () => {
    expect(core.kwdWithUsd(1500, 4890)).toBe(
      `1,500 KWD (${ceoFormat.money(4890)})`,
    );
    expect(core.kwdWithUsd(1500.25, 4890.8)).toBe(
      `1,500.25 KWD (${ceoFormat.money(4890.8)})`,
    );
    expect(core.kwdWithUsd(null, 4890)).toBe(ceoFormat.money(4890));
    expect(core.kwdWithUsd(250, null)).toBe("250 KWD (dollars missing)");
  });

  test("prefill chips: value · from source; a value nobody holds is its sentence", () => {
    expect(
      core.prefillLine({
        key: "nextDate",
        value: "2026-11-02",
        source: "the ClickUp card",
      }),
    ).toBe("2 Nov · from the ClickUp card");
    expect(
      core.prefillLine({
        key: "mrrUsd",
        value: 1500,
        source: "the ClickUp card",
      }),
    ).toBe("$1,500 · from the ClickUp card");
    expect(
      core.prefillLine({
        key: "nextAmountUsd",
        value: null,
        source: "Nobody holds this yet",
      }),
    ).toBe("Nobody holds this yet");
  });

  test("due hints", () => {
    expect(core.dueHint(3)).toBe("3 days late");
    expect(core.dueHint(1)).toBe("1 day late");
    expect(core.dueHint(0)).toBe("Due today");
    expect(core.dueHint(-3)).toBe("Due in 3 days");
    expect(core.dueHint(-9)).toBeNull();
    expect(core.dueHint(null)).toBeNull();
  });
});

describe("the check before a send says what the database says (3.1, 3.5)", () => {
  const T = fx.FIXTURE_TODAY;
  test("Client is leaving: the three SQL refusals, word for word", () => {
    const d = defs.FORM_DEFS.churn_confirm;
    const base = {
      reason: "Cancelled",
      churnType: "mid_programme",
      surveyState: "not_sent",
    };
    expect(core.validate(d, { ...base, leftOn: "2026-11-02" }, T).leftOn).toBe(
      "Pick the day they left, today or before.",
    );
    expect(core.validate(d, base, T).leftOn).toBe(
      "Pick the day they left, today or before.",
    );
    const short = core.validate(
      d,
      { ...base, leftOn: T, whyDetail: "too dear", howToStop: "call" },
      T,
    );
    expect(short.whyDetail).toBe(
      "Say why they left in detail, so the lock-in reads back.",
    );
    expect(short.howToStop).toBe("Say how we stop this next time.");
    expect(
      core.validate(
        d,
        {
          ...base,
          leftOn: T,
          whyDetail: "Their budget moved to a showroom.",
          howToStop: "Agree the budget at kickoff.",
        },
        T,
      ),
    ).toEqual({});
  });

  test("Pause for a client request: a call, a restart after today and both consents", () => {
    const d = defs.FORM_DEFS.pause;
    const out = core.validate(
      d,
      {
        pauseKind: "client_request",
        reasonCat: "client_asked",
        reason: "Ramadan break",
        restart: T,
      },
      T,
    );
    expect(out.restart).toBe("Pick the restart date, after today.");
    expect(out.callId).toBe("Pick the call where the client agreed the pause.");
    expect(out.consentTerm).toBe(
      "Tick both consents the client gave on the call.",
    );
    expect(out.consentOver14).toBe(
      "Tick both consents the client gave on the call.",
    );
    expect(
      core.validate(
        d,
        {
          pauseKind: "client_request",
          reasonCat: "client_asked",
          reason: "Ramadan break",
          restart: "2026-11-20",
          callId: "4211",
          consentTerm: true,
          consentOver14: true,
        },
        T,
      ),
    ).toEqual({});
    // Non-payment: no call, no consents, no restart needed.
    expect(
      core.validate(
        d,
        {
          pauseKind: "non_payment",
          reasonCat: "not_paying",
          reason: "15 days late",
        },
        T,
      ),
    ).toEqual({});
    // The over-14-days consent is bold when the restart is more than 14 days away.
    const tick = d.fields.find(f => f.key === "consentOver14");
    expect(tick?.emphasis?.({ restart: "2026-11-20" }, T)).toBe(true);
    expect(tick?.emphasis?.({ restart: "2026-11-10" }, T)).toBe(false);
  });

  test("Give more time: a call or a reason there was none; No limitations alone", () => {
    const d = defs.FORM_DEFS.extension;
    const base = {
      weeks: "2",
      reason: "Their launch slipped",
      ours: "no",
      atRisk: "no",
    };
    expect(core.validate(d, base, T).callId).toBe(
      "Pick the call where you agreed it, or tick that there was no call.",
    );
    expect(core.validate(d, { ...base, noCall: true }, T).noCallReason).toBe(
      "Say why there was no call, so the decision reads back.",
    );
    expect(
      core.validate(
        d,
        { ...base, noCall: true, noCallReason: "On WhatsApp only" },
        T,
      ),
    ).toEqual({});
    expect(
      core.validate(
        d,
        { ...base, callId: "4211", limitations: ["No limitations", "Budget"] },
        T,
      ).limitations,
    ).toBe("No limitations cannot go with another pick.");
  });

  test("Set MRR: 0, or lower than the card, needs a reason (Q13)", () => {
    const d = defs.FORM_DEFS.mrr;
    const base = { reasonCat: "downgrade", effective: T };
    expect(core.validate(d, { ...base, mrrUsd: "0" }, T).reason).toBeTruthy();
    expect(
      core.validate(d, { ...base, mrrUsd: "1500", _fromMrrUsd: 2000 }, T)
        .reason,
    ).toBeTruthy();
    expect(
      core.validate(d, { ...base, mrrUsd: "2500", _fromMrrUsd: 2000 }, T),
    ).toEqual({});
    expect(core.validate(d, { ...base, mrrUsd: "-5" }, T).mrrUsd).toBe(
      "Type the monthly amount in dollars, 0 or more.",
    );
  });
});

describe("the after-send trail reads 5.1's sentences", () => {
  const ext = defs.FORM_DEFS.extension;
  const labels = (k: string, def = ext) =>
    core.trailFrom(fx.TRAIL_ROWS[k], def).map(s => s.label);
  test("every card and notice state", () => {
    expect(labels("held")).toEqual([
      "Saved in the cockpit",
      "Held: card writes for extensions are off. When the CEO turns them on, this edit is reviewed and sent or closed.",
      "Not posted: the bot is not in #csm-announcements. Ask the CEO to invite it.",
      "No ticket for an extension",
    ]);
    expect(labels("queued").slice(1, 3)).toEqual([
      "Queued for the ClickUp card",
      "Posting…",
    ]);
    expect(labels("sending")[1]).toBe("Waiting for ClickUp to confirm");
    expect(labels("retry")[1]).toBe("Waiting for ClickUp to confirm");
    expect(labels("delivered").slice(1, 3)).toEqual([
      "Card shows it",
      "Posted in #csm-announcements",
    ]);
    expect(labels("failed")[1]).toBe(
      "ClickUp refused it: field 8cb9d308 is locked. It stays in the cockpit; tell the systems manager.",
    );
    expect(labels("skipped")[1]).toBe(
      "ClickUp already showed this, so nothing was written.",
    );
    expect(labels("voided")[1]).toBe("Voided in the cockpit: churned.");
    expect(labels("none")[0]).toBe("Saving in the cockpit");
  });

  test("the states map to the StatusChip tones, and the ticket step names its ticket", () => {
    const steps = core.trailFrom(
      fx.TRAIL_ROWS.held,
      defs.FORM_DEFS.pause,
      t => `/requests?type=${t}`,
    );
    expect(steps.map(s => s.state)).toEqual(["done", "held", "failed", "none"]);
    expect(steps.map(s => core.stepTone(s.state))).toEqual([
      "good",
      "warning",
      "critical",
      "neutral",
    ]);
    expect(steps[1].label).toContain("card writes for pauses are off");
    expect(steps[3].action).toEqual({
      label: "Open the pause tickets",
      href: "/requests?type=client_pause",
      type: "client_pause",
    });
    // The step says where the ticket stands; "Open the … ticket" is only its action, said once.
    expect(core.trailFrom({}, defs.FORM_DEFS.resume)[3].label).toBe(
      "The relaunch needs its ticket",
    );
    expect(core.trailFrom({}, defs.FORM_DEFS.churn_confirm)[3]).toMatchObject({
      label: "The offboarding needs its ticket",
      action: { label: "Open the offboarding ticket" },
    });
    expect(
      core
        .trailFrom({}, defs.FORM_DEFS.mrr)
        .map(s => s.label)
        .slice(2),
    ).toEqual(["No Slack notice for this form", "No ticket for an MRR change"]);
    const posted = core.trailFrom(fx.TRAIL_ROWS.delivered, ext)[2];
    expect(posted.action?.href).toBe(
      "https://mahara.slack.com/archives/C09SNG5BP53/p1",
    );
  });

  test("a lost connection reads as the 5.1 line; a refusal as the server's own words", () => {
    expect(
      core.sendError(new TypeError("Failed to fetch"), "Give 2 weeks"),
    ).toBe("Not saved. Check your connection and press Give 2 weeks again.");
    expect(
      core.sendError(
        new Error(
          "An extension already runs to 16 Nov. Open Give more time again to add weeks to it.",
        ),
        "x",
      ),
    ).toBe(
      "An extension already runs to 16 Nov. Open Give more time again to add weeks to it.",
    );
  });
});

describe("the sheet", () => {
  const setWidth = async (width: number) => {
    await act(async () => {
      (win as any).happyDOM.setViewport({ width, height: 900 });
    });
  };

  test("the layout: from the bottom at 375 px, from the right at 1280 px, the full name in a bdi", async () => {
    for (const [width, side] of [
      [375, "bottom"],
      [1280, "right"],
    ] as const) {
      await setWidth(width);
      const { root } = await draw(
        createElement(FormSheet, {
          open: true,
          onOpenChange: () => {},
          def: defs.FORM_DEFS.extension,
          client: fx.CLIENT_ARABIC,
          prefill: fx.EXTENSION_PREFILL,
          calls: fx.CALLS,
          hints: fx.EXTENSION_READ.hints,
          status: "Active · due 2 Nov",
          submit: async () => ({
            message: "2 weeks to 16 Nov",
            ref: { eventId: 1 },
          }),
          trail: async () => fx.TRAIL_ROWS.held,
        }),
      );
      const sheet = body().querySelector(".fs-sheet");
      expect(sheet?.getAttribute("data-side")).toBe(side);
      expect(text(body().querySelector(".fs-client-name"))).toBe(
        fx.CLIENT_ARABIC.name,
      );
      expect(body().querySelector(".fs-client-name")?.tagName).toBe("BDI");
      // Each prefilled card fact, with where it came from.
      expect(text(body().querySelector(".fs-facts"))).toContain(
        "2 Nov · from the ClickUp card",
      );
      expect(text(body().querySelector(".fs-facts"))).toContain(
        "Nobody holds this yet",
      );
      expect(text(body().querySelector(".fs-facts"))).not.toContain("$0");
      // The calls a decision points to, in Geist Mono days.
      expect(text(body().querySelector(".fs-calls"))).toContain("28 Oct");
      await act(async () => root.unmount());
    }
    await setWidth(1280);
  });

  test("a requirement that hangs on another answer reads optional when it is; an optional call can go back to none", async () => {
    const { root } = await draw(
      createElement(FormBody, {
        def: defs.FORM_DEFS.pause,
        client: fx.CLIENT,
        prefill: [
          { key: "pauseKind", value: "non_payment", source: "the test" },
        ],
        calls: fx.CALLS,
        submit: async () => ({ message: "", ref: { eventId: 1 } }),
        trail: async () => fx.TRAIL_ROWS.held,
      }),
    );
    const restart = [...body().querySelectorAll(".fs-label")].find((l: any) =>
      text(l).startsWith("Restart"),
    );
    expect(text(restart)).toContain("(optional)");
    await act(async () => root.unmount());

    const churn = await draw(
      createElement(FormBody, {
        def: defs.FORM_DEFS.churn_confirm,
        client: fx.CLIENT,
        prefill: fx.CHURN_PREFILL,
        calls: fx.CALLS,
        submit: async () => ({ message: "", ref: { eventId: 1 } }),
        trail: async () => fx.TRAIL_ROWS.held,
      }),
    );
    // The latest call is never the exit call by default: "No exit call" is picked until the CSM picks one.
    const none = [...body().querySelectorAll(".fs-call")].find((l: any) =>
      text(l).includes("No exit call"),
    ) as any;
    expect(none).toBeTruthy();
    expect(none.querySelector("input").checked).toBe(true);
    await act(async () => churn.root.unmount());
  });

  test("after a send the header drops the card's old state; a ticket with no way to open it says where to", async () => {
    const def = defs.FORM_DEFS.resume;
    const { root } = await draw(
      createElement(FormSheet, {
        open: true,
        onOpenChange: () => {},
        def,
        client: fx.CLIENT,
        prefill: [{ key: "nextDate", value: "2026-11-20", source: "the test" }],
        status: "Paused · due 2 Nov",
        submit: async () => ({
          message: "1 Nov, next payment 20 Nov",
          ref: { eventId: 9 },
        }),
        trail: async () => ({ stored: { state: "done" } }),
      }),
    );
    try {
      expect(text(body().querySelector(".fs-status"))).toBe(
        "Paused · due 2 Nov",
      );
      await click(button("Resume this client"));
      await flush();
      expect(body().querySelector(".fs-status")).toBeNull();
      expect(text(body().querySelector(".fs-lede"))).toBe(
        "Where it has reached",
      );
      const ticket = [...body().querySelectorAll(".fs-step")].at(-1) as any;
      expect(text(ticket)).toContain("The relaunch needs its ticket");
      expect(text(ticket)).toContain(
        "Open the relaunch ticket from the client page.",
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("one request id per open sheet, kept through a retry; a new open is a new id; the draft clears", async () => {
    const ids: string[] = [];
    let fail = true;
    const trails: any[] = [];
    const def = defs.FORM_DEFS.resume;
    const props = (open: boolean) => ({
      open,
      onOpenChange: () => {},
      def,
      client: fx.CLIENT,
      prefill: [
        {
          key: "nextDate",
          value: "2026-11-20",
          source: "the old date moved by the pause's length",
        },
      ],
      submit: async (_a: any, requestId: string) => {
        ids.push(requestId);
        if (fail) {
          fail = false;
          throw new TypeError("Failed to fetch");
        }
        return { message: "1 Nov, next payment 20 Nov", ref: { eventId: 77 } };
      },
      trail: async (ref: any) => {
        trails.push(ref);
        return fx.TRAIL_ROWS.queued;
      },
    });
    const { root } = await draw(createElement(FormSheet, props(true)));
    // The prefilled date says where it came from.
    expect(text(body())).toContain(
      "from the old date moved by the pause's length",
    );
    await click(button("Resume this client"));
    expect(text(body())).toContain(
      "Not saved. Check your connection and press Resume this client again.",
    );
    await click(button("Resume this client"));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(text(body().querySelector(".fs-done"))).toBe(
      "Resumed: 1 Nov, next payment 20 Nov",
    );
    expect(trails[0]).toEqual({ eventId: 77 });
    const steps = [...body().querySelectorAll(".fs-step")].map((s: any) =>
      text(s),
    );
    expect(steps[0]).toContain("Saved in the cockpit");
    expect(steps[1]).toContain("Queued for the ClickUp card");
    expect(steps[3]).toContain("The relaunch needs its ticket");
    expect(steps[3]).toContain("Open the relaunch ticket");
    expect(steps[3].split("Open the relaunch ticket")).toHaveLength(2);
    expect(
      win.localStorage.getItem(core.draftKey(def, fx.CLIENT.taskId)),
    ).toBeNull();
    // Closed, then opened again: a new sheet, a new id.
    await act(async () => root.render(createElement(FormSheet, props(false))));
    await flush();
    await act(async () => root.render(createElement(FormSheet, props(true))));
    await flush();
    await click(button("Resume this client"));
    expect(ids).toHaveLength(3);
    expect(ids[2]).not.toBe(ids[0]);
    await act(async () => root.unmount());
  });

  test("a check that fails shows the database's sentence under the field and sends nothing", async () => {
    const sent: any[] = [];
    const { root } = await draw(
      createElement(FormSheet, {
        open: true,
        onOpenChange: () => {},
        def: defs.FORM_DEFS.churn_confirm,
        client: fx.CLIENT,
        prefill: fx.CHURN_PREFILL,
        submit: async (a: any) => {
          sent.push(a);
          return { message: "left 1 Nov", ref: { departureId: 9 } };
        },
        trail: async () => ({}),
      }),
    );
    await click(button("Confirm churn"));
    expect(sent).toEqual([]);
    const errors = [...body().querySelectorAll(".fs-error")].map((e: any) =>
      text(e),
    );
    expect(errors).toContain("Pick the day they left, today or before.");
    expect(errors).toContain(
      "Say why they left in detail, so the lock-in reads back.",
    );
    expect(errors).toContain("Say how we stop this next time.");
    // Prefilled from the termination survey and the day-90 rule, each said.
    expect(text(body())).toContain("from the termination survey, 30 Oct");
    expect(text(body())).toContain("from the day-90 rule");
    // Typing keeps a draft; it is never required.
    const why = body().querySelector("textarea");
    await type(why, "Their budget moved to a new showroom.");
    expect(
      win.localStorage.getItem(
        core.draftKey(defs.FORM_DEFS.churn_confirm, fx.CLIENT.taskId),
      ),
    ).toContain("showroom");
    // The fixed answer's sentence goes; the count says what is left
    // (the day, the reason and how we stop it).
    expect(text(body().querySelector(".fs-foot"))).toContain(
      "3 answers need a fix above.",
    );
    const stop = body().querySelectorAll("textarea")[1];
    await type(stop, "Agree the budget for six months at kickoff.");
    await type(body().querySelector("input[type=date]"), fx.FIXTURE_TODAY);
    const cancelled = [...body().querySelectorAll("input[type=radio]")].find(
      (r: any) => r.value === "Cancelled",
    );
    await click(cancelled);
    expect(text(body().querySelector(".fs-foot"))).toContain("Draft saved");
    await act(async () => root.unmount());
    win.localStorage.clear();
  });

  test("FormBody renders inline, with no dialog, for the billing sheet's tabs", async () => {
    const { host, root } = await draw(
      createElement(FormBody, {
        def: defs.FORM_DEFS.mrr,
        client: fx.CLIENT,
        prefill: fx.MRR_PREFILL,
        submit: async () => ({
          message: "$1,500 a month from 1 Nov",
          ref: { eventId: 5 },
        }),
        trail: async () => fx.TRAIL_ROWS.delivered,
      }),
    );
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(text(host.querySelector(".fs-title"))).toBe("Set MRR");
    expect(button("Set MRR to $2,000", host)).toBeTruthy();
    await act(async () => root.unmount());
  });
});
