/**
 * Invoices in the harness: billing sheet clients, a few invoices in each
 * state (ready with Ecom paid and unpaid, a failed Ecom one that can switch
 * to Whop, one being made) and the invoice worker's heartbeat.
 * /sales/harness.html?path=/invoices
 */
type Row = Record<string, unknown>;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (ms: number) => iso(ms).slice(0, 10);
const D = 86_400_000;

export const BILLING: Row[] = [
  {
    clickup_task_id: "86eexample1",
    client_name: "Alalia.co",
    country: "Kuwait",
    payment_plan: "90-day",
    client_status: "Onboarding",
    next_payment_usd: 3500,
    next_payment_date: dayOf(now + 5 * D),
  },
  {
    clickup_task_id: "86eexample2",
    client_name: "Makers",
    country: "Saudi Arabia",
    payment_plan: "Monthly",
    client_status: "Active",
    next_payment_usd: 2500,
    next_payment_date: dayOf(now + 12 * D),
  },
  {
    clickup_task_id: "86eexample3",
    client_name: "شركة الريم للتصميم",
    country: "UAE",
    payment_plan: null,
    client_status: "Onboarding",
    next_payment_usd: null,
    next_payment_date: null,
  },
  {
    clickup_task_id: "86eexample4",
    client_name: "North Gulf Interiors",
    country: "Kuwait",
    payment_plan: "Monthly",
    client_status: "Active",
    next_payment_usd: 1800,
    next_payment_date: dayOf(now + 2 * D),
  },
];

const base = (over: Row): Row => ({
  line_note: null,
  client_detail: "Kuwait",
  client_tax_id: null,
  period: null,
  pay_note: null,
  issue_date: dayOf(now),
  payments: [],
  whop_plan_id: null,
  ecom_invoice_id: null,
  amount_kwd: null,
  drive_url: null,
  error: null,
  attempts: 0,
  requested_by: "aziz@maharamedia.com",
  issued_at: null,
  checkout_url: null,
  ...over,
});

export const INVOICES: Row[] = [
  base({
    id: "11111111-1111-4111-8111-111111111111",
    clickup_task_id: "86eexample1",
    client_name: "Alalia.co",
    kind: "checkout",
    amount_usd: 3500,
    description: "90-day agreement",
    due_date: dayOf(now + 3 * D),
    checkout_source: "ecom",
    ecom_invoice_id: "INV_abcdef123",
    amount_kwd: 1072.5,
    checkout_url: "https://invoice.ecom.io/abc",
    status: "issued",
    invoice_no: "INV-2026-027",
    drive_url: "https://drive.google.com/file/d/x/view",
    requested_at: iso(now - 2 * 3_600_000),
    issued_at: iso(now - 2 * 3_600_000),
  }),
  base({
    id: "22222222-2222-4222-8222-222222222222",
    clickup_task_id: "86eexample1",
    client_name: "Alalia.co",
    kind: "paid",
    amount_usd: 2500,
    description: "Deposit + first payment",
    due_date: null,
    checkout_source: "pasted",
    payments: [
      {
        date: dayOf(now - D),
        method: "Bank transfer",
        amount: "2500.00",
        ref: null,
      },
    ],
    status: "issued",
    invoice_no: "INV-2026-026",
    drive_url: "https://drive.google.com/file/d/y/view",
    requested_at: iso(now - 3 * 3_600_000),
  }),
  base({
    id: "33333333-3333-4333-8333-333333333333",
    clickup_task_id: "86eexample2",
    client_name: "Makers",
    kind: "checkout",
    amount_usd: 2500,
    description: "Deposit",
    due_date: dayOf(now + 3 * D),
    checkout_source: "ecom",
    status: "failed",
    error:
      "Ecom refused the link: the merchant account is under review. Tell Muhammed; do not make a second payment link.",
    requested_at: iso(now - 40 * 60_000),
  }),
  base({
    id: "44444444-4444-4444-8444-444444444444",
    clickup_task_id: "86eexample4",
    client_name: "North Gulf Interiors",
    kind: "checkout",
    amount_usd: 1800,
    description: "First payment",
    due_date: dayOf(now + 3 * D),
    checkout_source: "whop",
    status: "rendering",
    requested_at: iso(now - 60_000),
  }),
  base({
    id: "55555555-5555-4555-8555-555555555555",
    clickup_task_id: "86eexample4",
    client_name: "North Gulf Interiors",
    kind: "checkout",
    amount_usd: 1800,
    description: "Deposit",
    due_date: dayOf(now - 2 * D),
    checkout_source: "ecom",
    ecom_invoice_id: "INV_paid9999",
    amount_kwd: 551.6,
    checkout_url: "https://invoice.ecom.io/paid",
    status: "issued",
    invoice_no: "INV-2026-024",
    drive_url: "https://drive.google.com/file/d/z/view",
    requested_at: iso(now - 5 * D),
  }),
];

export const DESK: Row[] = [
  { beat_at: iso(now - 30_000), ok: true, detail: null },
];

export function payments(ids: string[]): Row[] {
  return ids.flatMap((id): Row[] =>
    id.startsWith("1111")
      ? [{ id, status: "UNPAID", paid_at: null, method: null }]
      : id.startsWith("5555")
        ? [{ id, status: "PAID", paid_at: iso(now - 4 * D), method: "KNET" }]
        : [],
  );
}
