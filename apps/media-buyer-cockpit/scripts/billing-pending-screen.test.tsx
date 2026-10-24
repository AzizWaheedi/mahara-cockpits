/**
 * Pending payments in Billing, the screen (PLAN.md 4, 2026-10-23). The
 * section renders in happy-dom from the rows cockpit_billing_balances_read()
 * returned to the CEO on 23 Oct (scripts/fixtures/billingBalances20261023.ts,
 * contact and payer names made up) through the real rule, and from the
 * harness's scenarios (src/dev/billingFixture.ts). It checks the figures of
 * PLAN.md section 5, the chips and Show all, Arabic names in <bdi>, the
 * ribbon's parts and words, what a success manager never sees, the loading,
 * error, empty and money-not-read states, Confirm paid (busy, refused,
 * done), Log it as a payment handing over to the sheet's own form, Withdraw,
 * Link to a card, Open Transactions, Put the next part on the card, the
 * CEO's Leave a payment out of program money and Count it again (20261024p),
 * and the billing log's sentences for the six new kinds. No network.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=billing" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
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
  "IS_REACT_ACT_ENVIRONMENT",
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
const animateBefore = Object.getOwnPropertyDescriptor(
  win.Element.prototype,
  "animate",
);
delete (win.Element.prototype as any).animate;
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
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("The pending payments screen test makes no network calls.");
}) as typeof fetch;
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { PendingPayments } = await import(
  "../src/components/billing/PendingPayments"
);
const { BillingSheet } = await import("../src/components/billing/BillingSheet");
const { buildPending } = await import("../src/lib/billingBalances");
const { accountFrom, buildSheet } = await import("../src/lib/billingCore");
const { billingRead, sheetTables } = await import("../src/dev/billingFixture");
const { CASTELLO_WEBSITE, LIVE_2026_10_23, copyRead, websiteLeftOut } =
  await import("./fixtures/billingBalances20261023");
const { tieOpener } = await import("../src/pages/ceo/billingTie");

type PendingApi =
  import("../src/components/billing/PendingPayments").PendingApi;
type ConfirmInput =
  import("../src/components/billing/PendingPayments").ConfirmInput;
type PendingView = import("../src/lib/billingBalances").PendingView;
type BalancesRead = import("../src/lib/billingBalances").BalancesRead;
type BillingApi = import("../src/components/billing/BillingSheet").BillingApi;

/** The fixture's read time: 23 Oct 2026, 20:35 Kuwait. */
const NOW = Date.parse("2026-10-23T20:35:00+03:00");
const view = (read: BalancesRead = LIVE_2026_10_23): PendingView =>
  buildPending(read, NOW);

const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const page = () => String(win.document.body.textContent ?? "");
const buttons = (scope: any = win.document) =>
  [...scope.querySelectorAll("button")] as any[];
const button = (label: string | RegExp, scope: any = win.document) =>
  buttons(scope).find(b => {
    const t = String(b.textContent ?? "").trim();
    return typeof label === "string" ? t === label : label.test(t);
  });
async function click(el: any) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    el.click();
  });
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
const rowOf = (name: RegExp) => {
  const card = LIVE_2026_10_23.cards.find(c => name.test(c.name));
  if (!card) throw new Error(`No card ${name}`);
  return card;
};
const li = (taskId: string) =>
  win.document.querySelector(`li[data-task="${taskId}"]`) as any;
async function openRow(taskId: string) {
  await click(li(taskId)?.querySelector("button"));
}

/** Pick an option in the kit's select: open it, then click the option. */
async function choose(trigger: any, text: string) {
  await click(trigger);
  const option = [...win.document.querySelectorAll("[role='option']")].find(
    (o: any) => String(o.textContent).trim() === text,
  );
  await click(option);
}
const selectIn = (scope: any, labelText: string) => {
  const lab = [...scope.querySelectorAll("label")].find(
    (l: any) => String(l.textContent).trim() === labelText,
  ) as any;
  return lab ? scope.querySelector(`[id="${lab.getAttribute("for")}"]`) : null;
};

async function render(el: any) {
  await act(async () => {
    root.render(el);
  });
  await flush();
}

/** An api over a fixed view, recording every call. */
function apiOf(
  read: () => Promise<PendingView>,
  over: Partial<PendingApi> = {},
): PendingApi & { calls: { name: string; args: unknown }[] } {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    read: async () => {
      calls.push({ name: "read", args: null });
      return read();
    },
    confirm: async p => {
      calls.push({ name: "confirm", args: p });
      return "Confirmed by you · waiting for Tap";
    },
    withdraw: async p => {
      calls.push({ name: "withdraw", args: p });
      return "Withdrawn.";
    },
    link: async p => {
      calls.push({ name: "link", args: p });
      return "Linked to Arcturus Construction.";
    },
    unlink: async p => {
      calls.push({ name: "unlink", args: p });
      return "Unlinked.";
    },
    openTie: id => {
      calls.push({ name: "openTie", args: id });
    },
    ...over,
  };
}

afterEach(async () => {
  await act(async () => {
    root.render(null);
  });
});
afterAll(async () => {
  await act(async () => root.unmount());
  for (const [k, d] of globalsBefore) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
  if (animateBefore)
    Object.defineProperty(win.Element.prototype, "animate", animateBefore);
  globalThis.fetch = realFetch;
  console.error = realError;
  win.happyDOM.abort();
});

