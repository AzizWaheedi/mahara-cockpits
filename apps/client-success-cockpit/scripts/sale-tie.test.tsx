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
 * The sale tied to its card in the CSM cockpit (CEO item 6; sale-tie.md 2.7
 * and 2.10; docs/forms/WAVE56-CONTRACT.md 4.19 and 5.16): the reads taken
 * leniently, the method chips, the CEO's line (missing is never zero), and
 * the "Sales not on a card" band's three answers sent to the server's
 * decide function, with one plain line while the functions are not applied.
 * Invented businesses only; every RPC is a stand-in.
 *
 * Run: bun test scripts/sale-tie.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/today",
  width: 375,
  height: 812,
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
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
  "InputEvent",
  "ResizeObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
])
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

/**
 * The cockpit's animated select is Radix's; here it is the native select it
 * stands for, so a pick can be made (its own tests live with the component).
 */
mock.module("@/components/ui/animated-select", () => {
  const { createElement: h } = require("react");
  return {
    AnimatedSelect: ({ children, value, onChange, id }: any) =>
      h("select", { id, value, onChange }, children),
  };
});

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const S = await import("../src/lib/saleTie");
const { SalesNotOnCard } = await import("../src/components/SalesNotOnCard");

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
  await act(async () => root.render(el));
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
const button = (label: string) =>
  [...body().querySelectorAll("button")].find(
    (b: any) => text(b) === label,
  ) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => el.click());
  await flush();
}
async function typeInto(el: any, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new (win as any).Event("input", { bubbles: true }));
    el.dispatchEvent(new (win as any).Event("change", { bubbles: true }));
  });
  await flush();
}

/** A row as cockpit_sale_tie_list (20261103g) gives it. */
const ROW = {
  responseId: "tfResp0001",
  state: "unmatched",
  sentence:
    "No card has this sale's phone or email after 2 days. Check Make 10's run, or pick the card.",
  businessName: "Cedar Interiors",
  signedAt: "2026-10-11T22:30:00Z",
  signedOn: "2026-10-12",
  closer: "Rania",
  tiedTo: null,
  candidates: [
    {
      taskId: "86eyfake02",
      clientName: "Cedar Interiors (old card)",
      reason: "Same phone as the card",
    },
  ],
  suggestion: {
    taskId: "86eyfake01",
    clientName: "Cedar Interiors",
    by: "billing",
    reason: "Billing ties this sale to this card by its payments",
  },
};
const CARDS = [
  { taskId: "86eyfake01", name: "Cedar Interiors" },
  { taskId: "86eyfake02", name: "Cedar Interiors (old card)" },
  { taskId: "86eyfake03", name: "Juniper Fit-Out" },
];

function fakeApi(list: unknown | Error): {
  api: any;
  decided: Record<string, unknown>[];
} {
  const decided: Record<string, unknown>[] = [];
  return {
    decided,
    api: {
      list: async () => {
        if (list instanceof Error) throw list;
        return S.readSaleList(list);
      },
      decide: async (p: Record<string, unknown>) => {
        decided.push(p);
        // As cockpit_sale_tie_decide answers, through the client's reader.
        const card = CARDS.find(c => c.taskId === p.taskId);
        return { sentence: null, cardName: card?.name ?? null };
      },
    },
  };
}

