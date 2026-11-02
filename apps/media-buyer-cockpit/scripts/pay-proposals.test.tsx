/**
 * Pay proposals from the wins ledger on Team & payroll (docs/forms/
 * WAVE56-CONTRACT.md 4.9, 5.4, section 8): the block "Proposed from wins"
 * confirms and declines each one, shows waiting rows with their sentence,
 * reads the switch-off line and the empty line, confirms a proposal of an
 * approved month into the open month; the typed entry dialog needs the
 * outside-ledger reason for a win-backed part. Stand-in apis only.
 *
 * Run: bun test scripts/pay-proposals.test.tsx
 */
import { afterAll, describe, expect, test } from "bun:test";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks, and every global and the env are put back.
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("This screen test makes no network calls.");
}) as typeof fetch;

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=billing" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "Event",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
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
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);
afterAll(async () => {
  await act(async () => root.unmount());
  MotionGlobalConfig.skipAnimations = skipBefore;
  console.error = realError;
  globalThis.fetch = realFetch;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  for (const [i, e] of envs.entries()) Object.assign(e, envBefore[i]);
  await win.happyDOM.close();
});
async function flush(times = 8) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
async function render(el: any) {
  await act(async () => root.render(el));
  await flush();
}
const page = () =>
  String(win.document.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string, scope: any = win.document) =>
  [...scope.querySelectorAll("button")].find(
    (b: any) => String(b.textContent ?? "").trim() === label,
  ) as any;
async function click(el: any) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => el.click());
  await flush();
}
async function type(input: any, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    win.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush();
}

const copy = await import("../src/pages/ceo/pay/payCopy");
const { ProposedFromWins } = await import("../src/pages/ceo/pay/PayMonthCard");
const { entryPayload } = await import("../src/pages/ceo/pay/PayEntryDialog");
type ProposalsApi = import("../src/pages/ceo/pay/PayMonthCard").ProposalsApi;

const ROWS = [
  {
    key: "win:00000000-0000-4000-8000-000000000001:google_reviews:2026-11",
    personId: 4,
    person: "The CSM",
    partKey: "google_reviews",
    partLabel: "Google reviews",
    client: "Ardon Interiors",
    amountUsd: 75,
    state: "proposed",
    why: null,
    proofUrl: "https://g.page/r/x/review",
    entryId: null,
  },
  {
    key: "win:00000000-0000-4000-8000-000000000005:referrals:2026-11",
    personId: 4,
    person: "The CSM",
    partKey: "referrals",
    partLabel: "Referrals",
    client: "Liwan Fit-out",
    amountUsd: null,
    state: "waiting",
    why: "The referred client has not paid yet.",
    proofUrl: null,
    entryId: null,
  },
  {
    key: "win:00000000-0000-4000-8000-000000000004:upsells:2026-11",
    personId: null,
    person: null,
    partKey: "upsells",
    partLabel: "Upsells",
    client: "Dusk Arch",
    amountUsd: 150,
    state: "proposed",
    why: null,
    proofUrl: null,
    entryId: null,
  },
];

function apiOf(
  over: Partial<{ on: boolean; approved: boolean; rows: unknown[] }> = {},
  decided?: { sentence: string | null; entryMonth: string | null },
) {
  const calls: { name: string; args: any }[] = [];
  const api: ProposalsApi = {
    read: async ym => {
      calls.push({ name: "read", args: ym });
      return copy.toProposals(
        { month: `${ym}-01`, on: true, approved: false, rows: ROWS, ...over },
        ym,
      );
    },
    decide: async p => {
      calls.push({ name: "decide", args: p });
      return decided ?? { sentence: null, entryMonth: null };
    },
  };
  return { api, calls };
}

