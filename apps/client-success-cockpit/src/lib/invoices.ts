import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceKind, InvoicePayment } from "./invoiceTemplate";

/**
 * Invoices made from the cockpit. The page only asks: cockpit_invoice_request
 * checks the seat, the client scope and the numbers, and queues the row. The
 * invoice worker (hermes/invoice-desk) numbers it, prints it, files it locked
 * in the client's Drive folder and adds it to the invoice register.
 */

export type InvoiceStatus =
  | "queued"
  | "rendering"
  | "issued"
  | "failed"
  | "cancelled";

export type InvoiceRow = {
  id: string;
  clickup_task_id: string;
  client_name: string;
  kind: InvoiceKind;
  amount_usd: number;
  description: string;
  client_tax_id: string | null;
  period: string | null;
  issue_date: string;
  due_date: string | null;
  payments: InvoicePayment[];
  /** "whop": the invoice worker makes the link; "pasted": a person typed it. */
  checkout_source: "pasted" | "whop";
  checkout_url: string | null;
  whop_plan_id: string | null;
  status: InvoiceStatus;
  invoice_no: string | null;
  drive_url: string | null;
  error: string | null;
  attempts: number;
  requested_by: string;
  requested_at: string;
  issued_at: string | null;
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

export type ClientFolder = {
  taskId: string;
  folderId: string;
  folderName: string | null;
  matchedBy: "name" | "admin";
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
  /** "Pay online" only: the invoice worker creates a hidden one-time Whop link for the amount. */
  createLink?: boolean;
  payments?: { date: string; method: string; amount: string; ref?: string }[];
};

export type InvoicesData = {
  invoices: InvoiceRow[];
  clients: InvoiceClient[];
  folders: Record<string, ClientFolder>;
  desk: DeskStatus;
};

const COLUMNS =
  "id,clickup_task_id,client_name,kind,amount_usd,description,client_tax_id,period,issue_date,due_date,payments,checkout_source,checkout_url,whop_plan_id,status,invoice_no,drive_url,error,attempts,requested_by,requested_at,issued_at";

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "The database did not answer.");
}

export async function fetchInvoices(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<InvoicesData> {
  const [inv, acc, fold, desk] = await Promise.all([
    client
      .from("cockpit_invoices")
      .select(COLUMNS)
      .order("requested_at", { ascending: false })
      .limit(60),
    client
      .from("cockpit_billing_accounts")
      .select(
        "clickup_task_id,client_name,country,payment_plan,client_status,next_payment_usd,next_payment_date",
      )
      .order("client_name"),
    client
      .from("cockpit_client_drive_folders")
      .select("clickup_task_id,folder_id,folder_name,matched_by"),
    client
      .from("cockpit_invoice_desk_status")
      .select("beat_at,ok,detail")
      .maybeSingle(),
  ]);
  fail(inv.error);
  fail(acc.error);
  fail(fold.error);
  fail(desk.error);

  const scope =
    allowedClients && allowedClients.length > 0
      ? new Set(allowedClients.map(c => c.toLowerCase()))
      : null;
  const clients: InvoiceClient[] = (acc.data ?? [])
    .map(r => ({
      taskId: String(r.clickup_task_id),
      name: String(r.client_name ?? "").trim(),
      country: r.country ? String(r.country) : null,
      plan: r.payment_plan ? String(r.payment_plan) : null,
      status: r.client_status ? String(r.client_status) : null,
      nextUsd: r.next_payment_usd === null ? null : Number(r.next_payment_usd),
      nextDate: r.next_payment_date ? String(r.next_payment_date) : null,
    }))
    .filter(c => c.name && (!scope || scope.has(c.name.toLowerCase())));

  const folders: Record<string, ClientFolder> = {};
  for (const f of fold.data ?? []) {
    folders[String(f.clickup_task_id)] = {
      taskId: String(f.clickup_task_id),
      folderId: String(f.folder_id),
      folderName: f.folder_name ? String(f.folder_name) : null,
      matchedBy: f.matched_by === "admin" ? "admin" : "name",
    };
  }

  return {
    invoices: (inv.data ?? []).map(r => ({
      ...(r as unknown as InvoiceRow),
      amount_usd: Number(r.amount_usd),
      payments: Array.isArray(r.payments) ? r.payments : [],
    })),
    clients,
    folders,
    desk: desk.data
      ? {
          beatAt: String(desk.data.beat_at),
          ok: Boolean(desk.data.ok),
          detail: desk.data.detail ? String(desk.data.detail) : null,
        }
      : null,
  };
}

export async function requestInvoice(
  client: SupabaseClient,
  args: InvoiceRequest,
): Promise<InvoiceRow> {
  const { data, error } = await client.rpc("cockpit_invoice_request", {
    p_args: args,
  });
  fail(error);
  return data as InvoiceRow;
}

export async function changeInvoice(
  client: SupabaseClient,
  id: string,
  action: "cancel" | "retry",
): Promise<InvoiceRow> {
  const { data, error } = await client.rpc("cockpit_invoice_change", {
    p_id: id,
    p_action: action,
  });
  fail(error);
  return data as InvoiceRow;
}

/** Admin or CEO: file this client's invoices in the folder behind a Drive link. */
export async function setClientFolder(
  client: SupabaseClient,
  taskId: string,
  link: string,
): Promise<void> {
  const { error } = await client.rpc("cockpit_invoice_set_folder", {
    p_task: taskId,
    p_folder: link,
  });
  fail(error);
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
  if (!desk) {
    return "The invoice worker has not started yet. Invoices you ask for wait in the list until it does. Tell Muhammed.";
  }
  const quiet = Math.round((now - Date.parse(desk.beatAt)) / 60000);
  if (!desk.ok) {
    return (
      desk.detail ?? "The invoice worker reported a problem. Tell Muhammed."
    );
  }
  if (quiet > 5) {
    return `The invoice worker last checked in ${quiet} minutes ago. Invoices wait in the list until it is back. Tell Muhammed.`;
  }
  return null;
}
