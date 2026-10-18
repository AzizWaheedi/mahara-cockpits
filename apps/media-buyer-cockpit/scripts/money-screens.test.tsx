/**
 * The money attribution screens (docs/money/MONEY-ATTRIBUTION.md section 2,
 * the CEO, 2026-10-18): every money-in row on the Transactions tab says who
 * it is credited to and why; the Attribute sheet ties a payment, or every
 * payment from its payer, to a signed deal, a client card or "not client
 * money", with a note, shows what the tie credits first, removes a tie, and
 * says when it shows without starting a refresh; the Money tab's payer list
 * offers "A signed deal"; the Sales and Frontend tiles read paid front-end
 * cash with the typed amounts beside it, the attributed-at time and a By
 * closer line. The pure parts run as they are; the sheet and the tab render
 * in happy-dom over the cockpit's own client, its Auth and reads answered
 * here. Every person, client, email, amount and id is made up.
 */
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks (but one that puts a leaked one back), and
// every global and the env are put back.
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
  throw new Error("The money screens test makes no network calls.");
}) as typeof fetch;

// --- The cockpit's own client: the CEO signed in, the reads answered here. ---
// An earlier file in the same bun process (ceo-goals-supabase.test.ts) may
// leave "../src/lib/supabase" mocked with a database client that has no Auth.
// Put the module's own exports back so the screens use the cockpit's client.
if (!((await import("../src/lib/supabase")).supabase as any)?.auth) {
  const { getCockpitSupabaseClient } = await import(
    "../src/auth/SupabaseAuthProvider"
  );
  mock.module("../src/lib/supabase", () => ({
    supabase: getCockpitSupabaseClient(),
    STILLS_BUCKET: "editor-stills",
    IDEA_STILLS_BUCKET: "ideation-stills",
    AD_VIDEOS_BUCKET: "ad-videos",
  }));
}
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const real = {
  rpc: db.rpc,
  from: db.from,
  getSession: db.auth.getSession,
  getUser: db.auth.getUser,
  onAuthStateChange: db.auth.onAuthStateChange,
};
const USER = {
  id: "auth-ceo-test",
  email: "ceo@example.test",
  email_confirmed_at: "2026-10-18T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token", user: USER } },
  error: null,
});
db.auth.getUser = async () => ({ data: { user: USER }, error: null });
db.auth.onAuthStateChange = () => ({
  data: { subscription: { unsubscribe: () => {} } },
});

type Answer = { data: unknown; error: { message: string } | null };
const rpcCalls: { name: string; args: any }[] = [];
let tieAnswer: (p: any) => Answer = () => ({
  data: { ok: true, id: 501 },
  error: null,
});
db.rpc = async (name: string, args: any = {}) => {
  rpcCalls.push({ name, args });
  if (name === "cockpit_adopt_member") return { data: true, error: null };
  if (name === "cockpit_get_my_access")
    return {
      data: {
        email: USER.email,
        name: "The CEO",
        is_admin: true,
        is_ceo: true,
        home: "/ceo",
        cockpits: [],
        roles: [],
        clients: [],
      },
      error: null,
    };
  if (name === "cockpit_ceo_manual_payment_clients")
    return {
      data: [
        { name: "Client A Co", clickupTaskId: "task-a1", bucket: null },
        { name: "Client B Ltd", clickupTaskId: "task-b1", bucket: null },
      ],
      error: null,
    };
  if (name === "cockpit_ceo_payment_tie") return tieAnswer(args.p);
  if (name === "cockpit_ceo_payment_untie")
    return { data: { ok: true, id: args.p.id }, error: null };
  return { data: null, error: { message: `No answer for ${name}` } };
};

/** cockpit_sales_deals as the CEO's session reads it (made-up rows). */
const DEAL_ROWS = [
  {
    response_id: "resp-a",
    submitted_at: "2026-10-10T09:00:00Z",
    closer: "Closer One",
    business_name: "Client A Co",
    client_name: "Contact Alpha",
    email: "payer.alpha@example.test",
    cash_collected: 500,
    contracted_revenue: 6000,
    payment_structure: "Pay in full",
    voided: false,
  },
  {
    response_id: "resp-b",
    submitted_at: "2026-10-12T09:00:00Z",
    closer: "Closer Two",
    business_name: "Client B Ltd",
    client_name: "Contact Bravo",
    email: "bravo@example.test",
    cash_collected: 1000,
    contracted_revenue: 4000,
    payment_structure: "Monthly",
    voided: false,
  },
  {
    response_id: "resp-void",
    submitted_at: "2026-10-01T09:00:00Z",
    closer: "Closer One",
    business_name: "Voided Co",
    client_name: "Contact Void",
    email: null,
    cash_collected: 0,
    contracted_revenue: 3000,
    payment_structure: null,
    voided: true,
  },
];
const fromCalls: { table: string; steps: [string, unknown[]][] }[] = [];
db.from = (table: string) => {
  const steps: [string, unknown[]][] = [];
  fromCalls.push({ table, steps });
  const q: any = {};
  for (const m of ["select", "gte", "order", "limit", "eq", "in"])
    q[m] = (...a: unknown[]) => {
      steps.push([m, a]);
      return q;
    };
  // biome-ignore lint/suspicious/noThenProperty: a thenable like supabase-js's builder
  q.then = (resolve: (a: Answer) => unknown) =>
    resolve(
      table === "cockpit_sales_deals"
        ? { data: DEAL_ROWS, error: null }
        : { data: null, error: { message: `No answer for ${table}` } },
    );
  return q;
};
// supabase-js builds a new functions client on every read: keep one to patch.
const functionsDescriptor = Object.getOwnPropertyDescriptor(db, "functions");
const functions = db.functions;
Object.defineProperty(db, "functions", {
  configurable: true,
  value: functions,
});
const invokes: string[] = [];
const realInvoke = functions.invoke;
functions.invoke = async (name: string) => {
  invokes.push(name);
  return { data: null, error: { message: "No Edge call in this test" } };
};