describe("the copy (4.9)", () => {
  test("the win-backed parts, the reference and the sentences", () => {
    expect([...copy.WIN_PARTS]).toEqual([
      "google_reviews",
      "video_testimonials",
      "podcasts",
      "referrals",
      "renewals",
      "reactivations",
      "upsells",
      "recurring",
    ]);
    expect(copy.isWinRef("win:00000000-0000-4000-8000-000000000001")).toBe(
      true,
    );
    expect(copy.isWinRef("whop:pay_1")).toBe(false);
    expect(copy.PROPOSALS_OFF).toBe(
      "Pay proposals open after their switch-on.",
    );
    expect(copy.noWinsFor("2026-11")).toBe("No wins to pay for November.");
    expect(copy.confirmedLine("2026-10", null, false)).toBe(
      "Added to October.",
    );
    expect(copy.confirmedLine("2026-10", "2026-11", true)).toBe(
      "Added to November: October is approved.",
    );
    expect(copy.confirmedLine("2026-10", null, true)).toBe(
      "Added to November: October is approved.",
    );
    expect(
      copy.proposalLine(
        copy.toProposals({ rows: ROWS, on: true }, "2026-11").rows[0],
      ),
    ).toBe("The CSM · Google reviews · Ardon Interiors · $75");
    expect(
      copy.proposalLine(
        copy.toProposals({ rows: ROWS, on: true }, "2026-11").rows[1],
      ),
    ).toBe("The CSM · Referrals · Liwan Fit-out · amount not known");
  });
});

describe("Proposed from wins (5.4)", () => {
  test("confirms and declines with one press each; waiting rows say why", async () => {
    const said: string[] = [];
    const { api, calls } = apiOf();
    await render(
      h(ProposedFromWins, {
        api,
        ym: "2026-11",
        people: [{ personId: 4, name: "The CSM" }],
        onDone: (t: string) => {
          said.push(t);
        },
      }),
    );
    const block = win.document.querySelector(
      "[data-proposed-from-wins]",
    ) as any;
    expect(String(block.textContent)).toContain("Proposed from wins");
    expect(block.querySelectorAll("[data-proposal]").length).toBe(3);
    expect(String(block.querySelector("[data-waiting]")?.textContent)).toBe(
      "The referred client has not paid yet.",
    );
    const first = block.querySelector(`[data-proposal="${ROWS[0].key}"]`);
    await click(button("Confirm", first));
    expect(calls.find(c => c.name === "decide")?.args).toEqual({
      month: "2026-11",
      key: ROWS[0].key,
      decision: "confirm",
      personId: 4,
    });
    expect(said).toEqual(["Added to November."]);
    await click(
      button(
        "Decline",
        block.querySelector(`[data-proposal="${ROWS[0].key}"]`),
      ),
    );
    expect(page()).toContain("Why are you declining it?");
    const form = block.querySelector("form");
    await click(button("Decline", form));
    expect(page()).toContain("Say why in 3 to 300 characters.");
    await type(form.querySelector("input"), "Not a five-star review.");
    await click(button("Decline", form));
    expect(calls.filter(c => c.name === "decide").at(-1)?.args).toMatchObject({
      decision: "decline",
      reason: "Not a five-star review.",
    });
    await render(h("div"));
  });

  test("a win whose CSM is not matched asks for the person first", async () => {
    const { api, calls } = apiOf();
    await render(
      h(ProposedFromWins, {
        api,
        ym: "2026-11",
        people: [{ personId: 4, name: "The CSM" }],
        onDone: () => {},
      }),
    );
    const row = win.document.querySelector(
      `[data-proposal="${ROWS[2].key}"]`,
    ) as any;
    expect(String(row.textContent)).toContain("Pick the person");
    await click(button("Confirm", row));
    expect(page()).toContain("Pick the person this win pays.");
    expect(calls.filter(c => c.name === "decide")).toHaveLength(0);
    await render(h("div"));
  });

  test("a proposal of an approved month is added to the open month, said so", async () => {
    const said: string[] = [];
    const { api } = apiOf(
      { approved: true },
      { sentence: null, entryMonth: "2026-12" },
    );
    await render(
      h(ProposedFromWins, {
        api,
        ym: "2026-11",
        people: [],
        onDone: (t: string) => {
          said.push(t);
        },
      }),
    );
    await click(
      button(
        "Confirm",
        win.document.querySelector(`[data-proposal="${ROWS[0].key}"]`),
      ),
    );
    expect(said).toEqual(["Added to December: November is approved."]);
    await render(h("div"));
    const server = apiOf(
      { approved: true },
      {
        sentence: "Added to December: November is approved.",
        entryMonth: "2026-12",
      },
    );
    const said2: string[] = [];
    await render(
      h(ProposedFromWins, {
        api: server.api,
        ym: "2026-11",
        people: [],
        onDone: (t: string) => {
          said2.push(t);
        },
      }),
    );
    await click(
      button(
        "Confirm",
        win.document.querySelector(`[data-proposal="${ROWS[0].key}"]`),
      ),
    );
    expect(said2).toEqual(["Added to December: November is approved."]);
    await render(h("div"));
  });

  test("switched off, refused or empty: one line each", async () => {
    const off = apiOf({ on: false });
    await render(
      h(ProposedFromWins, {
        api: off.api,
        ym: "2026-11",
        people: [],
        onDone: () => {},
      }),
    );
    expect(
      String(win.document.querySelector("[data-proposals-off]")?.textContent),
    ).toBe("Pay proposals open after their switch-on.");
    await render(h("div"));
    const refused: ProposalsApi = {
      read: async () => {
        throw new Error("Pay proposals open after their switch-on.");
      },
      decide: async () => ({ sentence: null, entryMonth: null }),
    };
    let on: boolean | null = null;
    await render(
      h(ProposedFromWins, {
        api: refused,
        ym: "2026-11",
        people: [],
        onOn: (v: boolean) => {
          on = v;
        },
        onDone: () => {},
      }),
    );
    expect(page()).toContain("Pay proposals open after their switch-on.");
    expect(on).toBe(false);
    await render(h("div"));
    const empty = apiOf({ rows: [] });
    await render(
      h(ProposedFromWins, {
        api: empty.api,
        ym: "2026-11",
        people: [],
        onDone: () => {},
      }),
    );
    expect(page()).toContain("No wins to pay for November.");
    await render(h("div"));
  });
});

