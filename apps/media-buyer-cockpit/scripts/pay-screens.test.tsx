/**
 * The pay screens on Team & payroll (docs/pay/PAY-PLANS.md section 8),
 * rendered in happy-dom: the band ruler, the Pay plans card, the pay plan
 * sheet, the Pay for [month] card with its receipts, and the entry, confirm
 * and metric switch dialogs. The database is the cockpit's own client with
 * its rpc answered from the made-up harness fixtures (src/dev/payFixture.ts);
 * every write is caught here and its payload checked, never sent. What it
 * pins: the copy for a missing input, a rule not met, a decision waiting, an
 * approved month and a change since approval; the payloads of every write
 * the screens make; and the small rules behind them (payCopy.ts). Every
 * person, client and id is invented.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks, and every global and the env are put back.
const g = globalThis as any;
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
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The pay screens test makes no network calls.");
}) as typeof fetch;

// --- The database: the cockpit's own client, its rpc answered here. ---
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const realRpc = db.rpc;
const realGetSession = db.auth.getSession;
type Answer = { data: unknown; error: { message: string } | null };
const calls: { name: string; args: any }[] = [];
let override: ((name: string, args: any) => Answer | null) | null = null;
const { payRpc } = await import("../src/dev/payFixture");
// The roster and hours read the hours harness's made-up answers.
const { installHoursHarness } = await import("../src/dev/hoursHarness");
const harness: any = { rpc: null, functions: { invoke: null } };
installHoursHarness(harness);
db.rpc = async (name: string, args: any = {}) => {
  calls.push({ name, args });
  const o = override?.(name, args);
  if (o) return o;
  // Writes are caught: the fixture would remember a saved plan across tests.
  if (name === "cockpit_ceo_pay_plan_save")
    return { data: { ok: true, id: 99 }, error: null };
  if (name === "cockpit_ceo_people_save")
    return { data: { ok: true, id: args.p_patch?.id ?? 1 }, error: null };
  if (/^cockpit_ceo_(pay|payment)_/.test(name)) return payRpc(name, args);
  return harness.rpc(name, args);
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token" } },
  error: null,
});
const writes = (name: string) =>
  calls.filter(c => c.name === name).map(c => c.args);

// --- A DOM. ---
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=team" });
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
  if (
    typeof args[0] === "string" &&
    (args[0].includes("not wrapped in act") ||
      args[0].includes("DialogContent") ||
      args[0].includes("Missing `Description`") ||
      args[0].includes("useLayoutEffect does nothing on the server"))
  )
    return;
  realError(...args);
};

// The cards fade in with framer-motion, whose animations happy-dom cancels
// between tests; skip them here, and put the setting back after.
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { BandRuler, MetricSwitchDialog, rulerSentence, switchedPart } =
  await import("../src/pages/ceo/pay/BandRuler");
const { PayPlansCard, rolePlanLine, rolePlanRows } = await import(
  "../src/pages/ceo/pay/PayPlansCard"
);
const { PayPlanSheet, marksFor, alsoFor } = await import(
  "../src/pages/ceo/pay/PayPlanSheet"
);
const { TeamTab } = await import("../src/pages/ceo/TeamTab");
const { MemoryRouter } = await import("react-router");
const { PayMonthCard } = await import("../src/pages/ceo/pay/PayMonthCard");
const { PayEntryDialog, entryPayload } = await import(
  "../src/pages/ceo/pay/PayEntryDialog"
);
const { PayConfirmDialog, churnCards, churnPct, confirmStart } = await import(
  "../src/pages/ceo/pay/PayConfirmDialog"
);
const copy = await import("../src/pages/ceo/pay/payCopy");
const { COMMISSION_GROUPS } = await import("../src/pages/ceo/pay/fields");
const { COMMISSION_BASES } = await import("../src/types/ceo/commission");
const { ROLE_PLANS_2026_10, partSentence, partSummary, suggestBands } =
  await import("../src/types/ceo/payPlan");
const { payPlansFixture, payMonthFixture } = await import(
  "../src/dev/payFixture"
);

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
async function show(el: any) {
  await act(async () => root.render(el));
  await flush();
}
const body = () => win.document.body;
const text = (el: any = body()) => (el?.textContent ?? "") as string;
function buttons(label: string, within: any = body()) {
  return Array.from(within.querySelectorAll("button") as ArrayLike<any>).filter(
    b =>
      `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`.includes(
        label,
      ),
  );
}
function button(label: string, within: any = body()) {
  const b = buttons(label, within)[0];
  if (!b)
    throw new Error(`No button "${label}" in: ${text(within).slice(0, 400)}`);
  return b;
}
async function click(el: any) {
  await act(async () => {
    el.click();
  });
  await flush();
}
async function type(el: any, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    win.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush(2);
}
const input = (label: string) => {
  const el = body().querySelector(`input[aria-label="${label}"]`) as any;
  if (!el) throw new Error(`No input "${label}"`);
  return el;
};
const dialog = () => win.document.querySelector('[role="dialog"]') as any;
/** One person's receipt on the month card. */
const receipt = (name: string) =>
  Array.from(
    host.querySelectorAll("#team-pay-month details") as ArrayLike<any>,
  ).find(d => text(d.querySelector("summary")).includes(name)) as any;

const plans = payPlansFixture("full");
const october = payMonthFixture("full", "2026-10-01");
const mediaBuyer = ROLE_PLANS_2026_10["Media buyer"].parts[0] as any;
const retention = ROLE_PLANS_2026_10["Client success manager"].parts.find(
  p => p.key === "retention",
) as any;
const renewals = ROLE_PLANS_2026_10["Client success manager"].parts.find(
  p => p.key === "renewals",
) as any;

beforeEach(() => {
  calls.length = 0;
  override = null;
});
afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});
afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  MotionGlobalConfig.skipAnimations = skipBefore;
  db.rpc = realRpc;
  db.auth.getSession = realGetSession;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
});