// --- A DOM. ------------------------------------------------------------------
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=transactions" });
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
  // Radix reads these by name (a dialog, a radio) while it renders.
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
// The tab's chips and selects animate with motion, whose Web Animations
// path happy-dom cancels with an unhandled AbortError between tests: without
// Element.animate motion animates in JS instead. This window only.
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
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("not wrapped in act") ||
      args[0].includes("DialogContent") ||
      args[0].includes("A cockpit read failed"))
  )
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router");
const { SupabaseAuthProvider } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const credit = await import("../src/pages/ceo/money/credit");
const { signedDeal } = await import("../src/pages/ceo/money/dealsRead");
const { AttributeBody } = await import("../src/pages/ceo/money/AttributeSheet");
const { Sheet } = await import("../src/components/ui/sheet");
// Radix picks its layout effect when first loaded: loaded by an earlier test
// file before any DOM existed, it is a no-op and a portal (the sheet) never
// mounts. The sheet's body is rendered in place below, so only the check that
// a press opens the portal waits on it.
const React = await import("react");
const { useLayoutEffect: radixLayoutEffect } = await import(
  "@radix-ui/react-use-layout-effect"
);
const portalsMount = radixLayoutEffect === React.useLayoutEffect;
const { frontEndTile, frontEndFacts } = await import(
  "../src/pages/ceo/money/FrontEndCash"
);
const { TransactionsTab } = await import("../src/pages/ceo/TransactionsTab");
const tf = await import("../src/components/ceo/timeframe");
const { ROAS_CASH } = await import("../src/components/ceo/metrics");
const { tiedSentence } = await import("../src/lib/ceoMoneyClient");

type MoneyLine = import("../src/pages/ceo/money/credit").MoneyLine;
type FunnelWindow = import("../src/types/ceo/payloads").FunnelWindow;

const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const text = (el: any) => String(el?.textContent ?? "");
const page = () => text(win.document.body);
const sheet = () =>
  (win.document.querySelector('[role="dialog"]') ??
    (text(container).includes("Attribute") ? container : null)) as any;
const buttonIn = (scope: any, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (b: any) => text(b).trim() === label,
  ) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush(3);
}
async function type(el: any, value: string) {
  expect(el).toBeTruthy();
  const proto =
    el.tagName === "TEXTAREA"
      ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush(2);
}

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  rpcCalls.length = 0;
  fromCalls.length = 0;
  invokes.length = 0;
  tieAnswer = () => ({ data: { ok: true, id: 501 }, error: null });
});

afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = real.rpc;
  db.from = real.from;
  db.auth.getSession = real.getSession;
  db.auth.getUser = real.getUser;
  db.auth.onAuthStateChange = real.onAuthStateChange;
  functions.invoke = realInvoke;
  if (functionsDescriptor)
    Object.defineProperty(db, "functions", functionsDescriptor);
  else delete db.functions;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  if (animateBefore)
    Object.defineProperty(win.Element.prototype, "animate", animateBefore);
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
});

// --- Made-up payments --------------------------------------------------------

function line(over: Partial<MoneyLine> & { id: string }): MoneyLine {
  return {
    day: "2026-10-15",
    rail: "whop",
    direction: "in",
    usd: 500,
    currency: "USD",
    amount: 500,
    payerEmail: null,
    payerName: null,
    side: "unattributed",
    kind: "none",
    person: null,
    personRole: null,
    dealResponseId: null,
    dealBusiness: null,
    clientName: null,
    clientTaskId: null,
    matchedBy: "none",
    tie: null,
    detail: null,
    ...over,
  };
}

const PAID_DEPOSIT = line({
  id: "whop:pay_test_a1",
  day: "2026-10-10",
  usd: 500,
  amount: 500,
  payerEmail: "payer.alpha@example.test",
  payerName: "Payer Alpha",
  side: "front_end",
  kind: "deposit",
  person: "Closer One",
  personRole: "closer",
  dealResponseId: "resp-a",
  dealBusiness: "Client A Co",
  clientName: "Client A Co",
  matchedBy: "deal_id",
});
const UNMATCHED = line({
  id: "whop:pay_test_u1",
  day: "2026-10-12",
  usd: 1500,
  amount: 1500,
  payerEmail: "Payer.Alpha@Example.test",
  payerName: "Payer Alpha",
});
const BACK_END = line({
  id: "tap:chg_test_b1",
  rail: "tap",
  day: "2026-10-14",
  usd: 800,
  amount: 800,
  side: "back_end",
  kind: "client",
  person: "Csm One",
  personRole: "csm",
  clientName: "Client B Ltd",
  clientTaskId: "task-b1",
  matchedBy: "card_name",
});
const NOT_CLIENT = line({
  id: "manual:test_n1",
  rail: "manual",
  usd: 250,
  amount: 250,
  payerName: "Partner Person Test",
  side: "not_client",
  kind: "none",
  matchedBy: "ceo",
  tie: {
    id: 41,
    scope: "payment",
    note: "Partner returned money",
    setBy: "ceo@example.test",
    setAt: "2026-10-16T08:00:00Z",
  },
});
const STATEMENT = line({
  id: "bankline:9001",
  rail: "bank",
  usd: 7000,
  amount: 7000,
  payerName: "WHOP PAYOUT",
  bankKind: "whop_payout",
  bankLineId: 9001,
});
const REFUND = line({
  id: "whop-refund:pay_test_r1",
  direction: "out",
  side: "out",
  kind: "refund",
  usd: 100,
  amount: 100,
});
const LINES = [
  PAID_DEPOSIT,
  UNMATCHED,
  BACK_END,
  NOT_CLIENT,
  STATEMENT,
  REFUND,
];