describe("the CEO's read of 23 Oct", () => {
  test("the figures are PLAN.md section 5's, and the line is the ribbon's legend", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    const t = page();
    expect(t).toContain("Pending payments");
    expect(t).toContain("Onboarding not seen$23,752.82 · 6 clients");
    expect(t).toContain("Later parts$8,032 · 4 clients");
    expect(t).toContain("Another source says paid$10,000 · 4 clients");
    expect(t).toContain("Confirmed by a person$0 · 0 clients");
    expect(t).toContain(
      "$7,500 of Not seen is only typed on closer forms, never on a rail.",
    );
    expect(t).toContain("On a rail");
    expect(t).toContain("Not due yet");
    // The chips, Not seen first.
    const chips = buttons().filter(
      b => b.getAttribute("aria-pressed") !== null,
    );
    expect(chips.map(b => String(b.textContent))).toEqual([
      "Not seen9",
      "Onboarding6",
      "Later parts4",
      "Another source4",
      "Still to come5",
    ]);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(t).not.toContain("—");
    // A dl's groups hold only dt and dd (the swatch sits inside the term).
    const groups = [...win.document.querySelectorAll("dl > div")] as any[];
    expect(groups.length).toBe(4);
    for (const g of groups)
      expect([...g.children].map((c: any) => c.tagName)).toEqual(["DT", "DD"]);
  });

  test("five rows show before Show all, Arabic names sit in <bdi>, and the open row stays", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    const listed = () =>
      [...win.document.querySelectorAll("ul > li[data-task]")].filter(
        (x: any) => !x.closest("[aria-expanded='true'] + *"),
      );
    expect(listed().length).toBe(5);
    await click(button("Show all 9"));
    expect(listed().length).toBe(9);
    const names = [...win.document.querySelectorAll("li[data-task] bdi")].map(
      (b: any) => b.textContent,
    );
    expect(names).toContain("شركة مصنع المعادن الهندسية للصناعة");
    expect(names).toContain("نهوض نجد");
    // Open City Wood under Another source, then pick Not seen by hand: the
    // chip shows only its own rows, so City Wood (not in it) closes and goes.
    await click(button(/^Another source/));
    const city = rowOf(/^City Wood$/);
    await openRow(city.taskId);
    expect(page()).toContain("Part by part");
    await click(button(/^Not seen/));
    expect(li(city.taskId)).toBeNull();
    expect(page()).not.toContain("Part by part");
    // And the other way: Alalia.co, open under Not seen, never shows under
    // Another source, where the chip counts 4.
    const alalia = rowOf(/^Alalia/);
    await click(button(/^Show all/));
    await openRow(alalia.taskId);
    await click(button(/^Another source/));
    expect(li(alalia.taskId)).toBeNull();
    expect(win.document.querySelectorAll("li[data-task]").length).toBe(4);
  });

  test("the ribbon is cut at the plan's parts, with the tick before the part due next", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    const metals = rowOf(/المعادن/);
    const ribbon = li(metals.taskId).querySelector("[role='img']");
    expect(ribbon.getAttribute("aria-label")).toBe(
      "On a rail $250 of $6,000. Onboarding payment: $5,750 not seen, due 19 Oct.",
    );
    const parts = [...ribbon.querySelectorAll("[data-part]")] as any[];
    expect(parts.map(p => p.getAttribute("data-part"))).toEqual([
      "deposit",
      "onboarding",
    ]);
    expect(
      [...parts[0].querySelectorAll("[data-state]")].map((s: any) =>
        s.getAttribute("data-state"),
      ),
    ).toEqual(["rails"]);
    expect(
      [...parts[1].querySelectorAll("[data-state]")].map((s: any) =>
        s.getAttribute("data-state"),
      ),
    ).toEqual(["notSeen"]);
    expect(parts[1].querySelector("[data-next]")).toBeTruthy();
    expect(parts[0].querySelector("[data-next]")).toBeNull();
    // The words under it, in the mono caption.
    expect(String(li(metals.taskId).textContent)).toContain(
      "$250 of $6,000 on a rail",
    );
    // A row whose sources disagree says so with a dot, never coloured text.
    const arc = rowOf(/^ARCWANI$/);
    expect(String(li(arc.taskId).textContent)).toContain("sources disagree");
  });

  test("the CEO's folded groups and the footnote show, folded", async () => {
    const api = apiOf(async () => view());
    const late: string[] = [];
    await render(
      h(PendingPayments, { api, onShowLate: () => late.push("late") }),
    );
    const t = page();
    expect(t).toContain(
      "Gone quiet: 3 clients, $10,800 left (kept out of the figures)",
    );
    expect(t).toContain(
      "Back with sales: 10 clients, $49,217 left (kept out of the figures)",
    );
    expect(t).toContain("1 signed deal has no client card: اكتوروس للتشيد");
    expect(t).toMatch(/Possible money: \d+ untied payments could be/);
    expect(t).toContain("Only the CEO sees this.");
    expect(t).toContain(
      "1 more client is late on its card's next payment with no signed deal we could match: Joe and Sera Company (the card asks $1,666, due 24 Sep).",
    );
    // Folded: nothing of Back with sales' rows shows until opened.
    expect(t).not.toContain("OMB group");
    await click(button("Open the Late view"));
    expect(late).toEqual(["late"]);
  });

  test("Link to a card starts on the suggested card and sends the deal and the card", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    await click(button(/signed deal has no client card/));
    expect(page()).toContain(
      "Signed 25 Aug, $6,000 Monthly, no client card found. Probably Arcturus Construction (signed up 25 Aug).",
    );
    expect(page()).toContain(
      "Once linked: Monthly · Deposit, onboarding payment and month 2 of 3, $4,000 not seen.",
    );
    await click(button("Link to a card"));
    const sent = api.calls.find(c => c.name === "link")?.args as any;
    const deal = LIVE_2026_10_23.unlinked[0];
    expect(sent).toEqual({
      dealResponseId: deal.responseId,
      taskId: deal.suggestedTaskId,
    });
    expect(page()).toContain("Linked to Arcturus Construction.");
    // The section reads again after a write.
    expect(api.calls.filter(c => c.name === "read").length).toBe(2);
  });

  test("Link to a card offers the sheet's cards, and its sentence outlives the group", async () => {
    // No card suggested (the form came more than 3 days from any signup).
    const before = structuredClone(LIVE_2026_10_23);
    const deal = before.unlinked[0];
    deal.suggestedTaskId = null;
    // Once linked, the deal leaves the group (the read moves it to the card).
    const after = structuredClone(before);
    after.unlinked = [];
    let reads = 0;
    const api = apiOf(async () => view(reads++ ? after : before));
    const arcturus = rowOf(/^Arcturus Construction$/);
    // The sheet's Active and onboarding cards; Arcturus has no deal of its
    // own, so it is not a row on the list.
    expect(view(before).rows.some(r => r.taskId === arcturus.taskId)).toBe(
      false,
    );
    const cards = LIVE_2026_10_23.cards
      .filter(c => c.group === "active" || c.group === "pipeline")
      .map(c => ({ taskId: c.taskId, name: c.name, group: String(c.group) }));
    await render(h(PendingPayments, { api, cards }));
    await click(button(/signed deal has no client card/));
    const fold = win.document.querySelector("[data-pending-payments]") as any;
    const trigger = selectIn(fold, "The client's card");
    expect(button("Link to a card")?.disabled).toBe(true);
    await choose(trigger, "Arcturus Construction");
    await click(button("Link to a card"));
    expect(api.calls.find(c => c.name === "link")?.args).toEqual({
      dealResponseId: deal.responseId,
      taskId: arcturus.taskId,
    });
    expect(page()).not.toContain("has no client card");
    const said = win.document.querySelector("[role='status']") as any;
    expect(String(said?.textContent)).toBe("Linked to Arcturus Construction.");
  });

  test("a Back with sales card says where its transfer is logged, never a dead end", async () => {
    const api = apiOf(async () => view());
    const handed: unknown[] = [];
    await render(
      h(PendingPayments, {
        api,
        onLogPayment: p => {
          handed.push(p);
          return false;
        },
      }),
    );
    await click(button(/^Back with sales/));
    const first = view().backWithSales?.rows[0];
    if (!first) throw new Error("No Back with sales row");
    const item = [...win.document.querySelectorAll("li")].find((x: any) =>
      String(x.textContent).startsWith(first.name),
    ) as any;
    await click(item.querySelector("button"));
    await click(button("Bank transfer, cheque or cash", item));
    expect(button("Log it as a payment", item)).toBeUndefined();
    expect(String(item.textContent)).toContain(
      "This card is with the sales team, so the billing sheet does not list it. Log the transfer from its sheet row once the card is back in onboarding.",
    );
    expect(String(item.textContent)).not.toContain("Reload the page");
    expect(String(item.textContent)).not.toContain(
      "It goes straight into the ledger.",
    );
    expect(handed).toEqual([]);
  });

  test("Possible money's Tie it hands the payment over, and never counts it", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    await click(button(/^Possible money/));
    expect(page()).toContain(
      "None of them counts as money until you tie it to the deal (not the card, so the closer is credited).",
    );
    const first = view().possibleMoney[0];
    await click(button("Tie it"));
    expect(api.calls.find(c => c.name === "openTie")?.args).toBe(
      first.paymentId,
    );
  });
});

