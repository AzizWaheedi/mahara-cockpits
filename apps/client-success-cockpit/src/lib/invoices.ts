import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceKind, InvoicePayment } from "./invoiceTemplate";

/**
 * Invoices made from the cockpit. The page only asks: cockpit_invoice_request
 * checks the seat, the client scope and the numbers, and queues the row. The
 * invoice worker (hermes/invoice-desk) numbers it, makes the Ecom, Whop or
 * Tap link a Pay online invoice asks for, prints it, files it locked in the
 * client's Drive folder and adds it to the invoice register.
 */

export type InvoiceStatus =
  | "queued"
  | "rendering"
  | "issued"
  | "failed"
  | "cancelled";

/** Where a Pay online invoice's link comes from. */
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

/** The switch and copy buttons' exact words (the assistant guides quote them). */
export const USE_INSTEAD: Record<MadeLink, string> = {
  ecom: "Use an Ecom link instead",
  whop: "Use a Whop link instead",
  tap: "Use a Tap link instead",
};
export const SAME_WITH: Record<MadeLink, string> = {
  ecom: "Same invoice with Ecom",
  whop: "Same invoice with Whop",
  tap: "Same invoice with Tap",
};

/** The form's link choice: one the worker makes, or a pasted one. */
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
  /** "ecom" is the usual link the worker makes, "whop" and "tap" the backups, "pasted" one a person had. */
  checkout_source: LinkSource;
  checkout_url: string | null;
  whop_plan_id: string | null;
  ecom_invoice_id: string | null;
  tap_invoice_id?: string | null;
  /** Asked for with a Tap link: Tap shows it on its page and sends nothing. */
  client_email?: string | null;
  amount_kwd: number | null;
  kwd_rate: number | null;
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
  /** "Pay online" only: the invoice worker makes the link. */
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
  folders: Record<string, ClientFolder>;
  desk: DeskStatus;
  /**
   * Ecom's or Tap's word on each issued Ecom or Tap invoice, by invoice id; null when the
   * lookup failed, so the list says nothing rather than "Not paid yet".
   */
  paid: Record<string, PaymentState> | null;
};

const COLUMNS =
  "id,clickup_task_id,client_name,kind,amount_usd,description,line_note,client_detail,client_tax_id,period,pay_note,issue_date,due_date,payments,checkout_source,checkout_url,whop_plan_id,ecom_invoice_id,tap_invoice_id,client_email,amount_kwd,kwd_rate,status,invoice_no,drive_url,error,attempts,requested_by,requested_at,issued_at";

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "The database did not answer.");
}

export async function fetchInvoices(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<InvoicesData> {
  const [inv, acc, fold, desk] = await Promise.all([
    // The worker's check-in is also read again on its own every minute
    // (fetchDeskStatus), so an open page does not age a reading it took once.
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

  const invoices: InvoiceRow[] = (inv.data ?? []).map(r => ({
    ...(r as unknown as InvoiceRow),
    amount_usd: Number(r.amount_usd),
    payments: Array.isArray(r.payments) ? r.payments : [],
  }));

  return {
    invoices,
    clients,
    folders,
    paid: await fetchPaid(client, invoices),
    desk: deskFromRow(desk.data),
  };
}

function deskFromRow(
  row: { beat_at: unknown; ok: unknown; detail: unknown } | null,
): DeskStatus {
  return row
    ? {
        beatAt: String(row.beat_at),
        ok: Boolean(row.ok),
        detail: row.detail ? String(row.detail) : null,
      }
    : null;
}

/** The invoice worker's last check-in only, for the page to read again while it stays open. */
export async function fetchDeskStatus(
  client: SupabaseClient,
): Promise<DeskStatus> {
  const { data, error } = await client
    .from("cockpit_invoice_desk_status")
    .select("beat_at,ok,detail")
    .maybeSingle();
  fail(error);
  return deskFromRow(data);
}

/**
 * Whether each issued Ecom or Tap link was paid (cockpit_invoice_payments: only
 * the invoices this seat can see; the Ecom and Tap tables are not for seats).
 * A refusal leaves the list without payment words instead of failing the page.
 */
async function fetchPaid(
  client: SupabaseClient,
  invoices: InvoiceRow[],
): Promise<Record<string, PaymentState> | null> {
  const ids = invoices
    .filter(i => watched(i) && i.status === "issued")
    .map(i => i.id);
  if (!ids.length) return {};
  const { data, error } = await client.rpc("cockpit_invoice_payments", {
    p_ids: ids,
  });
  if (error) return null;
  const paid: Record<string, PaymentState> = {};
  for (const x of (Array.isArray(data) ? data : []) as Record<
    string,
    unknown
  >[]) {
    if (typeof x.id === "string")
      paid[x.id] = {
        status: String(x.status ?? ""),
        paid_at: typeof x.paid_at === "string" ? x.paid_at : null,
        method: typeof x.method === "string" ? x.method : null,
      };
  }
  return paid;
}

export async function requestInvoice(
  client: SupabaseClient,
  args: InvoiceRequest,
): Promise<InvoiceRow> {
  const { data, error } = await client.rpc("cockpit_invoice_request", {
    p_args: args,
  });
  fail(error);
  const row = data as InvoiceRow;
  await linkWaitingWin(client, args.taskId, row);
  return row;
}

// --- "Invoice this" from a win (docs/forms/WAVE56-CONTRACT.md 4.3.3) ------------

const WIN_KEY = "mahara.win-invoice";

/** Remember the win "Invoice this" was pressed on, for the next invoice on that client (one hour). */
export function rememberWinInvoice(winId: string, taskId: string): void {
  try {
    window.sessionStorage.setItem(
      WIN_KEY,
      JSON.stringify({ winId, taskId, at: Date.now() }),
    );
  } catch {
    /* No storage: the invoice is made, the win is tied by hand. */
  }
}

/** The waiting win for this client, if "Invoice this" was pressed in the last hour. */
export function waitingWin(taskId: string): string | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(WIN_KEY) ?? "null");
    return v && v.taskId === taskId && Date.now() - Number(v.at) < 3600_000
      ? String(v.winId)
      : null;
  } catch {
    return null;
  }
}