// ---------------------------------------------------------------------------

describe("every money-in row says who it is credited to and why", () => {
  test("the credit line, in words (rule 5)", () => {
    expect(credit.creditLine(PAID_DEPOSIT)).toBe(
      "Credited to Closer One (closer) · Whop's link to the deal",
    );
    expect(
      credit.creditLine({
        ...PAID_DEPOSIT,
        matchedBy: "ceo",
        tie: NOT_CLIENT.tie,
      }),
    ).toBe("Credited to Closer One (closer) · your tie");
    expect(credit.creditLine(BACK_END)).toBe(
      "Credited to Csm One (CSM) · card name",
    );
    expect(credit.creditLine(NOT_CLIENT)).toBe("Not client money · your tie");
    expect(credit.creditLine(UNMATCHED)).toBe("Not credited · nothing matched");
    expect(
      credit.creditLine({ ...PAID_DEPOSIT, person: null, personRole: null }),
    ).toBe(
      "Credited to nobody: the closer form names no closer · Whop's link to the deal",
    );
    // Money out and statement lines that are not client money credit nobody.
    expect(credit.creditLine(REFUND)).toBeNull();
    expect(credit.creditLine(STATEMENT)).toBeNull();
    expect(credit.MATCH_LABEL.ceo).toBe("your tie");
  });

  test("the side and what it rests on", () => {
    expect(credit.sideWords(PAID_DEPOSIT)).toBe("Front end · deposit");
    expect(credit.sideWords({ ...PAID_DEPOSIT, kind: "remainder" })).toBe(
      "Front end · rest of the deal",
    );
    // A payload from before 2026-10-18 calls the rest "kickoff".
    expect(credit.sideWords({ ...PAID_DEPOSIT, kind: "kickoff" })).toBe(
      "Front end · rest of the deal",
    );
    expect(credit.sideWords(BACK_END)).toBe("Back end · client payment");
    expect(credit.sideWords(NOT_CLIENT)).toBe("Not client money");
    expect(credit.sideWords(REFUND)).toBe("Out · refund");
    expect(credit.restsOn(PAID_DEPOSIT)).toBe("Client A Co");
    expect(credit.restsOn(UNMATCHED)).toBeNull();
    // One payment that is the deposit and the rest of the deal says both parts.
    const pif = { ...PAID_DEPOSIT, usd: 5608.8, depositUsd: 500 };
    expect(credit.sideWords(pif)).toBe(
      "Front end · $500 deposit, $5,109 rest of the deal",
    );
    expect(credit.sideWords({ ...PAID_DEPOSIT, depositUsd: 500 })).toBe(
      "Front end · deposit",
    );
  });

  test("only payments the ledger keeps can be tied", () => {
    for (const t of [PAID_DEPOSIT, UNMATCHED, BACK_END, NOT_CLIENT])
      expect(credit.canAttribute(t)).toBe(true);
    for (const t of [STATEMENT, REFUND])
      expect(credit.canAttribute(t)).toBe(false);
    expect(credit.canAttribute(line({ id: "bank:77" }))).toBe(true);
    expect(credit.canAttribute(line({ id: "transfer:x.y-1" }))).toBe(true);
    expect(credit.canAttribute(line({ id: "external-expense:1" }))).toBe(false);
  });

  test("the totals count client money as the refresh does", () => {
    const t = credit.moneyTotals(LINES);
    // The payout statement line is listed, never money in.
    expect(t.in).toBe(500 + 1500 + 800 + 250);
    expect(t.count).toBe(4);
    expect(t.frontEnd).toBe(500);
    expect(t.deposit).toBe(500);
    expect(t.remainder).toBe(0);
    expect(t.backEnd).toBe(800);
    expect(t.unattributed).toBe(1500);
    expect(t.unattributedCount).toBe(1);
    expect(t.notClient).toBe(250);
    expect(t.notClientCount).toBe(1);
    expect(t.out).toBe(100);
    const rest = credit.moneyTotals([
      { ...PAID_DEPOSIT, kind: "remainder" },
      { ...PAID_DEPOSIT, id: "whop:pay_old", kind: "kickoff" },
    ]);
    expect(rest.remainder).toBe(1000);
    expect(rest.kickoff).toBe(1000);
    // The deposit is the part up to the typed deposit, as the refresh splits it.
    const split = credit.moneyTotals([
      { ...PAID_DEPOSIT, usd: 5608.8, depositUsd: 500 },
      { ...PAID_DEPOSIT, id: "whop:pay_rest", kind: "remainder", depositUsd: 0 },
    ]);
    expect([split.frontEnd, split.deposit, split.remainder]).toEqual([
      6108.8, 500, 5608.8,
    ]);
  });

  test("the rule's day limits are the server's", () => {
    const edge = readFileSync(
      new URL(
        "../../../supabase/functions/cockpit-ceo-api/finance/attribution.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const native = readFileSync(
      new URL(
        "../../../hermes/ceo-refresh/native/adapters/money.js",
        import.meta.url,
      ),
      "utf8",
    );
    for (const src of [edge, native]) {
      expect(src).toMatch(
        new RegExp(`BEFORE_FORM_DAYS = ${credit.BEFORE_FORM_DAYS};`),
      );
      expect(src).toMatch(
        new RegExp(`DEAL_TERM_DAYS = ${credit.DEAL_TERM_DAYS};`),
      );
    }
  });
});

describe("payers, deals and suggestions", () => {
  test("a payer tie keys on the email or the full name, never a first name", () => {
    expect(credit.payerScope(" Payer.Alpha@Example.test ", "Payer")).toEqual({
      payerEmail: "payer.alpha@example.test",
      label: "payer.alpha@example.test",
    });
    expect(credit.payerScope(null, "Payer Alpha")).toEqual({
      payerKey: "Payer Alpha",
      label: "Payer Alpha",
    });
    const refused = credit.payerScope(null, "Dena");
    expect("refused" in refused && refused.refused).toMatch(
      /Tie by email or the full payer name\.$/,
    );
    expect("refused" in credit.payerScope(null, null)).toBe(true);
    expect(credit.fullPayerName("Al Bo")).toBe(false);
  });

  test("the payments a payer tie covers, by email or by the rule's name key", () => {
    const byEmail = credit.linesForPayer(
      LINES,
      credit.payerScope("payer.alpha@example.test", null),
    );
    expect(byEmail.map(t => t.id)).toEqual([PAID_DEPOSIT.id, UNMATCHED.id]);
    const byName = credit.linesForPayer(
      [...LINES, line({ id: "tap:chg_test_n2", payerName: "PAYER álpha" })],
      credit.payerScope(null, "Payer Alpha"),
    );
    expect(byName.map(t => t.id)).toEqual([
      PAID_DEPOSIT.id,
      UNMATCHED.id,
      "tap:chg_test_n2",
    ]);
    expect(credit.nameKey("Payer Álpha")).toBe("payeralpha");
  });

  test("the deal list: not voided, newest first, with what is tied so far", () => {
    const deals = DEAL_ROWS.map(r => signedDeal(r)).filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    expect(deals[0]).toEqual({
      responseId: "resp-a",
      business: "Client A Co",
      contact: "Contact Alpha",
      email: "payer.alpha@example.test",
      closer: "Closer One",
      signedDay: "2026-10-10",
      contracted: 6000,
      deposit: 500,
      plan: "Pay in full",
      voided: false,
    });
    const options = credit.dealOptions(deals, [
      ...LINES,
      line({
        id: "whop:pay_test_x",
        dealResponseId: "resp-x",
        dealBusiness: "Older Deal Co",
        person: "Closer Two",
        personRole: "closer",
        side: "front_end",
        kind: "deposit",
        usd: 300,
      }),
    ]);
    expect(options.map(d => d.responseId)).toEqual([
      "resp-b",
      "resp-a",
      "resp-x",
    ]);
    expect(options.find(d => d.responseId === "resp-a")?.collected).toBe(500);
    // A deal the form read did not return is still listed from its payments.
    expect(options.find(d => d.responseId === "resp-x")).toMatchObject({
      business: "Older Deal Co",
      closer: "Closer Two",
      collected: 300,
      fromPaymentsOnly: true,
    });
    // A failed read lists only the deals with money.
    expect(credit.dealOptions(null, LINES).map(d => d.responseId)).toEqual([
      "resp-a",
    ]);
  });

  test("suggestions are said, never chosen", () => {
    const deals = credit.dealOptions(
      DEAL_ROWS.map(r => signedDeal(r)).filter(
        (d): d is NonNullable<typeof d> => d !== null,
      ),
      [],
    );
    const a = deals.find(d => d.responseId === "resp-a")!;
    const b = deals.find(d => d.responseId === "resp-b")!;
    expect(credit.suggestion(a, { email: "PAYER.ALPHA@example.test" })).toBe(
      "the payer's email is on the form",
    );
    expect(credit.suggestion(b, { name: "Contact Bravo Senior" })).toBe(
      "the payer's name is the contact's on the form",
    );
    expect(credit.suggestion(b, { name: "CLIENT B LTD." })).toBe(
      "the payer's name is the business on the form",
    );
    // A shared word with the business alone is not enough.
    expect(credit.suggestion(b, { name: "Client Other Person" })).toBeNull();
    expect(
      credit.suggestion(b, { usd: 1000, day: "2026-10-15", name: "Nobody" }),
    ).toBe("the amount is the deposit typed on the form");
    expect(credit.suggestion(b, { usd: 1000, day: "2026-11-15" })).toBeNull();
    const hits = credit.searchDeals(deals, "", {
      email: "payer.alpha@example.test",
    });
    expect(hits[0]).toEqual({
      deal: a,
      why: "the payer's email is on the form",
    });
    expect(
      credit.searchDeals(deals, "two", {}).map(x => x.deal.responseId),
    ).toEqual(["resp-b"]);
  });
});

describe("what a tie credits, before it is saved", () => {
  const deal = (
    over: Partial<ReturnType<typeof credit.dealOptions>[number]> = {},
  ) => ({
    responseId: "resp-a",
    business: "Client A Co",
    contact: null,
    email: null,
    closer: "Closer One",
    signedDay: "2026-10-10",
    contracted: 6000,
    deposit: 500,
    plan: null,
    voided: false,
    collected: 0,
    payments: 0,
    fromPaymentsOnly: false,
    ...over,
  });
  const pay = (
    id: string,
    day: string,
    usd: number,
    dealResponseId = null,
  ) => ({
    id,
    day,
    usd,
    dealResponseId,
  });

  test("the deposit, then the rest of the deal, to the closer", () => {
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal() },
        [pay("whop:b", "2026-10-15", 1500), pay("whop:a", "2026-10-09", 500)],
        "payer",
      ),
    ).toEqual([
      "Covers 2 payments from this payer in the list ($2,000), and every one to come.",
      "$2,000 front end ($500 as the deposit, $1,500 as the rest of the deal), credited to Closer One (closer). It counts as cash closed on the closer's pay.",
      "The deal would then have $2,000 of its $6,000 contract tied to it.",
    ]);
  });

  test("one payment over the typed deposit is split, not all deposit", () => {
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal() },
        [pay("whop:pif", "2026-10-11", 5608.8)],
        "payment",
      )[0],
    ).toBe(
      "$5,609 front end ($500 as the deposit, $5,109 as the rest of the deal), credited to Closer One (closer). It counts as cash closed on the closer's pay.",
    );
  });

  test("a payer tie leaves money paid more than 7 days before the form to the automatic rules", () => {
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal() },
        [pay("whop:old", "2026-08-01", 3000), pay("whop:new", "2026-10-11", 500)],
        "payer",
      ),
    ).toEqual([
      "Covers 2 payments from this payer in the list ($3,500), and every one to come.",
      "$3,000 (1 payment) paid more than 7 days before the deal's form on 10 Oct stays with the automatic rules: it belongs to an earlier engagement. Tie such a payment on its own if it is this deal's.",
      "$500 front end as the deposit, credited to Closer One (closer). It counts as cash closed on the closer's pay.",
      "The deal would then have $500 of its $6,000 contract tied to it.",
    ]);
    // The CEO's tie on the one payment takes it, however early.
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal() },
        [pay("whop:old", "2026-08-01", 3000)],
        "payment",
      )[0],
    ).toBe(
      "$3,000 front end ($500 as the deposit, $2,500 as the rest of the deal), credited to Closer One (closer). It counts as cash closed on the closer's pay.",
    );
  });

  test("past the contract, or past 120 days, it is back end", () => {
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal({ collected: 6000 }) },
        [pay("tap:c", "2026-10-20", 800)],
        "payment",
      ),
    ).toEqual([
      "$800 back end, credited to the card's CSM: the deal's contract ($6,000) is already paid.",
      "The deal would then have $6,800 of its $6,000 contract tied to it.",
    ]);
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal({ collected: 500 }) },
        [pay("tap:d", "2027-02-17", 800)],
        "payment",
      )[0],
    ).toBe(
      "$800 back end, credited to the card's CSM: it arrives more than 120 days after the deal was signed on 10 Oct.",
    );
  });

  test("a payment already on the deal is not counted twice", () => {
    expect(
      credit.tiePreview(
        { kind: "deal", deal: deal({ collected: 500 }) },
        [pay("whop:a", "2026-10-09", 500, "resp-a" as never)],
        "payment",
      ),
    ).toEqual([
      "$500 front end as the deposit, credited to Closer One (closer). It counts as cash closed on the closer's pay.",
      "The deal would then have $500 of its $6,000 contract tied to it.",
    ]);
  });

  test("a card, and money that is not a client's", () => {
    expect(
      credit.tiePreview({ kind: "card", name: "Client B Ltd" }, [], "payment"),
    ).toEqual([
      "Back end, credited to Client B Ltd's CSM, unless the card has a deal signed within 120 days whose contract is not yet paid: then it is that deal's money, front end, credited to its closer.",
    ]);
    expect(
      credit.tiePreview(
        { kind: "notClient" },
        [pay("manual:x", "2026-10-01", 250)],
        "payment",
      ),
    ).toEqual([
      "Kept out of client money: no side, nobody credited, and not in front-end cash.",
    ]);
  });
});