describe("a payment left out of program money (20261024p)", () => {
  const LINE =
    "$1,500 on 21 Aug was the website, not program money (Whop; left out by Abdulaziz)";
  const castello = () => rowOf(/^Castello Industries$/);
  /** What the CEO's two writes were sent, in order. */
  let sent: { name: string; args: unknown }[] = [];
  const ceoApi = (read: BalancesRead) => {
    sent = [];
    return apiOf(async () => view(read), {
      exclude: async p => {
        sent.push({ name: "exclude", args: p });
        return "Left $1,500 on 21 Aug out of program money.";
      },
      unexclude: async p => {
        sent.push({ name: "unexclude", args: p });
        return "Counted as program money again.";
      },
    });
  };
  async function openCastello() {
    const more = button(/^Show all/);
    if (more) await click(more);
    await openRow(castello().taskId);
  }

  test("Castello's row reads $2,000 not seen and says where the website $1,500 went", async () => {
    const api = ceoApi(websiteLeftOut(LIVE_2026_10_23));
    await render(h(PendingPayments, { api }));
    expect(page()).toContain("Later parts$9,532 · 4 clients");
    await openCastello();
    const panel = win.document.getElementById(`pending-${castello().taskId}`);
    const text = String(panel?.textContent ?? "");
    expect(text).toContain("Where the numbers come from");
    expect(text).toContain(LINE);
    expect(text).toContain("Rails: Whop $500 (17 Aug), Whop $1,500 (21 Aug)");
    expect(text).not.toContain("the rails leave $500 on month 2 of 3");
  });

  test("the CEO counts it again with a reason, and the section reads again", async () => {
    const api = ceoApi(websiteLeftOut(LIVE_2026_10_23));
    await render(h(PendingPayments, { api }));
    await openCastello();
    await click(button("Count $1,500 on 21 Aug again"));
    const panel = win.document.getElementById(
      `pending-${castello().taskId}`,
    ) as any;
    const field = [...panel.querySelectorAll("label")].find(
      (l: any) =>
        String(l.textContent) === "Why Whop $1,500 on 21 Aug counts again",
    ) as any;
    const input = panel.querySelector(`[id="${field.getAttribute("for")}"]`);
    expect(button("Count it again")?.disabled).toBe(true);
    await type(input, "It was program money after all");
    const reads = api.calls.filter(c => c.name === "read").length;
    await click(button("Count it again"));
    expect(sent).toEqual([
      {
        name: "unexclude",
        args: {
          paymentId: CASTELLO_WEBSITE,
          reason: "It was program money after all",
        },
      },
    ]);
    expect(page()).toContain("Counted as program money again.");
    expect(api.calls.filter(c => c.name === "read").length).toBe(reads + 1);
  });

  test("the CEO leaves a payment out: the payment, what it was for, and a note for something else", async () => {
    const api = ceoApi(LIVE_2026_10_23);
    await render(h(PendingPayments, { api }));
    await openCastello();
    expect(button(/^Count .* again$/)).toBeUndefined();
    await click(button("Leave a payment out of program money"));
    const panel = win.document.getElementById(
      `pending-${castello().taskId}`,
    ) as any;
    expect(String(panel.textContent)).toContain(
      "It stops counting toward the plan here. Cash, ties and pay stay as they are.",
    );
    // The two $1,500 payments of 21 Aug are alike, so each option says its id.
    await choose(
      selectIn(panel, "Payment"),
      "Whop $1,500 on 21 Aug · pay_GYsGMMpS9xosfk",
    );
    await choose(selectIn(panel, "What it was for"), "Something else");
    expect(button("Leave it out")?.disabled).toBe(true);
    const note = [...panel.querySelectorAll("label")].find(
      (l: any) => String(l.textContent) === "Say what it was",
    ) as any;
    await type(
      panel.querySelector(`[id="${note.getAttribute("for")}"]`),
      "Logo design",
    );
    await click(button("Leave it out"));
    const out = sent[0] as { name: string; args: any };
    expect(out.name).toBe("exclude");
    expect(out.args).toMatchObject({
      taskId: castello().taskId,
      dealResponseId: "r6zgixh2u6paruulr6zgi2w9lckol261",
      reason: "other",
      note: "Logo design",
    });
    expect(out.args.paymentId).toBe("whop:pay_GYsGMMpS9xosfk");
    expect(page()).toContain("Left $1,500 on 21 Aug out of program money.");
  });

  test("a refusal shows the server's sentence; Keep counting it closes the form", async () => {
    const api = apiOf(async () => view(), {
      exclude: async () => {
        throw new Error("That payment is already left out of program money.");
      },
      unexclude: async () => "Counted as program money again.",
    });
    await render(h(PendingPayments, { api }));
    await openCastello();
    await click(button("Leave a payment out of program money"));
    await click(button("Leave it out"));
    expect(page()).toContain(
      "That payment is already left out of program money.",
    );
    await click(button("Keep counting it"));
    expect(button("Leave it out")).toBeUndefined();
    expect(button("Leave a payment out of program money")).toBeDefined();
  });

  test("a success manager reads the line and gets no control", async () => {
    const read = websiteLeftOut(LIVE_2026_10_23);
    read.ceo = false;
    const api = apiOf(async () => view(read), {
      link: undefined,
      unlink: undefined,
      openTie: undefined,
    });
    await render(h(PendingPayments, { api }));
    await openCastello();
    expect(page()).toContain(LINE);
    expect(button(/program money|again$/)).toBeUndefined();
  });
});