describe("the reads and the words", () => {
  test("one card's sale from any of the read's shapes; a card the read does not name is none", () => {
    const view = {
      signedAt: "2026-10-12T09:00:00Z",
      tiedBy: "phone_email",
      closer: "Rania",
      goLive: "Soon",
      handoffProblems: "No",
      voidedInB2B: false,
      otherSales: 1,
    };
    const want = { state: "tied", tiedBy: "phone_email", otherSales: 1 };
    expect(S.readSales({ cards: { a1: view } }, ["a1", "b2"])).toMatchObject({
      a1: want,
      b2: { state: "none" },
    });
    expect(
      S.readSales({ rows: [{ taskId: "a1", ...view }] }, ["a1"]).a1,
    ).toMatchObject(want);
    expect(S.readSales([{ taskId: "a1", ...view }], ["a1"]).a1).toMatchObject(
      want,
    );
    expect(S.readSales({ a1: view }, ["a1"]).a1).toMatchObject(want);
    // cockpit_csm_sale_read (20261103g): {on, cards: [{taskId, state, …}]}.
    const b3 = S.readSales(
      {
        on: true,
        cards: [
          { taskId: "a1", state: "tied", responseId: "tf1", ...view },
          { taskId: "b2", state: "none" },
        ],
      },
      ["a1", "b2", "c3"],
    );
    expect(b3.a1).toMatchObject(want);
    expect(b3.b2).toEqual({ state: "none" });
    expect(b3.c3).toEqual({ state: "none" });
    // Sale ties off (forms.sale_tie.on false): every card is off, never none.
    const off = S.readSales(
      { on: false, cards: [{ taskId: "b2", state: "none" }] },
      ["a1", "b2"],
    );
    expect(off).toEqual({ a1: { state: "off" }, b2: { state: "off" } });
    expect(S.readSaleView({ state: "none" })).toEqual({ state: "none" });
    expect(S.readSaleView({ tiedBy: "surprise", signedAt: "x" })).toMatchObject(
      { state: "tied", tiedBy: null },
    );
    // Never a phone, an email or a digest on the screen's shape.
    const keys = Object.keys(
      S.readSaleView({ ...view, phone: "+96500000000" }),
    );
    expect(keys).not.toContain("phone");
  });

  test("the list as 20261103g gives it: its summary, its flags, a candidate's client name, a tie billing disagrees with", () => {
    const list = S.readSaleList({
      on: true,
      fill: false,
      salesLink: false,
      rows: [
        ROW,
        {
          ...ROW,
          responseId: "tfResp0002",
          state: "tied",
          sentence: "Billing ties this sale to another card.",
          tiedTo: {
            taskId: "86eyfake02",
            clientName: "Cedar Interiors (old card)",
            tiedBy: "phone",
          },
        },
      ],
      summary: {
        sales: 55,
        onCard: 39,
        byPhone: 12,
        byEmail: 6,
        byPhoneAndEmail: 21,
        byPerson: 0,
        forPerson: 14,
        waiting: 1,
        void: 2,
        notClient: 0,
        rows: 56,
      },
    });
    expect(list.on).toBe(true);
    expect(list.counts).toEqual({
      sales: 55,
      tied: 39,
      byPhone: 12,
      byEmail: 6,
      byBoth: 21,
      byPerson: 0,
      waiting: 14,
    });
    expect(list.rows[0].suggestion?.name).toBe("Cedar Interiors");
    expect(list.rows[0].candidates[0].name).toBe("Cedar Interiors (old card)");
    expect(list.rows[1].tiedTo).toEqual({
      taskId: "86eyfake02",
      name: "Cedar Interiors (old card)",
      tiedBy: "phone",
    });
    expect(S.readSaleList({ rows: [] }).on).toBeNull();
  });

  test("the chips and the CEO's line; before counts it says so, never 0", () => {
    expect(S.tiedByWords("phone")).toBe("Tied by phone");
    expect(S.tiedByWords("email")).toBe("Tied by email");
    expect(S.tiedByWords("phone_email")).toBe("Tied by phone and email");
    expect(S.tiedByWords("person")).toBe("Tied by a person");
    expect(S.tiedByTone("phone")).toBe("accent");
    expect(S.tiedByTone("person")).toBe("neutral");
    expect(S.saleHealthLine(null)).toBe("Sales are not tied yet.");
    expect(
      S.saleHealthLine({
        sales: 55,
        tied: 39,
        byPhone: 12,
        byEmail: 6,
        byBoth: 21,
        byPerson: 0,
        waiting: 15,
      }),
    ).toBe(
      "55 sales: 39 on their card (33 by phone, 6 by email, 0 by a person), 15 waiting for a person.",
    );
    expect(S.NOT_TIED).toBe(
      "Not tied to a New Client Form yet. The CEO can tie it under Sales not on a card.",
    );
    expect(S.saleMissing({ code: "PGRST202" })).toBe(true);
    expect(S.saleMissing({ code: "42501" })).toBe(false);
  });

  test("a refusal is the server's own sentence; Postgres's own words never reach the screen", async () => {
    const rpc = (error: unknown) => ({
      rpc: async () => ({ data: null, error }),
    });
    await expect(
      S.readSaleTieList(
        rpc({
          code: "42501",
          message:
            "Only a client success seat or the CEO ties a sale to a card.",
        }) as any,
      ),
    ).rejects.toThrow(
      "Only a client success seat or the CEO ties a sale to a card.",
    );
    await expect(
      S.readSaleTieList(
        rpc({
          code: "42501",
          message: "permission denied for function x",
        }) as any,
      ),
    ).rejects.toThrow(
      "The database could not answer just now. Try again in a minute.",
    );
    await expect(
      S.readSaleTie(rpc({ code: "PGRST202", message: "x" }) as any, "a1"),
    ).resolves.toEqual({ state: "missing" });
    // A seat the read does not serve (an admin seat without the csm role) is not a failed read.
    await expect(
      S.readSaleTie(
        rpc({
          code: "42501",
          message: "Only a client success seat or the CEO reads this.",
        }) as any,
        "a1",
      ),
    ).resolves.toEqual({ state: "missing" });
    await expect(
      S.readSaleTie(
        {
          rpc: async () => ({ data: { on: false, cards: [] }, error: null }),
        } as any,
        "a1",
      ),
    ).resolves.toEqual({ state: "off" });
    // Any other refusal still fails the read.
    await expect(
      S.readSaleTie(
        rpc({
          code: "22023",
          message: "Choose at most 200 client cards.",
        }) as any,
        "a1",
      ),
    ).rejects.toThrow("Choose at most 200 client cards.");
    const sent: unknown[] = [];
    const ok = {
      rpc: async (name: string, args: unknown) => {
        sent.push([name, args]);
        return { data: { ok: true, cardName: "Cedar Interiors" }, error: null };
      },
    };
    await S.decideSaleTie(ok as any, {
      responseId: "tfResp0001",
      choice: "not_client",
      note: "  A duplicate of the first sale.  ",
    });
    expect(sent).toEqual([
      [
        "cockpit_sale_tie_decide",
        {
          p_response_id: "tfResp0001",
          p_choice: "not_client",
          p_task: null,
          p_note: "A duplicate of the first sale.",
        },
      ],
    ]);
    // A CEO move whose card notes were planned for the first card: 20261103g's
    // answer carries handFill {taskId, sentence}, and that sentence is the toast's.
    const hand =
      "This sale's notes were planned for another card first, and the cockpit writes them once. Fill Go-live expectation and Handoff problems on this card by hand if they are empty.";
    const moved = {
      rpc: async () => ({
        data: {
          ok: true,
          state: "tied",
          taskId: "86eywg1cq",
          clientName: "Cedar Interiors",
          handFill: { taskId: "86eywg1cq", sentence: hand },
        },
        error: null,
      }),
    };
    await expect(
      S.decideSaleTie(moved as any, {
        responseId: "tfResp0001",
        choice: "pick",
        taskId: "86eywg1cq",
      }),
    ).resolves.toEqual({ sentence: hand, cardName: "Cedar Interiors" });
  });
});