describe("front-end cash is the money paid, with the typed amounts beside it", () => {
  const NOW = Date.parse("2026-10-18T09:00:00Z");
  const fresh = Date.parse("2026-10-18T08:10:00Z");
  const stale = Date.parse("2026-10-18T05:30:00Z");
  const window = (
    fe: Record<string, unknown>,
    over: Partial<FunnelWindow> = {},
  ) =>
    ({
      from: "2026-10-01",
      to: "2026-10-17",
      spend: 2000,
      roasCash: 5,
      frontEndCash: {
        deposit: 1500,
        kickoff: 1000,
        total: 10000,
        deals: 3,
        dealsConfirmed: 1,
        confirmed: 500,
        confirmedShare: 0.333,
        ...fe,
      },
      ...over,
    }) as unknown as FunnelWindow;

  test("a payload from before 2026-10-18 is not read: its total was typed", () => {
    const old = window({});
    expect(tf.paidFrontEnd(old)).toBeNull();
    const tile = frontEndTile(old, null, null, NOW);
    expect(tile.value).toBe("n/a");
    expect(tile.naHint).toBe(tf.FRONT_END_CASH_NA);
    expect(frontEndFacts(old, LINES)).toEqual([]);
  });

  test("the tile: paid money, typed beside it, when it was attributed", () => {
    const w = window({
      paid: 10000,
      total: 10000,
      paidDeposit: 2500,
      paidRemainder: 7500,
      typed: { deposit: 1500, kickoff: 1000 },
      byCloser: [
        { name: "Closer One", usd: 8000, payments: 3 },
        { name: "Closer Two", usd: 2000, payments: 1 },
      ],
      typedNotSeen: {
        usd: 1000,
        count: 1,
        items: [
          {
            kind: "deposit",
            day: "2026-10-12",
            business: "Client B Ltd",
            typed: 1000,
            seen: 0,
            usd: 1000,
          },
        ],
      },
      attributedAt: fresh,
    });
    const prev = window({ paid: 8000, total: 8000 });
    const tile = frontEndTile(w, prev, tf.attributedAtOf({ mtd: w }), NOW);
    expect(tile.value).toBe("$10,000");
    expect(tile.change).toBe(0.25);
    const sub = renderToStaticMarkup(h("div", null, tile.sub));
    expect(sub).toContain("typed, not money: deposit $1,500 · kickoff $1,000");
    expect(sub).toContain("attributed 11:10");
    expect(sub).not.toContain("may be behind");
    expect(frontEndFacts(w, [])).toEqual([
      {
        label: "By closer",
        value: "Closer One $8,000 · Closer Two $2,000",
        hint: "Front-end cash in this window by the deal's closer, as written on the closer form.",
      },
      {
        label: "Paid as",
        value: "deposits $2,500 · rest of the deals $7,500",
        hint: expect.any(String),
      },
      { label: "Counted from", value: null, hint: expect.any(String) },
      {
        label: "Typed, no payment seen",
        value: "$1,000 on 1 form",
        hint: "Typed on the forms with no payment seen for it yet: Client B Ltd, deposit typed $1,000 on 12 Oct, $0 seen. Listed, never added to front-end cash.",
      },
    ]);
    // Over two hours, it says so.
    const late = renderToStaticMarkup(
      h("div", null, frontEndTile(w, null, stale, NOW).sub),
    );
    expect(late).toContain("over 2 hours ago: may be behind");
  });

  test("a custom range rebuilds from the paid days and takes its closers from the payments", () => {
    const w = tf.windowFromDaily(
      [
        {
          date: "2026-10-09",
          spend: 100,
          leads: 1,
          booked: 0,
          closes: 0,
          deposit: 0,
        },
        {
          date: "2026-10-10",
          spend: 100,
          leads: 1,
          booked: 0,
          closes: 1,
          deposit: 500,
          frontEndPaid: 500,
        },
        {
          date: "2026-10-11",
          spend: 100,
          leads: 1,
          booked: 0,
          closes: 0,
          deposit: 0,
          frontEndPaid: 0,
        },
      ] as never,
      "2026-10-09",
      "2026-10-11",
    );
    expect(tf.paidFrontEnd(w)).toBe(500);
    expect(w.roasCash).toBe(1.67);
    expect(tf.frontEndOf(w).paidFrom).toBe("2026-10-10");
    const facts = frontEndFacts(w, LINES);
    expect(facts[0].value).toBe("Closer One $500");
    expect(facts[0].hint).toMatch(/Money tab's list of payments/);
    expect(facts.find(f => f.label === "Counted from")?.value).toBe("10 Oct");
    expect(facts.find(f => f.label === "Paid as")?.value).toBeNull();
  });

  test("the words no longer send front-end money to the CSM or add typed amounts", () => {
    expect(tf.FRONT_END_CASH_HINT).not.toMatch(/CSM/);
    expect(tf.FRONT_END_CASH_HINT).toMatch(/typed, not money, and never added/);
    expect(ROAS_CASH.hint).not.toMatch(/kickoff cash the CSM collects/);
    const src = (f: string) =>
      readFileSync(new URL(`../src/pages/ceo/${f}`, import.meta.url), "utf8");
    for (const f of ["TransactionsTab.tsx", "MoneyTab.tsx"])
      expect(src(f)).not.toMatch(/credited to the CSM on the deal/);
    expect(src("SalesTab.tsx")).toContain('header: "Typed cash"');
    expect(src("moneyPayers.tsx")).toContain('"A signed deal"');
    // The sheet never starts a refresh: the tie shows after the next one.
    expect(src("money/AttributeSheet.tsx")).not.toMatch(
      /refreshNow|cockpit_ceo_refresh/,
    );
  });
});

// --- Rendered ----------------------------------------------------------------

const LAST_REFRESH = Date.parse("2026-10-18T06:40:00Z");

/** The sheet's body inside an open Sheet, in place (no portal). */
async function openSheet(
  subject: any,
  lines: MoneyLine[] = LINES,
  more: {
    lastRefreshAt?: number | null;
    startWith?: "deal";
    pending?: unknown[];
    onTied?: (p: unknown) => void;
  } = {},
) {
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(
          Sheet,
          { open: true },
          h(AttributeBody, {
            subject,
            lines,
            lastRefreshAt: LAST_REFRESH,
            onClose: () => {},
            ...more,
          }),
        ),
      ),
    );
  });
  await flush(10);
  expect(sheet()).toBeTruthy();
  return sheet();
}