describe("before the onboarding call, and what else the section says", () => {
  /** The metal works with its call still a week ahead (booked on GHL, 30 Oct 14:30). */
  const ahead = () => {
    const read = copyRead(LIVE_2026_10_23);
    const metals = rowOf(/المعادن/);
    const card = read.cards.find(c => c.taskId === metals.taskId);
    if (!card) throw new Error("No metal works card");
    card.status = "Onboarding Booked";
    card.firstPastOnboardingBookedOn = null;
    read.kickoffs = read.kickoffs.filter(k => k.taskId !== metals.taskId);
    read.calls = [
      ...read.calls.filter(c => c.taskId !== metals.taskId),
      {
        taskId: metals.taskId,
        startsAt: "2026-10-30T14:30:00+03:00",
        status: "booked",
        source: "ghl_appointment",
        matchMethod: "client_id_field",
        confidence: 1,
        booked: true,
      },
    ];
    return { read, metals };
  };

  test("an onboarding payment still to come is under Onboarding with its call, and in its own figure", async () => {
    const { read, metals } = ahead();
    const api = apiOf(async () => view(read));
    await render(h(PendingPayments, { api }));
    expect(page()).toContain(
      "Expected on upcoming onboarding calls$5,750 · 1 client",
    );
    // Not in Not seen: the call is a week away.
    expect(page()).toContain("Onboarding not seen$18,002.82 · 5 clients");
    await click(button(/^Onboarding\d/));
    // Not seen comes first; the call a week away is the sixth row.
    expect(li(metals.taskId)).toBeNull();
    await click(button(/^Show all 6/));
    const row = String(li(metals.taskId)?.textContent);
    expect(row).toContain("Call 30 Oct 14:30 (booked) · in 7 days");
    expect(row).toContain("$5,750call 30 Oct");
    expect(page()).toContain("Still to pay");
  });

  test("a feed behind its schedule says so in a sentence; the CEO is told which deal has no card", async () => {
    // billing-sync's 21:37 run failed: at 21:55 the cards are from 21:07.
    const read = {
      ...copyRead(LIVE_2026_10_23),
      moneyAsOf: "2026-10-23T21:50:00+03:00",
      dealsAsOf: "2026-10-23T21:54:00+03:00",
      callsAsOf: "2026-10-23T21:45:00+03:00",
      cardsAsOf: "2026-10-23T21:07:01+03:00",
    };
    const api = apiOf(async () =>
      buildPending(read, Date.parse("2026-10-23T21:55:00+03:00")),
    );
    await render(h(PendingPayments, { api }));
    expect(page()).toContain(
      "Client cards last read at 21:07. A stage, plan or date changed in ClickUp after that shows at billing-sync's next read. Check that it is running.",
    );
    expect(page()).toContain(
      "1 signed deal has no client card: اكتوروس للتشيد. Until you link it to a card, a success manager sees no balance for that client.",
    );
    expect(button("Link to a card")).toBeUndefined();
    await click(button("Show the deal"));
    expect(button("Link to a card")).toBeDefined();
    expect(page()).toContain(
      "Finished on the rails: Makers, mergestudio.kw, ocean home, Shades Interior Design & General Contracting.",
    );
  });

  test("a client with no closer form whose card asks for money is still to come, and its payment goes to the sheet", async () => {
    const handed: unknown[] = [];
    const api = apiOf(async () => view());
    await render(
      h(PendingPayments, {
        api,
        onLogPayment: p => {
          handed.push(p);
          return true;
        },
      }),
    );
    await click(button(/^Still to come/));
    const liwan = rowOf(/^Liwan/);
    const row = String(li(liwan.taskId)?.textContent);
    expect(row).toContain("Terms not on record");
    expect(row).toContain("The card asks $1,333 on 2 Nov · in 10 days");
    expect(row).toContain("no closer form, so no rail is read");
    expect(row).toContain("$1,333card asks, 2 Nov");
    expect(row).not.toContain("$0");
    await openRow(liwan.taskId);
    const panel = win.document.getElementById(`pending-${liwan.taskId}`);
    const text = String(panel?.textContent);
    expect(text).not.toContain("How did they pay?");
    expect(text).not.toContain("Nothing left to confirm");
    expect(text).toContain(
      "With no closer form on record there is no plan to confirm a part against.",
    );
    await click(button("Log it as a payment", panel));
    expect(handed).toEqual([
      {
        taskId: liwan.taskId,
        name: liwan.name,
        amount: 1333,
        currency: "USD",
        note: "The card's next payment, from Pending payments",
      },
    ]);
  });

  test("every row and folded-group button has a visible focus ring", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    const rowButton = win.document.querySelector(
      "li[data-task] > button",
    ) as any;
    const fold = button(/^Gone quiet/);
    for (const b of [rowButton, fold])
      expect(String(b?.className)).toContain(
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      );
  });
});

describe("the CEO cockpit's Tie it (pages/ceo/billingTie.ts, as BillingTab wires it)", () => {
  const line = (id: string, direction: "in" | "out" = "in") =>
    ({ id, direction, day: "2026-08-30", usd: 502.04 }) as any;
  test("opens Money's tie sheet on that very payment, read when pressed", () => {
    const opened: unknown[] = [];
    const tabs: unknown[] = [];
    let lines: any[] = [];
    const openTie = tieOpener(
      () => lines,
      l => opened.push(l.id),
      t => tabs.push(t),
    );
    // The money section arrives after the wiring is made.
    lines = [line("tap:chg_A"), line("whop:pay_B")];
    openTie("whop:pay_B");
    expect(opened).toEqual(["whop:pay_B"]);
    expect(tabs).toEqual([]);
  });

  test("a payment the money section no longer lists, or one the tie cannot take, opens Transactions", () => {
    const opened: unknown[] = [];
    const tabs: unknown[] = [];
    const openTie = tieOpener(
      () => [line("tap:chg_A"), line("ecom:26B1"), line("whop:out", "out")],
      l => opened.push(l.id),
      t => tabs.push(t),
    );
    openTie("tap:chg_gone");
    openTie("ecom:26B1");
    openTie("whop:out");
    expect(opened).toEqual([]);
    expect(tabs).toEqual(["transactions", "transactions", "transactions"]);
  });

  test("BillingTab hands Possible money's id to the tie opener, not just the tab", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/pages/ceo/BillingTab.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /openTie: tieOpener\(\(\) => linesNow\.current, setTying, goTab\)/,
    );
    expect(src).toContain(
      'subject={tying ? { kind: "payment", line: tying } : null}',
    );
    expect(src).not.toContain('goTab("transactions")');
  });
});

