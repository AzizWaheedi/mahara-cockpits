import { describe, expect, it } from "bun:test";
import { makeHandler, sameSecret } from "./door";
import { check, createBody, normalizeStatus, readCreate, Refused, summarize, tapReason } from "./tap";

const ID = "8f451d80-b3bd-4bd5-b912-b1dc37aa7a71";
const good = {
  invoiceId: ID,
  number: "INV-2026-031",
  clientName: "North Gulf Interiors",
  clientEmail: " Owner@NorthGulf.com ",
  description: "90-day agreement",
  amountKwd: "460.500",
  amountUsd: "1500",
  dueDate: "2026-11-12",
};
const tapInvoice = (over: Record<string, unknown> = {}) => ({
  id: "inv_ecJq1311012951z527261",
  url: "https://invoices.tap.company/invoice/inv_ecJq1311012951z527261",
  status: "CREATED",
  amount: 460.5,
  currency: "KWD",
  live_mode: true,
  updated: 1793883724261,
  metadata: { cockpit_invoice: ID },
  ...over,
});

describe("the create request", () => {
  it("reads and cleans the worker's fields", () => {
    const input = readCreate(good);
    expect(input.clientEmail).toBe("owner@northgulf.com");
    expect(input.amountKwd).toBe("460.500");
  });
  it("refuses what Tap must never get", () => {
    expect(() => readCreate({ ...good, invoiceId: "x" })).toThrow(Refused);
    expect(() => readCreate({ ...good, clientEmail: "nobody" })).toThrow("clientEmail");
    expect(() => readCreate({ ...good, amountKwd: "460.5" })).toThrow("amountKwd");
    expect(() => readCreate({ ...good, amountKwd: "0.050" })).toThrow("at least 0.100");
    expect(() => readCreate({ ...good, number: "INV-PREVIEW" })).toThrow("number");
    expect(() => readCreate({ ...good, dueDate: "12/11/2026" })).toThrow("dueDate");
  });
  it("turns Tap's messages off and tags the invoice for find-before-create", () => {
    const body = createBody(readCreate(good), Date.parse("2026-11-05T10:00:00Z")) as Record<string, any>;
    expect(body.notifications).toEqual({ channels: ["EMAIL"], dispatch: false });
    expect(body.charge).toEqual({ receipt: { email: false, sms: false } });
    expect(body.metadata).toEqual({ cockpit_invoice: ID, invoice_no: "INV-2026-031" });
    expect(body.reference).toEqual({ invoice: "INV-2026-031", order: ID });
    expect(body.order.amount).toBe(460.5);
    expect(body.order.items[0]).toMatchObject({ name: "90-day agreement", amount: 460.5, currency: "KWD", quantity: 1 });
    expect(body.currencies).toEqual(["KWD"]);
    // Due at the end of 12 Nov in Kuwait (20:59:59 UTC), payable 15 days more.
    expect(new Date(body.due).toISOString()).toBe("2026-11-12T20:59:59.000Z");
    expect(body.expiry - body.due).toBe(15 * 86_400_000);
  });
  it("moves a past due date to a day from now (an invoice for an old payment)", () => {
    const now = Date.parse("2026-11-05T10:00:00Z");
    const body = createBody(readCreate({ ...good, dueDate: "2026-10-01" }), now) as Record<string, any>;
    expect(body.due).toBe(now + 86_400_000);
  });
});

describe("what Tap answers", () => {
  it("summarizes and checks a live invoice", () => {
    const s = summarize(tapInvoice());
    expect(s).toMatchObject({ id: "inv_ecJq1311012951z527261", status: "UNPAID", tapStatus: "CREATED", live: true, cockpitInvoice: ID, paidAt: null });
    expect(check(s, { invoiceId: ID, amountKwd: "460.500", live: true })).toBe(s);
  });
  it("never accepts a sandbox page, another amount or another invoice", () => {
    const sandbox = summarize(tapInvoice({ live_mode: false, url: "https://invoices.sandbox.tap.company/invoice/inv_ecJq1311012951z527261" }));
    expect(() => check(sandbox, { invoiceId: ID, amountKwd: "460.500", live: true })).toThrow("a test");
    expect(() => check(summarize(tapInvoice({ amount: 460.4 })), { invoiceId: ID, amountKwd: "460.500", live: true })).toThrow("not KWD 460.500");
    expect(() => check(summarize(tapInvoice({ currency: "USD" })), { invoiceId: ID, amountKwd: "460.500", live: true })).toThrow("USD");
    expect(() => check(summarize(tapInvoice({ metadata: {} })), { invoiceId: ID, amountKwd: "460.500", live: true })).toThrow("another cockpit invoice");
    expect(() => check(summarize(tapInvoice({ status: "CANCELLED" })), { invoiceId: ID, amountKwd: "460.500", live: true })).toThrow("cancelled");
    expect(() => summarize(tapInvoice({ url: "https://evil.example.com/tap.company/x" }))).toThrow("payment page");
    expect(() => summarize(tapInvoice({ id: "chg_1" }))).toThrow("invoice id");
  });
  it("maps Tap's statuses and dates the payment", () => {
    expect(normalizeStatus("PAID")).toBe("PAID");
    expect(normalizeStatus("canceled")).toBe("CANCELLED");
    expect(normalizeStatus("EXPIRED")).toBe("EXPIRED");
    expect(normalizeStatus("IN_PROGRESS")).toBe("UNPAID");
    expect(summarize(tapInvoice({ status: "PAID" })).paidAt).toBe(new Date(1793883724261).toISOString());
  });
  it("keeps keys out of Tap's error text", () => {
    expect(tapReason(400, JSON.stringify({ errors: [{ code: "1108", description: "Invalid item name" }] }))).toBe("HTTP 400: 1108 Invalid item name");
    expect(tapReason(401, "bad sk_live_abcdefgh1234 key")).toBe("HTTP 401: bad [key] key");
  });
});