describe("the Attribute sheet", () => {
  test("ties a payment to a signed deal, with a note, and says when it shows", async () => {
    const s = await openSheet({ kind: "payment", line: UNMATCHED });
    expect(text(s)).toContain("Attribute this payment");
    expect(text(s)).toContain("$1,500");
    expect(text(s)).toContain("Not credited · nothing matched");
    // The deals come from the closer form, the voided one left out.
    expect(fromCalls.map(c => c.table)).toContain("cockpit_sales_deals");
    expect(text(s)).toContain("Client B Ltd");
    expect(text(s)).not.toContain("Voided Co");
    // The deal whose form carries the payer's email is suggested, not chosen.
    const radios = [...s.querySelectorAll('input[type="radio"]')] as any[];
    const dealRadio = radios.find(r =>
      text(r.closest("label")).includes("Client A Co"),
    );
    expect(text(dealRadio.closest("label"))).toContain(
      "Suggested: the payer's email is on the form",
    );
    expect(dealRadio.checked).toBe(false);
    const tieButton = buttonIn(s, "Tie");
    expect(tieButton.disabled).toBe(true);
    expect(text(s)).toContain("Choose the signed deal.");

    await click(dealRadio);
    expect(text(s)).toContain(
      "$1,500 front end as the rest of the deal, credited to Closer One (closer).",
    );
    // A note is required.
    expect(tieButton.disabled).toBe(true);
    expect(text(s)).toContain("Say why in a note of 3 to 500 characters");
    await type(s.querySelector("textarea"), "Payer is the client's partner");
    expect(buttonIn(s, "Tie").disabled).toBe(false);

    await click(buttonIn(s, "Tie"));
    const call = rpcCalls.find(c => c.name === "cockpit_ceo_payment_tie");
    expect(call?.args).toEqual({
      p: {
        note: "Payer is the client's partner",
        paymentId: "whop:pay_test_u1",
        dealResponseId: "resp-a",
      },
    });
    expect(text(sheet())).toContain(
      tiedSentence(new Date(LAST_REFRESH).toISOString()),
    );
    expect(text(sheet())).toContain("Last refresh 09:40.");
    // No refresh is started from here.
    expect(invokes).toEqual([]);
    expect(rpcCalls.some(c => /refresh/.test(c.name))).toBe(false);
  });

  test("every payment from the payer is a payer tie by email; a refusal is said", async () => {
    tieAnswer = () => ({
      data: null,
      error: {
        message: "That payment is not in the ledger yet; refresh Money first.",
      },
    });
    const s = await openSheet({ kind: "payment", line: UNMATCHED });
    const scope = [...s.querySelectorAll('input[type="radio"]')].find(
      (r: any) => text(r.closest("label")).startsWith("Every payment from"),
    ) as any;
    expect(text(scope.closest("label"))).toContain(
      "2 payments in the list, $2,000, and every one to come.",
    );
    await click(scope);
    await click(buttonIn(s, "Not client money"));
    expect(text(s)).toContain(
      "Covers 2 payments from this payer in the list ($2,000), and every one to come.",
    );
    await type(s.querySelector("textarea"), "Not a client: a refund back");
    await click(buttonIn(s, "Tie"));
    expect(
      rpcCalls.find(c => c.name === "cockpit_ceo_payment_tie")?.args,
    ).toEqual({
      p: {
        note: "Not a client: a refund back",
        payerEmail: "payer.alpha@example.test",
        notClient: true,
      },
    });
    expect(text(sheet())).toContain(
      "That payment is not in the ledger yet; refresh Money first.",
    );
    expect(text(sheet())).not.toContain("Tied.");
  });

  test("a single first name cannot be a payer tie", async () => {
    const s = await openSheet({
      kind: "payment",
      line: { ...UNMATCHED, payerEmail: null, payerName: "Dena" },
    });
    const scope = [...s.querySelectorAll('input[type="radio"]')].find(
      (r: any) => text(r.closest("label")).startsWith("Every payment from"),
    ) as any;
    expect(scope.disabled).toBe(true);
    expect(text(scope.closest("label"))).toContain(
      "Tie by email or the full payer name.",
    );
  });

  test("removes a tie, with why", async () => {
    const s = await openSheet({ kind: "payment", line: NOT_CLIENT });
    expect(text(s)).toContain("Not client money · your tie");
    expect(text(s)).toContain("Your tie on this payment");
    expect(text(s)).toContain("Partner returned money");
    await click(buttonIn(s, "Remove the tie"));
    const input = s.querySelector('input[aria-label="Why the tie goes"]');
    const confirm = [...s.querySelectorAll('button[type="submit"]')].find(
      (b: any) => text(b).includes("Remove the tie"),
    ) as any;
    expect(confirm.disabled).toBe(true);
    await type(input, "Wrong payer");
    await click(confirm);
    expect(
      rpcCalls.find(c => c.name === "cockpit_ceo_payment_untie")?.args,
    ).toEqual({
      p: { id: 41, reason: "Wrong payer" },
    });
    expect(text(sheet())).toContain(credit.UNTIED_SENTENCE);
  });

  test("from the payer list, it opens on a signed deal for every payment from that payer", async () => {
    const s = await openSheet(
      { kind: "payer", payer: "payer.alpha@example.test" },
      LINES,
      { lastRefreshAt: null, startWith: "deal" },
    );
    expect(text(s)).toContain(
      "Attribute every payment from payer.alpha@example.test",
    );
    expect(text(s)).toContain("2 payments in the list, $2,000.");
    const pick = [...s.querySelectorAll('input[type="radio"]')].find((r: any) =>
      text(r.closest("label")).includes("Client B Ltd"),
    ) as any;
    await click(pick);
    await type(s.querySelector("textarea"), "Bravo pays for this client");
    await click(buttonIn(s, "Tie"));
    expect(
      rpcCalls.find(c => c.name === "cockpit_ceo_payment_tie")?.args,
    ).toEqual({
      p: {
        note: "Bravo pays for this client",
        payerEmail: "payer.alpha@example.test",
        dealResponseId: "resp-b",
      },
    });
    expect(text(sheet())).toContain(
      "Tied. It shows after the next money refresh (about 15 minutes).",
    );
  });
});