describe("a success manager", () => {
  test("never sees the CEO's groups, payer names or the Transactions door", async () => {
    const read = billingRead("csm", NOW);
    const api = apiOf(async () => view(read), {
      link: undefined,
      unlink: undefined,
      openTie: undefined,
    });
    await render(h(PendingPayments, { api }));
    const t = page();
    expect(t).toContain("Onboarding not seen$23,752.82 · 6 clients");
    for (const hidden of [
      "Back with sales",
      "no client card",
      "Possible money",
      "Only the CEO sees this.",
      "Open Transactions",
    ])
      expect(t).not.toContain(hidden);
    // Open every listed row under every chip: no payer name from the untied
    // money shows, and no contact name from a closer form.
    const payers = [
      ...LIVE_2026_10_23.untied.map(u => u.payerName),
      ...LIVE_2026_10_23.deals.map(d => d.contactName),
    ].filter(Boolean) as string[];
    expect(payers.length).toBeGreaterThan(5);
    let opened = 0;
    for (const c of view(read).chips) {
      if (!c.count) continue;
      await click(button(new RegExp(`^${c.label}\\d`)));
      const more = button(/^Show all/);
      if (more) await click(more);
      for (const r of view(read).rows.filter(x => x.chips.includes(c.key))) {
        if (
          li(r.taskId)
            ?.querySelector("button")
            .getAttribute("aria-expanded") !== "true"
        )
          await openRow(r.taskId);
        opened++;
        for (const p of payers) expect(page()).not.toContain(p);
      }
    }
    expect(opened).toBeGreaterThanOrEqual(12);
  });

  test("Withdraw shows on your own confirmation only; the CEO's read offers it on any", async () => {
    const read = billingRead("confirmed", NOW);
    const csm = { ...read, ceo: false };
    const alalia = rowOf(/^Alalia/);
    const api = apiOf(async () => view(csm));
    await render(h(PendingPayments, { api }));
    await click(button(/^Show all/));
    await openRow(alalia.taskId);
    const panel = win.document.getElementById(`pending-${alalia.taskId}`);
    expect(String(panel?.textContent)).toContain(
      "Confirmed by Noor 11 days ago · waiting for the CEO to find it",
    );
    expect(button("Withdraw", panel)).toBeUndefined();

    const ceoApi = apiOf(async () => view(read));
    await render(null);
    await render(h(PendingPayments, { api: ceoApi }));
    await click(button(/^Show all/));
    await openRow(alalia.taskId);
    const ceoPanel = win.document.getElementById(`pending-${alalia.taskId}`);
    await click(button("Withdraw", ceoPanel));
    const go = () =>
      buttons(ceoPanel).filter(
        b => String(b.textContent).trim() === "Withdraw",
      )[0];
    expect(go().disabled).toBe(true);
    await type(ceoPanel?.querySelector("input"), "Wrong client");
    expect(go().disabled).toBe(false);
    await click(go());
    expect(ceoApi.calls.find(c => c.name === "withdraw")?.args).toEqual({
      taskId: alalia.taskId,
      confirmationId: 9002,
      reason: "Wrong client",
    });
  });
});

