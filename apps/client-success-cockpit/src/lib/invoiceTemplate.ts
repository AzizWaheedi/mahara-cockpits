/**
 * The invoice template fill, in the browser, for the live preview beside the
 * invoice form. It is a line-for-line port of hermes/invoice-desk/desk/build.py
 * (`fill`), which prints the PDF the client gets. Both are checked against
 * hermes/invoice-desk/tests/golden/cases.json (scripts/invoice-template.test.ts
 * here, tests/test_build.py there), so the preview and the issued PDF cannot
 * drift apart. Every value a person typed is HTML-escaped; only the payment
 * lines, built here from escaped parts, go in as markup.
 */

export type InvoiceKind = "checkout" | "autocharge" | "paid";

export type InvoicePayment = {
  date: string;
  method: string;
  amount: number | string;
  ref?: string | null;
};

/** The fields of a cockpit_invoices row the template reads. */
export type InvoiceDraft = {
  kind: InvoiceKind;
  client_name: string;
  amount_usd: number | string;
  description: string;
  line_note?: string | null;
  client_detail?: string | null;
  /** The client's own tax number, printed under the location when given. */
  client_tax_id?: string | null;
  period?: string | null;
  pay_note?: string | null;
  issue_date: string;
  due_date?: string | null;
  checkout_url?: string | null;
  checkout_source?: "pasted" | "whop" | "ecom";
  amount_kwd?: string | number | null;
  kwd_rate?: string | number | null;
  payments?: InvoicePayment[] | null;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const PAID_BADGE = "Paid in full";
export const PAYEE = "BassamCo For Product Promotion";
const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

export class InvoiceBuildError extends Error {}

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * 6000 -> "6,000.00", rounding half up on the decimal digits as typed, the
 * way Python's Decimal does (1.005 -> "1.01", where toFixed gives "1.00").
 */
export function money(value: number | string): string {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(String(value).trim());
  if (!m) throw new InvoiceBuildError(`${String(value)} is not an amount.`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (cents % 100n).toString().padStart(2, "0");
  return `${m[1]}${whole}.${rest}`;
}

/** "2026-10-06" -> "6 Oct 2026". */
export function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month || Number(m[3]) < 1 || Number(m[3]) > 31) {
    throw new InvoiceBuildError(`${String(iso)} is not a date.`);
  }
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Keep or drop every <!--IF_TAG--> ... <!--/IF_TAG--> region. */
function stripBlock(html: string, tag: string, keep: boolean): string {
  const pattern = new RegExp(
    `<!--IF_${tag}-->[\\s\\S]*?<!--/IF_${tag}-->`,
    "g",
  );
  if (!pattern.test(html)) {
    throw new InvoiceBuildError(
      `The invoice template is missing its IF_${tag} block.`,
    );
  }
  pattern.lastIndex = 0;
  return html.replace(pattern, block => (keep ? block : ""));
}

function paidLines(payments: InvoicePayment[]): string {
  return payments
    .map(p => {
      const parts = [
        esc(day(p.date)),
        esc(p.method),
        `USD <b>${esc(money(p.amount))}</b>`,
      ];
      if (p.ref) parts.push(`REF ${esc(p.ref)}`);
      return `<div class="receipt-line">${parts.join(" &nbsp;·&nbsp; ")}</div>`;
    })
    .join("\n");
}

/** The note under the total when the person left it empty. */
export function payNote(inv: InvoiceDraft): string {
  if (inv.pay_note) return String(inv.pay_note);
  if (inv.kind === "paid") {
    return `This invoice confirms that ${PAYEE} received USD ${money(inv.amount_usd)} in full. Nothing further is due.`;
  }
  if (inv.kind === "autocharge") {
    return "No action is needed on your side. This invoice is issued for your records.";
  }
  return "";
}

/** The day the last payment arrived, as an ISO date. Empty unless paid. */
function paidOn(inv: InvoiceDraft): string {
  if (inv.kind !== "paid" || !inv.payments?.length) return "";
  return inv.payments
    .map(p => String(p.date).slice(0, 10))
    .reduce((a, b) => (b > a ? b : a));
}

export function fillInvoice(
  inv: InvoiceDraft,
  invoiceNo: string,
  template: string,
): string {
  const kind = inv.kind;
  if (kind !== "checkout" && kind !== "autocharge" && kind !== "paid") {
    throw new InvoiceBuildError(`Unknown invoice type ${String(kind)}.`);
  }
  const period = (inv.period ?? "").trim();
  const taxId = (inv.client_tax_id ?? "").trim();
  let html = template;
  html = stripBlock(html, "ECOM", kind === "checkout" && inv.checkout_source === "ecom");
  html = stripBlock(html, "NOT_ECOM", inv.checkout_source !== "ecom");
  html = stripBlock(html, "CHECKOUT", kind === "checkout");
  html = stripBlock(html, "AUTOCHARGE", kind === "autocharge");
  html = stripBlock(html, "PAID", kind === "paid");
  html = stripBlock(html, "PERIOD", Boolean(period));
  html = stripBlock(html, "TAX_ID", Boolean(taxId));
  const amount = money(inv.amount_usd);
  const due = inv.due_date;
  const values: Record<string, string> = {
    INVOICE_NO: esc(invoiceNo),
    ISSUE_DATE: esc(day(inv.issue_date)),
    DUE_DATE: due ? esc(day(due)) : "",
    PAID_DATE: kind === "paid" ? esc(day(paidOn(inv))) : "",
    PAID_BADGE: esc(PAID_BADGE),
    PAID_LINES: kind === "paid" ? paidLines(inv.payments ?? []) : "",
    CLIENT_NAME: esc(inv.client_name),
    CLIENT_DETAIL: esc(inv.client_detail ?? ""),
    CLIENT_TAX_ID: esc(taxId),
    DESCRIPTION: esc(inv.description),
    LINE_NOTE: esc(inv.line_note ?? ""),
    PERIOD: esc(period),
    AMOUNT: esc(amount),
    AMOUNT_FULL: esc(amount),
    CHECKOUT_URL: esc(inv.checkout_url ?? ""),
    ECOM_AMOUNT_LINE: esc(inv.amount_kwd != null && inv.kwd_rate != null ? `Pay KWD ${Number(inv.amount_kwd).toLocaleString("en-US", {minimumFractionDigits: 3, maximumFractionDigits: 3})} (USD ${amount} at ${inv.kwd_rate})` : "KWD amount calculated at today's exchange rate before issue"),
    PAY_NOTE: esc(payNote(inv)),
  };
  // One pass: text a person typed is never read again as a placeholder.
  return html.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new InvoiceBuildError(
        `The invoice template asks for {{${name}}}, which the invoice desk does not fill.`,
      );
    }
    return value;
  });
}

/** The template as the desk reads it: one line ending, whatever git checked out. */
export function normalizeTemplate(raw: string): string {
  return raw.replace(/\r\n/g, "\n");
}

let cached: Promise<string> | null = null;

/** The same template file the worker prints, loaded once when the tab opens. */
export function loadInvoiceTemplate(): Promise<string> {
  cached ??= import("./invoice-template.html?raw").then(m =>
    normalizeTemplate(m.default),
  );
  return cached;
}

/**
 * The filled page made to sit flush in the preview frame: no grey desk and no
 * shadow from the template's own screen styles. Added after the fill, so the
 * golden hashes stay the PDF's.
 */
export function framed(html: string): string {
  const style =
    "<style>@media screen{html{background:#fff!important}body{margin:0!important;box-shadow:none!important}}</style>";
  return html.replace("</head>", `${style}</head>`);
}
