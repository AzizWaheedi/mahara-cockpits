import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * Whop back on the CSM invoice desk (CEO, 2026-11-02: "Add Whop to the
 * invoice page"). The form's three link choices and what each one sends
 * (createLink and provider, or the pasted link); the preview's Pay now link;
 * the confirm sentence; the list's "Use a Whop link instead" on a failed Ecom
 * invoice with no link, "Same invoice with Whop" on an unpaid issued Ecom
 * invoice ("Whop copy made" instead once that copy exists), the Ecom payment
 * chips and "Payment shows in Whop"; the page's wiring
 * (cockpit_invoice_payments, cockpit_invoice_change 'whop', the form refilled
 * with a Whop link); and the pure helpers. Fictional clients; every database
 * call is a stand-in.
 *
 * Run: bun test scripts/invoice-whop.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/money",
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
  "HTMLFormElement",
  "HTMLIFrameElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "SubmitEvent",
  "DocumentFragment",
  "DOMParser",
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
(win as any).HTMLElement.prototype.scrollIntoView ??= () => {};

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));

// --- A stand-in for the signed-in Supabase client the page reads through. ----

const TODAY_FOR_ROWS = "2026-11-02";
type Row = import("../src/lib/invoices").InvoiceRow;
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let paymentsFail = false;
let tableRows: Record<string, unknown> = {};
const db = {
  from(table: string) {
    const result = () => ({ data: tableRows[table] ?? [], error: null });
    const q: any = {
      select: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve(result()),
      // biome-ignore lint/suspicious/noThenProperty: a query builder is a thenable.
      then: (ok: any, bad: any) => Promise.resolve(result()).then(ok, bad),
    };
    return q;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    if (name === "cockpit_invoice_payments") {
      return paymentsFail
        ? { data: null, error: { message: "permission denied" } }
        : {
            data: [{ id: "ecom-unpaid", status: "UNPAID", paid_at: null }],
            error: null,
          };
    }
    if (name === "cockpit_invoice_change")
      return { data: { id: args.p_id, status: "queued" }, error: null };
    return { data: null, error: null };
  },
};
const auth = { client: db, clients: null, isAdmin: false, isCeo: false };
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => auth,
}));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const lib = await import("../src/lib/invoices");
const { InvoiceForm, LINKS } = await import(
  "../src/components/invoices/InvoiceForm"
);
const { InvoiceList } = await import("../src/components/invoices/InvoiceList");
const { InvoicesPage } = await import("../src/pages/InvoicesPage");

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
  return { host: host as any, root };
}
const body = () => win.document.body as any;
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const buttons = (label: string, root: any = body()) =>
  [...root.querySelectorAll("button")].filter(
    (b: any) => text(b) === label,
  ) as any[];
const button = (label: string, root: any = body()) =>
  buttons(label, root)[0] as any;
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
async function clear(root: any) {
  await act(async () => root.unmount());
  const i = roots.indexOf(root);
  if (i >= 0) roots.splice(i, 1);
  await flush();
  body().innerHTML = "";
}

const row = (over: Partial<Row>): Row => ({
  id: "inv-1",
  clickup_task_id: "ex2",
  client_name: "Example Clinic",
  kind: "checkout",
  amount_usd: 1500,
  description: "Month 2",
  line_note: "Second month of the agreement",
  client_detail: "Kuwait",
  client_tax_id: "300123456700003",
  period: "Days 31-60",
  pay_note: "Pay by the due date, please.",
  issue_date: "2026-10-30",
  due_date: "2026-11-20",
  payments: [],
  checkout_source: "ecom",
  checkout_url: null,
  whop_plan_id: null,
  ecom_invoice_id: null,
  amount_kwd: null,
  kwd_rate: null,
  status: "issued",
  invoice_no: "INV-2026-030",
  drive_url: "https://example.com/pdf",
  error: null,
  attempts: 1,
  requested_by: "csm@example.com",
  requested_at: "2026-10-30T09:00:00Z",
  issued_at: "2026-10-30T09:02:00Z",
  ...over,
});

const failedEcom = row({
  id: "ecom-failed",
  status: "failed",
  invoice_no: null,
  drive_url: null,
  issued_at: null,
  error: "Ecom refused the link (HTTP 422). Tell Muhammed.",
});
const issuedWhop = row({
  id: "whop-issued",
  invoice_no: "INV-2026-031",
  checkout_source: "whop",
  whop_plan_id: "plan_Example123",
  checkout_url: "https://whop.com/checkout/plan_Example123",
});
const ecomUnpaid = row({
  id: "ecom-unpaid",
  ecom_invoice_id: "INV_Example12345",
  checkout_url: "https://invoice.ecom.io/example",
  amount_kwd: 460.5,
  kwd_rate: 0.307,
});
const unpaid = { status: "UNPAID", paid_at: null, method: null };
const paidState = {
  status: "PAID",
  paid_at: "2026-10-31T08:00:00Z",
  method: "KNET",
};