describe("Confirm paid", () => {
  const metals = rowOf(/المعادن/);
  const deal = LIVE_2026_10_23.deals.find(d => d.taskId === metals.taskId);

  test("busy reads Confirming; done shows the server's sentence and reads again", async () => {
    let release: (s: string) => void = () => {};
    const changed: string[] = [];
    const api = apiOf(async () => view(), {
      confirm: p => {
        api.calls.push({ name: "confirm", args: p });
        return new Promise<string>(r => {
          release = r;
        });
      },
    });
    await render(
      h(PendingPayments, { api, onChanged: () => changed.push("x") }),
    );
    await openRow(metals.taskId);
    const panel = () =>
      win.document.getElementById(`pending-${metals.taskId}`) as any;
    expect(String(panel().textContent)).toContain(
      "Onboarding payment · $5,750 open",
    );
    expect(button("Confirm paid", panel())).toBeUndefined();
    await click(button("Tap", panel()));
    const amount = [...panel().querySelectorAll("input")].find(
      (i: any) => i.getAttribute("inputmode") === "decimal",
    ) as any;
    expect(amount.value).toBe("5750");
    expect(String(panel().textContent)).toContain(
      "Your word, not money: it holds the part until Tap shows the payment",
    );
    await click(button("Confirm paid", panel()));
    expect(button("Confirming", panel())?.disabled).toBe(true);
    const sent = api.calls.find(c => c.name === "confirm")
      ?.args as ConfirmInput;
    expect(sent).toEqual({
      taskId: metals.taskId,
      dealResponseId: deal?.responseId ?? null,
      part: "onboarding",
      partNo: 0,
      amount: 5750,
      currency: "USD",
      rail: "tap",
      paidOn: "2026-10-23",
      evidenceUrl: null,
      note: null,
    });
    await act(async () => release("Confirmed by you · waiting for Tap"));
    await flush();
    expect(String(panel().textContent)).toContain(
      "Confirmed by you · waiting for Tap",
    );
    expect(api.calls.filter(c => c.name === "read").length).toBe(2);
    expect(changed).toEqual(["x"]);
  });

  test("an open row keeps its place when a confirmation moves it out of its chip", async () => {
    const city = rowOf(/^City Wood$/);
    const after = structuredClone(LIVE_2026_10_23);
    after.confirmations = [
      {
        id: 77,
        taskId: city.taskId,
        dealResponseId:
          after.deals.find(d => d.taskId === city.taskId)?.responseId ?? null,
        part: "onboarding",
        partNo: 0,
        amount: 5500,
        currency: "USD",
        usd: 5500,
        rail: "tap",
        paidOn: "2026-10-23",
        evidenceUrl: null,
        note: null,
        railsUsdAtConfirm: 500,
        source: "ceo",
        confirmedByName: "The CEO",
        confirmedByCeo: true,
        byYou: true,
        confirmedAt: "2026-10-23T17:30:00Z",
        withdrawnByName: null,
        withdrawnAt: null,
        withdrawnReason: null,
      },
    ];
    let reads = 0;
    const api = apiOf(async () => (reads++ ? view(after) : view()));
    await render(h(PendingPayments, { api }));
    await click(button(/^Another source/));
    const order = () =>
      [...win.document.querySelectorAll("li[data-task]")].map((x: any) =>
        x.getAttribute("data-task"),
      );
    const at = order().indexOf(city.taskId);
    expect(at).toBe(1);
    await openRow(city.taskId);
    const panel = win.document.getElementById(`pending-${city.taskId}`);
    await click(button("Tap", panel));
    await click(button("Confirm paid", panel));
    expect(view(after).rows.find(r => r.taskId === city.taskId)?.chips).toEqual(
      ["toCome"],
    );
    expect(order().indexOf(city.taskId)).toBe(at);
    // Held whole by the confirmation: the amount says so, never n/a.
    expect(String(li(city.taskId).textContent)).toContain("$5,500confirmed");
  });

  test("a refusal shows the server's sentence and changes nothing", async () => {
    const api = apiOf(async () => view(), {
      confirm: async () => {
        throw Object.assign(new Error("refused"), {
          data: {
            code: "refused",
            message: "That is more than the $5,750 the rails have not shown.",
          },
        });
      },
    });
    await render(h(PendingPayments, { api }));
    await openRow(metals.taskId);
    const panel = win.document.getElementById(`pending-${metals.taskId}`);
    await click(button("Whop", panel));
    await click(button("Confirm paid", panel));
    const alert = panel?.querySelector("[role='alert']");
    expect(alert?.textContent).toBe(
      "That is more than the $5,750 the rails have not shown.",
    );
    expect(api.calls.filter(c => c.name === "read").length).toBe(1);
  });

  test("a receipt link must be https, and the button waits for it", async () => {
    const api = apiOf(async () => view());
    await render(h(PendingPayments, { api }));
    await openRow(metals.taskId);
    const panel = win.document.getElementById(`pending-${metals.taskId}`);
    await click(button("Ecom link", panel));
    const receipt = panel?.querySelector("input[placeholder='https://']");
    await type(receipt, "http://example.test/r");
    expect(String(panel?.textContent)).toContain(
      "A receipt link starts with https://.",
    );
    expect(button("Confirm paid", panel)?.disabled).toBe(true);
    await type(receipt, "https://example.test/r");
    expect(button("Confirm paid", panel)?.disabled).toBe(false);
  });

  test("a transfer, cheque or cash hands over to the sheet's Log a payment", async () => {
    const handed: unknown[] = [];
    let opens = true;
    const api = apiOf(async () => view());
    await render(
      h(PendingPayments, {
        api,
        onLogPayment: p => {
          handed.push(p);
          return opens;
        },
      }),
    );
    await openRow(metals.taskId);
    const panel = win.document.getElementById(`pending-${metals.taskId}`);
    await click(button("Bank transfer, cheque or cash", panel));
    expect(button("Confirm paid", panel)).toBeUndefined();
    expect(String(panel?.textContent)).toContain(
      "A transfer, cheque or cash never arrives on its own",
    );
    await click(button("Log it as a payment", panel));
    expect(handed).toEqual([
      {
        taskId: metals.taskId,
        name: metals.name,
        amount: 5750,
        currency: "USD",
        note: "Onboarding payment, from Pending payments",
      },
    ]);
    // Typed in dinars on the Tap form first: the dinars go over as dinars.
    await click(button("Tap", panel));
    await choose(selectIn(panel, "Currency"), "KWD");
    const amount = [...(panel?.querySelectorAll("input") ?? [])].find(
      (i: any) => i.getAttribute("inputmode") === "decimal",
    ) as any;
    await type(amount, "1500");
    expect(String(panel?.textContent)).toContain("Counted as $4,890");
    await click(button("Bank transfer, cheque or cash", panel));
    await click(button("Log it as a payment", panel));
    expect(handed[1]).toEqual({
      taskId: metals.taskId,
      name: metals.name,
      amount: 1500,
      currency: "KWD",
      note: "Onboarding payment, from Pending payments",
    });
    opens = false;
    await click(button("Log it as a payment", panel));
    expect(panel?.querySelector("[role='alert']")?.textContent).toContain(
      "is not in the billing sheet below yet",
    );
    expect(api.calls.some(c => c.name === "confirm")).toBe(false);
  });

  test("a row with no terms on record offers what they paid in all, starting empty", async () => {
    const read = structuredClone(LIVE_2026_10_23);
    const alalia = rowOf(/^Alalia/);
    read.deals = read.deals.filter(d => d.taskId !== alalia.taskId);
    const api = apiOf(async () => view(read));
    await render(h(PendingPayments, { api }));
    await click(button(/^Onboarding\d/));
    await click(button(/^Show all/));
    await openRow(alalia.taskId);
    const panel = win.document.getElementById(`pending-${alalia.taskId}`);
    expect(String(panel?.textContent)).toContain(
      "Terms not on record: no closer form we could match. Confirm what they paid.",
    );
    expect(String(panel?.textContent)).toContain(
      "What they paid in all · amount not known",
    );
    await click(button("Whop", panel));
    const amount = [...(panel?.querySelectorAll("input") ?? [])].find(
      (i: any) => i.getAttribute("inputmode") === "decimal",
    ) as any;
    expect(amount.value).toBe("");
    expect(button("Confirm paid", panel)?.disabled).toBe(true);
  });
});