describe("Sales not on a card (the band)", () => {
  test("each sale with its reason; Yes ties it to the suggestion on the server", async () => {
    const { api, decided } = fakeApi({ rows: [ROW], counts: null });
    const root = await draw(
      createElement(SalesNotOnCard, { api, cards: CARDS, isCeo: false }),
    );
    expect(text(body().querySelector("h2"))).toContain("Sales not on a card");
    expect(text(body())).toContain("Cedar Interiors signed 12 Oct");
    expect(text(body())).toContain("closed by Rania");
    expect(text(body())).toContain(
      "No card has this sale's phone or email after 2 days. Check Make 10's run, or pick the card.",
    );
    expect(text(body())).toContain(
      "Billing ties this sale to this card by its payments",
    );
    expect(text(body())).toContain("Same phone as the card");
    await click(button("Yes, tie it"));
    expect(decided).toEqual([
      {
        responseId: "tfResp0001",
        choice: "yes",
        taskId: "86eyfake01",
        note: null,
      },
    ]);
    expect(toasts).toContain("Tied to Cedar Interiors");
    await clear(root);
  });

  test("Another card picks from the suggestion, the candidates and every other card", async () => {
    const { api, decided } = fakeApi({ rows: [ROW] });
    const root = await draw(
      createElement(SalesNotOnCard, { api, cards: CARDS, isCeo: false }),
    );
    await click(button("Another card"));
    const select = body().querySelector("select");
    expect(
      [...select.querySelectorAll("option")].map((o: any) => o.value),
    ).toEqual(["", "86eyfake01", "86eyfake02", "86eyfake03"]);
    await typeInto(select, "86eyfake03");
    await click(button("Tie it to this card"));
    expect(decided[0]).toEqual({
      responseId: "tfResp0001",
      choice: "pick",
      taskId: "86eyfake03",
      note: null,
    });
    expect(toasts).toContain("Tied to Juniper Fit-Out");
    await clear(root);
  });

  test("Not a client card asks why, in a few words, before anything is sent", async () => {
    const { api, decided } = fakeApi({ rows: [ROW] });
    const root = await draw(
      createElement(SalesNotOnCard, { api, cards: CARDS, isCeo: true }),
    );
    await click(button("Not a client card"));
    await click(button("Save"));
    expect(decided).toHaveLength(0);
    expect(text(body().querySelector('[role="alert"]'))).toBe(
      "Say why, in a few words: a test, a duplicate, another business.",
    );
    await typeInto(
      body().querySelector("input"),
      "A test sale from the closer.",
    );
    await click(button("Save"));
    expect(decided[0]).toEqual({
      responseId: "tfResp0001",
      choice: "not_client",
      taskId: null,
      note: "A test sale from the closer.",
    });
    expect(toasts).toContain("Marked not a client card");
    await clear(root);
  });

  test("before the CEO turns sale ties on: one line for the CEO, nothing for a CSM, no buttons", async () => {
    let root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi({ on: false, rows: [ROW] }).api,
        cards: CARDS,
        isCeo: true,
      }),
    );
    expect(text(body())).toBe(
      "Sales are not tied yet. They tie to their cards once sale ties are turned on.",
    );
    expect(body().querySelectorAll("button")).toHaveLength(0);
    await clear(root);
    root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi({ on: false, rows: [ROW] }).api,
        cards: CARDS,
        isCeo: false,
      }),
    );
    expect(text(body())).toBe("");
    await clear(root);
  });

  test("a tie billing disagrees with shows the card it is on, with its method", async () => {
    const root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi({
          rows: [
            {
              ...ROW,
              state: "tied",
              sentence: "Billing ties this sale to another card.",
              tiedTo: {
                taskId: "86eyfake02",
                clientName: "Cedar Interiors (old card)",
                tiedBy: "phone",
              },
            },
          ],
        }).api,
        cards: CARDS,
        isCeo: true,
      }),
    );
    expect(text(body())).toContain("Billing ties this sale to another card.");
    expect(text(body())).toContain("Now on Cedar Interiors (old card)");
    expect(text(body())).toContain("Tied by phone");
    await clear(root);
  });

  test("the CEO reads the counts, and the empty band says every sale is on its card; a CSM sees nothing then", async () => {
    const counts = {
      sales: 55,
      tied: 55,
      byPhone: 12,
      byEmail: 6,
      byBoth: 21,
      byPerson: 16,
      waiting: 0,
    };
    let root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi({ rows: [], counts }).api,
        cards: CARDS,
        isCeo: true,
      }),
    );
    expect(text(body())).toContain(
      "55 sales: 55 on their card (33 by phone, 6 by email, 16 by a person), 0 waiting for a person.",
    );
    expect(text(body())).toContain("Every sale is on its card.");
    await clear(root);
    root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi({ rows: [], counts }).api,
        cards: CARDS,
        isCeo: false,
      }),
    );
    expect(text(body())).toBe("");
    await clear(root);
  });

  test("missing functions: one line for the CEO, nothing for a CSM; a refused seat sees nothing", async () => {
    const missing = Object.assign(new Error(S.SALES_MISSING), {
      code: "PGRST202",
    });
    let root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi(missing).api,
        cards: CARDS,
        isCeo: true,
      }),
    );
    expect(text(body())).toBe(
      "Sales tie to their cards after the next cockpit update.",
    );
    await clear(root);
    root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi(missing).api,
        cards: CARDS,
        isCeo: false,
      }),
    );
    expect(text(body())).toBe("");
    await clear(root);
    const refused = Object.assign(new Error("Only the CEO."), {
      code: "42501",
    });
    root = await draw(
      createElement(SalesNotOnCard, {
        api: fakeApi(refused).api,
        cards: CARDS,
        isCeo: false,
      }),
    );
    expect(text(body())).toBe("");
    await clear(root);
  });
});