beforeEach(() => {
  toasts.length = 0;
  rpcCalls.length = 0;
  paymentsFail = false;
});

// --- The pure helpers ----------------------------------------------------------

describe("the Whop helpers", () => {
  test("only a failed Pay online Ecom invoice with no Ecom link can switch", () => {
    expect(lib.canSwitchToWhop(failedEcom)).toBe(true);
    expect(
      lib.canSwitchToWhop({ ...failedEcom, ecom_invoice_id: "INV_abc123" }),
    ).toBe(false);
    expect(
      lib.canSwitchToWhop({
        ...failedEcom,
        checkout_url: "https://invoice.ecom.io/x",
      }),
    ).toBe(false);
    expect(
      lib.canSwitchToWhop({ ...failedEcom, checkout_source: "whop" }),
    ).toBe(false);
    expect(
      lib.canSwitchToWhop({ ...failedEcom, checkout_source: "pasted" }),
    ).toBe(false);
    expect(lib.canSwitchToWhop({ ...failedEcom, kind: "autocharge" })).toBe(
      false,
    );
    for (const status of [
      "queued",
      "rendering",
      "issued",
      "cancelled",
    ] as const)
      expect(lib.canSwitchToWhop({ ...failedEcom, status })).toBe(false);
  });

  test("the payment word for every Ecom state, Whop, a pasted link and a paid invoice", () => {
    const word = (i: Row, p?: any) => lib.paymentWord(i, p);
    expect(word(ecomUnpaid, unpaid)).toEqual({
      text: "Not paid yet",
      tone: "neutral",
    });
    // No Ecom row yet reads as not paid; the sync runs every 15 minutes.
    expect(word(ecomUnpaid)).toEqual({ text: "Not paid yet", tone: "neutral" });
    expect(word(ecomUnpaid, paidState)).toEqual({ text: "Paid", tone: "good" });
    expect(word(ecomUnpaid, { ...unpaid, status: "paid" })).toEqual({
      text: "Paid",
      tone: "good",
    });
    expect(word(ecomUnpaid, { ...unpaid, status: "EXPIRED" })).toEqual({
      text: "Link expired",
      tone: "warn",
    });
    expect(word(ecomUnpaid, { ...unpaid, status: "DELETED" })).toEqual({
      text: "Link deleted",
      tone: "warn",
    });
    expect(word(issuedWhop)).toEqual({
      text: "Payment shows in Whop",
      tone: "neutral",
    });
    // A pasted link's payment is tracked nowhere: nothing to say.
    expect(
      word(row({ checkout_source: "pasted", checkout_url: "https://x.test" })),
    ).toBeNull();
    expect(word(row({ kind: "paid", checkout_source: "pasted" }))).toEqual({
      text: "Paid",
      tone: "good",
    });
    expect(word(row({ kind: "autocharge", checkout_source: "pasted" }))).toBe(
      null,
    );
    expect(word(failedEcom)).toBeNull();
    expect(word({ ...issuedWhop, status: "queued" })).toBeNull();
  });

  test("Same invoice with Whop: issued, Pay online, Ecom, not paid", () => {
    expect(lib.canRedoWithWhop(ecomUnpaid, unpaid)).toBe(true);
    expect(lib.canRedoWithWhop(ecomUnpaid, undefined)).toBe(true);
    expect(
      lib.canRedoWithWhop(ecomUnpaid, { ...unpaid, status: "EXPIRED" }),
    ).toBe(true);
    expect(lib.canRedoWithWhop(ecomUnpaid, paidState)).toBe(false);
    expect(lib.canRedoWithWhop(issuedWhop, undefined)).toBe(false);
    expect(lib.canRedoWithWhop(failedEcom, undefined)).toBe(false);
    expect(
      lib.canRedoWithWhop({ ...ecomUnpaid, kind: "autocharge" }, unpaid),
    ).toBe(false);
  });

  test("a Whop copy is a later, not cancelled Whop invoice for the same client and amount", () => {
    const copy = { ...issuedWhop, requested_at: "2026-10-31T09:00:00Z" };
    expect(lib.whopCopyOf(ecomUnpaid, [copy, ecomUnpaid])).toBe(copy);
    for (const status of ["queued", "rendering", "failed"] as const)
      expect(lib.whopCopyOf(ecomUnpaid, [{ ...copy, status }])?.status).toBe(
        status,
      );
    expect(
      lib.whopCopyOf(ecomUnpaid, [{ ...copy, status: "cancelled" }]),
    ).toBeNull();
    expect(lib.whopCopyOf(ecomUnpaid, [{ ...copy, amount_usd: 1400 }])).toBe(
      null,
    );
    expect(
      lib.whopCopyOf(ecomUnpaid, [{ ...copy, clickup_task_id: "ex9" }]),
    ).toBeNull();
    expect(
      lib.whopCopyOf(ecomUnpaid, [{ ...copy, checkout_source: "pasted" }]),
    ).toBeNull();
    // A Whop invoice asked for before (or with) the Ecom one is not its copy.
    expect(lib.whopCopyOf(ecomUnpaid, [issuedWhop])).toBeNull();
    expect(
      lib.whopCopyOf(ecomUnpaid, [
        { ...copy, requested_at: "2026-10-29T09:00:00Z" },
      ]),
    ).toBeNull();
  });

  test("the refill keeps the invoice's words and moves a past due date three days out", () => {
    expect(lib.sameWithWhop(ecomUnpaid, TODAY_FOR_ROWS)).toEqual({
      taskId: "ex2",
      kind: "checkout",
      amount: "1500",
      description: "Month 2",
      lineNote: "Second month of the agreement",
      clientDetail: "Kuwait",
      taxId: "300123456700003",
      period: "Days 31-60",
      payNote: "Pay by the due date, please.",
      dueDate: "2026-11-20",
      linkMode: "whop",
      clientEmail: "",
    });
    const late = lib.sameWithWhop(
      { ...ecomUnpaid, due_date: "2026-10-01", line_note: null },
      TODAY_FOR_ROWS,
    );
    expect(late.dueDate).toBe("2026-11-05");
    expect(late.lineNote).toBe("");
    expect(
      lib.sameWithWhop({ ...ecomUnpaid, due_date: null }, "2026-12-30").dueDate,
    ).toBe("2027-01-02");
    expect(
      lib.sameWithWhop({ ...ecomUnpaid, amount_usd: 1500.5 }, TODAY_FOR_ROWS)
        .amount,
    ).toBe("1500.5");
    expect(lib.cents("1500.5")).toBe(150050);
  });

  test("four link choices, short enough for a phone, Ecom first, the backups next", () => {
    expect(LINKS.map(l => l.label)).toEqual([
      "Ecom link (KWD)",
      "Whop link (USD)",
      "Tap link (KWD)",
      "Paste a link",
    ]);
    for (const l of LINKS) expect(l.label.length).toBeLessThanOrEqual(15);
    expect(LINKS[1].hint).toBe(
      "Cards and Apple Pay, charged in USD. Use it when Ecom does not work for the client.",
    );
  });
});