// ---- the doors, with a fake Tap and a fake database --------------------------------
type Call = { url: string; method: string; body: any };
function fakeDeps(opts: { key?: string; tap?: (c: Call) => { status: number; body: unknown }; rest?: (c: Call) => unknown } = {}) {
  const calls: Call[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "https://db.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET: "cron-secret",
    TAP_SECRET_KEY: opts.key ?? "sk_live_ABCDEFGH12345678",
  };
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (url.startsWith("https://api.tap.company/")) {
      const r = opts.tap ? opts.tap(call) : { status: 500, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    const r = opts.rest ? opts.rest(call) : [];
    return new Response(JSON.stringify(r ?? null), { status: 200 });
  }) as typeof fetch;
  return { deps: { env: (n: string) => env[n], fetch: fakeFetch, now: () => Date.parse("2026-11-05T10:00:00Z") }, calls };
}
const post = (body: unknown, headers: Record<string, string>) =>
  new Request("https://fn.example/invoice-tap", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("the doors", () => {
  it("lets only the exact service key or the cron secret in", async () => {
    const { deps } = fakeDeps();
    const h = makeHandler(deps);
    expect((await h(post({ op: "doctor" }, {}))).status).toBe(403);
    expect((await h(post({ op: "doctor" }, { Authorization: "Bearer anon-or-user-token" }))).status).toBe(403);
    // A forged token that claims the service role is still refused.
    const forged = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;
    expect((await h(post({ op: "doctor" }, { Authorization: `Bearer ${forged}` }))).status).toBe(403);
    expect((await h(post({ op: "sync" }, { "x-cron-secret": "wrong" }))).status).toBe(401);
    expect((await h(post({ op: "create" }, { "x-cron-secret": "cron-secret" }))).status).toBe(403);
    expect(sameSecret("", "")).toBe(false);
  });
  it("refuses to make a link without a live key", async () => {
    const { deps } = fakeDeps({ key: "sk_test_ABCDEFGH12345678" });
    const res = await makeHandler(deps)(post({ op: "create", ...good }, { Authorization: "Bearer service-key" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toContain("not a live Tap key");
  });
  it("creates, checks and records the Tap call in the desk ledger", async () => {
    const { deps, calls } = fakeDeps({ tap: () => ({ status: 200, body: tapInvoice() }) });
    const res = await makeHandler(deps)(post({ op: "create", ...good }, { Authorization: "Bearer service-key" }));
    const out = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(out.invoice).toMatchObject({ id: "inv_ecJq1311012951z527261", status: "UNPAID", live: true });
    expect(JSON.stringify(out)).not.toContain("northgulf");
    const tapCall = calls.find(c => c.url === "https://api.tap.company/v2/invoices/")!;
    expect(tapCall.body.customer.email).toBe("owner@northgulf.com");
    const ledger = calls.find(c => c.url.endsWith("/rest/v1/cockpit_invoice_desk_health"))!;
    expect(ledger.body).toEqual([{ invoice_id: ID, provider: "tap", method: "POST", resource: "invoices", http_status: 200, ok: true, detail: null }]);
  });
  it("says Tap refused, without retrying, on a 400", async () => {
    const { deps } = fakeDeps({ tap: () => ({ status: 400, body: { errors: [{ code: "1108", description: "Invalid item name" }] } }) });
    const res = await makeHandler(deps)(post({ op: "create", ...good }, { Authorization: "Bearer service-key" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any)).toMatchObject({ refused: true, error: "Tap HTTP 400: 1108 Invalid item name" });
  });
  it("finds the invoice across pages and refuses two for one cockpit invoice", async () => {
    let page = 0;
    const { deps } = fakeDeps({
      tap: c => {
        page += 1;
        if (!c.body.starting_after) return { status: 200, body: { invoices: [tapInvoice({ id: "inv_other111111", metadata: { cockpit_invoice: "x" } })], has_more: true } };
        return { status: 200, body: { invoices: [tapInvoice()], has_more: false } };
      },
    });
    const res = await makeHandler(deps)(post({ op: "find", invoiceId: ID }, { Authorization: "Bearer service-key" }));
    expect(((await res.json()) as any).invoice.id).toBe("inv_ecJq1311012951z527261");
    expect(page).toBe(2);
    const twice = fakeDeps({ tap: () => ({ status: 200, body: { invoices: [tapInvoice(), tapInvoice({ id: "inv_second22222" })], has_more: false } }) });
    const res2 = await makeHandler(twice.deps)(post({ op: "find", invoiceId: ID }, { Authorization: "Bearer service-key" }));
    expect(res2.status).toBe(409);
    // A copy cancelled in Tap no longer counts: the open one is the link.
    const cancelled = fakeDeps({ tap: () => ({ status: 200, body: { invoices: [tapInvoice({ id: "inv_second22222", status: "CANCELLED" }), tapInvoice()], has_more: false } }) });
    const res3 = await makeHandler(cancelled.deps)(post({ op: "find", invoiceId: ID }, { Authorization: "Bearer service-key" }));
    expect(((await res3.json()) as any).invoice.id).toBe("inv_ecJq1311012951z527261");
    // Only expired copies: nothing to reuse, so the worker may make a new one.
    const expired = fakeDeps({ tap: () => ({ status: 200, body: { invoices: [tapInvoice({ status: "EXPIRED" })], has_more: false } }) });
    const res4 = await makeHandler(expired.deps)(post({ op: "find", invoiceId: ID }, { Authorization: "Bearer service-key" }));
    expect(((await res4.json()) as any).invoice).toBeNull();
  });
  it("syncs only open invoices and calls Tap not at all when none are open", async () => {
    const none = fakeDeps({ rest: c => (c.url.includes("cockpit_invoices?") ? [] : null) });
    const out = (await (await makeHandler(none.deps)(post({ op: "sync" }, { "x-cron-secret": "cron-secret" }))).json()) as any;
    expect(out).toEqual({ ok: true, read: 0 });
    expect(none.calls.some(c => c.url.startsWith("https://api.tap.company"))).toBe(false);

    const some = fakeDeps({
      tap: () => ({ status: 200, body: tapInvoice({ status: "PAID" }) }),
      rest: c => {
        if (c.url.includes("cockpit_invoices?")) return [{ id: ID, tap_invoice_id: "inv_ecJq1311012951z527261" }, { id: "9f451d80-b3bd-4bd5-b912-b1dc37aa7a72", tap_invoice_id: "inv_paidAlready1" }];
        if (c.url.includes("cockpit_tap_invoices?")) return [{ id: "inv_paidAlready1", status: "PAID", synced_at: "2026-11-05T09:00:00Z" }];
        return null;
      },
    });
    const res = (await (await makeHandler(some.deps)(post({ op: "sync" }, { "x-cron-secret": "cron-secret" }))).json()) as any;
    expect(res).toMatchObject({ ok: true, read: 1, paid: 1 });
    expect(some.calls.filter(c => c.url.startsWith("https://api.tap.company")).map(c => c.url)).toEqual(["https://api.tap.company/v2/invoices/inv_ecJq1311012951z527261"]);
    const rpc = some.calls.find(c => c.url.endsWith("/rpc/cockpit_tap_invoice_sync"))!;
    expect(rpc.body.p_rows[0]).toMatchObject({ id: "inv_ecJq1311012951z527261", cockpitInvoiceId: ID, status: "PAID", tapStatus: "PAID" });
  });
});

describe("the sync's turn order", () => {
  it("skips expired invoices and reads the never-read and least recently read first, 40 at a time", async () => {
    const invoices = Array.from({ length: 45 }, (_, n) => ({
      id: `9f451d80-b3bd-4bd5-b912-${String(n).padStart(12, "0")}`,
      tap_invoice_id: `inv_Open${String(n).padStart(8, "0")}`,
    }));
    const known = [
      { id: "inv_Open00000000", status: "EXPIRED", synced_at: "2026-11-05T09:00:00Z" },
      { id: "inv_Open00000001", status: "UNPAID", synced_at: "2026-11-05T09:00:00Z" },
      { id: "inv_Open00000002", status: "UNPAID", synced_at: "2026-11-01T09:00:00Z" },
    ];
    const read: string[] = [];
    const { deps } = fakeDeps({
      tap: c => {
        const id = c.url.split("/").pop() as string;
        read.push(id);
        const n = invoices.find(i => i.tap_invoice_id === id)!;
        return { status: 200, body: tapInvoice({ id, metadata: { cockpit_invoice: n.id } }) };
      },
      rest: c => (c.url.includes("cockpit_invoices?") ? invoices : c.url.includes("cockpit_tap_invoices?") ? known : null),
    });
    const out = (await (await makeHandler(deps)(post({ op: "sync" }, { "x-cron-secret": "cron-secret" }))).json()) as any;
    expect(out.read).toBe(40);
    expect(read).not.toContain("inv_Open00000000");
    // The 42 never read go first (40 this run, 2 next), then the read longest ago.
    expect(read[0]).toBe("inv_Open00000003");
    expect(read).not.toContain("inv_Open00000001");
    expect(read).not.toContain("inv_Open00000002");
    expect(read).not.toContain("inv_Open00000043");
  });
});