// ---------------------------------------------------------------------------

describe("the band ruler", () => {
  test("one segment per band; this month's band solid, the others washes", () => {
    const html = renderToStaticMarkup(
      createElement(BandRuler, {
        part: mediaBuyer,
        marks: [{ value: 12.45, label: "Oct" }],
      }),
    );
    expect(html).toContain('role="img"');
    // Five bands: the $200 one (index 2) is the teal itself.
    expect(html.match(/background-color:var\(--ceo-emphasis\)/g)?.length).toBe(
      1,
    );
    expect(html).toContain("$12.45");
    for (const edge of ["$8", "$10", "$13", "$15"])
      expect(html).toContain(edge);
  });

  test("the screen reader hears every band and where this month sits", () => {
    expect(rulerSentence(mediaBuyer, [{ value: 12.45, label: "Oct" }])).toBe(
      "Bonus by cost per lead: under $8 pays $400, $8 to under $10 pays $300, $10 to under $13 pays $200, $13 up to $15 pays $100, over $15 pays nothing. Oct: $12.45, in the $200 band.",
    );
    // $15.40 is past the top paid band: nothing (decision 4).
    expect(
      rulerSentence(mediaBuyer, [{ value: 15.4, label: "Oct" }]),
    ).toEndWith("Oct: $15.40, in the nothing band.");
  });

  test("a deduction band is grey with a red dot, and the 0% band still shows", () => {
    const html = renderToStaticMarkup(
      createElement(BandRuler, { part: retention, marks: [] }),
    );
    expect(html).toContain("var(--ceo-critical)");
    const layout = copy.rulerLayout(retention.bands);
    expect(layout.segments).toHaveLength(7);
    expect(layout.segments[0].width).toBeGreaterThanOrEqual(0.069);
    const sum = layout.segments.reduce((s, x) => s + x.width, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  test("a value sits inside the band that pays it, edges included or not", () => {
    const layout = copy.rulerLayout(mediaBuyer.bands, [12.45]);
    const seg = (i: number) => layout.segments[i];
    const inside = (v: number, i: number) => {
      const at = layout.at(v);
      return (
        at >= seg(i).start - 1e-9 && at <= seg(i).start + seg(i).width + 1e-9
      );
    };
    expect(inside(12.45, 2)).toBe(true);
    expect(inside(15, 3)).toBe(true); // "$13 up to $15" includes $15
    expect(inside(10, 2)).toBe(true); // "$8 to under $10" does not
    // A value past the last edge widens the open band to hold it.
    expect(copy.rulerLayout(mediaBuyer.bands, [40]).top).toBeGreaterThan(40);
  });
});

describe("Pay plans card", () => {
  test("one row per role plan: role, plan, people, month", async () => {
    await show(
      createElement(PayPlansCard, {
        plans,
        error: null,
        onRetry: () => {},
        onOpenRole: () => {},
        onOpenPerson: () => {},
      }),
    );
    const month = copy.thisMonth();
    const row = rolePlanRows(plans, month).find(
      r => r.row.role === "Media buyer",
    );
    expect(row && rolePlanLine(plans, row.row, month)).toBe(
      "Media buyer · bonus by cost per lead, up to $400 · 1 person · from Oct 2026",
    );
    expect(text(host)).toContain("Plan for a role");
    expect(text(host)).toContain("Own plans");
    expect(text(host)).toContain("Fadi Nassar");
  });

  test("no plans: an empty state that offers the first one; unreadable: the reason and Try again", async () => {
    await show(
      createElement(PayPlansCard, {
        plans: payPlansFixture("empty"),
        error: null,
        onRetry: () => {},
        onOpenRole: () => {},
        onOpenPerson: () => {},
      }),
    );
    expect(text(host)).toContain("No role plans yet");
    await show(
      createElement(PayPlansCard, {
        plans: null,
        error: "The pay plans could not be read: made-up outage.",
        onRetry: () => {},
        onOpenRole: () => {},
        onOpenPerson: () => {},
      }),
    );
    expect(text(host)).toContain("made-up outage");
    expect(buttons("Try again", host)).toHaveLength(1);
  });
});

describe("the pay plan sheet", () => {
  const sheet = (scope: any) =>
    createElement(PayPlanSheet, {
      scope,
      plans,
      month: october,
      onClose: () => {},
      onSaved: () => {},
      onOpenRole: () => {},
    });

  test("a role plan saves as a whole, from a month, and says so", async () => {
    await show(sheet({ kind: "role", role: "Media buyer" }));
    expect(text(dialog())).toContain("Media buyer plan");
    // The ruler's tick is this month's value, and cost per booking is tracked beside it.
    expect(text(dialog())).toContain("$12.45");
    expect(text(dialog())).toContain(
      "Also tracked: cost per booking $103 in October, not paid on.",
    );
    expect(button("Save the pay plan", dialog()).disabled).toBe(true);
    await type(input("What band 3 of Bonus by cost per lead pays"), "250");
    expect(text(dialog())).toContain("Not saved yet.");
    await click(button("Save the pay plan", dialog()));
    const [p] = writes("cockpit_ceo_pay_plan_save");
    expect(p.p.role).toBe("Media buyer");
    expect(p.p.fromMonth).toBe(`${copy.thisMonth()}-01`);
    expect(p.p.plan.parts[0].bands[2]).toEqual({
      upTo: 13,
      inclusive: false,
      amount: 250,
    });
    expect(text(dialog())).toContain("Pay plan saved. It counts from");
  });

  test("the plan's own check names what is wrong and keeps Save off", async () => {
    await show(sheet({ kind: "role", role: "Media buyer" }));
    await type(input("Where band 1 of Bonus by cost per lead ends"), "");
    expect(text(dialog())).toContain(
      'Band 1 of part "cpl_bonus" needs a number upTo; only the last band runs on.',
    );
    expect(button("Save the pay plan", dialog()).disabled).toBe(true);
    await type(input("Where band 1 of Bonus by cost per lead ends"), "11");
    expect(text(dialog())).toContain(
      'The bands of part "cpl_bonus" must rise.',
    );
  });

  test("the server's refusal is shown as said", async () => {
    override = name =>
      name === "cockpit_ceo_pay_plan_save"
        ? {
            data: null,
            error: {
              message:
                "October is approved for Agent One. Plans can change from November.",
            },
          }
        : null;
    await show(sheet({ kind: "role", role: "Media buyer" }));
    await type(input("What band 1 of Bonus by cost per lead pays"), "450");
    await click(button("Save the pay plan", dialog()));
    expect(text(dialog())).toContain(
      "October is approved for Agent One. Plans can change from November.",
    );
  });

  test("a person follows the role plan, or gets their own copy without its commission", async () => {
    await show(
      sheet({
        kind: "person",
        personId: 103,
        name: "Sara Kanaan",
        role: "Media buyer",
      }),
    );
    expect(text(dialog())).toContain("Follows the Media buyer plan · role");
    expect(text(dialog())).toContain("Edit the Media buyer plan");
    const own = Array.from(
      dialog().querySelectorAll('input[type="radio"]') as ArrayLike<any>,
    )[1];
    await click(own);
    expect(text(dialog())).toContain("Name on the receipt");
    await click(button("Save the pay plan", dialog()));
    const [p] = writes("cockpit_ceo_pay_plan_save");
    expect(p.p.personId).toBe(103);
    expect(p.p.role).toBeUndefined();
    expect(p.p.plan.commission).toBeUndefined();
    expect(p.p.plan.parts[0].key).toBe("cpl_bonus");
  });

  test("the call centre plan carries its two client lines, worded apart from our own deals", async () => {
    await show(sheet({ kind: "role", role: "Call centre agent" }));
    expect(text(dialog())).toContain("Commission picked with the role");
    expect(text(dialog())).toContain("No pay plan yet");
  });
});

describe("cost per lead to cost per booking", () => {
  test("the bands are suggested × 4 and nothing changes until the click", async () => {
    let got: any = null;
    await show(
      createElement(MetricSwitchDialog, {
        open: true,
        part: mediaBuyer,
        to: "cpb",
        onCancel: () => {},
        onConfirm: (b: any) => {
          got = b;
        },
      }),
    );
    expect(text(dialog())).toContain("Pay the bonus on cost per booking?");
    expect(text(dialog())).toContain("under $32");
    expect(got).toBeNull();
    await click(button("Switch to cost per booking", dialog()));
    expect(got.map((b: any) => b.upTo)).toEqual([32, 40, 52, 60, null]);
    expect(got.map((b: any) => b.amount)).toEqual([400, 300, 200, 100, 0]);
  });
});

describe("Pay for October (open)", () => {
  const card = () =>
    createElement(PayMonthCard, {
      plans,
      onPlansChanged: () => {},
      onRosterChanged: () => {},
      today: "2026-10",
    });

  test("missing is n/a with a floor, never a smaller total", async () => {
    await show(card());
    const mona = receipt("Mona Haddad");
    expect(text(mona)).toContain("at least $1,525");
    expect(text(mona)).toContain("A floor");
    expect(text(mona)).toContain("Needs your confirmation");
    expect(text(mona)).toContain("Waiting for your count");
    expect(text(mona)).toContain(
      "Confirm October's churn for Mona Haddad's book.",
    );
    // The KWD base is shown in its currency too.
    expect(text(mona)).toContain("KWD 300 at the cockpit's rate");
    // The renewals the general conditions govern carry the sentence.
    expect(text(mona)).toContain(copy.CONDITIONS_SENTENCE);
    expect(text(receipt("Sara Kanaan"))).not.toContain(
      copy.CONDITIONS_SENTENCE,
    );
  });

  test("a paused person's base is held back on the receipt, as on the roster", async () => {
    await show(card());
    const jad = text(receipt("Jad Salem"));
    expect(jad).toContain(
      "Paused 1 Oct to 31 Oct: the $1,100 roster base is held back",
    );
    expect(jad).toContain("at least $1,200");
    expect(jad).not.toContain("at least $2,300");
    expect(
      copy.baseNote({
        usd: 600,
        amount: 600,
        currency: "USD",
        source: "roster",
        paused: {
          days: 13,
          of: 31,
          from: "2026-10-19",
          to: "2026-10-31",
          fullUsd: 1100,
          heldUsd: 500,
        },
      }),
    ).toBe(
      "From the roster, less 13 of 31 days paused (19 Oct to 31 Oct): $500 of $1,100 held back",
    );
    expect(
      copy.baseNote({ usd: 700, amount: 700, currency: "USD", source: "hours_approved" }),
    ).toBe("Approved on Hours and pay");
  });

  test("a rule not met is a real $0 with its reason", async () => {
    await show(card());
    const jad = receipt("Jad Salem");
    expect(text(jad)).toContain("Not paid");
    expect(text(jad)).toContain(
      "3 clients left after the guard; the bonus needs 5.",
    );
    expect(text(jad)).toContain(
      "Left out: Client D (spent $320 in the month, under $500)",
    );
  });

  test("a close waiting for you is confirmed under its own month", async () => {
    await show(card());
    const hala = receipt("Hala Mansour");
    expect(text(hala)).toContain("Waiting for you");
    expect(text(hala)).toContain(
      "1 close on the client sheet only waits for your confirmation.",
    );
    await click(button("Confirm close", hala));
    expect(writes("cockpit_ceo_pay_confirm")).toEqual([
      {
        p: {
          month: "2026-10",
          key: "close:appt-h-c1",
          value: { confirmed: true },
        },
      },
    ]);
    expect(text(host)).toContain("Confirmed the close for Client A.");
  });

  test("the setter the sources disagree on is named, and Nothing else sets the rest to none", async () => {
    await show(card());
    expect(text(receipt("Yousef Darwish"))).toContain(
      "Client H: the closer form says Setter Nine, the last intro before signing says Yousef Darwish.",
    );
    await click(button("Nothing else for October", receipt("Jad Salem")));
    expect(writes("cockpit_ceo_pay_none_rest")).toEqual([
      { p: { personId: 108, month: "2026-10" } },
    ]);
  });

  test("lines that differ from the role plan's are applied in one press", async () => {
    await show(card());
    await click(button("Apply the role's commission", receipt("Tala Odeh")));
    const [save] = writes("cockpit_ceo_people_save");
    expect(save.p_patch).toEqual({
      id: 106,
      commissionBasis: "per_client_appt_shown",
      commissionRate: 5,
      commission2Basis: "per_client_deal_closed",
      commission2Rate: 20,
    });
  });

  test("October cannot be approved before 3 November", async () => {
    await show(card());
    const approve = button("Approve October", host);
    expect(approve.disabled).toBe(true);
    expect(text(host)).toContain(
      "Earned in October, paid with November's payroll.",
    );
    expect(text(host)).toContain("Approve October from 3 November.");
  });
});

describe("Pay for September (approved)", () => {
  const card = async () => {
    await show(
      createElement(PayMonthCard, {
        plans,
        onPlansChanged: () => {},
        onRosterChanged: () => {},
        today: "2026-10",
      }),
    );
    await click(button("September", host));
  };

  test("an approved month shows its figures and the change since, with the adjustment it needs", async () => {
    await card();
    const hala = receipt("Hala Mansour");
    expect(text(hala)).toContain("Approved");
    expect(text(hala)).toContain("Approved 5 Oct by the CEO at $1,045.");
    expect(text(hala)).toContain(
      "Changed since approval: +$20 · Per client appointment shown 27 → 31 (4 added).",
    );
    await click(button("Add to October", hala));
    expect(text(dialog())).toContain(
      "Counts in October, correcting September.",
    );
    await click(button("Add the adjustment", dialog()));
    expect(writes("cockpit_ceo_pay_entry_save")).toEqual([
      {
        p: {
          personId: 101,
          month: "2026-10",
          partKey: "adjustment",
          amountUsd: 20,
          fromMonth: "2026-09",
          note: "Changed since September's approval: Per client appointment shown 27 → 31 (4 added).",
        },
      },
    ]);
  });

  test("a figure that cannot be read since approval says so, and offers no adjustment", async () => {
    const sept = payMonthFixture("full", "2026-09-01");
    const hala = sept.people.find(p => p.name === "Hala Mansour");
    if (!hala?.sinceApproval)
      throw new Error("Hala's September is not approved in the fixture");
    hala.sinceApproval = {
      deltaUsd: null,
      unread: true,
      changes: [
        {
          what: "per_client_appt_shown",
          kind: "line",
          line: 1,
          frozen: { quantity: 27, amountUsd: 135, state: "measured" },
          now: { quantity: null, amountUsd: null, state: "missing" },
          unread: true,
          items: { added: [], removed: [] },
        },
      ],
    };
    override = (name, args) =>
      name === "cockpit_ceo_pay_month" &&
      String(args?.p_month).startsWith("2026-09")
        ? { data: sept, error: null }
        : null;
    await card();
    const r = receipt("Hala Mansour");
    expect(text(r)).toContain(
      "Some figures could not be read since approval, so the change is not known: Per client appointment shown could not be read (approved at $135). Open the month again once they can be read.",
    );
    expect(text(r)).not.toContain("−$135");
    expect(buttons("Add to October", r)).toHaveLength(0);
  });

  test("Approve sends the totals and hashes shown, and says who was refused", async () => {
    await card();
    await click(button("Approve September", host));
    expect(text(dialog())).toContain("Omar Fayed");
    override = name =>
      name === "cockpit_ceo_pay_month_approve"
        ? {
            data: {
              ok: true,
              approved: 0,
              existing: 0,
              refused: [
                {
                  personId: 102,
                  sentence:
                    "The figures changed since you opened the month. Reload and check again.",
                },
              ],
            },
            error: null,
          }
        : null;
    await click(button("Approve September", dialog()));
    expect(writes("cockpit_ceo_pay_month_approve")).toEqual([
      {
        p: {
          month: "2026-09",
          people: [
            {
              personId: 102,
              totalUsd: 1005,
              resultHash: "00000000000000000000000000000066",
            },
          ],
        },
      },
    ]);
    expect(text(host)).toContain(
      "Omar Fayed: The figures changed since you opened the month. Reload and check again.",
    );
  });

  test("Withdraw asks why and sends it", async () => {
    await card();
    await click(button("Withdraw", receipt("Tala Odeh")));
    await click(button("Withdraw", dialog()));
    expect(text(dialog())).toContain("Say why, in a few words.");
    const why = dialog().querySelector("input");
    await type(why, "A close was marked after approval");
    await click(button("Withdraw", dialog()));
    expect(writes("cockpit_ceo_pay_month_withdraw")).toEqual([
      {
        p: {
          personId: 106,
          month: "2026-09",
          reason: "A close was marked after approval",
        },
      },
    ]);
  });
});

describe("Add a count", () => {
  const target = (preset: Record<string, unknown> = {}) => ({
    person: { personId: 105, name: "Mona Haddad" },
    month: "2026-10",
    part: renewals,
    preset,
  });

  test("a renewal needs a client, a cleared day in the month and its evidence", () => {
    expect(entryPayload(target(), { ...blankDraft(), quantity: 1 })).toEqual({
      problem: "Name the client.",
    });
    expect(
      entryPayload(target(), {
        ...blankDraft(),
        client: "Client E",
        clearedOn: "2026-11-03",
      }),
    ).toEqual({
      problem: "It cleared outside October: add it to the month it cleared.",
    });
    expect(
      entryPayload(target(), {
        ...blankDraft(),
        client: "Client E",
        clearedOn: "2026-10-07",
      }),
    ).toEqual({
      problem: "Add the payment id or the signed contract it rests on.",
    });
  });

  test("the entry sent is the count and its conditions; the server's sentence is shown", async () => {
    const preset = {
      quantity: 1,
      client: "Client E",
      clearedOn: "2026-10-07",
      evidenceRef: "whop:pay_fx301",
    };
    await show(
      createElement(PayEntryDialog, {
        target: target(preset),
        onClose: () => {},
        onDone: () => {},
      }),
    );
    expect(text(dialog())).toContain("Renewals for Mona Haddad");
    await click(button("Add the count", dialog()));
    expect(writes("cockpit_ceo_pay_entry_save")).toEqual([
      {
        p: {
          personId: 105,
          month: "2026-10",
          partKey: "renewals",
          quantity: 1,
          client: "Client E",
          clearedOn: "2026-10-07",
          evidenceRef: "whop:pay_fx301",
        },
      },
    ]);
    override = name =>
      name === "cockpit_ceo_pay_entry_save"
        ? {
            data: null,
            error: { message: "Cleared on 3 Nov: add it to November." },
          }
        : null;
    await show(
      createElement(PayEntryDialog, {
        target: { ...target(preset), month: "2026-10" },
        onClose: () => {},
        onDone: () => {},
      }),
    );
    await click(button("Add the count", dialog()));
    expect(text(dialog())).toContain("Cleared on 3 Nov: add it to November.");
  });
});

describe("Confirm a measure", () => {
  const mona = october.people.find(p => p.personId === 105) as any;
  const part = mona.parts.find((p: any) => p.key === "retention");
  const request = () => ({
    ...(copy.confirmFor(part, 105, "2026-10", retention) as any),
    person: { personId: 105, name: "Mona Haddad" },
    planPart: retention,
    proposal: part.input.proposal,
    confirmed: false,
  });

  test("churn is proposed with the list behind it, and the band reads back as typed", async () => {
    await show(
      createElement(PayConfirmDialog, {
        request: request(),
        onClose: () => {},
        onDone: () => {},
      }),
    );
    expect(text(dialog())).toContain("Churn of their clients in October");
    expect(text(dialog())).toContain("Client G");
    expect(text(dialog())).toContain("5.56%");
    expect(text(dialog())).toContain("pays $1,000");
    await click(dialog().querySelector('button[role="checkbox"]'));
    expect(text(dialog())).toContain("pays $2,000");
    await click(dialog().querySelector('button[role="checkbox"]'));
    await click(button("Confirm", dialog()));
    expect(writes("cockpit_ceo_pay_confirm")).toEqual([
      {
        p: {
          month: "2026-10",
          key: "csm_churn:105",
          value: { lost: 1, activeAtStart: 18, clients: ["cu-fx-g"] },
        },
      },
    ]);
  });
});

describe("Team & payroll", () => {
  test("the cards in order, a plan line on every row, and a rule this code cannot read shown as such", async () => {
    await show(
      createElement(
        MemoryRouter,
        null,
        createElement(TeamTab, {
          sections: {} as any,
          now: Date.now(),
          day: null,
          goTab: () => {},
        }),
      ),
    );
    await flush(10);
    const titles = Array.from(
      host.querySelectorAll("section h2") as ArrayLike<any>,
    ).map(h => text(h));
    const at = (t: string) => titles.findIndex(x => x.startsWith(t));
    expect(at("Pay plans")).toBeGreaterThan(at("Hours and pay"));
    expect(at("On the team")).toBeGreaterThan(at("Pay plans"));
    expect(at("Pay for")).toBeGreaterThan(at("On the team"));
    expect(buttons("Edit pay plan for Sara Kanaan", host)).toHaveLength(1);
    expect(buttons("Add a pay plan for Lina Haddad", host)).toHaveLength(1);
    expect(text(host)).toContain(
      "Media buyer plan · role: bonus by cost per lead, up to $400",
    );
    // The database's basis this build does not know: named, no select to overwrite it.
    expect(text(host)).toContain("Unknown rule: per_client_appt_booked");
    const select = (who: string) =>
      body().querySelector(
        `[aria-label="What ${who}'s commission is paid on"]`,
      );
    expect(select("Sara Kanaan")).not.toBeNull();
    expect(select("Dina Samir")).toBeNull();
    await click(buttons("Edit pay plan for Sara Kanaan", host)[0]);
    expect(text(dialog())).toContain("Sara Kanaan's pay plan");
    expect(text(dialog())).toContain("base $1,200 a month, changed on the row");
  });
});

describe("the small rules behind the screens", () => {
  test("months: this one and three back; earned and paid", () => {
    expect(copy.monthChips("2026-10")).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
      "2026-07",
    ]);
    expect(copy.payWhen("2026-12")).toBe(
      "Earned in December, paid with January's payroll.",
    );
  });

  test("the chip a part carries", () => {
    const at = (
      state: any,
      source = "cockpit_pay_entries",
      kind = "per_event",
    ) =>
      copy.partChip({
        kind,
        state,
        input: { value: null, unit: "count", state: "missing", source },
      } as any);
    expect(at("known")).toBeNull();
    expect(at("missing")?.label).toBe("Waiting for your count");
    expect(at("missing", "csm_churn:105", "band")?.label).toBe(
      "Needs your confirmation",
    );
    expect(at("not_met", "x", "band")?.label).toBe("Not paid");
    expect(at("waiting", "x", "band")?.label).toBe("Waiting for you");
  });

  test("which confirmation a part reads, and the month it is stored under", () => {
    const band = (source: string) =>
      ({
        kind: "band",
        label: "x",
        input: { value: null, unit: "pct", state: "missing", source },
      }) as any;
    expect(copy.confirmFor(band("logo_churn"), 108, "2026-10")).toMatchObject({
      key: "logo_churn",
      month: "2026-09",
    });
    expect(
      copy.confirmFor(band("owned_creative:108"), 108, "2026-10"),
    ).toMatchObject({ kind: "owned", key: "owned_creative:108" });
    expect(
      copy.confirmFor(
        {
          kind: "floor",
          label: "Ramp",
          input: {
            value: 978,
            unit: "usd",
            state: "confirmed",
            source: "ramp_start:105",
            start: "2026-08-20",
          },
        } as any,
        105,
        "2026-10",
      ),
    ).toMatchObject({ kind: "ramp", key: "ramp_start:105", month: "2026-08" });
  });

  test("who Approve sends: the ready, never the approved or the open", () => {
    const sept = payMonthFixture("full", "2026-09-01");
    expect(copy.approvable(sept).map(p => p.name)).toEqual(["Omar Fayed"]);
    expect(copy.approvable(october)).toEqual([]);
  });

  test("a role's plan applies to someone added, and its commission is pre-filled", () => {
    expect(copy.addSomeoneLine(plans, "Media buyer", "2026-10")).toBe(
      "Media buyer plan applies: base you type + bonus by cost per lead, up to $400.",
    );
    expect(copy.rolePrefill(plans, "Call centre agent", "2026-10")).toEqual([
      { basis: "per_client_appt_shown", rate: 5 },
      { basis: "per_client_deal_closed", rate: 20 },
    ]);
    expect(copy.rolePrefill(plans, "Media buyer", "2026-10")).toBeNull();
    expect(copy.addSomeoneLine(plans, "Video editor", "2026-10")).toBe(
      "No pay plan for Video editor yet: pay is the base you type.",
    );
    expect(
      copy.personPlanLine(
        plans,
        { id: 107, role: "Systems manager" },
        "2026-10",
      ).words,
    ).toStartWith("Own plan: fully built-out systems, $200 each");
  });

  test("a new part gets a key of its own", () => {
    const t = copy.PART_TEMPLATES.find(x => x.id === "per_event:renewal");
    const made = t?.make() as any;
    expect(copy.uniqueKey(made, [])).toBe("renewals");
    expect(copy.uniqueKey(made, ["renewals"])).toBe("renewals_2");
  });

  test("every commission basis sits in one group of the select", () => {
    const grouped = COMMISSION_GROUPS.flatMap(g => g.bases);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(
      COMMISSION_BASES.filter(b => b !== "none" && b !== "other").sort(),
    );
  });

  test("churn as a draft rounds the way the server will", () => {
    expect(churnPct(1, 18)).toBe("5.555556");
    expect(churnPct(1, 0)).toBeNull();
    expect(churnCards(october.people[4]?.parts[1]?.input?.proposal)).toEqual([
      {
        clickupId: "cu-fx-g",
        name: "Client G",
        why: "marked lost on 14 Oct · day 52 of the term",
        candidate: false,
      },
    ]);
  });
});

describe("review fixes of 2026-10-18", () => {
  const card = () =>
    createElement(PayMonthCard, {
      plans,
      onPlansChanged: () => {},
      onRosterChanged: () => {},
      today: "2026-10",
    });
  const strategistCpl = ROLE_PLANS_2026_10["Creative strategist"].parts.find(
    p => p.key === "cpl_bonus",
  ) as any;
  const googleReviews = ROLE_PLANS_2026_10["Client success manager"].parts.find(
    p => p.key === "google_reviews",
  ) as any;
  const smm = ROLE_PLANS_2026_10["Creative strategist"].parts.find(
    p => p.key === "smm",
  ) as any;
  const upsells = ROLE_PLANS_2026_10["Client success manager"].parts.find(
    p => p.key === "upsells",
  ) as any;

  test("the month's headline: complete months for how many, and at least for everyone, in words", async () => {
    expect(copy.monthHeadline(october)).toEqual({
      items: [
        { label: "Complete for 4 of 9", value: "$5,175" },
        { label: "At least, for everyone", value: "$12,745" },
      ],
      sentence:
        "4 people have a complete month, $5,175. The other 5 still have something open; with every open part at its worst, everyone comes to at least $12,745.",
    });
    // Everyone known in a month still running is "So far", never "Total".
    expect(
      copy.monthHeadline(payMonthFixture("empty", "2026-10-01")).items,
    ).toEqual([{ label: "So far", value: "$1,475" }]);
    expect(
      copy.monthHeadline(payMonthFixture("full", "2026-09-01")).items,
    ).toEqual([{ label: "Total", value: "$5,570" }]);
    await show(card());
    expect(text(host)).toContain("Complete for 4 of 9 $5,175");
    expect(text(host)).toContain("At least, for everyone $12,745");
    expect(text(host)).toContain("4 people have a complete month, $5,175.");
    expect(text(host)).not.toContain("Known so far");
  });

  test("pay figures keep their cents: the line, the floor and Approve", async () => {
    expect(copy.payUsd(512.5)).toBe("$512.50");
    expect(copy.payUsd(3337.5)).toBe("$3,337.50");
    expect(copy.payUsd(1500)).toBe("$1,500");
    expect(copy.payUsd(1074.9999999)).toBe("$1,075");
    expect(copy.payUsd(null)).toBe("n/a");
    const oct = payMonthFixture("full", "2026-10-01");
    const y = oct.people.find(p => p.personId === 104) as any;
    y.commission[1] = { ...y.commission[1], baseUsd: 10250, amountUsd: 512.5 };
    y.lowestUsd = 3337.5;
    override = (name, args) =>
      name === "cockpit_ceo_pay_month" &&
      String(args?.p_month).startsWith("2026-10")
        ? { data: oct, error: null }
        : null;
    await show(card());
    const r = text(receipt("Yousef Darwish"));
    expect(r).toContain("5% of $10,250");
    expect(r).toContain("$512.50");
    expect(r).toContain("at least $3,337.50");
    expect(r).not.toContain("$3,338");
  });

  test("Approve names who is left out and why; a month nothing is worked out for says so", async () => {
    await show(card());
    await click(button("September", host));
    expect(text(receipt("Lina Haddad"))).toContain("Not approved here");
    expect(text(receipt("Lina Haddad"))).toContain(
      "None of their commission lines is worked out here, so this month is not approved here; their base is paid through Hours and pay.",
    );
    expect(text(receipt("Lina Haddad"))).not.toContain("this pay plan");
    await click(button("Approve September", host));
    expect(text(dialog())).toContain("Not in this approval");
    expect(text(dialog())).toContain(
      "Lina Haddad: their commission lines are not worked out here; their base is paid through Hours and pay.",
    );
    expect(text(dialog())).toContain("$1,005");
  });

  test("Where these numbers come from: every source's notes, names that match nobody, money tied to no deal", async () => {
    await show(card());
    const t = text(host);
    expect(t).toContain(
      "A client left out of a pool is named with why, never counted as 0.",
    );
    expect(t).toContain(
      "Script task names that match nobody on the team list are left out of owned creative.",
    );
    expect(t).toContain(
      "The money refresh last ran 18 Oct 06:40 Kuwait time: payments since then are not counted yet.",
    );
    expect(t).toContain(
      "Names that match nobody on the team list: Setter Nine (setter on Client H).",
    );
    expect(t).toContain(
      "Not tied to a deal, never counted: 1 payment, $1,500 (Payer Nine $1,500 16 Oct). Attribute them on the Transactions tab.",
    );
  });

  test("a share of money waits for cash, said once", async () => {
    expect(
      copy.partChip({
        kind: "share",
        state: "missing",
        input: {
          value: null,
          unit: "cash",
          state: "missing",
          source: "cockpit_pay_entries",
        },
      } as any)?.label,
    ).toBe("Waiting for the month's cash");
    await show(card());
    const jad = text(receipt("Jad Salem"));
    expect(jad).toContain("Waiting for the month's cash");
    expect(jad).toContain("Add cash");
    expect(jad).not.toContain("Waiting for your count");
    expect(jad).not.toContain("Missing · Waiting");
  });

  test("Change on a confirmed measure starts from the confirmation, never the data's proposal", async () => {
    // The stored churn's numbers and ticks, a card the data no longer lists added and named.
    const start = confirmStart({
      kind: "churn",
      proposal: {
        lost: [{ clickupId: "cu-fx-g", name: "Client G" }],
        candidates: [{ clickupId: "cu-fx-h", name: "Client H" }],
        proposal: { lost: 1, activeAtStart: 18 },
      },
      current: { lost: 2, activeAtStart: 20, clients: ["cu-fx-h", "cu-fx-z"] },
      names: { "cu-fx-z": "Client Z" },
    });
    expect(start).toMatchObject({
      from: "confirmed",
      lost: 2,
      active: 20,
      ticked: ["cu-fx-h", "cu-fx-z"],
    });
    expect(start.cards.map(c => c.name)).toEqual([
      "Client G",
      "Client H",
      "Client Z",
    ]);
    // Owned creative with no confirmation yet: last month's list carried forward.
    expect(
      confirmStart({
        kind: "owned",
        proposal: {
          clients: [{ clickupId: "cu-fx-a", name: "Client A" }],
          others: [{ clickupId: "cu-fx-b", name: "Client B" }],
          carried: ["cu-fx-b"],
        },
      }),
    ).toMatchObject({ from: "carried", ticked: ["cu-fx-b"] });
    // On the card: Jad's confirmed churn opens on 1 of 22, with Remove.
    await show(card());
    await click(buttons("Change", receipt("Jad Salem"))[0]);
    expect(text(dialog())).toContain("The company's churn in September");
    expect(input("Clients lost").value).toBe("1");
    expect(input("Clients at the start of the month").value).toBe("22");
    expect(text(dialog())).toContain("Remove the confirmation");
  });

  test("owned creative's Change ticks the clients confirmed and offers the data's list", async () => {
    await show(card());
    await click(buttons("Change", receipt("Jad Salem"))[1]);
    expect(text(dialog())).toContain("Ticked as you confirmed them.");
    expect(buttons("As the data proposes", dialog())).toHaveLength(1);
    expect(text(dialog())).toContain("Remove the confirmation");
    const ticked = Array.from(
      dialog().querySelectorAll('button[role="checkbox"]') as ArrayLike<any>,
    ).filter(b => b.getAttribute("aria-checked") === "true");
    expect(ticked).toHaveLength(5);
  });

  test("the entry dialog asks what the server asks: a client for a share that ends, nothing more at $0", () => {
    const at = (part: any, d: Record<string, unknown>) =>
      entryPayload(
        { person: { personId: 108, name: "Jad Salem" }, month: "2026-10", part },
        { ...blankDraft(), ...d } as any,
      );
    expect(copy.entryShape(smm)).toMatchObject({ client: true, conditions: false });
    expect(at(smm, { cashUsd: 1000, engagementMonth: 2 })).toEqual({
      problem: "Name the client.",
    });
    expect(
      at(smm, { cashUsd: 1000, engagementMonth: 2, client: "Client A" }),
    ).toEqual({
      payload: {
        personId: 108,
        month: "2026-10",
        partKey: "smm",
        cashUsd: 1000,
        engagementMonth: 2,
        client: "Client A",
      },
    });
    // A $0 upsell needs no client, cleared day or evidence (the server's rule).
    expect(at(upsells, { cashUsd: 0 })).toEqual({
      payload: { personId: 108, month: "2026-10", partKey: "upsells", cashUsd: 0 },
    });
    expect(at(upsells, { cashUsd: 500 })).toEqual({ problem: "Name the client." });
    // A review taken down needs its note, not a link.
    expect(
      at(googleReviews, { quantity: -1, note: "Taken down within 30 days" }),
    ).toEqual({
      payload: {
        personId: 108,
        month: "2026-10",
        partKey: "google_reviews",
        quantity: -1,
        note: "Taken down within 30 days",
      },
    });
  });

  test("switching to cost per booking renames the receipt's name, keeps clients and guard, and says so", async () => {
    const bands = suggestBands(mediaBuyer.bands, "cpl", "cpb") as any;
    expect(switchedPart(mediaBuyer, "cpb", bands)).toMatchObject({
      key: "cpl_bonus",
      metric: "cpb",
      label: "Bonus by cost per booking",
    });
    const strat = switchedPart(
      strategistCpl,
      "cpb",
      suggestBands(strategistCpl.bands, "cpl", "cpb") as any,
    );
    expect(strat).toMatchObject({
      label: "Bonus by cost per booking",
      covers: "owned_creative",
      guard: { minClients: 5, minSpendUsd: 500, excludeDays: 14 },
    });
    expect(partSentence(strat)).toStartWith("Bonus by cost per booking: under");
    expect(copy.renameForMetric("CPL bonus", "cpl", "cpb")).toBe("CPL bonus");
    expect(copy.labelNamesOther({ ...strat, label: "CPL bonus" })).toBe("cpl");
    expect(copy.labelNamesOther(strat)).toBeNull();
    await show(
      createElement(MetricSwitchDialog, {
        open: true,
        part: mediaBuyer,
        to: "cpb",
        onCancel: () => {},
        onConfirm: () => {},
      }),
    );
    expect(text(dialog())).toContain(
      'Its name on the receipt becomes "Bonus by cost per booking".',
    );
  });

  test("after a switch the ruler's tick is the month's cost per booking, never its cost per lead", () => {
    const role = { kind: "role", role: "Media buyer" } as any;
    expect(marksFor(october, plans, role, 1, mediaBuyer)).toEqual([
      { value: 12.45, label: "Oct" },
    ]);
    const cpb = switchedPart(
      mediaBuyer,
      "cpb",
      suggestBands(mediaBuyer.bands, "cpl", "cpb") as any,
    );
    expect(marksFor(october, plans, role, 1, cpb)).toEqual([
      { value: 103, label: "Oct" },
    ]);
    expect(rulerSentence(cpb, marksFor(october, plans, role, 1, cpb))).toEndWith(
      "Oct: $103, in the nothing band.",
    );
    // Paid on churn: no ad figure is placed on a percent scale.
    expect(
      marksFor(october, plans, role, 1, {
        ...mediaBuyer,
        metric: "csm_churn",
      }),
    ).toEqual([]);
    expect(copy.alsoSentence(alsoFor(october, plans, role, 1, cpb) as any)).toBe(
      "Also tracked: cost per lead $12.45 in October, not paid on.",
    );
  });

  test("the strategist's cost per booking is over her own clients and guard, or said as every client's", () => {
    const jad = { kind: "person", personId: 108, name: "Jad Salem", role: "Creative strategist" } as any;
    expect(copy.alsoSentence(alsoFor(october, plans, jad, null, strategistCpl) as any)).toBe(
      "Also tracked: cost per booking over the same clients and guard in October: not worked out (3 clients left after the guard; the bonus needs 5). Not paid on.",
    );
    // A month that did not work it out for her: the pooled figure, said as every client's.
    const bare = payMonthFixture("full", "2026-10-01");
    const jp = bare.people.find(p => p.personId === 108) as any;
    jp.parts[1].input.alsoTracked = undefined;
    expect(copy.alsoSentence(alsoFor(bare, plans, jad, null, strategistCpl) as any)).toBe(
      "Also tracked: cost per booking $103 in October over every client, not only the clients this part counts; not paid on.",
    );
  });

  test("plan lines keep Google's capital", () => {
    expect(partSummary(googleReviews)).toBe("Google reviews, $75 each");
    expect(partSentence(googleReviews)).toBe(
      "Google reviews: $75 for each Google review, typed by you each month.",
    );
    expect(copy.addSomeoneLine(plans, "Client success manager", "2026-10")).toContain(
      "Google reviews, $75 each",
    );
  });

  test("Add someone says the plan right under the role, before the pay and Add", () => {
    const src = readFileSync(
      new URL("../src/pages/ceo/TeamTab.tsx", import.meta.url),
      "utf8",
    );
    const form = src.slice(src.indexOf("<UserPlus aria-hidden /> Add someone"));
    const plan = form.indexOf("addSomeoneLine(plans, role, thisMonth())");
    expect(plan).toBeGreaterThan(form.indexOf("<RoleField"));
    expect(plan).toBeLessThan(form.indexOf('placeholder="Pay a month"'));
    expect(plan).toBeLessThan(form.indexOf("disabled={busy || !name.trim()}"));
  });
});

describe("the fixtures stay made up", () => {
  test("no company address in this file", () => {
    const self = readFileSync(new URL(import.meta.url), "utf8");
    expect(self).not.toContain(["@maharamedia", "com"].join("."));
    expect(self).not.toContain(["tmp", "harness"].join("/"));
  });
});

function blankDraft() {
  return {
    quantity: 1,
    cashUsd: Number.NaN,
    amountUsd: Number.NaN,
    engagementMonth: 1,
    client: "",
    product: "",
    clearedOn: "",
    postedOn: "",
    cancelledOn: "",
    evidenceRef: "",
    evidence: "",
    note: "",
    fromMonth: "",
  };
}