describe("states", () => {
  test("loading says so, then a refused read says what to do and tries again", async () => {
    let fail = true;
    let release: () => void = () => {};
    const api = apiOf(
      () =>
        new Promise<PendingView>((resolve, reject) => {
          release = () =>
            fail
              ? reject(
                  new Error(
                    "Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.",
                  ),
                )
              : resolve(view());
        }),
    );
    await render(h(PendingPayments, { api }));
    expect(page()).toContain("Reading pending payments");
    await act(async () => release());
    await flush();
    expect(page()).toContain(
      "Pending payments did not load: Pending payments need a client success, finance or CEO seat. Ask an admin to add the role. The billing sheet below still works.",
    );
    fail = false;
    await click(button("Try again"));
    await act(async () => release());
    await flush();
    expect(page()).toContain("Onboarding not seen$23,752.82");
  });

  test("with no money ledger every amount reads n/a, never $0", async () => {
    const api = apiOf(async () => view(billingRead("never", NOW)));
    await render(h(PendingPayments, { api }));
    const t = page();
    expect(t).toContain("Onboarding not seenn/a");
    expect(t).not.toContain("n/a · 0 clients");
    expect(t).toContain(
      "The money ledger has not run yet, so no rail money is counted.",
    );
    expect(t).not.toMatch(/Onboarding not seen\$0/);
    expect(t).toContain("money not read");
    // No ribbon, no parts and no "sources disagree" against rails nobody read.
    expect(win.document.querySelector("[role='img']")).toBeNull();
    expect(t).not.toContain("sources disagree");
    const anyRow = win.document.querySelector("li[data-task]") as any;
    await click(anyRow.querySelector("button"));
    expect(page()).not.toContain("Part by part");
    expect(page()).not.toContain("Sources disagree");
    // Open every listed row under every chip: no word leans on rails
    // nobody read.
    const never = view(billingRead("never", NOW));
    let opened = 0;
    let railsLine = false;
    for (const c of never.chips) {
      if (!c.count) continue;
      await click(button(new RegExp(`^${c.label}\\d`)));
      const more = button(/^Show all/);
      if (more) await click(more);
      for (const r of never.rows.filter(x => x.chips.includes(c.key))) {
        await openRow(r.taskId);
        opened++;
        const text = String(li(r.taskId)?.textContent);
        expect(text).not.toContain("No rail has ever");
        expect(text).not.toContain("rails leave");
        expect(text).not.toContain("Rails: none tied");
        expect(text).not.toContain("Put the next part on the card");
        if (text.includes("Rails: not read, the money ledger has not run"))
          railsLine = true;
        // A card-only row still says what its card asks.
        if (r.cardOnly) expect(text).toContain("card asks");
      }
    }
    expect(opened).toBeGreaterThanOrEqual(never.rows.length);
    expect(railsLine).toBe(true);
  });

  test("stale money says when it was read", async () => {
    const api = apiOf(async () => view(billingRead("stale", NOW)));
    await render(h(PendingPayments, { api }));
    expect(page()).toMatch(
      /Money last read at \d\d:\d\d\. A payment made after that shows at the next refresh\./,
    );
  });

  test("nobody owing anything says so and what shows here", async () => {
    const api = apiOf(async () => view(billingRead("empty", NOW)));
    await render(h(PendingPayments, { api }));
    expect(page()).toContain("Every signed client has finished paying.");
    expect(page()).toContain(
      "New clients show here from sign-up until their onboarding payment lands on a rail.",
    );
    expect(page()).not.toContain("Onboarding not seen");
  });
});