describe("a tie saved before the refresh shows it", () => {
  const AT = LAST_REFRESH + 60_000;
  const byPayment: any = { id: 501, scope: "payment", paymentId: UNMATCHED.id, target: "Client A Co", note: "Partner", at: AT };
  const byPayer: any = { id: 502, scope: "payer", payerEmail: "payer.alpha@example.test", target: null, notClient: true, note: "Refund", at: AT + 1 };

  test("the rows it covers, in words, until the section publishes after it", () => {
    expect(credit.pendingFor(UNMATCHED, [byPayment])).toBe(byPayment);
    expect(credit.pendingFor(PAID_DEPOSIT, [byPayment])).toBeNull();
    // A payer tie covers every payment from the payer; the payment's own tie comes first.
    expect(credit.pendingFor(PAID_DEPOSIT, [byPayment, byPayer])).toBe(byPayer);
    expect(credit.pendingFor(UNMATCHED, [byPayment, byPayer])).toBe(byPayment);
    expect(credit.pendingForPayer("Payer.Alpha@Example.test", [byPayment, byPayer])).toBe(byPayer);
    expect(credit.pendingWords(byPayment)).toBe("Tied by you to Client A Co · shows after the next refresh");
    expect(credit.pendingWords(byPayer)).toBe("Tied by you as not client money · shows after the next refresh");
    expect(credit.pendingWords({ ...byPayment, removed: true })).toBe("Tie removed by you · shows after the next refresh");
    expect(credit.freshPending([byPayment], LAST_REFRESH)).toEqual([byPayment]);
    expect(credit.freshPending([byPayment], AT + 5)).toEqual([]);
  });

  test("the sheet hands the tie back, and opened again says it and can remove it", async () => {
    const got: any[] = [];
    let s = await openSheet({ kind: "payment", line: UNMATCHED }, LINES, { onTied: (p: any) => got.push(p) } as any);
    const dealRadio = [...s.querySelectorAll('input[type="radio"]')].find((r: any) =>
      text(r.closest("label")).includes("Client A Co"),
    ) as any;
    await click(dealRadio);
    await type(s.querySelector("textarea"), "Payer is the client's partner");
    await click(buttonIn(s, "Tie"));
    expect(got).toEqual([expect.objectContaining({ id: 501, scope: "payment", paymentId: UNMATCHED.id,
      target: "Client A Co", notClient: false, note: "Payer is the client's partner" })]);
    // Opened again before the refresh: "Now" says the tie, with "Remove the tie" on it.
    await act(async () => root.render(null));
    await flush(2);
    s = await openSheet({ kind: "payment", line: UNMATCHED }, LINES, { pending: got, onTied: (p: any) => got.push(p) } as any);
    expect(text(s)).toContain("Tied by you to Client A Co · shows after the next refresh");
    expect(text(s)).toContain("Your tie on this payment");
    await click(buttonIn(s, "Remove the tie"));
    await type(s.querySelector('input[aria-label="Why the tie goes"]'), "Wrong deal");
    await click([...s.querySelectorAll('button[type="submit"]')].find((b: any) => text(b).includes("Remove the tie")));
    expect(rpcCalls.find(c => c.name === "cockpit_ceo_payment_untie")?.args).toEqual({ p: { id: 501, reason: "Wrong deal" } });
    expect(got.at(-1)).toMatchObject({ id: 501, removed: true, scope: "payment", paymentId: UNMATCHED.id });
  });
});

