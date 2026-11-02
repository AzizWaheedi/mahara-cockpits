import { api } from "./api";
import type { InvoiceKind, InvoicePayment } from "./invoiceTemplate";
import { supabase } from "./supabase";

/**
 * Invoices from the sales cockpit (Aziz, 2026-10-29: "the same invoices
 * section ... that the CSM has for the deposit ... If the ecom link doesn't
 * work, they can generate a WHOP link as well").
 *
 * The same invoice desk as the client success cockpit: the page reads the
 * invoices, the billing sheet's clients and the worker's heartbeat; it asks
 * through sales-api (invoice.request, invoice.change), which carries the
 * rep's own sign-in to cockpit_invoice_request and cockpit_invoice_change.
 * The invoice worker on the VPS numbers it, makes the Ecom or Whop link,
 * prints the PDF, files it in the client's Drive folder and adds it to the
 * register. The template and the preview are the CSM's own files
 * (scripts/check-shared.sh keeps them the same).
 */

export type InvoiceStatus =
  | "queued"
  | "rendering"
  | "issued"
  | "failed"
  | "cancelled";

export type LinkSource = "pasted" | "whop" | "ecom";

export type InvoiceRow = {
  id: string;
  clickup_task_id: string;
  client_name: string;
  kind: InvoiceKind;
  amount_usd: number;
  description: string;
  line_note: string | null;
  client_detail: string | null;
  client_tax_id: string | null;
  period: string | null;
  pay_note: string | null;
  issue_date: string;
  due_date: string | null;
  payments: InvoicePayment[];
  checkout_source: LinkSource;
  checkout_url: string | null;
  whop_plan_id: string | null;
  ecom_invoice_id: string | null;
  amount_kwd: number | null;
  status: InvoiceStatus;
  invoice_no: string | null;
  drive_url: string | null;
  error: string | null;
  attempts: number;
  requested_by: string;
  requested_at: string;
  issued_at: string | null;
};

/** What Ecom says about an invoice's link: PAID, UNPAID, EXPIRED or DELETED. */
export type PaymentState = {
  status: string;
  paid_at: string | null;
  method: string | null;
};

export type InvoiceClient = {
  taskId: string;
  name: string;
  country: string | null;
  plan: string | null;
  status: string | null;
  nextUsd: number | null;
  nextDate: string | null;
};

export type DeskStatus = {
  beatAt: string;
  ok: boolean;
  detail: string | null;
} | null;

export type InvoiceRequest = {
  taskId: string;
  kind: InvoiceKind;
  amount: string;
  description: string;
  lineNote?: string;
  clientDetail?: string;
  taxId?: string;
  period?: string;
  payNote?: string;
  dueDate?: string;
  checkoutUrl?: string;
  /** "Pay online": the invoice worker makes the link. */
  createLink?: boolean;
  /** Which link the worker makes: Ecom (KNET and cards, in KWD) or Whop (cards, in USD). */
  provider?: "ecom" | "whop";
  payments?: { date: string; method: string; amount: string; ref?: string }[];
};

export type InvoicesData = {
  invoices: InvoiceRow[];
  clients: InvoiceClient[];
  desk: DeskStatus;
  paid: Record<string, PaymentState>;
};

const COLUMNS =
  "id,clickup_task_id,client_name,kind,amount_usd,description,line_note,client_detail,client_tax_id,period,pay_note,issue_date,due_date,payments,checkout_source,checkout_url,whop_plan_id,ecom_invoice_id,amount_kwd,status,invoice_no,drive_url,error,attempts,requested_by,requested_at,issued_at";

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "The database did not answer.");
}