describe("inside the billing sheet", () => {
  const read = billingRead("confirmed", NOW);
  const tables = sheetTables(read);
  const sheetEvents = [
    {
      id: 1,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "confirm",
      from_value: null,
      to_value: "5750",
      reason: null,
      detail: {
        part: "onboarding",
        partNo: 0,
        rail: "tap",
        paidOn: "2026-10-20",
      },
      source: "csm",
      by_whom: "sara@example.test",
      at: "2026-10-23T09:00:00Z",
    },
    {
      id: 2,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "unconfirm",
      from_value: "5750",
      to_value: null,
      reason: "Wrong client",
      detail: {},
      source: "csm",
      by_whom: "sara@example.test",
      at: "2026-10-23T10:00:00Z",
    },
    {
      id: 3,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "link",
      from_value: null,
      to_value: "deal-1",
      reason: null,
      detail: {},
      source: "ceo",
      by_whom: "ceo@example.test",
      at: "2026-10-23T11:00:00Z",
    },
    {
      id: 4,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "unlink",
      from_value: "deal-1",
      to_value: null,
      reason: "Linked to the wrong card",
      detail: {},
      source: "ceo",
      by_whom: "ceo@example.test",
      at: "2026-10-23T12:00:00Z",
    },
    {
      id: 6,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "exclude",
      from_value: null,
      to_value: "whop:pay_fixture",
      reason: null,
      detail: { usd: 1500, rail: "whop", day: "2026-08-21", reason: "website" },
      source: "ceo",
      by_whom: "ceo@example.test",
      at: "2026-10-23T13:00:00Z",
    },
    {
      id: 7,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "unexclude",
      from_value: "whop:pay_fixture",
      to_value: null,
      reason: "Program money after all",
      detail: {},
      source: "ceo",
      by_whom: "ceo@example.test",
      at: "2026-10-23T14:00:00Z",
    },
    {
      id: 5,
      clickup_task_id: tables.accounts[0].clickup_task_id,
      client_name: tables.accounts[0].client_name,
      kind: "payment",
      from_value: null,
      to_value: null,
      reason: null,
      detail: {},
      source: "maher",
      by_whom: "maher@example.test",
      at: "2026-10-22T12:00:00Z",
    },
  ];
  const sheet = () =>
    buildSheet(
      tables.accounts.map(accountFrom),
      sheetEvents,
      tables.inbox,
      "2026-10-23",
    );

  function sheetApi(pending: PendingApi | undefined) {
    const edits: unknown[] = [];
    const api: BillingApi = {
      sheet: async () => sheet(),
      edit: async a => {
        edits.push(a);
        const acc = tables.accounts.find(
          x => x.clickup_task_id === a.taskId,
        ) as any;
        return accountFrom(acc);
      },
      logPayment: async () => "Logged.",
      ledgerLine: "It goes straight into the ledger.",
      pending,
    };
    return { api, edits };
  }

  test("a failed pending read never blocks the sheet, and the log says the new kinds in words", async () => {
    const pending = apiOf(async () => {
      throw new Error("The server did not answer. Try again in a minute.");
    });
    const { api } = sheetApi(pending);
    await render(h(BillingSheet, { api }));
    const t = page();
    expect(t).toContain(
      "Pending payments did not load: The server did not answer. Try again in a minute. The billing sheet below still works.",
    );
    expect(t).toContain("Needs you now");
    expect(t).toContain(
      "sara confirmed $5,750 paid by Tap on 20 Oct for the onboarding payment. A person's word, not money.",
    );
    expect(t).toContain("sara withdrew a confirmation of $5,750: Wrong client");
    expect(t).toContain("ceo linked a signed deal to this client.");
    expect(t).toContain(
      "ceo unlinked a signed deal from this client: Linked to the wrong card",
    );
    expect(t).toContain(
      "ceo left $1,500 by Whop on 21 Aug out of program money (the website). Cash and pay are unchanged.",
    );
    expect(t).toContain(
      "ceo counted a payment as program money again: Program money after all",
    );
    expect(t).not.toMatch(
      /: (confirm|unconfirm|link|unlink|exclude|unexclude)[.,]/,
    );
    // A payment row with no amount on record says so, never "$NaN".
    expect(t).toContain("Maher logged a payment.");
    expect(t).not.toContain("NaN");
  });

  test("a cockpit that passes no pending api shows no section", async () => {
    const { api } = sheetApi(undefined);
    await render(h(BillingSheet, { api }));
    expect(page()).not.toContain("Pending payments");
    expect(page()).toContain("Billing log");
  });

  test("Log it as a payment opens the client's own row on Log a payment, filled in", async () => {
    const pending = apiOf(async () => view(read));
    const { api } = sheetApi(pending);
    await render(h(BillingSheet, { api }));
    // The waiting confirmation holds the metal works' onboarding part:
    // it moves to Still to come, and nothing is left to confirm.
    const metals = rowOf(/المعادن/);
    await click(button(/^Still to come/));
    await openRow(metals.taskId);
    const panel = win.document.getElementById(`pending-${metals.taskId}`);
    expect(String(panel?.textContent)).toContain(
      "Nothing left to confirm: every part is on a rail or held by a confirmation.",
    );
    expect(String(li(metals.taskId).textContent)).toContain(
      "Confirmed by you · waiting for Tap",
    );
    expect(String(li(metals.taskId).textContent)).toContain("$5,750 confirmed");
    const ard = rowOf(/^Ardon$/);
    await openRow(ard.taskId);
    const ardPanel = win.document.getElementById(`pending-${ard.taskId}`);
    await click(button("Bank transfer, cheque or cash", ardPanel));
    await click(button("Log it as a payment", ardPanel));
    const sheetRow = win.document.getElementById(`billing-row-${ard.taskId}`);
    expect(sheetRow).toBeTruthy();
    const tabs = [
      ...(sheetRow?.querySelectorAll("[role='tab']") ?? []),
    ] as any[];
    expect(
      tabs.find(x => x.getAttribute("aria-selected") === "true")?.textContent,
    ).toBe("Log a payment");
    const inputs = [...(sheetRow?.querySelectorAll("input") ?? [])] as any[];
    expect(inputs.some(i => i.value === "2000")).toBe(true);
    expect(
      inputs.some(i => i.value === "Month 2 of 3, from Pending payments"),
    ).toBe(true);
  });

  test("a dinar figure handed over opens the sheet's form in dinars", async () => {
    const pending = apiOf(async () => view(read));
    const { api } = sheetApi(pending);
    await render(h(BillingSheet, { api }));
    const ard = rowOf(/^Ardon$/);
    await click(button(/^Still to come/));
    await openRow(ard.taskId);
    const ardPanel = win.document.getElementById(`pending-${ard.taskId}`);
    await click(button("Tap", ardPanel));
    await choose(selectIn(ardPanel, "Currency"), "KWD");
    const amount = [...(ardPanel?.querySelectorAll("input") ?? [])].find(
      (i: any) => i.getAttribute("inputmode") === "decimal",
    ) as any;
    await type(amount, "613.5");
    await click(button("Bank transfer, cheque or cash", ardPanel));
    await click(button("Log it as a payment", ardPanel));
    const sheetRow = win.document.getElementById(
      `billing-row-${ard.taskId}`,
    ) as any;
    const inputs = [...sheetRow.querySelectorAll("input")] as any[];
    expect(inputs.some(i => i.value === "613.5")).toBe(true);
    expect(String(selectIn(sheetRow, "Currency")?.textContent)).toBe("KWD");
  });

  test("Put the next part on the card: a half-saved change is never sent twice", async () => {
    const pending = apiOf(async () => view(read));
    const ard = rowOf(/^Ardon$/);
    // The card asks $1,000 on 27 Nov: both the amount and the date differ.
    const acc = tables.accounts.find(a => a.clickup_task_id === ard.taskId);
    if (!acc) throw new Error("No Ardon account");
    const was = { usd: acc.next_payment_usd, date: acc.next_payment_date };
    acc.next_payment_usd = 1000;
    acc.next_payment_date = "2026-11-27";
    try {
      const { api } = sheetApi(pending);
      const edits: any[] = [];
      let dateFails = 1;
      api.edit = async a => {
        edits.push(a);
        if (a.edit.kind === "date" && dateFails-- > 0)
          throw new Error("ClickUp did not answer. Try again in a minute.");
        if (a.edit.kind === "amount") acc.next_payment_usd = a.edit.value;
        if (a.edit.kind === "date") acc.next_payment_date = a.edit.value;
        return accountFrom(acc);
      };
      await render(h(BillingSheet, { api }));
      await click(button(/^Still to come/));
      await openRow(ard.taskId);
      const panel = win.document.getElementById(`pending-${ard.taskId}`);
      await click(button("Set on the card", panel));
      expect(panel?.querySelector("[role='alert']")?.textContent).toBe(
        "The amount is on the card, but the date is not: ClickUp did not answer. Try again in a minute.",
      );
      // The sheet holds the saved amount at once, so trying again sends
      // only the date.
      await click(button("Set on the card", panel));
      expect(edits.map(e => e.edit.kind)).toEqual(["amount", "date", "date"]);
    } finally {
      acc.next_payment_usd = was.usd;
      acc.next_payment_date = was.date;
    }
  });

  test("a payment the sheet logs reads the section again", async () => {
    const pending = apiOf(async () => view(read));
    const { api } = sheetApi(pending);
    await render(h(BillingSheet, { api }));
    const reads = () => pending.calls.filter(c => c.name === "read").length;
    const before = reads();
    const ard = rowOf(/^Ardon$/);
    await click(button(/^Still to come/));
    await openRow(ard.taskId);
    const ardPanel = win.document.getElementById(`pending-${ard.taskId}`);
    await click(button("Bank transfer, cheque or cash", ardPanel));
    await click(button("Log it as a payment", ardPanel));
    const sheetRow = win.document.getElementById(`billing-row-${ard.taskId}`);
    await click(button("Log the payment", sheetRow));
    expect(page()).toContain("Logged.");
    expect(reads()).toBe(before + 1);
  });

  test("Put the next part on the card writes the amount through the sheet's edit path", async () => {
    const pending = apiOf(async () => view(read));
    const { api, edits } = sheetApi(pending);
    await render(h(BillingSheet, { api }));
    const ard = rowOf(/^Ardon$/);
    await click(button(/^Still to come/));
    await openRow(ard.taskId);
    const panel = win.document.getElementById(`pending-${ard.taskId}`);
    expect(String(panel?.textContent)).toContain(
      "The plan's next part is month 2 of 3, $2,000 on 27 Oct.",
    );
    await click(button("Set on the card", panel));
    expect(edits).toEqual([
      { taskId: ard.taskId, edit: { kind: "amount", value: 2000 } },
    ]);
    expect(String(panel?.textContent)).toContain(
      "Set on the card. ClickUp gets it when write-back is on.",
    );
  });
});