/** The Transactions tab over a made-up Money section. */
async function renderTab() {
  const money = {
    key: "money",
    label: "Money",
    ok: true,
    error: null,
    computedAt: LAST_REFRESH,
    lastOkAt: LAST_REFRESH,
    sources: [],
    payload: {
      notes: [],
      attribution: {
        from: "2025-10-18",
        to: "2026-10-17",
        kickoffRead: true,
        tapRead: true,
        totals: {},
        mtd: {
          in: 3050,
          count: 4,
          frontEnd: 500,
          deposit: 500,
          remainder: 0,
          kickoff: 0,
          backEnd: 800,
          unattributed: 1500,
          unattributedCount: 1,
        },
        lastMonth: {},
        byPerson: [],
        ties: { live: 1, applied: 1, payments: 1, notApplied: [] },
        transactions: LINES,
      },
    },
  };
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(
          MemoryRouter,
          { initialEntries: ["/ceo?tab=transactions"] },
          h(TransactionsTab, {
            sections: { money } as any,
            now: Date.parse("2026-10-18T09:00:00Z"),
            day: "2026-10-18",
            goTab: () => {},
          }),
        ),
      ),
    );
  });
  await flush(8);
}
const rowOf = (amount: string) =>
  [...container.querySelectorAll("tbody tr")].find((r: any) =>
    text(r).includes(amount),
  ) as any;