export async function fetchInvoices(): Promise<InvoicesData> {
  const [inv, acc, desk] = await Promise.all([
    supabase
      .from("cockpit_invoices")
      .select(COLUMNS)
      .order("requested_at", { ascending: false })
      .limit(80),
    supabase
      .from("cockpit_billing_accounts")
      .select(
        "clickup_task_id,client_name,country,payment_plan,client_status,next_payment_usd,next_payment_date",
      )
      .order("client_name"),
    supabase
      .from("cockpit_invoice_desk_status")
      .select("beat_at,ok,detail")
      .maybeSingle(),
  ]);
  fail(inv.error);
  fail(acc.error);
  fail(desk.error);
  const invoices: InvoiceRow[] = (inv.data ?? []).map(r => ({
    ...(r as unknown as InvoiceRow),
    amount_usd: Number(r.amount_usd),
    payments: Array.isArray(r.payments) ? r.payments : [],
  }));
  // Whether each Ecom link was paid (cockpit_ecom_invoices is finance-only).
  const paid: Record<string, PaymentState> = {};
  const ecomIds = invoices
    .filter(i => i.checkout_source === "ecom" && i.status === "issued")
    .map(i => i.id);
  if (ecomIds.length) {
    const p = await supabase.rpc("cockpit_invoice_payments", {
      p_ids: ecomIds,
    });
    fail(p.error);
    for (const x of (Array.isArray(p.data) ? p.data : []) as Record<
      string,
      unknown
    >[])
      if (typeof x.id === "string")
        paid[x.id] = {
          status: String(x.status ?? ""),
          paid_at: typeof x.paid_at === "string" ? x.paid_at : null,
          method: typeof x.method === "string" ? x.method : null,
        };
  }
  return {
    invoices,
    clients: (acc.data ?? [])
      .map(r => ({
        taskId: String(r.clickup_task_id),
        name: String(r.client_name ?? "").trim(),
        country: r.country ? String(r.country) : null,
        plan: r.payment_plan ? String(r.payment_plan) : null,
        status: r.client_status ? String(r.client_status) : null,
        nextUsd:
          r.next_payment_usd === null ? null : Number(r.next_payment_usd),
        nextDate: r.next_payment_date ? String(r.next_payment_date) : null,
      }))
      .filter(c => c.name),
    desk: desk.data
      ? {
          beatAt: String(desk.data.beat_at),
          ok: Boolean(desk.data.ok),
          detail: desk.data.detail ? String(desk.data.detail) : null,
        }
      : null,
    paid,
  };
}

export async function requestInvoice(
  args: InvoiceRequest,
): Promise<InvoiceRow> {
  const out = await api<{ invoice: InvoiceRow }>("invoice.request", { args });
  return out.invoice;
}

export async function changeInvoice(
  id: string,
  change: "cancel" | "retry" | "whop",
): Promise<InvoiceRow> {
  const out = await api<{ invoice: InvoiceRow }>("invoice.change", {
    id,
    change,
  });
  return out.invoice;
}

/** Today in Kuwait, as the database counts it for payment dates. */
export function kuwaitToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A Kuwait date some days after another, as YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Cents from a typed dollar amount, or null when it is not one. */
export function cents(typed: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/**
 * A plain sentence when the worker is missing, quiet or unwell; null when it
 * checked in during the last five minutes and its checks passed.
 */
export function deskProblem(desk: DeskStatus, now = Date.now()): string | null {
  if (!desk)
    return "The invoice worker has not started yet. Invoices you ask for wait in the list until it does. Tell Muhammed.";
  const quiet = Math.round((now - Date.parse(desk.beatAt)) / 60000);
  if (!desk.ok)
    return (
      desk.detail ?? "The invoice worker reported a problem. Tell Muhammed."
    );
  if (quiet > 5)
    return `The invoice worker last checked in ${quiet} minutes ago. Invoices wait in the list until it is back. Tell Muhammed.`;
  return null;
}

/** Can this failed invoice go out again with a Whop link (cockpit_invoice_change 'whop')? */
export function canSwitchToWhop(i: InvoiceRow): boolean {
  return (
    i.status === "failed" &&
    i.kind === "checkout" &&
    i.checkout_source === "ecom" &&
    !i.ecom_invoice_id &&
    !i.checkout_url
  );
}

/** Paid, waiting or expired, from Ecom; null when there is nothing to say. */
export function paymentWord(
  i: InvoiceRow,
  p: PaymentState | undefined,
): { text: string; tone: "good" | "warning" | "neutral" } | null {
  if (i.kind === "paid" && i.status === "issued")
    return { text: "Paid", tone: "good" };
  if (i.kind !== "checkout" || i.status !== "issued") return null;
  if (i.checkout_source !== "ecom")
    return { text: "Payment shows in Whop", tone: "neutral" };
  const s = p?.status?.toUpperCase();
  if (s === "PAID") return { text: "Paid", tone: "good" };
  if (s === "EXPIRED") return { text: "Link expired", tone: "warning" };
  if (s === "DELETED") return { text: "Link deleted", tone: "warning" };
  return { text: "Not paid yet", tone: "neutral" };
}
