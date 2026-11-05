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
 * The invoice worker on the VPS numbers it, makes the Ecom, Whop or Tap link,
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

export type LinkSource = "pasted" | "whop" | "ecom" | "tap";

/**
 * The links the invoice worker makes: Ecom (KNET and cards, in KWD) is the
 * main one; Whop (cards, in USD) and Tap (KNET and cards, in KWD) are the
 * backups when Ecom does not work for the client (Aziz, 2026-11-05).
 */
export type MadeLink = "ecom" | "whop" | "tap";
export const MADE_LINKS: MadeLink[] = ["ecom", "whop", "tap"];
export const LINK_NAME: Record<MadeLink, string> = {
  ecom: "Ecom",
  whop: "Whop",
  tap: "Tap",
};
/** "an Ecom link", "a Whop link", "a Tap link". */
export const aLink = (m: MadeLink) =>
  `${m === "ecom" ? "an" : "a"} ${LINK_NAME[m]} link`;
export const isMadeLink = (v: unknown): v is MadeLink =>
  v === "ecom" || v === "whop" || v === "tap";
export type LinkMode = MadeLink | "paste";

/** The rule the database checks on a client email (cockpit_invoices_client_email_check). */
export const CLIENT_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/;
export const emailOk = (typed: string) => {
  const e = typed.trim().toLowerCase();
  return e.length <= 254 && CLIENT_EMAIL.test(e);
};

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
  tap_invoice_id?: string | null;
  /** Asked for with a Tap link: Tap shows it on its page and sends nothing. */
  client_email?: string | null;
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

/** What Ecom or Tap says about an invoice's link: PAID, UNPAID, EXPIRED, DELETED or CANCELLED. */
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
  /** Which link the worker makes: Ecom (the main one), Whop or Tap. */
  provider?: MadeLink;
  /** Tap only: the client's email, which Tap needs. */
  clientEmail?: string;
  payments?: { date: string; method: string; amount: string; ref?: string }[];
};

export type InvoicesData = {
  invoices: InvoiceRow[];
  clients: InvoiceClient[];
  desk: DeskStatus;
  paid: Record<string, PaymentState>;
};

const COLUMNS =
  "id,clickup_task_id,client_name,kind,amount_usd,description,line_note,client_detail,client_tax_id,period,pay_note,issue_date,due_date,payments,checkout_source,checkout_url,whop_plan_id,ecom_invoice_id,tap_invoice_id,client_email,amount_kwd,status,invoice_no,drive_url,error,attempts,requested_by,requested_at,issued_at";

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
  // Whether each Ecom or Tap link was paid (their tables are not for seats).
  const paid: Record<string, PaymentState> = {};
  const ecomIds = invoices
    .filter(i => watched(i) && i.status === "issued")
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

export type InvoiceChange = "cancel" | "retry" | MadeLink;

export async function changeInvoice(
  id: string,
  change: InvoiceChange,
  email?: string,
): Promise<InvoiceRow> {
  const out = await api<{ invoice: InvoiceRow }>("invoice.change", {
    id,
    change,
    ...(email ? { email: email.trim().toLowerCase() } : {}),
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

/** Ecom and Tap answer for their links' payments; Whop and pasted links are not followed. */
export const watched = (i: InvoiceRow) =>
  i.checkout_source === "ecom" || i.checkout_source === "tap";

/**
 * The other links a failed Pay online invoice can go out with
 * (cockpit_invoice_change 'ecom' | 'whop' | 'tap'): only while no link was
 * ever made for it, so a client never holds two.
 */
/**
 * The other invoices for the same charge as this one: the same client,
 * amount, description and period, asked for within two weeks of it, not
 * cancelled. "Same invoice with ..." copies exactly those fields, so a copy
 * and its original are one charge; last month's invoice for the same amount
 * is not (review 2026-11-05).
 */
export function sameCharge(i: InvoiceRow, all: InvoiceRow[]): InvoiceRow[] {
  const at = Date.parse(i.requested_at);
  return all.filter(
    c =>
      c.id !== i.id &&
      c.kind === "checkout" &&
      c.status !== "cancelled" &&
      c.clickup_task_id === i.clickup_task_id &&
      Number(c.amount_usd) === Number(i.amount_usd) &&
      c.description.trim() === i.description.trim() &&
      (c.period ?? "").trim() === (i.period ?? "").trim() &&
      Math.abs(Date.parse(c.requested_at) - at) <= 14 * 86_400_000,
  );
}

export function switchTargets(
  i: InvoiceRow,
  all: InvoiceRow[] = [],
): MadeLink[] {
  if (
    i.status !== "failed" ||
    i.kind !== "checkout" ||
    !isMadeLink(i.checkout_source) ||
    i.checkout_url ||
    i.ecom_invoice_id ||
    i.whop_plan_id ||
    i.tap_invoice_id
  )
    return [];
  // A processor another invoice for this charge already uses is left out:
  // the client may hold its link, so a second one would be a second bill.
  const used = new Set(sameCharge(i, all).map(c => c.checkout_source));
  return MADE_LINKS.filter(m => m !== i.checkout_source && !used.has(m));
}

/** Can this failed invoice go out again with a Whop link (cockpit_invoice_change 'whop')? */
export function canSwitchToWhop(i: InvoiceRow): boolean {
  return switchTargets(i).includes("whop");
}

/** Paid, waiting or expired, from Ecom or Tap; null when there is nothing to say. */
export function paymentWord(
  i: InvoiceRow,
  p: PaymentState | undefined,
): { text: string; tone: "good" | "warning" | "neutral" } | null {
  if (i.kind === "paid" && i.status === "issued")
    return { text: "Paid", tone: "good" };
  if (i.kind !== "checkout" || i.status !== "issued") return null;
  if (i.checkout_source === "whop")
    return { text: "Payment shows in Whop", tone: "neutral" };
  if (!watched(i)) return null;
  const s = p?.status?.toUpperCase();
  if (s === "PAID") return { text: "Paid", tone: "good" };
  if (s === "EXPIRED") return { text: "Link expired", tone: "warning" };
  if (s === "DELETED") return { text: "Link deleted", tone: "warning" };
  if (s === "CANCELLED") return { text: "Link cancelled", tone: "warning" };
  return { text: "Not paid yet", tone: "neutral" };
}

/**
 * The links an issued, unpaid Ecom or Tap invoice can be made again with
 * ("Same invoice with ..."): the ones not yet tried for this charge
 * (sameCharge). A Whop invoice offers none: its payments are not followed here, so
 * the cockpit cannot tell it is still unpaid.
 */
export function redoTargets(
  i: InvoiceRow,
  p: PaymentState | undefined,
  all: InvoiceRow[] = [],
): MadeLink[] {
  if (i.kind !== "checkout" || i.status !== "issued" || !watched(i)) return [];
  if (paymentWord(i, p)?.text === "Paid") return [];
  const tried = new Set(sameCharge(i, all).map(c => c.checkout_source));
  return MADE_LINKS.filter(m => m !== i.checkout_source && !tried.has(m));
}