/**
 * Once the invoice is requested, link it to the win (cockpit_csm_win_invoice_link),
 * so its rail payment can be tied when it arrives. A refusal is not the
 * invoice's failure: the invoice stands and the link waits for a person.
 */
async function linkWaitingWin(
  client: SupabaseClient,
  taskId: string,
  row: InvoiceRow,
): Promise<void> {
  const winId = waitingWin(taskId);
  const id = (row as { id?: unknown } | null)?.id;
  if (!winId || typeof id !== "string") return;
  const { error } = await client.rpc("cockpit_csm_win_invoice_link", {
    p_win_id: winId,
    p_invoice_id: id,
  });
  if (!error)
    try {
      window.sessionStorage.removeItem(WIN_KEY);
    } catch {
      /* Nothing to clear. */
    }
}

export type InvoiceAction = "cancel" | "retry" | MadeLink;

export async function changeInvoice(
  client: SupabaseClient,
  id: string,
  action: InvoiceAction,
  email?: string,
): Promise<InvoiceRow> {
  const { data, error } = await client.rpc("cockpit_invoice_change", {
    p_id: id,
    p_action: action,
    ...(email ? { p_email: email.trim().toLowerCase() } : {}),
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

/**
 * Paid, waiting or expired, from Ecom or Tap; null when there is nothing to
 * say. Whop payments are not mirrored in the cockpit, so a Whop row says
 * where to look; a pasted link's payment is not tracked at all.
 */
export function paymentWord(
  i: InvoiceRow,
  p: PaymentState | undefined,
): { text: string; tone: "good" | "warn" | "neutral" } | null {
  if (i.kind === "paid" && i.status === "issued")
    return { text: "Paid", tone: "good" };
  if (i.kind !== "checkout" || i.status !== "issued") return null;
  if (i.checkout_source === "whop")
    return { text: "Payment shows in Whop", tone: "neutral" };
  if (!watched(i)) return null;
  const s = p?.status?.toUpperCase();
  if (s === "PAID") return { text: "Paid", tone: "good" };
  if (s === "EXPIRED") return { text: "Link expired", tone: "warn" };
  if (s === "DELETED") return { text: "Link deleted", tone: "warn" };
  if (s === "CANCELLED") return { text: "Link cancelled", tone: "warn" };
  return { text: "Not paid yet", tone: "neutral" };
}

/**
 * The links an issued, unpaid Ecom or Tap invoice can be made again with
 * ("Same invoice with ..."): the ones not yet tried for this charge
 * (sameCharge), so a Tap copy of an Ecom invoice offers Whop, not Ecom again. A
 * Whop invoice offers none: its payments are not followed here, so the
 * cockpit cannot tell it is still unpaid.
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

/** Which issued invoice offers "Same invoice with Whop": Ecom or Tap, Pay online, not paid. */
export function canRedoWithWhop(
  i: InvoiceRow,
  p: PaymentState | undefined,
): boolean {
  return redoTargets(i, p).includes("whop");
}

/**
 * The copy already asked for of this invoice with another made link: a later
 * invoice for the same charge (sameCharge), with a different link. An issued invoice cannot be cancelled and the server
 * stops a repeat for two minutes only, so while a copy exists the row offers
 * no second one. The list is newest first, so a copy is on screen whenever
 * its original is.
 */
export function copyOf(i: InvoiceRow, all: InvoiceRow[]): InvoiceRow | null {
  const after = Date.parse(i.requested_at);
  return (
    sameCharge(i, all).find(
      c =>
        isMadeLink(c.checkout_source) &&
        c.checkout_source !== i.checkout_source &&
        Date.parse(c.requested_at) > after,
    ) ?? null
  );
}

/** The Whop copy of this invoice, as copyOf finds it; null when the copy is not Whop. */
export function whopCopyOf(
  i: InvoiceRow,
  all: InvoiceRow[],
): InvoiceRow | null {
  const c = copyOf(i, all);
  return c?.checkout_source === "whop" ? c : null;
}

/** The form's fields, refilled from an invoice. */
export type InvoicePrefill = {
  taskId: string;
  kind: InvoiceKind;
  amount: string;
  description: string;
  lineNote: string;
  clientDetail: string;
  taxId: string;
  period: string;
  payNote: string;
  dueDate: string;
  linkMode: LinkMode;
  clientEmail: string;
};

/**
 * "Same invoice with Whop" (or Tap, or Ecom): the same client, amount and
 * words, Pay online with that link. A due date already past moves to three
 * days from today. The client's email comes along for Tap.
 */
export function sameWith(
  i: InvoiceRow,
  today: string,
  mode: MadeLink,
): InvoicePrefill {
  return {
    taskId: i.clickup_task_id,
    kind: "checkout",
    amount: String(i.amount_usd),
    description: i.description,
    lineNote: i.line_note ?? "",
    clientDetail: i.client_detail ?? "",
    taxId: i.client_tax_id ?? "",
    period: i.period ?? "",
    payNote: i.pay_note ?? "",
    dueDate:
      i.due_date && i.due_date >= today
        ? i.due_date.slice(0, 10)
        : addDays(today, 3),
    linkMode: mode,
    clientEmail: i.client_email ?? "",
  };
}

export function sameWithWhop(i: InvoiceRow, today: string): InvoicePrefill {
  return sameWith(i, today, "whop");
}