// --- The form -------------------------------------------------------------------

const clients = [
  {
    taskId: "ex2",
    name: "Example Clinic",
    country: "Kuwait",
    plan: "Monthly",
    status: "Active",
    nextUsd: 1500,
    nextDate: null,
  },
];
const TODAY = lib.kuwaitToday();
const FUTURE = lib.addDays(TODAY, 10);
const start = {
  taskId: "ex2",
  kind: "checkout" as const,
  amount: "1500",
  description: "Month 2",
  lineNote: "",
  clientDetail: "Kuwait",
  taxId: "",
  period: "",
  payNote: "",
  dueDate: FUTURE,
  linkMode: "ecom" as const,
};

async function form(prefill: any = start) {
  const drafts: any[] = [];
  const issued: any[] = [];
  const out = await draw(
    createElement(InvoiceForm, {
      clients,
      folders: {},
      taxIds: {},
      today: TODAY,
      canSetFolder: false,
      prefill,
      onDraft: (d: any) => {
        drafts.push(d);
      },
      onIssue: async (a: any) => {
        issued.push(a);
        return true;
      },
      onSetFolder: async () => true,
    }),
  );
  return { ...out, drafts, issued, last: () => drafts[drafts.length - 1] };
}

async function issue(host: any) {
  const submit = buttons("Issue invoice", host).find(
    (b: any) => b.type === "submit",
  );
  expect(submit.disabled).toBe(false);
  await click(submit);
  const dialog = body().querySelector('[role="alertdialog"]');
  expect(dialog).toBeTruthy();
  const sentence = text(dialog);
  await click(button("Issue invoice", dialog));
  return sentence;
}