describe("the Transactions tab", () => {
  test("each money-in row carries its credit line and the Attribute action", async () => {
    await renderTab();
    expect(text(rowOf("$1,500"))).toContain("Not credited · nothing matched");
    expect(text(rowOf("$800"))).toContain(
      "Credited to Csm One (CSM) · card name",
    );
    expect(text(rowOf("$250"))).toContain("Not client money · your tie");
    for (const amount of ["$1,500", "$800", "$250"])
      expect(buttonIn(rowOf(amount), "Attribute")).toBeTruthy();
    // A payout on the statement is listed, not client money, and not tied.
    expect(text(rowOf("$7,000"))).toContain("Not client money: whop payout");
    expect(buttonIn(rowOf("$7,000"), "Attribute")).toBeUndefined();
    // The facts: not client money and the ties.
    expect(page()).toContain("Not client money");
    expect(page()).toContain("1 of 1 applied, 1 payment");
  });

  test.if(portalsMount)(
    "pressing Attribute opens the sheet on that payment",
    async () => {
      await renderTab();
      await click(buttonIn(rowOf("$1,500"), "Attribute"));
      await flush(6);
      expect(text(sheet())).toContain("Attribute this payment");
      expect(text(sheet())).toContain("Payer Alpha");
    },
  );

  test("on a phone the credit wraps in view and says who paid when nothing else does", async () => {
    await renderTab();
    const cell = [...rowOf("$1,500").querySelectorAll("span")].find((x: any) =>
      String(x.className).includes("whitespace-normal"),
    ) as any;
    // Capped to the width left beside the day and the amount; the wide table keeps its own width.
    expect(String(cell.className)).toContain("max-w-[10rem]");
    expect(String(cell.className)).toContain("@xl:min-w-[13rem]");
    expect(String(cell.className)).not.toMatch(/(^| )min-w-\[13rem\]/);
    expect(text(rowOf("$1,500"))).toContain("from Payer Alpha");
    // A row resting on a deal says the deal instead.
    expect(text(rowOf("$500"))).toContain("on Client A Co");
  });

  test.if(portalsMount)(
    "a tie made from a row is said on that row at once, until the next refresh",
    async () => {
      await renderTab();
      await click(buttonIn(rowOf("$1,500"), "Attribute"));
      await flush(6);
      const s = sheet();
      const dealRadio = [...s.querySelectorAll('input[type="radio"]')].find((r: any) =>
        text(r.closest("label")).includes("Client A Co"),
      ) as any;
      await click(dealRadio);
      await type(s.querySelector("textarea"), "Payer is the client's partner");
      await click(buttonIn(s, "Tie"));
      await click(buttonIn(sheet(), "Close"));
      await flush(6);
      expect(text(rowOf("$1,500"))).toContain("Tied by you to Client A Co · shows after the next refresh");
      // A payment-only tie leaves the payer's other payment as it was.
      expect(text(rowOf("$500"))).not.toContain("Tied by you");
    },
    // The sheet, the deal list and the tab render in turn: slow on a loaded runner.
    30000,
  );
});