describe("a typed entry for a win-backed part (C7, 4.9.3)", () => {
  const part = {
    key: "google_reviews",
    label: "Google reviews",
    kind: "count",
    input: "typed",
    rate: 75,
  } as any;
  const target = (winsLedger: boolean) => ({
    person: { personId: 4, name: "The CSM" },
    month: "2026-11",
    part,
    winsLedger,
  });
  const draft = (over: Record<string, unknown> = {}) => ({
    quantity: 1,
    cashUsd: Number.NaN,
    amountUsd: Number.NaN,
    engagementMonth: 1,
    client: "Ardon Interiors",
    product: "",
    clearedOn: "",
    postedOn: "2026-11-01",
    cancelledOn: "",
    evidenceRef: "",
    evidence: "https://g.page/r/x/review",
    note: "",
    fromMonth: "",
    outsideLedger: "",
    ...over,
  });
  test("needs the outside-ledger reason while proposals are on, unless it rests on a win", () => {
    const refused = entryPayload(target(true), draft() as any);
    expect(refused).toEqual({ problem: copy.OUTSIDE_LEDGER_SAY });
    expect(copy.OUTSIDE_LEDGER_SAY).toBe(
      "This part comes from the wins ledger. Confirm its proposal, or say why it is not in the ledger.",
    );
    const why = entryPayload(
      target(true),
      draft({ outsideLedger: "Logged on the old form in October." }) as any,
    );
    expect("payload" in why && why.payload.outsideLedger).toBe(
      "Logged on the old form in October.",
    );
    const onWin = entryPayload(
      target(true),
      draft({ evidenceRef: "win:00000000-0000-4000-8000-000000000001" }) as any,
    );
    expect("payload" in onWin && onWin.payload.outsideLedger).toBeUndefined();
    // Switched off: as before, no reason asked and none sent.
    const before = entryPayload(target(false), draft() as any);
    expect("payload" in before && before.payload.outsideLedger).toBeUndefined();
    // An adjustment is never asked.
    const adj = entryPayload(
      { ...target(true), part: "adjustment" } as any,
      draft({ amountUsd: 50, note: "A correction" }) as any,
    );
    expect("payload" in adj).toBe(true);
  });
});