describe("the invoice form's link choice", () => {
  test("Ecom is the default: createLink with provider ecom, the Ecom preview link", async () => {
    const f = await form();
    const pill = button("Ecom link (KWD)", f.host);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    expect(text(f.host)).toContain(
      "KNET and cards, charged in KWD at today's rate. The usual one.",
    );
    expect(f.last().checkout_source).toBe("ecom");
    expect(f.last().checkout_url).toBe("https://invoice.ecom.io/");
    const sentence = await issue(f.host);
    expect(sentence).toContain(
      "The worker also creates its Ecom payment link in KWD first.",
    );
    expect(f.issued).toHaveLength(1);
    expect(f.issued[0]).toMatchObject({
      taskId: "ex2",
      kind: "checkout",
      createLink: true,
      provider: "ecom",
      dueDate: FUTURE,
    });
    expect(f.issued[0].checkoutUrl).toBeUndefined();
    await clear(f.root);
  });

  test("Whop link (USD): createLink with provider whop, the Whop preview link, USD in the confirm", async () => {
    const f = await form();
    await click(button("Whop link (USD)", f.host));
    expect(button("Whop link (USD)", f.host).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Ecom link (KWD)", f.host).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(text(f.host)).toContain(
      "Cards and Apple Pay, charged in USD. Use it when Ecom does not work for the client.",
    );
    expect(f.last().checkout_source).toBe("whop");
    expect(f.last().checkout_url).toBe("https://whop.com/checkout/");
    const sentence = await issue(f.host);
    expect(sentence).toContain(
      "The worker also creates its Whop payment link in USD first.",
    );
    expect(sentence).not.toContain("Ecom");
    expect(f.issued[0]).toMatchObject({
      kind: "checkout",
      createLink: true,
      provider: "whop",
    });
    expect(f.issued[0].checkoutUrl).toBeUndefined();
    await clear(f.root);
  });

  test("Paste a link sends the link, never createLink or a provider", async () => {
    const f = await form();
    await click(button("Paste a link", f.host));
    const input = f.host.querySelector("#inv-link");
    expect(input).toBeTruthy();
    expect(
      buttons("Issue invoice", f.host).find((b: any) => b.type === "submit")
        .disabled,
    ).toBe(true);
    await type(input, "https://pay.example.test/abc");
    expect(f.last().checkout_source).toBe("pasted");
    expect(f.last().checkout_url).toBe("https://pay.example.test/abc");
    const sentence = await issue(f.host);
    expect(sentence).not.toContain("The worker also creates");
    expect(f.issued[0].checkoutUrl).toBe("https://pay.example.test/abc");
    expect(f.issued[0].createLink).toBeUndefined();
    expect(f.issued[0].provider).toBeUndefined();
    await clear(f.root);
  });

  test("a card-on-file invoice sends no link at all, whatever the link choice was", async () => {
    const f = await form({ ...start, kind: "autocharge", linkMode: "whop" });
    expect(button("Whop link (USD)", f.host)).toBeUndefined();
    expect(f.last().checkout_source).toBe("pasted");
    expect(f.last().checkout_url).toBeNull();
    await issue(f.host);
    expect(f.issued[0].createLink).toBeUndefined();
    expect(f.issued[0].provider).toBeUndefined();
    await clear(f.root);
  });

  test("a refill from Same invoice with Whop opens on the Whop link with every field", async () => {
    const f = await form(lib.sameWithWhop(ecomUnpaid, TODAY));
    expect(button("Whop link (USD)", f.host).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(f.host.querySelector("#inv-desc").value).toBe("Month 2");
    expect(f.host.querySelector("#inv-amount").value).toBe("1500");
    expect(f.host.querySelector("#inv-line").value).toBe(
      "Second month of the agreement",
    );
    expect(f.host.querySelector("#inv-tax").value).toBe("300123456700003");
    expect(f.host.querySelector("#inv-note").value).toBe(
      "Pay by the due date, please.",
    );
    expect(f.last()).toMatchObject({
      client_name: "Example Clinic",
      checkout_source: "whop",
      period: "Days 31-60",
    });
    await clear(f.root);
  });
});

// --- The list -------------------------------------------------------------------

async function list(invoices: Row[], paid: any = {}) {
  const changes: string[][] = [];
  const whops: Row[] = [];
  const redos: [string, string][] = [];
  const out = await draw(
    createElement(InvoiceList, {
      invoices,
      paid,
      onChange: async (id: string, action: string, email?: string) => {
        changes.push(email === undefined ? [id, action] : [id, action, email]);
        return true;
      },
      onRedo: (i: Row, mode: string) => {
        redos.push([i.id, mode]);
        if (mode === "whop") whops.push(i);
      },
    }),
  );
  return { ...out, changes, whops, redos };
}

describe("the invoice list's Whop buttons and payment chips", () => {
  test("a failed Ecom invoice with no link offers Use a Whop link instead", async () => {
    const l = await list([failedEcom]);
    expect(text(l.host)).toContain("Pay online · Ecom link · Month 2");
    expect(button("Try again", l.host)).toBeTruthy();
    await click(button("Use a Whop link instead", l.host));
    expect(l.changes).toEqual([["ecom-failed", "whop"]]);
    await clear(l.root);
  });

  test("no switch once Ecom made a link, or on a Whop invoice that failed", async () => {
    const l = await list([
      { ...failedEcom, id: "a", ecom_invoice_id: "INV_abc123" },
      { ...failedEcom, id: "b", checkout_source: "whop" },
    ]);
    expect(button("Use a Whop link instead", l.host)).toBeUndefined();
    expect(buttons("Try again", l.host)).toHaveLength(2);
    await clear(l.root);
  });

  test("an issued Whop invoice: its payment page, its link to copy, payment shows in Whop", async () => {
    const l = await list([issuedWhop]);
    const t = text(l.host);
    expect(t).toContain("Pay online · Whop link · Month 2");
    expect(t).toContain("Whop payment page");
    expect(t).toContain("Payment shows in Whop");
    expect(button("Copy payment link", l.host)).toBeTruthy();
    const page = [...l.host.querySelectorAll("a")].find(
      (a: any) => text(a) === "Whop payment page",
    ) as any;
    expect(page.getAttribute("href")).toBe(
      "https://whop.com/checkout/plan_Example123",
    );
    expect(button("Same invoice with Whop", l.host)).toBeUndefined();
    await clear(l.root);
  });

  test("an unpaid Ecom invoice says so and offers the same invoice with Whop", async () => {
    const l = await list([ecomUnpaid], { "ecom-unpaid": unpaid });
    expect(text(l.host)).toContain("Not paid yet");
    expect(text(l.host)).toContain("Ecom payment page");
    const redo = button("Same invoice with Whop", l.host);
    expect(redo.getAttribute("title")).toContain(
      "send the client the new link",
    );
    expect(redo.getAttribute("title")).toContain(
      "The Ecom link stays payable until it expires.",
    );
    await click(redo);
    expect(l.whops.map(i => i.id)).toEqual(["ecom-unpaid"]);
    await clear(l.root);
  });

  test("once the Whop copy is asked for, the Ecom row says so and offers no second one", async () => {
    const copy = {
      ...issuedWhop,
      requested_at: "2026-10-31T09:00:00Z",
      issued_at: "2026-10-31T09:02:00Z",
    };
    const l = await list([copy, ecomUnpaid], { "ecom-unpaid": unpaid });
    expect(button("Same invoice with Whop", l.host)).toBeUndefined();
    const note = [...l.host.querySelectorAll("span")].find(
      (s: any) => text(s) === "Whop copy made",
    ) as any;
    expect(note.getAttribute("title")).toContain(
      "is INV-2026-031. Send the client that link.",
    );
    expect(text(l.host)).toContain("Not paid yet");
    await clear(l.root);
    // A cancelled copy gives the button back.
    const again = await list([{ ...copy, status: "cancelled" }, ecomUnpaid], {
      "ecom-unpaid": unpaid,
    });
    expect(button("Same invoice with Whop", again.host)).toBeTruthy();
    expect(text(again.host)).not.toContain("Whop copy made");
    await clear(again.root);
  });

  test("a paid Ecom invoice shows Paid and no Whop button", async () => {
    const l = await list([ecomUnpaid], { "ecom-unpaid": paidState });
    expect(text(l.host)).toContain("Paid");
    expect(text(l.host)).not.toContain("Not paid yet");
    expect(button("Same invoice with Whop", l.host)).toBeUndefined();
    await clear(l.root);
  });

  test("without Ecom's answer an Ecom row says nothing and offers no second link", async () => {
    const l = await list([ecomUnpaid, issuedWhop], null);
    const t = text(l.host);
    expect(t).not.toContain("Not paid yet");
    expect(t).toContain("Payment shows in Whop");
    expect(button("Same invoice with Whop", l.host)).toBeUndefined();
    await clear(l.root);
  });
});

// --- The page's wiring ----------------------------------------------------------

function seed(invoices: Row[]) {
  tableRows = {
    cockpit_invoices: invoices,
    cockpit_billing_accounts: [
      {
        clickup_task_id: "ex2",
        client_name: "Example Clinic",
        country: "Kuwait",
        payment_plan: "Monthly",
        client_status: "Active",
        next_payment_usd: 1500,
        next_payment_date: null,
      },
    ],
    cockpit_client_drive_folders: [],
    cockpit_invoice_desk_status: {
      beat_at: new Date().toISOString(),
      ok: true,
      detail: null,
    },
  };
}

describe("the Invoices page", () => {
  test("asks Ecom about the issued Ecom invoices only, and shows the answer", async () => {
    seed([ecomUnpaid, issuedWhop, failedEcom]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    const ask = rpcCalls.filter(c => c.name === "cockpit_invoice_payments");
    expect(ask).toEqual([
      { name: "cockpit_invoice_payments", args: { p_ids: ["ecom-unpaid"] } },
    ]);
    expect(text(p.host)).toContain("Not paid yet");
    expect(text(p.host)).toContain("Payment shows in Whop");
    expect(text(p.host)).toContain(
      "Pay online invoices get an Ecom link, or a Whop or Tap link as a backup.",
    );
    await clear(p.root);
  });

  test("a refused payment lookup leaves the list up, without payment words", async () => {
    paymentsFail = true;
    seed([ecomUnpaid]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    const t = text(p.host);
    expect(t).toContain("Example Clinic");
    expect(t).not.toContain("Not paid yet");
    expect(t).toContain(
      "Whether the Ecom and Tap links were paid did not load. Reload the page to see it.",
    );
    await clear(p.root);
  });

  test("Use a Whop link instead sends change 'whop' and says so", async () => {
    seed([failedEcom]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    await click(button("Use a Whop link instead", p.host));
    expect(rpcCalls.find(c => c.name === "cockpit_invoice_change")).toEqual({
      name: "cockpit_invoice_change",
      args: { p_id: "ecom-failed", p_action: "whop" },
    });
    expect(toasts).toContain("Sent back to be issued with a Whop link");
    await clear(p.root);
  });

  test("Same invoice with Whop refills the form with a Whop link and tells the CSM what to send", async () => {
    seed([ecomUnpaid]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    expect(
      button("Whop link (USD)", p.host)?.getAttribute("aria-pressed") ?? null,
    ).toBeNull();
    await click(button("Same invoice with Whop", p.host));
    expect(button("Whop link (USD)", p.host).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(p.host.querySelector("#inv-desc").value).toBe("Month 2");
    expect(p.host.querySelector("#inv-amount").value).toBe("1500");
    expect(toasts).toEqual([
      "The form has the same invoice with a Whop link. Check it and issue it, then send the client the new link. The old Ecom link stays payable until it expires.",
    ]);
    // A second press opens the form fresh again, on the same invoice.
    await type(p.host.querySelector("#inv-desc"), "Changed");
    await click(button("Same invoice with Whop", p.host));
    expect(p.host.querySelector("#inv-desc").value).toBe("Month 2");
    await clear(p.root);
  });
});

// --- Tap, the second backup (2026-11-05) -------------------------------------------

const tapUnpaid = row({
  id: "tap-unpaid",
  invoice_no: "INV-2026-032",
  checkout_source: "tap",
  tap_invoice_id: "inv_Example123456",
  checkout_url: "https://invoices.tap.company/invoice/inv_Example123456",
  client_email: "owner@example-clinic.com",
  amount_kwd: 460.5,
  kwd_rate: 0.307,
});

describe("Tap beside Ecom and Whop", () => {
  test("the helpers: which links a failed or unpaid invoice can move to, and the email rule", () => {
    expect(lib.switchTargets(failedEcom)).toEqual(["whop", "tap"]);
    expect(
      lib.switchTargets({ ...failedEcom, checkout_source: "tap" }),
    ).toEqual(["ecom", "whop"]);
    expect(
      lib.switchTargets({ ...failedEcom, checkout_source: "whop" }),
    ).toEqual(["ecom", "tap"]);
    expect(
      lib.switchTargets({
        ...failedEcom,
        checkout_source: "tap",
        tap_invoice_id: "inv_Example123456",
      }),
    ).toEqual([]);
    expect(
      lib.switchTargets({ ...failedEcom, checkout_source: "pasted" }),
    ).toEqual([]);
    expect(lib.switchTargets({ ...failedEcom, status: "queued" })).toEqual([]);
    expect(lib.redoTargets(ecomUnpaid, unpaid)).toEqual(["whop", "tap"]);
    expect(lib.redoTargets(tapUnpaid, undefined)).toEqual(["ecom", "whop"]);
    expect(lib.redoTargets(tapUnpaid, paidState)).toEqual([]);
    expect(lib.redoTargets(issuedWhop, undefined)).toEqual([]);
    expect(
      lib.redoTargets(tapUnpaid, undefined, [tapUnpaid, ecomUnpaid]),
    ).toEqual(["whop"]);
    expect(
      lib.redoTargets(tapUnpaid, undefined, [
        { ...ecomUnpaid, status: "cancelled" },
      ]),
    ).toEqual(["ecom", "whop"]);
    expect(
      lib.redoTargets(tapUnpaid, undefined, [
        { ...ecomUnpaid, amount_usd: 900 },
      ]),
    ).toEqual(["ecom", "whop"]);
    expect(lib.paymentWord(tapUnpaid, undefined)).toEqual({
      text: "Not paid yet",
      tone: "neutral",
    });
    expect(
      lib.paymentWord(tapUnpaid, {
        status: "CANCELLED",
        paid_at: null,
        method: "Tap",
      })?.text,
    ).toBe("Link cancelled");
    const tapCopy = { ...tapUnpaid, requested_at: "2026-10-31T09:00:00Z" };
    expect(lib.copyOf(ecomUnpaid, [tapCopy])).toBe(tapCopy);
    expect(lib.whopCopyOf(ecomUnpaid, [tapCopy])).toBeNull();
    expect(lib.sameWith(tapUnpaid, TODAY_FOR_ROWS, "ecom")).toMatchObject({
      linkMode: "ecom",
      clientEmail: "owner@example-clinic.com",
    });
    expect(lib.emailOk(" Owner@Example-Clinic.COM ")).toBe(true);
    expect(lib.emailOk("owner at clinic")).toBe(false);
    expect(lib.emailOk("owner@clinic")).toBe(false);
  });

  test("Tap link (KWD) asks for the client's email and sends provider tap with it", async () => {
    const f = await form();
    await click(button("Tap link (KWD)", f.host));
    expect(button("Tap link (KWD)", f.host).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(text(f.host)).toContain(
      "Another backup when Ecom does not work. Tap needs the client's email.",
    );
    expect(f.last().checkout_source).toBe("tap");
    expect(f.last().checkout_url).toBe("https://invoices.tap.company/");
    const email = f.host.querySelector("#inv-email");
    expect(email).toBeTruthy();
    const submit = () =>
      buttons("Issue invoice", f.host).find((b: any) => b.type === "submit");
    expect(submit().disabled).toBe(true);
    expect(text(f.host)).toContain(
      "Type the client's email for Tap, for example name@company.com.",
    );
    await type(email, "owner at clinic");
    expect(submit().disabled).toBe(true);
    await type(email, " Owner@Example-Clinic.COM ");
    const sentence = await issue(f.host);
    expect(sentence).toContain(
      "The worker also creates its Tap payment link in KWD first.",
    );
    expect(f.issued[0]).toMatchObject({
      createLink: true,
      provider: "tap",
      clientEmail: "owner@example-clinic.com",
    });
    await clear(f.root);
  });

  test("the email goes only with Tap", async () => {
    const f = await form({ ...start, clientEmail: "owner@example-clinic.com" });
    expect(f.host.querySelector("#inv-email")).toBeNull();
    await issue(f.host);
    expect(f.issued[0].provider).toBe("ecom");
    expect(f.issued[0].clientEmail).toBeUndefined();
    await clear(f.root);
  });

  test("a failed Ecom invoice offers Whop and Tap; Tap asks for the email first", async () => {
    const l = await list([failedEcom]);
    expect(button("Use a Whop link instead", l.host)).toBeTruthy();
    await click(button("Use a Tap link instead", l.host));
    expect(l.changes).toEqual([]);
    const input = l.host.querySelector("#tap-email-ecom-failed");
    expect(input).toBeTruthy();
    expect(text(l.host)).toContain("Tap needs the client's email");
    expect(button("Use the Tap link", l.host).disabled).toBe(true);
    await type(input, "owner@example-clinic.com");
    await click(button("Use the Tap link", l.host));
    expect(l.changes).toEqual([
      ["ecom-failed", "tap", "owner@example-clinic.com"],
    ]);
    await clear(l.root);
  });

  test("with the email already on the invoice, Use a Tap link instead goes straight away", async () => {
    const l = await list([
      { ...failedEcom, client_email: "owner@example-clinic.com" },
    ]);
    await click(button("Use a Tap link instead", l.host));
    expect(l.changes).toEqual([["ecom-failed", "tap"]]);
    await clear(l.root);
  });

  test("a failed Tap invoice offers Ecom and Whop", async () => {
    const l = await list([
      {
        ...failedEcom,
        checkout_source: "tap",
        client_email: "a@b.co",
        error: "Tap did not make the link.",
      },
    ]);
    expect(text(l.host)).toContain("Pay online · Tap link · Month 2");
    await click(button("Use an Ecom link instead", l.host));
    expect(button("Use a Whop link instead", l.host)).toBeTruthy();
    expect(button("Use a Tap link instead", l.host)).toBeUndefined();
    expect(l.changes).toEqual([["ecom-failed", "ecom"]]);
    await clear(l.root);
  });

  test("an unpaid Tap invoice: its page, Not paid yet, and the same invoice with Ecom or Whop", async () => {
    const l = await list([tapUnpaid], {
      "tap-unpaid": { status: "UNPAID", paid_at: null, method: "Tap" },
    });
    const t = text(l.host);
    expect(t).toContain("Tap payment page");
    expect(t).toContain("Not paid yet");
    const redo = button("Same invoice with Ecom", l.host);
    expect(redo.getAttribute("title")).toBe(
      "Tap does not work for this client? Make the same invoice with an Ecom link, then send the client the new link. The Tap link stays payable until it expires.",
    );
    await click(redo);
    await click(button("Same invoice with Whop", l.host));
    expect(l.redos).toEqual([
      ["tap-unpaid", "ecom"],
      ["tap-unpaid", "whop"],
    ]);
    await clear(l.root);
    const paid = await list([tapUnpaid], {
      "tap-unpaid": {
        status: "PAID",
        paid_at: "2026-11-01T08:00:00Z",
        method: "Tap",
      },
    });
    expect(text(paid.host)).toContain("Paid");
    expect(button("Same invoice with Ecom", paid.host)).toBeUndefined();
    await clear(paid.root);
  });

  test("an Ecom invoice offers both backups until one copy is asked for", async () => {
    const l = await list([ecomUnpaid], { "ecom-unpaid": unpaid });
    expect(button("Same invoice with Whop", l.host)).toBeTruthy();
    await click(button("Same invoice with Tap", l.host));
    expect(l.redos).toEqual([["ecom-unpaid", "tap"]]);
    await clear(l.root);
    const copy = { ...tapUnpaid, requested_at: "2026-10-31T09:00:00Z" };
    const after = await list([copy, ecomUnpaid], { "ecom-unpaid": unpaid });
    const [tapRow, ecomRow] = [...after.host.querySelectorAll("li")] as any[];
    // The Ecom row says the copy is made and offers nothing more.
    expect(button("Same invoice with Whop", ecomRow)).toBeUndefined();
    expect(button("Same invoice with Tap", ecomRow)).toBeUndefined();
    const note = [...ecomRow.querySelectorAll("span")].find(
      (s: any) => text(s) === "Tap copy made",
    ) as any;
    expect(note.getAttribute("title")).toContain(
      "The same invoice with a Tap link is INV-2026-032.",
    );
    // The Tap copy offers the one link not tried yet, never Ecom again.
    expect(button("Same invoice with Whop", tapRow)).toBeTruthy();
    expect(button("Same invoice with Ecom", tapRow)).toBeUndefined();
    await clear(after.root);
  });

  test("the page asks for Ecom and Tap payments, switches with the saved email, and refills Tap with it", async () => {
    // A Tap invoice for another amount: its email is the client's saved one,
    // and Tap is still untried for the Ecom invoice's amount.
    seed([
      { ...tapUnpaid, amount_usd: 1700 },
      ecomUnpaid,
      { ...failedEcom, client_email: "owner@example-clinic.com" },
    ]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    expect(rpcCalls.filter(c => c.name === "cockpit_invoice_payments")).toEqual(
      [
        {
          name: "cockpit_invoice_payments",
          args: { p_ids: ["tap-unpaid", "ecom-unpaid"] },
        },
      ],
    );
    await click(button("Use a Tap link instead", p.host));
    expect(rpcCalls.find(c => c.name === "cockpit_invoice_change")).toEqual({
      name: "cockpit_invoice_change",
      args: { p_id: "ecom-failed", p_action: "tap" },
    });
    expect(toasts).toContain("Sent back to be issued with a Tap link");
    toasts.length = 0;
    await click(buttons("Same invoice with Tap", p.host)[0]);
    expect(button("Tap link (KWD)", p.host).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // The Ecom invoice had no email; the client's saved one from another invoice fills in.
    expect(p.host.querySelector("#inv-email").value).toBe(
      "owner@example-clinic.com",
    );
    expect(toasts[0]).toBe(
      "The form has the same invoice with a Tap link. Check it and the client's email and issue it, then send the client the new link. The old Ecom link stays payable until it expires.",
    );
    await clear(p.root);
  });

  test("switching with a typed email sends it in lower case", async () => {
    seed([failedEcom]);
    const p = await draw(createElement(InvoicesPage, { embedded: true }));
    await click(button("Use a Tap link instead", p.host));
    await type(
      p.host.querySelector("#tap-email-ecom-failed"),
      "Owner@Example-Clinic.com",
    );
    await click(button("Use the Tap link", p.host));
    expect(rpcCalls.find(c => c.name === "cockpit_invoice_change")).toEqual({
      name: "cockpit_invoice_change",
      args: {
        p_id: "ecom-failed",
        p_action: "tap",
        p_email: "owner@example-clinic.com",
      },
    });
    await clear(p.root);
  });
});

describe("backups count copies of the same charge only (review 2026-11-05)", () => {
  test("last month's invoice for the same amount does not use up a backup", () => {
    const lastMonthWhop = row({
      id: "oct-whop",
      checkout_source: "whop",
      whop_plan_id: "plan_Example999",
      checkout_url: "https://whop.com/checkout/plan_Example999",
      period: "Days 1-30",
      requested_at: "2026-09-30T09:00:00Z",
    });
    const oldSameWords = {
      ...lastMonthWhop,
      id: "sep-whop",
      period: "Days 31-60",
      requested_at: "2026-09-01T09:00:00Z",
    };
    expect(
      lib.redoTargets(ecomUnpaid, unpaid, [
        ecomUnpaid,
        lastMonthWhop,
        oldSameWords,
      ]),
    ).toEqual(["whop", "tap"]);
    expect(lib.copyOf(ecomUnpaid, [lastMonthWhop, oldSameWords])).toBeNull();
  });

  test("a failed Tap copy of a live Ecom invoice offers Whop, never a second Ecom link", () => {
    const tapCopyFailed = row({
      id: "tap-copy-failed",
      status: "failed",
      invoice_no: null,
      drive_url: null,
      issued_at: null,
      checkout_source: "tap",
      client_email: "owner@example-clinic.com",
      requested_at: "2026-10-31T09:00:00Z",
    });
    expect(
      lib.switchTargets(tapCopyFailed, [tapCopyFailed, ecomUnpaid]),
    ).toEqual(["whop"]);
    // On its own (no live Ecom link for this charge) both others stay.
    expect(lib.switchTargets(tapCopyFailed, [tapCopyFailed])).toEqual([
      "ecom",
      "whop",
    ]);
  });

  test("the copy note stays when every backup was tried", async () => {
    const whopCopy = { ...issuedWhop, requested_at: "2026-10-31T09:00:00Z" };
    const tapCopy = row({
      id: "tap-copy",
      checkout_source: "tap",
      tap_invoice_id: "inv_Example654321",
      checkout_url: "https://invoices.tap.company/invoice/inv_Example654321",
      requested_at: "2026-11-01T09:00:00Z",
    });
    const l = await list([tapCopy, whopCopy, ecomUnpaid], {
      "ecom-unpaid": unpaid,
    });
    expect(buttons("Same invoice with Whop", l.host)).toHaveLength(0);
    expect(text(l.host)).toContain("copy made");
    await clear(l.root);
  });
});
